// Phase 606-b1 (review #2) — exactness ของ JV: "มีแถวใน journal_entries" ≠ "ลงบัญชีถูก"
// Run: node --test tests/service_jv_exactness_guard.test.js
//
// counterexample หลักที่ audit สั่ง (ต้อง block + zero writes):
//   payment 500 บาท → JV: Dr 1134 = 500 · Cr 4200 = 100 · Cr 1200 = 400
//   (header balance ตรง 500/500 แต่มีบัญชีแปลกปลอมและไม่ใช่ 2 ขา) → ห้ามผ่าน

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

const V = await import("../modules/accounting/service_jv_validate.js");
const { postJournalForServicePayment, postJournalForServicePaymentReversal, resetMappingCache } =
  await import("../modules/accounting/auto_post.js");
const RECON = await import("../modules/service_reconcile.js");

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const AUTO_POST = read("modules/accounting/auto_post.js");
const RECONCILE = read("modules/service_reconcile.js");
const SQL = read("supabase-phase606b1-service-payment-guards.sql");

function makeRes(status, body, text = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) };
}

const MAPPING = { mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200",
                  transfer_debit_code: "1136", recognition_debit_code: "1200", is_active: true };
const job = { id: 20, job_no: "JOB-20", job_type: "ac", total_cost: 1000, status: "delivered",
              closed_at: "2026-07-05T03:00:00Z", finance_flow_version: 2 };
const pay = { id: 501, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134", paid_at: "2026-07-09T03:00:00Z" };
const rev = { id: 700, payment_id: 501, amount: 500, reason: "โอนผิด", reversed_at: "2026-07-11T03:00:00Z" };

const goodPayLines = [{ account_code: "1134", debit: 500, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }];
const POISON_LINES = [                                    // ★ counterexample ของ audit
  { account_code: "1134", debit: 500, credit: 0 },
  { account_code: "4200", debit: 0, credit: 100 },        // บัญชีแปลกปลอม
  { account_code: "1200", debit: 0, credit: 400 }
];
const goodRecogLines = [{ account_code: "1200", debit: 1000, credit: 0 }, { account_code: "4200", debit: 0, credit: 1000 }];

// ═══════════════════════════════════════════════════════════
//  A. validator (pure)
// ═══════════════════════════════════════════════════════════
test("A1. counterexample: Dr 500 / Cr 4200=100 / Cr 1200=400 (header balance ตรง) → ไม่ผ่าน", () => {
  const out = V.validatePaymentJv({ payment: pay, mapping: MAPPING,
    entry: { status: "approved", total_debit: 500, total_credit: 500 }, lines: POISON_LINES });
  assert.equal(out.ok, false);
  assert.equal(out.reason, V.JV_EXTRA_LINES, "3 ขา = บัญชีแปลกปลอม ห้ามนับว่าถูก");
});

test("A2. draft header / header-only / บัญชีผิด / ยอดผิด → ไม่ผ่าน (แยก reason ได้)", () => {
  const base = { payment: pay, mapping: MAPPING };
  assert.equal(V.validatePaymentJv({ ...base, entry: null, lines: [] }).reason, V.JV_NO_HEADER);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "draft", total_debit: 500, total_credit: 500 }, lines: goodPayLines }).reason, V.JV_NOT_APPROVED);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 }, lines: [] }).reason, V.JV_NO_LINES);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 },
    lines: [{ account_code: "1130", debit: 500, credit: 0 }, { account_code: "1200", debit: 0, credit: 500 }] }).reason, V.JV_ACCOUNT_MISMATCH,
    "โอนเข้า 1134 ตาม ledger แต่ JV ลง 1130 = บัญชีผิด");
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 400, total_credit: 400 },
    lines: [{ account_code: "1134", debit: 400, credit: 0 }, { account_code: "1200", debit: 0, credit: 400 }] }).reason, V.JV_AMOUNT_MISMATCH);
  assert.equal(V.validatePaymentJv({ ...base, entry: { status: "approved", total_debit: 500, total_credit: 500 }, lines: goodPayLines }).ok, true);
});

