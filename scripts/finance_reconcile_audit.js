// ═══════════════════════════════════════════════════════════
//  finance_reconcile_audit.js — Phase 601 (S4.0) RUNNER (READ-ONLY)
//  เทียบ operational tables กับ General Ledger รายธุรกรรม → พิมพ์รายงาน markdown
//
//  ★ READ-ONLY เด็ดขาด: POST มีจุดเดียว = /auth/v1/token (login). ทุก /rest/v1/ = GET.
//    ห้าม PATCH/PUT/DELETE/RPC-mutate/Prefer:resolution. เจอ anomaly = ลงรายงานเท่านั้น ห้ามซ่อม.
//  Usage: node scripts/finance_reconcile_audit.js [YYYY-MM ...]   (default = เดือนนี้ + เดือนก่อน, Bangkok)
//  Env (.env): SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
//  Exit: 0 เสมอเมื่อรันจบ (audit ไม่ใช่ gate) · 2 = fatal (env/network)
// ═══════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import * as L from "./finance_reconcile_lib.js";

// ── env (pattern เดียวกับ accounting_integrity_smoke.js) ──
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
function fatal(msg) { console.error("[fatal] " + msg); process.exit(2); }

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
  if (!r.ok) fatal(`login ไม่สำเร็จ (${r.status}) — เช็ค ADMIN_EMAIL/PASSWORD`);
  const d = await r.json();
  if (!d.access_token) fatal("login ไม่ได้ access_token");
  return d.access_token;
}
const authH = (token) => ({ apikey: ANON, Authorization: "Bearer " + token });

// ── GET + pagination (PostgREST cap 1000 เงียบ → loop offset จนหน้าสุดท้าย < 1000) ──
async function getAll(token, pathAndQuery) {
  const PAGE = 1000;
  let offset = 0, out = [];
  for (;;) {
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const url = `${URL_BASE}/rest/v1/${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { method: "GET", headers: authH(token) });
    if (!r.ok) fatal(`GET ${pathAndQuery} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < PAGE) break;   // หน้าสุดท้าย
    offset += PAGE;
  }
  return out;
}
// chunk in.(...) query — id list ยาว → หลาย GET (≤chunk ต่อรอบ) แล้ว paginate แต่ละรอบ
async function getByIn(token, table, select, col, ids, chunk = 100) {
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  let out = [];
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk).map(encodeURIComponent).join(",");
    out = out.concat(await getAll(token, `${table}?select=${select}&${col}=in.(${part})`));
  }
  return out;
}

// ── months to audit ──
function defaultMonths() {
  const now = L.bkkDate(new Date());               // YYYY-MM-DD Bangkok
  const [y, m] = now.split("-").map(Number);
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [cur, pm];
}
const months = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a));
const AUDIT_MONTHS = months.length ? months : defaultMonths();

