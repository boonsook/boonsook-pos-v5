// Real modules + print/PDF button routes, synthetic localhost data only.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'block' });
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = '4e42905ecb7d9f1f8929148d765f917bd0b48fc5'; // Phase 636 merged; Phase 637 positive cases must be RED here.
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
    if (process.env.PHASE637_BASELINE === '1' && url.pathname.startsWith('/modules/') && url.pathname.endsWith('.js')) {
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
const money = value => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

async function expectSummary(root, copies, { gross, discount, label = 'ส่วนลดรายสินค้า 10%' }) {
  const summaries = root.locator('.doc-line-discount-summary');
  await expect(summaries).toHaveCount(copies);
  for (const summary of await summaries.all()) {
    const rows = summary.locator('.doc-total-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('span').first()).toHaveText('รวมราคาสินค้าก่อนส่วนลด');
    await expect(rows.nth(0).locator('span').last()).toHaveText(money(gross) + ' บาท');
    await expect(rows.nth(1).locator('span').first()).toHaveText(label);
    await expect(rows.nth(1).locator('span').last()).toHaveText('-' + money(discount) + ' บาท');
  }
}

async function expectDocument(page, preview, copies, { subtotal, grand = subtotal, summary = null, headerDiscount = 0, wht = 0 }) {
  const root = page.locator(preview);
  // Check the entire window, not just the first copy/table.
  await expect(page.locator('.doc-line-discount')).toHaveCount(0);
  await expect(root.locator('td .doc-line-discount-summary')).toHaveCount(0);
  await expect(root.locator('.doc-totals')).toHaveCount(copies);
  if (summary) {
    await expectSummary(root, copies, summary);
    expect(await root.locator('.doc-line-discount-summary').evaluateAll(els => els.every(el => !!el.closest('.doc-totals')))).toBe(true);
  } else {
    await expect(root.locator('.doc-line-discount-summary')).toHaveCount(0);
  }
  for (const totals of await root.locator('.doc-totals').all()) {
    const subtotalLabel = summary ? 'ยอดหลังส่วนลดรายสินค้า' : 'รวมเป็นเงิน';
    const subtotalRow = totals.locator('.doc-total-row').filter({ has: page.getByText(subtotalLabel, { exact: true }) });
    await expect(subtotalRow).toHaveCount(1);
    await expect(subtotalRow.locator('span').last()).toHaveText(money(subtotal) + ' บาท');
    await expect(totals.getByText(summary ? 'รวมเป็นเงิน' : 'ยอดหลังส่วนลดรายสินค้า', { exact: true })).toHaveCount(0);
    await expect(totals.locator('.grand')).toContainText(money(grand) + ' บาท');
    const labels = await totals.locator('.doc-total-row > span:first-child').allTextContents();
    expect(labels).toEqual([
      ...(summary ? ['รวมราคาสินค้าก่อนส่วนลด', summary.label || 'ส่วนลดรายสินค้า 10%'] : []),
      subtotalLabel, ...(headerDiscount ? ['ส่วนลดเพิ่มเติมท้ายบิล 5%'] : []), ...(wht ? ['หัก ณ ที่จ่าย 3%'] : []), 'จำนวนเงินรวมทั้งสิ้น',
    ]);
    if (headerDiscount) await expect(totals.locator('.doc-total-row').filter({ has: page.getByText('ส่วนลดเพิ่มเติมท้ายบิล 5%', { exact: true }) }).locator('span').last()).toHaveText('-' + money(headerDiscount) + ' บาท');
    if (wht) await expect(totals.locator('.doc-total-row').filter({ has: page.getByText('หัก ณ ที่จ่าย 3%', { exact: true }) }).locator('span').last()).toHaveText('-' + money(wht) + ' บาท');
  }
}

async function expectSummaryFits(root) {
  const bounds = await root.locator('.doc-line-discount-summary .doc-total-row').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    const p = (el.closest('.doc-totals') || el.closest('#qtLineDiscountSummary')).getBoundingClientRect();
    const spans = [...el.querySelectorAll('span')];
    const [label, amount] = spans.map(span => span.getBoundingClientRect());
    return { inside: r.left >= p.left - 1 && r.right <= p.right + 1, height: r.height,
      scroll: el.scrollWidth <= el.clientWidth + 1 && spans.every(span => span.scrollWidth <= span.clientWidth + 1),
      separated: label.right <= amount.left + 1 || label.bottom <= amount.top + 1 };
  }));
  expect(bounds.length).toBeGreaterThan(0);
  for (const b of bounds) { expect(b.inside).toBe(true); expect(b.height).toBeGreaterThan(0); expect(b.scroll).toBe(true); expect(b.separated).toBe(true); }
}

