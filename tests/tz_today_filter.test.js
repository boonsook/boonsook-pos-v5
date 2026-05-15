// Phase 89.28 — Unit tests for TZ-aware "today" filtering
// Audit M4 regression: created_at.slice(0,10) was UTC → BKK 00:00-06:59 sales
// appeared as "yesterday" → "วันนี้ขายได้ ฿0" while POS home shows ฿X.
// dateBkk() / todayBkk() must convert UTC timestamptz → BKK YYYY-MM-DD.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateBkk, todayBkk } from "../modules/utils.js";

test("dateBkk: 06:37 BKK (= 23:37 UTC previous day) returns BKK day", () => {
  // Sale at 2026-05-15 06:37:00 BKK = 2026-05-14T23:37:00Z
  const utcIso = "2026-05-14T23:37:00Z";
  assert.equal(dateBkk(utcIso), "2026-05-15");
});

test("dateBkk: 17:30 BKK (= 10:30 UTC) returns BKK day (same)", () => {
  const utcIso = "2026-05-15T10:30:00Z";
  assert.equal(dateBkk(utcIso), "2026-05-15");
});

test("dateBkk: 23:59 BKK (= 16:59 UTC) returns BKK day", () => {
  const utcIso = "2026-05-15T16:59:00Z";
  assert.equal(dateBkk(utcIso), "2026-05-15");
});

test("dateBkk: midnight UTC (= 07:00 BKK) returns same BKK day", () => {
  const utcIso = "2026-05-15T00:00:00Z";
  assert.equal(dateBkk(utcIso), "2026-05-15");
});

test("dateBkk: null/empty/invalid returns empty string", () => {
  assert.equal(dateBkk(null), "");
  assert.equal(dateBkk(""), "");
  assert.equal(dateBkk("not a date"), "");
});

test("dateBkk: accepts Date object", () => {
  const d = new Date("2026-05-14T23:37:00Z");
  assert.equal(dateBkk(d), "2026-05-15");
});

test("dashboard regression — 'today' filter uses dateBkk on created_at, not slice", () => {
  // Simulates the audit M4 bug: POS shows ฿65 but dashboard shows ฿0.
  // Reason: dashboard compared created_at.slice(0,10) (= UTC date) === today (= BKK date).
  // After fix: dateBkk(created_at) === todayBkk() correctly groups by BKK day.
  const today = "2026-05-15";
  const sales = [
    { created_at: "2026-05-14T23:37:00Z", total_amount: 40 }, // 06:37 BKK May 15
    { created_at: "2026-05-14T23:29:00Z", total_amount: 15 }, // 06:29 BKK May 15
    { created_at: "2026-05-14T23:28:00Z", total_amount: 10 }, // 06:28 BKK May 15
    { created_at: "2026-05-14T10:00:00Z", total_amount: 99 }, // 17:00 BKK May 14 (not today)
  ];
  const todaySales = sales.filter(s => dateBkk(s.created_at) === today);
  assert.equal(todaySales.length, 3);
  const todayRevenue = todaySales.reduce((s, x) => s + Number(x.total_amount), 0);
  assert.equal(todayRevenue, 65); // matches POS home banner

  // Old (broken) logic for comparison
  const oldTodaySales = sales.filter(s => String(s.created_at).slice(0, 10) === today);
  assert.equal(oldTodaySales.length, 0); // ← this is the bug
});

test("todayBkk: returns string in YYYY-MM-DD format", () => {
  const t = todayBkk();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
});
