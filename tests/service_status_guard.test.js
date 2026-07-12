// Phase 383 — service-job-status-db-safe-hotfix
//
// Production bug (build 382): UI ส่ง status (pending_review / in_progress) ที่ DB constraint
// service_jobs_status_check ไม่รับ → POST service_jobs ล้ม HTTP 400 (23514) → ใบงานไม่ถูกสร้าง
// → หน้าใบรับงานไม่โชว์ + LINE notify ไม่ถูกเรียก.
//
// Fix: normalizeServiceJobStatus() map ค่าก่อนเขียน service_jobs ทุก path
// (ac_install/service_form/solar/main.saveServiceJob + reject flow). intent "รออนุมัติ"
// คงไว้ผ่าน note marker. ไม่แตะ SQL/schema/constraint/LINE/stock/accounting.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const {
  normalizeServiceJobStatus,
  normalizeServiceIntakeCreateStatus,
  serviceJobNoteWithReviewMarker,
  isServiceJobPendingReview,
  VALID_SERVICE_JOB_STATUSES,
  SERVICE_INTAKE_CREATE_STATUSES,
  REVIEW_NOTE_MARKER,
} = await import("../modules/service_status.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const acSrc   = read("modules/ac_install.js");
const svSrc   = read("modules/service_form.js");
const solSrc  = read("modules/solar.js");
const mainSrc = read("main.js");
const sjSrc   = read("modules/service_jobs.js");

// ── normalizeServiceJobStatus ───────────────────────────────────────────────
test("normalize: pending_review → pending", () => {
  assert.equal(normalizeServiceJobStatus("pending_review"), "pending");
});

test("normalize: in_progress → progress", () => {
  assert.equal(normalizeServiceJobStatus("in_progress"), "progress");
});

test("normalize: ค่า valid ทุกตัว → คงเดิม", () => {
  for (const s of VALID_SERVICE_JOB_STATUSES) {
    assert.equal(normalizeServiceJobStatus(s), s);
  }
});

test("normalize: unknown / null / empty / non-string → pending", () => {
  assert.equal(normalizeServiceJobStatus("weird_status"), "pending");
  assert.equal(normalizeServiceJobStatus(null), "pending");
  assert.equal(normalizeServiceJobStatus(undefined), "pending");
  assert.equal(normalizeServiceJobStatus(""), "pending");
  assert.equal(normalizeServiceJobStatus(123), "pending");
  assert.equal(normalizeServiceJobStatus({}), "pending");
});

test("normalize: trim ช่องว่าง", () => {
  assert.equal(normalizeServiceJobStatus("  pending_review  "), "pending");
  assert.equal(normalizeServiceJobStatus(" delivered "), "delivered");
});

test("normalize: ผลลัพธ์ต้องเป็นค่าที่ DB constraint รับเสมอ", () => {
  const inputs = ["pending_review", "in_progress", "", null, "garbage", "closed", "DONE"];
  for (const i of inputs) {
    assert.ok(VALID_SERVICE_JOB_STATUSES.includes(normalizeServiceJobStatus(i)),
      `normalize(${JSON.stringify(i)}) ต้องอยู่ใน VALID list`);
  }
});

// ── normalizeServiceIntakeCreateStatus (Phase 602 — กัน born-done) ──────────
test("intake: status ที่อนุญาต (pending/in_progress/pending_review) → คงเดิม", () => {
  for (const s of SERVICE_INTAKE_CREATE_STATUSES) {
    assert.equal(normalizeServiceIntakeCreateStatus(s), s);
  }
});

test("intake: progress (draft เก่า DB-safe) → in_progress", () => {
  assert.equal(normalizeServiceIntakeCreateStatus("progress"), "in_progress");
});

test("intake: completion (done/delivered/closed) → pending_review — ห้ามสร้างงานปิดจากฟอร์มรับงาน", () => {
  assert.equal(normalizeServiceIntakeCreateStatus("done"), "pending_review");
  assert.equal(normalizeServiceIntakeCreateStatus("delivered"), "pending_review");
  assert.equal(normalizeServiceIntakeCreateStatus("closed"), "pending_review");
});

test("intake: trim + lowercase ก่อนตัดสิน (กัน DOM injection แบบ ' DONE ')", () => {
  assert.equal(normalizeServiceIntakeCreateStatus(" DONE "), "pending_review");
  assert.equal(normalizeServiceIntakeCreateStatus("  Delivered"), "pending_review");
  assert.equal(normalizeServiceIntakeCreateStatus(" In_Progress "), "in_progress");
  assert.equal(normalizeServiceIntakeCreateStatus("  pending_review  "), "pending_review");
});

test("intake: null / empty / unknown / non-string → pending", () => {
  assert.equal(normalizeServiceIntakeCreateStatus(null), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus(undefined), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus(""), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus("garbage"), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus("cancelled"), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus(123), "pending");
  assert.equal(normalizeServiceIntakeCreateStatus({}), "pending");
});

test("intake: ผลลัพธ์ต้องไม่เป็น completion เลย และเขียน DB แล้วไม่ปิดงาน (invariant)", () => {
  const inputs = ["done", "delivered", "closed", " CLOSED ", "pending_review", "progress", "", null, "junk", {}, 7];
  for (const i of inputs) {
    const ui = normalizeServiceIntakeCreateStatus(i);
    assert.ok(SERVICE_INTAKE_CREATE_STATUSES.includes(ui),
      `intake(${JSON.stringify(i)}) → ${ui} ต้องอยู่ใน SERVICE_INTAKE_CREATE_STATUSES`);
    // ส่งต่อ normalizeServiceJobStatus (ค่าที่เขียน DB จริง) ต้องไม่เป็น completion
    const dbStatus = normalizeServiceJobStatus(ui);
    assert.ok(!["done", "delivered", "closed"].includes(dbStatus),
      `DB status จาก intake(${JSON.stringify(i)}) ต้องไม่ใช่ completion (ได้ ${dbStatus})`);
  }
});

test("intake: done ที่ถูก inject → DB pending + note มี review marker (ส่งให้แอดมินปิดจาก drawer)", () => {
  const ui = normalizeServiceIntakeCreateStatus("done");
  assert.equal(normalizeServiceJobStatus(ui), "pending");
  assert.equal(serviceJobNoteWithReviewMarker("งานล้างแอร์", ui), `งานล้างแอร์ ${REVIEW_NOTE_MARKER}`);
});

// ── serviceJobNoteWithReviewMarker ──────────────────────────────────────────
test("marker: pending_review → append marker", () => {
  assert.equal(serviceJobNoteWithReviewMarker("งานล้างแอร์", "pending_review"), `งานล้างแอร์ ${REVIEW_NOTE_MARKER}`);
});

test("marker: note ว่าง + pending_review → marker อย่างเดียว", () => {
  assert.equal(serviceJobNoteWithReviewMarker("", "pending_review"), REVIEW_NOTE_MARKER);
});

test("marker: status อื่น → note เดิม ไม่แตะ", () => {
  assert.equal(serviceJobNoteWithReviewMarker("xx", "pending"), "xx");
  assert.equal(serviceJobNoteWithReviewMarker("xx", "in_progress"), "xx");
  assert.equal(serviceJobNoteWithReviewMarker("xx", "delivered"), "xx");
});

test("marker: กัน duplicate (มี marker แล้วไม่ใส่ซ้ำ)", () => {
  const once = serviceJobNoteWithReviewMarker("งาน", "pending_review");
  assert.equal(serviceJobNoteWithReviewMarker(once, "pending_review"), once);
});

test("marker: non-string note → ไม่ throw", () => {
  assert.doesNotThrow(() => serviceJobNoteWithReviewMarker(null, "pending_review"));
  assert.equal(serviceJobNoteWithReviewMarker(null, "pending_review"), REVIEW_NOTE_MARKER);
});

// ── source guards: ทุก service_jobs write path normalize status ──────────────
for (const [name, src] of [["ac_install", acSrc], ["service_form", svSrc], ["solar", solSrc]]) {
  test(`${name}: import normalizeServiceJobStatus จาก service_status.js`, () => {
    assert.ok(/import\s*\{[^}]*normalizeServiceJobStatus[^}]*\}\s*from\s*["']\.\/service_status\.js["']/.test(src),
      `${name} ต้อง import normalizeServiceJobStatus`);
  });
  test(`${name}: record service_jobs ใช้ normalizeServiceJobStatus(selectedStatus)`, () => {
    assert.ok(/status:\s*normalizeServiceJobStatus\(selectedStatus\)/.test(src),
      `${name} record.status ต้อง normalize`);
  });
  test(`${name}: record.status ไม่ใช่ status: selectedStatus ดิบ (ยกเว้น JV/accounting path)`, () => {
    // เจาะ record object literal ที่มี job_no + items_json (= service_jobs insert) ต้องไม่มี raw selectedStatus
    const m = src.match(/const record = \{[\s\S]*?\n {6}\};/);
    assert.ok(m, `${name} ต้องหา record object ได้`);
    assert.ok(!/status:\s*selectedStatus\b/.test(m[0]),
      `${name} record (service_jobs) ต้องไม่มี status: selectedStatus ดิบ`);
  });
}

