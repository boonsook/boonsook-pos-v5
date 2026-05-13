// Phase 89.18 — Unit tests for auto_post.js
// Covers: M1 voidJvForSource silent-fail detection (Phase 89.16) + effective date guard
// Run: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Setup global window before importing auto_post (module reads window at call-time, not import-time)
globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,         // overwritten per test
  App: { showToast: () => {} },
};

// Suppress noisy console.error / console.info inside voidJvForSource
const _origErr = console.error;
const _origInfo = console.info;
console.error = () => {};
console.info = () => {};

const { voidJvForSource, _isAfterEffective } = await import("../modules/accounting/auto_post.js");

function makeRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockAuthFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (queue.length === 0) throw new Error("queue exhausted: " + url);
    const next = queue.shift();
    if (typeof next === "function") return next(url, init);
    return next;
  };
  fn.calls = calls;
  fn.remaining = () => queue.length;
  return fn;
}

let toasts = [];
beforeEach(() => {
  toasts = [];
  window.App.showToast = (msg) => toasts.push(msg);
});

// ═══════════════════════════════════════════════════════════
//  voidJvForSource — Phase 89.16 (M1) silent-fail detection
// ═══════════════════════════════════════════════════════════

test("voidJv — happy path: pre-check 2 rows, DELETE returns 2, no toast", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 1 }, { id: 2 }]),         // pre-check count
    makeRes(200, [{ id: 1 }, { id: 2 }]),         // DELETE returning rows
  ]);
  const count = await voidJvForSource("sales", 42);
  assert.equal(count, 2);
  assert.equal(toasts.length, 0, "no warning toast on success");
});

test("voidJv — silent fail: pre-check finds 1 row but DELETE returns 0 rows → toast + return 0 (M1 fix)", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 99 }]),                   // pre-check: 1 JV exists
    makeRes(200, []),                              // DELETE: RLS blocked → 0 deleted (silent fail)
  ]);
  const count = await voidJvForSource("sales", 99);
  assert.equal(count, 0, "must report 0 to caller");
  assert.equal(toasts.length, 1, "must warn user about RLS silent fail");
  assert.match(toasts[0], /ลบไม่ได้|RLS|manually/);
});

test("voidJv — no JV exists: pre-check 0 rows, DELETE 0 rows → no toast (legitimate empty)", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, []),                              // pre-check: nothing
    makeRes(200, []),                              // DELETE: nothing
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 0);
  assert.equal(toasts.length, 0, "empty + empty is not a silent fail");
});

test("voidJv — DELETE HTTP error: returns 0, toast if expected>0", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 5 }]),                    // pre-check: 1 JV
    makeRes(500, null),                            // DELETE fails
  ]);
  const count = await voidJvForSource("sales", 5);
  assert.equal(count, 0);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /HTTP 500|ลบ JV/);
});

test("voidJv — DELETE HTTP error with no pre-existing JV: no toast", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, []),                              // pre-check: 0
    makeRes(500, null),                            // DELETE fails
  ]);
  const count = await voidJvForSource("sales", 5);
  assert.equal(count, 0);
  assert.equal(toasts.length, 0, "no warning when there was nothing to delete");
});

test("voidJv — missing args: returns 0 without any fetch", async () => {
  const fetcher = mockAuthFetch([]);
  window._appAuthFetch = fetcher;
  assert.equal(await voidJvForSource("", 1), 0);
  assert.equal(await voidJvForSource("sales", null), 0);
  assert.equal(await voidJvForSource(null, null), 0);
  assert.equal(fetcher.calls.length, 0, "no network call for bad args");
});

test("voidJv — sourceTable URL-encoded in filter (prevent injection)", async () => {
  let capturedUrl;
  window._appAuthFetch = mockAuthFetch([
    (url) => { capturedUrl = url; return makeRes(200, []); },
    makeRes(200, []),
  ]);
  await voidJvForSource("sales&injected=eq.true", 1);
  assert.match(capturedUrl, /source_table=eq\.sales%26injected%3Deq\.true/);
});

test("voidJv — pre-check exception is non-fatal, DELETE still runs", async () => {
  // pre-check throws (network error during count) — should fall through to DELETE
  window._appAuthFetch = mockAuthFetch([
    new Error("ECONNRESET"),
    makeRes(200, [{ id: 1 }]),
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 1, "DELETE proceeds even if pre-check failed");
});

test("voidJv — DELETE exception caught, returns 0", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 1 }]),
    new Error("socket hang up"),
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 0);
});

// ═══════════════════════════════════════════════════════════
//  _isAfterEffective — ACCOUNTING_EFFECTIVE_DATE = 2026-05-01
// ═══════════════════════════════════════════════════════════

test("_isAfterEffective — date >= 2026-05-01 returns true", () => {
  assert.equal(_isAfterEffective("2026-05-01"), true);
  assert.equal(_isAfterEffective("2026-05-13"), true);
  assert.equal(_isAfterEffective("2026-12-31"), true);
  assert.equal(_isAfterEffective("2027-01-01"), true);
});

test("_isAfterEffective — date < 2026-05-01 returns false (mock/test data)", () => {
  assert.equal(_isAfterEffective("2026-04-30"), false);
  assert.equal(_isAfterEffective("2026-01-01"), false);
  assert.equal(_isAfterEffective("2025-12-31"), false);
});

test("_isAfterEffective — null/undefined/empty → false", () => {
  assert.equal(_isAfterEffective(null), false);
  assert.equal(_isAfterEffective(undefined), false);
  assert.equal(_isAfterEffective(""), false);
  assert.equal(_isAfterEffective(0), false);
});

test("_isAfterEffective — ISO timestamp slice(0,10) extracts date part correctly", () => {
  assert.equal(_isAfterEffective("2026-05-01T00:00:00Z"), true);
  assert.equal(_isAfterEffective("2026-04-30T23:59:59Z"), false);
  assert.equal(_isAfterEffective("2026-05-13T15:30:00+07:00"), true);
});

// Restore console after all tests
process.on("beforeExit", () => {
  console.error = _origErr;
  console.info = _origInfo;
});
