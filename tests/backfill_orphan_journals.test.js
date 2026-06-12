// ═══════════════════════════════════════════════════════════
//  tests/backfill_orphan_journals.test.js — Phase 92.47
//
//  ทดสอบ pure helpers + source-level guard ของ scripts/backfill_orphan_journals.js
//
//  ★ ไม่เทส HTTP/auth/postJournalFor* paths (integration — ต้องใช้ admin creds จริง)
//  ★ ครอบเฉพาะ logic ที่ deterministic + readable
// ═══════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { summarizeResults, formatSummaryLine, classifyBackfillCandidate } from "../scripts/backfill_orphan_journals.js";

const SCRIPT_PATH = path.resolve("scripts/backfill_orphan_journals.js");
const SCRIPT_SRC = fs.readFileSync(SCRIPT_PATH, "utf8");

// ── summarizeResults ────────────────────────────────────────
test("summarizeResults: empty list returns all zeros", () => {
  const s = summarizeResults([]);
  assert.deepEqual(s, { posted: 0, wouldPost: 0, skipped: 0, failed: 0, total: 0 });
});

test("summarizeResults: counts posted/skipped/failed correctly", () => {
  const results = [
    { id: 1, status: "posted", jvId: 100 },
    { id: 2, status: "posted", jvId: 101 },
    { id: 7, status: "would-post" },
    { id: 3, status: "skipped" },
    { id: 4, status: "failed", reason: "no-mapping" },
    { id: 5, status: "skipped" },
    { id: 6, status: "posted", jvId: 102 },
  ];
  const s = summarizeResults(results);
  assert.equal(s.posted, 3);
  assert.equal(s.wouldPost, 1);
  assert.equal(s.skipped, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.total, 7);
});

test("summarizeResults: would-post status is counted separately", () => {
  const results = [
    { id: 1, status: "would-post" },
    { id: 2, status: "would-post" },
    { id: 3, status: "posted", jvId: 100 },
  ];
  const s = summarizeResults(results);
  assert.equal(s.posted, 1);
  assert.equal(s.wouldPost, 2);
  assert.equal(s.skipped, 0);
  assert.equal(s.failed, 0);
  assert.equal(s.total, 3);
});

test("summarizeResults: unknown status ignored (not counted)", () => {
  const results = [
    { id: 1, status: "weird" },
    { id: 2, status: "posted", jvId: 100 },
  ];
  const s = summarizeResults(results);
  assert.equal(s.posted, 1);
  assert.equal(s.total, 2);
});

// ── formatSummaryLine ───────────────────────────────────────
test("formatSummaryLine: includes all counts + label", () => {
  const line = formatSummaryLine("Sales:", { posted: 3, wouldPost: 4, skipped: 2, failed: 1, total: 10 });
  assert.match(line, /Sales:/);
  assert.match(line, /3 posted/);
  assert.match(line, /4 would-post/);
  assert.match(line, /2 skipped/);
  assert.match(line, /1 failed/);
  assert.match(line, /total 10/);
});

test("formatSummaryLine: zero counts render correctly", () => {
  const line = formatSummaryLine("Expenses:", { posted: 0, wouldPost: 0, skipped: 0, failed: 0, total: 0 });
  assert.match(line, /Expenses:/);
  assert.match(line, /0 posted/);
  assert.match(line, /0 failed/);
});

test("classifyBackfillCandidate: pre-effective and zero rows are skipped in dry-run", () => {
  const april = classifyBackfillCandidate("sales", { created_at: "2026-04-04T12:00:00Z", total_amount: 11900 });
  assert.equal(april.status, "skipped");
  assert.equal(april.reason, "pre-effective");

  const zero = classifyBackfillCandidate("sales", { created_at: "2026-07-04T12:00:00Z", total_amount: 0 });
  assert.equal(zero.status, "skipped");
  assert.equal(zero.reason, "zero-amount");
});

test("classifyBackfillCandidate: post-effective positive row is would-post in dry-run", () => {
  const r = classifyBackfillCandidate("expenses", { expense_date: "2026-07-04", amount: 1000 });
  assert.equal(r.status, "would-post");
  assert.equal(r.docDate, "2026-07-04");
  assert.equal(r.amount, 1000);
});

