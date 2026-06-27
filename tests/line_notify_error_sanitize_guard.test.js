// Phase 535 (S4) — /api/line-notify must not leak the upstream LINE error body to the client
// Run: node --test tests/line_notify_error_sanitize_guard.test.js
//
// Bug: on a failed LINE push the function did `detail = await resp.text()` and returned it in
//   results[].detail, plus the recipient id in results[].to. A staff browser then saw the raw
//   upstream body (quota / token state / request diagnostics) and the configured recipient id.
// Fix (Phase 516 sanitizer philosophy): log the full body SERVER-side (Cloudflare logs) and
//   return only a generic per-recipient result (HTTP status + ok) — no `detail`, no `to`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { onRequestPost } = await import("../functions/api/line-notify.js");
const SRC = fs.readFileSync(path.resolve("functions/api/line-notify.js"), "utf8");

function makeRes(status, body, text = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

// ───────────────────────────────────────────────
// 1. Behavioral — raw upstream body + recipient id never reach the client
// ───────────────────────────────────────────────

test("failed LINE push: upstream body + recipient id are NOT in the client response (but logged server-side)", async () => {
  const SENSITIVE = "QUOTA_EXCEEDED token_state=xyz internal_req_id=abc123 detail-leak";
  const RECIPIENT = "U0123456789abcdefRECIPIENTSECRET";

  const logged = [];
  const origErr = console.error;
  console.error = (...a) => { logged.push(a); };

  globalThis.fetch = async (url) => {
    if (String(url).includes("api.line.me")) {
      return makeRes(400, { message: SENSITIVE }, JSON.stringify({ message: SENSITIVE }));
    }
    return makeRes(200, {});
  };

  let respText;
  try {
    const resp = await onRequestPost({
      request: { json: async () => ({ message: "hello" }) },
      env: { LINE_CHANNEL_ACCESS_TOKEN: "tok-secret", LINE_USER_ID: RECIPIENT },
    });
    assert.equal(resp.status, 502, "all-failed push → 502");
    const body = await resp.json();
    respText = JSON.stringify(body);
    // sanitized per-recipient result: status + ok only
    assert.ok(Array.isArray(body.results) && body.results.length === 1);
    assert.equal(body.results[0].ok, false);
    assert.equal(body.results[0].status, 400);
    assert.equal(body.results[0].detail, undefined, "must not return raw upstream detail");
    assert.equal(body.results[0].to, undefined, "must not return the recipient id");
  } finally {
    console.error = origErr;
    delete globalThis.fetch;
  }

  assert.ok(!respText.includes(SENSITIVE), "raw upstream body must not appear anywhere in client response");
  assert.ok(!respText.includes(RECIPIENT), "recipient id must not appear anywhere in client response");
  assert.ok(logged.some((a) => JSON.stringify(a).includes(SENSITIVE)),
    "full upstream body must still be logged server-side (logServerError → console.error)");
});

test("successful push still returns a clean result (status + ok, no recipient id)", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.line.me")) return makeRes(200, {});
    return makeRes(200, {});
  };
  try {
    const resp = await onRequestPost({
      request: { json: async () => ({ message: "hi" }) },
      env: { LINE_CHANNEL_ACCESS_TOKEN: "tok", LINE_USER_ID: "Uabc" },
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.results[0].to, undefined, "recipient id must not leak even on success");
    assert.equal(body.results[0].detail, undefined);
  } finally {
    delete globalThis.fetch;
  }
});

// ───────────────────────────────────────────────
// 2. Source — lock the sink so it can't regress
// ───────────────────────────────────────────────

test("source: results.push carries no raw detail / recipient id, and the body is logged server-side", () => {
  assert.ok(!/results\.push\([^)]*\bdetail\b/.test(SRC), "results.push must not include raw upstream `detail`");
  assert.ok(!/results\.push\([^)]*\bto\b/.test(SRC), "results.push must not include the recipient `to`");
  assert.match(SRC, /logServerError\([^)]*detail/, "the full upstream body must be logged server-side");
  // the real send path is untouched (still pushes per-recipient status + ok)
  assert.match(SRC, /results\.push\(\s*\{\s*status:\s*resp\.status,\s*ok:\s*resp\.ok\s*\}\s*\)/,
    "client result must be HTTP status + ok only");
});
