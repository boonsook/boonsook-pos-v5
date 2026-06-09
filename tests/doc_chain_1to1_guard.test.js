// Phase 409 — Document chain 1:1 guard
// บังคับ 1:1 ทั้งเชน: quotation→ใบส่งของ, ใบส่งของ→ใบเสร็จ
// เดิม branch active.length>0 = confirm-to-proceed (กดยืนยันออกซ้ำได้) → เปลี่ยนเป็น block (showToast + return)
//
// Source-regex (iron rule #5: extract function body ก่อน) — ตรวจ behavior ของ branch active เท่านั้น
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

// ดึง source ของ 1 ฟังก์ชัน (จาก decl ถึง decl ของฟังก์ชันถัดไป)
function fnSource(src, decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const after = src.indexOf("\nasync function ", start + decl.length);
  const end = after === -1 ? src.indexOf("\nfunction ", start + decl.length) : after;
  return src.slice(start, end === -1 ? undefined : end);
}

// ดึง body ของ branch `if (active.length > 0) { ... } else {`
function activeBranch(fn) {
  const m = fn.match(/if\s*\(active\.length\s*>\s*0\)\s*\{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(m, "ไม่พบ branch if (active.length > 0) { ... } else {");
  return m[1];
}

// ดึง body ของ else branch (หลัง } else { ถึง } ปิด try ก่อน catch)
function elseBranch(fn) {
  const m = fn.match(/\}\s*else\s*\{([\s\S]*?)\}\s*catch/);
  assert.ok(m, "ไม่พบ else branch ก่อน catch");
  return m[1];
}

const CASES = [
  { file: "modules/quotations.js",        decl: "async function convertToDeliveryInvoice(q) {", noProp: "inv_no",     label: "convertToDeliveryInvoice" },
  { file: "modules/delivery_invoices.js", decl: "async function convertToReceipt(inv) {",        noProp: "receipt_no", label: "convertToReceipt" },
];

for (const c of CASES) {
  test(`${c.label}: branch active → showToast + return, ไม่มี confirm-to-proceed`, () => {
    const fn = fnSource(read(c.file), c.decl);
    const branch = activeBranch(fn);
    assert.match(branch, /showToast\s*\?\.\(/, "branch active ต้องเรียก showToast");
    assert.match(branch, /\breturn\s*;/, "branch active ต้อง return (ไม่สร้างซ้ำ)");
    assert.ok(
      !/window\.App\?\.confirm\?\./.test(branch),
      "branch active ต้องไม่มี confirm-to-proceed แล้ว (block ไม่ใช่ confirm)"
    );
    assert.match(branch, new RegExp(`d\\.${c.noProp}`), `แสดงเลขเอกสารผ่าน ${c.noProp}`);
  });

  test(`${c.label}: ยัง filter status !== "cancelled" + else ยัง confirm เดิม`, () => {
    const fn = fnSource(read(c.file), c.decl);
    assert.match(fn, /status\s*!==\s*"cancelled"/, "ต้องคง filter cancelled (ใบ cancelled ไม่บล็อก)");
    const els = elseBranch(fn);
    assert.match(els, /window\.App\?\.confirm\?\./, "branch else (ไม่มี active) ต้องยัง confirm ปกติ");
  });
}
