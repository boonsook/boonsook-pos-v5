-- ═══════════════════════════════════════════════════════════
--  Phase 92.22 — Time Clock (Foundation + Self-service)
--  ระบบลงเวลาเข้า-ออกงานของพนักงาน
--
--  สิ่งที่ migration นี้ทำ:
--    1) ALTER TABLE staff: เพิ่ม user_id (FK auth.users), email (UNIQUE)
--       — รองรับ self-service: staff ผูกกับ auth account ผ่าน email
--    2) CREATE TABLE staff_attendance: เก็บเวลาเข้า/ออก + GPS (รอ Phase 92.24)
--       + idempotency key (รอ Phase 92.27 offline queue) + source tracker
--    3) Indexes: staff_id+date desc (query history), partial unique (กัน 2 open sessions)
--    4) RLS policies: admin all + staff self (via user_id)
--    5) NOTIFY pgrst 'reload schema' กัน PGRST204
--    6) Verify query ตรวจ schema + policies + indexes
--
--  How to run:
--    Supabase Dashboard → SQL Editor → New query → paste → Run
--    Re-run safe: ใช้ IF EXISTS / IF NOT EXISTS / DROP IF EXISTS ทุกตัว
--
--  Phases ต่อ:
--    92.23 self-service: เปิด INSERT policy ให้ staff ตัวเอง (อยู่ใน file นี้แล้ว — single migration)
--    92.24 geo-fence: ใช้ clock_in_lat/lng + clock_in_distance_m ที่ schema มีให้
--    92.25 OT detect: คำนวณจาก clock_in_at + clock_out_at (no schema change)
--    92.26 payroll link: ALTER TABLE payroll เพิ่ม ot_hours/ot_amount (เฟสนั้นค่อยทำ)
--    92.27 offline queue: ใช้ client_uuid + source='queued' (อยู่ใน schema แล้ว)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) staff: เพิ่ม user_id + email (รองรับ self-service)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS email text;

-- UNIQUE constraint บน email (สำหรับ auto-claim flow) — เฉพาะค่าที่ไม่ null
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_email_unique
  ON public.staff (lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- UNIQUE constraint บน user_id — กัน user เดียวผูกหลาย staff
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_user_id_unique
  ON public.staff (user_id)
  WHERE user_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════
--  2) staff_attendance: ตารางหลัก
-- ═══════════════════════════════════════════════════════════

-- ★ HOTFIX: staff.id ใน Boonsook prod = uuid (สร้างผ่าน Supabase Dashboard ไม่ใช่ migration)
-- ดังนั้น staff_id ต้องเป็น uuid (กัน error 42804 ตอน FK)
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id              bigserial PRIMARY KEY,
  staff_id        uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,

  -- เวลา (เก็บเป็น timestamptz UTC, แสดงผลแปลง Asia/Bangkok ฝั่ง client)
  work_date       date NOT NULL,                       -- วันที่ทำงาน (Asia/Bangkok)
  clock_in_at     timestamptz NOT NULL DEFAULT now(),
  clock_out_at    timestamptz,                          -- NULL = session ยังเปิดอยู่

  -- GPS (Phase 92.24) — schema reserve ไว้แต่ยังไม่บังคับ
  clock_in_lat        numeric(10,7),
  clock_in_lng        numeric(10,7),
  clock_out_lat       numeric(10,7),
  clock_out_lng       numeric(10,7),
  clock_in_distance_m  integer,                          -- ระยะจากร้าน (เมตร)
  clock_out_distance_m integer,

  -- source: ใครเป็นคนกด
  source          text NOT NULL DEFAULT 'admin'
                  CHECK (source IN ('admin','self','queued')),

  -- idempotency (Phase 92.27 offline queue) — uuid v4 จาก client
  client_uuid     uuid,

  -- บันทึก
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_attendance IS
  'Phase 92.22 — staff clock-in/out records. work_date = Asia/Bangkok day. clock_out_at NULL = active session.';

COMMENT ON COLUMN public.staff_attendance.source IS
  'admin = manager กดให้ / self = พนักงานกดเอง / queued = sync จาก offline queue (Phase 92.27)';

COMMENT ON COLUMN public.staff_attendance.client_uuid IS
  'Idempotency key — กัน duplicate insert จาก offline queue sync (Phase 92.27). NULL ได้สำหรับ admin/self online';


-- ═══════════════════════════════════════════════════════════
--  3) Indexes
-- ═══════════════════════════════════════════════════════════

-- Query history: staff คนเดียว เรียงจากใหม่
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date
  ON public.staff_attendance (staff_id, work_date DESC, clock_in_at DESC);

