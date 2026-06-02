// ═══════════════════════════════════════════════════════════
//  ac_quotation_draft.js — bridge: แคตตาล็อกแอร์ → รายการร่างในใบเสนอราคา
//  (Phase 346 — air-catalog-to-quotation-draft)
//
//  ⚠️ ชั่วคราว/ปลอดภัยเท่านั้น:
//    - เก็บใน sessionStorage (หายเมื่อปิดแท็บ) — ไม่ใช่ Supabase และไม่ใช่ตัวแคตตาล็อกถาวร
//    - ไม่ใช่สต็อกจริง · ไม่ตัด/เพิ่มคลัง · ไม่สร้างใบเสนอราคาจริงอัตโนมัติ
//    - หน้าใบเสนอราคา "consume" draft (อ่านแล้วลบ) → กันเติมซ้ำ; user ต้องกดบันทึกเอง
// ═══════════════════════════════════════════════════════════
const KEY = "bsk_air_quote_draft";

function _read() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.warn("[ac-quote-draft] parse failed:", e);
    return [];
  }
}

/** เก็บรุ่นแอร์เป็นรายการร่าง (append) — เรียกตอนกด "นำไปเสนอราคา" / "สร้างใบเสนอราคา"
 *  Phase 353: รองรับ source="air_job" (จาก service_jobs) เพิ่มเติมจาก "air_catalog" (build 346) — backward-compatible */
export function pushAirQuoteDraft(item) {
  if (!item) return;
  const list = _read();
  list.push({
    source: item.source || "air_catalog",
    originalSource: item.originalSource || "",
    serviceJobId: item.serviceJobId ?? null,
    serviceJobNo: item.serviceJobNo || "",
    customerName: item.customerName || "",
    customerPhone: item.customerPhone || "",
    catalogId: item.catalogId ?? item.id ?? null,
    airType: item.airType || "",
    brand: item.brand || "",
    model: item.model || "",
    btu: Number(item.btu || 0),
    offerPrice: Number(item.offerPrice ?? item.price ?? 0),
    estimatedCost: (item.estimatedCost === undefined || item.estimatedCost === null || item.estimatedCost === "")
      ? null : Number(item.estimatedCost),
    sku: item.sku || "",
    note: item.note || "",
    summary: item.summary || "",     // Phase 353: บรรทัดสรุป (จากงานแอร์ที่ parse note)
    intent: item.intent || "",
    appointment: item.appointment || ""
  });
  try { sessionStorage.setItem(KEY, JSON.stringify(list)); }
  catch (e) { console.warn("[ac-quote-draft] save failed:", e); }
}

/** อ่าน + ล้าง (consume once) — กันเติมซ้ำตอน re-render/reload หน้าใบเสนอราคา */
export function consumeAirQuoteDrafts() {
  const list = _read();
  try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return list;
}

/** นับ draft ที่ค้างอยู่ (ไม่ลบ) */
export function peekAirQuoteDraftCount() {
  return _read().length;
}
