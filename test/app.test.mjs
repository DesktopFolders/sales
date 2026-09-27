import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenReport } from "../src/providers/salesforce-report.js";
import { getProvider } from "../src/providers/index.js";
import { parseEnv, serializeEnv, validate } from "../scripts/env-file.mjs";

const fields = getProvider("salesforce").settings;

const meta = {
  reportMetadata: { id: "00O000000000001", name: "Accounts", reportFormat: "TABULAR", detailColumns: ["ACCOUNT.NAME", "TYPE", "SALES"] },
  reportExtendedMetadata: {
    detailColumnInfo: {
      "ACCOUNT.NAME": { label: "Account Name", dataType: "string" },
      TYPE: { label: "Type", dataType: "picklist" },
      SALES: { label: "Annual Revenue", dataType: "currency" },
    },
  },
};

test("flattens a tabular report", () => {
  const out = flattenReport({
    ...meta,
    allData: true,
    factMap: {
      "T!T": {
        rows: [
          { dataCells: [{ label: "Acme", value: "001A" }, { label: "Customer", value: "Customer" }, { label: "$1,000", value: { amount: 1000, currency: "USD" } }] },
          { dataCells: [{ label: "Globex", value: "001B" }, { label: "Prospect", value: "Prospect" }, { label: "-", value: null }] },
        ],
      },
    },
  });
  assert.equal(out.name, "Accounts");
  assert.deepEqual(out.columns.map((c) => c.label), ["Account Name", "Type", "Annual Revenue"]);
  assert.equal(out.rowCount, 2);
  assert.equal(out.rows[0].SALES.value, 1000);
  assert.equal(out.rows[1].SALES.value, null);
  assert.equal(out.allData, true);
});

test("flattens a summary report with a Group column and flags truncation", () => {
  const out = flattenReport({
    ...meta,
    reportMetadata: { ...meta.reportMetadata, reportFormat: "SUMMARY" },
    allData: false,
    groupingsDown: { groupings: [
      { key: "0", label: "West", groupings: [] },
      { key: "1", label: "East", groupings: [] },
    ] },
    factMap: {
      "T!T": { aggregates: [{ label: "2", value: 2 }] },
      "0!T": { rows: [{ dataCells: [{ label: "Acme" }, { label: "Customer" }, { label: "$1" }] }] },
      "1!T": { rows: [{ dataCells: [{ label: "Globex" }, { label: "Prospect" }, { label: "$2" }] }] },
    },
  });
  assert.equal(out.columns[0].label, "Group");
  assert.equal(out.rowCount, 2);
  assert.deepEqual(out.rows.map((r) => r.__group.label).sort(), ["East", "West"]);
  assert.equal(out.allData, false);
});

test("env file round-trip keeps comments and unrelated keys", () => {
  const parsed = parseEnv('# mine\nOTHER=1\nSF_CLIENT_ID="old"\n');
  const text = serializeEnv(parsed, { SF_CLIENT_ID: "new", SF_CLIENT_SECRET: "abc" });
  assert.match(text, /# mine/);
  assert.match(text, /OTHER=1/);
  assert.match(text, /SF_CLIENT_ID="new"/);
  assert.doesNotMatch(text, /old/);
  assert.equal(parseEnv(text).values.SF_CLIENT_SECRET, "abc");
  assert.doesNotMatch(serializeEnv(parseEnv(text), { SF_CLIENT_SECRET: null }), /SF_CLIENT_SECRET/);
});

test("validation: blanks are ignored, bad values and unknown keys rejected", () => {
  const good = validate({ SF_CLIENT_ID: "", SF_INSTANCE_URL: "https://yourdomain.my.salesforce.com/" }, [], fields);
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.updates, { SF_INSTANCE_URL: "https://yourdomain.my.salesforce.com" });

  const bad = validate({ SF_INSTANCE_URL: "https://yourdomain.lightning.force.com", SF_CLIENT_SECRET: 'abc"\nX=1', EVIL: "x" }, [], fields);
  assert.deepEqual(bad.errors.map((e) => e.key).sort(), ["EVIL", "SF_CLIENT_SECRET", "SF_INSTANCE_URL"]);
});

test("unknown CRM_PROVIDER is rejected; default is salesforce", () => {
  assert.equal(getProvider(undefined).id, "salesforce");
  assert.throws(() => getProvider("nope"), /Unknown CRM_PROVIDER/);
});
