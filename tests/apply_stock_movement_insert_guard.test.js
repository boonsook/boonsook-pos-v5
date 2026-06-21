// Phase 513 stock-new-warehouse-insert-guard
// Run: node --test tests/apply_stock_movement_insert_guard.test.js
//
// Why this exists (audit S2):
//   _applyStockMovement (main.js) — when a (product, warehouse) has NO existing warehouse_stock
//   row and the movement is in/return/adjust (or allowNegative override), it inserted the new
//   row with `await xhrPost("warehouse_stock", {...})` WITHOUT checking .ok, WITHOUT requesting
//   the row id, and WITHOUT pushing it into the state.warehouseStock cache. So:
//     - a failed insert (RLS / network / DB CHECK) still fell through to log stock_movements
//       and returned ok:true  → a phantom movement + audit that lies "stock added".
//     - even on success the new row was never cached → the local products.stock recompute
//       under-counted until a full reload.
//   Phase 513 mirrors the proven transfer new-target path (Phase 368): returnData + check
//   res.data.id + push the real-id row into cache, returning fail BEFORE logging on any error.
//
// _applyStockMovement is a closure over module-scoped state/xhr helpers, so we assert on the
// EXTRACTED FUNCTION BODY ONLY (not whole main.js) to avoid false positives from xhrPost calls
// elsewhere in the file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

function extractApplyBody(src) {
  const startMatch = src.match(/async function _applyStockMovement\(/);
  assert.ok(startMatch, "function _applyStockMovement must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/\nwindow\._appTransferWarehouseStock = _transferWarehouseStock;/);
  assert.ok(endMatch, "delimiter window._appTransferWarehouseStock expose must follow");
  return src.slice(start, start + endMatch.index);
}

function extractTransferBody(src) {
  const startMatch = src.match(/async function _transferWarehouseStock\(/);
  assert.ok(startMatch, "function _transferWarehouseStock must exist");
  const start = startMatch.index;
  // ends at the start of _applyStockMovement (declared right after it)
  const endMatch = src.slice(start).match(/async function _applyStockMovement\(/);
  assert.ok(endMatch, "delimiter _applyStockMovement must follow transfer");
  return src.slice(start, start + endMatch.index);
}

const body = extractApplyBody(main);
const transferBody = extractTransferBody(main);

test("no-row in/return/adjust insert uses xhrPost warehouse_stock with returnData:true", () => {
  assert.match(
    body,
    /"warehouse_stock",[\s\S]{0,200}\{ returnData: true \}/,
    "new-warehouse-row insert must request returnData to get the real id back"
  );
});

test("insert result is checked (!res.ok || !res.data?.id) and returns fail", () => {
  assert.match(body, /if \(!res\.ok \|\| !res\.data\?\.id\)/, "must guard insert failure + missing id");
  assert.match(body, /return \{ ok: false, error:/, "must return ok:false on insert failure");
});

test("insert-failure return happens BEFORE logging stock_movements (no phantom movement)", () => {
  const guardIdx = body.indexOf("!res.ok || !res.data?.id");
  const movementIdx = body.indexOf('xhrPost("stock_movements"');
  assert.ok(guardIdx >= 0, "insert guard must exist");
  assert.ok(movementIdx >= 0, "stock_movements log must exist");
  assert.ok(guardIdx < movementIdx, "insert guard must come before stock_movements log");
});

test("success path pushes the new row into state.warehouseStock with the real DB id", () => {
  assert.match(
    body,
    /state\.warehouseStock\.push\(\{[\s\S]{0,160}id: res\.data\.id/,
    "new row must be cached with id: res.data.id (so next CAS + recompute see it)"
  );
});

test("out/sale with no row + !allowNegative still returns insufficient, never inserts a negative row", () => {
  assert.match(
    body,
    /if \(isOutFlow && !allowNegative\)\s*\{\s*\n[\s\S]{0,160}return \{ ok: false, insufficient: true, error: "คลังนี้ไม่มีสินค้านี้/,
    "out/sale no-row path must short-circuit to insufficient before any insert"
  );
});

test("_applyStockMovement does NOT write products.stock directly (DB trigger derives it)", () => {
  assert.ok(!/xhrPost\("products"/.test(body), "no xhrPost products write");
  assert.ok(!/xhrPatch\("products"/.test(body), "no xhrPatch products write");
  assert.ok(!/_atomicAddStock\("products"/.test(body), "no products additive CAS");
  assert.ok(!/_atomicDecrementStock\("products"/.test(body), "no products decrement CAS");
});

test("transfer new-target guard is unchanged (returnData + res.data.id + rollback)", () => {
  assert.match(transferBody, /\{ returnData: true \}/, "transfer new-target still requests returnData");
  assert.match(transferBody, /if \(!res\.ok \|\| !res\.data\?\.id\)/, "transfer still checks insert failure");
  assert.match(transferBody, /id: res\.data\.id/, "transfer still caches real DB id");
});
