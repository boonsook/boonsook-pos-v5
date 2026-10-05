-- Phase 645 / B1: LOCAL REVIEW CANDIDATE ONLY. No shared-DB execution authorized.
-- Two RPC authorization gates only; no ledger RLS, table grants or data changes.
-- Raw production prosrc MD5s measured 2026-10-05; never normalize before pinning.
-- Use psql -X -v ON_ERROR_STOP=1 with a separately approved project/session.
-- Run whole file in one session. Any failure aborts; ROLLBACK and STOP. No partial retry.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $phase645_preflight$
DECLARE target record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('server_version_num') <> '170006' THEN
    RAISE EXCEPTION 'Phase645 STOP: expected postgres session on PostgreSQL 17.6' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role')) <> 3
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.customer_credit_ledger') IS NULL THEN
    RAISE EXCEPTION 'Phase645 STOP: role/schema prerequisite missing or unsafe' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.profiles'::regclass
       AND relkind='r' AND pg_catalog.pg_get_userbyid(relowner)='postgres' AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'Phase645 STOP: profiles owner/read path drift' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc catalog_rpc JOIN pg_catalog.pg_namespace n ON n.oid=catalog_rpc.pronamespace
      WHERE n.nspname='public' AND catalog_rpc.proname IN ('redeem_customer_credit','release_customer_credit')) <> 2 THEN
    RAISE EXCEPTION 'Phase645 STOP: RPC missing or unexpected overload' USING ERRCODE = '55000';
  END IF;
  FOR target IN SELECT * FROM (VALUES
      ('public.redeem_customer_credit(bigint,text,numeric,text)', '8ba3d01fe1a13ffbd2f9edb6d9e8c577'),
      ('public.release_customer_credit(text)', 'cc859ecb943a4df8c0f0a65171ff1f62')
    ) expected(signature, body_md5) LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(target.signature);
    IF p.oid IS NULL OR p.prokind <> 'f' OR p.proretset OR p.proisstrict OR p.proleakproof
       OR p.provolatile <> 'v' OR p.proparallel <> 'u' OR p.prosupport <> 0
       OR p.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
       OR NOT p.prosecdef OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
       OR p.prorettype <> 'public.customer_credit_ledger'::regtype
       OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL THEN
      RAISE EXCEPTION 'Phase645 STOP: function metadata drift for %', target.signature USING ERRCODE = '55000';
    END IF;
    IF p.proname = 'redeem_customer_credit' THEN
      IF p.proargnames IS DISTINCT FROM ARRAY['p_customer_id','p_source_key','p_amount','p_note']::text[]
         OR p.pronargdefaults <> 1
         OR pg_catalog.pg_get_expr(p.proargdefaults, 0) IS DISTINCT FROM 'NULL::text' THEN
        RAISE EXCEPTION 'Phase645 STOP: redeem arguments/default drift' USING ERRCODE = '55000';
      END IF;
    ELSE
      IF p.proargnames IS DISTINCT FROM ARRAY['p_source_key']::text[] OR p.pronargdefaults <> 0 THEN
        RAISE EXCEPTION 'Phase645 STOP: release arguments/default drift' USING ERRCODE = '55000';
      END IF;
    END IF;
    IF pg_catalog.md5(p.prosrc) IS DISTINCT FROM target.body_md5
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
      RAISE EXCEPTION 'Phase645 STOP: raw body/config drift for %', target.signature USING ERRCODE = '55000';
    END IF;
    IF p.proacl IS NULL
       OR (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) <> 4
       OR (SELECT count(DISTINCT a.grantee) FROM pg_catalog.aclexplode(p.proacl) a) <> 4
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee NOT IN (p.proowner, 'authenticated'::regrole::oid, 'anon'::regrole::oid, 'service_role'::regrole::oid)
             OR a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'Phase645 STOP: exact ACL drift for %', target.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$phase645_preflight$;

CREATE OR REPLACE FUNCTION public.redeem_customer_credit(
  p_customer_id bigint,
  p_source_key  text,
  p_amount      numeric,
  p_note        text DEFAULT NULL
) RETURNS public.customer_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_existing public.customer_credit_ledger;
  v_balance  numeric;
  v_row      public.customer_credit_ledger;
