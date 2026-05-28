-- ═══════════════════════════════════════════════════════════
--  Phase 92.46 — Auto-Journal RLS Re-apply + Tighten + Integrity Views
--
--  วัตถุประสงค์ (ปิด incident "auto_post_jv deferred for sales#155"):
--    A) Re-apply phase89-25 policies — กรณี production ยังไม่ได้รัน
--       หรือ policy ถูก revert ทำให้ je_insert_auto หาย
--    B) Tighten WITH CHECK: non-admin INSERT ต้องส่ง source_table อยู่ใน whitelist
--       (8 ตัวที่ auto_post.js ใช้จริง) — กัน sales role spam fake JV ด้วย
--       source_table ปลอม
--    C) เพิ่ม diagnostic VIEWs (admin SELECT via RLS เดิม):
--         vw_sales_without_journal / vw_expenses_without_journal /
--         vw_payroll_without_journal
--    D) RPC accounting_integrity_summary() — admin-only, คืน counts
--       ใช้เป็น groundwork สำหรับ Phase 92.47 dashboard
--
--  ขอบเขต (additive only):
--    - ★ ไม่แตะ accounting math / mapping logic ใน auto_post.js
--    - ★ ไม่แตะ period close, fiscal_periods, accounting_periods
--    - ★ ไม่แตะ RLS ของ Leave (phase 92.45) / Payroll (phase 72-77)
--    - ★ ไม่ revert phase89-25 — เป็น strict superset (rerun-safe)
--
--  Behavior change ตัวเดียว:
--    Before: non-admin insert journal_entries with ANY source_table → allowed
--    After:  non-admin insert journal_entries เฉพาะ source_table ใน whitelist
--    Whitelist: sales, expenses, staff_payroll, service_jobs,
--               receipts, delivery_invoices, credit_payments, refunds
--    → ตรงกับ sourceTable values ทั้ง 8 ตัวที่ modules/accounting/auto_post.js
--       เรียก _postJournal ผ่าน postJournalForSale/Expense/Payroll/etc.
--    → admin/accountant ยัง insert source_table อะไรก็ได้ (manual JV)
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ VERIFY ท้ายไฟล์
--    Re-run safe: DROP POLICY IF EXISTS + CREATE OR REPLACE
--
--  หลัง apply → ลอง POS sale ด้วย sales role:
--    Expected: console ไม่มี "auto_post_jv deferred (RLS denied role)"
--    Expected: สมุดรายวัน มี SV journal ของ sale นั้น (filter ดู doc_type=SV)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) journal_entries — split policies (admin all + non-admin insert whitelist)
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "je_admin"        ON public.journal_entries;
DROP POLICY IF EXISTS "je_select"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_update"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_delete"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_insert_auto"  ON public.journal_entries;

CREATE POLICY "je_select" ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "je_update" ON public.journal_entries
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "je_delete" ON public.journal_entries
  FOR DELETE TO authenticated
  USING (public.is_accountant());

-- ★ INSERT: admin/accountant ทุกอย่าง · non-admin เฉพาะ auto-post whitelist
CREATE POLICY "je_insert_auto" ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (
      source_table IS NOT NULL
      AND source_id IS NOT NULL
      AND source_table IN (
        'sales',
        'expenses',
        'staff_payroll',
        'service_jobs',
        'receipts',
        'delivery_invoices',
        'credit_payments',
        'refunds'
      )
    )
  );


-- ═══════════════════════════════════════════════════════════
--  2) journal_lines — split policies (mirror entries + whitelist via parent)
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "jl_admin"        ON public.journal_lines;
DROP POLICY IF EXISTS "jl_select"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_update"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_delete"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_insert_auto"  ON public.journal_lines;

CREATE POLICY "jl_select" ON public.journal_lines
  FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "jl_update" ON public.journal_lines
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "jl_delete" ON public.journal_lines
  FOR DELETE TO authenticated
  USING (public.is_accountant());

-- ★ INSERT lines: accountant ทุกอย่าง · non-admin เฉพาะ lines ที่ผูกกับ entry whitelist
CREATE POLICY "jl_insert_auto" ON public.journal_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = entry_id
        AND je.source_table IS NOT NULL
        AND je.source_id IS NOT NULL
        AND je.source_table IN (
          'sales',
          'expenses',
          'staff_payroll',
          'service_jobs',
          'receipts',
          'delivery_invoices',
          'credit_payments',
          'refunds'
        )
    )
  );


