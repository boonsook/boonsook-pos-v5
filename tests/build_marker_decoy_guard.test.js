// Phase 608 — กัน "เลข build ปลอม" ในไฟล์ที่เครื่องมืออ่านด้วย regex
//
// ที่มาจริง: sw.js บรรทัดคอมเมนต์ changelog ของ v599 เคยยกข้อความโค้ดเก่า
//   `const SW_BUILD = '599'` มาอ้างไว้กลางคอมเมนต์ (ยาว ~1,700 ตัวอักษร)
//   → เครื่องมือที่อ่านด้วย regex ไม่ anchor จับเลขในคอมเมนต์ก่อนตัวจริงที่ประกาศไว้ล่าง
//   ทำให้ระบบ staging รายงานว่า SW build = 599 ทั้งที่ไฟล์เป็น 607 (เสียเวลาไล่หลายชั่วโมง)
//
// กฎที่ล็อกไว้:
//   (1) ไฟล์ที่ถูก parse ต้องมี "เลข build" ในรูปแบบที่กำหนด **ครั้งเดียว** — ห้ามมี decoy
//       ในคอมเมนต์/ข้อความ (ถ้าจะเล่าถึงเลขเก่า ให้เขียนแบบไม่ใช่รูปแบบประกาศตัวแปร)
//   (2) ตัวอ่านทุกตัวในโปรเจ็คต้อง anchor ที่ต้นบรรทัด (^...$/m) ไม่ใช่ค้นทั้งไฟล์
//
// ครอบเฉพาะไฟล์ที่ "เครื่องมืออ่านค่าไปใช้" (sw.js / index.html) — เอกสาร (CHANGELOG/HANDOFF)
// พูดถึงเลข build ได้อิสระ เพราะไม่มีใคร parse

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(path.join(root, "sw.js"), "utf8");
const indexHtml = readFileSync(path.join(root, "index.html"), "utf8");
const e2eSmoke = readFileSync(path.join(root, "tests", "e2e", "smoke.spec.js"), "utf8");

function countOf(text, re) {
  return (text.match(re) || []).length;
}

test("sw.js: รูปแบบประกาศ SW_BUILD ต้องปรากฏครั้งเดียว (ห้ามมี decoy ในคอมเมนต์)", () => {
  const all = countOf(sw, /SW_BUILD\s*=\s*'\d+'/g);
  assert.equal(all, 1,
    `พบรูปแบบ SW_BUILD = '<เลข>' ${all} ครั้ง — ต้องมีแค่บรรทัดประกาศจริง; ` +
    "ถ้าคอมเมนต์ต้องอ้างเลขเก่า ให้เขียนเป็น SW_BUILD (599) แทน");
  assert.match(sw, /^const SW_BUILD = '\d+';$/m, "บรรทัดประกาศจริงต้องอยู่ต้นบรรทัด");
});

test("sw.js: ชื่อ cache ที่มีเลขเวอร์ชันต้องปรากฏครั้งเดียว", () => {
  const all = countOf(sw, /boonsook-pos-v5-cache-v\d+/g);
  assert.equal(all, 1, `พบ cache-v<เลข> ${all} ครั้ง — คอมเมนต์ห้ามยกชื่อ cache เต็มรูปแบบมาอ้าง`);
  assert.match(sw, /^const CACHE_NAME = 'boonsook-pos-v5-cache-v\d+';$/m);
});

test("index.html: data-app-build ต้องปรากฏครั้งเดียว", () => {
  const all = countOf(indexHtml, /data-app-build="\d+"/g);
  assert.equal(all, 1, `พบ data-app-build ${all} ครั้ง — ต้องมีจุดเดียวเป็น source of truth`);
});

test("เลข build 3 จุดต้องตรงกัน (index.html / CACHE_NAME / SW_BUILD)", () => {
  const app = indexHtml.match(/data-app-build="(\d+)"/)?.[1];
  const cache = sw.match(/^const CACHE_NAME = 'boonsook-pos-v5-cache-v(\d+)';$/m)?.[1];
  const swb = sw.match(/^const SW_BUILD = '(\d+)';$/m)?.[1];
  assert.ok(app, "index.html ต้องมี data-app-build");
  assert.equal(cache, app, "CACHE_NAME ต้องตรง data-app-build");
  assert.equal(swb, app, "SW_BUILD ต้องตรง data-app-build");
});

test("ตัวอ่านใน e2e smoke ต้อง anchor ที่บรรทัดประกาศ (ห้ามค้นทั้งไฟล์)", () => {
  assert.ok(
    e2eSmoke.includes("/^const CACHE_NAME = 'boonsook-pos-v5-cache-v(\\d+)';$/m"),
    "smoke.spec.js ต้องอ่าน CACHE_NAME แบบ anchored — regex ลอย ๆ จะจับเลขในคอมเมนต์"
  );
  assert.ok(
    !/swText\.match\(\/cache-v\(\\d\+\)\/\)/.test(e2eSmoke),
    "ห้ามกลับไปใช้ /cache-v(\\d+)/ แบบไม่ anchor"
  );
});

test("ตัวอ่านใน unit guard เดิมต้องยัง anchored อยู่ (ไม่ถูกผ่อนทีหลัง)", () => {
  const dash = readFileSync(path.join(root, "tests", "dashboard_readonly_guard.test.js"), "utf8");
  assert.ok(dash.includes("/^const CACHE_NAME = 'boonsook-pos-v5-cache-v(\\d+)';$/m"));
  assert.ok(dash.includes("/^const SW_BUILD = '(\\d+)';$/m"));
});
