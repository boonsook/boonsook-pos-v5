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
import { postJournalForServiceJob, postJournalForServicePayment, postJournalForServicePaymentReversal,
         serviceMappingKeyForJobType, serviceFinanceFlowOf } from "./accounting/auto_post.js";
import { validateRecognitionJv, validatePaymentJv, validateReversalJv, validateLegacyServiceJv,
         paymentDebitCode, ledgerStateOf, jvResultToToast } from "./accounting/service_jv_validate.js";
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

// ★ Phase 606-b1 (review#2, blocking 4): สถานะที่ "ควรมี JV" ขึ้นกับ flow ของงานนั้น
//   v1 = done/delivered/closed (เดิม) · v2 = delivered/closed เท่านั้น (done = ยังไม่ส่งมอบ → ไม่ใช่ orphan)
//   flow เพี้ยน/หาย = ไม่รู้กติกา → ไม่ flag เป็น orphan (แต่ writer ก็ block อยู่แล้ว)
export function isRecognitionStatusForJob(job) {
  const st = String(job?.status || "").trim().toLowerCase();
  const flow = serviceFinanceFlowOf(job);
  if (flow === 2) return ["delivered", "closed"].includes(st);
  if (flow === 1) return SERVICE_INCOME_STATUSES.includes(st);
  return false;
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
    // 1) ต้องเป็นงานที่ "ควรรับรู้รายได้แล้ว" ตาม flow ของงานนั้น (v2 + done = ไม่ใช่ orphan)
    if (opts.flowAware ? !isRecognitionStatusForJob(job) : !isServiceIncomeStatus(job.status)) return;
    // 2) ต้องมียอดเงิน > 0
    const amount = Number(job.total_cost);
    if (!Number.isFinite(amount) || amount <= 0) return;
    // 3) primary match: มี JE ที่ source_id = job.id แล้ว → ไม่ orphan
    if (sourceIds.has(String(job.id))) return;
    const jobNo = String(job.job_no || "").trim();
    const hasValidJobNo = JOB_NO_ONE.test(jobNo);
    // 4) ไม่มี source_id info (legacy) + ไม่มีเลขงาน = จับคู่ไม่ได้ → ไม่ flag (กัน false-positive)
    if (!hasSourceIds && !hasValidJobNo) return;
    // 5) ต้องรับรู้รายได้หลัง effective date — ★ Phase 606-b1: ใช้ closed_at (วันรับรู้จริง) ถ้ามี
    //    งานที่ closed_at = null ยัง flag ต่อ (ใช้ created_at เป็น scope) เพื่อให้ผู้ดูแลเห็นว่ามีงาน
    //    ค้าง แต่ fetchServiceJVStatus จะแยกไปกอง needRecognitionDate (re-post ไม่ได้จนกว่า owner กำหนดวัน)
    const basis = job.closed_at || job.created_at;
    const docDate = basis ? dateBkk(basis) : "";
    if (!docDate || String(docDate).slice(0, 10) < effectiveDate) return;
    // 6) fallback: มี JE description อ้างถึงเลขงานนี้ → ถือว่าเข้าบัญชีแล้ว
    if (hasValidJobNo && jobNos.has(jobNo)) return;
    out.push(job);
  });
  return out;
}

// ═══════════════════════════════════════════════════════════
//  Phase 606-b1 — ledger การรับชำระ/กลับรายการ (flow v2) เทียบ JV จริง (header + lines + บัญชี)
// ═══════════════════════════════════════════════════════════
// taxonomy (review#2 blocking 3): "มี header" ไม่พอ — draft / header-only / บัญชีผิด ต้องไม่ OK
//   PAYMENT_NO_JV        · REVERSAL_NO_JV        → ไม่มี header เลย → **ปุ่มซ่อมอัตโนมัติได้**
//   PAYMENT_NON_APPROVED · REVERSAL_NON_APPROVED → header draft/void → manual (ยิงทับไม่ได้)
//   PAYMENT_MISMATCH     · REVERSAL_MISMATCH     → lines หาย/บัญชีผิด/ยอดผิด → manual conflict
// เหตุผลที่มี header เสียแล้วห้าม auto-repair: idx_je_source_unique จะปฏิเสธการยิงทับ (409)
export const LEDGER_JV_STATES = [
  "PAYMENT_NO_JV", "PAYMENT_NON_APPROVED", "PAYMENT_MISMATCH",
  "REVERSAL_NO_JV", "REVERSAL_NON_APPROVED", "REVERSAL_MISMATCH"
];
export const LEDGER_AUTO_REPAIRABLE = ["PAYMENT_NO_JV", "REVERSAL_NO_JV"];

