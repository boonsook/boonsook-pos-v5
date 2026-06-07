// Phase 395 — income-overview-page + dashboard-today-income (read-only report)
// Run: node --test tests/income_overview_guard.test.js
//
// Why this exists:
//   "ภาพรวมรายได้" (modules/income_overview.js) is a read-only report. Its "รายได้"
//   MUST use the SAME definition as the dashboard / P&L — POS sales + web orders +
//   service jobs (delivered/done/closed) — by reusing the shared helpers exported from
//   dashboard.js (sumServiceJobIncome / isWebOrderServiceJob / isServiceIncomeJob). It
//   must never hand-roll its own income formula (that's what diverged in Phase 387).
//   The dashboard also gains a "รายได้วันนี้" (total income incl. service) card without
//   changing the existing "ยอดขายวันนี้" (POS+web) number.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/income_overview.js"), "utf8");
const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");

// ── read-only ────────────────────────────────────────────────────────────────
test("income_overview is read-only (no fetch/xhr/supabase-write, no state mutation)", () => {
  assert.ok(!/\bfetch\s*\(/.test(src), "no fetch()");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete|XMLHttpRequest/.test(src), "no xhr/XHR");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(src), "no supabase writes");
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(src), "no state assignment");
  assert.ok(!/(?:ctx\.)?state\.\w+\.(push|splice|pop|shift|unshift|sort|reverse)\(/.test(src), "no state array mutation");
  for (const v of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'"]) assert.ok(!src.includes(v), `no ${v}`);
});

// ── anti-divergence: reuse the shared income helpers ──────────────────────────
test("income_overview reuses the dashboard income helpers (single source of truth)", () => {
  assert.match(src, /import \{[^}]*sumServiceJobIncome[^}]*\} from "\.\/dashboard\.js"/, "imports helpers from dashboard.js");
  assert.match(src, /sumServiceJobIncome\(jobs,/, "uses sumServiceJobIncome for service income (not a hand-rolled formula)");
  assert.match(src, /isWebOrderServiceJob/, "uses isWebOrderServiceJob to split web orders");
  // must NOT recompute the service-income status set itself
  assert.ok(!/status[\s\S]{0,40}===\s*["']delivered["']/.test(src), "no own delivered-status income formula");
});

// ── admin-gated + renders into the page section ───────────────────────────────
test("income_overview is admin-gated and renders into #page-income_overview", () => {
  assert.match(src, /requireAdmin/, "admin gate");
  assert.match(src, /getElementById\("page-income_overview"\)/, "renders into the section");
  assert.match(src, /export function renderIncomeOverviewPage/, "exports renderIncomeOverviewPage");
});

// ── wiring (main.js + index.html) ─────────────────────────────────────────────
test("income_overview is wired (lazy route + ALL_ROUTES + title + nav + section)", () => {
  assert.match(mainJs, /income_overview:\s*\["\.\/modules\/income_overview\.js",\s*"renderIncomeOverviewPage"\]/, "lazy route");
  assert.match(mainJs, /"expense_overview","income_overview"/, "in ALL_ROUTES next to expense_overview");
  assert.match(mainJs, /income_overview:"ภาพรวมรายได้"/, "title map");
  assert.match(indexHtml, /data-route="income_overview"/, "nav button");
  assert.match(indexHtml, /id="page-income_overview"/, "page section");
});

// ── PART B: dashboard "รายได้วันนี้" card (total income), ยอดขายวันนี้ unchanged ─
test("dashboard adds a รายได้วันนี้ card from todayTotalIncome; ยอดขายวันนี้ stays todayRevenue", () => {
  assert.match(dash, /const todayServiceIncome = sumServiceJobIncome\(/, "computes todayServiceIncome via the helper");
  assert.match(dash, /const todayTotalIncome = todayRevenue \+ todayServiceIncome/, "todayTotalIncome = POS+web+service");
  assert.match(dash, /รายได้วันนี้[\s\S]{0,90}money\(todayTotalIncome\)/, "renders a รายได้วันนี้ card from todayTotalIncome");
  assert.match(dash, /go: "income_overview"/, "the card links to income_overview");
  // the existing hero "ยอดขายวันนี้" must remain todayRevenue (POS+web), unchanged
  assert.match(dash, /dash-today-amount">\$\{money\(todayRevenue\)\}/, "ยอดขายวันนี้ unchanged (todayRevenue)");
});
