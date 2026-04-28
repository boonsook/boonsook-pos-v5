-- ═══════════════════════════════════════════════════════════
--  Phase 45.8 — Add 'closed' to service_jobs.status CHECK constraint
--  Date: 2026-04-28
-- ═══════════════════════════════════════════════════════════
--
-- Problem: ปุ่ม "🎉 ลูกค้ายืนยันปิดงาน" ใน customer dashboard
-- ส่ง status = "closed" แต่ DB allow แค่:
--   pending, progress, done, delivered, cancelled
-- → HTTP 400 ทุกครั้งที่ลูกค้ากดปิดงาน
--
-- Why "closed" not "delivered":
--   delivered = ส่งของ/ส่งงานแล้ว (ฝั่งช่าง confirm)
--   closed    = ลูกค้ายืนยันรับงานปิดบัญชี (ฝั่งลูกค้า confirm)
--   2 status มี semantic ต่างกัน → ต้องเก็บแยก
--
-- How to run:
--   1. Supabase SQL Editor → New query
--   2. Paste ทั้งหมด → Run
--   3. ตรวจ "Success. No rows returned"
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.service_jobs
  DROP CONSTRAINT IF EXISTS service_jobs_status_check;

ALTER TABLE public.service_jobs
  ADD CONSTRAINT service_jobs_status_check
  CHECK (status IN (
    'pending',     -- รอดำเนินการ
    'progress',    -- กำลังดำเนินการ
    'done',        -- ช่างเสร็จงาน
    'delivered',   -- ส่งมอบแล้ว
    'closed',      -- ลูกค้ายืนยันปิดงาน (ใหม่)
    'cancelled'    -- ยกเลิก
  ));
