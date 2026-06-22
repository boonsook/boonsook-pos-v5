-- Phase 517b-2 / build 520 — checkout idempotency key + customer-credit-use backend
-- Owner-run SQL (Supabase SQL Editor). Idempotent. รันทีละ STEP, ตรวจ STEP0 ก่อน apply.
--
-- บริบท:
--   เตรียม "ใช้เครดิตลูกค้า 2180 ตอนขายใหม่" (consumption) — backend เท่านั้น, UI ยังปิด (#4ก)
--   จน Phase 517b-3 (JV Dr2180 split) live (กันงบ 2180 ≠ ledger ระหว่างทาง).
--   reviewer addendum:
--     #1 checkout_key idempotency กัน double-sale/double-redeem (re-click/2 เครื่อง ms เดียว)
--     #2 release RPC idempotent (กัน double-release)
--   foundation 517a มีแล้ว: customer_credit_ledger + redeem_customer_credit (advisory lock + 23514).

-- =====================================================================
-- STEP 0 — INSPECT (ไม่เปลี่ยนข้อมูล). ผิดคาด → STOP
-- =====================================================================
-- 0-A) sales ยังไม่มี checkout_key / credit_used_amount (จะเพิ่ม)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='sales' AND column_name IN ('checkout_key','credit_used_amount');

-- 0-B) ไม่มี checkout_key ซ้ำในของเก่า (ควร 0 — ยังไม่มีคอลัมน์ = ข้ามได้)
-- (รันหลัง STEP1 ก็ได้) ; ดูว่ามี order_no ซ้ำไหมเพื่อ sanity
SELECT count(*) AS sales_rows FROM public.sales;

-- 0-C) ledger balance ปัจจุบันต่อ customer (เทียบหลัง smoke)
SELECT customer_id, sum(amount) AS bal FROM public.customer_credit_ledger GROUP BY customer_id ORDER BY bal DESC;

-- =====================================================================
-- STEP 1 — ALTER sales: checkout_key (idempotency) + credit_used_amount
-- =====================================================================
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS checkout_key text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS credit_used_amount numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sales.checkout_key IS
  'Phase 520: idempotency key ต่อ checkout intent (กัน double-sale จาก re-click/2 เครื่อง). UNIQUE partial.';
COMMENT ON COLUMN public.sales.credit_used_amount IS
  'Phase 520: ยอดเครดิตลูกค้า (2180) ที่ใช้หักบิลนี้ (0=ไม่ใช้). cash-in reports หักค่านี้; revenue=total_amount เต็ม.';

-- partial unique: legacy rows (checkout_key NULL) ไม่ชนกัน; บิลใหม่ห้ามซ้ำ key
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_checkout_key
  ON public.sales (checkout_key) WHERE checkout_key IS NOT NULL;

-- =====================================================================
-- STEP 2 — release_customer_credit RPC (compensation, idempotent)
--   จับคู่ redeem↔release ด้วย source_key เดียวกัน (= checkout_key) ต่อ intent
-- =====================================================================
CREATE OR REPLACE FUNCTION public.release_customer_credit(p_source_key text)
RETURNS public.customer_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redeem   public.customer_credit_ledger;
  v_existing public.customer_credit_ledger;
  v_row      public.customer_credit_ledger;
BEGIN
  IF p_source_key IS NULL THEN
    RAISE EXCEPTION 'release_customer_credit: source_key required' USING ERRCODE = '23514';
  END IF;

  -- หา redeem (sale_credit_use) ของ intent นี้
  SELECT * INTO v_redeem
  FROM public.customer_credit_ledger
  WHERE source_type = 'sale_credit_use' AND source_key = p_source_key
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;  -- ไม่เคย redeem ด้วย key นี้ → no-op (ไม่มีอะไรให้คืน)
  END IF;

  -- serialize ต่อลูกค้า (mirror redeem) — กัน race release/redeem พร้อมกัน
  PERFORM pg_advisory_xact_lock(hashtextextended('ccl:' || v_redeem.customer_id::text, 0));

  -- idempotent: เคย release แล้ว → คืน row เดิม (กัน double-release)
  SELECT * INTO v_existing
  FROM public.customer_credit_ledger
  WHERE source_type = 'sale_credit_release' AND source_key = p_source_key
  LIMIT 1;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- คืนเครดิต = +amount (redeem.amount เป็นลบ → -(-x)=+x)
  INSERT INTO public.customer_credit_ledger
    (customer_id, source_type, source_key, amount, note, created_by)
  VALUES
    (v_redeem.customer_id, 'sale_credit_release', p_source_key, -v_redeem.amount,
     'release credit (checkout failed): ' || p_source_key, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_customer_credit(text) FROM public;
GRANT EXECUTE ON FUNCTION public.release_customer_credit(text) TO authenticated;

-- =====================================================================
-- STEP 3 — reload PostgREST schema cache
-- =====================================================================
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- STEP 4 — smoke (owner, ใช้ test data ก่อน 1 ก.ค. — ลบทิ้งได้)
-- =====================================================================
-- 4-A) double-sale กันซ้ำ: insert 2 บิล checkout_key เดียว → ใบที่ 2 ต้อง ERROR 23505
--   INSERT INTO public.sales (order_no, customer_name, payment_method, total_amount, checkout_key)
--     VALUES ('SMK-1','t','เงินสด',1,'smoke-key-1');
--   INSERT INTO public.sales (order_no, customer_name, payment_method, total_amount, checkout_key)
--     VALUES ('SMK-2','t','เงินสด',1,'smoke-key-1');  -- คาด ERROR duplicate key (23505)
-- 4-B) redeem 2× source_key เดียว → ตัดครั้งเดียว (row เดิม):
--   SELECT public.redeem_customer_credit(<cust_id>, 'smoke-key-1', 10, 'smoke');  -- ledger -10
--   SELECT public.redeem_customer_credit(<cust_id>, 'smoke-key-1', 10, 'smoke');  -- คืน row เดิม ไม่ตัดซ้ำ
-- 4-C) release: 1× คืน +10 ; 2× idempotent (row เดิม ไม่คืนซ้ำ):
--   SELECT public.release_customer_credit('smoke-key-1');  -- +10
--   SELECT public.release_customer_credit('smoke-key-1');  -- row เดิม
--   → SELECT sum(amount) FROM customer_credit_ledger WHERE source_key='smoke-key-1';  -- = 0 (สุทธิ)
-- 4-D) cleanup: DELETE smoke rows.
