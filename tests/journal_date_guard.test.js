// Phase 385 journal-date-guard (Part A) — money path
// Run: node --test tests/journal_date_guard.test.js
//
// Why this exists:
//   A journal entry was saved with doc_date year 2069 (PV2069050001, 988.00).
//   The bad year cascaded: doc_no became PV2069…, the BE display showed "12",
//   the row sorted to the top, and — critically — the 988 expense fell into
//   fiscal year 2069, excluded from every 2026 statement (2026 expenses
//   understated, cash overstated).
//   Tests lock:
//   (1) pure validateJournalDate — rejects future_year (the 2069 case),
//       future_date, too_old, invalid_format; accepts in-range dates; null-safe,
//   (2) pure findOutOfRangeEntries — flags PV2069050001, no false positives,
//       order-preserving, no input mutation,
//   (3) source guards — module stays pure (no DOM/network/state), Part A does
//       NOT mutate records or touch the money-path posting/mapping logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateJournalDate,
  findOutOfRangeEntries,
  JOURNAL_DATE_ERRORS,
  MIN_JOURNAL_DATE,
} from "../modules/accounting/date_guard.js";

const SRC = fs.readFileSync(path.resolve("modules/accounting/date_guard.js"), "utf8");

const TODAY = "2026-06-07"; // Asia/Bangkok "today" used across cases

// ── PURE: validateJournalDate ──

test("rejects future_year — the PV2069050001 case (year 2069 > 2026)", () => {
  const r = validateJournalDate("2069-05-03", { today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(r.code, "future_year");
});

test("rejects future_date — tomorrow, same year", () => {
  const r = validateJournalDate("2026-06-08", { today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(r.code, "future_date");
});

test("rejects too_old — before MIN_JOURNAL_DATE (e.g. 1969)", () => {
  assert.equal(validateJournalDate("2019-12-31", { today: TODAY }).code, "too_old");
  assert.equal(validateJournalDate("1969-05-03", { today: TODAY }).code, "too_old");
});

test("rejects invalid_format (not strict YYYY-MM-DD / bad month-day)", () => {
  assert.equal(validateJournalDate("2026-6-7", { today: TODAY }).code, "invalid_format");
  assert.equal(validateJournalDate("03/05/2026", { today: TODAY }).code, "invalid_format");
  assert.equal(validateJournalDate("2026-13-01", { today: TODAY }).code, "invalid_format"); // month>12
  assert.equal(validateJournalDate("2026-02-32", { today: TODAY }).code, "invalid_format"); // day>31
});

test("accepts in-range dates: today, a normal 2026 date, and the lower bound", () => {
  assert.equal(validateJournalDate(TODAY, { today: TODAY }).ok, true);
  assert.equal(validateJournalDate("2026-05-03", { today: TODAY }).ok, true);
  assert.equal(validateJournalDate(MIN_JOURNAL_DATE, { today: TODAY }).ok, true); // boundary inclusive
});

test("null-safe / non-string input → invalid_format (never throws)", () => {
  assert.equal(validateJournalDate(null, { today: TODAY }).code, "invalid_format");
  assert.equal(validateJournalDate(undefined, { today: TODAY }).code, "invalid_format");
  assert.equal(validateJournalDate(20260607, { today: TODAY }).code, "invalid_format");
  assert.equal(validateJournalDate({}, { today: TODAY }).code, "invalid_format");
});

test("without today: skips future checks but still enforces format + lower bound", () => {
  assert.equal(validateJournalDate("2069-05-03").ok, true);     // future not checkable → allowed
  assert.equal(validateJournalDate("2019-01-01").code, "too_old");
  assert.equal(validateJournalDate("nope").code, "invalid_format");
});

test("every error code has a Thai user message", () => {
  for (const code of ["invalid_format", "future_year", "future_date", "too_old"]) {
    assert.equal(typeof JOURNAL_DATE_ERRORS[code], "string");
    assert.ok(JOURNAL_DATE_ERRORS[code].length > 0);
  }
});

// ── PURE: findOutOfRangeEntries ──

const GOOD = { doc_no: "PV2026060001", doc_date: "2026-06-01", total_debit: 500, description: "ค่าน้ำมันคันแดง" };
const BAD2069 = { doc_no: "PV2069050001", doc_date: "2069-05-03", total_debit: 988, description: "จ่าย: บริษัท แมกซ์ การ์ด จำกัด" };

test("flags the 2069 entry and reports its fields", () => {
  const out = findOutOfRangeEntries([GOOD, BAD2069], { today: TODAY });
  assert.equal(out.length, 1);
  assert.equal(out[0].doc_no, "PV2069050001");
  assert.equal(out[0].code, "future_year");
  assert.equal(out[0].amount, 988);
});

test("no false positives on a clean 2026 ledger", () => {
  const out = findOutOfRangeEntries([GOOD, { ...GOOD, doc_no: "SV2026060002", doc_date: "2026-06-06" }], { today: TODAY });
  assert.deepEqual(out, []);
});

test("empty / non-array → [] (null-safe)", () => {
  assert.deepEqual(findOutOfRangeEntries([], { today: TODAY }), []);
  assert.deepEqual(findOutOfRangeEntries(null, { today: TODAY }), []);
  assert.deepEqual(findOutOfRangeEntries(undefined), []);
  assert.deepEqual(findOutOfRangeEntries("nope"), []);
});

test("skips null/garbage elements; falls back to total_credit for amount", () => {
  const out = findOutOfRangeEntries(
    [null, undefined, 42, { doc_no: "X", doc_date: "2069-01-01", total_credit: 7 }],
    { today: TODAY }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 7);
});

test("preserves original order and does not mutate input", () => {
  const input = [BAD2069, GOOD, { ...BAD2069, doc_no: "PV2099010001", doc_date: "2099-01-01" }];
  const out = findOutOfRangeEntries(input, { today: TODAY });
  assert.deepEqual(out.map(e => e.doc_no), ["PV2069050001", "PV2099010001"]);
  assert.equal(input.length, 3); // unchanged
  assert.equal(input[0].doc_no, "PV2069050001");
});

// ── SOURCE GUARDS: stays pure + Part A touches nothing it must not ──

test("module is pure: no DOM, no network, no module-level mutable state", () => {
  assert.doesNotMatch(SRC, /document\.|window\.|fetch\(|localStorage|innerHTML/);
  assert.doesNotMatch(SRC, /\blet\s+_/); // no module-level mutable cache like other pages
});

test("Part A does NOT mutate records or touch posting/mapping/period-lock", () => {
  assert.doesNotMatch(SRC, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/i);
  assert.doesNotMatch(SRC, /rest\/v1\/journal_(entries|lines)/i);
  assert.doesNotMatch(SRC, /postJournalForServiceJob|auto_post|period[_-]?lock|mapping/i);
  assert.doesNotMatch(SRC, /ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE/i);
});
