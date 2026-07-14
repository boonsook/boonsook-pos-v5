// Phase 606-b1 (review #5) — DB authority readback · manual/unlinked JV · ledger banner · effective-date · toast policy
// Run: node --test tests/service_jv_authority_unlinked_guard.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

class El {
  constructor() { this.innerHTML = ""; }
  querySelectorAll(sel) { this._q = (this._q || []).concat(sel); return []; }
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

const { postJournalForServiceJob, resetMappingCache } = await import("../modules/accounting/auto_post.js");
const RECON = await import("../modules/service_reconcile.js");
const V = await import("../modules/accounting/service_jv_validate.js");
const { ACCOUNTING_EFFECTIVE_DATE } = await import("../modules/accounting/effective_date.js");

const read = (f) => fs.readFileSync(path.resolve(f), "utf8");
const SQL = read("supabase-phase606b1-service-payment-guards.sql");
const RECONCILE = read("modules/service_reconcile.js");

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bad = (status) => ({ ok: false, status, json: async () => null, text: async () => "boom" });

const MAPPING = { mapping_key: "service_install_ac", debit_account_code: "1110", credit_account_code: "4200",
                  transfer_debit_code: "1136", recognition_debit_code: "1200", is_active: true };
const GREEN = "ไม่พบงานปิดแล้วที่ยังไม่เข้าบัญชี";
const toasts = [];
const ctx = { showToast: (m) => toasts.push(m) };

// ═══════════════════════════════════════════════════════════
//  A. flow หายจาก caller → DB คือ authority (blocking 1)
// ═══════════════════════════════════════════════════════════
// caller shape จริงจาก main.js: {...state.serviceJobs[i], ...payload} — งานที่เพิ่ง INSERT อาจไม่มี flow
const formJob = { id: 20, job_no: "JOB-20", job_type: "ac", customer_name: "ก", status: "delivered",
                  total_cost: 1000, closed_at: "2026-07-05T03:00:00Z", payment_method: "cash" };  // ← ไม่มี finance_flow_version

let posted, jobFetches;
function installDb({ dbJob = undefined, dbFail = false } = {}) {
  posted = { entries: [], lines: [] };
  jobFetches = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=*")) {
      jobFetches.push(u);
      if (dbFail) return bad(500);
      return ok(dbJob ? [dbJob] : []);
    }
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    if (u.includes("/chart_of_accounts")) return ok(["1110", "1134", "1200", "4200"].map(code => ({ code })));
    if (u.includes("/accounting_periods")) return ok([]);
    if (u.includes("/journal_entries?select=doc_no")) return ok([]);
    return ok([]);
  };
  window._appAuthFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/journal_entries") && init?.method === "POST") { posted.entries.push(JSON.parse(init.body)); return { ok: true, status: 201, json: async () => [{ id: 777 }], text: async () => "[]" }; }
    if (u.includes("/journal_lines") && init?.method === "POST") { posted.lines.push(...JSON.parse(init.body)); return { ok: true, status: 201, json: async () => [], text: async () => "[]" }; }
    return globalThis.fetch(url, init);
  };
}
beforeEach(() => { resetMappingCache(); toasts.length = 0; container.innerHTML = ""; });

test("A1. payload ไม่มี flow + DB คืน v1 → โพสต์แบบ legacy (Dr 1110 เงินสด / Cr 4200)", async () => {
  installDb({ dbJob: { ...formJob, finance_flow_version: 1 } });
  const res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.status, "posted");
  assert.equal(jobFetches.length, 1, "ต้อง read-back จาก DB");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1110", "4200"]);
});

test("A2. payload ไม่มี flow + DB คืน v2 → กติกา v2 (Dr 1200 ลูกหนี้)", async () => {
  installDb({ dbJob: { ...formJob, finance_flow_version: 2 } });
  const res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => l.account_code), ["1200", "4200"]);
});

