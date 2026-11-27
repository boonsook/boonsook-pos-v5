// Phase 648 — กล่องแชทลูกค้า (เฟส A): ทางเข้าจริงบน Chromium
//
// โมดูลจริง modules/customer_chat.js + style.css ถูกโหลดจาก origin. ไม่ต่อ Supabase จริง:
// window.fetch ถูกแทนด้วย stub ในหน้า (ledger บันทึกทุก request) · block ทุก request ข้าม origin · ปิด SW.
// stub RPC customer_chat_set_thread_state เลียน semantics ของ SQL (read_seq เดินหน้าอย่างเดียว,
// ไม่เกิน inbound_seq, 'done' ด้วย seq เก่า = ไม่ปิด + reason new_messages) — พฤติกรรม SQL จริง
// ต้องพิสูจน์บน PostgreSQL แยกต่างหาก (test นี้พิสูจน์ฝั่ง client เท่านั้น).

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
  window.__holds = {};      // path → [resolve] : request ที่ถูก "ค้าง" ไว้
  window.__holdNext = {};   // path → true : ค้าง request ถัดไปของ path นี้
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-A";
  window.__state = { currentUser: { id: "user-A" }, role: "admin" };
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  window.__iso = iso;
  window.__threads = [
    { id: "t1", display_name: "คุณเอ <img src=x onerror=\"window.__xss++\">", status: "open", inbound_seq: 2, read_seq: 0,
      last_message_at: iso(60000), last_message_preview: "แอร์ 12000 BTU ราคาเท่าไหร่ครับ ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย" },
    { id: "t2", display_name: "", status: "done", inbound_seq: 1, read_seq: 1,
      last_message_at: iso(86400000 * 2), last_message_preview: "[รูปภาพ]" },
  ];
  window.__messages = {
    t1: [
      { id: "m2", direction: "in", message_type: "text", body: "ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย <script>window.__xss++</script>", inbound_seq: 2, unsent_at: null, sent_at: iso(60000) },
      { id: "m1", direction: "in", message_type: "text", body: "แอร์ 12000 BTU ราคาเท่าไหร่ครับ", inbound_seq: 1, unsent_at: null, sent_at: iso(120000) },
    ],
    t2: [{ id: "m3", direction: "in", message_type: "image", body: "[รูปภาพ]", inbound_seq: 1, unsent_at: null, sent_at: iso(86400000 * 2) }],
  };
  const withUnread = (t) => ({ ...t, unread_count: t.inbound_seq - t.read_seq });
  // จำลอง webhook ingest: ข้อความใหม่เข้าห้อง → inbound_seq+1, status open
  window.__ingest = (threadId, body) => {
    const t = window.__threads.find((x) => x.id === threadId);
    t.inbound_seq += 1;
    t.status = "open";
    t.last_message_at = new Date().toISOString();
    t.last_message_preview = body;
    window.__messages[threadId].unshift({ id: "n" + t.inbound_seq, direction: "in", message_type: "text", body, inbound_seq: t.inbound_seq, unsent_at: null, sent_at: t.last_message_at });
  };
  const json = (status, body) => ({ status, text: JSON.stringify(body) });
  function handle(method, url, body) {
    const u = new URL(url);
    if (u.pathname === "/rest/v1/customer_chat_threads" && method === "GET") return json(200, window.__threads.map(withUnread));
    if (u.pathname === "/rest/v1/customer_chat_messages" && method === "GET") {
      const id = decodeURIComponent(u.searchParams.get("thread_id").replace(/^eq\./, ""));
      return json(200, (window.__messages[id] || []).map((m) => ({ ...m })));
    }
    if (u.pathname === "/rest/v1/rpc/customer_chat_set_thread_state" && method === "POST") {
      const t = window.__threads.find((x) => x.id === body.p_thread_id);
      const p = body.p_read_through_seq;
      t.read_seq = Math.max(t.read_seq, Math.min(p, t.inbound_seq));
      const stale = body.p_status === "done" && p < t.inbound_seq;
      if (!stale && body.p_status) t.status = body.p_status;
      return json(200, { ok: !stale, reason: stale ? "new_messages" : null, id: t.id, status: t.status,
        inbound_seq: t.inbound_seq, read_seq: t.read_seq, unread_count: t.inbound_seq - t.read_seq });
    }
    return json(404, {});
  }
  window.fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    window.__ledger.push({ m: method, p: path, body, auth: init.headers?.Authorization });
    if (window.__holdNext[path]) {
      window.__holdNext[path] = false;
      await new Promise((resolve, reject) => {
        (window.__holds[path] = window.__holds[path] || []).push(resolve);
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    const res = handle(method, String(url), body);
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
    window.__state.role = r;
    window.__mod = await import("/modules/customer_chat.js");
    window.__ctx = {
      state: window.__state,
      requireAdminOrSales: () => ["admin", "sales"].includes(window.__state.role),
      showToast: (m) => window.__toasts.push(String(m)),
    };
    await window.__mod.renderCustomerChatPage(window.__ctx);
  }, role);
}

