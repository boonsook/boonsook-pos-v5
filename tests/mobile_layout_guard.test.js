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

// ── Sales-doc pages (ใบเสนอราคา/ใบส่ง/ใบเสร็จ) mobile layout cleanup ──────────
test("sales-doc status tabs wrap into chips on mobile (no overlapping text)", () => {
  // shared selectors for the three tab rows must wrap + drop the underline on mobile
  assert.match(css, /\.qt-tabs,\s*\.di-tabs,\s*\.rc-tabs\s*\{[^}]*flex-wrap:\s*wrap\s*!important/s);
  assert.match(css, /\.qt-tab-btn,\s*\.di-tab-btn,\s*\.rc-tab-btn\s*\{[^}]*border-radius:\s*999px\s*!important/s);
  // buttons must not shrink (the root cause of the text overlap)
  assert.match(css, /\.qt-tab-btn,\s*\.di-tab-btn,\s*\.rc-tab-btn\s*\{[^}]*flex:\s*0 0 auto/s);
});

test("all three sales-doc list tables use the shared .table-wrap (horizontal scroll, no clipping)", () => {
  for (const file of ["modules/quotations.js", "modules/delivery_invoices.js", "modules/receipts.js"]) {
    const src = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(src, /<div class="table-wrap"[^>]*>\s*<table class="doc-list-table">/,
      `${file} must wrap doc-list-table in .table-wrap`);
    assert.ok(!/<div style="overflow-x:auto;margin-top:12px">\s*<table class="doc-list-table">/.test(src),
      `${file} must no longer use the bare inline overflow wrapper`);
  }
});

