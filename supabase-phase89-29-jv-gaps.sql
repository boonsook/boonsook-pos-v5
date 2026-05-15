-- ═══════════════════════════════════════════════════════════
--  Phase 89.29 — JV gaps fix (audit C2 + C3 + C4)
-- ═══════════════════════════════════════════════════════════
--  Adds:
--    1. Account 4110 "รับคืนสินค้า/ส่วนลด" (contra-revenue)
--    2. Mapping refund_cash     (Dr 4110 / Cr 1110)
--    3. Mapping refund_transfer (Dr 4110 / Cr 1130)
--
--  Notes:
--    - Credit payment (C2) reuses existing receipt_payment/receipt_transfer
--      mappings — no new mapping needed.
--    - Expense edit (C4) reuses voidJvForSource + postJournalForExpense —
--      no DB change needed beyond running this seed.
--
--  Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- 1) Seed contra-revenue account 4110
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order, is_active) VALUES
  ('4110', 'รับคืนสินค้า/ส่วนลดจ่าย (contra-revenue)', 'income', '4000', 4110, true)
ON CONFLICT (code) DO NOTHING;

-- 2) Seed refund mappings
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES
  ('refund_cash',     'คืนเงินลูกค้า — เงินสด',         '4110', '1110'),
  ('refund_transfer', 'คืนเงินลูกค้า — โอนเงิน',         '4110', '1130')
ON CONFLICT (mapping_key) DO NOTHING;

-- 3) Verify
SELECT
  (SELECT COUNT(*) FROM public.chart_of_accounts WHERE code = '4110')        AS account_4110_exists,
  (SELECT COUNT(*) FROM public.account_mapping WHERE mapping_key = 'refund_cash')     AS mapping_refund_cash,
  (SELECT COUNT(*) FROM public.account_mapping WHERE mapping_key = 'refund_transfer') AS mapping_refund_transfer;

-- Expected:
--   account_4110_exists:     1
--   mapping_refund_cash:     1
--   mapping_refund_transfer: 1
