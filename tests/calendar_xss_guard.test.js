// Audit fix — guard: calendar.js escapes service_jobs fields before innerHTML
// บั๊กเดิม: modules/calendar.js ไม่ import escHtml เลย และ render job.customer_name /
//   job.description / job.job_address ดิบเข้า pageContainer.innerHTML. ค่ามาจากฟอร์ม
//   สั่งซื้อสาธารณะ (ไม่ต้อง auth) → stored XSS เด้งเมื่อ staff/admin เปิดหน้าปฏิทิน.
// Test เป็น source-regex: fail ถ้ามีการ interpolate field ผู้ใช้แบบไม่ escape กลับมา.
// Run: node --test tests/calendar_xss_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../modules/calendar.js"), "utf8");

test("calendar.js imports escHtml", () => {
  assert.match(src, /import\s*\{[^}]*\bescHtml\b[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
});

test("ไม่มี job.customer_name / description / job_address ดิบใน template (ต้องผ่าน escHtml)", () => {
  // จับ `${job.customer_name}` แบบไม่มี escHtml ครอบ — ต้องไม่พบ
  assert.doesNotMatch(src, /\$\{\s*job\.customer_name\s*\}/, "customer_name ต้อง escHtml");
  assert.doesNotMatch(src, /\$\{\s*job\.job_address\s*\}/, "job_address ต้อง escHtml");
  // description ผ่าน substring(0,100) → ต้องเป็น escHtml(job.description.substring(...))
  assert.doesNotMatch(src, /\$\{\s*job\.description\s*\?\s*job\.description\.substring/, "description ต้อง escHtml");
});

test("field ผู้ใช้ถูกห่อ escHtml จริง (customer_name / job_address / description)", () => {
  assert.match(src, /escHtml\(\s*job\.customer_name\s*\)/);
  assert.match(src, /escHtml\(\s*job\.job_address\s*\)/);
  assert.match(src, /escHtml\(\s*job\.description\.substring\(/);
});

test("ไม่มี title:'...' ปลอมใน style attribute อีก (attribute-breakout เดิม)", () => {
  assert.doesNotMatch(src, /title:\s*'\$\{/, "title ต้องเป็น attribute จริง ไม่ใช่ยัดใน style");
});
