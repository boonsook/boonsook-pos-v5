-- ═══════════════════════════════════════════════════════════
--  Phase 88.6 — Service Job Closure (8 พ.ค.)
--
--  ช่างปิดงานในหน้าเดียว → JV เข้ารายได้ตามประเภทงานครบ 9 ประเภท
--
--  ส่วน:
--    1) ALTER service_jobs — เพิ่ม payment_slip_url + closed_at + total_cost (ถ้ายังไม่มี)
--    2) เพิ่ม COA accounts 4250-4290 (5 service revenue accounts)
--    3) เพิ่ม account_mapping 5 ตัว (satellite/fridge/washer/cctv/tv)
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) ALTER TABLE service_jobs — เพิ่ม column ที่ขาด
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS total_cost         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS payment_slip_url   TEXT,
  ADD COLUMN IF NOT EXISTS closed_at          TIMESTAMPTZ;


-- ───────────────────────────────────────────────────────────
-- 2) เพิ่ม COA accounts 4250-4290
-- ───────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, parent_code, sort_order, is_active) VALUES
  ('4250', 'รายได้บริการ — จานดาวเทียม',     'income', '4000', 250, true),
  ('4260', 'รายได้บริการ — ซ่อมตู้เย็น',     'income', '4000', 260, true),
  ('4270', 'รายได้บริการ — ซ่อมเครื่องซักผ้า','income', '4000', 270, true),
  ('4280', 'รายได้บริการ — CCTV',             'income', '4000', 280, true),
  ('4290', 'รายได้บริการ — ซ่อมทีวี',         'income', '4000', 290, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;


-- ───────────────────────────────────────────────────────────
-- 3) เพิ่ม account_mapping สำหรับ 5 service types ที่ขาด
-- ───────────────────────────────────────────────────────────
INSERT INTO public.account_mapping (mapping_key, description, debit_account_code, credit_account_code) VALUES
  ('service_satellite',     'รายได้บริการ — จานดาวเทียม',      '1110', '4250'),
  ('service_repair_fridge', 'รายได้บริการ — ซ่อมตู้เย็น',      '1110', '4260'),
  ('service_repair_washer', 'รายได้บริการ — ซ่อมเครื่องซักผ้า', '1110', '4270'),
  ('service_cctv',          'รายได้บริการ — CCTV',              '1110', '4280'),
  ('service_repair_tv',     'รายได้บริการ — ซ่อมทีวี',          '1110', '4290')
ON CONFLICT (mapping_key) DO UPDATE SET
  description          = EXCLUDED.description,
  debit_account_code   = EXCLUDED.debit_account_code,
  credit_account_code  = EXCLUDED.credit_account_code;


-- ───────────────────────────────────────────────────────────
-- 4) Verify
-- ───────────────────────────────────────────────────────────
-- ดู COA ใหม่
SELECT code, name, type FROM public.chart_of_accounts
WHERE code BETWEEN '4250' AND '4290' ORDER BY code;

-- ดู mapping ทั้งหมด (ควรได้ 27: 22 เดิม + 5 ใหม่)
SELECT mapping_key, debit_account_code, credit_account_code
FROM public.account_mapping
WHERE mapping_key LIKE 'service_%' ORDER BY mapping_key;

-- ดู column ใหม่ของ service_jobs
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'service_jobs'
  AND column_name IN ('total_cost', 'payment_slip_url', 'closed_at');

-- Expected:
--   COA × 5 (4250-4290)
--   service mappings × 11 (5 เก่า + 5 ใหม่ + 1 service_other)
--   service_jobs columns × 3 (total_cost, payment_slip_url, closed_at)
