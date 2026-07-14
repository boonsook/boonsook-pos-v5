// Phase 606-a — Service Finance V2 FOUNDATION guard (fail-closed)
//
// เฟสนี้ต้องจบด้วย "ฐานพร้อมแต่ยังใช้ไม่ได้":
//   - **เปิด flow v2 ไม่ได้เลย** (INSERT/UPDATE เป็น 2 ถูกปฏิเสธทุก role รวม admin/service_role)
//   - ledger มีแต่ไม่มี caller · RPC บังคับ v2 → ใช้กับงานจริงไม่ได้
//   - ไม่มี side effect ทางบัญชี (ห้ามแตะ journal_entries/journal_lines)
//   - audit script fail-closed (probe/metadata/flow version ผิด = DATA_INCOMPLETE ไม่เดา)
//
// guard 2 ชั้น: (a) SQL static (extract บล็อกเฉพาะจุด — ตัด `--` comment ก่อน assert เชิงลบ)
//              (b) pure helper ฝั่ง audit script
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SOURCE_KINDS, deriveSourceKindFromMarkers, serviceJobSourceKindOf, isWebOrderJob, isServiceIncomeJob,
  isMissingMetaColumnError,
} from "../scripts/finance_reconcile_lib.js";
import {
  SERVICE_FLOW_STATES, financeFlowVersionOf, classifyServiceFlowState, summarizeServiceFlow,
} from "../scripts/service_no_jv_classify_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const SQL = read("supabase-phase606a-service-finance-foundation.sql");
const CLASSIFY = read("scripts/service_no_jv_classify.js");
const RECONCILE = read("scripts/finance_reconcile_audit.js");

