// Phase 466 bundle-warehouse-deduct
// Run: node --test tests/bundle_warehouse_deduct_guard.test.js
//
// Why this exists:
//   Phase 464 lets the cashier pick a warehouse per bill and deducts from it (single products).
//   _appDeductStockSmart forwarded that warehouseId for non-bundle products but DROPPED it for
//   bundle children — bundle components fell back to the auto "home-first" heuristic. Selling a
//   bundle off TRUCK_RED then deducted its parts from HOME → per-warehouse stock diverges.
//   Phase 466 forwards warehouseId to the children loop AND the bundle-self fallbacks, so bundles
//   behave exactly like single products under Phase 464 (child not in the picked warehouse → toast
//   + not deducted, no silent wrong-warehouse deduct; no warehouse picked → unchanged home-first).
//
//   _appDeductStockSmart is a closure in main.js; assert STRUCTURE on the EXTRACTED FUNCTION BODY.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

function extractSmartBody(src) {
  const startMatch = src.match(/window\._appDeductStockSmart = async function/);
  assert.ok(startMatch, "window._appDeductStockSmart must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/Auto-link Serial Number after sale/);
  assert.ok(endMatch, "delimiter 'Auto-link Serial Number after sale' must follow");
  return src.slice(start, start + endMatch.index);
}

const body = extractSmartBody(main);

test("every _deductStockForSaleItem call inside _appDeductStockSmart forwards warehouseId", () => {
  const calls = body.match(/_deductStockForSaleItem\(\{[^}]*\}/g) || [];
  // non-bundle + 3 fallbacks (fetch-fail / no-children / catch) + children loop = 5
  assert.ok(calls.length >= 5, `expected >=5 _deductStockForSaleItem calls, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /warehouseId/, `call must forward warehouseId — missing in: ${c}`);
  }
});

test("bundle children loop forwards the picked warehouseId", () => {
  assert.match(
    body,
    /product: childProd[\s\S]{0,160}warehouseId/,
    "children deduct must include warehouseId so a per-bill warehouse pick applies to bundle parts"
  );
});

test("regression: no auto (warehouseId-less) deduct remains in the bundle path", () => {
  // the old bug pattern was `_deductStockForSaleItem({ product, qty, orderNo })` with no warehouseId
  assert.ok(
    !/_deductStockForSaleItem\(\{ product, qty, orderNo \}\)/.test(body),
    "bundle-self fallback must not call _deductStockForSaleItem without warehouseId"
  );
});
