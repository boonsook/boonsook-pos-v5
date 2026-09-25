// Phase 630 — ใบเสนอราคา → ใบส่งสินค้า: fail closed ผ่าน "ทางเข้าจริง" ใน Chromium
//
// unit (tests/phase630_qt_to_di_failclosed.test.js) รัน convertToDeliveryInvoice ใน node:vm.
// สเปคนี้ import modules/quotations.js จริงจาก origin แล้วขับทางเข้า 3 จุด:
//   dropdown ของแถว (.qt-status-select → convert) · ปุ่มในฟอร์มแก้ไข (#qtConvertFromForm) · ปุ่มใน preview (#qtConvertBtn)
// ฟิกซ์เจอร์ปิด service worker, block ทุก request ข้าม origin และ stub fetch + _appXhr* เป็น ledger
// — ไม่มี Supabase/DB จริง. พิสูจน์: uncertainty ไม่มี write · ฟอร์มที่ยังไม่บันทึก/preview cache ถูก ignore
// (ใช้แถว DB ล่าสุดของ q.id) · missing id หยุด · partial toast ไม่ถูก success ทับ.

import { test, expect } from "@playwright/test";

const FIXTURE_URL = "/__phase630__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 630 fixture</title></head>'
  + '<body><div id="page-quotations"></div></body></html>';

const MSG = {
  DUP_FAIL: "ตรวจสอบใบส่งสินค้าเดิมไม่สำเร็จ — ยังไม่สร้างใบส่งสินค้า กรุณาลองใหม่",
  CONFIRM: "สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากข้อมูลใบเสนอราคาที่บันทึกล่าสุด?",
  ITEM_FAIL: "⚠️ โหลดรายการสินค้าไม่สำเร็จ — ยกเลิกการสร้างใบส่งสินค้า ลองใหม่อีกครั้ง",
  NO_ID: "อาจสร้างใบส่งสินค้าแล้ว แต่ยืนยันรหัสไม่ได้ — โปรดตรวจรายการใบส่งสินค้าก่อนลองใหม่",
  OK: "สร้างใบส่งสินค้าแล้ว: INV-SERVER-630",
  WARN: "⚠️ สร้างใบส่งสินค้า INV-SERVER-630 แล้ว แต่บันทึกไม่ครบ — เปิดใบเพื่อตรวจ",
};

const QT_ID = 6301;
const HEAD = (name, so) => ({ quotation_id: QT_ID, product_id: null, item_name: name, qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, sort_order: so, item_type: "heading" });
const ITEM = (name, qty, price, so) => ({ quotation_id: QT_ID, product_id: null, item_name: name, qty, unit: "เครื่อง", unit_price: price, discount_pct: 0, line_total: qty * price, sort_order: so, item_type: "item" });
// แถวที่บันทึกไว้ตอนเปิดฟอร์ม/preview
const ROWS_V1 = [HEAD("หมวด งานติดตั้ง", 1), ITEM("แอร์ติดผนัง 12000 BTU", 2, 15000, 2), ITEM("ค่าติดตั้ง", 1, 2500, 3)];
// แถวที่ persist ล่าสุดตอนกดแปลง (อีกเครื่องบันทึกแก้แล้ว) — ต้องเป็น source ของใบส่งสินค้า
const ROWS_V2 = [HEAD("หมวด งานติดตั้ง (แก้แล้ว)", 1), ITEM("แอร์ติดผนัง 18000 BTU", 1, 21000, 2), HEAD("หมวด วัสดุ", 3), ITEM("ท่อทองแดง", 4, 250, 4)];
const DI_ITEMS_V2 = [
  ["หมวด งานติดตั้ง (แก้แล้ว)", "heading", 0, 0, 1],
  ["แอร์ติดผนัง 18000 BTU", "item", 1, 21000, 2],
  ["หมวด วัสดุ", "heading", 0, 0, 3],
  ["ท่อทองแดง", "item", 4, 1000, 4],
];

