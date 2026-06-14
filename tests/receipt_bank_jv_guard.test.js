// Phase 443 (C) — receipt JV routes to its bank sub-account guard
// Run: node --test tests/receipt_bank_jv_guard.test.js
//
// Why this exists:
//   Closing the customer-group→bank feature: a receipt paid by transfer must post its
//   JV Dr to the SPECIFIC bank sub-account (e.g. 1132), not the flat 1130. The Dr is
//   chosen from receipt.bank_coa_code (the snapshot from B2a/B2b) but MUST be validated
//   against the active chart of accounts first (reviewer #1) — an invalid/stale code
//   falls back to the mapping default and warns, never posts a JV to a bogus account
//   (reviewer #2/#3). Accounting uses bank_coa_code ONLY; bank_label is display-only
//   (reviewer #5). The routing decision is a pure function so it is unit-tested directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// auto_post reads window at call-time; a minimal stub lets us import the pure helper safely.
globalThis.window = globalThis.window || { SUPABASE_CONFIG: { url: "x", anonKey: "x" }, App: {} };
const { _resolveReceiptDebitAccount } = await import("../modules/accounting/auto_post.js");

const auto = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
// slice the postJournalForReceipt body (helper is defined before it, so this is the fn only)
const s = auto.indexOf("export async function postJournalForReceipt");
const e = auto.indexOf("\nexport ", s + 30);
const fn = auto.slice(s, e > -1 ? e : undefined);

// ── 1. pure routing decision (behavioral) ───────────────────────────────────
test("valid bank_coa_code routes the Dr to that sub-account (1132, not the 1130 default)", () => {
  assert.equal(_resolveReceiptDebitAccount("1132", "1130", new Set(["1130", "1132", "4150"])), "1132");
});

test("INVALID bank_coa_code falls back to the mapping default — reviewer #2/#3", () => {
  assert.equal(_resolveReceiptDebitAccount("9999", "1130", new Set(["1130", "1132"])), "1130");
});

test("empty / missing COA cache fails open to the candidate (DB FK is the backstop)", () => {
  assert.equal(_resolveReceiptDebitAccount("1132", "1130", new Set()), "1132");
  assert.equal(_resolveReceiptDebitAccount("1132", "1130", null), "1132");
});

test("no candidate → mapping default (cash path / receipt without a bank)", () => {
  assert.equal(_resolveReceiptDebitAccount("", "1130", new Set(["1130"])), "1130");
  assert.equal(_resolveReceiptDebitAccount(null, "1130", new Set(["1130"])), "1130");
});

// ── 2. wiring: both JV Dr lines route via debitAccount (VAT-split + no-VAT) — reviewer #4 ──
test("postJournalForReceipt uses debitAccount for BOTH Dr lines (VAT-split + no-VAT)", () => {
  const hits = (fn.match(/account_code: debitAccount,/g) || []).length;
  assert.equal(hits, 2, "both the VAT-split and the no-VAT Dr line must route via debitAccount");
  assert.ok(!/account_code: mapping\.debit_account_code/.test(fn),
    "receipt Dr lines must not post directly to the mapping default — they route via debitAccount");
});

test("validation wired (resolver + COA cache); credit account unchanged", () => {
  assert.match(fn, /_resolveReceiptDebitAccount\(/, "must use the pure routing helper");
  assert.match(fn, /_getValidCoaCodes\(\)/, "must validate the bank code against active COA");
  assert.match(fn, /receipt\.bank_coa_code/, "must read bank_coa_code from the receipt");
  assert.match(fn, /account_code: mapping\.credit_account_code/, "Cr account (revenue 4150) stays the mapping value");
});

// ── 3. accounting uses bank_coa_code only — bank_label is display-only (reviewer #5) ─────
test("postJournalForReceipt never references bank_label for the JV", () => {
  // strip line comments — the code comment explains bank_label is NOT used; assert no actual reference
  const fnCode = fn.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/bank_label/.test(fnCode), "bank_label is display/snapshot only — the JV must use bank_coa_code");
});
