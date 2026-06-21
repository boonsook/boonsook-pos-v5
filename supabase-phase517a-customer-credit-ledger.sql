-- Phase 517a - Customer credit ledger foundation (เครดิตคงเหลือลูกค้า / liability 2180)
-- Owner-run SQL (Supabase SQL Editor). Idempotent. รันทีละ STEP, ตรวจผล STEP0 ก่อน apply.
--
-- บริบท:
--   Phase 512 สร้าง COA 2180 + mapping refund_credit/refund_exchange = Dr 4110 / Cr 2180
--   → เวลาคืนสินค้าแบบเก็บเครดิต/เปลี่ยนสินค้า ระบบลง Cr 2180 (liability) ใน JV อยู่แล้ว
--   แต่ "ยังไม่มี source-of-truth ระดับลูกค้า" ว่าใครมีเครดิตคงเหลือเท่าไร
--
--   517a = วาง foundation:
--     1) ตาราง customer_credit_ledger  (per-customer ledger, + = เพิ่มเครดิต / - = ใช้เครดิต)
--     2) RPC redeem_customer_credit     (ใช้เครดิต atomic + กันใช้เกิน/หลายเครื่อง — ยังไม่มี caller ใน 517a)
--     3) backfill เครดิตจาก refund credit/exchange ที่มี customer_id
--   *** ไม่แตะ POS checkout / postJournalForSale / credit_payments / JV เดิม ***
--   การใช้เครดิตหน้า POS (Dr 2180 split) = Phase 517b แยก (ต้อง rework checkout ให้ rollback ปลอดภัยก่อน)
--
-- หมายเหตุชนิดข้อมูล: customers.id = BIGINT (ยืนยันจาก supabase-rls-policies.sql) → customer_id ตารางนี้เป็น bigint
--   ถ้า STEP0-A พบว่า customers.id ไม่ใช่ bigint ให้ STOP แล้วแจ้ง owner ก่อน (อย่าฝืน apply)

-- =====================================================================
-- STEP 0 - INSPECT ก่อน apply (ไม่เปลี่ยนข้อมูล). ถ้าผลผิดคาด ให้ STOP
-- =====================================================================

-- 0-A) ยืนยันชนิด customers.id (ต้องเป็น bigint/integer)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'id';

-- 0-B) refund credit/exchange ที่ "ไม่มี" customer_id (= เครดิตลอย ผูกลูกค้าไม่ได้ → backfill ไม่ได้)
SELECT count(*) AS credit_refunds_without_customer
FROM public.refunds
WHERE (refund_method ILIKE '%credit%' OR refund_method ILIKE '%เครดิต%'
       OR refund_method ILIKE '%exchange%' OR refund_method ILIKE '%เปลี่ยน%')
  AND customer_id IS NULL;

-- 0-C) จำนวน refund credit/exchange ที่ "มี" customer_id (= จะ backfill เข้า ledger)
SELECT count(*) AS credit_refunds_with_customer,
       COALESCE(sum(refund_amount), 0) AS total_credit_amount
FROM public.refunds
WHERE (refund_method ILIKE '%credit%' OR refund_method ILIKE '%เครดิต%'
       OR refund_method ILIKE '%exchange%' OR refund_method ILIKE '%เปลี่ยน%')
  AND customer_id IS NOT NULL;

-- 0-D) ยอด liability 2180 ใน journal (เทียบ reconciliation กับ ledger ภายหลัง)
SELECT COALESCE(sum(jl.credit) - sum(jl.debit), 0) AS net_2180_credit
FROM public.journal_lines jl
WHERE jl.account_code = '2180';

-- ⚠️ ถ้า 0-B > 0 = มี refund เก็บเครดิตแต่ไม่ผูกลูกค้า → เครดิตนั้นใช้ไม่ได้จนกว่าจะผูกลูกค้า
--    517a จะ "ไม่" สร้างเครดิตลอยให้ (โดยตั้งใจ) — แจ้ง owner ให้ผูกลูกค้าย้อนหลังถ้าต้องการ

-- =====================================================================
-- STEP 1 - สร้างตาราง ledger
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.customer_credit_ledger (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  source_type text   NOT NULL,            -- refund_credit | refund_exchange | sale_credit_use | adjustment
  source_id   bigint,                     -- FK เชิงตรรกะ (refunds.id / sales.id) — nullable
  source_key  text,                       -- idempotency key สำหรับ sale_credit_use (เช่น order_no/sale id)
  amount      numeric(14,2) NOT NULL,     -- + = เพิ่มเครดิต(+liability 2180) / - = ใช้เครดิต(ล้าง 2180)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

COMMENT ON TABLE public.customer_credit_ledger IS
  'Phase 517a: per-customer credit ledger (เครดิตคงเหลือลูกค้า). +amount เพิ่มเครดิต/+liability 2180, -amount ใช้เครดิต/ล้าง 2180. balance = SUM(amount) ต่อ customer_id.';

-- =====================================================================
-- STEP 2 - indexes + กันลงซ้ำ (idempotency)
-- =====================================================================
-- กัน refund เดียวสร้างเครดิตซ้ำ (source_type+source_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_source
  ON public.customer_credit_ledger (source_type, source_id)
  WHERE source_id IS NOT NULL;

-- กันการใช้เครดิต (sale_credit_use) ลงซ้ำจาก key เดียว (replay-safe สำหรับ 517b)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_source_key
  ON public.customer_credit_ledger (source_type, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ccl_customer ON public.customer_credit_ledger (customer_id);

-- =====================================================================
-- STEP 3 - RLS: staff อ่าน/เพิ่มได้ (เฉพาะ +amount refund rows), customer OTP เข้าไม่ได้
--   pattern อ้าง supabase-phase505-rls-customer-deny.sql (is_customer_role) + is_admin (phase495)
-- =====================================================================
ALTER TABLE public.customer_credit_ledger ENABLE ROW LEVEL SECURITY;

-- 3-A) PERMISSIVE: staff อ่านได้ทั้งหมด; insert ได้เฉพาะ +amount refund_credit/refund_exchange
--      (sale_credit_use ติดลบ = ต้องผ่าน RPC redeem_customer_credit เท่านั้น; adjustment = admin)
DROP POLICY IF EXISTS ccl_staff_rw ON public.customer_credit_ledger;
CREATE POLICY ccl_staff_rw ON public.customer_credit_ledger
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (
    public.is_admin()
    OR (amount > 0 AND source_type IN ('refund_credit', 'refund_exchange'))
  );

-- 3-B) RESTRICTIVE: ปิด customer OTP ทั้งอ่าน/เขียน (ตารางใหม่ ไม่อยู่ใน loop phase505 → ต้องเพิ่มเอง)
DROP POLICY IF EXISTS ccl_deny_customer ON public.customer_credit_ledger;
CREATE POLICY ccl_deny_customer ON public.customer_credit_ledger
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT COALESCE(public.is_customer_role(), false))
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false));

