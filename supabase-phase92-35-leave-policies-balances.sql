-- ═══════════════════════════════════════════════════════════
--  Phase 92.35 — Leave Policy + Balance/Quota Foundation
--
--  วัตถุประสงค์: รองรับ quota/balance ของวันลาแยกตามประเภท + per-user override
--    - leave_policies: global default ต่อ leave_type (1 row per type)
--    - staff_leave_overrides: per-user override (user+type+effective_year)
--
--  ขอบเขต (additive only — ห้ามแตะของเดิม):
--    - ★ ไม่แก้ staff_leaves / staff_attendance / staff_payroll / profiles / departments
--    - ★ ไม่เปลี่ยน RLS เก่าใด ๆ
--    - ★ ไม่เปลี่ยน money math (เฟสนี้ยังไม่หัก vacation/sick/personal)
--
--  Defaults (seed):
--    vacation = 10 วัน/ปี · sick = 30 วัน/ปี · personal = 3 วัน/ปี
--    unpaid = NULL (ไม่นับ quota) · other = NULL (ไม่นับ quota)
--
--  RLS pattern:
--    leave_policies: admin (is_accountant) ทำได้ทุก op · ทุก authenticated user อ่านได้ (เพื่อให้ UI ของ user เห็น quota)
--    staff_leave_overrides: admin ทำได้ทุก op · user อ่านของตัวเอง (user_id = auth.uid())
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ verify ที่ท้ายไฟล์
--    Re-run safe: ใช้ IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) leave_policies — global defaults ต่อ leave_type
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.leave_policies (
  leave_type      text        PRIMARY KEY,
  annual_quota    numeric(6,2),                        -- NULL = ไม่นับ quota (เช่น unpaid)
  tracks_balance  boolean     NOT NULL DEFAULT true,   -- false = unpaid/other (แสดงใน UI แต่ไม่เตือนเกิน)
  description     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT leave_policies_type_check  CHECK (leave_type IN ('sick','personal','vacation','unpaid','other')),
  CONSTRAINT leave_policies_quota_check CHECK (annual_quota IS NULL OR annual_quota >= 0)
);

COMMENT ON TABLE public.leave_policies IS
  'Phase 92.35: global default quota ต่อปีของแต่ละ leave_type · NULL = ไม่นับ quota';
COMMENT ON COLUMN public.leave_policies.tracks_balance IS
  'true = นับ quota/แสดง balance bar · false = แสดงเฉย ๆ ไม่เตือนเกิน (เช่น unpaid/other)';


-- ═══════════════════════════════════════════════════════════
--  2) staff_leave_overrides — per-user override (optional, scaffold)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.staff_leave_overrides (
  id              bigserial   PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type      text        NOT NULL,
  annual_quota    numeric(6,2),                        -- NULL = "ไม่จำกัด" (override ให้ไม่นับ)
  effective_year  int         NOT NULL,                -- ปีที่ override นี้ใช้ (เช่น 2026)
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_leave_overrides_type_check  CHECK (leave_type IN ('sick','personal','vacation','unpaid','other')),
  CONSTRAINT staff_leave_overrides_year_check  CHECK (effective_year BETWEEN 2020 AND 2100),
  CONSTRAINT staff_leave_overrides_quota_check CHECK (annual_quota IS NULL OR annual_quota >= 0),
  CONSTRAINT staff_leave_overrides_uniq UNIQUE (user_id, leave_type, effective_year)
);

COMMENT ON TABLE public.staff_leave_overrides IS
  'Phase 92.35: per-user override ของ quota รายปี — ถ้ามี row จะใช้ทับ leave_policies default';
COMMENT ON COLUMN public.staff_leave_overrides.annual_quota IS
  'NULL = ไม่จำกัด (สำหรับกรณี override ปลด quota ให้พนักงานบางคน)';


-- ═══════════════════════════════════════════════════════════
--  3) Indexes
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_leave_overrides_user_year
  ON public.staff_leave_overrides (user_id, effective_year DESC);
CREATE INDEX IF NOT EXISTS idx_leave_overrides_year
  ON public.staff_leave_overrides (effective_year DESC);


-- ═══════════════════════════════════════════════════════════
--  4) updated_at triggers (auto-bump)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._bump_leave_policies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_policies_updated_at ON public.leave_policies;
CREATE TRIGGER trg_leave_policies_updated_at
  BEFORE UPDATE ON public.leave_policies
  FOR EACH ROW EXECUTE FUNCTION public._bump_leave_policies_updated_at();

