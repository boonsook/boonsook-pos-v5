// Phase 89.18 — Unit tests for cash_recon computeCashRecon
// Covers: M3 TZ filter (Phase 89.17), payment method classification, deleted-sale filter
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCashRecon } from "../modules/cash_recon.js";

// Deterministic BKK date helper for tests — no JSDOM, no Intl-locale guessing
// Treats inputs as ISO timestamps (with TZ) and returns "YYYY-MM-DD" in Asia/Bangkok (+07:00)
function fakeDateBkk(d) {
  if (!d) return "";
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  // shift UTC → BKK by adding 7h, then take ISO date part
  const bkk = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}

test("M3 TZ — sale at 22:30 BKK (15:30 UTC) belongs to BKK date, not UTC", () => {
  // 2026-05-13 22:30 BKK = 2026-05-13 15:30 UTC
  // Pre-fix .slice(0,10) on UTC = "2026-05-13" — happens to match here
  // The real bug: 2026-05-13 23:30 BKK = 2026-05-13 16:30 UTC (still same day)
  //              2026-05-14 00:30 BKK = 2026-05-13 17:30 UTC (UTC slice=13, BKK=14) ← off-by-one
  const state = {
    sales: [
      { created_at: "2026-05-13T15:30:00Z", payment_method: "เงินสด", total_amount: 100 }, // 22:30 BKK
      { created_at: "2026-05-13T17:30:00Z", payment_method: "เงินสด", total_amount: 200 }, // 00:30 BKK next day
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashSales.length, 1, "only the 22:30 sale belongs to May 13 BKK");
  assert.equal(r.cashIn, 100);
});

test("M3 TZ — sale at 00:30 BKK belongs to that BKK day, not previous UTC day", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T17:30:00Z", payment_method: "เงินสด", total_amount: 500 }, // 00:30 May 14 BKK
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-14", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 500, "00:30 BKK May 14 must show up on May 14 query (pre-fix bug: UTC slice = May 13)");
});

test("payment method — 'เงินสด' substring classifies as cash", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 100 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด+โอน", total_amount: 200 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "cash", total_amount: 50 },
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashSales.length, 3);
  assert.equal(r.cashIn, 350);
  assert.equal(r.transferIn, 0);
});

test("payment method — transfer/card excluded from cashIn", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T05:00:00Z", payment_method: "transfer", total_amount: 1000 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "โอน", total_amount: 500 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "บัตรเครดิต", total_amount: 300 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 80 },
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 80);
  assert.equal(r.transferIn, 1800);
});

test("deleted sale (note=[ลบแล้ว]) excluded from totals", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 100, note: "[ลบแล้ว] mis-keyed" },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 200 },
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashSales.length, 1, "deleted-marker sale skipped");
  assert.equal(r.cashIn, 200);
});

test("expense filter — cash expenses count, transfer expenses excluded from cashOut", () => {
  const state = {
    sales: [],
    expenses: [
      { expense_date: "2026-05-13T05:00:00Z", payment_method: "cash", amount: 50 },
      { expense_date: "2026-05-13T05:00:00Z", payment_method: null, amount: 30 },        // null = cash (legacy)
      { expense_date: "2026-05-13T05:00:00Z", payment_method: "เงินสด", amount: 20 },
      { expense_date: "2026-05-13T05:00:00Z", payment_method: "transfer", amount: 999 }, // excluded
    ],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashExpenses.length, 3);
  assert.equal(r.cashOut, 100);
});

test("expense TZ — late-night BKK expense belongs to correct BKK date", () => {
  const state = {
    sales: [],
    expenses: [
      { expense_date: "2026-05-13T17:30:00Z", payment_method: "cash", amount: 200 }, // 00:30 May 14 BKK
    ],
  };
  const r13 = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  const r14 = computeCashRecon({ state, date: "2026-05-14", dateFn: fakeDateBkk });
  assert.equal(r13.cashOut, 0);
  assert.equal(r14.cashOut, 200);
});

test("empty state — returns zeros, no crash", () => {
  const r = computeCashRecon({ state: {}, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 0);
  assert.equal(r.cashOut, 0);
  assert.equal(r.transferIn, 0);
  assert.equal(r.cashSales.length, 0);
  assert.equal(r.expenses.length, 0);
});

test("amount type coercion — string amounts in DB still sum correctly", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: "100.50" },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: "99.50" },
    ],
    expenses: [
      { expense_date: "2026-05-13T05:00:00Z", payment_method: "cash", amount: "25.25" },
    ],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 200);
  assert.equal(r.cashOut, 25.25);
});

test("date filter mismatch — sale on different day not counted", () => {
  const state = {
    sales: [
      { created_at: "2026-05-12T05:00:00Z", payment_method: "เงินสด", total_amount: 999 },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 100 },
      { created_at: "2026-05-14T05:00:00Z", payment_method: "เงินสด", total_amount: 999 },
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 100);
  assert.equal(r.sales.length, 1);
});
