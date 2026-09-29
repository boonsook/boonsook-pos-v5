-- Phase 639: REVIEW CANDIDATE ONLY. NOT RUN on staging/production.
-- Run the ENTIRE file once, only after separate owner approval.
-- Client must use UTF8 and set statement_timeout (1..30000 ms) BEFORE this DO.
-- One atomic DO owns all mutations; no cross-submission transaction is assumed.
-- Freeze the cloud template visible at cutover, NOT unknowable historical text.
-- Constant JSONB DEFAULT supplies old rows without UPDATE/backfill or DML triggers.
DO $phase639$
DECLARE t text; info jsonb; k text; kind text; title text; visibility text;
        titles text; snapshot jsonb; timeout_ms bigint; actual text; expected_hex text;
BEGIN
  SELECT setting::bigint INTO STRICT timeout_ms FROM pg_settings WHERE name='statement_timeout';
  IF timeout_ms < 1 OR timeout_ms > 30000 THEN
    RAISE EXCEPTION 'Phase 639 STOP: set statement_timeout to 1..30000ms before submission';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  IF current_setting('client_encoding') <> 'UTF8' OR current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'Phase 639 STOP: UTF8 client/server required';
  END IF;
  -- ASCII hex pins detect damaged Thai literals, not merely question marks/length.
  FOR actual, expected_hex IN SELECT * FROM (VALUES
    ('ใบเสนอราคา','e0b983e0b89ae0b980e0b8aae0b899e0b8ade0b8a3e0b8b2e0b884e0b8b2'),
    ('ใบประเมินราคา','e0b983e0b89ae0b89be0b8a3e0b8b0e0b980e0b8a1e0b8b4e0b899e0b8a3e0b8b2e0b884e0b8b2'),
    ('ใบส่งสินค้า/ใบแจ้งหนี้','e0b983e0b89ae0b8aae0b988e0b887e0b8aae0b8b4e0b899e0b884e0b989e0b8b22fe0b983e0b89ae0b981e0b888e0b989e0b887e0b8abe0b899e0b8b5e0b989'),
    ('ใบส่งสินค้า','e0b983e0b89ae0b8aae0b988e0b887e0b8aae0b8b4e0b899e0b884e0b989e0b8b2'),
    ('ใบแจ้งหนี้','e0b983e0b89ae0b981e0b888e0b989e0b887e0b8abe0b899e0b8b5e0b989'),
    ('ใบเสร็จรับเงิน','e0b983e0b89ae0b980e0b8aae0b8a3e0b987e0b888e0b8a3e0b8b1e0b89ae0b980e0b887e0b8b4e0b899')
  ) AS v(actual,expected_hex) LOOP
    IF encode(convert_to(actual,'UTF8'),'hex') <> expected_hex THEN
      RAISE EXCEPTION 'Phase 639 STOP: Thai literal bytes do not match';
    END IF;
  END LOOP;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'Phase 639 STOP: rehearsal requires PostgreSQL 17+';
  END IF;
  IF to_regprocedure('public.phase639_preserve_document_template()') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 639 STOP: already applied or function-name collision; do not rerun';
  END IF;
  SELECT value INTO STRICT info FROM public.app_settings WHERE key = 'store_info' FOR SHARE;
  IF jsonb_typeof(info) IS DISTINCT FROM 'object' OR info ? 'docTemplatesV1' THEN
    RAISE EXCEPTION 'Phase 639 STOP: inspect cloud store_info before cutover';
  END IF;
  FOREACH k IN ARRAY ARRAY['docHeader', 'docFooter', 'docNote'] LOOP
    IF info ? k AND jsonb_typeof(info->k) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Phase 639 STOP: invalid legacy text %', k;
    END IF;
    IF length(coalesce(info->>k, '')) > 4000 THEN
      RAISE EXCEPTION 'Phase 639 STOP: legacy text too long %', k;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['docShowNoteQuotation', 'docShowNoteDelivery', 'docShowNoteReceipt'] LOOP
    IF info ? k AND jsonb_typeof(info->k) NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'Phase 639 STOP: invalid legacy visibility %', k;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['quotations', 'delivery_invoices', 'receipts'] LOOP
    IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=t AND c.relkind='r') THEN
      RAISE EXCEPTION 'Phase 639 STOP: missing/unsupported table %', t;
    END IF;
    IF EXISTS (SELECT FROM pg_attribute WHERE attrelid=to_regclass('public.'||t)
        AND attname='document_template_snapshot' AND NOT attisdropped) THEN
      RAISE EXCEPTION 'Phase 639 STOP: column already exists on %; inspect, do not rerun', t;
    END IF;
  END LOOP;
  EXECUTE $function_ddl$
CREATE FUNCTION public.phase639_preserve_document_template() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $body$
BEGIN
  IF NEW.document_template_snapshot IS DISTINCT FROM OLD.document_template_snapshot THEN
    RAISE EXCEPTION 'Phase 639: document template snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$
  $function_ddl$;
