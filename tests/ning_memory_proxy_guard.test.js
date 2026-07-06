// ning-memory proxy API guard (Phase 569).
// Run: node --test tests/ning_memory_proxy_guard.test.js
//
// The Ning bot no longer holds the Supabase service-role key — it calls these three
// proxy endpoints with X-NING-AGENT-KEY. These guards lock the security invariants:
//  - all three paths are auth-required AND Ning-agent gated AND rate-limited in middleware
//  - each endpoint refuses anything but authMode==="ning_agent" and needs a service-role key
//  - remember computes text_hash server-side (never from client) and never leaks it back
//  - recall filters by user_id only, with a fixed select/order and a clamped limit
//  - forget-all NEVER issues a DELETE without a user_id=eq.<value> filter
//  - errors are sanitized (logServerError/clientError), never raw detail to the client

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import * as remember from "../functions/api/v1/ning-memory/remember.js";
import * as recall from "../functions/api/v1/ning-memory/recall.js";
import * as forgetAll from "../functions/api/v1/ning-memory/forget-all.js";

const MW_SRC = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");
const REMEMBER_SRC = fs.readFileSync(path.resolve("functions/api/v1/ning-memory/remember.js"), "utf8");
const RECALL_SRC = fs.readFileSync(path.resolve("functions/api/v1/ning-memory/recall.js"), "utf8");
const FORGET_SRC = fs.readFileSync(path.resolve("functions/api/v1/ning-memory/forget-all.js"), "utf8");

const PATHS = [
  "/api/v1/ning-memory/remember",
  "/api/v1/ning-memory/recall",
  "/api/v1/ning-memory/forget-all",
];

test("all three memory paths are wired into REQUIRE_AUTH + NING_AGENT + RATE_LIMITS", () => {
  for (const p of PATHS) {
    const esc = p.replace(/[/-]/g, (m) => "\\" + m);
    assert.match(MW_SRC, new RegExp(`REQUIRE_AUTH_ENDPOINTS[\\s\\S]*"${esc}"`), `${p} must require auth`);
    assert.match(MW_SRC, new RegExp(`NING_AGENT_ENDPOINTS[\\s\\S]*"${esc}"`), `${p} must be Ning-agent gated`);
    assert.match(MW_SRC, new RegExp(`RATE_LIMITS[\\s\\S]*"${esc}"`), `${p} must be rate-limited`);
  }
  // recall is the hot path — its limit must be the generous one, not a stray 20/30.
  assert.match(MW_SRC, /"\/api\/v1\/ning-memory\/recall":\s*{\s*limit:\s*120/);
});

test("each endpoint exports only its intended HTTP handler", () => {
  assert.equal(typeof remember.onRequestPost, "function");
  assert.equal(remember.onRequestGet, undefined);
  assert.equal(typeof recall.onRequestGet, "function");
  assert.equal(recall.onRequestPost, undefined);
  assert.equal(typeof forgetAll.onRequestPost, "function");
  assert.equal(forgetAll.onRequestGet, undefined);
});

test("getSupabaseAuth on every endpoint requires ning_agent + a service-role key (no public fallback)", () => {
  for (const mod of [remember, recall, forgetAll]) {
    // wrong authMode → 403
    assert.equal(
      mod.getSupabaseAuth({ env: { SUPABASE_SERVICE_ROLE_KEY: "k" }, data: { user: { role: "owner" } } }).status,
      403
    );
    // ning_agent but no key → 500
    assert.equal(
      mod.getSupabaseAuth({ env: {}, data: { user: { authMode: "ning_agent" } } }).status,
      500
    );
    // both present → ok, Bearer service-role
    const ok = mod.getSupabaseAuth({ env: { SUPABASE_SERVICE_ROLE_KEY: "service-token" }, data: { user: { authMode: "ning_agent" } } });
    assert.equal(ok.ok, true);
    assert.equal(ok.authHeader, "Bearer service-token");
  }
  for (const src of [REMEMBER_SRC, RECALL_SRC, FORGET_SRC]) {
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|/, "service role must not fall back to a public key");
  }
});

test("remember: text_hash is sha256(text) hex and matches Python hashlib.sha256", async () => {
  // Known vector: sha256("hello") — same value Python's hashlib.sha256(b"hello").hexdigest() returns.
  assert.equal(
    await remember.sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  );
  const sample = "ชอบกาแฟดำ";
  const nodeHash = crypto.createHash("sha256").update(sample, "utf8").digest("hex");
  assert.equal(await remember.sha256Hex(sample), nodeHash, "must match a standard sha256 of the utf-8 bytes");
});

