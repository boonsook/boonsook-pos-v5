// ning-memory/remember: upsert one long-term memory fact for the Ning agent.
// Endpoint: POST /api/v1/ning-memory/remember   body: { userId, text, tags? }
//
// Phase 569: Ning bot no longer holds the Supabase service-role key. It calls this
// proxy with X-NING-AGENT-KEY (validated in _middleware.js → data.user.authMode
// = "ning_agent"); the service-role write happens here, server-side only.
//
// Security invariants:
//  - authMode must be "ning_agent" (server-to-server) — no browser/JWT user reaches here.
//  - client supplies ONLY userId/text/tags. text_hash is computed SERVER-SIDE
//    (sha256 of trimmed text, hex — must match Python SupabaseLongTermMemory._hash).
//    id/created_at are left to DB defaults. Never accept text_hash/id/created_at from client.
//  - single table (ning_memory_facts), fixed columns — no table/select/filter from request.
//  - never leak raw Supabase error/detail to the client (log server-side, return generic).

import { logServerError, clientError } from "../../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const TABLE = "ning_memory_facts";
const MAX_USER_ID = 160;
const MAX_TEXT = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 64;

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

// sha256 hex of the trimmed text — MUST mirror Python _hash (hashlib.sha256(text).hexdigest()).
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// tags: array of strings only, capped in count and per-item length. Anything else → [].
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, MAX_TAG_LEN));
    if (out.length >= MAX_TAGS) break;
  }
  return out;
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

    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (userId.length < 1 || userId.length > MAX_USER_ID) {
      return jsonResponse({ ok: false, error: "userId (1-160 chars) is required" }, 400);
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length < 1 || text.length > MAX_TEXT) {
      return jsonResponse({ ok: false, error: "text (1-2000 chars) is required" }, 400);
    }
    if (body?.tags !== undefined && !Array.isArray(body.tags)) {
      return jsonResponse({ ok: false, error: "tags must be an array of strings" }, 400);
    }
    const tags = normalizeTags(body?.tags);
    const textHash = await sha256Hex(text);

    // Server-built row: id/created_at = DB defaults, text_hash = server-computed.
    const row = { user_id: userId, text, text_hash: textHash, tags };
    const rest = `${auth.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch(`${rest}?on_conflict=user_id,text_hash`, {
        method: "POST",
        headers: {
          apikey: auth.apiKey,
          Authorization: auth.authHeader,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify([row]),
        signal: controller.signal,
      });
      const respText = await resp.text().catch(() => "");
      if (!resp.ok) {
        logServerError("[ning-memory/remember] upsert-failed", resp.status, respText.slice(0, 500));
        return jsonResponse(clientError("remember_failed", "remember failed"), 502);
      }
      let rows = [];
      try {
        rows = JSON.parse(respText);
      } catch {
        rows = [];
      }
      const saved = Array.isArray(rows) && rows[0] ? rows[0] : row;
      return jsonResponse({ ok: true, fact: toFact(saved) });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logServerError("[ning-memory/remember] exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "remember exception"), 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { getSupabaseAuth, normalizeTags, sha256Hex, toFact };
