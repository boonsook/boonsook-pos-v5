// ═══════════════════════════════════════════════════════════
//  doc_items.js — Phase 628B: ชนิดของแถวรายการในเอกสาร (item | heading)
//  ใช้ร่วมกันใน quotations / delivery_invoices / receipts / receipt_bt
//
//  DB (Phase 628A): quotation_items / delivery_invoice_items / receipt_items
//    item_type text NOT NULL DEFAULT 'item' CHECK (item_type IN ('item','heading'))
//
//  กติกาที่ owner ล็อกไว้:
//   - heading = เฉพาะค่า "heading" ตรงตัวเท่านั้น (ไม่ trim / ไม่แปลงตัวพิมพ์)
//     ค่าอื่นทั้งหมด (ไม่มี, null, ตัวพิมพ์ใหญ่, ค่าแปลก) = item → แถวเก่าทำงานเหมือนเดิม
//   - ห้ามเดา heading จากเลขศูนย์ / product_id ว่าง / ชื่อแถว
//   - heading ไม่มีเงินและไม่ใช่สินค้า: product_id=null, qty/unit_price/discount_pct/line_total = 0
//   - ยอดรวมและการนับ "มีรายการสินค้าไหม" ไม่นับ heading
//
//  Pure module: ไม่มี import, ไม่แตะ DOM / network / storage
// ═══════════════════════════════════════════════════════════

export const ITEM_TYPE_ITEM = "item";
export const ITEM_TYPE_HEADING = "heading";

export function normalizeItemType(value) {
  return value === ITEM_TYPE_HEADING ? ITEM_TYPE_HEADING : ITEM_TYPE_ITEM;
}

export function isHeadingItem(row) {
  return normalizeItemType(row?.item_type) === ITEM_TYPE_HEADING;
}

// คืน object ใหม่เสมอ (ไม่แก้ input) — ชนิด canonical; heading ถูกบังคับเลขศูนย์ 5 ช่อง
// แต่เก็บ item_name / unit / metadata อื่นไว้ตามเดิม; item คงค่าทุกช่อง
export function normalizeDocumentItem(row) {
  const src = row && typeof row === "object" ? row : {};
  const item_type = normalizeItemType(src.item_type);
  if (item_type !== ITEM_TYPE_HEADING) return { ...src, item_type };
  return { ...src, item_type, product_id: null, qty: 0, unit_price: 0, discount_pct: 0, line_total: 0 };
}

// จำนวนแถวสินค้าจริง (ไม่นับ heading)
export function countableDocumentItems(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => !isHeadingItem(r)).length;
}

// รวม line_total เฉพาะแถวสินค้า — สูตรเดียวกับของเดิม Number(x.line_total || 0)
// (ค่าที่แปลงไม่ได้ยังได้ NaN ตามพฤติกรรมเดิม ไม่กลืนเป็นศูนย์)
export function sumDocumentLineTotals(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((s, r) => (isHeadingItem(r) ? s : s + Number(r.line_total || 0)), 0);
}

// Phase 637: footer explanation only. Never used by save/conversion arithmetic.
// Validate EVERY item and reconcile the header before claiming a bill-wide total.
// Incomplete/contradictory legacy data keeps the original stored totals only.
// UI loaders record completeness BEFORE their existing 0/1 fallbacks. This
// in-memory flag is not a payload field; an incomplete loaded row stays hidden
// from the breakdown until saved/reloaded with complete data.
export function hasDocumentDiscountFields(row) {
  return !!row && (isHeadingItem(row) || ([row.discount_pct, row.qty, row.unit_price, row.line_total].every(
    v => (typeof v === "number" || typeof v === "string") && String(v).trim() !== "" && Number.isFinite(Number(v))
  ) && Number(row.qty) > 0));
}

export function getDocumentDiscountSummary(rows, subtotal) {
  const numeric = v => (typeof v === "number" || typeof v === "string") && String(v).trim() !== "" && Number.isFinite(Number(v));
  if (!Array.isArray(rows) || !numeric(subtotal) || Number(subtotal) < 0) return null;
  let grossCents = 0, netCents = 0, itemCount = 0, discounted = 0, singlePct = 0;
  for (const row of rows) {
    if (isHeadingItem(row)) continue;
    if (!hasDocumentDiscountFields(row) || row._discountSummaryComplete === false) return null;
    const [pct, qty, price, net] = [row.discount_pct, row.qty, row.unit_price, row.line_total].map(Number);
    if (pct < 0 || pct > 100 || qty <= 0 || price < 0 || net < 0) return null;
    const gross = qty * price;
    const expectedNet = Math.round(gross * (1 - pct / 100) * 100) / 100;
    const tolerance = 0.01 + Number.EPSILON * Math.max(1, Math.abs(expectedNet), net);
    if (!Number.isFinite(expectedNet) || net > gross || Math.abs(expectedNet - net) > tolerance) return null;
    const gc = Math.round(gross * 100), nc = Math.round(net * 100);
    if (!Number.isSafeInteger(gc) || !Number.isSafeInteger(nc) || (pct === 0 && gc !== nc)) return null;
    grossCents += gc;
    netCents += nc;
    itemCount++;
    if (pct > 0 && gc > nc) { discounted++; singlePct = pct; }
  }
  const headerCents = Math.round(Number(subtotal) * 100);
  if (![grossCents, netCents, headerCents].every(Number.isSafeInteger) || netCents !== headerCents || !discounted || grossCents <= netCents) return null;
  // Do not round an arbitrary percentage into a different claim or exponent text.
  const pctLabel = itemCount === 1 && singlePct >= 0.01 && Math.round(singlePct * 100) / 100 === singlePct ? " " + singlePct + "%" : "รวม";
  return { gross: grossCents / 100, discount: (grossCents - netCents) / 100, label: "ส่วนลดรายสินค้า" + pctLabel };
}

export function renderDocumentDiscountSummary(rows, subtotal) {
  const summary = getDocumentDiscountSummary(rows, subtotal);
  if (!summary) return "";
  const format = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '<div class="doc-line-discount-summary">'
    + '<div class="doc-total-row"><span>รวมราคาสินค้าก่อนส่วนลด</span><span>' + format.format(summary.gross) + ' บาท</span></div>'
    + '<div class="doc-total-row"><span>' + summary.label + '</span><span>-' + format.format(summary.discount) + ' บาท</span></div></div>';
}
