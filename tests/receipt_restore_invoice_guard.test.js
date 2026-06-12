// Guard: receipt cancel/delete must not silently leave the linked delivery invoice
// stuck in a receipted state when the restore-to-pending PATCH fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");

function sliceFrom(marker, length = 2600) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  return src.slice(start, start + length);
}

test("receipt bulk hard delete checks delivery-invoice restore PATCH result", () => {
  const body = sliceFrom('getElementById("rcBulkDelete")', 2600);
  assert.match(body, /let ok = 0, fail = 0, restoreWarn = 0;/, "bulk delete tracks restore warnings");
  assert.match(body, /const restoreResp = await authFetch\(cfg\.url \+ "\/rest\/v1\/delivery_invoices\?id=eq\."/,
    "bulk delete captures restore PATCH response");
  assert.match(body, /if \(!restoreResp\.ok\) \{[\s\S]{0,180}restoreWarn\+\+;[\s\S]{0,220}restore invoice failed/,
    "bulk delete warns when restore PATCH fails");
  assert.match(body, /คืนสถานะใบส่งสินค้าไม่สำเร็จ \$\{restoreWarn\} รายการ/,
    "bulk delete shows a Thai user warning after the success summary");
});

test("receipt preview cancel surfaces delivery-invoice restore failure", () => {
  const body = sliceFrom('getElementById("rcPreviewCancel")', 1700);
  assert.match(body, /let restoreFailed = false;/, "preview cancel tracks restore failure");
  assert.match(body, /if \(!invRes\?\.ok\) \{[\s\S]{0,180}restoreFailed = true;[\s\S]{0,220}restore invoice/,
    "preview cancel detects restore PATCH failure");
  assert.match(body, /if \(restoreFailed\) window\.App\?\.showToast\?\.\("ยกเลิกใบเสร็จแล้ว แต่คืนสถานะใบส่งสินค้าไม่สำเร็จ/,
    "preview cancel shows a user-visible warning");
});

test("receipt hard delete surfaces delivery-invoice restore failure", () => {
  const body = sliceFrom('getElementById("rcDeleteBtn")', 2600);
  assert.match(body, /let restoreFailed = false;/, "hard delete tracks restore failure");
  assert.match(body, /const restoreResp = await authFetch\(cfg\.url \+ "\/rest\/v1\/delivery_invoices\?id=eq\."/,
    "hard delete captures restore PATCH response");
  assert.match(body, /if \(!restoreResp\.ok\) \{[\s\S]{0,180}restoreFailed = true;[\s\S]{0,220}restore invoice failed/,
    "hard delete detects restore PATCH failure");
  assert.match(body, /if \(restoreFailed\) _ctx\.showToast\("ลบใบเสร็จแล้ว แต่คืนสถานะใบส่งสินค้าไม่สำเร็จ/,
    "hard delete shows a user-visible warning");
});
