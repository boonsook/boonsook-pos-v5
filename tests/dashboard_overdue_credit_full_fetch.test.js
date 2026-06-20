// Phase 508 — dashboard overdue-credit full-fetch guard
// Run: node --test tests/dashboard_overdue_credit_full_fetch.test.js
//
// Invariant: การ์ด "ต้องทำวันนี้" บน Dashboard ต้องนับ "หนี้ค้างเกินกำหนด" จากบิลเครดิต "ครบ"
// จาก DB (reuse fetchCreditSales ของ Phase 507) ไม่ใช่ state.sales (cap ≤50 = undercount เงียบ);
// แยก fetch ออกจาก render (cache + seq guard) → period change ไม่ refetch; fail ไม่ fallback
// เป็นตัวเลขต่ำกว่าจริง; dashboard.js ยัง read-only (ไม่ write).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");

function slice(anchor, endAnchor) {
  const i = dash.indexOf(anchor);
  assert.ok(i > -1, `anchor not found: ${anchor}`);
  const j = dash.indexOf(endAnchor, i + anchor.length);
  assert.ok(j > -1, `end anchor not found: ${endAnchor}`);
  return dash.slice(i, j);
}

test("dashboard imports & calls fetchCreditSales (reuse Phase 507 helper, no duplicate query)", () => {
  assert.match(dash, /import \{ fetchCreditSales \} from "\.\/credit_sales_fetch\.js"/,
    "must import fetchCreditSales from the Phase 507 helper");
  assert.match(dash, /await fetchCreditSales\(\)/, "must call fetchCreditSales()");
});

test("overdue-credit count derives from the credit cache, NOT visibleSalesForRole(state.sales)", () => {
  const block = slice("// 4) Overdue credit", "// 5)");
  assert.match(block, /_dashCreditState === "loaded"/, "overdue block must read the credit load state");
  assert.match(block, /_dashCreditRows/, "overdue block must derive count from the fetched cache");
  assert.ok(!/visibleSalesForRole\(state\.sales/.test(block),
    "overdue block must NOT use state.sales (cap ≤50 = undercount)");
});

test("fetched rows are role-filtered (visibleSalesForRole on res.rows)", () => {
  assert.match(dash, /visibleSalesForRole\(res\.rows,\s*state\.profile,\s*state\.currentUser\)/,
    "must role-filter the freshly fetched rows");
});

test("credit loader: stale-seq guard + no refetch when cache loaded + no state.sales fallback on fail", () => {
  const iife = slice("patch เฉพาะการ์ด #dashTodoCard", "})();");
  assert.match(iife, /_dashCreditState === "loaded" \|\| _dashCreditState === "loading"/,
    "must skip refetch when cache is already loaded/loading (period change must not refetch)");
  assert.match(iife, /\+\+_dashCreditSeq/, "must bump a load sequence");
  assert.match(iife, /if \(seq !== _dashCreditSeq\) return/, "must drop a stale (superseded) fetch");
  assert.match(iife, /_dashCreditState = "error"[\s\S]*_dashCreditRows = null/,
    "fail path must mark error + null the cache (no fallback)");
  assert.ok(!/state\.sales/.test(iife), "loader must NOT fall back to state.sales on failure");
  assert.match(iife, /document\.body\.contains\(card\)/, "must guard against route change before patching DOM");
});

test("credit cache is scoped by user/role — key change resets + refetches (no cross-user leak)", () => {
  assert.match(dash, /let _dashCreditCacheKey/, "must keep a cache key tied to the session");
  const block = slice("credit cache ผูกกับ user/role", "const today = todayKey()");
  assert.match(block, /currentUser\??\.id/, "key must include currentUser.id");
  assert.match(block, /profile\??\.role/, "key must include profile.role");
  assert.match(block, /_ckey !== _dashCreditCacheKey/, "must compare the new key to the cached key");
  // on key change → reset cache + state + bump seq so the loader refetches for the new user/role
  assert.match(block, /_dashCreditRows = null/, "key change must clear cached rows");
  assert.match(block, /_dashCreditState = "idle"/, "key change must reset load state to idle (→ refetch)");
  assert.match(block, /_dashCreditSeq\+\+/, "key change must bump seq (invalidate in-flight fetch)");
});

test("idle/loading state does not lie a zero count (shows a loading/unknown row)", () => {
  const block = slice("Phase 508: แถวหนี้เกินกำหนด", "const todoCount");
  assert.match(block, /overdueCreditCount === null/, "must handle the not-yet-loaded state distinctly");
  assert.match(block, /กำลังตรวจ/, "loading state must show a 'checking…' row, not a fabricated 0");
});

test("dashboard.js stays read-only (no raw network/write) even with the new fetch helper", () => {
  assert.ok(!/\bfetch\s*\(/.test(dash), "must not call raw fetch() (helper call fetchCreditSales() is fine)");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete/.test(dash), "no xhr mutation helpers");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'", '"PUT"', "'PUT'"]) {
    assert.ok(!dash.includes(verb), `must not reference HTTP write method ${verb}`);
  }
});
