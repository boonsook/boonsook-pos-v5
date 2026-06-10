// Phase 89.18 — Unit tests for auto_post.js
// Covers: M1 voidJvForSource silent-fail detection (Phase 89.16) + effective date guard
// Run: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { round2 } from "../modules/utils.js";

// Setup global window before importing auto_post (module reads window at call-time, not import-time)
globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,         // overwritten per test
  App: { showToast: () => {} },
};

// Suppress noisy console.error / console.info inside voidJvForSource
const _origErr = console.error;
const _origInfo = console.info;
console.error = () => {};
console.info = () => {};

const { voidJvForSource, _isAfterEffective, splitSaleVatLines } = await import("../modules/accounting/auto_post.js");

function makeRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockAuthFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (queue.length === 0) throw new Error("queue exhausted: " + url);
    const next = queue.shift();
    if (typeof next === "function") return next(url, init);
    return next;
  };
  fn.calls = calls;
  fn.remaining = () => queue.length;
  return fn;
}

let toasts = [];
beforeEach(() => {
  toasts = [];
  window.App.showToast = (msg) => toasts.push(msg);
});

// ═══════════════════════════════════════════════════════════
//  voidJvForSource — Phase 89.16 (M1) silent-fail detection
// ═══════════════════════════════════════════════════════════

test("voidJv — happy path: pre-check 2 rows, DELETE returns 2, no toast", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 1 }, { id: 2 }]),         // pre-check count
    makeRes(200, [{ id: 1 }, { id: 2 }]),         // DELETE returning rows
  ]);
  const count = await voidJvForSource("sales", 42);
  assert.equal(count, 2);
  assert.equal(toasts.length, 0, "no warning toast on success");
});

test("voidJv — silent fail: pre-check finds 1 row but DELETE returns 0 rows → toast + return 0 (M1 fix)", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 99 }]),                   // pre-check: 1 JV exists
    makeRes(200, []),                              // DELETE: RLS blocked → 0 deleted (silent fail)
  ]);
  const count = await voidJvForSource("sales", 99);
  assert.equal(count, 0, "must report 0 to caller");
  assert.equal(toasts.length, 1, "must warn user about RLS silent fail");
  assert.match(toasts[0], /ลบไม่ได้|RLS|manually/);
});

test("voidJv — no JV exists: pre-check 0 rows, DELETE 0 rows → no toast (legitimate empty)", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, []),                              // pre-check: nothing
    makeRes(200, []),                              // DELETE: nothing
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 0);
  assert.equal(toasts.length, 0, "empty + empty is not a silent fail");
});

test("voidJv — DELETE HTTP error: returns 0, toast if expected>0", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 5 }]),                    // pre-check: 1 JV
    makeRes(500, null),                            // DELETE fails
  ]);
  const count = await voidJvForSource("sales", 5);
  assert.equal(count, 0);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /HTTP 500|ลบ JV/);
});

test("voidJv — DELETE HTTP error with no pre-existing JV: no toast", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, []),                              // pre-check: 0
    makeRes(500, null),                            // DELETE fails
  ]);
  const count = await voidJvForSource("sales", 5);
  assert.equal(count, 0);
  assert.equal(toasts.length, 0, "no warning when there was nothing to delete");
});

test("voidJv — missing args: returns 0 without any fetch", async () => {
  const fetcher = mockAuthFetch([]);
  window._appAuthFetch = fetcher;
  assert.equal(await voidJvForSource("", 1), 0);
  assert.equal(await voidJvForSource("sales", null), 0);
  assert.equal(await voidJvForSource(null, null), 0);
  assert.equal(fetcher.calls.length, 0, "no network call for bad args");
});

test("voidJv — sourceTable URL-encoded in filter (prevent injection)", async () => {
  let capturedUrl;
  window._appAuthFetch = mockAuthFetch([
    (url) => { capturedUrl = url; return makeRes(200, []); },
    makeRes(200, []),
  ]);
  await voidJvForSource("sales&injected=eq.true", 1);
  assert.match(capturedUrl, /source_table=eq\.sales%26injected%3Deq\.true/);
});

