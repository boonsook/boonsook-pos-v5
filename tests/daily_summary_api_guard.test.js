// Phase 1 daily-summary API guard.
// Run: node --test tests/daily_summary_api_guard.test.js
//
// This endpoint returns customer/job report data, so it must stay authenticated,
// report-role gated, and read-only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseBangkokReportDate,
  summarizeDailyJobs,
  hasPendingPartsMarker,
  needsFollowUpMarker,
  needsPaymentReview,
  getSupabaseReportAuth,
} from "../functions/api/v1/reports/daily-summary.js";

const API_SRC = fs.readFileSync(path.resolve("functions/api/v1/reports/daily-summary.js"), "utf8");
const MW_SRC = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");

test("daily-summary route is authenticated and report-role gated in middleware", () => {
  assert.match(MW_SRC, /REQUIRE_AUTH_ENDPOINTS[\s\S]*"\/api\/v1\/reports\/daily-summary"/,
    "daily summary must require a Supabase JWT");
  assert.match(MW_SRC, /REPORT_ONLY_ENDPOINTS[\s\S]*"\/api\/v1\/reports\/daily-summary"/,
    "daily summary must use the report-only role gate");
  assert.match(MW_SRC, /REPORT_ROLES\s*=\s*new Set\(\["admin", "owner"\]\)/,
    "report roles must stay limited to admin/owner");
  assert.match(MW_SRC, /X-NING-AGENT-KEY/, "CORS/auth must allow the Ning server-to-server header");
  assert.match(MW_SRC, /NING_AGENT_API_KEY/, "middleware must validate the configured Ning API key");
  assert.match(MW_SRC, /authMode:\s*"ning_agent"/, "valid Ning key must mark the request as Ning agent auth");
});

test("daily-summary endpoint is GET-only and supports user JWT plus Ning service auth", () => {
  assert.match(API_SRC, /export async function onRequestGet/, "exports GET handler");
  assert.doesNotMatch(API_SRC, /export async function onRequest(Post|Put|Patch|Delete)/,
    "does not expose write handlers");
  assert.doesNotMatch(API_SRC, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/,
    "Supabase REST calls are read-only GETs");
  assert.match(API_SRC, /REPORT_ROLES\.has\(data\?\.user\?\.role\)/,
    "endpoint repeats the report-role guard");
  assert.match(API_SRC, /"Authorization": authHeader/,
    "forwards the selected auth header to Supabase");
  assert.match(API_SRC, /env\.SUPABASE_SERVICE_ROLE_KEY/,
    "Ning server-to-server mode must use a server-only Cloudflare secret");
  assert.doesNotMatch(API_SRC, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|/,
    "service role must not fall back to a public key");
});

test("getSupabaseReportAuth keeps browser JWT and Ning service auth separate", () => {
  const userReq = new Request("https://boonsukair.com/api/v1/reports/daily-summary", {
    headers: { Authorization: "Bearer user-token" },
  });
  const userAuth = getSupabaseReportAuth({ request: userReq, env: {}, data: { user: { role: "owner" } } });
  assert.equal(userAuth.ok, true);
  assert.equal(userAuth.authHeader, "Bearer user-token");
  assert.notEqual(userAuth.apiKey, "service-token");

  const missingService = getSupabaseReportAuth({
    request: new Request("https://boonsukair.com/api/v1/reports/daily-summary"),
    env: {},
    data: { user: { role: "owner", authMode: "ning_agent" } },
  });
  assert.equal(missingService.ok, false);
  assert.equal(missingService.status, 500);
  assert.match(missingService.error, /SUPABASE_SERVICE_ROLE_KEY/);

  const agentAuth = getSupabaseReportAuth({
    request: new Request("https://boonsukair.com/api/v1/reports/daily-summary"),
    env: { SUPABASE_SERVICE_ROLE_KEY: "service-token" },
    data: { user: { role: "owner", authMode: "ning_agent" } },
  });
  assert.equal(agentAuth.ok, true);
  assert.equal(agentAuth.apiKey, "service-token");
  assert.equal(agentAuth.authHeader, "Bearer service-token");
});

test("parseBangkokReportDate builds Asia/Bangkok day boundaries", () => {
  const d = parseBangkokReportDate("2026-06-14");
  assert.equal(d.startIso, "2026-06-13T17:00:00.000Z");
  assert.equal(d.endIso, "2026-06-14T17:00:00.000Z");
  assert.equal(d.tomorrowStartIso, "2026-06-14T17:00:00.000Z");
  assert.equal(d.tomorrowEndIso, "2026-06-15T17:00:00.000Z");
  assert.equal(parseBangkokReportDate("14-06-2026"), null);
});

test("summarizeDailyJobs separates completed, open, tomorrow, and focus buckets", () => {
  const dateInfo = parseBangkokReportDate("2026-06-14");
  const todayJobs = [
    { id: 1, job_no: "JOB-1", status: "done", total_cost: 1200, created_at: "2026-06-14T03:00:00.000Z" },
    { id: 2, job_no: "JOB-2", status: "pending", note: "รออะไหล่ compressor", created_at: "2026-06-14T04:00:00.000Z" },
    { id: 3, job_no: "JOB-3", status: "cancelled", created_at: "2026-06-14T05:00:00.000Z" },
  ];
  const completedTodayJobs = [
    { id: 4, job_no: "JOB-4", status: "closed", total_cost: 900, payment_method: "cash", closed_at: "2026-06-14T08:00:00.000Z", created_at: "2026-06-10T03:00:00.000Z" },
  ];
  const tomorrowJobs = [
    { id: 5, job_no: "JOB-5", status: "pending", created_at: "2026-06-15T03:00:00.000Z" },
  ];
  const openJobs = [
    { id: 2, job_no: "JOB-2", status: "pending", note: "รออะไหล่ compressor", created_at: "2026-06-14T04:00:00.000Z" },
    { id: 6, job_no: "JOB-6", status: "progress", note: "โทรตามลูกค้า", created_at: "2026-06-13T04:00:00.000Z" },
  ];

  const summary = summarizeDailyJobs({ dateInfo, todayJobs, completedTodayJobs, tomorrowJobs, openJobs });
  assert.equal(summary.summary.todayTotal, 2, "cancelled jobs are excluded from todayTotal");
  assert.equal(summary.summary.completedToday, 2, "counts done today plus jobs closed today");
  assert.equal(summary.summary.openOrUnclosed, 2);
  assert.equal(summary.summary.olderOpen, 1);
  assert.equal(summary.summary.tomorrowJobs, 1);
  assert.equal(summary.summary.pendingParts, 1);
  assert.equal(summary.summary.customerFollowUp, 1);
  assert.equal(summary.summary.paymentReview, 1, "completed job without payment evidence is flagged for review");
  assert.equal(summary.technicianWorkload.length, 0, "technician workload waits for a dedicated schema field");
  assert.match(summary.warnings.join(" "), /scheduledAt/, "response documents Phase 1 schema limitation");
});

test("text-marker helpers detect parts, follow-up, and payment review conservatively", () => {
  assert.equal(hasPendingPartsMarker({ note: "ลูกค้ารออะไหล่" }), true);
  assert.equal(needsFollowUpMarker({ description: "call customer tomorrow" }), true);
  assert.equal(needsPaymentReview({ status: "closed", total_cost: 1000 }), true);
  assert.equal(needsPaymentReview({ status: "pending", total_cost: 1000 }), false);
  assert.equal(needsPaymentReview({ status: "closed", total_cost: 1000, payment_method: "cash" }), false);
});
