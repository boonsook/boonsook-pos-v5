-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — DIAGNOSTIC ONLY (read-only, ไม่แก้อะไร)
--  Date: 2026-04-28
-- ═══════════════════════════════════════════════════════════
--
-- เป้าหมาย: หา root cause ของ
--   Bug A: profiles SELECT → HTTP 500 stack depth exceeded (recursion)
--   Bug B: anon publishable key อ่าน expenses/receipts/delivery_invoices/
--          warehouse_stock/loyalty_settings ได้ (data leak)
--
-- วิธีรัน:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. paste ทั้งไฟล์ → Run
--   3. result จะเป็น 1 row 7 columns (JSON) — Export → CSV หรือ click cell แล้ว copy
--   4. paste กลับให้ Claude
-- ═══════════════════════════════════════════════════════════

SELECT
  -- 1) RLS enabled status
  (
    SELECT json_agg(json_build_object(
      'table', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity
    ) ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'profiles','expenses','receipts','delivery_invoices',
        'warehouse_stock','loyalty_settings','sales','customers',
        'products','service_jobs','stock_movements','staff',
        'app_settings','recurring_expenses','refunds','tasks',
        'quotations','receipt_items','quotation_items',
        'delivery_invoice_items','sale_items','warehouses',
        'loyalty_points','product_serials','cash_recon'
      )
  ) AS s1_rls_status,

  -- 2) ทุก policies ใน public schema
  (
    SELECT json_agg(json_build_object(
      'table', tablename,
      'policy', policyname,
      'cmd', cmd,
      'roles', roles,
      'using', qual,
      'with_check', with_check
    ) ORDER BY tablename, policyname)
    FROM pg_policies
    WHERE schemaname = 'public'
  ) AS s2_policies,

  -- 3) Helper function ownership + body
  (
    SELECT json_agg(json_build_object(
      'name', p.proname,
      'owner', pg_get_userbyid(p.proowner),
      'security', CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END,
      'returns', pg_get_function_result(p.oid),
      'body', p.prosrc
    ))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('auth_user_role','is_admin','is_staff','is_sales_or_admin')
  ) AS s3_helpers,

  -- 4) Table-level GRANTs
  (
    SELECT json_agg(json_build_object(
      'table', table_name,
      'grantee', grantee,
      'privileges', privileges
    ) ORDER BY table_name, grantee)
    FROM (
      SELECT
        table_name,
        grantee,
        string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon','authenticated','service_role','PUBLIC')
        AND table_name IN (
          'profiles','expenses','receipts','delivery_invoices',
          'warehouse_stock','loyalty_settings','sales','customers',
          'products','service_jobs','stock_movements'
        )
      GROUP BY table_name, grantee
    ) sub
  ) AS s4_grants,

  -- 5) CHECK constraints
  (
    SELECT json_agg(json_build_object(
      'table', conrelid::regclass::text,
      'name', conname,
      'def', pg_get_constraintdef(oid)
    ) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint
    WHERE conrelid::regclass::text IN ('public.service_jobs','public.stock_movements')
      AND contype = 'c'
  ) AS s5_check_constraints,

  -- 6) profiles triggers
  (
    SELECT json_agg(json_build_object(
      'name', trigger_name,
      'event', event_manipulation,
      'timing', action_timing,
      'stmt', action_statement
    ))
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'profiles'
  ) AS s6_profiles_triggers,

  -- 7) IS_ADMIN test (postgres role bypasses RLS — แค่ confirm functions ไม่พังที่ระดับ syntax)
  json_build_object(
    'pg_role', current_user,
    'auth_uid', auth.uid(),
    'auth_user_role', public.auth_user_role(),
    'is_admin', public.is_admin()
  ) AS s7_is_admin_test;
