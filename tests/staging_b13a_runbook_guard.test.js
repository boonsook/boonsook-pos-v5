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
    assert.match(b, /STOP ห้าม overwrite/, `${tag}: mismatch = STOP`);
    assert.doesNotMatch(b, /CREATE OR REPLACE FUNCTION/, `${tag}: ห้าม CREATE OR REPLACE (overwrite)`);
  }
  // ตาราง: reuse ต้อง exact ครบ PK/CHECK/policy/FORCE RLS/grants รวม PUBLIC
  const TBL_EXPECT = {
    b13a_s0_runs: { pk: "'singleton'", qual: "'(singleton AND (actor_id = auth.uid()))'" },
    b13a_s0_results: { pk: "'run_id,certificate'", qual: null },
    b13a_s0_evidence: { pk: "'run_id,step'", qual: "(r.actor_id = auth.uid())" },
  };
  for (const [tag, exp] of Object.entries(TBL_EXPECT)) {
    const b = block(tag);
    assert.match(b, /i\.indisprimary/, `${tag}: ต้อง introspect PK จริง`);
    assert.ok(b.includes(`IF v_pk IS DISTINCT FROM ${exp.pk}`), `${tag}: PK ต้องเทียบ exact`);
    assert.match(b, /pg_get_constraintdef/, `${tag}: ต้องตรวจ CHECK constraints ด้วย definition จริง`);
    assert.match(b, /FOREACH v_item IN ARRAY/, `${tag}: ต้องไล่สมาชิก allowlist ครบทุกตัว`);
    assert.match(b, /'PUBLIC'/, `${tag}: grants ต้องครอบ PUBLIC ด้วย`);
    assert.match(b, /relrowsecurity AND c\.relforcerowsecurity/, `${tag}: ต้องตรวจ RLS ENABLE+FORCE`);
    if (exp.qual) {
      assert.ok(b.includes(exp.qual), `${tag}: policy expression ต้องเทียบ exact`);
      assert.match(b, /regexp_replace\(coalesce\(pp\.qual, ''\)/, `${tag}: ต้องอ่าน qual จริงมาเทียบ`);
    } else {
      assert.match(b, /ต้องไม่มี policy/, `${tag}: results ต้อง assert policy = 0`);
    }
  }
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
  assert.doesNotMatch(SQL, /service_role/i, "SQL ห้ามอ้าง service_role");
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