async function expectReadOnly(page) {
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([window.__ctx.state, window.__rows]) === window.__original)).toBe(true);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
}

async function expectDisplayRows(page, preview, expectedRows) {
  // Invalid raw values suppress the explanation, not the legacy numeric cells.
  for (const document of await page.locator(preview + ' .doc-page-inner').all()) {
    const rows = document.locator('.doc-item-row');
    await expect(rows).toHaveCount(expectedRows.length);
    for (const [index, [qty, price, net]] of expectedRows.entries()) {
      const cells = rows.nth(index).locator('td');
      await expect(cells.nth(1)).toHaveText(money(qty));
      await expect(cells.nth(3)).toHaveText(money(price));
      await expect(cells.nth(4)).toHaveText(money(net));
    }
  }
}

for (const [kind, render, number, preview, copies] of docs) test(`636 S1 ${kind}: inconsistent net hides breakdown in preview/print/PDF without repairing amounts`, async ({ page, context }) => {
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
  await expectDocument(page, preview, copies, { subtotal: 20050 });
  await expect(page.locator(preview + ' .doc-item-row').first()).toContainText('20,000.00');
  await expect(page.locator(preview + ' .doc-total-row.grand').first()).toContainText('20,050.00');
  for (const suffix of ['PrintBtn', 'PdfBtn']) {
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#' + kind + suffix).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator(preview + ' .doc-item-row').first()).toContainText('20,000.00');
    await expect(popup.locator(preview + ' .doc-total-row.grand').first()).toContainText('20,050.00');
    await expectDocument(popup, preview, copies, { subtotal: 20050 });
    await popup.close();
  }
  await expectReadOnly(page);
});

for (const width of [360, 390, 1280]) for (const [kind, render, number, preview, copies] of docs) {
  for (const headerDiscount of [false, true]) test(`636 ${kind} ${width} ${headerDiscount ? 'stacked' : 'example'}: preview/print/PDF same footer, no double deduction or writes`, async ({ page, context }, info) => {
    await boot(page, context, width, headerDiscount);
    await page.evaluate(({ kind, render }) => window['__' + kind][render](window.__ctx), { kind, render });
    await page.getByRole('link', { name: number, exact: true }).click();
    const expected = { subtotal: 41000, grand: headerDiscount ? 38950 : 41000,
      headerDiscount: headerDiscount ? 2050 : 0, summary: { gross: 45550, discount: 4550, label: 'ส่วนลดรายสินค้ารวม' } };
    await expectDocument(page, preview, copies, expected);
    const names = await page.evaluate(() => window.__rows.map(row => row.item_name));
    for (const document of await page.locator(preview + ' .doc-page-inner').all()) {
      await expect(document.locator('.doc-heading-row td')).toHaveText(names[0]);
      await expect(document.locator('.doc-item-row td:first-child')).toHaveText(names.slice(1));
    }
    await expect(page.locator(preview + ' .doc-total-row.grand').first()).toContainText(headerDiscount ? '38,950.00' : '41,000.00');
    if (headerDiscount) await expect(page.locator(preview + ' .doc-totals').first()).toContainText('2,050.00');
    // printWhenReady adds .doc-fit wrappers/styles. Compare each document's
    // actual content, not the intentionally different page-fitting wrappers.
    const previewContent = await page.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML));
    await expect(page.locator(preview + ' .doc-item-row img')).toHaveCount(0);
    await expectSummaryFits(page.locator(preview));
    await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
    for (const suffix of ['PrintBtn', 'PdfBtn']) {
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#' + kind + suffix).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await expectDocument(popup, preview, copies, expected);
      expect(await popup.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML))).toEqual(previewContent);
      await popup.emulateMedia({ media: 'print' });
      await expectSummaryFits(popup.locator(preview));
      await expect(popup.locator(preview + ' .doc-item-row img')).toHaveCount(0);
      expect(await popup.evaluate(() => window.__xss)).toBeUndefined();
      const pdf = await popup.pdf({ format: 'A4', printBackground: true, path: info.outputPath(suffix + '.pdf') });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await popup.screenshot({ path: info.outputPath(suffix + '.png'), fullPage: true });
      await popup.close();
    }
    await expectReadOnly(page);
  });
}

