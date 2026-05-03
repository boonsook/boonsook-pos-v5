-- ═══════════════════════════════════════════════════════════
--  Phase 69 — Multi-payment per receipt
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- เดิมใบเสร็จมีแค่ payment_method (string เดียว) เก็บวิธีชำระหลัก
-- ขยายให้รับชำระหลายวิธี/บิล: เงินสด 5000 + โอน 3000 + เครดิต 2000 ฯลฯ
-- เก็บเป็น jsonb array of {method, amount, ref?, paid_at?}
-- ตัวอย่าง:
--   [
--     {"method":"cash","amount":5000},
--     {"method":"transfer","amount":3000,"ref":"SCB 220301","paid_at":"2026-05-03"},
--     {"method":"credit","amount":2000,"ref":"VISA****1234"}
--   ]

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS payments JSONB DEFAULT '[]'::jsonb;

-- index ไม่จำเป็น (จะ query ผ่าน receipt id เป็นหลัก ไม่ filter by payments content)
-- ถ้าอนาคตอยากรายงาน "ใบเสร็จที่มี cash + transfer ผสม" ค่อยเพิ่ม GIN

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT id, receipt_no, payment_method, payments, grand_total
-- FROM receipts
-- WHERE jsonb_array_length(payments) > 0
-- LIMIT 10;
