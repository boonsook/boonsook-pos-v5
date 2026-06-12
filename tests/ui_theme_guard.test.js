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
test("style.css :root carries the Phase 421 light tokens (lavender bg + indigo pair)", () => {
  // Phase 424: --bg deepened (#f5f5fb -> #eaedf8) per owner feedback (too bright)
  assert.match(css, /--bg:\s*#eaedf8/, "--bg must be #eaedf8");
  assert.match(css, /--line:\s*#e9e9f2/, "--line must be #e9e9f2");
  assert.match(css, /--primary:\s*#6b6be0/, "--primary must be #6b6be0");
  assert.match(css, /--primary2:\s*#5b5bd6/, "--primary2 must be #5b5bd6");
});

// ── dark tokens ───────────────────────────────────────────────────────────────
test("style.css dark theme uses the indigo pair (legacy sky values gone)", () => {
  assert.match(css, /--primary:\s*#8a8af2/, "dark --primary must be #8a8af2");
  assert.match(css, /--primary2:\s*#6b6be0/, "dark --primary2 must be #6b6be0");
  assert.ok(!/--primary2:\s*#0284c7/.test(css), "legacy sky --primary2 must be gone");
  assert.ok(!/--primary2:\s*#0ea5e9/.test(css), "legacy sky dark --primary2 must be gone");
  assert.ok(!/--primary:\s*#0ea5e9/.test(css), "legacy sky --primary must be gone");
  assert.ok(!/--primary:\s*#38bdf8/.test(css), "legacy sky dark --primary must be gone");
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
  assert.ok(!/rgba\(14,\s*165,\s*233/.test(sect),
    "no legacy sky rgba inside the PHASE 421 block");
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

// ── phase4 design-system stays in sync ───────────────────────────────────────
test("phase4 design-system primary scale is remapped to indigo", () => {
  assert.match(p4, /--primary-500:\s*#6b6be0/, "--primary-500 must be #6b6be0");
  assert.match(p4, /--primary-600:\s*#5b5bd6/, "--primary-600 must be #5b5bd6");
  assert.ok(!/--primary-500:\s*#0ea5e9/.test(p4), "legacy sky --primary-500 must be gone");
  assert.ok(!/--primary-600:\s*#0284c7/.test(p4), "legacy sky --primary-600 must be gone");
  assert.ok(!/rgba\(14,\s*165,\s*233/.test(p4c), "phase4 focus ring must not be sky");
});