BEGIN
  -- PHASE645 AUTH GUARD BEGIN
  -- Database impersonation role, not JWT business-role/metadata claims.
  IF pg_catalog.current_setting('role', true) IS DISTINCT FROM 'authenticated'
     OR NOT COALESCE((SELECT p.role IN ('admin', 'sales', 'technician')
                      FROM public.profiles p WHERE p.id = auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden: customer credit requires authorized staff' USING ERRCODE = '42501';
  END IF;
  -- PHASE645 AUTH GUARD END
  -- validate
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'redeem_customer_credit: customer_id required' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'redeem_customer_credit: amount must be > 0 (got %)', p_amount USING ERRCODE = '23514';
  END IF;

  -- serialize ต่อ "ลูกค้า 1 คน" (ต่างคนไม่บล็อกกัน) — กัน race หลายเครื่องใช้เครดิตพร้อมกัน
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ccl:' || p_customer_id::text, 0));

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

CREATE OR REPLACE FUNCTION public.release_customer_credit(p_source_key text)
RETURNS public.customer_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_redeem   public.customer_credit_ledger;
  v_existing public.customer_credit_ledger;
  v_row      public.customer_credit_ledger;
BEGIN
  -- PHASE645 AUTH GUARD BEGIN
  -- Database impersonation role, not JWT business-role/metadata claims.
  IF pg_catalog.current_setting('role', true) IS DISTINCT FROM 'authenticated'
     OR NOT COALESCE((SELECT p.role IN ('admin', 'sales', 'technician')
                      FROM public.profiles p WHERE p.id = auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden: customer credit requires authorized staff' USING ERRCODE = '42501';
  END IF;
  -- PHASE645 AUTH GUARD END
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ccl:' || v_redeem.customer_id::text, 0));

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

REVOKE ALL ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.release_customer_credit(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_customer_credit(text) TO authenticated;

DO $phase645_postcheck$
DECLARE target record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR target IN SELECT * FROM (VALUES
      ('public.redeem_customer_credit(bigint,text,numeric,text)', '111400b17c10bf7812442648dc4bf129'),
      ('public.release_customer_credit(text)', '4b4f35790f5bc34e26edfaff58957baa')
    ) expected(signature, body_md5) LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(target.signature);
    IF p.oid IS NULL OR p.prokind <> 'f' OR p.proretset OR p.proisstrict OR p.proleakproof
       OR p.provolatile <> 'v' OR p.proparallel <> 'u' OR p.prosupport <> 0
       OR p.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
       OR NOT p.prosecdef OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
       OR p.prorettype <> 'public.customer_credit_ledger'::regtype
       OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL THEN
      RAISE EXCEPTION 'Phase645 STOP: function metadata drift for %', target.signature USING ERRCODE = '55000';
    END IF;
    IF p.proname = 'redeem_customer_credit' THEN
      IF p.proargnames IS DISTINCT FROM ARRAY['p_customer_id','p_source_key','p_amount','p_note']::text[]
         OR p.pronargdefaults <> 1
         OR pg_catalog.pg_get_expr(p.proargdefaults, 0) IS DISTINCT FROM 'NULL::text' THEN
        RAISE EXCEPTION 'Phase645 STOP: redeem arguments/default drift' USING ERRCODE = '55000';
      END IF;
    ELSE
      IF p.proargnames IS DISTINCT FROM ARRAY['p_source_key']::text[] OR p.pronargdefaults <> 0 THEN
        RAISE EXCEPTION 'Phase645 STOP: release arguments/default drift' USING ERRCODE = '55000';
      END IF;
    END IF;
    IF pg_catalog.md5(p.prosrc) IS DISTINCT FROM target.body_md5
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] THEN
      RAISE EXCEPTION 'Phase645 STOP: new body/config drift for %', target.signature USING ERRCODE = '55000';
    END IF;
    IF p.proacl IS NULL
       OR (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) <> 2
       OR (SELECT count(DISTINCT a.grantee) FROM pg_catalog.aclexplode(p.proacl) a) <> 2
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee NOT IN (p.proowner, 'authenticated'::regrole::oid)
             OR a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'Phase645 STOP: exact ACL drift for %', target.signature USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Phase645 STOP: effective EXECUTE mismatch for %', target.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$phase645_postcheck$;
NOTIFY pgrst, 'reload schema';
COMMIT;
