import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderDocumentLineDiscount } from '../modules/doc_items.js';
import { escHtml } from '../modules/utils.js';
import { SITES, extractRowCallback, extractNumHelper, rawCells, extractFunctionRegion } from './phase629_document_unit_xss.shared.js';

const item = Object.freeze({ item_name: 'แอร์พร้อมติดตั้ง', item_type: 'item', qty: 1, unit: 'เครื่อง', unit_price: 45500, discount_pct: 10, line_total: 40950 });
const annotation = '<div class="doc-line-discount">ส่วนลด 10% (4,550.00 บาท)</div>';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
// Frozen pre-636 row shape, no Git history required by shallow CI checkouts.
const baselineRow = row => row.item_type === 'heading'
  ? '<tr class="doc-heading-row"><td colspan="5">' + escHtml(row.item_name) + '</td></tr>'
  : '<tr class="doc-item-row"><td style="text-align:left">' + escHtml(row.item_name) + '</td>'
    + '<td style="text-align:center">1.00</td><td style="text-align:center">เครื่อง</td>'
    + '<td style="text-align:right">45,500.00</td><td style="text-align:right">40,950.00</td></tr>';

test('636: owner example, multi-quantity, decimal and 100% discount are display-only', () => {
  assert.equal(renderDocumentLineDiscount(item), annotation);
  assert.match(renderDocumentLineDiscount({ ...item, qty: 2, line_total: 81900 }), /9,100\.00 บาท/);
  assert.match(renderDocumentLineDiscount({ ...item, unit_price: 99.99, discount_pct: 12.5, line_total: 87.49 }), /12\.5% \(12\.50 บาท\)/);
  assert.match(renderDocumentLineDiscount({ ...item, discount_pct: 100, line_total: 0 }), /100% \(45,500\.00 บาท\)/);
  assert.equal(item.line_total, 40950);
});

test('636: no markup for heading, zero, missing, invalid or negative data', () => {
  for (const row of [null, {}, { ...item, item_type: 'heading' }, { ...item, discount_pct: 0 },
    { ...item, discount_pct: -10 }, { ...item, discount_pct: 101 }, { ...item, discount_pct: Infinity },
    { ...item, discount_pct: '<img src=x onerror=alert(1)>' }, { ...item, qty: NaN },
    { ...item, qty: -1 }, { ...item, unit_price: -2 }, { ...item, line_total: null },
    { ...item, line_total: '' }, { ...item, line_total: 99999 }, { ...item, line_total: -1 }]) {
    assert.equal(renderDocumentLineDiscount(row), '', JSON.stringify(row));
  }
  assert.equal(renderDocumentLineDiscount({ ...item, discount_pct: '10', qty: '1', unit_price: '45500', line_total: '40950' }), annotation);
});

for (const site of SITES.filter(site => site.context === 'text')) {
  test(`636: ${site.id} adds ONLY escaped-name annotation; stored totals/cells unchanged`, () => {
    const run = src => vm.runInNewContext(`${extractNumHelper(src)}\n(${extractRowCallback(src, site)})`, { escHtml, renderDocumentLineDiscount });
    const before = baselineRow;
    const after = run(read(site.file));
    const html = after(item);
    assert.ok(!before(item).includes(annotation), 'baseline must reproduce missing discount');
    assert.ok(html.includes(annotation));
    assert.equal(html.replace(annotation, ''), before(item));
    assert.deepEqual(rawCells(html).slice(1), rawCells(before(item)).slice(1));
    for (const row of [{ ...item, discount_pct: 0 }, { ...item, item_type: 'heading' }]) assert.equal(after(row), before(row));
    assert.ok(after({ ...item, item_name: '<img src=x onerror=alert(1)>' }).includes('&lt;img'));
    assert.ok(!after({ ...item, item_name: '<img src=x onerror=alert(1)>' }).includes('<img'));
  });
}

test('636: save/conversion and accounting/print routing match ef9378a LF-normalized pins', () => {
  for (const [file, decl, pin] of [
    ['modules/quotations.js', 'async function saveQuotationFull() {', 'cff89d4813ad43cd117c37dc2a98d8637b4fe0a26455688afcdfaa9505cccb92'],
    ['modules/quotations.js', 'async function convertToDeliveryInvoice(q) {', 'fbf3e58e989bd020848156fef8b76cd5a59d2838f23509cc945e94b187f3e7b1'],
    ['modules/delivery_invoices.js', 'async function convertToReceipt(inv) {', '85bb3e9531942ee7abefffb2c70e55f91a6073d6cea7c8c3c1628ecf16e7f664'],
  ]) assert.equal(sha(extractFunctionRegion(read(file), decl)), pin);
  for (const [file, pin] of [
    ['modules/accounting/auto_post.js', 'cf044a2bd8e23d1104a7be9feaa98c84011dc9ca864191058b95f86a1dbed613'],
    ['modules/doc-override.js', 'b77bcf8a724883605ebd4b59d76ceb47f5f4ef5c71ff8817d3b52b21aa81bfde'],
    ['modules/receipt_bt.js', '5586d2eea2e6ad83ef8590d38914ff36685425bb83a4cd408b8af39ae960e483'],
  ]) {
    assert.equal(sha(read(file)), pin);
  }
});
