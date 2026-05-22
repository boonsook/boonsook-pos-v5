// Phase 92.17 — Unit tests for accounting/sale_trace.js (forward accounting trace)
// Covers: findJournalForSale found/missing/error/invalid + renderSaleTraceBadge
//         (found is clickable w/ route+jv-id, missing/error never silent)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { findJournalForSale, renderSaleTraceBadge, JOURNAL_ROUTE } =
  await import("../modules/accounting/sale_trace.js");

const CFG = { url: "https://example.supabase.co", anonKey: "anon-xxx" };

function makeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ── findJournalForSale ───────────────────────────────────────

test("findJournalForSale — FOUND: returns entry + queries by source_table+source_id (not doc_no)", async () => {
  let calledUrl = "";
  const fetchMock = async (url) => {
    calledUrl = url;
    return makeRes(200, [{ id: 42, doc_no: "SV2026050001", doc_type: "SV", status: "approved", source_table: "sales", source_id: 7 }]);
  };
  const res = await findJournalForSale({ id: 7 }, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.status, "found");
  assert.equal(res.entry.doc_no, "SV2026050001");
  // ★ canonical key — must filter by source_table + source_id, never by doc_no/description
  assert.match(calledUrl, /source_table=eq\.sales/);
  assert.match(calledUrl, /source_id=eq\.7/);
  assert.doesNotMatch(calledUrl, /doc_no=|description=/);
});

test("findJournalForSale — accepts raw sale id (not just object)", async () => {
  const fetchMock = async () => makeRes(200, [{ id: 1, doc_no: "SV1", status: "approved" }]);
  const res = await findJournalForSale(7, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.found, true);
});

test("findJournalForSale — MISSING: empty array → status 'missing', not error", async () => {
  const fetchMock = async () => makeRes(200, []);
  const res = await findJournalForSale({ id: 999 }, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.ok, true);
  assert.equal(res.found, false);
  assert.equal(res.status, "missing");
  assert.equal(res.entry, null);
});

test("findJournalForSale — ERROR: HTTP 403 (RLS) → status 'error', never throws", async () => {
  const fetchMock = async () => makeRes(403, { message: "row-level security" });
  const res = await findJournalForSale({ id: 5 }, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.ok, false);
  assert.equal(res.found, false);
  assert.equal(res.status, "error");
});

test("findJournalForSale — ERROR: fetch throws → caught, status 'error'", async () => {
  const fetchMock = async () => { throw new Error("network down"); };
  const res = await findJournalForSale({ id: 5 }, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.ok, false);
  assert.equal(res.status, "error");
  assert.match(res.error, /network down/);
});

test("findJournalForSale — INVALID: no id → status 'invalid', no fetch attempted", async () => {
  let called = false;
  const fetchMock = async () => { called = true; return makeRes(200, []); };
  const res = await findJournalForSale({}, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.status, "invalid");
  assert.equal(called, false);
});

// ── renderSaleTraceBadge ─────────────────────────────────────

test("renderSaleTraceBadge — FOUND: clickable, carries route + jv id (click target)", () => {
  const html = renderSaleTraceBadge({ found: true, entry: { id: 42, doc_no: "SV2026050001", status: "approved" } });
  assert.match(html, /class="sale-acct-trace"/);
  assert.match(html, new RegExp(`data-acct-route="${JOURNAL_ROUTE}"`));
  assert.match(html, /data-jv-id="42"/);
  assert.match(html, /SV2026050001/);
  assert.match(html, /role="button"/);   // keyboard/click target
});

test("renderSaleTraceBadge — MISSING: shows 'ยังไม่ลงบัญชี' (not silent, not clickable-as-found)", () => {
  const html = renderSaleTraceBadge({ found: false, status: "missing", entry: null });
  assert.match(html, /ยังไม่ลงบัญชี/);
  assert.doesNotMatch(html, /class="sale-acct-trace"/); // not a navigation target
});

test("renderSaleTraceBadge — ERROR: shows a non-silent fallback label", () => {
  const html = renderSaleTraceBadge({ found: false, status: "error", entry: null });
  assert.match(html, /ตรวจบัญชีไม่ได้/);
});

test("renderSaleTraceBadge — escapes doc_no (XSS-safe)", () => {
  const html = renderSaleTraceBadge({ found: true, entry: { id: 1, doc_no: '<img src=x onerror=alert(1)>', status: "approved" } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
