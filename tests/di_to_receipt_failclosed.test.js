// Phase 626 — ใบส่งสินค้า → ใบเสร็จ: prerequisite ต้อง fail closed (behavioral)
//
// invariant: ห้ามสร้างใบเสร็จจนกว่าจะ "พิสูจน์ได้" ครบ 3 ข้อ
//   (1) ไม่มีใบเสร็จ active ซ้ำ — lookup ต้อง HTTP ok + JSON ได้ + เป็น array
//   (2) โหลดรายการของ inv.id ปัจจุบันสำเร็จ (ห้ามใช้ _lineItems preview cache)
//   (3) ใบส่งสินค้ามีรายการอย่างน้อย 1 รายการ
// + R3 header ok:true แต่ไม่มี id → หยุดทุก write ที่เหลือ ห้าม rollback/retry
// + R4 terminal toast ต้องสะท้อน partial state จริง (success ห้ามทับคำเตือน)
//
// วิธีทดสอบ: ดึง source ของ convertToReceipt แบบ brace-aware (Phase 625 ถอด local
// escHtml ออกแล้ว — ห้ามใช้ `function escHtml` เป็น anchor) แล้วรัน "ของจริง" ใน
// node:vm พร้อม stub I/O — assert จาก request ledger จริง ไม่ใช่ regex ของ source.
// Run: node --test tests/di_to_receipt_failclosed.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const MODULE_PATH = new URL("../modules/delivery_invoices.js", import.meta.url);
const MODULE_SRC = readFileSync(MODULE_PATH, "utf8");
const DECL = "async function convertToReceipt(inv) {";

// ═══════════════════════════════════════════════════════════
//  brace-aware extraction (รู้จัก comment / string / template + ${})
// ═══════════════════════════════════════════════════════════
function skipQuoted(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    if (src[i] === "\n") return i;      // string ไม่ควรข้ามบรรทัดในไฟล์นี้
    i++;
  }
  return i;
}

function extractFunction(src, decl) {
  const first = src.indexOf(decl);
  assert.notEqual(first, -1, `ไม่พบ ${decl}`);
  assert.equal(src.indexOf(decl, first + 1), -1, `${decl} ต้องพบครั้งเดียวพอดี (anchor ห้ามกำกวม)`);
  let i = first + decl.length;          // อยู่หลัง { เปิดฟังก์ชันแล้ว
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
//  ข้อความที่ผูกสัญญากับ owner (R1/R3/R4) — ต้องตรงตัวอักษรกับ source
// ═══════════════════════════════════════════════════════════
const MSG = {
  BUSY: "กำลังออกใบเสร็จรับเงิน รอสักครู่...",
  PROGRESS: "กำลังออกใบเสร็จรับเงิน...",
  DUP_FAIL: "ตรวจสอบใบเสร็จเดิมไม่สำเร็จ — ยังไม่สร้างใบเสร็จ กรุณาลองใหม่",
  ITEM_FAIL: "โหลดรายการสินค้าไม่สำเร็จ — ยังไม่สร้างใบเสร็จ กรุณาลองใหม่",
  EMPTY: "ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง",
  NO_ID: "อาจสร้างใบเสร็จแล้ว แต่ยืนยันรหัสไม่ได้ — โปรดตรวจรายการใบเสร็จก่อนลองใหม่",
  STATUS_FAIL: "⚠️ อัปเดตสถานะเอกสารต้นทางไม่สำเร็จ — ใบใหม่ถูกสร้างแล้ว",
  CONFIRM: "ออกใบเสร็จรับเงินจากใบส่งสินค้านี้?",
};
const okToast = (no) => "ออกใบเสร็จรับเงินแล้ว: " + no;
const warnToast = (no) => `⚠️ ออกใบเสร็จ ${no} แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ`;

test("ข้อความสัญญา (R1/R3/R4) อยู่ใน source จริง — กัน test/source สะกดเพี้ยนกัน", () => {
  for (const [k, v] of Object.entries(MSG)) {
    assert.ok(SOURCE.includes(v), `source ต้องมีข้อความ ${k}: ${v}`);
  }
  assert.ok(SOURCE.includes('"ออกใบเสร็จรับเงินแล้ว: " + realReceiptNo'), "terminal success ต้องคงรูปเดิม");
  assert.ok(SOURCE.includes("⚠️ ออกใบเสร็จ ${realReceiptNo} แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ"),
    "terminal warning ต้องอยู่ใน source");
});

// ═══════════════════════════════════════════════════════════
//  fixtures
// ═══════════════════════════════════════════════════════════
const CFG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
const TOKEN = "jwt-fixture";
const AUTH = { apikey: CFG.anonKey, Authorization: "Bearer " + TOKEN };
const dupUrl = (id) => `${CFG.url}/rest/v1/receipts?delivery_invoice_id=eq.${id}&select=receipt_no,status`;
const itemUrl = (id) => `${CFG.url}/rest/v1/delivery_invoice_items?delivery_invoice_id=eq.${id}&order=sort_order.asc`;

const FIXED_MS = 1790000123456;
class FrozenDate extends Date {
  constructor(...a) { if (a.length === 0) super(FIXED_MS); else super(...a); }
  static now() { return FIXED_MS; }
}
const d = new Date(FIXED_MS);
const EXPECTED_RECEIPT_NO = "RC"
  + (d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"))
  + String(FIXED_MS).slice(-6);

const SERVER_NO = "RC20260922000001";
const RECEIPT_ID = 5001;

function invoice(over = {}) {
  return {
    id: 77, inv_no: "INV-0077", quotation_id: 900,
    customer_name: "ลูกค้า ก", customer_phone: "0800000000",
    customer_address: "99 ถนนทดสอบ", customer_tax_id: "1234567890123",
    total_amount: 1000, discount_pct: 5, discount_amount: 50, after_discount: 950,
    grand_total: 950, withholding_tax: true, wht_pct: 3, wht_amount: 28.5,
    payment_terms: "เครดิต 30 วัน", credit_days: 30,
    project_name: "โครงการทดสอบ", salesperson: "พนักงาน ข",
    bank_coa_code: "1102-01", bank_label: "กสิกรไทย",
    ...over,
  };
}

// payload header ที่ต้องไม่เปลี่ยน (เขียนตรง ๆ — ห้าม derive จาก source)
function expectedHeader(inv) {
  return {
    receipt_no: EXPECTED_RECEIPT_NO,
    delivery_invoice_id: inv.id,
    quotation_id: inv.quotation_id || null,
    customer_name: inv.customer_name || "",
    customer_phone: inv.customer_phone || "",
    customer_address: inv.customer_address || "",
    customer_tax_id: inv.customer_tax_id || "",
    total_amount: inv.total_amount || 0,
    discount_pct: inv.discount_pct || 0,
    discount_amount: inv.discount_amount || 0,
    after_discount: inv.after_discount || inv.total_amount || 0,
    grand_total: inv.grand_total || 0,
    withholding_tax: inv.withholding_tax || false,
    wht_pct: inv.wht_pct || 3,
    wht_amount: inv.wht_amount || 0,
    net_total: inv.grand_total || 0,
    payment_method: inv.payment_terms || "เงินสด",
    payment_terms: inv.payment_terms || "เงินสด",
    credit_days: inv.credit_days || 0,
    project_name: inv.project_name || "",
    ref_no: inv.inv_no || "",
    salesperson: inv.salesperson || "",
    status: "pending",
    bank_coa_code: inv.bank_coa_code || null,
    bank_label: inv.bank_label || null,
    note: "จากใบส่งสินค้า " + (inv.inv_no || ""),
  };
}

const SERVER_ROWS = [
  { product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, sort_order: 1 },
  { product_id: null, item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, discount_pct: 0, line_total: 2500, sort_order: 2 },
  { product_id: 13, item_name: "ท่อทองแดง", qty: 5, unit: "เมตร", unit_price: 220, discount_pct: 0, line_total: 1100, sort_order: 3 },
];
// preview cache ของ "ใบอื่น" — ห้ามหลุดเข้าใบเสร็จเด็ดขาด
const STALE_CACHE = [
  { product_id: 99, item_name: "ของใบอื่น-A", qty: 7, unit: "ชิ้น", unit_price: 1, discount_pct: 0, line_total: 7 },
  { product_id: 98, item_name: "ของใบอื่น-B", qty: 8, unit: "ชิ้น", unit_price: 2, discount_pct: 0, line_total: 16 },
];

function expectedItemPayload(row, index, receiptId = RECEIPT_ID) {
  return {
    receipt_id: receiptId,
    product_id: row.product_id || null,
    item_name: row.item_name || "",
    qty: Number(row.qty || 1),
    unit: row.unit || "ชิ้น",
    unit_price: Number(row.unit_price || 0),
    discount_pct: Number(row.discount_pct || 0),
    line_total: Number(row.line_total || 0),
    sort_order: index + 1,
  };
}

// ═══════════════════════════════════════════════════════════
//  harness — รัน convertToReceipt ของจริง แล้วเก็บ ledger
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
      : Promise.resolve(typeof plan.body === "function" ? plan.body() : plan.body)),
  });
}

