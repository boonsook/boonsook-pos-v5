// ตรวจสต็อกงานบริการ (ตามเก็บ) — Stock Deduct Reconcile Report — build 375 (Phase 375)
//
// READ-ONLY ADMIN REVIEW SURFACE — locked invariants (see tests/stock_reconcile_report_guard.test.js):
//   - อ่านอย่างเดียว: ไม่ POST/PATCH/PUT/DELETE, ไม่ rpc-write, ไม่ mutate state, ไม่ตัดสต็อก
//   - fetch read-only เท่านั้น (GET stock_movements) เพื่อความครบของข้อมูล (state.stockMovements ≤50 ไม่พอ)
//   - HEURISTIC best-effort: จับคู่ job_no ใน note + ข้อมูลที่โหลด — ไม่ใช่บัญชีเป๊ะ; admin ตรวจ/ตัดมือเอง
//   - กรอง item service/non_stock ออก (ไม่ตัดสต็อก → ไม่ flag)
//   - data ไม่ครบ (fetch ล้ม/ตัดที่ limit) → "ตรวจไม่ได้" (ไม่ flag มั่ว, ไม่ hardcode 0 หลอก)
//   - drill = read-only: ปุ่ม "ไปหน้างาน" (showRoute service_jobs) เท่านั้น — ไม่มี action เขียนข้อมูล

import { escHtml, formatDate } from "./utils.js";

const FETCH_LIMIT = 2000;   // out-movements ที่ดึงมาเทียบ; ถ้าได้ครบ limit = อาจถูกตัด → ข้อมูลไม่ครบ

// ═══════════════════════════════════════════════════════════
//  PURE DETECTION (testable — no DOM / no network)
// ═══════════════════════════════════════════════════════════

