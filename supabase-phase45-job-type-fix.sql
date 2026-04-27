-- ═══════════════════════════════════════════════════════════
--  Phase 45.2 — Fix service_jobs.job_type CHECK constraint
--  Date: 2026-04-28
-- ═══════════════════════════════════════════════════════════
--
-- Problem (HTTP 400, code 23514):
--   service_jobs_job_type_check rejects new job_type values
--   like "repair_ac", "clean_ac", "move_ac", etc.
--
--   Original constraint allowed only: ac, solar, cctv
--   (matching legacy <select id="serviceType"> in service drawer)
--
-- Fix: Drop old constraint + recreate with full allowed list
--      (covers ac_install + solar + Phase 45 9 service forms)
--
-- How to run:
--   1. เปิด Supabase Dashboard → SQL Editor
--   2. Paste ทั้งไฟล์นี้ → Run
--   3. ตรวจ "Success. No rows returned"
--   4. กลับไปทดสอบบันทึกใบงาน — ควรผ่านแล้ว
-- ═══════════════════════════════════════════════════════════

-- Drop old constraint (ชื่อ default ที่ Postgres สร้าง)
ALTER TABLE public.service_jobs
  DROP CONSTRAINT IF EXISTS service_jobs_job_type_check;

-- Recreate with full list (legacy + Phase 45)
ALTER TABLE public.service_jobs
  ADD CONSTRAINT service_jobs_job_type_check
  CHECK (job_type IN (
    -- Legacy
    'ac',           -- ใช้โดย ac_install (ติดตั้งแอร์)
    'solar',        -- ใช้โดย solar form
    'cctv',         -- ใช้โดย service_request เก่า + Phase 45 service_cctv
    'other',        -- งานอื่นๆ (Phase 45 + service_request)
    -- Phase 45 service_form (9 ประเภท)
    'repair_ac',
    'clean_ac',
    'move_ac',
    'satellite',
    'repair_fridge',
    'repair_washer',
    'repair_tv'
  ));

-- ═══════════════════════════════════════════════════════════
--  Verify (ดู constraint หลังรัน)
-- ═══════════════════════════════════════════════════════════
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.service_jobs'::regclass
--   AND conname = 'service_jobs_job_type_check';
