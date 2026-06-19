// Phase 404 — service-job-cancel-restore-stock (MONEY/STOCK §4.2)
// Run: node --test tests/service_job_cancel_restore_guard.test.js
//
// Equipment is deducted when a service job is CLOSED (Phase 482; was Phase 402 on-create).
// When a DEDUCTED job is cancelled/deleted, the equipment must be RETURNED to stock — via the
// same CAS path (_appApplyStockMovement "return"), idempotently (a note marker prevents a second
// return), and only for items that were actually warehouse-deducted (have warehouse_id).
// Phase 482 gate: restore runs only when the job carries STOCK_DEDUCTED_MARKER (i.e. it was
// actually deducted) — added equipment on an open job that was never closed → nothing to return.
//
// Two layers: (1) behavioral on restoreServiceJobStock; (2) a COMPLETENESS guard — every
// place that sets service_jobs status="cancelled" must call restoreServiceJobStock, so a
// new cancel path can't silently skip the stock return (Iron Rule #5).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { restoreServiceJobStock, STOCK_RETURNED_MARKER, STOCK_DEDUCTED_MARKER } from "../modules/service_equipment.js";

// Phase 500: restoreServiceJobStock เรียก atomic claim ผ่าน global fetch (PATCH service_jobs) ก่อน loop คืนสต็อก.
//   claimRows = แถวที่ claim PATCH คืน: [{id,note}] = ชนะ claim (เดินหน้าคืน) · [] = แพ้/ไม่เข้าเงื่อนไข (skip).
function withMockApply(impl, fn, claimRows = [{ id: 1, note: "" }]) {
  const prevWin = globalThis.window;
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = {
    _appApplyStockMovement: async (a) => { calls.push(a); return impl ? impl(a) : { ok: true }; },
    SUPABASE_CONFIG: { url: "http://test", anonKey: "k" },
    _sbAccessToken: "t",
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => claimRows });
  return Promise.resolve(fn(calls)).finally(() => { globalThis.window = prevWin; globalThis.fetch = prevFetch; });
}

test("returns each warehouse-deducted item via _appApplyStockMovement('return')", () =>
  withMockApply(null, async (calls) => {
    const job = { id: 1, job_no: "JOB-1", note: `งานซ่อม ${STOCK_DEDUCTED_MARKER}`, items_json: [
      { product_id: 1, warehouse_id: 9, qty: 2 },
      { product_id: 2, warehouse_id: 9, qty: 1 },
    ] };
    const r = await restoreServiceJobStock(job);
    assert.equal(calls.length, 2, "one return per item");
    assert.ok(calls.every(c => c.movementType === "return"), "movementType is return");
    assert.equal(calls[0].qty, 2);
    assert.equal(r.restored, true);
    assert.ok(r.newNote.includes(STOCK_RETURNED_MARKER), "marker appended to note");
  }));

test("idempotent: claim returns 0 rows (already reverted at DB) → no return, no calls", () =>
  // Phase 500: idempotency ย้ายไป DB claim — งานที่คืนแล้วมี stock_reverted_at set → claim 0 row → skip
  withMockApply(null, async (calls) => {
    const job = { id: 1, job_no: "JOB-1", note: `งานซ่อม ${STOCK_RETURNED_MARKER}`, items_json: [{ product_id: 1, warehouse_id: 9, qty: 2 }] };
    const r = await restoreServiceJobStock(job);
    assert.equal(calls.length, 0, "no stock movement when claim lost (already reverted)");
    assert.equal(r.restored, false);
    assert.equal(r.skipped, true, "0-row claim → skipped");
  }, []));

test("no items_json → no-op (no calls)", () =>
  withMockApply(null, async (calls) => {
    const r = await restoreServiceJobStock({ id: 1, job_no: "JOB-1", note: "x", items_json: [] });
    assert.equal(calls.length, 0);
    assert.equal(r.restored, false);
    const r2 = await restoreServiceJobStock({ id: 1, job_no: "JOB-1", note: "x" });  // missing items_json
    assert.equal(r2.restored, false);
  }));

