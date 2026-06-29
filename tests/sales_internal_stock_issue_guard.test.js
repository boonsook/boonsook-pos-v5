// Phase 544 — internal stock issue for lump-sum sales docs
// Run: node --test tests/sales_internal_stock_issue_guard.test.js
//
// Feature: deduct REAL stock for a lump-sum delivery invoice without exposing the internal items
//   on the customer document. Items are NOT written to delivery_invoice_items/receipt_items/
//   quotation_items — only a stock_movements row with an idempotency note marker per
//   (doc, product, warehouse): [SALES_INTERNAL_STOCK:<docType>:<docId>:<productId>:<warehouseId>].

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

globalThis.window = globalThis.window || {};
window.SUPABASE_CONFIG = { url: "https://example.supabase.co", anonKey: "anon" };
window._sbAccessToken = "jwt";

const {
  internalStockMarker, internalStockNote, issueInternalStockRow, fetchIssuedInternalStock,
} = await import("../modules/delivery_invoices.js");

const SRC = fs.readFileSync(path.resolve("modules/delivery_invoices.js"), "utf8");

// realistic stock_movements mock: fetch filters by the LIKE pattern; applyMovement "inserts" a row.
let _movements = [];
function installStockMock({ applyResult = { ok: true }, applyInserts = true } = {}) {
  _movements = [];
  let applyCalls = 0;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const m = /note=like\.\*(.*?)\*&/.exec(u);
    const pat = m ? m[1] : "__none__";
    const rows = _movements.filter(r => String(r.note).includes(pat));
    return { ok: true, status: 200, json: async () => rows };
  };
  window._appApplyStockMovement = async ({ note, qty, productId, movementType, allowNegative }) => {
    applyCalls++;
    assert.equal(movementType, "out", "internal issue must be an 'out' movement");
    assert.equal(allowNegative, false, "internal issue must not allow negative stock");
    if (applyResult.ok && applyInserts) {
      _movements.push({ id: _movements.length + 1, product_id: productId, type: "out", qty, note, created_at: "2026-06-29" });
    }
    return applyResult;
  };
  return { applyCalls: () => applyCalls };
}

// ───────────────────────────────────────────────
// 1. marker + note format
// ───────────────────────────────────────────────

test("marker is per (doc, product, warehouse) — not a per-doc lock", () => {
  assert.equal(internalStockMarker("di", 5, 10, 2), "[SALES_INTERNAL_STOCK:di:5:10:2]");
  // different product OR warehouse → different marker → append allowed
  assert.notEqual(internalStockMarker("di", 5, 11, 2), internalStockMarker("di", 5, 10, 2));
  assert.notEqual(internalStockMarker("di", 5, 10, 3), internalStockMarker("di", 5, 10, 2));
});

test("note carries the marker + doc/product/warehouse + the Thai label", () => {
  const note = internalStockNote({ docType: "di", docId: 5, productId: 10, warehouseId: 2, invNo: "INV-1", productName: "คอมเพรสเซอร์", warehouseName: "คลังหลัก" });
  assert.match(note, /^\[SALES_INTERNAL_STOCK:di:5:10:2\]/);
  assert.match(note, /ตัดสต็อกภายในงานขาย/);
  assert.match(note, /INV-1/);
  assert.match(note, /คอมเพรสเซอร์/);
  assert.match(note, /คลังหลัก/);
});

// ───────────────────────────────────────────────
// 2. behavioral — deduct / idempotency / insufficient / log-confirm
// ───────────────────────────────────────────────

const ROW = { docType: "di", docId: 5, invNo: "INV-1", productId: 10, productName: "P", warehouseId: 2, warehouseName: "W", qty: 1 };

test("stock OK → deducts via _appApplyStockMovement (out) and confirms the log", async () => {
  const mock = installStockMock();
  const r = await issueInternalStockRow(ROW);
  assert.equal(r.ok, true);
  assert.equal(r.logConfirmed, true, "re-query must find the marker row");
  assert.equal(mock.applyCalls(), 1);
  assert.equal(_movements.length, 1);
  assert.match(_movements[0].note, /\[SALES_INTERNAL_STOCK:di:5:10:2\]/);
});

