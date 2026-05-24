-- ═══════════════════════════════════════════════════════════
--  Phase 92.22e — Pivot Time Clock from staff → profiles/auth.users
--
--  เหตุผล: Boonsook มี 2 entity แยกกัน
--    - profiles (1:1 กับ auth.users) = user accounts ที่ login ได้ (admin/sales/technician)
--      จัดการที่ Settings → ตั้งค่าผู้ใช้งาน
--    - staff = พนักงาน HR (อาจไม่มี login, มี PIN, อยู่ใน module พนักงาน)
--
--  เฟสนี้: เปลี่ยน Time Clock ให้ track "ใครคนที่ login มาตอน clock-in"
--  ไม่ใช่ "พนักงาน HR คนไหน" — ทำให้ dropdown ดึง user ที่มีอยู่ใน Settings
--  ครบทุกคนทันที (ไม่ต้องไป create staff record manually)
--
--  สิ่งที่ migration นี้ทำ:
--    1) DELETE FROM staff_attendance — ทำลาย test data 2 records (Phase 92.22 ทดสอบ)
--       ★ ถ้ามี data จริง ห้ามรัน — ติดต่อ Claude ก่อน
--    2) ALTER TABLE staff_attendance: ADD user_id uuid REFERENCES auth.users(id)
--    3) DROP COLUMN staff_id (FK เก่า)
--    4) RECREATE indexes (rename จาก staff_id เป็น user_id)
--    5) RECREATE RLS policies ใช้ user_id = auth.uid() ตรง ๆ (ไม่ต้อง subquery staff)
--    6) NOTIFY pgrst
--    7) Verify queries
--
--  ขอบเขต:
--    - ★ ไม่แตะ staff table — staff.user_id + staff.email ที่เพิ่มใน Phase 92.22 ยังอยู่
--      (dead columns สำหรับ Time Clock — แต่อาจมีประโยชน์อนาคต ไม่ต้องลบ)
--    - ★ ไม่แตะ payroll / departments / accounting
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ verify
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) ทำลาย test data (Phase 92.22 ทดสอบ 2 records)
--     ★ ถ้ามี data production ห้ามรัน — uncomment ออก
-- ═══════════════════════════════════════════════════════════
DELETE FROM public.staff_attendance;


-- ═══════════════════════════════════════════════════════════
--  2) DROP RLS policies เก่า (ใช้ subquery staff) — ก่อน DROP COLUMN
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "att_select_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_insert_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_update_admin_or_self" ON public.staff_attendance;
DROP POLICY IF EXISTS "att_delete_admin"          ON public.staff_attendance;


-- ═══════════════════════════════════════════════════════════
--  3) DROP indexes เก่า (อ้าง staff_id)
-- ═══════════════════════════════════════════════════════════
DROP INDEX IF EXISTS public.idx_attendance_staff_date;
DROP INDEX IF EXISTS public.idx_attendance_one_open_session;


-- ═══════════════════════════════════════════════════════════
--  4) ALTER schema: drop staff_id + add user_id
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.staff_attendance
  DROP COLUMN IF EXISTS staff_id;

ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.staff_attendance.user_id IS
  'Phase 92.22e: pivot from staff(id) to auth.users(id) — match profiles 1:1. dropdown ที่ Time Clock ดึงจาก profiles แทน staff.';


-- ═══════════════════════════════════════════════════════════
--  5) RECREATE indexes (rename ให้ตรง user_id)
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_attendance_user_date
  ON public.staff_attendance (user_id, work_date DESC, clock_in_at DESC);

-- ★ Partial UNIQUE: กัน user 1 คนมี open session > 1 อันพร้อมกัน
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_open_session_user
  ON public.staff_attendance (user_id)
  WHERE clock_out_at IS NULL;


-- ═══════════════════════════════════════════════════════════
--  6) RECREATE RLS policies — ใช้ user_id = auth.uid() ตรง ๆ
--     (เร็วกว่า + ไม่ต้อง subquery staff)
-- ═══════════════════════════════════════════════════════════

-- SELECT: admin/accountant ทุก row / user เห็นของตัวเอง
CREATE POLICY "att_select_admin_or_self" ON public.staff_attendance
  FOR SELECT TO authenticated
  USING (
    public.is_accountant()
    OR user_id = auth.uid()
  );

-- INSERT: admin ทุก row / user insert ของตัวเอง (source self/queued)
CREATE POLICY "att_insert_admin_or_self" ON public.staff_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (
      source IN ('self','queued')
      AND user_id = auth.uid()
    )
  );

-- UPDATE: admin / user แก้ของตัวเอง (clock-out)
CREATE POLICY "att_update_admin_or_self" ON public.staff_attendance
  FOR UPDATE TO authenticated
  USING (
    public.is_accountant()
    OR user_id = auth.uid()
  )
  WITH CHECK (
    public.is_accountant()
    OR user_id = auth.uid()
  );

-- DELETE: admin only
CREATE POLICY "att_delete_admin" ON public.staff_attendance
  FOR DELETE TO authenticated
  USING (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  7) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  8) VERIFY queries
-- ═══════════════════════════════════════════════════════════

-- (a) columns ใหม่ ของ staff_attendance — Expected: ไม่มี staff_id, มี user_id uuid NOT NULL
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_attendance'
  AND column_name IN ('staff_id','user_id')
ORDER BY column_name;
-- Expected: 1 row — user_id | uuid | NO

-- (b) Indexes — Expected: 2 ตัว (idx_attendance_user_date, idx_attendance_one_open_session_user)
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='staff_attendance'
  AND indexname LIKE 'idx_attendance%'
ORDER BY indexname;
-- Expected:
--   idx_attendance_client_uuid       (เก่า, ยังอยู่)
--   idx_attendance_one_open_session_user
--   idx_attendance_user_date

-- (c) RLS policies — Expected: 4 ตัว (เหมือนเดิม)
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='staff_attendance'
ORDER BY cmd, policyname;
-- Expected: 4 rows, qual references "user_id = auth.uid()" ไม่ใช่ subquery

-- (d) row count = 0 (post-DELETE)
SELECT COUNT(*) FROM public.staff_attendance;
-- Expected: 0
