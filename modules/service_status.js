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