async function runConvert(options = {}, code = SOURCE) {
  const {
    inv = invoice(),
    dup = { body: [] },
    items = { body: SERVER_ROWS },
    confirm = true,
    accountant = false,
    header = { ok: true, data: { id: RECEIPT_ID, receipt_no: SERVER_NO } },
    itemResult = () => ({ ok: true }),
    patchDI = { ok: true },
    patchQT = { ok: true },
    reloadThrows = false,
    lineItems = [],
    hooks = {},
    invoke = null,          // custom driver (double-trigger scenarios)
  } = options;

  const ledger = [];        // ทุก request ตามลำดับจริง
  const toasts = [];        // { via, msg }
  const routes = [];
  const logs = { warn: [], error: [] };
  let confirmCalls = 0;
  let itemInsertIndex = 0;

  const record = (entry) => { ledger.push(entry); return entry; };

  const sandbox = {
    _diConvertInflight: false,
    _lineItems: lineItems.slice(),
    _viewMode: "preview",
    _denyWriteForAccountant: () => accountant,
    Date: FrozenDate,
    console: {
      warn: (...a) => logs.warn.push(a.map(String).join(" ")),
      error: (...a) => logs.error.push(a.map(String).join(" ")),
      log: () => {},
    },
  };

  const api = {
    get ledger() { return ledger; },
    get toasts() { return toasts; },
    setLineItems: (v) => { sandbox._lineItems = v; },
    call: null,             // ตั้งค่าหลังสร้าง fn
  };

  sandbox.fetch = async (url, init) => {
    record({ m: (init && init.method) || "GET", url, headers: copy(init && init.headers) });
    if (url === dupUrl(inv.id)) {
      if (hooks.onDupFetch) await hooks.onDupFetch(api);
      return respond(dup);
    }
    if (url === itemUrl(inv.id)) {
      if (hooks.onItemFetch) await hooks.onItemFetch(api);
      return respond(items);
    }
    record({ m: "UNEXPECTED-FETCH", url });
    throw new Error("unexpected fetch url: " + url);
  };

  sandbox._ctx = {
    showToast: (m) => { toasts.push({ via: "ctx", msg: m }); },
    showRoute: (r) => { routes.push(r); },
    loadAllData: async () => {
      record({ m: "RELOAD" });
      if (reloadThrows) throw new Error("reload failed");
    },
  };

  sandbox.window = {
    SUPABASE_CONFIG: CFG,
    _sbAccessToken: TOKEN,
    App: {
      showToast: (m) => { toasts.push({ via: "app", msg: m }); },
      confirm: async (q) => {
        confirmCalls++;
        assert.equal(q, MSG.CONFIRM, "ข้อความ confirm เดิมต้องไม่เปลี่ยน");
        if (hooks.onConfirm) await hooks.onConfirm(api);
        return confirm;
      },
    },
    _appXhrPost: async (table, payload, opts) => {
      record({ m: "POST", table, payload: copy(payload), opts: copy(opts) });
      if (table === "receipts") {
        if (hooks.onHeaderPost) await hooks.onHeaderPost(api);
        return header;
      }
      if (table === "receipt_items") {
        const idx = itemInsertIndex++;
        if (hooks.onItemInsert) await hooks.onItemInsert(api, idx);
        return itemResult(idx);
      }
      throw new Error("unexpected POST table: " + table);
    },
    _appXhrPatch: async (table, payload, col, val) => {
      record({ m: "PATCH", table, payload: copy(payload), col, val });
      if (table === "delivery_invoices") return patchDI;
      if (table === "quotations") return patchQT;
      throw new Error("unexpected PATCH table: " + table);
    },
    // ห้ามมีใครเรียก — มีไว้ให้ ledger จับได้ถ้าโผล่มา
    _appXhrPut: async (...a) => { record({ m: "PUT", args: copy(a) }); return { ok: true }; },
    _appXhrDelete: async (...a) => { record({ m: "DELETE", args: copy(a) }); return { ok: true }; },
  };

  const ctx = vm.createContext(sandbox);
  const fn = vm.runInContext(`${code}\nconvertToReceipt`, ctx);
  api.call = () => fn(inv);

  if (invoke) await invoke(fn, inv, api);
  else await fn(inv);

  return {
    ledger, toasts, routes, logs, sandbox, confirmCalls, inv,
    msgs: toasts.map((t) => t.msg),
    posts: ledger.filter((e) => e.m === "POST"),
    patches: ledger.filter((e) => e.m === "PATCH"),
    gets: ledger.filter((e) => e.m === "GET"),
  };
}

