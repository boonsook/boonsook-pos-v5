// ═══════════════════════════════════════════════════════════
//  service_no_jv_recover_lib.js — Phase 605 (S4.1c) PURE helpers
//  ตรรกะ "อนุญาตให้ซ่อมหรือไม่" ของ recovery runner — แยกจาก I/O เพื่อ unit-test ด้วย fixture
//
//  ★ PURE: ไม่มี env / fetch / side-effect ตอน import
//  ★ ไฟล์นี้ไม่ post JV และไม่แตะสต็อก — แค่ตัดสินว่างานไหน "พร้อมให้ writer ทำงาน" เท่านั้น
//  ★ ห้ามผ่อน semantics ของ S4.1b: readiness/overallS41cReady/--strict ของ classifier ไม่ถูกแก้
//    เฟสนี้เพิ่ม "owner decision" เข้ามาเป็น input ใหม่ (recognitionAt + stockDecision) แล้วคำนวณ
//    ความพร้อมของ recovery ต่างหาก (computeRecoveryReadiness)
// ═══════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { bkkDate, round2 } from "./finance_reconcile_lib.js";
import { serviceMappingKeyForJobTypeAudit } from "./service_no_jv_classify_lib.js";

export { bkkDate, round2, serviceMappingKeyForJobTypeAudit };

export const CONFIRM_TOKEN = "SERVICE-NO-JV-S4.1C";
export const PLAN_SCHEMA_VERSION = 2;   // v2 = plan ต้องมี sourceSnapshotSha256 ต่อ job (durable snapshot)

// ── durable source snapshot (★ review fix B1) ──────────────
//  plan ที่ owner อนุมัติต้อง "ผูกกับสภาพ row ตอนอนุมัติ" ไม่ใช่แค่ยอด/สถานะ ณ ตอนรัน
//  → hash canonical fields ทั้ง 7 (รวม note ที่กระทบ JV/soft-delete) แต่ **เก็บแค่ hash ไม่เก็บ note ดิบ** (PII)
export const SNAPSHOT_FIELDS = ["id", "job_no", "status", "total_cost", "job_type", "payment_method", "note"];

/** domain separator + version — กัน hash ของ snapshot ไปชนกับ hash ของอย่างอื่นในระบบ */
export const SNAPSHOT_DOMAIN = "service_jobs_snapshot_v1";

/**
 * canonical preimage ของ row (ค่าที่ writer ใช้ทำ JV + ค่าที่ตัดสินว่างานถูกลบ/ยกเลิก)
 * ★ review fix: เดิม join ด้วย "|" + "=" แบบไม่ escape → **delimiter injection**: ค่าที่มี "|" หรือ "note="
 *   อยู่ข้างในทำให้ row คนละแบบได้ preimage เดียวกัน (เช่น payment_method="cash", note="transfer|note=z"
 *   ชนกับ payment_method="cash|note=transfer", note="z" → Dr เปลี่ยนจากเงินสดเป็นเงินโอนโดย hash ไม่ขยับ)
 *   → ใช้ JSON.stringify ของ array ที่มีลำดับตายตัว (JSON escape ทุก separator ในตัวค่าเอง) + domain/version
 */
export function canonicalSourceString(job) {
  const v = (x) => (x === null || x === undefined) ? "" : String(x);
  return JSON.stringify([
    SNAPSHOT_DOMAIN,
    v(job?.id),
    v(job?.job_no),
    v(job?.status).trim().toLowerCase(),
    round2(job?.total_cost).toFixed(2),
    v(job?.job_type).trim().toLowerCase(),
    v(job?.payment_method).trim().toLowerCase(),
    v(job?.note)
  ]);
}
export function computeSourceSnapshotSha256(job) {
  return createHash("sha256").update(canonicalSourceString(job), "utf8").digest("hex");
}
/** row ปัจจุบันยังตรงกับสภาพตอน owner อนุมัติ plan ไหม (ใช้ทั้ง pending / resume / verified) */
export function verifySourceSnapshot(job, planJob) {
  const want = String(planJob?.sourceSnapshotSha256 || "");
  if (!want) return { ok: false, reason: "PLAN_SOURCE_SNAPSHOT_MISSING" };
  const got = computeSourceSnapshotSha256(job);
  if (got !== want) return { ok: false, reason: "PLAN_SOURCE_SNAPSHOT_DRIFT", got };   // ★ ไม่ print ค่า field (PII)
  return { ok: true, sha: got };
}

