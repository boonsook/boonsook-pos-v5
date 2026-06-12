import { test } from "node:test";
import assert from "node:assert/strict";

import {
  _receiptFinancialTotal,
  _receiptMatchesSearchDate,
  _receiptStatusCounts
} from "../modules/receipts.js";

test("receipt status counts use the same search/date scope as the visible table", () => {
  const receipts = [
    { status: "cancelled", created_at: "2026-06-01T10:00:00Z", receipt_no: "RC-OLD", customer_name: "Alpha", delivery_invoice_id: 1, grand_total: 100 },
    { status: "cancelled", created_at: "2026-06-02T10:00:00Z", receipt_no: "RC-OLD2", customer_name: "Beta", delivery_invoice_id: 2, grand_total: 200 },
    { status: "pending", created_at: "2026-06-12T10:00:00Z", receipt_no: "RC-NEW", customer_name: "Gamma", delivery_invoice_id: 3, grand_total: 300 }
  ];

  const scoped = receipts.filter(r => _receiptMatchesSearchDate(r, { cutoff: "2026-06-12", q: "" }));
  assert.deepEqual(_receiptStatusCounts(scoped), {
    all: 1,
    pending: 1,
    paid: 0,
    cancelled: 0
  });
});

test("receipt search/date scope matches receipt number, customer, and delivery invoice id", () => {
  const receipt = {
    status: "pending",
    created_at: "2026-06-12T10:00:00Z",
    receipt_no: "RC20260612113",
    customer_name: "โรงพยาบาลสมม",
    delivery_invoice_id: 149
  };

  assert.equal(_receiptMatchesSearchDate(receipt, { cutoff: "2026-06-12", q: "rc202606" }), true);
  assert.equal(_receiptMatchesSearchDate(receipt, { cutoff: "2026-06-12", q: "149" }), true);
  assert.equal(_receiptMatchesSearchDate(receipt, { cutoff: "2026-06-13", q: "" }), false);
});

test("receipt financial total excludes cancelled receipts", () => {
  const receipts = [
    { status: "cancelled", grand_total: 12300 },
    { status: "paid", grand_total: 800 },
    { status: "pending", grand_total: 500 }
  ];

  assert.equal(_receiptFinancialTotal(receipts), 1300);
});
