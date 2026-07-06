-- ═══════════════════════════════════════════════════════════
--  Phase 567 — service_jobs idempotency (client_uuid)
--  กันใบงานช่างซ้ำจาก timeout/retry ใน 3 ฟอร์ม (service_form/ac_install/solar)
-- ═══════════════════════════════════════════════════════════
--  OWNER-RUN ใน Supabase SQL editor "ก่อน" deploy build 567.
--  code degrade-safe: ถ้ายังไม่รัน → POST retry โดยไม่มี client_uuid (บันทึกได้ตามปกติ
--  แต่ยังไม่ dedup) จนกว่าจะรัน SQL นี้. mirror pattern: supabase-phase92-22-time-clock.sql
--  (ADD COLUMN IF NOT EXISTS + partial UNIQUE index WHERE ... IS NOT NULL).
--  ไม่แตะ RLS ของ service_jobs (column ใหม่ nullable — INSERT policy เดิมครอบอยู่แล้ว).
-- ═══════════════════════════════════════════════════════════

-- 1) เพิ่มคอลัมน์ client_uuid (idempotency key ที่ client gen ต่อ 1 ใบงาน intent)
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

-- 2) partial UNIQUE — insert ซ้ำด้วย key เดียวกัน = 23505 (client จับ 409 → replay row เดิม).
--    WHERE client_uuid IS NOT NULL → งานเก่า (null) ไม่ชนกัน + path ที่ยังไม่ส่ง key ไม่ถูกบล็อก.
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_jobs_client_uuid_unique
  ON public.service_jobs (client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 3) reload PostgREST schema cache (กัน PGRST204 "Could not find the 'client_uuid' column")
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
--  VERIFY (รันหลัง apply — ควรได้ 1 row ทั้งสอง)
-- ═══════════════════════════════════════════════════════════
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='service_jobs' AND column_name='client_uuid';
-- SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='service_jobs'
--     AND indexname='idx_service_jobs_client_uuid_unique';
