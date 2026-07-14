// ═══════════════════════════════════════════════════════════
//  service_no_jv_classify.js — Phase 604 (S4.1b) RUNNER (READ-ONLY)
//  จำแนกงานบริการที่ยังไม่มี JV (service NO_JV) เป็นรายงาน "ต่อ job" — หลักฐานบัญชี / วันรับรู้รายได้ /
//  หลักฐานสต็อก — เพื่อให้ owner ตัดสินใจก่อนออกแบบ recovery ใน S4.1c
//
//  ★ READ-ONLY เด็ดขาด: POST มีจุดเดียว = /auth/v1/token (login). ทุก /rest/v1/ = GET.
//    ห้าม PATCH/PUT/DELETE/RPC-mutate/Prefer:resolution. เจอปัญหา = ลงรายงานเท่านั้น ห้ามซ่อม.
//  ★ ไฟล์นี้ไม่มี recovery code: ไม่เรียก postJournalForServiceJob, ไม่แตะ stock, ไม่เขียน closed_at
//  ★ PII: ห้าม print customer_name/phone/address/slip URL/note ดิบ (movement note มีชื่อลูกค้าอยู่)
//
//  Usage: node scripts/service_no_jv_classify.js [YYYY-MM ...] [--strict]
//         npm run verify:service-no-jv -- 2026-07 2026-06 [--strict]
//  Env (.env): SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
//  Exit: 0 = รันจบ (report-only; การพบ candidate ไม่ใช่ process failure)
//        1 = --strict + มี candidate ที่ยังมี recovery blocker / ข้อมูลโหลดไม่ครบ (คาดว่าแดงจนกว่า
//            owner จะเลือกวันรับรู้รายได้ — ห้ามผ่อน gate เพื่อให้เขียว)
//        2 = fatal (env/network/schema)
// ═══════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import * as L from "./finance_reconcile_lib.js";
import * as C from "./service_no_jv_classify_lib.js";

// ── env (pattern เดียวกับ finance_reconcile_audit.js) ──
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
function fatal(msg) { console.error("[fatal] " + msg); process.exit(2); }   // ★ ห้าม print token/password ในข้อความ

const env = loadEnv(path.resolve(".env"));
if (!env) fatal(".env not found — ต้องมี SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");
const URL_BASE = (env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;
const AD_EMAIL = env.ADMIN_EMAIL, AD_PASS = env.ADMIN_PASSWORD;
if (!URL_BASE || !ANON || !AD_EMAIL || !AD_PASS) fatal("env ไม่ครบ: ต้องมี SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");

// ── auth: จุด POST เดียวของทั้งไฟล์ ──
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

// ── GET + pagination (PostgREST cap 1000 เงียบ → loop offset). MAX_PAGES = safety net:
//    ถ้าชนเพดาน = ข้อมูลอาจไม่ครบ → คืน { rows, incomplete:true } ห้าม fallback เป็น array ว่าง/ศูนย์ ──
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
    if (pages >= MAX_PAGES) { incomplete = true; break; }   // ตัด = DATA_INCOMPLETE (ไม่เงียบ)
    offset += PAGE;
  }
  return { rows: out, incomplete };
}
async function getAll(token, pathAndQuery) { return (await getAllChecked(token, pathAndQuery)).rows; }
async function getByIn(token, table, select, col, ids, chunk = 100, extra = "") {
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  let out = [];
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk).map(encodeURIComponent).join(",");
    out = out.concat(await getAll(token, `${table}?select=${select}&${col}=in.(${part})${extra}`));
  }
  return out;
}

// ── args ──
function defaultMonths() {
  const now = L.bkkDate(new Date());
  const [y, m] = now.split("-").map(Number);
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [cur, pm];
}
const argv = process.argv.slice(2);
const months = argv.filter(a => /^\d{4}-\d{2}$/.test(a));
const AUDIT_MONTHS = months.length ? months : defaultMonths();
const STRICT = argv.includes("--strict");
// baseline drift check (optional — ห้าม hardcode ตัวเลข business ใน classifier/test):
//   --expect-count=N --expect-amount=X  → ไม่ตรง = BASELINE_DRIFT (strict fail) ให้ STOP ทบทวนก่อน S4.1c
const expectCountArg = argv.find(a => a.startsWith("--expect-count="));
const expectAmountArg = argv.find(a => a.startsWith("--expect-amount="));
const EXPECT_COUNT = expectCountArg ? Number(expectCountArg.split("=")[1]) : null;
const EXPECT_AMOUNT = expectAmountArg ? Number(expectAmountArg.split("=")[1]) : null;

