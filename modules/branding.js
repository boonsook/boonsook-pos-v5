// ═══════════════════════════════════════════════════════════
//  Branding / Logo helpers (extracted from main.js in Phase 92.1)
//
//  Behavior is byte-identical to the original `updateAppLogos()` that lived
//  inline at main.js L4658-4674. Pure DOM operations — no state access, no
//  network. Caller supplies the logo source via `getLogo()` so this stays
//  testable without `window`.
//
//  Phase 92.2 adds the logo *source resolver* (getAppLogo) — the priority
//  chain state.storeInfo.logoUrl > localStorage > default. State + storage are
//  injected so it stays pure; main.js keeps a `window._appGetLogo` wrapper that
//  binds the live `state`.
//
//  Phase 92 backlog (intentionally NOT extracted yet — couples to network):
//    - window._appSyncLogo  (fetches from Supabase storage, async — needs
//                            SUPABASE_CONFIG + access token injected)
//  This will be a follow-up extraction once we agree on the seam.
// ═══════════════════════════════════════════════════════════

/**
 * Paint the store logo into every DOM slot that displays it.
 * Mirrors the original main.js implementation exactly:
 *   - .sidebar-logo-img (one element, sidebar)
 *   - .auth-logo-img (multiple — login + set-password screens)
 *   - .set-profile-logo (settings profile avatar)
 *   - .spinner-logo (loading overlay)
 *   - link[rel="icon"]   (favicon — only when logo is a data: URI, since http
 *                          URLs can't reliably override the static favicon
 *                          and would just trigger a stray fetch)
 *
 * @param {object}        [opts]
 * @param {Document}      [opts.documentRef=document] — DOM root (injectable for tests)
 * @param {() => string}  [opts.getLogo] — returns the current logo URL.
 *                         Defaults to `window._appGetLogo?.()` so existing call
 *                         sites in main.js keep working with no extra args.
 * @returns {void}
 */
export function updateAppLogos({
  documentRef = typeof document !== "undefined" ? document : null,
  getLogo = () => (typeof window !== "undefined" ? window._appGetLogo?.() : undefined),
} = {}) {
  if (!documentRef) return;
  const logo = getLogo();
  if (!logo) return;

  // Sidebar logo
  const sidebarLogo = documentRef.querySelector(".sidebar-logo-img");
  if (sidebarLogo) sidebarLogo.src = logo;
  // Auth/Login logo (มี 2 จุด: login screen + set password screen)
  documentRef.querySelectorAll(".auth-logo-img").forEach(el => { el.src = logo; });
  // Settings profile avatar
  const profileLogo = documentRef.querySelector(".set-profile-logo");
  if (profileLogo) profileLogo.src = logo;
  // Spinner logo (loading overlay)
  const spinnerLogo = documentRef.querySelector(".spinner-logo");
  if (spinnerLogo) spinnerLogo.src = logo;
  // Favicon (เฉพาะ data: URI — http URL จะไม่ override)
  const favicon = documentRef.querySelector('link[rel="icon"]');
  if (favicon && typeof logo === "string" && logo.startsWith("data:")) favicon.href = logo;
}

/**
 * Resolve the current store logo URL.
 *
 * Byte-identical to the original main.js `window._appGetLogo`:
 *   state.storeInfo.logoUrl  (DB-synced, highest priority)
 *     ?? localStorage["bsk_store_logo"]  (offline cache)
 *       ?? "./icons/logo.svg"            (bundled default)
 * Resolution uses `||`, so empty-string / null / undefined at any tier falls
 * through to the next — exactly as before.
 *
 * @param {object}        [opts]
 * @param {object}        [opts.stateRef] — the app `state` object (reads `.storeInfo.logoUrl`)
 * @param {Storage|null}  [opts.storageRef=localStorage] — storage backend (reads "bsk_store_logo")
 * @param {string}        [opts.defaultLogo="./icons/logo.svg"] — final fallback
 * @returns {string} the resolved logo URL
 */
export function getAppLogo({
  stateRef = undefined,
  storageRef = typeof localStorage !== "undefined" ? localStorage : null,
  defaultLogo = "./icons/logo.svg",
} = {}) {
  return stateRef?.storeInfo?.logoUrl
    || storageRef?.getItem("bsk_store_logo")
    || defaultLogo;
}
