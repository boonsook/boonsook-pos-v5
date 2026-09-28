// Phase 638 — guard: /api path canonicalization before auth + rate limit.
//
// ทำไมต้องมี: Cloudflare Pages route /api/* แบบไม่สนตัวพิมพ์และยอมสแลชท้าย แต่ middleware เคยเทียบ
// url.pathname กับรายการ endpoint แบบ string ตรงตัว → LIVE build 634 พิสูจน์ว่า
//   POST /api/LINE-notify  {"probe":true} → 200 (ข้าม auth)
//   POST /api/line-notify/ {"probe":true} → 200 (ข้าม auth)
// guard นี้ขับ onRequest / onRequestPost ตัวจริง (behavioral) — ไม่ใช่ regex บน source.
//
// ★ ข้อจำกัด: เทสต์นี้ "จำลอง" request เข้า middleware — ไม่พิสูจน์ว่า Cloudflare route path รูปไหน
//   เข้ามาถึง Functions จริง. ข้อสรุปว่าช่องปิดแล้วต้องรอหลักฐาน live probe หลัง deploy.
//
// ★ Baseline RED (ภาคผนวก v2 D2): เทสต์พฤติกรรม import เฉพาะ export ที่มีอยู่แล้วใน 05297a7
//   (onRequest + handler onRequestPost). helper `canonicalApiPath` ใหม่ ถูกอ่านผ่าน namespace
//   ในบล็อกของตัวเองเท่านั้น → โค้ดเก่าแดงที่ assertion ไม่ใช่ SyntaxError ตอน import.
//
// ไม่มี network: fetch ถูก stub — ตอบเฉพาะ Supabase profiles role lookup (จำลอง), อย่างอื่น throw.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as MW from "../functions/_middleware.js";

const { onRequest } = MW;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MW_SRC = fs.readFileSync(path.join(ROOT, "functions/_middleware.js"), "utf8");

// ── helpers ─────────────────────────────────────────────────────────────────
const JWT_SECRET = "phase638-test-secret-not-real-0123456789";
const NING_KEY = "phase638-ning-agent-test-key-0123456789";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function makeJwt(sub, { secret = JWT_SECRET } = {}) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub, email: `${sub}@example.test`, aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

// fetch stub: only the profiles role lookup is answered (role from `roles[userId]`); anything else throws.
async function withStubbedNetwork(roles, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const m = u.match(/\/rest\/v1\/profiles\?id=eq\.([^&]+)&select=role/);
    if (m && roles && decodeURIComponent(m[1]) in roles) {
      const role = roles[decodeURIComponent(m[1])];
      return new Response(JSON.stringify(role ? [{ role }] : []), { status: 200 });
    }
    throw new Error("network forbidden in api_path_canonical_guard: " + u);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = orig;
  }
}

async function drive(pathname, { method = "POST", env = {}, headers = {}, roles = null, ip = "203.0.113.7" } = {}) {
  return withStubbedNetwork(roles, async (fetchCalls) => {
    let nextCalls = 0;
    let userSeen;
    const request = new Request("https://boonsook-pos-v5.pages.dev" + pathname, {
      method,
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
      body: method === "POST" ? JSON.stringify({ probe: true }) : undefined,
    });
    const context = { request, env, data: {} };
    context.next = async () => {
      nextCalls++;
      userSeen = context.data?.user;
      return new Response("downstream", { status: 200 });
    };
    const resp = await onRequest(context);
    const nonRoleCalls = fetchCalls.filter((u) => !u.includes("/rest/v1/profiles"));
    return { resp, nextCalls, fetchCalls, nonRoleCalls, userSeen };
  });
}

