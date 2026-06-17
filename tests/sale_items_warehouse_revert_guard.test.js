// Phase 468 sale-items-warehouse snapshot + revert-to-it
// Run: node --test tests/sale_items_warehouse_revert_guard.test.js
//
// Why this exists:
//   POS sale_items never stored which warehouse a line was sold from, so _revertStockForSale
//   (cancel/delete a POS sale) restocked "home-first" instead of the warehouse actually sold
//   from -> sell off a truck then cancel = stock bounced back to HOME (per-warehouse drift).
//   Phase 468: pos.js writes sale_items.warehouse_id = the selected warehouse; revert restocks
//   that warehouse first, falling back to home-first + a warn for old rows (warehouse_id = null).
//   A legacy fallback strips warehouse_id so the insert is safe even before the column migration.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
const main = fs.readFileSync(path.resolve("main.js"), "utf8");

test("POS sale_items insert snapshots warehouse_id = selected POS warehouse", () => {
  assert.match(pos, /warehouse_id:\s*_posWarehouseId\s*\|\|\s*null/, "itemPayload must set warehouse_id: _posWarehouseId || null");
});

test("sale_items legacy fallback strips warehouse_id (safe before the column migration)", () => {
  assert.match(pos, /column\|product_id\|unit_cost\|warehouse_id/, "fallback regex must also catch a missing warehouse_id column");
  assert.match(pos, /warehouse_id:\s*_wh/, "fallback destructure must strip warehouse_id before retry");
});

// scope assertions to the _revertStockForSale body
function revertBody(src) {
  const i = src.indexOf("async function _revertStockForSale");
  assert.ok(i >= 0, "_revertStockForSale must exist");
  const end = src.indexOf("\nwindow._appRevertStockForSale", i);
  return src.slice(i, end === -1 ? i + 12000 : end);
}
const rb = revertBody(main);

test("revert restocks the warehouse the item was sold from (sale_items.warehouse_id) first", () => {
  assert.match(rb, /item\.warehouse_id/, "revert must read item.warehouse_id");
  assert.match(rb, /const soldWhId =/, "revert must resolve the sold warehouse id");
  assert.match(rb, /stocks\.find\(ws => String\(ws\.warehouse_id\) === String\(soldWhId\)\)/, "must pick the row matching the sold warehouse");
});

test("revert keeps home-first fallback + warns for old rows, still via CAS (no absolute write)", () => {
  assert.match(rb, /บ้าน/, "home-first fallback retained");
  assert.match(rb, /console\.warn[\s\S]{0,160}warehouse_id/, "warns when warehouse_id missing/row absent");
  assert.match(rb, /_atomicAddStock\("warehouse_stock"/, "still restocks via CAS add (no absolute cache write)");
});