test("main.js: import + saveServiceJob payload normalize status", () => {
  assert.ok(/import\s*\{[^}]*normalizeServiceJobStatus[^}]*\}\s*from\s*["']\.\/modules\/service_status\.js["']/.test(mainSrc),
    "main.js ต้อง import normalizeServiceJobStatus");
  assert.ok(/status:\s*normalizeServiceJobStatus\(\$\("serviceStatus"\)\.value\)/.test(mainSrc),
    "saveServiceJob payload.status ต้อง normalize");
});

test("main.js: reject flow ไม่ตั้ง serviceStatus = 'in_progress' ดิบ (ใช้ progress)", () => {
  assert.ok(!/\$\("serviceStatus"\)\.value\s*=\s*["']in_progress["']/.test(mainSrc),
    "main.js ต้องไม่ตั้ง serviceStatus = 'in_progress' (DB ไม่รับ)");
  assert.ok(/\$\("serviceStatus"\)\.value\s*=\s*["']progress["']/.test(mainSrc),
    "reject flow ต้องใช้ 'progress'");
});

// ── isServiceJobPendingReview (read-side, Phase 383 review follow-up) ────────
test("isServiceJobPendingReview: legacy row status pending_review → true", () => {
  assert.equal(isServiceJobPendingReview({ status: "pending_review" }), true);
  assert.equal(isServiceJobPendingReview({ status: "pending_review", note: "" }), true);
});

test("isServiceJobPendingReview: pending + note marker → true (งานใหม่หลัง normalize)", () => {
  assert.equal(isServiceJobPendingReview({ status: "pending", note: `งานล้างแอร์ ${REVIEW_NOTE_MARKER}` }), true);
});

test("isServiceJobPendingReview: pending ไม่มี marker → false", () => {
  assert.equal(isServiceJobPendingReview({ status: "pending", note: "งานปกติ" }), false);
  assert.equal(isServiceJobPendingReview({ status: "pending" }), false);
});

test("isServiceJobPendingReview: status อื่น → false", () => {
  assert.equal(isServiceJobPendingReview({ status: "progress", note: REVIEW_NOTE_MARKER }), false);
  assert.equal(isServiceJobPendingReview({ status: "delivered" }), false);
  assert.equal(isServiceJobPendingReview(null), false);
  assert.equal(isServiceJobPendingReview(undefined), false);
});

test("integration: note ที่ผ่าน serviceJobNoteWithReviewMarker → อ่านกลับเป็น review (pending)", () => {
  const note = serviceJobNoteWithReviewMarker("งาน X", "pending_review");
  assert.equal(isServiceJobPendingReview({ status: "pending", note }), true);
});

// ── service_jobs.js read-side wiring ────────────────────────────────────────
test("service_jobs.js: import + ใช้ isServiceJobPendingReview ใน count/filter (ไม่ใช่ REVIEW_STATUSES ดิบ)", () => {
  assert.ok(/import\s*\{[^}]*isServiceJobPendingReview[^}]*\}\s*from\s*["']\.\/service_status\.js["']/.test(sjSrc),
    "ต้อง import isServiceJobPendingReview");
  // cReview + review filter ต้องใช้ helper
  assert.ok(/cReview\s*=\s*allJobs\.filter\(j\s*=>\s*isServiceJobPendingReview\(j\)\)/.test(sjSrc),
    "cReview ต้องใช้ isServiceJobPendingReview");
  assert.ok(/_sjFilter === "review"[\s\S]{0,80}isServiceJobPendingReview\(j\)/.test(sjSrc),
    "review filter ต้องใช้ isServiceJobPendingReview");
  // open ต้อง exclude review (กันนับซ้ำ)
  assert.ok(/OPEN_STATUSES\.includes\([^)]*\)\s*&&\s*!isServiceJobPendingReview\(j\)/.test(sjSrc),
    "open count/filter ต้อง exclude review (pending+marker ไม่ขึ้นทั้ง open และ review)");
  // ไม่เหลือ REVIEW_STATUSES (ลบทิ้งแล้ว)
  assert.ok(!/REVIEW_STATUSES/.test(sjSrc), "REVIEW_STATUSES เดิมต้องไม่เหลือ (แทนด้วย helper)");
});

