// Phase 92.3 — Regression + hardening tests for branding.syncAppLogo().
//
// syncAppLogo pulls the store logo from the Supabase Storage `store-assets`
// bucket (raw REST list endpoint) and caches the public URL in localStorage.
// All I/O is injected (config / fetch / storage / logger), so these tests run
// with no network and no `window`.
//
// Two layers:
//   1. Behavioral — fake fetch + stub storage assert the exact original flow:
//      list → pick logo.* → cache-busted URL → conditional localStorage write +
//      repaint. Plus the NEW hardening: AbortController timeout + logged failure.
//   2. Source-level — main.js no longer inlines the storage REST call; the
//      window._appSyncLogo wrapper remains and delegates to the module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { syncAppLogo } from "../modules/branding.js";

// ── Stubs ──────────────────────────────────────────────────────────────────
function makeStubStorage(map = {}) {
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
  };
}
function makeLogger() {
  const warns = [];
  return { warns, warn: (...a) => warns.push(a) };
}
const CONFIG = { url: "https://proj.supabase.co", anonKey: "anon-123" };

// A fetch that returns a canned list response. Captures the request for asserts.
function fetchReturning(files, { ok = true } = {}) {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({
      ok,
      json: () => Promise.resolve(files),
    });
  };
  fn.calls = calls;
  return fn;
}

const LOGO_FILE = { name: "logo.png", updated_at: "2026-05-20T00:00:00.000Z" };
const EXPECTED_URL =
  "https://proj.supabase.co/storage/v1/object/public/store-assets/logo.png?t=" +
  new Date(LOGO_FILE.updated_at).getTime();

// ── Behavioral ───────────────────────────────────────────────────────────
test("syncAppLogo: happy path caches the public URL + repaints, returns true", async () => {
  const storageRef = makeStubStorage();
  let painted = 0;
  const ok = await syncAppLogo({
    config: CONFIG, accessToken: "user-token",
    storageRef, fetchImpl: fetchReturning([LOGO_FILE]),
    onUpdated: () => { painted++; },
  });
  assert.equal(ok, true);
  assert.equal(storageRef.getItem("bsk_store_logo"), EXPECTED_URL);
  assert.equal(storageRef.getItem("bsk_store_logo_url"), EXPECTED_URL);
  assert.equal(painted, 1, "onUpdated must fire once after caching");
});

test("syncAppLogo: list request uses anonKey apikey + Bearer access token", async () => {
  const fetchImpl = fetchReturning([LOGO_FILE]);
  await syncAppLogo({ config: CONFIG, accessToken: "user-token", storageRef: makeStubStorage(), fetchImpl });
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, "https://proj.supabase.co/storage/v1/object/list/store-assets");
  assert.equal(opts.method, "POST");
  assert.equal(opts.headers.apikey, "anon-123");
  assert.equal(opts.headers.Authorization, "Bearer user-token");
  assert.equal(opts.body, JSON.stringify({ prefix: "logo", limit: 5 }));
});

test("syncAppLogo: Authorization falls back to anonKey when no access token", async () => {
  const fetchImpl = fetchReturning([LOGO_FILE]);
  await syncAppLogo({ config: CONFIG, storageRef: makeStubStorage(), fetchImpl });
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, "Bearer anon-123");
});

test("syncAppLogo: no config / fetch / storage → returns false, no fetch", async () => {
  const fetchImpl = fetchReturning([LOGO_FILE]);
  assert.equal(await syncAppLogo({ config: null, fetchImpl, storageRef: makeStubStorage() }), false);
  assert.equal(fetchImpl.calls.length, 0, "must not fetch without config");
  assert.equal(await syncAppLogo({ config: CONFIG, fetchImpl: null, storageRef: makeStubStorage() }), false);
  assert.equal(await syncAppLogo({ config: CONFIG, fetchImpl, storageRef: null }), false);
});

test("syncAppLogo: non-OK list response → no write, returns false", async () => {
  const storageRef = makeStubStorage();
  const ok = await syncAppLogo({ config: CONFIG, storageRef, fetchImpl: fetchReturning([LOGO_FILE], { ok: false }) });
  assert.equal(ok, false);
  assert.equal(storageRef.getItem("bsk_store_logo"), null);
});

test("syncAppLogo: no logo.* file in bucket → no write, returns false", async () => {
  const storageRef = makeStubStorage();
  const ok = await syncAppLogo({ config: CONFIG, storageRef, fetchImpl: fetchReturning([{ name: "banner.jpg" }, {}]) });
  assert.equal(ok, false);
  assert.equal(storageRef.getItem("bsk_store_logo"), null);
});

