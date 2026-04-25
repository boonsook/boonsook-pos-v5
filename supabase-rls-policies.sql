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

-- ───────── warehouses + warehouse_stock ─────────
-- (ถ้ายังไม่ได้เปิด RLS / ยังไม่มี policy — UPDATE จะถูก block เงียบๆ)
ALTER TABLE IF EXISTS public.warehouses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.warehouse_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_warehouses" ON public.warehouses;
CREATE POLICY "auth_all_warehouses"
  ON public.warehouses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_warehouse_stock" ON public.warehouse_stock;
CREATE POLICY "auth_all_warehouse_stock"
  ON public.warehouse_stock
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- 2.5) เพิ่มคอลัมน์ใหม่ในตาราง products (ถ้ายังไม่มี)
--      สำหรับฟีเจอร์: ราคาส่ง + รูปสินค้า + featured + promo
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS price_wholesale NUMERIC,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_price NUMERIC,
  ADD COLUMN IF NOT EXISTS promo_start DATE,
  ADD COLUMN IF NOT EXISTS promo_end DATE;

-- ★ ผูกการขายกับลูกค้า (สำหรับ POS Customer Picker)
ALTER TABLE IF EXISTS public.sales
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON public.sales(customer_id);

-- ★ รูปก่อน-หลังสำหรับงานช่าง
ALTER TABLE IF EXISTS public.service_jobs
  ADD COLUMN IF NOT EXISTS photo_before TEXT,
  ADD COLUMN IF NOT EXISTS photo_after  TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 2.7) Trigger + Backfill: Auto-create profiles row จาก auth.users
--      แก้ปัญหา user สร้างใน Supabase Dashboard แต่ไม่โผล่ในหน้าแอป
-- ═══════════════════════════════════════════════════════════════

-- Function: handle_new_user (สร้าง profile row อัตโนมัติเมื่อ auth.users มี row ใหม่)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, created_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    'sales',
    COALESCE(new.created_at, now())
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Trigger: รัน handle_new_user หลังมี user ใหม่ใน auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ★ Backfill (one-time): สร้าง profiles row ให้ user เก่าที่ขาด
-- (รันได้บ่อยเพราะ ON CONFLICT DO NOTHING)
INSERT INTO public.profiles (id, full_name, role, created_at)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', '') AS full_name,
  'sales' AS role,
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- 2.6) Storage Bucket สำหรับรูปสินค้า (product-images)
--      ★ หมายเหตุ: ต้องสร้าง bucket ผ่าน Supabase Dashboard ก่อน
--         Dashboard → Storage → "+ New bucket" → Name: "product-images"
--         → Public: ON → Save
--      หลังสร้าง bucket แล้ว policy ด้านล่างจะอนุญาตให้ upload/read ได้
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Drop existing policies (idempotent)
  DROP POLICY IF EXISTS "auth_upload_product_images" ON storage.objects;
  DROP POLICY IF EXISTS "public_read_product_images"  ON storage.objects;
  DROP POLICY IF EXISTS "auth_delete_product_images"  ON storage.objects;

  -- Allow authenticated users to upload to product-images bucket
  CREATE POLICY "auth_upload_product_images"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'product-images');

  -- Allow public read (so images show without auth — for AI sales / catalog)
  CREATE POLICY "public_read_product_images"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'product-images');

  -- Allow authenticated to delete their uploads
  CREATE POLICY "auth_delete_product_images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'product-images');
EXCEPTION WHEN undefined_table THEN
  -- storage.objects might not exist on older Supabase — skip silently
  NULL;
END $$;


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
