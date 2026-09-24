// Phase 630 — ใบเสนอราคา → ใบส่งสินค้า/ใบแจ้งหนี้: fail closed ก่อนสร้างเอกสาร (behavioral)
//
// invariant: ห้ามสร้างใบส่งสินค้าจนกว่าจะ "พิสูจน์ได้" ว่า
//   (1) duplicate lookup สำเร็จจริง (HTTP ok + JSON + array + ทุกแถวจำแนก status ได้) และไม่มีใบ active
//   (2) รายการมาจาก snapshot ที่ persist แล้วของ q.id (fetch ใหม่ทุกครั้ง) — ห้ามอ่าน/เขียน _lineItems
//       / _lineItemsLoadFailed (ฟอร์มที่ยังไม่บันทึก หรือ cache ของใบอื่น ไม่ใช่ source ของการแปลง)
// + header ok:true แต่ไม่มี id → หยุด items/PATCH/reload/route · ห้าม rollback/delete/retry
// + terminal toast สะท้อน partial state จริง (success ห้ามทับคำเตือน) · reload ล้มห้ามกลบผล
//
// Evidence classes:
//   [behavioral] ดึง convertToDeliveryInvoice ของจริงแบบ brace-aware แล้วรันใน node:vm พร้อม export จริง
//                ของ modules/doc_items.js (ไม่ stub) — assert จาก ordered ledger
//                (fetch / confirm / toast / xhrPost / xhrPatch / reload / route) ไม่ใช่ regex ของ source
//   [structural] อ่าน source อย่างเดียว — ไม่นับเป็นหลักฐาน behavior
// Mutation matrix (ท้ายไฟล์): mutant ต้องแดงด้วย ERR_ASSERTION ของ scenario ที่ระบุ (ไม่นับ crash/regex)
// e2e คู่กัน: tests/e2e/phase630_qt_to_di_failclosed.spec.js
//
// PHASE630_SOURCE_ROOT: redirect แบบอ่านอย่างเดียว ใช้เฉพาะ baseline / mutation campaign (ชี้ไป scratch mirror).
// ใน CI ไม่ตั้ง → อ่าน source ของ repo.
// Run: node --test tests/phase630_qt_to_di_failclosed.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = process.env.PHASE630_SOURCE_ROOT || ROOT;
const MODULE_SRC = readFileSync(path.join(SOURCE_ROOT, "modules/quotations.js"), "utf8");
const DOC_ITEMS = await import(pathToFileURL(path.join(SOURCE_ROOT, "modules/doc_items.js")).href);
const DECL = "async function convertToDeliveryInvoice(q) {";

// ═══════════════════════════════════════════════════════════
//  brace-aware extraction (รู้จัก comment / string / template + ${})
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
  assert.equal(stack.length, 0, "brace/template ไม่ balance — extraction เพี้ยน");
  const body = src.slice(first, i);
  assert.ok(body.endsWith("\n}"), "ฟังก์ชันที่ดึงมาต้องจบที่ } ปิดฟังก์ชัน");
  assert.match(body, /\} finally \{/, "ต้องได้ทั้งฟังก์ชันรวม finally");
  return body;
}

const SOURCE = extractFunction(MODULE_SRC, DECL);

// ═══════════════════════════════════════════════════════════
//  ข้อความสัญญา (prompt §5) — ต้องตรงตัวอักษร
// ═══════════════════════════════════════════════════════════
const MSG = {
  BUSY: "กำลังสร้างใบส่งสินค้า...",        // inflight (window.App) — ข้อความเดียวกับ progress แต่คนละช่อง
  PROGRESS: "กำลังสร้างใบส่งสินค้า...",    // _ctx ก่อน POST header
  DUP_FAIL: "ตรวจสอบใบส่งสินค้าเดิมไม่สำเร็จ — ยังไม่สร้างใบส่งสินค้า กรุณาลองใหม่",
  CONFIRM: "สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากข้อมูลใบเสนอราคาที่บันทึกล่าสุด?",
  ITEM_FAIL: "⚠️ โหลดรายการสินค้าไม่สำเร็จ — ยกเลิกการสร้างใบส่งสินค้า ลองใหม่อีกครั้ง",
  NO_ITEMS: "ใบเสนอราคานี้ไม่มีรายการสินค้า (ว่างหรือมีแต่หัวข้อ) — ยังไม่สร้างใบส่งสินค้า",
  NO_ID: "อาจสร้างใบส่งสินค้าแล้ว แต่ยืนยันรหัสไม่ได้ — โปรดตรวจรายการใบส่งสินค้าก่อนลองใหม่",
  STATUS_FAIL: "⚠️ อัปเดตสถานะเอกสารต้นทางไม่สำเร็จ — ใบใหม่ถูกสร้างแล้ว",
};
const okToast = (no) => "สร้างใบส่งสินค้าแล้ว: " + no;
const warnToast = (no) => `⚠️ สร้างใบส่งสินค้า ${no} แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ`;
const blockToast = (list) => `มีใบส่งสินค้า ${list} จากใบเสนอราคานี้แล้ว — ลบ/จัดการใบเดิมก่อนถึงออกใบใหม่ได้`;
const itemWarn = (no, n, names) => `⚠️ สร้าง ${no} แล้ว แต่บันทึกรายการไม่สำเร็จ ${n} รายการ (${names}…) — เปิดใบเพื่อตรวจ/เพิ่มเอง`;

// ═══════════════════════════════════════════════════════════
//  fixtures
// ═══════════════════════════════════════════════════════════
const CFG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
const TOKEN = "jwt-fixture";
const AUTH = { apikey: CFG.anonKey, Authorization: "Bearer " + TOKEN };
const dupUrl = (id) => `${CFG.url}/rest/v1/delivery_invoices?quotation_id=eq.${id}&select=inv_no,status`;
const itemUrl = (id) => `${CFG.url}/rest/v1/quotation_items?quotation_id=eq.${id}&order=sort_order.asc`;

