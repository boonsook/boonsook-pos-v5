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
import { postJournalForServiceJob, postJournalForServicePayment, postJournalForServicePaymentReversal } from "./accounting/auto_post.js";
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
//  Phase 606-b1 — ledger การรับชำระ/กลับรายการ (flow v2) เทียบ JV
// ═══════════════════════════════════════════════════════════
// taxonomy:
//   PAYMENT_NO_JV     — มีเงินใน ledger แต่ไม่มี JV (เงินเข้าจริงแต่บัญชีไม่รู้) → retry ได้
//   REVERSAL_NO_JV    — กลับรายการใน ledger แต่ JV กลับรายการหาย → retry ได้
//   REVERSAL_MISMATCH — มี JV กลับรายการแต่ยอดไม่ตรง ledger → **ห้าม retry** ต้องให้คนตรวจ
export const LEDGER_JV_STATES = ["PAYMENT_NO_JV", "REVERSAL_NO_JV", "REVERSAL_MISMATCH"];

function _jeIndex(jeRows) {
  const map = new Map();
  (Array.isArray(jeRows) ? jeRows : []).forEach(r => {
    if (r?.source_id === undefined || r?.source_id === null) return;
    map.set(`${r.source_table}#${r.source_id}`, r);
  });
  return map;
}
const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** pure — ไม่มี DOM/network (ทดสอบตรง) */
export function classifyLedgerJv({ payments = [], reversals = [], jeRows = [] } = {}) {
  const je = _jeIndex(jeRows);
  const paymentNoJv = [], reversalNoJv = [], reversalMismatch = [];
  payments.forEach(p => {
    const e = je.get(`service_payments#${p.id}`);
    if (!e) paymentNoJv.push(p);
    else if (_r2(e.total_debit) !== _r2(p.amount)) reversalMismatch.push({ kind: "payment", row: p, entry: e });
  });
  reversals.forEach(r => {
    const e = je.get(`service_payment_reversals#${r.id}`);
    if (!e) reversalNoJv.push(r);
    else if (_r2(e.total_debit) !== _r2(r.amount)) reversalMismatch.push({ kind: "reversal", row: r, entry: e });
  });
  return { paymentNoJv, reversalNoJv, reversalMismatch };
}

/** READ-ONLY GET — ledger + JV ของทั้งสอง source table */
export async function fetchLedgerJVStatus() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  try {
    const [pRes, rRes, jRes] = await Promise.all([
      fetch(cfg.url + "/rest/v1/service_payments?select=id,service_job_id,amount,payment_method,paid_at&order=id.desc&limit=5000", { headers }),
      fetch(cfg.url + "/rest/v1/service_payment_reversals?select=id,payment_id,amount,reason,reversed_at&order=id.desc&limit=5000", { headers }),
      fetch(cfg.url + "/rest/v1/journal_entries?source_table=in.(service_payments,service_payment_reversals)&select=source_table,source_id,total_debit,status&limit=5000", { headers })
    ]);
    if (!pRes.ok || !rRes.ok || !jRes.ok) return { ok: false, reason: "ดึงข้อมูล ledger/สมุดรายวันไม่สำเร็จ" };
    const [payments, reversals, jeRows] = await Promise.all([pRes.json(), rRes.json(), jRes.json()]);
    if (!Array.isArray(payments) || !Array.isArray(reversals) || !Array.isArray(jeRows)) return { ok: false, reason: "ข้อมูลรูปแบบไม่ถูกต้อง" };
    return { ok: true, ...classifyLedgerJv({ payments, reversals, jeRows }), paymentsFetched: payments.length, reversalsFetched: reversals.length };
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
  if (led && (led.paymentNoJv?.length || led.reversalNoJv?.length || led.reversalMismatch?.length)) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:16px 0 8px">💸 การรับชำระ/กลับรายการที่ยังไม่ลงบัญชี</div>`);
    (led.paymentNoJv || []).forEach(p => parts.push(ledgerCardHtml("PAYMENT_NO_JV", p.id, `รับชำระ #${p.id} · งาน #${p.service_job_id} · ฿${fmtAmount(p.amount)}`, "payment")));
    (led.reversalNoJv || []).forEach(r => parts.push(ledgerCardHtml("REVERSAL_NO_JV", r.id, `กลับรายการ #${r.id} · รับชำระ #${r.payment_id} · ฿${fmtAmount(r.amount)}`, "reversal")));
    (led.reversalMismatch || []).forEach(m => parts.push(`
      <div style="border:1px solid #ef4444;background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px">⛔ REVERSAL_MISMATCH — ${escHtml(m.kind)} #${escHtml(String(m.row?.id))}</div>
        <div style="font-size:12px;color:#991b1b">ยอดใน ledger ฿${escHtml(fmtAmount(m.row?.amount))} ไม่ตรงกับ JV ฿${escHtml(fmtAmount(m.entry?.total_debit))} — <b>ห้ามซ่อมอัตโนมัติ</b> ต้องตรวจด้วยคน</div>
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
  // ★ Phase 606-b1 (blocking 3): ต้อง select **ทุกฟิลด์ที่ canonical writer ใช้ตัดสิน** — ไม่งั้นปุ่ม
  //   "ส่งเข้าบัญชีอีกครั้ง" จะส่ง row ที่ไม่มี finance_flow_version/closed_at/job_type เข้า writer
  //   แล้วโดน block (finance-flow-unknown) ทุกครั้ง = ปุ่มตายเงียบ
  const jobsUrl = cfg.url + "/rest/v1/service_jobs"
    + "?select=id,job_no,customer_name,status,total_cost,job_type,payment_method,closed_at,finance_flow_version,note,created_at"
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
    const all = findUnpostedServiceJobs(jobs, buildPostedRef(jeRows), { effectiveDate });
    // ★ แยกกอง: งานที่ re-post ได้จริง vs งานที่ "ไม่มีวันรับรู้รายได้" (closed_at = null) ซึ่ง writer
    //   จะ block เสมอ — ต้องให้ owner กำหนดวันผ่าน recovery (Phase 607) ไม่ใช่ให้กดปุ่มแล้วงงว่าทำไมไม่ขึ้น
    const orphans = all.filter(j => j.closed_at);
    const needRecognitionDate = all.filter(j => !j.closed_at);
    return { ok: true, orphans, needRecognitionDate, jobsFetched: jobs.length, jeFetched: jeRows.length, fromDate, toDate };
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
  // ★ Phase 606-b1: ledger รับชำระ/กลับรายการ (flow v2) — ledger มีแถวแต่ JV หาย ต้องซ่อมได้
  //   fail-soft: ตาราง ledger ยังไม่มี (ก่อน migration b1) → ข้ามส่วนนี้ ไม่ทำให้หน้าเสีย
  const ledger = await fetchLedgerJVStatus().catch(() => ({ ok: false }));
  res.ledger = ledger.ok ? ledger : null;
  if (!document.body.contains(container)) return;

  const orphans = res.orphans || [];
  const needDate = res.needRecognitionDate || [];
  const led = res.ledger;
  const ledgerCount = led ? (led.paymentNoJv.length + led.reversalNoJv.length + led.reversalMismatch.length) : 0;
  if (!orphans.length && !needDate.length && !ledgerCount) {
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
