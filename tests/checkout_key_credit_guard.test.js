// Phase 517b-2 / build 520 — checkout_key idempotency + customer-credit-use backend
// Run: node --test tests/checkout_key_credit_guard.test.js
//
// Why (reviewer addendum):
//   #1 BLOCKING double-redeem: checkoutKey must be per-INTENT (persist across re-submits), bound to a
//      UNIQUE sales.checkout_key, and redeem source_key = checkout_key. Re-click after timeout / 2 devices
//      same ms → same key → DB rejects 2nd sale (23505) → replay (no double sale/redeem/JV/stock).
//   #2 release RPC idempotent (no double-release).
//   #3 redeem-first orphan must be logged, never swallowed (accounting §4.8).
//   cash_recon must subtract credit_used_amount (verified bug: counted full total as cash).
//   #4(ก): credit-use UI stays OFF in 520 (creditUsed = 0); backend ready, smoke via direct RPC/SQL.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
const cashRecon = fs.readFileSync(path.resolve("modules/cash_recon.js"), "utf8");
const sql = fs.readFileSync(path.resolve("supabase-phase520-credit-use-checkout-key.sql"), "utf8");

function doCheckoutBody(len = 11000) {
  const i = pos.indexOf("async function doCheckout(");
  assert.ok(i >= 0, "doCheckout must exist");
  return pos.slice(i, i + len);
}
const cbHead = doCheckoutBody();

