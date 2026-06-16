// Phase 453a — warehouse-first picker on ac_install (ติดตั้งแอร์)
// Run: node --test tests/ac_install_picker_guard.test.js
//
// Contract:
//   - _openItemPicker (modal "เลือกอุปกรณ์" หน้าติดตั้งแอร์) = UI เลือกคลังก่อน (_acPickerWh) + กรองหมวด
//     → ลิสต์เหลือเฉพาะของในคลัง · คลิกใช้คลังที่เลือกเลย (ข้าม _pickMobileWarehouse) · "ทุกคลัง" คง flow เดิม
//   - 🔴 STOCK PATH: ❌ ห้ามแตะ transfer/deduct — picker ต้องไม่เรียก _applyStockMovement/deduct;
//     คง _items.push contract (warehouse_id/warehouse_name/_stock_avail) + คง _pickMobileWarehouse
//   Source-regex (modal ผูก DOM — unit-test ตรงไม่ได้).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/ac_install.js"), "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `must define ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const picker = fnBody("_openItemPicker");

test("picker: มี state เลือกคลัง (_acPickerWh) + หมวด (_acPickerCat) + chips + dropdown", () => {
  assert.match(picker, /let _acPickerWh = "all"/, "ต้องมี _acPickerWh");
  assert.match(picker, /let _acPickerCat = "all"/, "ต้องมี _acPickerCat");
  assert.match(picker, /id="acpkWhChips"/, "ต้องมีแถบ chips คลัง");
  assert.match(picker, /data-wh-chip=/, "chips ต้องมี data-wh-chip");
  assert.match(picker, /id="acpkCat"/, "ต้องมี dropdown หมวด");
});

test("picker: base list กรองตามคลัง (_acBaseForWh + _acStockInWh mobile+home) ก่อน slice", () => {
  assert.match(picker, /const _acStockInWh = \(p, whId\) =>/, "ต้องมี helper _acStockInWh");
  assert.match(picker, /_getMobileStocks\(p, state\)/, "_acStockInWh ต้องรวม mobile stocks");
  assert.match(picker, /_getHomeStock\(p, state\)/, "_acStockInWh ต้องรวม home stock");
  assert.match(picker, /const _acBaseForWh = \(\) =>/, "ต้องมี _acBaseForWh");
  assert.match(picker, /_acPickerCat !== "all"\)\s*filtered = filtered\.filter\(p => String\(p\.category \|\| ""\)\.trim\(\) === _acPickerCat\)/,
    "ต้อง filter ด้วย _acPickerCat");
  assert.match(picker, /\.slice\(0,\s*50\)/, "ยังคง slice 50");
});

test("picker: เลือกคลังเฉพาะ → click resolve ด้วย _acPickerWh ก่อน _pickMobileWarehouse", () => {
  assert.match(picker, /if \(_acPickerWh !== "all"\)\s*\{[\s\S]*?mobileStocks\.find\(s => String\(s\.warehouse_id\)\s*===\s*String\(_acPickerWh\)\)/,
    "คลังเฉพาะ ต้อง mobileStocks.find ด้วย _acPickerWh");
  // resolve mobile ต้องอยู่ "ก่อน" บล็อก fallback _pickMobileWarehouse
  const resolveIdx = picker.indexOf("mobileStocks.find(s => String(s.warehouse_id) === String(_acPickerWh))");
  const pickIdx = picker.indexOf("_pickMobileWarehouse(mobileStocks");
  assert.ok(resolveIdx >= 0 && pickIdx >= 0 && resolveIdx < pickIdx,
    "resolve ตาม _acPickerWh ต้องมาก่อน _pickMobileWarehouse");
});

test("picker: 'ทุกคลัง' ยังคง flow _pickMobileWarehouse เดิม (fallback) + ไม่ลบฟังก์ชัน", () => {
  assert.match(picker, /if \(!chosenWh\)\s*\{[\s\S]*?await _pickMobileWarehouse\(mobileStocks, p\.name\)/,
    "fallback (ทุกคลัง/ไม่เจอ) ต้องยังเรียก _pickMobileWarehouse");
  assert.match(src, /function _pickMobileWarehouse\(/, "ห้ามลบ _pickMobileWarehouse");
});

test("picker: _items.push contract เดิม (warehouse_id/warehouse_name/_stock_avail)", () => {
  assert.match(picker, /_items\.push\(\{/, "ต้องยัง push เข้า _items");
  assert.match(picker, /warehouse_id:\s*chosenWh\.warehouse_id/, "ต้องส่ง warehouse_id");
  assert.match(picker, /warehouse_name:\s*chosenWh\.warehouse_name/, "ต้องส่ง warehouse_name");
  assert.match(picker, /_stock_avail:\s*chosenWh\.stock/, "ต้องส่ง _stock_avail");
});

test("picker: 🔴 ไม่แตะ transfer/deduct — ไม่เรียก _applyStockMovement/deduct ใน picker", () => {
  assert.doesNotMatch(picker, /_applyStockMovement|_appApplyStockMovement|deductStock|movementType/,
    "picker ต้องไม่ตัดสต็อก/transfer (save ต่างหากที่ทำ)");
  assert.doesNotMatch(picker, /XMLHttpRequest|fetch\s*\(|"PATCH"|"POST"|"DELETE"/, "picker ต้องไม่เขียน DB");
});

test("picker: คง toast 'ยังอยู่ในบ้าน' ตอนเลือกของบ้าน", () => {
  assert.match(picker, /ยังอยู่ในบ้าน — จะถามยืนยันโอนตอนบันทึก/, "ต้องคง toast เตือนของบ้าน");
});
