// F1 only: real quotations module + real UI clicks, synthetic local data.
// SW blocked, cross-origin requests aborted, fetch/XHR writes captured, never sent.
// PHASE634_BASELINE=1 serves the pinned pre-fix quotations.js from Git in memory;
// it does not revert/copy over concurrent runtime edits. Run focused RED with
// --grep "focused F1". Default mode always tests the current working runtime.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'block' });
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'ffe230a8a99b75162193bc6b3671e0310991e75b';
const baselineSource = process.env.PHASE634_BASELINE === '1'
  ? execFileSync('git', ['show', `${BASE}:modules/quotations.js`], { cwd: ROOT, encoding: 'utf8' }) : null;
let routedSource = baselineSource;
if (process.env.PHASE634_MUTANT) {
  if (baselineSource !== null) throw new Error('Choose baseline OR mutation, not both');
  const source = readFileSync(new URL('../../modules/quotations.js', import.meta.url), 'utf8');
  const mutation = process.env.PHASE634_MUTANT;
  if (mutation === 'dispatch') {
    const needle = 'if (!_editingId) { openDraftPreview(container); return; }';
    if (source.split(needle).length !== 2) throw new Error('Mutation dispatch target drifted');
    routedSource = source.replace(needle, '/* mutant: missing draft dispatch */');
  } else if (mutation === 'back') {
    const needle = 'if (isDraft) { restoreDraftForm(container); return; }';
    const start = source.indexOf('document.getElementById("qtPreviewBack")?.addEventListener');
    const target = source.indexOf(needle, start);
    if (start < 0 || target < 0 || target - start > 200) throw new Error('Mutation back target drifted');
    routedSource = source.slice(0, target) + '/* mutant: back falls through to list */' + source.slice(target + needle.length);
  } else if (mutation === 'totals') {
    const start = source.indexOf('  // Dirty numeric inputs can reach preview');
    const end = source.indexOf('\n}', start);
    if (start < 0 || end < start || end - start > 1500) throw new Error('Mutation totals target drifted');
    routedSource = source.slice(0, start) + '  // mutant: leave retained DOM amounts stale' + source.slice(end);
  } else throw new Error(`Unknown mutation: ${mutation}`);
}
const URL_PATH = '/__phase634__/fixture.html';
const HTML = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/doc-print.css">
  <link rel="stylesheet" href="/phase4-design-system.css"><link rel="stylesheet" href="/phase4-components.css">
  <title>F1 synthetic fixture</title></head><body><div id="page-quotations"></div></body></html>`;
const SAVED_ID = 63401;
const SAVED_ROWS = [
  { product_id: null, item_name: 'Saved heading', item_type: 'heading', qty: 0, unit: '', unit_price: 0, discount_pct: 0, line_total: 0, sort_order: 1 },
  { product_id: null, item_name: 'Saved synthetic item', item_type: 'item', qty: 2, unit: 'ชุด', unit_price: 1250, discount_pct: 0, line_total: 2500, sort_order: 2 },
];
const FIELDS = {
  qt_customerSearch: 'ลูกค้าจำลอง F1', qt_customerPhone: '0800000634', qt_customerTaxId: '0000000000634',
  qt_customerAddress: 'ที่อยู่จำลอง 634\nกรุงเทพฯ', qt_docNo: 'DRAFT-LOCAL-634', qt_date: '2026-09-28',
  qt_creditDays: '45', qt_project: 'Synthetic F1 project', qt_refNo: 'REF-634',
  qt_salesperson: 'พนักงานจำลอง', qt_note: 'หมายเหตุจำลอง\nบรรทัดที่สอง',
};
const UNSAFE_DRAFT_CONTROLS = [
  '#qtShareLinkBtn', '#qtEditDate', '#qtConvertBtn', '#qtConvertFromForm',
  '#qtPrintBtn', '#qtPdfBtn', '#qtShareBtn',
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
      if (m === 'POST' && args[0] === 'quotations' && window.__deferSave) {
        return new Promise((resolve) => { window.__resolveSave = resolve; });
      }
      return { ok: true, data: { id: 63499, inv_no: 'INV-SYNTHETIC-634' } };
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
    id: savedId, qt_no: 'QT-SAVED-634', status: 'approved', created_at: '2026-09-20T00:00:00.000Z',
    customer_name: 'Saved synthetic customer', customer_phone: '0800000000',
    total_amount: 2500, grand_total: 2500, amount: 2500, after_discount: 2500,
    discount_pct: 0, discount_amount: 0, withholding_tax: false, wht_pct: 3, wht_amount: 0,
    payment_terms: 'เงินสด', credit_days: 0, salesperson: 'Synthetic sales',
  };
  const state = {
    profile: { role: 'admin', full_name: 'Synthetic sales' }, storeInfo: { name: 'Synthetic store' },
    customers: [], products: [], paymentInfo: { banks: [{ coaCode: '1102-634', bankName: 'Synthetic Bank', bankAccount: '000-634' }] },
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
  if (routedSource !== null) {
    await page.route('**/modules/quotations.js', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: routedSource }));
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
  expect(result.ledger, 'draft cycle: no fetch/write/RPC/number allocation/state insertion/reload/share').toEqual([]);
  expect(result.current).toBe(result.initial);
}

async function formSnapshot(page) {
  return page.locator('#page-quotations').evaluate((root) => ({
    fields: Array.from(root.querySelectorAll('input[id^="qt_"],textarea[id^="qt_"],select[id^="qt_"]'))
      .filter((input) => !['qt_productSearch'].includes(input.id))
      .map((input) => [input.id, input.type === 'checkbox' ? input.checked : input.value]),
    rows: Array.from(root.querySelectorAll('#qtLineItemsBody tr.qt-item-row,#qtLineItemsBody tr.qt-heading-row'))
      .map((row) => ({ type: row.className, inputs: Array.from(row.querySelectorAll('input')).map((input) => [input.className, input.value]), total: row.classList.contains('qt-item-row') ? row.cells[6].textContent : '' })),
    totals: Array.from(root.querySelectorAll('.panel')).find((panel) => panel.querySelector('h4')?.textContent === 'สรุปยอด')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
}

async function fillHeader(page) {
  for (const [id, value] of Object.entries(FIELDS)) await page.locator(`#${id}`).fill(value);
  await page.locator('#qt_payTerms').selectOption('เครดิต');
  await page.locator('#qt_bankCoa').selectOption('1102-634');
  await page.locator('#qt_status').selectOption('approved');
}