test("A3. payload ขัดกับ DB → **DB คือ authority ทั้งแถว** (ห้ามใช้ยอด/สถานะจากฟอร์ม)", async () => {
  installDb({ dbJob: { ...formJob, finance_flow_version: 2, total_cost: 300, status: "delivered", closed_at: "2026-07-09T03:00:00Z" } });
  const res = await postJournalForServiceJob({ ...formJob, total_cost: 99999, payment_method: "transfer" }, { detailed: true });
  assert.equal(res.status, "posted");
  assert.deepEqual(posted.lines.map(l => [l.account_code, l.debit, l.credit]), [["1200", 300, 0], ["4200", 0, 300]],
    "ยอดต้องมาจาก DB (300) ไม่ใช่ฟอร์ม (99999)");
  assert.equal(posted.entries[0].doc_date, "2026-07-09", "วันรับรู้ก็มาจาก DB");
});

test("A4. DB fetch error / ไม่พบ row / flow ไม่ถูกต้อง → fail-closed + zero writes", async () => {
  installDb({ dbFail: true });
  let res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "job-read-failed");
  assert.equal(posted.entries.length, 0);

  installDb({ dbJob: undefined });
  res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.reason, "job-not-found");
  assert.equal(posted.entries.length, 0);

  for (const flow of [null, 0, 3, "x"]) {
    installDb({ dbJob: { ...formJob, finance_flow_version: flow } });
    res = await postJournalForServiceJob(formJob, { detailed: true });
    assert.equal(res.reason, "finance-flow-unknown", `flow=${flow}`);
    assert.equal(posted.entries.length, 0);
  }
});

test("A5. readback เกิด **ก่อน** gate อื่น (deleted / missing / date / mapping) — ใช้ค่า DB ตัดสิน", async () => {
  // ฟอร์มดูดี แต่ DB บอกว่างานถูกลบแล้ว → ต้อง skip 'deleted' (ไม่ใช่ posted)
  installDb({ dbJob: { ...formJob, finance_flow_version: 2, note: "[ลบแล้ว]" } });
  let res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.reason, "deleted");
  assert.equal(posted.entries.length, 0);

  // ฟอร์มมี closed_at แต่ DB ไม่มี → ต้อง block recognition-date-required
  installDb({ dbJob: { ...formJob, finance_flow_version: 2, closed_at: null } });
  res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.reason, "recognition-date-required");
  assert.equal(posted.entries.length, 0);

  // ฟอร์มมียอด แต่ DB ไม่มียอด → missing-required (ไม่ใช่โพสต์ด้วยยอดจากฟอร์ม)
  installDb({ dbJob: { ...formJob, finance_flow_version: 2, total_cost: null } });
  res = await postJournalForServiceJob(formJob, { detailed: true });
  assert.equal(res.reason, "missing-required");
  assert.equal(posted.entries.length, 0);
});

test("A6. row ที่มี flow อยู่แล้ว → ไม่ต้อง read-back (ไม่เพิ่ม request)", async () => {
  installDb({ dbJob: { ...formJob, finance_flow_version: 2 } });
  await postJournalForServiceJob({ ...formJob, finance_flow_version: 1 }, { detailed: true });
  assert.equal(jobFetches.length, 0, "มี metadata ครบแล้ว = ไม่อ่านซ้ำ");
});

// ═══════════════════════════════════════════════════════════
//  B. manual / unlinked JV (blocking 2)
// ═══════════════════════════════════════════════════════════
const closedJob = { id: 30, job_no: "JOB-30", customer_name: "ข", status: "closed", total_cost: 500, job_type: "ac",
                    closed_at: "2026-07-08T03:00:00Z", finance_flow_version: 2, created_at: "2026-07-01T03:00:00Z" };
const noDateJob = { ...closedJob, id: 31, job_no: "JOB-31", closed_at: null };

function installRecon({ jobs = [closedJob], noDate = [], unlinked = [], unlinkedFail = false, unlinkedRows = null } = {}) {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/service_jobs?select=")) return ok(u.includes("closed_at=is.null") ? noDate : jobs);
    if (u.includes("source_id=is.null")) {
      if (unlinkedFail) return bad(500);
      return ok(unlinkedRows || unlinked);
    }
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) return ok([]);
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    if (u.includes("/service_payments?select=")) return ok([]);
    if (u.includes("/service_payment_reversals?select=")) return ok([]);
    if (u.includes("/journal_entries?source_table=in.")) return ok([]);
    if (u.includes("/journal_lines?select=")) return ok([]);
    return ok([]);
  };
  return urls;
}

