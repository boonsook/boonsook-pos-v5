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

    let payload = {
      severity: rawEvent.severity || "error",
      message: String(rawEvent.message || "unknown").slice(0, 2000),
      stack: rawEvent.stack ? String(rawEvent.stack).slice(0, 8000) : null,
      source: rawEvent.source ? String(rawEvent.source).slice(0, 500) : null,
      url: win.location?.href?.slice(0, 1000) || null,
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

    const token = (typeof getAccessToken === "function" ? getAccessToken() : null) || anonKey;
    try {
      const r = await fetchFn(supabaseUrl + "/rest/v1/error_log", {
        method: "POST",
        headers: {
          "apikey": anonKey,
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
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
