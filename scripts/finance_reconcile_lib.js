// ═══════════════════════════════════════════════════════════
//  finance_reconcile_lib.js — Phase 601 (S4.0) PURE helpers
//  เทียบ operational tables (sales/service_jobs/refunds/expenses) กับ GL รายธุรกรรม
//
//  ★ PURE: ไม่มี env / fetch / side-effect ตอน import → unit-test ได้ (ป้อน fixture)
//  ★ READ-ONLY audit: ไฟล์นี้ "จำแนก + สรุป" เท่านั้น ไม่แก้ข้อมูล
//  predicate/สูตร คัดลอกจาก source จริง (อ้างไว้ต่อจุด) + guard test กัน drift
// ═══════════════════════════════════════════════════════════
import { ACCOUNTING_EFFECTIVE_DATE } from "../modules/accounting/effective_date.js";

export { ACCOUNTING_EFFECTIVE_DATE };

// ── date helpers (ตรรกะเดียวกับ dateBkk ใน modules/utils.js → en-CA = YYYY-MM-DD, TZ Bangkok) ──
export function bkkDate(ts) {
  if (!ts) return "";
  const d = (ts instanceof Date) ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
export function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ── predicates (คัดลอกจาก source — guard test เทียบ token กัน drift) ──
// isDeletedSale: ตรง auto_post.js:482 (soft-delete = note มี "[ลบแล้ว]")
export function isDeletedSale(sale) { return String(sale?.note || "").includes("[ลบแล้ว]"); }

// isWebOrderJob: คัดลอก dashboard.js:18-22 isWebOrderServiceJob (ห้าม import โมดูล UI — มี side-effect)
//
// ★ Phase 606-0 (review PR #191): detector เดิมจับได้แค่ 2 รูปแบบ (sub_service "สั่งซื้อ" / note "SH-<payment>|")
//   แต่ **web writer จริงมี 3 ทาง** และอีกสองทางไม่ตรงรูปแบบนั้นเลย → ออเดอร์เว็บถูกนับเป็น "งานบริการ"
//   ในรายงาน/taxonomy (ผิดประเภท):
//     - customer_dashboard.js  → note "SH-transfer|…" (จับได้อยู่แล้ว)
//     - ai_sales.js:611-620    → job_no "AI-<base36>" + note "AI Sales: …"   ← เดิมหลุด
//     - ac_shop.js:452-461     → job_no "SH-<base36>" + note "AC Shop: …"    ← เดิมหลุด
//   → เพิ่ม legacy marker: job_no ขึ้นต้น AI-/SH- หรือ note ขึ้นต้น "AI Sales:"/"AC Shop:"
//   (กติกาเดิมคงไว้ทั้งหมด — เป็นการ "ขยาย" ไม่ใช่เปลี่ยนนิยาม)
//   ⚠️ Phase 606-a จะเพิ่มคอลัมน์ `source_kind` ('service'|'web_order') + backfill แล้วให้ทุกที่อ่าน
//   จาก helper เดียว — detector ตาม marker นี้เป็นของชั่วคราวสำหรับงานเก่าที่ยังไม่มี source_kind
// ★ ทุก marker ต้อง case-insensitive ให้ตรงกับฝั่ง SQL (derive_service_source_kind ใช้ ~* / ILIKE)
const WEB_ORDER_JOB_NO = /^(AI|SH)-/i;
const WEB_ORDER_NOTE = /^(AI Sales:|AC Shop:)/i;
const WEB_ORDER_LEGACY_NOTE = /^SH-(transfer|cod_cash|cod_transfer)\|/i;

// ═══ Phase 606-a: source identity (แหล่งกำเนิดงาน) แยกจาก income eligibility ═══
//  ★ identity ไม่ขึ้นกับวงจรชีวิตงาน — web order ที่ถูกยกเลิก/ลบ **ยังเป็น web_order**
//  ★ eligibility (จะนับเป็นรายได้ไหม) ใช้ isServiceIncomeJob/isWebOrderJob แยกต่างหาก
//  ★ ลำดับความน่าเชื่อถือ: source_kind จาก DB (Phase 606-a) → marker เดิม (งานก่อน migration)
//    → ค่า invalid = **ห้ามกลืนเป็น service เงียบ ๆ** (คืน invalid ให้ caller รายงาน dataIncomplete)
export const SOURCE_KINDS = { SERVICE: "service", WEB_ORDER: "web_order" };

/** derive จาก marker แบบ anchored (ต้อง "ขึ้นต้น" — substring กลางประโยคไม่นับ) — mirror SQL derive_service_source_kind() */
export function deriveSourceKindFromMarkers(job) {
  const note = String(job?.note || "");
  const isWeb = String(job?.sub_service || "").includes("สั่งซื้อ")
    || WEB_ORDER_LEGACY_NOTE.test(note)
    || WEB_ORDER_JOB_NO.test(String(job?.job_no || ""))
    || WEB_ORDER_NOTE.test(note);
  return isWeb ? SOURCE_KINDS.WEB_ORDER : SOURCE_KINDS.SERVICE;
}

/**
 * @param {object} job
 * @param {boolean} metaAvailable - คอลัมน์ 606-a มีในสคีมาแล้วหรือยัง (probe จาก runner)
 * @returns {{kind:"service"|"web_order"|null, from:"db"|"marker"|"invalid"}}
 *   ★ metaAvailable = true แล้ว source_kind ยัง null/"" → **invalid (data เสีย)** ไม่ใช่ fallback marker
 *     (คอลัมน์ NOT NULL หลัง migration → ค่าว่าง = ผิดปกติ ต้องรายงาน ไม่ใช่เดา)
 *   ★ metaAvailable = false (ยังไม่รัน migration) → fallback marker ตามเดิม
 */
export function serviceJobSourceKindOf(job, metaAvailable = false) {
  const raw = job?.source_kind;
  if (raw === null || raw === undefined || raw === "") {
    if (metaAvailable) return { kind: null, from: "invalid" };            // ★ fail-closed
    return { kind: deriveSourceKindFromMarkers(job), from: "marker" };    // งานก่อน migration
  }
  const k = String(raw).trim().toLowerCase();
  if (k === SOURCE_KINDS.SERVICE || k === SOURCE_KINDS.WEB_ORDER) return { kind: k, from: "db" };
  return { kind: null, from: "invalid" };   // ★ ห้าม fallback เป็น service
}

/**
 * ★ Phase 606-a (fail-closed): metadata `source_kind`/`finance_flow_version` จะมีก็ต่อเมื่อรัน migration แล้ว
 * → runner ต้อง probe ก่อนใช้ และ **fallback ได้เฉพาะเมื่อยืนยันว่าคอลัมน์ไม่มีจริง** (PG 42703 /
 *   undefined column ที่อ้างชื่อคอลัมน์ของเรา). 404 หรือ 400 ด้วยสาเหตุอื่น (RLS/สิทธิ์/พิมพ์ผิด/JWT)
 *   = fatal — ห้ามเดาว่า "ยังไม่ได้ migrate" แล้วเงียบ ๆ ใช้ marker แทน
 * (pure — เป็นตัวตัดสินร่วมของทั้ง verify:reconcile และ verify:service-no-jv)
 */
export const META_COLUMNS = ["source_kind", "finance_flow_version"];
export function isMissingMetaColumnError(status, bodyText) {
  if (status !== 400) return false;                     // 404/401/5xx ฯลฯ = ปัญหาอื่น → fatal
  let body;
  try { body = JSON.parse(String(bodyText || "")); } catch (_) { return false; }   // อ่านไม่ออก = fatal
  if (!body || typeof body !== "object") return false;
  const code = String(body.code || "");
  // ★ รับเฉพาะ 2 รหัสนี้เท่านั้น: PG 42703 (undefined_column) · PostgREST PGRST204 (column not found)
  //   PGRST100 = query parsing error → ต้อง fatal (ไม่ใช่ "ยังไม่ migrate")
  if (code !== "42703" && code !== "PGRST204") return false;
  const text = `${body.message || ""} ${body.details || ""} ${body.hint || ""}`;
  return META_COLUMNS.some(c => text.includes(c));      // ต้องระบุคอลัมน์เป้าหมายของเราจริง ๆ
}

/** ใช้ในงาน reconcile: web order ที่ยัง "มีชีวิต" (ไม่ยกเลิก/ไม่ลบ) — identity + lifecycle */
export function isWebOrderJob(j) {
  if (!j) return false;
  const { kind } = serviceJobSourceKindOf(j);
  const note = String(j.note || "");
  return kind === SOURCE_KINDS.WEB_ORDER
    && j.status !== "cancelled" && !j.deleted_at && !note.includes("[ลบแล้ว]");
}

// isServiceIncomeJob: ตรง dashboard.js:24 + auto_post.js:864 (delivered/done/closed + total_cost>0 + ไม่ลบ)
export function isServiceIncomeJob(j) {
  if (!j) return false;
  const st = String(j.status || "").trim().toLowerCase();
  return ["delivered", "done", "closed"].includes(st)
    && Number(j.total_cost || 0) > 0
    && !j.deleted_at && !(j.note || "").includes("[ลบแล้ว]");
}
function isServiceDeleted(j) { return !!(j?.deleted_at) || String(j?.note || "").includes("[ลบแล้ว]"); }

const _lt = (dateStr, effective) => String(dateStr || "") < String(effective || ""); // "YYYY-MM-DD" เทียบ lexicographic ปลอดภัย

// ── 1.6 classifySale ──────────────────────────────────────────
export function classifySale(sale, je, effective = ACCOUNTING_EFFECTIVE_DATE) {
  const saleDate = bkkDate(sale?.created_at);
  const opAmount = round2(sale?.total_amount);
  if (isDeletedSale(sale)) {
    return { cls: je ? "DELETED_HAS_JV" : "DELETED_OK", detail: { saleDate, opAmount, hasJe: !!je } };
  }
  if (_lt(saleDate, effective)) return { cls: "PRE_EFFECTIVE", detail: { saleDate, opAmount } };
  if (!je) return { cls: "NO_JV", detail: { saleDate, opAmount } };
  const glAmount = round2(je.total_debit);
  const delta = round2(glAmount - opAmount);
  if (delta !== 0) return { cls: "AMOUNT_MISMATCH", detail: { saleDate, opAmount, glAmount, delta } };
  if (String(je.doc_date || "") !== saleDate) return { cls: "DATE_MISMATCH", detail: { saleDate, glDocDate: je.doc_date, opAmount, glAmount } };
  return { cls: "OK", detail: { saleDate, opAmount, glAmount } };
}

// ── 1.7 classifyServiceJob ────────────────────────────────────
export function classifyServiceJob(job, je, effective = ACCOUNTING_EFFECTIVE_DATE) {
  const basisDate = bkkDate(job?.closed_at || job?.created_at);          // GL basis (auto_post.js:872 cash-basis closed_at)
  const createdMonth = monthOf(bkkDate(job?.created_at));
  const webCountedOperational = isWebOrderJob(job);
  const crossMonth = monthOf(basisDate) !== createdMonth;               // timing diff created_at vs closed_at
  const opAmount = round2(job?.total_cost);
  const base = { basisDate, createdMonth, webCountedOperational, crossMonth, opAmount, hasJe: !!je };
  if (isServiceDeleted(job)) return { cls: je ? "DELETED_HAS_JV" : "DELETED_OK", detail: base };
  if (!isServiceIncomeJob(job)) return { cls: "NOT_INCOME_STATUS", detail: base };  // ไม่คาดหวัง JV (แหล่ง Δ ถ้า web)
  if (_lt(basisDate, effective)) return { cls: "PRE_EFFECTIVE", detail: base };
  if (!je) return { cls: "NO_JV", detail: base };
  const glAmount = round2(je.total_debit);
  const delta = round2(glAmount - opAmount);
  if (delta !== 0) return { cls: "AMOUNT_MISMATCH", detail: { ...base, glAmount, delta } };
  return { cls: "OK", detail: { ...base, glAmount } };
}

// ── 1.8 classifyRefund ────────────────────────────────────────
export function classifyRefund(refund, je, effective = ACCOUNTING_EFFECTIVE_DATE) {
  const refundDate = bkkDate(refund?.created_at);
  const opAmount = round2(refund?.refund_amount);
  if (_lt(refundDate, effective)) return { cls: "PRE_EFFECTIVE", detail: { refundDate, opAmount } };
  if (!je) return { cls: "NO_JV", detail: { refundDate, opAmount } };
  const glAmount = round2(je.total_debit);
  const delta = round2(glAmount - opAmount);
  if (delta !== 0) return { cls: "AMOUNT_MISMATCH", detail: { refundDate, opAmount, glAmount, delta } };
  return { cls: "OK", detail: { refundDate, opAmount, glAmount } };
}

// ── EXPENSE_CATEGORY_MAP: คัดลอก auto_post.js:567-591 (category → mapping_key) — guard test กัน drift ──
//   ★ ต้องตรงกับ writer จริง เพราะใช้ resolve ว่า expense category นี้ "คาดว่าจะมี JV ไหม"
export const EXPENSE_CATEGORY_MAP = {
  fuel: "expense_fuel", gasoline: "expense_fuel", น้ำมัน: "expense_fuel",
  utility: "expense_utility", utilities: "expense_utility", electricity: "expense_utility", water: "expense_utility",
  phone: "expense_phone", internet: "expense_phone",
  rent: "expense_rent", repair: "expense_repair", maintenance: "expense_repair",
  supplies: "expense_supplies", materials: "expense_supplies",
  ads: "expense_ads", marketing: "expense_ads",
  bank_fee: "expense_bank_fee", bank: "expense_bank_fee", travel: "expense_travel",
  salary: "payroll_salary", labor_hire: "payroll_salary", payroll: "payroll_salary"
};
// เงินเดือน/ค่าจ้าง — ลง JV ก้อนเดียวผ่าน payroll period, รายคนไม่ลง JV โดยตั้งใจ (auto_post.js:613)
const SALARY_VIA_PAYROLL_CATEGORIES = new Set(["salary", "labor_hire", "payroll"]);

// ── 1.8b classifyExpense (expense_date basis; opAmount = amount) ──
//   validMappingKeys: Set<mapping_key> ที่ active + มี debit/credit ครบ (จาก account_mapping) —
//   ถ้าไม่ส่งมา (null) จะข้ามเช็ค CURRENT_MAPPING_MISSING (fixture เก่าเรียกได้เหมือนเดิม)
//   ลำดับ mirror auto_post.postJournalForExpense: pre-effective(599) → salary(613) → amount(597) → mapping(617)
export function classifyExpense(expense, je, effective = ACCOUNTING_EFFECTIVE_DATE, validMappingKeys = null) {
  const expenseDate = String(expense?.expense_date || "").slice(0, 10); // DATE column — ไม่มี time, ไม่ต้อง TZ shift
  const rawAmount = expense?.amount;
  const opAmount = round2(rawAmount);
  const cat = String(expense?.category || "").toLowerCase().trim();
  const base = { expenseDate, opAmount, category: cat };
  if (_lt(expenseDate, effective)) return { cls: "PRE_EFFECTIVE", detail: base };
  // เงินเดือน/ค่าจ้าง → JV ก้อนเดียวผ่าน payroll (ไม่ลงรายคน) = คาดว่าไม่มี JV, ไม่ใช่ NO_JV (auto_post.js:613-615)
  if (SALARY_VIA_PAYROLL_CATEGORIES.has(cat)) return { cls: "EXPECTED_SKIP_SALARY_VIA_PAYROLL", detail: base };
  // amount classes — แยกจากกัน (เดิม <0.01 กลืนยอดติดลบ). auto_post.js:597 `!amount` = falsy skip
  const num = Number(rawAmount);
  if (rawAmount === null || rawAmount === undefined || !Number.isFinite(num)) return { cls: "INVALID_AMOUNT", detail: base };          // null/NaN = row เพี้ยน (problem)
  if (num === 0) return { cls: "ZERO_AMOUNT", detail: base };                     // 0 → falsy → auto_post skip (expected)
  if (num < 0) return { cls: "INVALID_NEGATIVE_AMOUNT", detail: base };           // ติดลบ → auto_post โพสต์ Dr ลบ (problem)
  if (num < 0.01) return { cls: "SUBCENT_AMOUNT", detail: base };                 // 0<amount<0.01 = เศษต่ำกว่าสตางค์ (problem)
  // resolve mapping (auto_post.js:617 fallback expense_misc) — ถ้า key ไม่ active/ไม่ครบ ณ วัน audit = คาดว่าไม่มี JV
  const mappingKey = EXPENSE_CATEGORY_MAP[cat] || "expense_misc";
  if (!je && validMappingKeys && !validMappingKeys.has(mappingKey)) {
    return { cls: "CURRENT_MAPPING_MISSING", detail: { ...base, mappingKey } };   // ≠ NO_JV; "current" = พิสูจน์ได้แค่สถานะ ณ วัน audit
  }
  if (!je) return { cls: "NO_JV", detail: base };  // valid mapping แต่ไม่มี JV = หลุดโพสต์จริง
  const glAmount = round2(je.total_debit);
  const delta = round2(glAmount - opAmount);
  if (delta !== 0) return { cls: "AMOUNT_MISMATCH", detail: { ...base, glAmount, delta } };
  return { cls: "OK", detail: { ...base, glAmount } };
}

// ── 1.9 analyzeSaleItemsCost — แยก 3 ถัง null/0/>0 (ห้าม merge) ──
//   fallbackDelta = ส่วนที่สูตร profit_report.js:118-120 `if(!uc) uc = productCostMap[...]` เติมให้
//   ทั้งถัง UNKNOWN(null) และถัง ZERO(0) → พิสูจน์/หักล้างสมมติฐาน Δ2
export function analyzeSaleItemsCost(items, productCostMap = {}) {
  let knownCogs = 0, unknownCount = 0, unknownFallbackCogs = 0, zeroCount = 0, zeroFallbackCogs = 0;
  for (const it of (items || [])) {
    const qty = Number(it?.qty) || 0;
    const raw = it?.unit_cost;
    const fallback = Number(productCostMap[it?.product_id] ?? productCostMap[it?.product_name] ?? 0) || 0;
    if (raw === null || raw === undefined) {                 // ถัง UNKNOWN (null ≠ 0 — ห้าม merge)
      unknownCount += 1;
      unknownFallbackCogs = round2(unknownFallbackCogs + qty * fallback);
    } else if (Number(raw) === 0) {                          // ถัง ZERO
      zeroCount += 1;
      zeroFallbackCogs = round2(zeroFallbackCogs + qty * fallback);
    } else {                                                 // ถัง KNOWN (>0)
      knownCogs = round2(knownCogs + qty * Number(raw));
    }
  }
  // fallbackDelta = ต้นทุนที่ profit_report เติมเกินจาก strict knownCogs (ทั้ง null + 0)
  const fallbackDelta = round2(unknownFallbackCogs + zeroFallbackCogs);
  return { knownCogs, unknownCount, unknownFallbackCogs, zeroCount, zeroFallbackCogs, fallbackDelta };
}

// ── helper: GL revenue ของ 1 entry จาก lines (Σ credit 4xxx − Σ debit 4xxx; 4110 contra = debit ลบ) ──
export function entryRevenue(lines) {
  let rev = 0;
  for (const l of (lines || [])) {
    if (String(l?.account_code || "").startsWith("4")) rev += (Number(l.credit) || 0) - (Number(l.debit) || 0);
  }
  return round2(rev);
}
// COGS ใน GL = Σ debit 5100 เท่านั้น (คาด 0 — auto_post ไม่โพสต์ COGS = premise S4.1)
//   ★ 5100 = "ต้นทุนสินค้าที่ขาย" ตัวเดียว (COA supabase-phase88:225). 5200-5900 = opex
//   (เงินเดือน/น้ำมัน/ค่าเช่า ฯลฯ) ที่ expense JV โพสต์ Dr ทุกวัน — ถ้าใช้ startsWith("5")
//   บรรทัด "COGS คาด 0" จะโชว์ยอด opex ทั้งเดือน = หลักฐานตั้งต้น S4.1 เพี้ยน
export function entryCogs(lines) {
  let c = 0;
  for (const l of (lines || [])) {
    if (String(l?.account_code || "") === "5100") c += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  return round2(c);
}

// ── 1.10 summarizeMonth — matrix ต่อเดือน (pure) ──────────────
//   jeBySource: Map "table:id" → journal_entry (header, มี total_debit/doc_date)
//   linesByEntry: Map entry_id → [lines]
//   docDateEntries: [journal_entry] ที่ doc_date ∈ เดือนเป้า (สำหรับ GL rollup + orphan)
export function summarizeMonth(inp) {
  const {
    month, effective = ACCOUNTING_EFFECTIVE_DATE,
    sales = [], saleItems = [], jobs = [], refunds = [], expenses = [],
    jeBySource = new Map(), linesByEntry = new Map(), docDateEntries = [], productCostMap = {},
    expenseMappingKeys = null   // Set<mapping_key> active+ครบ (จาก account_mapping) → แยก MISSING_MAPPING จาก NO_JV
  } = inp;
  const inMonth = (d) => monthOf(bkkDate(d)) === month;
  // jeBySource value อาจเป็น array (defensive — 1 source มีได้หลาย JE = double-post) หรือ je เดี่ยว (fixture เก่า)
  const jeFor = (table, id) => {
    const v = jeBySource.get(`${table}:${id}`);
    if (!v) return null;
    return Array.isArray(v) ? (v[0] || null) : v;
  };
  // duplicate source postings: source เดียวมี JE > 1 = anomaly (โพสต์ซ้ำ) — surface ห้ามกลืน
  const duplicateSources = [];
  for (const [key, v] of jeBySource) {
    if (Array.isArray(v) && v.length > 1) duplicateSources.push({ key, count: v.length, entryIds: v.map(e => e.id) });
  }

  // ── operational revenue (dashboard = POS total_amount + web total_cost, created_at basis) ──
  const posInMonth = sales.filter(s => !isDeletedSale(s) && inMonth(s.created_at));
  const opPos = round2(posInMonth.reduce((a, s) => a + (Number(s.total_amount) || 0), 0));
  const webInMonth = jobs.filter(j => isWebOrderJob(j) && inMonth(j.created_at));
  const opWeb = round2(webInMonth.reduce((a, j) => a + (Number(j.total_cost) || 0), 0));
  const opDashboardRevenue = round2(opPos + opWeb);
  // income_overview = dashboard + service income (closed basis, ในเดือน, ไม่ใช่ web)
  const svcIncomeInMonth = jobs.filter(j => isServiceIncomeJob(j) && !isWebOrderJob(j) && monthOf(bkkDate(j.closed_at || j.created_at)) === month);
  const opServiceIncome = round2(svcIncomeInMonth.reduce((a, j) => a + (Number(j.total_cost) || 0), 0));
  const opIncomeOverviewRevenue = round2(opDashboardRevenue + opServiceIncome);

  // ── GL revenue (doc_date ∈ month) = Σ entryRevenue ──
  let glRevenue = 0, glCogs = 0;
  for (const je of docDateEntries) {
    const lines = linesByEntry.get(je.id) || [];
    glRevenue = round2(glRevenue + entryRevenue(lines));
    glCogs = round2(glCogs + entryCogs(lines));
  }

  // ── classify ทุก source ──
  const saleRows = sales.map(s => ({ s, ...classifySale(s, jeFor("sales", s.id), effective) }));
  const jobRows = jobs.map(j => ({ j, ...classifyServiceJob(j, jeFor("service_jobs", j.id), effective) }));
  const refundRows = refunds.map(r => ({ r, ...classifyRefund(r, jeFor("refunds", r.id), effective) }));
  const expenseRows = expenses.map(e => ({ e, ...classifyExpense(e, jeFor("expenses", e.id), effective, expenseMappingKeys) }));

  const count = (rows, cls) => rows.filter(x => x.cls === cls).length;
  const countBy = (rows) => { const o = {}; for (const x of rows) o[x.cls] = (o[x.cls] || 0) + 1; return o; };
  const jobById = new Map(jobs.map(j => [String(j.id), j]));

  // ── delta breakdown (op dashboard − GL) เป็นสาเหตุที่วัดได้ ──
  // VAT: op(POS) รวม VAT แต่ GL แยก 2170 → ต่อ sale ที่มี JV doc_date∈M
  //   (ต้อง gate doc_date ในเดือน มิฉะนั้นเคส DATE_MISMATCH ข้ามเดือนจะรั่วเข้า residual)
  const vat = round2(posInMonth.filter(s => { const je = jeFor("sales", s.id); return je && inMonth(je.doc_date); }).reduce((a, s) => a + (Number(s.vat_amount) || 0), 0));
  // web ที่ยังไม่ closed = อยู่ใน op (created_at∈M) แต่ไม่ contribute GL เดือนนี้
  const webNotClosed = round2(webInMonth.filter(j => {
    const je = jeFor("service_jobs", j.id);
    return !(je && inMonth(je.doc_date));
  }).reduce((a, j) => a + (Number(j.total_cost) || 0), 0));
  // service cross-month (GL-only): web job JV doc_date∈M แต่ created_at คนละเดือน → GL มี, op(dashboard) ไม่มี
  const crossMonthGlOnly = round2(jobs.filter(j => {
    if (!isWebOrderJob(j)) return false;
    const je = jeFor("service_jobs", j.id);
    return je && inMonth(je.doc_date) && !inMonth(j.created_at);
  }).reduce((a, j) => a + (Number(j.total_cost) || 0), 0));
  // NO_JV sales (อยู่ใน op เดือนนี้ ไม่ลบ) = op เกิน GL เต็มจำนวน total_amount
  const noJvSales = round2(saleRows.filter(x => x.cls === "NO_JV" && inMonth(x.s.created_at)).reduce((a, x) => a + (Number(x.detail.opAmount) || 0), 0));
  // refunds (GL หักผ่าน 4110 debit, op dashboard ไม่หัก) — JV doc_date∈M
  const refundsGl = round2(refundRows.filter(x => { const je = jeFor("refunds", x.r.id); return je && inMonth(je.doc_date); }).reduce((a, x) => a + (Number(x.detail.opAmount) || 0), 0));
  // DELETED_HAS_JV sales (ไม่อยู่ใน op เพราะลบ แต่ GL มี revenue) = GL-only
  const deletedHasJv = round2(saleRows.filter(x => x.cls === "DELETED_HAS_JV").reduce((a, x) => {
    const je = jeFor("sales", x.s.id); const lines = je ? (linesByEntry.get(je.id) || []) : [];
    return a + entryRevenue(lines);
  }, 0));
  // service (non-web) GL revenue = GL-only: dashboard นับแค่ POS+web แต่ GL โพสต์รายได้งานช่าง
  //   (satellite/CCTV ฯลฯ) ที่ปิดงานในเดือน → ต้องหักออกจากฝั่ง GL มิฉะนั้น residual ติดลบ ≈ −(ยอดนี้)
  //   ★ ใช้ entryRevenue (4xxx net) ให้ตรงฐานเดียวกับ glRevenue (rollup จาก entryRevenue) →
  //   identity ปิด exact ไม่พึ่ง assumption ว่า service JV ไม่มี VAT-split (robust ถ้าอนาคตมี VAT)
  const serviceNonWebGl = round2(docDateEntries.reduce((a, je) => {
    if (je.source_table !== "service_jobs") return a;
    const job = jobById.get(String(je.source_id ?? ""));
    if (!job || isWebOrderJob(job)) return a;   // web อยู่ใน op(dashboard) แล้ว; นับเฉพาะ non-web ที่ op ไม่มี
    return a + entryRevenue(linesByEntry.get(je.id) || []);
  }, 0));
  // manual JV (source_table & source_id null ทั้งคู่) = ลงมือเอง ไม่มี operational source → GL-only revenue
  //   หักออกจากฝั่ง GL เหมือน serviceNonWebGl (informational ไม่ใช่ anomaly — ดู orphan taxonomy)
  const isManualEntry = (je) => (je.source_table === null || je.source_table === undefined || je.source_table === "")
    && (je.source_id === null || je.source_id === undefined || String(je.source_id) === "");
  const manualJvGl = round2(docDateEntries.reduce((a, je) => isManualEntry(je) ? a + entryRevenue(linesByEntry.get(je.id) || []) : a, 0));

  // identity: op − gl = vat + webNotClosed + noJv + refunds − crossMonthGlOnly − deletedHasJv − serviceNonWebGl − manualJvGl + residual
  const rawDelta = round2(opDashboardRevenue - glRevenue);
  const explained = round2(vat + webNotClosed + noJvSales + refundsGl - crossMonthGlOnly - deletedHasJv - serviceNonWebGl - manualJvGl);
  const unexplainedResidual = round2(rawDelta - explained);

  // ── gross profit — 3 ฐานต่อบิล (policy: null/ไม่มีข้อมูล = ไม่รู้ต้นทุน ระดับบิล) ──
  //   ★ complete-cost bill = ทุก item row มี unit_cost > 0 (null และ 0 ถือว่า "ไม่ครบ" ทั้งคู่ —
  //     0 ยัง ambiguous จนกว่า S4.1 แก้ writer). ห้ามให้ null/0 กลายเป็น COGS 0 โดยปริยาย
  //   frozen = Σ sales.gross_profit (itemless gross_profit=null → 0, pos.js:122)
  const gpFrozen = round2(posInMonth.reduce((a, s) => a + (Number(s.gross_profit) || 0), 0));
  const posIds = new Set(posInMonth.map(s => String(s.id)));
  const posItems = saleItems.filter(it => posIds.has(String(it.sale_id)));   // items ของบิล POS ในเดือนเท่านั้น
  const cost = analyzeSaleItemsCost(posItems, productCostMap);               // item-level buckets (คงไว้เพื่อ fallback/continuity)
  const itemsBySale = new Map();
  for (const it of posItems) { const k = String(it.sale_id); if (!itemsBySale.has(k)) itemsBySale.set(k, []); itemsBySale.get(k).push(it); }
  // แบ่งบิลเป็น 3 ก้อน: complete / incomplete-itemized / itemless — partition ของ opPos
  let completeRevenue = 0, completeCogs = 0, completeBillCount = 0;
  let incompleteRevenue = 0, incompleteBillCount = 0, incompleteNullRows = 0, incompleteZeroRows = 0;
  const incompleteBills = [], itemlessRows = [];
  for (const s of posInMonth) {
    const rev = round2(s.total_amount);
    const items = itemsBySale.get(String(s.id));
    if (!items || items.length === 0) {                                     // C) itemless — ไม่มี item เลย
      itemlessRows.push({ id: s.id, orderNo: s.order_no, revenue: rev, cls: "ITEMLESS_SALE_COST_UNKNOWN" });
      continue;
    }
    let nullRows = 0, zeroRows = 0, cogs = 0;
    for (const it of items) {
      const uc = it.unit_cost, qty = Number(it.qty) || 0;
      if (uc === null || uc === undefined) nullRows += 1;                    // UNKNOWN_UNIT_COST
      else if (Number(uc) === 0) zeroRows += 1;                             // AMBIGUOUS_ZERO_COST
      else cogs = round2(cogs + qty * Number(uc));
    }
    if (nullRows === 0 && zeroRows === 0) {                                  // A) complete — ทุกแถว cost > 0
      completeBillCount += 1; completeRevenue = round2(completeRevenue + rev); completeCogs = round2(completeCogs + cogs);
    } else {                                                                 // B) incomplete-itemized — ไม่ประกาศ GP
      incompleteBillCount += 1; incompleteRevenue = round2(incompleteRevenue + rev);
      incompleteNullRows += nullRows; incompleteZeroRows += zeroRows;
      incompleteBills.push({ id: s.id, orderNo: s.order_no, revenue: rev, nullRows, zeroRows, cls: "INCOMPLETE_ITEMIZED_COST_UNKNOWN" });
    }
  }
  const itemlessCount = itemlessRows.length;
  const itemlessRevenue = round2(itemlessRows.reduce((a, r) => a + r.revenue, 0));
  const completeGp = round2(completeRevenue - completeCogs);               // "known GP" ตัวจริง (เฉพาะบิล complete)
  const itemizedRevenue = round2(completeRevenue + incompleteRevenue);
  const gpFallback = round2(itemizedRevenue - round2(cost.knownCogs + cost.fallbackDelta)); // สูตร profit_report (เทียบ)
  // partition identity — กันบิลตกหล่นเงียบ (complete + incomplete + itemless === opPos)
  const partitionSum = round2(completeRevenue + incompleteRevenue + itemlessRevenue);
  const partitionOk = partitionSum === opPos;

  // ── income_overview reconciliation (service dimension) — dashboard reconcile แล้ว, ต่อด้วย service ──
  //   Δ service = operational(closed basis) − GL posted → แตกเป็น NO_JV + mismatch + cross-month → residual 0
  //   (dashboard−GL ไม่จับ service NO_JV เพราะสองฝั่งไม่มี service; ต้อง reconcile ฝั่ง income แยก)
  const serviceOperational = opServiceIncome;                              // Σ total_cost non-web income job (closed∈M)
  const serviceGlPosted = serviceNonWebGl;                                // Σ entryRevenue non-web service JE (doc_date∈M)
  let serviceNoJv = 0, serviceNoJvCount = 0, serviceMismatchDelta = 0, serviceMismatchCount = 0, serviceCrossMonthOut = 0;
  let preEffExpectedUnposted = 0, preEffExpectedUnpostedCount = 0;
  for (const j of svcIncomeInMonth) {
    const basisDate = bkkDate(j.closed_at || j.created_at);               // ★ ฐานเดียวกับ classifyServiceJob (กัน drift)
    const je = jeFor("service_jobs", j.id);
    const op = round2(j.total_cost);
    if (_lt(basisDate, effective)) {                                       // ก่อน effective = ตั้งใจไม่ลง JV → expected-unposted (ไม่ใช่ NO_JV)
      if (!je) { preEffExpectedUnposted = round2(preEffExpectedUnposted + op); preEffExpectedUnpostedCount += 1; }
      continue;                                                            // ถ้ามี je pre-effective = anomaly จับที่ pre-effective JE signal
    }
    if (!je) { serviceNoJv = round2(serviceNoJv + op); serviceNoJvCount += 1; continue; }
    if (!inMonth(je.doc_date)) { serviceCrossMonthOut = round2(serviceCrossMonthOut + op); continue; } // มี JE แต่ doc_date คนละเดือน
    const gl = entryRevenue(linesByEntry.get(je.id) || []);               // ★ entryRevenue (4xxx net) ฐานเดียวกับ serviceGlPosted — ไม่ใช่ total_debit
    if (gl !== op) { serviceMismatchDelta = round2(serviceMismatchDelta + (op - gl)); serviceMismatchCount += 1; }
  }
  // cross-month in: service JE doc_date∈M แต่ job operational (closed) คนละเดือน → GL มี, operational ไม่มี
  let serviceCrossMonthIn = 0;
  for (const je of docDateEntries) {
    if (je.source_table !== "service_jobs") continue;
    const job = jobById.get(String(je.source_id ?? ""));
    if (!job || isWebOrderJob(job) || !isServiceIncomeJob(job)) continue;
    if (monthOf(bkkDate(job.closed_at || job.created_at)) === month) continue; // operational-in-month แล้ว (นับใน out)
    serviceCrossMonthIn = round2(serviceCrossMonthIn + entryRevenue(linesByEntry.get(je.id) || []));
  }
  const deltaServiceOpGl = round2(serviceOperational - serviceGlPosted);
  const serviceCrossMonthNet = round2(serviceCrossMonthOut - serviceCrossMonthIn);
  // residual = Δ − (NO_JV + mismatch + crossMonthNet + preEffectiveExpectedUnposted) → pre-effective month = 0
  const serviceIncomeResidual = round2(deltaServiceOpGl - round2(serviceNoJv + serviceMismatchDelta + serviceCrossMonthNet + preEffExpectedUnposted));
  // combined income residual = dashboard-basis + service-dimension (July 0 · June = dashboard 19,460 + service 0)
  const combinedResidual = round2(unexplainedResidual + serviceIncomeResidual);

  // ── JE taxonomy: doc_date∈M — แยก manual (informational) จาก orphan (problem) + data hole ──
  const saleById = new Map(sales.map(s => [String(s.id), s]));
  const refundById = new Map(refunds.map(r => [String(r.id), r]));
  const expenseById = new Map(expenses.map(e => [String(e.id), e]));
  const orphans = [];
  const manualJvEntries = [];
  const dataIncomplete = [];  // JE approved แต่ไม่มี journal_lines เลย = data hole
  for (const je of docDateEntries) {
    if ((linesByEntry.get(je.id) || []).length === 0) dataIncomplete.push({ entryId: je.id, docDate: je.doc_date, sourceTable: je.source_table, sourceId: je.source_id });
    const t = je.source_table, sid = je.source_id;
    const tNull = (t === null || t === undefined || t === "");
    const sNull = (sid === null || sid === undefined || String(sid) === "");
    if (tNull && sNull) { manualJvEntries.push({ entryId: je.id, docDate: je.doc_date }); continue; }   // MANUAL_JV — informational
    if (tNull || sNull) { orphans.push({ entryId: je.id, docDate: je.doc_date, sourceTable: t, sourceId: sid, reason: "BROKEN_SOURCE_LINK" }); continue; }
    const id = String(sid);
    let row, reason = "";
    if (t === "sales") { row = saleById.get(id); if (!row) reason = "ORPHAN_SOURCE_MISSING"; else if (isDeletedSale(row)) reason = "ORPHAN_SOURCE_DELETED"; }
    else if (t === "service_jobs") { row = jobById.get(id); if (!row) reason = "ORPHAN_SOURCE_MISSING"; else if (isServiceDeleted(row)) reason = "ORPHAN_SOURCE_DELETED"; }
    else if (t === "refunds") { row = refundById.get(id); if (!row) reason = "ORPHAN_SOURCE_MISSING"; }
    else if (t === "expenses") { row = expenseById.get(id); if (!row) reason = "ORPHAN_SOURCE_MISSING"; }
    // t อื่น (staff_payroll ฯลฯ) ไม่ถือ orphan (นอกขอบเขต operational 4 ตาราง)
    if (reason) orphans.push({ entryId: je.id, docDate: je.doc_date, sourceTable: t, sourceId: sid, reason });
  }

  return {
    month, effective,
    revenue: {
      opDashboard: opDashboardRevenue, opIncomeOverview: opIncomeOverviewRevenue, gl: glRevenue,
      opPos, opWeb, opServiceIncome,
      deltaDashboardGl: rawDelta, deltaIncomeOverviewGl: round2(opIncomeOverviewRevenue - glRevenue),
      breakdown: { vat, webNotClosed, crossMonthGlOnly, noJv: noJvSales, refunds: refundsGl, deletedHasJv, serviceNonWebGl, manualJvGl },
      explained, unexplainedResidual
    },
    // income_overview (service) reconciliation — Δ operational vs GL posted → residual ต้อง 0 เมื่อแตกครบ
    incomeReconcile: {
      serviceOperational, serviceGlPosted, deltaServiceOpGl,
      serviceNoJv, serviceNoJvCount, serviceMismatchDelta, serviceMismatchCount,
      serviceCrossMonthNet, preEffExpectedUnposted, preEffExpectedUnpostedCount,
      serviceIncomeResidual, combinedResidual
    },
    grossProfit: {
      frozen: gpFrozen, fallback: gpFallback, itemizedRevenue,
      completeGp, completeRevenue, completeCogs, completeBillCount,          // A) complete = known GP ตัวจริง
      incompleteRevenue, incompleteBillCount, incompleteNullRows, incompleteZeroRows, incompleteBills, // B) ไม่ประกาศ GP
      itemlessCount, itemlessRevenue, itemlessRows,                          // C) itemless
      partitionOk, partitionSum,
      ...cost
    },
    glCogs,
    counts: {
      sales: { total: sales.length, OK: count(saleRows, "OK"), NO_JV: count(saleRows, "NO_JV"), AMOUNT_MISMATCH: count(saleRows, "AMOUNT_MISMATCH"), DATE_MISMATCH: count(saleRows, "DATE_MISMATCH"), DELETED_HAS_JV: count(saleRows, "DELETED_HAS_JV"), PRE_EFFECTIVE: count(saleRows, "PRE_EFFECTIVE") },
      jobs: { total: jobs.length, OK: count(jobRows, "OK"), NO_JV: count(jobRows, "NO_JV"), AMOUNT_MISMATCH: count(jobRows, "AMOUNT_MISMATCH"), NOT_INCOME_STATUS: count(jobRows, "NOT_INCOME_STATUS"), DELETED_HAS_JV: count(jobRows, "DELETED_HAS_JV"), crossMonth: jobRows.filter(x => x.detail.crossMonth).length },
      refunds: { total: refunds.length, OK: count(refundRows, "OK"), NO_JV: count(refundRows, "NO_JV"), AMOUNT_MISMATCH: count(refundRows, "AMOUNT_MISMATCH") },
      expenses: { total: expenses.length, ...countBy(expenseRows) }
    },
    orphans,
    manualJv: manualJvEntries,
    dataIncomplete,
    duplicateSources,
    // rows ที่ไม่ OK (สำหรับส่วน B) — กรอง OK/DELETED_OK/PRE_EFFECTIVE + NOT_INCOME_STATUS ที่ไม่ใช่ web
    problemRows: {
      sales: saleRows.filter(x => !["OK", "DELETED_OK", "PRE_EFFECTIVE"].includes(x.cls)),
      jobs: jobRows.filter(x => !["OK", "DELETED_OK", "PRE_EFFECTIVE"].includes(x.cls) && !(x.cls === "NOT_INCOME_STATUS" && !x.detail.webCountedOperational)),
      refunds: refundRows.filter(x => !["OK", "PRE_EFFECTIVE"].includes(x.cls)),
      // expenses: ตัด class ที่ "คาดว่าไม่มี JV โดยออกแบบ" (salary via payroll / ยอด 0) — เหลือ NO_JV/CURRENT_MAPPING_MISSING/AMOUNT_MISMATCH/INVALID*/SUBCENT
      expenses: expenseRows.filter(x => !["OK", "PRE_EFFECTIVE", "EXPECTED_SKIP_SALARY_VIA_PAYROLL", "ZERO_AMOUNT"].includes(x.cls))
    }
  };
}
