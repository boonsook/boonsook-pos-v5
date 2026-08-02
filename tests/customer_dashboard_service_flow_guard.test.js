// Phase 606-b2c — guard: customer dashboard (client side) flow-aware confirm + honest states.
//
// ทำไมต้องมี: หน้าลูกค้าเดิม (ก) อ่านงานจาก state.serviceJobs ซึ่งว่างเสมอสำหรับ customer role
// (RLS 505 deny) → โชว์ "ยังไม่มีงาน" หลอก, (ข) ยืนยันปิดงานด้วย _appXhrPatch filter id อย่างเดียว
// + gate จาก cached row + append note จาก cached value (ทับ STOCK_DEDUCTED_MARKER ได้) +
// optimistic local close, (ค) ไม่ flow-aware → v2 done → closed ข้าม recognition event.
// guard นี้ล็อกว่าโค้ดไม่ถอยกลับไปสภาพนั้น และ badge/ปุ่มใช้ helper ตัวเดียวกัน.
//
// ทดสอบสองชั้น: (1) behavior จริงของ pure helper ที่ import มา (2) source contract ของ render/handler.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { customerCanConfirmJob, customerJobStatusPresentation } from "../modules/customer_dashboard.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "modules/customer_dashboard.js"), "utf8");
// absence-check ต้องดูเฉพาะโค้ดจริง — คอมเมนต์ที่อธิบาย "ห้ามทำ X" ไม่ใช่การทำ X
// ตัดเฉพาะ // (ทั้งบรรทัดและท้ายบรรทัด โดยไม่แตะ https://) — ★ ห้ามตัด /* */ ในไฟล์นี้:
// template มี accept="image/*" ซึ่งจะถูกจับเป็นเปิด block comment แล้วกลืนโค้ดจริงหายทั้งก้อน
// (เคยทำ guard เขียวหลอกมาแล้ว). block comment ในไฟล์นี้มีแค่ eslint-disable = ไม่กระทบ assertion.
const stripComments = (s) => s.replace(/([^:"'`\\])\/\/.*$/gm, "$1").replace(/^[ \t]*\/\/.*$/gm, "");
const CODE = stripComments(SRC);

// ── extractors ─────────────────────────────────────────────────────────────────────
function sliceBetween(src, startNeedle, endNeedle, label) {
  const s = src.indexOf(startNeedle);
  assert.ok(s > 0, `ไม่พบจุดเริ่ม ${label}`);
  const e = src.indexOf(endNeedle, s);
  assert.ok(e > s, `ไม่พบจุดจบ ${label}`);
  return src.slice(s, e);
}
const ORDERS_TAB = sliceBetween(SRC, `} else if (_custTab === "orders") {`, `} else if (_custTab === "jobs") {`, "orders tab");
const ORDERS_CODE = stripComments(ORDERS_TAB);
const JOBS_TAB = sliceBetween(SRC, `} else if (_custTab === "jobs") {`, `} else if (_custTab === "points") {`, "jobs tab");
const CONFIRM = sliceBetween(SRC, `.cust-confirm-btn").forEach`, `// Category filter`, "confirm handler");
const CONFIRM_CODE = stripComments(CONFIRM);
const CLEAR = sliceBetween(SRC, "export function clearCustomerDashboardState()", "\n}", "clear state");

// ═══ C1–C6 · pure helper behavior (ของจริง ไม่ใช่ regex) ═══════════════════════════

test("C1: flow 1 — done/delivered ยืนยันได้ (v1 behavior เดิมต้องไม่เปลี่ยน)", () => {
  assert.equal(customerCanConfirmJob({ finance_flow_version: 1, status: "done" }), true);
  assert.equal(customerCanConfirmJob({ finance_flow_version: 1, status: "delivered" }), true);
  assert.equal(customerCanConfirmJob({ finance_flow_version: "1", status: "done" }), true, "string '1' = flow 1");
});

test("C2: flow 2 — delivered เท่านั้น, done ต้องถูกปฏิเสธ", () => {
  assert.equal(customerCanConfirmJob({ finance_flow_version: 2, status: "delivered" }), true);
  assert.equal(customerCanConfirmJob({ finance_flow_version: 2, status: "done" }), false,
    "v2 done → closed ข้าม recognition event = ห้ามยืนยัน");
  assert.equal(customerCanConfirmJob({ finance_flow_version: "2", status: "done" }), false);
});

test("C3: status อื่นยืนยันไม่ได้ทุก flow", () => {
  for (const flow of [1, 2]) {
    for (const status of ["pending", "progress", "in_progress", "closed", "cancelled", ""]) {
      assert.equal(customerCanConfirmJob({ finance_flow_version: flow, status }), false,
        `flow ${flow} + ${status} ต้องยืนยันไม่ได้`);
    }
  }
});

test("C4: unknown/null flow = fail closed", () => {
  for (const raw of [null, undefined, 0, 3, "x", "", {}, [], NaN]) {
    assert.equal(customerCanConfirmJob({ finance_flow_version: raw, status: "delivered" }), false,
      `flow=${JSON.stringify(raw)} ต้อง fail closed`);
  }
  assert.equal(customerCanConfirmJob(null), false);
  assert.equal(customerCanConfirmJob(undefined), false);
});

test("C5: presentation — v2 done ได้ข้อความรอส่งมอบ, unknown ได้ข้อความตรวจสอบไม่สำเร็จ", () => {
  const v2done = customerJobStatusPresentation({ finance_flow_version: 2, status: "done" });
  assert.equal(v2done.canConfirm, false);
  assert.equal(v2done.kind, "awaiting_delivery");
  assert.match(v2done.message, /รอเจ้าหน้าที่ส่งมอบ/);

  const unknown = customerJobStatusPresentation({ finance_flow_version: null, status: "delivered" });
  assert.equal(unknown.canConfirm, false);
  assert.equal(unknown.kind, "unknown");
  assert.match(unknown.message, /ตรวจสอบข้อมูล/);

  const ok = customerJobStatusPresentation({ finance_flow_version: 2, status: "delivered" });
  assert.equal(ok.canConfirm, true);
  assert.equal(ok.kind, "confirmable");
});

test("C6: presentation.canConfirm ตรงกับ customerCanConfirmJob เสมอ (ห้าม drift)", () => {
  for (const flow of [1, 2, 3, null, "1", "2", undefined]) {
    for (const status of ["pending", "progress", "done", "delivered", "closed", "cancelled"]) {
      const job = { finance_flow_version: flow, status };
      assert.equal(customerJobStatusPresentation(job).canConfirm, customerCanConfirmJob(job),
        `drift ที่ flow=${flow} status=${status}`);
    }
  }
});

// ═══ C7–C10 · flow parser reuse + badge/button parity ═════════════════════════════

test("C7: reuse canonical serviceFinanceFlowOf — ห้ามสร้าง parser คู่", () => {
  assert.match(SRC, /import \{ serviceFinanceFlowOf \} from "\.\/accounting\/auto_post\.js"/,
    "ต้อง import canonical parser");
  assert.match(CODE, /const flow = serviceFinanceFlowOf\(job\)/, "helper ต้องเรียก canonical parser");
  // ห้าม parse finance_flow_version เองนอก helper (Number()/parseInt/regex ของตัวเอง)
  assert.doesNotMatch(CODE, /Number\([^)]*finance_flow_version|parseInt\([^)]*finance_flow_version/,
    "ห้าม parse flow เอง");
});

test("C8: import จาก auto_post เฉพาะ parser — ห้ามดึง posting/accounting function", () => {
  const imp = SRC.match(/import \{([^}]*)\} from "\.\/accounting\/auto_post\.js"/);
  assert.ok(imp, "ไม่พบ import จาก auto_post");
  const names = imp[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(names, ["serviceFinanceFlowOf"], `import เกิน: ${names.join(",")}`);
  for (const bad of ["postJournalForServiceJob", "recordServicePayment", "voidJvForSource", "postJournalForSale"]) {
    assert.ok(!CODE.includes(bad), `หน้าลูกค้าห้ามเรียก ${bad}`);
  }
});

test("C9: badge (pendingConfirmCount) ใช้ helper เดียวกับปุ่ม", () => {
  assert.match(CODE, /pendingConfirmCount = myServiceJobs\.filter\(customerCanConfirmJob\)\.length/,
    "badge ต้องนับด้วย helper ตัวเดียวกัน");
  // ห้ามนับด้วย predicate ของตัวเอง
  assert.doesNotMatch(CODE, /pendingConfirmCount[^\n]*status === "done"/, "badge ห้ามใช้ predicate แยก");
});

test("C10: ปุ่มยืนยันตัดสินจาก presentation helper ไม่ใช่ status ดิบ", () => {
  assert.match(JOBS_TAB, /const presentation = customerJobStatusPresentation\(j\)/);
  assert.match(JOBS_TAB, /const canConfirm = presentation\.canConfirm/);
  assert.doesNotMatch(JOBS_TAB.replace(/^[ \t]*\/\/.*$/gm, ""),
    /canConfirm = j\.status === "done"/, "ห้ามกลับไปใช้ status ดิบ");
});

// ═══ C11–C15 · confirm mutation via proxy ═════════════════════════════════════════

test("C11: confirm ยิง POST proxy — ห้ามใช้ _appXhrPatch", () => {
  assert.match(CONFIRM, /fetch\("\/api\/v1\/customer-service-jobs"/, "ต้องยิงผ่าน proxy");
  assert.match(CONFIRM, /method: "POST"/);
  assert.ok(!CODE.includes("_appXhrPatch"), "ทั้งไฟล์ห้ามมี direct PATCH ของลูกค้าอีก");
  // การ INSERT ใบแจ้งงาน (สั่งงาน) ยังทำตรงได้ — RLS 505 อนุญาต INSERT (WITH CHECK true);
  // ที่ห้ามคือ "แก้" งานที่มีอยู่ (UPDATE/PATCH) ซึ่ง customer ไม่มีสิทธิ์และเป็นช่องของ proxy
  assert.doesNotMatch(CODE, /\.update\(\s*\{[^}]*\}\s*\)[\s\S]{0,80}service_jobs/, "ห้าม UPDATE service_jobs ตรง");
  assert.doesNotMatch(CODE, /service_jobs"\)[\s\S]{0,40}\.update\(/, "ห้าม UPDATE service_jobs ตรง");
  assert.doesNotMatch(CODE, /xhrPatch\(\s*"service_jobs"/, "ห้าม xhrPatch service_jobs ตรง");
});

test("C12: body ส่งเฉพาะ job_id — ไม่มี status/flow/note/phone", () => {
  const b = CONFIRM.match(/body: JSON\.stringify\(\{([^}]*)\}\)/);
  assert.ok(b, "ไม่พบ POST body");
  assert.match(b[1], /job_id: String\(jobId\)/);
  for (const bad of ["status", "note", "finance_flow_version", "phone", "customer_id", "created_by"]) {
    assert.ok(!b[1].includes(bad), `body ห้ามมี ${bad}`);
  }
});

test("C13: ห้าม optimistic local close — success ต้อง refetch จาก server", () => {
  assert.doesNotMatch(CONFIRM_CODE, /\.status = "closed"/, "ห้ามตั้ง local status = closed เอง");
  assert.doesNotMatch(CONFIRM_CODE, /currentJob/, "ห้ามแก้ row ใน local state");
  const okAt = CONFIRM.indexOf("ปิดงานเรียบร้อย");
  const refetchAt = CONFIRM.indexOf('_custJobsState = "idle"', okAt);
  assert.ok(okAt > 0 && refetchAt > okAt, "หลัง success ต้อง reset state → refetch");
});

test("C14: 409 → แจ้งสถานะเปลี่ยนแล้ว + refetch (ไม่แก้ local เอง)", () => {
  assert.match(CONFIRM, /resp\.status === 409/, "ต้องจัดการ 409 แยก");
  const at = CONFIRM.indexOf("resp.status === 409");
  const branch = CONFIRM.slice(at, at + 420);
  assert.match(branch, /_custJobsState = "idle"/, "409 ต้อง refetch");
  assert.match(branch, /สถานะงานเปลี่ยน/, "409 ต้องบอกผู้ใช้ว่าสถานะเปลี่ยน");
});

test("C15: มี inflight guard แยกสำหรับ confirm + ไม่เข้า offline queue", () => {
  assert.match(CODE, /_custConfirmGuard = createInflightGuard\(\)/, "ต้องมี guard แยกของ confirm");
  assert.match(CONFIRM, /_custConfirmGuard\.isInflight/, "ต้องกันกดซ้ำก่อนยิง");
  assert.match(CONFIRM, /_custConfirmGuard\.run\(/, "ต้องรันใน guard");
  for (const bad of ["queueOffline", "_offline_queue", "enqueue"]) {
    assert.ok(!CONFIRM.includes(bad), `confirm ห้ามเข้า offline queue (${bad})`);
  }
});

// ═══ C16–C21 · visibility source + honest states ══════════════════════════════════

test("C16: งานบริการโหลดจาก proxy ไม่ใช่ state.serviceJobs", () => {
  assert.match(CODE, /fetch\("\/api\/v1\/customer-service-jobs"/, "ต้องโหลดผ่าน proxy");
  assert.doesNotMatch(CODE, /state\.serviceJobs/, "ห้ามอ่าน state.serviceJobs (ว่างเสมอ = false empty)");
  assert.doesNotMatch(CODE, /state\.sales/, "ห้ามอ่าน state.sales สรุปข้อมูลลูกค้า");
  assert.match(CODE, /myServiceJobs = \(_custJobsState === "loaded"/, "list ต้องมาจาก proxy state");
});

test("C17: มี state machine ครบ idle/loading/loaded/error", () => {
  for (const s of ["idle", "loading", "loaded", "error"]) {
    assert.ok(CODE.includes(`_custJobsState = "${s}"`) || CODE.includes(`_custJobsState === "${s}"`),
      `ต้องมี state ${s}`);
  }
});

test("C18: error ต้องไม่กลายเป็น empty list + มีปุ่ม retry", () => {
  assert.match(JOBS_TAB, /_custJobsState === "error"/, "ต้องมี branch error แยก");
  const at = JOBS_TAB.indexOf('_custJobsState === "error"');
  const branch = JOBS_TAB.slice(at, at + 900);
  assert.match(branch, /โหลดงานบริการไม่สำเร็จ/, "error ต้องบอกว่าโหลดไม่สำเร็จ");
  assert.match(branch, /custJobsRetry/, "error ต้องมีปุ่ม retry");
  assert.doesNotMatch(branch, /ยังไม่มีงานบริการ/, "error ห้ามแสดงเป็น empty");
  assert.match(CODE, /getElementById\("custJobsRetry"\)\?\.addEventListener/, "ปุ่ม retry ต้องถูก bind");
});

test("C19: cache keyed ตาม authenticated identity + logout เคลียร์", () => {
  assert.match(CODE, /identityKey = .*state\.currentUser\?\.id/, "cache key ต้องผูก authenticated identity");
  assert.match(CODE, /_custJobsKey !== identityKey/, "สลับ account ต้อง refetch");
  for (const v of ["_custJobs = null", `_custJobsState = "idle"`, "_custJobsKey = null"]) {
    assert.ok(CLEAR.includes(v), `logout ต้องเคลียร์: ${v}`);
  }
});

test("C20: truncation ต้องแจ้ง ไม่ทำเหมือนโหลดครบ", () => {
  assert.match(CODE, /_custJobsTruncated = Boolean\(body\.truncated \|\| body\.has_more\)/);
  assert.match(JOBS_TAB, /_custJobsTruncated \?/, "ต้องแสดงคำเตือนเมื่อข้อมูลถูกตัด");
});

test("C21: orders tab = honest unavailable — ห้ามอ้างว่าไม่มีประวัติ / ห้ามใช้ proxy jobs", () => {
  assert.match(ORDERS_CODE, /ยังไม่พร้อมใช้งานในช่องทางลูกค้า/, "ต้องบอกว่ายังไม่พร้อมใช้งาน");
  assert.doesNotMatch(ORDERS_CODE, /ยังไม่มีประวัติ/, "ห้ามสรุปว่าไม่มีข้อมูล (RLS deny ≠ ไม่มี)");
  assert.doesNotMatch(ORDERS_CODE, /myServiceJobs|_custJobs/, "orders tab ห้าม consume proxy jobs");
  assert.doesNotMatch(ORDERS_CODE, /state\.serviceJobs|state\.sales/, "orders tab ห้ามอ่าน state โดยตรง");
  assert.ok(!CODE.includes("myOrders") && !CODE.includes("mySales"),
    "list เดิมที่อ่านจาก state ต้องถูกถอดออก ไม่ทิ้งไว้เป็น dead code");
});

// ═══ C22–C23 · note & scope invariants ════════════════════════════════════════════

test("C22: ไม่มี note stamp / ไม่แตะ note ใด ๆ จากหน้าลูกค้า", () => {
  assert.ok(!CODE.includes("ลูกค้ายืนยันปิดงาน "), "ห้าม stamp note (ทับ marker ได้)");
  assert.doesNotMatch(CONFIRM_CODE, /note/, "confirm handler ห้ามอ้าง note เลย");
  assert.doesNotMatch(CODE, /STOCK_DEDUCTED|newNote|existingNote/, "ห้ามประกอบ note ใหม่");
});

test("C23: หน้าลูกค้าไม่แตะ payment/JV/stock/flow activation", () => {
  for (const bad of ["record_service_payment", "journal_entries", "stock_movements",
    "warehouse_stock", "_svcFlow", "finance_flow_version: 2"]) {
    assert.ok(!CODE.includes(bad), `ห้ามอ้าง ${bad}`);
  }
});
