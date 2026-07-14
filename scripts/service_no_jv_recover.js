// ═══════════════════════════════════════════════════════════
//  service_no_jv_recover.js — Phase 605 (S4.1c) RECOVERY RUNNER (gated)
//  ซ่อมงานบริการ NO_JV ที่ S4.1b จำแนกไว้: backfill closed_at (วันที่ owner อนุมัติ) → สร้าง JV
//  ผ่าน canonical writer postJournalForServiceJob() → read-back verify ทุกงาน
//
//  ★ DEFAULT = PREVIEW (read-only): POST เฉพาะ /auth/v1/token · REST เป็น GET ล้วน · ไม่มี write ใด ๆ
//  ★ APPLY ต้องครบ 2 ธง: --apply --confirm=SERVICE-NO-JV-S4.1C (ขาดอย่างใดอย่างหนึ่ง = ไม่เขียนเด็ดขาด)
//  ★ เขียนได้แค่ 2 อย่างเท่านั้น: (1) CAS PATCH service_jobs.closed_at (field เดียว)
//    (2) JV ผ่าน canonical writer — ห้าม raw insert journal_entries/journal_lines, ห้ามคิดสูตร Dr/Cr เอง
//  ★ ห้ามแตะสต็อกทุกกรณี (ไม่ deduct/restore/PATCH marker/insert stock_movements)
//  ★ PII: ไม่ print token/password/customer/note (customer_name ถูก fetch ส่งให้ writer ใช้ทำ JV
//    description เท่านั้น — เหมือนที่แอปทำ — และไม่ถูก log ที่ใดเลย)
//
//  Usage:
//    npm run recover:service-no-jv -- 2026-07 2026-06                      # preview + plan skeleton
//    npm run recover:service-no-jv -- --plan=/abs/plan.json 2026-07 2026-06 [--strict]
//    npm run recover:service-no-jv -- --plan=/abs/plan.json 2026-07 --apply --confirm=SERVICE-NO-JV-S4.1C
//  Env (.env): SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
//  Exit: 0 = preview จบ / apply สำเร็จครบ+verify ผ่าน · 1 = --strict มี blocker หรือ preflight ปฏิเสธ (ไม่มี write)
//        2 = fatal (env/network/auth) หรือ partial write / post-verify fail
// ═══════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import * as L from "./finance_reconcile_lib.js";
import * as C from "./service_no_jv_classify_lib.js";
import * as R from "./service_no_jv_recover_lib.js";

function fatal(msg) { console.error("[fatal] " + msg); process.exit(2); }   // ★ ห้ามใส่ token/password ในข้อความ

