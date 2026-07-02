// Audit fix — guard: cash confirm อ่านยอดรับสดจาก numpadValue (ไม่ใช้ closure ค้าง)
// บั๊กเดิม: handler ปุ่ม "เสร็จสิ้น" (posCashConfirmBtn) ใช้ตัวแปร `paid` ที่ capture
//   ตอน render แต่ numpad (bindNumpad) แก้ numpadValue โดยไม่ re-render → ค่าค้าง →
//   พิมพ์ numpad ล้วน = ปุ่มตายเงียบ / กด quick แล้วพิมพ์เพิ่ม = ทอนขาด.
// Test เป็น source-regex บน handler body: fail ถ้ากลับไปใช้ closure ค้าง.
// Run: node --test tests/pos_cash_numpad_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../modules/pos.js"), "utf8");

// ดึงเฉพาะ body ของ handler posCashConfirmBtn click (อย่า grep ทั้งไฟล์ = false positive)
function cashConfirmHandler() {
  const anchor = src.indexOf('posCashConfirmBtn")?.addEventListener("click"');
  assert.ok(anchor !== -1, "หา handler posCashConfirmBtn ไม่เจอ");
  return src.slice(anchor, anchor + 500);
}

test("cash confirm handler อ่านยอดรับจาก numpadValue (ค่าสด)", () => {
  const body = cashConfirmHandler();
  assert.match(body, /Number\(\s*numpadValue/, "ต้องอ่าน numpadValue สด ณ ตอนคลิก");
});

test("cash confirm handler ไม่ set pendingPaidAmount จากตัวแปร paid closure โดยตรง", () => {
  const body = cashConfirmHandler();
  // เดิมเป็น `pendingPaidAmount = paid;` (closure ค้าง) — ต้องไม่มีอีก
  assert.doesNotMatch(body, /pendingPaidAmount\s*=\s*paid\s*;/, "ห้าม assign จาก closure `paid`");
});

test("cash confirm handler ยัง gate ยอดรับ < ที่ต้องจ่าย (ไม่ปล่อยจ่ายขาด)", () => {
  const body = cashConfirmHandler();
  assert.match(body, /<\s*payable\s*\)\s*return/, "ต้องมี guard paidNow < payable → return");
});