test("A3. ledgerStateOf: header หาย = NO_JV (ซ่อมอัตโนมัติได้) · draft = NON_APPROVED · ที่เหลือ = MISMATCH", () => {
  assert.equal(V.ledgerStateOf({ ok: true }), "OK");
  assert.equal(V.ledgerStateOf({ ok: false, reason: V.JV_NO_HEADER }), "NO_JV");
  assert.equal(V.ledgerStateOf({ ok: false, reason: V.JV_NOT_APPROVED }), "NON_APPROVED");
  for (const r of [V.JV_NO_LINES, V.JV_UNBALANCED, V.JV_ACCOUNT_MISMATCH, V.JV_AMOUNT_MISMATCH, V.JV_EXTRA_LINES, V.JV_HEADER_MISMATCH]) {
    assert.equal(V.ledgerStateOf({ ok: false, reason: r }), "MISMATCH");
  }
  assert.deepEqual(V.AUTO_REPAIRABLE_STATES, ["NO_JV"]);
});

// ═══════════════════════════════════════════════════════════
//  B. writer (behavioral) — zero writes เมื่อ JV ต้นทางเสีย
// ═══════════════════════════════════════════════════════════
let posted;
function install({ recogEntry, recogLines, payEntry, payLines } = {}) {
  posted = { entries: [], lines: [] };
  const handler = async (url) => {
    const u = String(url);
    if (u.includes("/account_mapping")) return makeRes(200, [MAPPING]);
    if (u.includes("/chart_of_accounts")) return makeRes(200, ["1110", "1134", "1200", "4200"].map(code => ({ code })));
    if (u.includes("/accounting_periods")) return makeRes(200, []);
    if (u.includes("/journal_entries?select=doc_no")) return makeRes(200, []);
    if (u.includes("/service_payment_reversals?select=")) return makeRes(200, [rev]);
    if (u.includes("/service_payments?select=")) return makeRes(200, [pay]);
    if (u.includes("/service_jobs?select=")) return makeRes(200, [job]);
    if (u.includes("source_table=eq.service_jobs")) return makeRes(200, recogEntry ? [{ id: 11, ...recogEntry }] : []);
    if (u.includes("source_table=eq.service_payments")) return makeRes(200, payEntry ? [{ id: 22, ...payEntry }] : []);
    if (u.includes("/journal_lines?select=account_code")) {
      const id = /entry_id=eq\.(\d+)/.exec(u)?.[1];
      return makeRes(200, id === "11" ? (recogLines || []) : (payLines || []));
    }
    return makeRes(200, []);
  };
  globalThis.fetch = handler;
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") { posted.entries.push(JSON.parse(init.body)); return makeRes(201, [{ id: 9900 }]); }
    if (u.includes("/journal_lines") && init?.method === "POST") { posted.lines.push(...JSON.parse(init.body)); return makeRes(201, []); }
    return handler(url, init);
  };
}
beforeEach(() => { resetMappingCache(); });

test("B1. รับชำระ: recognition JV เป็น approved header ที่ไม่มี lines → ไม่โพสต์ Cr 1200 (zero writes)", async () => {
  install({ recogEntry: { status: "approved", total_debit: 1000, total_credit: 1000 }, recogLines: [] });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.status, "skipped");
  assert.match(res.reason, /^recognition-invalid:no-lines$/);
  assert.equal(posted.entries.length, 0);
});

test("B2. รับชำระ: recognition JV บัญชีผิด (Dr 1110 แทน 1200) แต่ยอดตรง → block", async () => {
  install({
    recogEntry: { status: "approved", total_debit: 1000, total_credit: 1000 },
    recogLines: [{ account_code: "1110", debit: 1000, credit: 0 }, { account_code: "4200", debit: 0, credit: 1000 }]
  });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.match(res.reason, /^recognition-invalid:account-mismatch$/);
  assert.equal(posted.entries.length, 0);
});

test("B3. รับชำระ: recognition JV draft → block (ยอดตรงก็ไม่ช่วย)", async () => {
  install({ recogEntry: { status: "draft", total_debit: 1000, total_credit: 1000 }, recogLines: goodRecogLines });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.match(res.reason, /^recognition-invalid:not-approved$/);
  assert.equal(posted.entries.length, 0);
});

