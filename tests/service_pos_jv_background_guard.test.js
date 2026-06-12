// Guard POS/service auto-JV background posting:
// - checkout / service close must not be blocked by awaiting the JV post inline
// - callers must request detailed result and surface only real failed results

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

test("POS sale auto-JV stays background and surfaces detailed failures", () => {
  assertBackgroundDetailed(read("modules/pos.js"), "postJournalForSale", "pos.js");
});

for (const file of ["modules/service_form.js", "modules/ac_install.js", "modules/solar.js"]) {
  test(`${file} service auto-JV stays background and surfaces detailed failures`, () => {
    assertBackgroundDetailed(read(file), "postJournalForServiceJob", file);
  });
}
