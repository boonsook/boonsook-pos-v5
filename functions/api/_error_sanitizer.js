// functions/api/_error_sanitizer.js
// Phase 515 (audit S4) — shared error sanitizer for Cloudflare Pages Functions.
//
// Why: several /api/* functions returned raw internals to the client on failure —
//   JS stack traces, raw provider (Gemini/Supabase) error bodies, model names,
//   per-attempt dumps. Even behind auth that is needless info-disclosure that helps
//   recon. The fix pattern: log the FULL detail server-side (visible in Cloudflare
//   logs), return only a generic message + a stable error code to the client.
//
// The `_` prefix keeps this file OUT of the Pages Functions route table (helper only).

// Log full failure detail to the server (Cloudflare function logs). Must never throw —
// a logging failure must not turn into a 500 of its own.
export function logServerError(label, ...detail) {
  try {
    // eslint-disable-next-line no-console
    console.error(label, ...detail);
  } catch (_e) { /* logging must never throw */ }
}

// Build a client-safe error body. NEVER carries stack / raw provider output / internal
// detail / attempts. `extra` is a whitelist for genuinely user-facing fields only
// (e.g. { hint } operator guidance, { configured: false } setup state) — callers must
// not pass internals through it.
export function clientError(code, message, extra = {}) {
  return { ok: false, error: message, code, ...extra };
}
