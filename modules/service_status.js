// ═══════════════════════════════════════════════════════════
//  service_status.js — Phase 383: DB-safe service_jobs status
// ═══════════════════════════════════════════════════════════
//
// Production bug (build 382): UI ส่ง status ที่ DB constraint service_jobs_status_check
// ไม่รับ (pending_review / in_progress) → POST service_jobs ล้ม HTTP 400 (23514) →
// ใบงานไม่ถูกสร้าง → หน้าใบรับงานไม่โชว์ + LINE notify ไม่ถูกเรียก.
//
// DB constraint รับเฉพาะ: pending, progress, done, delivered, closed, cancelled
// helper นี้ normalize ค่าก่อนเขียน service_jobs (pure, ไม่แตะ schema/DB).

/** ค่าที่ DB service_jobs_status_check อนุญาต (ตรงกับ constraint จริงบน prod) */
export const VALID_SERVICE_JOB_STATUSES = [
  "pending", "progress", "done", "delivered", "closed", "cancelled",
];

/** UI status ที่ไม่ผ่าน constraint → map ไปค่าที่ถูกต้อง */
const STATUS_ALIASES = {
  pending_review: "pending",   // ช่างส่งรออนุมัติ → เก็บเป็น pending (intent ผ่าน note marker)
  in_progress:    "progress",
};

/**
 * Normalize status ให้เป็นค่าที่ DB service_jobs ยอมรับเสมอ
 * - valid → คงเดิม
 * - alias (pending_review/in_progress) → ค่าที่ map ไว้
 * - unknown / null / empty / non-string → "pending" (default ปลอดภัย)
 * @param {*} status
 * @returns {"pending"|"progress"|"done"|"delivered"|"closed"|"cancelled"}
 */
export function normalizeServiceJobStatus(status) {
  const s = typeof status === "string" ? status.trim() : "";
  if (VALID_SERVICE_JOB_STATUSES.includes(s)) return s;
  if (Object.prototype.hasOwnProperty.call(STATUS_ALIASES, s)) return STATUS_ALIASES[s];
  return "pending";
}

/** marker ที่ append ใน note เพื่อรักษา intent "ช่างส่งรออนุมัติ" หลัง normalize pending_review → pending */
export const REVIEW_NOTE_MARKER = "[รออนุมัติแอดมิน]";

/**
 * คง intent "รออนุมัติ" ไว้ใน note เมื่อ UI เลือก pending_review (ค่าที่ส่ง DB กลายเป็น pending)
 * - append marker เฉพาะตอน uiStatus === "pending_review"
 * - กัน duplicate (ถ้ามี marker อยู่แล้วไม่ใส่ซ้ำ)
 * - ไม่ throw / ไม่ทำให้ save ล้ม (note เป็น free-text)
 * @param {string} note - note เดิม (จาก textarea / computed string)
 * @param {string} uiStatus - ค่า status ดิบจาก UI ก่อน normalize
 * @returns {string}
 */
export function serviceJobNoteWithReviewMarker(note, uiStatus) {
  const base = typeof note === "string" ? note : "";
  if (uiStatus !== "pending_review") return base;
  if (base.includes(REVIEW_NOTE_MARKER)) return base;
  return base ? `${base} ${REVIEW_NOTE_MARKER}` : REVIEW_NOTE_MARKER;
}

// ═══════════════════════════════════════════════════════════
//  Phase 545: completion statuses + admin-only close-transition helpers
//  ปิดงาน (done/delivered/closed) ทริก auto-post JV + ตัดสต็อกจริง → admin เท่านั้น.
//  ด่านจริง = DB trigger trg_service_jobs_close_guard; helper นี้ใช้ทำ client guard (UX) + testable.
// ═══════════════════════════════════════════════════════════

/** สถานะ "ปิดงาน/ส่งมอบ" ที่ทริก JV + ตัดสต็อก (admin เท่านั้นที่ตั้งได้) */
export const SERVICE_COMPLETION_STATUSES = ["done", "delivered", "closed"];

