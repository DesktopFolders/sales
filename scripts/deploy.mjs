#!/usr/bin/env node
// Manual deploy with the host repo's config folder (normally CI does this — see config-template/deploy.yml).
// Usage: npm run deploy

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CONFIG_DIR, WRANGLER_TOML, WRANGLER_BIN } from "./config.mjs";

if (!existsSync(WRANGLER_TOML)) {
  console.error(`No ${WRANGLER_TOML} yet — run \`npm run dev\` once to create it, or set SALES_CONFIG_DIR.`);
  process.exit(1);
}
const r = spawnSync(process.execPath, [WRANGLER_BIN, "deploy", "--config", WRANGLER_TOML], { stdio: "inherit", cwd: CONFIG_DIR });
process.exit(r.status ?? 1);
