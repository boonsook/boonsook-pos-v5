// Phase 642 — add-user-role-verified: ทางเข้าจริงบน Chromium
//
// โมดูลจริง (modules/settings/user_provisioning.js + modules/api.js xhrPatch + modules/settings/users.js)
// ถูก import จาก origin. ไม่มีการต่อ Supabase จริง: window.XMLHttpRequest / window.fetch ถูกแทนด้วย
// stub server ในหน้า (ledger บันทึกทุก request) · block ทุก request ข้าม origin · ปิด service worker.

import { test, expect } from "@playwright/test";

const FIXTURE_URL = "/__phase642__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 642 fixture</title></head>'
  + '<body><div id="usersPage"></div></body></html>';
const UID = "11111111-2222-3333-4444-555555555555";

function installFixture() {
  // ฟังก์ชันนี้ถูก serialize ไปรันในหน้า — ค่าคงที่ต้องประกาศข้างในเอง
  const UID = "11111111-2222-3333-4444-555555555555";
  navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error("SW disabled in fixture")));
  window.__ledger = [];
  window.__toasts = [];
  window.__isAdmin = true;
  window.__plan = { signup: "ok", readFailOnce: false, ignorePatch: false, ignorePatchOnce: false, loadFail: false, revokeAdminAfterReads: 0, existing: null };
  window.__db = new Map();
  window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "anon-fixture" };
  window._sbAccessToken = "jwt-fixture";
  let reads = 0;

  const json = (status, body) => ({ status, text: JSON.stringify(body) });
  function handle(method, url, body) {
    const u = new URL(url);
    window.__ledger.push({ m: method, p: u.pathname, q: u.search, body });
    const plan = window.__plan;
    if (u.pathname === "/auth/v1/signup") {
      if (plan.signup === "timeout") return { timeout: true };
      if (plan.signup === "exists") return json(422, { code: "user_already_exists", msg: "User already registered" });
      window.__db.set(UID, { id: UID, role: "sales", full_name: body.data.full_name });
      return json(200, { user: { id: UID, identities: [{ id: "i1" }] } });
    }
    if (u.pathname === "/auth/v1/recover") return json(200, {});
    if (u.pathname === "/rest/v1/profiles" && method === "GET") {
      reads += 1;
      if (plan.revokeAdminAfterReads && reads >= plan.revokeAdminAfterReads) window.__isAdmin = false;
      const id = decodeURIComponent(u.searchParams.get("id").replace(/^eq\./, ""));
      if (plan.readFailOnce && reads === 2) { plan.readFailOnce = false; return json(500, { message: "boom" }); }
      return json(200, window.__db.has(id) ? [window.__db.get(id)] : []);
    }
    if (u.pathname === "/rest/v1/profiles" && method === "PATCH") {
      const id = decodeURIComponent(u.searchParams.get("id").replace(/^eq\./, ""));
      const row = window.__db.get(id);
      if (!row) return json(200, []);
      if (plan.ignorePatchOnce) plan.ignorePatchOnce = false;
      else if (!plan.ignorePatch) window.__db.set(id, { ...row, ...body });
      return json(200, [window.__db.get(id)]);
    }
    if (u.pathname === "/rest/v1/profiles_with_email") {
      return json(200, plan.existing ? [plan.existing] : []);
    }
    return json(404, {});
  }
  class StubXHR {
    open(method, url) { this.method = method; this.url = url; this.status = 0; this.responseText = ""; }
    setRequestHeader() {}
    send(raw) {
      const res = handle(this.method, this.url, raw ? JSON.parse(raw) : null);
      setTimeout(() => {
        if (res.timeout) { this.ontimeout && this.ontimeout(); return; }
        this.status = res.status; this.responseText = res.text; this.onload && this.onload();
      }, 5);
    }
  }
  window.XMLHttpRequest = StubXHR;
  window.fetch = async (url, init = {}) => {
    const res = handle((init.method || "GET").toUpperCase(), String(url), init.body ? JSON.parse(init.body) : null);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, text: async () => res.text, json: async () => JSON.parse(res.text) };
  };
}

