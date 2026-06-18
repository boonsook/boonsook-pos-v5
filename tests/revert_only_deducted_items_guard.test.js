// Phase 471 revert-only-restocks-actually-deducted-items
// Run: node --test tests/revert_only_deducted_items_guard.test.js
//
// Why this exists:
//   Deleting a POS bill calls _revertStockForSale, which restocked EVERY sale_items line. But a
//   bill flagged [สต็อกไม่ครบ] (sold more than the warehouse had → CAS refused, 0 deducted) never
//   reduced stock, so adding it back over-credited the warehouse (confirmed live: a +7 "return"
//   movement with no matching "sale" -7 → warehouse jumped 6→13).
//   Phase 471: revert first queries the bill's "sale" stock_movements (Phase 465 logs "sale" only
//   on a successful deduct) and restocks ONLY items that were actually deducted. If orderNo is
//   missing or the fetch fails it falls back to restocking all (avoids under-credit).
//   Phase 483 (audit S6): upgraded the boolean gate to a qty-aware quota — restock per product is
//   capped at the SUMMED deducted qty (Map via buildDeductedQty/takeRestockQty), so a product on
//   several lines that was only partly deducted no longer over-credits. Same fallback (null = full).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function revertBody(src) {
  const i = src.indexOf("async function _revertStockForSale");
  assert.ok(i >= 0, "_revertStockForSale must exist");
  const e = src.indexOf("\nwindow._appRevertStockForSale", i);
  return src.slice(i, e === -1 ? i + 12000 : e);
}
const rb = revertBody(main);

test("revert queries the bill's sale movements (with qty) to learn what was actually deducted", () => {
  assert.match(rb, /type=eq\.sale&select=product_id,qty&note=ilike\.\*/, "fetches sale movements (incl qty) filtered by orderNo");
  assert.match(rb, /deductedQty = buildDeductedQty\(movRows\)/, "builds a product→deducted-qty quota map");
});

test("an item beyond the deducted qty is not restocked (prevents over-credit on flagged bills)", () => {
  assert.match(rb, /takeRestockQty\(deductedQty, item\.product_id, qty\)/, "caps restock at the deducted quota");
  assert.match(rb, /if \(deductedQty != null && restockQty <= 0\)/, "skips items with no remaining quota");
  assert.match(rb, /กันคืนเกิน/, "logs the skip reason");
});

test("fallback to restock-all when it cannot tell (no orderNo / fetch failed)", () => {
  assert.match(rb, /let deductedQty = null/, "null sentinel = could not check");
  assert.match(rb, /if \(orderNo\) \{/, "only filters when orderNo is known");
});

test("still restocks via CAS add and keeps the Phase 410 idempotency marker", () => {
  assert.match(rb, /_atomicAddStock\("warehouse_stock"/, "restock via CAS add (no absolute write)");
  assert.match(rb, /_STOCK_RETURNED_MARKER/, "idempotency marker retained");
});
