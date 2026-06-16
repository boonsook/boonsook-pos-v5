// service-job-submit API guard (Ning marks ช่างส่ง → รออนุมัติ).
// Run: node --test tests/service_job_submit_api_guard.test.js
//
// This endpoint UPDATES a job, so it must stay Ning-agent gated and money SAFE:
// status stays "pending" (no JV — accounting fires only on done/delivered/closed),
// never touches total_cost / payment / closed_at / stock.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  noteWithReviewMarker,
  getSupabaseWriteAuth,
  digitsOnly,
} from "../functions/api/v1/service-job-submit.js";

const API_SRC = fs.readFileSync(path.resolve("functions/api/v1/service-job-submit.js"), "utf8");
const MW_SRC = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");

test("service-job-submit route is auth-required and Ning-agent gated in middleware", () => {
  assert.match(MW_SRC, /REQUIRE_AUTH_ENDPOINTS[\s\S]*"\/api\/v1\/service-job-submit"/);
  assert.match(MW_SRC, /NING_AGENT_ENDPOINTS[\s\S]*"\/api\/v1\/service-job-submit"/);
  assert.match(MW_SRC, /X-NING-AGENT-KEY/);
});

test("service-job-submit is POST-only and money SAFE (no cost/payment/JV)", () => {
  assert.match(API_SRC, /export async function onRequestPost/, "exports POST handler");
  assert.doesNotMatch(API_SRC, /export async function onRequest(Get|Put|Patch|Delete)/,
    "no other top-level handlers");
  assert.doesNotMatch(API_SRC, /total_cost|payment_method|payment_slip|closed_at|postJournal|auto_post|_equipDeduct/,
    "must not touch money/stock/JV columns or helpers");
  assert.doesNotMatch(API_SRC, /status:\s*"(done|delivered|closed)"/,
    "must not set a completion status (would trigger accounting)");
  assert.match(API_SRC, /status:\s*"pending"/, "submit keeps the job status at pending");
  assert.match(API_SRC, /env\.SUPABASE_SERVICE_ROLE_KEY/, "uses the server-only service-role key");
  assert.doesNotMatch(API_SRC, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|/, "service role must not fall back to a public key");
});

test("noteWithReviewMarker appends the review marker idempotently", () => {
  assert.equal(noteWithReviewMarker(""), "[รออนุมัติแอดมิน]");
  assert.equal(noteWithReviewMarker("งานเดิม"), "งานเดิม [รออนุมัติแอดมิน]");
  assert.equal(noteWithReviewMarker("x [รออนุมัติแอดมิน]"), "x [รออนุมัติแอดมิน]");
});

test("digitsOnly strips non-digits from a phone", () => {
  assert.equal(digitsOnly("0653914525ดูแอร์น้ำหยด"), "0653914525");
  assert.equal(digitsOnly("08-2689-3663"), "0826893663");
});

test("getSupabaseWriteAuth requires Ning agent plus a service-role key", () => {
  assert.equal(getSupabaseWriteAuth({ env: { SUPABASE_SERVICE_ROLE_KEY: "k" }, data: { user: { role: "owner" } } }).status, 403);
  const noKey = getSupabaseWriteAuth({ env: {}, data: { user: { role: "owner", authMode: "ning_agent" } } });
  assert.equal(noKey.status, 500);
  const ok = getSupabaseWriteAuth({ env: { SUPABASE_SERVICE_ROLE_KEY: "service-token" }, data: { user: { authMode: "ning_agent" } } });
  assert.equal(ok.ok, true);
  assert.equal(ok.authHeader, "Bearer service-token");
});
