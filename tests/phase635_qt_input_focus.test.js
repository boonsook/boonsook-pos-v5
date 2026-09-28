// Phase 635: behavioral input/change-handler regressions in node:vm.
// Browser identity/Tab/caret proof belongs to the paired Playwright suite.
// PHASE635_BASELINE=1 reads immutable Git blobs without changing runtime files;
// PHASE635_QUOTATIONS_SOURCE supports isolated candidate-source verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.env.PHASE635_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url));
const BASE = '824dabeeffb746cb2e0565717ea98784ccb1125b';
const baseline = process.env.PHASE635_BASELINE === '1';
const override = process.env.PHASE635_QUOTATIONS_SOURCE;
if (baseline && override) throw new Error('Choose baseline OR override');
const blob = (file) => execFileSync('git', ['show', BASE + ':' + file], { cwd: ROOT, encoding: 'utf8' });
const source = baseline ? blob('modules/quotations.js') : readFileSync(override || path.join(ROOT, 'modules/quotations.js'), 'utf8');
const docItems = baseline
  ? await import('data:text/javascript;base64,' + Buffer.from(blob('modules/doc_items.js')).toString('base64'))
  : await import(pathToFileURL(path.join(ROOT, 'modules/doc_items.js')).href);

test('existing Save and convert function bodies remain byte-for-byte unchanged', () => {
  // LF-normalized bodies freshly pinned from BASE. Default CI needs no Git history.
  const expected = {
    saveQuotationFull: '901e14d62c2ba3a2adb5b31084c20555d576f4420377c550aded572036553e83',
    convertToDeliveryInvoice: 'bb68898428f4e5280002927edd9a19ed835f997fa7cce41a3600efad9a407330',
  };
  for (const [name, sha256] of Object.entries(expected)) {
    const pattern = new RegExp('async function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
    const after = source.match(pattern)?.[0];
    assert.ok(after, name + ' must exist');
    // Git stores LF; a Windows checkout can use CRLF without code changes.
    assert.equal(createHash('sha256').update(after.replaceAll('\r\n', '\n')).digest('hex'), sha256, name);
  }
});

function harness(mode = 'new') {
  let rootWrites = 0;
  let valueWrites = 0;
  const nodes = new Map();
  const byClass = new Map();
  const ledger = [];
  let resolveHeader;
  let deferHeader = true;
  const makeNode = (value = '', cls = '', idx = '0') => {
    let raw = String(value);
    const listeners = new Map();
    const node = {
      dataset: { idx }, textContent: '', disabled: false, checked: false, inert: false, isConnected: true,
      classList: { contains: (name) => name === cls, add() {}, remove() {} },
      get value() { return raw; },
      set value(next) { raw = String(next); valueWrites++; },
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
      fire(name) { return Promise.all([...(listeners.get(name) || [])].map((fn) => fn({ target: node, currentTarget: node }))); },
      closest() { return row; },
      focus() {},
    };
    return node;
  };
  for (const [id, value] of Object.entries({
    qt_customerSearch: 'Synthetic 635', qt_customerPhone: '', qt_customerAddress: '',
    qt_customerTaxId: '', qt_docNo: 'LOCAL-635', qt_date: '2026-09-28',
    qt_payTerms: 'เงินสด', qt_bankCoa: '', qt_creditDays: '0', qt_project: '',
    qt_refNo: '', qt_salesperson: '', qt_status: 'pending', qt_note: '',
    qt_discPct: '0', qt_whtPct: '3',
  })) nodes.set(id, makeNode(value));
  nodes.set('qt_wht', makeNode());
  nodes.get('qt_whtPct').disabled = true;
  for (const id of ['qtSaveBtn', 'qtAddCustomItem', 'qtAddHeadingBtn']) nodes.set(id, makeNode());
  for (const [id, node] of nodes) node.id = id;
  for (const id of ['qtSubtotal', 'qtDiscountAmount', 'qtAfterDiscount', 'qtWhtAmount', 'qtGrandTotal']) nodes.set(id, makeNode());
  for (const [cls, value] of Object.entries({
    'qt-li-name': 'Synthetic item', 'qt-li-qty': '2', 'qt-li-unit': 'ชุด',
    'qt-li-price': '1500', 'qt-li-disc': '0', 'qt-li-total': '',
  })) byClass.set(cls, makeNode(value, cls, '1'));
  byClass.set('qt-li-heading-name', makeNode('Synthetic heading', 'qt-li-heading-name', '0'));
  for (const cls of ['qt-li-up', 'qt-li-down', 'qt-li-del']) byClass.set(cls, makeNode('', cls, '1'));
  const find = (selector) => {
    if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
    const match = selector.match(/^\.([a-zA-Z0-9-]+)/);
    return match ? byClass.get(match[1]) || null : null;
  };
  const row = { querySelector: find };
  const container = {
    childNodes: [],
    querySelector: find,
    querySelectorAll(selector) {
      if (selector === 'input,select,textarea,button') return [...nodes.values(), ...byClass.values()];
      return selector.split(',').map(find).filter(Boolean);
    },
    contains(node) { return [...nodes.values(), ...byClass.values()].includes(node); },
    addEventListener() {}, removeEventListener() {},
    set innerHTML(_html) { rootWrites++; },
    replaceChildren() { rootWrites++; },
  };
  const ctx = {
    state: { quotations: [], customers: [], products: [], receipts: [], deliveryInvoices: [],
      profile: { role: 'admin' }, storeInfo: {}, paymentInfo: { banks: [] } },
    showToast: (value) => ledger.push(value), money: String,
    loadAllData: async () => { ledger.push({ m: 'RELOAD' }); },
  };
  const sandbox = {
    ...docItems, console, Intl, Date, URLSearchParams,
    document: { getElementById: (id) => id === 'page-quotations' ? container : nodes.get(id),
      querySelector: find, querySelectorAll: (selector) => container.querySelectorAll(selector) },
    window: { App: { state: ctx.state }, SUPABASE_CONFIG: { url: 'https://fixture.invalid' } },
    fetch: () => { throw new Error('No network in unit fixture'); },
    round2: (value) => Math.round(value * 100) / 100,
    escHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    consumeAirQuoteDrafts: () => [], renderEmpty: () => '', renderSkeleton: () => '',
    renderDocumentTemplateHeader: () => '', renderDocumentTemplateFooter: () => '',
    renderDocumentTemplateNote: () => '',
    fixtureCtx: ctx, fixtureContainer: container,
  };
  for (const [name, m] of Object.entries({ _appXhrPost: 'POST', _appXhrPatch: 'PATCH', _appXhrDelete: 'DELETE' })) {
    sandbox.window[name] = async (...args) => {
      ledger.push({ m, args: JSON.parse(JSON.stringify(args)) });
      if (args[0] === 'quotations' && deferHeader) return new Promise((resolve) => { resolveHeader = resolve; });
      return { ok: true, data: { id: 63599 } };
    };
  }
  vm.createContext(sandbox);
  const setup = [
    "_ctx = fixtureCtx; _editingId = " + (mode === 'saved' ? '63501' : 'null') + "; _viewMode = 'form';",
    "_lineItems = [normalizeDocumentItem({item_name:'Synthetic heading', item_type:'heading'}),",
    "normalizeDocumentItem({item_name:'Synthetic item', qty:2, unit:'ชุด', unit_price:1500, discount_pct:0, line_total:3000})];",
    'bindFormEvents(fixtureContainer, [], []);',
  ].join('\n');
  vm.runInContext(source.replace(/^import .*?;\r?$/gm, '').replace(/^export /gm, '') + '\n' + setup, sandbox);
  return {
    node: (selector) => find(selector),
    save: () => nodes.get('qtSaveBtn').fire('click'),
    finishHeader(ok) { assert.equal(typeof resolveHeader, 'function'); resolveHeader(ok ? { ok: true, data: { id: 63599 } } : { ok: false, error: { message: 'Synthetic failed header' } }); },
    retryImmediately() { deferHeader = false; },
    writes: () => ledger.filter((entry) => entry && typeof entry === 'object' && ['POST', 'PATCH', 'DELETE'].includes(entry.m)),
    controls: () => [...nodes.values(), ...byClass.values()],
    input(selector, value) {
      const node = find(selector);
      node.value = value; // emulate browser edit; exclude this assignment from handler audit
      valueWrites = 0;
      node.fire('input');
      assert.equal(valueWrites, 0, 'input handler must not rewrite .value');
      assert.equal(rootWrites, 0, 'input handler must not replace the form');
    },
    commit(selector) {
      find(selector).fire('change');
      assert.equal(rootWrites, 0, 'change handler must not replace the form');
    },
    run: (js) => vm.runInContext(js, sandbox),
    noEffects() { assert.deepEqual(ledger, []); assert.deepEqual(ctx.state.quotations, []); },
    totals(expected) {
      assert.equal(nodes.get('qtGrandTotal').textContent, new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 }).format(expected));
    },
  };
}