// ── ทุก prerequisite failure ต้องไม่มี write ใด ๆ และ flag ต้องคืน ──
function assertNoWrites(r, label) {
  assert.deepEqual(r.ledger.filter((e) => e.m === "POST"), [], `${label}: receipt/item POST ต้อง = 0`);
  assert.deepEqual(r.ledger.filter((e) => e.m === "PATCH"), [], `${label}: DI/quotation PATCH ต้อง = 0`);
  assert.deepEqual(r.ledger.filter((e) => e.m === "PUT" || e.m === "DELETE"), [], `${label}: PUT/DELETE ต้อง = 0`);
  assert.deepEqual(r.ledger.filter((e) => e.m === "RELOAD"), [], `${label}: ห้าม reload (ไม่มีอะไรเปลี่ยน)`);
  assert.equal(r.msgs.includes(okToast(SERVER_NO)), false, `${label}: ห้ามมี success toast`);
  assert.equal(r.msgs.includes(okToast(EXPECTED_RECEIPT_NO)), false, `${label}: ห้ามมี success toast`);
  assert.deepEqual(r.routes, [], `${label}: ห้าม route แบบสำเร็จ`);
  assert.equal(r.sandbox._diConvertInflight, false, `${label}: inflight flag ต้องถูกคืนใน finally`);
  assert.equal(r.sandbox._viewMode, "preview", `${label}: ห้ามแตะ _viewMode`);
}

// ═══════════════════════════════════════════════════════════
//  scenarios — ใช้ทั้งตอน repaired (ต้องผ่าน) และตอน mutant (ต้องแดง)
// ═══════════════════════════════════════════════════════════
const S = {};

// ── (1)-(4) duplicate lookup fail closed ──
S["N1 duplicate HTTP non-2xx แม้ body เป็น []"] = async (code) => {
  const r = await runConvert({ dup: { status: 500, body: [] } }, code);
  assertNoWrites(r, "N1");
  assert.deepEqual(r.ledger, [{ m: "GET", url: dupUrl(77), headers: AUTH }], "N1: หยุดที่ lookup");
  assert.deepEqual(r.msgs, [MSG.DUP_FAIL], "N1: ต้องแจ้ง lookup ล้ม");
  assert.equal(r.confirmCalls, 0, "N1: ห้าม fallback ไป confirm");
};
S["N2 duplicate network rejection"] = async (code) => {
  const r = await runConvert({ dup: { mode: "reject" } }, code);
  assertNoWrites(r, "N2");
  assert.deepEqual(r.msgs, [MSG.DUP_FAIL]);
  assert.equal(r.confirmCalls, 0, "N2: ห้าม fallback ไป confirm");
};
S["N3 duplicate malformed JSON (HTTP 200)"] = async (code) => {
  const r = await runConvert({ dup: { mode: "badjson" } }, code);
  assertNoWrites(r, "N3");
  assert.deepEqual(r.msgs, [MSG.DUP_FAIL]);
  assert.equal(r.confirmCalls, 0, "N3: ห้าม fallback ไป confirm");
};
S["N4 duplicate null / non-array"] = async (code) => {
  for (const body of [null, { receipt_no: "RC-1" }, "RC-1", 7]) {
    const r = await runConvert({ dup: { body } }, code);
    assertNoWrites(r, `N4(${JSON.stringify(body)})`);
    assert.deepEqual(r.msgs, [MSG.DUP_FAIL], `N4(${JSON.stringify(body)}): ต้อง fail closed`);
    assert.equal(r.confirmCalls, 0, "N4: ห้าม fallback ไป confirm");
  }
};

