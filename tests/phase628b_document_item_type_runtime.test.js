// Phase 628B — document line-item `item_type` runtime (ใบเสนอราคา → ใบส่งสินค้า → ใบเสร็จ)
//
// Owner rulings (locked): canonical = item | heading only · anything else → item ·
// heading writes product_id=null, qty=0, unit_price=0, discount_pct=0, line_total=0 ·
// never infer heading from zeros / product_id / name · totals + countable gates exclude
// heading · QT→DI→RC preserve item_type + sort_order · heading renders as plain text.
//
// Evidence classes:
//   [behavioral] executes the REAL module code — function bodies extracted brace-aware and
//                run in node:vm with the REAL modules/doc_items.js exports injected (never
//                stubbed), row callbacks rendered and tokenised, receipt_bt imported for real.
//   [structural] reads source text only. Never counted as production-safety proof.
// The Chromium counterpart is tests/e2e/phase628b_document_item_type_runtime.spec.js.
//
// PHASE628B_SOURCE_ROOT: read-only redirect used only by the baseline / mutation campaign
// (points at a scratch mirror). Unset in CI → the repo sources are read.
// Run: node --test tests/phase628b_document_item_type_runtime.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { escHtml as sharedEscHtml, money, formatNumber } from "../modules/utils.js";
import {
  extractRowCallback, extractNumHelper, startTags, rawCells, decodeEntities,
} from "./phase629_document_unit_xss.shared.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = process.env.PHASE628B_SOURCE_ROOT || ROOT;
const read = (file) => readFileSync(path.join(SOURCE_ROOT, file), "utf8");
const importFrom = (file) => import(pathToFileURL(path.join(SOURCE_ROOT, file)).href);

const QT_SRC = read("modules/quotations.js");
const DI_SRC = read("modules/delivery_invoices.js");
const RC_SRC = read("modules/receipts.js");
const BT_SRC = read("modules/receipt_bt.js");
const DOC_ITEMS_FILE = "modules/doc_items.js";
const HAS_DOC_ITEMS = existsSync(path.join(SOURCE_ROOT, DOC_ITEMS_FILE));
const DOC_ITEMS = HAS_DOC_ITEMS ? await importFrom(DOC_ITEMS_FILE) : null;
const QT_MOD = await importFrom("modules/quotations.js");
const DOC_UTILS = await importFrom("modules/doc-utils.js");
const BT = await importFrom("modules/receipt_bt.js");

// helper tests need the module; at baseline it does not exist → assertion (not a crash)
function helpers() {
  assert.ok(DOC_ITEMS, `${DOC_ITEMS_FILE} ต้องมี (Phase 628B pure helper)`);
  return DOC_ITEMS;
}
// real exports only — the sandbox never gets a stub
const REAL_HELPERS = () => ({ ...(DOC_ITEMS || {}) });

// ═══════════════════════════════════════════════════════════
//  brace-aware extraction (comment / string / template + ${})
// ═══════════════════════════════════════════════════════════
function skipQuoted(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    if (src[i] === "\n") return i;
    i++;
  }
  return i;
}

function extractFunction(src, decl) {
  const first = src.indexOf(decl);
  assert.notEqual(first, -1, `ไม่พบ ${decl}`);
  assert.equal(src.indexOf(decl, first + 1), -1, `${decl} ต้องพบครั้งเดียวพอดี`);
  let i = first + decl.length;
  const stack = ["brace"];
  while (i < src.length && stack.length) {
    const top = stack[stack.length - 1];
    const c = src[i], n = src[i + 1];
    if (top === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && n === "{") { stack.push("sub"); i += 2; continue; }
      i++;
      continue;
    }
    if (c === "/" && n === "/") { const nl = src.indexOf("\n", i); i = nl === -1 ? src.length : nl; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue; }
    if (c === "`") { stack.push("tpl"); i++; continue; }
    if (c === "{") { stack.push("brace"); i++; continue; }
    if (c === "}") { stack.pop(); i++; continue; }
    i++;
  }
  assert.equal(stack.length, 0, `${decl}: brace/template ไม่ balance`);
  const body = src.slice(first, i);
  assert.ok(body.endsWith("\n}"), `${decl}: ต้องจบที่ } ปิดฟังก์ชัน`);
  return body;
}

const SAVE_SRC = extractFunction(QT_SRC, "async function saveQuotationFull() {");
const EDIT_SRC = extractFunction(QT_SRC, "async function openEditForm(q) {");
const QT_CONVERT_SRC = extractFunction(QT_SRC, "async function convertToDeliveryInvoice(q) {");
const RC_CONVERT_SRC = extractFunction(DI_SRC, "async function convertToReceipt(inv) {");

// ── loader regions: every GET of an *_items table ordered by sort_order ──
//   region = from the line holding fetch( … "&order=sort_order.asc" up to its `} catch`
function loaderRegions(src, table) {
  const needle = `"/rest/v1/${table}?`;
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    const lineStart = src.lastIndexOf("\n", at) + 1;
    const lineEnd = src.indexOf("\n", at);
    if (!src.slice(lineStart, lineEnd).includes("&order=sort_order.asc")) continue;   // DELETE / other calls
    const end = src.indexOf("} catch", at);
    assert.ok(end > at, `${table}: loader ที่บรรทัด ${src.slice(0, at).split("\n").length} ต้องอยู่ใน try/catch`);
    out.push({ line: src.slice(0, at).split("\n").length, region: src.slice(lineStart, end) });
  }
  return out;
}

const LOADERS = [
  ...loaderRegions(QT_SRC, "quotation_items").map((l) => ({ ...l, file: "modules/quotations.js", table: "quotation_items" })),
  ...loaderRegions(DI_SRC, "delivery_invoice_items").map((l) => ({ ...l, file: "modules/delivery_invoices.js", table: "delivery_invoice_items" })),
  ...loaderRegions(RC_SRC, "receipt_items").map((l) => ({ ...l, file: "modules/receipts.js", table: "receipt_items" })),
];

// ═══════════════════════════════════════════════════════════
//  fixtures
// ═══════════════════════════════════════════════════════════
const CFG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
const TOKEN = "jwt-fixture";
const FIXED_MS = 1790000123456;
class FrozenDate extends Date {
  constructor(...a) { if (a.length === 0) super(FIXED_MS); else super(...a); }
  static now() { return FIXED_MS; }
}
const quiet = { warn: () => {}, error: () => {}, log: () => {} };
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const HEADING_ZERO = { product_id: null, qty: 0, unit_price: 0, discount_pct: 0, line_total: 0 };

// server rows as PostgREST returns them after Phase 628A (item_type column present)
const DB_ROWS = [
  { id: 1, product_id: null, item_name: "หมวด งานติดตั้ง", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, sort_order: 1, item_type: "heading" },
  { id: 2, product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, sort_order: 2, item_type: "item" },
  // legacy row — no item_type key at all (pre-628A cache / old client) → item, legacy qty fallback
  { id: 3, product_id: null, item_name: "ค่าแรง (แถวเก่า)", qty: 0, unit: "งาน", unit_price: 0, discount_pct: 0, line_total: 0, sort_order: 3 },
  // unknown case → item (never heading)
  { id: 4, product_id: null, item_name: "Heading ตัวพิมพ์ใหญ่", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, sort_order: 4, item_type: "Heading" },
];