const FIXED_MS = 1790000123456;
class FrozenDate extends Date {
  constructor(...a) { if (a.length === 0) super(FIXED_MS); else super(...a); }
  static now() { return FIXED_MS; }
}
const d = new Date(FIXED_MS);
const EXPECTED_INV_NO = "INV"
  + (d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"))
  + String(FIXED_MS).slice(-6);

const SERVER_NO = "INV20260924000001";
const INV_ID = 7101;

const QUOTE = Object.freeze({
  id: 900, qt_no: "QT-900", status: "approved",
  customer_name: "ลูกค้า ก", customer_phone: "0800000000", customer_address: "99 ถนนทดสอบ",
  customer_tax_id: "1234567890123", total_amount: 30600, discount_pct: 5, discount_amount: 1530,
  after_discount: 29070, grand_total: 29070, amount: 99999, withholding_tax: true, wht_pct: 3, wht_amount: 872.1,
  payment_terms: "เครดิต 30 วัน", credit_days: 30, project_name: "โครงการทดสอบ", salesperson: "พนักงาน ข",
  bank_coa_code: "1102-01", bank_label: "กสิกรไทย",
});
// header ที่ต้องไม่เปลี่ยน — literal (ไม่ derive จาก source)
const QUOTE_HEADER = {
  inv_no: EXPECTED_INV_NO, quotation_id: 900,
  customer_name: "ลูกค้า ก", customer_phone: "0800000000", customer_address: "99 ถนนทดสอบ",
  customer_tax_id: "1234567890123",
  total_amount: 30600, discount_pct: 5, discount_amount: 1530, after_discount: 29070,
  grand_total: 29070, withholding_tax: true, wht_pct: 3, wht_amount: 872.1,
  payment_terms: "เครดิต 30 วัน", credit_days: 30,
  project_name: "โครงการทดสอบ", ref_no: "QT-900", salesperson: "พนักงาน ข", status: "pending",
  bank_coa_code: "1102-01", bank_label: "กสิกรไทย",
  note: "จากใบเสนอราคา QT-900",
};
// ใบเก่าที่ field ขาด → fallback เดิมทุกช่อง
const SPARSE_QUOTE = Object.freeze({ id: 901, customer: "ลูกค้าเก่า", total_amount: 1400, amount: 1500 });
const SPARSE_HEADER = {
  inv_no: EXPECTED_INV_NO, quotation_id: 901,
  customer_name: "ลูกค้าเก่า", customer_phone: "", customer_address: "", customer_tax_id: "",
  total_amount: 1400, discount_pct: 0, discount_amount: 0, after_discount: 1400,
  grand_total: 1500, withholding_tax: false, wht_pct: 3, wht_amount: 0,
  payment_terms: "เงินสด", credit_days: 0, project_name: "", ref_no: "", salesperson: "", status: "pending",
  bank_coa_code: null, bank_label: null, note: "จากใบเสนอราคา ",
};

// แถวที่ PostgREST คืน (persisted) — heading ตัวเลขเพี้ยน · item · legacy ไม่มี item_type · ตัวพิมพ์แปลก
const SERVER_ROWS = [
  { id: 1, quotation_id: 900, product_id: 99, item_name: "หมวด งานติดตั้ง", qty: 3, unit: "ชุด", unit_price: 100, discount_pct: 5, line_total: 285, sort_order: 1, item_type: "heading" },
  { id: 2, quotation_id: 900, product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, sort_order: 2, item_type: "item" },
  { id: 3, quotation_id: 900, product_id: null, item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, discount_pct: 0, line_total: 2500, sort_order: 3 },
  { id: 4, quotation_id: 900, product_id: 13, item_name: "ท่อทองแดง", qty: 0, unit: null, unit_price: 220, discount_pct: 0, line_total: 1100, sort_order: 4, item_type: "Heading" },
];
// payload delivery_invoice_items ที่ต้องได้ — literal (oracle ไม่เรียก normalizer ของ production)
const itemsFor = (invId) => [
  { delivery_invoice_id: invId, product_id: null, item_name: "หมวด งานติดตั้ง", qty: 0, unit: "ชุด", unit_price: 0, discount_pct: 0, line_total: 0, item_type: "heading", sort_order: 1 },
  { delivery_invoice_id: invId, product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, item_type: "item", sort_order: 2 },
  { delivery_invoice_id: invId, product_id: null, item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, discount_pct: 0, line_total: 2500, item_type: "item", sort_order: 3 },
  { delivery_invoice_id: invId, product_id: 13, item_name: "ท่อทองแดง", qty: 1, unit: "ชิ้น", unit_price: 220, discount_pct: 0, line_total: 1100, item_type: "item", sort_order: 4 },
];
const EXPECTED_ITEMS = itemsFor(INV_ID);
const HEADING_ONLY_ROWS = [SERVER_ROWS[0], { ...SERVER_ROWS[0], id: 5, item_name: "หมวด วัสดุ", sort_order: 2 }];

// _lineItems ที่ "ห้าม" หลุดเข้าใบส่งสินค้า: ของใบอื่น + แถวแก้ในฟอร์มที่ยังไม่บันทึก
const POISON = [
  { product_id: 77, item_name: "ของใบอื่น QT-OTHER", qty: 9, unit: "ชิ้น", unit_price: 1, discount_pct: 0, line_total: 9, item_type: "item" },
  { product_id: null, item_name: "แก้ในฟอร์มยังไม่บันทึก", qty: 5, unit: "งาน", unit_price: 999, discount_pct: 0, line_total: 4995, item_type: "item", _source: "air_job" },
];

// ═══════════════════════════════════════════════════════════
//  harness — รัน convertToDeliveryInvoice ของจริง แล้วเก็บ ordered ledger
// ═══════════════════════════════════════════════════════════
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function respond(plan) {
  if (plan.mode === "reject") return Promise.reject(plan.error || new TypeError("Failed to fetch"));
  const status = plan.status === undefined ? 200 : plan.status;
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (plan.mode === "badjson"
      ? Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0"))
      : Promise.resolve(typeof plan.body === "function" ? plan.body() : copy(plan.body))),
  });
}