// ── 1. canonicalApiPath (pure helper — own block; absent at 05297a7) ──────
test("1: canonicalApiPath normalizes case, trailing/double slashes, percent-encoding (decode once)", () => {
  const canonicalApiPath = MW.canonicalApiPath;
  assert.equal(typeof canonicalApiPath, "function", "_middleware.js must export canonicalApiPath");
  const cases = [
    ["/api/LINE-notify", "/api/line-notify"],
    ["/api/line-notify/", "/api/line-notify"],
    ["/api//line-notify//", "/api/line-notify"],
    ["/API/Line-Notify", "/api/line-notify"],
    ["/api/line%2Dnotify", "/api/line-notify"],
    ["/%61pi/line-notify", "/api/line-notify"],
    ["/api%2Fline-notify", "/api/line-notify"],
    ["/api/line%252Dnotify", "/api/line%2dnotify"], // decoded ONCE only — not a second time
    ["/", "/"],
    ["/api/%E0%A4%A", null],
    ["/API/line-notify%E0%A4%A", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(canonicalApiPath(input), expected, `canonicalApiPath(${JSON.stringify(input)})`);
  }
});

// ── 2. protected endpoints: every variant → 401, handler never reached ─────
const PROTECTED = [
  "/api/line-notify",
  "/api/ai-assistant",
  "/api/parse-receipt",
  "/api/verify-slip",
  "/api/verify-slipok",
  "/api/v1/reports/daily-summary",
];

function variantsOf(p) {
  const upper = p.toUpperCase();
  const mixed = p.replace(/\/([a-z])/g, (_, c) => "/" + c.toUpperCase());
  const withDash = p.includes("-") ? p.replace("-", "%2D") : null;
  return [
    upper,                               // ตัวพิมพ์ใหญ่ทั้งหมด
    mixed,                               // ตัวพิมพ์ผสม
    p + "/",                             // สแลชท้าย
    mixed + "/",                         // ผสม + สแลชท้าย
    p.replace("/api/", "/api//") + "//", // สแลชซ้ำ
    withDash,                            // %2D
    p.replace("/api/", "/%61pi/"),       // encoded prefix
    p.replace("/api/", "/api%2F"),       // encoded slash after /api
  ].filter(Boolean);
}

for (const endpoint of PROTECTED) {
  test(`2: control — exact ${endpoint} without JWT → 401, next() not called`, async () => {
    const { resp, nextCalls, fetchCalls } = await drive(endpoint);
    assert.equal(resp.status, 401);
    assert.equal(nextCalls, 0, "handler must not be reached");
    assert.equal(fetchCalls.length, 0, "no network call");
  });

  for (const v of variantsOf(endpoint)) {
    test(`2: variant ${v} without JWT → 401, next() not called`, async () => {
      const { resp, nextCalls, fetchCalls } = await drive(v);
      assert.equal(resp.status, 401, `${v} must be treated as ${endpoint} (got ${resp.status})`);
      assert.equal(nextCalls, 0, `${v} must not reach the handler without auth`);
      assert.equal(fetchCalls.length, 0, "no network call");
      const body = await resp.json();
      assert.equal(body.ok, false);
    });
  }
}

// ── 3. public endpoints still pass without JWT ──────────────────────────────
for (const p of ["/api/send-otp", "/api/verify-otp", "/api/log-error"]) {
  test(`3: public ${p} without JWT → next() called`, async () => {
    const { resp, nextCalls, fetchCalls } = await drive(p);
    assert.equal(nextCalls, 1, "public endpoint must still reach its handler");
    assert.equal(resp.status, 200);
    assert.equal(fetchCalls.length, 0);
  });
}

// ── 4. non-API paths untouched ──────────────────────────────────────────────
for (const p of [
  "/index.html", "/modules/pos.js", "/apiary.html",
  "/share.html?t=abc", "/icons/logo.svg", "/modules/doc_items.js?v=634",
]) {
  test(`4: non-API ${p} → next() called, response not decorated with CORS`, async () => {
    const { resp, nextCalls } = await drive(p, { method: "GET" });
    assert.equal(nextCalls, 1);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), "downstream", "static response must pass through as-is");
    assert.equal(resp.headers.get("Access-Control-Allow-Origin"), null, "no CORS header on static assets");
    assert.equal(resp.headers.get("X-RateLimit-Skipped"), null, "no rate-limit header on static assets");
  });
}

// ── 5. malformed path → 400 for ANY path, not forwarded ────────────────────
for (const p of ["/api/%E0%A4%A", "/API/line-notify%E0%A4%A", "/static/%E0%A4%A.js"]) {
  test(`5: malformed ${p} → 400 Bad request path, next() not called`, async () => {
    const { resp, nextCalls, fetchCalls } = await drive(p);
    assert.equal(resp.status, 400, `malformed ${p} must be rejected (got ${resp.status})`);
    assert.equal(nextCalls, 0, "malformed path must not reach any handler");
    assert.equal(fetchCalls.length, 0);
    const body = await resp.json();
    assert.deepEqual(body, { ok: false, error: "Bad request path" });
    assert.ok(resp.headers.get("Access-Control-Allow-Origin"), "400 must carry CORS headers");
  });
}

