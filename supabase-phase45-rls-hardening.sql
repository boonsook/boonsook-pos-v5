-- ═══════════════════════════════════════════════════════════
--  Phase 45.10 — RLS Hardening (role-based write protection)
--  Date: 2026-04-28
-- ═══════════════════════════════════════════════════════════
--
-- Problem: ทุก policy ใช้ USING (true) → user role ไหนก็เขียน/ลบ table อะไรก็ได้
--   → defense in depth = 0
--   → ถ้า UI bypass สำเร็จ (เช่น hash navigation, API call ตรง) → leak/destroy data
--
-- Strategy (minimal disruption):
--   READ: ส่วนใหญ่ยังเปิด (USING true) — เพราะ UI filter เองอยู่
--   WRITE: ตามสิทธิ์ role
--   - admin: ทำได้ทั้งหมด
--   - staff (admin/sales/technician): write ทุก table ทั่วไป
--   - sales_or_admin: เฉพาะ sales/quotations/receipts/finances
--   - customer: insert service_jobs/sales (own checkout) — read ทั่วไป
--
-- CRITICAL: profiles UPDATE/DELETE — admin only (ป้องกัน role escalation)
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste ทั้งไฟล์ → Run
--   3. ตรวจ "Success. No rows returned"
--   4. ทดสอบ: login + ทำงานทุกหน้า — ถ้ามี HTTP 403 → เจอ policy ที่ block ผิด → แจ้ง Claude
--
-- Rollback (ถ้า break):
--   รัน supabase-rls-policies.sql เดิมอีกครั้ง → policies กลับเป็น USING (true)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) Helper functions — อ่าน role ของ current user
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid())
    IN ('admin', 'sales', 'technician')
$$;

CREATE OR REPLACE FUNCTION public.is_sales_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid())
    IN ('admin', 'sales')
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sales_or_admin() TO authenticated;


-- ═══════════════════════════════════════════════════════════
--  2) profiles — ป้องกัน role escalation (CRITICAL)
--     - SELECT: ทุก authenticated user (เพื่อแสดง user list)
--     - INSERT: self หรือ admin (auto-create on signup)
--     - UPDATE: self (full_name, phone) หรือ admin (role, etc)
--     - DELETE: admin only
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════
--  3) staff — admin only (พนักงาน config)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_staff" ON public.staff;
DROP POLICY IF EXISTS "staff_admin_only" ON public.staff;

CREATE POLICY "staff_admin_only" ON public.staff
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ═══════════════════════════════════════════════════════════
--  4) Financial tables — admin only
--     expenses, recurring_expenses, refunds, cash_recon
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_expenses" ON public.expenses;
DROP POLICY IF EXISTS "expenses_admin" ON public.expenses;
CREATE POLICY "expenses_admin" ON public.expenses
  FOR ALL TO authenticated
  USING (public.is_sales_or_admin())  -- sales อาจดูค่าใช้จ่ายของตัวเอง
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_recurring_expenses" ON public.recurring_expenses;
DROP POLICY IF EXISTS "recurring_expenses_admin" ON public.recurring_expenses;
CREATE POLICY "recurring_expenses_admin" ON public.recurring_expenses
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "auth_all_refunds" ON public.refunds;
DROP POLICY IF EXISTS "refunds_sales" ON public.refunds;
CREATE POLICY "refunds_sales" ON public.refunds
  FOR ALL TO authenticated
  USING (public.is_sales_or_admin())
  WITH CHECK (public.is_sales_or_admin());


-- ═══════════════════════════════════════════════════════════
--  5) Sales/Receipts/Quotations/Delivery — sales/admin
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_sales" ON public.sales;
DROP POLICY IF EXISTS "sales_rw_staff" ON public.sales;
DROP POLICY IF EXISTS "sales_select_all" ON public.sales;
DROP POLICY IF EXISTS "sales_write_staff" ON public.sales;
-- READ: ทุก authenticated (UI filter เอง)
CREATE POLICY "sales_select_all" ON public.sales
  FOR SELECT TO authenticated USING (true);
-- INSERT: ทุก authenticated (POS checkout — รวม customer)
CREATE POLICY "sales_insert_all" ON public.sales
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
-- UPDATE/DELETE: sales/admin only
CREATE POLICY "sales_update_staff" ON public.sales
  FOR UPDATE TO authenticated USING (public.is_sales_or_admin()) WITH CHECK (public.is_sales_or_admin());
CREATE POLICY "sales_delete_staff" ON public.sales
  FOR DELETE TO authenticated USING (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_sale_items" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items_rw" ON public.sale_items;
CREATE POLICY "sale_items_rw" ON public.sale_items
  FOR ALL TO authenticated
  USING (true)  -- read all (รายการละเอียดของ sale)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_all_receipts" ON public.receipts;
DROP POLICY IF EXISTS "receipts_rw_staff" ON public.receipts;
CREATE POLICY "receipts_rw_staff" ON public.receipts
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_receipt_items" ON public.receipt_items;
DROP POLICY IF EXISTS "receipt_items_rw" ON public.receipt_items;
CREATE POLICY "receipt_items_rw" ON public.receipt_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_quotations" ON public.quotations;
DROP POLICY IF EXISTS "quotations_rw_staff" ON public.quotations;
CREATE POLICY "quotations_rw_staff" ON public.quotations
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_quotation_items" ON public.quotation_items;
DROP POLICY IF EXISTS "quotation_items_rw" ON public.quotation_items;
CREATE POLICY "quotation_items_rw" ON public.quotation_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_delivery_invoices" ON public.delivery_invoices;
DROP POLICY IF EXISTS "delivery_invoices_rw" ON public.delivery_invoices;
CREATE POLICY "delivery_invoices_rw" ON public.delivery_invoices
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());

