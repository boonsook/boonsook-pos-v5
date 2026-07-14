// Phase 606-b1 (review #2) — reversal accounting path · reconcile behavioral · SQL gates
// Run: node --test tests/service_payment_reversal_guard.test.js
//
// ครอบ guard ที่ audit สั่ง:
//   1. approved header ไม่มี lines → รับชำระไม่ได้            (I1)
//   2. recognition account/amount ผิด → รับชำระไม่ได้          (I1)
//   3. closed orphan → re-post สำเร็จ                          (H1)
//   4. reversal → exact reverse ของ payment JV เดิม            (G1)
//   5. reversal ledger มีแต่ JV หาย → retry ซ่อมได้            (G3)
//   6. status rollback แล้วแก้ยอด → DB block                    (I3)
//   7. reversal reason trim retry → idempotent                 (I4)
//   8. non-accountant เรียก helper → denied                    (I2)

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

const {
  postJournalForServiceJob,
  postJournalForServicePayment,
  postJournalForServicePaymentReversal,
  recordServicePayment,
  reverseServicePayment,
  resetMappingCache
} = await import("../modules/accounting/auto_post.js");
const RECON = await import("../modules/service_reconcile.js");

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const AUTO_POST = read("modules/accounting/auto_post.js");
const RECONCILE = read("modules/service_reconcile.js");
const SQL = read("supabase-phase606b1-service-payment-guards.sql");

function makeRes(status, body, text = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) };
}

const MAPPING = [{ mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200",
                   transfer_debit_code: "1136", recognition_debit_code: "1200", is_active: true }];
const COA = ["1110", "1134", "1136", "1200", "4200"].map(code => ({ code }));
const v2Job = { id: 20, job_no: "JOB-20", job_type: "ac", total_cost: 1000, customer_name: "ก",
                status: "delivered", closed_at: "2026-07-05T03:00:00Z", finance_flow_version: 2 };
const payXfer = { id: 501, service_job_id: 20, amount: 400, payment_method: "transfer", bank_coa_code: "1134", paid_at: "2026-07-09T03:00:00Z" };
const payCash = { id: 500, service_job_id: 20, amount: 400, payment_method: "cash", bank_coa_code: null, paid_at: "2026-07-09T03:00:00Z" };
const revRow = { id: 700, payment_id: 501, amount: 400, reason: "โอนผิดบิล", reversed_at: "2026-07-11T03:00:00Z" };
const payJe = { id: 8100, status: "approved", total_debit: 400 };
const payJeLines = [
  { account_code: "1134", debit: 400, credit: 0 },   // เงินเข้าธนาคารจริงตอนรับเงิน
  { account_code: "1200", debit: 0, credit: 400 }    // ล้างลูกหนี้
];

let posted;
function install({ reversal = revRow, payment = payXfer, job = v2Job, je = payJe, lines = payJeLines, jePostStatus = 201 } = {}) {
  posted = { entries: [], lines: [], rpc: [] };
  const handler = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) return makeRes(200, MAPPING);
    if (u.includes("/chart_of_accounts")) return makeRes(200, COA);
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []);
    if (u.includes("/service_payment_reversals?select=")) return makeRes(200, reversal ? [reversal] : []);
    if (u.includes("/service_payments?select=")) return makeRes(200, payment ? [payment] : []);
    if (u.includes("/service_jobs?select=")) return makeRes(200, job ? [job] : []);
    if (u.includes("/journal_entries?select=id,status,total_debit")) return makeRes(200, je ? [je] : []);
    if (u.includes("/journal_lines?select=")) return makeRes(200, lines || []);
    return makeRes(200, []);
  };
  globalThis.fetch = handler;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/rpc/reverse_service_payment_v2")) {
      posted.rpc.push(JSON.parse(init.body));
      const body = { reversal_id: 700, inserted: true, paid_total: 0 };
      return makeRes(200, body, JSON.stringify(body));
    }
    if (u.includes("/rpc/record_service_payment_v2")) {
      posted.rpc.push(JSON.parse(init.body));
      const body = { payment_id: 500, inserted: true, paid_total: 400, outstanding_after: 600 };
      return makeRes(200, body, JSON.stringify(body));
    }
    if (u.includes("/journal_entries") && init?.method === "POST") {
      if (jePostStatus === 409) return makeRes(409, null, '{"code":"23505","message":"idx_je_source_unique"}');
      posted.entries.push(JSON.parse(init.body));
      return makeRes(201, [{ id: 9500 }]);
    }
    if (u.includes("/journal_lines") && init?.method === "POST") { posted.lines.push(...JSON.parse(init.body)); return makeRes(201, []); }
    return handler(url, init);
  };
}
beforeEach(() => { resetMappingCache(); install(); });