CREATE OR REPLACE FUNCTION public._bump_staff_leave_overrides_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_leave_overrides_updated_at ON public.staff_leave_overrides;
CREATE TRIGGER trg_staff_leave_overrides_updated_at
  BEFORE UPDATE ON public.staff_leave_overrides
  FOR EACH ROW EXECUTE FUNCTION public._bump_staff_leave_overrides_updated_at();


-- ═══════════════════════════════════════════════════════════
--  5) RLS Policies
-- ═══════════════════════════════════════════════════════════

-- leave_policies: ทุก authenticated user อ่านได้ (จำเป็นสำหรับ UI แสดง quota ของ user เอง)
--                 เฉพาะ admin จัดการได้
ALTER TABLE public.leave_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_policies_select_all"     ON public.leave_policies;
DROP POLICY IF EXISTS "leave_policies_insert_admin"   ON public.leave_policies;
DROP POLICY IF EXISTS "leave_policies_update_admin"   ON public.leave_policies;
DROP POLICY IF EXISTS "leave_policies_delete_admin"   ON public.leave_policies;

CREATE POLICY "leave_policies_select_all" ON public.leave_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "leave_policies_insert_admin" ON public.leave_policies
  FOR INSERT TO authenticated WITH CHECK (public.is_accountant());

CREATE POLICY "leave_policies_update_admin" ON public.leave_policies
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "leave_policies_delete_admin" ON public.leave_policies
  FOR DELETE TO authenticated USING (public.is_accountant());


-- staff_leave_overrides: admin ทำได้ทุก op · user อ่านของตัวเอง
ALTER TABLE public.staff_leave_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_overrides_select_admin_or_self" ON public.staff_leave_overrides;
DROP POLICY IF EXISTS "leave_overrides_insert_admin"          ON public.staff_leave_overrides;
DROP POLICY IF EXISTS "leave_overrides_update_admin"          ON public.staff_leave_overrides;
DROP POLICY IF EXISTS "leave_overrides_delete_admin"          ON public.staff_leave_overrides;

CREATE POLICY "leave_overrides_select_admin_or_self" ON public.staff_leave_overrides
  FOR SELECT TO authenticated
  USING (public.is_accountant() OR user_id = auth.uid());

CREATE POLICY "leave_overrides_insert_admin" ON public.staff_leave_overrides
  FOR INSERT TO authenticated WITH CHECK (public.is_accountant());

CREATE POLICY "leave_overrides_update_admin" ON public.staff_leave_overrides
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "leave_overrides_delete_admin" ON public.staff_leave_overrides
  FOR DELETE TO authenticated USING (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  6) Seed default policies (re-run safe via ON CONFLICT DO NOTHING)
-- ═══════════════════════════════════════════════════════════
INSERT INTO public.leave_policies (leave_type, annual_quota, tracks_balance, description) VALUES
  ('vacation',  10,   true,  'พักร้อน — เริ่มต้น 10 วัน/ปี'),
  ('sick',      30,   true,  'ลาป่วย — เริ่มต้น 30 วัน/ปี'),
  ('personal',  3,    true,  'ลากิจ — เริ่มต้น 3 วัน/ปี'),
  ('unpaid',    NULL, false, 'ลาไม่รับค่าจ้าง — ไม่นับ quota'),
  ('other',     NULL, false, 'อื่น ๆ — ไม่นับ quota')
ON CONFLICT (leave_type) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
--  7) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  8) VERIFY queries (รันแต่ละชุดตรวจหลัง apply)
-- ═══════════════════════════════════════════════════════════

-- (a) leave_policies columns + seed — Expected: 5 rows
SELECT leave_type, annual_quota, tracks_balance, description
FROM public.leave_policies
ORDER BY leave_type;

-- (b) staff_leave_overrides columns — Expected: 11 columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='staff_leave_overrides'
ORDER BY ordinal_position;

-- (c) Indexes — Expected: 2 ตัว + PK สำหรับ overrides
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('leave_policies','staff_leave_overrides')
ORDER BY tablename, indexname;

-- (d) RLS policies — Expected: 4 ต่อ table × 2 tables = 8 ตัว
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('leave_policies','staff_leave_overrides')
ORDER BY tablename, cmd, policyname;

-- (e) Triggers — Expected: trg_leave_policies_updated_at + trg_staff_leave_overrides_updated_at
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgrelid IN ('public.leave_policies'::regclass, 'public.staff_leave_overrides'::regclass)
  AND NOT tgisinternal
ORDER BY table_name, tgname;

-- (f) Quick check: ทุก leave_type ใน staff_leaves มี policy ตรงกัน (sanity)
SELECT DISTINCT l.leave_type, p.annual_quota IS NOT NULL AS has_policy
FROM public.staff_leaves l
LEFT JOIN public.leave_policies p ON p.leave_type = l.leave_type
ORDER BY l.leave_type;
