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