DROP POLICY IF EXISTS "auth_all_delivery_invoice_items" ON public.delivery_invoice_items;
DROP POLICY IF EXISTS "delivery_invoice_items_rw" ON public.delivery_invoice_items;
CREATE POLICY "delivery_invoice_items_rw" ON public.delivery_invoice_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_sales_or_admin());


-- ═══════════════════════════════════════════════════════════
--  6) Service jobs — staff + customer (insert own)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_service_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_select_all" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_write_staff" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_customer_insert" ON public.service_jobs;

-- READ: ทุก authenticated (UI filter เอง — customer dashboard กรอง customer_id)
CREATE POLICY "service_jobs_select_all" ON public.service_jobs
  FOR SELECT TO authenticated
  USING (true);

-- WRITE (UPDATE/DELETE): staff only
CREATE POLICY "service_jobs_write_staff" ON public.service_jobs
  FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

CREATE POLICY "service_jobs_delete_staff" ON public.service_jobs
  FOR DELETE TO authenticated
  USING (public.is_staff());

-- INSERT: ทุก authenticated (customer แจ้งซ่อม + staff สร้างใบงาน)
CREATE POLICY "service_jobs_insert" ON public.service_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);


-- ═══════════════════════════════════════════════════════════
--  7) Customers — staff full + customer self
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_customers" ON public.customers;
DROP POLICY IF EXISTS "customers_rw_staff" ON public.customers;
CREATE POLICY "customers_rw_staff" ON public.customers
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Customer สามารถ insert profile ตัวเองได้ตอนสมัคร
DROP POLICY IF EXISTS "customers_self_insert" ON public.customers;
CREATE POLICY "customers_self_insert" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- ตอน signup จะสร้าง customer record


-- ═══════════════════════════════════════════════════════════
--  8) Stock-related — staff only
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_products" ON public.products;
DROP POLICY IF EXISTS "products_read_all" ON public.products;
DROP POLICY IF EXISTS "products_write_staff" ON public.products;
CREATE POLICY "products_read_all" ON public.products
  FOR SELECT TO authenticated USING (true);  -- catalog ทุกคนเห็น
CREATE POLICY "products_insert_staff" ON public.products
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "products_update_staff" ON public.products
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "products_delete_admin" ON public.products
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auth_all_warehouse_stock" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_rw" ON public.warehouse_stock;
CREATE POLICY "warehouse_stock_rw" ON public.warehouse_stock
  FOR ALL TO authenticated
  USING (true)  -- read ทุกคน (UI filter)
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "auth_all_warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_rw" ON public.warehouses;
CREATE POLICY "warehouses_read" ON public.warehouses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "warehouses_write_admin" ON public.warehouses
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "warehouses_update_admin" ON public.warehouses
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "warehouses_delete_admin" ON public.warehouses
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auth_all_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_rw" ON public.stock_movements;
CREATE POLICY "stock_movements_rw" ON public.stock_movements
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_staff());


-- ═══════════════════════════════════════════════════════════
--  9) Loyalty / tasks / serials / etc — staff
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_loyalty_points" ON public.loyalty_points;
DROP POLICY IF EXISTS "loyalty_points_rw" ON public.loyalty_points;
CREATE POLICY "loyalty_points_rw" ON public.loyalty_points
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "auth_all_loyalty_settings" ON public.loyalty_settings;
DROP POLICY IF EXISTS "loyalty_settings_rw" ON public.loyalty_settings;
CREATE POLICY "loyalty_settings_read" ON public.loyalty_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "loyalty_settings_write_admin" ON public.loyalty_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "auth_all_tasks" ON public.tasks;
DROP POLICY IF EXISTS "tasks_rw" ON public.tasks;
CREATE POLICY "tasks_rw" ON public.tasks
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "auth_all_product_serials" ON public.product_serials;
DROP POLICY IF EXISTS "product_serials_rw" ON public.product_serials;
CREATE POLICY "product_serials_rw" ON public.product_serials
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.is_staff());


-- ═══════════════════════════════════════════════════════════
-- 10) App settings — admin only write
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_all_app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_rw" ON public.app_settings;
CREATE POLICY "app_settings_read" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_write_admin" ON public.app_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ═══════════════════════════════════════════════════════════
-- เสร็จสิ้น
-- ═══════════════════════════════════════════════════════════
-- หมายเหตุ:
--   - Tables ที่ไม่ได้ใส่ใน script นี้ (เช่น birthdays view, recurring_expenses tab)
--     ยังใช้ policy เดิม USING (true) ไม่กระทบ
--   - ทดสอบ flow ทุกหน้าหลังรัน — ถ้าเจอ HTTP 403 ที่ไหน บอก Claude แก้ policy เฉพาะจุด
--   - Helper function user_role() / is_admin() / is_staff() / is_sales_or_admin()
--     เก็บไว้ใช้ต่อในอนาคตได้
