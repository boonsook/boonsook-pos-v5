// Phase 90.4 Bug 2 — Regression tests for loyalty admin check (real bug)
//
// Bug discovered while reviewing Bug 1 fix at modules/loyalty.js line 174:
//
//   const isAdmin = currentRole === 'admin' || currentRole === 'super_admin';
//
// `currentRole` is destructured from ctx (line 147). In main.js:1022 it is
// defined as a FUNCTION, not a string:
//
//   function currentRole(){ return state.profile?.role || "sales"; }
//
// main.js:1161 passes the function reference itself via ctx, not its return
// value. Everywhere else in the codebase calls `currentRole()` (e.g.
// main.js:1023/1025/1026/1193). Only loyalty.js:174 forgets the parens —
// so the comparison is `<function> === 'admin'` which is ALWAYS false.
//
// Impact: ครั้งใหญ่ — admin/super_admin ก็จะเจอข้อความ "เฉพาะผู้ดูแลระบบเท่านั้น"
// แทน Settings tab (line 220), เพราะ isAdmin = false ตลอดเวลา. แม้แต่
// Bug 1 fix (save handler order) ก็มองไม่เห็นจากผู้ใช้ admin จนกว่าจะ fix Bug 2.
//
// Fix (1 char): currentRole === 'admin'  →  currentRole() === 'admin'
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loyaltySrc = readFileSync(path.join(__dirname, "..", "modules", "loyalty.js"), "utf8");

// ── Unit test of the comparison itself — proves the bug exists in the buggy form ──
test("comparing a function reference vs string is always false (the underlying bug)", () => {
  // Mimic main.js:1022 — currentRole is a function, not a string
  const currentRole = () => "admin";

  // Buggy form (what loyalty.js:174 had before the fix)
  const isAdminBuggy = currentRole === "admin" || currentRole === "super_admin";
  assert.equal(isAdminBuggy, false, "function reference !== string — comparison is always false even when the actual role is admin");

  // Fixed form (what loyalty.js:174 has after the fix)
  const isAdminFixed = currentRole() === "admin" || currentRole() === "super_admin";
  assert.equal(isAdminFixed, true, "calling the function returns the role string, then === works");
});

test("super_admin case: buggy form still false, fixed form true", () => {
  const currentRole = () => "super_admin";
  assert.equal(currentRole === "admin" || currentRole === "super_admin", false);
  assert.equal(currentRole() === "admin" || currentRole() === "super_admin", true);
});

test("non-admin sales role: fixed form correctly returns false", () => {
  const currentRole = () => "sales";
  assert.equal(currentRole() === "admin" || currentRole() === "super_admin", false, "fix must not over-grant admin access");
});

// ── Integration: production code uses the call form, not the reference form ──
test("loyalty.js:174 must invoke currentRole() (with parens) — not compare the function reference", () => {
  // Find the isAdmin assignment line
  const isAdminMatch = loyaltySrc.match(/const\s+isAdmin\s*=\s*([^\n;]+);/);
  assert.ok(isAdminMatch, "loyalty.js must declare `const isAdmin = ...;`");
  const rhs = isAdminMatch[1];

  // The RHS must invoke currentRole as a function (i.e., contain `currentRole(`),
  // NOT just `currentRole === ...` (which compares the function reference).
  assert.ok(
    rhs.includes("currentRole("),
    `loyalty.js admin check must call currentRole() (with parens). Got RHS: ${rhs.trim()}`
  );
  assert.ok(
    !/currentRole\s*===/.test(rhs),
    `loyalty.js admin check must NOT compare the bare function reference. Got RHS: ${rhs.trim()}`
  );
});

test("loyalty.js admin check still tests for both 'admin' and 'super_admin' roles", () => {
  const isAdminMatch = loyaltySrc.match(/const\s+isAdmin\s*=\s*([^\n;]+);/);
  assert.ok(isAdminMatch, "loyalty.js must declare `const isAdmin = ...;`");
  const rhs = isAdminMatch[1];

  assert.ok(rhs.includes("'admin'") || rhs.includes('"admin"'), "must still check for 'admin' role");
  assert.ok(rhs.includes("'super_admin'") || rhs.includes('"super_admin"'), "must still check for 'super_admin' role");
});
