-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 606-b1 (S4.1d) — SERVICE PAYMENT GUARDS + APPEND-ONLY REVERSAL
--  ต่อยอดจาก supabase-phase606a-service-finance-foundation.sql (applied 2026-07-14)
--
--  ทำอะไร (additive ล้วน · ยังเปิด flow v2 ไม่ได้ — activation อยู่ที่ 606-b3):
--    1) record_service_payment_v2 (CREATE OR REPLACE) — เพิ่ม gate:
--       ★ รับชำระได้ก็ต่อเมื่อ "มี JV รับรู้รายได้ (approved) ของงานนี้แล้ว" เท่านั้น
--         (เดิมดูแค่ status/closed_at → รับเงินเข้าได้ทั้งที่ยังไม่มีลูกหนี้ให้ล้าง = Cr 1200 ลอย)
--    2) freeze งาน flow v2 ที่ส่งมอบแล้ว: ห้ามแก้ total_cost / job_type
--       (มีลูกหนี้/มีการรับชำระแล้ว → void+repost ไม่ได้ ต้องออกเอกสารปรับปรุงแทน)
--    3) service_payment_reversals — ledger แก้รายการรับชำระผิดแบบ **append-only**
--       + RPC reverse_service_payment_v2 (admin · idempotent · reverse เกินยอดที่รับจริงไม่ได้)
--
--  ไม่ทำอะไร: ไม่เปิด finance_flow_version = 2 · ไม่โพสต์ JV · ไม่แตะ 6 งาน legacy NO_JV
--             ไม่แตะ journal_entries/journal_lines · ไม่แตะ mapping เดิม (debit/credit/transfer)
--
--  วิธีใช้ (owner):  STEP 0 inspect → รันไฟล์นี้ → VERIFY (count-only)
--  ⚠️ ห้าม mark applied ใน DB_MIGRATIONS_APPLIED.md จนกว่าผล VERIFY จะผ่านครบ
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — READ-ONLY INSPECT (รันก่อน; ไม่เปลี่ยนข้อมูล)
-- ───────────────────────────────────────────────────────────────────────────
/*
-- 0.1 foundation 606-a ต้องติดตั้งแล้ว
SELECT to_regclass('public.service_payments') AS ledger,
       (SELECT count(*) FROM public.service_payments) AS ledger_rows,
       (SELECT count(*) FROM public.service_jobs WHERE finance_flow_version = 2) AS flow_v2_jobs;

-- 0.2 RPC เดิม
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('record_service_payment_v2','reverse_service_payment_v2');

-- 0.3 journal_entries: คอลัมน์ที่ gate ใช้ (source_table/source_id/status)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='journal_entries' AND column_name IN ('source_table','source_id','status');

-- 0.4 counts ที่ต้องไม่ขยับ
SELECT (SELECT count(*) FROM public.journal_entries) AS je, (SELECT count(*) FROM public.journal_lines) AS jl;
*/

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) PREFLIGHT — ต้องมี foundation 606-a ครบก่อน (ผิด = rollback ทั้งไฟล์)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.service_payments') IS NULL THEN
    RAISE EXCEPTION 'ยังไม่ได้ติดตั้ง foundation 606-a (ไม่มี service_payments)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.service_jobs'::regclass
                   AND attname='finance_flow_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ยังไม่ได้ติดตั้ง foundation 606-a (ไม่มี service_jobs.finance_flow_version)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='record_service_payment_v2') THEN
    RAISE EXCEPTION 'ไม่พบ RPC record_service_payment_v2 (foundation 606-a)';
  END IF;
  -- gate ใหม่พึ่ง journal_entries.source_table/source_id/status
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='journal_entries'
         AND column_name IN ('source_table','source_id','status')) <> 3 THEN
    RAISE EXCEPTION 'journal_entries ขาดคอลัมน์ source_table/source_id/status — gate รับชำระทำไม่ได้';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) helpers: mapping key ตามประเภทงาน + "มี JV รับรู้รายได้ที่ถูกต้องจริง" หรือยัง
