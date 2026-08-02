// customer-service-jobs: a customer reads THEIR OWN service jobs and confirms close.
// Endpoint: GET / POST /api/v1/customer-service-jobs
//
// Phase 606-b2c: service_jobs has a RESTRICTIVE deny for the customer role (Phase 505 GROUP B:
// USING NOT is_customer_role() / WITH CHECK true) → a customer can INSERT a job but can never
// SELECT or UPDATE it. So the customer dashboard's job list (state.serviceJobs) is empty and its
// old direct PATCH (_appXhrPatch "service_jobs" … filter id only) cannot work at all.
// This proxy reads/writes with the service-role key (bypasses RLS) but DERIVES the customer
// identity from the verified JWT ONLY — never from the request — so customer A can never see or
// close customer B's job. Same pattern as /api/v1/loyalty-balance (Phase 580).
//
// Security invariants:
//  - identity = data.user.email + data.user.id (middleware-verified JWT). NEVER read
//    phone / customer_id / created_by / user_id from query or body. (This is the isolation boundary.)
//  - email must be the customer format <phone>@phone.boonsook.local; otherwise 403.
//  - Ning agent auth (no customer identity) → 403.
//  - SUPABASE_SERVICE_ROLE_KEY required (no anon fallback); never leak raw Supabase error.
//  - POST body carries ONLY job_id. status / finance_flow_version / note / role from the client
//    are ignored — the transition allowlist is evaluated against a fresh DB read.
//
// Flow contract (Phase 606-a/b1/b2 — do NOT activate v2 here):
//  - flow 1: done → closed, delivered → closed
//  - flow 2: delivered → closed ONLY (done → closed skips the recognition event)
//  - unknown / null flow → fail closed
//  ★ guard_service_job_v2_freeze() only locks the transition AFTER the job has accounting/ledger
//    rows; before that it may RETURN NEW, so this allowlist is the PRIMARY server gate for
//    pre-money v2 jobs. The DB trigger is defense-in-depth, not a substitute.
//  ★ _guard_service_jobs_close() (Phase 545) does NOT gate this write twice over: it only fires on
//    non-completion → completion, and exempts service_role (auth.uid() IS NULL = trusted backend).
//    done/delivered → closed is completion → completion. No SQL change is needed for this phase.
//
// Money/stock: closing does NOT post JV and does NOT move stock — those fire when staff move a job
// INTO the done-group (main.js deduct-on-close + postJournalForServiceJob). This endpoint patches
// `status` only and never touches note (see NOTE_PRESERVED below).

import { logServerError, clientError } from "../_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const CUSTOMER_EMAIL_SUFFIX = "@phone.boonsook.local";
const JOB_LIMIT = 100;          // bounded page — เกินนี้ตอบ has_more/truncated ห้ามทำเหมือนโหลดครบ
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ★ NOTE_PRESERVED: PATCH ส่งเฉพาะ status — ห้ามเพิ่ม note/stamp เด็ดขาด. เดิม client append
//   "[ลูกค้ายืนยันปิดงาน <ts>]" จาก cached note = lost-update ทับ STOCK_DEDUCTED_MARKER / SH marker /
//   staff note ได้ (marker หาย = เสี่ยงตัดสต็อกซ้ำ). provenance ของเฟสนี้ = authenticated endpoint
//   action + status transition; audit trail ถาวรเป็น SQL-backed phase แยก.
const PATCH_FIELDS = ["status"];

// response allowlist — ห้ามคืน note / customer identity / created_by / accounting IDs
const JOB_FIELDS = [
  "id", "job_no", "job_type", "sub_service", "description",
  "status", "total_cost", "created_at", "finance_flow_version",
];
// server อ่าน note ได้เพื่อ filter (SH marker / [ลบแล้ว]) แต่ห้ามคืนออกไป
const SELECT_COLS = [...JOB_FIELDS, "note", "customer_phone", "created_by"].join(",");

