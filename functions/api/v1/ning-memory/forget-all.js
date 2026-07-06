// ning-memory/forget-all: delete ALL long-term memory facts for one Ning user.
// Endpoint: POST /api/v1/ning-memory/forget-all   body: { userId }
//
// Phase 569: destructive delete side of the Ning memory proxy.
//
// ⚠️ HIGHEST-RISK endpoint — a DELETE without a filter would wipe the whole table.
// Invariants (hard):
//  - authMode must be "ning_agent".
//  - userId is validated (non-empty string, 1-160) BEFORE any DELETE is issued.
//  - the DELETE URL ALWAYS carries user_id=eq.<userId>. There is no code path that
//    issues a DELETE on this table without that filter.
//  - never leak raw Supabase error/detail to the client.

import { logServerError, clientError } from "../../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const TABLE = "ning_memory_facts";
const MAX_USER_ID = 160;

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
    return { ok: false, status: 500, error: "SUPABASE_SERVICE_ROLE_KEY is required for Ning agent writes" };
  }
  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  return { ok: true, supabaseUrl, apiKey: serviceRoleKey, authHeader: `Bearer ${serviceRoleKey}` };
}

export async function onRequestPost({ request, env, data }) {
  try {
    const auth = getSupabaseAuth({ env, data });
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    // Hard guard: never proceed to DELETE without a valid, non-empty userId.
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (userId.length < 1 || userId.length > MAX_USER_ID) {
      return jsonResponse({ ok: false, error: "userId (1-160 chars) is required" }, 400);
    }

    // DELETE is ALWAYS scoped by user_id=eq.<userId> — the only DELETE in this file.
    const rest = `${auth.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
    const deleteUrl = `${rest}?user_id=eq.${encodeURIComponent(userId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch(deleteUrl, {
        method: "DELETE",
        headers: {
          apikey: auth.apiKey,
          Authorization: auth.authHeader,
          Prefer: "return=representation",
        },
        signal: controller.signal,
      });
      const respText = await resp.text().catch(() => "");
      if (!resp.ok) {
        logServerError("[ning-memory/forget-all] delete-failed", resp.status, respText.slice(0, 500));
        return jsonResponse(clientError("forget_all_failed", "forget-all failed"), 502);
      }
      let rows = [];
      try {
        rows = JSON.parse(respText);
      } catch {
        rows = [];
      }
      return jsonResponse({ ok: true, deleted: Array.isArray(rows) ? rows.length : 0 });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logServerError("[ning-memory/forget-all] exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "forget-all exception"), 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { getSupabaseAuth };
