// Phase mobile-layout — overlap fix regression guard (source-level)
// Run: node --test tests/mobile_layout_guard.test.js
//
// Why this exists:
//   Four mobile (390x844) overlap bugs were fixed with CSS + sidebar state wiring only
//   (no business/API/accounting/auth logic touched):
//     1. Expenses filter bar — label/input/buttons must not overlap (stack full-width on mobile)
//     2. Mobile sidebar — must sit ABOVE the bottom nav and carry a clear body/backdrop state
//     3. AI FAB — mobile uses inline buttons (no floating FAB); desktop FAB route-gated to service flow
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

// ── #3 AI FAB — mobile uses inline buttons; desktop FAB route-gated to service flow ──
test("mobile: floating FAB is fully hidden (inline buttons replace it)", () => {
  const m768 = fab.slice(fab.indexOf("@media (max-width: 768px)"), fab.indexOf("@media (max-width: 480px)"));
  assert.match(m768, /#bs-ai-fab\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/,
    "on mobile the floating FAB must be display:none !important (no overlay over inputs)");
});

test("desktop/tablet FAB is route-gated to the service flow only (not sales pages)", () => {
  // hidden by default for every route
  assert.match(fab, /#bs-ai-fab\s*\{[^}]*display:\s*none;[^}]*\}/s, "base FAB must default to display:none");
  // shown only on service flow, and :not(.hidden) so it disappears when the chat opens
  assert.match(fab, /body\[data-route="solar"\] #bs-ai-fab:not\(\.hidden\)/);
  assert.match(fab, /body\[data-route="ac_install"\] #bs-ai-fab:not\(\.hidden\)/);
  assert.match(fab, /body\[data-route\^="service_"\]:not\(\[data-route="service_jobs"\]\) #bs-ai-fab:not\(\.hidden\)\s*\{\s*display:\s*flex/);
  // sales pages keep their OWN AI — service FAB must NOT be allowlisted there
  assert.ok(!/body\[data-route="ai_sales"\] #bs-ai-fab:not\(\.hidden\)\s*\{\s*display:\s*flex/.test(fab),
    "ai_sales must not show the service FAB (it has its own sales AI)");
  assert.ok(!/body\[data-route="ac_shop"\] #bs-ai-fab:not\(\.hidden\)\s*\{\s*display:\s*flex/.test(fab),
    "ac_shop must not show the service FAB (it has its own ช่วยเลือก button)");
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

test("mobile .page has extra bottom padding so content clears the bottom nav", () => {
  // 768 block: >=150px ; 400 block: >=150px
  assert.match(css, /\.page\s*\{\s*padding:\s*12px 12px 160px/);
  assert.match(css, /\.page\s*\{\s*padding:\s*10px 10px 150px/);
});

// ── AI entry UX: route state on <body> + inline buttons on the form/customer pages ──
test("showRoute publishes the current route onto <body> for CSS to read", () => {
  // body.dataset.route is set right after state.currentRoute = route
  assert.match(mainJs, /state\.currentRoute\s*=\s*route;[\s\S]{0,200}?document\.body\.dataset\.route\s*=\s*route;/);
});

test("inline AI entry buttons exist and are wired to BoonsookAI.open on the right pages", () => {
  const read = (p) => fs.readFileSync(path.resolve(p), "utf8");
  const cases = [
    // [file, button-id, expected label substring (customer vs work-order copy)]
    ["modules/customer_dashboard.js", "custAiCta", "ช่วยแจ้งงาน"],
    ["modules/service_request.js",    "srAiBtn",   "ช่วยแจ้งงาน"],
    ["modules/service_form.js",       "svAiBtn",   "ช่วยกรอกใบงานนี้"],
    ["modules/ac_install.js",         "acAiBtn",   "ช่วยกรอกใบงานนี้"],
    ["modules/solar.js",              "solAiBtn",  "ช่วยกรอกใบงานนี้"],
  ];
  for (const [file, id, label] of cases) {
    const src = read(file);
    assert.match(src, new RegExp(`id="${id}"`), `${file} must render the inline AI button #${id}`);
    assert.match(src, new RegExp(label), `${file} #${id} must use the customer/work-order copy "${label}"`);
    // wiring: getElementById("id") or querySelector("#id"), then ?.addEventListener(click -> BoonsookAI.open)
    assert.match(src, new RegExp(`${id}"\\)\\?\\.addEventListener\\("click",\\s*\\(\\)\\s*=>\\s*window\\.BoonsookAI\\?\\.open\\(\\)\\)`),
      `${file} must wire #${id} to window.BoonsookAI?.open()`);
  }
});

test("customer-facing pages avoid the vague 'AI ช่วยกรอก' copy", () => {
  // customer_dashboard + service_request inline buttons use แจ้งงาน/ลงคิวงาน, not bare ช่วยกรอก
  const cd = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");
  const sr = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");
  assert.ok(!/custAiCta[\s\S]{0,300}AI ช่วยกรอก</.test(cd), "customer_dashboard CTA must not say bare 'AI ช่วยกรอก'");
  assert.ok(!/srAiBtn[\s\S]{0,300}AI ช่วยกรอก</.test(sr), "service_request button must not say bare 'AI ช่วยกรอก'");
});