const executable = SQL.replace(/\/\*[\s\S]*?\*\//g, "");                    // ตัด runbook (block comment)
const code = (s) => s.split(/\r?\n/).map(l => l.replace(/--.*$/, "")).join("\n");   // ตัด `--` comment
const EXEC_CODE = code(executable);
const block = (from, to) => {
  const a = executable.indexOf(from);
  assert.ok(a >= 0, `ต้องเจอบล็อก: ${from}`);
  const b = to ? executable.indexOf(to, a) : executable.length;
  return executable.slice(a, b > a ? b : executable.length);
};

const job = (o = {}) => ({ id: 1, job_no: "JOB-1", status: "delivered", total_cost: 1000, note: "", sub_service: "", closed_at: "2026-07-09T03:00:00Z", ...o });

// ═══ A. SQL — โครงสร้าง / ไม่มี side effect บัญชี ═══
test("A1. transaction เดียว + preflight fail-fast (อ่าน type จริง + bank allowlist) + ไม่แตะ journal", () => {
  assert.match(executable, /^\s*BEGIN;/m);
  assert.match(executable, /^COMMIT;/m);
  const pre = block("-- 1) PREFLIGHT", "-- 2) service_jobs metadata");
  for (const need of ["service_jobs", "account_mapping", "chart_of_accounts", "journal_entries",
    "is_admin()", "is_accountant()", "idx_je_source_unique", "'1200'", "total_cost", "closed_at",
    "'^11[3-6][0-9]$'"]) {
    assert.ok(pre.includes(need), `preflight ต้องตรวจ ${need}`);
  }
  assert.match(pre, /format_type\(a\.atttypid/, "ต้องอ่าน type จริง (ห้ามเดา)");
  assert.match(pre, /RAISE EXCEPTION/);
  // ★ ห้าม DML ต่อ journal ในโค้ดจริง
  assert.ok(!/(INSERT|UPDATE|DELETE)[\s\S]{0,80}journal_(entries|lines)/i.test(EXEC_CODE));
  // ★ backfill ห้ามแตะ field เดิม
  for (const u of [...EXEC_CODE.matchAll(/UPDATE public\.service_jobs[\s\S]*?;/g)].map(m => m[0])) {
    assert.ok(!/SET[\s\S]*?\b(status|closed_at|total_cost|payment_method|items_json)\b\s*=/.test(u));
  }
  assert.ok(!/\b(83|41|36|6950|101130|47150)\b/.test(EXEC_CODE), "ห้าม hardcode ตัวเลข production");
});

test("A2. ledger: FK type จริง (dynamic DDL) · unique(job,idem) · cash/transfer ↔ bank · ถ้ามีอยู่แล้วต้อง verify", () => {
  const b = block("-- 8) service_payments", "-- 9) RLS");
  assert.match(b, /format_type\(a\.atttypid, a\.atttypmod\) INTO v_id_type/);
  assert.match(b, /EXECUTE format\(/);
  assert.match(b, /service_job_id\s+%s NOT NULL REFERENCES public\.service_jobs\(id\) ON DELETE RESTRICT/);
  assert.match(b, /CONSTRAINT chk_service_payments_amount_finite/, "amount ต้องมี CHECK กัน NaN/Infinity");
  assert.match(b, /CHECK \(amount > 0 AND lower\(amount::text\) NOT IN \('nan','infinity','-infinity'\)\)/);
  assert.match(b, /CONSTRAINT uq_service_payments_job_idem UNIQUE \(service_job_id, idempotency_key\)/);
  assert.ok(!/UNIQUE \(service_job_id\)\s*[,)]/.test(b), "ห้าม unique ที่ job เดี่ยว");
  assert.match(b, /CONSTRAINT chk_service_payments_bank_by_method/);
  // ★ should-fix: มีอยู่แล้ว → verify columns/type/unique/check/FK (ไม่ใช่ NOTICE แล้วข้าม)
  const existing = b.slice(b.indexOf("ELSE"));
  assert.match(existing, /ขาดคอลัมน์/);
  assert.match(existing, /service_payments\.service_job_id เป็น %/);
  assert.match(existing, /numeric\(14,2\)/);
  // ★ should-fix: พิสูจน์จาก "นิยามจริง" (conkey/expression/ON DELETE) ไม่ใช่แค่ชื่อ constraint
  assert.match(existing, /c\.conkey = ARRAY\[[\s\S]{0,200}attname='service_job_id'[\s\S]{0,200}attname='idempotency_key'/);
  assert.match(existing, /pg_get_constraintdef\(c\.oid\) ILIKE '%payment_method%cash%bank_coa_code IS NULL%'/);
  assert.match(existing, /pg_get_constraintdef\(c\.oid\) ILIKE '%amount%'[\s\S]{0,120}'%nan%'/);
  assert.match(existing, /c\.confdeltype='r'/, "FK ต้องเป็น ON DELETE RESTRICT จริง");
});

test("A3. INSERT trigger fail-closed: ไม่เชื่อ client · flow บังคับ 1 · payment_due_date เฉพาะแอดมิน", () => {
  const trg = block("-- 4) INSERT trigger", "-- 5) UPDATE guard");
  assert.match(trg, /BEFORE INSERT ON public\.service_jobs/);
  assert.match(trg, /COALESCE\(public\.is_admin\(\), false\)/, "authority ต้อง fail-closed");
  // source_kind: derive เสมอ + ขัดกับ marker = 42501
  assert.match(trg, /v_derived := public\.derive_service_source_kind\(NEW\.job_no, NEW\.note, NEW\.sub_service\)/);
  assert.match(trg, /NEW\.source_kind IS NOT NULL AND NEW\.source_kind <> v_derived[\s\S]{0,200}42501/);
  assert.match(trg, /NEW\.source_kind := v_derived;/, "ต้อง derive เสมอ (ไม่เชื่อ client)");
  // flow version: บังคับ 1 · ส่ง 2 มา = 42501
  assert.match(trg, /NEW\.finance_flow_version IS NOT NULL AND NEW\.finance_flow_version <> 1[\s\S]{0,200}42501/);
  assert.match(trg, /NEW\.finance_flow_version := 1;/);
  // payment_due_date: non-admin = 42501
  assert.match(trg, /NEW\.payment_due_date IS NOT NULL AND NOT \(v_is_system OR v_is_admin\)[\s\S]{0,150}42501/);
  assert.ok(!/NEW\.(status|closed_at|total_cost|payment_method)\s*:=/.test(code(trg)));
  assert.ok(!/DEFAULT\s+'service'/.test(EXEC_CODE), "ห้าม DEFAULT 'service'");
});

test("A4. UPDATE guard: ยกเป็น flow v2 ไม่ได้ทุก role (รวม admin/service_role) — 606-b เท่านั้นที่ปลด", () => {
  const g = block("-- 5) UPDATE guard", "-- 6) BACKFILL");
  assert.match(g, /BEFORE UPDATE ON public\.service_jobs/);
  // ★ blocking 1.2: v2 ถูกบล็อกก่อนเช็ค role → admin/service_role ก็ทำไม่ได้
  const v2Block = g.slice(g.indexOf("NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version"));
  const v2Idx = v2Block.indexOf("NEW.finance_flow_version = 2");
  const adminIdx = v2Block.indexOf("v_is_system OR v_is_admin");
  assert.ok(v2Idx >= 0 && adminIdx > v2Idx, "การบล็อก v2 ต้องมาก่อนการยกเว้น admin/service_role");
  assert.match(v2Block.slice(v2Idx, v2Idx + 300), /42501/);
  assert.match(g, /activation migration 606-b/);
  for (const f of ["source_kind", "payment_due_date"]) {
    assert.ok(new RegExp(`NEW\\.${f} IS DISTINCT FROM OLD\\.${f} AND NOT \\(v_is_system OR v_is_admin\\)`).test(g),
      `non-admin ต้องแก้ ${f} ไม่ได้`);
  }
  assert.match(g, /COALESCE\(public\.is_admin\(\), false\)/);
});

test("A5. deriver anchored + case-insensitive (ตรงกับ JS /i) · ไม่ผูก lifecycle · backfill idempotent + NOT NULL", () => {
  const d = block("-- 3) canonical source-kind deriver", "-- 4) INSERT trigger");
  assert.match(d, /IMMUTABLE/);
  assert.match(d, /~\* '\^\(AI\|SH\)-'/, "job_no ต้อง anchored + case-insensitive (~*)");
  for (const like of ["ILIKE 'AI Sales:%'", "ILIKE 'AC Shop:%'", "ILIKE 'SH-transfer|%'",
    "ILIKE 'SH-cod_cash|%'", "ILIKE 'SH-cod_transfer|%'"]) {
    assert.ok(d.includes(like), `ต้องเป็น ILIKE anchored: ${like}`);
  }
  assert.ok(!/status|cancelled|ลบแล้ว/.test(code(d)), "identity ห้ามผูกกับ lifecycle");

  const bf = block("-- 6) BACKFILL", "-- 7) account_mapping");
  assert.match(bf, /WHERE source_kind IS NULL/);
  assert.match(bf, /SET finance_flow_version = 1[\s\S]{0,80}WHERE finance_flow_version IS NULL/);
  assert.ok(!/(cancelled|ลบแล้ว)/.test(code(bf)));
  // ★ blocking 1.3: หลัง backfill ต้อง NOT NULL + CHECK ไม่รับ NULL
  assert.match(bf, /ALTER COLUMN source_kind\s+SET NOT NULL/);
  assert.match(bf, /ALTER COLUMN finance_flow_version SET NOT NULL/);
  assert.match(bf, /CHECK \(source_kind IN \('service','web_order'\)\)/);
  assert.match(bf, /CHECK \(finance_flow_version IN \(1,2\)\)/);
  assert.ok(!/CHECK \(source_kind IS NULL OR/.test(EXEC_CODE), "CHECK ต้องไม่อนุญาต NULL");
  assert.ok(!/CHECK \(finance_flow_version IS NULL OR/.test(EXEC_CODE));
  // ★ should-fix: pg_constraint check ต้องผูก conrelid
  for (const m of [...EXEC_CODE.matchAll(/FROM pg_constraint\s+WHERE conname=[^;]+/g)].map(x => x[0])) {
    assert.ok(/conrelid=/.test(m), "pg_constraint check ต้องระบุ conrelid");
  }
});

test("A6. recognition mapping 1200 · ไม่แตะ mapping เดิม", () => {
  const b = block("-- 7) account_mapping", "-- 8) service_payments");
  assert.match(b, /ADD COLUMN IF NOT EXISTS recognition_debit_code TEXT/);
  assert.match(b, /FOREIGN KEY \(recognition_debit_code\) REFERENCES public\.chart_of_accounts\(code\)/);
  assert.match(b, /SET recognition_debit_code = '1200'[\s\S]{0,140}mapping_key LIKE 'service\\_%'/);
  assert.ok(!/SET[\s\S]{0,40}\b(debit_account_code|credit_account_code|transfer_debit_code)\b\s*=/.test(EXEC_CODE));
});

test("A7. RLS fail-closed: SELECT เฉพาะ is_accountant() · ไม่มี policy เขียน · grant ตรง", () => {
  const b = block("-- 9) RLS", "-- 10) RPC");
  assert.match(b, /ENABLE ROW LEVEL SECURITY/);
  assert.match(b, /FORCE ROW LEVEL SECURITY/);
  assert.match(b, /FOR SELECT\s+TO authenticated\s+USING \(COALESCE\(public\.is_accountant\(\), false\)\)/);
  assert.ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(code(b)));
  assert.match(b, /REVOKE ALL ON public\.service_payments FROM anon/);
  assert.match(b, /REVOKE ALL ON public\.service_payments FROM authenticated/);
  assert.match(b, /GRANT SELECT ON public\.service_payments TO authenticated/);
  assert.ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*service_payments/.test(code(b)));
});

test("A8. RPC: authority/money/idempotency/bank fail-closed · ไม่โพสต์ JV · ไม่ PATCH cache", () => {
  const b = block("-- 10) RPC", "-- 11) POST-CHECK");
  assert.match(b, /SECURITY DEFINER/);
  assert.match(b, /SET search_path = public/);
  // (B2) authority fail-closed
  assert.match(b, /IF NOT COALESCE\(public\.is_admin\(\), false\) THEN[\s\S]{0,120}42501/);
  // (B3) money exact
  // ★ review#2: numeric NaN ใน PostgreSQL **เท่ากับตัวเอง** และ **มากกว่าตัวเลขทุกตัว**
  //   → `p_amount <> p_amount` ตรวจ NaN ไม่ได้ · CHECK (amount > 0) ก็ปล่อย NaN ผ่าน
  //   → ต้องเทียบด้วยข้อความ lower(value::text) IN ('nan','infinity',...)
  assert.ok(!/p_amount <> p_amount/.test(code(b)), "ห้ามใช้สูตร NaN แบบ IEEE ในโค้ดจริง (ผิดสำหรับ numeric)");
  assert.match(b, /lower\(p_amount::text\) IN \('nan','infinity','-infinity','\+infinity'\)/, "amount ต้อง reject NaN/Infinity ด้วยข้อความ");
  assert.match(b, /lower\(v_job\.total_cost::text\) IN \('nan','infinity'/, "total_cost ต้อง reject NaN/Infinity ด้วย");
  assert.match(b, /'infinity'::timestamptz/, "paid_at ต้อง finite");
  const roundIdx = b.indexOf("v_amount := round(p_amount::numeric, 2)");
  const checkIdx = b.indexOf("IF v_amount <= 0");
  assert.ok(roundIdx > 0 && checkIdx > roundIdx, "ต้องปัดก่อนแล้วค่อยตรวจ <= 0");
  assert.match(b, /IF v_paid \+ v_amount > v_total THEN/, "overpay ต้อง exact (ไม่มี +0.01)");
  assert.ok(!/\+ 0\.01/.test(code(b)), "ห้ามมี tolerance 0.01 ในการเทียบ overpay");
  assert.match(b, /23514/);
  assert.match(b, /greatest\(v_total - v_paid, 0\)/, "outstanding ห้ามติดลบ");
  // (B4) idempotency ก่อน business-state + เทียบ payload ครบ
  const idemIdx = b.indexOf("idempotency_key = p_idempotency_key");
  const stateIdx = b.indexOf("finance_flow_version, 1) <> 2");
  assert.ok(idemIdx > 0 && stateIdx > idemIdx, "idempotency lookup ต้องมาก่อน business-state validation");
  for (const f of ["v_existing.amount = v_amount", "v_existing.payment_method = v_method",
    "v_existing.bank_coa_code IS NOT DISTINCT FROM p_bank_coa_code", "v_existing.paid_at = p_paid_at",
    "v_existing.slip_url IS NOT DISTINCT FROM p_slip_url", "v_existing.note IS NOT DISTINCT FROM p_note"]) {
    assert.ok(b.includes(f), `idempotency ต้องเทียบ payload: ${f}`);
  }
  assert.match(b, /'inserted', false/);
  assert.match(b, /23505/);
  // (B5) bank allowlist — และต้องตรวจ "หลัง" idempotency lookup (retry เดิมผ่านได้แม้บัญชีถูกปิดภายหลัง)
  assert.match(b, /code ~ '\^11\[3-6\]\[0-9\]\$'/, "transfer ต้องจำกัดบัญชีธนาคาร 1130-1169");
  const bankIdx = b.indexOf("code ~ '^11[3-6][0-9]$'");
  const idemLookupIdx = b.indexOf("SELECT * INTO v_existing FROM public.service_payments");
  assert.ok(idemLookupIdx > 0 && bankIdx > idemLookupIdx, "bank allowlist ต้องตรวจหลัง idempotency lookup");
  assert.match(b, /'cash' AND p_bank_coa_code IS NOT NULL/);
  assert.match(b, /v_method NOT IN \('cash','transfer'\)/);
  assert.ok(/ห้าม default เป็นเงินสด/.test(b));
  // flow v2 บังคับ → ใช้กับงานจริงตอนนี้ไม่ได้
  assert.match(b, /finance_flow_version, 1\) <> 2/);
  assert.match(b, /source_kind, 'service'\) <> 'service'/);
  // ไม่แตะ journal / ไม่ PATCH cache
  assert.ok(!/journal_(entries|lines)/i.test(code(b)));
  assert.ok(!/UPDATE public\.service_jobs/.test(code(b)));
});

test("A9. POST-CHECK: NOT NULL · constraints · triggers enabled · ledger schema+ว่าง · flow2=0", () => {
  const b = block("-- 11) POST-CHECK", "COMMIT;");
  for (const need of ["source_kind IS NULL OR source_kind NOT IN", "finance_flow_version IS NULL OR finance_flow_version NOT IN",
    "finance_flow_version = 2", "FROM public.service_payments", "recognition_debit_code IS DISTINCT FROM '1200'",
    "attnotnull", "chk_service_jobs_source_kind", "chk_service_jobs_finance_flow_version",
    "tgenabled", "uq_service_payments_job_idem", "chk_service_payments_bank_by_method",
    "relrowsecurity AND relforcerowsecurity", "'%nan%'", "role_table_grants"]) {
    assert.ok(b.includes(need), `post-check ต้องตรวจ: ${need}`);
  }
  assert.ok((b.match(/RAISE EXCEPTION/g) || []).length >= 10, "ทุกเงื่อนไขต้อง fail-fast");
  assert.match(SQL, /STEP 0 — READ-ONLY INSPECT/);
  assert.match(SQL, /VERIFY \(count-only/);
  assert.match(SQL, /ROLLBACK GUIDANCE/);
  assert.match(SQL, /NOTIFY pgrst, 'reload schema'/);
});

// ═══ B. audit helpers — identity / flow version fail-closed ═══
test("B1. source identity: DB > marker > invalid (ไม่กลืนเป็น service)", () => {
  assert.deepEqual(serviceJobSourceKindOf(job({ source_kind: "web_order" })), { kind: "web_order", from: "db" });
  assert.deepEqual(serviceJobSourceKindOf(job({ job_no: "AI-XYZ" })), { kind: "web_order", from: "marker" });
  assert.deepEqual(serviceJobSourceKindOf(job()), { kind: "service", from: "marker" });
  const bad = serviceJobSourceKindOf(job({ source_kind: "ขยะ" }));
  assert.equal(bad.from, "invalid");
  assert.equal(bad.kind, null);
});

test("B2. marker anchored + case-insensitive (ตรงกับ SQL ~*/ILIKE) · identity ≠ lifecycle", () => {
  assert.equal(deriveSourceKindFromMarkers(job({ note: "ลูกค้าถามผ่าน AI Sales: แต่เป็นงานซ่อม" })), SOURCE_KINDS.SERVICE);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "AI Sales: แอร์" })), SOURCE_KINDS.WEB_ORDER);
  // ★ should-fix: lowercase fixtures (SQL ใช้ ~*/ILIKE → JS ต้องตรงกัน)
  assert.equal(deriveSourceKindFromMarkers(job({ job_no: "ai-abc" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ job_no: "sh-abc" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "ai sales: แอร์" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "ac shop: แอร์" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "sh-cod_cash|x" })), SOURCE_KINDS.WEB_ORDER);
  // identity ไม่ขึ้นกับ lifecycle แต่ eligibility ขึ้น
  const cancelledWeb = job({ job_no: "AI-9", status: "cancelled", note: "AI Sales: x [ลบแล้ว]" });
  assert.equal(serviceJobSourceKindOf(cancelledWeb).kind, SOURCE_KINDS.WEB_ORDER);
  assert.equal(isWebOrderJob(cancelledWeb), false);
  assert.equal(isServiceIncomeJob(cancelledWeb), false);
});

