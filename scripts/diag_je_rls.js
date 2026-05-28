#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/diag_je_rls.js — Active probe ของ journal_entries RLS
//
//  ไม่ต้องการ Supabase Dashboard access — probe ผ่าน REST ด้วย admin+non-admin tokens
//
//  Run: node scripts/diag_je_rls.js
//  Reads .env เดิม (SUPABASE_URL/ANON_KEY/NONADMIN/ADMIN creds)
//
//  Scenarios (narrow down what makes A2 fail):
//    D1 admin POST baseline (source_table='sales')          — expect 201 (proves schema OK)
//    D2 non-admin POST baseline                              — expect 403 (reproduce A2)
//    D3 non-admin POST status='draft' (not 'approved')       — probe if status=approved triggers RLS
//    D4 non-admin POST omit approved_at                      — probe if approved_at flagged
//    D5 non-admin POST source_table='expenses' instead       — probe if 'sales' specifically blocked
//    D6 non-admin POST source_table='service_jobs'           — probe other whitelist value
//    D7 non-admin POST minimal fields (only required)        — strip optional fields
//
//  Output: which scenarios PASS/FAIL → pinpoint root cause
//  Cleanup: admin deletes ทุก row ที่ insert สำเร็จ
// ═══════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) { console.error(`[!] ${file} not found`); process.exit(1); }
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

async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`auth ${email}: HTTP ${r.status}`);
  const d = await r.json();
  return { token: d.access_token, userId: d.user?.id };
}

const H = (token) => ({
  apikey: ANON,
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

const TAG = "DIAG-" + Date.now();
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

const inserted = [];

async function tryInsert(label, token, payload) {
  const r = await fetch(`${URL}/rest/v1/journal_entries`, {
    method: "POST",
    headers: H(token),
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let id = null;
  if (r.ok) {
    try {
      const arr = JSON.parse(text);
      id = arr[0]?.id;
      if (id) inserted.push(id);
    } catch (_e) { /* */ }
  }
  console.log(`  ${label}: HTTP ${r.status}${id ? ` (id=${id})` : ""}`);
  if (!r.ok) console.log(`    body: ${text.slice(0, 200)}`);
  return { status: r.status, ok: r.ok, body: text, id };
}

(async () => {
  console.log("═══ Active RLS probe — journal_entries ═══\n");
  const na = await signIn(env.NONADMIN_EMAIL, env.NONADMIN_PASSWORD);
  const ad = await signIn(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  console.log(`non-admin uid: ${na.userId}`);
  console.log(`admin uid:     ${ad.userId}`);

  // Baseline payload (same as A2)
  const base = {
    doc_type: "SV",
    doc_date: TODAY,
    description: "diag probe",
    status: "approved",
    total_debit: 10,
    total_credit: 10,
    source_table: "sales",
    source_id: -1,  // fake id (no FK on source_id)
    approved_at: new Date().toISOString(),
  };

  console.log("\n[D1] admin POST baseline (source_table='sales')");
  await tryInsert("D1", ad.token, { ...base, doc_no: TAG + "-D1" });

  console.log("\n[D2] non-admin POST baseline (reproduce A2)");
  await tryInsert("D2", na.token, { ...base, doc_no: TAG + "-D2" });

  console.log("\n[D3] non-admin POST status='draft' (not 'approved')");
  const d3 = { ...base, status: "draft", approved_at: null };
  delete d3.approved_at;
  await tryInsert("D3", na.token, { ...d3, doc_no: TAG + "-D3" });

  console.log("\n[D4] non-admin POST omit approved_at (status='approved' but no approved_at)");
  const { approved_at: _a, ...d4 } = base;
  void _a;
  await tryInsert("D4", na.token, { ...d4, doc_no: TAG + "-D4" });

  console.log("\n[D5] non-admin POST source_table='expenses' (other whitelist value)");
  await tryInsert("D5", na.token, { ...base, source_table: "expenses", doc_no: TAG + "-D5" });

  console.log("\n[D6] non-admin POST source_table='service_jobs'");
  await tryInsert("D6", na.token, { ...base, source_table: "service_jobs", doc_no: TAG + "-D6" });

  console.log("\n[D7] non-admin POST minimal (no status, no approved_at — DB defaults)");
  const d7 = {
    doc_no: TAG + "-D7",
    doc_type: "JV",
    doc_date: TODAY,
    description: "diag minimal",
    total_debit: 10,
    total_credit: 10,
    source_table: "sales",
    source_id: -7,
  };
  await tryInsert("D7", na.token, d7);

  // ── Cleanup ───────────────────────────────────────────────
  console.log("\n[cleanup] deleting inserted rows...");
  for (const id of inserted) {
    const r = await fetch(`${URL}/rest/v1/journal_entries?id=eq.${id}`, { method: "DELETE", headers: H(ad.token) });
    console.log(`  delete id=${id} → HTTP ${r.status}`);
  }

  console.log("\n═══ Analysis hint ═══");
  console.log("- D1 PASS + D2 FAIL → RLS specifically blocks non-admin (expected if whitelist broken)");
  console.log("- D1 FAIL too        → schema/trigger issue (not RLS)");
  console.log("- D3 PASS + D2 FAIL → status='approved' triggers something (custom trigger or column-level RLS)");
  console.log("- D4 PASS + D2 FAIL → approved_at field flagged");
  console.log("- D5/D6 PASS         → 'sales' specifically blocked (table-level GRANT on sales?)");
  console.log("- D7 PASS            → optional fields cause issue");
  console.log("- All D2-D7 FAIL     → table-level GRANT INSERT missing OR catch-all RESTRICTIVE policy");
})().catch((e) => {
  console.error("[!] fatal:", e.message);
  process.exit(2);
});
