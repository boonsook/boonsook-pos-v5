// Real modules + print/PDF button routes, synthetic localhost data only.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'block' });
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'ef9378afc68df8505ccbab1c9e6446690bbd9245';
const FIXTURE = '/__phase636__/fixture.html';
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/doc-print.css">'
  + '</head><body><div id="page-quotations"></div><div id="page-delivery_invoices"></div><div id="page-receipts"></div></body></html>';

function fixture(headerDiscount) {
  const clone = value => JSON.parse(JSON.stringify(value));
  window.__writes = [];
  window.__rows = [
    { item_type: 'heading', item_name: 'เครื่องปรับอากาศ', qty: 0, unit_price: 0, line_total: 0, discount_pct: 0 },
    { item_type: 'item', item_name: 'แอร์ 36000 BTU พร้อมติดตั้ง <img src=x onerror="window.__xss=1">', qty: 1, unit: 'เครื่อง', unit_price: 45500, discount_pct: 10, line_total: 40950 },
    { item_type: 'item', item_name: 'ไม่มีส่วนลด', qty: 1, unit: 'ชุด', unit_price: 50, discount_pct: 0, line_total: 50 },
  ];
  window.SUPABASE_CONFIG = { url: 'https://fixture.invalid', anonKey: 'synthetic' };
  window._sbAccessToken = 'synthetic';
  const doc = { status: 'pending', customer_name: 'ลูกค้าจำลอง ไม่ใช่การขายจริง', created_at: '2026-09-28T00:00:00Z',
    total_amount: 41000, grand_total: headerDiscount ? 38950 : 41000, after_discount: headerDiscount ? 38950 : 41000,
    discount_pct: headerDiscount ? 5 : 0, discount_amount: headerDiscount ? 2050 : 0,
    withholding_tax: false, payment_terms: 'เงินสด' };
  const qt = { ...doc, id: 63601, qt_no: 'QT-SYNTHETIC-636' };
  const di = { ...doc, id: 63602, inv_no: 'INV-SYNTHETIC-636', quotation_id: qt.id };
  const rc = { ...doc, id: 63603, receipt_no: 'RC-SYNTHETIC-636', delivery_invoice_id: di.id };
  const reply = body => Promise.resolve({ ok: true, status: 200, json: async () => clone(body) });
  window.fetch = (url, init = {}) => {
    if (init.method && init.method !== 'GET') window.__writes.push({ url, method: init.method });
    const u = String(url);
    if (/_items\?/.test(u)) return reply(window.__rows);
    if (u.includes('/receipts?select=')) return reply([rc]);
    return reply([]);
  };
  for (const m of ['Post', 'Patch', 'Put', 'Delete']) window['_appXhr' + m] = async (...args) => {
    window.__writes.push({ m, args }); return { ok: false };
  };
  window._appGetLogo = () => '';
  window.App = { state: { profile: { role: 'admin' } }, showToast: () => {}, confirm: async () => false };
  window.__ctx = { state: { profile: { role: 'admin' }, storeInfo: { name: 'ร้านจำลอง' }, customers: [], products: [], paymentInfo: { banks: [] },
    quotations: [qt], deliveryInvoices: [di], receipts: [rc] },
    showToast: () => {}, showRoute: () => {}, loadAllData: async () => {} };
  window.__original = JSON.stringify([window.__ctx.state, window.__rows]);
  window.print = () => {};
}

async function boot(page, context, width, headerDiscount) {
  await page.setViewportSize({ width, height: 844 });
  const origin = new URL(test.info().project.use.baseURL).origin;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (process.env.PHASE636_BASELINE === '1' && url.pathname.startsWith('/modules/') && url.pathname.endsWith('.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: execFileSync('git', ['show', BASE + ':' + url.pathname.slice(1)], { cwd: ROOT, encoding: 'utf8' }) });
    }
    return route.continue();
  });
  await page.route('**' + FIXTURE, route => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.addInitScript(fixture, headerDiscount);
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    window.__qt = await import('/modules/quotations.js');
    window.__di = await import('/modules/delivery_invoices.js');
    window.__rc = await import('/modules/receipts.js');
    await import('/modules/doc-override.js');
  });
}

