-- ═══════════════════════════════════════════════════════════
--  Phase 88.16 — Solar Revenue Mapping (9 พ.ค.)
--
--  เดิม: งาน solar fallback → service_other → 4240 (รายได้บริการอื่นๆ)
--  ใหม่: งาน solar → service_solar → 4300 (รายได้บริการ — โซล่าเซลล์)
--
--  ส่วน:
--    1) เพิ่ม COA account 4300 (income — solar)
--    2) เพิ่ม account_mapping 'service_solar'
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) เพิ่ม COA 4300
-- ───────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order, is_active) VALUES
  ('4300', 'รายได้บริการ — โซล่าเซลล์', 'income', '4000', 300, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  type        = EXCLUDED.type,
  parent_code = EXCLUDED.parent_code,
  sort_order  = EXCLUDED.sort_order,
  is_active   = EXCLUDED.is_active;


-- ───────────────────────────────────────────────────────────
-- 2) เพิ่ม account_mapping 'service_solar'
-- ───────────────────────────────────────────────────────────
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES
  ('service_solar', 'รายได้บริการ — โซล่าเซลล์', '1110', '4300')
ON CONFLICT (mapping_key) DO UPDATE SET
  description         = EXCLUDED.description,
  debit_account_code  = EXCLUDED.debit_account_code,
  credit_account_code = EXCLUDED.credit_account_code;


-- ───────────────────────────────────────────────────────────
-- 3) Reload PostgREST schema cache (กัน PGRST204)
-- ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────
-- 4) Verify
-- ───────────────────────────────────────────────────────────
-- ดู COA 4300
SELECT code, name, type, parent_code FROM public.chart_of_accounts
WHERE code = '4300';

-- ดู mapping service_solar
SELECT mapping_key, debit_account_code, credit_account_code, description
FROM public.account_mapping
WHERE mapping_key = 'service_solar';

-- ดู service mapping ทั้งหมด (ควรได้ 12 ตัว — เดิม 11 + solar)
SELECT mapping_key, debit_account_code, credit_account_code
FROM public.account_mapping
WHERE mapping_key LIKE 'service_%' ORDER BY mapping_key;

-- Expected:
--   COA 4300 × 1
--   service_solar mapping × 1 (Dr 1110 / Cr 4300)
--   service_* mappings × 12 รวม
