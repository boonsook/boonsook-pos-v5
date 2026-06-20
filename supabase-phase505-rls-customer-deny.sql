-- ═══════════════════════════════════════════════════════════════════════
-- Phase 505 — RLS restrictive deny: customer OTP on business tables (audit B3)
-- ═══════════════════════════════════════════════════════════════════════
-- ปัญหา (B3): supabase-rls-policies.sql เปิด `FOR ALL TO authenticated
--   USING(true) WITH CHECK(true)` แทบทุกตาราง. ลูกค้าที่ login ผ่าน OTP คือ
--   role=authenticated จริง → พิมพ์ sb.from('staff').select('*') ใน console
--   อ่าน PIN/ยอดขาย/รายจ่าย/stock ทั้งร้านได้.
--
-- วิธี (แคบโดยตั้งใจ): เพิ่ม "ชั้นกันลูกค้า" แบบ RESTRICTIVE policy ทับตารางธุรกิจ
--   — ไม่ DROP / ไม่แก้ permissive ของ staff (auth_all_*). RESTRICTIVE จะ AND กับ
--   permissive เดิม:
--     • staff (ไม่ใช่ลูกค้า) → ผ่าน restrictive → ตกไปใช้ policy เดิม → ทำงานเหมือนเดิม
--     • customer            → ไม่ผ่าน restrictive → ถูก deny
--   precedent: phase 445/447b เพิ่มชั้น policy ด้วย helper is_accountant() (ของเขา
--   PERMISSIVE=เปิด; ของเฟสนี้ RESTRICTIVE=กลับด้าน คือกัน).
--
-- discriminator (verified live โดย reviewer 2026-06-20):
--   customer OTP ทั้ง 6 ราย: profiles.role='customer' AND raw_user_meta_data->>'role'
--   ='customer' ตรงกัน; staff ที่มี meta='customer' = 0 ราย → ใช้ profiles.role
--   เป็นหลัก + metadata เป็น belt-and-suspenders. (re-confirm ด้วย STEP 0-B ก่อน apply.)
--
-- ⚠️ idempotent — รันซ้ำได้ (DROP POLICY IF EXISTS ก่อน CREATE; helper = CREATE OR REPLACE).
-- ⚠️ to_regclass guard — ตารางที่ไม่มีใน DB นี้จะถูกข้าม (ไม่ error).
--
-- ❗ ก่อน apply: รัน STEP 0-A (ด้านล่าง) ที่ live เพื่อ "ยืนยันรายชื่อตาราง" — ถ้า live
--   มีตาราง business/PII เพิ่ม (เห็นเฉพาะ live, ไม่อยู่ใน repo) ให้เพิ่มชื่อใน GROUP A array.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- STEP 0 — VERIFY LIVE (รันก่อน, อ่านอย่างเดียว, แนบผลในรายงาน)
-- ───────────────────────────────────────────────────────────────────────
-- (0-A) policy + ตารางจริงทั้งหมด → ใช้ยืนยัน deny-list ให้ครบ (รวมตารางบัญชี/payroll
--       ที่ reviewer ไม่เห็นใน repo); ตาราง staff ถ้า live ไม่ใช่ USING(true) แล้ว
--       (เช่น staff_admin_only = is_admin()) → ห้ามแตะ permissive นั้น แค่เพิ่ม restrictive.
--   SELECT tablename, policyname, cmd, permissive, roles,
--          pg_get_expr(qual, polrelid)       AS using_expr,
--          pg_get_expr(with_check, polrelid) AS check_expr
--   FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
--
-- (0-B) re-confirm discriminator ก่อนใช้จริง:
--   SELECT p.role, u.raw_user_meta_data->>'role' AS meta, count(*)
--   FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--   WHERE u.raw_user_meta_data->>'role'='customer' GROUP BY 1,2;