async function runConvert(options = {}, code = SOURCE) {
  const {
    q = QUOTE,
    dup = { body: [] },
    items = { body: SERVER_ROWS },
    confirm = true,
    accountant = false,
    header = { ok: true, data: { id: INV_ID, inv_no: SERVER_NO } },
    itemResult = () => ({ ok: true }),
    patch = { ok: true },
    reloadThrows = false,
    lineItems = [],
    loadFailed = false,
    hooks = {},
    invoke = null,
  } = options;

  const ledger = [];
  const toasts = [];
  const logs = { warn: [], error: [] };
  let confirmCalls = 0;
  let itemInsertIndex = 0;
  const lineItemsRef = lineItems.map((x) => ({ ...x }));
  const lineItemsSnapshot = copy(lineItemsRef);

  const sandbox = {
    ...DOC_ITEMS,
    _qtConvertInflight: false,
    _lineItems: lineItemsRef,
    _lineItemsLoadFailed: loadFailed,
    _viewMode: "preview",
    _denyWriteForAccountant: () => accountant,
    Date: FrozenDate,
    console: {
      warn: (...a) => logs.warn.push(a.map(String).join(" ")),
      error: (...a) => logs.error.push(a.map(String).join(" ")),
      log: () => {},
    },
  };
  const api = { setLineItems: (v) => { sandbox._lineItems = v; }, call: null };
  const toast = (via) => (m) => { toasts.push({ via, msg: m }); ledger.push({ m: "TOAST", msg: m }); };

  // plan ใด ๆ อาจเป็นฟังก์ชัน (เลือกตามรอบการเรียก — ใช้ใน P5)
  const pick = (v) => (typeof v === "function" ? v() : v);
  sandbox.fetch = async (url, init) => {
    ledger.push({ m: (init && init.method) || "GET", url, headers: copy(init && init.headers) });
    if (url === dupUrl(q.id)) {
      if (hooks.onDupFetch) await hooks.onDupFetch(api);
      return respond(pick(dup));
    }
    if (url === itemUrl(q.id)) {
      if (hooks.onItemFetch) await hooks.onItemFetch(api);
      return respond(pick(items));
    }
    ledger.push({ m: "UNEXPECTED-FETCH", url });
    throw new Error("unexpected fetch url: " + url);
  };
  sandbox._ctx = {
    showToast: toast("ctx"),
    showRoute: (r) => { ledger.push({ m: "ROUTE", r }); },
    loadAllData: async () => {
      ledger.push({ m: "RELOAD" });
      if (hooks.onReload) await hooks.onReload(api);
      if (reloadThrows) throw new Error("reload failed");
    },
  };
  sandbox.window = {
    SUPABASE_CONFIG: CFG,
    _sbAccessToken: TOKEN,
    App: {
      showToast: toast("app"),
      confirm: async (text) => {
        confirmCalls++;
        ledger.push({ m: "CONFIRM", text });
        if (hooks.onConfirm) await hooks.onConfirm(api);
        return pick(confirm);
      },
    },
    _appXhrPost: async (table, payload, opts) => {
      ledger.push({ m: "POST", table, payload: copy(payload), opts: copy(opts) });
      if (table === "delivery_invoices") {
        if (hooks.onHeaderPost) await hooks.onHeaderPost(api);
        return pick(header);
      }
      if (table === "delivery_invoice_items") {
        const idx = itemInsertIndex++;
        if (hooks.onItemInsert) await hooks.onItemInsert(api, idx);
        return itemResult(idx);
      }
      throw new Error("unexpected POST table: " + table);
    },
    _appXhrPatch: async (table, payload, col, val) => {
      ledger.push({ m: "PATCH", table, payload: copy(payload), col, val });
      if (hooks.onPatch) await hooks.onPatch(api);
      if (table === "quotations") return patch;
      throw new Error("unexpected PATCH table: " + table);
    },
    // ห้ามมีใครเรียก — มีไว้ให้ ledger จับได้ถ้าโผล่มา (rollback/delete/retry)
    _appXhrPut: async (...a) => { ledger.push({ m: "PUT", args: copy(a) }); return { ok: true }; },
    _appXhrDelete: async (...a) => { ledger.push({ m: "DELETE", args: copy(a) }); return { ok: true }; },
  };

  const ctx = vm.createContext(sandbox);
  const fn = vm.runInContext(`${code}\nconvertToDeliveryInvoice`, ctx);
  api.call = () => fn(q);

  let thrown;
  try {
    if (invoke) await invoke(fn, q, api);
    else await fn(q);
  } catch (e) {
    thrown = e;   // ต้องไม่มี — scenario assert เอง (ไม่ให้ crash กลายเป็น kill)
  }

  return {
    ledger, toasts, logs, sandbox, confirmCalls, thrown, lineItemsRef, lineItemsSnapshot,
    msgs: toasts.map((t) => t.msg),
    posts: ledger.filter((e) => e.m === "POST"),
    itemPosts: ledger.filter((e) => e.m === "POST" && e.table === "delivery_invoice_items"),
    patches: ledger.filter((e) => e.m === "PATCH"),
    gets: ledger.filter((e) => e.m === "GET"),
  };
}

// ── ledger fragments ──
const GET_DUP = (id = 900) => ({ m: "GET", url: dupUrl(id), headers: AUTH });
const GET_ITEMS = (id = 900) => ({ m: "GET", url: itemUrl(id), headers: AUTH });
const CONFIRM = { m: "CONFIRM", text: MSG.CONFIRM };
const TOAST = (msg) => ({ m: "TOAST", msg });
const POST_HEADER = (payload = QUOTE_HEADER) => ({ m: "POST", table: "delivery_invoices", payload, opts: { returnData: true } });
const POST_ITEMS = (rows = EXPECTED_ITEMS) => rows.map((payload) => ({ m: "POST", table: "delivery_invoice_items", payload, opts: undefined }));
const PATCH_QT = (id = 900) => ({ m: "PATCH", table: "quotations", payload: { status: "invoiced" }, col: "id", val: id });
const RELOAD = { m: "RELOAD" };
const ROUTE = { m: "ROUTE", r: "delivery_invoices" };
const SUCCESS_LEDGER = [
  GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.PROGRESS), POST_HEADER(), ...POST_ITEMS(), PATCH_QT(), RELOAD,
  TOAST(okToast(SERVER_NO)), ROUTE,
];

// state กลางของฟอร์ม/preview ต้องไม่ถูกอ่านเป็น source และไม่ถูกเขียน
function assertStateUntouched(r, label) {
  assert.equal(r.sandbox._lineItems, r.lineItemsRef, `${label}: ห้าม reassign _lineItems`);
  assert.deepEqual(copy(r.sandbox._lineItems), r.lineItemsSnapshot, `${label}: ห้ามแก้เนื้อหา _lineItems`);
}

function assertNoWrites(r, label, { loadFailed = false } = {}) {
  assert.equal(r.thrown, undefined, `${label}: ห้าม throw หลุด — ${r.thrown && r.thrown.message}`);
  assert.deepEqual(r.ledger.filter((e) => ["POST", "PATCH", "PUT", "DELETE"].includes(e.m)), [], `${label}: write ต้อง = 0`);
  assert.deepEqual(r.ledger.filter((e) => e.m === "RELOAD" || e.m === "ROUTE"), [], `${label}: ห้าม reload/route`);
  assert.equal(r.msgs.some((m) => m.startsWith("สร้างใบส่งสินค้าแล้ว")), false, `${label}: ห้ามมี success toast`);
  assert.equal(r.sandbox._qtConvertInflight, false, `${label}: inflight flag ต้องถูกคืนใน finally`);
  assert.equal(r.sandbox._viewMode, "preview", `${label}: ห้ามแตะ _viewMode`);
  assert.equal(r.sandbox._lineItemsLoadFailed, loadFailed, `${label}: ห้ามแตะ _lineItemsLoadFailed`);
  assertStateUntouched(r, label);
}

// ═══════════════════════════════════════════════════════════
//  scenarios — ใช้ทั้งตอน repaired (ต้องผ่าน) และตอน mutant (ต้องแดง)
// ═══════════════════════════════════════════════════════════
const S = {};

