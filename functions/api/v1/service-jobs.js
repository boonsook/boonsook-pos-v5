// Phase 1 service-job create endpoint for the Ning agent (LINE).
// Endpoint: POST /api/v1/service-jobs
//
// Lets the Ning server create a minimal "service request" row in service_jobs
// (customer + symptom only). It is intentionally money/stock SAFE:
//   - total_cost = 0           → the accounting JV gate is >0, so this never posts to the ledger
//   - items_json = []          → no equipment, so no stock movement happens
//   - status = "pending"       → open job; staff fill in details / close it in the app later
// Auth: Ning server-to-server only (X-NING-AGENT-KEY validated in _middleware.js,
// which sets data.user.authMode = "ning_agent"). Writes use the service-role key.
// Phase 516 (audit S4): sanitize error responses — log full detail server-side, never to client.

import { logServerError, clientError } from "../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const NING_SOURCE_MARKER = "[via Ning LINE group]";
const NEW_JOB_STATUS = "pending";

// service_jobs.job_type has a DB CHECK constraint; "other" is the safe generic
// bucket for a Ning-captured request (staff re-classify in the app later).
const ALLOWED_JOB_TYPES = new Set([
  "ac", "repair_ac", "clean_ac", "move_ac", "service_install",
  "repair_fridge", "repair_washer", "repair_tv", "cctv", "satellite",
  "solar", "other",
]);

function normalizeJobType(value) {
  const t = (value == null ? "" : String(value)).trim();
  return ALLOWED_JOB_TYPES.has(t) ? t : "other";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function buildJobRecord(body) {
  const customerName = cleanText(body?.customer_name, 200);
  const description = cleanText(body?.description, 2000);
  if (!customerName || !description) {
    return { ok: false, error: "customer_name and description are required" };
  }

  const baseNote = cleanText(body?.note, 1000);
  const note = baseNote ? `${baseNote} ${NING_SOURCE_MARKER}` : NING_SOURCE_MARKER;

  return {
    ok: true,
    record: {
      job_no: "JOB-" + Date.now(),            // service_jobs.job_no is NOT NULL
      customer_name: customerName,
      customer_phone: cleanText(body?.customer_phone, 50),
      customer_address: cleanText(body?.customer_address, 500),
      job_type: normalizeJobType(body?.job_type),
      description,
      status: NEW_JOB_STATUS,
      total_cost: 0,                           // NOT NULL; 0 keeps it out of accounting (JV gate >0)
      items_json: [],                          // no equipment → no stock movement
      closed_at: null,
      note,
    },
  };
}

// Ning writes must use the server-only service-role key and never a public key.
function getSupabaseWriteAuth({ env, data }) {
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
    const auth = getSupabaseWriteAuth({ env, data });
    if (!auth.ok) {
      return jsonResponse({ ok: false, error: auth.error }, auth.status);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const built = buildJobRecord(body);
    if (!built.ok) {
      return jsonResponse({ ok: false, error: built.error }, 400);
    }

    const url = `${auth.supabaseUrl.replace(/\/+$/, "")}/rest/v1/service_jobs`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "apikey": auth.apiKey,
          "Authorization": auth.authHeader,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify([built.record]),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      // Return 200 with ok:false so the failure is never hidden behind a Cloudflare 5xx
      // page; the Ning client checks the ok flag, not the status.
      // Phase 516: raw supabase body → server logs only (Ning reads ok flag, not detail)
      logServerError("[service-jobs] insert-failed", response.status, text.slice(0, 500));
      return jsonResponse(clientError("insert_failed", "service_jobs insert failed"));
    }

    let rows = [];
    try {
      rows = JSON.parse(text);
    } catch {
      rows = [];
    }
    const created = Array.isArray(rows) ? rows[0] : rows;
    return jsonResponse({
      ok: true,
      id: created?.id ?? null,
      job_no: created?.job_no ?? built.record.job_no,
    });
  } catch (e) {
    // Phase 516: never leak exception name/message to client — log server-side
    logServerError("[service-jobs] exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "service_jobs create exception"));
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { buildJobRecord, getSupabaseWriteAuth };
