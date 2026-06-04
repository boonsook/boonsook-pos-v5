// Phase 369 fix-applystockmovement-oversell-floor
// Run: node --test tests/apply_stock_movement_floor.test.js
//
// Why this exists:
//   _applyStockMovement (main.js; used by the manual stock-movements form AND service-job
//   auto-deduct in ac_install/service_form/solar via movementType "out") used _atomicAddStock
//   with a NEGATIVE delta for out/sale — no floor. The floors added in Phase 367 (POS) / 368
//   (transfer) did NOT cover this path, so a service-job deducting more than the warehouse had
//   wrote negative stock silently (suspected root cause of warehouse_stock product 1809 = -1).
//   Phase 369 routes out/sale through _atomicDecrementStock (floor from 367) by default, and
//   PRESERVES the manual admin override (allowNegative:true from the stock_movements form, which
//   already shows a "จะติดลบ — บันทึกต่อ?" confirm).
//
// _applyStockMovement is a closure inside main.js over module-scoped state/xhr helpers, so
// behavior-level mocking is impractical. We assert structure on the EXTRACTED FUNCTION BODY
// ONLY (not whole main.js) to avoid false positives from xhrPost/xhrPatch used elsewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// Extract just the _applyStockMovement body: from its declaration up to the window.* expose
// lines that follow it. Keeps every assertion scoped to the function.
function extractApplyBody(src) {
  const startMatch = src.match(/async function _applyStockMovement\(/);
  assert.ok(startMatch, "function _applyStockMovement must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/\nwindow\._appTransferWarehouseStock = _transferWarehouseStock;/);
  assert.ok(endMatch, "delimiter window._appTransferWarehouseStock expose must follow");
  return src.slice(start, start + endMatch.index);
}

const body = extractApplyBody(main);

test("signature accepts allowNegative with default false", () => {
  assert.match(
    body,
    /async function _applyStockMovement\(\{ productId, warehouseId, movementType, qty, note, allowNegative = false \}\)/,
    "must destructure allowNegative = false"
  );
});

test("out/sale (default) decrements via floored _atomicDecrementStock, NOT _atomicAddStock", () => {
  // warehouse + products mirror both go through the floor on the !allowNegative path
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", ws\.id, qty\)/, "warehouse out/sale via floor");
  assert.match(body, /_atomicDecrementStock\("products", productId, qty\)/, "products mirror out/sale via floor");
  // the floored branch is gated by isOutFlow && !allowNegative
  assert.match(body, /const isOutFlow = \(movementType === "out" \|\| movementType === "sale"\)/, "isOutFlow derived");
  assert.match(body, /else if \(isOutFlow && !allowNegative\)/, "floored branch gated on !allowNegative");
});

test("out/sale insufficient → early return BEFORE logging stock_movements", () => {
  const wsDecIdx = body.indexOf('_atomicDecrementStock("warehouse_stock", ws.id, qty)');
  const insuffIdx = body.indexOf("insufficient: true, error: `สต็อกคลังไม่พอ (เหลือ ${dec.before})`");
  const logIdx = body.indexOf('xhrPost("stock_movements"');
  assert.ok(wsDecIdx > 0, "warehouse floored decrement exists");
  assert.ok(insuffIdx > wsDecIdx, "insufficient early-return follows the decrement");
  assert.ok(logIdx > insuffIdx, "stock_movements log comes AFTER the insufficient return (so it is skipped)");
  assert.match(body, /if \(dec\.insufficient\) \{[\s\S]{0,200}return \{ ok: false, insufficient: true/, "returns on insufficient");
});

test("out/sale with no warehouse row (+!allowNegative) → fail, does NOT insert a negative row", () => {
  // guard: missing row on an out/sale without override returns insufficient instead of inserting
  assert.match(
    body,
    /if \(isOutFlow && !allowNegative\) \{[\s\S]{0,200}return \{ ok: false, insufficient: true, error: "คลังนี้ไม่มีสินค้านี้ \(สต็อก 0\)" \}/,
    "no-row out/sale returns insufficient (no negative seed)"
  );
});

test("allowNegative override preserves _atomicAddStock + the warehouse_stock insert path", () => {
  // in/return AND admin-override out/sale still use the additive CAS (delta can be negative)
  assert.match(body, /_atomicAddStock\("warehouse_stock", ws\.id, delta\)/, "additive warehouse CAS preserved");
  assert.match(body, /_atomicAddStock\("products", productId, delta\)/, "additive products CAS preserved");
  // the insert (used by in/return and by manual override out/sale) is kept
  assert.match(
    body,
    /xhrPost\("warehouse_stock", \{ product_id: productId, warehouse_id: warehouseId, stock: after, min_stock: 0 \}\)/,
    "warehouse_stock insert preserved for in/return + override"
  );
});

test("'in'/'return' still additive; 'adjust' still absolute xhrPatch — untouched", () => {
  // delta is +qty for in/return
  assert.match(body, /\(movementType === "in" \|\| movementType === "return"\) \? qty/, "in/return delta = +qty");
  // adjust still PATCHes an absolute value (not a delta) on both tables
  assert.match(body, /xhrPatch\("warehouse_stock", \{ stock: after \}, "id", ws\.id\)/, "adjust warehouse absolute set");
  assert.match(body, /xhrPatch\("products", \{ stock: newProdStock \}, "id", productId\)/, "adjust products recompute set");
});

test("return shape stays {ok,error} (+ additive insufficient) — callers depend on it", () => {
  assert.match(body, /return \{ ok: false, error: "ข้อมูลไม่ครบ" \}/, "keeps bad-args shape");
  assert.match(body, /return \{ ok: true \}/, "success returns {ok:true}");
  assert.match(body, /return \{ ok: false, error: e\?\.message \|\| String\(e\) \}/, "keeps catch shape");
});

// ── wiring: who passes allowNegative ──

test("stock_movements.js save handler passes allowNegative:true (admin override behind confirm)", () => {
  const sm = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");
  // the negative-stock confirm must still be present (don't weaken the gate)
  assert.match(sm, /จะติดลบ[\s\S]{0,40}บันทึกต่อ/, "negative-stock confirm preserved");
  // the apply call sends allowNegative:true
  assert.match(
    sm,
    /window\._appApplyStockMovement\(\{[\s\S]{0,300}allowNegative: true/,
    "save handler sends allowNegative: true"
  );
});

test("service-job auto-deduct (ac_install/service_form/solar) does NOT pass allowNegative → floored", () => {
  for (const f of ["ac_install", "service_form", "solar"]) {
    const src = fs.readFileSync(path.resolve(`modules/${f}.js`), "utf8");
    assert.ok(src.includes('movementType: "out"'), `${f}.js auto-deducts with type out`);
    assert.ok(!src.includes("allowNegative"), `${f}.js must rely on default allowNegative=false (floored)`);
  }
});
