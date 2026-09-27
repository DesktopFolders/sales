# Sales

Submodule of commons for CRM integrations.

A Cloudflare Worker that runs a CRM report server-side and serves it as a sortable, filterable table. The browser never sees a CRM token.

```
Browser ──▶ Worker /api/report ──▶ CRM provider ──▶ CRM API
             (results cached 5 min)   (src/providers/)
```

Salesforce is the first provider. Others (HubSpot, Dynamics and so on) can be added as modules in `src/providers/` without changing the Worker or the page.

This folder is meant to be a submodule of other repos, so it holds nothing specific to one organization. Each host repo keeps its own settings next to it (see [Host config](#host-config)).

## Host config

Organization-specific settings live outside this folder:

| File | Committed? | Holds |
|---|---|---|
| `../sales-config/wrangler.toml` | yes, in the host repo | Worker name, `CRM_PROVIDER` and the provider's non-secret settings |
| The shared env file named by `../automation/paths.yaml` | never (outside every repo) | The provider's secrets, plus any local overrides of the settings above |

`../automation/paths.yaml` is the host repo's per-machine pointer to its shared env file (gitignored):

```yaml
env_file: ../../safe/yourname.env
```

The path resolves from that `automation` folder. The shared file can hold keys for many services. The setup form changes only its own lines, and the local Worker gets only the keys listed under `[secrets] required` in `wrangler.toml` (plus overrides of `[vars]`).

The first `npm run dev` creates `../sales-config/` from `config-template/`. To use other locations, set `SALES_CONFIG_DIR` or `SALES_PATHS_YAML` (relative paths resolve from this folder), for example `SALES_CONFIG_DIR=../config/sales npm run dev`.

## Quick start

```bash
npm install
npm run dev
```

The terminal prints two links:

- **Settings form**: `http://localhost:8790/#t=…` (the token in the link is required; it changes each time `npm run dev` starts)
- **App**: `http://localhost:8787`

In the form, follow the first-time guide for your provider, paste the credentials, and click **Save & restart worker**. Values go to the shared env file (kept `chmod 600`) and the local worker restarts with them. Then click **Test connection**.

The form has a tab for each CRM provider. ✓ marks the one in use; **Use this CRM** switches the local Worker to another (deploys use `CRM_PROVIDER` in the host's `wrangler.toml`).

The form never loads saved secrets back into the page. A saved secret shows **✓ Saved in** the env file's name, with an empty field. Leave it blank to keep it, type a new value to replace it, or use **Remove saved value**.

The page calls the API with relative paths, so it also works when a host mounts it under a path such as `/sales/`.

If the host repo's `AGENTS.md` has a "Start Sites" section, `npm run dev` tells the local Worker (`AGENT_START_COMMAND`), and a missing-settings message suggests asking your agent to "start sites" to open the settings form. Deployed copies never show it.

## Settings

| Setting | Secret | Where it comes from |
|---|---|---|
| `CRM_PROVIDER` | no | Which provider module to use. Default `salesforce`. |
| `REPORT_CACHE_SECONDS` | no | How long report results are cached. Default `300`. |

### Salesforce provider

| Setting | Secret | Where it comes from |
|---|---|---|
| `SF_INSTANCE_URL` | no | Your My Domain URL (`https://yourdomain.my.salesforce.com`) |
| `SF_REPORT_ID` | no | The ID in the report URL, after `/Report/` |
| `SF_API_VERSION` | no | Reports API version. Default `v62.0`. |
| `SF_CLIENT_ID` | yes | External Client App › Settings › OAuth Settings › Consumer Key |
| `SF_CLIENT_SECRET` | yes | Same page, Consumer Secret |

The External Client App needs the **Client Credentials Flow** enabled with a **Run As** user. That user needs API access, read access to the report's objects, and access to the report's folder. An API-only integration user with a narrow permission set is the safest choice.

Synchronous report runs return at most **2,000 rows**. The page shows a notice when a report is truncated.

## Adding a provider

1. Add `src/providers/<name>.js` exporting the shape described at the top of `src/providers/index.js`, and register it there.
2. Prefix its settings with the CRM's name (like `SF_`), so they can't collide with other keys in a shared env file.
3. In a host's `wrangler.toml`, set `CRM_PROVIDER` and list the provider's secrets under `[secrets] required`.

## Deploying

Deploys run from the host repo, since that's where the config lives. Copy `config-template/deploy.yml` to the host repo's `.github/workflows/` (for example `sales-deploy.yml`), and adjust `APP_DIR`, `CONFIG_DIR` and the secret names if needed. It deploys on pushes to `main` that touch the app or its config, and sends the secrets to Cloudflare with the deploy.

1. In the host repo on GitHub, create an Environment named `production` (Settings › Environments).
2. Add `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` to it.
3. Copy the provider's secrets from the shared env file:
   ```bash
   npm run secrets:push -- --env production
   ```
   This sets the secrets on the repo that holds the config folder. It uses the GitHub CLI (`gh auth login` first) and sends values over stdin, never as command arguments.

Non-secret settings deploy from the config folder's `wrangler.toml`. `secrets:push` warns you if the shared env file overrides one of them.

> **Protect the deployed app.** It shows CRM data to anyone who can reach it. Put it behind **Cloudflare Access** (Zero Trust › Access › Applications) before sharing the URL.

## Working with AI agents

- `AGENTS.md` has the project rules, including never reading the shared env file.
- `.mcp.json` registers the Salesforce DX MCP server. Run `sf org login web --set-default` so an agent can inspect report and object metadata while you build new views.

## Commands

| | |
|---|---|
| `npm run dev` | Settings form + local worker |
| `npm test` | Report parser, provider and env file tests |
| `npm run secrets:push` | Copy the provider's secrets to GitHub Actions |
| `npm run deploy` | Manual deploy with the config folder (normally CI does this) |
