-- ═══════════════════════════════════════════════════════════
--  Phase 437 — Stock non-negative CHECK constraint (server-side)
--
--  วัตถุประสงค์ (owner: "สต็อกห้ามติดลบเด็ดขาด" — ของค้างจาก Phase 367):
--    บังคับระดับ DB ว่า stock ห้าม < 0 — เป็น last line of defense ทับ
--    floor logic ฝั่ง client (Phase 367 CAS floor / 368 transfer / 369 apply-movement)
--    → ต่อให้ client path ไหนพลาด/ถูก bypass ก็เขียนค่าติดลบลง DB ไม่ได้
--
--  ฝั่ง client (Phase 437 ใน modules/stock_movements.js): ปิดทาง manual override
--    ที่เคยส่ง allowNegative:true → เปลี่ยนเป็น hard block + ข้อความ "ไม่อนุญาตให้ติดลบ"
--    (เดิมมี confirm "จะติดลบ ดำเนินการต่อ?" — เอาออก เพราะติดลบไม่ได้แล้ว)
--
--  ⚠️ ลำดับการรัน (สำคัญ — ADD CONSTRAINT จะ validate กับข้อมูลเดิมทันที
--     ถ้ามีแถวติดลบค้างอยู่จะ error ทั้งคำสั่ง):
--     1) รัน STEP 1 (pre-check) ก่อน — ดูว่ามีแถว stock < 0 กี่แถว
--     2) ถ้า > 0 → รัน STEP 2 (data-fix, uncomment) เซ็ตเป็น 0 ก่อน
--        (ค่าติดลบคือ data corruption จาก oversell เก่า — ดู project_stock_negative_datafix
--         ยืนยัน build 369 ว่า 0 แถว; เผื่อ drift)
--     3) รัน STEP 3 (เพิ่ม constraint)
--     4) รัน STEP 4 (verify)
--
--  ขอบเขต (additive only):
--    - ★ ไม่ลบ/แก้ RLS policy เดิม
--    - ★ ไม่แตะคอลัมน์อื่น / ไม่แตะ floor logic ฝั่ง client (CAS เดิมยังทำงาน)
--    - ★ CHECK (stock >= 0) — แถว stock IS NULL ผ่านได้ (null ไม่ละเมิด CHECK)
--    - Re-run safe: DROP CONSTRAINT IF EXISTS ก่อน ADD
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  STEP 1 — PRE-CHECK: มีแถวติดลบค้างไหม (ต้องได้ 0 ก่อน ADD constraint)
-- ═══════════════════════════════════════════════════════════
SELECT 'warehouse_stock' AS tbl, count(*) AS neg_rows
FROM public.warehouse_stock WHERE stock < 0
UNION ALL
SELECT 'products' AS tbl, count(*) AS neg_rows
FROM public.products WHERE stock < 0;


-- ═══════════════════════════════════════════════════════════
--  STEP 2 — DATA-FIX (รันเฉพาะถ้า STEP 1 เจอ neg_rows > 0)
--  uncomment 2 บรรทัดล่างแล้วรัน — เซ็ตค่าติดลบเป็น 0
-- ═══════════════════════════════════════════════════════════
-- UPDATE public.warehouse_stock SET stock = 0 WHERE stock < 0;
-- UPDATE public.products        SET stock = 0 WHERE stock < 0;


-- ═══════════════════════════════════════════════════════════
--  STEP 3 — ADD CONSTRAINT (รันเมื่อ STEP 1 = 0 แถวแล้ว)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.warehouse_stock DROP CONSTRAINT IF EXISTS chk_ws_stock_nonneg;
ALTER TABLE public.warehouse_stock ADD  CONSTRAINT chk_ws_stock_nonneg CHECK (stock >= 0);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS chk_products_stock_nonneg;
ALTER TABLE public.products ADD  CONSTRAINT chk_products_stock_nonneg CHECK (stock >= 0);

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  STEP 4 — VERIFY
-- ═══════════════════════════════════════════════════════════
-- (a) constraint ต้องปรากฏ 2 แถว
SELECT conname, conrelid::regclass AS tbl
FROM pg_constraint
WHERE conname IN ('chk_ws_stock_nonneg', 'chk_products_stock_nonneg');

-- (b) ทดสอบว่าบล็อกจริง (คาดหวัง ERROR check constraint — เลือก ws id จริงมาแทน <WS_ID>):
-- UPDATE public.warehouse_stock SET stock = -1 WHERE id = <WS_ID>;
