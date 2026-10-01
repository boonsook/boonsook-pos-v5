// Phase 642 — add-user-role-verified
// Run: node --test tests/phase642_user_provisioning.test.js
//
// Behavioural tests drive createUserProvisioning / createUserAdminController / the real adapters with
// fakes that record every call. Structural tests (labelled [structural]) only check the wiring in
// main.js / users.js and are never counted as production-safety evidence.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAFF_ROLES, buildSignupBody, classifySignupResponse, classifyProfileRows, classifyEmailRows,
  createUserProvisioningAdapters, createUserProvisioning, describeProvisioningResult, roleStateText,
  renderRoleSelectOptions, roleSelectValue, createUserAdminController, applyRoleResultToSelect,
} from "../modules/settings/user_provisioning.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const UID = "11111111-2222-3333-4444-555555555555";
const LABELS = { admin: "ผู้ดูแลระบบ", technician: "ช่าง", accountant: "สำนักงานบัญชี", sales: "พนักงานขาย", customer: "ลูกค้า" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── fake dependency set: an in-memory profiles table + scripted overrides ──
function fakeDeps(opts = {}) {
  const calls = [];
  const db = new Map(Object.entries(opts.db || {}));        // userId -> row
  let adminChecks = 0;
  const seq = (name, def) => {
    const list = opts[name];
    return (...args) => {
      if (Array.isArray(list) && list.length) return typeof list[0] === "function" ? list.shift()(...args) : list.shift();
      return def(...args);
    };
  };
  const deps = {
    signUp: async (a) => {
      calls.push(["signUp", a]);
      if (opts.signUp) return typeof opts.signUp === "function" ? opts.signUp(a) : opts.signUp;
      db.set(UID, { id: UID, role: opts.defaultRole || "sales", full_name: a.fullName });
      return { kind: "created", userId: UID };
    },
    getProfile: async (id) => {
      calls.push(["getProfile", id]);
      return seq("getProfileSeq", (uid) => (db.has(uid) ? { ok: true, found: true, row: { ...db.get(uid) } } : { ok: true, found: false }))(id);
    },
    patchProfile: async (id, payload) => {
      calls.push(["patchProfile", id, payload]);
      return seq("patchSeq", (uid, p) => {
        if (!db.has(uid)) return { ok: false, error: "0 rows" };
        const row = { ...db.get(uid), ...p, ...(opts.rewriteRole ? { role: opts.rewriteRole } : {}) };
        db.set(uid, row); return { ok: true, row };
      })(id, payload);
    },
    upsertProfile: async (row) => {
      calls.push(["upsertProfile", row]);
      return seq("upsertSeq", (r) => { db.set(r.id, { ...(db.get(r.id) || {}), ...r }); return { ok: true, row: db.get(r.id) }; })(row);
    },
    findProfileByEmail: async (email) => {
      calls.push(["findProfileByEmail", email]);
      return opts.find || { ok: true, found: false };
    },
    sendRecover: async (email) => { calls.push(["sendRecover", email]); return opts.recover || { ok: true }; },
    isAdmin: () => { adminChecks += 1; return opts.isAdmin ? opts.isAdmin(adminChecks, calls) : true; },
    sleep: async () => { calls.push(["sleep"]); },
  };
  return { deps, calls, db, names: () => calls.map(c => c[0]) };
}
const count = (calls, name) => calls.filter(c => c[0] === name).length;
const add = (deps, over = {}) => createUserProvisioning(deps).provisionStaffUser({ email: "new@shop.test", fullName: "สมชาย ใจดี", role: "technician", ...over });

// ── happy path / role value ──────────────────────────────────
test("T1 created → found → PATCH → verified read-back → invite; signUp exactly once, in order", async () => {
  const f = fakeDeps();
  const r = await add(f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.role, { status: "verified", value: "technician" });
  assert.equal(r.invite, "sent");
  assert.equal(r.account, "created");
  assert.deepEqual(f.names(), ["signUp", "getProfile", "patchProfile", "getProfile", "sendRecover"]);
});

test("T2 chosen sales with DB default sales → PATCH body still carries role:'sales'", async () => {
  const f = fakeDeps({ defaultRole: "sales" });
  const r = await add(f.deps, { role: "sales" });
  assert.equal(r.ok, true);
  const patch = f.calls.find(c => c[0] === "patchProfile");
  assert.equal(patch[2].role, "sales");
  assert.equal(patch[2].full_name, "สมชาย ใจดี");
});

test("T3 chosen sales with DB default customer (A03 simulation) → verified sales", async () => {
  const f = fakeDeps({ defaultRole: "customer" });
  const r = await add(f.deps, { role: "sales" });
  assert.equal(r.ok, true);
  assert.equal(f.db.get(UID).role, "sales");
});

// ── signup response lost / unclear ───────────────────────────
function fakeWindow(xhrBehaviour) {
  const sent = [];
  class XHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { sent.push({ url: this.url, body: JSON.parse(body) }); queueMicrotask(() => xhrBehaviour(this)); }
  }
  return { sent, win: { SUPABASE_CONFIG: { url: "https://x.invalid", anonKey: "anon" }, _sbAccessToken: "jwt", XMLHttpRequest: XHR,
    crypto: { getRandomValues: (a) => a.fill(7) }, fetch: async () => { throw new Error("not used"); }, setTimeout } };
}
const signupVia = async (behaviour) => {
  const { win, sent } = fakeWindow(behaviour);
  const a = createUserProvisioningAdapters({ windowRef: win, xhrPatch: async () => ({ ok: false }), isAdmin: () => true });
  return { res: await a.signUp({ email: "new@shop.test", fullName: "สมชาย" }), sent };
};
async function provisionWithSignup(signupResult) {
  const f = fakeDeps({ signUp: signupResult });
  const r = await add(f.deps);
  return { r, f };
}
const assertUnknownAccount = (r, f) => {
  assert.equal(r.account, "unknown");
  assert.equal(r.ok, false);
  assert.deepEqual(r.role, { status: "unknown" });
  assert.equal(r.invite, "not_sent");
  assert.deepEqual(f.names(), ["signUp"]);
  const view = describeProvisioningResult(r, { roleLabels: LABELS, chosenRole: "technician" });
  assert.equal(view.title, "ไม่ทราบว่าสร้างบัญชีแล้วหรือไม่");
  assert.ok(!JSON.stringify(view).includes("ยังไม่มีการสร้างบัญชี"));
};

