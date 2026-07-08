// Phase 577 (audit ROUND2 B1+B3) — income_overview + dashboard ดึงยอดเต็มจาก DB (ไม่ cap 200/50)
//
// Why: loadAllData caps state.expenses at 200 + state.serviceJobs at 50. dashboard "กำไรสุทธิเดือน"
// (รายจ่าย + รายได้บริการ + ออเดอร์เว็บ) และหน้า "ภาพรวมรายได้" ทั้งหน้า reduce จาก array ที่ cap →
// ร้านที่มี >200 รายจ่าย / >50 งาน ต่อช่วง โชว์ต่ำกว่าจริงเงียบ ๆ. Phase 577 fetch ยอดเต็มปี
// (paginated, read-only) ผ่าน modules/range_fetch.js แล้ว aggregate จากชุดนั้น (fallback state + ป้าย).
//
// Locks: (1) behavioral range_fetch (paginate >1000 / error ไม่เงียบ / buffered / service OR filter),
//        (2) source dashboard (aggregation อ่าน _dashExpenseRows/_dashServiceRows เมื่อ loaded + fallback),
//        (3) source income_overview (async fetch + skeleton + fallback+ป้าย error).
// Run: node --test tests/income_dashboard_fetch_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchExpensesSince, fetchServiceJobsSince, bufferedSince } from "../modules/range_fetch.js";

// ═══ (1) behavioral: mock global fetch + window (mirror sales_fetch_guard) ═══
function withMockFetch(impl, fn) {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG: { url: "https://x.test", anonKey: "anon" }, _sbAccessToken: "tok" };
  globalThis.fetch = async (url) => { calls.push(url); return impl(url); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = prevFetch; globalThis.window = prevWindow; });
}

// helper: return a page keyed by the offset in the URL (proves the loop paginates past 1000)
function pagedImpl(pagesByOffset) {
  return (url) => {
    const m = /offset=(\d+)/.exec(url);
    const off = m ? Number(m[1]) : 0;
    const page = pagesByOffset[off] || [];
    return { ok: true, json: async () => page };
  };
}

test("bufferedSince re-exported from range_fetch (single source of date-math) — subtracts 2 days", () => {
  assert.equal(bufferedSince("2026-06-18"), "2026-06-16");
  assert.equal(bufferedSince("2026-01-01"), "2025-12-30", "crosses year boundary");
  assert.equal(bufferedSince(""), "");
});

test("fetchExpensesSince: paginates past the 1000-row cap (loops offset until short page)", () =>
  withMockFetch(pagedImpl({
    0: Array.from({ length: 1000 }, (_, i) => ({ id: i, amount: 1 })),
    1000: Array.from({ length: 3 }, (_, i) => ({ id: 1000 + i, amount: 1 })),
  }), async (calls) => {
    const r = await fetchExpensesSince("2026-06-18");
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1003, "must concatenate BOTH pages (not stop at the first 1000)");
    assert.match(calls[0], /expenses\?select=\*&expense_date=gte\.2026-06-16/, "2-day-buffered lower bound");
    assert.ok(calls.length >= 2, "must issue a second page request");
  }));

test("fetchExpensesSince: HTTP failure → {ok:false} (NOT a silent empty)", () =>
  withMockFetch(() => ({ ok: false, status: 500, json: async () => null }), async () => {
    const r = await fetchExpensesSince("2026-06-01");
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }));

test("fetchExpensesSince: non-array body → {ok:false}", () =>
  withMockFetch(() => ({ ok: true, json: async () => ({ oops: true }) }), async () => {
    const r = await fetchExpensesSince("2026-06-01");
    assert.equal(r.ok, false);
  }));

test("fetchExpensesSince(''): no lower bound (fetch all)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async (calls) => {
    const r = await fetchExpensesSince("");
    assert.equal(r.ok, true);
    assert.ok(!/expense_date=gte/.test(calls[0]), "no date filter for the 'all' period");
  }));

test("fetchServiceJobsSince: OR filter covers BOTH closed_at (income date) AND created_at (web-order date)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async (calls) => {
    const r = await fetchServiceJobsSince("2026-06-18");
    assert.equal(r.ok, true);
    // superset: งานที่ "ปิดในช่วง" (closed_at) หรือ "สร้างในช่วง" (created_at) — ไม่งั้นรายได้บริการหลุด
    assert.match(calls[0], /or=\(closed_at\.gte\.2026-06-16,created_at\.gte\.2026-06-16\)/, "PostgREST OR on closed_at + created_at, 2-day-buffered");
  }));

test("fetchServiceJobsSince: HTTP failure → {ok:false} (ไม่เงียบ)", () =>
  withMockFetch(() => ({ ok: false, status: 403, json: async () => null }), async () => {
    const r = await fetchServiceJobsSince("2026-06-01");
    assert.equal(r.ok, false);
  }));

test("range_fetch fails closed when SUPABASE_CONFIG missing", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async () => {
    globalThis.window = {};
    assert.equal((await fetchExpensesSince("2026-06-01")).ok, false);
    assert.equal((await fetchServiceJobsSince("2026-06-01")).ok, false);
  }));

// ═══ (2) source-regex: dashboard aggregates from fetched rows (loaded) else state (fallback) ═══
const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");

test("dashboard imports the range helpers + declares aux cache (rows/state/seq)", () => {
  assert.match(dash, /import\s+\{[^}]*fetchExpensesSince[^}]*fetchServiceJobsSince[^}]*\}\s+from\s+["']\.\/range_fetch\.js["']/);
  for (const v of ["_dashExpenseRows", "_dashServiceRows", "_dashAuxState", "_dashAuxSeq"]) {
    assert.match(dash, new RegExp(`let\\s+${v}\\b`), `must declare ${v}`);
  }
});

