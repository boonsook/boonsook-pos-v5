// Phase 92.17 — Unit tests for accounting/sale_trace.js (forward accounting trace)
// Covers: findJournalForSale found/missing/error/invalid + renderSaleTraceBadge
//         (found is clickable w/ route+jv-id, missing/error never silent)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { findJournalForSale, renderSaleTraceBadge, JOURNAL_ROUTE, saleIdFromAuditLog, navigateToJv } =
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

// ── saleIdFromAuditLog (Phase 92.18 — safe sale id extraction, no guessing) ──

test("saleIdFromAuditLog — delete_sale row w/ entity_type 'sale' → returns id (string)", () => {
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", entity_type: "sale", entity_id: 143 }), "143");
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", entity_type: "sale", entity_id: "143" }), "143");
});

test("saleIdFromAuditLog — receipt deletion (entity_type 'receipt') → null (not a sale key)", () => {
  // receipt JV is source_table='receipts' — must NOT be looked up with sales key
  assert.equal(saleIdFromAuditLog({ action: "delete_receipt", entity_type: "receipt", entity_id: 9 }), null);
});

test("saleIdFromAuditLog — missing entity_id → null", () => {
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", entity_type: "sale", entity_id: null }), null);
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", entity_type: "sale", entity_id: "" }), null);
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", entity_type: "sale" }), null);
});

test("saleIdFromAuditLog — NEVER guesses from summary/bill_no (no entity_type) → null", () => {
  assert.equal(saleIdFromAuditLog({ action: "delete_sale", summary: "ลบบิลขาย BSK-00123 (5000 บาท)", metadata: { bill_no: "BSK-00123" } }), null);
});

test("saleIdFromAuditLog — null/garbage input → null, no throw", () => {
  assert.equal(saleIdFromAuditLog(null), null);
  assert.equal(saleIdFromAuditLog(undefined), null);
  assert.equal(saleIdFromAuditLog({}), null);
});

// ── end-to-end: a delete_sale log row → trace lookup (found/missing/error, no crash) ──

test("audit-log trace flow — sale id from log → findJournalForSale FOUND", async () => {
  const row = { action: "delete_sale", entity_type: "sale", entity_id: 77 };
  const saleId = saleIdFromAuditLog(row);
  assert.equal(saleId, "77");
  const fetchMock = async (url) => {
    assert.match(url, /source_table=eq\.sales&source_id=eq\.77/);
    return makeRes(200, [{ id: 9, doc_no: "SV2026050077", status: "approved" }]);
  };
  const res = await findJournalForSale(saleId, { fetch: fetchMock, cfg: CFG, token: "jwt" });
  assert.equal(res.found, true);
  assert.match(renderSaleTraceBadge(res, { compact: true }), /SV2026050077/);
});

test("audit-log trace flow — MISSING JV → 'ยังไม่ลงบัญชี', no crash", async () => {
  const saleId = saleIdFromAuditLog({ entity_type: "sale", entity_id: 5 });
  const res = await findJournalForSale(saleId, { fetch: async () => makeRes(200, []), cfg: CFG, token: "jwt" });
  assert.equal(res.status, "missing");
  assert.match(renderSaleTraceBadge(res, { compact: true }), /ยังไม่ลงบัญชี/);
});

test("audit-log trace flow — fetch error → 'ตรวจบัญชีไม่ได้', never throws", async () => {
  const saleId = saleIdFromAuditLog({ entity_type: "sale", entity_id: 5 });
  const res = await findJournalForSale(saleId, { fetch: async () => { throw new Error("offline"); }, cfg: CFG, token: "jwt" });
  assert.equal(res.ok, false);
  assert.match(renderSaleTraceBadge(res, { compact: true }), /ตรวจบัญชีไม่ได้/);
});

// ── navigateToJv (Phase 92.20 deep-link) ─────────────────────

test("navigateToJv — happy path: set pending id + call showRoute(accounting_journals)", async () => {
  const calls = { setPendingJvId: [], showRoute: [] };
  const fakeMod = { setPendingJvId: (id) => calls.setPendingJvId.push(id) };
  const ok = await navigateToJv(42, {
    showRoute: (r) => calls.showRoute.push(r),
    importModule: async () => fakeMod,
  });
  assert.equal(ok, true);
  assert.deepEqual(calls.setPendingJvId, [42]);
  assert.deepEqual(calls.showRoute, [JOURNAL_ROUTE]); // ★ ใช้ route constant เดิม ไม่ hardcode
});

test("navigateToJv — string id (data attribute) ก็ใช้ได้ — ไม่ cast เป็น number", async () => {
  const got = { id: null, route: null };
  const ok = await navigateToJv("123", {
    showRoute: (r) => { got.route = r; },
    importModule: async () => ({ setPendingJvId: (id) => { got.id = id; } }),
  });
  assert.equal(ok, true);
  assert.equal(got.id, "123"); // pass-through ให้ journals.js cast เอง (String() ฝั่งโน้น)
  assert.equal(got.route, "accounting_journals");
});

test("navigateToJv — null/empty id → false, no navigate", async () => {
  let routed = false;
  const opts = { showRoute: () => { routed = true; }, importModule: async () => ({ setPendingJvId: () => {} }) };
  assert.equal(await navigateToJv(null, opts), false);
  assert.equal(await navigateToJv("", opts), false);
  assert.equal(await navigateToJv(undefined, opts), false);
  assert.equal(routed, false);
});

test("navigateToJv — no showRoute available → false (ไม่ throw, ไม่ silent crash)", async () => {
  // ไม่ inject showRoute + window.App ไม่มี (jsdom env) → ต้องคืน false ไม่ throw
  const ok = await navigateToJv(7, { importModule: async () => ({ setPendingJvId: () => {} }) });
  assert.equal(ok, false);
});

test("navigateToJv — journals module import fail → ยัง navigate (fallback, ไม่ crash)", async () => {
  // ถ้า dynamic import ล้ม (offline/CSP) → ไม่ deep-link แต่ navigate ปกติ ห้าม block
  let routed = null;
  const ok = await navigateToJv(99, {
    showRoute: (r) => { routed = r; },
    importModule: async () => { throw new Error("module load fail"); },
  });
  assert.equal(ok, true); // navigate ผ่าน
  assert.equal(routed, JOURNAL_ROUTE);
});

test("navigateToJv — setPendingJvId optional (mod ไม่มี method) → ไม่ throw", async () => {
  // กันกรณี future refactor — sale_trace.js ต้อง tolerant
  let routed = null;
  const ok = await navigateToJv(8, {
    showRoute: (r) => { routed = r; },
    importModule: async () => ({}), // ไม่มี setPendingJvId
  });
  assert.equal(ok, true);
  assert.equal(routed, JOURNAL_ROUTE);
});
