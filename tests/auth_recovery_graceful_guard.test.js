// Phase 406 — auth-recovery-graceful (low risk · error-path only)
// Run: node --test tests/auth_recovery_graceful_guard.test.js
//
// The "set new password" screen (add-member / recovery) used to dump a raw
// "Auth session missing!" and freeze when the recovery link had expired. Phase 406
// makes it recoverable: on a session-dead error, show a clear message + reveal the
// "ขอลิงก์ใหม่" button; requestNewRecoveryLink() returns the user to the login screen.
// Other (non-session) errors keep the plain "บันทึกไม่สำเร็จ" message and DO NOT reveal
// the button. These behavioral tests drive createEmailAuth with fake DOM deps.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEmailAuth } from "../modules/auth_email.js";

// minimal fake element: .value/.textContent/.disabled/.focus + classList backed by a Set
function makeEl(initialClasses = []) {
  const set = new Set(initialClasses);
  return {
    value: "",
    textContent: "",
    disabled: false,
    _focused: false,
    focus() { this._focused = true; },
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
    },
  };
}

// build createEmailAuth with a fake DOM + an updateUser that throws `thrown`
function makeAuth(thrown) {
  const els = {
    setPwNew: makeEl(), setPwConfirm: makeEl(),
    setPasswordStatus: makeEl(["hidden"]),
    setPasswordBtn: makeEl(),
    setPwRequestNewBtn: makeEl(["hidden"]),   // starts hidden
    setPasswordScreen: makeEl(), authScreen: makeEl(["hidden"]),
    authStatus: makeEl(), loginEmail: makeEl(),
  };
  els.setPwNew.value = "abcdef";
  els.setPwConfirm.value = "abcdef";
  const $ = (id) => (els[id] = els[id] || makeEl());
  const state = {
    _recoveryMode: true,
    supabase: { auth: { updateUser: async () => { throw thrown; } } },
  };
  const api = createEmailAuth({
    state, $,
    setText: (id, txt) => { $(id).textContent = txt; },
    showToast: () => {},
    afterLogin: async () => {},
  });
  return { api, els, state };
}

test("session-dead error → clear message + reveals 'request new link' button + re-enables save", async () => {
  const { api, els } = makeAuth({ name: "AuthSessionMissingError", message: "Auth session missing!" });
  await api.submitNewPassword();
  assert.match(els.setPasswordStatus.textContent, /หมดอายุ/, "status mentions the link expired");
  assert.equal(els.setPwRequestNewBtn.classList.contains("hidden"), false, "request-new button is revealed");
  assert.equal(els.setPasswordBtn.disabled, false, "save button re-enabled (not stuck)");
});

test("session-dead detected via 401 status too", async () => {
  const { api, els } = makeAuth({ status: 401, message: "Unauthorized" });
  await api.submitNewPassword();
  assert.equal(els.setPwRequestNewBtn.classList.contains("hidden"), false, "401 also reveals the button");
});

test("non-session error → plain failure message, button stays hidden", async () => {
  const { api, els } = makeAuth({ message: "network down" });
  await api.submitNewPassword();
  assert.match(els.setPasswordStatus.textContent, /บันทึกไม่สำเร็จ:/, "plain failure message");
  assert.equal(els.setPwRequestNewBtn.classList.contains("hidden"), true, "button NOT revealed on generic error");
});

test("requestNewRecoveryLink swaps back to login screen + resets recovery flag", () => {
  const { api, els, state } = makeAuth({ message: "x" });
  assert.equal(typeof api.requestNewRecoveryLink, "function", "exported");
  api.requestNewRecoveryLink();
  assert.equal(els.setPasswordScreen.classList.contains("hidden"), true, "set-password screen hidden");
  assert.equal(els.authScreen.classList.contains("hidden"), false, "login screen shown");
  assert.equal(state._recoveryMode, false, "recovery mode cleared");
});

// ── source wiring ───────────────────────────────────────────────
test("index.html has the request-new button (hidden) and main.js wires it", () => {
  const html = fs.readFileSync(path.resolve("index.html"), "utf8");
  const main = fs.readFileSync(path.resolve("main.js"), "utf8");
  assert.match(html, /id="setPwRequestNewBtn"[^>]*class="[^"]*hidden/, "button present + hidden by default");
  assert.match(main, /setPwRequestNewBtn"\)\?\.addEventListener\("click", requestNewRecoveryLink\)/, "main.js wires the button");
});
