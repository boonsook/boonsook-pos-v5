// Phase 577 (audit ROUND2 B1+B3) — fetch expenses / service_jobs by date range (read-only).
//
// Why: loadAllData caps state.expenses at 200 and state.serviceJobs at 50 (main.js). The
// dashboard "กำไรสุทธิเดือน/ปี" and the "ภาพรวมรายได้" page aggregated those capped arrays →
// any shop with >200 expenses or >50 service jobs in the window undercounted, silently, while
// presenting the number as a whole-system total. This fetches the ACTUAL rows since a cutoff,
// paginated (mirrors modules/sales_fetch.js — the Phase 492/562 pattern).
//
// The caller keeps its own exact client-side date filter — this only widens the candidate set
// beyond the cap. bufferedSince() (2-day buffer) is reused from sales_fetch.js so the date-math
// invariant lives in ONE place. Returns {ok, rows} / {ok:false, error} — never a silent empty.
//
// ★ service_jobs income date = closed_at (serviceIncomeDate / auto_post.js cash-basis, Phase 542),
//   web-order date = created_at. So the fetch must be a superset of BOTH: a job closed in the
//   window (even if created long ago) AND a job created in the window. PostgREST OR:
//   or=(closed_at.gte.SINCE,created_at.gte.SINCE). Exact per-date filtering stays client-side.

import { bufferedSince } from "./sales_fetch.js";

export { bufferedSince };

function _conn() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return null;
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  return { url: cfg.url, headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } };
}

// paginate a PostgREST GET to avoid the silent 1000-row cap. read-only.
async function _paginate(baseUrl, headers, label) {
  const PAGE = 1000;
  const rows = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const r = await fetch(baseUrl + "&limit=" + PAGE + "&offset=" + offset, { headers });
      if (!r.ok) return { ok: false, rows: [], error: label + "ไม่สำเร็จ (HTTP " + r.status + ")" };
      const page = await r.json().catch(() => null);
      if (!Array.isArray(page)) return { ok: false, rows: [], error: "ข้อมูลรูปแบบไม่ถูกต้อง" };
      rows.push(...page);
      if (page.length < PAGE) break;  // last page
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], error: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
}

// Fetch expenses with expense_date >= (cutoffKey - 2 days). cutoffKey === "" → all (no lower bound).
export async function fetchExpensesSince(cutoffKey) {
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const since = bufferedSince(cutoffKey);
  const filter = since ? "&expense_date=gte." + encodeURIComponent(since) : "";
  const url = c.url + "/rest/v1/expenses?select=*" + filter + "&order=expense_date.desc";
  return _paginate(url, c.headers, "ดึงข้อมูลค่าใช้จ่าย");
}

// Fetch service_jobs where closed_at >= since OR created_at >= since (superset of income-date &
// web-order-date). cutoffKey === "" → all. NULL closed_at rows still match on created_at.
export async function fetchServiceJobsSince(cutoffKey) {
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const since = bufferedSince(cutoffKey);
  // since is a plain YYYY-MM-DD (URL-safe); parens/comma of the OR group must stay literal for PostgREST.
  const filter = since ? "&or=(closed_at.gte." + since + ",created_at.gte." + since + ")" : "";
  const url = c.url + "/rest/v1/service_jobs?select=*" + filter + "&order=created_at.desc";
  return _paginate(url, c.headers, "ดึงข้อมูลงานบริการ");
}

// Phase 583: fetch receipts with created_at >= (cutoffKey - 2 days). cutoffKey === "" → all (no lower bound).
//   หน้าใบเสร็จอ่าน state.receipts cap 50 → ยอดรวม/ค้นหา/Excel ขาดเมื่อ >50 ใบ; ดึงเต็มช่วงที่เลือกจาก DB.
//   read-only GET, paginated. caller คง client-side date filter เดิม (buffer -2 วัน = candidate superset).
export async function fetchReceiptsSince(cutoffKey) {
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const since = bufferedSince(cutoffKey);
  const filter = since ? "&created_at=gte." + encodeURIComponent(since) : "";
  const url = c.url + "/rest/v1/receipts?select=*" + filter + "&order=created_at.desc";
  return _paginate(url, c.headers, "ดึงข้อมูลใบเสร็จ");
}
