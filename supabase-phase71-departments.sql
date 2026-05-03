-- ═══════════════════════════════════════════════════════════
--  Phase 71 — Departments (foundation for payroll Phase 72-73)
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- ตารางแผนก + link จาก profiles → department_id
-- ใช้สำหรับ:
--   1) จัดกลุ่มพนักงาน (ช่างแอร์ / กรรมการ / พนักงานขาย ฯลฯ)
--   2) คำนวณ payroll ตามแผนกใน Phase 72-73
--   3) รายงานยอดขายแยกตามพนักงาน → group by department

CREATE TABLE IF NOT EXISTS public.departments (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,    -- เช่น "01", "AC", "MGT"
  name        TEXT NOT NULL,           -- เช่น "ช่างแอร์", "กรรมการผู้จัดการ"
  description TEXT,                    -- หมายเหตุ optional
  sort_order  INT NOT NULL DEFAULT 0,  -- สำหรับ sort ใน UI
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_departments_active ON public.departments(is_active);
CREATE INDEX IF NOT EXISTS idx_departments_sort   ON public.departments(sort_order, name);

-- เพิ่ม column department_id ใน profiles (FK → departments)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles(department_id);

-- ───── RLS ─────
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- authenticated อ่านได้ทุก row (ทุกคนเห็นแผนก)
DROP POLICY IF EXISTS "departments_select_authenticated" ON public.departments;
CREATE POLICY "departments_select_authenticated" ON public.departments
  FOR SELECT TO authenticated USING (true);

-- admin เท่านั้นที่ insert/update/delete
DROP POLICY IF EXISTS "departments_write_admin" ON public.departments;
CREATE POLICY "departments_write_admin" ON public.departments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.departments_id_seq TO authenticated;
REVOKE ALL ON public.departments FROM anon;

-- ───── Seed default departments (จาก screenshot user) ─────
INSERT INTO public.departments (code, name, sort_order, is_active) VALUES
  ('01', 'ช่างแอร์',         1, TRUE),
  ('02', 'กรรมการผู้จัดการ',  2, TRUE),
  ('03', 'พนักงานขาย',       3, TRUE),
  ('04', 'แคชเชียร์',         4, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT d.id, d.code, d.name, COUNT(p.id) AS staff_count
-- FROM departments d
-- LEFT JOIN profiles p ON p.department_id = d.id
-- GROUP BY d.id, d.code, d.name
-- ORDER BY d.sort_order, d.name;