// ── credential guard (★ review fix B2) ─────────────────────
//  service_role key ห้ามใช้กับ runner นี้เด็ดขาด (มันข้าม RLS ทั้งหมด)
//  ตรวจได้ 2 แบบ: (a) key ใหม่ `sb_secret_...` (b) JWT เก่า → decode payload (base64url) แล้วดู role/ref
function _b64urlDecode(seg) {
  const s = String(seg || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  try { return Buffer.from(s + pad, "base64").toString("utf8"); } catch (_) { return ""; }
}
/** @returns {{ok:boolean, reason?:string, role?:string}} ok=false = ห้ามใช้ key นี้ */
export function assertPublishableKey(key) {
  const k = String(key || "").trim();
  if (!k) return { ok: false, reason: "SUPABASE_KEY_MISSING" };
  if (/^sb_secret_/i.test(k)) return { ok: false, reason: "SERVICE_ROLE_KEY_DETECTED (sb_secret_ prefix)" };
  const parts = k.split(".");
  if (parts.length === 3) {                       // JWT (legacy anon/service_role)
    const payload = (() => {
      try { return JSON.parse(_b64urlDecode(parts[1]) || "null"); } catch (_) { return null; }
    })();
    // ★ review fix (fail-closed): decode payload ไม่ได้ / ไม่มี role → ไม่รู้ว่าเป็น key อะไร = ห้ามใช้
    if (!payload || typeof payload !== "object") return { ok: false, reason: "JWT_PAYLOAD_UNREADABLE" };
    const role = String(payload.role || "");
    if (role === "service_role") return { ok: false, reason: "SERVICE_ROLE_KEY_DETECTED (JWT role=service_role)", role };
    if (role !== "anon" && role !== "authenticated") {
      return { ok: false, reason: `UNEXPECTED_KEY_ROLE (${role || "ไม่มี role"})`, role };
    }
    return { ok: true, role };
  }
  if (/^sb_publishable_/i.test(k)) return { ok: true, role: "publishable" };
  // ★ fail-closed: รูปแบบที่ไม่รู้จัก = ปฏิเสธ (ห้ามเดาว่าเป็น anon แล้วปล่อยผ่าน)
  return { ok: false, reason: "UNKNOWN_KEY_FORMAT (ต้องเป็น JWT anon หรือ sb_publishable_)" };
}

/** stockDecision ที่ owner ระบุได้ใน plan */
export const STOCK_DECISIONS = {
  NOT_REQUIRED: "NOT_REQUIRED",                             // งานไม่มีอุปกรณ์ (ต้องตรง classifier)
  OWNER_VERIFIED_NO_STOCK_WRITE: "OWNER_VERIFIED_NO_STOCK_WRITE", // owner ตรวจของจริงแล้ว ไม่ต้องแก้สต็อก (ต้องมี evidence ref + verdict อยู่ใน allowlist)
  STOCK_RECOVERY_REQUIRED: "STOCK_RECOVERY_REQUIRED",       // ต้องซ่อมสต็อก → phase แยก (block apply)
  UNRESOLVED: "UNRESOLVED"                                  // ยังไม่ตัดสิน (block apply)
};
const APPLY_BLOCKING_STOCK_DECISIONS = new Set([STOCK_DECISIONS.STOCK_RECOVERY_REQUIRED, STOCK_DECISIONS.UNRESOLVED]);

// ★ review fix (#6): owner "ตรวจแล้วไม่ต้องแก้สต็อก" ได้เฉพาะเคสที่ *นับของจริงแล้วสรุปได้*
//   (ไม่มีหลักฐาน movement / qty ตรงแต่ยืนยันคลังไม่ได้ / movement ไม่มี marker / log ไม่ครบ)
export const OWNER_VERIFIABLE_STOCK_VERDICTS = new Set([
  "STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE",
  "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE",
  "STOCK_MOVEMENT_WITHOUT_MARKER",
  "STOCK_PARTIAL_OR_LOG_INCOMPLETE"
]);
// ★ hard conflict / ข้อมูลไม่ครบ = block เสมอ แม้ owner จะยืนยันมา (ต้องไปแก้ที่ต้นเหตุก่อน)
export const HARD_STOCK_BLOCKERS = new Set([
  "STOCK_REVERTED_CONFLICT",
  "STOCK_MARKER_MOVEMENT_CONFLICT",
  "STOCK_PARTIAL_EXPECTATION_UNVERIFIABLE",
  "STOCK_UNVERIFIABLE",
  "STOCK_DATA_INCOMPLETE"
]);

// ── mapping → บัญชีที่ JV *ต้อง* ใช้ (ตรงกับ postJournalForServiceJob) ──
/**
 * ★ review fix (#3): read-back ต้องเทียบบัญชีของ mapping "งานนี้" แบบ exact — ห้ามใช้ union
 * ของทุก mapping (ไม่งั้น JV ที่ลงบัญชีของงานประเภทอื่นจะผ่าน verify)
 * mirror auto_post.js: transfer/โอน/qr/bank → transfer_debit_code ถ้าอยู่ใน COA ที่ active,
 * ไม่งั้น fallback "1130"; COA ว่าง (fetch fail) = fail-open ใช้ candidate (เหมือน writer)
 */
export function expectedJournalAccounts({ jobType, paymentMethod, mappings, validCoaCodes = null }) {
  const key = serviceMappingKeyForJobTypeAudit(jobType);
  const m = (mappings && (mappings.get ? mappings.get(key) : mappings[key])) || null;
  if (!m || !m.debit_account_code || !m.credit_account_code) return { ok: false, mappingKey: key, debit: null, credit: null };
  let debit = String(m.debit_account_code);
  const pm = String(paymentMethod || "").toLowerCase();
  if (/transfer|โอน|qr|bank/.test(pm)) {
    const cand = m.transfer_debit_code ? String(m.transfer_debit_code) : "";
    if (!cand) debit = "1130";
    else if (!validCoaCodes || validCoaCodes.size === 0 || validCoaCodes.has(cand)) debit = cand;   // fail-open เหมือน writer
    else debit = "1130";
  }
  return { ok: true, mappingKey: key, debit, credit: String(m.credit_account_code) };
}

// ── recognitionAt ──────────────────────────────────────────
/**
 * ISO-8601 ที่ "มี timezone ชัดเจน" เท่านั้น (Z หรือ ±HH:MM) — ห้ามรับเวลาลอย ๆ ที่ตีความได้หลายแบบ
 * ★ ห้าม fallback created_at (นี่คือวันที่ owner อนุมัติ ไม่ใช่ค่าที่ระบบเดา)
 */
export function validateRecognitionAt(value) {
  if (typeof value !== "string" || !value.trim()) return { ok: false, reason: "RECOGNITION_AT_MISSING" };
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    return { ok: false, reason: "RECOGNITION_AT_NO_TIMEZONE" };   // ไม่มี Z/offset = ปฏิเสธ
  }
  const t = new Date(s);
  if (isNaN(t.getTime())) return { ok: false, reason: "RECOGNITION_AT_INVALID" };
  return { ok: true, iso: t.toISOString(), docDate: bkkDate(t) };  // docDate = Bangkok date เดียวกับ writer (dateBkk)
}