--    ★ Blocking 1: approved header อย่างเดียว **ไม่พอ** — header ที่ไม่มี lines / บัญชีผิด / ยอดผิด
--      ต้องคืน false. ความจริงของ "ส่งมอบแล้วและลงบัญชีถูก" = header + lines + บัญชี + ยอด ครบชุด
-- ───────────────────────────────────────────────────────────────────────────
-- job_type → account_mapping key (mirror ของ SERVICE_JOB_TYPE_KEY_MAP ใน auto_post.js — มี drift guard)
CREATE OR REPLACE FUNCTION public.service_mapping_key_for_job_type(p_job_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_job_type,''))
    WHEN 'ac'            THEN 'service_install_ac'
    WHEN 'install_ac'    THEN 'service_install_ac'
    WHEN 'repair_ac'     THEN 'service_repair_ac'
    WHEN 'clean_ac'      THEN 'service_clean_ac'
    WHEN 'move_ac'       THEN 'service_move_ac'
    WHEN 'satellite'     THEN 'service_satellite'
    WHEN 'repair_fridge' THEN 'service_repair_fridge'
    WHEN 'repair_washer' THEN 'service_repair_washer'
    WHEN 'cctv'          THEN 'service_cctv'
    WHEN 'repair_tv'     THEN 'service_repair_tv'
    WHEN 'solar'         THEN 'service_solar'
    WHEN 'other'         THEN 'service_other'
    ELSE 'service_other'
  END;
$$;

