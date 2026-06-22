// Guard POS/service auto-JV posting:
// - POS checkout (Phase 517b-0): JV post is now AWAITED so the success message is gated on the
//   accounting result (prep for 517b Dr2180 — กัน "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ").
// - service close (service_form/ac_install/solar): JV post stays a background task (not blocking).
// - all callers must request detailed result and surface only real failed results.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function assertBackgroundDetailed(src, fnName, label) {
  const idx = src.indexOf(`${fnName}({`);
  assert.ok(idx >= 0, `${label} must call ${fnName}`);
  const region = src.slice(Math.max(0, idx - 160), idx + 1000);
  assert.match(region, /void\s*\(\s*async\s*\(\)\s*=>/, `${label} must keep JV post in a background task`);
  assert.match(region, new RegExp(`${fnName}\\([\\s\\S]+,\\s*\\{\\s*detailed:\\s*true\\s*\\}`), `${label} must request detailed result`);
  assert.match(region, /postRes\?\.status\s*===\s*["']failed["']/, `${label} must detect failed result`);
  assert.match(region, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, `${label} must warn on failed JV`);
  assert.match(region, /\}\)\(\)\.catch\(/, `${label} background task must catch promise failures`);
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

for (const file of ["modules/service_form.js", "modules/ac_install.js", "modules/solar.js"]) {
  test(`${file} service auto-JV stays background and surfaces detailed failures`, () => {
    assertBackgroundDetailed(read(file), "postJournalForServiceJob", file);
  });
}
