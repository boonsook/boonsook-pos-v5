// Phase 606-b1 (review #4) — render path จริง: ledger ตรวจไม่ได้ = ห้ามการ์ดเขียว
// Run: node --test tests/service_reconcile_render_guard.test.js
//
// false-green คือบั๊กที่อันตรายที่สุดของหน้านี้: ผู้ดูแลเห็น "✅ ไม่พบปัญหา" ทั้งที่ระบบ
// ตรวจ ledger ไม่ได้เลย (ชน limit / 500 / 403 / ตารางยังไม่มี / JSON เพี้ยน / lines โหลดไม่ได้)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// ── fake DOM เล็กที่สุดที่ render path ต้องใช้ ──────────────────────────────
class El {
  constructor() { this.innerHTML = ""; }
  querySelectorAll() { return []; }
  get isConnected() { return true; }
}
const container = new El();
globalThis.document = {
  body: { contains: () => true },
  createElement: () => ({ set textContent(v) { this._t = String(v ?? ""); }, get innerHTML() { return String(this._t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }),
  getElementById: () => container
};
globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} }
};
console.error = () => {}; console.info = () => {}; console.warn = () => {};

const RECON = await import("../modules/service_reconcile.js");
const V = await import("../modules/accounting/service_jv_validate.js");
const { postJournalForServicePayment, resetMappingCache } = await import("../modules/accounting/auto_post.js");

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bad = (status, body = null) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });

const MAPPING = { mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200",
                  transfer_debit_code: "1136", recognition_debit_code: "1200", is_active: true };

const GREEN = "ไม่พบงานปิดแล้วที่ยังไม่เข้าบัญชี";
const toasts = [];
const ctx = { showToast: (m) => toasts.push(m) };

// service side สะอาดเสมอ — ตัวแปรคือฝั่ง ledger
function installFetch({ payments = [], reversals = [], jeLedger = [], lines = [], failOn = null, failStatus = 500, badJson = false } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (failOn && u.includes(failOn)) return bad(failStatus, { message: "boom" });
    if (u.includes("/service_jobs?select=")) return ok([]);                              // ไม่มีงานค้าง
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) return ok([]);
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    if (u.includes("/service_payments?select=")) return badJson ? ok({ oops: true }) : ok(payments);
    if (u.includes("/service_payment_reversals?select=")) return ok(reversals);
    if (u.includes("/journal_entries?source_table=in.")) return ok(jeLedger);
    if (u.includes("/journal_lines?select=")) return ok(lines);
    return ok([]);
  };
}
beforeEach(() => { container.innerHTML = ""; toasts.length = 0; installFetch(); });

// ═══════════════════════════════════════════════════════════
//  A. ledger ตรวจไม่ได้ → ห้ามเขียว (blocking 1)
// ═══════════════════════════════════════════════════════════
test("A1. payments ชน limit (5000) → ไม่มีการ์ดเขียว · แสดง LEDGER_UNAVAILABLE + DATA_INCOMPLETE ค้างบนหน้า", async () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, service_job_id: 20, amount: 1, payment_method: "cash" }));
  installFetch({ payments: many });
  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN), "ห้ามขึ้นการ์ดเขียวเมื่อ ledger ตรวจไม่ครบ");
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
  assert.match(container.innerHTML, /DATA_INCOMPLETE/);
});

test("A2. journal_lines ชน limit (20000) → ไม่มีการ์ดเขียว", async () => {
  const je = [{ id: 1, source_table: "service_payments", source_id: 1, status: "approved", total_debit: 1, total_credit: 1 }];
  const lines = Array.from({ length: 20000 }, () => ({ entry_id: 1, account_code: "1110", debit: 1, credit: 0 }));
  installFetch({ payments: [{ id: 1, service_job_id: 20, amount: 1, payment_method: "cash" }], jeLedger: je, lines });
  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN));
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
});

test("A3. service_payments HTTP 500 / 403 → ไม่มีการ์ดเขียว", async () => {
  for (const status of [500, 403]) {
    container.innerHTML = "";
    installFetch({ failOn: "/service_payments?select=", failStatus: status });
    await RECON._loadAndRender(ctx, container);
    assert.ok(!container.innerHTML.includes(GREEN), `HTTP ${status} ต้องไม่เขียว`);
    assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
  }
});

test("A4. ตาราง ledger ยังไม่มี (404 / PGRST205 ก่อน migration) → 'ยังตรวจ ledger ไม่ได้' ไม่ใช่ clean", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_payments?select=") || u.includes("/service_payment_reversals?select=")) {
      return bad(404, { code: "PGRST205", message: "Could not find the table 'public.service_payments'" });
    }
    if (u.includes("/service_jobs?select=")) return ok([]);
    if (u.includes("/journal_entries")) return ok([]);
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    return ok([]);
  };
  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN), "ก่อน migration ก็ห้ามตีเป็นสะอาด");
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
});

test("A5. JSON ผิดรูปแบบ (ไม่ใช่ array) → ไม่มีการ์ดเขียว", async () => {
  installFetch({ badJson: true });
  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN));
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
});

