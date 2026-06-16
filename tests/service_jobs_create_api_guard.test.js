// service-jobs create API guard (Ning agent write-endpoint).
// Run: node --test tests/service_jobs_create_api_guard.test.js
//
// This endpoint writes to service_jobs, so it must stay Ning-agent gated and
// money/stock SAFE: zero cost, no equipment items, no stock movement, no JV.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildJobRecord, getSupabaseWriteAuth } from "../functions/api/v1/service-jobs.js";

const API_SRC = fs.readFileSync(path.resolve("functions/api/v1/service-jobs.js"), "utf8");
const MW_SRC = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");

test("service-jobs route is auth-required and Ning-agent gated in middleware", () => {
  assert.match(MW_SRC, /REQUIRE_AUTH_ENDPOINTS[\s\S]*"\/api\/v1\/service-jobs"/,
    "service-jobs must require auth");
  assert.match(MW_SRC, /NING_AGENT_ENDPOINTS[\s\S]*"\/api\/v1\/service-jobs"/,
    "service-jobs must accept the Ning server-to-server auth");
  assert.match(MW_SRC, /X-NING-AGENT-KEY/);
  assert.match(MW_SRC, /NING_AGENT_API_KEY/);
});

test("service-jobs endpoint is POST-only and never touches stock or accounting", () => {
  assert.match(API_SRC, /export async function onRequestPost/, "exports POST handler");
  assert.doesNotMatch(API_SRC, /export async function onRequest(Get|Put|Patch|Delete)/,
    "does not expose other handlers");
  assert.doesNotMatch(API_SRC, /_equipDeduct|_appApplyStockMovement|postJournal|auto_post/,
    "must not call stock-movement or journal-posting helpers");
  assert.match(API_SRC, /items_json:\s*\[\s*\]/,
    "items_json must stay an empty array literal (no equipment → no stock movement)");
  assert.match(API_SRC, /total_cost:\s*0\b/,
    "total_cost must be 0 (keeps the job out of accounting)");
  assert.match(API_SRC, /env\.SUPABASE_SERVICE_ROLE_KEY/,
    "Ning writes use a server-only Cloudflare secret");
  assert.doesNotMatch(API_SRC, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|/,
    "service role must not fall back to a public key");
});

test("buildJobRecord creates a safe pending request (zero cost, no items)", () => {
  const built = buildJobRecord({
    customer_name: "ทดสอบ",
    customer_phone: "0900000000",
    description: "ดูแอร์ไม่เย็น",
  });
  assert.equal(built.ok, true);
  assert.equal(built.record.status, "pending");
  assert.equal(built.record.total_cost, 0);
  assert.deepEqual(built.record.items_json, []);
  assert.equal(built.record.closed_at, null);
  assert.match(built.record.job_no, /^JOB-\d+$/);
  assert.match(built.record.note, /Ning/);
  assert.equal(built.record.job_type, "service");
});

test("buildJobRecord requires customer_name and description", () => {
  assert.equal(buildJobRecord({ customer_name: "x" }).ok, false);
  assert.equal(buildJobRecord({ description: "y" }).ok, false);
  assert.equal(buildJobRecord({}).ok, false);
});

test("getSupabaseWriteAuth requires Ning agent plus a service-role key", () => {
  const browser = getSupabaseWriteAuth({
    env: { SUPABASE_SERVICE_ROLE_KEY: "k" },
    data: { user: { role: "owner" } },
  });
  assert.equal(browser.ok, false);
  assert.equal(browser.status, 403);

  const noKey = getSupabaseWriteAuth({
    env: {},
    data: { user: { role: "owner", authMode: "ning_agent" } },
  });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.status, 500);
  assert.match(noKey.error, /SUPABASE_SERVICE_ROLE_KEY/);

  const ok = getSupabaseWriteAuth({
    env: { SUPABASE_SERVICE_ROLE_KEY: "service-token" },
    data: { user: { role: "owner", authMode: "ning_agent" } },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.apiKey, "service-token");
  assert.equal(ok.authHeader, "Bearer service-token");
});
