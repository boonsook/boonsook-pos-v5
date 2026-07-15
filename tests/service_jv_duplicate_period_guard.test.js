// Phase 606-b1 (review #3) — duplicate read-back · Bangkok period · noDate+JE · mapping freeze matrix
// Run: node --test tests/service_jv_duplicate_period_guard.test.js
//
// หัวใจ: "409 source-dup" ไม่ใช่หลักฐานว่าลงบัญชีถูก — JE ที่ค้างอยู่อาจเป็น draft / header ลอย /
//        บัญชีผิด / ยอดผิด. ต้อง read-back + validate ก่อนจะบอกว่า accountingPosted

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { projectRows } from "./_select_projection.js";  // ★ 606-b1.1: select-projection mock

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} },
};
console.error = () => {}; console.info = () => {}; console.warn = () => {};

const {
  postJournalForServiceJob, postJournalForServicePayment, postJournalForServicePaymentReversal,
  recordServicePayment, reverseServicePayment, resetMappingCache
} = await import("../modules/accounting/auto_post.js");
const RECON = await import("../modules/service_reconcile.js");
const V = await import("../modules/accounting/service_jv_validate.js");

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const SQL = read("supabase-phase606b1-service-payment-guards.sql");
const RECONCILE = read("modules/service_reconcile.js");

const res200 = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const res409 = () => ({ ok: false, status: 409, json: async () => null, text: async () => '{"code":"23505","message":"idx_je_source_unique"}' });

const MAPPING = { mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200",
                  transfer_debit_code: "1136", recognition_debit_code: "1200", is_active: true };
const job = { id: 20, job_no: "JOB-20", job_type: "ac", total_cost: 1000, status: "delivered",
              closed_at: "2026-07-05T03:00:00Z", finance_flow_version: 2 };
const pay = { id: 501, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134", paid_at: "2026-07-09T03:00:00Z" };
const rev = { id: 700, payment_id: 501, amount: 500, reason: "โอนผิด", reversed_at: "2026-07-11T03:00:00Z" };

const RECOG_OK = { entry: { id: 11, status: "approved", total_debit: 1000, total_credit: 1000 },
                   lines: [{ account_code: "1200", debit: 1000, credit: 0 }, { account_code: "4200", debit: 0, credit: 1000 }] };
const PAY_OK   = { entry: { id: 22, status: "approved", total_debit: 500, total_credit: 500 },
                   lines: [{ account_code: "1134", debit: 500, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] };
const REV_OK   = { entry: { id: 33, status: "approved", total_debit: 500, total_credit: 500 },
                   lines: [{ account_code: "1200", debit: 500, credit: 0 }, { account_code: "1134", debit: 0, credit: 500 }] };

let wrote;
// existing = JV ที่ค้างอยู่ใน DB สำหรับแต่ละ source (null = ไม่มี header)
function install({ recog = RECOG_OK, payJv = null, revJv = null, dupOn = [] } = {}) {
  wrote = { entries: [], lines: [] };
  const pick = (u) => {
    if (u.includes("source_table=eq.service_jobs")) return recog;
    if (u.includes("source_table=eq.service_payments")) return payJv;
    if (u.includes("source_table=eq.service_payment_reversals")) return revJv;
    return null;
  };
  const handler = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) return res200([MAPPING]);
    if (u.includes("/chart_of_accounts")) return res200(["1110", "1134", "1200", "4200"].map(code => ({ code })));
    if (u.includes("/accounting_periods")) return res200([]);
    if (u.includes("/journal_entries?select=doc_no")) return res200([]);
    if (u.includes("/service_payment_reversals?select=")) return res200(projectRows([rev], u));
    if (u.includes("/service_payments?select=")) return res200(projectRows([pay], u));
    if (u.includes("/service_jobs?select=")) return res200(projectRows([job], u));
    if (u.includes("/journal_entries?select=id,status")) {
      const found = pick(u);
      return res200(found?.entry ? [found.entry] : []);
    }
    if (u.includes("/journal_lines?select=account_code")) {
      const id = /entry_id=eq\.(\d+)/.exec(u)?.[1];
      for (const jv of [recog, payJv, revJv]) {
        if (jv?.entry && String(jv.entry.id) === id) return res200(jv.lines || []);
      }
      return res200([]);
    }
    return res200([]);
  };
  globalThis.fetch = handler;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/rpc/record_service_payment_v2")) return res200({ payment_id: 501, inserted: true, paid_total: 500, outstanding_after: 500 });
    if (u.includes("/rpc/reverse_service_payment_v2")) return res200({ reversal_id: 700, inserted: true, paid_total: 0 });
    if (u.includes("/journal_entries") && init?.method === "POST") {
      const body = JSON.parse(init.body);
      if (dupOn.includes(body.source_table)) return res409();     // DB ปฏิเสธ: มี JE ของ source นี้แล้ว
      wrote.entries.push(body);
      return { ok: true, status: 201, json: async () => [{ id: 999 }], text: async () => "[]" };
    }
    if (u.includes("/journal_lines") && init?.method === "POST") { wrote.lines.push(...JSON.parse(init.body)); return { ok: true, status: 201, json: async () => [], text: async () => "[]" }; }
    return handler(url, init);
  };
}
beforeEach(() => { resetMappingCache(); install(); });