test("voidJv — pre-check exception is non-fatal, DELETE still runs", async () => {
  // pre-check throws (network error during count) — should fall through to DELETE
  window._appAuthFetch = mockAuthFetch([
    new Error("ECONNRESET"),
    makeRes(200, [{ id: 1 }]),
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 1, "DELETE proceeds even if pre-check failed");
});

test("voidJv — DELETE exception caught, returns 0", async () => {
  window._appAuthFetch = mockAuthFetch([
    makeRes(200, [{ id: 1 }]),
    new Error("socket hang up"),
  ]);
  const count = await voidJvForSource("sales", 1);
  assert.equal(count, 0);
});

// ═══════════════════════════════════════════════════════════
//  _isAfterEffective — ACCOUNTING_EFFECTIVE_DATE = 2026-07-01 (Phase 413: เริ่มบัญชีจริง 1 ก.ค. 2569)
// ═══════════════════════════════════════════════════════════

test("_isAfterEffective — date >= 2026-07-01 returns true", () => {
  assert.equal(_isAfterEffective("2026-07-01"), true);
  assert.equal(_isAfterEffective("2026-07-13"), true);
  assert.equal(_isAfterEffective("2026-12-31"), true);
  assert.equal(_isAfterEffective("2027-01-01"), true);
});

test("_isAfterEffective — date < 2026-07-01 returns false (mock/test data)", () => {
  assert.equal(_isAfterEffective("2026-06-30"), false);
  assert.equal(_isAfterEffective("2026-05-01"), false);  // cutoff เดิม (88.18b) — ตอนนี้ pre-effective แล้ว
  assert.equal(_isAfterEffective("2026-01-01"), false);
  assert.equal(_isAfterEffective("2025-12-31"), false);
});

test("_isAfterEffective — null/undefined/empty → false", () => {
  assert.equal(_isAfterEffective(null), false);
  assert.equal(_isAfterEffective(undefined), false);
  assert.equal(_isAfterEffective(""), false);
  assert.equal(_isAfterEffective(0), false);
});

test("_isAfterEffective — ISO timestamp slice(0,10) extracts date part correctly", () => {
  assert.equal(_isAfterEffective("2026-07-01T00:00:00Z"), true);
  assert.equal(_isAfterEffective("2026-06-30T23:59:59Z"), false);
  assert.equal(_isAfterEffective("2026-07-13T15:30:00+07:00"), true);
});

// Restore console after all tests
process.on("beforeExit", () => {
  console.error = _origErr;
  console.info = _origInfo;
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.46 — Auto-Journal RLS Re-apply + Tighten + Integrity Views
// ═══════════════════════════════════════════════════════════

test("source: Phase 92.46 SQL — re-applies je_insert_auto + jl_insert_auto policies (rerun-safe)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  // DROP IF EXISTS pattern (rerun-safe)
  assert.match(src, /DROP POLICY IF EXISTS "je_admin"\s+ON public\.journal_entries/);
  assert.match(src, /DROP POLICY IF EXISTS "je_insert_auto"\s+ON public\.journal_entries/);
  assert.match(src, /DROP POLICY IF EXISTS "jl_insert_auto"\s+ON public\.journal_lines/);
  // CREATE policies
  assert.match(src, /CREATE POLICY "je_select"[\s\S]{0,200}?FOR SELECT TO authenticated/);
  assert.match(src, /CREATE POLICY "je_insert_auto"[\s\S]{0,200}?FOR INSERT TO authenticated/);
  assert.match(src, /CREATE POLICY "jl_insert_auto"[\s\S]{0,200}?FOR INSERT TO authenticated/);
});

test("source: Phase 92.46 SQL — je_insert_auto WITH CHECK ต้องมี source_table whitelist 8 ตัว", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  // จับ block ของ je_insert_auto WITH CHECK
  const m = src.match(/CREATE POLICY "je_insert_auto"[\s\S]*?WITH CHECK\s*\(([\s\S]*?)\);/);
  assert.ok(m, "ต้องเจอ je_insert_auto WITH CHECK clause");
  const clause = m[1];
  // is_accountant() OR
  assert.match(clause, /public\.is_accountant\(\)/, "ต้องมี is_accountant() bypass");
  assert.match(clause, /source_table IS NOT NULL/, "ต้องเช็ค source_table IS NOT NULL");
  assert.match(clause, /source_id\s+IS NOT NULL/, "ต้องเช็ค source_id IS NOT NULL");
  // Whitelist 8 ตัวที่ auto_post.js ใช้จริง
  for (const t of ["sales", "expenses", "staff_payroll", "service_jobs", "receipts", "delivery_invoices", "credit_payments", "refunds"]) {
    assert.match(clause, new RegExp(`'${t}'`), `whitelist ต้องมี '${t}'`);
  }
});

test("source: Phase 92.46 SQL — jl_insert_auto WITH CHECK validate parent entry whitelist", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  const m = src.match(/CREATE POLICY "jl_insert_auto"[\s\S]*?WITH CHECK\s*\(([\s\S]*?)\);/);
  assert.ok(m, "ต้องเจอ jl_insert_auto WITH CHECK");
  const clause = m[1];
  assert.match(clause, /EXISTS \(\s*SELECT 1 FROM public\.journal_entries/, "ต้อง EXISTS subquery บน journal_entries");
  assert.match(clause, /je\.source_table IN \(/, "subquery ต้องเช็ค source_table whitelist");
  // sanity 2 ตัวอย่าง
  assert.match(clause, /'sales'/);
  assert.match(clause, /'staff_payroll'/);
});

test("source: Phase 92.46 SQL — 3 integrity views (sales/expenses/payroll without journal)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  // 3 VIEWs
  for (const v of ["vw_sales_without_journal", "vw_expenses_without_journal", "vw_payroll_without_journal"]) {
    assert.match(src, new RegExp(`CREATE OR REPLACE VIEW public\\.${v}\\b`), `ต้องมี view ${v}`);
  }
  // payroll view ต้อง filter paid_at IS NOT NULL (กัน unpaid payroll ถูกนับเป็น orphan)
  const payrollView = src.match(/CREATE OR REPLACE VIEW public\.vw_payroll_without_journal\s+AS([\s\S]*?);/)?.[1] || "";
  assert.match(payrollView, /WHERE p\.paid_at IS NOT NULL/, "payroll view ต้องนับเฉพาะ paid (paid_at IS NOT NULL)");
  // ใช้ NOT EXISTS pattern กัน join cartesian
  assert.match(payrollView, /NOT EXISTS \(/);
});

test("source: Phase 92.46 SQL — RPC accounting_integrity_summary admin-only + GRANT authenticated + NOTIFY", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  // Function exists
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.accounting_integrity_summary\(\)/);
  assert.match(src, /RETURNS jsonb/);
  // Admin guard
  assert.match(src, /accounting_integrity_summary[\s\S]{0,800}?IF NOT public\.is_accountant\(\)/, "RPC ต้อง guard admin-only");
  // jsonb_build_object includes 3 view counts + checked_at
  assert.match(src, /'sales_without_journal'/, "summary ต้องมี sales_without_journal key");
  assert.match(src, /'expenses_without_journal'/);
  assert.match(src, /'payroll_without_journal'/);
  assert.match(src, /'checked_at'/);
  // GRANT
  assert.match(src, /GRANT EXECUTE ON FUNCTION public\.accounting_integrity_summary\(\)[\s\S]{0,100}?TO authenticated/);
  // NOTIFY pgrst
  assert.match(src, /NOTIFY pgrst, 'reload schema'/);
});

