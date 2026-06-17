// Phase 467 fix-refund-reads-never-loaded-state-saleitems
// Run: node --test tests/refund_fetch_sale_items_guard.test.js
//
// Why this exists:
//   The refund flow (modules/refunds.js) read `state.saleItems` in two places — the item picker
//   (pick a bill -> list its lines) and the save-time re-validate. But loadAllData NEVER populates
//   state.saleItems (sale_items is only fetched per-bill elsewhere), so the refund cart was ALWAYS
//   empty -> nothing could be selected to refund. Phase 467 adds _fetchSaleItemsForSale(saleId)
//   (mirrors _fetchRefundsForSale) and uses it in both spots; a null return = load failed -> the
//   caller shows a toast and aborts rather than proceeding with an empty list.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/refunds.js"), "utf8");

test("refund flow no longer reads the never-populated state.saleItems", () => {
  assert.ok(!/state\.saleItems/.test(src), "refunds.js must not depend on state.saleItems (loadAllData never loads it)");
});

test("a per-bill sale_items fetch helper exists and GETs by sale_id", () => {
  assert.match(src, /async function _fetchSaleItemsForSale\(/, "_fetchSaleItemsForSale helper must exist");
  assert.match(src, /\/rest\/v1\/sale_items\?select=\*&sale_id=eq\./, "helper must GET sale_items filtered by sale_id");
});

test("both the item picker and the save re-validate fetch per bill (>=2 awaited calls)", () => {
  const calls = (src.match(/await _fetchSaleItemsForSale\(/g) || []).length;
  assert.ok(calls >= 2, `expected >=2 awaited _fetchSaleItemsForSale calls (picker + save), found ${calls}`);
});

test("a failed fetch is surfaced + aborts, not silently treated as an empty bill", () => {
  assert.match(src, /items === null/, "picker must abort + warn on fetch failure");
  assert.match(src, /saleItemsNow === null/, "save re-validate must abort + warn on fetch failure");
});