function _byEntry(jeRows, lineRows) {
  const linesByEntry = new Map();
  (Array.isArray(lineRows) ? lineRows : []).forEach(l => {
    const k = String(l.entry_id);
    if (!linesByEntry.has(k)) linesByEntry.set(k, []);
    linesByEntry.get(k).push(l);
  });
  const bySource = new Map();
  (Array.isArray(jeRows) ? jeRows : []).forEach(e => {
    if (e?.source_id === undefined || e?.source_id === null) return;
    bySource.set(`${e.source_table}#${e.source_id}`, { entry: e, lines: linesByEntry.get(String(e.id)) || [] });
  });
  return bySource;
}

/**
 * pure — ไม่มี DOM/network. mappingsByKey = { [mapping_key]: account_mapping row }
 * jobsById = { [id]: service_jobs row } (ต้องมี job_type — ใช้หา mapping ของบัญชีที่ถูกต้อง)
 */
export function classifyLedgerJv({ payments = [], reversals = [], jeRows = [], lineRows = [], jobsById = {}, mappingsByKey = {}, mappingKeyOf = null } = {}) {
  const keyOf = mappingKeyOf || (() => null);
  const src = _byEntry(jeRows, lineRows);
  const out = { paymentNoJv: [], paymentNonApproved: [], paymentMismatch: [], reversalNoJv: [], reversalNonApproved: [], reversalMismatch: [] };
  const payById = new Map();

  payments.forEach(p => {
    payById.set(String(p.id), p);
    const job = jobsById[String(p.service_job_id)] || null;
    const mapping = mappingsByKey[keyOf(job?.job_type)] || null;
    const found = src.get(`service_payments#${p.id}`) || { entry: null, lines: [] };
    // ★ review#4: ไม่มี header เลย = NO_JV เสมอ (แม้ mapping resolve ไม่ได้) → ซ่อมอัตโนมัติได้
    const v = found.entry ? validatePaymentJv({ payment: p, mapping, entry: found.entry, lines: found.lines })
                          : { ok: false, reason: "no-header" };
    const state = ledgerStateOf(v);
    if (state === "OK") return;
    const item = { row: p, kind: "payment", state: `PAYMENT_${state}`, reason: v.reason, entry: found.entry };
    if (state === "NO_JV") out.paymentNoJv.push(item);
    else if (state === "NON_APPROVED") out.paymentNonApproved.push(item);
    else out.paymentMismatch.push(item);
  });

  reversals.forEach(r => {
    const pay = payById.get(String(r.payment_id)) || null;
    const job = pay ? jobsById[String(pay.service_job_id)] || null : null;
    const mapping = mappingsByKey[keyOf(job?.job_type)] || null;
    const found = src.get(`service_payment_reversals#${r.id}`) || { entry: null, lines: [] };
    const v = found.entry ? validateReversalJv({
      reversal: r,
      paymentDebit: paymentDebitCode(pay, mapping),
      recognitionCode: mapping?.recognition_debit_code,
      entry: found.entry, lines: found.lines
    }) : { ok: false, reason: "no-header" };
    const state = ledgerStateOf(v);
    if (state === "OK") return;
    const item = { row: r, kind: "reversal", state: `REVERSAL_${state}`, reason: v.reason, entry: found.entry };
    if (state === "NO_JV") out.reversalNoJv.push(item);
    else if (state === "NON_APPROVED") out.reversalNonApproved.push(item);
    else out.reversalMismatch.push(item);
  });

  return out;
}

