// Phase 626 — ใบส่งสินค้า → ใบเสร็จ: prerequisite fail-closed ผ่าน caller จริงในเบราว์เซอร์
//
// unit (tests/di_to_receipt_failclosed.test.js) รัน convertToReceipt ใน node:vm.
// สเปคนี้พิสูจน์ "ทางเข้าจริง" ทั้งสองทางบน Chromium: dropdown ของแถว (.di-status-select)
// และปุ่มในหน้า preview (#diConvertReceiptBtn) — โมดูลจริงถูก import จาก origin,
// ฟิกซ์เจอร์ block ทุก request ข้าม origin และปิด service worker.
//
// ไม่มีการต่อ Supabase/DB จริง: window.fetch ถูก stub ทั้งหมด และ _appXhrPost/_appXhrPatch
// เก็บลง ledger เพื่อ assert ว่าไม่มี write ใด ๆ ตอน prerequisite ล้ม.

import { test, expect } from "@playwright/test";

const FIXTURE_URL = "/__phase626__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 626 fixture</title></head>'
  + '<body><div id="page-delivery_invoices"></div></body></html>';

const MSG = {
  DUP_FAIL: "ตรวจสอบใบเสร็จเดิมไม่สำเร็จ — ยังไม่สร้างใบเสร็จ กรุณาลองใหม่",
  ITEM_FAIL: "โหลดรายการสินค้าไม่สำเร็จ — ยังไม่สร้างใบเสร็จ กรุณาลองใหม่",
  EMPTY: "ไม่พบรายการในใบส่งสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง",
  NO_ID: "อาจสร้างใบเสร็จแล้ว แต่ยืนยันรหัสไม่ได้ — โปรดตรวจรายการใบเสร็จก่อนลองใหม่",
  OK: "ออกใบเสร็จรับเงินแล้ว: RC-SERVER-626",
};

const ROWS = [
  { product_id: 11, item_name: "แอร์ 12000 BTU", qty: 2, unit: "เครื่อง", unit_price: 15000, discount_pct: 10, line_total: 27000, sort_order: 1 },
  { product_id: 12, item_name: "ค่าติดตั้ง", qty: 1, unit: "งาน", unit_price: 2500, discount_pct: 0, line_total: 2500, sort_order: 2 },
];

// ทุกอย่างถูกติดตั้งก่อนสคริปต์ของหน้าเริ่มทำงาน: ปิด SW + วาง stub + ledger
function installFixture(rows) {
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture")));
  window.__ledger = [];
  window.__toasts = [];
  window.__plan = { dup: { status: 200, body: [] }, items: { status: 200, body: rows }, header: { ok: true, data: { id: 626001, receipt_no: "RC-SERVER-626" } } };
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-fixture";

  const reply = (plan) => {
    if (plan.mode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    const status = plan.status === undefined ? 200 : plan.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => (plan.mode === "badjson"
        ? Promise.reject(new SyntaxError("Unexpected token <"))
        : Promise.resolve(plan.body)),
    });
  };
  window.fetch = (url) => {
    const u = String(url);
    window.__ledger.push({ m: "GET", url: u });
    if (u.includes("/rest/v1/receipts?")) return reply(window.__plan.dup);
    if (u.includes("/rest/v1/delivery_invoice_items?")) return reply(window.__plan.items);
    return reply({ status: 200, body: [] });          // stock_movements ฯลฯ
  };
  window._appXhrPost = async (table, payload, opts) => {
    window.__ledger.push({ m: "POST", table, payload, opts });
    if (table === "receipts") return window.__plan.header;
    return { ok: true };
  };
  window._appXhrPatch = async (table, payload, col, val) => {
    window.__ledger.push({ m: "PATCH", table, payload, col, val });
    return { ok: true };
  };
  window._appXhrPut = async (...a) => { window.__ledger.push({ m: "PUT", a }); return { ok: true }; };
  window._appXhrDelete = async (...a) => { window.__ledger.push({ m: "DELETE", a }); return { ok: true }; };

  const toast = (m) => window.__toasts.push(String(m));
  window.App = {
    showToast: toast,
    confirm: async () => true,
    state: { profile: { role: "admin" } },
  };
  window.__ctx = {
    state: {
      profile: { role: "admin" },
      storeInfo: { name: "ร้านทดสอบ" },
      products: [], quotations: [], receipts: [],
      deliveryInvoices: [{
        id: 626, inv_no: "INV-626", status: "pending", quotation_id: 900,
        created_at: "2026-09-20T03:00:00.000Z",
        customer_name: "ลูกค้าทดสอบ", customer_phone: "0800000000",
        customer_address: "99 ถนนทดสอบ", customer_tax_id: "1234567890123",
        total_amount: 29500, discount_pct: 0, discount_amount: 0, after_discount: 29500,
        grand_total: 29500, payment_terms: "เงินสด", credit_days: 0,
      }],
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
  await page.addInitScript(installFixture, ROWS);
  await page.goto(FIXTURE_URL);
  await page.evaluate(async () => {
    const mod = await import("/modules/delivery_invoices.js");
    window.__mod = mod;
    mod.renderDeliveryInvoicesPage(window.__ctx);
  });
  await expect(page.locator(".di-status-select")).toHaveCount(1);
}

const setPlan = (page, plan) => page.evaluate((p) => { Object.assign(window.__plan, p); }, plan);
const readState = (page) => page.evaluate(() => ({ ledger: window.__ledger, toasts: window.__toasts }));

async function triggerViaDropdown(page) {
  await page.evaluate(() => { window.__ledger.length = 0; window.__toasts.length = 0; });
  await page.selectOption(".di-status-select", "receipt");
  await page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 5000 });
}

