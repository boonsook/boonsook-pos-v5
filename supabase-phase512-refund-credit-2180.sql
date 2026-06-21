-- Phase 512 - Refund credit/exchange customer liability mapping
-- Owner-run SQL (Supabase SQL Editor). Idempotent.
--
-- Policy:
--   cash refund     = Dr 4110 / Cr 1110
--   transfer refund = Dr 4110 / Cr 1130
--   credit refund   = Dr 4110 / Cr 2180
--   exchange refund = Dr 4110 / Cr 2180
--
-- STEP0 - inspect before applying:
SELECT code, name, type, parent_code, is_active
FROM public.chart_of_accounts
WHERE code IN ('2180', '4110', '1110', '1130')
ORDER BY code;

SELECT mapping_key, debit_account_code, credit_account_code, is_active
FROM public.account_mapping
WHERE mapping_key IN ('refund_cash', 'refund_transfer', 'refund_credit', 'refund_exchange')
ORDER BY mapping_key;

-- STEP1 - seed the dedicated customer-credit liability account.
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, is_active, sort_order, description)
VALUES (
  '2180',
  'เครดิตคงเหลือลูกค้า/เจ้าหนี้ลูกค้าจากใบลดหนี้',
  'liability',
  '2100',
  true,
  2180,
  'ยอดเครดิตคงเหลือลูกค้าจากใบลดหนี้ ใช้ล้างเมื่อออกบิลขายใหม่หรือคืนเงินภายหลัง'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  description = EXCLUDED.description,
  updated_at = now();

-- STEP2 - seed new refund mappings only; do not change existing cash/transfer mappings.
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code, is_active, notes)
VALUES
  (
    'refund_credit',
    'คืนสินค้าเป็นเครดิตคงเหลือลูกค้า',
    '4110',
    '2180',
    true,
    'Phase 512: customer keeps credit; no cash/bank leaves the store'
  ),
  (
    'refund_exchange',
    'คืนสินค้าเพื่อเปลี่ยนสินค้าใหม่',
    '4110',
    '2180',
    true,
    'Phase 512: exchange credit is cleared by a later sale/credit-use phase'
  )
ON CONFLICT (mapping_key) DO UPDATE SET
  description = EXCLUDED.description,
  debit_account_code = EXCLUDED.debit_account_code,
  credit_account_code = EXCLUDED.credit_account_code,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes,
  updated_at = now();

-- STEP3 - verify expected rows.
SELECT code, name, type, parent_code, is_active
FROM public.chart_of_accounts
WHERE code = '2180';

SELECT mapping_key, debit_account_code, credit_account_code, is_active
FROM public.account_mapping
WHERE mapping_key IN ('refund_cash', 'refund_transfer', 'refund_credit', 'refund_exchange')
ORDER BY mapping_key;

NOTIFY pgrst, 'reload schema';
