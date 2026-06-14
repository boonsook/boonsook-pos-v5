// Phase 1 draft: read-only daily service-job summary for owner/agent reports.
// Endpoint: GET /api/v1/reports/daily-summary?date=YYYY-MM-DD

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MoeSC0AubZ4C8LXjNJtq7w_iS1baV0j";

const BANGKOK_TZ = "Asia/Bangkok";
const REPORT_ROLES = new Set(["admin", "owner"]);
const COMPLETED_STATUSES = new Set(["done", "delivered", "closed"]);
const CANCELLED_STATUSES = new Set(["cancelled"]);
const OPEN_STATUSES = ["pending", "progress", "in_progress", "open", "pending_review"];
const REPORT_SELECT = [
  "id",
  "job_no",
  "customer_name",
  "customer_phone",
  "customer_address",
  "job_type",
  "description",
  "status",
  "total_cost",
  "payment_method",
  "payment_slip_url",
  "closed_at",
  "created_at",
  "note",
  "items_json",
  "sub_service",
].join(",");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBangkokReportDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "")) return null;
  const start = new Date(`${dateText}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return {
    date: dateText,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    tomorrowStartIso: end.toISOString(),
    tomorrowEndIso: tomorrowEnd.toISOString(),
  };
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isCancelled(job) {
  return CANCELLED_STATUSES.has(normalizeStatus(job?.status));
}

function isCompleted(job) {
  return COMPLETED_STATUSES.has(normalizeStatus(job?.status));
}

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.id ?? row?.job_no;
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function searchText(job) {
  return [
    job?.description,
    job?.note,
    job?.items_json ? JSON.stringify(job.items_json) : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasPendingPartsMarker(job) {
  return /pending\s*parts?|parts?\s*pending|รออะไหล่|อะไหล่ยังไม่มา/.test(searchText(job));
}

function needsFollowUpMarker(job) {
  return /follow\s*up|followup|call\s*customer|ตามลูกค้า|โทรตาม|รอลูกค้า/.test(searchText(job));
}

function needsPaymentReview(job) {
  const amount = Number(job?.total_cost || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (!isCompleted(job)) return false;
  return !job?.payment_method && !job?.payment_slip_url;
}

function compactJob(job, reason) {
  return {
    id: job?.id ?? null,
    jobNo: job?.job_no || null,
    customerName: job?.customer_name || null,
    customerPhone: job?.customer_phone || null,
    jobType: job?.job_type || job?.sub_service || null,
    status: normalizeStatus(job?.status) || null,
    totalCost: Number(job?.total_cost || 0),
    createdAt: job?.created_at || null,
    closedAt: job?.closed_at || null,
    reason,
  };
}

function summarizeDailyJobs({ dateInfo, todayJobs, completedTodayJobs, tomorrowJobs, openJobs }) {
  const cleanToday = (todayJobs || []).filter(job => !isCancelled(job));
  const completedToday = uniqueById([
    ...cleanToday.filter(isCompleted),
    ...(completedTodayJobs || []).filter(job => !isCancelled(job) && isCompleted(job)),
  ]);
  const cleanTomorrow = (tomorrowJobs || []).filter(job => !isCancelled(job));
  const cleanOpen = (openJobs || []).filter(job => !isCancelled(job) && !isCompleted(job));
  const olderOpen = cleanOpen.filter(job => String(job.created_at || "") < dateInfo.startIso);

  const pendingParts = cleanOpen.filter(hasPendingPartsMarker);
  const paymentReview = uniqueById([...cleanToday, ...completedToday, ...cleanOpen]).filter(needsPaymentReview);
  const followUp = cleanOpen.filter(needsFollowUpMarker);
  const focusItems = [
    ...olderOpen.map(job => compactJob(job, "older_open_job")),
    ...pendingParts.map(job => compactJob(job, "pending_parts_marker")),
    ...paymentReview.map(job => compactJob(job, "payment_review_inferred")),
    ...followUp.map(job => compactJob(job, "customer_follow_up_marker")),
  ].slice(0, 30);

  return {
    ok: true,
    date: dateInfo.date,
    timezone: BANGKOK_TZ,
    dateBasis: {
      todayJobs: "service_jobs.created_at",
      completedToday: "service_jobs.status plus closed_at when available",
      tomorrowJobs: "service_jobs.created_at",
      openOrUnclosed: "service_jobs.created_at/status",
    },
    generatedAt: new Date().toISOString(),
    summary: {
      todayTotal: cleanToday.length,
      completedToday: completedToday.length,
      openOrUnclosed: cleanOpen.length,
      olderOpen: olderOpen.length,
      tomorrowJobs: cleanTomorrow.length,
      pendingParts: pendingParts.length,
      paymentReview: paymentReview.length,
      customerFollowUp: followUp.length,
    },
    lists: {
      completedToday: completedToday.slice(0, 20).map(job => compactJob(job, "completed_today")),
      openOrUnclosed: cleanOpen.slice(0, 20).map(job => compactJob(job, "open_or_unclosed")),
      tomorrowJobs: cleanTomorrow.slice(0, 20).map(job => compactJob(job, "tomorrow_created")),
      focusItems,
    },
    technicianWorkload: [],
    warnings: [
      "Phase 1 is read-only and uses service_jobs only.",
      "scheduledAt, paymentStatus, partsStatus, and assignedTechnician are not confirmed in the current service_jobs payloads.",
      "Tomorrow/older-open calculations use created_at until the app exposes scheduledAt.",
      "Payment review, pending parts, and customer follow-up are inferred from existing fields and text markers until dedicated fields exist.",
    ],
  };
}

async function fetchReportRows({ supabaseUrl, apiKey, authHeader, filters }) {
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/service_jobs`);
  url.searchParams.set("select", REPORT_SELECT);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1000");
  for (const [key, value] of filters) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "apikey": apiKey,
      "Authorization": authHeader,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`service_jobs fetch failed ${response.status}: ${detail.slice(0, 300)}`);
  }

  return await response.json();
}

