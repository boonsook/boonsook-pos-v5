// Phase 384 service-autopost-reconcile (Part B) — money path §4.8
// Run: node --test tests/service_reconcile_guard.test.js
//
// Why this exists:
//   Service jobs closed (delivered/done/closed) auto-post JV as fire-and-forget in service_form.js.
//   If the post fails, the job is delivered but no JE exists — revenue silently missing.
//   This admin-only page surfaces such "orphan revenue" jobs and lets admin re-post (idempotent).
//   Tests lock:
//   (1) pure findUnpostedServiceJobs (flag only closed+amount>0+after-eff+no-JE; null-safe),
//   (2) re-post goes through postJournalForServiceJob (idempotent) — NOT a hand-rolled JE insert,
//   (3) no service_jobs status mutation / no schema DDL / read-only fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isServiceIncomeStatus,
  extractPostedJobNos,
  findUnpostedServiceJobs,
  SERVICE_INCOME_STATUSES,
} from "../modules/service_reconcile.js";

const SRC = fs.readFileSync(path.resolve("modules/service_reconcile.js"), "utf8");

// created_at ที่ชัดเจนหลัง/ก่อน effective date (2026-05-01) ใน Asia/Bangkok (UTC+7, ใช้เที่ยงวันกัน edge)
const AFTER_EFF = "2026-06-06T08:00:00Z";   // → BKK 2026-06-06
const BEFORE_EFF = "2026-04-10T12:00:00Z";  // → BKK 2026-04-10

function job(extra = {}) {
  return {
    id: 1,
    job_no: "JOB-1780732840014",
    customer_name: "หลวงพี่",
    job_type: "repair_ac",
    total_cost: 600,
    status: "delivered",
    created_at: AFTER_EFF,
    ...extra,
  };
}

// ── PURE: isServiceIncomeStatus ──

test("isServiceIncomeStatus true for delivered/done/closed (case-insensitive)", () => {
  assert.equal(isServiceIncomeStatus("delivered"), true);
  assert.equal(isServiceIncomeStatus("DONE"), true);
  assert.equal(isServiceIncomeStatus(" Closed "), true);
});

test("isServiceIncomeStatus false for open statuses / null", () => {
  assert.equal(isServiceIncomeStatus("pending"), false);
  assert.equal(isServiceIncomeStatus("progress"), false);
  assert.equal(isServiceIncomeStatus("cancelled"), false);
  assert.equal(isServiceIncomeStatus(null), false);
  assert.equal(isServiceIncomeStatus(""), false);
});

test("SERVICE_INCOME_STATUSES matches postJournalForServiceJob's accepted set", () => {
  // auto_post.js gates on ["delivered","closed","done"] — keep in sync
  assert.deepEqual([...SERVICE_INCOME_STATUSES].sort(), ["closed", "delivered", "done"]);
});

// ── PURE: extractPostedJobNos ──

test("extractPostedJobNos pulls all JOB-\\d+ tokens from descriptions", () => {
  const set = extractPostedJobNos([
    "งานบริการ JOB-100 — ลูกค้า ก",
    "งานบริการ JOB-200 — ลูกค้า ข",
    "ขาย POS #5 — ลูกค้าทั่วไป",   // ไม่มี JOB- → ไม่เก็บ
  ]);
  assert.equal(set.has("JOB-100"), true);
  assert.equal(set.has("JOB-200"), true);
  assert.equal(set.size, 2);
});

test("extractPostedJobNos null-safe (null / non-array / null elements)", () => {
  assert.equal(extractPostedJobNos(null).size, 0);
  assert.equal(extractPostedJobNos(undefined).size, 0);
  assert.equal(extractPostedJobNos("nope").size, 0);
  assert.equal(extractPostedJobNos([null, undefined, 123]).size, 0);
});

// ── PURE: findUnpostedServiceJobs ──

test("flags orphan: delivered + amount>0 + after-eff + no matching JE", () => {
  const orphans = findUnpostedServiceJobs([job()], ["งานบริการ JOB-999 — อื่น"]);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].job_no, "JOB-1780732840014");
});

test("does NOT flag when a JE description already references the job_no", () => {
  const orphans = findUnpostedServiceJobs(
    [job()],
    ["งานบริการ JOB-1780732840014 — หลวงพี่"]
  );
  assert.equal(orphans.length, 0);
});

