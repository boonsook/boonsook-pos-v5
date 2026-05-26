-- ═══════════════════════════════════════════════════════════
--  Phase 92.32 — Leave Management Foundation
--
--  วัตถุประสงค์: เพิ่มตาราง staff_leaves + RLS + updated_at trigger
--  สำหรับระบบจัดการ "วันลา / Leave"
--
--  ขอบเขต (additive only — ห้ามแตะของเดิม):
--    - ★ ไม่แก้ staff_attendance / staff_payroll / profiles / departments
--    - ★ ไม่เปลี่ยน RLS เก่าใด ๆ
--    - ★ ไม่เปลี่ยน money math (เฟสนี้ไม่หัก payroll ตาม leave)
--
--  user_id pattern: uuid REFERENCES auth.users(id) (mirror phase 92.22e)
--  RLS pattern: ใช้ public.is_accountant() (จาก phase 88 foundation)
--
--  Roles:
--    - admin (is_accountant) — SELECT/INSERT/UPDATE/DELETE ทุก row
--    - non-admin (user_id = auth.uid())
--        - SELECT ของตัวเอง
--        - INSERT pending request ของตัวเอง
--        - UPDATE/CANCEL ได้เฉพาะ row ของตัวเองที่ยัง status='pending'
--        - approved/rejected/cancelled แก้ไม่ได้ (locked)
--        - DELETE ไม่ได้ (admin only)
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ verify ที่ท้ายไฟล์
--    Re-run safe: ใช้ IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) CREATE TABLE staff_leaves
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.staff_leaves (
  id              bigserial PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  leave_type      text        NOT NULL,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  days_count      numeric(6,2) NOT NULL DEFAULT 1,
  reason          text,
  status          text        NOT NULL DEFAULT 'pending',
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_note     text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_leaves_leave_type_check  CHECK (leave_type IN ('sick','personal','vacation','unpaid','other')),
  CONSTRAINT staff_leaves_status_check      CHECK (status     IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT staff_leaves_end_after_start   CHECK (end_date >= start_date),
  CONSTRAINT staff_leaves_days_positive     CHECK (days_count > 0)
);

COMMENT ON TABLE public.staff_leaves IS
  'Phase 92.32: คำขอวันลาของพนักงาน (sick/personal/vacation/unpaid/other) — pending → approved/rejected/cancelled.';

COMMENT ON COLUMN public.staff_leaves.user_id IS 'auth.users.id — เจ้าของคำขอ (เหมือน staff_attendance.user_id)';
COMMENT ON COLUMN public.staff_leaves.days_count IS 'จำนวนวันลา (numeric รองรับครึ่งวัน เช่น 0.5)';
COMMENT ON COLUMN public.staff_leaves.reviewed_by IS 'auth.users.id ของ admin ที่ approve/reject';


-- ═══════════════════════════════════════════════════════════
--  2) Indexes
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_leaves_user_id     ON public.staff_leaves (user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status      ON public.staff_leaves (status);
CREATE INDEX IF NOT EXISTS idx_leaves_start_date  ON public.staff_leaves (start_date);
CREATE INDEX IF NOT EXISTS idx_leaves_end_date    ON public.staff_leaves (end_date);
CREATE INDEX IF NOT EXISTS idx_leaves_created_at  ON public.staff_leaves (created_at DESC);


-- ═══════════════════════════════════════════════════════════
--  3) updated_at trigger (auto-bump on UPDATE)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._bump_staff_leaves_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_leaves_updated_at ON public.staff_leaves;
CREATE TRIGGER trg_staff_leaves_updated_at
  BEFORE UPDATE ON public.staff_leaves
  FOR EACH ROW EXECUTE FUNCTION public._bump_staff_leaves_updated_at();


-- ═══════════════════════════════════════════════════════════
--  4) RLS Policies
--     - admin (is_accountant): all
--     - non-admin (user_id = auth.uid()):
--         SELECT own / INSERT own pending / UPDATE own pending only / no DELETE
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.staff_leaves ENABLE ROW LEVEL SECURITY;

-- DROP เก่าก่อน (re-run safe)
DROP POLICY IF EXISTS "leaves_select_admin_or_self"        ON public.staff_leaves;
DROP POLICY IF EXISTS "leaves_insert_admin_or_self_pending" ON public.staff_leaves;
DROP POLICY IF EXISTS "leaves_update_admin_or_self_pending" ON public.staff_leaves;
DROP POLICY IF EXISTS "leaves_delete_admin"                ON public.staff_leaves;

-- SELECT: admin ทุก row / user เห็นของตัวเอง
CREATE POLICY "leaves_select_admin_or_self" ON public.staff_leaves
  FOR SELECT TO authenticated
  USING (
    public.is_accountant()
    OR user_id = auth.uid()
  );

-- INSERT: admin ทุก row / user insert ของตัวเองในสถานะ pending เท่านั้น
CREATE POLICY "leaves_insert_admin_or_self_pending" ON public.staff_leaves
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (
      user_id = auth.uid()
      AND status = 'pending'
    )
  );

-- UPDATE: admin ทุก row / user แก้ของตัวเองเฉพาะตอนยัง pending → ยังคง pending หรือ cancelled
--   ★ Non-admin ห้ามตั้ง status เป็น approved/rejected (admin only)
CREATE POLICY "leaves_update_admin_or_self_pending" ON public.staff_leaves
  FOR UPDATE TO authenticated
  USING (
    public.is_accountant()
    OR (
      user_id = auth.uid()
      AND status = 'pending'
    )
  )
  WITH CHECK (
    public.is_accountant()
    OR (
      user_id = auth.uid()
      AND status IN ('pending','cancelled')
    )
  );

-- DELETE: admin only
CREATE POLICY "leaves_delete_admin" ON public.staff_leaves
  FOR DELETE TO authenticated
  USING (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  5) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  6) VERIFY queries (รันทีละชุดเพื่อตรวจหลัง apply)
-- ═══════════════════════════════════════════════════════════

-- (a) Table + columns — Expected: 15 columns (id, user_id, leave_type, ...)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_leaves'
ORDER BY ordinal_position;

-- (b) Constraints — Expected: 4 CHECK constraints
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname='public' AND rel.relname='staff_leaves' AND con.contype='c'
ORDER BY con.conname;

-- (c) Indexes — Expected: 5 ตัว (รวม PK)
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='staff_leaves'
ORDER BY indexname;

-- (d) RLS policies — Expected: 4 ตัว
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='staff_leaves'
ORDER BY cmd, policyname;

-- (e) trigger — Expected: trg_staff_leaves_updated_at
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.staff_leaves'::regclass AND NOT tgisinternal;

-- (f) row count = 0 (post-CREATE)
SELECT COUNT(*) FROM public.staff_leaves;
