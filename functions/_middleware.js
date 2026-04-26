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
  "/api/ai-assistant"
];

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin || ""));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://boonsukair.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
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

async function verifyAuthToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, error: "Missing Authorization Bearer token" };
  }
  const token = authHeader.slice(7);
  // Decode JWT ตรวจ exp (lightweight — ไม่ต้อง round-trip กับ Supabase ทุกครั้ง)
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, error: "Invalid JWT format" };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      return { ok: false, error: "Token expired" };
    }
    if (!payload.sub) return { ok: false, error: "No subject in token" };
    return { ok: true, userId: payload.sub, email: payload.email };
  } catch (e) {
    return { ok: false, error: "Invalid token: " + e.message };
  }
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
    const authHeader = request.headers.get("Authorization");
    const auth = await verifyAuthToken(authHeader);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized: " + auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Pass user info ผ่าน data context
    context.data = context.data || {};
    context.data.user = { id: auth.userId, email: auth.email };
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
