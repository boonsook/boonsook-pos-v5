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

// mock window._appApplyStockMovement + Phase 500 atomic claim (global fetch PATCH service_jobs).
//   claimRows = แถวที่ claim คืน: [{id,note}] = ชนะ (เดินหน้าตัด/คืน) · [] = แพ้/ไม่เข้าเงื่อนไข (skip — idempotent).
function mockMovement(result = { ok: true }, claimRows = [{ id: 1, note: "" }]) {
  const calls = [];
  globalThis.window = {
    _appApplyStockMovement: async (arg) => { calls.push(arg); return result; },
    SUPABASE_CONFIG: { url: "http://test", anonKey: "k" },
    _sbAccessToken: "t",
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => claimRows });
  return calls;
}
function clearMock() { delete globalThis.window; delete globalThis.fetch; }

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

test("deductServiceJobStock: already deducted (claim 0-row) → idempotent no-op", async () => {
  const calls = mockMovement({ ok: true }, []);  // Phase 500: ตัดแล้ว = stock_deducted_at set → claim 0 row
  const r = await deductServiceJobStock({ id: 1, items_json: ITEMS, note: `x ${STOCK_DEDUCTED_MARKER}`, job_no: "J1" });
  assert.equal(r.deducted, false);
  assert.equal(calls.length, 0, "must NOT deduct again when marker present");
  clearMock();
});

test("deductServiceJobStock: items + no marker → deducts (out movement) and appends marker", async () => {
  const calls = mockMovement();
  const r = await deductServiceJobStock({ id: 1, items_json: ITEMS, note: "งานช่าง", job_no: "J9", customer_name: "คุณเอ" });
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
  const r = await deductServiceJobStock({ id: 1, items_json: ITEMS, note: "", job_no: "J9" });
  assert.equal(r.newNote, STOCK_DEDUCTED_MARKER);
  clearMock();
});

// ── restoreServiceJobStock gate (Phase 482: only restore what was actually deducted) ───────
test("restore: job never deducted (claim 0-row) → restored:false (no phantom restore)", async () => {
  const calls = mockMovement({ ok: true }, []);  // Phase 500: ไม่เคยตัด = stock_deducted_at null → claim filter not.is.null → 0 row
  const r = await restoreServiceJobStock({ id: 1, items_json: ITEMS, note: "งานยังไม่ปิด" });
  assert.equal(r.restored, false, "added equipment but never deducted → nothing to restore");
  assert.equal(calls.length, 0);
  clearMock();
});

test("restore: job WITH deducted marker, not yet returned → restored:true (return movement)", async () => {
  const calls = mockMovement();
  const r = await restoreServiceJobStock({ id: 1, items_json: ITEMS, note: `งาน ${STOCK_DEDUCTED_MARKER}`, job_no: "J9" });
  assert.equal(r.restored, true);
  assert.ok(r.newNote.includes(STOCK_RETURNED_MARKER));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].movementType, "return");
  clearMock();
});

test("restore: already returned (claim 0-row) → restored:false (idempotent)", async () => {
  const calls = mockMovement({ ok: true }, []);  // Phase 500: คืนแล้ว = stock_reverted_at set → claim 0 row
  const r = await restoreServiceJobStock({ id: 1, items_json: ITEMS, note: `${STOCK_DEDUCTED_MARKER} ${STOCK_RETURNED_MARKER}` });
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

// ── Phase 501: no optimistic double-deduct on close (display sync) ──────────────
test("Phase 501: saveServiceJob ไม่เรียก optimistic local อีก (กันลบ ws.stock ซ้ำ)", () => {
  // _equipDeductOnClose → _applyStockMovement sync ws.stock + products.stock (derived) แล้ว;
  // optimistic เดิม (_equipOptimistic) ลด ws.stock ซ้ำ → จอเพี้ยน DB−2×qty จน loadAllData resync.
  assert.ok(!/_equipOptimistic/.test(main), "main.js ต้องไม่เรียก _equipOptimistic (Phase 501 ลบแล้ว)");
  assert.ok(!/optimisticDeduct/.test(main), "main.js ต้องไม่ import optimisticDeduct (alias ถูกลบ)");
});

// ── source wiring: intake forms no longer consume stock (transfer kept) ─────────
test("service_form / ac_install / solar: no 'out' deduct on create; transfer kept", () => {
  // Phase 482 + addendum: all intake forms create jobs without consuming stock (deduct happens
  // at job close via the drawer). Leaving any one cutting on create double-deducts after close.
  for (const [name, src] of [
    ["service_form", serviceForm],
    ["ac_install", fs.readFileSync(path.resolve("modules/ac_install.js"), "utf8")],
    ["solar", fs.readFileSync(path.resolve("modules/solar.js"), "utf8")],
  ]) {
    assert.ok(!/movementType: "out"/.test(src), `${name} must not deduct stock on create`);
    assert.match(src, /_appTransferWarehouseStock/, `${name} keeps auto-transfer (prepare stock)`);
  }
});
