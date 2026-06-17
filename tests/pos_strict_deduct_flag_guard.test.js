// Phase 469 pos-strict-deduct-flag (warn + sell + flag — owner-chosen, NOT block)
// Run: node --test tests/pos_strict_deduct_flag_guard.test.js
//
// Why this exists:
//   POS checkout fire-and-forget the stock deduct (try/catch console.warn) and never checked the
//   result, so a sale whose selected warehouse was short still completed silently with no
//   deduction (#1 of "POS warehouse 3 รู"). Phase 469: _deductStockForSaleItem / _appDeductStockSmart
//   now RETURN {ok,...}; checkout collects items that failed to deduct and, without blocking the
//   sale, flags the bill note with "[สต็อกไม่ครบ]" + a clear toast (owner chose warn+flag for field
//   sales off trucks, consistent with Phase 437 no-negative — the deduct itself still can't go negative).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

function deductBody(src) {
  const i = src.indexOf("async function _deductStockForSaleItem");
  assert.ok(i >= 0, "_deductStockForSaleItem must exist");
  const end = src.indexOf("\nasync function _revertStockForSale", i);
  return src.slice(i, end === -1 ? i + 6000 : end);
}
const db = deductBody(main);

test("_deductStockForSaleItem returns a result object instead of void", () => {
  assert.match(db, /return \{ ok: true, skipped: true \}/, "skip/no-op exits return {ok:true,skipped}");
  assert.match(db, /return \{ ok: false, insufficient: true, reason:/, "picked-warehouse-missing returns ok:false");
  assert.match(db, /const _decR = \(stocks\.length > 0\) \? dec : dec2/, "final return derives from the CAS result");
  assert.match(db, /return \{ ok: false, insufficient: !!_decR\?\.insufficient/, "final fail-return reports insufficient + reason");
});

test("_appDeductStockSmart propagates ok flag, incl bundle children aggregate", () => {
  const i = main.indexOf("_appDeductStockSmart = async");
  assert.ok(i >= 0, "_appDeductStockSmart must exist");
  const endI = main.indexOf("Auto-link Serial Number after sale", i);
  const body = main.slice(i, endI === -1 ? i + 3000 : endI);
  assert.match(body, /if \(!product\) return \{ ok: true, skipped: true \}/, "guard returns a result");
  assert.match(body, /let _childFail = null/, "bundle aggregates child failures");
  assert.match(body, /return _childFail \?/, "bundle returns ok:false when any child failed");
});

test("POS checkout captures the deduct result and flags the bill — does NOT block the sale", () => {
  assert.match(pos, /const stockFailedItems = \[\]/, "collects items that failed to deduct");
  assert.match(pos, /const _dr = await fn\(/, "awaits + captures the deduct result");
  assert.match(pos, /_dr && _dr\.ok === false/, "checks the result for failure");
  assert.match(pos, /\[สต็อกไม่ครบ\]/, "flags the bill note with the marker");
  assert.match(pos, /rest\/v1\/sales\?id=eq\."/, "PATCHes the sales row by id");
  assert.match(pos, /method: "PATCH"/, "uses PATCH to persist the flag on the bill");
  // must NOT block: no throw/return that aborts checkout on stock-fail
  assert.ok(!/throw .*สต็อก/.test(pos), "stock-fail must not throw/abort the sale (warn+flag, not block)");
});