CREATE OR REPLACE FUNCTION public.service_job_has_recognition_jv(p_job_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job   public.service_jobs%ROWTYPE;
  v_total NUMERIC(14,2);
  v_map   public.account_mapping%ROWTYPE;
  v_entry RECORD;
  v_dr    NUMERIC(14,2);
  v_cr    NUMERIC(14,2);
  v_sum_d NUMERIC(14,2);
  v_sum_c NUMERIC(14,2);
BEGIN
  -- ★ should-fix: อ่านสถานะบัญชีของงานคนอื่นได้เฉพาะ admin/accountant (fail-closed)
  IF NOT COALESCE(public.is_accountant(), false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ตรวจสถานะบัญชีของงานบริการ' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.service_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_job.total_cost IS NULL
     OR lower(v_job.total_cost::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RETURN false;
  END IF;
  v_total := round(v_job.total_cost, 2);
  IF v_total <= 0 THEN RETURN false; END IF;

  SELECT * INTO v_map FROM public.account_mapping
   WHERE mapping_key = public.service_mapping_key_for_job_type(v_job.job_type) AND is_active;
  IF NOT FOUND OR v_map.recognition_debit_code IS NULL OR v_map.credit_account_code IS NULL THEN
    RETURN false;
  END IF;

  SELECT je.id, je.total_debit, je.total_credit INTO v_entry
    FROM public.journal_entries je
   WHERE je.source_table = 'service_jobs'
     AND je.source_id    = p_job_id
     AND lower(coalesce(je.status,'')) = 'approved'
   ORDER BY je.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  -- lines ต้องมีจริง + บาลานซ์ + ตรง header + ตรงยอดงาน (orphan header = false)
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0) INTO v_sum_d, v_sum_c
    FROM public.journal_lines WHERE entry_id = v_entry.id;
  IF v_sum_d = 0 AND v_sum_c = 0 THEN RETURN false; END IF;                      -- header ไม่มี lines
  IF round(v_sum_d,2) <> round(v_sum_c,2) THEN RETURN false; END IF;             -- ไม่บาลานซ์
  IF round(v_sum_d,2) <> round(coalesce(v_entry.total_debit,0),2) THEN RETURN false; END IF;  -- lines ≠ header
  IF round(v_sum_d,2) <> v_total THEN RETURN false; END IF;                      -- ≠ ยอดงาน

  -- Dr ต้องเป็นบัญชีลูกหนี้ตาม mapping (recognition_debit_code) ยอดเต็ม
  SELECT coalesce(sum(debit),0) INTO v_dr FROM public.journal_lines
   WHERE entry_id = v_entry.id AND account_code = v_map.recognition_debit_code;
  IF round(v_dr,2) <> v_total THEN RETURN false; END IF;

  -- Cr ต้องเป็นบัญชีรายได้ตาม mapping ยอดเต็ม
  SELECT coalesce(sum(credit),0) INTO v_cr FROM public.journal_lines
   WHERE entry_id = v_entry.id AND account_code = v_map.credit_account_code;
  IF round(v_cr,2) <> v_total THEN RETURN false; END IF;

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.service_job_has_recognition_jv(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_job_has_recognition_jv(BIGINT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) freeze งาน flow v2 ที่ "มีผลทางบัญชีแล้ว" — ★ Blocking 4: อิง accounting truth ไม่ใช่ status
--    trigger นี้พึ่ง **ข้อเท็จจริง**: มี approved recognition JV แล้ว หรือมีเงินใน ledger/มีการกลับรายการ
--    → ห้ามแก้ total_cost / job_type **ไม่ว่าสถานะปัจจุบันจะเป็นอะไร** (ย้อน status เป็น done ก่อนแล้ว
--    ค่อยแก้ยอด = ทางลัดที่ต้องปิด) และห้ามย้อน delivered/closed กลับเป็น done/progress/pending
--    (ต้องใช้ adjustment/reversal workflow แทน)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_service_job_v2_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recognized boolean := false;
  v_has_money  boolean := false;
BEGIN
  IF coalesce(OLD.finance_flow_version, 1) <> 2 THEN
    RETURN NEW;                                   -- legacy v1 = พฤติกรรมเดิม (ไม่แตะ)
  END IF;

  -- มี JV รับรู้รายได้ (approved + lines + บัญชี/ยอดถูก) แล้วหรือยัง
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = OLD.id
       AND lower(coalesce(je.status,'')) = 'approved'
  ) INTO v_recognized;

  -- มีเงินรับ/กลับรายการใน ledger แล้วหรือยัง
  SELECT EXISTS (
    SELECT 1 FROM public.service_payments p WHERE p.service_job_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM public.service_payment_reversals r
      JOIN public.service_payments p2 ON p2.id = r.payment_id
     WHERE p2.service_job_id = OLD.id
  ) INTO v_has_money;

  IF v_recognized OR v_has_money THEN
    IF NEW.total_cost IS DISTINCT FROM OLD.total_cost THEN
      RAISE EXCEPTION 'งานนี้ลงบัญชี/รับเงินแล้ว — แก้ยอดเงินไม่ได้ (ต้องออกเอกสารปรับปรุง)' USING ERRCODE = '42501';
    END IF;
    IF NEW.job_type IS DISTINCT FROM OLD.job_type THEN
      RAISE EXCEPTION 'งานนี้ลงบัญชี/รับเงินแล้ว — เปลี่ยนประเภทงานไม่ได้ (บัญชีรายได้ผูกกับประเภทงาน)' USING ERRCODE = '42501';
    END IF;
    -- ห้ามย้อนสถานะกลับก่อนส่งมอบ (จะทำให้ JV/ลูกหนี้ลอยโดยไม่มีเหตุการณ์รองรับ)
    IF lower(coalesce(OLD.status,'')) IN ('delivered','closed')
       AND lower(coalesce(NEW.status,'')) IN ('done','progress','pending') THEN
      RAISE EXCEPTION 'ย้อนสถานะงานที่ลงบัญชีแล้วไม่ได้ (ต้องกลับรายการ/ปรับปรุงบัญชีก่อน)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_job_v2_freeze ON public.service_jobs;
CREATE TRIGGER trg_service_job_v2_freeze
  BEFORE UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_job_v2_freeze();

-- 4) service_payment_reversals — append-only (แก้รายการรับชำระผิด "ด้วยการกลับรายการ")
--    ห้าม UPDATE/DELETE service_payments ตลอดกาล — ledger ต้อง audit ได้
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_payment_reversals (
  id               BIGSERIAL PRIMARY KEY,
  payment_id       BIGINT NOT NULL REFERENCES public.service_payments(id) ON DELETE RESTRICT,
  amount           NUMERIC(14,2) NOT NULL
                     CONSTRAINT chk_service_payment_reversals_amount_finite
                     CHECK (amount > 0 AND lower(amount::text) NOT IN ('nan','infinity','-infinity')),
  reason           TEXT NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key  UUID NOT NULL,
  reversed_at      TIMESTAMPTZ NOT NULL,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_payment_reversals_idem UNIQUE (payment_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_service_payment_reversals_payment ON public.service_payment_reversals(payment_id);

ALTER TABLE public.service_payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_payment_reversals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_payment_reversals_select_accountant ON public.service_payment_reversals;
CREATE POLICY service_payment_reversals_select_accountant
  ON public.service_payment_reversals FOR SELECT TO authenticated
  USING (COALESCE(public.is_accountant(), false));           -- fail-closed
REVOKE ALL ON public.service_payment_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_payment_reversals TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4b) service_job_paid_total — "รับแล้วสุทธิ" = Σ payments − Σ reversals
--    (ใช้ทั้งใน RPC รับชำระ/กลับรายการ และฝั่ง report)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.service_job_paid_total(p_job_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- ★ should-fix: fail-closed — เฉพาะ admin/accountant เท่านั้นที่อ่านยอดของงานใด ๆ ได้
  SELECT CASE WHEN NOT COALESCE(public.is_accountant(), false) THEN NULL ELSE round(
           coalesce((SELECT sum(p.amount) FROM public.service_payments p
                      WHERE p.service_job_id = p_job_id), 0)
         - coalesce((SELECT sum(r.amount) FROM public.service_payment_reversals r
                      JOIN public.service_payments p2 ON p2.id = r.payment_id
                     WHERE p2.service_job_id = p_job_id), 0)
         , 2) END;
$$;
REVOKE ALL ON FUNCTION public.service_job_paid_total(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_job_paid_total(BIGINT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) record_service_payment_v2 — REPLACE: เพิ่ม gate "ต้องมี recognition JV แล้ว"
--    (ที่เหลือคงสัญญาเดิมจาก 606-a เป๊ะ: authority fail-closed · total_cost finite+>0 ก่อน
--     idempotency · idempotency เทียบ payload ครบ · bank allowlist · overpay exact)
--    ★ ยอดค้าง = total_cost − (รับแล้ว − กลับรายการแล้ว)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_service_payment_v2(
  p_service_job_id  BIGINT,
  p_amount          NUMERIC,
  p_payment_method  TEXT,
  p_paid_at         TIMESTAMPTZ,
  p_idempotency_key UUID,
  p_bank_coa_code   TEXT DEFAULT NULL,
  p_slip_url        TEXT DEFAULT NULL,
  p_note            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job      public.service_jobs%ROWTYPE;
  v_amount   NUMERIC(14,2);
  v_paid     NUMERIC(14,2);
  v_total    NUMERIC(14,2);
  v_existing public.service_payments%ROWTYPE;
  v_row      public.service_payments%ROWTYPE;
  v_method   TEXT;
BEGIN
  -- (1) authority — fail-closed
  IF NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่บันทึกรับชำระได้' USING ERRCODE = '42501';
  END IF;

  -- (2) input normalize/validate
  v_method := lower(btrim(coalesce(p_payment_method, '')));
  IF v_method NOT IN ('cash','transfer') THEN
    RAISE EXCEPTION 'payment_method ต้องเป็น cash หรือ transfer (ไม่ระบุ/ไม่รู้จัก = ปฏิเสธ ห้าม default เป็นเงินสด)'
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR lower(p_amount::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RAISE EXCEPTION 'amount ไม่ใช่ตัวเลขที่ใช้ได้ (NaN/Infinity ถูกปฏิเสธ)' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'amount ต้องมากกว่า 0 หลังปัดเป็นทศนิยม 2 ตำแหน่ง' USING ERRCODE = '22023';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at = 'infinity'::timestamptz OR p_paid_at = '-infinity'::timestamptz THEN
    RAISE EXCEPTION 'paid_at ต้องเป็นเวลาจริง (ห้าม fallback วันสร้างงาน)' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key ต้องระบุ' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'cash' AND p_bank_coa_code IS NOT NULL THEN
    RAISE EXCEPTION 'เงินสดต้องไม่ระบุบัญชีธนาคาร' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'transfer' AND p_bank_coa_code IS NULL THEN
    RAISE EXCEPTION 'โอน/QR ต้องระบุบัญชีธนาคาร (bank_coa_code)' USING ERRCODE = '22023';
  END IF;

  -- (3) lock งาน
  SELECT * INTO v_job FROM public.service_jobs WHERE id = p_service_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบงาน #%', p_service_job_id USING ERRCODE = 'P0002';
  END IF;

  -- (3b) ยอดงานต้องใช้ได้จริง **ก่อน idempotency lookup** (retry ก็ต้องไม่ซ่อนยอดเสีย)
  IF v_job.total_cost IS NULL
     OR lower(v_job.total_cost::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RAISE EXCEPTION 'ยอดงานไม่ใช่ตัวเลขที่ใช้ได้ (null/NaN/Infinity) — รับชำระ/ยืนยันรายการไม่ได้'
      USING ERRCODE = '22023';
  END IF;
  v_total := round(v_job.total_cost, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'ยอดงานไม่ถูกต้อง (%) — รับชำระ/ยืนยันรายการไม่ได้', v_total USING ERRCODE = '22023';
  END IF;

  -- (4) idempotency ก่อน business-state: retry ต้องคืนของเดิมได้ แม้สถานะงานเปลี่ยนไปแล้ว
  SELECT * INTO v_existing FROM public.service_payments
   WHERE service_job_id = p_service_job_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.amount = v_amount
       AND v_existing.payment_method = v_method
       AND v_existing.bank_coa_code IS NOT DISTINCT FROM p_bank_coa_code
       AND v_existing.paid_at = p_paid_at
       AND v_existing.slip_url IS NOT DISTINCT FROM p_slip_url
       AND v_existing.note IS NOT DISTINCT FROM p_note THEN
      SELECT public.service_job_paid_total(p_service_job_id) INTO v_paid;
      RETURN jsonb_build_object(
        'payment_id', v_existing.id, 'inserted', false,
        'paid_total', v_paid,
        'outstanding_after', greatest(v_total - v_paid, 0)
      );
    END IF;
    RAISE EXCEPTION 'idempotency_key นี้ถูกใช้กับข้อมูลชุดอื่นแล้ว — ปฏิเสธ (ไม่มีการเขียน)' USING ERRCODE = '23505';
  END IF;

  -- (4b) bank allowlist — เฉพาะตอนจะ insert ใหม่ (asset อย่างเดียวไม่พอ: 1170/1200/1300 ก็ asset)
  IF v_method = 'transfer' AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE code = p_bank_coa_code AND is_active AND type = 'asset' AND code ~ '^11[3-6][0-9]$'
  ) THEN
    RAISE EXCEPTION 'bank_coa_code % ไม่ใช่บัญชีธนาคารที่รับโอนได้ (ต้องเป็น asset active รหัส 1130-1169)', p_bank_coa_code
      USING ERRCODE = '23503';
  END IF;

  -- (5) business-state (เฉพาะกรณีจะ insert ใหม่)
  IF coalesce(v_job.source_kind, 'service') <> 'service' THEN
    RAISE EXCEPTION 'งานนี้เป็น % — รับชำระผ่าน ledger นี้ไม่ได้', v_job.source_kind USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.finance_flow_version, 1) <> 2 THEN
    RAISE EXCEPTION 'งานนี้ยังเป็น finance flow v% — ต้อง activate flow v2 (Phase 606-b3) ก่อน',
      coalesce(v_job.finance_flow_version, 1) USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.note,'') LIKE '%[ลบแล้ว]%' THEN
    RAISE EXCEPTION 'งานนี้ถูกลบแล้ว — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;
  -- ★ Phase 606-b1: ความจริงของ "ส่งมอบแล้ว" = **มี JV รับรู้รายได้ (approved) จริง**
  --   ไม่ใช่ status/closed_at (แก้ด้วยมือได้) — ไม่มีลูกหนี้ (Dr 1200) ก็ไม่มีอะไรให้ล้างด้วยเงินที่รับ
  IF NOT public.service_job_has_recognition_jv(p_service_job_id) THEN
    RAISE EXCEPTION 'งานนี้ยังไม่มีรายการบัญชีรับรู้รายได้ (ยังไม่ส่งมอบ/ยังไม่ลงบัญชี) — รับชำระไม่ได้'
      USING ERRCODE = '22023';
  END IF;

  -- (6) over-pay guard — exact (หักยอดที่กลับรายการแล้วออกจาก "รับแล้ว")
  SELECT public.service_job_paid_total(p_service_job_id) INTO v_paid;
  IF v_paid + v_amount > v_total THEN
    RAISE EXCEPTION 'รับชำระเกินยอดค้าง (ยอดงาน % · รับแล้ว % · จะรับเพิ่ม %)', v_total, v_paid, v_amount
      USING ERRCODE = '23514';
  END IF;

  -- (7) insert ledger (append-only) — ไม่แตะ journal / ไม่ PATCH service_jobs (ห้าม auto เปลี่ยน status)
  INSERT INTO public.service_payments
    (service_job_id, amount, payment_method, bank_coa_code, paid_at, idempotency_key, slip_url, note, created_by)
  VALUES
    (p_service_job_id, v_amount, v_method, p_bank_coa_code, p_paid_at, p_idempotency_key, p_slip_url, p_note, auth.uid())
  RETURNING * INTO v_row;

  v_paid := v_paid + v_amount;
  RETURN jsonb_build_object(
    'payment_id', v_row.id, 'inserted', true,
    'paid_total', v_paid,
    'outstanding_after', greatest(v_total - v_paid, 0)
  );
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6) reverse_service_payment_v2 — กลับรายการรับชำระผิด (append-only · admin · idempotent)
--    ★ ไม่ UPDATE/DELETE service_payments · reverse เกินยอดที่แถวนั้นรับจริงไม่ได้
--    ★ JV กลับรายการ โพสต์ฝั่ง client ด้วย canonical writer (source_table='service_payment_reversals')
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_service_payment_v2(
  p_payment_id      BIGINT,
  p_amount          NUMERIC,
  p_reason          TEXT,
  p_reversed_at     TIMESTAMPTZ,
  p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay      public.service_payments%ROWTYPE;
  v_amount   NUMERIC(14,2);
  v_reason   TEXT;
  v_reversed NUMERIC(14,2);
  v_existing public.service_payment_reversals%ROWTYPE;
  v_row      public.service_payment_reversals%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่กลับรายการรับชำระได้' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR lower(p_amount::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RAISE EXCEPTION 'amount ไม่ใช่ตัวเลขที่ใช้ได้ (NaN/Infinity ถูกปฏิเสธ)' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'amount ต้องมากกว่า 0' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลการกลับรายการ' USING ERRCODE = '22023';
  END IF;
  v_reason := btrim(p_reason);      -- ★ normalize ครั้งเดียว → ใช้ค่าเดียวกันทั้ง compare และ insert
                                    --   (ไม่งั้น retry ด้วย reason ที่มีช่องว่างต่างกัน = 23505 ทั้งที่ควร idempotent)
  IF p_reversed_at IS NULL OR p_reversed_at = 'infinity'::timestamptz OR p_reversed_at = '-infinity'::timestamptz THEN
    RAISE EXCEPTION 'reversed_at ต้องเป็นเวลาจริง' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key ต้องระบุ' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pay FROM public.service_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการรับชำระ #%', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  -- idempotency ก่อน business-state (retry ต้องคืนของเดิม)
  SELECT * INTO v_existing FROM public.service_payment_reversals
   WHERE payment_id = p_payment_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.amount = v_amount
       AND v_existing.reason IS NOT DISTINCT FROM v_reason
       AND v_existing.reversed_at = p_reversed_at THEN
      RETURN jsonb_build_object('reversal_id', v_existing.id, 'inserted', false,
                                'paid_total', public.service_job_paid_total(v_pay.service_job_id));
    END IF;
    RAISE EXCEPTION 'idempotency_key นี้ถูกใช้กับข้อมูลชุดอื่นแล้ว — ปฏิเสธ (ไม่มีการเขียน)' USING ERRCODE = '23505';
  END IF;

  -- ★ Blocking 2: กลับรายการได้เฉพาะเมื่องานมี recognition JV ที่ถูกต้องจริง (header+lines+บัญชี+ยอด)
  --   ไม่มี = ไม่มีอะไรให้กลับรายการทางบัญชี → ปฏิเสธ (ไม่มีการเขียน)
  IF NOT public.service_job_has_recognition_jv(v_pay.service_job_id) THEN
    RAISE EXCEPTION 'งานของรายการนี้ยังไม่มีรายการบัญชีรับรู้รายได้ที่ถูกต้อง — กลับรายการไม่ได้'
      USING ERRCODE = '22023';
  END IF;

  -- กลับรายการเกิน "ยอดที่แถวนี้รับจริง" ไม่ได้ (รวมของเดิมที่เคยกลับไปแล้ว)
  SELECT coalesce(sum(amount), 0) INTO v_reversed
    FROM public.service_payment_reversals WHERE payment_id = p_payment_id;
  IF v_reversed + v_amount > round(v_pay.amount, 2) THEN
    RAISE EXCEPTION 'กลับรายการเกินยอดที่รับไว้ (รับ % · กลับแล้ว % · จะกลับเพิ่ม %)',
      round(v_pay.amount,2), v_reversed, v_amount USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.service_payment_reversals
    (payment_id, amount, reason, idempotency_key, reversed_at, created_by)
  VALUES (p_payment_id, v_amount, v_reason, p_idempotency_key, p_reversed_at, auth.uid())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('reversal_id', v_row.id, 'inserted', true,
                            'paid_total', public.service_job_paid_total(v_pay.service_job_id));
END $$;

REVOKE ALL ON FUNCTION public.reverse_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 7) POST-CHECK — ผิดข้อใดข้อหนึ่ง = rollback ทั้งไฟล์
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_flow2 bigint;
  v_rows  bigint;
  v_rev   bigint;
  v_fn    text;
BEGIN
  -- ยังต้อง "เปิดใช้ไม่ได้": ไม่มีงาน flow v2 · ledger ยังว่าง · reversal ยังว่าง
  SELECT count(*) INTO v_flow2 FROM public.service_jobs WHERE finance_flow_version = 2;
  IF v_flow2 <> 0 THEN RAISE EXCEPTION 'พบงาน finance_flow_version=2 % งาน — เฟสนี้ยังห้าม activate', v_flow2; END IF;
  SELECT count(*) INTO v_rows FROM public.service_payments;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'service_payments ต้องยังว่าง (พบ % แถว)', v_rows; END IF;
  SELECT count(*) INTO v_rev FROM public.service_payment_reversals;
  IF v_rev <> 0 THEN RAISE EXCEPTION 'service_payment_reversals ต้องยังว่าง (พบ % แถว)', v_rev; END IF;

  -- RPC/trigger/helper ต้องมีจริง + SECURITY DEFINER + search_path
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reverse_service_payment_v2'
                    AND p.prosecdef AND p.proconfig IS NOT NULL) THEN
    RAISE EXCEPTION 'reverse_service_payment_v2 ต้องเป็น SECURITY DEFINER + search_path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='service_job_paid_total') THEN
    RAISE EXCEPTION 'ไม่พบ service_job_paid_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_service_job_v2_freeze' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'trigger trg_service_job_v2_freeze ต้องมีและ enabled';
  END IF;

  -- gate รับชำระ/กลับรายการ ต้องอ้าง recognition JV จริง (ไม่ใช่ status)
  FOR v_fn IN SELECT unnest(ARRAY['record_service_payment_v2','reverse_service_payment_v2']) LOOP
    IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname=v_fn)
       NOT LIKE '%service_job_has_recognition_jv%' THEN
      RAISE EXCEPTION '% ต้องเช็ค recognition JV ก่อนเขียน ledger', v_fn;
    END IF;
  END LOOP;

  -- ★ Blocking 1: recognition gate ต้องตรวจ **lines** ไม่ใช่แค่ header ที่ approved
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='service_job_has_recognition_jv')
     NOT LIKE '%journal_lines%' THEN
    RAISE EXCEPTION 'service_job_has_recognition_jv ต้องตรวจ journal_lines (header อย่างเดียวไม่พอ)';
  END IF;

  -- ★ Blocking 4: freeze ต้องอิง accounting truth (JV/ledger) ไม่ใช่ status ปัจจุบันอย่างเดียว
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='guard_service_job_v2_freeze')
     NOT LIKE '%service_payments%' THEN
    RAISE EXCEPTION 'guard_service_job_v2_freeze ต้องดูเงินใน ledger ด้วย (ไม่ใช่แค่ status)';
  END IF;

  -- ห้ามมีสิทธิ์เขียนตรงลง ledger/reversal สำหรับ anon/authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name IN ('service_payments','service_payment_reversals')
       AND grantee IN ('anon','authenticated')
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'พบสิทธิ์เขียนตรงลง ledger — ต้องเขียนผ่าน RPC เท่านั้น';
  END IF;

  RAISE NOTICE 'POST-CHECK 606-b1 ผ่านครบ (gate recognition JV · freeze v2 · reversal append-only)';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY (count-only — รันหลัง COMMIT แล้วส่งผลให้ทีม)
