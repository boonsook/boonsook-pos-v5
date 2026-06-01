#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/verify_je_fix.js — verify non-admin auto-post REST path (entry + LINES)
//
//  ยิงเส้นทางเดียวกับ auto_post.js เป๊ะ (POST journal_entries → POST journal_lines)
//  ในฐานะ non-admin ผ่าน REST จริง.
//
//  ★ ทำไมต้องมีตัวนี้ (เพิ่มจาก verify:accounting):
//    verify:accounting A2 ทดสอบแค่ POST journal_entries (entry) — ไม่แตะ
//    journal_lines เลย. แต่ jl_insert_auto เช็ค parent ผ่าน
//    EXISTS(SELECT FROM journal_entries) ซึ่งโดน je_select RLS (admin-only)
//    ครอบ → non-admin insert lines ไม่ได้แม้ entry ผ่านแล้ว. ตัวนี้จับ gap นั้น.
//
//  Run (หลัง REST 403 ของ entry ถูกแก้ — เช่น restart PostgREST):
//    node scripts/verify_je_fix.js   (หรือ npm run verify:je)
//  Reads .env เดิม: SUPABASE_URL / SUPABASE_ANON_KEY /
//                   NONADMIN_EMAIL / NONADMIN_PASSWORD / ADMIN_EMAIL / ADMIN_PASSWORD
//
//  Pass = [E] 201 + [L] 201  → auto-post ของ sales role ทำงานครบ
//  Exit: 0 pass · 1 RLS ยัง block · 2 fatal (auth/env/no account_code)
//  Cleanup: admin ลบ entry ที่ทดสอบ (ON DELETE CASCADE เก็บ lines ให้)
// ═══════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) { console.error(`[!] ${file} not found`); process.exit(2); }
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

const env  = loadEnv(path.resolve(".env"));
const URL  = (env.SUPABASE_URL || "").replace(/\/$/, "");
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

const H = (token, prefer = "return=representation") => ({
  apikey: ANON,
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  Prefer: prefer,
});

const isRls = (status, body) =>
  status === 403 || status === 401 || /42501|row-level security/i.test(body || "");

(async () => {
  if (!URL || !ANON) { console.error("[!] missing SUPABASE_URL / SUPABASE_ANON_KEY in .env"); process.exit(2); }

  console.log("═══ verify Phase 92.46c — auto-post path as NON-admin (via REST) ═══\n");

  let na, ad;
  try {
    na = await signIn(env.NONADMIN_EMAIL, env.NONADMIN_PASSWORD);
    ad = await signIn(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  } catch (e) {
    console.error("[!] auth failed:", e.message);
    console.error("    ตรวจ .env: NONADMIN_EMAIL/PASSWORD + ADMIN_EMAIL/PASSWORD");
    process.exit(2);
  }
  console.log(`non-admin uid: ${na.userId}`);
  console.log(`admin uid:     ${ad.userId}\n`);

  // ── หา account_code จริง (FK → chart_of_accounts) ด้วย admin token ──
  let acct = null;
  try {
    const r = await fetch(
      `${URL}/rest/v1/chart_of_accounts?select=code&is_active=eq.true&limit=1`,
      { headers: H(ad.token) }
    );
    const arr = await r.json();
    acct = Array.isArray(arr) ? arr[0]?.code : null;
  } catch (_e) { /* */ }
  if (!acct) { console.error("[!] หา account_code ที่ active ไม่ได้ (chart_of_accounts ว่าง?)"); process.exit(2); }
  console.log(`account_code ที่ใช้ทดสอบ: ${acct}\n`);

  const stamp   = Date.now();
  const today   = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  let entryId   = null;
  let entryPass = false;
  let linesPass = false;

  // ── [E] entry insert เป็น non-admin (Bug 1 gate) ──
  console.log("[E] non-admin POST journal_entries (source_table='sales')");
  {
    const r = await fetch(`${URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: H(na.token),
      body: JSON.stringify({
        doc_no: `VERIFY-46C-${stamp}`,
        doc_type: "SV",
        doc_date: today,
        description: "verify 92.46c (rolled back via admin delete)",
        status: "approved",
        total_debit: 10,
        total_credit: 10,
        source_table: "sales",
        source_id: -stamp,          // ปลอม/ไม่ชน unique (real sales id เป็นบวก)
        approved_at: new Date().toISOString(),
      }),
    });
    const body = await r.text();
    if (r.ok) {
      try { entryId = JSON.parse(body)[0]?.id; } catch (_e) { /* */ }
      entryPass = !!entryId;
      console.log(`    → HTTP ${r.status} ✅ (id=${entryId})`);
    } else {
      console.log(`    → HTTP ${r.status} ❌  ${isRls(r.status, body) ? "[RLS block — Bug 1 ยังไม่หาย]" : "[non-RLS error]"}`);
      console.log(`    body: ${body.slice(0, 200)}`);
    }
  }

  // ── [L] lines insert เป็น non-admin (Bug 2 gate) — ต่อเมื่อ entry ผ่าน ──
  if (entryPass) {
    console.log("\n[L] non-admin POST journal_lines (2 บรรทัด balanced)");
    const r = await fetch(`${URL}/rest/v1/journal_lines`, {
      method: "POST",
      headers: H(na.token, "return=minimal"),
      body: JSON.stringify([
        { entry_id: entryId, line_no: 1, account_code: acct, debit: 10, credit: 0,  description: "verify dr" },
        { entry_id: entryId, line_no: 2, account_code: acct, debit: 0,  credit: 10, description: "verify cr" },
      ]),
    });
    const body = await r.text();
    if (r.ok) {
      linesPass = true;
      console.log(`    → HTTP ${r.status} ✅`);
    } else {
      console.log(`    → HTTP ${r.status} ❌  ${isRls(r.status, body) ? "[RLS block — Bug 2: jl_insert_auto/helper]" : "[non-RLS error: FK/CHECK?]"}`);
      console.log(`    body: ${body.slice(0, 200)}`);
    }
  } else {
    console.log("\n[L] skipped — entry ไม่ผ่าน (แก้ Bug 1 ก่อน)");
  }

  // ── cleanup (admin) — ลบ entry, CASCADE เก็บ lines ──
  if (entryId) {
    const r = await fetch(`${URL}/rest/v1/journal_entries?id=eq.${entryId}`, { method: "DELETE", headers: H(ad.token, "return=minimal") });
    console.log(`\n[cleanup] admin delete entry ${entryId} → HTTP ${r.status}${r.ok ? "" : " ⚠️ ลบไม่ออก (ลบ manual ใน UI)"}`);
  }

  // ── verdict ──
  console.log("\n═══ ผลสรุป ═══");
  console.log(`  Bug 1 (entry insert): ${entryPass ? "✅ ผ่าน" : "❌ ยัง block"}`);
  console.log(`  Bug 2 (lines insert): ${linesPass ? "✅ ผ่าน" : (entryPass ? "❌ ยัง block" : "— (ไม่ได้ทดสอบ)")}`);
  if (entryPass && linesPass) {
    console.log("\n🎉 PASS — auto-post ของ sales role ทำงานครบ entry+lines แล้ว (Bug 1+2 ปิด)");
    process.exit(0);
  }
  console.log("\n⚠️ ยังไม่ผ่าน — ดู body ด้านบน + paste output section (8) ของ SQL กลับมา");
  process.exit(1);
})().catch((e) => {
  console.error("[!] fatal:", e.message);
  process.exit(2);
});
