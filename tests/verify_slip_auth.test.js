// Phase 92.66 — verify-slip (SlipOK) auth regression guard
// Run: node --test tests/verify_slip_auth.test.js
//
// Why this exists:
//   /api/verify-slip is listed in REQUIRE_AUTH_ENDPOINTS (functions/_middleware.js,
//   Phase 89.14). The global middleware (verifyAuthToken) rejects the request with
//   HTTP 401 unless it carries a real Supabase user JWT in `Authorization: Bearer <token>`.
//   Four client call sites POSTed the slip with only Content-Type and no token, so SlipOK
//   payment-slip verification died with 401 before reaching the server.
//
//   These are source-level assertions because the verify functions are module-internal
//   and DOM-bound (same guard pattern as tests/expenses_autokey_auth.test.js). They are
//   scoped to each verify function so an unrelated change elsewhere can't mask a regression.
//   This is a money path (CLAUDE.md §4.1/§4.4) — every slip-verify caller must require auth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __d = path.dirname(fileURLToPath(import.meta.url));

// Each client call site that POSTs to /api/verify-slip, with the marker that opens its
// verify function. fnMarker must be unique vs. the call site (e.g. `_verifySlip(` call).
const SITES = [
  { label: "main.js _verifySlip (service drawer)", rel: ["..", "main.js"],                    fnMarker: "function _verifySlip" },
  { label: "service_form.js _doVerifySlip",         rel: ["..", "modules", "service_form.js"], fnMarker: "_doVerifySlip = async" },
  { label: "ac_install.js _verifyAcSlip",           rel: ["..", "modules", "ac_install.js"],   fnMarker: "_verifyAcSlip = async" },
  { label: "solar.js _verifySolSlip",               rel: ["..", "modules", "solar.js"],        fnMarker: "_verifySolSlip = async" },
];

for (const site of SITES) {
  const src = readFileSync(path.join(__d, ...site.rel), "utf8");
  const fnStart = src.indexOf(site.fnMarker);
  const callIdx = src.indexOf('fetch("/api/verify-slip"', fnStart);
  const preCall = fnStart === -1 ? "" : src.slice(fnStart, callIdx);
  const fetchBlock = callIdx === -1 ? "" : src.slice(callIdx, callIdx + 400);
  const region = fnStart === -1 ? "" : src.slice(fnStart, callIdx + 1500);

  test(`[${site.label}] setup: verify fn calls /api/verify-slip`, () => {
    assert.ok(fnStart !== -1, `expected ${site.fnMarker} in source`);
    assert.ok(callIdx !== -1, "expected a fetch to /api/verify-slip inside the verify fn");
  });

  test(`[${site.label}] request carries a Supabase JWT (Authorization: Bearer)`, () => {
    assert.match(fetchBlock, /Authorization/, "verify-slip must send an Authorization header");
    assert.match(fetchBlock, /Bearer/, "Authorization must be a Bearer token");
  });

  test(`[${site.label}] bearer token sourced from the logged-in user JWT (window._sbAccessToken)`, () => {
    assert.match(preCall, /window\._sbAccessToken/,
      "token must come from window._sbAccessToken (the logged-in user JWT)");
  });

  test(`[${site.label}] does NOT fall back to anonKey (publishable key is not a JWT → 401)`, () => {
    assert.ok(!/anonKey/.test(fetchBlock), "the request headers must not reference anonKey");
    assert.ok(!/_sbAccessToken\s*\|\|\s*[\w.]*anonKey/.test(preCall),
      "must not `_sbAccessToken || cfg.anonKey` — middleware verifyAuthToken requires a 3-part JWT");
  });

  test(`[${site.label}] guards the missing-token case before the network call (fail fast)`, () => {
    assert.match(preCall, /!\s*_slipToken/, "must early-out when there is no access token");
  });

  test(`[${site.label}] prompts re-login on a missing/expired token instead of a broad error`, () => {
    assert.match(region, /401/, "must special-case HTTP 401 from the auth middleware");
    assert.match(region, /เข้าสู่ระบบ/, "must show the user a re-login prompt (Thai)");
  });
}
