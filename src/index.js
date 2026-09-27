import { getProvider, CrmError } from "./providers/index.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

async function handleReport(request, env, ctx) {
  const url = new URL(request.url);
  const provider = getProvider(env.CRM_PROVIDER);
  const ttl = Number(env.REPORT_CACHE_SECONDS || 300);
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__cache/report/${provider.id}/${encodeURIComponent(provider.cacheKey(env) || "")}`);

  if (url.searchParams.get("refresh") !== "1") {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("X-Cache", "HIT");
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  }

  const payload = { ...(await provider.runReport(env)), fetchedAt: new Date().toISOString() };
  const toCache = json(payload, 200, { "Cache-Control": `max-age=${ttl}` });
  ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
  return json(payload, 200, { "X-Cache": "MISS" });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      if (pathname === "/api/report") return await handleReport(request, env, ctx);
      if (pathname === "/api/health") {
        // Reports which settings are present — never their values.
        const provider = getProvider(env.CRM_PROVIDER);
        return json({
          ok: true,
          provider: provider.id,
          providerName: provider.name,
          instance: env.SALES_INSTANCE || null, // only set by `npm run dev`, for naming browser tabs
          configured: Object.fromEntries(provider.settings.map((s) => [s.key, Boolean(env[s.key])])),
        });
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof CrmError) {
        // SETTINGS_FORM_URL and AGENT_START_COMMAND are only set by `npm run dev` (the latter when the
        // host repo defines one), so deployed copies never show them.
        const help = err.help && { ...err.help, agentCommand: env.AGENT_START_COMMAND, settingsUrl: env.SETTINGS_FORM_URL };
        return json({ error: err.message, detail: err.detail, help }, err.status);
      }
      console.error(err);
      return json({ error: "Unexpected server error" }, 500);
    }
  },
};
