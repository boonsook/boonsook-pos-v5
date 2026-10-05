-- Proposed catalog-only input query. NOT executed as part of this local draft.
-- Confirm trusted client project rwmmjljelpcpwohwiplu and separately authorize
-- this read before execution. Database name alone does not identify a project.
-- No business rows, no credit RPC calls, no RLS/grant changes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT current_timestamp AS checked_at, current_user AS operator_role,
       session_user AS session_role, current_setting('server_version') AS version,
       current_setting('transaction_read_only') AS read_only;

SELECT c.oid::regclass::text AS relation, c.relkind,
       pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity,
       c.relacl::text AS direct_acl,
       r.rolname, r.rolsuper, r.rolbypassrls,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname='public' AND c.relname='customer_credit_ledger'
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY r.rolname;

-- Column grants can expose access even when a table-level privilege is false.
SELECT a.attname, a.attacl::text AS direct_column_acl, r.rolname,
       has_column_privilege(r.oid,a.attrelid,a.attnum,'SELECT') AS can_select,
       has_column_privilege(r.oid,a.attrelid,a.attnum,'INSERT') AS can_insert,
       has_column_privilege(r.oid,a.attrelid,a.attnum,'UPDATE') AS can_update
FROM pg_attribute a CROSS JOIN pg_roles r
WHERE a.attrelid=to_regclass('public.customer_credit_ledger')
  AND a.attnum>0 AND NOT a.attisdropped
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY r.rolname,a.attnum;

SELECT p.polname, p.polcmd, p.polpermissive,
       ARRAY(SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END
             FROM unnest(p.polroles) x) AS roles,
       pg_get_expr(p.polqual,p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
FROM pg_policy p
WHERE p.polrelid=to_regclass('public.customer_credit_ledger')
ORDER BY p.polname;

-- Which policy roles are immediately inherited by exposed database roles?
SELECT exposed.rolname AS exposed_role, inherited.rolname AS inherited_role,
       pg_has_role(exposed.oid,inherited.oid,'USAGE') AS immediately_available
FROM pg_roles exposed CROSS JOIN pg_roles inherited
WHERE exposed.rolname IN ('anon','authenticated','service_role')
  AND exposed.oid<>inherited.oid
  AND pg_has_role(exposed.oid,inherited.oid,'USAGE')
ORDER BY exposed.rolname,inherited.rolname;

SELECT p.oid::regprocedure::text AS helper, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl::text AS acl,
       md5(p.prosrc) AS raw_body_md5, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('is_customer_role','is_admin')
ORDER BY helper;
ROLLBACK;