function loadEnv(file) {
  if (!fs.existsSync(file)) return null;
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const env = loadEnv(path.resolve(".env"));
if (!env) fatal(".env not found — ต้องมี SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");
const URL_BASE = (env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;
const AD_EMAIL = env.ADMIN_EMAIL, AD_PASS = env.ADMIN_PASSWORD;
if (!URL_BASE || !ANON || !AD_EMAIL || !AD_PASS) fatal("env ไม่ครบ: ต้องมี SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");
// ★ review fix B2: ตรวจ key จริง ๆ (JWT payload role / prefix sb_secret_) — service_role ข้าม RLS ทั้งหมด
const _keyCheck = R.assertPublishableKey(ANON);
if (!_keyCheck.ok) fatal(`SUPABASE_ANON_KEY ใช้ไม่ได้: ${_keyCheck.reason} — runner นี้ต้องใช้ publishable/anon key เท่านั้น`);

// ── args ───────────────────────────────────────────────────
const argv = process.argv.slice(2);
const MONTHS = argv.filter(a => /^\d{4}-\d{2}$/.test(a));
const STRICT = argv.includes("--strict");
const APPLY_FLAG = argv.includes("--apply");
const CONFIRM = (argv.find(a => a.startsWith("--confirm=")) || "").split("=")[1] || "";
const PLAN_PATH = (argv.find(a => a.startsWith("--plan=")) || "").split("=")[1] || "";
// ★ APPLY ต้องครบทั้งสองธง — ขาดอย่างใดอย่างหนึ่ง = preview (ไม่เขียนอะไรเลย)
const APPLY = APPLY_FLAG && CONFIRM === R.CONFIRM_TOKEN;
// ★ review fix (#4): "ตั้งใจจะ apply แต่ธง/plan ไม่ครบ" = ความผิดพลาดของผู้ใช้ → exit 1 (ห้ามเงียบเป็น preview exit 0)
const APPLY_INTENT_INVALID = APPLY_FLAG && (!APPLY || !PLAN_PATH);
if (MONTHS.length === 0) fatal("ต้องระบุเดือนอย่างน้อย 1 เดือน เช่น 2026-07 2026-06");

const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── auth (จุด POST เดียวนอก write path) ────────────────────
async function signIn(email, password) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password })
  });
  if (!r.ok) fatal(`login ไม่สำเร็จ (${r.status}) — เช็ค ADMIN_EMAIL/ADMIN_PASSWORD ใน .env`);
  const d = await r.json();
  if (!d.access_token) fatal("login ไม่ได้ access_token");
  return d.access_token;
}
const authH = (token) => ({ apikey: ANON, Authorization: "Bearer " + token });

// ── READ: GET เท่านั้น ─────────────────────────────────────
const PAGE = 1000, MAX_PAGES = 100;
async function getAllChecked(token, pathAndQuery) {
  let offset = 0, out = [], pages = 0, incomplete = false;
  for (;;) {
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const url = `${URL_BASE}/rest/v1/${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { method: "GET", headers: authH(token) });
    if (!r.ok) fatal(`GET ${pathAndQuery} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    out = out.concat(rows);
    pages += 1;
    if (rows.length < PAGE) break;
    if (pages >= MAX_PAGES) { incomplete = true; break; }
    offset += PAGE;
  }
  return { rows: out, incomplete };
}
async function getAll(token, q) { return (await getAllChecked(token, q)).rows; }
async function getByIn(token, table, select, col, ids, chunk = 100, extra = "") {
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  let out = [];
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk).map(encodeURIComponent).join(",");
    out = out.concat(await getAll(token, `${table}?select=${select}&${col}=in.(${part})${extra}`));
  }
  return out;
}

// ★ select ของ classifier (ไม่มี deleted_at / ไม่มี PII)
const SJ_SELECT = "id,job_no,job_type,status,created_at,closed_at,total_cost,payment_method,sub_service,note,items_json,stock_deducted_at,stock_reverted_at";

function monthWindow(month) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(Date.UTC(y, m, 1)); end.setUTCDate(end.getUTCDate() + 1);
  return { fromTs: start.toISOString(), toTs: end.toISOString() };
}

