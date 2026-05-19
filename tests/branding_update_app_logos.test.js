// Phase 92.1 — Regression tests for the extracted branding.updateAppLogos().
//
// Two layers:
//   1. Behavioral — a hand-rolled minimal Document stub with the exact selectors
//      main.js uses. Asserts every slot gets painted, and the favicon-skip
//      for http URLs is preserved (only data: URIs override the favicon).
//   2. Source-level — main.js must NOT still contain the inline DOM-paint
//      lines that were extracted. Catches a regression where someone copies
//      the body back in a future refactor.
//
// The wrapper in main.js still passes `documentRef: document` and
// `getLogo: () => window._appGetLogo?.()`, so its closure identity (used by
// window.updateAppLogos and window.App.updateAppLogos) is unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { updateAppLogos, getAppLogo } from "../modules/branding.js";

// ── Minimal Document stub ──────────────────────────────────────────────
// Just enough surface for updateAppLogos: querySelector, querySelectorAll.
// Real production code is in a browser; this stub mirrors the selector
// semantics we actually rely on.
function makeStubElement() {
  return { src: null, href: null };
}
function makeStubDocument({ hasFavicon = true } = {}) {
  const sidebar = makeStubElement();
  const profile = makeStubElement();
  const spinner = makeStubElement();
  const authA = makeStubElement();
  const authB = makeStubElement();
  const favicon = hasFavicon ? makeStubElement() : null;
  const single = {
    ".sidebar-logo-img": sidebar,
    ".set-profile-logo": profile,
    ".spinner-logo": spinner,
    'link[rel="icon"]': favicon,
  };
  const multi = {
    ".auth-logo-img": [authA, authB],
  };
  return {
    elements: { sidebar, profile, spinner, authA, authB, favicon },
    querySelector(sel) { return single[sel] ?? null; },
    querySelectorAll(sel) { return multi[sel] ?? []; },
  };
}

test("updateAppLogos: paints every slot with the logo returned by getLogo()", () => {
  const doc = makeStubDocument();
  updateAppLogos({ documentRef: doc, getLogo: () => "https://cdn.example/logo.png" });
  assert.equal(doc.elements.sidebar.src, "https://cdn.example/logo.png");
  assert.equal(doc.elements.profile.src, "https://cdn.example/logo.png");
  assert.equal(doc.elements.spinner.src, "https://cdn.example/logo.png");
  assert.equal(doc.elements.authA.src,   "https://cdn.example/logo.png");
  assert.equal(doc.elements.authB.src,   "https://cdn.example/logo.png");
});

test("updateAppLogos: favicon is only overridden for data: URIs (http URLs left alone)", () => {
  // Case 1 — http URL: favicon must NOT be touched (no spurious fetch)
  const docHttp = makeStubDocument();
  updateAppLogos({ documentRef: docHttp, getLogo: () => "https://cdn.example/logo.png" });
  assert.equal(docHttp.elements.favicon.href, null, "http logo must not override favicon (original behavior)");

  // Case 2 — data: URI: favicon IS overridden
  const docData = makeStubDocument();
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  updateAppLogos({ documentRef: docData, getLogo: () => dataUri });
  assert.equal(docData.elements.favicon.href, dataUri);
});

test("updateAppLogos: missing favicon element is OK (just paints the other slots)", () => {
  const doc = makeStubDocument({ hasFavicon: false });
  // Should not throw even though querySelector('link[rel="icon"]') returns null
  updateAppLogos({ documentRef: doc, getLogo: () => "data:image/png;base64,abc" });
  assert.equal(doc.elements.sidebar.src, "data:image/png;base64,abc");
});

test("updateAppLogos: no-op when getLogo returns empty/null/undefined (defensive)", () => {
  for (const empty of [null, undefined, "", false]) {
    const doc = makeStubDocument();
    updateAppLogos({ documentRef: doc, getLogo: () => empty });
    assert.equal(doc.elements.sidebar.src, null, `must not paint when logo=${JSON.stringify(empty)}`);
    assert.equal(doc.elements.favicon.href, null);
  }
});

test("updateAppLogos: no-op when documentRef is null (Node test env without document)", () => {
  // Just verifies it doesn't throw — there's nothing to assert on a null doc.
  updateAppLogos({ documentRef: null, getLogo: () => "https://cdn/logo.png" });
});

test("updateAppLogos: paints all .auth-logo-img elements (multi-element selector)", () => {
  const doc = makeStubDocument();
  // The original main.js used querySelectorAll for .auth-logo-img — login + set-pw screens.
  // Pin that ALL nodes are painted, not just the first.
  updateAppLogos({ documentRef: doc, getLogo: () => "https://cdn/logo.png" });
  assert.equal(doc.elements.authA.src, "https://cdn/logo.png");
  assert.equal(doc.elements.authB.src, "https://cdn/logo.png");
});

// ── Phase 92.2: getAppLogo resolver — priority chain pinned ────────────────
// Mirrors the original main.js _appGetLogo exactly:
//   state.storeInfo.logoUrl > localStorage["bsk_store_logo"] > "./icons/logo.svg"
function makeStubStorage(map = {}) {
  return { getItem: (k) => (k in map ? map[k] : null) };
}

test("getAppLogo: state.storeInfo.logoUrl wins (highest priority)", () => {
  const logo = getAppLogo({
    stateRef: { storeInfo: { logoUrl: "https://db/logo.png" } },
    storageRef: makeStubStorage({ bsk_store_logo: "data:image/png;base64,cache" }),
  });
  assert.equal(logo, "https://db/logo.png");
});