test("floating help FAB (#bs-help-fab) is hidden on the sales-doc routes on mobile (not the AI FAB)", () => {
  const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
  const hasHide = m.some(block =>
    /body\[data-route="quotations"\] #bs-help-fab/.test(block) &&
    /body\[data-route="delivery_invoices"\] #bs-help-fab/.test(block) &&
    /body\[data-route="receipts"\] #bs-help-fab/.test(block) &&
    /#bs-help-fab\s*\{\s*display:\s*none\s*!important/.test(block));
  assert.ok(hasHide, "a mobile @media block must hide #bs-help-fab on quotations/delivery_invoices/receipts");
  // must target the help FAB, NOT the AI assistant FAB
  assert.ok(!/body\[data-route="quotations"\] #bs-ai-fab/.test(css), "must not touch the AI FAB (#bs-ai-fab)");
});

// ── Inventory (สินค้า/คลัง) mobile polish — summary cards / filter wrap / card relayout / help-FAB ──
test("inventory summary cards are rendered (derived from existing counts, no new query)", () => {
  const prod = fs.readFileSync(path.resolve("modules/products.js"), "utf8");
  assert.match(prod, /<div class="prod-summary">/, "products.js must render the summary card row");
  // the four scannable counts come from already-computed variables
  for (const v of ["countTypeAll", "countInstock", "countLow", "countOut"]) {
    assert.match(prod, new RegExp(`prod-sum-num">\\$\\{${v}\\}`), `summary must use existing count ${v}`);
  }
  // status colors match the existing design (green/orange/red)
  assert.match(css, /\.prod-sum-green\s+\.prod-sum-num\s*\{\s*color:\s*#16a34a/);
  assert.match(css, /\.prod-sum-orange\s+\.prod-sum-num\s*\{\s*color:\s*#d97706/);
  assert.match(css, /\.prod-sum-red\s+\.prod-sum-num\s*\{\s*color:\s*#dc2626/);
});

test("inventory mobile: filter/type tabs wrap (no hidden h-scroll) and card actions get their own row", () => {
  const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
  const block = m.find(b => /\.prod-filter-tabs,\s*\.prod-type-tabs\s*\{[^}]*flex-wrap:\s*wrap\s*!important/s.test(b));
  assert.ok(block, "a mobile block must wrap .prod-filter-tabs/.prod-type-tabs");
  assert.match(block, /\.prod-list-actions\s*\{[^}]*flex-basis:\s*100%\s*!important/s,
    "card action buttons must drop to their own full-width row on mobile");
});

test("inventory mobile: floating help FAB hidden on products + warehouse routes (not the AI FAB)", () => {
  const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
  const hasHide = m.some(block =>
    /body\[data-route="products"\] #bs-help-fab/.test(block) &&
    /body\[data-route="wh_kunkhao"\] #bs-help-fab/.test(block) &&
    /body\[data-route="wh_kundaeng"\] #bs-help-fab/.test(block) &&
    /body\[data-route="wh_sikhon"\] #bs-help-fab/.test(block));
  assert.ok(hasHide, "must hide #bs-help-fab on products/wh_* routes on mobile");
  assert.ok(!/body\[data-route="products"\] #bs-ai-fab/.test(css), "must not touch the AI FAB on inventory");
});

// ── Inventory action-menu + category-collapse (build 343) ─────────────────────
// Buttons were RELOCATED into <details> menus to declutter mobile. The contract:
// every original id / data-action hook must still exist (wiring is by id/attr, so
// moving markup must not drop handlers) — these guards lock that invariant.
const prodJs = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

test("header secondary buttons live inside the 'จัดการเพิ่มเติม' <details> menu; primary stay out", () => {
  // the menu container exists
  assert.match(prodJs, /<details class="prod-more-menu">/, "header must use a <details class=prod-more-menu> menu");
  const menu = prodJs.slice(prodJs.indexOf('<details class="prod-more-menu">'), prodJs.indexOf("</details>", prodJs.indexOf('class="prod-more-menu"')));
  // every secondary button id moved INTO the menu (handlers bind by id → must persist)
  for (const id of ["prodExportBtn", "prodGenAllBarcodesBtn", "prodPrintBarcodesBtn", "prodManageCatBtn", "prodMergeCatBtn", "prodBulkModeBtn", "prodDeleteAllBtn"]) {
    assert.match(menu, new RegExp(`id="${id}"`), `#${id} must live inside the จัดการเพิ่มเติม menu`);
  }
  // primary actions stay visible (NOT inside the menu)
  assert.ok(!new RegExp(`prod-more-panel[\\s\\S]*id="prodAddBtn"`).test(prodJs), "+ เพิ่มสินค้า must stay a visible primary button");
});

test("'ลบทั้งหมด' is the LAST menu item and carries danger styling + keeps its confirm handler", () => {
  const menu = prodJs.slice(prodJs.indexOf('<details class="prod-more-menu">'), prodJs.indexOf("</details>", prodJs.indexOf('class="prod-more-menu"')));
  // danger class + it is the final id in the panel
  assert.match(menu, /id="prodDeleteAllBtn"[^>]*class="[^"]*prod-more-danger|class="[^"]*prod-more-danger[^"]*"[^>]*id="prodDeleteAllBtn"/);
  const lastId = [...menu.matchAll(/id="(prod[A-Za-z]+Btn)"/g)].map(x => x[1]).pop();
  assert.equal(lastId, "prodDeleteAllBtn", "ลบทั้งหมด must be the last button in the menu");
  // danger color + a separator above it (กันกดพลาด)
  assert.match(css, /\.prod-more-danger\s*\{[^}]*color:\s*#dc2626[^}]*border-top:\s*1px solid/s);
  // handler unchanged: still wired to deleteAllProducts (which holds the confirm)
  assert.match(prodJs, /#prodDeleteAllBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*deleteAllProducts\(ctx\)\)/);
});

test("product card keeps '+ บิล' as a visible quick action; the rest move into a per-card '⋯' menu", () => {
  // quick "+ บิล" button stays out of the menu, still data-prod-add
  assert.match(prodJs, /data-prod-add="\$\{p\.id\}">\+ บิล<\/button>/);
  // the per-card menu exists and holds the secondary data-actions (delegation binds by attr → must persist)
  assert.match(prodJs, /<details class="prod-card-menu">/);
  assert.match(prodJs, /class="prod-cardmenu-item"\s+data-prod-edit="\$\{p\.id\}"/);
  assert.match(prodJs, /data-prod-stockin="\$\{p\.id\}"/);
  assert.match(prodJs, /data-qr-prod="\$\{p\.id\}"/);
  assert.match(prodJs, /data-prod-print="\$\{p\.id\}"/);
  assert.match(prodJs, /class="prod-cardmenu-item prod-cardmenu-danger"\s+data-prod-del="\$\{p\.id\}"/);
});

test("menus open one-at-a-time (accordion) and are inline-flow so .prod-list/.panel overflow can't clip them", () => {
  // accordion wiring: opening one closes the others
  assert.match(prodJs, /details\.prod-more-menu\[open\],\s*details\.prod-card-menu\[open\]/);
  // per-card panel is inline-flow (NOT position:absolute) — robust against overflow:hidden clipping
  assert.match(css, /\.prod-cardmenu-panel\s*\{[^}]*margin-top:\s*6px/s);
  assert.ok(!/\.prod-cardmenu-panel\s*\{[^}]*position:\s*absolute/s.test(css), "card menu panel must not be absolutely positioned (would be clipped)");
  // header dropdown drops to inline-flow on mobile (where .panel gets overflow-x:auto)
  const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
  assert.ok(m.some(b => /\.prod-more-panel\s*\{[^}]*position:\s*static/s.test(b)), "header panel must be static (inline) on mobile to avoid the .panel clip");
});

test("category collapse: only ~10 chips show on mobile, extras hide behind '+ หมวดทั้งหมด' (selected always visible)", () => {
  // chips beyond the cap get .prod-cat-extra ; selected chip gets .is-active
  assert.match(prodJs, /i >= CAT_CAP \? ' prod-cat-extra' : ''/);
  assert.match(prodJs, /currentCategory===cat\?' is-active':''/);
  // toggle button + has-extra flag
  assert.match(prodJs, /id="prodCatToggleBtn"/);
  assert.match(prodJs, /class="prod-category-bar\$\{hasExtra \? ' has-extra' : ''\}/);
  // toggle is class-only (no re-render → keeps scroll/state)
  assert.match(prodJs, /#prodCatToggleBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*el\.querySelector\("\.prod-category-bar"\)\?\.classList\.toggle\("cat-expanded"\)/);
  // mobile CSS: hide extras unless expanded, but keep the active one visible
  const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
  assert.ok(m.some(b => /\.prod-category-bar\.has-extra:not\(\.cat-expanded\)\s*\.prod-cat-extra:not\(\.is-active\)\s*\{\s*display:\s*none/.test(b)),
    "collapsed mobile category bar must hide .prod-cat-extra except the .is-active selected chip");
});

test("'ล้างตัวกรองทั้งหมด' button appears when any filter is active and resets all filter state", () => {
  assert.match(prodJs, /id="prodClearAllFilters"/);
  // shown only when something is filtered
  assert.match(prodJs, /const anyFilter = currentCategory !== 'all' \|\| currentFilter !== 'all' \|\| !!quickFilter \|\| currentTagFilter !== null \|\| !!searchQuery/);
  // handler resets every filter dimension
  const h = prodJs.slice(prodJs.indexOf('#prodClearAllFilters"'), prodJs.indexOf('#prodClearAllFilters"') + 320);
  for (const reset of [/currentCategory = "all"/, /currentFilter = "all"/, /quickFilter = ""/, /currentTagFilter = null/, /searchQuery = ""/]) {
    assert.match(h, reset);
  }
});