// in-memory rows as the quotation form holds them
const H_MALFORMED = { product_id: 99, item_name: "หมวด A \"<b>'", qty: 3, unit: "ชุด", unit_price: 100, discount_pct: 5, line_total: 285, item_type: "heading" };
const I_AIR = {
  product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, item_type: "item",
  _source: "air_job", _serviceJobId: 77, _catalogId: 5, _airType: "wall", _estCost: 12000,
};
const I_LEGACY = { product_id: null, item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, discount_pct: 0, line_total: 2500 };
const H_CLEAN = { product_id: null, item_name: "หมวด B", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, item_type: "heading" };

// ═══════════════════════════════════════════════════════════
//  A — pure helper (modules/doc_items.js)
// ═══════════════════════════════════════════════════════════
const NOT_HEADING = [
  undefined, null, "", "item", "Heading", "HEADING", " heading", "heading ", "heading\n", "\theading",
  "subheading", "headings", "head", 0, 1, true, false, {}, [], ["heading"],
  { toString() { return "heading"; } }, Object("heading"),
];

test("A1 [behavioral] normalizeItemType: เฉพาะ 'heading' ตรงตัวเท่านั้นที่เป็น heading — อย่างอื่นทั้งหมดเป็น item", () => {
  const { normalizeItemType } = helpers();
  assert.equal(normalizeItemType("heading"), "heading");
  for (const v of NOT_HEADING) assert.equal(normalizeItemType(v), "item", `${JSON.stringify(v)} ต้องเป็น item`);
});

test("A2 [behavioral] isHeadingItem: ใช้ normalizer เดียวกัน · ห้าม infer จากเลขศูนย์/product_id/ชื่อ", () => {
  const { isHeadingItem } = helpers();
  assert.equal(isHeadingItem({ item_type: "heading" }), true);
  assert.equal(isHeadingItem({ item_type: "heading", qty: 5, line_total: 900, product_id: 3 }), true, "heading ที่มีตัวเลขยังเป็น heading");
  for (const v of NOT_HEADING) assert.equal(isHeadingItem({ item_type: v }), false, `${JSON.stringify(v)}`);
  assert.equal(isHeadingItem({ product_id: null, qty: 0, unit_price: 0, line_total: 0, item_name: "หัวข้อ" }), false,
    "ruling 4: แถวเลขศูนย์/ไม่มี product/ชื่อว่าหัวข้อ ห้ามเดาเป็น heading");
  assert.equal(isHeadingItem({ item_name: "heading" }), false);
  assert.equal(isHeadingItem(null), false);
  assert.equal(isHeadingItem(undefined), false);
});

