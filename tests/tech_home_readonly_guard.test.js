// tech_home_readonly_guard.test.js
// พิสูจน์ว่าหน้าหลักช่าง "อ่านอย่างเดียว" — กันไม่ให้มีใครเผลอเพิ่มโค้ดเขียน
// ที่กระทบคลัง/สินค้า/การเงิน ในอนาคต (แพตเทิร์นเดียวกับ dashboard_readonly_guard)
//
// รัน: node --test tests/tech_home_readonly_guard.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RAW = readFileSync(new URL("../modules/tech_home.js", import.meta.url), "utf8");

// ตรวจเฉพาะ "โค้ดจริง" — ตัดคอมเมนต์ออกก่อน (คอมเมนต์อธิบายจงใจพูดถึงคำต้องห้าม
// ในเชิง "ห้ามใช้" จึงต้องไม่ทำให้ test false-positive)
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
  .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (กัน // ที่อยู่ใน URL/string ทั่วไป)

// คำที่ "ห้ามมี" ในไฟล์ — แต่ละคำ = เส้นทางเขียน/แตะเงิน-สต็อก
const FORBIDDEN = [
  // สต็อก / คลัง
  "_appApplyStockMovement",
  "transfer_warehouse_stock",
  "_atomicDecrementStock",
  "_atomicAddStock",
  "warehouse_stock",
  "stock_movements",   // ← ยกเว้น showRoute('stock_movements') ซึ่งเป็น "ชื่อ route" ไม่ใช่การเขียนตาราง (ดูหมายเหตุด้านล่าง)
  // บัญชี / การเงิน
  "postJournalForSale",
  "postJournalForServiceJob",
  "journal_entries",
  "journal_lines",
  // เขียน DB ทั่วไป
  ".insert(",
  ".update(",
  ".upsert(",
  ".delete(",
  "xhrPost",
  "xhrPatch",
  "_appXhrPost",
  "method: \"POST\"",
  "method: \"PATCH\"",
  "method: \"DELETE\"",
];

// หมายเหตุ: `showRoute('stock_movements')` เป็นการ "นำทาง" ไม่ใช่เขียนตาราง
// จึงอนุญาต string 'stock_movements' เฉพาะในรูปแบบ data-go / showRoute เท่านั้น
const ALLOWED_STOCK_ROUTE = /(data-go="stock_movements"|showRoute\(\s*["']stock_movements["']\s*\))/g;

test("tech_home.js ต้องไม่มีเส้นทางเขียน DB / สต็อก / บัญชี", () => {
  // ตัด occurrence ของ route ที่อนุญาตออกก่อนตรวจ
  const cleaned = SRC.replace(ALLOWED_STOCK_ROUTE, "");
  for (const bad of FORBIDDEN) {
    assert.ok(!cleaned.includes(bad), `พบคำต้องห้าม "${bad}" ใน tech_home.js — หน้านี้ต้อง read-only`);
  }
});

test("tech_home.js ต้อง export renderTechHome", () => {
  assert.match(SRC, /export function renderTechHome\s*\(/);
});

test("tech_home.js อ่านจาก state เท่านั้น (มี state.serviceJobs / state.products)", () => {
  assert.ok(SRC.includes("state.serviceJobs"), "ต้องอ่าน state.serviceJobs");
  assert.ok(SRC.includes("state.products"), "ต้องอ่าน state.products");
});

test("bindings ต้องเป็น showRoute (นำทาง) เท่านั้น — ไม่ผูก submit/save", () => {
  assert.ok(SRC.includes("showRoute(target)"), "ปุ่มต้องเรียก showRoute");
  assert.ok(!/addEventListener\(\s*["']submit["']/.test(SRC), "ต้องไม่มี form submit handler");
});