// ── plan parsing/validation (pure — runner อ่านไฟล์แล้วส่ง object เข้ามา) ──
export function parseRecoveryPlan(raw) {
  const errors = [];
  const plan = (raw && typeof raw === "object") ? raw : null;
  if (!plan) return { ok: false, errors: ["PLAN_NOT_OBJECT"], plan: null };
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) errors.push(`PLAN_SCHEMA_VERSION_MISMATCH (ต้องเป็น ${PLAN_SCHEMA_VERSION})`);
  if (!plan.approvedBy || typeof plan.approvedBy !== "string") errors.push("PLAN_APPROVED_BY_MISSING");
  const approvedAt = validateRecognitionAt(plan.approvedAt);
  if (!approvedAt.ok) errors.push(`PLAN_APPROVED_AT_INVALID (${approvedAt.reason})`);
  const b = plan.baseline;
  if (!b || typeof b !== "object") errors.push("PLAN_BASELINE_MISSING");
  else {
    if (!Array.isArray(b.months) || b.months.length === 0) errors.push("PLAN_BASELINE_MONTHS_MISSING");
    if (!Number.isFinite(Number(b.candidateCount))) errors.push("PLAN_BASELINE_COUNT_MISSING");
    if (!Number.isFinite(Number(b.candidateAmount))) errors.push("PLAN_BASELINE_AMOUNT_MISSING");
  }
  if (!Array.isArray(plan.jobs) || plan.jobs.length === 0) errors.push("PLAN_JOBS_MISSING");
  else {
    const seen = new Set();
    plan.jobs.forEach((j, i) => {
      const at = `jobs[${i}]`;
      if (j?.sourceId === null || j?.sourceId === undefined || String(j.sourceId) === "") errors.push(`${at}: SOURCE_ID_MISSING`);
      else if (seen.has(String(j.sourceId))) errors.push(`${at}: DUPLICATE_SOURCE_ID`);
      else seen.add(String(j.sourceId));
      if (!j?.expectedJobNo) errors.push(`${at}: EXPECTED_JOB_NO_MISSING`);
      const amt = Number(j?.expectedAmount);
      if (!Number.isFinite(amt) || amt < 0.01) errors.push(`${at}: EXPECTED_AMOUNT_INVALID (ต้อง ≥ 0.01)`);
      if (!j?.expectedStatus || !["done", "delivered", "closed"].includes(String(j.expectedStatus).toLowerCase())) errors.push(`${at}: EXPECTED_STATUS_INVALID`);
      const r = validateRecognitionAt(j?.recognitionAt);
      if (!r.ok) errors.push(`${at}: ${r.reason}`);
      // ★ B1: plan v2 ต้องผูก snapshot ของ row ตอนอนุมัติ (sha256 hex 64 ตัว)
      if (!/^[0-9a-f]{64}$/i.test(String(j?.sourceSnapshotSha256 || ""))) errors.push(`${at}: SOURCE_SNAPSHOT_SHA256_MISSING_OR_INVALID`);
      const sd = j?.stockDecision;
      if (!sd || !Object.values(STOCK_DECISIONS).includes(sd)) errors.push(`${at}: STOCK_DECISION_INVALID`);
      if (sd === STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE && !String(j?.stockEvidenceRef || "").trim()) {
        errors.push(`${at}: STOCK_EVIDENCE_REF_REQUIRED (OWNER_VERIFIED_NO_STOCK_WRITE ต้องอ้างหลักฐานที่ owner ตรวจ)`);
      }
    });
  }
  return { ok: errors.length === 0, errors, plan };
}

