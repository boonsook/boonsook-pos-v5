// Phase 605 (S4.1c) — gated service NO_JV recovery guard
//
// runner นี้ "เขียนข้อมูลจริง" ได้ → guard ต้องล็อกให้แน่นกว่า S4.1b:
//   (a) preview = read-only จริง; apply ต้องครบ 2 ธง (--apply + --confirm) ไม่งั้นห้ามเขียน
//   (b) เขียนได้แค่ CAS PATCH service_jobs.closed_at (field เดียว) + JV ผ่าน canonical writer
//       (ห้าม raw insert journal_entries/journal_lines, ห้ามคิดสูตร Dr/Cr เอง, ห้ามแตะสต็อก)
//   (c) preflight/readiness: plan ต้องตรง live, owner ต้องอนุมัติวันรับรู้ (มี timezone),
//       stock decision ต้องไม่ขัดหลักฐาน, งวดต้องไม่ปิด, JE ที่มีอยู่ต้อง block
//   (d) post-write verify: JE ต้องตรง doc_date/amount/balance/mapping ก่อนนับว่าสำเร็จ
//
// ★ ห้ามมี production job id / customer data ใน fixture
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CONFIRM_TOKEN, PLAN_SCHEMA_VERSION, STOCK_DECISIONS, PLAN_JOB_STATES,
  validateRecognitionAt, parseRecoveryPlan, planBaselineMatches,
  computeRecoveryReadiness, verifyPostedJournal, buildPlanSkeleton,
  expectedJournalAccounts, classifyPlanJobState, revalidateJobSnapshot,
  computeSourceSnapshotSha256, verifySourceSnapshot, assertPublishableKey, canonicalSourceString,
} from "../scripts/service_no_jv_recover_lib.js";
import { classifyServiceNoJvCandidate } from "../scripts/service_no_jv_classify_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n");
const RUNNER = read("scripts/service_no_jv_recover.js");
const RUNNER_CODE = stripComments(RUNNER);
const LIB = read("scripts/service_no_jv_recover_lib.js");
const PKG = JSON.parse(read("package.json"));

// ── fixtures (ไม่ใช่ข้อมูล production) ──────────────────────
const MAPPING_OK = new Set(["service_repair_ac", "service_clean_ac"]);
const ACCOUNTS_OK = new Set(["1110", "1130", "4210"]);
const job = (o = {}) => ({
  id: 101, job_no: "TEST-JOB-1", job_type: "repair_ac", status: "done",
  created_at: "2026-07-08T03:00:00Z", closed_at: null,
  total_cost: 1000, payment_method: "cash", note: "", items_json: [],
  stock_deducted_at: null, stock_reverted_at: null, ...o
});
// ★ plan v2: ต้องมี sourceSnapshotSha256 ของ row ตอน owner อนุมัติ
//   `_job` = row ที่ owner เห็นตอนอนุมัติ (ใช้คำนวณ hash) — ไม่ถูกใส่ลง plan object
const planJobOf = (o = {}) => {
  const { _job, ...rest } = o;
  const src = job(_job || {});
  return {
    sourceId: String(src.id), expectedJobNo: src.job_no, expectedAmount: src.total_cost, expectedStatus: src.status,
    sourceSnapshotSha256: computeSourceSnapshotSha256(src),
    recognitionAt: "2026-07-10T17:00:00+07:00", stockDecision: STOCK_DECISIONS.NOT_REQUIRED, stockEvidenceRef: "",
    ...rest
  };
};
const planOf = (jobs = [planJobOf()], o = {}) => ({
  schemaVersion: PLAN_SCHEMA_VERSION, approvedBy: "owner", approvedAt: "2026-07-13T09:00:00+07:00",
  baseline: { months: ["2026-07"], candidateCount: jobs.length, candidateAmount: jobs.reduce((a, j) => a + j.expectedAmount, 0) },
  jobs, ...o
});
const classifyOf = (j = job(), extra = {}) => classifyServiceNoJvCandidate({
  job: j, entries: [], linesByEntry: new Map(), validMappingKeys: MAPPING_OK, ...extra
});
const ready = (over = {}) => computeRecoveryReadiness({
  classified: classifyOf(over.job || job()), planJob: over.planJob || planJobOf(), job: over.job || job(),
  lockedPeriods: over.lockedPeriods || new Set()
});

