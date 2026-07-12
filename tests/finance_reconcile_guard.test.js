// Phase 601 (S4.0) — Finance reconciliation audit guard
//
// Why: script เทียบ operational tables (sales/service_jobs/refunds/expenses) กับ GL รายธุรกรรม
//   เพื่อหา "หลักฐาน" ว่า op ต่างจาก GL ตรงไหน เท่าไร เพราะอะไร ก่อนแก้ write-path (S4.1)
//   guard นี้ล็อก: (1) การจำแนก/สรุปถูกต้อง (fixture) + (2) invariant READ-ONLY ของ runner
//   (POST เฉพาะ /auth/v1/token, ทุก /rest/v1/ เป็น GET, ไม่มี PATCH/PUT/DELETE, มี pagination)
// Run: node --test tests/finance_reconcile_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as L from "../scripts/finance_reconcile_lib.js";

const EFF = L.ACCOUNTING_EFFECTIVE_DATE; // "2026-07-01"

// ══════════════════════════════════════════════════════════════
//  ส่วน 1 — fixture (import เฉพาะ lib, ไม่แตะ runner/network)
// ══════════════════════════════════════════════════════════════

// ── (a) sale หลัง effective ไม่มี JE → NO_JV; มี JE ตรง → OK ──
test("(a) classifySale: หลัง effective ไม่มี JE = NO_JV, มี JE ตรงยอด/วัน = OK", () => {
  const sale = { id: 1, created_at: "2026-07-05T03:00:00Z", total_amount: 100, note: "" };
  const noJv = L.classifySale(sale, null, EFF);
  assert.equal(noJv.cls, "NO_JV");
  assert.equal(noJv.detail.opAmount, 100);
  // JE ตรง: doc_date = saleDate (Bangkok ของ 2026-07-05T03:00Z = 2026-07-05), total_debit = 100
  const saleDate = L.bkkDate(sale.created_at);
  const ok = L.classifySale(sale, { total_debit: 100, doc_date: saleDate }, EFF);
  assert.equal(ok.cls, "OK");
});

// ── (b) sale ก่อน effective → PRE_EFFECTIVE (ไม่ว่ามี JE หรือไม่) ──
test("(b) classifySale: ก่อน effective = PRE_EFFECTIVE", () => {
  const sale = { id: 2, created_at: "2026-06-15T05:00:00Z", total_amount: 50, note: "" };
  assert.equal(L.classifySale(sale, null, EFF).cls, "PRE_EFFECTIVE");
  assert.equal(L.classifySale(sale, { total_debit: 50, doc_date: "2026-06-15" }, EFF).cls, "PRE_EFFECTIVE");
});

// ── (c) DELETED: ไม่มี JE = DELETED_OK; มี JE = DELETED_HAS_JV (JV ผี) ──
test("(c) classifySale: ลบแล้ว → DELETED_OK / DELETED_HAS_JV", () => {
  const del = { id: 3, created_at: "2026-07-05T03:00:00Z", total_amount: 100, note: "ยกเลิก [ลบแล้ว]" };
  assert.equal(L.classifySale(del, null, EFF).cls, "DELETED_OK");
  assert.equal(L.classifySale(del, { total_debit: 100, doc_date: "2026-07-05" }, EFF).cls, "DELETED_HAS_JV");
});

// ── (d) AMOUNT_MISMATCH + DATE_MISMATCH ──
test("(d) classifySale: ยอดเพี้ยน = AMOUNT_MISMATCH, วันเพี้ยน = DATE_MISMATCH", () => {
  const sale = { id: 4, created_at: "2026-07-05T03:00:00Z", total_amount: 100, note: "" };
  const saleDate = L.bkkDate(sale.created_at);
  const amt = L.classifySale(sale, { total_debit: 107, doc_date: saleDate }, EFF);
  assert.equal(amt.cls, "AMOUNT_MISMATCH");
  assert.equal(amt.detail.delta, 7);
  const dt = L.classifySale(sale, { total_debit: 100, doc_date: "2026-07-31" }, EFF);
  assert.equal(dt.cls, "DATE_MISMATCH");
});

// ── (e) analyzeSaleItemsCost: 3 ถัง null/0/>0 แยกกัน (null ≠ 0 ห้าม merge) ──
test("(e) analyzeSaleItemsCost: แยก null / 0 / >0 ไม่ปน + fallbackDelta ครอบทั้ง null และ 0", () => {
  const items = [
    { product_id: "p1", qty: 2, unit_cost: 25 },   // KNOWN → knownCogs 50
    { product_id: "p2", qty: 1, unit_cost: null },  // UNKNOWN → fallback 20
    { product_id: "p3", qty: 3, unit_cost: 0 }      // ZERO → fallback 30
  ];
  const map = { p1: 999, p2: 20, p3: 10 };
  const r = L.analyzeSaleItemsCost(items, map);
  assert.equal(r.knownCogs, 50);
  assert.equal(r.unknownCount, 1);
  assert.equal(r.unknownFallbackCogs, 20);
  assert.equal(r.zeroCount, 1);
  assert.equal(r.zeroFallbackCogs, 30);
  assert.equal(r.fallbackDelta, 50);   // 20 (null) + 30 (zero) — ทั้งสองถังถูก profit_report เติม
});