const docs = [
  ['qt', 'renderQuotationsPage', 'QT-SYNTHETIC-636', '#qtDocPreview', 1],
  ['di', 'renderDeliveryInvoicesPage', 'INV-SYNTHETIC-636', '#diDocPreview', 2],
  ['rc', 'renderReceiptsPage', 'RC-SYNTHETIC-636', '#rcDocPreview', 2],
];
for (const [kind, render, number, preview] of docs) test(`636 S1 ${kind}: inconsistent net hides annotation in preview/print/PDF without repairing amounts`, async ({ page, context }) => {
  await boot(page, context, 390, false);
  await page.evaluate(() => {
    window.__rows[1].line_total = 20000;
    for (const list of ['quotations', 'deliveryInvoices', 'receipts']) {
      Object.assign(window.__ctx.state[list][0], { total_amount: 20050, grand_total: 20050, after_discount: 20050 });
    }
    window.__original = JSON.stringify([window.__ctx.state, window.__rows]);
  });
  await page.evaluate(({ kind, render }) => window['__' + kind][render](window.__ctx), { kind, render });
  await page.getByRole('link', { name: number, exact: true }).click();
  await expect(page.locator(preview + ' .doc-line-discount')).toHaveCount(0);
  await expect(page.locator(preview + ' .doc-item-row').first()).toContainText('20,000.00');
  await expect(page.locator(preview + ' .doc-total-row.grand').first()).toContainText('20,050.00');
  for (const suffix of ['PrintBtn', 'PdfBtn']) {
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#' + kind + suffix).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator(preview + ' .doc-item-row').first()).toContainText('20,000.00');
    await expect(popup.locator(preview + ' .doc-total-row.grand').first()).toContainText('20,050.00');
    await expect(popup.locator(preview + ' .doc-line-discount')).toHaveCount(0);
    await popup.close();
  }
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([window.__ctx.state, window.__rows]) === window.__original)).toBe(true);
});

for (const width of [360, 390, 1280]) for (const [kind, render, number, preview, copies] of docs) {
  for (const headerDiscount of [false, true]) test(`636 ${kind} ${width} ${headerDiscount ? 'stacked' : 'example'}: preview/print/PDF same annotation, no double deduction or writes`, async ({ page, context }, info) => {
    await boot(page, context, width, headerDiscount);
    await page.evaluate(({ kind, render }) => window['__' + kind][render](window.__ctx), { kind, render });
    await page.getByRole('link', { name: number, exact: true }).click();
    const label = page.locator(preview + ' .doc-line-discount');
    await expect(label).toHaveCount(copies);
    for (const el of await label.all()) await expect(el).toHaveText('ส่วนลด 10% (4,550.00 บาท)');
    await expect(page.locator(preview + ' .doc-heading-row .doc-line-discount')).toHaveCount(0);
    await expect(page.locator(preview + ' .doc-item-row').nth(1).locator('.doc-line-discount')).toHaveCount(0);
    await expect(page.locator(preview + ' .doc-total-row.grand').first()).toContainText(headerDiscount ? '38,950.00' : '41,000.00');
    if (headerDiscount) await expect(page.locator(preview + ' .doc-totals').first()).toContainText('2,050.00');
    // printWhenReady adds .doc-fit wrappers/styles. Compare each document's
    // actual content, not the intentionally different page-fitting wrappers.
    const previewContent = await page.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML));
    await expect(page.locator(preview + ' .doc-item-row img')).toHaveCount(0);
    const bounds = await label.evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect(), p = el.closest('td').getBoundingClientRect();
      const css = getComputedStyle(el);
      return { inside: r.left >= p.left - 1 && r.right <= p.right + 1, height: r.height, wrap: css.whiteSpace, scroll: el.scrollWidth <= el.clientWidth + 1 };
    }));
    for (const b of bounds) { expect(b.inside).toBe(true); expect(b.height).toBeGreaterThan(0); expect(b.wrap).toBe('normal'); expect(b.scroll).toBe(true); }
    await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
    for (const suffix of ['PrintBtn', 'PdfBtn']) {
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#' + kind + suffix).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await expect(popup.locator(preview + ' .doc-line-discount')).toHaveCount(copies);
      expect(await popup.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML))).toEqual(previewContent);
      await popup.emulateMedia({ media: 'print' });
      for (const el of await popup.locator('.doc-line-discount').all()) {
        await expect(el).toHaveText('ส่วนลด 10% (4,550.00 บาท)');
        await expect(el).toHaveCSS('display', 'block');
        await expect(el).toHaveCSS('white-space', 'normal');
      }
      const pdf = await popup.pdf({ format: 'A4', printBackground: true, path: info.outputPath(suffix + '.pdf') });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await popup.screenshot({ path: info.outputPath(suffix + '.png'), fullPage: true });
      await popup.close();
    }
    expect(await page.evaluate(() => window.__writes)).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify([window.__ctx.state, window.__rows]) === window.__original)).toBe(true);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
}

for (const width of [360, 390, 1280]) test(`636 draft ${width}: item discount survives Preview/Back without save`, async ({ page, context }) => {
  await boot(page, context, width, false);
  await page.evaluate(() => window.__qt.renderQuotationsPage(window.__ctx));
  await page.locator('#qtAddBtn').click();
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  await page.locator('.qt-li-name').fill('แอร์จำลอง');
  await page.locator('.qt-li-price').fill('45500');
  await page.locator('.qt-li-disc').fill('10');
  await page.locator('#qtPreviewBtn').click();
  await expect(page.locator('#qtDocPreview .doc-line-discount')).toHaveText('ส่วนลด 10% (4,550.00 บาท)');
  await expect(page.locator('#qtDocPreview .doc-total-row.grand')).toContainText('40,950.00');
  await expect(page.locator('#qtPrintBtn')).toHaveCount(0);
  await page.locator('#qtEditFromPreview').click();
  await expect(page.locator('.qt-li-disc')).toHaveValue('10');
  await expect(page.locator('.qt-li-price')).toHaveValue('45500');
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
});
