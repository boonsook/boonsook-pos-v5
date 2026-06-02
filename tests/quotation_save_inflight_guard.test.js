// Phase 356 — quotation-save-inflight-guard
// Run: node --test tests/quotation_save_inflight_guard.test.js
//
// Contract: saveQuotationFull() must guard against rapid/double-click submits creating
// duplicate quotations. A module-level inflight flag short-circuits re-entry, the save
// button is disabled while saving, and a try/finally guarantees the flag + button are
// restored even when xhrPost/xhrPatch/loadAllData throw. The guard must NOT change save
// semantics, must not touch service_jobs/stock/POS/cart/products/schema, and must keep the
// Phase 355 air-job note link-back intact.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const quo = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");
// isolate the saveQuotationFull body for structural assertions
const start = quo.indexOf("async function saveQuotationFull()");
const end = quo.indexOf("async function openEditForm");
assert.ok(start > -1 && end > start, "saveQuotationFull must exist before openEditForm");
const fn = quo.slice(start, end);

// ── module-level inflight flag ──────────────────────────────────────────────
test("a module-level inflight flag exists, default false", () => {
  assert.match(quo, /let _qtSaveInflight = false/);
});

// ── re-entry is blocked; flag set only after preliminary validation ─────────
test("saveQuotationFull early-returns when a save is already inflight", () => {
  assert.match(fn, /if \(_qtSaveInflight\) return _ctx\.showToast\(/);
});

test("the flag is set true AFTER the customer/line-item validation (so failed validation never locks it)", () => {
  const custCheck = fn.indexOf('if (!customerName)');
  const itemsCheck = fn.indexOf('if (!_lineItems.length)');
  const setFlag = fn.indexOf('_qtSaveInflight = true');
  assert.ok(custCheck > -1 && itemsCheck > -1 && setFlag > -1, "validation + flag set must all be present");
  assert.ok(setFlag > custCheck && setFlag > itemsCheck, "_qtSaveInflight=true must come after both validation guards");
});

// ── button disabled during save ─────────────────────────────────────────────
test("the save button is disabled before saving", () => {
  // disable the qtSaveBtn element before the try-body runs
  assert.match(fn, /getElementById\("qtSaveBtn"\)[\s\S]{0,40}?disabled = true/);
});

// ── try/finally guarantees reset of flag + button ───────────────────────────
test("saveQuotationFull wraps the save in try { ... } finally { ... }", () => {
  assert.match(fn, /\n {2}try \{[\s\S]*\n {2}\} finally \{[\s\S]*\n {2}\}\n\}/);
});

test("the finally block resets the inflight flag and re-enables the button", () => {
  const finallyIdx = fn.indexOf("} finally {");
  const tail = fn.slice(finallyIdx);
  assert.match(tail, /_qtSaveInflight = false/);
  assert.match(tail, /getElementById\("qtSaveBtn"\)/);
  assert.match(tail, /disabled = false/);
});

// ── the actual save (xhrPost/xhrPatch) sits INSIDE the try ──────────────────
test("the network save runs inside the try block (so a throw still resets the guard)", () => {
  const tryIdx = fn.indexOf("\n  try {");
  const finallyIdx = fn.indexOf("} finally {");
  const body = fn.slice(tryIdx, finallyIdx);
  assert.match(body, /xhrPost\("quotations"/);
  assert.match(body, /xhrPatch\("quotations"/);
  assert.match(body, /loadAllData\(\)/);
});

// ── save semantics unchanged: Phase 355 link-back still applied ─────────────
test("Phase 355 air-job note link-back is still applied on save", () => {
  assert.match(fn, /note: appendAirJobNoteRef\(document\.getElementById\("qt_note"\)\?\.value\?\.trim\(\) \|\| "", _airDraftMeta\)/);
});

test("the auto QT-number logic and quotation_items insert are unchanged", () => {
  assert.match(fn, /payload\.qt_no = "QT" \+ ds \+/);
  assert.match(fn, /xhrPost\("quotation_items"/);
});

// ── guard touches nothing forbidden ─────────────────────────────────────────
test("the save flow never writes to service_jobs / stock / POS / cart / products", () => {
  for (const banned of [
    /xhrPost\(\s*["']service_jobs/, /xhrPatch\(\s*["']service_jobs/, /rest\/v1\/service_jobs/,
    /addToCart/, /saveCustCart/, /_custCart/, /\.stock\s*=/, /from\(["']products["']\)/
  ]) {
    assert.ok(!banned.test(quo), `quotations.js must not reference ${banned}`);
  }
});

test("no schema/SQL change — guard is pure client state (no ALTER/CREATE TABLE)", () => {
  assert.ok(!/ALTER TABLE|CREATE TABLE/i.test(quo), "no SQL DDL in quotations.js");
});