// ── (e2) summarizeMonth: residual identity ต้องปิด (explained = rawDelta) บน fixture คุมได้ ──
test("(e2) summarizeMonth: unexplainedResidual = 0 บน fixture ที่สาเหตุครบ (VAT + NO_JV)", () => {
  const month = "2026-07";
  // sale A: มี JV ตรง (107 op รวม VAT 7, GL แยก → total_debit 100 net) ; sale B: NO_JV 50
  const saleA = { id: "A", created_at: "2026-07-10T03:00:00Z", total_amount: 107, vat_amount: 7, gross_profit: 40, note: "" };
  const saleB = { id: "B", created_at: "2026-07-11T03:00:00Z", total_amount: 50, vat_amount: 0, gross_profit: 20, note: "" };
  const jeA = { id: "jeA", source_table: "sales", source_id: "A", doc_date: "2026-07-10", total_debit: 100 };
  const jeBySource = new Map([["sales:A", jeA]]);
  // GL line ของ jeA: revenue 4xxx credit 100
  const linesByEntry = new Map([["jeA", [{ entry_id: "jeA", account_code: "4100", debit: 0, credit: 100 }]]]);
  const docDateEntries = [jeA];
  const sum = L.summarizeMonth({ month, sales: [saleA, saleB], jeBySource, linesByEntry, docDateEntries });
  // op dashboard = 107 + 50 = 157 ; GL = 100 ; rawDelta = 57
  assert.equal(sum.revenue.opDashboard, 157);
  assert.equal(sum.revenue.gl, 100);
  assert.equal(sum.revenue.deltaDashboardGl, 57);
  // explained = VAT 7 (sale A มี JV) + NO_JV 50 (sale B) = 57 → residual 0
  assert.equal(sum.revenue.breakdown.vat, 7);
  assert.equal(sum.revenue.breakdown.noJv, 50);
  assert.equal(sum.revenue.unexplainedResidual, 0);
});

// ── (e3) orphan: JE doc_date∈เดือน ที่ source เป็น sale ที่ถูกลบ → source-deleted ──
test("(e3) summarizeMonth: JV ผีของบิลที่ลบแล้ว → orphan source-deleted", () => {
  const month = "2026-07";
  const del = { id: "D", created_at: "2026-07-10T03:00:00Z", total_amount: 100, note: "[ลบแล้ว]" };
  const je = { id: "jeD", source_table: "sales", source_id: "D", doc_date: "2026-07-10", total_debit: 100 };
  const sum = L.summarizeMonth({
    month, sales: [del],
    jeBySource: new Map([["sales:D", je]]),
    linesByEntry: new Map([["jeD", [{ entry_id: "jeD", account_code: "4100", debit: 0, credit: 100 }]]]),
    docDateEntries: [je]
  });
  assert.equal(sum.orphans.length, 1);
  assert.equal(sum.orphans[0].reason, "ORPHAN_SOURCE_DELETED");
  assert.equal(sum.counts.sales.DELETED_HAS_JV, 1);
});

// ── (i) expense JV (Dr 5210 opex) ต้องไม่นับเป็น COGS — entryCogs/glCogs = 0 ──
test("(i) COGS = 5100 เท่านั้น: expense JV Dr 5210 → entryCogs 0 + glCogs 0 (premise S4.1 ไม่เพี้ยน)", () => {
  // unit: 5210 (ค่าน้ำมัน opex) ไม่นับ, 5100 (COGS) นับ
  assert.equal(L.entryCogs([{ account_code: "5210", debit: 3000, credit: 0 }]), 0);
  assert.equal(L.entryCogs([{ account_code: "5100", debit: 80, credit: 0 }, { account_code: "5240", debit: 9000, credit: 0 }]), 80);
  // fixture ระดับเดือน: มี expense JV Dr 5210 3000 / Cr 1010 → glCogs ต้องยังเป็น 0
  const month = "2026-07";
  const jeExp = { id: "jeE", source_table: "expenses", source_id: "E1", doc_date: "2026-07-09", total_debit: 3000 };
  const sum = L.summarizeMonth({
    month, expenses: [{ id: "E1", expense_date: "2026-07-09", amount: 3000, note: "" }],
    jeBySource: new Map([["expenses:E1", jeExp]]),
    linesByEntry: new Map([["jeE", [{ entry_id: "jeE", account_code: "5210", debit: 3000, credit: 0 }, { entry_id: "jeE", account_code: "1010", debit: 0, credit: 3000 }]]]),
    docDateEntries: [jeExp]
  });
  assert.equal(sum.glCogs, 0, "expense opex (5210) ต้องไม่โผล่ใน glCogs");
  assert.equal(sum.revenue.gl, 0, "expense JV ไม่มี 4xxx → GL revenue 0");
  assert.equal(sum.counts.expenses.OK, 1, "expense มี JV ยอดตรง → OK");
});

// ── (j) classifyExpense: NO_JV / OK / AMOUNT_MISMATCH / PRE_EFFECTIVE + problem table ──
test("(j) classifyExpense: จำแนก 4 คลาสถูก + เข้า problemRows.expenses (ยกเว้น OK/PRE_EFFECTIVE)", () => {
  const eff = EFF;
  assert.equal(L.classifyExpense({ expense_date: "2026-07-09", amount: 500 }, null, eff).cls, "NO_JV");
  assert.equal(L.classifyExpense({ expense_date: "2026-06-20", amount: 500 }, null, eff).cls, "PRE_EFFECTIVE");
  assert.equal(L.classifyExpense({ expense_date: "2026-07-09", amount: 500 }, { total_debit: 500 }, eff).cls, "OK");
  const mm = L.classifyExpense({ expense_date: "2026-07-09", amount: 500 }, { total_debit: 480 }, eff);
  assert.equal(mm.cls, "AMOUNT_MISMATCH");
  assert.equal(mm.detail.delta, -20);
  // problemRows.expenses: NO_JV เข้า, OK ไม่เข้า
  const sum = L.summarizeMonth({
    month: "2026-07",
    expenses: [{ id: "E1", expense_date: "2026-07-09", amount: 500, category: "ค่าน้ำมัน" }],
    jeBySource: new Map(), docDateEntries: []
  });
  assert.equal(sum.counts.expenses.NO_JV, 1);
  assert.equal(sum.problemRows.expenses.length, 1);
  assert.equal(sum.problemRows.expenses[0].cls, "NO_JV");
});

