-- ═══════════════════════════════════════════════════════════
--  Phase 88.0 — Accounting Foundation
--  Date: 2026-05-08
--
--  สร้างโครงสร้างบัญชีพื้นฐานสำหรับ Boonsook POS
--  - chart_of_accounts (ผังบัญชี)
--  - journal_entries (สมุดรายวัน — header)
--  - journal_lines (รายการ debit/credit ต่อ entry)
--  - fiscal_periods (งวดบัญชี)
--
--  Constraints:
--   - Double-entry: total_debit = total_credit ใน entry
--   - One side only ใน line: debit > 0 หรือ credit > 0 (ไม่ใช่ทั้งคู่)
--
--  RLS: เข้าถึงได้เฉพาะ admin (helper is_accountant)
--
--  How to run:
--    1. Supabase Dashboard → SQL Editor → New query
--    2. paste ทั้งไฟล์ → Run
--    3. ตรวจ "Success" + ผังบัญชี seed 50 บัญชี
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) chart_of_accounts (ผังบัญชี)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  code         TEXT PRIMARY KEY,                                            -- "1110", "5200", etc.
  name         TEXT NOT NULL,                                               -- "เงินสดในมือ"
  type         TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  parent_code  TEXT REFERENCES public.chart_of_accounts(code) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT DEFAULT 0,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coa_type   ON public.chart_of_accounts(type);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON public.chart_of_accounts(parent_code);


-- ───────────────────────────────────────────────────────────
-- 2) journal_entries (สมุดรายวัน — header)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id              BIGSERIAL PRIMARY KEY,
  doc_no          TEXT UNIQUE NOT NULL,                                     -- "JV2026010001"
  doc_type        TEXT NOT NULL DEFAULT 'JV'
                  CHECK (doc_type IN ('JV','PV','SV','RV','CV','AJ','OB')), -- General/Pay/Sales/Receipt/Cash/Adjust/Opening
  doc_date        DATE NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','void')),
  total_debit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credit    NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Auto-post linkage (ถ้า JV ถูกสร้างจาก source อื่น เช่น sales/expenses/receipts)
  source_table    TEXT,                                                     -- "sales", "expenses", "receipts", "payroll"
  source_id       BIGINT,
  created_by      UUID,
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  voided_by       UUID,
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  -- Double-entry: ยอดรวมเดบิต = เครดิต
  CONSTRAINT je_balanced CHECK (total_debit = total_credit)
);

CREATE INDEX IF NOT EXISTS idx_je_date    ON public.journal_entries(doc_date);
CREATE INDEX IF NOT EXISTS idx_je_status  ON public.journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_je_source  ON public.journal_entries(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_je_doctype ON public.journal_entries(doc_type, doc_date);


-- ───────────────────────────────────────────────────────────
-- 3) journal_lines (รายการ debit/credit ของแต่ละ entry)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_lines (
  id            BIGSERIAL PRIMARY KEY,
  entry_id      BIGINT NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  account_code  TEXT NOT NULL REFERENCES public.chart_of_accounts(code),
  debit         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  -- One side only — รายการต้องเป็น debit หรือ credit อย่างใดอย่างหนึ่ง
  CONSTRAINT line_one_side
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CONSTRAINT line_no_neg
    CHECK (debit >= 0 AND credit >= 0)
);

CREATE INDEX IF NOT EXISTS idx_jl_entry   ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON public.journal_lines(account_code);
-- Composite สำหรับ ledger query (account → period)
CREATE INDEX IF NOT EXISTS idx_jl_account_entry ON public.journal_lines(account_code, entry_id);


-- ───────────────────────────────────────────────────────────
-- 4) fiscal_periods (งวดบัญชี — รองรับเดือน/ไตรมาส/ปี)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id           BIGSERIAL PRIMARY KEY,
  period_type  TEXT NOT NULL CHECK (period_type IN ('month','quarter','year')),
  year         INT NOT NULL,
  period       INT NOT NULL,                  -- เดือน 1-12 / ไตรมาส 1-4 / ปี 0
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_closed    BOOLEAN NOT NULL DEFAULT false,
  closed_by    UUID,
  closed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_type, year, period)
);

CREATE INDEX IF NOT EXISTS idx_fp_dates ON public.fiscal_periods(start_date, end_date);


-- ───────────────────────────────────────────────────────────
-- 5) Helper function: is_accountant() — admin only ตอนนี้
--    (อนาคตอาจเพิ่ม role 'accountant' แยก)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_accountant()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin')
$$;
GRANT EXECUTE ON FUNCTION public.is_accountant() TO authenticated;


-- ───────────────────────────────────────────────────────────
-- 6) RLS — admin only access
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_admin"       ON public.chart_of_accounts;
DROP POLICY IF EXISTS "je_admin"        ON public.journal_entries;
DROP POLICY IF EXISTS "jl_admin"        ON public.journal_lines;
DROP POLICY IF EXISTS "fp_admin"        ON public.fiscal_periods;

CREATE POLICY "coa_admin" ON public.chart_of_accounts
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "je_admin" ON public.journal_entries
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "jl_admin" ON public.journal_lines
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "fp_admin" ON public.fiscal_periods
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());


