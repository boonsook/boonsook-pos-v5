// Phase 546 — service job delete/cancel = admin-only
// Run: node --test tests/service_job_delete_admin_guard.test.js
//
// "Delete" is a SOFT-DELETE: status='cancelled' + a '[ลบแล้ว]' marker in note (list hides it).
// Only admin may delete/cancel a job. Enforced in layers:
//   - UI (service_jobs.js): the 🗑️ ลบ button renders for admin only; the page is NOT hidden
//     from technicians (they keep seeing/editing open jobs).
//   - handler (service_jobs.js): admin check BEFORE confirm / PATCH / stock restore.
//   - DB trigger (supabase-phase546 …sql): the real boundary — rejects a non-admin
//     cancel-transition OR a newly-added '[ลบแล้ว]' marker with 42501.
// Phase 545's close guard stays a separate, intact trigger.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const SJ = read("modules/service_jobs.js");
const SQL = read("supabase-phase546-service-delete-admin-guard.sql");
const SQL545 = read("supabase-phase545-service-close-admin-guard.sql");

// ───────────────────────────────────────────────
// 1. UI — delete button admin-only, page NOT hidden from technicians
// ───────────────────────────────────────────────

test("UI: 🗑️ ลบ button renders for admin only; the service_jobs page is not hidden from non-admin", () => {
  assert.match(SJ, /_isAdmin\s*=\s*state\.profile\?\.role\s*===\s*["']admin["']/, "must derive _isAdmin from role");
  const i = SJ.indexOf("data-del-job=");
  assert.ok(i !== -1, "delete button must exist");
  assert.match(SJ.slice(i - 120, i), /_isAdmin\s*\?\s*`/, "the delete button must be behind the _isAdmin gate");
  // must NOT early-return / hide the whole page for non-admin
  assert.ok(!/if\s*\(\s*!\s*_isAdmin\s*\)\s*return/.test(SJ), "must not hide the whole service_jobs page from non-admin");
});

// ───────────────────────────────────────────────
// 2. handler — admin guard BEFORE confirm / PATCH / restore stock
// ───────────────────────────────────────────────

test("handler: admin guard runs BEFORE confirm / PATCH / stock restore", () => {
  const i = SJ.indexOf('querySelectorAll("[data-del-job]")');
  const handler = SJ.slice(i, i + 1400);
  const idxGuard = handler.indexOf('state.profile?.role !== "admin"');
  assert.ok(idxGuard !== -1, "handler must guard on admin role");
  const guardBlock = handler.slice(idxGuard, idxGuard + 150);
  assert.match(guardBlock, /showToast\?\.\(\s*["']เฉพาะแอดมินลบงานได้["']\s*,\s*["']error["']\)/, "must toast the admin-only error");
  assert.match(guardBlock, /return/, "must return (abort) for non-admin");
  // ordering: guard precedes the destructive steps
  const idxConfirm = handler.indexOf("App?.confirm");
  const idxRestore = handler.indexOf("restoreServiceJobStock");
  assert.ok(idxConfirm === -1 || idxGuard < idxConfirm, "guard must precede the confirm dialog");
  assert.ok(idxRestore === -1 || idxGuard < idxRestore, "guard must precede stock restore");
});

// ───────────────────────────────────────────────
// 3. DB trigger — cancel-transition OR [ลบแล้ว] marker, admin-only, 42501
// ───────────────────────────────────────────────

test("SQL: BEFORE UPDATE trigger blocks non-admin cancel-transition OR newly-added [ลบแล้ว] with 42501", () => {
  assert.match(SQL, /BEFORE UPDATE ON public\.service_jobs/, "BEFORE UPDATE on service_jobs");
  assert.match(SQL, /NEW\.status = 'cancelled' AND OLD\.status IS DISTINCT FROM NEW\.status/, "(a) cancel transition-only");
  assert.match(SQL, /NEW\.note LIKE '%\[ลบแล้ว\]%'/, "(b) the [ลบแล้ว] delete marker");
  assert.match(SQL, /NOT public\.is_admin\(\)/, "admin allowed via public.is_admin()");
  assert.match(SQL, /ERRCODE\s*=\s*'42501'/, "RAISE with 42501");
  assert.match(SQL, /auth\.uid\(\) IS NOT NULL/, "service_role (null uid) not gated");
});

test("SQL: does not block normal note edits / already-cancelled rows", () => {
  // (b) only when the marker is NEWLY added (OLD didn't have it)
  assert.match(SQL, /OLD\.note IS NULL OR OLD\.note NOT LIKE '%\[ลบแล้ว\]%'/, "marker block must be add-only");
  // (a) is transition-only via OLD.status IS DISTINCT FROM NEW.status (already asserted above)
});

// ───────────────────────────────────────────────
// 4. regression — Phase 545 close guard stays separate & intact
// ───────────────────────────────────────────────

test("Phase 545 close guard remains its own intact trigger (546 does not touch it)", () => {
  assert.match(SQL545, /trg_service_jobs_close_guard/, "545 trigger file must still exist");
  assert.match(SQL, /trg_service_jobs_delete_guard/, "546 must use its own trigger name");
  // strip -- comments so the "ไม่แตะ 545" note doesn't trip the CODE check
  const sqlCode = SQL.replace(/--[^\n]*/g, "");
  assert.ok(!/trg_service_jobs_close_guard/.test(sqlCode), "546 must not redefine/drop the 545 trigger (in actual SQL)");
});