// rev2 (independent review): array อย่างเดียวไม่พอ — แถวที่ "จำแนกไม่ได้" ต้องเข้า uncertainty path
//   เดิม filter(d => d && …) ทิ้ง null เงียบ ⇒ [null] = "ไม่มีใบซ้ำ" แล้วสร้างใบต่อ (fail OPEN)
//   ส่วน [{}] / [{status:null}] เดิมถูกนับเป็น active duplicate แล้ว toast "มีใบเสร็จ undefined …"
const BAD_ROWS = [
  ["row = null", [null]],
  ["row = undefined", [undefined]],
  ["row = {} (ไม่มี status)", [{}]],
  ["status = null", [{ receipt_no: "RC-1", status: null }]],
  ["status = number", [{ receipt_no: "RC-1", status: 1 }]],
  ["status = object", [{ receipt_no: "RC-1", status: { v: "pending" } }]],
  ["status = empty string", [{ receipt_no: "RC-1", status: "" }]],
  ["status = whitespace", [{ receipt_no: "RC-1", status: "   " }]],
  ["row = primitive string", ["RC-1"]],
  ["row = primitive number", [7]],
  ["row = array", [["RC-1", "pending"]]],
  ["mixed: cancelled ที่ valid + row null", [{ receipt_no: "RC-1", status: "cancelled" }, null]],
  ["mixed: active ที่ valid + row {}", [{ receipt_no: "RC-1", status: "pending" }, {}]],
  ["mixed: valid + status number", [{ receipt_no: "RC-1", status: "cancelled" }, { receipt_no: "RC-2", status: 2 }]],
];
S["N4b duplicate row shape จำแนกไม่ได้ → uncertainty path (ห้ามนับว่าไม่ซ้ำ)"] = async (code) => {
  for (const [label, body] of BAD_ROWS) {
    const r = await runConvert({ dup: { body } }, code);
    assertNoWrites(r, `N4b(${label})`);
    assert.deepEqual(r.msgs, [MSG.DUP_FAIL],
      `N4b(${label}): ต้องเป็นข้อความ uncertainty เท่านั้น — ห้ามผ่านไปสร้าง และห้าม toast "มีใบเสร็จ undefined"`);
    assert.equal(r.confirmCalls, 0, `N4b(${label}): ห้ามถาม confirm`);
  }
};

// ── (5)-(8) item snapshot fail closed ──
S["N5 item HTTP non-2xx แม้ body เป็น array ที่ใช้ได้"] = async (code) => {
  const r = await runConvert({ items: { status: 503, body: SERVER_ROWS } }, code);
  assertNoWrites(r, "N5");
  assert.deepEqual(r.ledger, [
    { m: "GET", url: dupUrl(77), headers: AUTH },
    { m: "GET", url: itemUrl(77), headers: AUTH },
  ], "N5: ต้องหยุดหลังโหลดรายการล้ม");
  assert.deepEqual(r.msgs, [MSG.ITEM_FAIL]);
  assert.equal(r.confirmCalls, 1, "N5: confirm ผ่านไปแล้วก่อนโหลดรายการ");
};
S["N6 item network rejection"] = async (code) => {
  const r = await runConvert({ items: { mode: "reject" } }, code);
  assertNoWrites(r, "N6");
  assert.deepEqual(r.msgs, [MSG.ITEM_FAIL]);
};
S["N7 item malformed JSON"] = async (code) => {
  const r = await runConvert({ items: { mode: "badjson" } }, code);
  assertNoWrites(r, "N7");
  assert.deepEqual(r.msgs, [MSG.ITEM_FAIL]);
};
S["N8 item null / non-array / row พัง (map ล้ม)"] = async (code) => {
  for (const body of [null, { rows: [] }, "x", 3]) {
    const r = await runConvert({ items: { body } }, code);
    assertNoWrites(r, `N8(${JSON.stringify(body)})`);
    assert.deepEqual(r.msgs, [MSG.ITEM_FAIL], `N8(${JSON.stringify(body)})`);
  }
  const r = await runConvert({ items: { body: [SERVER_ROWS[0], null] } }, code);
  assertNoWrites(r, "N8(row=null)");
  assert.deepEqual(r.msgs, [MSG.ITEM_FAIL], "N8: map ล้มกลางทาง = fail closed");
};

// ── (9) R1: โหลดสำเร็จแต่ 0 แถว → block ไม่มี override ──
S["N9 item success [] → block ตาม R1 (ไม่มี confirm override)"] = async (code) => {
  const r = await runConvert({ items: { body: [] } }, code);
  assertNoWrites(r, "N9");
  assert.deepEqual(r.ledger, [
    { m: "GET", url: dupUrl(77), headers: AUTH },
    { m: "GET", url: itemUrl(77), headers: AUTH },
  ], "N9: ไม่มี request อื่นหลังพบว่าใบไม่มีรายการ");
  assert.deepEqual(r.msgs, [MSG.EMPTY], "N9: ต้องเป็นข้อความ R1 เป๊ะ");
  assert.equal(r.confirmCalls, 1, "N9: confirm ถูกถามครั้งเดียว (ก่อนรู้ว่าไม่มีรายการ) — ไม่มี override รอบสอง");
};