test("syncAppLogo: dedup — data: URI already cached at same URL is left untouched", async () => {
  // current logo is a user-uploaded data: URI AND the stored URL matches → skip
  const storageRef = makeStubStorage({
    bsk_store_logo: "data:image/png;base64,USERUPLOAD",
    bsk_store_logo_url: EXPECTED_URL,
  });
  let painted = 0;
  const ok = await syncAppLogo({
    config: CONFIG, storageRef, fetchImpl: fetchReturning([LOGO_FILE]), onUpdated: () => painted++,
  });
  assert.equal(ok, false, "must not overwrite a matching data: URI");
  assert.equal(storageRef.getItem("bsk_store_logo"), "data:image/png;base64,USERUPLOAD");
  assert.equal(painted, 0);
});

test("syncAppLogo: refreshes when stored URL differs (even if current is data:)", async () => {
  const storageRef = makeStubStorage({
    bsk_store_logo: "data:image/png;base64,OLD",
    bsk_store_logo_url: "https://proj.supabase.co/.../logo.png?t=111",
  });
  const ok = await syncAppLogo({ config: CONFIG, storageRef, fetchImpl: fetchReturning([LOGO_FILE]) });
  assert.equal(ok, true, "different URL must refresh the cache");
  assert.equal(storageRef.getItem("bsk_store_logo"), EXPECTED_URL);
});

test("syncAppLogo: non-data current logo always refreshes to server URL", async () => {
  const storageRef = makeStubStorage({
    bsk_store_logo: "https://old/logo.png",
    bsk_store_logo_url: "https://old/logo.png",
  });
  const ok = await syncAppLogo({ config: CONFIG, storageRef, fetchImpl: fetchReturning([LOGO_FILE]) });
  assert.equal(ok, true);
  assert.equal(storageRef.getItem("bsk_store_logo"), EXPECTED_URL);
});

// ── Hardening: timeout + logged failures (no throw, cache still serves) ──────
test("syncAppLogo: fetch rejection is caught, logged, returns false (no throw)", async () => {
  const logger = makeLogger();
  const storageRef = makeStubStorage();
  const ok = await syncAppLogo({
    config: CONFIG, storageRef, logger,
    fetchImpl: () => Promise.reject(new Error("network down")),
  });
  assert.equal(ok, false);
  assert.equal(storageRef.getItem("bsk_store_logo"), null, "cache untouched on failure");
  assert.equal(logger.warns.length, 1, "failure must be logged once");
  assert.match(logger.warns[0].join(" "), /network down/);
});

test("syncAppLogo: stalled fetch is aborted by timeoutMs and logged", async () => {
  const logger = makeLogger();
  // fetch that only settles when its AbortSignal fires — proves the timeout wiring
  const fetchImpl = (_url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  const t0 = Date.now();
  const ok = await syncAppLogo({ config: CONFIG, storageRef: makeStubStorage(), fetchImpl, timeoutMs: 30, logger });
  assert.equal(ok, false);
  assert.ok(Date.now() - t0 < 2000, "must resolve quickly via the abort timeout, not hang");
  assert.equal(logger.warns.length, 1, "abort must be logged");
});

// ── Source-level ─────────────────────────────────────────────────────────
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname2, "..", "main.js"), "utf8");
const brandingSrc = readFileSync(path.join(__dirname2, "..", "modules", "branding.js"), "utf8");

test("Phase 92.3: modules/branding.js must export syncAppLogo", () => {
  assert.ok(
    /export\s+async\s+function\s+syncAppLogo\s*\(/.test(brandingSrc),
    "modules/branding.js must export async function syncAppLogo"
  );
});

test("Phase 92.3: main.js must NOT still inline the Storage REST list call", () => {
  // The bucket list endpoint string moved into the module. If it reappears in
  // main.js, the extraction has regressed.
  assert.ok(
    !/storage\/v1\/object\/list\/store-assets/.test(mainSrc),
    "main.js must not inline the store-assets list endpoint (branding.syncAppLogo owns it)"
  );
});

test("Phase 92.3: main.js's _appSyncLogo wrapper must remain + delegate to the module", () => {
  assert.ok(
    /window\._appSyncLogo\s*=\s*async\s+function/.test(mainSrc),
    "main.js must keep window._appSyncLogo as an async wrapper"
  );
  assert.ok(
    /_syncAppLogoImpl\(\s*\{/.test(mainSrc),
    "main.js wrapper must delegate to _syncAppLogoImpl({ ... })"
  );
});
