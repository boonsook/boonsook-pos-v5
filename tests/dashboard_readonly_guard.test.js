// Phase 386 — professional-saas-dashboard-shell-polish (build 386)
// Run: node --test tests/dashboard_readonly_guard.test.js
//
// Why this exists:
//   "ภาพรวมบริษัท" (modules/dashboard.js) is the company overview surface.
//   Phase 386 is a VISUAL-ONLY shell polish (style.css). dashboard.js was
//   intentionally NOT touched, so it must stay strictly read-only: it renders
//   from ctx.state and never fetches or mutates money/stock/accounting/service.
//   These guards lock that invariant and verify the build bump is consistent
//   across index.html + sw.js so the PWA does not serve a stale shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dash = fs.readFileSync(path.resolve("modules/dashboard.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
const sw = fs.readFileSync(path.resolve("sw.js"), "utf8");
const css = fs.readFileSync(path.resolve("style.css"), "utf8");

// ── read-only: no network mutation ───────────────────────────────────────────
test("dashboard.js performs no network mutation (fetch / xhr / supabase writes)", () => {
  assert.ok(!/\bfetch\s*\(/.test(dash), "must not call fetch()");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete/.test(dash), "must not call xhr mutation helpers");
  assert.ok(!/XMLHttpRequest/.test(dash), "must not use XMLHttpRequest");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(dash), "must not call supabase insert/update/delete/upsert");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'", '"PUT"', "'PUT'"]) {
    assert.ok(!dash.includes(verb), `must not reference HTTP write method ${verb}`);
  }
});

// ── read-only: no state mutation ──────────────────────────────────────────────
test("dashboard.js does not mutate ctx.state (no assignment / in-place array mutation)", () => {
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(dash), "must not assign into state.*");
  assert.ok(!/ctx\.state\.\w+\s*=[^=]/.test(dash), "must not assign into ctx.state.*");
  assert.ok(!/(?:ctx\.)?state\.\w+\.(push|splice|pop|shift|unshift|sort|reverse)\(/.test(dash),
    "must not mutate state-owned arrays in place");
});

// ── does not reach into money/stock/accounting/service workflow ───────────────
test("dashboard.js does not touch POS / stock / accounting / service mutation helpers", () => {
  for (const bad of ["checkout", "addToCart", "decrementStock", "autoPost", "postJournal", "loadAllData("]) {
    assert.ok(!dash.includes(bad), `read-only dashboard must not reference "${bad}"`);
  }
});

// ── Phase 386 is visual-only: the polish lives in style.css, not in the JS ─────
test("style.css carries the Phase 386 polish section", () => {
  assert.match(css, /PHASE 386 — SaaS dashboard shell polish/, "appended polish section must exist");
  // subtle SaaS shadow token (not the old heavy 0 10px 30px blur)
  assert.match(css, /--shadow:\s*0 1px 3px rgba\(15,23,42,\.08\)/, "light --shadow must be the subtle token");
  assert.ok(!/--shadow:\s*0 10px 30px rgba\(15,23,42,\.08\)/.test(css), "old heavy light-mode --shadow must be gone");
});

// ── build bump is consistent so the PWA shell is not served stale ─────────────
test("build markers stay synchronized across index.html + sw.js", () => {
  const appBuild = indexHtml.match(/data-app-build="(\d+)"/)?.[1];
  assert.ok(appBuild, "index.html must declare a numeric data-app-build");
  for (const asset of ["style.css", "selfheal.js", "main.js", "boot.js"]) {
    assert.ok(indexHtml.includes(`${asset}?v=${appBuild}`), `${asset}?v= must match data-app-build ${appBuild}`);
  }
  assert.equal(sw.match(/^const CACHE_NAME = 'boonsook-pos-v5-cache-v(\d+)';$/m)?.[1], appBuild,
    "sw.js CACHE_NAME must match data-app-build");
  assert.equal(sw.match(/^const SW_BUILD = '(\d+)';$/m)?.[1], appBuild,
    "sw.js SW_BUILD must match data-app-build");
});
