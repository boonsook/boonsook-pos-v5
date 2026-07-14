// Phase 606-a — Service Finance V2 FOUNDATION guard
//
// เฟสนี้ต้องจบด้วย "ฐานพร้อมแต่ยังใช้ไม่ได้":
//   - schema/RPC/RLS/ledger พร้อม แต่ **ไม่มี caller** และ runtime ยัง flow v1
//   - ไม่มี side effect ทางบัญชี (ห้ามแตะ journal_entries/journal_lines, ห้ามโพสต์ JV)
//   - service_payments ต้องว่างหลัง migration · ห้ามมี flow v2 row
//   - recovery --apply ต้องยังถูกพัก
//
// guard นี้ตรวจ 2 ชั้น: (a) SQL static (extract บล็อกเฉพาะจุด ไม่ grep ทั้งไฟล์)
//                      (b) pure helper ฝั่ง audit script (identity vs eligibility, fallback, invalid)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SOURCE_KINDS, deriveSourceKindFromMarkers, serviceJobSourceKindOf, isWebOrderJob, isServiceIncomeJob,
} from "../scripts/finance_reconcile_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const SQL = read("supabase-phase606a-service-finance-foundation.sql");
const CLASSIFY = read("scripts/service_no_jv_classify.js");
const RECONCILE = read("scripts/finance_reconcile_audit.js");

// executable = ตัด runbook (block comment) ออก — ยังคง `--` heading ไว้เพื่อใช้ slice บล็อก
const executable = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
// code() = ตัด `--` comment ออกด้วย → ใช้กับ assertion เชิงลบ (ไม่ให้ข้อความในคอมเมนต์ทำ false-positive)
const code = (s) => s.split(/\r?\n/).map(l => l.replace(/--.*$/, "")).join("\n");
const EXEC_CODE = code(executable);
const block = (from, to) => {
  const a = executable.indexOf(from);
  assert.ok(a >= 0, `ต้องเจอบล็อก: ${from}`);
  const b = to ? executable.indexOf(to, a) : executable.length;
  return executable.slice(a, b > a ? b : executable.length);
};

const job = (o = {}) => ({ id: 1, job_no: "JOB-1", status: "delivered", total_cost: 1000, note: "", sub_service: "", ...o });