for (const width of [360, 390, 1280]) test(`636 draft ${width}: item discount survives Preview/Back without save`, async ({ page, context }, info) => {
  await boot(page, context, width, false);
  await page.evaluate(() => window.__qt.renderQuotationsPage(window.__ctx));
  await page.locator('#qtAddBtn').click();
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  await page.locator('.qt-li-name').fill('แอร์จำลอง');
  await page.locator('.qt-li-price').fill('45500');
  await page.locator('.qt-li-disc').fill('10');
  await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross: 45500, discount: 4550 });
  await expect(page.locator('#qtSubtotalLabel')).toHaveText('ยอดหลังส่วนลดรายสินค้า');
  await expectSummaryFits(page.locator('#page-quotations'));
  await page.screenshot({ path: info.outputPath('form-filled-draft.png'), fullPage: true });
  await page.locator('#qtPreviewBtn').click();
  await expectDocument(page, '#qtDocPreview', 1, { subtotal: 40950, summary: { gross: 45500, discount: 4550 } });
  await expect(page.locator('#qtDocPreview .doc-total-row.grand')).toContainText('40,950.00');
  await expect(page.locator('#qtPrintBtn')).toHaveCount(0);
  await page.locator('#qtEditFromPreview').click();
  await expect(page.locator('.qt-li-disc')).toHaveValue('10');
  await expect(page.locator('.qt-li-price')).toHaveValue('45500');
  await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross: 45500, discount: 4550 });
  await expect(page.locator('#qtSubtotalLabel')).toHaveText('ยอดหลังส่วนลดรายสินค้า');
  await expect(page.locator('#qtSubtotal')).toHaveText('40,950.00');
  await page.locator('.qt-li-disc').fill('20');
  await expect(page.locator('.qt-li-disc')).toBeFocused();
  await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross: 45500, discount: 9100, label: 'ส่วนลดรายสินค้า 20%' });
  await expect(page.locator('#qtSubtotalLabel')).toHaveText('ยอดหลังส่วนลดรายสินค้า');
  await expect(page.locator('#qtSubtotal')).toHaveText('36,400.00');
  await expect(page.locator('#qtGrandTotal')).toContainText('36,400.00');
  await expectSummaryFits(page.locator('#page-quotations'));
  await page.screenshot({ path: info.outputPath('form-after-back-edit.png'), fullPage: true });
  await expectReadOnly(page);
});

