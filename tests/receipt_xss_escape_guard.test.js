// Phase 530 — Receipt XSS escape guard
// Run: npm test
//
// Stored-XSS sink: renderReceiptDrawer (main.js) builds the "ใบเสร็จล่าสุด"
// HTML by interpolating dynamic leaf values straight into innerHTML via
// setHtml("receiptContent", `...`). The web-order branch is the dangerous one:
// j.customer_name / j.customer_phone / j.customer_address / j.description come
// from the public web-order form (modules/ai_sales.js → service_jobs) — i.e.
// an *external customer types them* — and then execute in the admin/staff
// session when the receipt drawer is opened.
//
// Fix (Phase 530): wrap every dynamic leaf value with escapeHtml (escHtml from
// utils.js) in BOTH the web-order branch and the POS branch. money()/dates/
// constant label maps/structural HTML are NOT escaped (trusted / would break
// layout). This guard locks that invariant: each risky field must be wrapped,
// and the raw (un-escaped) interpolation must be gone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { escHtml } from "../modules/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainJs = readFileSync(join(__dirname, "..", "main.js"), "utf8");

// ───────────────────────────────────────────────
// 1. Behavioral — escHtml neutralises real payloads
// ───────────────────────────────────────────────

test("escHtml neutralises script/event-handler payloads (no raw < or \")", () => {
  for (const payload of [
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(1)>`,
    `"><script>alert(1)</script>`,
  ]) {
    const out = escHtml(payload);
    assert.ok(!out.includes("<"), `raw < must not survive: ${payload}`);
    assert.ok(!out.includes(">"), `raw > must not survive: ${payload}`);
    assert.ok(!out.includes('"'), `raw " must not survive: ${payload}`);
    assert.ok(/&lt;|&gt;|&quot;|&#039;/.test(out), `must produce entities: ${payload}`);
  }
});

// ───────────────────────────────────────────────
// 2. Source-regex — extract renderReceiptDrawer body and assert each
//    risky leaf field is escapeHtml-wrapped (and the raw form is gone).
//    Covers BOTH the web-order branch and the POS branch.
// ───────────────────────────────────────────────

const start = mainJs.indexOf("function renderReceiptDrawer()");
const end = mainJs.indexOf("async function _fillReceiptAcctTrace", start);
const body = (start !== -1 && end > start) ? mainJs.slice(start, end) : "";

// Fields that MUST appear escapeHtml-wrapped.
const mustBeWrapped = [
  // shop info (both branches)
  /\$\{\s*escapeHtml\(si\.name/,
  /escapeHtml\(si\.address/,
  /"โทร: "\s*\+\s*escapeHtml\(si\.phone/,
  /escapeHtml\(si\.taxId/,
  // web-order branch (customer-controlled — highest risk)
  /\$\{\s*escapeHtml\(j\.job_no/,
  /\$\{\s*escapeHtml\(j\.customer_name/,
  /\$\{\s*escapeHtml\(j\.customer_phone/,
  /\$\{\s*escapeHtml\(j\.customer_address/,
  /escapeHtml\(j\.status\)/,        // fallback only — statusLabels map stays raw
  /\$\{\s*escapeHtml\(line\)/,       // item lines from j.description
  // POS branch
  /\$\{\s*escapeHtml\(lastSale\.order_no/,
  /\$\{\s*escapeHtml\(lastSale\.customer_name/,
  /\$\{\s*escapeHtml\(lastSale\.payment_method/,
  /\$\{\s*escapeHtml\(i\.product_name/,
];
// Raw (un-escaped) interpolations that MUST be gone.
const mustNotBeRaw = [
  /\$\{\s*j\.job_no/,
  /\$\{\s*j\.customer_name/,
  /\$\{\s*j\.customer_phone/,
  /\$\{\s*j\.customer_address/,
  /\|\|\s*j\.status\s*\|\|/,        // raw `|| j.status ||` fallback
  /\$\{\s*line\s*\}/,
  /\$\{\s*lastSale\.order_no\s*\}/,
  /\$\{\s*lastSale\.customer_name\s*\|/,
  /\$\{\s*lastSale\.payment_method\s*\|/,
  /\$\{\s*i\.product_name\s*\}/,
  /\$\{\s*i\.qty\s*\}/,             // qty must go through Number()
];
test("renderReceiptDrawer escapes every dynamic leaf field (source guard)", () => {
  assert.notEqual(start, -1, "renderReceiptDrawer() must exist");
  assert.ok(end > start, "function boundary must be found");
  for (const re of mustBeWrapped) {
    assert.match(body, re, `receipt field must be escapeHtml-wrapped: ${re}`);
  }
  for (const re of mustNotBeRaw) {
    assert.ok(!re.test(body), `raw un-escaped sink must be gone: ${re}`);
  }
});