test("B1. query ดึง JE ที่ source_id IS NULL จริง (bounded) — ไม่ใช่ inject array เข้า helper", async () => {
  const urls = installRecon({});
  await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  const q = urls.find(u => u.includes("source_id=is.null"));
  assert.ok(q, "ต้องมี query source_id=is.null");
  assert.match(q, /limit=5000/, "ต้อง bounded");
  assert.match(q, /description=ilike\./, "กรองด้วย marker เลขงาน");
});

test("B2. manual JV อ้างเลขงานตรงตัว → SERVICE_JV_UNLINKED และไม่มีปุ่ม re-post", async () => {
  installRecon({ unlinked: [{ id: 900, description: "ลงบัญชีเอง งานบริการ JOB-30 — ข", status: "approved", total_debit: 500, total_credit: 500 }] });
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.orphans.length, 0, "ห้ามเป็น orphan (ปุ่ม re-post = รายได้ซ้ำ)");
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].state, "SERVICE_JV_UNLINKED");
  assert.equal(res.conflicts[0].entryId, 900);

  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, /SERVICE_JV_UNLINKED/);
  assert.ok(!container.innerHTML.includes("svc-recon-repost"), "conflict นี้ห้ามมีปุ่มซ่อมอัตโนมัติ");
});

test("B3. เลขงานใกล้เคียงแต่ไม่ตรงตัว (JOB-300 / JOB-3) → ห้าม match", async () => {
  installRecon({ unlinked: [{ id: 901, description: "งานบริการ JOB-300 — คนละงาน", status: "approved", total_debit: 500, total_credit: 500 }] });
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.conflicts.length, 0, "JOB-300 ≠ JOB-30");
  assert.equal(res.orphans.length, 1, "ยังเป็น orphan ปกติ");
});

test("B4. ไม่มี manual JV → orphan เดิม + ปุ่ม re-post ยังทำงาน", async () => {
  installRecon({ unlinked: [] });
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.deepEqual(res.orphans.map(j => j.id), [30]);
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, /svc-recon-repost/);
});

test("B5. noDate + manual JV → SERVICE_JV_UNLINKED (ไม่ใช่ OWNER_RECOGNITION_DATE_REQUIRED)", async () => {
  installRecon({ jobs: [], noDate: [noDateJob], unlinked: [{ id: 902, description: "JOB-31 ลงเอง", status: "approved", total_debit: 500, total_credit: 500 }] });
  const res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.needRecognitionDate.length, 0);
  assert.equal(res.conflicts[0].state, "SERVICE_JV_UNLINKED");
});

test("B6. unlinked query ล้มเหลว / ชน limit → fail-closed (ไม่มีการ์ดเขียว)", async () => {
  installRecon({ unlinkedFail: true });
  let res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.ok, false);

  const many = Array.from({ length: 5000 }, (_, i) => ({ id: i, description: `JOB-${i}`, status: "approved", total_debit: 1, total_credit: 1 }));
  installRecon({ unlinkedRows: many });
  res = await RECON.fetchServiceJVStatus({ effectiveDate: "2026-07-01" });
  assert.equal(res.ok, false);
  assert.equal(res.dataIncomplete, true);

  await RECON._loadAndRender(ctx, container);
  assert.ok(!container.innerHTML.includes(GREEN));
});

// ═══════════════════════════════════════════════════════════
//  C. ledger ล้ม ห้ามกลืน service findings (blocking 3)
// ═══════════════════════════════════════════════════════════
function installMixed({ jobs = [closedJob], ledgerFail = false, ledgerLimit = false } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/service_jobs?select=")) return ok(u.includes("closed_at=is.null") ? [] : jobs);
    if (u.includes("source_id=is.null")) return ok([]);
    if (u.includes("/journal_entries?source_table=eq.service_jobs")) return ok([]);
    if (u.includes("/account_mapping")) return ok([MAPPING]);
    if (u.includes("/service_payments?select=")) {
      if (ledgerFail) return bad(500);
      if (ledgerLimit) return ok(Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, service_job_id: 30, amount: 1, payment_method: "cash" })));
      return ok([]);
    }
    if (u.includes("/service_payment_reversals?select=")) return ok([]);
    if (u.includes("/journal_entries?source_table=in.")) return ok([]);
    if (u.includes("/journal_lines?select=")) return ok([]);
    return ok([]);
  };
}

