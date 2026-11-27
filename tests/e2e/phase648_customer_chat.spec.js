// Phase 648 — กล่องแชทลูกค้า (เฟส A): ทางเข้าจริงบน Chromium (โมดูลจริง + stub Supabase)
//
// โมดูลจริง modules/customer_chat.js + style.css ถูกโหลดจาก origin. ไม่ต่อ Supabase จริง:
// window.fetch ถูกแทนด้วย stub ในหน้า ที่เลียน PostgREST เท่าที่หน้านี้ใช้ (eq/gt/lte/is.null, or=(),
// order หลายคอลัมน์, limit/offset, Prefer count=exact → Content-Range) · ledger บันทึกทุก request
// · block ทุก request ข้าม origin · ปิด SW.
// stub RPC customer_chat_set_thread_state เลียน semantics ของ SQL (read_seq เดินหน้าอย่างเดียว,
// ไม่เกิน inbound_seq, 'done' ด้วย seq เก่า = ไม่ปิด + reason new_messages, ok เป็น boolean เสมอ).
// ⚠️ ทั้งไฟล์นี้ = MOCK — พฤติกรรม SQL จริงพิสูจน์ด้วยชุด PostgreSQL แยก (tests/phase648_chat_pg_*.sql).

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
      last_message_at: iso(60000), last_message_preview: "ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย" },
    { id: "t2", display_name: "", status: "done", inbound_seq: 1, read_seq: 1,
      last_message_at: iso(86400000 * 2), last_message_preview: "[รูปภาพ]" },
  ];
  window.__messages = {
    t1: [
      { id: "m1", direction: "in", message_type: "text", body: "แอร์ 12000 BTU ราคาเท่าไหร่ครับ", inbound_seq: 1, unsent_at: null, sent_at: iso(120000), created_at: iso(120000) },
      { id: "m2", direction: "in", message_type: "text", body: "ขอรายละเอียดรุ่นอินเวอร์เตอร์ด้วย <script>window.__xss++</script>", inbound_seq: 2, unsent_at: null, sent_at: iso(60000), created_at: iso(60000) },
    ],
    t2: [{ id: "m3", direction: "in", message_type: "image", body: "[รูปภาพ]", inbound_seq: 1, unsent_at: null, sent_at: iso(86400000 * 2), created_at: iso(86400000 * 2) }],
  };
  // จำลอง webhook ingest: ข้อความใหม่เข้าห้อง → inbound_seq+1, status open
  window.__ingest = (threadId, body, sentAt) => {
    const t = window.__threads.find((x) => x.id === threadId);
    t.inbound_seq += 1;
    t.status = "open";
    const at = sentAt || new Date().toISOString();
    if (!t.last_message_at || at >= t.last_message_at) { t.last_message_at = at; t.last_message_preview = body; }
    (window.__messages[threadId] = window.__messages[threadId] || []).push({ id: "n" + threadId + "-" + t.inbound_seq, direction: "in", message_type: "text", body, inbound_seq: t.inbound_seq, unsent_at: null, sent_at: at, created_at: new Date().toISOString() });
  };
  // จำลอง RPC customer_chat_unsend_line: ลบเนื้อหา + preview ของข้อความล่าสุด
  window.__unsend = (threadId, msgId) => {
    const m = window.__messages[threadId].find((x) => x.id === msgId);
    m.body = null; m.unsent_at = new Date().toISOString();
    const latest = window.__messages[threadId].slice().sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))[0];
    window.__threads.find((x) => x.id === threadId).last_message_preview = latest.unsent_at ? "[ลูกค้ายกเลิกข้อความ]" : latest.body;
  };

  // ── mini PostgREST ───────────────────────────────────────────────────────
  const cmp = (row, col, op, val) => {
    const v = row[col];
    if (op === "is") return val === "null" ? v == null : false;
    if (v == null) return false;
    const num = typeof v === "number";
    const x = num ? Number(val) : val;
    switch (op) {
      case "eq": return String(v) === String(val);
      case "gt": return v > x;
      case "lte": return v <= x;
      default: throw new Error("op " + op);
    }
  };
  const parseCond = (s) => { const [col, op, ...rest] = s.split("."); return { col, op, val: rest.join(".") }; };
  function query(rows, params) {
    let out = rows.slice();
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (k === "or") {
        const conds = v.replace(/^\(|\)$/g, "").split(",").map(parseCond);
        out = out.filter((r) => conds.some((c) => cmp(r, c.col, c.op, c.val)));
      } else {
        const [op, ...rest] = v.split(".");
        out = out.filter((r) => cmp(r, k, op, rest.join(".")));
      }
    }
    const order = params.get("order");
    if (order) {
      const keys = order.split(",").map((p) => { const [col, dir] = p.split("."); return { col, desc: dir === "desc" }; });
      out.sort((a, b) => {
        for (const { col, desc } of keys) {
          const av = a[col], bv = b[col];
          if (av == bv) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (desc ? -1 : 1);
        }
        return 0;
      });
    }
    const total = out.length;
    const offset = Number(params.get("offset") || 0);
    const limit = params.has("limit") ? Number(params.get("limit")) : out.length;
    out = out.slice(offset, offset + limit);
    return { rows: out, total, offset };
  }
  const threadRows = () => window.__threads.map((t) => ({ ...t, unread_count: t.inbound_seq - t.read_seq }));
  const messageRows = () => Object.entries(window.__messages).flatMap(([tid, list]) => list.map((m) => ({ ...m, thread_id: tid })));
  function handle(method, url, body, prefer) {
    const u = new URL(url);
    const respond = (status, data, extraHeaders = {}) => ({ status, text: JSON.stringify(data), headers: extraHeaders });
    if (method === "GET" && (u.pathname === "/rest/v1/customer_chat_threads" || u.pathname === "/rest/v1/customer_chat_messages")) {
      const src = u.pathname.endsWith("threads") ? threadRows() : messageRows();
      const { rows, total, offset } = query(src, u.searchParams);
      const headers = {};
      if (/count=exact/.test(prefer || "")) {
        headers["content-range"] = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
      }
      return respond(200, rows, headers);
    }
    if (u.pathname === "/rest/v1/rpc/customer_chat_set_thread_state" && method === "POST") {
      const t = window.__threads.find((x) => x.id === body.p_thread_id);
      const p = body.p_read_through_seq;
      t.read_seq = Math.max(t.read_seq, Math.min(p, t.inbound_seq));
      const stale = body.p_status === "done" && p < t.inbound_seq;
      if (!stale && body.p_status) t.status = body.p_status;
      return respond(200, { ok: !stale, reason: stale ? "new_messages" : null, id: t.id, status: t.status,
        inbound_seq: t.inbound_seq, read_seq: t.read_seq, unread_count: t.inbound_seq - t.read_seq });
    }
    return respond(404, {});
  }
  window.fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(String(url));
    const body = init.body ? JSON.parse(init.body) : null;
    const prefer = init.headers?.Prefer;
    const entry = { m: method, p: u.pathname, q: u.search, body, auth: init.headers?.Authorization };
    window.__ledger.push(entry);
    if (window.__holdNext[u.pathname]) {
      window.__holdNext[u.pathname] = false;
      await new Promise((resolve, reject) => {
        (window.__holds[u.pathname] = window.__holds[u.pathname] || []).push(resolve);
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    // ข้อมูลถูกอ่าน "ตอนตอบ" (หลังปล่อย hold) — เหมือน server ที่ตอบช้า
    const res = entry.snapshot || handle(method, String(url), body, prefer);
    return { status: res.status, ok: res.status >= 200 && res.status < 300,
      headers: { get: (n) => res.headers[String(n).toLowerCase()] ?? null },
      text: async () => res.text, json: async () => JSON.parse(res.text) };
  };
  // ให้ request ของ path นี้ใช้ข้อมูล ณ เวลาที่ "ส่ง" (จำลอง response เก่าที่ค้างอยู่ในทาง)
  window.__snapshotOnSend = {};
  const origFetch = window.fetch;
  window.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (window.__snapshotOnSend[u.pathname]) {
      const method = (init.method || "GET").toUpperCase();
      const snap = handle(method, String(url), init.body ? JSON.parse(init.body) : null, init.headers?.Prefer);
      const p = origFetch(url, init);
      window.__ledger[window.__ledger.length - 1].snapshot = snap;
      return p;
    }
    return origFetch(url, init);
  };
}

