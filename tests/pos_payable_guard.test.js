// Phase 566 — Guard: "ยอดที่ต้องเก็บจริง" เดียวทุกวิธีชำระ (calcPayable)
//   คุม: VAT exclusive โอน/บัตร + หักเครดิต numpad live (updateCollectBtn) ต้องตรงกับ cash-input.
//   pattern: extract body ของ branch ที่เกี่ยว แล้ว assert (ไม่ grep ทั้งไฟล์ — payment-select
//   _payable ยังใช้สูตร inline เดิมโดยตั้งใจ, ห้าม false-positive).
// Run: node --test tests/pos_payable_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcPayable } from "../modules/pos.js";

const SRC = readFileSync(new URL("../modules/pos.js", import.meta.url), "utf8");

// paymentInfo แบบต่าง ๆ — currentDate ส่งชัดเจนกัน todayBkk() drift
const OFF = {};
const EXCL = { vatEnabled: true, vatRate: 7, vatPriceMode: "exclusive", vatEffectiveDate: "2026-01-01" };
const INCL = { vatEnabled: true, vatRate: 7, vatPriceMode: "inclusive", vatEffectiveDate: "2026-01-01" };
const DATE = "2026-07-06";

// ═══════════════════════════════════════════════════════════
//  1. calcPayable — สมการยอดที่ต้องเก็บ
// ═══════════════════════════════════════════════════════════
test("calcPayable — VAT ปิด → amount=base, payable=base", () => {
  const r = calcPayable(100, OFF, 0, DATE);
  assert.equal(r.amount, 100);
  assert.equal(r.payable, 100);
  assert.equal(r.credit, 0);
});

test("calcPayable — VAT ปิด + เครดิต 30 → payable 70", () => {
  const r = calcPayable(100, OFF, 30, DATE);
  assert.equal(r.amount, 100);
  assert.equal(r.credit, 30);
  assert.equal(r.payable, 70);
});

test("calcPayable — exclusive 7% → amount 107, payable 107", () => {
  const r = calcPayable(100, EXCL, 0, DATE);
  assert.equal(r.amount, 107);
  assert.equal(r.payable, 107);
});

test("calcPayable — exclusive 7% + เครดิต 30 → payable 77", () => {
  const r = calcPayable(100, EXCL, 30, DATE);
  assert.equal(r.amount, 107);
  assert.equal(r.credit, 30);
  assert.equal(r.payable, 77);
});

test("calcPayable — inclusive 7% → amount 100, เครดิต 30 → payable 70", () => {
  const r = calcPayable(100, INCL, 30, DATE);
  assert.equal(r.amount, 100);   // inclusive: ยอดรวม VAT อยู่แล้ว
  assert.equal(r.payable, 70);
});

test("calcPayable — เครดิต > ยอด → payable 0 ไม่ติดลบ, credit clamp = ยอด", () => {
  const r = calcPayable(100, OFF, 150, DATE);
  assert.equal(r.payable, 0);
  assert.equal(r.credit, 100);
});

test("calcPayable — เครดิตติดลบ → clamp 0 (defensive)", () => {
  const r = calcPayable(100, OFF, -50, DATE);
  assert.equal(r.credit, 0);
  assert.equal(r.payable, 100);
});

// ═══════════════════════════════════════════════════════════
//  helper slice — extract body ของ branch ตาม anchor (กัน false-positive)
// ═══════════════════════════════════════════════════════════
function slice(from, to) {
  const i = SRC.indexOf(from);
  assert.ok(i >= 0, `anchor เริ่มไม่พบ: ${from}`);
  const j = SRC.indexOf(to, i + from.length);
  assert.ok(j > i, `anchor จบไม่พบหลัง: ${from}`);
  return SRC.slice(i, j);
}

const cashBody = slice('(posView === "cash-input")', '(posView === "transfer-qr")');
const transferBody = slice('(posView === "transfer-qr")', '(posView === "confirm-proof")');
const cardBody = slice('[data-pay-method]', '//  CASH INPUT');
const collectBody = slice('function updateCollectBtn()', 'async function _redeemCheckoutCredit');

// ═══════════════════════════════════════════════════════════
//  2. source-regex — ทุก branch ต้องผ่าน calcPayable, ไม่เหลือสูตร inline เดิม
// ═══════════════════════════════════════════════════════════
test("cash-input ใช้ calcPayable + ไม่เหลือสูตร credit inline เดิม", () => {
  assert.match(cashBody, /calcPayable\(baseAmount, state\.paymentInfo, _creditUsed\)/);
  assert.doesNotMatch(cashBody, /round2\(Math\.min\(_creditUsed, round2\(amount\)\)\)/);
});

test("transfer-qr ใช้ calcPayable + ไม่เหลือ payable inline เดิม", () => {
  assert.match(transferBody, /calcPayable\(amount, state\.paymentInfo, _creditUsed\)/);
  assert.doesNotMatch(transferBody, /round2\(Math\.max\(round2\(amount\) - _creditUsed/);
});

test("card (บัตรเครดิต) ใช้ calcPayable + ไม่เหลือ payable inline เดิม", () => {
  assert.match(cardBody, /pendingPaidAmount = calcPayable\(amount, state\.paymentInfo, _creditUsed\)\.payable/);
  assert.doesNotMatch(cardBody, /round2\(Math\.max\(round2\(amount\) - _creditUsed/);
});

test("updateCollectBtn ใช้ calcPayable (หักเครดิต) — ไม่เหลือ threshold = amount เดิม", () => {
  assert.match(collectBody, /calcPayable\(quickPayAmount \|\| cartSum\([^)]*\), pi, _creditUsed\)\.payable/);
  assert.doesNotMatch(collectBody, /const baseAmount = quickPayAmount;/);
  assert.doesNotMatch(collectBody, /paid >= amount/);
});

// ═══════════════════════════════════════════════════════════
//  3. updateCollectBtn ต้องมี fallback cartSum (ขายจากตะกร้า quickPayAmount ว่าง)
// ═══════════════════════════════════════════════════════════
test("updateCollectBtn — fallback cartSum เมื่อ quickPayAmount ว่าง", () => {
  assert.match(collectBody, /quickPayAmount \|\| cartSum\(/);
});
