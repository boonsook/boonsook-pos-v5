// Phase 457 — equip-remaining-display (READ-ONLY DISPLAY · service-job equipment list)
// Run: node --test tests/equip_remaining_guard.test.js
//
// renderEquipmentList (modules/service_equipment.js) now shows, per equipment row,
// the warehouse it is deducted from + the CURRENT remaining stock of that product in
// that warehouse (live read from state.warehouseStock that loadAllData already holds):
//     "🔻 ตัดจาก {คลัง} • คงเหลือ {N} ชิ้น • ฿{ราคา}/ชิ้น"  (readOnly view)
//
// This is display-only. The guards lock that the feature:
//   - accepts a `state` option and looks up warehouseStock by product_id + warehouse_id;
//   - renders "คงเหลือ" when the row resolves to a stock row;
//   - is backward-compatible: missing state / warehouse_id / product_id must NOT crash
//     and must NOT print a remaining-count (graceful guard);
//   - performs NO network/DB access inside the function (no fetch/XHR/PATCH/POST) — it
//     only READs state.warehouseStock, never mutates it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderEquipmentList } from "../modules/service_equipment.js";

const moduleSrc = fs.readFileSync(path.resolve("modules/service_equipment.js"), "utf8");
const mainSrc = fs.readFileSync(path.resolve("main.js"), "utf8");

const money = (n) => `฿${Number(n || 0).toLocaleString()}`;
// minimal stub element — renderEquipmentList only ever assigns innerHTML
const stubEl = () => ({ innerHTML: "" });

// ── behavioral: remaining shown from live state.warehouseStock ─────────────────
test("renderEquipmentList accepts `state` and shows live remaining for the row's warehouse", () => {
  const el = stubEl();
  const state = { warehouseStock: [{ product_id: 1, warehouse_id: 9, stock: 4 }] };
  renderEquipmentList(el, [
    { product_id: 1, warehouse_id: 9, warehouse_name: "รถคันแดง", name: "ท่อ", qty: 2, unit_price: 50, line_total: 100 }
  ], { money, readOnly: true, state });
  assert.match(el.innerHTML, /คงเหลือ\s*4\s*ชิ้น/, "remaining count comes from warehouseStock");
  assert.match(el.innerHTML, /🔻 ตัดจาก/, "readOnly view shows the deduct-from label");
  assert.match(el.innerHTML, /รถคันแดง/, "warehouse name rendered");
});

test("remaining lookup matches on product_id AND warehouse_id (string-tolerant)", () => {
  const el = stubEl();
  // same product in two warehouses — must pick the row's own warehouse (id 9 = 4 left, not id 8 = 99)
  const state = { warehouseStock: [
    { product_id: "1", warehouse_id: "8", stock: 99 },
    { product_id: "1", warehouse_id: "9", stock: 4 },
  ] };
  renderEquipmentList(el, [
    { product_id: 1, warehouse_id: 9, warehouse_name: "รถ", name: "ท่อ", qty: 1, unit_price: 50, line_total: 50 }
  ], { money, readOnly: true, state });
  assert.match(el.innerHTML, /คงเหลือ\s*4\s*ชิ้น/, "matched the right (product,warehouse) pair");
  assert.ok(!/คงเหลือ\s*99/.test(el.innerHTML), "did not leak the other warehouse's stock");
});

// ── backward-compatible: no crash + no remaining when info missing ─────────────
test("backward-compatible: no state → renders price only, no crash, no คงเหลือ", () => {
  const el = stubEl();
  assert.doesNotThrow(() => {
    renderEquipmentList(el, [
      { product_id: 1, warehouse_id: 9, warehouse_name: "รถ", name: "ท่อ", qty: 1, unit_price: 50, line_total: 50 }
    ], { money, readOnly: true });  // <-- no state passed
  });
  assert.ok(!/คงเหลือ/.test(el.innerHTML), "no remaining shown when state is absent");
  assert.match(el.innerHTML, /รถ/, "warehouse name still shown");
});

