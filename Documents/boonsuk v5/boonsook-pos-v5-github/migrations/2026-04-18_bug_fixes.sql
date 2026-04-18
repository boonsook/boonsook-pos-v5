-- ═══════════════════════════════════════════════════════════
--  BOONSOOK POS V5 — BUG FIXES MIGRATION
--  Created: 2026-04-18
--  Author:  Claude (AI Assistant)
--
--  RUN THIS SCRIPT ในหน้า Supabase Dashboard → SQL Editor
--  (เลือก project rwmmjljelpcpwohwiplu → SQL Editor → New query → paste → Run)
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- [1] FIX BUG-005 : service_jobs ไม่สามารถ INSERT ได้ (RLS blocked)
--     สร้าง INSERT policy ให้ authenticated users สามารถสั่งออเดอร์ได้
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;

-- DROP policy เก่า (ถ้ามี) เพื่อให้ idempotent
DROP POLICY IF EXISTS "service_jobs_insert_authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_select_authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_update_authenticated" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_delete_authenticated" ON public.service_jobs;

-- INSERT: authenticated สร้างออเดอร์ได้
CREATE POLICY "service_jobs_insert_authenticated"
  ON public.service_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- SELECT: ทุกคนที่ล็อกอินอ่านได้
CREATE POLICY "service_jobs_select_authenticated"
  ON public.service_jobs
  FOR SELECT
  TO authenticated
  USING (true);

-- UPDATE: staff/admin อัปเดตสถานะได้ (soft-delete อาศัย UPDATE นี้)
CREATE POLICY "service_jobs_update_authenticated"
  ON public.service_jobs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: อนุญาต (แต่ใน UI ใช้ soft-delete แทน)
CREATE POLICY "service_jobs_delete_authenticated"
  ON public.service_jobs
  FOR DELETE
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- [2] ADD COLUMN : sale_items.product_id + sale_items.unit_cost
--     เพื่อให้ Profit Report คำนวณต้นทุนได้แม่นยำ
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS product_id bigint
    REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) DEFAULT 0;

-- Index เพื่อ join ได้เร็วขึ้น
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id
  ON public.sale_items(product_id);

-- ─────────────────────────────────────────────────────────────
-- [3] BACKFILL : sale_items ที่มีอยู่เดิม → populate product_id/unit_cost
--     ใช้ product_name match กับ products.name (best-effort)
-- ─────────────────────────────────────────────────────────────
UPDATE public.sale_items si
SET
  product_id = p.id,
  unit_cost  = COALESCE(p.cost, 0)
FROM public.products p
WHERE si.product_id IS NULL
  AND si.product_name IS NOT NULL
  AND si.product_name = p.name;

-- ─────────────────────────────────────────────────────────────
-- [4] CUSTOMER portal : RLS สำหรับ customer_dashboard
--     ลูกค้าสามารถดูออเดอร์ของตนเองเท่านั้น
--     (optional — เปิดเมื่อพร้อมใช้งาน multi-tenant)
-- ─────────────────────────────────────────────────────────────
-- (comment ไว้ก่อน — ปล่อยให้ใช้ policy เดิมที่ authenticated เห็นทั้งหมด)
-- CREATE POLICY "service_jobs_select_own"
--   ON public.service_jobs FOR SELECT
--   TO authenticated
--   USING (customer_phone = auth.jwt()->>'phone' OR auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────
-- [5] VERIFY
-- ─────────────────────────────────────────────────────────────
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'service_jobs';
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'sale_items' AND column_name IN ('product_id', 'unit_cost');