async function triggerViaPreview(page) {
  await page.locator(".di-view-btn").first().click();
  await expect(page.locator("#diConvertReceiptBtn")).toHaveCount(1);
  await page.evaluate(() => { window.__ledger.length = 0; window.__toasts.length = 0; });
  await page.click("#diConvertReceiptBtn");
  await page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 5000 });
}

function expectNoWrites(ledger, label) {
  const writes = ledger.filter((e) => ["POST", "PATCH", "PUT", "DELETE", "ROUTE", "RELOAD"].includes(e.m));
  expect(writes, `${label}: ห้ามมี write/route/reload — เจอ ${JSON.stringify(writes)}`).toEqual([]);
}

for (const [label, viewport] of [["mobile 390x844", { width: 390, height: 844 }], ["desktop 1280x800", { width: 1280, height: 800 }]]) {
  test.describe(`Phase 626 · ${label}`, () => {
    for (const [entry, trigger] of [["dropdown แถว", triggerViaDropdown], ["ปุ่มในหน้า preview", triggerViaPreview]]) {
      test(`${entry}: duplicate lookup HTTP 500 (body []) → ไม่สร้างใบเสร็จ`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { dup: { status: 500, body: [] } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts).toEqual([MSG.DUP_FAIL]);
        expectNoWrites(ledger, entry);
      });

      test(`${entry}: duplicate malformed JSON → ไม่สร้างใบเสร็จ`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { dup: { status: 200, mode: "badjson" } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts).toEqual([MSG.DUP_FAIL]);
        expectNoWrites(ledger, entry);
      });

      test(`${entry}: duplicate ไม่ใช่ array → ไม่สร้างใบเสร็จ`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { dup: { status: 200, body: null } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts).toEqual([MSG.DUP_FAIL]);
        expectNoWrites(ledger, entry);
      });

      test(`${entry}: โหลดรายการล้ม (HTTP 503 พร้อม body ที่ใช้ได้) → ไม่สร้างใบเสร็จ`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { items: { status: 503, body: ROWS } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts).toEqual([MSG.ITEM_FAIL]);
        expectNoWrites(ledger, entry);
      });

      test(`${entry}: ใบส่งสินค้าไม่มีรายการ → บล็อกตาม R1 ไม่มี override`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { items: { status: 200, body: [] } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts).toEqual([MSG.EMPTY]);
        expectNoWrites(ledger, entry);
      });

      test(`${entry}: header ok:true แต่ไม่มี id → หยุด write ที่เหลือ (R3)`, async ({ page }) => {
        await boot(page, viewport);
        await setPlan(page, { header: { ok: true, data: { receipt_no: "RC-SERVER-626" } } });
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts.at(-1)).toBe(MSG.NO_ID);
        expect(ledger.filter((e) => e.m === "POST").map((e) => e.table)).toEqual(["receipts"]);
        expect(ledger.filter((e) => ["PATCH", "PUT", "DELETE", "ROUTE", "RELOAD"].includes(e.m))).toEqual([]);
      });

      test(`${entry}: prerequisite ครบ → ออกใบเสร็จพร้อมรายการครบตามลำดับ`, async ({ page }) => {
        await boot(page, viewport);
        await trigger(page);
        const { ledger, toasts } = await readState(page);
        expect(toasts.at(-1)).toBe(MSG.OK);
        const posts = ledger.filter((e) => e.m === "POST");
        expect(posts.map((e) => e.table)).toEqual(["receipts", "receipt_items", "receipt_items"]);
        expect(posts.slice(1).map((e) => [e.payload.item_name, e.payload.sort_order, e.payload.receipt_id]))
          .toEqual([["แอร์ 12000 BTU", 1, 626001], ["ค่าติดตั้ง", 2, 626001]]);
        expect(ledger.filter((e) => e.m === "PATCH").map((e) => e.table)).toEqual(["delivery_invoices", "quotations"]);
        expect(ledger.filter((e) => e.m === "ROUTE").map((e) => e.r)).toEqual(["receipts"]);
        expect(ledger.filter((e) => ["PUT", "DELETE"].includes(e.m))).toEqual([]);
      });
    }

    test("ไม่มี service worker ถูกลงทะเบียน และไม่มี request ข้าม origin", async ({ page }) => {
      const external = [];
      page.on("requestfailed", (r) => { if (!r.url().startsWith("http://127.0.0.1:") && !r.url().startsWith("http://localhost:")) external.push(r.url()); });
      await boot(page, viewport);
      await triggerViaDropdown(page);
      expect(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))).toBe(false);
      expect(external, `external requests: ${external.join(", ")}`).toEqual([]);
    });
  });
}
