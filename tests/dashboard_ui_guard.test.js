// Phase 389 (DRAFT) — structural dashboard UI redesign
// Run: node --test tests/dashboard_ui_guard.test.js
//
// Why this exists:
//   Phase 389 restructures the "ภาพรวมบริษัท" top section (modules/dashboard.js):
//   the gradient marketing hero is replaced by a flat business header + today
//   highlight + a class-based KPI grid (CSS in style.css). This is a STRUCTURAL
//   UI change, so the redesign must:
//     1. keep dashboard.js strictly read-only (no fetch / no state mutation),
//     2. preserve EVERY event hook main.js/dashboard.js binds to (button ids,
//        data-go nav cards, period tabs, low-stock rows, line-order, pro-range
//        selects, and every chart canvas id) — break one and a feature dies,
//     3. escape all user/DB values it renders,
//     4. ship the presentation in style.css (class-based, no inline grid).
//   (Build/cache-bump consistency is covered separately once Phase 388 merges;
//    this draft intentionally does NOT touch index.html / sw.js.)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
const css = fs.readFileSync(path.resolve("style.css"), "utf8");

// ── read-only stays intact after the restructure ─────────────────────────────
test("restructured dashboard.js is still strictly read-only", () => {
  assert.ok(!/\bfetch\s*\(/.test(dash), "must not call fetch()");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete|XMLHttpRequest/.test(dash), "must not call xhr/XHR mutation");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(dash), "must not call supabase writes");
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(dash), "must not assign into state.*");
  assert.ok(!/(?:ctx\.)?state\.\w+\.(push|splice|pop|shift|unshift|sort|reverse)\(/.test(dash),
    "must not mutate state arrays in place");
  for (const bad of ["checkout", "addToCart", "decrementStock", "autoPost", "postJournal", "loadAllData("]) {
    assert.ok(!dash.includes(bad), `read-only dashboard must not reference "${bad}"`);
  }
});

// ── structural redesign is in place ──────────────────────────────────────────
test("gradient marketing hero is replaced by flat header + today + KPI grid", () => {
  assert.ok(!/class="hero"|hero-amount|hero-grid|hero-title-row|shop-bubble/.test(dash),
    "old gradient hero markup must be gone");
  assert.match(dash, /function _dashHeader\(/, "has a _dashHeader render helper");
  assert.match(dash, /function _kpiCard\(/, "has a _kpiCard render helper");
  assert.match(dash, /class="dash-header"/, "renders the flat business header");
  assert.match(dash, /class="dash-today"/, "renders the today highlight (not a hero)");
  assert.ok((dash.match(/class="kpi-grid"/g) || []).length >= 2, "renders at least two KPI grids");
});

// ── presentation lives in style.css, not an inline <style> ───────────────────
test("dash-clickable styles moved to style.css; Phase 389 classes exist", () => {
  assert.ok(!/dash-clickable \{ cursor:cursor|\.dash-clickable \{ cursor/.test(dash),
    "inline .dash-clickable <style> must be removed from dashboard.js");
  assert.match(css, /PHASE 389 \(DRAFT\) — structural dashboard redesign/, "style.css has the Phase 389 block");
  for (const cl of [".dash-header", ".dash-today", ".dash-period-tabs", ".dash-period-btn", ".kpi-grid", ".kpi-card", ".dash-clickable"]) {
    assert.ok(css.includes(cl), `style.css must define ${cl}`);
  }
  // dark-mode safety: header/today/kpi backgrounds use tokens, not hardcoded #fff
  assert.match(css, /\.kpi-card \{[^}]*background: var\(--surface\)/, "kpi-card bg must be a token (dark-mode safe)");
});

// ── EVERY event hook survives the restructure (break one → a feature dies) ───
test("all button-id hooks are preserved", () => {
  for (const id of ["dashboardReceiptBtn", "sendDailySummaryBtn", "goProductsBtn", "goServiceJobsBtn", "goExpensesBtn"]) {
    assert.ok(dash.includes(`id="${id}"`) || dash.includes(`getElementById("${id}")`),
      `hook #${id} must be preserved`);
  }
});

test("KPI nav cards preserve every data-go route + emit data-go at render", () => {
  // _kpiCard turns go:"route" into data-go="route" on a .dash-clickable card
  assert.match(dash, /const goAttr = go \? ` data-go="\$\{go\}"` : "";/, "_kpiCard emits data-go");
  assert.match(dash, /const cls = "kpi-card" \+ \(go \? " dash-clickable" : ""\);/, "go cards get .dash-clickable");
  for (const route of ["receipts", "customers", "products", "service_jobs", "quotations", "settings", "settings/permissions"]) {
    assert.ok(dash.includes(`go: "${route}"`), `KPI nav route "${route}" must be preserved`);
  }
});

test("period tabs / low-stock / line-order / pro-range hooks are preserved", () => {
  assert.match(dash, /class="dash-period-btn \$\{_dashPeriod===p \? 'active' : ''\}" data-period="\$\{p\}"/,
    "period tab keeps .dash-period-btn + data-period (active via class)");
  assert.match(dash, /class="dash-low-stock-row" data-pid=/, "low-stock row hook preserved");
  assert.match(dash, /data-line-order=/, "line-order button hook preserved");
  assert.match(dash, /class="pro-range-select" data-panel=/, "pro-range select hook preserved");
});

test("all chart canvas ids are preserved (charts must keep rendering)", () => {
  for (const id of ["salesByProductChart", "revenueBarChart", "expenseDonutChart", "paymentBarChart", "jobStatusChart", "salesChart"]) {
    assert.ok(dash.includes(`id="${id}"`), `chart canvas #${id} must be preserved`);
    assert.ok(dash.includes(`getElementById("${id}")`), `chart #${id} must still be wired`);
  }
});

// ── user/DB values are escaped ───────────────────────────────────────────────
test("rendered user/store values are escaped", () => {
  assert.match(dash, /value: escapeHtml\(userName\)/, "user name escaped");
  assert.match(dash, /value: escapeHtml\(userRoleLabel\)/, "role label escaped");
  assert.match(dash, /alt="\$\{escapeHtml\(shopName\)\}"/, "shop name escaped in logo alt");
  assert.match(dash, /\$\{escapeHtml\(shopName\)\}<\/div>/, "shop name escaped in header name");
  // Codex review: logo URL can come from storeInfo/localStorage → must escape the
  // attribute value, never interpolate raw (attribute-breakout / XSS guard).
  assert.match(dash, /src="\$\{escapeHtml\(logoSrc\)\}"/, "logo src must be escaped");
  assert.ok(!/src="\$\{logoSrc\}"/.test(dash), "logo src must NOT interpolate raw logoSrc");
});
