// Salesforce provider: OAuth 2.0 Client Credentials flow + Reports REST API.
// The access token lives only in this isolate's memory; it is never sent to the browser.

import { CrmError } from "./errors.js";
import { flattenReport } from "./salesforce-report.js";

let cachedToken = null; // { accessToken, instanceUrl, fetchedAt }
const TOKEN_TTL_MS = 25 * 60 * 1000; // SF doesn't return expires_in here; refresh well before typical session timeout
const REPORT_ID = /^00O[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lightningHost = (instanceUrl) =>
  String(instanceUrl || "").replace(/\/+$/, "").replace(/\.my\.salesforce\.com$/, ".lightning.force.com") || "https://login.salesforce.com";

// Where the Consumer Key and Secret are shown: Setup › External Client App Manager › your app › Settings.
function consumerKeyHelp(env) {
  return {
    title: "Get the Consumer Key and Secret in Salesforce:",
    text: "External Client App Manager › your app › Settings › OAuth Settings › Consumer Key and Secret",
    link: "Get It",
    url: `${lightningHost(env.SF_INSTANCE_URL)}/lightning/setup/ManageExternalClientApplication/home`,
  };
}

function requireConfig(env) {
  const missing = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) {
    const help = missing.some((k) => k.startsWith("SF_CLIENT_")) ? consumerKeyHelp(env) : undefined;
    throw new CrmError(`Missing configuration: ${missing.join(", ")}.`, 500, undefined, help);
  }
  return env.SF_INSTANCE_URL.replace(/\/+$/, "");
}

async function getToken(env, { force = false } = {}) {
  if (!force && cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) return cachedToken;

  const base = requireConfig(env);
  let res;
  try {
    res = await fetch(`${base}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.SF_CLIENT_ID,
        client_secret: env.SF_CLIENT_SECRET,
      }),
    });
  } catch (err) {
    throw new CrmError(`Could not reach ${base} — check SF_INSTANCE_URL and your network`, 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    cachedToken = null;
    // Only pass through Salesforce's error code/description, never credentials.
    throw new CrmError("Salesforce authentication failed", 502, {
      status: res.status,
      error: body.error,
      error_description: body.error_description || (res.headers.get("content-type")?.includes("json") ? undefined : "Non-JSON response — is SF_INSTANCE_URL your My Domain URL?"),
    });
  }
  cachedToken = { accessToken: body.access_token, instanceUrl: body.instance_url || base, fetchedAt: Date.now() };
  return cachedToken;
}

async function sfGet(env, path) {
  for (const force of [false, true]) {
    const token = await getToken(env, { force });
    const res = await fetch(`${token.instanceUrl}${path}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
    });
    if (res.status === 401 && !force) continue; // token expired/revoked: refresh once
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const first = Array.isArray(body) ? body[0] : body;
      throw new CrmError("Salesforce API request failed", res.status === 404 ? 404 : 502, {
        status: res.status,
        errorCode: first?.errorCode,
        message: first?.message,
      });
    }
    return body;
  }
}