REVOKE ALL ON FUNCTION public.phase639_preserve_document_template() FROM PUBLIC, anon, authenticated, service_role;
  FOR t, kind, title, visibility, titles IN SELECT * FROM (VALUES
    ('quotations', 'quotation', 'ใบเสนอราคา', 'docShowNoteQuotation', '''ใบเสนอราคา'',''ใบประเมินราคา'''),
    ('delivery_invoices', 'delivery', 'ใบส่งสินค้า/ใบแจ้งหนี้', 'docShowNoteDelivery', '''ใบส่งสินค้า/ใบแจ้งหนี้'',''ใบส่งสินค้า'',''ใบแจ้งหนี้'''),
    ('receipts', 'receipt', 'ใบเสร็จรับเงิน', 'docShowNoteReceipt', '''ใบเสร็จรับเงิน''')
  ) AS v(t,k,title,visibility,titles) LOOP
    snapshot := jsonb_build_object('version',1,'document_type',kind,'title',title,
      'header',coalesce(info->>'docHeader',''), 'footer',coalesce(info->>'docFooter',''),
      'note',coalesce(info->>'docNote',''), 'show_note',(info->visibility IS DISTINCT FROM 'false'::jsonb));
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN document_template_snapshot jsonb NOT NULL DEFAULT %L::jsonb', t, snapshot::text);
    EXECUTE format($check$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((
        jsonb_typeof(document_template_snapshot) = 'object'
        AND document_template_snapshot->'version' = '1'::jsonb
        AND document_template_snapshot->>'document_type' = %L
        AND document_template_snapshot->>'title' IN (%s)
        AND jsonb_typeof(document_template_snapshot->'header') = 'string'
        AND jsonb_typeof(document_template_snapshot->'footer') = 'string'
        AND jsonb_typeof(document_template_snapshot->'note') = 'string'
        AND length(document_template_snapshot->>'header') <= 4000
        AND length(document_template_snapshot->>'footer') <= 4000
        AND length(document_template_snapshot->>'note') <= 4000
        AND jsonb_typeof(document_template_snapshot->'show_note') = 'boolean'
      ) IS TRUE)
    $check$, t, t||'_document_template_check', kind, titles);
    EXECUTE format('CREATE TRIGGER phase639_document_template_immutable BEFORE UPDATE OF document_template_snapshot ON public.%I FOR EACH ROW EXECUTE FUNCTION public.phase639_preserve_document_template()',t);
  END LOOP;
  -- Delivered only on successful completion/commit of this atomic statement.
  PERFORM pg_notify('pgrst','reload schema');
END
$phase639$;

-- POST-CHECK A: 3 rows, jsonb/not_null=true, constant JSON defaults, validated checks.
SELECT c.relname, a.atttypid::regtype AS data_type, a.attnotnull AS not_null,
       a.atthasmissing, pg_get_expr(d.adbin,d.adrelid) AS frozen_legacy_default,
       k.convalidated, pg_get_constraintdef(k.oid) AS constraint_definition
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='document_template_snapshot' AND NOT a.attisdropped
JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
JOIN pg_constraint k ON k.conrelid=c.oid AND k.conname=c.relname||'_document_template_check'
WHERE n.nspname='public' AND c.relname IN ('quotations','delivery_invoices','receipts') ORDER BY c.relname;
-- POST-CHECK B: 3 enabled BEFORE UPDATE row triggers; INVOKER, empty search_path.
SELECT t.tgrelid::regclass AS table_name,t.tgname,t.tgenabled,t.tgtype,p.prosecdef,p.proconfig,p.proacl
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE p.oid='public.phase639_preserve_document_template()'::regprocedure ORDER BY table_name;

-- POST-CHECK C: initial fast-default Thai titles, exact UTF8 hex per type.
-- Capture immediately after apply; missing fast-default metadata => not evidenced.
WITH expected(table_name,title_hex) AS (VALUES
  ('quotations','e0b983e0b89ae0b980e0b8aae0b899e0b8ade0b8a3e0b8b2e0b884e0b8b2'),
  ('delivery_invoices','e0b983e0b89ae0b8aae0b988e0b887e0b8aae0b8b4e0b899e0b884e0b989e0b8b22fe0b983e0b89ae0b981e0b888e0b989e0b887e0b8abe0b899e0b8b5e0b989'),
  ('receipts','e0b983e0b89ae0b980e0b8aae0b8a3e0b987e0b888e0b8a3e0b8b1e0b89ae0b980e0b887e0b8b4e0b899')
)
SELECT e.table_name, current_setting('client_encoding') AS client_encoding,
       to_jsonb(a.attmissingval)->0->>'title' AS frozen_title,
       length(to_jsonb(a.attmissingval)->0->>'title') AS title_length,
       encode(convert_to(to_jsonb(a.attmissingval)->0->>'title','UTF8'),'hex') AS actual_title_hex,
       e.title_hex AS expected_title_hex,
       (a.atthasmissing AND encode(convert_to(to_jsonb(a.attmissingval)->0->>'title','UTF8'),'hex')=e.title_hex) IS TRUE AS title_utf8_ok
FROM expected e
LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||e.table_name)
  AND a.attname='document_template_snapshot' AND NOT a.attisdropped
ORDER BY e.table_name;
