-- STAGING ONLY — AUTHENTICATED PAYMENT BEHAVIOR VERIFY — ห้ามรันบน production
-- ============================================================================
-- Phase 606-B13a — staging behavioral verify: authenticated cash-payment path
-- ============================================================================
-- พิสูจน์เส้นทางจริงบน scratch staging เดิมของ B12 (retained):
--   authenticated temporary admin → recordServicePayment() → record_service_payment_v2
--   → service_payments ledger → postJournalForServicePayment() → payment JV
--   → retry exact intent → duplicate-valid โดยไม่มี write ซ้ำ
-- ต้องพิสูจน์แยกกัน: ledgerRecorded=true (payment ledger ถูกเขียน) และ
-- accountingPosted=true (payment JV ถูกเขียนและตรวจสอบผ่าน)
-- ledger เขียนแล้วแต่ JV ไม่สำเร็จ = fail-closed → bind exact IDs → retain
-- business rows/evidence → STOP รอ recovery review
--
-- กติกาการรันไฟล์นี้ (ตาม STAGING_B13A_RUNBOOK.md — อ่านก่อนเสมอ):
--   • Execution = owner-controlled เท่านั้น (หลัง merge) — package phase ห้ามรัน SQL นี้
--   • Scratch target = scratch เดิมของ Phase 606-B12 เท่านั้น (มี _staging_b12_sentinel +
--     _staging_b12_results 6 แถว ok=true retained) — ห้ามใช้ scratch ใหม่ ของเดิมไม่พร้อม = STOP
--   • ทุก mutating block/function ตรวจ PRODUCTION INTERLOCK: public._staging_b13a_sentinel
--     ต้องมี "หนึ่งแถว" และ confirm_text = 'B13A-STAGING-<current_date ของ target DB session>'
--     เป๊ะ — ไม่มี/ผิด/มากกว่าหนึ่ง = RAISE ก่อน write ทุกกรณี (default = ปฏิเสธ)
--   • sentinel = owner สร้างด้วยมือเท่านั้น (คำสั่งอยู่ใน runbook) — script ห้ามสร้างอัตโนมัติ
--     ห้าม derive วันที่จากเครื่อง owner และห้ามเปลี่ยน session timezone configuration
--   • Durable run-state = public._staging_b13a_runs (singleton): active run ได้หนึ่ง run ·
--     ไม่มี expiry/takeover/automatic cleanup · terminal run ยัง retain และบล็อก run ใหม่ ·
--     run/results/evidence/sentinel retained หลัง complete (ลบ = owner recovery phase แยก)
--   • Sanctioned writers 3 ตัวเท่านั้น: b13a_owner_bootstrap (SQL Editor) ·
--     b13a_browser_transition (authenticated CAS) · b13a_owner_finalize (SQL Editor)
--     — ห้าม ad-hoc DML กับ run/results/evidence นอก writers เหล่านี้ · browser ห้าม direct DML
--   • S0 = introspect-or-create-exact: object มีอยู่ต้องตรงเวอร์ชันนี้เป๊ะจึง reuse ·
--     ไม่ตรง = STOP · ไม่มีจึง CREATE — ห้าม silent IF NOT EXISTS / ห้าม overwrite stale object
--   • NOTIFY pgrst อนุญาตเฉพาะ scratch staging ใน owner-controlled execution phase
--     (block S0-RELOAD มี sentinel interlock) — ห้าม NOTIFY pgrst บน production เด็ดขาด
--     และ package implementation phase ห้ามรัน NOTIFY
--   • ห้าม disable trigger ฝั่ง journal ทุกกรณี — จุดเดียวที่แตะ trigger คือ SEED
--     (DISABLE→UPDATE→ENABLE→VERIFY trg_service_jobs_metadata_update_guard ใน transaction เดียว)
--
-- ลำดับการรัน (per-statement ใน Supabase SQL Editor):
--   [owner sentinel refresh ตาม runbook D ถ้าข้ามวัน/reconnect] → R0 → S0-ACL-RECOVERY
--   → S0 (runs/results/evidence/functions) → S0-RELOAD → PREFLIGHT → SEED
--   → owner bootstrap → [browser: gates → r1 → r2 ตาม runbook] → owner finalize:
--   verify_db → teardown → attest_cleanup → complete → REPORT
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- R0 — read-only environment check (SELECT เดียว · ไม่เขียนอะไร)
--   runbook: ทุกแถวต้อง found=true ก่อนไปต่อ — ขาดตัวใด = scratch B12 ไม่พร้อม = STOP
-- ────────────────────────────────────────────────────────────────────────────
SELECT x.obj, EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'public.service_jobs'::regclass
            AND t.tgname = x.obj AND NOT t.tgisinternal AND t.tgenabled = 'O'
       ) AS found
  FROM (VALUES ('trg_service_jobs_metadata_insert'),
               ('trg_service_jobs_metadata_update_guard'),
               ('trg_service_job_v2_freeze'),
               ('trg_service_jobs_insert_close_guard'),
               ('trg_service_jobs_close_guard'),
               ('trg_service_jobs_delete_guard')) AS x(obj)
UNION ALL
SELECT 'trg_je_lines_balance (journal_lines)', EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'public.journal_lines'::regclass
            AND t.tgname = 'trg_je_lines_balance' AND NOT t.tgisinternal)
UNION ALL
SELECT 'trg_check_period_locked (journal_entries)', EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'public.journal_entries'::regclass
            AND t.tgname = 'trg_check_period_locked' AND NOT t.tgisinternal)
UNION ALL
SELECT 'rpc record_service_payment_v2', (to_regprocedure('public.record_service_payment_v2(bigint,numeric,text,timestamptz,uuid,text,text,text)') IS NOT NULL)
UNION ALL
SELECT 'fn service_job_has_recognition_jv', (to_regprocedure('public.service_job_has_recognition_jv(bigint)') IS NOT NULL)
UNION ALL
SELECT 'fn service_payment_jv_is_valid', (to_regprocedure('public.service_payment_jv_is_valid(bigint)') IS NOT NULL)
UNION ALL
SELECT 'fn service_job_paid_total', (to_regprocedure('public.service_job_paid_total(bigint)') IS NOT NULL)
UNION ALL
SELECT 'fn is_admin / is_accountant', (to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_accountant()') IS NOT NULL)
UNION ALL
SELECT 'table service_payments + reversals', (to_regclass('public.service_payments') IS NOT NULL AND to_regclass('public.service_payment_reversals') IS NOT NULL)
UNION ALL
SELECT 'B12 sentinel retained', (to_regclass('public._staging_b12_sentinel') IS NOT NULL)
UNION ALL
SELECT 'B12 results retained (6 ok=true)', (
         SELECT count(*) = 6 AND bool_and(ok) FROM public._staging_b12_results)
UNION ALL
SELECT 'B13a sentinel (owner สร้างเองตาม runbook)', (to_regclass('public._staging_b13a_sentinel') IS NOT NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- S0-ACL-RECOVERY — Phase 606-B13a.1 · owner-controlled ACL recovery ของ interrupted S0
--   ทำไมต้องมี: fresh-create เดิม (ก่อน B13a.1) ไม่ได้ถอน default ACL ของ Supabase API role
--   ที่ผูกมากับ CREATE จึงทำให้ object ที่สร้างสำเร็จแล้ว rerun ไม่ผ่าน exact-reuse allowlist
--   tri-state (explicit · ห้าม fallback ข้าม state):
--     STATE 1 NO-OP  — ไม่มี B13a object เลย (fresh scratch) → ไม่มี mutation ใด ๆ
--     STATE 2 REPAIR — ตรง interrupted evidence เป๊ะ → REVOKE surplus 4 objects เท่านั้น
--     STATE 3 STOP   — state อื่นทั้งหมด fail-closed → owner-authorized recovery phase แยก
--   ขอบเขต mutation: REVOKE (ลดสิทธิ์อย่างเดียว) — ห้าม DDL/DML/GRANT/ALTER DEFAULT PRIVILEGES
--   full columns/defaults/PK/CHECK/index/RLS/policy contract = ให้ S0.1–S0.3 reuse ตรวจหลัง recovery
--   precheck → REVOKE → post-check อยู่ใน DO statement เดียว: exception = rollback ทั้ง block
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_acl_recovery$
DECLARE
  v_staging_ok boolean := false;
  v_tbl text;
  v_oid oid;
  v_cnt int;
  v_rows bigint;
  v_residue bigint;
  v_rel_bad text;
  v_fn_bad text;
  v_priv_bad text;
  v_ok boolean;
  v_secdef boolean;
  v_owner_ok boolean;
  v_cfg text;
  v_lang text;
  v_vol "char";
  v_strict boolean;
  v_par "char";
  v_leak boolean;
  v_kind "char";
  v_prosrc text;
  v_md5 text;
  v_have_tbl int;
  v_have_fn int;
  c_md5 CONSTANT text := '8a185d251d660a9d690c0cf2075d821e';
  c_tbls CONSTANT text[] := ARRAY['_staging_b13a_runs','_staging_b13a_results','_staging_b13a_evidence'];
  c_privs CONSTANT text[] := ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน introspection/mutation ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  -- authenticated ก็ต้องมีจริง มิฉะนั้น to_regrole(...)::oid = NULL แล้ว comparison กลายเป็น NULL (กลืน grantee แปลกปลอม)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A RECOVERY: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'B13A RECOVERY: ไม่พบ role authenticated/anon — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  -- ── (1) presence ของ target objects (นับเพื่อแยก state — ยังไม่ตัดสิน)
  v_have_tbl := (CASE WHEN to_regclass('public._staging_b13a_runs')     IS NOT NULL THEN 1 ELSE 0 END)
              + (CASE WHEN to_regclass('public._staging_b13a_results')  IS NOT NULL THEN 1 ELSE 0 END)
              + (CASE WHEN to_regclass('public._staging_b13a_evidence') IS NOT NULL THEN 1 ELSE 0 END);
  v_have_fn := CASE WHEN to_regprocedure('public.b13a_owner_bootstrap(uuid)') IS NOT NULL THEN 1 ELSE 0 END;

  -- ── (2) S0.5–S0.7 ต้องไม่มีในทุก state ที่ recovery รองรับ
  IF to_regprocedure('public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean)') IS NOT NULL
     OR to_regprocedure('public.b13a_rpc_exposed()') IS NOT NULL THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: พบ S0.5-S0.7 function แล้ว — อยู่นอกขอบเขต recovery นี้ ต้องใช้ owner-authorized recovery phase แยกหลัง reviewer approval';
  END IF;

  -- ── (3) unknown-object inventory (starts_with = _ เป็น literal · relkind filter กัน index/PK false positive)
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_rel_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND starts_with(c.relname, '_staging_b13a')
     AND c.relkind IN ('r','p','v','m','f')
     AND c.relname <> ALL (ARRAY['_staging_b13a_sentinel'] || c_tbls);
  IF v_rel_bad IS NOT NULL THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: พบ relation นอก allowlist ใต้ B13a prefix (%) — owner-authorized recovery phase แยก', v_rel_bad;
  END IF;
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_fn_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND starts_with(p.proname, 'b13a_')
     AND p.proname <> 'b13a_owner_bootstrap';
  IF v_fn_bad IS NOT NULL THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: พบ function นอก allowlist ใต้ B13a prefix (%) — owner-authorized recovery phase แยก', v_fn_bad;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_bootstrap';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: b13a_owner_bootstrap มี % signature (อนุญาตหนึ่งเดียว — overload) — recovery phase แยก', v_cnt;
  END IF;
  IF v_cnt = 1 AND v_have_fn = 0 THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: พบ b13a_owner_bootstrap แต่ signature ไม่ตรงเวอร์ชันนี้ — recovery phase แยก';
  END IF;

  -- ── (4) canonical B13a residue absence proof — predicates เดียวกับ PREFLIGHT ทั้งสี่
  --      (exact job lookup อย่างเดียวมองไม่เห็น orphan JE 'B13ATEST-JV1' — absence proof ต้องเป็น pattern/ledger scan)
  SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
       + (SELECT count(*) FROM public.journal_entries WHERE doc_no LIKE 'B13ATEST-%')
       + (SELECT count(*) FROM public.service_payments)
       + (SELECT count(*) FROM public.service_payment_reversals)
    INTO v_residue;
  IF v_residue <> 0 THEN
    RAISE EXCEPTION 'B13A RECOVERY STOP: พบ B13a residue รวม % แถว (jobs/JE/payments/reversals) — ห้าม repair · owner-authorized recovery phase แยก', v_residue;
  END IF;

  -- ── (5) retained run = STOP เฉพาะทาง (terminal run ก็บล็อก — ห้ามลบ/takeover เอง)
  IF to_regclass('public._staging_b13a_runs') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM public._staging_b13a_runs;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: retained B13a run detected — ห้ามลบหรือ takeover; ต้องใช้ owner-authorized recovery phase แยกหลัง reviewer approval (พบ % run)', v_rows;
    END IF;
  END IF;

  IF v_have_tbl = 0 AND v_have_fn = 0 THEN
    -- ══ STATE 1 — RECOVERY NO-OP (fresh scratch) · ห้ามมี DDL/DML/REVOKE/GRANT ใด ๆ ใน branch นี้
    RAISE NOTICE 'B13A S0 ACL RECOVERY NO-OP: ไม่มี B13a object บน scratch — ไม่มีอะไรต้องซ่อม ไปต่อ S0.1 ได้';

  ELSIF v_have_tbl = 3 AND v_have_fn = 1 THEN
    -- ══ STATE 2 — RECOVERY REPAIR (ตรง interrupted evidence: S0.1-S0.4 สำเร็จ · S0.5-S0.7 ยังไม่รัน)
    -- identity-critical checks ของตาราง (ไม่ duplicate full schema contract — S0.1-S0.3 reuse ตรวจต่อ)
    FOREACH v_tbl IN ARRAY c_tbls LOOP
      SELECT (c.relkind = 'r') AND (r.rolsuper OR r.rolbypassrls) INTO v_ok
        FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.oid = ('public.' || v_tbl)::regclass;
      IF NOT COALESCE(v_ok, false) THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % ไม่ใช่ ordinary table หรือ owner ไม่ใช่ trusted role', v_tbl;
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_rows;
      IF v_rows <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % มี % แถว (ต้อง 0) — ห้าม repair state ที่มีข้อมูลแล้ว', v_tbl, v_rows;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass AND a.is_grantable;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % มี grant WITH GRANT OPTION % รายการ — ห้าม repair', v_tbl, v_cnt;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND a.grantee <> c.relowner
         AND a.grantee <> to_regrole('authenticated')::oid
         AND a.grantee <> to_regrole('service_role')::oid;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % มี grantee นอก allowlist % รายการ (surplus ที่ซ่อมได้มีชนิดเดียว) — ห้าม repair', v_tbl, v_cnt;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND a.grantee = to_regrole('authenticated')::oid
         AND (v_tbl = '_staging_b13a_results' OR a.privilege_type <> 'SELECT');
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % มี authenticated privilege นอก contract % รายการ — ห้าม repair', v_tbl, v_cnt;
      END IF;
      -- surplus ต้องเป็น non-empty subset ของชุด observed (ไม่บังคับครบ 8 — MAINTAIN ขึ้นกับ PostgreSQL version)
      SELECT string_agg(DISTINCT a.privilege_type, ', ') INTO v_priv_bad
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND a.grantee = to_regrole('service_role')::oid
         AND NOT (a.privilege_type = ANY (c_privs));
      IF v_priv_bad IS NOT NULL THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % มี privilege นอกชุดที่อนุญาต (%) — ห้าม repair', v_tbl, v_priv_bad;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND a.grantee = to_regrole('service_role')::oid;
      IF v_cnt < 1 THEN
        RAISE EXCEPTION 'B13A RECOVERY STOP: % ไม่มี ACL surplus ที่ต้องซ่อม — state ไม่ตรง interrupted evidence', v_tbl;
      END IF;
    END LOOP;

    -- identity-critical checks ของ bootstrap (canonical body ผูกด้วย MD5 — ห้าม duplicate body ที่นี่)
    v_oid := to_regprocedure('public.b13a_owner_bootstrap(uuid)');
    SELECT p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','), l.lanname,
           (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner),
           p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prokind
      INTO v_prosrc, v_secdef, v_cfg, v_lang, v_owner_ok, v_vol, v_strict, v_par, v_leak, v_kind
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap ต้องเป็น SECURITY INVOKER (prosecdef=false) — ห้าม repair';
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=public' THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap proconfig ไม่ตรง canonical (%) — ห้าม repair', v_cfg;
    END IF;
    IF v_lang IS DISTINCT FROM 'plpgsql' THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap language ไม่ตรง canonical (%) — ห้าม repair', v_lang;
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap owner ไม่ใช่ trusted role — ห้าม repair';
    END IF;
    IF v_vol IS DISTINCT FROM 'v' OR v_strict OR v_par IS DISTINCT FROM 'u'
       OR v_leak OR v_kind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap attributes ไม่ตรง canonical (volatile=% strict=% parallel=% leakproof=% kind=%) — ห้าม repair',
        v_vol, v_strict, v_par, v_leak, v_kind;
    END IF;
    IF position('B13A-FN-BOOTSTRAP-V1' IN coalesce(v_prosrc, '')) = 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap ไม่มี canonical marker — ห้าม repair';
    END IF;
    v_md5 := md5(v_prosrc);
    IF v_md5 IS DISTINCT FROM c_md5 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap body hash ไม่ตรง canonical (expected=% actual=%) — อาจเป็น body drift หรือ line-ending/paste difference · ห้ามแก้ prosrc บน scratch · ห้าม manual workaround · ต้องออก recovery phase ใหม่หลัง reviewer ตัดสิน',
        c_md5, v_md5;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap มี EXECUTE WITH GRANT OPTION % รายการ — ห้าม repair', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner
       AND a.grantee <> to_regrole('service_role')::oid;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap มี grantee นอก allowlist % รายการ — ห้าม repair', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee = to_regrole('service_role')::oid
       AND a.privilege_type = 'EXECUTE';
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap ไม่มี ACL surplus ที่ต้องซ่อม — state ไม่ตรง interrupted evidence';
    END IF;

    -- ── mutation ที่อนุญาตทั้งหมด: REVOKE surplus บน 4 objects เป๊ะ (exact identifier · ลดสิทธิ์อย่างเดียว)
    EXECUTE 'REVOKE ALL ON public._staging_b13a_runs FROM service_role';
    EXECUTE 'REVOKE ALL ON public._staging_b13a_results FROM service_role';
    EXECUTE 'REVOKE ALL ON public._staging_b13a_evidence FROM service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.b13a_owner_bootstrap(uuid) FROM service_role';

    -- ── post-check: อ่าน ACL ใหม่ทั้งหมด — ไม่ตรง reuse contract = rollback ทั้ง block (รวม REVOKE)
    FOREACH v_tbl IN ARRAY c_tbls LOOP
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND a.grantee = to_regrole('service_role')::oid;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % ยังเหลือ surplus % รายการ หลัง REVOKE — rollback ทั้ง block', v_tbl, v_cnt;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND (a.grantee = 0 OR a.grantee = to_regrole('anon')::oid);
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % มี PUBLIC/anon privilege % รายการ — rollback ทั้ง block', v_tbl, v_cnt;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass
         AND NOT (a.grantee = c.relowner
                  OR (v_tbl <> '_staging_b13a_results'
                      AND a.grantee = to_regrole('authenticated')::oid
                      AND a.privilege_type = 'SELECT'));
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % ACL ไม่ตรง reuse contract (% รายการนอก allowlist) — rollback ทั้ง block', v_tbl, v_cnt;
      END IF;
      IF v_tbl <> '_staging_b13a_results'
         AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                          WHERE c.oid = ('public.' || v_tbl)::regclass
                            AND a.grantee = to_regrole('authenticated')::oid
                            AND a.privilege_type = 'SELECT') THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % ขาด authenticated SELECT ตาม contract — rollback ทั้ง block', v_tbl;
      END IF;
      SELECT count(*) INTO v_cnt
        FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = ('public.' || v_tbl)::regclass AND a.is_grantable;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % มี grant option % รายการ — rollback ทั้ง block', v_tbl, v_cnt;
      END IF;
      SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
        FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.oid = ('public.' || v_tbl)::regclass;
      IF NOT COALESCE(v_ok, false) THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % owner ไม่ใช่ trusted role — rollback ทั้ง block', v_tbl;
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_rows;
      IF v_rows <> 0 THEN
        RAISE EXCEPTION 'B13A RECOVERY post-check: % มี % แถว หลัง recovery (ต้องคง 0) — rollback ทั้ง block', v_tbl, v_rows;
      END IF;
    END LOOP;
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY post-check: bootstrap ยังมี grantee นอก owner % รายการ — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY post-check: bootstrap มี grant option % รายการ — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.journal_entries WHERE doc_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.service_payments)
         + (SELECT count(*) FROM public.service_payment_reversals)
      INTO v_residue;
    IF v_residue <> 0 THEN
      RAISE EXCEPTION 'B13A RECOVERY post-check: พบ business residue % แถว หลัง recovery — rollback ทั้ง block', v_residue;
    END IF;
    RAISE NOTICE 'B13A S0 ACL RECOVERY PASS: ถอน ACL surplus บน 4 objects แล้ว · ACL ตรง reuse contract · rows/residue ยัง 0 — ขั้นต่อไปคือ rerun S0.1-S0.4 เพื่อพิสูจน์ reuse path (ห้ามข้ามไป S0.5)';

  ELSE
    -- ══ STATE 3 — RECOVERY STOP (partial state อื่นทั้งหมด · ห้าม fallback ไป NO-OP/REPAIR)
    RAISE EXCEPTION 'B13A RECOVERY STOP: partial state ไม่ตรง interrupted evidence (tables=%/3 bootstrap=%/1) — ห้าม repair · ต้องใช้ owner-authorized recovery phase แยกหลัง reviewer approval',
      v_have_tbl, v_have_fn;
  END IF;