-- ═══════════════════════════════════════════════════════════
--  3) account_mapping — re-apply (SELECT open, write admin-only)
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "am_admin"   ON public.account_mapping;
DROP POLICY IF EXISTS "am_select"  ON public.account_mapping;
DROP POLICY IF EXISTS "am_write"   ON public.account_mapping;

CREATE POLICY "am_select" ON public.account_mapping
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "am_write" ON public.account_mapping
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  4) Diagnostic VIEWs — accounting integrity
--     (inherit RLS from base tables — sales/expenses/payroll SELECT
--      ที่ admin มีอยู่แล้วผ่าน is_accountant() หรือ legacy policies)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.vw_sales_without_journal AS
SELECT s.id, s.created_at
FROM public.sales s
WHERE NOT EXISTS (
  SELECT 1 FROM public.journal_entries je
  WHERE je.source_table = 'sales'
    AND je.source_id    = s.id::text
);
COMMENT ON VIEW public.vw_sales_without_journal IS
  'Phase 92.46: sales rows ไม่มี SV journal — admin backfill target';


CREATE OR REPLACE VIEW public.vw_expenses_without_journal AS
SELECT e.id, e.created_at
FROM public.expenses e
WHERE NOT EXISTS (
  SELECT 1 FROM public.journal_entries je
  WHERE je.source_table = 'expenses'
    AND je.source_id    = e.id::text
);
COMMENT ON VIEW public.vw_expenses_without_journal IS
  'Phase 92.46: expenses ไม่มี JV/PV journal';


CREATE OR REPLACE VIEW public.vw_payroll_without_journal AS
SELECT p.id, p.created_at, p.paid_at
FROM public.staff_payroll p
WHERE p.paid_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.source_table = 'staff_payroll'
      AND je.source_id    = p.id::text
  );
COMMENT ON VIEW public.vw_payroll_without_journal IS
  'Phase 92.46: paid payroll ไม่มี PV journal — Phase 92.44 wire ใหม่, ก่อนหน้าอาจ orphan';


-- ═══════════════════════════════════════════════════════════
--  5) RPC accounting_integrity_summary — admin-only, counts
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.accounting_integrity_summary();
CREATE OR REPLACE FUNCTION public.accounting_integrity_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_accountant() THEN
    RAISE EXCEPTION 'accounting_integrity_summary: admin only' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'sales_without_journal',    (SELECT count(*) FROM public.vw_sales_without_journal),
    'expenses_without_journal', (SELECT count(*) FROM public.vw_expenses_without_journal),
    'payroll_without_journal',  (SELECT count(*) FROM public.vw_payroll_without_journal),
    'checked_at',               now()
  ) INTO v_out;
  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accounting_integrity_summary() TO authenticated;


-- ═══════════════════════════════════════════════════════════
--  6) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  7) VERIFY queries
-- ═══════════════════════════════════════════════════════════

-- (a) Policies — Expected 9 rows (3 tables × 3-4 cmds)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('journal_entries','journal_lines','account_mapping')
ORDER BY tablename, cmd, policyname;

-- (b) je_insert_auto / jl_insert_auto WITH CHECK ต้องมี source_table whitelist
SELECT polname,
       pg_get_expr(polqual,      polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polname IN ('je_insert_auto','jl_insert_auto')
ORDER BY polname;
-- Expected: with_check ของ je_insert_auto ต้องมี 'sales' AND 'staff_payroll' (etc.)

-- (c) Views — Expected 3 rows
SELECT viewname, obj_description(c.oid, 'pg_class') AS comment
FROM pg_views v
JOIN pg_class c ON c.relname = v.viewname
WHERE v.schemaname='public'
  AND v.viewname IN (
    'vw_sales_without_journal',
    'vw_expenses_without_journal',
    'vw_payroll_without_journal'
  )
ORDER BY viewname;

-- (d) RPC + GRANT — Expected: 1 row, authenticated
SELECT r.routine_name, p.privilege_type, p.grantee
FROM information_schema.routine_privileges p
JOIN information_schema.routines r ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public' AND r.routine_name = 'accounting_integrity_summary'
ORDER BY p.grantee;

-- (e) Live counts — รันเป็น admin จริง (ในตัว session)
SELECT public.accounting_integrity_summary();

-- (f) ตัวอย่าง list orphan sales (admin only — RLS เดิม)
SELECT * FROM public.vw_sales_without_journal ORDER BY created_at DESC LIMIT 20;
