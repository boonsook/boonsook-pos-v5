// Phase 536 - error_log hardening (audit S2+S3)
// Run: node --test tests/error_log_hardening_guard.test.js
//
// S2: /api/log-error must not trust client-supplied body.user_id.
// S3: error_log rows and grouped aggregates must not be readable by every authenticated user.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { onRequestPost, userIdFromAuthHeader } from "../functions/api/log-error.js";

const LOG_ERROR_SRC = fs.readFileSync(path.resolve("functions/api/log-error.js"), "utf8");
const SQL = fs.readFileSync(path.resolve("supabase-phase536-error-log-hardening.sql"), "utf8");

const REAL_USER = "11111111-1111-4111-8111-111111111111";
const SPOOFED_USER = "22222222-2222-4222-8222-222222222222";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function jwt(payload) {
  return `Bearer ${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

function makeRequest(authHeader, body) {
  return {
    headers: { get: (name) => (name.toLowerCase() === "authorization" ? authHeader : null) },
    json: async () => body,
  };
}

test("userIdFromAuthHeader derives the user id from JWT sub only", () => {
  assert.equal(userIdFromAuthHeader(jwt({ sub: REAL_USER })), REAL_USER);
  assert.equal(userIdFromAuthHeader(jwt({ sub: "not-a-uuid" })), null);
  assert.equal(userIdFromAuthHeader("Bearer malformed"), null);
  assert.equal(userIdFromAuthHeader(null), null);
});

test("/api/log-error ignores spoofed body.user_id and inserts the JWT subject", async () => {
  let insertedPayload = null;
  globalThis.fetch = async (_url, init) => {
    insertedPayload = JSON.parse(init.body);
    return { ok: true, status: 201, text: async () => "" };
  };

  try {
    const resp = await onRequestPost({
      request: makeRequest(jwt({ sub: REAL_USER }), {
        severity: "error",
        message: "boom",
        user_id: SPOOFED_USER,
      }),
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" },
    });

    assert.equal(resp.status, 200);
    assert.equal(insertedPayload.user_id, REAL_USER);
    assert.notEqual(insertedPayload.user_id, SPOOFED_USER);
  } finally {
    delete globalThis.fetch;
  }
});

test("/api/log-error sends user_id null when there is no valid JWT subject", async () => {
  let insertedPayload = null;
  globalThis.fetch = async (_url, init) => {
    insertedPayload = JSON.parse(init.body);
    return { ok: true, status: 201, text: async () => "" };
  };

  try {
    const resp = await onRequestPost({
      request: makeRequest("Bearer anon-key", {
        severity: "warning",
        message: "pre-login warning",
        user_id: SPOOFED_USER,
      }),
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" },
    });

    assert.equal(resp.status, 200);
    assert.equal(insertedPayload.user_id, null);
  } finally {
    delete globalThis.fetch;
  }
});

test("source: log-error never reads body.user_id into the insert payload", () => {
  assert.ok(!/\buser_id:\s*body\.user_id\b/.test(LOG_ERROR_SRC), "must not trust client supplied body.user_id");
  assert.match(LOG_ERROR_SRC, /userIdFromAuthHeader\(clientAuth\)/, "payload user_id must be derived from Authorization");
  assert.match(LOG_ERROR_SRC, /UUID_RE\.test\(sub\)/, "JWT subject must be UUID-validated");
});

test("SQL: error_log insert cannot spoof user_id and select is admin-only", () => {
  assert.match(SQL, /DROP POLICY IF EXISTS error_log_insert_anyone ON public\.error_log/i);
  assert.match(SQL, /WITH CHECK\s*\(\s*user_id IS NULL OR user_id = auth\.uid\(\)\s*\)/i);
  assert.match(SQL, /DROP POLICY IF EXISTS error_log_select_authed ON public\.error_log/i);
  assert.match(SQL, /CREATE POLICY error_log_select_admin ON public\.error_log[\s\S]*USING\s*\(\s*public\.is_admin\(\)\s*\)/i);
  assert.ok(!/CREATE POLICY error_log_select_authed[\s\S]*USING\s*\(\s*true\s*\)/i.test(SQL),
    "must not keep authenticated-wide SELECT");
});

test("SQL: grouped view uses caller RLS instead of owner-bypass view privileges", () => {
  assert.match(SQL, /ALTER VIEW public\.error_log_grouped SET\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  assert.match(SQL, /NOTIFY pgrst,\s*'reload schema'/i);
});
