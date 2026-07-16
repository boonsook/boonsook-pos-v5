// Phase 606-b1 — Service finance writer (flow v1 legacy vs flow v2 delivery/payment)
// Run: node --test tests/service_finance_writer_guard.test.js
//
// OWNER POLICY (คำตัดสิน 2026-07-14):
//   done      = ช่างทำงานเสร็จภายใน — ไม่มี JV / ไม่มี closed_at / ไม่ใช่การรับเงิน
//   delivered = ส่งมอบจริง → รับรู้รายได้ Dr 1200 ลูกหนี้ / Cr 42xx (แม้ลูกค้ายังไม่จ่าย)
//   closed    = ลูกค้ายืนยันปิดงานเชิง workflow — **ไม่ใช่ payment event** และไม่โพสต์ JV ซ้ำ
//   การรับเงิน = ledger แยก (service_payments) → Dr เงินสด/ธนาคาร / Cr 1200
//
// เฟสนี้เป็น backend เท่านั้น: ห้ามแตะ main.js / customer_dashboard.js / status semantics
// (flow v1 ต้องไม่เปลี่ยนพฤติกรรมก่อน cutover — ดู C-guards ท้ายไฟล์)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { projectRows } from "./_select_projection.js";  // ★ 606-b1.1: mock @select-projection

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  _appAuthFetch: null,
  App: { showToast: () => {} },
};
console.error = () => {}; console.info = () => {}; console.warn = () => {};

const {
  postJournalForServiceJob,
  postJournalForServicePayment,
  postJournalForServicePaymentReversal,
  recordServicePayment,
  reverseServicePayment,
  serviceFinanceFlowOf,
  resetMappingCache
} = await import("../modules/accounting/auto_post.js");
const RECON = await import("../modules/service_reconcile.js");

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const AUTO_POST = read("modules/accounting/auto_post.js");
const BACKFILL  = read("modules/accounting/backfill.js");
const RECONCILE = read("modules/service_reconcile.js");
const SQL       = read("supabase-phase606b1-service-payment-guards.sql");
// strip SQL comments ก่อน negative assertion (กัน false positive จากคอมเมนต์)
const sqlCode = (s) => s.replace(/--[^\n]*/g, "");

function makeRes(status, body, text = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) };
}

// posted JV lines ที่ writer ส่งจริง (ดักที่ journal_lines POST)
let posted;
function installFetch({ payment = null, job = null, recognitionJe = true } = {}) {
  posted = { entries: [], lines: [], rpc: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) {
      return makeRes(200, [{
        mapping_key: "service_install_ac",
        debit_account_code: "1110",          // เงินสด
        credit_account_code: "4200",         // รายได้ติดตั้งแอร์
        transfer_debit_code: "1136",         // ธนาคาร (ใช้เฉพาะ v1)
        recognition_debit_code: "1200",      // ลูกหนี้ (v2)
        is_active: true
      }]);
    }
    if (u.includes("/chart_of_accounts")) {
      return makeRes(200, ["1110", "1130", "1134", "1136", "1200", "4200"].map(code => ({ code })));
    }
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []);
    if (u.includes("/service_payments?select=")) return makeRes(200, projectRows(payment ? [payment] : [], u));
    if (u.includes("/service_jobs?select=")) return makeRes(200, projectRows(job ? [job] : [], u));
    // ★ review#2: writer ตรวจ recognition JV จริงก่อนโพสต์ JV รับเงิน (Cr 1200)
    if (u.includes("source_table=eq.service_jobs")) {
      return makeRes(200, recognitionJe ? [{ id: 11, status: "approved", total_debit: 1000, total_credit: 1000 }] : []);
    }
    if (u.includes("/journal_lines?select=account_code")) {
      return makeRes(200, recognitionJe
        ? [{ account_code: "1200", debit: 1000, credit: 0 }, { account_code: "4200", debit: 0, credit: 1000 }]
        : []);
    }
    return makeRes(200, []);
  };
}
function installPostOk(rpcBody = null) {
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/rpc/record_service_payment_v2")) {
      posted.rpc.push(JSON.parse(init.body));
      return makeRes(200, rpcBody, JSON.stringify(rpcBody));
    }
    if (u.includes("/journal_entries") && init?.method === "POST") {
      posted.entries.push(JSON.parse(init.body));
      return makeRes(201, [{ id: 9001 }]);
    }
    if (u.includes("/journal_lines") && init?.method === "POST") {
      posted.lines.push(...JSON.parse(init.body));
      return makeRes(201, []);
    }
    return globalThis.fetch(url, init);
  };
}
beforeEach(() => { resetMappingCache(); installFetch(); window._appAuthFetch = null; });

