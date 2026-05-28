-- ═══════════════════════════════════════════════════════════
--  Diagnostic ONLY — Phase 92.46 journal_entries RLS check
--  NO DDL — read-only inspection.
--
--  How to use:
--    1. Supabase Dashboard → SQL Editor → paste ทั้งไฟล์ → Run
--    2. SQL Editor จะ return 3 result sets:
--       (A) Pass/fail table — สแกน column "verdict" หา FAIL
--       (B) je_insert_auto WITH CHECK expression — เห็นทั้ง expression เต็ม
--       (C) All policies on journal_entries — เห็นทุกตัวที่ active
--    3. Paste ทั้งสาม results มาให้ Claude — โดยเฉพาะแถวที่ verdict='FAIL'
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  (A) Consolidated pass/fail table — 11 checks
-- ═══════════════════════════════════════════════════════════
WITH
  je_pol AS (
    SELECT * FROM pg_policy
    WHERE polrelid = 'public.journal_entries'::regclass
      AND polname  = 'je_insert_auto'
  ),
  je_class AS (
    SELECT relrowsecurity AS rls_on,
           relforcerowsecurity AS rls_forced
    FROM pg_class
    WHERE oid = 'public.journal_entries'::regclass
  ),
  je_with_check AS (
    SELECT pg_get_expr(polwithcheck, polrelid) AS expr
    FROM je_pol
  ),
  je_roles AS (
    SELECT array_to_string(
             ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)),
             ','
           ) AS role_list
    FROM je_pol
  ),
  restrictive_count AS (
    SELECT count(*) AS n
    FROM pg_policy
    WHERE polrelid = 'public.journal_entries'::regclass
      AND polpermissive = false
  ),
  has_je_insert_grant AS (
    SELECT count(*) AS n
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='journal_entries'
      AND grantee='authenticated' AND privilege_type='INSERT'
  ),
  has_jl_insert_grant AS (
    SELECT count(*) AS n
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='journal_lines'
      AND grantee='authenticated' AND privilege_type='INSERT'
  ),
  has_je_seq_grant AS (
    SELECT count(*) AS n
    FROM information_schema.role_usage_grants
    WHERE object_schema='public' AND object_name='journal_entries_id_seq'
      AND grantee='authenticated'
  ),
  has_jl_seq_grant AS (
    SELECT count(*) AS n
    FROM information_schema.role_usage_grants
    WHERE object_schema='public' AND object_name='journal_lines_id_seq'
      AND grantee='authenticated'
  ),
  has_is_accountant_fn AS (
    SELECT count(*) AS n
    FROM pg_proc
    WHERE proname='is_accountant' AND pronamespace='public'::regnamespace
  )
SELECT 1::int AS ord,
       'je_insert_auto policy exists'::text                       AS check_name,
       'policy present'::text                                      AS expected,
       COALESCE((SELECT polname FROM je_pol)::text, 'MISSING')     AS actual,
       CASE WHEN (SELECT count(*) FROM je_pol) = 1
            THEN 'PASS' ELSE 'FAIL' END                            AS verdict
UNION ALL
SELECT 2,
       'je_insert_auto is PERMISSIVE',
       'true (PERMISSIVE)',
       COALESCE((SELECT polpermissive::text FROM je_pol), 'N/A'),
       CASE WHEN (SELECT polpermissive FROM je_pol) = true
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 3,
       'je_insert_auto target role = authenticated',
       'authenticated',
       COALESCE((SELECT role_list FROM je_roles), 'N/A'),
       CASE WHEN (SELECT role_list FROM je_roles) LIKE '%authenticated%'
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 4,
       'je_insert_auto WITH CHECK contains ''sales'' (whitelist)',
       'expression contains ''sales''',
       COALESCE(
         CASE WHEN (SELECT expr FROM je_with_check) LIKE '%''sales''%'
              THEN 'YES (whitelist active)' ELSE 'NO whitelist found' END,
         'N/A — no policy'),
       CASE WHEN (SELECT expr FROM je_with_check) LIKE '%''sales''%'
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 5,
       'journal_entries RLS enabled',
       'true',
       (SELECT rls_on::text FROM je_class),
       CASE WHEN (SELECT rls_on FROM je_class) = true
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 6,
       'journal_entries RLS NOT FORCED',
       'false',
       (SELECT rls_forced::text FROM je_class),
       CASE WHEN (SELECT rls_forced FROM je_class) = false
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 7,
       'NO restrictive policy on journal_entries',
       '0 restrictive policies',
       (SELECT n::text FROM restrictive_count) || ' restrictive',
       CASE WHEN (SELECT n FROM restrictive_count) = 0
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 8,
       'authenticated has INSERT on journal_entries',
       'INSERT grant exists',
       CASE WHEN (SELECT n FROM has_je_insert_grant) > 0 THEN 'YES' ELSE 'MISSING' END,
       CASE WHEN (SELECT n FROM has_je_insert_grant) > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 9,
       'authenticated has INSERT on journal_lines',
       'INSERT grant exists',
       CASE WHEN (SELECT n FROM has_jl_insert_grant) > 0 THEN 'YES' ELSE 'MISSING' END,
       CASE WHEN (SELECT n FROM has_jl_insert_grant) > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 10,
       'authenticated has USAGE on journal_entries_id_seq',
       'USAGE grant exists',
       CASE WHEN (SELECT n FROM has_je_seq_grant) > 0 THEN 'YES' ELSE 'MISSING' END,
       CASE WHEN (SELECT n FROM has_je_seq_grant) > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 11,
       'authenticated has USAGE on journal_lines_id_seq',
       'USAGE grant exists',
       CASE WHEN (SELECT n FROM has_jl_seq_grant) > 0 THEN 'YES' ELSE 'MISSING' END,
       CASE WHEN (SELECT n FROM has_jl_seq_grant) > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 12,
       'is_accountant() function exists',
       'function present',
       CASE WHEN (SELECT n FROM has_is_accountant_fn) > 0 THEN 'YES' ELSE 'MISSING' END,
       CASE WHEN (SELECT n FROM has_is_accountant_fn) > 0 THEN 'PASS' ELSE 'FAIL' END
ORDER BY ord;


-- ═══════════════════════════════════════════════════════════
--  (B) Full je_insert_auto WITH CHECK expression (inspect verbatim)
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_expr(polwithcheck, polrelid) AS je_insert_auto_with_check_expression
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
  AND polname  = 'je_insert_auto';


-- ═══════════════════════════════════════════════════════════
--  (C) ALL policies on journal_entries (in case of hidden ones)
-- ═══════════════════════════════════════════════════════════
SELECT polname                                                AS name,
       polcmd::text                                            AS cmd,
       polpermissive                                           AS is_permissive,
       array_to_string(
         ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)),
         ','
       )                                                       AS roles
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
ORDER BY polcmd, polname;
