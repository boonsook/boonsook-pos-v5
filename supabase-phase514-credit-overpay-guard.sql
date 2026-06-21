-- ═══════════════════════════════════════════════════════════
--  Phase 514 — Credit over-pay GUARD (server-side · audit S3)
--
--  ปิดช่อง: credit_payments เดิมกัน over-pay แค่ฝั่ง client
--  (modules/credit_tracker.js:412 `amount > sale._due + 0.01`).
--  race / direct REST API / หลายเครื่องจ่ายพร้อมกัน → SUM(credit_payments.amount)
--  เกิน sales.total_amount → credit_paid_amount / AR เพี้ยน (ยอดค้างติดลบ / ผี).
--
--  BEFORE INSERT OR UPDATE OF amount, sale_id บน public.credit_payments:
--    - reject NEW.amount <= 0
--    - LOCK sales row (FOR UPDATE) → serialize จ่ายพร้อมกัน 2 เครื่อง
--      (เครื่องที่ 2 รอ lock → เห็นยอดที่เครื่องแรก commit แล้วใน SUM)
--    - reject ถ้า sale ไม่มี หรือ is_credit ไม่ใช่ true
--    - reject ถ้า COALESCE(SUM(amount เดิม),0) + NEW.amount > total_amount + 0.01
--      (exclude NEW.id ตอน UPDATE)
--    - ไม่ auto-clamp / ไม่แก้ NEW.amount เงียบ ๆ
--
--  Defense-in-depth ทับ client guard (mirror trg_guard_refunds_insert 92.61b /
--  trg_guard_payroll_double_pay 433). ทำงานกับ "ทุก role" — จ่ายเกินคือผิดเสมอ.
--  ★ SECURITY DEFINER: ให้ SUM(credit_payments) เห็น "ทุก row" จริง ไม่ถูก RLS
--    บังหน้าจน undercount = guard bypass (money guard ต้อง authoritative).
--
--  ขอบเขต (additive only):
--    - ไม่ลบ/แก้ RLS policy เดิม (auth_all_credit_payments ยังอยู่)
--    - ไม่แตะ COA / account_mapping / JV / refund / stock / dashboard
--    - ไม่แก้ข้อมูลย้อนหลัง (guard กันเพิ่มเท่านั้น ไม่ลบ over-paid เก่า)
--
--  How to run: Supabase SQL Editor → STEP0 inspect → STEP1 apply → STEP2–4 verify/smoke
--  Re-run safe: CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  STEP0 — inspect ก่อน apply (read-only) — รันก่อน แล้วดูผล
-- ═══════════════════════════════════════════════════════════
-- (a) ★ credit_payments ที่ผูกกับ sale ซึ่ง is_credit ไม่ใช่ true (หรือ sale หาย) —
--     หลัง apply การ INSERT/UPDATE amount ของบิลพวกนี้จะถูก reject.
--     ควร = 0 row ก่อน apply; ถ้ามี → owner แก้ is_credit ให้ถูกก่อน หรือทบทวน
-- SELECT cp.id, cp.sale_id, cp.amount, s.is_credit, s.total_amount
-- FROM public.credit_payments cp
-- LEFT JOIN public.sales s ON s.id = cp.sale_id
-- WHERE s.id IS NULL OR s.is_credit IS NOT TRUE
-- ORDER BY cp.sale_id;

-- (b) sale ที่ "ปัจจุบัน" จ่ายเกินยอดอยู่แล้ว (SUM payments > total) — guard ไม่ลบของเก่า
--     แค่กันเพิ่ม; ดูเพื่อ owner รู้สถานะ (ถ้ามี = บั๊กเดิมเคยรั่วจริง)
-- SELECT cp.sale_id, s.total_amount, SUM(cp.amount) AS paid
-- FROM public.credit_payments cp JOIN public.sales s ON s.id = cp.sale_id
-- GROUP BY cp.sale_id, s.total_amount
-- HAVING SUM(cp.amount) > s.total_amount + 0.01
-- ORDER BY cp.sale_id;


-- ═══════════════════════════════════════════════════════════
--  STEP1 — Guard function
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_credit_payment_overpay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total       numeric;
  v_is_credit   boolean;
  v_prior_paid  numeric;
