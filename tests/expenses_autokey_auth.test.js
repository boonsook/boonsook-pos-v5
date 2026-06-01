// Phase 92.x — AutoKey (parse-receipt) auth regression guard
// Run: node --test tests/expenses_autokey_auth.test.js
//
// Why this exists:
//   /api/parse-receipt is listed in REQUIRE_AUTH_ENDPOINTS (functions/_middleware.js).
//   The global middleware rejects the request with HTTP 401 unless it carries a real
//   Supabase user JWT in `Authorization: Bearer <token>`. The AutoKey "วิเคราะห์ใบเสร็จ"
//   button in modules/expenses.js used to POST without that header, so every analyze
//   click died with 401 before ever reaching Gemini.
//
//   These are source-level assertions because _openAutoKeyModal is module-internal
//   (expenses.js only exports renderExpensesPage) and the handler is DOM-bound — the
//   same guard pattern used by tests/api_layer.test.js. They are scoped to the
//   _openAutoKeyModal function so an unrelated change elsewhere can't mask a regression.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __d = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__d, "..", "modules", "expenses.js"), "utf8");

const fnStart = src.indexOf("function _openAutoKeyModal");
const callIdx = src.indexOf('fetch("/api/parse-receipt"', fnStart);

test("setup: _openAutoKeyModal calls /api/parse-receipt", () => {
  assert.ok(fnStart !== -1, "expected _openAutoKeyModal in expenses.js");
  assert.ok(callIdx !== -1, "expected a fetch to /api/parse-receipt inside _openAutoKeyModal");
});

test("parse-receipt request carries a Supabase JWT (Authorization: Bearer)", () => {
  // headers object lives within the fetch options right after the call opens
  const fetchBlock = src.slice(callIdx, callIdx + 400);
  assert.match(fetchBlock, /Authorization/, "parse-receipt must send an Authorization header");
  assert.match(fetchBlock, /Bearer/, "Authorization must be a Bearer token");
});

test("the bearer token is sourced from the logged-in user JWT (window._sbAccessToken)", () => {
  // token is read inside the handler, before the network call
  const preCall = src.slice(fnStart, callIdx);
  assert.match(preCall, /window\._sbAccessToken/,
    "token must come from window._sbAccessToken (the logged-in user JWT)");
});

test("parse-receipt does NOT fall back to anonKey (publishable key is not a JWT → 401)", () => {
  const preCall = src.slice(fnStart, callIdx);
  const fetchBlock = src.slice(callIdx, callIdx + 400);
  assert.ok(!/anonKey/.test(fetchBlock), "the request headers must not reference anonKey");
  assert.ok(!/_sbAccessToken\s*\|\|\s*[\w.]*anonKey/.test(preCall),
    "must not `_sbAccessToken || cfg.anonKey` — middleware verifyAuthToken requires a 3-part JWT");
});

test("AutoKey guards the missing-token case before the network call (fail fast)", () => {
  const preCall = src.slice(fnStart, callIdx);
  assert.match(preCall, /!\s*_akToken/, "must early-out when there is no access token");
});

test("AutoKey prompts re-login on a missing/expired token instead of a broad error", () => {
  // scope: from the function start through just past the fetch — covers the auth-error
  // helper (defined before the handler) and the 401 branch (right after the fetch)
  const region = src.slice(fnStart, callIdx + 1500);
  assert.match(region, /401/, "must special-case HTTP 401 from the auth middleware");
  assert.match(region, /เข้าสู่ระบบ/, "must show the user a re-login prompt (Thai)");
});