// ── (j2) 3 class ใหม่: เงินเดือนไม่เป็น NO_JV · ยอด 0 · mapping หาย (แยกจาก NO_JV) ──
test("(j2) classifyExpense: salary→EXPECTED_SKIP (ไม่ใช่ NO_JV) · <0.01→ZERO_AMOUNT · mapping หาย→MISSING_MAPPING", () => {
  const eff = EFF;
  const validKeys = new Set(["expense_fuel", "expense_rent"]); // ไม่มี expense_misc / payroll_salary
  // เงินเดือน (salary/labor_hire/payroll) → EXPECTED_SKIP_SALARY_VIA_PAYROLL — ต้องไม่เป็น NO_JV
  for (const cat of ["salary", "labor_hire", "payroll", "  Salary "]) {
    const r = L.classifyExpense({ expense_date: "2026-07-10", amount: 9000, category: cat }, null, eff, validKeys);
    assert.equal(r.cls, "EXPECTED_SKIP_SALARY_VIA_PAYROLL", `${cat} ต้องไม่เป็น NO_JV`);
  }
  // ยอด < 0.01 → ZERO_AMOUNT
  assert.equal(L.classifyExpense({ expense_date: "2026-07-10", amount: 0, category: "fuel" }, null, eff, validKeys).cls, "ZERO_AMOUNT");
  // category resolve → mappingKey ที่ไม่อยู่ใน validKeys + ไม่มี je → CURRENT_MAPPING_MISSING (≠ NO_JV)
  const mm = L.classifyExpense({ expense_date: "2026-07-10", amount: 500, category: "unknown_cat_xyz" }, null, eff, validKeys);
  assert.equal(mm.cls, "CURRENT_MAPPING_MISSING");
  assert.equal(mm.detail.mappingKey, "expense_misc");
  // category ที่ mapping ใช้ได้ (fuel→expense_fuel ∈ validKeys) แต่ไม่มี je → NO_JV (หลุดโพสต์จริง)
  assert.equal(L.classifyExpense({ expense_date: "2026-07-10", amount: 500, category: "fuel" }, null, eff, validKeys).cls, "NO_JV");
  // summarizeMonth: salary + zero ไม่เข้า problem table; MISSING_MAPPING เข้า
  const sum = L.summarizeMonth({
    month: "2026-07",
    expenses: [
      { id: "S", expense_date: "2026-07-10", amount: 9000, category: "salary" },
      { id: "Z", expense_date: "2026-07-10", amount: 0, category: "fuel" },
      { id: "M", expense_date: "2026-07-10", amount: 500, category: "unknown_cat_xyz" }
    ],
    jeBySource: new Map(), docDateEntries: [], expenseMappingKeys: validKeys
  });
  assert.equal(sum.counts.expenses.EXPECTED_SKIP_SALARY_VIA_PAYROLL, 1);
  assert.equal(sum.counts.expenses.ZERO_AMOUNT, 1);
  assert.equal(sum.counts.expenses.CURRENT_MAPPING_MISSING, 1);
  assert.equal(sum.counts.expenses.NO_JV || 0, 0, "ไม่มี expense เป็น NO_JV ในชุดนี้");
  assert.deepEqual(sum.problemRows.expenses.map(x => x.cls), ["CURRENT_MAPPING_MISSING"], "problem table เหลือแค่ CURRENT_MAPPING_MISSING");
});

// ── (j3) EXPENSE_CATEGORY_MAP ตรง auto_post.js:567-591 (กัน drift — salary keys → payroll_salary) ──
test("(j3) EXPENSE_CATEGORY_MAP: salary/labor_hire/payroll → payroll_salary + sample อื่นตรง source", () => {
  assert.equal(L.EXPENSE_CATEGORY_MAP.salary, "payroll_salary");
  assert.equal(L.EXPENSE_CATEGORY_MAP.labor_hire, "payroll_salary");
  assert.equal(L.EXPENSE_CATEGORY_MAP.payroll, "payroll_salary");
  assert.equal(L.EXPENSE_CATEGORY_MAP.fuel, "expense_fuel");
  assert.equal(L.EXPENSE_CATEGORY_MAP.rent, "expense_rent");
  assert.equal(L.EXPENSE_CATEGORY_MAP["น้ำมัน"], "expense_fuel");
});

