// Phase 421 — ui-skin-refresh guard (light sidebar + indigo accent)
// Run: node --test tests/ui_theme_guard.test.js
//
// Why this exists:
//   Phase 421 is a CSS-ONLY skin refresh toward the owner-approved "mock F"
//   direction: lavender workspace bg, white (surface) sidebar, solid indigo
//   active nav pill, indigo primary tokens in both light and dark mode, and
//   the phase4 design-system primary scale remapped sky -> indigo.
//   These guards lock the token values and the appended "PHASE 421" skin
//   block so a later phase cannot silently revert the direction or leave the
//   two token systems (style.css vs phase4-design-system.css) out of sync.
//
// Source-level checks only (same pattern as dashboard_readonly_guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve("style.css"), "utf8");
const p4 = fs.readFileSync(path.resolve("phase4-design-system.css"), "utf8");
const p4c = fs.readFileSync(path.resolve("phase4-components.css"), "utf8");

// ── light tokens ──────────────────────────────────────────────────────────────
test("style.css :root carries the Phase 431 light tokens (blue-gray bg + sky pair)", () => {
  // Phase 431: owner feedback "ม่วงแสบตา" — indigo reverted to the original sky blue
  // (424's deeper-bg decision kept, hue shifted from lavender to blue-gray)
  assert.match(css, /--bg:\s*#e8eef7/, "--bg must be #e8eef7");
  assert.match(css, /--line:\s*#e7ecf3/, "--line must be #e7ecf3");
  assert.match(css, /--primary:\s*#0ea5e9/, "--primary must be #0ea5e9");
  assert.match(css, /--primary2:\s*#0284c7/, "--primary2 must be #0284c7");
});

// ── dark tokens ───────────────────────────────────────────────────────────────
test("style.css dark theme uses the sky pair (indigo token values gone)", () => {
  assert.match(css, /--primary:\s*#38bdf8/, "dark --primary must be #38bdf8");
  assert.match(css, /--primary2:\s*#0ea5e9/, "dark --primary2 must be #0ea5e9");
  assert.ok(!/--primary2?:\s*#5b5bd6/.test(css), "indigo --primary2 must be gone (Phase 431)");
  assert.ok(!/--primary2?:\s*#6b6be0/.test(css), "indigo token must be gone (Phase 431)");
  assert.ok(!/--primary2?:\s*#8a8af2/.test(css), "indigo dark token must be gone (Phase 431)");
});

// ── appended skin block (must win the cascade over Phase 386 sidebar rules) ──
test("PHASE 421 skin block exists and restyles the sidebar via tokens", () => {
  const i = css.indexOf("PHASE 421");
  assert.ok(i > -1, "appended PHASE 421 section must exist");
  const sect = css.slice(i);
  assert.match(sect, /\.sidebar\s*\{[^}]*background:\s*var\(--surface\)/,
    "sidebar must be the flat surface card (not the legacy dark gradient)");
  assert.match(sect, /\.sidebar\s*\{[^}]*border-right:\s*1px solid var\(--line\)/,
    "sidebar must use the token border");
  assert.match(sect, /\.nav-btn\.active\s*\{[^}]*background:\s*var\(--primary2\)/,
    "active nav must be the solid indigo pill");
  assert.match(sect, /\.nav-btn\.active\s*\{[^}]*box-shadow:\s*none/,
    "Phase-386 inset left accent must be neutralised in the new skin");
  assert.ok(!/rgba\(91,\s*91,\s*214/.test(sect),
    "no indigo rgba inside the PHASE 421 block (Phase 431: hue is sky)");
});

// ── Phase 422: mock-F dashboard layout (quick actions + brand hero) ──────────
test("PHASE 422 dashboard layout: quick-action row + brand hero, nav-only", () => {
  const i = css.indexOf("PHASE 422");
  assert.ok(i > -1, "PHASE 422 css section must exist");
  const sect = css.slice(i);
  assert.match(sect, /\.dash-quick\s*\{/, ".dash-quick row css must exist");
  assert.match(sect, /\.dash-quick-ic\s*\{/, ".dash-quick-ic circle css must exist");
  assert.match(sect, /\.dash-today--brand\s*\{/, "brand hero css must exist");
  assert.match(sect, /\[data-theme="dark"\] \.dash-today--brand/, "brand hero must have a dark variant");

  const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
  assert.match(dash, /const QUICK_ACTIONS = \[/, "QUICK_ACTIONS list must exist");
  const qaStart = dash.indexOf("const QUICK_ACTIONS");
  const qaEnd = dash.indexOf("function _quickActions");
  assert.ok(qaStart > -1 && qaEnd > qaStart, "_quickActions must follow QUICK_ACTIONS");
  const qaBlock = dash.slice(qaStart, qaEnd);
  for (const r of ["pos", "service_jobs", "quotations", "customers", "products", "income_overview"]) {
    assert.ok(qaBlock.includes(`go: "${r}"`), `quick action route "${r}" must exist`);
  }
  assert.match(dash, /dash-quick-btn dash-clickable/,
    "quick buttons must reuse the dash-clickable[data-go] nav binding (no new handlers)");
  assert.match(dash, /class="dash-today dash-today--brand"/, "hero must carry the brand modifier");
});

// ── Phase 423: mock-F finishing pass (merged todo card + channel donut + tiles) ──
test("PHASE 423: merged todo card, channel donut (honest caption), kpi tiles", () => {
  const i = css.indexOf("PHASE 423");
  assert.ok(i > -1, "PHASE 423 css section must exist");
  const sect = css.slice(i);
  for (const cl of [".dash-todo-row", ".dash-todo-ic", ".dash-chan-wrap", ".kpi-tile"]) {
    assert.ok(sect.includes(cl), `${cl} css must exist in the 423 block`);
  }

  const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
  assert.ok(dash.includes("ต้องทำวันนี้"), "merged todo card must exist");
  assert.ok(!dash.includes("ที่ต้องดู ${"), "old split alert card title markup must be gone (merged; comments may still mention it)");
  assert.ok(dash.includes("ยอดขายแยกตามช่องทาง"), "sales-by-channel donut must exist");
  assert.ok(dash.includes("จากบิลที่โหลดล่าสุด"), "channel donut must carry the honest cap caption (Phase 396 lesson)");
  assert.match(dash, /dash-today-status ok/, "hero status chip is static ok (low-stock warning moved into todo card)");
  for (const r of ["service_jobs", "products", "quotations", "credit_tracker", "recurring_expenses"]) {
    assert.ok(dash.includes(`go: "${r}"`) || dash.includes(`data-go="${r}"`), `todo row route "${r}" must be preserved`);
  }
});

// ── Phase 424: workspace wash (deeper bg + light-theme page gradient) ────────
test("PHASE 424: page wash gradient exists, dark theme stays flat", () => {
  const i = css.indexOf("PHASE 424");
  assert.ok(i > -1, "PHASE 424 css section must exist");
  const sect = css.slice(i);
  assert.match(sect, /body\s*\{[^}]*linear-gradient\(160deg/, "light body must carry the soft wash gradient");
  assert.match(sect, /\[data-theme="dark"\] body \{ background: var\(--bg\); \}/, "dark body must stay flat token bg");
});

// ── Phase 425: sidebar reorganization (markup-only, all routes preserved) ────
test("PHASE 425: sidebar groups hold the previously loose nav buttons", () => {
  const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
  // new groups exist
  for (const g of ['data-group="customers_crm"', 'data-group="air_shop"', 'data-group="tools"']) {
    assert.ok(indexHtml.includes(g), `${g} must exist`);
  }
  // moved buttons are now subs (route values unchanged)
  for (const r of ["quote_templates", "serials", "warranty_report", "service_request",
    "stock_movements", "stock_in_wizard", "stock_count", "stock_value", "dead_stock",
    "customers", "birthdays", "loyalty", "customer_dashboard", "ai_sales", "ac_shop",
    "btu_calculator", "error_codes", "error_codes_fridge", "error_codes_washer"]) {
    assert.match(indexHtml, new RegExp(`<button class="nav-btn sub" data-route="${r}"`),
      `route "${r}" must be a grouped sub item`);
  }
  // daily items stay loose on top
  for (const r of ["dashboard", "team_center", "pos", "tasks", "calendar", "settings"]) {
    assert.match(indexHtml, new RegExp(`<button class="nav-btn( active)?" data-route="${r}"`),
      `route "${r}" must stay a top-level button`);
  }
  // no route lost in the reshuffle: every old data-route still present exactly once
  const occurrences = (indexHtml.match(/data-route="loyalty"/g) || []).length;
  assert.equal(occurrences, 1, "loyalty must appear exactly once (moved, not duplicated)");
});

// ── Phase 426: shortcuts trimmed + skin sky sweep (semantic colors kept) ─────
test("PHASE 426: sidebar shortcuts removed, skin classes no longer sky", () => {
  const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
  for (const id of ["quickAddProduct", "quickAddCustomer", "quickAddQuotation", "quickAddServiceJob", "quickOpenReceipt"]) {
    assert.ok(!indexHtml.includes(`id="${id}"`), `shortcut button #${id} must be removed from the sidebar`);
  }
  // skin surfaces must be indigo now (sky gradients gone from these classes)
  const grab = (sel) => {
    const i = css.indexOf(sel);
    assert.ok(i > -1, `${sel} must exist`);
    return css.slice(i, css.indexOf("}", i));
  };
  for (const sel of [".auth-logo {", ".brand-badge {", ".pos-banner {", ".set-save-btn {"]) {
    const block = grab(sel);
    assert.ok(!/#5b5bd6|#8a8af2|#6b6be0/.test(block), `${sel} must not carry the indigo gradient (Phase 431: hue is sky)`);
  }
  // semantic doc-type colors are intentionally preserved (printed documents)
  assert.match(css, /\.doc-page-badge\.inv \{ background: #0284c7; \}/,
    "invoice doc-type colour must stay (document identity, not skin)");
});

// ── Phase 427: help-tutor FAB removed + customer_dashboard sweep ─────────────
test("PHASE 427: help FAB unwired, customer_dashboard carries no sky accents", () => {
  const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
  assert.ok(!/mountHelpButton\(\)/.test(mainJs), "help tutor FAB must not be mounted");
  assert.ok(!/setHelpContext\(/.test(mainJs), "help tutor context updates must be unwired");
  assert.ok(!/from "\.\/modules\/help_tutor\.js"/.test(mainJs), "help_tutor must not be imported (dormant)");
  // service-flow AI FAB gating must remain untouched (different AI system)
  const widget = fs.readFileSync(path.resolve("ai-chat-widget.js"), "utf8");
  assert.match(widget, /body\[data-route="solar"\] #bs-ai-fab:not\(\.hidden\)/, "service AI FAB gating must stay");

  const cust = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");
  assert.ok(!/#5b5bd6|#8a8af2|#6b6be0|#4949b8/.test(cust), "customer_dashboard must carry no indigo accents (Phase 431: hue is sky)");
});

// ── phase4 design-system stays in sync ───────────────────────────────────────
test("phase4 design-system primary scale is the sky blue ramp (Phase 431)", () => {
  assert.match(p4, /--primary-500:\s*#0ea5e9/, "--primary-500 must be #0ea5e9");
  assert.match(p4, /--primary-600:\s*#0284c7/, "--primary-600 must be #0284c7");
  assert.ok(!/--primary-500:\s*#6b6be0/.test(p4), "indigo --primary-500 must be gone");
  assert.ok(!/--primary-600:\s*#5b5bd6/.test(p4), "indigo --primary-600 must be gone");
  assert.ok(!/rgba\(91,\s*91,\s*214/.test(p4c), "phase4 focus ring must not be indigo");
});
