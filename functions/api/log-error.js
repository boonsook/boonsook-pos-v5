// ═══════════════════════════════════════════════════════════
//  /api/log-error — Phase 89.14 (M7)
//  CF Pages Function proxy for error_log INSERT
// ═══════════════════════════════════════════════════════════
//
// Why this exists:
//   error_reporter.js originally POSTed to Supabase REST direct
//   ($supabaseUrl/rest/v1/error_log) with publishable anon key.
//   Anyone with the (published) anon key could spam the table
//   from outside the app — 50/session cap is client-side only.
//
// This proxy adds:
//   1. Rate limit per IP (set in functions/_middleware.js — 60/min)
//   2. Shape validation (size caps already in client, this is a
//      defense-in-depth check)
//   3. Centralizes the Supabase endpoint so we can later switch to
//      a service-role flow without touching client code.
//
// Auth: optional. Errors can fire before login (e.g., token
// expiration crash) — we forward authenticated requests with the
// user's JWT, anonymous requests with the anon key.
// ═══════════════════════════════════════════════════════════

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MoeSC0AubZ4C8LXjNJtq7w_iS1baV0j";

const MAX_LEN = {
  message: 2000,
  stack: 8000,
  source: 500,
  url: 500,
  user_agent: 500,
  fingerprint: 64,
};

const ALLOWED_SEVERITY = new Set(["error", "warning", "info"]);

function clamp(val, max) {
  if (val == null) return null;
  const s = String(val);
  return s.length > max ? s.slice(0, max) : s;
}

function validate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be object" };
  if (!body.message || typeof body.message !== "string") return { ok: false, error: "message required" };
  const sev = body.severity || "error";
  if (!ALLOWED_SEVERITY.has(sev)) return { ok: false, error: "invalid severity" };
  return { ok: true };
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const v = validate(body);
  if (!v.ok) {
    return new Response(JSON.stringify({ ok: false, error: v.error }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Forward with user's JWT if present (RLS will record real user_id);
  // otherwise fall back to anon key.
  const clientAuth = request.headers.get("Authorization");
  const forwardAuth = clientAuth && clientAuth.startsWith("Bearer ") ? clientAuth : `Bearer ${anonKey}`;

  // Sanitize + truncate (defense in depth — client should already cap).
  const payload = {
    severity: body.severity || "error",
    message: clamp(body.message, MAX_LEN.message),
    stack: clamp(body.stack, MAX_LEN.stack),
    source: clamp(body.source, MAX_LEN.source),
    url: clamp(body.url, MAX_LEN.url),
    user_id: body.user_id || null,
    user_agent: clamp(body.user_agent, MAX_LEN.user_agent),
    build: Number.isFinite(body.build) ? body.build : null,
    fingerprint: clamp(body.fingerprint, MAX_LEN.fingerprint),
    extra: body.extra && typeof body.extra === "object" ? body.extra : null,
  };

  try {
    const r = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/error_log`, {
      method: "POST",
      headers: {
        "apikey": anonKey,
        "Authorization": forwardAuth,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errTxt = await r.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: `supabase ${r.status}`, detail: errTxt.slice(0, 500) }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "fetch failed" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
}