// ── (j4) amount taxonomy: 0=ZERO(expected) · <0=INVALID_NEGATIVE · null/NaN=INVALID · subcent=SUBCENT ──
test("(j4) classifyExpense amount classes แยกกัน (ไม่กลืนยอดติดลบ)", () => {
  const eff = EFF, d = "2026-07-10";
  assert.equal(L.classifyExpense({ expense_date: d, amount: 0, category: "fuel" }, null, eff).cls, "ZERO_AMOUNT");
  assert.equal(L.classifyExpense({ expense_date: d, amount: -500, category: "fuel" }, null, eff).cls, "INVALID_NEGATIVE_AMOUNT");
  assert.equal(L.classifyExpense({ expense_date: d, amount: null, category: "fuel" }, null, eff).cls, "INVALID_AMOUNT");
  assert.equal(L.classifyExpense({ expense_date: d, amount: undefined, category: "fuel" }, null, eff).cls, "INVALID_AMOUNT");
  assert.equal(L.classifyExpense({ expense_date: d, amount: 0.005, category: "fuel" }, null, eff).cls, "SUBCENT_AMOUNT");
  // salary มาก่อน amount → salary ติดลบยังเป็น EXPECTED_SKIP (mirror auto_post skip เงินเดือนเสมอ)
  assert.equal(L.classifyExpense({ expense_date: d, amount: -500, category: "salary" }, null, eff).cls, "EXPECTED_SKIP_SALARY_VIA_PAYROLL");
  // −500 (non-salary) เข้า problem table
  const sum = L.summarizeMonth({ month: "2026-07", expenses: [{ id: "N", expense_date: d, amount: -500, category: "fuel" }], jeBySource: new Map(), docDateEntries: [] });
  assert.deepEqual(sum.problemRows.expenses.map(x => x.cls), ["INVALID_NEGATIVE_AMOUNT"]);
});

// ── (n) MANUAL_JV: source null ทั้งคู่ → informational (ไม่เข้า orphan) + manualJvGl หัก → residual 0 ──
test("(n) summarizeMonth: manual JV (source null) มี Cr 4xxx → MANUAL_JV + residual = 0", () => {
  const je = { id: "man1", source_table: null, source_id: null, doc_date: "2026-07-12", total_debit: 300 };
  const sum = L.summarizeMonth({
    month: "2026-07",
    jeBySource: new Map(),
    linesByEntry: new Map([["man1", [{ account_code: "4100", debit: 0, credit: 300 }, { account_code: "1010", debit: 300, credit: 0 }]]]),
    docDateEntries: [je]
  });
  assert.equal(sum.manualJv.length, 1);
  assert.equal(sum.orphans.length, 0, "manual JV ต้องไม่เข้า orphan");
  assert.equal(sum.revenue.gl, 300);
  assert.equal(sum.revenue.breakdown.manualJvGl, 300);
  assert.equal(sum.revenue.unexplainedResidual, 0, "manualJvGl หักออก → identity ปิด");
});

// ── (o) orphan taxonomy + data hole: one-side-null→BROKEN_SOURCE_LINK · missing→ORPHAN_SOURCE_MISSING · no lines→dataIncomplete ──
test("(o) summarizeMonth: BROKEN_SOURCE_LINK · ORPHAN_SOURCE_MISSING · dataIncomplete แยกกัน", () => {
  const jeBroken = { id: "b1", source_table: "sales", source_id: null, doc_date: "2026-07-12", total_debit: 100 };  // ข้างเดียว null + ไม่มี lines
  const jeMissing = { id: "m1", source_table: "sales", source_id: "GONE", doc_date: "2026-07-12", total_debit: 100 };
  const sum = L.summarizeMonth({
    month: "2026-07", sales: [],
    jeBySource: new Map(),
    linesByEntry: new Map([["m1", [{ account_code: "4100", debit: 0, credit: 100 }]]]),
    docDateEntries: [jeBroken, jeMissing]
  });
  assert.deepEqual(sum.orphans.map(o => o.reason).sort(), ["BROKEN_SOURCE_LINK", "ORPHAN_SOURCE_MISSING"]);
  assert.equal(sum.dataIncomplete.length, 1, "b1 ไม่มี journal_lines = data hole");
  assert.equal(sum.dataIncomplete[0].entryId, "b1");
});

// ── (k) duplicate source postings: source เดียวมี JE approved > 1 → surface ไม่กลืน ──
test("(k) summarizeMonth: jeBySource array > 1 ต่อ source → duplicateSources รายงาน (double-post)", () => {
  const je1 = { id: "je1", source_table: "sales", source_id: "X", doc_date: "2026-07-10", total_debit: 100 };
  const je2 = { id: "je2", source_table: "sales", source_id: "X", doc_date: "2026-07-10", total_debit: 100 };
  const sale = { id: "X", created_at: "2026-07-10T03:00:00Z", total_amount: 100, note: "" };
  const sum = L.summarizeMonth({
    month: "2026-07", sales: [sale],
    jeBySource: new Map([["sales:X", [je1, je2]]]),   // array 2 entries = โพสต์ซ้ำ
    linesByEntry: new Map([["je1", [{ account_code: "4100", debit: 0, credit: 100 }]], ["je2", [{ account_code: "4100", debit: 0, credit: 100 }]]]),
    docDateEntries: [je1, je2]
  });
  assert.equal(sum.duplicateSources.length, 1, "ต้องจับ 1 source ที่โพสต์ซ้ำ");
  assert.equal(sum.duplicateSources[0].count, 2);
  assert.deepEqual(sum.duplicateSources[0].entryIds, ["je1", "je2"]);
  // jeFor คืน entry แรก → classify ยังทำงาน (ไม่ crash เพราะ array)
  assert.equal(sum.counts.sales.OK, 1);
});