for (const value of ['10', '20', '12.5']) {
  test('document percent input ' + value + ': no render or input.value assignment; totals current', () => {
    const h = harness();
    let prefix = '';
    for (const char of value) h.input('#qt_discPct', prefix += char);
    h.totals(3000 * (1 - Number(value) / 100));
    h.commit('#qt_discPct');
    h.noEffects();
  });
}

for (const [selector, value] of [
  ['.qt-li-name', 'Changed item'], ['.qt-li-qty', '12.5'],
  ['.qt-li-unit', 'boxes'], ['.qt-li-price', '2000'], ['.qt-li-disc', '20'],
]) {
  test('row ' + selector + ' commits without whole-form replacement', () => {
    const h = harness();
    h.input(selector, value);
    h.commit(selector);
    h.noEffects();
  });
}

test('retained listeners resolve the current item array after F1 preview cloning', () => {
  const h = harness();
  h.run('globalThis.oldItems = _lineItems; _lineItems = _lineItems.map(item => ({...item}));');
  h.input('.qt-li-qty', '4');
  h.commit('.qt-li-qty');
  assert.equal(h.run('_lineItems[1].qty'), 4);
  assert.equal(h.run('oldItems[1].qty'), 2);
  assert.equal(h.run('_lineItems[1].line_total'), 6000);
  h.totals(6000);
  h.noEffects();
});