// ── §5.1 duplicate lookup fail closed ──
S["D1 duplicate HTTP 500 (body []) → uncertainty · ไม่ confirm · 0 write"] = async (code) => {
  const r = await runConvert({ dup: { status: 500, body: [] } }, code);
  assertNoWrites(r, "D1");
  assert.deepEqual(r.ledger, [GET_DUP(), TOAST(MSG.DUP_FAIL)], "D1: หยุดที่ lookup · ข้อความ uncertainty เป๊ะ");
  assert.equal(r.confirmCalls, 0, "D1: ห้าม fallback ไป confirm");
  assert.equal(r.logs.warn.length, 1, "D1: ต้อง console.warn หนึ่งครั้ง");
};
S["D2 duplicate network rejection → uncertainty"] = async (code) => {
  const r = await runConvert({ dup: { mode: "reject" } }, code);
  assertNoWrites(r, "D2");
  assert.deepEqual(r.ledger, [GET_DUP(), TOAST(MSG.DUP_FAIL)]);
  assert.equal(r.confirmCalls, 0, "D2: ห้าม fallback ไป confirm");
  assert.equal(r.logs.warn.length, 1);
};
S["D3 duplicate malformed JSON (HTTP 200) → uncertainty"] = async (code) => {
  const r = await runConvert({ dup: { mode: "badjson" } }, code);
  assertNoWrites(r, "D3");
  assert.deepEqual(r.ledger, [GET_DUP(), TOAST(MSG.DUP_FAIL)]);
  assert.equal(r.confirmCalls, 0, "D3: ห้ามถือว่า JSON พัง = ไม่มีใบซ้ำ");
};
S["D4 duplicate payload ไม่ใช่ array → uncertainty"] = async (code) => {
  for (const body of [null, { inv_no: "INV-1", status: "pending" }, "INV-1", 7, true]) {
    const r = await runConvert({ dup: { body } }, code);
    assertNoWrites(r, `D4(${JSON.stringify(body)})`);
    assert.deepEqual(r.ledger, [GET_DUP(), TOAST(MSG.DUP_FAIL)], `D4(${JSON.stringify(body)})`);
    assert.equal(r.confirmCalls, 0, `D4(${JSON.stringify(body)}): ห้าม confirm`);
  }
};
const BAD_ROWS = [
  ["row = null", [null]],
  ["row = undefined", [undefined]],
  ["row = {} (ไม่มี status)", [{}]],
  ["status = null", [{ inv_no: "INV-1", status: null }]],
  ["status = empty string", [{ inv_no: "INV-1", status: "" }]],
  ["status = whitespace", [{ inv_no: "INV-1", status: "   " }]],
  ["status = number", [{ inv_no: "INV-1", status: 1 }]],
  ["status = object", [{ inv_no: "INV-1", status: { v: "pending" } }]],
  ["row = primitive string", ["INV-1"]],
  ["row = primitive number", [7]],
  ["row = array", [["INV-1", "pending"]]],
  ["mixed: cancelled ที่ valid + row null", [{ inv_no: "INV-1", status: "cancelled" }, null]],
  ["mixed: active ที่ valid + row {}", [{ inv_no: "INV-1", status: "pending" }, {}]],
  ["mixed: cancelled ที่ valid + blank status", [{ inv_no: "INV-1", status: "cancelled" }, { inv_no: "INV-2", status: " " }]],
];
S["D5 duplicate row จำแนกไม่ได้ (validate ทุกแถวก่อน filter) → uncertainty"] = async (code) => {
  for (const [label, body] of BAD_ROWS) {
    const r = await runConvert({ dup: { body } }, code);
    assertNoWrites(r, `D5(${label})`);
    assert.deepEqual(r.ledger, [GET_DUP(), TOAST(MSG.DUP_FAIL)],
      `D5(${label}): ต้องเป็น uncertainty เท่านั้น — ห้ามผ่านไปสร้าง และห้าม toast "มีใบส่งสินค้า undefined"`);
    assert.equal(r.confirmCalls, 0, `D5(${label}): ห้ามถาม confirm`);
  }
};
S["D6 duplicate มีใบ active → block toast เดิม (Phase 409) · ไม่ confirm · 0 write"] = async (code) => {
  for (const [body, list] of [
    [[{ inv_no: "INV-ACTIVE", status: "pending" }], "INV-ACTIVE"],
    [[{ inv_no: "INV-A", status: "pending" }, { inv_no: "INV-X", status: "cancelled" }, { inv_no: "INV-B", status: "paid" }], "INV-A, INV-B"],
  ]) {
    const r = await runConvert({ dup: { body } }, code);
    assertNoWrites(r, `D6(${list})`);
    assert.deepEqual(r.ledger, [GET_DUP(), TOAST(blockToast(list))], `D6(${list}): block toast เดิมเป๊ะ`);
    assert.equal(r.confirmCalls, 0, "D6: บล็อก ไม่ใช่ confirm");
    assert.equal(r.logs.warn.length, 0, "D6: block ไม่ใช่ uncertainty");
  }
};
S["D7 duplicate cancelled-only → confirm แล้วสร้างได้ (ledger เต็ม)"] = async (code) => {
  const r = await runConvert({
    dup: { body: [{ inv_no: "INV-OLD-1", status: "cancelled" }, { inv_no: "INV-OLD-2", status: "cancelled" }] },
  }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger, SUCCESS_LEDGER, "D7: cancelled ไม่บล็อก — ledger ต้องตรงทั้งลำดับ/payload");
  assert.equal(r.confirmCalls, 1);
};
S["D8 ยกเลิก confirm → ไม่โหลดรายการ · 0 write · ไม่มี toast"] = async (code) => {
  const r = await runConvert({ confirm: false }, code);
  assertNoWrites(r, "D8");
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM], "D8: หยุดทันทีหลังผู้ใช้ยกเลิก");
};