-- ───────────────────────────────────────────────────────────────────────
-- 1) helper is_customer_role() — dual-source, กัน RLS recursion (SECURITY DEFINER)
--    คืน TRUE เฉพาะเมื่อ "มั่นใจว่าเป็นลูกค้า" (profiles.role OR auth metadata = 'customer');
--    staff/unknown/null → FALSE (เพื่อไม่ให้ staff legitimate ถูกบล็อก — ทุก auth user
--    ถูก seed profiles row โดย handle_new_user เสมอ → "ไม่มี row" แทบไม่เกิดกับ staff จริง).
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_customer_role()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'customer', false)
      OR COALESCE((SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'customer', false)
$$;

GRANT EXECUTE ON FUNCTION public.is_customer_role() TO authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- 2) GROUP A — deny เต็ม (FOR ALL): ตารางที่ลูกค้าไม่ควรแตะเลย (อ่าน+เขียน)
--    USING + WITH CHECK ใช้ NOT COALESCE(...,false) ทั้งคู่.
--    ★ COALESCE(...,false) จำเป็น — RESTRICTIVE ที่ qual=NULL จะ deny ทุกคนรวม staff (break).
-- ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  -- @GROUP_A_TABLES (guard test อ่าน array นี้)
  group_a text[] := ARRAY[
    -- core business (B3 leak: USING(true) ใน rls-policies.sql)
    'staff', 'sales', 'sale_items', 'expenses', 'stock_movements',
    'warehouse_stock', 'warehouses', 'products', 'credit_payments', 'refunds',
    'receipts', 'receipt_items', 'quotations', 'quotation_items',
    'delivery_invoices', 'delivery_invoice_items', 'loyalty_points',
    'product_serials', 'product_bundles', 'recurring_expenses', 'tasks',
    'quote_templates', 'app_settings',
    -- accounting / payroll / HR (defense-in-depth; ส่วนใหญ่ gate is_accountant()/
    -- is_admin() อยู่แล้ว → restrictive ทับไม่ลดสิทธิ staff)
    'journal_entries', 'journal_lines', 'chart_of_accounts', 'accounting_periods',
    'account_mapping', 'fiscal_periods', 'staff_payroll', 'staff_attendance',
    'staff_applications', 'staff_leaves', 'staff_leave_overrides',
    'staff_resignations', 'leave_policies',
    -- +4 จาก STEP 0-A cross-check (เปิด USING(true) ให้ authenticated ใน live;
    -- staff_sessions = FOR ALL true อันตรายสุด); store_settings เว้น (public-by-design)
    'line_notify_settings', 'loyalty_settings', 'permissions', 'staff_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY group_a LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny_customer_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I '
        'AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (NOT COALESCE(public.is_customer_role(), false)) '
        'WITH CHECK (NOT COALESCE(public.is_customer_role(), false))',
        'deny_customer_' || t, t);
    ELSE
      RAISE NOTICE 'skip GROUP A: table public.% not found', t;
    END IF;
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────────
-- 3) GROUP B — deny อ่าน (SELECT/UPDATE/DELETE) แต่ "เปิด INSERT" ให้ลูกค้า
--    เพราะลูกค้ามี flow เขียนจริง 2 ตาราง:
--      • service_jobs = ทางสั่งงาน/สั่งซื้อ (service_request.js:237 + customer_dashboard
--        checkout 1077-1117; checkout จงใจไม่ส่ง created_by) → ★ ห้ามใส่ created_by ใน
--        WITH CHECK เด็ดขาด มิฉะนั้น checkout พัง.
--      • customers    = ลูกค้า signup สร้าง record (auth_otp.js:221).
--    USING = deny (อ่าน/แก้/ลบ cross-customer ไม่ได้); WITH CHECK = true (insert ผ่าน
--    permissive เดิมต่อไป). ⚠️ write-abuse คงเดิม (เท่าของเก่า ไม่ regress) = residual.
-- ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  -- @GROUP_B_TABLES (guard test อ่าน array นี้)
  group_b text[] := ARRAY['service_jobs', 'customers'];