function deepFreeze(o) {
  if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

test("A3 [behavioral] normalizeDocumentItem: object ใหม่ · ไม่ mutate · heading บังคับเลขศูนย์ 5 ช่อง · เก็บชื่อ/หน่วย/metadata", () => {
  const { normalizeDocumentItem } = helpers();
  const heading = deepFreeze({ ...H_MALFORMED, note: "meta", _source: "air_job" });
  const before = copy(heading);
  const out = normalizeDocumentItem(heading);
  assert.notEqual(out, heading, "ต้องคืน object ใหม่");
  assert.deepEqual(heading, before, "input ห้ามถูกแก้");
  assert.deepEqual(out, {
    ...before, ...HEADING_ZERO, item_type: "heading",
  }, "heading: product_id/qty/unit_price/discount_pct/line_total = null/0 · item_name/unit/metadata คงเดิม");

  const { item_type: _dropType, ...airWithoutType } = I_AIR;
  const item = deepFreeze({ ...airWithoutType, qty: 0 });
  const itemBefore = copy(item);
  const outItem = normalizeDocumentItem(item);
  assert.notEqual(outItem, item);
  assert.deepEqual(item, itemBefore);
  assert.deepEqual(outItem, { ...itemBefore, item_type: "item" }, "item: ค่าทุกช่องคงเดิม (รวม qty 0) · type canonical");

  for (const v of NOT_HEADING) {
    const r = normalizeDocumentItem({ item_type: v, qty: 4, unit_price: 10, line_total: 40, product_id: 8 });
    assert.equal(r.item_type, "item", `${JSON.stringify(v)} → item`);
    assert.equal(r.qty, 4); assert.equal(r.line_total, 40); assert.equal(r.product_id, 8);
  }
  assert.equal(normalizeDocumentItem(null).item_type, "item");
});

test("A4 [behavioral] countableDocumentItems: นับเฉพาะ non-heading (heading ที่มีตัวเลขก็ไม่นับ)", () => {
  const { countableDocumentItems } = helpers();
  assert.equal(countableDocumentItems([]), 0);
  assert.equal(countableDocumentItems([H_MALFORMED]), 0);
  assert.equal(countableDocumentItems([H_MALFORMED, H_CLEAN]), 0);
  assert.equal(countableDocumentItems([H_MALFORMED, I_AIR, I_LEGACY, { item_type: "Heading" }]), 3);
  assert.equal(countableDocumentItems(null), 0);
});

test("A5 [behavioral] sumDocumentLineTotals: รวม Number(line_total || 0) เฉพาะ non-heading · NaN ไหลตามเดิม", () => {
  const { sumDocumentLineTotals } = helpers();
  const baseline = (rows) => rows.reduce((s, i) => s + Number(i.line_total || 0), 0);
  assert.equal(sumDocumentLineTotals([H_MALFORMED, I_AIR, I_LEGACY]), 29500, "heading 285 ต้องไม่ถูกรวม");
  assert.equal(sumDocumentLineTotals([H_MALFORMED]), 0);
  const itemsOnly = [I_AIR, I_LEGACY, { line_total: "12.5" }, { line_total: null }, { line_total: "" }, { line_total: 0.1 }, { line_total: 0.2 }];
  assert.equal(sumDocumentLineTotals(itemsOnly), baseline(itemsOnly), "item ล้วน = สูตรเดิมทุกประการ (รวม float เดิม)");
  assert.ok(Number.isNaN(sumDocumentLineTotals([I_AIR, { line_total: "abc" }])), "ค่าที่แปลงไม่ได้ต้องเป็น NaN ไม่ใช่ศูนย์เงียบ");
  assert.equal(sumDocumentLineTotals([{ item_type: "heading", line_total: "abc" }, I_LEGACY]), 2500, "heading malformed ไม่ทำยอดพัง");
});

// ═══════════════════════════════════════════════════════════
//  B — loaders (8 เส้น) · heading qty 0 ต้องไม่กลายเป็น 1
// ═══════════════════════════════════════════════════════════
async function runLoader(region, rows) {
  const sandbox = {
    ...REAL_HELPERS(),
    cfg: CFG, token: TOKEN, pendingId: 55, q: { id: 55 }, inv: { id: 55 }, r: { id: 55 },
    fetch: async () => ({ ok: true, status: 200, json: async () => copy(rows) }),
    _lineItems: undefined, _lineItemsLoadFailed: undefined, sourceItems: undefined,
    console: quiet,
  };
  vm.createContext(sandbox);
  await vm.runInContext(`(async () => {\n${region}\n})()`, sandbox);
  return sandbox._lineItems !== undefined ? sandbox._lineItems : sandbox.sourceItems;
}

test("B0 [structural] inventory: loader ของตารางรายการ = QT 4 · DI 3 · RC 1 (8 เส้น)", () => {
  const count = (file) => LOADERS.filter((l) => l.file === file).length;
  assert.equal(count("modules/quotations.js"), 4);
  assert.equal(count("modules/delivery_invoices.js"), 3);
  assert.equal(count("modules/receipts.js"), 1);
});

for (const [n, l] of LOADERS.entries()) {
  test(`B${n + 1} [behavioral] loader ${l.file}:${l.line} (${l.table}): heading คงชนิด+เลขศูนย์ · legacy/unknown = item ตามเดิม · ลำดับเดิม`, async () => {
    const out = await runLoader(l.region, DB_ROWS);
    assert.ok(Array.isArray(out), "loader ต้องได้ array");
    assert.equal(out.length, DB_ROWS.length);
    assert.deepEqual(out.map((x) => x.item_name), DB_ROWS.map((x) => x.item_name), "ลำดับต้องตาม server");
    assert.deepEqual(out.map((x) => x.item_type), ["heading", "item", "item", "item"], "ชนิดต้อง canonical");
    const [h, it, legacy, unknown] = out;
    assert.equal(h.qty, 0, "ruling 3/4: heading qty 0 ห้ามกลายเป็น 1");
    assert.equal(h.unit_price, 0); assert.equal(h.discount_pct, 0); assert.equal(h.line_total, 0);
    assert.equal(h.product_id, null);
    assert.equal(it.qty, 2); assert.equal(it.unit_price, 15000); assert.equal(it.discount_pct, 10); assert.equal(it.line_total, 27000);
    assert.equal(legacy.qty, 1, "ruling 7: แถว legacy ทำงานแบบ item เดิม (qty 0 → 1 ตาม mapper เดิม)");
    assert.equal(unknown.qty, 1, "unknown case = item เดิม");
  });
}

// ═══════════════════════════════════════════════════════════
//  C — quotation save (saveQuotationFull ของจริง)
// ═══════════════════════════════════════════════════════════
const MSG = {
  EMPTY: "เพิ่มรายการสินค้าอย่างน้อย 1 รายการ",
  HEADING_ONLY: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ — มีแต่หัวข้อบันทึกไม่ได้",
  BUSY: "กำลังบันทึก...",
  QT_NO_ITEMS: "ใบเสนอราคานี้ไม่มีรายการสินค้า (ว่างหรือมีแต่หัวข้อ) — ยังไม่สร้างใบส่งสินค้า",
  RC_HEADING_ONLY: "ใบส่งสินค้านี้มีแต่หัวข้อ ไม่มีรายการสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง",
  RC_EMPTY: "ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง",
};

function makeDom(over = {}) {
  const values = {
    qt_customerSearch: "ลูกค้า ทดสอบ", qt_customerPhone: "0800000000", qt_customerAddress: "", qt_customerTaxId: "",
    qt_docNo: "QT-628B-001", qt_discPct: "0", qt_whtPct: "3", qt_payTerms: "เงินสด", qt_creditDays: "0",
    qt_project: "", qt_refNo: "", qt_salesperson: "พนักงาน", qt_status: "pending", qt_bankCoa: "", qt_note: "",
    ...over,
  };
  const els = {};
  for (const [id, value] of Object.entries(values)) els[id] = { value };
  els.qt_wht = { checked: false };
  els.qtSaveBtn = { disabled: false };
  els["page-quotations"] = { innerHTML: "" };
  return { getElementById: (id) => els[id] ?? null };
}

function writesOf(ledger) {
  return ledger.filter((e) => ["POST", "PATCH", "DELETE", "PUT"].includes(e.m));
}

async function runQuotation({
  lineItems = [], editingId = null, loadFailed = false, inflight = false, fetchRows = null,
  itemResult = () => ({ ok: true }), before = null,
} = {}) {
  const ledger = [];
  const toasts = [];
  const sandbox = {
    ...REAL_HELPERS(),
    _lineItems: lineItems.map((x) => ({ ...x })), _editingId: editingId, _lineItemsLoadFailed: loadFailed,
    _qtSaveInflight: inflight, _viewMode: "form", _airDraftMeta: null,
    _denyWriteForAccountant: () => false,
    appendAirJobNoteRef: QT_MOD.appendAirJobNoteRef,
    renderQuotationsPage: () => ledger.push({ m: "RENDER" }),
    renderSkeleton: () => "",
    document: makeDom(),
    Date: FrozenDate, console: quiet,
    fetch: async (url) => { ledger.push({ m: "GET", url }); return { ok: true, status: 200, json: async () => copy(fetchRows || []) }; },
  };
  let itemIdx = 0;
  sandbox._ctx = {
    showToast: (m) => toasts.push(m),
    loadAllData: async () => ledger.push({ m: "RELOAD" }),
    state: { paymentInfo: { banks: [] }, quotations: [], profile: { full_name: "พนักงาน" } },
  };
  sandbox.window = {
    SUPABASE_CONFIG: CFG, _sbAccessToken: TOKEN,
    _appXhrPost: async (table, payload, opts) => {
      ledger.push({ m: "POST", table, payload: copy(payload), opts: copy(opts) });
      if (table === "quotations") return { ok: true, data: { id: 5001 } };
      return itemResult(itemIdx++);
    },
    _appXhrPatch: async (table, payload, col, val) => { ledger.push({ m: "PATCH", table, payload: copy(payload), col, val }); return { ok: true }; },
    _appXhrDelete: async (table, col, val) => { ledger.push({ m: "DELETE", table, col, val }); return { ok: true }; },
  };
  vm.createContext(sandbox);
  const fns = vm.runInContext(`${EDIT_SRC}\n${SAVE_SRC}\n({ openEditForm, saveQuotationFull })`, sandbox);
  if (before) await before(fns, sandbox);
  await fns.saveQuotationFull();
  return { ledger, toasts, sandbox, writes: writesOf(ledger), itemPosts: ledger.filter((e) => e.m === "POST" && e.table === "quotation_items") };
}

const qtItem = (quotationId, sortOrder, over) => ({
  quotation_id: quotationId, product_id: null, item_name: "", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0,
  line_total: 0, item_type: "item", sort_order: sortOrder, ...over,
});

test("C1 [behavioral] save mixed: header ยอดไม่รวม heading · item payload = allowlist + item_type ตามลำดับ · heading ถูกบังคับเลขศูนย์", async () => {
  const r = await runQuotation({ lineItems: [H_MALFORMED, I_AIR, I_LEGACY] });
  const header = r.ledger.find((e) => e.m === "POST" && e.table === "quotations");
  assert.ok(header, "ต้องสร้าง header");
  assert.equal(header.payload.total_amount, 29500, "total ต้องมาจาก 2 รายการ (ไม่รวม heading 285)");
  assert.equal(header.payload.grand_total, 29500);
  assert.equal(header.payload.amount, 29500);
  assert.equal(header.payload.after_discount, 29500);
  assert.deepEqual(r.itemPosts.map((p) => p.payload), [
    qtItem(5001, 1, { item_name: H_MALFORMED.item_name, unit: "ชุด", item_type: "heading" }),
    qtItem(5001, 2, { product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000 }),
    qtItem(5001, 3, { item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, line_total: 2500 }),
  ], "payload ต้องตรงทุก key (ไม่มี _source/_serviceJobId/metadata) · sort_order = index + 1");
  assert.deepEqual(r.toasts.at(-1), "บันทึกใบเสนอราคาแล้ว");
  assert.equal(r.sandbox._qtSaveInflight, false);
});

test("C2 [behavioral] save heading-only → ไม่มี write เลย + toast ชัด", async () => {
  for (const rows of [[H_MALFORMED], [H_CLEAN, { ...H_CLEAN, item_name: "หมวด C" }]]) {
    const r = await runQuotation({ lineItems: rows });
    assert.deepEqual(r.writes, [], "heading-only: POST/PATCH/DELETE ต้อง = 0");
    assert.deepEqual(r.toasts, [MSG.HEADING_ONLY]);
    assert.equal(r.sandbox._qtSaveInflight, false);
  }
  const edit = await runQuotation({ lineItems: [H_CLEAN], editingId: 5001 });
  assert.deepEqual(edit.writes, [], "edit path heading-only: ห้าม PATCH header/DELETE รายการเดิม");
  assert.deepEqual(edit.toasts, [MSG.HEADING_ONLY]);
});

test("C3 [behavioral] countable gate อยู่ก่อน inflight (inflight ค้าง true ยังได้ข้อความ heading-only ไม่ใช่ 'กำลังบันทึก')", async () => {
  const r = await runQuotation({ lineItems: [H_CLEAN], inflight: true });
  assert.deepEqual(r.toasts, [MSG.HEADING_ONLY]);
  assert.deepEqual(r.writes, []);
  const empty = await runQuotation({ lineItems: [], inflight: true });
  assert.deepEqual(empty.toasts, [MSG.EMPTY], "empty gate เดิมยังอยู่ก่อน inflight");
});

test("C4 [behavioral] save empty → ไม่มี write (gate เดิม)", async () => {
  const r = await runQuotation({ lineItems: [] });
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.toasts, [MSG.EMPTY]);
});