const v1Job = { id: 10, job_no: "SV-10", job_type: "ac", total_cost: 1000, customer_name: "ก", status: "delivered",
                closed_at: "2026-07-05T03:00:00Z", finance_flow_version: 1 };
const v2Job = { ...v1Job, id: 20, job_no: "SV-20", finance_flow_version: 2 };

// ═══════════════════════════════════════════════════════════
//  A. flow version = fail-closed (ห้ามเดาเป็น v1)
// ═══════════════════════════════════════════════════════════
test("A1. serviceFinanceFlowOf: 1/2 ผ่าน · undefined/null/0/3/junk = null (block)", () => {
  assert.equal(serviceFinanceFlowOf({ finance_flow_version: 1 }), 1);
  assert.equal(serviceFinanceFlowOf({ finance_flow_version: 2 }), 2);
  assert.equal(serviceFinanceFlowOf({ finance_flow_version: "2" }), 2);
  for (const bad of [undefined, null, 0, 3, "v2", "", NaN, {}]) {
    assert.equal(serviceFinanceFlowOf({ finance_flow_version: bad }), null, `${String(bad)} ต้อง block`);
  }
  assert.equal(serviceFinanceFlowOf(undefined), null);
});

test("A2. metadata หาย → DB คือ authority (v1/v2/ไม่พบ/error/flow ยังหาย) — fail case ต้อง zero writes", async () => {
  const { finance_flow_version: _drop, ...noMeta } = v1Job;

  // (ก) DB พบ row + flow v1 → โพสต์แบบ legacy
  installFetch({ job: { ...noMeta, finance_flow_version: 1 } }); installPostOk();
  let res = await postJournalForServiceJob({ ...noMeta, payment_method: "cash" }, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1110", "4200"]);

  // (ข) DB พบ row + flow v2 → กติกา v2 (Dr 1200)
  resetMappingCache(); installFetch({ job: { ...noMeta, finance_flow_version: 2 } }); installPostOk();
  res = await postJournalForServiceJob(noMeta, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1200", "4200"]);

  // (ค) DB ไม่พบ row → job-not-found (zero writes)
  resetMappingCache(); installFetch({ job: null }); installPostOk();
  res = await postJournalForServiceJob(noMeta, { detailed: true });
  assert.equal(res.reason, "job-not-found");
  assert.equal(posted.entries.length, 0);

  // (ง) DB error → job-read-failed (zero writes)
  resetMappingCache(); installFetch(); installPostOk();
  const okFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("/service_jobs?select=*")
    ? { ok: false, status: 500, json: async () => null, text: async () => "boom" }
    : okFetch(url, init));
  res = await postJournalForServiceJob(noMeta, { detailed: true });
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "job-read-failed");
  assert.equal(posted.entries.length, 0);

  // (จ) DB row ก็ยังไม่มี flow → finance-flow-unknown (zero writes · ห้าม fallback v1)
  resetMappingCache(); installFetch({ job: { ...noMeta } }); installPostOk();
  res = await postJournalForServiceJob(noMeta, { detailed: true });
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "finance-flow-unknown");
  assert.equal(posted.entries.length, 0, "ต้องไม่มี JV ออกไปเลย");
});