// Keep the original 24 cases above; these cover the bill-wide fail-closed contract.
const scenarios = [
  { name: 'single item plus heading retains exact percentage label', mode: 'single', subtotal: 40950, summary: { gross: 45500, discount: 4550 } },
  { name: 'single item percentage beyond two decimals uses aggregate label', mode: 'precise-rate', subtotal: 898.75,
    summary: { gross: 1000, discount: 101.25, label: 'ส่วนลดรายสินค้ารวม' } },
  { name: 'mixed rates', mode: 'mixed', subtotal: 40990, summary: { gross: 45550, discount: 4560, label: 'ส่วนลดรายสินค้ารวม' } },
  { name: 'two discounted items at the same rate still use aggregate label', mode: 'same-rate', subtotal: 40995, summary: { gross: 45550, discount: 4555, label: 'ส่วนลดรายสินค้ารวม' } },
  { name: '100 percent discount with a non-discounted row', mode: 'full', subtotal: 50, summary: { gross: 45550, discount: 45500, label: 'ส่วนลดรายสินค้ารวม' } },
  { name: 'heading monetary fields excluded', mode: 'heading', subtotal: 41000, summary: { gross: 45550, discount: 4550, label: 'ส่วนลดรายสินค้ารวม' } },
  { name: 'heading only', mode: 'heading-only', subtotal: 0 },
  { name: 'no discount', mode: 'none', subtotal: 45550 },
  { name: 'missing discount on discounted row', mode: 'missing-discount', subtotal: 41000 },
  // These values would look valid if a preview mapper invented missing 0/1 values.
  { name: 'missing qty cannot be defaulted to one', mode: 'missing-qty', subtotal: 41000 },
  { name: 'missing discount on otherwise valid nondiscounted row', mode: 'missing-other-discount', subtotal: 41000 },
  { name: 'missing unit price on otherwise valid free row', mode: 'missing-price', subtotal: 40950 },
  { name: 'missing net on a 100 percent row', mode: 'missing-net', subtotal: 50 },
  // Real loader regressions: null survives fixture JSON, but the legacy mapper
  // displays default 0/1. That fallback must never justify a discount summary.
  { name: 'raw null net on 100 percent row keeps zero display without breakdown', mode: 'null-net', subtotal: 50,
    displayRows: [[1, 45500, 0], [1, 50, 50]] },
  { name: 'raw null qty keeps one display without breakdown', mode: 'null-qty', subtotal: 41000,
    displayRows: [[1, 45500, 40950], [1, 50, 50]] },
  { name: 'raw null price on zero-net row suppresses other valid discount', mode: 'null-price', subtotal: 40950,
    displayRows: [[1, 45500, 40950], [1, 0, 0]] },
  { name: 'raw null pct on gross-net row suppresses other valid discount', mode: 'null-pct', subtotal: 41000,
    displayRows: [[1, 45500, 40950], [1, 50, 50]] },
  { name: 'raw null header with valid 100 percent row keeps zero subtotal without breakdown', mode: 'null-header', rawSubtotal: null, subtotal: 0,
    displayRows: [[1, 45500, 0]] },
  { name: 'raw numeric qty zero on 100 percent row keeps one display without breakdown', mode: 'zero-qty', subtotal: 0,
    displayRows: [[1, 45500, 0]] },
  { name: 'invalid second row suppresses whole breakdown', mode: 'invalid-other', subtotal: 41000 },
  { name: 'inconsistent second row suppresses whole breakdown', mode: 'inconsistent-other', subtotal: 40999 },
  { name: 'header net mismatch', mode: 'header-mismatch', subtotal: 41001 },
  { name: 'header discount and WHT remain separate and unchanged', mode: 'wht', subtotal: 41000, grand: 37781.5,
    headerDiscount: 2050, wht: 1168.5, summary: { gross: 45550, discount: 4550, label: 'ส่วนลดรายสินค้ารวม' } },
];

