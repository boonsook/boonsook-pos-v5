-- ═══════════════════════════════════════════════════════════════════════
-- Phase 438 — customer group field
-- ═══════════════════════════════════════════════════════════════════════
-- Adds customers.customer_group (nullable text) so each contact can be
-- classified by group: ราชการ / ขาย POS / งานช่าง / หน้าร้าน / ขายพร้อมติดตั้ง.
-- Used in Phase 439+ to auto-fill the correct receiving bank account on
-- receipts / quotations (group → bank sub-account 1131-1136), to prevent
-- picking the wrong transfer account.
--
-- SAFE / ADDITIVE — does NOT touch money / stock / accounting:
--   • column is nullable, no DEFAULT, no CHECK (values are controlled by the
--     UI dropdown; a future group can be added without DDL). NULL = "ไม่ระบุกลุ่ม".
--   • no data backfill — existing customers stay NULL.
--   • additive read-compatible: existing queries that don't select the column
--     are unaffected.
--
-- Run once in Supabase SQL Editor. Idempotent (IF NOT EXISTS → re-run safe).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_group text;

-- Reload PostgREST schema cache so the new column is queryable immediately
-- (prevents PGRST204 "column not found" right after migration).
NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────
-- Expect 1 row: customer_group | text | YES
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'customers' AND column_name = 'customer_group';
