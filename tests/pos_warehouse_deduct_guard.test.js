// Phase 464 — POS: choose a warehouse per bill → deduct from THAT warehouse (build 464)
// Run: node --test tests/pos_warehouse_deduct_guard.test.js
//
// Why this exists:
//   This is the highest-risk money/stock change: it lets POS pick one warehouse for
//   the whole bill and deducts every line from it. The invariants that MUST hold:
//   (1) when a warehouse is picked, deduct from exactly that warehouse — never silently
//       fall back to another (that would take stock from the wrong place);
//   (2) deduction stays atomic CAS (no oversell / no negative);
//   (3) when no warehouse is picked, behaviour is byte-for-byte the OLD home-first
//       heuristic (backward compatible for every other caller of the deduct helper);
//   (4) POS threads the chosen warehouse from the picker → cart bill → checkout deduct.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mainSrc = fs.readFileSync(path.resolve("main.js"), "utf8");
const posSrc = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

function extractFn(src, sig) {
  const start = src.indexOf(sig);
  assert.ok(start !== -1, `must contain: ${sig}`);
  // หา body '{' = อันที่อยู่หลัง ') {' (ข้าม destructuring param เช่น ({ product, ... }))
  const bodyOpen = src.indexOf(") {", start);
  assert.ok(bodyOpen !== -1, `must find body of: ${sig}`);
  const open = bodyOpen + 2;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced: ${sig}`);
}

const deductBody = extractFn(mainSrc, "async function _deductStockForSaleItem(");

// ── core: deduct from the picked warehouse, atomically ────────────────────────
test("_deductStockForSaleItem accepts a warehouseId", () => {
  assert.match(mainSrc, /async function _deductStockForSaleItem\(\{\s*product,\s*qty,\s*orderNo,\s*warehouseId\s*\}\)/, "signature must include warehouseId");
});

test("when a warehouse is picked, it selects THAT warehouse's stock row", () => {
  assert.match(deductBody, /stocks\.find\(s\s*=>\s*String\(s\.warehouse_id\)\s*===\s*String\(warehouseId\)\)/, "must pick the stock row matching warehouseId");
});

test("🔴 a picked warehouse with no stock must NOT fall back to another warehouse", () => {
  // the "not found in picked warehouse" branch must showToast + return (no deduction elsewhere)
  assert.match(deductBody, /if\s*\(!ws\)\s*\{[\s\S]*?showToast[\s\S]*?return;/, "missing-in-picked-warehouse must warn + return");
  // and the early return must sit before the CAS decrement
  const notFoundIdx = deductBody.indexOf("if (!ws)");
  const casIdx = deductBody.indexOf('_atomicDecrementStock("warehouse_stock"');
  assert.ok(notFoundIdx !== -1 && casIdx !== -1 && notFoundIdx < casIdx, "the no-fallback guard must precede the CAS decrement");
});

test("deduction stays atomic CAS (no oversell / negative)", () => {
  assert.match(deductBody, /_atomicDecrementStock\("warehouse_stock",\s*ws\.id,\s*qty\)/, "must CAS-decrement the chosen warehouse row");
});

test("with no warehouseId, the old home-first heuristic is preserved (backward compatible)", () => {
  // the auto branch still sorts บ้าน first
  assert.match(deductBody, /aHome\s*!==\s*bHome.*return\s*bHome\s*-\s*aHome|if\s*\(aHome\s*!==\s*bHome\)\s*return\s*bHome\s*-\s*aHome/s, "auto path must keep home-first sort");
  // the picked-vs-auto split is explicit
  assert.match(deductBody, /_hasPicked/, "must branch on whether a warehouse was picked");
});

test("_appDeductStockSmart threads warehouseId to the deduct helper (non-bundle)", () => {
  // signature lives outside the body — check the source
  assert.match(mainSrc, /window\._appDeductStockSmart = async function\(\{\s*product,\s*qty,\s*orderNo,\s*warehouseId\s*\}\)/, "smart deduct must accept warehouseId");
  const smartBody = extractFn(mainSrc, "window._appDeductStockSmart = async function(");
  assert.match(smartBody, /_deductStockForSaleItem\(\{\s*product,\s*qty,\s*orderNo,\s*warehouseId\s*\}\)/, "must pass warehouseId through for non-bundle");
});

// ── POS wiring: picker → bill → checkout ──────────────────────────────────────
test("POS checkout passes the chosen warehouse to every line's deduction", () => {
  assert.match(posSrc, /warehouseId:\s*_posWarehouseId\s*\|\|\s*undefined/, "checkout deduct must pass _posWarehouseId");
});

test("the warehouse chip selection is the single source (default auto, persisted)", () => {
  assert.match(posSrc, /let _posWarehouseId = /, "module-level selected warehouse");
  assert.match(posSrc, /localStorage\.setItem\("bsk_pos_warehouse"/, "selection persists");
  // default is "" (auto) when nothing stored
  assert.match(posSrc, /localStorage\.getItem\("bsk_pos_warehouse"\)\s*\|\|\s*""/, "default is auto (empty)");
});

test("picker filters to the selected warehouse and shows its remaining stock", () => {
  assert.match(posSrc, /function _posProductsForWh\(state\)/, "must have warehouse-scoped product list");
  assert.match(posSrc, /String\(s\.warehouse_id\)\s*===\s*String\(_posWarehouseId\)\s*&&\s*Number\(s\.stock\s*\|\|\s*0\)\s*>\s*0/, "filter = stock>0 in selected warehouse");
  assert.match(posSrc, /คงเหลือ \$\{Number\(remain\)/, "card shows remaining stock for the selected warehouse");
});

test("changing the warehouse chip re-renders the picker", () => {
  const bindBody = extractFn(posSrc, "function bindWarehouseChips(");
  assert.match(bindBody, /_posWarehouseId = btn\.dataset\.posWh/, "chip click sets the selected warehouse");
  assert.match(bindBody, /renderPosView\(ctx\)/, "must re-render after change");
});

// ── adding from the picker keeps you on the picker (add many in a row) ─────────
test("POS [+] adds silently so the picker stays open (no bounce to home)", () => {
  assert.match(mainSrc, /function addToCart\(productId,\s*opts\s*=\s*\{\}\)/, "addToCart must accept opts");
  assert.match(mainSrc, /if\s*\(!opts\.silent\)\s*showRoute\(state\.currentRoute\)/, "silent add must skip the full route re-render");
  assert.match(posSrc, /ctx\.addToCart\(id,\s*\{\s*silent:\s*true\s*\}\)/, "POS [+] must call addToCart with silent:true");
  // the cart total/qty is still reflected via the sticky bar after a silent add
  assert.match(posSrc, /\{\s*silent:\s*true\s*\}\);\s*\n\s*updateStickyBar\(state\)/, "after silent add, the sticky cart bar must update");
});

// ── one tap = one add (guard the touchscreen double-fire double-add bug) ───────
test("[+] is debounced per product so a touchscreen double-fire can't add twice", () => {
  const bindBody = extractFn(posSrc, "function bindProductList(");
  assert.match(bindBody, /id === _posLastAdd\.id && \(now - _posLastAdd\.t\) < 350/, "must skip a repeat add of the SAME product within 350ms");
  // different products are NOT blocked (keyed on id) → adding many distinct items rapidly still works
  assert.match(bindBody, /_posLastAdd = \{ id, t: now \}/, "must record last add id+time");
  assert.match(posSrc, /touch-action:manipulation/, "the [+] button sets touch-action:manipulation");
});
