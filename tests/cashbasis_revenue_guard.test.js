// Phase 408 — Cash-basis revenue guard
// รับรู้รายได้สายเครดิตที่ใบเสร็จ paid (Dr cash/Cr 4150) — เลิกลง revenue ตอนออกใบส่งของ
//
// Covers:
//   - postJournalForDeliveryInvoice(...) → return null (ไม่ post; ไม่เรียก fetch/_postJournal)
//   - postJournalForReceipt paid + vat=0  → 2 บรรทัด Dr 1110 / Cr 4150 (เต็มยอด)
//   - postJournalForReceipt paid + transfer → Dr 1130 / Cr 4150
//   - postJournalForReceipt paid + vat>0  → 3 บรรทัด (Dr full / Cr 4150 subtotal / Cr 2170 vat), Σdebit===Σcredit
//   - postJournalForReceipt pending/partial → return null
//   - source-regex quotations.js: ไม่มีการเรียก postJournalForDeliveryInvoice แล้ว
// Run: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Setup global window before importing auto_post (module reads window at call-time)
globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} },
};

// Suppress noisy console
console.error = () => {};
console.info = () => {};
console.warn = () => {};

const { postJournalForReceipt, postJournalForDeliveryInvoice, resetMappingCache } =
  await import("../modules/accounting/auto_post.js");

function makeRes(status, body, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

// account_mapping rows ที่ Phase 408 SQL จะ insert (mock DB)
const MAPPINGS = [
  { mapping_key: "receipt_revenue_cash",     debit_account_code: "1110", credit_account_code: "4150", is_active: true },
  { mapping_key: "receipt_revenue_transfer", debit_account_code: "1130", credit_account_code: "4150", is_active: true },
];

// Router for window.fetch (mappings / period-check / doc_no-seq)
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) return makeRes(200, MAPPINGS);
    if (u.includes("/accounting_periods")) return makeRes(200, []);           // ไม่ locked
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []); // seq = 1
    return makeRes(200, []);
  };
}

// _appAuthFetch: capture journal_lines POST body, return ok for entry/lines
function installAuthFetch() {
  const captured = { lines: null };
  globalThis.window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      return makeRes(201, [{ id: 9999 }]);   // entry created
    }
    if (u.includes("/journal_lines") && init?.method === "POST") {
      captured.lines = JSON.parse(init.body);
      return makeRes(201, [], "");
    }
    return makeRes(200, []);
  };
  return captured;
}

beforeEach(() => {
  resetMappingCache();
  installFetch();
});

// ═══════════════════════════════════════════════════════════
//  postJournalForDeliveryInvoice — Phase 408: no-op
// ═══════════════════════════════════════════════════════════
test("delivery invoice → return null, ไม่เรียก fetch เลย (no revenue post)", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return makeRes(200, []); };
  let authCalled = false;
  globalThis.window._appAuthFetch = async () => { authCalled = true; return makeRes(200, []); };

  const res = await postJournalForDeliveryInvoice({
    id: 1, inv_no: "INV001", grand_total: 1000, status: "pending",
    created_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, null, "ต้อง return null");
  assert.equal(fetchCalled, false, "ห้ามแตะ fetch (ไม่ post JV)");
  assert.equal(authCalled, false, "ห้ามแตะ _appAuthFetch (ไม่ post JV)");
});

// ═══════════════════════════════════════════════════════════
//  postJournalForReceipt — cash-basis
// ═══════════════════════════════════════════════════════════
test("receipt paid + เงินสด + vat=0 → 2 บรรทัด Dr 1110 / Cr 4150 เต็มยอด", async () => {
  const cap = installAuthFetch();
  const res = await postJournalForReceipt({
    id: 10, receipt_no: "RC010", status: "paid", grand_total: 1000,
    payment_method: "cash", vat_amount: 0, paid_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, 9999, "post สำเร็จ");
  assert.equal(cap.lines.length, 2, "2 บรรทัด");
  const dr = cap.lines.find(l => l.debit > 0);
  const cr = cap.lines.find(l => l.credit > 0);
  assert.equal(dr.account_code, "1110");
  assert.equal(dr.debit, 1000);
  assert.equal(cr.account_code, "4150");
  assert.equal(cr.credit, 1000);
});

test("receipt paid + โอน → Dr 1130 / Cr 4150", async () => {
  const cap = installAuthFetch();
  const res = await postJournalForReceipt({
    id: 11, receipt_no: "RC011", status: "paid", grand_total: 500,
    payment_method: "transfer", vat_amount: 0, paid_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, 9999);
  assert.equal(cap.lines.length, 2);
  assert.equal(cap.lines.find(l => l.debit > 0).account_code, "1130");
  assert.equal(cap.lines.find(l => l.credit > 0).account_code, "4150");
});

test("receipt paid + vat>0 → 3 บรรทัด (Dr full / Cr 4150 subtotal / Cr 2170 vat), Σdr===Σcr", async () => {
  const cap = installAuthFetch();
  // grand_total 1070 = subtotal 1000 + vat 70
  const res = await postJournalForReceipt({
    id: 12, receipt_no: "RC012", status: "paid", grand_total: 1070,
    payment_method: "cash", vat_amount: 70, vat_rate: 7, paid_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, 9999);
  assert.equal(cap.lines.length, 3, "3 บรรทัด");
  const dr = cap.lines.find(l => l.account_code === "1110");
  const rev = cap.lines.find(l => l.account_code === "4150");
  const vat = cap.lines.find(l => l.account_code === "2170");
  assert.equal(dr.debit, 1070, "Dr เต็มยอด");
  assert.equal(rev.credit, 1000, "Cr รายได้ = subtotal");
  assert.equal(vat.credit, 70, "Cr VAT");
  const sumDr = cap.lines.reduce((s, l) => s + l.debit, 0);
  const sumCr = cap.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(sumDr, sumCr, "Σdebit === Σcredit");
});

test("receipt pending → return null (ไม่ post)", async () => {
  const cap = installAuthFetch();
  const res = await postJournalForReceipt({
    id: 13, receipt_no: "RC013", status: "pending", grand_total: 1000,
    payment_method: "cash", paid_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, null);
  assert.equal(cap.lines, null, "ไม่มี lines ถูก post");
});

test("receipt partial → return null (Phase A2, ยังไม่ post)", async () => {
  const cap = installAuthFetch();
  const res = await postJournalForReceipt({
    id: 14, receipt_no: "RC014", status: "partial", grand_total: 1000,
    payment_method: "cash", paid_at: "2026-07-09T00:00:00Z",
  });
  assert.equal(res, null);
  assert.equal(cap.lines, null);
});

// ═══════════════════════════════════════════════════════════
//  source-regex: quotations.js ไม่เรียก postJournalForDeliveryInvoice แล้ว
// ═══════════════════════════════════════════════════════════
test("quotations.js: ไม่มีการเรียก postJournalForDeliveryInvoice( แล้ว (cash-basis)", () => {
  const src = readFileSync(join(__dirname, "../modules/quotations.js"), "utf8");
  // ตัด comment line ออกก่อน (เหลือเฉพาะโค้ดจริง) แล้วหา call pattern
  const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//"));
  const code = codeLines.join("\n");
  assert.ok(
    !/postJournalForDeliveryInvoice\s*\(/.test(code),
    "quotations.js ต้องไม่มี call postJournalForDeliveryInvoice( ในโค้ดจริง"
  );
});
