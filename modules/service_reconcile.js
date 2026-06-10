// ตรวจรายได้งานบริการเข้าบัญชี (reconcile + re-post) — build 384 (Phase 384, Part B)
//
// ปัญหา: งานช่างปิดแล้ว (delivered/done/closed) auto-post JV ตอนปิดงานเป็น fire-and-forget
//        (service_form.js) → ถ้า post ล้ม งาน delivered แต่ JE ไม่เกิด + ไม่มีใครรู้ (รายได้หายเงียบ).
//        ตัวอย่างจริง: หลวงพี่ JOB-1780732840014 ฿600 delivered 2026-06-06 → ไม่มี JE.
//
// หน้านี้ (admin-only): surface "งานปิดแล้วแต่ยังไม่มี JE" ให้ admin กด "ส่งเข้าบัญชีอีกครั้ง"
//        → เรียก postJournalForServiceJob (idempotent: ซ้ำ → 409 → null, ไม่สร้าง JE ซ้ำ).
//
// ขอบเขต / invariants (ดู tests/service_reconcile_guard.test.js):
//   - ตรวจสอบ: อ่าน state.serviceJobs (≤50) + fetch journal_entries.description (READ-ONLY GET)
//   - การเขียน JE ทำผ่าน postJournalForServiceJob เท่านั้น (ไม่ raw-insert journal_entries เอง,
//     ไม่แก้สูตร double-entry/COA/period-lock — แค่ "เรียก")
//   - ไม่แก้ status ของ service_jobs (ไม่แตะ logic ทีม 383), ไม่ mutate state, ไม่แตะ stock/POS
//   - effective date เดียวกับ auto_post (effective_date.js — เริ่มบัญชีจริง 1 ก.ค. 2569): งานก่อนวันนั้น auto_post จะ skip → ไม่ flag

import { escHtml, dateBkk, todayBkk } from "./utils.js";
import { postJournalForServiceJob } from "./accounting/auto_post.js";
// ★ Phase 413: single source of truth — เปลี่ยนวัน = แก้ที่ effective_date.js ที่เดียว
import { ACCOUNTING_EFFECTIVE_DATE } from "./accounting/effective_date.js";

// สถานะ "ปิดงาน = รับรู้รายได้" — ตรงกับ postJournalForServiceJob (auto_post.js)
export const SERVICE_INCOME_STATUSES = ["delivered", "closed", "done"];
// effective date เดียวกับ ACCOUNTING_EFFECTIVE_DATE ใน auto_post.js (ก่อนวันนี้ = test data → auto_post skip)
const DEFAULT_EFFECTIVE_DATE = ACCOUNTING_EFFECTIVE_DATE;
const JOB_NO_GLOBAL = /JOB-\d+/g;   // ดึงเลขงานจาก description (อาจมีหลายตัว)
const JOB_NO_ONE = /JOB-\d+/;       // ตรวจรูปแบบเลขงานเดียว (ไม่ใช้ /g — กัน lastIndex state)

// ═══════════════════════════════════════════════════════════
//  PURE DETECTION (testable — no DOM / no network)
// ═══════════════════════════════════════════════════════════

export function isServiceIncomeStatus(status) {
  return SERVICE_INCOME_STATUSES.includes(String(status || "").trim().toLowerCase());
}

// ดึงเลขงาน (JOB-\d+) ทั้งหมดที่ปรากฏใน description ของ journal_entries → Set
export function extractPostedJobNos(jeDescriptions) {
  const set = new Set();
  (Array.isArray(jeDescriptions) ? jeDescriptions : []).forEach(d => {
    const matches = String(d == null ? "" : d).match(JOB_NO_GLOBAL);
    if (matches) matches.forEach(m => set.add(m));
  });
  return set;
}

/**
 * แปลง journal_entries rows (source = service_jobs) → reference สำหรับจับคู่
 * @param {Array<{source_id?:any, description?:string}>} jeRows
 * @returns {{ sourceIds: Set<string>, descriptions: string[] }}
 */
export function buildPostedRef(jeRows) {
  const sourceIds = new Set();
  const descriptions = [];
  (Array.isArray(jeRows) ? jeRows : []).forEach(r => {
    if (!r) return;
    if (r.source_id !== undefined && r.source_id !== null && String(r.source_id) !== "") {
      sourceIds.add(String(r.source_id));
    }
    if (r.description != null) descriptions.push(r.description);
  });
  return { sourceIds, descriptions };
}

