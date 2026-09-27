# Project guide for AI agents

Cloudflare Worker + static frontend that displays a CRM report. Salesforce is the first provider; others will follow.

This folder is used as a submodule of other repos, so it must stay organization-neutral. Each host repo's config lives
outside it, by default in `../sales-config/wrangler.toml` (or wherever `SALES_CONFIG_DIR` points). Secrets live in the
host's shared env file, named by `env_file:` in `../automation/paths.yaml` (or `SALES_PATHS_YAML`), outside every repo.

## Layout
- `src/index.js` — Worker routes: `GET /api/report`, `GET /api/health`. Everything else is static from `public/`. Provider-neutral.
- `src/providers/index.js` — provider registry and the shape every provider exports. `CRM_PROVIDER` picks one.
- `src/providers/salesforce.js` — Salesforce: Client Credentials OAuth, Reports REST API, its settings, help links and setup guide. Token cached in isolate memory only.
- `src/providers/salesforce-report.js` — flattens the Salesforce Reports API response (tabular + summary) into `{columns, rows}`.
- `public/index.html` — the frontend (vanilla JS, no build step). Provider-neutral.
- `scripts/dev.mjs` — `npm run dev`: local settings form on :8790 + `wrangler dev` on :8787, restarted on save.
- `scripts/setup.html` — the settings form. One tab per provider in `src/providers/`, with the fields and guide each supplies. "Use this CRM" sets `CRM_PROVIDER` in the env file (a local override; deploys use `wrangler.toml`).
- `scripts/env-file.mjs` — env file read/write that keeps other keys intact, and validation against a provider's settings.
- `scripts/config.mjs` — finds the config folder and the shared env file, creates the config folder from `config-template/` on first run, and detects a host "Start Sites" agent command (passed to the local Worker as `AGENT_START_COMMAND`).
- `scripts/push-secrets.mjs` — copies the provider's secrets from the shared env file to the host repo's GitHub Actions secrets via `gh`.
- `scripts/deploy.mjs` — `npm run deploy` with the config folder's `wrangler.toml`.
- `config-template/` — blank `wrangler.toml`, `gitignore` and `deploy.yml` workflow for a host repo's config folder.

## Rules
- NEVER read, print, cat, grep or echo the shared env file, any `.env`, or `.dev.vars`. They hold live credentials for many services.
  To check what's configured, call `GET /api/health` on the running worker (booleans only).
- Secrets never go in `wrangler.toml`, source, logs, or API responses.
- The browser never talks to the CRM and never receives a token. All CRM calls go through the Worker.
- The Worker only runs reports/queries that are defined server-side. Never accept queries or report IDs from the client.
- Never add organization-specific values (instance URL, report ID, worker name for an org, org or company names) to this folder. They go in the host's config folder.
- Keep CRM-specific code and names inside `src/providers/`. The Worker, page, form and scripts stay provider-neutral.
- Prefix a provider's settings with the CRM's name (`SF_` for Salesforce) so they can't collide in a shared env file.
- Non-secret config lives in the config folder's `wrangler.toml` `[vars]`; the same keys in the shared env file override it during dev.
- The page calls the API with relative paths (`api/report`), so it works at `/` and when mounted under a path such as `/sales/`.
- Providers report truncated results through `notice`; Salesforce's synchronous runs stop at 2,000 rows.

## Commits and pushes
- Never add Claude (or other AI) attribution to commits or pull requests: no `Co-Authored-By` lines and no "Generated with Claude Code" text.
- This repo is github.com/DesktopFolders/sales. Commit and push it as the DesktopFolders account.
  - Before committing or pushing, check `gh auth status`. If the active account isn't DesktopFolders, run `gh auth switch --user DesktopFolders`, then switch back to the previous account when done. Git pushes use gh's active account.
  - If DesktopFolders isn't logged in, ask the user to run `gh auth login` and choose that account.
  - The repo's own git config (not `--global`) sets `user.name` to `DesktopFolders` and `user.email` to `333818163+DesktopFolders@users.noreply.github.com`. Set them if missing.

## Salesforce tooling
- `.mcp.json` registers the Salesforce DX MCP server against the default `sf` org. Run `sf org login web --set-default` first.
- Use it to inspect report metadata and object fields when changing columns or adding views — not at runtime.

## Commands
- `npm run dev` — settings form + local worker
- `npm test` — report parser, provider and env file tests
- `npm run secrets:push [-- --env production]` — sync the provider's secrets to GitHub
- `npm run deploy` — manual deploy
- CI deploys run from the host repo, using a copy of `config-template/deploy.yml`.
