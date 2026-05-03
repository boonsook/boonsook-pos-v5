-- ═══════════════════════════════════════════════════════════
--  Phase 68 — Tag system extend (products + service_jobs)
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- ลูกค้ามี tags (jsonb) อยู่แล้วตั้งแต่ Phase 11 — ขยายไปสินค้า + งานช่าง
-- ใช้ jsonb (array of strings) — ไม่ต้องสร้าง junction table
-- + GIN index → ค้นหาเร็ว เช่น tags @> '["VIP"]'

-- ───── 1) products.tags ─────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_products_tags
  ON public.products USING GIN (tags);

-- ───── 2) service_jobs.tags ─────
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_service_jobs_tags
  ON public.service_jobs USING GIN (tags);

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT id, name, tags FROM products WHERE jsonb_array_length(tags) > 0 LIMIT 10;
-- SELECT id, customer_name, tags FROM service_jobs WHERE jsonb_array_length(tags) > 0 LIMIT 10;
