// Phase 517b-3 / build 521 — enable customer credit use + JV Dr 2180 split
// Run: node --test tests/credit_use_jv_split_guard.test.js
//
// Activates everything staged in 517a→520: customer uses 2180 credit on a new sale (UI now ON),
// and postJournalForSale splits the debit (Dr 2180 = credit_used + Dr cash/bank = remainder) so the
// 2180 liability in the books matches customer_credit_ledger. Must balance (Dr=Cr=total) in all cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSaleDebitLines, _isAfterEffective } from "../modules/accounting/auto_post.js";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
const autoPost = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");

function doCheckoutBody(len = 11000) {
  const i = pos.indexOf("async function doCheckout(");
  assert.ok(i >= 0, "doCheckout must exist");
  return pos.slice(i, i + len);
}
const cbHead = doCheckoutBody();

const sumDebit = (lines) => lines.reduce((s, l) => s + l.debit, 0);

// ── JV Dr 2180 split: real balance verification (pure function) ───────────────
test("buildSaleDebitLines: no credit → single debit line = total (Dr=Cr)", () => {
  const lines = buildSaleDebitLines("1110", 1000, 0, "x");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].account_code, "1110");
  assert.equal(sumDebit(lines), 1000);
  assert.ok(!lines.some(l => l.account_code === "2180"), "no 2180 line when no credit used");
});

test("buildSaleDebitLines: partial credit → Dr 2180 + Dr cash, sums to total", () => {
  const lines = buildSaleDebitLines("1110", 1000, 300, "x");
  const l2180 = lines.find(l => l.account_code === "2180");
  const lcash = lines.find(l => l.account_code === "1110");
  assert.ok(l2180 && l2180.debit === 300, "Dr 2180 = credit used");
  assert.ok(lcash && lcash.debit === 700, "Dr cash/bank = total - credit");
  assert.equal(sumDebit(lines), 1000, "debit total must equal sale total (balance)");
});

test("buildSaleDebitLines: full credit → only Dr 2180, no cash line, still total", () => {
  const lines = buildSaleDebitLines("1110", 1000, 1000, "x");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].account_code, "2180");
  assert.equal(sumDebit(lines), 1000);
});

test("buildSaleDebitLines: credit over total is clamped (never over-clears 2180)", () => {
  const lines = buildSaleDebitLines("1110", 1000, 1500, "x");
  assert.equal(sumDebit(lines), 1000, "must clamp credit to total (Dr stays = total)");
  const l2180 = lines.find(l => l.account_code === "2180");
  assert.equal(l2180.debit, 1000);
});

