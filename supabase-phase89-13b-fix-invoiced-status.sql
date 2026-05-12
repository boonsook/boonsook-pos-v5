-- ═══════════════════════════════════════════════════════════
-- Phase 89.13b — Fix delivery_invoices.status = "invoiced" typo
-- ═══════════════════════════════════════════════════════════
-- Root cause:
--   Phase 89.6 (Cancel receipt → restore invoice) เขียนผิด:
--   ใช้ status = "invoiced" (ค่าของ quotations.status)
--   แทนที่จะเป็น "pending" (ค่าของ delivery_invoices.status enum)
--
--   delivery_invoices.status enum ที่ถูก: pending | delivered | receipted | cancelled | partial
--   (อ้างอิง modules/delivery_invoices.js:30-36 — STATUS_LABELS)
--
-- Impact:
--   row ที่เคยถูก cancel receipt + restore แล้ว จะมี status="invoiced"
--   UI ไม่รู้จัก label นี้ → แสดง raw "invoiced" แทน "รอดำเนินการ"
--   user ไม่เห็นว่าใบส่งสินค้ากลับสู่สถานะที่ออกใบเสร็จใหม่ได้
--
-- Fix:
--   1. UPDATE rows ที่ status="invoiced" → "pending"
--   2. (Code fix อยู่ใน receipts.js commit เดียวกัน — 9 จุด)
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 1. นับ row ที่ผิดก่อนแก้ (เก็บไว้เป็น audit)
SELECT count(*) AS rows_to_fix FROM delivery_invoices WHERE status = 'invoiced';

-- 2. แก้ status ที่ผิดเป็น pending (รอดำเนินการ)
UPDATE delivery_invoices
SET    status = 'pending'
WHERE  status = 'invoiced';

-- 3. verify ว่าไม่มี row ที่ status="invoiced" เหลือแล้ว
SELECT count(*) AS rows_remaining_invoiced FROM delivery_invoices WHERE status = 'invoiced';

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- หลังรัน:
--   NOTIFY pgrst, 'reload schema';  -- ไม่จำเป็นเพราะไม่ได้ ALTER TABLE
-- ═══════════════════════════════════════════════════════════
