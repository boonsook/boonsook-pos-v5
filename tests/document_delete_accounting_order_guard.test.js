// Guard money/stock document delete order:
// - hard deletes must void accounting JV before deleting source rows/items
// - receipt preview actions must only post/void JV after the status PATCH succeeds

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const receiptsSrc = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");
const deliverySrc = fs.readFileSync(path.resolve("modules/delivery_invoices.js"), "utf8");

function sliceFrom(src, marker, length = 2600) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  return src.slice(start, start + length);
}

test("receipt hard delete voids JV before deleting receipt items/header", () => {
  const body = sliceFrom(receiptsSrc, 'getElementById("rcDeleteBtn")', 2800);
  const voidIdx = body.indexOf('voidJvForSource("receipts", r.id)');
  const delItemsIdx = body.indexOf('receipt_items?receipt_id=eq." + r.id');
  const delHeaderIdx = body.indexOf('receipts?id=eq." + r.id');
  assert.ok(voidIdx > 0, "receipt delete voids accounting JV");
  assert.ok(delItemsIdx > 0, "receipt delete removes receipt_items");
  assert.ok(delHeaderIdx > 0, "receipt delete removes receipt header");
  assert.ok(voidIdx < delItemsIdx, "void JV must happen before deleting receipt_items");
  assert.ok(voidIdx < delHeaderIdx, "void JV must happen before deleting receipt header");
});

test("receipt bulk hard delete voids JV before deleting receipt items/header", () => {
  const body = sliceFrom(receiptsSrc, 'getElementById("rcBulkDelete")', 2600);
  const voidIdx = body.indexOf('voidJvForSource("receipts", id)');
  const delItemsIdx = body.indexOf('receipt_items?receipt_id=eq." + id');
  const delHeaderIdx = body.indexOf('receipts?id=eq." + id');
  assert.ok(voidIdx > 0, "receipt bulk delete voids accounting JV");
  assert.ok(delItemsIdx > 0, "receipt bulk delete removes receipt_items");
  assert.ok(delHeaderIdx > 0, "receipt bulk delete removes receipt header");
  assert.ok(voidIdx < delItemsIdx, "bulk void JV must happen before deleting receipt_items");
  assert.ok(voidIdx < delHeaderIdx, "bulk void JV must happen before deleting receipt header");
});

test("delivery invoice hard delete voids JV before deleting invoice items/header", () => {
  const body = sliceFrom(deliverySrc, 'getElementById("diDeleteBtn")', 2800);
  const precheckIdx = body.indexOf("_invoiceHasReceipt(inv.id)");
  const voidIdx = body.indexOf('voidJvForSource("delivery_invoices", inv.id)');
  const delItemsIdx = body.indexOf('delivery_invoice_items?delivery_invoice_id=eq." + inv.id');
  const delHeaderIdx = body.indexOf('delivery_invoices?id=eq." + inv.id');
  assert.ok(precheckIdx > 0, "delivery delete checks receipt FK first");
  assert.ok(voidIdx > 0, "delivery delete voids accounting JV");
  assert.ok(delItemsIdx > 0, "delivery delete removes invoice items");
  assert.ok(delHeaderIdx > 0, "delivery delete removes invoice header");
  assert.ok(precheckIdx < voidIdx, "receipt FK pre-check must happen before void JV");
  assert.ok(voidIdx < delItemsIdx, "void JV must happen before deleting invoice items");
  assert.ok(voidIdx < delHeaderIdx, "void JV must happen before deleting invoice header");
});

test("delivery invoice bulk hard delete voids JV before deleting invoice items/header", () => {
  const body = sliceFrom(deliverySrc, 'getElementById("diBulkDelete")', 2600);
  const precheckIdx = body.indexOf("_invoiceHasReceipt(id)");
  const voidIdx = body.indexOf('voidJvForSource("delivery_invoices", id)');
  const delItemsIdx = body.indexOf('delivery_invoice_items?delivery_invoice_id=eq." + id');
  const delHeaderIdx = body.indexOf('delivery_invoices?id=eq." + id');
  assert.ok(precheckIdx > 0, "delivery bulk delete checks receipt FK first");
  assert.ok(voidIdx > 0, "delivery bulk delete voids accounting JV");
  assert.ok(delItemsIdx > 0, "delivery bulk delete removes invoice items");
  assert.ok(delHeaderIdx > 0, "delivery bulk delete removes invoice header");
  assert.ok(precheckIdx < voidIdx, "bulk receipt FK pre-check must happen before void JV");
  assert.ok(voidIdx < delItemsIdx, "bulk void JV must happen before deleting invoice items");
  assert.ok(voidIdx < delHeaderIdx, "bulk void JV must happen before deleting invoice header");
});

test("receipt preview paid posts JV only after paid status PATCH success is checked", () => {
  const body = sliceFrom(receiptsSrc, 'getElementById("rcPreviewCollect")', 1200);
  const patchIdx = body.indexOf('window._appXhrPatch?.("receipts", { status: "paid" }');
  const guardIdx = body.indexOf("if (!payRes?.ok)");
  const postIdx = body.indexOf("postJournalForReceipt(");
  assert.ok(patchIdx > 0, "paid preview PATCHes receipt status");
  assert.ok(guardIdx > 0, "paid preview checks PATCH result");
  assert.ok(postIdx > 0, "paid preview posts receipt JV");
  assert.ok(patchIdx < guardIdx, "PATCH result is captured before ok guard");
  assert.ok(guardIdx < postIdx, "JV post happens only after ok guard");
});

test("receipt preview cancelled voids JV only after cancelled status PATCH success is checked", () => {
  const body = sliceFrom(receiptsSrc, 'getElementById("rcPreviewCancel")', 1400);
  const patchIdx = body.indexOf('window._appXhrPatch?.("receipts", { status: "cancelled" }');
  const guardIdx = body.indexOf("if (!cancelRes?.ok)");
  const voidIdx = body.indexOf('voidJvForSource("receipts", r.id)');
  assert.ok(patchIdx > 0, "cancel preview PATCHes receipt status");
  assert.ok(guardIdx > 0, "cancel preview checks PATCH result");
  assert.ok(voidIdx > 0, "cancel preview voids receipt JV");
  assert.ok(patchIdx < guardIdx, "PATCH result is captured before ok guard");
  assert.ok(guardIdx < voidIdx, "JV void happens only after ok guard");
});
