// Env file reader/writer that preserves comments and unrelated keys, plus validation of the
// settings a provider declares (see src/providers/).

const SECTION = "# CRM report settings —";

export function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { lines, values };
}

// updates: { KEY: "value" } sets, { KEY: null } removes.
export function serializeEnv({ lines }, updates) {
  const pending = { ...updates };
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in pending) {
      const v = pending[m[1]];
      delete pending[m[1]];
      if (v !== null) out.push(`${m[1]}="${v}"`);
      continue;
    }
    out.push(line);
  }
  const added = Object.entries(pending).filter(([, v]) => v !== null);
  if (added.length && !out.some((l) => l.startsWith(SECTION))) {
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`${SECTION} written by the \`npm run dev\` setup form. Never commit this file.`);
  }
  for (const [k, v] of added) out.push(`${k}="${v}"`);
  return out.join("\n") + "\n";
}

// Blank values mean "leave unchanged". Returns only real changes.
// fields: the provider's settings ({ key, pattern, hint }).
export function validate(values, clear, fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const updates = {};
  const errors = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const field = byKey.get(key);
    if (!field) { errors.push({ key, message: "Unknown setting" }); continue; }
    const v = String(raw ?? "").trim().replace(/\/+$/, "");
    if (!v) continue;
    if (/[\r\n"'\\`$]/.test(v) || !field.pattern.test(v)) { errors.push({ key, message: field.hint }); continue; }
    updates[key] = v;
  }
  for (const key of clear || []) {
    if (!byKey.has(key)) errors.push({ key, message: "Unknown setting" });
    else if (!(key in updates)) updates[key] = null;
  }
  return { updates, errors };
}
