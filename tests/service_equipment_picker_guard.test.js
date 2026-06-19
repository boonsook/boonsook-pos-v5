// Phase 452 — warehouse-first equipment picker + category filter
// Run: node --test tests/service_equipment_picker_guard.test.js
//
// Contract:
//   - openEquipmentPicker (modal "เลือกอุปกรณ์") = UI เลือกคลังก่อน (_pickerWh) + กรองหมวด (_pickerCat)
//     → ลิสต์เหลือเฉพาะของในคลัง · คลิกใช้คลังที่เลือกเลย (ข้าม _pickWarehouse) · "ทุกคลัง" คง flow เดิม
//   - 🔴 STOCK PATH: ❌ ห้ามแตะ logic ตัดสต็อก — openEquipmentPicker ต้องไม่เรียก
//     applyEquipmentDeduction/_appApplyStockMovement/deductEquipmentStock + onPick contract เดิม
//   Source-regex (modal ผูก DOM — unit-test ตรงไม่ได้).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/service_equipment.js"), "utf8");

function fnBody(name) {
  let start = src.indexOf(`export function ${name}`);
  if (start < 0) start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `must define ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const picker = fnBody("openEquipmentPicker");

test("picker: มี state เลือกคลัง (_pickerWh) + หมวด (_pickerCat)", () => {
  assert.match(picker, /let _pickerWh = "all"/, "ต้องมี _pickerWh");
  assert.match(picker, /let _pickerCat = "all"/, "ต้องมี _pickerCat");
  assert.match(picker, /id="svepWhChips"/, "ต้องมีแถบ chips คลัง");
  assert.match(picker, /id="svepCat"/, "ต้องมี dropdown หมวด");
});

test("picker: base list กรองตามคลังที่เลือก (warehouseStockOptions stock>0) ก่อน slice", () => {
  // baseForWh: คลังเฉพาะ → product ที่มี option warehouse_id===_pickerWh && stock>0
  assert.match(picker, /String\(o\.warehouse_id\)\s*===\s*String\(_pickerWh\)\s*&&\s*o\.stock\s*>\s*0/,
    "baseForWh ต้องกรองด้วย warehouse_id===_pickerWh && stock>0");
  // category filter ก่อน slice
  assert.match(picker, /_pickerCat !== "all"\)\s*filtered = filtered\.filter\(p => String\(p\.category \|\| ""\)\.trim\(\) === _pickerCat\)/,
    "ต้อง filter ด้วย _pickerCat");
  assert.match(picker, /\.slice\(0,\s*50\)/, "ยังคง slice 50");
});

test("picker: เลือกคลังเฉพาะ → คลิกใช้คลังนั้นเลย (find by _pickerWh, ข้าม _pickWarehouse)", () => {
  assert.match(picker, /if \(_pickerWh !== "all"\)\s*\{[\s\S]*?opts\.find\(o => String\(o\.warehouse_id\)\s*===\s*String\(_pickerWh\)\)/,
    "คลังเฉพาะ ต้อง opts.find ด้วย _pickerWh");
});

test("picker: 'ทุกคลัง' ยังคง flow _pickWarehouse เดิมเมื่อ opts>1", () => {
  // ในกิ่ง else (ทุกคลัง) ต้องยังเรียก _pickWarehouse
  assert.match(picker, /\} else \{[\s\S]*?opts\.length > 1\)\s*\{[\s\S]*?await _pickWarehouse\(opts, p\.name\)/,
    "ทุกคลัง: opts>1 ต้องเด้ง _pickWarehouse");
  assert.match(src, /function _pickWarehouse\(/, "ห้ามลบ _pickWarehouse");
});

test("picker: onPick payload contract เดิม (warehouse_id/warehouse_name/_stock_avail)", () => {
  assert.match(picker, /warehouse_id:\s*chosen\.warehouse_id/, "ต้องส่ง warehouse_id");
  assert.match(picker, /warehouse_name:\s*chosen\.warehouse_name/, "ต้องส่ง warehouse_name");
  assert.match(picker, /_stock_avail:\s*chosen\.stock/, "ต้องส่ง _stock_avail");
  assert.match(picker, /product_id:\s*Number\(p\.id\)/, "ต้องส่ง product_id");
});

test("picker: 🔴 ไม่แตะ logic ตัดสต็อก — ไม่เรียก deduction/_appApplyStockMovement", () => {
  assert.doesNotMatch(picker, /applyEquipmentDeduction|deductEquipmentStock|_appApplyStockMovement|precheckEquipmentStock|restoreServiceJobStock/,
    "picker ต้องไม่แตะ logic ตัด/คืนสต็อก");
  assert.doesNotMatch(picker, /XMLHttpRequest|fetch\s*\(|"PATCH"|"POST"|"DELETE"/, "picker ต้องไม่เขียน DB");
});

test("module: warehouseStockOptions contract เดิม (ไม่ถูกแก้)", () => {
  const ws = fnBody("warehouseStockOptions");
  assert.match(ws, /warehouse_id:\s*w\.id/, "คง field warehouse_id");
  assert.match(ws, /stock:\s*Number\(ws\?\.stock \|\| 0\)/, "คง field stock");
  assert.match(ws, /\.filter\(o => o\.stock > 0\)/, "คงกรอง stock>0");
});

// Phase 501 — picker multi-add: เลือกอุปกรณ์แล้ว "ไม่ปิด" picker (เพิ่มหลายชิ้นรวด)
test("Phase 501: item-click ไม่ปิด picker (multi-add) — ไม่มี modal.remove() หลัง onPick", () => {
  const afterOnPick = picker.slice(picker.indexOf("onPick?."));
  assert.ok(afterOnPick.length > 0, "ต้องมี onPick call");
  assert.doesNotMatch(afterOnPick, /modal\.remove\(\)/,
    "เลือกอุปกรณ์แล้วต้องไม่ปิด picker (เพิ่มหลายชิ้นได้)");
  assert.match(afterOnPick, /showToast\?\.\(/, "ต้องมี toast feedback ต่อชิ้น");
});

test("Phase 501: ตัวนับ 'เพิ่มแล้ว N ชิ้น' ที่หัว picker + bump ต่อการเลือก", () => {
  assert.match(picker, /id="svepCount"/, "ต้องมี element ตัวนับที่หัว picker");
  assert.match(picker, /เพิ่มแล้ว " \+ _addedCount \+ " ชิ้น/, "ตัวนับแสดงข้อความ 'เพิ่มแล้ว N ชิ้น'");
  const afterOnPick = picker.slice(picker.indexOf("onPick?."));
  assert.match(afterOnPick, /_bumpCount\(\)/, "item-click ต้องเรียก _bumpCount() (นับต่อการเลือก)");
});

test("Phase 501: ปิด picker ได้แค่ #svepClose + backdrop (modal.remove() เหลือ 2 จุด)", () => {
  assert.match(picker, /#svepClose"\)\.addEventListener\("click", \(\) => modal\.remove\(\)\)/,
    "ปุ่ม ✕ ยังปิด picker ได้");
  assert.match(picker, /modal\.addEventListener\("click", \(e\) => \{ if \(e\.target === modal\) modal\.remove\(\); \}\)/,
    "คลิก backdrop ยังปิด picker ได้");
  assert.equal((picker.match(/modal\.remove\(\)/g) || []).length, 2,
    "มี modal.remove() แค่ 2 จุดปิด (svepClose + backdrop) — ไม่มีบนเส้น item-click");
});