/** READ-ONLY GET — ledger + JE + lines + jobs + mappings (ต้องมี lines ถึงจะบอก MISMATCH ได้จริง) */
export async function fetchLedgerJVStatus() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const get = (path) => fetch(cfg.url + "/rest/v1/" + path, { headers });
  try {
    const [pRes, rRes, jRes, mRes] = await Promise.all([
      get("service_payments?select=id,service_job_id,amount,payment_method,bank_coa_code,paid_at&order=id.desc&limit=5000"),
      get("service_payment_reversals?select=id,payment_id,amount,reason,reversed_at&order=id.desc&limit=5000"),
      get("journal_entries?source_table=in.(service_payments,service_payment_reversals)&select=id,source_table,source_id,status,total_debit,total_credit&limit=5000"),
      get("account_mapping?select=mapping_key,debit_account_code,credit_account_code,recognition_debit_code&is_active=eq.true")
    ]);
    if (!pRes.ok || !rRes.ok || !jRes.ok || !mRes.ok) return { ok: false, reason: "ดึงข้อมูล ledger/สมุดรายวันไม่สำเร็จ" };
    const [payments, reversals, jeRows, mappings] = await Promise.all([pRes.json(), rRes.json(), jRes.json(), mRes.json()]);
    if (![payments, reversals, jeRows, mappings].every(Array.isArray)) return { ok: false, reason: "ข้อมูลรูปแบบไม่ถูกต้อง" };
    // ★ should-fix 1: ชน limit = ผลไม่ครบ → DATA_INCOMPLETE (ห้ามรายงานว่าไม่มีปัญหา)
    if (payments.length >= 5000 || reversals.length >= 5000 || jeRows.length >= 5000) {
      return { ok: false, dataIncomplete: true, reason: "DATA_INCOMPLETE — ledger/สมุดรายวันเกินขีดจำกัดที่ดึงได้" };
    }

    let lineRows = [];
    if (jeRows.length) {
      const ids = jeRows.map(e => e.id).join(",");
      const lRes = await get(`journal_lines?select=entry_id,account_code,debit,credit&entry_id=in.(${ids})&limit=20000`);
      if (!lRes.ok) return { ok: false, reason: "ดึง journal_lines ไม่สำเร็จ" };
      lineRows = await lRes.json();
      if (!Array.isArray(lineRows)) return { ok: false, reason: "ข้อมูล journal_lines ไม่ถูกต้อง" };
      if (lineRows.length >= 20000) return { ok: false, dataIncomplete: true, reason: "DATA_INCOMPLETE — journal_lines เกินขีดจำกัด" };
    }

    const jobIds = [...new Set(payments.map(p => p.service_job_id).filter(v => v != null))];
    let jobsById = {};
    if (jobIds.length) {
      const jbRes = await get(`service_jobs?select=id,job_no,job_type,total_cost&id=in.(${jobIds.join(",")})&limit=5000`);
      if (!jbRes.ok) return { ok: false, reason: "ดึงงานบริการไม่สำเร็จ" };
      const jobs = await jbRes.json();
      if (!Array.isArray(jobs)) return { ok: false, reason: "ข้อมูลงานบริการไม่ถูกต้อง" };
      jobs.forEach(j => { jobsById[String(j.id)] = j; });
    }
    const mappingsByKey = {};
    mappings.forEach(m => { mappingsByKey[m.mapping_key] = m; });

    return {
      ok: true,
      ...classifyLedgerJv({ payments, reversals, jeRows, lineRows, jobsById, mappingsByKey, mappingKeyOf: serviceMappingKeyForJobType }),
      paymentsFetched: payments.length, reversalsFetched: reversals.length
    };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
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

// ★ Phase 606-b1: งานที่ "ไม่มีวันรับรู้รายได้" (closed_at = null) — writer block เสมอ (OWNER_RECOGNITION_DATE_REQUIRED)
//   โชว์แยก + **ไม่มีปุ่ม re-post** (ปุ่มที่กดแล้วไม่มีวันสำเร็จ = หลอกผู้ใช้)
function needDateCardHtml(job) {
  const jobNo = escHtml(String(job?.job_no || "—"));
  const name = escHtml(String(job?.customer_name || ""));
  const amount = escHtml(fmtAmount(job?.total_cost));
  const dateStr = escHtml(String(job?.created_at ? dateBkk(job.created_at) : "—"));
  return `
    <div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="font-weight:700;font-size:14px">${jobNo} ${name ? "· " + name : ""}</div>
      <div style="font-size:12px;color:#92400e">สร้าง ${dateStr} · ฿${amount} · <b>ไม่มีวันปิดงาน (closed_at)</b> — ต้องให้เจ้าของกำหนดวันรับรู้รายได้ก่อน (recovery)</div>
    </div>`;
}

// การ์ด ledger ที่ "มีเงิน/มีการกลับรายการ แต่ JV หาย" → retry โพสต์ JV ได้ (idempotent)
function ledgerCardHtml(state, id, label, kind) {
  return `
    <div style="border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
      <div>
        <div style="font-weight:700;font-size:14px">${escHtml(state)}</div>
        <div style="font-size:12px;color:#64748b">${escHtml(label)}</div>
      </div>
      <button type="button" class="svc-recon-ledger-retry" data-kind="${escHtml(kind)}" data-row-id="${escHtml(String(id))}"
        style="border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">
        ลงบัญชีอีกครั้ง
      </button>
    </div>`;
}

function resultsHtml(orphans, res) {
  const needDate = res?.needRecognitionDate || [];
  const parts = [];
  if (res?.ledgerUnavailable) {
    parts.push(`
      <div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:12px;margin-bottom:12px;color:#92400e">
        <div style="font-weight:700;font-size:14px">⚠️ LEDGER_UNAVAILABLE${res.ledgerUnavailable.dataIncomplete ? " · DATA_INCOMPLETE" : ""} — ยังตรวจการรับชำระ/กลับรายการ (ledger) ไม่ได้</div>
        <div style="font-size:12px">${escHtml(res.ledgerUnavailable.reason)} · ผลด้านล่างเป็นเฉพาะฝั่งงานบริการ (ยังไม่ครบทั้งระบบ) — ปุ่มซ่อม ledger ถูกปิดไว้</div>
      </div>`);
  }
  if (orphans.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:6px 0 8px">🚩 งานปิดแล้วแต่ยังไม่เข้าบัญชี (${orphans.length})</div>`);
    parts.push(orphans.map(orphanCardHtml).join(""));
    parts.push(`<div style="font-size:12px;color:#94a3b8;margin-top:12px">กด "ส่งเข้าบัญชีอีกครั้ง" เพื่อสร้างรายการบันทึกบัญชี (JE) — ปลอดภัยถ้ามีอยู่แล้ว (ระบบกันซ้ำให้)</div>`);
  }
  const led = res?.ledger;
  const conflicts = res?.conflicts || [];
  if (conflicts.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:16px 0 8px">⛔ งานที่มีรายการบัญชี "เสีย" (${conflicts.length}) — ต้องแก้ด้วยคน</div>`);
    conflicts.forEach(c => parts.push(`
      <div style="border:1px solid #ef4444;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px">${escHtml(c.state)} — ${escHtml(String(c.job?.job_no || "#" + c.job?.id))}</div>
        <div style="font-size:12px;color:#991b1b">฿${escHtml(fmtAmount(c.job?.total_cost))} · JE #${escHtml(String(c.entryId ?? "—"))} · เหตุ: ${escHtml(c.reason)} — <b>ซ่อมอัตโนมัติไม่ได้</b> (มีเอกสารอยู่แล้ว ระบบกันยิงทับ)</div>
      </div>`));
  }
  if (led) {
    const repairable = [...(led.paymentNoJv || []), ...(led.reversalNoJv || [])];
    const manual = [...(led.paymentNonApproved || []), ...(led.paymentMismatch || []), ...(led.reversalNonApproved || []), ...(led.reversalMismatch || [])];
    if (repairable.length) {
      parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:16px 0 8px">💸 รับชำระ/กลับรายการที่ยังไม่ลงบัญชี (${repairable.length}) — ซ่อมได้</div>`);
      repairable.forEach(it => parts.push(ledgerCardHtml(it.state, it.row.id,
        it.kind === "payment"
          ? `รับชำระ #${it.row.id} · งาน #${it.row.service_job_id} · ฿${fmtAmount(it.row.amount)}`
          : `กลับรายการ #${it.row.id} · รับชำระ #${it.row.payment_id} · ฿${fmtAmount(it.row.amount)}`,
        it.kind)));
    }
    if (manual.length) {
      parts.push(`<div style="font-weight:700;font-size:14px;color:#b45309;margin:16px 0 8px">⛔ รายการบัญชีของ ledger ที่เสีย (${manual.length}) — ต้องแก้ด้วยคน</div>`);
      manual.forEach(it => parts.push(`
        <div style="border:1px solid #ef4444;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-weight:700;font-size:14px">${escHtml(it.state)} — ${escHtml(it.kind)} #${escHtml(String(it.row?.id))}</div>
          <div style="font-size:12px;color:#991b1b">฿${escHtml(fmtAmount(it.row?.amount))} · JE #${escHtml(String(it.entry?.id ?? "—"))} · เหตุ: ${escHtml(it.reason)} — <b>ห้ามซ่อมอัตโนมัติ</b></div>
        </div>`));
    }
  }
  const dateWithJv = res?.dateMissingWithJv || [];
  if (dateWithJv.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:16px 0 8px">⛔ ลงบัญชีแล้วแต่ไม่มีวันปิดงาน (${dateWithJv.length}) — SERVICE_DATE_MISSING_WITH_JV</div>`);
    dateWithJv.forEach(c => parts.push(`
      <div style="border:1px solid #ef4444;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px">${escHtml(String(c.job?.job_no || "#" + c.job?.id))}</div>
        <div style="font-size:12px;color:#991b1b">฿${escHtml(fmtAmount(c.job?.total_cost))} · JE #${escHtml(String(c.entryId ?? "—"))} · ${escHtml(c.reason)} — <b>ต้องให้เจ้าของกำหนดวันรับรู้ก่อน</b> (ซ่อม/โพสต์ซ้ำไม่ได้)</div>
      </div>`));
  }
  if (needDate.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b45309;margin:16px 0 8px">⏳ ต้องกำหนดวันรับรู้รายได้ก่อน (${needDate.length}) — OWNER_RECOGNITION_DATE_REQUIRED</div>`);
    parts.push(needDate.map(needDateCardHtml).join(""));
    parts.push(`<div style="font-size:12px;color:#94a3b8;margin-top:8px">งานเหล่านี้ปิดโดยไม่บันทึกวันปิดงาน — ระบบจะไม่เดาวันให้ (เคยทำให้ JV ลงผิดงวด) ต้องผ่านขั้นตอน recovery ของเจ้าของ</div>`);
  }
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
// ★ review#3 (blocking 4): ขอบเขตงวดต้องเป็น **เวลาไทย** — closed_at/created_at เป็น timestamptz
//   ส่ง "YYYY-MM-DD" เปล่า ๆ ให้ PostgREST = ตีความเป็น UTC → งานที่ปิด 1 ก.ค. 00:30 น. (ไทย)
//   = 30 มิ.ย. 17:30 UTC → หลุดออกจากงวด ก.ค. เงียบ ๆ
export function bkkDayStartIso(dateStr) {
  return `${dateStr}T00:00:00+07:00`;      // ต้น "วันไทย"
}
export function bkkNextDayStartIso(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00:00+07:00`;   // ต้นวันถัดไป (เวลาไทย) = ขอบบน exclusive
}
const enc = (v) => encodeURIComponent(v);   // "+07:00" ต้อง URL-encode ไม่งั้น '+' = ช่องว่าง

const FETCH_LIMIT = 5000;
const LINE_LIMIT  = 20000;

export async function fetchServiceJVStatus(opts = {}) {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const get = (path) => fetch(cfg.url + "/rest/v1/" + path, { headers });

  const effectiveDate = opts.effectiveDate || DEFAULT_EFFECTIVE_DATE;
  const fromDate = opts.fromDate || effectiveDate;     // inclusive (YYYY-MM-DD, เวลาไทย)
  const toDate = opts.toDate || todayBkk();            // inclusive (YYYY-MM-DD, เวลาไทย)
  const fromTs = bkkDayStartIso(fromDate);
  const toTs   = bkkNextDayStartIso(toDate);

  const statusList = SERVICE_INCOME_STATUSES.join(",");
  // recognition period = closed_at (ไม่ใช่ created_at) · งานที่ไม่มี closed_at query แยกด้วย created_at
  const SEL = "select=id,job_no,customer_name,status,total_cost,job_type,payment_method,closed_at,finance_flow_version,note,created_at";
  const closedUrl = `service_jobs?${SEL}&status=in.(${statusList})&closed_at=gte.${enc(fromTs)}&closed_at=lt.${enc(toTs)}&order=closed_at.desc&limit=${FETCH_LIMIT}`;
  const noDateUrl = `service_jobs?${SEL}&status=in.(${statusList})&closed_at=is.null&created_at=gte.${enc(fromTs)}&created_at=lt.${enc(toTs)}&order=created_at.desc&limit=${FETCH_LIMIT}`;

  try {
    const [closedRes, noDateRes, jeRes, mRes] = await Promise.all([
      get(closedUrl),
      get(noDateUrl),
      get(`journal_entries?source_table=eq.service_jobs&select=id,source_id,description,status,total_debit,total_credit&order=id.desc&limit=${FETCH_LIMIT}`),
      get("account_mapping?select=mapping_key,debit_account_code,credit_account_code,recognition_debit_code&is_active=eq.true")
    ]);
    if (!closedRes.ok || !noDateRes.ok) return { ok: false, reason: "ดึงงานบริการไม่สำเร็จ", fromDate, toDate };
    if (!jeRes.ok) return { ok: false, reason: "ดึงข้อมูลสมุดรายวันไม่สำเร็จ (HTTP " + jeRes.status + ")", fromDate, toDate };
    if (!mRes.ok) return { ok: false, reason: "ดึงผังบัญชีไม่สำเร็จ", fromDate, toDate };
    const [closedJobs, noDateJobs, jeRows, mappings] = await Promise.all([closedRes.json(), noDateRes.json(), jeRes.json(), mRes.json()]);
    if (![closedJobs, noDateJobs, jeRows, mappings].every(Array.isArray)) return { ok: false, reason: "ข้อมูลรูปแบบไม่ถูกต้อง", fromDate, toDate };

    // ★ should-fix 1: ชน limit = ข้อมูลไม่ครบ → ห้ามรายงานว่า "สะอาด" (false clean)
    if (closedJobs.length >= FETCH_LIMIT || noDateJobs.length >= FETCH_LIMIT || jeRows.length >= FETCH_LIMIT) {
      return { ok: false, dataIncomplete: true, reason: "DATA_INCOMPLETE — ข้อมูลเกินขีดจำกัดที่ดึงได้ (ผลอาจไม่ครบ) กรุณาย่อช่วงวันที่", fromDate, toDate };
    }

    // ★ review#5 (blocking 2): manual JV จาก journal_form มี source_table/source_id = NULL
    //   → unique index ไม่กัน และ query source_table=service_jobs ก็ไม่เห็น. ถ้าปล่อยไว้ ปุ่ม re-post
    //   จะสร้าง "รายได้ซ้ำ" ทับ JV ที่คนลงมือไว้แล้ว. ดึงแยกแบบ bounded + จับคู่ด้วยเลขงาน **ตรงตัว**
    const unlinkedRes = await get(`journal_entries?source_id=is.null&select=id,description,status,total_debit,total_credit&description=ilike.*JOB-*&order=id.desc&limit=${FETCH_LIMIT}`);
    if (!unlinkedRes.ok) return { ok: false, reason: "ดึงรายการบัญชีที่ไม่ผูก source ไม่สำเร็จ", fromDate, toDate };
    const unlinkedRows = await unlinkedRes.json();
    if (!Array.isArray(unlinkedRows)) return { ok: false, reason: "ข้อมูลรายการบัญชีไม่ถูกต้อง", fromDate, toDate };
    if (unlinkedRows.length >= FETCH_LIMIT) {
      return { ok: false, dataIncomplete: true, reason: "DATA_INCOMPLETE — รายการบัญชีที่ไม่ผูก source เกินขีดจำกัด (ผลอาจไม่ครบ)", fromDate, toDate };
    }
    const unlinkedByJobNo = new Map();       // job_no (exact) → JE ที่ไม่ผูก source
    unlinkedRows.forEach(e => {
      extractPostedJobNos([e.description]).forEach(no => {
        if (!unlinkedByJobNo.has(no)) unlinkedByJobNo.set(no, e);
      });
    });

    let lineRows = [];
    if (jeRows.length) {
      const lRes = await get(`journal_lines?select=entry_id,account_code,debit,credit&entry_id=in.(${jeRows.map(e => e.id).join(",")})&limit=${LINE_LIMIT}`);
      if (!lRes.ok) return { ok: false, reason: "ดึง journal_lines ไม่สำเร็จ", fromDate, toDate };
      lineRows = await lRes.json();
      if (!Array.isArray(lineRows)) return { ok: false, reason: "ข้อมูล journal_lines ไม่ถูกต้อง", fromDate, toDate };
      if (lineRows.length >= LINE_LIMIT) {
        return { ok: false, dataIncomplete: true, reason: "DATA_INCOMPLETE — journal_lines เกินขีดจำกัด (ผลอาจไม่ครบ)", fromDate, toDate };
      }
    }
    const linesByEntry = new Map();
    lineRows.forEach(l => {
      const k = String(l.entry_id);
      if (!linesByEntry.has(k)) linesByEntry.set(k, []);
      linesByEntry.get(k).push(l);
    });
    const jeBySource = new Map();
    jeRows.forEach(e => { if (e?.source_id != null) jeBySource.set(String(e.source_id), e); });
    const mappingsByKey = {};
    mappings.forEach(m => { mappingsByKey[m.mapping_key] = m; });

    const validateJob = (job) => {
      const entry = jeBySource.get(String(job.id)) || null;
      const lines = entry ? (linesByEntry.get(String(entry.id)) || []) : [];
      const mapping = mappingsByKey[serviceMappingKeyForJobType(job.job_type)] || null;
      const v = serviceFinanceFlowOf(job) === 2
        ? validateRecognitionJv({ job, mapping, entry, lines })
        : validateLegacyServiceJv({ job, entry, lines });   // ★ shared strict validator (ไม่มี Number()||0)
      return { entry, v };
    };
    const eligible = (job) => {
      if (!isRecognitionStatusForJob(job)) return false;          // flow-aware (v2 + done ≠ orphan)
      const amount = Number(job.total_cost);
      return Number.isFinite(amount) && amount > 0;
    };

    // งานนี้มี JE ที่คนลงมือไว้เอง (ไม่ผูก source) อ้างเลขงานนี้อยู่ไหม — เลขงานต้อง **ตรงตัว**
    const unlinkedFor = (job) => {
      const no = String(job?.job_no || "").trim();
      return no && unlinkedByJobNo.has(no) ? unlinkedByJobNo.get(no) : null;
    };

    // ★ "posted" = ผ่าน validator เท่านั้น · header เสีย = conflict (auto-repair ไม่ได้ — unique index กันทับ)
    //   ★ review#5: มี JE ที่ไม่ผูก source อ้างเลขงานนี้ = SERVICE_JV_UNLINKED → ห้ามมีปุ่ม re-post
    //     (ยิงซ้ำ = รายได้ซ้ำ เพราะ unique index ไม่กัน source = NULL)
    const orphans = [], conflicts = [];
    closedJobs.filter(eligible).forEach(job => {
      const { entry, v } = validateJob(job);
      if (v.ok) return;
      const state = ledgerStateOf(v);
      const un = unlinkedFor(job);
      if (state === "NO_JV" && un) {
        conflicts.push({ job, state: "SERVICE_JV_UNLINKED", reason: "manual-jv-not-linked", entryId: un.id });
      } else if (state === "NO_JV") {
        orphans.push(job);
      } else {
        conflicts.push({ job, state: `SERVICE_${state}`, reason: v.reason, entryId: entry?.id });
      }
    });

    // ★ review#3 (blocking 5): งานที่ไม่มีวันรับรู้ (closed_at = null) ต้องปรากฏ **หนึ่งกองพอดี** เสมอ
    //   ไม่มี JE  → OWNER_RECOGNITION_DATE_REQUIRED (รอ owner กำหนดวัน — re-post ไม่ได้)
    //   มี JE     → SERVICE_DATE_MISSING_WITH_JV (ลงบัญชีไปแล้วทั้งที่ไม่มีวันปิดงาน = ต้องสอบ ห้ามซ่อน)
    const needRecognitionDate = [], dateMissingWithJv = [];
    noDateJobs.filter(eligible).forEach(job => {
      const { entry, v } = validateJob(job);
      if (!entry) {
        const un = unlinkedFor(job);
        // ★ review#5: ไม่มี source-linked JE แต่มี manual JE อ้างเลขงานนี้ → unlinked conflict
        //   (ไม่ใช่ "รอกำหนดวัน" เฉย ๆ — เพราะรายได้อาจถูกลงบัญชีไปแล้วด้วยมือ)
        if (un) conflicts.push({ job, state: "SERVICE_JV_UNLINKED", reason: "manual-jv-not-linked", entryId: un.id });
        else needRecognitionDate.push(job);
        return;
      }
      dateMissingWithJv.push({
        job, state: "SERVICE_DATE_MISSING_WITH_JV",
        reason: v.ok ? "jv-valid-but-no-recognition-date" : v.reason,
        entryId: entry.id
      });
    });

    return {
      ok: true, orphans, conflicts, needRecognitionDate, dateMissingWithJv,
      jobsFetched: closedJobs.length + noDateJobs.length, jeFetched: jeRows.length, fromDate, toDate
    };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e), fromDate, toDate };
  }
}

export async function _loadAndRender(ctx, container) {   // export = ทดสอบ render path จริงได้
  if (!document.body.contains(container)) return;
  container.innerHTML = loadingHtml();

  const res = await fetchServiceJVStatus({ effectiveDate: DEFAULT_EFFECTIVE_DATE });
  if (!document.body.contains(container)) return;
  if (!res.ok) {
    container.innerHTML = incompleteHtml(res.reason || "ไม่ทราบสาเหตุ");
    return;
  }
  // ★ review#4 (blocking 1): ledger ตรวจไม่ได้ = **ห้ามขึ้นการ์ดเขียว**
  //   (ชน limit / HTTP 500-403-404 / ตารางยังไม่มี / JSON เพี้ยน / journal_lines โหลดไม่ได้)
  //   การ์ดเขียวแปลว่า "ตรวจครบแล้วไม่มีปัญหา" — ถ้าตรวจไม่ได้ต้องบอกตรง ๆ ไม่ใช่ toast แล้วเขียว
  const ledger = await fetchLedgerJVStatus().catch(e => ({ ok: false, reason: "เครือข่าย/สคริปต์ผิดพลาด: " + (e?.message || e) }));
  if (!document.body.contains(container)) return;
  // ★ review#5 (blocking 3): ledger อ่านไม่ได้ = **ห้ามเขียว** แต่ก็ **ห้ามกลืน service findings ที่อ่านได้แล้ว**
  //   → แสดงผลฝั่งงานบริการตามปกติ + แบนเนอร์ LEDGER_UNAVAILABLE/DATA_INCOMPLETE (ไม่มีปุ่มซ่อม ledger)
  res.ledger = ledger?.ok === true ? ledger : null;
  res.ledgerUnavailable = ledger?.ok === true ? null : {
    reason: ledger?.reason || "ไม่ทราบสาเหตุ",
    dataIncomplete: !!ledger?.dataIncomplete
  };

  const orphans = res.orphans || [];
  const needDate = res.needRecognitionDate || [];
  const dateWithJv = res.dateMissingWithJv || [];
  const led = res.ledger;
  const conflicts = res.conflicts || [];
  const ledgerCount = led
    ? led.paymentNoJv.length + led.paymentNonApproved.length + led.paymentMismatch.length
      + led.reversalNoJv.length + led.reversalNonApproved.length + led.reversalMismatch.length
    : 0;
  // การ์ดเขียวขึ้นได้ต่อเมื่อ **อ่านครบทั้งสองฝั่ง** และทุก taxonomy สะอาด
  if (!res.ledgerUnavailable && !orphans.length && !needDate.length && !dateWithJv.length && !conflicts.length && !ledgerCount) {
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
  // bind ปุ่มซ่อม JV ของ ledger (PAYMENT_NO_JV / REVERSAL_NO_JV) — idempotent, ไม่แตะ ledger
  container.querySelectorAll(".svc-recon-ledger-retry").forEach(btn => {
    btn.addEventListener("click", () => _handleLedgerRetry(ctx, container, btn.dataset.kind, btn.dataset.rowId, btn));
  });
}

async function _handleLedgerRetry(ctx, container, kind, rowId, btn) {
  if (!rowId || _repostInflight) { if (_repostInflight) ctx?.showToast?.("กำลังส่ง... รอสักครู่"); return; }
  _repostInflight = true;
  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง..."; }
  try {
    const res = kind === "reversal"
      ? await postJournalForServicePaymentReversal(rowId, { detailed: true })
      : await postJournalForServicePayment(rowId, { detailed: true });
    ctx?.showToast?.(jvResultToToast(res).message);      // ★ helper เดียวกับปุ่ม re-post งานบริการ
  } catch (e) {
    console.error("[service_reconcile] ledger retry error:", e?.message || e);
    ctx?.showToast?.("⚠️ ลงบัญชีไม่สำเร็จ (ดู Console)");
  } finally {
    _repostInflight = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = origText; }
    _loadAndRender(ctx, container).catch(err => console.warn("[service_reconcile] refresh", err));
  }
}

async function _handleRepost(ctx, container, job, btn) {
  if (!job) return;
  if (_repostInflight) { ctx?.showToast?.("กำลังส่ง... รอสักครู่"); return; }
  _repostInflight = true;
  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง..."; }
  try {
    // ★ Phase 606-b1: ใช้ canonical writer ตัวเดิม (ห้าม insert JE ตรง) + อ่านเหตุผลจริงจาก detailed
    //   result — re-post **ลัด gate ไม่ได้**: งานที่ไม่มีวันรับรู้รายได้ (closed_at = null) หรือ
    //   metadata flow หาย จะถูก block และบอกเหตุผลตรง ๆ (เดิมเหมาะรวมเป็น "อาจมีรายการอยู่แล้ว")
    const res = await postJournalForServiceJob(job, { detailed: true });
    ctx?.showToast?.(jvResultToToast(res).message);      // ★ toast policy ชุดเดียวกับปุ่มซ่อม ledger
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
