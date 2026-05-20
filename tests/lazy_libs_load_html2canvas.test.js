// Phase 92.4 — Regression tests for the extracted lazy_libs.loadHtml2Canvas().
//
// loadHtml2Canvas injects the html2canvas CDN <script> once and resolves a
// boolean (true = available, false = load failed). DOM/window are injected, so
// these tests run with no browser. The async function runs its Promise executor
// synchronously up to the script append, so we can grab the created <script>
// and fire its onload/onerror to drive the outcome.
//
// Two layers:
//   1. Behavioral — stub window/document assert: idempotent skip when already
//      loaded, script injection + src, onload→true, onerror→false (+ log),
//      custom URL, null-document safety.
//   2. Source-level — main.js imports from ./modules/lazy_libs.js, no longer
//      inlines the cdnjs URL, and keeps the _loadHtml2Canvas wrapper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadHtml2Canvas, HTML2CANVAS_CDN_URL } from "../modules/lazy_libs.js";

// ── Stubs ──────────────────────────────────────────────────────────────────
function makeStubDoc() {
  const doc = {
    created: [],
    appended: [],
    head: { appendChild(el) { doc.appended.push(el); } },
    createElement(tag) {
      const el = { tag, src: null, onload: null, onerror: null };
      doc.created.push(el);
      return el;
    },
    lastScript() { return doc.created[doc.created.length - 1] || null; },
  };
  return doc;
}
function makeLogger() {
  const warns = [];
  return { warns, warn: (...a) => warns.push(a) };
}

// ── Behavioral ───────────────────────────────────────────────────────────
test("loadHtml2Canvas: resolves true immediately when html2canvas already present (no script)", async () => {
  const doc = makeStubDoc();
  const ok = await loadHtml2Canvas({ windowRef: { html2canvas: {} }, documentRef: doc });
  assert.equal(ok, true);
  assert.equal(doc.created.length, 0, "must NOT inject a script when already loaded (idempotent)");
});

test("loadHtml2Canvas: injects script with the CDN src + appends to head, onload → true", async () => {
  const doc = makeStubDoc();
  const p = loadHtml2Canvas({ windowRef: {}, documentRef: doc });
  const s = doc.lastScript();
  assert.ok(s, "a <script> must be created");
  assert.equal(s.src, HTML2CANVAS_CDN_URL);
  assert.equal(doc.appended[0], s, "script must be appended to head");
  s.onload();                 // simulate successful load
  assert.equal(await p, true);
});

test("loadHtml2Canvas: onerror → resolves false + logs once (no throw)", async () => {
  const doc = makeStubDoc();
  const logger = makeLogger();
  const p = loadHtml2Canvas({ windowRef: {}, documentRef: doc, logger });
  doc.lastScript().onerror();
  assert.equal(await p, false);
  assert.equal(logger.warns.length, 1, "load failure must be logged once");
  assert.match(logger.warns[0].join(" "), /failed to load/);
});

test("loadHtml2Canvas: custom scriptUrl is honored", async () => {
  const doc = makeStubDoc();
  const url = "https://example.test/html2canvas.js";
  const p = loadHtml2Canvas({ windowRef: {}, documentRef: doc, scriptUrl: url });
  assert.equal(doc.lastScript().src, url);
  doc.lastScript().onload();
  assert.equal(await p, true);
});

test("loadHtml2Canvas: null documentRef → resolves false, no throw", async () => {
  assert.equal(await loadHtml2Canvas({ windowRef: {}, documentRef: null }), false);
});

// ── Phase 92.6 Issue 1: concurrent dedup + retry-after-fail ────────────────
test("loadHtml2Canvas: concurrent callers share the same in-flight promise (no duplicate <script>)", async () => {
  const doc = makeStubDoc();
  const winRef = {};
  // 3 parallel calls before script settles
  const p1 = loadHtml2Canvas({ windowRef: winRef, documentRef: doc });
  const p2 = loadHtml2Canvas({ windowRef: winRef, documentRef: doc });
  const p3 = loadHtml2Canvas({ windowRef: winRef, documentRef: doc });
  assert.equal(doc.created.length, 1, "exactly 1 <script> must be injected for N concurrent callers");
  doc.lastScript().onload();
  assert.deepEqual(await Promise.all([p1, p2, p3]), [true, true, true]);
});

test("loadHtml2Canvas: after a failed load, the next call retries (pending promise is cleared)", async () => {
  const doc = makeStubDoc();
  const logger = makeLogger();
  // First attempt fails
  const p1 = loadHtml2Canvas({ windowRef: {}, documentRef: doc, logger });
  doc.lastScript().onerror();
  assert.equal(await p1, false);
  // Second attempt must inject a NEW script (not return the cached failed promise)
  const doc2Created = doc.created.length;
  const p2 = loadHtml2Canvas({ windowRef: {}, documentRef: doc, logger });
  assert.equal(doc.created.length, doc2Created + 1, "after failure, next call must retry (new <script>)");
  doc.lastScript().onload();
  assert.equal(await p2, true);
});

