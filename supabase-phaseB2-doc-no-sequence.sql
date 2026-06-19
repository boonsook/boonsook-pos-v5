-- ════════════════════════════════════════════════════════════════════════
-- Phase B2 — gapless sequential document numbers (QT / INV / RC) + UNIQUE
-- audit: AUDIT_2026-06-19_BUILD500_ROUND2.md  finding B2
-- owner รันเองที่ Supabase SQL editor (DDL — Claude/CI ไม่รันแทน)
-- บันทึกผลลง DB_MIGRATIONS_APPLIED.md หลังรัน (go-forward rule)
--
-- ปัญหา: qt_no/inv_no/receipt_no ออกเลขฝั่ง client (array length / Date.now().slice(-3))
--        + ไม่มี UNIQUE → 2 ใบได้เลขซ้ำเงียบ = ใบกำกับ/ใบเสร็จเลขซ้ำ (ผิด compliance)
-- แก้: ออกเลขฝั่ง DB แบบเรียงต่อเนื่องต่อวัน (Asia/Bangkok) ผ่าน trigger BEFORE INSERT
--      (override ค่าที่ client ส่งมาเสมอ — client value เป็นแค่ fallback ก่อน trigger ลง)
--      + UNIQUE index เป็น backstop
-- format คงเดิม: <PREFIX><YYYYMMDD><NNN>  (QT/RC prefix 2 ตัว, INV prefix 3 ตัว)
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 0 (รันก่อน — read-only) : เช็คว่ามีเลขซ้ำอยู่เดิมไหม
--   ถ้ามีแถวคืนมา → UNIQUE index ด้านล่างจะ "สร้างไม่สำเร็จ" จนกว่าจะแก้เลขซ้ำก่อน
--   (renumber ใบที่ออกทีหลังให้ไม่ชน แล้วค่อยรัน STEP ต่อ)
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT 'quotations' tbl, qt_no no, count(*) FROM public.quotations
--   WHERE qt_no IS NOT NULL GROUP BY qt_no HAVING count(*)>1
-- UNION ALL
-- SELECT 'delivery_invoices', inv_no, count(*) FROM public.delivery_invoices
--   WHERE inv_no IS NOT NULL GROUP BY inv_no HAVING count(*)>1
-- UNION ALL
-- SELECT 'receipts', receipt_no, count(*) FROM public.receipts
--   WHERE receipt_no IS NOT NULL GROUP BY receipt_no HAVING count(*)>1;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) counter table (ต่อ doc_type + period=YYYYMMDD) — ล็อกแถวได้ = race-free
--    RLS เปิดแต่ไม่มี policy → PostgREST/REST แตะตรงไม่ได้ (ปลอดภัย);
--    เข้าถึงผ่าน function SECURITY DEFINER เท่านั้น
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doc_number_counters (
  doc_type text    NOT NULL,
  period   text    NOT NULL,        -- 'YYYYMMDD' ตามเวลา Asia/Bangkok
  last_no  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, period)
);
ALTER TABLE public.doc_number_counters ENABLE ROW LEVEL SECURITY;
-- (ตั้งใจไม่สร้าง policy — กันอ่าน/เขียนตรงจาก REST; function definer ข้าม RLS ได้)

-- ─────────────────────────────────────────────────────────────────────────
-- 2) next_doc_number(prefix, doc_type) — atomic ผ่าน INSERT ... ON CONFLICT
--    คืนเลขถัดไปต่อวัน เช่น next_doc_number('QT','quotation') → 'QT20260701001'
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_doc_number(p_prefix text, p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text := to_char((now() AT TIME ZONE 'Asia/Bangkok'), 'YYYYMMDD');
  v_no     integer;
BEGIN
  INSERT INTO public.doc_number_counters (doc_type, period, last_no)
  VALUES (p_doc_type, v_period, 1)
  ON CONFLICT (doc_type, period)
  DO UPDATE SET last_no = public.doc_number_counters.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN p_prefix || v_period || lpad(v_no::text, 3, '0');
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) seed counter จากเลขเดิมที่มีอยู่ (กันชนกับใบที่ออกไปแล้ววันเดียวกัน)
--    last_no = MAX(เลข 3 หลักท้าย) ต่อ period ที่ตรง format เดิม
--    (รันได้ซ้ำ idempotent ผ่าน ON CONFLICT GREATEST)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.doc_number_counters (doc_type, period, last_no)
SELECT 'quotation', substring(qt_no from 3 for 8),
       MAX(COALESCE(NULLIF(regexp_replace(right(qt_no, 3), '\D', '', 'g'), '')::int, 0))
