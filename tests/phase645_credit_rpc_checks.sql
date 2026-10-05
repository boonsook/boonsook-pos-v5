-- Executed only by owned local fixture runner. Every failed assertion aborts psql.
BEGIN;
SET ROLE authenticated;
DO $allowed$
DECLARE n integer; a public.customer_credit_ledger; b public.customer_credit_ledger; k text;
BEGIN
 FOR n IN 1..3 LOOP
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-'||lpad(n::text,12,'0'),true);
  -- Business-role claim intentionally false: only trusted profile decides.
  PERFORM set_config('request.jwt.claim.role','customer',true);
  PERFORM set_config('request.jwt.claims','{"role":"customer","user_metadata":{"role":"customer"}}',true);
  k:='allowed-'||n;
  a:=public.redeem_customer_credit(101,k,10,'fixture');
  b:=public.redeem_customer_credit(101,k,10,'fixture');
  IF a.id IS NULL OR a.id IS DISTINCT FROM b.id OR a.amount<>-10 OR a.customer_id<>101
    OR a.source_type<>'sale_credit_use' OR a.source_key<>k OR a.note<>'fixture' OR a.created_by IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'FAIL redeem return/idempotency %',n;
  END IF;
  a:=public.release_customer_credit(k); b:=public.release_customer_credit(k);
  IF a.id IS NULL OR a.id IS DISTINCT FROM b.id OR a.amount<>10 OR a.source_type<>'sale_credit_release'
    OR a.source_key<>k OR a.customer_id<>101 OR a.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'FAIL release return/idempotency %',n; END IF;
  RAISE NOTICE 'PASS authorized roundtrip %',n;
 END LOOP;
 BEGIN PERFORM public.redeem_customer_credit(101,'insufficient',1000,NULL); RAISE EXCEPTION 'FAIL insufficient allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
 a:=public.release_customer_credit('never-used');
 IF a.id IS NOT NULL THEN RAISE EXCEPTION 'FAIL missing release not null'; END IF;
 RAISE NOTICE 'PASS insufficiency and missing-key shape';
END $allowed$;
DO $denied$
DECLARE actor text; k text;
BEGIN
 FOREACH actor IN ARRAY ARRAY['00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',
 '00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000099',''] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","user_metadata":{"role":"admin"},"app_metadata":{"role":"admin"}}',true);
  FOREACH k IN ARRAY ARRAY['allowed-1','missing-denied',NULL,''] LOOP
   BEGIN PERFORM public.redeem_customer_credit(101,k,1,NULL); RAISE EXCEPTION 'AUTH FAIL redeem allowed % key %',actor,k;
   EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
   BEGIN PERFORM public.release_customer_credit(k); RAISE EXCEPTION 'AUTH FAIL release allowed % key %',actor,k;
   EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.redeem_customer_credit(NULL,NULL,-1,NULL); RAISE EXCEPTION 'AUTH FAIL invalid redeem allowed %',actor;
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  RAISE NOTICE 'PASS denied matrix actor %',actor;
 END LOOP;
END $denied$;
RESET ROLE;
DO $acl$
BEGIN
 IF has_function_privilege('anon','public.redeem_customer_credit(bigint,text,numeric,text)','EXECUTE')
 OR has_function_privilege('anon','public.release_customer_credit(text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL anon ACL'; END IF;
 IF (SELECT count(*) FROM public.customer_credit_ledger)<>7 OR (SELECT sum(amount) FROM public.customer_credit_ledger)<>100 THEN RAISE EXCEPTION 'FAIL ledger footprint'; END IF;
 RAISE NOTICE 'PASS ACL and ledger footprint';
END $acl$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_customer_credit(101,'anon',1,NULL); RAISE EXCEPTION 'AUTH FAIL anon redeem'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN PERFORM public.release_customer_credit('allowed-1'); RAISE EXCEPTION 'AUTH FAIL anon release'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
-- Temporarily grant EXECUTE to exercise the internal guard independently of ACL.
-- Entire transaction rolls back; this is never a production grant.
GRANT EXECUTE ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text),public.release_customer_credit(text) TO service_role;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ BEGIN
 BEGIN PERFORM public.redeem_customer_credit(101,'forged-service',1,NULL); RAISE EXCEPTION 'AUTH FAIL service redeem'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN PERFORM public.release_customer_credit('allowed-1'); RAISE EXCEPTION 'AUTH FAIL service release'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS service role forged JWT denied';
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_customer_credit(101,'postgres-no-role',1,NULL); RAISE EXCEPTION 'AUTH FAIL postgres redeem no SET ROLE'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN PERFORM public.release_customer_credit('allowed-1'); RAISE EXCEPTION 'AUTH FAIL postgres no SET ROLE'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
UPDATE public.profiles SET role='customer' WHERE id='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_customer_credit(101,'allowed-1',10,NULL); RAISE EXCEPTION 'AUTH FAIL stale demoted redeem'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN PERFORM public.release_customer_credit('allowed-1'); RAISE EXCEPTION 'AUTH FAIL stale demoted compensation'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS stale demotion denies compensation: residual recovery policy not B2 fix';
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT (public.redeem_customer_credit(101,'active-sale',10,NULL)).id;
RESET ROLE;
INSERT INTO public.sales VALUES('active-sale',10,'active');
SET ROLE authenticated;
SELECT (public.release_customer_credit('active-sale')).id;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.sales WHERE checkout_key='active-sale' AND status='active')
 OR (SELECT sum(amount) FROM public.customer_credit_ledger WHERE source_key='active-sale')<>0 THEN RAISE EXCEPTION 'FAIL B2 residual not reproduced'; END IF;
 RAISE NOTICE 'PASS B2 residual: active-sale release remains possible';
END $$;
ROLLBACK;
