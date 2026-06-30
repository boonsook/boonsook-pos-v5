// Phase 545 — service job close (done/delivered/closed) = admin-only
// Run: node --test tests/service_job_close_admin_guard.test.js
//
// Closing a service job (status → done/delivered/closed) auto-posts a JV and deducts real stock.
// Policy: only admin may make that transition. Enforced in THREE layers:
//   1. pure helpers (service_status.js)         — testable completion / close-transition logic
//   2. client (main.js)                          — drawer hides completion options + saveServiceJob
//                                                  returns before closed_at/JV/stock for non-admin
//   3. DB trigger (supabase-phase545 …sql)       — the real boundary: rejects a non-admin
//                                                  non-completion→completion UPDATE with 42501

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SERVICE_COMPLETION_STATUSES, isServiceCompletionStatus, isServiceCloseTransition,
  normalizeServiceJobStatus,
} from "../modules/service_status.js";

const MAIN = fs.readFileSync(path.resolve("main.js"), "utf8");
const SQL = fs.readFileSync(path.resolve("supabase-phase545-service-close-admin-guard.sql"), "utf8");

// ───────────────────────────────────────────────
// 1. pure helpers — completion set + transition-only semantics
// ───────────────────────────────────────────────

test("completion statuses are exactly done/delivered/closed", () => {
  assert.deepEqual([...SERVICE_COMPLETION_STATUSES].sort(), ["closed", "delivered", "done"]);
});

test("isServiceCompletionStatus: only the 3 closing statuses, not pending/progress/cancelled/pending_review", () => {
  for (const s of ["done", "delivered", "closed"]) assert.equal(isServiceCompletionStatus(s), true, s);
  for (const s of ["pending", "progress", "cancelled", "pending_review", "", null, undefined]) {
    assert.equal(isServiceCompletionStatus(s), false, String(s));
  }
});

test("isServiceCloseTransition: blocks only a NEW close (non-completion → completion)", () => {
  // a fresh close → true (this is the gated moment)
  assert.equal(isServiceCloseTransition("pending", "delivered"), true);
  assert.equal(isServiceCloseTransition("progress", "done"), true);
  assert.equal(isServiceCloseTransition("", "closed"), true);          // new job created already-complete
  assert.equal(isServiceCloseTransition(undefined, "delivered"), true);
  // already complete → editing it is NOT a new close (transition-only, not absolute)
  assert.equal(isServiceCloseTransition("delivered", "delivered"), false);
  assert.equal(isServiceCloseTransition("delivered", "closed"), false); // already in completion
  assert.equal(isServiceCloseTransition("done", "delivered"), false);
  // non-close edits → false
  assert.equal(isServiceCloseTransition("pending", "progress"), false);
  assert.equal(isServiceCloseTransition("pending", "cancelled"), false);
  assert.equal(isServiceCloseTransition("pending", "pending"), false);
});

test("technician 'รออนุมัติ' (pending_review) normalizes to pending → NOT a close transition (still allowed)", () => {
  const submitted = normalizeServiceJobStatus("pending_review"); // → "pending"
  assert.equal(submitted, "pending");
  assert.equal(isServiceCloseTransition("progress", submitted), false, "submitting for review must not be blocked");
});

// ───────────────────────────────────────────────
// 2. client (main.js) — UI hide + save-path guard ordered before side-effects
// ───────────────────────────────────────────────

test("main.js: drawer hides/disables completion options for non-admin (keeps current status visible)", () => {
  const i = MAIN.indexOf("function openServiceJobDrawer");
  const body = MAIN.slice(i, MAIN.indexOf("async function saveServiceJob"));
  assert.match(body, /requireAdmin\(\)/, "drawer must check role");
  assert.match(body, /isServiceCompletionStatus\(opt\.value\)/, "must test each option against completion set");
  assert.match(body, /opt\.disabled\s*=|opt\.hidden\s*=/, "must disable/hide blocked options");
  assert.match(body, /opt\.value\s*!==\s*_curStatus/, "must keep the job's current status selectable (transition-only)");
});

test("main.js: saveServiceJob blocks non-admin close BEFORE closed_at / JV / stock side-effects", () => {
  const idxGuard = MAIN.indexOf("isServiceCloseTransition(state.editingServiceJobOrigStatus");
  const idxClosedAt = MAIN.indexOf("payload.closed_at = new Date");
  const idxJV = MAIN.indexOf("postJournalForServiceJob(");
  const idxStock = MAIN.indexOf("_equipDeductOnClose(");
  assert.ok(idxGuard !== -1, "save-path close guard must exist");
  assert.match(MAIN.slice(idxGuard - 60, idxGuard), /!requireAdmin\(\)\s*&&\s*$/, "guard must be !requireAdmin() && isServiceCloseTransition(...)");
  // the guard returns before ALL side-effects
  assert.ok(idxGuard < idxClosedAt, "guard must precede closed_at stamp");
  assert.ok(idxGuard < idxJV, "guard must precede JV auto-post");
  assert.ok(idxGuard < idxStock, "guard must precede stock deduct-on-close");
  // and it actually returns (does not fall through)
  const guardBlock = MAIN.slice(idxGuard, idxGuard + 220);
  assert.match(guardBlock, /return showToast\(/, "must return (abort save) for a blocked non-admin close");
});

// ───────────────────────────────────────────────
// 3. DB trigger (SQL) — the real boundary
// ───────────────────────────────────────────────

test("SQL: BEFORE UPDATE trigger on service_jobs, transition-only, admin-only, 42501", () => {
  assert.match(SQL, /BEFORE UPDATE ON public\.service_jobs/, "must be a BEFORE UPDATE trigger on service_jobs");
  assert.match(SQL, /NEW\.status IN \('done', 'delivered', 'closed'\)/, "must gate entry INTO a completion status");
  assert.match(SQL, /OLD\.status NOT IN \('done', 'delivered', 'closed'\)/, "transition-only: OLD must be non-completion");
  assert.match(SQL, /NOT public\.is_admin\(\)/, "must allow admin (public.is_admin())");
  assert.match(SQL, /ERRCODE\s*=\s*'42501'/, "must RAISE with 42501 (insufficient privilege)");
});

test("SQL: does not block edits to already-closed jobs, and lets the trusted backend through", () => {
  // OLD.status IS DISTINCT FROM NEW.status → unchanged status never triggers (edit note on closed job is fine)
  assert.match(SQL, /OLD\.status IS DISTINCT FROM NEW\.status/, "must only act on an actual status change");
  // service_role / backend (auth.uid() IS NULL) is not gated
  assert.match(SQL, /auth\.uid\(\) IS NOT NULL/, "authenticated-only gate (service_role backend not blocked)");
});