test("T4 signup network error → account unknown, nothing else called", async () => {
  const { res } = await signupVia((x) => x.onerror());
  assert.equal(res.kind, "unknown");
  const { r, f } = await provisionWithSignup(res);
  assertUnknownAccount(r, f);
});

test("T5 signup timeout → account unknown", async () => {
  const { res } = await signupVia((x) => x.ontimeout());
  assert.equal(res.kind, "unknown");
  const { r, f } = await provisionWithSignup(res);
  assertUnknownAccount(r, f);
});

test("T6 signup HTTP 5xx → account unknown (may have been created)", async () => {
  const { res } = await signupVia((x) => { x.status = 502; x.responseText = "<html>bad gateway</html>"; x.onload(); });
  assert.equal(res.kind, "unknown");
  const { r, f } = await provisionWithSignup(res);
  assertUnknownAccount(r, f);
});

test("T7 signup 2xx with unparseable body → unknown", () => {
  assert.equal(classifySignupResponse({ status: 200, bodyText: "{oops" }).kind, "unknown");
});

test("T8 signup 2xx without a user id → unknown; provisioning stops", async () => {
  assert.equal(classifySignupResponse({ status: 200, bodyText: JSON.stringify({ user: {} }) }).kind, "unknown");
  const { r, f } = await provisionWithSignup({ kind: "created", userId: "" });
  assertUnknownAccount(r, f);
});

test("T9 signup 2xx with identities [] (obfuscated) → exists; the fake id is never used", async () => {
  const c = classifySignupResponse({ status: 200, bodyText: JSON.stringify({ user: { id: "fake-id", identities: [] } }) });
  assert.deepEqual(c, { kind: "exists" });
  const f = fakeDeps({ signUp: c });
  const r = await add(f.deps);
  assert.equal(r.account, "exists");
  assert.ok(!JSON.stringify(f.calls).includes("fake-id"));
  assert.equal(count(f.calls, "signUp"), 1);
});

