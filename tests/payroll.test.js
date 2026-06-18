// Phase 92.43 — Unit tests for modules/payroll.js pure helpers + source-level wiring
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  computePayrollTotal,
  expenseDateForPaidPayroll,
  canDeletePayroll,
} = await import("../modules/payroll.js");

// ═══════════════════════════════════════════════════════════
//  B1 — computePayrollTotal (formula correctness)
// ═══════════════════════════════════════════════════════════

test("computePayrollTotal — formula: base + ot + welfare + bonus + commission - deductions", () => {
  const r = computePayrollTotal({
    base_salary: 10000,
    overtime: 500,
    welfare: 200,
    bonus: 1000,
    commission: 300,
    deductions: 400,
  });
  // 10000 + 500 + 200 + 1000 + 300 - 400 = 11600
  assert.equal(r, 11600);
});

test("computePayrollTotal — production scenario (5200 base + over-quota deduction 800 = 4400)", () => {
  // ตัวอย่างจาก hotfix 92.41b: daily rate 400 × workDays 13 = 5200, over quota 2 × 400 = 800 deduction
  const r = computePayrollTotal({ base_salary: 5200, deductions: 800 });
  assert.equal(r, 4400);
});

test("computePayrollTotal — round 2 decimals (money math safe)", () => {
  const r = computePayrollTotal({ base_salary: 100.555, overtime: 0.444 });
  // 100.555 + 0.444 = 100.999 → round2 = 101.00 (JS Math.round handles fine here)
  assert.equal(r, 101);
});

test("computePayrollTotal — missing/invalid fields treat as 0 (no NaN/NULL leak)", () => {
  assert.equal(computePayrollTotal({}), 0);
  assert.equal(computePayrollTotal({ base_salary: "5000" }), 5000, "string number ก็รับได้");
  assert.equal(computePayrollTotal({ base_salary: null, overtime: undefined }), 0);
  assert.equal(computePayrollTotal({ base_salary: "abc" }), 0);
  assert.equal(computePayrollTotal(null), 0);
  assert.equal(computePayrollTotal(undefined), 0);
});

test("computePayrollTotal — เกินหัก = ติดลบได้ (admin ตัดสินใจ — ไม่ clamp)", () => {
  const r = computePayrollTotal({ base_salary: 1000, deductions: 1500 });
  assert.equal(r, -500);
});

// ═══════════════════════════════════════════════════════════
//  B2 — expenseDateForPaidPayroll (Bangkok TZ)
// ═══════════════════════════════════════════════════════════

test("expenseDateForPaidPayroll — 03:00 Bangkok (= 20:00 UTC prev day) ต้องคืนวันไทย", () => {
  // 2026-05-27 03:00 Bangkok = 2026-05-26 20:00 UTC
  // OLD bug: paidAt.slice(0,10) = "2026-05-26" (UTC date) ❌
  // NEW: dateBkk → "2026-05-27" (Bangkok date) ✓
  const d = new Date("2026-05-26T20:00:00Z");
  assert.equal(expenseDateForPaidPayroll(d), "2026-05-27", "ตี 3 ไทย = 20:00 UTC วันก่อนหน้า → expense_date ต้องเป็นวันไทย");
});

test("expenseDateForPaidPayroll — 23:59 Bangkok (= 16:59 UTC same day) คืนวันไทยถูก", () => {
  const d = new Date("2026-05-27T16:59:00Z"); // 23:59 BKK
  assert.equal(expenseDateForPaidPayroll(d), "2026-05-27");
});

test("expenseDateForPaidPayroll — 00:01 Bangkok (= 17:01 UTC prev day) คืนวันใหม่ไทย", () => {
  const d = new Date("2026-05-26T17:01:00Z"); // 00:01 BKK 5/27
  assert.equal(expenseDateForPaidPayroll(d), "2026-05-27", "เที่ยงคืน 1 นาที ไทย = วันใหม่ของไทย");
});

test("expenseDateForPaidPayroll — accepts ISO string", () => {
  assert.equal(expenseDateForPaidPayroll("2026-05-26T20:00:00Z"), "2026-05-27");
});

test("expenseDateForPaidPayroll — no arg → today (BKK, format YYYY-MM-DD)", () => {
  const out = expenseDateForPaidPayroll();
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});

// ═══════════════════════════════════════════════════════════
//  B3 — canDeletePayroll (paid → requires reverse)
// ═══════════════════════════════════════════════════════════

