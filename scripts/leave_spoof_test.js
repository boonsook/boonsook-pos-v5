#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  scripts/leave_spoof_test.js — Phase 92.45 security verification
//
//  จุดประสงค์: ทดสอบว่า DB trigger + RPC ปิดช่อง "non-admin spoof
//  reviewer fields" ของ staff_leaves จริงหรือไม่ (S3)
//
//  Run:
//    1. Copy .env.example → .env (อยู่นอก git แล้ว — ห้าม commit)
//    2. ใส่ค่า test account credentials (non-admin + admin จริง)
//    3. node scripts/leave_spoof_test.js
//
//  Output: matrix + exit code 0 (all PASS) หรือ 1 (any FAIL)
//
//  Node 20+ (built-in fetch) — ไม่มี npm dependency
//
//  Side effects: สร้าง test rows 4 แถว แล้ว cleanup ตอนจบ
//    (ใช้ leave_type=sick/vacation, reason="spoof test ...")
// ═══════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

// ── .env loader (ไม่ใช้ dotenv เพราะนโยบาย no runtime dep) ────
function loadEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`[!] ${file} not found — copy .env.example → .env แล้วใส่ credentials`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
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

async function selectRow(adminToken, id) {
  const r = await fetch(
    `${URL}/rest/v1/staff_leaves?id=eq.${id}&select=id,user_id,status,reviewed_by,reviewed_at,review_note,leave_type,start_date,end_date,created_by`,
    { headers: H(adminToken) }
  );
  if (!r.ok) return { _err: `HTTP ${r.status}` };
  const arr = await r.json();
  return arr[0] || { _err: "not found" };
}

async function deleteRow(adminToken, id) {
  return fetch(`${URL}/rest/v1/staff_leaves?id=eq.${id}`, { method: "DELETE", headers: H(adminToken) });
}

async function adminInsertPending(adminToken, naUserId, dayOffset, reason) {
  const date = `2026-05-${String(28 + dayOffset).padStart(2, "0")}`;
  const r = await fetch(`${URL}/rest/v1/staff_leaves`, {
    method: "POST",
    headers: H(adminToken, { Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: naUserId,
      leave_type: "sick",
      start_date: date,
      end_date: date,
      days_count: 1,
      reason,
      status: "pending",
    }),
  });
  if (!r.ok) throw new Error(`adminInsertPending: HTTP ${r.status} ${await r.text()}`);
  const arr = await r.json();
  return arr[0]?.id;
}

// ── Test results accumulator ────────────────────────────────
const results = [];
function record(name, http, db, verdict, note = "") {
  results.push({
    name,
    http: String(http),
    status: db?.status || "—",
    reviewed_by: db?.reviewed_by || "null",
    reviewed_at: db?.reviewed_at || "null",
    verdict,
    note,
  });
}
function isReject(http) { return http >= 400 && http < 600; }

