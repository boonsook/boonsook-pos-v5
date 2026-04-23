-- ═══════════════════════════════════════════════════════════════
-- Boonsook POS V5 — Supabase RLS Policies Setup
-- ═══════════════════════════════════════════════════════════════
-- วิธีใช้:
--   1. เปิด Supabase Dashboard → SQL Editor
--   2. กด "+ New query"
--   3. Copy ไฟล์นี้ทั้งหมดไปวาง
--   4. กด RUN (Ctrl+Enter)
--   5. ถ้าสำเร็จจะเห็น "Success. No rows returned"
--
-- ปลอดภัย: script นี้ idempotent — รันซ้ำได้ (DROP IF EXISTS ก่อน CREATE)
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 1) เปิด RLS ทุกตารางหลัก (ถ้ายังไม่เปิด)
-- ═══════════════════════════════════════════════════════════════
-- ★ app_settings table — เก็บการตั้งค่าที่ sync ข้าม device (store info, payment info)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE IF EXISTS public.app_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sales              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sale_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.service_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipt_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quotations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quotation_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_invoices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_movements    ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════
-- 2) Policies สำหรับ authenticated users (staff/admin ที่ login แล้ว)
--    ครอบคลุม: SELECT / INSERT / UPDATE / DELETE
-- ═══════════════════════════════════════════════════════════════

-- ───────── app_settings (sync store info + payment info ข้าม device) ─────────
DROP POLICY IF EXISTS "auth_all_app_settings"  ON public.app_settings;
CREATE POLICY "auth_all_app_settings"
  ON public.app_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── profiles (สำหรับหน้าตั้งค่าผู้ใช้ — admin ต้องอ่านรายชื่อได้) ─────────
DROP POLICY IF EXISTS "auth_all_profiles"       ON public.profiles;
CREATE POLICY "auth_all_profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ★ VIEW profiles_with_email — รวม email จาก auth.users เพื่อให้ UI แสดง email ได้
--    (auth.users เข้าถึงตรงจาก anon/authenticated ไม่ได้ — ต้องผ่าน view + GRANT)
CREATE OR REPLACE VIEW public.profiles_with_email
WITH (security_invoker = on)  -- ใช้สิทธิ์ของผู้เรียก (ไม่ข้าม RLS ของ profiles)
AS
SELECT p.id, p.full_name, p.role, p.phone, p.created_at, u.email
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id;
GRANT SELECT ON public.profiles_with_email TO authenticated;

-- ───────── sales ─────────
DROP POLICY IF EXISTS "auth_all_sales"         ON public.sales;
CREATE POLICY "auth_all_sales"
  ON public.sales
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── sale_items ─────────
DROP POLICY IF EXISTS "auth_all_sale_items"    ON public.sale_items;
CREATE POLICY "auth_all_sale_items"
  ON public.sale_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── service_jobs ─────────
DROP POLICY IF EXISTS "auth_all_service_jobs"  ON public.service_jobs;
CREATE POLICY "auth_all_service_jobs"
  ON public.service_jobs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── receipts ─────────
DROP POLICY IF EXISTS "auth_all_receipts"      ON public.receipts;
CREATE POLICY "auth_all_receipts"
  ON public.receipts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── receipt_items ─────────
DROP POLICY IF EXISTS "auth_all_receipt_items" ON public.receipt_items;
CREATE POLICY "auth_all_receipt_items"
  ON public.receipt_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── quotations ─────────
DROP POLICY IF EXISTS "auth_all_quotations"    ON public.quotations;
CREATE POLICY "auth_all_quotations"
  ON public.quotations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── quotation_items ─────────
DROP POLICY IF EXISTS "auth_all_quotation_items" ON public.quotation_items;
CREATE POLICY "auth_all_quotation_items"
  ON public.quotation_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── delivery_invoices ─────────
DROP POLICY IF EXISTS "auth_all_delivery_invoices" ON public.delivery_invoices;
CREATE POLICY "auth_all_delivery_invoices"
  ON public.delivery_invoices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── delivery_invoice_items ─────────
DROP POLICY IF EXISTS "auth_all_delivery_invoice_items" ON public.delivery_invoice_items;
CREATE POLICY "auth_all_delivery_invoice_items"
  ON public.delivery_invoice_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── customers ─────────
DROP POLICY IF EXISTS "auth_all_customers"     ON public.customers;
CREATE POLICY "auth_all_customers"
  ON public.customers
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── products ─────────
DROP POLICY IF EXISTS "auth_all_products"      ON public.products;
CREATE POLICY "auth_all_products"
  ON public.products
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── expenses ─────────
DROP POLICY IF EXISTS "auth_all_expenses"      ON public.expenses;
CREATE POLICY "auth_all_expenses"
  ON public.expenses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── staff ─────────
DROP POLICY IF EXISTS "auth_all_staff"         ON public.staff;
CREATE POLICY "auth_all_staff"
  ON public.staff
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────── stock_movements ─────────
DROP POLICY IF EXISTS "auth_all_stock_movements" ON public.stock_movements;
CREATE POLICY "auth_all_stock_movements"
  ON public.stock_movements
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- 3) Policies สำหรับ customer (OTP login) — ลูกค้าสั่งซื้อผ่านเว็บ
--    ลูกค้า login ผ่าน Supabase Auth ด้วย OTP → role = 'authenticated'
--    ควรสร้างออเดอร์ได้เอง + ดูออเดอร์ตัวเอง
-- ═══════════════════════════════════════════════════════════════

-- ลูกค้าสามารถ INSERT service_jobs (สั่งซื้อใหม่) ได้
-- (อยู่ใน auth_all_service_jobs ข้างบนแล้ว — ครอบคลุม)


-- ═══════════════════════════════════════════════════════════════
-- 4) ตรวจสอบผล (optional — เอาเครื่องหมาย -- ออกเพื่อเช็ค)
-- ═══════════════════════════════════════════════════════════════
-- SELECT schemaname, tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;


-- ═══════════════════════════════════════════════════════════════
-- เสร็จสิ้น
-- ═══════════════════════════════════════════════════════════════
-- หลังรัน:
--   1. ไปที่แอป → Hard refresh (Ctrl+Shift+R)
--   2. ทดสอบลบ sales / service_jobs / receipts / quotations / customers
--   3. ทุกปุ่มควรทำงานได้แล้ว ไม่มี timeout 15s อีก
--
-- ถ้าต้องการ secure กว่านี้ในอนาคต (เช่น จำกัด role)
-- เปลี่ยน USING (true) เป็น:
--   USING ( auth.jwt() ->> 'role' IN ('admin','staff') )
-- ═══════════════════════════════════════════════════════════════