test("T10 signup 422 user_already_exists (code or legacy message) → exists path, one signUp", async () => {
  assert.deepEqual(classifySignupResponse({ status: 422, bodyText: JSON.stringify({ code: "user_already_exists", msg: "x" }) }), { kind: "exists" });
  assert.deepEqual(classifySignupResponse({ status: 400, bodyText: JSON.stringify({ msg: "User already registered" }) }), { kind: "exists" });
  const f = fakeDeps({ signUp: { kind: "exists" } });
  const r = await add(f.deps);
  assert.equal(r.account, "exists");
  assert.deepEqual(f.names(), ["signUp", "findProfileByEmail"]);
});

test("T11 signup 400 other → not_created, nothing else", async () => {
  const c = classifySignupResponse({ status: 400, bodyText: JSON.stringify({ msg: "Password should be at least 6 characters" }) });
  assert.equal(c.kind, "rejected");
  const f = fakeDeps({ signUp: c });
  const r = await add(f.deps);
  assert.equal(r.account, "not_created");
  assert.deepEqual(f.names(), ["signUp"]);
});

// ── PATCH ok but read-back failed ────────────────────────────
const withReadback = (readback) => fakeDeps({ getProfileSeq: [undefined, readback].map((v, i) => i === 0 ? ((uid) => ({ ok: true, found: true, row: { id: uid, role: "sales", full_name: "สมชาย ใจดี" } })) : (() => v)) });

test("T12 PATCH ok, read-back error → role unknown, no invite, text says unknown and never the chosen role", async () => {
  const f = withReadback({ ok: false, error: "network" });
  const r = await add(f.deps);
  assert.equal(r.ok, false);
  assert.deepEqual(r.role, { status: "unknown" });
  assert.equal(count(f.calls, "sendRecover"), 0);
  const view = describeProvisioningResult(r, { roleLabels: LABELS, chosenRole: "technician" });
  const text = [view.title, ...view.lines].join("\n");
  assert.ok(text.includes("สิทธิ์ที่อ่านได้ตอนนี้: ไม่ทราบ (ตรวจสอบไม่ได้)"));
  assert.ok(!text.includes(LABELS.technician), "must not present the chosen role as current");
  assert.ok(view.actions.some(a => a.id === "retry"));
});

test("T13 PATCH ok, read-back found:false → role unknown, no invite", async () => {
  const f = withReadback({ ok: true, found: false });
  const r = await add(f.deps);
  assert.deepEqual(r.role, { status: "unknown" });
  assert.equal(count(f.calls, "sendRecover"), 0);
});

test("T14 PATCH ok, read-back with another role → mismatch with the observed value, no invite", async () => {
  const f = fakeDeps({ rewriteRole: "sales" });
  const r = await add(f.deps);
  assert.deepEqual(r.role, { status: "mismatch", observed: "sales", observedName: "สมชาย ใจดี" });
  assert.equal(count(f.calls, "sendRecover"), 0);
  assert.equal(roleStateText(r.role, LABELS), LABELS.sales);
});

test("T15 PATCH response lost (ok:false) but read-back shows the chosen role → verified", async () => {
  const f = fakeDeps();
  f.deps.patchProfile = async (id, payload) => { f.calls.push(["patchProfile", id, payload]); f.db.set(id, { ...f.db.get(id), ...payload }); return { ok: false, error: "Timeout" }; };
  const r = await add(f.deps);
  assert.deepEqual(r.role, { status: "verified", value: "technician" });
  assert.equal(r.ok, true);
});

// ── profile lookup errors ────────────────────────────────────
test("T16 getProfile error on every poll → no PATCH/UPSERT, stage lookup, role unknown", async () => {
  const f = fakeDeps({ getProfileSeq: Array(6).fill({ ok: false, error: "500" }) });
  const r = await add(f.deps);
  assert.equal(r.stage, "lookup");
  assert.deepEqual(r.role, { status: "unknown" });
  assert.equal(count(f.calls, "patchProfile") + count(f.calls, "upsertProfile"), 0);
  assert.equal(count(f.calls, "sendRecover"), 0);
});

test("T17 getProfile error then found → PATCH (an error is not absence)", async () => {
  const f = fakeDeps({ getProfileSeq: [{ ok: false, error: "500" }] });
  const r = await add(f.deps);
  assert.equal(r.ok, true);
  assert.equal(count(f.calls, "patchProfile"), 1);
  assert.equal(count(f.calls, "upsertProfile"), 0);
});

