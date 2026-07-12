// Phase 602 (build 601) — S4.1a: intake forms ห้ามสร้างงาน "เกิดมาปิดแล้ว" (born-done)
//
// Defect (S4.0 audit): ฟอร์มรับงาน service_form / ac_install / solar ยังมี option "เสร็จแล้ว" (done)
// แต่ closure side effects (closed_at + JV + ตัดสต็อก) ถูกย้ายไป admin drawer ตั้งแต่ 88.15/545
// (COMPLETION_STATUSES = [] → isClosure=false ตลอด) →
//   - admin เลือก done → INSERT ผ่าน แต่ได้ row status=done, closed_at=null, ไม่มี JV, ไม่ตัดสต็อก (รายได้หาย)
//   - non-admin เลือก done → DB trigger trg_service_jobs_insert_close_guard (Phase 551) reject 42501 = save ล้ม
//
// Prevention (ทุก role รวม admin — ไม่ใช่ role-conditional):
//   dropdown เหลือเฉพาะ non-completion + normalizeServiceIntakeCreateStatus() คุมทั้ง draft restore และ submit
//   → ปิดงานต้องผ่าน drawer "ใบรับงาน" (close pipeline ครบ) เท่านั้น
//
// Run: node --test tests/service_borndone_prevention_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");

const FORMS = [
  { name: "service_form", src: read("modules/service_form.js"), selectId: "svStatusSel" },
  { name: "ac_install",   src: read("modules/ac_install.js"),   selectId: "acStatusSel" },
  { name: "solar",        src: read("modules/solar.js"),        selectId: "solStatusSel" },
];

/** ตัดเฉพาะบล็อก <select id=...> ... </select> (ไม่ grep ทั้งไฟล์ กัน false-positive) */
function selectBlock(src, selectId) {
  const start = src.indexOf(`<select id="${selectId}"`);
  assert.ok(start >= 0, `ต้องหา <select id="${selectId}"> ได้`);
  const end = src.indexOf("</select>", start);
  assert.ok(end > start, `<select id="${selectId}"> ต้องปิดด้วย </select>`);
  return src.slice(start, end);
}

/** ตัด panel ที่ครอบ dropdown สถานะ (หัวข้อ + คำอธิบาย + select) — Phase 602 copy guard */
function statusPanel(src, selectId) {
  const selIdx = src.indexOf(`<select id="${selectId}"`);
  assert.ok(selIdx >= 0, `ต้องหา <select id="${selectId}"> ได้`);
  const panelStart = src.lastIndexOf('<div class="panel"', selIdx);
  assert.ok(panelStart >= 0, `ต้องหา panel ที่ครอบ #${selectId} ได้`);
  const end = src.indexOf("</select>", selIdx);
  return src.slice(panelStart, end);
}

/** ตัดเฉพาะ record object literal ที่ POST เข้า service_jobs */
function recordBlock(src, name) {
  const m = src.match(/const record = \{[\s\S]*?\n {6}\};/);
  assert.ok(m, `${name} ต้องหา const record = {...} ได้`);
  return m[0];
}

