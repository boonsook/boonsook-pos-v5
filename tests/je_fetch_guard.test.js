// Phase 496 (audit รอบ2 #2) — accounting reports paginate JE/JL (no silent 1000-row cap).
// Run: node --test tests/je_fetch_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchAllRowsRaw } from "../modules/fetch_paginated.js";
import { fetchApprovedJournalLines } from "../modules/accounting/je_fetch.js";

function withMockFetch(impl, fn) {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG: { url: "https://x.test", anonKey: "anon" }, _sbAccessToken: "tok" };
  globalThis.fetch = async (url) => { calls.push(url); return impl(url, calls.length - 1); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = prevFetch; globalThis.window = prevWindow; });
}
const ok = (rows) => ({ ok: true, json: async () => rows });

// ── fetchAllRowsRaw ─────────────────────────────────────────────────────────────
test("fetchAllRowsRaw pages until a short page (no silent truncation)", () =>
  withMockFetch((url) => {
    const off = Number(new URL(url).searchParams.get("offset"));
    return ok(off === 0 ? [1, 2] : [3]);     // page1 full(2), page2 short(1) → stop
  }, async (calls) => {
    const rows = await fetchAllRowsRaw((o, l) => `https://x.test/t?order=id.asc&limit=${l}&offset=${o}`, {}, 2);
    assert.deepEqual(rows, [1, 2, 3]);
    assert.equal(calls.length, 2);
  }));

test("fetchAllRowsRaw stops on an exactly-full final page (no infinite loop)", () =>
  withMockFetch((url) => {
    const off = Number(new URL(url).searchParams.get("offset"));
    return ok(off === 0 ? [1, 2] : []);      // page2 empty → stop
  }, async () => {
    const rows = await fetchAllRowsRaw((o, l) => `https://x.test/t?limit=${l}&offset=${o}`, {}, 2);
    assert.deepEqual(rows, [1, 2]);
  }));

test("fetchAllRowsRaw throws on HTTP error (never a silent partial)", () =>
  withMockFetch(() => ({ ok: false, status: 500, json: async () => null }), async () => {
    await assert.rejects(() => fetchAllRowsRaw((o, l) => `https://x.test/t?limit=${l}&offset=${o}`, {}), /HTTP 500/);
  }));

// ── fetchApprovedJournalLines ───────────────────────────────────────────────────
test("fetchApprovedJournalLines: paginated entries + chunked-paginated lines", () =>
  withMockFetch((url) => {
    if (url.includes("/journal_entries")) {
      const off = Number(new URL(url).searchParams.get("offset"));
      // first entries page full(=pageSize 1000 would be huge) → emulate single short page
      return ok(off === 0 ? [{ id: 10 }, { id: 11 }] : []);
    }
    // journal_lines
    const off = Number(new URL(url).searchParams.get("offset"));
    return ok(off === 0 ? [{ account_code: "4110", debit: 0, credit: 100 }] : []);
  }, async (calls) => {
    const lines = await fetchApprovedJournalLines("2026-07-01", "2026-07-31");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].credit, 100);
    const entriesCall = calls.find(u => u.includes("/journal_entries"));
    assert.match(entriesCall, /status=eq\.approved/, "entries filtered to approved");
    assert.match(entriesCall, /order=id\.asc&limit=\d+&offset=\d+/, "entries fetched with stable order + paging");
    const linesCall = calls.find(u => u.includes("/journal_lines"));
    assert.match(linesCall, /entry_id=in\.\(10,11\)/, "lines fetched for the entry ids");
    assert.match(linesCall, /order=entry_id\.asc,line_no\.asc&limit=\d+&offset=\d+/, "lines paged with stable order");
  }));

test("fetchApprovedJournalLines: no entries → [] (no lines request)", () =>
  withMockFetch((url) => ok(url.includes("/journal_entries") ? [] : [{ x: 1 }]), async (calls) => {
    const lines = await fetchApprovedJournalLines("2026-07-01", "2026-07-31");
    assert.deepEqual(lines, []);
    assert.ok(!calls.some(u => u.includes("/journal_lines")), "no lines fetch when there are no entries");
  }));

// ── source: the 5 report fetchers no longer issue an unpaginated approved-entries fetch ──
test("TB / P&L / BS / periods use the paginated helper (no raw uncapped entries fetch)", () => {
  for (const f of ["trial_balance.js", "profit_loss.js", "balance_sheet.js", "periods.js"]) {
    const src = fs.readFileSync(path.resolve("modules/accounting", f), "utf8");
    assert.match(src, /fetchApprovedJournalLines\(/, `${f} must use fetchApprovedJournalLines`);
    assert.ok(!/journal_entries\?select=id[^`]*status=eq\.approved`/.test(src),
      `${f} must not keep a raw, unpaginated approved-entries fetch`);
  }
});

test("export_bundle paginates its 3 journal fetches via fetchAllRowsRaw", () => {
  const src = fs.readFileSync(path.resolve("modules/accounting/export_bundle.js"), "utf8");
  const n = (src.match(/fetchAllRowsRaw\(/g) || []).length;
  assert.ok(n >= 3, "export_bundle must paginate periodEntries + cumEntries + lines");
  assert.ok(!/await \(await fetch\(`\$\{cfg\.url\}\/rest\/v1\/journal_entries\?select/.test(src),
    "no raw unpaginated journal_entries fetch left in export_bundle");
});
