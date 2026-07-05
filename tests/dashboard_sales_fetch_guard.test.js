// Phase 562 — dashboard KPI เดือน/ปี/trend ดึงยอดขายจริงจาก DB (เลิกพึ่ง state.sales cap 50)
//
// Why: loadAllData caps state.sales at 50 (main.js). dashboard period/month/trend/chart
// reduced state.sales → any shop doing >50 bills/month undercounted the "เดือนนี้/ปีนี้" tabs.
// This mirrors the Phase 508 credit async-cache: fetch the full-year sales (paginated, no cap)
// via fetchSalesSince, role-filter, and aggregate from that set (fallback to state while loading).
//
// These are SOURCE guards (renderDashboard writes to the DOM, not unit-runnable). They lock:
//   (1) the full-fetch is wired + role-filtered + loop-safe, (2) aggregates read _salesForAgg,
//   (3) the surface stays read-only (no direct fetch()/writes — the readonly guard also covers this).
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "..", "modules", "dashboard.js"), "utf8");

// ── wiring: fetchSalesSince imported + module cache (ลอกโครง Phase 508) ────────
test("imports fetchSalesSince from sales_fetch.js (reuse Phase 492 paginated helper)", () => {
  assert.match(src, /import\s+\{[^}]*fetchSalesSince[^}]*\}\s+from\s+["']\.\/sales_fetch\.js["']/);
});

test("declares the module-scope sales cache (rows/state/seq/cacheKey)", () => {
  for (const v of ["_dashSalesRows", "_dashSalesState", "_dashSalesSeq", "_dashSalesCacheKey"]) {
    assert.match(src, new RegExp(`let\\s+${v}\\b`), `must declare ${v}`);
  }
});

// ── source select: aggregate reads _salesForAgg (loaded=full / else state fallback) ──
test("_salesForAgg = loaded rows when loaded, else role-filtered state (no throw / no blank page)", () => {
  assert.match(
    src,
    /_salesForAgg\s*=\s*\(_dashSalesState === "loaded" && _dashSalesRows\)\s*\?\s*_dashSalesRows\s*:\s*_stateSales/,
    "aggregate source must fall back to state.sales while loading/error",
  );
  assert.match(src, /_stateSales\s*=\s*visibleSalesForRole\(state\.sales/, "fallback must be role-filtered state");
});

test("period + month + trend aggregate from _salesForAgg, not raw state.sales", () => {
  assert.match(src, /filterByPeriod\(_salesForAgg,\s*"created_at"/, "period uses _salesForAgg");
  assert.match(src, /const monthSales = _salesForAgg\.filter/, "month uses _salesForAgg");
  assert.match(src, /_trendMonths\(_salesForAgg,/, "trend uses _salesForAgg");
  assert.match(src, /renderChart\(_salesForAgg,/, "chart uses _salesForAgg");
});

// ── fetch trigger: loop-safe, role-filtered, cache keyed by user/role/year ─────
test("fetches only when idle (loop-safe — error/loaded/loading do not refetch)", () => {
  assert.match(src, /if \(_dashSalesState !== "idle"\) return;/, "trigger must guard on idle (loop-safe)");
  assert.match(src, /await fetchSalesSince\(_yearStart\)/, "fetches the full year from the year-start cutoff");
});

test("stale-guard via seq (a newer render's fetch wins)", () => {
  assert.match(src, /const seq = \+\+_dashSalesSeq/);
  assert.match(src, /if \(seq !== _dashSalesSeq\) return/);
});

test("cache key binds user + role + year; invalidation resets to idle", () => {
  assert.match(src, /_skey\s*=\s*`\$\{state\?\.currentUser\?\.id[\s\S]{0,80}_yearStart\}`/, "key includes user/role/year");
  assert.match(src, /_dashSalesCacheKey = _skey;[\s\S]{0,120}_dashSalesState = "idle"/, "key change resets state to idle");
});

test("fetched rows are role-filtered before use (no cross-user leak)", () => {
  assert.match(
    src,
    /_dashSalesRows = visibleSalesForRole\(res\.rows, state\.profile, state\.currentUser\)/,
    "rows from DB must pass through visibleSalesForRole",
  );
});

test("error path keeps rows null (no silent undercount fallback in the cache itself)", () => {
  assert.match(src, /_dashSalesState = "error";\s*\n\s*_dashSalesRows = null/, "error must null the cache, fallback handled by _salesForAgg");
});

// ── read-only: no direct fetch()/writes added (fetch goes through the imported helper) ──
test("dashboard.js still performs NO direct fetch() or supabase writes (read-only surface)", () => {
  assert.ok(!/\bfetch\s*\(/.test(src), "must not call fetch() directly (use imported fetchSalesSince)");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(src), "must not call supabase write ops");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'"]) {
    assert.ok(!src.includes(verb), `must not reference HTTP write ${verb}`);
  }
});
