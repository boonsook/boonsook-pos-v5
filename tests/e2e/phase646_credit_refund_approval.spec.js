import { test, expect } from "@playwright/test";

const FIXTURE = "/__phase646__/refunds.html";
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css?v=642"><link rel="stylesheet" href="/phase4-design-system.css?v=529"><link rel="stylesheet" href="/phase4-components.css?v=421"></head><body><div id="page-refunds"></div></body></html>';

function installMock() {
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("fixture")));
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "public-fixture" };
  window._sbAccessToken = "jwt-fixture";
  window.__calls = [];
  window.__toasts = [];
  window.__requests = [{ id: 17, sale_id: 9, customer_id: 1, refund_method: "credit", status: "pending", reason: "สินค้าชำรุด", quoted_amount: 90, refund_id: null }];
  window.__finalizeTimeout = false;
  window.__lastConfirm = "";
  window.App = { confirm: async (message) => { window.__lastConfirm = message; return true; } };
  window.fetch = async (raw, init = {}) => {
    const path = new URL(String(raw)).pathname;
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    window.__calls.push({ path, method, body });
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (path === "/rest/v1/refunds") return response([]);
    if (path === "/rest/v1/sale_items") return response([{ id: 81, sale_id: 9, product_id: 44, product_name: "สินค้า", qty: 1, unit_price: 100, line_total: 100 }]);
    if (path === "/rest/v1/credit_refund_requests") return response(window.__requests.map(x => ({ ...x })));
    if (path === "/rest/v1/rpc/phase646_submit_credit_refund") return response({ id: 18, sale_id: 9, status: "pending", quoted_amount: 90 });
    if (path === "/rest/v1/rpc/phase646_admin_decide_credit_refund") {
      const row = window.__requests.find(x => x.id === body.p_request_id);
      if (!row || row.status !== "pending" || body.p_expected_quote !== row.quoted_amount) return response({}, 400);
      row.status = body.p_approve ? "approved" : "rejected";
      return response({ ...row });
    }
    if (path === "/rest/v1/rpc/phase646_finalize_credit_refund") {
      const row = window.__requests.find(x => x.id === body.p_request_id);
      if (!row || row.status !== "approved" || body.p_expected_net !== row.quoted_amount) return response({}, 400);
      row.status = "completed";
      row.refund_id = 31;
      if (window.__finalizeTimeout) throw new Error("lost reply after commit");
      return response({ ...row });
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
}

async function boot(page, viewport) {
  await page.setViewportSize(viewport);
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE}`, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML }));
  await page.addInitScript(installMock);
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    const { renderRefundsPage } = await import("/modules/refunds.js");
    window.__renderRefunds = () => renderRefundsPage({
      state: { profile: { role: "admin" }, sales: [{ id: 9, order_no: "BSK-9", customer_id: 1, customer_name: "ลูกค้า", total_amount: 90, created_at: "2026-10-06T00:00:00Z" }], warehouses: [{ id: 2, name: "คลัง" }] },
      showToast: (message) => window.__toasts.push(String(message))
    });
    await window.__renderRefunds();
  });
}

test("mobile: admin confirms net amount before atomic finalization; no direct money writes", async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await expect(page.locator(".rf-approve-credit")).toHaveCount(1);
  await expect(page.locator("#page-refunds")).toContainText("ยอดสุทธิที่ขอคืน ฿90.00");
  await page.locator(".rf-approve-credit").click();
  await expect(page.locator(".rf-finalize-credit")).toHaveCount(1);
  await page.locator(".rf-finalize-credit").click();
  await expect(page.locator("#page-refunds")).toContainText("completed");
  await expect(page.locator(".rf-finalize-credit")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.filter(c => c.path.endsWith("phase646_admin_decide_credit_refund"))).toHaveLength(1);
  expect(calls.filter(c => c.path.endsWith("phase646_finalize_credit_refund"))).toHaveLength(1);
  expect(calls.some(c => c.method !== "GET" && ["/rest/v1/refunds", "/rest/v1/customer_credit_ledger", "/rest/v1/journal_entries"].includes(c.path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("desktop: partial request remains manual review with no approve or finalize action", async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  await page.evaluate(async () => {
    window.__requests[0].status = "manual_review";
    window.__requests[0].review_reason = "partial_return";
    await window.__renderRefunds();
  });
  await expect(page.locator("#page-refunds")).toContainText("พักตรวจมือ: คืนบางรายการ");
  await expect(page.locator(".rf-approve-credit, .rf-finalize-credit")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("lost finalizer response reads completed state; never blindly issues a second refund", async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await page.evaluate(async () => {
    window.__requests[0].status = "approved";
    window.__finalizeTimeout = true;
    await window.__renderRefunds();
  });
  await page.locator(".rf-finalize-credit").click();
  await expect(page.locator("#page-refunds")).toContainText("completed");
  await expect(page.locator(".rf-finalize-credit")).toHaveCount(0);
  expect((await page.evaluate(() => window.__calls)).filter(c => c.path.endsWith("phase646_finalize_credit_refund"))).toHaveLength(1);
});

test("staff-side request labels gross as estimate and leaves final net to the server", async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await page.locator("#rfNewBtn").click();
  await page.locator(".rf-sale-pick").first().click();
  await page.locator(".rf-item-qty").fill("1");
  await page.locator(".rf-item-qty").press("Tab");
  await page.locator("#rfMethodSelect").selectOption("credit");
  await expect(page.locator("#rfAmountLabel")).toContainText("ก่อนส่วนลด");
  await expect(page.locator("#rfSave")).toContainText("ส่งคำขอให้ admin");
  await page.locator("#rfSave").click();
  await expect(page.locator("#rfModal")).toHaveCount(0);
  expect(await page.evaluate(() => window.__lastConfirm)).toContain("ระบบจะใช้ยอดสุทธิจากบิล");
  const calls = await page.evaluate(() => window.__calls);
  const submit = calls.filter(c => c.path.endsWith("phase646_submit_credit_refund"));
  expect(submit).toHaveLength(1);
  expect(submit[0].body.p_items).toEqual([{ sale_item_id: 81, qty: 1 }]);
  expect(calls.some(c => c.method !== "GET" && c.path === "/rest/v1/refunds")).toBe(false);
});
