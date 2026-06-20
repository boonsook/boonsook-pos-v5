// Phase 507 — fetch ALL credit sales (is_credit=true), paginated, read-only.
//
// Why: Credit Tracker (ลูกค้าค้างชำระ) เดิม render จาก state.sales ที่ loadAllData cap ไว้ ≤50
// (latest only) → ยอดค้าง/เกินกำหนด/จำนวนบิล undercount เงียบ ๆ เมื่อร้านมีบิลเครดิตเกิน 50.
// ไฟล์นี้ดึงบิลเครดิต "ครบ" จาก DB ตรง.
//
// Mirror modules/sales_fetch.js (raw fetch + offset pagination + {ok,rows,error}, never silent
// empty on failure — เส้นทางการเงิน ห้ามกลืน error). order ด้วย PK stable (id.asc) ตามที่
// fetch_paginated.js เตือน (order ไม่ stable = paging ข้าม/ซ้ำ). select=* เพื่อกัน PGRST204
// จากชื่อ column ผิด (sales row เล็ก). ไม่เพิ่ม column/schema ใน phase นี้.

function _conn() {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return null;
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  return { url: cfg.url, headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } };
}

// Fetch every sale where is_credit=true, paginated by stable PK (id.asc).
//   read-only. Returns {ok:true, rows} / {ok:false, rows:[], error} — never a silent empty on failure.
export async function fetchCreditSales() {
  const c = _conn();
  if (!c) return { ok: false, rows: [], error: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const PAGE = 1000;
  const rows = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const url = c.url + "/rest/v1/sales?select=*&is_credit=eq.true&order=id.asc&limit=" + PAGE + "&offset=" + offset;
      const r = await fetch(url, { headers: c.headers });
      if (!r.ok) return { ok: false, rows: [], error: "ดึงข้อมูลบิลเครดิตไม่สำเร็จ (HTTP " + r.status + ")" };
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