// ═══════════════════════════════════════════════════════════
//  B. flow v1 = พฤติกรรมเดิมเป๊ะ (ห้าม drift ก่อน cutover)
// ═══════════════════════════════════════════════════════════
test("B1. v1 เงินสด: Dr 1110 / Cr 4200 (เดิม) — done/closed ก็ยังโพสต์ได้เหมือนเดิม", async () => {
  installPostOk();
  const res = await postJournalForServiceJob({ ...v1Job, payment_method: "cash" }, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1110", 1000, 0], ["4200", 0, 1000]]);

  for (const st of ["done", "closed"]) {
    installFetch(); resetMappingCache(); installPostOk();
    const r = await postJournalForServiceJob({ ...v1Job, id: 11, status: st, payment_method: "cash" }, { detailed: true });
    assert.equal(r.status, "posted", `v1 + ${st} ต้องยังโพสต์ได้ (พฤติกรรมเดิม)`);
  }
});

test("B2. v1 โอน: Dr ธนาคารตาม mapping (1136) — routing เดิมไม่เปลี่ยน", async () => {
  installPostOk();
  const res = await postJournalForServiceJob({ ...v1Job, payment_method: "transfer" }, { detailed: true });
  assert.equal(res.status, "posted");
  assert.equal(posted.lines[0].account_code, "1136");
  assert.equal(posted.lines[1].account_code, "4200");
});

// ═══════════════════════════════════════════════════════════
//  C. flow v2 = ส่งมอบ → ลูกหนี้ (ยังไม่ใช่เงิน)
// ═══════════════════════════════════════════════════════════
test("C1. v2 delivered: Dr 1200 ลูกหนี้ / Cr 4200 — payment_method ของใบงานไม่มีผล", async () => {
  installPostOk();
  const res = await postJournalForServiceJob({ ...v2Job, payment_method: "transfer" }, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1200", 1000, 0], ["4200", 0, 1000]],
    "โอน/เงินสดบนใบงานต้องไม่เปลี่ยน Dr ของ v2 (ช่องทางเงินอยู่ที่ ledger รับชำระ)");
});

test("C2. v2 done: **ไม่โพสต์** (ช่างทำเสร็จภายใน ยังไม่ส่งมอบ) · v2 closed: โพสต์ได้เพื่อ recovery", async () => {
  installFetch(); resetMappingCache(); installPostOk();
  const done = await postJournalForServiceJob({ ...v2Job, status: "done" }, { detailed: true });
  assert.equal(done.status, "skipped");
  assert.equal(done.reason, "not-income-status");
  assert.equal(posted.entries.length, 0);

  // closed = งานที่ลูกค้ายืนยันปิดแล้วแต่ JV หาย → Service Reconcile ต้อง re-post ได้ (guard #3)
  installFetch(); resetMappingCache(); installPostOk();
  const closed = await postJournalForServiceJob({ ...v2Job, status: "closed" }, { detailed: true });
  assert.equal(closed.status, "posted", "closed orphan ต้อง re-post สำเร็จ (ไม่งั้นซ่อมไม่ได้ตลอดกาล)");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1200", "4200"]);
});

test("C3. v2 ที่ mapping ไม่มี recognition_debit_code → block (ไม่โพสต์บัญชีผี)", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) {
      return makeRes(200, [{ mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200", is_active: true }]);
    }
    if (u.includes("/chart_of_accounts")) return makeRes(200, [{ code: "1110" }, { code: "4200" }]);
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    return makeRes(200, []);
  };
  resetMappingCache(); installPostOk();
  const res = await postJournalForServiceJob(v2Job, { detailed: true });
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "missing-recognition-account");
  assert.equal(posted.entries.length, 0);
});

// ═══════════════════════════════════════════════════════════
//  D. payment JV = อ่านจาก ledger เท่านั้น (ห้ามเชื่อฟอร์ม)
// ═══════════════════════════════════════════════════════════
const payCash = { id: 500, service_job_id: 20, amount: 400, payment_method: "cash", bank_coa_code: null, paid_at: "2026-07-09T03:00:00Z" };
const payXfer = { ...payCash, id: 501, payment_method: "transfer", bank_coa_code: "1134" };

test("D1. payment เงินสด: Dr 1110 / Cr 1200 · source_table=service_payments (idempotent ต่อ payment id)", async () => {
  installFetch({ payment: payCash, job: v2Job }); installPostOk();
  const res = await postJournalForServicePayment(500, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1110", 400, 0], ["1200", 0, 400]]);
  assert.equal(posted.entries[0].source_table, "service_payments");
  assert.equal(posted.entries[0].source_id, 500);
  assert.equal(posted.entries[0].doc_date, "2026-07-09", "docDate = paid_at (วันรับเงินจริง)");
});

test("D2. payment โอน: Dr = ธนาคารที่ **ledger** บันทึก (1134) ไม่ใช่ mapping ของ job (1136)", async () => {
  installFetch({ payment: payXfer, job: v2Job }); installPostOk();
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.status, "posted");
  assert.equal(posted.lines[0].account_code, "1134", "เงินเข้าบัญชีไหน = ledger เป็นคนบอก");
  assert.equal(posted.lines[1].account_code, "1200");
});