async function addRows(page, zero = false) {
  await page.locator('#qtAddHeadingBtn').click();
  await page.locator('.qt-li-heading-name').fill('หมวดจำลอง F1');
  await page.locator('.qt-li-heading-name').press('Tab');
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  for (const [selector, value] of Object.entries({
    '.qt-li-name': 'สินค้าจำลอง F1', '.qt-li-unit': 'ชุด', '.qt-li-qty': '2',
    '.qt-li-price': zero ? '0' : '1250', '.qt-li-disc': zero ? '0' : '10',
  })) {
    await page.locator(selector).fill(value);
    // Explicitly finish each setup edit, as in Phase 630. This is not an F2
    // inline-rerender acceptance scenario; assertions below cover preview/back.
    await page.locator(selector).dispatchEvent('change');
  }
}

async function preview(page, checkNoSideEffects = true, key = null) {
  if (key) await page.locator('#qtPreviewBtn').press(key);
  else await page.locator('#qtPreviewBtn').click();
  await expect(page.locator('#qtDocPreview'), 'F1 must show draft, not return to list').toBeVisible();
  for (const selector of UNSAFE_DRAFT_CONTROLS) await expect(page.locator(selector), `draft excludes ${selector}`).toHaveCount(0);
  if (checkNoSideEffects) await expectNoDraftSideEffects(page);
}