test("C5 [behavioral] edit path: PATCH → DELETE → POST เรียงเดิม · ชนิด/ลำดับคงเดิม", async () => {
  const r = await runQuotation({ lineItems: [I_LEGACY, H_CLEAN, I_AIR], editingId: 5001 });
  assert.deepEqual(r.writes.map((e) => `${e.m} ${e.table}`), [
    "PATCH quotations", "DELETE quotation_items",
    "POST quotation_items", "POST quotation_items", "POST quotation_items",
  ]);
  assert.deepEqual(r.itemPosts.map((p) => [p.payload.item_name, p.payload.item_type, p.payload.sort_order, p.payload.qty]),
    [["ค่าติดตั้ง", "item", 1, 1], ["หมวด B", "heading", 2, 0], ["แอร์ 12000 BTU", "item", 3, 2]]);
});

test("C6 [behavioral] Phase 576: edit + โหลดรายการเดิมล้ม → ห้ามบันทึกทับ (ไม่มี write) แม้มีรายการจริง", async () => {
  const r = await runQuotation({ lineItems: [H_CLEAN, I_LEGACY], editingId: 5001, loadFailed: true });
  assert.deepEqual(r.writes, []);
  assert.ok(r.toasts[0].includes("ห้ามบันทึกทับ"));
});

test("C7 [behavioral] partial item failure semantics เดิม: header คงอยู่ · เตือนรายการขาด · ไม่ toast สำเร็จ", async () => {
  const r = await runQuotation({ lineItems: [H_CLEAN, I_LEGACY], itemResult: (i) => ({ ok: i !== 0 }) });
  assert.equal(r.itemPosts.length, 2, "ไม่หยุดกลางคัน");
  assert.ok(r.toasts.at(-1).includes("แต่บันทึกรายการไม่สำเร็จ 1 รายการ"));
  assert.ok(!r.toasts.includes("บันทึกใบเสนอราคาแล้ว"));
});

test("C8 [behavioral] reload → edit → re-save: heading ที่อ่านจาก DB ไม่กลับเป็น item/qty 1", async () => {
  const r = await runQuotation({
    editingId: 5001,
    fetchRows: DB_ROWS,
    before: async (fns, sb) => {
      await fns.openEditForm({ id: 5001 });
      assert.equal(sb._lineItemsLoadFailed, false);
    },
  });
  assert.deepEqual(r.itemPosts.map((p) => [p.payload.item_name, p.payload.item_type, p.payload.qty, p.payload.sort_order]), [
    ["หมวด งานติดตั้ง", "heading", 0, 1],
    ["แอร์ 12000 BTU", "item", 2, 2],
    ["ค่าแรง (แถวเก่า)", "item", 1, 3],
    ["Heading ตัวพิมพ์ใหญ่", "item", 1, 4],
  ]);
  assert.deepEqual(r.itemPosts[0].payload, qtItem(5001, 1, { item_name: "หมวด งานติดตั้ง", item_type: "heading" }));
});

// ═══════════════════════════════════════════════════════════
//  D — QT → DI (convertToDeliveryInvoice ของจริง)
// ═══════════════════════════════════════════════════════════
const QUOTE = {
  id: 900, qt_no: "QT-900", customer_name: "ลูกค้า ก", customer_phone: "0800000000", customer_address: "99 ถนนทดสอบ",
  customer_tax_id: "1234567890123", total_amount: 29500, discount_pct: 0, discount_amount: 0, after_discount: 29500,
  grand_total: 29500, amount: 29500, withholding_tax: false, wht_pct: 3, wht_amount: 0, payment_terms: "เงินสด",
  credit_days: 0, project_name: "โครงการ", salesperson: "พนักงาน ข", bank_coa_code: "1102-01", bank_label: "กสิกรไทย",
};
const d = new Date(FIXED_MS);
const DS = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");

