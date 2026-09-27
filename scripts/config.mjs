// Locates the host repo's config. This app is used as a submodule, so nothing org-specific
// lives in it:
//   - wrangler.toml (worker name, CRM provider, report settings) sits in a folder outside it,
//     by default ../sales-config next to this folder. Set SALES_CONFIG_DIR to use another folder.
//   - Secrets live in the host's shared env file, named by `env_file:` in the host's
//     automation/paths.yaml (resolved from that automation folder).
//     Set SALES_PATHS_YAML to use a different paths.yaml.
// Relative paths in SALES_CONFIG_DIR and SALES_PATHS_YAML resolve from this folder.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_DIR = path.resolve(ROOT, process.env.SALES_CONFIG_DIR || "../sales-config");
export const WRANGLER_TOML = path.join(CONFIG_DIR, "wrangler.toml");
export const WRANGLER_BIN = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
export const PATHS_YAML = path.resolve(ROOT, process.env.SALES_PATHS_YAML || "../automation/paths.yaml");

// Reads `env_file:` from paths.yaml: strips a trailing whitespace-preceded comment, then trims
// and unquotes.
export function readEnvFileSetting(file) {
  try {
    const match = readFileSync(file, "utf8").match(/^\s*env_file:\s*(.+)$/m);
    if (!match) return null;
    return match[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

// Absolute path of the shared env file, or null when paths.yaml doesn't name one.
export const ENV_PATH = (() => {
  const setting = readEnvFileSetting(PATHS_YAML);
  return setting ? path.resolve(path.dirname(PATHS_YAML), setting) : null;
})();

export const MISSING_ENV_HELP =
  `No env file configured. Create ${PATHS_YAML} containing a line like\n` +
  `  env_file: ../../safe/yourname.env\n` +
  `(resolved from that automation folder), or set SALES_PATHS_YAML.`;

// The agent command that starts this app locally, when the host repo's AGENTS.md defines one
// (a "## Start Sites" section answers to "start sites"). The page suggests it for opening the
// settings form. Returns null when the host has no such section.
export function hostAgentCommand() {
  try {
    const text = readFileSync(path.join(ROOT, "..", "AGENTS.md"), "utf8");
    return /^#{1,6}\s+Start Sites\b/im.test(text) ? "start sites" : null;
  } catch {
    return null;
  }
}

const TEMPLATE_DIR = path.join(ROOT, "config-template");

// Creates the config folder from config-template/ on first run. Never overwrites existing files.
export function ensureConfig() {
  if (existsSync(WRANGLER_TOML)) return false;
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Paths in wrangler.toml resolve from the config folder, so point them back at this app.
  const appDir = path.relative(CONFIG_DIR, ROOT).split(path.sep).join("/") || ".";
  const toml = readFileSync(path.join(TEMPLATE_DIR, "wrangler.toml"), "utf8").replaceAll("{{APP_DIR}}", appDir);
  writeFileSync(WRANGLER_TOML, toml);
  const ignore = path.join(CONFIG_DIR, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, readFileSync(path.join(TEMPLATE_DIR, "gitignore"), "utf8"));
  return true;
}

// Non-secret values from wrangler.toml [vars].
export function wranglerVars() {
  if (!existsSync(WRANGLER_TOML)) return {};
  const toml = readFileSync(WRANGLER_TOML, "utf8");
  const vars = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] || "";
  const out = {};
  for (const m of vars.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}