// ═══ 1-2. mode gates (source) ══════════════════════════════
test("1. preview mode: REST เป็น GET เท่านั้น · POST เฉพาะ login · write ทุกจุดอยู่หลัง APPLY gate", () => {
  const getFn = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function getAllChecked"), RUNNER_CODE.indexOf("async function getAll(token"));
  assert.match(getFn, /await fetch\(url, \{ method: "GET"/, "REST อ่านต้องเป็น GET");
  const signIn = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function signIn"), RUNNER_CODE.indexOf("const authH"));
  assert.match(signIn, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(signIn, /method:\s*"POST"/);
  assert.ok(!/method:\s*"POST"/.test(RUNNER_CODE.replace(signIn, "")), "POST ต้องมีจุดเดียว = login");
  // PATCH มีได้จุดเดียว = casSetClosedAt และต้องมี APPLY guard ในตัว
  const patches = [...RUNNER_CODE.matchAll(/method:\s*"PATCH"/g)];
  assert.equal(patches.length, 1, "PATCH ต้องมีจุดเดียว");
  const cas = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function casSetClosedAt"), RUNNER_CODE.indexOf("async function loadCanonicalWriter"));
  assert.match(cas, /if \(!APPLY\) throw new Error/, "CAS ต้อง assert APPLY gate ในตัวเอง");
  assert.ok(!/method:\s*"(PUT|DELETE)"/.test(RUNNER_CODE), "ห้าม PUT/DELETE");
  assert.ok(!/\/rest\/v1\/rpc\//.test(RUNNER_CODE), "ห้ามเรียก RPC");
});

test("2. --apply ขาด --confirm → APPLY=false (ไม่มี write) และ token ต้องตรงค่าเดียว", () => {
  assert.match(RUNNER_CODE, /const APPLY = APPLY_FLAG && CONFIRM === R\.CONFIRM_TOKEN/, "APPLY ต้องต้องการทั้ง 2 ธง");
  assert.equal(CONFIRM_TOKEN, "SERVICE-NO-JV-S4.1C");
  // ทุก write ต้องอยู่ใต้ APPLY
  const applyBlock = RUNNER_CODE.slice(RUNNER_CODE.indexOf("  if (!APPLY) {"), RUNNER_CODE.indexOf("main().then"));
  assert.match(applyBlock, /if \(!preflightOk\)[\s\S]{0,200}return 1/, "preflight ไม่ผ่าน → exit 1 โดยไม่เขียน");
});

// ═══ 3. baseline drift (resume-aware) ══════════════════════
const stateMap = (o) => new Map(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? { state: v, problems: [] } : v]));

test("3. baseline: count/amount = verified+pending · งาน NO_JV ใหม่นอก plan → block · CONFLICT → block", () => {
  const plan = planOf();
  // ตรงกัน (1 งาน pending)
  assert.equal(planBaselineMatches({ plan, planStates: stateMap({ "101": PLAN_JOB_STATES.PENDING_RECOVERY }), liveCandidateIds: ["101"] }).ok, true);
  // count ไม่ตรง
  const two = planOf([planJobOf(), planJobOf({ _job: { id: 102, job_no: "TEST-JOB-2" } })], { baseline: { months: ["2026-07"], candidateCount: 1, candidateAmount: 1000 } });
  const bad = planBaselineMatches({ plan: two, planStates: stateMap({ "101": PLAN_JOB_STATES.PENDING_RECOVERY, "102": PLAN_JOB_STATES.PENDING_RECOVERY }), liveCandidateIds: ["101", "102"] });
  assert.ok(bad.errors.some(e => /BASELINE_DRIFT: count/.test(e)));
  // งาน NO_JV ใหม่ที่ไม่อยู่ใน plan → block
  const newJob = planBaselineMatches({ plan, planStates: stateMap({ "101": PLAN_JOB_STATES.PENDING_RECOVERY }), liveCandidateIds: ["101", "777"] });
  assert.equal(newJob.ok, false);
  assert.ok(newJob.errors.some(e => /งาน NO_JV ใหม่ที่ไม่อยู่ใน plan/.test(e)));
  // CONFLICT ใน plan → block
  const conflict = planBaselineMatches({ plan, planStates: stateMap({ "101": { state: PLAN_JOB_STATES.CONFLICT, problems: ["JE_AMOUNT_MISMATCH"] } }), liveCandidateIds: [] });
  assert.equal(conflict.ok, false);
  assert.ok(conflict.errors.some(e => /PLAN_JOB_CONFLICT/.test(e)));
});

// ═══ 4-7. closed_at CAS / resume / conflict ════════════════
test("4. closed_at null + plan ถูกต้อง → พร้อม (FRESH) และ docDate = Bangkok date ของ recognitionAt", () => {
  const rr = ready();
  assert.equal(rr.ok, true, rr.blockers.join(","));
  assert.equal(rr.resumeState, "FRESH");
  assert.equal(rr.docDate, "2026-07-10");   // 17:00+07:00 → 10 ก.ค. เวลาไทย
});

test("5. closed_at ตรง plan อยู่แล้ว → RESUME (ไม่ PATCH ซ้ำ)", () => {
  const j = job({ closed_at: "2026-07-10T10:00:00Z" });   // = 17:00+07:00
  const rr = computeRecoveryReadiness({ classified: classifyOf(j), planJob: planJobOf(), job: j });
  assert.equal(rr.ok, true, rr.blockers.join(","));
  assert.equal(rr.resumeState, "RESUME");
  const runnerApply = RUNNER_CODE.slice(RUNNER_CODE.indexOf('if (rr.resumeState === "FRESH")'), RUNNER_CODE.indexOf("// B) canonical writer"));
  assert.match(runnerApply, /casSetClosedAt/, "FRESH เท่านั้นที่ PATCH");
  assert.match(RUNNER_CODE, /resume \(ไม่ PATCH ซ้ำ\)/);
});

test("6. closed_at เป็นค่าอื่น → CLOSED_AT_CONFLICT (ห้ามทับ)", () => {
  const j = job({ closed_at: "2026-07-01T00:00:00Z" });
  const rr = computeRecoveryReadiness({ classified: classifyOf(j), planJob: planJobOf(), job: j });
  assert.equal(rr.ok, false);
  assert.ok(rr.blockers.includes("CLOSED_AT_CONFLICT"));
});

test("7. status/total เปลี่ยนจาก plan → block; และ CAS filter ต้องผูก id+closed_at null+status+total", () => {
  assert.ok(ready({ job: job({ status: "closed" }) }).blockers.includes("PLAN_STATUS_MISMATCH"));
  assert.ok(ready({ job: job({ total_cost: 1200 }) }).blockers.includes("PLAN_AMOUNT_MISMATCH"));
  const cas = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function casSetClosedAt"), RUNNER_CODE.indexOf("async function loadCanonicalWriter"));
  assert.match(cas, /id=eq\./);
  assert.match(cas, /closed_at=is\.null/);
  assert.match(cas, /status=eq\./);
  assert.match(cas, /total_cost=eq\./);
  assert.match(cas, /Prefer: "return=representation"/);
  assert.match(cas, /body: JSON\.stringify\(\{ closed_at: recognitionIso \}\)/, "PATCH ต้องเขียน closed_at อย่างเดียว");
  // ห้าม PATCH field อื่น
  for (const f of ["status:", "total_cost:", "payment_method:", "note:", "items_json:", "stock_deducted_at:", "stock_reverted_at:"]) {
    assert.ok(!new RegExp(`JSON\\.stringify\\(\\{[^}]*${f}`).test(cas), `PATCH ต้องไม่แตะ ${f}`);
  }
  const casFail = RUNNER_CODE.slice(RUNNER_CODE.indexOf("if (!cas.won)"), RUNNER_CODE.indexOf("const fullJob"));
  assert.match(casFail, /return 2/, "CAS แพ้ → exit 2");
  assert.ok(!/postJournalForServiceJob/.test(casFail), "CAS แพ้ → ต้องไม่โพสต์ JV (return ก่อนถึง writer)");
});

// ═══ 8-11. preflight blockers ══════════════════════════════
test("8. period locked → block ก่อน write", () => {
  const rr = ready({ lockedPeriods: new Set(["2026-07"]) });
  assert.equal(rr.ok, false);
  assert.ok(rr.blockers.includes("PERIOD_LOCKED"));
  assert.match(RUNNER_CODE, /accounting_periods\?select=year,month,status/, "runner ต้องอ่าน accounting_periods");
});

test("9. มี JE ผูก source (approved/non-approved/duplicate) → block", () => {
  const je = (o = {}) => ({ id: 900, source_table: "service_jobs", source_id: 101, status: "approved", doc_date: "2026-07-10", total_debit: 1000, ...o });
  const lines = new Map([["900", [{ account_code: "4210", debit: 0, credit: 1000 }, { account_code: "1110", debit: 1000, credit: 0 }]]]);
  const approved = computeRecoveryReadiness({ classified: classifyOf(job(), { entries: [je()], linesByEntry: lines }), planJob: planJobOf(), job: job() });
  assert.equal(approved.ok, false);
  assert.ok(approved.blockers.some(b => b.startsWith("JOURNAL_VERDICT_APPROVED_JV_PRESENT")));
  const draft = computeRecoveryReadiness({ classified: classifyOf(job(), { entries: [je({ status: "draft" })] }), planJob: planJobOf(), job: job() });
  assert.ok(draft.blockers.some(b => b.includes("SOURCE_BOUND_NON_APPROVED")));
  const dup = computeRecoveryReadiness({ classified: classifyOf(job(), { entries: [je(), je({ id: 901 })], linesByEntry: lines }), planJob: planJobOf(), job: job() });
  assert.ok(dup.blockers.some(b => b.includes("DUPLICATE_SOURCE_JV")));
});

test("10. mapping หาย / งานถูกลบ-ยกเลิก / amount null-zero → block", () => {
  const noMap = computeRecoveryReadiness({
    classified: classifyServiceNoJvCandidate({ job: job(), entries: [], validMappingKeys: new Set() }),
    planJob: planJobOf(), job: job()
  });
  assert.ok(noMap.blockers.includes("CURRENT_MAPPING_MISSING"));
  const cancelled = job({ status: "cancelled" });
  const c1 = computeRecoveryReadiness({ classified: classifyOf(cancelled), planJob: planJobOf({ expectedStatus: "done" }), job: cancelled });
  assert.equal(c1.ok, false);
  const deleted = job({ note: "[ลบแล้ว]" });
  const c2 = computeRecoveryReadiness({ classified: classifyOf(deleted), planJob: planJobOf(), job: deleted });
  assert.ok(c2.blockers.some(b => b.includes("DELETED_OR_CANCELLED")));
  const nullAmt = job({ total_cost: null });
  const c3 = computeRecoveryReadiness({ classified: classifyOf(nullAmt), planJob: planJobOf(), job: nullAmt });
  assert.ok(c3.blockers.includes("AMOUNT_TOO_SMALL_OR_INVALID"));
  const zero = job({ total_cost: 0 });
  const c4 = computeRecoveryReadiness({ classified: classifyOf(zero), planJob: planJobOf({ expectedAmount: 0 }), job: zero });
  assert.equal(c4.ok, false);
  // plan ที่ระบุ amount < 0.01 ต้องถูก parse ปฏิเสธตั้งแต่ต้น
  assert.ok(parseRecoveryPlan(planOf([planJobOf({ expectedAmount: 0 })])).errors.some(e => /EXPECTED_AMOUNT_INVALID/.test(e)));
});

test("11. recognitionAt ต้องมี timezone + owner approval ต้องครบ (ไม่งั้น block)", () => {
  assert.equal(validateRecognitionAt("2026-07-10T17:00:00").ok, false);           // ไม่มี tz
  assert.equal(validateRecognitionAt("2026-07-10").ok, false);                     // date เปล่า
  assert.equal(validateRecognitionAt("").ok, false);
  assert.equal(validateRecognitionAt(null).ok, false);
  assert.equal(validateRecognitionAt("2026-07-10T17:00:00+07:00").ok, true);
  assert.equal(validateRecognitionAt("2026-07-10T10:00:00Z").docDate, "2026-07-10");
  const rr = ready({ planJob: planJobOf({ recognitionAt: "2026-07-10T17:00:00" }) });
  assert.ok(rr.blockers.includes("RECOGNITION_AT_NO_TIMEZONE"));
  // plan ขาด approvedBy/approvedAt → invalid
  assert.ok(parseRecoveryPlan(planOf(undefined, { approvedBy: "" })).errors.includes("PLAN_APPROVED_BY_MISSING"));
  assert.ok(parseRecoveryPlan(planOf(undefined, { approvedAt: "2026-07-13" })).errors.some(e => /PLAN_APPROVED_AT_INVALID/.test(e)));
  assert.ok(parseRecoveryPlan({ ...planOf(), schemaVersion: 1 }).errors.some(e => /SCHEMA_VERSION_MISMATCH/.test(e)));  // v1 (ไม่มี snapshot hash) ต้องถูกปฏิเสธ
});

// ═══ 12-15. stock decision ═════════════════════════════════
test("12. STOCK_NOT_REQUIRED (หลักฐานตรง) → รับ NOT_REQUIRED ได้", () => {
  const rr = ready();
  assert.equal(classifyOf().stock.verdict, "STOCK_NOT_REQUIRED");
  assert.equal(rr.ok, true);
});

test("13. NOT_REQUIRED ปลอม (หลักฐานสต็อกยังไม่ resolve) → block", () => {
  const j = job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }] });
  const cls = classifyServiceNoJvCandidate({ job: j, entries: [], validMappingKeys: MAPPING_OK, productMap: new Map([["5", { id: 5, product_type: "stock" }]]), movements: [] });
  assert.equal(cls.stock.verdict, "STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE");
  const rr = computeRecoveryReadiness({ classified: cls, planJob: planJobOf({ stockDecision: STOCK_DECISIONS.NOT_REQUIRED }), job: j });
  assert.equal(rr.ok, false);
  assert.ok(rr.blockers.includes("STOCK_DECISION_NOT_REQUIRED_CONTRADICTS_EVIDENCE"), "plan ห้ามลบล้าง verdict ของ classifier เงียบ ๆ");
});

