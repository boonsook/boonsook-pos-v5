-- ============================================================================
-- Phase 557 — Backfill: sale_items.unit_cost ของบรรทัด "ชุด (bundle)" + sales.gross_profit
-- ============================================================================
-- OWNER-RUN เท่านั้น — รันด้วยมือใน Supabase SQL Editor (ไม่มี migration runner อัตโนมัติ).
-- รันตามลำดับ STEP1 (ดูจำนวนก่อน) → STEP2 → STEP3 → STEP4 (verify).
--
-- ปัญหาที่แก้:
--   ตอน checkout เดิม (ก่อน build 557) POS เขียน sale_items.unit_cost = cost ของตัว bundle "แม่"
--   ซึ่งมักตั้งไว้ 0. profit_report.js / profit_by_product.js อ่าน unit_cost เป็นต้นทุน (fallback
--   ไป products.cost = ตัวแม่ = 0 อีกที) → COGS ของบิลชุด = 0 → กำไรเฟ้อถาวรในรายงานย้อนหลัง.
--   build 555 (#130) แก้เฉพาะ sales.gross_profit ของบิล "ใหม่"; build 557 แก้ต้นทาง unit_cost
--   ของบิลใหม่. ไฟล์นี้ปะข้อมูล "เก่า" ที่ค้างใน DB.
--
-- ⚠️ สมมติฐาน (เหมือน fallback ของ profit_report เดิม):
--   ใช้ "cost ปัจจุบัน" ของ children (ระบบไม่เก็บ historical cost). ถ้า cost ของ child หรือสูตร
--   (product_bundles) ถูกแก้หลังการขาย backfill จะคลาดจากต้นทุน ณ วันขายจริงได้ — ยอมรับได้
--   เพราะเป็นฐานเดียวกับที่รายงานใช้อยู่แล้ว และดีกว่าปล่อยเป็น 0.
--
-- ขอบเขต (ไม่แตะแถวอื่น):
--   เฉพาะ sale_items ที่ (unit_cost = 0) AND (product เป็น is_bundle) AND (Σ ต้นทุน children > 0).
--   บรรทัดสินค้าเดี่ยว / bundle ที่ children ต้นทุนรวม 0 / unit_cost มีค่าแล้ว = ไม่แตะ.
--   โครงแถว sale_items (product_id/qty/unit_price/line_total) คงเดิม — แก้เฉพาะ "ค่า" unit_cost.
--
-- ROLLBACK guidance:
--   ก่อน STEP2/STEP3 เก็บค่าเดิมลง temp table เพื่อกู้คืนได้:
--     CREATE TEMP TABLE _bk557_si AS
--       SELECT id, unit_cost FROM sale_items si
--       WHERE si.unit_cost = 0 AND EXISTS (
--         SELECT 1 FROM products p WHERE p.id = si.product_id AND p.is_bundle = true)
--       AND (SELECT COALESCE(SUM(pb.qty * pc.cost),0) FROM product_bundles pb
--            JOIN products pc ON pc.id = pb.child_product_id WHERE pb.bundle_id = si.product_id) > 0;
--     CREATE TEMP TABLE _bk557_sales AS
--       SELECT id, gross_profit FROM sales WHERE id IN (SELECT sale_id FROM _bk557_si_join...);
--   กู้คืน:  UPDATE sale_items t SET unit_cost = b.unit_cost FROM _bk557_si b WHERE t.id = b.id;
--            UPDATE sales t SET gross_profit = b.gross_profit FROM _bk557_sales b WHERE t.id = b.id;
--   (temp table หายเมื่อจบ session — ถ้าจะกู้ทีหลังให้เปลี่ยนเป็น table ปกติ prefix _bk557_)
-- ============================================================================

-- ── STEP 1 — VERIFY ก่อน: นับแถว bundle ที่จะถูกแก้ + ประเมินผลกระทบ ─────────────
-- รันก่อน เพื่อดูจำนวน/ยอด แล้วค่อยตัดสินใจรัน STEP2
SELECT
  count(*) AS bundle_lines_to_fix,
  sum(si.qty * (
    SELECT COALESCE(SUM(pb.qty * pc.cost), 0)
    FROM product_bundles pb
    JOIN products pc ON pc.id = pb.child_product_id
    WHERE pb.bundle_id = si.product_id
  )) AS total_cost_to_add
FROM sale_items si
JOIN products p ON p.id = si.product_id AND p.is_bundle = true
WHERE si.unit_cost = 0
  AND (
    SELECT COALESCE(SUM(pb.qty * pc.cost), 0)
    FROM product_bundles pb
    JOIN products pc ON pc.id = pb.child_product_id
    WHERE pb.bundle_id = si.product_id
  ) > 0;

-- ── STEP 2 — UPDATE sale_items.unit_cost = Σ(child.cost × recipe.qty) ต่อหน่วย ──────
-- แก้เฉพาะแถวตาม STEP1 (unit_cost=0 + is_bundle + Σ children cost > 0). RETURNING = log ค่าเก่า→ใหม่
UPDATE sale_items si
SET unit_cost = (
  SELECT COALESCE(SUM(pb.qty * pc.cost), 0)
  FROM product_bundles pb
  JOIN products pc ON pc.id = pb.child_product_id
  WHERE pb.bundle_id = si.product_id
)
WHERE si.unit_cost = 0
  AND EXISTS (SELECT 1 FROM products p WHERE p.id = si.product_id AND p.is_bundle = true)
  AND (
    SELECT COALESCE(SUM(pb.qty * pc.cost), 0)
    FROM product_bundles pb
    JOIN products pc ON pc.id = pb.child_product_id
    WHERE pb.bundle_id = si.product_id
  ) > 0
RETURNING si.id, si.sale_id, si.product_id, si.unit_cost AS new_unit_cost;

-- ── STEP 3 — UPDATE sales.gross_profit = round(subtotal − Σ(qty×unit_cost), 2) ────
-- เฉพาะ sales ที่ (ก) มี sale_items เป็น bundle ที่เพิ่งแก้ใน STEP2, (ข) gross_profit ไม่ NULL
-- (quick-pay/บิลว่าง = NULL คงไว้ ไม่ inflate), (ค) subtotal ไม่ NULL, (ง) note ไม่ใช่บิลลบ.
UPDATE sales s
SET gross_profit = round(
  COALESCE(s.subtotal, 0) - (
    SELECT COALESCE(SUM(si.qty * si.unit_cost), 0)
    FROM sale_items si
    WHERE si.sale_id = s.id
  ), 2)
WHERE s.gross_profit IS NOT NULL
  AND s.subtotal IS NOT NULL
  AND COALESCE(s.note, '') NOT LIKE '%[ลบแล้ว]%'
  AND EXISTS (
    SELECT 1
    FROM sale_items si2
    JOIN products p ON p.id = si2.product_id AND p.is_bundle = true
    WHERE si2.sale_id = s.id
  )
RETURNING s.id, s.subtotal, s.gross_profit AS new_gross_profit;

-- ── STEP 4 — VERIFY หลัง ─────────────────────────────────────────────────────
-- 4a) ต้องไม่เหลือบรรทัด bundle unit_cost=0 ที่มีต้นทุน children > 0 (= 0 rows)
SELECT count(*) AS remaining_bundle_zero_cost
FROM sale_items si
JOIN products p ON p.id = si.product_id AND p.is_bundle = true
WHERE si.unit_cost = 0
  AND (
    SELECT COALESCE(SUM(pb.qty * pc.cost), 0)
    FROM product_bundles pb
    JOIN products pc ON pc.id = pb.child_product_id
    WHERE pb.bundle_id = si.product_id
  ) > 0;

-- 4b) spot-check 3 บิลที่มี bundle: subtotal, Σต้นทุน, gross_profit ใหม่ (ควร subtotal − Σcost)
SELECT
  s.id,
  s.subtotal,
  (SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) FROM sale_items si WHERE si.sale_id = s.id) AS total_cost,
  s.gross_profit
FROM sales s
WHERE s.gross_profit IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sale_items si2
    JOIN products p ON p.id = si2.product_id AND p.is_bundle = true
    WHERE si2.sale_id = s.id)
ORDER BY s.id DESC
LIMIT 3;
