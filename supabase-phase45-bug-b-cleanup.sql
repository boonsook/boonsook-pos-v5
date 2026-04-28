-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — Bug B: anon data-leak cleanup
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- Diagnostic พบ: anon (publishable key สาธารณะใน supabase-config.js)
-- อ่านข้อมูล sensitive ได้โดยไม่ต้อง login:
--   expenses, receipts, delivery_invoices, warehouse_stock,
--   loyalty_settings, stock_movements ฯลฯ
--
-- Root cause = นโยบายเก่าค้าง 80+ policies — หลายตัวใช้
-- "TO public USING (true)" หรือ "TO authenticated USING (true)"
-- ทับ Phase 45.10 RLS hardening ที่ตั้งไว้ดีแล้ว
--
-- กฎ PostgreSQL: หลาย policy = OR — ถ้า ANY policy เป็น true
-- → granted → policy ใหม่ของ 45.10 ที่เข้มงวดถูก bypass
--
-- ─────────────────────────────────────────────────────────
-- Strategy: DROP policies เก่าค้างทั้งหมด เก็บเฉพาะ:
--   1. Phase 45.10 hardened policies (ใช้ is_admin/is_staff/is_sales_or_admin)
--   2. Public flows ที่ตั้งใจ:
--      - store_settings.read_store_settings (landing page)
--      - quotations.public_read_by_share_token (share link)
--      - quotation_items.qi_select (share link เห็น line items)
--      - customer_otp anon insert/select (signup OTP)
--   3. current_role()-based policies (categories, customers, products, ...)
--      — ไม่ recursive แล้วหลัง Bug A fix (profiles ไม่ใช้ current_role อีก)
--
-- DROP ทั้งหมดของ:
--   - "TO public USING (true)" บน table sensitive
--   - "TO authenticated USING (true)" ที่ duplicate กับ 45.10 policies
--   - Supabase auto-generated เก่า ("Allow ...", duplicates)
--
-- Bonus: REVOKE table-level GRANT จาก anon บน table sensitive (defense in depth)
-- ─────────────────────────────────────────────────────────
--
-- ⚠️ Pre-flight check:
-- ก่อนรัน — verify ว่า Bug A fix ทำงานแล้ว (profiles SELECT ไม่ HTTP 500)
-- ถ้ายังไม่ได้รัน supabase-phase45-bug-fix-a-c.sql → รันอันนั้นก่อน
--
-- How to run:
--   1. Supabase SQL Editor → New query → paste ทั้งไฟล์ → Run
--   2. ตรวจ "Success. No rows returned"
--   3. ทดสอบใน app:
--      - Login ทุก role (admin, sales, technician, customer) → check ทุกหน้า
--      - ถ้าเจอ HTTP 403 → แจ้ง Claude ว่าหน้า/action ไหน
--   4. Verify จาก curl: anon ต้องอ่าน expenses/receipts/etc ไม่ได้แล้ว
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- 1) FINANCIAL TABLES — ลบ public policies เก่า
-- ═══════════════════════════════════════════════════════════

-- expenses (KEEP: expenses_admin)
DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;

-- receipts (KEEP: receipts_rw_staff)
DROP POLICY IF EXISTS "rc_select" ON public.receipts;
DROP POLICY IF EXISTS "rc_insert" ON public.receipts;
DROP POLICY IF EXISTS "rc_update" ON public.receipts;
DROP POLICY IF EXISTS "rc_delete" ON public.receipts;

-- receipt_items (KEEP: receipt_items_rw)
DROP POLICY IF EXISTS "ri_select" ON public.receipt_items;
DROP POLICY IF EXISTS "ri_insert" ON public.receipt_items;
DROP POLICY IF EXISTS "ri_update" ON public.receipt_items;
DROP POLICY IF EXISTS "ri_delete" ON public.receipt_items;