function expectedDiHeader(q) {
  return {
    inv_no: "INV" + DS + String(FIXED_MS).slice(-6), quotation_id: q.id,
    customer_name: q.customer_name || q.customer || "",
    customer_phone: q.customer_phone || "", customer_address: q.customer_address || "",
    customer_tax_id: q.customer_tax_id || "",
    total_amount: q.total_amount || 0, discount_pct: q.discount_pct || 0,
    discount_amount: q.discount_amount || 0, after_discount: q.after_discount || q.total_amount || 0,
    grand_total: q.grand_total || q.amount || 0, withholding_tax: q.withholding_tax || false,
    wht_pct: q.wht_pct || 3, wht_amount: q.wht_amount || 0,
    payment_terms: q.payment_terms || "เงินสด", credit_days: q.credit_days || 0,
    project_name: q.project_name || "", ref_no: q.qt_no || "",
    salesperson: q.salesperson || "", status: "pending",
    bank_coa_code: q.bank_coa_code || null, bank_label: q.bank_label || null,
    note: "จากใบเสนอราคา " + (q.qt_no || ""),
  };
}
const diItem = (sortOrder, over) => ({
  delivery_invoice_id: 7101, product_id: null, item_name: "", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0,
  line_total: 0, item_type: "item", sort_order: sortOrder, ...over,
});

async function runQtConvert({ lineItems = [], fetchRows = [], q = QUOTE } = {}) {
  const ledger = [];
  const toasts = [];
  const sandbox = {
    ...REAL_HELPERS(),
    _qtConvertInflight: false, _lineItems: lineItems.map((x) => ({ ...x })), _lineItemsLoadFailed: false, _viewMode: "preview",
    _denyWriteForAccountant: () => false, Date: FrozenDate, console: quiet,
    fetch: async (url) => {
      ledger.push({ m: "GET", url });
      if (url.includes("/rest/v1/delivery_invoices?")) return { ok: true, status: 200, json: async () => [] };
      if (url.includes("/rest/v1/quotation_items?")) return { ok: true, status: 200, json: async () => copy(fetchRows) };
      throw new Error("unexpected fetch " + url);
    },
  };
  sandbox._ctx = {
    showToast: (m) => toasts.push(m), showRoute: (x) => ledger.push({ m: "ROUTE", x }),
    loadAllData: async () => ledger.push({ m: "RELOAD" }),
  };
  sandbox.window = {
    SUPABASE_CONFIG: CFG, _sbAccessToken: TOKEN,
    App: { showToast: (m) => toasts.push(m), confirm: async () => true },
    _appXhrPost: async (table, payload, opts) => {
      ledger.push({ m: "POST", table, payload: copy(payload), opts: copy(opts) });
      if (table === "delivery_invoices") return { ok: true, data: { id: 7101, inv_no: "INV-7101" } };
      return { ok: true };
    },
    _appXhrPatch: async (table, payload, col, val) => { ledger.push({ m: "PATCH", table, payload: copy(payload), col, val }); return { ok: true }; },
  };
  vm.createContext(sandbox);
  const fn = vm.runInContext(`${QT_CONVERT_SRC}\nconvertToDeliveryInvoice`, sandbox);
  await fn(q);
  return {
    ledger, toasts, sandbox, writes: writesOf(ledger),
    gets: ledger.filter((e) => e.m === "GET"),
    itemPosts: ledger.filter((e) => e.m === "POST" && e.table === "delivery_invoice_items"),
  };
}

// Phase 630: QT→DI ใช้ fresh snapshot ของ q.id เสมอ — _lineItems (ฟอร์ม/preview/ใบอื่น) ถูกปฏิเสธ ไม่ใช่ source
const QT_CACHE_POISON = [{ ...I_AIR, item_name: "ของใบอื่น (cache)", qty: 9, line_total: 1 }, { ...H_CLEAN, item_name: "หัวข้อในฟอร์มยังไม่บันทึก" }];

test("D1 [behavioral] QT→DI fresh snapshot: _lineItems ถูก ignore · fetch รายการของ q.id ใหม่เสมอ · header เงินเดิม · รายการครบทุกแถวตามลำดับพร้อม item_type", async () => {
  const r = await runQtConvert({ lineItems: QT_CACHE_POISON, fetchRows: [H_MALFORMED, I_AIR, H_CLEAN, I_LEGACY] });
  assert.equal(r.gets.length, 2, "ต้อง fetch รายการใหม่เสมอ แม้ _lineItems ไม่ว่าง (duplicate check + quotation_items)");
  assert.ok(r.gets[1].url.includes(`/rest/v1/quotation_items?quotation_id=eq.${QUOTE.id}&order=sort_order.asc`), "snapshot ต้องเป็นของ q.id ตามลำดับ sort_order");
  assert.deepEqual(r.sandbox._lineItems, QT_CACHE_POISON, "ห้ามเขียนทับ _lineItems ของฟอร์ม/preview");
  const header = r.ledger.find((e) => e.m === "POST" && e.table === "delivery_invoices");
  assert.deepEqual(header.payload, expectedDiHeader(QUOTE), "header/เงินต้องไม่เปลี่ยน");
  assert.deepEqual(r.itemPosts.map((p) => p.payload), [
    diItem(1, { item_name: H_MALFORMED.item_name, unit: "ชุด", item_type: "heading" }),
    diItem(2, { product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000 }),
    diItem(3, { item_name: "หมวด B", item_type: "heading" }),
    diItem(4, { item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, line_total: 2500 }),
  ]);
  assert.deepEqual(r.ledger.filter((e) => e.m === "PATCH").map((e) => [e.table, e.payload.status]), [["quotations", "invoiced"]]);
  assert.equal(r.toasts.at(-1), "สร้างใบส่งสินค้าแล้ว: INV-7101");
});

test("D2 [behavioral] QT→DI fetch path (cache ว่าง): heading จาก DB คงชนิด/qty 0 ในใบส่งสินค้า", async () => {
  const r = await runQtConvert({ lineItems: [], fetchRows: DB_ROWS });
  assert.equal(r.gets.length, 2, "cache ว่าง → fetch รายการเดิม");
  assert.deepEqual(r.itemPosts.map((p) => [p.payload.item_name, p.payload.item_type, p.payload.qty, p.payload.sort_order]), [
    ["หมวด งานติดตั้ง", "heading", 0, 1], ["แอร์ 12000 BTU", "item", 2, 2], ["ค่าแรง (แถวเก่า)", "item", 1, 3], ["Heading ตัวพิมพ์ใหญ่", "item", 1, 4],
  ]);
});

test("D3 [behavioral] QT→DI heading-only / ว่าง → ไม่มี write ใด ๆ (header/items/PATCH)", async () => {
  for (const [label, opts] of [
    // Phase 630: cache มีสินค้าไม่ช่วย — gate นับจาก snapshot ของ DB เท่านั้น
    ["cache มีสินค้า แต่ DB มีแต่หัวข้อ", { lineItems: [I_AIR, I_LEGACY], fetchRows: [DB_ROWS[0], { ...H_CLEAN }] }],
    ["fetch heading-only", { lineItems: [], fetchRows: [DB_ROWS[0]] }],
    ["fetch ว่าง", { lineItems: [], fetchRows: [] }],
  ]) {
    const r = await runQtConvert(opts);
    assert.deepEqual(r.writes, [], `${label}: POST/PATCH ต้อง = 0`);
    assert.deepEqual(r.toasts, [MSG.QT_NO_ITEMS], `${label}: toast`);
    assert.equal(r.sandbox._qtConvertInflight, false);
  }
});

