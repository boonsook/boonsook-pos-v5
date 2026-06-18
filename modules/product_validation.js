// Phase 481 — product-save input validation (audit §S4 §S5). Pure, unit-tested helpers shared by
// saveProduct + the bundle form in main.js. No DB/network here — these only inspect in-memory data.

// S5: find another product that collides on barcode or SKU.
//   Why: there is NO DB unique constraint on products.barcode/sku, so two products can share a
//   barcode → the POS scanner silently picks the first match (wrong item / wrong price). saveProduct
//   warns (App.confirm, allow-proceed) before saving a colliding value. This is the only guard.
//   - barcode is checked first (that is what POS scans), then SKU.
//   - empty/whitespace values are ignored (auto-generated SKUs are unique → never collide).
//   - the row being edited is excluded (excludeId) so editing a product never warns about itself.
//   Returns { field: "barcode"|"sku", value, product } of the first collision, or null.
export function findDuplicateProduct(products, fields = {}, excludeId) {
  const list = Array.isArray(products) ? products : [];
  const match = (field, raw) => {
    const v = String(raw == null ? "" : raw).trim();
    if (!v) return null;
    const product = list.find(p =>
      String(p.id) !== String(excludeId) &&
      String(p[field] == null ? "" : p[field]).trim() === v
    );
    return product ? { field, value: v, product } : null;
  };
  return match("barcode", fields.barcode) || match("sku", fields.sku);
}

// S4: bundle child qty must be a positive finite number. Number("2ก") === NaN slipped through the
//   old `qty <= 0` guard (NaN <= 0 is false) and into product_bundles.qty as null/corrupt.
//   Mirrors the Phase 474 NaN-safe parse used for price/cost/stock. Invalid / ≤ 0 → fallback to 1.
export function normalizeBundleQty(v) {
  const q = Number(v);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
