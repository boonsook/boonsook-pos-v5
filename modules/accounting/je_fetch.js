// modules/accounting/je_fetch.js — Phase 496 (audit รอบ2 #2): paginated approved-JE line fetch.
//
// Trial Balance / P&L / Balance Sheet / period summaries aggregated journal_entries + journal_lines
// with NO pagination. PostgREST caps a response at 1000 rows by default, so once approved JV in the
// window exceeded 1000 the entries (or a chunk's lines) were silently dropped → Trial Balance
// "Dr ≠ Cr", Balance Sheet not balancing, P&L understated. (Balance Sheet is cumulative from
// 2026-07-01, so it crosses 1000 first.) This paginates BOTH the entry-id fetch AND each id-chunk's
// lines. Throws on any error — financial path, never a silent partial.
import { fetchAllRowsRaw } from "../fetch_paginated.js";

function _conn() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return null;
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  return { url: cfg.url, headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } };
}

// All journal_lines of APPROVED entries whose doc_date is in [from, to]. Paginated end-to-end.
// lineSelect = the journal_lines columns to pull (default = what TB/PL/BS/periods need).
export async function fetchApprovedJournalLines(from, to, lineSelect = "account_code,debit,credit") {
  const c = _conn();
  if (!c) throw new Error("ไม่พบการตั้งค่าเซิร์ฟเวอร์");

  // 1) all approved entry ids in range — paginated (order by PK for stable offset paging)
  const entries = await fetchAllRowsRaw(
    (off, lim) => `${c.url}/rest/v1/journal_entries?select=id&doc_date=gte.${from}&doc_date=lte.${to}&status=eq.approved&order=id.asc&limit=${lim}&offset=${off}`,
    c.headers
  );
  const ids = entries.map(e => e.id);
  if (!ids.length) return [];

  // 2) their lines — chunk ids by 200 (URL length on entry_id=in.(...)) AND paginate each chunk
  const lines = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).join(",");
    const part = await fetchAllRowsRaw(
      (off, lim) => `${c.url}/rest/v1/journal_lines?select=${lineSelect}&entry_id=in.(${chunk})&order=entry_id.asc,line_no.asc&limit=${lim}&offset=${off}`,
      c.headers
    );
    lines.push(...part);
  }
  return lines;
}
