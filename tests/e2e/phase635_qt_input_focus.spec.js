// Phase 635: quotation keyboard continuity, derived totals and mocked Save.
// PHASE635_BASELINE=1 serves ALL imported /modules/* JS from immutable Git blobs.
// Default is current runtime. No worktree rewrites, production config or real data.
// Caret: number inputs have null selectionStart in Chromium. Numeric key-edit
// sequences prove caret position; text inputs additionally assert selectionStart.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.env.PHASE635_SOURCE_ROOT || fileURLToPath(new URL('../../', import.meta.url));
// Resolve the installed test runner from the selected local source tree.
const { test, expect } = await import(pathToFileURL(path.join(ROOT, 'node_modules/@playwright/test/index.mjs')).href);
test.use({ serviceWorkers: 'block' });
const BASE = '824dabeeffb746cb2e0565717ea98784ccb1125b';
const BASELINE = process.env.PHASE635_BASELINE === '1';
const OVERRIDE = process.env.PHASE635_QUOTATIONS_SOURCE;
if (BASELINE && OVERRIDE) throw new Error('Choose immutable baseline OR candidate override');
const candidateSource = OVERRIDE ? readFileSync(OVERRIDE, 'utf8') : null;
const gitBlob = (file) => execFileSync('git', ['show', BASE + ':' + file], { cwd: ROOT, encoding: 'utf8' });
const URL_PATH = '/__phase635__/fixture.html';
const HTML = '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/doc-print.css">'
  + '<link rel="stylesheet" href="/phase4-design-system.css"><link rel="stylesheet" href="/phase4-components.css">'
  + '<title>Phase 635 synthetic fixture</title></head><body><div id="page-quotations"></div></body></html>';
const SAVED_ID = 63501;
const SAVED_ROWS = [
  { product_id: null, item_name: 'Synthetic heading', item_type: 'heading', qty: 0, unit: '', unit_price: 0, discount_pct: 0, line_total: 0, sort_order: 1 },
  { product_id: null, item_name: 'Synthetic item', item_type: 'item', qty: 2, unit: 'ชุด', unit_price: 1500, discount_pct: 0, line_total: 3000, sort_order: 2 },
];

