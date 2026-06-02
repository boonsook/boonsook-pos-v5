// Phase mobile-layout — overlap fix regression guard (source-level)
// Run: node --test tests/mobile_layout_guard.test.js
//
// Why this exists:
//   Four mobile (390x844) overlap bugs were fixed with CSS + sidebar state wiring only
//   (no business/API/accounting/auth logic touched):
//     1. Expenses filter bar — label/input/buttons must not overlap (stack full-width on mobile)
//     2. Mobile sidebar — must sit ABOVE the bottom nav and carry a clear body/backdrop state
//     3. AI FAB — must clear the bottom nav and hide while the sidebar is open
//     4. Tables in a panel — must scroll horizontally, not get clipped
//   These are source-level assertions (the same guard style as the other *_guard tests):
//   the layout lives in CSS / DOM-bound handlers, so we assert the invariants stay in source.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve("style.css"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const fab = fs.readFileSync(path.resolve("ai-chat-widget.js"), "utf8");
const expenses = fs.readFileSync(path.resolve("modules/expenses.js"), "utf8");

// ── #2 sidebar above bottom nav + clear state ────────────────────────────────
test("sidebar mobile z-index (60) is above the bottom nav (40)", () => {
  // bottom nav is z-index 40 in the mobile block
  assert.match(css, /\.mobile-nav\s*\{[^}]*z-index:\s*40/s, "bottom nav must stay z-index 40");
  // sidebar gets a higher z-index in the mobile media block
  assert.match(css, /\.sidebar\s*\{[^}]*transform:\s*translateX\(-105%\)[^}]*z-index:\s*60/s,
    "mobile .sidebar must be z-index 60 (above the 40 bottom nav)");
});

test("opening the sidebar locks background scroll via body.sidebar-open", () => {
  assert.match(css, /body\.sidebar-open\s*\{[^}]*overflow:\s*hidden/s);
});

test("main.js exposes closeSidebar/toggleSidebar and wires the hamburger to toggle", () => {
  assert.match(mainJs, /function closeSidebar\s*\(/);
  assert.match(mainJs, /function toggleSidebar\s*\(/);
  assert.match(mainJs, /\$\("menuToggle"\)\?\.addEventListener\("click",\s*toggleSidebar\)/);
});

test("toggleSidebar sets the body state + shows the backdrop; closeSidebar clears them", () => {
  const open = mainJs.slice(mainJs.indexOf("function toggleSidebar"), mainJs.indexOf("function toggleSidebar") + 400);
  assert.match(open, /classList\.add\("open"\)/);
  assert.match(open, /classList\.add\("sidebar-open"\)/);
  assert.match(open, /backdrop"\)\?\.classList\.remove\("hidden"\)/, "opening must reveal the backdrop");
  const close = mainJs.slice(mainJs.indexOf("function closeSidebar"), mainJs.indexOf("function closeSidebar") + 400);
  assert.match(close, /classList\.remove\("open"\)/);
  assert.match(close, /classList\.remove\("sidebar-open"\)/);
});

test("backdrop click and route change both close the sidebar", () => {
  assert.match(mainJs, /\$\("backdrop"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*closeSidebar\(\);\s*closeAllDrawers\(\);\s*\}\)/);
  // showRoute path closes the sidebar (replaced the raw classList.remove)
  assert.match(mainJs, /setText\("pageTitle"[^\n]*\);\s*\n\s*closeSidebar\(\);/);
});

// ── #3 AI FAB clears bottom nav + hides with sidebar ─────────────────────────
test("AI FAB is raised above the bottom nav on mobile", () => {
  assert.match(fab, /@media\s*\(max-width:\s*768px\)\s*\{\s*#bs-ai-fab\s*\{[^}]*bottom:\s*calc\(72px/s);
});

test("AI FAB is hidden while the sidebar is open", () => {
  assert.match(fab, /body\.sidebar-open #bs-ai-fab/);
  assert.match(fab, /body:has\(#sidebar\.open\) #bs-ai-fab/);
});

// ── #1 expenses filter bar stacks on mobile (no overlap) ─────────────────────
test("expenses filter row carries the exp-filter-row hook and the mobile stack rule", () => {
  assert.match(expenses, /class="row exp-filter-row"/, "filter container must keep the exp-filter-row class");
  assert.match(css, /\.exp-filter-row\s*>\s*div\s*\{[^}]*flex:\s*1 1 100%\s*!important[^}]*min-width:\s*0\s*!important/s);
  assert.match(css, /\.exp-filter-row\s*>\s*\.btn\s*\{[^}]*flex:\s*1 1 calc\(50% - 8px\)/s);
});

// ── #4 tables scroll horizontally inside a panel ─────────────────────────────
test("table-wrap scrolls horizontally and is width-capped so it never clips/overflows", () => {
  assert.match(css, /\.table-wrap\s*\{\s*overflow-x:\s*auto/);
  assert.match(css, /\.table-wrap\s*\{\s*max-width:\s*100%/);
  // the expenses list table is wrapped
  assert.match(expenses, /<div class="table-wrap">\s*<table class="exp-table"/);
});