test("source: Phase 92.46 SQL — whitelist ตรงกับ sourceTable ที่ auto_post.js ใช้จริง (drift guard)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sql = fs.readFileSync(path.resolve("supabase-phase92-46-je-rls-rerun-and-tighten.sql"), "utf8");
  const js  = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  // ดึง sourceTable: "..." จาก JS
  const jsTables = new Set();
  for (const m of js.matchAll(/sourceTable:\s*"([a-z_]+)"/g)) jsTables.add(m[1]);
  assert.ok(jsTables.size >= 6, `auto_post.js ต้องมีอย่างน้อย 6 sourceTable values, เจอ ${jsTables.size}`);
  // ทุก sourceTable ใน JS ต้องอยู่ใน SQL whitelist
  for (const t of jsTables) {
    assert.match(sql, new RegExp(`'${t}'`), `SQL whitelist ขาด '${t}' ที่ auto_post.js ใช้`);
  }
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.64 — VAT split balance (splitSaleVatLines)
// ═══════════════════════════════════════════════════════════

// balance = Cr (subtotal+vat) ตรงกับ Dr (total) ภายใน satang — ใช้ round2 กัน float epsilon
const balanced = (v) => assert.equal(round2(v.subtotal + v.vat), v.total);

test("splitSaleVatLines — inclusive 7%: total=100, vat=6.54 → subtotal=93.46, Σcredit=100", () => {
  const v = splitSaleVatLines(100, 6.54);
  assert.equal(v.total, 100);
  assert.equal(v.vat, 6.54);
  assert.equal(v.subtotal, 93.46);
  balanced(v); // Dr === Cr
});

test("splitSaleVatLines — exclusive/basic: total=107, vat=7 → subtotal=100, Σcredit=107", () => {
  const v = splitSaleVatLines(107, 7);
  assert.equal(v.subtotal, 100);
  balanced(v);
});

test("splitSaleVatLines — drift case: total=100, vat=6.5421 → vat=6.54, subtotal=93.46, sum=100 (เดิมพัง)", () => {
  const v = splitSaleVatLines(100, 6.5421);
  assert.equal(v.vat, 6.54);
  assert.equal(v.subtotal, 93.46);
  balanced(v); // ไม่ drift อีก
});

test("splitSaleVatLines — tiny/rounding edge: total=99.99, vat=6.54 → subtotal=93.45, sum=99.99", () => {
  const v = splitSaleVatLines(99.99, 6.54);
  assert.equal(v.subtotal, 93.45);
  balanced(v); // 93.45 + 6.54 (float = 99.990000001) → round2 = 99.99 = total
});

test("splitSaleVatLines — float-noisy input ยัง balance ภายใน satang (total≈100.01, vat=6.54)", () => {
  const v = splitSaleVatLines(100.1 - 0.09, 6.54); // ~100.01
  balanced(v);
  assert.ok(Math.abs((v.subtotal + v.vat) - v.total) < 0.01, "ต้อง balance ภายใน 0.01 (ผ่าน guard เสมอ)");
});

test("source: postJournalForSale VAT split ใช้ splitSaleVatLines + balance guard ยังอยู่", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  // ใช้ helper ใน VAT split (ไม่ใช้ subtotalBeforeVat/vatAmount ดิบใน lines แล้ว)
  assert.match(src, /const v = splitSaleVatLines\(amount, vatAmount\)/, "VAT split ต้องเรียก helper");
  assert.match(src, /credit: v\.subtotal/, "Cr revenue = v.subtotal (derived)");
  assert.match(src, /credit: v\.vat/, "Cr VAT = v.vat");
  assert.match(src, /debit: v\.total/, "Dr = v.total");
  // balance guard ใน _postJournal ยังอยู่
  assert.match(src, /Math\.abs\(totalDebit - totalCredit\) > 0\.01/, "balance guard ต้องคงอยู่");
});

test("source: vatAmount=0 ยังใช้ 2-line path เดิม (Dr=Cr=amount) + refund ยัง Dr4110/Cr balanced", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
  // 2-line sale path เดิม (ไม่มี VAT) ยังอยู่ — ใช้ marker ที่ stable (ไม่พึ่ง multi-space)
  assert.match(src, /ไม่มี VAT — JV ปกติ 2 บรรทัด/, "comment 2-line path เดิมต้องคงอยู่");
  assert.match(src, /debit: amount, credit: 0,/, "non-VAT Dr line = amount ยังอยู่");
  assert.match(src, /credit: amount, description: desc/, "non-VAT Cr line = amount ยังอยู่");
  // refund: Dr 4110 / Cr cash — ไม่ถูกแตะ (2-line, balanced)
  assert.match(src, /Dr 4110/, "refund mapping doc comment ยังอยู่");
  assert.match(src, /postJournalForRefund/, "refund function ยังอยู่");
});