test("C1. service orphan + ledger HTTP fail → เห็นทั้ง orphan และ LEDGER_UNAVAILABLE (ไม่เขียว)", async () => {
  installMixed({ ledgerFail: true });
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, /JOB-30/, "service finding ต้องไม่หายไป");
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
  assert.ok(!container.innerHTML.includes(GREEN));
  assert.ok(!container.innerHTML.includes("svc-recon-ledger-retry"), "ห้ามเปิดปุ่มซ่อม ledger ที่ข้อมูลไม่ครบ");
});

test("C2. service conflict + ledger limit → เห็น conflict และ DATA_INCOMPLETE", async () => {
  installMixed({ ledgerLimit: true });
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, /JOB-30/);
  assert.match(container.innerHTML, /DATA_INCOMPLETE/);
  assert.ok(!container.innerHTML.includes(GREEN));
});

test("C3. service สะอาด + ledger fail → unavailable เท่านั้น ห้ามเขียว · ทั้งคู่สะอาด → เขียวได้", async () => {
  installMixed({ jobs: [], ledgerFail: true });
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, /LEDGER_UNAVAILABLE/);
  assert.ok(!container.innerHTML.includes(GREEN));

  container.innerHTML = "";
  installMixed({ jobs: [] });
  await RECON._loadAndRender(ctx, container);
  assert.match(container.innerHTML, new RegExp(GREEN));
});

// ═══════════════════════════════════════════════════════════
//  D. SQL paid_at effective boundary (blocking 4)
// ═══════════════════════════════════════════════════════════
test("D1. SQL: paid_at ก่อน effective date (เวลาไทย) → 22023 · gate อยู่ก่อน idempotency/INSERT", () => {
  const rpc = SQL.slice(SQL.indexOf("FUNCTION public.record_service_payment_v2"), SQL.indexOf("FUNCTION public.reverse_service_payment_v2"));
  assert.match(rpc, /\(p_paid_at AT TIME ZONE 'Asia\/Bangkok'\)::date < DATE '2026-07-01'/, "ตัดสินตามวันไทย ไม่ใช่ UTC");
  assert.match(rpc, /ERRCODE = '22023'/);
  const gate = rpc.indexOf("AT TIME ZONE 'Asia/Bangkok'");
  const idem = rpc.indexOf("SELECT * INTO v_existing");
  const ins = rpc.indexOf("INSERT INTO public.service_payments");
  assert.ok(gate > 0 && gate < idem && gate < ins, "ต้องอยู่ก่อน idempotency return และก่อน INSERT (retry pre-effective ก็ต้องถูกปฏิเสธ)");
  assert.ok(!/p_paid_at::date < DATE/.test(rpc), "ห้ามใช้ UTC date ตรง ๆ");
  assert.match(SQL, /B11 paid_at boundary/, "runbook boundary cases");
});

test("D2. drift: วันใน SQL ต้องตรง ACCOUNTING_EFFECTIVE_DATE ของ runtime", () => {
  assert.equal(ACCOUNTING_EFFECTIVE_DATE, "2026-07-01");
  const dates = [...SQL.matchAll(/DATE '(\d{4}-\d{2}-\d{2})'/g)].map(m => m[1]);
  assert.ok(dates.length > 0);
  for (const d of dates) assert.equal(d, ACCOUNTING_EFFECTIVE_DATE, "วันใน SQL ต้องไม่ drift จาก effective_date.js");
});

// ═══════════════════════════════════════════════════════════
//  E. legacy validator strict (blocking 5) + toast policy (should-fix)
// ═══════════════════════════════════════════════════════════
const legacyJob = { id: 10, total_cost: 600 };
const legacyEntry = { status: "approved", total_debit: 600, total_credit: 600 };
const legacyLines = [{ account_code: "1110", debit: 600, credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }];