test("same product+warehouse already issued for this doc → skipped, NO second deduct", async () => {
  const mock = installStockMock();
  await issueInternalStockRow(ROW);                 // first issue
  const r = await issueInternalStockRow(ROW);       // duplicate
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "already-issued");
  assert.equal(mock.applyCalls(), 1, "must not deduct a second time for the same product+warehouse");
});

test("different product in the same doc → allowed to append (not blocked)", async () => {
  const mock = installStockMock();
  await issueInternalStockRow(ROW);
  const r2 = await issueInternalStockRow({ ...ROW, productId: 11, productName: "P2" });
  assert.equal(r2.ok, true, "a different product in the same doc must be allowed");
  assert.equal(mock.applyCalls(), 2);
});

test("stock insufficient → blocked, no phantom (helper returns insufficient before logging)", async () => {
  const mock = installStockMock({ applyResult: { ok: false, insufficient: true, error: "สต็อกไม่พอ" }, applyInserts: false });
  const r = await issueInternalStockRow(ROW);
  assert.equal(r.ok, false);
  assert.equal(r.insufficient, true);
  assert.equal(_movements.length, 0, "no movement row when stock is insufficient");
  assert.equal(mock.applyCalls(), 1);
});

test("deduct OK but log NOT found on re-query → ok:true but logConfirmed:false (caller must warn, never silent)", async () => {
  installStockMock({ applyResult: { ok: true }, applyInserts: false }); // stock deducted but log insert "failed"
  const r = await issueInternalStockRow(ROW);
  assert.equal(r.ok, true);
  assert.equal(r.logConfirmed, false);
});

test("fetchIssuedInternalStock returns all rows for the doc (prefix), across products/warehouses", async () => {
  installStockMock();
  await issueInternalStockRow(ROW);
  await issueInternalStockRow({ ...ROW, productId: 11 });
  const rows = await fetchIssuedInternalStock("di", 5);
  assert.equal(rows.length, 2);
});

// ───────────────────────────────────────────────
// 3. source — uses the stock helper, internal-only (never touches customer item tables / doc preview)
// ───────────────────────────────────────────────

test("source: issue uses _appApplyStockMovement (out, no-negative) — never PATCHes warehouse_stock directly", () => {
  const i = SRC.indexOf("export async function issueInternalStockRow");
  // strip comments so explainer text ("helper ตัด warehouse_stock…") doesn't trip the CODE checks
  const body = SRC.slice(i, SRC.indexOf("async function _refreshInternalStockIssued"))
    .replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(body, /window\._appApplyStockMovement\(/, "must use the shared stock helper");
  assert.match(body, /movementType:\s*["']out["']/, "must be an out movement");
  assert.match(body, /allowNegative:\s*false/, "must floor (no negative)");
  assert.ok(!/warehouse_stock/.test(body), "must NOT mutate warehouse_stock directly (helper owns CAS/floor)");
  // never writes internal items into the customer-facing item tables
  assert.ok(!/delivery_invoice_items|receipt_items|quotation_items/.test(body), "internal issue must not touch customer item tables");
});

test("source: internal-stock panel lives OUTSIDE #diDocPreview (so print/PDF/share never render it)", () => {
  const idxPanel = SRC.indexOf("diInternalStockPanel");
  const idxProductSel = SRC.indexOf("diIntProduct");
  const idxDoc = SRC.indexOf('id="diDocPreview"');
  assert.ok(idxPanel !== -1 && idxDoc !== -1, "both markers must exist");
  assert.ok(idxPanel < idxDoc, "the internal panel must be rendered before #diDocPreview (sibling, not inside)");
  assert.ok(idxProductSel < idxDoc, "the internal inputs must be outside the printed document");
});

test("source: confirm is single-flight guarded (no double-deduct on double-click)", () => {
  assert.match(SRC, /_internalStockGuard\s*=\s*createInflightGuard\(\)/, "must create a single-flight guard");
  assert.match(SRC, /_internalStockGuard\.run\(/, "the issue handler must run inside the guard");
});

test("source: role-gated to admin/sales (internal stock action)", () => {
  assert.match(SRC, /_canInternalStock\s*=\s*\["admin",\s*"sales"\]\.includes/, "must gate the internal panel by role");
});
