-- ═══════════════════════════════════════════════════════════
--  Phase 63 — Service Job Share Link
--  Date: 2026-05-01
-- ═══════════════════════════════════════════════════════════
-- เพิ่ม share_token ใน service_jobs → ลูกค้าได้ link → เปิดดู status งาน
-- (เลียนแบบ quotations.share_token + public_read_by_share_token)

ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS share_token TEXT;

-- Unique index — กัน collision ของ token
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_jobs_share_token
  ON public.service_jobs(share_token)
  WHERE share_token IS NOT NULL;

-- RLS: anon อ่านได้ "เฉพาะแถวที่มี share_token" (เหมือน quotations.public_read_by_share_token)
DROP POLICY IF EXISTS "service_jobs_public_read_by_share" ON public.service_jobs;
CREATE POLICY "service_jobs_public_read_by_share" ON public.service_jobs
  FOR SELECT TO anon
  USING (share_token IS NOT NULL);

-- anon SELECT only (write ผ่าน authenticated เดิม)
GRANT SELECT ON public.service_jobs TO anon;

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT id, customer_name, status, share_token FROM service_jobs WHERE share_token IS NOT NULL;
-- SELECT policyname, roles::text, qual FROM pg_policies WHERE tablename='service_jobs' ORDER BY policyname;
