// Phase 448a — accountant read-only on operational documents (client gate)
// Run: node --test tests/accountant_doc_readonly_guard.test.js
//
// Contract: สำนักงานบัญชี (accountant) = "อ่านอย่างเดียว" บน receipts/quotations/delivery_invoices.
//   ทุก write handler (สร้าง/แก้/ยกเลิก/ลบ/เก็บเงิน/แปลงใบเสร็จ) ต้องเรียก _denyWriteForAccountant()
//   เป็นด่านแรก (early-return + toast). RLS (448b) = backstop ระดับ DB.
//   Source-level checks (write handler ผูกกับ DOM/ใบเสร็จจริง — unit-test ตรงไม่ได้).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// minGuards = จำนวน write entry ที่ verify มาแล้วต่อ module (กันมีคนถอด guard ออก)
const MODULES = {
  receipts:          { file: "modules/receipts.js",          minGuards: 6 }, // bulk-cancel/bulk-delete/collect/cancel/delete/edit-save
  quotations:        { file: "modules/quotations.js",        minGuards: 3 }, // bulk-cancel/bulk-delete/saveQuotationFull
  delivery_invoices: { file: "modules/delivery_invoices.js", minGuards: 5 }, // bulk-cancel/bulk-delete/delete/edit-save/convertToReceipt
};

for (const [name, { file, minGuards }] of Object.entries(MODULES)) {
  const src = fs.readFileSync(path.resolve(file), "utf8");

  test(`${name}: defines _denyWriteForAccountant gate (role === accountant, toast, no silent)`, () => {
    assert.match(src, /function _denyWriteForAccountant\s*\(\s*\)/, "must define the gate helper");
    assert.match(src, /window\.App\?\.state\?\.profile\?\.role\s*===\s*"accountant"/,
      "gate must check accountant via window.App.state.profile.role");
    assert.match(src, /window\.App\?\.showToast/, "gate must toast (อ่านอย่างเดียว) — no silent block");
  });

  test(`${name}: every write path is gated (>= ${minGuards} call sites)`, () => {
    const guards = (src.match(/if\s*\(_denyWriteForAccountant\(\)\)\s*return;/g) || []).length;
    assert.ok(guards >= minGuards,
      `${name} must gate >= ${minGuards} write paths with _denyWriteForAccountant(); found ${guards}`);
  });
}
