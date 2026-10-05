-- Catalog-only verification, not behavioral proof. Never invokes a credit RPC.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,pg_temp;
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
SELECT 'PHASE645 CATALOG PASS' AS result;
ROLLBACK;