async function boot(page, { role = "admin", setup } = {}) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.addInitScript(installFixture);
  await page.goto(FIXTURE_URL);
  if (setup) await page.evaluate(setup);
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
const thread = (page, id) => page.evaluate((x) => { const t = window.__threads.find((r) => r.id === x); return { ...t, unread: t.inbound_seq - t.read_seq }; }, id);
const MSG_PATH = "/rest/v1/customer_chat_messages";
const THREADS_PATH = "/rest/v1/customer_chat_threads";
const RPC_PATH = "/rest/v1/rpc/customer_chat_set_thread_state";

// body มี overflow-x:hidden → scrollWidth ไม่เห็นของที่ล้น; วัดขอบขวาของกล่อง/ปุ่มจริงแทน
const noHorizontalOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const els = document.querySelectorAll(".cc-wrap, .cc-note, .cc-toolbar button, .cc-list, .cc-detail, .cc-thread, #ccStatusBtn, .cc-bubble, .cc-gap");
  return Array.from(els).every((el) => el.getBoundingClientRect().right <= vw + 1);
});

test("C1 mobile 390: list ค้างตอบ → เปิดห้อง → mark read ถึง seq ที่แสดง, escape ข้อมูลลูกค้า, ไม่ล้นจอ", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator(".cc-thread")).toHaveCount(1); // "ค้างตอบ": t1 — t2 done+อ่านแล้ว ไม่อยู่ในผลจาก server
  await expect(page.locator(".cc-badge")).toHaveText("2");
  await expect(page.locator("#ccPendingCount")).toHaveText("(1)");
  expect(await noHorizontalOverflow(page)).toBe(true);
  const listReq = await page.evaluate(() => window.__ledger.find((e) => e.p.endsWith("customer_chat_threads")).q);
  expect(decodeURIComponent(listReq)).toContain("or=(status.eq.open,unread_count.gt.0)"); // กรองฝั่งข้อมูล

  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await expect(page.locator(".cc-bubble").first()).toHaveText("แอร์ 12000 BTU ราคาเท่าไหร่ครับ"); // เก่า → ใหม่
  await expect(page.locator(".cc-badge")).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  expect(await page.locator(".cc-detail-name").innerText()).toContain("<img");
  expect(await rpcBodies(page)).toEqual([{ p_thread_id: "t1", p_read_through_seq: 2, p_status: null }]);
  await page.screenshot({ path: "test-results/phase648-mobile.png", fullPage: true });
});

