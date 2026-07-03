// Phase 556 — re-post receipt JV when the Dr basis changes (payment method / receiving bank)
// Run: node --test tests/receipt_multipay_repost_guard.test.js
//
// Why this exists:
//   A paid receipt already has an RV journal entry whose Dr account was chosen at post time
//   from payment_method (transfer/โอน/qr/bank → 1130, else 1110) + an optional bank_coa_code
//   sub-account override (e.g. 1132). Three edit surfaces changed those fields WITHOUT
//   re-posting the JV → the JV silently kept the OLD Dr account:
//     (a) multi-payment saveBtn (rcMultiPaySave)   — changes primary payment_method
//     (b) payment-method dropdown (rcEditPayMethod) — changes payment_method
//     (c) edit-save (rcEdSave)                      — changes bank_coa_code (receiving bank)
//   Phase 556 routes all three through one helper that void+reposts the JV — but ONLY when the
//   Dr account actually changes (crossing the transfer↔non-transfer boundary, or a bank change),
//   normalising Thai/English so "เงินสด"→"cash" (same 1110 account) does NOT churn the doc number.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// receipts.js imports auto_post (reads window at call-time). A minimal stub keeps import safe.
globalThis.window = globalThis.window || { SUPABASE_CONFIG: { url: "x", anonKey: "x" }, App: {} };
const { receiptJvRepostNeeded } = await import("../modules/receipts.js");

const src = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");

// ── pure decision: repost only when the Dr account really changes ──────────────
test("no repost when the account is unchanged (Thai↔English same 1110)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "เงินสด", newMethod: "cash", status: "paid" }), false);
  assert.equal(receiptJvRepostNeeded({ prevMethod: "cash", newMethod: "cash", status: "paid" }), false);
});

test("no repost for cash↔cheque↔credit (all Dr 1110)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "cash", newMethod: "cheque", status: "paid" }), false);
  assert.equal(receiptJvRepostNeeded({ prevMethod: "เช็ค", newMethod: "credit", status: "paid" }), false);
});

test("repost when crossing the transfer boundary (1110 ↔ 1130)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "cash", newMethod: "transfer", status: "paid" }), true);
  assert.equal(receiptJvRepostNeeded({ prevMethod: "เงินสด", newMethod: "โอนเงิน", status: "paid" }), true);
  assert.equal(receiptJvRepostNeeded({ prevMethod: "transfer", newMethod: "cash", status: "paid" }), true);
});

test("no repost when both sides are transfer (same 1130 boundary), even Thai↔English", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "โอนเงิน", newMethod: "transfer", status: "paid" }), false);
});

test("repost when the receiving bank sub-account changes (method unchanged)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "transfer", newMethod: "transfer", prevBank: "1132", newBank: "1133", status: "paid" }), true);
  // null → set a bank also counts
  assert.equal(receiptJvRepostNeeded({ prevMethod: "transfer", newMethod: "transfer", prevBank: null, newBank: "1132", status: "paid" }), true);
});

test("no repost when nothing accounting-relevant changed (bank same, method same bucket)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "transfer", newMethod: "transfer", prevBank: "1132", newBank: "1132", status: "paid" }), false);
});

test("status not paid → never repost (no JV exists yet)", () => {
  assert.equal(receiptJvRepostNeeded({ prevMethod: "cash", newMethod: "transfer", status: "pending" }), false);
  assert.equal(receiptJvRepostNeeded({ prevMethod: "cash", newMethod: "transfer", status: "" }), false);
});

// ── source wiring: pure gate + helper + three call sites ──────────────────────
test("receiptJvRepostNeeded normalises via _payIs (not raw string compare) + gates on paid", () => {
  assert.match(src, /export function receiptJvRepostNeeded/, "exported pure decision");
  assert.match(src, /_payIs\(prevMethod,\s*"transfer"\)\s*!==\s*_payIs\(newMethod,\s*"transfer"\)/, "Dr boundary via _payIs (Thai/Eng safe)");
  assert.match(src, /String\(prevBank\s*\|\|\s*""\)\s*!==\s*String\(newBank\s*\|\|\s*""\)/, "bank change detected");
  assert.match(src, /status\s*\|\|\s*""\)\.toLowerCase\(\)\s*!==\s*"paid"/, "gated on paid");
});

test("helper voids + reposts, and surfaces the period-locked case (no silent dup)", () => {
  assert.match(src, /async function _repostReceiptJvIfChanged/, "async helper exists");
  assert.match(src, /voidJvForSource\("receipts",\s*r\.id\)/, "voids existing JV by source");
  assert.match(src, /postJournalForReceipt\(\s*\{\s*\.\.\.r,\s*payment_method:\s*newMethod,\s*bank_coa_code:\s*newBank/, "reposts with new method+bank");
  assert.match(src, /reason\s*===\s*"duplicate"/, "detects 409/period-lock (JV not cleared) and warns");
});

test("all three edit surfaces route through the helper", () => {
  const calls = (src.match(/await _repostReceiptJvIfChanged\(r,\s*\{/g) || []).length;
  assert.equal(calls, 3, "multipay saveBtn + payment-method dropdown + edit-save(bank) all call the helper");
});
