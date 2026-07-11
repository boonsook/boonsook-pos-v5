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
export function isWebOrderJob(j) {
  if (!j) return false;
  return (((j.sub_service || "").includes("สั่งซื้อ")) || /^SH-(transfer|cod_cash|cod_transfer)\|/.test(j.note || ""))
    && j.status !== "cancelled" && !j.deleted_at && !(j.note || "").includes("[ลบแล้ว]");
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

  // ── gross profit — แยก itemized (มี cost basis) ออกจาก itemless (quick-pay ไม่มี item = ต้นทุนไม่ทราบ) ──
  //   ★ policy: null/ไม่มีข้อมูล = ไม่รู้ต้นทุน (ห้ามตี itemless = COGS 0 → กำไรเกินจริง)
  //   frozen = Σ sales.gross_profit (itemless มี gross_profit=null → 0 อยู่แล้ว, pos.js:122)
  const gpFrozen = round2(posInMonth.reduce((a, s) => a + (Number(s.gross_profit) || 0), 0));
  const posIds = new Set(posInMonth.map(s => String(s.id)));
  const posItems = saleItems.filter(it => posIds.has(String(it.sale_id)));   // items ของบิล POS ในเดือนเท่านั้น
  const salesWithItems = new Set(posItems.map(it => String(it.sale_id)));
  const cost = analyzeSaleItemsCost(posItems, productCostMap);
  // itemless = active POS sale ในเดือนที่ไม่มี sale_items เลย → ITEMLESS_SALE_COST_UNKNOWN (ต้นทุนไม่ทราบ)
  //   deleted sale ถูกกรองออกแล้วโดย posInMonth (isDeletedSale) → ไม่เข้า itemless
  const itemlessRows = posInMonth.filter(s => !salesWithItems.has(String(s.id)))
    .map(s => ({ id: s.id, orderNo: s.order_no, revenue: round2(s.total_amount), cls: "ITEMLESS_SALE_COST_UNKNOWN" }));
  const itemlessCount = itemlessRows.length;
  const itemlessRevenue = round2(itemlessRows.reduce((a, r) => a + r.revenue, 0));
  const itemizedRevenue = round2(opPos - itemlessRevenue);                // ยอดขายที่มี item (คิด GP ได้)
  const knownGp = round2(itemizedRevenue - cost.knownCogs);              // GP เฉพาะบิลที่มี item, ต้นทุนที่ทราบ (null≠0)
  const gpFallback = round2(itemizedRevenue - round2(cost.knownCogs + cost.fallbackDelta)); // สูตร profit_report บน itemized

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
    grossProfit: { frozen: gpFrozen, knownGp, fallback: gpFallback, itemizedRevenue, itemlessCount, itemlessRevenue, itemlessRows, ...cost },
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