/**
 * ★ review fix (#1): baseline ต้องคิดบนสถานะ **หลัง partial write** ได้ด้วย
 * - baseline.count/amount = VERIFIED_COMPLETE + PENDING_RECOVERY (งานที่โพสต์ไปแล้วยังนับอยู่ใน baseline)
 * - งาน NO_JV ที่ live เห็นตอนนี้แต่ไม่อยู่ใน plan = BASELINE_DRIFT (งานใหม่โผล่ → ต้อง STOP)
 * - งานใน plan ที่อยู่สถานะ CONFLICT = block
 * @param {object} p
 * @param {object} p.plan
 * @param {Map<string,{state:string, problems:string[]}>} p.planStates - sourceId → state
 * @param {Array<string>} p.liveCandidateIds - id ของงาน NO_JV ที่ classifier เห็น "ตอนนี้"
 */
export function planBaselineMatches({ plan, planStates = new Map(), liveCandidateIds = [] } = {}) {
  const errors = [];
  const b = plan?.baseline || {};
  const jobs = plan?.jobs || [];
  const counted = jobs.filter(j => {
    const st = planStates.get(String(j.sourceId))?.state;
    return st === PLAN_JOB_STATES.VERIFIED_COMPLETE || st === PLAN_JOB_STATES.PENDING_RECOVERY;
  });
  const countedAmount = round2(counted.reduce((a, j) => a + round2(j.expectedAmount), 0));
  if (Number(b.candidateCount) !== counted.length) {
    errors.push(`BASELINE_DRIFT: count คาด ${b.candidateCount} พบ ${counted.length} (verified+pending)`);
  }
  if (Math.abs(Number(b.candidateAmount) - countedAmount) >= 0.01) {
    errors.push(`BASELINE_DRIFT: amount คาด ${b.candidateAmount} พบ ${countedAmount} (verified+pending)`);
  }
  const planIds = new Set(jobs.map(j => String(j.sourceId)));
  const newOnes = [...new Set((liveCandidateIds || []).map(String))].filter(id => !planIds.has(id));
  if (newOnes.length) errors.push(`BASELINE_DRIFT: มีงาน NO_JV ใหม่ที่ไม่อยู่ใน plan ${newOnes.length} งาน (STOP — plan ต้องถูกทบทวน)`);
  const conflicts = jobs.filter(j => planStates.get(String(j.sourceId))?.state === PLAN_JOB_STATES.CONFLICT);
  for (const j of conflicts) {
    errors.push(`PLAN_JOB_CONFLICT ${j.expectedJobNo}: ${(planStates.get(String(j.sourceId))?.problems || []).join(", ")}`);
  }
  const counts = {
    verified: jobs.filter(j => planStates.get(String(j.sourceId))?.state === PLAN_JOB_STATES.VERIFIED_COMPLETE).length,
    pending: jobs.filter(j => planStates.get(String(j.sourceId))?.state === PLAN_JOB_STATES.PENDING_RECOVERY).length,
    conflict: conflicts.length
  };
  return { ok: errors.length === 0, errors, counts };
}

