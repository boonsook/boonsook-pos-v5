// Focused behavioral RED/GREEN without a server. The full browser contract lives
// in e2e/phase634_qt_draft_preview.spec.js. No production config is loaded.
// PHASE634_BASELINE=1 reads the pinned Git blob into memory (never reverts peers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as docItems from '../modules/doc_items.js';
import * as presentation from '../modules/document_presentation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'ffe230a8a99b75162193bc6b3671e0310991e75b';
const source = process.env.PHASE634_BASELINE === '1'
  ? execFileSync('git', ['show', `${baseline}:modules/quotations.js`], { cwd: root, encoding: 'utf8' })
  : readFileSync(new URL('../modules/quotations.js', import.meta.url), 'utf8');

test('F1: actual preview click handler keeps an unsaved QT in preview, not list', () => {
  const nodes = new Map();
  const node = (value = '') => ({
    value, checked: false, dataset: {}, handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelectorAll() { return []; },
    focus() {},
  });
  const fields = {
    qt_customerSearch: 'Synthetic F1 customer', qt_customerPhone: '0800000634',
    qt_customerAddress: 'Synthetic address', qt_customerTaxId: '0000000000634',
    qt_docNo: '', qt_date: '2026-09-28', qt_project: 'F1 project',
    qt_refNo: 'F1 ref', qt_salesperson: 'Synthetic salesperson', qt_note: 'Keep my draft',
    qt_payTerms: 'เงินสด', qt_bankCoa: '', qt_creditDays: '0', qt_status: 'pending',
    qt_discPct: '0', qt_whtPct: '3',
  };
  for (const [id, value] of Object.entries(fields)) nodes.set(id, node(value));
  nodes.set('qtPreviewBtn', node());
  nodes.set('qt_wht', node());
  const clickTarget = nodes.get('qtPreviewBtn');
  let html = '';
  const container = {
    childNodes: [],
    querySelector() { return null; },
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; nodes.clear(); },
    querySelectorAll() { return []; },
  };
  const ledger = [];
  const ctx = {
    state: { quotations: [], deliveryInvoices: [], receipts: [], customers: [], products: [],
      profile: { role: 'admin' }, storeInfo: {}, paymentInfo: { banks: [] } },
    money: String, showToast: (message) => ledger.push(message),
  };
  const sandbox = {
    ...docItems, ...presentation, console, Intl, Date, URLSearchParams,
    document: { getElementById: (id) => id === 'page-quotations' ? container : nodes.get(id),
      querySelectorAll: () => [] },
    window: { App: { state: ctx.state }, SUPABASE_CONFIG: { url: 'https://fixture.invalid' } },
    fetch: (...args) => { ledger.push(args); throw new Error('No network allowed'); },
    consumeAirQuoteDrafts: () => [], renderEmpty: () => '<div>empty</div>', renderSkeleton: () => '',
    renderDocumentTemplateHeader: () => '', renderDocumentTemplateFooter: () => '',
    renderDocumentTemplateNote: (_si, options) => options.documentNote || '',
    round2: (n) => Math.round(n * 100) / 100,
    escHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    fixtureCtx: ctx, fixtureContainer: container,
  };
  vm.createContext(sandbox);
  // Keep the actual module bodies; imported rendering helpers are small stubs.
  const runnable = source.replace(/^import .*?;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInContext(runnable + `
    _ctx = fixtureCtx; _editingId = null; _viewMode = 'form';
    _lineItems = [normalizeDocumentItem({item_name:'Synthetic item', qty:2, unit:'ชุด', unit_price:125, line_total:250})];
    bindFormEvents(fixtureContainer, [], []);
  `, sandbox);
  assert.equal(typeof clickTarget.handlers.click, 'function');
  clickTarget.handlers.click();
  assert.equal(vm.runInContext('_viewMode', sandbox), 'preview', 'F1: unsaved preview must not fall back to list');
  assert.ok(html.includes('id="qtDocPreview"'), 'actual preview HTML rendered');
  assert.ok(html.includes('Synthetic F1 customer'), 'current header rendered');
  assert.ok(html.includes('Synthetic item'), 'current line item rendered');
  assert.equal(vm.runInContext('_lineItems.length', sandbox), 1, 'draft items not cleared');
  assert.deepEqual(ctx.state.quotations, [], 'draft not inserted in persisted state');
  assert.deepEqual(ledger, [], 'no save, fetch, number allocation, or failure toast');
});
