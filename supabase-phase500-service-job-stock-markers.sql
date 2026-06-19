-- ════════════════════════════════════════════════════════════════════════
-- Phase 500 — service_jobs.stock_deducted_at / stock_reverted_at : atomic claim (audit #C-2)
-- (MONEY/STOCK §4.2 idempotency · severity HIGH · sibling ของ #C / Phase 499)
-- ════════════════════════════════════════════════════════════════════════
--
-- ปัญหา (audit #C-2):
--   ตัด/คืนสต็อกอุปกรณ์งานช่าง (deductServiceJobStock / restoreServiceJobStock) gate กันซ้ำเดิม
--   อ่าน `job.note` จาก **memory** (ไม่ fetch สด ไม่ fail-closed) แล้วเขียน marker แยกใน caller ทีหลัง
--   = TOCTOU เดียวกับ #C (POS revert) → ปิด/ลบ/ยกเลิกงานเดียวกันพร้อมกัน 2 เครื่อง/2 tab หรือ state ค้าง
--   → ตัด/คืนสต็อกซ้ำ (oversell / สต็อกพอง).
--
-- วิธีแก้ (mirror Phase 499): ย้าย atomic claim เข้าไปใน 2 helper เอง — conditional PATCH ที่ DB
--   deduct  : PATCH service_jobs?id=eq.X&stock_deducted_at=is.null            → ชนะ = ตัด, 0 row = ตัดแล้ว skip
--   restore : PATCH ...&stock_deducted_at=not.is.null&stock_reverted_at=is.null → ชนะ = คืน (เคยตัด+ยังไม่คืน),
--             0 row = ไม่เคยตัด/คืนแล้ว skip (กัน phantom + คืนซ้ำ)
--   note-marker เดิม ([ตัดสต็อกแล้ว]/[คืนสต็อกแล้ว]) ยังเขียนไว้ (display + safety-net) — ไม่ถอด.
--
-- ⚠️ owner รันเองใน Supabase SQL editor — Claude ไม่ apply DB.
-- ⚠️ **ต้องรัน "ก่อน" deploy build ที่มี code นี้** — ไม่งั้น PATCH `?stock_deducted_at=is.null`
--    จะ error (คอลัมน์ไม่มี) → code fail-closed → ปิดงานได้แต่ "ไม่ตัดสต็อก" / ลบงานได้แต่ "ไม่คืน"
--    (จะเห็น toast เตือน). PostgREST `not.is.null` = IS NOT NULL (standard syntax).


-- ────────────────────────────────────────────────────────────────────────
-- STEP 0 — (รันก่อน · อ่านผล) งานที่มี marker เก่าแต่คอลัมน์ยัง NULL (รู้ scope ก่อน backfill)
-- ────────────────────────────────────────────────────────────────────────
-- SELECT
--   count(*) FILTER (WHERE note ILIKE '%[ตัดสต็อกแล้ว]%' AND stock_deducted_at IS NULL) AS deducted_unmarked,
--   count(*) FILTER (WHERE note ILIKE '%[คืนสต็อกแล้ว]%'  AND stock_reverted_at IS NULL) AS reverted_unmarked
-- FROM public.service_jobs;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 1 — เพิ่ม 2 คอลัมน์ (nullable, default NULL = "ยังไม่ตัด/ยังไม่คืน")
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS stock_deducted_at timestamptz;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS stock_reverted_at timestamptz;

-- ให้ PostgREST รีโหลด schema cache (ไม่งั้น ?stock_deducted_at=is.null = unknown column)
NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────────────────
-- STEP 2 — backfill งานเก่า (สำคัญมาก — กัน gap "ALTER แล้วยังไม่ backfill" → ตัด/คืนซ้ำงานเก่า)
--   marker ตรงเป๊ะกับ code: STOCK_DEDUCTED_MARKER = '[ตัดสต็อกแล้ว]' (service_equipment.js)
--                            STOCK_RETURNED_MARKER = '[คืนสต็อกแล้ว]'
--   ค่าที่เซ็ตเป็นแค่ "มาร์คว่าทำแล้ว" (ค่าเวลาไม่ได้ใช้เชิง logic) → ใช้ now() ปลอดภัยเสมอ.
-- ────────────────────────────────────────────────────────────────────────
UPDATE public.service_jobs
   SET stock_deducted_at = now()
 WHERE note ILIKE '%[ตัดสต็อกแล้ว]%'
   AND stock_deducted_at IS NULL;

UPDATE public.service_jobs
   SET stock_reverted_at = now()
 WHERE note ILIKE '%[คืนสต็อกแล้ว]%'
   AND stock_reverted_at IS NULL;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 3 — RLS (verify-first — อย่าเขียน policy ใหม่ถ้าของเดิมครอบอยู่แล้ว)
--   role ที่ปิด/ลบ/ยกเลิกงานได้ ต้อง UPDATE 2 คอลัมน์นี้ได้ภายใต้ policy เดิมของ service_jobs.
--   policy row-level (FOR ALL/UPDATE TO authenticated USING/WITH CHECK) ครอบทั้งแถว → คอลัมน์ใหม่ผ่านอัตโนมัติ.
--   ✅ owner verify ที่ DB:
--     SELECT polname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'service_jobs';
--   เห็น policy UPDATE/ALL TO authenticated ที่ไม่จำกัดคอลัมน์ = ผ่าน (ไม่ต้องแก้ ห้ามเพิ่ม policy เกิน).