test("D3. ledger บอกยอด 400 แต่ 'ฟอร์ม' อ้าง 9999 → JV ต้องเป็น 400 (writer ไม่รับ input จาก caller)", async () => {
  installFetch({ payment: payCash, job: v2Job }); installPostOk();
  await postJournalForServicePayment(500, { detailed: true, amount: 9999, payment_method: "transfer", bank_coa_code: "1136" });
  assert.equal(posted.lines[0].debit, 400);
  assert.equal(posted.lines[0].account_code, "1110");
});

test("D4. อ่าน ledger ไม่ได้ / ไม่มีแถว / งานไม่ใช่ v2 → ไม่โพสต์ (fail-closed)", async () => {
  installFetch({ payment: null, job: v2Job }); installPostOk();
  assert.equal((await postJournalForServicePayment(999, { detailed: true })).reason, "payment-not-found");

  installFetch({ payment: payCash, job: { ...v2Job, finance_flow_version: 1 } }); installPostOk();
  assert.equal((await postJournalForServicePayment(500, { detailed: true })).reason, "not-flow-v2");

  installFetch({ payment: payCash, job: v2Job });
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/service_payments?select=")) return makeRes(500, null, "boom");
    if (u.includes("/journal_entries") && init?.method === "POST") { posted.entries.push(1); return makeRes(201, [{ id: 1 }]); }
    return globalThis.fetch(url, init);
  };
  const res = await postJournalForServicePayment(500, { detailed: true });
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "ledger-read-failed");
  assert.equal(posted.entries.length, 0, "อ่าน ledger ไม่ได้ = ห้ามเดาแล้วโพสต์");
});

test("D5. transfer ที่ ledger ไม่มี bank_coa_code (ข้อมูลเสีย) → block ไม่โพสต์", async () => {
  installFetch({ payment: { ...payXfer, bank_coa_code: null }, job: v2Job }); installPostOk();
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.reason, "missing-bank-account");
  assert.equal(posted.entries.length, 0);
});

