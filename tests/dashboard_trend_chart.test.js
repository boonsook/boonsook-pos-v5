// Phase 396 — dashboard income-vs-expense trend line (full-width, read-only)
// Run: node --test tests/dashboard_trend_chart.test.js
//
// Why this exists:
//   The dashboard "กราฟยอดขาย 12 เดือน" bar (single series, misleading "12 เดือน" label on
//   capped data) became a full-width LINE chart with two series — รายได้ (blue) vs ค่าใช้จ่าย
//   (red) — bucketed over the months that actually have loaded data (sales cap ~50 / expenses
//   cap ~200), with an honest caption. It must stay read-only (no fetch / no mutation).
//   We extract the renderChart BODY first so other charts' `type:` can't false-positive.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
// renderChart body only (from `function renderChart(` to its lone closing brace)
const body = (src.match(/function renderChart\([\s\S]*?\n\}\n/) || [""])[0];

test("renderChart is a 2-line income/expense chart guarded by typeof Chart", () => {
  assert.ok(body.length > 0, "found the renderChart body");
  assert.match(body, /typeof Chart\s*===\s*["']undefined["']/, "has the typeof Chart guard");
  assert.match(body, /type\s*:\s*["']line["']/, "is a line chart (not bar)");
  assert.match(body, /label\s*:\s*["']รายได้["']/, "has a รายได้ dataset (income, blue)");
  assert.match(body, /label\s*:\s*["']ค่าใช้จ่าย["']/, "has a ค่าใช้จ่าย dataset (expense, red)");
  assert.match(body, /total_amount/, "income summed from total_amount");
  assert.match(body, /expense_date/, "expense bucketed by expense_date");
  assert.match(body, /\.amount/, "expense summed from amount");
  assert.match(body, /legend\s*:\s*\{\s*display\s*:\s*true/, "legend shown (two lines)");
});

test("renderChart is called with (sales, expenses) and stays read-only", () => {
  // Phase 562: sales arg renamed allSales → _salesForAgg (full-year fetch, cap-free)
  assert.match(src, /renderChart\(_salesForAgg,\s*expenses\)/, "call site passes income + expenses");
  assert.ok(!/\bfetch\s*\(/.test(body), "no fetch in renderChart");
  assert.ok(!/\.(push|splice|sort|reverse|pop|shift|unshift)\(/.test(body), "no in-place array mutation in renderChart");
});

test("trend panel has an honest caption and drops the misleading '12 เดือน' label", () => {
  assert.match(src, /แนวโน้มรายได้ & ค่าใช้จ่าย/, "new full-width trend title");
  assert.match(src, /จากรายการล่าสุด/, "honest caption (loaded records, not whole system)");
  assert.ok(!/กราฟยอดขาย 12 เดือน/.test(src), "old misleading '12 เดือน' title removed");
  assert.match(src, /ยังไม่มีข้อมูลพอแสดงแนวโน้ม/, "empty-state present");
});

test("the shared _trendMonths helper buckets only real months and does not mutate input", () => {
  const fn = (src.match(/function _trendMonths\([\s\S]*?\n\}\n/) || [""])[0];
  assert.ok(fn.length > 0, "found _trendMonths");
  assert.match(fn, /new Set\(\)/, "uses a Set of real months");
  assert.match(fn, /\]\.sort\(\)\.slice\(-12\)/, "sorts a COPY (spread) then caps at 12 — no in-place sort");
});