for (const { name, src, selectId } of FORMS) {
  test(`${name}: dropdown สถานะไม่มี completion option (done/delivered/closed)`, () => {
    const block = selectBlock(src, selectId);
    assert.doesNotMatch(block, /value="done"/, `${name}: ห้ามมี option done`);
    assert.doesNotMatch(block, /value="delivered"/, `${name}: ห้ามมี option delivered`);
    assert.doesNotMatch(block, /value="closed"/, `${name}: ห้ามมี option closed`);
    // ต้องยังมีสถานะที่อนุญาตครบ
    assert.match(block, /value="pending"/, `${name}: ต้องมี option pending`);
    assert.match(block, /value="in_progress"/, `${name}: ต้องมี option in_progress`);
    assert.match(block, /value="pending_review"/, `${name}: ต้องมี option pending_review`);
  });

  test(`${name}: import + ใช้ normalizeServiceIntakeCreateStatus ตอนอ่านค่าจาก select`, () => {
    assert.match(src, /import\s*\{[^}]*normalizeServiceIntakeCreateStatus[^}]*\}\s*from\s*["']\.\/service_status\.js["']/,
      `${name} ต้อง import normalizeServiceIntakeCreateStatus`);
    assert.match(src, new RegExp(`const selectedStatus = normalizeServiceIntakeCreateStatus\\(container\\.querySelector\\("#${selectId}"\\)\\?\\.value\\)`),
      `${name}: selectedStatus ต้อง normalize ตั้งแต่อ่านค่าจาก DOM (กัน DevTools inject done)`);
    assert.doesNotMatch(src, new RegExp(`const selectedStatus = container\\.querySelector\\("#${selectId}"\\)`),
      `${name}: ห้ามอ่าน select.value ดิบเข้า selectedStatus`);
  });

  test(`${name}: record ที่ POST service_jobs — status normalize + ไม่มี closed_at`, () => {
    const rec = recordBlock(src, name);
    assert.match(rec, /status:\s*normalizeServiceJobStatus\(selectedStatus\)/,
      `${name}: record.status ต้องผ่าน normalizeServiceJobStatus(selectedStatus)`);
    assert.doesNotMatch(rec, /closed_at/,
      `${name}: record ตอนสร้างต้องไม่ stamp closed_at (ปิดงานผ่าน drawer เท่านั้น)`);
    assert.doesNotMatch(rec, /status:\s*selectedStatus\b/,
      `${name}: ห้ามส่ง selectedStatus ดิบเป็น status`);
  });

  test(`${name}: note marker ใช้ selectedStatus ที่ normalize แล้ว (ตัวเดียวกับ status)`, () => {
    assert.match(src, /note:\s*serviceJobNoteWithReviewMarker\([\s\S]{0,160}?,\s*selectedStatus\)/,
      `${name}: note ต้องใช้ serviceJobNoteWithReviewMarker(..., selectedStatus)`);
  });

  test(`${name}: ไม่มี dead closure code (COMPLETION_STATUSES/isClosure) และไม่โพสต์ JV เอง`, () => {
    assert.doesNotMatch(src, /COMPLETION_STATUSES\s*=\s*\[/, `${name}: COMPLETION_STATUSES ต้องถูกลบ`);
    assert.doesNotMatch(src, /const isClosure\s*=/, `${name}: isClosure ต้องถูกลบ`);
    assert.doesNotMatch(src, /postJournalForServiceJob/,
      `${name}: intake form ต้องไม่ import/เรียก postJournalForServiceJob — JV เกิดที่ admin drawer ตอนปิดงาน`);
  });

  test(`${name}: draft restore normalize status ก่อน applyDraftFields`, () => {
    const applyIdx = src.indexOf("applyDraftFields(");
    assert.ok(applyIdx > 0, `${name} ต้องมี applyDraftFields`);
    const before = src.slice(0, applyIdx);
    assert.match(before, /draft\.fields\.status = normalizeServiceIntakeCreateStatus\(draft\.fields\.status\)/,
      `${name}: ต้อง normalize draft.fields.status ก่อน applyDraftFields (draft เก่า status=done → pending_review)`);
    const loadIdx = before.lastIndexOf("loadServiceDraft(");
    const normIdx = before.lastIndexOf("normalizeServiceIntakeCreateStatus(draft.fields.status)");
    assert.ok(loadIdx >= 0 && normIdx > loadIdx,
      `${name}: normalize ต้องอยู่หลัง loadServiceDraft และก่อน applyDraftFields`);
  });

  test(`${name}: panel copy = intake (ส่งงานให้แอดมินตรวจ) ไม่ใช่ "ปิดงาน"`, () => {
    const panel = statusPanel(src, selectId);
    // หัว panel + คำอธิบายเดียวที่ถูกต้อง
    assert.match(panel, /📨 ส่งงานให้แอดมินตรวจ \/ แนบสลิป/,
      `${name}: หัว panel ต้องเป็น "📨 ส่งงานให้แอดมินตรวจ / แนบสลิป"`);
    assert.match(panel, /ช่างเลือก[\s\S]{0,60}รออนุมัติ[\s\S]{0,120}แอดมินเปิดงานจาก drawer ใบรับงานแล้วปิดงาน ระบบจึงลงรายได้และตัดสต็อก/,
      `${name}: ต้องมีคำอธิบายเดียว — ช่างเลือกรออนุมัติ → แอดมินปิดจาก drawer แล้วระบบลงรายได้/ตัดสต็อก`);
    // ข้อความ stale ที่ห้ามเหลือ (ชวนให้เข้าใจว่าฟอร์มปิดงาน/ลงบัญชีเองได้)
    assert.doesNotMatch(panel, /🔚 ปิดงาน \(กรณีงานเสร็จ/,
      `${name}: หัว panel เก่า "🔚 ปิดงาน (กรณีงานเสร็จ + รับเงินแล้ว)" ต้องไม่เหลือ`);
    assert.doesNotMatch(panel, /แอดมิน — เลือก/,
      `${name}: ข้อความ "แอดมิน — เลือก ส่งมอบแล้ว/ปิดงาน" ต้องไม่เหลือ (แอดมินเลือกจากฟอร์มนี้ไม่ได้แล้ว)`);
    assert.doesNotMatch(panel, /ส่งมอบแล้ว|ระบบลงรายได้อัตโนมัติ/,
      `${name}: panel ต้องไม่ชวนเลือก "ส่งมอบแล้ว" / อ้างว่าลงรายได้อัตโนมัติจากฟอร์มนี้`);
    assert.doesNotMatch(panel, /JV เกิดทันที/,
      `${name}: คอมเมนต์ "JV เกิดทันที" ต้องไม่เหลือ (JV เกิดตอนแอดมินปิดงาน)`);
    assert.doesNotMatch(src, /admin only ใน drawer ใบรับงาน/,
      `${name}: คอมเมนต์ 88.15 เดิม (สื่อว่า admin เลือก delivered/closed ได้) ต้องถูกแทนที่`);
  });

  test(`${name}: header comment ไม่บอกว่าฟอร์มโพสต์ JV / ปิดงานเอง`, () => {
    const header = src.slice(0, src.indexOf("import "));
    assert.doesNotMatch(header, /auto-post JV หลัง save/,
      `${name}: header ต้องไม่บอกว่า auto-post JV หลัง save (ย้ายไป drawer แล้ว)`);
    assert.doesNotMatch(header, /\+ ?ปิดงาน\//,
      `${name}: header ต้องไม่เรียก intake panel ว่า "ปิดงาน"`);
  });
}

test("service_status.js: helper คุม intake create — pure, ไม่ gate ตาม role", () => {
  const src = read("modules/service_status.js");
  assert.match(src, /export const SERVICE_INTAKE_CREATE_STATUSES = \["pending", "in_progress", "pending_review"\]/);
  assert.match(src, /export function normalizeServiceIntakeCreateStatus\(status\)/);
  // ห้าม gate ตาม role (นโยบายเดียวกันทุก role รวม admin)
  const fn = src.slice(src.indexOf("export function normalizeServiceIntakeCreateStatus"));
  assert.doesNotMatch(fn, /isAdmin|requireAdmin|role/i,
    "normalizeServiceIntakeCreateStatus ต้องไม่ผูกกับ role — intake form ห้ามสร้าง completion ทุก role");
});
