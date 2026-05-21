// Phase 92.14 — verify-slip verification logic (money audit 4.1 "mismatch confirm")
// The 3 service forms (ac_install / service_form / solar) render "✅ ผ่านการตรวจสอบ"
// when verification.is_safe === true. A mismatch — or an UNREADABLE slip amount when an
// expected amount is known — must NOT report is_safe:true (else staff trust a false green).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlipVerification } from "../functions/api/verify-slip.js";

test("amount matches expected → safe, no warnings", () => {
  const v = buildSlipVerification({ is_slip: true, amount: 1500, confidence: 90, tampering_score: 5 }, 1500, "");
  assert.equal(v.amount_match, true);
  assert.equal(v.is_safe, true);
  assert.equal(v.warnings.length, 0);
});

test("amount mismatch → warning + not safe", () => {
  const v = buildSlipVerification({ is_slip: true, amount: 1400, confidence: 90, tampering_score: 5 }, 1500, "");
  assert.equal(v.amount_match, false);
  assert.equal(v.is_safe, false);
  assert.ok(v.warnings.some(w => w.includes("ยอดเงินไม่ตรง")));
});

test("HARDENING: expected amount but slip amount unreadable (0) → not safe, asks to confirm", () => {
  const v = buildSlipVerification({ is_slip: true, amount: 0, confidence: 90, tampering_score: 5 }, 1500, "");
  assert.equal(v.amount_match, false, "cannot confirm a match when slip amount is unreadable");
  assert.equal(v.is_safe, false, "must not show a false green when amount was never verified");
  assert.ok(v.warnings.some(w => w.includes("อ่านยอดในสลิปไม่ได้")));
});

test("no expected amount → amount not checked (advisory mode stays safe)", () => {
  const v = buildSlipVerification({ is_slip: true, amount: 0, confidence: 90, tampering_score: 5 }, 0, "");
  assert.equal(v.amount_match, undefined);
  assert.equal(v.is_safe, true);
});

test("tampering score >= 30 → warning + not safe", () => {
  const v = buildSlipVerification({ is_slip: true, amount: 1500, confidence: 90, tampering_score: 55 }, 1500, "");
  assert.equal(v.is_safe, false);
  assert.ok(v.warnings.some(w => w.includes("ตัดต่อ")));
});

test("not a slip → warning + not safe even if amount matches", () => {
  const v = buildSlipVerification({ is_slip: false, amount: 1500, confidence: 90, tampering_score: 0 }, 1500, "");
  assert.equal(v.is_safe, false);
  assert.ok(v.warnings.some(w => w.includes("ไม่ใช่สลิป")));
});

test("recipient mismatch → warning + not safe", () => {
  const v = buildSlipVerification(
    { is_slip: true, amount: 1500, confidence: 90, tampering_score: 0, recipient_name: "ร้านอื่น" },
    1500, "บุญสุข"
  );
  assert.equal(v.recipient_match, false);
  assert.equal(v.is_safe, false);
});

test("recipient match (normalized, ignores prefix/bank) → safe", () => {
  const v = buildSlipVerification(
    { is_slip: true, amount: 1500, confidence: 90, tampering_score: 0, recipient_name: "ร้าน บุญสุข SCB" },
    1500, "บุญสุข"
  );
  assert.equal(v.recipient_match, true);
  assert.equal(v.is_safe, true);
});