// transition allowlist — flow → statuses ที่ยืนยันปิดได้
const CONFIRM_ALLOWLIST = { 1: ["done", "delivered"], 2: ["delivered"] };
const TARGET_STATUS = "closed";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // defense-in-depth เท่านั้น — ตัวกัน cross-customer cache จริงคือ /api/* bypass ใน sw.js
      "Cache-Control": "private, no-store",
      "Vary": "Authorization",
    },
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

// identity ทั้งชุดจาก middleware — ning agent / non-customer email / user id เพี้ยน = fail closed
function customerIdentity(data) {
  if (data?.user?.authMode === "ning_agent") return { ok: false, status: 403, error: "Forbidden: customer auth required" };
  const phone = phoneFromEmail(data?.user?.email);
  if (!phone) return { ok: false, status: 403, error: "Forbidden: not a customer account" };
  const userId = String(data?.user?.id || "");
  if (!UUID_RE.test(userId)) return { ok: false, status: 403, error: "Forbidden: invalid customer identity" };
  return { ok: true, phone, userId };
}

function getServiceAuth(env) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return { ok: false, status: 500, error: "SUPABASE_SERVICE_ROLE_KEY is required for customer-service-jobs" };
  }
  const supabaseUrl = (env.SUPABASE_URL || PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  return { ok: true, supabaseUrl, apiKey: serviceRoleKey, authHeader: `Bearer ${serviceRoleKey}` };
}

