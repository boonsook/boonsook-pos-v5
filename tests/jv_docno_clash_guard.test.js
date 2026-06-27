// Phase 534 (B3) — JV doc_no clash must retry, never be skipped silently
// Run: node --test tests/jv_docno_clash_guard.test.js
//
// Bug: auto_post.js generated doc_no via read-max+1 (racy). Two concurrent checkouts read the
//   same max → same doc_no → the loser got a 409 on journal_entries_doc_no_key. The old code
//   treated EVERY 409 as "source already posted" → skipped silently → that bill's JV was LOST
//   (revenue undercount, hard to detect). Worst case on 1 ก.ค. when many cashiers post at once.
//
// Fix: classify the 409 (source-dup vs doc_no clash vs unknown) and RETRY a fresh, monotonically
//   advancing seq on a doc_no clash; surface (failed + report) if still clashing after N tries —
//   never skip silently. The gate (classify ONLY 409/23505) keeps Phase 92.13 RLS handling intact.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  _errorReporter: null,
  App: { showToast: () => {} },
};

console.error = () => {};
console.info = () => {};
console.warn = () => {};

const {
  classifyJeInsertError,
  postJournalForExpense,
  resetMappingCache,
  _setDocnoRetrySleepForTest,
} = await import("../modules/accounting/auto_post.js");

// jitter sleep → no-op so retry tests are instant + deterministic
_setDocnoRetrySleepForTest(() => Promise.resolve());

function makeRes(status, body, text = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

// doc_no read max — controllable per test (default: none → next seq = 1, stays stale)
let _maxDocNo = null;
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) {
      return makeRes(200, [
        { mapping_key: "expense_misc", debit_account_code: "5200", credit_account_code: "1110", is_active: true },
      ]);
    }
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) {
      return makeRes(200, _maxDocNo ? [{ doc_no: _maxDocNo }] : []);
    }
    return makeRes(200, []);
  };
}

beforeEach(() => {
  resetMappingCache();
  _maxDocNo = null;
  window._errorReporter = null;
  installFetch();
});

const SRC_DUP = 'duplicate key value violates unique constraint "idx_je_source_unique"';
const DOCNO_CLASH = 'duplicate key value violates unique constraint "journal_entries_doc_no_key"';

// ───────────────────────────────────────────────
// 1. classifier — pure helper (positive, no guessing)
// ───────────────────────────────────────────────

test("classifyJeInsertError: idx_je_source_unique body → source-dup", () => {
  assert.equal(classifyJeInsertError(409, `{"code":"23505","message":"${SRC_DUP}"}`), "source-dup");
});

test("classifyJeInsertError: journal_entries_doc_no_key body → docno-clash", () => {
  assert.equal(classifyJeInsertError(409, `{"code":"23505","message":"${DOCNO_CLASH}"}`), "docno-clash");
});

test("classifyJeInsertError: generic 'unique constraint ... doc_no' wording → docno-clash (fallback)", () => {
  assert.equal(classifyJeInsertError(409, 'violates unique constraint on column doc_no'), "docno-clash");
});

test("classifyJeInsertError: bare 23505 with NO constraint name → unknown (must not guess)", () => {
  assert.equal(classifyJeInsertError(409, '{"code":"23505"}'), "unknown");
  assert.equal(classifyJeInsertError(409, ""), "unknown");
});

// ───────────────────────────────────────────────
// 2. retry behavioral — through postJournalForExpense
// ───────────────────────────────────────────────

test("doc_no clash once then ok → posted (not skipped); doc_no advances", async () => {
  const sent = [];
  let n = 0;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      sent.push(JSON.parse(init.body).doc_no);
      n++;
      if (n === 1) return makeRes(409, { code: "23505", message: DOCNO_CLASH });
      return makeRes(201, [{ id: 7001 }]);
    }
    if (u.includes("/journal_lines") && init?.method === "POST") return makeRes(201, []);
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 10, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "posted", "doc_no clash must retry, not skip");
  assert.equal(res.entryId, 7001);
  assert.equal(sent.length, 2, "must have retried exactly once");
  // stale read returns nothing both times → Math.max(1, lastTried+1) guarantees progress
  assert.ok(sent[1] > sent[0], `retry doc_no must advance: ${sent[0]} → ${sent[1]}`);
});

test("source already posted (idx_je_source_unique) → skipped duplicate (no retry)", async () => {
  let posts = 0;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      posts++;
      return makeRes(409, { code: "23505", message: SRC_DUP });
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 11, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "duplicate");
  assert.equal(posts, 1, "source-dup must not retry");
});

test("doc_no clash on every attempt → failed docno-clash-unresolved (never skipped silently) + reported", async () => {
  const captured = [];
  window._errorReporter = { captureMessage: (msg, opts) => captured.push({ msg, opts }) };
  let posts = 0;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      posts++;
      return makeRes(409, { code: "23505", message: DOCNO_CLASH });
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 12, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "failed", "must NOT be skipped — that is the silent-loss bug");
  assert.equal(res.reason, "docno-clash-unresolved");
  assert.equal(posts, 5, "must exhaust MAX_DOCNO_RETRY (=5) attempts");
  assert.equal(captured.length, 1, "must surface via _errorReporter.captureMessage");
  assert.match(captured[0].msg, /doc_no clash unresolved/);
});

// ───────────────────────────────────────────────
// 3. GATE non-409 — Phase 92.13 RLS handling must NOT regress
// ───────────────────────────────────────────────

test("RLS 403 → NOT retried / NOT skipped → falls to existing failed/entry-insert-failed", async () => {
  let posts = 0;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      posts++;
      return makeRes(403, { message: "permission denied (row-level security)" });
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 13, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "entry-insert-failed", "RLS must use the existing catch, not the new docno path");
  assert.equal(posts, 1, "non-409 must not enter the retry loop");
});

test("generic 500 → throw → existing catch (failed/entry-insert-failed), not classified", async () => {
  let posts = 0;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      posts++;
      return makeRes(500, { message: "internal" });
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 14, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "entry-insert-failed");
  assert.equal(posts, 1, "non-unique error must not retry");
});

// ───────────────────────────────────────────────
// 4. source-regex — lock the wiring in auto_post.js
// ───────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
const SRC = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");

test("auto_post.js wires the classifier + bounded progressive retry + surfaces exhaustion", () => {
  assert.match(SRC, /classifyJeInsertError\s*\(/, "must call classifyJeInsertError");
  assert.match(SRC, /Math\.max\(\s*fetchedNextSeq\s*,\s*lastTriedSeq\s*\+\s*1\s*\)/, "must use progress-guaranteed seq");
  assert.match(SRC, /docno-clash-unresolved/, "must return a distinct failed reason on exhaustion");
  assert.match(SRC, /captureMessage\?\.\(\s*"auto_post doc_no clash unresolved"/, "must report unresolved clash");
  // the old bug: a bare 409 immediately returning skipped/duplicate without classifying
  assert.ok(!/r\.status === 409 \|\| r\.status === 23505/.test(SRC),
    "old un-classified 409→skipped branch must be gone");
});