END $b13a_s0_acl_recovery$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.1 — _staging_b13a_runs (durable run-state · singleton · introspect-or-create-exact)
--   Intent/IDs เป็น typed columns — ไม่ใช้ JSON เป็น authority
--   IDs bind NULL → exact positive ID ครั้งเดียว · bind แล้วห้ามแก้ (บังคับใน writers)
--   หมายเหตุ column semantics: service_job_id ถูก bind โดย owner bootstrap (business binding)
--   · intent columns = amount/payment_method/bank_coa_code/paid_at/idempotency_key/slip_url/note
--   (snapshot ครั้งเดียวที่ gates_passed→r1_inflight) · ID columns = payment_id/payment_jv_entry_id
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_runs$
DECLARE
  v_staging_ok boolean := false;
  v_cols text;
  v_ok boolean;
  v_pk text;
  v_chk text;
  v_item text;
  v_cnt int;
  v_qual text;
  v_cmd text;
  v_perm text;
  v_roles text;
  v_withchk text;
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.1: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  IF to_regclass('public._staging_b13a_runs') IS NULL THEN
    EXECUTE 'CREATE TABLE public._staging_b13a_runs (
      singleton             boolean PRIMARY KEY CHECK (singleton),
      run_id                uuid NOT NULL UNIQUE,
      actor_id              uuid NOT NULL,
      stage                 text NOT NULL
        CONSTRAINT chk_b13a_runs_stage CHECK (stage IN (
          ''prepared'',''gates_passed'',''r1_inflight'',''r1_recorded'',''r2_inflight'',
          ''r2_verified'',''db_verified'',''teardown_complete'',''auth_cleanup_complete'',
          ''execution_complete'',''failed_incomplete'',''failed_no_write'')),
      service_job_id        bigint,
      payment_id            bigint,
      payment_jv_entry_id   bigint,
      amount                numeric(14,2),
      payment_method        text
        CONSTRAINT chk_b13a_runs_method CHECK (payment_method IS NULL OR payment_method = ''cash''),
      bank_coa_code         text,
      paid_at               timestamptz,
      idempotency_key       uuid,
      slip_url              text,
      note                  text,
      failure_code          text
        CONSTRAINT chk_b13a_runs_failure_code CHECK (failure_code IS NULL OR failure_code IN (
          ''LEDGER_WITHOUT_JV'',''JV_INVALID'',''UNKNOWN_OUTCOME_PAYMENT_FOUND'',
          ''VERIFY_DB_FAILED'',''TEARDOWN_PRECONDITION_FAILED'',''ZERO_WRITE_CONFIRMED'')),
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )';
    EXECUTE 'ALTER TABLE public._staging_b13a_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public._staging_b13a_runs FORCE ROW LEVEL SECURITY';
    -- run SELECT/RLS: browser (authenticated) อ่านได้เฉพาะ run ของ actor ตัวเอง (exact singleton)
    -- anon/actor อื่นอ่านไม่ได้ · ไม่มี INSERT/UPDATE/DELETE grant (browser ห้าม direct DML)
    EXECUTE 'CREATE POLICY b13a_runs_select_actor ON public._staging_b13a_runs
               FOR SELECT TO authenticated
               USING (singleton AND actor_id = auth.uid())';
    EXECUTE 'REVOKE ALL ON public._staging_b13a_runs FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public._staging_b13a_runs TO authenticated';
    -- [B13A-ACL-POST] fresh-create postcondition — ต้องจบด้วย ACL contract เดียวกับ reuse path
    -- (REVOKE/GRANT ไม่ error ไม่พอ — Supabase default privileges ให้ service_role ตอน CREATE)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_runs'::regclass
       AND NOT (a.grantee = c.relowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT'));
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.1 postcondition: พบ table grant นอก allowlist % รายการ หลัง REVOKE/GRANT — rollback ทั้ง block', v_cnt;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                    WHERE c.oid = 'public._staging_b13a_runs'::regclass
                      AND a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.1 postcondition: ขาด SELECT grant ของ authenticated — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_runs'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.1 postcondition: พบ table grant WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_runs'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.1 postcondition: table owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.1: created _staging_b13a_runs (RLS enabled+forced · SELECT-only ผ่าน actor policy)';
  ELSE
    -- introspect exact — ไม่ตรง = STOP (ห้าม overwrite / ห้าม reuse stale)
    SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_runs';
    IF v_cols IS DISTINCT FROM
      'singleton:boolean:NO,run_id:uuid:NO,actor_id:uuid:NO,stage:text:NO,service_job_id:bigint:YES,'
      || 'payment_id:bigint:YES,payment_jv_entry_id:bigint:YES,amount:numeric:YES,payment_method:text:YES,'
      || 'bank_coa_code:text:YES,paid_at:timestamp with time zone:YES,idempotency_key:uuid:YES,'
      || 'slip_url:text:YES,note:text:YES,failure_code:text:YES,'
      || 'created_at:timestamp with time zone:NO,updated_at:timestamp with time zone:NO' THEN
      RAISE EXCEPTION 'B13A S0.1: _staging_b13a_runs มีอยู่แต่ columns ไม่ตรงเวอร์ชันนี้ (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_ok
      FROM pg_class c WHERE c.oid = 'public._staging_b13a_runs'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.1: _staging_b13a_runs RLS ต้อง ENABLE+FORCE — STOP';
    END IF;
    -- PK exact
    SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_pk
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = 'public._staging_b13a_runs'::regclass AND i.indisprimary;
    IF v_pk IS DISTINCT FROM 'singleton' THEN
      RAISE EXCEPTION 'B13A S0.1: PK ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_pk;
    END IF;
    -- column defaults / identity / generated exact — กัน default ถูกสลับ (เช่น created_at)
    SELECT string_agg(column_name || '=' || coalesce(column_default, '-') || ':' || is_identity || ':' || is_generated, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_runs';
    IF v_cols IS DISTINCT FROM
      'singleton=-:NO:NEVER,run_id=-:NO:NEVER,actor_id=-:NO:NEVER,stage=-:NO:NEVER,service_job_id=-:NO:NEVER,'
      || 'payment_id=-:NO:NEVER,payment_jv_entry_id=-:NO:NEVER,amount=-:NO:NEVER,payment_method=-:NO:NEVER,'
      || 'bank_coa_code=-:NO:NEVER,paid_at=-:NO:NEVER,idempotency_key=-:NO:NEVER,slip_url=-:NO:NEVER,'
      || 'note=-:NO:NEVER,failure_code=-:NO:NEVER,created_at=now():NO:NEVER,updated_at=now():NO:NEVER' THEN
      RAISE EXCEPTION 'B13A S0.1: column defaults/identity/generated ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    -- constraint set exact: จำนวนต่อชนิดตรงเป๊ะ — กัน extra constraint ที่เปลี่ยน contract
    SELECT string_agg(t.ct || '=' || t.n, ',' ORDER BY t.ct) INTO v_chk
      FROM (SELECT c.contype::text AS ct, count(*) AS n FROM pg_constraint c
             WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.contype IN ('p','u','c','f')
             GROUP BY c.contype) t;
    IF v_chk IS DISTINCT FROM 'c=4,p=1,u=1' THEN
      RAISE EXCEPTION 'B13A S0.1: ชุด constraint ไม่ตรง (% — คาด c=4,p=1,u=1) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- CHECK (singleton) + UNIQUE (run_id) ต้องมีจริง (เทียบนิยาม normalized ตัดวงเล็บ/ช่องว่าง)
    SELECT count(*) INTO v_cnt FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.contype = 'c'
       AND regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') = 'CHECKsingleton';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.1: ไม่พบ CHECK (singleton) — STOP ห้าม overwrite/reuse'; END IF;
    SELECT count(*) INTO v_cnt FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.contype = 'u'
       AND regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') = 'UNIQUErun_id';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.1: ไม่พบ UNIQUE (run_id) — STOP ห้าม overwrite/reuse'; END IF;
    -- named CHECK definitions exact (normalized ทั้งนิพจน์ — กัน expression ถูกผ่อน/ขยายทั้งที่สมาชิกเดิมอยู่)
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.conname = 'chk_b13a_runs_stage';
    IF v_chk IS DISTINCT FROM
      'CHECKstage=ANYARRAY[''prepared''::text,''gates_passed''::text,''r1_inflight''::text,''r1_recorded''::text,'
      || '''r2_inflight''::text,''r2_verified''::text,''db_verified''::text,''teardown_complete''::text,'
      || '''auth_cleanup_complete''::text,''execution_complete''::text,''failed_incomplete''::text,''failed_no_write''::text]' THEN
      RAISE EXCEPTION 'B13A S0.1: chk_b13a_runs_stage นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.conname = 'chk_b13a_runs_method';
    IF v_chk IS DISTINCT FROM 'CHECKpayment_methodISNULLORpayment_method=''cash''::text' THEN
      RAISE EXCEPTION 'B13A S0.1: chk_b13a_runs_method นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_runs'::regclass AND c.conname = 'chk_b13a_runs_failure_code';
    IF v_chk IS DISTINCT FROM
      'CHECKfailure_codeISNULLORfailure_code=ANYARRAY[''LEDGER_WITHOUT_JV''::text,''JV_INVALID''::text,'
      || '''UNKNOWN_OUTCOME_PAYMENT_FOUND''::text,''VERIFY_DB_FAILED''::text,''TEARDOWN_PRECONDITION_FAILED''::text,'
      || '''ZERO_WRITE_CONFIRMED''::text]' THEN
      RAISE EXCEPTION 'B13A S0.1: chk_b13a_runs_failure_code นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- index exact: ต้องมีแค่ pkey + run_id unique (index แปลกปลอม = contract เปลี่ยน)
    SELECT count(*) INTO v_cnt FROM pg_indexes WHERE schemaname = 'public' AND tablename = '_staging_b13a_runs';
    IF v_cnt <> 2 THEN RAISE EXCEPTION 'B13A S0.1: index ต้องมี 2 (พบ %) — STOP ห้าม overwrite/reuse', v_cnt; END IF;
    -- policy exact: หนึ่ง policy + expression/cmd/roles/permissive ตรงเป๊ะ
    SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='_staging_b13a_runs';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.1: policy ต้องมี 1 (พบ %) — STOP', v_cnt; END IF;
    SELECT regexp_replace(coalesce(pp.qual, ''), '\s+', ' ', 'g'), pp.cmd, pp.permissive,
           array_to_string(pp.roles, ','), pp.with_check
      INTO v_qual, v_cmd, v_perm, v_roles, v_withchk
      FROM pg_policies pp
     WHERE pp.schemaname='public' AND pp.tablename='_staging_b13a_runs' AND pp.policyname='b13a_runs_select_actor';
    IF v_qual IS DISTINCT FROM '(singleton AND (actor_id = auth.uid()))'
       OR v_cmd IS DISTINCT FROM 'SELECT' OR v_perm IS DISTINCT FROM 'PERMISSIVE'
       OR v_roles IS DISTINCT FROM 'authenticated' OR v_withchk IS NOT NULL THEN
      RAISE EXCEPTION 'B13A S0.1: policy expression/roles ไม่ตรงเป๊ะ (qual=% cmd=% roles=%) — STOP', v_qual, v_cmd, v_roles;
    END IF;
    -- grants exact รวม PUBLIC: authenticated = SELECT เท่านั้น · PUBLIC/anon = ห้ามมี
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_runs'
                  AND grantee IN ('PUBLIC','anon')) THEN
      RAISE EXCEPTION 'B13A S0.1: พบ grant ให้ PUBLIC/anon บน _staging_b13a_runs — STOP';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_runs'
                  AND grantee = 'authenticated' AND privilege_type <> 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.1: authenticated ต้องมีแค่ SELECT — STOP';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_runs'
                  AND grantee = 'authenticated' AND privilege_type = 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.1: ขาด SELECT grant ของ authenticated — STOP';
    END IF;
    -- grantee allowlist ทั้งหมด: table owner + authenticated(SELECT) เท่านั้น — role อื่นทุกตัว = STOP
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_runs'::regclass
       AND NOT (a.grantee = c.relowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT'));
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.1: พบ table grant นอก allowlist % รายการ (อนุญาต: owner + authenticated SELECT) — STOP ห้าม reuse', v_cnt;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณีบนตาราง (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_runs'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.1: พบ table grant WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_cnt;
    END IF;
    -- table owner ต้องเป็น trusted context จริง — introspect pg_roles (ห้ามยอมรับ relowner อัตโนมัติ)
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_runs'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.1: table owner ไม่ใช่ trusted role (ต้อง rolsuper/rolbypassrls จาก pg_roles) — STOP ห้าม reuse';
    END IF;
    RAISE NOTICE 'B13A S0.1: reuse _staging_b13a_runs (introspect exact ผ่าน: columns/PK/CHECK/policy/grants)';
  END IF;
END $b13a_s0_runs$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.2 — _staging_b13a_results (certificates · owner เท่านั้น · no browser grants)
--   certificates: PAYMENT_BEHAVIOR_PASS · ABORTED_NO_PAYMENT · EXECUTION_COMPLETE
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_results$
DECLARE
  v_staging_ok boolean := false;
  v_cols text;
  v_ok boolean;
  v_pk text;
  v_chk text;
  v_item text;
  v_cnt int;
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.2: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  IF to_regclass('public._staging_b13a_results') IS NULL THEN
    EXECUTE 'CREATE TABLE public._staging_b13a_results (
      run_id      uuid NOT NULL,
      certificate text NOT NULL
        CONSTRAINT chk_b13a_results_certificate CHECK (certificate IN (
          ''PAYMENT_BEHAVIOR_PASS'',''ABORTED_NO_PAYMENT'',''EXECUTION_COMPLETE'')),
      detail      text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, certificate)
    )';
    EXECUTE 'ALTER TABLE public._staging_b13a_results ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public._staging_b13a_results FORCE ROW LEVEL SECURITY';
    -- results ไม่มี browser grants ใด ๆ (ไม่มี policy = อ่านไม่ได้ผ่าน API · owner อ่านใน SQL Editor)
    EXECUTE 'REVOKE ALL ON public._staging_b13a_results FROM PUBLIC, anon, authenticated, service_role';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = owner เท่านั้น (เดียวกับ reuse path)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_results'::regclass
       AND a.grantee <> c.relowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.2 postcondition: พบ table grant นอก allowlist % รายการ หลัง REVOKE — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_results'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.2 postcondition: พบ table grant WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_results'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.2 postcondition: table owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.2: created _staging_b13a_results (no browser grants)';
  ELSE
    SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_results';
    IF v_cols IS DISTINCT FROM
      'run_id:uuid:NO,certificate:text:NO,detail:text:YES,created_at:timestamp with time zone:NO' THEN
      RAISE EXCEPTION 'B13A S0.2: _staging_b13a_results มีอยู่แต่ columns ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_ok
      FROM pg_class c WHERE c.oid = 'public._staging_b13a_results'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.2: _staging_b13a_results RLS ต้อง ENABLE+FORCE — STOP';
    END IF;
    SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_pk
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = 'public._staging_b13a_results'::regclass AND i.indisprimary;
    IF v_pk IS DISTINCT FROM 'run_id,certificate' THEN
      RAISE EXCEPTION 'B13A S0.2: PK ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_pk;
    END IF;
    -- column defaults / identity / generated exact
    SELECT string_agg(column_name || '=' || coalesce(column_default, '-') || ':' || is_identity || ':' || is_generated, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_results';
    IF v_cols IS DISTINCT FROM
      'run_id=-:NO:NEVER,certificate=-:NO:NEVER,detail=-:NO:NEVER,created_at=now():NO:NEVER' THEN
      RAISE EXCEPTION 'B13A S0.2: column defaults/identity/generated ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    -- constraint set exact
    SELECT string_agg(t.ct || '=' || t.n, ',' ORDER BY t.ct) INTO v_chk
      FROM (SELECT c.contype::text AS ct, count(*) AS n FROM pg_constraint c
             WHERE c.conrelid = 'public._staging_b13a_results'::regclass AND c.contype IN ('p','u','c','f')
             GROUP BY c.contype) t;
    IF v_chk IS DISTINCT FROM 'c=1,p=1' THEN
      RAISE EXCEPTION 'B13A S0.2: ชุด constraint ไม่ตรง (% — คาด c=1,p=1) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- CHECK definition exact (normalized ทั้งนิพจน์)
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_results'::regclass AND c.conname = 'chk_b13a_results_certificate';
    IF v_chk IS DISTINCT FROM
      'CHECKcertificate=ANYARRAY[''PAYMENT_BEHAVIOR_PASS''::text,''ABORTED_NO_PAYMENT''::text,''EXECUTION_COMPLETE''::text]' THEN
      RAISE EXCEPTION 'B13A S0.2: chk_b13a_results_certificate นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- index exact (pkey เท่านั้น)
    SELECT count(*) INTO v_cnt FROM pg_indexes WHERE schemaname = 'public' AND tablename = '_staging_b13a_results';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.2: index ต้องมี 1 (พบ %) — STOP ห้าม overwrite/reuse', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='_staging_b13a_results';
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A S0.2: results ต้องไม่มี policy (พบ %) — STOP', v_cnt; END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_results'
                  AND grantee IN ('PUBLIC','anon','authenticated')) THEN
      RAISE EXCEPTION 'B13A S0.2: results ต้องไม่มี grant ให้ PUBLIC/anon/authenticated ใด ๆ — STOP';
    END IF;
    -- grantee allowlist ทั้งหมด: table owner เท่านั้น — role อื่นทุกตัว = STOP
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_results'::regclass
       AND a.grantee <> c.relowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.2: พบ table grant นอก allowlist % รายการ (อนุญาต: owner เท่านั้น) — STOP ห้าม reuse', v_cnt;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณีบนตาราง (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_results'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.2: พบ table grant WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_cnt;
    END IF;
    -- table owner ต้องเป็น trusted context จริง — introspect pg_roles (ห้ามยอมรับ relowner อัตโนมัติ)
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_results'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.2: table owner ไม่ใช่ trusted role (ต้อง rolsuper/rolbypassrls จาก pg_roles) — STOP ห้าม reuse';
    END IF;
    RAISE NOTICE 'B13A S0.2: reuse _staging_b13a_results (introspect exact ผ่าน: columns/PK/CHECK/RLS/grants)';
  END IF;
