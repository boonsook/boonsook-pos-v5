-- ═══════════════════════════════════════════════════════════
--  Phase 88.21 — VAT Support (MVP)
--
--  รองรับภาษีมูลค่าเพิ่ม (VAT 7%) สำหรับร้านค้าที่จดทะเบียนภาษี
--
--  เพิ่ม:
--    - COA 1170 (Input VAT — ภาษีซื้อ)
--    - COA 2170 (Output VAT — ภาษีขาย)
--    - Mappings: vat_output / vat_input
--    - Sales table: column `vat_amount` + `vat_rate` + `subtotal_before_vat`
--    - Expenses table: column `vat_amount` + `vat_rate`
--
--  Workflow:
--    ขาย VAT 7%:
--      Dr 1110 (เงินสด)        107.00
--      Cr 4100 (รายได้)               100.00
--      Cr 2170 (Output VAT)            7.00
--
--    ซื้อ VAT 7%:
--      Dr 5xxx (ค่าใช้จ่าย)     100.00
--      Dr 1170 (Input VAT)        7.00
--      Cr 1110 (เงินสด)              107.00
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) เพิ่ม COA สำหรับ VAT
-- ───────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order, is_active) VALUES
  ('1170', 'ภาษีซื้อ (Input VAT) — ขอเครดิตได้', 'asset',     '1100', 1170, true),
  ('2170', 'ภาษีขาย (Output VAT) — รอนำส่งสรรพากร', 'liability', '2100', 2170, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  type        = EXCLUDED.type,
  parent_code = EXCLUDED.parent_code,
  sort_order  = EXCLUDED.sort_order,
  is_active   = EXCLUDED.is_active;


-- ───────────────────────────────────────────────────────────
-- 2) Mapping ไม่ต้องเพิ่ม — auto_post.js hardcode "2170"/"1170" ตรงๆ
--    (เผื่ออนาคต mapping editor UI จะใช้ code 2170/1170 อยู่แล้ว)
-- ───────────────────────────────────────────────────────────


-- ───────────────────────────────────────────────────────────
-- 3) เพิ่ม columns ใน sales table
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate   NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_before_vat NUMERIC(15,2);

COMMENT ON COLUMN public.sales.vat_amount IS 'จำนวนภาษีมูลค่าเพิ่ม (Output VAT) — เป็น 0 ถ้าไม่จด VAT';
COMMENT ON COLUMN public.sales.vat_rate IS 'อัตราภาษี (เช่น 7 = 7%) — เป็น 0 ถ้าไม่จด VAT';
COMMENT ON COLUMN public.sales.subtotal_before_vat IS 'ยอดก่อน VAT (สำหรับ break down JV)';


-- ───────────────────────────────────────────────────────────
-- 4) เพิ่ม columns ใน expenses table (VAT ซื้อ)
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate   NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_before_vat NUMERIC(15,2);

COMMENT ON COLUMN public.expenses.vat_amount IS 'ภาษีซื้อ (Input VAT) — ขอเครดิตได้';


-- ───────────────────────────────────────────────────────────
-- 5) เพิ่ม columns ใน delivery_invoices table
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.delivery_invoices
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate   NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_before_vat NUMERIC(15,2);


-- ───────────────────────────────────────────────────────────
-- 6) Reload PostgREST schema cache
-- ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────
-- 7) Verify
-- ───────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.chart_of_accounts WHERE code IN ('1170','2170')) AS coa_added,
  (SELECT COUNT(*) FROM public.account_mapping WHERE mapping_key IN ('vat_output','vat_input')) AS mapping_added,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sales' AND column_name IN ('vat_amount','vat_rate','subtotal_before_vat')) AS sales_columns,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='expenses' AND column_name IN ('vat_amount','vat_rate','amount_before_vat')) AS expenses_columns;

-- Expected: 2 | 2 | 3 | 3