test("B3. financeFlowVersionOf fail-closed: ไม่มีคอลัมน์=1 · 1/2 ตามค่า · null/0/3/ขยะ = null", () => {
  assert.equal(financeFlowVersionOf(job()), 1);                                   // ยังไม่มีคอลัมน์
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: 1 })), 1);
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: 2 })), 2);
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: "2" })), 2);
  for (const bad of [null, 0, 3, -1, "ขยะ", {}, NaN]) {
    assert.equal(financeFlowVersionOf(job({ finance_flow_version: bad })), null, `${JSON.stringify(bad)} ต้อง = null`);
  }
  // ★ ห้ามใช้ >= 2 (flow=3 ต้องไม่กลายเป็น v2)
  assert.equal(classifyServiceFlowState(job({ finance_flow_version: 3 }), []), SERVICE_FLOW_STATES.DATA_INCOMPLETE_METADATA);
  assert.equal(classifyServiceFlowState(job({ finance_flow_version: null }), []), SERVICE_FLOW_STATES.DATA_INCOMPLETE_METADATA);
});

test("B4. summarize: metadata เพี้ยนไม่ถูกกลืน — โผล่เป็น DATA_INCOMPLETE_METADATA + partition ยังครบ", () => {
  const jobs = [
    job({ id: 1, job_no: "A", total_cost: 1000, finance_flow_version: 1 }),
    job({ id: 2, job_no: "B", total_cost: 500, finance_flow_version: 3 }),      // เพี้ยน
    job({ id: 3, job_no: "C", total_cost: 700, finance_flow_version: null }),   // เพี้ยน
  ];
  const s = summarizeServiceFlow(jobs, new Map());
  assert.equal(s.scanned, 3);
  assert.equal(s.states.DATA_INCOMPLETE_METADATA.count, 2);
  assert.equal(s.dataIncompleteCount, 2);
  assert.equal(s.states.LEGACY_FLOW_V1_NO_JV.count, 1);
  assert.equal(s.partitionOk, true);
});

