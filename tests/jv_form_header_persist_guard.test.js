// Phase 584 — JV form header persist (accounting correctness · §4.3)
//
// Why: header (วันที่/ประเภท/คำอธิบาย) เดิมอยู่ใน DOM เท่านั้น — กด "+ เพิ่มบรรทัด"/ลบบรรทัด rebuild
// innerHTML ทั้งฟอร์ม → 3 ช่องกลับเป็น today/JV/ว่าง เงียบ; _save อ่านจาก DOM ที่ re-render ล่าสุด →
// JV โพสต์ด้วย "วันนี้" แม้ผู้ใช้ตั้ง period ก่อน (validateJournalDate ไม่ดัก) = โพสต์ผิด period เงียบ.
// แก้: header เป็น module state _header (mirror _lines) คงค่าข้าม re-render; _save อ่านจาก _header.
// Run: node --test tests/jv_form_header_persist_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/accounting/journal_form.js"), "utf8");
function fnBody(decl, ...stops) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const ends = stops.map(s => src.indexOf(s, start + decl.length)).filter(i => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const renderBody = fnBody("export async function renderJournalFormPage", "\n// ─── Save", "\nasync function _save");
const saveBody = fnBody("async function _save", "\nexport ", "\nfunction ");

test("(1) มี module state _header (doc_date/doc_type/desc)", () => {
  assert.match(src, /let _header = \{ doc_date: "", doc_type: "JV", desc: "" \};/, "_header ต้องเป็น module state");
});

test("(2) _save อ่านจาก _header — ไม่มี getElementById(jvDocDate/jvDocType/jvDesc) ใน _save", () => {
  assert.ok(!/getElementById\("jvDocDate"\)/.test(saveBody), "_save ต้องไม่อ่าน DOM jvDocDate (timing bug)");
  assert.ok(!/getElementById\("jvDocType"\)/.test(saveBody), "_save ต้องไม่อ่าน DOM jvDocType");
  assert.ok(!/getElementById\("jvDesc"\)/.test(saveBody), "_save ต้องไม่อ่าน DOM jvDesc");
  assert.match(saveBody, /const docDate = _header\.doc_date/, "docDate จาก _header");
  assert.match(saveBody, /const docType = _header\.doc_type/, "docType จาก _header");
  assert.match(saveBody, /const desc\s*=\s*\(_header\.desc \|\| ""\)\.trim\(\)/, "desc จาก _header");
});

test("(3) template date value ผูก _header.doc_date (ไม่ใช่ ${today} ดิบ)", () => {
  assert.match(src, /id="jvDocDate" value="\$\{escAttr\(_header\.doc_date\)\}"/, "date value ต้องมาจาก _header");
  assert.ok(!/id="jvDocDate" value="\$\{today\}"/.test(src), "ต้องไม่ hardcode value=${today} อีก");
});

test("(4) doc_type option ใส่ selected จาก _header.doc_type + desc มี value", () => {
  assert.match(src, /k === _header\.doc_type \? " selected" : ""/, "option ต้อง selected ตาม _header.doc_type");
  assert.match(src, /id="jvDesc" value="\$\{escAttr\(_header\.desc\)\}"/, "desc input ต้องมี value จาก _header");
});

test("(5) renderJournalFormPage init _header เฉพาะ guard (!_header.doc_date) — ไม่มี re-init วันที่แบบไม่มีเงื่อนไข", () => {
  assert.match(renderBody, /if \(!_header\.doc_date\) _header\.doc_date = today;/, "init วันที่ต้องมี guard");
  const setToday = renderBody.match(/_header\.doc_date = today/g) || [];
  assert.equal(setToday.length, 1, "ต้อง set _header.doc_date = today เพียงจุดเดียว (init guard) — ไม่ re-init ทุก render");
});

test("(6) reset _header คู่กับ _lines: cancel + post-save (2 จุด, ใน handler ไม่ใช่ top-level render)", () => {
  const resets = src.match(/(?<!let )_header = \{ doc_date: "", doc_type: "JV", desc: "" \};/g) || [];
  assert.equal(resets.length, 2, "reset _header ต้องมี 2 จุด (cancel + post-save success) — ไม่ reset ทุก re-render");
});
