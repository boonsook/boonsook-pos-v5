// Phase 403 — stock-mirror-canonical-sync (MONEY/STOCK §4.2)
// Run: node --test tests/stock_mirror_canonical_guard.test.js
//
// products.stock is now a DERIVED mirror of sum(warehouse_stock), kept in sync by a DB
// trigger (supabase-phase403-stock-sync-trigger.sql). The fragile JS path that wrote
// products.stock directly (and could diverge when one of the two writes failed) is removed,
// EXCEPT the legacy fallback for products that have no warehouse_stock row at all (the
// trigger never fires for them, so JS must still maintain products.stock).
//
// This guard locks: (1) the migration ships with the commit; (2) _applyStockMovement no
// longer writes products.stock directly; (3) the POS deduct + revert paths only write
// products.stock directly in their no-warehouse branch (warehouse branch defers to trigger);
// (4) warehouse_stock CAS/floor (the truth) is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// slice a top-level function body by name → next top-level boundary
function fnBody(src, startSig, endSig) {
  const a = src.indexOf(startSig);
  assert.ok(a >= 0, `cannot find ${startSig}`);
  const b = src.indexOf(endSig, a + startSig.length);
  assert.ok(b > a, `cannot find end ${endSig} after ${startSig}`);
  return src.slice(a, b);
}

test("Part A migration ships: warehouse_stock → products.stock sync trigger", () => {
  const sql = fs.readFileSync(path.resolve("supabase-phase403-stock-sync-trigger.sql"), "utf8");
  assert.match(sql, /create or replace function sync_product_stock\(\)/i, "trigger function defined");
  assert.match(sql, /update products\s+set stock = coalesce\(\(select sum\(stock\) from warehouse_stock where product_id = pid\)/i,
    "products.stock = sum(warehouse_stock) of that product");
  assert.match(sql, /after insert or update or delete on warehouse_stock/i, "fires on every warehouse_stock change");
  assert.match(sql, /update products p\s+set stock = s\.total/i, "one-time backfill present");
  assert.match(sql, /notify pgrst, 'reload schema'/i, "pgrst reload");
});

test("_applyStockMovement no longer writes products.stock directly (mirror removed)", () => {
  const body = fnBody(main, "async function _applyStockMovement(", "window._appTransferWarehouseStock");
  assert.ok(!/_atomicDecrementStock\("products"/.test(body), "no products CAS decrement in _applyStockMovement");
  assert.ok(!/_atomicAddStock\("products"/.test(body), "no products CAS add in _applyStockMovement");
  assert.ok(!/xhrPatch\("products"/.test(body), "no products patch in _applyStockMovement");
  // it still keeps an optimistic LOCAL recompute = sum(warehouseStock), and the DB-trigger note
  assert.match(body, /products\.stock = sum\(warehouse_stock\) ผ่าน DB trigger/, "documents derived-via-trigger");
  assert.match(body, /\.reduce\(\(s, w\) => s \+ Number\(w\.stock \|\| 0\), 0\)/, "optimistic local sum recompute");
});

test("_applyStockMovement keeps warehouse_stock CAS/floor (the truth) untouched", () => {
  const body = fnBody(main, "async function _applyStockMovement(", "window._appTransferWarehouseStock");
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", ws\.id, qty\)/, "warehouse floor decrement kept");
  assert.match(body, /insufficient: true/, "insufficient floor guard kept");
});

test("POS deduct writes products.stock directly ONLY in the no-warehouse legacy branch", () => {
  const body = fnBody(main, "async function _deductStockForSaleItem", "async function _revertStockForSale");
  // warehouse branch: optimistic local sum, NO direct products write
  assert.match(body, /if \(stocks\.length > 0\) \{[\s\S]*?product\.stock = \(state\.warehouseStock/,
    "warehouse branch uses optimistic local sum");
  // the only products CAS decrement must live in the else (no-warehouse / legacy) branch
  const elseBranch = body.slice(body.indexOf("} else {", body.indexOf("if (stocks.length > 0)")));
  assert.match(elseBranch, /_atomicDecrementStock\("products", product\.id, qty\)/, "legacy branch still decrements products directly");
});

test("revert writes products.stock directly ONLY when there is no warehouse row", () => {
  const body = fnBody(main, "async function _revertStockForSale", "window._appRevertStockForSale");
  // targetWs branch → optimistic local sum; else (no warehouse) → direct patch
  assert.match(body, /if \(targetWs\) \{[\s\S]*?product\.stock = \(state\.warehouseStock/, "warehouse branch optimistic local sum");
  assert.match(body, /\} else \{\s*const newStock = Number\(product\.stock \|\| 0\) \+ qty;\s*const pr2 = await xhrPatch\("products"/,
    "no-warehouse branch keeps legacy products patch");
});
