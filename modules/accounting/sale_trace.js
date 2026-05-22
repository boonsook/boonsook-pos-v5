// ═══════════════════════════════════════════════════════════
//  accounting/sale_trace.js — Forward accounting trace (Phase 92.17)
//
//  จาก POS sale → หา journal entry (JV) ที่ auto_post สร้างไว้
//  เพื่อให้ user เห็นว่า "บิลนี้ลงบัญชีแล้วหรือยัง" + กดไปสมุดรายวันได้
//
//  Canonical key (1:1): journal_entries.source_table='sales' + source_id=sale.id
//    (บังคับ unique ด้วย partial index idx_je_source_unique — ดู auto_post.js:13)
//    ★ doc_no / description เป็น "label" เท่านั้น — ห้ามใช้เป็น lookup key
//
//  READ-ONLY: helper นี้ไม่สร้าง / ไม่แก้ journal — แค่ค้นหาเพื่อแสดงผล
// ═══════════════════════════════════════════════════════════

import { escHtml } from "../utils.js";

// fields ที่พอสำหรับ badge + เปิด JV drawer ต่อ — ไม่ดึง lines (lazy ตอนเปิด drawer)
const TRACE_SELECT = "id,doc_no,doc_type,status,total_debit,source_table,source_id";

// route ของหน้าสมุดรายวัน (main.js ROUTES: accounting_journals)
export const JOURNAL_ROUTE = "accounting_journals";

/**
 * ค้นหา JV ของ sale หนึ่งใบ (on-demand fetch — journal entries ไม่ได้อยู่ใน state)
 * @param {object|number|string} sale - sale row (ใช้ .id) หรือ sale id ตรง ๆ
 * @param {object} [opts]
 * @param {function} [opts.fetch] - inject ได้สำหรับ test (default: global fetch)
 * @param {object}   [opts.cfg]   - SUPABASE_CONFIG (default: window.SUPABASE_CONFIG)
 * @param {string}   [opts.token] - access token (default: window._sbAccessToken)
 * @returns {Promise<{ok:boolean, found:boolean, status:'found'|'missing'|'error'|'invalid', entry:object|null, error?:string}>}
 */
export async function findJournalForSale(sale, opts = {}) {
  const saleId = (sale && typeof sale === "object") ? sale.id : sale;
  if (saleId == null || saleId === "") {
    return { ok: false, found: false, status: "invalid", entry: null, error: "no sale id" };
  }

  const cfg = opts.cfg || (typeof window !== "undefined" ? window.SUPABASE_CONFIG : null);
  const token = opts.token
    || (typeof window !== "undefined" ? window._sbAccessToken : null)
    || cfg?.anonKey;
  const fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);

  if (!cfg?.url || !fetchImpl) {
    return { ok: false, found: false, status: "error", entry: null, error: "no config/fetch" };
  }

  // ★ key หลัก: source_table + source_id (ไม่ใช่ doc_no/description)
  const url = `${cfg.url}/rest/v1/journal_entries`
    + `?source_table=eq.sales&source_id=eq.${encodeURIComponent(saleId)}`
    + `&select=${TRACE_SELECT}&limit=1`;

  try {
    const r = await fetchImpl(url, {
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token },
    });
    if (!r.ok) {
      return { ok: false, found: false, status: "error", entry: null, error: `HTTP ${r.status}` };
    }
    const arr = await r.json();
    const entry = Array.isArray(arr) ? arr[0] : null;
    if (entry && entry.id) {
      return { ok: true, found: true, status: "found", entry };
    }
    // ไม่มี JV row จริง ๆ — อาจ deferred (RLS) / no-mapping / before-effective
    return { ok: true, found: false, status: "missing", entry: null };
  } catch (e) {
    return { ok: false, found: false, status: "error", entry: null, error: e?.message || String(e) };
  }
}

const _JV_STATUS_LABEL = {
  approved: "ลงบัญชีแล้ว",
  draft:    "ฉบับร่าง",
  void:     "ยกเลิก",
};

/**
 * สร้าง HTML badge จากผล findJournalForSale — ห้ามเงียบ ทุกสถานะมีข้อความ
 * found → clickable (.sale-acct-trace + data-acct-route) → caller wire ไปสมุดรายวัน
 * @param {object} result - ผลจาก findJournalForSale
 * @param {object} [opts]
 * @param {boolean} [opts.compact] - แบบสั้นสำหรับ card row (default false = receipt section)
 * @returns {string} HTML string (escaped)
 */
export function renderSaleTraceBadge(result, opts = {}) {
  const compact = !!opts.compact;
  const base = "display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;"
    + "padding:3px 9px;border-radius:8px;line-height:1.4;";

  if (result?.found && result.entry) {
    const e = result.entry;
    const statusTh = _JV_STATUS_LABEL[e.status] || e.status || "";
    const label = compact ? escHtml(e.doc_no || "JV") : `${escHtml(e.doc_no || "JV")} · ${escHtml(statusTh)}`;
    return `<span class="sale-acct-trace" role="button" tabindex="0"`
      + ` data-acct-route="${JOURNAL_ROUTE}" data-jv-id="${escHtml(String(e.id))}"`
      + ` data-jv-docno="${escHtml(e.doc_no || "")}"`
      + ` title="ลงบัญชีแล้ว — กดไปสมุดรายวัน"`
      + ` style="${base}background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;cursor:pointer">`
      + `📒 ${label} →</span>`;
  }

  if (result?.status === "missing") {
    return `<span class="sale-acct-trace-none"`
      + ` title="ยังไม่พบเอกสารบัญชีของบิลนี้ (รอ auto_post หรือ RLS deferred)"`
      + ` style="${base}background:#fef3c7;color:#92400e;border:1px solid #fde68a">`
      + `📒 ยังไม่ลงบัญชี</span>`;
  }

  // error / invalid — ห้ามเงียบ
  return `<span class="sale-acct-trace-err"`
    + ` title="ตรวจสอบเอกสารบัญชีไม่สำเร็จ ลองรีโหลด"`
    + ` style="${base}background:#f1f5f9;color:#475569;border:1px solid #e2e8f0">`
    + `📒 ตรวจบัญชีไม่ได้</span>`;
}
