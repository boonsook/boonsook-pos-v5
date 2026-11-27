// Phase 648A r3 — สลับบัญชีขณะเปิดห้องแชทและมี request ค้าง ผ่าน "เส้นทาง auth จริงของแอป"
//
// โหลด index.html + main.js จริง. Supabase client (esm.sh/@supabase/supabase-js) ถูกแทนด้วย fake module
// ผ่าน page.route — main.js ใช้ createClient/getSession/onAuthStateChange/signOut ของ fake ตามปกติ
// ทำให้ afterLogin / logout() / onAuthStateChange(SIGNED_OUT|SIGNED_IN) ของแอปทำงานจริง.
// REST ไปที่โฮสต์ Supabase ถูกตอบด้วย page.route (แยกข้อมูลตาม Bearer token = จำลอง RLS ต่อบัญชี) และ
// "ค้าง" request ได้. ทุก request ข้าม origin อื่นถูก abort. ⚠️ MOCK ทั้งหมด — ไม่แตะ Supabase จริง.

import { test, expect } from "@playwright/test";

const SUPA = "https://rwmmjljelpcpwohwiplu.supabase.co";

const FAKE_SUPABASE_MODULE = `
const listeners = new Set();
const USERS = {
  A: { id: "00000000-0000-0000-0000-00000000000a", email: "a@fixture.test", role: "admin", token: "jwt-A" },
  B: { id: "00000000-0000-0000-0000-00000000000b", email: "b@fixture.test", role: "sales", token: "jwt-B" },
  T: { id: "00000000-0000-0000-0000-00000000000c", email: "t@fixture.test", role: "technician", token: "jwt-T" },
};
let current = sessionStorage.getItem("__fakeUser") || "A";
const sessionFor = (k) => k ? { access_token: USERS[k].token, user: { id: USERS[k].id, email: USERS[k].email } } : null;
function emit(event) { const s = sessionFor(current); for (const cb of listeners) cb(event, s); }
window.__fakeAuth = {
  signOut() { current = null; emit("SIGNED_OUT"); },
  signIn(k) { current = k; emit("SIGNED_IN"); },
  current: () => current,
};
function builder(table) {
  let single = false;
  const p = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        const u = current && USERS[current];
        let data = [];
        if (table === "profiles" && u) data = [{ id: u.id, full_name: "ผู้ใช้ " + current, role: u.role }];
        if (single) data = data[0] || null;
        return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
      }
      if (prop === "single" || prop === "maybeSingle") return () => { single = true; return p; };
      return () => p;
    },
  });
  return p;
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: sessionFor(current) }, error: null }),
      getUser: async () => ({ data: { user: sessionFor(current)?.user || null }, error: null }),
      onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe() { listeners.delete(cb); } } } }; },
      signOut: async () => { current = null; emit("SIGNED_OUT"); return { error: null }; },
      signInWithPassword: async () => ({ data: null, error: { message: "fixture" } }),
      refreshSession: async () => ({ data: { session: sessionFor(current) }, error: null }),
    },
    from: (t) => builder(t),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
    channel: () => { const c = { on() { return c; }, subscribe() { return c; }, unsubscribe() {} }; return c; },
    removeChannel() {},
  };
}
export default { createClient };
`;

// ข้อมูลแชทต่อบัญชี (จำลอง RLS: token ไหนเห็นห้องไหน)
const DATA = {
  "jwt-A": {
    threads: [{ id: "ta", display_name: "ลูกค้าของเอ-ลับ", status: "open", unread_count: 1, inbound_seq: 1, read_seq: 0, last_message_at: "2026-11-27T03:00:00Z", last_message_preview: "ความลับของห้องเอ" }],
    messages: [{ id: "ma", direction: "in", message_type: "text", body: "ความลับของห้องเอ", inbound_seq: 1, unsent_at: null, sent_at: "2026-11-27T03:00:00Z", created_at: "2026-11-27T03:00:00Z" }],
  },
  "jwt-B": {
    threads: [{ id: "tb", display_name: "ลูกค้าของบี", status: "open", unread_count: 1, inbound_seq: 1, read_seq: 0, last_message_at: "2026-11-27T04:00:00Z", last_message_preview: "สวัสดีจากบี" }],
    messages: [{ id: "mb", direction: "in", message_type: "text", body: "สวัสดีจากบี", inbound_seq: 1, unsent_at: null, sent_at: "2026-11-27T04:00:00Z", created_at: "2026-11-27T04:00:00Z" }],
  },
};

async function bootApp(page, holds, log) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture"));
    try { localStorage.setItem("bsk_login_destination", "#customer_chat"); } catch (_) { /* ignore */ }
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    if (url.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: FAKE_SUPABASE_MODULE });
    }
    if (url.startsWith(SUPA)) {
      const u = new URL(url);
      const token = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
      const entry = { m: req.method(), p: u.pathname, token, body: req.postData() };
      log.push(entry);
      const isChat = u.pathname.includes("customer_chat");
      if (isChat && holds.next && u.pathname.endsWith(holds.next)) {
        holds.next = null;
        await new Promise((resolve) => { holds.release = resolve; });
      }
      const d = DATA[token];
      let body = [];
      const headers = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };
      if (u.pathname === "/rest/v1/customer_chat_threads") {
        body = d ? d.threads : [];
        headers["content-range"] = body.length ? `0-${body.length - 1}/${body.length}` : "*/0";
      } else if (u.pathname === "/rest/v1/customer_chat_messages") {
        body = d ? d.messages : [];
      } else if (u.pathname === "/rest/v1/rpc/customer_chat_set_thread_state") {
        body = { ok: true, reason: null, id: "x", status: "open", inbound_seq: 1, read_seq: 1, unread_count: 0 };
      }
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...headers, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
    }
    return route.abort();
  });
  await page.goto("/");
  await expect(page.locator("#appShell")).toBeVisible({ timeout: 20000 });
}

