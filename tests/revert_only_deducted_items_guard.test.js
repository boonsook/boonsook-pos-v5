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
//   missing or the fetch fails (deductedIds=null) it falls back to restocking all (avoids
//   under-credit on a transient error).

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

test("revert queries the bill's sale movements to learn which items were actually deducted", () => {
  assert.match(rb, /type=eq\.sale&select=product_id&note=ilike\.\*/, "fetches sale movements filtered by orderNo");
  assert.match(rb, /deductedIds = new Set\(/, "builds a set of deducted product ids");
});

test("an item with NO sale movement is not restocked (prevents over-credit on flagged bills)", () => {
  assert.match(rb, /if \(deductedIds && !deductedIds\.has\(String\(item\.product_id\)\)\)/, "skips items not in the deducted set");
  assert.match(rb, /กันคืนเกิน/, "logs the skip reason");
});

test("fallback to restock-all when it cannot tell (no orderNo / fetch failed)", () => {
  assert.match(rb, /let deductedIds = null/, "null sentinel = could not check");
  assert.match(rb, /if \(orderNo\) \{/, "only filters when orderNo is known");
});

test("still restocks via CAS add and keeps the Phase 410 idempotency marker", () => {
  assert.match(rb, /_atomicAddStock\("warehouse_stock"/, "restock via CAS add (no absolute write)");
  assert.match(rb, /_STOCK_RETURNED_MARKER/, "idempotency marker retained");
});
