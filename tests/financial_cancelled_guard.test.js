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

test("customer dashboard hides cancelled sales and service/order history", () => {
  const src = read("modules/customer_dashboard.js");
  const statusChecks = src.match(/String\([^)]+?\.status \|\| ""\)\.toLowerCase\(\)\s*!==\s*["']cancelled["']/g) || [];
  assert.ok(statusChecks.length >= 3, "must exclude cancelled myOrders, myServiceJobs, and mySales");
});
