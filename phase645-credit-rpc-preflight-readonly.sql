-- Phase 645 / B1: LOCAL REVIEW CANDIDATE ONLY. No shared-DB execution authorized.
-- Two RPC authorization gates only; no ledger RLS, table grants or data changes.
-- Raw production prosrc MD5s measured 2026-10-05; never normalize before pinning.
-- Use psql -X -v ON_ERROR_STOP=1 with a separately approved project/session.
-- Run whole file in one session. Any failure aborts; ROLLBACK and STOP. No partial retry.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
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

SELECT 'PHASE645 PREFLIGHT PASS' AS result;
ROLLBACK;