// ── date window (UTC) ครอบเดือน ± 1 วัน กัน UTC เหลื่อม (bucket จริงด้วย bkkDate ใน lib) ──
function monthWindow(month) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(Date.UTC(y, m, 1));        end.setUTCDate(end.getUTCDate() + 1);
  return { fromTs: start.toISOString(), toTs: end.toISOString(), first: `${month}-01`, last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function auditMonth(token, month, productCostMap) {
  const w = monthWindow(month);
  // operational fetches (GET, paginated)
  const salesRaw = await getAll(token, `sales?select=id,order_no,created_at,total_amount,vat_amount,subtotal_before_vat,credit_used_amount,gross_profit,payment_method,note&created_at=gte.${w.fromTs}&created_at=lt.${w.toTs}`);
  const saleItems = await getByIn(token, "sale_items", "sale_id,qty,unit_cost,product_id,product_name", "sale_id", salesRaw.map(s => s.id));
  const jobsCreated = await getAll(token, `service_jobs?select=id,job_no,job_type,status,created_at,closed_at,total_cost,sub_service,note,deleted_at,payment_method&created_at=gte.${w.fromTs}&created_at=lt.${w.toTs}`);
  const jobsClosed = await getAll(token, `service_jobs?select=id,job_no,job_type,status,created_at,closed_at,total_cost,sub_service,note,deleted_at,payment_method&closed_at=gte.${w.fromTs}&closed_at=lt.${w.toTs}`);
  const jobsMap = new Map(); for (const j of [...jobsCreated, ...jobsClosed]) jobsMap.set(String(j.id), j);
  const jobs = [...jobsMap.values()];
  const refunds = await getAll(token, `refunds?select=id,refund_no,sale_id,refund_amount,refund_method,created_at&created_at=gte.${w.fromTs}&created_at=lt.${w.toTs}`);
  const expenses = await getAll(token, `expenses?select=id,expense_date,amount,category,note&expense_date=gte.${w.first}&expense_date=lte.${w.last}`);

  // GL: (a) by source (จับ JV ข้ามเดือน) — ต่อ source_table
  const jeBySource = new Map();
  const addJes = async (table, ids) => {
    if (!ids.length) return;
    const jes = await getByIn(token, "journal_entries", "id,doc_date,total_debit,total_credit,status,source_table,source_id", "source_id", ids);
    for (const je of jes) if (je.source_table === table) jeBySource.set(`${table}:${je.source_id}`, je);
  };
  await addJes("sales", salesRaw.map(s => s.id));
  await addJes("service_jobs", jobs.map(j => j.id));
  await addJes("refunds", refunds.map(r => r.id));
  await addJes("expenses", expenses.map(e => e.id));

  // GL: (b) by doc_date ในเดือน (หา orphan + rollup) — ตัด void
  let docDateEntries = await getAll(token, `journal_entries?select=id,doc_date,total_debit,total_credit,status,source_table,source_id&doc_date=gte.${w.first}&doc_date=lte.${w.last}`);
  const isVoid = (s) => ["void", "voided", "cancelled", "canceled"].includes(String(s || "").toLowerCase());
  const voidCount = docDateEntries.filter(e => isVoid(e.status)).length;
  docDateEntries = docDateEntries.filter(e => !isVoid(e.status));
  // journal_lines ของ entries (b)
  const lines = await getByIn(token, "journal_lines", "entry_id,account_code,debit,credit", "entry_id", docDateEntries.map(e => e.id));
  const linesByEntry = new Map();
  for (const l of lines) { const k = String(l.entry_id); if (!linesByEntry.has(k)) linesByEntry.set(k, []); linesByEntry.get(k).push(l); }
  const linesByEntryId = new Map(docDateEntries.map(e => [e.id, linesByEntry.get(String(e.id)) || []]));

  const sum = L.summarizeMonth({ month, sales: salesRaw, saleItems, jobs, refunds, expenses, jeBySource, linesByEntry: linesByEntryId, docDateEntries, productCostMap });
  return { sum, voidCount, counts: { sales: salesRaw.length, saleItems: saleItems.length, jobs: jobs.length, refunds: refunds.length, expenses: expenses.length, jeDocDate: docDateEntries.length } };
}

// ── report ──
function printProblemTable(title, rows, refKey, docKey) {
  if (!rows.length) { console.log(`- ${title}: ✅ ไม่มี`); return; }
  console.log(`\n**${title}** (${rows.length} รายการ)\n`);
  console.log("| ref | วันที่ | op | gl | class |");
  console.log("|---|---|---|---|---|");
  const shown = rows.slice(0, 50);
  for (const x of shown) {
    const src = x[refKey] || {};
    const ref = src[docKey] || src.id || "-";
    const d = x.detail.saleDate || x.detail.basisDate || x.detail.refundDate || "-";
    console.log(`| ${ref} | ${d} | ${money(x.detail.opAmount)} | ${x.detail.glAmount != null ? money(x.detail.glAmount) : "-"} | ${x.cls}${x.detail.crossMonth ? " (crossMonth)" : ""}${x.detail.webCountedOperational ? " (web)" : ""} |`);
  }
  if (rows.length > 50) console.log(`\n…และอีก ${rows.length - 50} รายการ (ไม่ตัดเงียบ — รวม ${rows.length})`);
}

async function main() {
  const token = await signIn(AD_EMAIL, AD_PASS);
  // productCostMap
  const products = await getAll(token, "products?select=id,name,cost");
  const productCostMap = {};
  for (const p of products) { productCostMap[p.id] = Number(p.cost || 0); productCostMap[p.name] = Number(p.cost || 0); }

  console.log(`# Finance Reconciliation Audit (S4.0, read-only)\n`);
  console.log(`- effective date: **${L.ACCOUNTING_EFFECTIVE_DATE}**`);
  console.log(`- months: ${AUDIT_MONTHS.join(", ")}`);
  console.log(`- generated: ${L.bkkDate(new Date())} (Bangkok)\n`);

  for (const month of AUDIT_MONTHS) {
    const { sum, voidCount, counts } = await auditMonth(token, month, productCostMap);
    const R = sum.revenue, G = sum.grossProfit;
    const preEffective = L.monthOf(month) < L.monthOf(L.ACCOUNTING_EFFECTIVE_DATE);

    console.log(`\n═══════════════════════════════════════════\n## เดือน ${month}${preEffective ? " (pre-effective — คาด JV = 0)" : ""}\n`);
    console.log(`_fetched: sales ${counts.sales} · sale_items ${counts.saleItems} · jobs ${counts.jobs} · refunds ${counts.refunds} · expenses ${counts.expenses} · JE(doc_date) ${counts.jeDocDate}${voidCount ? ` · void ${voidCount} (ตัดออก)` : ""}_\n`);

    // ── ส่วน A: matrix ──
    console.log(`### A. Revenue 3 มุม`);
    console.log("| มุม | ยอด |");
    console.log("|---|---:|");
    console.log(`| (1) dashboard (POS ${money(R.opPos)} + web ${money(R.opWeb)}) | ${money(R.opDashboard)} |`);
    console.log(`| (2) income_overview (+service ${money(R.opServiceIncome)}) | ${money(R.opIncomeOverview)} |`);
    console.log(`| (3) GL (4xxx credit − 4110 contra) | ${money(R.gl)} |`);
    console.log(`\n**Δ dashboard − GL = ${money(R.deltaDashboardGl)}** แตกเป็น:`);
    console.log("| สาเหตุ | ยอด |");
    console.log("|---|---:|");
    console.log(`| VAT (op รวม, GL แยก 2170) | ${money(R.breakdown.vat)} |`);
    console.log(`| web ยังไม่ closed (op มี, GL ไม่มี) | ${money(R.breakdown.webNotClosed)} |`);
    console.log(`| NO_JV (op มี, GL หลุดโพสต์) | ${money(R.breakdown.noJv)} |`);
    console.log(`| refunds (GL หัก 4110, op ไม่หัก) | ${money(R.breakdown.refunds)} |`);
    console.log(`| − service cross-month (GL มี, op คนละเดือน) | ${money(R.breakdown.crossMonthGlOnly)} |`);
    console.log(`| − DELETED_HAS_JV (บิลลบแต่ JV ผียังอยู่) | ${money(R.breakdown.deletedHasJv)} |`);
    console.log(`| **= unexplained residual** | **${money(R.unexplainedResidual)}** ${Math.abs(R.unexplainedResidual) < 0.01 ? "✅" : "⚠️ ยังมีสาเหตุที่ไม่รู้ — ห้ามไป S4.1"} |`);

    console.log(`\n### Gross profit 3 มุม`);
    console.log(`- frozen (sales.gross_profit): **${money(G.frozen)}**`);
    console.log(`- strict (POS − knownCogs, null≠0): **${money(G.strict)}** (knownCogs ${money(G.knownCogs)})`);
    console.log(`- fallback (สูตร profit_report): **${money(G.fallback)}** (fallbackDelta ${money(G.fallbackDelta)})`);
    console.log(`- unit_cost: UNKNOWN(null) ${G.unknownCount} รายการ (fallback ${money(G.unknownFallbackCogs)}) · ZERO(0) ${G.zeroCount} รายการ (fallback ${money(G.zeroFallbackCogs)})`);
    console.log(`\n### COGS ใน GL (Dr 5xxx — คาด 0 = premise S4.1): **${money(sum.glCogs)}** ${Math.abs(sum.glCogs) < 0.01 ? "(ยืนยัน: ไม่มีการโพสต์ COGS)" : "⚠️"}`);
    console.log(`\n### Refunds: ${sum.counts.refunds.total} รายการ — OK ${sum.counts.refunds.OK} · NO_JV ${sum.counts.refunds.NO_JV} · MISMATCH ${sum.counts.refunds.AMOUNT_MISMATCH}`);
    console.log(`### Orphan JEs (doc_date∈เดือน, source หาย/ลบ): **${sum.orphans.length}**`);
    if (sum.orphans.length) { for (const o of sum.orphans.slice(0, 50)) console.log(`  - JE ${o.entryId} (${o.docDate}) ${o.sourceTable}:${o.sourceId} — ${o.reason}`); if (sum.orphans.length > 50) console.log(`  …และอีก ${sum.orphans.length - 50}`); }

    // ── ส่วน B: problem rows ──
    console.log(`\n### B. รายธุรกรรมที่ไม่ OK`);
    printProblemTable("Sales", sum.problemRows.sales, "s", "order_no");
    printProblemTable("Service jobs", sum.problemRows.jobs, "j", "job_no");
    printProblemTable("Refunds", sum.problemRows.refunds, "r", "refund_no");

    // ── ส่วน C: pre-effective ──
    if (preEffective) {
      const jvInMonth = sum.counts.sales.total || sum.counts.jobs.total; // any source with JV?
      const anyJv = sum.revenue.gl !== 0 || sum.counts.jeDocDate !== undefined;
      console.log(`\n### C. Pre-effective baseline (คาด JV = 0)`);
      console.log(`- JE ที่ doc_date ในเดือนนี้: **${counts.jeDocDate}** ${counts.jeDocDate === 0 ? "✅ (baseline สะอาด)" : "⚠️ เจอ JV ในเดือน pre-effective — anomaly ต้องดู"}`);
      void jvInMonth; void anyJv;
    }
  }
  console.log(`\n─── จบรายงาน (read-only audit — ไม่มีการแก้ข้อมูล) ───`);
}

main().then(() => process.exit(0)).catch((e) => fatal(e?.stack || String(e)));
