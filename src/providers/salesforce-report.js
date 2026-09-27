// Turns a Salesforce Reports API response into the flat table every provider returns.
// Handles tabular reports (rows in factMap["T!T"]) and summary reports
// (rows under grouping keys like "0!T", "0_1!T"), adding a "Group" column for the latter.

export function flattenReport(raw) {
  const meta = raw.reportMetadata || {};
  const colInfo = raw.reportExtendedMetadata?.detailColumnInfo || {};
  const detailColumns = meta.detailColumns || [];

  const columns = detailColumns.map((key) => ({
    key,
    label: colInfo[key]?.label || key,
    type: colInfo[key]?.dataType || "string",
  }));

  // Map grouping keys ("0", "0_1") -> human label path ("West › Acme").
  const groupLabels = {};
  (function walk(groupings = [], prefix = []) {
    for (const g of groupings) {
      const path = [...prefix, g.label ?? String(g.value ?? "")];
      groupLabels[g.key] = path.join(" › ");
      walk(g.groupings, path);
    }
  })(raw.groupingsDown?.groupings);

  const hasGroups = Object.keys(groupLabels).length > 0;
  const rows = [];
  for (const [factKey, fact] of Object.entries(raw.factMap || {})) {
    if (!Array.isArray(fact.rows) || fact.rows.length === 0) continue;
    const groupKey = factKey.split("!")[0];
    for (const r of fact.rows) {
      const row = {};
      (r.dataCells || []).forEach((cell, i) => {
        const col = columns[i];
        if (col) row[col.key] = { label: cell.label ?? "", value: normalizeValue(cell.value) };
      });
      if (hasGroups) row.__group = { label: groupLabels[groupKey] || "", value: groupKey };
      rows.push(row);
    }
  }

  if (hasGroups) columns.unshift({ key: "__group", label: "Group", type: "string" });

  return {
    id: meta.id,
    name: meta.name || "Report",
    format: meta.reportFormat,
    columns,
    rows,
    rowCount: rows.length,
    // false when Salesforce truncated the synchronous run (2,000 row cap)
    allData: raw.allData !== false,
  };
}

function normalizeValue(v) {
  if (v && typeof v === "object") {
    if ("amount" in v) return v.amount; // currency
    return v.label ?? v.id ?? null; // lookup-ish objects
  }
  return v ?? null;
}
