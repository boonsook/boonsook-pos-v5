// Phase 92.27 — Unit tests for modules/_offline_queue.js pure helpers
// (only pure functions tested — IndexedDB ops are integration, smoke in browser)
import { test } from "node:test";
import assert from "node:assert/strict";

const { isOfflineLike, generateClientUuid } = await import("../modules/_offline_queue.js");

// ── isOfflineLike ───────────────────────────────────────────

test("isOfflineLike — TypeError 'Failed to fetch' → true", () => {
  const err = new TypeError("Failed to fetch");
  assert.equal(isOfflineLike(err), true);
});

test("isOfflineLike — Error message contains 'network' → true", () => {
  assert.equal(isOfflineLike(new Error("network error: offline")), true);
});

test("isOfflineLike — generic Error (HTTP 500 etc.) → false", () => {
  assert.equal(isOfflineLike(new Error("HTTP 500: server error")), false);
});

test("isOfflineLike — null/undefined → false (no navigator.onLine in node)", () => {
  // node test env has no navigator.onLine, so without an error → false
  assert.equal(isOfflineLike(null), false);
  assert.equal(isOfflineLike(undefined), false);
});

// ── generateClientUuid ──────────────────────────────────────

test("generateClientUuid — returns UUID v4-shaped string", () => {
  const u = generateClientUuid();
  assert.equal(typeof u, "string");
  // v4 pattern: 8-4-4-4-12 hex, version=4, variant=8/9/a/b
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("generateClientUuid — 2 calls → ค่าต่างกัน (uniqueness sanity)", () => {
  const a = generateClientUuid();
  const b = generateClientUuid();
  assert.notEqual(a, b);
});

test("generateClientUuid — 100 calls = 100 unique values", () => {
  const set = new Set();
  for (let i = 0; i < 100; i++) set.add(generateClientUuid());
  assert.equal(set.size, 100);
});