test("14. OWNER_VERIFIED_NO_STOCK_WRITE ต้องมี stockEvidenceRef", () => {
  const j = job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }] });
  const cls = classifyServiceNoJvCandidate({ job: j, entries: [], validMappingKeys: MAPPING_OK, productMap: new Map([["5", { id: 5, product_type: "stock" }]]), movements: [] });
  const noRef = computeRecoveryReadiness({ classified: cls, planJob: planJobOf({ stockDecision: STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE }), job: j });
  assert.ok(noRef.blockers.includes("STOCK_EVIDENCE_REF_REQUIRED"));
  const withRef = computeRecoveryReadiness({ classified: cls, planJob: planJobOf({ stockDecision: STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE, stockEvidenceRef: "owner นับของจริง 2026-07-13" }), job: j });
  assert.equal(withRef.ok, true, withRef.blockers.join(","));
  // parse level ก็ต้องปฏิเสธ
  assert.ok(parseRecoveryPlan(planOf([planJobOf({ stockDecision: STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE })])).errors.some(e => /STOCK_EVIDENCE_REF_REQUIRED/.test(e)));
});

test("15. STOCK_RECOVERY_REQUIRED / UNRESOLVED → block apply (ส่งต่อ phase แยก)", () => {
  for (const sd of [STOCK_DECISIONS.STOCK_RECOVERY_REQUIRED, STOCK_DECISIONS.UNRESOLVED]) {
    const rr = ready({ planJob: planJobOf({ stockDecision: sd }) });
    assert.equal(rr.ok, false);
    assert.ok(rr.blockers.includes(`STOCK_DECISION_${sd}`));
  }
  assert.match(RUNNER_CODE, /stock recovery phase \(ไม่ทำใน PR นี้\)/, "runner ต้องรายงานงานที่ต้องแยกไป stock phase");
});

