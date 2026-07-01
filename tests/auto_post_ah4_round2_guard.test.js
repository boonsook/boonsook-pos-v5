// Phase 547 (AH4, §4.3) — auto_post _postJournal must round2 every line + validate EXACT balance
// Run: node --test tests/auto_post_ah4_round2_guard.test.js
//
// Bug: _postJournal validated balance with a ±0.01 tolerance (Math.abs(Dr-Cr) > 0.01) while the DB
//   balance trigger (Phase 498) enforces EXACT equality on NUMERIC(14,2). A sub-satang drift slipped
//   past the client but the DB rejected the lines → orphan header (§4.3 accounting correctness).
// Fix: round2 every line's debit/credit into rLines, compute rounded header totals from rLines,
//   POST rLines (not raw lines), and compare EXACT (totalDebit !== totalCredit). Same 2dp values
//   flow through validate + header + lines → matches the DB, no drift possible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
// isolate _postJournal body
const i = src.indexOf("async function _postJournal");
const j = src.indexOf("\n// POST lines (bulk)", i);
const head = i >= 0 ? src.slice(i, j > i ? j : i + 2000) : src;

test("AH4: round2 every line field into rLines before validate/POST", () => {
  assert.ok(i >= 0, "_postJournal must exist");
  assert.match(head, /const _rd = \(n\) => round2\(Number\(n \|\| 0\)\)/, "must define a round2 helper");
  assert.match(head, /const rLines = lines\.map\(\(l\) => \(\{ \.\.\.l, debit: _rd\(l\.debit\), credit: _rd\(l\.credit\) \}\)\)/,
    "must round2 debit+credit of every line into rLines");
});

test("AH4: header totals derived from rounded rLines", () => {
  assert.match(head, /const totalDebit\s*=\s*_rd\(rLines\.reduce/, "totalDebit = round2(sum of rLines)");
  assert.match(head, /const totalCredit\s*=\s*_rd\(rLines\.reduce/, "totalCredit = round2(sum of rLines)");
});

test("AH4: EXACT balance compare, no ±0.01 tolerance", () => {
  assert.match(head, /if \(totalDebit !== totalCredit\)/, "must compare exact (matches DB NUMERIC(14,2))");
  assert.ok(!/Math\.abs\(totalDebit - totalCredit\)\s*>\s*0\.01/.test(src),
    "must NOT keep the ±0.01 tolerance anywhere");
});

test("AH4: journal_lines POST uses the rounded rLines (not raw lines)", () => {
  const linesBlock = src.slice(src.indexOf("// POST lines (bulk)"), src.indexOf("// POST lines (bulk)") + 400);
  assert.match(linesBlock, /const lineData = rLines\.map/, "lineData must map rLines (rounded), not raw lines");
  assert.match(linesBlock, /debit:\s*l\.debit/, "POST the pre-rounded debit");
  assert.match(linesBlock, /credit:\s*l\.credit/, "POST the pre-rounded credit");
});
