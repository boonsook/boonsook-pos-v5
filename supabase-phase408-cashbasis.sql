-- ═══════════════════════════════════════════════════════════
-- Phase 408 — Cash-basis revenue (รับรู้รายได้ที่ใบเสร็จ paid)
-- ═══════════════════════════════════════════════════════════
-- รันโดย owner ใน Supabase SQL editor ก่อน smoke (และก่อน Phase B migration)
--
-- เปลี่ยนการรับรู้รายได้สายเครดิต (ใบเสนอราคา→ใบส่งของ→ใบเสร็จ)
-- จาก accrual (ลง revenue ตอนออกใบส่งของ) → cash-basis (ลง revenue ตอนใบเสร็จ paid)
--
-- mapping ใหม่ที่ postJournalForReceipt ใช้:
--   receipt_revenue_cash     Dr 1110 เงินสด        / Cr 4150 รายได้
--   receipt_revenue_transfer Dr 1130 เงินฝากธนาคาร / Cr 4150 รายได้
--
-- ⚠️ ห้ามแตะ mapping เดิม receipt_payment / receipt_transfer (Cr 1200 A/R)
--    — postJournalForCreditPayment (รับชำระลูกหนี้ POS credit-sale) ยังใช้อยู่
-- ═══════════════════════════════════════════════════════════

INSERT INTO account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES
  ('receipt_revenue_cash',     'รับเงินสด → รายได้ (cash-basis)', '1110', '4150'),
  ('receipt_revenue_transfer', 'รับโอน → รายได้ (cash-basis)',    '1130', '4150')
ON CONFLICT (mapping_key) DO UPDATE SET
  debit_account_code  = EXCLUDED.debit_account_code,
  credit_account_code = EXCLUDED.credit_account_code,
  is_active           = true;

NOTIFY pgrst, 'reload schema';
