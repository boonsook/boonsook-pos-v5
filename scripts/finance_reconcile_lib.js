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
    jeBySource = new Map(), linesByEntry = new Map(), docDateEntries = [], productCostMap = {}
  } = inp;
  const inMonth = (d) => monthOf(bkkDate(d)) === month;
  const jeFor = (table, id) => jeBySource.get(`${table}:${id}`) || null;

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

  const count = (rows, cls) => rows.filter(x => x.cls === cls).length;
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
  //   ใช้ entryRevenue (4xxx net) ให้ตรงฐานเดียวกับ glRevenue (rollup จาก entryRevenue เช่นกัน)
  const serviceNonWebGl = round2(docDateEntries.reduce((a, je) => {
    if (je.source_table !== "service_jobs") return a;
    const job = jobById.get(String(je.source_id ?? ""));
    if (!job || isWebOrderJob(job)) return a;   // web อยู่ใน op(dashboard) แล้ว; นับเฉพาะ non-web ที่ op ไม่มี
    return a + entryRevenue(linesByEntry.get(je.id) || []);
  }, 0));

  // identity: op − gl = vat + webNotClosed + noJv + refunds − crossMonthGlOnly − deletedHasJv − serviceNonWebGl + residual
  const rawDelta = round2(opDashboardRevenue - glRevenue);
  const explained = round2(vat + webNotClosed + noJvSales + refundsGl - crossMonthGlOnly - deletedHasJv - serviceNonWebGl);
  const unexplainedResidual = round2(rawDelta - explained);

  // ── gross profit 3 มุม ──
  const gpFrozen = round2(posInMonth.reduce((a, s) => a + (Number(s.gross_profit) || 0), 0));
  // ★ วิเคราะห์ต้นทุนเฉพาะ items ของบิล POS ในเดือน (posInMonth) — saleItems ที่ fetch มา
  //   รวม window ±1 วัน + บิลที่ลบ → ถ้าไม่กรอง 3 มุม GP เทียบคนละฐาน + unknown/zero ปนนอกเดือน
  const posIds = new Set(posInMonth.map(s => String(s.id)));
  const cost = analyzeSaleItemsCost(saleItems.filter(it => posIds.has(String(it.sale_id))), productCostMap);
  const gpStrict = round2(opPos - cost.knownCogs);                       // null≠0: unknown/zero ไม่คิดต้นทุน
  const gpFallback = round2(opPos - round2(cost.knownCogs + cost.fallbackDelta)); // สูตร profit_report

  // ── orphan JEs: doc_date∈M แต่ source ไม่เจอ / ถูกลบ ──
  const saleById = new Map(sales.map(s => [String(s.id), s]));
  const refundById = new Map(refunds.map(r => [String(r.id), r]));
  const expenseById = new Map(expenses.map(e => [String(e.id), e]));
  const orphans = [];
  for (const je of docDateEntries) {
    const t = je.source_table, id = String(je.source_id ?? "");
    let row, reason = "";
    if (!t || id === "") { reason = "no-source"; }
    else if (t === "sales") { row = saleById.get(id); if (!row) reason = "source-missing"; else if (isDeletedSale(row)) reason = "source-deleted"; }
    else if (t === "service_jobs") { row = jobById.get(id); if (!row) reason = "source-missing"; else if (isServiceDeleted(row)) reason = "source-deleted"; }
    else if (t === "refunds") { row = refundById.get(id); if (!row) reason = "source-missing"; }
    else if (t === "expenses") { row = expenseById.get(id); if (!row) reason = "source-missing"; }
    // t อื่น (staff_payroll ฯลฯ) ไม่ถือ orphan (นอกขอบเขต operational 4 ตาราง)
    if (reason) orphans.push({ entryId: je.id, docDate: je.doc_date, sourceTable: t, sourceId: je.source_id, reason });
  }

  return {
    month, effective,
    revenue: {
      opDashboard: opDashboardRevenue, opIncomeOverview: opIncomeOverviewRevenue, gl: glRevenue,
      opPos, opWeb, opServiceIncome,
      deltaDashboardGl: rawDelta, deltaIncomeOverviewGl: round2(opIncomeOverviewRevenue - glRevenue),
      breakdown: { vat, webNotClosed, crossMonthGlOnly, noJv: noJvSales, refunds: refundsGl, deletedHasJv, serviceNonWebGl },
      explained, unexplainedResidual
    },
    grossProfit: { frozen: gpFrozen, strict: gpStrict, fallback: gpFallback, ...cost },
    glCogs,
    counts: {
      sales: { total: sales.length, OK: count(saleRows, "OK"), NO_JV: count(saleRows, "NO_JV"), AMOUNT_MISMATCH: count(saleRows, "AMOUNT_MISMATCH"), DATE_MISMATCH: count(saleRows, "DATE_MISMATCH"), DELETED_HAS_JV: count(saleRows, "DELETED_HAS_JV"), PRE_EFFECTIVE: count(saleRows, "PRE_EFFECTIVE") },
      jobs: { total: jobs.length, OK: count(jobRows, "OK"), NO_JV: count(jobRows, "NO_JV"), AMOUNT_MISMATCH: count(jobRows, "AMOUNT_MISMATCH"), NOT_INCOME_STATUS: count(jobRows, "NOT_INCOME_STATUS"), DELETED_HAS_JV: count(jobRows, "DELETED_HAS_JV"), crossMonth: jobRows.filter(x => x.detail.crossMonth).length },
      refunds: { total: refunds.length, OK: count(refundRows, "OK"), NO_JV: count(refundRows, "NO_JV"), AMOUNT_MISMATCH: count(refundRows, "AMOUNT_MISMATCH") }
    },
    orphans,
    // rows ที่ไม่ OK (สำหรับส่วน B) — กรอง OK/DELETED_OK/PRE_EFFECTIVE + NOT_INCOME_STATUS ที่ไม่ใช่ web
    problemRows: {
      sales: saleRows.filter(x => !["OK", "DELETED_OK", "PRE_EFFECTIVE"].includes(x.cls)),
      jobs: jobRows.filter(x => !["OK", "DELETED_OK", "PRE_EFFECTIVE"].includes(x.cls) && !(x.cls === "NOT_INCOME_STATUS" && !x.detail.webCountedOperational)),
      refunds: refundRows.filter(x => !["OK", "PRE_EFFECTIVE"].includes(x.cls))
    }
  };
}
