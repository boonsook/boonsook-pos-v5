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
import { validateRecognitionJv, validatePaymentJv, validateReversalJv, paymentDebitCode, ledgerStateOf } from "./accounting/service_jv_validate.js";
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
    const v = validatePaymentJv({ payment: p, mapping, entry: found.entry, lines: found.lines });
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
    const v = validateReversalJv({
      reversal: r,
      paymentDebit: paymentDebitCode(pay, mapping),
      recognitionCode: mapping?.recognition_debit_code,
      entry: found.entry, lines: found.lines
    });
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

    let lineRows = [];
    if (jeRows.length) {
      const ids = jeRows.map(e => e.id).join(",");
      const lRes = await get(`journal_lines?select=entry_id,account_code,debit,credit&entry_id=in.(${ids})&limit=20000`);
      if (!lRes.ok) return { ok: false, reason: "ดึง journal_lines ไม่สำเร็จ" };
      lineRows = await lRes.json();
      if (!Array.isArray(lineRows)) return { ok: false, reason: "ข้อมูล journal_lines ไม่ถูกต้อง" };
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
export async function fetchServiceJVStatus(opts = {}) {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const get = (path) => fetch(cfg.url + "/rest/v1/" + path, { headers });

  const effectiveDate = opts.effectiveDate || DEFAULT_EFFECTIVE_DATE;
  const fromDate = opts.fromDate || effectiveDate;     // inclusive (YYYY-MM-DD)
  const toDate = opts.toDate || todayBkk();            // inclusive (YYYY-MM-DD)
  const nd = new Date(toDate + "T00:00:00Z");
  nd.setUTCDate(nd.getUTCDate() + 1);
  const toExclusive = nd.toISOString().slice(0, 10);

  const statusList = SERVICE_INCOME_STATUSES.join(",");
  // ★ review#2 (blocking 4): recognition period = **closed_at** (ไม่ใช่ created_at)
  //   → query 1: งานที่มี closed_at ในช่วงที่ตรวจ (สร้าง มิ.ย. ปิด ก.ค. ต้องอยู่ในรายงาน ก.ค.;
  //              สร้าง ก.ค. ปิด ส.ค. ต้อง **ไม่** อยู่ในรายงาน ก.ค.)
  //   → query 2: งานที่ closed_at = null (ไม่มีวันรับรู้เลย) — scope ด้วย created_at เพื่อให้เห็น
  //              และเข้ากอง OWNER_RECOGNITION_DATE_REQUIRED (re-post ไม่ได้จนกว่า owner กำหนดวัน)
  const SEL = "select=id,job_no,customer_name,status,total_cost,job_type,payment_method,closed_at,finance_flow_version,note,created_at";
  const closedUrl = `service_jobs?${SEL}&status=in.(${statusList})&closed_at=gte.${fromDate}&closed_at=lt.${toExclusive}&order=closed_at.desc&limit=5000`;
  const noDateUrl = `service_jobs?${SEL}&status=in.(${statusList})&closed_at=is.null&created_at=gte.${fromDate}&created_at=lt.${toExclusive}&order=created_at.desc&limit=5000`;

  try {
    const [closedRes, noDateRes, jeRes, mRes] = await Promise.all([
      get(closedUrl),
      get(noDateUrl),
      get("journal_entries?source_table=eq.service_jobs&select=id,source_id,description,status,total_debit,total_credit&order=id.desc&limit=5000"),
      get("account_mapping?select=mapping_key,debit_account_code,credit_account_code,recognition_debit_code&is_active=eq.true")
    ]);
    if (!closedRes.ok || !noDateRes.ok) return { ok: false, reason: "ดึงงานบริการไม่สำเร็จ", fromDate, toDate };
    if (!jeRes.ok) return { ok: false, reason: "ดึงข้อมูลสมุดรายวันไม่สำเร็จ (HTTP " + jeRes.status + ")", fromDate, toDate };
    if (!mRes.ok) return { ok: false, reason: "ดึงผังบัญชีไม่สำเร็จ", fromDate, toDate };
    const [closedJobs, noDateJobs, jeRows, mappings] = await Promise.all([closedRes.json(), noDateRes.json(), jeRes.json(), mRes.json()]);
    if (![closedJobs, noDateJobs, jeRows, mappings].every(Array.isArray)) return { ok: false, reason: "ข้อมูลรูปแบบไม่ถูกต้อง", fromDate, toDate };

    // lines ของ JE งานบริการ — ต้องมี ถึงจะบอกได้ว่า "ลงบัญชีถูกจริง" ไม่ใช่แค่ "มี header"
    let lineRows = [];
    if (jeRows.length) {
      const lRes = await get(`journal_lines?select=entry_id,account_code,debit,credit&entry_id=in.(${jeRows.map(e => e.id).join(",")})&limit=20000`);
      if (!lRes.ok) return { ok: false, reason: "ดึง journal_lines ไม่สำเร็จ", fromDate, toDate };
      lineRows = await lRes.json();
      if (!Array.isArray(lineRows)) return { ok: false, reason: "ข้อมูล journal_lines ไม่ถูกต้อง", fromDate, toDate };
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

    // ★ "posted" = JV ที่ **ผ่าน validator** เท่านั้น (approved + lines + บัญชี + ยอด)
    //   header เสีย (draft/ไม่มี lines/บัญชีผิด) = **conflict** ต้องแจ้ง ไม่ใช่ซ่อนว่าเรียบร้อย
    //   และ auto-repair ไม่ได้ (unique source index จะไม่ให้ยิงทับ)
    const orphans = [], conflicts = [];
    const consider = (job) => {
      if (!isRecognitionStatusForJob(job)) return;                       // flow-aware (v2 + done = ไม่ใช่ orphan)
      const amount = Number(job.total_cost);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const entry = jeBySource.get(String(job.id)) || null;
      const lines = entry ? (linesByEntry.get(String(entry.id)) || []) : [];
      const mapping = mappingsByKey[serviceMappingKeyForJobType(job.job_type)] || null;
      const flow = serviceFinanceFlowOf(job);
      // flow v1: JV เดิม Dr เงินสด/ธนาคาร → ตรวจได้แค่ "มี header approved + lines" (บัญชีขึ้นกับ payment_method เดิม)
      const v = flow === 2
        ? validateRecognitionJv({ job, mapping, entry, lines })
        : validateTwoLegLegacy({ entry, lines, amount });
      if (v.ok) return;
      const state = ledgerStateOf(v);
      if (state === "NO_JV") orphans.push(job);
      else conflicts.push({ job, state: `SERVICE_${state}`, reason: v.reason, entryId: entry?.id });
    };
    closedJobs.forEach(consider);

    const needRecognitionDate = noDateJobs.filter(j => {
      if (!isRecognitionStatusForJob(j)) return false;
      const amount = Number(j.total_cost);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      return !jeBySource.has(String(j.id));      // มี JV แล้วก็ไม่ต้องตาม (วันผิดเป็นเรื่องของ recovery)
    });

    return {
      ok: true, orphans, conflicts, needRecognitionDate,
      jobsFetched: closedJobs.length + noDateJobs.length, jeFetched: jeRows.length, fromDate, toDate
    };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e), fromDate, toDate };
  }
}

