#!/usr/bin/env node
// Copies the CRM provider's secrets from the shared env file (named by automation/paths.yaml) into GitHub Actions secrets using
// the GitHub CLI, so the deploy workflow can hand them to Cloudflare. Values go over stdin, never argv.
// gh runs from the config folder, so the secrets go to the host repo that holds it.
//
// Usage: npm run secrets:push                  (repo-level secrets)
//        npm run secrets:push -- --env production   (a GitHub Environment)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "./env-file.mjs";
import { getProvider } from "../src/providers/index.js";
import { CONFIG_DIR, ENV_PATH as envPath, MISSING_ENV_HELP, WRANGLER_TOML, wranglerVars } from "./config.mjs";

const ghEnv = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : null;

if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
  console.error("GitHub CLI not found or not logged in. Install it from https://cli.github.com and run `gh auth login`.");
  process.exit(1);
}
if (!envPath) {
  console.error(MISSING_ENV_HELP);
  process.exit(1);
}
if (!existsSync(envPath)) {
  console.error("No settings saved yet — run `npm run dev` and fill in the settings form first.");
  process.exit(1);
}

const { values } = parseEnv(readFileSync(envPath, "utf8"));
const fields = getProvider(values.CRM_PROVIDER || wranglerVars().CRM_PROVIDER).settings;
let failed = false;

for (const f of fields.filter((f) => f.secret)) {
  if (!values[f.key]) { console.warn(`skip  ${f.key} (not saved yet)`); continue; }
  const args = ["secret", "set", f.key, ...(ghEnv ? ["--env", ghEnv] : [])];
  const r = spawnSync("gh", args, { input: values[f.key], stdio: ["pipe", "inherit", "inherit"], cwd: CONFIG_DIR });
  if (r.status === 0) console.log(`set   ${f.key}${ghEnv ? ` (environment: ${ghEnv})` : ""}`);
  else { failed = true; console.error(`fail  ${f.key}`); }
}

// Non-secret settings deploy from wrangler.toml, so flag any local override that won't reach production.
const vars = existsSync(WRANGLER_TOML) ? wranglerVars() : {};
for (const f of fields.filter((f) => !f.secret)) {
  if (values[f.key] && vars[f.key] !== values[f.key]) {
    console.warn(`note  ${f.key} saved locally differs from ${WRANGLER_TOML} — update its [vars] so production uses it.`);
  }
}
process.exit(failed ? 1 : 0);