// ── readiness ของ recovery (owner decision + classifier evidence) ──
/**
 * ตัดสินว่างานนี้ "ให้ writer ทำงานได้ไหม" — ★ ไม่แก้ค่า readiness ของ S4.1b (อ่านอย่างเดียว)
 * @param {object} p
 * @param {object} p.classified - ผลจาก classifyServiceNoJvCandidate (มี journal/stock/readiness)
 * @param {object} p.planJob    - รายการใน plan ของงานเดียวกัน
 * @param {object} p.job        - service_jobs row ล่าสุด (live)
 * @param {Set<string>} p.lockedPeriods - "YYYY-MM" ของงวดที่ปิดแล้ว
 */
export function computeRecoveryReadiness({ classified, planJob, job, lockedPeriods = new Set() } = {}) {
  const blockers = [];
  if (!classified || !planJob) return { ok: false, blockers: ["PLAN_OR_CLASSIFICATION_MISSING"], docDate: null };

  // 0) ★ B1: row ปัจจุบันต้องตรงกับ snapshot ที่ owner อนุมัติ (durable ข้าม run)
  const snap = verifySourceSnapshot(job, planJob);
  if (!snap.ok) blockers.push(snap.reason);

  // 1) plan ต้องตรงกับข้อมูลจริง (กัน plan เก่า/งานถูกแก้ระหว่างทาง)
  if (String(planJob.expectedJobNo) !== String(job?.job_no ?? "")) blockers.push("PLAN_JOB_NO_MISMATCH");
  if (String(planJob.expectedStatus).toLowerCase() !== String(job?.status ?? "").toLowerCase()) blockers.push("PLAN_STATUS_MISMATCH");
  const amt = round2(job?.total_cost);
  if (Math.abs(round2(planJob.expectedAmount) - amt) >= 0.01) blockers.push("PLAN_AMOUNT_MISMATCH");
  if (!(amt >= 0.01)) blockers.push("AMOUNT_TOO_SMALL_OR_INVALID");

  // 2) หลักฐานฝั่งบัญชี — ต้องเป็น NO_APPROVED_JV เท่านั้น (มี JE ผูก source อยู่แล้ว = ห้ามแตะ)
  if (classified.journal.verdict !== "NO_APPROVED_JV") blockers.push(`JOURNAL_VERDICT_${classified.journal.verdict}`);
  // blocker ฝั่งบัญชีที่ยอมได้มีตัวเดียว: OWNER_RECOGNITION_DATE_REQUIRED (เพราะ plan เพิ่งเติมวันให้)
  for (const b of (classified.journal.blockers || [])) {
    if (b !== "OWNER_RECOGNITION_DATE_REQUIRED") blockers.push(`JOURNAL_BLOCKER_${b}`);
  }
  if (classified.journal.detail.mappingStatus !== "ACTIVE") blockers.push("CURRENT_MAPPING_MISSING");

  // 3) recognitionAt (owner) — ต้องมี timezone; docDate = Bangkok date เดียวกับ canonical writer
  const rec = validateRecognitionAt(planJob.recognitionAt);
  if (!rec.ok) blockers.push(rec.reason);
  const docDate = rec.ok ? rec.docDate : null;

  // 4) closed_at ปัจจุบัน — null (ยังไม่เขียน) หรือ "เท่ากับ plan เป๊ะ" (resume) เท่านั้น
  const currentClosedAt = job?.closed_at ?? null;
  let resumeState = "FRESH";
  if (currentClosedAt !== null && currentClosedAt !== undefined && String(currentClosedAt) !== "") {
    if (rec.ok && new Date(currentClosedAt).getTime() === new Date(rec.iso).getTime()) resumeState = "RESUME";
    else blockers.push("CLOSED_AT_CONFLICT");   // มีค่าอื่นอยู่แล้ว = ห้ามทับ
  }

  // 5) งวดบัญชีของวันรับรู้ต้องยังไม่ปิด
  if (docDate && lockedPeriods.has(docDate.slice(0, 7))) blockers.push("PERIOD_LOCKED");

  // 6) stock decision (owner) ต้องสอดคล้องกับหลักฐานของ classifier — plan เปลี่ยน verdict เงียบ ๆ ไม่ได้
  const sv = classified.stock.verdict;
  const sflags = classified.stock.flags || [];
  const sd = planJob.stockDecision;
  if (HARD_STOCK_BLOCKERS.has(sv)) {
    // ★ review fix (#6): conflict/ข้อมูลไม่ครบ = block เสมอ ไม่ว่า owner จะตัดสินมาอย่างไร
    blockers.push(`STOCK_HARD_CONFLICT_${sv}`);
  }
  if (APPLY_BLOCKING_STOCK_DECISIONS.has(sd)) {
    blockers.push(`STOCK_DECISION_${sd}`);
  } else if (sd === STOCK_DECISIONS.NOT_REQUIRED) {
    // รับได้เฉพาะกรณี classifier ยืนยันว่าไม่ต้องตัดสต็อกและไม่มี flag ค้าง
    if (!(sv === "STOCK_NOT_REQUIRED" && sflags.length === 0)) blockers.push("STOCK_DECISION_NOT_REQUIRED_CONTRADICTS_EVIDENCE");
  } else if (sd === STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE) {
    if (!String(planJob.stockEvidenceRef || "").trim()) blockers.push("STOCK_EVIDENCE_REF_REQUIRED");
    // ★ allowlist: ยืนยันแทนได้เฉพาะ verdict ที่ "นับของจริงแล้วสรุปได้" เท่านั้น
    if (!OWNER_VERIFIABLE_STOCK_VERDICTS.has(sv)) blockers.push(`STOCK_OWNER_VERIFY_NOT_ALLOWED_FOR_${sv}`);
  } else {
    blockers.push("STOCK_DECISION_INVALID");
  }

  return { ok: blockers.length === 0, blockers, docDate, resumeState, amount: amt };
}