// ═══════════════════════════════════════════════════════════
//  A. duplicate ต้อง read-back + validate (blocking 1)
// ═══════════════════════════════════════════════════════════
const BAD = {
  header_only: { entry: { id: 22, status: "approved", total_debit: 500, total_credit: 500 }, lines: [] },
  draft:       { entry: { id: 22, status: "draft", total_debit: 500, total_credit: 500 }, lines: PAY_OK.lines },
  wrong_acct:  { entry: { id: 22, status: "approved", total_debit: 500, total_credit: 500 },
                 lines: [{ account_code: "1130", debit: 500, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] },
  wrong_amt:   { entry: { id: 22, status: "approved", total_debit: 400, total_credit: 400 },
                 lines: [{ account_code: "1134", debit: 400, credit: 0 }, { account_code: "1200", debit: 0, credit: 400 }] },
  extra_lines: { entry: { id: 22, status: "approved", total_debit: 500, total_credit: 500 },
                 lines: [{ account_code: "1134", debit: 500, credit: 0 }, { account_code: "4200", debit: 0, credit: 100 }, { account_code: "1200", debit: 0, credit: 400 }] }
};

test("A1. payment duplicate: header ค้างไม่มี lines → duplicate-invalid:no-lines · ไม่เขียนซ้ำ", async () => {
  install({ payJv: BAD.header_only, dupOn: ["service_payments"] });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "duplicate-invalid:no-lines");
  assert.equal(wrote.entries.length, 0);
});

test("A2. payment duplicate: draft / บัญชีผิด / ยอดผิด / บรรทัดเกิน → duplicate-invalid:<เหตุ>", async () => {
  const cases = [["draft", "not-approved"], ["wrong_acct", "account-mismatch"], ["wrong_amt", "amount-mismatch"], ["extra_lines", "extra-lines"]];
  for (const [k, reason] of cases) {
    resetMappingCache(); install({ payJv: BAD[k], dupOn: ["service_payments"] });
    const res = await postJournalForServicePayment(501, { detailed: true });
    assert.equal(res.reason, `duplicate-invalid:${reason}`, k);
    assert.equal(wrote.entries.length, 0, k);
  }
});

test("A3. payment duplicate ที่ JV เดิมถูกต้องเป๊ะ → duplicate-valid (และไม่เขียนซ้ำ)", async () => {
  install({ payJv: PAY_OK, dupOn: ["service_payments"] });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.reason, "duplicate-valid");
  assert.equal(res.entryId, 22);
  assert.equal(wrote.entries.length, 0);
});

test("A4. service job (flow v2) duplicate: header ลอย → duplicate-invalid · JV ถูก → duplicate-valid", async () => {
  install({ recog: { entry: { id: 11, status: "approved", total_debit: 1000, total_credit: 1000 }, lines: [] }, dupOn: ["service_jobs"] });
  let res = await postJournalForServiceJob(job, { detailed: true });
  assert.equal(res.reason, "duplicate-invalid:no-lines");
  assert.equal(wrote.entries.length, 0);

  resetMappingCache(); install({ recog: RECOG_OK, dupOn: ["service_jobs"] });
  res = await postJournalForServiceJob(job, { detailed: true });
  assert.equal(res.reason, "duplicate-valid");
});

