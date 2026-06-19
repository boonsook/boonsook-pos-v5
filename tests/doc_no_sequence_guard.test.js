// Phase B2 — document-number integrity guard (QT / INV / RC)
// Run: npm test
//
// audit AUDIT_2026-06-19_BUILD500_ROUND2.md finding B2:
//   client-side doc-no generation could collide (qt_no from capped state.length+1;
//   inv_no/receipt_no from Date.now().slice(-3)) with NO DB UNIQUE → duplicate
//   tax-document numbers. Fix: numbers are now assigned by a DB BEFORE INSERT
//   trigger (gapless sequential per day, UNIQUE backstop) — see
//   supabase-phaseB2-doc-no-sequence.sql. The client keeps only a
//   collision-resistant fallback (full-timestamp) and reads the real number
//   back from the insert response.
//
// These source-regex guards lock the client side (the DB trigger itself is
// verified at the DB, not here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quotationsSrc = readFileSync(new URL("../modules/quotations.js", import.meta.url), "utf8");
const deliverySrc   = readFileSync(new URL("../modules/delivery_invoices.js", import.meta.url), "utf8");

test("B2: qt_no fallback no longer derives a counter from the capped state array", () => {
  assert.ok(!quotationsSrc.includes("state.quotations?.length||0)+1"),
    "qt_no must not use state.quotations.length+1 (capped ≤50 → repeats)");
  assert.ok(!quotationsSrc.includes("_ctx.state.quotations?.length"),
    "qt_no must not read the capped quotations array length for numbering");
});

test("B2: inv_no / receipt_no fallback no longer uses 3-digit Date.now() suffix", () => {
  assert.ok(!quotationsSrc.includes('"INV" + ds + String(Date.now()).slice(-3)'),
    "inv_no must not use the collision-prone 3-digit ms suffix");
  assert.ok(!deliverySrc.includes('"RC" + ds + String(Date.now()).slice(-3)'),
    "receipt_no must not use the collision-prone 3-digit ms suffix");
  // collision-resistant fallback present (6-digit) until the DB trigger is applied
  assert.ok(quotationsSrc.includes('"INV" + ds + String(Date.now()).slice(-6)'), "inv_no fallback widened to 6 digits");
  assert.ok(deliverySrc.includes('"RC" + ds + String(Date.now()).slice(-6)'),   "receipt_no fallback widened to 6 digits");
});

test("B2: convert toasts use the DB-assigned number from the insert response", () => {
  assert.ok(quotationsSrc.includes("invRes.data?.inv_no || invNo"),
    "delivery-invoice toast must read inv_no from the insert response");
  assert.ok(quotationsSrc.includes('"สร้างใบส่งสินค้าแล้ว: " + realInvNo'),
    "success toast must show the real (DB) inv_no");
  assert.ok(deliverySrc.includes("rcRes.data?.receipt_no || receiptNo"),
    "receipt toast must read receipt_no from the insert response");
  assert.ok(deliverySrc.includes('"ออกใบเสร็จรับเงินแล้ว: " + realReceiptNo'),
    "success toast must show the real (DB) receipt_no");
});
