// Guard refund restock correctness:
// A refund row must not claim restocked=true until all stock return movements succeed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/refunds.js"), "utf8");

function saveHandlerBody() {
  const start = src.indexOf('modal.querySelector("#rfSave").addEventListener("click"');
  assert.notEqual(start, -1, "refund save handler exists");
  // window widened in Phase 517a: the credit-ledger block (+~1.5KB) sits between the
  // JV post and the final toast, pushing the restockErrors.length>0 check further down.
  return src.slice(start, start + 9600);
}

test("refund insert starts as restocked:false even when the user selected restock", () => {
  const body = saveHandlerBody();
  const payloadIdx = body.indexOf("const payload = {");
  const insertIdx = body.indexOf('fetch(cfg.url + "/rest/v1/refunds"');
  const falseIdx = body.indexOf("restocked: false");
  assert.ok(payloadIdx > 0, "refund payload exists");
  assert.ok(insertIdx > 0, "refund insert exists");
  assert.ok(falseIdx > payloadIdx && falseIdx < insertIdx, "refund row starts restocked:false before insert");
  assert.doesNotMatch(body.slice(payloadIdx, insertIdx), /restocked:\s*restock/, "must not trust UI checkbox as persisted restocked state");
});

test("refund restock checks movement result and records failures", () => {
  const body = saveHandlerBody();
  const moveIdx = body.indexOf("const move = await window._appApplyStockMovement");
  const okCheckIdx = body.indexOf("if (!move?.ok)");
  const errPushIdx = body.indexOf("restockErrors.push", okCheckIdx);
  assert.ok(moveIdx > 0, "refund restock calls _appApplyStockMovement");
  assert.ok(okCheckIdx > moveIdx, "refund restock checks the returned ok flag");
  assert.ok(errPushIdx > okCheckIdx, "failed movement is recorded");
});

test("refund marks restocked:true only after every restock movement succeeded", () => {
  const body = saveHandlerBody();
  const restockLoopIdx = body.indexOf("for (const it of itemsToRefund)");
  const successGateIdx = body.indexOf("if (restockErrors.length === 0)");
  const patchIdx = body.indexOf('window._appXhrPatch?.("refunds", { restocked: true }');
  const localMarkerIdx = body.indexOf("insertedRefund.restocked = true");
  assert.ok(restockLoopIdx > 0, "refund restock loop exists");
  assert.ok(successGateIdx > restockLoopIdx, "success gate comes after restock loop");
  assert.ok(patchIdx > successGateIdx, "restocked:true is patched only inside success gate");
  assert.ok(localMarkerIdx > patchIdx, "local row is marked restocked only after successful patch");
});

test("refund warns the user when stock return is partial or marker patch fails", () => {
  const body = saveHandlerBody();
  assert.match(body, /restockErrors\.length > 0/, "save handler checks restock errors before final toast");
  assert.match(body, /คืนสต็อกไม่ครบ/, "user-facing warning mentions incomplete stock return");
});