test('blank WHT remains raw during input then commits to historical render-zero; checkbox retains pct', () => {
  const h = harness();
  h.node('#qt_wht').checked = true;
  h.commit('#qt_wht');
  assert.equal(h.node('#qt_whtPct').disabled, false);
  h.input('#qt_whtPct', '');
  assert.equal(h.node('#qt_whtPct').value, '');
  h.commit('#qt_whtPct');
  assert.equal(h.node('#qt_whtPct').value, '0');
  h.totals(3000);
  h.input('#qt_whtPct', '12.5');
  h.commit('#qt_whtPct');
  h.totals(2625);
  h.node('#qt_wht').checked = false;
  h.commit('#qt_wht');
  assert.equal(h.node('#qt_whtPct').disabled, true);
  assert.equal(h.node('#qt_whtPct').value, '12.5');
  h.totals(3000);
  h.noEffects();
});

test('blank quantity commits to 1; explicit zero stays zero; blank price commits to 0', () => {
  const h = harness();
  h.input('.qt-li-qty', '');
  h.commit('.qt-li-qty');
  assert.equal(h.node('.qt-li-qty').value, '1');
  h.totals(1500);
  h.input('.qt-li-qty', '0');
  h.commit('.qt-li-qty');
  assert.equal(h.node('.qt-li-qty').value, '0');
  h.input('.qt-li-price', '');
  h.commit('.qt-li-price');
  assert.equal(h.node('.qt-li-price').value, '0');
  h.totals(0);
  h.noEffects();
});

test('heading commits without render and stays non-monetary', () => {
  const h = harness();
  h.input('.qt-li-heading-name', 'Changed heading');
  h.commit('.qt-li-heading-name');
  assert.equal(h.run('_lineItems[0].item_name'), 'Changed heading');
  assert.equal(h.run('_lineItems[0].line_total'), 0);
  h.noEffects();
});

for (const mode of ['new', 'saved']) {
  for (const outcome of ['success', 'failure']) test(mode + ' pending header: actual input/change/structural handlers cannot change saved snapshot; ' + outcome, async () => {
    const h = harness(mode);
    h.node('#qt_note').disabled = true;
    h.node('#qt_note').inert = true;
    const before = h.controls().map((node) => ({ disabled: node.disabled, inert: node.inert }));
    const model = h.run('JSON.stringify(_lineItems)');
    const pending = h.save();
    assert.equal(h.writes().length, 1);
    assert.equal(h.writes()[0].args[1].total_amount, 3000);
    assert.equal(h.node('.qt-li-price').disabled, true);
    for (const selector of ['.qt-li-price', '.qt-li-qty', '.qt-li-name', '.qt-li-heading-name', '#qt_discPct', '#qt_whtPct']) {
      const node = h.node(selector);
      const raw = node.value;
      node.value = '200'; // hostile/dispatched edit: target handler must guard too
      await node.fire('input');
      await node.fire('change');
      assert.equal(h.run('JSON.stringify(_lineItems)'), model, selector + ' mutated pending snapshot');
      assert.equal(node.value, raw, selector + ' left an unaccepted edit in the UI');
    }
    for (const selector of ['#qtAddCustomItem', '#qtAddHeadingBtn', '.qt-li-up', '.qt-li-down', '.qt-li-del']) {
      await h.node(selector).fire('click');
      assert.equal(h.run('JSON.stringify(_lineItems)'), model, selector + ' changed pending rows');
    }
    await h.save(); // direct duplicate invocation also must not post again
    assert.equal(h.writes().length, 1);
    h.finishHeader(outcome === 'success');
    await pending;
    if (outcome === 'failure') {
      assert.equal(h.writes().length, 1);
      assert.deepEqual(h.controls().map((node) => ({ disabled: node.disabled, inert: node.inert })), before);
      assert.equal(h.run('JSON.stringify(_lineItems)'), model);
      h.input('.qt-li-price', '200');
      h.commit('.qt-li-price');
      h.totals(400);
      h.retryImmediately();
      await h.save();
    }
    const headers = h.writes().filter((entry) => entry.args[0] === 'quotations');
    const rows = h.writes().filter((entry) => entry.m === 'POST' && entry.args[0] === 'quotation_items').map((entry) => entry.args[1]);
    assert.equal(headers.length, outcome === 'success' ? 1 : 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].unit_price, outcome === 'success' ? 1500 : 200);
    assert.equal(rows.reduce((sum, row) => sum + row.line_total, 0), headers.at(-1).args[1].total_amount);
    assert.equal(headers.at(-1).args[1].grand_total, outcome === 'success' ? 3000 : 400);
  });
}
