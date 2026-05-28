-- ═══════════════════════════════════════════════════════════
--  Phase 92.46b — Force-reset journal_entries RLS + GRANT defensive
--
--  Why this exists:
--    Phase 92.46 SQL apply ครั้งแรกแล้ว user เห็น je_insert_auto whitelist
--    ในผล pg_policy แต่ verify:accounting A2 (non-admin POST sale's je)
--    ยังถูก reject 42501. diag_je_rls.js confirm ว่า non-admin ถูก block
--    ทุก payload variant (D2-D7 ใน probe) ขณะที่ admin POST ผ่าน (D1).
--
--    Possible root causes (ที่ SQL นี้ปิดทุกตัว):
--    1) je_insert_auto policy ใน DB ไม่ใช่ version ที่มี whitelist
--       (rollback partial / mid-transaction drop)
--    2) Policy เก่า je_admin (FOR ALL admin only) ยังอยู่และ overlap
--    3) RESTRICTIVE policy ซ่อนอยู่จาก Supabase auto-config
--    4) Table-level GRANT INSERT to authenticated หาย
--    5) PostgREST schema cache เก่า
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste ทั้งไฟล์ → Run
--    Re-run safe: DROP IF EXISTS + CREATE OR REPLACE
--
--    หลัง apply → output ของ section (9) จะแสดง active policies
--    ในผลลัพธ์ของ SQL Editor → ถ้ายัง fail หลัง apply, paste output (9) มา
--
--  หลัง apply ผ่าน → รัน `npm run verify:accounting`
--    Expected: A2 → 201 ✅ + A2b summary stable
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) Drop ALL possible policy names (defensive)
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop every policy on journal_entries (regardless of name)
  FOR r IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.journal_entries'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.journal_entries', r.polname);
  END LOOP;
  -- Same for journal_lines
  FOR r IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.journal_lines'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.journal_lines', r.polname);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════
--  2) Ensure RLS enabled (and NOT forced — let admin operate normally)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines   NO FORCE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════
--  3) journal_entries — fresh policies (explicit PERMISSIVE)
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "je_select" ON public.journal_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "je_update" ON public.journal_entries
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "je_delete" ON public.journal_entries
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.is_accountant());

-- ★ INSERT: admin/accountant ทุกอย่าง · non-admin เฉพาะ auto-post whitelist
CREATE POLICY "je_insert_auto" ON public.journal_entries
  AS PERMISSIVE FOR INSERT TO authenticated
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
--  4) journal_lines — fresh policies (mirror entries)
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "jl_select" ON public.journal_lines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "jl_update" ON public.journal_lines
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "jl_delete" ON public.journal_lines
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.is_accountant());

CREATE POLICY "jl_insert_auto" ON public.journal_lines
  AS PERMISSIVE FOR INSERT TO authenticated
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
--  5) Defensive GRANT — กัน table-level privilege หาย
--     (RLS policies เป็น row-level — ต้องมี table-level INSERT GRANT ก่อน)
-- ═══════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_lines   TO authenticated;

-- Sequences (BIGSERIAL ใช้ USAGE+SELECT)
GRANT USAGE, SELECT ON SEQUENCE public.journal_entries_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.journal_lines_id_seq   TO authenticated;


-- ═══════════════════════════════════════════════════════════
--  6) Reload PostgREST schema cache (กัน API ใช้ policy เก่า)
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  7) Self-diagnostic — แสดง active policies ใน SQL Editor output
--     (ถ้ายัง fail หลัง apply ให้ paste output ของ section นี้มา)
-- ═══════════════════════════════════════════════════════════

-- (7a) Active policies on journal_entries (ต้องเห็น 4 ตัว ทั้งหมด PERMISSIVE)
SELECT polname,
       polcmd::text                                              AS cmd,
       polpermissive                                             AS is_permissive,
       array_to_string(
         ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)),
         ','
       )                                                         AS roles,
       LEFT(pg_get_expr(polqual,      polrelid)::text, 80)       AS using_expr,
       LEFT(pg_get_expr(polwithcheck, polrelid)::text, 120)      AS with_check
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
ORDER BY polcmd, polname;
-- Expected 4 rows:
--   je_delete       | DELETE | t | authenticated | is_accountant() | NULL
--   je_insert_auto  | INSERT | t | authenticated | NULL            | (is_accountant() OR ((source_table IS NOT NULL) AND ...))
--   je_select       | SELECT | t | authenticated | is_accountant() | NULL
--   je_update       | UPDATE | t | authenticated | is_accountant() | is_accountant()

-- (7b) Active policies on journal_lines (ต้องเห็น 4 ตัว)
SELECT polname,
       polcmd::text                                              AS cmd,
       polpermissive                                             AS is_permissive,
       array_to_string(
         ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)),
         ','
       )                                                         AS roles
FROM pg_policy
WHERE polrelid = 'public.journal_lines'::regclass
ORDER BY polcmd, polname;

-- (7c) RLS enabled state
SELECT relname,
       relrowsecurity      AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid IN (
  'public.journal_entries'::regclass,
  'public.journal_lines'::regclass
);
-- Expected: rls_enabled=t, rls_forced=f for both

-- (7d) Table-level grants for authenticated (ต้องเห็น INSERT)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('journal_entries', 'journal_lines')
  AND grantee = 'authenticated'
ORDER BY table_name, privilege_type;
-- Expected: INSERT row exists for each table (+ SELECT, UPDATE, DELETE)

-- (7e) Sanity: is_accountant() function exists
SELECT proname, prosecdef AS security_definer
FROM pg_proc WHERE proname = 'is_accountant' AND pronamespace = 'public'::regnamespace;
-- Expected: 1 row, security_definer=t
