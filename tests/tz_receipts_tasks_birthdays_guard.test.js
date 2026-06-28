// Phase 538 (S9/S10/S11) — Bangkok-timezone "today" filtering for receipts / tasks / birthdays
// Run: node --test tests/tz_receipts_tasks_birthdays_guard.test.js
//
// Audit BUG_AUDIT_2026-06-25 §4.7: these three pages computed "today"/date cutoffs with
//   new Date().toISOString().slice(0,10) = UTC. During 00:00–06:59 Thailand (= 17:00–23:59 UTC
//   the previous day) the UTC date is still "yesterday", so:
//   - S9 receipts: a bill created this morning (Thai) drops out of the "today/7d/30d/month" filter
//   - S10 tasks: "today / this week / overdue-today / done-today" counts wrong
//   - S11 birthdays: the dedup localStorage key reverts to yesterday → the LINE wish is re-sent
// Fix: use the shared Bangkok helpers todayBkk() / addDaysBkk() for the boundary AND dateBkk()
//   to convert the row's UTC timestamp before comparing (both sides on Asia/Bangkok).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _receiptMatchesSearchDate } from "../modules/receipts.js";

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
// strip // line-comments and /* */ blocks so the Thai comments (which mention the old pattern)
// don't trip the "must NOT contain UTC pattern" assertions.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ───────────────────────────────────────────────
// 1. Behavioral — _receiptMatchesSearchDate compares on Bangkok day, not UTC
// ───────────────────────────────────────────────

test("S9: bill created 01:30 BKK (= 18:30 UTC prev day) is INCLUDED in today=that BKK day", () => {
  // 2026-06-27T18:30:00Z = 2026-06-28 01:30 Bangkok → belongs to BKK 2026-06-28
  const r = { created_at: "2026-06-27T18:30:00Z", receipt_no: "RC1", customer_name: "X" };
  assert.equal(_receiptMatchesSearchDate(r, { cutoff: "2026-06-28", q: "" }), true,
    "morning-Thai bill must NOT be filtered out of its own Bangkok day (UTC bug would exclude it)");
});

test("S9: bill created 23:59 BKK (= 16:59 UTC) is INCLUDED in that BKK day", () => {
  const r = { created_at: "2026-06-28T16:59:00Z", receipt_no: "RC2", customer_name: "X" };
  assert.equal(_receiptMatchesSearchDate(r, { cutoff: "2026-06-28", q: "" }), true);
});

test("S9: bill from a genuinely earlier Bangkok day is still EXCLUDED", () => {
  const r = { created_at: "2026-06-26T10:00:00Z", receipt_no: "RC3", customer_name: "X" };
  assert.equal(_receiptMatchesSearchDate(r, { cutoff: "2026-06-28", q: "" }), false);
});

// ───────────────────────────────────────────────
// 2. Source — each file uses the Bangkok helpers and dropped the UTC slice
// ───────────────────────────────────────────────

test("S9 receipts.js: cutoff via todayBkk/addDaysBkk + compares row with dateBkk; no UTC slice", () => {
  const src = read("modules/receipts.js");
  const code = stripComments(src);
  assert.match(code, /import\s*\{[^}]*\btodayBkk\b[^}]*\baddDaysBkk\b[^}]*\bdateBkk\b[^}]*\}\s*from\s*"\.\/utils\.js"/,
    "must import todayBkk, addDaysBkk, dateBkk");
  assert.match(code, /const today = todayBkk\(\)/, "today boundary must be Bangkok");
  assert.match(code, /cutoff = addDaysBkk\(-7\)/, "7d cutoff must use addDaysBkk(-7)");
  assert.match(code, /cutoff = addDaysBkk\(-30\)/, "30d cutoff must use addDaysBkk(-30)");
  assert.match(code, /dateBkk\(r\?\.created_at\)\s*<\s*cutoff/, "row date must be compared on Bangkok day");
  assert.ok(!/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(code), "no UTC today");
  assert.ok(!/created_at[^)]*\)\.slice\(0, ?10\)\s*<\s*cutoff/.test(code), "no UTC row-date compare");
});

test("S10 tasks.js: today/week via Bangkok helpers + dateBkk on due/done; overdue stays instant", () => {
  const src = read("modules/tasks.js");
  const code = stripComments(src);
  assert.match(code, /import\s*\{[^}]*\btodayBkk\b[^}]*\baddDaysBkk\b[^}]*\bdateBkk\b[^}]*\}\s*from\s*"\.\/utils\.js"/,
    "must import todayBkk, addDaysBkk, dateBkk");
  assert.match(code, /const today = todayBkk\(\)/, "today must be Bangkok");
  assert.match(code, /const weekEnd = addDaysBkk\(7\)/, "week boundary must use addDaysBkk(7)");
  assert.match(code, /dateBkk\(t\.due_at\)\s*===\s*today/, "today filter compares due_at on Bangkok day");
  assert.match(code, /dateBkk\(t\.due_at\)\s*<=\s*weekEnd/, "week filter compares due_at on Bangkok day");
  assert.match(code, /dateBkk\(t\.done_at\)\s*===\s*today/, "done-today compares done_at on Bangkok day");
  assert.match(code, /new Date\(t\.due_at\)\s*<\s*now/, "overdue must keep the instant comparison (TZ-agnostic)");
  assert.ok(!/String\(t\.(due_at|done_at)\)\.slice\(0,10\)/.test(code), "no UTC slice on due/done");
  assert.ok(!/weekFromNow/.test(code), "the UTC weekFromNow var must be gone");
});

test("S11 birthdays.js: dedup key + match-MD on Bangkok day; no UTC slice", () => {
  const src = read("modules/birthdays.js");
  const code = stripComments(src);
  assert.match(code, /import\s*\{[^}]*\btodayBkk\b[^}]*\}\s*from\s*"\.\/utils\.js"/, "must import todayBkk");
  assert.match(code, /const todayBkkStr = todayBkk\(\)/, "today must be Bangkok");
  assert.match(code, /const todayKey = todayBkkStr/, "dedup key must be the Bangkok day");
  assert.match(code, /todayBkkStr\.slice\(5, ?10\)/, "match month-day derived from the Bangkok day");
  assert.ok(!/today\.toISOString\(\)\.slice\(0, ?10\)/.test(code), "no UTC dedup key");
});
