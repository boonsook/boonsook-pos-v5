// build 597 — profit_report รวมรายได้งานบริการ (นิยามเดียวกับ dashboard/income_overview)
//
// Why: หน้ารายงานกำไรนับรายได้จาก sales (POS) เท่านั้น แต่รายจ่ายรวมงานช่าง → กำไรสุทธิติดลบเกินจริง
//   + นิยามไม่ตรง income_overview/dashboard ที่รวมงานบริการแล้ว. แก้: ดึง service jobs ขนาน +
//   คิดรายได้บริการด้วย single source เดิม (sumServiceJobIncome) ไม่คิดสูตรเอง (กัน drift).
// Run: node --test tests/profit_report_service_income_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeNetProfit } from "../modules/profit_report.js";

const src = fs.readFileSync(path.resolve("modules/profit_report.js"), "utf8");

// ── (a) unit: สูตร netProfit = กำไรขั้นต้น(POS) + รายได้บริการ − ค่าใช้จ่าย ──
test("(a) computeNetProfit = grossProfit + serviceIncome − totalExpenses", () => {
  assert.equal(computeNetProfit(1000, 49200, 60000), 1000 + 49200 - 60000);   // -9800
  // รายได้บริการดันกำไรสุทธิให้สมเหตุผลขึ้น (เทียบกับไม่รวม service = 1000-60000 = -59000)
  assert.equal(computeNetProfit(1000, 0, 60000), -59000, "ไม่รวม service = ติดลบหนัก (บั๊กเดิม)");
  assert.ok(computeNetProfit(1000, 49200, 60000) > computeNetProfit(1000, 0, 60000), "รวม service → กำไรสุทธิสูงขึ้น");
  assert.equal(computeNetProfit(0, 0, 0), 0);
  // guard ตัวเลขเพี้ยน/undefined → 0 (ไม่ NaN)
  assert.equal(computeNetProfit(undefined, null, "x"), 0, "input เพี้ยน → 0 ไม่ NaN");
});

// ── (b) source: ใช้ single source (import + Promise.all) ไม่คิดสูตร service เอง ──
test("(b) import sumServiceJobIncome/serviceIncomeDate จาก dashboard.js + fetchServiceJobsSince ใน Promise.all", () => {
  assert.match(src, /import\s*\{[^}]*sumServiceJobIncome[^}]*serviceIncomeDate[^}]*\}\s*from\s*["']\.\/dashboard\.js["']/,
    "ต้อง import sumServiceJobIncome + serviceIncomeDate จาก dashboard.js (single source)");
  assert.match(src, /import\s*\{[^}]*fetchServiceJobsSince[^}]*\}\s*from\s*["']\.\/range_fetch\.js["']/,
    "ต้อง import fetchServiceJobsSince จาก range_fetch.js");
  assert.match(src, /Promise\.all\(\[[^\]]*fetchServiceJobsSince\(fromDate\)[^\]]*\]\)/,
    "fetchServiceJobsSince ต้องอยู่ใน Promise.all (ดึงขนาน sales/expenses)");
  // รายได้บริการต้องมาจาก sumServiceJobIncome (ไม่ reduce/คิดสูตรเอง)
  assert.match(src, /serviceIncome\s*=\s*sumServiceJobIncome\(/, "serviceIncome ต้องใช้ sumServiceJobIncome (ไม่คิดสูตรเอง)");
  assert.match(src, /computeNetProfit\(\s*grossProfit\s*,\s*serviceIncome\s*,\s*totalExpenses\s*\)/,
    "netProfit ต้องผ่าน computeNetProfit(gross, service, expenses)");
  // ต้องไม่ reimplement isServiceIncomeJob / สูตรงานบริการเอง
  assert.ok(!/function\s+isServiceIncomeJob/.test(src), "ต้องไม่ reimplement isServiceIncomeJob ในไฟล์นี้");
});

// ── (c) fallback: service fetch fail → state.serviceJobs + warn (ไม่เงียบ) ──
test("(c) service fetch fail → fallback state.serviceJobs + toast warn (pattern เดียวกับ expenses)", () => {
  assert.match(src, /_svcRes\.ok\s*\?\s*_svcRes\.rows\s*:\s*\(state\.serviceJobs\s*\|\|\s*\[\]\)/,
    "svc fail → fallback state.serviceJobs || []");
  assert.match(src, /if\s*\(\s*!_svcRes\.ok\s*\)\s*showToast\([\s\S]*?"warn"\)/,
    "svc fail → showToast(..., \"warn\") ไม่เงียบ");
});
