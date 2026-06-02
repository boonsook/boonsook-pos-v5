// ═══════════════════════════════════════════════════════════
//  air_job_meta.js — detect & render "งานจากแคตตาล็อกแอร์" จาก service_job เดิม
//  (Phase 351 — service-job-air-source-visibility)
//
//  ⚠️ READ-ONLY parse จาก note/description ที่ build 350 เขียนไว้ — ไม่แตะ DB schema,
//     ไม่แตะ stock/POS/cart, ไม่เปลี่ยนสถานะงาน. marker = "source=air_catalog" ใน note.
//     note format (build 350): "[source=air_catalog] {airType} {brand} {model} {btu} BTU · {ราคา} | สเปก .. | ประกัน .. | {note} | นัดหมาย {date} {ช่วงเวลา}"
// ═══════════════════════════════════════════════════════════
const _esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * parse meta ของงานแอร์จากแคตตาล็อก (best-effort, ไม่ crash ถ้าข้อมูลไม่ครบ)
 * @returns {{isAir:boolean, intent?:string, intentLabel?:string, summary?:string, btu?:string, price?:string, appointment?:string}}
 */
export function parseAirJobMeta(job) {
  const note = String(job?.note || "");
  const desc = String(job?.description || "");
  if (!/source=air_catalog/i.test(note)) return { isAir: false };

  // intent: จาก description ("สอบถามราคา"/"จองติดตั้ง") หรือ fallback จาก note ("ต้องเช็คราคา")
  const intent = (/สอบถามราคา/.test(desc) || /ต้องเช็คราคา/.test(note)) ? "ask" : "booking";
  const intentLabel = intent === "ask" ? "สอบถามราคา" : "สั่งจอง";

  // summary = ช่วงแรกหลัง marker จนถึง " | " (มี airType/brand/model/BTU/ราคา ครบอยู่แล้ว)
  let summary = "";
  const m = note.match(/source=air_catalog\]?\s*([^|]*)/i);
  if (m && m[1]) summary = m[1].trim().replace(/^[•\-–\s]+/, "");

  // BTU / ราคา (optional)
  const btuM = note.match(/([\d,]+)\s*BTU/) || desc.match(/([\d,]+)\s*BTU/);
  const priceM = note.match(/ราคาเสนอ\s*([\d,]+)/);
  const price = priceM ? `฿${priceM[1]}` : (/ต้องเช็คราคา/.test(note) ? "ต้องเช็คราคา" : "");

  // นัดหมาย (optional): "นัดหมาย <date> <ช่วงเวลา...>"
  let appointment = "";
  const apptM = note.match(/นัดหมาย\s*([^|]+)/);
  if (apptM && apptM[1]) appointment = apptM[1].trim();

  return { isAir: true, intent, intentLabel, summary, btu: btuM ? btuM[1] : "", price, appointment };
}

/** badge เล็ก สีฟ้า (ไม่แรง) สำหรับ list/card */
export function airBadgeHtml(meta) {
  const intent = meta?.intentLabel ? ` · ${_esc(meta.intentLabel)}` : "";
  return `<span style="display:inline-block;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap">🌬️ จากแคตตาล็อกแอร์${intent}</span>`;
}

/** กล่องข้อมูลรุ่น/BTU/ราคา/นัดหมาย (อ่านอย่างเดียว) สำหรับ card/detail */
export function airJobInfoHtml(meta) {
  if (!meta?.isAir) return "";
  const rows = [];
  if (meta.summary) rows.push(`<div style="font-size:12px;color:#1e3a8a;line-height:1.4">${_esc(meta.summary)}</div>`);
  if (meta.appointment) rows.push(`<div style="font-size:11px;color:#0369a1;margin-top:3px">📅 นัดหมายที่ลูกค้าเลือก: ${_esc(meta.appointment)}</div>`);
  if (!rows.length) return "";
  return `<div style="margin-top:8px;padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px">
      <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:3px">🌬️ รายการจากแคตตาล็อกแอร์</div>
      ${rows.join("")}
    </div>`;
}