// ทุกอย่างติดตั้งก่อนสคริปต์ของหน้า: ปิด SW + stub network + ledger + ctx
function installFixture({ rows, qtId }) {
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture")));
  window.__ledger = [];
  window.__toasts = [];
  window.__plan = {
    dup: { status: 200, body: [] },
    items: { status: 200, body: rows },
    header: { ok: true, data: { id: 630001, inv_no: "INV-SERVER-630" } },
    itemFailAt: [],
    patch: { ok: true },
  };
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-fixture";
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const reply = (plan) => {
    if (plan.mode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    const status = plan.status === undefined ? 200 : plan.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => (plan.mode === "badjson" ? Promise.reject(new SyntaxError("Unexpected token <")) : Promise.resolve(clone(plan.body))),
    });
  };
  window.fetch = (url, init) => {
    const u = String(url);
    window.__ledger.push({ m: (init && init.method) || "GET", url: u });
    if (u.includes("/rest/v1/delivery_invoices?quotation_id=")) return reply(window.__plan.dup);
    if (u.includes("/rest/v1/quotation_items?")) return reply(window.__plan.items);
    return reply({ status: 200, body: [] });
  };
  let itemIdx = 0;
  window._appXhrPost = async (table, payload, opts) => {
    window.__ledger.push({ m: "POST", table, payload: clone(payload), opts: clone(opts) });
    if (table === "delivery_invoices") { itemIdx = 0; return window.__plan.header; }
    if (table === "delivery_invoice_items") { const i = itemIdx++; return { ok: !window.__plan.itemFailAt.includes(i) }; }
    return { ok: true };
  };
  window._appXhrPatch = async (table, payload, col, val) => { window.__ledger.push({ m: "PATCH", table, payload: clone(payload), col, val }); return window.__plan.patch; };
  window._appXhrPut = async (...a) => { window.__ledger.push({ m: "PUT", a: clone(a) }); return { ok: true }; };
  window._appXhrDelete = async (...a) => { window.__ledger.push({ m: "DELETE", a: clone(a) }); return { ok: true }; };
  window._appShareDoc = () => {};
  const toast = (m) => window.__toasts.push(String(m));
  window.App = {
    showToast: toast,
    confirm: async (text) => { window.__ledger.push({ m: "CONFIRM", text }); return true; },
    state: { profile: { role: "admin" } },
  };
  const quote = {
    id: qtId, qt_no: "QT-630", status: "approved", created_at: new Date().toISOString(),
    customer_name: "ลูกค้าทดสอบ", customer_phone: "0800000000", total_amount: 32500, grand_total: 32500, amount: 32500,
    after_discount: 32500, discount_pct: 0, discount_amount: 0, withholding_tax: false, wht_pct: 3, wht_amount: 0,
    payment_terms: "เงินสด", credit_days: 0, salesperson: "พนักงาน",
  };
  window.__ctx = {
    state: {
      profile: { role: "admin", full_name: "พนักงาน" }, storeInfo: { name: "ร้านทดสอบ" },
      customers: [], products: [], paymentInfo: { banks: [] },
      quotations: [quote], deliveryInvoices: [], receipts: [],
    },
    money: (n) => String(n),
    showToast: toast,
    showRoute: (r) => window.__ledger.push({ m: "ROUTE", r }),
    loadAllData: async () => { window.__ledger.push({ m: "RELOAD" }); },
  };
}

async function boot(page, viewport) {
  await page.setViewportSize(viewport);
  // กันทุก request ข้าม origin (ลงทะเบียนก่อน → ถูกตรวจทีหลัง route ของ fixture)
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.addInitScript(installFixture, { rows: ROWS_V1, qtId: QT_ID });
  await page.goto(FIXTURE_URL);
  await page.evaluate(async () => {
    window.__qt = await import("/modules/quotations.js");
    window.__qt.renderQuotationsPage(window.__ctx);
  });
  await expect(page.locator(".qt-status-select")).toHaveCount(1);
}

const setPlan = (page, plan) => page.evaluate((p) => { Object.assign(window.__plan, p); }, plan);
const readState = (page) => page.evaluate(() => ({ ledger: window.__ledger, toasts: window.__toasts }));
const resetLedger = (page) => page.evaluate(() => { window.__ledger.length = 0; window.__toasts.length = 0; });
const writesOf = (ledger) => ledger.filter((e) => ["POST", "PATCH", "PUT", "DELETE"].includes(e.m));

// รอจน ledger/toast นิ่ง (ทุกอย่าง stub หมด) — ให้ baseline แดงด้วย expect ไม่ใช่ timeout
async function settle(page) {
  await page.waitForFunction(() => window.__toasts.length > 0 || window.__ledger.length > 0, null, { timeout: 5000 });
  let last = "";
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => `${window.__ledger.length}/${window.__toasts.length}`);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(150);
  }
}