// ═══════════════════════════════════════════════════════════
//  E — DI → RC (convertToReceipt ของจริง · Phase 626 gates คงเดิม)
// ═══════════════════════════════════════════════════════════
const INV = {
  id: 77, inv_no: "INV-0077", quotation_id: 900, customer_name: "ลูกค้า ก", total_amount: 29500, discount_pct: 0,
  discount_amount: 0, after_discount: 29500, grand_total: 29500, withholding_tax: false, wht_pct: 3, wht_amount: 0,
  payment_terms: "เงินสด", credit_days: 0,
};
// receipt_items payload: explicit allowlist + canonical item_type on EVERY row (no DB default).
// Oracle is independent of the implementation: item_type is decided here from the fixture, never via doc_items.js
function rcItem(row, i) {
  const heading = row.item_type === "heading";
  return {
    receipt_id: 5001,
    product_id: heading ? null : (row.product_id || null),
    item_name: row.item_name || "",
    qty: heading ? 0 : Number(row.qty || 1),
    unit: row.unit || "ชิ้น",
    unit_price: heading ? 0 : Number(row.unit_price || 0),
    discount_pct: heading ? 0 : Number(row.discount_pct || 0),
    line_total: heading ? 0 : Number(row.line_total || 0),
    sort_order: i + 1,
    item_type: heading ? "heading" : "item",
  };
}

async function runRcConvert(rows) {
  const ledger = [];
  const toasts = [];
  const sandbox = {
    ...REAL_HELPERS(),
    _diConvertInflight: false, _lineItems: [], _viewMode: "preview",
    _denyWriteForAccountant: () => false, Date: FrozenDate, console: quiet,
    fetch: async (url) => {
      ledger.push({ m: "GET", url });
      if (url.includes("/rest/v1/receipts?")) return { ok: true, status: 200, json: async () => [] };
      if (url.includes("/rest/v1/delivery_invoice_items?")) return { ok: true, status: 200, json: async () => copy(rows) };
      throw new Error("unexpected fetch " + url);
    },
  };
  sandbox._ctx = {
    showToast: (m) => toasts.push(m), showRoute: (x) => ledger.push({ m: "ROUTE", x }),
    loadAllData: async () => ledger.push({ m: "RELOAD" }),
  };
  sandbox.window = {
    SUPABASE_CONFIG: CFG, _sbAccessToken: TOKEN,
    App: { showToast: (m) => toasts.push(m), confirm: async () => true },
    _appXhrPost: async (table, payload, opts) => {
      ledger.push({ m: "POST", table, payload: copy(payload), opts: copy(opts) });
      if (table === "receipts") return { ok: true, data: { id: 5001, receipt_no: "RC-5001" } };
      return { ok: true };
    },
    _appXhrPatch: async (table, payload, col, val) => { ledger.push({ m: "PATCH", table, payload: copy(payload), col, val }); return { ok: true }; },
  };
  vm.createContext(sandbox);
  const fn = vm.runInContext(`${RC_CONVERT_SRC}\nconvertToReceipt`, sandbox);
  await fn(INV);
  return {
    ledger, toasts, sandbox, writes: writesOf(ledger),
    itemPosts: ledger.filter((e) => e.m === "POST" && e.table === "receipt_items"),
  };
}

const DI_ROWS = [
  { ...DB_ROWS[0] },
  { ...DB_ROWS[1] },
  { id: 9, product_id: 13, item_name: "หมวด วัสดุ", qty: 5, unit: "ชุด", unit_price: 99, discount_pct: 1, line_total: 490.05, sort_order: 3, item_type: "heading" },
  { id: 10, product_id: 13, item_name: "ท่อทองแดง", qty: 5, unit: "เมตร", unit_price: 220, discount_pct: 0, line_total: 1100, sort_order: 4, item_type: "item" },
];

test("E1 [behavioral] DI→RC: ทุก heading ถูกเก็บ (ชนิด+เลขศูนย์) ตามลำดับ · ทุกแถวส่ง item_type ชัด ๆ", async () => {
  const r = await runRcConvert(DI_ROWS);
  assert.deepEqual(r.itemPosts.map((p) => p.payload), DI_ROWS.map((row, i) => rcItem(row, i)));
  assert.deepEqual(r.itemPosts.map((p) => p.payload.item_type), ["heading", "item", "heading", "item"], "ทุกแถวต้องส่ง item_type ชัด ๆ (ไม่พึ่ง DB default)");
  assert.equal(r.toasts.at(-1), "ออกใบเสร็จรับเงินแล้ว: RC-5001");
  const header = r.ledger.find((e) => e.m === "POST" && e.table === "receipts");
  assert.equal(header.payload.total_amount, 29500, "header ยอดเดิมจากใบส่งสินค้า");
  assert.equal(header.payload.grand_total, 29500);
  assert.equal(header.payload.status, "pending");
});

test("E2 [behavioral] DI→RC heading-only → ไม่มี write ใด ๆ (ก่อน header) · Phase 626 empty gate เดิมยังทำงาน", async () => {
  const r = await runRcConvert([DI_ROWS[0], DI_ROWS[2]]);
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.toasts, [MSG.RC_HEADING_ONLY]);
  assert.equal(r.sandbox._diConvertInflight, false);
  const empty = await runRcConvert([]);
  assert.deepEqual(empty.writes, []);
  assert.deepEqual(empty.toasts, [MSG.RC_EMPTY], "Phase 626 R1 ข้อความเดิม");
});

// ═══════════════════════════════════════════════════════════
//  F — form + preview row callbacks (รันแถวจริงเหมือน Phase 629)
// ═══════════════════════════════════════════════════════════
const PAYLOAD_DQ = '" autofocus onfocus="window.__phase628bPwned=1';
const PAYLOAD_SQ = "' autofocus onfocus='window.__phase628bPwned=1";
const PAYLOAD_IMG = '<img src=x onerror="window.__phase628bPwned=1">';
const ATTACKS = [PAYLOAD_DQ, PAYLOAD_SQ, PAYLOAD_IMG, "&<>\"'", "หมวด (งานติดตั้ง)"];

const PREVIEW_SITES = [
  { id: "QT-PREVIEW", src: QT_SRC, fnDecl: "function renderQuotationPreview(container) {" },
  { id: "DI-PREVIEW", src: DI_SRC, fnDecl: "function renderInvoicePreview(container) {" },
  { id: "RC-PREVIEW", src: RC_SRC, fnDecl: "function renderReceiptPreview(container) {" },
];
const FORM_SITE = { id: "QT-FORM", src: QT_SRC, fnDecl: "function renderQuotationForm(container) {" };

