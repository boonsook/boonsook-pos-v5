// P1 accounting cutover guard: detailed auto-post result separates
// posted/skipped/failed while legacy callers still receive entryId/null.
//
// Run: node --test tests/auto_post_detailed_result.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} },
};

console.error = () => {};
console.info = () => {};
console.warn = () => {};

const { postJournalForExpense, resetMappingCache } = await import("../modules/accounting/auto_post.js");

function makeRes(status, body, text = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) {
      return makeRes(200, [
        { mapping_key: "expense_misc", debit_account_code: "5200", credit_account_code: "1110", is_active: true },
      ]);
    }
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []);
    return makeRes(200, []);
  };
}

beforeEach(() => {
  resetMappingCache();
  installFetch();
});

test("legacy postJournalForExpense still returns entry id on success", async () => {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") return makeRes(201, [{ id: 9999 }]);
    if (u.includes("/journal_lines") && init?.method === "POST") return makeRes(201, []);
    return makeRes(200, []);
  };

  const res = await postJournalForExpense({ id: 1, amount: 100, category: "misc", expense_date: "2026-07-02" });
  assert.equal(res, 9999);
});

test("detailed success returns posted with entryId", async () => {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") return makeRes(201, [{ id: 1001 }]);
    if (u.includes("/journal_lines") && init?.method === "POST") return makeRes(201, []);
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 2, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "posted");
  assert.equal(res.entryId, 1001);
});

test("detailed pre-effective returns skipped, not failed", async () => {
  let authCalled = false;
  window._appAuthFetch = async () => { authCalled = true; return makeRes(201, [{ id: 1 }]); };

  const res = await postJournalForExpense(
    { id: 3, amount: 100, category: "misc", expense_date: "2026-06-12" },
    { detailed: true }
  );
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "pre-effective");
  assert.equal(authCalled, false, "pre-effective should not attempt journal writes");
});

test("detailed duplicate (source already posted) returns skipped duplicate", async () => {
  // Phase 534 (B3): a real PostgREST 409 names the violated constraint. The source-dup case
  //   is idx_je_source_unique → classifier = 'source-dup' → still skipped/duplicate. (The old
  //   mock returned a bare {code:"23505"} with no constraint name, which the B3 classifier now
  //   correctly treats as 'unknown' → throw — so the mock must reflect reality, not be relaxed.)
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      return makeRes(409, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_je_source_unique"',
      });
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 4, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "duplicate");
});

test("detailed entry insert failure returns failed", async () => {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      return makeRes(403, { message: "RLS denied", code: "42501" }, "42501 row-level security");
    }
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 5, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "entry-insert-failed");
});

test("detailed line insert failure returns failed", async () => {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") return makeRes(201, [{ id: 1002 }]);
    if (u.includes("/journal_lines") && init?.method === "POST") return makeRes(500, { message: "line write failed" });
    if (u.includes("/journal_entries?id=eq.1002") && init?.method === "DELETE") return makeRes(204, []);
    return makeRes(200, []);
  };

  const res = await postJournalForExpense(
    { id: 6, amount: 100, category: "misc", expense_date: "2026-07-02" },
    { detailed: true }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "lines-insert-failed");
  assert.equal(res.entryId, 1002);
});
