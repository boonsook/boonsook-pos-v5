// Phase 628B — document item_type (หัวข้อ) ผ่านโมดูลจริงใน Chromium
//
// unit (tests/phase628b_document_item_type_runtime.test.js) รันฟังก์ชันใน node:vm.
// สเปคนี้ import โมดูลจริงจาก origin (quotations / delivery_invoices / receipts) ในหน้า fixture
// ที่ปิด service worker, block ทุก request ข้าม origin และ stub fetch + _appXhr* เป็น ledger
// — ไม่มี Supabase/DB จริง. ครอบ: ฟอร์ม (เพิ่มหัวข้อ · ขึ้น/ลง · ยอด · layout 360/390/desktop),
// reload/edit, preview 3 เอกสาร (escape · colspan · ลายสลับนับเฉพาะสินค้า), ledger QT→DI→RC,
// zero-write gates, print/PDF ด้วย PRINT_CSS จริงบน tests/e2e/fixtures/doc-print.html
// (heading ต้องไม่แยกหน้ากับรายการถัดไป — วัดจาก PDF ที่ Chromium สร้างจริง) และ positive control XSS.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { extractRowCallback, extractNumHelper } from "../phase629_document_unit_xss.shared.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

const FIXTURE_URL = "/__phase628b__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 628B fixture</title>'
  + '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/doc-print.css"></head>'
  + '<body><div id="page-quotations"></div><div id="page-delivery_invoices"></div><div id="page-receipts"></div>'
  + '<table><tbody id="host"></tbody></table></body></html>';

const PAYLOAD_IMG = '<img src=x onerror="window.__phase628bPwned=1">';
const PAYLOAD_DQ = '" autofocus onfocus="window.__phase628bPwned=1';

const MSG = {
  SAVED: "บันทึกใบเสนอราคาแล้ว",
  EMPTY: "เพิ่มรายการสินค้าอย่างน้อย 1 รายการ",
  HEADING_ONLY: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ — มีแต่หัวข้อบันทึกไม่ได้",
  QT_NO_ITEMS: "ใบเสนอราคานี้ไม่มีรายการสินค้า (ว่างหรือมีแต่หัวข้อ) — ยังไม่สร้างใบส่งสินค้า",
  RC_HEADING_ONLY: "ใบส่งสินค้านี้มีแต่หัวข้อ ไม่มีรายการสินค้า จึงยังออกใบเสร็จไม่ได้ — กรุณาตรวจเอกสารต้นทาง",
  DI_OK: "สร้างใบส่งสินค้าแล้ว: INV-628B",
  RC_OK: "ออกใบเสร็จรับเงินแล้ว: RC-628B",
};

const HEAD = (name, so) => ({ product_id: null, item_name: name, qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, sort_order: so, item_type: "heading" });
const ITEM = (name, qty, price, so) => ({ product_id: null, item_name: name, qty, unit: "เครื่อง", unit_price: price, discount_pct: 0, line_total: qty * price, sort_order: so, item_type: "item" });

