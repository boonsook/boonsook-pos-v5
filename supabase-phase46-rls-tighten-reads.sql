-- ═══════════════════════════════════════════════════════════
--  Phase 46.6 — Tighten READ policies (stock + tasks)
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- Why:
--   Phase 45.10 RLS hardening เน้น WRITE protection — เปิด READ ไว้
--   USING(true) สำหรับหลายๆ table เพื่อไม่ break flow.
--   Phase 45.15 ตัด customers/receipts/stock_count ออกจาก technician
--   sidebar — แต่ technician/customer ยังเรียก API ตรงเพื่อ READ
--   ตารางที่ไม่ได้ใช้ในงานของตัวเองได้
--
--   ตอนนี้ใช้กับ tables ที่ "customer role ไม่ต้องเห็นแน่ๆ":
--   - stock_movements (ประวัติเคลื่อนไหวสต็อก — internal)
--   - warehouses, warehouse_stock (คลัง — internal)
--   - tasks (Task list สำหรับพนักงาน)
--
-- NOT touched (เพราะ customer dashboard ใช้):
--   - sales, sale_items (ลูกค้าดูประวัติซื้อตัวเอง)
--   - receipts, receipt_items (ลูกค้าดูใบเสร็จตัวเอง)
--   - service_jobs (ลูกค้าดูคิวงานตัวเอง)
--   - products (catalog)
--   - customers (own data — RLS hard เพราะไม่มี auth_user_id link)
--   - loyalty_points (ลูกค้าดูแต้มตัวเอง)
--   - profiles (display name)
--
-- How to run:
--   1. Supabase SQL Editor → New query
--   2. Paste ทั้งไฟล์ → Run
--   3. ตรวจ "Success. No rows returned"
--   4. ทดสอบ login เป็นแต่ละ role:
--      - admin/sales/technician: เปิดหน้าคลัง / stock_movements ได้ปกติ
--      - customer: ใช้ customer_dashboard ได้ปกติ (ไม่กระทบ)
--   5. ถ้าเจอ HTTP 403 ที่ไหน บอก Claude
-- ═══════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
--  1) stock_movements — staff only (ไม่มีเหตุผลที่ customer ต้องดู)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "stock_movements_rw" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_write" ON public.stock_movements;

CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "stock_movements_write" ON public.stock_movements
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ═══════════════════════════════════════════════════════════
--  2) warehouses + warehouse_stock — staff only
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "warehouses_read" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_write_admin" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_update_admin" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_delete_admin" ON public.warehouses;

CREATE POLICY "warehouses_select" ON public.warehouses
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "warehouses_insert_admin" ON public.warehouses
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "warehouses_update_admin" ON public.warehouses
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "warehouses_delete_admin" ON public.warehouses
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "warehouse_stock_rw" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_select" ON public.warehouse_stock;
DROP POLICY IF EXISTS "warehouse_stock_write" ON public.warehouse_stock;

CREATE POLICY "warehouse_stock_select" ON public.warehouse_stock
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "warehouse_stock_write" ON public.warehouse_stock
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ═══════════════════════════════════════════════════════════
--  3) tasks — staff only (Task list ภายในร้าน)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tasks_rw" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_write" ON public.tasks;

CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "tasks_write" ON public.tasks
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ═══════════════════════════════════════════════════════════
-- เสร็จสิ้น
-- ═══════════════════════════════════════════════════════════
-- หมายเหตุ:
--   - หลังรัน — ทดสอบทุก role:
--     • admin/sales: คลัง / stock_movements / tasks ทำงานปกติ
--     • technician: คลัง (ดูสต็อกในรถ) ทำงานปกติ
--     • customer: customer_dashboard ทำงานปกติ (ไม่ใช้ stock/warehouse/tasks)
--   - ถ้าเจอ HTTP 403 ที่ไหน → policy นี้ block ผิด → แจ้ง Claude
--   - Rollback: รัน supabase-rls-policies.sql เดิมเพื่อ reset เป็น USING(true)
