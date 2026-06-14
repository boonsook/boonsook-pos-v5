// Phase 438 — customer group field guard
// Run: node --test tests/customer_group_guard.test.js
//
// Why this exists:
//   Owner wants customers classified by group (ราชการ / ขาย POS / งานช่าง /
//   หน้าร้าน / ขายพร้อมติดตั้ง) so receipts can auto-fill the correct receiving
//   bank account (Phase 439+), preventing wrong-transfer-account mistakes.
//   Phase 438 lays the foundation only: a nullable customer_group column + a
//   dropdown in the customer drawer + a list filter/badge — NO money/stock/
//   accounting path touched. These guards lock the wiring (column stays
//   queryable & additive, the form saves & loads the field, the 5 groups stay
//   in sync) and confirm the list filter never mutates shared state.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sql       = fs.readFileSync(path.resolve("supabase-phase438-customer-group.sql"), "utf8");
// strip line comments so explanatory prose (e.g. "no CHECK (...)") can't trip structural assertions
const sqlCode   = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
const html      = fs.readFileSync(path.resolve("index.html"), "utf8");
const mainjs    = fs.readFileSync(path.resolve("main.js"), "utf8");
const customers = fs.readFileSync(path.resolve("modules/customers.js"), "utf8");

const GROUPS = ["ราชการ", "ขาย POS", "งานช่าง", "หน้าร้าน", "ขายพร้อมติดตั้ง"];

// ── 1. SQL: additive nullable column, idempotent, schema reload ──────────────
test("SQL adds customers.customer_group (nullable, idempotent, notifies pgrst)", () => {
  assert.match(sqlCode, /ALTER TABLE customers\s+ADD COLUMN IF NOT EXISTS customer_group text/,
    "must add nullable customer_group column with IF NOT EXISTS (re-run safe)");
  assert.ok(!/NOT NULL/i.test(sqlCode),
    "column must stay nullable (existing customers = NULL)");
  assert.ok(!/ADD\s+CONSTRAINT|CHECK\s*\(/i.test(sqlCode),
    "no CHECK constraint — group values controlled by UI dropdown, future-flexible");
  assert.match(sqlCode, /NOTIFY pgrst, 'reload schema'/,
    "must reload PostgREST schema (prevents PGRST204 right after migration)");
});

// ── 2. index.html: dropdown with the 5 groups + empty option ─────────────────
test("customer drawer has a customerGroup select with all 5 groups + empty option", () => {
  assert.match(html, /<select id="customerGroup"/, "customerGroup <select> must exist in the drawer");
  assert.match(html, /<option value="">[^<]*<\/option>/, "must offer an empty (ไม่ระบุ) option");
  for (const g of GROUPS) {
    assert.ok(html.includes(`<option value="${g}">`), `dropdown must include group option "${g}"`);
  }
});

// ── 3. main.js: customer form loads + saves customer_group ───────────────────
test("openCustomerDrawer loads customer.customer_group into the select", () => {
  assert.match(mainjs, /customerGroup"\)\.value\s*=\s*customer\?\.customer_group/,
    "openCustomerDrawer must populate #customerGroup from customer.customer_group");
});

test("saveCustomer payload includes customer_group (null when unset)", () => {
  assert.match(mainjs, /customer_group:\s*\$\("customerGroup"\)\?\.value\s*\|\|\s*null/,
    "saveCustomer must send customer_group");
});

// ── 4. customers.js: groups constant, list filter, badge, no state mutation ──
test("customers.js defines exactly the 5 agreed customer groups", () => {
  assert.match(customers, /const CUSTOMER_GROUPS\s*=\s*\[/, "CUSTOMER_GROUPS constant must exist");
  for (const g of GROUPS) {
    assert.ok(customers.includes(`"${g}"`), `CUSTOMER_GROUPS must include "${g}"`);
  }
});

test("customers.js renders a group filter and a per-row group badge", () => {
  assert.match(customers, /id="contactGroupFilter"/, "list must render a group filter <select>");
  assert.match(customers, /c\.customer_group/, "row render must show the group badge from c.customer_group");
});

test("group filter narrows the cloned 'filtered' array, never mutates state.customers", () => {
  assert.match(customers, /filtered\s*=\s*\[\s*\.\.\.\(state\.customers/,
    "filtered must be a clone of state.customers");
  assert.match(customers, /filtered\s*=\s*[\s\S]*?filtered\.filter\(c\s*=>\s*c\.customer_group/,
    "group filter must derive from filtered.filter on customer_group");
  assert.ok(!/state\.customers\s*=\s*state\.customers\.(filter|sort|splice)/.test(customers),
    "must never reassign/mutate state.customers in place");
});
