// ═══════════════════════════════════════════════════════════
//  Lazy library loaders (extracted from main.js in Phase 92.4)
//
//  Dynamically inject heavy third-party scripts only when a feature actually
//  needs them, keeping them out of the initial bundle / first paint.
//  First tenant: html2canvas (~350KB), used by the Share / PDF / image-export
//  paths (window._appShareDoc and friends).
//
//  All DOM/window access is injected so the loaders stay unit-testable without
//  a real browser. main.js keeps a thin `_loadHtml2Canvas()` wrapper.
// ═══════════════════════════════════════════════════════════

// Must be a host allowed by the production CSP (script-src-elem in _headers):
// cdn.jsdelivr.net / unpkg.com are allowed; cdnjs.cloudflare.com is NOT (it was
// the original URL and got blocked → Share/PDF hung — Phase 92.5 hotfix).
export const HTML2CANVAS_CDN_URL =
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

/**
 * Lazily load html2canvas by injecting its CDN <script> once.
 *
 * Contract identical to the original main.js `_loadHtml2Canvas`:
 *   - resolves `true` immediately if `window.html2canvas` is already present
 *     (idempotent — no duplicate <script> injection)
 *   - otherwise appends a <script> to <head>; resolves `true` on load,
 *     `false` on error. NEVER rejects — callers branch on the boolean (and on
 *     `window.html2canvas` afterwards).
 *
 * The only addition over the inline original is a single `logger.warn` on the
 * error path (the original failed silently), surfacing CDN/offline failures
 * without changing the resolve contract or control flow.
 *
 * @param {object}   [opts]
 * @param {Window}   [opts.windowRef=window] — checked for an existing html2canvas
 * @param {Document} [opts.documentRef=document] — script is created + appended here
 * @param {string}   [opts.scriptUrl=HTML2CANVAS_CDN_URL] — source URL
 * @param {object}   [opts.logger=console] — receives `.warn(...)` if the script fails to load
 * @returns {Promise<boolean>} true once html2canvas is available, false on load failure
 */
export async function loadHtml2Canvas({
  windowRef = typeof window !== "undefined" ? window : undefined,
  documentRef = typeof document !== "undefined" ? document : undefined,
  scriptUrl = HTML2CANVAS_CDN_URL,
  logger = typeof console !== "undefined" ? console : null,
} = {}) {
  return new Promise((resolve) => {
    if (windowRef?.html2canvas) { resolve(true); return; }
    if (!documentRef) { resolve(false); return; }
    const s = documentRef.createElement("script");
    s.src = scriptUrl;
    s.onload = () => resolve(true);
    s.onerror = () => {
      logger?.warn?.("[loadHtml2Canvas] failed to load (PDF/share will be unavailable):", scriptUrl);
      resolve(false);
    };
    documentRef.head.appendChild(s);
  });
}