const ledger = (page) => page.evaluate(() => window.__ledger.map((e) => `${e.m} ${e.p}`));
const rpcBodies = (page) => page.evaluate(() => window.__ledger.filter((e) => e.p.endsWith("customer_chat_set_thread_state")).map((e) => e.body));
const holdNext = (page, p) => page.evaluate((x) => { window.__holdNext[x] = true; }, p);
const release = (page, p) => page.evaluate((x) => { (window.__holds[x] || []).splice(0).forEach((r) => r()); }, p);
const MSG_PATH = "/rest/v1/customer_chat_messages";
const RPC_PATH = "/rest/v1/rpc/customer_chat_set_thread_state";

// body มี overflow-x:hidden → scrollWidth ไม่เห็นของที่ล้น; วัดขอบขวาของกล่อง/ปุ่มจริงแทน
const noHorizontalOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const els = document.querySelectorAll(".cc-wrap, .cc-note, .cc-toolbar button, .cc-list, .cc-detail, .cc-thread, #ccStatusBtn, .cc-bubble");
  return Array.from(els).every((el) => el.getBoundingClientRect().right <= vw + 1);
});

test("C1 mobile 390: list ค้างตอบ → เปิดห้อง → mark read ถึง seq ที่แสดง, escape ข้อมูลลูกค้า, ไม่ล้นจอ", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator(".cc-thread")).toHaveCount(1); // "ค้างตอบ": t1 — t2 done+อ่านแล้ว ถูกกรอง
  await expect(page.locator(".cc-badge")).toHaveText("2");
  await expect(page.locator("#ccPendingCount")).toHaveText("(1)");
  expect(await noHorizontalOverflow(page)).toBe(true);

  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await expect(page.locator(".cc-bubble").first()).toHaveText("แอร์ 12000 BTU ราคาเท่าไหร่ครับ"); // เก่า → ใหม่
  await expect(page.locator(".cc-badge")).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  expect(await page.locator(".cc-detail-name").innerText()).toContain("<img");

  expect(await ledger(page)).toEqual([`GET /rest/v1/customer_chat_threads`, `GET ${MSG_PATH}`, `POST ${RPC_PATH}`]);
  expect(await rpcBodies(page)).toEqual([{ p_thread_id: "t1", p_read_through_seq: 2, p_status: null }]);
  await page.screenshot({ path: "test-results/phase648-mobile.png", fullPage: true });
});

test("C2 desktop: ทั้งหมด → สองคอลัมน์, เปิดใหม่ใช้ RPC เดียว, ห้องที่อ่านแล้วไม่ยิง mark read ซ้ำ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await page.locator('[data-cc-filter="all"]').click();
  await expect(page.locator(".cc-thread")).toHaveCount(2);
  await expect(page.locator('[data-thread-id="t2"] .cc-thread-name')).toHaveText("ลูกค้า LINE");
  const listBox = await page.locator("#ccThreadList").boundingBox();
  const detailBox = await page.locator("#ccDetail").boundingBox();
  expect(detailBox.x).toBeGreaterThan(listBox.x + listBox.width - 1);

  await page.locator('[data-thread-id="t2"]').click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("↩️ เปิดใหม่");
  await page.locator("#ccStatusBtn").click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("✅ ทำเครื่องหมายว่าเสร็จ");
  expect(await rpcBodies(page)).toEqual([{ p_thread_id: "t2", p_read_through_seq: 1, p_status: "open" }]);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: "test-results/phase648-desktop.png", fullPage: true });
});

test("C3 role อื่น (technician) → ไม่โหลดข้อมูลแชทเลย", async ({ page }) => {
  await boot(page, { role: "technician" });
  await expect(page.locator("#page-customer_chat")).toContainText("เฉพาะผู้ดูแลระบบและพนักงานขาย");
  expect(await ledger(page)).toEqual([]);
});

test("R1 สลับบัญชีขณะห้องเปิดและมี request ค้าง (logout → clear) → ผลเก่าไม่ render, ไม่ยิง RPC, DOM ถูกล้าง", async ({ page }) => {
  await boot(page);
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  // เปิดห้อง t1 ใหม่อีกรอบด้วยการกดรีเฟรชห้อง: ค้าง GET messages ไว้
  await page.locator('[data-cc-filter="all"]').click();
  await holdNext(page, MSG_PATH);
  await page.locator('[data-thread-id="t2"]').click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, MSG_PATH);
  const before = (await ledger(page)).length;

  // สลับบัญชี: main.js logout/afterLogin เรียก clearCustomerChatState() แล้ว state เปลี่ยนเป็นบัญชี B
  await page.evaluate(() => {
    window.__mod.clearCustomerChatState();
    window.__state.currentUser = { id: "user-B" };
    window._sbAccessToken = "jwt-B";
  });
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  await release(page, MSG_PATH); // request ค้างถูก abort แล้ว — ปล่อยไว้กันค้าง
  await page.waitForTimeout(200);
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  expect((await ledger(page)).length).toBe(before); // ไม่มี RPC/GET ใหม่จากบัญชีเก่า
  expect(await page.locator("body").innerText()).not.toContain("คุณเอ");
});

