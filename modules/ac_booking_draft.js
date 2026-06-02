// ═══════════════════════════════════════════════════════════
//  ac_booking_draft.js — bridge: แคตตาล็อกแอร์ (หน้าร้าน) → คำขอจอง/แจ้งงาน
//  (Phase 347 — air-catalog-public-store-sync)
//
//  ⚠️ ชั่วคราว/ปลอดภัยเท่านั้น — เหมือน ac_quotation_draft แต่สำหรับฝั่งลูกค้า:
//    - เก็บใน sessionStorage (หายเมื่อปิดแท็บ) — ไม่ใช่ Supabase, ไม่ใช่ตัวแคตตาล็อกถาวร
//    - ไม่ใช่สต็อกจริง · ไม่ตัด/เพิ่มคลัง · ไม่ addToCart/POS · ไม่สร้างคำขอจริงอัตโนมัติ
//    - หน้า service_request "consume" draft (อ่านแล้วลบ) เพื่อ prefill; user ต้องกดส่งเอง
// ═══════════════════════════════════════════════════════════
const KEY = "bsk_air_booking_draft";

function _read() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.warn("[ac-booking-draft] parse failed:", e);
    return [];
  }
}

/** เก็บคำขอจอง/สอบถามราคาจาก card แอร์ (append) */
export function pushAirBookingDraft(item) {
  if (!item) return;
  const list = _read();
  list.push({
    source: "air_catalog",
    catalogId: item.catalogId ?? null,
    airType: item.airType || "",
    brand: item.brand || "",
    model: item.model || "",
    btu: Number(item.btu || 0),
    offerPrice: Number(item.offerPrice || 0),
    intent: item.intent === "price_inquiry" ? "price_inquiry" : "booking",
    // Phase 349: พกข้อมูลเสริมไป prefill หน้า service_request (optional — old drafts ไม่มีก็ไม่ crash)
    note: item.note || "",
    spec: item.spec || "",
    warranty: item.warranty || ""
  });
  try { sessionStorage.setItem(KEY, JSON.stringify(list)); }
  catch (e) { console.warn("[ac-booking-draft] save failed:", e); }
}

/** อ่าน + ล้าง (consume once) — กันเติมซ้ำตอน re-render/reload หน้า service_request */
export function consumeAirBookingDrafts() {
  const list = _read();
  try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return list;
}

/** นับ draft ที่ค้างอยู่ (ไม่ลบ) */
export function peekAirBookingDraftCount() {
  return _read().length;
}