-- delivery_invoices (KEEP: delivery_invoices_rw)
DROP POLICY IF EXISTS "di_select" ON public.delivery_invoices;
DROP POLICY IF EXISTS "di_insert" ON public.delivery_invoices;
DROP POLICY IF EXISTS "di_update" ON public.delivery_invoices;
DROP POLICY IF EXISTS "di_delete" ON public.delivery_invoices;

-- delivery_invoice_items (KEEP: delivery_invoice_items_rw)
DROP POLICY IF EXISTS "dii_select" ON public.delivery_invoice_items;
DROP POLICY IF EXISTS "dii_insert" ON public.delivery_invoice_items;
DROP POLICY IF EXISTS "dii_update" ON public.delivery_invoice_items;
DROP POLICY IF EXISTS "dii_delete" ON public.delivery_invoice_items;


-- ═══════════════════════════════════════════════════════════
-- 2) STOCK TABLES — ลบ public policies เก่า
-- ═══════════════════════════════════════════════════════════

-- warehouse_stock (KEEP: warehouse_stock_rw)
DROP POLICY IF EXISTS "warehouse_stock_select" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_insert" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_update" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_delete" ON public.warehouse_stock;

-- warehouses (KEEP: warehouses_read, warehouses_write_admin, warehouses_update_admin, warehouses_delete_admin)
DROP POLICY IF EXISTS "warehouses_select" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_insert" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_update" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_delete" ON public.warehouses;

-- stock_movements (KEEP: stock_movements_rw)
DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_update" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_delete" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements insert" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements read" ON public.stock_movements;


-- ═══════════════════════════════════════════════════════════
-- 3) LOYALTY / SETTINGS / MISC — ลบ public policies เก่า
-- ═══════════════════════════════════════════════════════════

-- loyalty_settings (KEEP: loyalty_settings_write_admin + ADD read for authenticated)
DROP POLICY IF EXISTS "loyalty_settings_select" ON public.loyalty_settings;
DROP POLICY IF EXISTS "loyalty_settings_insert" ON public.loyalty_settings;
DROP POLICY IF EXISTS "loyalty_settings_update" ON public.loyalty_settings;
DROP POLICY IF EXISTS "loyalty_settings_delete" ON public.loyalty_settings;
DROP POLICY IF EXISTS "loyalty_settings_read" ON public.loyalty_settings;

CREATE POLICY "loyalty_settings_read_auth" ON public.loyalty_settings
  FOR SELECT TO authenticated USING (true);

-- loyalty_points (KEEP: loyalty_points_rw)
DROP POLICY IF EXISTS "loyalty_points_select" ON public.loyalty_points;
DROP POLICY IF EXISTS "loyalty_points_insert" ON public.loyalty_points;
DROP POLICY IF EXISTS "loyalty_points_update" ON public.loyalty_points;
DROP POLICY IF EXISTS "loyalty_points_delete" ON public.loyalty_points;

-- permissions (DROP เก่า + ADD ใหม่ที่เข้มงวด)
DROP POLICY IF EXISTS "permissions_select" ON public.permissions;
DROP POLICY IF EXISTS "permissions_insert" ON public.permissions;
DROP POLICY IF EXISTS "permissions_update" ON public.permissions;
DROP POLICY IF EXISTS "permissions_delete" ON public.permissions;

CREATE POLICY "permissions_read_auth" ON public.permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "permissions_write_admin" ON public.permissions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- line_notify_settings (DROP เก่า + ADD ใหม่)
DROP POLICY IF EXISTS "line_notify_settings_select" ON public.line_notify_settings;
DROP POLICY IF EXISTS "line_notify_settings_insert" ON public.line_notify_settings;
DROP POLICY IF EXISTS "line_notify_settings_update" ON public.line_notify_settings;
DROP POLICY IF EXISTS "line_notify_settings_delete" ON public.line_notify_settings;

