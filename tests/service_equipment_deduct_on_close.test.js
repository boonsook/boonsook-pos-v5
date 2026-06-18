// Phase 482 — deduct service-job equipment stock ON CLOSE (not on add) + existing jobs editable
// Run: node --test tests/service_equipment_deduct_on_close.test.js
//
// Model: a tech can add/edit equipment while a job is still open (pending/progress) WITHOUT
// consuming stock; stock is deducted exactly once when the owner closes the job
// (done/delivered/closed) together with the revenue JV. Cancelling a deducted job restores it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  deductServiceJobStock,
  restoreServiceJobStock,
  STOCK_DEDUCTED_MARKER,
  STOCK_RETURNED_MARKER,
} from "../modules/service_equipment.js";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const serviceForm = fs.readFileSync(path.resolve("modules/service_form.js"), "utf8");

// mock window._appApplyStockMovement; returns the recorded calls
function mockMovement(result = { ok: true }) {
  const calls = [];
  globalThis.window = { _appApplyStockMovement: async (arg) => { calls.push(arg); return result; } };
  return calls;
}
function clearMock() { delete globalThis.window; }

const ITEMS = [{ product_id: 7, warehouse_id: 3, qty: 2, name: "คอมเพรสเซอร์" }];

// ── deductServiceJobStock ──────────────────────────────────────────────────────
test("deductServiceJobStock: no items → deducted:false, no movement, note unchanged", async () => {
  const calls = mockMovement();
  const r = await deductServiceJobStock({ items_json: [], note: "งานปกติ", job_no: "J1" });
  assert.equal(r.deducted, false);
  assert.equal(r.newNote, "งานปกติ");
  assert.equal(calls.length, 0);
  clearMock();
});

test("deductServiceJobStock: note already has DEDUCTED marker → idempotent no-op", async () => {
  const calls = mockMovement();
  const r = await deductServiceJobStock({ items_json: ITEMS, note: `x ${STOCK_DEDUCTED_MARKER}`, job_no: "J1" });
  assert.equal(r.deducted, false);
  assert.equal(calls.length, 0, "must NOT deduct again when marker present");
  clearMock();
});

test("deductServiceJobStock: items + no marker → deducts (out movement) and appends marker", async () => {
  const calls = mockMovement();
  const r = await deductServiceJobStock({ items_json: ITEMS, note: "งานช่าง", job_no: "J9", customer_name: "คุณเอ" });
  assert.equal(r.deducted, true);
  assert.ok(r.newNote.includes(STOCK_DEDUCTED_MARKER), "marker appended to note");
  assert.equal(calls.length, 1, "one movement per item");
  assert.equal(calls[0].movementType, "out");
  assert.equal(calls[0].productId, 7);
  assert.equal(calls[0].warehouseId, 3);
  assert.equal(calls[0].qty, 2);
  clearMock();
});

test("deductServiceJobStock: empty note → newNote is just the marker", async () => {
  mockMovement();
  const r = await deductServiceJobStock({ items_json: ITEMS, note: "", job_no: "J9" });
  assert.equal(r.newNote, STOCK_DEDUCTED_MARKER);
  clearMock();
});

// ── restoreServiceJobStock gate (Phase 482: only restore what was actually deducted) ───────
test("restore: job WITHOUT deducted marker → restored:false (no phantom restore)", async () => {
  const calls = mockMovement();
  const r = await restoreServiceJobStock({ items_json: ITEMS, note: "งานยังไม่ปิด" });
  assert.equal(r.restored, false, "added equipment but never deducted → nothing to restore");
  assert.equal(calls.length, 0);
  clearMock();
});

test("restore: job WITH deducted marker, not yet returned → restored:true (return movement)", async () => {
  const calls = mockMovement();
  const r = await restoreServiceJobStock({ items_json: ITEMS, note: `งาน ${STOCK_DEDUCTED_MARKER}`, job_no: "J9" });
  assert.equal(r.restored, true);
  assert.ok(r.newNote.includes(STOCK_RETURNED_MARKER));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].movementType, "return");
  clearMock();
});

test("restore: job already returned → restored:false (idempotent)", async () => {
  const calls = mockMovement();
  const r = await restoreServiceJobStock({ items_json: ITEMS, note: `${STOCK_DEDUCTED_MARKER} ${STOCK_RETURNED_MARKER}` });
  assert.equal(r.restored, false);
  assert.equal(calls.length, 0);
  clearMock();
});

// ── source wiring: main.js ─────────────────────────────────────────────────────
test("openServiceJobDrawer: readonly = closed status (not 'has items')", () => {
  assert.match(main, /_serviceDrawerEquipReadonly = \["done", "delivered", "closed"\]\.includes\(job\?\.status\)/,
    "equipment is read-only only when the job is closed, so open jobs stay editable");
});

test("saveServiceJob: items_json saved whenever editable (no isNewJob gate)", () => {
  assert.match(main, /const _equipItemsForSave = \(!_serviceDrawerEquipReadonly\) \? _equipToItemsJson\(_serviceDrawerItems\) : \[\]/,
    "existing open jobs can save added equipment (old isNewJob restriction removed)");
});

test("saveServiceJob: NO deduct on normal save (deduct-on-save block removed)", () => {
  assert.ok(!/_equipDeduct\(_equipItemsForSave/.test(main), "no unconditional deduct on save");
});

test("saveServiceJob: deduct happens on close (transition / new-complete), idempotent via marker", () => {
  const i = main.indexOf("async function saveServiceJob(");
  const body = main.slice(i, i + 12000);
  // the deduct-on-close call is inside the (transition→done | new-complete) branch — NOT editCompleteWithChange
  assert.match(body, /if \(transitionedToDone \|\| newJobAlreadyComplete\) \{[\s\S]*?_equipDeductOnClose\(jobForDeduct\)/,
    "deduct-on-close gated by close transition");
  assert.match(body, /xhrPatch\("service_jobs", \{ note: ded\.newNote \}/, "marker persisted to DB to prevent re-deduct");
});

// ── source wiring: service_form.js (intake form no longer consumes stock) ───────
test("service_form: no 'out' deduct on create (only transfer kept)", () => {
  assert.ok(!/movementType: "out"/.test(serviceForm), "intake form must not deduct stock on create");
  assert.match(serviceForm, /_appTransferWarehouseStock/, "auto-transfer (prepare stock) is kept");
});
