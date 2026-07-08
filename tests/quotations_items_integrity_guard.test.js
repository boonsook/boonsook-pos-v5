// Phase 576 — Quotations items integrity guard
// invariant: (1) โหลด quotation_items ใบเดิมล้ม → ห้ามเงียบ — ต้องมี flag/toast ทุก catch
//            (2) saveQuotationFull edit path: _lineItemsLoadFailed → บล็อกก่อนถึง xhrDelete
//                (กัน scenario: โหลดล้ม → ฟอร์มว่าง → user กดบันทึก → DELETE รายการทั้งใบ + toast สำเร็จ)
//            (3) xhrDelete เช็คผล (throw ก่อนถึง insert loop) + insert loop เก็บ failedItems แบบ Phase 412
//                — มี fail ห้าม toast สำเร็จ
//            (4) openPreview / convertToDeliveryInvoice: โหลดล้ม → ยกเลิกการเปิด/แปลง (เอกสาร 0 รายการห้ามเกิด)
//
// Source-regex (iron rule #5: extract body ของฟังก์ชันเป้าหมายก่อน — ห้าม grep ทั้งไฟล์)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "modules/quotations.js"), "utf8");

// ดึง source ของ 1 ฟังก์ชัน (จาก decl ถึง decl ของฟังก์ชันถัดไป — เอาตัวที่มาก่อน)
function fnSource(decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const candidates = [
    src.indexOf("\nasync function ", start + decl.length),
    src.indexOf("\nfunction ", start + decl.length),
    src.indexOf("\nexport function ", start + decl.length),
  ].filter(i => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : undefined;
  return src.slice(start, end);
}

const saveFn    = fnSource("async function saveQuotationFull() {");
const editFn    = fnSource("async function openEditForm(q) {");
const previewFn = fnSource("async function openPreview(q) {");
const convertFn = fnSource("async function convertToDeliveryInvoice(q) {");

// ═══ (0) module flag ═══
test("flag _lineItemsLoadFailed ประกาศ module-level (let ... = false)", () => {
  assert.match(src, /^let _lineItemsLoadFailed = false;/m,
    "_lineItemsLoadFailed ต้องประกาศ module-level");
});

// ═══ (1) ไม่เหลือ catch เงียบของ items-load ═══
test("ไม่เหลือ catch เงียบที่ fallback _lineItems = [] (แบบ one-liner ไม่มี flag/toast)", () => {
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*_lineItems = \[\];\s*\}/.test(src),
    "ห้ามมี catch { _lineItems = []; } เงียบ ๆ เหลืออยู่");
});

test("ทุก catch ที่ fallback _lineItems = [] ต้องมี toast แจ้ง user", () => {
  // เดินหา catch block ทุกตัวที่มี `_lineItems = [];` แล้วเช็คว่า block เดียวกันมี showToast
  const catchRe = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/g;
  let m, found = 0;
  while ((m = catchRe.exec(src)) !== null) {
    if (!m[1].includes("_lineItems = []")) continue;
    found++;
    assert.ok(/showToast/.test(m[1]),
      `catch ที่ fallback _lineItems = [] ต้องมี showToast — เจอ block เงียบ:\n${m[0].slice(0, 200)}`);
  }
  assert.ok(found >= 4, `ต้องเจอ catch fallback อย่างน้อย 4 จุด (pending-preview/edit/preview/convert) — เจอ ${found}`);
});

// ═══ (1b) จุดโหลดที่มี save/document ตาม ต้อง set flag ═══
for (const [label, fn] of [["openEditForm", editFn], ["openPreview", previewFn], ["convertToDeliveryInvoice", convertFn]]) {
  test(`${label}: catch โหลดล้ม set _lineItemsLoadFailed = true · โหลดสำเร็จ reset false`, () => {
    assert.match(fn, /_lineItemsLoadFailed = true;/, `${label}: catch ต้อง set flag = true`);
    assert.match(fn, /_lineItemsLoadFailed = false;/, `${label}: success path ต้อง reset flag = false`);
    const okIdx = fn.indexOf("_lineItemsLoadFailed = false;");
    const failIdx = fn.indexOf("_lineItemsLoadFailed = true;");
    assert.ok(okIdx < failIdx, `${label}: reset false (success) ต้องมาก่อน set true (catch)`);
  });
}

// ═══ (2) saveQuotationFull: guard ก่อน xhrDelete (source order) ═══
test("saveQuotationFull: guard _editingId && _lineItemsLoadFailed อยู่ก่อน xhrDelete + toast ห้ามบันทึกทับ", () => {
  const guardIdx = saveFn.indexOf("if (_editingId && _lineItemsLoadFailed)");
  const delIdx = saveFn.indexOf("xhrDelete(\"quotation_items\"");
  assert.notEqual(guardIdx, -1, "ต้องมี guard _editingId && _lineItemsLoadFailed");
  assert.notEqual(delIdx, -1, "ต้องยังมี xhrDelete quotation_items (edit path)");
  assert.ok(guardIdx < delIdx, "guard ต้องอยู่ก่อน xhrDelete (บล็อกก่อนลบทั้งใบ)");
  assert.match(saveFn, /ห้ามบันทึกทับ/, "guard ต้อง toast บอกว่าห้ามบันทึกทับ");
});