test("canDeletePayroll — unpaid → allowed + no reverse needed", () => {
  const r = canDeletePayroll({ id: "x1", paid_at: null });
  assert.equal(r.allowed, true);
  assert.equal(r.requiresReverse, false);
  assert.equal(r.expenseTag, "#payroll-x1");
});

test("canDeletePayroll — paid → allowed + requiresReverse=true + expenseTag", () => {
  const r = canDeletePayroll({ id: "x2", paid_at: "2026-05-27T10:00:00Z" });
  assert.equal(r.allowed, true);
  assert.equal(r.requiresReverse, true);
  assert.equal(r.expenseTag, "#payroll-x2");
  assert.match(r.reason, /รายจ่ายที่เชื่อมอยู่/, "reason ต้องอธิบายชัดเจน");
});

test("canDeletePayroll — null/undefined/no id → not allowed", () => {
  assert.equal(canDeletePayroll(null).allowed, false);
  assert.equal(canDeletePayroll(undefined).allowed, false);
  assert.equal(canDeletePayroll({}).allowed, false);
  assert.equal(canDeletePayroll({ paid_at: "x" }).allowed, false, "no id → reject");
});

// ═══════════════════════════════════════════════════════════
//  Source-level wiring (Phase 92.43 B1-B4)
// ═══════════════════════════════════════════════════════════

