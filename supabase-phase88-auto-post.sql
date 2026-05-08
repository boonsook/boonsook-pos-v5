-- ═══════════════════════════════════════════════════════════
--  Phase 88.1 — Auto-posting infrastructure
--  Date: 2026-05-08
--
--  ต้อง:
--   1. Idempotency — กัน duplicate JV ถ้า insert source ซ้ำ
--      → unique partial index บน (source_table, source_id)
--   2. Account mapping — config ผูก source category → debit/credit account
--      → admin แก้ผ่าน Supabase ตรงๆ (UI mapping editor: Phase 88.1c)
--   3. Seed default mappings สำหรับ sales/expenses (88.1a) +
--      service jobs/receipts/payroll (88.1b)
--
--  Pre-req: รัน supabase-phase88-accounting-foundation.sql ไปแล้ว
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) Idempotency: unique partial index (source_table, source_id)
-- ───────────────────────────────────────────────────────────
-- หมายเหตุ: ใช้ partial index เพราะ NULL ไม่นับเป็น duplicate ใน UNIQUE
-- (manual JV ไม่มี source — source_table = NULL → ใส่ได้หลายอัน)
DROP INDEX IF EXISTS public.idx_je_source_unique;
CREATE UNIQUE INDEX idx_je_source_unique
  ON public.journal_entries (source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;


-- ───────────────────────────────────────────────────────────
-- 2) account_mapping (config — source category → JV accounts)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_mapping (
  id                   BIGSERIAL PRIMARY KEY,
  mapping_key          TEXT UNIQUE NOT NULL,                                 -- "sale_cash", "expense_fuel", etc.
  description          TEXT,                                                 -- คำอธิบายภาษาไทย
  debit_account_code   TEXT REFERENCES public.chart_of_accounts(code),
  credit_account_code  TEXT REFERENCES public.chart_of_accounts(code),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_am_active ON public.account_mapping(is_active) WHERE is_active = true;

-- RLS — admin only
ALTER TABLE public.account_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_admin" ON public.account_mapping;
CREATE POLICY "am_admin" ON public.account_mapping
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());


-- ───────────────────────────────────────────────────────────
-- 3) Seed default mappings (Phase 88.1a + 88.1b)
-- ───────────────────────────────────────────────────────────
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES

  -- ── POS sales (Phase 88.1a) ──
  ('sale_cash',         'POS ขาย — เงินสด',                     '1110', '4100'),
  ('sale_transfer',     'POS ขาย — โอนเงิน/QR',                 '1130', '4100'),
  ('sale_credit',       'POS ขาย — บัตรเครดิต',                 '1130', '4100'),
  ('sale_credit_term',  'POS ขาย — เครดิตเทอม (ลูกหนี้)',        '1200', '4100'),

  -- ── Expenses (Phase 88.1a) — Dr ค่าใช้จ่าย / Cr เงินสด ──
  ('expense_fuel',         'ค่าน้ำมัน',                  '5210', '1110'),
  ('expense_utility',      'ค่าน้ำ-ค่าไฟ',              '5220', '1110'),
  ('expense_phone',        'ค่าโทรศัพท์-อินเทอร์เน็ต',   '5230', '1110'),
  ('expense_rent',         'ค่าเช่า',                    '5240', '1110'),
  ('expense_repair',       'ค่าซ่อมแซม-บำรุง',          '5250', '1110'),
  ('expense_supplies',     'ค่าวัสดุสิ้นเปลือง',         '5260', '1110'),
  ('expense_ads',          'ค่าโฆษณา',                  '5270', '1110'),
  ('expense_bank_fee',     'ค่าธรรมเนียมธนาคาร',        '5280', '1110'),
  ('expense_travel',       'ค่าใช้จ่ายเดินทาง',          '5290', '1110'),
  ('expense_misc',         'ค่าใช้จ่ายเบ็ดเตล็ด',       '5900', '1110'),

  -- ── Service jobs (Phase 88.1b — รายได้บริการ) ──
  ('service_install_ac',   'รายได้บริการ — ติดตั้งแอร์',  '1110', '4200'),
  ('service_repair_ac',    'รายได้บริการ — ซ่อมแอร์',    '1110', '4210'),
  ('service_clean_ac',     'รายได้บริการ — ล้างแอร์',    '1110', '4220'),
  ('service_move_ac',      'รายได้บริการ — ย้ายแอร์',    '1110', '4230'),
  ('service_other',         'รายได้บริการ — อื่นๆ',      '1110', '4240'),

  -- ── Receipt payment (Phase 88.1b — รับชำระลูกหนี้) ──
  ('receipt_payment',      'รับชำระจากลูกหนี้',           '1110', '1200'),
  ('receipt_transfer',     'รับชำระโอน',                 '1130', '1200'),

  -- ── Payroll (Phase 88.1b) ──
  ('payroll_salary',       'จ่ายเงินเดือน',               '5200', '1110'),
  ('payroll_wht',          'ภาษีหัก ณ ที่จ่าย พนักงาน',   '5200', '2140')

ON CONFLICT (mapping_key) DO NOTHING;


-- ───────────────────────────────────────────────────────────
-- 4) Verify
-- ───────────────────────────────────────────────────────────
SELECT
  COUNT(*) AS total_mappings,
  COUNT(*) FILTER (WHERE mapping_key LIKE 'sale_%')     AS sales,
  COUNT(*) FILTER (WHERE mapping_key LIKE 'expense_%')  AS expenses,
  COUNT(*) FILTER (WHERE mapping_key LIKE 'service_%')  AS services,
  COUNT(*) FILTER (WHERE mapping_key LIKE 'receipt_%')  AS receipts,
  COUNT(*) FILTER (WHERE mapping_key LIKE 'payroll_%')  AS payroll
FROM public.account_mapping;

-- Expected:
--   total_mappings: 22
--   sales:           4
--   expenses:       10
--   services:        5
--   receipts:        2
--   payroll:         2