test("B4. รับชำระ: recognition JV ถูกต้อง → โพสต์ Dr 1134 (บัญชีตาม ledger) / Cr 1200", async () => {
  install({ recogEntry: { status: "approved", total_debit: 1000, total_credit: 1000 }, recogLines: goodRecogLines });
  const res = await postJournalForServicePayment(501, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1134", 500, 0], ["1200", 0, 500]]);
});

test("B5. กลับรายการ: payment JV = counterexample (3 ขา) → block + zero writes", async () => {
  install({
    recogEntry: { status: "approved", total_debit: 1000, total_credit: 1000 }, recogLines: goodRecogLines,
    payEntry: { status: "approved", total_debit: 500, total_credit: 500 }, payLines: POISON_LINES
  });
  const res = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(res.status, "skipped");
  assert.match(res.reason, /^original-jv-invalid:extra-lines$/);
  assert.equal(posted.entries.length, 0, "ห้ามกลับรายการทับ JV ที่พังอยู่แล้ว");
});

test("B6. กลับรายการ: payment JV ถูกต้อง → Dr 1200 / Cr 1134 (บัญชีเงินเดิมเป๊ะ)", async () => {
  install({
    recogEntry: { status: "approved", total_debit: 1000, total_credit: 1000 }, recogLines: goodRecogLines,
    payEntry: { status: "approved", total_debit: 500, total_credit: 500 }, payLines: goodPayLines
  });
  const res = await postJournalForServicePaymentReversal(700, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1200", 500, 0], ["1134", 0, 500]]);
});

test("B7. writer ห้ามใช้ find() หยิบบรรทัดแรก — ต้องผ่าน validator กลาง", () => {
  const body = AUTO_POST.slice(AUTO_POST.indexOf("export async function postJournalForServicePaymentReversal"),
                               AUTO_POST.indexOf("export async function reverseServicePayment"));
  assert.ok(!/\.find\(l =>/.test(body), "ห้าม find() บรรทัดแรกที่ debit/credit > 0");
  assert.match(body, /validatePaymentJv\(\{ payment: pay, mapping, entry: jv\.entry, lines: jv\.lines \}\)/);
});

// ═══════════════════════════════════════════════════════════
//  C. reconcile taxonomy (6 states) + flow-aware + recognition period
// ═══════════════════════════════════════════════════════════
test("C1. ledger taxonomy 6 สถานะ — draft/header-only/บัญชีผิด ต้องไม่ OK และซ่อมอัตโนมัติไม่ได้", () => {
  const payments = [
    { id: 1, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134" },  // ไม่มี JV
    { id: 2, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134" },  // draft
    { id: 3, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134" },  // header-only
    { id: 4, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134" }   // 3 ขา
  ];
  const jeRows = [
    { id: 92, source_table: "service_payments", source_id: 2, status: "draft", total_debit: 500, total_credit: 500 },
    { id: 93, source_table: "service_payments", source_id: 3, status: "approved", total_debit: 500, total_credit: 500 },
    { id: 94, source_table: "service_payments", source_id: 4, status: "approved", total_debit: 500, total_credit: 500 }
  ];
  const lineRows = [
    ...goodPayLines.map(l => ({ ...l, entry_id: 92 })),
    ...POISON_LINES.map(l => ({ ...l, entry_id: 94 }))
    // entry 93 = header-only (ไม่มี lines)
  ];
  const out = RECON.classifyLedgerJv({
    payments, reversals: [], jeRows, lineRows,
    jobsById: { "20": job }, mappingsByKey: { service_install_ac: MAPPING },
    mappingKeyOf: () => "service_install_ac"
  });
  assert.deepEqual(out.paymentNoJv.map(i => i.row.id), [1]);
  assert.deepEqual(out.paymentNonApproved.map(i => i.row.id), [2], "draft ต้องไม่ถูกนับว่า OK แม้ยอดตรง");
  assert.deepEqual(out.paymentMismatch.map(i => i.row.id).sort(), [3, 4], "header-only + บัญชีแปลกปลอม = MISMATCH");
  assert.deepEqual(out.paymentMismatch.map(i => i.state), ["PAYMENT_MISMATCH", "PAYMENT_MISMATCH"]);
  assert.deepEqual(RECON.LEDGER_AUTO_REPAIRABLE, ["PAYMENT_NO_JV", "REVERSAL_NO_JV"], "ซ่อมอัตโนมัติเฉพาะที่ไม่มี header");
  assert.equal(RECON.LEDGER_JV_STATES.length, 6);
});

test("C2. payment mismatch ต้องไม่ถูกเรียกว่า REVERSAL_MISMATCH (คนละกอง)", () => {
  const out = RECON.classifyLedgerJv({
    payments: [{ id: 4, service_job_id: 20, amount: 500, payment_method: "transfer", bank_coa_code: "1134" }],
    reversals: [],
    jeRows: [{ id: 94, source_table: "service_payments", source_id: 4, status: "approved", total_debit: 500, total_credit: 500 }],
    lineRows: POISON_LINES.map(l => ({ ...l, entry_id: 94 })),
    jobsById: { "20": job }, mappingsByKey: { service_install_ac: MAPPING }, mappingKeyOf: () => "service_install_ac"
  });
  assert.equal(out.paymentMismatch.length, 1);
  assert.equal(out.paymentMismatch[0].state, "PAYMENT_MISMATCH");
  assert.equal(out.reversalMismatch.length, 0);
});

test("C3. flow-aware: v2 + done ไม่ใช่ orphan · v1 + done ยังเป็น orphan ได้", () => {
  assert.equal(RECON.isRecognitionStatusForJob({ status: "done", finance_flow_version: 2 }), false);
  assert.equal(RECON.isRecognitionStatusForJob({ status: "delivered", finance_flow_version: 2 }), true);
  assert.equal(RECON.isRecognitionStatusForJob({ status: "closed", finance_flow_version: 2 }), true);
  assert.equal(RECON.isRecognitionStatusForJob({ status: "done", finance_flow_version: 1 }), true);
  assert.equal(RECON.isRecognitionStatusForJob({ status: "done" }), false, "flow ไม่รู้ = ไม่ flag");
});

test("C4. recognition period: created มิ.ย. + closed ก.ค. → อยู่ในรายงาน ก.ค. · created ก.ค. + closed ส.ค. → ไม่อยู่", async () => {
  const captured = [];
  const juneClosedJuly = { id: 40, job_no: "JOB-40", status: "delivered", total_cost: 500, job_type: "ac",
                           closed_at: "2026-07-05T03:00:00Z", created_at: "2026-06-20T03:00:00Z", finance_flow_version: 2 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) {
      captured.push(u);
      if (u.includes("closed_at=is.null")) return makeRes(200, []);
      // query ช่วง closed_at → คืนเฉพาะงานที่ปิดใน ก.ค. (งาน created ก.ค./closed ส.ค. ไม่เข้า filter ของ DB)
      return makeRes(200, [juneClosedJuly]);
    }
    if (u.includes("/journal_entries")) return makeRes(200, []);
    if (u.includes("/account_mapping")) return makeRes(200, [MAPPING]);
    return makeRes(200, []);
  };
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01", fromDate: "2026-07-01", toDate: "2026-07-31" });
  assert.equal(res.ok, true);
  const closedQ = captured.find(u => u.includes("closed_at=gte."));
  const nullQ = captured.find(u => u.includes("closed_at=is.null"));
  assert.ok(closedQ, "ต้อง query ด้วย closed_at (recognition period) ไม่ใช่ created_at");
  assert.ok(closedQ.includes("closed_at=gte.2026-07-01") && closedQ.includes("closed_at=lt.2026-08-01"),
    "ช่วงต้อง bound ด้วย closed_at ทั้งสองข้าง (created ก.ค./closed ส.ค. จึงไม่หลุดเข้า ก.ค.)");
  assert.ok(nullQ && nullQ.includes("created_at=gte."), "งาน closed_at=null query แยกด้วย created_at");
  assert.ok(!closedQ.includes("created_at=gte."), "ห้ามใช้ created_at เป็น recognition period");
  assert.deepEqual(res.orphans.map(j => j.id), [40], "created มิ.ย. ปิด ก.ค. → อยู่ในรายงาน ก.ค.");
});

test("C5. service JE ที่ draft / header-only → เป็น conflict (แจ้ง) ไม่ใช่ 'posted' เงียบ ๆ", async () => {
  const jobRow = { ...job, id: 41, job_no: "JOB-41", total_cost: 1000 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) return makeRes(200, u.includes("closed_at=is.null") ? [] : [jobRow]);
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) {
      return makeRes(200, [{ id: 55, source_id: 41, status: "draft", total_debit: 1000, total_credit: 1000, description: "" }]);
    }
    if (u.includes("/journal_lines?select=")) return makeRes(200, goodRecogLines.map(l => ({ ...l, entry_id: 55 })));
    if (u.includes("/account_mapping")) return makeRes(200, [MAPPING]);
    return makeRes(200, []);
  };
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.orphans.length, 0, "มี header อยู่ → ยิงทับไม่ได้ ไม่ใช่ orphan");
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].state, "SERVICE_NON_APPROVED");
  assert.equal(res.conflicts[0].reason, "not-approved");
  assert.match(RECONCILE, /ซ่อมอัตโนมัติไม่ได้/);
});

// ═══════════════════════════════════════════════════════════
//  D. SQL — freeze matrix · exact payment JV · mapping drift
// ═══════════════════════════════════════════════════════════
test("D1. SQL freeze: อนุญาตเฉพาะ เดิม→เดิม และ delivered→closed · block cancelled/rollback/closed→delivered", () => {
  const trg = SQL.slice(SQL.indexOf("FUNCTION public.guard_service_job_v2_freeze"), SQL.indexOf("DROP TRIGGER IF EXISTS trg_service_job_v2_freeze"));
  assert.match(trg, /IF v_new IS DISTINCT FROM v_old\s*\n\s*AND NOT \(v_old = 'delivered' AND v_new = 'closed'\) THEN/,
    "transition ที่อนุญาต = เดิม→เดิม + delivered→closed เท่านั้น (cancelled/closed→delivered จึงถูก block)");
  assert.match(trg, /NEW\.total_cost IS DISTINCT FROM OLD\.total_cost[\s\S]{0,140}42501/);
  assert.match(trg, /NEW\.job_type IS DISTINCT FROM OLD\.job_type[\s\S]{0,140}42501/);
  // ยอด/ประเภทงาน frozen "ทุกสถานะ" → guard การแก้ยอดต้องอยู่ก่อน transition check
  assert.ok(trg.indexOf("NEW.total_cost IS DISTINCT FROM OLD.total_cost") < trg.indexOf("IF v_new IS DISTINCT FROM v_old"),
    "ต้องตรวจ frozen fields ก่อน (ย้อน status + แก้ยอดใน UPDATE เดียว = 42501)");
  assert.match(SQL, /BEFORE UPDATE ON public\.service_jobs/, "BEFORE UPDATE → runtime ไม่มีทางไปถึงขั้นคืนสต็อก");
  assert.match(SQL, /V6 \(behavioral/, "ต้องมี behavioral runbook (B1-B9)");
  for (const c of ["recognized delivered → cancelled", "recognized closed    → delivered", "recognized delivered → closed"]) {
    assert.ok(SQL.includes(c), `runbook ต้องมีเคส: ${c}`);
  }
});

test("D2. SQL service_payment_jv_is_valid: approved · 2 ขา · Dr ตาม ledger · Cr 1200 · ยอดตรง", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.service_payment_jv_is_valid"), SQL.indexOf("-- 3c) freeze"));
  assert.match(fn, /lower\(coalesce\(je\.status,''\)\) = 'approved'/);
  assert.match(fn, /IF v_cnt <> 2 THEN RETURN false/, "บรรทัดที่ไม่เป็นศูนย์ต้อง = 2 (กันบัญชีแปลกปลอม)");
  assert.match(fn, /WHEN 'transfer' THEN v_pay\.bank_coa_code/, "Dr โอน = บัญชีที่ ledger ระบุ");
  assert.match(fn, /WHEN 'cash'\s+THEN v_map\.debit_account_code/);
  assert.match(fn, /account_code = v_map\.recognition_debit_code[\s\S]{0,120}round\(v_cr,2\) <> v_amt THEN RETURN false/, "Cr = 1200 ยอดเต็ม");
  assert.match(fn, /round\(coalesce\(v_entry\.total_debit,0\),2\) <> v_amt[\s\S]{0,120}RETURN false/);
  // reverse RPC ต้องเรียก validator นี้ก่อน INSERT
  const rpc = SQL.slice(SQL.indexOf("FUNCTION public.reverse_service_payment_v2"));
  const idx = { valid: rpc.indexOf("service_payment_jv_is_valid"), insert: rpc.indexOf("INSERT INTO public.service_payment_reversals") };
  assert.ok(idx.valid > 0 && idx.valid < idx.insert, "ต้อง reject ก่อน INSERT reversal ledger (zero writes)");
});

test("D3. SQL mapping freeze: แก้บัญชีของ service_% ที่ถูกใช้ลง JV แล้ว → 42501 (กัน historical drift)", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.guard_service_mapping_freeze"), SQL.indexOf("-- 7) POST-CHECK"));
  assert.ok(/mapping_key NOT LIKE 'service.?_%'/.test(fn), "scope = mapping_key ที่ขึ้นต้น service_");
  assert.match(fn, /journal_entries je[\s\S]{0,220}service_mapping_key_for_job_type\(sj\.job_type\) = OLD\.mapping_key/);
  assert.match(fn, /42501/);
  assert.match(SQL, /CREATE TRIGGER trg_service_mapping_freeze\s+BEFORE UPDATE ON public\.account_mapping/);
  assert.match(SQL, /trg_service_mapping_freeze ต้องมีและ enabled/, "POST-CHECK ต้องยืนยัน trigger");
});