test("dashboard: expenses/service aggregate source = fetched rows when loaded, else state fallback (no silent undercount)", () => {
  assert.match(dash, /_expensesForAgg\s*=\s*\(_dashAuxState === "loaded" && _dashExpenseRows\)\s*\?\s*_dashExpenseRows\s*:\s*\(state\.expenses \|\| \[\]\)/);
  assert.match(dash, /_serviceForAgg\s*=\s*\(_dashAuxState === "loaded" && _dashServiceRows\)\s*\?\s*_dashServiceRows\s*:\s*\(state\.serviceJobs \|\| \[\]\)/);
  // the money KPIs must read the *ForAgg source, not the capped state arrays directly
  assert.match(dash, /const expenses = _expensesForAgg;/, "expense total reads the full-fetch source");
  assert.match(dash, /const webOrders = _serviceForAgg\.filter\(isWebOrderServiceJob\)/, "web orders read the full-fetch service source");
  assert.match(dash, /todayServiceIncome = sumServiceJobIncome\(_serviceForAgg,/, "today service income from full-fetch");
  assert.match(dash, /monthServiceIncome = sumServiceJobIncome\(_serviceForAgg,/, "month service income from full-fetch");
});

test("dashboard: aux fetch is idle-guarded (loop-safe), seq-stale-guarded, and nulls rows on error", () => {
  assert.match(dash, /if \(_dashAuxState !== "idle"\) return;/, "aux trigger guards on idle (no refetch loop)");
  assert.match(dash, /const seq = \+\+_dashAuxSeq/, "aux seq bump");
  assert.match(dash, /if \(seq !== _dashAuxSeq\) return;/, "aux stale-guard");
  assert.match(dash, /await Promise\.all\(\[\s*fetchExpensesSince\(_yearStart\),\s*fetchServiceJobsSince\(_yearStart\),?\s*\]\)/, "fetches expenses + service in parallel from year-start");
  assert.match(dash, /_dashAuxState = "error";[\s\S]{0,120}_dashExpenseRows = null;[\s\S]{0,200}_dashServiceRows = null;/, "error nulls the aux cache (fallback handled by *ForAgg)");
});

test("dashboard: Phase 562 sales block kept intact (dashboard_sales_fetch_guard not weakened)", () => {
  // the aux block is SEPARATE — the sales block's literal await must remain (guard depends on it)
  assert.match(dash, /await fetchSalesSince\(_yearStart\)/, "sales block literal preserved");
  assert.ok(!/\bfetch\s*\(/.test(dash), "dashboard still makes NO raw fetch() (all via imported helpers)");
});

// ═══ (3) source-regex: income_overview is fetch-backed (skeleton/loaded/error) ═══
const io = fs.readFileSync(path.resolve("modules/income_overview.js"), "utf8");

test("income_overview imports the paginated helpers (no raw fetch in the page module)", () => {
  assert.match(io, /import\s+\{\s*fetchSalesSince\s*\}\s+from\s+["']\.\/sales_fetch\.js["']/);
  assert.match(io, /import\s+\{\s*fetchServiceJobsSince\s*\}\s+from\s+["']\.\/range_fetch\.js["']/);
  assert.ok(!/\bfetch\s*\(/.test(io), "must not call raw fetch() (read-only helper only)");
});

test("income_overview: async full-year load, skeleton while loading, cache keyed by user/role/year", () => {
  assert.match(io, /let\s+_ioState\b/, "declares load state");
  assert.match(io, /if \(_ioState === "idle"\)/, "loads only when idle (period tab does not refetch)");
  assert.match(io, /await Promise\.all\(\[fetchSalesSince\(_yearStart\), fetchServiceJobsSince\(_yearStart\)\]\)/, "fetches sales + service for the year");
  assert.match(io, /renderSkeleton\(/, "shows a skeleton while loading");
  assert.match(io, /if \(seq !== _ioSeq\) return;/, "stale-guard on resolve");
  assert.match(io, /_ioSalesRows = visibleSalesForRole\(sRes\.rows,/, "fetched sales are role-filtered");
});

test("income_overview: loaded reads fetched rows, error falls back to state + shows a ⚠️ banner", () => {
  assert.match(io, /const _loaded = _ioState === "loaded";/);
  assert.match(io, /const allSales = \(_loaded && _ioSalesRows\) \? _ioSalesRows : visibleSalesForRole\(state\?\.sales/, "sales source = fetched when loaded, else state");
  assert.match(io, /const jobs = \(_loaded && _ioServiceRows\) \? _ioServiceRows : \(state\?\.serviceJobs \|\| \[\]\)/, "service source = fetched when loaded, else state");
  assert.match(io, /!_loaded \?[\s\S]{0,400}อาจต่ำกว่าจริง/, "error/fallback shows a ⚠️ undercount warning banner");
  assert.match(io, /ioRetryBtn/, "banner offers a retry");
  // the guard-critical aggregation patterns must survive the refactor (period-matched by serviceIncomeDate)
  assert.match(io, /serviceTotal = sumServiceJobIncome\(jobs,\s*j\s*=>\s*inPeriod\(serviceIncomeDate\(j\),\s*_period\)\)/, "service income still dated by serviceIncomeDate");
  assert.match(io, /posTotal = allSales\.filter\(s\s*=>\s*inPeriod\(s\.created_at,\s*_period\)\)/, "POS still dated by created_at");
});