// items_json อาจเป็น array หรือ JSON string
export function parseItems(itemsJson) {
  if (Array.isArray(itemsJson)) return itemsJson;
  if (typeof itemsJson === "string") {
    try { const a = JSON.parse(itemsJson); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  return [];
}

export function buildProductsById(products) {
  const map = {};
  (Array.isArray(products) ? products : []).forEach(p => { if (p?.id != null) map[String(p.id)] = p; });
  return map;
}

// expected stockable items ของงาน — กรอง: product_id && warehouse_id && qty>0 และ product ไม่ใช่ service/non_stock
export function expectedStockableItems(job, productsById) {
  const items = parseItems(job?.items_json);
  return items.filter(it => {
    const pid = it?.product_id, wid = it?.warehouse_id, qty = Number(it?.qty) || 0;
    if (!pid || !wid || !(qty > 0)) return false;
    const prod = productsById?.[String(pid)];
    const t = prod?.product_type;
    if (t === "service" || t === "non_stock") return false;  // ไม่ตัดสต็อก → ไม่นับ (กัน false-positive)
    return true;
  });
}

// ตรวจงานเดียว: expected (stockable) เทียบ actual out-movements (note contains job_no, นับต่อ product_id)
// flag เมื่อมี product ที่ movement ไม่ครบจำนวน expected line (เช่น expected 2 แต่เจอ 1)
export function detectJobDeductGaps({ job, outMovements, productsById }) {
  const jobNo = String(job?.job_no || "");
  const expected = expectedStockableItems(job, productsById);
  if (!expected.length) return { jobNo, expectedCount: 0, flagged: false, unverifiable: false, missing: [] };
  // job_no ว่าง → จับคู่ note ไม่ได้ → ตรวจไม่ได้ (ไม่ flag มั่ว)
  if (!jobNo) return { jobNo, expectedCount: expected.length, flagged: false, unverifiable: true, missing: [] };

  const jobMoves = (Array.isArray(outMovements) ? outMovements : [])
    .filter(m => String(m?.note || "").includes(jobNo));

  // นับ expected lines ต่อ product_id เทียบ matched out-movements ต่อ product_id
  const expByPid = {};
  expected.forEach(it => { const k = String(it.product_id); expByPid[k] = (expByPid[k] || 0) + 1; });
  const movByPid = {};
  jobMoves.forEach(m => { const k = String(m?.product_id); movByPid[k] = (movByPid[k] || 0) + 1; });

  const missing = [];
  for (const pid of Object.keys(expByPid)) {
    const exp = expByPid[pid], found = movByPid[pid] || 0;
    if (found < exp) {
      const sample = expected.find(it => String(it.product_id) === pid);
      missing.push({ product_id: pid, name: String(sample?.name || pid), expected: exp, found });
    }
  }
  return { jobNo, expectedCount: expected.length, flagged: missing.length > 0, unverifiable: false, missing };
}

// ตรวจหลายงาน → { flagged:[{job,result}], unverifiable:[{job,result}], okCount }
export function detectAllJobs({ jobs, outMovements, productsById }) {
  const flagged = [], unverifiable = [];
  let okCount = 0;
  (Array.isArray(jobs) ? jobs : []).forEach(job => {
    const result = detectJobDeductGaps({ job, outMovements, productsById });
    if (result.expectedCount === 0) return;          // ไม่มี stockable item → ข้าม
    if (result.unverifiable) unverifiable.push({ job, result });
    else if (result.flagged) flagged.push({ job, result });
    else okCount++;
  });
  return { flagged, unverifiable, okCount };
}

// timestamp ของงาน (กำหนดช่วง fetch movement) — created_at ก่อน, fallback parse "JOB-<ts>"
export function jobTimestamp(job) {
  if (job?.created_at) {
    const t = new Date(job.created_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const m = String(job?.job_no || "").match(/JOB-(\d+)/);
  if (m) {
    let ts = Number(m[1]);
    if (ts > 0 && ts < 1e12) ts *= 1000;             // วินาที → มิลลิวินาที (heuristic)
    if (!Number.isNaN(ts) && ts > 0) return ts;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
//  RENDER (admin-only, read-only)
// ═══════════════════════════════════════════════════════════

const HONESTY = "⚠️ heuristic best-effort — อิงการจับคู่ note + ข้อมูลที่โหลด · ไม่ใช่บัญชีเป๊ะ · admin ตรวจ/ตัดมือเอง";
const SCOPE_NOTE = "ขอบเขต: งานบริการล่าสุด ≤50";

function shell(bodyHtml) {
  return `
    <div class="recon-report" style="max-width:900px;margin:0 auto;padding:16px">
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:#92400e">
        🔒 โหมดอ่านอย่างเดียว (read-only) — รายงานนี้ surface งานที่ "น่าจะตัดสต็อกไม่ครบ" ให้ตรวจ/ตัดมือเอง ไม่แก้ไข/ไม่บันทึกข้อมูลใด
      </div>
      <h2 style="margin:0 0 4px;font-size:20px">📦 ตรวจสต็อกงานบริการ (ตามเก็บ)</h2>
      <div style="font-size:12px;color:#b45309;margin-bottom:2px">${escHtml(HONESTY)}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:14px">${escHtml(SCOPE_NOTE)}</div>
      ${bodyHtml}
    </div>`;
}

function loadingHtml() {
  return shell(`<div style="padding:24px;text-align:center;color:#64748b">⏳ กำลังโหลดและตรวจสอบข้อมูล...</div>`);
}

function incompleteHtml(reason) {
  return shell(`
    <div style="background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;padding:20px;text-align:center;color:#475569">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">⚠️ โหลดข้อมูลไม่ครบ — ตรวจไม่ได้</div>
      <div style="font-size:13px">${escHtml(reason)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:8px">ระบบเลือกที่จะ "ไม่แจ้งเตือน" แทนการเดา เพื่อกันผลลวง (false-positive)</div>
    </div>`);
}

function emptyHtml(okCount) {
  return shell(`
    <div style="background:#ecfdf5;border:1px solid #34d399;border-radius:8px;padding:20px;text-align:center;color:#065f46">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">✅ ไม่พบงานที่น่าจะตัดสต็อกไม่ครบ</div>
      <div style="font-size:13px">ตรวจงานที่มีสินค้านับสต็อกแล้ว ${okCount} งาน — จับคู่ out-movement ครบทุกงาน</div>
      <div style="font-size:12px;color:#6ee7b7;margin-top:6px">(heuristic — ครอบเฉพาะงานล่าสุด ≤50 ที่ข้อมูลโหลดครบ)</div>
    </div>`);
}

function missingRowsHtml(missing) {
  return missing.map(m => `
    <div style="font-size:12px;color:#7f1d1d;margin-top:2px">
      • ${escHtml(m.name)} — คาดตัด ${escHtml(String(m.expected))} รายการ, พบ movement ${escHtml(String(m.found))}
    </div>`).join("");
}

function jobCardHtml(entry, kind) {
  const job = entry.job, r = entry.result;
  const jobNo = escHtml(r.jobNo || job?.job_no || "—");
  const status = escHtml(String(job?.status || "—"));
  const jobType = escHtml(String(job?.job_type || job?.service_type || "—"));
  const dateTs = jobTimestamp(job);
  const dateStr = dateTs ? escHtml(formatDate(new Date(dateTs))) : "—";
  const border = kind === "unverifiable" ? "#cbd5e1" : "#fca5a5";
  const bg = kind === "unverifiable" ? "#f8fafc" : "#fef2f2";
  const detail = kind === "unverifiable"
    ? `<div style="font-size:12px;color:#64748b;margin-top:2px">ไม่มีเลขงาน (job_no) — จับคู่ movement ไม่ได้ → ตรวจไม่ได้</div>`
    : missingRowsHtml(r.missing);
  return `
    <div style="border:1px solid ${border};background:${bg};border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:14px">${jobNo}</div>
          <div style="font-size:12px;color:#64748b">${jobType} · สถานะ ${status} · ${dateStr}</div>
        </div>
        <button type="button" class="recon-nav-job" style="border:1px solid #2563eb;background:#fff;color:#2563eb;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap">→ ไปหน้างาน</button>
      </div>
      ${detail}
    </div>`;
}

function resultsHtml(detected) {
  const parts = [];
  if (detected.flagged.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#b91c1c;margin:6px 0 8px">🚩 น่าจะตัดสต็อกไม่ครบ (${detected.flagged.length})</div>`);
    parts.push(detected.flagged.map(e => jobCardHtml(e, "flagged")).join(""));
  }
  if (detected.unverifiable.length) {
    parts.push(`<div style="font-weight:700;font-size:14px;color:#64748b;margin:14px 0 8px">❔ ตรวจไม่ได้ (ไม่มีเลขงาน) (${detected.unverifiable.length})</div>`);
    parts.push(detected.unverifiable.map(e => jobCardHtml(e, "unverifiable")).join(""));
  }
  parts.push(`<div style="font-size:12px;color:#94a3b8;margin-top:12px">ตรวจครบ (จับคู่ได้) ${detected.okCount} งาน</div>`);
  return shell(parts.join(""));
}

// fetch out-movements (READ-ONLY GET) ตั้งแต่วันงานเก่าสุดที่แสดง — กัน false-positive จาก state ≤50
async function fetchOutMovements(jobs) {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // ช่วงวันที่ครอบงานที่แสดง (เก่าสุด − กันเหลื่อม 1 วัน)
  const tsList = (Array.isArray(jobs) ? jobs : []).map(jobTimestamp).filter(t => t > 0);
  let sinceParam = "";
  if (tsList.length) {
    const oldest = Math.min(...tsList) - 24 * 60 * 60 * 1000;
    const iso = new Date(oldest).toISOString();
    sinceParam = "&created_at=gte." + encodeURIComponent(iso);
  }

  const url = cfg.url + "/rest/v1/stock_movements?type=eq.out" + sinceParam
    + "&order=id.desc&limit=" + FETCH_LIMIT
    + "&select=id,product_id,note,created_at";
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return { ok: false, reason: "ดึงข้อมูล stock_movements ไม่สำเร็จ (HTTP " + r.status + ")" };
    const rows = await r.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, reason: "ข้อมูล stock_movements รูปแบบไม่ถูกต้อง" };
    // ได้ครบ limit = อาจมีรายการเก่ากว่านี้ถูกตัด → ตรวจครบไม่ได้
    if (rows.length >= FETCH_LIMIT) {
      return { ok: false, reason: "out-movement มากเกิน " + FETCH_LIMIT + " รายการในช่วงนี้ — ตรวจครบไม่ได้" };
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
}

export function renderStockReconcileReportPage(ctx) {
  const container = typeof document !== "undefined" ? document.getElementById("page-stock_reconcile_report") : null;
  if (!container) return;

  // ── admin-only gate (showRoute ก็ gate แล้ว แต่ double-gate กันหลุด) ──
  const isAdmin = ctx?.requireAdmin ? !!ctx.requireAdmin() : (ctx?.currentRole?.() === "admin");
  if (!isAdmin) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:#b91c1c">⛔ หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>`;
    return;
  }

  const state = ctx?.state || {};
  container.innerHTML = loadingHtml();

  // อ่านจาก state ที่โหลดแล้ว (read-only): products (ครบ) + serviceJobs (≤50)
  const productsById = buildProductsById(state.products);
  const jobs = Array.isArray(state.serviceJobs) ? state.serviceJobs.slice() : [];   // clone กัน mutate

  fetchOutMovements(jobs).then(res => {
    // อาจเปลี่ยนหน้าไปแล้วก่อน fetch เสร็จ → เช็ค container ยังอยู่
    if (!document.body.contains(container)) return;
    if (!res.ok) {
      container.innerHTML = incompleteHtml(res.reason || "ไม่ทราบสาเหตุ");
      return;
    }
    const detected = detectAllJobs({ jobs, outMovements: res.rows, productsById });
    if (!detected.flagged.length && !detected.unverifiable.length) {
      container.innerHTML = emptyHtml(detected.okCount);
    } else {
      container.innerHTML = resultsHtml(detected);
    }
    // drill: "ไปหน้างาน" → read-only navigation เท่านั้น
    container.querySelectorAll(".recon-nav-job").forEach(btn => {
      btn.addEventListener("click", () => { ctx?.showRoute?.("service_jobs"); });
    });
  });
}