// ═══ A. SQL: transaction + preflight + ไม่มี side effect บัญชี ═══
test("A1. migration รันใน transaction เดียว + preflight fail-fast + ไม่แตะ journal_entries/journal_lines", () => {
  assert.match(executable, /^\s*BEGIN;/m, "ต้องมี BEGIN");
  assert.match(executable, /^COMMIT;/m, "ต้องมี COMMIT");
  const pre = block("-- 1) PREFLIGHT", "-- 2) service_jobs");
  for (const need of ["service_jobs", "account_mapping", "chart_of_accounts", "journal_entries",
    "is_admin()", "is_accountant()", "idx_je_source_unique", "'1200'", "total_cost", "closed_at"]) {
    assert.ok(pre.includes(need), `preflight ต้องตรวจ ${need}`);
  }
  assert.match(pre, /RAISE EXCEPTION/, "preflight ต้อง fail-fast ด้วย RAISE EXCEPTION");
  assert.match(pre, /format_type\(a\.atttypid/, "ต้องอ่าน type จริงของ service_jobs.id (ห้ามเดา)");
  // ★ ห้ามมี DML ใด ๆ ต่อ journal ในส่วนที่ execute จริง
  assert.ok(!/(INSERT|UPDATE|DELETE)[\s\S]{0,80}journal_(entries|lines)/i.test(EXEC_CODE),
    "ห้าม INSERT/UPDATE/DELETE journal_entries/journal_lines");
  // ★ ห้ามแตะ field เดิมของงาน
  const updates = [...EXEC_CODE.matchAll(/UPDATE public\.service_jobs[\s\S]*?;/g)].map(m => m[0]);
  assert.ok(updates.length > 0, "ต้องมี backfill");
  for (const u of updates) {
    assert.ok(!/SET[\s\S]*?\b(status|closed_at|total_cost|payment_method|items_json)\b\s*=/.test(u),
      "backfill ต้องไม่แตะ status/closed_at/total_cost/payment_method/items_json");
  }
});

test("A2. FK ของ ledger ใช้ type จริงของ service_jobs.id (dynamic DDL) — ไม่ hardcode", () => {
  const b = block("-- 7) service_payments", "-- 8) RLS");
  assert.match(b, /format_type\(a\.atttypid, a\.atttypmod\) INTO v_id_type/, "ต้องอ่าน type จาก catalog");
  assert.match(b, /EXECUTE format\(/, "ต้องสร้างตารางด้วย dynamic DDL");
  assert.match(b, /service_job_id\s+%s NOT NULL REFERENCES public\.service_jobs\(id\) ON DELETE RESTRICT/);
  // ledger กติกาเงิน
  assert.match(b, /amount\s+NUMERIC\(14,2\) NOT NULL CHECK \(amount > 0\)/);
  assert.match(b, /payment_method\s+TEXT NOT NULL CHECK \(payment_method IN \('cash','transfer'\)\)/);
  assert.match(b, /CONSTRAINT chk_service_payments_bank_by_method/, "cash ห้ามมี bank · transfer ต้องมี");
  assert.match(b, /CONSTRAINT uq_service_payments_job_idem UNIQUE \(service_job_id, idempotency_key\)/,
    "unique ต้องเป็น (job, idempotency_key) — งานหนึ่งรับหลายงวดได้");
  assert.ok(!/UNIQUE \(service_job_id\)\s*[,)]/.test(b), "ห้าม unique ที่ service_job_id เดี่ยว");
});

test("A3. metadata columns + constraints + trigger (ไม่ใช้ DEFAULT 'service')", () => {
  const b = block("-- 2) service_jobs", "-- 3) canonical");
  assert.match(b, /ADD COLUMN IF NOT EXISTS source_kind\s+TEXT/);
  assert.match(b, /ADD COLUMN IF NOT EXISTS finance_flow_version\s+SMALLINT/);
  assert.match(b, /ADD COLUMN IF NOT EXISTS payment_due_date\s+DATE/);
  assert.match(b, /CHECK \(source_kind IS NULL OR source_kind IN \('service','web_order'\)\)/);
  assert.match(b, /CHECK \(finance_flow_version IS NULL OR finance_flow_version IN \(1,2\)\)/);
  assert.ok(!/DEFAULT\s+'service'/.test(EXEC_CODE), "ห้าม DEFAULT 'service' (client เก่าจะทำ web order เพี้ยน)");

  const trg = block("-- 4) triggers", "-- 5) BACKFILL");
  assert.match(trg, /BEFORE INSERT ON public\.service_jobs/);
  assert.match(trg, /derive_service_source_kind\(NEW\.job_no, NEW\.note, NEW\.sub_service\)/, "ไม่ส่ง/ไม่ valid → derive");
  assert.match(trg, /NEW\.finance_flow_version := 1;/, "606-a ต้อง default flow 1 เท่านั้น");
  assert.ok(!/finance_flow_version := 2/.test(EXEC_CODE), "606-a ห้ามสร้าง flow v2");
  // update guard ผ่าน is_admin()
  assert.match(trg, /BEFORE UPDATE ON public\.service_jobs/);
  assert.match(trg, /auth\.uid\(\) IS NULL OR public\.is_admin\(\)/);
  for (const f of ["source_kind", "finance_flow_version", "payment_due_date"]) {
    assert.ok(new RegExp(`NEW\\.${f} IS DISTINCT FROM OLD\\.${f}`).test(trg), `update guard ต้องคุม ${f}`);
    assert.ok(new RegExp(`ERRCODE = '42501'`).test(trg));
  }
  // trigger ต้องไม่ยุ่งกับ field เดิม
  assert.ok(!/NEW\.(status|closed_at|total_cost|payment_method)\s*:=/.test(code(trg)));
});

test("A4. source-kind deriver: anchored markers, ไม่ผูกกับ status/ลบ/ยกเลิก", () => {
  const b = block("-- 3) canonical", "-- 4) triggers");
  assert.match(b, /IMMUTABLE/);
  assert.match(b, /'\^\(AI\|SH\)-'/, "job_no ต้อง anchored ^(AI|SH)-");
  for (const like of ["'AI Sales:%'", "'AC Shop:%'", "'SH-transfer|%'", "'SH-cod_cash|%'", "'SH-cod_transfer|%'"]) {
    assert.ok(b.includes(like), `ต้องมี anchored LIKE ${like}`);
  }
  assert.ok(b.includes("LIKE '%สั่งซื้อ%'"), "sub_service ยังใช้ substring ตามนิยามเดิม");
  assert.ok(!/status|cancelled|ลบแล้ว/.test(code(b)), "identity ห้ามผูกกับ status/cancelled/[ลบแล้ว]");
  // backfill ก็ห้ามใช้ lifecycle
  const bf = block("-- 5) BACKFILL", "-- 6) account_mapping");
  assert.match(bf, /WHERE source_kind IS NULL/, "backfill ต้อง idempotent (เฉพาะที่ยังว่าง)");
  assert.match(bf, /SET finance_flow_version = 1[\s\S]{0,60}WHERE finance_flow_version IS NULL/);
  assert.ok(!/(cancelled|ลบแล้ว)/.test(code(bf)), "backfill source_kind ห้ามใช้ status/[ลบแล้ว]");
});

test("A5. recognition mapping: เพิ่ม 1200 โดยไม่แตะ mapping เดิม", () => {
  const b = block("-- 6) account_mapping", "-- 7) service_payments");
  assert.match(b, /ADD COLUMN IF NOT EXISTS recognition_debit_code TEXT/);
  assert.match(b, /FOREIGN KEY \(recognition_debit_code\) REFERENCES public\.chart_of_accounts\(code\)/);
  assert.match(b, /SET recognition_debit_code = '1200'[\s\S]{0,120}mapping_key LIKE 'service\\_%'/);
  // ★ ห้ามแก้คอลัมน์ที่ writer v1 ยังใช้
  assert.ok(!/SET[\s\S]{0,40}\b(debit_account_code|credit_account_code|transfer_debit_code)\b\s*=/.test(executable),
    "ห้ามแก้ debit/credit/transfer code เดิม (writer v1 ยังใช้อยู่)");
});

test("A6. RLS: SELECT เฉพาะ is_accountant() · เขียนตรงไม่ได้ · grant ตรงกับ policy", () => {
  const b = block("-- 8) RLS", "-- 9) RPC");
  assert.match(b, /ENABLE ROW LEVEL SECURITY/);
  assert.match(b, /FORCE ROW LEVEL SECURITY/);
  assert.match(b, /FOR SELECT\s+TO authenticated\s+USING \(public\.is_accountant\(\)\)/);
  assert.ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(code(b)), "ห้ามมี policy เขียน (ledger append-only ผ่าน RPC)");
  assert.match(b, /REVOKE ALL ON public\.service_payments FROM anon/);
  assert.match(b, /REVOKE ALL ON public\.service_payments FROM authenticated/);
  assert.match(b, /GRANT SELECT ON public\.service_payments TO authenticated/);
  assert.ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*service_payments/.test(code(b)), "ห้าม grant สิทธิ์เขียนตรง");
});

