// Phase 489 (audit S-2) — payroll expense-tag exact-boundary match (no prefix-collision wipe).
// Run: node --test tests/payroll_tag_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { payrollTagMatches } from "../modules/payroll_tag.js";

// ── pure: payrollTagMatches (the collision fix) ─────────────────────────────────
test("matches the exact tag, NOT a longer-id prefix (#payroll-5 ≠ #payroll-50/500)", () => {
  assert.equal(payrollTagMatches("… #payroll-5", 5), true);
  assert.equal(payrollTagMatches("… #payroll-50", 5), false, "id 5 must not match #payroll-50");
  assert.equal(payrollTagMatches("… #payroll-500", 5), false, "id 5 must not match #payroll-500");
  assert.equal(payrollTagMatches("… #payroll-51", 5), false);
});

test("matches its own longer id correctly", () => {
  assert.equal(payrollTagMatches("x #payroll-50", 50), true);
  assert.equal(payrollTagMatches("x #payroll-5", 50), false, "id 50 must not match #payroll-5");
});

test("position-independent: tag not at end of note still matches with a boundary", () => {
  assert.equal(payrollTagMatches("auto · A #payroll-5 [ลบแล้ว]", 5), true);
  assert.equal(payrollTagMatches("auto · A #payroll-50 [ลบแล้ว]", 5), false);
});

test("string/number id tolerant; empty/null note or id → false", () => {
  assert.equal(payrollTagMatches("#payroll-7", "7"), true);
  assert.equal(payrollTagMatches("", 5), false);
  assert.equal(payrollTagMatches(null, 5), false);
  assert.equal(payrollTagMatches("#payroll-5", null), false);
  assert.equal(payrollTagMatches("#payroll-5", ""), false);
});

// ── source: payroll.js no longer blind-DELETEs by ilike substring ───────────────
const payroll = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");

test("delete-reverse: fetches candidates, filters by payrollTagMatches, DELETEs by exact id (not blind ilike)", () => {
  // the old blind "DELETE expenses?note=ilike.%tag%" must be gone
  assert.ok(!/expenses\?note=ilike[\s\S]{0,90}method: "DELETE"/.test(payroll),
    "must NOT DELETE expenses directly by a note=ilike substring filter");
  // candidate fetch (GET) + boundary filter + delete by id list
  assert.match(payroll, /expenses\?select=id,note&note=ilike\./, "fetches candidates with note for client-side filtering");
  assert.match(payroll, /\.filter\(r => payrollTagMatches\(r\.note, id\)\)/, "filters candidates by exact-boundary tag");
  assert.match(payroll, /expenses\?id=in\.\(/, "deletes only the exact-matched ids");
});

test("create dup-check filters by payrollTagMatches (no false 'already exists' from a longer id)", () => {
  assert.match(payroll, /arr\.some\(r => payrollTagMatches\(r\.note, payroll\.id\)\)/,
    "duplicate check must use the exact-boundary match, not a raw ilike hit");
});
