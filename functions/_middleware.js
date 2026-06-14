// ═══════════════════════════════════════════════════════════
//  Cloudflare Pages Functions — Global Middleware (Phase 17)
//  ครอบทุก /api/* — Rate limiting + CORS + (เฉพาะบาง endpoint) Auth
// ═══════════════════════════════════════════════════════════
//
// ★ KV Binding setup (User ต้องตั้ง 1 ครั้ง):
// 1. Cloudflare Dashboard → Workers & Pages → boonsook-pos-v5
// 2. Settings → Functions → KV namespace bindings → Add binding
//    Variable name:  RATE_LIMIT_KV
//    KV namespace:   (สร้างใหม่ชื่อ "boonsook-rate-limit")
// 3. Save → trigger redeploy
//
// ถ้าไม่ตั้ง KV → app ใช้งานได้ปกติ แค่ไม่มี rate limit (warn ใน console)
//

// Rate limit config ต่อ endpoint (req/นาที/IP)
const RATE_LIMITS = {
  "/api/send-otp":      { limit: 5,   windowSec: 60 },  // OTP ส่ง SMS — Twilio cost จริง
  "/api/verify-otp":    { limit: 10,  windowSec: 60 },  // ป้องกัน brute-force OTP
  "/api/line-notify":   { limit: 30,  windowSec: 60 },
  "/api/ai-assistant":  { limit: 20,  windowSec: 60 },  // AI inference cost
  "/api/parse-receipt": { limit: 10,  windowSec: 60 },  // Phase 89.14: Gemini OCR — cost ต่อ image
  "/api/verify-slip":   { limit: 20,  windowSec: 60 },  // Phase 89.14: SlipOK 3rd-party — cost ต่อ verify
  "/api/log-error":     { limit: 60,  windowSec: 60 },  // Phase 89.14: error_log proxy — burst-tolerant, spam-resistant
  "default":            { limit: 100, windowSec: 60 }   // ทุก endpoint อื่น
};

// Allowed origins (CORS)
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/(www\.)?boonsukair\.com$/,
  /^https?:\/\/.*\.pages\.dev$/,        // Cloudflare preview / production
  /^http:\/\/localhost(:\d+)?$/,        // Dev
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

// Endpoints ที่ต้อง require Supabase JWT
const REQUIRE_AUTH_ENDPOINTS = [
  "/api/ai-assistant",
  "/api/line-notify",
  "/api/v1/reports/daily-summary",
  "/api/parse-receipt",   // Phase 89.14: ปิด anon — Gemini OCR ใช้แค่ staff ที่ login
  "/api/verify-slip"      // Phase 89.14: ปิด anon — SlipOK ใช้แค่ staff ที่ login
];

const STAFF_ONLY_ENDPOINTS = [
  "/api/line-notify"
];

const REPORT_ONLY_ENDPOINTS = [
  "/api/v1/reports/daily-summary"
];

const STAFF_ROLES = new Set(["admin", "sales", "staff", "technician"]);
const REPORT_ROLES = new Set(["admin", "owner"]);

// Public Supabase client config. Keep env vars preferred, but provide the same
// public values used by supabase-config.js so Pages deploys work without extra
// dashboard edits for role verification.
const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MoeSC0AubZ4C8LXjNJtq7w_iS1baV0j";

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin || ""));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://boonsukair.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, X-NING-AGENT-KEY",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function getClientIp(request) {
  // Cloudflare provides client IP in CF-Connecting-IP header
  return request.headers.get("CF-Connecting-IP") ||
         request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
         "unknown";
}

async function checkRateLimit(env, ip, pathname) {
  const cfg = RATE_LIMITS[pathname] || RATE_LIMITS.default;
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / cfg.windowSec);
  const key = `rl:${pathname}:${ip}:${window}`;

  // ถ้าไม่มี KV binding → skip (graceful)
  if (!env.RATE_LIMIT_KV) {
    return { ok: true, remaining: cfg.limit, skipped: true };
  }

  try {
    const cur = await env.RATE_LIMIT_KV.get(key);
    const count = cur ? parseInt(cur, 10) : 0;
    if (count >= cfg.limit) {
      const retryAfter = cfg.windowSec - (now % cfg.windowSec);
      return { ok: false, remaining: 0, retryAfter };
    }
    // Increment + set TTL
    await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: cfg.windowSec * 2 });
    return { ok: true, remaining: cfg.limit - count - 1, limit: cfg.limit };
  } catch (e) {
    // KV error — fail-open (อย่า block traffic)
    console.warn("[rate-limit] KV error:", e.message);
    return { ok: true, remaining: cfg.limit, error: e.message };
  }
}

function base64UrlDecodeBytes(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlDecodeJson(input) {
  const text = new TextDecoder().decode(base64UrlDecodeBytes(input));
  return JSON.parse(text);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function signHs256(input, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(input)));
}

async function verifyWithSupabaseAuth(authHeader, env) {
  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !apiKey) {
    console.error("[auth] SUPABASE_JWT_SECRET or SUPABASE_URL + SUPABASE_ANON_KEY is required");
    return { ok: false, error: "Server auth verification is not configured" };
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      "apikey": apiKey,
      "Authorization": authHeader
    }
  });

  if (!response.ok) {
    return { ok: false, error: "Invalid token" };
  }

  const user = await response.json().catch(() => null);
  if (!user?.id) {
    return { ok: false, error: "Invalid token user" };
  }

  return { ok: true, userId: user.id, email: user.email };
}

