-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — Bug A (profiles recursion) + Bug C (CHECK constraints)
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- ────────── Bug A: profiles infinite recursion ──────────
--
-- Diagnostic พบ policies เก่า 3 ตัวค้างบน profiles:
--   1. "profiles select self"           (TO public, USING current_role()=...)
--   2. "profiles update self"           (TO public, USING current_role()=...)
--   3. "Allow authenticated insert profiles"
--
-- ตัวที่ก่อ recursion = policies ใช้ "current_role"() — function นี้ body
-- ดึง role จาก public.profiles → policy ของ profiles call function →
-- function อ่าน profiles → policy เรียก function ซ้ำ → infinite loop
--
-- → "stack depth limit exceeded" (HTTP 500 / SQLSTATE 54001)
--
-- Fix: DROP 3 policies เก่านี้ทิ้ง — policies ใหม่ที่ migration 45.10 ตั้ง
-- ไว้แล้ว (profiles_select, profiles_insert, profiles_update, profiles_delete)
-- ใช้ is_admin() ซึ่งเป็น SECURITY DEFINER ของเรา → ไม่ recursion
--
-- ⚠️ ไม่ DROP function "current_role"() เพราะ policies อื่น (categories,
-- customers, products, quotations, service_jobs ฯลฯ) ยังใช้อยู่ — รอ
-- cleanup ใน Bug B รอบหน้า
--
-- ────────── Bug C: CHECK constraints หายหมด ──────────
--
-- Diagnostic Section 5 = null → ไม่มี CHECK constraint บน:
--   - service_jobs.job_type    (Phase 45.2 ตั้งใจให้มี 11 ค่า)
--   - service_jobs.status      (Phase 45.8 ตั้งใจให้มี 6 ค่า รวม 'closed')
--   - stock_movements.type     (Phase 45.7 ตั้งใจให้มี 6 ค่า)
--
-- น่าจะ: migration เก่ารัน DROP สำเร็จ แต่ ADD fail (ติด data เก่า) →
-- transaction rollback → constraint หาย ไม่กลับมา
--
-- Fix: ADD ใหม่ + ใช้ NOT VALID → skip validate existing rows → ไม่ fail
-- ค่าใหม่จะถูก validate เสมอ (defense in depth)
--
-- ถ้า user อยากให้ validate ของเก่าด้วย → ดู section "OPTIONAL VALIDATE"
-- ปลายไฟล์ + รันแยก
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste ทั้งไฟล์ → Run
--   3. ตรวจ "Success. No rows returned"
--   4. ทดสอบ:
--      - Hard refresh แอป (Ctrl+Shift+R)
--      - กดเข้าหน้าใดๆ ที่ load profile (ตั้งค่าผู้ใช้, ใบงาน) →
--        ต้องไม่มี HTTP 500 อีก
--      - บันทึกใบงานช่าง → ต้องผ่าน + DB ปฏิเสธค่า invalid
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  PART A: DROP profiles policies เก่าที่ก่อ recursion
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles select self" ON public.profiles;
DROP POLICY IF EXISTS "profiles update self" ON public.profiles;
DROP POLICY IF EXISTS "Allow authenticated insert profiles" ON public.profiles;

-- ตรวจสอบ: หลัง drop ต้องเหลือเฉพาะ policies ใหม่ของ Phase 45.10
--   profiles_select, profiles_insert, profiles_update, profiles_delete


-- ═══════════════════════════════════════════════════════════
--  PART C: ADD CHECK constraints กลับ (NOT VALID)
-- ═══════════════════════════════════════════════════════════

-- ───── service_jobs.job_type (Phase 45.2 — 11 values) ─────
ALTER TABLE public.service_jobs
  DROP CONSTRAINT IF EXISTS service_jobs_job_type_check;

ALTER TABLE public.service_jobs
  ADD CONSTRAINT service_jobs_job_type_check
  CHECK (job_type IN (
    'ac', 'solar', 'cctv', 'other',
    'repair_ac', 'clean_ac', 'move_ac',
    'satellite', 'repair_fridge', 'repair_washer', 'repair_tv'
  ))
  NOT VALID;


-- ───── service_jobs.status (Phase 45.8 — 6 values รวม 'closed') ─────
ALTER TABLE public.service_jobs
  DROP CONSTRAINT IF EXISTS service_jobs_status_check;

ALTER TABLE public.service_jobs
  ADD CONSTRAINT service_jobs_status_check
  CHECK (status IN (
    'pending', 'progress', 'done', 'delivered', 'closed', 'cancelled'
  ))
  NOT VALID;


-- ───── stock_movements.type (Phase 45.7 — 6 values) ─────
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN (
    'in', 'out', 'sale', 'transfer', 'return', 'adjust'
  ))
  NOT VALID;


-- ═══════════════════════════════════════════════════════════
--  Verify (จะแสดง 3 constraints ใหม่ที่ตั้ง — convalidated=false)
-- ═══════════════════════════════════════════════════════════

SELECT
  conrelid::regclass::text AS table,
  conname AS constraint_name,
  convalidated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.service_jobs'::regclass, 'public.stock_movements'::regclass)
  AND contype = 'c'
ORDER BY conrelid::regclass::text, conname;


-- ═══════════════════════════════════════════════════════════
--  OPTIONAL — VALIDATE existing rows (รันแยก ถ้าต้องการ)
-- ═══════════════════════════════════════════════════════════
-- หลังรัน NOT VALID — แถวใหม่ถูก validate เสมอ แต่ข้อมูลเก่าไม่
-- ถ้า user อยากให้ DB ตรวจ data เก่าด้วย → ลอง run ทีละบรรทัด:
--   - ถ้า "ALTER TABLE" สำเร็จ → ทุกแถวเก่าผ่าน CHECK
--   - ถ้า fail (23514) → มีแถวค่าผิด → SELECT ดูแล้วแก้/ลบ → run ใหม่
--
-- ALTER TABLE public.service_jobs   VALIDATE CONSTRAINT service_jobs_job_type_check;
-- ALTER TABLE public.service_jobs   VALIDATE CONSTRAINT service_jobs_status_check;
-- ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_type_check;
--
-- ดูแถวที่จะ fail (ก่อนรัน VALIDATE):
--   SELECT id, job_type FROM public.service_jobs
--     WHERE job_type NOT IN ('ac','solar','cctv','other','repair_ac','clean_ac','move_ac','satellite','repair_fridge','repair_washer','repair_tv');
--
--   SELECT id, status FROM public.service_jobs
--     WHERE status NOT IN ('pending','progress','done','delivered','closed','cancelled');
--
--   SELECT id, type FROM public.stock_movements
--     WHERE type NOT IN ('in','out','sale','transfer','return','adjust');
--
-- ═══════════════════════════════════════════════════════════
