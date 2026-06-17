// Phase 475 — promo active-window uses Asia/Bangkok date, not UTC
// Run: node --test tests/promo_active_bkk_guard.test.js
//
// Why: getActivePrice compared promo_start/promo_end against new Date().toISOString().slice(0,10)
// = UTC date. For Thailand (UTC+7) the UTC date is the previous day until 07:00 local, so a promo
// would activate/expire up to 7 hours off at the day boundary (real mispricing). Fixed to compute
// "today" in Asia/Bangkok.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/products.js"), "utf8");
function getActiveBody(s) {
  const i = s.indexOf("function getActivePrice(p)");
  assert.ok(i >= 0, "getActivePrice must exist");
  return s.slice(i, i + 400);
}
const body = getActiveBody(src);

test("getActivePrice computes 'today' in Asia/Bangkok (not UTC)", () => {
  assert.match(body, /toLocaleDateString\('en-CA', \{ timeZone: 'Asia\/Bangkok' \}\)/, "promo date must be Bangkok tz");
  assert.ok(!/const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(body), "must not use UTC toISOString for the promo active-date");
});