// ── (10) preview cache ของใบอื่นห้ามถูกใช้ ──
S["N10a stale _lineItems ใบอื่น + server ว่าง → block (ห้ามออกใบจาก cache)"] = async (code) => {
  const r = await runConvert({ lineItems: STALE_CACHE, items: { body: [] } }, code);
  assertNoWrites(r, "N10a");
  assert.deepEqual(r.msgs, [MSG.EMPTY], "N10a: ต้องบล็อกตาม R1 ไม่ใช่ออกใบจาก cache ใบอื่น");
  assert.equal(r.gets.length, 2, "N10a: ต้อง fetch รายการใหม่เสมอ แม้ cache ไม่ว่าง");
};
S["N10b stale _lineItems ใบอื่น + server มีของจริง → ใช้ของ server"] = async (code) => {
  const r = await runConvert({ lineItems: STALE_CACHE }, code);
  assert.equal(r.gets.length, 2, "N10b: ต้อง fetch รายการใหม่เสมอ");
  const itemPosts = r.posts.filter((p) => p.table === "receipt_items");
  assert.deepEqual(itemPosts.map((p) => p.payload), SERVER_ROWS.map((row, i) => expectedItemPayload(row, i)),
    "N10b: รายการใบเสร็จต้องมาจาก server ไม่ใช่ preview cache");
  assert.equal(r.msgs.some((m) => m.includes("ของใบอื่น")), false, "N10b: ห้ามมีชื่อของใบอื่นโผล่");
};

// ── (11) cache เปลี่ยนระหว่าง await → snapshot ต้องนิ่ง ──
S["N11 preview cache ถูกเขียนทับระหว่าง awaits → snapshot ไม่ขยับ"] = async (code) => {
  const r = await runConvert({
    lineItems: STALE_CACHE,
    hooks: {
      onDupFetch: (a) => a.setLineItems([{ item_name: "แทรกตอน dup", qty: 1, unit_price: 1, line_total: 1 }]),
      onItemFetch: (a) => a.setLineItems([{ item_name: "แทรกตอนโหลด", qty: 1, unit_price: 1, line_total: 1 }]),
      onHeaderPost: (a) => a.setLineItems([]),
      onItemInsert: (a, i) => a.setLineItems([{ item_name: "แทรกตอน insert " + i, qty: 9, unit_price: 9, line_total: 9 }]),
    },
  }, code);
  const itemPosts = r.posts.filter((p) => p.table === "receipt_items");
  assert.deepEqual(itemPosts.map((p) => p.payload), SERVER_ROWS.map((row, i) => expectedItemPayload(row, i)),
    "N11: ทุก item payload ต้องมาจาก snapshot ตอนโหลด ไม่ใช่ cache ปัจจุบัน");
  assert.equal(itemPosts.length, SERVER_ROWS.length, "N11: จำนวนรายการต้องเท่า snapshot");
  assert.equal(r.msgs.at(-1), okToast(SERVER_NO), "N11: จบแบบสำเร็จ");
};

// ── (12) ยกเลิก confirm ──
S["N12 ยกเลิก confirm → ไม่โหลดรายการ ไม่มี write"] = async (code) => {
  const r = await runConvert({ confirm: false }, code);
  assertNoWrites(r, "N12");
  assert.deepEqual(r.ledger, [{ m: "GET", url: dupUrl(77), headers: AUTH }], "N12: หยุดทันทีหลัง confirm ถูกยกเลิก");
  assert.deepEqual(r.msgs, [], "N12: ไม่ต้องมี toast");
  assert.equal(r.confirmCalls, 1);
};

// ── positive controls ──
S["P1 cancelled-only duplicate + มีรายการจริง → สำเร็จเต็ม"] = async (code) => {
  const inv = invoice();
  const r = await runConvert({
    inv,
    dup: { body: [{ receipt_no: "RC-OLD-1", status: "cancelled" }, { receipt_no: "RC-OLD-2", status: "cancelled" }] },
  }, code);
  assert.deepEqual(r.ledger, [
    { m: "GET", url: dupUrl(77), headers: AUTH },
    { m: "GET", url: itemUrl(77), headers: AUTH },
    { m: "POST", table: "receipts", payload: expectedHeader(inv), opts: { returnData: true } },
    ...SERVER_ROWS.map((row, i) => ({ m: "POST", table: "receipt_items", payload: expectedItemPayload(row, i), opts: undefined })),
    { m: "PATCH", table: "delivery_invoices", payload: { status: "receipted" }, col: "id", val: 77 },
    { m: "PATCH", table: "quotations", payload: { status: "receipted" }, col: "id", val: 900 },
    { m: "RELOAD" },
  ], "P1: ledger ต้องตรงทั้งลำดับ/ตาราง/payload/ID linkage");
  assert.deepEqual(r.msgs, [MSG.PROGRESS, okToast(SERVER_NO)], "P1: ข้อความสุดท้าย = สำเร็จ");
  assert.deepEqual(r.routes, ["receipts"]);
  assert.equal(r.sandbox._viewMode, "list");
  assert.equal(r.sandbox._diConvertInflight, false);
};
S["P2 ไม่มี quotation_id → PATCH quotations ต้องไม่เกิด"] = async (code) => {
  const inv = invoice({ quotation_id: null });
  const r = await runConvert({ inv }, code);
  assert.deepEqual(r.patches, [
    { m: "PATCH", table: "delivery_invoices", payload: { status: "receipted" }, col: "id", val: 77 },
  ], "P2: PATCH quotations ต้องเกิดเฉพาะมี quotation_id");
  assert.equal(r.posts.filter((p) => p.table === "receipts")[0].payload.quotation_id, null);
  assert.equal(r.msgs.at(-1), okToast(SERVER_NO));
};
S["P3 มีใบเสร็จ active → บล็อก (1:1 เดิม)"] = async (code) => {
  const r = await runConvert({
    dup: { body: [{ receipt_no: "RC-ACTIVE", status: "pending" }, { receipt_no: "RC-X", status: "cancelled" }] },
  }, code);
  assertNoWrites(r, "P3");
  assert.deepEqual(r.msgs, ["มีใบเสร็จ RC-ACTIVE จากใบส่งสินค้านี้แล้ว — ลบ/จัดการใบเดิมก่อนถึงออกใบใหม่ได้"]);
  assert.equal(r.confirmCalls, 0, "P3: บล็อก ไม่ใช่ confirm");
};
S["P4 accountant → บล็อกตั้งแต่ต้น ไม่มี request"] = async (code) => {
  const r = await runConvert({ accountant: true }, code);
  assert.deepEqual(r.ledger, [], "P4: ห้ามมี request ใด ๆ");
  assert.deepEqual(r.msgs, []);
  assert.equal(r.sandbox._diConvertInflight, false, "P4: ออกก่อนจับ flag");
};

