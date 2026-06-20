// Phase 510 — server-side OTP verify attempt cap guard
// Run: node --test tests/verify_otp_attempt_cap_guard.test.js
//
// เดิม attempt cap อยู่ฝั่ง client (_pendingOtp.attempts) bypass ได้ (refresh/แก้ state);
// server /api/verify-otp stateless. เฟสนี้เพิ่ม server-side cap ต่อ "issued OTP" 5 ครั้ง → lock 429.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { onRequestPost } from "../functions/api/verify-otp.js";

const SECRET = "unit-test-otp-secret-xyz";
const PHONE = "0812345678";

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k) { const v = store.get(k); return v === undefined ? null : v; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function ctx(body, env) {
  return { request: { json: async () => body }, env };
}

async function call(body, env) {
  const res = await onRequestPost(ctx(body, env));
  const json = await res.json();
  return { status: res.status, json };
}

async function issued(code, expiresAt) {
  return { phone: PHONE, code, hash: await hmacHex(SECRET, `${PHONE}:${code}:${expiresAt}`), expiresAt };
}

test("correct OTP → 200 + authPassword, and the attempt key is cleared", async () => {
  const kv = makeKV();
  const env = { OTP_SECRET: SECRET, RATE_LIMIT_KV: kv };
  const exp = Date.now() + 5 * 60 * 1000;
  const good = await issued("123456", exp);
  const { status, json } = await call(good, env);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.match(json.authPassword, /^bsk_/);
  assert.equal(kv.store.size, 0, "success must not leave an attempt key behind");
});

test("5 wrong attempts lock the OTP (429), and a correct code is then rejected while locked", async () => {
  const kv = makeKV();
  const env = { OTP_SECRET: SECRET, RATE_LIMIT_KV: kv };
  const exp = Date.now() + 5 * 60 * 1000;
  const good = await issued("123456", exp);
  const wrong = { phone: PHONE, code: "000000", hash: good.hash, expiresAt: exp }; // attacker: real hash, wrong code

  for (let i = 1; i <= 4; i++) {
    const { status, json } = await call(wrong, env);
    assert.equal(status, 400, `attempt ${i} should be a plain rejection`);
    assert.equal(json.remaining, 5 - i, `attempt ${i} should report remaining`);
  }
  const fifth = await call(wrong, env);
  assert.equal(fifth.status, 429, "5th wrong attempt must lock");
  assert.equal(fifth.json.locked, true);

  // locked → even the CORRECT code must not pass
  const afterLock = await call(good, env);
  assert.equal(afterLock.status, 429, "correct code must be rejected while locked");
  assert.notEqual(afterLock.json.ok, true);
});

test("a success before the limit resets the counter (attempts start fresh afterwards)", async () => {
  const kv = makeKV();
  const env = { OTP_SECRET: SECRET, RATE_LIMIT_KV: kv };
  const exp = Date.now() + 5 * 60 * 1000;
  const good = await issued("123456", exp);
  const wrong = { phone: PHONE, code: "000000", hash: good.hash, expiresAt: exp };

  const w1 = await call(wrong, env);
  assert.equal(w1.json.remaining, 4, "one wrong → 4 remaining");
  const ok = await call(good, env);
  assert.equal(ok.status, 200, "correct code passes");
  const w2 = await call(wrong, env);
  assert.equal(w2.json.remaining, 4, "after success the counter reset (4 remaining again)");
});

test("expired OTP → 400 and creates NO attempt key", async () => {
  const kv = makeKV();
  const env = { OTP_SECRET: SECRET, RATE_LIMIT_KV: kv };
  const exp = Date.now() - 1000; // already expired
  const good = await issued("123456", exp);
  const { status } = await call(good, env);
  assert.equal(status, 400);
  assert.equal(kv.store.size, 0, "expired OTP must not persist an attempt key");
});

test("missing KV binding fails CLOSED (503) — never silently allows verify", async () => {
  const env = { OTP_SECRET: SECRET }; // no RATE_LIMIT_KV
  const exp = Date.now() + 5 * 60 * 1000;
  const good = await issued("123456", exp);
  const { status, json } = await call(good, env);
  assert.equal(status, 503, "without the attempt store, verify must fail closed (not 200)");
  assert.notEqual(json.ok, true);
});

test("attempt store key/value contains NO raw OTP code", async () => {
  const kv = makeKV();
  const env = { OTP_SECRET: SECRET, RATE_LIMIT_KV: kv };
  const exp = Date.now() + 5 * 60 * 1000;
  const good = await issued("123456", exp);
  await call({ phone: PHONE, code: "654321", hash: good.hash, expiresAt: exp }, env); // one wrong
  assert.equal(kv.store.size, 1);
  for (const [k, v] of kv.store) {
    assert.match(k, /^otpatt:[0-9a-f]+$/, "key must be an opaque hashed token");
    assert.ok(!k.includes("654321") && !k.includes("123456"), "key must not embed a code");
    assert.match(String(v), /^\d+$/, "value is just a counter");
  }
});

test("source: verify-otp enforces a per-OTP SERVER store (not just client _pendingOtp.attempts)", () => {
  const src = fs.readFileSync(path.resolve("functions/api/verify-otp.js"), "utf8");
  assert.match(src, /RATE_LIMIT_KV/, "must read the KV attempt store");
  assert.match(src, /MAX_OTP_ATTEMPTS\s*=\s*5/, "cap must be 5");
  assert.match(src, /kv\.get\(/, "must load the count");
  assert.match(src, /kv\.put\(/, "must persist the incremented count");
  assert.match(src, /kv\.delete\(/, "must reset on success");
  assert.match(src, /status\s*429|}, 429\)/, "must return 429 when locked");
  assert.match(src, /fail-closed/i, "must document/fail-closed when the store is unavailable");
});

test("source: middleware keeps the coarse per-IP /api/verify-otp rate limit (NOT the attempt cap)", () => {
  const mw = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");
  assert.match(mw, /"\/api\/verify-otp":\s*\{\s*limit:/, "coarse per-IP rate limit must remain");
});