/** status เป็นสถานะปิดงาน (completion) ไหม */
export function isServiceCompletionStatus(status) {
  const s = typeof status === "string" ? status.trim() : status;
  return SERVICE_COMPLETION_STATUSES.includes(s);
}

/**
 * เป็นการ "เพิ่งปิดงาน" (transition non-completion → completion) ไหม
 * — ตรงกับเงื่อนไขที่ทริก JV/stock; ใช้ block แบบ transition-only (ไม่ block แก้งานที่ปิดแล้ว)
 * @param {*} fromStatus - status เดิม (origStatus); งานใหม่ = undefined/"" → ถือว่า non-completion
 * @param {*} toStatus   - status ใหม่ (normalized payload.status)
 */
export function isServiceCloseTransition(fromStatus, toStatus) {
  return !isServiceCompletionStatus(fromStatus) && isServiceCompletionStatus(toStatus);
}

/**
 * Read-side: ใบงานนี้อยู่สถานะ "รออนุมัติ (ช่างส่ง)" ไหม
 * (Phase 383: เพราะ status ถูก normalize เป็น pending แล้ว read-side ต้องดู marker ด้วย)
 * - true ถ้า status === "pending_review" (รองรับ row เก่าก่อน hotfix)
 * - true ถ้า status === "pending" และ note มี REVIEW_NOTE_MARKER (งานใหม่หลัง normalize)
 * @param {{status?:string, note?:string}} job
 * @returns {boolean}
 */
export function isServiceJobPendingReview(job) {
  if (!job) return false;
  if (job.status === "pending_review") return true;
  return job.status === "pending" && typeof job.note === "string" && job.note.includes(REVIEW_NOTE_MARKER);
}

// ═══════════════════════════════════════════════════════════
//  Phase 602 (build 601): intake create forms ห้ามสร้างงาน "เกิดมาปิดแล้ว" (born-done)
//
//  ปัญหา: ฟอร์มรับงาน (service_form / ac_install / solar) ยังมี option "เสร็จแล้ว" (done)
//  แต่ closure side effects (closed_at + JV + ตัดสต็อก) ถูกย้ายไป admin drawer หมดแล้ว (88.15/545)
//  → เลือก done ตอนสร้าง = row status=done, closed_at=null, ไม่มี JV, ไม่ตัดสต็อก (รายได้หาย)
//  → non-admin ยิ่งหนัก: DB trigger trg_service_jobs_insert_close_guard (551) reject 42501 = save ล้ม
//
//  Policy: create path ของ intake form **ทุก role รวม admin** ต้องได้ non-completion status เสมอ
//  (ไม่ใช่ role-gate — ปิดงานต้องผ่าน drawer "ใบรับงาน" ที่มี close pipeline ครบเท่านั้น)
// ═══════════════════════════════════════════════════════════

/** UI status ที่ intake create form อนุญาต (non-completion ทั้งหมด) */
export const SERVICE_INTAKE_CREATE_STATUSES = ["pending", "in_progress", "pending_review"];

/**
 * Normalize status ที่ intake create form (service_form/ac_install/solar) จะส่งต่อ — กัน born-done
 * ใช้กับ **ทุก role** (admin ก็ห้ามสร้าง completion จากฟอร์มนี้) ไม่ใช่ helper ที่ gate ตาม role
 * - pending / in_progress / pending_review → คงเดิม
 * - progress → in_progress (draft เก่าเก็บค่า DB-safe ไว้)
 * - done / delivered / closed → pending_review (ส่งให้แอดมินปิดจาก drawer แทน)
 * - null / empty / unknown / non-string → pending
 * @param {*} status - ค่าดิบจาก select หรือ draft
 * @returns {"pending"|"in_progress"|"pending_review"}
 */
export function normalizeServiceIntakeCreateStatus(status) {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (SERVICE_INTAKE_CREATE_STATUSES.includes(s)) return s;
  if (s === "progress") return "in_progress";
  if (isServiceCompletionStatus(s)) return "pending_review";
  return "pending";
}