// ── double trigger ทุกจังหวะ ──
for (const [label, hookName] of [
  ["ระหว่างรอ duplicate fetch", "onDupFetch"],
  ["ระหว่างรอ confirm", "onConfirm"],
  ["ระหว่างรอ item fetch", "onItemFetch"],
  ["ระหว่างรอ item insert", "onItemInsert"],
]) {
  S[`P5 double trigger ${label} → ใบเดียว + toast กำลังทำงาน`] = async (code) => {
    let fired = 0;
    const inv = invoice();
    const r = await runConvert({
      inv,
      hooks: { [hookName]: async (a) => { if (fired++) return; await a.call(); } },
    }, code);
    assert.equal(fired, hookName === "onItemInsert" ? SERVER_ROWS.length : 1, "hook ต้องถูกเรียก");
    assert.equal(r.posts.filter((p) => p.table === "receipts").length, 1, `${label}: header ต้องมีใบเดียว`);
    assert.equal(r.posts.filter((p) => p.table === "receipt_items").length, SERVER_ROWS.length, `${label}: item ต้องไม่ซ้ำ`);
    assert.equal(r.gets.length, 2, `${label}: ห้ามยิง lookup/โหลดรายการรอบสอง`);
    assert.equal(r.msgs.filter((m) => m === MSG.BUSY).length, 1, `${label}: trigger ซ้ำต้องได้ toast กำลังทำงาน`);
    assert.equal(r.msgs.at(-1), okToast(SERVER_NO));
    assert.equal(r.sandbox._diConvertInflight, false);
  };
}

S["P6 รันใหม่ได้หลัง early return (flag ถูกคืน)"] = async (code) => {
  const inv = invoice();
  const calls = [];
  const r = await runConvert({
    inv,
    dup: { body: () => (calls.push(1), calls.length === 1 ? null : []) },   // รอบแรก non-array → fail closed
    invoke: async (fn, i) => { await fn(i); await fn(i); },
  }, code);
  assert.equal(r.msgs[0], MSG.DUP_FAIL, "รอบแรกต้อง fail closed");
  assert.equal(r.msgs.at(-1), okToast(SERVER_NO), "รอบสองต้องทำงานได้ปกติ");
  assert.equal(r.posts.filter((p) => p.table === "receipts").length, 1);
  assert.equal(r.msgs.includes(MSG.BUSY), false, "ไม่ควรติด inflight ค้าง");
};

