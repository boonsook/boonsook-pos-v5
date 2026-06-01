// Phase 92.49: Period Close Checklist — monthRange date math
// Guards calendar boundaries (last day, exclusive next-day for timestamptz filters).
// Importing the module also smoke-checks that its import chain (trial_balance, backfill, utils) loads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { monthRange } from "../modules/accounting/period_close.js";

test("monthRange: 31-day month (May 2026)", () => {
  const r = monthRange("2026-05");
  assert.equal(r.from, "2026-05-01");
  assert.equal(r.to, "2026-05-31");
  assert.equal(r.toNext, "2026-06-01");  // exclusive upper bound
  assert.equal(r.y, 2026);
  assert.equal(r.m, 5);
});

test("monthRange: 28-day month (Feb 2026, non-leap)", () => {
  const r = monthRange("2026-02");
  assert.equal(r.to, "2026-02-28");
  assert.equal(r.toNext, "2026-03-01");
});

test("monthRange: 29-day month (Feb 2028, leap)", () => {
  const r = monthRange("2028-02");
  assert.equal(r.to, "2028-02-29");
  assert.equal(r.toNext, "2028-03-01");
});

test("monthRange: December rolls to next year", () => {
  const r = monthRange("2026-12");
  assert.equal(r.to, "2026-12-31");
  assert.equal(r.toNext, "2027-01-01");
});
