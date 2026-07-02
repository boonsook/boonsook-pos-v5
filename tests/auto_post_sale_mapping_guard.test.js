// Audit fix — guard: sale payment_method → JV mapping key selection
// บั๊กเดิม: regex `/credit_term|เครดิต/` จับ "บัตรเครดิต" (substring "เครดิต") →
//   บิลบัตรลง Dr 1200 (ลูกหนี้) แทน 1130 (เงินรับบัตร) = A/R พองผิดทุกบิลบัตร.
// Test นี้ fail ถ้า mapping กลับไปผิด (บัตรเครดิต → term) หรือ credit-sale ไม่เข้า A/R.
// Run: node --test tests/auto_post_sale_mapping_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window || {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  App: { showToast: () => {} },
};

const { _selectSaleMappingKey } = await import("../modules/accounting/auto_post.js");

test("บัตรเครดิต (POS card/EDC) → sale_credit (Dr 1130) ไม่ใช่ sale_credit_term (Dr 1200)", () => {
  // ★ นี่คือบั๊กจริงที่ audit เจอ: payment_method ที่ POS ส่งคือ "บัตรเครดิต"
  assert.equal(_selectSaleMappingKey({ payment_method: "บัตรเครดิต" }), "sale_credit");
  assert.equal(_selectSaleMappingKey({ payment_method: "บัตรเครดิต/EDC" }), "sale_credit");
});

test("เงินสด → sale_cash (Dr 1110)", () => {
  assert.equal(_selectSaleMappingKey({ payment_method: "เงินสด" }), "sale_cash");
  assert.equal(_selectSaleMappingKey({ payment_method: "" }), "sale_cash");
  assert.equal(_selectSaleMappingKey({}), "sale_cash");
});

test("โอนเงิน / QR พร้อมเพย์ → sale_transfer (Dr 1130)", () => {
  assert.equal(_selectSaleMappingKey({ payment_method: "โอนเงิน" }), "sale_transfer");
  assert.equal(_selectSaleMappingKey({ payment_method: "QR พร้อมเพย์" }), "sale_transfer");
});

test("ขายเชื่อ: is_credit=true → sale_credit_term (Dr 1200 ลูกหนี้) แม้ payment_method จะไม่ใช่เครดิต", () => {
  // is_credit เป็นสัญญาณหลักของขายเชื่อ (dashboard.js ก็จำแนกด้วย is_credit)
  assert.equal(_selectSaleMappingKey({ is_credit: true, payment_method: "เงินสด" }), "sale_credit_term");
  assert.equal(_selectSaleMappingKey({ is_credit: true }), "sale_credit_term");
});

test("เงินเชื่อ (string) → sale_credit_term (Dr 1200)", () => {
  assert.equal(_selectSaleMappingKey({ payment_method: "เงินเชื่อ" }), "sale_credit_term");
  assert.equal(_selectSaleMappingKey({ payment_method: "ขายเชื่อ" }), "sale_credit_term");
});

test("is_credit ชนะ card string: บิลเครดิตที่ระบุบัตรก็ยังเป็น A/R (ป้องกัน mis-route)", () => {
  assert.equal(_selectSaleMappingKey({ is_credit: true, payment_method: "บัตรเครดิต" }), "sale_credit_term");
});
