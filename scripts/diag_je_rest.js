#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/diag_je_rest.js — ชี้ขาดว่าทำไม A2 REST ยัง 403 หลัง restart
//
//  Context: full project restart แล้ว A2 ยัง 403 → PostgREST cache ตัดทิ้งได้.
//  DB direct insert (SET LOCAL ROLE authenticated + sales jwt) ผ่าน แต่ REST fail.
//  Script นี้แยกสาเหตุที่เหลือแบบ empirical (ไม่เดา):
//    [JWT] role claim ของ non-admin = 'authenticated' จริงไหม
//    [1] ADMIN insert คืน source_table/source_id ครบไหม → จับ PostgREST drop column (schema cache)
//    [2] NON-ADMIN insert (A2 repro) → error body เต็ม
//    [3] NON-ADMIN insert return=minimal → แยก representation/SELECT-back ออกจาก INSERT
//
//  Run: node scripts/diag_je_rest.js   (อ่าน .env เดิม) — temporary diag, ลบทิ้งได้
//  Side effect: admin insert 1 row + cleanup; non-admin rows ถ้าผ่านก็ cleanup
// ═══════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) { console.error(`[!] ${file} not found`); process.exit(2); }
  const e = {};
  for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    e[m[1]] = v;
  }
  return e;
}

const env  = loadEnv(path.resolve(".env"));
const URL  = (env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return {}; }
}

async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`auth ${email}: HTTP ${r.status} ${t.slice(0, 150)}`);
  return JSON.parse(t);
}

const H = (token, prefer) => ({
  apikey: ANON,
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  ...(prefer ? { Prefer: prefer } : {}),
});

const stamp = Date.now();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const mkPayload = (tag, sid) => ({
  doc_no: `DIAG-REST-${stamp}-${tag}`,
  doc_type: "SV",
  doc_date: today,
  description: "diag rest 92.46",
  status: "approved",
  total_debit: 10,
  total_credit: 10,
  source_table: "sales",
  source_id: sid,
  approved_at: new Date().toISOString(),
});

(async () => {
  if (!URL || !ANON) { console.error("[!] missing SUPABASE_URL / SUPABASE_ANON_KEY"); process.exit(2); }
  console.log("═══ diag_je_rest — pinpoint A2 REST 403 (cache already ruled out) ═══");
  console.log("project:", URL);

  const naResp = await signIn(env.NONADMIN_EMAIL, env.NONADMIN_PASSWORD);
  const adResp = await signIn(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const na = { token: naResp.access_token, userId: naResp.user?.id };
  const ad = { token: adResp.access_token, userId: adResp.user?.id };
  for (const [lbl, d] of [["NON-ADMIN", na], ["ADMIN", ad]]) {
    const c = decodeJwt(d.token);
    console.log(`\n[JWT ${lbl}] role=${JSON.stringify(c.role)} sub=${c.sub} aud=${JSON.stringify(c.aud)}`
      + (c.role !== "authenticated" ? "  ← ⚠️ role ไม่ใช่ 'authenticated' (policy TO authenticated จะไม่ apply!)" : ""));
  }

  const cleanup = [];

  // [1] ADMIN insert — PostgREST เก็บ source_table/source_id ครบไหม?
  {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST", headers: H(ad.token, "return=representation"), body: JSON.stringify(mkPayload("ADM", -stamp)),
    });
    const t = await r.text();
    let row = null; try { row = JSON.parse(t)[0]; } catch { /* */ }
    if (row?.id) cleanup.push(row.id);
    console.log(`\n[1] ADMIN insert (return=representation): HTTP ${r.status}`);
    if (row) console.log(`    persisted: source_table=${JSON.stringify(row.source_table)} source_id=${JSON.stringify(row.source_id)}`
      + (row.source_table === null || row.source_id === null ? "  ← ⚠️ PostgREST DROPPED source cols (schema cache!)" : "  ← cols OK"));
    else console.log(`    body: ${t.slice(0, 220)}`);
  }

  // [2] NON-ADMIN insert — A2 repro, error body เต็ม
  {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST", headers: H(na.token, "return=representation"), body: JSON.stringify(mkPayload("NAD", -stamp - 1)),
    });
    const t = await r.text();
    let row = null; try { row = JSON.parse(t)[0]; } catch { /* */ }
    if (row?.id) cleanup.push(row.id);
    console.log(`\n[2] NON-ADMIN insert (A2 repro): HTTP ${r.status}`);
    console.log(`    body: ${t.slice(0, 280)}`);
  }

  // [3] NON-ADMIN insert return=minimal — แยก representation/SELECT-back ออก
  {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST", headers: H(na.token, "return=minimal"), body: JSON.stringify(mkPayload("NMIN", -stamp - 2)),
    });
    const t = await r.text();
    console.log(`\n[3] NON-ADMIN insert (return=minimal): HTTP ${r.status}`
      + (r.ok ? "  ← ✅ PASS! representation/SELECT-back คือตัวบล็อก ไม่ใช่ INSERT" : ""));
    if (!r.ok) console.log(`    body: ${t.slice(0, 220)}`);
    else {
      const q = await fetch(`${URL}/rest/v1/journal_entries?select=id&doc_no=eq.DIAG-REST-${stamp}-NMIN`, { headers: H(ad.token) });
      const arr = await q.json(); if (Array.isArray(arr)) arr.forEach(x => cleanup.push(x.id));
    }
  }

  // [4] NON-ADMIN insert return=headers-only — ได้ id จาก Location โดยไม่ SELECT-back?
  {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST", headers: H(na.token, "return=headers-only"), body: JSON.stringify(mkPayload("NHDR", -stamp - 3)),
    });
    const loc = r.headers.get("location") || "";
    const t = await r.text();
    console.log(`\n[4] NON-ADMIN insert (return=headers-only): HTTP ${r.status}`
      + (r.ok ? `  ← ✅ PASS! Location=${loc}` : ""));
    if (!r.ok) console.log(`    body: ${t.slice(0, 200)}`);
    else { const m = loc.match(/id=eq\.(-?\d+)/); if (m) cleanup.push(m[1]); }
  }

  for (const id of cleanup) {
    await fetch(`${URL}/rest/v1/journal_entries?id=eq.${id}`, { method: "DELETE", headers: H(ad.token, "return=minimal") });
  }
  console.log(`\n[cleanup] removed ${cleanup.length} test rows`);

  console.log("\n═══ วิธีอ่านผล ═══");
  console.log("- [JWT] non-admin role ≠ authenticated      → fix: JWT/role claim (ไม่ใช่ policy) — 92.46c ไม่ช่วย");
  console.log("- [1] source cols = null                    → PostgREST schema cache เก่า drop column → reload schema / redeploy");
  console.log("- [3] minimal PASS แต่ representation FAIL    → je_select (admin-only) บล็อก SELECT-back → INSERT จริงผ่าน!");
  console.log("- [2] 'violates RLS' + [1] OK + [3] FAIL     → WITH CHECK false จริงผ่าน REST → ค่อย apply 92.46c (force-reset)");
})().catch((e) => { console.error("[!] fatal:", e.message); process.exit(2); });