END $b13a_s0_results$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.3 — _staging_b13a_evidence (typed columns · write-once ต่อ (run_id, step))
--   browser steps: gates/r1/r2/failure (source=browser_cas — เขียนผ่าน browser CAS เท่านั้น)
--   owner-attested steps: session_null_attested/clean_login_rejected_attested/
--   local_cleanup_attested (source=owner_sql_attestation — boolean/timestamp เท่านั้น)
--   ห้าม arbitrary payload JSON · ห้าม credential/JWT/token/host/ref/key/path/UUID leak
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_evidence$
DECLARE
  v_staging_ok boolean := false;
  v_cols text;
  v_ok boolean;
  v_pk text;
  v_chk text;
  v_item text;
  v_cnt int;
  v_qual text;
  v_cmd text;
  v_perm text;
  v_roles text;
  v_withchk text;
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.3: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  IF to_regclass('public._staging_b13a_evidence') IS NULL THEN
    EXECUTE 'CREATE TABLE public._staging_b13a_evidence (
      run_id              uuid NOT NULL,
      step                text NOT NULL
        CONSTRAINT chk_b13a_evidence_step CHECK (step IN (
          ''gates'',''r1'',''r2'',''failure'',
          ''session_null_attested'',''clean_login_rejected_attested'',''local_cleanup_attested'')),
      source              text NOT NULL
        CONSTRAINT chk_b13a_evidence_source CHECK (source IN (''browser_cas'',''owner_sql_attestation'')),
      ok                  boolean NOT NULL,
      payment_id          bigint,
      payment_jv_entry_id bigint,
      inserted            boolean,
      ledger_recorded     boolean,
      accounting_posted   boolean,
      paid_total          numeric(14,2),
      outstanding         numeric(14,2),
      jv_status           text,
      jv_reason           text,
      failure_code        text
        CONSTRAINT chk_b13a_evidence_failure_code CHECK (failure_code IS NULL OR failure_code IN (
          ''LEDGER_WITHOUT_JV'',''JV_INVALID'',''UNKNOWN_OUTCOME_PAYMENT_FOUND'',
          ''VERIFY_DB_FAILED'',''TEARDOWN_PRECONDITION_FAILED'',''ZERO_WRITE_CONFIRMED'')),
      created_at          timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, step),
      CONSTRAINT chk_b13a_evidence_step_source CHECK (
        (step IN (''gates'',''r1'',''r2'') AND source = ''browser_cas'')
        OR step = ''failure''
        OR (step IN (''session_null_attested'',''clean_login_rejected_attested'',''local_cleanup_attested'')
            AND source = ''owner_sql_attestation'')),
      CONSTRAINT chk_b13a_evidence_attest_boolean_only CHECK (
        step NOT IN (''session_null_attested'',''clean_login_rejected_attested'',''local_cleanup_attested'')
        OR (payment_id IS NULL AND payment_jv_entry_id IS NULL AND inserted IS NULL
            AND ledger_recorded IS NULL AND accounting_posted IS NULL AND paid_total IS NULL
            AND outstanding IS NULL AND jv_status IS NULL AND jv_reason IS NULL AND failure_code IS NULL))
    )';
    EXECUTE 'ALTER TABLE public._staging_b13a_evidence ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public._staging_b13a_evidence FORCE ROW LEVEL SECURITY';
    -- browser SELECT ผ่าน actor+run RLS เท่านั้น · browser ห้าม direct DML (เขียนผ่าน CAS/finalizer)
    EXECUTE 'CREATE POLICY b13a_evidence_select_actor ON public._staging_b13a_evidence
               FOR SELECT TO authenticated
               USING (EXISTS (SELECT 1 FROM public._staging_b13a_runs r
                               WHERE r.singleton AND r.run_id = _staging_b13a_evidence.run_id
                                 AND r.actor_id = auth.uid()))';
    EXECUTE 'REVOKE ALL ON public._staging_b13a_evidence FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public._staging_b13a_evidence TO authenticated';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = owner + authenticated(SELECT)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass
       AND NOT (a.grantee = c.relowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT'));
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.3 postcondition: พบ table grant นอก allowlist % รายการ หลัง REVOKE/GRANT — rollback ทั้ง block', v_cnt;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                    WHERE c.oid = 'public._staging_b13a_evidence'::regclass
                      AND a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.3 postcondition: ขาด SELECT grant ของ authenticated — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.3 postcondition: พบ table grant WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_cnt;
    END IF;
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.3 postcondition: table owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.3: created _staging_b13a_evidence (typed · write-once · SELECT ผ่าน actor RLS)';
  ELSE
    SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_evidence';
    IF v_cols IS DISTINCT FROM
      'run_id:uuid:NO,step:text:NO,source:text:NO,ok:boolean:NO,payment_id:bigint:YES,'
      || 'payment_jv_entry_id:bigint:YES,inserted:boolean:YES,ledger_recorded:boolean:YES,'
      || 'accounting_posted:boolean:YES,paid_total:numeric:YES,outstanding:numeric:YES,'
      || 'jv_status:text:YES,jv_reason:text:YES,failure_code:text:YES,created_at:timestamp with time zone:NO' THEN
      RAISE EXCEPTION 'B13A S0.3: _staging_b13a_evidence มีอยู่แต่ columns ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_ok
      FROM pg_class c WHERE c.oid = 'public._staging_b13a_evidence'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.3: _staging_b13a_evidence RLS ต้อง ENABLE+FORCE — STOP';
    END IF;
    SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_pk
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = 'public._staging_b13a_evidence'::regclass AND i.indisprimary;
    IF v_pk IS DISTINCT FROM 'run_id,step' THEN
      RAISE EXCEPTION 'B13A S0.3: PK ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_pk;
    END IF;
    -- column defaults / identity / generated exact
    SELECT string_agg(column_name || '=' || coalesce(column_default, '-') || ':' || is_identity || ':' || is_generated, ',' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '_staging_b13a_evidence';
    IF v_cols IS DISTINCT FROM
      'run_id=-:NO:NEVER,step=-:NO:NEVER,source=-:NO:NEVER,ok=-:NO:NEVER,payment_id=-:NO:NEVER,'
      || 'payment_jv_entry_id=-:NO:NEVER,inserted=-:NO:NEVER,ledger_recorded=-:NO:NEVER,'
      || 'accounting_posted=-:NO:NEVER,paid_total=-:NO:NEVER,outstanding=-:NO:NEVER,'
      || 'jv_status=-:NO:NEVER,jv_reason=-:NO:NEVER,failure_code=-:NO:NEVER,created_at=now():NO:NEVER' THEN
      RAISE EXCEPTION 'B13A S0.3: column defaults/identity/generated ไม่ตรง (%) — STOP ห้าม overwrite/reuse', v_cols;
    END IF;
    -- constraint set exact
    SELECT string_agg(t.ct || '=' || t.n, ',' ORDER BY t.ct) INTO v_chk
      FROM (SELECT c.contype::text AS ct, count(*) AS n FROM pg_constraint c
             WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.contype IN ('p','u','c','f')
             GROUP BY c.contype) t;
    IF v_chk IS DISTINCT FROM 'c=5,p=1' THEN
      RAISE EXCEPTION 'B13A S0.3: ชุด constraint ไม่ตรง (% — คาด c=5,p=1) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- named CHECK definitions exact (normalized ทั้งนิพจน์)
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.conname = 'chk_b13a_evidence_step';
    IF v_chk IS DISTINCT FROM
      'CHECKstep=ANYARRAY[''gates''::text,''r1''::text,''r2''::text,''failure''::text,''session_null_attested''::text,'
      || '''clean_login_rejected_attested''::text,''local_cleanup_attested''::text]' THEN
      RAISE EXCEPTION 'B13A S0.3: chk_b13a_evidence_step นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.conname = 'chk_b13a_evidence_source';
    IF v_chk IS DISTINCT FROM 'CHECKsource=ANYARRAY[''browser_cas''::text,''owner_sql_attestation''::text]' THEN
      RAISE EXCEPTION 'B13A S0.3: chk_b13a_evidence_source นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.conname = 'chk_b13a_evidence_failure_code';
    IF v_chk IS DISTINCT FROM
      'CHECKfailure_codeISNULLORfailure_code=ANYARRAY[''LEDGER_WITHOUT_JV''::text,''JV_INVALID''::text,'
      || '''UNKNOWN_OUTCOME_PAYMENT_FOUND''::text,''VERIFY_DB_FAILED''::text,''TEARDOWN_PRECONDITION_FAILED''::text,'
      || '''ZERO_WRITE_CONFIRMED''::text]' THEN
      RAISE EXCEPTION 'B13A S0.3: chk_b13a_evidence_failure_code นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.conname = 'chk_b13a_evidence_step_source';
    IF v_chk IS DISTINCT FROM
      'CHECKstep=ANYARRAY[''gates''::text,''r1''::text,''r2''::text]ANDsource=''browser_cas''::text'
      || 'ORstep=''failure''::textORstep=ANYARRAY[''session_null_attested''::text,''clean_login_rejected_attested''::text,'
      || '''local_cleanup_attested''::text]ANDsource=''owner_sql_attestation''::text' THEN
      RAISE EXCEPTION 'B13A S0.3: chk_b13a_evidence_step_source นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '[()\s]+', '', 'g') INTO v_chk FROM pg_constraint c
     WHERE c.conrelid = 'public._staging_b13a_evidence'::regclass AND c.conname = 'chk_b13a_evidence_attest_boolean_only';
    IF v_chk IS DISTINCT FROM
      'CHECKstep<>ALLARRAY[''session_null_attested''::text,''clean_login_rejected_attested''::text,''local_cleanup_attested''::text]'
      || 'ORpayment_idISNULLANDpayment_jv_entry_idISNULLANDinsertedISNULLANDledger_recordedISNULL'
      || 'ANDaccounting_postedISNULLANDpaid_totalISNULLANDoutstandingISNULLANDjv_statusISNULL'
      || 'ANDjv_reasonISNULLANDfailure_codeISNULL' THEN
      RAISE EXCEPTION 'B13A S0.3: chk_b13a_evidence_attest_boolean_only นิยามไม่ตรงเป๊ะ (%) — STOP ห้าม overwrite/reuse', v_chk;
    END IF;
    -- index exact (pkey เท่านั้น)
    SELECT count(*) INTO v_cnt FROM pg_indexes WHERE schemaname = 'public' AND tablename = '_staging_b13a_evidence';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.3: index ต้องมี 1 (พบ %) — STOP ห้าม overwrite/reuse', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='_staging_b13a_evidence';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A S0.3: policy ต้องมี 1 (พบ %) — STOP', v_cnt; END IF;
    SELECT regexp_replace(coalesce(pp.qual, ''), '\s+', ' ', 'g'), pp.cmd, pp.permissive,
           array_to_string(pp.roles, ','), pp.with_check
      INTO v_qual, v_cmd, v_perm, v_roles, v_withchk
      FROM pg_policies pp
     WHERE pp.schemaname='public' AND pp.tablename='_staging_b13a_evidence' AND pp.policyname='b13a_evidence_select_actor';
    IF v_qual IS DISTINCT FROM
       '(EXISTS ( SELECT 1 FROM _staging_b13a_runs r WHERE (r.singleton AND (r.run_id = _staging_b13a_evidence.run_id) AND (r.actor_id = auth.uid()))))'
       OR v_cmd IS DISTINCT FROM 'SELECT' OR v_perm IS DISTINCT FROM 'PERMISSIVE'
       OR v_roles IS DISTINCT FROM 'authenticated' OR v_withchk IS NOT NULL THEN
      RAISE EXCEPTION 'B13A S0.3: policy expression/roles ไม่ตรงเป๊ะ (qual=%) — STOP', v_qual;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_evidence'
                  AND grantee IN ('PUBLIC','anon')) THEN
      RAISE EXCEPTION 'B13A S0.3: พบ grant ให้ PUBLIC/anon บน _staging_b13a_evidence — STOP';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_evidence'
                  AND grantee = 'authenticated' AND privilege_type <> 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.3: authenticated ต้องมีแค่ SELECT (browser ห้าม direct DML) — STOP';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='_staging_b13a_evidence'
                  AND grantee = 'authenticated' AND privilege_type = 'SELECT') THEN
      RAISE EXCEPTION 'B13A S0.3: ขาด SELECT grant ของ authenticated — STOP';
    END IF;
    -- grantee allowlist ทั้งหมด: table owner + authenticated(SELECT) เท่านั้น — role อื่นทุกตัว = STOP
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass
       AND NOT (a.grantee = c.relowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'SELECT'));
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.3: พบ table grant นอก allowlist % รายการ (อนุญาต: owner + authenticated SELECT) — STOP ห้าม reuse', v_cnt;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณีบนตาราง (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass AND a.is_grantable;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A S0.3: พบ table grant WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_cnt;
    END IF;
    -- table owner ต้องเป็น trusted context จริง — introspect pg_roles (ห้ามยอมรับ relowner อัตโนมัติ)
    SELECT r.rolsuper OR r.rolbypassrls INTO v_ok
      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public._staging_b13a_evidence'::regclass;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.3: table owner ไม่ใช่ trusted role (ต้อง rolsuper/rolbypassrls จาก pg_roles) — STOP ห้าม reuse';
    END IF;
    RAISE NOTICE 'B13A S0.3: reuse _staging_b13a_evidence (introspect exact ผ่าน: columns/PK/CHECK/policy/grants)';
  END IF;
