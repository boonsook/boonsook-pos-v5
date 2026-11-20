-- Phase 647 candidate (NOT APPLIED): make the existing deferred JE balance
-- trigger see journal_lines while a non-accountant inserts auto-post lines.
-- This changes only the execution context of the existing trigger function.
-- It does not relax RLS, change accounting amounts, or repair old orphan JVs.
-- Apply only after a fresh production catalog preflight and separate approval.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $phase647_preflight$
DECLARE
  v_fn oid := to_regprocedure('public.enforce_je_lines_balance()');
  v_body text;
BEGIN
  IF current_user <> 'postgres' OR v_fn IS NULL THEN
    RAISE EXCEPTION 'Phase647 STOP: expected postgres and existing balance function';
  END IF;

  SELECT p.prosrc INTO v_body
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_fn
    AND l.lanname = 'plpgsql'
    AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND p.proowner = 'postgres'::pg_catalog.regrole
    AND pg_catalog.md5(p.prosrc) = 'cd812932adf24bc9887a432c084db477'
    AND NOT p.prosecdef;
  IF v_body IS NULL
     OR pg_catalog.strpos(v_body, 'FROM public.journal_entries') = 0
     OR pg_catalog.strpos(v_body, 'FROM public.journal_lines') = 0
     OR pg_catalog.strpos(v_body, 'v_dr <> v_hdr_dr OR v_cr <> v_hdr_cr') = 0 THEN
    RAISE EXCEPTION 'Phase647 STOP: balance function differs from reviewed invoker';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgname = 'trg_je_lines_balance'
      AND t.tgrelid = 'public.journal_lines'::pg_catalog.regclass
      AND t.tgfoid = v_fn
      AND t.tgdeferrable AND t.tginitdeferred
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Phase647 STOP: expected enabled deferred balance trigger';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
      WHERE c.oid IN ('public.journal_entries'::pg_catalog.regclass,
                      'public.journal_lines'::pg_catalog.regclass)
        AND c.relowner = 'postgres'::pg_catalog.regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 2 THEN
    RAISE EXCEPTION 'Phase647 STOP: journal table owner/RLS differs from reviewed state';
  END IF;
END;
$phase647_preflight$;

-- The function uses public-qualified table names; built-ins resolve only from
-- pg_catalog. The table owner can see all lines despite jl_select RLS, so the
-- deferred SUM checks the actual inserted rows, without exposing them to staff.
ALTER FUNCTION public.enforce_je_lines_balance() SECURITY DEFINER;
ALTER FUNCTION public.enforce_je_lines_balance()
  SET search_path = pg_catalog, pg_temp;

DO $phase647_postcheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.enforce_je_lines_balance()'::pg_catalog.regprocedure
      AND p.prosecdef
      AND p.proowner = 'postgres'::pg_catalog.regrole
      AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Phase647 STOP: balance function security context not installed';
  END IF;
END;
$phase647_postcheck$;

COMMIT;
