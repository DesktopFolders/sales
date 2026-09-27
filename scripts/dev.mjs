#!/usr/bin/env node
// Local dev runner:
//   1. Serves a setup form on http://127.0.0.1:8790 for the settings the chosen CRM provider needs.
//   2. Writes them to the host's shared env file (named by automation/paths.yaml, outside any repo),
//      changing only these keys — secret values are never sent back to the browser. See scripts/config.mjs.
//   3. Runs `wrangler dev --config <config>/wrangler.toml --env-file <shared env>` and restarts it whenever
//      settings change. wrangler.toml's [secrets] required list limits what the Worker gets to the
//      provider's secrets (plus overrides of its [vars]), not everything in the shared file,
//      so the running Worker always has the current values.
//
// Usage: npm run dev

import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseEnv, serializeEnv, validate } from "./env-file.mjs";
import { getProvider, PROVIDERS } from "../src/providers/index.js";
import { ROOT, CONFIG_DIR, ENV_PATH, MISSING_ENV_HELP, WRANGLER_TOML, WRANGLER_BIN, ensureConfig, wranglerVars, hostAgentCommand, workerName } from "./config.mjs";

if (!ENV_PATH) {
  console.error(MISSING_ENV_HELP);
  process.exit(1);
}

const SETUP_PORT = Number(process.env.SETUP_PORT || 8790);
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);
const HOST = "127.0.0.1";
const TOKEN = randomBytes(24).toString("base64url");
const ALLOWED_HOSTS = new Set([`${HOST}:${SETUP_PORT}`, `localhost:${SETUP_PORT}`]);

// ---------- shared env file I/O ----------
const readEnvText = () => (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "");

function writeEnvText(text) {
  // Write through a symlink to the real file, and replace it atomically so a crash can't truncate it.
  const target = existsSync(ENV_PATH) ? realpathSync(ENV_PATH) : ENV_PATH;
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, target);
  try { chmodSync(target, 0o600); } catch {}
}

// The provider named by CRM_PROVIDER (env file first, then wrangler.toml [vars]).
function currentProvider(values = parseEnv(readEnvText()).values) {
  return getProvider(values.CRM_PROVIDER || wranglerVars().CRM_PROVIDER);
}

// One provider's fields and setup guide. Secret values are never included.
function providerStatus(provider, values, defaults) {
  const publicValues = Object.fromEntries(provider.settings.filter((f) => !f.secret).map((f) => [f.key, values[f.key] || defaults[f.key] || ""]));
  const links = provider.links(publicValues);
  return {
    id: provider.id,
    name: provider.name,
    guide: provider.guide(links),
    fields: provider.settings.map((f) => {
      const inEnv = Boolean(values[f.key]);
      const entry = {
        key: f.key, secret: f.secret, label: f.label, placeholder: f.placeholder, help: f.help(links),
        set: inEnv, source: inEnv ? "env" : defaults[f.key] ? "wrangler.toml" : null,
      };
      if (!f.secret) entry.value = publicValues[f.key];
      return entry;
    }),
  };
}

// Every provider gets a tab in the form; `active` is the one the Worker uses (CRM_PROVIDER).
function status() {
  const { values } = parseEnv(readEnvText());
  const defaults = wranglerVars(); // shown when the env file has no override
  return {
    instance: workerName(),
    active: currentProvider(values).id,
    providers: Object.values(PROVIDERS).map((p) => providerStatus(p, values, defaults)),
    worker: { ...worker.state, url: `http://localhost:${WORKER_PORT}` },
  };
}

// ---------- wrangler dev child process ----------

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, HOST);
  });
}

const worker = {
  child: null,
  state: { status: "stopped", message: "" },

  async start() {
    const args = [WRANGLER_BIN, "dev", "--config", WRANGLER_TOML, "--ip", HOST, "--port", String(WORKER_PORT), "--show-interactive-dev-session=false"];
    if (existsSync(ENV_PATH)) args.push("--env-file", ENV_PATH);
    // Local only: lets the page link to this settings form, and suggest the host's agent command.
    // The token is the same one printed in the terminal; it lasts as long as this process.
    args.push("--var", `SETTINGS_FORM_URL:http://localhost:${SETUP_PORT}/#t=${TOKEN}`);
    args.push("--var", `SALES_INSTANCE:${workerName()}`); // names the report page's browser tab
    const agentCommand = hostAgentCommand();
    if (agentCommand) args.push("--var", `AGENT_START_COMMAND:${agentCommand}`);
    this.state = { status: "starting", message: "" };
    if (!(await portFree(WORKER_PORT))) {
      this.state = { status: "error", message: `Port ${WORKER_PORT} is in use by another process. Stop it, then click Save again.` };
      return this.state;
    }
    // Run wrangler directly (not via npx) in its own process group, so stop() can take down
    // wrangler *and* its workerd children together. Otherwise workerd is orphaned and keeps the port.
    const child = spawn(process.execPath, args, {
      cwd: CONFIG_DIR, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" },
    });
    this.child = child;
    const pipe = (stream) => stream.on("data", (d) => {
      for (const line of d.toString().split("\n")) {
        // Keep the shared env file's location out of the output.
        if (line.trim() && !/Using secrets defined in/.test(line)) process.stdout.write(`\x1b[36m[worker]\x1b[0m ${line}\n`);
      }
    });
    pipe(child.stdout); pipe(child.stderr);
    child.on("exit", (code) => {
      if (this.child === child) { this.child = null; this.state = { status: "stopped", message: `wrangler exited (${code})` }; }
    });
    return this.waitHealthy();
  },

  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const t = setTimeout(() => { killGroup("SIGKILL"); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(t); resolve(); });
      killGroup("SIGTERM");
    });
    killGroup("SIGKILL"); // sweep any workerd process that outlived its parent
    // Wait for the port to actually be released before a restart tries to bind it.
    for (let i = 0; i < 40 && !(await portFree(WORKER_PORT)); i++) await new Promise((r) => setTimeout(r, 250));
  },

  async restart() { await this.stop(); return this.start(); },

  async waitHealthy(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.child) break;
      try {
        const res = await fetch(`http://${HOST}:${WORKER_PORT}/api/health`);
        if (res.ok) {
          const body = await res.json();
          this.state = { status: "running", message: "", configured: body.configured };
          return this.state;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    this.state = { status: "error", message: "Worker did not become healthy — check the terminal output." };
    return this.state;
  },
};

