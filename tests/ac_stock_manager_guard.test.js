// Phase air-stock-manager-safe-step — source-level guard
// Run: node --test tests/ac_stock_manager_guard.test.js
//
// Why this exists:
//   "จัดการแคตตาล็อกแอร์" → "จัดการสต็อกแอร์" with 3 air-type tabs (wall/ceiling/cassette).
//   SAFE STEP: localStorage-only (bsk_ac_catalog) — NO auth/API, NO DB schema, NO import/export
//   FORMAT change, NO billing/cart/stock-core. These guards lock the safety invariants:
//     - the air-type field is DERIVED with a "wall" fallback (no bulk DB migration)
//     - the risky "ตั้งสต็อก 5 เครื่องทุกรุ่น" moved into the จัดการเพิ่มเติม menu but KEEPS its confirm
//     - every existing import/export handler id survives (logic untouched)
//     - the 24-column Excel/CSV export header list is unchanged (no format drift)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const catalog = fs.readFileSync(path.resolve("modules/settings/ac-catalog.js"), "utf8");
const form = fs.readFileSync(path.resolve("modules/settings/ac-stock-form.js"), "utf8");
const menu = fs.readFileSync(path.resolve("modules/settings/menu.js"), "utf8");

// ── air-type model: 3 types + safe fallback ──────────────────────────────────
test("ac-stock-form defines the 3 air types with the required Thai labels", () => {
  assert.match(form, /key:\s*"wall"[^}]*label:\s*"แอร์ติดผนัง"/s);
  assert.match(form, /key:\s*"ceiling"[^}]*label:\s*"แอร์แขวน"/s);
  assert.match(form, /key:\s*"cassette"[^}]*label:\s*"แอร์สี่ทิศทาง"/s);
});

test("acTypeOf falls back to 'wall' (no DB migration for legacy rows)", () => {
  // existing rows without ac_type must DISPLAY under แอร์ติดผนัง, not be migrated
  assert.match(form, /export const acTypeOf\s*=\s*\(c\)\s*=>\s*\(c && AC_TYPE_KEYS\.includes\(c\.ac_type\)\)\s*\?\s*c\.ac_type\s*:\s*"wall"/);
  // module tab state defaults to wall
  assert.match(catalog, /let _acTab\s*=\s*"wall"/);
});

