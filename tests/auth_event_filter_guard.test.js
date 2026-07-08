// Phase 572 / build 572 — auth event filter (onAuthStateChange)
// Run: node --test tests/auth_event_filter_guard.test.js
//
// Why (money/UX + auth-gate):
//   onAuthStateChange เดิมเรียก afterLogin() ทุก event ที่มี session →
//   (1) TOKEN_REFRESHED (ทุก ~1 ชม. + ตอน tab กลับ focus) ทำทั้งแอป loadAllData+renderAll เอง
//       = หน้า reset/ฟอร์มหาย/settings เด้ง โดย user ไม่ได้ทำอะไร (ต้นน้ำของอาการที่ Phase 570 แก้ปลายน้ำ).
//   (2) boot: afterLogin รันซ้ำ 2-3 รอบ (boot getSession เรียกเอง + listener รับ INITIAL_SESSION/SIGNED_IN ซ้ำ).
//   Fix = filter event + same-user guard — โดย "token ต้องสดทุก event เสมอ" ห้ามพัง.
//
// การทดสอบเป็น source-structure guard (extract บล็อก onAuthStateChange + afterLogin ด้วย anchor
// แล้ว assert ลำดับ/การมีอยู่) — ตรงแนว *_guard.test.js ของโปรเจกต์ (ไม่มี DOM/supabase runtime).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// ── slice บล็อก listener (callback + else sign-out branch) ────────────────────
const listStart = main.indexOf("onAuthStateChange(async");
assert.ok(listStart >= 0, "onAuthStateChange listener must exist");
const listEnd = main.indexOf("return true;", listStart);
assert.ok(listEnd > listStart, "listener block end (return true) must be found");
const L = main.slice(listStart, listEnd);

// helper: index (>=0) ของ pattern ใน L
function at(re, label) {
  const m = L.match(re);
  assert.ok(m, `${label} — ไม่พบใน onAuthStateChange block`);
  return m.index;
}

// ── #7 module var declared ────────────────────────────────────────────────────
test("Phase 572 — module var _appSessionUserId is declared", () => {
  assert.match(main, /let _appSessionUserId = null;/, "ต้องมี module var let _appSessionUserId = null;");
});

// ── #1 token assignment runs for EVERY event, before any early-return ─────────
test("Phase 572 — token (_sbAccessToken = session.access_token) is set before any early-return/filter", () => {
  const tokenIdx = at(/window\._sbAccessToken = session\.access_token/, "token assignment");
  const recoveryIdx = at(/PASSWORD_RECOVERY/, "PASSWORD_RECOVERY branch");
  const tokenRefreshIdx = at(/_event === "TOKEN_REFRESHED"/, "TOKEN_REFRESHED filter");
  const sameUserIdx = at(/=== _appSessionUserId\)\s*return/, "same-user guard");
  const afterLoginIdx = at(/await afterLogin\(\)/, "afterLogin call");
  assert.ok(tokenIdx < recoveryIdx, "token ต้องมาก่อน PASSWORD_RECOVERY branch");
  assert.ok(tokenIdx < tokenRefreshIdx, "token ต้องมาก่อน TOKEN_REFRESHED filter");
  assert.ok(tokenIdx < sameUserIdx, "token ต้องมาก่อน same-user guard");
  assert.ok(tokenIdx < afterLoginIdx, "token ต้องมาก่อน afterLogin (token สดทุก event)");
});

// ── #2 TOKEN_REFRESHED + USER_UPDATED return before afterLogin ────────────────
test("Phase 572 — TOKEN_REFRESHED/USER_UPDATED short-circuit (return) before afterLogin", () => {
  assert.match(L, /_event === "TOKEN_REFRESHED" \|\| _event === "USER_UPDATED"\)\s*return;/,
    "ต้องมี if (_event === TOKEN_REFRESHED || USER_UPDATED) return;");
  const filterIdx = at(/_event === "TOKEN_REFRESHED" \|\| _event === "USER_UPDATED"\)\s*return/, "token-refresh filter");
  const afterLoginIdx = at(/await afterLogin\(\)/, "afterLogin call");
  assert.ok(filterIdx < afterLoginIdx, "filter TOKEN_REFRESHED/USER_UPDATED ต้องอยู่ก่อน afterLogin");
});

// ── #3 same-user guard before afterLogin ─────────────────────────────────────
test("Phase 572 — same-user guard (_appSessionUserId) short-circuits before afterLogin", () => {
  assert.match(L, /session\.user\.id === _appSessionUserId\)\s*return;/,
    "ต้องมี if (session.user.id && session.user.id === _appSessionUserId) return;");
  const guardIdx = at(/=== _appSessionUserId\)\s*return/, "same-user guard");
  const afterLoginIdx = at(/await afterLogin\(\)/, "afterLogin call");
  assert.ok(guardIdx < afterLoginIdx, "same-user guard ต้องอยู่ก่อน afterLogin");
});

// ── #4 sign-out branch clears _appSessionUserId ──────────────────────────────
test("Phase 572 — sign-out branch resets _appSessionUserId = null", () => {
  // else (no session) branch: ต้องมีทั้ง currentUser = null และ _appSessionUserId = null
  assert.match(L, /state\.currentUser = null;/, "sign-out ต้องล้าง state.currentUser");
  assert.match(L, /_appSessionUserId = null;/, "sign-out ต้องล้าง _appSessionUserId (re-login user เดิม → afterLogin ใหม่)");
});

// ── #5 afterLogin sets _appSessionUserId from state.currentUser ───────────────
test("Phase 572 — afterLogin marks _appSessionUserId from state.currentUser (จุดเดียวครอบทุก caller)", () => {
  const alStart = main.indexOf("async function afterLogin(){");
  assert.ok(alStart >= 0, "afterLogin must exist");
  const alBody = main.slice(alStart, alStart + 500);
  assert.match(alBody, /await loadProfile\(\);/, "afterLogin ต้องเรียก loadProfile ก่อน");
  assert.match(alBody, /_appSessionUserId = state\.currentUser\?\.id \|\| null;/,
    "afterLogin ต้องตั้ง _appSessionUserId = state.currentUser?.id || null");
  // ต้องตั้งหลัง loadProfile (currentUser พร้อม)
  assert.ok(alBody.indexOf("loadProfile") < alBody.indexOf("_appSessionUserId ="),
    "ตั้ง _appSessionUserId หลัง loadProfile");
});

// ── #6 PASSWORD_RECOVERY branch stays BEFORE the new filters (order) ──────────
test("Phase 572 — PASSWORD_RECOVERY branch remains before the new event filters (ไม่ถูกแทรกกลาง)", () => {
  const recoveryIdx = at(/PASSWORD_RECOVERY/, "PASSWORD_RECOVERY branch");
  const filterIdx = at(/_event === "TOKEN_REFRESHED"/, "TOKEN_REFRESHED filter");
  assert.ok(recoveryIdx < filterIdx, "recovery branch ต้องมาก่อน filter ใหม่ (recovery ต้องไม่ถูก short-circuit)");
  assert.match(L, /showSetPasswordScreen\(\)/, "recovery branch ยังต้องเรียก showSetPasswordScreen");
});