// ── (ii) service job non-web ปิดงานมี JV → residual ปิดเป็น 0 (identity ครบ term GL งานช่าง) ──
test("(ii) summarizeMonth: non-web service job ปิดงานมี JV → unexplainedResidual = 0", () => {
  const month = "2026-07";
  // งานช่าง (จานดาวเทียม) non-web ปิดในเดือน — dashboard ไม่นับ แต่ GL โพสต์ revenue 500
  const job = { id: "S1", created_at: "2026-07-08T03:00:00Z", closed_at: "2026-07-08T03:00:00Z", status: "closed", total_cost: 500, sub_service: "ติดตั้งจานดาวเทียม", note: "" };
  const je = { id: "jeS1", source_table: "service_jobs", source_id: "S1", doc_date: "2026-07-08", total_debit: 500 };
  const sum = L.summarizeMonth({
    month, jobs: [job],
    jeBySource: new Map([["service_jobs:S1", je]]),
    linesByEntry: new Map([["jeS1", [{ entry_id: "jeS1", account_code: "4200", debit: 0, credit: 500 }]]]),
    docDateEntries: [je]
  });
  assert.equal(sum.revenue.opDashboard, 0, "dashboard นับแค่ POS+web → 0");
  assert.equal(sum.revenue.gl, 500, "GL โพสต์ revenue งานช่าง 500");
  assert.equal(sum.revenue.breakdown.serviceNonWebGl, 500, "ต้องจับ service non-web GL 500");
  assert.equal(sum.revenue.deltaDashboardGl, -500);
  assert.equal(sum.revenue.unexplainedResidual, 0, "identity ต้องปิด (ถ้าไม่มี term นี้ residual = −500)");
});

// ══════════════════════════════════════════════════════════════
//  ส่วน 2 — READ-ONLY invariant ของ runner (อ่าน source text, ไม่ import/รัน)
// ══════════════════════════════════════════════════════════════
const runnerSrc = fs.readFileSync(path.resolve("scripts/finance_reconcile_audit.js"), "utf8");