// flow v1 (legacy): Dr = เงินสด/ธนาคาร ตาม payment_method เดิม → ตรวจ "approved + มี lines + บาลานซ์ + ยอดตรง"
// (ไม่ผูกบัญชีตายตัว เพราะ mapping/ช่องทางเดิมเปลี่ยนได้ — ดูหมายเหตุ historical drift ใน SQL 606-b1)
function validateTwoLegLegacy({ entry, lines, amount }) {
  const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  if (!entry) return { ok: false, reason: "no-header" };
  if (String(entry.status || "").toLowerCase() !== "approved") return { ok: false, reason: "not-approved" };
  const ls = (lines || []).filter(l => Number(l.debit) || Number(l.credit));
  if (!ls.length) return { ok: false, reason: "no-lines" };
  const d = _r2(ls.reduce((s, l) => s + Number(l.debit || 0), 0));
  const c = _r2(ls.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (d !== c) return { ok: false, reason: "unbalanced" };
  if (_r2(entry.total_debit) !== d) return { ok: false, reason: "header-mismatch" };
  if (d !== _r2(amount)) return { ok: false, reason: "amount-mismatch" };
  return { ok: true, reason: "ok" };
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
  // ★ Phase 606-b1: ledger รับชำระ/กลับรายการ (flow v2) — ledger มีแถวแต่ JV หาย ต้องซ่อมได้
  //   fail-soft: ตาราง ledger ยังไม่มี (ก่อน migration b1) → ข้ามส่วนนี้ ไม่ทำให้หน้าเสีย
  const ledger = await fetchLedgerJVStatus().catch(() => ({ ok: false }));
  res.ledger = ledger.ok ? ledger : null;
  if (!document.body.contains(container)) return;

  const orphans = res.orphans || [];
  const needDate = res.needRecognitionDate || [];
  const led = res.ledger;
  const conflicts = res.conflicts || [];
  const ledgerCount = led
    ? led.paymentNoJv.length + led.paymentNonApproved.length + led.paymentMismatch.length
      + led.reversalNoJv.length + led.reversalNonApproved.length + led.reversalMismatch.length
    : 0;
  if (!orphans.length && !needDate.length && !conflicts.length && !ledgerCount) {
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
    if (res?.status === "posted") ctx?.showToast?.(`✅ ลงบัญชีแล้ว (JE #${res.entryId || res.docNo || ""})`.trim());
    else if (res?.reason === "duplicate") ctx?.showToast?.("มีรายการบัญชีอยู่แล้ว (ไม่สร้างซ้ำ)");
    else ctx?.showToast?.(`ยังไม่สำเร็จ (${res?.reason || "unknown"}) — ดู Console`);
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
    if (res?.status === "posted") {
      ctx?.showToast?.(`✅ ส่งเข้าบัญชีแล้ว (JE #${res.entryId || res.docNo || ""})`.trim());
    } else if (res?.reason === "recognition-date-required") {
      ctx?.showToast?.("⛔ งานนี้ไม่มีวันรับรู้รายได้ (closed_at) — ต้องให้เจ้าของกำหนดวันผ่าน recovery ก่อน");
    } else if (res?.reason === "finance-flow-unknown") {
      ctx?.showToast?.("⛔ ข้อมูล finance flow ของงานนี้ไม่ครบ — ลงบัญชีไม่ได้ (แจ้งผู้ดูแล)");
    } else if (res?.reason === "not-income-status") {
      ctx?.showToast?.("⛔ งานนี้ยังไม่ส่งมอบ — ยังรับรู้รายได้ไม่ได้");
    } else {
      // idempotency hit (มี JE อยู่แล้ว) / period locked / ก่อน effective date / post ล้มจริง
      ctx?.showToast?.(`ยังไม่สำเร็จ (${res?.reason || "unknown"}) — ดู Console`);
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
