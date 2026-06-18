// Phase 480 — single source of truth for the "auto" warehouse pick (1-bill-1-warehouse).
//
// Concept (owner): a POS sale draws from ONE warehouse per bill. When the cashier does NOT
// pick a warehouse ("auto" mode), the deduct path (_deductStockForSaleItem auto branch) picks
// exactly one warehouse — "บ้าน" (home) first if it has stock, else the warehouse with the most
// stock. The oversell precheck MUST agree on that same single warehouse, otherwise it compares
// qty against sum(all warehouses) while deduct only draws from one → a sellable bill gets a
// false "[สต็อกไม่ครบ]" flag (audit §S3). This module is the ONE place that pick logic lives so
// precheck and deduct can never drift.

// Pick the warehouse an auto-mode sale will deduct from.
//   - Only warehouses with stock > 0 are eligible (mirrors the deduct filter).
//   - "บ้าน" (home, name contains "บ้าน") wins if it has stock; otherwise the largest stock wins.
// Returns { warehouse_id, stock } of the chosen row, or null when no warehouse has stock
// (legacy products that track only products.stock have no warehouse_stock row → null; callers
//  fall back to products.stock, which is exactly what the deduct legacy branch decrements).
export function pickAutoWarehouseStock(state, productId) {
  const eligible = (((state && state.warehouseStock) || [])).filter(ws =>
    String(ws.product_id) === String(productId) && Number(ws.stock || 0) > 0
  );
  if (eligible.length === 0) return null;
  const warehouses = (state && state.warehouses) || [];
  // copy before sort — never mutate the caller's array
  const sorted = eligible.slice().sort((a, b) => {
    const nameA = (warehouses.find(w => w.id === a.warehouse_id)?.name || "");
    const nameB = (warehouses.find(w => w.id === b.warehouse_id)?.name || "");
    const aHome = nameA.includes("บ้าน") ? 1 : 0;
    const bHome = nameB.includes("บ้าน") ? 1 : 0;
    if (aHome !== bHome) return bHome - aHome;
    return Number(b.stock || 0) - Number(a.stock || 0);
  });
  const ws = sorted[0];
  return { warehouse_id: ws.warehouse_id, stock: Number(ws.stock || 0) };
}