// ── snapshot revalidation (★ review fix #2 + B1) ───────────
/**
 * เทียบ row ที่อ่านกลับมาหลัง CAS กับ (a) snapshot ตอน preflight ใน run นี้ (b) **hash ใน plan
 * ที่ owner อนุมัติ** (durable — กัน rerun ที่ "before ชุดใหม่" กลายเป็นค่าที่เปลี่ยนไปแล้ว) (c) closed_at
 * ไม่ตรงแม้แต่จุดเดียว = ห้ามเรียก writer
 */
export function revalidateJobSnapshot({ before, after, planJob, expectedClosedAtIso } = {}) {
  const diffs = [];
  if (!before || !after) return { ok: false, diffs: ["SNAPSHOT_MISSING"] };
  for (const f of SNAPSHOT_FIELDS) {
    const a = before[f] === null || before[f] === undefined ? null : String(before[f]);
    const b = after[f] === null || after[f] === undefined ? null : String(after[f]);
    if (f === "total_cost") {
      if (round2(before[f]) !== round2(after[f])) diffs.push("total_cost เปลี่ยนระหว่าง run");
      continue;
    }
    if (a !== b) diffs.push(`${f} เปลี่ยนระหว่าง run`);   // ★ ไม่ print ค่า note (อาจมี PII)
  }
  // ★ B1: row ที่จะส่งให้ writer ต้องตรงกับ snapshot ที่ owner อนุมัติใน plan (ข้าม run ได้)
  if (planJob) {
    const snap = verifySourceSnapshot(after, planJob);
    if (!snap.ok) diffs.push(snap.reason);
    if (String(planJob.expectedJobNo) !== String(after.job_no ?? "")) diffs.push("plan.expectedJobNo ไม่ตรง row");
    if (String(planJob.expectedStatus).toLowerCase() !== String(after.status ?? "").toLowerCase()) diffs.push("plan.expectedStatus ไม่ตรง row");
    if (round2(planJob.expectedAmount) !== round2(after.total_cost)) diffs.push("plan.expectedAmount ไม่ตรง row");
  }
  // closed_at ต้องเป็นค่าที่เราตั้งใจเขียน (หรือค่าเดิมกรณี resume) เป๊ะ
  if (expectedClosedAtIso) {
    const got = after.closed_at ? new Date(after.closed_at).getTime() : null;
    const want = new Date(expectedClosedAtIso).getTime();
    if (got !== want) diffs.push("closed_at ไม่ตรงวันที่ owner อนุมัติ");
  }
  return { ok: diffs.length === 0, diffs };
}

// ── plan-job state (★ review fix #1: partial resume) ───────
export const PLAN_JOB_STATES = { VERIFIED_COMPLETE: "VERIFIED_COMPLETE", PENDING_RECOVERY: "PENDING_RECOVERY", CONFLICT: "CONFLICT" };