END $b13a_s0_evidence$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.4 — Writer 0: b13a_owner_bootstrap (SQL Editor เท่านั้น · no API grants)
--   สร้าง run เดียว stage='prepared' — actor/run/job exact · intent/IDs = NULL
--   ห้าม UPDATE ผ่าน bootstrap (function นี้มีแต่ INSERT run) · duplicate = reject
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_fn_bootstrap$
DECLARE
  v_staging_ok boolean := false;
  v_oid oid;
  v_def text;
  v_body text;
  v_p int;
  v_prosrc text;
  v_secdef boolean;
  v_cfg text;
  v_lang text;
  v_owner_ok boolean;
  v_pub boolean;
  v_anon boolean;
  v_auth boolean;
  v_cnt_name int;
  v_acl_bad int;
  v_args text;
  v_ret text;
  v_vol "char";
  v_strict boolean;
  v_par "char";
  v_leak boolean;
  v_kind "char";
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.4: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  v_def := $B13A_DEF_BOOTSTRAP$
CREATE FUNCTION public.b13a_owner_bootstrap(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn_bootstrap$
DECLARE
  -- B13A-FN-BOOTSTRAP-V1 (sanctioned writer 0 — SQL Editor เท่านั้น · ห้าม UPDATE ผ่าน bootstrap)
  v_staging_ok boolean := false;
  v_trusted    boolean := false;
  v_run_count  int;
  v_job        public.service_jobs%ROWTYPE;
  v_job_count  int;
  v_auth_count int;
  v_prof_count int;
  v_run_id     uuid;
  v_n          int;
BEGIN
  -- (0) trusted owner context จริง — introspect ไม่เดา role name · ห้ามใช้ auth.uid()=actor
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: ต้องรันใน SQL Editor (owner context — auth.uid() ต้องเป็น NULL) ห้ามเรียกผ่าน API';
  END IF;
  SELECT r.rolsuper OR r.rolbypassrls INTO v_trusted FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT COALESCE(v_trusted, false) THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: current_user (%) ไม่ใช่ trusted owner context (ต้อง rolsuper หรือ rolbypassrls จริงจาก pg_roles)', current_user;
  END IF;

  -- (1) [B13A-INTERLOCK] sentinel ต้องมีหนึ่งแถวและตรง current_date ของ DB session เป๊ะ
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- (2) active run = 0 — terminal run ก็ยังบล็อก run ใหม่ (retain · ไม่มี takeover/auto cleanup)
  SELECT count(*) INTO v_run_count FROM public._staging_b13a_runs;
  IF v_run_count <> 0 THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: มี run อยู่แล้ว % run (active หรือ terminal ก็บล็อกทั้งคู่) — การลบ run ที่ retain = owner recovery phase แยกหลัง reviewer approval', v_run_count;
  END IF;

  -- (3) exact seeded job — ต้องมี B13ATEST-CASH-1 หนึ่งงานเป๊ะ สภาพตรง SEED ทุกช่อง
  SELECT count(*) INTO v_job_count FROM public.service_jobs WHERE job_no = 'B13ATEST-CASH-1';
  IF v_job_count <> 1 THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: seeded job B13ATEST-CASH-1 ต้องมี 1 งาน (พบ %) — รัน SEED ก่อน', v_job_count;
  END IF;
  SELECT * INTO v_job FROM public.service_jobs WHERE job_no = 'B13ATEST-CASH-1';
  IF v_job.status <> 'delivered' OR v_job.job_type <> 'other'
     OR round(v_job.total_cost, 2) <> 1000.00
     OR v_job.finance_flow_version IS DISTINCT FROM 2
     OR coalesce(v_job.source_kind, 'service') <> 'service' THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: seeded job ไม่ตรง spec (status=% type=% cost=% flow=% kind=%) — STOP',
      v_job.status, v_job.job_type, v_job.total_cost, v_job.finance_flow_version, v_job.source_kind;
  END IF;

  -- (4) exact actor — ต้องมีทั้ง auth.users และ profiles role='admin' อย่างละหนึ่งแถวเป๊ะ
  --     (actor UUID อยู่ใน scratch DB/SQL Editor เท่านั้น — ห้ามเผยแพร่ใน repo/report/chat)
  SELECT count(*) INTO v_auth_count FROM auth.users u WHERE u.id = p_actor_id;
  IF v_auth_count <> 1 THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: ไม่พบ temporary admin ใน auth.users (exact id · พบ % แถว) — สร้าง temp admin ตาม runbook ก่อน', v_auth_count;
  END IF;
  SELECT count(*) INTO v_prof_count FROM public.profiles pr WHERE pr.id = p_actor_id AND pr.role = 'admin';
  IF v_prof_count <> 1 THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: profiles ของ actor ต้องมี 1 แถว role=admin (พบ %) — STOP', v_prof_count;
  END IF;

  -- (5) recognition JV ต้องผ่าน function จริง (service_job_has_recognition_jv) ภายใต้ claims
  --     ของ actor (scratch เท่านั้น — ตั้ง transaction-local แล้วเคลียร์ทันทีหลังตรวจ)
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_actor_id::text, 'role', 'authenticated')::text, true);
  IF NOT public.service_job_has_recognition_jv(v_job.id) THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'B13A BOOTSTRAP: service_job_has_recognition_jv(%) = false — recognition JV ของ seed ไม่ถูกต้อง — STOP', v_job.id;
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  -- (6) insert run เดียว — stage=prepared · job bind ที่นี่ · intent/IDs = NULL ทุกช่อง
  v_run_id := gen_random_uuid();
  INSERT INTO public._staging_b13a_runs
    (singleton, run_id, actor_id, stage, service_job_id,
     payment_id, payment_jv_entry_id, amount, payment_method, bank_coa_code,
     paid_at, idempotency_key, slip_url, note, failure_code)
  VALUES
    (true, v_run_id, p_actor_id, 'prepared', v_job.id,
     NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B13A BOOTSTRAP: insert run ได้ % แถว (ต้อง 1) — ยกเลิกทั้ง transaction', v_n;
  END IF;

  RAISE NOTICE 'B13A BOOTSTRAP OK: run % stage=prepared job=% (intent/IDs = NULL)', v_run_id, v_job.id;
  RETURN jsonb_build_object('run_id', v_run_id, 'stage', 'prepared', 'service_job_id', v_job.id);
END $fn_bootstrap$;
$B13A_DEF_BOOTSTRAP$;
  -- expected body = ข้อความระหว่าง $fn_bootstrap$ ... $fn_bootstrap$ (source เดียว ใช้ทั้ง CREATE และ verify)
  v_p := position('$fn_bootstrap$' IN v_def);
  v_body := substring(v_def FROM v_p + length('$fn_bootstrap$'));
  v_body := left(v_body, position('$fn_bootstrap$' IN v_body) - 1);

  -- ผูกด้วย exact signature เท่านั้น — ชื่อเดียวกันแต่ signature อื่น = STOP
  v_oid := to_regprocedure('public.b13a_owner_bootstrap(uuid)');
  IF v_oid IS NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_bootstrap') THEN
    RAISE EXCEPTION 'B13A S0.4: พบ b13a_owner_bootstrap แต่ signature ไม่ตรงเวอร์ชันนี้ — STOP ห้าม overwrite/reuse';
  END IF;
  -- ห้ามมี overload: ชื่อนี้ต้องมีหนึ่ง signature เดียวใน pg_proc เท่านั้น
  -- (overload ทำ PostgREST resolution เพี้ยน/expose RPC ที่ไม่ตั้งใจ)
  SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_bootstrap';
  IF v_cnt_name > 1 THEN
    RAISE EXCEPTION 'B13A S0.4: b13a_owner_bootstrap มี % signature (อนุญาตหนึ่งเดียว — พบ overload) — STOP ห้าม overwrite/reuse', v_cnt_name;
  END IF;

  IF v_oid IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','), l.lanname,
           (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_prosrc, v_secdef, v_cfg, v_lang, v_owner_ok
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    -- body ต้องตรงเวอร์ชันนี้ byte-ต่อ-byte — marker substring อย่างเดียวไม่พอ
    IF v_prosrc IS DISTINCT FROM v_body THEN
      RAISE EXCEPTION 'B13A S0.4: b13a_owner_bootstrap body ไม่ตรงเวอร์ชันนี้เป๊ะ — STOP ห้าม overwrite/reuse';
    END IF;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.4: b13a_owner_bootstrap ต้องไม่เป็น SECURITY DEFINER — STOP';
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=public' THEN
      RAISE EXCEPTION 'B13A S0.4: proconfig ต้องเป็น search_path=public เป๊ะ (ได้ %) — STOP', v_cfg;
    END IF;
    IF v_lang IS DISTINCT FROM 'plpgsql' THEN
      RAISE EXCEPTION 'B13A S0.4: language ต้องเป็น plpgsql (ได้ %) — STOP', v_lang;
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.4: owner ของ function ไม่ใช่ trusted role — STOP';
    END IF;
    -- API metadata exact: argument names/defaults · return type · attributes
    -- (runbook เรียกด้วย named args + อาศัย defaults — เปลี่ยนชื่อ/ค่า default = สัญญาเปลี่ยน)
    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
           p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prokind
      INTO v_args, v_ret, v_vol, v_strict, v_par, v_leak, v_kind
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_args IS DISTINCT FROM 'p_actor_id uuid' THEN
      RAISE EXCEPTION 'B13A S0.4: argument names/defaults ไม่ตรงเป๊ะ (%) — STOP ห้าม reuse', v_args;
    END IF;
    IF v_ret IS DISTINCT FROM 'jsonb' THEN
      RAISE EXCEPTION 'B13A S0.4: return type ไม่ตรง (%) — STOP ห้าม reuse', v_ret;
    END IF;
    IF v_vol IS DISTINCT FROM 'v' OR v_strict OR v_par IS DISTINCT FROM 'u'
       OR v_leak OR v_kind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'B13A S0.4: function attributes ไม่ตรง (volatile=% strict=% parallel=% leakproof=% kind=%) — STOP ห้าม reuse',
        v_vol, v_strict, v_par, v_leak, v_kind;
    END IF;
    -- EXECUTE grants exact รวม PUBLIC (aclexplode คลี่ default acl ด้วย — proacl NULL = PUBLIC execute)
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('anon')::oid AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE')
      INTO v_pub, v_anon, v_auth
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid;
    IF COALESCE(v_pub, false) OR COALESCE(v_anon, false) OR COALESCE(v_auth, false) THEN
      RAISE EXCEPTION 'B13A S0.4: execute grants ไม่ตรง (PUBLIC=% anon=% authenticated=%) — STOP',
        COALESCE(v_pub, false), COALESCE(v_anon, false), COALESCE(v_auth, false);
    END IF;
    -- grantee allowlist ทั้งหมด: function owner เท่านั้น — grantee อื่นทุกตัว (role ใดก็ตาม) = STOP
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND a.grantee <> p.proowner;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.4: พบ grantee นอก allowlist % รายการ (อนุญาต: function owner) — STOP ห้าม reuse', v_acl_bad;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณี (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.4: พบ EXECUTE WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_acl_bad;
    END IF;
    RAISE NOTICE 'B13A S0.4: reuse b13a_owner_bootstrap (exact: signature/body/secdef/config/language/owner/grants)';
  ELSE
    EXECUTE v_def;
    EXECUTE 'REVOKE ALL ON FUNCTION public.b13a_owner_bootstrap(uuid) FROM PUBLIC, anon, authenticated, service_role';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = function owner เท่านั้น (เดียวกับ reuse path)
    v_oid := to_regprocedure('public.b13a_owner_bootstrap(uuid)');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: ไม่พบ function หลัง CREATE — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_bootstrap';
    IF v_cnt_name <> 1 THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: พบ % signature (ต้องหนึ่งเดียว — overload) — rollback ทั้ง block', v_cnt_name;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: พบ grantee นอก allowlist % รายการ หลัง REVOKE — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: พบ EXECUTE WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT p.prosecdef, (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_secdef, v_owner_ok FROM pg_proc p WHERE p.oid = v_oid;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: ต้องเป็น SECURITY INVOKER (prosecdef=false) — rollback ทั้ง block';
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.4 postcondition: function owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.4: created b13a_owner_bootstrap (no API grants)';
  END IF;
END $b13a_s0_fn_bootstrap$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.5 — Writer 1: b13a_browser_transition (authenticated browser CAS)
--   SECURITY DEFINER + safe search_path · execute เฉพาะ authenticated
--   auth.uid() ต้องไม่ NULL และตรง actor · exact run · FOR UPDATE · exact expected stage
--   transition allowlist · affected row=1 · no skip/reverse · one-time ID binding ·
--   server ตรวจ business rows · evidence+transition atomic · duplicate reject
--   Initial intent snapshot = เฉพาะ gates_passed→r1_inflight (stored intent ยัง NULL):
--   assert all-NULL → validate → เขียนครั้งเดียว → read-back exact — ห้าม pre-compare กับ
--   stored NULL และห้าม overwrite. Transition หลัง snapshot ทุกตัว = NULL-safe compare
--   caller intent กับ stored intent ครบ 8 fields ก่อน mutation ใด ๆ (mismatch = reject ·
--   ห้าม fallback · ห้ามเขียนทับ stored intent — DB RPC idempotency guard เป็น backstop
--   ไม่ใช่เหตุผลให้ตัด CAS comparison)
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_fn_browser$
DECLARE
  v_staging_ok boolean := false;
  v_oid oid;
  v_def text;
  v_body text;
  v_p int;
  v_prosrc text;
  v_secdef boolean;
  v_cfg text;
  v_lang text;
  v_owner_ok boolean;
  v_pub boolean;
  v_anon boolean;
  v_auth boolean;
  v_cnt_name int;
  v_acl_bad int;
  v_args text;
  v_ret text;
  v_vol "char";
  v_strict boolean;
  v_par "char";
  v_leak boolean;
  v_kind "char";
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.5: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  v_def := $B13A_DEF_BROWSER$
CREATE FUNCTION public.b13a_browser_transition(
  p_run_id              uuid,
  p_from_stage          text,
  p_to_stage            text,
  p_service_job_id      bigint      DEFAULT NULL,
  p_amount              numeric     DEFAULT NULL,
  p_payment_method      text        DEFAULT NULL,
  p_bank_coa_code       text        DEFAULT NULL,
  p_paid_at             timestamptz DEFAULT NULL,
  p_idempotency_key     uuid        DEFAULT NULL,
  p_slip_url            text        DEFAULT NULL,
  p_note                text        DEFAULT NULL,
  p_payment_id          bigint      DEFAULT NULL,
  p_payment_jv_entry_id bigint      DEFAULT NULL,
  p_ok                  boolean     DEFAULT NULL,
  p_inserted            boolean     DEFAULT NULL,
  p_ledger_recorded     boolean     DEFAULT NULL,
  p_accounting_posted   boolean     DEFAULT NULL,
  p_paid_total          numeric     DEFAULT NULL,
  p_outstanding         numeric     DEFAULT NULL,
  p_jv_status           text        DEFAULT NULL,
  p_jv_reason           text        DEFAULT NULL,
  p_failure_code        text        DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn_browser$
DECLARE
  -- B13A-FN-BROWSER-V1 (sanctioned writer 1 — authenticated browser CAS เท่านั้น)
  v_uid        uuid := auth.uid();
  v_staging_ok boolean := false;
  v_run        public._staging_b13a_runs%ROWTYPE;
  v_chk        public._staging_b13a_runs%ROWTYPE;
  v_job        public.service_jobs%ROWTYPE;
  v_pay        public.service_payments%ROWTYPE;
  v_pay_count  int;
  v_je_count   int;
  v_jl_count   int;
  v_paid       numeric(14,2);
  v_n          int;
BEGIN
  -- (0) authenticated actor เท่านั้น
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'B13A CAS: ต้องเรียกด้วย authenticated session (auth.uid() เป็น NULL)' USING ERRCODE = '42501';
  END IF;

  -- (1) [B13A-INTERLOCK] sentinel หนึ่งแถว + confirm_text ตรง current_date ของ DB session
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- (2) lock exact run (FOR UPDATE) + exact actor + exact expected stage (duplicate = reject ที่นี่)
  SELECT * INTO v_run FROM public._staging_b13a_runs WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B13A CAS: ไม่พบ run — รัน owner bootstrap ก่อน';
  END IF;
  IF v_run.run_id <> p_run_id THEN
    RAISE EXCEPTION 'B13A CAS: run_id ไม่ตรง run ปัจจุบัน — reject';
  END IF;
  IF v_run.actor_id <> v_uid THEN
    RAISE EXCEPTION 'B13A CAS: session actor ไม่ตรง actor ของ run — reject' USING ERRCODE = '42501';
  END IF;
  IF v_run.stage <> p_from_stage THEN
    RAISE EXCEPTION 'B13A CAS: expected stage ไม่ตรง (run อยู่ % แต่ caller อ้าง %) — duplicate/skip = reject', v_run.stage, p_from_stage;
  END IF;

  -- (3) transition allowlist ของ browser CAS — no skip/reverse · terminal ไม่มี outgoing
  IF NOT ( (p_from_stage = 'prepared'    AND p_to_stage = 'gates_passed')
        OR (p_from_stage = 'gates_passed' AND p_to_stage = 'r1_inflight')
        OR (p_from_stage = 'r1_inflight' AND p_to_stage IN ('r1_recorded', 'failed_incomplete'))
        OR (p_from_stage = 'r1_recorded' AND p_to_stage IN ('r2_inflight', 'failed_incomplete'))
        OR (p_from_stage = 'r2_inflight' AND p_to_stage IN ('r2_verified', 'failed_incomplete')) ) THEN
    RAISE EXCEPTION 'B13A CAS: transition % -> % ไม่อยู่ใน allowlist ของ browser CAS — reject', p_from_stage, p_to_stage;
  END IF;

  -- (4) NULL-safe full-field intent comparison — ทุก transition หลัง intent snapshot
  --     (from-stage r1_inflight/r1_recorded/r2_inflight ทั้ง success และ failure)
  --     เทียบครบ 8 fields: field ใดไม่ตรง = reject ก่อน stage/evidence mutation ใด ๆ
  --     ห้าม fallback · ห้ามเขียนทับ stored intent (ไม่มี branch ใดเขียน intent อีกหลัง snapshot)
  IF p_from_stage IN ('r1_inflight', 'r1_recorded', 'r2_inflight') THEN
    IF p_service_job_id  IS DISTINCT FROM v_run.service_job_id
       OR p_amount          IS DISTINCT FROM v_run.amount
       OR p_payment_method  IS DISTINCT FROM v_run.payment_method
       OR p_bank_coa_code   IS DISTINCT FROM v_run.bank_coa_code
       OR p_paid_at         IS DISTINCT FROM v_run.paid_at
       OR p_idempotency_key IS DISTINCT FROM v_run.idempotency_key
       OR p_slip_url        IS DISTINCT FROM v_run.slip_url
       OR p_note            IS DISTINCT FROM v_run.note THEN
      RAISE EXCEPTION 'B13A CAS: intent ของ caller ไม่ตรง stored intent (เทียบ NULL-safe ครบ 8 fields) — reject ก่อน mutation · ห้าม regenerate paidAt/idempotency';
    END IF;
  END IF;

  -- (5) prepared → gates_passed : gates proof (ยังไม่มี intent — caller ต้องส่ง intent เป็น NULL ทั้งหมด)
  IF p_from_stage = 'prepared' AND p_to_stage = 'gates_passed' THEN
    IF p_amount IS NOT NULL OR p_payment_method IS NOT NULL OR p_bank_coa_code IS NOT NULL
       OR p_paid_at IS NOT NULL OR p_idempotency_key IS NOT NULL OR p_slip_url IS NOT NULL
       OR p_note IS NOT NULL OR p_payment_id IS NOT NULL OR p_payment_jv_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'B13A CAS(gates): ขั้น gates ห้ามส่ง intent/IDs (ยังไม่ถึงขั้น snapshot)';
    END IF;
    IF p_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'B13A CAS(gates): gates ต้องผ่านครบ (ok=true) เท่านั้นจึง transition ได้';
    END IF;
    -- server ตรวจ business rows: seeded job ยัง exact + recognition JV ยังถูกต้องจริง
    SELECT * INTO v_job FROM public.service_jobs WHERE id = v_run.service_job_id;
    IF NOT FOUND OR v_job.status <> 'delivered' OR v_job.finance_flow_version IS DISTINCT FROM 2
       OR round(v_job.total_cost, 2) <> 1000.00 THEN
      RAISE EXCEPTION 'B13A CAS(gates): seeded job ไม่อยู่ในสภาพ delivered/flow2/1000.00 — STOP';
    END IF;
    IF NOT public.service_job_has_recognition_jv(v_run.service_job_id) THEN
      RAISE EXCEPTION 'B13A CAS(gates): recognition JV ไม่ผ่าน validator — STOP';
    END IF;
    INSERT INTO public._staging_b13a_evidence (run_id, step, source, ok)
    VALUES (p_run_id, 'gates', 'browser_cas', true);
    UPDATE public._staging_b13a_runs
       SET stage = 'gates_passed', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'prepared';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A CAS(gates): transition affected % แถว (ต้อง 1)', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'gates_passed');
  END IF;

  -- (6) gates_passed → r1_inflight : INITIAL INTENT SNAPSHOT (ครั้งเดียว · immutable)
  --     transition เดียวที่ stored intent ยังเป็น NULL — ห้าม pre-compare caller intent
  --     กับ stored NULL values (branch นี้จึงไม่มี comparison กับ stored intent เลย)
  IF p_from_stage = 'gates_passed' AND p_to_stage = 'r1_inflight' THEN
    -- (6a) ก่อน snapshot: intent columns ทั้งหมดต้องยัง NULL (มีค่าแล้ว = ห้าม overwrite)
    IF v_run.amount IS NOT NULL OR v_run.payment_method IS NOT NULL OR v_run.bank_coa_code IS NOT NULL
       OR v_run.paid_at IS NOT NULL OR v_run.idempotency_key IS NOT NULL
       OR v_run.slip_url IS NOT NULL OR v_run.note IS NOT NULL THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): stored intent มีค่าอยู่แล้ว — intent snapshot เป็น immutable ห้าม overwrite';
    END IF;
    -- (6b) validate intent ครบ 8 fields (type/range) — cash 100.00 เท่านั้นสำหรับ B13a
    IF p_service_job_id IS NULL OR p_service_job_id <> v_run.service_job_id THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): service_job_id ต้องตรง seeded job ของ run';
    END IF;
    SELECT * INTO v_job FROM public.service_jobs WHERE id = v_run.service_job_id
       AND job_no = 'B13ATEST-CASH-1' AND status = 'delivered' AND finance_flow_version = 2;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): seeded job ไม่อยู่ในสภาพที่คาด — STOP';
    END IF;
    IF p_amount IS NULL OR round(p_amount, 2) <> 100.00 THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): amount ต้องเป็น 100.00 เป๊ะ (ได้ %)', p_amount;
    END IF;
    IF p_payment_method IS DISTINCT FROM 'cash' THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): payment_method ต้องเป็น cash เท่านั้น';
    END IF;
    IF p_bank_coa_code IS NOT NULL OR p_slip_url IS NOT NULL THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): เงินสดต้องไม่มี bank_coa_code/slip_url';
    END IF;
    IF p_paid_at IS NULL OR p_paid_at = 'infinity'::timestamptz OR p_paid_at = '-infinity'::timestamptz THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): paid_at ต้องเป็นเวลาจริง';
    END IF;
    -- effective floor ตรง source ของ record_service_payment_v2 (วันตามเวลาไทย ≥ 2026-07-01)
    IF (p_paid_at AT TIME ZONE 'Asia/Bangkok')::date < DATE '2026-07-01' THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): paid_at (%) ต่ำกว่า effective floor 2026-07-01 (เวลาไทย)',
        (p_paid_at AT TIME ZONE 'Asia/Bangkok')::date;
    END IF;
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): idempotency_key ต้องเป็น UUID (NULL ไม่ได้)';
    END IF;
    IF p_note IS NULL OR position(p_run_id::text IN p_note) = 0 THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): note ต้องผูก exact run (มี run_id อยู่ในข้อความ)';
    END IF;
    -- (6c) เขียน intent NULL → exact value ครั้งเดียว + transition ใน UPDATE เดียว (atomic)
    --      predicate ล็อกว่า intent ยัง NULL ทุกช่อง — เขียนซ้ำ/ทับเป็นไปไม่ได้ในระดับ SQL
    UPDATE public._staging_b13a_runs
       SET amount = round(p_amount, 2), payment_method = p_payment_method,
           bank_coa_code = p_bank_coa_code, paid_at = p_paid_at,
           idempotency_key = p_idempotency_key, slip_url = p_slip_url, note = p_note,
           stage = 'r1_inflight', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'gates_passed'
       AND amount IS NULL AND payment_method IS NULL AND bank_coa_code IS NULL
       AND paid_at IS NULL AND idempotency_key IS NULL AND slip_url IS NULL AND note IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): intent snapshot affected % แถว (ต้อง 1) — ยกเลิกทั้ง transaction', v_n;
    END IF;
    -- (6d) read-back exact ทุก field — ไม่ตรง = ยกเลิกทั้ง transaction
    SELECT * INTO v_chk FROM public._staging_b13a_runs WHERE singleton AND run_id = p_run_id;
    IF v_chk.stage <> 'r1_inflight'
       OR v_chk.service_job_id  IS DISTINCT FROM p_service_job_id
       OR v_chk.amount          IS DISTINCT FROM round(p_amount, 2)
       OR v_chk.payment_method  IS DISTINCT FROM p_payment_method
       OR v_chk.bank_coa_code   IS DISTINCT FROM p_bank_coa_code
       OR v_chk.paid_at         IS DISTINCT FROM p_paid_at
       OR v_chk.idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_chk.slip_url        IS DISTINCT FROM p_slip_url
       OR v_chk.note            IS DISTINCT FROM p_note THEN
      RAISE EXCEPTION 'B13A CAS(snapshot): read-back ไม่ตรง intent ที่เขียน — ยกเลิกทั้ง transaction';
    END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'r1_inflight');
  END IF;

  -- (7) r1_inflight → r1_recorded : one-time ID binding + server ตรวจ business rows + evidence r1
  IF p_from_stage = 'r1_inflight' AND p_to_stage = 'r1_recorded' THEN
    IF v_run.payment_id IS NOT NULL OR v_run.payment_jv_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'B13A CAS(r1): IDs ถูก bind ไปแล้ว — one-time binding ห้ามแก้';
    END IF;
    IF p_payment_id IS NULL OR p_payment_id <= 0 OR p_payment_jv_entry_id IS NULL OR p_payment_jv_entry_id <= 0 THEN
      RAISE EXCEPTION 'B13A CAS(r1): ต้อง bind exact positive payment_id + payment_jv_entry_id';
    END IF;
    -- server ตรวจ payment row จริงทุกช่อง เทียบ stored intent + created_by = actor
    SELECT count(*) INTO v_pay_count FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_pay_count <> 1 THEN
      RAISE EXCEPTION 'B13A CAS(r1): payment ของ job ต้องมี 1 แถวเป๊ะ (พบ %)', v_pay_count;
    END IF;
    SELECT * INTO v_pay FROM public.service_payments sp WHERE sp.id = p_payment_id;
    IF NOT FOUND OR v_pay.service_job_id <> v_run.service_job_id
       OR v_pay.idempotency_key IS DISTINCT FROM v_run.idempotency_key
       OR round(v_pay.amount, 2) IS DISTINCT FROM v_run.amount
       OR v_pay.payment_method IS DISTINCT FROM v_run.payment_method
       OR v_pay.bank_coa_code IS DISTINCT FROM v_run.bank_coa_code
       OR v_pay.paid_at IS DISTINCT FROM v_run.paid_at
       OR v_pay.slip_url IS DISTINCT FROM v_run.slip_url
       OR v_pay.note IS DISTINCT FROM v_run.note
       OR v_pay.created_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'B13A CAS(r1): payment row ไม่ตรง stored intent/actor ทุกช่อง — reject';
    END IF;
    -- payment JV ต้องมีจริง approved + source exact + 2 บรรทัด + ผ่าน validator ฝั่ง DB
    SELECT count(*) INTO v_je_count FROM public.journal_entries je
     WHERE je.source_table = 'service_payments' AND je.source_id = p_payment_id
       AND lower(coalesce(je.status, '')) = 'approved';
    IF v_je_count <> 1 THEN
      RAISE EXCEPTION 'B13A CAS(r1): payment JV (approved) ต้องมี 1 ใบเป๊ะ (พบ %)', v_je_count;
    END IF;
    PERFORM 1 FROM public.journal_entries je
     WHERE je.id = p_payment_jv_entry_id AND je.source_table = 'service_payments'
       AND je.source_id = p_payment_id AND lower(coalesce(je.status, '')) = 'approved';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'B13A CAS(r1): payment_jv_entry_id ไม่ตรง JV ของ payment นี้ — reject';
    END IF;
    SELECT count(*) INTO v_jl_count FROM public.journal_lines jl
     WHERE jl.entry_id = p_payment_jv_entry_id
       AND (round(coalesce(jl.debit, 0), 2) <> 0 OR round(coalesce(jl.credit, 0), 2) <> 0);
    IF v_jl_count <> 2 THEN
      RAISE EXCEPTION 'B13A CAS(r1): payment JV ต้องมี 2 บรรทัดไม่เป็นศูนย์ (พบ %)', v_jl_count;
    END IF;
    IF NOT public.service_payment_jv_is_valid(p_payment_id) THEN
      RAISE EXCEPTION 'B13A CAS(r1): service_payment_jv_is_valid = false — JV ไม่ถูกต้อง (ใช้ failure transition แทน)';
    END IF;
    -- paid/outstanding ตรวจจากผลรวมจริง (Σ payments − Σ reversals)
    SELECT round(coalesce((SELECT sum(sp.amount) FROM public.service_payments sp
                            WHERE sp.service_job_id = v_run.service_job_id), 0)
               - coalesce((SELECT sum(r.amount) FROM public.service_payment_reversals r
                            JOIN public.service_payments p2 ON p2.id = r.payment_id
                           WHERE p2.service_job_id = v_run.service_job_id), 0), 2)
      INTO v_paid;
    IF v_paid <> 100.00 THEN
      RAISE EXCEPTION 'B13A CAS(r1): paid total จริง = % (ต้อง 100.00)', v_paid;
    END IF;
    -- evidence r1 ต้องตรงสัญญา client: ok/inserted/ledgerRecorded/accountingPosted=true ·
    -- jv.status=posted · totals 100/900
    IF p_ok IS DISTINCT FROM true OR p_inserted IS DISTINCT FROM true
       OR p_ledger_recorded IS DISTINCT FROM true OR p_accounting_posted IS DISTINCT FROM true
       OR p_jv_status IS DISTINCT FROM 'posted'
       OR round(coalesce(p_paid_total, -1), 2) <> 100.00
       OR round(coalesce(p_outstanding, -1), 2) <> 900.00 THEN
      RAISE EXCEPTION 'B13A CAS(r1): evidence ไม่ตรงสัญญา r1 (ok/inserted/ledger/posted=true · jv_status=posted · 100/900)';
    END IF;
    INSERT INTO public._staging_b13a_evidence
      (run_id, step, source, ok, payment_id, payment_jv_entry_id, inserted,
       ledger_recorded, accounting_posted, paid_total, outstanding, jv_status, jv_reason)
    VALUES
      (p_run_id, 'r1', 'browser_cas', true, p_payment_id, p_payment_jv_entry_id, true,
       true, true, 100.00, 900.00, 'posted', p_jv_reason);
    UPDATE public._staging_b13a_runs
       SET payment_id = p_payment_id, payment_jv_entry_id = p_payment_jv_entry_id,
           stage = 'r1_recorded', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'r1_inflight'
       AND payment_id IS NULL AND payment_jv_entry_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A CAS(r1): ID binding affected % แถว (ต้อง 1)', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'r1_recorded',
                              'payment_id', p_payment_id, 'payment_jv_entry_id', p_payment_jv_entry_id);
  END IF;

  -- (8) r1_recorded → r2_inflight : ใช้ intent เดิมทุก field (เทียบแล้วใน (4)) + IDs ต้องตรงที่ bind
  IF p_from_stage = 'r1_recorded' AND p_to_stage = 'r2_inflight' THEN
    IF p_payment_id IS DISTINCT FROM v_run.payment_id
       OR p_payment_jv_entry_id IS DISTINCT FROM v_run.payment_jv_entry_id THEN
      RAISE EXCEPTION 'B13A CAS(r2-inflight): IDs ต้องตรงกับที่ bind แล้ว (bind แล้วห้ามแก้)';
    END IF;
    UPDATE public._staging_b13a_runs
       SET stage = 'r2_inflight', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'r1_recorded';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A CAS(r2-inflight): affected % แถว (ต้อง 1)', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'r2_inflight');
  END IF;

  -- (9) r2_inflight → r2_verified : duplicate-valid โดยไม่มี write ซ้ำ (same IDs · inserted=false)
  IF p_from_stage = 'r2_inflight' AND p_to_stage = 'r2_verified' THEN
    IF p_payment_id IS DISTINCT FROM v_run.payment_id
       OR p_payment_jv_entry_id IS DISTINCT FROM v_run.payment_jv_entry_id THEN
      RAISE EXCEPTION 'B13A CAS(r2): IDs ต้องเป็นตัวเดิมที่ bind แล้วเป๊ะ (duplicate-valid ต้องคืน entry เดิม)';
    END IF;
    -- server ตรวจ: ไม่มี write ซ้ำจริง — payment ยัง 1 แถว · payment JV ยัง 1 ใบ · totals เดิม
    SELECT count(*) INTO v_pay_count FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_pay_count <> 1 THEN
      RAISE EXCEPTION 'B13A CAS(r2): พบ payment % แถว (retry ต้องไม่ insert ซ้ำ) — FAIL', v_pay_count;
    END IF;
    SELECT count(*) INTO v_je_count FROM public.journal_entries je
     WHERE je.source_table = 'service_payments' AND je.source_id = v_run.payment_id;
    IF v_je_count <> 1 THEN
      RAISE EXCEPTION 'B13A CAS(r2): พบ payment JV % ใบ (retry ต้องไม่สร้าง JV ซ้ำ) — FAIL', v_je_count;
    END IF;
    IF NOT public.service_payment_jv_is_valid(v_run.payment_id) THEN
      RAISE EXCEPTION 'B13A CAS(r2): payment JV ไม่ valid หลัง retry — FAIL';
    END IF;
    SELECT round(coalesce((SELECT sum(sp.amount) FROM public.service_payments sp
                            WHERE sp.service_job_id = v_run.service_job_id), 0)
               - coalesce((SELECT sum(r.amount) FROM public.service_payment_reversals r
                            JOIN public.service_payments p2 ON p2.id = r.payment_id
                           WHERE p2.service_job_id = v_run.service_job_id), 0), 2)
      INTO v_paid;
    IF v_paid <> 100.00 THEN
      RAISE EXCEPTION 'B13A CAS(r2): paid total จริง = % (ต้อง 100.00 เท่าเดิม)', v_paid;
    END IF;
    -- evidence r2 ตรงสัญญา retry: ok/ledger/posted=true · inserted=false · jv.reason=duplicate-valid
    IF p_ok IS DISTINCT FROM true OR p_inserted IS DISTINCT FROM false
       OR p_ledger_recorded IS DISTINCT FROM true OR p_accounting_posted IS DISTINCT FROM true
       OR p_jv_reason IS DISTINCT FROM 'duplicate-valid'
       OR round(coalesce(p_paid_total, -1), 2) <> 100.00
       OR round(coalesce(p_outstanding, -1), 2) <> 900.00 THEN
      RAISE EXCEPTION 'B13A CAS(r2): evidence ไม่ตรงสัญญา r2 (inserted=false · duplicate-valid · 100/900)';
    END IF;
    INSERT INTO public._staging_b13a_evidence
      (run_id, step, source, ok, payment_id, payment_jv_entry_id, inserted,
       ledger_recorded, accounting_posted, paid_total, outstanding, jv_status, jv_reason)
    VALUES
      (p_run_id, 'r2', 'browser_cas', true, v_run.payment_id, v_run.payment_jv_entry_id, false,
       true, true, 100.00, 900.00, p_jv_status, 'duplicate-valid');
    UPDATE public._staging_b13a_runs
       SET stage = 'r2_verified', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'r2_inflight';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A CAS(r2): affected % แถว (ต้อง 1)', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'r2_verified');
  END IF;

  -- (10) failure transitions (post-snapshot) → failed_incomplete
  --      ledger-without-JV: RPC ok=true + ledgerRecorded=true + accountingPosted=false
  --      ต้อง bind exact payment ID (server ตรวจ payment ทุกช่อง) · JV entry ID = NULL ได้เมื่อ
  --      ไม่มี header (พบ orphan/invalid header จึง bind) · ห้ามบังคับ valid JV ใน failure path
  --      unknown outcome: browser ห้ามเรียก failure — คง r1_inflight ให้ owner classify
  IF p_to_stage = 'failed_incomplete' THEN
    IF p_failure_code IS NULL OR p_failure_code NOT IN ('LEDGER_WITHOUT_JV', 'JV_INVALID') THEN
      RAISE EXCEPTION 'B13A CAS(failure): browser failure_code ต้องเป็น LEDGER_WITHOUT_JV หรือ JV_INVALID (อื่น ๆ = owner classification)';
    END IF;
    IF p_ledger_recorded IS DISTINCT FROM true OR p_accounting_posted IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'B13A CAS(failure): failure ของ browser = ledgerRecorded=true + accountingPosted=false เท่านั้น (เงินไม่เข้า ledger = คง stage ให้ owner classify)';
    END IF;
    IF v_run.payment_id IS NULL THEN
      -- ยังไม่เคย bind (มาจาก r1_inflight) — ต้อง bind exact payment ที่พบจริง
      IF p_payment_id IS NULL OR p_payment_id <= 0 THEN
        RAISE EXCEPTION 'B13A CAS(failure): ต้อง bind exact payment ID (ledger เขียนแล้ว) — ถ้าไม่พบ payment = อย่าเรียก failure ให้คง r1_inflight รอ owner classify';
      END IF;
      SELECT * INTO v_pay FROM public.service_payments sp WHERE sp.id = p_payment_id;
      IF NOT FOUND OR v_pay.service_job_id <> v_run.service_job_id
         OR v_pay.idempotency_key IS DISTINCT FROM v_run.idempotency_key
         OR round(v_pay.amount, 2) IS DISTINCT FROM v_run.amount
         OR v_pay.payment_method IS DISTINCT FROM v_run.payment_method
         OR v_pay.bank_coa_code IS DISTINCT FROM v_run.bank_coa_code
         OR v_pay.paid_at IS DISTINCT FROM v_run.paid_at
         OR v_pay.slip_url IS DISTINCT FROM v_run.slip_url
         OR v_pay.note IS DISTINCT FROM v_run.note
         OR v_pay.created_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'B13A CAS(failure): payment row ไม่ตรง stored intent/actor — reject';
      END IF;
    ELSE
      IF p_payment_id IS DISTINCT FROM v_run.payment_id THEN
        RAISE EXCEPTION 'B13A CAS(failure): payment ID ต้องตรงที่ bind แล้ว (ห้ามแก้)';
      END IF;
    END IF;
    -- JV entry ID: optional — ถ้าส่งมาต้องชี้ header ของ payment นี้จริง (สภาพใดก็ได้ ห้ามบังคับ valid)
    IF p_payment_jv_entry_id IS NOT NULL THEN
      PERFORM 1 FROM public.journal_entries je
       WHERE je.id = p_payment_jv_entry_id AND je.source_table = 'service_payments'
         AND je.source_id = p_payment_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'B13A CAS(failure): payment_jv_entry_id ไม่ใช่ header ของ payment นี้ — reject';
      END IF;
    END IF;
    INSERT INTO public._staging_b13a_evidence
      (run_id, step, source, ok, payment_id, payment_jv_entry_id, inserted,
       ledger_recorded, accounting_posted, paid_total, outstanding, jv_status, jv_reason, failure_code)
    VALUES
      (p_run_id, 'failure', 'browser_cas', true, p_payment_id, p_payment_jv_entry_id, p_inserted,
       true, false, p_paid_total, p_outstanding, p_jv_status, p_jv_reason, p_failure_code);
    UPDATE public._staging_b13a_runs
       SET payment_id = coalesce(v_run.payment_id, p_payment_id),
           payment_jv_entry_id = coalesce(v_run.payment_jv_entry_id, p_payment_jv_entry_id),
           failure_code = p_failure_code,
           stage = 'failed_incomplete', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = p_from_stage;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A CAS(failure): affected % แถว (ต้อง 1)', v_n; END IF;
    -- retain business rows/evidence ทั้งหมด — STOP รอ owner-authorized recovery review
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'failed_incomplete',
                              'failure_code', p_failure_code);
  END IF;

  RAISE EXCEPTION 'B13A CAS: unreachable transition — reject';
