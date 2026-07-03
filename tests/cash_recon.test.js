// Phase 89.18 — Unit tests for cash_recon computeCashRecon
// Covers: M3 TZ filter (Phase 89.17), payment method classification, deleted-sale filter
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("cancelled sale excluded from cash and transfer totals", () => {
  const state = {
    sales: [
      { created_at: "2026-05-13T05:00:00Z", payment_method: "cash", total_amount: 100, status: "cancelled" },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "transfer", total_amount: 300, status: "Cancelled" },
      { created_at: "2026-05-13T05:00:00Z", payment_method: "cash", total_amount: 200, status: "paid" },
    ],
    expenses: [],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.sales.length, 1, "cancelled sales skipped before payment split");
  assert.equal(r.cashIn, 200);
  assert.equal(r.transferIn, 0);
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

// Phase 92.12 (audit 4.1 Should-fix) — cash refunds must reduce the drawer
test("computeCashRecon: subtracts cash refunds from drawer (not transfer refunds)", () => {
  const state = { sales: [{ created_at: "2026-05-21", payment_method: "เงินสด", total_amount: 1000 }], expenses: [] };
  const refunds = [
    { created_at: "2026-05-21", refund_method: "cash", refund_amount: 200 },
    { created_at: "2026-05-21", refund_method: "transfer", refund_amount: 500 },  // ต้องไม่หักจาก cash
    { created_at: "2026-05-20", refund_method: "cash", refund_amount: 999 },       // คนละวัน ต้องไม่นับ
  ];
  const r = computeCashRecon({ state, date: "2026-05-21", refunds, dateFn: (d) => String(d).slice(0, 10) });
  assert.equal(r.cashRefundOut, 200, "เฉพาะ cash refund วันนั้น");
  assert.equal(r.cashIn, 1000);
});

// Phase 490 (audit S-4) — round2 the drawer math so float drift doesn't show "↓ ขาด ฿0.00"
test("Phase 490: expected / countedCash / diff are round2'd (no float-drift false shortfall)", () => {
  const src = fs.readFileSync(path.resolve("modules/cash_recon.js"), "utf8");
  assert.match(src, /import \{[^}]*\bround2\b[^}]*\} from "\.\/utils\.js"/, "imports round2 from utils");
  assert.match(src, /const expected = round2\(/, "expected (drawer math) is round2'd");
  assert.match(src, /const countedCash = round2\(/, "countedCash (denominations) is round2'd");
  assert.match(src, /const diff = round2\(countedCash - expected\)/, "diff is round2'd → `diff === 0` is reliable");
});

// ── Phase 554 — fetch per-day (เลิกพึ่ง state cap) + เก็บหนี้เงินสดเข้าลิ้นชัก ──
const src554 = fs.readFileSync(path.resolve("modules/cash_recon.js"), "utf8");

test("Phase 554: computeCashRecon uses sales/expenses PARAMS (not state cap) when provided", () => {
  const state = {
    sales: [{ created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 9999 }],   // state cap (ต้องไม่ถูกใช้)
    expenses: [{ expense_date: "2026-05-13T05:00:00Z", payment_method: "cash", amount: 8888 }],
  };
  const sales = [{ created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 100 }];
  const expenses = [{ expense_date: "2026-05-13T05:00:00Z", payment_method: "cash", amount: 40 }];
  const r = computeCashRecon({ state, date: "2026-05-13", sales, expenses, dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 100, "ใช้ sales param ไม่ใช่ state.sales");
  assert.equal(r.cashOut, 40, "ใช้ expenses param ไม่ใช่ state.expenses");
});

test("Phase 554: fallback to state.sales/expenses when params omitted (backward-compat กับ test เดิม)", () => {
  const state = {
    sales: [{ created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 250 }],
    expenses: [{ expense_date: "2026-05-13T05:00:00Z", payment_method: "cash", amount: 30 }],
  };
  const r = computeCashRecon({ state, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 250);
  assert.equal(r.cashOut, 30);
});

test("Phase 554: explicit [] param honored — ไม่ fallback ไป state (กัน cap หลุดกลับมา)", () => {
  const state = { sales: [{ created_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", total_amount: 500 }], expenses: [] };
  const r = computeCashRecon({ state, date: "2026-05-13", sales: [], expenses: [], dateFn: fakeDateBkk });
  assert.equal(r.cashIn, 0, "[] ที่ส่งมาต้องชนะ state");
});

test("Phase 554: credit cash payments (method=cash วันนั้น) บวกเข้า creditCashIn; โอน/คนละวัน ไม่นับ", () => {
  const creditCashPayments = [
    { paid_at: "2026-05-13T05:00:00Z", payment_method: "cash", amount: 300 },
    { paid_at: "2026-05-13T05:00:00Z", payment_method: "เงินสด", amount: 150 },
    { paid_at: "2026-05-13T05:00:00Z", payment_method: "transfer", amount: 999 },  // โอน = ไม่เข้าลิ้นชัก
    { paid_at: "2026-05-12T05:00:00Z", payment_method: "cash", amount: 888 },        // คนละวัน
  ];
  const r = computeCashRecon({ state: {}, date: "2026-05-13", creditCashPayments, dateFn: fakeDateBkk });
  assert.equal(r.creditCashIn, 450, "เฉพาะเก็บหนี้เงินสดวันนั้น (300+150)");
  assert.equal(r.creditCashRows.length, 2);
});

test("Phase 554: creditCashIn default 0 เมื่อไม่ส่ง (บิลไม่มีเก็บหนี้ไม่กระทบ)", () => {
  const r = computeCashRecon({ state: {}, date: "2026-05-13", dateFn: fakeDateBkk });
  assert.equal(r.creditCashIn, 0);
  assert.equal(r.creditCashRows.length, 0);
});

test("Phase 554: expected (drawer) formula = opening + cashIn + creditCashIn − cashOut − cashRefundOut (source)", () => {
  assert.match(src554, /const expected = round2\(openingCash \+ cashIn \+ creditCashIn - cashOut - cashRefundOut\)/,
    "expected ต้องรวม creditCashIn เข้าลิ้นชัก");
});

test("Phase 554: fetch helpers มีครบ + ใช้คอลัมน์วันที่ถูก (sales=created_at, credit=paid_at, expenses=expense_date)", () => {
  const salesFn = src554.match(/async function fetchCashReconSales\([\s\S]*?\n}/)?.[0] || "";
  const expFn   = src554.match(/async function fetchCashReconExpenses\([\s\S]*?\n}/)?.[0] || "";
  const credFn  = src554.match(/async function fetchCashReconCreditPayments\([\s\S]*?\n}/)?.[0] || "";
  assert.ok(salesFn, "fetchCashReconSales exists");
  assert.ok(expFn, "fetchCashReconExpenses exists");
  assert.ok(credFn, "fetchCashReconCreditPayments exists");
  // sales — created_at gte/lt +07:00
  assert.ok(salesFn.includes("created_at=gte.") && salesFn.includes("T00:00:00%2B07:00"), "sales fetch ใช้ created_at gte +07:00");
  // ★ sales ไม่มีคอลัมน์ status (ยกเลิกบิล = note "[ลบแล้ว]") → ห้าม select status (จะ 400 → fetch [] เงียบ)
  assert.ok(!/select=[^&]*\bstatus\b/.test(salesFn), "sales fetch ต้องไม่ select status (คอลัมน์ไม่มีจริง → 400)");
  // credit_payments — ★ ต้อง paid_at ไม่ใช่ created_at (schema จริง = paid_at; created_at จะ 400 → fetch [] เงียบ)
  assert.ok(credFn.includes("select=paid_at") && credFn.includes("paid_at=gte."), "credit fetch ใช้ paid_at");
  assert.ok(!credFn.includes("created_at"), "credit fetch ต้องไม่ใช้ created_at (คอลัมน์ไม่มีจริง)");
  // expenses — expense_date=eq (DATE column ไม่ใช่ timestamptz)
  assert.ok(expFn.includes("expense_date=eq."), "expenses fetch ใช้ expense_date=eq");
});
