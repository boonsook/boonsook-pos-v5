// Phase 598 — offline queue ลงเวลาไม่หายเงียบ + PWA update UX
//
// Why:
//   (A) ลงเวลา offline ค้างใน IndexedDB เงียบได้ — ทั้งแอปไม่มี online listener, drain เฉพาะตอนเปิด
//       หน้า time clock, sync fail ไม่แจ้ง, self view ไม่มี badge → ลงเวลาหายจาก payroll เงียบ ๆ.
//   (B) boot.js: ปุ่ม "อัปเดตเลย" no-op เงียบเมื่อไม่มี reg.waiting + ไม่มี fallback.
// source-regex guard (ไม่รัน DOM/SW).
// Run: node --test tests/offline_queue_drain_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const tc = fs.readFileSync(path.resolve("modules/time_clock.js"), "utf8");
const boot = fs.readFileSync(path.resolve("boot.js"), "utf8");

// ── (a) main.js: global online listener → drain + lazy import (ไม่ eager) ──
test("(a) main.js มี online listener → _drainTimeClockQueue + lazy import time_clock (ไม่ eager)", () => {
  assert.match(main, /addEventListener\(\s*["']online["']\s*,\s*\(\s*\)\s*=>\s*_drainTimeClockQueue\(/,
    "ต้องมี window.addEventListener('online', () => _drainTimeClockQueue(...))");
  assert.match(main, /_lazyImport\(\s*["']\.\/modules\/time_clock\.js["']\s*\)/,
    "_drainTimeClockQueue ต้อง lazy import time_clock (cache-bust helper เดิม)");
  // ★ ต้องไม่ eager import time_clock ที่ top (กัน bundle โต + โหลดทุก route)
  assert.ok(!/import\s[^\n;]*from\s*["']\.\/modules\/time_clock\.js["']/.test(main),
    "main.js ต้องไม่ static-import time_clock.js (lazy เท่านั้น)");
  // เรียก drain ตอน boot ด้วย (ไม่รอเปิดหน้า)
  assert.match(main, /_drainTimeClockQueue\(\s*["']boot["']\s*\)/, "ต้องเรียก _drainTimeClockQueue('boot') ตอน boot");
});

// ── (b) _drainTimeClockQueue แจ้งทั้ง ok และ fail (ไม่เงียบ fail) ──
test("(b) _drainTimeClockQueue แจ้งทั้ง ok และ fail (toast warn เมื่อ fail)", () => {
  const fn = (main.match(/async function _drainTimeClockQueue\([\s\S]*?\n\}/) || [""])[0];
  assert.ok(fn, "ต้องมี function _drainTimeClockQueue");
  assert.match(fn, /const\s*\{\s*ok\s*,\s*fail\s*\}\s*=\s*await\s+m\.syncOfflineQueue\(\)/, "destructure { ok, fail }");
  assert.match(fn, /ok\s*>\s*0[\s\S]{0,80}showToast\(/, "ok > 0 → toast");
  assert.match(fn, /fail\s*>\s*0[\s\S]{0,120}showToast\([\s\S]*?"warn"\)/, "fail > 0 → toast warn (ไม่เงียบ)");
  assert.match(fn, /window\._tcSyncing/, "กัน sync ซ้อนด้วย window._tcSyncing");
});

// ── (c) time_clock sync-on-render destructure { ok, fail } + แจ้ง fail ──
test("(c) time_clock sync-on-render อ่าน { ok, fail } + แจ้ง fail (เดิม { ok } เงียบ)", () => {
  assert.match(tc, /const\s*\{\s*ok\s*,\s*fail\s*\}\s*=\s*await\s+syncOfflineQueue\(\)/,
    "sync-on-render ต้อง destructure { ok, fail }");
  assert.match(tc, /fail\s*>\s*0[\s\S]{0,140}showToast\?\.\([\s\S]*?"warn"\)/, "fail > 0 → toast warn");
  // self view badge + ปุ่ม sync (reuse handler)
  assert.match(tc, /pendingCount\s*>\s*0\s*\?[\s\S]{0,400}tcSyncSelfBtn/, "self view: pendingCount>0 → badge + ปุ่ม tcSyncSelfBtn");
  assert.match(tc, /_bindOfflineSyncBtn\(\s*["']tcSyncSelfBtn["']/, "ต้อง bind ปุ่ม self sync");
  assert.match(tc, /_bindOfflineSyncBtn\(\s*["']tcSyncOfflineBtn["']/, "admin ยังใช้ปุ่มเดิม (helper ร่วม)");
});

// ── (d) boot.js: ปุ่มอัปเดต มี fallback reload (ไม่ no-op) + timeout fallback ──
test("(d) boot.js swUpdateApply มี fallback reload (ไม่มี reg.waiting → reload; มี → timeout fallback)", () => {
  const fn = (boot.match(/getElementById\('swUpdateApply'\)\.addEventListener\('click',\s*function[\s\S]*?\n {4}\}\);/) || [""])[0];
  assert.ok(fn, "ต้องเจอ swUpdateApply click handler");
  assert.match(fn, /reg\.waiting/, "ยังเช็ค reg.waiting");
  assert.match(fn, /SKIP_WAITING/, "มี waiting → postMessage SKIP_WAITING");
  assert.match(fn, /setTimeout\(\s*forceReload\s*,/, "มี waiting → fallback setTimeout(forceReload) กัน controllerchange ไม่มา");
  assert.match(fn, /else\s*\{[\s\S]*?forceReload\(\)/, "ไม่มี reg.waiting → forceReload() ทันที (แทน no-op เงียบ)");
  // forceReload extract + controllerchange ใช้ร่วม
  assert.match(boot, /function forceReload\(\)/, "ต้อง extract forceReload()");
  assert.match(boot, /addEventListener\('controllerchange',\s*forceReload\)/, "controllerchange ใช้ forceReload ร่วม");
  // visibilitychange re-check waiting worker
  assert.match(boot, /reg\.waiting\s*&&\s*navigator\.serviceWorker\.controller\)\s*maybeShowBanner\(reg\)/,
    "visibilitychange ต้อง re-check waiting worker → maybeShowBanner");
});
