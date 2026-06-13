// Phase 434 — technician stock access + cost-hidden guard
// Run: node --test tests/technician_stock_access_guard.test.js
//
// Why this exists:
//   Owner granted role "ช่าง" (technician) access to สินค้า/คลัง so they can
//   withdraw stock onto trucks (เบิกขึ้นรถ) and cut stock (ตัดสต็อก) themselves —
//   but technicians MUST NOT see cost (ต้นทุน). These guards lock that contract:
//     1. technician ROLE_PAGES includes the cost-free stock pages,
//     2. technician ROLE_PAGES excludes the cost-exposing pages (รับเข้า/มูลค่า),
//     3. products.js gates every cost/manage surface to admin+sales only,
//     4. the non-functional permission matrix page stays hidden/neutralised.
//   Source-level checks (same pattern as the other *_guard tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const productsJs = fs.readFileSync(path.resolve("modules/products.js"), "utf8");
const menuJs = fs.readFileSync(path.resolve("modules/settings/menu.js"), "utf8");
const permJs = fs.readFileSync(path.resolve("modules/settings/permissions.js"), "utf8");

// Isolate the ROLE_PAGES object first — "sales"/"products" also appear as keys in
// LAZY_ROUTES, so we must not match those by accident.
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
const technicianRoutes = () => roleRoutes("technician");

// ── 1. technician gains the cost-free stock pages ────────────────────────────
test("technician ROLE_PAGES includes stock pages for เบิก/ตัด (cost-free)", () => {
  const tech = technicianRoutes();
  for (const r of ["products", "wh_kunkhao", "wh_kundaeng", "wh_sikhon", "stock_movements", "stock_count"]) {
    assert.ok(tech.includes(`"${r}"`), `technician must be able to reach "${r}"`);
  }
});

// ── 2. technician must NOT reach cost-exposing pages ─────────────────────────
test("technician ROLE_PAGES excludes cost-exposing stock pages", () => {
  const tech = technicianRoutes();
  for (const r of ["stock_in_wizard", "stock_value", "dead_stock"]) {
    assert.ok(!tech.includes(`"${r}"`), `technician must NOT reach "${r}" (exposes ต้นทุน/มูลค่า)`);
  }
});

// ── sales access is unchanged (still full stock + cost) ──────────────────────
test("sales ROLE_PAGES still includes products + stock_in_wizard + stock_value", () => {
  const sales = roleRoutes("sales");
  for (const r of ["products", "stock_in_wizard", "stock_value"]) {
    assert.ok(sales.includes(`"${r}"`), `sales must keep "${r}"`);
  }
});

// ── 3. products.js hides cost/manage surfaces from technician ────────────────
test("products.js gates header + card cost surfaces to admin/sales only", () => {
  // role helpers exist (admin/sales only → technician excluded)
  assert.match(productsJs, /canManageProducts\s*=\s*\["admin",\s*"sales"\]\.includes\(state\.profile\?\.role\)/,
    "canManageProducts must be admin/sales only");
  assert.match(productsJs, /canManageCard\s*=\s*\["admin",\s*"sales"\]\.includes\(state\.profile\?\.role\)/,
    "canManageCard must be admin/sales only");
  // header management block (import/add/export/...) is behind canManageProducts
  assert.match(productsJs, /\$\{canManageProducts \? `[\s\S]*?prodImportBtn[\s\S]*?prodExportBtn[\s\S]*?` : ''\}/,
    "header manage actions (import/add/export) must be gated by canManageProducts");
  // per-card edit + stock-in (cost surfaces) gated; never ungated
  assert.match(productsJs, /canManageCard \? `<button class="prod-cardmenu-item" data-prod-edit/,
    "edit card action must be gated by canManageCard");
  assert.match(productsJs, /canManageCard && pType === "stock" \? `<button class="prod-cardmenu-item" data-prod-stockin/,
    "per-card stock-in must be gated by canManageCard");
  assert.ok(!/\[\s*`<button class="prod-cardmenu-item" data-prod-edit="\$\{p\.id\}">/.test(productsJs),
    "edit action must not be present ungated");
  // the "ไม่มี cost" quick-filter chip references cost → hidden from technician
  assert.match(productsJs, /canManageProducts && \(noCostCount > 0 \|\| quickFilter === 'no_cost'\)/,
    "no_cost quick-filter chip must be gated by canManageProducts (no cost references for technician)");
});

// ── 4. the non-functional permission matrix page is hidden / neutralised ─────
test("permission matrix entry hidden and page no longer renders the fake matrix", () => {
  // menu entry removed (no active navigate button to permissions)
  assert.ok(!/data-action="navigate" data-target="permissions"/.test(menuJs),
    "settings menu must not expose the permissions matrix entry");
  // permissions page must not call the (unenforced) matrix renderer anymore
  assert.ok(!/renderPermissionMatrix/.test(permJs),
    "permissions page must not render the non-functional matrix");
  assert.ok(/ปิดปรับปรุง/.test(permJs), "permissions page must show a maintenance notice");
});
