-- ═══════════════════════════════════════════════════════════
--  Phase 89.26 — Audit missing JVs (read-only)
--
--  ใช้หลังจาก:
--    1. รัน supabase-phase89-25-fix-je-rls-pos.sql แล้ว
--    2. ลอง POS sale ทดสอบ → console ไม่มี HTTP 403 อีก
--
--  Audit นี้:
--    - หา rows ใน sales/expenses/receipts/service_jobs/delivery_invoices
--      ที่ "ไม่มี" JV ผูกอยู่ (orphan rows)
--    - แสดงเป็น count + sample rows สำหรับ debug
--    - read-only — รันได้ทุกเวลา ไม่เปลี่ยน DB
--
--  ขั้นถัดไป (หลังเห็นรายการที่ตก):
--    Login as admin → Accounting → "Backfill JV ย้อนหลัง"
--    → เลือก source + date range ตรงกับที่หาย → กด "เริ่ม Backfill"
--    → Backfill UI จะเรียก postJournalForX ของแต่ละ row
--      (handles mapping, doc_no sequence, VAT, period lock — pure JS)
--    → JV ใหม่จะโผล่ — Trial Balance / P&L กลับมาตรง
--
--  ⚠️ ไม่แนะนำ pure-SQL backfill เพราะ:
--    - ต้อง replicate account_mapping logic (cash vs transfer)
--    - doc_no sequence generation
--    - VAT inclusive/exclusive (Phase 88.21)
--    - period_locked trigger (Phase 88.19)
--    Backfill UI ครอบทุกอย่างถูกต้องแล้ว
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) COUNT: รวมทุก source ที่ตก JV (เริ่ม production 1 พ.ค. 2026)
-- ───────────────────────────────────────────────────────────
WITH effective AS (
  SELECT '2026-05-01'::date AS cutoff
),
existing_jv AS (
  SELECT source_table, source_id::text AS source_id
  FROM journal_entries
  WHERE source_table IS NOT NULL
    AND source_id   IS NOT NULL
),
missing_sales AS (
  SELECT s.id, s.created_at, s.total_amount, s.payment_method, s.created_by
  FROM sales s, effective e
  WHERE s.created_at::date >= e.cutoff
    AND NOT (s.note ILIKE '%[ลบแล้ว]%')
    AND NOT EXISTS (
      SELECT 1 FROM existing_jv j
      WHERE j.source_table = 'sales' AND j.source_id = s.id::text
    )
),
missing_expenses AS (
  SELECT x.id, x.expense_date, x.amount, x.payment_method
  FROM expenses x, effective e
  WHERE x.expense_date >= e.cutoff
    AND NOT EXISTS (
      SELECT 1 FROM existing_jv j
      WHERE j.source_table = 'expenses' AND j.source_id = x.id::text
    )
),
missing_receipts AS (
  SELECT r.id, r.receipt_date, r.total_amount, r.status
  FROM receipts r, effective e
  WHERE r.receipt_date >= e.cutoff
    AND r.status = 'paid'
    AND NOT EXISTS (
      SELECT 1 FROM existing_jv j
      WHERE j.source_table = 'receipts' AND j.source_id = r.id::text
    )
),
missing_invoices AS (
  SELECT i.id, i.created_at, i.total_amount, i.status
  FROM delivery_invoices i, effective e
  WHERE i.created_at::date >= e.cutoff
    AND NOT EXISTS (
      SELECT 1 FROM existing_jv j
      WHERE j.source_table = 'delivery_invoices' AND j.source_id = i.id::text
    )
),
missing_jobs AS (
  SELECT j.id, j.created_at, j.total_charge, j.status
  FROM service_jobs j, effective e
  WHERE j.created_at::date >= e.cutoff
    AND j.status IN ('done', 'delivered', 'closed')
    AND NOT EXISTS (
      SELECT 1 FROM existing_jv jv
      WHERE jv.source_table = 'service_jobs' AND jv.source_id = j.id::text
    )
)
SELECT
  'sales'             AS source, COUNT(*)::int AS missing_count, COALESCE(SUM(total_amount), 0)::numeric AS missing_revenue FROM missing_sales
UNION ALL SELECT 'expenses',          COUNT(*)::int, COALESCE(SUM(amount), 0)::numeric        FROM missing_expenses
UNION ALL SELECT 'receipts (paid)',   COUNT(*)::int, COALESCE(SUM(total_amount), 0)::numeric  FROM missing_receipts
UNION ALL SELECT 'delivery_invoices', COUNT(*)::int, COALESCE(SUM(total_amount), 0)::numeric  FROM missing_invoices
UNION ALL SELECT 'service_jobs',      COUNT(*)::int, COALESCE(SUM(total_charge), 0)::numeric  FROM missing_jobs;


-- ───────────────────────────────────────────────────────────
-- 2) SAMPLE: 20 แถว sales ที่ตกล่าสุด (เพื่อตรวจสอบก่อน backfill)
-- ───────────────────────────────────────────────────────────
SELECT
  s.id,
  s.created_at AT TIME ZONE 'Asia/Bangkok' AS created_bkk,
  s.total_amount,
  s.payment_method,
  s.created_by,
  p.full_name AS created_by_name,
  p.role      AS created_by_role
FROM sales s
LEFT JOIN profiles p ON p.id = s.created_by
WHERE s.created_at::date >= '2026-05-01'
  AND NOT (s.note ILIKE '%[ลบแล้ว]%')
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.source_table = 'sales' AND j.source_id = s.id::text
  )
ORDER BY s.created_at DESC
LIMIT 20;


-- ───────────────────────────────────────────────────────────
-- 3) SAMPLE: 10 แถว expenses ที่ตก (debug)
-- ───────────────────────────────────────────────────────────
SELECT
  x.id,
  x.expense_date,
  x.amount,
  x.payment_method,
  x.category,
  x.description
FROM expenses x
WHERE x.expense_date >= '2026-05-01'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.source_table = 'expenses' AND j.source_id = x.id::text
  )
ORDER BY x.expense_date DESC
LIMIT 10;


-- ───────────────────────────────────────────────────────────
-- 4) Date range coverage: ดูช่วงวันที่ JV ขาด (เพื่อตั้ง backfill range)
-- ───────────────────────────────────────────────────────────
SELECT
  MIN(s.created_at)::date AS earliest_missing,
  MAX(s.created_at)::date AS latest_missing,
  COUNT(*)::int AS total_missing_sales
FROM sales s
WHERE s.created_at::date >= '2026-05-01'
  AND NOT (s.note ILIKE '%[ลบแล้ว]%')
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.source_table = 'sales' AND j.source_id = s.id::text
  );


-- ───────────────────────────────────────────────────────────
-- Expected output ถ้าทุกอย่างปกติ (ก่อน bug):
--   ทั้ง 5 sources missing_count = 0
--
-- ถ้าหลัง bug:
--   sales > 0 (จำนวน bills ที่ขายโดย non-admin หลัง Phase 89.24 deploy)
--   อาจจะรวม expenses/receipts/service_jobs ถ้ามี non-admin สร้างผ่าน UI
--
-- Next step:
--   Login as admin → ไปหน้า Accounting → "Backfill JV ย้อนหลัง"
--   ติ๊ก source ที่มี missing_count > 0
--   ตั้ง From = earliest_missing, To = latest_missing
--   กด "เริ่ม Backfill" → JV จะถูกสร้าง row by row (idempotent)
-- ═══════════════════════════════════════════════════════════