/**
 * งานใน plan อยู่สถานะไหนตอนนี้ (ใช้ทั้ง preflight และ resume หลัง partial write)
 * - มี approved JV: read-back verify ครบ → VERIFIED_COMPLETE (ข้าม, ไม่เขียนซ้ำ) · ไม่ครบ → CONFLICT
 * - ไม่มี JE เลย → PENDING_RECOVERY
 * - มี JE non-approved / approved > 1 → CONFLICT
 */
export function classifyPlanJobState({ job, entries = [], linesByEntry = new Map(), planJob, expectedAccounts, expectedDocDate, expectedClosedAtIso } = {}) {
  // ★ B1: ทุกสถานะต้องผ่าน snapshot ก่อน — operational row ต้องยังตรงกับสภาพที่ owner อนุมัติ
  const snap = verifySourceSnapshot(job, planJob);
  if (!snap.ok) return { state: PLAN_JOB_STATES.CONFLICT, problems: [snap.reason], entryId: null };

  const bound = (entries || []).filter(e => e && e.source_table === "service_jobs" && String(e.source_id) === String(job?.id));
  const approved = bound.filter(e => String(e.status || "").toLowerCase() === "approved");
  const nonApproved = bound.filter(e => String(e.status || "").toLowerCase() !== "approved");
  if (approved.length === 0 && nonApproved.length === 0) {
    return { state: PLAN_JOB_STATES.PENDING_RECOVERY, problems: [], entryId: null };
  }
  if (approved.length === 0 && nonApproved.length > 0) {
    return { state: PLAN_JOB_STATES.CONFLICT, problems: ["SOURCE_BOUND_NON_APPROVED_JV"], entryId: null };
  }
  const v = verifyPostedJournal({
    entries: bound, linesByEntry,
    expectedDocDate, expectedAmount: planJob?.expectedAmount, expectedAccounts
  });
  const problems = [...v.problems];
  // ★ B1: งานที่ถือว่า "ซ่อมเสร็จแล้ว" ต้องมี closed_at = วันที่ owner อนุมัติเป๊ะ (ไม่ใช่ค่าอื่น/ว่าง)
  if (expectedClosedAtIso) {
    const got = job?.closed_at ? new Date(job.closed_at).getTime() : null;
    if (got !== new Date(expectedClosedAtIso).getTime()) problems.push("CLOSED_AT_NOT_OWNER_APPROVED");
  } else {
    problems.push("RECOGNITION_AT_INVALID");
  }
  return problems.length === 0
    ? { state: PLAN_JOB_STATES.VERIFIED_COMPLETE, problems: [], entryId: v.entryId }
    : { state: PLAN_JOB_STATES.CONFLICT, problems, entryId: v.entryId };
}

// ── read-back verification (หลัง writer ทำงาน) ─────────────
/**
 * ตรวจ JE ที่โพสต์แล้วว่า "ตรงตามที่อนุมัติจริง" — pure (ป้อน rows ที่ fetch มา)
 * ★ review fix (#3): เทียบบัญชีแบบ exact กับ mapping ของงานนี้ (expectedAccounts = {debit, credit})
 *   ไม่ใช้ union ของทุก mapping — JV ที่ลงบัญชีของงานประเภทอื่นต้องไม่ผ่าน
 * @param {object} p
 * @param {Array} p.entries - journal_entries ที่ source_table=service_jobs, source_id=job.id (ทุก status)
 * @param {Map}   p.linesByEntry - entry_id → lines[]
 * @param {string} p.expectedDocDate - Bangkok date (YYYY-MM-DD) จาก recognitionAt
 * @param {number} p.expectedAmount
 * @param {{debit:string, credit:string}} p.expectedAccounts - บัญชีที่ JV ของงานนี้ต้องใช้เป๊ะ
 */
