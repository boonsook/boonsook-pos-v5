// Phase 542 (AH6) — service JV docDate = closed_at (revenue recognition = วันปิดงาน)
// Run: node --test tests/service_job_docdate_guard.test.js
//
// BUG: postJournalForServiceJob posted the JV when a job reached a closure status, but used
//   job.created_at as docDate. A job created in one month and closed in another landed its JV in
//   the WRONG accounting period. Worse across the 1 ก.ค. go-live: created มิ.ย. (pre-effective) +
//   closed ก.ค. → docDate=created_at(มิ.ย.) < effective → the JV was skipped entirely (revenue lost).
// FIX: docDate = closed_at || created_at. And main.js saveServiceJob now stamps closed_at when a
//   job first reaches a closure status (the generic drawer never did → the fix would otherwise be a
//   no-op for that path).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} },
};
console.error = () => {}; console.info = () => {}; console.warn = () => {};

const { postJournalForServiceJob, resetMappingCache } = await import("../modules/accounting/auto_post.js");

function makeRes(status, body, text = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) };
}
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) {
      return makeRes(200, [
        { mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200", is_active: true },
      ]);
    }
    if (u.includes("/accounting_periods")) return makeRes(200, []);          // not locked
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []); // seq → 1
    return makeRes(200, []);
  };
}
beforeEach(() => { resetMappingCache(); installFetch(); });

function installPostOk() {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") return makeRes(201, [{ id: 5001 }]);
    if (u.includes("/journal_lines") && init?.method === "POST") return makeRes(201, []);
    return makeRes(200, []);
  };
}

const baseJob = { id: 70, job_no: "JOB-70", job_type: "ac", total_cost: 100, customer_name: "ทดสอบ", status: "delivered" };

// ───────────────────────────────────────────────
// Behavioral — effective date = 2026-07-01
// ───────────────────────────────────────────────

test("AH6: created มิ.ย. but closed ก.ค. → docDate uses closed_at (ก.ค.) → posts in the close month", async () => {
  installPostOk();
  const res = await postJournalForServiceJob(
    { ...baseJob, created_at: "2026-06-15T03:00:00Z", closed_at: "2026-07-05T03:00:00Z" },
    { detailed: true }
  );
  assert.equal(res.status, "posted", "must NOT skip pre-effective — closed_at (ก.ค.) is the recognition date");
  assert.match(res.docNo, /^SV202607/, "doc_no month must be the close month (202607), not the create month");
});

test("AH6: created+closed both in ก.ค. → docDate = closed_at month", async () => {
  installPostOk();
  const res = await postJournalForServiceJob(
    { ...baseJob, id: 71, created_at: "2026-07-02T03:00:00Z", closed_at: "2026-07-20T03:00:00Z" },
    { detailed: true }
  );
  assert.equal(res.status, "posted");
  assert.match(res.docNo, /^SV202607/);
});

test("AH6: closed_at null → falls back to created_at (no regression for jobs without closed_at)", async () => {
  installPostOk();
  const res = await postJournalForServiceJob(
    { ...baseJob, id: 72, created_at: "2026-07-10T03:00:00Z", closed_at: null },
    { detailed: true }
  );
  assert.equal(res.status, "posted");
  assert.match(res.docNo, /^SV202607/, "fallback created_at (ก.ค.) still posts in that month");
});

test("AH6: created มิ.ย. + closed_at null → still skipped pre-effective (fallback honours the gate)", async () => {
  const res = await postJournalForServiceJob(
    { ...baseJob, id: 73, created_at: "2026-06-15T03:00:00Z", closed_at: null },
    { detailed: true }
  );
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "pre-effective");
  assert.match(res.docDate, /^2026-06/, "docDate falls back to the created month when closed_at is null");
});

// ───────────────────────────────────────────────
// Source guards
// ───────────────────────────────────────────────

test("source: auto_post postJournalForServiceJob docDate uses closed_at (|| created_at)", () => {
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  const start = src.indexOf("export async function postJournalForServiceJob");
  const end = src.indexOf("export function _resolveReceiptDebitAccount", start);
  assert.ok(start !== -1 && end > start, "postJournalForServiceJob body must be found");
  const body = src.slice(start, end);
  assert.match(body, /job\.closed_at\s*\|\|\s*job\.created_at/, "docDate must prefer closed_at, fall back to created_at");
  // the gate must still run on the chosen docDate (not bypassed)
  assert.match(body, /_isAfterEffective\(docDate\)/, "effective gate must still apply to the (new) docDate");
});

test("source: main.js saveServiceJob stamps closed_at when a job first reaches a closure status", () => {
  const src = fs.readFileSync(path.resolve("main.js"), "utf8");
  // gated by 'closing now AND was not already closed' so an edit of an already-closed job
  // does not move the close date; persisted in payload (before the save) so the DB keeps it.
  assert.match(src, /payload\.closed_at\s*=\s*new Date\(\)\.toISOString\(\)/, "must stamp payload.closed_at");
  assert.match(src, /_isClosing\s*&&\s*!_wasClosed\s*&&\s*!payload\.closed_at/, "only when newly closing + not already set");
});
