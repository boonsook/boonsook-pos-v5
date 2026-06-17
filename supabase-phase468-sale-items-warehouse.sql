-- ═══════════════════════════════════════════════════════════
--  Phase 468 — sale_items.warehouse_id (snapshot คลังที่ขายจริง)
--  owner รันบน Supabase SQL editor (ทีม implement ไม่ใส่ credential)
--
--  ปัญหา: ตอนยกเลิก/ลบบิล POS (_revertStockForSale) คืนสต็อกแบบ "บ้านก่อน"
--    ไม่ใช่คลังที่ขายจริง เพราะ sale_items ไม่เคยเก็บว่าขายจากคลังไหน
--    → ขายจากรถ ยกเลิก = สต็อกเด้งเข้าบ้านผิด (ยอดรวมถูก แต่รายคลังเพี้ยน).
--  แก้: เพิ่มคอลัมน์ warehouse_id (nullable) — POS เขียนคลังที่เลือก (Phase 464)
--    ลงทุกบิลใหม่; revert ใช้ค่านี้คืนเข้าคลังเดิม.
--
--  ลำดับ deploy (ปลอดภัยทั้งคู่ — โค้ด build 468 มี legacy-fallback strip warehouse_id
--    ถ้าคอลัมน์ยังไม่มี → insert ไม่ fail): รัน SQL นี้เมื่อไหร่ก็ได้ ก่อน/หลัง deploy.
--    รันแล้ว → บิลใหม่เริ่มเก็บ warehouse_id; บิลเก่า = null → revert fallback บ้าน+เตือน.
--
--  ขอบเขต (additive only):
--    - ★ ADD COLUMN IF NOT EXISTS (re-run ปลอดภัย) · nullable · ไม่ backfill
--    - ★ ไม่แตะ RLS / คอลัมน์อื่น / ข้อมูลเดิม
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS warehouse_id bigint;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'sale_items' and column_name = 'warehouse_id';   -- ต้องเจอ 1 แถว (bigint)