test("A6. service ok + ledger ok + ทุกกองว่าง → การ์ดเขียวได้ (ของจริงเท่านั้น)", async () => {
  installFetch();     // ledger ว่างเปล่าและโหลดสำเร็จ
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, new RegExp(GREEN));
  assert.ok(!container.innerHTML.includes("LEDGER_UNAVAILABLE"));
});

test("A7. ledger โหลดได้แต่มีปัญหา (PAYMENT_NO_JV) → ไม่เขียว · โชว์ปุ่มซ่อม", async () => {
  installFetch({ payments: [{ id: 5, service_job_id: 20, amount: 100, payment_method: "cash" }] });
  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN));
  assert.match(container.innerHTML, /PAYMENT_NO_JV/);
  assert.match(container.innerHTML, /svc-recon-ledger-retry/);
});

// ═══════════════════════════════════════════════════════════
//  B. missing numeric field → fail-closed (blocking 2)
// ═══════════════════════════════════════════════════════════
const entry = { status: "approved", total_debit: 500, total_credit: 500 };
const payment = { id: 501, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134", paid_at: "2026-07-09T03:00:00Z" };
const mapping = MAPPING;

test("B1. Dr line ไม่มี property credit → bad-number", () => {
  const out = V.validatePaymentJv({ payment, mapping, entry,
    lines: [{ account_code: "1134", debit: 500 }, { account_code: "1200", debit: 0, credit: 500 }] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, V.JV_BAD_NUMBER);
});

test("B2. Cr line ไม่มี property debit → bad-number", () => {
  const out = V.validatePaymentJv({ payment, mapping, entry,
    lines: [{ account_code: "1134", debit: 500, credit: 0 }, { account_code: "1200", credit: 500 }] });
  assert.equal(out.reason, V.JV_BAD_NUMBER);
});

test("B3. ทั้งสอง field มีจริง (ฝั่งว่าง = 0) → ผ่าน", () => {
  const out = V.validatePaymentJv({ payment, mapping, entry,
    lines: [{ account_code: "1134", debit: 500, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] });
  assert.equal(out.ok, true);
});

test("B4. malformed read-back (field หาย) ห้ามกลายเป็น duplicate-valid", async () => {
  resetMappingCache();
  const recogLines = [{ account_code: "1200", debit: 1000, credit: 0 }, { account_code: "4200", debit: 0, credit: 1000 }];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    if (u.includes("/chart_of_accounts")) return ok(["1110", "1134", "1200", "4200"].map(code => ({ code })));
    if (u.includes("/accounting_periods")) return ok([]);
    if (u.includes("/journal_entries?select=doc_no")) return ok([]);
    if (u.includes("/service_payments?select=")) return ok([payment]);
    if (u.includes("/service_jobs?select=")) return ok([{ id: 20, job_no: "JOB-20", job_type: "ac", total_cost: 1000, finance_flow_version: 2 }]);
    if (u.includes("source_table=eq.service_jobs")) return ok([{ id: 11, status: "approved", total_debit: 1000, total_credit: 1000 }]);
    if (u.includes("source_table=eq.service_payments")) return ok([{ id: 22, status: "approved", total_debit: 500, total_credit: 500 }]);
    if (u.includes("/journal_lines?select=account_code")) {
      const id = /entry_id=eq\.(\d+)/.exec(u)?.[1];
      if (id === "11") return ok(recogLines);
      // ★ read-back ของ payment JV: บรรทัด Dr ขาด property credit (ข้อมูลมาไม่ครบ)
      return ok([{ account_code: "1134", debit: 500 }, { account_code: "1200", debit: 0, credit: 500 }]);
    }
    return ok([]);
  };
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") {
      return { ok: false, status: 409, json: async () => null, text: async () => '{"code":"23505","message":"idx_je_source_unique"}' };
    }
    return globalThis.fetch(url, init);
  };
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.reason, "duplicate-invalid:bad-number", "อ่านข้อมูลมาไม่ครบ = ห้ามบอกว่า JV เดิมถูกต้อง");
});

// ═══════════════════════════════════════════════════════════
//  C. toast ของปุ่มซ่อม ledger (should-fix)
// ═══════════════════════════════════════════════════════════
test("C1. toast: posted = สำเร็จ · duplicate-valid = มีอยู่แล้วถูกต้อง · duplicate-invalid = conflict (ห้ามบอกว่าสำเร็จ)", () => {
  const file = fs.readFileSync("modules/service_reconcile.js", "utf8");
  // ★ review#5: policy ย้ายไป shared helper — ทั้งสองปุ่มเรียก jvResultToToast ตัวเดียวกัน
  assert.equal((file.match(/jvResultToToast\(res\)\.message/g) || []).length, 2);
  const helper = fs.readFileSync("modules/accounting/service_jv_validate.js", "utf8");
  assert.match(helper, /duplicate-valid[\s\S]{0,160}มีรายการบัญชีที่ถูกต้องอยู่แล้ว/);
  assert.match(helper, /startsWith\("duplicate-invalid:"\)[\s\S]{0,200}ต้องตรวจบัญชีด้วยคน/);
  assert.ok(!/duplicate-invalid[\s\S]{0,80}✅/.test(helper), "duplicate-invalid ห้ามแจ้งว่าสำเร็จ");
});