CREATE POLICY "line_notify_settings_read_auth" ON public.line_notify_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "line_notify_settings_write_admin" ON public.line_notify_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ═══════════════════════════════════════════════════════════
-- 4) SALES / SERVICE_JOBS / TRANSACTIONS — ลบ duplicates + USING true
-- ═══════════════════════════════════════════════════════════

-- sales (KEEP: sales_select_all, sales_insert_all, sales_update_staff, sales_delete_staff)
DROP POLICY IF EXISTS "Allow authenticated update sales" ON public.sales;
DROP POLICY IF EXISTS "Allow update sales" ON public.sales;             -- DANGEROUS — TO public USING true
DROP POLICY IF EXISTS "sales insert authenticated" ON public.sales;
DROP POLICY IF EXISTS "sales read authenticated" ON public.sales;

-- sale_items (KEEP: sale_items_rw)
DROP POLICY IF EXISTS "sale items insert authenticated" ON public.sale_items;
DROP POLICY IF EXISTS "sale items read authenticated" ON public.sale_items;

-- service_jobs (เคลียร์ duplicate massive — KEEP Phase 45.10 quartet)
DROP POLICY IF EXISTS "Allow authenticated insert service_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "Allow authenticated update service_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service jobs insert authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service jobs read authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service jobs update authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs delete owner" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs insert authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs read authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs update authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_delete_authenticated" ON public.service_jobs;     -- USING true!
DROP POLICY IF EXISTS "service_jobs_insert_authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_select_authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_update_authenticated" ON public.service_jobs;


-- ═══════════════════════════════════════════════════════════
-- 5) CUSTOMERS / PRODUCTS — ลบ duplicates
-- ═══════════════════════════════════════════════════════════

-- customers (KEEP: customers_rw_staff, customers_self_insert)
DROP POLICY IF EXISTS "Allow authenticated insert customers" ON public.customers;
DROP POLICY IF EXISTS "customers insert authenticated" ON public.customers;
DROP POLICY IF EXISTS "customers read authenticated" ON public.customers;
DROP POLICY IF EXISTS "customers update authenticated" ON public.customers;
DROP POLICY IF EXISTS "customers delete owner" ON public.customers;
DROP POLICY IF EXISTS "customers_delete" ON public.customers;

-- products (KEEP: products_read_all, products_insert_staff, products_update_staff, products_delete_admin)
DROP POLICY IF EXISTS "Allow authenticated delete products" ON public.products;       -- USING true!
DROP POLICY IF EXISTS "products delete admin" ON public.products;
DROP POLICY IF EXISTS "products insert admin_sales" ON public.products;
DROP POLICY IF EXISTS "products read authenticated" ON public.products;
DROP POLICY IF EXISTS "products update admin_sales" ON public.products;


-- ═══════════════════════════════════════════════════════════
-- 6) QUOTATIONS — ลบ duplicates แต่เก็บ public share-token policy
-- ═══════════════════════════════════════════════════════════

-- quotations (KEEP: quotations_rw_staff + public_read_by_share_token)
DROP POLICY IF EXISTS "Allow delete quotations" ON public.quotations;                 -- USING true!
DROP POLICY IF EXISTS "Allow public read by share_token" ON public.quotations;        -- duplicate
DROP POLICY IF EXISTS "quotations delete owner" ON public.quotations;
DROP POLICY IF EXISTS "quotations insert authenticated" ON public.quotations;
DROP POLICY IF EXISTS "quotations read authenticated" ON public.quotations;
DROP POLICY IF EXISTS "quotations update authenticated" ON public.quotations;
-- KEEP: public_read_by_share_token (TO public USING share_token IS NOT NULL)

-- quotation_items (KEEP: quotation_items_rw + qi_select for share flow)
DROP POLICY IF EXISTS "Allow delete quotation_items" ON public.quotation_items;       -- USING true!
DROP POLICY IF EXISTS "Allow public read items" ON public.quotation_items;            -- duplicate
DROP POLICY IF EXISTS "public_read_quotation_items" ON public.quotation_items;        -- duplicate
DROP POLICY IF EXISTS "qi_delete" ON public.quotation_items;                          -- USING true!
DROP POLICY IF EXISTS "qi_insert" ON public.quotation_items;                          -- WITH CHECK true!
DROP POLICY IF EXISTS "qi_update" ON public.quotation_items;                          -- USING true!
-- KEEP: qi_select (TO public USING true) สำหรับ share-token flow


