-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 606-b1.1 — SERVICE FINANCE V2 PRE-ACTIVATION HOTFIX (B2)
--  finance_flow_version = 2 ต้อง **immutable** (downgrade 2→1 / 2→NULL = 42501)
--
--  ทำไม: guard_service_job_v2_freeze (606-b1, applied 2026-07-15) freeze
--  total_cost/job_type/status ของงาน v2 ที่มีผลบัญชี — แต่ไม่ได้ล็อก
--  finance_flow_version เอง ขณะที่ guard 606-a ยอมให้ admin เปลี่ยน flow
--  ที่ไม่ใช่ →2 ได้ → admin downgrade 2→1 แล้ว UPDATE ถัดไป freeze ทั้งชุด
--  ไม่ทำงาน (OLD.flow=1 = early return) = bypass ครบวงจร
--
--  ทำอะไร: CREATE OR REPLACE guard_service_job_v2_freeze() เพิ่ม clause เดียว
--  **ก่อน early return** — เนื้อเดิมที่เหลือคงไว้ทุกบรรทัด (verbatim จาก 606-b1):
--    IF OLD.finance_flow_version = 2
--       AND NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version
--    THEN RAISE 42501
--  policy: 2→1 = block · 2→NULL = block · 2→2 = ผ่านไปตรวจ freeze เดิม ·
--          1→2 ยังถูก guard 606-a (trg_service_jobs_metadata_update_guard) ปฏิเสธ
--          จนกว่า activation 606-b3 · การมี/ไม่มี JV/ledger **ไม่เปลี่ยนผล** ของ 2→1
--
--  ไม่ทำอะไร: ไม่แตะไฟล์/objects อื่นของ 606-b1 ที่ applied แล้ว · ไม่แตะ trigger
--  (ตัวเดิมชี้ function ชื่อเดิม — replace body พอ) · ไม่เขียนข้อมูล · ไม่ activate v2
--
--  วิธีใช้ (owner): STEP 0 inspect → รันไฟล์นี้ → VERIFY (count-only + def check)
--  ⚠️ ห้าม mark applied ใน DB_MIGRATIONS_APPLIED.md จนกว่า VERIFY ผ่านครบ
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — READ-ONLY INSPECT (รันก่อน; ไม่เปลี่ยนข้อมูล)
-- ───────────────────────────────────────────────────────────────────────────
/*
-- 0.1 function/trigger 606-b1 ต้องอยู่ครบ
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='guard_service_job_v2_freeze';
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_service_job_v2_freeze' AND NOT tgisinternal;

-- 0.2 counts ที่ต้องไม่ขยับ (จดค่าไว้เทียบกับ VERIFY)
SELECT (SELECT count(*) FROM public.journal_entries)  AS je,
       (SELECT count(*) FROM public.journal_lines)    AS jl,
       (SELECT count(*) FROM public.service_jobs WHERE finance_flow_version=2) AS flow2,
       (SELECT count(*) FROM public.service_payments) AS payments,
       (SELECT count(*) FROM public.service_payment_reversals) AS reversals;
*/

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) PREFLIGHT — ต้องมี 606-b1 ครบก่อน (ผิด = rollback ทั้งไฟล์)
--    + จับ baseline JE/JL เข้า temp table (ห้าม hardcode เลข production)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _hotfix_baseline ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.journal_entries) AS je,
       (SELECT count(*) FROM public.journal_lines)   AS jl;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='guard_service_job_v2_freeze') THEN
    RAISE EXCEPTION 'ยังไม่ได้รัน 606-b1 (ไม่มี guard_service_job_v2_freeze) — hotfix นี้ replace ของเดิมเท่านั้น';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_service_job_v2_freeze' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'trigger trg_service_job_v2_freeze ต้องมีและ enabled ก่อนรัน hotfix';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.service_jobs'::regclass
                   AND attname='finance_flow_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ไม่พบ service_jobs.finance_flow_version (foundation 606-a)';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) REPLACE guard_service_job_v2_freeze — เนื้อเดิม 606-b1 ทุกบรรทัด +
--    clause "flow v2 immutable" เพิ่ม **ก่อน early return** เท่านั้น
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_service_job_v2_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recognized boolean := false;
  v_has_money  boolean := false;
  v_old text := lower(coalesce(OLD.status,''));
  v_new text := lower(coalesce(NEW.status,''));