function installFixture({ savedId, savedRows }) {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  window.__ledger = [];
  window.__toasts = [];
  window.__xss = 0;
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled')));
  window.SUPABASE_CONFIG = { url: 'https://fixture.invalid', anonKey: 'synthetic-only' };
  window._sbAccessToken = 'synthetic-only';
  const reply = (body) => Promise.resolve({ ok: true, status: 200, json: async () => clone(body) });
  window.fetch = (url, init = {}) => {
    const value = String(url);
    window.__ledger.push({ m: init.method || 'GET', url: value, body: init.body });
    if (value.includes('/quotation_items?')) return reply(savedRows);
    if (value.includes('/delivery_invoices?')) return reply([]);
    // Unknown/RPC requests stay in the ledger and cannot allocate a real number.
    return reply([]);
  };
  for (const [name, m] of Object.entries({ _appXhrPost: 'POST', _appXhrPatch: 'PATCH', _appXhrPut: 'PUT', _appXhrDelete: 'DELETE' })) {
    window[name] = async (...args) => {
      window.__ledger.push({ m, args: clone(args) });
      if (['POST', 'PATCH'].includes(m) && args[0] === 'quotations' && window.__deferSave) {
        return new Promise((resolve) => { window.__resolveSave = resolve; });
      }
      return { ok: true, data: { id: 63599, inv_no: 'INV-SYNTHETIC-635' } };
    };
  }
  window._appShareDoc = (...args) => window.__ledger.push({ m: 'SHARE', args });
  // No request may escape through an unmocked XHR, socket, or beacon path.
  window.XMLHttpRequest = class {
    open(...args) { window.__ledger.push({ m: 'RAW_XHR', args }); }
    setRequestHeader() {}
    send() { throw new Error('Raw XHR forbidden in synthetic fixture'); }
  };
  window.WebSocket = class { constructor() { throw new Error('WebSocket forbidden'); } };
  navigator.sendBeacon = (...args) => { window.__ledger.push({ m: 'BEACON', args }); return false; };
  window._appGetLogo = () => '/logo.svg';
  const toast = (value) => window.__toasts.push(String(value));
  window.App = { state: { profile: { role: 'admin' } }, showToast: toast,
    confirm: async (message) => { window.__ledger.push({ m: 'CONFIRM', message }); return true; } };
  const saved = {
    id: savedId, qt_no: 'QT-SAVED-635', status: 'approved', created_at: '2026-09-20T00:00:00.000Z',
    customer_name: 'Saved synthetic customer', customer_phone: '0800000000',
    total_amount: 3000, grand_total: 3000, amount: 3000, after_discount: 3000,
    discount_pct: 0, discount_amount: 0, withholding_tax: false, wht_pct: 3, wht_amount: 0,
    payment_terms: 'เงินสด', credit_days: 0, salesperson: 'Synthetic sales',
  };
  const state = {
    profile: { role: 'admin', full_name: 'Synthetic sales' }, storeInfo: { name: 'Synthetic store' },
    customers: [], products: [{ id: 63542, name: 'Synthetic product 635', sku: 'LOCAL635', price: 99 }], paymentInfo: { banks: [{ coaCode: '1102-635', bankName: 'Synthetic Bank', bankAccount: '000-635' }] },
  };
  // Log transient insert/remove/replacement too, not merely final array equality.
  const watch = (value, path) => {
    if (!value || typeof value !== 'object') return value;
    for (const key of Object.keys(value)) value[key] = watch(value[key], `${path}.${key}`);
    return new Proxy(value, {
      set(target, key, next) {
        window.__ledger.push({ m: 'STATE', path: `${path}.${String(key)}` });
        target[key] = watch(next, `${path}.${String(key)}`); return true;
      },
      deleteProperty(target, key) {
        window.__ledger.push({ m: 'STATE', path: `${path}.${String(key)}`, deleted: true });
        return Reflect.deleteProperty(target, key);
      },
    });
  };
  for (const [key, initial] of Object.entries({ quotations: [saved], deliveryInvoices: [], receipts: [] })) {
    let value = watch(initial, key);
    Object.defineProperty(state, key, { enumerable: true, get: () => value,
      set(next) { window.__ledger.push({ m: 'STATE', path: key }); value = watch(next, key); } });
  }
  window.__ctx = { state, money: String, showToast: toast,
    showRoute: (route) => window.__ledger.push({ m: 'ROUTE', route }),
    loadAllData: async () => { window.__ledger.push({ m: 'RELOAD' }); } };
  window.__persisted = JSON.stringify([state.quotations, state.deliveryInvoices, state.receipts]);
}

