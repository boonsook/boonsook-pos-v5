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
//  Phase 92.3 adds the Supabase Storage *pull* (syncAppLogo) — lists the
//  store-assets bucket via the raw Storage REST endpoint and caches the public
//  logo URL into localStorage. Config / token / fetch / storage are injected.
//  Hardening over the original: the list request now has an AbortController
//  timeout (the inline version had none — a stalled network hung silently) and
//  failures are reported through an injected logger instead of being swallowed.
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

/**
 * Pull the store logo from Supabase Storage and cache its public URL.
 *
 * Mirrors the original main.js `window._appSyncLogo` flow exactly:
 *   1. POST to the `store-assets` bucket list endpoint (prefix "logo", limit 5)
 *   2. Pick the first object whose name starts with "logo."
 *   3. Build the cache-busted public URL (?t=<updated_at|created_at> epoch)
 *   4. Write it to localStorage and repaint — but ONLY when the cache is stale:
 *      no current logo, OR current isn't a data: URI, OR the stored URL differs.
 *      (A user-uploaded data: URI whose URL already matches is left untouched.)
 *
 * Hardening vs. the inline original (per Phase 92.3): the list `fetch` is wrapped
 * in an AbortController timeout (`timeoutMs`) so a stalled network can't hang the
 * request forever, and any failure (offline / abort / non-OK) is logged through
 * the injected `logger` rather than silently swallowed. The localStorage cache
 * still serves the logo on failure, so the UI never breaks.
 *
 * @param {object}        [opts]
 * @param {object|null}   [opts.config] — `window.SUPABASE_CONFIG` ({ url, anonKey })
 * @param {string}        [opts.accessToken] — `window._sbAccessToken`; falls back to anonKey
 * @param {Storage|null}  [opts.storageRef=localStorage] — cache backend
 * @param {Function|null} [opts.fetchImpl=fetch] — injectable fetch (must accept { signal })
 * @param {number}        [opts.timeoutMs=8000] — abort the list request after this long
 * @param {Function}      [opts.onUpdated] — called after a fresh URL is cached (≈ updateAppLogos)
 * @param {object}        [opts.logger=console] — receives `.warn(...)` on failure
 * @returns {Promise<boolean>} true if a new logo URL was cached, false otherwise
 */
export async function syncAppLogo({
  config = undefined,
  accessToken = undefined,
  storageRef = typeof localStorage !== "undefined" ? localStorage : null,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  timeoutMs = 8000,
  onUpdated = undefined,
  logger = typeof console !== "undefined" ? console : null,
} = {}) {
  const cfg = config;
  if (!cfg || !fetchImpl || !storageRef) return false;
  const token = accessToken || cfg.anonKey;

  // Hardening: abort if the list request stalls (original fetch had no timeout).
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const listResp = await fetchImpl(cfg.url + "/storage/v1/object/list/store-assets", {
      method: "POST",
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "logo", limit: 5 }),
      signal: controller ? controller.signal : undefined,
    });
    if (!listResp.ok) return false;
    const files = await listResp.json();
    const logoFile = files.find(f => f.name && f.name.startsWith("logo."));
    if (!logoFile) return false;

    const publicUrl = cfg.url + "/storage/v1/object/public/store-assets/" + logoFile.name + "?t=" + new Date(logoFile.updated_at || logoFile.created_at).getTime();
    const currentLogo = storageRef.getItem("bsk_store_logo") || "";
    // อัปเดตเฉพาะเมื่อยังไม่มี หรือ URL เปลี่ยน (ไม่ทับ data: URI ที่ตรงกันอยู่แล้ว)
    if (!currentLogo || !currentLogo.startsWith("data:") || storageRef.getItem("bsk_store_logo_url") !== publicUrl) {
      storageRef.setItem("bsk_store_logo", publicUrl);
      storageRef.setItem("bsk_store_logo_url", publicUrl);
      if (typeof onUpdated === "function") onUpdated();
      return true;
    }
    return false;
  } catch (e) {
    // offline / aborted / timeout — localStorage cache still serves the logo
    logger?.warn?.("[syncAppLogo] sync skipped (using localStorage cache):", e?.message || e);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
