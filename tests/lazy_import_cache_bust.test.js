// Phase 90.7 — Regression tests for dynamic-import cache busting (hotfix)
//
// Bug observed on production build 245:
//   - APP_BUILD = 245 (selfheal sets this from data-app-build)
//   - DevTools Network shows /modules/loyalty.js fetched fresh, with the
//     Phase 90.6 code (table='loyalty_settings', proper Promise/await).
//   - But the click handler at runtime still calls _appXhrPatch with the
//     OLD 244-era args ('/api/loyalty-settings/<id>' + callback).
//
// Root cause:
//   main.js loads modules via dynamic import without cache-busting the URL:
//
//     function _lazyImport(path) {
//       if (!_lazyMod.has(path)) _lazyMod.set(path, import(path));
//                                                  ^^^^^^^^^^^^
//       return _lazyMod.get(path);                 // no ?v= → ESM cache by URL
//     }
//
//   The browser's ES module loader caches modules by URL string. When a
//   user was on build 244, loyalty.js was parsed and registered in memory
//   under the URL '/modules/loyalty.js'. After a soft refresh into build
//   245, main.js?v=245 is fresh, but its `import("./modules/loyalty.js")`
//   call resolves to the SAME URL string → ESM cache hit → old parsed
//   module executes (even though the on-disk file is the new code).
//
//   SW already does `cache: 'reload'` for /modules/ (sw.js:92), so the
//   NETWORK request returns fresh — but the browser's ESM in-memory cache
//   is upstream of the SW. Without a URL-level version in the import(),
//   no amount of SW work or hard-network-fetch can dislodge it.
//
// Fix: append ?v=window.APP_BUILD to every dynamic import URL. Different
// build → different URL → different ESM cache entry → fresh module.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// Extract the _lazyImport function body for inspection
function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  const after = src.slice(start);
  const closeMatch = after.match(/\n}\n/);
  if (!closeMatch) return null;
  return after.slice(0, closeMatch.index + closeMatch[0].length);
}

test("_lazyImport must exist in main.js (entry point for code-split module loads)", () => {
  const fnBody = extractFn(mainSrc, "_lazyImport");
  assert.ok(fnBody, "main.js must contain function _lazyImport(path) { ... }");
});

test("_lazyImport must cache-bust the import URL with window.APP_BUILD", () => {
  const fnBody = extractFn(mainSrc, "_lazyImport");
  assert.ok(fnBody, "_lazyImport must exist");
  // The naked `import(path)` form is the bug — browser ESM cache by URL
  // means the same path resolves to the same in-memory module across builds.
  assert.ok(
    !/\bimport\(\s*path\s*\)/.test(fnBody),
    "_lazyImport must NOT call import(path) without a cache-bust query — that's the Phase 90.7 bug"
  );
  // The fix: the URL passed to import() must come from a cache-busting source.
  // Either _lazyImport itself contains APP_BUILD, or it delegates to a helper
  // (e.g. _bustedUrl) that does. Both are acceptable — what matters is that
  // the URL string passed to import() varies per build.
  const usesAppBuildDirectly = /APP_BUILD/.test(fnBody);
  const usesHelper = /_bustedUrl\(/.test(fnBody);
  assert.ok(
    usesAppBuildDirectly || usesHelper,
    "_lazyImport must reference window.APP_BUILD (directly or via a helper like _bustedUrl) when building the import URL"
  );
});

test("the cache-bust helper (or _lazyImport itself) must read window.APP_BUILD", () => {
  // If _lazyImport delegates to _bustedUrl, the helper must read APP_BUILD.
  // If _lazyImport inlines, APP_BUILD must be in its own body (covered above).
  const lazyBody = extractFn(mainSrc, "_lazyImport") || "";
  const helperBody = extractFn(mainSrc, "_bustedUrl") || "";
  const combined = lazyBody + "\n" + helperBody;
  assert.ok(
    /window\.APP_BUILD|APP_BUILD/.test(combined),
    "the cache-busting code path must reference window.APP_BUILD (selfheal.js sets this from data-app-build)"
  );
  assert.ok(
    /\?v=|"v="|'v='|`v=/.test(combined),
    "the cache-busting code path must emit a ?v= query parameter on the import URL"
  );
});

test("_lazyImport must keep its session cache keyed by path (not version) — same build → cached promise", () => {
  const fnBody = extractFn(mainSrc, "_lazyImport");
  assert.ok(fnBody, "_lazyImport must exist");
  // The session-level cache (_lazyMod Map) should be keyed on `path` so that
  // within one app session, the same module is fetched only once. The URL
  // passed to import() includes the version, but the Map key should not.
  // (If keyed on the versioned URL, the Map still works but is redundant
  // since the version is constant within a session.)
  assert.ok(
    /_lazyMod\.(has|set|get)\(\s*path\s*[,)]/.test(fnBody),
    "_lazyMod cache should be keyed on the bare `path` argument so per-session de-duplication still works"
  );
});

test("Phase 537 (S13) — _lazyImport must evict a rejected import so a transient failure doesn't brick the route", () => {
  const fnBody = extractFn(mainSrc, "_lazyImport");
  assert.ok(fnBody, "_lazyImport must exist");
  // A rejected import() promise must NOT stay cached in _lazyMod. Otherwise one network blip
  // poisons the entry and every later nav to that route reuses the rejected promise until a
  // full page reload. The fix: .catch evicts the entry (keyed by path) and re-throws.
  assert.match(fnBody, /\.catch\(/, "the cached import must have a .catch to handle rejection");
  assert.match(fnBody, /_lazyMod\.delete\(\s*path\s*\)/,
    "a rejected import must be evicted from _lazyMod (keyed by the bare path) so the next nav retries");
  assert.match(fnBody, /throw\b/,
    "the catch must re-throw so the caller still sees the failure (not silently swallowed)");
});

test("Phase 90.7 — all dynamic import() calls in main.js must use cache-bust helper or include ?v=", () => {
  // Find every dynamic `import("...")` call in main.js and require either:
  //   - It's the _lazyImport definition itself (handled by the test above), OR
  //   - The argument contains "?v=" or "APP_BUILD", OR
  //   - The call goes through _lazyImport(...) / a helper that does the busting
  const lines = mainSrc.split("\n");
  const offenders = [];
  lines.forEach((line, idx) => {
    // Match: import("..."), import('...'), import(`...`)
    // Skip TypeScript-style type-only imports (we don't use those) and
    // top-of-file static imports.
    const m = line.match(/\bimport\(\s*([`'"])([^`'"]+)\1\s*\)/);
    if (!m) return;
    const target = m[2];
    // Skip CDN imports (esm.sh etc.) — different cache concerns
    if (/^https?:/.test(target)) return;
    // Local module imports — must include cache-bust
    if (!/\?v=|APP_BUILD/.test(line)) {
      offenders.push({ lineNo: idx + 1, target, src: line.trim() });
    }
  });
  assert.deepEqual(
    offenders,
    [],
    "every local dynamic import() must cache-bust the URL " +
      "(append ?v=window.APP_BUILD or route through a helper that does). " +
      "Offending lines:\n" +
      offenders.map((o) => `  main.js:${o.lineNo}  ${o.src}`).join("\n")
  );
});