BEGIN
  -- ★ Phase 606-b1.1 (B2): งานที่เป็น flow v2 แล้ว **เปลี่ยน finance_flow_version ไม่ได้**
  --   (2→1 / 2→NULL = bypass freeze ทั้งชุดใน UPDATE ถัดไป) — ต้องอยู่ก่อน early return
  --   และไม่ขึ้นกับ v_recognized/v_has_money (มี/ไม่มีผลบัญชี ก็ห้ามเท่ากัน)
  --   2→2 = ผ่าน (ไปตรวจ freeze เดิม) · 1→2 ไม่เข้า clause นี้ — ยังถูก guard 606-a
  --   (trg_service_jobs_metadata_update_guard) ปฏิเสธจนกว่า activation 606-b3
  IF OLD.finance_flow_version = 2
     AND NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version THEN
    RAISE EXCEPTION 'งาน flow v2 เปลี่ยน finance_flow_version ไม่ได้ (downgrade = เลี่ยงกติกา freeze)'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(OLD.finance_flow_version, 1) <> 2 THEN
    RETURN NEW;                                   -- legacy v1 = พฤติกรรมเดิม (ไม่แตะ)
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = OLD.id
       AND lower(coalesce(je.status,'')) = 'approved'
  ) INTO v_recognized;

  SELECT EXISTS (SELECT 1 FROM public.service_payments p WHERE p.service_job_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.service_payment_reversals r
                   JOIN public.service_payments p2 ON p2.id = r.payment_id
                  WHERE p2.service_job_id = OLD.id)
    INTO v_has_money;

  IF NOT (v_recognized OR v_has_money) THEN
    RETURN NEW;                                   -- ยังไม่มีผลทางบัญชี → แก้ได้อิสระ
  END IF;

  -- ★ review#2 (blocking 1): ยอด/ประเภทงาน frozen **ทุกสถานะ**
  --   (ย้อน status เป็น done ก่อนแล้วค่อยแก้ยอด = ทางลัดที่ปิดแล้ว)
  IF NEW.total_cost IS DISTINCT FROM OLD.total_cost THEN
    RAISE EXCEPTION 'งานนี้ลงบัญชี/รับเงินแล้ว — แก้ยอดเงินไม่ได้ (ต้องออกเอกสารปรับปรุง)' USING ERRCODE = '42501';
  END IF;
  IF NEW.job_type IS DISTINCT FROM OLD.job_type THEN
    RAISE EXCEPTION 'งานนี้ลงบัญชี/รับเงินแล้ว — เปลี่ยนประเภทงานไม่ได้ (บัญชีรายได้ผูกกับประเภทงาน)' USING ERRCODE = '42501';
  END IF;

  -- ★ transition matrix หลังมีผลทางบัญชีแล้ว:
  --     เดิม → เดิม        = ผ่าน (แก้ฟิลด์อื่น เช่น note/ที่อยู่)
  --     delivered → closed = ผ่าน (ลูกค้ายืนยันปิดงาน — ไม่ใช่เหตุการณ์บัญชี)
  --     ที่เหลือทั้งหมด     = block (→ done/progress/pending/cancelled · closed → delivered)
  IF v_new IS DISTINCT FROM v_old
     AND NOT (v_old = 'delivered' AND v_new = 'closed') THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะงานที่ลงบัญชี/รับเงินแล้วจาก % เป็น % ไม่ได้ (ต้องกลับรายการ/ปรับปรุงบัญชีก่อน)', v_old, v_new
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) POST-CHECK — ผิดข้อใดข้อหนึ่ง = rollback ทั้งไฟล์
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_pos_clause int;
  v_pos_early  int;
  v_je bigint; v_jl bigint;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='guard_service_job_v2_freeze'
     AND p.prosecdef AND p.proconfig IS NOT NULL;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guard_service_job_v2_freeze ต้องเป็น SECURITY DEFINER + search_path';
  END IF;

  -- clause ใหม่ต้องมี และต้องอยู่ **ก่อน** early return (ตำแหน่งในซอร์สจริง ไม่ใช่แค่ LIKE)
  v_pos_clause := strpos(v_def, 'NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version');
  v_pos_early  := strpos(v_def, 'coalesce(OLD.finance_flow_version, 1) <> 2');
  IF v_pos_clause = 0 THEN
    RAISE EXCEPTION 'ไม่พบ clause กัน downgrade finance_flow_version ใน function ใหม่';
  END IF;
  IF v_pos_early = 0 OR v_pos_clause >= v_pos_early THEN
    RAISE EXCEPTION 'clause กัน downgrade ต้องอยู่ก่อน early return (OLD.flow <> 2)';
  END IF;

  -- กติกาเดิม 606-b1 ต้องยังอยู่ครบ (replace ห้ามทำ freeze อ่อนลง)
  IF v_def NOT LIKE '%NEW.total_cost IS DISTINCT FROM OLD.total_cost%'
     OR v_def NOT LIKE '%NEW.job_type IS DISTINCT FROM OLD.job_type%'
     OR v_def NOT LIKE '%service_payments%'
     OR v_def NOT LIKE '%v_old = ''delivered'' AND v_new = ''closed''%' THEN
    RAISE EXCEPTION 'เนื้อ freeze เดิมของ 606-b1 หายไปจาก function ใหม่ — ห้าม weaken';
  END IF;

  -- trigger เดิมต้องยัง enabled และชี้ function เดิม
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_service_job_v2_freeze' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'trigger trg_service_job_v2_freeze ต้องยัง enabled หลัง replace';
  END IF;

  -- บัญชีต้องไม่ขยับ (เทียบ baseline ที่จับไว้ตอนต้น transaction — ไม่ hardcode)
  SELECT count(*) INTO v_je FROM public.journal_entries;
  SELECT count(*) INTO v_jl FROM public.journal_lines;
  IF EXISTS (SELECT 1 FROM _hotfix_baseline b WHERE b.je <> v_je OR b.jl <> v_jl) THEN
    RAISE EXCEPTION 'JE/JL เปลี่ยนระหว่าง hotfix (% / %) — ไฟล์นี้ห้ามเขียนข้อมูล', v_je, v_jl;
  END IF;

  RAISE NOTICE 'POST-CHECK 606-b1.1 ผ่านครบ (flow v2 immutable · freeze เดิมครบ · zero data writes)';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY (รันหลัง COMMIT แล้วส่งผลให้ทีม)
