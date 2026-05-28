-- ═══════════════════════════════════════════════════════════
-- Phase 92.46 Root Cause Diagnostic — Single-result consolidated
-- รันแค่ statement นี้ → ผลเป็นตาราง 10 rows
--
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- Read-only · no DDL · safe to re-run
--
-- Paste กลับมาให้ Claude → pinpoint root cause → write targeted patch
-- ═══════════════════════════════════════════════════════════
SELECT * FROM (VALUES

  -- ★ MOST LIKELY SUSPECT — RESTRICTIVE policies (AND-combined → block sales)
  ('1. RESTRICTIVE policies on je/jl (★ suspect #1)',
   (SELECT count(*)::text FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace='public'::regnamespace
      AND c.relname IN ('journal_entries','journal_lines')
      AND NOT p.polpermissive),
   '0'),

  ('2. Total policies on je/jl',
   (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('journal_entries','journal_lines')),
   '8 (4+4)'),

  ('3. authenticated INSERT on journal_entries',
   CASE WHEN EXISTS (
     SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='journal_entries'
       AND grantee='authenticated' AND privilege_type='INSERT'
   ) THEN 'YES' ELSE 'NO (★ root cause?)' END,
   'YES'),

  ('4. authenticated INSERT on journal_lines',
   CASE WHEN EXISTS (
     SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='journal_lines'
       AND grantee='authenticated' AND privilege_type='INSERT'
   ) THEN 'YES' ELSE 'NO (★ root cause?)' END,
   'YES'),

  ('5. authenticated SELECT on journal_entries',
   CASE WHEN EXISTS (
     SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='journal_entries'
       AND grantee='authenticated' AND privilege_type='SELECT'
   ) THEN 'YES' ELSE 'NO' END,
   'YES'),

  ('6. journal_entries RLS enabled',
   (SELECT relrowsecurity::text FROM pg_class
    WHERE relname='journal_entries' AND relnamespace='public'::regnamespace),
   't'),

  ('7. journal_entries FORCE RLS',
   (SELECT relforcerowsecurity::text FROM pg_class
    WHERE relname='journal_entries' AND relnamespace='public'::regnamespace),
   'f'),

  ('8. journal_entries owner',
   (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE relname='journal_entries' AND relnamespace='public'::regnamespace),
   'postgres or supabase_admin'),

  ('9. je_insert_auto policy exists',
   CASE WHEN EXISTS (
     SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='journal_entries' AND policyname='je_insert_auto'
   ) THEN 'YES' ELSE 'NO' END,
   'YES'),

  ('10. je_insert_auto target role',
   (SELECT array_to_string(roles, ',') FROM pg_policies
    WHERE schemaname='public' AND tablename='journal_entries' AND policyname='je_insert_auto'),
   'authenticated')

) AS t(check_name, actual, expected);