test("A5. flow v1 (legacy) ไม่ถูกแตะ — duplicate ยังคืน reason 'duplicate' เหมือนเดิม", async () => {
  install({ dupOn: ["service_jobs"] });
  const v1 = { ...job, id: 10, finance_flow_version: 1, payment_method: "cash" };
  const res = await postJournalForServiceJob(v1, { detailed: true });
  assert.equal(res.reason, "duplicate", "writer legacy ต้องไม่เปลี่ยนพฤติกรรม (additive เท่านั้น)");
});

test("A6. reversal duplicate: JV กลับรายการเดิมเสีย → duplicate-invalid · ถูก → duplicate-valid", async () => {
  install({ payJv: PAY_OK, revJv: { entry: { id: 33, status: "draft", total_debit: 500, total_credit: 500 }, lines: REV_OK.lines }, dupOn: ["service_payment_reversals"] });
  let res = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(res.reason, "duplicate-invalid:not-approved");
  assert.equal(wrote.entries.length, 0);

  resetMappingCache(); install({ payJv: PAY_OK, revJv: REV_OK, dupOn: ["service_payment_reversals"] });
  res = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(res.reason, "duplicate-valid");
});

test("A7. accountingPosted = true เฉพาะ posted / duplicate-valid — duplicate-invalid ต้อง false", async () => {
  install({ recog: RECOG_OK, payJv: BAD.header_only, dupOn: ["service_payments"] });
  const bad = await recordServicePayment({ serviceJobId: 20, amount: 500, paymentMethod: "transfer", bankCoaCode: "1134", paidAt: "2026-07-09T03:00:00Z", idempotencyKey: "k1" });
  assert.equal(bad.ledgerRecorded, true);
  assert.equal(bad.accountingPosted, false, "JE ค้างที่ไม่มี lines = ยังไม่ลงบัญชีจริง");

  resetMappingCache(); install({ recog: RECOG_OK, payJv: PAY_OK, dupOn: ["service_payments"] });
  const ok = await recordServicePayment({ serviceJobId: 20, amount: 500, paymentMethod: "transfer", bankCoaCode: "1134", paidAt: "2026-07-09T03:00:00Z", idempotencyKey: "k2" });
  assert.equal(ok.accountingPosted, true);

  resetMappingCache(); install({ payJv: PAY_OK, revJv: BAD.extra_lines, dupOn: ["service_payment_reversals"] });
  const revBad = await reverseServicePayment({ paymentId: 501, amount: 500, reason: "x", reversedAt: "2026-07-11T03:00:00Z", idempotencyKey: "k3" });
  assert.equal(revBad.accountingPosted, false);
});

// ═══════════════════════════════════════════════════════════
//  B. validator fail-closed กับตัวเลข (should-fix 2)
// ═══════════════════════════════════════════════════════════
test("B1. total_credit หาย / debit เป็น null / NaN → bad-number (ห้ามตีเป็น 0 แล้วบอกว่าบาลานซ์)", () => {
  const base = { payment: pay, mapping: MAPPING };
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500 }, lines: PAY_OK.lines }).reason, V.JV_BAD_NUMBER,
    "header ขาด total_credit = fail-closed (เดิม ?? sumC ทำให้ผ่าน)");
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: null }, lines: PAY_OK.lines }).reason, V.JV_BAD_NUMBER);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 },
    lines: [{ account_code: "1134", debit: null, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] }).reason, V.JV_BAD_NUMBER);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 },
    lines: [{ account_code: "1134", debit: "abc", credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] }).reason, V.JV_BAD_NUMBER);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 }, lines: PAY_OK.lines }).ok, true);
});

// ═══════════════════════════════════════════════════════════
//  C. Bangkok period boundaries (blocking 4)
// ═══════════════════════════════════════════════════════════
test("C1. ขอบงวดต้องเป็นเวลาไทย (+07:00) และ encode ใน URL — ไม่ใช่ YYYY-MM-DD เปล่า", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/service_jobs?select=")) return res200([]);
    if (u.includes("/journal_entries")) return res200([]);
    if (u.includes("/account_mapping")) return res200([MAPPING]);
    return res200([]);
  };
  const out = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01", fromDate: "2026-07-01", toDate: "2026-07-31" });
  assert.equal(out.ok, true);
  const closedQ = urls.find(u => u.includes("closed_at=gte."));
  const noDateQ = urls.find(u => u.includes("closed_at=is.null"));
  assert.ok(closedQ.includes(`closed_at=gte.${encodeURIComponent("2026-07-01T00:00:00+07:00")}`), "ขอบล่าง = ต้นวันไทย");
  assert.ok(closedQ.includes(`closed_at=lt.${encodeURIComponent("2026-08-01T00:00:00+07:00")}`), "ขอบบน = ต้นวันถัดจาก toDate (เวลาไทย)");
  assert.ok(noDateQ.includes(`created_at=gte.${encodeURIComponent("2026-07-01T00:00:00+07:00")}`), "noDate query ก็ต้องใช้ขอบเวลาไทย");
  assert.ok(!/closed_at=gte\.2026-07-01(?!T)/.test(closedQ), "ห้ามส่ง YYYY-MM-DD เปล่า (PostgREST ตีเป็น UTC)");
  assert.ok(closedQ.includes("%2B07%3A00"), "+07:00 ต้อง URL-encoded");
});