test("does NOT flag total_cost = 0 / non-numeric", () => {
  assert.equal(findUnpostedServiceJobs([job({ total_cost: 0 })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ total_cost: null })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ total_cost: "abc" })], []).length, 0);
});

test("does NOT flag jobs before effective date", () => {
  const orphans = findUnpostedServiceJobs([job({ created_at: BEFORE_EFF })], []);
  assert.equal(orphans.length, 0);
});

test("does NOT flag non-income statuses (pending/progress/cancelled)", () => {
  assert.equal(findUnpostedServiceJobs([job({ status: "pending" })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ status: "progress" })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ status: "cancelled" })], []).length, 0);
});

test("does NOT flag jobs without a JOB-\\d+ job_no (cannot match → unverifiable)", () => {
  assert.equal(findUnpostedServiceJobs([job({ job_no: "" })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ job_no: null })], []).length, 0);
  assert.equal(findUnpostedServiceJobs([job({ job_no: "WALKIN-5" })], []).length, 0);
});

test("respects custom effectiveDate option", () => {
  // ตั้ง effective ใหม่หลังวันงาน → ไม่ flag
  const orphans = findUnpostedServiceJobs([job()], [], { effectiveDate: "2026-12-01" });
  assert.equal(orphans.length, 0);
});

test("null-safe inputs (null jobs / null descriptions / null job element)", () => {
  assert.deepEqual(findUnpostedServiceJobs(null, null), []);
  assert.deepEqual(findUnpostedServiceJobs(undefined, undefined), []);
  assert.deepEqual(findUnpostedServiceJobs([null, undefined], []), []);
});

test("does NOT mutate the input jobs array/order; returns subset in original order", () => {
  const a = job({ id: 1, job_no: "JOB-1", created_at: AFTER_EFF });
  const b = job({ id: 2, job_no: "JOB-2", status: "pending" }); // filtered out
  const c = job({ id: 3, job_no: "JOB-3", created_at: AFTER_EFF });
  const input = [a, b, c];
  const out = findUnpostedServiceJobs(input, []);
  assert.deepEqual(out.map(j => j.id), [1, 3]);
  assert.equal(input.length, 3); // unchanged
});

// ── SOURCE GUARDS: re-post safety + no forbidden writes ──

test("re-post goes through postJournalForServiceJob (idempotent), not a raw JE insert", () => {
  assert.match(SRC, /import\s*\{\s*postJournalForServiceJob\s*\}\s*from\s*["']\.\/accounting\/auto_post\.js["']/);
  assert.match(SRC, /postJournalForServiceJob\s*\(/);
  // must NOT hand-roll a journal_entries / journal_lines insert
  assert.doesNotMatch(SRC, /rest\/v1\/journal_entries[^"'`]*["'`]\s*,\s*\{\s*method:\s*["']POST/i);
  assert.doesNotMatch(SRC, /rest\/v1\/journal_lines/i);
});

test("reads service_jobs READ-ONLY (GET) and never writes it (no collision w/ team 383)", () => {
  // Phase 390: service_reconcile now fetches service_jobs (GET, date-scoped) for completeness.
  // That is read-only — it must never carry a write method, never assign .status, never use 383's normalizer.
  assert.doesNotMatch(SRC, /service_jobs[^"'`]*["'`]\s*,\s*\{[^}]*method:\s*["'](POST|PATCH|PUT|DELETE)/i);
  assert.doesNotMatch(SRC, /\.status\s*=[^=]/);          // no status assignment
  assert.doesNotMatch(SRC, /normalizeServiceJobStatus/); // not touching 383's status logic
});

test("no schema/DDL and JE fetch is read-only (GET, no method on journal_entries fetch)", () => {
  assert.doesNotMatch(SRC, /ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE/i);
  // the only journal_entries access is a plain GET fetch (no method:POST/PATCH/DELETE near it)
  assert.doesNotMatch(SRC, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
});

test("admin-only gate present", () => {
  assert.match(SRC, /requireAdmin|currentRole/);
  assert.match(SRC, /ผู้ดูแลระบบเท่านั้น/);
});