-- =====================================================================
-- STEP 4 - RPC ใช้เครดิต (atomic, กันใช้เกิน/หลายเครื่อง). ยังไม่มี caller ใน 517a — 517b จะเรียก
-- =====================================================================
CREATE OR REPLACE FUNCTION public.redeem_customer_credit(
  p_customer_id bigint,
  p_source_key  text,
  p_amount      numeric,
  p_note        text DEFAULT NULL
) RETURNS public.customer_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.customer_credit_ledger;
  v_balance  numeric;
  v_row      public.customer_credit_ledger;
BEGIN
  -- validate
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'redeem_customer_credit: customer_id required' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'redeem_customer_credit: amount must be > 0 (got %)', p_amount USING ERRCODE = '23514';
  END IF;

  -- serialize ต่อ "ลูกค้า 1 คน" (ต่างคนไม่บล็อกกัน) — กัน race หลายเครื่องใช้เครดิตพร้อมกัน
  PERFORM pg_advisory_xact_lock(hashtextextended('ccl:' || p_customer_id::text, 0));

  -- idempotency: ถ้าเคย redeem ด้วย key นี้แล้ว คืน row เดิม (replay-safe) — เช็คใต้ lock
  IF p_source_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.customer_credit_ledger
    WHERE source_type = 'sale_credit_use' AND source_key = p_source_key
    LIMIT 1;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- balance ปัจจุบัน (อ่านใต้ lock = authoritative; SECURITY DEFINER ให้ SUM เห็นทุก row ไม่ถูก RLS บัง)
  SELECT COALESCE(sum(amount), 0) INTO v_balance
  FROM public.customer_credit_ledger
  WHERE customer_id = p_customer_id;

  IF v_balance < p_amount - 0.01 THEN
    RAISE EXCEPTION 'redeem_customer_credit: insufficient credit (balance=%, requested=%)', v_balance, p_amount
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.customer_credit_ledger
    (customer_id, source_type, source_id, source_key, amount, note, created_by)
  VALUES
    (p_customer_id, 'sale_credit_use', NULL, p_source_key, -p_amount, p_note, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_customer_credit(bigint, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.redeem_customer_credit(bigint, text, numeric, text) TO authenticated;

-- =====================================================================
-- STEP 5 - backfill เครดิตจาก refund credit/exchange ที่มี customer_id (idempotent)
--   ลง +amount, source_type ตาม method, source_id = refunds.id → กันซ้ำด้วย uq_ccl_source
-- =====================================================================
INSERT INTO public.customer_credit_ledger (customer_id, source_type, source_id, amount, note, created_at)
SELECT
  r.customer_id,
  CASE WHEN (r.refund_method ILIKE '%exchange%' OR r.refund_method ILIKE '%เปลี่ยน%')
       THEN 'refund_exchange' ELSE 'refund_credit' END,
  r.id,
  r.refund_amount,
  'backfill 517a: เครดิตจากการคืน ' || COALESCE(r.refund_no, r.id::text),
  COALESCE(r.created_at, now())
FROM public.refunds r
WHERE (r.refund_method ILIKE '%credit%' OR r.refund_method ILIKE '%เครดิต%'
       OR r.refund_method ILIKE '%exchange%' OR r.refund_method ILIKE '%เปลี่ยน%')
  AND r.customer_id IS NOT NULL
  AND r.refund_amount > 0
ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING;

-- =====================================================================
-- STEP 6 - verify หลัง apply
-- =====================================================================
-- balance ต่อลูกค้า (ควร >= 0 ทุกคน หลัง backfill)
SELECT customer_id, sum(amount) AS credit_balance
FROM public.customer_credit_ledger
GROUP BY customer_id
ORDER BY credit_balance DESC;

-- reconcile: SUM(ledger ทั้งระบบ) ควรใกล้ net Cr 2180 จาก JV (STEP 0-D)
--   (อาจต่างได้ถ้า refund บางใบไม่มี customer_id — ดู STEP 0-B)
SELECT COALESCE(sum(amount), 0) AS ledger_total FROM public.customer_credit_ledger;

-- reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