test("C2 desktop: ทั้งหมด → สองคอลัมน์, เปิดใหม่ใช้ RPC เดียว, ห้องที่อ่านแล้วไม่ยิง mark read ซ้ำ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await page.locator('[data-cc-filter="all"]').click();
  await expect(page.locator(".cc-thread")).toHaveCount(2);
  await expect(page.locator("#ccPendingCount")).toHaveText("(1)");
  await expect(page.locator('[data-thread-id="t2"] .cc-thread-name')).toHaveText("ลูกค้า LINE");
  const listBox = await page.locator("#ccThreadList").boundingBox();
  const detailBox = await page.locator("#ccDetail").boundingBox();
  expect(detailBox.x).toBeGreaterThan(listBox.x + listBox.width - 1);

  await page.locator('[data-thread-id="t2"]').click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("↩️ เปิดใหม่");
  await page.locator("#ccStatusBtn").click();
  await expect(page.locator("#ccStatusBtn")).toHaveText("✅ ทำเครื่องหมายว่าเสร็จ");
  expect(await rpcBodies(page)).toEqual([{ p_thread_id: "t2", p_read_through_seq: 1, p_status: "open" }]);
  await expect(page.locator("#ccPendingCount")).toHaveText("(2)");
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: "test-results/phase648-desktop.png", fullPage: true });
});

test("C3 role อื่น (technician) → ไม่โหลดข้อมูลแชทเลย", async ({ page }) => {
  await boot(page, { role: "technician" });
  await expect(page.locator("#page-customer_chat")).toContainText("เฉพาะผู้ดูแลระบบและพนักงานขาย");
  expect(await ledger(page)).toEqual([]);
});

