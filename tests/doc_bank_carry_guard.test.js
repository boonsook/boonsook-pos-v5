// Phase 440 (B2a) — receiving-bank carry + display on document chain guard
// Run: node --test tests/doc_bank_carry_guard.test.js
//
// Why this exists:
//   The receipt must show the CORRECT transfer bank, resolved from the customer's
//   group at the quotation stage (documents have no customer_id) and carried — as a
//   FROZEN snapshot (bank_coa_code + bank_label) — down quotation→invoice→receipt.
//   These guards lock: SQL adds the columns (additive), the quotation resolves the
//   bank on customer-pick and snapshots the label from the CHOSEN bank (reviewer #3),
//   every conversion carries it, all three prints DISPLAY it from the stored row
//   (NOT a live settings lookup — reviewer #5), and the quotation never posts a JV
//   from a bank field (reviewer #2 — a quotation is not a financial document).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sql      = fs.readFileSync(path.resolve("supabase-phase440-doc-bank.sql"), "utf8");
const sqlCode  = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
const quote    = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");
const invoice  = fs.readFileSync(path.resolve("modules/delivery_invoices.js"), "utf8");
const receipts = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");

// ── 1. SQL: bank_coa_code + bank_label on the 3 docs, nullable, idempotent ───
test("SQL adds bank_coa_code + bank_label on quotations/delivery_invoices/receipts (additive)", () => {
  for (const t of ["quotations", "delivery_invoices", "receipts"]) {
    assert.match(sqlCode, new RegExp(`ALTER TABLE ${t}\\s+ADD COLUMN IF NOT EXISTS bank_coa_code text`), `${t}.bank_coa_code`);
    assert.match(sqlCode, new RegExp(`ALTER TABLE ${t}\\s+ADD COLUMN IF NOT EXISTS bank_label\\s+text`), `${t}.bank_label`);
  }
  assert.ok(!/NOT NULL/i.test(sqlCode), "columns must be nullable (additive)");
  assert.match(sqlCode, /NOTIFY pgrst/, "must reload PostgREST schema");
});

// ── 2. quotation: resolve on pick + snapshot from chosen bank + carry + print ─
test("quotation imports resolver and auto-fills bank from the picked customer's group", () => {
  assert.match(quote, /import\s*\{[^}]*resolveBankForCustomerGroup[^}]*\}\s*from\s*["']\.\/customer_groups\.js["']/);
  assert.match(quote, /resolveBankForCustomerGroup\(\s*c\.customer_group/, "must resolve from the picked customer's group");
  assert.match(quote, /id="qt_bankCoa"/, "quotation form must render the bank select");
});

test("quotation snapshots bank_label from the SELECTED bank (reviewer #3 — freeze, not re-derive)", () => {
  assert.match(quote, /\.find\(b => b\.coaCode === _bankCoa\)/,
    "save must look up the chosen bank by its coaCode to freeze the label");
  assert.match(quote, /bank_coa_code:\s*_bankCoa/, "save payload carries bank_coa_code");
  assert.match(quote, /bank_label:\s*_bankLabel/, "save payload carries the snapshotted bank_label");
});

test("quotation carries bank into invoicePayload + shows it on the quotation print", () => {
  assert.match(quote, /bank_coa_code:\s*q\.bank_coa_code[\s\S]{0,60}bank_label:\s*q\.bank_label/, "invoicePayload carries bank");
  assert.match(quote, /q\.bank_label\s*\?[\s\S]{0,60}บัญชีรับโอน/, "quotation print shows q.bank_label");
});

// ── 3. delivery invoice: carry + print ───────────────────────────────────────
test("delivery invoice carries bank into receiptPayload + shows it on the invoice print", () => {
  assert.match(invoice, /bank_coa_code:\s*inv\.bank_coa_code[\s\S]{0,60}bank_label:\s*inv\.bank_label/, "receiptPayload carries bank");
  assert.match(invoice, /inv\.bank_label\s*\?[\s\S]{0,60}บัญชีรับโอน/, "invoice print shows inv.bank_label");
});

// ── 4. receipt print: read frozen row snapshot, NOT a live settings lookup (#5) ──
test("receipt print shows r.bank_label from the row, gated on transfer; no live re-resolve", () => {
  assert.match(receipts, /_payIs\(r\.payment_method,\s*'transfer'\)\s*&&\s*r\.bank_label[\s\S]{0,40}escHtml\(r\.bank_label\)/,
    "receipt print must read r.bank_label (the stored row), only when transfer");
  assert.ok(!/resolveBankForCustomerGroup/.test(receipts),
    "receipt must NOT live-resolve from the customer group — a later settings change must not alter old receipts (#5)");
});

// ── 5. quotation never posts a JV from a bank field (reviewer #2) ────────────
test("quotations.js does not post a journal entry (quotation is not a financial document)", () => {
  // strip line comments — quotations.js documents (in comments) that postJournalForDeliveryInvoice
  // was removed/guarded; we assert no ACTIVE call, not the prose about its removal.
  const quoteCode = quote.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/postJournal/i.test(quoteCode),
    "quotation path must never CALL postJournal* — the bank on a quotation is display-only");
});