export function verifyPostedJournal({ entries = [], linesByEntry = new Map(), expectedDocDate, expectedAmount, expectedAccounts = null } = {}) {
  const problems = [];
  const approved = entries.filter(e => String(e?.status || "").toLowerCase() === "approved");
  if (approved.length === 0) problems.push("JE_MISSING_AFTER_WRITE");
  if (approved.length > 1) problems.push("JE_DUPLICATE_AFTER_WRITE");
  const nonApproved = entries.filter(e => String(e?.status || "").toLowerCase() !== "approved");
  if (nonApproved.length > 0) problems.push("JE_NON_APPROVED_PRESENT");
  const je = approved[0] || null;
  if (je) {
    if (String(je.source_table) !== "service_jobs") problems.push("JE_SOURCE_TABLE_MISMATCH");
    if (String(je.doc_date || "") !== String(expectedDocDate || "")) problems.push(`JE_DOC_DATE_MISMATCH (คาด ${expectedDocDate} พบ ${je.doc_date})`);
    const dr = round2(je.total_debit), cr = round2(je.total_credit);
    if (dr !== cr) problems.push("JE_HEADER_NOT_BALANCED");
    if (Math.abs(dr - round2(expectedAmount)) >= 0.01) problems.push(`JE_AMOUNT_MISMATCH (คาด ${round2(expectedAmount)} พบ ${dr})`);
    const lines = linesByEntry.get(String(je.id)) || linesByEntry.get(je.id) || [];
    if (lines.length === 0) problems.push("JE_LINES_MISSING");
    else {
      const sumD = round2(lines.reduce((a, l) => a + (Number(l.debit) || 0), 0));
      const sumC = round2(lines.reduce((a, l) => a + (Number(l.credit) || 0), 0));
      if (sumD !== sumC) problems.push("JE_LINES_NOT_BALANCED");
      if (Math.abs(sumD - round2(expectedAmount)) >= 0.01) problems.push("JE_LINES_AMOUNT_MISMATCH");
      const exp = round2(expectedAmount);
      if (expectedAccounts?.debit && expectedAccounts?.credit) {
        // ★ exact: Dr ต้องเป็นบัญชีของ mapping งานนี้เต็มจำนวน · Cr ต้องเป็นบัญชีรายได้ของ mapping งานนี้เต็มจำนวน
        const drOnExpected = round2(lines.filter(l => String(l.account_code) === String(expectedAccounts.debit)).reduce((a, l) => a + (Number(l.debit) || 0), 0));
        const crOnExpected = round2(lines.filter(l => String(l.account_code) === String(expectedAccounts.credit)).reduce((a, l) => a + (Number(l.credit) || 0), 0));
        if (drOnExpected !== exp) problems.push(`JE_DEBIT_ACCOUNT_MISMATCH (คาด ${expectedAccounts.debit} เต็มจำนวน)`);
        if (crOnExpected !== exp) problems.push(`JE_CREDIT_ACCOUNT_MISMATCH (คาด ${expectedAccounts.credit} เต็มจำนวน)`);
        const allowed = new Set([String(expectedAccounts.debit), String(expectedAccounts.credit)]);
        for (const l of lines) {
          if (!allowed.has(String(l.account_code))) problems.push(`JE_UNEXPECTED_ACCOUNT (${l.account_code})`);
        }
      } else {
        problems.push("EXPECTED_ACCOUNTS_MISSING");   // ไม่มี mapping ให้เทียบ = verify ไม่ได้ (ห้ามผ่าน)
      }
    }
  }
  return { ok: problems.length === 0, problems, entryId: je?.id ?? null };
}

/**
 * plan skeleton จาก candidate ปัจจุบัน — ไม่มี PII (เก็บ **hash** ของ snapshot ไม่เก็บ note ดิบ)
 * @param {Array} rows - ผลจาก classifyServiceNoJvCandidate
 * @param {Array<string>} months
 * @param {Map<string,object>} jobById - service_jobs row (ใช้คำนวณ sourceSnapshotSha256)
 */
export function buildPlanSkeleton(rows, months, jobById = new Map()) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    approvedBy: "<owner name>",
    approvedAt: "<ISO-8601 พร้อม timezone เช่น 2026-07-13T10:00:00+07:00>",
    baseline: {
      months,
      candidateCount: rows.length,
      candidateAmount: round2(rows.reduce((a, r) => a + round2(r.journal.detail.opAmount), 0))
    },
    jobs: rows.map(r => ({
      sourceId: String(r.jobId),
      expectedJobNo: r.jobNo,
      expectedAmount: round2(r.journal.detail.opAmount),
      expectedStatus: r.status,
      // ★ hash ของ row ณ วันที่ออก skeleton — ถ้างานถูกแก้หลังจากนี้ plan จะ drift และถูก block
      sourceSnapshotSha256: jobById.get(String(r.jobId)) ? computeSourceSnapshotSha256(jobById.get(String(r.jobId))) : "",
      recognitionAt: "<ISO-8601 พร้อม timezone — วันที่งานเสร็จจริงที่ owner ยืนยัน>",
      stockDecision: r.stock.verdict === "STOCK_NOT_REQUIRED" && (r.stock.flags || []).length === 0
        ? STOCK_DECISIONS.NOT_REQUIRED
        : STOCK_DECISIONS.UNRESOLVED,
      stockEvidenceRef: "",
      _stockEvidence: { verdict: r.stock.verdict, flags: r.stock.flags, expectedQty: r.stock.expected?.expectedQty ?? 0 }
    }))
  };
}
