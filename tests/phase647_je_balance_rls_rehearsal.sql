-- Run ONLY in an isolated, disposable PostgreSQL 17 database as postgres.
-- This deliberately exercises the historical invoker failure, then the
-- candidate migration, then a success and a still-rejected imbalance.
\set ON_ERROR_STOP on

CREATE ROLE authenticated;
CREATE TABLE public.journal_entries (
  id bigint PRIMARY KEY,
  total_debit numeric(14,2) NOT NULL,
  total_credit numeric(14,2) NOT NULL
);
CREATE TABLE public.journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  debit numeric(14,2) NOT NULL,
  credit numeric(14,2) NOT NULL
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY je_select ON public.journal_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY je_insert ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY je_delete ON public.journal_entries FOR DELETE TO authenticated USING (false);
CREATE POLICY jl_select ON public.journal_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY jl_insert ON public.journal_lines FOR INSERT TO authenticated WITH CHECK (true);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.journal_entries TO authenticated;
GRANT SELECT, INSERT ON public.journal_lines TO authenticated;
GRANT USAGE ON SEQUENCE public.journal_lines_id_seq TO authenticated;

\i supabase-phase498-je-lines-balance.sql

-- Reshape the installed body to the production prosrc read by C2-S on 2026-11-20
-- (same statements; SQL line comments removed; CRLF line endings) so the pin applies.
DO $prodshape$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.enforce_je_lines_balance()'::pg_catalog.regprocedure;
  v_src := pg_catalog.regexp_replace(v_src, '^[ \t]*--[^\n]*\n', '', 'gn');
  v_src := pg_catalog.regexp_replace(v_src, '[ \t]+--[^\n]*', '', 'g');
  v_src := pg_catalog.replace(v_src, E'\n', E'\r\n');
  IF pg_catalog.md5(v_src) <> 'cd812932adf24bc9887a432c084db477' THEN
    RAISE EXCEPTION 'Phase647 fixture: production-shaped body md5 %', pg_catalog.md5(v_src);
  END IF;
  EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION public.enforce_je_lines_balance()'
    ' RETURNS trigger LANGUAGE plpgsql AS %L', v_src);
END;
$prodshape$;

SET ROLE authenticated;
INSERT INTO public.journal_entries(id, total_debit, total_credit) VALUES (663, 10, 10);
DO $before$
BEGIN
  BEGIN
    INSERT INTO public.journal_lines(entry_id, debit, credit)
    VALUES (663, 10, 0), (663, 0, 10);
    SET CONSTRAINTS public.trg_je_lines_balance IMMEDIATE;
    RAISE EXCEPTION 'Phase647 fixture: invoker unexpectedly accepted lines';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%(0.00/0.00) <> header (10.00/10.00)%' THEN
      RAISE;
    END IF;
  END;
END;
$before$;
RESET ROLE;

\i supabase-phase647-je-balance-trigger-rls.sql

SET ROLE authenticated;
INSERT INTO public.journal_lines(entry_id, debit, credit)
VALUES (663, 10, 0), (663, 0, 10);
DO $privacy$
DECLARE v_deleted integer;
BEGIN
  IF (SELECT count(*) FROM public.journal_lines WHERE entry_id = 663) <> 0 THEN
    RAISE EXCEPTION 'Phase647 fixture: staff gained line SELECT';
  END IF;
  DELETE FROM public.journal_entries WHERE id = 663;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'Phase647 fixture: staff gained header DELETE';
  END IF;
END;
$privacy$;
DO $negative$
BEGIN
  BEGIN
    INSERT INTO public.journal_entries(id, total_debit, total_credit) VALUES (664, 10, 10);
    INSERT INTO public.journal_lines(entry_id, debit, credit)
    VALUES (664, 10, 0), (664, 0, 9);
    SET CONSTRAINTS public.trg_je_lines_balance IMMEDIATE;
    RAISE EXCEPTION 'Phase647 fixture: unbalanced lines unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%lines ไม่บาลานซ์%' THEN
      RAISE;
    END IF;
  END;
END;
$negative$;
RESET ROLE;

INSERT INTO public.journal_entries(id, total_debit, total_credit) VALUES (665, 10, 10);
INSERT INTO public.journal_lines(entry_id, debit, credit)
VALUES (665, 10, 0), (665, 0, 10);
DELETE FROM public.journal_entries WHERE id = 665;
INSERT INTO public.journal_entries(id, total_debit, total_credit) VALUES (666, 10, 10);

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.entry_id = je.id
    WHERE je.id = 663
    GROUP BY je.id
    HAVING count(*) = 2 AND sum(jl.debit) = 10 AND sum(jl.credit) = 10
  ) OR EXISTS (SELECT 1 FROM public.journal_entries WHERE id IN (664, 665))
    OR EXISTS (SELECT 1 FROM public.journal_lines WHERE entry_id = 665)
    OR NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = 666)
    OR EXISTS (SELECT 1 FROM public.journal_lines WHERE entry_id = 666) THEN
    RAISE EXCEPTION 'Phase647 fixture: final rows differ from expected';
  END IF;
  RAISE NOTICE 'PHASE647 LOCAL PG PASS: invoker 0/0, definer 10/10, negative blocked, cascade/header-only preserved';
END;
$post$;
