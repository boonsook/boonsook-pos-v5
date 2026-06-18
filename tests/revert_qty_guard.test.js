// Phase 483 (audit §S6) — qty-aware revert: restock no more than what was actually deducted.
// Run: node --test tests/revert_qty_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDeductedQty, takeRestockQty } from "../modules/revert_qty.js";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function revertBody(src) {
  const a = src.indexOf("async function _revertStockForSale");
  assert.ok(a >= 0, "_revertStockForSale exists");
  const b = src.indexOf("window._appRevertStockForSale", a);
  return src.slice(a, b);
}

// ── buildDeductedQty ───────────────────────────────────────────────────────────
test("buildDeductedQty: non-array → null (can't verify → caller falls back to full)", () => {
  assert.equal(buildDeductedQty(null), null);
  assert.equal(buildDeductedQty(undefined), null);
  assert.equal(buildDeductedQty("oops"), null);
});

test("buildDeductedQty: two movements of one product → summed", () => {
  const m = buildDeductedQty([{ product_id: 5, qty: 2 }, { product_id: 5, qty: 3 }]);
  assert.equal(m.get("5"), 5);
});

test("buildDeductedQty: multiple products → separate keys", () => {
  const m = buildDeductedQty([{ product_id: 5, qty: 2 }, { product_id: 7, qty: 4 }]);
  assert.equal(m.get("5"), 2);
  assert.equal(m.get("7"), 4);
});

test("buildDeductedQty: NaN / non-numeric qty contributes 0 (no poisoned sum)", () => {
  const m = buildDeductedQty([{ product_id: 5, qty: "abc" }, { product_id: 5, qty: 3 }]);
  assert.equal(m.get("5"), 3);
});

// ── takeRestockQty ─────────────────────────────────────────────────────────────
test("takeRestockQty: null quota → returns the full requested amount (fallback)", () => {
  assert.equal(takeRestockQty(null, 5, 4), 4);
  assert.equal(takeRestockQty(null, 5, "abc"), 0); // Number("abc")||0
});

test("takeRestockQty: want <= avail → returns want and reduces the remaining quota", () => {
  const m = new Map([["5", 5]]);
  assert.equal(takeRestockQty(m, 5, 2), 2);
  assert.equal(m.get("5"), 3, "remaining quota reduced");
});

test("takeRestockQty: want > avail → capped at avail, remaining hits 0", () => {
  const m = new Map([["5", 2]]);
  assert.equal(takeRestockQty(m, 5, 5), 2, "capped at deducted qty");
  assert.equal(m.get("5"), 0);
});

test("takeRestockQty: same product across lines splits from the deducted total", () => {
  const m = new Map([["5", 4]]); // product 5 deducted 4 total
  assert.equal(takeRestockQty(m, 5, 2), 2, "line 1 takes 2");
  assert.equal(takeRestockQty(m, 5, 3), 2, "line 2 gets only the remaining 2 (not 3)");
  assert.equal(takeRestockQty(m, 5, 1), 0, "line 3 gets 0 (quota exhausted)");
});

test("takeRestockQty: product never deducted (avail 0 / missing key) → returns 0", () => {
  const m = new Map([["5", 3]]);
  assert.equal(takeRestockQty(m, 99, 4), 0, "missing key → 0");
  assert.equal(takeRestockQty(new Map([["5", 0]]), 5, 4), 0, "avail 0 → 0");
});

// ── source wiring: _revertStockForSale is qty-aware (no boolean Set gate) ───────
test("_revertStockForSale builds a deducted-qty map and gates restock by it (no Set/.has)", () => {
  const rb = revertBody(main);
  assert.match(rb, /buildDeductedQty\(movRows\)/, "builds the deducted-qty quota from sale movements");
  assert.match(rb, /takeRestockQty\(deductedQty, item\.product_id, qty\)/, "non-bundle restock capped by quota");
  assert.match(rb, /takeRestockQty\(deductedQty, c\.childId, c\.qty\)/, "bundle child restock capped by quota");
  // the old boolean gate must be gone from the revert body
  assert.ok(!/new Set\(/.test(rb), "no Set-based deductedIds in revert");
  assert.ok(!/deductedIds/.test(rb), "no deductedIds variable left in revert");
  // the movement fetch must now also pull qty
  assert.match(rb, /stock_movements\?type=eq\.sale&select=product_id,qty/, "movement fetch selects product_id,qty");
});