// ---------- HTTP helpers ----------
// The token travels in the link's #t=… part, which browsers never send to a server; the page
// reads it and sends it in this header on every API call.
function tokenOk(req) {
  const given = req.headers["x-setup-token"] || "";
  const a = Buffer.from(String(given)), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("Body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

let saving = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // DNS-rebinding guard: only answer requests addressed to this exact host:port.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 421, { error: "Misdirected request" });
  // The page itself holds nothing secret, so it loads without the token. Every API call needs it.
  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, readFileSync(path.join(ROOT, "scripts", "setup.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (!tokenOk(req)) return send(res, 401, { error: "Missing or invalid setup token. Use the settings form link printed in the terminal." });

  try {
    if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, status());

    if (req.method === "POST" && url.pathname === "/api/secrets") {
      // Custom header + JSON content type means a cross-site page can't send this without a CORS preflight, which we never grant.
      if (!String(req.headers["content-type"]).startsWith("application/json")) return send(res, 415, { error: "Expected JSON" });
      if (saving) return send(res, 409, { error: "A save is already in progress" });
      saving = true;
      try {
        const { provider: providerId, values = {}, clear = [] } = JSON.parse(await readBody(req));
        const { updates, errors } = validate(values, clear, (providerId ? getProvider(providerId) : currentProvider()).settings);
        if (errors.length) return send(res, 400, { error: "Some values are invalid", errors });
        const changed = Object.keys(updates);
        if (!changed.length) return send(res, 200, { changed: [], ...status() });

        const parsed = parseEnv(readEnvText());
        writeEnvText(serializeEnv(parsed, updates));
        console.log(`\x1b[32m[setup]\x1b[0m Saved ${changed.join(", ")} — restarting worker…`);
        await worker.restart();
        return send(res, 200, { changed, ...status() });
      } finally {
        saving = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/provider") {
      // "Use this CRM": sets CRM_PROVIDER in the env file (a local override of wrangler.toml) and restarts.
      if (!String(req.headers["content-type"]).startsWith("application/json")) return send(res, 415, { error: "Expected JSON" });
      if (saving) return send(res, 409, { error: "A save is already in progress" });
      saving = true;
      try {
        const { provider: providerId } = JSON.parse(await readBody(req));
        if (!Object.hasOwn(PROVIDERS, providerId)) return send(res, 400, { error: "Unknown CRM" });
        writeEnvText(serializeEnv(parseEnv(readEnvText()), { CRM_PROVIDER: providerId }));
        console.log(`\x1b[32m[setup]\x1b[0m Using CRM ${providerId} — restarting worker…`);
        await worker.restart();
        return send(res, 200, status());
      } finally {
        saving = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/test") {
      // Calls the running Worker the same way the app does; returns only a summary.
      try {
        const r = await fetch(`http://${HOST}:${WORKER_PORT}/api/report?refresh=1`);
        const body = await r.json();
        if (!r.ok) return send(res, 200, { ok: false, error: body.error, detail: body.detail });
        return send(res, 200, { ok: true, name: body.name, rowCount: body.rowCount });
      } catch {
        return send(res, 200, { ok: false, error: "Local worker is not reachable — is it running?" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/restart") {
      await worker.restart();
      return send(res, 200, status());
    }
    return send(res, 404, { error: "Not found" });
  } catch (err) {
    return send(res, 400, { error: err.message || "Bad request" });
  }
});

if (ensureConfig()) console.log(`\x1b[32m[setup]\x1b[0m Created ${WRANGLER_TOML} from config-template. Fill in the form to finish.`);
console.log(`\x1b[1mConfig folder:\x1b[0m ${CONFIG_DIR}`);

server.listen(SETUP_PORT, HOST, () => {
  const setupUrl = `http://localhost:${SETUP_PORT}/#t=${TOKEN}`;
  console.log(`\n\x1b[1mSettings form:\x1b[0m      ${setupUrl}`);
  console.log(`\x1b[1mApp (wrangler dev):\x1b[0m http://localhost:${WORKER_PORT}\n`);
  worker.start();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => { await worker.stop(); server.close(); process.exit(0); });
}
