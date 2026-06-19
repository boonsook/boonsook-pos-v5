// Phase 498 / build 498 — JV form number inputs keep focus (no full re-render)
// Run: node --test tests/jv_form_focus_guard.test.js
//
// Why this exists:
//   ฟอร์ม "บันทึกรายการบัญชีใหม่" (journal_form.js) เดิม handler ช่องเดบิต/เครดิต ผูก event
//   `input` แล้วเรียก renderJournalFormPage ทุก keystroke → container.innerHTML สร้างใหม่ทั้งฟอร์ม
//   → <input> ที่กำลังพิมพ์ถูกแทน → focus หลุดหลังพิมพ์ 1 ตัว + ทศนิยมพังกลางคัน.
//   build 498 แก้: pure computeJvTotals + _refreshSummary() อัปเดตเฉพาะแถบรวม/ปุ่ม (ไม่ re-render).
//   guard นี้ล็อก: (1) computeJvTotals ถูกต้อง (unit) (2) handler เลข "ไม่มี" renderJournalFormPage
//   แต่ "มี" _refreshSummary (source-regex บนบล็อก handler ที่ extract มาเฉพาะ — ไม่ grep ทั้งไฟล์).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeJvTotals } from "../modules/accounting/journal_form.js";

const src = fs.readFileSync(path.resolve("modules/accounting/journal_form.js"), "utf8");

// ── helper: ดึงบล็อก handler ระหว่าง marker (iron rule: อย่า regex ทั้งไฟล์) ──
function between(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + 1);
  assert.ok(s > -1, `must find ${startMarker}`);
  assert.ok(e > s, `${endMarker} must follow ${startMarker}`);
  return src.slice(s, e);
}

// ═══ UNIT — computeJvTotals ═══
test("computeJvTotals: balanced=true เมื่อ dr=cr>0", () => {
  const r = computeJvTotals([{ debit: 100 }, { credit: 100 }]);
  assert.equal(r.totalDebit, 100);
  assert.equal(r.totalCredit, 100);
  assert.equal(r.balanced, true);
});

test("computeJvTotals: balanced=false เมื่อ dr<>cr", () => {
  const r = computeJvTotals([{ debit: 100 }, { credit: 90 }]);
  assert.equal(r.balanced, false);
  assert.equal(r.totalCredit, 90);
});

test("computeJvTotals: balanced=false เมื่อ dr=0 (กันบันทึกฟอร์มว่าง)", () => {
  assert.equal(computeJvTotals([{ credit: 100 }]).balanced, false);
  assert.equal(computeJvTotals([{ debit: 0, credit: 0 }]).balanced, false);
});

test("computeJvTotals: tolerance 0.01 (float)", () => {
  assert.equal(computeJvTotals([{ debit: 100 }, { credit: 100.005 }]).balanced, true, "diff 0.005 < 0.01");
  assert.equal(computeJvTotals([{ debit: 100 }, { credit: 100.02 }]).balanced, false, "diff 0.02 >= 0.01");
});

test("computeJvTotals: ทน input เพี้ยน (null/[]/string)", () => {
  assert.deepEqual(computeJvTotals([]), { totalDebit: 0, totalCredit: 0, balanced: false });
  assert.deepEqual(computeJvTotals(null), { totalDebit: 0, totalCredit: 0, balanced: false });
  assert.equal(computeJvTotals([{ debit: "50" }, { credit: "50" }]).balanced, true);
});

// ═══ GUARD — handler ไม่ re-render ทั้งฟอร์ม ═══
test("debit handler: ไม่มี renderJournalFormPage + มี _refreshSummary", () => {
  const block = between('[data-jv-line-debit]', '[data-jv-line-credit]');
  assert.ok(!block.includes("renderJournalFormPage"), "debit handler ห้ามเรียก renderJournalFormPage (focus จะหลุด)");
  assert.ok(block.includes("_refreshSummary"), "debit handler ต้องเรียก _refreshSummary");
  assert.ok(block.includes("data-jv-line-credit"), "ต้องเคลียร์ช่องเครดิตในจอ (line_one_side)");
});

test("credit handler: ไม่มี renderJournalFormPage + มี _refreshSummary + เคลียร์เดบิต", () => {
  const block = between('[data-jv-line-credit]', '[data-jv-line-desc]');
  assert.ok(!block.includes("renderJournalFormPage"), "credit handler ห้ามเรียก renderJournalFormPage");
  assert.ok(block.includes("_refreshSummary"), "credit handler ต้องเรียก _refreshSummary");
  assert.ok(block.includes("data-jv-line-debit"), "ต้องเคลียร์ช่องเดบิตในจอ (line_one_side)");
});

test("desc handler ยังเดิม (set description, ไม่ re-render)", () => {
  const block = between('[data-jv-line-desc]', '[data-jv-line-del]');
  assert.ok(block.includes(".description ="), "desc handler ยังอัปเดต state เหมือนเดิม");
  assert.ok(!block.includes("renderJournalFormPage"), "desc handler ไม่ re-render (เหมือนเดิม)");
});

test("add/del ยัง re-render ทั้งฟอร์ม (โครงเปลี่ยน — ไม่ได้พิมพ์อยู่)", () => {
  // ตรวจตรง ๆ จาก source: del handler มี splice + renderJournalFormPage
  assert.match(src, /data-jv-line-del[\s\S]{0,200}_lines\.splice[\s\S]{0,120}renderJournalFormPage/,
    "del ยังต้อง re-render ทั้งฟอร์มหลัง splice");
  assert.match(src, /jvAddLineBtn[\s\S]{0,200}_lines\.push[\s\S]{0,120}renderJournalFormPage/,
    "add ยังต้อง re-render ทั้งฟอร์มหลัง push");
});

test("_refreshSummary อัปเดตแถบรวม+ปุ่ม โดยไม่ re-render", () => {
  const fn = between("function _refreshSummary()", "// ─── Bind events");
  assert.ok(fn.includes("computeJvTotals"), "ใช้ computeJvTotals");
  assert.ok(fn.includes("#jvTotDr") && fn.includes("#jvTotCr") && fn.includes("#jvBalState"), "อัปเดต 3 จุดสรุป");
  assert.ok(fn.includes("jvSaveDraftBtn") && fn.includes("jvSaveApprovedBtn"), "toggle 2 ปุ่ม");
  assert.ok(fn.includes("disabled") && fn.includes("opacity"), "ปรับ disabled + opacity");
  assert.ok(!fn.includes("renderJournalFormPage"), "_refreshSummary ห้าม re-render ทั้งฟอร์ม");
});

test("footer มี id สำหรับ live-update (jvTotDr/jvTotCr/jvBalState)", () => {
  assert.ok(src.includes('id="jvTotDr"') && src.includes('id="jvTotCr"') && src.includes('id="jvBalState"'),
    "footer ต้องมี id ทั้ง 3 ให้ _refreshSummary หา");
});

test("ไม่แตะ _save / 2-TX POST (scope)", () => {
  // save flow ยังอยู่ครบ (ไม่ถูกลบ/แก้โดยพลาด)
  assert.match(src, /rest\/v1\/journal_entries/, "ยังมี POST journal_entries");
  assert.match(src, /rest\/v1\/journal_lines/, "ยังมี POST journal_lines");
});
