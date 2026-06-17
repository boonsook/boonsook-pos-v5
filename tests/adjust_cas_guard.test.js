// Phase 472 adjust-cas-guard
// Run: node --test tests/adjust_cas_guard.test.js
//
// Why this exists:
//   _applyStockMovement "adjust" (physical count + manual stock-movement form) wrote the counted
//   value with an UNCONDITIONAL absolute PATCH (no CAS). If another device sold/received between
//   the count and the save, that change was silently overwritten (lost-update). Phase 472: adjust
//   PATCHes conditionally (?id=eq.X&stock=eq.{before}); 0 rows matched = the stock changed during
//   the count -> return a conflict so the user recounts (owner chose warn+recount, not overwrite).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const sc = fs.readFileSync(path.resolve("modules/stock_count.js"), "utf8");

function applyBody(src) {
  const i = src.indexOf("async function _applyStockMovement");
  assert.ok(i >= 0, "_applyStockMovement must exist");
  const e = src.indexOf("\nwindow._appTransferWarehouseStock = _transferWarehouseStock;", i);
  return src.slice(i, e === -1 ? i + 8000 : e);
}
const ab = applyBody(main);

test("adjust uses a CAS-guarded conditional PATCH (stock=eq.before), not an unconditional set", () => {
  assert.match(ab, /warehouse_stock\?id=eq\.[\s\S]{0,50}&stock=eq\."/, "adjust PATCH must be guarded by the expected before-value");
  assert.ok(!/xhrPatch\("warehouse_stock", \{ stock: after \}, "id", ws\.id\)/.test(ab), "the old unconditional adjust PATCH must be gone");
});

test("a mid-count concurrent change aborts the adjust with a conflict (no overwrite)", () => {
  assert.match(ab, /_patched\.length === 0/, "0 rows matched is detected");
  assert.match(ab, /conflict: true/, "returns a conflict result");
  assert.match(ab, /สต็อกเปลี่ยนระหว่างนับ/, "conflict message tells the user to recount");
});

test("stock_count counts conflicts separately and prompts a recount", () => {
  assert.match(sc, /let ok = 0, fail = 0, conflicts = 0/, "tracks conflicts separately");
  assert.match(sc, /if \(res\?\.conflict\) conflicts\+\+/, "checks the conflict flag");
  assert.match(sc, /สต็อกเปลี่ยนระหว่างนับ/, "toast tells the user to recount");
});
