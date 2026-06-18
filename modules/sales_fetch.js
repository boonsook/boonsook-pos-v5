// Phase 492 (audit S-5) — fetch sales by date range (read-only).
//
// Why: loadAllData caps state.sales at 50 (latest only). Range-reports (profit_report,
// sales_heatmap, expenses "รายรับเดือนนี้") aggregated state.sales and so undercounted any
// shop doing >50 bills in the window — presented as a whole-system total. This fetches the
// ACTUAL sales since a cutoff, paginated. Mirrors sale_items_fetch.js (486) / dead_stock fetch.
//
// The caller keeps its own exact client-side date filter (slice / getTime) — this only widens
// the candidate set beyond the 50-row cap. A 2-day buffer is subtracted from the cutoff so the
// fetched set is a superset for both UTC-slice and local-getTime filters (no boundary miss).
// Returns {ok, rows} / {ok:false, error} — never a silent empty on failure.

function _conn() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return null;
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  return { url: cfg.url, headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } };
}

// "YYYY-MM-DD" minus `days` (UTC date math) → "YYYY-MM-DD". Empty/invalid → "".
export function bufferedSince(cutoffKey, days = 2) {
  if (!cutoffKey) return "";
  const d = new Date(String(cutoffKey).slice(0, 10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Fetch sales with created_at >= (cutoffKey - 2 days). cutoffKey === "" → all sales (no lower bound).
//   read-only, paginated to avoid the silent PostgREST 1000-row cap.
export async function fetchSalesSince(cutoffKey) {
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const since = bufferedSince(cutoffKey);
  const filter = since ? "&created_at=gte." + encodeURIComponent(since) : "";
  const PAGE = 1000;
  const rows = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const url = c.url + "/rest/v1/sales?select=*" + filter + "&order=created_at.desc&limit=" + PAGE + "&offset=" + offset;
      const r = await fetch(url, { headers: c.headers });
      if (!r.ok) return { ok: false, rows: [], error: "ดึงข้อมูลการขายไม่สำเร็จ (HTTP " + r.status + ")" };
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
