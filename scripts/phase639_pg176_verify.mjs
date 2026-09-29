// Real PostgreSQL 17.6, disposable LOCAL fixture only. No production configuration.
// Usage: node scripts/phase639_pg176_verify.mjs <absolute psql path> <isolated port>
// Start a new loopback-only cluster owned by this task first. Do not point at a
// shared cluster. This runner creates (never drops) uniquely named databases.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { setTimeout, clearTimeout } from 'node:timers';
const [psql, port] = process.argv.slice(2);
assert.ok(psql && /^\d+$/.test(port || '') && Number(port)>1024 && Number(port)!==5432, 'explicit isolated local port required');
const file=fileURLToPath(new URL('../supabase-phase639-document-template-snapshot.sql',import.meta.url));
const bytes=readFileSync(file);
const prefix='phase639_'+Date.now();
let checks=0;
function run(db,sql,ok=true,filename=null,user='phase639_owner',options={}) {
  const args=['-X','-h','127.0.0.1','-p',port,'-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-A','-t'];
  // UTF-8 stdin, not Windows ANSI command arguments (Thai would become '?').
  const result=spawnSync(psql,filename?[...args,'-f',filename]:args,{input:filename?undefined:sql+'\n',encoding:'utf8',timeout:45000,windowsHide:true,
    env:{...process.env,PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c statement_timeout=30000',...options}});
  if(result.error) throw result.error;
  if(ok) assert.equal(result.status,0,result.stderr);
  else assert.notEqual(result.status,0,'expected SQL failure');
  return result;
}
function check(name,fn) { fn(); checks++; console.log('PASS '+name); }
const query=(db,sql)=>run(db,sql).stdout.trim();
const fixture=String.raw`
CREATE TABLE public.app_settings(key text PRIMARY KEY,value jsonb);
INSERT INTO public.app_settings VALUES('store_info','{"docHeader":"OLD HEADER","docFooter":"OLD FOOTER","docNote":"OLD NOTE","docShowNoteDelivery":false}');
CREATE TABLE public.quotations(id int PRIMARY KEY,amount numeric(12,2),note text);
CREATE TABLE public.delivery_invoices(LIKE public.quotations INCLUDING ALL);
CREATE TABLE public.receipts(LIKE public.quotations INCLUDING ALL);
INSERT INTO public.quotations VALUES(1,40950,'original QT');
INSERT INTO public.delivery_invoices VALUES(1,40950,'original DI');
INSERT INTO public.receipts VALUES(1,40950,'original RC');
CREATE TABLE public.synthetic_audit(table_name text);
CREATE FUNCTION public.audit_updates() RETURNS trigger LANGUAGE plpgsql AS $b$ BEGIN INSERT INTO public.synthetic_audit VALUES(TG_TABLE_NAME); RETURN NEW; END $b$;
CREATE TRIGGER audit_updates AFTER UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.audit_updates();
CREATE TRIGGER audit_updates AFTER UPDATE ON public.delivery_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_updates();
CREATE TRIGGER audit_updates AFTER UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.audit_updates();
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.quotations,public.delivery_invoices,public.receipts TO authenticated;
GRANT INSERT ON public.synthetic_audit TO authenticated;
`;
assert.equal(run('postgres',"SHOW server_version",true,null,'postgres').stdout.trim(),'17.6','must rehearse on exact native PG17.6');
const dataDirectory=run('postgres',"SHOW data_directory",true,null,'postgres').stdout.trim().replaceAll('\\','/');
assert.match(dataDirectory,/\/phase639-pg176\/data$/, 'STOP: this must be the dedicated phase639-pg176/data cluster, never a shared lab');
console.log('migration_sha256='+createHash('sha256').update(bytes).digest('hex'));
console.log('fixture_databases='+prefix+'_* host=127.0.0.1 port='+port);
run('postgres',"DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF; END LOOP; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='phase639_owner') THEN CREATE ROLE phase639_owner LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS; END IF; END $$; GRANT authenticated TO phase639_owner WITH SET TRUE;",true,null,'postgres');
// All fixture DDL, migration, checks and app-role tests below use a direct login
// as this non-superuser database owner, not SET ROLE from the bootstrap superuser.
check('owner login is non-superuser and has no bypassrls',()=>assert.equal(query('postgres',"SELECT (NOT rolsuper AND NOT rolbypassrls)::text FROM pg_roles WHERE rolname=current_user"),'true'));
const db=prefix+'_main';
run('postgres','CREATE DATABASE '+db);
run(db,fixture);
const footprintSql=`SELECT jsonb_agg(to_jsonb(v) ORDER BY name)::text FROM (
 SELECT 'quotations' name,jsonb_agg(jsonb_build_object('id',id,'amount',amount,'note',note) ORDER BY id) rows FROM quotations
 UNION ALL SELECT 'delivery',jsonb_agg(jsonb_build_object('id',id,'amount',amount,'note',note) ORDER BY id) FROM delivery_invoices
 UNION ALL SELECT 'receipt',jsonb_agg(jsonb_build_object('id',id,'amount',amount,'note',note) ORDER BY id) FROM receipts
) v`;
const before=query(db,footprintSql);
const applied=run(db,null,true,file);
console.log('RAW POSTCHECKS\n'+applied.stdout);
check('POST-CHECK C exact per-type UTF8 pins all pass',()=>{
  const c=bytes.toString('utf8').split('-- POST-CHECK C:')[1];
  const rows=query(db,c.slice(c.indexOf('WITH expected'))).split(/\r?\n/);
  assert.equal(rows.length,3);
  for(const row of rows) assert.match(row,/\|t$/);
  assert.match(rows.find(r=>r.startsWith('quotations|')),/\|10\|/);
  assert.match(rows.find(r=>r.startsWith('delivery_invoices|')),/\|22\|/);
  assert.match(rows.find(r=>r.startsWith('receipts|')),/\|14\|/);
});
check('existing money/note/row footprint unchanged',()=>assert.equal(query(db,footprintSql),before));
check('no UPDATE DML or audit trigger fired during migration',()=>assert.equal(query(db,'SELECT count(*) FROM synthetic_audit'),'0'));
check('constant fast defaults cover all three pre-existing rows',()=>assert.equal(query(db,"SELECT count(*) FROM pg_attribute WHERE attname='document_template_snapshot' AND atthasmissing AND attnotnull"),'3'));
const tables=[['quotations','quotation','ใบเสนอราคา'],['delivery_invoices','delivery','ใบส่งสินค้า/ใบแจ้งหนี้'],['receipts','receipt','ใบเสร็จรับเงิน']];
const snapshots={};
for(const [table,type,title] of tables) {
  const old=JSON.parse(query(db,'SELECT document_template_snapshot FROM '+table+' WHERE id=1'));
  snapshots[table]=old;
  check(table+' legacy exact snapshot',()=>assert.deepEqual(old,{version:1,document_type:type,title,header:'OLD HEADER',footer:'OLD FOOTER',note:'OLD NOTE',show_note:type!=='delivery'}));
  check(table+' old client INSERT gets frozen legacy default',()=>{
    run(db,`SET ROLE authenticated; INSERT INTO ${table}(id,amount,note) VALUES(2,100,'old-client');`);
    assert.deepEqual(JSON.parse(query(db,'SELECT document_template_snapshot FROM '+table+' WHERE id=2')),old);
  });
  const fresh={...old,header:'NEW HEADER',note:'NEW '+type,title:type==='quotation'?'ใบประเมินราคา':type==='delivery'?'ใบแจ้งหนี้':title};
  const literal=JSON.stringify(fresh).replaceAll("'","''");
  check(table+' authenticated new INSERT accepts own valid snapshot',()=>{
    run(db,`SET ROLE authenticated; INSERT INTO ${table}(id,amount,note,document_template_snapshot) VALUES(3,40950,'new','${literal}'::jsonb);`);
    assert.deepEqual(JSON.parse(query(db,'SELECT document_template_snapshot FROM '+table+' WHERE id=3')),fresh);
  });
  check(table+' ordinary UPDATE still works after function EXECUTE revoke',()=>{
    run(db,`SET ROLE authenticated; UPDATE ${table} SET note='edited' WHERE id=3;`);
    assert.equal(query(db,`SELECT note FROM ${table} WHERE id=3`),'edited');
  });
  check(table+' snapshot replacement rejected, old value retained',()=>{
    const result=run(db,`SET ROLE authenticated; UPDATE ${table} SET document_template_snapshot=jsonb_set(document_template_snapshot,'{note}','"evil"') WHERE id=1;`,false);
    assert.match(result.stderr,/snapshot is immutable/);
    assert.deepEqual(JSON.parse(query(db,'SELECT document_template_snapshot FROM '+table+' WHERE id=1')),old);
  });
  check(table+' identical snapshot UPDATE permitted',()=>run(db,`SET ROLE authenticated; UPDATE ${table} SET document_template_snapshot=document_template_snapshot WHERE id=1;`));
  for(const bad of ['NULL',"'{}'::jsonb",`'${JSON.stringify({...fresh,document_type:'wrong'})}'::jsonb`,`'${JSON.stringify({...fresh,show_note:'false'})}'::jsonb`]) {
    check(table+' malformed INSERT blocked '+bad.slice(0,16),()=>run(db,`INSERT INTO ${table}(id,amount,document_template_snapshot) VALUES(9,100,${bad})`,false));
  }
}
run(db,`UPDATE app_settings SET value='{"docHeader":"CHANGED LATER","docTemplatesV1":{}}' WHERE key='store_info';`);
for(const [table] of tables) check(table+' later settings never change old rows',()=>assert.deepEqual(JSON.parse(query(db,'SELECT document_template_snapshot FROM '+table+' WHERE id=1')),snapshots[table]));
const rerun=run(db,null,false,file);
check('rerun STOP rather than replace defaults',()=>assert.match(rerun.stderr,/Phase 639 STOP: already applied/));
check('trigger ACL excludes PUBLIC and app roles',()=>assert.equal(query(db,"SELECT proacl::text FROM pg_proc WHERE oid='public.phase639_preserve_document_template()'::regprocedure"),'{phase639_owner=X/phase639_owner}'));
for(const [suffix,drift,pattern] of [
  ['settings',`UPDATE app_settings SET value='{"docTemplatesV1":{}}';`,/inspect cloud store_info/],
  ['column','ALTER TABLE receipts ADD COLUMN document_template_snapshot jsonb;',/column already exists/],
  ['midfail','ALTER TABLE receipts ADD CONSTRAINT receipts_document_template_check CHECK(id>0);',/already exists/],
]) {
  const badDb=prefix+'_'+suffix;
  run('postgres','CREATE DATABASE '+badDb); run(badDb,fixture); run(badDb,drift);
  const result=run(badDb,null,false,file);
  check(suffix+' STOP has expected cause',()=>assert.match(result.stderr,pattern));
  check(suffix+' failure leaves no function or other newly added columns',()=>{
    assert.equal(query(badDb,"SELECT to_regprocedure('public.phase639_preserve_document_template()') IS NULL"),'t');
    assert.equal(query(badDb,"SELECT count(*) FROM pg_attribute WHERE attname='document_template_snapshot' AND NOT attisdropped"),suffix==='column'?'1':'0');
    assert.equal(query(badDb,'SELECT count(*) FROM synthetic_audit'),'0');
  });
}
// Adversarial transport/encoding/timeout tests use only fresh databases here.
const atomic=bytes.toString('utf8').split('-- POST-CHECK A:')[0];
const freshDb=suffix=>{const name=prefix+'_'+suffix;run('postgres','CREATE DATABASE '+name);run(name,fixture);return name;};
const absent=name=>{
  assert.equal(query(name,"SELECT to_regprocedure('public.phase639_preserve_document_template()') IS NULL"),'t');
  assert.equal(query(name,"SELECT count(*) FROM pg_attribute WHERE attname='document_template_snapshot' AND NOT attisdropped"),'0');
};
for(const [suffix,options,pattern] of [
  ['notimeout',{PGOPTIONS:'-c statement_timeout=0'},/set statement_timeout/],
  ['longtimeout',{PGOPTIONS:'-c statement_timeout=31000'},/set statement_timeout/],
  ['encoding',{PGCLIENTENCODING:'SQL_ASCII'},/UTF8 client\/server required/],
]) {
  const name=freshDb(suffix);
  check(suffix+' rejected before any DDL',()=>{assert.match(run(name,atomic,false,null,'phase639_owner',options).stderr,pattern);absent(name);});
}
const damaged=freshDb('damaged');
check('damaged Thai bytes rejected before DDL despite UTF8 connection',()=>{
  assert.match(run(damaged,atomic.replaceAll('ใบเสนอราคา','??????????'),false).stderr,/Thai literal bytes do not match/);absent(damaged);
});
const persistent=freshDb('persistent');
run(persistent,'ALTER TABLE receipts ADD CONSTRAINT receipts_document_template_check CHECK(id>0)');
check('mid-apply failure rolls back in the SAME still-usable autocommit connection',()=>{
  const result=run(persistent,'\\set ON_ERROR_STOP off\n'+atomic+
    "\nSELECT 'AFTER_ERROR', to_regprocedure('public.phase639_preserve_document_template()') IS NULL, (SELECT count(*) FROM pg_attribute WHERE attname='document_template_snapshot' AND NOT attisdropped);");
  assert.match(result.stderr,/already exists/);assert.match(result.stdout,/AFTER_ERROR\|t\|0/);absent(persistent);
});
const timed=freshDb('statement_timeout');
check('preconfigured statement timeout interrupts mid-DO and leaves no orphan DDL',()=>{
  const delayed=atomic.replace('REVOKE ALL ON FUNCTION','PERFORM pg_sleep(2);\nREVOKE ALL ON FUNCTION');
  assert.notEqual(delayed,atomic);
  const start=Date.now();
  const result=run(timed,delayed,false,null,'phase639_owner',{PGOPTIONS:'-c statement_timeout=1000'});
  const elapsed=Date.now()-start;
  assert.match(result.stderr,/statement timeout/);assert.ok(elapsed<4500);absent(timed);
  console.log('statement_timeout_elapsed_ms='+elapsed);
});
check('counterexample: setting statement_timeout inside DO does not bound that running DO',()=>{
  const result=run(timed,"DO $$ BEGIN PERFORM set_config('statement_timeout','100',true); PERFORM pg_sleep(0.4); END $$;",true,null,'phase639_owner',{PGOPTIONS:'-c statement_timeout=0'});
  assert.match(result.stdout,/DO/);
});
const locked=freshDb('lock_timeout');
const holder=spawn(psql,['-X','-h','127.0.0.1','-p',port,'-U','phase639_owner','-d',locked,'-A','-t','-v','ON_ERROR_STOP=1'],{
  windowsHide:true,env:{...process.env,PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c statement_timeout=15000'},stdio:['pipe','pipe','pipe']});
let holderOut='',holderErr='';
const holderDone=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',code=>resolve(code));});
holder.stderr.on('data',b=>{holderErr+=b;});
const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('lock-holder readiness timeout')),5000);
  holder.stdout.on('data',b=>{holderOut+=b;if(holderOut.includes('LOCK_HELD')){clearTimeout(timer);resolve();}});
});
holder.stdin.end("BEGIN; LOCK TABLE quotations IN ACCESS SHARE MODE; SELECT 'LOCK_HELD'; SELECT pg_sleep(8); ROLLBACK;\n");
try {
  await ready;
  check('competing lock hits real 5s lock timeout, rolls back function and columns',()=>{
    const start=Date.now();const result=run(locked,null,false,file);const elapsed=Date.now()-start;
    assert.match(result.stderr,/lock timeout/);assert.ok(elapsed>=4500&&elapsed<8000);absent(locked);
    console.log('lock_timeout_elapsed_ms='+elapsed);
  });
} finally { assert.equal(await holderDone,0,holderErr); }
console.log(JSON.stringify({phase:639,server:'PostgreSQL 17.6 native',checks,failed:0,production:'NOT RUN',staging:'NOT RUN'}));