// ── Main ────────────────────────────────────────────────────
(async () => {
  console.log("═══ Phase 92.45 Leave Spoof Test ═══");
  console.log(`URL: ${URL}`);
  console.log("auth: signing in...");
  const na = await signIn(NA_EMAIL, NA_PASS);
  const ad = await signIn(AD_EMAIL, AD_PASS);
  console.log(`  non-admin uid: ${na.userId}`);
  console.log(`  admin uid:     ${ad.userId}`);
  if (!na.userId || !ad.userId) {
    console.error("[!] uid missing — auth response shape unexpected");
    process.exit(1);
  }
  if (na.userId === ad.userId) {
    console.error("[!] non-admin and admin are same user — please use different accounts");
    process.exit(1);
  }

  const insertedIds = [];

  // ── T1: non-admin INSERT spoof ─────────────────────────────
  console.log("\n[T1] non-admin INSERT spoof");
  try {
    const r = await fetch(`${URL}/rest/v1/staff_leaves`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: na.userId,
        leave_type: "sick",
        start_date: "2026-05-28",
        end_date: "2026-05-28",
        days_count: 1,
        reason: "spoof test T1",
        status: "approved",
        reviewed_by: "00000000-0000-0000-0000-000000000000",
        reviewed_at: "2026-05-28T00:00:00Z",
        review_note: "fake approve",
      }),
    });
    const text = await r.text();
    console.log(`  HTTP ${r.status}`);
    if (r.ok) {
      const arr = JSON.parse(text);
      const id = arr[0]?.id;
      if (id) insertedIds.push(id);
      const db = await selectRow(ad.token, id);
      const pass = db.status === "pending"
        && !db.reviewed_by
        && !db.reviewed_at
        && !db.review_note
        && String(db.user_id) === String(na.userId);
      record("T1 INSERT spoof", r.status, db, pass ? "PASS" : "FAIL",
        pass ? "spoof stripped → status=pending, reviewer=null"
             : `unexpected db row — manual inspect`);
    } else if (isReject(r.status)) {
      record("T1 INSERT spoof", r.status, {}, "PASS",
        `rejected by RLS/trigger (acceptable): ${text.slice(0, 150)}`);
    } else {
      record("T1 INSERT spoof", r.status, {}, "FAIL", `unexpected HTTP: ${text.slice(0, 150)}`);
    }
  } catch (e) {
    record("T1 INSERT spoof", "ERR", {}, "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── T2 prep: own clean pending row ────────────────────────
  console.log("\n[T2-prep] non-admin creates own pending row (clean)");
  let t2Id = null;
  try {
    const r = await fetch(`${URL}/rest/v1/staff_leaves`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: na.userId,
        leave_type: "sick",
        start_date: "2026-05-29",
        end_date: "2026-05-29",
        days_count: 1,
        reason: "T2 setup (clean)",
        status: "pending",
      }),
    });
    if (!r.ok) throw new Error(`prep HTTP ${r.status} ${await r.text()}`);
    const arr = await r.json();
    t2Id = arr[0]?.id;
    if (t2Id) insertedIds.push(t2Id);
    console.log(`  created id=${t2Id}`);
  } catch (e) {
    console.log(`  prep failed: ${e.message}`);
  }

  // ── T2: non-admin UPDATE pending -> approved + spoof ──────
  console.log("\n[T2] non-admin UPDATE pending -> approved spoof");
  if (t2Id) {
    try {
      const r = await fetch(`${URL}/rest/v1/staff_leaves?id=eq.${t2Id}`, {
        method: "PATCH",
        headers: H(na.token, { Prefer: "return=representation" }),
        body: JSON.stringify({
          status: "approved",
          reviewed_by: ad.userId,
          reviewed_at: "2026-05-28T00:00:00Z",
          review_note: "fake approve T2",
        }),
      });
      const text = await r.text();
      console.log(`  HTTP ${r.status}`);
      const db = await selectRow(ad.token, t2Id);
      const rejected = isReject(r.status);
      const dbSafe = db.status === "pending" && !db.reviewed_by && !db.reviewed_at && !db.review_note;
      const pass = rejected && dbSafe;
      record("T2 UPDATE -> approved", r.status, db, pass ? "PASS" : "FAIL",
        rejected ? `rejected (good): ${text.slice(0, 120)}` : "unexpectedly succeeded — escalation!");
    } catch (e) {
      record("T2 UPDATE -> approved", "ERR", {}, "FAIL", String(e.message || e).slice(0, 200));
    }
  } else {
    record("T2 UPDATE -> approved", "SKIP", {}, "FAIL", "no t2Id (prep failed)");
  }

  // ── T2b: non-admin UPDATE pending -> cancelled + spoof ────
  console.log("\n[T2b] non-admin UPDATE pending -> cancelled + spoof reviewer");
  let t2bId;
  try {
    const r0 = await fetch(`${URL}/rest/v1/staff_leaves`, {
      method: "POST",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: na.userId,
        leave_type: "sick",
        start_date: "2026-05-30",
        end_date: "2026-05-30",
        days_count: 1,
        reason: "T2b setup",
        status: "pending",
      }),
    });
    if (!r0.ok) throw new Error(`prep HTTP ${r0.status} ${await r0.text()}`);
    const arr0 = await r0.json();
    t2bId = arr0[0]?.id;
    if (t2bId) insertedIds.push(t2bId);

    const r = await fetch(`${URL}/rest/v1/staff_leaves?id=eq.${t2bId}`, {
      method: "PATCH",
      headers: H(na.token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        status: "cancelled",
        reviewed_by: "22222222-2222-2222-2222-222222222222",
        reviewed_at: "2026-05-28T00:00:00Z",
        review_note: "inject T2b",
      }),
    });
    console.log(`  HTTP ${r.status}`);
    const db = await selectRow(ad.token, t2bId);
    const pass = r.status === 200
      && db.status === "cancelled"
      && !db.reviewed_by
      && !db.reviewed_at
      && !db.review_note;
    record("T2b UPDATE -> cancelled+spoof", r.status, db, pass ? "PASS" : "FAIL",
      pass ? "status=cancelled, reviewer preserved as null"
           : `db: status=${db.status} reviewed_by=${db.reviewed_by} reviewed_at=${db.reviewed_at}`);
  } catch (e) {
    record("T2b UPDATE -> cancelled+spoof", "ERR", {}, "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── T3 prep: admin creates pending row for non-admin ──────
  console.log("\n[T3-prep] admin creates pending row (for RPC approve)");
  let t3Id = null;
  try {
    t3Id = await adminInsertPending(ad.token, na.userId, 5, "T3 setup (admin-pending)");
    if (t3Id) insertedIds.push(t3Id);
    console.log(`  created id=${t3Id}`);
  } catch (e) {
    console.log(`  prep failed: ${e.message}`);
  }

  // ── T3: admin RPC approved ────────────────────────────────
  console.log("\n[T3] admin RPC review_staff_leave approved");
  if (t3Id) {
    try {
      const before = Date.now();
      const r = await fetch(`${URL}/rest/v1/rpc/review_staff_leave`, {
        method: "POST",
        headers: H(ad.token),
        body: JSON.stringify({ p_leave_id: t3Id, p_status: "approved", p_note: "admin RPC test" }),
      });
      const text = await r.text();
      console.log(`  HTTP ${r.status}`);
      const db = await selectRow(ad.token, t3Id);
      const reviewedMs = Date.parse(db.reviewed_at);
      const recent = Number.isFinite(reviewedMs) && Math.abs(reviewedMs - before) < 60_000;
      const pass = r.status === 200
        && db.status === "approved"
        && String(db.reviewed_by) === String(ad.userId)
        && recent;
      record("T3 admin RPC approved", r.status, db, pass ? "PASS" : "FAIL",
        pass ? `reviewer=admin uid, server now (Δ ${reviewedMs - before}ms)`
             : `db: status=${db.status} reviewed_by=${db.reviewed_by} reviewed_at=${db.reviewed_at} — body=${text.slice(0,120)}`);
    } catch (e) {
      record("T3 admin RPC approved", "ERR", {}, "FAIL", String(e.message || e).slice(0, 200));
    }
  } else {
    record("T3 admin RPC approved", "SKIP", {}, "FAIL", "no t3Id (prep failed)");
  }

  // ── T3b: non-admin RPC (negative) ─────────────────────────
  console.log("\n[T3b] non-admin RPC review_staff_leave (negative)");
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/review_staff_leave`, {
      method: "POST",
      headers: H(na.token),
      body: JSON.stringify({ p_leave_id: t3Id || 1, p_status: "approved", p_note: "attack" }),
    });
    const text = await r.text();
    console.log(`  HTTP ${r.status}`);
    const rejected = isReject(r.status);
    const msg = text.toLowerCase();
    const hasAdminOnly = msg.includes("admin only") || msg.includes("42501");
    const pass = rejected && hasAdminOnly;
    record("T3b non-admin RPC (neg)", r.status, {}, pass ? "PASS" : "FAIL",
      pass ? `rejected with admin-only error`
           : `unexpected: ${text.slice(0, 180)}`);
  } catch (e) {
    record("T3b non-admin RPC (neg)", "ERR", {}, "FAIL", String(e.message || e).slice(0, 200));
  }

  // ── Cleanup ───────────────────────────────────────────────
  console.log("\n[cleanup] deleting test rows...");
  for (const id of insertedIds.filter(Boolean)) {
    try {
      const r = await deleteRow(ad.token, id);
      console.log(`  delete id=${id} → HTTP ${r.status}`);
    } catch (e) {
      console.log(`  delete id=${id} failed: ${e.message}`);
    }
  }

  // ── Final matrix ──────────────────────────────────────────
  console.log("\n═══ Final Matrix ═══");
  const col = (s, n) => String(s).slice(0, n).padEnd(n);
  console.log(col("name", 32) + " | " + col("HTTP", 5) + " | " + col("status", 10) + " | " + col("reviewed_by", 18) + " | " + col("reviewed_at", 24) + " | " + "verdict");
  console.log("-".repeat(110));
  for (const r of results) {
    console.log(
      col(r.name, 32) + " | " +
      col(r.http, 5) + " | " +
      col(r.status, 10) + " | " +
      col(r.reviewed_by, 18) + " | " +
      col(r.reviewed_at, 24) + " | " +
      r.verdict
    );
    if (r.note) console.log("    └─ " + r.note);
  }

  const allPass = results.length > 0 && results.every(r => r.verdict === "PASS");
  console.log("\n" + "═".repeat(60));
  if (allPass) {
    console.log("✅ ALL PASS — S3 reviewed_by/reviewed_at spoof CLOSED 100%");
    process.exit(0);
  } else {
    console.log("❌ FAIL — review failed scenarios above");
    process.exit(1);
  }
})().catch((e) => {
  console.error("\n[!] fatal:", e.message || e);
  process.exit(2);
});