test("A7. RPC: hardening + business rules + ไม่โพสต์ JV + ไม่ PATCH cache", () => {
  const b = block("-- 9) RPC", "-- 10) POST-CHECK");
  assert.match(b, /SECURITY DEFINER/);
  assert.match(b, /SET search_path = public/);
  assert.match(b, /IF NOT public\.is_admin\(\) THEN[\s\S]{0,120}42501/);
  assert.match(b, /FOR UPDATE/, "ต้อง lock row");
  assert.match(b, /source_kind, 'service'\) <> 'service'/, "web order ห้ามใช้ ledger นี้");
  assert.match(b, /finance_flow_version, 1\) <> 2/, "ต้องเป็น flow v2 เท่านั้น");
  assert.match(b, /NOT IN \('done','delivered','closed'\)/);
  assert.match(b, /closed_at IS NULL/);
  assert.match(b, /\[ลบแล้ว\]/);
  assert.match(b, /v_method NOT IN \('cash','transfer'\)/, "ไม่รู้จัก = ปฏิเสธ");
  assert.ok(/ห้าม default เป็นเงินสด/.test(b), "ต้องระบุชัดว่าไม่ default เป็นเงินสด");
  assert.match(b, /'cash' AND p_bank_coa_code IS NOT NULL/, "cash ห้ามมี bank");
  assert.match(b, /is_active AND type = 'asset'/, "transfer ต้อง validate bank COA");
  assert.match(b, /23514/, "overpay ต้อง 23514");
  assert.match(b, /23505/, "idempotency conflict ต้อง 23505");
  assert.match(b, /idempotency_key = p_idempotency_key/);
  assert.match(b, /'inserted', false/, "replay ต้องคืน row เดิม ไม่ insert ซ้ำ");
  assert.match(b, /jsonb_build_object\([\s\S]{0,200}'paid_total'[\s\S]{0,80}'outstanding_after'/);
  assert.ok(!/journal_(entries|lines)/i.test(code(b)), "RPC ห้ามแตะ journal");
  assert.ok(!/UPDATE public\.service_jobs/.test(code(b)), "RPC ห้าม PATCH service_jobs (ห้าม cache paid/unpaid)");
  // grants
  assert.match(executable, /REVOKE ALL ON FUNCTION public\.record_service_payment_v2[\s\S]{0,200}FROM PUBLIC/);
  assert.match(executable, /GRANT EXECUTE ON FUNCTION public\.record_service_payment_v2[\s\S]{0,200}TO authenticated/);
});