test("E1. legacy: null / '' / missing property / NaN / Infinity → bad-number · 0 จริงยังเป็น 0", () => {
  assert.equal(V.validateLegacyServiceJv({ job: legacyJob, entry: legacyEntry, lines: legacyLines }).ok, true);
  const bads = [
    [{ account_code: "1110", debit: null, credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }],
    [{ account_code: "1110", debit: "", credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }],
    [{ account_code: "1110", debit: 600 }, { account_code: "4200", debit: 0, credit: 600 }],
    [{ account_code: "1110", debit: NaN, credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }],
    [{ account_code: "1110", debit: Infinity, credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }]
  ];
  for (const lines of bads) {
    assert.equal(V.validateLegacyServiceJv({ job: legacyJob, entry: legacyEntry, lines }).reason, V.JV_BAD_NUMBER);
  }
  assert.equal(V.validateLegacyServiceJv({ job: legacyJob, entry: { status: "approved", total_debit: 600 }, lines: legacyLines }).reason, V.JV_BAD_NUMBER,
    "header ขาด total_credit = bad-number");
  assert.equal(V.validateLegacyServiceJv({ job: legacyJob, entry: { status: "draft", total_debit: 600, total_credit: 600 }, lines: legacyLines }).reason, V.JV_NOT_APPROVED);
});

test("E2. legacy: ห้ามบังคับ account code แบบ v2 — JV เดิม (Dr 1136 ธนาคาร) ยังถูกต้อง", () => {
  const bankLines = [{ account_code: "1136", debit: 600, credit: 0 }, { account_code: "4200", debit: 0, credit: 600 }];
  assert.equal(V.validateLegacyServiceJv({ job: legacyJob, entry: legacyEntry, lines: bankLines }).ok, true);
});

test("E3. reconcile ต้องใช้ shared validator (ไม่มี logic ชุดที่สอง / ไม่มี Number()||0)", () => {
  assert.match(RECONCILE, /validateLegacyServiceJv\(\{ job, entry, lines \}\)/);
  assert.ok(!/function validateTwoLegLegacy/.test(RECONCILE), "ห้ามมี validator ซ้ำในไฟล์นี้");
  // ห้ามมี numeric coercion แบบหลวมในเส้นทาง "ตรวจ JV" (fmtAmount = display เท่านั้น อนุญาต)
  assert.ok(!/Number\((?:l|line)\.(?:debit|credit)/.test(RECONCILE), "ตัวเลขของ line ต้องผ่าน shared validator เท่านั้น");
  const code = RECONCILE.replace(/\/\/[^\n]*/g, "");            // ตัดคอมเมนต์ก่อนนับ
  const loose = [...code.matchAll(/Number\([^)]*\)\s*\|\|\s*0/g)].map(m => m[0]);
  assert.equal(loose.length, 1, "เหลือได้แค่จุดเดียวคือ fmtAmount (แสดงผล)");
  assert.match(RECONCILE.slice(RECONCILE.indexOf("function fmtAmount")), /^function fmtAmount[\s\S]{0,120}Number\(n\) \|\| 0/);
});

test("E4. toast policy: helper เดียวครอบทุกผล และใช้ทั้ง _handleRepost และ _handleLedgerRetry", () => {
  assert.equal(V.jvResultToToast({ status: "posted", entryId: 9 }).kind, "success");
  assert.equal(V.jvResultToToast({ status: "skipped", reason: "duplicate-valid" }).kind, "success");
  const dup = V.jvResultToToast({ status: "skipped", reason: "duplicate-invalid:no-lines" });
  assert.equal(dup.kind, "error");
  assert.match(dup.message, /ไม่ถูกต้อง/);
  assert.ok(!dup.message.includes("✅"), "ห้ามสื่อว่าสำเร็จ");
  assert.equal(V.jvResultToToast({ status: "skipped", reason: "duplicate" }).kind, "info");
  assert.equal(V.jvResultToToast({ status: "skipped", reason: "recognition-date-required" }).kind, "error");
  assert.equal(V.jvResultToToast({ status: "failed", reason: "job-read-failed" }).kind, "error");
  // ทั้งสอง handler ต้องเรียก helper เดียวกัน (ไม่ใช่ branch ซ้ำคนละชุด)
  assert.equal((RECONCILE.match(/jvResultToToast\(res\)\.message/g) || []).length, 2);
  const repost = RECONCILE.slice(RECONCILE.indexOf("async function _handleRepost"), RECONCILE.indexOf("export function renderServiceReconcilePage"));
  assert.match(repost, /jvResultToToast/);
});