for (const scenario of scenarios) for (const [kind, render, number, preview, copies] of docs) {
  test(`637 ${kind}: ${scenario.name} in preview/print/PDF`, async ({ page, context }, info) => {
    await boot(page, context, 390, false);
    await page.evaluate(({ mode, subtotal, rawSubtotal = subtotal, grand = subtotal, headerDiscount = 0, wht = 0 }) => {
      const rows = window.__rows;
      switch (mode) {
        case 'single': window.__rows = rows.slice(0, 2); break;
        case 'precise-rate':
          Object.assign(rows[1], { unit_price: 1000, discount_pct: 10.125, line_total: 898.75 });
          window.__rows = rows.slice(0, 2); break;
        case 'mixed': Object.assign(rows[2], { discount_pct: 20, line_total: 40 }); break;
        case 'same-rate': Object.assign(rows[2], { discount_pct: 10, line_total: 45 }); break;
        case 'full': Object.assign(rows[1], { discount_pct: 100, line_total: 0 }); break;
        case 'heading': Object.assign(rows[0], { qty: 99, unit_price: 9999, discount_pct: 100, line_total: 1234 }); break;
        case 'heading-only': window.__rows = [rows[0]]; break;
        case 'none': Object.assign(rows[1], { discount_pct: 0, line_total: 45500 }); break;
        case 'missing-discount': delete rows[1].discount_pct; break;
        case 'missing-qty': delete rows[1].qty; break;
        case 'missing-other-discount': delete rows[2].discount_pct; break;
        case 'missing-price': Object.assign(rows[2], { line_total: 0 }); delete rows[2].unit_price; break;
        case 'missing-net': rows[1].discount_pct = 100; delete rows[1].line_total; break;
        case 'null-net': Object.assign(rows[1], { discount_pct: 100, line_total: null }); break;
        case 'null-qty': rows[1].qty = null; break;
        case 'null-price': Object.assign(rows[2], { unit_price: null, line_total: 0 }); break;
        case 'null-pct': rows[2].discount_pct = null; break;
        case 'null-header':
          Object.assign(rows[1], { discount_pct: 100, line_total: 0 });
          window.__rows = rows.slice(0, 2); break;
        case 'zero-qty':
          Object.assign(rows[1], { qty: 0, unit_price: 45500, discount_pct: 100, line_total: 0 });
          window.__rows = rows.slice(0, 2); break;
        case 'invalid-other': rows[2].discount_pct = 'not-a-number'; break;
        case 'inconsistent-other': rows[2].line_total = 49; break;
      }
      for (const list of ['quotations', 'deliveryInvoices', 'receipts']) {
        Object.assign(window.__ctx.state[list][0], { total_amount: rawSubtotal, grand_total: grand,
          after_discount: subtotal - headerDiscount, discount_pct: headerDiscount ? 5 : 0, discount_amount: headerDiscount,
          withholding_tax: !!wht, wht_pct: 3, wht_amount: wht });
      }
      window.__original = JSON.stringify([window.__ctx.state, window.__rows]);
    }, scenario);
    await page.evaluate(({ kind, render }) => window['__' + kind][render](window.__ctx), { kind, render });
    await page.getByRole('link', { name: number, exact: true }).click();
    await expectDocument(page, preview, copies, scenario);
    if (scenario.displayRows) await expectDisplayRows(page, preview, scenario.displayRows);
    const originalNames = await page.evaluate(() => window.__rows.filter(row => row.item_type !== 'heading').map(row => row.item_name));
    for (const document of await page.locator(preview + ' .doc-page-inner').all()) {
      await expect(document.locator('.doc-item-row td:first-child')).toHaveText(originalNames);
    }
    await expect(page.locator(preview + ' .doc-item-row img')).toHaveCount(0);
    const previewContent = await page.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML));
    if (scenario.summary) await expectSummaryFits(page.locator(preview));
    await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
    for (const suffix of ['PrintBtn', 'PdfBtn']) {
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#' + kind + suffix).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await expectDocument(popup, preview, copies, scenario);
      if (scenario.displayRows) await expectDisplayRows(popup, preview, scenario.displayRows);
      expect(await popup.locator(preview + ' .doc-page-inner').evaluateAll(els => els.map(el => el.innerHTML))).toEqual(previewContent);
      await popup.emulateMedia({ media: 'print' });
      if (scenario.summary) await expectSummaryFits(popup.locator(preview));
      await expect(popup.locator(preview + ' .doc-item-row img')).toHaveCount(0);
      expect(await popup.evaluate(() => window.__xss)).toBeUndefined();
      const pdf = await popup.pdf({ format: 'A4', printBackground: true, path: info.outputPath(suffix + '.pdf') });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await popup.screenshot({ path: info.outputPath(suffix + '.png'), fullPage: true });
      await popup.close();
    }
    await expectReadOnly(page);
  });
}