function renderer(site) {
  const cb = extractRowCallback(site.src, site);
  return vm.runInNewContext(`${extractNumHelper(site.src)}\n;(${cb})`, { escHtml: sharedEscHtml });
}
const classOf = (tag) => (tag.attrs.find((a) => a.name === "class") || {}).value || "";

function assertNoInjection(html, allowed) {
  for (const t of startTags(html)) {
    assert.ok(allowed.includes(t.tag), `injected <${t.tag}> — ${html}`);
    for (const a of t.attrs) assert.ok(a.name !== "autofocus" && !a.name.startsWith("on"), `injected ${a.name} — ${html}`);
  }
}

for (const site of PREVIEW_SITES) {
  test(`F-${site.id} [behavioral] heading = <tr class="doc-heading-row"> ช่องเดียว colspan 5 · escape · ไม่มีตัวเลข/หน่วย`, () => {
    const render = renderer(site);
    for (const name of ATTACKS) {
      const html = render({ ...H_MALFORMED, item_name: name }, 0);
      assertNoInjection(html, ["tr", "td"]);
      const tags = startTags(html);
      assert.equal(classOf(tags[0]), "doc-heading-row", `ต้องเป็นแถวหัวข้อ — ${html}`);
      const tds = tags.filter((t) => t.tag === "td");
      assert.equal(tds.length, 1, `heading ต้องมี cell เดียว — ${html}`);
      assert.equal((tds[0].attrs.find((a) => a.name === "colspan") || {}).value, "5");
      const cells = rawCells(html);
      assert.equal(decodeEntities(cells[0]), name, "ชื่อหัวข้อต้องแสดงเป็นข้อความตรงตัว");
      assert.ok(!/[<>"']/.test(cells[0]), `ชื่อหัวข้อต้องถูก escape: ${cells[0]}`);
      for (const v of ["ชุด", "285.00", "100.00", "3.00", "5.00"]) assert.ok(!html.includes(v), `heading ห้ามแสดงหน่วย/ตัวเลข (${v}): ${html}`);
    }
  });

  test(`F-${site.id} [behavioral] item/legacy/unknown = <tr class="doc-item-row"> 5 cells (ลายสลับนับเฉพาะแถวสินค้า)`, () => {
    const render = renderer(site);
    for (const row of [I_AIR, I_LEGACY, { ...I_LEGACY, item_type: "HEADING" }, { ...I_LEGACY, item_type: null }]) {
      const html = render(row, 0);
      assertNoInjection(html, ["tr", "td"]);
      assert.equal(classOf(startTags(html)[0]), "doc-item-row", html);
      assert.equal(rawCells(html).length, 5, html);
    }
  });
}

test("F-QT-FORM [behavioral] heading row: input ชื่อแยก class · ไม่มีช่องจำนวน/หน่วย/ราคา/ส่วนลด/รวม · มีขึ้น/ลง/ลบ", () => {
  const render = renderer(FORM_SITE);
  for (const name of ATTACKS) {
    const html = render({ ...H_MALFORMED, item_name: name }, 1);
    assertNoInjection(html, ["tr", "td", "input", "button"]);
    const tags = startTags(html);
    assert.equal(classOf(tags[0]), "qt-heading-row", html);
    const inputs = tags.filter((t) => t.tag === "input");
    assert.deepEqual(inputs.map(classOf), ["qt-li-heading-name"], `heading row ต้องมี input ชื่อหัวข้ออย่างเดียว — ${html}`);
    assert.equal((inputs[0].attrs.find((a) => a.name === "value") || {}).value, name, "value ต้อง round-trip");
    const buttons = tags.filter((t) => t.tag === "button").map(classOf);
    for (const c of ["qt-li-up", "qt-li-down", "qt-li-del"]) assert.ok(buttons.includes(c), `ต้องมีปุ่ม ${c}`);
    assert.ok(!/qt-li-(name|qty|unit|price|disc)\b/.test(html), `ห้ามมี control ของ item ใน heading row — ${html}`);
    assert.ok(!html.includes("285") && !html.includes("ชุด"), "ห้ามแสดงตัวเลข/หน่วยของ heading");
  }
});

test("F-QT-FORM [behavioral] item row เดิม: 5 input · มีปุ่มขึ้น/ลง/ลบ", () => {
  const render = renderer(FORM_SITE);
  for (const row of [I_AIR, I_LEGACY, { ...I_LEGACY, item_type: "Heading" }]) {
    const html = render(row, 0);
    assertNoInjection(html, ["tr", "td", "input", "button"]);
    const tags = startTags(html);
    assert.equal(classOf(tags[0]), "qt-item-row", html);
    assert.deepEqual(tags.filter((t) => t.tag === "input").map(classOf),
      ["qt-li-name", "qt-li-qty", "qt-li-unit", "qt-li-price", "qt-li-disc"]);
    const buttons = tags.filter((t) => t.tag === "button").map(classOf);
    for (const c of ["qt-li-up", "qt-li-down", "qt-li-del"]) assert.ok(buttons.includes(c), `ต้องมีปุ่ม ${c}`);
  }
});

// ═══════════════════════════════════════════════════════════
//  G — print CSS (PRINT_CSS ของจริง) — structural; behavioral อยู่ใน e2e fixture
// ═══════════════════════════════════════════════════════════
test("G1 [structural] PRINT_CSS: มีกฎ heading + break-after/page-break-after: avoid · ลายสลับนับเฉพาะ .doc-item-row", () => {
  const css = DOC_UTILS.PRINT_CSS;
  assert.match(css, /\.doc-heading-row[^{]*\{[^}]*(?<![-\w])break-after:\s*avoid/);
  assert.match(css, /\.doc-heading-row[^{]*\{[^}]*page-break-after:\s*avoid/);
  assert.match(css, /tr\.doc-item-row:nth-child\(even of \.doc-item-row\)/);
  assert.ok(!/tbody tr:nth-child\(even\)/.test(css), "ห้ามใช้ tbody tr:nth-child(even) (นับ heading ด้วย)");
});

// ═══════════════════════════════════════════════════════════
//  H — Bluetooth slip (receipt_bt ของจริง)
// ═══════════════════════════════════════════════════════════
function drawReceipt(items) {
  const calls = [];
  const ctx = {
    font: "", textAlign: "left", textBaseline: "", fillStyle: "",
    fillRect: (x, y, w, h) => calls.push({ op: "rect", x, y, w, h }),
    fillText: (text, x, y) => calls.push({ op: "text", text, x, y, font: ctx.font, align: ctx.textAlign }),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const prev = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  try {
    BT.renderReceiptCanvas({ receipt_no: "RC-1", customer_name: "ลูกค้า", grand_total: 29500, items }, { name: "ร้าน" });
  } finally {
    if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
  }
  return { calls, height: canvas.height };
}

test("H1 [behavioral] BT heading: บรรทัดเดียวตัวหนา ชิดซ้าย · ไม่มียอดขวา · ไม่มีบรรทัด qty × price", () => {
  const heading = { item_name: "หมวด\n  งานติดตั้ง  ", item_type: "heading", qty: 0, unit_price: 0, line_total: 0 };
  const { calls } = drawReceipt([heading, I_LEGACY]);
  const texts = calls.filter((c) => c.op === "text");
  const h = texts.filter((c) => c.text.includes("งานติดตั้ง"));
  assert.equal(h.length, 1, "heading ต้องวาดครั้งเดียว");
  assert.equal(h[0].text, "หมวด งานติดตั้ง", "heading = ข้อความบรรทัดเดียว (normalize ช่องว่าง/ขึ้นบรรทัด)");
  assert.equal(h[0].align, "left");
  assert.match(h[0].font, /bold/);
  assert.deepEqual(texts.filter((c) => c.y === h[0].y).map((c) => c.text), [h[0].text], "บรรทัด heading ห้ามมียอดเงินด้านขวา");
  const after = texts.slice(texts.indexOf(h[0]) + 1);
  assert.equal(after[0].text, "ค่าติดตั้ง", "ถัดจาก heading ต้องเป็นชื่อสินค้า ไม่ใช่บรรทัด qty × price ของ heading");
  assert.ok(!texts.some((c) => c.text === "   " + formatNumber(0) + " x " + money(0)), "ห้ามมีบรรทัด 0 x 0 ของ heading");
});

test("H2 [behavioral] BT legacy/POS/unknown item output เดิมทุกไบต์ของ op (ชื่อซ้าย · ยอดขวา · qty × price)", () => {
  const pos = { product_name: "สินค้า POS", qty: 3, price: 10, line_total: 30 };
  const base = drawReceipt([I_LEGACY, pos]);
  for (const t of [undefined, null, "item", "Heading", "bogus"]) {
    const again = drawReceipt([{ ...I_LEGACY, item_type: t }, { ...pos, item_type: t }]);
    assert.deepEqual(again.calls, base.calls, `item_type=${t}: ต้องวาดเหมือน legacy ทุก op`);
    assert.equal(again.height, base.height);
  }
  const texts = base.calls.filter((c) => c.op === "text");
  const i = texts.findIndex((c) => c.text === "ค่าติดตั้ง");
  assert.ok(i > -1);
  assert.deepEqual(texts.slice(i, i + 6).map((c) => [c.text, c.align]), [
    ["ค่าติดตั้ง", "left"], [money(2500), "right"], ["   " + formatNumber(1) + " x " + money(2500), "left"],
    ["สินค้า POS", "left"], [money(30), "right"], ["   " + formatNumber(3) + " x " + money(10), "left"],
  ]);
});

// ═══════════════════════════════════════════════════════════
//  I — structural: helper purity · imports · writers · build markers · Phase 576/625/629 anchors
// ═══════════════════════════════════════════════════════════
test("I1 [structural] doc_items.js: pure (ไม่มี import/DOM/network/storage) + export ครบ 5 ตัว", () => {
  assert.ok(HAS_DOC_ITEMS, `${DOC_ITEMS_FILE} ต้องมี`);
  const src = read(DOC_ITEMS_FILE);
  assert.ok(!/^\s*import\b/m.test(src), "ห้าม import");
  assert.ok(!/\b(document|window|fetch|localStorage|sessionStorage|indexedDB|navigator|XMLHttpRequest)\b/.test(src.replace(/\/\/.*$/gm, "")),
    "ห้ามแตะ DOM/network/storage");
  for (const name of ["normalizeItemType", "isHeadingItem", "normalizeDocumentItem", "countableDocumentItems", "sumDocumentLineTotals"]) {
    assert.equal(typeof DOC_ITEMS[name], "function", `ต้อง export ${name}`);
  }
});

test("I2 [structural] 4 runtime modules import helper จาก ./doc_items.js", () => {
  for (const [file, src] of [["quotations", QT_SRC], ["delivery_invoices", DI_SRC], ["receipts", RC_SRC], ["receipt_bt", BT_SRC]]) {
    assert.match(src, /^import \{[^}]+\} from "\.\/doc_items\.js";$/m, `${file}.js ต้อง import จาก ./doc_items.js`);
  }
});

test("I3 [structural] writers ของตารางรายการ = 3 จุดพอดี และทุกจุดเขียน item_type", () => {
  const writers = [];
  for (const [file, src] of [["quotations", QT_SRC], ["delivery_invoices", DI_SRC], ["receipts", RC_SRC]]) {
    for (const m of src.matchAll(/xhrPost\("(quotation_items|delivery_invoice_items|receipt_items)", \{[\s\S]*?\n\s*\}\);/g)) {
      writers.push({ file, table: m[1], body: m[0] });
    }
  }
  assert.deepEqual(writers.map((w) => `${w.file}:${w.table}`),
    ["quotations:quotation_items", "quotations:delivery_invoice_items", "delivery_invoices:receipt_items"]);
  for (const w of writers) assert.match(w.body, /item_type/, `${w.file} ${w.table} ต้องเขียน item_type`);
});

test("I4 [structural] Phase 576/356: literal empty gate เดิม → countable gate → inflight (ตามลำดับ)", () => {
  const empty = SAVE_SRC.indexOf("if (!_lineItems.length)");
  const countable = SAVE_SRC.indexOf("countableDocumentItems(_lineItems)");
  const inflight = SAVE_SRC.indexOf("_qtSaveInflight = true");
  assert.ok(empty > -1 && countable > -1 && inflight > -1);
  assert.ok(empty < countable && countable < inflight);
});

test("I5 [structural] Phase 625/629 anchors: item input qt-li-name บรรทัดเดียว 1 จุด · unit escape 4 จุดครบ", () => {
  assert.equal((QT_SRC.match(/<input class="qt-li-name"[^\n]*?\/>/g) || []).length, 1);
  assert.equal((QT_SRC.match(/escHtml\(item\.unit\|\|'ชิ้น'\)/g) || []).length, 2);
  assert.equal((DI_SRC.match(/escHtml\(item\.unit\|\|'ชิ้น'\)/g) || []).length, 1);
  assert.equal((RC_SRC.match(/escHtml\(item\.unit\|\|'ชิ้น'\)/g) || []).length, 1);
});

// Phase 630: build pin เลื่อนตาม marker ที่ bump (629 / 5.69.96 / cache-v629) — ความเข้มเท่าเดิม
test("I6 [structural] build 629 / v5.69.96 / cache-v629 ตรงกันทุกจุด", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  assert.match(html, /data-app-build="629" data-app-version="5\.69\.96"/);
  for (const asset of ["style.css", "doc-print.css", "selfheal.js", "main.js", "boot.js"]) {
    assert.ok(html.includes(`${asset}?v=629`), `${asset}?v=629`);
  }
  assert.match(sw, /^const CACHE_NAME = 'boonsook-pos-v5-cache-v629';$/m);
  assert.match(sw, /^const SW_BUILD = '629';$/m);
  assert.match(sw.split("\n")[1], /^\/\/ v629 \(/, "phase comment บรรทัดบนสุดต้องเป็น v629");
});
