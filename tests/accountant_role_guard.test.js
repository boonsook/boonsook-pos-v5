// Phase 444 — accountant role access guard
// Run: node --test tests/accountant_role_guard.test.js
//
// Contract:
//   "พนักงานบัญชี" should reach finance/accounting/reporting and related sales documents,
//   but must not get POS, operational warehouse/product screens, service execution, HR admin,
//   or settings/user management.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const usersJs = fs.readFileSync(path.resolve("modules/settings/users.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");

const ROLE_PAGES_SRC = (() => {
  const i = mainJs.indexOf("const ROLE_PAGES");
  assert.ok(i > -1, "ROLE_PAGES must exist");
  return mainJs.slice(i, mainJs.indexOf("\n};", i) + 3);
})();

function roleRoutes(role) {
  const m = ROLE_PAGES_SRC.match(new RegExp(role + ":\\s*\\[([^\\]]*)\\]"));
  assert.ok(m, role + " array must exist in ROLE_PAGES");
  return m[1];
}

function assertIncludes(routes, route) {
  assert.ok(routes.includes(`"${route}"`), `accountant must reach "${route}"`);
}

function assertExcludes(routes, route) {
  assert.ok(!routes.includes(`"${route}"`), `accountant must NOT reach "${route}"`);
}

test("accountant ROLE_PAGES includes finance/accounting/reporting document work", () => {
  const accountant = roleRoutes("accountant");
  for (const r of [
    "dashboard",
    "sales",
    "delivery_invoices",
    "receipts",
    "customers",
    "quotations",
    "quote_templates",
    "expenses",
    "profit_report",
    "stock_value",
    "cash_recon",
    "top_customers",
    "sales_heatmap",
    "recurring_expenses",
    "credit_tracker",
    "refunds",
    "profit_by_product",
    "expense_overview",
    "income_overview",
    "payroll",
    "payroll_overview",
    "accounting_journals",
    "accounting_journal_new",
    "accounting_coa",
    "accounting_backfill",
    "accounting_trial_balance",
    "accounting_profit_loss",
    "accounting_balance_sheet",
    "accounting_opening_balance",
    "accounting_export_bundle",
    "accounting_periods",
    "stock_reconcile_report",
    "service_reconcile",
  ]) {
    assertIncludes(accountant, r);
  }
});

test("accountant ROLE_PAGES excludes operational/admin screens", () => {
  const accountant = roleRoutes("accountant");
  for (const r of [
    "pos",
    "products",
    "wh_kunkhao",
    "wh_kundaeng",
    "wh_sikhon",
    "stock_movements",
    "stock_count",
    "stock_in_wizard",
    "dead_stock",
    "service_jobs",
    "settings",
    "tasks",
    "calendar",
    "time_clock",
    "leave_management",
    "hr_overview",
    "hr_applications",
    "hr_resignations",
    "departments",
    "audit_log",
  ]) {
    assertExcludes(accountant, r);
  }
});

test("accountant role is selectable and labelled in user management", () => {
  assert.match(mainJs, /accountant:\s*"พนักงานบัญชี"/, "ROLE_LABELS must include Thai accountant label");
  assert.match(usersJs, /accountant:\s*"#7c3aed"/, "settings user cards must have accountant color");
  assert.match(usersJs, /<option value="accountant"[^>]*>พนักงานบัญชี<\/option>/,
    "existing-user role dropdown must include accountant");
  assert.match(indexHtml, /<option value="accountant">พนักงานบัญชี<\/option>/,
    "new-user invitation dropdown must include accountant");
});

