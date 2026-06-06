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
  serviceJobNoteWithReviewMarker,
  VALID_SERVICE_JOB_STATUSES,
  REVIEW_NOTE_MARKER,
} = await import("../modules/service_status.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const acSrc   = read("modules/ac_install.js");
const svSrc   = read("modules/service_form.js");
const solSrc  = read("modules/solar.js");
const mainSrc = read("main.js");

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

test("scope: helper ใหม่ไม่มี write call / fetch (pure)", () => {
  const src = read("modules/service_status.js");
  // จับเฉพาะ call form จริง (ไม่ใช่คำ POST ใน comment)
  assert.ok(!/fetch\(|xhrPost|xhrPatch|xhrPut|xhrDelete|\.rpc\(|\.upsert\(|\.insert\(/i.test(src),
    "service_status.js ต้อง pure (ไม่มี write/fetch call)");
});