test("backward-compatible: missing warehouse_id/product_id → no remaining, no crash", () => {
  const el = stubEl();
  const state = { warehouseStock: [{ product_id: 1, warehouse_id: 9, stock: 4 }] };
  assert.doesNotThrow(() => {
    renderEquipmentList(el, [
      { name: "บริการ", qty: 1, unit_price: 0, line_total: 0 }  // no warehouse_id/product_id/warehouse_name
    ], { money, readOnly: true, state });
  });
  assert.ok(!/คงเหลือ/.test(el.innerHTML), "no remaining for an item without warehouse_id");
});

test("warehouse not found in warehouseStock → no remaining (null), no crash", () => {
  const el = stubEl();
  const state = { warehouseStock: [{ product_id: 2, warehouse_id: 9, stock: 4 }] };  // different product
  renderEquipmentList(el, [
    { product_id: 1, warehouse_id: 9, warehouse_name: "รถ", name: "ท่อ", qty: 1, unit_price: 50, line_total: 50 }
  ], { money, readOnly: true, state });
  assert.ok(!/คงเหลือ/.test(el.innerHTML), "unresolved stock row prints no remaining");
});

test("empty list still renders the empty-state (state passed)", () => {
  const el = stubEl();
  renderEquipmentList(el, [], { money, readOnly: true, state: { warehouseStock: [] } });
  assert.match(el.innerHTML, /ยังไม่มีอุปกรณ์/, "empty-state preserved");
});

// ── source guards: signature, lookup keys, render token, read-only ─────────────
test("renderEquipmentList signature accepts a `state` option", () => {
  assert.match(moduleSrc,
    /export function renderEquipmentList\(listEl, items, \{[^}]*\bstate\b[^}]*\}\)/,
    "function destructures `state` from its options");
});

test("remaining is looked up from state.warehouseStock by product_id + warehouse_id", () => {
  assert.ok(/state\.warehouseStock/.test(moduleSrc), "reads state.warehouseStock");
  assert.ok(/String\(s\.product_id\)\s*===\s*String\(it\.product_id\)/.test(moduleSrc), "matches product_id");
  assert.ok(/String\(s\.warehouse_id\)\s*===\s*String\(it\.warehouse_id\)/.test(moduleSrc), "matches warehouse_id");
  assert.ok(/คงเหลือ/.test(moduleSrc), "renders a คงเหลือ label");
});

test("remaining helper is guarded (no crash when state / warehouse_id missing)", () => {
  // a guard like: if (!state || it.warehouse_id == null || it.product_id == null) return null;
  assert.match(moduleSrc,
    /if\s*\(\s*!state\s*\|\|\s*it\.warehouse_id\s*==\s*null/,
    "remaining lookup bails when state or warehouse_id is missing");
});

test("the function body performs NO network / DB access (display-only)", () => {
  // scope the check to the renderEquipmentList body (up to the next top-level export)
  const start = moduleSrc.indexOf("export function renderEquipmentList");
  assert.ok(start >= 0, "function found");
  const after = moduleSrc.slice(start);
  const end = after.indexOf("\nexport function ", 1);
  const body = end > 0 ? after.slice(0, end) : after;
  assert.ok(!/\bfetch\s*\(/.test(body), "no fetch()");
  assert.ok(!/XMLHttpRequest|xhrPost|xhrPatch|xhrPut|xhrDelete/.test(body), "no xhr helpers");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"PUT"', "'PUT'", '"DELETE"', "'DELETE'"]) {
    assert.ok(!body.includes(verb), `no HTTP write method ${verb}`);
  }
  // does not mutate state.warehouseStock (read-only)
  assert.ok(!/warehouseStock\.(push|splice|pop|shift|unshift|sort|reverse)\(/.test(body),
    "does not mutate the warehouseStock array");
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(body), "does not assign into state.*");
});

// ── wiring: the service-drawer call site passes `state` ────────────────────────
test("main.js passes `state` to the equipment-list render call", () => {
  assert.match(mainSrc,
    /_equipRenderList\(\$\("serviceEquipmentList"\), _serviceDrawerItems, \{[^}]*\bstate\b[^}]*\}\)/,
    "the drawer render call includes state");
});