test("service_jobs.js: status label/color ใช้ isReview → แสดง 'รออนุมัติ' สำหรับ pending+marker", () => {
  assert.ok(/const\s+isReview\s*=\s*isServiceJobPendingReview\(j\)/.test(sjSrc), "ต้องมี isReview per-row");
  assert.ok(/isReview\s*\?\s*STATUS_LABELS\.pending_review/.test(sjSrc), "label ต้องใช้ pending_review เมื่อ isReview");
  assert.ok(/isReview\s*\?\s*STATUS_COLOR\.pending_review/.test(sjSrc), "color ต้องใช้ pending_review เมื่อ isReview");
});

test("main.js: approve banner ใช้ isServiceJobPendingReview ไม่ใช่ status === 'pending_review' ดิบ", () => {
  assert.ok(/import\s*\{[^}]*isServiceJobPendingReview[^}]*\}\s*from\s*["']\.\/modules\/service_status\.js["']/.test(mainSrc),
    "main.js ต้อง import isServiceJobPendingReview");
  assert.ok(/approveBanner\.style\.display\s*=\s*isServiceJobPendingReview\(job\)/.test(mainSrc),
    "approve banner ต้องใช้ helper");
  assert.ok(!/approveBanner\.style\.display\s*=\s*job\?\.status === ["']pending_review["']/.test(mainSrc),
    "approve banner ต้องไม่ใช้ status === 'pending_review' ดิบ");
});

test("scope: helper ใหม่ไม่มี write call / fetch (pure)", () => {
  const src = read("modules/service_status.js");
  // จับเฉพาะ call form จริง (ไม่ใช่คำ POST ใน comment)
  assert.ok(!/fetch\(|xhrPost|xhrPatch|xhrPut|xhrDelete|\.rpc\(|\.upsert\(|\.insert\(/i.test(src),
    "service_status.js ต้อง pure (ไม่มี write/fetch call)");
});
