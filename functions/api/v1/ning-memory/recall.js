// ning-memory/recall: fetch recent long-term memory facts for one Ning user.
// Endpoint: GET /api/v1/ning-memory/recall?userId=<id>&limit=<n>
//
// Phase 569: read side of the Ning memory proxy. Service-role read happens here;
// the Ning bot calls with X-NING-AGENT-KEY only. Returns facts ordered created_at.desc
// (newest first); the Ning HTTP store reverses to insertion order to match the old
// SupabaseLongTermMemory.recall() behavior.
//
// Security invariants:
//  - authMode must be "ning_agent".
//  - filter by user_id ONLY; select/order are fixed server-side (no arbitrary
//    select/filter/order from the request). limit clamped 1-50.
//  - never leak raw Supabase error/detail to the client.

import { logServerError, clientError } from "../../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const TABLE = "ning_memory_facts";
const SELECT_COLS = "id,user_id,text,created_at,tags";
const MAX_USER_ID = 160;
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;
const LIMIT_DEFAULT = 5;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getSupabaseAuth({ env, data }) {
  if (data?.user?.authMode !== "ning_agent") {
    return { ok: false, status: 403, error: "Forbidden: Ning agent auth required" };
  }
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return { ok: false, status: 500, error: "SUPABASE_SERVICE_ROLE_KEY is required for Ning agent reads" };
  }
  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  return { ok: true, supabaseUrl, apiKey: serviceRoleKey, authHeader: `Bearer ${serviceRoleKey}` };
}

function clampLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, n));
}

function toFact(row) {
  return {
    id: row?.id ?? null,
    user_id: row?.user_id ?? null,
    text: row?.text ?? null,
    created_at: row?.created_at ?? null,
    tags: Array.isArray(row?.tags) ? row.tags : [],
  };
}

export async function onRequestGet({ request, env, data }) {
  try {
    const auth = getSupabaseAuth({ env, data });
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    const url = new URL(request.url);
    const userId = (url.searchParams.get("userId") || "").trim();
    if (userId.length < 1 || userId.length > MAX_USER_ID) {
      return jsonResponse({ ok: false, error: "userId (1-160 chars) is required" }, 400);
    }
    const limit = clampLimit(url.searchParams.get("limit"));

    const rest = `${auth.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
    const query =
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=${SELECT_COLS}&order=created_at.desc&limit=${limit}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch(`${rest}${query}`, {
        headers: { apikey: auth.apiKey, Authorization: auth.authHeader },
        signal: controller.signal,
      });
      const respText = await resp.text().catch(() => "");
      if (!resp.ok) {
        logServerError("[ning-memory/recall] fetch-failed", resp.status, respText.slice(0, 500));
        return jsonResponse(clientError("recall_failed", "recall failed"), 502);
      }
      let rows = [];
      try {
        rows = JSON.parse(respText);
      } catch {
        rows = [];
      }
      const facts = Array.isArray(rows) ? rows.map(toFact) : [];
      return jsonResponse({ ok: true, facts });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logServerError("[ning-memory/recall] exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "recall exception"), 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { getSupabaseAuth, clampLimit, toFact };
