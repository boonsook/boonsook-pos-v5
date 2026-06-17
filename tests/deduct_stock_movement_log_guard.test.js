// Phase 465 fix-deduct-phantom-movement-on-cas-fail
// Run: node --test tests/deduct_stock_movement_log_guard.test.js
//
// Why this exists:
//   _deductStockForSaleItem (main.js; the POS sale stock-deduct path, also wrapped by
//   _appDeductStockSmart for bundles) logged a stock_movements type:"sale" row UNCONDITIONALLY
//   — even when the CAS decrement failed (insufficient stock / RLS / network). warehouse_stock
//   itself stays correct (the CAS floor refuses the negative write), but the ledger then carries
//   a phantom "sale -qty" movement that never happened → stock_reconcile_report and sale-qty
//   analytics diverge from warehouse_stock.
//   The sibling _applyStockMovement already returns BEFORE logging on insufficient (Phase 369);
//   Phase 465 brings the POS sale path in line: each stock_movements insert is gated on the
//   matching success flag (dec.ok for the warehouse branch, dec2.ok for the legacy branch).
//
//   _deductStockForSaleItem is a closure inside main.js over module-scoped state/xhr helpers, so
//   behavior-level mocking is impractical. We assert STRUCTURE on the EXTRACTED FUNCTION BODY ONLY
//   (not whole main.js) to avoid false positives from xhrPost("stock_movements") used elsewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// Extract just the _deductStockForSaleItem body: from its declaration up to the next
// top-level declaration (_revertStockForSale). Keeps every assertion scoped to the function.
function extractDeductBody(src) {
  const startMatch = src.match(/async function _deductStockForSaleItem\(/);
  assert.ok(startMatch, "function _deductStockForSaleItem must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/\nasync function _revertStockForSale\(/);
  assert.ok(endMatch, "delimiter 'async function _revertStockForSale' must follow");
  return src.slice(start, start + endMatch.index);
}

const body = extractDeductBody(main);

test("warehouse-branch sale movement is logged only when the CAS decrement succeeded", () => {
  assert.match(
    body,
    /if \(dec\.ok\) \{[\s\S]{0,250}xhrPost\("stock_movements"/,
    "warehouse-branch stock_movements insert must sit inside `if (dec.ok)`"
  );
});

test("legacy (no-warehouse) sale movement is logged only when the products CAS succeeded", () => {
  assert.match(
    body,
    /if \(dec2\.ok\) \{[\s\S]{0,250}xhrPost\("stock_movements"/,
    "legacy-branch stock_movements insert must sit inside `if (dec2.ok)`"
  );
});

test("regression: every stock_movements insert is gated by a success check (no unconditional log)", () => {
  const gate1 = body.indexOf("if (dec.ok) {");
  const log1 = body.indexOf('xhrPost("stock_movements"');
  const gate2 = body.indexOf("if (dec2.ok) {");
  const log2 = body.indexOf('xhrPost("stock_movements"', log1 + 1);

  assert.ok(gate1 > -1, "warehouse success gate `if (dec.ok) {` must exist");
  assert.ok(log1 > gate1, "warehouse movement log must come AFTER its dec.ok gate");
  assert.ok(gate2 > -1, "legacy success gate `if (dec2.ok) {` must exist");
  assert.ok(log2 > gate2, "legacy movement log must come AFTER its dec2.ok gate");

  // exactly two sale-movement inserts in this function (warehouse + legacy) — no more, no less
  const count = (body.match(/xhrPost\("stock_movements"/g) || []).length;
  assert.equal(count, 2, `expected exactly 2 stock_movements inserts in _deductStockForSaleItem, found ${count}`);
});

test('success path still logs a type:"sale" movement (logging was gated, not removed)', () => {
  assert.match(body, /type:\s*"sale"/, "sale movement type must still be emitted on the success path");
});
