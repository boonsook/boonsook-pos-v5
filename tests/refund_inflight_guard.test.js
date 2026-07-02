// Audit fix — guard: refund save เป็น single-flight (กดซ้ำ = คืนซ้ำ)
// บั๊กเดิม: saveBtn.disabled ตั้งหลัง await confirm → double-click = 2 handler ค้าง
//   ที่ confirm พร้อมกัน → ผ่าน validate (TOCTOU) → over-refund + restock ซ้ำ +
//   JV Dr 4110 ซ้ำ + เครดิต 2180 เข้า 2 รอบ.
// (1) behavioral: createInflightGuard บล็อก concurrent run จริง
// (2) source-regex: refunds.js ห่อ handler ด้วย guard
// Run: node --test tests/refund_inflight_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInflightGuard } from "../modules/_inflight_guard.js";

test("createInflightGuard: run ที่ 2 ระหว่าง run แรกยัง pending → ได้ undefined (ไม่ execute)", async () => {
  const g = createInflightGuard();
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const p1 = g.run(async () => { calls++; await gate; return "first"; });
  const p2 = g.run(async () => { calls++; return "second"; }); // ต้อง bail ทันที
  assert.equal(await p2, undefined, "concurrent run ต้องได้ undefined");
  release();
  assert.equal(await p1, "first");
  assert.equal(calls, 1, "fn ต้องรันครั้งเดียว (คลิกที่ 2 ไม่ execute)");
});

test("refunds.js: handler #rfSave ห่อด้วย _refundSaveGuard.run (single-flight)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dirname, "../modules/refunds.js"), "utf8");
  assert.match(src, /import\s*\{\s*createInflightGuard\s*\}\s*from\s*["']\.\/_inflight_guard\.js["']/);
  assert.match(src, /_refundSaveGuard\s*=\s*createInflightGuard\(\)/);
  // handler ต้องเรียกผ่าน guard.run (ไม่ใช่ async handler เปล่า)
  assert.match(src, /#rfSave"\)\.addEventListener\("click",\s*\(\)\s*=>\s*_refundSaveGuard\.run\(/);
});