test("T18 getProfile throws → treated as an error (like T16)", async () => {
  const f = fakeDeps();
  f.deps.getProfile = async () => { f.calls.push(["getProfile"]); throw new Error("boom"); };
  const r = await add(f.deps);
  assert.equal(r.stage, "lookup");
  assert.equal(count(f.calls, "patchProfile") + count(f.calls, "upsertProfile"), 0);
});

test("T19 findProfileByEmail error in the exists path → no writes, role unknown, retry-search only", async () => {
  const f = fakeDeps({ signUp: { kind: "exists" }, find: { ok: false, error: "500" } });
  const r = await add(f.deps);
  assert.equal(r.stage, "lookup");
  assert.deepEqual(r.role, { status: "unknown" });
  assert.equal(count(f.calls, "patchProfile") + count(f.calls, "upsertProfile") + count(f.calls, "sendRecover"), 0);
  const view = describeProvisioningResult(r, { roleLabels: LABELS, chosenRole: "technician" });
  assert.deepEqual(view.actions.map(a => a.id), ["research", "close"]);
});

test("T20 account lookup returning 2 rows → error (ambiguous)", () => {
  const rows = [{ id: "a", email: "x@y.z", role: "sales" }, { id: "b", email: "x@y.z", role: "admin" }];
  assert.equal(classifyEmailRows({ status: 200, bodyText: JSON.stringify(rows) }, "x@y.z").ok, false);
  assert.equal(classifyProfileRows({ status: 200, bodyText: JSON.stringify([{ id: UID, role: "a" }, { id: UID, role: "b" }]) }, UID).ok, false);
  assert.equal(classifyProfileRows({ status: 200, bodyText: JSON.stringify([{ id: "other", role: "a" }]) }, UID).ok, false);
  assert.deepEqual(classifyProfileRows({ status: 200, bodyText: "[]" }, UID), { ok: true, found: false });
  assert.equal(classifyProfileRows({ status: 500, bodyText: "[]" }, UID).ok, false);
});

test("T21 profile absent on every poll → UPSERT with id/full_name/role → verified", async () => {
  const f = fakeDeps({ signUp: { kind: "created", userId: UID } });   // trigger never created the row
  const r = await add(f.deps);
  assert.equal(count(f.calls, "getProfile"), 7);
  const up = f.calls.find(c => c[0] === "upsertProfile");
  assert.deepEqual(up[1], { id: UID, full_name: "สมชาย ใจดี", role: "technician" });
  assert.equal(r.ok, true);
});

// ── admin revoked ────────────────────────────────────────────
test("T22 not admin before signup → zero calls, not_created", async () => {
  const f = fakeDeps({ isAdmin: () => false });
  const r = await add(f.deps);
  assert.equal(r.account, "not_created");
  assert.equal(f.calls.length, 0);
});

test("T23 admin revoked right before the role write → no write, role not_attempted, no invite", async () => {
  const f = fakeDeps({ isAdmin: (n, calls) => !calls.some(c => c[0] === "getProfile") });
  const r = await add(f.deps);
  assert.equal(r.stage, "admin");
  assert.deepEqual(r.role, { status: "not_attempted" });
  assert.equal(count(f.calls, "patchProfile") + count(f.calls, "upsertProfile") + count(f.calls, "sendRecover"), 0);
});

test("T24 admin revoked after verify, before the link → no recover, invite not_sent, ok false", async () => {
  const f = fakeDeps({ isAdmin: (n, calls) => !(count(calls, "getProfile") >= 2) });
  const r = await add(f.deps);
  assert.deepEqual(r.role, { status: "verified", value: "technician" });
  assert.equal(r.invite, "not_sent");
  assert.equal(r.ok, false);
  assert.equal(count(f.calls, "sendRecover"), 0);
  const view = describeProvisioningResult(r, { roleLabels: LABELS, chosenRole: "technician" });
  assert.ok(view.lines.join("\n").includes("ยังไม่ได้ส่งลิงก์ เพราะสิทธิ์ Admin ของคุณเปลี่ยนไป"));
});

