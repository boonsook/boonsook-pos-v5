-- ═══════════════════════════════════════════════════════════
--  Phase 72 — Staff Payroll (รายการเงินเดือน)
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- ตารางจ่ายเงินพนักงานรายเดือน
-- หมวดเงินเดือน (จาก screenshot user):
--   - base_salary  เงินเดือน
--   - overtime     ค่าล่วงเวลา
--   - welfare      สวัสดิการ
--   - bonus        เงินพิเศษ
--   - commission   คอมมิชชัน
-- + ค่าหัก (deductions) เผื่ออนาคต
-- + paid_at เพื่อ track วันจ่ายจริง

CREATE TABLE IF NOT EXISTS public.staff_payroll (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id   BIGINT REFERENCES public.departments(id) ON DELETE SET NULL,
  period_month    DATE NOT NULL,            -- ตัวแทนเดือน เก็บเป็น 1st: '2026-05-01'
  base_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime        NUMERIC(12,2) NOT NULL DEFAULT 0,
  welfare         NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus           NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission      NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(12,2) GENERATED ALWAYS AS
    (base_salary + overtime + welfare + bonus + commission - deductions) STORED,
  paid_at         TIMESTAMPTZ,              -- NULL = ยังไม่จ่าย
  payment_method  TEXT,                     -- cash / transfer / cheque
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1 พนักงาน 1 รอบเดือน — กัน duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_payroll_emp_month
  ON public.staff_payroll(employee_id, period_month);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON public.staff_payroll(period_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_dept   ON public.staff_payroll(department_id);
CREATE INDEX IF NOT EXISTS idx_payroll_paid   ON public.staff_payroll(paid_at);

-- ───── RLS ─────
ALTER TABLE public.staff_payroll ENABLE ROW LEVEL SECURITY;

-- admin อ่าน/เขียนได้ทุก row
DROP POLICY IF EXISTS "payroll_admin_all" ON public.staff_payroll;
CREATE POLICY "payroll_admin_all" ON public.staff_payroll
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- พนักงานเห็นเฉพาะ row ของตัวเอง (ดูสลิปตัวเอง)
DROP POLICY IF EXISTS "payroll_self_read" ON public.staff_payroll;
CREATE POLICY "payroll_self_read" ON public.staff_payroll
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_payroll TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.staff_payroll_id_seq TO authenticated;
REVOKE ALL ON public.staff_payroll FROM anon;

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT
--   sp.period_month,
--   p.full_name,
--   d.name AS department,
--   sp.base_salary, sp.overtime, sp.welfare, sp.bonus, sp.commission,
--   sp.total_amount, sp.paid_at
-- FROM staff_payroll sp
-- JOIN profiles p ON p.id = sp.employee_id
-- LEFT JOIN departments d ON d.id = sp.department_id
-- ORDER BY sp.period_month DESC, p.full_name;