END $fn_browser$;
$B13A_DEF_BROWSER$;
  -- expected body = ข้อความระหว่าง $fn_browser$ ... $fn_browser$ (source เดียว ใช้ทั้ง CREATE และ verify)
  v_p := position('$fn_browser$' IN v_def);
  v_body := substring(v_def FROM v_p + length('$fn_browser$'));
  v_body := left(v_body, position('$fn_browser$' IN v_body) - 1);

  -- ผูกด้วย exact signature เท่านั้น — ชื่อเดียวกันแต่ signature อื่น = STOP
  v_oid := to_regprocedure('public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text)');
  IF v_oid IS NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'b13a_browser_transition') THEN
    RAISE EXCEPTION 'B13A S0.5: พบ b13a_browser_transition แต่ signature ไม่ตรงเวอร์ชันนี้ — STOP ห้าม overwrite/reuse';
  END IF;
  -- ห้ามมี overload: ชื่อนี้ต้องมีหนึ่ง signature เดียวใน pg_proc เท่านั้น
  -- (overload ทำ PostgREST resolution เพี้ยน/expose RPC ที่ไม่ตั้งใจ)
  SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'b13a_browser_transition';
  IF v_cnt_name > 1 THEN
    RAISE EXCEPTION 'B13A S0.5: b13a_browser_transition มี % signature (อนุญาตหนึ่งเดียว — พบ overload) — STOP ห้าม overwrite/reuse', v_cnt_name;
  END IF;

  IF v_oid IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','), l.lanname,
           (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_prosrc, v_secdef, v_cfg, v_lang, v_owner_ok
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    -- body ต้องตรงเวอร์ชันนี้ byte-ต่อ-byte — marker substring อย่างเดียวไม่พอ
    IF v_prosrc IS DISTINCT FROM v_body THEN
      RAISE EXCEPTION 'B13A S0.5: b13a_browser_transition body ไม่ตรงเวอร์ชันนี้เป๊ะ — STOP ห้าม overwrite/reuse';
    END IF;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'B13A S0.5: b13a_browser_transition ต้องเป็น SECURITY DEFINER — STOP';
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=public' THEN
      RAISE EXCEPTION 'B13A S0.5: proconfig ต้องเป็น search_path=public เป๊ะ (ได้ %) — STOP', v_cfg;
    END IF;
    IF v_lang IS DISTINCT FROM 'plpgsql' THEN
      RAISE EXCEPTION 'B13A S0.5: language ต้องเป็น plpgsql (ได้ %) — STOP', v_lang;
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.5: owner ของ function ไม่ใช่ trusted role — STOP';
    END IF;
    -- API metadata exact: argument names/defaults · return type · attributes
    -- (runbook เรียกด้วย named args + อาศัย defaults — เปลี่ยนชื่อ/ค่า default = สัญญาเปลี่ยน)
    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
           p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prokind
      INTO v_args, v_ret, v_vol, v_strict, v_par, v_leak, v_kind
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_args IS DISTINCT FROM 'p_run_id uuid, p_from_stage text, p_to_stage text, p_service_job_id bigint DEFAULT NULL::bigint, p_amount numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text, p_bank_coa_code text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key uuid DEFAULT NULL::uuid, p_slip_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_payment_id bigint DEFAULT NULL::bigint, p_payment_jv_entry_id bigint DEFAULT NULL::bigint, p_ok boolean DEFAULT NULL::boolean, p_inserted boolean DEFAULT NULL::boolean, p_ledger_recorded boolean DEFAULT NULL::boolean, p_accounting_posted boolean DEFAULT NULL::boolean, p_paid_total numeric DEFAULT NULL::numeric, p_outstanding numeric DEFAULT NULL::numeric, p_jv_status text DEFAULT NULL::text, p_jv_reason text DEFAULT NULL::text, p_failure_code text DEFAULT NULL::text' THEN
      RAISE EXCEPTION 'B13A S0.5: argument names/defaults ไม่ตรงเป๊ะ (%) — STOP ห้าม reuse', v_args;
    END IF;
    IF v_ret IS DISTINCT FROM 'jsonb' THEN
      RAISE EXCEPTION 'B13A S0.5: return type ไม่ตรง (%) — STOP ห้าม reuse', v_ret;
    END IF;
    IF v_vol IS DISTINCT FROM 'v' OR v_strict OR v_par IS DISTINCT FROM 'u'
       OR v_leak OR v_kind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'B13A S0.5: function attributes ไม่ตรง (volatile=% strict=% parallel=% leakproof=% kind=%) — STOP ห้าม reuse',
        v_vol, v_strict, v_par, v_leak, v_kind;
    END IF;
    -- EXECUTE grants exact รวม PUBLIC (aclexplode คลี่ default acl ด้วย — proacl NULL = PUBLIC execute)
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('anon')::oid AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE')
      INTO v_pub, v_anon, v_auth
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid;
    IF COALESCE(v_pub, false) OR COALESCE(v_anon, false) OR (COALESCE(v_auth, false) IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'B13A S0.5: execute grants ไม่ตรง (PUBLIC=% anon=% authenticated=%) — STOP',
        COALESCE(v_pub, false), COALESCE(v_anon, false), COALESCE(v_auth, false);
    END IF;
    -- grantee allowlist ทั้งหมด: function owner + authenticated(EXECUTE) เท่านั้น — grantee อื่นทุกตัว (role ใดก็ตาม) = STOP
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND NOT (a.grantee = p.proowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE'));
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.5: พบ grantee นอก allowlist % รายการ (อนุญาต: function owner + authenticated(EXECUTE)) — STOP ห้าม reuse', v_acl_bad;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณี (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.5: พบ EXECUTE WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_acl_bad;
    END IF;
    RAISE NOTICE 'B13A S0.5: reuse b13a_browser_transition (exact: signature/body/secdef/config/language/owner/grants)';
  ELSE
    EXECUTE v_def;
    EXECUTE 'REVOKE ALL ON FUNCTION public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text) TO authenticated';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = owner + authenticated(EXECUTE) เท่านั้น
    v_oid := to_regprocedure('public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text)');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: ไม่พบ function หลัง CREATE — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'b13a_browser_transition';
    IF v_cnt_name <> 1 THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: พบ % signature (ต้องหนึ่งเดียว — overload) — rollback ทั้ง block', v_cnt_name;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND NOT (a.grantee = p.proowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE'));
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: พบ grantee นอก allowlist % รายการ หลัง REVOKE/GRANT — rollback ทั้ง block', v_acl_bad;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = v_oid AND a.grantee = to_regrole('authenticated')::oid
                      AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: ขาด EXECUTE grant ของ authenticated — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: พบ EXECUTE WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT p.prosecdef, (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_secdef, v_owner_ok FROM pg_proc p WHERE p.oid = v_oid;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: ต้องเป็น SECURITY DEFINER (prosecdef=true) — rollback ทั้ง block';
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.5 postcondition: function owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.5: created b13a_browser_transition (SECURITY DEFINER · authenticated เท่านั้น)';
  END IF;
END $b13a_s0_fn_browser$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.6 — Writer 2: b13a_owner_finalize (SQL Editor เท่านั้น · no API grants)
--   actions: verify_db · teardown · attest_cleanup · complete · abort_no_payment ·
--            classify_failed_incomplete · classify_failed_no_write
--   Full transition contract (A6): terminal ไม่มี outgoing · teardown_complete/
--   auth_cleanup_complete = intentionally resumable (action เดิม + run เดิม · ห้ามสร้าง
--   run ใหม่ · ห้าม clear context · ห้ามเปลี่ยนเป็น failed_no_write)
--   owner path ไม่ใช้ auth.uid()=actor_id — introspect trusted owner context จริง ไม่เดา role name
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_fn_finalize$
DECLARE
  v_staging_ok boolean := false;
  v_oid oid;
  v_def text;
  v_body text;
  v_p int;
  v_prosrc text;
  v_secdef boolean;
  v_cfg text;
  v_lang text;
  v_owner_ok boolean;
  v_pub boolean;
  v_anon boolean;
  v_auth boolean;
  v_cnt_name int;
  v_acl_bad int;
  v_args text;
  v_ret text;
  v_vol "char";
  v_strict boolean;
  v_par "char";
  v_leak boolean;
  v_kind "char";
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.6: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  v_def := $B13A_DEF_FINALIZE$
CREATE FUNCTION public.b13a_owner_finalize(
  p_run_id               uuid,
  p_action               text,
  p_failure_code         text    DEFAULT NULL,
  p_session_null         boolean DEFAULT NULL,
  p_clean_login_rejected boolean DEFAULT NULL,
  p_local_cleanup        boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn_finalize$
DECLARE
  -- B13A-FN-FINALIZE-V1 (sanctioned writer 2 — SQL Editor เท่านั้น · no API grants)
  v_staging_ok  boolean := false;
  v_trusted     boolean := false;
  v_run         public._staging_b13a_runs%ROWTYPE;
  v_job         public.service_jobs%ROWTYPE;
  v_pay         public.service_payments%ROWTYPE;
  v_map         public.account_mapping%ROWTYPE;
  v_rec_je_id   bigint;
  v_found_pay   bigint;
  v_cnt         int;
  v_cnt2        int;
  v_paid        numeric(14,2);
  v_n           int;
  v_total       int := 0;
BEGIN
  -- (0) trusted owner context จริง — introspect ไม่เดา role name · ไม่ใช้ auth.uid()=actor_id
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'B13A FINALIZE: ต้องรันใน SQL Editor (owner context — auth.uid() ต้องเป็น NULL) ห้ามเรียกผ่าน API';
  END IF;
  SELECT r.rolsuper OR r.rolbypassrls INTO v_trusted FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT COALESCE(v_trusted, false) THEN
    RAISE EXCEPTION 'B13A FINALIZE: current_user (%) ไม่ใช่ trusted owner context (ต้อง rolsuper หรือ rolbypassrls จริงจาก pg_roles)', current_user;
  END IF;

  -- (1) [B13A-INTERLOCK] sentinel หนึ่งแถว + confirm_text ตรง current_date ของ DB session
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- (2) action allowlist + lock exact run
  IF p_action NOT IN ('verify_db','teardown','attest_cleanup','complete',
                      'abort_no_payment','classify_failed_incomplete','classify_failed_no_write') THEN
    RAISE EXCEPTION 'B13A FINALIZE: action % ไม่อยู่ใน allowlist', p_action;
  END IF;
  SELECT * INTO v_run FROM public._staging_b13a_runs WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE: ไม่พบ run'; END IF;
  IF v_run.run_id <> p_run_id THEN
    RAISE EXCEPTION 'B13A FINALIZE: run_id ไม่ตรง run ปัจจุบัน — reject';
  END IF;

  -- ══ verify_db : r2_verified → db_verified (validation + transition = atomic) ══
  IF p_action = 'verify_db' THEN
    IF v_run.stage <> 'r2_verified' THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): expected stage r2_verified (run อยู่ %)', v_run.stage;
    END IF;
    IF v_run.payment_id IS NULL OR v_run.payment_jv_entry_id IS NULL THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): IDs ต้องถูก bind แล้ว';
    END IF;
    -- job exact: flow2 / delivered / 1000
    SELECT * INTO v_job FROM public.service_jobs WHERE id = v_run.service_job_id;
    IF NOT FOUND OR v_job.finance_flow_version IS DISTINCT FROM 2 OR v_job.status <> 'delivered'
       OR round(v_job.total_cost, 2) <> 1000.00 OR v_job.job_no <> 'B13ATEST-CASH-1' THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): job ไม่ตรง flow2/delivered/1000 — ใช้ classify_failed_incomplete';
    END IF;
    -- payment หนึ่งแถว cash 100 · bank/slip NULL · exact paid_at/idempotency/note · created_by=actor
    SELECT count(*) INTO v_cnt FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): payment ต้อง 1 แถว (พบ %)', v_cnt; END IF;
    SELECT * INTO v_pay FROM public.service_payments sp WHERE sp.id = v_run.payment_id;
    IF NOT FOUND OR v_pay.service_job_id <> v_run.service_job_id
       OR round(v_pay.amount, 2) <> 100.00 OR v_pay.payment_method <> 'cash'
       OR v_pay.bank_coa_code IS NOT NULL OR v_pay.slip_url IS NOT NULL
       OR v_pay.paid_at IS DISTINCT FROM v_run.paid_at
       OR v_pay.idempotency_key IS DISTINCT FROM v_run.idempotency_key
       OR v_pay.note IS DISTINCT FROM v_run.note
       OR v_pay.created_by IS DISTINCT FROM v_run.actor_id THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): payment row ไม่ตรง intent/actor ทุกช่อง';
    END IF;
    -- reversals = 0 · paid/outstanding = 100/900 จากผลรวมจริง
    SELECT count(*) INTO v_cnt FROM public.service_payment_reversals r WHERE r.payment_id = v_run.payment_id;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): reversal ต้อง 0 (พบ %)', v_cnt; END IF;
    SELECT round(coalesce(sum(sp.amount), 0), 2) INTO v_paid
      FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_paid <> 100.00 OR round(v_job.total_cost - v_paid, 2) <> 900.00 THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): paid/outstanding = %/% (ต้อง 100/900)', v_paid, round(v_job.total_cost - v_paid, 2);
    END IF;
    -- mapping จริงของ job type (ใช้ตรวจบัญชีของ JV ทั้งสองใบ)
    SELECT * INTO v_map FROM public.account_mapping
     WHERE mapping_key = public.service_mapping_key_for_job_type(v_job.job_type) AND is_active;
    IF NOT FOUND OR v_map.recognition_debit_code IS NULL OR v_map.debit_account_code IS NULL THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): account_mapping ของ job type ไม่พร้อม';
    END IF;
    -- recognition JV: 1 header approved / 2 lines / Dr 1200 = 1000 / Cr revenue = 1000
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id;
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): recognition JV header ต้อง 1 ใบ (พบ %)', v_cnt; END IF;
    SELECT je.id INTO v_rec_je_id FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id
       AND lower(coalesce(je.status, '')) = 'approved'
       AND round(coalesce(je.total_debit, -1), 2) = 1000.00
       AND round(coalesce(je.total_credit, -1), 2) = 1000.00;
    IF v_rec_je_id IS NULL THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): recognition JV header ไม่ตรง approved/1000/1000'; END IF;
    SELECT count(*) INTO v_cnt FROM public.journal_lines jl
     WHERE jl.entry_id = v_rec_je_id AND (round(coalesce(jl.debit,0),2) <> 0 OR round(coalesce(jl.credit,0),2) <> 0);
    SELECT count(*) INTO v_cnt2 FROM public.journal_lines jl
     WHERE jl.entry_id = v_rec_je_id
       AND ((jl.account_code = v_map.recognition_debit_code AND round(coalesce(jl.debit,0),2) = 1000.00)
         OR (jl.account_code = v_map.credit_account_code    AND round(coalesce(jl.credit,0),2) = 1000.00));
    IF v_cnt <> 2 OR v_cnt2 <> 2 THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): recognition lines ไม่ตรง Dr %/Cr % = 1000 (nonzero=% exact=%)',
        v_map.recognition_debit_code, v_map.credit_account_code, v_cnt, v_cnt2;
    END IF;
    -- payment JV: 1 header approved / 2 lines / Dr เงินสด = 100 / Cr 1200 = 100 / source exact
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE je.source_table = 'service_payments' AND je.source_id = v_run.payment_id;
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): payment JV header ต้อง 1 ใบ (พบ %)', v_cnt; END IF;
    PERFORM 1 FROM public.journal_entries je
     WHERE je.id = v_run.payment_jv_entry_id AND je.source_table = 'service_payments'
       AND je.source_id = v_run.payment_id AND lower(coalesce(je.status, '')) = 'approved'
       AND round(coalesce(je.total_debit, -1), 2) = 100.00
       AND round(coalesce(je.total_credit, -1), 2) = 100.00;
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): payment JV header ไม่ตรง approved/100/100/source'; END IF;
    SELECT count(*) INTO v_cnt FROM public.journal_lines jl
     WHERE jl.entry_id = v_run.payment_jv_entry_id
       AND (round(coalesce(jl.debit,0),2) <> 0 OR round(coalesce(jl.credit,0),2) <> 0);
    SELECT count(*) INTO v_cnt2 FROM public.journal_lines jl
     WHERE jl.entry_id = v_run.payment_jv_entry_id
       AND ((jl.account_code = v_map.debit_account_code       AND round(coalesce(jl.debit,0),2) = 100.00)
         OR (jl.account_code = v_map.recognition_debit_code   AND round(coalesce(jl.credit,0),2) = 100.00));
    IF v_cnt <> 2 OR v_cnt2 <> 2 THEN
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): payment JV lines ไม่ตรง Dr %/Cr % = 100 (nonzero=% exact=%)',
        v_map.debit_account_code, v_map.recognition_debit_code, v_cnt, v_cnt2;
    END IF;
    -- function-truth ภายใต้ claims ของ actor (scratch เท่านั้น · เคลียร์ทันทีหลังตรวจ)
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_run.actor_id::text, 'role', 'authenticated')::text, true);
    IF NOT public.service_job_has_recognition_jv(v_run.service_job_id)
       OR NOT public.service_payment_jv_is_valid(v_run.payment_id) THEN
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'B13A FINALIZE(verify_db): validator ฝั่ง DB ไม่ผ่าน (recognition/payment JV)';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    -- no orphan/extra: JE ที่อ้าง source B13a ต้องมีแค่ 2 ใบนี้ · ไม่มี reversal JE
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE (je.source_table = 'service_jobs'     AND je.source_id = v_run.service_job_id)
        OR (je.source_table = 'service_payments' AND je.source_id = v_run.payment_id);
    IF v_cnt <> 2 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): JE ของ run ต้องมี 2 ใบเป๊ะ (พบ %)', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE je.source_table = 'service_payment_reversals';
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): พบ reversal JE % ใบ (ต้อง 0)', v_cnt; END IF;
    -- evidence ครบ: gates/r1/r2 ok=true · ไม่มี failure
    SELECT count(*) INTO v_cnt FROM public._staging_b13a_evidence e
     WHERE e.run_id = p_run_id AND e.step IN ('gates','r1','r2') AND e.ok;
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): evidence gates/r1/r2 ต้องครบ ok=true (พบ %)', v_cnt; END IF;
    PERFORM 1 FROM public._staging_b13a_evidence e WHERE e.run_id = p_run_id AND e.step = 'failure';
    IF FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): มี failure evidence — ห้าม verify_db'; END IF;
    -- triggers exact: service_jobs 6 ตัว O + journal triggers enabled
    SELECT count(*) INTO v_cnt FROM pg_trigger t
     WHERE t.tgrelid = 'public.service_jobs'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('trg_service_jobs_metadata_insert','trg_service_jobs_metadata_update_guard',
                        'trg_service_job_v2_freeze','trg_service_jobs_insert_close_guard',
                        'trg_service_jobs_close_guard','trg_service_jobs_delete_guard');
    IF v_cnt <> 6 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): service_jobs triggers enabled=O ต้องครบ 6 (พบ %)', v_cnt; END IF;
    PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_lines'::regclass
       AND t.tgname = 'trg_je_lines_balance' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): trg_je_lines_balance หาย/ถูก disable'; END IF;
    PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_entries'::regclass
       AND t.tgname = 'trg_check_period_locked' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): trg_check_period_locked หาย/ถูก disable'; END IF;

    UPDATE public._staging_b13a_runs SET stage = 'db_verified', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'r2_verified';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(verify_db): transition affected % แถว', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'db_verified');
  END IF;

  -- ══ teardown : db_verified → teardown_complete (ลบ exact IDs · transaction เดียว) ══
  --    ล้มตรงไหน = RAISE = rollback ทั้ง transaction → stage คง db_verified ก่อน classify (A9)
  IF p_action = 'teardown' THEN
    IF v_run.stage <> 'db_verified' THEN
      RAISE EXCEPTION 'B13A FINALIZE(teardown): expected stage db_verified (run อยู่ %)', v_run.stage;
    END IF;
    -- resolve recognition JV id ด้วย exact source (bound job id) — ห้าม job_no/note/wildcard
    SELECT je.id INTO v_rec_je_id FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id;
    IF v_rec_je_id IS NULL THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): ไม่พบ recognition JV ของ job'; END IF;
    -- ก่อน reversal delete: assert count = 0 — มากกว่า 0 = STOP
    SELECT count(*) INTO v_cnt FROM public.service_payment_reversals r WHERE r.payment_id = v_run.payment_id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A FINALIZE(teardown): พบ reversal % แถว (ต้อง 0) — STOP ใช้ classify_failed_incomplete', v_cnt;
    END IF;
    -- ลำดับลบ (exact IDs เท่านั้น): payment JV lines → recognition JV lines →
    -- payment JV header → recognition JV header → defensive reversal (ต้อง 0) → payment → job
    DELETE FROM public.journal_lines WHERE entry_id = v_run.payment_jv_entry_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 2 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): payment JV lines ลบ % (ต้อง 2) — rollback', v_n; END IF;
    DELETE FROM public.journal_lines WHERE entry_id = v_rec_je_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 2 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): recognition JV lines ลบ % (ต้อง 2) — rollback', v_n; END IF;
    DELETE FROM public.journal_entries WHERE id = v_run.payment_jv_entry_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): payment JV header ลบ % (ต้อง 1) — rollback', v_n; END IF;
    DELETE FROM public.journal_entries WHERE id = v_rec_je_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): recognition JV header ลบ % (ต้อง 1) — rollback', v_n; END IF;
    DELETE FROM public.service_payment_reversals WHERE payment_id = v_run.payment_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): defensive reversal delete โดน % แถว (ต้อง 0) — rollback', v_n; END IF;
    DELETE FROM public.service_payments WHERE id = v_run.payment_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): payment ลบ % (ต้อง 1) — rollback', v_n; END IF;
    DELETE FROM public.service_jobs WHERE id = v_run.service_job_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): job ลบ % (ต้อง 1) — rollback', v_n; END IF;
    -- ก่อนจบ transaction: residual = 0 ทั้งหมด · triggers exact · COA/mapping/B12 ไม่ขยับ
    SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id)
         + (SELECT count(*) FROM public.journal_entries je
             WHERE (je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id)
                OR (je.source_table = 'service_payments' AND je.source_id = v_run.payment_id))
         + (SELECT count(*) FROM public.journal_lines jl
             WHERE jl.entry_id IN (v_run.payment_jv_entry_id, v_rec_je_id))
      INTO v_cnt;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): residual = % (ต้อง 0) — rollback', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM pg_trigger t
     WHERE t.tgrelid = 'public.service_jobs'::regclass AND NOT t.tgisinternal AND t.tgenabled IS DISTINCT FROM 'O';
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): trigger service_jobs ไม่ใช่ O % ตัว — rollback', v_cnt; END IF;
    -- COA/mapping unchanged (baseline B12 closeout: COA=68 · account_mapping=36 · 1200 active)
    SELECT count(*) INTO v_cnt FROM public.chart_of_accounts;
    SELECT count(*) INTO v_cnt2 FROM public.account_mapping;
    IF v_cnt <> 68 OR v_cnt2 <> 36 THEN
      RAISE EXCEPTION 'B13A FINALIZE(teardown): COA/mapping = %/% (baseline B12 = 68/36) — rollback', v_cnt, v_cnt2;
    END IF;
    PERFORM 1 FROM public.chart_of_accounts WHERE code = '1200' AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): COA 1200 หาย/inactive — rollback'; END IF;
    -- B12 evidence unchanged + B13a evidence retained + ไม่มี failure evidence
    SELECT count(*) INTO v_cnt FROM public._staging_b12_results r WHERE r.ok;
    IF v_cnt <> 6 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): _staging_b12_results ok=true = % (ต้อง 6) — rollback', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM public._staging_b13a_evidence e
     WHERE e.run_id = p_run_id AND e.step IN ('gates','r1','r2') AND e.ok;
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): B13a evidence ต้อง retained ครบ 3 — rollback'; END IF;
    PERFORM 1 FROM public._staging_b13a_evidence e WHERE e.run_id = p_run_id AND e.step = 'failure';
    IF FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): มี failure evidence — ห้ามออก PASS'; END IF;
    -- certificate + transition (atomic ใน transaction เดียวกับ deletes)
    INSERT INTO public._staging_b13a_results (run_id, certificate, detail)
    VALUES (p_run_id, 'PAYMENT_BEHAVIOR_PASS',
            format('cash 100.00 · r1 posted + r2 duplicate-valid · teardown deleted rows=%s · residual 0', v_total));
    UPDATE public._staging_b13a_runs SET stage = 'teardown_complete', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'db_verified';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(teardown): transition affected % แถว — rollback', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'teardown_complete', 'deleted_rows', v_total);
  END IF;

  -- ══ attest_cleanup : teardown_complete → auth_cleanup_complete (resumable) ══
  --    attestation = คำยืนยันของ owner (human attestation) — ไม่ใช่ DB-observed browser proof
  --    boolean ไม่ครบ = RAISE (ไม่มี state change) → คง teardown_complete · แก้ external
  --    condition แล้วเรียก action เดิมกับ run เดิม — ห้ามสร้าง run ใหม่ · ห้ามไป failed_no_write
  IF p_action = 'attest_cleanup' THEN
    IF v_run.stage <> 'teardown_complete' THEN
      RAISE EXCEPTION 'B13A FINALIZE(attest): expected stage teardown_complete (run อยู่ %)', v_run.stage;
    END IF;
    PERFORM 1 FROM public._staging_b13a_results r
     WHERE r.run_id = p_run_id AND r.certificate = 'PAYMENT_BEHAVIOR_PASS';
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(attest): ต้องมี PAYMENT_BEHAVIOR_PASS ของ run นี้ก่อน'; END IF;
    -- business residual = 0 (re-assert)
    SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id)
      INTO v_cnt;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(attest): business residual = % (ต้อง 0)', v_cnt; END IF;
    -- exact actor cleanup: นับเฉพาะแถวของ actor_id — ห้าม table-wide count
    SELECT count(*) INTO v_cnt  FROM auth.users u    WHERE u.id = v_run.actor_id;
    SELECT count(*) INTO v_cnt2 FROM public.profiles pr WHERE pr.id = v_run.actor_id;
    IF v_cnt <> 0 OR v_cnt2 <> 0 THEN
      RAISE EXCEPTION 'B13A FINALIZE(attest): exact actor ต้องถูกลบแล้ว (auth.users=% profiles=%) — ลบ temp admin ตาม runbook ก่อนแล้วเรียก action เดิมซ้ำ', v_cnt, v_cnt2;
    END IF;
    -- owner ยืนยัน 3 ข้อ (boolean เท่านั้น) — ไม่ครบ = RAISE โดยไม่แตะ state
    IF p_session_null IS DISTINCT FROM true
       OR p_clean_login_rejected IS DISTINCT FROM true
       OR p_local_cleanup IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'B13A FINALIZE(attest): owner attestation (human) ต้อง true ครบ 3 ข้อ (session_null=% clean_login_rejected=% local_cleanup=%) — คง teardown_complete แล้ว retry action เดิมหลังแก้เงื่อนไข',
        p_session_null, p_clean_login_rejected, p_local_cleanup;
    END IF;
    -- write-once attestations 3 แถว (boolean/timestamp เท่านั้น · ไม่มี credential/path/UUID)
    INSERT INTO public._staging_b13a_evidence (run_id, step, source, ok) VALUES
      (p_run_id, 'session_null_attested',         'owner_sql_attestation', true),
      (p_run_id, 'clean_login_rejected_attested', 'owner_sql_attestation', true),
      (p_run_id, 'local_cleanup_attested',        'owner_sql_attestation', true);
    UPDATE public._staging_b13a_runs SET stage = 'auth_cleanup_complete', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'teardown_complete';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(attest): transition affected % แถว', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'auth_cleanup_complete');
  END IF;

  -- ══ complete : auth_cleanup_complete → execution_complete (terminal) ══
  IF p_action = 'complete' THEN
    IF v_run.stage <> 'auth_cleanup_complete' THEN
      RAISE EXCEPTION 'B13A FINALIZE(complete): expected stage auth_cleanup_complete (run อยู่ %)', v_run.stage;
    END IF;
    PERFORM 1 FROM public._staging_b13a_results r
     WHERE r.run_id = p_run_id AND r.certificate = 'PAYMENT_BEHAVIOR_PASS';
    IF NOT FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(complete): ไม่มี PAYMENT_BEHAVIOR_PASS'; END IF;
    SELECT count(*) INTO v_cnt FROM public._staging_b13a_evidence e
     WHERE e.run_id = p_run_id AND e.step IN ('gates','r1','r2') AND e.ok;
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'B13A FINALIZE(complete): evidence gates/r1/r2 ไม่ครบ (พบ %)', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM public._staging_b13a_evidence e
     WHERE e.run_id = p_run_id AND e.source = 'owner_sql_attestation' AND e.ok
       AND e.step IN ('session_null_attested','clean_login_rejected_attested','local_cleanup_attested');
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'B13A FINALIZE(complete): owner attestations ไม่ครบ 3 (พบ %)', v_cnt; END IF;
    PERFORM 1 FROM public._staging_b13a_evidence e WHERE e.run_id = p_run_id AND e.step = 'failure';
    IF FOUND THEN RAISE EXCEPTION 'B13A FINALIZE(complete): มี failure evidence — ห้าม complete'; END IF;
    IF v_run.payment_id IS NULL OR v_run.payment_jv_entry_id IS NULL THEN
      RAISE EXCEPTION 'B13A FINALIZE(complete): IDs ต้อง retained (payment_id/payment_jv_entry_id)';
    END IF;
    SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id)
      INTO v_cnt;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(complete): business residual = % (ต้อง 0)', v_cnt; END IF;
    SELECT count(*) INTO v_cnt  FROM auth.users u    WHERE u.id = v_run.actor_id;
    SELECT count(*) INTO v_cnt2 FROM public.profiles pr WHERE pr.id = v_run.actor_id;
    IF v_cnt <> 0 OR v_cnt2 <> 0 THEN
      RAISE EXCEPTION 'B13A FINALIZE(complete): exact actor ยังไม่ถูกลบ (auth.users=% profiles=%)', v_cnt, v_cnt2;
    END IF;
    INSERT INTO public._staging_b13a_results (run_id, certificate, detail)
    VALUES (p_run_id, 'EXECUTION_COMPLETE',
            'behavior PASS + evidence + owner attestations ครบ · run/results/evidence/sentinel retained');
    UPDATE public._staging_b13a_runs SET stage = 'execution_complete', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'auth_cleanup_complete';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(complete): transition affected % แถว', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'execution_complete');
  END IF;

  -- ══ abort_no_payment : prepared|gates_passed → failed_no_write (pre-r1 เท่านั้น) ══
  --    ใช้ได้เฉพาะเมื่อพิสูจน์ zero-write ครบ — ห้ามใช้หลังพบ payment write
  IF p_action = 'abort_no_payment' THEN
    IF v_run.stage NOT IN ('prepared', 'gates_passed') THEN
      RAISE EXCEPTION 'B13A FINALIZE(abort): ใช้ได้เฉพาะ stage prepared/gates_passed (run อยู่ %)', v_run.stage;
    END IF;
    SELECT count(*) INTO v_cnt FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A FINALIZE(abort): พบ payment % แถวของ job — ห้าม abort (ต้อง classify แทน)', v_cnt;
    END IF;
    IF v_run.idempotency_key IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.service_payments sp WHERE sp.idempotency_key = v_run.idempotency_key;
      IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): พบ payment ตาม idempotency % แถว — ห้าม abort', v_cnt; END IF;
    END IF;
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE je.source_table IN ('service_payments', 'service_payment_reversals');
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): พบ payment/reversal JE % ใบ — ห้าม abort', v_cnt; END IF;
    SELECT round(coalesce(sum(sp.amount), 0), 2) INTO v_paid
      FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_paid <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): paid total = % (ต้อง 0)', v_paid; END IF;
    -- ลบ seed ด้วย exact IDs ใน transaction เดียว: recognition JV lines → header → job
    SELECT je.id INTO v_rec_je_id FROM public.journal_entries je
     WHERE je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id;
    IF v_rec_je_id IS NOT NULL THEN
      DELETE FROM public.journal_lines WHERE entry_id = v_rec_je_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 2 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): recognition lines ลบ % (ต้อง 2) — rollback', v_n; END IF;
      DELETE FROM public.journal_entries WHERE id = v_rec_je_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): recognition header ลบ % (ต้อง 1) — rollback', v_n; END IF;
    END IF;
    DELETE FROM public.service_jobs WHERE id = v_run.service_job_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): job ลบ % (ต้อง 1) — rollback', v_n; END IF;
    SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
         + (SELECT count(*) FROM public.journal_entries je
             WHERE je.source_table = 'service_jobs' AND je.source_id = v_run.service_job_id)
      INTO v_cnt;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): residual = % (ต้อง 0) — rollback', v_cnt; END IF;
    INSERT INTO public._staging_b13a_results (run_id, certificate, detail)
    VALUES (p_run_id, 'ABORTED_NO_PAYMENT', 'pre-r1 abort · zero payment/JV/reversal/paid-total · seed removed by exact IDs');
    UPDATE public._staging_b13a_runs SET failure_code = 'ZERO_WRITE_CONFIRMED', stage = 'failed_no_write', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage IN ('prepared', 'gates_passed');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(abort): transition affected % แถว', v_n; END IF;
    -- retain run/results/evidence/sentinel — ลบ = owner recovery phase แยก
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'failed_no_write');
  END IF;

  -- ══ classify_failed_incomplete : r1_inflight/r1_recorded/r2_inflight/r2_verified/db_verified
  --    → failed_incomplete (เงินถูกเขียนแล้ว/outcome ไม่ชัดแต่พบ payment — retain ทุกอย่าง) ══
  IF p_action = 'classify_failed_incomplete' THEN
    IF v_run.stage NOT IN ('r1_inflight','r1_recorded','r2_inflight','r2_verified','db_verified') THEN
      RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): ใช้ไม่ได้จาก stage % (cleanup stages = retry action เดิม · terminal = จบแล้ว)', v_run.stage;
    END IF;
    IF p_failure_code IS NULL OR p_failure_code NOT IN
       ('LEDGER_WITHOUT_JV','JV_INVALID','UNKNOWN_OUTCOME_PAYMENT_FOUND','VERIFY_DB_FAILED','TEARDOWN_PRECONDITION_FAILED') THEN
      RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): failure_code ต้องอยู่ใน allowlist';
    END IF;
    -- owner ค้น payment ด้วย job + stored idempotency — bind ได้เมื่อ candidate มี "หนึ่งแถวเป๊ะ"
    -- และ payload ตรง stored intent ครบทุก field แบบ NULL-safe + created_by = actor เท่านั้น
    IF v_run.payment_id IS NULL THEN
      SELECT count(*) INTO v_cnt FROM public.service_payments sp
       WHERE sp.service_job_id = v_run.service_job_id
         AND sp.idempotency_key IS NOT DISTINCT FROM v_run.idempotency_key;
      IF v_cnt = 0 THEN
        RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): ไม่พบ payment ของ run — ถ้าพิสูจน์ zero-write ได้ใช้ classify_failed_no_write แทน';
      END IF;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): candidate payment % แถว (ต้อง 1 เป๊ะ) — STOP ห้าม bind (recovery review)', v_cnt;
      END IF;
      SELECT * INTO v_pay FROM public.service_payments sp
       WHERE sp.service_job_id = v_run.service_job_id
         AND sp.idempotency_key IS NOT DISTINCT FROM v_run.idempotency_key;
      IF round(v_pay.amount, 2) IS DISTINCT FROM v_run.amount
         OR v_pay.payment_method IS DISTINCT FROM v_run.payment_method
         OR v_pay.bank_coa_code IS DISTINCT FROM v_run.bank_coa_code
         OR v_pay.paid_at IS DISTINCT FROM v_run.paid_at
         OR v_pay.slip_url IS DISTINCT FROM v_run.slip_url
         OR v_pay.note IS DISTINCT FROM v_run.note
         OR v_pay.created_by IS DISTINCT FROM v_run.actor_id THEN
        RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): candidate payment ไม่ตรง stored intent/actor ครบทุกช่อง — STOP ห้าม bind (recovery review)';
      END IF;
      v_found_pay := v_pay.id;
      UPDATE public._staging_b13a_runs SET payment_id = v_found_pay, updated_at = now()
       WHERE singleton AND run_id = p_run_id AND payment_id IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): bind payment affected % แถว', v_n; END IF;
      v_run.payment_id := v_found_pay;
    END IF;
    IF v_run.payment_jv_entry_id IS NULL THEN
      -- JV candidate ต้องเป็น 0 หรือ 1 header ที่ผูก source exact — มากกว่า 1 = STOP
      SELECT count(*) INTO v_cnt FROM public.journal_entries je
       WHERE je.source_table = 'service_payments' AND je.source_id = v_run.payment_id;
      IF v_cnt > 1 THEN
        RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): JV header ของ payment มี % ใบ (ต้อง 0 หรือ 1) — STOP ห้าม bind', v_cnt;
      END IF;
      IF v_cnt = 1 THEN
        SELECT je.id INTO v_found_pay FROM public.journal_entries je
         WHERE je.source_table = 'service_payments' AND je.source_id = v_run.payment_id;
        UPDATE public._staging_b13a_runs SET payment_jv_entry_id = v_found_pay, updated_at = now()
         WHERE singleton AND run_id = p_run_id AND payment_jv_entry_id IS NULL;
      END IF;
    END IF;
    -- no ledger/JV deletion — retain ทุกอย่าง · failure evidence (write-once ถ้า browser ยังไม่เขียน)
    IF NOT EXISTS (SELECT 1 FROM public._staging_b13a_evidence e WHERE e.run_id = p_run_id AND e.step = 'failure') THEN
      INSERT INTO public._staging_b13a_evidence
        (run_id, step, source, ok, payment_id, payment_jv_entry_id, ledger_recorded, failure_code)
      SELECT p_run_id, 'failure', 'owner_sql_attestation', false, r.payment_id, r.payment_jv_entry_id, true, p_failure_code
        FROM public._staging_b13a_runs r WHERE r.singleton AND r.run_id = p_run_id;
    END IF;
    UPDATE public._staging_b13a_runs SET failure_code = p_failure_code, stage = 'failed_incomplete', updated_at = now()
     WHERE singleton AND run_id = p_run_id
       AND stage IN ('r1_inflight','r1_recorded','r2_inflight','r2_verified','db_verified');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(classify-incomplete): transition affected % แถว', v_n; END IF;
    -- STOP รอ owner-authorized recovery review — terminal run ยังบล็อก run ใหม่
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'failed_incomplete', 'failure_code', p_failure_code);
  END IF;

  -- ══ classify_failed_no_write : r1_inflight → failed_no_write (zero-write proof เท่านั้น) ══
  IF p_action = 'classify_failed_no_write' THEN
    IF v_run.stage <> 'r1_inflight' THEN
      RAISE EXCEPTION 'B13A FINALIZE(classify-no-write): ใช้ได้เฉพาะ stage r1_inflight (run อยู่ %)', v_run.stage;
    END IF;
    -- proof: zero payment/JV/reversal/paid-total change เท่านั้น
    SELECT count(*) INTO v_cnt FROM public.service_payments sp
     WHERE sp.service_job_id = v_run.service_job_id
        OR sp.idempotency_key IS NOT DISTINCT FROM v_run.idempotency_key;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'B13A FINALIZE(classify-no-write): พบ payment % แถว — เงินเขียนแล้วต้อง classify_failed_incomplete', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM public.journal_entries je
     WHERE je.source_table IN ('service_payments', 'service_payment_reversals');
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(classify-no-write): พบ payment/reversal JE % ใบ — ห้าม no-write', v_cnt; END IF;
    SELECT round(coalesce(sum(sp.amount), 0), 2) INTO v_paid
      FROM public.service_payments sp WHERE sp.service_job_id = v_run.service_job_id;
    IF v_paid <> 0 THEN RAISE EXCEPTION 'B13A FINALIZE(classify-no-write): paid total = % (ต้อง 0)', v_paid; END IF;
    IF NOT EXISTS (SELECT 1 FROM public._staging_b13a_evidence e WHERE e.run_id = p_run_id AND e.step = 'failure') THEN
      INSERT INTO public._staging_b13a_evidence
        (run_id, step, source, ok, ledger_recorded, failure_code)
      VALUES (p_run_id, 'failure', 'owner_sql_attestation', false, false, 'ZERO_WRITE_CONFIRMED');
    END IF;
    UPDATE public._staging_b13a_runs SET failure_code = 'ZERO_WRITE_CONFIRMED', stage = 'failed_no_write', updated_at = now()
     WHERE singleton AND run_id = p_run_id AND stage = 'r1_inflight';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'B13A FINALIZE(classify-no-write): transition affected % แถว', v_n; END IF;
    RETURN jsonb_build_object('run_id', p_run_id, 'stage', 'failed_no_write');
  END IF;

  RAISE EXCEPTION 'B13A FINALIZE: unreachable action — reject';