// ── §5.2 persisted-only source ──
S["S1 _lineItems ปนเปื้อน (ใบอื่น + ฟอร์มยังไม่บันทึก) → ใช้แถว DB ของ q.id เท่านั้น (ledger เต็ม)"] = async (code) => {
  const r = await runConvert({ lineItems: POISON }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.gets, [GET_DUP(), GET_ITEMS()], "S1: ต้อง fetch รายการของ q.id ใหม่เสมอ แม้ _lineItems ไม่ว่าง");
  assert.deepEqual(r.itemPosts.map((p) => p.payload), EXPECTED_ITEMS, "S1: รายการต้องมาจากแถว DB ไม่ใช่ _lineItems");
  assert.deepEqual(r.ledger, SUCCESS_LEDGER, "S1: fetch รายการใหม่เสมอ · payload ทุก field จาก DB snapshot");
  assert.equal(r.msgs.some((m) => m.includes("QT-OTHER") || m.includes("ยังไม่บันทึก")), false);
  assertStateUntouched(r, "S1");
  assert.equal(r.sandbox._viewMode, "list");
  assert.equal(r.sandbox._qtConvertInflight, false);
};
S["S2 _lineItems ปนเปื้อน + DB ว่าง → NO_ITEMS · 0 write (ห้ามออกใบจาก cache)"] = async (code) => {
  const r = await runConvert({ lineItems: POISON, items: { body: [] } }, code);
  assertNoWrites(r, "S2");
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.NO_ITEMS)]);
};
S["S3 _lineItems มีสินค้า + DB มีแต่หัวข้อ → countable gate ใช้ snapshot · 0 write"] = async (code) => {
  const r = await runConvert({ lineItems: POISON, items: { body: HEADING_ONLY_ROWS } }, code);
  assertNoWrites(r, "S3");
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.NO_ITEMS)]);
};
S["S4 _lineItems ถูกเขียนทับระหว่างทุก await → snapshot นิ่ง"] = async (code) => {
  const junk = (tag) => [{ product_id: 1, item_name: "แทรก " + tag, qty: 9, unit: "ชิ้น", unit_price: 9, discount_pct: 0, line_total: 81, item_type: "item" }];
  const r = await runConvert({
    lineItems: POISON,
    hooks: {
      onDupFetch: (a) => a.setLineItems(junk("dup")),
      onConfirm: (a) => a.setLineItems(junk("confirm")),
      onItemFetch: (a) => a.setLineItems(junk("items")),
      onHeaderPost: (a) => a.setLineItems([]),
      onItemInsert: (a, i) => a.setLineItems(junk("insert " + i)),
    },
  }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.itemPosts.map((p) => p.payload), EXPECTED_ITEMS, "S4: ทุก item payload มาจาก snapshot ตอนโหลด");
  assert.equal(r.ledger.at(-2).msg, okToast(SERVER_NO), "S4: จบแบบสำเร็จ");
};
S["S5 state กลาง (_lineItems ว่าง · _lineItemsLoadFailed=true) → ไม่อ่าน/ไม่เขียน · ใช้ DB"] = async (code) => {
  const r = await runConvert({ lineItems: [], loadFailed: true }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger, SUCCESS_LEDGER, "S5: flag ของฟอร์มไม่ใช่ gate ของการแปลง");
  assert.equal(r.sandbox._lineItemsLoadFailed, true, "S5: ห้ามเขียน _lineItemsLoadFailed");
  assertStateUntouched(r, "S5");
};
S["S6 item HTTP 503 (body เป็น array ที่ใช้ได้) → ITEM_FAIL · 0 write"] = async (code) => {
  for (const lineItems of [[], POISON]) {
    const r = await runConvert({ lineItems, items: { status: 503, body: SERVER_ROWS } }, code);
    assertNoWrites(r, `S6(cache ${lineItems.length})`);
    assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.ITEM_FAIL)], `S6(cache ${lineItems.length})`);
    assert.equal(r.logs.error.length, 1, "S6: ต้อง log");
  }
};
S["S7 item network rejection → ITEM_FAIL · 0 write"] = async (code) => {
  const r = await runConvert({ items: { mode: "reject" } }, code);
  assertNoWrites(r, "S7");
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.ITEM_FAIL)]);
};
S["S8 item malformed JSON → ITEM_FAIL · 0 write"] = async (code) => {
  const r = await runConvert({ items: { mode: "badjson" } }, code);
  assertNoWrites(r, "S8");
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.ITEM_FAIL)]);
};
S["S9 item payload ไม่ใช่ array / แถว null → ITEM_FAIL · 0 write"] = async (code) => {
  for (const body of [null, { rows: SERVER_ROWS }, "x", 3, [SERVER_ROWS[1], null]]) {
    const r = await runConvert({ items: { body } }, code);
    assertNoWrites(r, `S9(${JSON.stringify(body).slice(0, 30)})`);
    assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.ITEM_FAIL)], `S9(${JSON.stringify(body).slice(0, 30)})`);
  }
};
S["S10 DB ว่าง / มีแต่หัวข้อ → NO_ITEMS · 0 write"] = async (code) => {
  for (const body of [[], HEADING_ONLY_ROWS, [SERVER_ROWS[0]]]) {
    const r = await runConvert({ items: { body } }, code);
    assertNoWrites(r, `S10(${body.length})`);
    assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.NO_ITEMS)], `S10(${body.length})`);
  }
};

// ── §5.3 header ──
S["H1 header ok:false → error toast · ไม่มี write ต่อ"] = async (code) => {
  const r = await runConvert({ header: { ok: false, error: { message: "duplicate key" } } }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.PROGRESS), POST_HEADER(), TOAST("duplicate key")]);
  const r2 = await runConvert({ header: { ok: false } }, code);
  assert.deepEqual(r2.ledger.slice(-1), [TOAST("สร้างไม่สำเร็จ")], "H1: ข้อความ fallback เดิม");
  assert.equal(r2.sandbox._qtConvertInflight, false);
};
S["H2 header ok:true แต่ไม่มี id → containment (ไม่มี items/PATCH/reload/route/rollback)"] = async (code) => {
  for (const data of [null, undefined, {}, { inv_no: SERVER_NO }, { id: null, inv_no: SERVER_NO }, { id: "" }]) {
    const r = await runConvert({ header: { ok: true, data } }, code);
    const label = `H2(${JSON.stringify(data)})`;
    assert.equal(r.thrown, undefined, label);
    assert.deepEqual(r.ledger.filter((e) => ["POST", "PATCH", "PUT", "DELETE", "RELOAD", "ROUTE"].includes(e.m)), [POST_HEADER()],
      `${label}: หลัง header ที่ไม่มี id ห้ามมี items/PATCH/reload/route/rollback`);
    assert.equal(r.msgs.at(-1), MSG.NO_ID, `${label}: terminal = อาจสร้างแล้วแต่ยืนยันรหัสไม่ได้`);
    assert.deepEqual(r.ledger, [GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.PROGRESS), POST_HEADER(), TOAST(MSG.NO_ID)],
      `${label}: header call เดียวแล้วหยุด · ข้อความห้ามบอกว่ายังไม่ได้สร้าง`);
    assert.equal(r.logs.error.length, 1, `${label}: ต้อง log`);
    assert.equal(r.sandbox._viewMode, "preview", label);
    assert.equal(r.sandbox._qtConvertInflight, false, `${label}: flag ต้องถูกคืนใน finally`);
  }
};

