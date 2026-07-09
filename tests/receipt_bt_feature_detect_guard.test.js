// Phase 585 — Bluetooth slip printer feature-detect + chunking + print-fallback null-guard
//
// Why: iOS บล็อก Web Bluetooth ทุกเบราว์เซอร์ → ต้อง feature-detect ก่อน ไม่ crash undefined.
// sendChunked ต้องไม่ยิงก้อนใหญ่เกิน MTU (เครื่องค้าง). และ window.print() เดิม (main.js/receipts.js)
// window.open อาจคืน null (popup block) → ต้องมี null-guard ไม่ throw เงียบ.
// Run: node --test tests/receipt_bt_feature_detect_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { connectSlipPrinter, isSlipSupported, sendChunked } from "../modules/receipt_bt.js";

test("(1) isSlipSupported() = false เมื่อไม่มี navigator.bluetooth (เช่น Node / iOS)", () => {
  // Node ไม่มี navigator.bluetooth → ต้องคืน false (ไม่ throw)
  assert.equal(isSlipSupported(), false);
});

test("(2) connectSlipPrinter reject ด้วยข้อความ Android/Chrome เมื่อไม่รองรับ (ไม่ throw undefined)", async () => {
  await assert.rejects(
    () => connectSlipPrinter(),
    (err) => {
      assert.ok(err instanceof Error, "ต้องเป็น Error object (ไม่ใช่ TypeError undefined)");
      assert.match(err.message, /Android|Chrome/, "ข้อความต้องบอกให้ใช้ Android + Chrome");
      return true;
    }
  );
});

test("(3) sendChunked แบ่ง chunk ≤ MTU + ครบทุก byte (write ธรรมดา)", async () => {
  const writes = [];
  const char = { properties: { write: true }, async writeValue(slice) { writes.push(slice.length); } };
  await sendChunked(char, new Uint8Array(450));
  assert.ok(writes.length >= 2, "450 byte ต้องแบ่งหลาย chunk");
  assert.ok(Math.max(...writes) <= 200, "ทุก chunk ต้อง ≤ 200 byte (MTU-safe)");
  assert.equal(writes.reduce((a, b) => a + b, 0), 450, "รวมทุก chunk = จำนวน byte เดิม (ไม่ตกหล่น)");
});

test("(4) sendChunked เลือก writeWithoutResponse ก่อน ถ้าเครื่องรองรับ", async () => {
  const woResp = [];
  let usedWrite = false;
  const char = {
    properties: { writeWithoutResponse: true },
    async writeValueWithoutResponse(slice) { woResp.push(slice.length); },
    async writeValue() { usedWrite = true; }
  };
  await sendChunked(char, new Uint8Array(50));
  assert.equal(woResp.length, 1, "ต้องใช้ writeValueWithoutResponse");
  assert.equal(usedWrite, false, "ต้องไม่เรียก writeValue เมื่อมี writeWithoutResponse");
});

test("(5) window.print() fallback: main.js + receipts.js มี null-guard window.open (popup block)", () => {
  const main = fs.readFileSync(path.resolve("main.js"), "utf8");
  const receipts = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");
  // main.js printLastReceipt: const w = window.open(...) ตามด้วย if(!w)
  assert.match(main, /const w = window\.open\("", "_blank"\);\s*\n?\s*if \(!w\)/,
    "main.js printLastReceipt ต้อง null-guard w ก่อนใช้");
  assert.match(receipts, /const w = window\.open\("","_blank"\);\s*if \(!w\)/,
    "receipts.js rcPrintBtn ต้อง null-guard w ก่อนใช้");
});

test("(6) receipt_bt.js: import ได้ใน Node (ไม่มี DOM/navigator access ตอน import)", async () => {
  // ถ้า module แตะ document/navigator ที่ top-level จะ throw ตอน import แล้ว — ผ่านมาถึงนี่ = ปลอดภัย
  const mod = await import("../modules/receipt_bt.js");
  for (const fn of ["connectSlipPrinter", "printReceipt", "testPrint", "canvasToEscposRaster", "isSlipConnected", "getSlipDeviceName", "disconnectSlip", "renderReceiptCanvas"]) {
    assert.equal(typeof mod[fn], "function", `ต้อง export ${fn}`);
  }
});