test("loadHtml2Canvas: HTML2CANVAS_CDN_URL is the pinned 1.4.1 jsdelivr build", () => {
  // Phase 92.5: cdnjs.cloudflare.com is blocked by the production CSP — must use
  // an allowed host (cdn.jsdelivr.net). See _headers script-src-elem.
  assert.equal(
    HTML2CANVAS_CDN_URL,
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
  );
});

test("Phase 92.5: HTML2CANVAS_CDN_URL host is CSP-allowed (jsdelivr/unpkg), never cdnjs", () => {
  const host = new URL(HTML2CANVAS_CDN_URL).host;
  assert.ok(
    host === "cdn.jsdelivr.net" || host === "unpkg.com",
    `html2canvas host ${host} must be a CSP-allowed host (cdn.jsdelivr.net or unpkg.com)`
  );
  assert.notEqual(host, "cdnjs.cloudflare.com", "cdnjs is blocked by production CSP");
});

test("Phase 92.5: _headers CSP must actually allow the html2canvas host", () => {
  const headers = readFileSync(path.join(__dirname2, "..", "_headers"), "utf8");
  const host = new URL(HTML2CANVAS_CDN_URL).host;
  const cspLine = headers.split("\n").find(l => l.includes("Content-Security-Policy")) || "";
  // script-src-elem governs <script src> injection (what loadHtml2Canvas does)
  assert.match(cspLine, /script-src-elem[^;]*\bhttps:\/\/cdn\.jsdelivr\.net\b/, "CSP script-src-elem must allow cdn.jsdelivr.net");
  assert.ok(cspLine.includes(host), `CSP must list the html2canvas host ${host}`);
});

// ── Source-level ─────────────────────────────────────────────────────────
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname2, "..", "main.js"), "utf8");
const lazySrc = readFileSync(path.join(__dirname2, "..", "modules", "lazy_libs.js"), "utf8");
// Phase 92.7: the share/PDF flow moved out of main.js into modules/share_doc.js.
const shareSrc = readFileSync(path.join(__dirname2, "..", "modules", "share_doc.js"), "utf8");

test("Phase 92.4: modules/lazy_libs.js must export loadHtml2Canvas", () => {
  assert.ok(
    /export\s+async\s+function\s+loadHtml2Canvas\s*\(/.test(lazySrc),
    "modules/lazy_libs.js must export async function loadHtml2Canvas"
  );
});

test("Phase 92.4: main.js must import the loader from ./modules/lazy_libs.js", () => {
  assert.ok(
    /from\s+["']\.\/modules\/lazy_libs\.js["']/.test(mainSrc),
    "main.js must import from ./modules/lazy_libs.js"
  );
});

test("Phase 92.4: main.js must NOT still inline the html2canvas CDN <script> injection", () => {
  // The cdnjs URL string moved into the module. If it reappears in main.js the
  // extraction has regressed (someone copied the loader body back).
  assert.ok(
    !/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas/.test(mainSrc),
    "main.js must not inline the html2canvas cdnjs URL (lazy_libs owns it)"
  );
});

test("Phase 92.5: shareDoc must handle a failed html2canvas load (no stuck modal)", () => {
  // The share flow must capture loadHtml2Canvas()'s boolean result and bail out
  // with a user-facing message instead of leaving "กำลังสร้าง PDF..." forever.
  // Phase 92.7: this flow now lives in modules/share_doc.js (injected loader).
  assert.ok(
    /=\s*await\s+loadHtml2Canvas\(\)/.test(shareSrc),
    "share_doc.js must capture the await loadHtml2Canvas() return value (not ignore it)"
  );
  assert.ok(
    /โหลดตัวสร้าง PDF ไม่สำเร็จ/.test(shareSrc),
    "share_doc.js must show a failure message when the PDF generator can't load"
  );
});

test("Phase 92.4: main.js keeps the _loadHtml2Canvas wrapper delegating to the module", () => {
  assert.ok(
    /function\s+_loadHtml2Canvas\s*\(\s*\)/.test(mainSrc),
    "main.js must keep function _loadHtml2Canvas() as a wrapper (preserves the call site)"
  );
  assert.ok(
    /_loadHtml2CanvasImpl\(\s*\{/.test(mainSrc),
    "main.js wrapper must delegate to _loadHtml2CanvasImpl({ ... })"
  );
});
