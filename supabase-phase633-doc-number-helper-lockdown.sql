-- Phase 633 v1.1. Owner executes only after independent review and separate authorization.
-- Goal: app roles must not call public.next_doc_number(text,text) directly,
-- while authorized INSERTs on quotations / delivery_invoices / receipts still get
-- their number from the existing BEFORE INSERT triggers.
-- Cutover (one transaction): pin catalog -> harden helper search_path ->
-- trigger functions become SECURITY DEFINER with empty search_path ->
-- revoke EXECUTE on the helper AND on the three trigger functions ->
-- exact verify (+ denied-call probe, reported NOT RUN when it cannot run) -> COMMIT.
-- No function body, counter row, document row, RLS policy or default privilege changes.
-- Run this entire file in one submission. Run POST-CHECK A, B and C separately again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

DO $phase633_preflight$
DECLARE
  v_helper oid := to_regprocedure('public.next_doc_number(text,text)');
  v_owner  oid;
  r        record;
  v_src    text;
  v_n      integer;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'Phase 633 STOP: expected PostgreSQL 17, got %', current_setting('server_version');
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Phase 633 STOP: run as postgres, current_user=%', current_user;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Phase 633 STOP: expected roles anon/authenticated/service_role';
  END IF;

  -- helper: exact identity, owner, language, body (CRLF from SQL Editor transport tolerated)
  IF v_helper IS NULL THEN
    RAISE EXCEPTION 'Phase 633 STOP: public.next_doc_number(text,text) is missing';
  END IF;
  SELECT p.proowner, p.prosrc INTO v_owner, v_src
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_helper AND l.lanname = 'plpgsql' AND p.prokind = 'f'
    AND p.prorettype = 'pg_catalog.text'::regtype AND NOT p.proretset
    AND p.prosecdef = true AND p.provolatile = 'v';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 633 STOP: helper metadata drifted (language/kind/return/definer/volatility)';
  END IF;
  IF pg_catalog.pg_get_userbyid(v_owner) <> 'postgres' THEN
    RAISE EXCEPTION 'Phase 633 STOP: helper owner is %', pg_catalog.pg_get_userbyid(v_owner);
  END IF;
  IF strpos(replace(v_src, E'\r\n', E'\n'), E'\r') > 0
     OR md5(replace(v_src, E'\r\n', E'\n')) <> '62e6bfb02a14d69c020581ce974f9d7b' THEN
    RAISE EXCEPTION 'Phase 633 STOP: helper body drifted from supabase-phaseB2-doc-no-sequence.sql';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_helper)
     IS DISTINCT FROM ARRAY['search_path=public']
     AND (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_helper)
     IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'Phase 633 STOP: helper proconfig drifted';
  END IF;

  -- trigger functions: exact identity, owner, language, body, pre- or post-cutover state only
  FOR r IN
    SELECT * FROM (VALUES
      ('public.assign_quotation_no()',        'a067467804e02d8b75dc114dee223b63', 'public.quotations',        'trg_assign_quotation_no'),
      ('public.assign_delivery_invoice_no()', '0309cb0dc3406d84e63d35a4046d30df', 'public.delivery_invoices', 'trg_assign_delivery_invoice_no'),
      ('public.assign_receipt_no()',          '19f0ac1c8ebc5c1e76b6a76e65d1121d', 'public.receipts',          'trg_assign_receipt_no')
    ) AS t(fn, body_md5, tbl, tg)
  LOOP
    IF to_regprocedure(r.fn) IS NULL OR to_regclass(r.tbl) IS NULL THEN
      RAISE EXCEPTION 'Phase 633 STOP: % or % is missing', r.fn, r.tbl;
    END IF;
    PERFORM 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = 'plpgsql' AND p.prokind = 'f'
      AND p.prorettype = 'pg_catalog.trigger'::regtype AND p.proowner = v_owner
      AND strpos(replace(p.prosrc, E'\r\n', E'\n'), E'\r') = 0
      AND md5(replace(p.prosrc, E'\r\n', E'\n')) = r.body_md5
      AND ((p.prosecdef = false AND p.proconfig IS NULL)
        OR (p.prosecdef = true AND p.proconfig = ARRAY['search_path=""']));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 633 STOP: % drifted (owner/language/body/security/proconfig)', r.fn;
    END IF;
    SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger tg
    WHERE tg.tgrelid = to_regclass(r.tbl) AND tg.tgname = r.tg
      AND tg.tgfoid = to_regprocedure(r.fn) AND NOT tg.tgisinternal
      AND tg.tgenabled = 'O' AND tg.tgtype = 7;   -- ROW(1) + BEFORE(2) + INSERT(4)
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Phase 633 STOP: trigger % on % drifted', r.tg, r.tbl;
    END IF;
  END LOOP;

  -- every in-database caller must be one of the three trigger functions
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.oid <> v_helper
    AND p.prosrc ILIKE '%next_doc_number%'
    AND p.oid NOT IN (to_regprocedure('public.assign_quotation_no()'),
                      to_regprocedure('public.assign_delivery_invoice_no()'),
                      to_regprocedure('public.assign_receipt_no()'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Phase 633 STOP: % other function(s) reference next_doc_number', v_n;
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND pg_catalog.pg_get_viewdef(c.oid) ILIKE '%next_doc_number%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Phase 633 STOP: % view(s) reference next_doc_number', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_policies
  WHERE coalesce(qual, '') ILIKE '%next_doc_number%' OR coalesce(with_check, '') ILIKE '%next_doc_number%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Phase 633 STOP: % policy(ies) reference next_doc_number', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attrdef d
  WHERE pg_catalog.pg_get_expr(d.adbin, d.adrelid) ILIKE '%next_doc_number%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Phase 633 STOP: % column default(s) reference next_doc_number', v_n;
  END IF;
END
$phase633_preflight$;

-- helper stays SECURITY DEFINER; only its search_path is hardened (body is fully qualified)
ALTER FUNCTION public.next_doc_number(text, text) SET search_path = '';

-- trigger functions run as their owner so they keep calling the helper after the revoke.
-- A function returning trigger cannot be called directly, but any role that still has
-- EXECUTE on it and can create a trigger (e.g. on its own or a temp table) could bind it to
-- another table and run it with the owner's rights; so their EXECUTE is revoked below too.
-- Firing an existing trigger does not check EXECUTE, so document INSERTs keep working.
ALTER FUNCTION public.assign_quotation_no()        SECURITY DEFINER SET search_path = '';
ALTER FUNCTION public.assign_delivery_invoice_no() SECURITY DEFINER SET search_path = '';
ALTER FUNCTION public.assign_receipt_no()          SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.assign_quotation_no(),
                           public.assign_delivery_invoice_no(),
                           public.assign_receipt_no()
  FROM PUBLIC, anon, authenticated, service_role;

DO $phase633_verify$
DECLARE
  v_helper oid := to_regprocedure('public.next_doc_number(text,text)');
  r        record;
  v_n      integer;
  v_state  text;
BEGIN
  PERFORM 1 FROM pg_catalog.pg_proc p
  WHERE p.oid = v_helper AND p.prosecdef = true
    AND p.proconfig = ARRAY['search_path=""']
    AND md5(replace(p.prosrc, E'\r\n', E'\n')) = '62e6bfb02a14d69c020581ce974f9d7b';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 633 STOP: helper final state mismatch';
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid = v_helper AND a.privilege_type = 'EXECUTE' AND a.grantee = 0;
  IF v_n <> 0 OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_helper) IS NULL THEN
    RAISE EXCEPTION 'Phase 633 STOP: PUBLIC still has EXECUTE on the helper';
  END IF;
  IF has_function_privilege('anon', v_helper, 'EXECUTE')
     OR has_function_privilege('authenticated', v_helper, 'EXECUTE')
     OR has_function_privilege('service_role', v_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 633 STOP: an app role can still EXECUTE the helper';
  END IF;
  IF NOT has_function_privilege('postgres', v_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 633 STOP: owner lost EXECUTE on the helper';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.assign_quotation_no()',        'a067467804e02d8b75dc114dee223b63'),
      ('public.assign_delivery_invoice_no()', '0309cb0dc3406d84e63d35a4046d30df'),
      ('public.assign_receipt_no()',          '19f0ac1c8ebc5c1e76b6a76e65d1121d')
    ) AS t(fn, body_md5)
  LOOP
    PERFORM 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure(r.fn) AND p.prosecdef = true
      AND p.proconfig = ARRAY['search_path=""']
      AND p.proowner = (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_helper)
      AND md5(replace(p.prosrc, E'\r\n', E'\n')) = r.body_md5;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 633 STOP: % final state mismatch', r.fn;
    END IF;
    SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
    WHERE p.oid = to_regprocedure(r.fn) AND a.privilege_type = 'EXECUTE' AND a.grantee = 0;
    IF v_n <> 0 OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(r.fn)) IS NULL THEN
      RAISE EXCEPTION 'Phase 633 STOP: PUBLIC still has EXECUTE on %', r.fn;
    END IF;
    IF has_function_privilege('anon', to_regprocedure(r.fn), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.fn), 'EXECUTE')
       OR has_function_privilege('service_role', to_regprocedure(r.fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'Phase 633 STOP: an app role can still EXECUTE %', r.fn;
    END IF;
  END LOOP;

  -- behavioral probe: a denied call fails at the permission check before the body runs,
  -- so it cannot touch doc_number_counters. If a call ever succeeds, the RAISE below
  -- aborts the whole transaction and rolls back that counter increment too.
  -- The probe needs postgres to be a member of the role; otherwise it is NOT RUN (reported
  -- by NOTICE and by POST-CHECK C) and only the catalog checks above apply.
  FOR r IN SELECT rolname, pg_catalog.pg_has_role('postgres', oid, 'MEMBER') AS can_probe
           FROM pg_catalog.pg_roles
           WHERE rolname IN ('anon', 'authenticated')
  LOOP
    IF NOT r.can_probe THEN
      RAISE NOTICE 'Phase 633 probe as %: NOT RUN (postgres is not a member)', r.rolname;
      CONTINUE;
    END IF;
    v_state := NULL;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r.rolname);
      PERFORM public.next_doc_number('QT', 'quotation');
      v_state := 'allowed';
    EXCEPTION WHEN insufficient_privilege THEN
      v_state := 'denied';
    END;
    RESET ROLE;
    IF v_state IS DISTINCT FROM 'denied' THEN
      RAISE EXCEPTION 'Phase 633 STOP: direct call as % was %', r.rolname, v_state;
    END IF;
    RAISE NOTICE 'Phase 633 probe as %: denied', r.rolname;
  END LOOP;
END
$phase633_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- POST-CHECK A BEGIN
SELECT p.oid::regprocedure AS function_name,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig,
       md5(replace(p.prosrc, E'\r\n', E'\n')) AS body_md5,
       p.proacl::text AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public.next_doc_number(text,text)'),
                to_regprocedure('public.assign_quotation_no()'),
                to_regprocedure('public.assign_delivery_invoice_no()'),
                to_regprocedure('public.assign_receipt_no()'))
ORDER BY p.oid::regprocedure::text;
-- POST-CHECK A END

-- POST-CHECK B BEGIN
SELECT tg.tgname, tg.tgrelid::regclass AS table_name, tg.tgfoid::regprocedure AS function_name,
       tg.tgenabled, tg.tgtype
FROM pg_catalog.pg_trigger tg
WHERE tg.tgname IN ('trg_assign_quotation_no', 'trg_assign_delivery_invoice_no', 'trg_assign_receipt_no')
  AND NOT tg.tgisinternal
ORDER BY 1;
-- POST-CHECK B END

-- POST-CHECK C BEGIN
-- probe_ran = false means the in-migration behavioral probe for that role was NOT RUN
SELECT r.rolname, pg_catalog.pg_has_role('postgres', r.oid, 'MEMBER') AS probe_ran
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('anon', 'authenticated')
ORDER BY 1;
-- POST-CHECK C END