-- ───────────────────────────────────────────────────────────
-- 7) Seed minimal Chart of Accounts (50 บัญชีหลัก — ภาษาไทย)
--    ใช้ 4-digit code มาตรฐาน — admin import COA เต็มรูปแบบทับได้ภายหลัง
-- ───────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order) VALUES

  -- 1xxx Assets (สินทรัพย์)
  ('1000', 'สินทรัพย์',                       'asset',     NULL,    1000),
  ('1100', 'สินทรัพย์หมุนเวียน',              'asset',     '1000',  1100),
  ('1110', 'เงินสดในมือ',                     'asset',     '1100',  1110),
  ('1120', 'เงินสดย่อย',                       'asset',     '1100',  1120),
  ('1130', 'เงินฝากธนาคาร — กระแสรายวัน',     'asset',     '1100',  1130),
  ('1140', 'เงินฝากธนาคาร — ออมทรัพย์',       'asset',     '1100',  1140),
  ('1200', 'ลูกหนี้การค้า',                    'asset',     '1100',  1200),
  ('1210', 'ลูกหนี้อื่น',                      'asset',     '1100',  1210),
  ('1300', 'สินค้าคงเหลือ',                    'asset',     '1100',  1300),
  ('1400', 'สินทรัพย์ไม่หมุนเวียน',           'asset',     '1000',  1400),
  ('1410', 'อุปกรณ์สำนักงาน',                  'asset',     '1400',  1410),
  ('1420', 'เครื่องมือ-เครื่องใช้',            'asset',     '1400',  1420),
  ('1430', 'ยานพาหนะ',                         'asset',     '1400',  1430),
  ('1490', 'ค่าเสื่อมราคาสะสม',                'asset',     '1400',  1490),

  -- 2xxx Liabilities (หนี้สิน)
  ('2000', 'หนี้สิน',                          'liability', NULL,    2000),
  ('2100', 'หนี้สินหมุนเวียน',                 'liability', '2000',  2100),
  ('2110', 'เจ้าหนี้การค้า',                   'liability', '2100',  2110),
  ('2120', 'เจ้าหนี้อื่น',                     'liability', '2100',  2120),
  ('2130', 'เงินเดือนค้างจ่าย',                'liability', '2100',  2130),
  ('2140', 'ภาษีเงินได้หัก ณ ที่จ่ายค้างจ่าย', 'liability', '2100',  2140),
  ('2150', 'ภาษีเงินได้นิติบุคคลค้างจ่าย',     'liability', '2100',  2150),
  ('2160', 'เงินกู้ยืมระยะสั้น',                'liability', '2100',  2160),
  ('2200', 'หนี้สินไม่หมุนเวียน',              'liability', '2000',  2200),
  ('2210', 'เงินกู้ยืมระยะยาว',                'liability', '2200',  2210),

  -- 3xxx Equity (ส่วนของเจ้าของ)
  ('3000', 'ส่วนของเจ้าของ',                   'equity',    NULL,    3000),
  ('3100', 'ทุนเจ้าของ',                       'equity',    '3000',  3100),
  ('3200', 'กำไรสะสม',                         'equity',    '3000',  3200),
  ('3300', 'ถอนใช้ส่วนตัว',                    'equity',    '3000',  3300),

  -- 4xxx Income (รายได้)
  ('4000', 'รายได้',                           'income',    NULL,    4000),
  ('4100', 'รายได้จากการขายสินค้า',            'income',    '4000',  4100),
  ('4200', 'รายได้จากการบริการ — ติดตั้งแอร์',  'income',    '4000',  4200),
  ('4210', 'รายได้จากการบริการ — ซ่อมแอร์',    'income',    '4000',  4210),
  ('4220', 'รายได้จากการบริการ — ล้างแอร์',    'income',    '4000',  4220),
  ('4230', 'รายได้จากการบริการ — ย้ายแอร์',    'income',    '4000',  4230),
  ('4240', 'รายได้จากการบริการ — งานช่างอื่น',  'income',    '4000',  4240),
  ('4900', 'รายได้อื่น',                       'income',    '4000',  4900),

  -- 5xxx Expense (ค่าใช้จ่าย)
  ('5000', 'ค่าใช้จ่าย',                       'expense',   NULL,    5000),
  ('5100', 'ต้นทุนสินค้าที่ขาย',                'expense',   '5000',  5100),
  ('5200', 'เงินเดือนและค่าแรง',               'expense',   '5000',  5200),
  ('5210', 'ค่าน้ำมัน',                        'expense',   '5000',  5210),
  ('5220', 'ค่าน้ำ-ค่าไฟ',                     'expense',   '5000',  5220),
  ('5230', 'ค่าโทรศัพท์-อินเทอร์เน็ต',          'expense',   '5000',  5230),
  ('5240', 'ค่าเช่า',                          'expense',   '5000',  5240),
  ('5250', 'ค่าซ่อมแซม-บำรุง',                  'expense',   '5000',  5250),
  ('5260', 'ค่าวัสดุสิ้นเปลือง',                'expense',   '5000',  5260),
  ('5270', 'ค่าโฆษณา',                         'expense',   '5000',  5270),
  ('5280', 'ค่าธรรมเนียมธนาคาร',                'expense',   '5000',  5280),
  ('5290', 'ค่าใช้จ่ายเดินทาง',                 'expense',   '5000',  5290),
  ('5300', 'ค่าเสื่อมราคา',                     'expense',   '5000',  5300),
  ('5400', 'ภาษีเงินได้นิติบุคคล',              'expense',   '5000',  5400),
  ('5900', 'ค่าใช้จ่ายเบ็ดเตล็ด',               'expense',   '5000',  5900)

ON CONFLICT (code) DO NOTHING;


-- ───────────────────────────────────────────────────────────
-- 8) Verify
-- ───────────────────────────────────────────────────────────
SELECT
  type,
  COUNT(*) AS account_count
FROM public.chart_of_accounts
GROUP BY type
ORDER BY type;

-- Expected output:
--   asset      | 14
--   equity     | 4
--   expense    | 16
--   income     | 8
--   liability  | 10
