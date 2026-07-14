// Phase 390 — accounting-readiness-service-scope-fix (HIGH money-path visibility)
// Run: node --test tests/accounting_readiness_service_scope.test.js
//
// Why this exists:
//   Service-job revenue (delivered/done/closed + total_cost>0) auto-posts a JV. If that post
//   failed, the job is closed but no JE exists — revenue silently missing from accounting.
//   Before this phase, the close-readiness (periods.js) and the Backfill integrity panel
//   (backfill.js) only looked at sales/expenses/payroll, so they could show GREEN ("บิลมี JE ครบ")
//   while a service job was still missing its JE (live: JOB-1780732840014 ฿600, June 2026).
//   These guards lock the widened scope:
//     1. the shared detector matches by source_id (primary) + job_no-in-description (fallback),
//     2. periods readiness + backfill integrity both fold in service-missing and treat a
//        fetch failure as UNKNOWN (never green),
//     3. nothing in the scan/readiness path writes (read-only GET); re-post stays manual.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findUnpostedServiceJobs, buildPostedRef } from "../modules/service_reconcile.js";
import { _monthNeedsAttention, _readinessLinesHtml } from "../modules/accounting/periods.js";

const SVC = fs.readFileSync(path.resolve("modules/service_reconcile.js"), "utf8");
const PERIODS = fs.readFileSync(path.resolve("modules/accounting/periods.js"), "utf8");
const BACKFILL = fs.readFileSync(path.resolve("modules/accounting/backfill.js"), "utf8");

const AFTER_EFF = "2026-07-06T08:00:00Z";   // → BKK 2026-07-06 (after 2026-07-01 — Phase 413)
const BEFORE_EFF = "2026-04-10T12:00:00Z";  // → BKK 2026-04-10 (before effective)
function job(extra = {}) {
  return { id: 1, job_no: "JOB-1780732840014", customer_name: "หลวงพี่", total_cost: 600, status: "delivered", created_at: AFTER_EFF, ...extra };
}

// ── buildPostedRef ───────────────────────────────────────────────────────────
test("buildPostedRef collects source_ids (as strings) + descriptions", () => {
  const ref = buildPostedRef([
    { source_id: 5, description: "a" },
    { source_id: null, description: "JOB-9 fallback" },
    { source_id: 7 },
    null,
  ]);
  assert.equal(ref.sourceIds.has("5"), true);
  assert.equal(ref.sourceIds.has("7"), true);
  assert.equal(ref.sourceIds.has("null"), false, "null source_id is not added");
  assert.deepEqual(ref.descriptions, ["a", "JOB-9 fallback"]);
});

// ── PRIMARY match: source_id ─────────────────────────────────────────────────
test("flags a delivered job whose id has no JE source_id", () => {
  const posted = buildPostedRef([{ source_id: 999, description: "JOB-999 อื่น" }]);
  const orphans = findUnpostedServiceJobs([job()], posted);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, 1);
});

test("does NOT flag when a JE source_id matches the job id (primary match wins)", () => {
  const posted = buildPostedRef([{ source_id: 1, description: "ไม่มีเลขงานใน description" }]);
  assert.equal(findUnpostedServiceJobs([job({ id: 1 })], posted).length, 0);
});

test("source_id primary lets us flag a closed job even WITHOUT a JOB-\\d+ job_no", () => {
  // legacy job_no matching could not catch this; source_id can
  const posted = buildPostedRef([{ source_id: 999 }]);
  assert.equal(findUnpostedServiceJobs([job({ id: 7, job_no: "" })], posted).length, 1);
});

// ── FALLBACK: job_no in description (no source_id on the JE) ──────────────────
test("fallback: a JE with JOB-no in description but no source_id still counts as posted", () => {
  const posted = buildPostedRef([{ source_id: null, description: "งานบริการ JOB-1780732840014 — หลวงพี่" }]);
  assert.equal(findUnpostedServiceJobs([job()], posted).length, 0);
});

// ── skip rules (object signature) ────────────────────────────────────────────
test("skips jobs before effective date / amount<=0 / non-income status", () => {
  const posted = buildPostedRef([]);
  assert.equal(findUnpostedServiceJobs([job({ created_at: BEFORE_EFF })], posted).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ total_cost: 0 })], posted).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ total_cost: null })], posted).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ status: "pending" })], posted).length, 0);
});

test("custom effectiveDate is respected (object signature)", () => {
  const posted = buildPostedRef([]);
  assert.equal(findUnpostedServiceJobs([job()], posted, { effectiveDate: "2026-12-01" }).length, 0);
});