// ═══ 16-19. writer / verification ══════════════════════════
test("16. ใช้ canonical writer เท่านั้น — ห้าม raw journal insert / ห้ามคิดสูตร JV / ห้ามแตะสต็อก", () => {
  assert.match(RUNNER_CODE, /await import\("\.\.\/modules\/accounting\/auto_post\.js"\)/, "ต้อง dynamic import canonical writer");
  assert.match(RUNNER_CODE, /writer\.postJournalForServiceJob\(fullJob, \{ detailed: true \}\)/);
  // journal_entries/journal_lines ปรากฏได้เฉพาะใน GET query (read-back verify) — ห้ามอยู่ใน POST/PATCH body
  for (const m of RUNNER_CODE.matchAll(/fetch\([^)]*\{[\s\S]{0,200}?method:\s*"(POST|PATCH)"/g)) {
    const seg = m[0];
    assert.ok(!/journal_entries|journal_lines/.test(seg), "ห้าม POST/PATCH ตรงเข้า journal_entries/journal_lines (ต้องผ่าน canonical writer)");
  }
  assert.ok(!/JSON\.stringify\(\{[^}]*(debit|credit|account_code|doc_no)/.test(RUNNER_CODE), "ห้ามประกอบ JE payload เอง");
  assert.ok(!/debit:\s*amount|credit:\s*amount|account_code:\s*["']\d/.test(RUNNER_CODE), "ห้ามประกอบ Dr/Cr เอง");
  // stock: อ่านได้ (GET stock_movements ไว้จำแนกหลักฐาน) แต่ห้ามเขียน/เรียก stock writer ทุกช่องทาง
  assert.ok(!/warehouse_stock/.test(RUNNER_CODE), "ห้ามแตะ warehouse_stock");
  assert.ok(!/deductServiceJobStock|restoreServiceJobStock|_applyStockMovement/.test(RUNNER_CODE), "ห้ามเรียก stock writer");
  assert.ok(!/JSON\.stringify\(\{[^}]*stock_(deducted|reverted)_at/.test(RUNNER_CODE), "ห้าม PATCH stock marker");
  // stock_movements ปรากฏได้เฉพาะใน GET select เท่านั้น
  const stockRefs = [...RUNNER_CODE.matchAll(/.{0,60}stock_movements.{0,40}/g)].map(m => m[0]);
  assert.ok(stockRefs.length > 0 && stockRefs.every(s => /select=/.test(s)), "stock_movements ต้องถูกใช้แค่ในการอ่าน (GET select)");
  // bootstrap ต้องไม่มี service role
  const boot = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function loadCanonicalWriter"), RUNNER_CODE.indexOf("async function fetchJobForWriter"));
  assert.match(boot, /globalThis\.window\.SUPABASE_CONFIG = \{ url: URL_BASE, anonKey: ANON \}/);
  assert.match(boot, /globalThis\.window\._sbAccessToken = token/);
  assert.match(boot, /showToast = \(\) => \{\}/);
  assert.ok(!/service_role|SERVICE_ROLE/.test(boot), "ห้ามใส่ service role key");
});

test("17. writer ล้มหลัง closed_at ถูกเขียน → CLOSED_AT_SET_JV_MISSING, ไม่ rollback, STOP, exit 2", () => {
  const applyBlock = RUNNER_CODE.slice(RUNNER_CODE.indexOf('if (st === "failed")'), RUNNER_CODE.indexOf("const v = await readBackVerify"));
  assert.match(applyBlock, /CLOSED_AT_SET_JV_MISSING/);
  assert.match(applyBlock, /ห้าม rollback/);
  assert.match(applyBlock, /return 2/);
  assert.ok(!/closed_at: null/.test(RUNNER_CODE), "ห้าม rollback closed_at เป็น null");
  assert.match(RUNNER_CODE, /STOP ที่ความล้มเหลวแรก/, "ต้องหยุดที่งานแรกที่ล้ม ไม่เดินงานถัดไป");
});

test("18. duplicate/skip จาก writer ต้อง read-back verify ก่อนนับสำเร็จ", () => {
  const applyBlock = RUNNER_CODE.slice(RUNNER_CODE.indexOf("const res = await writer.postJournalForServiceJob"), RUNNER_CODE.indexOf("done.push(label)"));
  assert.match(applyBlock, /readBackVerify\(token, job, rr\.docDate, planJob\.expectedAmount/, "ทุกผลลัพธ์ต้อง verify ก่อน");
  assert.ok(!/if \(st === "posted"\)[\s\S]{0,80}done\.push/.test(applyBlock), "ห้ามนับสำเร็จจากผล writer อย่างเดียว");
});

const ACC = { debit: "1110", credit: "4210" };
const okLines = () => [{ account_code: "1110", debit: 1000, credit: 0 }, { account_code: "4210", debit: 0, credit: 1000 }];
const mkVerify = (over, lines, accounts = ACC) => verifyPostedJournal({
  entries: [{ id: 900, status: "approved", source_table: "service_jobs", doc_date: "2026-07-10", total_debit: 1000, total_credit: 1000, ...over }],
  linesByEntry: new Map([["900", lines || okLines()]]),
  expectedDocDate: "2026-07-10", expectedAmount: 1000, expectedAccounts: accounts
});

test("19. post-write verify: date/amount/balance/duplicate mismatch → ไม่ผ่าน (exit 2)", () => {
  assert.equal(mkVerify({}).ok, true, mkVerify({}).problems.join(","));
  assert.ok(mkVerify({ doc_date: "2026-07-11" }).problems.some(p => /DOC_DATE_MISMATCH/.test(p)));
  assert.ok(mkVerify({ total_debit: 900, total_credit: 900 }).problems.some(p => /AMOUNT_MISMATCH/.test(p)));
  assert.ok(mkVerify({ total_credit: 900 }).problems.includes("JE_HEADER_NOT_BALANCED"));
  assert.ok(mkVerify({}, [{ account_code: "1110", debit: 1000, credit: 0 }]).problems.includes("JE_LINES_NOT_BALANCED"));
  assert.ok(mkVerify({}, []).problems.includes("JE_LINES_MISSING"));
  assert.ok(verifyPostedJournal({ entries: [], expectedDocDate: "2026-07-10", expectedAmount: 1000, expectedAccounts: ACC }).problems.includes("JE_MISSING_AFTER_WRITE"));
  const dup = verifyPostedJournal({
    entries: [{ id: 1, status: "approved", source_table: "service_jobs", doc_date: "2026-07-10", total_debit: 1000, total_credit: 1000 },
      { id: 2, status: "approved", source_table: "service_jobs", doc_date: "2026-07-10", total_debit: 1000, total_credit: 1000 }],
    linesByEntry: new Map([["1", okLines()]]),
    expectedDocDate: "2026-07-10", expectedAmount: 1000, expectedAccounts: ACC
  });
  assert.ok(dup.problems.includes("JE_DUPLICATE_AFTER_WRITE"));
  // ไม่มี expectedAccounts = verify ไม่ได้ (ห้ามผ่านเงียบ)
  assert.ok(mkVerify({}, okLines(), null).problems.includes("EXPECTED_ACCOUNTS_MISSING"));
  assert.match(RUNNER_CODE, /if \(!v\.ok\)[\s\S]{0,200}return 2/, "verify ไม่ผ่าน → exit 2");
});

test("19b. review#3: บัญชีต้องตรง mapping ของงานนี้แบบ exact (บัญชีจาก mapping งานอื่น = fail)", () => {
  // JV บาลานซ์ ยอดตรง แต่ Dr/Cr เป็นบัญชีของงานประเภทอื่น → ต้องไม่ผ่าน
  const otherAccounts = mkVerify({}, [{ account_code: "1130", debit: 1000, credit: 0 }, { account_code: "4300", debit: 0, credit: 1000 }]);
  assert.equal(otherAccounts.ok, false);
  assert.ok(otherAccounts.problems.some(p => /JE_DEBIT_ACCOUNT_MISMATCH/.test(p)));
  assert.ok(otherAccounts.problems.some(p => /JE_CREDIT_ACCOUNT_MISMATCH/.test(p)));
  assert.ok(otherAccounts.problems.some(p => /JE_UNEXPECTED_ACCOUNT/.test(p)));
  // credit ถูกบัญชีแต่ debit ผิด → fail
  assert.ok(mkVerify({}, [{ account_code: "1130", debit: 1000, credit: 0 }, { account_code: "4210", debit: 0, credit: 1000 }])
    .problems.some(p => /JE_DEBIT_ACCOUNT_MISMATCH/.test(p)));
  // expectedJournalAccounts mirror writer: cash → debit_account_code · transfer → transfer_debit_code (ถ้าอยู่ใน COA)
  const mappings = new Map([["service_repair_ac", { mapping_key: "service_repair_ac", debit_account_code: "1110", credit_account_code: "4210", transfer_debit_code: "1135" }]]);
  const coa = new Set(["1110", "1130", "1135", "4210"]);
  assert.deepEqual(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: "cash", mappings, validCoaCodes: coa }), { ok: true, mappingKey: "service_repair_ac", debit: "1110", credit: "4210" });
  assert.equal(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: "โอน", mappings, validCoaCodes: coa }).debit, "1135");
  // transfer_debit_code ไม่อยู่ใน COA → fallback 1130 (เหมือน writer)
  assert.equal(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: "transfer", mappings, validCoaCodes: new Set(["1110", "1130", "4210"]) }).debit, "1130");
  assert.equal(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: "cash", mappings: new Map(), validCoaCodes: coa }).ok, false);
  assert.match(RUNNER_CODE, /expectedJournalAccounts\(\{/, "runner ต้อง resolve บัญชีจาก mapping ของงานนั้น");
  assert.ok(!/validAccountCodes/.test(RUNNER_CODE), "ต้องไม่เหลือ union ของทุก mapping");
});