test("remember: computes text_hash server-side and never reads id/created_at/text_hash from the client body", () => {
  // Only userId/text/tags are pulled off the request body.
  assert.match(REMEMBER_SRC, /body\?\.userId/);
  assert.match(REMEMBER_SRC, /body\?\.text\b/);
  assert.match(REMEMBER_SRC, /body\?\.tags/);
  assert.doesNotMatch(REMEMBER_SRC, /body\?\.(text_hash|id|created_at)/, "must not accept server-owned fields from client");
  // text_hash is derived, not passed through
  assert.match(REMEMBER_SRC, /text_hash:\s*textHash/);
  assert.match(REMEMBER_SRC, /sha256Hex\(text\)/);
  assert.match(REMEMBER_SRC, /crypto\.subtle\.digest\(\s*["']SHA-256["']/);
  // the returned fact never carries text_hash
  const fact = remember.toFact({ id: "1", user_id: "u", text: "t", created_at: "c", tags: ["a"], text_hash: "SECRET" });
  assert.deepEqual(Object.keys(fact).sort(), ["created_at", "id", "tags", "text", "user_id"]);
  assert.equal("text_hash" in fact, false);
});

test("remember: normalizeTags enforces string-only, count<=20, len<=64", () => {
  assert.deepEqual(remember.normalizeTags(["a", " b ", "c"]), ["a", "b", "c"]);
  assert.deepEqual(remember.normalizeTags("nope"), []);
  assert.deepEqual(remember.normalizeTags([1, true, {}, "ok"]), ["ok"]);
  assert.equal(remember.normalizeTags(Array.from({ length: 50 }, (_, i) => "t" + i)).length, 20);
  assert.equal(remember.normalizeTags(["x".repeat(200)])[0].length, 64);
});

test("recall: limit clamps to 1-50 (default 5) and query is user_id-scoped with fixed select/order", () => {
  assert.equal(recall.clampLimit(null), 5);
  assert.equal(recall.clampLimit("abc"), 5);
  assert.equal(recall.clampLimit("0"), 1);
  assert.equal(recall.clampLimit("999"), 50);
  assert.equal(recall.clampLimit("7"), 7);
  // fixed, server-controlled query — no arbitrary select/filter/order taken from the request
  assert.match(RECALL_SRC, /user_id=eq\.\$\{encodeURIComponent\(userId\)\}/);
  assert.match(RECALL_SRC, /order=created_at\.desc/);
  assert.doesNotMatch(RECALL_SRC, /searchParams\.get\(\s*["'](select|order|filter|table)["']/, "must not read select/order/filter from request");
});

test("forget-all: validates userId then ALWAYS deletes with a user_id=eq. filter — never the whole table", () => {
  // userId is validated before any fetch/DELETE
  assert.match(FORGET_SRC, /userId\.length\s*<\s*1[\s\S]*return[\s\S]*400/);
  // the DELETE url is built with the user_id=eq. filter
  assert.match(FORGET_SRC, /deleteUrl\s*=\s*`\$\{rest\}\?user_id=eq\.\$\{encodeURIComponent\(userId\)\}`/);
  // and the DELETE fetch uses that filtered url (not the bare rest endpoint)
  assert.match(FORGET_SRC, /fetch\(\s*deleteUrl\s*,[\s\S]*method:\s*"DELETE"/);
  // there is no DELETE issued against the bare table without a filter
  assert.doesNotMatch(FORGET_SRC, /fetch\(\s*rest\s*,[\s\S]*"DELETE"/, "must not DELETE the unfiltered table endpoint");
  assert.doesNotMatch(FORGET_SRC, /fetch\(\s*`\$\{rest\}`\s*,[\s\S]*"DELETE"/, "must not DELETE the unfiltered table endpoint");
});

test("all endpoints sanitize errors — logServerError/clientError, never raw detail to the client", () => {
  for (const src of [REMEMBER_SRC, RECALL_SRC, FORGET_SRC]) {
    assert.match(src, /import\s*{\s*logServerError,\s*clientError\s*}\s*from\s*["']\.\.\/\.\.\/_error_sanitizer\.js["']/,
      "must import the shared sanitizer from ../../ (two levels up)");
    assert.match(src, /logServerError\(/);
    assert.match(src, /clientError\(/);
    // never return the raw exception message straight to the client
    assert.doesNotMatch(src, /error:\s*e\.message/, "must not leak exception message to client");
  }
});