// ── §5.4 partial write truth ──
S["W1 item insert ล้มบางแถว → เดินครบ · PATCH ยังเดิน · terminal = warn (ไม่มี success)"] = async (code) => {
  const r = await runConvert({ itemResult: (i) => ({ ok: i !== 1 && i !== 3 }) }, code);
  assert.equal(r.thrown, undefined);
  assert.equal(r.msgs.at(-1), warnToast(SERVER_NO), "W1: success ห้ามทับคำเตือน — ข้อความสุดท้ายต้องเป็น warn");
  assert.deepEqual(r.ledger, [
    GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.PROGRESS), POST_HEADER(), ...POST_ITEMS(),
    TOAST(itemWarn(SERVER_NO, 2, "แอร์ 12000 BTU, ท่อทองแดง")),
    PATCH_QT(), RELOAD, TOAST(warnToast(SERVER_NO)), ROUTE,
  ], "W1: ไม่ rollback/retry · คำเตือนระหว่างทางคงเดิม · ข้อความสุดท้าย = warn");
  assert.equal(r.msgs.includes(okToast(SERVER_NO)), false, "W1: ห้ามมี success toast");
  assert.equal(r.sandbox._viewMode, "list");
};
S["W2 PATCH quotations ล้ม → STATUS_FAIL + terminal warn"] = async (code) => {
  const r = await runConvert({ patch: { ok: false, error: { message: "rls" } } }, code);
  assert.equal(r.thrown, undefined);
  assert.equal(r.msgs.at(-1), warnToast(SERVER_NO), "W2: success ห้ามทับคำเตือน status");
  assert.deepEqual(r.ledger, [
    GET_DUP(), CONFIRM, GET_ITEMS(), TOAST(MSG.PROGRESS), POST_HEADER(), ...POST_ITEMS(),
    PATCH_QT(), TOAST(MSG.STATUS_FAIL), RELOAD, TOAST(warnToast(SERVER_NO)), ROUTE,
  ]);
  assert.equal(r.msgs.includes(okToast(SERVER_NO)), false);
};
S["W3 item + PATCH ล้มพร้อมกัน → terminal warn ครั้งเดียว"] = async (code) => {
  const r = await runConvert({ itemResult: () => ({ ok: false }), patch: { ok: false } }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger.slice(-6), [
    TOAST(itemWarn(SERVER_NO, 4, "หมวด งานติดตั้ง, แอร์ 12000 BTU, ค่าติดตั้ง")),
    PATCH_QT(), TOAST(MSG.STATUS_FAIL), RELOAD, TOAST(warnToast(SERVER_NO)), ROUTE,
  ]);
  assert.equal(r.msgs.filter((m) => m === warnToast(SERVER_NO)).length, 1);
  assert.equal(r.msgs.includes(okToast(SERVER_NO)), false);
};
S["W4 reload throw หลังสร้างครบ → success + route · ไม่ throw หลุด"] = async (code) => {
  const r = await runConvert({ reloadThrows: true }, code);
  assert.deepEqual(r.ledger.slice(-3), [RELOAD, TOAST(okToast(SERVER_NO)), ROUTE], "W4: reload ล้มแล้วยังต้องมี terminal toast + route");
  assert.deepEqual(r.ledger, SUCCESS_LEDGER, "W4: terminal result + route ต้องยังเกิด");
  assert.equal(r.thrown, undefined, "W4: reload error ห้ามหลุดออกจากฟังก์ชัน");
  assert.equal(r.logs.warn.length, 1, "W4: reload failure ต้องถูก log");
  assert.equal(r.sandbox._viewMode, "list");
  assert.equal(r.sandbox._qtConvertInflight, false);
};
S["W5 reload throw หลัง partial → warn + route"] = async (code) => {
  const r = await runConvert({ reloadThrows: true, itemResult: (i) => ({ ok: i !== 0 }) }, code);
  assert.deepEqual(r.ledger.slice(-5), [
    TOAST(itemWarn(SERVER_NO, 1, "หมวด งานติดตั้ง")), PATCH_QT(), RELOAD, TOAST(warnToast(SERVER_NO)), ROUTE,
  ]);
  assert.equal(r.thrown, undefined);
};

// ── positive / contract ──
S["P1 สำเร็จเต็ม: ledger exact · header เงินเดิม · item ทุก field + item_type + sort_order"] = async (code) => {
  const r = await runConvert({}, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger, SUCCESS_LEDGER);
  assert.deepEqual(r.logs, { warn: [], error: [] }, "P1: ไม่มี warning/error");
  assert.equal(r.sandbox._viewMode, "list");
  assert.equal(r.sandbox._qtConvertInflight, false);
  assertStateUntouched(r, "P1");
};
S["P2 ใบเก่า field ขาด → header fallback เดิมทุกช่อง"] = async (code) => {
  const rows = [{ product_id: 5, item_name: "สินค้าเก่า", qty: 1, unit: "ชิ้น", unit_price: 1400, discount_pct: 0, line_total: 1400, sort_order: 1 }];
  const r = await runConvert({ q: SPARSE_QUOTE, items: { body: rows } }, code);
  assert.equal(r.thrown, undefined);
  assert.deepEqual(r.ledger, [
    GET_DUP(901), CONFIRM, GET_ITEMS(901), TOAST(MSG.PROGRESS), POST_HEADER(SPARSE_HEADER),
    ...POST_ITEMS([{ delivery_invoice_id: INV_ID, product_id: 5, item_name: "สินค้าเก่า", qty: 1, unit: "ชิ้น", unit_price: 1400, discount_pct: 0, line_total: 1400, item_type: "item", sort_order: 1 }]),
    PATCH_QT(901), RELOAD, TOAST(okToast(SERVER_NO)), ROUTE,
  ]);
  const r2 = await runConvert({ header: { ok: true, data: { id: INV_ID } } }, code);
  assert.equal(r2.ledger.at(-2).msg, okToast(EXPECTED_INV_NO), "P2: DB ไม่คืนเลข → fallback เลขที่ส่งไป");
};
S["P3 accountant → บล็อกก่อนทุก request · flag ไม่ถูกจับ"] = async (code) => {
  const r = await runConvert({ accountant: true, lineItems: POISON }, code);
  assert.deepEqual(r.ledger, []);
  assert.equal(r.sandbox._qtConvertInflight, false);
  assertStateUntouched(r, "P3");
};
for (const [label, hookName] of [
  ["duplicate fetch", "onDupFetch"],
  ["confirm", "onConfirm"],
  ["item fetch", "onItemFetch"],
  ["header POST", "onHeaderPost"],
  ["item insert", "onItemInsert"],
  ["PATCH", "onPatch"],
  ["reload", "onReload"],
]) {
  S[`P4 double trigger ระหว่างรอ ${label} → ใบเดียว + toast กำลังทำงาน`] = async (code) => {
    let fired = 0;
    const r = await runConvert({ hooks: { [hookName]: async (a) => { if (fired++) return; await a.call(); } } }, code);
    assert.ok(fired >= 1, "hook ต้องถูกเรียก");
    assert.equal(r.thrown, undefined);
    assert.deepEqual(r.ledger.filter((e) => e.m !== "TOAST"), SUCCESS_LEDGER.filter((e) => e.m !== "TOAST"),
      `${label}: request/write ต้องเท่ารอบเดียวพอดี`);
    assert.deepEqual(r.toasts.filter((t) => t.via === "app").map((t) => t.msg), [MSG.BUSY], `${label}: trigger ซ้ำได้ toast กำลังทำงาน`);
    assert.equal(r.msgs.at(-1), okToast(SERVER_NO));
    assert.equal(r.sandbox._qtConvertInflight, false);
  };
}
S["P5 early return ทุกแบบคืน flag ใน finally → รอบถัดไปสร้างได้"] = async (code) => {
  const OK_HEADER = { ok: true, data: { id: INV_ID, inv_no: SERVER_NO } };
  for (const [label, first] of [
    ["uncertainty", { dup: { status: 500, body: [] } }],
    ["block", { dup: { body: [{ inv_no: "INV-A", status: "pending" }] } }],
    ["confirm ยกเลิก", { confirm: false }],
    ["item fail", { items: { status: 500, body: [] } }],
    ["no items", { items: { body: [] } }],
    ["header fail", { header: { ok: false } }],
    ["missing id", { header: { ok: true, data: {} } }],
  ]) {
    let round = 0;
    // รอบแรกใช้ plan ที่ทำให้ early return · รอบสองใช้ plan ปกติ
    const pick = (key, normal) => () => (round === 1 && key in first ? first[key] : normal);
    const r = await runConvert({
      dup: pick("dup", { body: [] }),
      items: pick("items", { body: SERVER_ROWS }),
      confirm: pick("confirm", true),
      header: pick("header", OK_HEADER),
      invoke: async (fn, q) => { round = 1; await fn(q); round = 2; await fn(q); },
    }, code);
    assert.equal(r.thrown, undefined, label);
    assert.equal(r.toasts.some((t) => t.via === "app" && t.msg === MSG.BUSY), false, `${label}: ห้ามติด inflight ค้าง`);
    assert.equal(r.msgs.at(-1), okToast(SERVER_NO), `${label}: รอบสองต้องสร้างได้`);
    assert.deepEqual(r.itemPosts.map((p) => p.payload), EXPECTED_ITEMS, `${label}: รอบสองได้รายการครบ`);
    assert.equal(r.sandbox._qtConvertInflight, false, label);
  }
};

