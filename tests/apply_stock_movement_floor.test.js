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
  // warehouse (the truth) goes through the floor on the !allowNegative path
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", ws\.id, qty\)/, "warehouse out/sale via floor");
  // Phase 403: the products.stock MIRROR was removed — products.stock is now derived from
  // sum(warehouse_stock) by a DB trigger; _applyStockMovement does only an optimistic LOCAL recompute.
  assert.ok(!/_atomicDecrementStock\("products"/.test(body), "no products.stock CAS in _applyStockMovement (trigger-derived)");
  assert.ok(!/_atomicAddStock\("products"/.test(body), "no products.stock additive CAS in _applyStockMovement");
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
  // in/return AND admin-override out/sale still use the additive CAS on warehouse_stock (the truth)
  assert.match(body, /_atomicAddStock\("warehouse_stock", ws\.id, delta\)/, "additive warehouse CAS preserved");
  // Phase 403: products.stock additive mirror removed (DB trigger keeps products.stock = sum)
  // the insert (used by in/return and by manual override out/sale) is kept
  assert.match(
    body,
    /xhrPost\("warehouse_stock", \{ product_id: productId, warehouse_id: warehouseId, stock: after, min_stock: 0 \}\)/,
    "warehouse_stock insert preserved for in/return + override"
  );
});

test("'in'/'return' still additive; 'adjust' still absolute xhrPatch on warehouse — untouched", () => {
  // delta is +qty for in/return
  assert.match(body, /\(movementType === "in" \|\| movementType === "return"\) \? qty/, "in/return delta = +qty");
  // adjust still PATCHes an absolute value (not a delta) on warehouse_stock (the truth)
  assert.match(body, /xhrPatch\("warehouse_stock", \{ stock: after \}, "id", ws\.id\)/, "adjust warehouse absolute set");
  // Phase 403: no products.stock PATCH here anymore — the trigger recomputes products.stock from sum
  assert.ok(!/xhrPatch\("products"/.test(body), "no products.stock patch in _applyStockMovement (trigger-derived)");
});

test("return shape stays {ok,error} (+ additive insufficient) — callers depend on it", () => {
  assert.match(body, /return \{ ok: false, error: "ข้อมูลไม่ครบ" \}/, "keeps bad-args shape");
  assert.match(body, /return \{ ok: true \}/, "success returns {ok:true}");
  assert.match(body, /return \{ ok: false, error: e\?\.message \|\| String\(e\) \}/, "keeps catch shape");
});

// ── wiring: who passes allowNegative ──
// Phase 437 REVERSED the old Phase 369 behavior: owner ruled "สต็อกห้ามติดลบเด็ดขาด".
// The manual override no longer confirms-then-goes-negative; it hard-blocks and sends
// allowNegative:false. (The hard guarantee is the DB CHECK chk_ws_stock_nonneg.)
// Deeper assertions live in tests/stock_nonneg_guard.test.js.
test("stock_movements.js save handler no longer allows negative (Phase 437 hard rule)", () => {
  const sm = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");
  assert.ok(!/allowNegative: true/.test(sm), "manual override must not send allowNegative:true anymore");
  assert.match(
    sm,
    /window\._appApplyStockMovement\(\{[\s\S]{0,300}allowNegative: false/,
    "save handler sends allowNegative: false (floor enforced)"
  );
});

test("service-job auto-deduct (ac_install/service_form/solar) does NOT pass allowNegative → floored", () => {
  for (const f of ["ac_install", "service_form", "solar"]) {
    const src = fs.readFileSync(path.resolve(`modules/${f}.js`), "utf8");
    assert.ok(src.includes('movementType: "out"'), `${f}.js auto-deducts with type out`);
    assert.ok(!src.includes("allowNegative"), `${f}.js must rely on default allowNegative=false (floored)`);
  }
});
