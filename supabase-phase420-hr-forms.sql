-- ═══════════════════════════════════════════════════════════
--  Phase 420 — HR Forms: รับสมัครงาน + ใบลาออก
--
--  วัตถุประสงค์: เพิ่มตาราง staff_applications (ผู้สมัครงาน + เอกสารแนบ)
--  และ staff_resignations (ใบลาออก + อนุมัติ) สำหรับเมนูใหม่กลุ่ม บุคลากร/HR
--
--  ขอบเขต (additive only — ห้ามแตะของเดิม):
--    - ★ ไม่แก้ profiles / staff_attendance / staff_payroll / staff_leaves / departments
--    - ★ ไม่เปลี่ยน RLS เก่าใด ๆ
--    - ★ อนุมัติใบลาออก "ไม่" ตัดพนักงานออกอัตโนมัติ — ไม่มี trigger แตะ profiles
--      (สเปก owner: ระบบแค่เตือน แอดมินไปปิดสถานะผู้ใช้เองที่ ตั้งค่า → ผู้ใช้งาน)
--
--  RLS pattern: admin-only ทุก operation — ใช้ public.is_accountant()
--  (จาก phase 88 foundation; mirror supabase-phase92-32-leave-management.sql)
--  หน้านี้เป็นเมนูแอดมินล้วน: พนักงาน/ลูกค้าไม่มีสิทธิ์อ่าน-เขียน
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ verify ที่ท้ายไฟล์
--    Re-run safe: ใช้ IF NOT EXISTS / DROP POLICY IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) CREATE TABLE staff_applications — ผู้สมัครงาน
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.staff_applications (
  id               bigserial PRIMARY KEY,
  full_name        text        NOT NULL,
  phone            text,
  address          text,
  position         text,
  expected_salary  numeric(12,2),
  experience       text,
  applied_date     date        NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok'))::date,
  status           text        NOT NULL DEFAULT 'new',
  hired_date       date,
  attachments      jsonb       NOT NULL DEFAULT '[]',
  note             text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_applications_status_check
    CHECK (status IN ('new','interview','hired','rejected'))
);

COMMENT ON TABLE public.staff_applications IS
  'Phase 420: ผู้สมัครงาน — new → interview → hired/rejected. attachments = jsonb [{url,label}] (รูปบัตร ปชช./เรซูเม่ ใน storage bucket proofs/applications/). hired ไม่ auto-สร้าง user (แอดมินสร้างเองที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน).';

COMMENT ON COLUMN public.staff_applications.applied_date IS 'วันที่สมัคร (default = วันนี้เขตเวลา Asia/Bangkok)';
COMMENT ON COLUMN public.staff_applications.attachments IS 'jsonb array [{url,label}] — รูปเอกสารแนบใน storage bucket proofs path applications/';
COMMENT ON COLUMN public.staff_applications.hired_date IS 'วันที่รับเข้าทำงาน (เซ็ตตอนเปลี่ยนสถานะเป็น hired)';


-- ═══════════════════════════════════════════════════════════
--  2) CREATE TABLE staff_resignations — ใบลาออก
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.staff_resignations (
  id                 bigserial PRIMARY KEY,
  employee_id        uuid        NOT NULL,
  submitted_date     date,
  last_working_date  date,
  reason             text,
  note               text,
  status             text        NOT NULL DEFAULT 'submitted',
  approved_at        timestamptz,
  approved_by        uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_resignations_status_check
    CHECK (status IN ('submitted','approved'))
);

COMMENT ON TABLE public.staff_resignations IS
  'Phase 420: ใบลาออกพนักงาน — submitted → approved. อนุมัติแล้ว "ไม่" ตัดพนักงานออกจาก profiles อัตโนมัติ (ไม่มี trigger/แอป PATCH profiles) — ระบบเตือนให้แอดมินไปปิดสถานะเองที่ ตั้งค่า → ผู้ใช้งาน เมื่อถึงวันทำงานวันสุดท้าย.';

COMMENT ON COLUMN public.staff_resignations.employee_id IS 'profiles.id (auth.users.id) ของพนักงานที่ลาออก — อ้างอิงเท่านั้น ไม่มี FK cascade ไป profiles';
COMMENT ON COLUMN public.staff_resignations.approved_by IS 'auth.users.id ของ admin ที่อนุมัติ';


-- ═══════════════════════════════════════════════════════════
--  3) Indexes
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_staff_applications_status       ON public.staff_applications (status);
CREATE INDEX IF NOT EXISTS idx_staff_applications_applied_date ON public.staff_applications (applied_date DESC);
CREATE INDEX IF NOT EXISTS idx_staff_resignations_employee_id  ON public.staff_resignations (employee_id);
CREATE INDEX IF NOT EXISTS idx_staff_resignations_status       ON public.staff_resignations (status);


-- ═══════════════════════════════════════════════════════════
--  4) updated_at trigger (staff_applications — auto-bump on UPDATE)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._bump_staff_applications_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_applications_updated_at ON public.staff_applications;
CREATE TRIGGER trg_staff_applications_updated_at
  BEFORE UPDATE ON public.staff_applications
  FOR EACH ROW EXECUTE FUNCTION public._bump_staff_applications_updated_at();


-- ═══════════════════════════════════════════════════════════
--  5) RLS Policies — admin-only (public.is_accountant()) ทั้ง 2 ตาราง
--     หน้า รับสมัครงาน/ใบลาออก เป็นเมนูแอดมินเท่านั้น
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.staff_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_resignations ENABLE ROW LEVEL SECURITY;

-- DROP เก่าก่อน (re-run safe)
DROP POLICY IF EXISTS "applications_admin_all" ON public.staff_applications;
DROP POLICY IF EXISTS "resignations_admin_all" ON public.staff_resignations;

-- staff_applications: admin ทำได้ทุกอย่าง / role อื่นมองไม่เห็น
CREATE POLICY "applications_admin_all" ON public.staff_applications
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

-- staff_resignations: admin ทำได้ทุกอย่าง / role อื่นมองไม่เห็น
CREATE POLICY "resignations_admin_all" ON public.staff_resignations
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  6) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  7) VERIFY queries (รันทีละชุดเพื่อตรวจหลัง apply)
-- ═══════════════════════════════════════════════════════════

-- (a) Columns staff_applications — Expected: 15 columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_applications'
ORDER BY ordinal_position;

-- (b) Columns staff_resignations — Expected: 11 columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_resignations'
ORDER BY ordinal_position;

-- (c) CHECK constraints — Expected: status check ทั้ง 2 ตาราง
SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname='public'
  AND rel.relname IN ('staff_applications','staff_resignations')
  AND con.contype='c'
ORDER BY rel.relname, con.conname;

-- (d) RLS enabled — Expected: relrowsecurity = true ทั้ง 2 ตาราง
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('staff_applications','staff_resignations');

-- (e) Policies — Expected: applications_admin_all + resignations_admin_all (cmd = ALL)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('staff_applications','staff_resignations')
ORDER BY tablename, policyname;

-- (f) trigger — Expected: trg_staff_applications_updated_at
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.staff_applications'::regclass AND NOT tgisinternal;

-- (g) row count = 0 (post-CREATE)
SELECT (SELECT COUNT(*) FROM public.staff_applications)  AS applications,
       (SELECT COUNT(*) FROM public.staff_resignations)  AS resignations;