test("R1 สลับบัญชีขณะห้องเปิดและมี request ค้าง (clear จาก main.js) → ผลเก่าไม่ render, ไม่ยิง RPC, DOM ถูกล้าง", async ({ page }) => {
  await boot(page);
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await holdNext(page, THREADS_PATH);
  await page.locator("#ccRefreshBtn").click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, THREADS_PATH);
  const before = (await ledger(page)).length;
  await page.evaluate(() => {
    window.__mod.clearCustomerChatState();
    window.__state.currentUser = { id: "user-B" };
    window._sbAccessToken = "jwt-B";
  });
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  await release(page, THREADS_PATH);
  await page.waitForTimeout(200);
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  expect((await ledger(page)).length).toBe(before);
  expect(await page.locator("body").innerText()).not.toContain("คุณเอ");
});

test("R2 identity เปลี่ยนตรง ๆ ขณะ request ค้าง → ผลทิ้ง ไม่ mark read; poll ถัดไปล้าง DOM", async ({ page }) => {
  await page.clock.install();
  await boot(page);
  await holdNext(page, THREADS_PATH);
  await page.locator('[data-thread-id="t1"]').click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, THREADS_PATH);
  await page.evaluate(() => { window.__state.currentUser = { id: "user-B" }; window._sbAccessToken = "jwt-B"; });
  await release(page, THREADS_PATH);
  await page.waitForTimeout(100);
  await expect(page.locator(".cc-msg")).toHaveCount(0);
  expect(await rpcBodies(page)).toEqual([]);
  const n = (await ledger(page)).length;
  await page.clock.runFor(31000);
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  expect((await ledger(page)).length).toBe(n);
});

test("R3 ข้อความใหม่เข้าระหว่างโหลดห้องกับกดอ่าน → อ่านถึงแค่ seq ที่แสดง แล้วโหลดห้องใหม่ให้เห็นข้อความใหม่", async ({ page }) => {
  await boot(page);
  await holdNext(page, RPC_PATH);
  await page.locator('[data-thread-id="t1"]').click();
  await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, RPC_PATH);
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await page.evaluate(() => window.__ingest("t1", "ติดตั้งวันเสาร์ได้ไหมครับ"));
  await release(page, RPC_PATH);
  await expect(page.locator(".cc-msg")).toHaveCount(3);
  await expect(page.locator(".cc-bubble").last()).toHaveText("ติดตั้งวันเสาร์ได้ไหมครับ");
  const bodies = await rpcBodies(page);
  expect(bodies[0]).toEqual({ p_thread_id: "t1", p_read_through_seq: 2, p_status: null });
  expect(bodies[1]).toEqual({ p_thread_id: "t1", p_read_through_seq: 3, p_status: null });
  expect(bodies.length).toBe(2);
  expect((await thread(page, "t1")).read_seq).toBe(3);
});

test("R4 ข้อความใหม่เข้าระหว่างเปิดห้องกับกดเสร็จ → ไม่ปิดห้อง คงอยู่ในคิว แจ้งเตือน; กดอีกครั้งหลังเห็นแล้วจึงปิด", async ({ page }) => {
  await boot(page);
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(2);
  await expect.poll(() => rpcBodies(page)).toHaveLength(1);
  await page.evaluate(() => window.__ingest("t1", "ขอเบอร์ช่างด้วยครับ"));
  await page.locator("#ccStatusBtn").click();
  await expect(page.locator(".cc-msg")).toHaveCount(3);
  await expect(page.locator('[data-thread-id="t1"]')).toHaveCount(1);           // ยังอยู่ในคิว
  expect((await thread(page, "t1")).status).toBe("open");
  expect(await page.evaluate(() => window.__toasts.at(-1))).toContain("มีข้อความใหม่เข้ามา");
  expect((await rpcBodies(page))[1]).toEqual({ p_thread_id: "t1", p_read_through_seq: 2, p_status: "done" });

  await page.locator("#ccStatusBtn").click();
  await expect(page.locator('[data-thread-id="t1"]')).toHaveCount(0);
  expect((await thread(page, "t1")).status).toBe("done");
  expect((await rpcBodies(page)).at(-1)).toEqual({ p_thread_id: "t1", p_read_through_seq: 3, p_status: "done" });
});