// ═══════════════════════════════════════════════════════════
//  repaired build ต้องเขียวทุก scenario
// ═══════════════════════════════════════════════════════════
for (const [name, run] of Object.entries(S)) {
  test(`[behavioral] ${name}`, async () => { await run(SOURCE); });
}

// ═══════════════════════════════════════════════════════════
//  structural (ไม่นับเป็นหลักฐาน behavior)
// ═══════════════════════════════════════════════════════════
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("[structural] ข้อความสัญญา §5 อยู่ใน source ของฟังก์ชัน — กัน test/source สะกดเพี้ยนกัน", () => {
  for (const [k, v] of Object.entries(MSG)) assert.ok(SOURCE.includes(v), `source ต้องมีข้อความ ${k}: ${v}`);
  assert.ok(SOURCE.includes('"สร้างใบส่งสินค้าแล้ว: " + realInvNo'), "success toast ต้องคงรูปเดิม");
  assert.ok(SOURCE.includes("⚠️ สร้างใบส่งสินค้า ${realInvNo} แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ"), "terminal warning ต้องอยู่ใน source");
});

test("[structural] ฟังก์ชันไม่อ้าง _lineItems / _lineItemsLoadFailed (ไม่นับ comment)", () => {
  const code = stripComments(SOURCE);
  assert.ok(!/\b_lineItems\b/.test(code), "ห้ามอ่าน/เขียน _lineItems ในการแปลง");
  assert.ok(!/\b_lineItemsLoadFailed\b/.test(code), "ห้ามอ่าน/เขียน _lineItemsLoadFailed ในการแปลง");
});

