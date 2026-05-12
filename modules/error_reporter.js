// ═══════════════════════════════════════════════════════════
// Phase 89.12 — Error reporter (homegrown, POSTs to Supabase error_log)
//
// Replaces Sentry — app has no build step / source maps so Sentry's main
// value (de-minified stack) doesn't apply. Storage piggybacks on Supabase.
//
// API:
//   const reporter = installErrorReporter({ fetcher, supabaseUrl, anonKey,
//     getAccessToken, getUserId, build, beforeSend, maxPerSession, logger });
//   reporter.captureMessage("warn", { severity: "warning" });
//   reporter.captureException(err);
//   reporter.teardown();  // remove window listeners (for tests)
//
// Behavior:
//   - Hooks window.error + window.unhandledrejection.
//   - Dedups within a session by fingerprint (message + source).
//   - Caps total events per session (default 50) to defend against infinite-loop spam.
//   - beforeSend(payload) → payload | null  — filter noise (e.g., ResizeObserver loop).
//   - POST is fire-and-forget; failure logged to console.warn, never throws.
// ═══════════════════════════════════════════════════════════

export function installErrorReporter({
  fetcher,
  supabaseUrl,
  anonKey,
  getAccessToken,
  getUserId,
  build,
  beforeSend,
  maxPerSession = 50,
  logger = console,
  windowRef,
}) {
  const win = windowRef || (typeof window !== "undefined" ? window : null);
  const fetchFn = fetcher || (typeof fetch === "function" ? fetch : null);

  // If we can't even reach a window or fetch, just no-op (e.g., SSR or test env).
  if (!win || !fetchFn || !supabaseUrl || !anonKey) {
    return {
      captureMessage: () => {},
      captureException: () => {},
      teardown: () => {},
      _stats: () => ({ sent: 0, dedupped: 0, dropped: 0, disabled: true }),
    };
  }

  const sent = new Set();
  let stats = { sent: 0, dedupped: 0, dropped: 0 };

  function fingerprint(message, source) {
    const s = String(message || "") + "|" + String(source || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  }

  async function send(rawEvent) {
    const fp = fingerprint(rawEvent.message, rawEvent.source);

    if (sent.has(fp)) {
      stats.dedupped++;
      return;
    }
    if (stats.sent >= maxPerSession) {
      stats.dropped++;
      return;
    }

    // Phase 89.13: mark fingerprint + count BEFORE beforeSend/await to close the race window.
    // Without this, a tight error loop (e.g. infinite render bug) can pass both guards in
    // parallel before either branch reaches the add/increment, bursting dozens of POSTs.
    // A throwing beforeSend is also handled — fp stays marked so we don't re-enter forever.
    sent.add(fp);
    stats.sent++;

    // Phase 89.13: read build lazily so it isn't snapshot as null when reporter installs
    // before APP_BUILD is set on window.
    const buildVal = (typeof build === "function") ? build() :
                     (Number.isFinite(build) ? build : null);

    // Phase 89.14 (L4): redact URL — เก็บแค่ origin + pathname, ตัด query string + hash
    // เหตุผล: share.html ใช้ ?token=..., reset password ใช้ ?code=..., OTP ใช้ ?otp=...
    // ถ้า client crash บนหน้าเหล่านี้ → token จะลงไปใน error_log ผ่าน publishable key อ่านได้ทันที.
    function _redactUrl(u) {
      if (!u) return null;
      try {
        const parsed = new URL(u);
        return (parsed.origin + parsed.pathname).slice(0, 500);
      } catch {
        return String(u).split("?")[0].split("#")[0].slice(0, 500);
      }
    }

    let payload = {
      severity: rawEvent.severity || "error",
      message: String(rawEvent.message || "unknown").slice(0, 2000),
      stack: rawEvent.stack ? String(rawEvent.stack).slice(0, 8000) : null,
      source: rawEvent.source ? String(rawEvent.source).slice(0, 500) : null,
      url: _redactUrl(win.location?.href),
      user_id: (typeof getUserId === "function" ? getUserId() : null) || null,
      user_agent: win.navigator?.userAgent?.slice(0, 500) || null,
      build: Number.isFinite(buildVal) ? buildVal : null,
      fingerprint: fp,
      extra: rawEvent.extra || null,
    };

    if (typeof beforeSend === "function") {
      try {
        payload = beforeSend(payload);
      } catch (e) {
        logger?.warn?.("[errorReporter] beforeSend threw:", e);
        payload = null;
      }
      if (!payload) {
        stats.dropped++;
        stats.sent--; // refund the slot — filtered events shouldn't eat the cap
        return;
      }
    }

    // Phase 89.14 (M7): POST ผ่าน CF proxy /api/log-error แทน Supabase REST direct
    // เหตุผล: anon key public อ่านได้ → attacker spam table ตรงด้วย POST /rest/v1/error_log
    // proxy ใช้ rate limit ของ middleware (60/min/IP) + validate shape ก่อน forward
    const token = (typeof getAccessToken === "function" ? getAccessToken() : null);
    const headers = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    try {
      const r = await fetchFn(win.location.origin + "/api/log-error", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      // Phase 89.13: fetch resolves on 4xx/5xx — surface RLS/PGRST204 so silent loss is visible
      if (r && !r.ok) logger?.warn?.("[errorReporter] POST non-2xx:", r.status);
    } catch (e) {
      logger?.warn?.("[errorReporter] POST failed:", e?.message || e);
    }
  }

  function onError(ev) {
    send({
      severity: "error",
      message: ev.message || (ev.error && ev.error.message) || "Unknown error",
      stack: ev.error?.stack || null,
      source: ev.filename ? `${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}` : null,
    });
  }

  function onRejection(ev) {
    const reason = ev.reason;
    const isErr = reason && typeof reason === "object";
    send({
      severity: "error",
      message: "Unhandled promise rejection: " +
               (isErr ? (reason.message || String(reason)) : String(reason)),
      stack: isErr ? (reason.stack || null) : null,
    });
  }

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  return {
    captureMessage: (message, opts = {}) =>
      send({ severity: "info", ...opts, message }),
    captureException: (error, opts = {}) =>
      send({
        severity: "error",
        ...opts,
        message: error?.message || String(error),
        stack: error?.stack || null,
      }),
    teardown: () => {
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejection);
    },
    _stats: () => ({ ...stats }),
    _fingerprint: fingerprint,
  };
}