test("C2. ขอบเขตเวลาไทยครอบคลุมทั้งวัน: 1 ก.ค. 00:00/00:30 และ 31 ก.ค. 23:59:59 อยู่ ก.ค. · 1 ส.ค. 00:00 ไม่อยู่", () => {
  const lo = new Date(RECON.bkkDayStartIso("2026-07-01")).getTime();
  const hi = new Date(RECON.bkkNextDayStartIso("2026-07-31")).getTime();
  const inRange = (bkkIso) => { const t = new Date(bkkIso).getTime(); return t >= lo && t < hi; };
  assert.equal(inRange("2026-07-01T00:00:00+07:00"), true);
  assert.equal(inRange("2026-07-01T00:30:00+07:00"), true, "ตี 00:30 ไทย = 17:30 UTC วันก่อน — เดิมหลุดออกจากงวด");
  assert.equal(inRange("2026-07-31T23:59:59+07:00"), true);
  assert.equal(inRange("2026-08-01T00:00:00+07:00"), false);
  assert.equal(inRange("2026-06-30T23:59:59+07:00"), false);
});

// ═══════════════════════════════════════════════════════════
//  D. closed_at = null + มี JE (blocking 5)
// ═══════════════════════════════════════════════════════════
async function runNoDate(jeEntry, jeLines) {
  const noDate = { id: 31, job_no: "JOB-31", status: "closed", total_cost: 1000, job_type: "ac",
                   closed_at: null, finance_flow_version: 2, created_at: "2026-07-02T03:00:00Z" };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) return res200(projectRows(u.includes("closed_at=is.null") ? [noDate] : [], u));
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) return res200(jeEntry ? [{ ...jeEntry, source_id: 31 }] : []);
    if (u.includes("/journal_lines?select=")) return res200(jeLines || []);
    if (u.includes("/account_mapping")) return res200([MAPPING]);
    return res200([]);
  };
  return RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
}

test("D1. noDate + ไม่มี JE → OWNER_RECOGNITION_DATE_REQUIRED (กองเดียว)", async () => {
  const r = await runNoDate(null, null);
  assert.equal(r.needRecognitionDate.length, 1);
  assert.equal(r.dateMissingWithJv.length, 0);
  assert.equal(r.orphans.length, 0);
});

test("D2. noDate + มี JE (valid / draft / header-only) → SERVICE_DATE_MISSING_WITH_JV ทุกกรณี ไม่หายเงียบ", async () => {
  const valid = await runNoDate({ id: 55, status: "approved", total_debit: 1000, total_credit: 1000 },
    [{ entry_id: 55, account_code: "1200", debit: 1000, credit: 0 }, { entry_id: 55, account_code: "4200", debit: 0, credit: 1000 }]);
  assert.equal(valid.dateMissingWithJv.length, 1);
  assert.equal(valid.dateMissingWithJv[0].state, "SERVICE_DATE_MISSING_WITH_JV");
  assert.equal(valid.dateMissingWithJv[0].reason, "jv-valid-but-no-recognition-date");
  assert.equal(valid.needRecognitionDate.length, 0, "ต้องอยู่กองเดียวพอดี");

  const draft = await runNoDate({ id: 55, status: "draft", total_debit: 1000, total_credit: 1000 },
    [{ entry_id: 55, account_code: "1200", debit: 1000, credit: 0 }, { entry_id: 55, account_code: "4200", debit: 0, credit: 1000 }]);
  assert.equal(draft.dateMissingWithJv[0].reason, "not-approved");

  const headerOnly = await runNoDate({ id: 55, status: "approved", total_debit: 1000, total_credit: 1000 }, []);
  assert.equal(headerOnly.dateMissingWithJv[0].reason, "no-lines");
  assert.equal(headerOnly.needRecognitionDate.length, 0);
  assert.match(RECONCILE, /SERVICE_DATE_MISSING_WITH_JV/);
});