async function boot(page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return route.continue();
    return route.abort();
  });
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.addInitScript(installFixture);
  await page.goto(FIXTURE_URL);
  await page.evaluate(async () => {
    const prov = await import("/modules/settings/user_provisioning.js");
    const api = await import("/modules/api.js");
    const users = await import("/modules/settings/users.js");
    const { xhrPatch } = api.createApi({ windowRef: window });
    const LABELS = { admin: "ผู้ดูแลระบบ", technician: "ช่าง", accountant: "สำนักงานบัญชี", sales: "พนักงานขาย", customer: "ลูกค้า" };
    const provisioning = prov.createUserProvisioning(prov.createUserProvisioningAdapters({ windowRef: window, xhrPatch, isAdmin: () => window.__isAdmin === true }));
    window.__ctl = prov.createUserAdminController({
      provisioning, roleLabels: LABELS,
      ui: {
        toast: (m) => window.__toasts.push(String(m)),
        confirm: async () => true,
        loadUsers: async () => ({ ok: !window.__plan.loadFail }),
        rerender: () => {},
        modal: (view, handlers) => prov.showProvisioningModal(document, view, handlers),
        resetAddForm: () => {},
      },
    });
    window.__renderUsers = (profiles) => users.renderSettingsUsers(document.getElementById("usersPage"), {
      state: { allProfiles: profiles, currentUser: { id: "me" } }, ROLE_LABELS: LABELS,
      changeRole: (id, r) => window.__ctl.changeRole(id, r), sendPasswordLinkFor: (e) => window.__ctl.sendLink(e),
      openAddUserDrawer() {}, showToast: (m) => window.__toasts.push(String(m)),
    }, () => {}, () => {});
  });
}

const setPlan = (page, p) => page.evaluate((x) => Object.assign(window.__plan, x), p);
const ledger = (page) => page.evaluate(() => window.__ledger.map(e => `${e.m} ${e.p}`));
const add = (page) => page.evaluate(() => window.__ctl.addUser({ email: "new@shop.test", fullName: "สมชาย ใจดี", role: "technician" }));
const modalText = (page) => page.locator("#bskProvisionModal").innerText();

test("E1 add staff: signup once → read → PATCH → read-back → invite → success toast", async ({ page }) => {
  await boot(page);
  const r = await add(page);
  expect(r.ok).toBe(true);
  expect(await ledger(page)).toEqual(["POST /auth/v1/signup", "GET /rest/v1/profiles", "PATCH /rest/v1/profiles", "GET /rest/v1/profiles", "POST /auth/v1/recover"]);
  const signup = await page.evaluate(() => window.__ledger[0].body);
  expect(Object.keys(signup).sort()).toEqual(["data", "email", "password"]);
  expect(await page.evaluate(() => window.__toasts.at(-1))).toContain("ส่งคำเชิญไปที่ new@shop.test");
  await expect(page.locator("#bskProvisionModal")).toHaveCount(0);
});

test("E2 PATCH ok + read-back failure → unknown shown, no invite; retry → verified, still one signup", async ({ page }) => {
  await boot(page);
  await setPlan(page, { readFailOnce: true });
  const r = await add(page);
  expect(r.ok).toBe(false);
  const text = await modalText(page);
  expect(text).toContain("สิทธิ์ที่อ่านได้ตอนนี้: ไม่ทราบ (ตรวจสอบไม่ได้)");
  expect(text).not.toContain("ช่าง");
  expect(await ledger(page)).not.toContain("POST /auth/v1/recover");
  await page.locator('[data-provision-action="retry"]').click();
  await page.waitForFunction(() => window.__ledger.some(e => e.p === "/auth/v1/recover"));
  const l = await ledger(page);
  expect(l.filter(x => x === "POST /auth/v1/signup")).toHaveLength(1);
  expect(l.filter(x => x === "PATCH /rest/v1/profiles")).toHaveLength(2);
  // retry ใช้ userId/email เดิมของบัญชีใหม่
  const after = await page.evaluate(() => window.__ledger.filter(e => e.p === "/auth/v1/recover" || e.m === "PATCH").map(e => ({ p: e.p, q: e.q, body: e.body })));
  expect(after.filter(e => e.p === "/auth/v1/recover").map(e => e.body)).toEqual([{ email: "new@shop.test" }]);
  expect(after.filter(e => e.p === "/rest/v1/profiles").every(e => e.q.includes("11111111-2222-3333-4444-555555555555"))).toBe(true);
});

