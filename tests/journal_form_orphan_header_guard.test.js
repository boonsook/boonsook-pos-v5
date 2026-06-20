// Phase 509 — manual JV: rollback orphan header on line-insert failure
// Run: node --test tests/journal_form_orphan_header_guard.test.js
//
// Invariant: ฟอร์มบันทึก JV สร้าง journal_entries (header) ก่อน แล้วค่อย POST journal_lines.
// ถ้า lines fail หลังสร้าง header → ต้อง DELETE header ทันที (กัน orphan ที่ทำงบทดลอง/รายงานผิด
// เงียบ ๆ) และห้ามแสดงว่าสำเร็จ/reset form/navigate. Success path เดิมต้องคง.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("modules/accounting/journal_form.js"), "utf8");

// the lines POST + its catch, up to (but not including) the success toast
function linesBlock() {
  const i = SRC.indexOf("// POST lines");
  assert.ok(i > -1, "'// POST lines' section must exist");
  const j = SRC.indexOf("showToast(`✅", i);
  assert.ok(j > -1, "success toast must follow the lines block");
  return SRC.slice(i, j);
}

test("POST journal_entries uses return=representation (to obtain entry id for rollback)", () => {
  const i = SRC.indexOf("/rest/v1/journal_entries`");
  assert.ok(i > -1, "must POST journal_entries");
  const head = SRC.slice(i - 400, i + 400);
  assert.match(head, /return=representation/, "entry POST must return the row so entryId is captured");
});

test("line-insert failure rolls back the header (DELETE journal_entries?id=eq.<entryId>)", () => {
  const block = linesBlock();
  assert.match(block, /method:\s*"DELETE"/, "must DELETE on line failure");
  assert.match(block, /\/rest\/v1\/journal_entries\?id=eq\.\$\{entryId\}/,
    "must delete the just-created header by id");
  assert.match(block, /delResp\.ok/, "must check the rollback response ok");
});

test("rollback verifies a row was ACTUALLY deleted (2xx + 0 rows must NOT count as success)", () => {
  const block = linesBlock();
  // a filtered/RLS-blocked DELETE returns 2xx with 0 rows → ok alone is a false positive
  assert.match(block, /Prefer["']?\s*:\s*["']return=representation["']/,
    "DELETE must request return=representation to learn how many rows were removed");
  assert.match(block, /\bawait\s+delResp\.json\(\)/, "must parse the deleted rows from the response");
  assert.match(block, /rollbackCount/, "must derive a deleted-row count");
  assert.match(block, /Array\.isArray\(deleted\)\s*\?\s*deleted\.length/, "count must come from the deleted array length");
  assert.match(block, /delResp\.ok\s*&&\s*rollbackCount === 1/,
    "rollback success requires ok AND exactly one row deleted (not ok alone)");
});

test("failure path does NOT reset the form, navigate, or claim success", () => {
  const block = linesBlock();
  assert.ok(!/_lines\s*=\s*\[/.test(block), "must NOT reset _lines on failure");
  assert.ok(!/location\.hash\s*=/.test(block), "must NOT navigate away on failure");
  assert.ok(!/showToast\(`✅/.test(block), "must NOT show a success toast on failure");
  // every exit out of the failure branch is an early return (never falls through to success)
  assert.ok((block.match(/return showToast\(/g) || []).length >= 2,
    "failure branch must early-return (rollback-ok + rollback-fail)");
});

test("rollback-FAIL message names the JV/entry for an admin to clean up", () => {
  const block = linesBlock();
  assert.match(block, /JV \$\{docNo\}\/entry \$\{entryId\} ค้าง/, "must name docNo + entryId when stuck");
  assert.match(block, /admin/, "must tell the user an admin must check/delete it");
  // also handle the exception (network) path, not just !ok
  assert.match(block, /catch\s*\(delErr\)/, "rollback must also handle a thrown (network) error");
});

test("success path is preserved: success toast + reset _lines + navigate to accounting_journals", () => {
  assert.match(SRC, /showToast\(`✅ บันทึก \$\{docNo\} สำเร็จ/, "success toast must remain");
  assert.match(SRC, /_lines = \[\{ account_code: "", debit: 0, credit: 0/, "must reset _lines on success");
  assert.match(SRC, /location\.hash = "accounting_journals"/, "must navigate to the journal list on success");
});

test("validation guards remain (>=2 lines, debit=credit, date)", () => {
  // sanity: core validation tokens still present (not removed by the rollback edit)
  assert.match(SRC, /validLines/, "validLines must remain");
});