BEGIN
  FOREACH t IN ARRAY group_b LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny_customer_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I '
        'AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (NOT COALESCE(public.is_customer_role(), false)) '
        'WITH CHECK (true)',
        'deny_customer_' || t, t);
    ELSE
      RAISE NOTICE 'skip GROUP B: table public.% not found', t;
    END IF;
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────────
-- 3C) GROUP C — profiles: customer เห็น/แก้ "แค่ own row"; staff เห็นหมด.
--   ★ ห้ามใส่ profiles ใน group_a (deny เต็ม → login main.js:1070 อ่าน own row ไม่ได้ →
--     fallback role='sales' @main.js:1072 = privilege escalation) หรือ group_b
--     (WITH CHECK true → ลูกค้า insert profile ปลอม role อื่น).
--   USING/WITH CHECK = (NOT customer) OR (own row) → staff ผ่านหมด; customer ผ่านเฉพาะ
--     id=auth.uid() → อ่าน/เขียน own profile ได้ 100% (login role='customer' ไม่ fallback).
--   guard_profile_role_update (phase 495) ยังคุม role-change ต่อ — ไม่แตะ.
--   profiles_with_email view (security_invoker=on) inherit RLS นี้ → customer เห็นแค่ own.
-- ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deny_customer_profiles" ON public.profiles;
CREATE POLICY "deny_customer_profiles" ON public.profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (NOT COALESCE(public.is_customer_role(), false) OR id = auth.uid())
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false) OR id = auth.uid());


-- ───────────────────────────────────────────────────────────────────────
-- 4) reload PostgREST schema cache
-- ───────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════
-- 5) VERIFY (รันหลัง apply — แนบผลในรายงาน)
-- ═══════════════════════════════════════════════════════════════════════
-- (5a) policy ใหม่ต้องโผล่ครบ (permissive=f / restrictive):
--   SELECT polrelid::regclass AS tbl, polname, polcmd::text AS cmd, polpermissive,
--          pg_get_expr(polqual, polrelid)     AS using_expr,
--          pg_get_expr(polwithcheck, polrelid) AS check_expr
--   FROM pg_policy WHERE polname LIKE 'deny_customer_%'
--   ORDER BY tbl;
--   คาดหวัง: GROUP A → using/check = (NOT COALESCE(is_customer_role(),false))
--            GROUP B (service_jobs/customers) → using = deny, check_expr = true
--
-- (5b) helper ถูกต้องภายใต้ JWT จำลอง (แทน <cust-uuid>/<staff-uuid> เป็น uuid จริงจาก 0-B):
--   SET LOCAL request.jwt.claims = '{"sub":"<cust-uuid>","role":"authenticated"}';
--   SELECT public.is_customer_role();   -- → true
--   SET LOCAL request.jwt.claims = '{"sub":"<staff-uuid>","role":"authenticated"}';
--   SELECT public.is_customer_role();   -- → false
--
-- (5c) customer ถูก deny ตาราง sensitive + ยัง INSERT ได้ (จำลองใน tx, ROLLBACK):
--   BEGIN;
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<cust-uuid>","role":"authenticated"}';
--   SELECT count(*) FROM public.staff;            -- → 0 (deny)
--   SELECT count(*) FROM public.sales;            -- → 0 (deny)
--   SELECT count(*) FROM public.credit_payments;  -- → 0 (deny)
--   -- INSERT service_jobs (สั่งงาน) ต้องสำเร็จ (ครบ NOT NULL cols กัน 23502):
--   INSERT INTO public.service_jobs
--     (job_no, customer_name, customer_phone, job_type, sub_service, description,
--      customer_address, note, status, total_cost)
--   VALUES
--     ('SMOKE-505','smoke-505','0000000000','other','smoke','smoke test',
--      'smoke addr','smoke note','pending',0);
--   ROLLBACK;
--
-- (5d) staff ทุก role ต้องไม่ถูกบล็อก — login admin/sales/technician/accountant ในแอป
--      แล้ว smoke งานหลักแต่ละ role (technician อ่าน products/warehouse_stock,
--      accountant อ่าน accounting/operational, admin/sales ทำ POS/เอกสาร).
--
-- (5e) GROUP C — profiles self-scope (B3 #4): customer เห็นแค่ own row.
--   BEGIN;
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<cust-uuid>","role":"authenticated"}';
--   SELECT count(*) FROM public.profiles;            -- → 1 (own row เท่านั้น ไม่ใช่ทั้งร้าน)
--   SELECT count(*) FROM public.profiles_with_email; -- → 1
--   ROLLBACK;
--   🔴 customer login จริงในแอป → state.profile.role ต้อง = 'customer' (ไม่ fallback 'sales'
--      @main.js:1072) → ยืนยันว่า self-scope ปล่อยให้อ่าน own profile ได้ 100%.
--   staff/admin: หน้า loadUsers + HR เห็น profiles ครบเหมือนเดิม (NOT customer → ผ่านหมด).
-- ═══════════════════════════════════════════════════════════════════════
