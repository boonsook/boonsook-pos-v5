// Phase 373 — showStaffLogin must not use an async Promise executor
// Run: node --test tests/auth_pin_executor_guard.test.js
//
// no-async-promise-executor is an ESLint ERROR (was suppressed by eslint-disable). An async
// executor swallows setup errors → the login promise hangs silently. Phase 373 makes the
// executor sync and runs the async body in an IIFE with .catch (error surfaced, not swallowed).
// resolve semantics are preserved exactly: resolve only fires on a successful login.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/auth.js"), "utf8");

function showStaffLoginBody() {
  const s = src.indexOf("export function showStaffLogin()");
  assert.ok(s >= 0, "showStaffLogin must exist");
  const e = src.indexOf("export async function initAuth(", s);
  assert.ok(e > s, "initAuth delimiter must follow showStaffLogin");
  return src.slice(s, e);
}
const body = showStaffLoginBody();

test("executor is NOT async (no-async-promise-executor fixed, not suppressed)", () => {
  assert.ok(!/new Promise\(\s*async\s*\(resolve\)/.test(body), "must NOT be new Promise(async (resolve)");
  assert.match(body, /new Promise\(\s*\(resolve\)\s*=>/, "uses sync executor new Promise((resolve) =>");
});

test("async body wrapped in IIFE with .catch (setup errors surfaced)", () => {
  assert.match(body, /\(async\s*\(\)\s*=>\s*\{/, "async IIFE opener present");
  assert.match(body, /\}\)\(\)\.catch\(/, "IIFE closed with .catch");
  assert.match(body, /console\.error\("\[auth\] showStaffLogin setup failed:/, "setup error is logged");
});

test("no leftover eslint-disable for no-async-promise-executor", () => {
  assert.ok(!/eslint-disable[^\n]*no-async-promise-executor/.test(body), "disable comment must be removed");
});

test("resolve semantics preserved (success resolve kept, no resolve(null) added)", () => {
  assert.match(body, /resolve\(staffObj\)/, "successful-login resolve(staffObj) kept");
  assert.ok(!/resolve\(null\)/.test(body), "no resolve(null) introduced — behavior unchanged");
});
