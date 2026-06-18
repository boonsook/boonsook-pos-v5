// Phase 477 restock-bundle-children-on-void
// Run: node --test tests/bundle_revert_restock_guard.test.js
//
// Why this exists:
//   POS sale_items store the BUNDLE parent's product_id, but selling a bundle deducts the
//   CHILDREN's stock (one "sale" movement per child). When a bundle bill was voided/deleted,
//   _revertStockForSale iterated sale_items (parent id) and the Phase 471 deductedIds filter
//   (keyed by the CHILD ids that actually got "sale" movements) never matched the parent id, so
//   the children were never restocked -> permanent stock leak on every bundle void.
//   Phase 477: revert detects product.is_bundle, expands the bundle recipe (expandBundleForRevert)
//   into child restock entries (childQty = recipe.qty x line qty, mirroring the deduct side), and
//   restocks each child through the same deductedIds-gated CAS path. The parent line is skipped
//   (it has no warehouse_stock row). non-bundle lines keep their exact prior behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expandBundleForRevert } from "../modules/bundle_revert.js";

// ── behavioral: the pure recipe-expansion helper ─────────────────────────────
test("expandBundleForRevert: childQty = recipe.qty x line qty for each child", () => {
  const rows = [
    { child_product_id: 11, qty: 2 },
    { child_product_id: 22, qty: 3 },
  ];
  assert.deepEqual(expandBundleForRevert(rows, 4), [
    { childId: 11, qty: 8 },
    { childId: 22, qty: 12 },
  ]);
});

test("expandBundleForRevert: blank/zero/NaN recipe qty falls back to 1 per bundle (mirrors deduct `qty || 1`)", () => {
  const rows = [
    { child_product_id: 1, qty: 0 },
    { child_product_id: 2, qty: null },
    { child_product_id: 3, qty: "2ก" }, // NaN
    { child_product_id: 4 },             // missing qty
  ];
  assert.deepEqual(expandBundleForRevert(rows, 5), [
    { childId: 1, qty: 5 },
    { childId: 2, qty: 5 },
    { childId: 3, qty: 5 },
    { childId: 4, qty: 5 },
  ]);
});

test("expandBundleForRevert: empty recipe / non-array / non-positive line qty -> [] (nothing to restock)", () => {
  assert.deepEqual(expandBundleForRevert([], 3), []);
  assert.deepEqual(expandBundleForRevert(null, 3), []);
  assert.deepEqual(expandBundleForRevert([{ child_product_id: 1, qty: 2 }], 0), []);
  assert.deepEqual(expandBundleForRevert([{ child_product_id: 1, qty: 2 }], -1), []);
  assert.deepEqual(expandBundleForRevert([{ child_product_id: 1, qty: 2 }], "x"), []);
});

test("expandBundleForRevert: rows with no child_product_id are dropped", () => {
  const rows = [
    { qty: 2 },                       // no child id
    { child_product_id: null, qty: 2 },
    { child_product_id: 9, qty: 1 },
  ];
  assert.deepEqual(expandBundleForRevert(rows, 2), [{ childId: 9, qty: 2 }]);
});

// ── source-grep: the _revertStockForSale wiring (main.js is not importable) ───
const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function revertBody(src) {
  const i = src.indexOf("async function _revertStockForSale");
  assert.ok(i >= 0, "_revertStockForSale must exist");
  const e = src.indexOf("\nwindow._appRevertStockForSale", i);
  return src.slice(i, e === -1 ? i + 14000 : e);
}
const rb = revertBody(main);

test("main.js imports the pure bundle-revert helper", () => {
  assert.match(main, /import \{ expandBundleForRevert \} from "\.\/modules\/bundle_revert\.js"/);
});

test("revert detects a bundle line and expands its recipe", () => {
  assert.match(rb, /if \(product\.is_bundle\)/, "must branch on product.is_bundle");
  assert.match(rb, /product_bundles\?bundle_id=eq\./, "must fetch the bundle recipe");
  assert.match(rb, /expandBundleForRevert\(recipeRows, qty\)/, "must expand recipe x line qty");
});

test("each bundle child is gated qty-aware (Phase 483: restock only what was actually deducted)", () => {
  assert.match(rb, /takeRestockQty\(deductedQty, c\.childId, c\.qty\)/, "per-child qty drawn from deducted quota");
  assert.match(rb, /deductedQty != null && childRestock <= 0/, "per-child qty-aware gate (skip when quota exhausted)");
});

test("bundle children restock via CAS add through the shared restockProduct helper", () => {
  assert.match(rb, /async function restockProduct\(/, "per-item restock factored into a helper");
  assert.match(rb, /_atomicAddStock\("warehouse_stock"/, "restock via CAS add (no absolute write)");
  assert.match(rb, /restockProduct\(childProd, childRestock, soldWhId, `\[bundle:/, "children restocked with capped qty + bundle label + sold warehouse");
});

test("a bundle with an unreadable recipe surfaces an error and does NOT rollback (no silent leak)", () => {
  assert.match(rb, /ไม่ได้คืนสต็อก children/, "must push an error when the recipe fetch fails");
});

test("non-bundle path keeps a qty-aware deducted gate + idempotency marker (no regression)", () => {
  assert.match(rb, /takeRestockQty\(deductedQty, item\.product_id, qty\)/, "non-bundle qty drawn from deducted quota");
  assert.match(rb, /if \(deductedQty != null && restockQty <= 0\)/, "non-bundle qty-aware gate retained");
  assert.match(rb, /_STOCK_RETURNED_MARKER/, "idempotency marker retained");
});
