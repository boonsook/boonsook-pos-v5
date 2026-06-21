// Phase 515 — Cloudflare Function error sanitizer (audit S4)
// Run: node --test tests/function_error_sanitizer_guard.test.js
//
// /api/parse-receipt and /api/verify-slip used to return raw internals on failure —
// JS stack traces, raw Gemini error bodies, model names, per-attempt dumps, Google
// promptFeedback. That is needless info-disclosure (recon aid) even behind auth. The
// fix: log full detail SERVER-side (logServerError → Cloudflare logs) and return only a
// generic message + a stable error code to the client (clientError).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clientError, logServerError } from "../functions/api/_error_sanitizer.js";

// ── Layer 1: the helper itself never carries internals ──────────────────────
test("clientError returns only ok/error/code (no stack/detail/raw/attempts)", () => {
  const b = clientError("internal_error", "เกิดข้อผิดพลาด");
  assert.deepEqual(b, { ok: false, error: "เกิดข้อผิดพลาด", code: "internal_error" });
  for (const k of ["stack", "detail", "raw", "attempts", "model", "promptFeedback", "parseError"]) {
    assert.ok(!(k in b), `client body must not carry "${k}"`);
  }
});

test("clientError passes through only whitelisted extras (e.g. hint, configured)", () => {
  const b = clientError("no_model_available", "ไม่มี model", { hint: "สร้าง key ใหม่" });
  assert.equal(b.hint, "สร้าง key ใหม่");
  assert.equal(b.ok, false);
  assert.equal(b.code, "no_model_available");
});

test("logServerError logs to console.error and NEVER throws", () => {
  const orig = console.error;
  const seen = [];
  console.error = (...a) => seen.push(a);
  try {
    logServerError("[x] label", "secret stack trace", { internal: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], "[x] label");
    assert.equal(seen[0][1], "secret stack trace");
  } finally {
    console.error = orig;
  }
  // even if console.error itself throws, logServerError must swallow it
  const orig2 = console.error;
  console.error = () => { throw new Error("logger down"); };
  try {
    assert.doesNotThrow(() => logServerError("[x]", "detail"));
  } finally {
    console.error = orig2;
  }
});

// ── Layer 2: the two functions no longer leak in their error responses ───────
const PR = fs.readFileSync(path.resolve("functions/api/parse-receipt.js"), "utf8");
const VS = fs.readFileSync(path.resolve("functions/api/verify-slip.js"), "utf8");

for (const [name, src] of [["parse-receipt", PR], ["verify-slip", VS]]) {
  test(`${name}: imports the shared sanitizer and logs server-side`, () => {
    assert.match(src, /import \{ logServerError, clientError \} from "\.\/_error_sanitizer\.js"/, "imports helper");
    assert.match(src, /logServerError\(/, "logs full detail server-side");
    assert.match(src, /clientError\(/, "returns sanitized client body");
  });

  test(`${name}: no stack / raw-message leak in catch blocks`, () => {
    assert.ok(!/stack: e\?\.stack/.test(src), "must not return e.stack to client");
    assert.ok(!/error: e\?\.message \|\| String\(e\)\s*\n\s*\}\), \{ status/.test(src), "top catch must not return raw e.message as the response error");
  });

  test(`${name}: no raw provider dump (detail/raw/attempts/promptFeedback) in responses`, () => {
    assert.ok(!/detail: errTxt\.slice/.test(src), "must not return raw Gemini body as detail");
    assert.ok(!/raw: text\.slice/.test(src), "must not return raw model output");
    // the leak was `promptFeedback: data?.promptFeedback` as a RESPONSE field — the helper
    // call may still mention the label string "promptFeedback:" for the server log, so target
    // the object-property form specifically.
    assert.ok(!/promptFeedback: data/.test(src), "must not return Google promptFeedback as a response field");
    // 'attempts' must not be a standalone returned field (it stays as a server-logged var)
    assert.ok(!/\n\s*attempts\s*\n\s*\}\), \{ status/.test(src), "must not return the attempts array to client");
  });
}

// genuinely user-facing fields are preserved (we did not over-strip)
test("parse-receipt keeps the operator hint + configured-state fields", () => {
  assert.match(PR, /\{ hint \}/, "keeps the API-key hint for the operator");
  assert.match(PR, /configured: false/, "keeps the not-configured signal");
});
