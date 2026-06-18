// Phase 492 (audit S-5) — range-reports fetch sales by date range (not capped state.sales).
// Run: node --test tests/sales_fetch_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchSalesSince, bufferedSince } from "../modules/sales_fetch.js";

// ── pure: bufferedSince ─────────────────────────────────────────────────────────
test("bufferedSince subtracts a 2-day buffer (TZ-safe superset); empty/invalid → ''", () => {
  assert.equal(bufferedSince("2026-06-18"), "2026-06-16");
  assert.equal(bufferedSince("2026-01-01"), "2025-12-30", "crosses month/year boundary");
  assert.equal(bufferedSince(""), "");
  assert.equal(bufferedSince(null), "");
  assert.equal(bufferedSince("not-a-date"), "");
});

// ── behavioral: fetchSalesSince (mock global fetch + window) ─────────────────────
function withMockFetch(impl, fn) {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG: { url: "https://x.test", anonKey: "anon" }, _sbAccessToken: "tok" };
  globalThis.fetch = async (url) => { calls.push(url); return impl(url); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = prevFetch; globalThis.window = prevWindow; });
}

test("fetchSalesSince(cutoff) filters created_at >= buffered cutoff", () =>
  withMockFetch(() => ({ ok: true, json: async () => [{ id: 1, total_amount: 10 }] }), async (calls) => {
    const r = await fetchSalesSince("2026-06-18");
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1);
    assert.match(calls[0], /sales\?select=\*&created_at=gte\.2026-06-16/, "uses the 2-day-buffered lower bound");
  }));

test("fetchSalesSince('') fetches ALL sales (no lower bound)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async (calls) => {
    const r = await fetchSalesSince("");
    assert.equal(r.ok, true);
    assert.ok(!/created_at=gte/.test(calls[0]), "no created_at filter for the 'all' period");
  }));

test("fetchSalesSince: HTTP failure → {ok:false} (NOT a silent empty)", () =>
  withMockFetch(() => ({ ok: false, status: 500, json: async () => null }), async () => {
    const r = await fetchSalesSince("2026-06-01");
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }));

test("fetchSalesSince: non-array body → {ok:false}", () =>
  withMockFetch(() => ({ ok: true, json: async () => ({ oops: true }) }), async () => {
    const r = await fetchSalesSince("2026-06-01");
    assert.equal(r.ok, false);
  }));

test("no SUPABASE_CONFIG → {ok:false} (fail-closed)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async () => {
    globalThis.window = {};
    const r = await fetchSalesSince("2026-06-01");
    assert.equal(r.ok, false);
  }));

// ── source: the 3 range-reports fetch sales by range instead of capped state.sales ─
test("sales_heatmap fetches by range + renders from the fetched rows", () => {
  const src = fs.readFileSync(path.resolve("modules/sales_heatmap.js"), "utf8");
  assert.match(src, /fetchSalesSince\(cutoffKey\)/, "heatmap fetches sales since the period cutoff");
  assert.match(src, /visibleSalesForRole\(salesRows,/, "matrix is built from the fetched rows, not state.sales");
  assert.match(src, /from "\.\/sales_fetch\.js"/, "imports the sales fetch helper");
});

test("expenses lazy-fills รายรับ/กำไรเดือนนี้ from fetched sales", () => {
  const src = fs.readFileSync(path.resolve("modules/expenses.js"), "utf8");
  assert.match(src, /fetchSalesSince\(thisMonth \+ "-01"\)/, "fetches this month's sales");
  assert.match(src, /getElementById\("expMonthIncome"\)/, "patches the income card");
  assert.ok(!/const sales = visibleSalesForRole\(ctx\.state\.sales/.test(src), "no longer reads capped state.sales for the income card");
});

test("profit_report fetches range sales + uses chunked sale_items helper (large ranges)", () => {
  const src = fs.readFileSync(path.resolve("modules/profit_report.js"), "utf8");
  assert.match(src, /fetchSalesSince\(fromDate\)/, "fetches sales since the report's from-date");
  assert.match(src, /visibleSalesForRole\(_fetchedSales,/, "main report uses the fetched sales");
  assert.match(src, /renderMonthlyTrend\(fromDate, toDate, saleItems, productCostMap, _fetchedSales\)/, "monthly trend gets the fetched sales");
  assert.match(src, /fetchSaleItemsForSaleIds\(saleIds\)/, "sale_items via the chunked/paginated helper (no raw .in for big ranges)");
});
