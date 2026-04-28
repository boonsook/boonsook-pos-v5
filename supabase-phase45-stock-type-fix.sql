-- ═══════════════════════════════════════════════════════════
--  Phase 45.7 — Fix stock_movements.type CHECK constraint
--  Date: 2026-04-28
-- ═══════════════════════════════════════════════════════════
--
-- Problem (HTTP 400, code 23514):
--   stock_movements_type_check rejects values like 'out', 'transfer'
--   เพราะ DB constraint ตั้งไว้ allow แค่ subset เก่า
--
-- Code ใน main.js ส่ง 6 ค่า:
--   - 'in'        — รับเข้าคลัง
--   - 'out'       — ตัดออก (จากใบงานช่าง)
--   - 'sale'      — ขายผ่าน POS
--   - 'transfer'  — โอนระหว่างคลัง
--   - 'return'    — รับคืน
--   - 'adjust'    — ปรับยอด (นับสต็อก)
--
-- Fix: Drop old + recreate with full list
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste ทั้งหมด → Run
--   3. ตรวจ "Success. No rows returned"
--   4. กลับไปแอป → ทดสอบ save ใบงานหรือโอนสต็อก — ต้องไม่มี HTTP 400 stock_movements
-- ═══════════════════════════════════════════════════════════

-- Drop old constraint
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_type_check;

-- Recreate with full list
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN (
    'in',
    'out',
    'sale',
    'transfer',
    'return',
    'adjust'
  ));

-- ═══════════════════════════════════════════════════════════
--  Verify (ดูค่าใน constraint หลังรัน)
-- ═══════════════════════════════════════════════════════════
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.stock_movements'::regclass
--   AND conname = 'stock_movements_type_check';
