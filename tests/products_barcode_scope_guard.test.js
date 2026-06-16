// Phase 450 — barcode generate: scope by filter / page + per-item bulk selection
// Run: node --test tests/products_barcode_scope_guard.test.js
//
// Contract:
//   - มี helper กลางตัวเดียว _generateBarcodesForProducts(ctx, list, scopeLabel)
//     ที่ "เติมเฉพาะสินค้านับสต็อกที่ยังไม่มีบาร์โค้ด" (type==="stock" && !barcode.trim())
//     → ห้ามทับบาร์โค้ดเดิมบนชั้นวาง
//   - ปุ่มหลัก generateAllBarcodes "รู้ filter" (mirror ปุ่ม Export): อ้าง currentCategory + quickFilter + _appConfirm
//   - bulk action มีปุ่ม id="prodBulkGenBarcodeBtn" ผูก _generateBarcodesForProducts กับ bulkSelected
//   - bulk-gen ห้ามใช้ _bulkPatchProducts (ส่ง patch ก้อนเดียว = บาร์โค้ดซ้ำกันทุกตัว)
//   - ห้ามแก้ algorithm generateBarcodeEAN13 (prefix "200" + check digit คงเดิม)
// Source-regex: handler ผูก DOM/XHR จริง — unit-test ตรงไม่ได้ จึงตรวจที่ source string.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

// helper: ตัด body ของฟังก์ชัน (กัน grep ทั้งไฟล์ติดที่อื่น)
function fnBody(name) {
  const start = src.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `must define ${name}`);
  // หา '{' แรกหลังชื่อฟังก์ชัน แล้วไล่ brace ให้สมดุล
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test("defines central helper _generateBarcodesForProducts(ctx, list, scopeLabel)", () => {
  assert.match(src, /async function _generateBarcodesForProducts\s*\(\s*ctx\s*,\s*list\s*,\s*scopeLabel\s*\)/,
    "ต้องมี helper กลาง _generateBarcodesForProducts(ctx, list, scopeLabel)");
});

test("helper เติมเฉพาะ stock ที่ barcode ว่าง (ไม่ทับของเก่า)", () => {
  const body = fnBody("_generateBarcodesForProducts");
  assert.match(body, /detectProductType\(p\)\s*===\s*"stock"/, "ต้องกรองเฉพาะ type stock");
  assert.match(body, /!String\(p\.barcode\s*\|\|\s*""\)\.trim\(\)/,
    "ต้องเติมเฉพาะตัวที่ barcode ว่าง (ห้ามทับของเก่า)");
  assert.match(body, /generateBarcodeEAN13\(\)/, "ต้อง gen ทีละรายด้วย generateBarcodeEAN13()");
});

test("helper ห้ามใช้ _bulkPatchProducts (กันบาร์โค้ดซ้ำกันทุกตัว)", () => {
  const body = fnBody("_generateBarcodesForProducts");
  assert.doesNotMatch(body, /_bulkPatchProducts/,
    "bulk-gen ต้อง PATCH ทีละราย — ห้าม _bulkPatchProducts (patch ก้อนเดียว = barcode ซ้ำ)");
});

test("generateAllBarcodes filter-aware: อ้าง currentCategory + quickFilter + _appConfirm", () => {
  const body = fnBody("generateAllBarcodes");
  assert.match(body, /currentCategory/, "ต้องรู้ currentCategory");
  assert.match(body, /quickFilter/, "ต้องรู้ quickFilter");
  assert.match(body, /_appConfirm\(/, "ต้องถาม scope ด้วย _appConfirm เมื่อ filtered ≠ all");
  assert.match(body, /_generateBarcodesForProducts\(/, "ต้องเรียก helper กลาง");
});

test("bulk action: ปุ่ม prodBulkGenBarcodeBtn ผูก helper กับ bulkSelected", () => {
  assert.match(src, /id="prodBulkGenBarcodeBtn"/, "ต้องมีปุ่ม id=prodBulkGenBarcodeBtn ในแถบ bulk");
  // handler block: map bulkSelected → _generateBarcodesForProducts
  const handlerIdx = src.indexOf('"#prodBulkGenBarcodeBtn"');
  assert.ok(handlerIdx >= 0, "ต้อง wire handler ของ prodBulkGenBarcodeBtn");
  const handler = src.slice(handlerIdx, handlerIdx + 400);
  assert.match(handler, /bulkSelected/, "handler ต้องอ่านจาก bulkSelected");
  assert.match(handler, /_generateBarcodesForProducts\(/, "handler ต้องเรียก helper กลาง");
});

test("ไม่แตะ algorithm generateBarcodeEAN13 (prefix 200 + check digit)", () => {
  const start = src.indexOf("function generateBarcodeEAN13");
  assert.ok(start >= 0, "ต้องคงฟังก์ชัน generateBarcodeEAN13");
  const body = src.slice(start, start + 400);
  assert.match(body, /const prefix = "200"/, "prefix ต้องคง 200");
  assert.match(body, /\(10 - \(sum % 10\)\) % 10/, "check digit ต้องคงสูตรเดิม");
});