test("getAppLogo: falls back to localStorage when no storeInfo logoUrl", () => {
  // Empty/missing storeInfo → use the cached storage value
  for (const stateRef of [undefined, {}, { storeInfo: null }, { storeInfo: { logoUrl: "" } }]) {
    const logo = getAppLogo({
      stateRef,
      storageRef: makeStubStorage({ bsk_store_logo: "data:cached" }),
    });
    assert.equal(logo, "data:cached", `stateRef=${JSON.stringify(stateRef)} must fall through to storage`);
  }
});

test("getAppLogo: falls back to default when neither state nor storage has a logo", () => {
  const logo = getAppLogo({ stateRef: {}, storageRef: makeStubStorage() });
  assert.equal(logo, "./icons/logo.svg");
});

test("getAppLogo: custom defaultLogo is honored", () => {
  const logo = getAppLogo({ stateRef: {}, storageRef: makeStubStorage(), defaultLogo: "./logo.svg" });
  assert.equal(logo, "./logo.svg");
});

test("getAppLogo: null storageRef is safe (no localStorage in env)", () => {
  // Optional-chaining on storageRef must not throw when storage is absent
  const logo = getAppLogo({ stateRef: {}, storageRef: null });
  assert.equal(logo, "./icons/logo.svg");
});

// ── Source-level: extraction is real, main.js no longer inlines DOM paint ──
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname2, "..", "main.js"), "utf8");
const brandingSrc = readFileSync(path.join(__dirname2, "..", "modules", "branding.js"), "utf8");

test("Phase 92.1: main.js must import the extracted helper from modules/branding.js", () => {
  assert.ok(
    /from\s+["']\.\/modules\/branding\.js["']/.test(mainSrc),
    "main.js must import from ./modules/branding.js — otherwise the wrapper has no source"
  );
});

test("Phase 92.1: modules/branding.js must export updateAppLogos", () => {
  assert.ok(
    /export\s+function\s+updateAppLogos\s*\(/.test(brandingSrc),
    "modules/branding.js must export function updateAppLogos"
  );
});

test("Phase 92.2: modules/branding.js must export getAppLogo", () => {
  assert.ok(
    /export\s+function\s+getAppLogo\s*\(/.test(brandingSrc),
    "modules/branding.js must export function getAppLogo"
  );
});

test("Phase 92.2: main.js must NOT still inline the logo resolution chain", () => {
  // The original body read state.storeInfo?.logoUrl then localStorage. The
  // wrapper now delegates to _getAppLogoImpl; main.js must not read the
  // "bsk_store_logo" key directly inside _appGetLogo anymore.
  assert.ok(
    !/state\.storeInfo\?\.logoUrl\s*\n?\s*\|\|\s*localStorage\.getItem\(\s*["']bsk_store_logo["']/.test(mainSrc),
    "main.js must not inline the storeInfo.logoUrl || localStorage chain (branding.getAppLogo owns it)"
  );
});

test("Phase 92.2: main.js's _appGetLogo wrapper must remain (preserves window._appGetLogo)", () => {
  // Many modules call window._appGetLogo() (pos, dashboard, payroll, receipts,
  // quotations, delivery_invoices). The wrapper binding live `state` must stay.
  assert.ok(
    /window\._appGetLogo\s*=\s*function/.test(mainSrc),
    "main.js must keep window._appGetLogo as a wrapper"
  );
  assert.ok(
    /_getAppLogoImpl\(\s*\{\s*stateRef:\s*state\s*\}\s*\)/.test(mainSrc),
    "main.js wrapper must delegate to _getAppLogoImpl({ stateRef: state })"
  );
});

test("Phase 92.1: main.js must NOT still contain the inline querySelector calls for branding selectors", () => {
  // Pin the specific selectors that were in the inline body. If any of them
  // appear in main.js as a querySelector call, the extraction has regressed
  // — someone copied the body back. Module owns these selectors now.
  //
  // We deliberately check `querySelector(".sidebar-logo-img")` etc. — the
  // wrapper in main.js calls `_updateAppLogosImpl(...)` and doesn't touch DOM
  // directly. (Other modules can still query their own elements; this is
  // scoped to branding.)
  assert.ok(
    !/querySelector\(\s*["']\.sidebar-logo-img["']/.test(mainSrc),
    "main.js must not inline-query .sidebar-logo-img (branding module owns this)"
  );
  assert.ok(
    !/querySelectorAll\(\s*["']\.auth-logo-img["']/.test(mainSrc),
    "main.js must not inline-query .auth-logo-img (branding module owns this)"
  );
  assert.ok(
    !/querySelector\(\s*["']\.set-profile-logo["']/.test(mainSrc),
    "main.js must not inline-query .set-profile-logo"
  );
  assert.ok(
    !/querySelector\(\s*["']\.spinner-logo["']/.test(mainSrc),
    "main.js must not inline-query .spinner-logo"
  );
});

test("Phase 92.1: main.js's updateAppLogos wrapper must still exist (preserves window.App contract)", () => {
  // Many callers reach this via window.App.updateAppLogos or the function ref
  // closed over from main.js scope. The wrapper must remain so those don't break.
  assert.ok(
    /function\s+updateAppLogos\s*\(\s*\)/.test(mainSrc),
    "main.js must keep `function updateAppLogos()` as a wrapper — preserves window.updateAppLogos and window.App.updateAppLogos"
  );
  assert.ok(
    /window\.updateAppLogos\s*=\s*updateAppLogos/.test(mainSrc),
    "main.js must still expose window.updateAppLogos = updateAppLogos"
  );
});