// ── 5b. %-residue after the single decode (double encoding) → 400 on API paths ──
// /api/line%252Dnotify decodes ONCE to /api/line%2dnotify; a "%" left in a canonical API path is
// rejected outright instead of relying on how Cloudflare would route it (ภาคผนวก v3 E2).
for (const p of ["/api/line%252Dnotify", "/API/Send%252DOTP/", "/api/%2525"]) {
  test(`5b: API path with %-residue after one decode ${p} → 400, next() not called`, async () => {
    const { resp, nextCalls, fetchCalls } = await drive(p);
    assert.equal(resp.status, 400, `${p} must be rejected (got ${resp.status})`);
    assert.equal(nextCalls, 0);
    assert.equal(fetchCalls.length, 0);
    assert.deepEqual(await resp.json(), { ok: false, error: "Bad request path" });
  });
}

test("5b: single-encoded /api/line%2Dnotify decodes to /api/line-notify → 401 (no JWT)", async () => {
  const { resp, nextCalls } = await drive("/api/line%2Dnotify");
  assert.equal(resp.status, 401);
  assert.equal(nextCalls, 0);
});

test("5b: /api/send-otp (no %) → next() as before", async () => {
  const { resp, nextCalls } = await drive("/api/send-otp");
  assert.equal(resp.status, 200);
  assert.equal(nextCalls, 1);
});

// ── 6. rate-limit: variants share ONE real bucket (counting KV, same IP/window) ──
function countingKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

async function withFrozenClock(fn) {
  const origNow = Date.now;
  const fixed = 1_790_000_010_000; // mid-window, fixed → every request in the same 60s window
  Date.now = () => fixed;
  try { return await fn(); } finally { Date.now = origNow; }
}

async function exhaust(variants, limit, expectBeforeLimit) {
  return withFrozenClock(async () => {
    const kv = countingKv();
    const env = { RATE_LIMIT_KV: kv };
    for (let i = 0; i < limit; i++) {
      const p = variants[i % variants.length];
      const { resp } = await drive(p, { env });
      assert.equal(resp.status, expectBeforeLimit, `request #${i + 1} (${p}) must pass the rate limit`);
    }
    for (const p of variants) {
      const { resp, nextCalls } = await drive(p, { env });
      assert.equal(resp.status, 429, `request after limit ${limit} via ${p} must be 429 (got ${resp.status})`);
      assert.equal(nextCalls, 0);
    }
    return kv;
  });
}

test("6: /api/send-otp variants share one bucket — limit 5 (not default 100)", async () => {
  const kv = await exhaust(["/api/send-otp", "/api/Send-OTP", "/api/send-otp/"], 5, 200);
  assert.equal(kv.store.size, 1, "exactly one bucket for all variants");
  assert.match([...kv.store.keys()][0], /^rl:\/api\/send-otp:203\.0\.113\.7:/);
});

test("6: /api/verify-otp variants share one bucket — limit 10 (not default 100)", async () => {
  const kv = await exhaust(["/api/verify-otp", "/API/Verify-Otp", "/api//verify-otp/"], 10, 200);
  assert.equal(kv.store.size, 1);
  assert.match([...kv.store.keys()][0], /^rl:\/api\/verify-otp:/);
});

test("6: /api/line-notify variants share one bucket — limit 30", async () => {
  const kv = await exhaust(["/api/line-notify", "/api/LINE-notify", "/api/line-notify/"], 30, 401);
  assert.equal(kv.store.size, 1);
  assert.match([...kv.store.keys()][0], /^rl:\/api\/line-notify:/);
});

// ── 7. OPTIONS preflight unchanged ──────────────────────────────────────────
test("7: OPTIONS /api/LINE-notify → 204", async () => {
  const { resp, nextCalls } = await drive("/api/LINE-notify", { method: "OPTIONS" });
  assert.equal(resp.status, 204);
  assert.equal(nextCalls, 0);
});

// ── 8. handler defense-in-depth: no data.user → 401 before body/env/fetch ──
const HANDLERS = [
  ["line-notify", { LINE_CHANNEL_ACCESS_TOKEN: "tok-x", LINE_USER_ID: "U123" }, { probe: true }],
  ["line-notify", { LINE_CHANNEL_ACCESS_TOKEN: "tok-x", LINE_USER_ID: "U123" }, { message: "hi" }],
  ["ai-assistant", { AI: { run: async () => { throw new Error("AI must not run"); } } }, { message: "hi" }],
  ["parse-receipt", { GEMINI_API_KEY: "gem-x" }, { image: "data:image/png;base64,AAAA" }],
  ["verify-slip", { GEMINI_API_KEY: "gem-x" }, { image: "data:image/png;base64,AAAA" }],
  ["verify-slipok", { SLIPOK_API_KEY: "slip-x" }, { image: "data:image/png;base64,AAAA" }],
];

