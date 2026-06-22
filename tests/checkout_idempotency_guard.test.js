// Phase 517b-0 — checkout idempotency + failure semantics foundation (build 518)
// Run: node --test tests/checkout_idempotency_guard.test.js
//
// Why this exists:
//   Prep for 517b (use customer credit / Dr2180 split). The current POS checkout was unsafe for
//   that: sales row committed BEFORE items/stock, items/stock fail were soft (toast + flag, still
//   "success"), and the JV post was fire-and-forget after the sale — so a redeem+sale+JV-fail would
//   leave "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ". 517b-0 hardens checkout WITHOUT enabling credit:
//     1) stable idempotency key (checkoutKey) before the sale insert (not Date.now() alone)
//     2) sale_items / stock deduct fail = HARD FAIL → reuse soft-delete + revert (existing helpers),
//        no JV, no clear cart, no receipt, no success; revert/soft-delete fail = needsManualReview
//     3) postJournalForSale is AWAITED (not background) and gates the success message
//   It must NOT touch credit_ledger / redeem RPC / postJournalForSale mapping / VAT / credit UI.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

function doCheckoutBody() {
  const i = pos.indexOf("async function doCheckout(");
  assert.ok(i >= 0, "doCheckout must exist");
  return pos.slice(i, i + 20500);
}
const cb = doCheckoutBody();

// ── 1) idempotency key ────────────────────────────────────────────────────────
test("checkout builds a stable idempotency key before the sale insert (not Date.now alone)", () => {
  const keyIdx = cb.indexOf("const checkoutKey");
  const saleIdx = cb.indexOf('xhrPostPOS("sales"');
  assert.ok(keyIdx > -1, "checkoutKey must be defined");
  assert.ok(saleIdx > -1 && keyIdx < saleIdx, "checkoutKey must be created BEFORE the sales insert");
  // Phase 520: key source moved to per-intent _ensureCheckoutKey() (crypto.randomUUID at module level)
  assert.match(cb, /const checkoutKey = _ensureCheckoutKey\(\);/, "key must come from per-intent _ensureCheckoutKey()");
  assert.match(pos, /function _ensureCheckoutKey\(\)[\s\S]*?crypto\?\.randomUUID\?\.\(\)/, "key generator must use crypto.randomUUID (not Date.now alone)");
  assert.match(cb, /noteParts\.push\("CHECKOUT_KEY:"\s*\+\s*checkoutKey\)/, "checkoutKey must be embedded in the sale note for trace");
});

// ── 2) hard fail on items/stock → reuse soft-delete + revert ──────────────────
test("sale_items / stock deduct failure is a HARD FAIL (no fake success)", () => {
  // the failure branch must trigger on either failure list
  assert.match(cb, /if\s*\(\s*failedItems\.length > 0\s*\|\|\s*stockFailedItems\.length > 0\s*\)/, "hard-fail must trigger on items OR stock failure");
});

test("hard fail reuses existing revert helper + existing soft-delete marker (no new stock path)", () => {
  const fb = cb.slice(cb.indexOf("failedItems.length > 0 || stockFailedItems.length > 0"));
  const endIdx = fb.indexOf("return { ok: false, needsManualReview");
  const block = endIdx > 0 ? fb.slice(0, endIdx + 200) : fb.slice(0, 2200);
  assert.match(block, /window\._appRevertStockForSale\?\.\(\s*\{\s*saleId,\s*orderNo\s*\}/, "must reuse existing _appRevertStockForSale (no new restock path)");
  assert.match(block, /\[ลบแล้ว\]/, "must reuse the existing soft-delete note marker hidden by visibleSalesForRole");
  assert.match(block, /CHECKOUT_FAILED:/, "soft-delete must trace the failed checkout key");
  assert.match(block, /needsManualReview\s*=\s*!revertOk\s*\|\|\s*!softDeleteOk/, "revert/soft-delete failure must set needsManualReview");
});

test("hard fail does NOT post JV / clear cart / open receipt / show success", () => {
  const fb = cb.slice(cb.indexOf("failedItems.length > 0 || stockFailedItems.length > 0"));
  const endIdx = fb.indexOf("return { ok: false, needsManualReview");
  const block = fb.slice(0, endIdx + 60);
  assert.ok(!/postJournalForSale/.test(block), "must NOT post JV on a failed checkout");
  assert.ok(!/openReceiptDrawer/.test(block), "must NOT open the receipt on a failed checkout");
  assert.ok(!/state\.cart\s*=\s*\[\]/.test(block), "must NOT clear the cart on a failed checkout (allow retry)");
  assert.ok(!/บันทึกการขายเรียบร้อย/.test(block), "must NOT announce success on a failed checkout");
  assert.match(block, /return \{ ok: false, needsManualReview/, "failed checkout must return early with ok:false");
});

// ── 3) JV awaited + gates success ─────────────────────────────────────────────
test("postJournalForSale is awaited (not fire-and-forget) and gates the success message", () => {
  assert.match(cb, /await\s+postJournalForSale\(\s*\{[\s\S]+?\},\s*\{\s*detailed:\s*true\s*\}\s*\)/, "JV must be awaited with detailed result");
  assert.ok(!/void\s*\(\s*async[\s\S]{0,120}postJournalForSale/.test(cb), "sale JV must NOT be a fire-and-forget background task");
  // success toast picks the message based on the JV warn flag
  assert.match(cb, /_jvWarn\s*\?\s*"ขายถูกบันทึกแล้ว/, "warn branch (JV failed) message must be present");
  assert.match(cb, /:\s*"บันทึกการขายเรียบร้อย/, "success branch message must be the else of the _jvWarn ternary");
});

test("the awaited JV runs only after the items/stock hard-fail return (success path only)", () => {
  const failIdx = cb.indexOf("return { ok: false, needsManualReview");
  const jvIdx = cb.indexOf("await postJournalForSale(");
  assert.ok(failIdx > -1 && jvIdx > -1 && failIdx < jvIdx, "JV await must come AFTER the hard-fail early-return");
});

// ── scope guard: 517b-0 must not touch credit / mapping / VAT ─────────────────
test("checkout does not enable credit use or touch JV mapping/VAT (foundation only)", () => {
  // 517b-1 added a redeem helper (RPC-only) but it must NOT be wired into doCheckout yet,
  // and the checkout must never write the credit ledger directly or add the 2180 split here.
  assert.ok(!cb.includes("_redeemCheckoutCredit("), "doCheckout must NOT call the redeem helper yet (credit UI not enabled)");
  assert.ok(!/customer_credit_ledger/.test(cb), "checkout must NOT touch the credit ledger directly");
  assert.ok(!/Dr\s*2180|"2180"|'2180'/.test(cb), "must NOT add the 2180 split in checkout yet");
});
