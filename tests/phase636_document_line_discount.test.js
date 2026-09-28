import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { escHtml } from '../modules/utils.js';
import { SITES, extractRowCallback, extractNumHelper, rawCells, extractFunctionRegion } from './phase629_document_unit_xss.shared.js';

const item = Object.freeze({ item_name: 'แอร์พร้อมติดตั้ง', item_type: 'item', qty: 1, unit: 'เครื่อง', unit_price: 45500, discount_pct: 10, line_total: 40950 });
// Optional read-only RED campaign. Normal/shallow CI never invokes Git.
// PHASE637_BASELINE=1 node --test tests/phase636_document_line_discount.test.js
const baseline = process.env.PHASE637_BASELINE === '1';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = file => (baseline
  ? execFileSync('git', ['show', '4e42905ecb7d9f1f8929148d765f917bd0b48fc5:' + file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  : readFileSync(new URL('../' + file, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const docItems = baseline
  ? await import('data:text/javascript;base64,' + Buffer.from(read('modules/doc_items.js')).toString('base64'))
  : await import('../modules/doc_items.js');
// Missing baseline exports are explicit assertion failures, not import crashes.
const summary = (rows, subtotal) => {
  assert.equal(typeof docItems.getDocumentDiscountSummary, 'function', 'footer summary export must exist');
  return docItems.getDocumentDiscountSummary(rows, subtotal);
};
const render = (rows, subtotal) => {
  assert.equal(typeof docItems.renderDocumentDiscountSummary, 'function', 'footer renderer export must exist');
  return docItems.renderDocumentDiscountSummary(rows, subtotal);
};
const empty = (rows, subtotal) => {
  assert.equal(summary(rows, subtotal), null, 'invalid/incomplete bill must not claim a partial summary');
  assert.equal(render(rows, subtotal), '', 'invalid/incomplete bill must not render summary markup');
};
const footer = '<div class="doc-line-discount-summary">'
  + '<div class="doc-total-row"><span>รวมราคาสินค้าก่อนส่วนลด</span><span>45,500.00 บาท</span></div>'
  + '<div class="doc-total-row"><span>ส่วนลดรายสินค้า 10%</span><span>-4,550.00 บาท</span></div></div>';
const sha = value => createHash('sha256').update(value).digest('hex');
// Frozen pre-636 row shape, no Git history required by shallow CI checkouts.
const baselineRow = row => row.item_type === 'heading'
  ? '<tr class="doc-heading-row"><td colspan="5">' + escHtml(row.item_name) + '</td></tr>'
  : '<tr class="doc-item-row"><td style="text-align:left">' + escHtml(row.item_name) + '</td>'
    + '<td style="text-align:center">1.00</td><td style="text-align:center">เครื่อง</td>'
    + '<td style="text-align:right">45,500.00</td><td style="text-align:right">40,950.00</td></tr>';

test('637: owner example is one footer summary, not a row annotation', () => {
  assert.deepEqual(summary([item], 40950), { gross: 45500, discount: 4550, label: 'ส่วนลดรายสินค้า 10%' });
  assert.equal(render([item], 40950), footer);
  assert.equal(item.line_total, 40950);
});

for (const [name, row, expected] of [
  ['multi-quantity', { ...item, qty: 2, line_total: 81900 }, { gross: 91000, discount: 9100, label: 'ส่วนลดรายสินค้า 10%' }],
  ['decimal', { ...item, unit_price: 99.99, discount_pct: 12.5, line_total: 87.49 }, { gross: 99.99, discount: 12.5, label: 'ส่วนลดรายสินค้า 12.5%' }],
  ['100%', { ...item, discount_pct: 100, line_total: 0 }, { gross: 45500, discount: 45500, label: 'ส่วนลดรายสินค้า 100%' }],
  ['numeric strings', { ...item, discount_pct: '10', qty: '1', unit_price: '45500', line_total: '40950' }, { gross: 45500, discount: 4550, label: 'ส่วนลดรายสินค้า 10%' }],
]) test(`637: ${name} preserves gross minus stored net`, () => {
  assert.deepEqual(summary([row], row.line_total), expected);
  assert.ok(render([row], row.line_total).includes(expected.label));
  const amount = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(expected.discount);
  assert.ok(render([row], row.line_total).includes(`-${amount} บาท`));
});

test('637: mixed rates aggregate all item gross/net, including undiscounted items, without claiming a single rate', () => {
  const rows = [item, { ...item, qty: 2, unit_price: 100, discount_pct: 25, line_total: 150 },
    { ...item, unit_price: 50, discount_pct: 0, line_total: 50 }];
  const expected = { gross: 45750, discount: 4600, label: 'ส่วนลดรายสินค้ารวม' };
  assert.deepEqual(summary(rows, 41150), expected);
  assert.deepEqual(summary([...rows].reverse(), 41150), expected);
  const html = render(rows, 41150);
  assert.match(html, /45,750\.00 บาท/);
  assert.match(html, /-4,600\.00 บาท/);
  assert.ok(!html.includes('%'));
  assert.equal(html.split('doc-line-discount-summary').length - 1, 1);
  assert.equal(html.split('doc-total-row').length - 1, 2);
  assert.deepEqual(summary([item, item], 81900), { gross: 91000, discount: 9100, label: 'ส่วนลดรายสินค้ารวม' });
});

test('637: heading rows are ignored even with garbage monetary fields; only exact heading is ignored', () => {
  const heading = Object.freeze({ item_type: 'heading', item_name: '<img src=x onerror=alert(1)>',
    qty: -1, unit_price: Infinity, discount_pct: 'bad', line_total: 99999 });
  assert.equal(render([heading, item, heading], 40950), footer);
  empty([heading], 0);
  for (const item_type of ['HEADING', ' heading ', null, undefined, 'unknown']) {
    assert.equal(render([{ ...item, item_type }], 40950), footer);
    empty([{ ...heading, item_type }, item], 40950);
  }
});

test('637: one discounted item plus any other item uses generic label, not a percentage of total gross', () => {
  for (const extra of [
    { ...item, unit_price: 50, discount_pct: 0, line_total: 50 },
    { ...item, unit_price: 0, discount_pct: 0, line_total: 0 },
    { ...item, unit_price: 0.01, discount_pct: 1, line_total: 0.01 },
  ]) {
    const rows = [item, { item_type: 'heading', item_name: 'ignored' }, extra];
    const subtotal = 40950 + extra.line_total;
    const expected = { gross: 45500 + extra.unit_price, discount: 4550, label: 'ส่วนลดรายสินค้ารวม' };
    assert.deepEqual(summary(rows, subtotal), expected);
    assert.deepEqual(summary([...rows].reverse(), subtotal), expected);
    assert.ok(!render(rows, subtotal).includes('%'));
  }
});

test('637: no discounted items (empty, zero price, zero percent, rounded-to-zero discount) gives no summary', () => {
  empty([], 0);
  empty([{ ...item, discount_pct: 0, line_total: 45500 }], 45500);
  empty([{ ...item, unit_price: 0, line_total: 0 }], 0);
  empty([{ ...item, unit_price: 0.01, discount_pct: 1, line_total: 0.01 }], 0.01);
  empty([{ ...item, discount_pct: 0 }], 40950); // old contradictory-zero case
  empty([{ ...item, unit_price: 100, discount_pct: 0, line_total: 99.99 }], 99.99);
  empty([item, { ...item, unit_price: 100, discount_pct: 0, line_total: 99.99 }], 41049.99);
});

for (const field of ['qty', 'unit_price', 'discount_pct', 'line_total']) {
  test(`637: invalid ${field} anywhere suppresses the ENTIRE summary, never a partial total`, () => {
    for (const value of [undefined, null, '', ' ', NaN, Infinity, -Infinity, true, false, [], {}, 'bad', '<img src=x onerror=alert(1)>']) {
      const invalid = { ...item, [field]: value };
      for (const rows of [[invalid], [item, invalid], [invalid, item], [item, invalid, item]]) {
        empty(rows, rows.length === 3 ? 81900 : 40950);
      }
    }
  });
}

test('637: malformed rows and invalid ranges never allow a partial bill summary', () => {
  for (const row of [null, undefined, {}, [], 'item', 42,
    { ...item, discount_pct: -10 }, { ...item, discount_pct: 101 },
    { ...item, qty: -1 }, { ...item, qty: 0 }, { ...item, unit_price: -2 },
    { ...item, line_total: 99999 }, { ...item, line_total: -1 }]) {
    empty([row], 40950);
    empty([item, row], 40950);
    empty([row, item], 40950);
  }
  const sparse = [item];
  sparse[2] = item;
  empty(sparse, 81900); // sparse rows are not silently filtered out
  for (const rows of [null, undefined, {}, 'rows', 1]) empty(rows, 40950);
});

test('637: header must reconcile EXACTLY at satang precision, independently of line tolerance', () => {
  for (const header of [40949.99, 40950.01, 45500, 0, -1, null, undefined, '', ' ', true, {}, [], NaN, Infinity, '40950x']) {
    empty([item], header);
  }
  assert.equal(render([item], '40950.00'), footer);
  const rows = [
    { ...item, unit_price: 0.3, discount_pct: 33.33, line_total: 0.2 },
    { ...item, unit_price: 0.2, discount_pct: 50, line_total: 0.1 },
  ];
  assert.deepEqual(summary(rows, 0.1 + 0.2), { gross: 0.5, discount: 0.2, label: 'ส่วนลดรายสินค้ารวม' });
  empty(rows, 0.29);
  empty(rows, 0.31);
});

test('637: contradictory percentage/net makes no claim; one-satang line tolerance stays inclusive', () => {
  const inconsistent = Object.freeze({ ...item, line_total: 20000 });
  empty([inconsistent], 20000);
  assert.equal(inconsistent.line_total, 20000, 'must not repair stored data');
  for (const net of [40949.98, 40950.02, 40949.9899, 40950.0101]) {
    empty([{ ...item, line_total: net }], net);
    empty([item, { ...item, line_total: net }], 40950 + net);
  }
  for (const net of [40949.99, 40950, 40950.01]) {
    assert.deepEqual(summary([{ ...item, line_total: net }], net), {
      gross: 45500, discount: (4550000 - Math.round(net * 100)) / 100, label: 'ส่วนลดรายสินค้า 10%',
    });
  }
  empty([{ ...item, discount_pct: 100, line_total: 20000 }], 20000);
});

test('637: huge values reject nonfinite arithmetic, unsafe row cents, unsafe aggregate cents and headers', () => {
  for (const row of [
    { ...item, qty: 1e308, unit_price: 1e308 },
    { ...item, unit_price: 1e308, discount_pct: 100, line_total: 0 },
    { ...item, unit_price: 1e14, line_total: 9e13 },
  ]) empty([row], row.line_total);
  const large = { ...item, unit_price: 5e13, discount_pct: 50, line_total: 2.5e13 };
  assert.deepEqual(summary([large], 2.5e13), { gross: 5e13, discount: 2.5e13, label: 'ส่วนลดรายสินค้า 50%' });
  empty([large, large], 5e13); // each row safe, aggregate gross unsafe
  const almostFull = { ...large, discount_pct: 1, line_total: 4.95e13 };
  empty([almostFull, almostFull], 9.9e13); // aggregate net/header unsafe too
  for (const header of [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, '1e308']) empty([item], header);
});

for (const [pct, label] of [
  [0.01, 'ส่วนลดรายสินค้า 0.01%'], [12.34, 'ส่วนลดรายสินค้า 12.34%'],
  [12.345, 'ส่วนลดรายสินค้ารวม'], [0.001, 'ส่วนลดรายสินค้ารวม'], [1e-7, 'ส่วนลดรายสินค้ารวม'],
]) test(`637: percentage ${pct} is exact or generic, never rounded into a different claim/exponent`, () => {
  const row = { ...item, unit_price: 1e8, discount_pct: pct, line_total: Math.round(1e8 * (1 - pct / 100) * 100) / 100 };
  assert.equal(summary([row], row.line_total).label, label);
  const html = render([row], row.line_total);
  assert.ok(html.includes(`<span>${label}</span>`));
  assert.doesNotMatch(html, /\d[eE][+-]?\d/);
  if (!label.includes('%')) assert.ok(!html.includes('%'));
});

test('637: frozen arrays/rows stay readonly on success and failure; no untrusted text enters footer', () => {
  const row = Object.freeze({ ...item, item_name: '<img src=x onerror=alert(1)>', unit: '<svg onload=alert(1)>', metadata: Object.freeze({ keep: true }) });
  const rows = Object.freeze([row]);
  const before = JSON.stringify(rows);
  assert.equal(render(rows, 40950), footer);
  empty(rows, 45500);
  empty(Object.freeze([row, Object.freeze({ ...row, line_total: 20000 })]), 60950);
  const result = summary(rows, 40950);
  result.discount = -1;
  assert.equal(render(rows, 40950), footer, 'result must not expose mutable input/shared state');
  assert.equal(JSON.stringify(rows), before);
});

test('637: raw-field completeness detects missing/null/invalid values before UI defaults', () => {
  assert.equal(typeof docItems.hasDocumentDiscountFields, 'function');
  const complete = docItems.hasDocumentDiscountFields;
  assert.equal(complete(item), true);
  assert.equal(complete({ ...item, qty: '1', unit_price: '45500', discount_pct: '10', line_total: '40950' }), true);
  assert.equal(complete({ item_type: 'heading' }), true, 'heading money fields are irrelevant');
  for (const row of [null, undefined, {}, [], 'row']) assert.equal(complete(row), false);
  for (const field of ['qty', 'unit_price', 'discount_pct', 'line_total']) {
    const missing = { ...item };
    delete missing[field];
    assert.equal(complete(Object.freeze(missing)), false, `${field}: absent`);
    for (const value of [undefined, null, '', ' ', NaN, Infinity, -Infinity, true, false, [], {}, 'bad']) {
      assert.equal(complete(Object.freeze({ ...item, [field]: value })), false, field);
    }
  }
  assert.equal(complete({ ...item, discount_pct: 100, line_total: 0 }), true, 'real numeric zero is complete');
  for (const qty of [0, '0', -1]) {
    const raw = Object.freeze({ ...item, qty, discount_pct: 100, line_total: 0 });
    assert.equal(complete(raw), false, 'raw nonpositive qty must not become valid via legacy fallback');
    empty([raw], 0);
    empty([{ ...raw, qty: 1, _discountSummaryComplete: complete(raw) }], 0);
  }
});

test('637: false completeness marker suppresses normalized-valid rows; missing marker remains valid in memory', () => {
  const incomplete = Object.freeze({ ...item, _discountSummaryComplete: false });
  empty(Object.freeze([incomplete]), 40950);
  empty(Object.freeze([item, incomplete]), 81900);
  empty(Object.freeze([incomplete, item]), 81900);
  const zeroDefault = Object.freeze({ ...item, unit_price: 0, discount_pct: 0, line_total: 0, _discountSummaryComplete: false });
  empty([item, zeroDefault], 40950);
  assert.equal(render([item], 40950), footer, 'fresh in-memory rows need no loader metadata');
  assert.equal(render([{ ...item, _discountSummaryComplete: true }], 40950), footer);
  assert.equal(render([{ item_type: 'heading', _discountSummaryComplete: false }, item], 40950), footer);
  empty([{ ...item, _discountSummaryComplete: true, qty: null }], 40950); // true marker must not bypass validation
  assert.equal(incomplete._discountSummaryComplete, false, 'summary must not repair metadata');
});

for (const site of SITES.filter(site => site.context === 'text')) {
  test(`637: ${site.id} is EXACT pre-636 escaped-name-only row; no annotation, stored cells unchanged`, () => {
    const run = src => vm.runInNewContext(`${extractNumHelper(src)}\n(${extractRowCallback(src, site)})`, { escHtml, ...docItems });
    const after = run(read(site.file));
    for (const row of [item, { ...item, discount_pct: 0 }, { ...item, item_type: 'heading' },
      { ...item, item_name: '<img src=x onerror=alert(1)> & "\'' },
      { ...item, item_type: 'heading', item_name: '<svg onload=alert(1)> & "\'' }]) {
      const html = after(row);
      assert.equal(html, baselineRow(row));
      assert.equal(rawCells(html)[0], escHtml(row.item_name));
      assert.deepEqual(rawCells(html).slice(1), rawCells(baselineRow(row)).slice(1));
      assert.ok(!html.includes('doc-line-discount'));
    }
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
