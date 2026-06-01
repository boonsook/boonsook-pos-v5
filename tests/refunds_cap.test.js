// Phase 92.61 — Refund over-refund / double-refund cap (regression)
// computeRefundableItems = qty เดิม − qty ที่คืนไปแล้ว ; validateRefundWithinRemaining = guard ตอน save
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { computeRefundableItems, validateRefundWithinRemaining, refundTotal } =
  await import("../modules/refunds.js");

const SALE = [
  { product_id: 10, product_name: "พัดลม", qty: 3, unit_price: 500 },
  { product_id: 20, product_name: "หม้อ",  qty: 2, unit_price: 300 },
];

test("computeRefundableItems — ไม่มี refund เดิม → max_qty = qty เดิม", () => {
  const r = computeRefundableItems(SALE, []);
  assert.equal(r[0].max_qty, 3);
  assert.equal(r[0].refundedQty, 0);
  assert.equal(r[1].max_qty, 2);
  assert.equal(r[0].qty, 0); // เริ่มที่ 0
});

test("computeRefundableItems — เคยคืนบางส่วน → หักออก", () => {
  const prior = [{ items_json: [{ product_id: 10, name: "พัดลม", qty: 1 }] }];
  const r = computeRefundableItems(SALE, prior);
  assert.equal(r[0].max_qty, 2);      // 3 − 1
  assert.equal(r[0].refundedQty, 1);
  assert.equal(r[1].max_qty, 2);      // ไม่ถูกแตะ
});

test("computeRefundableItems — คืนครบแล้ว → max_qty = 0 (กันคืนซ้ำ)", () => {
  const prior = [
    { items_json: [{ product_id: 10, name: "พัดลม", qty: 2 }] },
    { items_json: [{ product_id: 10, name: "พัดลม", qty: 1 }] }, // รวม 3 = เต็ม
  ];
  const r = computeRefundableItems(SALE, prior);
  assert.equal(r[0].max_qty, 0);
  assert.equal(r[0].refundedQty, 3);
});

test("computeRefundableItems — คืนเกิน (data เพี้ยน) → refundedQty cap ที่ qty เดิม, max_qty=0 ไม่ติดลบ", () => {
  const prior = [{ items_json: [{ product_id: 10, name: "พัดลม", qty: 99 }] }];
  const r = computeRefundableItems(SALE, prior);
  assert.equal(r[0].max_qty, 0);
  assert.equal(r[0].refundedQty, 3);
});

test("computeRefundableItems — items_json เป็น string (JSON) ก็ parse ได้", () => {
  const prior = [{ items_json: JSON.stringify([{ product_id: 20, name: "หม้อ", qty: 1 }]) }];
  const r = computeRefundableItems(SALE, prior);
  assert.equal(r[1].max_qty, 1); // 2 − 1
});

test("computeRefundableItems — สินค้าไม่มี product_id → จับคู่ด้วยชื่อ", () => {
  const sale = [{ product_id: null, product_name: "บริการติดตั้ง", qty: 2, unit_price: 100 }];
  const prior = [{ items_json: [{ product_id: null, name: "บริการติดตั้ง", qty: 1 }] }];
  const r = computeRefundableItems(sale, prior);
  assert.equal(r[0].max_qty, 1);
});

test("validateRefundWithinRemaining — ขอคืนไม่เกินที่เหลือ → ok", () => {
  const prior = [{ items_json: [{ product_id: 10, name: "พัดลม", qty: 1 }] }]; // เหลือ 2
  const chk = validateRefundWithinRemaining(
    [{ product_id: 10, name: "พัดลม", qty: 2, unit_price: 500 }], SALE, prior);
  assert.equal(chk.ok, true);
});

test("validateRefundWithinRemaining — ขอคืนเกินที่เหลือ → block + ระบุรายการ", () => {
  const prior = [{ items_json: [{ product_id: 10, name: "พัดลม", qty: 2 }] }]; // เหลือ 1
  const chk = validateRefundWithinRemaining(
    [{ product_id: 10, name: "พัดลม", qty: 2, unit_price: 500 }], SALE, prior);
  assert.equal(chk.ok, false);
  assert.match(chk.offending, /พัดลม/);
});

test("validateRefundWithinRemaining — คืนซ้ำทั้งบิลหลังคืนครบแล้ว → block", () => {
  const prior = [{ items_json: [
    { product_id: 10, name: "พัดลม", qty: 3 },
    { product_id: 20, name: "หม้อ", qty: 2 },
  ] }];
  const chk = validateRefundWithinRemaining(
    [{ product_id: 10, name: "พัดลม", qty: 3 }, { product_id: 20, name: "หม้อ", qty: 2 }], SALE, prior);
  assert.equal(chk.ok, false);
});

test("refundTotal — round2 กัน float drift (regression เดิม)", () => {
  assert.equal(refundTotal([{ qty: 3, unit_price: 33.30 }]), 99.9);
});
