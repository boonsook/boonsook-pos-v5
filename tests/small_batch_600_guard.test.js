// Phase 600 — เก็บเล็ก batch (7 nits) source-regex guard
// Run: node --test tests/small_batch_600_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const read = (p) => fs.readFileSync(path.resolve(p), "utf8");

// ── (a) time_clock: totalLateMinutes บวกเฉพาะ status ตรง (ไม่บวกดิบทุก record) ──
test("(a) time_clock: totalLateMinutes/EarlyLeave มีเงื่อนไข status", () => {
  const tc = read("modules/time_clock.js");
  assert.match(tc, /if\s*\(p\.status === "late" \|\| p\.status === "late_and_early_leave"\)\s*acc\.totalLateMinutes\s*\+=/,
    "totalLateMinutes ต้องบวกเฉพาะ status late/late_and_early_leave");
  assert.match(tc, /if\s*\(p\.status === "early_leave" \|\| p\.status === "late_and_early_leave"\)\s*acc\.totalEarlyLeaveMinutes\s*\+=/,
    "totalEarlyLeaveMinutes ต้องบวกเฉพาะ early_leave/late_and_early_leave");
  assert.ok(!/^\s*acc\.totalLateMinutes\s*\+=/m.test(tc), "ต้องไม่มีบรรทัดบวก totalLateMinutes ดิบ (ไม่มีเงื่อนไข)");
});

// ── (b) main.js logoutBtn (sidebar): App.confirm + setTimeout (pattern 596) ──
test("(b) main.js logoutBtn มี App.confirm + setTimeout (กัน tap-leak)", () => {
  const m = read("main.js");
  assert.match(m, /\$\("logoutBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*setTimeout\(async[\s\S]{0,80}App\.confirm\("ออกจากระบบ\?"\)[\s\S]{0,40}logout\(\)/,
    "logoutBtn → setTimeout(async → App.confirm → logout())");
});

// ── (c) logout() ล้าง authStatus ──
test("(c) logout() ล้าง authStatus (กัน 'กำลังเข้าสู่ระบบ...' ค้าง)", () => {
  const m = read("main.js");
  const body = (m.match(/async function logout\(\)\{[\s\S]*?\n\}/) || [""])[0];
  assert.match(body, /if\s*\(\$\("authStatus"\)\)\s*\$\("authStatus"\)\.textContent\s*=\s*""/, "logout() ต้องล้าง authStatus");
});

// ── (d) customer_dashboard: ค่าจาก DB ต้องผ่าน escHtml ก่อนลง innerHTML ──
// ★ Phase 606-b2c (build 605): บล็อกประวัติสั่งซื้อ (เจ้าของ statusLabel/bgColor เดิม) ถูกถอดออก
//   — แท็บนั้นเป็น honest unavailable state แล้ว (RLS deny ฝั่งลูกค้า). invariant เดิม
//   "ค่าจาก DB ห้ามลง innerHTML ดิบ" ยังบังคับ แต่ย้ายไปพิสูจน์บนฟิลด์ที่ยัง render จริง
//   (งานบริการจาก proxy) + ยังกัน pattern เดิมไม่ให้กลับมา.
test("(d) customer_dashboard: ค่าจาก DB ถูก escHtml (defense-in-depth)", () => {
  const cd = read("modules/customer_dashboard.js");
  for (const field of ['j.job_no || "-"', "desc", "presentation.message", "j.id"]) {
    assert.ok(cd.includes(`escHtml(${field})`), `ต้อง escHtml(${field})`);
  }
  assert.ok(!/border-radius:99px;background:\$\{bgColor\}">\$\{statusLabel\}/.test(cd), "ต้องไม่มี ${statusLabel} ดิบ");
  assert.ok(!/\$\{statusLabel\}/.test(cd), "ต้องไม่มี statusLabel ดิบหลงเหลือ");
});

// ── (e) backfill: finally ล้าง _running ──
test("(e) backfill: try/finally ล้าง _running (กัน lock ค้างเมื่อ throw)", () => {
  const bf = read("modules/accounting/backfill.js");
  assert.match(bf, /\}\s*finally\s*\{[\s\S]{0,400}_running\s*=\s*false/, "ต้องมี finally { … _running = false }");
});

// ── (f) product_detail_modal: close() ถอด keydown listener ──
test("(f) product_detail_modal: close() removeEventListener keydown (ทุกทางปิดล้าง listener)", () => {
  const pd = read("modules/product_detail_modal.js");
  assert.match(pd, /const close = \(\) => \{\s*overlay\.remove\(\);\s*document\.removeEventListener\("keydown",\s*escClose\)/,
    "close() ต้อง removeEventListener keydown escClose");
  assert.match(pd, /function escClose\(e\)\s*\{\s*if\s*\(e\.key === "Escape"\)\s*close\(\)/, "escClose named fn");
});

// ── (g) 5 หน้ามี label ข้อมูลไม่ครบ (เลขตามหน้า) ──
test("(g) 5 หน้ามี label 'แสดงจากรายการล่าสุด ~N' (50/50/50/500/200)", () => {
  for (const [f, n] of [["sales", "50"], ["quotations", "50"], ["delivery_invoices", "50"], ["warranty_report", "500"], ["serials", "200"]]) {
    const src = read(`modules/${f}.js`);
    assert.match(src, new RegExp(`แสดงจากรายการล่าสุด ~${n} รายการ`), `${f}.js ต้องมี label ~${n}`);
  }
});
