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
--   3. copy ผล output ทั้งหมด (7 sections) → paste กลับให้ Claude
-- ═══════════════════════════════════════════════════════════

-- ───────── 1) RLS enabled status (เช็คว่าเปิด RLS ครบมั้ย) ─────────
SELECT
  '1_RLS_STATUS' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
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
ORDER BY c.relname;


-- ───────── 2) ทุก policies ใน public schema ─────────
SELECT
  '2_POLICIES' AS section,
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- ───────── 3) Helper function ownership + body ─────────
SELECT
  '3_HELPER_FUNCS' AS section,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS owner,
  CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
  pg_get_function_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS return_type,
  p.prosrc AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('auth_user_role','is_admin','is_staff','is_sales_or_admin');


-- ───────── 4) Table-level GRANTs (anon/authenticated สิทธิอะไรบ้าง) ─────────
SELECT
  '4_GRANTS' AS section,
  table_schema,
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
GROUP BY table_schema, table_name, grantee
ORDER BY table_name, grantee;


-- ───────── 5) CHECK constraints (ตรวจ Phase 45.2/45.7/45.8 ใช้ค่าใหม่แล้วมั้ย) ─────────
SELECT
  '5_CHECK_CONSTRAINTS' AS section,
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid::regclass::text IN (
    'public.service_jobs','public.stock_movements'
  )
  AND contype = 'c'
ORDER BY table_name, conname;


-- ───────── 6) profiles triggers (อาจเป็นต้นเหตุ recursion) ─────────
SELECT
  '6_PROFILES_TRIGGERS' AS section,
  trigger_schema,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'profiles';


-- ───────── 7) Test: รัน is_admin() ในฐานะ user ปัจจุบัน (ดูว่ามี recursion มั้ย) ─────────
-- ถ้าตรงนี้ error ด้วย stack depth → root cause confirm ที่ helper function
SELECT
  '7_IS_ADMIN_TEST' AS section,
  current_user AS pg_role,
  auth.uid() AS auth_uid,
  public.auth_user_role() AS user_role_returns,
  public.is_admin() AS is_admin_returns;
