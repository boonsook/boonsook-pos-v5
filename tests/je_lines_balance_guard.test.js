// Phase 498 — JE lines = header balance DB constraint guard
// Run: node --test tests/je_lines_balance_guard.test.js
//
// Why this exists:
//   DB เดิมการันตีแค่ header `je_balanced CHECK (total_debit = total_credit)` (phase88)
//   แต่ไม่การันตีว่า SUM(journal_lines) ตรง header หรือ Dr รวม = Cr รวม → JV ที่ lines
//   ไม่ครบ/ไม่ตรง header commit หลุดได้ (audit #A) → งบทดลอง/งบดุลเพี้ยนเงียบ.
//   Phase 498 เพิ่ม CONSTRAINT TRIGGER (deferred) บน journal_lines.
//
//   ★ ดีไซน์สำคัญที่ test นี้ล็อก:
//     - ต้องเป็น CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED (เช็คตอน COMMIT)
//       เพราะ auto_post/journal_form โพสต์ header (TX1) แยกจาก bulk lines (TX2).
//     - ต้องอยู่บน journal_lines เท่านั้น — ห้ามวางบน journal_entries (จะ reject header TX1).
//     - header ถูกลบ (void cascade) → NOT FOUND → ข้าม (ไม่ error).
//   Source-level checks only (ตรงแนว payroll/refund SQL guards — Claude ไม่ apply DB).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sqlPath = path.resolve("supabase-phase498-je-lines-balance.sql");

function sql() {
  assert.ok(fs.existsSync(sqlPath), "supabase-phase498-je-lines-balance.sql must exist");
  return fs.readFileSync(sqlPath, "utf8");
}

test("function: enforce_je_lines_balance defined (re-run safe)", () => {
  const s = sql();
  assert.match(s, /CREATE OR REPLACE FUNCTION public\.enforce_je_lines_balance\(\)/, "guard function");
  assert.match(s, /RETURNS trigger/i, "is a trigger function");
});

test("constraint trigger: deferred, on journal_lines, all DML", () => {
  const s = sql();
  assert.match(s, /DROP TRIGGER IF EXISTS trg_je_lines_balance ON public\.journal_lines/, "re-run safe drop");
  assert.match(s, /CREATE CONSTRAINT TRIGGER trg_je_lines_balance/, "is a CONSTRAINT trigger");
  assert.match(s, /DEFERRABLE INITIALLY DEFERRED/, "must defer to COMMIT (bulk + 2-TX flow)");
  assert.match(s, /AFTER INSERT OR UPDATE OR DELETE ON public\.journal_lines/, "fires on all DML of journal_lines");
  assert.match(s, /FOR EACH ROW/, "row-level");
});

test("skips when header gone (void cascade) — no false reject", () => {
  const s = sql();
  assert.match(s, /IF NOT FOUND THEN\s*\n\s*RETURN NULL/, "header missing → RETURN NULL (skip)");
});

test("rejects both unbalanced lines AND lines<>header", () => {
  const s = sql();
  // (1) Dr รวม <> Cr รวม
  assert.match(s, /IF v_dr <> v_cr THEN[\s\S]*?RAISE EXCEPTION/, "unbalanced lines → raise");
  // (2) ผลรวม lines <> header
  assert.match(s, /v_dr <> v_hdr_dr OR v_cr <> v_hdr_cr[\s\S]*?RAISE EXCEPTION/, "lines<>header → raise");
  assert.equal((s.match(/RAISE EXCEPTION/g) || []).length >= 2, true, "at least 2 distinct violation raises");
});

test("compares header total_debit/total_credit against SUM(journal_lines)", () => {
  const s = sql();
  assert.match(s, /SELECT total_debit, total_credit/i, "reads header totals");
  assert.match(s, /sum\(debit\)[\s\S]*?sum\(credit\)/i, "sums the lines");
  assert.match(s, /FROM public\.journal_lines\s*\n?\s*WHERE entry_id = v_entry/, "sums lines of this entry");
});

test("PostgREST schema reload notified", () => {
  const s = sql();
  assert.match(s, /NOTIFY pgrst, 'reload schema'/, "must NOTIFY pgrst");
});

test("scope guard: does NOT touch header trigger / je_balanced / RLS / generated cols", () => {
  const s = sql();
  // ห้ามวาง trigger บน journal_entries (จะ reject header-first TX1)
  assert.ok(!/TRIGGER[\s\S]*?ON public\.journal_entries/.test(s),
    "must NOT create a trigger on journal_entries (header-first 2-TX would break)");
  // ห้าม "แก้/ลบ" constraint เดิม — เอ่ยถึงใน comment เพื่อ document ได้
  assert.ok(!/ALTER TABLE[\s\S]*?je_balanced|DROP CONSTRAINT[\s\S]*?je_balanced/i.test(s),
    "must NOT alter/drop the existing je_balanced CHECK");
  assert.ok(!/ALTER TABLE public\.journal_entries/i.test(s),
    "must NOT alter the journal_entries table");
  assert.ok(!/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(s), "must NOT touch RLS policies");
  assert.ok(!/je_insert_auto|jl_insert_auto/.test(s), "must NOT touch je/jl insert RLS (separate phase)");
});

test("STEP3 negative-test is valid (owner-flagged fix): valid doc_type + SET CONSTRAINTS, no bogus RAISE", () => {
  const s = sql();
  // เดิม doc_type='TEST' ตาย CHECK (23514) ก่อนถึง trigger; ต้องใช้ค่า valid (ห้ามมี bare 'TEST' literal)
  assert.ok(!/['"]TEST['"]/.test(s), "negative-test ห้ามใช้ doc_type 'TEST' (ชน CHECK ก่อนถึง trigger)");
  // RAISE 'should-not-reach' ขวาง deferred trigger ที่ fire ตอน COMMIT — ต้องเอาออก
  assert.ok(!/should-not-reach/.test(s), "ห้ามมี RAISE 'should-not-reach' (ขวาง deferred check)");
  // ต้องบังคับ deferred constraint ให้เช็คทันที เพื่อเห็น error จาก trigger จริง
  assert.match(s, /SET CONSTRAINTS ALL IMMEDIATE/, "ต้องใช้ SET CONSTRAINTS ALL IMMEDIATE บังคับ deferred check");
});
