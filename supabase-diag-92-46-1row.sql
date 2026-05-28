-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Final probe (single SELECT, 1 row, 4 columns)
--
-- Reason: Supabase SQL Editor มักแสดงแค่ result tab สุดท้าย
-- เลยรวม Q1+Q2+Q3 เป็น 1 statement → ผลออกเป็น row เดียว 4 columns
-- → user paste ครบในรอบเดียว
--
-- Run: paste → Run → copy ผล (1 row) มาให้ Claude
-- ═══════════════════════════════════════════════════════════
SELECT
  -- Q1: WITH CHECK expression text VERBATIM
  (SELECT pg_get_expr(polwithcheck, polrelid)
   FROM pg_policy
   WHERE polrelid='public.journal_entries'::regclass
     AND polname='je_insert_auto') AS q1_je_insert_auto_with_check,

  -- Q2: is_accountant() function definition
  (SELECT pg_get_functiondef('public.is_accountant'::regproc)) AS q2_is_accountant_def,

  -- Q3a: non-admin profile.role (test uid จาก script)
  (SELECT role FROM public.profiles
   WHERE id='b28a7260-1ece-4fdf-8248-2a32d01d2dbc'::uuid) AS q3a_non_admin_role,

  -- Q3b: admin profile.role
  (SELECT role FROM public.profiles
   WHERE id='e1400ebb-3edb-486f-8245-4ad713ebaca0'::uuid) AS q3b_admin_role;
