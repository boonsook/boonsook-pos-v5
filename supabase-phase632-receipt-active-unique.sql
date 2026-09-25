-- Phase 632 v1.1. Owner executes only after independent review and authorization.
-- Run this entire file in one submission. Run POST-CHECK A and B separately again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public.receipts IN SHARE MODE;

DO $phase632_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.receipts'::regclass AND relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Phase 632 STOP: receipts must be an ordinary table';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.receipts'::regclass
        AND attnum > 0 AND NOT attisdropped
        AND ((attname = 'delivery_invoice_id' AND atttypid = 'pg_catalog.int8'::regtype)
          OR (attname = 'status' AND atttypid = 'pg_catalog.text'::regtype))) <> 2 THEN
    RAISE EXCEPTION 'Phase 632 STOP: column types have drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.receipts
    WHERE delivery_invoice_id IS NOT NULL
      AND status IS DISTINCT FROM 'cancelled'
    GROUP BY delivery_invoice_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Phase 632 STOP: duplicate active receipts exist';
  END IF;
END
$phase632_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_one_active_per_delivery_invoice
  ON public.receipts USING btree (delivery_invoice_id)
  WHERE delivery_invoice_id IS NOT NULL
    AND status IS DISTINCT FROM 'cancelled';

DO $phase632_verify$
DECLARE
  v record;
BEGIN
  SELECT i.*, idx.relkind AS index_kind, am.amname AS access_method,
         a.attnum AS expected_attnum, opc.opcname AS opclass_name,
         opn.nspname AS opclass_schema, opc.opcdefault AS default_opclass,
         opc.opcintype AS opclass_input_type,
         pg_get_expr(i.indpred, i.indrelid, false) AS predicate_sql
  INTO v
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace ins ON ins.oid = idx.relnamespace
  JOIN pg_catalog.pg_am am ON am.oid = idx.relam
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid
    AND a.attname = 'delivery_invoice_id' AND a.attnum > 0 AND NOT a.attisdropped
  JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[0]
  JOIN pg_catalog.pg_namespace opn ON opn.oid = opc.opcnamespace
  WHERE i.indrelid = 'public.receipts'::regclass
    AND ins.nspname = 'public'
    AND idx.relname = 'uq_receipts_one_active_per_delivery_invoice';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 632 STOP: exact candidate index is missing';
  END IF;
  IF v.indisunique IS DISTINCT FROM true
     OR v.indisvalid IS DISTINCT FROM true
     OR v.indisready IS DISTINCT FROM true
     OR v.indislive IS DISTINCT FROM true
     OR v.indimmediate IS DISTINCT FROM true
     OR v.indisexclusion IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Phase 632 STOP: invalid uniqueness/health';
  END IF;
  IF v.index_kind IS DISTINCT FROM 'i'
     OR v.access_method IS DISTINCT FROM 'btree'
     OR v.indnkeyatts IS DISTINCT FROM 1
     OR v.indnatts IS DISTINCT FROM 1
     OR v.indkey[0] IS DISTINCT FROM v.expected_attnum
     OR v.indexprs IS NOT NULL
     OR v.indoption[0] IS DISTINCT FROM 0
     OR v.indcollation[0] IS DISTINCT FROM 0::oid
     OR v.opclass_name IS DISTINCT FROM 'int8_ops'
     OR v.opclass_schema IS DISTINCT FROM 'pg_catalog'
     OR v.default_opclass IS DISTINCT FROM true
     OR v.opclass_input_type IS DISTINCT FROM 'pg_catalog.int8'::regtype THEN
    RAISE EXCEPTION 'Phase 632 STOP: exact single-key definition mismatch';
  END IF;
  -- Deliberately strict canonical deparse: a different server rendering stops safely.
  -- Do not use substring/LIKE matching: extra AND/OR clauses change covered rows.
  IF v.predicate_sql IS DISTINCT FROM
     '((delivery_invoice_id IS NOT NULL) AND (status IS DISTINCT FROM ''cancelled''::text))' THEN
    RAISE EXCEPTION 'Phase 632 STOP: exact predicate mismatch: %', v.predicate_sql;
  END IF;
END
$phase632_verify$;
COMMIT;

-- POST-CHECK A BEGIN
SELECT idx.relname AS index_name, i.indisunique, i.indisvalid,
       i.indisready, i.indislive, i.indimmediate, i.indisexclusion,
       i.indnkeyatts, i.indnatts, i.indkey::text AS key_attnums,
       i.indexprs IS NULL AS no_expressions, am.amname AS access_method,
       pg_get_indexdef(i.indexrelid) AS index_definition,
       pg_get_expr(i.indpred, i.indrelid, false) AS predicate
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = idx.relam
WHERE n.nspname = 'public'
  AND idx.relname = 'uq_receipts_one_active_per_delivery_invoice'
  AND i.indrelid = 'public.receipts'::regclass;
-- POST-CHECK A END

-- POST-CHECK B BEGIN
SELECT delivery_invoice_id, count(*) AS active_count
FROM public.receipts
WHERE delivery_invoice_id IS NOT NULL
  AND status IS DISTINCT FROM 'cancelled'
GROUP BY delivery_invoice_id HAVING count(*) > 1;
-- POST-CHECK B END
