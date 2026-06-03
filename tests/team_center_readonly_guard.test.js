// Phase team-center-readonly (357) + team-center-ui-polish-readonly (358)
// Run: node --test tests/team_center_readonly_guard.test.js
//
// Why this exists:
//   "ศูนย์ทีม AI" (modules/team_command_center.js) is an OWNER-ONLY, READ-ONLY dashboard.
//   Build 358 reshaped it from a game/avatar board into work cards, but the read-only +
//   no-live-integration invariants must hold. These guards lock:
//     - no network mutation (fetch/xhr POST/PATCH/DELETE/PUT, supabase insert/update/delete/upsert)
//     - no state mutation (no assignment / in-place mutation of ctx.state arrays)
//     - never touches POS/stock/accounting/service workflow helpers
//     - missing state fields render "—"/"ยังไม่มีข้อมูล", NOT a misleading hardcoded 0
//     - integrations are labelled "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" (not faked as connected)
//     - AI assistants are framed as "ตัวอย่าง" concept, not real working agents
//     - draft/notes panel is local-only (copy/navigate buttons only)
//     - the route is admin-only (not in the sales role page list)
//     - layout is overflow-safe (responsive grids, no viewport-width / huge fixed widths)

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
test("does not mutate ctx.state (no assignment / in-place mutation of state arrays)", () => {
  assert.ok(!/\bstate\.\w+\s*=[^=]/.test(src), "must not assign into state.*");
  assert.ok(!/ctx\.state\.\w+\s*=[^=]/.test(src), "must not assign into ctx.state.*");
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
  assert.ok(!/team-card-num">0</.test(src), "must not hardcode a literal 0 card value");
  assert.match(src, /ยังไม่มีข้อมูล/, "NA label must exist for absent data");
  // cards must be driven by null-able numbers (field present => count, absent => null => NA)
  assert.match(src, /num:\s*\w+\s*\?\s*\w+\.length\s*:\s*null/, "card numbers come from real arrays or null");
});

// ── integrations are honestly labelled not-connected ──────────────────────────
test("integrations are placeholders labelled ยังไม่เชื่อมต่อ · รอ owner อนุมัติ", () => {
  assert.match(src, /ยังไม่เชื่อมต่อ · รอ owner อนุมัติ/, "must show waiting-for-owner placeholder status");
  assert.match(src, /ยังไม่มี integration จริง/, "must state there is no real integration");
  // none of these misleading 'looks-connected' tokens may appear
  for (const bad of [">Connected<", "<small>Connected", "Owner verified", "Secrets", "Production Release", "Locked", "Live Map", "OAuth token", "webhook"]) {
    assert.ok(!src.includes(bad), `must not show misleading/real-integration token "${bad}"`);
  }
});

// ── AI assistants are framed as a concept, not live working agents ────────────
test("AI assistants are labelled as example roles (concept), not live agents", () => {
  assert.match(src, /ตัวอย่างบทบาททีม/, "assistants must be framed as example roles");
  assert.match(src, /ยังไม่ใช่ agent ที่ทำงานจริง/, "must clarify assistants are not real/working");
  // game-board / avatar artefacts from the old mock are gone
  for (const gone of ["team-avatar", "team-room", "team-desk", "team-map", "team-dot", "team-bubble"]) {
    assert.ok(!src.includes(gone), `de-gamified UI must not contain "${gone}"`);
  }
});

// ── draft/notes + action buttons are copy/navigate only (no real dispatch) ────
test("draft panel + quick buttons are copy-to-clipboard or navigation only", () => {
  assert.match(src, /data-team-copy/, "copy buttons present");
  assert.match(src, /data-team-nav/, "nav buttons present");
  assert.match(src, /navigator\.clipboard\.writeText/, "copy uses clipboard");
  assert.match(src, /ctx\?\.showRoute\?\.\(route\)/, "nav uses ctx.showRoute");
  assert.match(src, /บันทึก draft ในหน้านี้เท่านั้น/, "draft must be stated as local-only");
  // draft handler only appends to the DOM log, never persists/sends
  assert.match(src, /insertAdjacentHTML\("beforeend"/, "draft is appended to local DOM log only");
});

// ── route is admin-only (wired but NOT in sales/customer role list) ───────────
test("team_center route is admin-only (not granted to the sales role)", () => {
  const salesLine = mainJs.split("\n").find(l => /^\s*sales:\s*\[/.test(l)) || "";
  assert.ok(salesLine.length > 0, "sales role line should exist");
  assert.ok(!salesLine.includes("team_center"), "sales role must NOT include team_center");
  const customerLine = mainJs.split("\n").find(l => /^\s*customer:\s*\[/.test(l)) || "";
  assert.ok(!customerLine.includes("team_center"), "customer role must NOT include team_center");
  assert.match(mainJs, /team_center:\s*\["\.\/modules\/team_command_center\.js",\s*"renderTeamCommandCenter"\]/, "lazy route must be wired");
});

// ── layout is overflow-safe (responsive, no viewport-width blowout) ───────────
test("layout source has no obvious horizontal-overflow hazards", () => {
  // responsive grids (auto-fill/auto-fit + minmax) instead of fixed wide columns
  assert.match(src, /minmax\(/, "grids must use minmax for responsiveness");
  assert.match(src, /repeat\(auto-(fill|fit)/, "card grids must auto-fill/auto-fit");
  // container clips + caps width; children allowed to shrink
  assert.match(src, /\.team-center\{[^}]*overflow:hidden/, "container must clip overflow");
  assert.match(src, /max-width:100%/, "container must cap width at 100%");
  assert.match(src, /min-width:0/, "flex/grid children must be allowed to shrink (min-width:0)");
  assert.match(src, /word-break:break-word/, "long values must wrap, not overflow");
  // no viewport-width units and no huge fixed pixel widths that ignore the container
  assert.ok(!/\d+vw/.test(src), "must not use vw widths (scrollbar overflow risk)");
  assert.ok(!/width:\s*\d{4,}px/.test(src), "must not use 4-digit fixed pixel widths");
  // mobile breakpoint exists
  assert.match(src, /@media \(max-width:640px\)/, "must have a mobile breakpoint");
});