/**
 * หา service job ที่ "ควรมี JE แต่ยังไม่มี" (orphan รายได้)
 *
 * `posted` รับได้ 2 รูปแบบ:
 *   - object `{ sourceIds: Set|Array, descriptions?: Array, jobNos?: Set|Array }`
 *     → จับคู่ด้วย **source_id เป็น primary** (จุดที่ auto_post เขียน source_id=job.id),
 *       ใช้ job_no ใน description เป็น **fallback** เท่านั้น. มี source_id info แล้ว
 *       → flag งานที่ไม่มี job_no ได้ (จับด้วย id)
 *   - array `<string>` (legacy) → ถือเป็น JE descriptions, จับคู่ด้วย job_no อย่างเดียว;
 *       งานที่ไม่มี job_no = ตรวจไม่ได้ → ไม่ flag (กัน false-positive แบบเดิม)
 *
 * @param {Array} jobs - service_jobs rows
 * @param {object|Array<string>} posted
 * @param {object} [opts]
 * @param {string} [opts.effectiveDate] - YYYY-MM-DD (default = ACCOUNTING_EFFECTIVE_DATE จาก effective_date.js)
 * @returns {Array} jobs ที่เป็น orphan (ตามลำดับเดิม)
 */
export function findUnpostedServiceJobs(jobs, posted, opts = {}) {
  const effectiveDate = opts.effectiveDate || DEFAULT_EFFECTIVE_DATE;
  let sourceIds, jobNos, hasSourceIds;
  if (posted && !Array.isArray(posted) && typeof posted === "object") {
    sourceIds = posted.sourceIds instanceof Set ? posted.sourceIds : new Set((posted.sourceIds || []).map(String));
    jobNos = posted.jobNos instanceof Set ? posted.jobNos
      : (Array.isArray(posted.jobNos) ? new Set(posted.jobNos) : extractPostedJobNos(posted.descriptions || []));
    hasSourceIds = true;
  } else {
    // legacy: array of JE descriptions → fallback (job_no) matching only
    sourceIds = new Set();
    jobNos = extractPostedJobNos(Array.isArray(posted) ? posted : []);
    hasSourceIds = false;
  }
  const out = [];
  (Array.isArray(jobs) ? jobs : []).forEach(job => {
    if (!job) return;
    // 1) ต้องเป็นงานที่ปิด/รับรู้รายได้แล้ว
    if (!isServiceIncomeStatus(job.status)) return;
    // 2) ต้องมียอดเงิน > 0
    const amount = Number(job.total_cost);
    if (!Number.isFinite(amount) || amount <= 0) return;
    // 3) primary match: มี JE ที่ source_id = job.id แล้ว → ไม่ orphan
    if (sourceIds.has(String(job.id))) return;
    const jobNo = String(job.job_no || "").trim();
    const hasValidJobNo = JOB_NO_ONE.test(jobNo);
    // 4) ไม่มี source_id info (legacy) + ไม่มีเลขงาน = จับคู่ไม่ได้ → ไม่ flag (กัน false-positive)
    if (!hasSourceIds && !hasValidJobNo) return;
    // 5) ต้องปิดหลัง effective date (ก่อนวันนั้น auto_post จะ skip อยู่แล้ว → re-post ไม่เกิด JE)
    const docDate = job.created_at ? dateBkk(job.created_at) : "";
    if (!docDate || String(docDate).slice(0, 10) < effectiveDate) return;
    // 6) fallback: มี JE description อ้างถึงเลขงานนี้ → ถือว่าเข้าบัญชีแล้ว
    if (hasValidJobNo && jobNos.has(jobNo)) return;
    out.push(job);
  });
  return out;
}

// ═══════════════════════════════════════════════════════════
//  RENDER (admin-only)
// ═══════════════════════════════════════════════════════════

const HONESTY = "ตรวจจาก: งานบริการที่ปิดแล้ว (ส่งมอบ/เสร็จ/ปิด) ตั้งแต่ effective date เทียบ JE ในสมุดรายวัน — จับคู่ด้วย source_id เป็นหลัก, เลขงานใน description เป็นตัวสำรอง";
const SCOPE_NOTE = "เกณฑ์ orphan: ปิดงานแล้ว (ส่งมอบ/เสร็จ/ปิด) + มียอดเงิน + ยังไม่มีรายการบันทึกบัญชี (JE)";

// บรรทัดบอก scope จริงที่ตรวจ (ช่วงวันที่ / จำนวนที่ดึงได้) — honesty ตามข้อมูลจริง
function scanMeta(res) {
  if (!res || !res.fromDate) return HONESTY;
  return `ตรวจช่วง ${res.fromDate} → ${res.toDate} · ดึงงานปิดแล้ว ${res.jobsFetched ?? "?"} งาน · เทียบ JE ${res.jeFetched ?? "?"} รายการ (จับคู่ด้วย source_id หลัก, เลขงานใน description สำรอง)`;
}

let _repostInflight = false;   // กันกดซ้ำหลายปุ่มพร้อมกัน

