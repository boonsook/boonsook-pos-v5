-- supabase-phase398-gross-profit.sql
-- Phase 398 — เพิ่มคอลัมน์ sales.gross_profit (กำไรขั้นต้นต่อบิล)
--
-- บริบท:
--   dashboard อ่าน sales.gross_profit (modules/dashboard.js:310 → KPI "กำไรขั้นต้น")
--   แต่คอลัมน์นี้ "ไม่เคยมีอยู่จริง" (verified 2026-06-07: ERROR 42703 column does not exist)
--   → KPI แสดง ฿0 เสมอ (dead metric).
--   Phase 398 (modules/pos.js) จะคำนวณ + เขียนค่าตอน checkout:
--     gross_profit = subtotal(ก่อน VAT) − Σ(unit_cost × qty)   [null ถ้า quick-pay/ตะกร้าว่าง]
--
-- วิธีรัน: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ปลอดภัย: idempotent (IF NOT EXISTS), nullable, ไม่แตะบิลเดิม
--          (บิลเก่า gross_profit = NULL จนกว่าจะ backfill แยก = Phase ทาง C ในอนาคต)

-- 1) เพิ่มคอลัมน์ (nullable, NUMERIC(14,2) = ชนิดเดียวกับคอลัมน์เงินอื่นในระบบ)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(14,2);

-- 2) reload PostgREST schema cache
--    (สำคัญ — ถ้าไม่ทำ API จะยังมองไม่เห็นคอลัมน์ → insert sales จะ error PGRST204)
NOTIFY pgrst, 'reload schema';

-- 3) verify — ควรรันผ่าน (ไม่ error แล้ว) และตอนนี้ has_gp = 0 = ถูกต้อง (ยังไม่มีบิลใหม่เขียน)
select count(*) AS total, count(gross_profit) AS has_gp, coalesce(sum(gross_profit),0) AS sum_gp
from sales;
