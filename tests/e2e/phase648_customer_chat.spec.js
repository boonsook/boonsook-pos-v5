// Phase 648 — กล่องแชทลูกค้า (เฟส A): ทางเข้าจริงบน Chromium
//
// โมดูลจริง modules/customer_chat.js + style.css ถูกโหลดจาก origin. ไม่ต่อ Supabase จริง:
// window.fetch ถูกแทนด้วย stub ในหน้า (ledger บันทึกทุก request) · block ทุก request ข้าม origin · ปิด SW.

import { test, expect } from "@playwright/test";

const FIXTURE_URL = "/__phase648__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html lang="th"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<link rel="stylesheet" href="/style.css"><title>Phase 648 fixture</title></head>'
  + '<body><main style="padding:12px"><section id="page-customer_chat" class="page"></section></main></body></html>';

function installFixture() {
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture")));
  window.__ledger = [];
  window.__toasts = [];
  window.__xss = 0;
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-fixture";
  const now = Date.now();
  window.__threads = [
    { id: "t1", display_name: "คุณเอ <img src=x onerror=\"window.__xss++\">", status: "open", unread_count: 2,
      last_message_at: new Date(now - 60000).toISOString(), last_message_preview: "แอร์ 12000 BTU ราคาเท่าไหร่ครับ ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย" },
    { id: "t2", display_name: "", status: "done", unread_count: 0,
      last_message_at: new Date(now - 86400000 * 2).toISOString(), last_message_preview: "[รูปภาพ]" },
  ];
  window.__messages = {
    t1: [
      { id: "m2", direction: "in", message_type: "text", body: "ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย <script>window.__xss++</script>", sent_at: new Date(now - 60000).toISOString() },
      { id: "m1", direction: "in", message_type: "text", body: "แอร์ 12000 BTU ราคาเท่าไหร่ครับ", sent_at: new Date(now - 120000).toISOString() },
    ],
    t2: [{ id: "m3", direction: "in", message_type: "image", body: "[รูปภาพ]", sent_at: new Date(now - 86400000 * 2).toISOString() }],
  };
  const json = (status, body) => ({ status, text: JSON.stringify(body) });
  function handle(method, url, body) {
    const u = new URL(url);
    window.__ledger.push({ m: method, p: u.pathname, q: u.search, body });
    if (u.pathname === "/rest/v1/customer_chat_threads" && method === "GET") return json(200, window.__threads);
    if (u.pathname === "/rest/v1/customer_chat_messages" && method === "GET") {
      const id = decodeURIComponent(u.searchParams.get("thread_id").replace(/^eq\./, ""));
      return json(200, window.__messages[id] || []);
    }
    if (u.pathname === "/rest/v1/rpc/customer_chat_set_thread_state" && method === "POST") {
      const t = window.__threads.find((x) => x.id === body.p_thread_id);
      if (body.p_mark_read) t.unread_count = 0;
      if (body.p_status) t.status = body.p_status;
      return json(200, { id: t.id, status: t.status, unread_count: t.unread_count });
    }
    return json(404, {});
  }
  window.fetch = async (url, init = {}) => {
    const res = handle((init.method || "GET").toUpperCase(), String(url), init.body ? JSON.parse(init.body) : null);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, text: async () => res.text, json: async () => JSON.parse(res.text) };
  };
}

async function boot(page, { role = "admin" } = {}) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.addInitScript(installFixture);
  await page.goto(FIXTURE_URL);
  await page.evaluate(async (r) => {
    const mod = await import("/modules/customer_chat.js");
    await mod.renderCustomerChatPage({
      requireAdminOrSales: () => ["admin", "sales"].includes(r),
      showToast: (m) => window.__toasts.push(String(m)),
    });
  }, role);
}

const ledger = (page) => page.evaluate(() => window.__ledger.map((e) => `${e.m} ${e.p}`));
// body มี overflow-x:hidden → scrollWidth ไม่เห็นของที่ล้น; วัดขอบขวาของกล่อง/ปุ่มจริงแทน
const noHorizontalOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const els = document.querySelectorAll(".cc-wrap, .cc-note, .cc-toolbar button, .cc-list, .cc-detail, .cc-thread, #ccStatusBtn, .cc-bubble");
  return Array.from(els).every((el) => el.getBoundingClientRect().right <= vw + 1);
});

test("C1 mobile 390: list ค้างตอบ → เปิดห้อง → mark read ผ่าน RPC, escape ข้อมูลลูกค้า, ไม่ล้นจอ", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator(".cc-thread")).toHaveCount(1); // "ค้างตอบ": t1 (unread) — t2 done+อ่านแล้ว ถูกกรอง
  await expect(page.locator(".cc-badge")).toHaveText("2");
  expect(await noHorizontalOverflow(page)).toBe(true);

  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await expect(page.locator(".cc-bubble").first()).toHaveText("แอร์ 12000 BTU ราคาเท่าไหร่ครับ"); // เก่า → ใหม่
  await expect(page.locator(".cc-badge")).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  expect(await page.locator(".cc-detail-name").innerText()).toContain("<img");

  const l = await ledger(page);
  expect(l).toEqual([
    "GET /rest/v1/customer_chat_threads",
    "GET /rest/v1/customer_chat_messages",
    "POST /rest/v1/rpc/customer_chat_set_thread_state",
  ]);
  const rpc = await page.evaluate(() => window.__ledger[2].body);
  expect(rpc).toEqual({ p_thread_id: "t1", p_mark_read: true, p_status: null });
  await page.screenshot({ path: "test-results/phase648-mobile.png", fullPage: true });
});

test("C2 desktop: ทั้งหมด → สองคอลัมน์, ทำเครื่องหมายเสร็จ/เปิดใหม่ ใช้ RPC เดียว ไม่มี request อื่น", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await page.locator('[data-cc-filter="all"]').click();
  await expect(page.locator(".cc-thread")).toHaveCount(2);
  await expect(page.locator('[data-thread-id="t2"] .cc-thread-name')).toHaveText("ลูกค้า LINE");
  const listBox = await page.locator("#ccThreadList").boundingBox();
  const detailBox = await page.locator("#ccDetail").boundingBox();
  expect(detailBox.x).toBeGreaterThan(listBox.x + listBox.width - 1); // วางข้างกัน

  await page.locator('[data-thread-id="t2"]').click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("↩️ เปิดใหม่");
  await page.locator("#ccStatusBtn").click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("✅ ทำเครื่องหมายว่าเสร็จ");
  const rpcs = await page.evaluate(() => window.__ledger.filter((e) => e.m !== "GET"));
  expect(rpcs.map((e) => e.p)).toEqual(["/rest/v1/rpc/customer_chat_set_thread_state"]);
  expect(rpcs[0].body).toEqual({ p_thread_id: "t2", p_mark_read: true, p_status: "open" });
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: "test-results/phase648-desktop.png", fullPage: true });
});

test("C3 role อื่น (technician) → ไม่โหลดข้อมูลแชทเลย", async ({ page }) => {
  await boot(page, { role: "technician" });
  await expect(page.locator("#page-customer_chat")).toContainText("เฉพาะผู้ดูแลระบบและพนักงานขาย");
  expect(await ledger(page)).toEqual([]);
});
