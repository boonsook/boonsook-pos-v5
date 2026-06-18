// Phase 483 (audit §S6) — qty-aware revert: restock no more than what was ACTUALLY deducted.
//
// Why: _revertStockForSale used a boolean gate (deductedIds = Set of product_id) but restocks
// per cart line (item.qty). If one product appears on several lines (standalone + inside a bundle)
// and only SOME lines were actually cut (an oversell bill force-sold "[สต็อกไม่ครบ]"), the boolean
// gate let every line restock → more than was deducted = phantom stock (oversell risk).
//
// Fix: cap the total restock per product at the qty actually deducted (sum of that product's sale
// movements for the bill). Strict improvement — never restocks MORE than before — and keeps the
// fallback: if movements can't be read (null), restock the full amount (avoid under-crediting).
//
// Pure: no DOM / no network. Tested in tests/revert_qty_guard.test.js.

// Build a quota Map(String(product_id) → total deducted qty) from the bill's sale-movement rows.
//   movRows not an array → null  (= can't verify → caller falls back to full restock).
//   non-finite / NaN qty contributes 0 (don't poison the sum).
export function buildDeductedQty(movRows) {
  if (!Array.isArray(movRows)) return null;
  const m = new Map();
  for (const r of movRows) {
    const k = String(r?.product_id);
    const q = Number(r?.qty);
    m.set(k, (m.get(k) || 0) + (Number.isFinite(q) && q > 0 ? q : 0));
  }
  return m;
}

// Take up to `want` from the product's remaining deducted quota, decrementing the quota.
//   deductedQty == null → return Number(want)||0  (fallback: restock the full requested amount).
//   otherwise → min(want, remaining), floored at 0, and the quota is reduced by what was taken.
//   So the same product across multiple lines splits from the deducted total: the first line takes
//   first, later lines get only what's left (0 once the quota is exhausted).
export function takeRestockQty(deductedQty, productId, want) {
  const w = Number(want) || 0;
  if (deductedQty == null) return w;
  const k = String(productId);
  const avail = deductedQty.get(k) || 0;
  const take = Math.max(0, Math.min(w, avail));
  deductedQty.set(k, avail - take);
  return take;
}