// ── post-write outcomes ──
S["W1 header ok:false → แจ้ง error ไม่เขียนอะไรต่อ"] = async (code) => {
  const r = await runConvert({ header: { ok: false, error: { message: "duplicate key" } } }, code);
  assert.deepEqual(r.ledger.filter((e) => e.m !== "GET"), [
    { m: "POST", table: "receipts", payload: expectedHeader(invoice()), opts: { returnData: true } },
  ], "W1: หยุดทันทีหลัง header ล้ม");
  assert.deepEqual(r.msgs, [MSG.PROGRESS, "duplicate key"]);
  assert.deepEqual(r.routes, []);
  assert.equal(r.sandbox._diConvertInflight, false);
};
S["W2 header ok:true แต่ไม่มี id → containment ตาม R3"] = async (code) => {
  for (const data of [null, {}, { receipt_no: SERVER_NO }, { id: null, receipt_no: SERVER_NO }]) {
    const r = await runConvert({ header: { ok: true, data } }, code);
    assert.deepEqual(r.ledger.filter((e) => e.m !== "GET"), [
      { m: "POST", table: "receipts", payload: expectedHeader(invoice()), opts: { returnData: true } },
    ], "W2: ห้าม receipt_items / PATCH / DELETE / retry หลังจากนั้น");
    assert.deepEqual(r.msgs, [MSG.PROGRESS, MSG.NO_ID], "W2: ข้อความต้องไม่บอกว่ายังไม่ได้สร้าง");
    assert.deepEqual(r.routes, [], "W2: ห้าม route แบบสำเร็จ");
    assert.equal(r.sandbox._viewMode, "preview");
    assert.equal(r.sandbox._diConvertInflight, false, "W2: flag ต้องถูกคืนใน finally");
  }
};
S["W3 item insert ล้มบางรายการ → terminal = คำเตือน ไม่ใช่สำเร็จ"] = async (code) => {
  const r = await runConvert({ itemResult: (i) => ({ ok: i !== 1 }) }, code);
  assert.equal(r.posts.filter((p) => p.table === "receipt_items").length, 3, "W3: ไม่หยุดกลางคัน ไม่ retry");
  assert.deepEqual(r.patches.map((p) => p.table), ["delivery_invoices", "quotations"], "W3: PATCH ต้นทางยังเดิน");
  assert.equal(r.ledger.filter((e) => e.m === "DELETE" || e.m === "PUT").length, 0, "W3: ห้าม rollback");
  assert.ok(r.msgs.some((m) => m.includes("แต่บันทึกรายการไม่สำเร็จ")), "W3: ต้องเตือนรายการขาด");
  assert.equal(r.msgs.at(-1), warnToast(SERVER_NO), "W3: ข้อความสุดท้ายห้ามเป็น success");
  assert.equal(r.msgs.includes(okToast(SERVER_NO)), false, "W3: ห้ามมี success toast เลย");
  assert.deepEqual(r.routes, ["receipts"], "W3: ยังไป list ใบเสร็จให้ผู้ใช้ตรวจได้");
};
S["W4 PATCH delivery_invoices ล้ม → terminal = คำเตือน"] = async (code) => {
  const r = await runConvert({ patchDI: { ok: false, error: { message: "rls" } } }, code);
  assert.ok(r.msgs.includes(MSG.STATUS_FAIL), "W4: ต้องเตือน status");
  assert.equal(r.msgs.at(-1), warnToast(SERVER_NO), "W4: ข้อความสุดท้ายห้ามเป็น success");
  assert.equal(r.ledger.filter((e) => e.m === "DELETE").length, 0, "W4: ห้าม rollback");
};
S["W5 PATCH quotations ล้ม → terminal = คำเตือน"] = async (code) => {
  const r = await runConvert({ patchQT: { ok: false, error: { message: "rls" } } }, code);
  assert.ok(r.msgs.includes(MSG.STATUS_FAIL), "W5: ต้องเตือน status");
  assert.equal(r.msgs.at(-1), warnToast(SERVER_NO), "W5: ข้อความสุดท้ายห้ามเป็น success");
};
S["W6 reload ล้ม → ยังได้ข้อความสรุป + ไม่โยน error หลุด"] = async (code) => {
  const r = await runConvert({ reloadThrows: true }, code);
  assert.equal(r.msgs.at(-1), okToast(SERVER_NO), "W6: ใบครบจริง → ข้อความสำเร็จ");
  assert.deepEqual(r.routes, ["receipts"]);
  assert.equal(r.sandbox._diConvertInflight, false);
};

// ═══════════════════════════════════════════════════════════
//  repaired build ต้องเขียวทุก scenario
// ═══════════════════════════════════════════════════════════
for (const [name, run] of Object.entries(S)) {
  test(name, async () => { await run(SOURCE); });
}