END $fn_finalize$;
$B13A_DEF_FINALIZE$;
  -- expected body = ข้อความระหว่าง $fn_finalize$ ... $fn_finalize$ (source เดียว ใช้ทั้ง CREATE และ verify)
  v_p := position('$fn_finalize$' IN v_def);
  v_body := substring(v_def FROM v_p + length('$fn_finalize$'));
  v_body := left(v_body, position('$fn_finalize$' IN v_body) - 1);

  -- ผูกด้วย exact signature เท่านั้น — ชื่อเดียวกันแต่ signature อื่น = STOP
  v_oid := to_regprocedure('public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean)');
  IF v_oid IS NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_finalize') THEN
    RAISE EXCEPTION 'B13A S0.6: พบ b13a_owner_finalize แต่ signature ไม่ตรงเวอร์ชันนี้ — STOP ห้าม overwrite/reuse';
  END IF;
  -- ห้ามมี overload: ชื่อนี้ต้องมีหนึ่ง signature เดียวใน pg_proc เท่านั้น
  -- (overload ทำ PostgREST resolution เพี้ยน/expose RPC ที่ไม่ตั้งใจ)
  SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_finalize';
  IF v_cnt_name > 1 THEN
    RAISE EXCEPTION 'B13A S0.6: b13a_owner_finalize มี % signature (อนุญาตหนึ่งเดียว — พบ overload) — STOP ห้าม overwrite/reuse', v_cnt_name;
  END IF;

  IF v_oid IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','), l.lanname,
           (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_prosrc, v_secdef, v_cfg, v_lang, v_owner_ok
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    -- body ต้องตรงเวอร์ชันนี้ byte-ต่อ-byte — marker substring อย่างเดียวไม่พอ
    IF v_prosrc IS DISTINCT FROM v_body THEN
      RAISE EXCEPTION 'B13A S0.6: b13a_owner_finalize body ไม่ตรงเวอร์ชันนี้เป๊ะ — STOP ห้าม overwrite/reuse';
    END IF;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.6: b13a_owner_finalize ต้องไม่เป็น SECURITY DEFINER — STOP';
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=public' THEN
      RAISE EXCEPTION 'B13A S0.6: proconfig ต้องเป็น search_path=public เป๊ะ (ได้ %) — STOP', v_cfg;
    END IF;
    IF v_lang IS DISTINCT FROM 'plpgsql' THEN
      RAISE EXCEPTION 'B13A S0.6: language ต้องเป็น plpgsql (ได้ %) — STOP', v_lang;
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.6: owner ของ function ไม่ใช่ trusted role — STOP';
    END IF;
    -- API metadata exact: argument names/defaults · return type · attributes
    -- (runbook เรียกด้วย named args + อาศัย defaults — เปลี่ยนชื่อ/ค่า default = สัญญาเปลี่ยน)
    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
           p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prokind
      INTO v_args, v_ret, v_vol, v_strict, v_par, v_leak, v_kind
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_args IS DISTINCT FROM 'p_run_id uuid, p_action text, p_failure_code text DEFAULT NULL::text, p_session_null boolean DEFAULT NULL::boolean, p_clean_login_rejected boolean DEFAULT NULL::boolean, p_local_cleanup boolean DEFAULT NULL::boolean' THEN
      RAISE EXCEPTION 'B13A S0.6: argument names/defaults ไม่ตรงเป๊ะ (%) — STOP ห้าม reuse', v_args;
    END IF;
    IF v_ret IS DISTINCT FROM 'jsonb' THEN
      RAISE EXCEPTION 'B13A S0.6: return type ไม่ตรง (%) — STOP ห้าม reuse', v_ret;
    END IF;
    IF v_vol IS DISTINCT FROM 'v' OR v_strict OR v_par IS DISTINCT FROM 'u'
       OR v_leak OR v_kind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'B13A S0.6: function attributes ไม่ตรง (volatile=% strict=% parallel=% leakproof=% kind=%) — STOP ห้าม reuse',
        v_vol, v_strict, v_par, v_leak, v_kind;
    END IF;
    -- EXECUTE grants exact รวม PUBLIC (aclexplode คลี่ default acl ด้วย — proacl NULL = PUBLIC execute)
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('anon')::oid AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE')
      INTO v_pub, v_anon, v_auth
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid;
    IF COALESCE(v_pub, false) OR COALESCE(v_anon, false) OR COALESCE(v_auth, false) THEN
      RAISE EXCEPTION 'B13A S0.6: execute grants ไม่ตรง (PUBLIC=% anon=% authenticated=%) — STOP',
        COALESCE(v_pub, false), COALESCE(v_anon, false), COALESCE(v_auth, false);
    END IF;
    -- grantee allowlist ทั้งหมด: function owner เท่านั้น — grantee อื่นทุกตัว (role ใดก็ตาม) = STOP
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND a.grantee <> p.proowner;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.6: พบ grantee นอก allowlist % รายการ (อนุญาต: function owner) — STOP ห้าม reuse', v_acl_bad;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณี (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.6: พบ EXECUTE WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_acl_bad;
    END IF;
    RAISE NOTICE 'B13A S0.6: reuse b13a_owner_finalize (exact: signature/body/secdef/config/language/owner/grants)';
  ELSE
    EXECUTE v_def;
    EXECUTE 'REVOKE ALL ON FUNCTION public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean) FROM PUBLIC, anon, authenticated, service_role';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = function owner เท่านั้น (เดียวกับ reuse path)
    v_oid := to_regprocedure('public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean)');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: ไม่พบ function หลัง CREATE — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'b13a_owner_finalize';
    IF v_cnt_name <> 1 THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: พบ % signature (ต้องหนึ่งเดียว — overload) — rollback ทั้ง block', v_cnt_name;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: พบ grantee นอก allowlist % รายการ หลัง REVOKE — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: พบ EXECUTE WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT p.prosecdef, (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_secdef, v_owner_ok FROM pg_proc p WHERE p.oid = v_oid;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: ต้องเป็น SECURITY INVOKER (prosecdef=false) — rollback ทั้ง block';
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.6 postcondition: function owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.6: created b13a_owner_finalize (no API grants)';
  END IF;
END $b13a_s0_fn_finalize$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0.7 — b13a_rpc_exposed (read-only exposure probe · สร้าง "หลังสุด" ใน S0)
--   ก่อน browser payment step ต้องตรวจผ่าน canonical staging client ว่า RPC ใหม่ถูก expose
--   ใน PostgREST schema cache แล้ว: sb.rpc('b13a_rpc_exposed') สำเร็จ = batch S0 ทั้งชุด
--   (สร้างก่อนหน้า) อยู่ใน cache ที่ reload หลังสุดแล้ว — ใช้ preflight/read-only call เท่านั้น
--   ยังไม่พร้อม/schema cache ยังไม่ reload = STOP ห้าม r1
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_fn_exposed$
DECLARE
  v_staging_ok boolean := false;
  v_oid oid;
  v_def text;
  v_body text;
  v_p int;
  v_prosrc text;
  v_secdef boolean;
  v_cfg text;
  v_lang text;
  v_owner_ok boolean;
  v_pub boolean;
  v_anon boolean;
  v_auth boolean;
  v_cnt_name int;
  v_acl_bad int;
  v_args text;
  v_ret text;
  v_vol "char";
  v_strict boolean;
  v_par "char";
  v_leak boolean;
  v_kind "char";
BEGIN
  -- [B13A-INTERLOCK] sentinel ต้องผ่านก่อน DDL/GRANT/introspect-reuse ใด ๆ (fail-closed)
  BEGIN
    SELECT count(*) = 1 AND bool_and(x.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel x;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  -- [B13A-ROLE-PRECOND] block นี้อ้าง service_role — ต้องยืนยันว่า role มีจริงก่อน (กัน raw SQL error)
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B13A S0.7: ไม่พบ role service_role — target ไม่ใช่ Supabase scratch ที่คาด STOP';
  END IF;

  v_def := $B13A_DEF_EXPOSED$
CREATE FUNCTION public.b13a_rpc_exposed()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn_exposed$
  -- B13A-FN-EXPOSED-V1 — read-only probe: คืน true เมื่อ PostgREST expose ฟังก์ชันนี้แล้ว
  SELECT true;
$fn_exposed$;
$B13A_DEF_EXPOSED$;
  -- expected body = ข้อความระหว่าง $fn_exposed$ ... $fn_exposed$ (source เดียว ใช้ทั้ง CREATE และ verify)
  v_p := position('$fn_exposed$' IN v_def);
  v_body := substring(v_def FROM v_p + length('$fn_exposed$'));
  v_body := left(v_body, position('$fn_exposed$' IN v_body) - 1);

  -- ผูกด้วย exact signature เท่านั้น — ชื่อเดียวกันแต่ signature อื่น = STOP
  v_oid := to_regprocedure('public.b13a_rpc_exposed()');
  IF v_oid IS NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'b13a_rpc_exposed') THEN
    RAISE EXCEPTION 'B13A S0.7: พบ b13a_rpc_exposed แต่ signature ไม่ตรงเวอร์ชันนี้ — STOP ห้าม overwrite/reuse';
  END IF;
  -- ห้ามมี overload: ชื่อนี้ต้องมีหนึ่ง signature เดียวใน pg_proc เท่านั้น
  -- (overload ทำ PostgREST resolution เพี้ยน/expose RPC ที่ไม่ตั้งใจ)
  SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'b13a_rpc_exposed';
  IF v_cnt_name > 1 THEN
    RAISE EXCEPTION 'B13A S0.7: b13a_rpc_exposed มี % signature (อนุญาตหนึ่งเดียว — พบ overload) — STOP ห้าม overwrite/reuse', v_cnt_name;
  END IF;

  IF v_oid IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','), l.lanname,
           (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_prosrc, v_secdef, v_cfg, v_lang, v_owner_ok
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    -- body ต้องตรงเวอร์ชันนี้ byte-ต่อ-byte — marker substring อย่างเดียวไม่พอ
    IF v_prosrc IS DISTINCT FROM v_body THEN
      RAISE EXCEPTION 'B13A S0.7: b13a_rpc_exposed body ไม่ตรงเวอร์ชันนี้เป๊ะ — STOP ห้าม overwrite/reuse';
    END IF;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.7: b13a_rpc_exposed ต้องไม่เป็น SECURITY DEFINER — STOP';
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=public' THEN
      RAISE EXCEPTION 'B13A S0.7: proconfig ต้องเป็น search_path=public เป๊ะ (ได้ %) — STOP', v_cfg;
    END IF;
    IF v_lang IS DISTINCT FROM 'sql' THEN
      RAISE EXCEPTION 'B13A S0.7: language ต้องเป็น sql (ได้ %) — STOP', v_lang;
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.7: owner ของ function ไม่ใช่ trusted role — STOP';
    END IF;
    -- API metadata exact: argument names/defaults · return type · attributes
    -- (runbook เรียกด้วย named args + อาศัย defaults — เปลี่ยนชื่อ/ค่า default = สัญญาเปลี่ยน)
    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
           p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prokind
      INTO v_args, v_ret, v_vol, v_strict, v_par, v_leak, v_kind
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_args IS DISTINCT FROM '' THEN
      RAISE EXCEPTION 'B13A S0.7: argument names/defaults ไม่ตรงเป๊ะ (%) — STOP ห้าม reuse', v_args;
    END IF;
    IF v_ret IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'B13A S0.7: return type ไม่ตรง (%) — STOP ห้าม reuse', v_ret;
    END IF;
    IF v_vol IS DISTINCT FROM 's' OR v_strict OR v_par IS DISTINCT FROM 'u'
       OR v_leak OR v_kind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'B13A S0.7: function attributes ไม่ตรง (volatile=% strict=% parallel=% leakproof=% kind=%) — STOP ห้าม reuse',
        v_vol, v_strict, v_par, v_leak, v_kind;
    END IF;
    -- EXECUTE grants exact รวม PUBLIC (aclexplode คลี่ default acl ด้วย — proacl NULL = PUBLIC execute)
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('anon')::oid AND a.privilege_type = 'EXECUTE'),
           bool_or(a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE')
      INTO v_pub, v_anon, v_auth
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid;
    IF COALESCE(v_pub, false) OR COALESCE(v_anon, false) OR (COALESCE(v_auth, false) IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'B13A S0.7: execute grants ไม่ตรง (PUBLIC=% anon=% authenticated=%) — STOP',
        COALESCE(v_pub, false), COALESCE(v_anon, false), COALESCE(v_auth, false);
    END IF;
    -- grantee allowlist ทั้งหมด: function owner + authenticated(EXECUTE) เท่านั้น — grantee อื่นทุกตัว (role ใดก็ตาม) = STOP
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND NOT (a.grantee = p.proowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE'));
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.7: พบ grantee นอก allowlist % รายการ (อนุญาต: function owner + authenticated(EXECUTE)) — STOP ห้าม reuse', v_acl_bad;
    END IF;
    -- ห้ามมี WITH GRANT OPTION ทุกกรณี (is_grantable = ส่งต่อสิทธิ์ได้ = กว้างกว่าสัญญา)
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.7: พบ EXECUTE WITH GRANT OPTION % รายการ — STOP ห้าม reuse', v_acl_bad;
    END IF;
    RAISE NOTICE 'B13A S0.7: reuse b13a_rpc_exposed (exact: signature/body/secdef/config/language/owner/grants)';
  ELSE
    EXECUTE v_def;
    EXECUTE 'REVOKE ALL ON FUNCTION public.b13a_rpc_exposed() FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.b13a_rpc_exposed() TO authenticated';
    -- [B13A-ACL-POST] fresh-create postcondition — allowlist = owner + authenticated(EXECUTE) เท่านั้น
    v_oid := to_regprocedure('public.b13a_rpc_exposed()');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: ไม่พบ function หลัง CREATE — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'b13a_rpc_exposed';
    IF v_cnt_name <> 1 THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: พบ % signature (ต้องหนึ่งเดียว — overload) — rollback ทั้ง block', v_cnt_name;
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid
       AND NOT (a.grantee = p.proowner
                OR (a.grantee = to_regrole('authenticated')::oid AND a.privilege_type = 'EXECUTE'));
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: พบ grantee นอก allowlist % รายการ หลัง REVOKE/GRANT — rollback ทั้ง block', v_acl_bad;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = v_oid AND a.grantee = to_regrole('authenticated')::oid
                      AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: ขาด EXECUTE grant ของ authenticated — rollback ทั้ง block';
    END IF;
    SELECT count(*) INTO v_acl_bad
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.is_grantable;
    IF v_acl_bad > 0 THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: พบ EXECUTE WITH GRANT OPTION % รายการ — rollback ทั้ง block', v_acl_bad;
    END IF;
    SELECT p.prosecdef, (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = p.proowner)
      INTO v_secdef, v_owner_ok FROM pg_proc p WHERE p.oid = v_oid;
    IF v_secdef THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: ต้องเป็น SECURITY INVOKER (prosecdef=false) — rollback ทั้ง block';
    END IF;
    IF NOT COALESCE(v_owner_ok, false) THEN
      RAISE EXCEPTION 'B13A S0.7 postcondition: function owner ไม่ใช่ trusted role — rollback ทั้ง block';
    END IF;
    RAISE NOTICE 'B13A S0.7: created b13a_rpc_exposed (read-only probe)';
  END IF;
END $b13a_s0_fn_exposed$;


-- ────────────────────────────────────────────────────────────────────────────
-- S0-RELOAD — PostgREST schema reload (scratch staging เท่านั้น · sentinel-gated)
--   NOTIFY pgrst อนุญาตเฉพาะ scratch staging ใน owner-controlled execution phase —
--   ห้ามรัน NOTIFY pgrst บน production เด็ดขาด · package implementation phase ห้ามรัน NOTIFY
--   (block นี้ปฏิเสธเองเมื่อไม่มี B13a sentinel — default = ปฏิเสธ)
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_s0_reload$
DECLARE
  v_staging_ok boolean := false;
BEGIN
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — ห้าม NOTIFY pgrst นอก scratch staging เด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ไม่ตรง — ห้าม NOTIFY pgrst (production ห้ามทุกกรณี)';
  END IF;
  EXECUTE 'NOTIFY pgrst, ''reload schema''';
  RAISE NOTICE 'B13A S0-RELOAD: NOTIFY pgrst แล้ว (scratch เท่านั้น) — ตรวจ exposure ผ่าน sb.rpc(''b13a_rpc_exposed'') ก่อน r1 เสมอ';
END $b13a_s0_reload$;


-- ────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT — read-only asserts (A11) · ล้มข้อใด = STOP ห้ามไปต่อ
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_preflight$
DECLARE
  v_staging_ok boolean := false;
  v_cnt  int;
  v_cnt2 int;
  v_def  text;
BEGIN
  -- scratch เดิมของ B12 / ไม่ใช่ production: sentinel B12 + B13a + วันที่/timezone ของ DB session
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: ไม่พบ _staging_b13a_sentinel — สร้างตาม runbook ก่อน (ห้ามรันบน production)';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: sentinel ไม่ตรง B13A-STAGING-% — STOP', to_char(current_date, 'YYYY-MM-DD');
  END IF;
  IF to_regclass('public._staging_b12_sentinel') IS NULL THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: ไม่พบ _staging_b12_sentinel — ต้องเป็น scratch เดิมของ B12 เท่านั้น (scratch ใหม่ = STOP)';
  END IF;
  RAISE NOTICE 'B13A PREFLIGHT: DB session timezone=% · current_date=% · now()=%',
    current_setting('timezone'), current_date, now();

  -- B12 results 6 pass + residual 0/0/0 (retained baseline)
  SELECT count(*) INTO v_cnt FROM public._staging_b12_results r WHERE r.ok;
  SELECT count(*) INTO v_cnt2 FROM public._staging_b12_results;
  IF v_cnt <> 6 OR v_cnt2 <> 6 THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: _staging_b12_results = %/% (ต้อง 6/6 ok=true retained) — STOP', v_cnt, v_cnt2;
  END IF;
  SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B12TEST-%')
       + (SELECT count(*) FROM public.journal_entries WHERE doc_no LIKE 'B12TEST-%')
    INTO v_cnt;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A PREFLIGHT: B12 residual = % (ต้อง 0) — STOP', v_cnt; END IF;

  -- required tables/functions/validators
  IF to_regclass('public.service_payments') IS NULL OR to_regclass('public.service_payment_reversals') IS NULL THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: ไม่พบ service_payments/service_payment_reversals — STOP';
  END IF;
  IF to_regprocedure('public.record_service_payment_v2(bigint,numeric,text,timestamptz,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.service_job_has_recognition_jv(bigint)') IS NULL
     OR to_regprocedure('public.service_payment_jv_is_valid(bigint)') IS NULL
     OR to_regprocedure('public.service_job_paid_total(bigint)') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_accountant()') IS NULL THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: RPC/validator/authority functions ไม่ครบ — STOP';
  END IF;
  -- payment effective floor ต้องอยู่ใน source ของ RPC จริง (เวลาไทย 2026-07-01)
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_service_payment_v2';
  IF position('AT TIME ZONE ''Asia/Bangkok''' IN v_def) = 0 OR position('2026-07-01' IN v_def) = 0
     OR position('service_job_has_recognition_jv' IN v_def) = 0 THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: record_service_payment_v2 ไม่ตรง contract (effective floor เวลาไทย + recognition gate) — STOP';
  END IF;

  -- COA/mapping active + baseline B12 (68/36)
  PERFORM 1 FROM public.chart_of_accounts WHERE code = '1200' AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A PREFLIGHT: COA 1200 ไม่ active — STOP'; END IF;
  PERFORM 1 FROM public.account_mapping
   WHERE mapping_key = public.service_mapping_key_for_job_type('other') AND is_active
     AND recognition_debit_code = '1200' AND debit_account_code IS NOT NULL AND credit_account_code IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A PREFLIGHT: mapping service_other ไม่พร้อม (active + 1200 + debit/credit) — STOP'; END IF;
  SELECT count(*) INTO v_cnt FROM public.chart_of_accounts;
  SELECT count(*) INTO v_cnt2 FROM public.account_mapping;
  IF v_cnt <> 68 OR v_cnt2 <> 36 THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: COA/mapping = %/% (baseline B12 closeout = 68/36) — scratch ไม่ใช่ตัวเดิม = STOP', v_cnt, v_cnt2;
  END IF;

  -- profiles schema/FK (ไม่มี DDL ในรีโป — introspect จริง)
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('id', 'role');
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'B13A PREFLIGHT: profiles ต้องมีคอลัมน์ id + role — STOP'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_constraint c
   WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'f';
  RAISE NOTICE 'B13A PREFLIGHT: profiles FK count = % (ใช้ประกอบ cleanup ตาม runbook B3/B11)', v_cnt;

  -- accounting period เปิดสำหรับเดือนปัจจุบัน (scratch ไม่มี row = open)
  IF to_regprocedure('public.is_period_locked(date)') IS NOT NULL THEN
    IF public.is_period_locked(current_date) THEN
      RAISE EXCEPTION 'B13A PREFLIGHT: period เดือนปัจจุบัน locked — STOP';
    END IF;
  END IF;

  -- no B13ATEST rows + scratch payment ledger ต้องว่าง + active run = 0
  SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%')
       + (SELECT count(*) FROM public.journal_entries WHERE doc_no LIKE 'B13ATEST-%')
    INTO v_cnt;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A PREFLIGHT: พบ B13ATEST rows ค้าง % แถว — STOP (ห้าม auto cleanup)', v_cnt; END IF;
  SELECT (SELECT count(*) FROM public.service_payments) + (SELECT count(*) FROM public.service_payment_reversals)
    INTO v_cnt;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'B13A PREFLIGHT: payment ledger บน scratch ต้องว่าง (พบ %) — STOP', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public._staging_b13a_runs;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: มี run ค้าง % run (stale run = STOP — ห้าม takeover/auto cleanup)', v_cnt;
  END IF;

  -- trigger table/function/type/enabled exact + journal triggers enabled
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgrelid = 'public.service_jobs'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND t.tgname IN ('trg_service_jobs_metadata_insert','trg_service_jobs_metadata_update_guard',
                      'trg_service_job_v2_freeze','trg_service_jobs_insert_close_guard',
                      'trg_service_jobs_close_guard','trg_service_jobs_delete_guard');
  IF v_cnt <> 6 THEN RAISE EXCEPTION 'B13A PREFLIGHT: service_jobs triggers enabled=O = % (ต้อง 6) — STOP', v_cnt; END IF;
  PERFORM 1 FROM pg_trigger t
   WHERE t.tgrelid = 'public.service_jobs'::regclass AND t.tgname = 'trg_service_job_v2_freeze'
     AND t.tgfoid = 'public.guard_service_job_v2_freeze()'::regprocedure AND t.tgtype = 19;
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A PREFLIGHT: trg_service_job_v2_freeze binding ไม่ตรง (function/type) — STOP'; END IF;
  PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_lines'::regclass
     AND t.tgname = 'trg_je_lines_balance' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A PREFLIGHT: trg_je_lines_balance หาย/disable — STOP'; END IF;
  PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_entries'::regclass
     AND t.tgname = 'trg_check_period_locked' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A PREFLIGHT: trg_check_period_locked หาย/disable — STOP'; END IF;

  -- scratch PostgREST RPC exposure: ฝั่ง SQL ยืนยันว่า probe function พร้อม —
  -- การยืนยัน exposure จริงทำจาก browser: sb.rpc('b13a_rpc_exposed') ก่อน r1 (runbook B6)
  IF to_regprocedure('public.b13a_rpc_exposed()') IS NULL THEN
    RAISE EXCEPTION 'B13A PREFLIGHT: ไม่พบ b13a_rpc_exposed — รัน S0 ให้ครบก่อน';
  END IF;

  RAISE NOTICE 'B13A PREFLIGHT: ผ่านครบ — ไป SEED ได้';
END $b13a_preflight$;


-- ────────────────────────────────────────────────────────────────────────────
-- SEED — B13ATEST-CASH-1 (delivered · other · 1000.00 · flow2) + recognition JV approved
--   ⚠️ ขั้นเดียวในไฟล์ที่แตะ trigger: DISABLE เฉพาะ trg_service_jobs_metadata_update_guard
--   (ตัวที่ block 1→2) ชั่วคราวใน transaction เดียว — ล้มตรงไหน rollback ทั้งบล็อก trigger
--   กลับมา enabled เอง; จบด้วย assert tgenabled='O' · ห้ามแตะ trigger ฝั่ง journal ทุกกรณี
-- ────────────────────────────────────────────────────────────────────────────
DO $b13a_seed$
DECLARE
  v_staging_ok boolean := false;
  v_job_id  bigint;
  v_flow    int;
  v_enabled "char";
  v_map     public.account_mapping%ROWTYPE;
  v_je_id   bigint;
  v_doc     date;
  v_cnt     int;
  v_n       int;
BEGIN
  -- [B13A-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT count(*) = 1 AND bool_and(s.confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
      INTO v_staging_ok FROM public._staging_b13a_sentinel s;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง _staging_b13a_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT COALESCE(v_staging_ok, false) THEN
    RAISE EXCEPTION 'B13A INTERLOCK: sentinel ต้องมีหนึ่งแถวและ confirm_text = B13A-STAGING-% เป๊ะ — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  IF EXISTS (SELECT 1 FROM public.service_jobs WHERE job_no LIKE 'B13ATEST-%') THEN
    RAISE EXCEPTION 'B13A SEED: มี B13ATEST-* ค้างอยู่ — ห้าม seed ซ้ำ (cleanup = owner recovery แยก)';
  END IF;

  -- (1) INSERT ปกติ → trg_service_jobs_metadata_insert บังคับ flow=1
  INSERT INTO public.service_jobs (job_no, customer_name, customer_phone, description, status, job_type, total_cost, note)
  VALUES ('B13ATEST-CASH-1', 'B13A Staging Test', '0800000013', 'B13a cash-payment behavioral seed', 'delivered', 'other', 1000.00, 'B13ATEST seed')
  RETURNING id, finance_flow_version INTO v_job_id, v_flow;
  IF v_flow IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'B13A SEED: insert trigger ไม่บังคับ flow=1 (ได้ %) — schema ผิดรุ่น', v_flow;
  END IF;

  -- (2-5) disable เฉพาะ metadata update guard → update flow2 → enable กลับ → assert O (transaction เดียว)
  EXECUTE 'ALTER TABLE public.service_jobs DISABLE TRIGGER trg_service_jobs_metadata_update_guard';
  UPDATE public.service_jobs SET finance_flow_version = 2 WHERE id = v_job_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'B13A SEED: UPDATE flow=2 โดน % แถว (ต้อง 1) — ยกเลิกทั้งบล็อก', v_n; END IF;
  EXECUTE 'ALTER TABLE public.service_jobs ENABLE TRIGGER trg_service_jobs_metadata_update_guard';
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.service_jobs'::regclass AND t.tgname = 'trg_service_jobs_metadata_update_guard';
  IF v_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'B13A SEED: trigger ยังไม่ enabled (tgenabled=%) — ยกเลิกทั้งบล็อก', v_enabled;
  END IF;

  -- (6-8) recognition JV approved 1 header / 2 lines · Dr recognition (1200) / Cr revenue mapping จริง
  SELECT * INTO v_map FROM public.account_mapping
   WHERE mapping_key = public.service_mapping_key_for_job_type('other') AND is_active;
  IF NOT FOUND OR v_map.recognition_debit_code IS NULL OR v_map.credit_account_code IS NULL THEN
    RAISE EXCEPTION 'B13A SEED: mapping service_other ไม่พร้อม — ยกเลิกทั้งบล็อก';
  END IF;
  v_doc := date_trunc('month', current_date)::date + 14;
  IF v_doc < DATE '2026-07-01' THEN
    RAISE EXCEPTION 'B13A SEED: doc_date % ต่ำกว่า effective 2026-07-01 — ยกเลิก', v_doc;
  END IF;
  INSERT INTO public.journal_entries (doc_no, doc_type, doc_date, description, status,
                                      total_debit, total_credit, source_table, source_id)
  VALUES ('B13ATEST-JV1', 'SV', v_doc, 'B13a recognition JV (staging)', 'approved',
          1000.00, 1000.00, 'service_jobs', v_job_id)
  RETURNING id INTO v_je_id;
  INSERT INTO public.journal_lines (entry_id, line_no, account_code, debit, credit, description) VALUES
    (v_je_id, 1, v_map.recognition_debit_code, 1000.00, 0, 'B13a Dr ลูกหนี้การค้า'),
    (v_je_id, 2, v_map.credit_account_code,    0, 1000.00, 'B13a Cr รายได้บริการ');
  SELECT count(*) INTO v_cnt FROM public.journal_lines jl
   WHERE jl.entry_id = v_je_id AND (round(coalesce(jl.debit,0),2) <> 0 OR round(coalesce(jl.credit,0),2) <> 0);
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'B13A SEED: recognition lines = % (ต้อง 2) — ยกเลิก', v_cnt; END IF;

  -- (9) journal triggers ต้องไม่ถูก disable
  PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_lines'::regclass
     AND t.tgname = 'trg_je_lines_balance' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A SEED: trg_je_lines_balance ถูก disable — ยกเลิกทั้งบล็อก'; END IF;
  PERFORM 1 FROM pg_trigger t WHERE t.tgrelid = 'public.journal_entries'::regclass
     AND t.tgname = 'trg_check_period_locked' AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  IF NOT FOUND THEN RAISE EXCEPTION 'B13A SEED: trg_check_period_locked ถูก disable — ยกเลิกทั้งบล็อก'; END IF;

  RAISE NOTICE 'B13A SEED OK: job % (delivered/other/1000.00/flow2) + JV % (Dr %/Cr % = 1000.00 approved)',
    v_job_id, v_je_id, v_map.recognition_debit_code, v_map.credit_account_code;
  RAISE NOTICE 'B13A SEED: ขั้นถัดไป (10) = owner bootstrap: SELECT public.b13a_owner_bootstrap(''<actor-uuid>''::uuid); (UUID เฉพาะใน SQL Editor — ห้ามบันทึกลง repo/report)';
END $b13a_seed$;


-- ────────────────────────────────────────────────────────────────────────────
-- FULL TRANSITION CONTRACT (A6 — reference · บังคับใน writers ข้างบน)
--   prepared              → gates_passed [browser] · failed_no_write [owner abort only]
--   gates_passed          → r1_inflight [browser·intent snapshot] · failed_no_write [owner abort only]
--   r1_inflight           → r1_recorded [browser] · failed_incomplete [browser/owner]
--                         · failed_no_write [owner zero-write classification]
--   r1_recorded           → r2_inflight [browser] · failed_incomplete
--   r2_inflight           → r2_verified [browser] · failed_incomplete
--   r2_verified           → db_verified [owner verify_db] · failed_incomplete
--   db_verified           → teardown_complete [owner teardown] · failed_incomplete
--   teardown_complete     → auth_cleanup_complete [owner attest_cleanup] (resumable)
--   auth_cleanup_complete → execution_complete [owner complete] (resumable)
--   terminal (execution_complete · failed_incomplete · failed_no_write) = ไม่มี outgoing ·
--   ยัง retain และบล็อก run ใหม่ — ลบ retained run/evidence = owner recovery phase แยก
--   หลัง reviewer approval · ทุก mismatch = STOP (no new retry intent · no paidAt/idempotency
--   regeneration · no ledger/JV manual delete · no clear active run)
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- REPORT — read-only summary (ห้าม select actor_id — actor UUID อยู่ใน DB เท่านั้น)
-- ────────────────────────────────────────────────────────────────────────────
SELECT r.run_id, r.stage, r.service_job_id, r.payment_id, r.payment_jv_entry_id,
       r.amount, r.payment_method, r.failure_code, r.created_at, r.updated_at
  FROM public._staging_b13a_runs r;

SELECT e.run_id, e.step, e.source, e.ok, e.payment_id, e.payment_jv_entry_id, e.inserted,
       e.ledger_recorded, e.accounting_posted, e.paid_total, e.outstanding,
       e.jv_status, e.jv_reason, e.failure_code, e.created_at
  FROM public._staging_b13a_evidence e ORDER BY e.created_at;

SELECT run_id, certificate, detail, created_at FROM public._staging_b13a_results ORDER BY created_at;

SELECT t.tgname, t.tgenabled FROM pg_trigger t
 WHERE t.tgrelid = 'public.service_jobs'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;
