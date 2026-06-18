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
  // Phase 477: per-item restock อยู่ใน nested restockProduct(prod, ...) — ตัวแปรเปลี่ยน product → prod
  //   invariant คงเดิม: warehouse branch → optimistic local sum (ไม่เขียน products ตรง); else → CAS add
  // targetWs branch → optimistic local sum; else (no warehouse) → direct write
  assert.match(body, /if \(targetWs\) \{[\s\S]*?prod\.stock = \(state\.warehouseStock/, "warehouse branch optimistic local sum");
  // Phase 410: legacy direct write ต้องผ่าน CAS (_atomicAddStock) — ห้าม absolute xhrPatch จาก cache
  const elseBranch = body.slice(body.indexOf("} else {", body.indexOf("if (targetWs) {")));
  assert.match(elseBranch, /_atomicAddStock\("products", prod\.id, qty\)/, "no-warehouse branch writes products via CAS");
  assert.ok(!/xhrPatch\("products"/.test(body), "no absolute products patch anywhere in revert");
});

// ── Phase 479 (audit S2) — saveProduct + CSV import stop writing derived products.stock ──
// products.stock = sum(warehouse_stock) is owned by the Phase 403 trigger. saveProduct/CSV used to
// write it directly (always), which overstates products.stock when a warehouse write fails → oversell.
// This locks: direct totalStock write survives ONLY in the no-warehouse legacy branch; min_stock
// (NOT trigger-derived) is still maintained; CSV carries neither stock nor min_stock.
const products = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

test("saveProduct writes products.stock directly ONLY in the no-warehouse legacy branch", () => {
  const body = fnBody(main, "async function saveProduct(", "const CUSTOMER_TAG_PRESETS");
  // old always-on pattern is gone (it overstated products.stock on warehouse write fail)
  assert.ok(!/stock:\s*productType === "service" \? 0 : totalStock/.test(body),
    "old unconditional payload.stock = totalStock pattern removed");
  // totalStock → products.stock happens ONLY behind the no-warehouse guard, and nowhere else
  assert.match(body, /if \(!hasWarehouse\) payload\.stock = totalStock/,
    "totalStock written to products only when the product has no warehouse (trigger 403 owns it otherwise)");
  const totalStockWrites = body.match(/payload\.stock = totalStock/g) || [];
  assert.equal(totalStockWrites.length, 1, "exactly one totalStock → products.stock write (legacy branch only)");
  // new warehouse product seeds 0 (never totalStock) so a possible NOT NULL column still inserts
  assert.match(body, /\{ \.\.\.payload, stock: 0 \}/, "new warehouse product seeds stock:0; trigger overwrites");
  // min_stock is NOT trigger-derived → still maintained client-side (low-stock 'all' view reads it)
  assert.match(body, /payload\.min_stock = totalMinStock/, "min_stock still written directly");
  assert.match(body, /trigger 403/, "documents trigger 403 ownership of products.stock");
});

test("CSV import payload carries neither stock nor min_stock (master-data only)", () => {
  const body = fnBody(products, "let imported = 0", "clearTypeCache();");
  assert.ok(!/stock:\s*Number\(getVal\(row, COL\.stock\)/.test(body),
    "CSV payload must not write products.stock (upsert would overwrite warehouse-derived value)");
  assert.ok(!/min_stock:\s*Number\(getVal\(row, COL\.minStock\)/.test(body),
    "CSV payload must not write products.min_stock directly on import");
});
