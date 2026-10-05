import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

// Drive the existing exported renderer and its actual click handler. The same
// assertions can load the old module without importing new exports (RED control).
const source=process.env.SIGNUP_BASELINE==='1'
  ?execFileSync('git',['show','e3316d07b6dd3c9292752d387c94fcec82011421:modules/settings/users.js'],{encoding:'utf8'})
  :fs.readFileSync(new URL('../modules/settings/users.js',import.meta.url),'utf8');
async function sync({rows=[],status=200,jsonError=false,write='insert',existing=[]}={}) {
  const events={},nodes={},calls=[],toasts=[];
  const document={getElementById(id){return nodes[id]??=( {disabled:false,textContent:'',addEventListener(type,fn){events[id+type]=fn;}} );}};
  const window={SUPABASE_CONFIG:{url:'https://fixture.invalid',anonKey:'synthetic'},_sbAccessToken:'synthetic',App:{loadAllData:async()=>{},showRoute:()=>{}}};
  const fetch=async(url,init={})=>{
    calls.push({url,...init});
    if(!init.method)return {ok:status===200,json:async()=>{if(jsonError)throw new Error('bad JSON');return rows;}};
    if(write==='network')throw new Error('response lost');
    return {ok:write!=='denied',json:async()=>{
      const row=JSON.parse(init.body);
      if(write==='bad-json')throw new Error('bad JSON');
      if(write==='wrong-id')return [{...row,id:'other'}];
      if(write==='staff-role')return [{...row,role:'admin'}];
      if(write==='multiple')return [row,row];
      if(write==='object')return row;
      return write==='insert'?[row]:[];
    }};
  };
  const context=vm.createContext({document,window,fetch,console,setTimeout,
    escHtml:String,renderRoleSelectOptions:()=>'',roleSelectValue:String,applyRoleResultToSelect:()=>{}});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace('export function renderSettingsUsers','function renderSettingsUsers'),context);
  context.renderSettingsUsers({innerHTML:'',querySelectorAll:()=>[]},{state:{allProfiles:existing},ROLE_LABELS:{},showToast:s=>toasts.push(s)},()=>{});
  await events.syncUsersBtnclick();
  return {writes:calls.filter(c=>c.method),toasts,btn:nodes.syncUsersBtn};
}
for(const rows of [[{id:'a',role:null}],[{id:'a',role:'unknown'}],[{}],{},null])test('invalid view fails closed '+JSON.stringify(rows),async()=>{
  const r=await sync({rows});assert.equal(r.writes.length,0);assert.match(r.toasts.join(' '),/ไม่สำเร็จ/);assert.equal(r.btn.disabled,false);
});
for(const opts of [{status:403},{jsonError:true}])test('failed view is not reported complete '+JSON.stringify(opts),async()=>{
  const r=await sync(opts);assert.equal(r.writes.length,0);assert.match(r.toasts.join(' '),/ไม่สำเร็จ/);
});
for(const role of ['customer','sales','technician','accountant','admin'])test('sync never provisions staff from snapshot '+role,async()=>{
  const r=await sync({rows:[{id:'a',role,full_name:'Test'}]});assert.equal(r.writes.length,1);
  assert.equal(JSON.parse(r.writes[0].body).role,'customer');
  assert.equal(r.writes[0].headers.Prefer,'resolution=ignore-duplicates,return=representation');
});
for(const write of ['network','denied','conflict','bad-json','wrong-id','staff-role','multiple','object'])test('partial outcome is not a success '+write,async()=>{
  const r=await sync({rows:[{id:'a',role:'sales'}],write});assert.match(r.toasts.join(' '),/ยืนยันไม่ได้/);assert.doesNotMatch(r.toasts.join(' '),/✓/);
});
test('existing profiles are never written',async()=>{
  const r=await sync({rows:[{id:'a',role:'sales'}],existing:[{id:'a',role:'sales'}]});assert.equal(r.writes.length,0);
});
test('empty readable view does not claim all auth accounts have profiles',async()=>{
  const r=await sync();assert.equal(r.writes.length,0);
  assert.match(r.toasts.join(' '),/รายการที่อ่านได้/);
  assert.doesNotMatch(r.toasts.join(' '),/ครบแล้ว|ไม่มีตกหล่น/);
});