// ── shared fetch helper is read-only and date-scoped ─────────────────────────
test("fetchServiceJVStatus reads service_jobs + journal_entries by GET, never writes", () => {
  assert.match(SVC, /export async function fetchServiceJVStatus/, "exports the shared status fetch");
  assert.match(SVC, /\/rest\/v1\//, "ยิงผ่าน REST");
  assert.match(SVC, /service_jobs\?/, "fetches service_jobs");
  // ★ Phase 606-b1: select ต้องมีทุกฟิลด์ที่ canonical writer ใช้ตัดสิน (flow/closed_at/job_type)
  //   — ถ้าขาด ปุ่ม "ส่งเข้าบัญชีอีกครั้ง" จะถูก writer block (finance-flow-unknown) ทุกครั้ง
  assert.match(SVC, /select=id,job_no,customer_name,status,total_cost,job_type,payment_method,closed_at,finance_flow_version,note,created_at/,
    "service_jobs read-only select (ต้องครบ metadata ของ writer)");
  // ★ review#2: recognition period = closed_at (งาน closed_at=null query แยกด้วย created_at)
  assert.match(SVC, /closed_at=gte\.\$\{fromDate\}/, "ช่วงตรวจ bound ด้วย closed_at");
  assert.match(SVC, /closed_at=is\.null/, "งานไม่มีวันปิด query แยก");
  assert.match(SVC, /journal_entries\?/, "fetches journal_entries");
  // ★ review#2: JE fetch ต้องเอา status/total ด้วย + โหลด journal_lines → พิสูจน์ว่า "ลงบัญชีถูกจริง"
  //   (มี source_id อย่างเดียว = รู้แค่ว่ามี header — draft/header-only/บัญชีผิด จะถูกนับว่า OK ผิด ๆ)
  assert.match(SVC, /source_table=eq\.service_jobs&select=id,source_id,description,status,total_debit,total_credit/,
    "JE fetch ต้องมี status + ยอด (ไม่ใช่แค่ source_id)");
  assert.match(SVC, /journal_lines\?select=entry_id,account_code,debit,credit/, "ต้องอ่าน lines จริง");

  // no write verbs anywhere in the reconcile module's fetch path
  assert.doesNotMatch(SVC, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/, "scan path is GET-only");
  // re-post still goes through the idempotent helper, bound to a click (no auto-post)
  assert.match(SVC, /postJournalForServiceJob\s*\(/, "re-post uses idempotent helper");
  assert.match(SVC, /\.svc-recon-repost[\s\S]{0,160}addEventListener\("click"/, "re-post is manual (click-bound)");
});

// ── periods.js readiness now folds in service-missing + unknown ──────────────
test("periods readiness includes serviceMissing + serviceUnknown and gates 'ready' on them", () => {
  assert.match(PERIODS, /import \{ fetchServiceJVStatus \} from "\.\.\/service_reconcile\.js"/, "imports shared detector");
  assert.match(PERIODS, /serviceMissing\s*=\s*\(svc\.orphans \|\| \[\]\)\.length/, "counts service orphans from shared fetch");
  // fetch failure → unknown (NOT green)
  assert.match(PERIODS, /else serviceUnknown = true/, "non-ok fetch → serviceUnknown");
  assert.match(PERIODS, /catch \(_e\) \{ serviceUnknown = true; \}/, "throw → serviceUnknown");
  assert.match(PERIODS, /ready:\s*orphanSrc === 0 && orphanJV === 0 && serviceMissing === 0 && !serviceUnknown/, "ready requires service complete + known");
  // the misleading unconditional 'บิลมี JE ครบ ✅' is gone; green only when everything is clean
  assert.doesNotMatch(PERIODS, /rd\.orphanSrc === 0 \? '📋 บิลมี JE ครบ ✅'/, "old bills-only green label removed");
  assert.match(PERIODS, /รวม service \+ ไม่มี unknown|บิล \+ งานบริการมี JE ครบ/, "all-clear label requires service too");
  assert.match(PERIODS, /งานบริการ \$\{rd\.serviceMissing\} งานยังไม่เข้าบัญชี/, "renders a service-missing warning line");
  // lock-gate warns on service issues too
  assert.match(PERIODS, /issues\.push\(`งานบริการ \$\{rd\.serviceMissing\}/, "lock gate lists service-missing");
});

// readiness scan itself must be read-only (the writes in periods.js are the lock/unlock actions only)
test("fetchCloseReadiness body performs no write verbs", () => {
  const body = (PERIODS.match(/async function fetchCloseReadiness\([\s\S]*?\n}/) || [""])[0];
  assert.ok(body.length > 0, "found fetchCloseReadiness");
  assert.doesNotMatch(body, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/, "readiness scan is GET-only");
  assert.match(body, /fetchServiceJVStatus\(\{ fromDate, toDate \}\)/, "readiness calls the shared month-scoped fetch");
});

// ── Codex re-review: a month with 0 JV but a service orphan must NOT look empty ─
test("_monthNeedsAttention flags service-missing / unknown / orphans (even when jvCount=0)", () => {
  assert.equal(_monthNeedsAttention({ orphanSrc: 0, orphanJV: 0, serviceMissing: 1, serviceUnknown: false }), true, "service missing → attention");
  assert.equal(_monthNeedsAttention({ orphanSrc: 0, orphanJV: 0, serviceMissing: 0, serviceUnknown: true }), true, "service unknown → attention");
  assert.equal(_monthNeedsAttention({ orphanSrc: 2, orphanJV: 0, serviceMissing: 0, serviceUnknown: false }), true, "bill orphan → attention");
  assert.equal(_monthNeedsAttention({ orphanSrc: 0, orphanJV: 0, serviceMissing: 0, serviceUnknown: false }), false, "all clean → no attention");
  assert.equal(_monthNeedsAttention(null), false, "no readiness → no attention");
});

test("_readinessLinesHtml shows a service warning (not all-clear) when service is missing/unknown", () => {
  const missing = _readinessLinesHtml({ orphanSrc: 0, orphanJV: 0, serviceMissing: 1, serviceUnknown: false });
  assert.match(missing, /งานบริการ 1 งานยังไม่เข้าบัญชี/, "renders service-missing warning");
  assert.doesNotMatch(missing, /มี JE ครบ ✅/, "no misleading all-clear when service missing");
  const unknown = _readinessLinesHtml({ orphanSrc: 0, orphanJV: 0, serviceMissing: 0, serviceUnknown: true });
  assert.match(unknown, /ตรวจงานบริการไม่ได้ \(unknown\)/, "renders unknown warning");
  assert.doesNotMatch(unknown, /มี JE ครบ ✅/, "unknown is not green");
  const clear = _readinessLinesHtml({ orphanSrc: 0, orphanJV: 0, serviceMissing: 0, serviceUnknown: false });
  assert.match(clear, /บิล \+ งานบริการมี JE ครบ ✅/, "all-clear only when everything verified clean");
});

test("Period Close computes readiness every non-future month + renders not-empty when service missing", () => {
  // the old gate (`if (summaries[m].jvCount > 0) { ...fetchCloseReadiness }`) is gone
  assert.doesNotMatch(PERIODS, /if \(summaries\[m\]\.jvCount > 0\)/, "readiness no longer gated on jvCount>0");
  assert.match(PERIODS, /const isFuture =[\s\S]*?m > currentMonth/, "guards future months only");
  assert.match(PERIODS, /if \(!isFuture\) \{[\s\S]*?fetchCloseReadiness/, "readiness runs for non-future months");
  // a jvCount=0 month that needs attention renders the service warning, BEFORE the empty fallback
  assert.match(PERIODS, /needsAttention \? `[\s\S]*?ยังไม่มี JV ในเดือนนี้[\s\S]*?ไม่มีรายการในเดือนนี้/,
    "needsAttention branch (service warning) precedes the 'empty month' fallback");
  assert.match(PERIODS, /needsAttention\s*=\s*_monthNeedsAttention\(rd\)/, "card uses _monthNeedsAttention");
});

// ── backfill integrity panel folds service-missing into the green/red verdict ─
test("backfill integrity panel includes service-missing in totals + links to Service Reconcile", () => {
  assert.match(BACKFILL, /import \{ fetchServiceJVStatus \} from "\.\.\/service_reconcile\.js"/, "imports shared detector");
  assert.match(BACKFILL, /svcMissing\s*=\s*\(svc\.orphans \|\| \[\]\)\.length/, "counts service orphans");
  assert.match(BACKFILL, /else svcUnknown = true/, "non-ok fetch → svcUnknown");
  assert.match(BACKFILL, /\.length, 0\)\s*\+\s*svcMissing/, "service-missing folded into totalActionable");
  assert.match(BACKFILL, /\+\s*\(svcUnknown \? 1 : 0\)/, "service-unknown folded into totalUnknown");
  assert.match(BACKFILL, /Service Reconcile/, "points the admin to the Service Reconcile page");
});