async function loadState(token, planSourceIds = []) {
  const jobsMap = new Map();
  for (const month of MONTHS) {
    const w = monthWindow(month);
    const created = await getAll(token, `service_jobs?select=${SJ_SELECT}&created_at=gte.${w.fromTs}&created_at=lt.${w.toTs}`);
    const closed = await getAll(token, `service_jobs?select=${SJ_SELECT}&closed_at=gte.${w.fromTs}&closed_at=lt.${w.toTs}`);
    for (const j of [...created, ...closed]) jobsMap.set(String(j.id), j);
  }
  // ★ review fix (#1): งานใน plan ที่โพสต์ JV ไปแล้ว (partial write รอบก่อน) จะหลุดจาก candidate —
  //   ต้องดึงมาโดยตรงด้วย id เพื่อประเมิน VERIFIED_COMPLETE/CONFLICT ตอน resume
  if (planSourceIds.length) {
    const extra = await getByIn(token, "service_jobs", SJ_SELECT, "id", planSourceIds);
    for (const j of extra) jobsMap.set(String(j.id), j);
  }
  const jobs = [...jobsMap.values()];

  const mappings = await getAll(token, "account_mapping?select=mapping_key,debit_account_code,credit_account_code,transfer_debit_code,is_active&is_active=eq.true");
  const validMappingKeys = new Set(mappings.filter(m => m.debit_account_code && m.credit_account_code).map(m => m.mapping_key));
  const mappingByKey = new Map(mappings.map(m => [m.mapping_key, m]));
  // COA ที่ active — ใช้ตัดสิน transfer_debit_code เหมือนที่ writer ทำ (auto_post._getValidCoaCodes)
  const coa = await getAll(token, "chart_of_accounts?select=code&is_active=eq.true");
  const validCoaCodes = new Set(coa.map(c => String(c.code)));

  const jeAll = await getByIn(token, "journal_entries", "id,doc_date,status,total_debit,total_credit,source_table,source_id", "source_id", jobs.map(j => j.id));
  const entriesByJob = new Map();
  for (const je of jeAll) {
    if (je.source_table !== "service_jobs") continue;
    const k = String(je.source_id);
    if (!entriesByJob.has(k)) entriesByJob.set(k, []);
    entriesByJob.get(k).push(je);
  }
  const bound = [...entriesByJob.values()].flat();
  const lines = await getByIn(token, "journal_lines", "entry_id,account_code,debit,credit", "entry_id", bound.map(e => e.id));
  const linesByEntry = new Map();
  for (const l of lines) { const k = String(l.entry_id); if (!linesByEntry.has(k)) linesByEntry.set(k, []); linesByEntry.get(k).push(l); }

  const candidates = jobs.filter(j => C.isServiceIncomeCandidate(j)).filter(j => {
    const es = entriesByJob.get(String(j.id)) || [];
    return !es.some(e => String(e.status || "").toLowerCase() === "approved");
  });

  const productIds = new Set();
  for (const j of candidates) for (const it of C.parseItemsJson(j.items_json).items) {
    if (it?.product_id !== null && it?.product_id !== undefined) productIds.add(String(it.product_id));
  }
  const products = productIds.size ? await getByIn(token, "products", "id,product_type", "id", [...productIds]) : [];
  const productMap = new Map(products.map(p => [String(p.id), p]));

  let movements = [], stockDataIncomplete = false;
  if (candidates.length) {
    const minTs = candidates.reduce((min, j) => {
      const t = new Date(j.created_at).getTime();
      return Number.isFinite(t) && t < min ? t : min;
    }, Number.POSITIVE_INFINITY);
    const from = new Date((Number.isFinite(minTs) ? minTs : Date.now()) - 86400000).toISOString();
    const res = await getAllChecked(token, `stock_movements?select=id,product_id,type,qty,note,created_at&created_at=gte.${from}&type=in.(out,return)`);
    movements = res.rows;
    stockDataIncomplete = res.incomplete;
  }

  // งวดบัญชีที่ล็อกแล้ว (ห้ามโพสต์ย้อนเข้า)
  const periods = await getAll(token, "accounting_periods?select=year,month,status");
  const lockedPeriods = new Set(
    periods.filter(p => String(p.status || "").toLowerCase() === "locked")
      .map(p => `${p.year}-${String(p.month).padStart(2, "0")}`)
  );

  const rows = candidates.map(job => C.classifyServiceNoJvCandidate({
    job, entries: entriesByJob.get(String(job.id)) || [], linesByEntry,
    validMappingKeys, productMap, movements, stockDataIncomplete
  }));
  const summary = C.summarizeClassification(rows);
  const jobById = new Map(jobs.map(j => [String(j.id), j]));
  return {
    jobs, jobById, candidates, rows, summary, entriesByJob, linesByEntry,
    validMappingKeys, mappingByKey, validCoaCodes, lockedPeriods, stockDataIncomplete,
    productMap, movements
  };
}

