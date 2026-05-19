// Phase 89.42 — Regression tests for OTP request/verify guards (Site 3)
//
// Bug scenario being prevented (MEDIUM_RISK from Phase 89.40 audit):
//   1. User opens customer login → กรอกเบอร์ → "ขอ OTP"
//   2. User receives SMS code → กรอก OTP → double-tap "ยืนยัน"
//   3. handler A: POSTs /api/verify-otp, awaits ~400ms response
//   4. handler B enters before A's "_pendingOtp.attempts++" runs
//      → both pass the `if (!_pendingOtp) return` gate at line 129
//      → both increment attempts (off-by-one against 5-attempt limit)
//      → both POST /api/verify-otp (consuming 2 OTP attempts on server)
//      → race on `_pendingOtp.authPassword = verifyData.authPassword` (line 158)
//      → race on `_pendingOtp = null` reset (line 219) — A may try to use
//        a null reference after B has reset it
//
// Symmetric risk for requestOtp:
//   The 60s cooldown is set AFTER a successful send (line 105). At t=0
//   two concurrent "ขอ OTP" presses both bypass isOtpCooldownActive()
//   and both POST /api/send-otp, hitting server rate-limit (429) on the
//   2nd request — UI then locks for 5 minutes for what user perceived
//   as one click.
//
// Fix: wrap requestOtp + verifyOtp bodies in independent guards from
// modules/_inflight_guard.js. They're independent because a refresh of
// the SMS while staring at the OTP input is a legitimate concurrent flow.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInflightGuard } from "../modules/_inflight_guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const otpSrc = readFileSync(path.join(__dirname, "..", "modules", "auth_otp.js"), "utf8");

// ── Integration: production code actually uses the helper ────────────
test("auth_otp.js: imports createInflightGuard from _inflight_guard helper", () => {
  assert.match(
    otpSrc,
    /import\s+\{[^}]*createInflightGuard[^}]*\}\s+from\s+["']\.\/_inflight_guard\.js["']/,
    "auth_otp.js must import createInflightGuard so OTP flows can be guarded",
  );
});

test("auth_otp.js: declares _verifyOtpGuard for the verify flow", () => {
  assert.match(
    otpSrc,
    /const\s+_verifyOtpGuard\s*=\s*createInflightGuard\(\)/,
    "auth_otp.js must declare _verifyOtpGuard inside the factory (per-instance)",
  );
});

test("auth_otp.js: declares _requestOtpGuard for the send flow", () => {
  assert.match(
    otpSrc,
    /const\s+_requestOtpGuard\s*=\s*createInflightGuard\(\)/,
    "auth_otp.js must declare _requestOtpGuard (independent — refreshing SMS while typing OTP is a legitimate concurrent flow)",
  );
});

test("auth_otp.js verifyOtp: body routes through _verifyOtpGuard.run()", () => {
  assert.match(
    otpSrc,
    /_verifyOtpGuard\.run\s*\(/,
    "verifyOtp body must be wrapped in _verifyOtpGuard.run(...)",
  );
});

test("auth_otp.js requestOtp: body routes through _requestOtpGuard.run()", () => {
  assert.match(
    otpSrc,
    /_requestOtpGuard\.run\s*\(/,
    "requestOtp body must be wrapped in _requestOtpGuard.run(...)",
  );
});

// ── Behavioral contract: scenarios specific to OTP flows ─────────
test("verify guard contract: double-tap ยืนยัน → only 1 POST /api/verify-otp", async () => {
  const guard = createInflightGuard();
  const serverCalls = [];
  const fakeVerify = async () => {
    // mimic /api/verify-otp latency (~400ms typical Twilio path)
    await new Promise((res) => setTimeout(res, 30));
    serverCalls.push({ endpoint: "/api/verify-otp" });
    return { ok: true };
  };
  const [r1, r2] = await Promise.all([guard.run(fakeVerify), guard.run(fakeVerify)]);
  assert.equal(serverCalls.length, 1, "double-tap must collapse to 1 server call (don't burn 2 of the 5 attempts)");
  assert.deepEqual(r1, { ok: true });
  assert.equal(r2, undefined, "2nd tap silently skips — no spurious 'OTP ไม่ถูกต้อง' toast");
});

test("request guard contract: double-tap ขอ OTP → only 1 POST /api/send-otp (no 429 lock-out)", async () => {
  const guard = createInflightGuard();
  const smsSent = [];
  const fakeSend = async () => {
    await new Promise((res) => setTimeout(res, 30));
    smsSent.push({ to: "+66800000001" });
    return { ok: true };
  };
  const [r1, r2] = await Promise.all([guard.run(fakeSend), guard.run(fakeSend)]);
  assert.equal(smsSent.length, 1, "before cooldown engages, double-tap must not 2x the SMS POST");
  assert.deepEqual(r1, { ok: true });
  assert.equal(r2, undefined);
});

test("OTP guards are independent — refreshing OTP while verifying must work", async () => {
  const verifyGuard = createInflightGuard();
  const requestGuard = createInflightGuard();
  let verifies = 0;
  let requests = 0;
  const slowVerify = () => new Promise((res) => setTimeout(() => { verifies++; res("verified"); }, 50));
  const fastRequest = () => new Promise((res) => setTimeout(() => { requests++; res("sent"); }, 10));
  // User is mid-verify (slow) when they decide to ขอ OTP ใหม่ — must not be blocked by verify guard
  const [vRes, rRes] = await Promise.all([verifyGuard.run(slowVerify), requestGuard.run(fastRequest)]);
  assert.equal(verifies, 1, "verify still runs");
  assert.equal(requests, 1, "request runs in parallel (different guard)");
  assert.equal(vRes, "verified");
  assert.equal(rRes, "sent");
});

test("verify guard: server reject (e.g. 429) releases lock so user can retry", async () => {
  const guard = createInflightGuard();
  await assert.rejects(
    () => guard.run(async () => { throw new Error("429 — too many OTP attempts"); }),
    /429/,
  );
  // User waits, ขอ OTP ใหม่, tries again
  const r = await guard.run(async () => "retry-ok");
  assert.equal(r, "retry-ok", "after rate-limit error, lock auto-releases for legitimate retry");
});
