// Financial cancelled-document guard.
// Cancelled sales/documents must not inflate report totals or customer-facing history.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("shared sales visibility helper excludes status=cancelled", () => {
  const src = read("modules/utils.js");
  assert.match(src, /String\(s\.status \|\| ""\)\.toLowerCase\(\)\s*===\s*["']cancelled["']/);
});

test("financial report modules use visibleSalesForRole before summing sale totals", () => {
  for (const file of [
    "modules/dashboard.js",
    "modules/pos.js",
    "modules/profit_report.js",
    "modules/income_overview.js",
    "modules/top_customers.js",
    "modules/sales_heatmap.js",
    "modules/credit_tracker.js",
    "modules/expenses.js",
    "modules/profit_by_product.js",
  ]) {
    const src = read(file);
    assert.match(src, /visibleSalesForRole\(/, `${file} must use the shared cancelled/deleted sales filter`);
  }
});

test("main sale lookup surfaces use shared cancelled/deleted sales filter", () => {
  const src = read("main.js");
  assert.match(src, /import \{ visibleSalesForRole \} from "\.\/modules\/utils\.js";/);
  assert.match(src, /const visibleSales = visibleSalesForRole\(state\.sales, state\.profile, state\.currentUser\);/);
  assert.match(src, /const sale = visibleSales\.find\(s => String\(s\.id\) === String\(it\.sale_id\)\);/);
  const directSalesLists = src.match(/const sales = visibleSalesForRole\(state\.sales, state\.profile, state\.currentUser\)/g) || [];
  assert.ok(directSalesLists.length >= 2, "customer purchase history and global search must use shared filter");
});

test("cash reconciliation excludes cancelled sales before cash/transfer split", () => {
  const src = read("modules/cash_recon.js");
  assert.match(src, /String\(s\.status \|\| ""\)\.toLowerCase\(\)\s*!==\s*["']cancelled["']/);
  assert.ok(src.indexOf("status ||") < src.indexOf("cashSales = sales.filter"), "status exclusion must happen before payment split");
});

// ★ Phase 606-b2c (build 605): งานบริการของลูกค้าย้ายไปอ่านผ่าน service-role proxy
// (/api/v1/customer-service-jobs) เพราะ RLS 505 deny ฝั่ง client — การกรอง cancelled จึงย้ายไป
// อยู่ที่ server; แท็บประวัติซื้อไม่อ่าน state แล้ว (honest unavailable state) → ตัวนับฝั่ง client
// ไม่ใช่หลักฐานอีกต่อไป. invariant เดิม "ลูกค้าต้องไม่เห็นงาน/บิลที่ถูกยกเลิก" ยังคงเดิม แต่พิสูจน์
// ที่ผู้กรองจริงทั้งสองฝั่ง.
test("customer dashboard hides cancelled sales and service/order history", () => {
  const proxy = read("functions/api/v1/customer-service-jobs.js");
  assert.match(proxy, /String\(row\?\.status \|\| ""\)\.toLowerCase\(\) === "cancelled"/,
    "proxy ต้องกรอง cancelled ฝั่ง server ก่อนคืนงานให้ลูกค้า");
  const src = read("modules/customer_dashboard.js");
  assert.ok(!/state\.serviceJobs|state\.sales/.test(src.replace(/^[ \t]*\/\/.*$/gm, "")),
    "หน้าลูกค้าต้องไม่สรุปงาน/บิลจาก state โดยตรงอีก (ว่างเสมอเพราะ RLS = false empty)");
});
