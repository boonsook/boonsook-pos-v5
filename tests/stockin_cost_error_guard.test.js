// Phase 470 stockin-cost-patch-error-surfaced
// Run: node --test tests/stockin_cost_error_guard.test.js
//
// Why this exists:
//   stock_in_wizard receive flow PATCHes products.cost when the cost changed, but the XHR
//   resolved on onload/onerror/ontimeout WITHOUT checking the HTTP status — so a 4xx/5xx (RLS,
//   network) cost update failed completely silently while the user saw "รับเข้าสำเร็จ". The stock
//   was received correctly, but the new cost was never saved -> wrong COGS / margin.
//   Phase 470: the PATCH resolves the real 2xx status; a failed cost update is collected and
//   surfaced via a toast (the received row still counts — cost is a secondary update).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/stock_in_wizard.js"), "utf8");

test("cost PATCH resolves the real HTTP status, not a bare resolve() on every outcome", () => {
  assert.match(src, /onload = \(\) => resolve\(xhr\.status >= 200 && xhr\.status < 300\)/, "onload must resolve the 2xx check");
  assert.match(src, /onerror = \(\) => resolve\(false\)/, "onerror resolves false");
  assert.match(src, /ontimeout = \(\) => resolve\(false\)/, "ontimeout resolves false");
  assert.ok(!/onload = \(\) => resolve\(\);/.test(src), "the bare-resolve onload (silent-swallow bug) must be gone");
});

test("a failed cost update is collected and surfaced (not silent)", () => {
  assert.match(src, /const costFailedItems = \[\]/, "collects cost-update failures");
  assert.match(src, /if \(!costOk\) costFailedItems\.push/, "pushes the item when the cost PATCH fails");
  assert.match(src, /อัปเดตต้นทุนไม่สำเร็จ/, "toasts when any cost update failed");
});

test("a cost-update failure does NOT fail the whole received row (stock already received)", () => {
  const i = src.indexOf("if (!costOk) costFailedItems.push");
  const okIdx = src.indexOf("ok++;", i);
  assert.ok(i > -1 && okIdx > i, "ok++ runs after the cost-fail collection — the row still counts as received");
});