test("T25 sendPasswordLink after the admin lost rights → no sendRecover", async () => {
  const f = fakeDeps({ isAdmin: () => false });
  const r = await createUserProvisioning(f.deps).sendPasswordLink("old@shop.test");
  assert.equal(r.stage, "admin");
  assert.equal(count(f.calls, "sendRecover"), 0);
});

// ── invariants ───────────────────────────────────────────────
test("T26 signup payload is exactly {email, password, data:{full_name}} (no role)", async () => {
  assert.deepEqual(buildSignupBody({ email: "a@b.c", password: "p", fullName: "n" }), { email: "a@b.c", password: "p", data: { full_name: "n" } });
  const { sent } = await signupVia((x) => { x.status = 200; x.responseText = JSON.stringify({ user: { id: UID } }); x.onload(); });
  assert.deepEqual(Object.keys(sent[0].body).sort(), ["data", "email", "password"]);
  assert.deepEqual(sent[0].body.data, { full_name: "สมชาย" });
});

test("T27 retry (resumeProvisioning / assignRole) never calls signUp", async () => {
  const f = fakeDeps({ db: { [UID]: { id: UID, role: "customer", full_name: "x" } } });
  const p = createUserProvisioning(f.deps);
  const r1 = await p.resumeProvisioning({ userId: UID, email: "new@shop.test", role: "sales", fullName: "x" });
  const r2 = await p.assignRole({ userId: UID, role: "technician" });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(count(f.calls, "signUp"), 0);
});

test("T28 recover fails after a verified role → invite failed, ok false, role stays verified", async () => {
  const f = fakeDeps({ recover: { ok: false, status: 429, error: "rate limited" } });
  const r = await add(f.deps);
  assert.equal(r.invite, "failed");
  assert.equal(r.ok, false);
  assert.deepEqual(r.role, { status: "verified", value: "technician" });
  const f2 = fakeDeps({ recover: { ok: false, status: null, error: "Timeout", unknown: true } });
  assert.equal((await add(f2.deps)).invite, "unknown");
});

test("T29 controller.changeRole: read-back mismatch → ok false + toast with the observed role; list reloaded", async () => {
  const f = fakeDeps({ db: { [UID]: { id: UID, role: "sales", full_name: "x" } }, rewriteRole: "sales" });
  const toasts = []; let loads = 0;
  const c = createUserAdminController({ provisioning: createUserProvisioning(f.deps), roleLabels: LABELS,
    ui: { toast: (m) => toasts.push(m), confirm: async () => true, loadUsers: async () => { loads += 1; return { ok: true }; }, rerender() {}, modal() {}, resetAddForm() {} } });
  const r = await c.changeRole(UID, "admin");
  assert.equal(r.ok, false);
  assert.equal(loads, 1);
  assert.equal(toasts.at(-1), "เปลี่ยนสิทธิ์ไม่สำเร็จ — สิทธิ์ที่อ่านได้: " + LABELS.sales);
  const cancelled = await createUserAdminController({ provisioning: createUserProvisioning(f.deps), roleLabels: LABELS,
    ui: { toast() {}, confirm: async () => false, loadUsers: async () => ({ ok: true }), rerender() {}, modal() {}, resetAddForm() {} } }).changeRole(UID, "admin");
  assert.equal(cancelled.ok, false);
});

test("T30 role select never marks Admin for a non-admin; unknown roles are escaped", () => {
  const sel = (html) => (html.match(/<option[^>]*selected[^>]*>([^<]*)</) || [])[1];
  assert.equal(sel(renderRoleSelectOptions("customer", esc)), "ลูกค้า");
  assert.equal(sel(renderRoleSelectOptions(null, esc)), "ไม่ทราบ");
  assert.equal(sel(renderRoleSelectOptions("weird<x>", esc)), "ไม่ทราบ (weird&lt;x&gt;)");
  assert.equal(sel(renderRoleSelectOptions("sales", esc)), "พนักงานขาย");
  assert.equal(sel(renderRoleSelectOptions("admin", esc)), "Admin");
  for (const r of ["customer", null, "", "weird"]) {
    assert.ok(!/<option value="admin" selected/.test(renderRoleSelectOptions(r, esc)), String(r));
    assert.equal(roleSelectValue(r), "");
  }
  assert.deepEqual([...STAFF_ROLES], ["sales", "technician", "accountant", "admin"]);
});

