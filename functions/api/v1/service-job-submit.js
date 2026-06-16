// service-job-submit: mark an existing open service_job as "ช่างส่ง — รออนุมัติ".
// Endpoint: POST /api/v1/service-job-submit   body: { customer_phone, note? }
//
// Money/stock SAFE: only sets status="pending" (a DB-valid status that does NOT
// trigger any JV — accounting fires only on done/delivered/closed) plus the
// [รออนุมัติแอดมิน] note marker. Never writes money / payment / cost or stock columns.
// Admin reviews + closes (with money) in the app later.
//
// Why status stays "pending": the DB CHECK (service_jobs_status_check) only allows
// pending/progress/done/delivered/closed/cancelled — "pending_review" is invalid, so
// the app stores the review state as pending + the note marker (see modules/service_status.js).
//
// Auth: Ning server-to-server only (X-NING-AGENT-KEY → ning_agent); service-role write.

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const REVIEW_NOTE_MARKER = "[รออนุมัติแอดมิน]"; // mirror modules/service_status.js
const OPEN_STATUSES = "pending,progress"; // active jobs eligible to be submitted

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function digitsOnly(value) {
  return (value == null ? "" : String(value)).replace(/\D+/g, "");
}

function noteWithReviewMarker(existingNote) {
  const base = typeof existingNote === "string" ? existingNote : "";
  if (base.includes(REVIEW_NOTE_MARKER)) return base;
  return base ? `${base} ${REVIEW_NOTE_MARKER}` : REVIEW_NOTE_MARKER;
}

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
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const phone = digitsOnly(body?.customer_phone);
    if (phone.length < 9) {
      return jsonResponse({ ok: false, error: "customer_phone (9-10 digits) is required" }, 400);
    }

    const rest = `${auth.supabaseUrl.replace(/\/+$/, "")}/rest/v1/service_jobs`;
    const headers = { apikey: auth.apiKey, Authorization: auth.authHeader, "Content-Type": "application/json" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      // 1) find the newest still-open job for this phone
      const findUrl =
        `${rest}?customer_phone=eq.${encodeURIComponent(phone)}` +
        `&status=in.(${OPEN_STATUSES})&select=id,job_no,note,status&order=created_at.desc&limit=1`;
      const findResp = await fetch(findUrl, { headers, signal: controller.signal });
      const findText = await findResp.text().catch(() => "");
      if (!findResp.ok) {
        return jsonResponse({ ok: false, error: "lookup failed", supabase_status: findResp.status, detail: findText.slice(0, 500) });
      }
      let rows = [];
      try {
        rows = JSON.parse(findText);
      } catch {
        rows = [];
      }
      const job = Array.isArray(rows) ? rows[0] : null;
      if (!job) {
        return jsonResponse({ ok: true, matched: false, message: "no open job found for this phone" });
      }

      // 2) mark ช่างส่ง — รออนุมัติ: status stays pending + note marker (NO money, NO JV)
      const patchResp = await fetch(`${rest}?id=eq.${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ status: "pending", note: noteWithReviewMarker(job.note) }),
        signal: controller.signal,
      });
      const patchText = await patchResp.text().catch(() => "");
      if (!patchResp.ok) {
        return jsonResponse({ ok: false, error: "update failed", supabase_status: patchResp.status, detail: patchText.slice(0, 500) });
      }
      return jsonResponse({ ok: true, matched: true, job_no: job.job_no, id: job.id });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return jsonResponse({
      ok: false,
      error: "service-job-submit exception",
      detail: `${e?.name || "Error"}: ${e?.message || String(e)}`,
    });
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { noteWithReviewMarker, getSupabaseWriteAuth, digitsOnly };