// ── #1 checkout_key per-intent (not gen at submit) ───────────────────────────
test("checkout_key is generated per-intent (lazy module var), not freshly at each submit", () => {
  assert.match(pos, /let _checkoutKey = null;/, "must hold checkoutKey in a module var (persist across re-submits)");
  assert.match(pos, /function _ensureCheckoutKey\(\)\s*\{[\s\S]*?if\s*\(!_checkoutKey\)/, "_ensureCheckoutKey must only generate when null (idempotent)");
  assert.match(cbHead, /const checkoutKey = _ensureCheckoutKey\(\);/, "doCheckout must reuse _ensureCheckoutKey() (not a fresh randomUUID per submit)");
  assert.ok(!/const checkoutKey = \(globalThis\.crypto/.test(cbHead), "doCheckout must NOT freshly gen checkoutKey inline at submit");
  assert.match(pos, /posView === "payment-select"[\s\S]{0,120}_ensureCheckoutKey\(\)/, "intent key must be ensured when entering payment-select");
});

test("checkout_key is reset on success and on new-intent/logout (so next bill gets a new key)", () => {
  // success reset (after cart clear) + clearPosState + renderPosPage
  const resets = (pos.match(/_checkoutKey = null/g) || []).length;
  assert.ok(resets >= 3, `must reset _checkoutKey on success + clearPosState + renderPosPage (found ${resets})`);
});

// ── Phase 571: renderPosPage must NOT nuke the key on background renderAll ─────
//   renderAll() (fired by deferred loadAllData 10s–2min after saves) also calls renderPosPage.
//   A bare reset there clears _checkoutKey mid-retry after a checkout timeout → next submit gets a
//   fresh key → uq_sales_checkout_key can't dedup → duplicate sale/stock/JV. Reset only when the
//   cart is empty (empty = intent done/new; non-empty = same intent still alive → keep the key).
test("Phase 571 — renderPosPage resets _checkoutKey ONLY when the cart is empty (not unconditionally)", () => {
  const rp = pos.indexOf("export function renderPosPage(");
  assert.ok(rp >= 0, "renderPosPage must exist");
  const rpBody = pos.slice(rp, pos.indexOf("function renderPosView(", rp));
  assert.match(rpBody, /if\s*\(!\(state\.cart[\s\S]{0,40}_checkoutKey = null/,
    "renderPosPage must reset _checkoutKey ONLY when the cart is empty (cart ไม่ว่าง = intent เดิม → คง key)");
  assert.doesNotMatch(rpBody, /\n\s*_checkoutKey = null;/,
    "renderPosPage must NOT reset _checkoutKey unconditionally (would clear the key during a deferred renderAll while a checkout retry is in flight → duplicate sale/stock/JV)");
});

test("Phase 571 — clearPosState still resets _checkoutKey unconditionally (logout/cross-login must always clear)", () => {
  const cp = pos.indexOf("export function clearPosState(");
  assert.ok(cp >= 0, "clearPosState must exist");
  const cpBody = pos.slice(cp, pos.indexOf("export function renderPosPage(", cp));
  assert.match(cpBody, /\n\s*_checkoutKey = null;/,
    "clearPosState must reset _checkoutKey unconditionally (logout must never leak an intent key across logins)");
  assert.doesNotMatch(cpBody, /if\s*\(!\(state\.cart[\s\S]{0,40}_checkoutKey = null/,
    "clearPosState reset must stay unconditional (no cart guard — no cart in scope; must always clear)");
});

test("salePayload carries checkout_key + credit_used_amount", () => {
  assert.match(cbHead, /checkout_key:\s*checkoutKey/, "payload must include checkout_key");
  assert.match(cbHead, /credit_used_amount:\s*round2\(creditUsed\)/, "payload must include credit_used_amount");
});

test("duplicate checkout_key (23505) replays existing sale — no double sale/redeem/JV/stock", () => {
  assert.match(cbHead, /23505\|uq_sales_checkout_key\|duplicate key/, "must detect duplicate checkout_key");
  assert.match(cbHead, /_openExistingSaleByCheckoutKey\(checkoutKey/, "duplicate → open the existing sale (replay)");
  // the 23505 branch must return before re-processing (no JV/redeem inside that branch)
  const dupIdx = cbHead.indexOf("23505|uq_sales_checkout_key");
  const branch = cbHead.slice(dupIdx, dupIdx + 400);
  assert.match(branch, /_checkoutKey = null;[\s\S]*?return;/, "replay branch must reset key and return");
  assert.ok(!/postJournalForSale/.test(branch), "replay must not post JV again");
});

// ── #1e redeem-first, source_key = checkout_key ──────────────────────────────
test("credit redeem happens BEFORE the sale insert and binds source_key = checkout_key", () => {
  const redeemIdx = cbHead.indexOf("_appRedeemCheckoutCredit");
  const insertIdx = cbHead.indexOf('xhrPostPOS("sales"');
  assert.ok(redeemIdx > -1 && insertIdx > -1 && redeemIdx < insertIdx, "redeem must be called before the sales insert (redeem-first)");
  assert.match(cbHead, /_appRedeemCheckoutCredit\?\.\(\s*\{[\s\S]*?sourceKey:\s*checkoutKey/, "redeem source_key must be checkoutKey (per-intent), NOT sale.id");
  assert.match(cbHead, /if\s*\(\s*creditUsed > 0[\s\S]{0,60}\)\s*\{[\s\S]*?return;/, "redeem fail must abort checkout (fail-closed, no sale)");
});

// ── #2/#3 release: compensation + no silent swallow ──────────────────────────
test("release on failure goes through the RPC and logs (never swallowed)", () => {
  const i = pos.indexOf("async function _releaseAndLog(");
  assert.ok(i >= 0, "_releaseAndLog helper must exist");
  const fn = pos.slice(i, i + 1200);
  assert.match(fn, /rpc\/release_customer_credit/, "must release via the RPC (not direct ledger write)");
  assert.match(fn, /console\.error\(/, "release failure must be logged (not swallowed) — accounting §4.8");
  assert.match(fn, /captureMessage/, "release failure must be reported to the error reporter");
});

test("redeem-then-fail paths call release (sale-insert-fail + items/stock hard-fail)", () => {
  const body = doCheckoutBody(20000);
  assert.match(body, /_creditRedeemed\)\s*await _releaseAndLog\(checkoutKey,[^)]*"sale-insert-failed"/, "sale-insert-fail after redeem must release");
  assert.match(body, /_creditRedeemed\)\s*creditReleaseOk = await _releaseAndLog\(checkoutKey,[^)]*"items-stock-hard-fail"/, "items/stock hard-fail after redeem must release");
});

// ── cash_recon subtracts credit_used_amount (verified bug fix) ───────────────
test("cash_recon counts cash received = total_amount - credit_used_amount", () => {
  assert.match(cashRecon, /Number\(s\.total_amount \|\| 0\)\s*-\s*Number\(s\.credit_used_amount \|\| 0\)/, "cash-in must subtract credit_used_amount");
  assert.match(cashRecon, /const cashIn = cashSales\.reduce\([\s\S]*?_cashReceived/, "cashIn must use the credit-adjusted amount");
  assert.match(cashRecon, /const transferIn = transferSales\.reduce\([\s\S]*?_cashReceived/, "transferIn must use the credit-adjusted amount");
});

// ── SQL: columns + unique + release RPC idempotent ───────────────────────────
test("SQL adds checkout_key (partial UNIQUE) + credit_used_amount", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS checkout_key text/, "checkout_key column");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_checkout_key[\s\S]*?WHERE checkout_key IS NOT NULL/, "partial unique on checkout_key");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS credit_used_amount numeric\(14,2\) NOT NULL DEFAULT 0/, "credit_used_amount column");
  assert.match(sql, /NOTIFY pgrst/, "must reload schema");
});

test("SQL release_customer_credit RPC is idempotent (no double-release) + SECURITY DEFINER + lock", () => {
  const i = sql.indexOf("FUNCTION public.release_customer_credit");
  const fn = sql.slice(i);
  assert.ok(i >= 0, "release RPC must exist");
  assert.match(fn, /SECURITY DEFINER/, "must be SECURITY DEFINER");
  assert.match(fn, /pg_advisory_xact_lock/, "must serialize per customer");
  assert.match(fn, /source_type = 'sale_credit_release' AND source_key = p_source_key[\s\S]*?IF FOUND THEN[\s\S]*?RETURN v_existing/, "must be idempotent (return existing release, no double-release)");
  assert.match(fn, /source_type = 'sale_credit_use' AND source_key = p_source_key/, "release must match its redeem by source_key");
});

// ── #4(ก) credit-use was staged in 520; 517b-3 (build 521) turns the UI ON ────
test("credit-use is wired (517b-3 build 521 turned the UI on — creditUsed no longer hard-zero)", () => {
  assert.ok(!/const creditUsed = 0;/.test(cbHead), "creditUsed must not be hardcoded 0 anymore (UI enabled in 521)");
  assert.match(cbHead, /const creditUsed = \(_posCustomer\?\.id && _isAfterEffective\(todayBkk\(\)\)\) \?/, "creditUsed comes from UI state, gated by effective date (B1)");
});