test("D6. recordServicePayment: RPC ก่อน → แล้วค่อยโพสต์ JV จาก row ที่ DB คืน (ไม่ INSERT ledger เอง)", async () => {
  installFetch({ payment: payCash, job: v2Job });
  installPostOk({ payment_id: 500, inserted: true, paid_total: 400, outstanding_after: 600 });
  const out = await recordServicePayment({
    serviceJobId: 20, amount: 400, paymentMethod: "cash", paidAt: "2026-07-09T03:00:00Z",
    idempotencyKey: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(out.ok, true);
  assert.equal(out.paymentId, 500);
  assert.equal(out.outstanding, 600);
  assert.equal(out.jv.status, "posted");
  assert.equal(posted.rpc.length, 1, "ต้องผ่าน RPC เท่านั้น");
  assert.equal(posted.rpc[0].p_idempotency_key, "11111111-1111-4111-8111-111111111111");
  assert.ok(!/POST[\s\S]{0,40}service_payments/.test(AUTO_POST.replace(/\/\/[^\n]*/g, "")), "ห้าม INSERT service_payments จาก client");
});

test("D7. RPC ล้มเหลว → ไม่โพสต์ JV และไม่ fake success", async () => {
  installFetch({ payment: payCash, job: v2Job });
  window._appAuthFetch = async (url, init) => {
    if (String(url).includes("/rpc/record_service_payment_v2")) return makeRes(400, null, '{"message":"รับชำระเกินยอดค้าง"}');
    if (String(url).includes("/journal_entries") && init?.method === "POST") { posted.entries.push(1); return makeRes(201, [{ id: 1 }]); }
    return globalThis.fetch(url, init);
  };
  const out = await recordServicePayment({ serviceJobId: 20, amount: 99999, paymentMethod: "cash", paidAt: "2026-07-09T03:00:00Z", idempotencyKey: "k" });
  assert.equal(out.ok, false);
  assert.match(out.error, /เกินยอดค้าง/);
  assert.equal(posted.entries.length, 0);
});

test("D8. RPC สำเร็จแต่ JV ล้ม → ledgerRecorded=true / accountingPosted=false (ห้ามใช้ ok ตัวเดียวตัดสิน)", async () => {
  // ★ 606-b1.1 (A4): เงินลง ledger จริงแล้ว แต่ recognition JV หาย → บัญชียังไม่จบ
  //   caller/UI (606-b2) ต้องอ่าน accountingPosted — ok:true แปลว่า "ledger รับแล้ว" เท่านั้น
  installFetch({ payment: payCash, job: v2Job, recognitionJe: false });
  installPostOk({ payment_id: 500, inserted: true, paid_total: 400, outstanding_after: 600 });
  const out = await recordServicePayment({
    serviceJobId: 20, amount: 400, paymentMethod: "cash", paidAt: "2026-07-09T03:00:00Z",
    idempotencyKey: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(out.ok, true);
  assert.equal(out.ledgerRecorded, true);
  assert.equal(out.accountingPosted, false, "JV ไม่ผ่าน = accountingPosted ต้อง false");
  assert.match(out.jv.reason, /^recognition-invalid:no-header$/);
  assert.equal(posted.entries.length, 0, "recognition หาย = ห้ามโพสต์ JV รับเงิน");
});

test("D9. payment writer ต้อง select total_cost จาก service_jobs (B1 regression — structural fast-fail)", () => {
  // behavioral proof อยู่ที่ B4/B4b ใน service_jv_exactness_guard (mock เคารพ projection แล้ว) —
  // ตัวนี้เป็น fast-fail ชี้ตำแหน่ง: select ของ payment writer ต้องขอ total_cost เสมอ
  const body = AUTO_POST.slice(AUTO_POST.indexOf("export async function postJournalForServicePayment"),
                               AUTO_POST.indexOf("export async function recordServicePayment"));
  assert.match(body, /service_jobs\?select=[^`]*total_cost/,
    "select ของ payment writer ต้องมี total_cost (validateRecognitionJv ใช้เทียบยอด)");
});

// ═══════════════════════════════════════════════════════════
//  E. ไม่มีทางลัด: backfill / reconcile ต้องผ่าน gate เดียวกัน
// ═══════════════════════════════════════════════════════════
test("E1. backfill: ไม่มี source งานบริการ และไม่เรียก writer งานบริการอีกต่อไป", () => {
  assert.ok(!/postJournalForServiceJob/.test(BACKFILL), "ห้ามเรียก writer งานบริการจาก backfill");
  assert.ok(!/key:\s*"service_jobs"[\s\S]{0,80}table:\s*"service_jobs"/.test(BACKFILL), "service_jobs ต้องไม่อยู่ใน SOURCES");
  assert.match(BACKFILL, /reason: "service-writer-only"/);
});

test("E2. reconcile: re-post ยังใช้ canonical writer + แสดงเหตุผลจริง (ลัด gate ไม่ได้)", () => {
  assert.match(RECONCILE, /postJournalForServiceJob\(job, \{ detailed: true \}\)/);
  // อ่าน journal_entries เพื่อหางานที่ยังไม่ลงบัญชีได้ (GET) — แต่ห้าม "เขียน" JE เอง
  const rec = RECONCILE.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/method:\s*"(POST|PATCH|DELETE)"/.test(rec), "reconcile ต้อง read-only (เขียน JE ผ่าน canonical writer เท่านั้น)");
  // ★ review#5: ข้อความเหตุผลย้ายไป shared helper (jvResultToToast) — ปุ่ม re-post และปุ่มซ่อม ledger
  //   ใช้ policy ชุดเดียวกัน (recognition-date-required / finance-flow-unknown ยังถูกสื่อครบ)
  assert.match(RECONCILE, /jvResultToToast\(res\)\.message/);
  const helper = read("modules/accounting/service_jv_validate.js");
  assert.match(helper, /recognition-date-required/);
  assert.match(helper, /finance-flow-unknown/);
});

test("E3. runtime ที่ยังไม่ถึงเฟส (customer_dashboard) ต้องยังไม่ถูกแตะ; main.js ผ่าน helper เท่านั้น", () => {
  // ★ Phase 606-b2 (build 603): main.js drawer = เนื้องานของเฟสนี้ (dormant สำหรับ v1 —
  //   พิสูจน์ใน service_drawer_v2_semantics_guard + service_payment_ui_guard);
  //   customer confirm (customer_dashboard) = 606-b2c ยังห้ามแตะ
  assert.ok(!/service_payments|recordServicePayment|finance_flow_version/.test(read("modules/customer_dashboard.js")),
    "modules/customer_dashboard.js = 606-b2c เท่านั้น");
  assert.ok(!/record_service_payment_v2|rest\/v1\/service_payments/.test(read("main.js")),
    "main.js ห้ามยิง RPC/ledger ตรง — ต้องผ่าน recordServicePayment (auto_post)");
});

// ═══════════════════════════════════════════════════════════
//  F. SQL 606-b1 (ยังไม่รัน production)
// ═══════════════════════════════════════════════════════════
test("F1. SQL: รับชำระต้องมี recognition JV จริง (ไม่ใช่ status/closed_at)", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.service_job_has_recognition_jv/);
  assert.match(SQL, /je\.source_table = 'service_jobs'[\s\S]{0,160}lower\(coalesce\(je\.status,''\)\) = 'approved'/);
  assert.match(SQL, /IF NOT public\.service_job_has_recognition_jv\(p_service_job_id\) THEN/);
  // gate ต้องอยู่ในกลุ่ม business-state (หลัง idempotency) — retry ของรายการเดิมต้องไม่พังเพราะ JV ถูก void ทีหลัง
  const rpc = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.record_service_payment_v2"));
  assert.ok(rpc.indexOf("service_job_has_recognition_jv") > rpc.indexOf("SELECT * INTO v_existing"),
    "gate recognition JV ต้องอยู่หลัง idempotency lookup");
});

test("F2. SQL: freeze งาน v2 ที่ส่งมอบแล้ว (total_cost/job_type แก้ไม่ได้)", () => {
  const trg = SQL.slice(SQL.indexOf("guard_service_job_v2_freeze"), SQL.indexOf("-- 4) service_payment_reversals"));
  assert.match(trg, /NEW\.total_cost IS DISTINCT FROM OLD\.total_cost/);
  assert.match(trg, /NEW\.job_type IS DISTINCT FROM OLD\.job_type/);
  assert.match(trg, /ERRCODE = '42501'/);
  assert.match(SQL, /CREATE TRIGGER trg_service_job_v2_freeze\s+BEFORE UPDATE ON public\.service_jobs/);
});

test("F3. SQL: reversal เป็น append-only + กลับรายการเกินยอดที่รับจริงไม่ได้ + ไม่มีสิทธิ์เขียนตรง", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.service_payment_reversals/);
  assert.match(SQL, /uq_service_payment_reversals_idem UNIQUE \(payment_id, idempotency_key\)/);
  assert.match(SQL, /v_reversed \+ v_amount > round\(v_pay\.amount, 2\)/);
  assert.match(SQL, /ERRCODE = '23514'/);
  const code = sqlCode(SQL);
  assert.ok(!/UPDATE public\.service_payments|DELETE FROM public\.service_payments/.test(code),
    "ห้าม UPDATE/DELETE ledger (append-only)");
  assert.match(SQL, /REVOKE ALL ON public\.service_payment_reversals FROM PUBLIC, anon, authenticated/);
  assert.match(SQL, /ENABLE ROW LEVEL SECURITY[\s\S]{0,200}FORCE ROW LEVEL SECURITY/);
});

test("F4. SQL: ยอดค้าง = Σ payments − Σ reversals · ยังห้าม activate (POST-CHECK flow2/ledger/reversal = 0)", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.service_job_paid_total/);
  assert.match(SQL, /sum\(p\.amount\)[\s\S]{0,200}sum\(r\.amount\)/);
  assert.match(SQL, /SELECT public\.service_job_paid_total\(p_service_job_id\) INTO v_paid/);
  for (const need of ["finance_flow_version = 2", "service_payments ต้องยังว่าง", "service_payment_reversals ต้องยังว่าง",
    "trg_service_job_v2_freeze", "role_table_grants"]) {
    assert.ok(SQL.includes(need), `POST-CHECK ต้องตรวจ: ${need}`);
  }
  const code = sqlCode(SQL);
  assert.ok(!/UPDATE public\.service_jobs\s+SET[\s\S]{0,80}finance_flow_version\s*=\s*2/.test(code),
    "606-b1 ห้าม activate flow v2 (นั่นคือ 606-b3)");
  assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+(public\.)?(journal_entries|journal_lines)/i.test(code),
    "SQL ห้ามเขียน/แก้/ลบ journal (อ่านเพื่อ gate ได้เท่านั้น)");
});