// callers ทั้งสองทาง (dropdown แถว + ปุ่มใน preview) ต้องยังเรียกฟังก์ชันเดียวกัน
test("callers: dropdown แถว + ปุ่มใน preview เรียก convertToReceipt(inv) ทั้งคู่", () => {
  const outside = MODULE_SRC.split(SOURCE).join("");   // ตัดตัวฟังก์ชันออกก่อน
  assert.match(outside, /if \(action === "receipt"\) \{[\s\S]{0,200}?convertToReceipt\(inv\);/,
    "dropdown แถว (action=receipt) ต้องเรียก convertToReceipt");
  assert.match(outside, /getElementById\("diConvertReceiptBtn"\)\?\.addEventListener\("click", \(\) => convertToReceipt\(inv\)\)/,
    "ปุ่มใน preview ต้องเรียก convertToReceipt");
  assert.equal(outside.split("convertToReceipt(inv)").length - 1, 2, "ต้องมี call site 2 จุดพอดี");
});

// ═══════════════════════════════════════════════════════════
//  mutation matrix — mutant ต้องถูกฆ่าโดย scenario ที่ระบุ ด้วย ERR_ASSERTION
//  (ไม่นับ crash / ไม่นับ source-regex เป็น kill)
// ═══════════════════════════════════════════════════════════
const MUTANTS = [
  {
    id: "MUT-01", why: "ถอด duplicate response.ok gate",
    from: '      if (!chkResp.ok) throw new Error("HTTP " + chkResp.status);\n',
    to: "",
    killer: "N1 duplicate HTTP non-2xx แม้ body เป็น []",
  },
  {
    id: "MUT-02", why: "ถอด item response.ok gate",
    from: '      if (!resp.ok) throw new Error("HTTP " + resp.status);\n',
    to: "",
    killer: "N5 item HTTP non-2xx แม้ body เป็น array ที่ใช้ได้",
  },
  {
    id: "MUT-03", why: "คืน duplicate catch → confirm fallback",
    from: '      window.App?.showToast?.("ตรวจสอบใบเสร็จเดิมไม่สำเร็จ — ยังไม่สร้างใบเสร็จ กรุณาลองใหม่");\n      return;   // ❌ พิสูจน์ไม่ได้ว่าไม่มีใบซ้ำ = ห้ามสร้าง',
    to: '      if (!(await window.App?.confirm?.("ออกใบเสร็จรับเงินจากใบส่งสินค้านี้?"))) return;',
    killer: "N2 duplicate network rejection",
  },
  {
    id: "MUT-04", why: "คืน JSON catch → []",
    from: "      const existing = await chkResp.json();",
    to: "      const existing = await chkResp.json().catch(() => []);",
    killer: "N3 duplicate malformed JSON (HTTP 200)",
  },
  {
    id: "MUT-05", why: "คืน classifier baseline (non-array → [])",
    from: /^ {6}if \(!Array\.isArray\(existing\)\) throw new Error[\s\S]*?^ {6}const active = existing\.filter\(d => d\.status !== "cancelled"\);\n/m,
    to: '      const active = Array.isArray(existing) ? existing.filter(d => d.status !== "cancelled") : [];\n',
    killer: "N4 duplicate null / non-array",
  },
  {
    id: "MUT-06", why: "ย้าย empty-gate ไปหลัง header POST",
    from: '    if (sourceItems.length === 0) {\n      window.App?.showToast?.("ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง");\n      return;\n    }\n',
    to: "",
    then: {
      from: '    if (!rcRes.ok) return _ctx.showToast(rcRes.error?.message || "สร้างใบเสร็จไม่สำเร็จ");',
      to: '    if (!rcRes.ok) return _ctx.showToast(rcRes.error?.message || "สร้างใบเสร็จไม่สำเร็จ");\n    if (sourceItems.length === 0) {\n      window.App?.showToast?.("ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง");\n      return;\n    }',
    },
    killer: "N9 item success [] → block ตาม R1 (ไม่มี confirm override)",
  },
  {
    id: "MUT-07", why: "คืน _lineItems cache shortcut (ข้าม fetch)",
    from: "    let sourceItems;\n    try {",
    to: "    let sourceItems = _lineItems.length ? _lineItems.slice() : null;\n    if (!sourceItems) try {",
    killer: "N10a stale _lineItems ใบอื่น + server ว่าง → block (ห้ามออกใบจาก cache)",
  },
  {
    id: "MUT-08", why: "ใช้ _lineItems ใน item loop แทน snapshot",
    from: "    for (let i = 0; i < sourceItems.length; i++) {\n      const li = sourceItems[i];",
    to: "    for (let i = 0; i < _lineItems.length; i++) {\n      const li = _lineItems[i];",
    killer: "N11 preview cache ถูกเขียนทับระหว่าง awaits → snapshot ไม่ขยับ",
  },
  {
    id: "MUT-09", why: "ถอด empty-array block (R1)",
    from: '    if (sourceItems.length === 0) {\n      window.App?.showToast?.("ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง");\n      return;\n    }\n',
    to: "",
    killer: "N9 item success [] → block ตาม R1 (ไม่มี confirm override)",
  },
  {
    id: "MUT-10", why: "ถอด missing-ID guard (R3)",
    from: '    if (!receiptId) {\n      console.error("[delivery_invoices convert] receipt insert returned no id:", rcRes.data);\n      return _ctx.showToast("อาจสร้างใบเสร็จแล้ว แต่ยืนยันรหัสไม่ได้ — โปรดตรวจรายการใบเสร็จก่อนลองใหม่");\n    }\n',
    to: "",
    killer: "W2 header ok:true แต่ไม่มี id → containment ตาม R3",
  },
  {
    id: "MUT-11", why: "คืน success toast แบบไม่มีเงื่อนไข (R4)",
    from: '    _ctx.showToast(failedItems.length > 0 || statusFailed\n      ? `⚠️ ออกใบเสร็จ ${realReceiptNo} แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ`\n      : "ออกใบเสร็จรับเงินแล้ว: " + realReceiptNo);',
    to: '    _ctx.showToast("ออกใบเสร็จรับเงินแล้ว: " + realReceiptNo);',
    killer: "W3 item insert ล้มบางรายการ → terminal = คำเตือน ไม่ใช่สำเร็จ",
  },
  {
    // rev2: ถอด "เฉพาะ" row-shape validation แล้วคืน filter แบบเดิมที่ทิ้งแถว falsy เงียบ
    // = โค้ด rev1 เป๊ะ ๆ ที่ independent review จับได้ (single site, single behavioural concern)
    id: "MUT-12", why: "ถอด row-shape validation (คืน filter(d => d && …) ของ rev1)",
    from: /^ {6}for \(const row of existing\) \{[\s\S]*?^ {6}\}\n {6}const active = existing\.filter\(d => d\.status !== "cancelled"\);\n/m,
    to: '      const active = existing.filter(d => d && d.status !== "cancelled");\n',
    killer: "N4b duplicate row shape จำแนกไม่ได้ → uncertainty path (ห้ามนับว่าไม่ซ้ำ)",
  },
];

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
  test(`${m.id} (${m.why}) → ถูกฆ่าโดย: ${m.killer}`, async () => {
    let mutant = applyOnce(SOURCE, m, m.id);
    if (m.then) mutant = applyOnce(mutant, m.then, m.id + "/then");
    assert.notEqual(mutant, SOURCE, `${m.id}: mutant ต้องต่างจาก source`);
    // ต้อง parse ได้จริง (ไม่ใช่ kill เพราะ syntax error)
    new vm.Script(`${mutant}\nconvertToReceipt`);
    const run = S[m.killer];
    assert.ok(run, `${m.id}: ไม่พบ scenario ${m.killer}`);
    await assert.rejects(() => run(mutant), (err) => {
      assert.equal(err.code, "ERR_ASSERTION",
        `${m.id}: ต้องแดงด้วย assertion ไม่ใช่ crash — ได้ ${err.name}: ${err.message}`);
      return true;
    }, `${m.id}: mutant รอด — scenario ${m.killer} ไม่ฆ่ามัน`);
  });
}
