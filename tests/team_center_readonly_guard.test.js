// Phase 357 readonly · 358 ui-polish · 359 action-surface · 360 search-sort · 361 date-range+export
// Run: node --test tests/team_center_readonly_guard.test.js
//
// Why this exists:
//   "ศูนย์ทีม AI" (modules/team_command_center.js) is an OWNER-ONLY, READ-ONLY review surface.
//   Build 359 added filter / drill-down / prompt-generator, but everything must stay read-only.
//   These guards lock:
//     - no network mutation (fetch/xhr POST/PATCH/DELETE/PUT, supabase insert/update/delete/upsert)
//     - no state mutation (no assignment / in-place mutation of ctx.state arrays)
//     - never touches POS/stock/accounting/service workflow helpers
//     - missing state fields render "—"/"ยังไม่มีข้อมูล", NOT a misleading hardcoded 0
//     - integrations labelled "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" (not faked as connected)
//     - AI assistants framed as "ตัวอย่าง" concept, not real working agents
//     - filter/drill-down work in-memory from ctx.state; no extra fetch
//     - drill-down has NO save/approve/submit action — only copy-prompt / navigate / close
//     - prompt generator produces clipboard text only
//     - the route is admin-only (not in sales/customer role)
//     - layout is overflow-safe (responsive grids, wrapping filter, modal above bottom nav)

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
  assert.match(src, /num:\s*\w+\s*\?\s*\w+\.length\s*:\s*null/, "card numbers come from real arrays or null");
});

// ── integrations are honestly labelled not-connected ──────────────────────────
test("integrations are placeholders labelled ยังไม่เชื่อมต่อ · รอ owner อนุมัติ", () => {
  assert.match(src, /ยังไม่เชื่อมต่อ · รอ owner อนุมัติ/, "must show waiting-for-owner placeholder status");
  assert.match(src, /ยังไม่มี integration จริง/, "must state there is no real integration");
  for (const bad of [">Connected<", "<small>Connected", "Owner verified", "Secrets", "Production Release", "Locked", "Live Map", "OAuth token", "webhook"]) {
    assert.ok(!src.includes(bad), `must not show misleading/real-integration token "${bad}"`);
  }
});

// ── AI assistants are framed as a concept, not live working agents ────────────
test("AI assistants are labelled as example roles (concept), not live agents", () => {
  assert.match(src, /ตัวอย่างบทบาททีม/, "assistants must be framed as example roles");
  assert.match(src, /ยังไม่ใช่ agent ที่ทำงานจริง/, "must clarify assistants are not real/working");
  for (const gone of ["team-avatar", "team-room", "team-desk", "team-map", "team-dot", "team-bubble"]) {
    assert.ok(!src.includes(gone), `de-gamified UI must not contain "${gone}"`);
  }
});

