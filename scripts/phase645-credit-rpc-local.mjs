// Local-only synthetic PG17.6 rehearsal. Never accepts host/DSN/credentials.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const opts={};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert.ok(['--bin-dir','--cluster-root','--port'].includes(k)&&v&&!opts[k],'invalid arguments');opts[k]=v;}
const bin=opts['--bin-dir'],home=opts['--cluster-root'],port=Number(opts['--port']);
assert.ok(bin&&home&&path.isAbsolute(bin)&&path.isAbsolute(home),'absolute binary/new cluster paths required');
assert.ok(Number.isInteger(port)&&port>=49152&&port<=65535,'unique high loopback port required');
assert.ok(!fs.existsSync(home),'refuse pre-existing cluster root');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('PG')));
Object.assign(env,{PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5'});
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
for(const n of ['psql','initdb','pg_ctl'])assert.ok(fs.statSync(exe(n)).isFile());
const listenFree=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(()=>resolve()));});
const portOpen=()=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.setTimeout(1000,()=>{s.destroy();resolve(true);});});
await listenFree();
const token=crypto.randomUUID(),data=path.join(home,'data');
fs.mkdirSync(home);fs.writeFileSync(path.join(home,'.owner'),token,{flag:'wx'});
let attempted=false,started=false,failed=false;
const transcript=[];
let controlRun=0;
function run(binary,args,{input,fail=false}={}){
 let r;
 if(binary==='pg_ctl'){
  // A detached Windows postgres child can retain inherited pipes after pg_ctl
  // exits. Use real files plus ignored stdin, not a pipe held by the server.
  const prefix=path.join(home,`control-${++controlRun}`);
  const out=fs.openSync(prefix+'.stdout.log','wx'),err=fs.openSync(prefix+'.stderr.log','wx');
  try{r=spawnSync(exe(binary),args,{env,windowsHide:true,timeout:120000,stdio:['ignore',out,err]});}
  finally{fs.closeSync(out);fs.closeSync(err);}
  r.stdout=fs.readFileSync(prefix+'.stdout.log','utf8');r.stderr=fs.readFileSync(prefix+'.stderr.log','utf8');
 }else{
  r=spawnSync(exe(binary),args,{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
 }
 transcript.push(JSON.stringify({binary,args,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message}));
 if(r.error)throw r.error;
 assert.ok(fail?r.status!==0:r.status===0,`${binary} unexpected status ${r.status}: ${r.stderr}`);return (r.stdout||'')+(r.stderr||'');
}
const sql=(db,text,fail=false)=>run('psql',['-X','-w','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',db],{input:text,fail}).trim();
const source=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const footprint=`SELECT jsonb_build_object('rpc',(SELECT jsonb_agg(jsonb_build_array(proname,md5(prosrc),proacl::text,proconfig::text) ORDER BY proname) FROM pg_proc WHERE oid IN('public.redeem_customer_credit(bigint,text,numeric,text)'::regprocedure,'public.release_customer_credit(text)'::regprocedure)), 'ledger_policies',(SELECT jsonb_agg(jsonb_build_array(policyname,permissive,roles,cmd,qual,with_check) ORDER BY policyname) FROM pg_policies WHERE tablename='customer_credit_ledger'), 'ledger_grants',(SELECT relacl::text FROM pg_class WHERE oid='public.customer_credit_ledger'::regclass));`;
const ledgerState=`SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='customer_credit_ledger'),'acl',(SELECT relacl::text FROM pg_class WHERE oid='public.customer_credit_ledger'::regclass),'rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.customer_credit_ledger l));`;
try{
 assert.match(run('psql',['--version']),/17\.6(?:\s|$)/);
 run('initdb',['-D',data,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
 fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nstatement_timeout='30s'\nlock_timeout='5s'\n`);
 attempted=true;
 run('pg_ctl',['-D',data,'-l',path.join(home,'server.log'),'-w','-t','30','start']);started=true;
 const identity=JSON.parse(sql('postgres',"SELECT jsonb_build_object('version',current_setting('server_version'),'data',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port());"));
 assert.equal(identity.version,'17.6');assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,port);assert.equal(fs.realpathSync(identity.data).toLowerCase(),fs.realpathSync(data).toLowerCase());
 const pid=fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split(/\r?\n/)[0];fs.writeFileSync(path.join(home,'owned-pid'),pid);
 sql('postgres','CREATE DATABASE phase645_positive;');
 sql('phase645_positive',source('tests/phase645_credit_rpc_fixture.sql'));
 for(const [f,n] of [['supabase-phase517a-customer-credit-ledger.sql','redeem_customer_credit'],['supabase-phase520-credit-use-checkout-key.sql','release_customer_credit']]){
  const match=source(f).match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${n}\\([\\s\\S]*?\\$\\$;`));assert.ok(match);sql('phase645_positive',match[0]);
 }
 sql('phase645_positive',`REVOKE ALL ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text), public.release_customer_credit(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text),public.release_customer_credit(text) TO anon,authenticated,service_role;`);
 const candidate=source('supabase-phase645-credit-rpc-authz.sql');
 let local=candidate;const map={};
 for(const [sig,pin] of [['redeem_customer_credit(bigint,text,numeric,text)','8ba3d01fe1a13ffbd2f9edb6d9e8c577'],['release_customer_credit(text)','cc859ecb943a4df8c0f0a65171ff1f62']]){
  const actual=sql('phase645_positive',`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.${sig}'::regprocedure;`);assert.match(actual,/^[a-f0-9]{32}$/);assert.ok(local.includes(pin));local=local.replaceAll(pin,actual);map[pin]=actual;
 }
 fs.writeFileSync(path.join(home,'LOCAL-migration.sql'),local);
 fs.writeFileSync(path.join(home,'fixture-provenance.json'),JSON.stringify({candidate_sha256:sha(candidate),local_sha256:sha(local),prosrc_pin_replacements:map,limitation:'Synthetic catalog/function-body source fixture, NOT exact raw production byte fixture. Only original prosrc pins replaced in local migration copy.'},null,2));
 // Baseline must expose the defect before testing the fix.
 const red=sql('phase645_positive',"BEGIN;SET ROLE anon;SELECT (public.redeem_customer_credit(101,'red-anon',1,NULL)).amount;ROLLBACK;");assert.ok(red.split(/\r?\n/).includes('-1.00'));
 const before=sql('phase645_positive',footprint),ledgerBefore=sql('phase645_positive',ledgerState);
 const rawRejected=sql('phase645_positive',candidate,true);assert.match(rawRejected,/raw body\/config drift/);
 assert.equal(sql('phase645_positive',footprint),before);
 let localPreflight=source('phase645-credit-rpc-preflight-readonly.sql');
 for(const [pin,actual] of Object.entries(map))localPreflight=localPreflight.replaceAll(pin,actual);
 assert.match(sql('phase645_positive',localPreflight),/PHASE645 PREFLIGHT PASS/);
 sql('phase645_positive',source('phase645-ledger-footprint-readonly.sql'));
 assert.equal(sql('phase645_positive',footprint),before);
 for(const change of ["GRANT EXECUTE ON FUNCTION public.release_customer_credit(text) TO PUBLIC", "GRANT EXECUTE ON FUNCTION public.redeem_customer_credit(bigint,text,numeric,text) TO authenticated WITH GRANT OPTION", "REVOKE EXECUTE ON FUNCTION public.release_customer_credit(text) FROM anon"]){
  const begin='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;';
  assert.equal(local.split(begin).length,2);
  const drift=local.replace(begin,`${begin}\n${change};`);
  const result=sql('phase645_positive',drift,true);assert.match(result,/STOP|drift/i);assert.equal(sql('phase645_positive',footprint),before);
 }
 assert.equal((local.match(/^COMMIT;/gm)||[]).length,1);
 const faultSql=local.replace(/^COMMIT;/m,"DO $$ BEGIN RAISE EXCEPTION 'PHASE645 INJECTED AFTER DDL'; END $$;\nCOMMIT;");
 const fault=sql('phase645_positive',faultSql,true);assert.match(fault,/PHASE645 INJECTED AFTER DDL/);assert.equal(sql('phase645_positive',footprint),before);
 sql('phase645_positive',local);assert.equal(sql('phase645_positive',ledgerState),ledgerBefore);
 const postcheck=sql('phase645_positive',source('phase645-credit-rpc-postcheck-readonly.sql'));assert.match(postcheck,/PHASE645 CATALOG PASS/);
 const checks=source('tests/phase645_credit_rpc_checks.sql');const passed=sql('phase645_positive',checks);assert.match(passed,/PASS B2 residual/);assert.match(passed,/PASS service role forged JWT denied/);
 assert.equal(sql('phase645_positive',ledgerState),ledgerBefore);
 assert.match(sql('phase645_positive',local,true),/STOP|drift/i);
 // Mutate BOTH installed guards in local DB, preserving all grants. This does
 // not weaken migration postchecks or edit candidate files: tests target bodies.
 let removed=0;
 for(const sig of ['redeem_customer_credit(bigint,text,numeric,text)','release_customer_credit(text)']){
  const def=sql('phase645_positive',`SELECT pg_get_functiondef('public.${sig}'::regprocedure);`);
  const mutant=def.replace(/-- PHASE645 AUTH GUARD BEGIN[\s\S]*?-- PHASE645 AUTH GUARD END/g,()=>{removed++;return '-- LOCAL MUTANT: authorization guard removed';});
  assert.notEqual(def,mutant);sql('phase645_positive',mutant);
 }
 assert.equal(removed,2);
 const mutation=sql('phase645_positive',checks,true);assert.match(mutation,/AUTH FAIL/);
 const controls=[];
 for(const [rpc,call] of [['redeem',"public.redeem_customer_credit(101,'mutant-customer',1,NULL)"],['release',"public.release_customer_credit('missing-mutant')"]]) {
  const output=sql('phase645_positive',`BEGIN;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);DO $$ BEGIN BEGIN PERFORM ${call};RAISE EXCEPTION 'AUTH FAIL mutant ${rpc} allowed';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $$;ROLLBACK;`,true);
  assert.match(output,new RegExp(`AUTH FAIL mutant ${rpc} allowed`));controls.push({rpc,output});
 }
 fs.writeFileSync(path.join(home,'mutation-evidence.txt'),mutation+'\n'+controls.map(x=>x.output).join('\n'));
 const groups=passed.split(/\r?\n/).filter(x=>/NOTICE:\s+PASS /.test(x)).map(x=>x.replace(/^.*NOTICE:\s+/,''));
 const summary={behavioral_pass_notice_count:groups.length,behavioral_groups:groups,catalog_postcheck:'PASS',rawProductionPinsRejectSourceFixture:'PASS',localReadOnlyPreflight:'PASS',ledgerCatalogQuerySyntaxLocalOnly:'PASS',acl_drift_controls:3,postDDL_rollback:'PASS',unchanged_ledger:'PASS',mutation_guards_removed:removed,mutation_rpc_failures:controls.map(x=>x.rpc)};
 fs.writeFileSync(path.join(home,'summary.json'),JSON.stringify(summary,null,2));
 console.log('PHASE645 LOCAL PASS '+JSON.stringify(summary));
}catch(e){failed=true;console.error(e.message);process.exitCode=1;}
finally{
 try{
  assert.equal(fs.readFileSync(path.join(home,'.owner'),'utf8'),token,'ownership changed; do not stop');
  if(attempted){
   const pidfile=path.join(data,'postmaster.pid'),owned=path.join(home,'owned-pid');
   if(fs.existsSync(pidfile)){
    if(fs.existsSync(owned))assert.equal(fs.readFileSync(pidfile,'utf8').split(/\r?\n/)[0],fs.readFileSync(owned,'utf8'),'PID changed; do not stop');
    else assert.ok(!started,'missing owned PID');
    run('pg_ctl',['-D',data,'-w','-t','30','-m','fast','stop']);
   }
   assert.ok(!fs.existsSync(pidfile),'cluster PID remains');assert.equal(await portOpen(),false,'port remains open');
  }
  fs.writeFileSync(path.join(home,'STOP-CONFIRMED.txt'),'owned cluster stopped; files retained; '+(failed?'tests failed':'tests passed')+'\n');
 }catch(e){console.error('CLEANUP UNCONFIRMED: '+e.message);process.exitCode=1;}
 fs.writeFileSync(path.join(home,'rehearsal-log.jsonl'),transcript.join('\n')+'\n');
 console.log('Evidence retained at '+home);
}
