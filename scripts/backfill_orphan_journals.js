#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/backfill_orphan_journals.js — Phase 92.47
//
//  วัตถุประสงค์:
//    Backfill journal entries สำหรับ sales/expenses ที่ไม่มี JV
//    (root cause: RLS bug ใน auto_post ก่อน Phase 92.46 — sales role
//     ถูก deny insert journal_entries → source row บันทึก แต่ JV หาย)
//
//  หลังจาก Phase 92.46 ปิด RLS bug แล้ว → ข้อมูลใหม่ลง JV ปกติ
//  แต่ orphan สะสมก่อนหน้านี้ต้อง backfill ด้วย script นี้
//
//  Strategy:
//    - Auth admin → ใช้ window shim ใน Node เพื่อ reuse
//      postJournalForSale/postJournalForExpense จาก modules/accounting/auto_post.js
//    - ไม่ replicate logic (กัน drift) — ใช้ของจริงตรงๆ
//    - Idempotent: ถ้ารันซ้ำ unique partial index บน (source_table,source_id)
//      จะ return 409 → script เห็นเป็น "skipped (duplicate)"
//    - Pre-effective skip: auto_post skip docDate < ACCOUNTING_EFFECTIVE_DATE (2026-05-01)
//      อัตโนมัติ — เช่น เมษา 2026 = test data ไม่ post
//
//  Run:
//    1. cp .env.example → .env (ถ้ายังไม่มี) — ใช้ไฟล์เดียวกับ verify scripts
//    2. ใส่ ADMIN_EMAIL + ADMIN_PASSWORD (role='admin')
//    3. npm run backfill:orphans               # LIVE — actually inserts
//       npm run backfill:orphans -- --dry-run  # preview only
//
//  Output: per-row status + summary + before/after integrity_summary
//  Exit: 0 = success (rows posted หรือ 0 orphans เริ่มต้น)
//        1 = some rows failed
//        2 = fatal (auth/network/import error)
//
//  Node 20+ built-in fetch — no npm dep
// ═══════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── Env loading (mirror smoke script pattern) ───────────────
function loadEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`[!] ${file} not found — copy .env.example → .env แล้วใส่ admin creds`);
    console.error(`    Required: SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD`);
    process.exit(2);
  }
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

// ── HTTP helpers (factory style — รับ URL/ANON เป็น arg เพื่อ test ได้) ──
function makeHttp(URL, ANON) {
  const H = (token, extra = {}) => Object.assign({
    apikey: ANON,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  }, extra);

  async function signIn(email, password) {
    const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`auth ${email}: HTTP ${r.status} ${await r.text()}`);
    const data = await r.json();
    return { token: data.access_token, userId: data.user?.id };
  }

  async function fetchOrphanIds(token, viewName) {
    const r = await fetch(`${URL}/rest/v1/${viewName}?select=id&order=id.asc`, { headers: H(token) });
    if (!r.ok) throw new Error(`${viewName}: HTTP ${r.status} ${await r.text()}`);
    return (await r.json()).map(x => x.id);
  }

  async function fetchRow(token, table, id) {
    const r = await fetch(`${URL}/rest/v1/${table}?id=eq.${id}&select=*`, { headers: H(token) });
    if (!r.ok) throw new Error(`${table} ${id}: HTTP ${r.status}`);
    const arr = await r.json();
    return arr[0] || null;
  }

  async function getIntegritySummary(token) {
    const r = await fetch(`${URL}/rest/v1/rpc/accounting_integrity_summary`, {
      method: "POST",
      headers: H(token),
      body: "{}",
    });
    if (!r.ok) throw new Error(`integrity_summary: HTTP ${r.status} ${await r.text()}`);
    return await r.json();
  }

  return { H, signIn, fetchOrphanIds, fetchRow, getIntegritySummary };
}

// ── Pure helpers (exported สำหรับ test) ─────────────────────
export function summarizeResults(results) {
  let posted = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status === "posted") posted++;
    else if (r.status === "skipped") skipped++;
    else if (r.status === "failed") failed++;
  }
  return { posted, skipped, failed, total: results.length };
}

export function formatSummaryLine(label, stats) {
  return `${label.padEnd(10)} ${stats.posted} posted · ${stats.skipped} skipped · ${stats.failed} failed (total ${stats.total})`;
}

