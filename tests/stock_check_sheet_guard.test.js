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
        { idx: 1, name: "จานดาวเทียม 60cm", barcode: "2000001", sku: "SAT60", stock: 3, barcodeDataUrl: "data:image/png;base64,AAA" },
        { idx: 2, name: "LNB Universal", barcode: "2000002", sku: "LNB1", stock: 0, barcodeDataUrl: "" }
      ]
    },
    {
      category: "สายไฟ",
      items: [
        { idx: 1, name: "สาย RG6 100m", barcode: "", sku: "RG6", stock: 12, barcodeDataUrl: "data:image/png;base64,BBB" }
      ]
    }
  ]
};

test("builder: คืน HTML A4 มีหัวหมวด + แถว + คอลัมน์นับจริง + คงเหลือ + บาร์โค้ด img", () => {
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
  // หัวคอลัมน์ "บาร์โค้ด" (1D) ไม่ใช่ "QR"
  assert.match(html, /<th class="c-bc">บาร์โค้ด<\/th>/, "หัวคอลัมน์ต้องเป็น 'บาร์โค้ด'");
  assert.doesNotMatch(html, />QR</, "ต้องไม่มีหัวคอลัมน์ QR แล้ว");
  // barcode img จาก barcodeDataUrl
  assert.match(html, /<img class="bc" src="data:image\/png;base64,AAA"/, "ต้องฝังบาร์โค้ด data-URL เป็น <img class=bc>");
  // ตัวไม่มี barcodeDataUrl → placeholder
  assert.match(html, /qr-none/, "ตัวที่ไม่มีบาร์โค้ด ต้องเป็น placeholder ไม่ใช่ <img src=\"\">");
});

test("builder: เลขลำดับ # นับใหม่ต่อหมวด (1,2,1,2 ไม่ใช่ 1,2,3,4)", () => {
  const html = buildStockCheckSheetHtml({
    warehouseName: "x", dateStr: "d",
    groups: [
      { category: "A", items: [
        { idx: 1, name: "a1", barcode: "1", sku: "", stock: 1, barcodeDataUrl: "" },
        { idx: 2, name: "a2", barcode: "2", sku: "", stock: 1, barcodeDataUrl: "" }
      ]},
      { category: "B", items: [
        { idx: 1, name: "b1", barcode: "3", sku: "", stock: 1, barcodeDataUrl: "" },
        { idx: 2, name: "b2", barcode: "4", sku: "", stock: 1, barcodeDataUrl: "" }
      ]}
    ]
  });
  const idxCells = [...html.matchAll(/<td class="c-idx">(\d*)<\/td>/g)].map(m => m[1]);
  assert.deepEqual(idxCells, ["1", "2", "1", "2"], "แต่ละหมวดต้องเริ่มนับ 1 ใหม่");
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

test("products: ใบเช็คสต็อกใช้แท่งบาร์โค้ด 1D (JsBarcode + canvas.toDataURL) + เลขต่อหมวด", () => {
  const body = fnBody("openStockCheckSheet");
  assert.match(body, /await loadBarcodeLib\(\)/, "ต้องโหลด barcode lib (เลิกใช้ QR ในใบนี้)");
  assert.match(body, /JsBarcode\(canvas,\s*t,\s*\{[^}]*format:\s*"CODE128"/, "ต้องเรนเดอร์ CODE128 ด้วย JsBarcode");
  assert.match(body, /canvas\.toDataURL\("image\/png"\)/, "ต้องฝังเป็น data-URL");
  assert.match(body, /barcodeDataUrl:\s*barcodeDataUrlFor\(/, "item ต้องมี field barcodeDataUrl");
  assert.doesNotMatch(body, /new QRCode\(/, "ใบนี้ต้องไม่ใช้ QRCode แล้ว");
  // เลขลำดับนับใหม่ต่อหมวด: map items ใส่ idx = i + 1
  assert.match(body, /items:\s*items\.map\(\(it,\s*i\)\s*=>\s*\(\{\s*\.\.\.it,\s*idx:\s*i \+ 1\s*\}\)\)/,
    "idx ต้องนับ 1..N ใหม่ต่อหมวด");
});

test("products: loadBarcodeLib ใช้ JsBarcode CDN เดิม (อยู่ใน CSP) + ไม่ลบ loadQrLib", () => {
  assert.match(products, /function loadBarcodeLib\(\)/, "ต้องมี loadBarcodeLib");
  assert.match(products, /jsbarcode@3\.11\.6\/dist\/JsBarcode\.all\.min\.js/, "ต้องใช้ JsBarcode CDN เดิม");
  assert.match(products, /function loadQrLib\(\)/, "ห้ามลบ loadQrLib (module อื่นใช้)");
});
