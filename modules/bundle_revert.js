// modules/bundle_revert.js
// Phase 477 — bundle-revert helper (MONEY/STOCK §4.1-4.2)
//
// Why this exists:
//   POS sale_items store the BUNDLE parent's product_id, but a bundle sale deducts the
//   CHILDREN's stock (one "sale" movement per child). When a bundle bill is voided/deleted,
//   _revertStockForSale iterated sale_items (parent id) and the Phase 471 deductedIds filter
//   (keyed by the child ids that actually got "sale" movements) never matched the parent id,
//   so the children were never restocked → permanent stock leak on every bundle void.
//
//   This pure helper expands a bundle recipe into the list of child restock entries. It mirrors
//   the deduct-side math in _appDeductStockSmart (main.js): childQty = recipe.qty × line qty.
//   Kept side-effect-free so it is unit-testable in node (main.js itself is not importable).

/**
 * Expand a bundle recipe into child restock entries for a single sold bundle line.
 * Mirrors the deduct-side formula: Number(recipe.qty || 1) × lineQty (per child).
 *
 * @param {Array<{child_product_id:*, qty:*}>} recipeRows  product_bundles rows for the bundle
 * @param {number} lineQty  quantity of the bundle sold on this sale_items line
 * @returns {Array<{childId:*, qty:number}>}  one entry per valid child; [] when nothing to restock
 */
export function expandBundleForRevert(recipeRows, lineQty) {
  const line = Number(lineQty);
  if (!Array.isArray(recipeRows) || !Number.isFinite(line) || line <= 0) return [];
  const out = [];
  for (const r of recipeRows) {
    const childId = r?.child_product_id;
    if (childId == null) continue;
    // mirror deduct-side `Number(r.qty || 1)`: blank/0/invalid recipe qty falls back to 1
    const recipeQty = Number(r?.qty);
    const perBundle = Number.isFinite(recipeQty) && recipeQty > 0 ? recipeQty : 1;
    const qty = perBundle * line;
    if (qty > 0) out.push({ childId, qty });
  }
  return out;
}
