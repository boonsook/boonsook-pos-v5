// Phase 461 — Serial Number Tracking: hard-delete a serial row (build 461)
// Run: node --test tests/serial_delete_guard.test.js
//
// Why this exists:
//   The Serial Number / Warranty page (modules/serials.js) had NO delete button —
//   only edit (✏️) and claim (🔧). Owner needs to remove serial records (e.g. test
//   data). Phase 461 adds a 🗑️ delete button per row that does a hard DELETE on
//   product_serials, guarded by a confirm dialog and — critically — verifies the
//   delete actually removed a row (PostgREST returns 200 + [] when RLS blocks or the
//   id is missing, so a naive "if r.ok → success" would silently claim success while
//   nothing was deleted, exactly the "ไม่ลบให้" symptom). These guards lock that the
//   delete confirms first, checks the result, and never swallows the outcome.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/serials.js"), "utf8");

function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) start = src.indexOf(`async function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const delBody = extractFn("deleteSerial");

// ── row renders a delete button wired to deleteSerial ─────────────────────────
test("each serial row renders a 🗑️ delete button (class sr-del-btn, data-id)", () => {
  assert.match(src, /class="sr-del-btn"[^>]*data-id="\$\{s\.id\}"/, "row must have sr-del-btn with data-id");
  assert.ok(src.includes("🗑️"), "delete button must show a trash icon");
});

test("sr-del-btn click handler is wired and calls deleteSerial", () => {
  assert.match(
    src,
    /querySelectorAll\("\.sr-del-btn"\)\.forEach[\s\S]*?deleteSerial\(ctx,\s*s\.id,\s*s\.serial_no\)/,
    "sr-del-btn listener must look up the row and call deleteSerial(ctx, s.id, s.serial_no)"
  );
});

// ── delete confirms BEFORE doing anything destructive ─────────────────────────
test("deleteSerial asks for confirmation and early-returns if declined", () => {
  assert.match(delBody, /window\.App\?\.confirm\?\./, "must use App.confirm");
  assert.match(delBody, /if\s*\(!\(await window\.App\?\.confirm[\s\S]*?\)\)\s*return/, "must early-return when not confirmed");
  const confirmIdx = delBody.indexOf("confirm");
  const fetchIdx = delBody.indexOf("fetch(");
  assert.ok(confirmIdx !== -1 && fetchIdx !== -1 && confirmIdx < fetchIdx, "confirm must come before the DELETE fetch");
});

// ── it is a real DELETE on product_serials, id-scoped + encoded ───────────────
test("deleteSerial issues a DELETE on product_serials scoped by id (encoded)", () => {
  assert.match(delBody, /method:\s*"DELETE"/, "must use HTTP DELETE");
  assert.match(delBody, /\/rest\/v1\/product_serials\?id=eq\."\s*\+\s*encodeURIComponent\(id\)/, "must scope by id=eq. + encodeURIComponent(id)");
});

// ── outcome is verified, never swallowed (the core of this fix) ───────────────
test("deleteSerial throws on non-ok HTTP and reports the error", () => {
  assert.match(delBody, /if\s*\(!r\.ok\)\s*throw/, "must throw on !r.ok");
  assert.match(delBody, /catch[\s\S]*showToast[\s\S]*(error|ผิดพลาด)/, "catch must surface the error via toast");
});

test("deleteSerial treats a 0-row delete (RLS/missing) as failure, not success", () => {
  assert.match(delBody, /return=representation/, "must request the deleted rows back");
  assert.match(delBody, /rows\.length\s*===\s*0/, "must detect 0 rows deleted");
  // the 0-row branch must NOT claim success: it returns after an error toast
  assert.match(delBody, /rows\.length\s*===\s*0[\s\S]*?showToast[\s\S]*?return/, "0-row branch must error-toast and return (no false success)");
});

test("deleteSerial refreshes the list only on a confirmed successful delete", () => {
  // renderSerialsPage call must sit after the 0-row guard (i.e. in the success path)
  const zeroIdx = delBody.indexOf("rows.length === 0");
  const renderIdx = delBody.lastIndexOf("renderSerialsPage");
  assert.ok(zeroIdx !== -1 && renderIdx !== -1 && renderIdx > zeroIdx, "renderSerialsPage must be in the success path, after the 0-row guard");
});

// ── no banned dialog primitives ───────────────────────────────────────────────
test("serials.js uses no alert() (project rule: showToast/App.confirm only)", () => {
  assert.ok(!/\balert\s*\(/.test(src), "must not use alert()");
});