async function sbFetch(url, auth, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      ...init,
      headers: { apikey: auth.apiKey, Authorization: auth.authHeader, ...(init.headers || {}) },
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

// ★ ownership = exact equality เท่านั้น (parity กับ predicate เดิม customer_dashboard.js:184/191).
//   ห้าม loose normalization (ตัด non-digit / +66→0 / suffix / contains) — ยังไม่มี canonical
//   phone-normalization contract, loose matching อาจผูกงานผิดคน. row ที่ format ต่างและไม่มี
//   created_by ตรง = มองไม่เห็น (residual ของ data-normalization phase แยก).
function ownsJob(row, ident) {
  return row?.customer_phone === ident.phone || String(row?.created_by || "") === ident.userId;
}

// ย้าย filter ฝั่ง client เดิมมา server แบบ exact (customer_dashboard.js:190-196)
function isVisibleJob(row) {
  const note = String(row?.note || "");
  if ((row?.sub_service || "").includes("สั่งซื้อ")) return false;                      // ออเดอร์ซื้อสินค้า
  if (/^SH-(transfer|cod_cash|cod_transfer)\|/.test(note)) return false;                // transfer/COD pseudo-job
  if (note.includes("[ลบแล้ว]")) return false;
  if (String(row?.status || "").toLowerCase() === "cancelled") return false;
  return true;
}

// ★ job_id ต้องเป็น canonical positive BIGINT (service_jobs.id = bigint):
//   digits ล้วน · ไม่มี leading zero · ไม่ใช่ 0 · ไม่เกิน signed BIGINT max.
//   เก็บเป็น string ตลอด — ★ ห้ามแปลงเป็น JS Number (id เกิน 2^53 จะเพี้ยนเงียบ ๆ แล้วไปชนแถวอื่น).
//   กันค่าที่ผ่าน regex digits แต่ไปตายเป็น PostgREST error ทีหลัง (22003 out of range).
const BIGINT_MAX = 9223372036854775807n;
function isValidJobId(v) {
  if (!/^[1-9][0-9]*$/.test(v)) return false;
  if (v.length > 19) return false;
  return BigInt(v) <= BIGINT_MAX;
}

function toClientJob(row) {
  const out = {};
  for (const k of JOB_FIELDS) out[k] = row?.[k] ?? null;
  return out;
}

// PostgREST or-filter ของ ownership (ใช้ทั้ง GET และ CAS ของ POST)
function ownershipFilter(ident) {
  return `or=(customer_phone.eq.${encodeURIComponent(ident.phone)},created_by.eq.${encodeURIComponent(ident.userId)})`;
}

export async function onRequestGet({ env, data }) {
  try {
    const ident = customerIdentity(data);
    if (!ident.ok) return jsonResponse({ ok: false, error: ident.error }, ident.status);

    const auth = getServiceAuth(env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    // ขอเกิน limit 1 แถวเพื่อรู้ว่ามี truncation จริงไหม (ห้ามแสดงเหมือนโหลดครบ)
    const url = `${auth.supabaseUrl}/rest/v1/service_jobs?${ownershipFilter(ident)}` +
      `&select=${encodeURIComponent(SELECT_COLS)}&order=created_at.desc&limit=${JOB_LIMIT + 1}`;
    const r = await sbFetch(url, auth);
    if (!r.ok) {
      logServerError("[customer-service-jobs] list", r.status, (r.text || "").slice(0, 300));
      return jsonResponse(clientError("list_failed", "service jobs fetch failed"), 502);
    }

    // ★ post-fetch ownership re-check ทุกแถว (ไม่เชื่อ filter ชั้นเดียว) แล้วค่อย filter visibility
    const owned = r.rows.filter((row) => ownsJob(row, ident));
    const visible = owned.filter(isVisibleJob);
    const hasMore = r.rows.length > JOB_LIMIT;
    const jobs = visible.slice(0, JOB_LIMIT).map(toClientJob);

    return jsonResponse({ ok: true, jobs, has_more: hasMore, truncated: hasMore, limit: JOB_LIMIT });
  } catch (e) {
    logServerError("[customer-service-jobs] GET exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "customer-service-jobs exception"), 500);
  }
}

export async function onRequestPost({ request, env, data }) {
  try {
    const ident = customerIdentity(data);
    if (!ident.ok) return jsonResponse({ ok: false, error: ident.error }, ident.status);

    const auth = getServiceAuth(env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    // ★ body รับเฉพาะ job_id — field อื่น (phone/customer_id/created_by/user_id/status/
    //   finance_flow_version/note/role) ถูกเพิกเฉยทั้งหมด ไม่มีทางมีผลต่อ authority
    let body = null;
    try { body = await request.json(); } catch { body = null; }
    // ★ รับเฉพาะ JSON **string** ที่ canonical เท่านั้น — ห้าม coerce ทุกรูปแบบ
    //   (`String()` / `.trim()` / `Number()` / `parseInt()` / unary `+`). เหตุผล:
    //   (ก) JSON **number** ที่เกิน 2^53 ถูก JSON.parse ปัดค่าไปแล้วตั้งแต่ก่อนถึงเรา →
    //       coerce ต่อจะได้ id "ที่ยัง valid" แต่ **ชี้คนละแถว** (เงียบสนิท ตรวจไม่เจอปลายทาง)
    //   (ข) `.trim()` ทำให้ `" 1"` / `"1 "` ผ่านทั้งที่ไม่ canonical — และทำให้ unit test ที่
    //       เรียก isValidJobId ตรง ๆ "เขียวหลอก" เพราะไม่ได้เดินผ่าน coercion เส้นจริง
    const jobId = body?.job_id;
    if (typeof jobId !== "string" || !isValidJobId(jobId)) {
      return jsonResponse(clientError("bad_request", "invalid job_id"), 400);
    }

    // 1) fresh-read row (authority = DB ไม่ใช่ client)
    const readUrl = `${auth.supabaseUrl}/rest/v1/service_jobs?id=eq.${encodeURIComponent(jobId)}` +
      `&${ownershipFilter(ident)}&select=${encodeURIComponent(SELECT_COLS)}&limit=1`;
    const rr = await sbFetch(readUrl, auth);
    if (!rr.ok) {
      logServerError("[customer-service-jobs] confirm-read", rr.status, (rr.text || "").slice(0, 300));
      return jsonResponse(clientError("read_failed", "service job read failed"), 502);
    }
    const row = rr.rows[0];
    // 2) ownership + visibility — ★ ต้องผ่าน isVisibleJob เหมือน GET ด้วย: แถวที่ถูกซ่อน
    //    (รายการสั่งซื้อ / SH transfer-COD pseudo-job / [ลบแล้ว] / cancelled) เป็นของลูกค้าคนนี้
    //    ก็จริง แต่ไม่เคยถูกเสิร์ฟผ่าน GET → ถ้าเช็คแค่ ownership ลูกค้าที่รู้/เดา job_id ปิดแถวที่
    //    UI ซ่อนไว้ได้ถ้า flow/status บังเอิญผ่าน allowlist. row หาย / ของคนอื่น / ถูกซ่อน =
    //    ตอบ 404 เดียวกันหมด (ไม่เปิดเผยว่ามีแถวอยู่จริง) และต้อง return **ก่อน** ส่ง PATCH ใด ๆ
    if (!row || !ownsJob(row, ident) || !isVisibleJob(row)) {
      return jsonResponse(clientError("not_found", "ไม่พบงานนี้"), 404);
    }

    // 3) flow + status จาก DB row (ห้ามอ่านจาก client)
    const flowRaw = row.finance_flow_version;
    const flow = (flowRaw === 1 || flowRaw === 2) ? flowRaw
      : (typeof flowRaw === "string" && /^[12]$/.test(flowRaw.trim())) ? Number(flowRaw.trim())
      : null;                                    // null/undefined/0/3/junk → unknown = block
    const status = String(row.status || "");
    // 4) allowlist — v2 done ต้องถูกปฏิเสธแม้ยังไม่มี JV/payment
    const allowed = flow != null && (CONFIRM_ALLOWLIST[flow] || []).includes(status);
    if (!allowed) {
      // 409 = client refetch แล้วแสดงสถานะจริง (ไม่ใช่ error ที่ retry ซ้ำได้ผล)
      return jsonResponse(clientError("not_confirmable", "งานนี้ยังยืนยันปิดไม่ได้ — กรุณารีเฟรช"), 409);
    }

    // 5) CAS PATCH — ผูก id + status เดิม + flow เดิม + ownership predicate (server-derived)
    const casUrl = `${auth.supabaseUrl}/rest/v1/service_jobs?id=eq.${encodeURIComponent(jobId)}` +
      `&status=eq.${encodeURIComponent(status)}` +
      `&finance_flow_version=eq.${encodeURIComponent(String(flow))}` +
      `&${ownershipFilter(ident)}`;
    const pr = await sbFetch(casUrl, auth, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ [PATCH_FIELDS[0]]: TARGET_STATUS }),   // ★ status เท่านั้น — ไม่มี note
    });
    if (!pr.ok) {
      logServerError("[customer-service-jobs] confirm-cas", pr.status, (pr.text || "").slice(0, 300));
      return jsonResponse(clientError("confirm_failed", "ปิดงานไม่สำเร็จ"), 502);
    }
    // 6) affected rows ต้องเป็น 1 เป๊ะ — 0 = stale/duplicate (มีคนเปลี่ยนสถานะไปแล้ว)
    if (pr.rows.length !== 1) {
      return jsonResponse(clientError("stale_state", "สถานะงานเปลี่ยนไปแล้ว — กรุณารีเฟรช"), 409);
    }

    return jsonResponse({ ok: true, job: toClientJob(pr.rows[0]) });
  } catch (e) {
    logServerError("[customer-service-jobs] POST exception", `${e?.name || "Error"}: ${e?.message || String(e)}`, e?.stack);
    return jsonResponse(clientError("internal_error", "customer-service-jobs exception"), 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export { phoneFromEmail, customerIdentity, getServiceAuth, ownsJob, isVisibleJob, isValidJobId, toClientJob, JOB_FIELDS, CONFIRM_ALLOWLIST };