// ═══════════════════════════════════════════════════════════
//  G. reversal accounting path (blocking 2)
// ═══════════════════════════════════════════════════════════
test("G1 (guard 4). reversal JV = exact reverse ของ payment JV เดิม — Dr 1200 / Cr บัญชีเงินเดิม (1134)", async () => {
  const res = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1200", 400, 0], ["1134", 0, 400]],
    "ต้องคืนเข้าบัญชีเดิมที่เงินเคยเข้า (อ่านจาก journal_lines ของ JV เดิม) ไม่ใช่เดาจาก mapping/UI");
  assert.equal(posted.entries[0].source_table, "service_payment_reversals");
  assert.equal(posted.entries[0].source_id, 700);
  assert.equal(posted.entries[0].doc_date, "2026-07-11", "doc_date = reversed_at");
});

test("G2. JV เดิมหาย / ยังไม่ approved / ไม่มี lines / ยอดไม่ตรง ledger → ไม่โพสต์ reversal JV", async () => {
  const cases = [
    [{ je: null }, "original-jv-missing"],
    [{ je: { id: 1, status: "draft", total_debit: 400 } }, "original-jv-not-approved"],
    [{ lines: [] }, "original-jv-lines-missing"],
    [{ je: { id: 1, status: "approved", total_debit: 999 },
       lines: [{ account_code: "1134", debit: 999, credit: 0 }, { account_code: "1200", debit: 0, credit: 999 }] }, "original-jv-mismatch"]
  ];
  for (const [override, reason] of cases) {
    resetMappingCache(); install(override);
    const res = await postJournalForServicePaymentReversal(700, { detailed: true });
    assert.equal(res.reason, reason);
    assert.equal(posted.entries.length, 0, `${reason} ต้องไม่โพสต์`);
  }
});

test("G3 (guard 5). reversal ledger มีแล้วแต่ JV หาย → retry ซ่อมได้ · ยิงซ้ำไม่สร้าง JV ซ้ำ", async () => {
  const first = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(first.status, "posted", "ledger มีแถวแต่ JV หาย → retry แล้วต้องลงบัญชีได้");

  resetMappingCache(); install({ jePostStatus: 409 });   // DB กันซ้ำด้วย idx_je_source_unique
  const again = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(again.status, "skipped");
  assert.equal(again.reason, "duplicate", "idx_je_source_unique → skip ไม่สร้าง JV ซ้ำ");
  assert.equal(posted.entries.length, 0);
});

test("G4 (should-fix). ledgerRecorded แยกจาก accountingPosted — JV ล้มห้ามรายงานว่าสำเร็จสมบูรณ์", async () => {
  const ok = await reverseServicePayment({ paymentId: 501, amount: 400, reason: " โอนผิดบิล ", reversedAt: "2026-07-11T03:00:00Z", idempotencyKey: "k1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.ledgerRecorded, true);
  assert.equal(ok.accountingPosted, true);

  resetMappingCache(); install({ je: null });     // JV เดิมหาย → reversal JV โพสต์ไม่ได้
  const partial = await reverseServicePayment({ paymentId: 501, amount: 400, reason: "x", reversedAt: "2026-07-11T03:00:00Z", idempotencyKey: "k2" });
  assert.equal(partial.ledgerRecorded, true, "เงินถูกกลับรายการใน ledger แล้ว (RPC สำเร็จ)");
  assert.equal(partial.accountingPosted, false, "แต่บัญชียังไม่ลง → ต้องเห็นและ retry ได้");

  resetMappingCache(); install({ payment: payCash });
  const pay = await recordServicePayment({ serviceJobId: 20, amount: 400, paymentMethod: "cash", paidAt: "2026-07-09T03:00:00Z", idempotencyKey: "k3" });
  assert.equal(pay.ledgerRecorded, true);
  assert.equal(pay.accountingPosted, true);
});

// ═══════════════════════════════════════════════════════════
//  H. reconcile behavioral (blocking 3)
// ═══════════════════════════════════════════════════════════
test("H1 (guard 3). closed orphan: fetch (metadata ครบ) → detect → re-post → posted จริง", async () => {
  const closedOrphan = { id: 30, job_no: "JOB-30", customer_name: "ข", status: "closed", total_cost: 500,
                         job_type: "ac", payment_method: null, closed_at: "2026-07-08T03:00:00Z",
                         finance_flow_version: 2, note: "", created_at: "2026-07-01T03:00:00Z" };
  let jobsSelect = "";
  resetMappingCache();
  posted = { entries: [], lines: [], rpc: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) { jobsSelect = u; return makeRes(200, [closedOrphan]); }
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) return makeRes(200, []);   // ไม่มี JE = orphan
    if (u.includes("/account_mapping")) return makeRes(200, MAPPING);
    if (u.includes("/chart_of_accounts")) return makeRes(200, COA);
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []);
    return makeRes(200, []);
  };
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") { posted.entries.push(JSON.parse(init.body)); return makeRes(201, [{ id: 9600 }]); }
    if (u.includes("/journal_lines") && init?.method === "POST") { posted.lines.push(...JSON.parse(init.body)); return makeRes(201, []); }
    return globalThis.fetch(url, init);
  };

  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.ok, true);
  for (const col of ["finance_flow_version", "closed_at", "job_type", "total_cost", "note"]) {
    assert.ok(jobsSelect.includes(col), `fetch ต้อง select ${col} (ขาด = writer block ทุกครั้ง = ปุ่มตาย)`);
  }
  assert.equal(res.orphans.length, 1, "งาน closed ที่ไม่มี JE ต้องถูก detect");

  const jv = await postJournalForServiceJob(res.orphans[0], { detailed: true });
  assert.equal(jv.status, "posted", "re-post ต้องสำเร็จจริงด้วย row ที่หน้าเว็บ fetch มา");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1200", "4200"], "flow v2 → Dr 1200 / Cr 4200");
});