// ═══ (3a) xhrDelete เช็คผล + throw ก่อนถึง insert loop ═══
test("saveQuotationFull: xhrDelete ถูก assign + !delRes?.ok → throw ก่อน insert loop", () => {
  const delIdx = saveFn.indexOf("const delRes = await xhrDelete(\"quotation_items\"");
  assert.notEqual(delIdx, -1, "ผล xhrDelete ต้องถูก capture (const delRes = ...)");
  assert.match(saveFn, /if \(!delRes\?\.ok\) throw new Error/, "delete fail ต้อง throw (ห้ามไหลไป insert)");
  const throwIdx = saveFn.indexOf("if (!delRes?.ok) throw new Error");
  const loopIdx = saveFn.indexOf("xhrPost(\"quotation_items\"");
  assert.ok(throwIdx < loopIdx, "throw ต้องอยู่ก่อน insert loop");
  assert.ok(!/^\s*await xhrDelete\(/m.test(saveFn), "ห้ามเหลือ xhrDelete fire-and-forget");
});

// ═══ (3b) insert loop เก็บ failedItems + มี fail ห้าม toast สำเร็จ ═══
test("saveQuotationFull: insert loop มี failedItems (Phase 412 pattern) + toast สำเร็จเฉพาะเมื่อไม่มี fail", () => {
  assert.match(saveFn, /const failedItems = \[\];/, "ต้องมี failedItems");
  assert.match(saveFn, /const ir = await xhrPost\("quotation_items"/, "ผล insert ต้องถูก capture");
  assert.match(saveFn, /if \(!ir\?\.ok\) failedItems\.push/, "insert fail ต้อง push failedItems");
  assert.match(saveFn, /แต่บันทึกรายการไม่สำเร็จ/, "toast partial ต้องบอกว่ารายการขาด");
  // toast สำเร็จต้องอยู่ใน else ของ failedItems.length > 0 (ห้ามยิงเมื่อมี fail)
  assert.match(saveFn,
    /if \(failedItems\.length > 0\) \{[\s\S]*?\} else \{\s*_ctx\.showToast\("บันทึกใบเสนอราคาแล้ว"\);/,
    "toast สำเร็จต้องอยู่ใน else branch เท่านั้น");
});

// ═══ (3c) throw จาก delete มีคนรับ — catch → toast (ไม่เงียบ/ไม่ unhandled) ═══
test("saveQuotationFull: มี catch รับ throw + toast แจ้ง fail", () => {
  assert.match(saveFn, /\} catch \(e\) \{[\s\S]*?showToast\("❌ บันทึกไม่สำเร็จ: "/,
    "ต้องมี catch → toast (เดิม try/finally ไม่มี catch = throw เงียบ)");
  const fin = saveFn.match(/\} finally \{([\s\S]*?)\}/);
  assert.ok(fin, "ต้องมี finally block");
  assert.match(fin[1], /_qtSaveInflight = false;/, "finally ต้องยัง reset inflight guard (Phase 356)");
});

// ═══ (4) openPreview / convert: block เมื่อโหลดล้ม ═══
test("openPreview: โหลดล้ม → ยกเลิกการเปิด (กลับ list + return) — เอกสาร 0 รายการห้ามโชว์", () => {
  assert.match(previewFn,
    /catch \(e\) \{[\s\S]*?_lineItemsLoadFailed = true;[\s\S]*?showToast[\s\S]*?_viewMode = "list";[\s\S]*?return;/,
    "catch ต้อง toast + กลับ list + return (ไม่ render preview ว่าง)");
});

test("convertToDeliveryInvoice: โหลดล้ม → ยกเลิกการแปลง (toast + return) — ใบส่งสินค้า 0 รายการห้ามเกิด", () => {
  assert.match(convertFn,
    /catch\(e\) \{[\s\S]*?_lineItemsLoadFailed = true;[\s\S]*?ยกเลิกการสร้างใบส่งสินค้า[\s\S]*?return;/,
    "catch ของ items-load ต้อง toast + return ก่อนถึง xhrPost delivery_invoices");
  // return ต้องอยู่ก่อนสร้าง invoice
  const catchIdx = convertFn.indexOf("ยกเลิกการสร้างใบส่งสินค้า");
  const postIdx = convertFn.indexOf("xhrPost(\"delivery_invoices\"");
  assert.ok(catchIdx !== -1 && postIdx !== -1 && catchIdx < postIdx,
    "จุด block ต้องอยู่ก่อน xhrPost delivery_invoices");
});

// ═══ (5) reset flag เมื่อเปิดใบใหม่/ออกจากฟอร์ม/บันทึกสำเร็จ ═══
test("reset _lineItemsLoadFailed = false: list-reset · ปุ่มเปิดใบใหม่ · หลัง save", () => {
  const resets = (src.match(/_lineItemsLoadFailed = false;/g) || []).length;
  assert.ok(resets >= 6,
    `ต้อง reset flag อย่างน้อย 6 จุด (list/air-draft/qtAddBtn/qtEmptyAddBtn/save + success loads) — เจอ ${resets}`);
  assert.match(saveFn, /_lineItemsLoadFailed = false;/, "หลัง save สำเร็จต้อง reset flag");
});