function monthWindow(month) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(Date.UTC(y, m, 1)); end.setUTCDate(end.getUTCDate() + 1);
  return { fromTs: start.toISOString(), toTs: end.toISOString() };
}
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ★ service_jobs select — ห้ามใส่ deleted_at (production ไม่มีคอลัมน์นี้ → 42703/400)
//   ห้าม select customer_name/phone/address/payment_slip_url (PII ที่ไม่จำเป็นต่อการจำแนก)
const SJ_SELECT_BASE = "id,job_no,job_type,status,created_at,closed_at,total_cost,payment_method,sub_service,note,items_json,stock_deducted_at,stock_reverted_at";
// ★ Phase 606-a: metadata ใหม่ (source_kind / finance_flow_version) — จะมีก็ต่อเมื่อ owner รัน migration แล้ว
//   จึงต้อง probe ก่อน: ยังไม่มีคอลัมน์ = fallback ไป marker เดิม (สคริปต์ต้องรันได้ทั้งก่อน/หลัง migration)
const SJ_META = "source_kind,finance_flow_version";
let SJ_SELECT = SJ_SELECT_BASE;
let META_AVAILABLE = false;

// ★ fail-closed: fallback ได้เฉพาะเมื่อยืนยันว่าคอลัมน์ไม่มีจริง — ตัวตัดสินอยู่ใน finance_reconcile_lib
//   (L.isMissingMetaColumnError); 404 หรือ 400 สาเหตุอื่น = fatal exit 2
async function probeMetaColumns(token) {
  const r = await fetch(`${URL_BASE}/rest/v1/service_jobs?select=id,${SJ_META}&limit=1`, { method: "GET", headers: authH(token) });
  if (r.ok) { META_AVAILABLE = true; SJ_SELECT = `${SJ_SELECT_BASE},${SJ_META}`; return true; }
  const body = await r.text().catch(() => "");
  if (L.isMissingMetaColumnError(r.status, body)) return false;   // ยังไม่ได้รัน migration 606-a → fallback marker
  fatal(`probe metadata columns → HTTP ${r.status}: ${body.slice(0, 200)}`);
}