-- ═══════════════════════════════════════════════════════════════════════════
/*
-- V1 definition มี clause และอยู่ก่อน early return
SELECT strpos(pg_get_functiondef(p.oid), 'NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version') AS pos_clause,
       strpos(pg_get_functiondef(p.oid), 'coalesce(OLD.finance_flow_version, 1) <> 2')                        AS pos_early
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='guard_service_job_v2_freeze';
-- ต้องได้ pos_clause > 0 และ pos_clause < pos_early

-- V2 trigger ยัง enabled
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_service_job_v2_freeze' AND NOT tgisinternal;

-- V3 counts เท่ากับ STEP 0.2 ทุกตัว (JE/JL/flow2/payments/reversals)
SELECT (SELECT count(*) FROM public.journal_entries)  AS je,
       (SELECT count(*) FROM public.journal_lines)    AS jl,
       (SELECT count(*) FROM public.service_jobs WHERE finance_flow_version=2) AS flow2,
       (SELECT count(*) FROM public.service_payments) AS payments,
       (SELECT count(*) FROM public.service_payment_reversals) AS reversals;

-- V4 (behavioral · **staging/branch DB เท่านั้น** — production ยังไม่มีงาน flow v2 และห้ามสร้าง)
--   เตรียมงานทดสอบบน staging: INSERT service_jobs แล้ว UPDATE finance_flow_version=2 ตรง ๆ ใน SQL
--   (guard 606-a บล็อกที่ trigger — ทำผ่าน superuser/disable trigger เฉพาะ staging เท่านั้น) แล้วทดสอบ:
--   B12a flow 2→1 (ยังไม่มี JV/ledger)        → ต้อง 42501, zero writes
--   B12b flow 2→1 (มี recognition JV แล้ว)    → ต้อง 42501, zero writes
--   B12c flow 2→NULL                          → ต้อง 42501 (โดน clause ก่อนชน NOT NULL)
--   B12d flow 2→2 (UPDATE field อื่น เช่น note) → ต้องไม่ถูก block จาก clause นี้
--         (ถ้างานมีผลบัญชีแล้ว กติกา freeze เดิมยังคุม total_cost/job_type/status ตามเดิม)
--   B12e flow 1→2                              → ยังถูก guard 606-a ปฏิเสธ (42501 จาก
--         trg_service_jobs_metadata_update_guard) จนกว่า activation 606-b3
--   ★ สถานะรายงานของ Phase 606-b1.1: staging behavioral tests = NOT RUN
--     (ไม่มี staging ในรอบนี้) — **ต้องรันครบก่อน activation 606-b3**
*/

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK GUIDANCE
-- ═══════════════════════════════════════════════════════════════════════════
/*
-- ถอย = restore function body เดิมของ 606-b1 (ไม่มี DROP อะไรทั้งนั้น):
-- รันบล็อก CREATE OR REPLACE FUNCTION public.guard_service_job_v2_freeze() จาก
-- supabase-phase606b1-service-payment-guards.sql (§ ก่อน DROP TRIGGER IF EXISTS
-- trg_service_job_v2_freeze) แล้ว NOTIFY pgrst, 'reload schema';
-- ⚠️ การถอยเปิดช่อง downgrade 2→1 กลับมา — ทำเฉพาะเมื่อ owner สั่งเท่านั้น
*/