// ── (f) ไม่มี write method + POST เฉพาะ /auth/v1/token + /rest/v1/ เป็น GET ──
test("(f) READ-ONLY: ไม่มี PATCH/PUT/DELETE, POST เฉพาะ /auth/v1/token, ทุก /rest/v1/ = GET", () => {
  // ห้ามมี write method เด็ดขาด
  for (const verb of ["PATCH", "PUT", "DELETE"]) {
    assert.doesNotMatch(runnerSrc, new RegExp(`method:\\s*["']${verb}["']`, "i"),
      `runner ต้องไม่มี method: "${verb}" (read-only)`);
  }
  // ห้ามมี upsert directive (Prefer: resolution=merge/ignore-duplicates)
  assert.doesNotMatch(runnerSrc, /resolution\s*=\s*(merge|ignore)-duplicates/i, "runner ต้องไม่ส่ง Prefer: resolution=*-duplicates (upsert)");
  // ห้ามยิง RPC ที่ mutate ตรง ๆ ผ่าน /rest/v1/rpc (audit อ่านอย่างเดียว)
  assert.doesNotMatch(runnerSrc, /\/rest\/v1\/rpc\//, "runner ต้องไม่เรียก /rest/v1/rpc/");

  // POST ทุกจุดต้องอยู่กับ /auth/v1/token เท่านั้น
  const postCount = (runnerSrc.match(/method:\s*["']POST["']/g) || []).length;
  assert.equal(postCount, 1, "ต้องมี method: 'POST' จุดเดียว");
  // จุด POST ต้องอยู่ในบล็อก signIn ที่ fetch ไป /auth/v1/token
  const signInBlock = (runnerSrc.match(/async function signIn[\s\S]*?\n}/) || [])[0] || "";
  assert.match(signInBlock, /\/auth\/v1\/token/, "POST ต้องอยู่ใน signIn ที่ยิง /auth/v1/token");
  assert.match(signInBlock, /method:\s*["']POST["']/, "signIn ต้องเป็น method POST");

  // ทุก fetch ที่ยิง /rest/v1/ ต้องระบุ method GET (มี getAll เป็นทางเข้าเดียว)
  assert.match(runnerSrc, /\/rest\/v1\/[\s\S]*?method:\s*["']GET["']/,
    "การเรียก /rest/v1/ ต้องเป็น method: 'GET'");
  // getAll (ตัวยิง REST จริง) ต้องเป็น GET
  const getAllBlock = (runnerSrc.match(/async function getAll[\s\S]*?\n}/) || [])[0] || "";
  assert.match(getAllBlock, /method:\s*["']GET["']/, "getAll ต้องยิง method GET");
});

// ── (g) มี pagination loop (limit + offset) กัน PostgREST cap 1000 เงียบ ──
test("(g) pagination: getAll มี loop offset += limit กัน cap 1000 เงียบ", () => {
  assert.match(runnerSrc, /limit=\$\{PAGE\}&offset=\$\{offset\}/, "URL ต้องมี limit + offset");
  assert.match(runnerSrc, /offset\s*\+=\s*PAGE/, "ต้องเลื่อน offset += PAGE");
  assert.match(runnerSrc, /rows\.length\s*<\s*PAGE/, "ต้อง break เมื่อหน้าสุดท้าย < PAGE");
});

// ── (h) isWebOrderJob ใน lib มี token ครบ (กัน drift จาก dashboard.js:18-22) ──
test("(h) isWebOrderJob (lib) มี token ครบตรง dashboard.js", () => {
  const libSrc = fs.readFileSync(path.resolve("scripts/finance_reconcile_lib.js"), "utf8");
  const fn = (libSrc.match(/export function isWebOrderJob[\s\S]*?\n}/) || [])[0] || "";
  assert.ok(fn, "ต้องเจอ isWebOrderJob");
  for (const tok of ["สั่งซื้อ", "SH-(transfer|cod_cash|cod_transfer)", "cancelled", "deleted_at", "[ลบแล้ว]"]) {
    assert.ok(fn.includes(tok), `isWebOrderJob ต้องมี token: ${tok}`);
  }
  // ยืนยันพฤติกรรมจริง: web order (สั่งซื้อ) ไม่ลบ ไม่ cancelled → true
  assert.equal(L.isWebOrderJob({ sub_service: "สั่งซื้อออนไลน์", status: "done", note: "" }), true);
  assert.equal(L.isWebOrderJob({ sub_service: "สั่งซื้อ", status: "cancelled", note: "" }), false);
  assert.equal(L.isWebOrderJob({ note: "SH-cod_cash|123", status: "done" }), true);
  assert.equal(L.isWebOrderJob({ sub_service: "ซ่อม", status: "done", note: "" }), false);
});

// ── (l) runner ใช้ status=eq.approved (align je_fetch.js:26) — reconcile ตัด non-approved ──
test("(l) runner กรอง JE ด้วย status=eq.approved (by-source) + แยก approved ใน doc_date", () => {
  // by-source JE query ต้องพก &status=eq.approved
  assert.match(runnerSrc, /status=eq\.approved/, "by-source JE ต้องกรอง status=eq.approved");
  // doc_date entries ต้องคัดเฉพาะ approved ก่อน rollup
  assert.match(runnerSrc, /isApproved\s*\(\s*e\.status\s*\)/, "docDateEntries ต้อง filter isApproved");
  // ต้องนับ + รายงาน non-approved (transparency)
  assert.match(runnerSrc, /nonApproved/, "ต้องมีการนับ non-approved เพื่อรายงาน");
});

// ── (m) runner ดึง account_mapping (GET) → ส่ง expenseMappingKeys เข้า lib + --strict ครอบหลายสัญญาณ ──
test("(m) runner: account_mapping mapping-keys + --strict ครอบ residual/NO_JV/mismatch/deleted/duplicate/orphan/non-approved", () => {
  assert.match(runnerSrc, /account_mapping\?select=mapping_key,debit_account_code,credit_account_code/, "ต้อง GET account_mapping (mapping_key/debit/credit)");
  assert.match(runnerSrc, /is_active=eq\.true/, "account_mapping ต้องกรอง is_active=eq.true (align _getMappings)");
  assert.match(runnerSrc, /expenseMappingKeys/, "ต้องส่ง expenseMappingKeys เข้า summarizeMonth");
  // --strict ต้องดูสัญญาณครบ ไม่ใช่ residual อย่างเดียว
  for (const sig of ["combinedResidual", "noJv", "mismatch", "dateMismatch", "deletedHasJv", "duplicateSources", "orphans", "mappingMissing", "invalidAmt", "unknownCount", "zeroCount", "itemlessCount", "partitionOk", "dataIncomplete", "nonApprovedSourceBoundCount"]) {
    assert.ok(runnerSrc.includes(sig), `strict gate ต้องอ้างสัญญาณ ${sig}`);
  }
  // Δ income_overview + combined residual ต้องพิมพ์ (ไม่ให้ผู้ใช้อ่านจาก problem table เอง)
  assert.match(runnerSrc, /deltaIncomeOverviewGl/, "runner ต้องพิมพ์ Δ income_overview − GL");
  assert.match(runnerSrc, /dashboard-basis residual/, "residual ต้อง label เป็น dashboard-basis");
  assert.match(runnerSrc, /combined income residual/, "ต้องมี combined income residual");
  // pre-effective months ต้อง gate op-vs-GL signals (กัน gate แดงถาวร) — มี pre-effective approved JE เป็น integrity signal
  assert.match(runnerSrc, /pre-effective approved JE/, "pre-effective JE ต้องเป็น strict signal");
  assert.match(runnerSrc, /if \(!preEffective\) \{/, "op-vs-GL strict signals ต้อง gate ด้วย !preEffective");
  // non-approved ต้องแยก manual vs source-bound
  assert.match(runnerSrc, /nonApprovedManual/, "ต้องแยก non-approved manual");
  assert.match(runnerSrc, /nonApprovedSourceBound/, "ต้องแยก non-approved source-bound");
});

// ── (q) itemless quick-pay: active ไม่มี item → ITEMLESS (ไม่ตี COGS 0) · deleted ไม่เข้า · itemized → GP ปกติ ──
test("(q) summarizeMonth: itemless sale = cost unknown (แยกจาก known GP, ไม่ใช่ COGS 0)", () => {
  const month = "2026-07", d = "2026-07-15T03:00:00Z";
  const activeQuick = { id: "Q1", order_no: "BSK-1", created_at: d, total_amount: 100, gross_profit: null, note: "" };
  const deletedQuick = { id: "Q2", order_no: "BSK-2", created_at: d, total_amount: 200, gross_profit: null, note: "[ลบแล้ว]" };
  const itemized = { id: "I1", order_no: "BSK-3", created_at: d, total_amount: 500, gross_profit: 300, note: "" };
  const saleItems = [{ sale_id: "I1", qty: 2, unit_cost: 100, product_id: "p1" }];   // knownCogs 200
  const sum = L.summarizeMonth({ month, sales: [activeQuick, deletedQuick, itemized], saleItems, jeBySource: new Map(), docDateEntries: [] });
  const G = sum.grossProfit;
  // itemless เฉพาะ active quick-pay Q1 — deleted Q2 ถูกกรอง (posInMonth), itemized I1 complete
  assert.equal(G.itemlessCount, 1);
  assert.equal(G.itemlessRevenue, 100);
  assert.deepEqual(G.itemlessRows.map(r => r.id), ["Q1"]);
  assert.equal(G.itemlessRows[0].cls, "ITEMLESS_SALE_COST_UNKNOWN");
  // complete bill I1 (unit_cost 100>0 ทุกแถว): revenue 500 − COGS 200 = known GP 300
  assert.equal(G.completeBillCount, 1);
  assert.equal(G.completeRevenue, 500);
  assert.equal(G.completeCogs, 200);
  assert.equal(G.completeGp, 300, "quick-pay 100 ต้องไม่ถูกนับเป็นกำไร (เดิม strict=400 ผิด)");
  // partition: complete 500 + incomplete 0 + itemless 100 = opPos 600
  assert.equal(G.partitionOk, true);
  assert.equal(G.partitionSum, 600);
});

// ── (r) GP 3 ฐาน: complete vs incomplete (null/zero) → null/0 ห้ามกลายเป็น COGS 0 + partition ครบ ──
test("(r) summarizeMonth GP: complete/incomplete(null)/incomplete(zero) แยกกัน + partition identity", () => {
  const month = "2026-07", d = "2026-07-15T03:00:00Z";
  const complete = { id: "C", order_no: "C1", created_at: d, total_amount: 300, gross_profit: 100, note: "" };
  const withNull = { id: "N", order_no: "N1", created_at: d, total_amount: 200, gross_profit: null, note: "" };
  const withZero = { id: "Z", order_no: "Z1", created_at: d, total_amount: 150, gross_profit: null, note: "" };
  const saleItems = [
    { sale_id: "C", qty: 2, unit_cost: 100 },                 // complete → cogs 200
    { sale_id: "N", qty: 1, unit_cost: null },                // null row → incomplete
    { sale_id: "N", qty: 1, unit_cost: 50 },                  // มี cost row ปน แต่บิลยังถือ incomplete
    { sale_id: "Z", qty: 3, unit_cost: 0 }                    // zero row → incomplete
  ];
  const sum = L.summarizeMonth({ month, sales: [complete, withNull, withZero], saleItems, jeBySource: new Map(), docDateEntries: [] });
  const G = sum.grossProfit;
  // A) complete: บิล C เท่านั้น → GP 300 − 200 = 100
  assert.equal(G.completeBillCount, 1);
  assert.equal(G.completeGp, 100);
  // B) incomplete: บิล N (null) + Z (zero) → ไม่ประกาศ GP, revenue 200+150=350, null-rows 1, zero-rows 1
  assert.equal(G.incompleteBillCount, 2);
  assert.equal(G.incompleteRevenue, 350);
  assert.equal(G.incompleteNullRows, 1);
  assert.equal(G.incompleteZeroRows, 1);
  // null/0 ห้ามกลายเป็นกำไร — บิล N มี cost row 50 แต่ทั้งบิลไม่เข้า completeCogs
  assert.equal(G.completeCogs, 200, "cost ของบิล incomplete ต้องไม่เข้า completeCogs");
  // partition: 300 + 350 + 0(itemless) = opPos 650
  assert.equal(G.partitionOk, true);
  assert.equal(G.partitionSum, 650);
});

// ── (s) B1: dashboard residual 0 แต่ income_overview − GL = service NO_JV (ไม่หมกเม็ด) ──
test("(s) dashboard residual 0 แต่ income delta = service NO_JV → income-basis residual ปิด 0", () => {
  const month = "2026-07";
  // POS sale จับคู่ JE ตรง → dashboard−GL = 0
  const sale = { id: "P", order_no: "P1", created_at: "2026-07-10T03:00:00Z", total_amount: 100, vat_amount: 0, gross_profit: 40, note: "" };
  const jeSale = { id: "jeP", source_table: "sales", source_id: "P", doc_date: "2026-07-10", total_debit: 100 };
  // service job non-web closed ในเดือน income แต่ไม่มี JE → service NO_JV 6950
  const svc = { id: "SV", job_no: "SV1", created_at: "2026-07-05T03:00:00Z", closed_at: "2026-07-20T03:00:00Z", status: "closed", total_cost: 6950, sub_service: "ติดตั้งจานดาวเทียม", note: "" };
  const sum = L.summarizeMonth({
    month, sales: [sale], jobs: [svc],
    jeBySource: new Map([["sales:P", jeSale]]),
    linesByEntry: new Map([["jeP", [{ account_code: "4100", debit: 0, credit: 100 }]]]),
    docDateEntries: [jeSale]
  });
  // dashboard (POS+web) reconcile → residual 0 (service ไม่อยู่ทั้ง dashboard และ GL)
  assert.equal(sum.revenue.unexplainedResidual, 0, "dashboard-basis residual ต้อง 0");
  // income_overview − GL = service operational 6950 (opIncomeOverview 100+6950=7050, GL 100)
  assert.equal(sum.revenue.deltaIncomeOverviewGl, 6950);
  const IR = sum.incomeReconcile;
  assert.equal(IR.serviceOperational, 6950);
  assert.equal(IR.serviceGlPosted, 0);
  assert.equal(IR.deltaServiceOpGl, 6950);
  assert.equal(IR.serviceNoJv, 6950);
  assert.equal(IR.serviceNoJvCount, 1);
  assert.equal(IR.serviceIncomeResidual, 0, "แตกครบ (NO_JV) → service-dimension residual 0");
  assert.equal(IR.combinedResidual, 0, "combined = dashboard 0 + service 0 = 0");
});

// ── (t) pre-effective service (ปิดก่อน effective) ไม่มี JV → expected-unposted ไม่ใช่ NO_JV ──
test("(t) pre-effective service → PRE_EFFECTIVE_EXPECTED_UNPOSTED (ไม่ใช่ NO_JV) → service residual 0", () => {
  const month = "2026-06";  // effective = 2026-07-01
  const svc = { id: "SV", job_no: "SV1", created_at: "2026-06-01T03:00:00Z", closed_at: "2026-06-20T03:00:00Z", status: "closed", total_cost: 5000, sub_service: "จาน", note: "" };
  const sum = L.summarizeMonth({ month, jobs: [svc], jeBySource: new Map(), docDateEntries: [] });
  const IR = sum.incomeReconcile;
  assert.equal(IR.serviceNoJv, 0, "pre-effective ต้องไม่นับเป็น NO_JV");
  assert.equal(IR.serviceNoJvCount, 0);
  assert.equal(IR.preEffExpectedUnposted, 5000);
  assert.equal(IR.preEffExpectedUnpostedCount, 1);
  assert.equal(IR.serviceIncomeResidual, 0, "residual = Δ − (…+ expected-unposted) = 0");
});

// ── (u) combined residual = dashboard-basis + service-dimension (มิ.ย.-like: dashboard 19460 + service 0) ──
test("(u) combined residual = dashboard + service; มิ.ย. pre-effective POS 19460 + service 0 = 19460", () => {
  const month = "2026-06";
  const sale = { id: "S", order_no: "S1", created_at: "2026-06-15T03:00:00Z", total_amount: 19460, gross_profit: null, note: "" };
  const svc = { id: "SV", job_no: "SV1", created_at: "2026-06-01T03:00:00Z", closed_at: "2026-06-20T03:00:00Z", status: "closed", total_cost: 5000, sub_service: "จาน", note: "" };
  const sum = L.summarizeMonth({ month, sales: [sale], jobs: [svc], jeBySource: new Map(), docDateEntries: [] });
  // June pre-effective: sale = PRE_EFFECTIVE (ไม่ใช่ NO_JV) → dashboard residual = opPos 19460 − GL 0
  assert.equal(sum.revenue.unexplainedResidual, 19460, "dashboard-basis residual");
  assert.equal(sum.incomeReconcile.serviceIncomeResidual, 0);
  assert.equal(sum.incomeReconcile.combinedResidual, 19460, "combined = 19460 + 0");
});

// ── (v) service mismatch ใช้ entryRevenue (revenue line 100) ไม่ใช่ total_debit (107 = มี VAT split) ──
test("(v) service mismatch ฐาน entryRevenue: JE debit 107 / revenue 100, op 100 → ไม่ mismatch", () => {
  const month = "2026-07";
  const svc = { id: "SV", job_no: "SV1", created_at: "2026-07-05T03:00:00Z", closed_at: "2026-07-10T03:00:00Z", status: "closed", total_cost: 100, sub_service: "จาน", note: "" };
  const je = { id: "jeSV", source_table: "service_jobs", source_id: "SV", doc_date: "2026-07-10", total_debit: 107 };
  const sum = L.summarizeMonth({
    month, jobs: [svc],
    jeBySource: new Map([["service_jobs:SV", je]]),
    linesByEntry: new Map([["jeSV", [{ account_code: "4200", debit: 0, credit: 100 }, { account_code: "2170", debit: 0, credit: 7 }, { account_code: "1010", debit: 107, credit: 0 }]]]),
    docDateEntries: [je]
  });
  const IR = sum.incomeReconcile;
  assert.equal(IR.serviceGlPosted, 100, "serviceGlPosted = entryRevenue 100 (ไม่ใช่ total_debit 107)");
  assert.equal(IR.serviceMismatchCount, 0, "op 100 = revenue 100 → ไม่ mismatch (ถ้าใช้ total_debit 107 จะ false mismatch)");
  assert.equal(IR.serviceIncomeResidual, 0);
});

// ── (p) runner ต้องไม่ select service_jobs.deleted_at (production ไม่มีคอลัมน์ → PG 42703/400) ──
test("(p) runner ไม่ query service_jobs.deleted_at + isServiceDeleted ยังจับ [ลบแล้ว]", () => {
  // ทุก select ที่ยิง service_jobs ต้องไม่มี deleted_at
  const sjSelects = runnerSrc.match(/service_jobs\?select=[^`&]*/g) || [];
  const sjConst = runnerSrc.match(/SJ_SELECT\s*=\s*["'][^"']*["']/g) || [];
  for (const s of [...sjSelects, ...sjConst]) {
    assert.doesNotMatch(s, /deleted_at/, `service_jobs select ต้องไม่มี deleted_at: ${s}`);
  }
  // production soft-delete truth = note "[ลบแล้ว]" → classify เป็น DELETED แม้ไม่มีคอลัมน์ deleted_at
  const delJob = { id: "X", status: "cancelled", total_cost: 100, closed_at: "2026-07-10T03:00:00Z", note: "ยกเลิก [ลบแล้ว]" };
  const del = L.classifyServiceJob(delJob, { total_debit: 100, doc_date: "2026-07-10" });
  assert.equal(del.cls, "DELETED_HAS_JV", "[ลบแล้ว] + มี JV → DELETED_HAS_JV (ไม่พึ่ง deleted_at)");
  const delNoJe = L.classifyServiceJob(delJob, null);
  assert.equal(delNoJe.cls, "DELETED_OK", "[ลบแล้ว] ไม่มี JV → DELETED_OK");
});