async function main() {
  const token = await signIn(AD_EMAIL, AD_PASS);
  await probeMetaColumns(token);   // ★ 606-a metadata มีหรือยัง (ยังไม่มี = fallback marker)

  // 1) service_jobs ในหน้าต่างเดือนที่ตรวจ (created + closed window แล้ว dedupe ด้วย id)
  const jobsMap = new Map();
  for (const month of AUDIT_MONTHS) {
    const w = monthWindow(month);
    const created = await getAll(token, `service_jobs?select=${SJ_SELECT}&created_at=gte.${w.fromTs}&created_at=lt.${w.toTs}`);
    const closed = await getAll(token, `service_jobs?select=${SJ_SELECT}&closed_at=gte.${w.fromTs}&closed_at=lt.${w.toTs}`);
    for (const j of [...created, ...closed]) jobsMap.set(String(j.id), j);
  }
  const jobs = [...jobsMap.values()];

  // 2) mapping ที่ใช้ได้จริง ณ วัน audit (active + มี debit/credit ครบ)
  const mappings = await getAll(token, "account_mapping?select=mapping_key,debit_account_code,credit_account_code,transfer_debit_code,is_active&is_active=eq.true");
  const validMappingKeys = new Set(mappings.filter(m => m.debit_account_code && m.credit_account_code).map(m => m.mapping_key));

  // 3) JE ที่ผูก source = service_jobs (ทุก status — ต้องเห็น draft/void ด้วย ห้ามกรองเหลือ approved)
  const jeAll = await getByIn(token, "journal_entries", "id,doc_date,status,total_debit,total_credit,source_table,source_id", "source_id", jobs.map(j => j.id));
  const entriesByJob = new Map();
  for (const je of jeAll) {
    if (je.source_table !== "service_jobs") continue;   // source_id ตรงแต่คนละตาราง = ไม่ใช่ของงานนี้
    const k = String(je.source_id);
    if (!entriesByJob.has(k)) entriesByJob.set(k, []);
    entriesByJob.get(k).push(je);
  }
  const boundEntries = [...entriesByJob.values()].flat();
  const lines = await getByIn(token, "journal_lines", "entry_id,account_code,debit,credit", "entry_id", boundEntries.map(e => e.id));
  const linesByEntry = new Map();
  for (const l of lines) { const k = String(l.entry_id); if (!linesByEntry.has(k)) linesByEntry.set(k, []); linesByEntry.get(k).push(l); }

  // 4) candidates = service income (non-web, ไม่ลบ, total_cost>0) ที่ยังไม่มี approved JV ผูก source
  const incomeJobs = jobs.filter(j => C.isServiceIncomeCandidate(j));
  const candidates = incomeJobs.filter(j => {
    const es = entriesByJob.get(String(j.id)) || [];
    return !es.some(e => String(e.status || "").toLowerCase() === "approved");
  });
  // งานที่ถูกคัดออก + เหตุผล (transparency — ห้ามหายเงียบ)
  //   ★ PRE_EFFECTIVE_EXPECTED_UNPOSTED = ตั้งใจไม่ลง JV (ก่อน 1 ก.ค.) — S4.0 ก็ไม่นับเป็น NO_JV
  const excluded = jobs
    .filter(j => !C.isServiceIncomeCandidate(j))
    .map(j => ({
      id: j.id, jobNo: j.job_no, amount: L.round2(j.total_cost),
      reason: C.isServiceJobDeletedOrCancelled(j) ? "DELETED_OR_CANCELLED"
        : (j.total_cost === null || j.total_cost === undefined) ? "NULL_AMOUNT"
          : (Number(j.total_cost) === 0 ? "ZERO_AMOUNT"
            : (!["done", "delivered", "closed"].includes(String(j.status || "").toLowerCase()) ? "NOT_INCOME_STATUS"
              : (C.preliminaryBasisDateForScoping(j) < L.ACCOUNTING_EFFECTIVE_DATE ? "PRE_EFFECTIVE_EXPECTED_UNPOSTED"
                : "WEB_ORDER_OR_OTHER")))
    }));

  // 5) products metadata (เฉพาะที่ items_json อ้างถึง) — ไม่ดึงชื่อเกินจำเป็น (ใช้จำแนก stockable เท่านั้น)
  const productIds = new Set();
  for (const j of candidates) {
    const p = C.parseItemsJson(j.items_json);
    for (const it of p.items) if (it?.product_id !== null && it?.product_id !== undefined) productIds.add(String(it.product_id));
  }
  const products = productIds.size ? await getByIn(token, "products", "id,product_type", "id", [...productIds]) : [];
  const productMap = new Map(products.map(p => [String(p.id), p]));

  // 6) stock_movements — หน้าต่างครอบ candidate (created_at เร็วสุด −1 วัน) ทั้ง out และ return
  let movements = [], stockDataIncomplete = false;
  if (candidates.length) {
    const minTs = candidates.reduce((min, j) => {
      const t = new Date(j.created_at).getTime();
      return Number.isFinite(t) && t < min ? t : min;
    }, Number.POSITIVE_INFINITY);
    const from = new Date((Number.isFinite(minTs) ? minTs : Date.now()) - 86400000).toISOString();
    const res = await getAllChecked(token, `stock_movements?select=id,product_id,type,qty,note,created_at&created_at=gte.${from}&type=in.(out,return)`);
    movements = res.rows;
    stockDataIncomplete = res.incomplete;   // ถูกตัด → stock dimension = DATA_INCOMPLETE (ห้าม fallback 0)
  }

  // 7) classify ต่อ job
  const rows = candidates.map(job => C.classifyServiceNoJvCandidate({
    job,
    entries: entriesByJob.get(String(job.id)) || [],
    linesByEntry,
    validMappingKeys,
    productMap,
    movements,
    stockDataIncomplete
  }));
  const S = C.summarizeClassification(rows);

  // ── report ──
  console.log(`# Service NO_JV — Recovery Evidence Classification (S4.1b / Phase 604)\n`);
  console.log(`- effective date: **${L.ACCOUNTING_EFFECTIVE_DATE}** · **READ-ONLY** (ไม่มีการแก้ข้อมูล / ไม่โพสต์ JV / ไม่แตะสต็อก)`);
  console.log(`- months: ${AUDIT_MONTHS.join(", ")}${STRICT ? " · --strict" : " · report-only"}`);
  console.log(`- generated: ${L.bkkDate(new Date())} (Bangkok)`);
  console.log(`- scope: จำแนกหลักฐานเท่านั้น — **การซ่อม (post JV / แก้สต็อก) = S4.1c ยังไม่เริ่ม**\n`);
  console.log(`_fetched: service_jobs ${jobs.length} · income (non-web, ไม่ลบ, >0) ${incomeJobs.length} · source-bound JE ${boundEntries.length} · movements(out/return) ${movements.length}${stockDataIncomplete ? " ⚠️ INCOMPLETE" : ""} · active mappings ${validMappingKeys.size}_\n`);

  // ── Phase 606-a: source identity partition (แหล่งกำเนิดงาน — ไม่ขึ้นกับสถานะ) ──
  const idn = { service: 0, web_order: 0, invalid: 0, fromDb: 0, fromMarker: 0 };
  const invalidIds = [];
  for (const j of jobs) {
    const s = L.serviceJobSourceKindOf(j, META_AVAILABLE);
    if (s.from === "invalid") { idn.invalid += 1; if (invalidIds.length < 20) invalidIds.push(j.job_no || j.id); continue; }
    idn[s.kind] += 1;
    if (s.from === "db") idn.fromDb += 1; else idn.fromMarker += 1;
  }
  // ★ metadata มีแล้ว → flow version ต้อง valid ด้วย (null/3/ขยะ = DATA_INCOMPLETE, ห้ามเดา)
  let badFlow = 0;
  const badFlowIds = [];
  if (META_AVAILABLE) {
    for (const j of jobs) {
      if (C.financeFlowVersionOf(j) === null) { badFlow += 1; if (badFlowIds.length < 20) badFlowIds.push(j.job_no || j.id); }
    }
  }
  const sourceKindDataIncomplete = idn.invalid > 0 || badFlow > 0;
  console.log(`## Source identity + finance flow (Phase 606-a metadata)`);
  console.log(`- metadata columns (\`source_kind\`/\`finance_flow_version\`): **${META_AVAILABLE ? "มีแล้ว (อ่านจาก DB)" : "ยังไม่มี → fallback marker เดิม (owner ยังไม่รัน migration 606-a)"}**`);
  console.log(`- partition: service **${idn.service}** · web_order **${idn.web_order}** · invalid **${idn.invalid}** (รวม ${jobs.length} งาน) · จาก DB ${idn.fromDb} · จาก marker ${idn.fromMarker}`);
  if (idn.invalid > 0) {
    console.log(`- ⚠️ **DATA_INCOMPLETE: source_kind ไม่ถูกต้อง ${idn.invalid} งาน** (${invalidIds.join(", ")}${idn.invalid > 20 ? " …" : ""}) — ห้ามตีความเป็น service เงียบ ๆ`);
  }
  if (badFlow > 0) {
    console.log(`- ⚠️ **DATA_INCOMPLETE: finance_flow_version ไม่ถูกต้อง ${badFlow} งาน** (${badFlowIds.join(", ")}${badFlow > 20 ? " …" : ""}) — ต้องเป็น 1 หรือ 2 เท่านั้น`);
  }
  console.log("");

  // ── Phase 606-0: finance-flow taxonomy ของงานบริการทั้งชุด (ไม่ใช่แค่ candidate) ──
  const flow = C.summarizeServiceFlow(jobs, entriesByJob);
  console.log(`## Finance-flow taxonomy (งานบริการ income status, non-web, ไม่ลบ — ${flow.scanned} งาน)`);
  console.log("| state | งาน | ยอด | ความหมาย |");
  console.log("|---|---:|---:|---|");
  const F = flow.states;
  console.log(`| PRE_EFFECTIVE_EXPECTED_UNPOSTED | ${F.PRE_EFFECTIVE_EXPECTED_UNPOSTED.count} | ${money(F.PRE_EFFECTIVE_EXPECTED_UNPOSTED.amount)} | ปิดงานก่อน ${L.ACCOUNTING_EFFECTIVE_DATE} → **ตั้งใจไม่ลง JV (ไม่ใช่ปัญหา)** |`);
  console.log(`| LEGACY_FLOW_V1_POSTED | ${F.LEGACY_FLOW_V1_POSTED.count} | ${money(F.LEGACY_FLOW_V1_POSTED.amount)} | งานเก่า มี JV แล้ว (กติกาเดิม Dr เงินสด/ธนาคาร) — **ห้ามแตะ/ห้าม re-post** |`);
  console.log(`| LEGACY_FLOW_V1_NO_JV | ${F.LEGACY_FLOW_V1_NO_JV.count} | ${money(F.LEGACY_FLOW_V1_NO_JV.amount)} | งานเก่า **ยังไม่มี JV = รายได้ยังไม่ลงบัญชี (ปัญหา)** |`);
  console.log(`| FLOW_V2_POSTED | ${F.FLOW_V2_POSTED.count} | ${money(F.FLOW_V2_POSTED.amount)} | งานตามกติกา 606 (Dr 1200 ลูกหนี้) ลง JV แล้ว |`);
  console.log(`| FLOW_V2_NO_JV | ${F.FLOW_V2_NO_JV.count} | ${money(F.FLOW_V2_NO_JV.amount)} | งานตามกติกา 606 **ยังไม่ลง JV (ปัญหา)** |`);
  console.log(`| DATA_INCOMPLETE_METADATA | ${F.DATA_INCOMPLETE_METADATA.count} | ${money(F.DATA_INCOMPLETE_METADATA.amount)} | **metadata เพี้ยน (flow version ไม่ใช่ 1/2) — ห้ามเดา** |`);
  console.log(`\n- **ที่ยังเป็นปัญหา (รายได้ยังไม่ลงบัญชี): ${flow.problemCount} งาน · ${money(flow.problemAmount)} บาท** · partition ${flow.partitionOk ? "✅" : "⚠️ ไม่ครบ"}`);
  console.log(META_AVAILABLE
    ? `- _finance_flow_version อ่านจาก DB (ค่าที่ไม่ใช่ 1/2 = DATA_INCOMPLETE_METADATA — ไม่ถูกเดา)_\n`
    : `- _finance_flow_version ยังไม่มีในสคีมา (มาใน Phase 606-a) → ทุกงานตอนนี้ถูกนับเป็น v1 โดยนิยาม_\n`);

  console.log(`## สรุป`);
  console.log(`- **candidate (service income ที่ยังไม่มี approved JV): ${S.candidateCount} งาน · รวม ${money(S.candidateAmount)} บาท**`);
  console.log(`- **readiness (แยก track — journal พร้อม ≠ ทั้งงานพร้อม):**`);
  console.log(`  - journal recovery eligible (หลักฐาน GL พร้อมโพสต์): **${S.journalEligibleCount}/${S.candidateCount}**`);
  console.log(`  - stock review required (ยังต้องตรวจ/ตัดสินใจฝั่งสต็อก): **${S.stockReviewRequiredCount}/${S.candidateCount}**`);
  console.log(`  - owner confirmation pending (ยังไม่ยืนยันวันรับรู้รายได้): **${S.ownerConfirmationPendingCount}/${S.candidateCount}**`);
  console.log(`  - **overall S4.1c ready (ครบทั้งสามมิติ): ${S.overallReadyCount}/${S.candidateCount}**`);
  console.log(`- journal taxonomy: ${Object.entries(S.journalCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"}`);
  console.log(`- stock taxonomy: ${Object.entries(S.stockCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"}`);
  console.log(`- blockers: ${Object.entries(S.blockerCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "ไม่มี"}`);
  console.log(`- VAT: **VAT_BASIS_NOT_SEPARATELY_EVIDENCED** — service_jobs ไม่มี field VAT และ writer ไม่แยก → amount basis = total_cost ตามที่ writer ใช้ (informational; ห้ามคำนวณ VAT ขึ้นเอง)`);

  // per-job table
  console.log(`\n## รายงานต่อ job (accounting)`);
  console.log("| job_no | type | status | created (BKK) | closed (BKK) | total_cost | pay | mapping | JE approved/non | GL rev | Δ | journal verdict | blockers |");
  console.log("|---|---|---|---|---:|---|---|---|---:|---:|---|---|");
  for (const r of rows) {
    const d = r.journal.detail;
    console.log(`| ${r.jobNo || r.jobId} | ${r.jobType || "-"} | ${r.status} | ${r.recognition.createdBkk || "-"} | ${r.recognition.closedBkk || "**null**"} | ${money(d.opAmount)} | ${r.paymentMethod || "-"} | ${d.mappingKey} (${d.mappingStatus}) | ${d.approvedCount}/${d.nonApprovedCount} | ${d.glRevenue === null ? "-" : money(d.glRevenue)} | ${d.delta === null ? "-" : money(d.delta)} | ${r.journal.verdict} | ${r.blockers.join(", ") || "-"} |`);
  }

  console.log(`\n## รายงานต่อ job (stock evidence)`);
  console.log("| job_no | items | stockable/nonstock/unusable/missing-meta | expected qty | stock_deducted_at | stock_reverted_at | out mv/qty | return mv/qty | stock verdict | flags |");
  console.log("|---|---|---|---:|---|---|---|---|---|---|");
  for (const r of rows) {
    const e = r.stock.evidence, x = r.stock.expected;
    console.log(`| ${r.jobNo || r.jobId} | ${e.itemsState} | ${x.stockableItemCount ?? 0}/${x.nonStockItemCount ?? 0}/${x.unusableItemCount ?? 0}/${x.missingMetaItemCount ?? 0} | ${x.expectedQty ?? 0} | ${e.stockDeductedAt ? "yes" : "null"} | ${e.stockRevertedAt ? "yes" : "null"} | ${e.outMovementCount ?? 0}/${e.outQty ?? 0} | ${e.returnMovementCount ?? 0}/${e.returnQty ?? 0} | ${r.stock.verdict} | ${r.stock.flags.join(", ") || "-"} |`);
  }

  console.log(`\n## Owner decision table (วันรับรู้รายได้ — ระบบเลือกให้เองไม่ได้)`);
  console.log("| job_no | system created | system closed | owner recognition date | amount basis | journal blockers | journal eligible | stock verdict | stock review | **overall S4.1c ready** |");
  console.log("|---|---|---|---|---:|---|---|---|---|---|");
  for (const r of rows) {
    const R = r.readiness;
    console.log(`| ${r.jobNo || r.jobId} | ${r.recognition.createdBkk || "-"} | ${r.recognition.closedBkk || "**ไม่มี**"} | **${r.recognition.ownerRecognitionDate}** | ${money(r.journal.detail.opAmount)} (total_cost) | ${r.blockers.join(", ") || "-"} | ${R.journalRecoveryEligible ? "YES" : "NO"} | ${r.stock.verdict} | ${R.stockReviewRequired ? "REQUIRED" : "clear"} | **${R.overallS41cReady ? "YES" : "NO"}** — ${R.reason} |`);
  }

  if (excluded.length) {
    console.log(`\n## งานที่ถูกคัดออกจาก candidate (exclusion reasons — ไม่หายเงียบ)`);
    const hist = {};
    for (const x of excluded) {
      if (!hist[x.reason]) hist[x.reason] = { n: 0, amt: 0 };
      hist[x.reason].n += 1;
      hist[x.reason].amt = L.round2(hist[x.reason].amt + (Number(x.amount) || 0));
    }
    for (const [k, v] of Object.entries(hist)) console.log(`- ${k}: ${v.n} งาน (${money(v.amt)} บาท)`);
    console.log(`- _PRE_EFFECTIVE_EXPECTED_UNPOSTED = ปิดงานก่อน ${L.ACCOUNTING_EFFECTIVE_DATE} → ตั้งใจไม่ลง JV (S4.0 ก็ไม่นับเป็น NO_JV) — ไม่ใช่ recovery candidate_`);
  }

  // ── partition self-check ──
  console.log(`\n## Self-check (กันงานตกหล่น/นับซ้ำ)`);
  console.log(`- candidate ${S.candidateCount} · journal taxonomy รวม ${S.journalSum} · stock taxonomy รวม ${S.stockSum} → ${S.partitionOk ? "✅ ครบ ไม่ซ้ำ" : "⚠️ ไม่ครบ — มีงานตกหล่น/นับซ้ำ"}`);
  console.log(`- data completeness: movements ${stockDataIncomplete ? "⚠️ **DATA_INCOMPLETE** (fetch ถูกตัด)" : "✅ ครบ (paginate จนหมด)"}`);
  console.log(`- ⚠️ ข้อจำกัดที่ต้องรู้ก่อนตัดสินใจ: movement log เป็น **best-effort** ("ไม่พบหลักฐาน movement" ≠ "ไม่ได้ตัดสต็อก") · \`stock_movements\` **ไม่มี warehouse_id** (qty ตรงก็ยืนยันคลังไม่ได้) · \`stock_deducted_at\` เป็น claim ระดับทั้งงาน จึงอาจซ่อน partial success`);

  // baseline drift (ถ้า owner ส่งค่าที่คาดไว้มา)
  let driftFail = false;
  if (EXPECT_COUNT !== null || EXPECT_AMOUNT !== null) {
    const cOk = EXPECT_COUNT === null || EXPECT_COUNT === S.candidateCount;
    const aOk = EXPECT_AMOUNT === null || Math.abs(EXPECT_AMOUNT - S.candidateAmount) < 0.01;
    if (!cOk || !aOk) {
      driftFail = true;
      console.log(`\n⚠️ **BASELINE_DRIFT** — คาด ${EXPECT_COUNT ?? "-"} งาน / ${EXPECT_AMOUNT !== null ? money(EXPECT_AMOUNT) : "-"} แต่พบ ${S.candidateCount} งาน / ${money(S.candidateAmount)} → **STOP** ทบทวนก่อนออกแบบ S4.1c (ห้ามฝืนเลือกเฉพาะ id เดิม)`);
    } else {
      console.log(`- baseline: ตรงกับที่คาด (${S.candidateCount} งาน / ${money(S.candidateAmount)}) ✅`);
    }
  } else {
    console.log(`- baseline: ไม่ได้ระบุ --expect-count/--expect-amount → เทียบเองกับ \`npm run verify:reconcile\` (service NO_JV) ก่อนใช้ผลนี้`);
  }

  console.log(`\n─── จบรายงาน (read-only — ไม่มีการแก้ข้อมูล; S4.1c ยังไม่เริ่ม) ───`);

  // ── strict gate ──
  //   ★ ต้องแดงเมื่อ **overall** ยังไม่พร้อม — journal track พร้อมอย่างเดียวไม่พอ (สต็อก/วันรับรู้ยังค้าง)
  const notOverallReady = rows.filter(r => !r.readiness.overallS41cReady);
  const journalBlocked = rows.filter(r => !r.readiness.journalRecoveryEligible);
  const stockPending = rows.filter(r => r.readiness.stockReviewRequired);
  const ownerPending = rows.filter(r => r.readiness.ownerConfirmationPending);
  if (STRICT) {
    const reasons = [];
    if (notOverallReady.length) reasons.push(`overall ยังไม่พร้อม ${notOverallReady.length}/${S.candidateCount} งาน`);
    if (journalBlocked.length) reasons.push(`journal blocker ${journalBlocked.length}`);
    if (stockPending.length) reasons.push(`stock review required ${stockPending.length}`);
    if (ownerPending.length) reasons.push(`owner recognition-date confirmation pending ${ownerPending.length}`);
    if (stockDataIncomplete) reasons.push("stock movements DATA_INCOMPLETE");
    if (idn.invalid > 0) reasons.push(`source_kind DATA_INCOMPLETE ${idn.invalid} งาน`);           // ★ 606-a
    if (badFlow > 0) reasons.push(`finance_flow_version DATA_INCOMPLETE ${badFlow} งาน`);
    if (flow.dataIncompleteCount > 0) reasons.push(`flow taxonomy DATA_INCOMPLETE_METADATA ${flow.dataIncompleteCount} งาน`);
    if (!S.partitionOk) reasons.push("partition self-check ไม่ผ่าน");
    if (driftFail) reasons.push("BASELINE_DRIFT");
    if (reasons.length) {
      console.log(`\n⚠️ --strict: ${reasons.join(" · ")} → exit 1`);
      console.log(`_(journal track พร้อม ${S.journalEligibleCount}/${S.candidateCount} — แต่ overall ยังไม่พร้อมจนกว่า owner จะยืนยันวันรับรู้รายได้ และหลักฐานสต็อกจะถูกตรวจ; ห้ามผ่อน gate เพื่อให้เขียว)_`);
      return 1;
    }
    console.log(`\n_strict: candidate ทุกงาน overall-ready สำหรับ S4.1c (บัญชี + สต็อก + owner ยืนยันวันแล้ว) ✅_`);
  }
  return 0;
}

main().then((code) => process.exit(code || 0)).catch((e) => fatal(e?.stack || String(e)));