BEGIN
  -- 1) จำนวนเงินต้องเป็นบวก
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'credit payment amount must be > 0 (got %)', NEW.amount
      USING ERRCODE = '23514';  -- check_violation
  END IF;

  -- 2) ต้องมี sale_id
  IF NEW.sale_id IS NULL THEN
    RAISE EXCEPTION 'credit payment requires sale_id'
      USING ERRCODE = '23514';
  END IF;

  -- 3) LOCK sales row → serialize concurrent payments (กันจ่าย 2 เครื่องผ่านพร้อมกัน)
  SELECT s.total_amount, s.is_credit
    INTO v_total, v_is_credit
  FROM public.sales s
  WHERE s.id = NEW.sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit payment references missing sale (sale_id=%)', NEW.sale_id
      USING ERRCODE = '23514';
  END IF;

  IF v_is_credit IS NOT TRUE THEN
    RAISE EXCEPTION 'credit payment on non-credit sale (sale_id=%)', NEW.sale_id
      USING ERRCODE = '23514';
  END IF;

  -- 4) ยอดจ่ายเดิมของบิลนี้ (exclude row ปัจจุบันตอน UPDATE; INSERT = no-op exclude)
  SELECT COALESCE(SUM(cp.amount), 0)
    INTO v_prior_paid
  FROM public.credit_payments cp
  WHERE cp.sale_id = NEW.sale_id
    AND cp.id IS DISTINCT FROM NEW.id;

  -- 5) reject overpay — ไม่ auto-clamp / ไม่แก้ NEW.amount เงียบ ๆ
  IF v_prior_paid + NEW.amount > COALESCE(v_total, 0) + 0.01 THEN
    RAISE EXCEPTION
      'credit payment exceeds outstanding balance (sale_id=%, total=%, already_paid=%, requested=%)',
      NEW.sale_id, v_total, v_prior_paid, NEW.amount
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════
--  STEP1b — Trigger
-- ═══════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_guard_credit_payment_overpay ON public.credit_payments;
CREATE TRIGGER trg_guard_credit_payment_overpay
  BEFORE INSERT OR UPDATE OF amount, sale_id ON public.credit_payments
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_credit_payment_overpay();


-- ═══════════════════════════════════════════════════════════
--  STEP1c — reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  STEP2 — VERIFY (รันหลัง apply)
-- ═══════════════════════════════════════════════════════════
-- (a) Trigger ต้องมี + enabled
-- SELECT tgname, tgenabled FROM pg_trigger
-- WHERE tgrelid = 'public.credit_payments'::regclass AND NOT tgisinternal;
-- (b) Function ต้องมี
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = '_guard_credit_payment_overpay';

-- ═══════════════════════════════════════════════════════════
--  STEP3 — NEGATIVE smoke (จ่ายเกินยอดค้าง → ต้อง ERROR) — แทน <SALE_ID>
--    เลือก credit sale จริงที่มียอดค้าง; ลอง insert เกิน total มาก ๆ
--    คาดหวัง: ERROR 'credit payment exceeds outstanding balance ...' + ไม่มี row เพิ่ม
-- ═══════════════════════════════════════════════════════════
-- INSERT INTO public.credit_payments (sale_id, amount, payment_method, note)
-- VALUES (<SALE_ID>, 999999999, 'cash', 'SMOKE-OVERPAY');
--   → ต้อง ERROR. ตรวจ credit_paid_amount ของ sale ไม่ขยับ:
-- SELECT id, total_amount, credit_paid_amount FROM public.sales WHERE id = <SALE_ID>;

-- ═══════════════════════════════════════════════════════════
--  STEP4 — NORMAL smoke (จ่ายไม่เกิน → ผ่านตาม flow เดิม) — แทน <SALE_ID> + <AMT>
--    <AMT> = ยอดน้อย ๆ ที่ไม่เกินยอดค้าง; ผ่านแล้วลบ row ทดสอบทิ้ง
-- ═══════════════════════════════════════════════════════════
-- INSERT INTO public.credit_payments (sale_id, amount, payment_method, note)
-- VALUES (<SALE_ID>, <AMT>, 'cash', 'SMOKE-OK');
-- DELETE FROM public.credit_payments WHERE note = 'SMOKE-OK' AND sale_id = <SALE_ID>;
