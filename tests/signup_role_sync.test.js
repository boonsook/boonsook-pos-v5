import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const source = process.env.SIGNUP_BASELINE === '1'
  ? execFileSync('git', ['show', '9078b49b6f6661700afaf2956bbe5ef3a360864a:modules/settings/users.js'], { encoding: 'utf8' })
  : fs.readFileSync(new URL('../modules/settings/users.js', import.meta.url), 'utf8');
const oldRow = { id: 'profile-1', role: 'sales', full_name: 'Old name' };
const freshRow = { ...oldRow, role: 'accountant', full_name: 'New name' };

function setup({ rows = [freshRow], status = 200, jsonError = false, networkError = false,
  existing = [oldRow], admin = true, delayed = false } = {}) {
  const events = {}, nodes = {}, calls = [], toasts = [], timers = new Map();
  let release, timerId = 0;
  const state = { allProfiles: existing };
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const document = { getElementById(id) {
    return nodes[id] ??= { disabled: false, textContent: '', addEventListener(type, fn) { events[id + type] = fn; } };
  } };
  const window = { SUPABASE_CONFIG: { url: 'https://fixture.invalid', anonKey: 'fixture' }, _sbAccessToken: 'fixture',
    App: { loadAllData: async () => { throw new Error('Global loader must not run'); }, showRoute: () => {} } };
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (delayed) await new Promise((resolve, reject) => {
      release = resolve;
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    });
    if (networkError) throw new Error('offline');
    return { ok: status >= 200 && status < 300, status, json: async () => {
      if (jsonError) throw new Error('invalid JSON');
      return rows;
    } };
  };
  const ctx = { state, ROLE_LABELS: {}, requireAdmin: () => admin, showToast: message => toasts.push(message) };
  const context = vm.createContext({ document, window, fetch, console, AbortController,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    escHtml: String, renderRoleSelectOptions: () => '', roleSelectValue: String, applyRoleResultToSelect: () => {} });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace('export function renderSettingsUsers', 'function renderSettingsUsers'), context);
  context.renderSettingsUsers(el, ctx, () => {});
  return { state, el, ctx, nodes, calls, toasts, timers, click: events.syncUsersBtnclick,
    release: () => release(), expire: () => { for (const fn of [...timers.values()]) fn(); } };
}
function assertReadOnly(r) {
  assert.equal(r.calls.filter(call => !['GET', 'HEAD'].includes(call.method || 'GET')).length, 0);
}
function assertBounded(r) {
  assert.match(r.toasts.join(' '), /ที่อ่านได้/);
  assert.doesNotMatch(r.toasts.join(' '), /ครบแล้ว|ไม่มีตกหล่น|กู้|สร้าง|เพิ่มโปรไฟล์/);
}
test('stale admin list refreshes existing profile and renders new values without writes', async () => {
  const r = setup(); await r.click();
  assertReadOnly(r); assert.equal(r.calls.length, 1); assert.deepEqual(r.state.allProfiles, [freshRow]);
  assert.match(r.el.innerHTML, /New name/); assert.doesNotMatch(r.el.innerHTML, /Old name/);
  assert.match(r.el.innerHTML, /รีเฟรชรายชื่อ/); assertBounded(r);
  assert.match(r.calls[0].url, /profiles_with_email\?select=\*&order=created_at/);
});
test('real view counterexample: auth-only account is absent, never recovered or written', async () => {
  const auth = [{ id: 'auth-only' }, { id: 'profile-1' }];
  // FROM profiles LEFT JOIN auth.users: auth-only never produces a view row.
  const rows = [freshRow].map(profile => ({ ...profile, email: auth.some(u => u.id === profile.id) ? 'fixture@example.invalid' : null }));
  const r = setup({ rows }); await r.click(); assertReadOnly(r); assertBounded(r);
  assert.equal(r.state.allProfiles.some(profile => profile.id === 'auth-only'), false);
});
for (const role of ['customer', 'sales', 'technician', 'accountant', 'admin']) {
  test('refresh never inserts or changes DB role for ' + role, async () => {
    const row = { ...freshRow, role };
    const r = setup({ rows: [row], existing: [] }); await r.click();
    assertReadOnly(r); assert.deepEqual(r.state.allProfiles, [row]); assertBounded(r);
  });
}
for (const rows of [null, {}, [null], [{}], [{ ...freshRow, id: '' }], [{ ...freshRow, role: null }],
  [{ ...freshRow, role: 'unknown' }], [{ ...freshRow, full_name: {} }], [{ ...freshRow, email: 12 }],
  [freshRow, { ...freshRow, role: null }]]) {
  test('invalid response preserves old list: ' + JSON.stringify(rows), async () => {
    const r = setup({ rows }); const html = r.el.innerHTML; await r.click();
    assertReadOnly(r); assert.deepEqual(r.state.allProfiles, [oldRow]); assert.equal(r.el.innerHTML, html);
    assert.match(r.toasts.join(' '), /ไม่สำเร็จ/); assert.doesNotMatch(r.toasts.join(' '), /✓/);
    assert.equal(r.nodes.syncUsersBtn.disabled, false);
  });
}
for (const opts of [{ status: 403 }, { status: 500 }, { jsonError: true }, { networkError: true }]) {
  test('read failure preserves old list: ' + JSON.stringify(opts), async () => {
    const r = setup(opts); const html = r.el.innerHTML; await r.click();
    assertReadOnly(r); assert.deepEqual(r.state.allProfiles, [oldRow]); assert.equal(r.el.innerHTML, html);
    assert.match(r.toasts.join(' '), /ไม่สำเร็จ/); assert.doesNotMatch(r.toasts.join(' '), /✓/);
    assert.equal(r.nodes.syncUsersBtn.disabled, false);
  });
}
for (const opts of [{ rows: [] }, { status: 206 }, { rows: [freshRow], existing: [oldRow, { ...oldRow, id: 'hidden-by-rls' }] }]) {
  test('empty, partial or RLS-filtered view makes no completeness claim: ' + JSON.stringify(opts), async () => {
    const r = setup(opts); await r.click(); assertReadOnly(r); assertBounded(r);
    assert.doesNotMatch(r.el.innerHTML, /ผู้ใช้ในระบบ|ยังไม่มีผู้ใช้/);
  });
}
test('slow request keeps old list and no success; duplicate click ignored', async () => {
  const r = setup({ delayed: true }); const pending = r.click();
  assert.equal(r.nodes.syncUsersBtn.disabled, true); assert.deepEqual(r.state.allProfiles, [oldRow]);
  assert.equal(r.toasts.length, 0);
  // Do not await an accidental duplicate pending request on the RED baseline.
  const duplicate = r.click(); assert.equal(r.calls.length, 1);
  r.release(); await pending; await duplicate;
  assert.deepEqual(r.state.allProfiles, [freshRow]); assertReadOnly(r); assertBounded(r);
  assert.equal(r.timers.size, 0);
});
test('timeout aborts read and retains old list without success', async () => {
  const r = setup({ delayed: true }); const pending = r.click();
  assert.equal(r.timers.size, 1); r.expire(); await pending;
  assertReadOnly(r); assert.deepEqual(r.state.allProfiles, [oldRow]);
  assert.match(r.toasts.join(' '), /ไม่สำเร็จ/); assert.doesNotMatch(r.toasts.join(' '), /✓/);
  assert.equal(r.nodes.syncUsersBtn.disabled, false); assert.equal(r.timers.size, 0);
});
test('non-admin cannot start refresh', async () => {
  const r = setup({ admin: false }); await r.click();
  assert.equal(r.calls.length, 0); assert.deepEqual(r.state.allProfiles, [oldRow]);
});
test('role change while pending prevents publishing response', async () => {
  const r = setup({ delayed: true }); const pending = r.click();
  r.ctx.requireAdmin = () => false; r.release(); await pending;
  assertReadOnly(r); assert.deepEqual(r.state.allProfiles, [oldRow]); assert.doesNotMatch(r.toasts.join(' '), /✓/);
});
test('detached view cannot overwrite newer state or render over another page', async () => {
  const r = setup({ delayed: true }); const pending = r.click();
  r.nodes.syncUsersBtn = null; r.state.allProfiles = [{ ...freshRow, full_name: 'Newer page' }];
  const html = r.el.innerHTML; r.release(); await pending;
  assert.equal(r.state.allProfiles[0].full_name, 'Newer page'); assert.equal(r.el.innerHTML, html);
  assertReadOnly(r); assert.equal(r.toasts.length, 0);
});
