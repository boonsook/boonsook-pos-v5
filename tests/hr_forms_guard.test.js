// Phase 420 — HR forms (รับสมัครงาน + ใบลาออก) guard (build 420)
// Run: node --test tests/hr_forms_guard.test.js
//
// Why this exists:
//   Phase 420 เพิ่ม 2 หน้าใหม่ admin-only (hr_applications / hr_resignations)
//   + ตารางใหม่ 2 ตาราง + upload รูปเข้า storage. guard นี้ล็อก invariant ตามสเปก owner:
//   (1) SQL: 2 ตาราง + RLS enable + policy admin-only (is_accountant) + NOTIFY + CHECK status
//       และ "ไม่แตะ profiles" (ไม่มี trigger/ALTER ไป profiles)
//   (2) hr_forms.js: ❌ ไม่มี alert()/native confirm — ใช้ window.App?.confirm
//   (3) ❌ ไม่มี PATCH/POST/DELETE ไปที่ profiles (อนุมัติลาออกไม่ตัดพนักงานอัตโนมัติ —
//       แอดมินไปปิดสถานะเองที่ ตั้งค่า → ผู้ใช้งาน) — fetch profiles = GET เท่านั้น
//   (4) upload ใช้ bucket proofs path applications/ (pattern expenses.js)
//   (5) อนุมัติใบลาออก: App.confirm ก่อน + เตือน "ปิดสถานะ" หลังอนุมัติ
//   (6) hired: บันทึก hired_date + เตือนสร้างบัญชีผู้ใช้เอง (❌ ไม่ auto-สร้าง user)
//   (7) logActivity ครบทุก action สำคัญ
//   (8) print builders escape ค่าผู้ใช้ (unit จริง — XSS ต้องไม่หลุด)
//   (9) wiring: LAZY_ROUTES + ALL_ROUTES (admin-only — role อื่นไม่มี) + nav/section

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const {
  filterApplications,
  formatDateDmTh,
  formatDateThaiLong,
  normalizeAttachments,
  buildBlankApplicationFormHtml,
  buildApplicationPrintHtml,
  buildResignationPrintHtml,
} = await import("../modules/hr_forms.js");

const src = fs.readFileSync(path.resolve("modules/hr_forms.js"), "utf8");
const sql = fs.readFileSync(path.resolve("supabase-phase420-hr-forms.sql"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");

// helper: extract block ระหว่าง marker เปิด → marker ถัดไป (กัน false positive จากส่วนอื่น)
function extractBetween(source, startMarker, endMarker) {
  const s = source.indexOf(startMarker);
  assert.ok(s >= 0, `source must contain "${startMarker}"`);
  const e = source.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `source must contain "${endMarker}" after "${startMarker}"`);
  return source.slice(s, e);
}

// ═══════════════════════════════════════════════════════════
//  1. SQL file — ตาราง + RLS + CHECK + NOTIFY + ไม่แตะ profiles
// ═══════════════════════════════════════════════════════════

test("SQL: CREATE TABLE ครบ 2 ตาราง (staff_applications + staff_resignations)", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_applications/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_resignations/);
  // คอลัมน์สำคัญตามสเปก
  assert.match(sql, /attachments\s+jsonb\s+NOT NULL DEFAULT '\[\]'/, "attachments jsonb default []");
  assert.match(sql, /applied_date\s+date\s+NOT NULL DEFAULT \(\(now\(\) AT TIME ZONE 'Asia\/Bangkok'\)\)::date/, "applied_date default = วันนี้ Bangkok");
  assert.match(sql, /employee_id\s+uuid\s+NOT NULL/, "resignations.employee_id uuid NOT NULL");
});

test("SQL: CHECK status ตามสเปกทั้ง 2 ตาราง", () => {
  assert.match(sql, /CHECK \(status IN \('new','interview','hired','rejected'\)\)/, "applications status check");
  assert.match(sql, /CHECK \(status IN \('submitted','approved'\)\)/, "resignations status check");
});