test("[structural] ทางเข้า 3 จุด (dropdown · ฟอร์มแก้ไข · preview) ยังเรียก convertToDeliveryInvoice(q)", () => {
  const outside = MODULE_SRC.split(SOURCE).join("");
  assert.match(outside, /\} else if \(action === "convert"\) \{\s*convertToDeliveryInvoice\(q\);/, "dropdown แถว");
  assert.match(outside, /getElementById\("qtConvertFromForm"\)\?\.addEventListener\("click", \(\) => \{[\s\S]{0,160}?if \(q\) convertToDeliveryInvoice\(q\);/, "ปุ่มในฟอร์มแก้ไข");
  assert.match(outside, /getElementById\("qtConvertBtn"\)\?\.addEventListener\("click", \(\) => convertToDeliveryInvoice\(q\)\)/, "ปุ่มใน preview");
  assert.equal(outside.split("convertToDeliveryInvoice(q)").length - 1, 3, "ต้องมี call site 3 จุดพอดี");
});

// ═══════════════════════════════════════════════════════════
//  mutation matrix — single-defect · parse ได้ · production-reachable
//  ต้องถูกฆ่าโดย scenario ที่ระบุ ด้วย ERR_ASSERTION (ไม่นับ crash / ไม่นับ source-regex)
// ═══════════════════════════════════════════════════════════
const MUTANTS = [
  {
    id: "MUT-01", why: "ถอด duplicate response.ok gate",
    from: '      if (!chkResp.ok) throw new Error("HTTP " + chkResp.status);\n',
    to: "",
    killer: "D1 duplicate HTTP 500 (body []) → uncertainty · ไม่ confirm · 0 write",
  },
  {
    id: "MUT-02", why: "คืน duplicate JSON .catch(() => [])",
    from: "      const existing = await chkResp.json();",
    to: "      const existing = await chkResp.json().catch(() => []);",
    killer: "D3 duplicate malformed JSON (HTTP 200) → uncertainty",
  },
  {
    id: "MUT-03", why: "duplicate non-array → []",
    from: '      const existing = await chkResp.json();\n      if (!Array.isArray(existing)) throw new Error("duplicate lookup payload ไม่ใช่ array");\n',
    to: "      const rawExisting = await chkResp.json();\n      const existing = Array.isArray(rawExisting) ? rawExisting : [];\n",
    killer: "D4 duplicate payload ไม่ใช่ array → uncertainty",
  },
  {
    id: "MUT-04", why: "ถอด row/status validation ทั้ง loop (คืน filter(d => d && …) แบบทิ้งแถว falsy)",
    from: /^ {6}for \(const row of existing\) \{[\s\S]*?^ {6}\}\n {6}const active = existing\.filter\(d => d\.status !== "cancelled"\);\n/m,
    to: '      const active = existing.filter(d => d && d.status !== "cancelled");\n',
    killer: "D5 duplicate row จำแนกไม่ได้ (validate ทุกแถวก่อน filter) → uncertainty",
  },
  {
    id: "MUT-05", why: "ถอด status validation (เหลือแค่ object check)",
    from: '        if (typeof row.status !== "string" || row.status.trim() === "") throw new Error("duplicate row ไม่มี status ที่จำแนกได้");\n',
    to: "",
    killer: "D5 duplicate row จำแนกไม่ได้ (validate ทุกแถวก่อน filter) → uncertainty",
  },
  {
    id: "MUT-06", why: "คืน duplicate catch → confirm fallback",
    from: '      window.App?.showToast?.("ตรวจสอบใบส่งสินค้าเดิมไม่สำเร็จ — ยังไม่สร้างใบส่งสินค้า กรุณาลองใหม่");\n      return;',
    to: '      if (!(await window.App?.confirm?.("สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากข้อมูลใบเสนอราคาที่บันทึกล่าสุด?"))) return;',
    killer: "D2 duplicate network rejection → uncertainty",
  },
  {
    id: "MUT-07", why: "คืน _lineItems cache branch (ข้าม fetch เมื่อ cache ไม่ว่าง)",
    from: "    let sourceItems;\n    try {",
    to: "    let sourceItems = _lineItems.length ? _lineItems.slice() : null;\n    if (!sourceItems) try {",
    killer: "S1 _lineItems ปนเปื้อน (ใบอื่น + ฟอร์มยังไม่บันทึก) → ใช้แถว DB ของ q.id เท่านั้น (ledger เต็ม)",
  },
  {
    id: "MUT-08", why: "ใช้ _lineItems (global) ใน item loop แทน snapshot",
    from: "    for (let i = 0; i < sourceItems.length; i++) {\n      const li = sourceItems[i];",
    to: "    for (let i = 0; i < _lineItems.length; i++) {\n      const li = _lineItems[i];",
    killer: "S4 _lineItems ถูกเขียนทับระหว่างทุก await → snapshot นิ่ง",
  },
  {
    id: "MUT-09", why: "ถอด item response.ok gate",
    from: '      if (!resp.ok) throw new Error("HTTP " + resp.status);\n',
    to: "",
    killer: "S6 item HTTP 503 (body เป็น array ที่ใช้ได้) → ITEM_FAIL · 0 write",
  },
  {
    id: "MUT-10", why: "missing id แล้วยังเดินต่อ (items/PATCH/reload/route)",
    from: /^ {4}if \(!invoiceId\) \{\n[\s\S]*?^ {4}\}\n/m,
    to: "",
    killer: "H2 header ok:true แต่ไม่มี id → containment (ไม่มี items/PATCH/reload/route/rollback)",
  },
  {
    id: "MUT-11", why: "terminal toast = success เสมอ",
    from: /^ {4}_ctx\.showToast\(failedItems\.length > 0 \|\| statusFailed\n[\s\S]*?\+ realInvNo\);\n/m,
    to: '    _ctx.showToast("สร้างใบส่งสินค้าแล้ว: " + realInvNo);\n',
    killer: "W1 item insert ล้มบางแถว → เดินครบ · PATCH ยังเดิน · terminal = warn (ไม่มี success)",
  },
  {
    id: "MUT-12", why: "terminal decision ลืม statusFailed",
    from: "    _ctx.showToast(failedItems.length > 0 || statusFailed\n",
    to: "    _ctx.showToast(failedItems.length > 0\n",
    killer: "W2 PATCH quotations ล้ม → STATUS_FAIL + terminal warn",
  },
  {
    id: "MUT-13", why: "reload ไม่มี containment (throw กลบ terminal result)",
    from: /^ {4}try \{ await _ctx\.loadAllData\(\); \} catch\(e\) \{[^\n]*\}\n/m,
    to: "    await _ctx.loadAllData();\n",
    killer: "W4 reload throw หลังสร้างครบ → success + route · ไม่ throw หลุด",
  },
  {
    id: "MUT-14", why: "ถอด countable gate",
    from: /^ {4}if \(countableDocumentItems\(sourceItems\) === 0\) \{\n[\s\S]*?^ {4}\}\n/m,
    to: "",
    killer: "S10 DB ว่าง / มีแต่หัวข้อ → NO_ITEMS · 0 write",
  },
  {
    id: "MUT-15", why: "countable gate นับ _lineItems แทน snapshot",
    from: "    if (countableDocumentItems(sourceItems) === 0) {",
    to: "    if (countableDocumentItems(_lineItems) === 0) {",
    killer: "S3 _lineItems มีสินค้า + DB มีแต่หัวข้อ → countable gate ใช้ snapshot · 0 write",
  },
  {
    id: "MUT-16", why: "ถอด normalizer ตอนโหลด (heading ตัวเลขเพี้ยนหลุดไปใบส่งสินค้า)",
    from: "      })).map(normalizeDocumentItem);",
    to: "      }));",
    killer: "P1 สำเร็จเต็ม: ledger exact · header เงินเดิม · item ทุก field + item_type + sort_order",
  },
  {
    id: "MUT-17", why: "ordering: sort_order เริ่ม 0",
    from: "item_type: li.item_type, sort_order: i + 1",
    to: "item_type: li.item_type, sort_order: i",
    killer: "P1 สำเร็จเต็ม: ledger exact · header เงินเดิม · item ทุก field + item_type + sort_order",
  },
  {
    id: "MUT-18", why: "confirm ข้อความเดิม (ไม่บอกว่าใช้ข้อมูลที่บันทึกล่าสุด)",
    from: '"สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากข้อมูลใบเสนอราคาที่บันทึกล่าสุด?"',
    to: '"สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากใบเสนอราคานี้?"',
    killer: "P1 สำเร็จเต็ม: ledger exact · header เงินเดิม · item ทุก field + item_type + sort_order",
  },
  {
    id: "MUT-19", why: "finally ไม่คืน _qtConvertInflight",
    from: "    _qtConvertInflight = false;\n",
    to: "",
    killer: "P5 early return ทุกแบบคืน flag ใน finally → รอบถัดไปสร้างได้",
  },
  {
    id: "MUT-20", why: "item_type หลุดจาก payload delivery_invoice_items",
    from: "line_total: li.line_total, item_type: li.item_type, sort_order",
    to: "line_total: li.line_total, sort_order",
    killer: "P1 สำเร็จเต็ม: ledger exact · header เงินเดิม · item ทุก field + item_type + sort_order",
  },
];
// Equivalent mutants (ไม่นับคะแนน · ไม่อยู่ใน matrix): ถอด `row === null` / `Array.isArray(row)` /
//   `typeof row !== "object"` ทีละตัว — แถวแบบนั้นยังตกที่ status check (undefined.status → TypeError หรือ
//   status ไม่ใช่ string ที่ไม่ว่าง) แล้วเข้า catch เดิม = toast/ledger เหมือนเดิมทุกกรณีที่ JSON สร้างได้.
//   คง object check ไว้เพราะเป็นสัญญาใน prompt §5.1 (plain object ไม่ใช่ null/array) และอ่านตรงกว่า

function applyOnce(code, { from, to }, id) {
  if (from instanceof RegExp) {
    const all = new RegExp(from.source, from.flags.includes("g") ? from.flags : from.flags + "g");
    const hits = (code.match(all) || []).length;
    assert.equal(hits, 1, `${id}: anchor (regex) ต้องตรงหนึ่งแห่งพอดี (เจอ ${hits})`);
    assert.ok(!/[$]/.test(to), `${id}: to ห้ามมี $ (กัน replacement pattern)`);
    return code.replace(from, to);
  }
  const hits = code.split(from).length - 1;
  assert.equal(hits, 1, `${id}: anchor ต้องตรงหนึ่งแห่งพอดี (เจอ ${hits})`);
  return code.split(from).join(to);
}

for (const m of MUTANTS) {
  test(`[mutation] ${m.id} (${m.why}) → ถูกฆ่าโดย: ${m.killer}`, async () => {
    const mutant = applyOnce(SOURCE, m, m.id);
    assert.notEqual(mutant, SOURCE, `${m.id}: mutant ต้องต่างจาก source`);
    new vm.Script(`${mutant}\nconvertToDeliveryInvoice`);   // parse ได้จริง (ไม่ใช่ kill เพราะ syntax error)
    const run = S[m.killer];
    assert.ok(run, `${m.id}: ไม่พบ scenario ${m.killer}`);
    await assert.rejects(() => run(mutant), (err) => {
      assert.equal(err.code, "ERR_ASSERTION", `${m.id}: ต้องแดงด้วย assertion ไม่ใช่ crash — ได้ ${err.name}: ${err.message}`);
      return true;
    }, `${m.id}: mutant รอด — scenario ${m.killer} ไม่ฆ่ามัน`);
  });
}