// ทุกอย่างติดตั้งก่อนสคริปต์ของหน้า: ปิด SW + stub network + ledger + ctx
function installFixture(rows) {
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture")));
  window.__ledger = [];
  window.__toasts = [];
  window.__rows = rows;
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-fixture";
  const nowIso = new Date().toISOString();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const reply = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(clone(body)) });
  const doc = { customer_name: "ลูกค้าทดสอบ", customer_phone: "0800000000", created_at: nowIso, total_amount: 32500,
    grand_total: 32500, amount: 32500, after_discount: 32500, discount_pct: 0, discount_amount: 0, withholding_tax: false,
    wht_pct: 3, wht_amount: 0, payment_terms: "เงินสด", credit_days: 0, salesperson: "พนักงาน", status: "pending" };
  const quote = { ...doc, id: 7001, qt_no: "QT-628B" };
  const invoice = { ...doc, id: 7101, inv_no: "INV-628B", quotation_id: 7001 };
  const receipt = { ...doc, id: 7201, receipt_no: "RC-628B", delivery_invoice_id: 7101, quotation_id: 7001 };
  window.fetch = (url, init) => {
    const u = String(url);
    window.__ledger.push({ m: (init && init.method) || "GET", url: u });
    for (const t of ["quotation_items", "delivery_invoice_items", "receipt_items"]) {
      if (u.includes(`/rest/v1/${t}?`)) return reply(window.__rows[t] || []);
    }
    if (u.includes("/rest/v1/receipts?select=")) return reply([receipt]);   // range fetch ของหน้า list ใบเสร็จ
    return reply([]);                                                      // duplicate lookups · stock_movements
  };
  window._appXhrPost = async (table, payload, opts) => {
    window.__ledger.push({ m: "POST", table, payload: clone(payload), opts });
    if (table === "quotations") return { ok: true, data: { id: 7001 } };
    if (table === "delivery_invoices") return { ok: true, data: { id: 7101, inv_no: "INV-628B" } };
    if (table === "receipts") return { ok: true, data: { id: 7201, receipt_no: "RC-628B" } };
    return { ok: true };
  };
  window._appXhrPatch = async (table, payload, col, val) => { window.__ledger.push({ m: "PATCH", table, payload: clone(payload), col, val }); return { ok: true }; };
  window._appXhrDelete = async (table, col, val) => { window.__ledger.push({ m: "DELETE", table, col, val }); return { ok: true }; };
  window._appXhrPut = async (...a) => { window.__ledger.push({ m: "PUT", a }); return { ok: true }; };
  window._appShareDoc = () => {};
  const toast = (m) => window.__toasts.push(String(m));
  window.App = { showToast: toast, confirm: async () => true, state: { profile: { role: "admin" } } };
  window.__ctx = {
    state: {
      profile: { role: "admin", full_name: "พนักงาน" }, storeInfo: { name: "ร้านทดสอบ" },
      customers: [], products: [], paymentInfo: { banks: [] },
      quotations: [quote], deliveryInvoices: [invoice], receipts: [receipt],
    },
    money: (n) => String(n),
    showToast: toast,
    showRoute: (r) => window.__ledger.push({ m: "ROUTE", r }),
    loadAllData: async () => { window.__ledger.push({ m: "RELOAD" }); },
  };
}

async function boot(page, viewport, rows = {}) {
  await page.setViewportSize(viewport);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.addInitScript(installFixture, { quotation_items: [], delivery_invoice_items: [], receipt_items: [], ...rows });
  await page.goto(FIXTURE_URL);
  await page.evaluate(async () => {
    window.__qt = await import("/modules/quotations.js");
    window.__di = await import("/modules/delivery_invoices.js");
    window.__rc = await import("/modules/receipts.js");
  });
}

const renderPage = (page, which) => page.evaluate((w) => {
  const fn = { qt: "renderQuotationsPage", di: "renderDeliveryInvoicesPage", rc: "renderReceiptsPage" }[w];
  window["__" + w][fn](window.__ctx);
}, which);
const state = (page) => page.evaluate(() => ({ ledger: window.__ledger, toasts: window.__toasts }));
const writesOf = (ledger) => ledger.filter((e) => ["POST", "PATCH", "DELETE", "PUT"].includes(e.m));
const resetLedger = (page) => page.evaluate(() => { window.__ledger.length = 0; window.__toasts.length = 0; });
const waitToast = (page, msg) => page.waitForFunction((m) => window.__toasts.includes(m), msg, { timeout: 5000 });

const lineRows = (page) => page.locator("#qtLineItemsBody tr");
async function change(locator, value) {
  await locator.fill(String(value));
  await locator.dispatchEvent("change");
}
async function addCustomItem(page) {
  await page.click("#qtAddItemBtn");
  await page.click("#qtAddCustomItem");
}
async function setItem(page, itemIndex, { name, qty, price }) {
  const row = () => page.locator("#qtLineItemsBody tr.qt-item-row").nth(itemIndex);
  await expect(row(), "แถวสินค้าต้องมี class qt-item-row").toHaveCount(1);
  await change(row().locator(".qt-li-name"), name);
  await change(row().locator(".qt-li-qty"), qty);
  await change(row().locator(".qt-li-price"), price);
}
const rowSummary = (page) => page.evaluate(() => [...document.querySelectorAll("#qtLineItemsBody tr")].map((tr) => ({
  cls: tr.className,
  name: (tr.querySelector(".qt-li-name, .qt-li-heading-name") || {}).value,
  qty: (tr.querySelector(".qt-li-qty") || {}).value ?? null,
  price: (tr.querySelector(".qt-li-price") || {}).value ?? null,
  up: tr.querySelector(".qt-li-up")?.disabled ?? null,
  down: tr.querySelector(".qt-li-down")?.disabled ?? null,
})));

