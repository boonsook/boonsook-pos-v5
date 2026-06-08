// Phase 402 — service-job-equipment-from-stock (MONEY/STOCK §4.1+§4.2, deduct-only scope)
// Run: node --test tests/service_job_equipment_guard.test.js
//
// Guards the equipment feature in the admin "เพิ่มงานช่าง" drawer:
//   - stock is deducted ONLY via window._appApplyStockMovement (CAS/floor) — never a raw
//     warehouse_stock write — and only when CREATING a new job;
//   - editing an existing job (items_json present) is read-only → NO re-deduct (no double cut);
//   - precheck aggregates qty per (product|warehouse) so multi-line over-stock is blocked;
//   - stock-op failure is surfaced (not swallowed), via showToast (never alert()).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  equipmentTotal, precheckEquipmentStock, toItemsJson, deductEquipmentStock, optimisticDeduct
} from "../modules/service_equipment.js";

const moduleSrc = fs.readFileSync(path.resolve("modules/service_equipment.js"), "utf8");
const mainSrc = fs.readFileSync(path.resolve("main.js"), "utf8");

// ── pure helpers ─────────────────────────────────────────────
test("equipmentTotal sums line_total", () => {
  assert.equal(equipmentTotal([{ line_total: 100 }, { line_total: 250 }]), 350);
  assert.equal(equipmentTotal([]), 0);
  assert.equal(equipmentTotal(null), 0);
});

test("precheck aggregates qty per (product|warehouse) and blocks over-stock", () => {
  const state = { warehouseStock: [{ product_id: 1, warehouse_id: 9, stock: 5 }] };
  // two lines same product+warehouse: 3 + 3 = 6 > 5 → must be blocked (Phase 372 aggregation)
  const over = precheckEquipmentStock(
    [{ product_id: 1, warehouse_id: 9, qty: 3, name: "A", warehouse_name: "รถ" },
     { product_id: 1, warehouse_id: 9, qty: 3, name: "A", warehouse_name: "รถ" }], state);
  assert.equal(over.ok, false);
  assert.equal(over.shortages.length, 1);
  assert.equal(over.shortages[0].need, 6);
  assert.equal(over.shortages[0].avail, 5);
  // 2 + 2 = 4 <= 5 → ok
  const ok = precheckEquipmentStock(
    [{ product_id: 1, warehouse_id: 9, qty: 2, name: "A", warehouse_name: "รถ" },
     { product_id: 1, warehouse_id: 9, qty: 2, name: "A", warehouse_name: "รถ" }], state);
  assert.equal(ok.ok, true);
});

test("toItemsJson produces the service_form items_json shape", () => {
  const out = toItemsJson([{ product_id: "7", name: "ท่อ", qty: "2", unit_price: "50", line_total: "100", warehouse_id: 9, warehouse_name: "รถ" }]);
  assert.deepEqual(out[0], {
    product_id: 7, name: "ท่อ", qty: 2, unit_price: 50, line_total: 100,
    warehouse_id: 9, warehouse_name: "รถ", is_main: false
  });
});

test("deductEquipmentStock cuts each item via window._appApplyStockMovement (out) and surfaces failure", async () => {
  const calls = [];
  const prevWindow = globalThis.window;
  globalThis.window = {
    _appApplyStockMovement: async (args) => {
      calls.push(args);
      // make the 2nd item fail to prove failure is surfaced, not swallowed
      return { ok: args.productId !== 2 };
    }
  };
  try {
    const items = [
      { product_id: 1, warehouse_id: 9, qty: 2 },
      { product_id: 2, warehouse_id: 9, qty: 1 },
    ];
    const r = await deductEquipmentStock(items, "JOB-1", "ลูกค้า");
    assert.equal(calls.length, 2, "one movement per item");
    assert.ok(calls.every(c => c.movementType === "out"), "movementType is out (deduct)");
    assert.equal(r.stockOpsFailed, true, "a failing op is surfaced");
    assert.equal(r.errors.length, 1, "the failed item is recorded");
  } finally {
    globalThis.window = prevWindow;
  }
});

test("optimisticDeduct reduces local stock and floors at 0", () => {
  const state = { warehouseStock: [{ product_id: 1, warehouse_id: 9, stock: 5 }] };
  optimisticDeduct([{ product_id: 1, warehouse_id: 9, qty: 2 }], state);
  assert.equal(state.warehouseStock[0].stock, 3);
  optimisticDeduct([{ product_id: 1, warehouse_id: 9, qty: 99 }], state);
  assert.equal(state.warehouseStock[0].stock, 0, "never goes negative");
});

// ── module isolation: no raw stock write, reuse shared precheck ───
test("service_equipment.js never writes warehouse_stock directly (CAS-only)", () => {
  assert.ok(/window\._appApplyStockMovement/.test(moduleSrc), "deducts via the shared CAS/floor helper");
  assert.ok(/movementType:\s*"out"/.test(moduleSrc), "uses out movement");
  // no raw DB write: no xhr/fetch, and no quoted "warehouse_stock" table-name in a write call
  // (a bare mention in a comment is fine — only flag an actual write target)
  assert.ok(!/xhrPost|xhrPatch|fetch\(|["']warehouse_stock["']/.test(moduleSrc), "no raw warehouse_stock write / xhr");
  assert.ok(/from "\.\/stock_precheck\.js"/.test(moduleSrc), "reuses aggregateNeedByKey (shared)");
});

// ── main.js wiring: deduct on create only, read-only on edit ──────
test("saveServiceJob deducts equipment ONLY for new jobs (edit = no re-cut)", () => {
  // the items-to-save list is gated on isNewJob && !readonly → editing yields []
  assert.match(mainSrc, /_equipItemsForSave\s*=\s*\(isNewJob\s*&&\s*!_serviceDrawerEquipReadonly\)/,
    "equip-to-save gated on new job + not readonly");
  // precheck before insert, items_json attached, deduct after insert
  assert.match(mainSrc, /_equipPrecheck\(_equipItemsForSave, state\)/, "precheck before save");
  assert.match(mainSrc, /payload\.items_json\s*=\s*_equipItemsForSave/, "items_json attached for new job");
  assert.match(mainSrc, /_equipDeduct\(_equipItemsForSave,/, "deduct after successful insert");
  // both precheck and deduct sit behind `if (_equipItemsForSave.length)` → edit path ([]) skips deduct
  assert.match(mainSrc, /if \(_equipItemsForSave\.length\)/, "deduct/precheck guarded by non-empty equip list");
});

test("equipment drawer surfaces problems via showToast, never alert()", () => {
  // shortage block uses showToast (return showToast(msg)) — no alert anywhere in equip code
  assert.ok(!/alert\(/.test(moduleSrc), "module never uses alert()");
  assert.match(mainSrc, /return showToast\(msg\);/, "stock-shortage block warns via showToast");
});

test("editing job clones items read-only (no mutation of the original row)", () => {
  assert.match(mainSrc, /_serviceDrawerEquipReadonly\s*=\s*_hasExistingItems/, "edit with items → readonly flag set");
  assert.match(mainSrc, /job\.items_json\.map\(it => \(\{ \.\.\.it \}\)\)/, "existing items are cloned, not referenced");
});
