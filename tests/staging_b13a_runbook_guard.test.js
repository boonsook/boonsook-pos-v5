// ═════════════════════════════════════════════════
//  Phase 606-B13a — guard: authenticated payment staging package ต้องปลอดภัย/ครบตาม spec
// ═════════════════════════════════════════════════
//  ล็อก invariant ของ staging-verify-b13a-auth-payment.sql + STAGING_B13A_RUNBOOK.md
//  (guard นี้ extract section/function จริงก่อน assert — ไม่ grep ทั้งไฟล์แบบหลวม)
//  ⚠️ guard/CI เขียว ≠ behavioral proof — B13a ยัง NOT RUN จนกว่า owner execute จริง
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const SQL_FILE = "staging-verify-b13a-auth-payment.sql";
const RB_FILE = "STAGING_B13A_RUNBOOK.md";
const SQL = fs.readFileSync(path.join(ROOT, SQL_FILE), "utf8");
const RB = fs.readFileSync(path.join(ROOT, RB_FILE), "utf8");
// โค้ดจริงไม่รวม comment — ใช้กับ check ที่ comment อาจ mention คำต้องห้ามโดยชอบธรรม
const SQL_CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// DO blocks — dollar-quote tag ขึ้นต้น b13a ทุกบล็อก
const BLOCKS = [...SQL.matchAll(/DO \$(b13a[a-z0-9_]+)\$([\s\S]*?)\$\1\$;/g)]
  .map((m) => ({ tag: m[1], body: m[2] }));
const block = (tag) => BLOCKS.find((b) => b.tag === tag)?.body ?? assert.fail(`ไม่พบ DO block ${tag}`);

// function bodies — extract จาก dollar tag ของแต่ละ function จริง
function fnBody(tag) {
  const m = SQL.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  assert.ok(m, `ไม่พบ function body $${tag}$`);
  return m[1];
}
const FN_BOOTSTRAP = fnBody("fn_bootstrap");
const FN_BROWSER = fnBody("fn_browser");
const FN_FINALIZE = fnBody("fn_finalize");
// ตัด comment ออกจาก fragment ก่อนใช้กับ doesNotMatch (กัน comment ชน pattern โดยชอบธรรม)
const stripSql = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// branch extraction ภายใน fn_browser (ตาม section marker คงที่)
function browserBranch(startMark, endMark) {
  const s = FN_BROWSER.indexOf(startMark);
  const e = endMark ? FN_BROWSER.indexOf(endMark) : FN_BROWSER.length;
  assert.ok(s > 0 && (endMark ? e > s : true), `extract branch ${startMark} ไม่ได้`);
  return FN_BROWSER.slice(s, endMark ? e : undefined);
}
const BR_GATES = browserBranch("-- (5) prepared", "-- (6) gates_passed");
const BR_SNAPSHOT = browserBranch("-- (6) gates_passed", "-- (7) r1_inflight");
const BR_R1 = browserBranch("-- (7) r1_inflight", "-- (8) r1_recorded");
const BR_R2IN = browserBranch("-- (8) r1_recorded", "-- (9) r2_inflight");
const BR_R2 = browserBranch("-- (9) r2_inflight", "-- (10) failure");
const BR_FAIL = browserBranch("-- (10) failure");

// finalize action branches
function finalizeBranch(action, nextAction) {
  const s = FN_FINALIZE.indexOf(`p_action = '${action}'`);
  const e = nextAction ? FN_FINALIZE.indexOf(`p_action = '${nextAction}'`) : FN_FINALIZE.length;
  assert.ok(s > 0, `extract finalize branch ${action} ไม่ได้`);
  return FN_FINALIZE.slice(s, nextAction ? e : undefined);
}
const FZ_VERIFY = finalizeBranch("verify_db", "teardown");
const FZ_TEARDOWN = finalizeBranch("teardown", "attest_cleanup");
const FZ_ATTEST = finalizeBranch("attest_cleanup", "complete");
const FZ_COMPLETE = finalizeBranch("complete", "abort_no_payment");
const FZ_ABORT = finalizeBranch("abort_no_payment", "classify_failed_incomplete");
const FZ_CLS_INC = finalizeBranch("classify_failed_incomplete", "classify_failed_no_write");
const FZ_CLS_NW = finalizeBranch("classify_failed_no_write");

// runbook section extraction
function rbSection(head, nextHead) {
  const s = RB.indexOf(head);
  const e = nextHead ? RB.indexOf(nextHead) : RB.length;
  assert.ok(s > 0 && (nextHead ? e > s : true), `ไม่พบ runbook section ${head}`);
  return RB.slice(s, nextHead ? e : undefined);
}

test("G1. STAGING ONLY + scope 3 ไฟล์ (ชื่อไฟล์ไม่ขึ้นต้น supabase-)", () => {
  assert.match(SQL.split("\n")[0],
    /^-- STAGING ONLY — AUTHENTICATED PAYMENT BEHAVIOR VERIFY — ห้ามรันบน production$/,
    "บรรทัดแรกต้องประกาศ STAGING ONLY ตาม spec เป๊ะ");
  assert.ok(!SQL_FILE.startsWith("supabase-"), "SQL filename ห้ามขึ้นต้น supabase-");
  assert.ok(!fs.existsSync(path.join(ROOT, "supabase-" + SQL_FILE)), "ห้ามมีสำเนาชื่อ supabase-*");
  for (const f of [SQL_FILE, RB_FILE, "tests/staging_b13a_runbook_guard.test.js"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `deliverable ${f} ต้องมีจริง`);
  }
});

test("G2. B12 scratch explicit — target = scratch เดิมของ B12 เท่านั้น", () => {
  const pre = block("b13a_preflight");
  assert.match(pre, /_staging_b12_sentinel/, "preflight ต้องเช็ค B12 sentinel (scratch เดิม)");
  assert.match(pre, /scratch เดิมของ B12 เท่านั้น|scratch ใหม่ = STOP/, "preflight ต้องปฏิเสธ scratch ใหม่");
  const b2 = rbSection("## B2)", "## B3)");
  assert.match(b2, /scratch project เดิมของ Phase 606-B12/, "runbook B2 ต้องระบุ scratch เดิม");
  assert.match(b2, /ห้ามใช้ scratch ใหม่/, "runbook B2 ต้องห้าม scratch ใหม่");
  assert.match(b2, /ห้ามแตะ production/, "runbook B2 ต้องห้ามแตะ production");
});

test("G3. sentinel ทุก mutation unit + ห้าม script สร้าง sentinel เอง + หนึ่งแถวเป๊ะ", () => {
  // mutation wrappers ทั้งหมด: S0.1–S0.7 (DDL/GRANT) + S0-RELOAD + SEED — ไม่มีข้อยกเว้น
  const units = [
    ["b13a_s0_acl_recovery (DO)", block("b13a_s0_acl_recovery")],
    ["b13a_s0_runs (DO)", block("b13a_s0_runs")],
    ["b13a_s0_results (DO)", block("b13a_s0_results")],
    ["b13a_s0_evidence (DO)", block("b13a_s0_evidence")],
    ["b13a_s0_fn_bootstrap (DO)", block("b13a_s0_fn_bootstrap")],
    ["b13a_s0_fn_browser (DO)", block("b13a_s0_fn_browser")],
    ["b13a_s0_fn_finalize (DO)", block("b13a_s0_fn_finalize")],
    ["b13a_s0_fn_exposed (DO)", block("b13a_s0_fn_exposed")],
    ["b13a_s0_reload (DO)", block("b13a_s0_reload")],
    ["b13a_seed (DO)", block("b13a_seed")],
    ["fn_bootstrap", FN_BOOTSTRAP],
    ["fn_browser", FN_BROWSER],
    ["fn_finalize", FN_FINALIZE],
  ];
  for (const [name, body] of units) {
    assert.match(body, /_staging_b13a_sentinel/, `${name}: ต้องเช็ค sentinel`);
    assert.match(body, /count\(\*\) = 1 AND bool_and\([sx]\.confirm_text = 'B13A-STAGING-' \|\| to_char\(current_date, 'YYYY-MM-DD'\)\)/,
      `${name}: sentinel ต้อง "หนึ่งแถว + confirm_text ตรง current_date ของ DB session" เป๊ะ`);
    assert.match(body, /WHEN undefined_table THEN\s*\n\s*RAISE EXCEPTION 'B13A INTERLOCK: ไม่พบตาราง/,
      `${name}: ไม่มีตาราง sentinel = ปฏิเสธ (default = ปฏิเสธ)`);
    // interlock ต้องมาก่อน mutation แรกของ unit (CREATE/EXECUTE/GRANT/REVOKE/INSERT/UPDATE/DELETE)
    const il = body.indexOf("_staging_b13a_sentinel");
    const firstMut = Math.min(...["EXECUTE 'CREATE", "EXECUTE 'ALTER", "EXECUTE v_def",
      "EXECUTE 'REVOKE", "EXECUTE 'GRANT", "EXECUTE 'NOTIFY", "INSERT INTO public.",
      "UPDATE public.", "DELETE FROM public."]
      .map((k) => body.indexOf(k)).filter((i) => i >= 0));
    assert.ok(Number.isFinite(firstMut) ? il < firstMut : true,
      `${name}: interlock ต้องมาก่อน DDL/GRANT/DML แรกใน unit`);
  }
  assert.doesNotMatch(SQL, /CREATE TABLE[^;]*_staging_b13a_sentinel/i,
    "script ห้ามสร้าง sentinel เอง (owner พิมพ์มือใน runbook เท่านั้น)");
  assert.doesNotMatch(SQL_CODE, /'B13A-STAGING-\d{4}-\d{2}-\d{2}'/,
    "script ห้าม hardcode วันที่ sentinel");
  assert.doesNotMatch(SQL_CODE, /AT\s+TIME\s+ZONE\s+'Asia\/Bangkok'[^;]*sentinel|SET\s+TIME\s+ZONE/i,
    "ห้ามเปลี่ยน session timezone / derive sentinel จาก timezone อื่น");
});