// ── Process loop ────────────────────────────────────────────
async function processOrphans({ kind, table, viewName, postFn, adminToken, http, dryRun }) {
  console.log(`\n── ${kind.toUpperCase()}: fetching orphan ids from ${viewName} ──`);
  const ids = await http.fetchOrphanIds(adminToken, viewName);
  console.log(`Found ${ids.length} orphan ${kind}`);
  if (ids.length === 0) return [];

  const results = [];
  for (const id of ids) {
    try {
      const row = await http.fetchRow(adminToken, table, id);
      if (!row) {
        console.warn(`  [${id}] ⚠️  row not found in ${table} (view stale?)`);
        results.push({ id, status: "failed", reason: "row-not-found" });
        continue;
      }
      if (dryRun) {
        const amount = kind === "sales"
          ? (row.total_amount ?? row.grand_total)
          : row.amount;
        const dateField = kind === "sales" ? row.created_at : (row.expense_date || row.created_at);
        console.log(`  [${id}] WOULD post — date=${String(dateField).slice(0, 10)} amount=${amount}`);
        results.push({ id, status: "dry-run" });
        continue;
      }
      // Call the real auto_post function (via window shim)
      const jvId = await postFn(row);
      if (jvId) {
        console.log(`  [${id}] ✅ posted → JV ${jvId}`);
        results.push({ id, status: "posted", jvId });
      } else {
        // postFn returns null for: pre-effective date / no mapping / duplicate / RLS deny / unbalanced
        console.log(`  [${id}] ⏭️  skipped (pre-effective / duplicate / no-mapping — ดู console เหนือ)`);
        results.push({ id, status: "skipped" });
      }
    } catch (e) {
      console.error(`  [${id}] ❌ failed: ${e.message}`);
      results.push({ id, status: "failed", reason: e.message });
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const env = loadEnv(path.resolve(".env"));
  const URL = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const ANON = env.SUPABASE_ANON_KEY;
  const AD_EMAIL = env.ADMIN_EMAIL;
  const AD_PASS = env.ADMIN_PASSWORD;

  const DRY_RUN = process.argv.includes("--dry-run");
  const SALES_ONLY = process.argv.includes("--sales-only");
  const EXPENSES_ONLY = process.argv.includes("--expenses-only");

  const required = { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, ADMIN_EMAIL: AD_EMAIL, ADMIN_PASSWORD: AD_PASS };
  const missing = Object.entries(required).filter(([_k, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`[!] missing env vars: ${missing.join(", ")}`);
    console.error(`    Required: SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD`);
    process.exit(2);
  }

  console.log("═══ Phase 92.47 Backfill Orphan Journals ═══");
  console.log(`URL:  ${URL}`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no inserts)" : "LIVE"}`);
  if (SALES_ONLY) console.log("Scope: SALES-ONLY");
  if (EXPENSES_ONLY) console.log("Scope: EXPENSES-ONLY");
  console.log("");

  const http = makeHttp(URL, ANON);

  console.log("Auth: signing in admin...");
  const admin = await http.signIn(AD_EMAIL, AD_PASS);
  if (!admin.userId) {
    console.error("[!] auth response missing userId");
    process.exit(2);
  }
  console.log(`Admin uid: ${admin.userId}`);

  // Before snapshot
  console.log("\nBefore (integrity_summary):");
  const before = await http.getIntegritySummary(admin.token);
  console.log(`  sales_without_journal:    ${before.sales_without_journal}`);
  console.log(`  expenses_without_journal: ${before.expenses_without_journal}`);
  console.log(`  payroll_without_journal:  ${before.payroll_without_journal}`);

  // ── Window shim — MUST be set before importing auto_post.js ──
  // auto_post.js ใช้ window.SUPABASE_CONFIG / window._sbAccessToken / window._appAuthFetch
  // Node ไม่มี window → shim ก่อน import เพื่อ reuse logic เดิม
  globalThis.window = {
    SUPABASE_CONFIG: { url: URL, anonKey: ANON },
    _sbAccessToken: admin.token,
    showToast: (m) => console.log("  [toast]", m),
    App: { showToast: (m) => console.log("  [App.toast]", m) },
  };

  // Dynamic import — must come AFTER window shim
  // Compute file URL from this script's path (works on Windows + POSIX)
  const autoPostPath = path.resolve("modules/accounting/auto_post.js");
  const autoPostUrl = pathToFileURL(autoPostPath).href;
  const autoPost = await import(autoPostUrl);
  const { postJournalForSale, postJournalForExpense, resetMappingCache } = autoPost;

  if (typeof postJournalForSale !== "function" || typeof postJournalForExpense !== "function") {
    console.error("[!] failed to import postJournalForSale/postJournalForExpense");
    process.exit(2);
  }
  resetMappingCache(); // force fresh mapping fetch via our admin token

  // ── Process ────────────────────────────────────────────
  let saleResults = [];
  let expenseResults = [];

  if (!EXPENSES_ONLY) {
    saleResults = await processOrphans({
      kind: "sales",
      table: "sales",
      viewName: "vw_sales_without_journal",
      postFn: postJournalForSale,
      adminToken: admin.token,
      http,
      dryRun: DRY_RUN,
    });
  }

  if (!SALES_ONLY) {
    expenseResults = await processOrphans({
      kind: "expenses",
      table: "expenses",
      viewName: "vw_expenses_without_journal",
      postFn: postJournalForExpense,
      adminToken: admin.token,
      http,
      dryRun: DRY_RUN,
    });
  }

  // After snapshot (live only — dry-run ไม่เปลี่ยน)
  if (!DRY_RUN) {
    console.log("\nAfter (integrity_summary):");
    const after = await http.getIntegritySummary(admin.token);
    console.log(`  sales_without_journal:    ${after.sales_without_journal} (was ${before.sales_without_journal})`);
    console.log(`  expenses_without_journal: ${after.expenses_without_journal} (was ${before.expenses_without_journal})`);
    console.log(`  payroll_without_journal:  ${after.payroll_without_journal} (was ${before.payroll_without_journal})`);
  }

  // ── Summary ────────────────────────────────────────────
  console.log("\n═══ SUMMARY ═══");
  const saleStats = summarizeResults(saleResults);
  const expStats = summarizeResults(expenseResults);
  if (!EXPENSES_ONLY) console.log(formatSummaryLine("Sales:", saleStats));
  if (!SALES_ONLY) console.log(formatSummaryLine("Expenses:", expStats));

  if (DRY_RUN) {
    console.log("\nDRY-RUN — no rows inserted. Re-run without --dry-run to apply.");
  }

  const totalFailed = saleStats.failed + expStats.failed;
  if (totalFailed > 0) {
    console.error(`\n❌ ${totalFailed} rows failed — ดู error log ข้างบน`);
    process.exit(1);
  }
  console.log("\n✅ Done");
  process.exit(0);
}

// Only run main when invoked directly — allow `import` from tests without side effects
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (_e) { return false; }
})();

if (isMain) {
  main().catch((e) => {
    console.error("\nFATAL:", e?.message || String(e));
    if (e?.stack) console.error(e.stack);
    process.exit(2);
  });
}