const docText = (page) => page.evaluate(() => document.documentElement.textContent);

async function openChatRoom(page, threadId) {
  await page.evaluate(() => { location.hash = "#customer_chat"; });
  await expect(page.locator(`#page-customer_chat [data-thread-id="${threadId}"]`)).toBeVisible({ timeout: 10000 });
}

for (const [path, nextUser] of [["signed-out-event", "B"], ["signed-in-other-user", "B"], ["signed-in-technician", "T"]]) {
  test(`A1 สลับบัญชีผ่าน auth จริงของแอป (${path}) ขณะห้องเปิด + request ค้าง → ข้อมูลบัญชีเก่าไม่กลับมา, ไม่ยิงต่อด้วย token ใหม่`, async ({ page }) => {
    const holds = { next: null, release: null };
    const log = [];
    await bootApp(page, holds, log);
    await openChatRoom(page, "ta");
    await page.locator('#page-customer_chat [data-thread-id="ta"]').click();
    await expect(page.locator("#page-customer_chat .cc-bubble")).toHaveText("ความลับของห้องเอ");

    // ค้าง request โหลดห้อง (รอบรีเฟรช) ไว้ แล้วสลับบัญชีผ่านแอป
    holds.next = "/rest/v1/customer_chat_threads";
    await page.locator("#ccRefreshBtn").click();
    await expect.poll(() => typeof holds.release).toBe("function");
    const before = log.length;

    if (path === "signed-out-event") {
      await page.evaluate(() => window.__fakeAuth.signOut());   // onAuthStateChange(SIGNED_OUT) ของ main.js
      await expect(page.locator("#authScreen")).toBeVisible();
      await expect(page.locator("#page-customer_chat")).toBeEmpty();
    }
    await page.evaluate((k) => window.__fakeAuth.signIn(k), nextUser);
    await expect(page.locator("#appShell")).toBeVisible();

    holds.release();                              // ปล่อย response เก่าของบัญชี A
    await page.waitForTimeout(300);
    // textContent รวม DOM ที่ซ่อนอยู่ (หน้าแชทที่ไม่ได้แสดงก็ต้องไม่เหลือข้อมูลบัญชีเก่า)
    expect(await docText(page)).not.toContain("ความลับของห้องเอ");
    expect(await docText(page)).not.toContain("ลูกค้าของเอ-ลับ");
    const after = log.slice(before);
    expect(after.filter((e) => e.p.includes("customer_chat") && e.token === "jwt-A")).toEqual([]);   // ไม่มีคำขอใหม่ในนาม A
    expect(after.filter((e) => e.p.endsWith("customer_chat_set_thread_state"))).toEqual([]);          // ไม่ mark read ห้อง A

    if (nextUser === "T") {                       // ช่างไม่มีสิทธิ์หน้าแชท: แอปไม่ render หน้าแชทซ้ำ → ต้องถูกล้างโดย afterLogin
      await expect(page.locator("#page-customer_chat")).toBeEmpty();
      return;
    }
    // บัญชี B เปิดหน้าแชท → เห็นเฉพาะข้อมูลของ B
    await page.evaluate(() => { location.hash = "#dashboard"; });
    await page.evaluate(() => { location.hash = "#customer_chat"; });
    await expect(page.locator('#page-customer_chat [data-thread-id="tb"]')).toBeVisible();
    await expect(page.locator('#page-customer_chat [data-thread-id="ta"]')).toHaveCount(0);
  });
}

test("A2 logout() จริงของแอป (ปุ่มเมนูโปรไฟล์) ล้างหน้าแชทและ request ค้างถูกทิ้ง", async ({ page }) => {
  const holds = { next: null, release: null };
  const log = [];
  await bootApp(page, holds, log);
  await openChatRoom(page, "ta");
  await page.locator('#page-customer_chat [data-thread-id="ta"]').click();
  await expect(page.locator("#page-customer_chat .cc-bubble")).toHaveText("ความลับของห้องเอ");
  holds.next = "/rest/v1/customer_chat_threads";
  await page.locator("#ccRefreshBtn").click();
  await expect.poll(() => typeof holds.release).toBe("function");

  // เส้นทางปุ่มจริง: เมนูโปรไฟล์ → ออกจากระบบ → App.confirm (ตอบตกลง) → logout() ของ main.js
  await page.evaluate(() => { window.App.confirm = async () => true; });
  await page.locator("#profileChip").click();
  await page.locator('#profileMenu [data-act="logout"]').click();
  await expect.poll(() => page.evaluate(() => window.__fakeAuth.current())).toBe(null); // auth.signOut ถูกเรียกจริง
  await expect(page.locator("#authScreen")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  holds.release();
  await page.waitForTimeout(300);
  await expect(page.locator("#page-customer_chat")).toBeEmpty();
  expect(await docText(page)).not.toContain("ความลับของห้องเอ");
});