for (const [name, env, body] of HANDLERS) {
  test(`8: ${name} onRequestPost with data={} → 401, no body read, no fetch (${JSON.stringify(body)})`, async () => {
    const mod = await import(`../functions/api/${name}.js`);
    assert.equal(typeof mod.onRequestPost, "function");
    await withStubbedNetwork(null, async (fetchCalls) => {
      let bodyReads = 0;
      const request = { json: async () => { bodyReads++; return body; } };
      const resp = await mod.onRequestPost({ request, env, data: {} });
      assert.equal(resp.status, 401, `${name} must reject when middleware did not set data.user (got ${resp.status})`);
      const out = await resp.json();
      assert.equal(out.ok, false);
      assert.equal(out.error, "Unauthorized");
      assert.equal(bodyReads, 0, `${name} must not read the body before the guard`);
      assert.equal(fetchCalls.length, 0, `${name} must not call any upstream`);
    });
  });
}

test("8: verify-slipok handler still accepts a customer JWT user (role null) — no role check added", async () => {
  const mod = await import("../functions/api/verify-slipok.js");
  await withStubbedNetwork(null, async (fetchCalls) => {
    const resp = await mod.onRequestPost({
      request: { json: async () => ({ image: "not-a-data-url" }) },
      env: { SLIPOK_API_KEY: "slip-x" },
      data: { user: { id: "u-customer", email: null, role: null } },
    });
    assert.equal(resp.status, 400, "past the guard → normal bad_image handling");
    assert.equal((await resp.json()).error, "bad_image");
    assert.equal(fetchCalls.length, 0);
  });
});

// ── 8b. positive middleware paths (ภาคผนวก v2 D1) — exact + variants ───────
const AUTH_ENV = { SUPABASE_JWT_SECRET: JWT_SECRET, NING_AGENT_API_KEY: NING_KEY };
const ROLES = { "u-admin": "admin", "u-sales": "sales", "u-owner": "owner", "u-customer": "customer" };
const bearer = (sub) => ({ Authorization: `Bearer ${makeJwt(sub)}` });

const LINE_PATHS = ["/api/line-notify", "/api/Line-Notify", "/api/line-notify/"];
for (const p of LINE_PATHS) {
  for (const sub of ["u-admin", "u-sales"]) {
    test(`8b: line-notify ${p} with staff JWT (${ROLES[sub]}) → reaches handler`, async () => {
      const { resp, nextCalls, userSeen, nonRoleCalls } = await drive(p, { env: AUTH_ENV, headers: bearer(sub), roles: ROLES });
      assert.equal(resp.status, 200);
      assert.equal(nextCalls, 1);
      assert.equal(userSeen?.id, sub);
      assert.equal(userSeen?.role, ROLES[sub]);
      assert.equal(nonRoleCalls.length, 0);
    });
  }
  test(`8b: line-notify ${p} with customer JWT → 403`, async () => {
    const { resp, nextCalls } = await drive(p, { env: AUTH_ENV, headers: bearer("u-customer"), roles: ROLES });
    assert.equal(resp.status, 403, `customer must be forbidden on ${p} (got ${resp.status})`);
    assert.equal(nextCalls, 0);
  });
}

for (const p of ["/api/verify-slipok", "/api/Verify-SlipOK", "/api/verify-slipok/"]) {
  test(`8b: verify-slipok ${p} with customer JWT → reaches handler (no role check)`, async () => {
    const { resp, nextCalls, userSeen, fetchCalls } = await drive(p, { env: AUTH_ENV, headers: bearer("u-customer"), roles: ROLES });
    assert.equal(resp.status, 200);
    assert.equal(nextCalls, 1);
    assert.equal(userSeen?.id, "u-customer");
    assert.equal(fetchCalls.length, 0, "no role lookup for verify-slipok");
  });
}