FROM public.quotations
WHERE qt_no ~ '^QT[0-9]{8}'
GROUP BY substring(qt_no from 3 for 8)
ON CONFLICT (doc_type, period) DO UPDATE
  SET last_no = GREATEST(public.doc_number_counters.last_no, EXCLUDED.last_no);

INSERT INTO public.doc_number_counters (doc_type, period, last_no)
SELECT 'delivery_invoice', substring(inv_no from 4 for 8),
       MAX(COALESCE(NULLIF(regexp_replace(right(inv_no, 3), '\D', '', 'g'), '')::int, 0))
FROM public.delivery_invoices
WHERE inv_no ~ '^INV[0-9]{8}'
GROUP BY substring(inv_no from 4 for 8)
ON CONFLICT (doc_type, period) DO UPDATE
  SET last_no = GREATEST(public.doc_number_counters.last_no, EXCLUDED.last_no);

INSERT INTO public.doc_number_counters (doc_type, period, last_no)
SELECT 'receipt', substring(receipt_no from 3 for 8),
       MAX(COALESCE(NULLIF(regexp_replace(right(receipt_no, 3), '\D', '', 'g'), '')::int, 0))
FROM public.receipts
WHERE receipt_no ~ '^RC[0-9]{8}'
GROUP BY substring(receipt_no from 3 for 8)
ON CONFLICT (doc_type, period) DO UPDATE
  SET last_no = GREATEST(public.doc_number_counters.last_no, EXCLUDED.last_no);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) trigger functions (BEFORE INSERT) — override เลขเสมอ = DB เป็น authoritative
--    EDIT ใช้ PATCH (UPDATE) → trigger ไม่ fire → เลขเดิมคงไว้
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_quotation_no()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.qt_no := public.next_doc_number('QT', 'quotation');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assign_delivery_invoice_no()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.inv_no := public.next_doc_number('INV', 'delivery_invoice');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assign_receipt_no()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.receipt_no := public.next_doc_number('RC', 'receipt');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_quotation_no ON public.quotations;
CREATE TRIGGER trg_assign_quotation_no
  BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.assign_quotation_no();

DROP TRIGGER IF EXISTS trg_assign_delivery_invoice_no ON public.delivery_invoices;
CREATE TRIGGER trg_assign_delivery_invoice_no
  BEFORE INSERT ON public.delivery_invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_delivery_invoice_no();

DROP TRIGGER IF EXISTS trg_assign_receipt_no ON public.receipts;
CREATE TRIGGER trg_assign_receipt_no
  BEFORE INSERT ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_no();

-- ─────────────────────────────────────────────────────────────────────────
-- 5) UNIQUE backstop (partial — ไม่บล็อกแถว legacy ที่ NULL)
--    ⚠️ ถ้า STEP 0 พบเลขซ้ำ ต้องแก้ก่อน ไม่งั้น CREATE จะ error 23505
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_qt_no
  ON public.quotations (qt_no) WHERE qt_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_invoices_inv_no
  ON public.delivery_invoices (inv_no) WHERE inv_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_receipt_no
  ON public.receipts (receipt_no) WHERE receipt_no IS NOT NULL;

-- PostgREST reload (schema cache)
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY หลังรัน (read-only)
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_assign_%_no';            -- ต้องได้ 3
-- SELECT indexname FROM pg_indexes WHERE indexname LIKE 'uq_%_no';              -- ต้องได้ 3
-- SELECT public.next_doc_number('QT','quotation');  -- เรียกลอง(จะ +1 counter — ทดสอบบน period วันนี้)
-- SELECT * FROM public.doc_number_counters ORDER BY doc_type, period;