-- ═══════════════════════════════════════════════════════════════════════════
/*
-- V1 objects ครบ
SELECT to_regclass('public.service_payment_reversals') AS reversals,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN
           ('record_service_payment_v2','reverse_service_payment_v2','service_job_paid_total','service_job_has_recognition_jv')) AS fns;

-- V2 trigger freeze
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_service_job_v2_freeze';

-- V3 ยังไม่ activate (ต้องเป็น 0 ทั้งสาม)
SELECT (SELECT count(*) FROM public.service_jobs WHERE finance_flow_version=2) AS flow_v2,
       (SELECT count(*) FROM public.service_payments) AS payments,
       (SELECT count(*) FROM public.service_payment_reversals) AS reversals;

-- V4 grants (ต้องไม่มี INSERT/UPDATE/DELETE ให้ anon/authenticated)
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('service_payments','service_payment_reversals')
  AND grantee IN ('anon','authenticated');

-- V5 บัญชีต้องไม่ขยับ (เทียบกับ STEP 0.4)
SELECT (SELECT count(*) FROM public.journal_entries) AS je, (SELECT count(*) FROM public.journal_lines) AS jl;
*/

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK GUIDANCE (additive ล้วน — ถอยได้ตราบใดที่ ledger/reversal ยังว่าง)
-- ═══════════════════════════════════════════════════════════════════════════
/*
BEGIN;
  DROP TRIGGER IF EXISTS trg_service_job_v2_freeze ON public.service_jobs;
  DROP FUNCTION IF EXISTS public.guard_service_job_v2_freeze();
  DROP FUNCTION IF EXISTS public.reverse_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID);
  DROP TABLE IF EXISTS public.service_payment_reversals;      -- ต้องว่างเท่านั้น
  DROP FUNCTION IF EXISTS public.service_job_paid_total(BIGINT);
  DROP FUNCTION IF EXISTS public.service_job_has_recognition_jv(BIGINT);
  -- record_service_payment_v2: กลับไปใช้เวอร์ชันใน supabase-phase606a-service-finance-foundation.sql (§10)
COMMIT;
NOTIFY pgrst, 'reload schema';
*/
