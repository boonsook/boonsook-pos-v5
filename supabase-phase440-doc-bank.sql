-- ═══════════════════════════════════════════════════════════════════════
-- Phase 440 (B2a) — receiving-bank on the document chain
-- ═══════════════════════════════════════════════════════════════════════
-- Carries the receiving bank account down quotation → delivery_invoice →
-- receipt so the receipt shows/records the CORRECT transfer account (resolved
-- from the customer's group, Phase 438/439), preventing wrong-bank receipts.
--
-- Two columns per document (reviewer notes #1 + #3 — snapshot, not a live ref):
--   • bank_coa_code text — the COA sub-account (1131-1136); Phase C auto_post
--     reads this to route the JV (Dr <bank> instead of the default 1130).
--   • bank_label    text — frozen "BankName Account#" captured from the bank
--     CHOSEN at issue-time, so a later settings change does NOT alter old docs.
--
-- SAFE / ADDITIVE: all nullable, no DEFAULT, no CHECK. Existing rows = NULL.
-- Does NOT touch money/JV/totals. No backfill.
--
-- Run once in Supabase SQL Editor before merging build 440 (else PGRST204 when
-- the document forms send the new columns). Idempotent (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE quotations        ADD COLUMN IF NOT EXISTS bank_coa_code text;
ALTER TABLE quotations        ADD COLUMN IF NOT EXISTS bank_label    text;
ALTER TABLE delivery_invoices ADD COLUMN IF NOT EXISTS bank_coa_code text;
ALTER TABLE delivery_invoices ADD COLUMN IF NOT EXISTS bank_label    text;
ALTER TABLE receipts          ADD COLUMN IF NOT EXISTS bank_coa_code text;
ALTER TABLE receipts          ADD COLUMN IF NOT EXISTS bank_label    text;

-- Reload PostgREST schema cache so the new columns are writable immediately.
NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────
-- Expect 6 rows (bank_coa_code | bank_label) × (quotations, delivery_invoices, receipts), all YES
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE column_name IN ('bank_coa_code', 'bank_label')
  AND table_name IN ('quotations', 'delivery_invoices', 'receipts')
ORDER BY table_name, column_name;
