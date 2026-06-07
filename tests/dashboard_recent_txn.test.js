// Phase 397 — dashboard recent-transactions table (display read-only)
// Run: node --test tests/dashboard_recent_txn.test.js
//
// Why this exists:
//   The dashboard gained a scrollable "🧾 ธุรกรรมล่าสุด" table of the latest sales. It must:
//   stay read-only (no fetch / no write), be role-isolated (visibleSalesForRole — a non-admin
//   only sees their own sales, no data leak), clone before sorting (never mutate state.sales in
//   place), and escape every DB-sourced value it renders (XSS). The label must be honest about
//   showing only the loaded subset (≤50), not the whole system. We extract the _recentTxnRows
//   body first so other code can't false-positive.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
const body = (src.match(/function _recentTxnRows\([\s\S]*?\n\}\n/) || [""])[0];

test("_recentTxnRows is role-isolated, escapes DB values, and clones before sort", () => {
  assert.ok(body.length > 0, "found the _recentTxnRows body");
  assert.match(body, /visibleSalesForRole\(/, "role isolation (non-admin sees own sales only)");
  // a spread/slice clone must appear before the first .sort(
  const sortIdx = body.indexOf(".sort(");
  const cloneIdx = Math.min(...[body.indexOf("[..."), body.indexOf(".slice(")].filter(i => i >= 0).concat([Infinity]));
  assert.ok(sortIdx >= 0 && cloneIdx < sortIdx, "clones (spread/slice) BEFORE sorting — no in-place mutation");
  assert.match(body, /escapeHtml\(s\?\.order_no/, "escapes order_no (XSS)");
  assert.match(body, /escapeHtml\(s\?\.customer_name/, "escapes customer_name (XSS)");
});

test("_recentTxnRows is read-only (no fetch / no supabase write / no state.sales in-place mutation)", () => {
  assert.ok(!/\bfetch\s*\(/.test(body), "no fetch()");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(body), "no supabase writes");
  assert.ok(!/state\.sales\.(sort|push|splice|reverse|pop|shift|unshift)\(/.test(body), "never mutates state.sales in place");
});

test("recent-txn panel has an honest sub-label, scroll, empty-state, and calls the helper", () => {
  assert.match(src, /🧾 ธุรกรรมล่าสุด/, "panel title");
  assert.match(src, /สูงสุด ~50|ไม่ใช่ทั้งระบบ/, "honest sub-label (loaded ≤50, not whole system)");
  assert.match(src, /max-height:360px/, "scrollable (max-height)");
  assert.match(src, /overflow-y:auto/, "vertical scroll");
  assert.match(body, /ยังไม่มีธุรกรรม/, "empty-state when no sales");
  assert.match(src, /\$\{_recentTxnRows\(state\)\}/, "panel renders via the helper");
});