test("E3 signup timeout → 'ไม่ทราบว่าสร้างบัญชีแล้วหรือไม่', no further requests", async ({ page }) => {
  await boot(page);
  await setPlan(page, { signup: "timeout" });
  const r = await add(page);
  expect(r.account).toBe("unknown");
  expect(await modalText(page)).toContain("ไม่ทราบว่าสร้างบัญชีแล้วหรือไม่");
  expect(await ledger(page)).toEqual(["POST /auth/v1/signup"]);
});

test("E4 already registered → role from this run's lookup; assign after confirm → PATCH, no second signup", async ({ page }) => {
  await boot(page);
  await page.evaluate((uid) => { window.__db.set(uid, { id: uid, role: "customer", full_name: "เดิม" }); }, UID);
  await setPlan(page, { signup: "exists", existing: { id: UID, email: "new@shop.test", role: "customer", full_name: "เดิม" } });
  await add(page);
  const text = await modalText(page);
  expect(text).toContain("สิทธิ์ที่อ่านได้ตอนนี้: ลูกค้า");
  expect(text).toContain("บัญชีนี้เป็นลูกค้า — การตั้งสิทธิ์จะเปลี่ยนเป็นพนักงาน");
  await page.locator('[data-provision-action="assign"]').click();
  await page.waitForFunction(() => window.__toasts.some(t => t.startsWith("ตั้งสิทธิ์เป็น")));
  const l = await ledger(page);
  expect(l.filter(x => x === "POST /auth/v1/signup")).toHaveLength(1);
  expect(l).toContain("PATCH /rest/v1/profiles");
  expect(await page.evaluate((uid) => window.__db.get(uid).role, UID)).toBe("technician");
});

test("E5 admin revoked before the link → no recover request", async ({ page }) => {
  await boot(page);
  await setPlan(page, { revokeAdminAfterReads: 2 });
  const r = await add(page);
  expect(r.invite).toBe("not_sent");
  expect(await ledger(page)).not.toContain("POST /auth/v1/recover");
  expect(await modalText(page)).toContain("ยังไม่ได้ส่งลิงก์ เพราะสิทธิ์ Admin ของคุณเปลี่ยนไป");
});

test("E6 users list: unknown role shows 'ไม่ทราบ', never Admin; customers stay filtered out", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__renderUsers([
    { id: "u1", full_name: "แปลก", email: "a@shop.test", role: "weird<b>" },
    { id: "u2", full_name: "ขาย", email: "b@shop.test", role: "sales" },
    { id: "u3", full_name: "ลูกค้า", email: "c@shop.test", role: "customer" },
  ]));
  const first = page.locator('select[data-role-user-id="u1"]');
  await expect(first.locator("option:checked")).toHaveText("ไม่ทราบ (weird<b>)");
  await expect(page.locator('select[data-role-user-id="u2"] option:checked')).toHaveText("พนักงานขาย");
  await expect(page.locator('select[data-role-user-id="u3"]')).toHaveCount(0);
  await expect(page.locator('[data-link-user-email="a@shop.test"]')).toHaveCount(1);
});

