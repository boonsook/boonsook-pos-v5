-- Phase 646 LOCAL DRAFT. Catalog-only; do not run on production without a
-- separate owner authorization. No business rows, RPC calls, or migration.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'measured_at', pg_catalog.clock_timestamp(),
  'server_version', pg_catalog.current_setting('server_version'),
  'database_encoding', pg_catalog.current_setting('server_encoding'),
  'tables', (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', c.relname,
      'owner', pg_catalog.pg_get_userbyid(c.relowner),
      'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'columns', (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
          'column_acl', a.attacl
        ) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      ),
      'constraints', (
        SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) ORDER BY k.conname)
        FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid
      ),
      'triggers', (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', t.tgname, 'enabled', t.tgenabled,
          'definition', pg_catalog.pg_get_triggerdef(t.oid)
        ) ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
      ),
      'policies', (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', p.policyname, 'cmd', p.cmd, 'permissive', p.permissive,
          'roles', p.roles, 'using', p.qual, 'check', p.with_check
        ) ORDER BY p.policyname)
        FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      ),
      'acl', c.relacl
    ) ORDER BY c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (
      'refunds', 'sales', 'sale_items', 'stock_movements', 'warehouse_stock',
      'loyalty_points', 'journal_entries', 'journal_lines',
      'customer_credit_ledger', 'profiles'
    )
  )
)) AS phase646_catalog_only;

ROLLBACK;
