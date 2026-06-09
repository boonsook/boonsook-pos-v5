// Phase 407 — delivery-invoice-delete-receipt-precheck (กัน 409 + บิลพัง)
// Run: node --test tests/di_delete_receipt_precheck_guard.test.js
//
// Deleting a delivery invoice that has a receipt (receipts.delivery_invoice_id FK) used to
// delete the items first, then hit HTTP 409 deleting the header → items gone, header stuck
// = a corrupt invoice (0 lines but a total). Phase 407 pre-checks for receipts BEFORE
// deleting anything and blocks with a clear message. A receipt in ANY status blocks (the FK
// blocks even a cancelled receipt); a failed lookup does NOT block (so a transient error
// can't false-positive-block a legitimate delete).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _invoiceHasReceipt } from "../modules/delivery_invoices.js";

function withWindow(mockFetch, fn) {
  const prev = globalThis.window;
  globalThis.window = { SUPABASE_CONFIG: { url: "http://test" }, _appAuthFetch: mockFetch };
  return Promise.resolve(fn()).finally(() => { globalThis.window = prev; });
}
const resp = (ok, body) => ({ ok, json: async () => body });

test("a receipt (even cancelled) blocks the delete", () =>
  withWindow(async () => resp(true, [{ receipt_no: "RC1", status: "cancelled" }]), async () => {
    const r = await _invoiceHasReceipt(146);
    assert.equal(r.blocked, true, "cancelled receipt still blocks (FK does)");
    assert.equal(r.receipts[0].receipt_no, "RC1");
  }));

test("no receipts → not blocked", () =>
  withWindow(async () => resp(true, []), async () => {
    const r = await _invoiceHasReceipt(1);
    assert.equal(r.blocked, false);
  }));

test("lookup failure (HTTP !ok) → not blocked (don't false-positive)", () =>
  withWindow(async () => resp(false, null), async () => {
    const r = await _invoiceHasReceipt(1);
    assert.equal(r.blocked, false, "a failed query must not block a legit delete");
  }));

test("lookup throws → not blocked", () =>
  withWindow(async () => { throw new Error("network"); }, async () => {
    const r = await _invoiceHasReceipt(1);
    assert.equal(r.blocked, false);
  }));

test("query targets receipts by delivery_invoice_id (all statuses)", () =>
  withWindow(async (url) => { globalThis.__lastUrl = url; return resp(true, []); }, async () => {
    await _invoiceHasReceipt(146);
    assert.match(globalThis.__lastUrl, /receipts\?delivery_invoice_id=eq\.146/, "queries receipts by FK");
    assert.ok(!/status=/.test(globalThis.__lastUrl), "no status filter → all statuses considered");
  }));

// ── source ordering: pre-check runs BEFORE any DELETE in both handlers ──
const src = fs.readFileSync(path.resolve("modules/delivery_invoices.js"), "utf8");

function handlerBody(startMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `cannot find ${startMarker}`);
  // a handler body ends at the closing "});" of the addEventListener — grab a generous slice
  return src.slice(a, a + 2200);
}

test("diDeleteBtn pre-checks receipts BEFORE deleting items, and returns when blocked", () => {
  const body = handlerBody('getElementById("diDeleteBtn")');
  const checkIdx = body.indexOf("_invoiceHasReceipt(inv.id)");
  const delItemsIdx = body.indexOf('delivery_invoice_items?delivery_invoice_id=eq." + inv.id, { method: "DELETE"');
  assert.ok(checkIdx > 0, "single-delete calls _invoiceHasReceipt");
  assert.ok(delItemsIdx > 0, "single-delete still deletes items (for the no-receipt path)");
  assert.ok(checkIdx < delItemsIdx, "pre-check comes BEFORE the items DELETE");
  assert.match(body, /_rc\.blocked\) \{[\s\S]{0,200}return;/, "blocked → return (deletes nothing)");
});

test("diBulkDelete pre-checks each id BEFORE deleting its items, skipping blocked ones", () => {
  const body = handlerBody('getElementById("diBulkDelete")');
  const checkIdx = body.indexOf("_invoiceHasReceipt(id)");
  const delItemsIdx = body.indexOf('delivery_invoice_items?delivery_invoice_id=eq." + id, { method: "DELETE"');
  assert.ok(checkIdx > 0 && delItemsIdx > 0, "bulk loop pre-checks and deletes");
  assert.ok(checkIdx < delItemsIdx, "bulk pre-check before items DELETE");
  assert.match(body, /_rc\.blocked\) \{ fail\+\+; continue; \}/, "blocked → fail++/continue (skip)");
});
