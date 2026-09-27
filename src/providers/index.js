// CRM providers. Each one exports the same shape:
//   id, name                  - "salesforce", "Salesforce"
//   settings                  - [{ key, secret, label, placeholder, pattern, hint, help(links) }]
//   links(values)             - URLs used in help text, from the non-secret settings
//   guide(links)              - { title, html } first-time setup steps for the settings form
//   cacheKey(env)             - identifies the report, for the Worker's response cache
//   runReport(env)            - { id, name, columns, rows, rowCount, allData, notice, sourceUrl, sourceName }
// The Worker and settings form pick one with the CRM_PROVIDER setting.
import { salesforce } from "./salesforce.js";
import { CrmError } from "./errors.js";

export { CrmError };
export const DEFAULT_PROVIDER = "salesforce";
export const PROVIDERS = { [salesforce.id]: salesforce };

export function getProvider(name) {
  const provider = PROVIDERS[String(name || DEFAULT_PROVIDER).toLowerCase()];
  if (!provider) throw new CrmError(`Unknown CRM_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}.`, 500);
  return provider;
}
