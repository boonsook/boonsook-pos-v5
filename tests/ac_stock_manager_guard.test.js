// Phase air-stock-manager-safe-step (build 344) + air-catalog-not-real-stock-correction (build 345)
// Run: node --test tests/ac_stock_manager_guard.test.js
//
// Why this exists:
//   The air page is a PRICING CATALOG (ทำราคา/ใบเสนอราคา) — NOT real warehouse stock.
//   It lives in localStorage (bsk_ac_catalog), separate from products/POS. These guards lock:
//     - it is NOT wired to products/POS, never mutates real stock/cart/billing
//     - misleading "stock" wording (คงเหลือ / เพิ่มเข้าคลัง / มีสต็อก / หมดสต็อก / พร้อมส่ง) is gone
//     - the 3 air-type tabs + "wall" fallback survive (no DB migration)
//     - the Excel/CSV export format stays 24 columns (no format drift)

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
  assert.match(form, /export const acTypeOf\s*=\s*\(c\)\s*=>\s*\(c && AC_TYPE_KEYS\.includes\(c\.ac_type\)\)\s*\?\s*c\.ac_type\s*:\s*"wall"/);
  assert.match(catalog, /let _acTab\s*=\s*"wall"/);
});

test("three air-type tabs render and switch via [data-ac-tab]", () => {
  assert.match(catalog, /data-ac-tab="\$\{t\.key\}"/);
  assert.match(catalog, /\[data-ac-tab\]"\)\.forEach\(btn => btn\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*_acTab\s*=\s*btn\.dataset\.acTab;/s);
});

// ── correction: page is a CATALOG, not real stock ────────────────────────────
test("page is titled 'จัดการแคตตาล็อกแอร์' with the not-real-stock subtitle", () => {
  assert.match(catalog, /set-subpage-title">🌬️ จัดการแคตตาล็อกแอร์</);
  assert.ok(!/จัดการสต็อกแอร์/.test(catalog), "must not call itself จัดการสต็อกแอร์ anymore");
  // subtitle clarifies purpose
  assert.match(catalog, /ใช้สำหรับตั้งราคาและเลือกสินค้าไปทำใบเสนอราคา/);
  assert.match(catalog, /ไม่ใช่สต็อกจริงในคลัง/);
  // settings menu label matches
  assert.match(menu, /set-menu-label">จัดการแคตตาล็อกแอร์</);
});

test("misleading real-stock wording is removed from the page", () => {
  for (const bad of ["คงเหลือ", "เพิ่มเข้าคลัง", ">มีสต็อก<", ">หมดสต็อก<", "พร้อมส่ง", "data-ac-addstock"]) {
    assert.ok(!catalog.includes(bad), `page must not contain misleading token "${bad}"`);
  }
  // the inventory form must not call the field "จำนวนสต็อก" in the UI label
  assert.ok(!/label[^>]*>จำนวนสต็อก/.test(form), "form must not label the field as จำนวนสต็อก");
  assert.match(form, /acsf-label">สถานะเสนอขาย/);
});

test("summary cards use offer wording (พร้อมเสนอขาย / ยังไม่เปิดขาย), not stock wording", () => {
  assert.match(catalog, /พร้อมเสนอขาย/);
  assert.match(catalog, /ยังไม่เปิดขาย/);
});

// ── card content: brand/model/BTU/price/cost/profit/sku/note + 3-state badge ─
test("product card shows pricing fields and a 3-state offer badge", () => {
  assert.match(catalog, /ราคาเสนอ ฿/);
  assert.match(catalog, /ต้นทุนฯ ฿/);
  assert.match(catalog, /กำไรฯ /);
  assert.match(catalog, /รหัสอ้างอิง:/);
  // 3 badge states
  assert.match(catalog, /'ต้องเช็คราคา'/);
  assert.match(catalog, /'พร้อมเสนอขาย'/);
  assert.match(catalog, /'เลิกขาย'/);
});

// ── "นำไปเสนอราคา" = stage a draft + navigate; never touches real stock/cart/billing ────
test("'นำไปเสนอราคา' stages a draft + navigates (no stock/cart/Supabase mutation)", () => {
  assert.match(catalog, /data-ac-quote="\$\{c\.id\}"[^>]*>📝 นำไปเสนอราคา/);
  const start = catalog.indexOf('[data-ac-quote]');
  const h = catalog.slice(start, start + 1100);
  // stages a draft (Phase 346) then navigates to the quotations page
  assert.match(h, /pushAirQuoteDraft\(/, "must stage an air-catalog draft");
  assert.match(h, /showRoute\("quotations"\)|location\.hash\s*=\s*"quotations"/, "must navigate to quotations");
  // must NOT touch real warehouse stock / cart / Supabase from this handler
  assert.ok(!/localStorage\.setItem/.test(h), "quote handler must not write to localStorage (catalog/store)");
  assert.ok(!/\.stock\s*=/.test(h), "quote handler must not mutate stock");
  assert.ok(!/addToCart|_appXhr|from\(["']products["']\)/.test(h), "quote handler must not touch cart/POS/products");
});

// ── risky bulk button reworded, confirm kept ─────────────────────────────────
test("the bulk button is reworded to 'ตั้งค่าเริ่มต้นแคตตาล็อก' inside the menu and keeps its confirm", () => {
  const panel = catalog.slice(catalog.indexOf('class="prod-more-panel"'), catalog.indexOf("</details>", catalog.indexOf('class="prod-more-panel"')));
  assert.match(panel, /id="acSetStock5Btn"[^>]*>⚙️ ตั้งค่าเริ่มต้นแคตตาล็อก/);
  assert.ok(!panel.includes("ตั้งสต็อก 5 เครื่อง"), "old 'ตั้งสต็อก 5 เครื่อง' label must be gone");
  const h = catalog.slice(catalog.indexOf('"acSetStock5Btn")'), catalog.indexOf('"acSetStock5Btn")') + 360);
  assert.match(h, /window\.App\?\.confirm\?\.\(/, "confirm must still guard the bulk action");
});

// ── import/export untouched (logic + format) ─────────────────────────────────
test("all existing import/export handler ids survive (no logic change)", () => {
  for (const id of ["acCatalogFileInput", "acCatalogImportBtn", "acCatalogImportStatus", "acExportXlsxBtn", "acExportCsvBtn", "acCatalogRefreshBtn", "acCatalogClearBtn"]) {
    assert.match(catalog, new RegExp(`id="${id}"`), `#${id} must still exist`);
  }
});

test("Excel/CSV export format is UNCHANGED — 24 columns, no new fields leaked in", () => {
  const m = catalog.match(/_EXPORT_HEADERS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, "_EXPORT_HEADERS must exist");
  const cols = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  assert.equal(cols.length, 24, "export must stay 24 columns");
  for (const leak of ["ac_type", "cost", "sku", "note"]) {
    assert.ok(!cols.includes(leak), `export must not include new field '${leak}'`);
  }
});

// ── add/edit core form fields + default type from tab ────────────────────────
test("add/edit form has all required core fields", () => {
  for (const id of ["acsfType", "acsfSection", "acsfModel", "acsfBtu", "acsfPrice", "acsfCost", "acsfStock", "acsfSku", "acsfNote"]) {
    assert.match(form, new RegExp(`id="${id}"`), `form must have #${id}`);
  }
});

test("opening the form from a tab defaults the air type to that tab", () => {
  assert.match(catalog, /openAcStockForm\(null,\s*_acTab,/);
  assert.match(catalog, /openAcStockForm\(list\[idx\],\s*acTypeOf\(list\[idx\]\),/);
  assert.match(form, /const curType = isEdit \? acTypeOf\(cur\) : \(AC_TYPE_KEYS\.includes\(defaultType\) \? defaultType : "wall"\)/);
});

// ── safety: not wired to products/POS, no API/DB/network ─────────────────────
test("the air catalog is NOT wired to products/POS and touches no API/DB", () => {
  // localStorage key is its own store, never the products/POS pipeline
  assert.match(catalog, /bsk_ac_catalog/);
  // match real USAGE (not explanatory comments that mention the word)
  for (const banned of [/\/api\//, /from\(["']products["']\)/, /addToCart/, /_appXhr/, /SUPABASE_CONFIG/, /rest\/v1\//]) {
    assert.ok(!banned.test(catalog), `ac-catalog must not reference ${banned}`);
  }
  assert.ok(!/\/api\//.test(form) && !/SUPABASE_CONFIG|_appXhr|fetch\(/.test(form), "form must not touch network/db");
});