// ── draft/notes + action buttons are copy/navigate only (no real dispatch) ────
test("draft panel + quick buttons are copy-to-clipboard or navigation only", () => {
  assert.match(src, /data-team-copy/, "copy buttons present");
  assert.match(src, /data-team-nav/, "nav buttons present");
  assert.match(src, /navigator\.clipboard\.writeText/, "copy uses clipboard");
  assert.match(src, /ctx\?\.showRoute\?\.\(/, "nav uses ctx.showRoute");
  assert.match(src, /บันทึก draft ในหน้านี้เท่านั้น/, "draft must be stated as local-only");
  assert.match(src, /insertAdjacentHTML\("beforeend"/, "draft is appended to local DOM log only");
});

// ── filter / segmented control works in-memory from ctx.state ─────────────────
test("filter control has the 6 categories and reads only from ctx.state", () => {
  for (const label of ["ทั้งหมด", "รออนุมัติ", "งานต้องดู", "งานแอร์", "ลูกค้า", "สินค้า"]) {
    assert.ok(src.includes(label), `filter must include "${label}"`);
  }
  assert.match(src, /data-filter=/, "filter chips must carry data-filter");
  // categories derive from field(state, ...) — no network call inside
  assert.match(src, /function categoryOf\(state,/, "categoryOf reads from state");
  assert.match(src, /field\(state,\s*"customers"\)/, "customers category from state");
  assert.match(src, /field\(state,\s*"products"\)/, "products category from state");
  assert.match(src, /ยังไม่มีรายการในหมวดนี้/, "empty state for a category with no rows");
});

// ── search filters in-memory from ctx.state (no fetch, no saved query) ────────
test("search works in-memory over ctx.state items only", () => {
  assert.match(src, /function searchItems\(/, "has an in-memory search");
  assert.match(src, /function itemSearchText\(/, "builds searchable text from item fields in memory");
  assert.match(src, /id="teamSearch"/, "renders a search input near the filter");
  assert.match(src, /ไม่พบรายการตามคำค้น/, "shows a no-results message");
  // search must not trigger any network call
  assert.ok(!/searchItems[\s\S]{0,300}(fetch|xhr|\.post|\.insert)/.test(src), "search must not fetch");
});

// ── sort is in-memory and clones the array (never mutates state) ──────────────
test("sort clones the array before sorting (no in-place mutation of state)", () => {
  assert.match(src, /function sortItems\(/, "has an in-memory sort");
  assert.match(src, /const arr = \[\.\.\.items\]/, "sort must clone via spread before .sort()");
  // the only .sort() calls operate on the cloned `arr`, never directly on a state array
  assert.ok(!/(?:ctx\.)?state\.\w+\.sort\(/.test(src), "must not sort a state array in place");
  assert.ok(!/\.items\.sort\(/.test(src), "must not sort category.items in place");
  for (const label of ["ล่าสุดก่อน", "เก่าสุดก่อน", "ยอดเงินมากก่อน", "สถานะ/ความสำคัญ"]) {
    assert.ok(src.includes(label), `sort option "${label}" must exist`);
  }
});

// ── date-range filter is in-memory over the existing date field ──────────────
test("date-range filter works in-memory from ctx.state created_at", () => {
  assert.match(src, /function dateInRange\(/, "has an in-memory date-range predicate");
  assert.match(src, /dateKeyBkk\(item\?\.created_at\)/, "date filter reads the existing created_at field");
  assert.match(src, /data-date-preset=/, "renders date preset controls");
  for (const label of ["วันนี้", "7 วัน", "30 วัน", "เดือนนี้", "ทั้งหมด"]) {
    assert.ok(src.includes(label), `date preset "${label}" must exist`);
  }
  // date filter must not fetch
  assert.ok(!/dateInRange[\s\S]{0,300}(fetch|xhr|\.post|\.insert)/.test(src), "date filter must not fetch");
});

// ── recent groups (read-only) on the overview ─────────────────────────────────
test("overview shows read-only recent groups for each category", () => {
  for (const g of ["งานล่าสุด", "เอกสารล่าสุด", "ลูกค้าล่าสุด", "สินค้าล่าสุด"]) {
    assert.ok(src.includes(g), `recent group "${g}" must exist`);
  }
});

// ── export is copy-to-clipboard markdown only (no file / upload / POST) ────────
test("export produces clipboard markdown only — no file/upload/server", () => {
  assert.match(src, /function buildListSummary\(/, "has a list markdown summary builder");
  assert.match(src, /function buildOverviewSummary\(/, "has an overview markdown summary builder");
  assert.match(src, /คัดลอกสรุป/, "export is a copy-summary action");
  // export must be wired to clipboard via data-team-copy, never a download/file/blob
  assert.ok(!/URL\.createObjectURL|createObjectURL|new Blob\(|download=|\.click\(\)/.test(src), "must not create/download a file");
  assert.ok(!/buildListSummary[\s\S]{0,300}(fetch|xhr|\.post|\.insert)/.test(src), "summary must not be uploaded");
});

// ── drill-down is read-only: no save/approve/submit/delete action, only copy/nav/close ─
test("drill-down detail panel has no real save/approve/submit/delete action", () => {
  // no write-action hooks
  assert.ok(!/data-(approve|submit|save|post|delete)\b/.test(src), "no write-action data hooks in drill-down");
  // no actionable button labelled approve/save/submit-to-server in Thai
  assert.ok(!/>\s*[^<]*อนุมัติ[^<]*<\/button>/.test(src), "must not have an อนุมัติ (approve) button");
  assert.ok(!/>\s*[^<]*บันทึกลง[^<]*<\/button>/.test(src), "must not have a save-to-DB button");
  // modal closes locally + only copy/nav actions
  assert.match(src, /data-modal-close/, "modal has a local close control");
  assert.match(src, /function detailHtml\(/, "has a read-only detail renderer");
  assert.match(src, /มุมมองอ่านอย่างเดียว — ไม่มีปุ่มบันทึก\/อนุมัติ\/ส่งจริง/, "modal states it is read-only");
});

// ── owner prompt generator produces clipboard text only ───────────────────────
test("prompt generator builds a text draft delivered via clipboard only", () => {
  assert.match(src, /function buildPrompt\(/, "has a prompt generator");
  assert.match(src, /data-team-copy="\$\{escHtml\(prompt\)\}"/, "generated prompt is wired to a copy button");
  // prompt carries context (type tag + what to check)
  assert.match(src, /\[ใบเสนอราคา\]|\[งานบริการ\]|\[ลูกค้า\]|\[สินค้า\]/, "prompt includes the item type for context");
  assert.match(src, /ช่วยตรวจ|ช่วยเช็ค|ช่วยสรุป/, "prompt states what to check");
  // prompt is plain text, not sent anywhere
  assert.ok(!/buildPrompt[\s\S]{0,500}(fetch|xhr|\.post|\.insert)/.test(src), "prompt must not be sent over network");
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

// ── layout is overflow-safe (responsive, wrapping filter, modal above nav) ────
test("layout source has no obvious horizontal-overflow hazards", () => {
  assert.match(src, /minmax\(/, "grids must use minmax for responsiveness");
  assert.match(src, /repeat\(auto-(fill|fit)/, "card grids must auto-fill/auto-fit");
  assert.match(src, /\.team-center\{[^}]*overflow:hidden/, "container must clip overflow");
  assert.match(src, /max-width:100%/, "container must cap width at 100%");
  assert.match(src, /min-width:0/, "flex/grid children must be allowed to shrink (min-width:0)");
  assert.match(src, /word-break:break-word/, "long values must wrap, not overflow");
  assert.ok(!/\d+vw/.test(src), "must not use vw widths (scrollbar overflow risk)");
  assert.ok(!/width:\s*\d{4,}px/.test(src), "must not use 4-digit fixed pixel widths");
  assert.match(src, /@media \(max-width:640px\)/, "must have a mobile breakpoint");
  // filter chips + search/sort controls must be able to wrap on narrow screens
  assert.match(src, /\.team-filter\{[^}]*flex-wrap:wrap/, "filter row must wrap");
  assert.match(src, /\.team-controls\{[^}]*flex-wrap:wrap/, "search/sort controls row must wrap");
  // drill-down modal must sit above bottom nav / FAB (z-index high, fixed overlay)
  assert.match(src, /\.team-modal\{[^}]*position:fixed/, "modal overlay is fixed");
  assert.match(src, /\.team-modal\{[^}]*z-index:9995/, "modal must layer above bottom nav/FAB");
});
