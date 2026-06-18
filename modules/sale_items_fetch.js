// Phase 486 — fetch sale_items on-demand (read-only).
//
// Why: loadAllData NEVER loads sale_items into state (state.saleItems is always undefined). Six
// consumers (profit_by_product, dashboard Top-5, top_customers qty, products turnover hint,
// product-drawer activity, serials) read `state.saleItems` → always empty → reports/KPIs silently
// show ฿0 / 0 / empty. This is the same root cause as S1 dead_stock (build 478) and refunds
// (Phase 467), both fixed by fetching on-demand. This module is the shared read-only fetcher.
//
// Mirrors dead_stock.js fetchSaleMovementsSince (raw fetch via window.SUPABASE_CONFIG, paginated,
// returns {ok, rows} / {ok:false, error} — never a silent empty-on-failure). NO writes here.

function _conn() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return null;
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  return { url: cfg.url, headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } };
}

// pure: sum qty + revenue per product_id from sale_items rows → Map(String(pid) → {qty,revenue,name}).
//   revenue = line_total if present, else qty × unit_price. Non-finite values contribute 0.
export function indexQtyByProduct(rows) {
  const m = new Map();
  for (const it of (Array.isArray(rows) ? rows : [])) {
    if (it?.product_id == null) continue;
    const pid = String(it.product_id);
    const qty = Number(it.qty || 0);
    const lt = it.line_total != null ? Number(it.line_total) : (qty * Number(it.unit_price || 0));
    const g = m.get(pid) || { qty: 0, revenue: 0, name: it.product_name || "" };
    g.qty += Number.isFinite(qty) ? qty : 0;
    g.revenue += Number.isFinite(lt) ? lt : 0;
    m.set(pid, g);
  }
  return m;
}

async function _paginate(buildUrl, headers) {
  const PAGE = 1000;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await fetch(buildUrl(PAGE, offset), { headers });
    if (!r.ok) return { ok: false, rows: [], error: "ดึงรายการขายไม่สำเร็จ (HTTP " + r.status + ")" };
    const page = await r.json().catch(() => null);
    if (!Array.isArray(page)) return { ok: false, rows: [], error: "ข้อมูลรูปแบบไม่ถูกต้อง" };
    rows.push(...page);
    if (page.length < PAGE) break;  // last page
  }
  return { ok: true, rows };
}

// read-only fetch of sale_items whose sale_id is in saleIds. Chunks ids (URL length) + paginates.
//   empty ids → {ok:true, rows:[]} (no request). fetch/shape failure → {ok:false, ...} (NOT silent empty).
export async function fetchSaleItemsForSaleIds(saleIds) {
  const ids = [...new Set((saleIds || []).map(x => String(x)).filter(Boolean))];
  if (ids.length === 0) return { ok: true, rows: [] };
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const CHUNK = 100;  // keep the in.(...) list short enough for the URL
  const all = [];
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK).map(encodeURIComponent).join(",");
      const res = await _paginate(
        (limit, offset) => c.url + "/rest/v1/sale_items?select=*&sale_id=in.(" + slice + ")&order=id.asc&limit=" + limit + "&offset=" + offset,
        c.headers
      );
      if (!res.ok) return res;
      all.push(...res.rows);
    }
    return { ok: true, rows: all };
  } catch (e) {
    return { ok: false, rows: [], error: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
}

// read-only fetch of sale_items for one product (its sales history). Paginated.
export async function fetchSaleItemsForProduct(productId) {
  if (productId == null || String(productId) === "") return { ok: true, rows: [] };
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  try {
    return await _paginate(
      (limit, offset) => c.url + "/rest/v1/sale_items?select=*&product_id=eq." + encodeURIComponent(String(productId)) + "&order=id.desc&limit=" + limit + "&offset=" + offset,
      c.headers
    );
  } catch (e) {
    return { ok: false, rows: [], error: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
}
