// Phase 453c — warehouse-first picker on solar (งานโซล่าเซลล์)
// Run: node --test tests/solar_picker_guard.test.js
//
// Contract:
//   - _solOpenItemPicker (modal "เลือกอุปกรณ์โซล่าเซลล์") = UI เลือกคลังก่อน (_solPickerWh) + กรองหมวด
//     → ลิสต์เหลือเฉพาะของในคลัง · คลิกใช้คลังที่เลือกเลย (ข้าม _solPickMobileWarehouse) · "ทุกคลัง" คง flow เดิม
//   - 🔴 STOCK PATH: ❌ ห้ามแตะ transfer/deduct — picker ต้องไม่เรียก _applyStockMovement/deduct;
//     คง _solItems.push contract (warehouse_id/warehouse_name/_stock_avail) + คง _solPickMobileWarehouse
//   Source-regex (modal ผูก DOM — unit-test ตรงไม่ได้).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/solar.js"), "utf8");

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

const picker = fnBody("_solOpenItemPicker");

test("picker: มี state เลือกคลัง (_solPickerWh) + หมวด (_solPickerCat) + chips + dropdown", () => {
  assert.match(picker, /let _solPickerWh = "all"/, "ต้องมี _solPickerWh");
  assert.match(picker, /let _solPickerCat = "all"/, "ต้องมี _solPickerCat");
  assert.match(picker, /id="solpkWhChips"/, "ต้องมีแถบ chips คลัง");
  assert.match(picker, /data-wh-chip=/, "chips ต้องมี data-wh-chip");
  assert.match(picker, /id="solpkCat"/, "ต้องมี dropdown หมวด");
});

test("picker: base list กรองตามคลัง (_solBaseForWh + _solStockInWh mobile+home) ก่อน slice", () => {
  assert.match(picker, /const _solStockInWh = \(p, whId\) =>/, "ต้องมี helper _solStockInWh");
  assert.match(picker, /_solGetMobileStocks\(p, state\)/, "_solStockInWh ต้องรวม mobile stocks");
  assert.match(picker, /_solGetHomeStock\(p, state\)/, "_solStockInWh ต้องรวม home stock");
  assert.match(picker, /const _solBaseForWh = \(\) =>/, "ต้องมี _solBaseForWh");
  assert.match(picker, /_solPickerCat !== "all"\)\s*filtered = filtered\.filter\(p => String\(p\.category \|\| ""\)\.trim\(\) === _solPickerCat\)/,
    "ต้อง filter ด้วย _solPickerCat");
  assert.match(picker, /\.slice\(0,\s*50\)/, "ยังคง slice 50");
});

test("picker: เลือกคลังเฉพาะ → click resolve ด้วย _solPickerWh ก่อน _solPickMobileWarehouse", () => {
  assert.match(picker, /if \(_solPickerWh !== "all"\)\s*\{[\s\S]*?mobileStocks\.find\(s => String\(s\.warehouse_id\)\s*===\s*String\(_solPickerWh\)\)/,
    "คลังเฉพาะ ต้อง mobileStocks.find ด้วย _solPickerWh");
  // resolve mobile ต้องอยู่ "ก่อน" บล็อก fallback _solPickMobileWarehouse
  const resolveIdx = picker.indexOf("mobileStocks.find(s => String(s.warehouse_id) === String(_solPickerWh))");
  const pickIdx = picker.indexOf("_solPickMobileWarehouse(mobileStocks");
  assert.ok(resolveIdx >= 0 && pickIdx >= 0 && resolveIdx < pickIdx,
    "resolve ตาม _solPickerWh ต้องมาก่อน _solPickMobileWarehouse");
});

test("picker: 'ทุกคลัง' ยังคง flow _solPickMobileWarehouse เดิม (fallback) + ไม่ลบฟังก์ชัน", () => {
  assert.match(picker, /if \(!chosenWh\)\s*\{[\s\S]*?await _solPickMobileWarehouse\(mobileStocks, p\.name\)/,
    "fallback (ทุกคลัง/ไม่เจอ) ต้องยังเรียก _solPickMobileWarehouse");
  assert.match(src, /function _solPickMobileWarehouse\(/, "ห้ามลบ _solPickMobileWarehouse");
});

test("picker: _solItems.push contract เดิม (warehouse_id/warehouse_name/_stock_avail)", () => {
  assert.match(picker, /_solItems\.push\(\{/, "ต้องยัง push เข้า _solItems");
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