function shell(bodyHtml, metaText) {
  return `
    <div class="svc-recon" style="max-width:900px;margin:0 auto;padding:16px">
      <h2 style="margin:0 0 4px;font-size:20px">🧾 ตรวจรายได้งานบริการเข้าบัญชี</h2>
      <div style="font-size:12px;color:#64748b;margin-bottom:2px">${escHtml(SCOPE_NOTE)}</div>
      <div style="font-size:12px;color:#b45309;margin-bottom:14px">⚠️ ${escHtml(metaText || HONESTY)}</div>
      ${bodyHtml}
    </div>`;
}

function loadingHtml() {
  return shell(`<div style="padding:24px;text-align:center;color:#64748b">⏳ กำลังโหลดและตรวจสอบข้อมูล...</div>`);
}

function incompleteHtml(reason) {
  return shell(`
    <div style="background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;padding:20px;text-align:center;color:#475569">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">⚠️ โหลดข้อมูลไม่ครบ — ตรวจไม่ได้</div>
      <div style="font-size:13px">${escHtml(reason)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:8px">ระบบเลือก "ไม่แจ้งเตือน" แทนการเดา เพื่อกันผลลวง (false-positive)</div>
    </div>`);
}

function emptyHtml(res) {
  return shell(`
    <div style="background:#ecfdf5;border:1px solid #34d399;border-radius:8px;padding:20px;text-align:center;color:#065f46">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">✅ ไม่พบงานปิดแล้วที่ยังไม่เข้าบัญชี</div>
      <div style="font-size:13px">งานบริการที่ปิดแล้วในช่วงที่ตรวจมีรายการบันทึกบัญชี (JE) ครบ</div>
    </div>`, scanMeta(res));
}

function fmtAmount(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orphanCardHtml(job) {
  const jobNo = escHtml(String(job?.job_no || "—"));
  const name = escHtml(String(job?.customer_name || ""));
  const status = escHtml(String(job?.status || "—"));
  const amount = escHtml(fmtAmount(job?.total_cost));
  const dateStr = escHtml(String(job?.created_at ? dateBkk(job.created_at) : "—"));
  const jid = escHtml(String(job?.id ?? ""));
  return `
    <div style="border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:14px">${jobNo} ${name ? "· " + name : ""}</div>
          <div style="font-size:12px;color:#64748b">สถานะ ${status} · ${dateStr} · ฿${amount}</div>
        </div>
        <button type="button" class="svc-recon-repost" data-job-id="${jid}"
          style="border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">
          ส่งเข้าบัญชีอีกครั้ง
        </button>
      </div>
    </div>`;
}

function resultsHtml(orphans, res) {
  const parts = [];
  parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:6px 0 8px">🚩 งานปิดแล้วแต่ยังไม่เข้าบัญชี (${orphans.length})</div>`);
  parts.push(orphans.map(orphanCardHtml).join(""));
  parts.push(`<div style="font-size:12px;color:#94a3b8;margin-top:12px">กด "ส่งเข้าบัญชีอีกครั้ง" เพื่อสร้างรายการบันทึกบัญชี (JE) — ปลอดภัยถ้ามีอยู่แล้ว (ระบบกันซ้ำให้)</div>`);
  return shell(parts.join(""), scanMeta(res));
}

/**
 * READ-ONLY GET (ใช้ร่วมกัน: service_reconcile / periods readiness / backfill integrity)
 * ดึง service_jobs (income status, ตาม date range) + journal_entries (source_id,description ของ service_jobs)
 * → หา orphan ผ่าน findUnpostedServiceJobs (source_id เป็น primary match)
 * เลิกพึ่ง state.serviceJobs (≤50) → ตรวจครบตามช่วงวันที่จริง
 * @param {object} [opts] - { fromDate?, toDate? (YYYY-MM-DD), effectiveDate? }
 * @returns {Promise<{ok:boolean, orphans?:Array, jobsFetched?:number, jeFetched?:number, fromDate?:string, toDate?:string, reason?:string}>}
 */
export async function fetchServiceJVStatus(opts = {}) {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  const effectiveDate = opts.effectiveDate || DEFAULT_EFFECTIVE_DATE;
  const fromDate = opts.fromDate || effectiveDate;     // inclusive (YYYY-MM-DD)
  const toDate = opts.toDate || todayBkk();            // inclusive (YYYY-MM-DD)
  // created_at = timestamptz → ใช้ exclusive next-day เป็น upper bound (กัน row วันสุดท้ายหลุด)
  const nd = new Date(toDate + "T00:00:00Z");
  nd.setUTCDate(nd.getUTCDate() + 1);
  const toExclusive = nd.toISOString().slice(0, 10);

  const statusList = SERVICE_INCOME_STATUSES.join(",");
  const jobsUrl = cfg.url + "/rest/v1/service_jobs"
    + "?select=id,job_no,customer_name,status,total_cost,created_at"
    + `&status=in.(${statusList})`
    + `&created_at=gte.${fromDate}&created_at=lt.${toExclusive}`
    + "&order=created_at.desc&limit=5000";
  const jeUrl = cfg.url + "/rest/v1/journal_entries"
    + "?source_table=eq.service_jobs&select=source_id,description&order=id.desc&limit=5000";

  try {
    const [jobsRes, jeRes] = await Promise.all([fetch(jobsUrl, { headers }), fetch(jeUrl, { headers })]);
    if (!jobsRes.ok) return { ok: false, reason: "ดึงงานบริการไม่สำเร็จ (HTTP " + jobsRes.status + ")", fromDate, toDate };
    if (!jeRes.ok) return { ok: false, reason: "ดึงข้อมูลสมุดรายวันไม่สำเร็จ (HTTP " + jeRes.status + ")", fromDate, toDate };
    const jobs = await jobsRes.json().catch(() => null);
    const jeRows = await jeRes.json().catch(() => null);
    if (!Array.isArray(jobs) || !Array.isArray(jeRows)) return { ok: false, reason: "ข้อมูลรูปแบบไม่ถูกต้อง", fromDate, toDate };
    const orphans = findUnpostedServiceJobs(jobs, buildPostedRef(jeRows), { effectiveDate });
    return { ok: true, orphans, jobsFetched: jobs.length, jeFetched: jeRows.length, fromDate, toDate };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e), fromDate, toDate };
  }
}

