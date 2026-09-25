import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlPath = process.env.PHASE632_SQL_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase-phase632-receipt-active-unique.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const canonical = "'((delivery_invoice_id IS NOT NULL) AND (status IS DISTINCT FROM ''cancelled''::text))'";
const checks = [
  'IF NOT FOUND THEN',
  ...['indisunique', 'indisvalid', 'indisready', 'indislive', 'indimmediate'].map(k => `v.${k} IS DISTINCT FROM true`),
  'v.indisexclusion IS DISTINCT FROM false',
  "v.index_kind IS DISTINCT FROM 'i'",
  "v.access_method IS DISTINCT FROM 'btree'",
  'v.indnkeyatts IS DISTINCT FROM 1',
  'v.indnatts IS DISTINCT FROM 1',
  'v.indkey[0] IS DISTINCT FROM v.expected_attnum',
  'v.indexprs IS NOT NULL',
  'v.indoption[0] IS DISTINCT FROM 0',
  'v.indcollation[0] IS DISTINCT FROM 0::oid',
  "v.opclass_name IS DISTINCT FROM 'int8_ops'",
  "v.opclass_schema IS DISTINCT FROM 'pg_catalog'",
  'v.default_opclass IS DISTINCT FROM true',
  "v.opclass_input_type IS DISTINCT FROM 'pg_catalog.int8'::regtype",
];
function validate(source) {
  const executable = source.replace(/^\s*--.*$/gm, '');
  const pre = executable.match(/DO \$phase632_preflight\$([\s\S]*?)\$phase632_preflight\$;/)?.[1];
  const verify = executable.match(/DO \$phase632_verify\$([\s\S]*?)\$phase632_verify\$;/)?.[1];
  assert.ok(pre && verify);
  assert.match(pre, /HAVING count\(\*\) > 1/);
  assert.ok(pre.includes("ERRCODE = '23505'"));
  const create = "CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_one_active_per_delivery_invoice\n  ON public.receipts USING btree (delivery_invoice_id)\n  WHERE delivery_invoice_id IS NOT NULL\n    AND status IS DISTINCT FROM 'cancelled';";
  assert.ok(executable.includes(create));
  const order = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';", 'LOCK TABLE public.receipts IN SHARE MODE;', 'DO $phase632_preflight$', create, 'DO $phase632_verify$', '$phase632_verify$;', 'COMMIT;'];
  let previous = -1;
  for (const token of order) { const at = executable.indexOf(token); assert.ok(at > previous, `order: ${token}`); previous = at; }
  assert.equal((executable.match(/\bCOMMIT;/g) || []).length, 1);
  for (const token of checks) assert.ok(verify.includes(token), token);
  assert.ok(verify.includes('v.predicate_sql IS DISTINCT FROM\n     ' + canonical));
  assert.ok(verify.includes("i.indrelid = 'public.receipts'::regclass"));
  assert.ok(verify.includes("ins.nspname = 'public'"));
  assert.doesNotMatch(verify, /\bposition\s*\(|\bLIKE\b/i);
  assert.doesNotMatch(executable, /\b(?:CONCURRENTLY|INSERT|UPDATE|DELETE|TRUNCATE|NOTIFY|GRANT|REVOKE)\b/i);
}
function once(source, from, to) {
  assert.equal(source.split(from).length - 1, 1, `unique anchor: ${from}`);
  return source.replace(from, to);
}
test('v1.1 structural SQL contract', () => validate(sql));
const mutants = [
  ['no UNIQUE', s => once(s, 'CREATE UNIQUE INDEX', 'CREATE INDEX')],
  ['second key in DDL', s => once(s, 'USING btree (delivery_invoice_id)', 'USING btree (delivery_invoice_id, id)')],
  ['extra predicate in DDL', s => once(s, "AND status IS DISTINCT FROM 'cancelled';", "AND status IS DISTINCT FROM 'cancelled' AND status = 'pending';")],
  ['NULL bypass', s => once(s, "AND status IS DISTINCT FROM 'cancelled';", "AND status <> 'cancelled';")],
  ['weak lock', s => once(s, 'IN SHARE MODE;', 'IN ACCESS SHARE MODE;')],
  ['early COMMIT', s => once(once(s, 'COMMIT;', ''), 'CREATE UNIQUE INDEX', 'COMMIT;\nCREATE UNIQUE INDEX')],
  ['wrong duplicate code', s => once(s, "ERRCODE = '23505'", "ERRCODE = 'P0001'")],
  ['duplicate threshold', s => once(s, 'HAVING count(*) > 1\n  ) THEN', 'HAVING count(*) > 9\n  ) THEN')],
  ['substring predicate', s => once(s, 'v.predicate_sql IS DISTINCT FROM', 'v.predicate_sql NOT LIKE')],
  ['NULL predicate comparison', s => once(s, 'v.predicate_sql IS DISTINCT FROM', 'v.predicate_sql <>')],
  ['missing non-null predicate', s => once(s, canonical, "'(status IS DISTINCT FROM ''cancelled''::text)'")],
  ['extra AND predicate accepted', s => once(s, canonical, "'((delivery_invoice_id IS NOT NULL) AND (status IS DISTINCT FROM ''cancelled''::text) AND (status = ''pending''::text))'")],
  ...checks.map(token => [`remove ${token}`, s => once(s, token, token === 'IF NOT FOUND THEN' ? 'IF false THEN' : 'false')]),
];
for (const [name, mutate] of mutants) {
  test(`structural mutation RED: ${name}`, () => {
    const candidate = mutate(sql);
    assert.throws(() => validate(candidate), { code: 'ERR_ASSERTION' });
  });
}
// These are source-contract tests only. SQL parsing/catalog behavior/concurrency are not executed.
