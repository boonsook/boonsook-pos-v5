// Phase 507 — credit-tracker-full-fetch guard
// Run: node --test tests/credit_tracker_full_fetch.test.js
//
// Invariant: Credit Tracker ต้องดึงบิลเครดิต "ครบ" จาก DB (paginated, stable PK) ไม่อิง
// state.sales (cap ≤50 = undercount เงียบ); fetch แยกจาก render (filter ไม่ re-fetch);
// fail ต้องไม่ fallback/ไม่ silent empty; payment contract เดิมไม่ถูกแตะ.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FETCH = fs.readFileSync(path.resolve("modules/credit_sales_fetch.js"), "utf8");
const CT = fs.readFileSync(path.resolve("modules/credit_tracker.js"), "utf8");

function bodyOf(src, anchor, endAnchor) {
  const i = src.indexOf(anchor);
  assert.ok(i > -1, `anchor not found: ${anchor}`);
  const j = endAnchor ? src.indexOf(endAnchor, i) : src.length;
  return src.slice(i, j > -1 ? j : src.length);
}

test("helper fetchCreditSales: raw fetch + paginated (limit/offset) credit sales", () => {
  assert.match(FETCH, /export async function fetchCreditSales\(/, "must export fetchCreditSales");
  assert.match(FETCH, /\/rest\/v1\/sales\?/, "must hit sales endpoint via raw fetch");
  assert.match(FETCH, /\blimit=/, "must paginate with limit");
  assert.match(FETCH, /\boffset=/, "must paginate with offset");
  assert.match(FETCH, /page\.length < PAGE/, "must stop on last (short) page");
});

test("helper query filters is_credit=eq.true", () => {
  assert.match(FETCH, /is_credit=eq\.true/, "must query only credit sales");
});

test("helper paginates by stable PK (id.asc), not created_at alone", () => {
  assert.match(FETCH, /order=id\.asc/, "pagination order must be stable PK id.asc");
  assert.ok(!/order=created_at\.desc/.test(FETCH),
    "must NOT use created_at.desc as the only pagination order (boundary dup/miss risk)");
});

test("helper returns {ok:false, error} on failure — never a silent empty success", () => {
  assert.match(FETCH, /return \{ ok: false, rows: \[\], error:/g,
    "fail path must return ok:false + error");
  // success path returns ok:true; there must be no `return { ok: true, rows: [] }` swallow
  assert.ok(!/ok: true, rows: \[\] \}/.test(FETCH), "must not return a hardcoded empty success");
});

test("credit_tracker no longer uses visibleSalesForRole(state.sales) as the page source", () => {
  assert.ok(!/visibleSalesForRole\(state\.sales/.test(CT),
    "page must NOT derive from state.sales (cap ≤50 = undercount)");
  assert.match(CT, /visibleSalesForRole\(res\.rows,/,
    "must role-filter the freshly fetched rows instead");
});

test("fetch is separated from render via module-scope cache + load fn", () => {
  assert.match(CT, /let _creditRows = null/, "must keep a module-scope cache of fetched rows");
  assert.match(CT, /let _creditLoadSeq = 0/, "must keep a load sequence to drop stale fetches");
  assert.match(CT, /export async function loadCreditSales\(ctx/, "must expose loadCreditSales");
  assert.match(CT, /if \(seq !== _creditLoadSeq\) return/, "must guard against stale (superseded) load");
  assert.match(CT, /import \{ fetchCreditSales \} from "\.\/credit_sales_fetch\.js"/,
    "must use the dedicated paginated fetch helper");
});

test("filter buttons are render-only (no network) — render-from-cache", () => {
  const handler = bodyOf(CT, '.ct-filter-btn").forEach', "});");
  assert.match(handler, /renderCreditTrackerPage\(ctx\)/, "filter must re-render");
  assert.ok(!/loadCreditSales|fetchCreditSales|fetch\(/.test(handler),
    "filter handler must NOT fetch/load over the network");
});

test("page does not fall back to state.sales / loadAllData on this surface", () => {
  assert.ok(!/\.loadAllData\b/.test(CT),
    "must not CALL loadAllData as this page's source (comment mention is fine)");
});

test("after a payment, the list force-reloads from the credit fetch", () => {
  assert.match(CT, /loadCreditSales\(ctx, \{ force: true \}\)/,
    "post-payment (and retry) must force a fresh credit fetch");
});

test("processCreditPayment contract is untouched (ledger insert → CAS → JV)", () => {
  assert.match(CT, /export async function processCreditPayment\(/, "processCreditPayment must remain");
  const body = bodyOf(CT, "export async function processCreditPayment(", "let _ctFilter");
  assert.match(body, /\/rest\/v1\/credit_payments/, "must still insert into credit_payments ledger");
  assert.match(body, /atomicAdd\(/, "must still CAS the cached credit_paid_amount");
  assert.match(body, /ledgerInserted: true, retrySafe: false/, "retry-safety contract intact");
});
