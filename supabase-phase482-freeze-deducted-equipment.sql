-- ═══════════════════════════════════════════════════════════
--  Phase 482 — freeze already-deducted service-job equipment (กัน double-deduct)
--  MONEY/STOCK §4.1+§4.2 · owner รันบน Supabase SQL editor (ทีม implement ไม่ใส่ credential)
--
--  บริบท: ก่อน build 482 อุปกรณ์งานช่าง "ตัดสต็อกตอนสร้าง/บันทึกงาน" (Phase 402 + service_form).
--    build 482 ย้ายไปตัด "ตอนปิดงาน" (done/delivered/closed) + ใช้ marker [ตัดสต็อกแล้ว] กันตัดซ้ำ.
--
--  ปัญหาถ้าไม่รัน SQL นี้: งานเก่าที่ "ตัดไปแล้ว" (ตอนสร้าง) ยังไม่มี marker [ตัดสต็อกแล้ว] →
--    (1) ถ้าเปลี่ยนสถานะงานเก่าเป็นปิด (หรือ re-save ผ่าน drawer ตอน transition) → deduct-on-close
--        จะ "ตัดซ้ำ" (double-deduct) เพราะ idempotency marker ไม่มี.
--    (2) restore-on-cancel ของงานเก่า (build 482 gate ต้องมี [ตัดสต็อกแล้ว] ก่อนถึงจะคืน) จะ no-op
--        → ยกเลิกงานเก่าที่ตัดไปแล้วจะไม่คืนสต็อก.
--
--  วิธีแก้: มาร์คงานเก่า "ทุกงานที่มีอุปกรณ์ (items_json) และยังไม่ถูกคืน" ว่า [ตัดสต็อกแล้ว]
--    → deduct-on-close เห็น marker = no-op (ไม่ตัดซ้ำ) + restore-on-cancel ทำงานถูก.
--
--  ⚠️ ลำดับ deploy (ทำตอนร้านปิด/low traffic):
--    1. merge + deploy build 482 ก่อน (JS ใหม่: ตัดตอนปิด + ใช้ marker)
--    2. รัน SQL นี้ทันที (มาร์คงานเก่าที่ตัดไปแล้ว = "ตัดแล้ว")
--    (ช่วงคาบเกี่ยว: ถ้ามีงานเก่าถูกปิดก่อนรัน SQL → อาจตัดซ้ำ 1 งาน → ร้านปิด = ไม่มี = ปลอดภัย)
--
--  ขอบเขต (additive · note-only):
--    - ★ แตะเฉพาะ service_jobs.note (เติม marker) — ไม่แตะ items_json / stock / JV / RLS / schema
--    - ★ idempotent: re-run ปลอดภัย (NOT LIKE กันเติมซ้ำ)
--    - ★ ข้ามงานที่คืนสต็อกแล้ว ([คืนสต็อกแล้ว]) — งานยกเลิก ไม่ต้องมาร์คว่าตัดอยู่
-- ═══════════════════════════════════════════════════════════

-- STEP 1 — PRE-CHECK: ดูว่ามีงานเก่ากี่งานที่จะถูกมาร์ค (อุปกรณ์ + ยังไม่มี marker ใด)
SELECT count(*) AS jobs_to_freeze
FROM public.service_jobs
WHERE items_json IS NOT NULL
  AND jsonb_array_length(items_json) > 0
  AND COALESCE(note,'') NOT LIKE '%[ตัดสต็อกแล้ว]%'
  AND COALESCE(note,'') NOT LIKE '%[คืนสต็อกแล้ว]%';

-- STEP 2 — มาร์ค [ตัดสต็อกแล้ว] ให้งานเก่าที่มีอุปกรณ์ (เคยตัดตอนสร้าง) และยังไม่ถูกคืน
UPDATE public.service_jobs
   SET note = COALESCE(note,'')
            || CASE WHEN COALESCE(note,'') = '' THEN '' ELSE ' ' END
            || '[ตัดสต็อกแล้ว]'
 WHERE items_json IS NOT NULL
   AND jsonb_array_length(items_json) > 0
   AND COALESCE(note,'') NOT LIKE '%[ตัดสต็อกแล้ว]%'
   AND COALESCE(note,'') NOT LIKE '%[คืนสต็อกแล้ว]%';

NOTIFY pgrst, 'reload schema';

-- STEP 3 — VERIFY: ควรได้ 0 (ทุกงานที่มีอุปกรณ์มี marker [ตัดสต็อกแล้ว] หรือ [คืนสต็อกแล้ว] แล้ว)
SELECT count(*) AS remaining_unmarked
FROM public.service_jobs
WHERE items_json IS NOT NULL
  AND jsonb_array_length(items_json) > 0
  AND COALESCE(note,'') NOT LIKE '%[ตัดสต็อกแล้ว]%'
  AND COALESCE(note,'') NOT LIKE '%[คืนสต็อกแล้ว]%';
