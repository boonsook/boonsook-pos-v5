-- Phase 628A — document item_type schema foundation
-- OWNER-RUN ONLY after independent review. This file is not executed by the implement team.
-- Existing rows are always backfilled as item; never infer heading from money/product fields.

BEGIN;

DO $phase628a$
DECLARE
  target_table text;
  target_oid oid;
  column_type text;
  column_generated "char";
  column_identity "char";
  unexpected_checks text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'quotation_items',
    'delivery_invoice_items',
    'receipt_items'
  ] LOOP
    SELECT c.oid
      INTO target_oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = target_table
       AND c.relkind = 'r';

    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'Phase 628A: public.% is missing or is not an ordinary table', target_table;
    END IF;

    SELECT a.atttypid::regtype::text, a.attgenerated, a.attidentity
      INTO column_type, column_generated, column_identity
      FROM pg_attribute a
     WHERE a.attrelid = target_oid
       AND a.attname = 'item_type'
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF FOUND AND (
      column_type <> 'text'
      OR column_generated <> ''
      OR column_identity <> ''
    ) THEN
      RAISE EXCEPTION 'Phase 628A: public.%.item_type exists with an incompatible definition', target_table;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS item_type text',
      target_table
    );

    EXECUTE format(
      'UPDATE public.%I SET item_type = %L WHERE item_type IS NULL',
      target_table,
      'item'
    );

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN item_type SET DEFAULT %L',
      target_table,
      'item'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN item_type SET NOT NULL',
      target_table
    );

    SELECT string_agg(k.conname, ', ' ORDER BY k.conname)
      INTO unexpected_checks
      FROM pg_constraint k
     WHERE k.conrelid = target_oid
       AND k.contype = 'c'
       AND pg_get_expr(k.conbin, k.conrelid) ILIKE '%item_type%'
       AND k.conname <> target_table || '_item_type_check';

    IF unexpected_checks IS NOT NULL THEN
      RAISE EXCEPTION 'Phase 628A: public.% has unexpected item_type checks: %', target_table, unexpected_checks;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      target_table,
      target_table || '_item_type_check'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (item_type IN (%L, %L))',
      target_table,
      target_table || '_item_type_check',
      'item',
      'heading'
    );
  END LOOP;
END
$phase628a$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- POST-CHECK A: exactly 3 rows; type/default/not-null/check must match.
SELECT
  c.relname AS table_name,
  a.atttypid::regtype::text AS data_type,
  a.attnotnull AS not_null,
  pg_get_expr(d.adbin, d.adrelid) AS default_expr,
  pg_get_constraintdef(k.oid, true) AS check_definition
FROM pg_class c
JOIN pg_namespace n
  ON n.oid = c.relnamespace
 AND n.nspname = 'public'
JOIN pg_attribute a
  ON a.attrelid = c.oid
 AND a.attname = 'item_type'
 AND a.attnum > 0
 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d
  ON d.adrelid = c.oid
 AND d.adnum = a.attnum
LEFT JOIN pg_constraint k
  ON k.conrelid = c.oid
 AND k.conname = c.relname || '_item_type_check'
WHERE c.relname IN ('quotation_items', 'delivery_invoice_items', 'receipt_items')
ORDER BY c.relname;

-- POST-CHECK B: exactly 3 rows; invalid/null/heading must all be 0 immediately after 628A.
SELECT 'quotation_items' AS table_name,
       count(*) AS total_rows,
       count(*) FILTER (WHERE item_type = 'item') AS item_rows,
       count(*) FILTER (WHERE item_type = 'heading') AS heading_rows,
       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading')) AS invalid_rows
  FROM public.quotation_items
UNION ALL
SELECT 'delivery_invoice_items',
       count(*),
       count(*) FILTER (WHERE item_type = 'item'),
       count(*) FILTER (WHERE item_type = 'heading'),
       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))
  FROM public.delivery_invoice_items
UNION ALL
SELECT 'receipt_items',
       count(*),
       count(*) FILTER (WHERE item_type = 'item'),
       count(*) FILTER (WHERE item_type = 'heading'),
       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))
  FROM public.receipt_items
ORDER BY table_name;