// ═══ 20-24. hygiene ════════════════════════════════════════
test("20. ไม่ print credential/token/PII (customer_name ใช้ให้ writer เท่านั้น ไม่ log)", () => {
  // ห้าม log ค่า credential จริง (CONFIRM_TOKEN เป็นสตริงสาธารณะ ไม่ใช่ความลับ → ไม่นับ)
  assert.ok(!/console\.(log|error)\([^)]*\b(ANON|AD_PASS|AD_EMAIL|access_token|_sbAccessToken|password)\b/.test(RUNNER_CODE),
    "ห้าม log anon key / รหัสผ่าน / access token");
  assert.ok(!/console\.(log|error)\([^)]*\btoken\b/.test(RUNNER_CODE), "ห้าม log ตัวแปร token");
  assert.ok(!/console\.log\([^)]*customer_name|console\.log\([^)]*\.note\b/.test(RUNNER_CODE), "ห้าม print customer_name/note");
  const fetchForWriter = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function fetchJobForWriter"), RUNNER_CODE.indexOf("async function readBackVerify"));
  assert.match(fetchForWriter, /customer_name/, "customer_name ถูก fetch ให้ writer ใช้ทำ JV description");
  assert.ok(!/console\./.test(fetchForWriter), "ฟังก์ชันนี้ต้องไม่ log อะไรเลย");
  assert.match(RUNNER_CODE, /fatal\(`login ไม่สำเร็จ \(\$\{r\.status\}\)/);
});

test("21. ไม่มี production job id / plan จริง ใน fixture ที่ commit", () => {
  const self = read("tests/service_no_jv_recover_guard.test.js");
  assert.ok(/TEST-JOB-1/.test(self), "fixture ต้องใช้เลขงานสมมติ");
  assert.ok(!/JOB-17\d{11}/.test(self), "ห้ามมี job_no จริงของ production ใน test");
  assert.ok(!/JOB-17\d{11}/.test(RUNNER) && !/JOB-17\d{11}/.test(LIB), "ห้าม hardcode production job id ใน source");
  assert.ok(!/"sourceId":\s*"\d{2,}"/.test(RUNNER), "ห้าม embed plan จริงใน runner");
});

test("22. plan skeleton: ไม่มี PII และ default stockDecision ปลอดภัย (UNRESOLVED เมื่อหลักฐานไม่ครบ)", () => {
  const rowClean = classifyOf();
  const j2 = job({ id: 102, job_no: "TEST-JOB-2", items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }] });
  const rowStock = classifyServiceNoJvCandidate({ job: j2, entries: [], validMappingKeys: MAPPING_OK, productMap: new Map([["5", { id: 5, product_type: "stock" }]]), movements: [] });
  const sk = buildPlanSkeleton([rowClean, rowStock], ["2026-07"]);
  assert.equal(sk.schemaVersion, PLAN_SCHEMA_VERSION);
  assert.equal(sk.baseline.candidateCount, 2);
  assert.equal(sk.jobs[0].stockDecision, STOCK_DECISIONS.NOT_REQUIRED);
  assert.equal(sk.jobs[1].stockDecision, STOCK_DECISIONS.UNRESOLVED, "หลักฐานสต็อกไม่ครบ → default ต้องเป็น UNRESOLVED (block apply)");
  const s = JSON.stringify(sk);
  assert.ok(!/customer|phone|address|slip/i.test(s), "skeleton ต้องไม่มี PII");
});

test("23. npm script + ไม่มี dependency ใหม่", () => {
  assert.equal(PKG.scripts["recover:service-no-jv"], "node scripts/service_no_jv_recover.js");
  assert.equal(PKG.scripts["verify:service-no-jv"], "node scripts/service_no_jv_classify.js");
  assert.ok(!PKG.dependencies || Object.keys(PKG.dependencies).length === 0);
  assert.deepEqual(Object.keys(PKG.devDependencies).sort(), ["@eslint/js", "@playwright/test", "eslint"]);
});

// ═══ review follow-up (PR #190) — behavioral ═══════════════
const jeOf = (o = {}) => ({ id: 900, source_table: "service_jobs", source_id: 101, status: "approved", doc_date: "2026-07-10", total_debit: 1000, total_credit: 1000, ...o });
const linesOf = (id = "900") => new Map([[id, okLines()]]);

test("B1. review#1: resume หลัง partial write — งานแรก VERIFIED_COMPLETE (ข้าม, ไม่เขียนซ้ำ) · งานสอง PENDING", () => {
  const j1 = job({ id: 101, job_no: "TEST-JOB-1", closed_at: "2026-07-10T10:00:00Z" });   // เขียนไปแล้วรอบก่อน
  const j2 = job({ id: 102, job_no: "TEST-JOB-2", total_cost: 500 });
  const p1 = planJobOf(), p2 = planJobOf({ _job: { id: 102, job_no: "TEST-JOB-2", total_cost: 500 } });
  const s1 = classifyPlanJobState({ job: j1, entries: [jeOf()], linesByEntry: linesOf(), planJob: p1, expectedAccounts: ACC, expectedDocDate: "2026-07-10", expectedClosedAtIso: "2026-07-10T10:00:00Z" });
  const s2 = classifyPlanJobState({ job: j2, entries: [], planJob: p2, expectedAccounts: ACC, expectedDocDate: "2026-07-10", expectedClosedAtIso: "2026-07-10T10:00:00Z" });
  assert.equal(s1.state, PLAN_JOB_STATES.VERIFIED_COMPLETE);
  assert.equal(s2.state, PLAN_JOB_STATES.PENDING_RECOVERY);
  // baseline ยังนับทั้งสอง (verified + pending) → rerun ผ่าน ไม่ถือเป็น drift
  const plan = planOf([p1, p2], { baseline: { months: ["2026-07"], candidateCount: 2, candidateAmount: 1500 } });
  const b = planBaselineMatches({ plan, planStates: stateMap({ "101": s1.state, "102": s2.state }), liveCandidateIds: ["102"] });
  assert.equal(b.ok, true, b.errors.join(","));
  assert.deepEqual(b.counts, { verified: 1, pending: 1, conflict: 0 });
  // runner ต้องซ่อมเฉพาะ PENDING และประกาศว่าข้ามงานที่ทำแล้ว
  assert.match(RUNNER_CODE, /state === R\.PLAN_JOB_STATES\.PENDING_RECOVERY/);
  assert.match(RUNNER, /ข้าม — ไม่เขียนซ้ำ/);
});

test("B1b. review#1: งานใน plan ที่ JV ผิดวัน/ยอด/บัญชี/duplicate/non-approved → CONFLICT (block)", () => {
  const j = job({ closed_at: "2026-07-10T10:00:00Z" });
  const base = { job: j, linesByEntry: linesOf(), planJob: planJobOf(), expectedAccounts: ACC, expectedDocDate: "2026-07-10" };
  assert.equal(classifyPlanJobState({ ...base, entries: [jeOf({ doc_date: "2026-07-12" })] }).state, PLAN_JOB_STATES.CONFLICT);
  assert.equal(classifyPlanJobState({ ...base, entries: [jeOf({ total_debit: 800, total_credit: 800 })] }).state, PLAN_JOB_STATES.CONFLICT);
  assert.equal(classifyPlanJobState({ ...base, entries: [jeOf(), jeOf({ id: 901 })] }).state, PLAN_JOB_STATES.CONFLICT);
  assert.equal(classifyPlanJobState({ ...base, entries: [jeOf({ status: "draft" })] }).state, PLAN_JOB_STATES.CONFLICT);
  const wrongAcc = classifyPlanJobState({ ...base, entries: [jeOf()], expectedAccounts: { debit: "1130", credit: "4300" } });
  assert.equal(wrongAcc.state, PLAN_JOB_STATES.CONFLICT, "บัญชีของ mapping อื่น = CONFLICT");
});

test("B2. review#2: snapshot เปลี่ยนหลัง CAS → ไม่เรียก writer (STOP exit 2)", () => {
  const before = job();
  assert.equal(revalidateJobSnapshot({ before, after: { ...before, closed_at: "2026-07-10T10:00:00Z" }, planJob: planJobOf(), expectedClosedAtIso: "2026-07-10T10:00:00Z" }).ok, true);
  for (const change of [{ total_cost: 1200 }, { status: "closed" }, { job_type: "solar" }, { payment_method: "transfer" }, { note: "แก้ใหม่" }, { job_no: "TEST-JOB-9" }]) {
    const r = revalidateJobSnapshot({ before, after: { ...before, closed_at: "2026-07-10T10:00:00Z", ...change }, planJob: planJobOf(), expectedClosedAtIso: "2026-07-10T10:00:00Z" });
    assert.equal(r.ok, false, `field ${Object.keys(change)[0]} เปลี่ยนต้อง block`);
  }
  // closed_at ที่อ่านกลับมาไม่ตรงวันที่ owner อนุมัติ → block
  assert.equal(revalidateJobSnapshot({ before, after: { ...before, closed_at: "2026-07-01T00:00:00Z" }, planJob: planJobOf(), expectedClosedAtIso: "2026-07-10T10:00:00Z" }).ok, false);
  // diff ต้องไม่ leak ค่า note (PII)
  const leak = revalidateJobSnapshot({ before, after: { ...before, note: "ลูกค้าชื่อสมชาย 081..." }, planJob: planJobOf() });
  assert.ok(!/สมชาย|081/.test(leak.diffs.join(" ")), "diff ต้องไม่ print ค่า note");
  // runner ต้องเรียก revalidate ก่อน writer และ return 2 ถ้าไม่ผ่าน
  const seq = RUNNER_CODE.slice(RUNNER_CODE.indexOf("const fullJob = await fetchJobForWriter"), RUNNER_CODE.indexOf("const res = await writer.postJournalForServiceJob"));
  assert.match(seq, /revalidateJobSnapshot/);
  assert.match(seq, /return 2/);
});

test("B4. review#4: --apply โดยไม่มี plan / confirm ผิด → exit 1 และไม่มี write", () => {
  assert.match(RUNNER_CODE, /const APPLY_INTENT_INVALID = APPLY_FLAG && \(!APPLY \|\| !PLAN_PATH\)/);
  const noPlan = RUNNER_CODE.slice(RUNNER_CODE.indexOf("if (!rawPlan)"), RUNNER_CODE.indexOf("// ── plan validation"));
  assert.match(noPlan, /APPLY_INTENT_INVALID[\s\S]{0,200}return 1/, "apply ไม่มี plan → exit 1 (ไม่ใช่ preview exit 0)");
  const previewGate = RUNNER_CODE.slice(RUNNER_CODE.indexOf("  if (!APPLY) {"), RUNNER_CODE.indexOf("// ── APPLY ──"));
  assert.match(previewGate, /APPLY_INTENT_INVALID[\s\S]{0,200}return 1/, "apply + confirm ผิด → exit 1");
});

test("B5. review#6: hard stock conflict → block เสมอ แม้ owner ใส่ evidenceRef (+allowlist)", () => {
  const j = job({ items_json: [], stock_deducted_at: "2026-07-09T00:00:00Z" });   // ไม่มี item แต่มี claim = conflict
  const cls = classifyServiceNoJvCandidate({ job: j, entries: [], validMappingKeys: MAPPING_OK, productMap: new Map(), movements: [] });
  assert.equal(cls.stock.verdict, "STOCK_MARKER_MOVEMENT_CONFLICT");
  const rr = computeRecoveryReadiness({
    classified: cls, job: j,
    planJob: planJobOf({ stockDecision: STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE, stockEvidenceRef: "owner ตรวจแล้ว" })
  });
  assert.equal(rr.ok, false);
  assert.ok(rr.blockers.some(b => /STOCK_HARD_CONFLICT_STOCK_MARKER_MOVEMENT_CONFLICT/.test(b)));
  assert.ok(rr.blockers.some(b => /STOCK_OWNER_VERIFY_NOT_ALLOWED_FOR/.test(b)), "verdict นอก allowlist ห้ามให้ owner ยืนยันแทน");
  // allowlist: ไม่พบหลักฐาน movement → owner ยืนยันได้ (มี evidence ref)
  const soft = job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }] });
  const clsSoft = classifyServiceNoJvCandidate({ job: soft, entries: [], validMappingKeys: MAPPING_OK, productMap: new Map([["5", { id: 5, product_type: "stock" }]]), movements: [] });
  const rrSoft = computeRecoveryReadiness({
    classified: clsSoft, job: soft,
    planJob: planJobOf({ stockDecision: STOCK_DECISIONS.OWNER_VERIFIED_NO_STOCK_WRITE, stockEvidenceRef: "นับของจริง 13 ก.ค." })
  });
  assert.equal(rrSoft.ok, true, rrSoft.blockers.join(","));
});

// ═══ review round 2 (PR #190 HEAD 9fdad9f) ═════════════════
test("C1. B1: plan ต้องมี sourceSnapshotSha256 (schema v2) และ hash ครอบ canonical fields ทั้ง 7", () => {
  assert.equal(PLAN_SCHEMA_VERSION, 2);
  const noHash = parseRecoveryPlan(planOf([{ ...planJobOf(), sourceSnapshotSha256: undefined }]));
  assert.ok(noHash.errors.some(e => /SOURCE_SNAPSHOT_SHA256_MISSING_OR_INVALID/.test(e)));
  assert.ok(parseRecoveryPlan(planOf([planJobOf({ sourceSnapshotSha256: "ไม่ใช่ hash" })])).errors.some(e => /SOURCE_SNAPSHOT/.test(e)));
  // hash ต้องเปลี่ยนเมื่อ field ใดใน canonical set เปลี่ยน
  const base = computeSourceSnapshotSha256(job());
  for (const change of [{ id: 999 }, { job_no: "X" }, { status: "cancelled" }, { total_cost: 999 }, { job_type: "solar" }, { payment_method: "transfer" }, { note: "[ลบแล้ว]" }]) {
    assert.notEqual(computeSourceSnapshotSha256(job(change)), base, `hash ต้องเปลี่ยนเมื่อ ${Object.keys(change)[0]} เปลี่ยน`);
  }
  // field นอก canonical set (เช่น closed_at/items_json) ไม่กระทบ hash
  assert.equal(computeSourceSnapshotSha256(job({ closed_at: "2026-07-10T10:00:00Z", items_json: [{ product_id: 5 }] })), base);
  // hash ไม่เก็บ note ดิบ
  const skel = buildPlanSkeleton([classifyOf()], ["2026-07"], new Map([["101", job({ note: "ลูกค้า 081-xxx" })]]));
  const s = JSON.stringify(skel);
  assert.ok(/[0-9a-f]{64}/.test(s), "skeleton ต้องมี sha256");
  assert.ok(!/081-xxx|ลูกค้า/.test(s), "ห้ามเก็บ note ดิบใน plan");
});

test("C2. B1: live row เปลี่ยนหลัง owner อนุมัติ → CONFLICT / block ทุกเส้นทาง (verified · pending · rerun)", () => {
  const approvedAtPlan = planJobOf();                                    // hash ของ row ตอนอนุมัติ (done/1000/cash)
  const drifted = job({ status: "cancelled", total_cost: 999, closed_at: "2026-07-10T10:00:00Z" });
  // (ก) มี JV ตรง plan แต่ live row เปลี่ยนแล้ว → ต้องไม่ใช่ VERIFIED_COMPLETE
  const st = classifyPlanJobState({
    job: drifted, entries: [jeOf()], linesByEntry: linesOf(), planJob: approvedAtPlan,
    expectedAccounts: ACC, expectedDocDate: "2026-07-10", expectedClosedAtIso: "2026-07-10T10:00:00Z"
  });
  assert.equal(st.state, PLAN_JOB_STATES.CONFLICT);
  assert.ok(st.problems.includes("PLAN_SOURCE_SNAPSHOT_DRIFT"));
  // (ข) เส้น pending: readiness ต้อง block ด้วย snapshot drift
  const rr = computeRecoveryReadiness({ classified: classifyOf(job({ payment_method: "transfer" })), planJob: approvedAtPlan, job: job({ payment_method: "transfer" }) });
  assert.equal(rr.ok, false);
  assert.ok(rr.blockers.includes("PLAN_SOURCE_SNAPSHOT_DRIFT"), "job_type/payment/note ที่เปลี่ยนต้อง block แม้ยอด/สถานะยังเท่าเดิม");
  // (ค) rerun ด้วย plan เดิมหลัง row เปลี่ยน: before=after (ชุดใหม่) แต่ hash ใน plan ยังกัน
  const changed = job({ job_type: "solar", closed_at: "2026-07-10T10:00:00Z" });
  const re = revalidateJobSnapshot({ before: changed, after: changed, planJob: approvedAtPlan, expectedClosedAtIso: "2026-07-10T10:00:00Z" });
  assert.equal(re.ok, false, "rerun หลัง snapshot เปลี่ยนต้องยัง block (durable ข้าม run)");
  assert.ok(re.diffs.includes("PLAN_SOURCE_SNAPSHOT_DRIFT"));
});

test("C3. B1: VERIFIED_COMPLETE ต้องมี closed_at = recognitionAt ของ owner เป๊ะ", () => {
  const pj = planJobOf();
  const okJob = job({ closed_at: "2026-07-10T10:00:00Z" });
  const base = { entries: [jeOf()], linesByEntry: linesOf(), planJob: pj, expectedAccounts: ACC, expectedDocDate: "2026-07-10", expectedClosedAtIso: "2026-07-10T10:00:00Z" };
  assert.equal(classifyPlanJobState({ ...base, job: okJob }).state, PLAN_JOB_STATES.VERIFIED_COMPLETE);
  // closed_at เป็นค่าอื่น (เช่นใครไปปิดงานเองทีหลัง) → CONFLICT
  const other = classifyPlanJobState({ ...base, job: job({ closed_at: "2026-07-11T10:00:00Z" }) });
  assert.equal(other.state, PLAN_JOB_STATES.CONFLICT);
  assert.ok(other.problems.includes("CLOSED_AT_NOT_OWNER_APPROVED"));
  // closed_at ว่าง แต่มี JV → CONFLICT (GL กับ operational ไม่ตรง)
  assert.equal(classifyPlanJobState({ ...base, job: job({ closed_at: null }) }).state, PLAN_JOB_STATES.CONFLICT);
  assert.match(RUNNER_CODE, /expectedClosedAtIso: rec\.ok \? rec\.iso : null/, "runner ต้องส่ง expectedClosedAtIso เข้า planState");
});

test("C5. hash collision: delimiter injection ต้องไม่ทำให้ 2 row ต่างกันได้ preimage/hash เดียวกัน", () => {
  // เคสจริงจาก audit: ย้าย "|note=" เข้าไปในค่า payment_method → Dr เปลี่ยนจากเงินสดเป็นเงินโอน
  const before = job({ payment_method: "cash", note: "transfer|note=z" });
  const after = job({ payment_method: "cash|note=transfer", note: "z" });
  assert.notEqual(canonicalSourceString(before), canonicalSourceString(after), "canonical preimage ต้องต่างกัน");
  assert.notEqual(computeSourceSnapshotSha256(before), computeSourceSnapshotSha256(after), "hash ต้องต่างกัน");
  // และ payment_method ที่ต่างกันจริง ๆ ต้องพา Dr คนละบัญชี (พิสูจน์ว่าเป็นบั๊กเงิน ไม่ใช่แค่ cosmetic)
  const mappings = new Map([["service_repair_ac", { debit_account_code: "1110", credit_account_code: "4210", transfer_debit_code: "1120" }]]);
  const coa = new Set(["1110", "1120", "1130", "4210"]);
  assert.equal(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: before.payment_method, mappings, validCoaCodes: coa }).debit, "1110");
  assert.equal(expectedJournalAccounts({ jobType: "repair_ac", paymentMethod: after.payment_method, mappings, validCoaCodes: coa }).debit, "1120");
  // plan ที่ผูก hash ของ before ต้อง block row after
  assert.equal(verifySourceSnapshot(after, planJobOf({ _job: { payment_method: "cash", note: "transfer|note=z" } })).reason, "PLAN_SOURCE_SNAPSHOT_DRIFT");
  // อีกคู่: ย้ายเนื้อหาข้าม field ผ่านอักขระ separator อื่น
  const a2 = job({ job_no: "A", status: "done" });
  const b2 = job({ job_no: 'A","done', status: "" });
  assert.notEqual(computeSourceSnapshotSha256(a2), computeSourceSnapshotSha256(b2));
  // preimage ต้องมี domain/version กัน hash ชนกับ hash ของอย่างอื่น
  assert.match(canonicalSourceString(job()), /service_jobs_snapshot_v1/);
  assert.doesNotThrow(() => JSON.parse(canonicalSourceString(job())), "canonical ต้องเป็น JSON ที่ escape ค่าในตัวเอง");
});

test("C4. B2: service_role key ต้องถูกปฏิเสธจริง (JWT role + sb_secret_ prefix) + fail-closed", () => {
  const jwt = (payload) => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  // JWT เก่า: role อยู่ใน payload (base64url) — regex บน key ดิบจับไม่ได้
  const svc = jwt({ iss: "supabase", role: "service_role", ref: "abc" });
  assert.ok(!/service_role/i.test(svc), "key ดิบไม่มีคำว่า service_role (พิสูจน์ว่า regex เดิมจับไม่ได้)");
  const r1 = assertPublishableKey(svc);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /SERVICE_ROLE_KEY_DETECTED/);
  // key ใหม่: sb_secret_
  const r2 = assertPublishableKey("sb_secret_AbCdEf123456");
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /SERVICE_ROLE_KEY_DETECTED/);
  // anon JWT + publishable key = ผ่าน
  assert.equal(assertPublishableKey(jwt({ iss: "supabase", role: "anon", ref: "abc" })).ok, true);
  assert.equal(assertPublishableKey("sb_publishable_XyZ").ok, true);
  assert.equal(assertPublishableKey("").ok, false);
  // role แปลก ๆ = ไม่ให้ใช้
  assert.equal(assertPublishableKey(jwt({ role: "postgres" })).ok, false);
  // ★ fail-closed: payload อ่านไม่ออก / ไม่มี role / รูปแบบ key ไม่รู้จัก → ปฏิเสธ (ไม่ใช่ ok:true)
  assert.equal(assertPublishableKey("aaa.bbb.ccc").ok, false, "JWT payload อ่านไม่ออก = ห้ามใช้");
  assert.equal(assertPublishableKey(jwt({ iss: "supabase" })).ok, false, "JWT ไม่มี role = ห้ามใช้");
  assert.equal(assertPublishableKey("random-key-1234").ok, false, "รูปแบบไม่รู้จัก = ห้ามใช้");
  // runner ต้องใช้ helper นี้ ไม่ใช่ regex เดิม
  assert.match(RUNNER_CODE, /R\.assertPublishableKey\(ANON\)/);
  assert.ok(!/\/service_role\/i\.test/.test(RUNNER_CODE), "ต้องไม่เหลือ regex บน key ดิบ");
  const boot = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function loadCanonicalWriter"), RUNNER_CODE.indexOf("async function fetchJobForWriter"));
  assert.ok(!/service_role|sb_secret_/.test(boot), "bootstrap ต้องไม่มี service role key");
});

test("24. lib เป็น pure (ไม่มี fetch/env/fs) และ S4.1b semantics ไม่ถูกแก้", () => {
  assert.ok(!/\bfetch\(|process\.env|process\.exit|from "node:fs"/.test(LIB), "recover_lib ต้อง pure");
  // ห้ามผ่อน readiness ของ classifier: recover lib ต้องไม่ export/แก้ overallS41cReady
  assert.ok(!/overallS41cReady\s*=/.test(LIB), "ห้ามเขียนทับ overallS41cReady ของ S4.1b");
  const classifyLib = read("scripts/service_no_jv_classify_lib.js");
  assert.match(classifyLib, /export function computeRecoveryReadiness/.test(classifyLib) ? /$^/ : /overallS41cReady/, "classifier ยังคง readiness เดิม");
});