test("skips items without warehouse_id (don't guess a warehouse)", () =>
  withMockApply(null, async (calls) => {
    const job = { id: 1, job_no: "JOB-1", note: STOCK_DEDUCTED_MARKER, items_json: [
      { product_id: 1, warehouse_id: 9, qty: 2 },   // returned
      { product_id: 2, qty: 5 },                      // no warehouse_id → skip
    ] };
    await restoreServiceJobStock(job);
    assert.equal(calls.length, 1, "only the warehouse-deducted item is returned");
    assert.equal(calls[0].productId, 1);  // helper passes camelCase productId to _appApplyStockMovement
  }));

test("partial failure is reported (errors[]), not swallowed", () =>
  withMockApply((a) => ({ ok: a.productId !== 2 }), async () => {
    const job = { id: 1, job_no: "JOB-1", note: STOCK_DEDUCTED_MARKER, items_json: [
      { product_id: 1, warehouse_id: 9, qty: 1 },
      { product_id: 2, warehouse_id: 9, qty: 1 },
    ] };
    const r = await restoreServiceJobStock(job);
    assert.equal(r.restored, true);
    assert.equal(r.errors.length, 1, "the failed return is recorded");
  }));

test("restore uses return movement only — never writes products.stock directly", () => {
  const src = fs.readFileSync(path.resolve("modules/service_equipment.js"), "utf8");
  const body = src.slice(src.indexOf("export async function restoreServiceJobStock"));
  assert.match(body, /movementType: "return"/, "return movement");
  assert.ok(!/xhrPatch|xhrPost|["']products["']/.test(body.slice(0, body.indexOf("export function optimisticDeduct"))),
    "restore body has no direct products/warehouse write (trigger 403 owns products.stock)");
});

// ── COMPLETENESS guard (Iron Rule #5): every service_jobs cancel path restores stock ──
test("every service_jobs status=cancelled writer calls restoreServiceJobStock", () => {
  const files = {
    "modules/service_jobs.js": fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8"),
    "modules/ai_sales.js": fs.readFileSync(path.resolve("modules/ai_sales.js"), "utf8"),
    "main.js": fs.readFileSync(path.resolve("main.js"), "utf8"),
  };
  for (const [name, src] of Object.entries(files)) {
    // each of these files sets service_jobs status to cancelled somewhere
    assert.match(src, /status:\s*"cancelled"|status === "cancelled"|payload\.status === "cancelled"/,
      `${name} has a cancel path`);
    // …and must call the restore helper (imported as restoreServiceJobStock or _equipRestoreStock)
    assert.match(src, /restoreServiceJobStock|_equipRestoreStock/, `${name} calls the stock-restore helper`);
  }
});

test("service job cancel paths write cancelled status before returning stock", () => {
  const serviceJobsSrc = fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8");
  const deleteStart = serviceJobsSrc.indexOf('document.querySelectorAll("[data-del-job]")');
  assert.notEqual(deleteStart, -1, "service_jobs delete handler exists");
  const deleteBody = serviceJobsSrc.slice(deleteStart, serviceJobsSrc.indexOf("}));", deleteStart) + 4);
  const deleteStatusIdx = deleteBody.search(/from\("service_jobs"\)\.update\(updatePayload\)|_appXhrPatch\?\.\("service_jobs", updatePayload/);
  const deleteRestoreIdx = deleteBody.indexOf("restoreServiceJobStock(");
  assert.ok(deleteStatusIdx >= 0, "delete handler writes cancelled status");
  assert.ok(deleteRestoreIdx >= 0, "delete handler restores stock");
  assert.ok(deleteStatusIdx < deleteRestoreIdx, "delete handler must write cancelled before stock return");

  const mainSrc = fs.readFileSync(path.resolve("main.js"), "utf8");
  const saveStart = mainSrc.indexOf("async function saveServiceJob()");
  assert.notEqual(saveStart, -1, "saveServiceJob exists");
  const saveBody = mainSrc.slice(saveStart, mainSrc.indexOf("// ═", saveStart + 1));
  const savePatchIdx = saveBody.indexOf('xhrPatch("service_jobs", payload');
  const saveRestoreIdx = saveBody.indexOf("_equipRestoreStock(");
  assert.ok(savePatchIdx >= 0, "saveServiceJob PATCHes service_jobs");
  assert.ok(saveRestoreIdx >= 0, "saveServiceJob restores stock");
  assert.ok(savePatchIdx < saveRestoreIdx, "saveServiceJob must write cancelled before stock return");
});