// ═══ C. runners — probe fail-closed + strict ═══
test("C1. probe fail-closed: รับเฉพาะ 42703/PGRST204 ที่อ้างคอลัมน์ของเรา — PGRST100/404/plain-text = fatal", () => {
  // ผ่าน (ยืนยันว่าคอลัมน์ไม่มีจริง)
  assert.equal(isMissingMetaColumnError(400, '{"code":"42703","message":"column \\"finance_flow_version\\" does not exist"}'), true);
  assert.equal(isMissingMetaColumnError(400, '{"code":"PGRST204","message":"Column \'source_kind\' not found"}'), true);
  // ★ ต้อง fatal ทั้งหมด
  assert.equal(isMissingMetaColumnError(400, '{"code":"PGRST100","message":"unexpected \\"x\\" expecting field name","details":"source_kind"}'), false,
    "PGRST100 = query parsing error → fatal แม้ข้อความจะพาดพิงคอลัมน์");
  assert.equal(isMissingMetaColumnError(400, '{"code":"42P01","message":"relation does not exist"}'), false);
  assert.equal(isMissingMetaColumnError(400, '{"code":"PGRST301","message":"JWT expired"}'), false);
  assert.equal(isMissingMetaColumnError(400, 'column service_jobs.source_kind does not exist'), false,
    "plain text (parse JSON ไม่ได้) = fatal — ห้ามเดา");
  assert.equal(isMissingMetaColumnError(400, '{"code":"42703","message":"column \\"foo\\" does not exist"}'), false,
    "คอลัมน์อื่นไม่นับ");
  assert.equal(isMissingMetaColumnError(404, '{"code":"42703","message":"source_kind"}'), false, "404 ต้อง fatal");
  assert.equal(isMissingMetaColumnError(500, ''), false);
  for (const [name, src] of [["classify", CLASSIFY], ["reconcile", RECONCILE]]) {
    const start = src.indexOf("async function probeMetaColumns");
    assert.ok(start > 0, `${name}: ต้องมี probeMetaColumns`);
    const fn = src.slice(start, start + 700);
    assert.match(fn, /await r\.text\(\)/, `${name}: ต้องอ่าน body ก่อนตัดสิน`);
    assert.match(fn, /L\.isMissingMetaColumnError\(r\.status, body\)/, `${name}: ต้องใช้ตัวตัดสินเดียวกัน (pure lib)`);
    assert.match(fn, /fatal\(/, `${name}: กรณีอื่นต้อง fatal`);
    assert.ok(!/r\.status === 404/.test(fn), `${name}: 404 ต้องไม่ถูก fallback`);
  }
});

test("C2. classify runner: รายงาน metadata + strict แดงเมื่อ source_kind/flow version เพี้ยน", () => {
  assert.match(CLASSIFY, /Source identity \+ finance flow \(Phase 606-a metadata\)/);
  assert.match(CLASSIFY, /DATA_INCOMPLETE: source_kind ไม่ถูกต้อง/);
  assert.match(CLASSIFY, /DATA_INCOMPLETE: finance_flow_version ไม่ถูกต้อง/);
  assert.match(CLASSIFY, /DATA_INCOMPLETE_METADATA \| \$\{F\.DATA_INCOMPLETE_METADATA\.count\}/);
  const strict = CLASSIFY.slice(CLASSIFY.indexOf("// ── strict gate ──"));
  assert.match(strict, /idn\.invalid > 0\) reasons\.push/);
  assert.match(strict, /badFlow > 0\) reasons\.push/);
  assert.match(strict, /flow\.dataIncompleteCount > 0\) reasons\.push/);
});

