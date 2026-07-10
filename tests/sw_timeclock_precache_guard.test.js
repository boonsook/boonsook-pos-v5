// Phase 599 — precache หน้าลงเวลาให้เปิด offline ได้เสมอ (ปิดช่อง 503)
//
// Why: modules/* = network-first + runtime-cache เฉพาะที่เคยโหลด + install ใหม่ล้าง cache ทั้งหมด
//   → airplane mode + เปิดหน้าลงเวลาหลัง build ใหม่ = HTTP 503. แก้: precache import chain ปิดของ
//   หน้าลงเวลา (?v=SW_BUILD ตรง lazy import) + fallback ignoreSearch ก่อน 503.
// ★ SW_BUILD ต้อง = CACHE_NAME number = data-app-build (index.html) — กันลืม bump แล้วชี้ผิดเวอร์ชัน.
// Run: node --test tests/sw_timeclock_precache_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sw = fs.readFileSync(path.resolve("sw.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");

// ── (a) 3 จุดเลข build ต้องตรงกัน: SW_BUILD = CACHE_NAME = data-app-build ──
test("(a) SW_BUILD = CACHE_NAME number = data-app-build (index.html) — ตรงกัน 3 จุด", () => {
  // ★ anchor ^ (multiline) — จับ "โค้ดจริง" ที่ต้นบรรทัด ไม่ใช่ที่พูดถึงในคอมเมนต์ header (// …)
  const swBuild = (sw.match(/^const\s+SW_BUILD\s*=\s*['"](\d+)['"]/m) || [])[1];
  assert.ok(swBuild, "sw.js ต้องมี const SW_BUILD = '<เลข>' (บรรทัดโค้ด)");
  const cacheNum = (sw.match(/boonsook-pos-v5-cache-v(\d+)'/) || [])[1];
  assert.ok(cacheNum, "sw.js ต้องมี CACHE_NAME boonsook-pos-v5-cache-v<เลข>");
  const appBuild = (indexHtml.match(/data-app-build="(\d+)"/) || [])[1];
  assert.ok(appBuild, "index.html ต้องมี data-app-build");
  assert.equal(swBuild, cacheNum, "SW_BUILD ต้อง = CACHE_NAME number");
  assert.equal(swBuild, appBuild, "SW_BUILD ต้อง = data-app-build (กันลืม bump)");
});

// ── (b) PRECACHE_URLS มี 4 โมดูลหน้าลงเวลา + ?v= SW_BUILD ──
test("(b) PRECACHE_URLS มี time_clock chain (4 โมดูล) + ?v=' + SW_BUILD", () => {
  const block = (sw.match(/const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || "";
  assert.ok(block, "ต้องเจอ PRECACHE_URLS array");
  for (const mod of ["time_clock", "ui_states", "utils", "_offline_queue"]) {
    const re = new RegExp("\\./modules/" + mod + "\\.js\\?v='\\s*\\+\\s*SW_BUILD");
    assert.match(block, re, `PRECACHE ต้องมี ./modules/${mod}.js?v=' + SW_BUILD`);
  }
});

// ── (c) modules fetch fallback มี ignoreSearch ก่อนคืน 503 ──
test("(c) modules offline fallback ลอง ignoreSearch ก่อนคืน 503", () => {
  // เส้น modules: fetch(...).catch(() => caches.match(request)... ignoreSearch ... 503)
  assert.match(sw, /caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/,
    "ต้องมี caches.match(request, { ignoreSearch: true }) ในเส้น modules fallback");
  // ต้องอยู่ "ก่อน" 503 ในลำดับ chain (ignoreSearch ก่อน Module unavailable)
  const iIgnore = sw.indexOf("ignoreSearch: true");
  const i503 = sw.indexOf("'Module unavailable offline'");
  assert.ok(iIgnore >= 0 && i503 >= 0 && iIgnore < i503, "ignoreSearch ต้องมาก่อน fallback 503");
});