// ── ทางเข้า 3 จุด: prepare = เปิดหน้าที่มีปุ่ม (ครั้งเดียว) · fire = กดแปลง ──
const ENTRIES = {
  "dropdown แถว": {
    prepare: async () => {},
    fire: (page) => page.selectOption(".qt-status-select", "convert"),
  },
  "ปุ่มในฟอร์มแก้ไข": {
    prepare: async (page) => {
      await page.selectOption(".qt-status-select", "edit");
      await expect(page.locator("#qtConvertFromForm")).toHaveCount(1);
      await expect(page.locator("#qtLineItemsBody tr.qt-item-row")).toHaveCount(2);
    },
    fire: (page) => page.click("#qtConvertFromForm"),
  },
  "ปุ่มใน preview": {
    prepare: async (page) => {
      await page.locator(".qt-view-btn").first().click();
      await expect(page.locator("#qtConvertBtn")).toHaveCount(1);
    },
    fire: (page) => page.click("#qtConvertBtn"),
  },
};

async function trigger(page, entry) {
  await resetLedger(page);
  await ENTRIES[entry].fire(page);
  await settle(page);
  return readState(page);
}

function expectNoWrites(ledger, label) {
  const bad = ledger.filter((e) => ["POST", "PATCH", "PUT", "DELETE", "ROUTE", "RELOAD"].includes(e.m));
  expect(bad, `${label}: ห้ามมี write/route/reload — เจอ ${JSON.stringify(bad)}`).toEqual([]);
}

const itemRows = (ledger) => ledger.filter((e) => e.m === "POST" && e.table === "delivery_invoice_items")
  .map((e) => [e.payload.item_name, e.payload.item_type, e.payload.qty, e.payload.line_total, e.payload.sort_order]);