test("A8. POST-CHECK ในทรานแซกชัน: metadata ครบ · flow2=0 · payments=0 · mapping ครบ", () => {
  const b = block("-- 10) POST-CHECK", "COMMIT;");
  for (const need of ["source_kind IS NULL", "finance_flow_version IS NULL", "finance_flow_version = 2",
    "FROM public.service_payments", "recognition_debit_code IS DISTINCT FROM '1200'"]) {
    assert.ok(b.includes(need), `post-check ต้องตรวจ: ${need}`);
  }
  assert.equal((b.match(/RAISE EXCEPTION/g) || []).length >= 5, true, "ทุกเงื่อนไขต้อง fail-fast");
  // runbook ต้องมี STEP 0 / VERIFY / ROLLBACK
  assert.match(SQL, /STEP 0 — READ-ONLY INSPECT/);
  assert.match(SQL, /VERIFY \(count-only/);
  assert.match(SQL, /ROLLBACK GUIDANCE/);
  assert.match(SQL, /NOTIFY pgrst, 'reload schema'/);
  // ห้าม hardcode จำนวน row production
  assert.ok(!/\b(83|41|36|6950|101130|47150)\b/.test(executable), "ห้าม hardcode ตัวเลข production ใน SQL");
});

// ═══ B. audit-script helpers: identity vs eligibility ═══
test("B1. source identity: DB มาก่อน marker · ว่าง = fallback marker · invalid = ไม่กลืนเป็น service", () => {
  // DB priority
  assert.deepEqual(serviceJobSourceKindOf(job({ source_kind: "web_order" })), { kind: "web_order", from: "db" });
  assert.deepEqual(serviceJobSourceKindOf(job({ job_no: "AI-1", source_kind: "service" })), { kind: "service", from: "db" },
    "ค่าใน DB ต้องชนะ marker (แอดมินแก้ประเภทได้)");
  // fallback marker (งานก่อน migration)
  assert.deepEqual(serviceJobSourceKindOf(job({ job_no: "AI-XYZ" })), { kind: "web_order", from: "marker" });
  assert.deepEqual(serviceJobSourceKindOf(job({ source_kind: null, note: "AC Shop: แอร์" })), { kind: "web_order", from: "marker" });
  assert.deepEqual(serviceJobSourceKindOf(job()), { kind: "service", from: "marker" });
  // ★ invalid ห้ามกลืน
  const bad = serviceJobSourceKindOf(job({ source_kind: "ขยะ" }));
  assert.equal(bad.from, "invalid");
  assert.equal(bad.kind, null);
});

test("B2. marker anchored: กลางประโยคไม่นับ · lifecycle ไม่กระทบ identity", () => {
  assert.equal(deriveSourceKindFromMarkers(job({ note: "ลูกค้าถามผ่าน AI Sales: แต่เป็นงานซ่อม" })), SOURCE_KINDS.SERVICE);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "AI Sales: แอร์ 12000" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ job_no: "SH-ABC" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ note: "SH-cod_cash|slip" })), SOURCE_KINDS.WEB_ORDER);
  assert.equal(deriveSourceKindFromMarkers(job({ sub_service: "สั่งซื้อสินค้า" })), SOURCE_KINDS.WEB_ORDER);
  // ★ identity ไม่ขึ้นกับ cancelled/[ลบแล้ว]
  const cancelledWeb = job({ job_no: "AI-9", status: "cancelled", note: "AI Sales: x [ลบแล้ว]" });
  assert.equal(serviceJobSourceKindOf(cancelledWeb).kind, SOURCE_KINDS.WEB_ORDER, "web order ที่ยกเลิกยังเป็น web_order");
  // แต่ eligibility ต้องไม่ให้ผ่าน (คนละ helper)
  assert.equal(isWebOrderJob(cancelledWeb), false, "cancelled → ไม่นับใน reconcile (lifecycle filter)");
  assert.equal(isServiceIncomeJob(cancelledWeb), false);
});