test("T31 single-flight: two concurrent adds for the same email → one signUp", async () => {
  const f = fakeDeps();
  const p = createUserProvisioning(f.deps);
  const [a, b] = await Promise.all([
    p.provisionStaffUser({ email: "same@shop.test", fullName: "x", role: "sales" }),
    p.provisionStaffUser({ email: "SAME@shop.test", fullName: "x", role: "sales" }),
  ]);
  assert.equal(count(f.calls, "signUp"), 1);
  assert.deepEqual([a.stage, b.stage].sort(), ["busy", "done"]);
});

test("T32 controller: list reload failure is announced; success toast only when ok", async () => {
  const f = fakeDeps();
  const toasts = []; const modals = [];
  const c = createUserAdminController({ provisioning: createUserProvisioning(f.deps), roleLabels: LABELS,
    ui: { toast: (m) => toasts.push(m), confirm: async () => true, loadUsers: async () => ({ ok: false }), rerender() {}, modal: (v) => modals.push(v), resetAddForm() {} } });
  const r = await c.addUser({ email: "new@shop.test", fullName: "สมชาย ใจดี", role: "technician" });
  assert.equal(r.ok, true);
  assert.ok(toasts.includes("โหลดรายการผู้ใช้ใหม่ไม่สำเร็จ — รายการที่เห็นอาจไม่เป็นปัจจุบัน"));
  assert.ok(toasts.some(t => t.startsWith("✉️ ส่งคำเชิญไปที่ new@shop.test")));
  assert.equal(modals.length, 0);
  const f2 = fakeDeps({ getProfileSeq: Array(7).fill({ ok: false, error: "x" }) });
  const toasts2 = []; const modals2 = [];
  await createUserAdminController({ provisioning: createUserProvisioning(f2.deps), roleLabels: LABELS,
    ui: { toast: (m) => toasts2.push(m), confirm: async () => true, loadUsers: async () => ({ ok: true }), rerender() {}, modal: (v) => modals2.push(v), resetAddForm() {} } })
    .addUser({ email: "new@shop.test", fullName: "สมชาย ใจดี", role: "technician" });
  assert.equal(modals2.length, 1);
  assert.ok(!toasts2.some(t => t.startsWith("✉️")), "no success toast without verified role");
});

// ── r9 regressions (review round on r8) ──────────────────────
function controllerHarness(f, { loadOk = true, confirm = true } = {}) {
  const toasts = []; const modals = []; let confirms = 0;
  const c = createUserAdminController({ provisioning: createUserProvisioning(f.deps), roleLabels: LABELS,
    ui: { toast: (m) => toasts.push(m), confirm: async () => { confirms += 1; return confirm; },
      loadUsers: async () => ({ ok: loadOk }), rerender() {}, modal: (view, handlers) => modals.push({ view, handlers }), resetAddForm() {} } });
  return { c, toasts, modals, confirms: () => confirms };
}
const action = (m, id) => { assert.ok(m.view.actions.some(a => a.id === id), "action " + id + " offered"); return m.handlers[id](); };

test("T33 existing account → assign fails → retry succeeds: no extra signUp, no automatic recover, same userId", async () => {
  const OLD = "99999999-0000-0000-0000-000000000001";
  const f = fakeDeps({ signUp: { kind: "exists" }, db: { [OLD]: { id: OLD, role: "customer", full_name: "เดิม" } },
    find: { ok: true, found: true, row: { id: OLD, email: "old@shop.test", role: "customer", full_name: "เดิม" } },
    patchSeq: [(uid) => ({ ok: false, error: "0 rows" })] });            // first assign: write rejected → read-back still customer
  const h = controllerHarness(f);
  await h.c.addUser({ email: "old@shop.test", fullName: "ชื่อใหม่", role: "technician" });
  assert.equal(h.modals.length, 1);
  await action(h.modals[0], "assign");                                  // confirm → assignRole → mismatch (customer)
  assert.equal(h.modals.length, 2);
  assert.equal(h.modals[1].view.lines.join("\n").includes("สิทธิ์ที่อ่านได้ตอนนี้: ลูกค้า"), true);
  assert.equal(h.modals[1].view.title, "ยืนยันสิทธิ์ไม่ได้ — old@shop.test", "the task's email survives an assignRole result (which has none)");
  await action(h.modals[1], "retry");                                   // retry keeps the task kind: assign only
  assert.equal(count(f.calls, "signUp"), 1, "only the original attempt");
  assert.equal(count(f.calls, "sendRecover"), 0, "assign retry must not send recover");
  assert.equal(f.db.get(OLD).role, "technician");
  assert.ok(f.calls.filter(c => c[0] === "patchProfile").every(c => c[1] === OLD));
  assert.equal(f.calls.filter(c => c[0] === "patchProfile").some(c => "full_name" in c[2]), false, "existing name untouched");
  assert.ok(h.toasts.includes("ตั้งสิทธิ์เป็น " + LABELS.technician + " แล้ว"));
});

