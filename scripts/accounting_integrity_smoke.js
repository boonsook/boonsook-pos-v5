#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/accounting_integrity_smoke.js — Phase 92.46 verification
//
//  จุดประสงค์: automated end-to-end smoke ของ auto-journal RLS หลัง
//  apply supabase-phase92-46-je-rls-rerun-and-tighten.sql
//
//  Run:
//    1. cp .env.example → .env (ถ้ายังไม่มี)
//    2. ใส่ test account credentials
//    3. node scripts/accounting_integrity_smoke.js
//    หรือ npm run verify:accounting
//
//  Output: matrix + exit 0 (all PASS) / 1 (any FAIL) / 2 (fatal)
//
//  Node 20+ built-in fetch — no npm dep
//
//  Side effects: สร้าง 2 test rows (sales + journal_entries) แล้ว cleanup ตอนจบ
//    sales row: order_no LIKE 'TEST-92-46-%'
//    journal_entries: doc_no LIKE 'TEST-92-46-%'
// ═══════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`[!] ${file} not found — copy .env.example → .env แล้วใส่ test creds`);
    console.error(`    Required: SUPABASE_URL, SUPABASE_ANON_KEY, NONADMIN_EMAIL/PASSWORD, ADMIN_EMAIL/PASSWORD`);
    process.exit(1);
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

