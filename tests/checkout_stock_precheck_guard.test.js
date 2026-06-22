// Phase 473 checkout-stock-precheck (block oversell at checkout — "ขายเท่าที่มี", no phantom stock)
// Run: node --test tests/checkout_stock_precheck_guard.test.js
//
// Why this exists:
//   Owner principle: never sell more than on-hand (no negative, no phantom). Earlier "warn+flag"
//   (469) let an oversell bill complete without deducting → phantom stock. Phase 473: doCheckout
//   prechecks each cart line against the SELECTED warehouse's on-hand; if any line exceeds it, the
//   checkout is blocked (no bill created) with an actionable message. Keeps Phase 437 (no DB change).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
function checkoutBody(src) {
  const i = src.indexOf("async function doCheckout(");
  assert.ok(i >= 0, "doCheckout must exist");
  return src.slice(i, i + 9000);
}
const cb = checkoutBody(pos);

test("checkout prechecks each cart line against the selected-warehouse on-hand", () => {
  assert.match(cb, /Phase 473/, "precheck block present");
  assert.match(cb, /_posWhStock\(state, _it\.id, _posWarehouseId\)/, "uses the selected-warehouse stock when a warehouse is picked");
  assert.match(cb, /Number\(_it\.qty[\s\S]{0,12}\) > _avail/, "flags lines whose qty exceeds available");
});

test("oversell is blocked (returns before the sales insert) with an actionable message", () => {
  assert.match(cb, /สต็อกไม่พอ ขายเกินไม่ได้/, "clear block message");
  const shortIdx = cb.indexOf("_short.length > 0");
  const saleIdx = cb.indexOf('xhrPostPOS("sales"');
  assert.ok(shortIdx > -1 && saleIdx > -1 && shortIdx < saleIdx, "the block must come BEFORE the sales insert (no bill on oversell)");
});

test("precheck sits INSIDE the try so its early-return hits the button-reset finally (no stuck 'กำลังบันทึก')", () => {
  // Phase 476: the precheck used to live BEFORE the try, so its `return` on oversell skipped the
  // finally that re-enables the confirm buttons → the button hung on "⏳ กำลังบันทึก..." forever.
  const i = pos.indexOf("async function doCheckout(");
  const body = pos.slice(i, i + 20000); // wide enough to include the button-reset finally (Phase 480 precheck + 517b-0 hard-fail/await JV grew doCheckout)
  const tryIdx = body.indexOf("try {");
  const shortIdx = body.indexOf("_short.length > 0");
  const resetIdx = body.indexOf("reset UI buttons");
  assert.ok(tryIdx > -1 && shortIdx > -1 && resetIdx > -1, "try / precheck / button-reset markers all present");
  assert.ok(tryIdx < shortIdx, "the precheck must be INSIDE the try (try opens before the precheck)");
  assert.ok(shortIdx < resetIdx, "the precheck must come before the finally that resets the buttons");
});

test("service / non_stock items are skipped (no false block)", () => {
  assert.match(cb, /product_type === "service" \|\| _p\.product_type === "non_stock"/, "skips non-stock items in the precheck");
});