test("C2b. review#3: **ทั้งสอง runner** ต้อง partition metadata + strict แดงเมื่อเพี้ยน (ไม่ใช่แค่ classify)", () => {
  // reconcile audit ต้องมี metadata partition + DATA_INCOMPLETE + strict reason
  assert.match(RECONCILE, /const meta = \{ service: 0, web_order: 0, invalidKind: 0, invalidFlow: 0 \}/);
  assert.match(RECONCILE, /L\.serviceJobSourceKindOf\(j, META_AVAILABLE\)/, "ต้องส่ง META_AVAILABLE (fail-closed)");
  assert.match(RECONCILE, /Service metadata \(Phase 606-a\)/);
  assert.match(RECONCILE, /DATA_INCOMPLETE_METADATA/);
  const strict = RECONCILE.slice(RECONCILE.indexOf("const reasons = []"));
  assert.match(strict, /metaBad > 0\) reasons\.push\(`DATA_INCOMPLETE_METADATA/, "strict ของ reconcile ต้องแดงเมื่อ metadata เพี้ยน");
  // classify ก็ต้องส่ง META_AVAILABLE เช่นกัน
  assert.match(CLASSIFY, /L\.serviceJobSourceKindOf\(j, META_AVAILABLE\)/);
  // ★ metadata พร้อมแล้วแต่ source_kind ว่าง = invalid (ไม่ fallback marker)
  assert.deepEqual(serviceJobSourceKindOf(job({ source_kind: null, job_no: "AI-1" }), true), { kind: null, from: "invalid" });
  assert.deepEqual(serviceJobSourceKindOf(job({ source_kind: "", job_no: "JOB-1" }), true), { kind: null, from: "invalid" });
  // ยังไม่รัน migration → fallback marker ตามเดิม
  assert.deepEqual(serviceJobSourceKindOf(job({ job_no: "AI-1" }), false), { kind: "web_order", from: "marker" });
  // ข้อความ classifier ต้องไม่ stale หลัง migration
  assert.match(CLASSIFY, /META_AVAILABLE\s*\?\s*`- _finance_flow_version อ่านจาก DB/);
});

test("C3. 606-a ไม่ปลดล็อก recovery และ runtime ยังไม่รู้จักของใหม่", () => {
  assert.match(read("scripts/service_no_jv_recover.js"), /if \(APPLY_FLAG && R\.RECOVERY_APPLY_DISABLED\)/);
  assert.match(read("scripts/service_no_jv_recover_lib.js"), /RECOVERY_APPLY_DISABLED = true/);
  for (const f of ["modules/accounting/auto_post.js", "modules/accounting/backfill.js", "main.js"]) {
    assert.ok(!/service_payments|record_service_payment_v2|recognition_debit_code|finance_flow_version/.test(read(f)),
      `${f} ต้องยังไม่รู้จักของใหม่ (606-b เท่านั้นที่ activate)`);
  }
});
