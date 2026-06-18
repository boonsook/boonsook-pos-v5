// Phase 474 saveProduct-integrity (no silent warehouse-write failure / no NaN corruption / bundle checked)
// Run: node --test tests/save_product_integrity_guard.test.js
//
// Why this exists (from the สินค้า/คลัง page audit):
//   saveProduct wrote warehouse_stock + product fields but: (a) ignored every warehouse_stock write
//   result → a failed write (RLS/network) was swallowed while showing "saved"; (b) parsed numbers
//   with Number(v||0), so a typo like "5ก" became NaN → null/corrupt cost/stock; (c) synced bundle
//   children with fire-and-forget fetch → a failed INSERT after the DELETE silently emptied the bundle.
//   Phase 474 fixes all three (warn on failure, NaN-safe non-negative parse, bundle result checked).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function saveBody(src) {
  const i = src.indexOf("async function saveProduct()");
  assert.ok(i >= 0, "saveProduct must exist");
  const e = src.indexOf("CUSTOMER DRAWER", i);
  return src.slice(i, e === -1 ? i + 6000 : e);
}
const sb = saveBody(main);

test("numbers are parsed NaN-safe and non-negative (no null/corrupt writes from a typo)", () => {
  assert.match(sb, /const _n0 = \(v\) => \{ const n = Number\(v\); return Number\.isFinite\(n\) \? Math\.max\(0, n\)/, "NaN-safe parse helper present");
  // Phase 484: price/cost still use the NaN-safe _n0, now wrapped in round2 (2dp money)
  assert.match(sb, /price:round2\(_n0\(/, "price uses the safe parse (round2-wrapped)");
  assert.match(sb, /cost:round2\(_n0\(/, "cost uses the safe parse (round2-wrapped)");
  assert.match(sb, /const stock = _n0\(/, "warehouse stock input uses the safe parse");
});

test("warehouse_stock write results are checked and a failure is surfaced (not silent)", () => {
  assert.match(sb, /const _whFails = \[\]/, "collects failed warehouse writes");
  assert.match(sb, /if \(!_r\?\.ok\) _whFails\.push/, "pushes on a failed write");
  assert.match(sb, /บันทึกสต็อกบางคลังไม่สำเร็จ/, "warns the user when a warehouse write failed");
});

test("bundle child sync checks its result (no silent empty-bundle on a failed insert)", () => {
  assert.match(sb, /const _ins = await fetch/, "captures the bundle INSERT result");
  assert.match(sb, /if \(!_ins\.ok\) showToast/, "warns when the bundle INSERT failed");
});