test("B3. isWebOrderJob ใช้ identity helper + คง lifecycle filter เดิม", () => {
  assert.equal(isWebOrderJob(job({ source_kind: "web_order", status: "delivered" })), true);
  assert.equal(isWebOrderJob(job({ source_kind: "service", job_no: "AI-1", status: "delivered" })), false,
    "source_kind จาก DB ชนะ marker");
  assert.equal(isWebOrderJob(job({ job_no: "AI-1", status: "delivered" })), true, "fallback marker ยังทำงาน");
  assert.equal(isWebOrderJob(job({ source_kind: "ขยะ", job_no: "AI-1", status: "delivered" })), false,
    "invalid → ไม่ถือเป็น web order (และต้องถูกรายงานเป็น dataIncomplete)");
});

// ═══ C. runners: fallback-safe + strict + ไม่ปลดล็อก recovery ═══
test("C1. audit runners probe metadata columns และ fallback ได้เมื่อยังไม่รัน migration", () => {
  for (const [name, src] of [["classify", CLASSIFY], ["reconcile", RECONCILE]]) {
    const start = src.indexOf("async function probeMetaColumns");
    assert.ok(start > 0, `${name}: ต้องมี probeMetaColumns`);
    const fn = src.slice(start, start + 600);
    assert.ok(/source_kind,finance_flow_version|\$\{SJ_META\}/.test(fn), `${name}: ต้อง probe คอลัมน์ใหม่`);
    assert.match(fn, /r\.status === 400 \|\| r\.status === 404/, `${name}: ยังไม่มีคอลัมน์ = fallback ไม่ fatal`);
    assert.match(src, /await probeMetaColumns\(token\)/, `${name}: ต้องเรียก probe ใน main`);
  }
  // classify ต้องรายงาน partition + dataIncomplete + strict fail
  assert.match(CLASSIFY, /Source identity \(Phase 606-a metadata\)/);
  assert.match(CLASSIFY, /DATA_INCOMPLETE: source_kind ไม่ถูกต้อง/);
  assert.match(CLASSIFY, /if \(sourceKindDataIncomplete\) reasons\.push/, "strict ต้องแดงเมื่อ source_kind invalid");
});

test("C2. 606-a ไม่ปลดล็อก recovery --apply และไม่แตะ runtime/backfill module", () => {
  const recover = read("scripts/service_no_jv_recover.js");
  assert.match(recover, /if \(APPLY_FLAG && R\.RECOVERY_APPLY_DISABLED\)/, "hard-block ต้องยังอยู่");
  const lib = read("scripts/service_no_jv_recover_lib.js");
  assert.match(lib, /RECOVERY_APPLY_DISABLED = true/);
  // ห้ามแตะ runtime writer/backfill/UI ใน PR นี้ (ไฟล์ต้องไม่อ้าง service_payments/flow v2 เลย)
  for (const f of ["modules/accounting/auto_post.js", "modules/accounting/backfill.js", "main.js"]) {
    const src = read(f);
    assert.ok(!/service_payments|record_service_payment_v2|recognition_debit_code|finance_flow_version/.test(src),
      `${f} ต้องยังไม่รู้จักของใหม่ (606-b เท่านั้นที่ activate)`);
  }
});