test("SQL: RLS enable + policy admin-only (is_accountant) ทั้ง 2 ตาราง + NOTIFY pgrst", () => {
  assert.match(sql, /ALTER TABLE public\.staff_applications ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.staff_resignations ENABLE ROW LEVEL SECURITY/);
  const appPolicy = extractBetween(sql, 'CREATE POLICY "applications_admin_all"', ";");
  const resigPolicy = extractBetween(sql, 'CREATE POLICY "resignations_admin_all"', ";");
  for (const [label, block] of [["applications", appPolicy], ["resignations", resigPolicy]]) {
    assert.match(block, /FOR ALL TO authenticated/, `${label} policy must be FOR ALL`);
    assert.match(block, /USING \(public\.is_accountant\(\)\)/, `${label} policy USING is_accountant`);
    assert.match(block, /WITH CHECK \(public\.is_accountant\(\)\)/, `${label} policy WITH CHECK is_accountant`);
  }
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});

test("SQL: ไม่แตะ profiles (ไม่มี ALTER/UPDATE/trigger ไปที่ profiles)", () => {
  assert.ok(!/ALTER TABLE (public\.)?profiles/i.test(sql), "must not ALTER profiles");
  assert.ok(!/UPDATE (public\.)?profiles/i.test(sql), "must not UPDATE profiles");
  assert.ok(!/ON (public\.)?profiles/i.test(sql), "must not attach trigger/policy on profiles");
});

// ═══════════════════════════════════════════════════════════
//  2. hr_forms.js — no alert / no native confirm
// ═══════════════════════════════════════════════════════════