// ── renamed page + 3 tabs ────────────────────────────────────────────────────
test("page is renamed to 'จัดการสต็อกแอร์' (settings title + menu label)", () => {
  assert.match(catalog, /จัดการสต็อกแอร์/);
  assert.ok(!/จัดการแคตตาล็อกแอร์/.test(catalog), "old title must be gone from the page header");
  assert.match(menu, /set-menu-label">จัดการสต็อกแอร์</);
});

test("three air-type tabs render and switch via [data-ac-tab]", () => {
  assert.match(catalog, /data-ac-tab="\$\{t\.key\}"/);
  assert.match(catalog, /\[data-ac-tab\]"\)\.forEach\(btn => btn\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*_acTab\s*=\s*btn\.dataset\.acTab;/s);
});

// ── summary cards ────────────────────────────────────────────────────────────
test("summary cards present (รุ่นทั้งหมด / แบรนด์ / มีสต็อก / หมดสต็อก)", () => {
  for (const label of ["รุ่นทั้งหมด", "แบรนด์/กลุ่ม", "มีสต็อก", "หมดสต็อก"]) {
    assert.match(catalog, new RegExp(label));
  }
});

// ── primary actions + จัดการเพิ่มเติม menu ───────────────────────────────────
test("primary buttons: + เพิ่มรุ่นแอร์, นำเข้า Excel, จัดการเพิ่มเติม menu", () => {
  assert.match(catalog, /id="acAddModelBtn"[^>]*>\+ เพิ่มรุ่นแอร์/);
  assert.match(catalog, /id="acImportQuickBtn"[^>]*>📂 นำเข้า Excel/);
  assert.match(catalog, /<details class="prod-more-menu">/);
});

test("risky 'ตั้งสต็อก 5 เครื่องทุกรุ่น' moved into the menu AND keeps its confirm", () => {
  // button lives inside the prod-more-panel (จัดการเพิ่มเติม)
  const panel = catalog.slice(catalog.indexOf('class="prod-more-panel"'), catalog.indexOf("</details>", catalog.indexOf('class="prod-more-panel"')));
  assert.match(panel, /id="acSetStock5Btn"/, "ตั้งสต็อก5 must be inside the จัดการเพิ่มเติม menu");
  assert.match(panel, /id="acCatalogClearBtn"[^>]*prod-more-danger/, "ล้างทั้งหมด must be a danger item in the menu");
  // confirm still guards it (unchanged handler)
  const h = catalog.slice(catalog.indexOf('"acSetStock5Btn")'), catalog.indexOf('"acSetStock5Btn")') + 320);
  assert.match(h, /window\.App\?\.confirm\?\.\(`ตั้งสต็อก 5 เครื่องทุกรุ่น/);
});

// ── import/export handlers + IDs preserved (logic untouched) ──────────────────
test("all existing import/export handler ids survive (no logic change)", () => {
  for (const id of ["acCatalogFileInput", "acCatalogImportBtn", "acCatalogImportStatus", "acExportXlsxBtn", "acExportCsvBtn", "acCatalogRefreshBtn", "acCatalogClearBtn"]) {
    assert.match(catalog, new RegExp(`id="${id}"`), `#${id} must still exist`);
    assert.match(catalog, new RegExp(`getElementById\\("${id}"\\)|"${id}"\\)`), `#${id} handler must still be wired`);
  }
});

test("Excel/CSV export format is UNCHANGED — 24 columns, no new fields leaked in", () => {
  const m = catalog.match(/_EXPORT_HEADERS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, "_EXPORT_HEADERS must exist");
  const cols = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  assert.equal(cols.length, 24, "export must stay 24 columns this round");
  assert.equal(cols[0], "section");
  assert.equal(cols[7], "stock");
  // the new app-only fields must NOT have crept into the export schema
  for (const leak of ["ac_type", "cost", "sku", "note"]) {
    assert.ok(!cols.includes(leak), `export must not include new field '${leak}' this round`);
  }
});

// ── add/edit core form fields + default type from tab ────────────────────────
test("add/edit form has all required core fields", () => {
  for (const id of ["acsfType", "acsfSection", "acsfModel", "acsfBtu", "acsfPrice", "acsfCost", "acsfStock", "acsfSku", "acsfNote"]) {
    assert.match(form, new RegExp(`id="${id}"`), `form must have #${id}`);
  }
  // type select offers exactly the 3 air types
  assert.match(form, /AC_TYPES\.map\(t =>/);
});

test("opening the form from a tab defaults the air type to that tab", () => {
  // add: openAcStockForm(null, _acTab, ...) ; new model adopts current tab
  assert.match(catalog, /openAcStockForm\(null,\s*_acTab,/);
  // edit: defaults to the row's own type
  assert.match(catalog, /openAcStockForm\(list\[idx\],\s*acTypeOf\(list\[idx\]\),/);
  // form honors the passed defaultType for new entries
  assert.match(form, /const curType = isEdit \? acTypeOf\(cur\) : \(AC_TYPE_KEYS\.includes\(defaultType\) \? defaultType : "wall"\)/);
});

// ── safety: no auth/API/DB from the new form ─────────────────────────────────
test("ac-stock-form is localStorage/UI only — no API/DB/network calls", () => {
  assert.ok(!/\/api\//.test(form), "form must not call any /api/ endpoint");
  assert.ok(!/supabase|_appXhr|fetch\(/i.test(form), "form must not touch supabase/xhr/fetch");
});