test("T34 new account → read-back fails → retry uses the same userId and email; recover goes to that email once", async () => {
  const f = fakeDeps({ getProfileSeq: [undefined, { ok: false, error: "500" }].map((v, i) => i === 0
    ? ((uid) => ({ ok: true, found: true, row: { id: uid, role: "sales", full_name: "สมชาย ใจดี" } })) : (() => v)) });
  const h = controllerHarness(f);
  const r = await h.c.addUser({ email: "new@shop.test", fullName: "สมชาย ใจดี", role: "technician" });
  assert.equal(r.ok, false);
  assert.equal(count(f.calls, "sendRecover"), 0);
  await action(h.modals[0], "retry");
  assert.equal(count(f.calls, "signUp"), 1);
  assert.deepEqual(f.calls.filter(c => c[0] === "sendRecover").map(c => c[1]), ["new@shop.test"]);
  assert.ok(f.calls.filter(c => c[0] === "getProfile" || c[0] === "patchProfile").every(c => c[1] === UID));
  const patches = f.calls.filter(c => c[0] === "patchProfile");
  assert.deepEqual(patches.at(-1)[2], { full_name: "สมชาย ใจดี", role: "technician" }, "retry keeps the original name and role");
});

test("T35 changeRole: PATCH ok → read-back fails → list reload fails → UI shows unknown, never the old role as current", async () => {
  const f = fakeDeps({ db: { [UID]: { id: UID, role: "sales", full_name: "x" } },
    getProfileSeq: [undefined, { ok: false, error: "500" }].map((v, i) => i === 0 ? ((uid) => ({ ok: true, found: true, row: { id: uid, role: "sales", full_name: "x" } })) : (() => v)) });
  const h = controllerHarness(f, { loadOk: false });
  const res = await h.c.changeRole(UID, "admin");
  assert.deepEqual(res.role, { status: "unknown" });
  assert.ok(h.toasts.includes("โหลดรายการผู้ใช้ใหม่ไม่สำเร็จ — รายการที่เห็นอาจไม่เป็นปัจจุบัน"));
  assert.ok(h.toasts.includes("เปลี่ยนสิทธิ์ไม่สำเร็จ — สิทธิ์ที่อ่านได้: ไม่ทราบ (ตรวจสอบไม่ได้)"));
  const sel = fakeSelect("sales");
  assert.equal(applyRoleResultToSelect(sel, res, { prev: "sales", escHtml: esc, roleLabels: LABELS }), "unknown");
  assert.equal(selectedText(sel.innerHTML), "ไม่ทราบ (ตรวจสอบไม่ได้)");
  assert.equal(sel.label.textContent, "ไม่ทราบ (ตรวจสอบไม่ได้)");
  assert.notEqual(sel.value, "sales");
  assert.equal(sel.dataset.rolePrev, "");
});

test("T36a sendPasswordLink with empty or malformed email → zero dependency calls", async () => {
  for (const bad of ["", "   ", null, undefined, "not-an-email", "a@b"]) {
    const f = fakeDeps();
    const r = await createUserProvisioning(f.deps).sendPasswordLink(bad);
    assert.equal(r.stage, "validate", String(bad));
    assert.equal(f.calls.length, 0, String(bad));
  }
});

test("T36b controller.sendLink with empty or malformed email → no confirm, no request, explicit toast", async () => {
  for (const bad of ["", null, "x@y"]) {
    const f = fakeDeps();
    const h = controllerHarness(f);
    const r = await h.c.sendLink(bad);
    assert.equal(r.ok, false);
    assert.equal(h.confirms(), 0);
    assert.equal(f.calls.length, 0);
    assert.ok(h.toasts.includes("อีเมลไม่ถูกต้อง — ไม่ได้ส่งลิงก์"));
  }
});

