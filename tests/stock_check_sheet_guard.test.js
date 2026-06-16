// Phase 451 — printable A4 stock-check sheet
// Run: node --test tests/stock_check_sheet_guard.test.js
//
// Contract:
//   - buildStockCheckSheetHtml = pure → unit-test ตรง: หัวหมวด / แถวสินค้า / คอลัมน์ "นับจริง" /
//     คงเหลือ / <img qrDataUrl> / escHtml ค่าผู้ใช้ (กัน XSS) / ❌ ไม่มีราคา-ต้นทุน
//   - openStockCheckSheet (products.js) = read-only (ไม่มี XHR/fetch/PATCH/POST) + ปุ่ม prodStockSheetBtn wired

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildStockCheckSheetHtml } from "../modules/stock_check_sheet.js";

const SAMPLE = {
  warehouseName: "รถคันแดง",
  dateStr: "16 มิถุนายน 2569",
  shopName: "บุญสุข อิเล็กทรอนิกส์",
  groups: [
    {
      category: "งานดาวเทียม",
      items: [
        { idx: 1, name: "จานดาวเทียม 60cm", barcode: "2000001", sku: "SAT60", stock: 3, qrDataUrl: "data:image/png;base64,AAA" },
        { idx: 2, name: "LNB Universal", barcode: "2000002", sku: "LNB1", stock: 0, qrDataUrl: "" }
      ]
    },
    {
      category: "สายไฟ",
      items: [
        { idx: 3, name: "สาย RG6 100m", barcode: "", sku: "RG6", stock: 12, qrDataUrl: "data:image/png;base64,BBB" }
      ]
    }
  ]
};

test("builder: คืน HTML A4 มีหัวหมวด + แถว + คอลัมน์นับจริง + คงเหลือ + QR img", () => {
  const html = buildStockCheckSheetHtml(SAMPLE);
  assert.match(html, /<!DOCTYPE html>/, "ต้องเป็นหน้า HTML เต็ม");
  assert.match(html, /size:\s*A4/i, "ต้องตั้ง @page A4");
  assert.match(html, /ใบเช็คสต็อก/, "หัวกระดาษต้องมีชื่อใบ");
  assert.match(html, /รถคันแดง/, "ต้องแสดงชื่อคลัง");
  assert.match(html, /งานดาวเทียม/, "ต้องมีหัวข้อหมวด 1");
  assert.match(html, /สายไฟ/, "ต้องมีหัวข้อหมวด 2");
  assert.match(html, /จานดาวเทียม 60cm/, "ต้องมีชื่อสินค้า");
  assert.match(html, /นับจริง/, "ต้องมีคอลัมน์ 'นับจริง'");
  assert.match(html, /คงเหลือ/, "ต้องมีคอลัมน์คงเหลือ");
  // QR img จาก qrDataUrl
  assert.match(html, /<img class="qr" src="data:image\/png;base64,AAA"/, "ต้องฝัง QR data-URL เป็น <img>");
  // ตัวไม่มี qrDataUrl → ไม่มี <img> ว่าง (ใช้ placeholder)
  assert.match(html, /qr-none/, "ตัวที่ไม่มี QR ต้องเป็น placeholder ไม่ใช่ <img src=\"\">");
});

test("builder: ❌ ไม่มีคอลัมน์/คำว่า ราคา/ต้นทุน/cost (stock-check ไม่ใช่ valuation)", () => {
  const html = buildStockCheckSheetHtml(SAMPLE);
  assert.doesNotMatch(html, /ราคา/, "ห้ามมีคำว่า 'ราคา'");
  assert.doesNotMatch(html, /ต้นทุน/, "ห้ามมีคำว่า 'ต้นทุน'");
  assert.doesNotMatch(html, /\bcost\b/i, "ห้ามมีคำว่า cost");
  assert.doesNotMatch(html, /฿/, "ห้ามมีสัญลักษณ์เงิน ฿");
});

test("builder: escape ค่าผู้ใช้ (XSS) — <script> ใน name/barcode ต้องถูก escape", () => {
  const html = buildStockCheckSheetHtml({
    warehouseName: "<b>x</b>",
    dateStr: "d",
    groups: [{
      category: "<script>alert(1)</script>",
      items: [{ idx: 1, name: "<script>bad()</script>", barcode: "<img onerror=1>", sku: "s", stock: 1, qrDataUrl: "" }]
    }]
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "หมวด: ต้องไม่หลุด <script> ดิบ");
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/, "ชื่อสินค้า: ต้องไม่หลุด <script> ดิบ");
  assert.match(html, /&lt;script&gt;/, "ต้อง escape เป็น &lt;script&gt;");
  assert.doesNotMatch(html, /<img onerror=1>/, "barcode: ต้องไม่หลุด <img onerror>");
});

test("builder: groups ว่าง → แสดงข้อความว่าง ไม่ error", () => {
  const html = buildStockCheckSheetHtml({ warehouseName: "x", dateStr: "d", groups: [] });
  assert.match(html, /ไม่มีสินค้านับสต็อก/, "groups ว่างต้องโชว์ empty state");
});

// ── source-regex: orchestrator ใน products.js ────────────────────────────────
const products = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

function fnBody(name) {
  let start = products.indexOf(`async function ${name}`);
  if (start < 0) start = products.indexOf(`function ${name}`);
  assert.ok(start >= 0, `must define ${name}`);
  const open = products.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < products.length; i++) {
    if (products[i] === "{") depth++;
    else if (products[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return products.slice(start, i);
}

test("products: ปุ่ม prodStockSheetBtn อยู่ในเมนู + wire openStockCheckSheet", () => {
  assert.match(products, /id="prodStockSheetBtn"/, "ต้องมีปุ่ม prodStockSheetBtn");
  assert.match(products, /"#prodStockSheetBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*openStockCheckSheet\(ctx\)\)/,
    "ปุ่มต้อง wire ไป openStockCheckSheet(ctx)");
  assert.match(products, /import \{ buildStockCheckSheetHtml \} from "\.\/stock_check_sheet\.js"/,
    "ต้อง import builder");
});

test("products: openStockCheckSheet = read-only (ไม่มี XHR/fetch/PATCH/POST)", () => {
  const body = fnBody("openStockCheckSheet");
  assert.doesNotMatch(body, /XMLHttpRequest|fetch\s*\(|_appXhr|"PATCH"|"POST"|"PUT"|"DELETE"/,
    "ใบเช็คสต็อก ต้อง read-only — ห้ามเขียน DB");
  assert.match(body, /_currentWarehouseProducts\(state\)/, "ต้อง scope ตามคลังที่เลือก (Phase 450 helper)");
  assert.match(body, /getDisplayStock\(state, p\)\.stock/, "คงเหลือ ต้องมาจาก getDisplayStock (warehouse-aware)");
  assert.match(body, /buildStockCheckSheetHtml\(/, "ต้องเรียก pure builder");
});
