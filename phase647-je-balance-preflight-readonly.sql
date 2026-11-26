-- Phase 647: catalog-only preflight. Run separately, before any approval to
-- apply the migration. No business rows, no DDL, no data writes.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';

SELECT current_database() AS database_name, current_user AS database_role,
       current_setting('server_version') AS pg_version,
       current_setting('transaction_read_only') AS read_only;

SELECT p.oid::regprocedure::text AS function_name,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       md5(p.prosrc) AS function_body_md5,
       strpos(p.prosrc, 'FROM public.journal_entries') > 0 AS reads_header,
       strpos(p.prosrc, 'FROM public.journal_lines') > 0 AS reads_lines,
       strpos(p.prosrc, 'v_dr <> v_hdr_dr OR v_cr <> v_hdr_cr') > 0 AS compares_header
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.enforce_je_lines_balance()');

SELECT c.oid::regclass::text AS table_name,
       pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
WHERE c.oid IN ('public.journal_entries'::regclass,
                'public.journal_lines'::regclass)
ORDER BY table_name;

SELECT t.tgname, t.tgenabled, t.tgdeferrable, t.tginitdeferred,
       t.tgfoid::regprocedure::text AS trigger_function
FROM pg_trigger t
WHERE t.tgrelid = 'public.journal_lines'::regclass
  AND t.tgname = 'trg_je_lines_balance';

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('journal_entries', 'journal_lines')
  AND policyname IN ('je_select', 'je_select_auto', 'je_delete',
                     'je_insert_auto', 'jl_select', 'jl_insert_auto')
ORDER BY tablename, policyname;

ROLLBACK;