test("R5 ข้อความที่ถูกยกเลิกก่อนเปิดห้อง แสดงเป็นป้าย ไม่แสดงเนื้อหา", async ({ page }) => {
  await boot(page, { setup: () => window.__unsend("t1", "m2") });
  await expect(page.locator('[data-thread-id="t1"] .cc-thread-preview')).toHaveText("[ลูกค้ายกเลิกข้อความ]");
  await page.locator('[data-thread-id="t1"]').click();
  await expect(page.locator(".cc-unsent .cc-bubble")).toHaveText("ลูกค้ายกเลิกข้อความนี้");
  expect(await page.locator("#ccMessages").innerText()).not.toContain("อินเวอร์เตอร์");
});

for (const via of ["refresh", "poll"]) {
  test(`R6 unsend ขณะเปิดห้องค้างไว้ (${via}) → เนื้อหาและ preview เดิมหาย มีป้าย; response เก่าที่ค้างไม่ทำให้เนื้อหากลับมา`, async ({ page }) => {
    if (via === "poll") await page.clock.install();
    await boot(page);
    await page.locator('[data-thread-id="t1"]').click();
    await expect(page.locator('[data-msg-id="m2"] .cc-bubble')).toContainText("อินเวอร์เตอร์");
    await expect.poll(() => rpcBodies(page)).toHaveLength(1);

    // response เก่า: request ห้องที่ส่งออกไป "ก่อน" unsend แล้วค้างอยู่ (ข้อมูล snapshot ตอนส่ง)
    await page.evaluate((p) => { window.__snapshotOnSend[p] = true; window.__holdNext[p] = true; }, MSG_PATH);
    await page.locator("#ccRefreshBtn").click();
    await page.waitForFunction((p) => (window.__holds[p] || []).length === 1, MSG_PATH);
    await page.evaluate((p) => { window.__snapshotOnSend[p] = false; }, MSG_PATH);

    await page.evaluate(() => window.__unsend("t1", "m2"));  // seq เท่าเดิม (2) แต่ข้อความถูกยกเลิก
    expect((await thread(page, "t1")).inbound_seq).toBe(2);
    if (via === "refresh") await page.locator("#ccRefreshBtn").click();
    else await page.clock.runFor(31000);

    await expect(page.locator('[data-msg-id="m2"] .cc-bubble')).toHaveText("ลูกค้ายกเลิกข้อความนี้");
    await expect(page.locator('[data-thread-id="t1"] .cc-thread-preview')).toHaveText("[ลูกค้ายกเลิกข้อความ]");
    await release(page, MSG_PATH);                            // ปล่อย response เก่า (มีเนื้อหาเดิม)
    await page.waitForTimeout(200);
    await expect(page.locator('[data-msg-id="m2"] .cc-bubble')).toHaveText("ลูกค้ายกเลิกข้อความนี้");
    expect(await page.locator("#page-customer_chat").innerText()).not.toContain("อินเวอร์เตอร์");
  });
}

test("R7 201 ข้อความที่ยังไม่อ่าน → อ่านถึง 200 เท่านั้น, กดเสร็จไม่ได้จนโหลดครบ, โหลดที่เหลือแล้วอ่าน/ปิดได้", async ({ page }) => {
  await boot(page, { setup: () => {
    window.__threads.push({ id: "big", display_name: "ลูกค้าส่งเยอะ", status: "open", inbound_seq: 0, read_seq: 0, last_message_at: null, last_message_preview: null });
    window.__messages.big = [];
    for (let i = 1; i <= 201; i++) window.__ingest("big", "ข้อความที่ " + i, window.__iso(1000000 - i * 1000));
  } });
  await page.locator('[data-thread-id="big"]').click();
  await expect(page.locator(".cc-msg")).toHaveCount(200);
  await expect(page.locator("#ccGap")).toContainText("ยังมีข้อความที่ยังไม่ได้โหลด 1 ข้อความ");
  await expect.poll(() => rpcBodies(page)).toEqual([{ p_thread_id: "big", p_read_through_seq: 200, p_status: null }]);
  expect((await thread(page, "big")).unread).toBe(1);

  await page.locator("#ccStatusBtn").click();                         // ยังเห็นไม่ครบ → ไม่ยิง RPC
  expect(await page.evaluate(() => window.__toasts.at(-1))).toContain("ยังมีข้อความที่ยังไม่ได้โหลด");
  expect((await rpcBodies(page)).length).toBe(1);
  expect((await thread(page, "big")).status).toBe("open");

  await page.locator("#ccLoadRest").click();
  await expect(page.locator(".cc-msg")).toHaveCount(201);
  await expect(page.locator("#ccGap")).toHaveCount(0);
  await expect.poll(async () => (await rpcBodies(page)).at(-1)).toEqual({ p_thread_id: "big", p_read_through_seq: 201, p_status: null });
  await page.locator("#ccStatusBtn").click();
  await expect.poll(async () => (await thread(page, "big")).status).toBe("done");
});

