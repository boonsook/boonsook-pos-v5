// Phase 564 — dashboard highlight bar "งานช่างรออนุมัติ" + deep-link to the approve screen
//
// admin should see, from the company overview, that technicians submitted jobs awaiting approval,
// and click straight into the ใบรับงาน page with the "รออนุมัติ" (review) filter pre-selected.
// Read-only display + navigation: no approve/JV/stock/status writes, no new fetch.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setServiceJobsFilter } from "../modules/service_jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dash = readFileSync(path.join(__dirname, "..", "modules", "dashboard.js"), "utf8");
const sj = readFileSync(path.join(__dirname, "..", "modules", "service_jobs.js"), "utf8");

// ── count: uses the shared helper, mirrors the chip (not a hardcoded status) ──
test("dashboard counts pending-review via isServiceJobPendingReview (not hardcoded status)", () => {
  assert.match(dash, /import\s+\{[^}]*isServiceJobPendingReview[^}]*\}\s+from\s+["']\.\/service_status\.js["']/, "must import the helper");
  assert.match(dash, /pendingReviewCount\s*=[\s\S]{0,200}isServiceJobPendingReview\(j\)/, "count uses the helper");
});

test("dashboard count excludes soft-deleted jobs (same predicate as the review chip)", () => {
  assert.match(dash, /pendingReviewCount[\s\S]{0,160}cancelled[\s\S]{0,60}\[ลบแล้ว\]/, "count drops cancelled+[ลบแล้ว] like allJobs");
});

// ── bar: renders only when count > 0, links to service_jobs with the review filter ──
test("highlight bar renders only when pendingReviewCount > 0", () => {
  assert.match(dash, /\$\{pendingReviewCount > 0 \?\s*`/, "bar is behind a > 0 conditional (no empty box)");
});

test('bar carries data-go="service_jobs" + data-sj-filter="review"', () => {
  assert.match(dash, /data-go="service_jobs"\s+data-sj-filter="review"/, "bar must deep-link to the review filter");
});

// ── click: sets the filter BEFORE navigating ─────────────────────────────────
test("click handler sets the service-jobs filter from dataset before showRoute", () => {
  assert.match(dash, /import\s+\{[^}]*setServiceJobsFilter[^}]*\}\s+from\s+["']\.\/service_jobs\.js["']/, "must import the setter");
  assert.match(
    dash,
    /if \(card\.dataset\.sjFilter\) setServiceJobsFilter\(card\.dataset\.sjFilter\);[\s\S]{0,160}showRoute\(target\)/,
    "the setter must be called before showRoute(target)",
  );
});

// ── setter: exported, accepts only the 5 valid chip keys ─────────────────────
test("setServiceJobsFilter is exported and accepts only valid chip keys", () => {
  assert.match(sj, /export function setServiceJobsFilter\(key\)/, "must be exported");
  assert.match(sj, /\["all",\s*"open",\s*"review",\s*"closed",\s*"cancelled"\]\.includes\(key\)/, "guards the key set");
  // behavioral: the function is callable and does not throw on valid/invalid keys
  assert.doesNotThrow(() => { setServiceJobsFilter("review"); setServiceJobsFilter("nope"); });
});

// ── read-only: no new fetch/writes on the dashboard surface ──────────────────
test("dashboard.js still performs NO direct fetch() or supabase writes (read-only)", () => {
  assert.ok(!/\bfetch\s*\(/.test(dash), "must not call fetch() directly");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(dash), "must not call supabase writes");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'"]) {
    assert.ok(!dash.includes(verb), `must not reference HTTP write ${verb}`);
  }
});
