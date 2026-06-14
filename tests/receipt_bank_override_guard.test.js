// Phase 442 (B2b) — receipt bank override + transfer-no-bank warn guard
// Run: node --test tests/receipt_bank_override_guard.test.js
//
// Why this exists:
//   B2a auto-fills + carries the receiving bank onto the receipt. B2b lets a cashier
//   OVERRIDE it on the receipt (bill paid to a different account) and WARNS — not
//   blocks — when collecting a TRANSFER receipt that still has no bank set, so the
//   document bank is never silently left blank / defaulted (reviewer #4). The warn
//   must fire BEFORE postJournalForReceipt at both collect paths (reviewer #5 — a warn
//   after posting is too late), the label is snapshotted from the chosen bank (#3),
//   single-bank only (#5), and there is NO silent "1130" fallback (#6). B2b does NOT
//   touch the JV itself — Dr-by-real-bank is Phase C.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const receipts = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");

// ── 1. edit drawer: bank override select + snapshot label from CHOSEN bank ───
test("receipt edit drawer renders a bank select from paymentInfo.banks", () => {
  assert.match(receipts, /id="rcEdBankCoa"/, "edit drawer must have the bank override select");
  assert.match(receipts, /paymentInfo\?\.banks[\s\S]{0,80}?\.filter\(b => b\.coaCode\)/, "options from paymentInfo.banks (with coaCode)");
});

test("edit save snapshots bank_label from the SELECTED bank (reviewer #3), carries bank_coa_code", () => {
  assert.match(receipts, /\.find\(b => b\.coaCode === _edBankCoa\)/, "label looked up by chosen coaCode (snapshot, not group)");
  assert.match(receipts, /bank_coa_code:\s*_edBankCoa/, "edit payload carries bank_coa_code");
  assert.match(receipts, /bank_label:\s*_edBankLabel/, "edit payload carries the snapshotted bank_label");
});

// ── 2. transfer-no-bank warn helper (warn, not block) ────────────────────────
test("_confirmTransferBankSet warns only for transfer with no bank, via App.confirm", () => {
  assert.match(receipts, /async function _confirmTransferBankSet\(r\)/, "helper must exist");
  assert.match(receipts, /if \(!_payIs\(r\.payment_method, "transfer"\) \|\| r\.bank_coa_code\) return true/,
    "must pass through (true) for non-transfer or when a bank is already set");
  assert.match(receipts, /_confirmTransferBankSet[\s\S]{0,400}window\.App\?\.confirm/, "must warn via App.confirm (warn + allow proceed, not a hard block)");
});

// ── 3. warn fires BEFORE postJournalForReceipt at BOTH collect paths (reviewer #5) ──
test("dropdown 'paid' action calls the warn before postJournalForReceipt", () => {
  const start = receipts.indexOf("actionConfig = {");
  const warn = receipts.indexOf("_confirmTransferBankSet(r)", start);
  const post = receipts.indexOf("postJournalForReceipt({", start);
  assert.ok(warn > -1 && post > -1 && warn < post, "dropdown: _confirmTransferBankSet must precede postJournalForReceipt");
});

test("preview collect calls the warn before postJournalForReceipt", () => {
  const start = receipts.indexOf("rcPreviewCollect");
  const warn = receipts.indexOf("_confirmTransferBankSet(r)", start);
  const post = receipts.indexOf("postJournalForReceipt({", start);
  assert.ok(warn > -1 && post > -1 && warn < post, "preview: _confirmTransferBankSet must precede postJournalForReceipt");
});

// ── 4. no silent default + single-bank scope (reviewer #5/#6) ─────────────────
test("no silent 1130 fallback on the receipt bank (reviewer #6)", () => {
  assert.ok(!/bank_coa_code\s*\|\|\s*["']1130["']/.test(receipts), "must not fall back to '1130'");
  assert.ok(!/\|\|\s*["']1130["']/.test(receipts), "no '|| 1130' default anywhere in receipts.js");
});

test("documents single-bank scope — payments[] per-row not yet supported (reviewer #5)", () => {
  assert.match(receipts, /payments\[\] per-row/, "must note multi-pay per-row banks are out of scope");
});