-- ═══════════════════════════════════════════════════════════
-- 7) STAFF / STORE_SETTINGS / CATEGORIES
-- ═══════════════════════════════════════════════════════════

-- staff (KEEP: staff_admin_only)
DROP POLICY IF EXISTS "staff_select" ON public.staff;
DROP POLICY IF EXISTS "staff_insert" ON public.staff;
DROP POLICY IF EXISTS "staff_update" ON public.staff;
DROP POLICY IF EXISTS "staff_delete" ON public.staff;

-- store_settings (KEEP: read_store_settings + ADD admin-only update)
DROP POLICY IF EXISTS "update_store_settings" ON public.store_settings;
CREATE POLICY "store_settings_update_admin" ON public.store_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "store_settings_insert_admin" ON public.store_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "store_settings_delete_admin" ON public.store_settings
  FOR DELETE TO authenticated USING (public.is_admin());

-- categories (KEEP: categories read authenticated, owner-based write)
DROP POLICY IF EXISTS "categories read" ON public.categories;  -- duplicate of "read authenticated"


-- ═══════════════════════════════════════════════════════════
-- 8) DEFENSE IN DEPTH — REVOKE table-level GRANTs จาก anon
--    บน tables ที่ไม่ควร anon access เลย
-- ═══════════════════════════════════════════════════════════

-- KEEP anon grants on:
--   profiles (signup), customers (signup),
--   customer_otp (OTP flow), store_settings (landing page),
--   quotations + quotation_items (share-token public read)

REVOKE ALL ON public.expenses                FROM anon;
REVOKE ALL ON public.recurring_expenses      FROM anon;
REVOKE ALL ON public.refunds                 FROM anon;
REVOKE ALL ON public.receipts                FROM anon;
REVOKE ALL ON public.receipt_items           FROM anon;
REVOKE ALL ON public.delivery_invoices       FROM anon;
REVOKE ALL ON public.delivery_invoice_items  FROM anon;
REVOKE ALL ON public.sales                   FROM anon;
REVOKE ALL ON public.sale_items              FROM anon;
REVOKE ALL ON public.warehouse_stock         FROM anon;
REVOKE ALL ON public.warehouses              FROM anon;
REVOKE ALL ON public.stock_movements         FROM anon;
REVOKE ALL ON public.products                FROM anon;
REVOKE ALL ON public.product_serials         FROM anon;
REVOKE ALL ON public.product_bundles         FROM anon;
REVOKE ALL ON public.loyalty_points          FROM anon;
REVOKE ALL ON public.loyalty_settings        FROM anon;
REVOKE ALL ON public.staff                   FROM anon;
REVOKE ALL ON public.staff_sessions          FROM anon;
REVOKE ALL ON public.tasks                   FROM anon;
REVOKE ALL ON public.app_settings            FROM anon;
REVOKE ALL ON public.audit_log               FROM anon;
REVOKE ALL ON public.permissions             FROM anon;
REVOKE ALL ON public.line_notify_settings    FROM anon;
REVOKE ALL ON public.quote_templates         FROM anon;
REVOKE ALL ON public.credit_payments         FROM anon;
REVOKE ALL ON public.service_jobs            FROM anon;
REVOKE ALL ON public.categories              FROM anon;


-- ═══════════════════════════════════════════════════════════
-- Verify after run — list policies remaining
-- ═══════════════════════════════════════════════════════════

SELECT
  tablename,
  COUNT(*) AS policy_count,
  string_agg(policyname, ', ' ORDER BY policyname) AS remaining_policies
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
