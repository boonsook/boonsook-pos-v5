-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 574 — ac_catalog_doc: แคตตาล็อกแอร์ sync ทุกเครื่อง (รวมหน้าลูกค้า)
-- ═══════════════════════════════════════════════════════════════════════════
-- ปัญหา:
--   (1) แคตตาล็อกแอร์เป็น localStorage ต่อเครื่อง → desktop/มือถือ staff ไม่ตรงกัน.
--   (2) หน้าร้านลูกค้าอ่านจากไฟล์ static (data/ac_catalog.json) → ราคาที่ owner แก้
--       ลูกค้า "ไม่เคยเห็น" (บั๊ก product จริงตั้งแต่ Phase 347).
-- แก้: single-row jsonb doc — ทุก role ที่ login "อ่านได้" (ราคาโชว์ลูกค้าโดยดีไซน์);
--       "เขียนได้เฉพาะ non-customer" (reuse is_customer_role() ของ Phase 505).
--       localStorage เหลือเป็น cache → customer_dashboard ไม่ต้องแก้.
--
-- ★ เจตนา: ห้ามใช้ app_settings (GROUP A ของ Phase 505 = customer deny — ลูกค้าอ่านไม่ได้).
-- ★ ไม่มี DELETE policy โดยตั้งใจ = ลบแถวไม่ได้เลย (ล้างแคตตาล็อก = UPDATE value=[]).
--
-- 🔴 owner รันไฟล์นี้ใน Supabase SQL editor "ก่อน merge" (code degrade-safe: ตารางไม่มี
--    → fetch fail เงียบ → พฤติกรรมเดิม localStorage-only).
-- Prereq: is_customer_role() ต้องมีอยู่แล้ว (Phase 505 applied — verify ด้วย query ท้ายไฟล์).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) ตาราง single-row (id ล็อกเป็น 1 เสมอ)
CREATE TABLE IF NOT EXISTS public.ac_catalog_doc (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2) updated_at = server-truth ทุก UPDATE (default now() ครอบเฉพาะ INSERT)
CREATE OR REPLACE FUNCTION public.ac_catalog_doc_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ac_catalog_doc_touch ON public.ac_catalog_doc;
CREATE TRIGGER trg_ac_catalog_doc_touch
  BEFORE UPDATE ON public.ac_catalog_doc
  FOR EACH ROW EXECUTE FUNCTION public.ac_catalog_doc_touch();

-- 3) RLS
ALTER TABLE public.ac_catalog_doc ENABLE ROW LEVEL SECURITY;

-- อ่าน: ทุก authenticated (รวมลูกค้า — ราคาโชว์ลูกค้าโดยดีไซน์)
DROP POLICY IF EXISTS ac_catalog_doc_select ON public.ac_catalog_doc;
CREATE POLICY ac_catalog_doc_select ON public.ac_catalog_doc
  FOR SELECT TO authenticated
  USING (true);

-- เขียนใหม่: เฉพาะ non-customer
DROP POLICY IF EXISTS ac_catalog_doc_insert ON public.ac_catalog_doc;
CREATE POLICY ac_catalog_doc_insert ON public.ac_catalog_doc
  FOR INSERT TO authenticated
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false));

-- แก้ไข: เฉพาะ non-customer (USING = ใครแก้แถวได้, WITH CHECK = ค่าใหม่ผ่านไหม)
DROP POLICY IF EXISTS ac_catalog_doc_update ON public.ac_catalog_doc;
CREATE POLICY ac_catalog_doc_update ON public.ac_catalog_doc
  FOR UPDATE TO authenticated
  USING (NOT COALESCE(public.is_customer_role(), false))
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false));

-- (ไม่มี DELETE policy = ไม่มีใครลบแถวได้ — ปลอดภัยสุด; ล้างแคตตาล็อก = UPDATE value=[])

-- 4) reload schema cache (PostgREST)
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (รันแล้วดูผลด้วยตา — ควรได้ตามคอมเมนต์)
-- ═══════════════════════════════════════════════════════════════════════════
-- (a) prereq helper มีจริง (คาดหวัง 1 แถว)
--   SELECT proname FROM pg_proc WHERE proname = 'is_customer_role';
--
-- (b) ตาราง + RLS เปิด (คาดหวัง relrowsecurity = true)
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'ac_catalog_doc';
--
-- (c) policy ครบ 3 ตัว (select/insert/update — ไม่มี delete)
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ac_catalog_doc' ORDER BY cmd;
--   -- คาดหวัง: SELECT / INSERT / UPDATE (3 แถว, ไม่มี DELETE)
--
-- (d) trigger touch มีจริง
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.ac_catalog_doc'::regclass AND NOT tgisinternal;
-- ═══════════════════════════════════════════════════════════════════════════
