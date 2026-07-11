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
  assert.equal(sum.orphans[0].reason, "source-deleted");
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
