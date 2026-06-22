// Phase 517b-1 — checkout journal status + 2180 credit clearing prep (build 519)
// Run: node --test tests/checkout_journal_status_guard.test.js
//
// Why this exists:
//   Build 518 smoke: sale succeeded but the receipt showed "เอกสารบัญชี: ยังไม่ลงบัญชี" — misleading,
//   because pre-go-live the JV is intentionally SKIPPED (pre-effective) and the badge polled blindly.
//   517b-0 already made postJournalForSale AWAITED + gated the toast. 517b-1 surfaces the real JV
//   status on the receipt and prepares the 2180 credit-redeem path (RPC-only, NOT wired to UI yet):
//     1) doCheckout captures postRes {status,reason} and attaches it to the in-memory lastReceipt
//     2) _fillReceiptAcctTrace shows pre-effective=neutral / failed=ต้องตรวจสอบ / posted→lookup
//     3) JV fail after a committed sale must NOT roll the sale back (status only)
//     4) using customer credit must go through redeem_customer_credit RPC only (no direct ledger write)
//   It must NOT touch refund 2180 mapping / ledger schema/RLS / Phase 514 / stock internals.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");

function doCheckoutBody() {
  const i = pos.indexOf("async function doCheckout(");
  assert.ok(i >= 0, "doCheckout must exist");
  return pos.slice(i, i + 18000);
}
const cb = doCheckoutBody();

// region slice (extractFn breaks on destructured params `({ ... })`)
function redeemHelperBody() {
  const i = pos.indexOf("async function _redeemCheckoutCredit(");
  assert.ok(i >= 0, "_redeemCheckoutCredit must exist");
  return pos.slice(i, i + 1200);
}

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} must exist`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// ── 1) JV status captured + attached to receipt ──────────────────────────────
test("doCheckout captures the JV status/reason and attaches it to the in-memory receipt", () => {
  assert.match(cb, /_jvStatus\s*=\s*\{\s*status:\s*postRes\?\.status[\s\S]*?reason:\s*postRes\?\.reason/, "must capture {status,reason} from postRes");
  assert.match(cb, /state\.lastReceipt\._jvStatus\s*=\s*_jvStatus/, "must attach _jvStatus to the in-memory lastReceipt");
  // attached AFTER persisting → reopened receipts re-lookup (no stale status)
  const persistIdx = cb.indexOf('localStorage.setItem("bsk_last_receipt"');
  const attachIdx = cb.indexOf("state.lastReceipt._jvStatus = _jvStatus");
  assert.ok(persistIdx > -1 && attachIdx > persistIdx, "_jvStatus must be attached after the localStorage persist (in-memory only)");
});

test("postJournalForSale stays awaited (517b-0 not regressed)", () => {
  assert.match(cb, /await\s+postJournalForSale\(\s*\{[\s\S]+?\},\s*\{\s*detailed:\s*true\s*\}\s*\)/, "JV must remain awaited with detailed result");
  assert.ok(!/void\s*\(\s*async[\s\S]{0,120}postJournalForSale/.test(cb), "JV must NOT revert to fire-and-forget");
});

// ── 2) receipt badge shows distinct, accurate states (display-only) ──────────
test("_fillReceiptAcctTrace surfaces pre-effective vs failed distinctly and stays display-only", () => {
  const fn = extractFn(mainJs, "_fillReceiptAcctTrace");
  assert.match(fn, /_jvStatus/, "must read the known JV status from the sale");
  assert.match(fn, /pre-effective/, "must treat pre-effective skip distinctly (not an alarm)");
  assert.match(fn, /ยังไม่ลงบัญชี \/ ต้องตรวจสอบ/, "failed JV must show a clear needs-review status");
  // display-only invariant (mirror receipt_acct_trace_refresh_guard)
  assert.ok(!/xhrPost|xhrPatch|postJournal|_applyStockMovement|deductStock|\.insert\(|\.update\(/.test(fn),
    "receipt badge must stay display-only (no write/post/stock)");
});

// ── 3) JV fail after a committed sale must NOT roll the sale back ─────────────
test("JV failure after sale commit does not revert/soft-delete the sale (status only)", () => {
  const jvIdx = cb.indexOf("await postJournalForSale(");
  assert.ok(jvIdx > -1, "JV await must exist");
  const afterJv = cb.slice(jvIdx);
  assert.ok(!/_appRevertStockForSale/.test(afterJv), "JV-fail path must NOT revert stock (sale already committed)");
  assert.ok(!/\[ลบแล้ว\]/.test(afterJv), "JV-fail path must NOT soft-delete the sale");
});

// ── 4) credit redeem goes through the RPC only, idempotent, NOT wired yet ─────
test("credit redeem helper calls the RPC only — never writes the ledger directly from the client", () => {
  const fn = redeemHelperBody();
  assert.match(fn, /rpc\/redeem_customer_credit/, "must call the redeem_customer_credit RPC");
  assert.ok(!/rest\/v1\/customer_credit_ledger/.test(fn), "must NOT insert customer_credit_ledger directly");
  assert.match(fn, /p_source_key:\s*sourceKey/, "source_key must be passed in (caller derives sale:<id>) — not generated here");
  assert.ok(!/Date\.now\(\)/.test(fn), "redeem key must not be a bare Date.now() inside the helper");
});

test("credit UI is NOT wired yet — doCheckout does not call the redeem helper (STOP/report)", () => {
  assert.ok(!cb.includes("_redeemCheckoutCredit("), "doCheckout must NOT call the redeem helper yet (credit UI not enabled)");
  assert.ok(!cb.includes("customer_credit_ledger"), "checkout must not touch the credit ledger yet");
});

// ── scope/style guards ────────────────────────────────────────────────────────
test("no alert() introduced in the redeem helper", () => {
  const fn = redeemHelperBody();
  assert.ok(!/\balert\(/.test(fn), "must not use alert()");
});
