-- ════════════════════════════════════════════════════════════════════════
-- Phase 499 — sales.stock_reverted_at : atomic claim กัน double-restock (audit #C)
-- (MONEY/STOCK §4.2 idempotency · severity HIGH · ก่อน go-live บัญชี 1 ก.ค. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- ปัญหา (audit #C, verified):
--   ลบบิล POS → `_revertStockForSale` (main.js) คืนสต็อก. gate กันคืนซ้ำเดิม (Phase 410) =
--   read-then-write ใน app code (GET sales.note → เช็ค marker [คืนสต็อกแล้ว] → ... → แปะ marker ทีหลัง)
--   = TOCTOU: ลบบิลเดียวกัน "พร้อมกันจาก 2 เครื่อง/2 tab" → ทั้งคู่ผ่าน gate (ยังไม่มีใครแปะ marker)
--   → restock ทั้งคู่ → **สต็อกพองเกินจริง (oversell, งบสต็อกเพี้ยน)**.
--
-- วิธีแก้:
--   เปลี่ยน gate เป็น **atomic claim** = conditional UPDATE
--     PATCH sales?id=eq.<id>&stock_reverted_at=is.null  body { stock_reverted_at: now() }
--   DB การันตี single-writer: ผู้ชนะได้ 1 row (stock_reverted_at เคยเป็น NULL), ผู้แพ้ได้ 0 row → skip.
--   (note-marker [คืนสต็อกแล้ว] เดิมยังถูกแปะตอนจบ — module อื่นอ่าน note อยู่ ไม่ถอด)
--
-- ⚠️ owner รันเองใน Supabase SQL editor — Claude ไม่ apply DB.
-- ⚠️ **ต้องรัน "ก่อน" deploy build ที่มี code นี้** — ไม่งั้น PATCH `?stock_reverted_at=is.null`
--    จะ error (คอลัมน์ไม่มี) → code fail-closed → ลบบิลได้แต่ "ไม่คืนสต็อก" (จะเห็น toast error).


-- ────────────────────────────────────────────────────────────────────────
-- STEP 0 — (รันก่อน · อ่านผล) บิลที่ "เคยคืนสต็อกแล้ว" (note มี marker) แต่คอลัมน์ใหม่ยัง NULL
--   trigger code ไม่ย้อนรู้ของเก่า → ถ้าไม่ backfill แล้วมีคนลบบิลเก่าซ้ำ จะ claim ผ่าน → restock ซ้ำ.
--   (code มี safety-net เช็ค note-marker หลัง claim ด้วย แต่ backfill = ด่านหลักที่ถูกต้อง)
-- ────────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS reverted_but_unmarked
-- FROM public.sales
-- WHERE note ILIKE '%[คืนสต็อกแล้ว]%' AND stock_reverted_at IS NULL;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 1 — เพิ่มคอลัมน์ (nullable, default NULL = "ยังไม่คืน")
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS stock_reverted_at timestamptz;

-- ให้ PostgREST รีโหลด schema cache (ไม่งั้น ?stock_reverted_at=is.null = unknown column)
NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────────────────
-- STEP 2 — backfill บิลเก่าที่คืนแล้ว → เซ็ตคอลัมน์ให้ "ไม่ NULL" (กันลบซ้ำ→restock ซ้ำ)
--   ค่าที่เซ็ตเป็นแค่ "มาร์คว่าคืนแล้ว" (ค่าเวลาไม่ได้ใช้เชิง logic) → ใช้ now() ปลอดภัยเสมอ.
--   (ถ้าตาราง sales มีคอลัมน์ updated_at จริง และอยากได้เวลาที่ใกล้จริง อาจใช้
--    COALESCE(updated_at, now()) แทน — verify ที่ DB ก่อน; ไม่บังคับ)
-- ────────────────────────────────────────────────────────────────────────
UPDATE public.sales
   SET stock_reverted_at = now()
 WHERE note ILIKE '%[คืนสต็อกแล้ว]%'
   AND stock_reverted_at IS NULL;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 3 — RLS (verify-first — อย่าเขียน policy ใหม่ถ้าของเดิมครอบอยู่แล้ว)
--   role ที่ลบบิลได้ (admin/sales) ต้อง UPDATE คอลัมน์นี้ได้ภายใต้ policy เดิมของ sales.
--   policy เดิมเป็นแบบ row-level (FOR ALL/UPDATE TO authenticated USING(...) WITH CHECK(...))
--   ที่ครอบทั้งแถวอยู่แล้ว → คอลัมน์ใหม่ผ่านอัตโนมัติ (RLS เป็น row-level ไม่ใช่ column-level).
--   ✅ owner verify ที่ DB:
--     SELECT polname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'sales';
--   ถ้าเห็น policy UPDATE/ALL TO authenticated ที่ไม่ได้จำกัดคอลัมน์ = ผ่าน (ไม่ต้องแก้).
--   (ห้ามเพิ่ม policy ใหม่ถ้าไม่จำเป็น — กันเปิดช่องเกิน)