for (const [label, viewport] of [['desktop1280', { width: 1280, height: 800 }], ['mobile390', { width: 390, height: 844 }]]) {
  test.describe(`Phase 634 ${label}`, () => {
    test('focused F1: unsaved header survives preview and back', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await fillHeader(page);
      const before = await formSnapshot(page);
      await preview(page);
      await expect(page.locator('#qtDocPreview')).toContainText(FIELDS.qt_customerSearch);
      await page.locator('#qtPreviewBack').click();
      await expect(page.locator('#qtSaveBtn')).toBeVisible();
      expect(await formSnapshot(page)).toEqual(before);
      await expectNoDraftSideEffects(page);
      await clean();
    });

    test('valued heading/item + all header fields/totals survive repeated preview; immediate input is current', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await addRows(page);
      await fillHeader(page);
      await page.locator('#qt_discPct').fill('5');
      await page.locator('#qt_wht').check();
      await page.locator('#qt_whtPct').fill('3');
      const before = await formSnapshot(page);
      await preview(page);
      const doc = page.locator('#qtDocPreview');
      for (const value of [FIELDS.qt_customerSearch, FIELDS.qt_customerPhone, FIELDS.qt_customerTaxId,
        FIELDS.qt_salesperson, 'หมวดจำลอง F1', 'สินค้าจำลอง F1', 'ชุด']) await expect(doc).toContainText(value);
      await expect(doc.locator('.doc-heading-row')).toHaveCount(1);
      await expect(doc.locator('.doc-item-row')).toHaveCount(1);
      await expect(doc.locator('.doc-total-row.grand')).toContainText('2,073.38');
      await page.screenshot({ path: test.info().outputPath(`${label}-draft-preview.png`), fullPage: true });
      await page.locator('#qtPreviewBack').click();
      expect(await formSnapshot(page)).toEqual(before);
      await page.screenshot({ path: test.info().outputPath(`${label}-restored-form.png`), fullPage: true });
      // No dispatched change / Tab after fill: click preview directly from input.
      await page.locator('#qt_customerSearch').fill('Immediate header 634');
      await preview(page);
      await expect(doc).toContainText('Immediate header 634');
      // Edit shares the retained-form contract, and restored listeners must work.
      await page.locator('#qtEditFromPreview').click();
      await expect(page.locator('#qt_customerSearch')).toHaveValue('Immediate header 634');
      // Required F1 entry edge: genuine active-input fill then one preview click.
      // Do not dispatch change, blur, patch the DOM, or retry the click here.
      await page.locator('.qt-li-name').fill('Immediate item 634');
      await preview(page);
      await expect(doc.locator('.doc-item-row')).toContainText('Immediate item 634');
      await page.locator('#qtPreviewBack').click();
      await expect(page.locator('.qt-li-name')).toHaveValue('Immediate item 634');
      await expectNoDraftSideEffects(page);
      await clean();
    });

    for (const kind of ['empty', 'zero-value']) {
      test(`${kind} draft remains recoverable with no allocation`, async ({ page }) => {
        const clean = await boot(page, viewport);
        await page.locator('#qtAddBtn').click();
        if (kind === 'zero-value') await addRows(page, true);
        const before = await formSnapshot(page);
        await preview(page);
        await expect(page.locator('.doc-total-row.grand')).toContainText('0.00');
        await page.locator('#qtShowDate').uncheck();
        await expect(page.locator('#qtDateCell')).toHaveText('..................................');
        await page.locator('#qtShowDate').check();
        await expect(page.locator('#qtDateCell')).not.toHaveText('..................................');
        await expectNoDraftSideEffects(page);
        await page.locator('#qtPreviewBack').click();
        expect(await formSnapshot(page)).toEqual(before);
        await expect(page.locator('#qt_docNo')).toHaveValue('');
        await expectNoDraftSideEffects(page);
        await clean();
      });
    }

    test('one preview-render failure retains the form and permits a clean retry', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await addRows(page);
      await fillHeader(page);
      const before = await formSnapshot(page);
      await page.evaluate(() => {
        const state = window.__ctx.state;
        const store = state.storeInfo;
        let once = true;
        Object.defineProperty(state, 'storeInfo', { configurable: true, get() {
          if (once) { once = false; throw new Error('Synthetic one-shot preview render failure'); }
          return store;
        } });
      });
      await page.locator('#qtPreviewBtn').click();
      await expect(page.locator('#qtSaveBtn')).toBeVisible();
      expect(await formSnapshot(page)).toEqual(before);
      expect(await page.evaluate(() => window.__toasts)).toHaveLength(1);
      await expectNoDraftSideEffects(page);
      await preview(page);
      await expect(page.locator('#qtDocPreview')).toContainText(FIELDS.qt_customerSearch);
      await page.locator('#qtPreviewBack').click();
      expect(await formSnapshot(page)).toEqual(before);
      await expectNoDraftSideEffects(page);
      await clean();
    });

    test('pending synthetic save refuses preview; failed save unlocks retained draft without another POST', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await addRows(page);
      await fillHeader(page);
      const before = await formSnapshot(page);
      await page.evaluate(() => { window.__deferSave = true; });
      await page.locator('#qtSaveBtn').click();
      await expect.poll(() => page.evaluate(() => typeof window.__resolveSave)).toBe('function');
      await expect(page.locator('#qtSaveBtn')).toBeDisabled();
      const posted = await page.evaluate(() => window.__ledger);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ m: 'POST', args: ['quotations', expect.any(Object), { returnData: true }] });
      const toastCount = await page.evaluate(() => window.__toasts.length);
      await page.locator('#qtPreviewBtn').click();
      await expect(page.locator('#qtDocPreview')).toHaveCount(0);
      await expect(page.locator('#qtSaveBtn')).toBeDisabled();
      expect(await formSnapshot(page)).toEqual(before);
      expect(await page.evaluate(() => window.__toasts.length)).toBeGreaterThan(toastCount);
      expect(await page.evaluate(() => window.__ledger)).toEqual(posted);
      await page.evaluate(() => window.__resolveSave({ ok: false, error: { message: 'Synthetic header failure' } }));
      await expect(page.locator('#qtSaveBtn')).toBeEnabled();
      expect(await formSnapshot(page)).toEqual(before);
      expect(await page.evaluate(() => window.__toasts)).toContain('Synthetic header failure');
      // Preserve the deliberate user-save ledger; preview/back may add nothing.
      await preview(page, false);
      await page.locator('#qtPreviewBack').click();
      await expect(page.locator('#qtSaveBtn')).toBeEnabled();
      expect(await formSnapshot(page)).toEqual(before);
      expect(await page.evaluate(() => window.__ledger)).toEqual(posted);
      expect(await page.evaluate(() => JSON.stringify([window.__ctx.state.quotations, window.__ctx.state.deliveryInvoices, window.__ctx.state.receipts]))).toBe(await page.evaluate(() => window.__persisted));
      await clean();
    });

    test('explicit synthetic Save after dirty qty/price preview/back matches refreshed row and summary totals', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await addRows(page);
      await fillHeader(page);
      for (const [selector, value, expectedTotal] of [
        ['.qt-li-name', 'Retained current item 634', '2,250.00'],
        ['.qt-li-unit', 'กล่อง', '2,250.00'],
        ['.qt-li-qty', '7', '7,875.00'],
        ['.qt-li-price', '2000.00', '12,600.00'],
      ]) {
        // No change/blur dispatch: price/qty are dirty when the single click fires.
        await page.locator(selector).fill(value);
        await preview(page);
        await expect(page.locator('.doc-item-row td').last()).toHaveText(expectedTotal);
        const netRow = page.locator('.doc-total-row').filter({ has: page.getByText('ยอดหลังส่วนลดรายสินค้า', { exact: true }) });
        await expect(netRow).toHaveCount(1);
        await expect(netRow).toContainText(`${expectedTotal} บาท`);
        await expect(page.locator('.doc-total-row.grand')).toContainText(`${expectedTotal} บาท`);
        await page.locator('#qtPreviewBack').click();
        await expect(page.locator(selector)).toHaveValue(value);
        // P2: retained controls alone are insufficient. Visible form totals must
        // match the just-rendered preview, not the pre-blur DOM's old amounts.
        await expect(page.locator('.qt-item-row td').nth(6)).toHaveText(expectedTotal);
        await expect(page.locator('#qtSubtotalLabel')).toHaveText('ยอดหลังส่วนลดรายสินค้า');
        await expect(page.locator('#qtSubtotal')).toHaveText(expectedTotal);
        await expect(page.getByText('หลังหักส่วนลด', { exact: true }).locator('..').locator('strong')).toHaveText(expectedTotal);
        await expect(page.getByText('รวมทั้งสิ้น', { exact: true }).locator('..').locator('strong').last()).toHaveText(`฿${expectedTotal}`);
        await expectNoDraftSideEffects(page);
      }
      await page.screenshot({ path: test.info().outputPath(`${label}-dirty-totals-restored.png`), fullPage: true });
      await expectNoDraftSideEffects(page);
      const controls = await page.locator('.qt-item-row').evaluate((row) => ({
        item_name: row.querySelector('.qt-li-name').value,
        unit: row.querySelector('.qt-li-unit').value,
        qty: Number(row.querySelector('.qt-li-qty').value),
        unit_price: Number(row.querySelector('.qt-li-price').value),
        discount_pct: Number(row.querySelector('.qt-li-disc').value),
      }));
      expect(controls).toEqual({ item_name: 'Retained current item 634', unit: 'กล่อง', qty: 7, unit_price: 2000, discount_pct: 10 });
      await page.locator('#qtSaveBtn').click();
      await expect.poll(() => page.evaluate(() => window.__ledger.some((event) => event.m === 'RELOAD'))).toBe(true);
      const writes = await page.evaluate(() => window.__ledger.filter((event) => event.m === 'POST').map((event) => event.args));
      expect(writes.map((args) => args[0])).toEqual(['quotations', 'quotation_items', 'quotation_items']);
      expect(writes[1][1]).toMatchObject({ item_type: 'heading', item_name: 'หมวดจำลอง F1', qty: 0 });
      expect(writes[2][1]).toMatchObject({ ...controls, item_type: 'item', line_total: 12600 });
      expect(writes[0][1]).toMatchObject({ total_amount: 12600, grand_total: 12600 });
      expect(await page.evaluate(() => window.__ledger.filter((event) => ['GET', 'PATCH', 'PUT', 'DELETE', 'STATE', 'RAW_XHR', 'BEACON'].includes(event.m)))).toEqual([]);
      await clean();
    });

    for (const key of ['Enter', 'Space']) {
      test(`keyboard ${key} activates draft preview and retains fields on return`, async ({ page }) => {
        const clean = await boot(page, viewport);
        await page.locator('#qtAddBtn').click();
        await addRows(page);
        await fillHeader(page);
        await page.locator('#qt_customerSearch').fill(`Keyboard ${key} customer`);
        const before = await formSnapshot(page);
        await preview(page, true, key);
        await expect(page.locator('#qtDocPreview')).toContainText(`Keyboard ${key} customer`);
        await expect(page.locator('.doc-total-row.grand')).toContainText('2,250.00');
        await page.locator('#qtPreviewBack').click();
        expect(await formSnapshot(page)).toEqual(before);
        await expectNoDraftSideEffects(page);
        await clean();
      });
    }

    test('malicious header, heading, item, unit remain escaped in draft and restored form', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('#qtAddBtn').click();
      await addRows(page);
      const payload = '"><img data-f1-xss src=x onerror="window.__xss++"><svg data-f1-xss onload="window.__xss++">';
      for (const selector of ['.qt-li-heading-name', '.qt-li-name', '.qt-li-unit']) {
        await page.locator(selector).fill(payload);
        await page.locator(selector).dispatchEvent('change');
      }
      for (const selector of ['#qt_customerSearch', '#qt_customerAddress', '#qt_salesperson', '#qt_note']) await page.locator(selector).fill(payload);
      await preview(page);
      await expect(page.locator('#qtDocPreview')).toContainText(payload);
      await expect(page.locator('.doc-heading-row')).toContainText(payload);
      await expect(page.locator('.doc-item-row td').nth(0)).toContainText(payload);
      await expect(page.locator('.doc-item-row td').nth(2)).toContainText(payload);
      await expect(page.locator('[data-f1-xss]')).toHaveCount(0);
      expect(await page.evaluate(() => window.__xss)).toBe(0);
      await page.locator('#qtPreviewBack').click();
      for (const selector of ['.qt-li-heading-name', '.qt-li-name', '.qt-li-unit', '#qt_customerSearch', '#qt_customerAddress', '#qt_salesperson', '#qt_note']) await expect(page.locator(selector)).toHaveValue(payload);
      await expect(page.locator('[data-f1-xss]')).toHaveCount(0);
      expect(await page.evaluate(() => window.__xss)).toBe(0);
      await expectNoDraftSideEffects(page);
      await clean();
    });

    test('saved QT retains preview/date/share/print/PDF and conversion controls and behavior', async ({ page }) => {
      const clean = await boot(page, viewport);
      await page.locator('.qt-view-btn').first().click();
      await expect(page.locator('#qtDocPreview')).toContainText('QT-SAVED-634');
      await expect(page.locator('#qtDocPreview')).toContainText('Saved synthetic item');
      for (const selector of UNSAFE_DRAFT_CONTROLS.filter((id) => id !== '#qtConvertFromForm')) await expect(page.locator(selector)).toBeVisible();
      await page.locator('#qtEditDate').fill('2026-09-21');
      await page.locator('#qtEditDate').dispatchEvent('change');
      await expect.poll(() => page.evaluate(() => window.__ledger.filter((event) => event.m === 'PATCH').length)).toBeGreaterThan(0);
      const patches = await page.evaluate(() => window.__ledger.filter((event) => event.m === 'PATCH'));
      expect(patches[0].args).toEqual(['quotations', { created_at: '2026-09-21T00:00:00.000Z' }, 'id', SAVED_ID]);
      await page.locator('#qtEditFromPreview').click();
      await expect(page.locator('#qtConvertFromForm')).toBeVisible();
      await expect(page.locator('#qtViewDocBtn')).toBeVisible();
      await page.locator('#qtViewDocBtn').click();
      await expect(page.locator('#qtConvertBtn')).toBeVisible();
      await page.locator('#qtConvertBtn').click();
      await expect.poll(() => page.evaluate(() => window.__ledger.some((event) => event.m === 'ROUTE' && event.route === 'delivery_invoices'))).toBe(true);
      const writes = await page.evaluate(() => window.__ledger.filter((event) => event.m === 'POST').map((event) => event.args));
      expect(writes.map((args) => args[0])).toEqual(['delivery_invoices', 'delivery_invoice_items', 'delivery_invoice_items']);
      expect(writes[1][1]).toMatchObject({ item_name: 'Saved heading', item_type: 'heading', line_total: 0 });
      expect(writes[2][1]).toMatchObject({ item_name: 'Saved synthetic item', item_type: 'item', line_total: 2500 });
      await clean();
    });
  });
}