// ── Source-level guards (ป้องกัน regression ของ critical pattern) ──

test("source: uses pathToFileURL for cross-platform import URL (Windows safe)", () => {
  assert.match(SCRIPT_SRC, /pathToFileURL/, "must use pathToFileURL — file:// import paths ต่างกัน Win/POSIX");
});

test("source: window shim set BEFORE auto_post import", () => {
  const shimIdx = SCRIPT_SRC.indexOf("globalThis.window");
  const importIdx = SCRIPT_SRC.indexOf("await import(autoPostUrl)");
  assert.ok(shimIdx > 0, "must shim window");
  assert.ok(importIdx > 0, "must dynamic import auto_post");
  assert.ok(shimIdx < importIdx, "window shim must come BEFORE auto_post import (auto_post reads window at module load)");
});

test("source: shim includes SUPABASE_CONFIG + _sbAccessToken (used by _authFetch fallback)", () => {
  assert.match(SCRIPT_SRC, /SUPABASE_CONFIG:\s*\{\s*url:/);
  assert.match(SCRIPT_SRC, /_sbAccessToken:\s*admin\.token/);
});

test("source: calls resetMappingCache after import (gets fresh mappings with admin token)", () => {
  assert.match(SCRIPT_SRC, /resetMappingCache\(\)/);
});

test("source: supports --dry-run flag", () => {
  assert.match(SCRIPT_SRC, /process\.argv\.includes\("--dry-run"\)/);
});

test("source: supports --sales-only and --expenses-only scope flags", () => {
  assert.match(SCRIPT_SRC, /--sales-only/);
  assert.match(SCRIPT_SRC, /--expenses-only/);
});

test("source: imports postJournalForSale + postJournalForExpense (not replicated)", () => {
  // Must reuse auto_post.js logic — replicating risks drift from mapping rules
  assert.match(SCRIPT_SRC, /postJournalForSale/);
  assert.match(SCRIPT_SRC, /postJournalForExpense/);
});

test("source: reads from view names matching Phase 92.46 SQL", () => {
  assert.match(SCRIPT_SRC, /vw_sales_without_journal/);
  assert.match(SCRIPT_SRC, /vw_expenses_without_journal/);
});

test("source: calls integrity summary before AND after run (delta visibility)", () => {
  // Two snapshots: before + after — เห็น delta ของ orphan counts
  // helper function definition + 2 call sites = ≥3 occurrences of getIntegritySummary
  const matches = SCRIPT_SRC.match(/getIntegritySummary/g) || [];
  assert.ok(matches.length >= 3, "expected ≥3 references to getIntegritySummary (def + before + after)");
  assert.match(SCRIPT_SRC, /accounting_integrity_summary/, "RPC path must match phase 92.46 SQL");
});

test("source: exit codes 0/1/2 distinguish success / partial fail / fatal", () => {
  assert.match(SCRIPT_SRC, /process\.exit\(0\)/);
  assert.match(SCRIPT_SRC, /process\.exit\(1\)/);
  assert.match(SCRIPT_SRC, /process\.exit\(2\)/);
});

test("source: main() guarded so test import does NOT trigger env load / auth / network", () => {
  // ถ้า env load อยู่ top-level → test ทำ CI fail เพราะไม่มี .env
  assert.match(SCRIPT_SRC, /if\s*\(\s*isMain\s*\)/);
  assert.match(SCRIPT_SRC, /import\.meta\.url\s*===\s*pathToFileURL/);
});

test("source: README header explains effective date constraint", () => {
  // ป้องกันคน assume ว่า script จะ backfill ทั้งหมด ทั้งที่จริง auto_post skip pre-effective
  assert.match(SCRIPT_SRC, /ACCOUNTING_EFFECTIVE_DATE|pre-effective/i);
});

// ── npm script registration ─────────────────────────────────
test("package.json registers backfill:orphans npm script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  assert.equal(
    pkg.scripts["backfill:orphans"],
    "node scripts/backfill_orphan_journals.js",
    "must register exact command"
  );
});
