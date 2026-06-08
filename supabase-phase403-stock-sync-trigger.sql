-- ═══════════════════════════════════════════════════════════════════════
-- Phase 403 — products.stock = sum(warehouse_stock) (canonical derived)
-- MONEY/STOCK §4.2 · owner รันบน Supabase SQL editor (ทีม implement ไม่ใส่ credential)
--
-- ปัญหา: products.stock (ยอดรวม derived) หลุด sync จาก warehouse_stock (truth ต่อคลัง)
--   เพราะ JS อัปเดต 2 ตัวแยกกัน best-effort (ตัวนึงพลาด = ไม่ rollback). Phase 402 smoke
--   เจอ 6 ตัวเพี้ยน -1. แก้ราก: ทำให้ products.stock เป็น derived 100% ผ่าน DB trigger
--   → ทุก path ที่แตะ warehouse_stock (POS/งานช่าง/manual/transfer/concurrent/แก้จาก client อื่น)
--     products.stock sync อัตโนมัติ ไม่พึ่ง JS.
--
-- ⚠️ DEPLOY ORDER (สำคัญ — ทำตอนร้านปิด / ไม่มีบิลขายอยู่):
--   1. ยืนยันไม่มีการขายอยู่ (ปิดร้าน/low traffic)
--   2. merge + deploy build 403 ก่อน  → prod = 403 (JS ใหม่ defer trigger, ไม่เขียน products.stock บิล warehouse)
--   3. รัน trigger SQL นี้ (ขั้นตอน 1-2 ด้านล่าง)
--   4. รัน backfill (ขั้นตอน 3) → products.stock = sum ทันที
--   5. verify (ดูท้ายไฟล์) = 0 แถว + ขายทดสอบ 1 บิล → products.stock ลด −1 ครั้งเดียว
--
--   ❌ ห้ามอยู่ในสถานะ (JS build 402 เก่า + trigger live) ตอนมีขาย:
--      บิล warehouse 1 บิล → warehouse −1 → trigger ตั้ง products=sum → JS 402 ลบ products ซ้ำ
--      = sum−qty (double-count ทุกบิลจนกว่า 403 จะ deploy; backfill แก้ได้แค่อดีต ไม่กันอนาคต).
--   ✅ deploy 403 ก่อน trigger: ช่วงคาบเกี่ยว products.stock บิล warehouse "freeze" ชั่วคราว
--      แต่ร้านปิด = ไม่มีบิล = ไม่กระทบ (และ freeze กู้ได้ด้วย backfill — ปลอดภัยกว่า double-count).
-- ═══════════════════════════════════════════════════════════════════════

-- 1) ฟังก์ชัน: recompute products.stock จาก sum(warehouse_stock) ของ product นั้น
create or replace function sync_product_stock() returns trigger
language plpgsql
security definer
as $$
declare
  pid bigint := coalesce(new.product_id, old.product_id);
begin
  if pid is null then
    return null;
  end if;
  update products
     set stock = coalesce((select sum(stock) from warehouse_stock where product_id = pid), 0)
   where id = pid;
  return null;  -- AFTER trigger: ค่า return ไม่ถูกใช้
end $$;

-- 2) trigger: ยิงทุก insert/update/delete บน warehouse_stock (per row)
drop trigger if exists trg_sync_product_stock on warehouse_stock;
create trigger trg_sync_product_stock
  after insert or update or delete on warehouse_stock
  for each row execute function sync_product_stock();

-- 3) one-time backfill: ตั้ง products.stock = sum(warehouse_stock) ให้ตรงทันที
--    (สินค้าที่ไม่มี row ใน warehouse_stock เลย → คง stock เดิมไว้ ไม่ถูกตั้งเป็น 0
--     เพราะอาจเป็นสินค้า legacy ที่ track เฉพาะ products.stock — ไม่มี warehouse)
update products p
   set stock = s.total
  from (select product_id, sum(stock) as total from warehouse_stock group by product_id) s
 where p.id = s.product_id
   and p.stock is distinct from s.total;

-- 4) reload PostgREST schema cache
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง 1-4 — ต้องได้ 0 แถว = ไม่มี divergence):
--   select p.id, p.name, p.stock, coalesce(sum(w.stock),0) as wh_sum
--     from products p
--     join warehouse_stock w on w.product_id = p.id
--    group by p.id, p.name, p.stock
--   having p.stock is distinct from coalesce(sum(w.stock),0);
--
-- ROLLBACK (ถ้าต้องถอน trigger):
--   drop trigger if exists trg_sync_product_stock on warehouse_stock;
--   drop function if exists sync_product_stock();
-- ═══════════════════════════════════════════════════════════════════════