for (const [label, viewport] of [["mobile 390x844", { width: 390, height: 844 }], ["desktop 1280x800", { width: 1280, height: 800 }]]) {
  test.describe(`Phase 630 · ${label}`, () => {
    for (const entry of Object.keys(ENTRIES)) {
      test(`${entry}: duplicate lookup ไม่แน่นอน (HTTP 500 · JSON พัง · ไม่ใช่ array · [null] · [{}] · status null) → ไม่ confirm ไม่มี write`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        for (const [plabel, dup] of [
          ["HTTP 500 body []", { status: 500, body: [] }],
          ["malformed JSON", { status: 200, mode: "badjson" }],
          ["network", { mode: "reject" }],
          ["null", { status: 200, body: null }],
          ["[null]", { status: 200, body: [null] }],
          ["[{}]", { status: 200, body: [{}] }],
          ["[{status:null}]", { status: 200, body: [{ inv_no: "INV-1", status: null }] }],
          ["valid cancelled + blank", { status: 200, body: [{ inv_no: "INV-1", status: "cancelled" }, { inv_no: "INV-2", status: "" }] }],
        ]) {
          await setPlan(page, { dup });
          const { ledger, toasts } = await trigger(page, entry);
          expect(toasts, `${plabel}`).toEqual([MSG.DUP_FAIL]);
          expect(ledger.filter((e) => e.m === "CONFIRM"), `${plabel}: ห้าม fallback ไป confirm`).toEqual([]);
          expect(ledger.filter((e) => e.m === "GET").length, `${plabel}: หยุดที่ lookup`).toBe(1);
          expectNoWrites(ledger, `${entry} ${plabel}`);
        }
      });

      test(`${entry}: โหลดรายการล้ม (HTTP 503 พร้อม body ที่ใช้ได้) → ไม่มี write`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        await setPlan(page, { items: { status: 503, body: ROWS_V2 } });
        const { ledger, toasts } = await trigger(page, entry);
        expect(toasts).toEqual([MSG.ITEM_FAIL]);
        expectNoWrites(ledger, entry);
      });

      // rev2 (independent review P1): แถวที่ไม่ใช่ quotation_items จริงห้ามถูก map เป็นสินค้า "" qty 1
      test(`${entry}: แถวรายการรูปแบบผิด ([{}] · [[]] · ["x"] · valid + malformed) → confirm ผ่านแล้วแต่ไม่มี write`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        const valid = ROWS_V2[1];
        const { qty: _qty, ...missingQty } = valid;
        for (const [plabel, body] of [
          ["[{}]", [{}]],
          ["[[]]", [[]]],
          ['["x"]', ["x"]],
          ["valid + {}", [valid, {}]],
          ["valid + []", [valid, []]],
          ["valid + ขาดคอลัมน์ qty", [valid, missingQty]],
        ]) {
          await setPlan(page, { items: { status: 200, body } });
          const { ledger, toasts } = await trigger(page, entry);
          expectNoWrites(ledger, `${entry} ${plabel}`);
          expect(toasts, plabel).toEqual([MSG.ITEM_FAIL]);
          expect(ledger.filter((e) => e.m === "CONFIRM").length, `${plabel}: confirm ผ่านแล้วก่อนโหลดรายการ`).toBe(1);
        }
      });

      test(`${entry}: ใช้แถว DB ล่าสุดของ q.id เท่านั้น (ฟอร์มที่ยังไม่บันทึก / preview cache ถูก ignore)`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        if (entry === "ปุ่มในฟอร์มแก้ไข") {
          // แก้ในฟอร์มแต่ไม่กดบันทึก: เปลี่ยนจำนวน + เพิ่มแถวใหม่
          const qty = page.locator("#qtLineItemsBody tr.qt-item-row").first().locator(".qt-li-qty");
          await qty.fill("7");
          await qty.dispatchEvent("change");
          await page.click("#qtAddItemBtn");
          await page.click("#qtAddCustomItem");
          const name = page.locator("#qtLineItemsBody tr.qt-item-row").last().locator(".qt-li-name");
          await name.fill("แก้ในฟอร์มยังไม่บันทึก");
          await name.dispatchEvent("change");
          await expect(page.locator("#qtLineItemsBody tr.qt-item-row")).toHaveCount(3);
        }
        await setPlan(page, { items: { status: 200, body: ROWS_V2 } });   // persisted ล่าสุด
        const { ledger, toasts } = await trigger(page, entry);
        expect(itemRows(ledger), "รายการใบส่งสินค้า = แถว DB ล่าสุด ตามลำดับ พร้อม item_type").toEqual(DI_ITEMS_V2);
        expect(JSON.stringify(ledger)).not.toContain("แก้ในฟอร์มยังไม่บันทึก");
        expect(ledger.filter((e) => e.m === "GET").map((e) => e.url), "ต้อง fetch รายการของ q.id ใหม่ทุกครั้ง").toEqual([
          `https://fixture.invalid/rest/v1/delivery_invoices?quotation_id=eq.${QT_ID}&select=inv_no,status`,
          `https://fixture.invalid/rest/v1/quotation_items?quotation_id=eq.${QT_ID}&order=sort_order.asc`,
        ]);
        expect(ledger.filter((e) => e.m === "CONFIRM").map((e) => e.text)).toEqual([MSG.CONFIRM]);
        expect(writesOf(ledger).map((e) => `${e.m} ${e.table}`)).toEqual([
          "POST delivery_invoices", ...DI_ITEMS_V2.map(() => "POST delivery_invoice_items"), "PATCH quotations",
        ]);
        expect(toasts.at(-1)).toBe(MSG.OK);
        expect(ledger.filter((e) => e.m === "ROUTE").map((e) => e.r)).toEqual(["delivery_invoices"]);
      });

      test(`${entry}: รายการบางแถวบันทึกไม่สำเร็จ → ข้อความสุดท้าย = คำเตือน ไม่ถูก success ทับ`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        await setPlan(page, { itemFailAt: [1] });
        const { ledger, toasts } = await trigger(page, entry);
        expect(toasts.at(-1)).toBe(MSG.WARN);
        expect(toasts).not.toContain(MSG.OK);
        expect(ledger.filter((e) => ["PUT", "DELETE"].includes(e.m)), "ห้าม rollback").toEqual([]);
        expect(ledger.filter((e) => e.m === "ROUTE").map((e) => e.r)).toEqual(["delivery_invoices"]);
      });

      test(`${entry}: header ok:true แต่ไม่มี id → หยุด items/PATCH/reload/route`, async ({ page }) => {
        await boot(page, viewport);
        await ENTRIES[entry].prepare(page);
        await setPlan(page, { header: { ok: true, data: { inv_no: "INV-SERVER-630" } } });
        const { ledger, toasts } = await trigger(page, entry);
        expect(toasts.at(-1)).toBe(MSG.NO_ID);
        expect(writesOf(ledger).map((e) => e.table)).toEqual(["delivery_invoices"]);
        expect(ledger.filter((e) => ["ROUTE", "RELOAD"].includes(e.m))).toEqual([]);
      });
    }

    test("ไม่มี service worker ถูกลงทะเบียน และไม่มี request ข้าม origin", async ({ page }) => {
      const external = [];
      page.on("requestfailed", (r) => { if (!r.url().startsWith("http://127.0.0.1:") && !r.url().startsWith("http://localhost:")) external.push(r.url()); });
      await boot(page, viewport);
      await trigger(page, "dropdown แถว");
      expect(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))).toBe(false);
      expect(external, `external requests: ${external.join(", ")}`).toEqual([]);
    });
  });
}
