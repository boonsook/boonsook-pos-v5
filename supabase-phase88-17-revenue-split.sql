-- ═══════════════════════════════════════════════════════════
--  Phase 88.17/88.18 — Receipt Approval + Revenue Split (9 พ.ค.)
--
--  เปลี่ยน:
--    1) Rename COA 4100 — เน้นว่าเป็น POS หน้าร้าน
--    2) เพิ่ม COA 4150 — รายได้ B2B (งานราชการ/บริษัท)
--    3) เพิ่ม mapping 'invoice_credit' — Dr 1200 / Cr 4150
--       (สำหรับตอนออก delivery_invoice → ลง JV revenue ตอนนั้น)
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) Rename COA 4100 → ระบุชัดว่าเป็น POS
-- ───────────────────────────────────────────────────────────
UPDATE public.chart_of_accounts
SET name = 'รายได้ขายสินค้า — หน้าร้าน (POS)'
WHERE code = '4100';


-- ───────────────────────────────────────────────────────────
-- 2) เพิ่ม COA 4150 — รายได้ B2B
-- ───────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order, is_active) VALUES
  ('4150', 'รายได้ขายสินค้า — งานราชการ/บริษัท', 'income', '4000', 150, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  type        = EXCLUDED.type,
  parent_code = EXCLUDED.parent_code,
  sort_order  = EXCLUDED.sort_order,
  is_active   = EXCLUDED.is_active;


-- ───────────────────────────────────────────────────────────
-- 3) เพิ่ม mapping 'invoice_credit' (Dr 1200 / Cr 4150)
--    ใช้ตอน delivery_invoice ออกใหม่ (เครดิตเทอม → ลูกหนี้ + รายได้)
-- ───────────────────────────────────────────────────────────
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES
  ('invoice_credit', 'รายได้ขาย — ราชการ/บริษัท (ตอนออก invoice)', '1200', '4150')
ON CONFLICT (mapping_key) DO UPDATE SET
  description         = EXCLUDED.description,
  debit_account_code  = EXCLUDED.debit_account_code,
  credit_account_code = EXCLUDED.credit_account_code;


-- ───────────────────────────────────────────────────────────
-- 4) Reload PostgREST schema cache
-- ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────
-- 5) Verify
-- ───────────────────────────────────────────────────────────
-- COA 4100 + 4150
SELECT code, name, type FROM public.chart_of_accounts
WHERE code IN ('4100', '4150') ORDER BY code;

-- mapping invoice_credit
SELECT mapping_key, debit_account_code, credit_account_code, description
FROM public.account_mapping
WHERE mapping_key = 'invoice_credit';

-- Expected:
--   4100 = รายได้ขายสินค้า — หน้าร้าน (POS)
--   4150 = รายได้ขายสินค้า — งานราชการ/บริษัท
--   invoice_credit | 1200 | 4150
