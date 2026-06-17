// Phase 463 — POS product card: inline edit of selling price (build 463)
// Run: node --test tests/pos_price_edit_guard.test.js
//
// Why this exists:
//   modules/pos.js is the highest-risk money/stock surface. Phase 463 lets an
//   admin/sales user edit a product's SELLING PRICE inline from the POS product
//   picker. Because that writes products.price (a money master field), these guards
//   lock the safety invariants: it is permission-gated (admin/sales only), confirms
//   the old→new change before writing, PATCHes only the price field, updates state
//   optimistically WITHOUT touching the cart/checkout/stock-deduction path, and the
//   edit affordance only renders when allowed. The picker's add-to-cart + deduction
//   flow must be untouched by this change.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

const editBody = extractFn("bindPriceEdit");
const cardBody = extractFn("renderProductCards");
const gateBody = extractFn("canEditPosPrice");

// ── permission gate: admin/sales only ────────────────────────────────────────
test("canEditPosPrice allows only admin/sales", () => {
  assert.match(gateBody, /\["admin",\s*"sales"\]\.includes\(/, "gate must be admin/sales");
});

test("the edit affordance only renders when canEdit is true", () => {
  // renderProductCards takes a canEdit flag and the ✏️ button is conditional
  assert.match(src, /function renderProductCards\(products,\s*canEdit\s*=\s*false\)/, "renderProductCards must accept canEdit (default false)");
  assert.match(src, /canEdit\s*\?\s*`<button class="pos-edit-price-btn"/, "edit button must be gated behind canEdit");
  // both render call sites pass the gate result
  const calls = src.match(/renderProductCards\([^)]*canEditPosPrice\(state\)\)/g) || [];
  assert.ok(calls.length >= 2, "both initial + search re-render must pass canEditPosPrice(state)");
});

test("bindPriceEdit re-checks permission at click time (defense in depth)", () => {
  assert.match(editBody, /if\s*\(!canEditPosPrice\(state\)\)\s*return/, "must bail if not permitted, even though the button is hidden");
});

// ── the write: confirm → PATCH price only → optimistic state ──────────────────
test("price save confirms the old→new change before writing", () => {
  assert.match(editBody, /window\.App\?\.confirm\?\./, "must confirm via App.confirm");
  const confirmIdx = editBody.indexOf("confirm");
  const patchIdx = editBody.indexOf('"PATCH"');
  assert.ok(confirmIdx !== -1 && patchIdx !== -1 && confirmIdx < patchIdx, "confirm must come before the PATCH");
});

test("price save PATCHes products with ONLY the price field", () => {
  assert.match(editBody, /open\("PATCH",\s*cfg\.url\s*\+\s*"\/rest\/v1\/products\?id=eq\."/, "must PATCH products?id=eq.");
  assert.match(editBody, /JSON\.stringify\(\{\s*price:\s*newPrice\s*\}\)/, "payload must be ONLY { price: newPrice }");
});

test("price is validated (reject NaN / negative) and rounded to 2dp", () => {
  assert.match(editBody, /Math\.round\(Number\(input\.value[^)]*\)\s*\*\s*100\)\s*\/\s*100/, "must round to 2 decimals");
  assert.match(editBody, /isNaN\(newPrice\)\s*\|\|\s*newPrice\s*<\s*0/, "must reject NaN or negative");
});

test("state is updated optimistically only AFTER a successful save", () => {
  assert.match(editBody, /if\s*\(!saved\)\s*\{[^}]*restore[\s\S]*?return/, "failed save must toast + restore + return (no state change)");
  const savedGuardIdx = editBody.indexOf("if (!saved)");
  const assignIdx = editBody.indexOf("prod.price = newPrice");
  assert.ok(savedGuardIdx !== -1 && assignIdx !== -1 && assignIdx > savedGuardIdx, "prod.price assignment must be after the !saved guard");
});

// ── it must NOT touch the cart / checkout / stock deduction ───────────────────
test("the price-edit path does not touch cart, checkout, or stock deduction", () => {
  for (const bad of ["addToCart", "checkout", "DeductStock", "sale_items", "state.cart"]) {
    assert.ok(!editBody.includes(bad), `bindPriceEdit must not reference "${bad}" (price-only, no sale side effects)`);
  }
});

test("product name is escaped where it renders into the card", () => {
  assert.match(cardBody, /escHtml\(p\.name\)/, "card must escHtml the product name");
});

// ── no banned dialog primitives introduced ────────────────────────────────────
test("price edit uses no prompt()/alert() (input + App.confirm + showToast only)", () => {
  assert.ok(!/\bprompt\s*\(/.test(editBody), "must not use prompt()");
  assert.ok(!/\balert\s*\(/.test(editBody), "must not use alert()");
});
