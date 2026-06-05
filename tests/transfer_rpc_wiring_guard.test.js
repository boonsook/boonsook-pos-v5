// Phase 374 wire-transfer-rpc
// Run: node --test tests/transfer_rpc_wiring_guard.test.js
//
// Why this exists:
//   Phase 373.5 owner created DB function public.transfer_warehouse_stock(...) (verified live):
//   atomic source−/target+/log movement in 1 transaction (FOR UPDATE lock, auto rollback).
//   Phase 374 wires client _transferWarehouseStock (main.js) to call that RPC FIRST (real
//   atomicity), while KEEPING the old multi-xhr logic as a fallback when the RPC is unavailable
//   (old deploy / function missing). These are structural assertions on the EXTRACTED function
//   bodies only (the closures use module-scoped state/xhr, so behavioral mocking is impractical).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");

// Extract _transferWarehouseStock body: from its declaration up to the next top-level function.
function extractTransferBody(src) {
  const startMatch = src.match(/async function _transferWarehouseStock\(/);
  assert.ok(startMatch, "function _transferWarehouseStock must exist");
  const start = startMatch.index;
  const endMatch = src.slice(start).match(/\nasync function _applyStockMovement\(/);
  assert.ok(endMatch, "delimiter _applyStockMovement must follow");
  return src.slice(start, start + endMatch.index);
}

// Extract _syncWarehouseRowsAfterTransfer body (lives just above _transferWarehouseStock).
function extractSyncBody(src) {
  const startMatch = src.match(/async function _syncWarehouseRowsAfterTransfer\(/);
  assert.ok(startMatch, "helper _syncWarehouseRowsAfterTransfer must exist");
  const start = startMatch.index;
  // end at the comment banner that introduces _transferWarehouseStock (keeps trailing
  // doc-comments — which mention the word "throw" — out of the helper body assertions).
  const endMatch = src.slice(start).match(/\n\/\/ ★ ย้ายสต็อกระหว่างคลัง/);
  assert.ok(endMatch, "delimiter (transfer banner) must follow sync helper");
  return src.slice(start, start + endMatch.index);
}

const body = extractTransferBody(main);
const syncBody = extractSyncBody(main);

test("RPC is attempted via the correct rpc endpoint", () => {
  assert.match(
    body,
    /fetch\(\s*cfg\.url \+ "\/rest\/v1\/rpc\/transfer_warehouse_stock"/,
    "must POST to /rest/v1/rpc/transfer_warehouse_stock"
  );
  assert.match(body, /method:\s*"POST"/, "RPC call is a POST");
});

test("RPC headers use anonKey apikey + bearer (access token || anonKey)", () => {
  assert.match(body, /const token = window\._sbAccessToken \|\| cfg\.anonKey/, "bearer = access token || anonKey");
  assert.match(body, /"apikey":\s*cfg\.anonKey/, "apikey header = anonKey");
  assert.match(body, /"Authorization":\s*"Bearer " \+ token/, "Authorization bearer header");
  assert.match(body, /"Content-Type":\s*"application\/json"/, "json content-type");
});

test("RPC body uses verified param names and normalized transferQty + creator uuid", () => {
  assert.match(body, /p_product_id:\s*productId/, "p_product_id");
  assert.match(body, /p_from_wh:\s*fromWarehouseId/, "p_from_wh");
  assert.match(body, /p_to_wh:\s*toWarehouseId/, "p_to_wh");
  assert.match(body, /p_qty:\s*transferQty/, "p_qty uses normalized transferQty (not raw qty)");
  assert.match(body, /p_note:\s*note \|\| null/, "p_note");
  assert.match(body, /p_created_by:\s*creatorUuid/, "p_created_by = creatorUuid (state.currentUser?.id || null)");
});

test("RPC is tried BEFORE the legacy multi-xhr path (source decrement)", () => {
  const rpcIdx = body.indexOf("/rest/v1/rpc/transfer_warehouse_stock");
  const legacyIdx = body.indexOf('_atomicDecrementStock("warehouse_stock", srcWs.id, transferQty)');
  assert.ok(rpcIdx > -1, "rpc endpoint present");
  assert.ok(legacyIdx > -1, "legacy source decrement present");
  assert.ok(rpcIdx < legacyIdx, "RPC must be attempted before the legacy source decrement");
});

test("RPC success returns {ok:true} and syncs cache (no legacy write)", () => {
  assert.match(body, /payload\.ok === true/, "checks success jsonb");
  assert.match(body, /await _syncWarehouseRowsAfterTransfer\(productId, fromWarehouseId, toWarehouseId\)/, "syncs 2 rows");
  assert.match(body, /return \{ ok: true \}/, "returns {ok:true} on RPC success");
});

test("RPC business failure (insufficient) returns mapped shape and does NOT fall back", () => {
  assert.match(body, /payload\.ok === false/, "handles business {ok:false} jsonb");
  assert.match(
    body,
    /return \{ ok: false, insufficient: !!payload\.insufficient, error: payload\.error/,
    "maps insufficient + error from RPC payload"
  );
  // the business-failure return must be INSIDE the try (before the catch) — i.e. it returns,
  // it does not throw/fall through to the legacy fallback.
  const insufficientReturnIdx = body.indexOf("insufficient: !!payload.insufficient");
  const catchIdx = body.indexOf("catch (rpcErr)");
  assert.ok(insufficientReturnIdx > -1 && catchIdx > -1, "both markers present");
  assert.ok(insufficientReturnIdx < catchIdx, "business-failure return precedes the fallback catch");
});

test("fallback only on RPC-unavailable signals (404 / PGRST202 / throw)", () => {
  assert.match(body, /r\.status === 404/, "treats HTTP 404 as RPC unavailable");
  assert.match(body, /payload\.code === "PGRST202"/, "treats PGRST202 as RPC unavailable");
  assert.match(body, /catch \(rpcErr\)/, "has a catch that falls through to legacy");
  // the catch must NOT return — it must fall through to the legacy block.
  const catchSlice = body.slice(body.indexOf("catch (rpcErr)"));
  const catchBlock = catchSlice.slice(0, catchSlice.indexOf("// ── 1. source"));
  assert.doesNotMatch(catchBlock, /\breturn\b/, "fallback catch must not return — it falls through to legacy");
});

test("legacy multi-xhr fallback is KEPT intact (CAS + floor + rollback)", () => {
  assert.match(body, /_atomicDecrementStock\("warehouse_stock", srcWs\.id, transferQty\)/, "source CAS+floor kept");
  assert.match(body, /_atomicAddStock\("warehouse_stock", tgtWs\.id, transferQty\)/, "target CAS add kept");
  assert.match(body, /_atomicAddStock\("warehouse_stock", srcWs\.id, transferQty\)/, "rollback-source kept");
  assert.match(body, /xhrPost\(\s*"warehouse_stock",/, "new-target insert kept");
});

test("return shape {ok,error,insufficient} preserved; products.stock untouched", () => {
  assert.match(body, /return \{ ok: false, error: "ข้อมูลไม่ครบ" \}/, "validation shape kept");
  assert.match(body, /return \{ ok: true \}/, "success shape kept");
  // warehouse-to-warehouse transfer must NOT mutate products.stock (total unchanged).
  assert.doesNotMatch(body, /xhrPatch\("products"/, "no products.stock patch");
  assert.doesNotMatch(body, /_atomicDecrementStock\("products"/, "no products.stock decrement");
  assert.doesNotMatch(body, /_atomicAddStock\("products"/, "no products.stock add");
});

test("cache sync helper refetches the 2 affected rows and upserts best-effort", () => {
  assert.match(syncBody, /\/rest\/v1\/warehouse_stock\?product_id=eq\./, "queries warehouse_stock by product");
  assert.match(syncBody, /warehouse_id=in\.\(/, "filters the from+to warehouses");
  assert.match(syncBody, /select=id,product_id,warehouse_id,stock,min_stock/, "selects the row fields");
  assert.match(syncBody, /state\.warehouseStock\.push\(/, "pushes new target row with real id");
  assert.match(syncBody, /existing\.stock = row\.stock/, "updates existing row stock");
  // best-effort: must warn (not throw) on failure so a successful DB transfer is not reported failed.
  assert.match(syncBody, /console\.warn\(/, "warns on refetch failure");
  assert.doesNotMatch(syncBody, /\bthrow\b/, "refetch failure must not throw (transfer already committed)");
});