for (const width of [360, 390, 1280]) test(`637 QT form ${width}: live breakdown preserves input nodes, focus, header discount and WHT`, async ({ page, context }, info) => {
  await boot(page, context, width, false);
  await page.evaluate(() => window.__qt.renderQuotationsPage(window.__ctx));
  await page.locator('#qtAddBtn').click();
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  await page.locator('.qt-li-name').fill('แอร์จำลอง <img src=x onerror="window.__xss=1">');
  await page.locator('.qt-li-price').fill('45500');
  const root = page.locator('#page-quotations');
  await expect(page.locator('#qtLineDiscountSummary .doc-line-discount-summary')).toHaveCount(0);
  await expect(page.locator('#qtSubtotalLabel')).toHaveText('รวมเป็นเงิน');
  await page.evaluate(() => { window.__inputs = [...document.querySelectorAll('#page-quotations input, #page-quotations select, #page-quotations textarea')]; });
  const stableInputs = async () => {
    expect(await page.evaluate(() => {
      const current = [...document.querySelectorAll('#page-quotations input, #page-quotations select, #page-quotations textarea')];
      return current.length === window.__inputs.length && current.every((node, index) => node === window.__inputs[index] && node.isConnected);
    })).toBe(true);
    await expect(page.locator('.doc-line-discount')).toHaveCount(0);
  };
  await page.locator('.qt-li-disc').fill('');
  for (const [key, gross, discount, subtotal, label] of [
    ['1', 45500, 455, 45045, 'ส่วนลดรายสินค้า 1%'],
    ['0', 45500, 4550, 40950, 'ส่วนลดรายสินค้า 10%'],
  ]) {
    await page.locator('.qt-li-disc').press(key);
    await expect(page.locator('.qt-li-disc')).toBeFocused();
    await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross, discount, label });
    await expect(page.locator('#qtSubtotal')).toHaveText(money(subtotal));
    await expect(page.locator('#qtSubtotalLabel')).toHaveText('ยอดหลังส่วนลดรายสินค้า');
    await stableInputs();
  }
  for (const [selector, value, gross, discount, subtotal] of [
    ['.qt-li-qty', '2', 91000, 9100, 81900],
    ['.qt-li-price', '1000', 2000, 200, 1800],
  ]) {
    await page.locator(selector).fill(value);
    await expect(page.locator(selector)).toBeFocused();
    await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross, discount });
    await expect(page.locator('#qtSubtotal')).toHaveText(money(subtotal));
    await stableInputs();
  }
  await page.locator('#qt_discPct').fill('5');
  await expect(page.locator('#qtDiscountAmount')).toHaveText('-90.00');
  await expect(page.locator('#qtAfterDiscount')).toHaveText('1,710.00');
  await stableInputs();
  await page.locator('#qt_wht').check();
  await expect(page.locator('#qtWhtAmount')).toHaveText('-51.30');
  await expect(page.locator('#qtGrandTotal')).toContainText('1,658.70');
  await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross: 2000, discount: 200 });
  await stableInputs();
  await expectSummaryFits(root);
  await page.screenshot({ path: info.outputPath('form-live-summary.png'), fullPage: true });
  await page.locator('.qt-li-disc').fill('100');
  await expectSummary(page.locator('#qtLineDiscountSummary'), 1, { gross: 2000, discount: 2000, label: 'ส่วนลดรายสินค้า 100%' });
  await expect(page.locator('#qtSubtotal')).toHaveText('0.00');
  await expect(page.locator('#qtWhtAmount')).toHaveText('-0.00');
  await expect(page.locator('#qtGrandTotal')).toContainText('0.00');
  await stableInputs();
  await page.locator('.qt-li-disc').fill('0');
  await expect(page.locator('#qtLineDiscountSummary .doc-line-discount-summary')).toHaveCount(0);
  await expect(page.locator('#qtSubtotalLabel')).toHaveText('รวมเป็นเงิน');
  await expect(page.locator('#qtSubtotal')).toHaveText('2,000.00');
  await expect(page.locator('#qtDiscountAmount')).toHaveText('-100.00');
  await expect(page.locator('#qtWhtAmount')).toHaveText('-57.00');
  await expect(page.locator('#qtGrandTotal')).toContainText('1,843.00');
  await page.locator('.qt-li-disc').press('Tab');
  await stableInputs();
  await expectReadOnly(page);
});