test("G4. typed run state + stage allowlist ครบ 12 + transition contract ครบ", () => {
  const runs = block("b13a_s0_runs");
  for (const col of ["singleton", "run_id", "actor_id", "stage", "service_job_id", "payment_id",
                     "payment_jv_entry_id", "amount", "payment_method", "bank_coa_code", "paid_at",
                     "idempotency_key", "slip_url", "note", "failure_code", "created_at", "updated_at"]) {
    assert.match(runs, new RegExp(`\\b${col}\\b`), `runs ต้องมี column ${col} (typed — ไม่ใช่ JSON)`);
  }
  assert.doesNotMatch(runs, /jsonb?\b/i, "run state ห้ามใช้ JSON เป็น authority");
  for (const st of ["prepared", "gates_passed", "r1_inflight", "r1_recorded", "r2_inflight",
                    "r2_verified", "db_verified", "teardown_complete", "auth_cleanup_complete",
                    "execution_complete", "failed_incomplete", "failed_no_write"]) {
    assert.match(runs, new RegExp(`''${st}''`), `stage CHECK ต้องมี ${st}`);
  }
  assert.match(SQL, /FULL TRANSITION CONTRACT \(A6/, "ต้องมี transition contract reference ครบในไฟล์");
});

test("G5. terminal ไม่มี outgoing + cleanup stages resumable", () => {
  // browser allowlist: from-stage ได้เฉพาะ prepared/gates_passed/r1_inflight/r1_recorded/r2_inflight
  assert.doesNotMatch(FN_BROWSER,
    /p_from_stage = '(execution_complete|failed_incomplete|failed_no_write|teardown_complete|auth_cleanup_complete|db_verified|r2_verified)'/,
    "browser CAS ห้ามมี from-stage เป็น terminal/owner stage");
  // finalize expected stages: ไม่มี action ใดรับ from terminal
  assert.doesNotMatch(FN_FINALIZE,
    /stage (=|IN \([^)]*)'(execution_complete|failed_incomplete|failed_no_write)'/,
    "finalize ห้ามมี expected-stage เป็น terminal (terminal = ไม่มี outgoing)");
  // resumable: attest/complete RAISE โดยไม่แตะ state เมื่อเงื่อนไขไม่ครบ + ห้ามไป failed_no_write
  assert.match(FZ_ATTEST, /คง teardown_complete แล้ว retry action เดิม/,
    "attest_cleanup: boolean ไม่ครบ = คง stage เดิม retry action เดิม");
  assert.doesNotMatch(stripSql(FZ_ATTEST), /failed_no_write/, "attest_cleanup ห้ามเปลี่ยนเป็น failed_no_write");
  assert.doesNotMatch(stripSql(FZ_COMPLETE), /failed_no_write/, "complete ห้ามเปลี่ยนเป็น failed_no_write");
  assert.match(FZ_CLS_INC, /cleanup stages = retry action เดิม/,
    "classify ต้องระบุว่า cleanup stages ไม่อยู่ใน scope (resumable)");
});

test("G6. bootstrap sanctioned: no API grants + active run=0 + ห้าม UPDATE ผ่าน bootstrap", () => {
  assert.match(block("b13a_s0_fn_bootstrap"),
    /REVOKE ALL ON FUNCTION public\.b13a_owner_bootstrap\(uuid\) FROM PUBLIC, anon, authenticated/,
    "bootstrap ต้อง REVOKE ครบ (SQL Editor เท่านั้น)");
  assert.match(FN_BOOTSTRAP, /SELECT count\(\*\) INTO v_run_count FROM public\._staging_b13a_runs;\s*\n\s*IF v_run_count <> 0 THEN/,
    "bootstrap: active run ต้อง = 0 (terminal ก็บล็อก)");
  assert.doesNotMatch(stripSql(FN_BOOTSTRAP), /\bUPDATE\b/i, "ห้ามมี UPDATE ใน bootstrap (insert run อย่างเดียว)");
  assert.match(FN_BOOTSTRAP, /GET DIAGNOSTICS v_n = ROW_COUNT;\s*\n\s*IF v_n <> 1/,
    "bootstrap: affected row ต้อง = 1");
  assert.match(FN_BOOTSTRAP, /'prepared'/, "bootstrap ต้อง insert stage prepared");
  assert.match(FN_BOOTSTRAP, /NULL, NULL, NULL, NULL, NULL,\s*\n\s*NULL, NULL, NULL, NULL, NULL/,
    "bootstrap: intent/IDs ต้องเป็น NULL ทั้งหมดตอน insert");
});

test("G7. browser CAS: auth.uid() + actor + exact run + FOR UPDATE + affected=1 + SECDEF", () => {
  assert.match(FN_BROWSER, /v_uid\s+uuid := auth\.uid\(\);/, "ต้องอ่าน auth.uid()");
  assert.match(FN_BROWSER, /IF v_uid IS NULL THEN\s*\n\s*RAISE EXCEPTION/, "auth.uid() NULL = reject");
  assert.match(FN_BROWSER, /IF v_run\.actor_id <> v_uid THEN/, "actor ต้องตรง run");
  assert.match(FN_BROWSER, /WHERE singleton FOR UPDATE/, "ต้อง lock run FOR UPDATE");
  assert.match(FN_BROWSER, /IF v_run\.run_id <> p_run_id THEN/, "ต้องเช็ค exact run");
  assert.match(FN_BROWSER, /IF v_run\.stage <> p_from_stage THEN/, "ต้องเช็ค exact expected stage (duplicate reject)");
  assert.ok((FN_BROWSER.match(/GET DIAGNOSTICS v_n = ROW_COUNT;/g) || []).length >= 5,
    "ทุก transition ต้อง assert affected row = 1");
  const s05 = block("b13a_s0_fn_browser");
  assert.match(s05, /SECURITY DEFINER/, "browser CAS ต้อง SECURITY DEFINER");
  assert.match(s05, /SET search_path = public/, "browser CAS ต้อง safe search_path");
  assert.match(s05, /GRANT EXECUTE ON FUNCTION public\.b13a_browser_transition[^;]*TO authenticated/,
    "execute เฉพาะ authenticated");
});

test("G8. owner finalizer: no API grants + ไม่ใช้ auth.uid()=actor + introspect จริงไม่เดา role", () => {
  assert.match(block("b13a_s0_fn_finalize"),
    /REVOKE ALL ON FUNCTION public\.b13a_owner_finalize\(uuid,text,text,boolean,boolean,boolean\) FROM PUBLIC, anon, authenticated/,
    "finalize ต้อง REVOKE ครบ (no API grants)");
  assert.doesNotMatch(block("b13a_s0_fn_finalize"), /GRANT EXECUTE ON FUNCTION public\.b13a_owner_finalize/,
    "finalize ห้ามมี GRANT EXECUTE ใด ๆ");
  assert.match(FN_FINALIZE, /IF auth\.uid\(\) IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION/,
    "owner path ต้องปฏิเสธ JWT context (ไม่ใช้ auth.uid()=actor_id)");
  assert.doesNotMatch(FN_FINALIZE, /actor_id = auth\.uid\(\)|auth\.uid\(\) = .*actor_id/,
    "owner path ห้ามพิสูจน์ตัวเองด้วย auth.uid()=actor_id");
  assert.match(FN_FINALIZE, /SELECT r\.rolsuper OR r\.rolbypassrls INTO v_trusted FROM pg_roles r WHERE r\.rolname = current_user/,
    "ต้อง introspect trusted owner context จาก pg_roles จริง (ห้ามเดา role name)");
  assert.doesNotMatch(FN_FINALIZE, /current_user\s*=\s*'(postgres|supabase_admin)'/,
    "ห้าม hardcode ชื่อ role");
  const boot = FN_BOOTSTRAP;
  assert.match(boot, /rolsuper OR r\.rolbypassrls/, "bootstrap ก็ต้อง introspect เช่นกัน");
});

test("G9. run SELECT RLS ผูก actor + no browser DML grants", () => {
  const runs = block("b13a_s0_runs");
  assert.match(runs, /CREATE POLICY b13a_runs_select_actor[^;]*FOR SELECT TO authenticated[^;]*USING \(singleton AND actor_id = auth\.uid\(\)\)/s,
    "RLS SELECT ต้องผูก auth.uid()=actor_id + exact singleton");
  assert.match(runs, /REVOKE ALL ON public\._staging_b13a_runs FROM PUBLIC, anon, authenticated/);
  assert.match(runs, /GRANT SELECT ON public\._staging_b13a_runs TO authenticated/);
  assert.doesNotMatch(runs, /GRANT (INSERT|UPDATE|DELETE|ALL)/, "ห้าม grant เขียนใด ๆ");
  assert.match(runs, /ENABLE ROW LEVEL SECURITY/, "ต้อง RLS enable");
  assert.match(runs, /FORCE ROW LEVEL SECURITY/, "ต้อง RLS force");
});

test("G10. typed evidence: step/source allowlist + write-once + ห้าม arbitrary JSON", () => {
  const ev = block("b13a_s0_evidence");
  assert.match(ev, /PRIMARY KEY \(run_id, step\)/, "write-once ต่อ (run_id, step) ด้วย PK");
  for (const s of ["gates", "r1", "r2", "failure", "session_null_attested",
                   "clean_login_rejected_attested", "local_cleanup_attested"]) {
    assert.match(ev, new RegExp(`''${s}''`), `step allowlist ต้องมี ${s}`);
  }
  assert.match(ev, /''browser_cas''/, "source ต้องมี browser_cas");
  assert.match(ev, /''owner_sql_attestation''/, "source ต้องมี owner_sql_attestation");
  assert.match(ev, /chk_b13a_evidence_step_source/, "ต้องผูก step↔source (browser เขียน browser step เท่านั้น)");
  assert.match(ev, /chk_b13a_evidence_attest_boolean_only/, "attestation ต้อง boolean/timestamp เท่านั้น");
  assert.doesNotMatch(ev, /jsonb?\b/i, "evidence ห้ามมี JSON payload");
  assert.match(ev, /CREATE POLICY b13a_evidence_select_actor/, "browser SELECT ผ่าน actor+run RLS");
  assert.doesNotMatch(ev, /GRANT (INSERT|UPDATE|DELETE|ALL)/, "browser ห้าม direct DML บน evidence");
  const res = block("b13a_s0_results");
  assert.match(res, /REVOKE ALL ON public\._staging_b13a_results FROM PUBLIC, anon, authenticated/,
    "results ต้องไม่มี browser grants");
  assert.doesNotMatch(res, /EXECUTE 'GRANT/, "results ห้ามมี GRANT statement ใด ๆ (แม้ SELECT)");
  for (const c of ["PAYMENT_BEHAVIOR_PASS", "ABORTED_NO_PAYMENT", "EXECUTION_COMPLETE"]) {
    assert.match(res, new RegExp(`''${c}''`), `certificate allowlist ต้องมี ${c}`);
  }
});

test("G11-G15. initial intent snapshot: ที่เดียว + all-NULL + atomic + no pre-compare + immutable", () => {
  // G11: intent write มีจุดเดียว = branch snapshot (gates_passed→r1_inflight)
  const setAmount = FN_BROWSER.match(/SET amount = /g) || [];
  assert.equal(setAmount.length, 1, "intent write (SET amount) ต้องมีจุดเดียวใน browser CAS");
  assert.match(BR_SNAPSHOT, /SET amount = round\(p_amount, 2\)/, "และจุดนั้นต้องอยู่ใน branch snapshot");
  assert.doesNotMatch(FN_FINALIZE, /SET amount|SET payment_method|SET paid_at|SET idempotency_key|SET note =/,
    "finalize ห้ามเขียน intent");
  assert.doesNotMatch(FN_BOOTSTRAP, /SET amount/, "bootstrap ห้ามเขียน intent");
  // G12: assert all intent columns ยัง NULL ก่อน snapshot
  assert.match(BR_SNAPSHOT,
    /IF v_run\.amount IS NOT NULL OR v_run\.payment_method IS NOT NULL OR v_run\.bank_coa_code IS NOT NULL\s*\n\s*OR v_run\.paid_at IS NOT NULL OR v_run\.idempotency_key IS NOT NULL\s*\n\s*OR v_run\.slip_url IS NOT NULL OR v_run\.note IS NOT NULL THEN/,
    "snapshot ต้อง assert intent columns ทั้งหมดยัง NULL ก่อน");
  assert.match(BR_SNAPSHOT,
    /AND amount IS NULL AND payment_method IS NULL AND bank_coa_code IS NULL\s*\n\s*AND paid_at IS NULL AND idempotency_key IS NULL AND slip_url IS NULL AND note IS NULL/,
    "UPDATE predicate ต้องล็อก all-NULL (เขียนซ้ำเป็นไปไม่ได้ระดับ SQL)");
  // G13: validate + write + read-back exact ใน transaction เดียว (UPDATE เดียวรวม stage)
  assert.match(BR_SNAPSHOT, /stage = 'r1_inflight', updated_at = now\(\)/,
    "intent snapshot กับ stage transition ต้องอยู่ UPDATE เดียว (atomic)");
  assert.match(BR_SNAPSHOT, /read-back/, "ต้องมี read-back step");
  assert.match(BR_SNAPSHOT,
    /v_chk\.amount\s+IS DISTINCT FROM round\(p_amount, 2\)[\s\S]*v_chk\.note\s+IS DISTINCT FROM p_note/,
    "read-back ต้องเทียบ exact ทุก field ที่เขียน");
  assert.match(BR_SNAPSHOT, /round\(p_amount, 2\) <> 100\.00/, "validate amount = 100.00");
  assert.match(BR_SNAPSHOT, /p_payment_method IS DISTINCT FROM 'cash'/, "validate method = cash");
  assert.match(BR_SNAPSHOT, /p_bank_coa_code IS NOT NULL OR p_slip_url IS NOT NULL/, "bank/slip ต้อง NULL");
  assert.match(BR_SNAPSHOT, /position\(p_run_id::text IN p_note\) = 0/, "note ต้องผูก exact run");
  // G14: branch snapshot ห้าม pre-compare caller intent กับ stored NULL
  assert.doesNotMatch(BR_SNAPSHOT,
    /p_(amount|payment_method|bank_coa_code|paid_at|idempotency_key|slip_url|note)\s+IS DISTINCT FROM v_run\./,
    "snapshot ห้ามเทียบ caller intent กับ stored (ยังเป็น NULL ทั้งหมด)");
  // G15: immutable — error message ห้าม overwrite + ไม่มี branch อื่นเขียน intent (จาก G11)
  assert.match(BR_SNAPSHOT, /immutable ห้าม overwrite/, "ต้องประกาศ snapshot immutable");
});

test("G16-G17. post-snapshot CAS: NULL-safe compare ครบ 8 fields ก่อน mutation ทุกครั้ง", () => {
  const cmp = FN_BROWSER.match(
    /IF p_from_stage IN \('r1_inflight', 'r1_recorded', 'r2_inflight'\) THEN([\s\S]*?)END IF;/);
  assert.ok(cmp, "ต้องมี full-field comparison block ครอบทุก post-snapshot from-stage");
  for (const f of ["service_job_id", "amount", "payment_method", "bank_coa_code",
                   "paid_at", "idempotency_key", "slip_url", "note"]) {
    assert.match(cmp[1], new RegExp(`p_${f}\\s+IS DISTINCT FROM v_run\\.${f}`),
      `compare ต้องครบ field ${f} (NULL-safe)`);
  }
  assert.match(cmp[1], /reject ก่อน mutation/, "mismatch = reject ก่อน stage/evidence mutation");
  assert.match(cmp[1], /ห้าม regenerate paidAt\/idempotency/, "ต้องห้าม regenerate");
  // ตำแหน่ง: comparison ต้องมาก่อน INSERT/UPDATE แรกใน function body
  const cmpPos = FN_BROWSER.indexOf("IF p_from_stage IN ('r1_inflight', 'r1_recorded', 'r2_inflight')");
  const firstWrite = Math.min(
    ...["INSERT INTO public._staging_b13a_evidence", "UPDATE public._staging_b13a_runs"]
      .map((s) => FN_BROWSER.indexOf(s)).filter((i) => i > 0));
  assert.ok(cmpPos < firstWrite, "comparison ต้องอยู่ก่อน write แรกทั้งหมดใน CAS");
  // ห้าม fallback เขียนทับ stored intent หลัง snapshot
  assert.doesNotMatch(BR_R1 + BR_R2IN + BR_R2 + BR_FAIL, /SET (amount|payment_method|bank_coa_code|paid_at|idempotency_key|slip_url|note) =/,
    "transition หลัง snapshot ห้ามเขียน intent ทุกกรณี");
});

test("G18. one-time ID binding — bind ครั้งเดียว NULL→positive · bind แล้วห้ามแก้", () => {
  assert.match(BR_R1, /IF v_run\.payment_id IS NOT NULL OR v_run\.payment_jv_entry_id IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION[^;]*one-time binding/,
    "r1: IDs ต้องยังไม่เคย bind");
  assert.match(BR_R1, /p_payment_id <= 0|p_payment_jv_entry_id <= 0/, "ต้อง bind positive ID เท่านั้น");
  assert.match(BR_R1, /AND payment_id IS NULL AND payment_jv_entry_id IS NULL/,
    "UPDATE predicate ต้องล็อก IDs ยัง NULL (one-time ระดับ SQL)");
  assert.match(BR_R2IN, /IDs ต้องตรงกับที่ bind แล้ว/, "r2_inflight: ห้ามเปลี่ยน bound IDs");
  assert.match(BR_R2, /IDs ต้องเป็นตัวเดิมที่ bind แล้วเป๊ะ/, "r2: same IDs เท่านั้น");
});

test("G19. failure: bind exact payment (จำเป็น) + JV optional + ห้ามบังคับ valid JV", () => {
  assert.match(BR_FAIL, /IF p_payment_id IS NULL OR p_payment_id <= 0 THEN\s*\n\s*RAISE EXCEPTION[^;]*bind exact payment ID/,
    "failure ต้อง bind exact payment ID (เมื่อยังไม่ bind)");
  assert.match(BR_FAIL, /v_pay\.created_by IS DISTINCT FROM v_uid/, "ต้องตรวจ payment ทุกช่องรวม created_by");
  assert.match(BR_FAIL, /IF p_payment_jv_entry_id IS NOT NULL THEN/, "JV ID เป็น optional");
  assert.match(BR_FAIL, /ไม่มี header = NULL ได้|ห้ามบังคับ valid/, "JV NULL ได้เมื่อไม่มี header");
  assert.doesNotMatch(BR_FAIL, /service_payment_jv_is_valid/,
    "failure path ห้ามบังคับให้ JV valid (นั่นคือสิ่งที่พังอยู่)");
  assert.match(BR_FAIL, /p_ledger_recorded IS DISTINCT FROM true OR p_accounting_posted IS DISTINCT FROM false/,
    "failure browser = ledgerRecorded=true + accountingPosted=false เท่านั้น");
});

test("G20. unknown outcome = owner classification (no guess/no retry · คง r1_inflight)", () => {
  assert.match(BR_FAIL, /ถ้าไม่พบ payment = อย่าเรียก failure ให้คง r1_inflight รอ owner classify/,
    "browser ต้องไม่เดา — unknown = คง r1_inflight");
  assert.match(FZ_CLS_INC, /owner ค้น payment ด้วย job \+ stored idempotency/,
    "owner ค้นด้วย job+idempotency");
  assert.match(FZ_CLS_INC, /candidate payment % แถว \(ต้อง 1 เป๊ะ\) — STOP ห้าม bind/,
    "candidate ต้องมีหนึ่งแถวเป๊ะ — เกิน = STOP ห้าม bind");
  for (const f of ["amount", "payment_method", "bank_coa_code", "paid_at", "slip_url", "note"]) {
    assert.match(FZ_CLS_INC, new RegExp(`v_pay\\.${f}(, 2\\))? IS DISTINCT FROM v_run\\.${f}`),
      `classify bind ต้องเทียบ stored intent field ${f} แบบ NULL-safe ก่อน bind`);
  }
  assert.match(FZ_CLS_INC, /v_pay\.created_by IS DISTINCT FROM v_run\.actor_id/,
    "classify bind ต้องตรวจ created_by = actor_id");
  assert.match(FZ_CLS_INC, /ไม่ตรง stored intent\/actor ครบทุกช่อง — STOP ห้าม bind/,
    "payload ไม่ตรง = STOP ห้าม bind");
  assert.match(FZ_CLS_INC, /JV header ของ payment มี % ใบ \(ต้อง 0 หรือ 1\) — STOP ห้าม bind/,
    "JV candidate ต้อง 0 หรือ 1 header (source exact) — เกิน = STOP");
  assert.match(FZ_CLS_INC, /ถ้าพิสูจน์ zero-write ได้ใช้ classify_failed_no_write แทน/,
    "ไม่พบ payment → เส้นทาง no-write แยกชัด");
  const b9 = rbSection("## B9)", "## B10)");
  assert.match(b9, /no guess\/no retry|ห้ามเรียก failure CAS/, "runbook B9 ต้องมี unknown-outcome rule");
});

test("G21. pre-r1 abort: เฉพาะ prepared/gates_passed + zero-write proof + exact seed cleanup", () => {
  assert.match(FZ_ABORT, /stage NOT IN \('prepared', 'gates_passed'\)/, "abort จาก pre-r1 เท่านั้น");
  assert.match(FZ_ABORT, /พบ payment % แถวของ job — ห้าม abort/, "พบ payment = ห้าม abort");
  assert.match(FZ_ABORT, /IF v_run\.idempotency_key IS NOT NULL THEN/, "ตรวจ exact idempotency เมื่อ snapshot แล้ว");
  assert.match(FZ_ABORT, /source_table IN \('service_payments', 'service_payment_reversals'\)/,
    "ตรวจ payment/reversal JE = 0");
  assert.match(FZ_ABORT, /paid total = % \(ต้อง 0\)/, "ตรวจ paid total = 0");
  assert.match(FZ_ABORT, /DELETE FROM public\.journal_lines WHERE entry_id = v_rec_je_id/,
    "ลบ recognition lines ด้วย exact resolved id");
  assert.match(FZ_ABORT, /DELETE FROM public\.service_jobs WHERE id = v_run\.service_job_id/,
    "ลบ job ด้วย exact bound id");
  assert.doesNotMatch(FZ_ABORT, /DELETE FROM[^;]*LIKE/, "abort ห้ามลบด้วย wildcard");
  assert.match(FZ_ABORT, /'ABORTED_NO_PAYMENT'/, "ต้อง insert certificate ABORTED_NO_PAYMENT");
  assert.match(FZ_ABORT, /stage = 'failed_no_write'/, "transition → failed_no_write");
});

test("G22-G23. post-r2/db fail → failed_incomplete · เงินเขียนแล้วห้ามไป failed_no_write", () => {
  assert.match(FZ_CLS_INC, /stage NOT IN \('r1_inflight','r1_recorded','r2_inflight','r2_verified','db_verified'\)/,
    "classify_failed_incomplete ครอบ r2_verified/db_verified (post-r2/db failure)");
  assert.doesNotMatch(FZ_CLS_INC, /DELETE FROM public\.(service_payments|journal_lines|journal_entries)/,
    "classify ห้ามลบ ledger/JV (retain ทุกอย่าง)");
  assert.match(FZ_CLS_NW, /stage <> 'r1_inflight'/, "classify_failed_no_write จาก r1_inflight เท่านั้น");
  assert.match(FZ_CLS_NW, /เงินเขียนแล้วต้อง classify_failed_incomplete/,
    "พบ payment = ปฏิเสธ no-write (เงินเขียนแล้วห้าม failed_no_write)");
  assert.match(FN_FINALIZE, /rollback ทั้ง transaction → stage คง db_verified ก่อน classify/,
    "teardown ล้ม = rollback ทั้งก้อน stage คง db_verified");
});

test("G24. S0 introspect-or-create-exact — ห้าม silent IF NOT EXISTS / overwrite stale", () => {
  for (const tag of ["b13a_s0_runs", "b13a_s0_results", "b13a_s0_evidence"]) {
    const b = block(tag);
    assert.match(b, /string_agg\(column_name \|\| ':' \|\| data_type \|\| ':' \|\| is_nullable/,
      `${tag}: reuse path ต้อง introspect columns exact`);
    assert.match(b, /STOP ห้าม overwrite\/reuse/, `${tag}: mismatch = STOP`);
  }
  assert.doesNotMatch(SQL_CODE, /CREATE TABLE IF NOT EXISTS public\._staging_b13a/,
    "b13a tables ห้ามใช้ CREATE TABLE IF NOT EXISTS (ต้อง introspect-or-create)");
  const FN_SIGS = {
    b13a_s0_fn_bootstrap: "public.b13a_owner_bootstrap(uuid)",
    b13a_s0_fn_browser: "public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text)",
    b13a_s0_fn_finalize: "public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean)",
    b13a_s0_fn_exposed: "public.b13a_rpc_exposed()",
  };
  for (const [tag, sig] of Object.entries(FN_SIGS)) {
    const b = block(tag);
    assert.ok(b.includes(`to_regprocedure('${sig}')`),
      `${tag}: ต้องผูกด้วย exact to_regprocedure signature (ห้ามค้นด้วยชื่ออย่างเดียว)`);
    assert.match(b, /signature ไม่ตรงเวอร์ชันนี้ — STOP/, `${tag}: ชื่อซ้ำแต่ signature อื่น = STOP`);
    assert.match(b, /IF v_prosrc IS DISTINCT FROM v_body THEN/,
      `${tag}: reuse ต้องเทียบ prosrc กับ expected body แบบ exact (marker อย่างเดียวไม่พอ)`);
    assert.match(b, /p\.prosecdef/, `${tag}: ต้องตรวจ prosecdef`);
    assert.match(b, /array_to_string\(p\.proconfig, ','\)/, `${tag}: ต้องตรวจ proconfig exact`);
    assert.match(b, /l\.lanname/, `${tag}: ต้องตรวจ language`);
    assert.match(b, /r\.rolsuper OR r\.rolbypassrls FROM pg_roles r WHERE r\.oid = p\.proowner/,
      `${tag}: ต้องตรวจ owner เป็น trusted role จริง`);
    assert.match(b, /aclexplode\(coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/,
      `${tag}: ต้องคลี่ acl รวม default (proacl NULL = PUBLIC execute)`);
    assert.match(b, /a\.grantee = 0 AND a\.privilege_type = 'EXECUTE'/,
      `${tag}: ต้องตรวจ PUBLIC (grantee=0) ด้วย`);
    // audit R2-A: ห้าม overload — ชื่อละหนึ่ง signature เท่านั้น
    assert.match(b, /SELECT count\(\*\) INTO v_cnt_name FROM pg_proc p JOIN pg_namespace n/,
      `${tag}: ต้องนับ pg_proc ทุก signature ของชื่อนี้`);
    assert.match(b, /IF v_cnt_name > 1 THEN\s*\n\s*RAISE EXCEPTION[^;]*overload/,
      `${tag}: พบ overload = STOP (PostgREST resolution/expose เกิน)`);
    // audit R2-B: grantee allowlist ทั้งหมด — ไม่ใช่ blacklist สาม role
    assert.match(b, /SELECT count\(\*\) INTO v_acl_bad/,
      `${tag}: ต้องนับ grantee นอก allowlist จาก aclexplode`);
    assert.match(b, /grantee นอก allowlist[^;]*STOP ห้าม reuse/,
      `${tag}: grantee อื่นทุกตัว = STOP`);
    if (tag === "b13a_s0_fn_bootstrap" || tag === "b13a_s0_fn_finalize") {
      assert.match(b, /AND a\.grantee <> p\.proowner;/,
        `${tag}: owner function allowlist = owner เท่านั้น`);
    } else {
      assert.match(b, /NOT \(a\.grantee = p\.proowner\s*\n\s*OR \(a\.grantee = to_regrole\('authenticated'\)::oid AND a\.privilege_type = 'EXECUTE'\)\)/,
        `${tag}: browser/probe allowlist = owner + authenticated(EXECUTE) เท่านั้น`);
    }
    // audit R3-B1: ห้ามมี WITH GRANT OPTION ทุกกรณี
    assert.match(b, /WHERE p\.oid = v_oid AND a\.is_grantable;/,
      `${tag}: ต้องตรวจ is_grantable ทุก grant`);
    assert.match(b, /EXECUTE WITH GRANT OPTION % รายการ — STOP ห้าม reuse/,
      `${tag}: grant option = STOP`);
    // audit R3-SF: API metadata exact — args/result/attributes
    assert.match(b, /pg_get_function_arguments\(p\.oid\), pg_get_function_result\(p\.oid\)/,
      `${tag}: ต้องตรวจ argument names/defaults + return type`);
    assert.match(b, /p\.provolatile, p\.proisstrict, p\.proparallel, p\.proleakproof, p\.prokind/,
      `${tag}: ต้องตรวจ volatility/strict/parallel/leakproof/kind`);
    assert.match(b, /argument names\/defaults ไม่ตรงเป๊ะ/, `${tag}: args mismatch = STOP`);
    assert.match(b, /return type ไม่ตรง/, `${tag}: return type mismatch = STOP`);
    assert.match(b, /function attributes ไม่ตรง/, `${tag}: attributes mismatch = STOP`);
    assert.match(b, /STOP ห้าม overwrite/, `${tag}: mismatch = STOP`);
    assert.doesNotMatch(b, /CREATE OR REPLACE FUNCTION/, `${tag}: ห้าม CREATE OR REPLACE (overwrite)`);
  }
  // browser CAS: expected args ต้องคง named args + defaults ที่ runbook พึ่งพา
  const brW = block("b13a_s0_fn_browser");
  assert.ok(brW.includes("p_run_id uuid, p_from_stage text, p_to_stage text,"),
    "browser: expected args ต้องล็อกชื่อ argument ครบ");
  assert.ok(brW.includes("p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone"),
    "browser: expected args ต้องล็อก DEFAULT NULL ของ optional args");
  // ตาราง: reuse ต้อง exact ครบ PK/CHECK/policy/FORCE RLS/grants รวม PUBLIC
  const TBL_EXPECT = {
    b13a_s0_runs: { pk: "'singleton'", qual: "'(singleton AND (actor_id = auth.uid()))'" },
    b13a_s0_results: { pk: "'run_id,certificate'", qual: null },
    b13a_s0_evidence: { pk: "'run_id,step'", qual: "(r.actor_id = auth.uid())" },
  };
  const TBL_EXACT = {
    b13a_s0_runs: { ctypes: "'c=4,p=1,u=1'", idx: 2 },
    b13a_s0_results: { ctypes: "'c=1,p=1'", idx: 1 },
    b13a_s0_evidence: { ctypes: "'c=5,p=1'", idx: 1 },
  };
  for (const [tag, exp] of Object.entries(TBL_EXPECT)) {
    const b = block(tag);
    assert.match(b, /i\.indisprimary/, `${tag}: ต้อง introspect PK จริง`);
    assert.ok(b.includes(`IF v_pk IS DISTINCT FROM ${exp.pk}`), `${tag}: PK ต้องเทียบ exact`);
    // audit R2-C: CHECK definitions เทียบ normalized ทั้งนิพจน์ (ไม่ใช่ member substring)
    assert.match(b, /regexp_replace\(pg_get_constraintdef\(c\.oid\), '\[\(\)\\s\]\+', '', 'g'\)/,
      `${tag}: ต้องเทียบ constraint definition แบบ normalized เต็มนิพจน์`);
    assert.match(b, /นิยามไม่ตรงเป๊ะ/, `${tag}: definition mismatch = STOP`);
    // audit R2-C: defaults/identity/generated + ชุด constraint + index exact
    assert.match(b, /coalesce\(column_default, '-'\) \|\| ':' \|\| is_identity \|\| ':' \|\| is_generated/,
      `${tag}: ต้องตรวจ column_default/identity/generated`);
    assert.match(b, /created_at=now\(\):NO:NEVER/, `${tag}: created_at default ต้องเป็น now() exact`);
    assert.ok(b.includes(`IF v_chk IS DISTINCT FROM ${exp === undefined ? "" : TBL_EXACT[tag].ctypes}`),
      `${tag}: จำนวน constraint ต่อชนิดต้อง exact (${TBL_EXACT[tag].ctypes})`);
    assert.match(b, new RegExp(`index ต้องมี ${TBL_EXACT[tag].idx} `), `${tag}: จำนวน index ต้อง exact`);
    assert.match(b, /'PUBLIC'/, `${tag}: grants ต้องครอบ PUBLIC ด้วย`);
    // audit R2-B: table grants เป็น allowlist ทั้งหมดผ่าน relacl
    assert.match(b, /aclexplode\(coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/,
      `${tag}: ต้องคลี่ relacl (allowlist ทุก grantee ไม่ใช่ blacklist)`);
    assert.match(b, /table grant นอก allowlist[^;]*STOP ห้าม reuse/,
      `${tag}: grant ให้ role อื่น = STOP`);
    // audit R3-B1: ห้าม WITH GRANT OPTION บนตาราง
    assert.match(b, /::regclass AND a\.is_grantable;/, `${tag}: ต้องตรวจ is_grantable บนตาราง`);
    assert.match(b, /table grant WITH GRANT OPTION % รายการ — STOP ห้าม reuse/,
      `${tag}: grant option บนตาราง = STOP`);
    // audit R3-B2: table owner ต้องเป็น trusted role จริง (ห้ามยอมรับ relowner อัตโนมัติ)
    assert.match(b, /SELECT r\.rolsuper OR r\.rolbypassrls INTO v_ok\s*\n\s*FROM pg_class c JOIN pg_roles r ON r\.oid = c\.relowner/,
      `${tag}: ต้อง introspect owner ผ่าน pg_roles`);
    assert.match(b, /table owner ไม่ใช่ trusted role[^;]*STOP ห้าม reuse/,
      `${tag}: owner ไม่ trusted = STOP`);
    assert.match(b, /relrowsecurity AND c\.relforcerowsecurity/, `${tag}: ต้องตรวจ RLS ENABLE+FORCE`);
    if (exp.qual) {
      assert.ok(b.includes(exp.qual), `${tag}: policy expression ต้องเทียบ exact`);
      assert.match(b, /regexp_replace\(coalesce\(pp\.qual, ''\)/, `${tag}: ต้องอ่าน qual จริงมาเทียบ`);
    } else {
      assert.match(b, /ต้องไม่มี policy/, `${tag}: results ต้อง assert policy = 0`);
    }
  }
  // audit R2-C: runs ต้อง verify CHECK(singleton) + UNIQUE(run_id) โดยนิยามจริง
  const runsB = block("b13a_s0_runs");
  assert.match(runsB, /= 'CHECKsingleton'/, "runs: ต้อง verify CHECK (singleton) ด้วยนิยาม normalized");
  assert.match(runsB, /= 'UNIQUErun_id'/, "runs: ต้อง verify UNIQUE (run_id) ด้วยนิยาม normalized");
  assert.match(runsB, /'CHECKstage=ANYARRAY\[''prepared''::text/, "runs: stage CHECK เทียบ normalized เต็มนิพจน์");
  const evB = block("b13a_s0_evidence");
  assert.match(evB, /'CHECKstep<>ALLARRAY\[''session_null_attested''::text/,
    "evidence: attest_boolean_only เทียบ normalized เต็มนิพจน์");
  assert.doesNotMatch(SQL_CODE, /\bDROP\s+(TABLE|FUNCTION|TRIGGER|POLICY|INDEX)\b/i,
    "script ห้าม DROP ใด ๆ (ไม่มี auto cleanup)");
  assert.doesNotMatch(SQL_CODE, /TRUNCATE\s+(TABLE\b|public\.)/i,
    "ห้าม TRUNCATE statement (คำใน privilege-grant check เป็นข้อยกเว้นโดยชอบธรรม)");
});

test("G25-G26. NOTIFY pgrst: scratch-only (sentinel-gated) + production forbidden", () => {
  const notifies = SQL_CODE.match(/NOTIFY pgrst, '+reload schema'+/g) || [];
  assert.equal(notifies.length, 1, "NOTIFY pgrst statement ต้องมีจุดเดียวทั้งไฟล์");
  const reload = block("b13a_s0_reload");
  assert.match(reload, /NOTIFY pgrst/, "และอยู่ใน block S0-RELOAD ที่มี sentinel interlock");
  const ilPos = reload.indexOf("_staging_b13a_sentinel");
  const nfPos = reload.indexOf("NOTIFY pgrst");
  assert.ok(ilPos > 0 && ilPos < nfPos, "sentinel check ต้องมาก่อน NOTIFY");
  assert.match(reload, /ห้าม NOTIFY pgrst นอก scratch staging|production ห้ามทุกกรณี/,
    "ต้องประกาศห้าม production");
  assert.match(SQL, /package implementation phase ห้ามรัน NOTIFY/,
    "ต้องประกาศว่า package phase ห้ามรัน NOTIFY");
});

test("G27. pre-browser RPC exposure check (read-only probe) — ยังไม่ expose = STOP ห้าม r1", () => {
  assert.match(block("b13a_s0_fn_exposed"), /b13a_rpc_exposed/, "ต้องมี probe function");
  assert.match(block("b13a_preflight"), /b13a_rpc_exposed/, "preflight ต้องยืนยัน probe พร้อม");
  const b6 = rbSection("## B6)", "## B7)");
  assert.match(b6, /sb\.rpc\('b13a_rpc_exposed'\)/, "runbook ต้องสั่ง probe ผ่าน canonical client");
  assert.match(b6, /STOP ห้าม r1/, "ยังไม่ reload = STOP ห้าม r1");
  assert.match(b6, /read-only|preflight/i, "ต้องเป็น preflight/read-only call เท่านั้น");
});

test("G28. PREFLIGHT: B12 retained (6 pass + residual 0) + no B13ATEST + active run 0 + baseline", () => {
  const pre = block("b13a_preflight");
  assert.match(pre, /_staging_b12_results/, "ต้องเช็ค B12 results");
  assert.match(pre, /v_cnt <> 6 OR v_cnt2 <> 6/, "B12 ต้อง 6/6 ok=true");
  assert.match(pre, /B12TEST-%/, "ต้องเช็ค B12 residual = 0");
  assert.match(pre, /B13ATEST rows ค้าง/, "ต้องเช็คไม่มี B13ATEST ค้าง");
  assert.match(pre, /stale run = STOP/, "run ค้าง = STOP (ห้าม takeover)");
  assert.match(pre, /68 OR v_cnt2 <> 36/, "COA/mapping ต้องตรง baseline B12 (68/36)");
  assert.match(pre, /profiles/, "ต้อง introspect profiles schema");
  assert.match(pre, /is_period_locked/, "ต้องเช็ค accounting period เปิด");
});

test("G29. trigger/journal safety: DISABLE จุดเดียว + ENABLE + VERIFY + ห้ามแตะ journal triggers", () => {
  const disables = [...SQL_CODE.matchAll(/DISABLE TRIGGER (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(disables, ["trg_service_jobs_metadata_update_guard"],
    "DISABLE TRIGGER ต้องมีตัวเดียวทั้งไฟล์ = metadata_update_guard (ใน SEED)");
  const seed = block("b13a_seed");
  const pd = seed.indexOf("DISABLE TRIGGER trg_service_jobs_metadata_update_guard");
  const pu = seed.indexOf("SET finance_flow_version = 2");
  const pe = seed.indexOf("ENABLE TRIGGER trg_service_jobs_metadata_update_guard");
  const pv = seed.indexOf("tgenabled");
  assert.ok(pd > 0 && pu > pd && pe > pu && pv > pe,
    "SEED ต้องเรียง DISABLE → UPDATE → ENABLE → VERIFY ใน transaction เดียว");
  assert.match(seed, /IF v_enabled IS DISTINCT FROM 'O' THEN/, "ต้อง assert tgenabled='O' จริง");
  assert.doesNotMatch(SQL, /ALTER TABLE[^;]*journal_(entries|lines)[^;]*(DISABLE|ENABLE) TRIGGER/i,
    "ห้าม disable/enable trigger ฝั่ง journal — นั่นคือของที่กำลังพิสูจน์");
  assert.match(seed, /trg_je_lines_balance/, "SEED ต้อง verify journal trigger ยัง enabled");
});

test("G30. recognition validators + payment effective floor ตรง source", () => {
  assert.match(FN_BOOTSTRAP, /service_job_has_recognition_jv/, "bootstrap ต้องพิสูจน์ recognition ด้วย function จริง");
  assert.match(BR_GATES, /service_job_has_recognition_jv/, "gates ต้อง re-check recognition ฝั่ง server");
  assert.match(block("b13a_preflight"), /AT TIME ZONE ''Asia\/Bangkok''|AT TIME ZONE ''Asia/,
    "preflight ต้องยืนยัน effective floor (เวลาไทย) ใน source ของ RPC");
  assert.match(BR_SNAPSHOT, /AT TIME ZONE 'Asia\/Bangkok'\)::date < DATE '2026-07-01'/,
    "snapshot ต้อง validate paid_at ไม่ต่ำกว่า floor แบบเดียวกับ RPC");
  const b6 = rbSection("## B6)", "## B7)");
  assert.match(b6, /validateRecognitionJv\(\)\.ok===true/, "runbook ต้องมี runtime validateRecognitionJv proof");
});

test("G31. r1/r2 full assertions — สัญญา client ครบ + server พิสูจน์ no-double-write", () => {
  assert.match(BR_R1, /p_inserted IS DISTINCT FROM true/, "r1: inserted ต้อง true");
  assert.match(BR_R1, /p_jv_status IS DISTINCT FROM 'posted'/, "r1: jv.status ต้อง posted");
  assert.match(BR_R1, /100\.00[\s\S]*900\.00/, "r1: totals 100/900");
  assert.match(BR_R1, /v_pay\.created_by IS DISTINCT FROM v_uid/, "r1: created_by = actor");
  assert.match(BR_R1, /service_payment_jv_is_valid/, "r1: JV ต้องผ่าน validator ฝั่ง DB");
  assert.match(BR_R1, /v_pay_count <> 1/, "r1: payment ต้อง 1 แถวเป๊ะ");
  assert.match(BR_R2, /p_inserted IS DISTINCT FROM false/, "r2: inserted ต้อง false");
  assert.match(BR_R2, /p_jv_reason IS DISTINCT FROM 'duplicate-valid'/, "r2: reason ต้อง duplicate-valid");
  assert.match(BR_R2, /retry ต้องไม่ insert ซ้ำ/, "r2: server เช็ค payment ไม่เพิ่ม");
  assert.match(BR_R2, /retry ต้องไม่สร้าง JV ซ้ำ/, "r2: server เช็ค JV ไม่เพิ่ม");
  const b7 = rbSection("## B7)", "## B8)");
  assert.match(b7, /r1\.ok === true[\s\S]*ledgerRecorded === true[\s\S]*accountingPosted === true/,
    "runbook r1 ต้องแยก ledgerRecorded กับ accountingPosted");
  assert.match(b7, /jv\.status === 'posted'/, "runbook r1: jv.status=posted");
  const b8 = rbSection("## B8)", "## B9)");
  assert.match(b8, /inserted === false/, "runbook r2: inserted=false");
  assert.match(b8, /duplicate-valid/, "runbook r2: duplicate-valid");
  assert.match(b8, /ห้าม regenerate/, "runbook r2: intent เดิมทุก field");
});

test("G32. verify_db full payload — job/payment/reversal/totals/JV lines/orphan/evidence/triggers", () => {
  for (const [pat, why] of [
    [/finance_flow_version IS DISTINCT FROM 2 OR v_job\.status <> 'delivered'/, "job flow2/delivered"],
    [/round\(v_job\.total_cost, 2\) <> 1000\.00/, "job 1000"],
    [/round\(v_pay\.amount, 2\) <> 100\.00 OR v_pay\.payment_method <> 'cash'/, "payment cash 100"],
    [/v_pay\.bank_coa_code IS NOT NULL OR v_pay\.slip_url IS NOT NULL/, "bank/slip NULL"],
    [/v_pay\.created_by IS DISTINCT FROM v_run\.actor_id/, "created_by = actor"],
    [/reversal ต้อง 0/, "reversals 0"],
    [/100\.00 OR round\(v_job\.total_cost - v_paid, 2\) <> 900\.00/, "paid/outstanding 100/900"],
    [/recognition JV header ต้อง 1 ใบ/, "recognition 1 header"],
    [/payment JV header ต้อง 1 ใบ/, "payment JV 1 header"],
    [/v_map\.debit_account_code\s+AND round\(coalesce\(jl\.debit,0\),2\) = 100\.00/, "Dr เงินสด 100"],
    [/v_map\.recognition_debit_code\s+AND round\(coalesce\(jl\.credit,0\),2\) = 100\.00/, "Cr 1200 100"],
    [/JE ของ run ต้องมี 2 ใบเป๊ะ/, "no orphan/extra"],
    [/evidence gates\/r1\/r2 ต้องครบ ok=true/, "evidence ครบ"],
    [/มี failure evidence — ห้าม verify_db/, "no failure"],
    [/ต้องครบ 6 \(พบ %\)/, "triggers 6 ตัว O"],
  ]) {
    assert.match(FZ_VERIFY, pat, `verify_db ต้องตรวจ: ${why}`);
  }
  assert.match(FZ_VERIFY, /service_job_has_recognition_jv[\s\S]*service_payment_jv_is_valid/,
    "verify_db ต้องเรียก validator ฝั่ง DB ทั้งคู่ (function-truth)");
});

test("G33. teardown: exact IDs ตามลำดับ + reversal assert 0 + residual 0 + ห้าม wildcard authority", () => {
  const order = ["DELETE FROM public.journal_lines WHERE entry_id = v_run.payment_jv_entry_id",
                 "DELETE FROM public.journal_lines WHERE entry_id = v_rec_je_id",
                 "DELETE FROM public.journal_entries WHERE id = v_run.payment_jv_entry_id",
                 "DELETE FROM public.journal_entries WHERE id = v_rec_je_id",
                 "DELETE FROM public.service_payment_reversals WHERE payment_id = v_run.payment_id",
                 "DELETE FROM public.service_payments WHERE id = v_run.payment_id",
                 "DELETE FROM public.service_jobs WHERE id = v_run.service_job_id"];
  let last = -1;
  for (const stmt of order) {
    const p = FZ_TEARDOWN.indexOf(stmt);
    assert.ok(p > last, `ลำดับลบต้องตาม A14 และเป็น exact ID: ${stmt}`);
    last = p;
  }
  assert.match(FZ_TEARDOWN, /พบ reversal % แถว \(ต้อง 0\) — STOP/, "ก่อนลบ: reversal ต้อง 0");
  assert.match(FZ_TEARDOWN, /defensive reversal delete โดน % แถว \(ต้อง 0\)/, "defensive delete ต้องโดน 0");
  assert.doesNotMatch(FZ_TEARDOWN.replace(/--[^\n]*/g, ""), /DELETE FROM[^;]*(LIKE|job_no|note)/,
    "ห้ามใช้ job_no/note/wildcard เป็น deletion authority");
  assert.match(FZ_TEARDOWN, /IF v_n <> 2 THEN RAISE EXCEPTION 'B13A FINALIZE\(teardown\): payment JV lines ลบ % \(ต้อง 2\) — rollback'/,
    "delete count ไม่ตรง = RAISE EXCEPTION (rollback ทั้ง transaction — ห้าม partial)");
  assert.match(FZ_TEARDOWN, /residual = % \(ต้อง 0\)/, "ก่อนจบ: residual ทั้งหมด 0");
  assert.match(FZ_TEARDOWN, /68 OR v_cnt2 <> 36/, "COA/mapping ต้อง unchanged (68/36)");
  assert.match(FZ_TEARDOWN, /_staging_b12_results/, "B12 evidence ต้อง unchanged");
  assert.match(FZ_TEARDOWN, /B13a evidence ต้อง retained ครบ 3/, "B13a evidence ต้อง retained");
});

test("G34. behavior certificate: PASS ออกจาก teardown สำเร็จเท่านั้น + atomic กับ transition", () => {
  assert.match(FZ_TEARDOWN, /'PAYMENT_BEHAVIOR_PASS'/, "teardown สำเร็จ = insert PAYMENT_BEHAVIOR_PASS");
  const certPos = FZ_TEARDOWN.indexOf("'PAYMENT_BEHAVIOR_PASS'");
  const residPos = FZ_TEARDOWN.indexOf("residual = % (ต้อง 0)");
  assert.ok(residPos > 0 && residPos < certPos, "certificate ต้องออกหลัง residual checks (atomic transaction เดียว)");
  assert.doesNotMatch(FN_BROWSER, /PAYMENT_BEHAVIOR_PASS/, "browser ห้ามออก certificate");
  assert.doesNotMatch(FN_BOOTSTRAP, /PAYMENT_BEHAVIOR_PASS/, "bootstrap ห้ามออก certificate");
});

test("G35. exact actor cleanup — นับเฉพาะแถว actor ห้าม table-wide count", () => {
  assert.match(FZ_ATTEST, /FROM auth\.users u\s+WHERE u\.id = v_run\.actor_id/,
    "attest: auth.users นับเฉพาะ exact actor");
  assert.match(FZ_ATTEST, /FROM public\.profiles pr WHERE pr\.id = v_run\.actor_id/,
    "attest: profiles นับเฉพาะ exact actor");
  const authUses = [...(FN_FINALIZE + FN_BOOTSTRAP).matchAll(/FROM auth\.users(\s+u)?([^;]*)/g)];
  for (const m of authUses) {
    assert.match(m[2], /WHERE u?\.?id = (v_run\.actor_id|p_actor_id)/,
      "ทุกการอ่าน auth.users ต้อง scope ด้วย exact actor id (ห้าม table-wide)");
  }
  const b11 = rbSection("## B11)", "## เกณฑ์ผ่านรวม");
  assert.match(b11, /ห้าม table-wide count/, "runbook B11 ต้องย้ำ exact-row count");
  assert.match(b11, /Auth delete ไม่ได้ = STOP/, "Auth delete ไม่ได้ = STOP");
  assert.match(b11, /Test-Path/, "ต้องมี Test-Path ตรวจ local cleanup = false ทั้งคู่");
});

test("G36. owner attestations 3 แถว write-once + human-attestation wording", () => {
  assert.match(FZ_ATTEST, /'session_null_attested'[\s\S]*'clean_login_rejected_attested'[\s\S]*'local_cleanup_attested'/,
    "ต้อง insert attestation ครบ 3 แถว");
  assert.match(FZ_ATTEST, /'owner_sql_attestation'/, "source ต้องเป็น owner_sql_attestation");
  assert.match(FZ_ATTEST, /p_session_null IS DISTINCT FROM true\s*\n\s*OR p_clean_login_rejected IS DISTINCT FROM true\s*\n\s*OR p_local_cleanup IS DISTINCT FROM true/,
    "boolean ทั้ง 3 ต้อง true ครบจึงเขียน");
  assert.match(FZ_ATTEST, /human/, "ต้องประกาศเป็น human attestation");
  assert.match(RB, /human attestation[^\n]*ไม่ใช่ DB-observed browser proof/,
    "runbook ต้องประกาศ: human attestation ไม่ใช่ DB-observed browser proof");
  // attest insert = ok=true อย่างเดียว (boolean/timestamp เท่านั้น — คุมด้วย CHECK ของตาราง)
  assert.match(FZ_ATTEST, /INSERT INTO public\._staging_b13a_evidence \(run_id, step, source, ok\) VALUES/,
    "attestation ต้องเขียนเฉพาะ run_id/step/source/ok (ไม่มี payload อื่น)");
});

test("G37. complete ขึ้นกับ behavior + evidence + attestation ครบ", () => {
  assert.match(FZ_COMPLETE, /'PAYMENT_BEHAVIOR_PASS'/, "complete ต้องเช็ค PASS");
  assert.match(FZ_COMPLETE, /step IN \('gates','r1','r2'\) AND e\.ok/, "complete ต้องเช็ค evidence 3 step");
  assert.match(FZ_COMPLETE, /owner attestations ไม่ครบ 3/, "complete ต้องเช็ค attestations 3");
  assert.match(FZ_COMPLETE, /มี failure evidence — ห้าม complete/, "failure = ห้าม complete");
  assert.match(FZ_COMPLETE, /IDs ต้อง retained/, "IDs ต้อง retained");
  assert.match(FZ_COMPLETE, /'EXECUTION_COMPLETE'/, "จึงออก EXECUTION_COMPLETE + transition atomic");
});

test("G38. evidence retention — ไม่มี DELETE/DROP บนตาราง b13a + runbook ห้ามลบ retained", () => {
  assert.doesNotMatch(SQL_CODE, /DELETE FROM public\._staging_b13a_(runs|results|evidence|sentinel)/,
    "script ห้ามลบ run/results/evidence/sentinel (retain ตลอด)");
  assert.match(RB, /Retained evidence ห้ามลบ|retained[^\n]*ห้ามลบ/i, "runbook ต้องห้ามลบ retained evidence");
  assert.match(RB, /owner-authorized recovery\/cleanup phase แยก/, "การลบ = recovery phase แยก");
});

test("G39. canonical client เดียว + ห้าม second client + ห้าม service_role", () => {
  const b6 = rbSection("## B6)", "## B7)");
  assert.match(b6, /window\.App\?\.state\?\.supabase/, "canonical client = window.App.state.supabase");
  assert.match(b6, /ห้ามสร้าง client ที่สอง/, "ห้าม second client");
  assert.match(b6, /window\._sbAccessToken/, "ต้องอ้าง auth refresh contract ของแอป");
  const b5 = rbSection("## B5)", "## B6)");
  assert.match(b5, /ห้ามมี service_role key/, "ห้าม service_role ทุกขั้น");
  // Phase 606-B13a.1: เดิม assert ว่า SQL ห้ามมีคำว่า service_role เลย — แต่ hotfix ต้อง REVOKE
  // default privileges ของ service_role จริง (ซึ่งเป็นการ "ลดสิทธิ์" ไม่ใช่เปิดสิทธิ์) จึงเปลี่ยน
  // จาก blanket ban → context allowlist ที่เข้มกว่าเดิม: อนุญาตเฉพาะ REVOKE ที่ระบุ object เป๊ะ
  // + to_regrole introspection · ที่เหลือทั้งหมด (โดยเฉพาะ GRANT ให้ service_role) = แดง
  let srProbe = SQL_CODE.replace(/RAISE (EXCEPTION|NOTICE)\s+'(?:[^']|'')*'/g, "");
  for (const allowed of [
    /REVOKE ALL ON public\._staging_b13a_(runs|results|evidence) FROM PUBLIC, anon, authenticated, service_role/g,
    /REVOKE ALL ON FUNCTION public\.b13a_[a-z_]+\([^)]*\) FROM PUBLIC, anon, authenticated, service_role/g,
    /REVOKE ALL ON public\._staging_b13a_(runs|results|evidence) FROM service_role/g,
    /REVOKE ALL ON FUNCTION public\.b13a_owner_bootstrap\(uuid\) FROM service_role/g,
    /to_regrole\('service_role'\)/g,
  ]) srProbe = srProbe.replace(allowed, "");
  assert.doesNotMatch(srProbe, /service_role/i,
    "SQL อ้าง service_role ได้เฉพาะ REVOKE object เป๊ะ + to_regrole introspection (GRANT = ห้ามทุกกรณี)");
  assert.doesNotMatch(SQL, /service_role[^\n]{0,40}(key|secret|token|jwt|apikey|bearer)/i,
    "ห้ามอ้าง service_role ในบริบท credential/key");
  assert.doesNotMatch(SQL, /(key|secret|token|jwt|apikey|bearer)[^\n]{0,40}service_role/i,
    "ห้ามอ้าง service_role ในบริบท credential/key");
  assert.match(b5, /production host แม้แต่ครั้งเดียว = STOP/, "network ไป production = STOP");
});

test("G40. JWT/binding checkpoints + no leaks (REPORT ไม่มี actor_id)", () => {
  const b6 = rbSection("## B6)", "## B7)");
  assert.match(b6, /boolean เท่านั้น[\s\S]*ห้าม print token\/JWT/, "ตรวจแบบ boolean ห้าม print token");
  assert.match(b6, /Binding checkpoints/, "ต้องมี binding checkpoints list");
  for (const cp of ["pre-login", "post-login", "ก่อน gates", "ก่อน r1", "หลัง r1 read-back",
                    "ก่อน r2", "หลัง r2 read-back", "ก่อน sign-out"]) {
    assert.match(b6, new RegExp(cp), `checkpoint ต้องครอบ: ${cp}`);
  }
  const reportSql = SQL.slice(SQL.indexOf("-- REPORT"));
  const reportCode = reportSql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  assert.doesNotMatch(reportCode, /actor_id/, "REPORT ห้าม select actor_id (UUID อยู่ใน DB เท่านั้น)");
  const b10 = rbSection("## B10)", "## B11)");
  assert.match(b10, /Actor UUID เก็บเฉพาะใน scratch DB/, "actor UUID อยู่ใน scratch DB เท่านั้น");
  assert.match(b10, /ห้ามเผย credential\/JWT\/token\/host\/ref\/key\/local path/, "no-leak rule ครบ");
});

test("G41-G42. no auto takeover/expiry/cleanup + terminal run บล็อก run ใหม่", () => {
  assert.doesNotMatch(SQL_CODE, /expires?_at|\bttl\b/i, "ห้ามมี expiry/TTL column ใด ๆ");
  assert.doesNotMatch(SQL_CODE, /updated_at\s*<\s*now\(\)\s*-/, "ห้ามมี staleness-takeover logic");
  assert.doesNotMatch(SQL_CODE, /DELETE FROM public\._staging_b13a_runs/, "ห้าม auto cleanup run");
  assert.match(FN_BOOTSTRAP, /active หรือ terminal ก็บล็อกทั้งคู่/,
    "terminal run ยังบล็อก run ใหม่ (count ทั้งตาราง ไม่กรอง stage)");
  assert.match(block("b13a_preflight"), /ห้าม takeover\/auto cleanup/, "preflight: stale run = STOP");
});

test("G43. การลบ retained run/evidence = owner recovery phase แยกหลัง reviewer approval", () => {
  assert.match(SQL, /owner recovery phase แยก|recovery phase แยกหลัง reviewer approval/,
    "SQL ต้องประกาศ recovery phase แยก");
  assert.match(FN_BOOTSTRAP, /owner recovery phase แยกหลัง reviewer approval/,
    "bootstrap ต้องชี้ทาง recovery phase (ไม่ลบเอง)");
});

test("G44. Windows npm.cmd/npx.cmd ใน runbook", () => {
  assert.match(RB, /npm\.cmd/, "runbook ต้องระบุ npm.cmd สำหรับ Windows");
  assert.match(RB, /npx\.cmd/, "runbook ต้องระบุ npx.cmd สำหรับ Windows");
});

test("G45. package-only: ห้ามรัน SQL/แตะ runtime/build + next phases ยังไม่ได้รับอนุญาต", () => {
  const b1 = rbSection("## B1)", "## B2)");
  assert.match(b1, /Package phase \(PR นี้\) ห้ามรัน SQL ทุก statement/, "package ห้ามรัน SQL");
  assert.match(b1, /Execution เป็น owner-controlled เท่านั้น หลัง PR merge/, "execution = owner หลัง merge");
  assert.match(b1, /CI\/guard test ไม่ใช่ behavioral proof/, "CI ≠ behavioral proof");
  assert.match(b1, /B13a = NOT RUN/, "B13a NOT RUN จน execute จริง");
  assert.match(b1, /ห้าม claim `PAYMENT_BEHAVIOR_PASS`/, "ห้าม claim PASS จาก CI");
  assert.match(RB, /606-b2c\/606-b3\/607\)?[\s\S]{0,60}ยังไม่ได้รับอนุญาต/,
    "เฟสถัดไปต้องมี prompt/audit/owner approval แยก");
  // build markers ต้องไม่ถูกแตะโดย package นี้ (สามไฟล์ deliverable ไม่มีใครแตะ index.html/sw.js)
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(idx, /data-app-build="604"/, "build marker ต้องคง 604 (ไม่ bump)");
  assert.match(idx, /data-app-version="5\.69\.72"/, "version ต้องคง 5.69.72");
});

// ═════════════════════════════════════════════════
//  Phase 606-B13a.1 — fresh-create ACL exactness + S0-ACL-RECOVERY (G46+)
// ═════════════════════════════════════════════════
const RECOVERY = block("b13a_s0_acl_recovery");
// tri-state branch extraction จาก marker คงที่ใน recovery block
function recBranch(startMark, endMark) {
  const s = RECOVERY.indexOf(startMark);
  const e = endMark ? RECOVERY.indexOf(endMark) : RECOVERY.length;
  assert.ok(s > 0 && (endMark ? e > s : true), `extract recovery branch ${startMark} ไม่ได้`);
  return RECOVERY.slice(s, endMark ? e : undefined);
}
const REC_NOOP = recBranch("══ STATE 1", "══ STATE 2");
const REC_REPAIR = recBranch("══ STATE 2", "══ STATE 3");
const REC_STOP = recBranch("══ STATE 3");
// แยก REPAIR เป็นก่อน/หลัง mutation แล้ว assert แยกสองฝั่ง — assert แบบ "มีอยู่ที่ใดที่หนึ่ง"
// อ่อนเกินไป เพราะ check ชุดเดียวกันปรากฏทั้ง precheck และ post-check: ถอดฝั่งเดียวจะยังเขียว
const REC_MUT_IDX = REC_REPAIR.indexOf("EXECUTE 'REVOKE");
const REC_PRE = REC_REPAIR.slice(0, REC_MUT_IDX);
const REC_POST = REC_REPAIR.slice(REC_MUT_IDX);
// ไฟล์นี้เป็น source ของ G3 units ด้วย — อ่านตัวเองเพื่อ assert ว่า recovery ถูกผูกเข้า G3 จริง
const SELF = fs.readFileSync(new URL(import.meta.url), "utf8");
const S0_TABLE_BLOCKS = ["b13a_s0_runs", "b13a_s0_results", "b13a_s0_evidence"];
const S0_FN_BLOCKS = ["b13a_s0_fn_bootstrap", "b13a_s0_fn_browser",
                      "b13a_s0_fn_finalize", "b13a_s0_fn_exposed"];
// fresh-create branch = ส่วนที่มี "created" NOTICE (ตัด reuse path ออกก่อน assert)
const B13A_TABLES = ["_staging_b13a_runs", "_staging_b13a_results", "_staging_b13a_evidence"];

test("G46. fresh-create ทั้ง 7 blocks ถอน service_role (default privileges ของ Supabase)", () => {
  for (const t of B13A_TABLES) {
    assert.match(SQL_CODE,
      new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated, service_role`),
      `${t}: fresh-create ต้อง REVOKE รวม service_role`);
  }
  const FN_SIGS = [
    "public.b13a_owner_bootstrap(uuid)",
    "public.b13a_browser_transition(uuid,text,text,bigint,numeric,text,text,timestamptz,uuid,text,text,bigint,bigint,boolean,boolean,boolean,boolean,numeric,numeric,text,text,text)",
    "public.b13a_owner_finalize(uuid,text,text,boolean,boolean,boolean)",
    "public.b13a_rpc_exposed()",
  ];
  for (const sig of FN_SIGS) {
    assert.ok(SQL_CODE.includes(
      `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated, service_role`),
      `${sig}: fresh-create ต้อง REVOKE รวม service_role`);
  }
  // ห้ามเหลือ REVOKE รูปเดิมที่ตกหล่น service_role
  assert.doesNotMatch(SQL_CODE, /REVOKE ALL ON (TABLE )?public\._staging_b13a_[a-z]+ FROM PUBLIC, anon, authenticated'/,
    "ห้ามเหลือ table REVOKE ที่จบแค่ authenticated (ตกหล่น service_role)");
  assert.doesNotMatch(SQL_CODE, /REVOKE ALL ON FUNCTION public\.b13a_[a-z_]+\([^)]*\) FROM PUBLIC, anon'/,
    "ห้ามเหลือ function REVOKE ที่จบแค่ anon (ตกหล่น authenticated/service_role)");
});

test("G47. fresh-create ACL postcondition ตรง reuse allowlist + อยู่หลัง REVOKE/GRANT", () => {
  for (const tag of [...S0_TABLE_BLOCKS, ...S0_FN_BLOCKS]) {
    const b = block(tag);
    assert.match(b, /\[B13A-ACL-POST\]/, `${tag}: ต้องมี fresh-create postcondition marker`);
    assert.match(b, /postcondition:[^']*rollback ทั้ง block/,
      `${tag}: postcondition ไม่ผ่าน = RAISE เพื่อ rollback ทั้ง DO block`);
    const posRevoke = b.indexOf("EXECUTE 'REVOKE");
    const posPost = b.indexOf("[B13A-ACL-POST]");
    assert.ok(posRevoke > 0 && posPost > posRevoke,
      `${tag}: postcondition ต้องอยู่ "หลัง" REVOKE/GRANT (ตรวจของจริงหลังเปลี่ยน ACL)`);
    // หมายเหตุ: ห้ามใช้ indexOf("created") ตรง ๆ — column created_at อยู่ก่อนใน CREATE TABLE
    const mNotice = /RAISE NOTICE '[^']*created[^']*'/.exec(b);
    assert.ok(mNotice, `${tag}: ต้องมี RAISE NOTICE ... created`);
    assert.ok(mNotice.index > posPost,
      `${tag}: postcondition ต้องอยู่ก่อน RAISE NOTICE ... created`);
  }
  // ตาราง: allowlist เดียวกับ reuse path (owner + authenticated SELECT / owner-only สำหรับ results)
  for (const tag of S0_TABLE_BLOCKS) {
    const b = block(tag);
    assert.match(b, /aclexplode\(coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/,
      `${tag}: postcondition ต้องคลี่ relacl (allowlist ไม่ใช่ blacklist)`);
    assert.match(b, /postcondition:[^']*WITH GRANT OPTION/, `${tag}: postcondition ต้องตรวจ is_grantable`);
    assert.match(b, /postcondition:[^']*owner ไม่ใช่ trusted role/, `${tag}: postcondition ต้องตรวจ owner trusted`);
  }
  assert.match(block("b13a_s0_results"), /AND a\.grantee <> c\.relowner;/,
    "results postcondition allowlist = owner เท่านั้น");
  for (const tag of ["b13a_s0_runs", "b13a_s0_evidence"]) {
    assert.match(block(tag), /ขาด SELECT grant ของ authenticated/,
      `${tag}: postcondition ต้อง assert ว่า authenticated ยังมี SELECT`);
  }
  for (const tag of ["b13a_s0_fn_browser", "b13a_s0_fn_exposed"]) {
    assert.match(block(tag), /ขาด EXECUTE grant ของ authenticated/,
      `${tag}: postcondition ต้อง assert ว่า authenticated ยังมี EXECUTE`);
  }
});

test("G48. service_role/authenticated existence precondition ทุก S0 block + recovery", () => {
  for (const tag of [...S0_TABLE_BLOCKS, ...S0_FN_BLOCKS, "b13a_s0_acl_recovery"]) {
    const b = block(tag);
    assert.match(b, /\[B13A-ROLE-PRECOND\]/, `${tag}: ต้องมี role precondition marker`);
    assert.match(b, /IF to_regrole\('service_role'\) IS NULL THEN/,
      `${tag}: ต้อง assert ว่า role มีจริงก่อนอ้าง (กัน raw SQL error)`);
    const posPre = b.indexOf("IF to_regrole('service_role') IS NULL THEN");
    const posUse = b.indexOf("EXECUTE 'REVOKE");
    assert.ok(posUse < 0 || posPre < posUse, `${tag}: precondition ต้องมาก่อน REVOKE`);
  }
  assert.match(RECOVERY, /to_regrole\('authenticated'\) IS NULL OR to_regrole\('anon'\) IS NULL/,
    "recovery ต้อง assert authenticated/anon มีจริง (กัน NULL comparison กลืน grantee แปลกปลอม)");
});

test("G49-G50. recovery block: ผูกเข้า G3 units + ตำแหน่ง/tag/interlock มาก่อน introspection", () => {
  // ต้อง slice เฉพาะ units array ของ G3 — assert กับทั้งไฟล์เป็น false positive
  // เพราะ string ที่ค้นหาจะปรากฏใน assertion ของตัวเองด้วย
  const uStart = SELF.indexOf("const units = [");
  assert.ok(uStart > 0, "ต้องหา units array ของ G3 เจอ");
  const unitsSrc = SELF.slice(uStart, SELF.indexOf("];", uStart));
  assert.ok(unitsSrc.includes("b13a_s0_acl_recovery"),
    "recovery block ต้องถูกผูกเข้า units array ของ G3 โดยตรง (ห้ามพึ่ง guard แยกอย่างเดียว)");
  assert.ok(unitsSrc.includes("b13a_s0_runs") && unitsSrc.includes("b13a_seed"),
    "units array ต้องยังครอบ mutation unit เดิมครบ");
  assert.ok(SQL.includes("DO $b13a_s0_acl_recovery$"), "dollar tag ต้องเป็น b13a_s0_acl_recovery");
  assert.ok(SQL.includes("END $b13a_s0_acl_recovery$;"), "ต้องปิด block ด้วย tag เดิม");
  assert.doesNotMatch(SQL, /DO \$b13a-s0-acl-recovery\$/, "ห้ามใช้ขีดใน dollar tag");
  const posR0 = SQL.indexOf("-- R0 — read-only environment check");
  const posRec = SQL.indexOf("DO $b13a_s0_acl_recovery$");
  const posS01 = SQL.indexOf("DO $b13a_s0_runs$");
  assert.ok(posR0 > 0 && posRec > posR0 && posS01 > posRec,
    "recovery ต้องอยู่หลัง R0 และก่อน S0.1");
  // interlock เป็นสิ่งแรกก่อน introspection ทุกชนิด
  const posIl = RECOVERY.indexOf("_staging_b13a_sentinel");
  for (const probe of ["to_regclass('public._staging_b13a_runs')", "to_regprocedure(",
                       "aclexplode(", "EXECUTE 'REVOKE"]) {
    const p = RECOVERY.indexOf(probe);
    assert.ok(p < 0 || posIl < p, `recovery: interlock ต้องมาก่อน ${probe}`);
  }
});

test("G51. tri-state ครบ NO-OP/REPAIR/STOP + NO-OP ไม่มี mutation + ห้าม fallback", () => {
  assert.match(RECOVERY, /RAISE NOTICE 'B13A S0 ACL RECOVERY NO-OP/, "ต้องมี NOTICE NO-OP");
  assert.match(RECOVERY, /RAISE NOTICE 'B13A S0 ACL RECOVERY PASS/, "ต้องมี NOTICE PASS");
  assert.match(REC_STOP, /RAISE EXCEPTION 'B13A RECOVERY STOP:/, "STATE 3 ต้อง RAISE EXCEPTION");
  // NO-OP: ห้ามมี mutation ทุกชนิด
  for (const bad of ["EXECUTE 'REVOKE", "EXECUTE 'GRANT", "EXECUTE 'CREATE", "EXECUTE 'ALTER",
                     "EXECUTE 'DROP", "INSERT INTO", "UPDATE public.", "DELETE FROM"]) {
    assert.ok(!REC_NOOP.includes(bad), `NO-OP branch ห้ามมี mutation: ${bad}`);
  }
  // เงื่อนไขเข้า NO-OP / REPAIR ต้อง explicit ไม่ใช่ else-fallback
  assert.match(RECOVERY, /IF v_have_tbl = 0 AND v_have_fn = 0 THEN/, "NO-OP = ไม่มี object เลยเท่านั้น");
  assert.match(RECOVERY, /ELSIF v_have_tbl = 3 AND v_have_fn = 1 THEN/, "REPAIR = ครบ 4 objects เท่านั้น");
  assert.match(REC_STOP, /partial state ไม่ตรง interrupted evidence/, "state อื่น = STOP พร้อมเหตุผล");
});

test("G52. canonical residue absence proof ตรง PREFLIGHT ทั้งสี่ predicate", () => {
  const pre = block("b13a_preflight");
  const need = [
    /FROM public\.service_jobs WHERE job_no LIKE 'B13ATEST-%'/,
    /FROM public\.journal_entries WHERE doc_no LIKE 'B13ATEST-%'/,
    /FROM public\.service_payments\)/,
    /FROM public\.service_payment_reversals\)/,
  ];
  for (const re of need) assert.match(pre, re, `PREFLIGHT ต้องมี predicate ${re}`);
  // recovery พิสูจน์ residue สองครั้ง (precheck ก่อน tri-state + post-check หลัง REVOKE) —
  // ต้องครบทั้งสี่ predicate "ทั้งสองครั้ง" มิฉะนั้นถอดฝั่งเดียวแล้ว guard ยังเขียว
  const residueStmts = RECOVERY.split("INTO v_residue;").slice(0, -1)
    .map((chunk) => chunk.slice(chunk.lastIndexOf("SELECT (SELECT count(*)")));
  assert.equal(residueStmts.length, 2,
    `recovery ต้องพิสูจน์ residue 2 ครั้ง (precheck + post-check) — พบ ${residueStmts.length}`);
  residueStmts.forEach((stmt, i) => {
    for (const re of need) {
      assert.match(stmt, re, `recovery residue proof #${i + 1} ต้องมี predicate เดียวกับ PREFLIGHT: ${re}`);
    }
  });
  // exact job lookup อย่างเดียวไม่พอ — ต้องเห็น orphan JE 'B13ATEST-JV1' ด้วย
  assert.match(RECOVERY, /B13a residue/, "recovery ต้องมี residue absence proof ที่ตั้งชื่อชัด");
  assert.ok(SQL.includes("'B13ATEST-JV1'"), "SEED ยังต้องสร้าง recognition JE ชื่อ B13ATEST-JV1");
  assert.match(REC_POST, /post-check: พบ business residue/, "post-check ต้องยืนยัน residue ยัง 0");
});

test("G53. schema-object inventory: starts_with + relkind filter + allowlist", () => {
  assert.match(RECOVERY, /starts_with\(c\.relname, '_staging_b13a'\)/,
    "relation scan ต้องใช้ starts_with (ห้าม LIKE ที่ _ เป็น wildcard)");
  assert.match(RECOVERY, /starts_with\(p\.proname, 'b13a_'\)/,
    "function scan ต้องใช้ starts_with");
  assert.doesNotMatch(RECOVERY, /LIKE '_staging_b13a/, "ห้ามใช้ LIKE ที่ _ เป็น wildcard กับ prefix scan");
  assert.doesNotMatch(RECOVERY, /LIKE 'b13a_/, "ห้ามใช้ LIKE ที่ _ เป็น wildcard กับ function prefix");
  assert.match(RECOVERY, /c\.relkind IN \('r','p','v','m','f'\)/,
    "relation scan ต้องกรอง relkind (กัน index/PK เป็น false positive)");
  assert.match(RECOVERY, /relation นอก allowlist ใต้ B13a prefix/, "relation แปลกปลอม = STOP");
  assert.match(RECOVERY, /function นอก allowlist ใต้ B13a prefix/, "function แปลกปลอม = STOP");
  assert.match(RECOVERY, /ARRAY\['_staging_b13a_sentinel'\] \|\| c_tbls/,
    "relation allowlist = sentinel + 3 target tables");
  assert.match(RECOVERY, /p\.proname <> 'b13a_owner_bootstrap'/, "function allowlist = bootstrap เท่านั้น");
});

test("G54. REPAIR table checks = identity-critical เท่านั้น (ห้าม duplicate full schema contract)", () => {
  assert.ok(REC_MUT_IDX > 0 && REC_PRE.length > 0 && REC_POST.length > 0,
    "REPAIR ต้องแยกเป็น precheck / mutation / post-check ได้");
  // precheck (ก่อน REVOKE) ต้องครบ — assert บนฝั่ง PRE โดยเฉพาะ ไม่ใช่ทั้ง branch
  for (const need of [/relkind = 'r'\) AND \(r\.rolsuper OR r\.rolbypassrls\)/,
                      /EXECUTE format\('SELECT count\(\*\) FROM public\.%I', v_tbl\) INTO v_rows/,
                      /a\.is_grantable/,
                      /grantee นอก allowlist/,
                      /authenticated privilege นอก contract/,
                      /มี grant WITH GRANT OPTION % รายการ — ห้าม repair/]) {
    assert.match(REC_PRE, need, `REPAIR precheck ต้องตรวจ identity-critical: ${need}`);
  }
  // is_grantable ต้องถูกตรวจทั้ง 4 จุด (table/bootstrap × precheck/post-check)
  assert.ok((REC_REPAIR.match(/a\.is_grantable/g) || []).length >= 4,
    "is_grantable ต้องถูกตรวจทั้ง table+bootstrap ทั้งก่อนและหลัง REVOKE");
  // ห้าม duplicate full schema contract ของ S0.1–S0.3 เข้ามาใน recovery
  for (const dup of [/information_schema\.columns/, /pg_get_constraintdef/, /pg_policies/,
                     /indisprimary/, /column_default/]) {
    assert.doesNotMatch(RECOVERY, dup,
      `recovery ห้าม duplicate full table contract (${dup}) — ให้ S0.1–S0.3 reuse ตรวจหลัง recovery`);
  }
  assert.match(RB, /full schema\/PK\/CHECK\/policy contract พิสูจน์ด้วย `S0\.1`–`S0\.4` reuse หลัง recovery/,
    "runbook ต้องบอกว่า full contract พิสูจน์ที่ rerun");
});

test("G55. service_role surplus = non-empty subset ของชุดที่อนุญาต (ไม่บังคับครบ 8)", () => {
  assert.match(RECOVERY,
    /c_privs CONSTANT text\[\] := ARRAY\['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'\]/,
    "ชุด privilege ที่อนุญาตต้องตรง observed state");
  assert.match(REC_REPAIR, /NOT \(a\.privilege_type = ANY \(c_privs\)\)/, "privilege นอกชุด = ต้องจับได้");
  assert.match(REC_REPAIR, /มี privilege นอกชุดที่อนุญาต \(%\)/, "ต้องรายงานชื่อ privilege ที่พบ");
  assert.match(REC_REPAIR, /IF v_cnt < 1 THEN/, "surplus ต้อง non-empty (มีของให้ซ่อมจริง)");
  assert.doesNotMatch(REC_REPAIR, /v_cnt <> 8|v_cnt = 8/,
    "ห้ามบังคับว่าต้องครบ 8 (MAINTAIN ขึ้นกับ PostgreSQL version)");
});

test("G56-G57. mutation = exact REVOKE 4 objects + post-check ACL ครบ", () => {
  const muts = (REC_REPAIR.match(/EXECUTE '(REVOKE|GRANT|CREATE|ALTER|DROP|TRUNCATE)[^']*'/g) || []);
  assert.equal(muts.length, 4, `REPAIR ต้องมี mutation 4 ตัวเป๊ะ (พบ ${muts.length})`);
  for (const m of muts) assert.match(m, /^EXECUTE 'REVOKE ALL ON /, `mutation ต้องเป็น REVOKE เท่านั้น: ${m}`);
  for (const obj of ["public._staging_b13a_runs", "public._staging_b13a_results",
                     "public._staging_b13a_evidence", "FUNCTION public.b13a_owner_bootstrap(uuid)"]) {
    assert.ok(REC_REPAIR.includes(`REVOKE ALL ON ${obj} FROM service_role`),
      `ต้อง REVOKE object เป๊ะ: ${obj}`);
  }
  for (const bad of ["INSERT INTO", "UPDATE public.", "DELETE FROM", "ALTER DEFAULT PRIVILEGES",
                     "ALTER TABLE", "CREATE ", "DROP "]) {
    assert.ok(!REC_REPAIR.includes(bad), `REPAIR ห้ามมี ${bad}`);
  }
  // post-check ต้องอยู่ "หลัง" REVOKE และ assert บนฝั่ง POST โดยเฉพาะ
  assert.ok(REC_POST.indexOf("RECOVERY post-check") > 0, "post-check ต้องอยู่หลัง REVOKE");
  for (const need of [/ยังเหลือ surplus % รายการ หลัง REVOKE/, /มี PUBLIC\/anon privilege/,
                      /ACL ไม่ตรง reuse contract/, /ขาด authenticated SELECT ตาม contract/,
                      /มี grant option % รายการ/, /owner ไม่ใช่ trusted role/,
                      /bootstrap ยังมี grantee นอก owner/, /a\.is_grantable/,
                      /มี % แถว หลัง recovery \(ต้องคง 0\)/]) {
    assert.match(REC_POST, need, `post-check ต้องครอบ: ${need}`);
  }
  assert.match(REC_POST, /rollback ทั้ง block/, "post-check ล้ม = rollback ทั้ง DO statement");
});

test("G58-G59. bootstrap INVOKER + marker + metadata · security modes ครบทั้งสี่", () => {
  assert.match(REC_REPAIR, /IF v_secdef THEN\s*\n\s*RAISE EXCEPTION 'B13A RECOVERY STOP: bootstrap ต้องเป็น SECURITY INVOKER/,
    "recovery ต้องบังคับ bootstrap = SECURITY INVOKER");
  assert.match(REC_REPAIR, /position\('B13A-FN-BOOTSTRAP-V1' IN coalesce\(v_prosrc, ''\)\) = 0/,
    "recovery ต้องตรวจ canonical marker ใน prosrc");
  for (const need of [/proconfig ไม่ตรง canonical/, /language ไม่ตรง canonical/,
                      /owner ไม่ใช่ trusted role/, /attributes ไม่ตรง canonical/]) {
    assert.match(REC_REPAIR, need, `recovery ต้องตรวจ bootstrap metadata: ${need}`);
  }
  assert.match(RECOVERY, /b13a_owner_bootstrap มี % signature/, "recovery ต้องกัน overload");
  // security mode ของทั้งสี่ function ต้องล็อกไว้ใน S0 blocks (INVOKER x3 · DEFINER x1)
  assert.match(block("b13a_s0_fn_bootstrap"), /ต้องเป็น SECURITY INVOKER \(prosecdef=false\)/, "bootstrap = INVOKER");
  assert.match(block("b13a_s0_fn_finalize"), /ต้องเป็น SECURITY INVOKER \(prosecdef=false\)/, "finalize = INVOKER");
  assert.match(block("b13a_s0_fn_exposed"), /ต้องเป็น SECURITY INVOKER \(prosecdef=false\)/, "rpc_exposed = INVOKER");
  assert.match(block("b13a_s0_fn_browser"), /ต้องเป็น SECURITY DEFINER \(prosecdef=true\)/, "browser = DEFINER");
});

test("G60-G61. canonical MD5 cross-check + ห้าม $fn_bootstrap$ ก่อน S0.4", () => {
  const expected = crypto.createHash("md5").update(FN_BOOTSTRAP, "utf8").digest("hex");
  const m = RECOVERY.match(/c_md5 CONSTANT text := '([0-9a-f]{32})'/);
  assert.ok(m, "recovery ต้องฝัง canonical MD5 constant");
  assert.equal(m[1], expected,
    `MD5 ใน recovery (${m ? m[1] : "-"}) ต้องตรง canonical $fn_bootstrap$ body (${expected})`);
  assert.match(REC_REPAIR, /v_md5 := md5\(v_prosrc\);/, "recovery ต้องคำนวณ md5(prosrc) จริง");
  assert.match(REC_REPAIR, /v_md5 IS DISTINCT FROM c_md5/, "ต้องเทียบกับ canonical constant");
  assert.match(REC_REPAIR, /expected=% actual=%/, "hash ไม่ตรงต้องรายงาน expected/actual");
  assert.match(REC_REPAIR, /ห้ามแก้ prosrc บน scratch/, "hash ไม่ตรง = ห้าม manual workaround");
  // recovery ห้าม duplicate body / ห้ามมี tag ก่อน canonical S0.4
  const idxS04 = SQL.indexOf("DO $b13a_s0_fn_bootstrap$");
  assert.ok(idxS04 > 0, "ต้องหาตำแหน่ง S0.4 ได้");
  assert.equal((SQL.slice(0, idxS04).match(/\$fn_bootstrap\$/g) || []).length, 0,
    "ห้ามมี literal $fn_bootstrap$ ก่อน S0.4 (จะทำให้ extractor slice ผิดช่วง = MD5 หลอกตา)");
  assert.ok(!RECOVERY.includes("$fn_bootstrap$"), "recovery ห้าม duplicate bootstrap body/tag");
});

test("G62. S0.5–S0.7 absence + zero rows + retained-run message เฉพาะทาง", () => {
  for (const sig of ["public.b13a_browser_transition(", "public.b13a_owner_finalize(",
                     "public.b13a_rpc_exposed()"]) {
    assert.ok(RECOVERY.includes(`to_regprocedure('${sig}`),
      `recovery ต้องตรวจว่า ${sig} ยังไม่มี`);
  }
  assert.match(RECOVERY, /พบ S0\.5-S0\.7 function แล้ว/, "มี S0.5–S0.7 = STOP");
  assert.match(REC_REPAIR, /มี % แถว \(ต้อง 0\)/, "ตารางต้อง zero rows ก่อน repair");
  assert.match(RECOVERY,
    /retained B13a run detected — ห้ามลบหรือ takeover; ต้องใช้ owner-authorized recovery phase แยกหลัง reviewer approval/,
    "retained run ต้องใช้ข้อความเฉพาะทาง");
});

test("G63-G64. sentinel refresh อยู่ใน runbook เท่านั้น + self-gate + atomic DO", () => {
  const b4 = rbSection("### B4.3 Atomic sentinel refresh", "### B4.4");
  assert.match(b4, /DO \$b13a_sentinel_refresh\$/, "refresh ต้องเป็น DO block เดียว");
  assert.match(b4, /END\s*\n\$b13a_sentinel_refresh\$;/, "ต้องปิด DO block ด้วย tag เดิม");
  assert.doesNotMatch(b4, /^BEGIN;/m, "ห้ามใช้ BEGIN;/COMMIT; ครอบหลาย statement");
  assert.doesNotMatch(b4, /^COMMIT;/m, "ห้ามใช้ BEGIN;/COMMIT; ครอบหลาย statement");
  // B12 self-gate + DELETE + INSERT + internal post-check อยู่ใน DO เดียวกัน
  const doBlock = b4.slice(b4.indexOf("DO $b13a_sentinel_refresh$"),
                           b4.indexOf("$b13a_sentinel_refresh$;") + 24);
  for (const need of [/_staging_b12_results/, /bool_and\(ok\)/,
                      /job_no LIKE 'B12TEST-%'/, /doc_no LIKE 'B12TEST-%'/,
                      /FROM public\.journal_lines/,
                      /chart_of_accounts/, /account_mapping/,
                      /DELETE FROM public\._staging_b13a_sentinel;/,
                      /INSERT INTO public\._staging_b13a_sentinel/,
                      /post-check ไม่ผ่าน/]) {
    assert.match(doBlock, need, `sentinel refresh DO ต้องมี: ${need}`);
  }
  const posGate = doBlock.indexOf("_staging_b12_results");
  const posDel = doBlock.indexOf("DELETE FROM public._staging_b13a_sentinel");
  const posPost = doBlock.indexOf("post-check ไม่ผ่าน");
  assert.ok(posGate > 0 && posGate < posDel && posDel < posPost,
    "ลำดับต้องเป็น B12 self-gate → DELETE/INSERT → internal post-check ในบล็อกเดียว");
  assert.match(b4, /ห้าม INSERT มือเปล่า/, "ห้าม owner INSERT มือเปล่า");
  assert.match(b4, /owner-typed literal/, "confirm_text ต้อง owner พิมพ์เอง ห้าม generate");
  // package SQL ห้ามสร้าง/refresh/hardcode sentinel และห้ามแตะ ACL ของ sentinel
  assert.doesNotMatch(SQL, /CREATE TABLE[^;]*_staging_b13a_sentinel/i, "SQL ห้ามสร้าง sentinel");
  assert.doesNotMatch(SQL_CODE, /'B13A-STAGING-\d{4}-\d{2}-\d{2}'/, "SQL ห้าม hardcode วันที่ sentinel");
  assert.doesNotMatch(SQL_CODE, /(DELETE FROM|INSERT INTO|UPDATE) public\._staging_b13a_sentinel/,
    "SQL ห้าม refresh sentinel เอง (runbook เท่านั้น)");
  assert.doesNotMatch(SQL_CODE, /(REVOKE|GRANT|ALTER|DROP)[^;]{0,80}_staging_b13a_sentinel/i,
    "SQL ห้ามแตะ ACL/DDL ของ sentinel (อยู่นอก scope)");
});

test("G65-G66. B11 current-active-row wording + ไม่มี helper object ใหม่", () => {
  const b11 = rbSection("## B11)", "## เกณฑ์ผ่านรวม");
  assert.match(b11, /ไม่ใช่ retained behavioral evidence/, "B11 ต้องบอกว่า sentinel ไม่ใช่ retained evidence");
  assert.match(b11, /current active row หนึ่งแถว/, "B11 ต้องระบุ current active row หนึ่งแถว");
  assert.match(b11, /atomic sentinel refresh \(B4\.3\) เท่านั้น/, "แทนที่ได้ทาง refresh เดียว");
  assert.match(b11, /ห้าม archive ด้วย schema\/table ใหม่/, "ห้าม archive ด้วย table ใหม่");
  const retLine = b11.match(/- \*\*Retained evidence ห้ามลบ\*\*:[\s\S]*?\n(?=- )/);
  assert.ok(retLine, "B11 ต้องยังมีรายการ Retained evidence ห้ามลบ");
  assert.ok(!retLine[0].includes("_staging_b13a_sentinel"),
    "sentinel ต้องไม่อยู่ในรายการ retained ห้ามลบ แบบ absolute");
  // helper policy — ไม่มี object ใหม่ใน package SQL
  const created = (SQL_CODE.match(/CREATE (TABLE|FUNCTION|VIEW|MATERIALIZED VIEW)/g) || []);
  assert.equal(created.length, 7,
    `package ต้องสร้าง object 7 ตัวเท่าเดิม (3 tables + 4 functions) — พบ ${created.length}`);
  assert.doesNotMatch(SQL_CODE, /CREATE (OR REPLACE )?(VIEW|MATERIALIZED VIEW)/, "ห้ามสร้าง view ใหม่");
});

test("G67. docs stable anchors + guard/CI ไม่ถูก claim เป็น scratch ACL proof", () => {
  const HANDOFF = fs.readFileSync(path.join(ROOT, "HANDOFF.md"), "utf8");
  const CHANGELOG = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const DBMIG = fs.readFileSync(path.join(ROOT, "DB_MIGRATIONS_APPLIED.md"), "utf8");
  const SESSION = fs.readFileSync(path.join(ROOT, "SESSION_START_SHARED.md"), "utf8");
  assert.match(DBMIG, /Staging verification runs/, "ledger ต้องมี section staging verification");
  assert.match(DBMIG, /NOT production migration/i, "ต้องประกาศว่าไม่ใช่ production migration");
  for (const [name, doc] of [["HANDOFF", HANDOFF], ["CHANGELOG", CHANGELOG],
                             ["DB_MIGRATIONS_APPLIED", DBMIG], ["SESSION_START_SHARED", SESSION]]) {
    assert.match(doc, /S0\.1[–-]S0\.4/, `${name}: ต้องระบุว่า S0.1–S0.4 รันแล้ว`);
    assert.match(doc, /S0\.5[–-]S0\.7 NOT RUN/, `${name}: ต้องระบุ S0.5–S0.7 NOT RUN`);
    assert.match(doc, /certificates NOT ISSUED/i, `${name}: ต้องระบุ certificates NOT ISSUED`);
    assert.match(doc, /604 \/ v5\.69\.72/, `${name}: build/version ต้องคง 604 / v5.69.72`);
  }
  assert.match(DBMIG, /R0/, "ledger ต้องระบุ R0");
  // guard/CI ต้องไม่ถูก claim ว่าเป็น scratch ACL proof
  for (const [name, doc] of [["HANDOFF", HANDOFF], ["CHANGELOG", CHANGELOG]]) {
    assert.match(doc, /guard\/CI[^\n]*ไม่ใช่[^\n]*(scratch )?ACL/,
      `${name}: ต้องประกาศว่า guard/CI ไม่ใช่ scratch ACL proof`);
  }
  // ห้าม transient wording — ตรวจเฉพาะ "บล็อก 606-B13a.1 ที่เขียนใหม่" เท่านั้น
  // (บันทึกประวัติเก่ามี "STOP รอ reviewer" โดยชอบธรรม และ §G ห้าม broad-rewrite historical records)
  for (const [name, doc, endAnchor] of [
    ["HANDOFF", HANDOFF, "**Phase 606-B13a package (merged"],
    ["CHANGELOG", CHANGELOG, "- `33356a4`"],
    ["SESSION_START_SHARED", SESSION, "> **2026-07-23 — Phase 606-B13a package merged"],
  ]) {
    const s = doc.indexOf("606-B13a.1");
    assert.ok(s >= 0, `${name}: ต้องมีบล็อก 606-B13a.1`);
    const e = doc.indexOf(endAnchor, s);
    assert.ok(e > s, `${name}: ต้องมี end anchor ของบล็อกก่อนหน้า (${endAnchor})`);
    const cur = doc.slice(s, e);
    for (const bad of ["รอ review", "รอ audit", "ยังไม่ merge", "PR ค้าง"]) {
      assert.ok(!cur.includes(bad), `${name}: ห้ามใส่ transient wording "${bad}" ในบล็อก 606-B13a.1`);
    }
  }
});
