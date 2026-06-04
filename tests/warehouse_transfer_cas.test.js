// Phase 368 harden-warehouse-transfer-cas-floor
// Run: node --test tests/warehouse_transfer_cas.test.js
//
// Why this exists:
//   _transferWarehouseStock (warehouse→warehouse transfer; used by ac_install/service_form/
//   solar "โอนบ้าน→รถ" + stock_movements transfer modal) used raw xhrPatch with NO floor and
//   NO .ok check. Since xhrPost/xhrPatch RESOLVE {ok:false} (never throw), the old try/catch
//   caught nothing → transferring more than source = negative stock; target failure = lost stock.
//   Phase 368 routes source through _atomicDecrementStock (floor from 367) + rolls back the
//   source only when the target step fails, and treats movement logging as best-effort.
//
// _transferWarehouseStock is a closure inside main.js over module-scoped state/xhr helpers,
// so behavior-level mocking is impractical. We assert structure on the EXTRACTED FUNCTION BODY
// ONLY (not whole main.js) to avoid false positives from xhrPatch/xhrPost used elsewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// Extract just the _transferWarehouseStock body: from its declaration up to the next
// top-level function (_applyStockMovement). This keeps every assertion scoped to the function.
function extractTransferBody(src) {
  const startMatch = src.match(/async function _transferWarehouseStock\(/);
  assert.ok(startMatch, "function _transferWarehouseStock must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/\nasync function _applyStockMovement\(/);
  assert.ok(endMatch, "delimiter _applyStockMovement must follow");
  return src.slice(start, start + endMatch.index);
}

const body = extractTransferBody(main);

test("qty is normalized once via Number (transferQty), raw qty not used for math", () => {
  assert.match(body, /const transferQty = Number\(qty\)/, "must normalize qty → transferQty");
  // the CAS/add calls must pass transferQty, never raw qty
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", srcWs\.id, transferQty\)/, "source decrement uses transferQty");
  assert.match(body, /_atomicAddStock\("warehouse_stock", tgtWs\.id, transferQty\)/, "target add uses transferQty");
});

test("source decrement uses CAS+floor (_atomicDecrementStock), NOT raw xhrPatch", () => {
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", srcWs\.id, transferQty\)/, "source via CAS");
  // the old raw source patch must be gone
  assert.doesNotMatch(body, /xhrPatch\("warehouse_stock", \{ stock: srcAfter \}/, "no raw source xhrPatch");
  // surfaces the floor's insufficient signal + a clear source-not-enough message
  assert.match(body, /insufficient: dec\.insufficient/, "propagates insufficient flag");
  assert.match(body, /สต็อกต้นทางไม่พอ \(เหลือ \$\{dec\.before\}\)/, "clear insufficient message");
});

test("missing source row → fail, does NOT create a source row (no negative seed)", () => {
  assert.match(body, /if \(!srcWs\?\.id\)\s*\{\s*\n\s*return \{ ok: false, error: "คลังต้นทางไม่มีสินค้านี้" \}/, "returns error when no source row");
  // must never xhrPost a row for the FROM warehouse
  assert.doesNotMatch(body, /warehouse_id: fromWarehouseId/, "never inserts a source-warehouse row");
});

test("target: existing row → CAS add; new row → xhrPost returnData + push id into cache", () => {
  assert.match(body, /_atomicAddStock\("warehouse_stock", tgtWs\.id, transferQty\)/, "existing target via CAS add");
  assert.match(body, /xhrPost\(\s*"warehouse_stock",[\s\S]{0,160}\{ returnData: true \}/, "new target requests returnData");
  assert.match(body, /id: res\.data\.id/, "cache row carries the real DB id");
  assert.match(body, /state\.warehouseStock\.push\(newTgtRow\)/, "pushes new row into cache");
});

test("rollback ONLY on target failure (after source decrement succeeded)", () => {
  // both target failure branches must add the qty back to the SOURCE row
  const rollbacks = body.match(/_atomicAddStock\("warehouse_stock", srcWs\.id, transferQty\)/g) || [];
  assert.equal(rollbacks.length, 2, "two rollback paths: CAS-add fail + insert fail");
  assert.match(body, /โอนไม่สำเร็จ \(คืนสต็อกต้นทางแล้ว\)/, "explains source was returned");
});

test("movement logging is best-effort: failure does NOT rollback, still returns ok:true", () => {
  // the stock_movements log is wrapped in try/catch
  const logIdx = body.indexOf('type: "transfer"');
  assert.ok(logIdx > 0, "logs a transfer movement");
  const afterLog = body.slice(logIdx);
  // after the log there must be NO rollback call, and the function returns ok:true
  assert.doesNotMatch(afterLog, /_atomicAddStock\("warehouse_stock", srcWs\.id, transferQty\)/, "no rollback after a successful transfer just because logging failed");
  assert.match(afterLog, /console\.warn\([^\n]*transfer ok/, "warns on log failure but keeps the transfer");
  assert.match(afterLog, /return \{ ok: true \}/, "returns ok:true after the best-effort log");
});

test("does NOT touch products.stock (inter-warehouse transfer keeps total unchanged)", () => {
  assert.doesNotMatch(body, /"products"/, "transfer must not mutate products table");
  assert.doesNotMatch(body, /products\.stock/, "transfer must not touch products.stock");
});

test("return shape stays {ok,error} (+optional insufficient) — callers depend on it", () => {
  // every early return is an {ok:false,...} or the final {ok:true}; no thrown/void path
  assert.match(body, /return \{ ok: false, error: "ข้อมูลไม่ครบ" \}/, "keeps existing bad-args shape");
  assert.match(body, /return \{ ok: false, error: "คลังต้นทาง\/ปลายทาง ต้องไม่ซ้ำกัน" \}/, "keeps same-warehouse shape");
  assert.match(body, /return \{ ok: true \}/, "success returns {ok:true}");
});