test("E7 changeRole not applied (read-back differs) → select shows the role read back, not the requested one", async ({ page }) => {
  await boot(page);
  await page.evaluate((uid) => { window.__db.set(uid, { id: uid, role: "sales", full_name: "ขาย" }); }, UID);
  await setPlan(page, { ignorePatch: true });
  await page.evaluate((uid) => window.__renderUsers([{ id: uid, full_name: "ขาย", email: "b@shop.test", role: "sales" }]), UID);
  const sel = page.locator(`select[data-role-user-id="${UID}"]`);
  await sel.selectOption("admin");
  await page.waitForFunction(() => window.__toasts.some(t => t.startsWith("เปลี่ยนสิทธิ์ไม่สำเร็จ")));
  await expect(sel).toHaveValue("sales");
  await expect(sel.locator("option:checked")).toHaveText("พนักงานขาย");
});

test("E8 PATCH ok → read-back fails → list reload fails → row shows 'ไม่ทราบ (ตรวจสอบไม่ได้)', not the old role", async ({ page }) => {
  await boot(page);
  await page.evaluate((uid) => { window.__db.set(uid, { id: uid, role: "sales", full_name: "ขาย" }); }, UID);
  await setPlan(page, { readFailOnce: true, loadFail: true });
  await page.evaluate((uid) => window.__renderUsers([{ id: uid, full_name: "ขาย", email: "b@shop.test", role: "sales" }]), UID);
  const sel = page.locator(`select[data-role-user-id="${UID}"]`);
  await sel.selectOption("admin");
  await page.waitForFunction(() => window.__toasts.some(t => t.startsWith("เปลี่ยนสิทธิ์ไม่สำเร็จ")));
  expect(await page.evaluate(() => window.__toasts)).toContain("โหลดรายการผู้ใช้ใหม่ไม่สำเร็จ — รายการที่เห็นอาจไม่เป็นปัจจุบัน");
  await expect(sel.locator("option:checked")).toHaveText("ไม่ทราบ (ตรวจสอบไม่ได้)");
  await expect(sel).not.toHaveValue("sales");
  await expect(page.locator(".usr-card .usr-role")).toHaveText("ไม่ทราบ (ตรวจสอบไม่ได้)");
});

test("E9 existing account → assign fails → retry succeeds: one signup only, no recover", async ({ page }) => {
  await boot(page);
  const OLD = "99999999-0000-0000-0000-000000000001";
  await page.evaluate((id) => { window.__db.set(id, { id, role: "customer", full_name: "เดิม" }); }, OLD);
  await setPlan(page, { signup: "exists", ignorePatchOnce: true, existing: { id: OLD, email: "old@shop.test", role: "customer", full_name: "เดิม" } });
  await page.evaluate(() => window.__ctl.addUser({ email: "old@shop.test", fullName: "ชื่อใหม่", role: "technician" }));
  await page.locator('[data-provision-action="assign"]').click();
  await expect(page.locator("#bskProvisionModal")).toContainText("สิทธิ์ที่อ่านได้ตอนนี้: ลูกค้า");
  await page.locator('[data-provision-action="retry"]').click();
  await page.waitForFunction(() => window.__toasts.some(t => t.startsWith("ตั้งสิทธิ์เป็น")));
  const l = await ledger(page);
  expect(l.filter(x => x === "POST /auth/v1/signup")).toHaveLength(1);
  expect(l).not.toContain("POST /auth/v1/recover");
  expect(l.filter(x => x === "PATCH /rest/v1/profiles")).toHaveLength(2);
  expect(await page.evaluate((id) => window.__db.get(id), OLD)).toEqual({ id: OLD, role: "technician", full_name: "เดิม" });
});

test("E10 send link with empty or malformed email → zero requests", async ({ page }) => {
  await boot(page);
  for (const bad of ["", "   ", "not-an-email", null]) {
    const r = await page.evaluate((e) => window.__ctl.sendLink(e), bad);
    expect(r.ok).toBe(false);
  }
  expect(await ledger(page)).toEqual([]);
  expect(await page.evaluate(() => window.__toasts.filter(t => t === "อีเมลไม่ถูกต้อง — ไม่ได้ส่งลิงก์").length)).toBe(4);
});