const REPORT_PATHS = ["/api/v1/reports/daily-summary", "/API/V1/Reports/Daily-Summary", "/api/v1/reports/daily-summary/"];
for (const p of REPORT_PATHS) {
  for (const sub of ["u-admin", "u-owner"]) {
    test(`8b: daily-summary ${p} with ${ROLES[sub]} JWT → reaches handler`, async () => {
      const { resp, nextCalls, userSeen } = await drive(p, { env: AUTH_ENV, headers: bearer(sub), roles: ROLES });
      assert.equal(resp.status, 200);
      assert.equal(nextCalls, 1);
      assert.equal(userSeen?.role, ROLES[sub]);
    });
  }
  for (const sub of ["u-sales", "u-customer"]) {
    test(`8b: daily-summary ${p} with ${ROLES[sub]} JWT → 403`, async () => {
      const { resp, nextCalls } = await drive(p, { env: AUTH_ENV, headers: bearer(sub), roles: ROLES });
      assert.equal(resp.status, 403, `${ROLES[sub]} must be forbidden on ${p} (got ${resp.status})`);
      assert.equal(nextCalls, 0);
    });
  }
  test(`8b: daily-summary ${p} with valid X-NING-AGENT-KEY → reaches handler as ning_agent`, async () => {
    const { resp, nextCalls, userSeen, fetchCalls } = await drive(p, { env: AUTH_ENV, headers: { "X-NING-AGENT-KEY": NING_KEY } });
    assert.equal(resp.status, 200);
    assert.equal(nextCalls, 1);
    assert.equal(userSeen?.authMode, "ning_agent");
    assert.equal(fetchCalls.length, 0);
  });
  test(`8b: daily-summary ${p} with wrong X-NING-AGENT-KEY → 401`, async () => {
    const { resp, nextCalls } = await drive(p, { env: AUTH_ENV, headers: { "X-NING-AGENT-KEY": NING_KEY + "-wrong" } });
    assert.equal(resp.status, 401, `wrong Ning key must be rejected on ${p} (got ${resp.status})`);
    assert.equal(nextCalls, 0);
  });
}

// ── 9. inventory: every functions/api endpoint is classified ────────────────
// PUBLIC = ตั้งใจไม่ต้องมี JWT (เหตุผลรายตัว). เพิ่ม endpoint ใหม่โดยไม่จัดกลุ่ม = test แดง.
const PUBLIC_ALLOWLIST = {
  "/api/send-otp": "ลูกค้ายังไม่ login — ขอ OTP; คุมด้วย rate-limit 5/นาที + cooldown ฝั่ง handler",
  "/api/verify-otp": "ลูกค้ายังไม่ login — ยืนยัน OTP; คุมด้วย rate-limit 10/นาที + attempt cap ฝั่ง handler",
  "/api/log-error": "error reporter ต้องทำงานก่อน login/ตอน auth พัง; rate-limit 60/นาที + sanitize ฝั่ง handler",
};

function listEndpointFiles(dir, prefix = "/api") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listEndpointFiles(full, `${prefix}/${entry.name}`));
    } else if (entry.name.endsWith(".js")) {
      out.push(`${prefix}/${entry.name.slice(0, -3)}`);
    }
  }
  return out;
}

function requireAuthFromSource() {
  const m = MW_SRC.match(/const REQUIRE_AUTH_ENDPOINTS = \[([\s\S]*?)\];/);
  assert.ok(m, "REQUIRE_AUTH_ENDPOINTS must exist in _middleware.js");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("9: every functions/api/**/*.js is in REQUIRE_AUTH_ENDPOINTS or the PUBLIC allowlist", () => {
  const endpoints = listEndpointFiles(path.join(ROOT, "functions/api"));
  const requireAuth = new Set(requireAuthFromSource());
  assert.ok(endpoints.length >= 10, "sanity: endpoint inventory found");
  const unclassified = endpoints.filter((e) => !requireAuth.has(e) && !(e in PUBLIC_ALLOWLIST));
  assert.deepEqual(unclassified, [], "unclassified endpoint(s) — add to REQUIRE_AUTH_ENDPOINTS or PUBLIC_ALLOWLIST with a reason");
  for (const e of Object.keys(PUBLIC_ALLOWLIST)) {
    assert.ok(endpoints.includes(e), `PUBLIC_ALLOWLIST entry ${e} has no handler file (stale)`);
    assert.ok(!requireAuth.has(e), `${e} cannot be both public and auth-required`);
  }
  for (const e of requireAuth) {
    assert.equal(e, e.toLowerCase(), `${e} must be lowercase (canonical)`);
    assert.ok(!e.endsWith("/") && !e.includes("//"), `${e} must have no trailing/double slash (canonical)`);
  }
});