const env = loadEnv(path.resolve(".env"));
const URL = (env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;
const NA_EMAIL = env.NONADMIN_EMAIL;
const NA_PASS  = env.NONADMIN_PASSWORD;
const AD_EMAIL = env.ADMIN_EMAIL;
const AD_PASS  = env.ADMIN_PASSWORD;

const required = { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, NONADMIN_EMAIL: NA_EMAIL, NONADMIN_PASSWORD: NA_PASS, ADMIN_EMAIL: AD_EMAIL, ADMIN_PASSWORD: AD_PASS };
const missing = Object.entries(required).filter(([_k, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`[!] missing env vars: ${missing.join(", ")}`);
  console.error(`    Required: SUPABASE_URL, SUPABASE_ANON_KEY, NONADMIN_EMAIL/PASSWORD, ADMIN_EMAIL/PASSWORD`);
  process.exit(1);
}

// ── HTTP helpers ────────────────────────────────────────────
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

const H = (token, extra = {}) => Object.assign({
  apikey: ANON,
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
}, extra);

const TEST_TAG = "TEST-92-46-" + Date.now();
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

// ── Test results accumulator ────────────────────────────────
const results = [];
function record(name, http, verdict, note = "") {
  results.push({ name, http: String(http), verdict, note });
}
const isReject = (h) => h >= 400 && h < 600;

// ── Main ────────────────────────────────────────────────────
(async () => {
  console.log("═══ Phase 92.46 Accounting Integrity Smoke ═══");
  console.log(`URL: ${URL}`);
  console.log(`Test tag: ${TEST_TAG}`);
  console.log("auth: signing in...");
  const na = await signIn(NA_EMAIL, NA_PASS);
  const ad = await signIn(AD_EMAIL, AD_PASS);
  console.log(`  non-admin uid: ${na.userId}`);
  console.log(`  admin uid:     ${ad.userId}`);
  if (!na.userId || !ad.userId) {
    console.error("[!] uid missing from auth response");
    process.exit(1);
  }
  if (na.userId === ad.userId) {
    console.error("[!] non-admin and admin are same user — please use different accounts");
    process.exit(1);
  }

  const insertedSales = [];
  const insertedJournals = [];

  // ── A1: admin RPC sanity ─────────────────────────────────
  console.log("\n[A1] admin RPC accounting_integrity_summary()");
  let baselineSummary = null;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/accounting_integrity_summary`, {
      method: "POST",
      headers: H(ad.token),
      body: "{}",
    });
    const text = await r.text();
    console.log(`  HTTP ${r.status}`);
    if (!r.ok) {
      record("A1 admin RPC summary", r.status, "FAIL", `not 200: ${text.slice(0, 200)}`);
    } else {
      baselineSummary = JSON.parse(text);
      const hasAll = ["sales_without_journal", "expenses_without_journal", "payroll_without_journal", "checked_at"]
        .every(k => k in baselineSummary);
      record("A1 admin RPC summary", r.status, hasAll ? "PASS" : "FAIL",
        hasAll ? `keys ok: sales=${baselineSummary.sales_without_journal}, exp=${baselineSummary.expenses_without_journal}, payroll=${baselineSummary.payroll_without_journal}`
               : `missing keys: ${JSON.stringify(baselineSummary).slice(0, 150)}`);
    }
  } catch (e) {
    record("A1 admin RPC summary", "ERR", "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── A2: sales create sale + auto-post journal flow ───────
  console.log("\n[A2] sales role creates sale + posts journal_entries");
  let saleId;
  let entryId;
  try {
    // A2.1: sales POST /rest/v1/sales — minimum payload จาก pos.js
    const salePayload = {
      order_no: TEST_TAG + "-S1",
      customer_name: "smoke test",
      payment_method: "cash",
      subtotal: 10,
      total_amount: 10,
      paid_amount: 10,
      change_amount: 0,
      discount_type: null,
      discount_value: 0,
      discount_amount: 0,
      vat_amount: 0,
      vat_rate: 0,
      subtotal_before_vat: null,
      note: "smoke test 92.46",
      created_by: na.userId,
    };
    const rSale = await fetch(`${URL}/rest/v1/sales`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify(salePayload),
    });
    if (!rSale.ok) {
      const txt = await rSale.text();
      record("A2 sales POST sale", rSale.status, "FAIL", `sale create failed: ${txt.slice(0, 200)}`);
      throw new Error("sale create failed — skipping rest of A2");
    }
    const saleArr = await rSale.json();
    saleId = saleArr[0]?.id;
    if (saleId) insertedSales.push(saleId);
    console.log(`  sale created id=${saleId}`);

    // A2.2: sales POST /rest/v1/journal_entries (whitelist: source_table='sales')
    const jePayload = {
      doc_no: TEST_TAG + "-JE1",
      doc_type: "SV",
      doc_date: TODAY,
      description: "smoke test 92.46 auto-post",
      status: "approved",
      total_debit: 10,
      total_credit: 10,
      source_table: "sales",
      source_id: saleId,
      approved_at: new Date().toISOString(),
    };
    const rJe = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify(jePayload),
    });
    const jeText = await rJe.text();
    console.log(`  je HTTP ${rJe.status}`);
    if (!rJe.ok) {
      // นี่คือ regression ของ Phase 92.46 — sales role ต้อง insert journal ของ sale ตัวเองได้
      record("A2 sales POST journal (whitelist)", rJe.status, "FAIL",
        `RLS denied — phase 92.46 SQL ไม่ได้ apply หรือ je_insert_auto ขาด whitelist? body: ${jeText.slice(0, 200)}`);
    } else {
      const jeArr = JSON.parse(jeText);
      entryId = jeArr[0]?.id;
      if (entryId) insertedJournals.push(entryId);
      record("A2 sales POST journal (whitelist)", rJe.status, "PASS",
        `entry created id=${entryId} doc_no=${TEST_TAG}-JE1`);
    }
  } catch (e) {
    if (!results.find(r => r.name.startsWith("A2"))) {
      record("A2 sales POST sale", "ERR", "FAIL", String(e.message || e).slice(0, 200));
    }
  }

  // ── A2.3: verify summary doesn't increase ──
  console.log("\n[A2b] verify accounting_integrity_summary().sales_without_journal คงเดิม");
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/accounting_integrity_summary`, {
      method: "POST", headers: H(ad.token), body: "{}",
    });
    if (!r.ok) {
      record("A2b summary unchanged", r.status, "FAIL", `summary call failed: ${(await r.text()).slice(0,150)}`);
    } else {
      const post = await r.json();
      const baseN = baselineSummary?.sales_without_journal ?? null;
      const postN = post.sales_without_journal;
      const pass = baseN !== null && postN === baseN;
      record("A2b summary unchanged", r.status, pass ? "PASS" : "FAIL",
        `baseline=${baseN} after=${postN} → ${pass ? "no orphan added" : "orphan count drifted"}`);
    }
  } catch (e) {
    record("A2b summary unchanged", "ERR", "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── A3: sales POST journal_entries with NON-whitelist source_table ──
  console.log("\n[A3] sales POST journal w/ non-whitelist source_table (negative)");
  try {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        doc_no: TEST_TAG + "-MAL",
        doc_type: "JV",
        doc_date: TODAY,
        description: "malicious source_table test",
        status: "approved",
        total_debit: 0.01,
        total_credit: 0.01,
        source_table: "definitely_not_whitelisted",
        source_id: 1,
        approved_at: new Date().toISOString(),
      }),
    });
    const text = await r.text();
    console.log(`  HTTP ${r.status}`);
    const rejected = isReject(r.status);
    if (!rejected) {
      // ถ้าผ่าน → cleanup ด้วย
      try {
        const arr = JSON.parse(text);
        if (arr[0]?.id) insertedJournals.push(arr[0].id);
      } catch (_e) { /* */ }
    }
    record("A3 non-whitelist source_table", r.status, rejected ? "PASS" : "FAIL",
      rejected ? `rejected (good): ${text.slice(0, 120)}` : `unexpectedly accepted! whitelist missing`);
  } catch (e) {
    record("A3 non-whitelist source_table", "ERR", "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── A4: sales POST journal_entries without source_table+source_id ──
  console.log("\n[A4] sales POST journal w/o source_table (negative — admin only allowed)");
  try {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        doc_no: TEST_TAG + "-NOS",
        doc_type: "JV",
        doc_date: TODAY,
        description: "no source test",
        status: "approved",
        total_debit: 0.01,
        total_credit: 0.01,
        source_table: null,
        source_id: null,
        approved_at: new Date().toISOString(),
      }),
    });
    const text = await r.text();
    console.log(`  HTTP ${r.status}`);
    const rejected = isReject(r.status);
    if (!rejected) {
      try { const arr = JSON.parse(text); if (arr[0]?.id) insertedJournals.push(arr[0].id); } catch (_e) { /* */ }
    }
    record("A4 no source_table (non-admin)", r.status, rejected ? "PASS" : "FAIL",
      rejected ? `rejected (good): ${text.slice(0, 120)}` : `unexpectedly accepted! manual JV allowed for non-admin`);
  } catch (e) {
    record("A4 no source_table (non-admin)", "ERR", "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── A5: admin views accessible ──
  console.log("\n[A5] admin SELECT from 3 integrity views");
  for (const v of ["vw_sales_without_journal", "vw_expenses_without_journal", "vw_payroll_without_journal"]) {
    try {
      const r = await fetch(`${URL}/rest/v1/${v}?select=id&limit=1`, { headers: H(ad.token) });
      const text = await r.text();
      record(`A5 view ${v}`, r.status, r.ok ? "PASS" : "FAIL",
        r.ok ? `accessible (${(JSON.parse(text)||[]).length} rows in sample)` : `${text.slice(0, 150)}`);
    } catch (e) {
      record(`A5 view ${v}`, "ERR", "FAIL", String(e.message || e).slice(0, 200));
    }
  }

  // ── A6: non-admin RPC (negative) ──
  console.log("\n[A6] non-admin RPC accounting_integrity_summary (negative)");
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/accounting_integrity_summary`, {
      method: "POST", headers: H(na.token), body: "{}",
    });
    const text = await r.text();
    const rejected = isReject(r.status);
    const hasAdminOnly = text.toLowerCase().includes("admin only") || text.includes("42501");
    const pass = rejected && hasAdminOnly;
    record("A6 non-admin RPC (neg)", r.status, pass ? "PASS" : "FAIL",
      pass ? `rejected with admin-only` : `unexpected: ${text.slice(0, 180)}`);
  } catch (e) {
    record("A6 non-admin RPC (neg)", "ERR", "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── Cleanup ───────────────────────────────────────────────
  console.log("\n[cleanup] deleting test rows...");
  for (const id of insertedJournals.filter(Boolean)) {
    try {
      // ลบ lines ก่อน (FK) — ใช้ admin token (RLS allow DELETE)
      await fetch(`${URL}/rest/v1/journal_lines?entry_id=eq.${id}`, { method: "DELETE", headers: H(ad.token) });
      const r = await fetch(`${URL}/rest/v1/journal_entries?id=eq.${id}`, { method: "DELETE", headers: H(ad.token) });
      console.log(`  delete je id=${id} → HTTP ${r.status}`);
    } catch (e) {
      console.log(`  delete je id=${id} failed: ${e.message}`);
    }
  }
  for (const id of insertedSales.filter(Boolean)) {
    try {
      await fetch(`${URL}/rest/v1/sale_items?sale_id=eq.${id}`, { method: "DELETE", headers: H(ad.token) });
      const r = await fetch(`${URL}/rest/v1/sales?id=eq.${id}`, { method: "DELETE", headers: H(ad.token) });
      console.log(`  delete sale id=${id} → HTTP ${r.status}`);
    } catch (e) {
      console.log(`  delete sale id=${id} failed: ${e.message}`);
    }
  }

  // ── Final matrix ──────────────────────────────────────────
  console.log("\n═══ Final Matrix ═══");
  const col = (s, n) => String(s).slice(0, n).padEnd(n);
  console.log(col("scenario", 38) + " | " + col("HTTP", 5) + " | " + "verdict");
  console.log("-".repeat(70));
  for (const r of results) {
    console.log(col(r.name, 38) + " | " + col(r.http, 5) + " | " + r.verdict);
    if (r.note) console.log("    └─ " + r.note);
  }

  const allPass = results.length > 0 && results.every(r => r.verdict === "PASS");
  console.log("\n" + "═".repeat(60));
  if (allPass) {
    console.log("✅ ALL PASS — Phase 92.46 auto-journal RLS verified end-to-end");
    process.exit(0);
  } else {
    console.log("❌ FAIL — review failed scenarios above");
    process.exit(1);
  }
})().catch((e) => {
  console.error("\n[!] fatal:", e.message || e);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(2);
});