/** บัญชีที่ JV ของงานนี้ต้องใช้ (exact ตาม mapping ของ job_type + payment_method) */
function accountsFor(S, job) {
  return R.expectedJournalAccounts({
    jobType: job?.job_type, paymentMethod: job?.payment_method,
    mappings: S.mappingByKey, validCoaCodes: S.validCoaCodes
  });
}

// ── plan ───────────────────────────────────────────────────
function loadPlan() {
  if (!PLAN_PATH) return null;
  const abs = path.resolve(PLAN_PATH);
  if (!fs.existsSync(abs)) fatal(`ไม่พบไฟล์ plan: ${abs}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(abs, "utf8")); }
  catch (e) { fatal(`plan JSON ไม่ถูกต้อง: ${e?.message}`); }
  return raw;
}

// ── WRITE PATH (apply เท่านั้น) ────────────────────────────
//  ★ ทุกฟังก์ชันใต้นี้ต้องถูกเรียกหลังผ่าน gate APPLY + preflight ครบเท่านั้น (assert ซ้ำในตัวมันเอง)

/** CAS PATCH — เขียนคอลัมน์เดียว: closed_at (filter กันงานถูกแก้ระหว่างทาง) */
async function casSetClosedAt(token, job, recognitionIso, expectedStatus, expectedAmount) {
  if (!APPLY) throw new Error("write blocked: APPLY gate ไม่ผ่าน");
  const q = `service_jobs?id=eq.${encodeURIComponent(job.id)}`
    + `&closed_at=is.null`
    + `&status=eq.${encodeURIComponent(expectedStatus)}`
    + `&total_cost=eq.${encodeURIComponent(expectedAmount)}`
    + `&select=id,closed_at,status,total_cost`;
  const r = await fetch(`${URL_BASE}/rest/v1/${q}`, {
    method: "PATCH",
    headers: { ...authH(token), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ closed_at: recognitionIso })   // ★ field เดียวเท่านั้น
  });
  if (!r.ok) return { won: false, error: `PATCH HTTP ${r.status}` };
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) return { won: false, error: "PATCH bad response" };
  return { won: rows.length === 1, rows };
}

/** bootstrap globalThis.window ให้ canonical writer ใช้ได้ใน Node (ไม่มี service role key) */
async function loadCanonicalWriter(token) {
  globalThis.window = globalThis.window || {};
  globalThis.window.SUPABASE_CONFIG = { url: URL_BASE, anonKey: ANON };
  globalThis.window._sbAccessToken = token;
  globalThis.window.showToast = () => {};
  globalThis.window.App = { showToast: () => {} };
  try {
    const mod = await import("../modules/accounting/auto_post.js");
    if (typeof mod.postJournalForServiceJob !== "function") fatal("canonical writer ไม่มี postJournalForServiceJob — STOP");
    return mod;
  } catch (e) {
    fatal(`import canonical writer (auto_post.js) ไม่สำเร็จ: ${e?.message} — STOP (ห้ามคัดลอกสูตร JV มาเขียนเอง)`);
  }
}

async function fetchJobForWriter(token, id) {
  // customer_name จำเป็นสำหรับ JV description ของ writer (เหมือนที่แอปทำ) — ★ ไม่ print ที่ใดเลย
  const rows = await getAll(token, `service_jobs?select=id,job_no,job_type,status,created_at,closed_at,total_cost,payment_method,note,customer_name&id=eq.${encodeURIComponent(id)}`);
  return rows[0] || null;
}

async function readBackVerify(token, job, expectedDocDate, expectedAmount, expectedAccounts) {
  const entries = (await getAll(token, `journal_entries?select=id,doc_date,status,total_debit,total_credit,source_table,source_id&source_table=eq.service_jobs&source_id=eq.${encodeURIComponent(job.id)}`));
  const lines = entries.length ? await getByIn(token, "journal_lines", "entry_id,account_code,debit,credit", "entry_id", entries.map(e => e.id)) : [];
  const linesByEntry = new Map();
  for (const l of lines) { const k = String(l.entry_id); if (!linesByEntry.has(k)) linesByEntry.set(k, []); linesByEntry.get(k).push(l); }
  return R.verifyPostedJournal({ entries, linesByEntry, expectedDocDate, expectedAmount, expectedAccounts });
}

// ── main ───────────────────────────────────────────────────
async function main() {
  const token = await signIn(AD_EMAIL, AD_PASS);
  const rawPlan = loadPlan();
  const S = await loadState(token, (rawPlan?.jobs || []).map(j => String(j.sourceId)).filter(Boolean));

  console.log(`# Service NO_JV — Controlled Recovery (S4.1c / Phase 605)\n`);
  console.log(`- mode: **${APPLY ? "APPLY (เขียนข้อมูลจริง)" : "PREVIEW (read-only)"}** · months: ${MONTHS.join(", ")}${STRICT ? " · --strict" : ""}`);
  console.log(`- effective date: ${L.ACCOUNTING_EFFECTIVE_DATE} · canonical writer: postJournalForServiceJob() (ห้าม raw JV insert)`);
  console.log(`- stock: **ไม่แตะทุกกรณีในเฟสนี้** (ไม่ deduct/restore/แก้ marker/insert movement)`);
  console.log(`- generated: ${L.bkkDate(new Date())} (Bangkok)\n`);
  console.log(`_candidate ตอนนี้: **${S.summary.candidateCount} งาน / ${money(S.summary.candidateAmount)} บาท** · journal: ${Object.entries(S.summary.journalCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"} · stock: ${Object.entries(S.summary.stockCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"}_\n`);

  if (!rawPlan) {
    console.log(`## ยังไม่มี recovery plan → แสดง skeleton (owner เติมแล้วเก็บไว้ **นอก repo**)\n`);
    console.log("```json");
    console.log(JSON.stringify(R.buildPlanSkeleton(S.rows, MONTHS, S.jobById), null, 2));
    console.log("```");
    console.log(`\n- \`sourceSnapshotSha256\` = hash ของ row ณ วันที่ออก skeleton (id/job_no/status/total_cost/job_type/payment_method/note — **เก็บแค่ hash ไม่เก็บ note ดิบ**) → ถ้างานถูกแก้หลัง owner อนุมัติ plan จะ drift และถูก block`);
    console.log(`- \`recognitionAt\` = วันที่/เวลาที่งานเสร็จจริงตามที่ owner ยืนยัน (ISO-8601 **ต้องมี timezone**) — ระบบไม่ fallback \`created_at\` ให้`);
    console.log(`- \`stockDecision\`: NOT_REQUIRED (ต้องตรงหลักฐาน) · OWNER_VERIFIED_NO_STOCK_WRITE (+stockEvidenceRef) · STOCK_RECOVERY_REQUIRED / UNRESOLVED = block apply`);
    console.log(`- \`_stockEvidence\` เป็นข้อมูลช่วยตัดสินใจ (ไม่ถูกใช้เป็น decision)`);
    console.log(`\n─── จบ preview (ไม่มีการแก้ข้อมูล) ───`);
    // ★ review fix (#4): ตั้งใจ apply แต่ไม่มี plan → exit 1 (ไม่ใช่ preview เงียบ ๆ)
    if (APPLY_INTENT_INVALID) { console.log(`\n⛔ --apply ต้องมาพร้อม --plan=<path> และ --confirm=${R.CONFIRM_TOKEN} → ไม่มีการเขียนข้อมูล (exit 1)`); return 1; }
    if (STRICT) { console.log(`\n⚠️ --strict: ยังไม่มี recovery plan → exit 1`); return 1; }
    return 0;
  }

  // ── plan validation + plan-job state (resume-aware) + baseline drift ──
  const parsed = R.parseRecoveryPlan(rawPlan);
  const planJobs = parsed.plan?.jobs || [];
  // ★ review fix (#1): ประเมินสถานะ "ทุกงานใน plan" (รวมงานที่โพสต์ JV ไปแล้ว = หลุดจาก candidate)
  const planStates = new Map();
  for (const pj of planJobs) {
    const job = S.jobById.get(String(pj.sourceId));
    if (!job) { planStates.set(String(pj.sourceId), { state: R.PLAN_JOB_STATES.CONFLICT, problems: ["JOB_NOT_FOUND"] }); continue; }
    const rec = R.validateRecognitionAt(pj.recognitionAt);
    const acc = accountsFor(S, job);
    const st = R.classifyPlanJobState({
      job, entries: S.entriesByJob.get(String(job.id)) || [], linesByEntry: S.linesByEntry,
      planJob: pj, expectedAccounts: acc.ok ? acc : null,
      expectedDocDate: rec.ok ? rec.docDate : null,
      expectedClosedAtIso: rec.ok ? rec.iso : null            // ★ verified ต้องมี closed_at = วันที่ owner อนุมัติ
    });
    planStates.set(String(pj.sourceId), st);
  }
  const liveCandidateIds = S.rows.map(r => String(r.jobId));
  const drift = parsed.plan
    ? R.planBaselineMatches({ plan: parsed.plan, planStates, liveCandidateIds })
    : { ok: false, errors: ["PLAN_UNREADABLE"], counts: { verified: 0, pending: 0, conflict: 0 } };
  const planErrors = [...parsed.errors, ...drift.errors];

  console.log(`## Preflight`);
  console.log(`- plan: schemaVersion ${rawPlan?.schemaVersion ?? "-"} · approvedBy **${String(rawPlan?.approvedBy || "-").slice(0, 40)}** · jobs ${planJobs.length}`);
  console.log(`- plan-job state: **VERIFIED_COMPLETE ${drift.counts.verified} · PENDING_RECOVERY ${drift.counts.pending} · CONFLICT ${drift.counts.conflict}**`);
  console.log(`- plan/baseline: ${planErrors.length ? "❌ " + planErrors.join(" · ") : "✅ ตรง (verified+pending) และไม่มีงาน NO_JV ใหม่นอก plan"}`);
  console.log(`- data completeness: ${S.stockDataIncomplete ? "❌ stock movements DATA_INCOMPLETE" : "✅"} · partition ${S.summary.partitionOk ? "✅" : "❌"}`);
  console.log(`- locked periods: ${S.lockedPeriods.size ? [...S.lockedPeriods].join(", ") : "ไม่มี"}`);

  const rowById = new Map(S.rows.map(r => [String(r.jobId), r]));
  // preflight เฉพาะงานที่ยังต้องซ่อม (PENDING_RECOVERY) — VERIFIED_COMPLETE ข้าม, CONFLICT ถูก block ที่ planErrors แล้ว
  const preflight = planJobs
    .filter(pj => planStates.get(String(pj.sourceId))?.state === R.PLAN_JOB_STATES.PENDING_RECOVERY)
    .map(pj => {
      const job = S.jobById.get(String(pj.sourceId));
      const row = rowById.get(String(pj.sourceId));
      const rr = row
        ? R.computeRecoveryReadiness({ classified: row, planJob: pj, job, lockedPeriods: S.lockedPeriods })
        : { ok: false, blockers: ["NOT_A_CANDIDATE_ANYMORE"], docDate: null, resumeState: null };
      return { row, job, planJob: pj, rr };
    });

  const verified = planJobs.filter(pj => planStates.get(String(pj.sourceId))?.state === R.PLAN_JOB_STATES.VERIFIED_COMPLETE);
  if (verified.length) {
    console.log(`\n## ✅ งานที่ซ่อมไปแล้วและ verify ผ่าน (ข้าม — ไม่เขียนซ้ำ): ${verified.length} งาน`);
    for (const pj of verified) console.log(`- ${pj.expectedJobNo} · ${money(pj.expectedAmount)} · JE ${planStates.get(String(pj.sourceId))?.entryId}`);
  }

  console.log(`\n## Preflight ต่อ job (ที่ยังต้องซ่อม)`);
  console.log("| job_no | amount | stock verdict | plan recognition (BKK) | stock decision | resume | preflight |");
  console.log("|---|---:|---|---|---|---|---|");
  for (const p of preflight) {
    console.log(`| ${p.planJob.expectedJobNo} | ${money(p.planJob.expectedAmount)} | ${p.row?.stock.verdict || "-"} | ${p.rr.docDate || "**ไม่มี/ไม่ผ่าน**"} | ${p.planJob.stockDecision} | ${p.rr.resumeState || "-"} | ${p.rr.ok ? "✅ พร้อม" : "❌ " + p.rr.blockers.join(", ")} |`);
  }

  const notReady = preflight.filter(p => !p.rr.ok);
  const stockDeferred = preflight.filter(p => ["STOCK_RECOVERY_REQUIRED", "UNRESOLVED"].includes(p.planJob?.stockDecision || ""));
  if (stockDeferred.length) {
    console.log(`\n## ⚠️ งานที่ต้องแยกไป stock recovery phase (ไม่ทำใน PR นี้): ${stockDeferred.length} งาน`);
    for (const p of stockDeferred) console.log(`- ${p.planJob.expectedJobNo} · ${p.row?.stock.verdict} · owner: ${p.planJob.stockDecision}`);
  }

  const preflightOk = planErrors.length === 0 && notReady.length === 0 && !S.stockDataIncomplete && S.summary.partitionOk;
  console.log(`\n**Preflight รวม: ${preflightOk ? `✅ ผ่านทุกงาน (จะซ่อม ${preflight.length} งาน · ข้ามที่ทำแล้ว ${verified.length} งาน)` : `❌ ไม่ผ่าน (${notReady.length}/${preflight.length} งานยังไม่พร้อม${planErrors.length ? " + plan/baseline error" : ""})`}**`);

  if (!APPLY) {
    console.log(`\n─── จบ preview (ไม่มีการแก้ข้อมูล) ───`);
    console.log(`_apply ต้องใช้: \`--apply --confirm=${R.CONFIRM_TOKEN}\` และ preflight ต้องผ่านทุกงานก่อน_`);
    // ★ review fix (#4): ตั้งใจ apply แต่ธงไม่ครบ → exit 1 (ไม่ใช่ preview exit 0)
    if (APPLY_INTENT_INVALID) { console.log(`\n⛔ --apply ต้องมาพร้อม --confirm=${R.CONFIRM_TOKEN} → ไม่มีการเขียนข้อมูล (exit 1)`); return 1; }
    if (STRICT && !preflightOk) { console.log(`\n⚠️ --strict: preflight ไม่ผ่าน → exit 1`); return 1; }
    return 0;
  }

  // ── APPLY ──
  if (!preflightOk) {
    console.log(`\n⛔ APPLY ถูกปฏิเสธ: preflight ไม่ผ่าน → **ไม่มีการเขียนข้อมูลแม้แต่งานเดียว** (exit 1)`);
    return 1;
  }
  console.log(`\n## APPLY (${preflight.length} งาน — sequential, stop ที่ความล้มเหลวแรก)`);
  const writer = await loadCanonicalWriter(token);
  const done = [];
  for (const p of preflight) {
    const { row, job, planJob, rr } = p;
    const rec = R.validateRecognitionAt(planJob.recognitionAt);
    const label = row.jobNo || row.jobId;

    // A) closed_at (CAS) — resume: ถ้าเท่ากับ plan อยู่แล้วไม่ PATCH ซ้ำ
    if (rr.resumeState === "FRESH") {
      const cas = await casSetClosedAt(token, job, rec.iso, planJob.expectedStatus, planJob.expectedAmount);
      if (!cas.won) {
        console.log(`- ❌ ${label}: CAS PATCH closed_at ไม่สำเร็จ (${cas.error || "0 row — งานถูกแก้ระหว่างทาง"}) → STOP, ไม่โพสต์ JV`);
        console.log(`\n⛔ หยุดที่ความล้มเหลวแรก · เขียนสำเร็จก่อนหน้า: ${done.length} งาน → exit 2`);
        return 2;
      }
      console.log(`- ✅ ${label}: closed_at ← ${rec.docDate} (CAS ผ่าน)`);
    } else {
      console.log(`- ↻ ${label}: closed_at ตรง plan อยู่แล้ว → resume (ไม่ PATCH ซ้ำ)`);
    }

    // B) อ่าน row จริงกลับมา → ★ review fix (#2): revalidate snapshot ก่อนเรียก writer
    const fullJob = await fetchJobForWriter(token, job.id);
    if (!fullJob) { console.log(`- ❌ ${label}: อ่าน row หลัง PATCH ไม่ได้ → STOP (exit 2)`); return 2; }
    const snap = R.revalidateJobSnapshot({ before: job, after: fullJob, planJob, expectedClosedAtIso: rec.iso });
    if (!snap.ok) {
      console.log(`- ❌ ${label}: row เปลี่ยนระหว่างทาง (${snap.diffs.join(", ")}) → **ไม่เรียก writer** · STOP (exit 2)`);
      return 2;
    }
    const acc = accountsFor(S, fullJob);
    if (!acc.ok) { console.log(`- ❌ ${label}: mapping (${acc.mappingKey}) ไม่ครบ → ไม่เรียก writer · STOP (exit 2)`); return 2; }
    const res = await writer.postJournalForServiceJob(fullJob, { detailed: true });
    const st = String(res?.status || "");
    if (st === "failed") {
      console.log(`- ❌ ${label}: writer ล้ม (${res?.reason || "unknown"}) — **closed_at ถูกเขียนแล้ว ห้าม rollback** (เป็นวันที่ owner อนุมัติ)`);
      console.log(`  → CLOSED_AT_SET_JV_MISSING · rerun คำสั่งเดิมจะ resume งานนี้ได้ (idempotent)`);
      console.log(`\n⛔ STOP ที่ความล้มเหลวแรก · สำเร็จก่อนหน้า ${done.length} งาน → exit 2`);
      return 2;
    }
    // ★ duplicate/skip ก็ยังต้อง read-back verify ก่อนนับว่าสำเร็จ (ห้ามเชื่อ writer อย่างเดียว)
    //   บัญชีที่คาดหวัง = mapping ของงานนี้เท่านั้น (exact — ไม่ใช่ union ของทุก mapping)
    const v = await readBackVerify(token, job, rr.docDate, planJob.expectedAmount, acc);
    if (!v.ok) {
      console.log(`- ❌ ${label}: post-write verify ไม่ผ่าน → ${v.problems.join(", ")}`);
      console.log(`\n⛔ STOP · สำเร็จก่อนหน้า ${done.length} งาน → exit 2`);
      return 2;
    }
    console.log(`- ✅ ${label}: JV ${st === "posted" ? "posted" : st} + verify ผ่าน (JE ${v.entryId} · doc_date ${rr.docDate} · ${money(planJob.expectedAmount)})`);
    done.push(label);
  }

  console.log(`\n✅ APPLY สำเร็จครบ ${done.length}/${preflight.length} งาน (closed_at + JV + read-back verify ผ่านทุกงาน)`);
  console.log(`- **ไม่ได้แตะสต็อกเลย** — งานที่หลักฐานสต็อกไม่ครบต้องทำใน stock recovery phase แยก`);
  console.log(`- ตรวจซ้ำ: \`npm run verify:reconcile -- ${MONTHS.join(" ")}\` และ \`npm run verify:service-no-jv -- ${MONTHS.join(" ")}\``);
  return 0;
}

main().then((code) => process.exit(code || 0)).catch((e) => fatal(e?.stack || String(e)));
