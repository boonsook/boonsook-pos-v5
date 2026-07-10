// Phase 595 — logout hygiene: ปุ่ม logout topbar ใช้งานได้จริง + ล้าง PII บิลล่าสุด
//
// Why:
//   (1) ปุ่ม "ออกจากระบบ" ใน profile menu (topbar) เดิมเรียก window.__authLogout?.()
//       ซึ่งถูก assign ใน initAuth() ของ auth.js (dead module — ไม่มีใครเรียก) → undefined เสมอ = ปุ่มตาย.
//       แก้: เรียก logout() หลักโดยตรง + App.confirm กันกดพลาด.
//   (2) logout() เดิมไม่ล้าง state.lastReceipt / localStorage "bsk_last_receipt"
//       → PII ลูกค้า (ชื่อ/เบอร์) บนบิลล่าสุดค้างข้าม account.
// เป็น source-regex guard (extract block) — ไม่รัน DOM.
// Run: node --test tests/logout_hygiene_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("main.js"), "utf8");

// ── helper: extract a balanced-ish block by start marker → next N chars (พอครอบ handler/function) ──
function sliceFrom(marker, len = 700) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `หา marker ไม่เจอ: ${marker}`);
  return src.slice(i, i + len);
}

// ── (a) profile-menu handler: ไม่มี __authLogout + มี App.confirm + เรียก logout() + defer (Phase 596) ──
test("(a) profile menu logout handler: เลิกพึ่ง __authLogout → App.confirm + logout() (defer tick)", () => {
  const block = sliceFrom('$("profileMenu")?.addEventListener("click"', 900);
  assert.ok(/dataset\.act === "logout"/.test(block), "block ต้องมี branch logout");
  assert.ok(!/window\.__authLogout/.test(block), "★ ต้องไม่เรียก window.__authLogout แล้ว (dead module)");
  assert.ok(/App\.confirm\(\s*["']ออกจากระบบ\?["']\s*\)/.test(block), "ต้องมี App.confirm(\"ออกจากระบบ?\")");
  assert.ok(/\blogout\(\)/.test(block), "ต้องเรียก logout() หลักโดยตรง");
  // ★ Phase 596: confirm ต้องเปิดใน tick ถัดไป (setTimeout) — กัน tap มือถือทะลุไปโดน "ยืนยัน" ทันที
  assert.ok(/setTimeout\(\s*async[\s\S]{0,60}App\.confirm/.test(block), "logout confirm ต้องถูก defer ด้วย setTimeout (Phase 596)");
});

// ── (b) logout() body: ล้าง PII บิลล่าสุด (state.lastReceipt + localStorage) ──
test("(b) logout(): ล้าง state.lastReceipt + removeItem(bsk_last_receipt) ก่อนออก", () => {
  const body = sliceFrom("async function logout(){", 2000);
  assert.ok(/state\.lastReceipt\s*=\s*null/.test(body), "ต้อง set state.lastReceipt = null");
  assert.ok(/localStorage\.removeItem\(\s*["']bsk_last_receipt["']\s*\)/.test(body), "ต้อง removeItem(\"bsk_last_receipt\")");
  // ต้องล้างก่อน showToast (ยังอยู่ใน logout() ก่อนจบ)
  const iClear = body.indexOf("bsk_last_receipt");
  const iToast = body.indexOf('showToast("ออกจากระบบแล้ว")');
  assert.ok(iClear >= 0 && iToast >= 0 && iClear < iToast, "ต้องล้าง PII ก่อน showToast (อยู่ในตัว logout เดิม)");
});

// ── (c) main.js ไม่ import auth.js (dead module — มี showStaffLogin ใน initAuth) ──
test("(c) main.js ไม่ import ./modules/auth.js (กันดึง dead module + initAuth ที่ไม่ใช้)", () => {
  assert.ok(!/import[^;]*from\s*["']\.\/modules\/auth\.js["']/.test(src), "main.js ต้องไม่ import auth.js");
  assert.ok(!/import[^;]*["']\.\/modules\/auth\.js["']/.test(src), "main.js ต้องไม่มี import path auth.js เลย");
});
