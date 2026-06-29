// Phase 543 (audit S14) — SlipOK API key must live server-side, never in the browser
// Run: node --test tests/slipok_secret_proxy_guard.test.js
//
// BUG: customer_dashboard _verifySlip read bsk_slipok_key from localStorage and called
//   api.slipok.com directly with `x-authorization: <key>` → the shop's SlipOK key was exposed in
//   the browser (localStorage + Network tab). FIX: a server-side proxy /api/verify-slipok holds the
//   key in Cloudflare env; the browser calls the proxy with its session JWT.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
// strip // line + /* */ block comments so explainer comments ("เลิกอ่าน bsk_slipok_key …") don't
// trip the "must not contain" assertions — only flag the strings in actual CODE.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const CD = stripComments(read("modules/customer_dashboard.js"));
const PAY = read("modules/settings/payment.js");
const PAGES = read("modules/settings/pages.js");
const FN = read("functions/api/verify-slipok.js");
const MW = read("functions/_middleware.js");

// ───────────────────────────────────────────────
// 1. browser no longer holds the key / hits SlipOK directly
// ───────────────────────────────────────────────

test("customer_dashboard: no SlipOK key in localStorage, no direct api.slipok.com call", () => {
  assert.ok(!/bsk_slipok_key/.test(CD), "must not read the SlipOK key from localStorage");
  assert.ok(!/api\.slipok\.com/.test(CD), "must not call api.slipok.com from the browser");
  assert.ok(!/x-authorization/i.test(CD), "must not send the SlipOK x-authorization header from the browser");
});

test("customer_dashboard: _verifySlip calls the proxy with the session JWT", () => {
  const i = CD.indexOf("async function _verifySlip");
  const body = CD.slice(i, i + 1400);
  assert.match(body, /fetch\(\s*["']\/api\/verify-slipok["']/, "must POST to /api/verify-slipok");
  assert.match(body, /Authorization["']?\s*:\s*["']Bearer ["']\s*\+\s*token/, "must send Authorization: Bearer <jwt>");
  assert.match(body, /window\._sbAccessToken/, "must use the session access token");
});

test("settings/payment.js: never writes the key, and cleans the legacy key up", () => {
  assert.ok(!/localStorage\.setItem\(\s*["']bsk_slipok_key["']/.test(PAY), "must NOT store the SlipOK key in localStorage");
  assert.match(PAY, /localStorage\.removeItem\(\s*["']bsk_slipok_key["']\)/, "must clean up the legacy key");
  assert.ok(!/id="setSlipOkKey"/.test(PAY), "the API-key input must be gone (env instructions instead)");
});

test("settings/pages.js: config restore must not re-introduce the key; export already omits it", () => {
  assert.match(PAGES, /_RESTORE_DENY[\s\S]{0,120}bsk_slipok_key/, "restore must deny-list bsk_slipok_key");
  // export object must not READ the key (a comment may mention it — only flag actual export of it)
  const exp = PAGES.slice(PAGES.indexOf("local_storage: {"), PAGES.indexOf("local_storage: {") + 600);
  assert.ok(!/getItem\(\s*["']bsk_slipok_key["']/.test(exp), "config export must not read/include the SlipOK key");
  assert.ok(!/bsk_slipok_key\s*:/.test(exp), "config export must not have a bsk_slipok_key field");
});

// ───────────────────────────────────────────────
// 2. the server function: key from env, sanitized output
// ───────────────────────────────────────────────

test("function verify-slipok: reads SLIPOK_API_KEY from env, no hardcoded key, no raw leak", () => {
  assert.match(FN, /context\.env\??\.SLIPOK_API_KEY/, "must read the key from env");
  assert.ok(!/SLIPOK-[A-Za-z0-9]/.test(FN), "must not hardcode a SlipOK key");
  assert.ok(!/\braw\b\s*:/.test(FN), "must not return a raw upstream body field");
  assert.match(FN, /logServerError\(/, "must log upstream detail server-side (sanitizer)");
  assert.match(FN, /x-authorization/i, "the key is sent to SlipOK server-side (only here)");
});

test("middleware: /api/verify-slipok is auth-required and rate-limited (not anon)", () => {
  assert.match(MW, /REQUIRE_AUTH_ENDPOINTS[\s\S]*"\/api\/verify-slipok"/, "must require a JWT");
  assert.match(MW, /"\/api\/verify-slipok":\s*\{\s*limit:/, "must have a rate-limit entry");
  // must NOT be staff-only (customer dashboard uses a customer JWT)
  const so = MW.slice(MW.indexOf("STAFF_ONLY_ENDPOINTS"), MW.indexOf("STAFF_ONLY_ENDPOINTS") + 400);
  assert.ok(!/verify-slipok/.test(so), "must not be staff-only — customers verify their own slip");
});

// ───────────────────────────────────────────────
// 3. behavioral — function shape + sanitization
// ───────────────────────────────────────────────

const { onRequestPost } = await import("../functions/api/verify-slipok.js");
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("behavioral: no SLIPOK_API_KEY env → graceful no_api (configured:false), never crashes", async () => {
  const resp = await onRequestPost({ env: {}, request: { json: async () => ({ image: TINY_PNG }) } });
  const body = await resp.json();
  assert.equal(body.error, "no_api");
  assert.equal(body.configured, false);
});

test("behavioral: valid slip → normalized result, NO raw, and the key never appears in the response", async () => {
  const SECRET = "SLIPOK-supersecret-123";
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // proves the key goes to SlipOK server-side only
    assert.equal(init.headers["x-authorization"], SECRET, "function sends the env key to SlipOK");
    assert.match(String(url), /api\.slipok\.com\/api\/line\/apikey\/0/);
    return { ok: true, status: 200, text: async () => JSON.stringify({
      success: true, data: { amount: 250, sender: { name: "ลูกค้า" }, receiver: { name: "ร้าน" }, transRef: "TX1", transDate: "2026-06-29" }
    }) };
  };
  try {
    const resp = await onRequestPost({
      env: { SLIPOK_API_KEY: SECRET },
      request: { json: async () => ({ image: TINY_PNG, expected_amount: 250 }) }
    });
    const text = await resp.clone().text();
    const body = await resp.json();
    assert.equal(body.valid, true);
    assert.equal(body.amountMatch, true);
    assert.equal(body.amount, 250);
    assert.equal(body.sender, "ลูกค้า");
    assert.equal(body.raw, undefined, "must not include the raw upstream body");
    assert.ok(!text.includes(SECRET), "the SlipOK key must never appear in the client response");
  } finally { globalThis.fetch = origFetch; }
});

test("behavioral: malformed image → bad_image 400, no upstream call", async () => {
  let called = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => "{}" }; };
  try {
    const resp = await onRequestPost({
      env: { SLIPOK_API_KEY: "k" },
      request: { json: async () => ({ image: "not-a-data-url" }) }
    });
    assert.equal(resp.status, 400);
    assert.equal((await resp.json()).error, "bad_image");
    assert.equal(called, false, "must not call SlipOK with a bad image");
  } finally { globalThis.fetch = origFetch; }
});