test("hr_forms.js: ไม่มี alert() / native confirm() — ใช้ window.App?.confirm เท่านั้น", () => {
  assert.ok(!/\balert\s*\(/.test(src), "must not call alert()");
  // native confirm = confirm( ที่ไม่ได้นำหน้าด้วย . (เช่น window.App?.confirm?.( ผ่านได้)
  assert.ok(!/(?<![.\w])confirm\s*\(/.test(src), "must not call native confirm()");
  assert.ok(/window\.App\?\.confirm\?\./.test(src), "must use window.App?.confirm?. for confirmation");
});

// ═══════════════════════════════════════════════════════════
//  3. ห้ามเขียนไป profiles (กฎ "แอดมินปิดเอง")
// ═══════════════════════════════════════════════════════════

test("hr_forms.js: fetch profiles = GET read-only เท่านั้น (ไม่มี method ใด ๆ คู่ URL profiles)", () => {
  const occurrences = [...src.matchAll(/\/rest\/v1\/profiles/g)];
  assert.ok(occurrences.length >= 1, "must fetch profiles for employee dropdown");
  for (const m of occurrences) {
    // ตรวจ window รอบ URL — fetch options ของ call นี้ต้องไม่ประกาศ method (GET default)
    const windowText = src.slice(m.index, m.index + 300);
    assert.ok(!/method\s*:/.test(windowText), "profiles fetch must not declare any method (GET only)");
  }
});

test("hr_forms.js: PATCH/POST/DELETE ทุกตัวชี้ไป staff_applications/staff_resignations/storage เท่านั้น", () => {
  // ทุก fetch ที่มี method ต้องเป็นของ 2 ตารางใหม่ หรือ storage upload — ห้ามมี endpoint อื่น
  const writeCalls = [...src.matchAll(/fetch\(([^;]{0,200}?)\{\s*\n?\s*method/g)];
  assert.ok(writeCalls.length >= 5, "expected write calls (save/status/approve/delete/upload)");
  for (const m of writeCalls) {
    const urlPart = m[1];
    assert.ok(
      /staff_applications|staff_resignations|\/storage\/v1\/object\/proofs\//.test(urlPart),
      `write fetch must target new tables or proofs storage only — got: ${urlPart.slice(0, 120)}`
    );
  }
  assert.ok(!/profiles[^]{0,160}method\s*:/.test(src), "no write method near profiles URL");
});

// ═══════════════════════════════════════════════════════════
//  4. upload — bucket proofs path applications/ (pattern expenses.js)
// ═══════════════════════════════════════════════════════════

test("upload: ใช้ storage bucket proofs path applications/ + public URL + x-upsert", () => {
  const body = extractBetween(src, "async function _uploadAttachments", "async function _saveApplication");
  assert.match(body, /\/storage\/v1\/object\/proofs\/\$\{filePath\}/, "upload must POST to proofs bucket");
  assert.match(body, /applications\/\$\{ts\}_/, "file path must be under applications/");
  assert.match(body, /\/storage\/v1\/object\/public\/proofs\//, "stored url must be the public proofs URL");
  assert.match(body, /"x-upsert":\s*"true"/, "upload header x-upsert (pattern expenses.js)");
  assert.match(body, /_appUploadInflight/, "upload must have an inflight guard");
});

// ═══════════════════════════════════════════════════════════
//  5. อนุมัติใบลาออก — App.confirm + PATCH ตารางตัวเอง + เตือนปิดสถานะ
// ═══════════════════════════════════════════════════════════

test("อนุมัติ: App.confirm ก่อน + PATCH staff_resignations เท่านั้น + เตือน 'ปิดสถานะ' + ไม่แตะ profiles", () => {
  const body = extractBetween(src, "async function _approveResignation", "async function _deleteResignation");
  assert.match(body, /window\.App\?\.confirm\?\./, "approve must go through App.confirm");
  assert.match(body, /staff_resignations\?id=eq\./, "approve must PATCH staff_resignations by id");
  assert.match(body, /status:\s*"approved"/, "approve sets status=approved");
  assert.match(body, /approved_at/, "approve sets approved_at");
  assert.match(body, /approved_by/, "approve sets approved_by");
  assert.match(body, /ปิดสถานะ/, "post-approve warning must tell admin to close the user status");
  assert.match(body, /ตั้งค่า/, "warning must point to ตั้งค่า → ผู้ใช้งาน");
  assert.ok(!/profiles/.test(body), "approve flow must not touch profiles at all");
  assert.match(body, /logActivity\("hr_resignation_approve"/, "approve must be audit-logged");
});

test("banner เตือนค้างในแถว approved: พนักงานยังอยู่ active — ไปปิดสถานะเอง (DD/MM)", () => {
  const body = extractBetween(src, "export async function renderHrResignationsPage", "function _openResigModal");
  assert.match(body, /พนักงานยังอยู่ในรายชื่อ active/, "approved rows must show the standing reminder banner");
  assert.match(body, /formatDateDmTh\(r\.last_working_date\)/, "banner must show last working date (DD/MM)");
});

// ═══════════════════════════════════════════════════════════
//  6. hired — บันทึก hired_date + เตือนสร้างบัญชีผู้ใช้เอง (ไม่ auto-สร้าง)
// ═══════════════════════════════════════════════════════════

test("hired: เซ็ต hired_date วันนี้ + กล่องเตือนสร้างบัญชีผู้ใช้ — ❌ ไม่ auto-สร้าง user", () => {
  const body = extractBetween(src, "async function _changeAppStatus", "async function _deleteApplication");
  assert.match(body, /if \(newStatus === "hired"\) payload\.hired_date = todayBkk\(\)/, "hired must stamp hired_date = today (Bangkok)");
  assert.match(body, /อย่าลืมสร้างบัญชีผู้ใช้พนักงานใหม่ที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน/, "hired must warn admin to create the user account manually");
  assert.ok(!/auth\/v1\/admin|createUser|signUp/i.test(body), "must not auto-create any auth user");
  assert.match(body, /logActivity\("hr_application_status"/, "status change must be audit-logged");
});

// ═══════════════════════════════════════════════════════════
//  7. logActivity ครบทุก action สำคัญ
// ═══════════════════════════════════════════════════════════

test("logActivity ครบ: create/update/status/delete (applications) + create/approve/delete (resignations)", () => {
  for (const action of [
    '"hr_application_status"', '"hr_application_delete"',
    '"hr_resignation_create"', '"hr_resignation_approve"', '"hr_resignation_delete"',
  ]) {
    assert.ok(src.includes(`logActivity(${action}`), `logActivity(${action}) must exist`);
  }
  // create/update ใช้ ternary ใน _saveApplication
  assert.ok(src.includes('logActivity(existing ? "hr_application_update" : "hr_application_create"'),
    "save application must log create/update");
});

// ═══════════════════════════════════════════════════════════
//  8. print builders — unit จริง (escape ค่าผู้ใช้ / XSS ไม่หลุด)
// ═══════════════════════════════════════════════════════════

const XSS = `<img src=x onerror=alert(1)>`;

test("buildApplicationPrintHtml: escape ชื่อ/ตำแหน่ง/note + แสดงรายการเอกสารแนบ", () => {
  const html = buildApplicationPrintHtml({
    full_name: `สมชาย ${XSS}`,
    position: `ช่าง ${XSS}`,
    phone: "081-111-2222",
    applied_date: "2026-06-11",
    expected_salary: 12000,
    experience: `เคยทำงาน ${XSS}`,
    note: XSS,
    status: "new",
    attachments: [{ url: "https://x/y.jpg", label: `บัตร ${XSS}` }],
  }, { store: { name: `ร้าน ${XSS}` } });
  assert.ok(!html.includes(XSS), "raw XSS must not leak anywhere in the printed doc");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "user values must be HTML-escaped");
  assert.ok(html.includes("ใบสมัครงาน"), "doc title");
  assert.ok(html.includes("เอกสารแนบ (1 รายการ)"), "attachment list count");
  assert.ok(html.includes("12,000"), "expected salary formatted");
  assert.ok(html.includes("ลายเซ็นผู้สมัคร"), "signature row");
});

test("buildBlankApplicationFormHtml: ฟอร์มเปล่ามีช่องครบ + ที่ติดรูป + ลายเซ็น", () => {
  const html = buildBlankApplicationFormHtml({ name: "ร้านบุญสุข" });
  for (const label of ["ชื่อ-นามสกุล", "เบอร์โทรศัพท์", "ที่อยู่ปัจจุบัน", "ตำแหน่งที่สมัคร",
    "เงินเดือนที่คาดหวัง", "ประวัติการทำงาน / ประสบการณ์", "วันที่สมัคร",
    "ติดรูปถ่าย", "ลายเซ็นผู้สมัคร", "ผู้รับสมัคร"]) {
    assert.ok(html.includes(label), `blank form must contain "${label}"`);
  }
  assert.ok(html.includes("ร้านบุญสุข"), "store header");
});

test("buildResignationPrintHtml: escape ชื่อ/เหตุผล + ข้อความลาออก + ช่องลายเซ็น 2 ฝั่ง", () => {
  const html = buildResignationPrintHtml({
    submitted_date: "2026-06-11",
    last_working_date: "2026-07-15",
    reason: `ย้ายบ้าน ${XSS}`,
    note: XSS,
    status: "submitted",
  }, { emp: { full_name: `สมหญิง ${XSS}` }, store: { name: "ร้านบุญสุข" } });
  assert.ok(!html.includes(XSS), "raw XSS must not leak");
  assert.ok(html.includes("หนังสือขอลาออกจากการเป็นพนักงาน"), "formal title");
  assert.ok(html.includes("ขอลาออกจากการเป็นพนักงาน"), "standard resignation wording");
  assert.ok(html.includes("พนักงาน · วันที่"), "employee signature slot");
  assert.ok(html.includes("ผู้อนุมัติ"), "approver signature slot");
  assert.ok(html.includes("15 กรกฎาคม 2569"), "last working date in Thai (Buddhist year)");
});

// ═══════════════════════════════════════════════════════════
//  9. pure helpers — unit จริง
// ═══════════════════════════════════════════════════════════

test("filterApplications: กรองสถานะ + ค้น ชื่อ/เบอร์/ตำแหน่ง (case-insensitive)", () => {
  const rows = [
    { full_name: "สมชาย ใจดี", phone: "0811112222", position: "ช่างแอร์", status: "new" },
    { full_name: "สมหญิง สายลม", phone: "0899998888", position: "แคชเชียร์", status: "hired" },
    { full_name: "John Smith", phone: "021110000", position: "Sales", status: "interview" },
  ];
  assert.equal(filterApplications(rows, { status: "all" }).length, 3);
  assert.equal(filterApplications(rows, { status: "hired" })[0].full_name, "สมหญิง สายลม");
  assert.equal(filterApplications(rows, { search: "ช่างแอร์" }).length, 1, "search by position");
  assert.equal(filterApplications(rows, { search: "08999" }).length, 1, "search by phone");
  assert.equal(filterApplications(rows, { search: "john" }).length, 1, "search by name (ci)");
  assert.equal(filterApplications(rows, { status: "new", search: "สมหญิง" }).length, 0, "status+search combined");
  assert.deepEqual(filterApplications(null, {}), [], "null rows → []");
});

test("formatDateDmTh / formatDateThaiLong / normalizeAttachments", () => {
  assert.equal(formatDateDmTh("2026-07-15"), "15/07");
  assert.equal(formatDateDmTh(null), "-");
  assert.ok(formatDateThaiLong("2026-06-11").includes("มิถุนายน"), "Thai month name");
  assert.ok(formatDateThaiLong("2026-06-11").includes("2569"), "Buddhist year");
  assert.equal(formatDateThaiLong("garbage"), "-");
  // jsonb string จาก PostgREST + ตัด entry เสีย
  assert.deepEqual(
    normalizeAttachments('[{"url":"https://x/1.jpg","label":"บัตร"},{"nope":1},{"url":""}]'),
    [{ url: "https://x/1.jpg", label: "บัตร" }]
  );
  assert.deepEqual(normalizeAttachments(null), []);
  assert.equal(normalizeAttachments([{ url: "u" }])[0].label, "เอกสารแนบ", "missing label → default");
});

// ═══════════════════════════════════════════════════════════
//  10. wiring — LAZY_ROUTES + ALL_ROUTES admin-only + nav/section
// ═══════════════════════════════════════════════════════════

test("main.js: LAZY_ROUTES มี hr_applications + hr_resignations → modules/hr_forms.js", () => {
  const block = extractBetween(mainJs, "const LAZY_ROUTES = {", "};");
  assert.match(block, /hr_applications:\s*\["\.\/modules\/hr_forms\.js",\s*"renderHrApplicationsPage"\]/);
  assert.match(block, /hr_resignations:\s*\["\.\/modules\/hr_forms\.js",\s*"renderHrResignationsPage"\]/);
});

test("main.js: ALL_ROUTES มี 2 route ใหม่ และ role อื่น (technician/sales/customer) ไม่มี = admin-only", () => {
  const allRoutesLine = extractBetween(mainJs, "const ALL_ROUTES = [", "];");
  assert.ok(allRoutesLine.includes('"hr_applications"'), "ALL_ROUTES must include hr_applications");
  assert.ok(allRoutesLine.includes('"hr_resignations"'), "ALL_ROUTES must include hr_resignations");
  const rolePages = extractBetween(mainJs, "const ROLE_PAGES = {", "};");
  for (const role of ["technician", "sales", "customer"]) {
    const roleLine = extractBetween(rolePages, `${role}:`, "]");
    assert.ok(!roleLine.includes("hr_applications"), `${role} must not see hr_applications`);
    assert.ok(!roleLine.includes("hr_resignations"), `${role} must not see hr_resignations`);
  }
  // titles ครบ
  assert.ok(mainJs.includes('hr_applications:"รับสมัครงาน"'), "page title hr_applications");
  assert.ok(mainJs.includes('hr_resignations:"ใบลาออก"'), "page title hr_resignations");
});

test("index.html: nav-btn 2 ปุ่มในกลุ่ม บุคลากร/HR + section 2 หน้า", () => {
  assert.match(indexHtml, /<button class="nav-btn sub" data-route="hr_applications">📝 รับสมัครงาน<\/button>/);
  assert.match(indexHtml, /<button class="nav-btn sub" data-route="hr_resignations">📤 ใบลาออก<\/button>/);
  assert.match(indexHtml, /<section id="page-hr_applications" class="page hidden"><\/section>/);
  assert.match(indexHtml, /<section id="page-hr_resignations" class="page hidden"><\/section>/);
  // อยู่ในกลุ่ม hr (หลัง toggle บุคลากร / HR ก่อนปิดกลุ่ม)
  const hrGroup = extractBetween(indexHtml, 'data-group="hr"', "</div>\n      </div>");
  assert.ok(hrGroup.includes('data-route="hr_applications"'), "hr_applications must be inside the HR nav group");
  assert.ok(hrGroup.includes('data-route="hr_resignations"'), "hr_resignations must be inside the HR nav group");
});

// ═══════════════════════════════════════════════════════════
//  11. module read-only ต่อระบบเงิน/สต็อก
// ═══════════════════════════════════════════════════════════

test("hr_forms.js: ไม่แตะ POS/stock/accounting (checkout/addToCart/stock/journal)", () => {
  for (const bad of ["checkout(", "addToCart", "atomicDecrementStock", "atomicAddStock",
    "postJournal", "journal_entries", "warehouse_stock", "stock_movements"]) {
    assert.ok(!src.includes(bad), `hr_forms must not reference "${bad}"`);
  }
});
