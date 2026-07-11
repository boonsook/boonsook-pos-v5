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
