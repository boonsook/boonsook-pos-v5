// Phase team-center-readonly — guard that ศูนย์ทีม AI stays read-only
// Run: node --test tests/team_center_readonly_guard.test.js
//
// Why this exists:
//   "ศูนย์ทีม AI" (modules/team_command_center.js) is an OWNER-ONLY, READ-ONLY overview.
//   It may render numbers from ctx.state but must never write anything. These guards lock:
//     - no network mutation (fetch/xhr POST/PATCH/DELETE/PUT, supabase insert/update/delete/upsert)
//     - no state mutation (no assignment back into ctx.state / state.x = ...)
//     - never touches POS/stock/accounting/service workflow helpers
//     - missing state fields render "—"/"ยังไม่มีข้อมูล", NOT a misleading hardcoded 0
//     - integrations are labelled "ยังไม่เชื่อมต่อ" (not faked as Connected)
//     - the route is admin-only (not in the sales role page list)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/team_command_center.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");

// ── read-only: no network mutation ───────────────────────────────────────────
test("does not perform any network mutation (fetch / xhr / supabase writes)", () => {
  assert.ok(!/\bfetch\s*\(/.test(src), "must not call fetch()");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete/.test(src), "must not call xhr mutation helpers");
  assert.ok(!/XMLHttpRequest/.test(src), "must not use XMLHttpRequest");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(src), "must not call supabase insert/update/delete/upsert");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'", '"PUT"', "'PUT'"]) {
    assert.ok(!src.includes(verb), `must not reference HTTP write method ${verb}`);
  }
});

// ── read-only: no state mutation ──────────────────────────────────────────────
test("does not mutate ctx.state (no assignment into state.* or ctx.state.*)", () => {
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(src), "must not assign into state.*");
  assert.ok(!/ctx\.state\.\w+\s*=[^=]/.test(src), "must not assign into ctx.state.*");
  // mutating a state-owned array in place is also a write — local arrays are fine
  assert.ok(!/(?:ctx\.)?state\.\w+\.(push|splice|pop|shift|unshift|sort|reverse)\(/.test(src), "must not mutate state-owned arrays in place");
});

// ── does not reach into money/stock/accounting workflow ───────────────────────
test("does not touch POS / stock / accounting / service mutation helpers", () => {
  for (const bad of ["checkout", "addToCart", "decrementStock", "autoPost", "postJournal", "loadAllData("]) {
    assert.ok(!src.includes(bad), `read-only page must not reference "${bad}"`);
  }
});

// ── missing fields => "—"/"ยังไม่มีข้อมูล", never a misleading hardcoded 0 ─────
test("uses dash/NA fallback for missing state fields (no misleading hardcoded 0)", () => {
  assert.match(src, /countOrDash/, "should have a count-or-dash helper");
  assert.match(src, /Array\.isArray\(arr\)\s*\?\s*String\(arr\.length\)\s*:\s*"—"/, "missing array => — not 0");
  assert.ok(!/<strong>0<\/strong>/.test(src), "must not hardcode <strong>0</strong> in stat cards");
  assert.match(src, /ยังไม่มีข้อมูล/, "NA label must exist for absent data");
});

// ── integrations are honestly labelled not-connected ──────────────────────────
test("integration tabs are labelled ยังไม่เชื่อมต่อ, not faked as connected", () => {
  assert.match(src, /ยังไม่เชื่อมต่อ/);
  assert.match(src, /รอ owner อนุมัติ/, "must say waiting for owner approval");
  // none of these misleading 'looks-connected' tokens may appear in rendered UI
  for (const bad of [">Connected<", "<small>Connected", "Owner verified", "Secrets", "Production Release", "Locked", "Live Map"]) {
    assert.ok(!src.includes(bad), `must not show misleading token "${bad}"`);
  }
});

// ── agent map is framed as a concept, not live working agents ─────────────────
test("agent map is labelled as example roles (concept), not live agents", () => {
  assert.match(src, /ตัวอย่างบทบาททีม/, "map must be framed as example roles");
  assert.match(src, /ยังไม่ใช่ agent ที่ทำงานจริง/, "must clarify agents are not real/working");
  assert.ok(!/team-dot/.test(src.replace(/\.team-dot\{[^}]*\}/g, "")), "no online/live dot indicator on agent rooms");
});

// ── action buttons are copy/navigate only (no real command dispatch) ──────────
test("quick buttons are copy-to-clipboard or navigation only", () => {
  assert.match(src, /data-team-copy/, "copy buttons present");
  assert.match(src, /data-team-nav/, "nav buttons present");
  assert.match(src, /navigator\.clipboard\.writeText/, "copy uses clipboard");
  assert.match(src, /ctx\?\.showRoute\?\.\(route\)/, "nav uses ctx.showRoute");
});

// ── route is admin-only (wired but NOT in sales role list) ────────────────────
test("team_center route is admin-only (not granted to the sales role)", () => {
  const salesLine = mainJs.split("\n").find(l => /^\s*sales:\s*\[/.test(l)) || "";
  assert.ok(salesLine.length > 0, "sales role line should exist");
  assert.ok(!salesLine.includes("team_center"), "sales role must NOT include team_center");
  assert.match(mainJs, /team_center:\s*\["\.\/modules\/team_command_center\.js",\s*"renderTeamCommandCenter"\]/, "lazy route must be wired");
});