test("source: _savePayroll ห้ามส่ง total_amount ใน payload (DB generated column — 428C9) + logActivity (B4)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  const body = src.match(/async function _savePayroll[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _savePayroll");
  // Phase 416 fix — กลับ invariant เดิมของ 92.43 B1 (justified deviation):
  // DB จริง staff_payroll.total_amount เป็น GENERATED column → Postgres ปฏิเสธ INSERT/UPDATE
  // ที่ส่งค่านี้ทั้งคำสั่ง (HTTP 400 428C9) — assumption เดิม "DB จะยอมรับค่าที่ส่ง" ผิด
  // ทำให้บันทึกเงินเดือนไม่เคยผ่านเลยตั้งแต่ 92.43
  assert.ok(!/payload\.total_amount\s*=/.test(body),
    "ห้าม set payload.total_amount — DB generated column จะ reject ทั้งคำสั่ง (428C9)");
  const payloadBlock = body.match(/const payload = \{[\s\S]*?\n {2}\};/)?.[0] || "";
  assert.ok(payloadBlock.length > 0, "ต้องเจอ payload object literal ใน _savePayroll");
  assert.ok(!/total_amount\s*:/.test(payloadBlock),
    "payload block ห้ามมี key total_amount: (DB generate เอง)");
  // ค่า total ที่ใช้หลัง save ต้องมาจาก response row (Prefer: return=representation) ไม่ใช่ payload
  assert.match(body, /return=representation/, "ต้องใช้ Prefer: return=representation เพื่ออ่าน total_amount จริงจาก DB");
  assert.match(body, /savedRow/, "ต้อง parse row จาก response (savedRow) มาใช้หลัง save");
  assert.match(body, /logActivity\([\s\S]{0,80}?["']payroll_(create|update|save)["']/, "ต้อง log activity (B4) — payroll_create/update/save");
  assert.match(body, /entityType:\s*["']staff_payroll["']/, "audit entityType=staff_payroll");
});

test("source: _markPaid expense_date ใช้ Bangkok helper (B2) + audit log", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  // _createSalaryExpense ต้องใช้ expenseDateForPaidPayroll (ไม่ใช่ paidAt.slice(0,10))
  const body = src.match(/async function _createSalaryExpense[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _createSalaryExpense");
  assert.match(body, /expense_date:\s*expenseDateForPaidPayroll\(/, "expense_date ต้องใช้ helper");
  // ห้ามมี pattern เดิม paidAt.slice(0, 10) ใน payload ของ expense (regression guard)
  assert.ok(!/expense_date:\s*paidAt\.slice\(0,\s*10\)/.test(body),
    "ห้ามใช้ paidAt.slice(0,10) — UTC slice = off-by-1 ตอน 00:00-06:59 ไทย");
  // _markPaid logActivity
  const markBody = src.match(/async function _markPaid[\s\S]*?^}/m)?.[0] || "";
  assert.match(markBody, /logActivity\(["']payroll_pay["']/, "ต้อง log payroll_pay (B4)");
  // idempotency guard
  assert.match(markBody, /payroll\?\.paid_at[\s\S]{0,200}?return/, "ต้องมี idempotency guard กดจ่ายซ้ำ");
});

test("source: _deletePayroll reverse expense ก่อน + audit log (B3 + B4)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  const body = src.match(/async function _deletePayroll[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _deletePayroll");
  assert.match(body, /canDeletePayroll\(/, "ต้องผ่าน canDeletePayroll guard");
  assert.match(body, /requiresReverse/, "ต้องเช็ค requiresReverse");
  // ★ Phase 489 (S-2): ย้อน expense แบบ exact-boundary — fetch candidates → filter → DELETE by id
  //   (เดิม blind DELETE by note=ilike substring → ลบ #payroll-{id} ไปโดน id อื่นที่ขึ้นต้นเหมือนกัน)
  assert.match(body, /expenses\?select=id,note&note=ilike\./, "ต้อง fetch candidates ของ expense by tag (GET)");
  assert.match(body, /payrollTagMatches\(r\.note, id\)/, "ต้องกรอง tag แบบมีขอบเขต (กัน prefix-collision)");
  assert.match(body, /expenses\?id=in\.\([\s\S]*?method:\s*["']DELETE["']/, "DELETE เฉพาะ id ที่ตรงจริง");
  assert.match(body, /logActivity\(["']payroll_delete["']/, "audit payroll_delete");
});

// ═══════════════════════════════════════════════════════════
//  B4 — Leave audit log + window.prompt replacement
// ═══════════════════════════════════════════════════════════

test("source: leave_management imports logActivity", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /import\s*\{[^}]*logActivity[^}]*\}\s*from\s*["']\.\/utils\.js["']/,
    "ต้อง import logActivity จาก utils.js");
});

test("source: _doReview ใช้ _askReviewNote (custom modal) แทน window.prompt", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/async function _doReview[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _doReview");
  assert.match(body, /_askReviewNote\(decisionLabel\)/, "ต้องใช้ _askReviewNote custom modal (iOS PWA safe)");
  // regression guard: ห้ามมี window.prompt ใน _doReview
  assert.ok(!/window\.prompt\(/.test(body), "_doReview ห้ามใช้ window.prompt (iOS PWA fail)");
  // audit log
  assert.match(body, /logActivity\(decision === ["']approved["'] \? ["']leave_approve["'] : ["']leave_reject["']/,
    "ต้อง log leave_approve|leave_reject");
});

test("source: _doCancel + _doDelete มี logActivity", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const cBody = src.match(/async function _doCancel[\s\S]*?^ {2}}/m)?.[0] || "";
  const dBody = src.match(/async function _doDelete[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.match(cBody, /logActivity\(["']leave_cancel["']/, "leave_cancel");
  assert.match(dBody, /logActivity\(["']leave_delete["']/, "leave_delete");
  // _doDelete ต้องเก็บ before snapshot ก่อน DELETE
  assert.match(dBody, /const before = _findLeave\(id\)/, "ต้องเก็บ snapshot ก่อนลบ (audit)");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.44 — Payroll Payment Journal Visibility
// ═══════════════════════════════════════════════════════════

test("source: auto_post.js exports postJournalForPayroll with staff_payroll source + PV doc", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  // export มีจริง
  assert.match(src, /export\s+async\s+function\s+postJournalForPayroll/, "ต้อง export postJournalForPayroll");
  const body = src.match(/export\s+async\s+function\s+postJournalForPayroll[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0);
  // source_table = "staff_payroll" + docType = "PV"
  assert.match(body, /sourceTable:\s*["']staff_payroll["']/, "source_table ต้องเป็น staff_payroll");
  assert.match(body, /docType:\s*["']PV["']/, "docType ต้องเป็น PV");
  // ใช้ payroll_salary mapping ที่มีอยู่
  assert.match(body, /mappings\[["']payroll_salary["']\]/, "ต้องใช้ payroll_salary mapping");
  // description format ตาม spec: "จ่ายเงินเดือน — {name} — {period}"
  assert.match(body, /จ่ายเงินเดือน — \$\{empName\}/, "description format ตาม spec");
  // override credit account ถ้า transfer
  assert.match(body, /transfer\|โอน\|bank/, "ต้อง override credit ถ้าโอน");
});

test("source: postJournalForPayroll ผ่าน _postJournal core (idempotent via unique index)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  const body = src.match(/export\s+async\s+function\s+postJournalForPayroll[\s\S]*?^}/m)?.[0] || "";
  assert.match(body, /return\s+_postJournal\(/, "ต้องเรียก _postJournal core (มี idempotency + period check + RLS handling อยู่แล้ว)");
  // unique index บน (source_table, source_id) อยู่ใน _postJournal — ไม่ต้องเช็คเอง
});

test("source: _markPaid ไม่ลง JV รายคนแล้ว (447a) — เงินเดือนลงบัญชีเป็น period aggregate ผ่านปุ่ม", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  const markPaid = src.match(/async function _markPaid[\s\S]*?^}/m)?.[0] || "";
  assert.ok(markPaid.length > 0);
  assert.ok(!/postJournalForPayroll\(/.test(markPaid),
    "447a: _markPaid ต้องไม่เรียก postJournalForPayroll รายคน (กันสำนักงานบัญชีเห็นเงินเดือนรายคน)");
  assert.match(markPaid, /_createSalaryExpense\(/, "_markPaid ยังลง expense (operational/HR detail)");
  // JV ก้อนเดียวต่อรอบ post ผ่าน handler ของปุ่ม "ลงบัญชีงวดนี้"
  const handler = src.match(/async function _postPayrollPeriodJV[\s\S]*?^}/m)?.[0] || "";
  assert.ok(handler.length > 0, "ต้องมี handler _postPayrollPeriodJV");
  assert.match(handler, /postPayrollPeriodJournal\(/, "handler เรียก postPayrollPeriodJournal (period aggregate)");
  assert.match(handler, /await import\(["']\.\/accounting\/auto_post\.js["']\)/, "lazy import auto_post.js");
});

test("source: _deletePayroll เรียก voidJvForSource('staff_payroll', id) ก่อน DELETE", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  const body = src.match(/async function _deletePayroll[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0);
  assert.match(body, /voidJvForSource\(["']staff_payroll["']/, "ต้อง void JV โดย staff_payroll source");
  // เก็บ reversedJournal count
  assert.match(body, /reversedJournal/, "ต้องเก็บ count ของ JV ที่ลบ (สำหรับ audit)");
  // audit log includes reversed_journal_count
  assert.match(body, /reversed_journal_count/, "audit metadata ต้องมี reversed_journal_count");
});

test("source: postJournalForPayroll สำหรับ payroll ที่ total_amount=0 → return null (no zero JV)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  const body = src.match(/export\s+async\s+function\s+postJournalForPayroll[\s\S]*?^}/m)?.[0] || "";
  // guard: amount < 0.01 → return null
  assert.match(body, /amount\s*<\s*0\.01[\s\S]{0,100}?return null/, "ต้อง guard zero amount");
  // guard: missing payroll.id หรือ total_amount → return null
  assert.match(body, /payroll\?\.id[\s\S]{0,100}?return null/, "ต้อง guard missing id");
});

test("source: postJournalForPayroll ใช้ dateBkk ไม่ใช่ UTC slice (B2 regression guard)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  const body = src.match(/export\s+async\s+function\s+postJournalForPayroll[\s\S]*?^}/m)?.[0] || "";
  assert.match(body, /docDate\s*=\s*dateBkk\(/, "ต้องใช้ dateBkk");
  assert.ok(!/docDate.*\.toISOString\(\)\.slice\(0,\s*10\)/.test(body), "ห้ามใช้ ISO slice (UTC bug)");
});

test("source: _askReviewNote modal มี OK + Cancel buttons + textarea", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _askReviewNote[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _askReviewNote");
  assert.match(body, /id="lmReviewNoteInput"/, "ต้องมี textarea input");
  assert.match(body, /id="lmReviewNoteOK"/, "ต้องมีปุ่ม OK");
  assert.match(body, /id="lmReviewNoteCancel"/, "ต้องมีปุ่ม Cancel");
  assert.match(body, /close\(null\)/, "cancel → close(null) ที่ resolve(null) ผ่าน wrapper");
  assert.match(body, /role="dialog"/, "a11y dialog role");
  assert.match(body, /aria-modal="true"/, "a11y aria-modal");
});

// Phase 491 (audit S-1) — paid payroll row = edit note only (no silent total/expense/JV divergence)
test("source: paid payroll row → PATCH note only + financial inputs locked", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  // _savePayroll: paid row PATCHes note only; unpaid PATCHes the full payload (unchanged)
  assert.match(src, /const patchBody = existing\.paid_at \? \{ note: payload\.note \} : payload;/,
    "paid row must PATCH note only (not the financial payload)");
  // _openPayrollModal: paid row disables the financial inputs + shows a locked banner
  assert.match(src, /if \(payroll\?\.paid_at\) \{[\s\S]{0,400}\.disabled = true/, "paid row disables financial inputs");
  assert.match(src, /จ่ายแล้ว — แก้ยอดไม่ได้/, "paid row shows a locked banner (delete+recreate to change)");
});
