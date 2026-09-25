// Phase 633 — structural guard for supabase-phase633-doc-number-helper-lockdown.sql
// Source-contract tests only: they do not execute SQL. Preliminary execution on PGlite lives in
// scripts/phase633_pglite_verify.js (not CI, not a PostgreSQL 17.6 production-equivalent proof).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase-phase633-doc-number-helper-lockdown.sql'), 'utf8');
const b2 = fs.readFileSync(path.join(ROOT, 'supabase-phaseB2-doc-no-sequence.sql'), 'utf8');

// md5 of each function body exactly as defined by Phase B2 (what the migration pins)
function b2BodyMd5(name) {
  const m = b2.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`));
  assert.ok(m, `B2 body for ${name}`);
  return crypto.createHash('md5').update(m[1]).digest('hex');
}
const PINS = {
  next_doc_number: b2BodyMd5('next_doc_number'),
  assign_quotation_no: b2BodyMd5('assign_quotation_no'),
  assign_delivery_invoice_no: b2BodyMd5('assign_delivery_invoice_no'),
  assign_receipt_no: b2BodyMd5('assign_receipt_no'),
};

const REVOKE = 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated, service_role;';
const ALTERS = [
  "ALTER FUNCTION public.next_doc_number(text, text) SET search_path = '';",
  "ALTER FUNCTION public.assign_quotation_no()        SECURITY DEFINER SET search_path = '';",
  "ALTER FUNCTION public.assign_delivery_invoice_no() SECURITY DEFINER SET search_path = '';",
  "ALTER FUNCTION public.assign_receipt_no()          SECURITY DEFINER SET search_path = '';",
];
// v1.1: trigger functions are SECURITY DEFINER, so their EXECUTE is revoked too — otherwise a
// role that can create a trigger could bind them to its own (temp) table and bump the counter
const TRIGGER_REVOKE = 'REVOKE EXECUTE ON FUNCTION public.assign_quotation_no(),\n'
  + '                           public.assign_delivery_invoice_no(),\n'
  + '                           public.assign_receipt_no()\n'
  + '  FROM PUBLIC, anon, authenticated, service_role;';
const VERIFY_TOKENS = [
  "IF NOT FOUND THEN\n    RAISE EXCEPTION 'Phase 633 STOP: helper final state mismatch';",
  "WHERE p.oid = v_helper AND a.privilege_type = 'EXECUTE' AND a.grantee = 0",
  "has_function_privilege('anon', v_helper, 'EXECUTE')",
  "has_function_privilege('authenticated', v_helper, 'EXECUTE')",
  "has_function_privilege('service_role', v_helper, 'EXECUTE')",
  "IF NOT has_function_privilege('postgres', v_helper, 'EXECUTE') THEN",
  "RAISE EXCEPTION 'Phase 633 STOP: % final state mismatch', r.fn;",
  "WHERE p.oid = to_regprocedure(r.fn) AND a.privilege_type = 'EXECUTE' AND a.grantee = 0",
  "has_function_privilege('anon', to_regprocedure(r.fn), 'EXECUTE')",
  "has_function_privilege('authenticated', to_regprocedure(r.fn), 'EXECUTE')",
  "has_function_privilege('service_role', to_regprocedure(r.fn), 'EXECUTE')",
  "EXECUTE format('SET LOCAL ROLE %I', r.rolname);",
  "PERFORM public.next_doc_number('QT', 'quotation');",
  "EXCEPTION WHEN insufficient_privilege THEN",
  "IF v_state IS DISTINCT FROM 'denied' THEN",
  "RAISE NOTICE 'Phase 633 probe as %: NOT RUN (postgres is not a member)', r.rolname;",
];
const PREFLIGHT_TOKENS = [
  "NOT BETWEEN 170000 AND 179999",
  "IF current_user <> 'postgres' THEN",
  "AND p.prosecdef = true AND p.provolatile = 'v'",
  "pg_catalog.pg_get_userbyid(v_owner) <> 'postgres'",
  "IS DISTINCT FROM ARRAY['search_path=public']",
  "AND tg.tgenabled = 'O' AND tg.tgtype = 7",
  "AND p.prosrc ILIKE '%next_doc_number%'",
  "pg_catalog.pg_get_viewdef(c.oid) ILIKE '%next_doc_number%'",
  "FROM pg_catalog.pg_policies",
  "pg_catalog.pg_get_expr(d.adbin, d.adrelid) ILIKE '%next_doc_number%'",
];

function block(executable, tag) {
  return executable.match(new RegExp(`DO \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$;`))?.[1];
}
function validate(source) {
  const executable = source.replace(/^\s*--.*$/gm, '');
  const pre = block(executable, 'phase633_preflight');
  const verify = block(executable, 'phase633_verify');
  assert.ok(pre && verify, 'preflight and verify DO blocks');

  // one transaction in the documented order
  const order = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';",
    'DO $phase633_preflight$', ...ALTERS, REVOKE, TRIGGER_REVOKE, 'DO $phase633_verify$',
    "NOTIFY pgrst, 'reload schema';", 'COMMIT;'];
  let previous = -1;
  for (const token of order) {
    const at = executable.indexOf(token);
    assert.ok(at > previous, `order: ${token}`);
    previous = at;
  }
  assert.equal((executable.match(/\bBEGIN;/g) || []).length, 1, 'one BEGIN');
  assert.equal((executable.match(/\bCOMMIT;/g) || []).length, 1, 'one COMMIT');
  assert.equal((executable.match(/\bREVOKE\b/g) || []).length, 2, 'exactly two REVOKE (helper + trigger functions)');
  // the probe skip path must stay visible: a POST-CHECK reports whether the probe ran
  assert.ok(source.includes('-- POST-CHECK C BEGIN') && source.includes("pg_catalog.pg_has_role('postgres', r.oid, 'MEMBER') AS probe_ran"),
    'POST-CHECK C reports probe_ran');
  assert.equal((executable.match(/\bALTER FUNCTION\b/g) || []).length, 4, 'exactly four ALTER FUNCTION');

  // narrow: no body rewrite, no grants, no default-privilege or data changes
  assert.doesNotMatch(executable, /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|TABLE|POLICY|INDEX)\b/i);
  assert.doesNotMatch(executable, /\b(GRANT|DROP|TRUNCATE|DEFAULT\s+PRIVILEGES|OWNER\s+TO|CONCURRENTLY)\b/i);
  assert.doesNotMatch(executable, /\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|ROW\s+LEVEL\s+SECURITY)\b/i);
  assert.doesNotMatch(executable, /doc_number_counters/, 'counter table is never touched directly');

  // body pins match the Phase B2 definitions in pre- and post-checks
  for (const [name, md5] of Object.entries(PINS)) {
    assert.ok(pre.includes(md5), `preflight pins ${name}`);
    assert.ok(verify.includes(md5), `verify pins ${name}`);
  }
  for (const token of PREFLIGHT_TOKENS) assert.ok(pre.includes(token), `preflight: ${token}`);
  for (const token of VERIFY_TOKENS) assert.ok(verify.includes(token), `verify: ${token}`);
}

test('v1.1 structural SQL contract', () => validate(sql));

test('pinned md5 values are the Phase B2 bodies', () => {
  assert.deepEqual(PINS, {
    next_doc_number: '62e6bfb02a14d69c020581ce974f9d7b',
    assign_quotation_no: 'a067467804e02d8b75dc114dee223b63',
    assign_delivery_invoice_no: '0309cb0dc3406d84e63d35a4046d30df',
    assign_receipt_no: '19f0ac1c8ebc5c1e76b6a76e65d1121d',
  });
});

function once(source, from, to) {
  assert.equal(source.split(from).length - 1, 1, `unique anchor: ${from.slice(0, 60)}`);
  return source.replace(from, () => to);
}
const mutants = [
  ['no helper REVOKE', s => once(s, REVOKE, '')],
  ['helper REVOKE only PUBLIC', s => once(s, REVOKE, REVOKE.replace(', anon, authenticated, service_role', ''))],
  ['helper REVOKE without service_role', s => once(s, REVOKE, REVOKE.replace(', service_role', ''))],
  ['no trigger-function REVOKE', s => once(s, TRIGGER_REVOKE, '')],
  ['trigger-function REVOKE only PUBLIC', s => once(s, TRIGGER_REVOKE, TRIGGER_REVOKE.replace(', anon, authenticated, service_role', ''))],
  ['trigger-function REVOKE misses receipt', s => once(s, TRIGGER_REVOKE,
    TRIGGER_REVOKE.replace(',\n                           public.assign_receipt_no()', ''))],
  ['trigger-function REVOKE before DEFINER cutover', s => once(once(s, TRIGGER_REVOKE, ''), ALTERS[1], TRIGGER_REVOKE + '\n' + ALTERS[1])],
  ['POST-CHECK C removed', s => once(s, '-- POST-CHECK C BEGIN', '-- POST-CHECK X BEGIN')],
  ['trigger stays INVOKER', s => once(s, ALTERS[3], "ALTER FUNCTION public.assign_receipt_no()          SET search_path = '';")],
  ['helper search_path kept public', s => once(s, ALTERS[0], "ALTER FUNCTION public.next_doc_number(text, text) SET search_path = public;")],
  ['REVOKE before trigger cutover', s => once(once(s, REVOKE, ''), ALTERS[1], REVOKE + '\n' + ALTERS[1])],
  ['early COMMIT', s => once(once(s, 'COMMIT;', ''), REVOKE, 'COMMIT;\n' + REVOKE)],
  ['body rewrite added', s => once(s, ALTERS[0], ALTERS[0] + "\nCREATE OR REPLACE FUNCTION public.next_doc_number(p_prefix text, p_doc_type text) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;")],
  ['grant back to authenticated', s => once(s, REVOKE, REVOKE + '\nGRANT EXECUTE ON FUNCTION public.next_doc_number(text, text) TO authenticated;')],
  ['counter reset added', s => once(s, REVOKE, REVOKE + '\nUPDATE public.doc_number_counters SET last_no = 0;')],
  ['wrong helper pin', s => s.split(PINS.next_doc_number).join('00000000000000000000000000000000')],
  ['preflight accepts any PG major', s => once(s, 'NOT BETWEEN 170000 AND 179999', 'NOT BETWEEN 0 AND 999999')],
  ...PREFLIGHT_TOKENS.map(t => [`preflight drops: ${t}`, s => once(s, t, 'true')]),
  ...VERIFY_TOKENS.map(t => [`verify drops: ${t}`, s => once(s, t, 'NULL')]),
];
for (const [name, mutate] of mutants) {
  test(`structural mutation RED: ${name}`, () => {
    const candidate = mutate(sql);   // outside assert.throws: a stale mutant anchor must fail the test
    assert.notEqual(candidate, sql, 'mutant changed the source');
    assert.throws(() => validate(candidate), { code: 'ERR_ASSERTION' });
  });
}