export const salesforce = {
  id: "salesforce",
  name: "Salesforce",

  settings: [
    {
      key: "SF_INSTANCE_URL",
      secret: false,
      label: "Instance URL (My Domain)",
      placeholder: "https://yourdomain.my.salesforce.com",
      pattern: /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.my\.salesforce\.com$/i,
      hint: "Must be your My Domain URL, e.g. https://yourdomain.my.salesforce.com (not the lightning.force.com address).",
      help: (L) => `Your org's My Domain URL ending in <code>.my.salesforce.com</code>. Find it on <a href="${esc(L.myDomain)}" target="crm">Setup › My Domain ↗</a>. It's the report link's host with <code>lightning.force.com</code> swapped for <code>my.salesforce.com</code>.`,
    },
    {
      key: "SF_CLIENT_ID",
      secret: true,
      label: "Consumer Key",
      placeholder: "3MVG9…",
      pattern: /^[A-Za-z0-9._]{20,300}$/,
      hint: "The Consumer Key is a long string of letters, digits and dots.",
      help: (L) => `From your External Client App: <a href="${esc(L.setup)}" target="crm">Setup ↗</a> › External Client App Manager › your app › Settings › OAuth Settings › <em>Consumer Key and Secret</em>.`,
    },
    {
      key: "SF_CLIENT_SECRET",
      secret: true,
      label: "Consumer Secret",
      placeholder: "",
      pattern: /^[A-Za-z0-9]{16,300}$/,
      hint: "The Consumer Secret is a long string of letters and digits.",
      help: (L) => `Shown next to the Consumer Key on the same page (<a href="${esc(L.setup)}" target="crm">Setup ↗</a> › External Client App Manager › your app › Settings).`,
    },
    {
      key: "SF_REPORT_ID",
      secret: false,
      label: "Report ID",
      placeholder: "00O…",
      pattern: REPORT_ID,
      hint: "Report IDs start with 00O and are 15 or 18 characters.",
      help: (L) => `The 15-character ID in the report's URL, after <code>/Report/</code>.${L.report ? ` Currently: <a href="${esc(L.report)}" target="crm">open the report ↗</a>.` : ""}`,
    },
  ],

  links(values) {
    const host = lightningHost(values.SF_INSTANCE_URL);
    return {
      setup: `${host}/lightning/setup/SetupOneHome/home`,
      myDomain: `${host}/lightning/setup/OrgDomain/home`,
      report: values.SF_REPORT_ID ? `${host}/lightning/r/Report/${encodeURIComponent(values.SF_REPORT_ID)}/view` : "",
    };
  },

  guide(L) {
    return {
      title: "First time? Create the External Client App in Salesforce",
      html: `<ol>
      <li>Open <a href="${esc(L.setup)}" target="crm">Setup ↗</a>, type <strong>External Client App Manager</strong> in Quick Find, and click <strong>New External Client App</strong>.</li>
      <li>Under <strong>API (Enable OAuth Settings)</strong>, check <strong>Enable OAuth</strong>, enter any callback URL (e.g. <code>http://localhost</code> — this flow doesn't use it), and add the scope <strong>Manage user data via APIs (api)</strong>.</li>
      <li>Under <strong>Flow Enablement</strong>, check <strong>Enable Client Credentials Flow</strong>, then save.</li>
      <li>On the app's <strong>Policies</strong> tab, click Edit, enable <strong>Client Credentials Flow</strong> and set <strong>Run As</strong> to an integration user. That user needs API access, read access to the report's objects, and access to the folder that holds the report.</li>
      <li>On the <strong>Settings</strong> tab, expand <strong>OAuth Settings</strong> and click <strong>Consumer Key and Secret</strong> (Salesforce will verify your identity). Paste them below.</li>
    </ol>
    <p class="help" style="margin:10px 0 0">Reference: <a href="https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_client_credentials_flow.htm&amp;type=5" target="crm-help">OAuth 2.0 Client Credentials Flow (Salesforce Help) ↗</a>. New apps can take a few minutes to become active.</p>`,
    };
  },

  cacheKey: (env) => env.SF_REPORT_ID,

  async runReport(env) {
    const reportId = env.SF_REPORT_ID;
    if (!REPORT_ID.test(reportId || "")) throw new CrmError("Invalid or missing SF_REPORT_ID", 400);
    const version = env.SF_API_VERSION || "v62.0";
    // Synchronous run with detail rows. Salesforce caps synchronous runs at 2,000 detail rows.
    const raw = await sfGet(env, `/services/data/${version}/analytics/reports/${reportId}?includeDetails=true`);
    const report = flattenReport(raw);
    return {
      ...report,
      notice: report.allData ? null : `Salesforce returned the first ${report.rowCount} rows only (2,000-row limit for synchronous report runs).`,
      sourceName: "Salesforce",
      sourceUrl: `${lightningHost(env.SF_INSTANCE_URL)}/lightning/r/Report/${reportId}/view`,
    };
  },
};
