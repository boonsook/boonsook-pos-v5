// Guard POS/service auto-JV posting:
// - POS checkout (Phase 517b-0): JV post is now AWAITED so the success message is gated on the
//   accounting result (prep for 517b Dr2180 — กัน "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ").
//   POS caller must request detailed result and surface only real failed results.
// - service intake forms (service_form/ac_install/solar) — Phase 602: ไม่โพสต์ JV เองอีกแล้ว.
//   ฟอร์มรับงานสร้างงานเป็น non-completion เสมอ (กัน born-done) → service close JV + ตัดสต็อก
//   เกิดที่ admin drawer "ใบรับงาน" (main.js saveServiceJob) ที่เดียว. เดิมมี background-JV block
//   ในฟอร์ม แต่เป็น dead code ตั้งแต่ 88.15 (COMPLETION_STATUSES = []) → ลบทิ้งใน Phase 602.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

// Phase 517b-0: POS sale JV is AWAITED (no longer background) so success is gated on the JV result.
function assertAwaitedDetailed(src, fnName, label) {
  const i = src.indexOf("async function doCheckout(");
  assert.ok(i >= 0, `${label} must have doCheckout`);
  const body = src.slice(i, i + 20500);
  assert.match(body, new RegExp(`await\\s+${fnName}\\(`), `${label} must AWAIT the JV post (Phase 517b-0, not background)`);
  assert.ok(!new RegExp(`void\\s*\\(\\s*async[\\s\\S]{0,120}${fnName}`).test(body), `${label} sale JV must NOT be fire-and-forget`);
  assert.match(body, new RegExp(`${fnName}\\([\\s\\S]+?,\\s*\\{\\s*detailed:\\s*true\\s*\\}`), `${label} must request detailed result`);
  assert.match(body, /postRes\?\.status\s*===\s*["']failed["']/, `${label} must detect failed result`);
  assert.match(body, /_jvWarn/, `${label} must gate the success message on the JV result`);
  assert.match(body, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, `${label} must warn on failed JV`);
}

test("POS sale auto-JV is awaited (517b-0) and surfaces detailed failures", () => {
  assertAwaitedDetailed(read("modules/pos.js"), "postJournalForSale", "pos.js");
});

// Phase 602: intake forms ต้องไม่โพสต์ JV เอง (งานรับเข้า = non-completion เสมอ; ปิดงาน = admin drawer)
for (const file of ["modules/service_form.js", "modules/ac_install.js", "modules/solar.js"]) {
  test(`${file} intake form must NOT post service JV (close JV lives in the admin drawer)`, () => {
    const src = read(file);
    assert.doesNotMatch(src, /postJournalForServiceJob/,
      `${file} must not import or call postJournalForServiceJob — service close JV is posted by main.js saveServiceJob (admin drawer)`);
    // record ที่ POST service_jobs ต้องไม่ stamp closed_at — เช็คแบบเจาะ record block ใน
    // tests/service_borndone_prevention_guard.test.js (file-wide grep จะชนคอมเมนต์)
  });
}

test("main.js admin drawer still posts the service close JV (single source)", () => {
  const main = read("main.js");
  assert.match(main, /postJournalForServiceJob\(/, "main.js saveServiceJob must still post the service JV on close");
  assert.match(main, /transitionedToDone \|\| newJobAlreadyComplete \|\| editCompleteWithChange/,
    "main.js must keep the close/complete JV trigger conditions");
});
