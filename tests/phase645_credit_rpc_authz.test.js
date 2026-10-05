import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const sql = read('supabase-phase645-credit-rpc-authz.sql');
const post = read('phase645-credit-rpc-postcheck-readonly.sql');
function extract(text, name) {
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  assert(start >= 0);
  return text.slice(start).match(/AS \$\$([\s\S]*?)\$\$;/)[1];
}
for (const [name, original, rawPin] of [
  ['redeem_customer_credit', 'supabase-phase517a-customer-credit-ledger.sql', '8ba3d01fe1a13ffbd2f9edb6d9e8c577'],
  ['release_customer_credit', 'supabase-phase520-credit-use-checkout-key.sql', 'cc859ecb943a4df8c0f0a65171ff1f62'],
]) {
  const body = extract(sql, name);
  test(`Phase645 ${name}: authorization is first; trusted profile and database role only`, () => {
    const guard = body.match(/-- PHASE645 AUTH GUARD BEGIN([\s\S]*?)-- PHASE645 AUTH GUARD END/)[1];
    assert.match(body, /BEGIN\n\s*-- PHASE645 AUTH GUARD BEGIN/);
    assert.match(guard, /current_setting\('role', true\) IS DISTINCT FROM 'authenticated'/);
    assert.match(guard, /p\.role IN \('admin', 'sales', 'technician'\)/);
    assert.match(guard, /FROM public\.profiles p WHERE p\.id = auth\.uid\(\)/);
    assert.match(guard, /false\) THEN[\s\S]*ERRCODE = '42501'/);
    assert.doesNotMatch(guard, /auth\.role\(|user_metadata|app_metadata|request\.jwt/);
  });
  test(`Phase645 ${name}: body unchanged outside guard and builtin qualification`, () => {
    const restored = body.replace(/ {2}-- PHASE645 AUTH GUARD BEGIN[\s\S]*? {2}-- PHASE645 AUTH GUARD END\n/, '')
      .replaceAll('pg_catalog.pg_advisory_xact_lock(', 'pg_advisory_xact_lock(')
      .replaceAll('pg_catalog.hashtextextended(', 'hashtextextended(');
    assert.equal(restored, extract(read(original), name));
  });
  test(`Phase645 ${name}: raw before pin and exact new body pin in both postchecks`, () => {
    const digest = createHash('md5').update(body).digest('hex');
    assert.ok(sql.includes(rawPin));
    assert.ok(sql.includes(digest));
    assert.ok(post.includes(digest));
    assert.doesNotMatch(sql, /md5\(\s*(?:replace|regexp_replace)/);
  });
}
test('Phase645 two-RPC-only atomic scope and safe search path', () => {
  const executable = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
  assert.match(executable, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;/);
  assert.equal((executable.match(/COMMIT;/g) || []).length, 1);
  assert.match(executable, /statement_timeout = '30s'/);
  assert.match(executable, /lock_timeout = '5s'/);
  assert.equal((executable.match(/SET search_path = pg_catalog, pg_temp/g) || []).length, 2);
  assert.doesNotMatch(executable, /(?:CREATE|ALTER|DROP) (?:POLICY|TABLE|TRIGGER)|(?:GRANT|REVOKE)[^;]*ON (?:TABLE|SCHEMA)|SECURITY INVOKER/i);
  assert.ok(executable.indexOf('$phase645_preflight$;') < executable.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.ok(executable.indexOf('$phase645_postcheck$;') < executable.indexOf('COMMIT;'));
});
test('Phase645 both ACLs explicitly revoke service_role and PUBLIC/anon', () => {
  for (const signature of ['redeem_customer_credit(bigint,text,numeric,text)', 'release_customer_credit(text)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, service_role;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`));
  }
  assert.match(sql, /a\.is_grantable/);
  assert.match(post, /has_function_privilege\('service_role',p\.oid,'EXECUTE'\)/);
});
test('Phase645 read-only preflight uses the same assertions as transactional preflight', () => {
  const beforeDDL = sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION public.'));
  const expected = beforeDDL.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')
    + "SELECT 'PHASE645 PREFLIGHT PASS' AS result;\nROLLBACK;\n";
  assert.equal(read('phase645-credit-rpc-preflight-readonly.sql'), expected);
});