function getSupabaseReportAuth({ request, env, data }) {
  const supabaseUrl = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;

  if (data?.user?.authMode === "ning_agent") {
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return {
        ok: false,
        status: 500,
        error: "SUPABASE_SERVICE_ROLE_KEY is required for Ning agent access",
      };
    }
    return {
      ok: true,
      supabaseUrl,
      apiKey: serviceRoleKey,
      authHeader: `Bearer ${serviceRoleKey}`,
    };
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing Authorization Bearer token" };
  }

  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return { ok: true, supabaseUrl, apiKey, authHeader };
}

export async function onRequestGet({ request, env, data }) {
  if (!REPORT_ROLES.has(data?.user?.role)) {
    return jsonResponse({ ok: false, error: "Forbidden: report role required" }, 403);
  }

  const url = new URL(request.url);
  const dateText = url.searchParams.get("date");
  const tz = url.searchParams.get("tz") || BANGKOK_TZ;
  const dateInfo = parseBangkokReportDate(dateText);
  if (!dateInfo) {
    return jsonResponse({ ok: false, error: "date must be YYYY-MM-DD" }, 400);
  }
  if (tz !== BANGKOK_TZ) {
    return jsonResponse({ ok: false, error: "Only tz=Asia/Bangkok is supported in Phase 1" }, 400);
  }

  const reportAuth = getSupabaseReportAuth({ request, env, data });
  if (!reportAuth.ok) {
    return jsonResponse({ ok: false, error: reportAuth.error }, reportAuth.status);
  }

  const { supabaseUrl, apiKey, authHeader } = reportAuth;
  try {
    const [todayJobs, completedTodayJobs, tomorrowJobs, openJobs] = await Promise.all([
      fetchReportRows({
        supabaseUrl,
        apiKey,
        authHeader,
        filters: [
          ["created_at", `gte.${dateInfo.startIso}`],
          ["created_at", `lt.${dateInfo.endIso}`],
        ],
      }),
      fetchReportRows({
        supabaseUrl,
        apiKey,
        authHeader,
        filters: [
          ["closed_at", `gte.${dateInfo.startIso}`],
          ["closed_at", `lt.${dateInfo.endIso}`],
          ["status", "in.(done,delivered,closed)"],
        ],
      }),
      fetchReportRows({
        supabaseUrl,
        apiKey,
        authHeader,
        filters: [
          ["created_at", `gte.${dateInfo.tomorrowStartIso}`],
          ["created_at", `lt.${dateInfo.tomorrowEndIso}`],
        ],
      }),
      fetchReportRows({
        supabaseUrl,
        apiKey,
        authHeader,
        filters: [
          ["created_at", `lt.${dateInfo.endIso}`],
          ["status", `in.(${OPEN_STATUSES.join(",")})`],
        ],
      }),
    ]);

    return jsonResponse(summarizeDailyJobs({
      dateInfo,
      todayJobs,
      completedTodayJobs,
      tomorrowJobs,
      openJobs,
    }));
  } catch (e) {
    return jsonResponse({ ok: false, error: e?.message || "daily summary failed" }, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export {
  parseBangkokReportDate,
  summarizeDailyJobs,
  hasPendingPartsMarker,
  needsFollowUpMarker,
  needsPaymentReview,
  getSupabaseReportAuth,
};