test("H2. งานที่ไม่มี closed_at → กอง OWNER_RECOGNITION_DATE_REQUIRED แยก (ไม่มีปุ่ม re-post หลอก)", async () => {
  const noDate = { id: 31, job_no: "JOB-31", status: "closed", total_cost: 500, job_type: "ac",
                   closed_at: null, finance_flow_version: 1, created_at: "2026-07-02T03:00:00Z" };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) return makeRes(200, [noDate]);
    if (u.includes("/journal_entries")) return makeRes(200, []);
    return makeRes(200, []);
  };
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.orphans.length, 0, "ห้ามอยู่กอง re-post (writer block เสมอ)");
  assert.equal(res.needRecognitionDate.length, 1);
  assert.match(RECONCILE, /OWNER_RECOGNITION_DATE_REQUIRED/);
});

test("H3. ledger taxonomy: PAYMENT_NO_JV · REVERSAL_NO_JV · REVERSAL_MISMATCH", () => {
  const out = RECON.classifyLedgerJv({
    payments: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }],
    reversals: [{ id: 9, payment_id: 2, amount: 50 }, { id: 10, payment_id: 1, amount: 30 }],
    jeRows: [
      { source_table: "service_payments", source_id: 2, total_debit: 200 },
      { source_table: "service_payment_reversals", source_id: 10, total_debit: 999 }    // ยอดเพี้ยน
    ]
  });
  assert.deepEqual(out.paymentNoJv.map(p => p.id), [1]);
  assert.deepEqual(out.reversalNoJv.map(r => r.id), [9]);
  assert.deepEqual(out.reversalMismatch.map(m => `${m.kind}#${m.row.id}`), ["reversal#10"]);
  assert.deepEqual(RECON.LEDGER_JV_STATES, ["PAYMENT_NO_JV", "REVERSAL_NO_JV", "REVERSAL_MISMATCH"]);
});

// ═══════════════════════════════════════════════════════════
//  I. SQL — blocking 1 & 4 + should-fix + drift
// ═══════════════════════════════════════════════════════════
test("I1 (guard 1,2). recognition gate ตรวจ header + lines + บัญชี + ยอด (approved อย่างเดียวไม่พอ)", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.service_job_has_recognition_jv"), SQL.indexOf("-- 3) freeze"));
  assert.match(fn, /FROM public\.journal_lines WHERE entry_id = v_entry\.id/, "ต้องอ่าน lines จริง");
  assert.match(fn, /IF v_sum_d = 0 AND v_sum_c = 0 THEN RETURN false/, "approved header ที่ไม่มี lines → false");
  assert.match(fn, /round\(v_sum_d,2\) <> round\(v_sum_c,2\) THEN RETURN false/, "ไม่บาลานซ์ → false");
  assert.match(fn, /round\(v_sum_d,2\) <> round\(coalesce\(v_entry\.total_debit,0\),2\) THEN RETURN false/, "lines ≠ header → false");
  assert.match(fn, /round\(v_sum_d,2\) <> v_total THEN RETURN false/, "ยอด ≠ total_cost → false");
  assert.match(fn, /account_code = v_map\.recognition_debit_code[\s\S]{0,160}round\(v_dr,2\) <> v_total THEN RETURN false/, "Dr ต้องเป็นบัญชีลูกหนี้ ยอดเต็ม");
  assert.match(fn, /account_code = v_map\.credit_account_code[\s\S]{0,160}round\(v_cr,2\) <> v_total THEN RETURN false/, "Cr ต้องเป็นบัญชีรายได้ ยอดเต็ม");
  assert.match(SQL, /IF NOT public\.service_job_has_recognition_jv\(p_service_job_id\) THEN/, "RPC รับชำระต้องผ่าน gate นี้");
});