test("R2 สลับบัญชีโดยไม่ผ่าน clear (identity เปลี่ยนตรง ๆ) ขณะ request ค้าง → ผลทิ้ง ไม่ mark read; poll ถัดไปล้าง DOM", async ({ page }) => {
  await page.clock.install();
  await boot(page);
  await holdNext(page, MSG_PATH);
  await page.locator('[data-thread-id="t1"]').click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, MSG_PATH);
  await page.evaluate(() => { window.__state.currentUser = { id: "user-B" }; window._sbAccessToken = "jwt-B"; });
  await release(page, MSG_PATH);
  await page.waitForTimeout(100);
  await expect(page.locator(".cc-msg")).toHaveCount(0);           // ข้อความของห้องไม่ถูก render
  expect(await rpcBodies(page)).toEqual([]);                        // ไม่ mark read ในนามบัญชี B
  const n = (await ledger(page)).length;
  await page.clock.runFor(31000);                                   // poll tick เจอ identity เปลี่ยน → ล้าง
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  expect((await ledger(page)).length).toBe(n);                      // poll ไม่ยิง request ด้วย token ใหม่
});

test("R3 ข้อความใหม่เข้าระหว่างโหลดห้องกับกดอ่าน → อ่านถึงแค่ seq ที่แสดง แล้วโหลดห้องใหม่ให้เห็นข้อความใหม่", async ({ page }) => {
  await boot(page);
  await holdNext(page, RPC_PATH);
  await page.locator('[data-thread-id="t1"]').click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, RPC_PATH);
  await expect(page.locator(".cc-msg")).toHaveCount(2);             // จอแสดง seq 1–2
  await page.evaluate(() => window.__ingest("t1", "ติดตั้งวันเสาร์ได้ไหมครับ"));  // seq 3 เข้ามาตอนนี้
  await release(page, RPC_PATH);
  await expect(page.locator(".cc-msg")).toHaveCount(3);             // โหลดใหม่ → เห็นข้อความใหม่
  await expect(page.locator(".cc-bubble").last()).toHaveText("ติดตั้งวันเสาร์ได้ไหมครับ");
  const bodies = await rpcBodies(page);
  expect(bodies[0]).toEqual({ p_thread_id: "t1", p_read_through_seq: 2, p_status: null }); // ไม่ใช่ "อ่านหมด"
  expect(bodies[1]).toEqual({ p_thread_id: "t1", p_read_through_seq: 3, p_status: null });
  expect(bodies.length).toBe(2);
  expect(await page.evaluate(() => window.__threads.find((t) => t.id === "t1").read_seq)).toBe(3);
});

test("R4 ข้อความใหม่เข้าระหว่างเปิดห้องกับกดเสร็จ → ไม่ปิดห้อง, แจ้งเตือน, แสดงข้อความใหม่; กดอีกครั้งหลังเห็นแล้วจึงปิด", async ({ page }) => {
  await boot(page);
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await expect.poll(() => rpcBodies(page)).toHaveLength(1);         // mark read ถึง 2 แล้ว
  await page.evaluate(() => window.__ingest("t1", "ขอเบอร์ช่างด้วยครับ"));  // seq 3 (client ยังไม่รู้)
  await page.locator("#ccStatusBtn").click();
  await expect(page.locator(".cc-msg")).toHaveCount(3);
  await expect(page.locator("#ccStatusBtn")).toHaveText("✅ ทำเครื่องหมายว่าเสร็จ");
  expect(await page.evaluate(() => window.__threads.find((t) => t.id === "t1").status)).toBe("open");
  expect(await page.evaluate(() => window.__toasts.at(-1))).toContain("มีข้อความใหม่เข้ามา");
  const b = await rpcBodies(page);
  expect(b[1]).toEqual({ p_thread_id: "t1", p_read_through_seq: 2, p_status: "done" });

  await page.locator("#ccStatusBtn").click();                         // ตอนนี้เห็นถึง seq 3 แล้ว
  await expect(page.locator('[data-thread-id="t1"]')).toHaveCount(0); // ออกจาก "ค้างตอบ"
  expect(await page.evaluate(() => window.__threads.find((t) => t.id === "t1").status)).toBe("done");
  expect((await rpcBodies(page)).at(-1)).toEqual({ p_thread_id: "t1", p_read_through_seq: 3, p_status: "done" });
});

test("R5 ข้อความที่ลูกค้ายกเลิก (unsend) แสดงเป็นป้าย ไม่แสดงเนื้อหา", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = window.__messages.t1.find((x) => x.id === "m2");
    m.body = null; m.unsent_at = new Date().toISOString();
  });
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-unsent")).toHaveCount(1);
  await expect(page.locator(".cc-unsent .cc-bubble")).toHaveText("ลูกค้ายกเลิกข้อความนี้");
  expect(await page.locator("#ccMessages").innerText()).not.toContain("อินเวอร์เตอร์");
});