const VIEWPORTS = [
  ["mobile 360x844", { width: 360, height: 844 }],
  ["mobile 390x844", { width: 390, height: 844 }],
  ["desktop 1280x800", { width: 1280, height: 800 }],
];

for (const [label, viewport] of VIEWPORTS) {
  test.describe(`Phase 628B · ${label}`, () => {
    test("ฟอร์ม: หัวข้อ + 2 รายการ · ขึ้น/ลง (ขอบ disabled) · ค่าคงเดิม · ยอดจาก 2 รายการ · ไม่ล้นจอ · บันทึก payload ตรง", async ({ page }) => {
      await boot(page, viewport);
      await renderPage(page, "qt");
      await page.click("#qtAddBtn");
      await addCustomItem(page);
      await setItem(page, 0, { name: "แอร์ติดผนัง 12000 BTU", qty: 2, price: 15000 });
      await expect(page.locator("#qtAddHeadingBtn"), "ต้องมีปุ่ม + เพิ่มหัวข้อ").toHaveCount(1);
      await page.click("#qtAddHeadingBtn");
      await expect(page.locator("#qtLineItemsBody tr.qt-heading-row .qt-li-heading-name")).toHaveValue("หัวข้อใหม่");
      await change(page.locator("#qtLineItemsBody .qt-li-heading-name"), "หมวด งานติดตั้ง");
      await addCustomItem(page);
      await setItem(page, 1, { name: "ค่าติดตั้ง", qty: 1, price: 2500 });
      expect((await rowSummary(page)).map((r) => r.cls)).toEqual(["qt-item-row", "qt-heading-row", "qt-item-row"]);

      await page.locator("#qtLineItemsBody tr.qt-heading-row .qt-li-up").click();   // หัวข้อขึ้นบนสุด
      let rows = await rowSummary(page);
      expect(rows.map((r) => [r.cls, r.name])).toEqual([
        ["qt-heading-row", "หมวด งานติดตั้ง"], ["qt-item-row", "แอร์ติดผนัง 12000 BTU"], ["qt-item-row", "ค่าติดตั้ง"],
      ]);
      expect(rows.map((r) => r.up)).toEqual([true, false, false]);
      expect(rows.map((r) => r.down)).toEqual([false, false, true]);
      await expect(page.locator("#qtLineItemsBody tr.qt-heading-row .qt-li-qty, #qtLineItemsBody tr.qt-heading-row .qt-li-price")).toHaveCount(0);

      await lineRows(page).nth(1).locator(".qt-li-down").click();   // สลับ 2 รายการแล้วกลับ — ค่าต้องไม่หาย/ไม่สลับ
      expect((await rowSummary(page)).map((r) => r.name)).toEqual(["หมวด งานติดตั้ง", "ค่าติดตั้ง", "แอร์ติดผนัง 12000 BTU"]);
      await lineRows(page).nth(2).locator(".qt-li-up").click();
      rows = await rowSummary(page);
      expect(rows.map((r) => [r.name, r.qty, r.price])).toEqual([
        ["หมวด งานติดตั้ง", null, null], ["แอร์ติดผนัง 12000 BTU", "2", "15000"], ["ค่าติดตั้ง", "1", "2500"],
      ]);
      await expect(page.locator("#page-quotations")).toContainText("32,500.00");

      const layout = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
        return {
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          heading: box(document.querySelector("#qtLineItemsBody .qt-li-heading-name")),
          buttons: [...document.querySelectorAll("#qtLineItemsBody button")].map(box),
          addHeading: box(document.getElementById("qtAddHeadingBtn")),
        };
      });
      expect(layout.scrollW, "หน้าไม่ล้นแนวนอน").toBeLessThanOrEqual(layout.innerW);
      expect(layout.heading.w, "ช่องชื่อหัวข้อต้องกว้างพอพิมพ์").toBeGreaterThanOrEqual(100);
      for (const b of [...layout.buttons, layout.addHeading]) {
        expect(b.w).toBeGreaterThanOrEqual(20);
        expect(b.h).toBeGreaterThanOrEqual(20);
      }

      await page.fill("#qt_customerSearch", "ลูกค้า ทดสอบ");
      await resetLedger(page);
      await page.click("#qtSaveBtn");
      await waitToast(page, MSG.SAVED);
      const { ledger } = await state(page);
      const header = ledger.find((e) => e.m === "POST" && e.table === "quotations");
      expect(header.payload.total_amount).toBe(32500);
      expect(header.payload.grand_total).toBe(32500);
      expect(ledger.filter((e) => e.m === "POST" && e.table === "quotation_items").map((e) => e.payload)).toEqual([
        { quotation_id: 7001, product_id: null, item_name: "หมวด งานติดตั้ง", qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, item_type: "heading", sort_order: 1 },
        { quotation_id: 7001, product_id: null, item_name: "แอร์ติดผนัง 12000 BTU", qty: 2, unit: "ชิ้น", unit_price: 15000, discount_pct: 0, line_total: 30000, item_type: "item", sort_order: 2 },
        { quotation_id: 7001, product_id: null, item_name: "ค่าติดตั้ง", qty: 1, unit: "ชิ้น", unit_price: 2500, discount_pct: 0, line_total: 2500, item_type: "item", sort_order: 3 },
      ]);
    });

    test("reload/edit: heading จาก DB คงชนิด (ไม่มีช่องจำนวน) · re-save ยังเป็น heading ลำดับเดิม", async ({ page }) => {
      const saved = [HEAD("หมวด งานติดตั้ง", 1), ITEM("แอร์ติดผนัง", 2, 15000, 2), ITEM("ค่าติดตั้ง", 1, 2500, 3)];
      await boot(page, viewport, { quotation_items: saved });
      await renderPage(page, "qt");
      await page.selectOption(".qt-status-select", "edit");
      await expect(page.locator("#qtLineItemsBody tr.qt-heading-row")).toHaveCount(1);
      await expect(page.locator("#qtLineItemsBody tr.qt-heading-row .qt-li-heading-name")).toHaveValue("หมวด งานติดตั้ง");
      await expect(page.locator("#qtLineItemsBody tr.qt-heading-row input")).toHaveCount(1);
      await expect(page.locator("#page-quotations")).toContainText("32,500.00");
      await resetLedger(page);
      await page.click("#qtSaveBtn");
      await waitToast(page, MSG.SAVED);
      const { ledger } = await state(page);
      expect(writesOf(ledger).map((e) => `${e.m} ${e.table}`)).toEqual([
        "PATCH quotations", "DELETE quotation_items", "POST quotation_items", "POST quotation_items", "POST quotation_items",
      ]);
      expect(ledger.filter((e) => e.m === "POST").map((e) => [e.payload.item_name, e.payload.item_type, e.payload.qty, e.payload.sort_order]))
        .toEqual([["หมวด งานติดตั้ง", "heading", 0, 1], ["แอร์ติดผนัง", "item", 2, 2], ["ค่าติดตั้ง", "item", 1, 3]]);
    });

    test("preview QT/DI/RC: heading escape เป็นข้อความ · colspan 5 · ไม่มีตัวเลข · ลายสลับนับเฉพาะแถวสินค้า", async ({ page }) => {
      const rows = [HEAD(PAYLOAD_IMG, 1), ITEM("สินค้า A", 1, 100, 2), HEAD(PAYLOAD_DQ, 3), ITEM("สินค้า B", 1, 200, 4), ITEM("สินค้า C", 1, 300, 5)];
      await boot(page, viewport, { quotation_items: rows, delivery_invoice_items: rows, receipt_items: rows });
      for (const [which, viewBtn, previewId] of [["qt", ".qt-view-btn", "#qtDocPreview"], ["di", ".di-view-btn", "#diDocPreview"], ["rc", ".rc-view-btn", "#rcDocPreview"]]) {
        await renderPage(page, which);
        await page.locator(viewBtn).first().click();
        await expect(page.locator(`${previewId} .doc-table`).first()).toBeVisible();
        await page.waitForTimeout(300);   // ให้ <img src=x> ล้มก่อน (ถ้าหลุดเป็น element)
        const r = await page.evaluate((sel) => {
          const tables = [...document.querySelectorAll(`${sel} .doc-table`)];
          const bg = (tr) => getComputedStyle(tr.cells[0]).backgroundColor;
          return {
            pwned: window.__phase628bPwned,
            imgs: document.querySelectorAll(`${sel} .doc-table img`).length,
            risky: [...document.querySelectorAll(`${sel} .doc-table *`)].flatMap((e) => [...e.attributes].map((a) => a.name))
              .filter((n) => n === "autofocus" || n.startsWith("on")),
            tables: tables.map((t) => [...t.tBodies[0].rows].map((tr) => ({
              cls: tr.className, cells: tr.cells.length, span: tr.cells[0].colSpan, text: tr.cells[0].textContent, bg: bg(tr),
              fw: Number(getComputedStyle(tr.cells[0]).fontWeight),
            }))),
          };
        }, previewId);
        expect(r.pwned, `${which}: payload ห้ามรัน`).toBeUndefined();
        expect(r.imgs, `${which}: ห้ามมี <img> ในตาราง`).toBe(0);
        expect(r.risky, `${which}: ห้ามมี handler attribute`).toEqual([]);
        expect(r.tables.length).toBeGreaterThanOrEqual(1);
        for (const t of r.tables) {
          expect(t.map((x) => x.cls)).toEqual(["doc-heading-row", "doc-item-row", "doc-heading-row", "doc-item-row", "doc-item-row"]);
          for (const [i, payload] of [[0, PAYLOAD_IMG], [2, PAYLOAD_DQ]]) {
            expect(t[i].cells, `${which}: heading ช่องเดียว`).toBe(1);
            expect(t[i].span, `${which}: colspan 5`).toBe(5);
            expect(t[i].text, `${which}: heading เป็นข้อความตรงตัว`).toBe(payload);
            expect(t[i].fw).toBeGreaterThanOrEqual(700);
          }
          const items = t.filter((x) => x.cls === "doc-item-row");
          expect(items.map((x) => x.cells)).toEqual([5, 5, 5]);
          expect(items.map((x) => x.bg), `${which}: ลายสลับนับเฉพาะสินค้า (1=ไม่มี 2=มี 3=ไม่มี)`).toEqual(
            ["rgba(0, 0, 0, 0)", "rgb(250, 250, 250)", "rgba(0, 0, 0, 0)"]);
          expect(t[0].bg).toBe(t[2].bg);
          expect(t[0].bg).not.toBe("rgba(0, 0, 0, 0)");
        }
      }
    });

    test("ledger QT→DI→RC: ชนิด + sort_order ตามลำดับเดิมครบทุกแถว", async ({ page }) => {
      const qtRows = [HEAD("หมวด A", 1), ITEM("แอร์", 2, 15000, 2), HEAD("หมวด B", 3), ITEM("ค่าติดตั้ง", 1, 2500, 4)];
      await boot(page, viewport, { quotation_items: qtRows });
      await renderPage(page, "qt");
      await page.locator(".qt-view-btn").first().click();
      await expect(page.locator("#qtConvertBtn")).toHaveCount(1);
      await resetLedger(page);
      await page.click("#qtConvertBtn");
      await waitToast(page, MSG.DI_OK);
      let { ledger } = await state(page);
      const diPosts = ledger.filter((e) => e.m === "POST" && e.table === "delivery_invoice_items").map((e) => e.payload);
      expect(diPosts.map((p) => [p.item_name, p.item_type, p.sort_order, p.qty, p.line_total])).toEqual([
        ["หมวด A", "heading", 1, 0, 0], ["แอร์", "item", 2, 2, 30000], ["หมวด B", "heading", 3, 0, 0], ["ค่าติดตั้ง", "item", 4, 1, 2500],
      ]);
      // สิ่งที่ DB เก็บ = payload ที่ส่งไปจริง → ใช้เป็นแถวต้นทางของใบเสร็จ
      await page.evaluate((rows) => { window.__rows.delivery_invoice_items = rows; },
        diPosts.map((p, i) => ({ id: 900 + i, ...p })));
      await renderPage(page, "di");
      await resetLedger(page);
      await page.selectOption(".di-status-select", "receipt");
      await waitToast(page, MSG.RC_OK);
      ({ ledger } = await state(page));
      const rcPosts = ledger.filter((e) => e.m === "POST" && e.table === "receipt_items").map((e) => e.payload);
      expect(rcPosts.map((p) => [p.item_name, p.item_type, p.sort_order, p.qty, p.line_total]), "ทุกแถวส่ง item_type ชัด ๆ").toEqual([
        ["หมวด A", "heading", 1, 0, 0], ["แอร์", "item", 2, 2, 30000],
        ["หมวด B", "heading", 3, 0, 0], ["ค่าติดตั้ง", "item", 4, 1, 2500],
      ]);
    });

    test("ว่าง / มีแต่หัวข้อ: ไม่มี POST/PATCH/DELETE เลย (save · QT→DI · DI→RC)", async ({ page }) => {
      await boot(page, viewport, {
        quotation_items: [HEAD("หมวด A", 1), HEAD("หมวด B", 2)],
        delivery_invoice_items: [HEAD("หมวด A", 1), HEAD("หมวด B", 2)],
      });
      await renderPage(page, "qt");
      await page.click("#qtAddBtn");
      await page.fill("#qt_customerSearch", "ลูกค้า ทดสอบ");
      await resetLedger(page);
      await page.click("#qtSaveBtn");
      await waitToast(page, MSG.EMPTY);
      await expect(page.locator("#qtAddHeadingBtn"), "ต้องมีปุ่ม + เพิ่มหัวข้อ").toHaveCount(1);
      await page.click("#qtAddHeadingBtn");
      await page.click("#qtSaveBtn");
      await waitToast(page, MSG.HEADING_ONLY);
      expect(writesOf((await state(page)).ledger), "save ว่าง/มีแต่หัวข้อ").toEqual([]);

      await page.click("#qtBackBtn");
      await page.locator(".qt-view-btn").first().click();
      await expect(page.locator("#qtConvertBtn")).toHaveCount(1);
      await resetLedger(page);
      await page.click("#qtConvertBtn");
      await waitToast(page, MSG.QT_NO_ITEMS);
      expect(writesOf((await state(page)).ledger), "QT→DI มีแต่หัวข้อ").toEqual([]);

      await renderPage(page, "di");
      await resetLedger(page);
      await page.selectOption(".di-status-select", "receipt");
      await waitToast(page, MSG.RC_HEADING_ONLY);
      const { ledger } = await state(page);
      expect(writesOf(ledger), "DI→RC มีแต่หัวข้อ").toEqual([]);
      expect(ledger.filter((e) => e.m === "ROUTE" || e.m === "RELOAD")).toEqual([]);
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  print / PDF — PRINT_CSS จริงจาก modules/doc-utils.js บน fixture doc-print.html
// ═══════════════════════════════════════════════════════════
const QT_SRC = read("modules/quotations.js");
const DI_SRC = read("modules/delivery_invoices.js");
const RC_SRC = read("modules/receipts.js");
const SITES = [
  { id: "QT-FORM", src: QT_SRC, fnDecl: "function renderQuotationForm(container) {", payload: PAYLOAD_DQ },
  { id: "QT-PREVIEW", src: QT_SRC, fnDecl: "function renderQuotationPreview(container) {", payload: PAYLOAD_IMG },
  { id: "DI-PREVIEW", src: DI_SRC, fnDecl: "function renderInvoicePreview(container) {", payload: PAYLOAD_IMG },
  { id: "RC-PREVIEW", src: RC_SRC, fnDecl: "function renderReceiptPreview(container) {", payload: PAYLOAD_IMG },
];
for (const s of SITES) { s.callback = extractRowCallback(s.src, s); s.num = extractNumHelper(s.src); }

async function renderRows(page, site, rows) {
  return page.evaluate(async ({ numSrc, callbackSrc, rows }) => {
    const utilsUrl = new URL("/modules/utils.js", location.origin).href;
    const src = `import { escHtml } from ${JSON.stringify(utilsUrl)};\n${numSrc}\nexport default (${callbackSrc});`;
    const mod = await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    return rows.map((r, i) => mod.default(r, i)).join("");
  }, { numSrc: site.num, callbackSrc: site.callback, rows });
}

// หา "สี" ที่ถูกวาดในแต่ละหน้าของ PDF (content stream ของแต่ละ /Page) — ไม่ต้องเพิ่ม dependency
function pdfPageColors(buf, colors) {
  const s = buf.toString("latin1");
  const objs = new Map();
  for (const m of s.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objs.set(Number(m[1]), m[2]);
  const pagesObj = [...objs.values()].find((o) => /\/Type\s*\/Pages\b/.test(o));
  const kids = [...pagesObj.match(/\/Kids\s*\[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  return kids.map((k) => {
    const refs = objs.get(k).match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)[1];
    let content = "";
    for (const r of refs.matchAll(/(\d+) 0 R/g)) {
      const o = objs.get(Number(r[1]));
      const at = o.indexOf("stream") + "stream".length;
      let raw = Buffer.from(o.slice(at, o.lastIndexOf("endstream")).replace(/^\r?\n/, ""), "latin1");
      if (/FlateDecode/.test(o.slice(0, at))) raw = zlib.inflateSync(raw);
      content += raw.toString("latin1");
    }
    return colors.filter((c) => content.includes(c.op)).map((c) => c.name);
  });
}

test("print/PDF: PRINT_CSS จริง — heading เด่น · ลายสลับนับเฉพาะสินค้า · heading ไม่แยกหน้ากับรายการถัดไป (positive control แยก)", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto("/tests/e2e/fixtures/doc-print.html?kind=receipt&rows=3");
  await page.waitForFunction(() => window.__ready === true);
  const html = await renderRows(page, SITES[1], [ITEM("สินค้า A", 1, 100, 1), HEAD("หมวด งานติดตั้ง", 2), ITEM("สินค้า B", 1, 200, 3), ITEM("สินค้า C", 1, 300, 4)]);

  const styles = await page.evaluate((rowsHtml) => {
    const tbody = document.querySelector("#docPreview .doc-table tbody");
    tbody.innerHTML = rowsHtml;
    return [...tbody.rows].map((tr) => ({
      cls: tr.className, bg: getComputedStyle(tr.cells[0]).backgroundColor,
      fw: Number(getComputedStyle(tr.cells[0]).fontWeight), breakAfter: getComputedStyle(tr).breakAfter,
    }));
  }, html);
  expect(styles.map((x) => x.cls)).toEqual(["doc-item-row", "doc-heading-row", "doc-item-row", "doc-item-row"]);
  expect(styles.filter((x) => x.cls === "doc-item-row").map((x) => x.bg), "PRINT_CSS: ลายสลับนับเฉพาะสินค้า")
    .toEqual(["rgba(0, 0, 0, 0)", "rgb(248, 250, 252)", "rgba(0, 0, 0, 0)"]);
  expect(styles[1].fw).toBeGreaterThanOrEqual(700);
  expect(styles[1].bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles[1].breakAfter).toBe("avoid");

  // จัดให้ heading ตกขอบล่างหน้า 1 พอดี: filler + แถวสูง 40px (แถวถัดไปคร่อมขอบ 297mm)
  const probeRows = await renderRows(page, SITES[1], [ITEM("ก่อนหน้า", 1, 1, 1), HEAD("หมวด ต้องไม่ค้างท้ายหน้า", 2), ITEM("ถัดไป", 1, 1, 3), ITEM("ท้าย", 1, 1, 4)]);
  const COLORS = [{ name: "prev", op: "1 1 0 rg" }, { name: "heading", op: "1 0 1 rg" }, { name: "next", op: "0 1 1 rg" }];
  const printPages = async (control) => {
    await page.evaluate(({ rowsHtml, control }) => {
      document.getElementById("docPreview").style.display = "none";
      let probe = document.getElementById("probe628b");
      if (!probe) { probe = document.createElement("div"); probe.id = "probe628b"; document.body.appendChild(probe); }
      probe.innerHTML = "<style>"
        + "#probe628b td{height:40px;padding:0!important;border:0!important}"
        + "#probe628b tr.m-prev td{background:#ffff00!important}"
        + "#probe628b tr.doc-heading-row td{background:#ff00ff!important}"
        + "#probe628b tr.m-next td{background:#00ffff!important}"
        + (control ? "#probe628b tr.doc-heading-row{break-after:auto!important;page-break-after:auto!important}" : "")
        + "</style><div style=\"height:1020px\"></div><table class=\"doc-table\"><tbody>" + rowsHtml + "</tbody></table>";
      const trs = probe.querySelectorAll("tbody tr");
      trs[0].classList.add("m-prev");
      trs[2].classList.add("m-next");
    }, { rowsHtml: probeRows, control });
    let pdf;
    try {
      pdf = await page.pdf({ width: "210mm", height: "297mm", margin: { top: "0", bottom: "0", left: "0", right: "0" }, printBackground: true });
    } catch {
      test.skip(true, "page.pdf() ต้องใช้ chromium แบบ headless");
    }
    return pdfPageColors(pdf, COLORS);
  };
  expect(await printPages(true), "positive control: ไม่มีกฎ → heading ค้างท้ายหน้า 1 แยกจากรายการถัดไป")
    .toEqual([["prev", "heading"], ["next"]]);
  expect(await printPages(false), "PRINT_CSS จริง: heading ถูกพาไปหน้า 2 พร้อมรายการถัดไป")
    .toEqual([["prev"], ["heading", "next"]]);
});

// ═══════════════════════════════════════════════════════════
//  positive control XSS — fixture ไม่มี CSP: ถ้าไม่ escape payload ต้อง "รันได้จริง"
// ═══════════════════════════════════════════════════════════
test("positive control: heading ที่ไม่ escape รัน payload ได้จริงในหน้านี้ · โค้ดจริง (escHtml) ไม่รัน", async ({ page }) => {
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.goto(FIXTURE_URL);
  const heading = (payload) => ({ product_id: null, item_name: payload, qty: 0, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0, item_type: "heading" });
  const run = async (site, callbackSrc) => page.evaluate(async ({ numSrc, callbackSrc, item }) => {
    const utilsUrl = new URL("/modules/utils.js", location.origin).href;
    const src = `import { escHtml } from ${JSON.stringify(utilsUrl)};\n${numSrc}\nexport default (${callbackSrc});`;
    const mod = await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    delete window.__phase628bPwned;
    const host = document.getElementById("host");
    host.innerHTML = mod.default(item, 0);
    for (const el of host.querySelectorAll("input, button")) el.focus();
    await new Promise((r) => setTimeout(r, 300));
    return { pwned: window.__phase628bPwned, html: host.innerHTML };
  }, { numSrc: site.num, callbackSrc, item: heading(site.payload) });

  for (const site of SITES) {
    const unsafe = site.callback.split("escHtml(item.item_name)").join("(item.item_name)");
    expect(unsafe, `${site.id}: ต้องมี escHtml(item.item_name) ให้ถอดได้`).not.toBe(site.callback);
    const bad = await run(site, unsafe);
    expect(bad.pwned, `${site.id} control: payload ต้องรันได้เมื่อไม่ escape — ${bad.html}`).toBe(1);
    const good = await run(site, site.callback);
    expect(good.pwned, `${site.id}: โค้ดจริงต้องไม่รัน payload — ${good.html}`).toBeUndefined();
  }
});
