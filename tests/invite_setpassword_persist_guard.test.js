// Phase 448 — invite-set-password-persist (AUTH/UX · low risk · onboarding)
// Run: node --test tests/invite_setpassword_persist_guard.test.js
//
// The "ตั้งรหัสผ่านใหม่" screen for an invited user only fired off the LIVE
// window.location.hash (main.js). On a device that already had a session / cached SW the
// recovery hash was gone before the app booted, so invited users dropped straight into the
// app instead of the set-password screen. Phase 448 captures the recovery intent at the
// EARLIEST point (selfheal.js) into a sessionStorage flag, has main.js honor that flag in
// addition to the live hash, and clears it on set / new-link / logout / expired-token.
//
// These tests lock: (1) selfheal persists the flag on type=recovery, (2) main.js's recovery
// decision honors the flag + clears it (no-session + logout), (3) auth_email actually clears
// the flag on a successful set and on "request new link" (behavioral, with fake sessionStorage).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEmailAuth } from "../modules/auth_email.js";

const FLAG = "bsk_pending_set_password";

// ── behavioral: drive createEmailAuth with a fake DOM + fake sessionStorage ──────────────
function makeEl(initialClasses = []) {
  const set = new Set(initialClasses);
  return {
    value: "",
    textContent: "",
    disabled: false,
    focus() {},
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) },
  };
}

// install a fake sessionStorage on globalThis so auth_email's clear calls actually execute
// (node has no sessionStorage; the real code wraps every access in try/catch so prod is safe).
function withFakeSessionStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return store;
}

function makeAuth(updateUserImpl) {
  const els = {
    setPwNew: makeEl(), setPwConfirm: makeEl(),
    setPasswordStatus: makeEl(["hidden"]), setPasswordBtn: makeEl(),
    setPwRequestNewBtn: makeEl(["hidden"]),
    setPasswordScreen: makeEl(), authScreen: makeEl(["hidden"]),
    authStatus: makeEl(), loginEmail: makeEl(),
  };
  els.setPwNew.value = "abcdef";
  els.setPwConfirm.value = "abcdef";
  const $ = (id) => (els[id] = els[id] || makeEl());
  const state = { _recoveryMode: true, supabase: { auth: { updateUser: updateUserImpl } } };
  const api = createEmailAuth({
    state, $, setText: (id, txt) => { $(id).textContent = txt; },
    showToast: () => {}, afterLogin: async () => {},
  });
  return { api, els, state };
}

test("submitNewPassword success clears the persisted set-password flag", async () => {
  const store = withFakeSessionStorage({ [FLAG]: "1" });
  const { api } = makeAuth(async () => ({ error: null }));
  await api.submitNewPassword();
  assert.equal(store.has(FLAG), false, "flag must be cleared once the password is set");
});

test("requestNewRecoveryLink (expired link) clears the persisted flag", () => {
  const store = withFakeSessionStorage({ [FLAG]: "1" });
  const { api, state } = makeAuth(async () => ({ error: null }));
  api.requestNewRecoveryLink();
  assert.equal(store.has(FLAG), false, "flag cleared when user asks for a fresh link");
  assert.equal(state._recoveryMode, false, "recovery mode also reset");
});

test("a thrown (session-dead) set does NOT clear the flag — user can still retry/new-link", async () => {
  const store = withFakeSessionStorage({ [FLAG]: "1" });
  const { api } = makeAuth(async () => { throw { status: 401, message: "Auth session missing!" }; });
  await api.submitNewPassword();
  assert.equal(store.has(FLAG), true, "error path must not consume the flag");
});

// ── source wiring: selfheal.js (earliest capture) + main.js (honor + clear) ──────────────
test("source: selfheal.js persists bsk_pending_set_password on a type=recovery hash", () => {
  const src = fs.readFileSync(path.resolve("selfheal.js"), "utf8");
  assert.match(src, /\/\[#&\]type=recovery\//, "selfheal checks the recovery hash");
  assert.match(src, /sessionStorage\.setItem\(\s*['"]bsk_pending_set_password['"]/, "selfheal persists the flag");
});

test("source: main.js recovery decision honors the persisted flag, not only the live hash", () => {
  const src = fs.readFileSync(path.resolve("main.js"), "utf8");
  assert.match(src, /getItem\(\s*"bsk_pending_set_password"\s*\)\s*===\s*"1"/, "main.js reads the flag");
  assert.match(src, /type=recovery\/\.test\([^\n]*\)\s*\|\|\s*_pendingSetPw/, "isRecovery = live hash OR persisted flag");
});

test("source: main.js clears the flag on expired-token (no session) and on logout", () => {
  const src = fs.readFileSync(path.resolve("main.js"), "utf8");
  const clears = (src.match(/removeItem\(\s*"bsk_pending_set_password"\s*\)/g) || []).length;
  assert.ok(clears >= 2, `expected >=2 flag clears in main.js (no-session + logout), found ${clears}`);
});