// ── postJournalForSale wires the split (both VAT + non-VAT paths) ─────────────
test("postJournalForSale uses buildSaleDebitLines in both VAT and non-VAT paths", () => {
  assert.match(autoPost, /credit_used_amount/, "must read sale.credit_used_amount");
  const calls = (autoPost.match(/\.\.\.buildSaleDebitLines\(/g) || []).length;
  assert.ok(calls >= 2, `both JV paths must use buildSaleDebitLines (found ${calls})`);
  // Cr revenue + VAT lines unchanged (credit only changes the debit side)
  assert.match(autoPost, /account_code: "2170"/, "VAT credit line (2170) preserved");
});

// ── pos.js: creditUsed activated (no longer hard-zero) ───────────────────────
test("doCheckout computes creditUsed from UI state, clamped, not hardcoded 0", () => {
  assert.ok(!/const creditUsed = 0;/.test(pos), "creditUsed must no longer be hardcoded 0 (UI is ON)");
  assert.match(cbHead, /const creditUsed = \(_posCustomer\?\.id && _isAfterEffective\(todayBkk\(\)\)\) \? round2\(Math\.min\(Math\.max\(_creditUsed/, "creditUsed = clamp(_creditUsed, 0..actualTotal) when customer selected AND past effective date");
  assert.match(cbHead, /const _payable = round2\(Math\.max\(actualTotal - creditUsed/, "payable = total - creditUsed");
  assert.match(cbHead, /credit_used_amount:\s*round2\(creditUsed\)/, "payload records credit_used_amount");
});

test("paid_amount / change_amount are computed against payable (not full total)", () => {
  assert.match(cbHead, /paid_amount:\s*round2\(paidAmount \|\| _payable\)/, "paid_amount = cash received vs payable");
  assert.match(cbHead, /change_amount:\s*round2\(Math\.max\(\(paidAmount \|\| _payable\) - _payable/, "change vs payable");
});

test("redeem-first still binds source_key = checkout_key and runs before insert (517b-2 intact)", () => {
  const redeemIdx = cbHead.indexOf("_appRedeemCheckoutCredit");
  const insertIdx = cbHead.indexOf('xhrPostPOS("sales"');
  assert.ok(redeemIdx > -1 && redeemIdx < insertIdx, "redeem before insert");
  assert.match(cbHead, /sourceKey:\s*checkoutKey/, "redeem source_key = checkout_key");
});

// ── UI: credit input + threading + reset ─────────────────────────────────────
test("payment-select shows credit UI, clamps input, and offers full-credit confirm", () => {
  const i = pos.indexOf('posView === "payment-select"');
  const view = pos.slice(i, i + 4000);
  assert.match(view, /_fetchCustomerCredit\(_posCustomer\.id\)/, "fetches the customer's credit balance");
  assert.match(view, /_maxCredit = round2\(Math\.min\(_posCustomerCredit, round2\(amount\)\)\)/, "credit clamped to min(balance, amount)");
  assert.match(view, /posCreditFullConfirm/, "full-credit (payable 0) has its own confirm");
  assert.match(view, /_creditUsed = _maxCredit/, "ใช้เต็ม sets creditUsed to max");
});

test("cash-input / transfer collect the payable (amount - credit), not the full amount", () => {
  // Phase 566: สูตร payable ยกออกเป็น helper calcPayable() ร่วมกันทุกวิธีจ่าย (เดิม inline แยกจุด).
  //   เจตนาเดิมคงอยู่: เก็บ payable = amount(+VAT exclusive) − credit ไม่ใช่ยอดเต็ม.
  const ci = pos.indexOf('posView === "cash-input"');
  const cash = pos.slice(ci, ci + 3800);
  assert.match(cash, /const cashPay = calcPayable\(baseAmount, state\.paymentInfo, _creditUsed\)/, "cash-input computes payable via calcPayable helper");
  assert.match(cash, /const payable = cashPay\.payable/, "cash-input payable = amount - credit (helper)");
  // Audit fix: confirm handler อ่านยอดรับสด (paidNow) จาก numpadValue แล้ว gate กับ payable
  assert.match(cash, /paid(?:Now)? < payable/, "confirm gate uses payable (not full amount)");
  const ti = pos.indexOf('posView === "transfer-qr"');
  const tr = pos.slice(ti, ti + 3000);
  assert.match(tr, /calcPayable\(amount, state\.paymentInfo, _creditUsed\)/, "transfer computes payable via calcPayable (now VAT-exclusive too)");
  assert.match(tr, /_tPayable = _tPay\.payable/, "transfer collects payable = amount(+VAT) - credit (helper)");
});

test("credit state resets on success / clearPosState / renderPosPage", () => {
  const resets = (pos.match(/_resetCreditState\(\)/g) || []).length;
  assert.ok(resets >= 4, `_resetCreditState must run at definition + 3 reset points (found ${resets})`);
});

test("balance fetch is read-only (no write to the ledger from the client)", () => {
  const i = pos.indexOf("async function _fetchCustomerCredit(");
  const fn = pos.slice(i, i + 700);
  assert.ok(!/method:\s*"POST"|method:\s*"PATCH"|rpc\//.test(fn), "balance fetch must be a read (no write/RPC)");
  assert.match(fn, /customer_credit_ledger\?customer_id=eq/, "reads the ledger by customer");
});

// ── B1 fix: credit-use gated by accounting effective date (same gate as JV) ──
test("the effective-date gate function itself works (before vs on go-live)", () => {
  assert.equal(_isAfterEffective("2026-06-23"), false, "before 1 ก.ค. → credit must be OFF (JV would skip → mismatch)");
  assert.equal(_isAfterEffective("2026-06-30"), false, "still before go-live");
  assert.equal(_isAfterEffective("2026-07-01"), true, "on go-live → credit ON (JV posts Dr 2180)");
  assert.equal(_isAfterEffective("2026-08-15"), true, "after go-live");
});

test("credit UI + creditUsed are gated by _isAfterEffective(todayBkk()) — no ledger move before JV active", () => {
  assert.match(pos, /import \{ postJournalForSale, _isAfterEffective \}/, "must reuse the JV effective-date helper");
  // UI gate (primary): credit box only shows from the effective date
  assert.match(pos, /_showCredit = !!\(_posCustomer\?\.id && _posCustomerCredit > 0\) && _creditEnabled/, "credit UI must be gated by effective date");
  assert.match(pos, /_creditEnabled = _isAfterEffective\(todayBkk\(\)\)/, "gate uses _isAfterEffective(todayBkk())");
  // redeem/payload gate (defense-in-depth): before effective → creditUsed forced to 0
  assert.match(cbHead, /const creditUsed = \(_posCustomer\?\.id && _isAfterEffective\(todayBkk\(\)\)\) \? round2/, "creditUsed must be 0 before the effective date (no redeem / no ledger move)");
});

// ── receipt shows credit used ────────────────────────────────────────────────
test("receipt surfaces credit used + actual paid when credit_used_amount > 0", () => {
  assert.match(mainJs, /credit_used_amount \|\| 0\) > 0 \?[\s\S]*?ใช้เครดิต/, "receipt shows ใช้เครดิต when credit used");
  assert.match(mainJs, /ชำระจริง/, "receipt relabels รับเงิน → ชำระจริง for credit sales");
});