test("R8 ข้อความที่ LINE ส่งมาช้า (seq ใหม่แต่ sent_at เก่ากว่า 200 แถวล่าสุด) ยังโหลดเจอและนับอ่านถูก", async ({ page }) => {
  await boot(page, { setup: () => {
    window.__threads.push({ id: "late", display_name: "ลูกค้าเน็ตช้า", status: "open", inbound_seq: 0, read_seq: 0, last_message_at: null, last_message_preview: null });
    window.__messages.late = [];
    for (let i = 1; i <= 250; i++) window.__ingest("late", "เก่า " + i, window.__iso(500000 - i * 1000));
    window.__threads.find((t) => t.id === "late").read_seq = 250;          // อ่านครบแล้ว
    window.__ingest("late", "ข้อความมาช้า", window.__iso(9000000));         // seq 251, sent_at เก่าที่สุด
  } });
  await page.locator('[data-thread-id="late"]').click();
  await expect(page.locator(".cc-bubble", { hasText: "ข้อความมาช้า" })).toHaveCount(1);
  await expect(page.locator("#ccGap")).toHaveCount(0);
  await expect.poll(() => rpcBodies(page)).toEqual([{ p_thread_id: "late", p_read_through_seq: 251, p_status: null }]);
});

test("R9 คิว: ห้องใหม่ 205 ห้อง (เสร็จแล้ว) + ห้องเก่าค้างตอบ 105 ห้อง → ค้างตอบเจอห้องเก่า, จำนวนตรง, โหลดหน้าถัดไปได้", async ({ page }) => {
  await boot(page, { setup: () => {
    window.__threads.length = 0;
    for (let i = 0; i < 205; i++) window.__threads.push({ id: "new" + i, display_name: "ใหม่ " + i, status: "done", inbound_seq: 1, read_seq: 1, last_message_at: window.__iso(1000 + i * 1000), last_message_preview: "ขอบคุณครับ" });
    for (let i = 0; i < 105; i++) window.__threads.push({ id: "old" + i, display_name: "ค้าง " + i, status: "open", inbound_seq: 1, read_seq: i % 2, last_message_at: window.__iso(90000000 + i * 1000), last_message_preview: "รอคำตอบ" });
  } });
  await expect(page.locator("#ccPendingCount")).toHaveText("(105)");
  await expect(page.locator(".cc-thread")).toHaveCount(100);
  await expect(page.locator('[data-thread-id="old0"]')).toHaveCount(1);
  await expect(page.locator("#ccMoreThreads")).toHaveText("โหลดเพิ่ม (5 ห้อง)");
  await page.locator("#ccMoreThreads").click();
  await expect(page.locator(".cc-thread")).toHaveCount(105);
  await expect(page.locator("#ccMoreThreads")).toHaveCount(0);

  await page.locator('[data-cc-filter="all"]').click();
  await expect(page.locator(".cc-thread")).toHaveCount(100);
  await expect(page.locator("#ccMoreThreads")).toHaveText("โหลดเพิ่ม (210 ห้อง)");
  await expect(page.locator("#ccPendingCount")).toHaveText("(105)");             // จำนวนคิวทั้งหมด ไม่ใช่แค่หน้าแรก
  for (const n of [200, 300, 310]) {
    await page.locator("#ccMoreThreads").click();
    await expect(page.locator(".cc-thread")).toHaveCount(n);
  }
  await expect(page.locator("#ccMoreThreads")).toHaveCount(0);
  await expect(page.locator('[data-thread-id="old104"]')).toHaveCount(1);
});
