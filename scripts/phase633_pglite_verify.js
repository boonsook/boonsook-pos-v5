// Phase 633 — preliminary execution check of supabase-phase633-doc-number-helper-lockdown.sql
// on PGlite (PostgreSQL 17.x compiled to WASM, single connection, in-memory).
//
// ⚠️ PRELIMINARY ONLY: this is NOT a PostgreSQL 17.6 production-equivalent test and must
// not be used alone to approve running the SQL on production. It never connects to Supabase.
// Not part of `npm test` / CI: PGlite is not a repo dependency. Install it outside the repo:
//   npm install --prefix <dir> @electric-sql/pglite@0.3.16
//   PHASE633_PGLITE_MODULE=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/phase633_pglite_verify.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.PHASE633_PGLITE_MODULE;
if (!modPath) { console.error('set PHASE633_PGLITE_MODULE'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const B2 = read('supabase-phaseB2-doc-no-sequence.sql');
const P632 = read('supabase-phase632-receipt-active-unique.sql');
const P633 = read('supabase-phase633-doc-number-helper-lockdown.sql');
const HELPER = 'public.next_doc_number(text,text)';

let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
// an error inside the file's explicit BEGIN leaves the transaction aborted until ROLLBACK,
// as it would in any single-session client
async function abortTx(db) { try { await db.exec('ROLLBACK'); } catch { /* none open */ } }
async function expectError(db, sql, code) {
  try { await db.exec(sql); return { ok: false, got: 'no error' }; }
  catch (e) { return { ok: e.code === code, got: `${e.code} ${e.message}` }; }
}

// Supabase-like fixture: app roles, schema grants and default privileges as on a hosted project.
const FIXTURE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.quotations (id bigserial PRIMARY KEY, qt_no text);
CREATE TABLE public.delivery_invoices (id bigserial PRIMARY KEY, inv_no text, quotation_id bigint);
CREATE TABLE public.receipts (id bigserial PRIMARY KEY, receipt_no text,
  delivery_invoice_id bigint REFERENCES public.delivery_invoices(id), status text);
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY q_auth ON public.quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY d_auth ON public.delivery_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY r_auth ON public.receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(FIXTURE);
  await db.exec(B2);     // existing definitions exactly as in the repo
  await db.exec(P632);   // current production receipt invariant (used for the 23505 rollback case)
  return db;
}
const counters = async db => (await db.query(
  `SELECT doc_type, last_no FROM public.doc_number_counters ORDER BY doc_type`)).rows
  .map(r => `${r.doc_type}=${r.last_no}`).join(',');
const TRIGGER_FNS = ['assign_quotation_no', 'assign_delivery_invoice_no', 'assign_receipt_no'];
const triggerFnAcl = async db => (await db.query(`
  SELECT p.proname, p.proacl::text AS acl,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
  FROM pg_proc p WHERE p.proname IN ('assign_quotation_no','assign_delivery_invoice_no','assign_receipt_no')
  ORDER BY 1`)).rows;
// authenticated creates its own temp table and tries to bind a document trigger function to it
const bindSql = fn => `SET ROLE authenticated;
  CREATE TEMP TABLE t633_${fn} (qt_no text, inv_no text, receipt_no text);
  CREATE TRIGGER t633_${fn}_trg BEFORE INSERT ON t633_${fn} FOR EACH ROW EXECUTE FUNCTION public.${fn}();
  INSERT INTO t633_${fn} DEFAULT VALUES;`;
const helperState = async db => (await db.query(`
  SELECT p.prosecdef, p.proconfig, p.proacl::text AS acl,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
  FROM pg_proc p WHERE p.oid = '${HELPER}'::regprocedure`)).rows[0];

// ── 1. baseline: the gap exists before Phase 633 ───────────────────────────
{
  const db = await freshDb();
  const v = (await db.query(`SELECT version() AS v`)).rows[0].v;
  results.push(`INFO  engine: ${v.split(' on ')[0]} (PGlite — not production PostgreSQL 17.6)`);
  await db.exec(`SET ROLE authenticated`);
  const r = await db.query(`SELECT public.next_doc_number('QT','quotation') AS n`);
  await db.exec(`RESET ROLE`);
  check('baseline: authenticated can call helper directly before 633', /^QT\d{8}001$/.test(r.rows[0].n), r.rows[0].n);
  await db.close();
}

// ── 2. migration applies, final state, behavior ─────────────────────────────
{
  const db = await freshDb();
  let err = null;
  try { await db.exec(P633); } catch (e) { err = e; await abortTx(db); }
  check('migration executes as one file', !err, err ? `${err.code} ${err.message}` : '');

  const h = await helperState(db);
  check('helper stays SECURITY DEFINER', h.prosecdef === true);
  check('helper search_path hardened', JSON.stringify(h.proconfig) === JSON.stringify(['search_path=""']), JSON.stringify(h.proconfig));
  check('helper ACL has no PUBLIC grant', h.acl && !/(^|[{,])=X/.test(h.acl), h.acl);
  check('anon/authenticated/service_role cannot EXECUTE helper', !h.anon && !h.auth && !h.svc);

  const tf = (await db.query(`
    SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
    WHERE p.proname IN ('assign_quotation_no','assign_delivery_invoice_no','assign_receipt_no')
    ORDER BY 1`)).rows;
  check('3 trigger functions SECURITY DEFINER + empty search_path',
    tf.length === 3 && tf.every(r => r.prosecdef && JSON.stringify(r.proconfig) === '["search_path=\\"\\""]'),
    JSON.stringify(tf));
  const ta = await triggerFnAcl(db);
  check('trigger functions: no PUBLIC EXECUTE and no app-role EXECUTE',
    ta.length === 3 && ta.every(r => r.acl && !/(^|[{,])=X/.test(r.acl) && !r.anon && !r.auth && !r.svc),
    ta.map(r => `${r.proname} ${r.acl}`).join(' · '));

  // seed today's quotation counter at 0 so a leaked direct call would show up as last_no=1
  await db.exec(`INSERT INTO public.doc_number_counters (doc_type, period, last_no)
    VALUES ('quotation', to_char((now() AT TIME ZONE 'Asia/Bangkok'), 'YYYYMMDD'), 0)`);
  const before = await counters(db);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const e = await expectError(db, `SET ROLE ${role}; SELECT public.next_doc_number('QT','quotation');`, '42501');
    await db.exec(`RESET ROLE`);
    check(`direct call as ${role} denied (42501)`, e.ok, e.got);
  }
  check('denied direct calls leave counters unchanged', (await counters(db)) === before, `${before} -> ${await counters(db)}`);

  for (const fn of TRIGGER_FNS) {
    const e = await expectError(db, bindSql(fn), '42501');
    await db.exec('RESET ROLE');
    check(`authenticated cannot bind ${fn} to its own temp table (42501)`, e.ok, e.got);
  }
  check('denied trigger binding leaves counters unchanged', (await counters(db)) === before, `${before} -> ${await counters(db)}`);

  // authorized INSERTs still get trigger numbers (client value overridden)
  await db.exec(`SET ROLE authenticated`);
  const q = (await db.query(`INSERT INTO public.quotations (qt_no) VALUES ('CLIENT') RETURNING qt_no`)).rows[0].qt_no;
  const d = (await db.query(`INSERT INTO public.delivery_invoices (inv_no) VALUES ('CLIENT') RETURNING id, inv_no`)).rows[0];
  const rc = (await db.query(`INSERT INTO public.receipts (receipt_no, delivery_invoice_id, status)
                              VALUES ('CLIENT', ${d.id}, 'pending') RETURNING receipt_no`)).rows[0].receipt_no;
  await db.exec(`RESET ROLE`);
  check('authenticated INSERT quotation numbered by trigger', /^QT\d{8}001$/.test(q), q);
  check('authenticated INSERT delivery invoice numbered by trigger', /^INV\d{8}001$/.test(d.inv_no), d.inv_no);
  check('authenticated INSERT receipt numbered by trigger', /^RC\d{8}001$/.test(rc), rc);
  results.push('INFO  the three document INSERTs above ran after the trigger-function EXECUTE revoke');

  await db.exec(`SET ROLE service_role`);
  const q2 = (await db.query(`INSERT INTO public.quotations (qt_no) VALUES (NULL) RETURNING qt_no`)).rows[0].qt_no;
  await db.exec(`RESET ROLE`);
  check('service_role INSERT quotation numbered by trigger (sequential)', /^QT\d{8}002$/.test(q2), q2);

  const anonIns = await expectError(db, `SET ROLE anon; INSERT INTO public.quotations (qt_no) VALUES ('x');`, '42501');
  await db.exec(`RESET ROLE`);
  check('anon INSERT still blocked by RLS (unchanged)', anonIns.ok, anonIns.got);

  // failed INSERT / rolled-back transaction must not consume a number
  const c1 = await counters(db);
  const dup = await expectError(db, `SET ROLE authenticated;
    INSERT INTO public.receipts (delivery_invoice_id, status) VALUES (${d.id}, 'pending');`, '23505');
  await db.exec(`RESET ROLE`);
  check('duplicate active receipt rejected (23505)', dup.ok, dup.got);
  check('failed receipt INSERT leaves counter unchanged', (await counters(db)) === c1, `${c1} -> ${await counters(db)}`);

  await db.exec(`BEGIN; SET LOCAL ROLE authenticated;
    INSERT INTO public.quotations (qt_no) VALUES (NULL); ROLLBACK;`);
  check('rolled-back quotation INSERT leaves counter unchanged', (await counters(db)) === c1, `${c1} -> ${await counters(db)}`);
  await db.exec(`SET ROLE authenticated`);
  const q3 = (await db.query(`INSERT INTO public.quotations (qt_no) VALUES (NULL) RETURNING qt_no`)).rows[0].qt_no;
  await db.exec(`RESET ROLE`);
  check('next quotation continues without gap after rollback', /^QT\d{8}003$/.test(q3), q3);

  // rerun is safe and changes nothing
  const c2 = await counters(db);
  const aclBefore = (await helperState(db)).acl + JSON.stringify(await triggerFnAcl(db));
  let err2 = null;
  try { await db.exec(P633); } catch (e) { err2 = e; await abortTx(db); }
  check('rerun executes (idempotent)', !err2, err2 ? `${err2.code} ${err2.message}` : '');
  check('rerun leaves counters, helper ACL and trigger-function ACLs unchanged',
    (await counters(db)) === c2 && ((await helperState(db)).acl + JSON.stringify(await triggerFnAcl(db))) === aclBefore, c2);
  await db.exec('SET ROLE authenticated');
  const q4 = (await db.query('INSERT INTO public.quotations (qt_no) VALUES (NULL) RETURNING qt_no')).rows[0].qt_no;
  await db.exec('RESET ROLE');
  check('after rerun, quotation INSERT still numbered in sequence', /^QT\d{8}004$/.test(q4), q4);
  await db.close();
}

// ── 2b. sensitivity: without the trigger-function revoke the binding attack is real ──
{
  const db = await freshDb();
  const weakened = P633
    .replace(/REVOKE EXECUTE ON FUNCTION public\.assign_quotation_no\(\),[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;\n/, '')
    .replace(`    IF v_n <> 0 OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(r.fn)) IS NULL THEN`, '    IF false THEN')
    .replace(`    IF has_function_privilege('anon', to_regprocedure(r.fn), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.fn), 'EXECUTE')
       OR has_function_privilege('service_role', to_regprocedure(r.fn), 'EXECUTE') THEN`, '    IF false THEN');
  if ((weakened.match(/IF false THEN/g) || []).length !== 2 || /public\.assign_quotation_no\(\),/.test(weakened)) {
    throw new Error('sensitivity mutation did not apply');
  }
  await db.exec(weakened);
  await db.exec(`INSERT INTO public.doc_number_counters (doc_type, period, last_no)
    VALUES ('quotation', to_char((now() AT TIME ZONE 'Asia/Bangkok'), 'YYYYMMDD'), 0)`);
  const c0 = await counters(db);
  let bound;
  try { await db.exec(bindSql('assign_quotation_no')); bound = 'bound'; } catch (e) { bound = `${e.code} ${e.message}`; }
  await db.exec('RESET ROLE');
  const c1 = await counters(db);
  check('sensitivity: without trigger-fn revoke, authenticated binds a trigger and bumps the counter',
    bound === 'bound' && c0 !== c1, `${bound} · ${c0} -> ${c1}`);
  await db.close();
}

// ── 3. fail-closed preflight: drift must STOP and roll back everything ──────
const DRIFTS = [
  ['helper body drift', `CREATE OR REPLACE FUNCTION public.next_doc_number(p_prefix text, p_doc_type text)
     RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN 'X'; END $$;`],
  ['trigger function body drift', `CREATE OR REPLACE FUNCTION public.assign_receipt_no() RETURNS trigger
     LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`],
  ['extra caller function', `CREATE FUNCTION public.rogue() RETURNS text LANGUAGE sql
     AS $$ SELECT public.next_doc_number('QT','quotation') $$;`],
  ['caller in view', `CREATE VIEW public.v_rogue AS SELECT public.next_doc_number('QT','quotation') AS n;`],
  ['caller in column default', `ALTER TABLE public.quotations ADD COLUMN n2 text DEFAULT public.next_doc_number('QT','quotation');`],
  ['trigger disabled', `ALTER TABLE public.receipts DISABLE TRIGGER trg_assign_receipt_no;`],
  ['helper not definer', `ALTER FUNCTION public.next_doc_number(text,text) SECURITY INVOKER;`],
];
for (const [name, drift] of DRIFTS) {
  const db = await freshDb();
  await db.exec(drift);
  const before = await helperState(db);
  let err = null;
  try { await db.exec(P633); } catch (e) { err = e; await abortTx(db); }
  const after = await helperState(db);
  const tfAfter = (await db.query(`SELECT count(*)::int AS n FROM pg_proc
    WHERE proname LIKE 'assign\\_%\\_no' AND prosecdef`)).rows[0].n;
  check(`STOP on ${name}`, !!err && /Phase 633 STOP/.test(err.message), err ? err.message : 'no error');
  check(`${name}: nothing committed`, JSON.stringify(before) === JSON.stringify(after) && tfAfter === 0,
    `acl ${after.acl} · definer triggers ${tfAfter}`);
  await db.close();
}

// ── 4. mutated migrations: the in-file verify block must reject a weakened cutover ──
function once(src, from, to) {
  if (src.split(from).length !== 2) throw new Error(`mutant anchor not unique: ${from}`);
  return src.replace(from, () => to);
}
const MUTANTS = [
  ['no helper REVOKE', s => once(s, 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated, service_role;', '')],
  ['helper REVOKE only PUBLIC', s => once(s, 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC;')],
  ['helper REVOKE without service_role', s => once(s, 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated;')],
  ['receipt trigger stays INVOKER', s => once(s, 'ALTER FUNCTION public.assign_receipt_no()          SECURITY DEFINER SET search_path = \'\';', 'ALTER FUNCTION public.assign_receipt_no()          SET search_path = \'\';')],
  ['no trigger-function REVOKE', s => once(s, `REVOKE EXECUTE ON FUNCTION public.assign_quotation_no(),
                           public.assign_delivery_invoice_no(),
                           public.assign_receipt_no()
  FROM PUBLIC, anon, authenticated, service_role;`, '')],
  ['trigger-function REVOKE only PUBLIC', s => once(s, `                           public.assign_receipt_no()
  FROM PUBLIC, anon, authenticated, service_role;`, `                           public.assign_receipt_no()
  FROM PUBLIC;`)],
  ['trigger-function REVOKE misses receipt', s => once(s, `                           public.assign_delivery_invoice_no(),
                           public.assign_receipt_no()`, '                           public.assign_delivery_invoice_no()')],
  ['helper search_path not hardened', s => once(s, "ALTER FUNCTION public.next_doc_number(text, text) SET search_path = '';", '')],
  // catalog ACL checks removed too: only the behavioral SET ROLE probe is left to catch the leak
  ['REVOKE only PUBLIC + ACL checks removed (probe only)', s => once(
    once(s, 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE EXECUTE ON FUNCTION public.next_doc_number(text, text)\n  FROM PUBLIC;'),
    `  IF has_function_privilege('anon', v_helper, 'EXECUTE')
     OR has_function_privilege('authenticated', v_helper, 'EXECUTE')
     OR has_function_privilege('service_role', v_helper, 'EXECUTE') THEN`,
    '  IF false THEN')],
];
for (const [name, mutate] of MUTANTS) {
  const db = await freshDb();
  await db.exec(`INSERT INTO public.doc_number_counters (doc_type, period, last_no)
    VALUES ('quotation', to_char((now() AT TIME ZONE 'Asia/Bangkok'), 'YYYYMMDD'), 0)`);
  const before = await helperState(db);
  const cBefore = await counters(db);
  let err = null;
  try { await db.exec(mutate(P633)); } catch (e) { err = e; await abortTx(db); }
  const after = await helperState(db);
  const cAfter = await counters(db);
  check(`mutant killed: ${name}`, !!err && /Phase 633 STOP/.test(err.message), err ? err.message : 'no error');
  check(`mutant ${name}: nothing committed (ACL + counters)`,
    JSON.stringify(before) === JSON.stringify(after) && cBefore === cAfter, `acl ${after.acl} · ${cBefore} -> ${cAfter}`);
  await db.close();
}

console.log(results.join('\n'));
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.filter(r => /^(PASS|FAIL)/.test(r)).length} checks)`);
console.log('⚠️ PGlite preliminary only — not PostgreSQL 17.6 production-equivalent; do not use alone to approve production SQL.');
process.exit(failed === 0 ? 0 : 1);
