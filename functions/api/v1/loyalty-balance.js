// loyalty-balance: a customer reads THEIR OWN loyalty balance via a service-role proxy.
// Endpoint: GET /api/v1/loyalty-balance
//
// Phase 580: loyalty_points has a RESTRICTIVE deny for the customer role (Phase 505 GROUP A),
// so a customer's own client can't read it → state.loyaltyPoints is empty for customers →
// customer_dashboard showed "0 แต้ม" forever. This proxy reads with the service-role key
// (bypasses RLS) but DERIVES the customer identity from the verified JWT ONLY — never from the
// request — so customer A can never read customer B's points.
//
// Security invariants:
//  - identity = data.user.email (middleware-verified JWT) → phone → customers.id.
//    NEVER read phone / customer_id from query string or body. (This is the isolation boundary.)
//  - email must be the customer format <phone>@phone.boonsook.local; otherwise 403.
//  - Ning agent auth (no customer identity) → 403.
//  - SUPABASE_SERVICE_ROLE_KEY required (no anon fallback); never leak raw Supabase error.

import { logServerError, clientError } from "../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const CUSTOMER_EMAIL_SUFFIX = "@phone.boonsook.local";
const PAGE = 1000;          // PostgREST default cap — paginate กัน >1000 loyalty rows/ลูกค้า
const RECENT_LIMIT = 20;    // ประวัติแต้มล่าสุดที่ส่งกลับ (newest first)

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// phone จาก JWT email (server-derived) — ★ ห้ามรับ phone/customer_id จาก request เด็ดขาด.
//   customer login = <phone>@phone.boonsook.local; รับเฉพาะ format นี้ + phone เป็นตัวเลข.
function phoneFromEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.endsWith(CUSTOMER_EMAIL_SUFFIX)) return null;
  const phone = e.slice(0, -CUSTOMER_EMAIL_SUFFIX.length);
  return /^[0-9]{6,15}$/.test(phone) ? phone : null;
}

function getServiceAuth(env) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return { ok: false, status: 500, error: "SUPABASE_SERVICE_ROLE_KEY is required for loyalty-balance reads" };
  }
  const supabaseUrl = (env.SUPABASE_URL || PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  return { ok: true, supabaseUrl, apiKey: serviceRoleKey, authHeader: `Bearer ${serviceRoleKey}` };
}

// service-role GET → { ok, rows } / { ok:false, status, text } (12s timeout, ไม่ throw ออกนอก)
async function sbGet(url, auth) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      headers: { apikey: auth.apiKey, Authorization: auth.authHeader },
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) return { ok: false, status: resp.status, text };
    let rows = [];
    try { rows = JSON.parse(text); } catch { rows = []; }
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } finally {
    clearTimeout(timer);
  }
}

function toRecent(t) {
  return {
    type: t?.type ?? null,
    points: Number(t?.points || 0),
    ref_type: t?.ref_type ?? null,
    created_at: t?.created_at ?? null,
    note: t?.note ?? null,
  };
}

export async function onRequestGet({ env, data }) {
  try {
    // ★ identity: จาก JWT ที่ middleware verify แล้วเท่านั้น (ไม่แตะ request body/query)
    if (data?.user?.authMode === "ning_agent") {
      return jsonResponse({ ok: false, error: "Forbidden: customer auth required" }, 403);
    }
    const phone = phoneFromEmail(data?.user?.email);
    if (!phone) {
      return jsonResponse({ ok: false, error: "Forbidden: not a customer account" }, 403);
    }

    const auth = getServiceAuth(env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    // 1) phone → customer_id (service-role; mirror customer_dashboard = first match, ordered id.asc ให้ deterministic).
    //    edge: หลาย row phone เดียว (record ซ้ำ) → ใช้ตัวแรก ให้ตรงกับที่หน้าลูกค้า map เดิม (phone = identity เดียว).
    const cr = await sbGet(`${auth.supabaseUrl}/rest/v1/customers?phone=eq.${encodeURIComponent(phone)}&select=id&order=id.asc&limit=1`, auth);
    if (!cr.ok) {
      logServerError("[loyalty-balance] customer-lookup", cr.status, (cr.text || "").slice(0, 300));
      return jsonResponse(clientError("lookup_failed", "customer lookup failed"), 502);
    }
    const customerId = cr.rows?.[0]?.id;
    if (customerId == null) {
      // ลูกค้าใหม่ยังไม่มี customers record = 0 แต้มจริง (ตรวจครบแล้ว ไม่ใช่ fail)
      return jsonResponse({ ok: true, balance: 0, earned: 0, redeemed: 0, recent: [] });
    }

    // 2) loyalty_points (paginate) → balance = Σ earn − Σ redeem (mirror getCustomerPoints ฝั่ง server)
    let earned = 0, redeemed = 0;
    let recent = [];
    for (let offset = 0; ; offset += PAGE) {
      const lr = await sbGet(
        `${auth.supabaseUrl}/rest/v1/loyalty_points?customer_id=eq.${encodeURIComponent(customerId)}` +
        `&select=type,points,ref_type,created_at,note&order=created_at.desc&limit=${PAGE}&offset=${offset}`,
        auth
      );
      if (!lr.ok) {
        logServerError("[loyalty-balance] points-fetch", lr.status, (lr.text || "").slice(0, 300));
        return jsonResponse(clientError("points_failed", "loyalty points fetch failed"), 502);
      }
      for (const t of lr.rows) {
        const pts = Number(t.points || 0);
        if (t.type === "earn") earned += pts;
        else if (t.type === "redeem") redeemed += pts;
      }
      if (offset === 0) recent = lr.rows.slice(0, RECENT_LIMIT).map(toRecent);  // newest first — เก็บจากหน้าแรกพอ
      if (lr.rows.length < PAGE) break;
    }

    return jsonResponse({ ok: true, balance: earned - redeemed, earned, redeemed, recent });
  } catch (e) {
    logServerError("[loyalty-balance] exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "loyalty-balance exception"), 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { phoneFromEmail, getServiceAuth, toRecent };
