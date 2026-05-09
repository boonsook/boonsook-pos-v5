-- ═══════════════════════════════════════════════════════════
--  Phase 88.19 — Period Close (Lock periods)
--
--  ปิดงวดบัญชี → ห้ามแก้ JV ในงวดที่ปิดแล้ว
--  เปิดล็อกได้ (admin) แต่ต้องกรอกเหตุผล + log audit trail
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) Table: accounting_periods
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id           BIGSERIAL PRIMARY KEY,
  year         INT NOT NULL,
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,                            -- email หรือ user_id ของ admin
  unlock_reason TEXT,                           -- กรอกตอน unlock — audit trail
  unlock_at    TIMESTAMPTZ,
  unlock_by    TEXT,
  -- summary snapshot ตอนปิดงวด
  total_revenue   NUMERIC(15,2),
  total_expense   NUMERIC(15,2),
  net_income      NUMERIC(15,2),
  jv_count        INT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_year_month
  ON public.accounting_periods (year, month);


-- ───────────────────────────────────────────────────────────
-- 2) RLS — auth users อ่าน/เขียนได้ (ผ่าน app role check)
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "periods_select" ON public.accounting_periods;
CREATE POLICY "periods_select" ON public.accounting_periods
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "periods_insert" ON public.accounting_periods;
CREATE POLICY "periods_insert" ON public.accounting_periods
  FOR INSERT TO authenticated, anon WITH CHECK (true);

DROP POLICY IF EXISTS "periods_update" ON public.accounting_periods;
CREATE POLICY "periods_update" ON public.accounting_periods
  FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


-- ───────────────────────────────────────────────────────────
-- 3) Helper function: ตรวจว่า docDate อยู่ใน period ที่ locked หรือเปล่า
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_period_locked(p_doc_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.accounting_periods
  WHERE year = EXTRACT(YEAR FROM p_doc_date)::INT
    AND month = EXTRACT(MONTH FROM p_doc_date)::INT;

  -- ถ้าไม่มี row → ถือว่า open (ยังไม่เคยปิด)
  RETURN COALESCE(v_status = 'locked', FALSE);
END;
$$;


-- ───────────────────────────────────────────────────────────
-- 4) Trigger: กัน insert/update journal_entries ใน locked period
--    (defense in depth — Front-end ก็ check แต่กันทาง DB ด้วย)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_period_not_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- กัน insert ใหม่ใน locked period
  IF TG_OP = 'INSERT' THEN
    IF public.is_period_locked(NEW.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: งวด % ถูกปิดแล้ว — ปลดล็อกก่อน', TO_CHAR(NEW.doc_date, 'YYYY-MM');
    END IF;
  END IF;

  -- กัน update doc_date เข้า/ออกจาก locked period
  IF TG_OP = 'UPDATE' THEN
    -- ถ้าวันเดิมอยู่ใน locked period
    IF public.is_period_locked(OLD.doc_date) THEN
      -- อนุญาตเฉพาะการ void (status: approved -> void) — ห้ามแก้ field อื่น
      IF NEW.status = 'void' AND OLD.status = 'approved'
         AND NEW.doc_date = OLD.doc_date
         AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
        RETURN NEW;  -- void ใน locked period — อนุญาตเป็นกรณีพิเศษ
      END IF;
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามแก้ JV ในงวด % ที่ปิดแล้ว', TO_CHAR(OLD.doc_date, 'YYYY-MM');
    END IF;

    -- ถ้าจะย้าย doc_date เข้า locked period
    IF NEW.doc_date != OLD.doc_date AND public.is_period_locked(NEW.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามย้าย JV เข้างวด % ที่ปิดแล้ว', TO_CHAR(NEW.doc_date, 'YYYY-MM');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_period_locked ON public.journal_entries;
CREATE TRIGGER trg_check_period_locked
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.check_period_not_locked();


-- ───────────────────────────────────────────────────────────
-- 5) Reload PostgREST schema cache
-- ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────
-- 6) Verify — ดูว่า table + function + trigger พร้อม
-- ───────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'accounting_periods') AS table_exists,
  (SELECT COUNT(*) FROM information_schema.routines
   WHERE routine_schema = 'public' AND routine_name = 'is_period_locked') AS fn_exists,
  (SELECT COUNT(*) FROM information_schema.triggers
   WHERE trigger_schema = 'public' AND trigger_name = 'trg_check_period_locked') AS trigger_exists;

-- Expected: 1 | 1 | 1