test("I2 (guard 8). helper อ่านสถานะ/ยอดบัญชีได้เฉพาะ admin/accountant (fail-closed)", () => {
  const rec = SQL.slice(SQL.indexOf("FUNCTION public.service_job_has_recognition_jv"), SQL.indexOf("-- 3) freeze"));
  assert.match(rec, /IF NOT COALESCE\(public\.is_accountant\(\), false\) THEN[\s\S]{0,140}42501/);
  const paid = SQL.slice(SQL.indexOf("FUNCTION public.service_job_paid_total"), SQL.indexOf("FUNCTION public.service_job_paid_total") + 900);
  assert.match(paid, /CASE WHEN NOT COALESCE\(public\.is_accountant\(\), false\) THEN NULL/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.service_job_paid_total\(BIGINT\) FROM PUBLIC, anon/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.service_job_has_recognition_jv\(BIGINT\) FROM PUBLIC, anon/);
});

test("I3 (guard 6). freeze อิง accounting truth — ย้อน status แล้วแก้ยอดต้องถูก block", () => {
  const trg = SQL.slice(SQL.indexOf("FUNCTION public.guard_service_job_v2_freeze"), SQL.indexOf("-- 4) service_payment_reversals"));
  assert.match(trg, /journal_entries[\s\S]{0,240}INTO v_recognized/, "ต้องดู JV จริง");
  assert.match(trg, /FROM public\.service_payments p WHERE p\.service_job_id = OLD\.id/, "ต้องดูเงินใน ledger");
  assert.match(trg, /IF v_recognized OR v_has_money THEN/, "freeze = accounting truth ไม่ใช่ status ปัจจุบัน");
  assert.match(trg, /NEW\.total_cost IS DISTINCT FROM OLD\.total_cost[\s\S]{0,160}42501/);
  assert.match(trg, /NEW\.job_type IS DISTINCT FROM OLD\.job_type[\s\S]{0,160}42501/);
  assert.match(trg, /IN \('done','progress','pending'\)[\s\S]{0,200}42501/, "ห้ามย้อนสถานะหลังลงบัญชี");
  assert.ok(!/lower\(coalesce\(OLD\.status,''\)\) IN \('delivered','closed'\) THEN\s+IF NEW\.total_cost/.test(trg),
    "ห้าม gate การแก้ยอดด้วย status ปัจจุบันอย่างเดียว (ย้อน status ก่อน = ทางลัด)");
});

test("I4 (guard 7). reversal reason normalize ครั้งเดียว → retry (มีช่องว่าง) ยัง idempotent · ต้องมี recognition JV ก่อน", () => {
  const rpc = SQL.slice(SQL.indexOf("FUNCTION public.reverse_service_payment_v2"));
  assert.match(rpc, /v_reason := btrim\(p_reason\)/);
  assert.match(rpc, /v_existing\.reason IS NOT DISTINCT FROM v_reason/, "compare ต้องใช้ค่าที่ normalize แล้ว");
  assert.match(rpc, /VALUES \(p_payment_id, v_amount, v_reason,/, "insert ต้องใช้ค่าเดียวกัน");
  assert.match(rpc, /IF NOT public\.service_job_has_recognition_jv\(v_pay\.service_job_id\) THEN/);
  assert.match(rpc, /v_reversed \+ v_amount > round\(v_pay\.amount, 2\)[\s\S]{0,200}23514/, "กลับรายการเกินยอดที่รับจริงไม่ได้");
});

test("I5. drift: mapping-key ฝั่ง SQL ต้องตรงกับ SERVICE_JOB_TYPE_KEY_MAP ใน auto_post.js", () => {
  const jsMap = AUTO_POST.slice(AUTO_POST.indexOf("const SERVICE_JOB_TYPE_KEY_MAP"), AUTO_POST.indexOf("export function serviceMappingKeyForJobType"));
  const jsPairs = [...jsMap.matchAll(/^\s{2}(\w+):\s+"(\w+)"/gm)].map(m => [m[1], m[2]]);
  assert.ok(jsPairs.length >= 12, `ต้องเจอ mapping ครบ (เจอ ${jsPairs.length})`);
  const sqlFn = SQL.slice(SQL.indexOf("FUNCTION public.service_mapping_key_for_job_type"),
                          SQL.indexOf("CREATE OR REPLACE FUNCTION public.service_job_has_recognition_jv"));
  for (const [jobType, key] of jsPairs) {
    assert.match(sqlFn, new RegExp(`WHEN '${jobType}'\\s+THEN '${key}'`), `SQL ขาด ${jobType} → ${key}`);
  }
  assert.match(sqlFn, /ELSE 'service_other'/);
});