test("D3. DATA_INCOMPLETE: ชน limit → ห้ามรายงานว่าสะอาด", async () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, status: "delivered", total_cost: 1, job_type: "ac", finance_flow_version: 2, closed_at: "2026-07-05T03:00:00Z" }));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) return res200(projectRows(u.includes("closed_at=is.null") ? [] : many, u));
    if (u.includes("/journal_entries")) return res200([]);
    if (u.includes("/account_mapping")) return res200([MAPPING]);
    return res200([]);
  };
  const r = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(r.ok, false);
  assert.equal(r.dataIncomplete, true);
  assert.match(r.reason, /DATA_INCOMPLETE/);
});

// ═══════════════════════════════════════════════════════════
//  E. SQL — recognition validator exact + mapping freeze matrix
// ═══════════════════════════════════════════════════════════
test("E1. SQL recognition validator: 2 บรรทัดพอดี · Dr/Cr ขาละหนึ่ง · header debit+credit = total_cost", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.service_job_has_recognition_jv"), SQL.indexOf("REVOKE ALL ON FUNCTION public.service_job_has_recognition_jv"));
  assert.match(fn, /IF v_cnt <> 2 THEN RETURN false/, "split line (Dr 300 + Dr 200) ต้อง false");
  assert.match(fn, /IF v_dr_cnt <> 1 THEN RETURN false/);
  assert.match(fn, /IF v_cr_cnt <> 1 THEN RETURN false/);
  assert.match(fn, /v_entry\.total_debit IS NULL OR v_entry\.total_credit IS NULL THEN RETURN false/, "header ขาดค่า = false");
  assert.match(fn, /round\(v_entry\.total_credit,2\) <> v_total THEN RETURN false/, "header total_credit ผิด = false");
  assert.match(fn, /account_code = v_map\.recognition_debit_code/);
  assert.match(fn, /account_code = v_map\.credit_account_code/);
  assert.match(fn, /lower\(v_job\.total_cost::text\) IN \('nan','infinity','-infinity','\+infinity'\)/, "NaN/Infinity = false");
  assert.match(SQL, /B10 recognition JV counterexamples/, "runbook ต้องมี counterexample (split line / header ผิด / exact)");
  // RPC รับชำระต้องไม่ INSERT เมื่อ helper = false
  const rpc = SQL.slice(SQL.indexOf("FUNCTION public.record_service_payment_v2"));
  const gate = rpc.indexOf("IF NOT public.service_job_has_recognition_jv(p_service_job_id) THEN");
  const ins = rpc.indexOf("INSERT INTO public.service_payments");
  assert.ok(gate > 0 && gate < ins, "gate ต้องอยู่ก่อน INSERT ledger");
});

test("E2. SQL mapping freeze matrix: key/is_active/account/DELETE = 42501 · notes-only = ผ่าน · unused = ผ่าน", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.guard_service_mapping_freeze"), SQL.indexOf("DROP TRIGGER IF EXISTS trg_service_mapping_freeze"));
  assert.match(fn, /IF NOT v_used THEN[\s\S]{0,160}RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END/, "unused = แก้/ลบได้ตามเดิม");
  assert.match(fn, /TG_OP = 'DELETE' THEN[\s\S]{0,160}42501/, "used + DELETE = 42501");
  assert.match(fn, /NEW\.mapping_key IS DISTINCT FROM OLD\.mapping_key[\s\S]{0,160}42501/, "used + key change = 42501");
  assert.match(fn, /NEW\.is_active IS DISTINCT FROM OLD\.is_active[\s\S]{0,200}42501/, "used + deactivate = 42501");
  assert.match(fn, /NEW\.debit_account_code[\s\S]{0,600}42501/, "used + account change (4 ช่อง) = 42501");
  assert.match(fn, /RETURN NEW;\s+-- เหลือแก้ได้เฉพาะ description \/ notes \/ updated_at/, "notes-only = ผ่าน");
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.account_mapping/, "trigger ต้องครอบ DELETE ด้วย");
  assert.match(SQL, /key change = 42501 · deactivate \(true→false\) = 42501 · DELETE = 42501/, "runbook matrix");
});
