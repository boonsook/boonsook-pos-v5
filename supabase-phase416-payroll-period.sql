-- ═══════════════════════════════════════════════════════════
--  Phase 416 (Part A) — payroll custom pay-period (build 416)
--  รอบตัดเงินเดือนที่ร้านกำหนด (วันตัด 10 และ 25 → รอบ 11–25 / 26–10 เดือนถัดไป)
--
--  ⚠️ owner รันไฟล์นี้ใน Supabase SQL Editor "ก่อน" smoke build 416
--     (ฝั่งแอปโหลด staff_payroll ด้วย period_start=eq...&period_end=eq...
--      ถ้ายังไม่รัน SQL → หน้าเงินเดือนจะแสดง error บอกให้รันไฟล์นี้ — ไม่พังอย่างอื่น)
--
--  ข้อเท็จจริง ณ 2026-06-10:
--  - ตาราง staff_payroll มี 0 แถว → "ไม่ต้อง backfill" period_start/period_end ให้แถวเก่า
--  - การเปลี่ยนแปลงทั้งหมดเป็น additive (เพิ่มคอลัมน์ nullable + jsonb default)
--    → ปลอดภัยต่อ build เก่าที่ยังเขียนแค่ period_month (คอลัมน์เดิมคงอยู่ ไม่แตะ)
--  - DROP uq_staff_payroll (unique เดิม employee_id+period_month):
--    รอบใหม่มี 2 รอบจบในเดือนเดียวกันได้ (เช่น รอบ 26 พ.ค.–10 มิ.ย. และ 11–25 มิ.ย.
--    ทั้งคู่ period_month = 2026-06) → unique เดิมจะชนกันเอง ต้องถอดออก
--  - unique ใหม่ = (employee_id, period_start, period_end) กันพนักงานคนเดียว
--    มีรายการซ้ำในรอบเดียวกัน
-- ═══════════════════════════════════════════════════════════

ALTER TABLE staff_payroll ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE staff_payroll ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE staff_payroll ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}'::jsonb;

-- ถอด unique เดิม (employee_id, period_month) — กันรอบ 2 รอบที่จบเดือนเดียวกันชนกัน
ALTER TABLE staff_payroll DROP CONSTRAINT IF EXISTS uq_staff_payroll;

-- unique ใหม่ต่อรอบตรงตัว
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_payroll_period
  ON staff_payroll(employee_id, period_start, period_end);

-- ให้ PostgREST รู้จัก schema ใหม่ทันที (กัน PGRST204 หลัง ALTER)
NOTIFY pgrst, 'reload schema';
