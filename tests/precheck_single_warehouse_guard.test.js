// Phase 480 — oversell precheck uses the single SOLD warehouse, not sum(all) (audit §S3)
// Run: node --test tests/precheck_single_warehouse_guard.test.js
//
// Concept: a POS sale draws from ONE warehouse per bill. In "auto" mode the deduct path picks
// home-first (else max stock); the oversell precheck used to compare qty against products.stock =
// sum(all warehouses) → a sellable bill got a false "[สต็อกไม่ครบ]" flag. Phase 480 routes BOTH
// precheck (pos.js) and deduct (main.js) through one pure helper pickAutoWarehouseStock so they
// can never drift. Legacy products with no warehouse row → null → precheck falls back to
// products.stock (= what the deduct legacy branch decrements).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pickAutoWarehouseStock } from "../modules/warehouse_pick.js";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

function deductBody(src) {
  const a = src.indexOf("async function _deductStockForSaleItem");
  assert.ok(a >= 0, "deduct fn exists");
  const b = src.indexOf("async function _revertStockForSale", a);
  return src.slice(a, b);
}

// ── pure helper behaviour ─────────────────────────────────────────────────────
const WH = [
  { id: 1, name: "คลังบ้าน (ร้านบุญสุข)", is_mobile: false },
  { id: 2, name: "รถคันขาว", is_mobile: true },
  { id: 3, name: "รถคันแดง", is_mobile: true },
];

test("home ('บ้าน') is picked when it has stock, even if a truck holds more", () => {
  const state = { warehouses: WH, warehouseStock: [
    { product_id: 10, warehouse_id: 1, stock: 3 },
    { product_id: 10, warehouse_id: 2, stock: 4 },
  ]};
  const pick = pickAutoWarehouseStock(state, 10);
  assert.equal(pick.warehouse_id, 1, "home wins");
  assert.equal(pick.stock, 3, "reports the home on-hand (3), NOT the sum (7)");
});

test("home with 0 stock → largest non-empty warehouse is picked", () => {
  const state = { warehouses: WH, warehouseStock: [
    { product_id: 10, warehouse_id: 1, stock: 0 },
    { product_id: 10, warehouse_id: 2, stock: 2 },
    { product_id: 10, warehouse_id: 3, stock: 5 },
  ]};
  const pick = pickAutoWarehouseStock(state, 10);
  assert.equal(pick.warehouse_id, 3, "max stock truck");
  assert.equal(pick.stock, 5);
});

test("no warehouse row for the product → null (caller falls back to products.stock)", () => {
  const state = { warehouses: WH, warehouseStock: [
    { product_id: 99, warehouse_id: 1, stock: 5 },
  ]};
  assert.equal(pickAutoWarehouseStock(state, 10), null);
});

test("all warehouse rows 0 → null (nothing eligible)", () => {
  const state = { warehouses: WH, warehouseStock: [
    { product_id: 10, warehouse_id: 1, stock: 0 },
    { product_id: 10, warehouse_id: 2, stock: 0 },
  ]};
  assert.equal(pickAutoWarehouseStock(state, 10), null);
});

test("does NOT mutate the caller's warehouseStock array (sorts a copy)", () => {
  const rows = [
    { product_id: 10, warehouse_id: 2, stock: 4 },
    { product_id: 10, warehouse_id: 1, stock: 3 },
  ];
  const before = rows.map(r => r.warehouse_id).join(",");
  pickAutoWarehouseStock({ warehouses: WH, warehouseStock: rows }, 10);
  assert.equal(rows.map(r => r.warehouse_id).join(","), before, "input order preserved");
});

test("string/number id tolerant (cart ids are strings, product ids are numbers)", () => {
  const state = { warehouses: WH, warehouseStock: [
    { product_id: 10, warehouse_id: 1, stock: 2 },
  ]};
  assert.equal(pickAutoWarehouseStock(state, "10").warehouse_id, 1);
});

// ── precheck (pos.js) and deduct (main.js) share the ONE helper (no drift) ─────
test("deduct auto branch picks via the shared helper (no inline home-sort to drift from precheck)", () => {
  const body = deductBody(main);
  assert.match(body, /pickAutoWarehouseStock\(state, product\.id\)/, "deduct auto-pick uses the shared helper");
  // the old hand-rolled sort must be gone from the auto branch (would drift from precheck)
  assert.ok(!/stocks\.sort\(\(a, b\) => \{[\s\S]*?aHome/.test(body), "no inline home-first sort left in deduct");
});

test("checkout precheck uses the shared helper for auto mode, the picked-warehouse stock for picked mode", () => {
  const i = pos.indexOf("async function doCheckout(");
  const cb = pos.slice(i, i + 9000);
  assert.match(pos, /import \{ pickAutoWarehouseStock \} from "\.\/warehouse_pick\.js"/, "pos imports the helper");
  assert.match(cb, /pickAutoWarehouseStock\(state, _it\.id\)/, "auto branch uses the shared helper (single warehouse, not sum)");
  assert.match(cb, /_posWhStock\(state, _it\.id, _posWarehouseId\)/, "picked branch still uses the selected-warehouse stock");
  // auto fallback for legacy no-warehouse products = products.stock (matches deduct legacy branch)
  assert.match(cb, /_pick \? _pick\.stock : Number\(_p\.stock \|\| 0\)/, "legacy fallback to products.stock");
  // block message names the warehouse + suggests choosing another
  assert.match(cb, /คลัง \$\{_whName\} มี \$\{_avail\}/, "short message names the sold warehouse");
  assert.match(cb, /เลือกคลังอื่น/, "block toast suggests choosing another warehouse");
});