test("T37 applyRoleResultToSelect: verified → new value · mismatch → value read back · nothing written → previous value", () => {
  const v = fakeSelect("sales");
  assert.equal(applyRoleResultToSelect(v, { ok: true, role: { status: "verified", value: "admin" } }, { prev: "sales", escHtml: esc, roleLabels: LABELS }), "verified");
  assert.equal(v.value, "admin");
  const m = fakeSelect("sales");
  assert.equal(applyRoleResultToSelect(m, { ok: false, role: { status: "mismatch", observed: "technician" } }, { prev: "sales", escHtml: esc, roleLabels: LABELS }), "observed");
  assert.equal(selectedText(m.innerHTML), "ช่าง");
  assert.equal(m.value, "technician");
  assert.equal(m.label.textContent, LABELS.technician);
  for (const res of [{ ok: false, cancelled: true }, { ok: false }, { ok: false, role: { status: "not_attempted" } }, null]) {
    const c = fakeSelect("admin");
    assert.equal(applyRoleResultToSelect(c, res, { prev: "sales", escHtml: esc, roleLabels: LABELS }), "unchanged");
    assert.equal(c.value, "sales");
  }
});

test("T38 result modal: no userId → no retry/assign action; assignRole results carry no email so the task's email is used", async () => {
  const f = fakeDeps({ signUp: { kind: "exists" }, find: { ok: true, found: false } });
  const h = controllerHarness(f);
  await h.c.addUser({ email: "lost@shop.test", fullName: "x", role: "sales" });
  const ids = h.modals[0].view.actions.map(a => a.id);
  assert.ok(!ids.includes("retry") && !ids.includes("assign"));
  const r = await createUserProvisioning(fakeDeps().deps).assignRole({ userId: UID, role: "sales" });
  assert.equal(r.email, null);
});

test("T39 resumeProvisioning with a missing userId or bad email → zero calls", async () => {
  for (const args of [{ userId: null, email: "a@b.co" }, { userId: UID, email: "" }, { userId: UID, email: null }, { userId: "", email: "a@b.co" }]) {
    const f = fakeDeps();
    const r = await createUserProvisioning(f.deps).resumeProvisioning({ ...args, role: "sales", fullName: "x" });
    assert.equal(r.stage, "validate");
    assert.equal(f.calls.length, 0);
  }
});

function fakeSelect(value) {
  const label = { textContent: "เดิม", style: {} };
  return { value, innerHTML: "", dataset: { rolePrev: value }, label, closest: () => ({ querySelector: () => label }) };
}
function selectedText(html) { return (html.match(/<option[^>]*selected[^>]*>([^<]*)</) || [])[1]; }

// ── structural wiring (not production-safety evidence) ───────
function fnBody(src, header) {
  const i = src.indexOf(header); assert.ok(i >= 0, header);
  let depth = 0; let j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1); }
  throw new Error("unbalanced " + header);
}
test("S1 [structural] main.js addNewUser delegates to the controller and keeps no role !== 'sales' skip", () => {
  const body = fnBody(read("main.js"), "async function addNewUser(){");
  assert.ok(body.includes("userAdmin().addUser({ email, fullName, role })"));
  assert.ok(!body.includes('role !== "sales"'));
  assert.ok(!/auth\/v1\/signup/.test(body));
});
test("S2 [structural] main.js addNewUser has no console.warn-only failure path", () => {
  assert.ok(!fnBody(read("main.js"), "async function addNewUser(){").includes("console.warn"));
});
test("S3 [structural] users.js uses the role-select helper and applies the role result (not a blind revert)", () => {
  const src = read("modules/settings/users.js");
  assert.ok(src.includes("renderRoleSelectOptions(p.role, escHtml)"));
  assert.ok(src.includes("if (sel.isConnected) applyRoleResultToSelect(sel, res, { prev, escHtml, roleLabels: ROLE_LABELS });"));
  assert.ok(!src.includes("sel.value = prev"), "users.js must not revert blindly — applyRoleResultToSelect decides");
  assert.ok(!src.includes(`<option value="admin" \${p.role==='admin'?'selected':''}>Admin</option>`));
});