async function fetchUserRole(userId, authHeader, env) {
  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !apiKey) {
    console.error("[auth] SUPABASE_URL + SUPABASE_ANON_KEY is required for role checks");
    return { ok: false, error: "Server role verification is not configured" };
  }

  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`;
  const response = await fetch(url, {
    headers: {
      "apikey": apiKey,
      "Authorization": authHeader,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    return { ok: false, error: "Cannot verify user role" };
  }

  const rows = await response.json().catch(() => []);
  const role = rows?.[0]?.role || null;
  if (!role) {
    return { ok: false, error: "No profile role found" };
  }

  return { ok: true, role };
}

async function verifyAuthToken(authHeader, env) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, error: "Missing Authorization Bearer token" };
  }

  const token = authHeader.slice(7);
  // Verify JWT signature before trusting any payload fields.
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, error: "Invalid JWT format" };
    const header = base64UrlDecodeJson(parts[0]);
    if (!env.SUPABASE_JWT_SECRET || header.alg !== "HS256") {
      return await verifyWithSupabaseAuth(authHeader, env);
    }

    const expectedSig = await signHs256(`${parts[0]}.${parts[1]}`, env.SUPABASE_JWT_SECRET);
    const actualSig = base64UrlDecodeBytes(parts[2]);
    if (!timingSafeEqual(actualSig, expectedSig)) {
      return { ok: false, error: "Invalid JWT signature" };
    }

    const payload = base64UrlDecodeJson(parts[1]);
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      return { ok: false, error: "Token expired" };
    }
    if (payload.nbf && payload.nbf * 1000 > Date.now()) {
      return { ok: false, error: "Token not active yet" };
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.aud && !audiences.includes("authenticated")) {
      return { ok: false, error: "Invalid JWT audience" };
    }
    if (!payload.sub) return { ok: false, error: "No subject in token" };
    return { ok: true, userId: payload.sub, email: payload.email };
  } catch (e) {
    return { ok: false, error: "Invalid token: " + e.message };
  }
}

function verifyNingAgentKey(request, env) {
  const provided = request.headers.get("X-NING-AGENT-KEY");
  if (!provided) return { ok: false, skipped: true };

  const expected = env.NING_AGENT_API_KEY;
  if (!expected || String(expected).length < 24) {
    return { ok: false, error: "Ning agent auth is not configured" };
  }

  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(provided);
  const expectedBytes = encoder.encode(String(expected));
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, error: "Invalid Ning agent key" };
  }

  return { ok: true };
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const corsHeaders = getCorsHeaders(origin);

  // ── ผ่านเฉพาะ /api/* — request อื่นปล่อยผ่าน ──
  if (!url.pathname.startsWith("/api/")) {
    return await next();
  }

  // ── CORS Preflight ──
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Rate Limit ──
  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, ip, url.pathname);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Too many requests",
        retryAfter: rl.retryAfter,
        message: `กรุณารอ ${rl.retryAfter} วินาที แล้วลองใหม่`
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfter || 60)
        }
      }
    );
  }

  // ── Auth check (เฉพาะ endpoint ที่ระบุ) ──
  if (REQUIRE_AUTH_ENDPOINTS.includes(url.pathname)) {
    if (REPORT_ONLY_ENDPOINTS.includes(url.pathname)) {
      const agentAuth = verifyNingAgentKey(request, env);
      if (agentAuth.ok) {
        context.data = context.data || {};
        context.data.user = {
          id: "ning-agent",
          email: null,
          role: "owner",
          authMode: "ning_agent"
        };

        const response = await next();
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
        if (rl.limit) newHeaders.set("X-RateLimit-Limit", String(rl.limit));
        if (rl.remaining !== undefined) newHeaders.set("X-RateLimit-Remaining", String(rl.remaining));
        if (rl.skipped) newHeaders.set("X-RateLimit-Skipped", "no-kv-binding");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
      if (!agentAuth.skipped) {
        return new Response(
          JSON.stringify({ ok: false, error: "Unauthorized: " + agentAuth.error }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const authHeader = request.headers.get("Authorization");
    const auth = await verifyAuthToken(authHeader, env);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized: " + auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Pass user info ผ่าน data context
    let role = null;
    if (STAFF_ONLY_ENDPOINTS.includes(url.pathname) || REPORT_ONLY_ENDPOINTS.includes(url.pathname)) {
      const roleResult = await fetchUserRole(auth.userId, authHeader, env);
      if (!roleResult.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden: " + roleResult.error }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      role = roleResult.role;
      if (STAFF_ONLY_ENDPOINTS.includes(url.pathname) && !STAFF_ROLES.has(role)) {
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden: staff role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (REPORT_ONLY_ENDPOINTS.includes(url.pathname) && !REPORT_ROLES.has(role)) {
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden: report role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    context.data = context.data || {};
    context.data.user = { id: auth.userId, email: auth.email, role };
  }

  // ── ยิงต่อไปยัง endpoint จริง + ใส่ CORS headers + rate limit headers ใน response ──
  const response = await next();
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  if (rl.limit) newHeaders.set("X-RateLimit-Limit", String(rl.limit));
  if (rl.remaining !== undefined) newHeaders.set("X-RateLimit-Remaining", String(rl.remaining));
  if (rl.skipped) newHeaders.set("X-RateLimit-Skipped", "no-kv-binding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
