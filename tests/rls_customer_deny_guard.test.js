// Phase 505 — RLS restrictive deny customer OTP (audit B3) guard
// Run: node --test tests/rls_customer_deny_guard.test.js
//
// Source-regex guard บนไฟล์ migration supabase-phase505-rls-customer-deny.sql.
// ล็อก invariant: ทุก deny policy ต้องผ่าน helper is_customer_role() (ไม่มี USING(true)
// สำหรับ customer), เป็น RESTRICTIVE, deny-list ครบ, และ GROUP B (service_jobs/customers)
// ยังเปิด INSERT ของลูกค้า (WITH CHECK true) ไม่งั้น signup/สั่งงานพัง.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SQL = fs.readFileSync(
  path.resolve("supabase-phase505-rls-customer-deny.sql"),
  "utf8"
);

function arrayLiteral(varName) {
  const m = SQL.match(new RegExp(varName + "\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]", "m"));
  assert.ok(m, `${varName} array literal must exist`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

const GROUP_A = arrayLiteral("group_a");
const GROUP_B = arrayLiteral("group_b");

test("helper is_customer_role() reads BOTH profiles.role and auth.users metadata", () => {
  const i = SQL.indexOf("FUNCTION public.is_customer_role()");
  assert.ok(i > -1, "is_customer_role() must be defined");
  const body = SQL.slice(i, SQL.indexOf("$$", SQL.indexOf("$$", i) + 2));
  assert.match(body, /FROM public\.profiles WHERE id = auth\.uid\(\)\)\s*=\s*'customer'/,
    "must check profiles.role = 'customer'");
  assert.match(body, /raw_user_meta_data->>'role'[\s\S]*=\s*'customer'/,
    "must check auth.users metadata role = 'customer'");
});

test("helper is hardened: SECURITY DEFINER + STABLE + search_path + GRANT authenticated", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.is_customer_role\(\)/);
  assert.match(SQL, /SECURITY DEFINER/);
  assert.match(SQL, /\bSTABLE\b/);
  assert.match(SQL, /SET search_path = public/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.is_customer_role\(\) TO authenticated/);
});

test("every deny policy is RESTRICTIVE and USING goes through the helper (never USING(true))", () => {
  assert.match(SQL, /AS RESTRICTIVE FOR ALL TO authenticated/,
    "deny policies must be RESTRICTIVE FOR ALL");
  assert.match(SQL, /USING \(NOT COALESCE\(public\.is_customer_role\(\), false\)\)/,
    "USING must be NOT COALESCE(is_customer_role(), false)");
  // ห้ามมี permissive USING(true) ใหม่หลุดเข้ามาในไฟล์นี้ (จะเปิดช่อง customer)
  assert.ok(!/USING \(true\)/.test(SQL),
    "migration must NOT introduce any USING (true)");
});

test("GROUP A uses deny WITH CHECK (block customer write)", () => {
  assert.match(SQL, /WITH CHECK \(NOT COALESCE\(public\.is_customer_role\(\), false\)\)/,
    "GROUP A WITH CHECK must deny customer insert/update");
});

test("GROUP B (service_jobs, customers) keeps WITH CHECK (true) so customer INSERT still works", () => {
  // exception ที่ตั้งใจ — assert ชัด ไม่ให้ false-positive ว่า WITH CHECK(true) ผิดทั้งไฟล์
  assert.match(SQL, /WITH CHECK \(true\)/,
    "GROUP B must keep WITH CHECK (true) for customer INSERT (signup + service order)");
  for (const t of ["service_jobs", "customers"]) {
    assert.ok(GROUP_B.includes(t), `GROUP B must include ${t}`);
    assert.ok(!GROUP_A.includes(t),
      `${t} must NOT be in GROUP A (full deny) — would break customer INSERT`);
  }
});

test("deny-list (GROUP A) covers the sensitive business tables", () => {
  const required = [
    "staff", "sales", "sale_items", "expenses", "stock_movements",
    "warehouse_stock", "warehouses", "products", "credit_payments", "refunds",
    "receipts", "receipt_items", "quotations", "quotation_items",
    "delivery_invoices", "delivery_invoice_items", "loyalty_points",
    "product_serials", "product_bundles", "recurring_expenses", "tasks",
    "quote_templates", "app_settings",
    "journal_entries", "journal_lines", "chart_of_accounts", "accounting_periods",
    "staff_payroll",
    // +4 จาก STEP 0-A live cross-check (ล็อกห้ามหลุด — staff_sessions เปิด FOR ALL true)
    "line_notify_settings", "loyalty_settings", "permissions", "staff_sessions",
  ];
  for (const t of required) {
    assert.ok(GROUP_A.includes(t), `GROUP A deny-list must include "${t}"`);
  }
});

test("GROUP C — profiles is self-scoped (customer sees only own row), not deny-all/insert-any", () => {
  const i = SQL.indexOf('CREATE POLICY "deny_customer_profiles"');
  assert.ok(i > -1, "must add a deny_customer_profiles policy");
  const block = SQL.slice(i, i + 400);
  assert.match(block, /AS RESTRICTIVE FOR ALL TO authenticated/,
    "profiles policy must be RESTRICTIVE");
  // self-scope ทั้ง USING และ WITH CHECK = (NOT customer) OR own row — ไม่ใช่ deny-all, ไม่ใช่ true
  assert.match(block, /USING\s*\(NOT COALESCE\(public\.is_customer_role\(\), false\) OR id = auth\.uid\(\)\)/,
    "profiles USING must allow own row (id = auth.uid()) — else login falls back to role='sales'");
  assert.match(block, /WITH CHECK\s*\(NOT COALESCE\(public\.is_customer_role\(\), false\) OR id = auth\.uid\(\)\)/,
    "profiles WITH CHECK must be self-scoped (NOT WITH CHECK(true)) so customer can't insert a fake-role profile");
  // profiles ต้องไม่อยู่ใน group_a (deny เต็ม → login พัง) หรือ group_b (WITH CHECK true → role spoof)
  assert.ok(!GROUP_A.includes("profiles"), "profiles must NOT be in GROUP A (full deny breaks login)");
  assert.ok(!GROUP_B.includes("profiles"), "profiles must NOT be in GROUP B (WITH CHECK(true) allows role spoof)");
});

test("policy creation is guarded by to_regclass (missing table => skip, not error)", () => {
  assert.match(SQL, /to_regclass\('public\.' \|\| t\) IS NOT NULL/,
    "must guard CREATE POLICY with to_regclass so absent tables are skipped");
});

test("migration ends by reloading PostgREST schema cache", () => {
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';/,
    "must NOTIFY pgrst at the end");
});