async function boot(page, viewport) {
  await page.setViewportSize(viewport);
  const origin = new URL(test.info().project.use.baseURL).origin;
  const blocked = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.route(`**${URL_PATH}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML }));
  if (BASELINE) {
    await page.route('**/modules/**', (route) => {
      const modulePath = new URL(route.request().url()).pathname.slice(1);
      return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: gitBlob(modulePath) });
    });
  } else if (candidateSource !== null) {
    await page.route('**/modules/quotations.js', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: candidateSource }));
  }
  await page.addInitScript(installFixture, { savedId: SAVED_ID, savedRows: SAVED_ROWS });
  await page.goto(URL_PATH);
  await page.evaluate(async () => {
    const module = await import('/modules/quotations.js');
    module.renderQuotationsPage(window.__ctx);
  });
  await expect(page.locator('#qtAddBtn')).toBeVisible();
  return async () => {
    expect(errors, 'no browser exceptions').toEqual([]);
    expect(blocked, 'no attempted cross-origin request').toEqual([]);
    expect(await page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(false);
  };
}

async function expectNoDraftSideEffects(page) {
  const result = await page.evaluate(() => ({ ledger: window.__ledger,
    initial: window.__persisted,
    current: JSON.stringify([window.__ctx.state.quotations, window.__ctx.state.deliveryInvoices, window.__ctx.state.receipts]),
  }));
  expect(result.ledger, 'no effects after opening: fetch/write/RPC/state/reload/share').toEqual(await page.evaluate(() => window.__openingLedger));
  expect(result.current).toBe(result.initial);
}


const fmt = (value) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const cash = (value) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 }).format(value);

async function openForm(page, viewport, mode) {
  const clean = await boot(page, viewport);
  if (mode === 'saved') {
    await page.locator('.qt-status-select').selectOption('edit');
    await expect(page.locator('.qt-item-row')).toHaveCount(1);
  } else {
    await page.locator('#qtAddBtn').click();
    await page.locator('#qtAddHeadingBtn').click();
    await page.locator('.qt-li-heading-name').fill('Synthetic heading');
    await page.locator('.qt-li-heading-name').dispatchEvent('change');
    await page.locator('#qtAddItemBtn').click();
    await page.locator('#qtAddCustomItem').click();
    // Setup only. Observed input sequences below use keyboard without dispatch
    // or refocus; setup follows Phase 634's synthetic real-module fixture.
    for (const [selector, value] of [
      ['.qt-li-name', 'Synthetic item'], ['.qt-li-qty', '2'],
      ['.qt-li-unit', 'ชุด'], ['.qt-li-price', '1500'],
    ]) {
      await page.locator(selector).fill(value);
      await page.locator(selector).dispatchEvent('change');
    }
    await page.locator('#qt_customerSearch').fill('Synthetic customer 635');
    await page.locator('#qt_docNo').fill('LOCAL-635');
  }
  const opening = await page.evaluate(() => window.__ledger);
  if (mode === 'new') expect(opening).toEqual([]);
  else {
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ m: 'GET' });
    expect(opening[0].url).toContain('/quotation_items?quotation_id=eq.' + SAVED_ID);
  }
  await page.evaluate(() => {
    window.__openingLedger = JSON.parse(JSON.stringify(window.__ledger));
    window.__nodes = new Map();
    for (const input of document.querySelectorAll('#page-quotations input, #page-quotations textarea, #page-quotations select')) {
      if (input.id) window.__nodes.set('#' + input.id, input);
      if (input.classList.contains('qt-li-name') || input.classList.contains('qt-li-qty')
        || input.classList.contains('qt-li-unit') || input.classList.contains('qt-li-price')
        || input.classList.contains('qt-li-disc') || input.classList.contains('qt-li-heading-name')) {
        window.__nodes.set('.' + input.classList[0], input);
      }
    }
  });
  return clean;
}

async function stableActive(page, selector, caret) {
  const state = await page.evaluate((sel) => {
    const original = window.__nodes.get(sel);
    const current = document.querySelector(sel);
    return {
      same: original === current, connected: !!original?.isConnected,
      focused: document.activeElement === original,
      value: current?.value, caret: current?.selectionStart, end: current?.selectionEnd,
    };
  }, selector);
  expect(state.same, selector + ': node identity must not change').toBe(true);
  expect(state.connected, selector + ': input must stay mounted').toBe(true);
  expect(state.focused, selector + ': focus must not move to BODY').toBe(true);
  if (caret !== undefined) {
    expect(state.caret).toBe(caret);
    expect(state.end).toBe(caret);
  }
  return state;
}

// The only focus operation for an observed typing segment.
async function startTyping(page, selector) {
  await page.locator(selector).focus();
  await page.keyboard.press('Control+A');
  await stableActive(page, selector);
}

async function typeFocused(page, selector, value, textCaret = false) {
  for (let i = 0; i < value.length; i++) {
    await page.keyboard.type(value[i]);
    await stableActive(page, selector, textCaret ? i + 1 : undefined);
  }
  await expect(page.locator(selector)).toHaveValue(value);
}

async function totals(page, subtotal, discountPct = 0, whtPct = 0, wht = false) {
  const discount = subtotal * discountPct / 100;
  const after = subtotal - discount;
  const withholding = wht ? after * whtPct / 100 : 0;
  await expect(page.locator('#qtSubtotal')).toHaveText(fmt(subtotal));
  await expect(page.locator('#qtDiscountAmount')).toHaveText('-' + fmt(discount));
  await expect(page.locator('#qtAfterDiscount')).toHaveText(fmt(after));
  await expect(page.locator('#qtWhtAmount')).toHaveText('-' + fmt(withholding));
  await expect(page.locator('#qtGrandTotal')).toHaveText(cash(after - withholding));
}

async function saveAndRead(page, mode) {
  await expectNoDraftSideEffects(page);
  await page.locator('#qtSaveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__ledger.some((e) => e.m === 'RELOAD'))).toBe(true);
  const ledger = await page.evaluate(() => window.__ledger.slice(window.__openingLedger.length));
  const writes = ledger.filter((e) => ['POST', 'PATCH', 'DELETE', 'PUT'].includes(e.m));
  const header = writes.filter((e) => e.args[0] === 'quotations');
  expect(header).toHaveLength(1);
  expect(header[0].m).toBe(mode === 'new' ? 'POST' : 'PATCH');
  expect(writes.map((e) => e.m + ' ' + e.args[0])).toEqual(mode === 'new'
    ? ['POST quotations', 'POST quotation_items', 'POST quotation_items']
    : ['PATCH quotations', 'DELETE quotation_items', 'POST quotation_items', 'POST quotation_items']);
  const rows = writes.filter((e) => e.m === 'POST' && e.args[0] === 'quotation_items').map((e) => e.args[1]);
  expect(rows[0]).toMatchObject({ item_type: 'heading', qty: 0, unit_price: 0, line_total: 0 });
  expect(ledger.filter((e) => ['GET', 'STATE', 'RAW_XHR', 'BEACON', 'CONFIRM', 'SHARE'].includes(e.m))).toEqual([]);
  return { header: header[0].args[1], item: rows[1] };
}

async function draftRoundtrip(page, subtotal, discountPct, whtPct = 0, wht = false, back = '#qtPreviewBack') {
  await page.locator('#qtPreviewBtn').click();
  await expect(page.locator('#qtDocPreview')).toBeVisible();
  for (const id of ['qtShareLinkBtn', 'qtShareBtn', 'qtPrintBtn', 'qtPdfBtn', 'qtEditDate', 'qtConvertBtn']) {
    await expect(page.locator('#' + id)).toHaveCount(0);
  }
  const expected = subtotal * (1 - discountPct / 100) * (wht ? 1 - whtPct / 100 : 1);
  await expect(page.locator('.doc-total-row.grand')).toContainText(fmt(expected) + ' บาท');
  await expectNoDraftSideEffects(page);
  await page.locator(back).click();
  await totals(page, subtotal, discountPct, whtPct, wht);
  await expectNoDraftSideEffects(page);
}

for (const [size, viewport] of [['desktop1280', { width: 1280, height: 800 }], ['mobile390', { width: 390, height: 844 }]]) {
  for (const mode of ['new', 'saved']) {
    test.describe('Phase 635 ' + size + ' ' + mode, () => {
      for (const value of ['10', '20', '12.5']) {
        test('sequential document discount ' + value + ' preserves identity/focus and saves intended amount', async ({ page }) => {
          const clean = await openForm(page, viewport, mode);
          await startTyping(page, '#qt_discPct');
          await typeFocused(page, '#qt_discPct', value);
          await totals(page, 3000, Number(value));
          await expectNoDraftSideEffects(page);
          if (mode === 'new') {
            await draftRoundtrip(page, 3000, Number(value));
            await draftRoundtrip(page, 3000, Number(value), 0, false, '#qtEditFromPreview');
          }
          const result = await saveAndRead(page, mode);
          expect(result.header).toMatchObject({
            discount_pct: Number(value), discount_amount: 3000 * Number(value) / 100,
            total_amount: 3000, grand_total: 3000 * (1 - Number(value) / 100),
          });
          await clean();
        });
      }

      test('dirty name Tab qty Tab unit Tab price Tab row-discount: no locator refocus', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '.qt-li-name');
        // Control: unchanged name followed by Tab must also work.
        await page.keyboard.press('End');
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-qty');
        await page.keyboard.press('Shift+Tab');
        await stableActive(page, '.qt-li-name');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-name', 'Keyboard item 635', true);
        for (const [selector, value, textCaret] of [
          ['.qt-li-qty', '12.5', false], ['.qt-li-unit', 'boxes', true],
          ['.qt-li-price', '200', false], ['.qt-li-disc', '20', false],
        ]) {
          await page.keyboard.press('Tab');
          await stableActive(page, selector);
          await page.keyboard.press('Control+A');
          await typeFocused(page, selector, value, textCaret);
        }
        await page.keyboard.press('Tab'); // commit row-discount without clicking another control
        await expect(page.locator('.qt-li-total')).toHaveText('2,000.00');
        await totals(page, 2000);
        await expectNoDraftSideEffects(page);
        if (mode === 'new') await draftRoundtrip(page, 2000, 0);
        await page.screenshot({ path: test.info().outputPath('keyboard-totals-' + size + '-' + mode + '.png'), fullPage: true });
        const result = await saveAndRead(page, mode);
        expect(result.item).toMatchObject({ item_name: 'Keyboard item 635', qty: 12.5, unit: 'boxes', unit_price: 200, discount_pct: 20, line_total: 2000 });
        expect(result.header).toMatchObject({ total_amount: 2000, grand_total: 2000 });
        await clean();
      });

      test('heading dirty change keeps node and native Tab destination; heading never contributes money', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '.qt-li-heading-name');
        // Learn the native destination from unchanged control (no CSS/tabindex guess).
        await page.keyboard.press('End');
        await page.keyboard.press('Tab');
        await page.evaluate(() => { window.__headingNext = document.activeElement; });
        await page.keyboard.press('Shift+Tab');
        await stableActive(page, '.qt-li-heading-name');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-heading-name', 'Heading changed 635', true);
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement === window.__headingNext && window.__headingNext.isConnected)).toBe(true);
        expect(await page.evaluate(() => document.querySelector('.qt-li-heading-name') === window.__nodes.get('.qt-li-heading-name'))).toBe(true);
        await totals(page, 3000);
        const result = await saveAndRead(page, mode);
        expect(result.header.total_amount).toBe(3000);
        const heading = await page.evaluate(() => window.__ledger.find((e) => e.m === 'POST' && e.args[0] === 'quotation_items').args[1]);
        expect(heading).toMatchObject({ item_name: 'Heading changed 635', item_type: 'heading', qty: 0, unit_price: 0, discount_pct: 0, line_total: 0 });
        await clean();
      });

      test('typed malicious item/heading text stays escaped across structural render and preview', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        const malicious = '"><img data-phase635 src=x onerror=window.__xss++>';
        await startTyping(page, '.qt-li-heading-name');
        await typeFocused(page, '.qt-li-heading-name', 'Heading ' + malicious, true);
        await page.keyboard.press('Tab');
        await startTyping(page, '.qt-li-name');
        await typeFocused(page, '.qt-li-name', 'Item ' + malicious, true);
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-qty');
        await page.locator('#qtAddHeadingBtn').click();
        await page.locator('.qt-li-del[data-idx="2"]').click();
        await expect(page.locator('.qt-li-heading-name')).toHaveValue('Heading ' + malicious);
        await expect(page.locator('.qt-li-name')).toHaveValue('Item ' + malicious);
        await expect(page.locator('[data-phase635]')).toHaveCount(0);
        if (mode === 'new') await draftRoundtrip(page, 3000, 0);
        expect(await page.evaluate(() => window.__xss)).toBe(0);
        const result = await saveAndRead(page, mode);
        expect(result.item.item_name).toBe('Item ' + malicious);
        expect(result.header.grand_total).toBe(3000);
        const heading = await page.evaluate(() => window.__ledger.find((entry) => entry.m === 'POST' && entry.args[0] === 'quotation_items').args[1]);
        expect(heading).toMatchObject({ item_name: 'Heading ' + malicious, item_type: 'heading', line_total: 0 });
        await clean();
      });

      for (const value of ['10', '12.5', '0']) {
        test('enabled WHT sequential ' + value + ' retains input and payload including explicit zero', async ({ page }) => {
          const clean = await openForm(page, viewport, mode);
          await page.locator('#qt_wht').check();
          await startTyping(page, '#qt_whtPct');
          await typeFocused(page, '#qt_whtPct', value);
          await totals(page, 3000, 0, Number(value), true);
          if (mode === 'new') await draftRoundtrip(page, 3000, 0, Number(value), true);
          const result = await saveAndRead(page, mode);
          expect(result.header).toMatchObject({ withholding_tax: true, wht_pct: Number(value), wht_amount: 3000 * Number(value) / 100, grand_total: 3000 * (1 - Number(value) / 100) });
          await clean();
        });
      }

      test('blank, zero, temporary decimal, caret navigation, Backspace/Delete recover without refocus', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '#qt_discPct');
        await page.keyboard.press('Backspace');
        await stableActive(page, '#qt_discPct');
        await expect(page.locator('#qt_discPct')).toHaveValue('');
        await totals(page, 3000);
        await typeFocused(page, '#qt_discPct', '0');
        await totals(page, 3000);
        await page.keyboard.press('Control+A');
        await page.keyboard.type('.');
        await stableActive(page, '#qt_discPct');
        // type=number may expose "" for "." (badInput); focus/node must survive.
        await page.keyboard.type('5');
        await stableActive(page, '#qt_discPct');
        expect(Number(await page.locator('#qt_discPct').inputValue())).toBe(0.5);
        await totals(page, 3000, 0.5);
        await page.keyboard.press('Control+A');
        await typeFocused(page, '#qt_discPct', '12.5');
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await stableActive(page, '#qt_discPct');
        await expect(page.locator('#qt_discPct')).toHaveValue('2.5');
        await page.keyboard.press('End');
        await page.keyboard.press('Backspace');
        await stableActive(page, '#qt_discPct');
        await page.keyboard.type('5');
        await stableActive(page, '#qt_discPct');
        await expect(page.locator('#qt_discPct')).toHaveValue('2.5');
        await totals(page, 3000, 2.5);
        await expectNoDraftSideEffects(page);
        await clean();
      });

      test('100 percent document discount stays zero through explicit Save', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '#qt_discPct');
        await typeFocused(page, '#qt_discPct', '100');
        await totals(page, 3000, 100);
        if (mode === 'new') await draftRoundtrip(page, 3000, 100);
        const result = await saveAndRead(page, mode);
        expect(result.header).toMatchObject({ total_amount: 3000, discount_pct: 100, discount_amount: 3000, after_discount: 0, grand_total: 0, amount: 0 });
        await clean();
      });

      test('zero/blank row numbers preserve typing focus and existing normalization at commit', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '.qt-li-qty');
        await typeFocused(page, '.qt-li-qty', '0');
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-unit');
        await expect(page.locator('.qt-li-qty')).toHaveValue('0');
        await expect(page.locator('.qt-li-total')).toHaveText('0.00');
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-price');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await stableActive(page, '.qt-li-price');
        await expect(page.locator('.qt-li-price')).toHaveValue('');
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-disc');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-disc', '0');
        await page.keyboard.press('Tab');
        await totals(page, 0);
        const result = await saveAndRead(page, mode);
        expect(result.item).toMatchObject({ qty: 0, unit_price: 0, discount_pct: 0, line_total: 0 });
        await clean();
      });


      test('WHT off/on cycles retain percentage; blank commits to baseline-render zero before preview/Save', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await expect(page.locator('#qt_whtPct')).toBeDisabled();
        await page.locator('#qt_wht').check();
        await expect(page.locator('#qt_whtPct')).toBeEnabled();
        await startTyping(page, '#qt_whtPct');
        await typeFocused(page, '#qt_whtPct', '12.5');
        await page.keyboard.press('Tab');
        await totals(page, 3000, 0, 12.5, true);
        await page.locator('#qt_wht').uncheck();
        await expect(page.locator('#qt_whtPct')).toBeDisabled();
        await expect(page.locator('#qt_whtPct')).toHaveValue('12.5');
        await totals(page, 3000);
        await page.locator('#qt_wht').check();
        await expect(page.locator('#qt_whtPct')).toBeEnabled();
        await expect(page.locator('#qt_whtPct')).toHaveValue('12.5');
        await totals(page, 3000, 0, 12.5, true);
        await startTyping(page, '#qt_whtPct');
        await page.keyboard.press('Backspace');
        await stableActive(page, '#qt_whtPct');
        await expect(page.locator('#qt_whtPct')).toHaveValue('');
        await page.keyboard.press('Tab');
        // Before 635, the full render normalized blank to "0". Save's ||3
        // fallback is NOT reached after that render. Preserve this end result.
        await expect(page.locator('#qt_whtPct')).toHaveValue('0');
        await totals(page, 3000, 0, 0, true);
        if (mode === 'new') await draftRoundtrip(page, 3000, 0, 0, true);
        const result = await saveAndRead(page, mode);
        expect(result.header).toMatchObject({ withholding_tax: true, wht_pct: 0, wht_amount: 0, grand_total: 3000 });
        await clean();
      });

      test('structural add/reorder/delete reindexes rows; next dirty Tab edits correct current row', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await page.locator('#qtAddItemBtn').click();
        await page.locator('#qtAddCustomItem').click();
        await expect(page.locator('#qtLineItemsBody tr')).toHaveCount(3);
        await page.locator('.qt-li-up[data-idx="2"]').click();
        await expect(page.locator('.qt-li-name[data-idx="1"]')).toHaveValue('รายการใหม่');
        await expect(page.locator('.qt-li-name[data-idx="2"]')).toHaveValue('Synthetic item');
        await page.locator('.qt-li-del[data-idx="1"]').click();
        await expect(page.locator('#qtLineItemsBody tr')).toHaveCount(2);
        await expect(page.locator('.qt-li-name[data-idx="1"]')).toHaveValue('Synthetic item');
        await page.locator('.qt-li-down[data-idx="0"]').click(); // heading moves below item
        await expect(page.locator('.qt-li-name[data-idx="0"]')).toHaveValue('Synthetic item');
        await expect(page.locator('.qt-li-heading-name[data-idx="1"]')).toHaveValue('Synthetic heading');
        // Structural operations are allowed to render. Re-pin only AFTER those
        // operations and BEFORE the observed edit/Tab chain; no focus repair.
        await page.evaluate(() => {
          for (const cls of ['qt-li-name', 'qt-li-qty', 'qt-li-unit', 'qt-li-price', 'qt-li-disc']) {
            window.__nodes.set('.' + cls, document.querySelector('.' + cls));
          }
        });
        await startTyping(page, '.qt-li-name');
        await typeFocused(page, '.qt-li-name', 'Reindexed item 635', true);
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-qty');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-qty', '4');
        await page.keyboard.press('Shift+Tab');
        await stableActive(page, '.qt-li-name');
        await expect(page.locator('.qt-li-total[data-idx="0"]')).toHaveText('6,000.00');
        await totals(page, 6000);
        await expectNoDraftSideEffects(page);
        await page.locator('#qtSaveBtn').click();
        await expect.poll(() => page.evaluate(() => window.__ledger.some((e) => e.m === 'RELOAD'))).toBe(true);
        const rows = await page.evaluate(() => window.__ledger.filter((e) => e.m === 'POST' && e.args[0] === 'quotation_items').map((e) => e.args[1]));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ item_type: 'item', item_name: 'Reindexed item 635', qty: 4, line_total: 6000, sort_order: 1 });
        expect(rows[1]).toMatchObject({ item_type: 'heading', item_name: 'Synthetic heading', line_total: 0, sort_order: 2 });
        await clean();
      });

      if (mode === 'new') test('preview/back then edit uses current cloned item state, not captured pre-preview objects', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '.qt-li-name');
        await typeFocused(page, '.qt-li-name', 'Round one', true);
        await draftRoundtrip(page, 3000, 0);
        await startTyping(page, '.qt-li-name');
        await typeFocused(page, '.qt-li-name', 'Round two', true);
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-qty');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-qty', '4');
        await draftRoundtrip(page, 6000, 0, 0, false, '#qtEditFromPreview');
        await startTyping(page, '.qt-li-price');
        await typeFocused(page, '.qt-li-price', '2000');
        await page.keyboard.press('Tab');
        await stableActive(page, '.qt-li-disc');
        await page.keyboard.press('Control+A');
        await typeFocused(page, '.qt-li-disc', '10');
        await page.keyboard.press('Tab');
        await totals(page, 7200);
        const result = await saveAndRead(page, mode);
        expect(result.item).toMatchObject({ item_name: 'Round two', qty: 4, unit_price: 2000, discount_pct: 10, line_total: 7200 });
        expect(result.header).toMatchObject({ total_amount: 7200, grand_total: 7200 });
        await clean();
      });


      for (const outcome of ['success', 'failure']) test('pending header freezes native edit/structural interactions; ' + outcome + ' preserves parity and restores controls', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await page.locator('#qtAddItemBtn').click();
        await page.locator('#qt_productSearch').fill('Synthetic product');
        await expect(page.locator('.qt-dd-item[data-pid="63542"]')).toBeVisible();
        // An already-disabled control must not be enabled by failure cleanup.
        await page.locator('#qt_note').evaluate((el) => { el.disabled = true; });
        const before = await page.evaluate(() => {
          window.__saveForm = document.querySelector('#page-quotations');
          window.__savePrice = document.querySelector('.qt-li-price');
          window.__saveControls = [...window.__saveForm.querySelectorAll('input,select,textarea,button')];
          return window.__saveControls.map((el) => ({ disabled: el.disabled, inert: el.inert }));
        });
        await expectNoDraftSideEffects(page);
        await page.evaluate(() => { window.__deferSave = true; });
        await page.locator('#qtSaveBtn').click();
        await expect.poll(() => page.evaluate(() => typeof window.__resolveSave)).toBe('function');
        await expect(page.locator('#qtSaveBtn')).toBeDisabled();
        // Native coordinate clicks exercise inert/disabled hit testing; no force
        // fill, programmatic value changes, or synthetic events in this path.
        for (const selector of ['.qt-li-price', '#qtAddHeadingBtn', '#qtAddItemBtn', '#qtAddCustomItem',
          '.qt-li-up[data-idx="1"]', '.qt-li-down[data-idx="0"]', '.qt-li-del[data-idx="1"]', '.qt-dd-item[data-pid="63542"]']) {
          const target = page.locator(selector);
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          expect(box, selector + ' still exists while pending').not.toBeNull();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          if (selector === '.qt-li-price') {
            await page.keyboard.press('Control+A');
            await page.keyboard.type('200');
          }
          await expect(page.locator('#qtLineItemsBody tr')).toHaveCount(2);
          await expect(page.locator('.qt-li-price')).toHaveValue('1500');
          await expect(page.locator('.qt-li-heading-name[data-idx="0"]')).toHaveValue('Synthetic heading');
        }
        await totals(page, 3000);
        const pending = await page.evaluate(() => window.__ledger.slice(window.__openingLedger.length));
        expect(pending).toHaveLength(1);
        expect(pending[0].m).toBe(mode === 'new' ? 'POST' : 'PATCH');
        expect(pending[0].args[1]).toMatchObject({ total_amount: 3000, grand_total: 3000 });
        await page.evaluate((success) => window.__resolveSave(success
          ? { ok: true, data: { id: 63599 } }
          : { ok: false, error: { message: 'Synthetic freeze failure' } }), outcome === 'success');
        if (outcome === 'failure') {
          await expect(page.locator('#qtSaveBtn')).toBeEnabled();
          await expect.poll(() => page.evaluate(() => window.__saveControls.map((el) => ({ disabled: el.disabled, inert: el.inert })))).toEqual(before);
          expect(await page.evaluate(() => document.querySelector('.qt-li-price') === window.__savePrice && window.__savePrice.isConnected)).toBe(true);
          expect(await page.evaluate(() => !!document.querySelector('.qt-li-price').closest('[inert]'))).toBe(false);
          expect(await page.evaluate(() => window.__toasts)).toContain('Synthetic freeze failure');
          expect(await page.evaluate(() => window.__ledger.slice(window.__openingLedger.length))).toEqual(pending);
          await startTyping(page, '.qt-li-price');
          await typeFocused(page, '.qt-li-price', '200');
          await page.keyboard.press('Tab');
          await stableActive(page, '.qt-li-disc');
          await totals(page, 400);
          await page.evaluate(() => { window.__deferSave = false; });
          await page.locator('#qtSaveBtn').click();
        }
        await expect.poll(() => page.evaluate(() => window.__ledger.some((entry) => entry.m === 'RELOAD'))).toBe(true);
        const writes = await page.evaluate(() => window.__ledger.filter((entry) => ['POST', 'PATCH', 'DELETE'].includes(entry.m)));
        const headers = writes.filter((entry) => entry.args[0] === 'quotations');
        expect(headers).toHaveLength(outcome === 'success' ? 1 : 2);
        const rows = writes.filter((entry) => entry.m === 'POST' && entry.args[0] === 'quotation_items').map((entry) => entry.args[1]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ item_type: 'heading', line_total: 0 });
        expect(rows[1]).toMatchObject({ item_name: 'Synthetic item', qty: 2, unit_price: outcome === 'success' ? 1500 : 200 });
        expect(rows.reduce((sum, row) => sum + row.line_total, 0)).toBe(headers.at(-1).args[1].total_amount);
        expect(headers.at(-1).args[1].grand_total).toBe(outcome === 'success' ? 3000 : 400);
        await clean();
      });

      test('double Save while header pending sends one mocked header; failed header keeps edits retryable', async ({ page }) => {
        const clean = await openForm(page, viewport, mode);
        await startTyping(page, '#qt_discPct');
        await typeFocused(page, '#qt_discPct', '20');
        await totals(page, 3000, 20);
        await expectNoDraftSideEffects(page);
        await page.evaluate(() => { window.__deferSave = true; });
        await page.locator('#qtSaveBtn').dblclick();
        await expect.poll(() => page.evaluate(() => typeof window.__resolveSave)).toBe('function');
        await expect(page.locator('#qtSaveBtn')).toBeDisabled();
        const pending = await page.evaluate(() => window.__ledger.slice(window.__openingLedger.length));
        expect(pending).toHaveLength(1);
        expect(pending[0].m).toBe(mode === 'new' ? 'POST' : 'PATCH');
        expect(pending[0].args[0]).toBe('quotations');
        await page.evaluate(() => window.__resolveSave({ ok: false, error: { message: 'Synthetic failed header' } }));
        await expect(page.locator('#qtSaveBtn')).toBeEnabled();
        await expect(page.locator('#qt_discPct')).toHaveValue('20');
        await totals(page, 3000, 20);
        expect(await page.evaluate(() => window.__ledger.slice(window.__openingLedger.length))).toEqual(pending);
        expect(await page.evaluate(() => window.__toasts)).toContain('Synthetic failed header');
        await clean();
      });
    });
  }
}
