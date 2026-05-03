-- ═══════════════════════════════════════════════════════════
--  Phase 77 — Daily-rate payroll support
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- เพิ่มความสามารถจ่ายเงินเดือนแบบ "รายวัน" (พนักงานทั่วไปในร้านส่วนมาก
-- จะคิดค่าจ้าง ฿X/วัน × จำนวนวันทำงาน แทนเงินเดือนรายเดือน)
--
-- Schema changes:
--   profiles.pay_type     ('monthly' | 'daily')  default 'monthly'
--   profiles.daily_rate   NUMERIC ค่าจ้างต่อวัน  default 0
--   staff_payroll.days_worked  INT  จำนวนวันทำงาน (เฉพาะ daily)
--   staff_payroll.daily_rate   NUMERIC snapshot rate ตอนคำนวณ
--
-- base_salary ยังเก็บค่าเงินเดือนสุดท้าย (= rate × days สำหรับ daily)
-- เพื่อไม่กระทบ generated total_amount + report เดิม
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pay_type    TEXT NOT NULL DEFAULT 'monthly'
    CHECK (pay_type IN ('monthly', 'daily')),
  ADD COLUMN IF NOT EXISTS daily_rate  NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.pay_type   IS 'monthly = เงินเดือนคงที่; daily = คิดเป็นรายวัน × จำนวนวัน';
COMMENT ON COLUMN public.profiles.daily_rate IS 'ค่าจ้างต่อวัน (บาท) — ใช้เมื่อ pay_type=daily';

ALTER TABLE public.staff_payroll
  ADD COLUMN IF NOT EXISTS days_worked  INTEGER,
  ADD COLUMN IF NOT EXISTS daily_rate   NUMERIC(10,2);

COMMENT ON COLUMN public.staff_payroll.days_worked IS 'จำนวนวันทำงานในรอบนี้ (ถ้าจ่ายรายวัน)';
COMMENT ON COLUMN public.staff_payroll.daily_rate  IS 'snapshot ค่าจ้างต่อวันตอนคำนวณ (กัน rate ใน profiles เปลี่ยนภายหลัง)';

-- ───── Refresh view ที่อาจมี profiles ─────
-- profiles_with_email อาจต้อง recreate ถ้า view definition select '*' หรือ list คอลัมน์
-- (ไม่บังคับ — ถ้า view ใช้ select * จะต้อง drop+recreate; ถ้า list คอลัมน์ → ไม่ต้อง)
-- หากเจอ error เกี่ยวกับ view ใน Supabase ให้รัน:
--   DROP VIEW IF EXISTS public.profiles_with_email CASCADE;
--   แล้วรัน CREATE VIEW ใหม่จาก supabase-phase75-profiles-view.sql

SELECT 'Phase 77 daily payroll columns added ✅' AS status;