async function _loadAndRender(ctx, container) {
  if (!document.body.contains(container)) return;
  container.innerHTML = loadingHtml();

  const res = await fetchServiceJVStatus({ effectiveDate: DEFAULT_EFFECTIVE_DATE });
  if (!document.body.contains(container)) return;
  if (!res.ok) {
    container.innerHTML = incompleteHtml(res.reason || "ไม่ทราบสาเหตุ");
    return;
  }

  const orphans = res.orphans || [];
  if (!orphans.length) {
    container.innerHTML = emptyHtml(res);
    return;
  }
  container.innerHTML = resultsHtml(orphans, res);

  // bind ปุ่ม re-post (พฤติกรรมเดิม — ไม่ auto-click/auto-post)
  const byId = {};
  orphans.forEach(j => { byId[String(j.id)] = j; });
  container.querySelectorAll(".svc-recon-repost").forEach(btn => {
    btn.addEventListener("click", () => _handleRepost(ctx, container, byId[btn.dataset.jobId], btn));
  });
}

async function _handleRepost(ctx, container, job, btn) {
  if (!job) return;
  if (_repostInflight) { ctx?.showToast?.("กำลังส่ง... รอสักครู่"); return; }
  _repostInflight = true;
  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง..."; }
  try {
    const entryId = await postJournalForServiceJob(job);
    if (entryId) {
      ctx?.showToast?.(`✅ ส่งเข้าบัญชีแล้ว (JE #${entryId})`);
    } else {
      // null = idempotency hit (มี JE อยู่แล้ว), period locked, ก่อน effective date, หรือ post ล้มจริง
      // โทษที่ console (auto_post log ไว้แล้ว) — refresh จะทำให้แถวที่มี JE แล้วหายไปเอง
      ctx?.showToast?.("ยังไม่สำเร็จ — อาจมีรายการอยู่แล้ว หรือเกิดข้อผิดพลาด (ดู Console)");
    }
  } catch (e) {
    // postJournalForServiceJob ปกติไม่ throw แต่กันไว้ — ไม่ fake success
    console.error("[service_reconcile] re-post error:", e?.message || e);
    ctx?.showToast?.("⚠️ ส่งเข้าบัญชีไม่สำเร็จ (ดู Console)");
  } finally {
    _repostInflight = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = origText; }
    // refresh: คำนวณใหม่จาก JE ล่าสุด (แถวที่เข้าบัญชีแล้วจะหายไป)
    _loadAndRender(ctx, container).catch(err => console.warn("[service_reconcile] refresh", err));
  }
}

export function renderServiceReconcilePage(ctx) {
  const container = typeof document !== "undefined" ? document.getElementById("page-service_reconcile") : null;
  if (!container) return;

  // admin-only gate (showRoute gate แล้ว แต่ double-gate กันหลุด)
  const isAdmin = ctx?.requireAdmin ? !!ctx.requireAdmin() : (ctx?.currentRole?.() === "admin");
  if (!isAdmin) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:#b91c1c">⛔ หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>`;
    return;
  }

  _loadAndRender(ctx, container).catch(err => {
    console.error("[service_reconcile] render", err);
    container.innerHTML = incompleteHtml("เกิดข้อผิดพลาดในการโหลด: " + (err?.message || err));
  });
}