-- ★ Partial UNIQUE: กันพนักงาน 1 คนมี open session > 1 อันพร้อมกัน
--   (ต้อง clock-out ก่อนถึงจะ clock-in ใหม่ได้)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_open_session
  ON public.staff_attendance (staff_id)
  WHERE clock_out_at IS NULL;

-- ★ UNIQUE บน client_uuid เพื่อ idempotency (Phase 92.27)
--   NULL UUIDs ไม่ collide กัน (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_client_uuid
  ON public.staff_attendance (client_uuid)
  WHERE client_uuid IS NOT NULL;


-- ═══════════════════════════════════════════════════════════
--  4) updated_at trigger (auto-bump on UPDATE)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._bump_staff_attendance_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.staff_attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public._bump_staff_attendance_updated_at();


-- ═══════════════════════════════════════════════════════════
--  5) RLS Policies
--    - admin/accountant: เห็น/แก้/ลบ ทุก row
--    - staff (มี user_id link): เห็น/insert/update เฉพาะ row ของตัวเอง
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- DROP เก่าก่อน (re-run safe)
DROP POLICY IF EXISTS "att_select_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_insert_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_update_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_delete_admin"          ON public.staff_attendance;

-- SELECT: admin all / staff own
CREATE POLICY "att_select_admin_or_self" ON public.staff_attendance
  FOR SELECT TO authenticated
  USING (
    public.is_accountant()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_attendance.staff_id
        AND s.user_id = auth.uid()
    )
  );

-- INSERT: admin all / staff own (เฉพาะ source='self' หรือ 'queued')
CREATE POLICY "att_insert_admin_or_self" ON public.staff_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (
      source IN ('self','queued')
      AND EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = staff_attendance.staff_id
          AND s.user_id = auth.uid()
      )
    )
  );

-- UPDATE: admin all / staff own (สำหรับ clock-out ของตัวเอง)
CREATE POLICY "att_update_admin_or_self" ON public.staff_attendance
  FOR UPDATE TO authenticated
  USING (
    public.is_accountant()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_attendance.staff_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_accountant()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_attendance.staff_id
        AND s.user_id = auth.uid()
    )
  );

-- DELETE: admin only (พนักงานลบ record ตัวเองไม่ได้)
CREATE POLICY "att_delete_admin" ON public.staff_attendance
  FOR DELETE TO authenticated
  USING (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  6) staff: ปรับ SELECT policy ให้ staff อ่าน row ของตัวเองได้
--     (เพื่อ self-service หาตัวเองหลัง login)
--     เดิม "auth_all_staff" = อ่านได้ทุก row — ปลอดภัยพอแล้วสำหรับเฟสนี้
--     แต่เปิดทาง refine ถ้าต้องการ
-- ═══════════════════════════════════════════════════════════
-- (ไม่แตะ policy "auth_all_staff" เดิม — เก็บไว้กัน regression)


-- ═══════════════════════════════════════════════════════════
--  7) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  8) VERIFY — รันต่อจาก migration เพื่อตรวจสุขภาพ
-- ═══════════════════════════════════════════════════════════

-- (a) ตรวจ columns ใน staff (ต้องมี user_id + email)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff'
  AND column_name IN ('user_id','email')
ORDER BY column_name;
-- Expected: 2 rows (email text YES, user_id uuid YES)

-- (b) ตรวจ table staff_attendance มี columns ครบ
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_attendance'
ORDER BY ordinal_position;
-- Expected: 16 rows (id, staff_id, work_date, clock_in_at, clock_out_at,
-- 4 GPS cols, 2 distance cols, source, client_uuid, notes, created_by, created_at, updated_at)

-- (c) ตรวจ indexes
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('staff','staff_attendance')
  AND indexname LIKE 'idx_attendance%' OR indexname LIKE 'idx_staff_email%' OR indexname LIKE 'idx_staff_user%'
ORDER BY indexname;
-- Expected: idx_attendance_client_uuid, idx_attendance_one_open_session,
--           idx_attendance_staff_date, idx_staff_email_unique, idx_staff_user_id_unique

-- (d) ตรวจ RLS policies บน staff_attendance
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='staff_attendance'
ORDER BY cmd, policyname;
-- Expected: 4 rows
--   att_delete_admin          | DELETE
--   att_insert_admin_or_self  | INSERT
--   att_select_admin_or_self  | SELECT
--   att_update_admin_or_self  | UPDATE

-- (e) ตรวจ RLS enabled
SELECT relrowsecurity FROM pg_class
WHERE relname='staff_attendance' AND relnamespace = 'public'::regnamespace;
-- Expected: true
