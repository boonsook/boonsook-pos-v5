// ═══════════════════════════════════════════════════════════
//  ac-stock-form.js — Add/Edit core form สำหรับ "จัดการสต็อกแอร์"
//  (Phase air-stock-manager-safe-step)
//
//  ฟอร์มกรอกฟิลด์หลักของรุ่นแอร์ (แยกจาก ac-spec-editor.js ที่กรอกสเปกเทคนิค):
//    ประเภทแอร์ (ac_type: wall|ceiling|cassette) · แบรนด์ (section) · รุ่น (model)
//    BTU · ราคา (price) · ต้นทุน (cost) · จำนวนสต็อก (stock) · SKU/บาร์โค้ด (sku) · หมายเหตุ (note)
//
//  ⚠️ Safe step: localStorage เท่านั้น — ไม่แตะ DB/API/billing. ฟิลด์ใหม่ (ac_type/cost/sku/note)
//     เก็บใน catalog object; ตอน edit จะ spread ของเดิมไว้ครบ (ไม่ทับสเปกเทคนิค/ประกัน).
//
//  Usage:
//    import { openAcStockForm, AC_TYPES, acTypeOf, acTypeLabel } from "./ac-stock-form.js";
//    openAcStockForm(productOrNull, defaultType, (entry) => { ...save... });
// ═══════════════════════════════════════════════════════════

export const AC_TYPES = [
  { key: "wall",     label: "แอร์ติดผนัง",   icon: "🧊" },
  { key: "ceiling",  label: "แอร์แขวน",      icon: "🌀" },
  { key: "cassette", label: "แอร์สี่ทิศทาง", icon: "🔲" },
];
const AC_TYPE_KEYS = AC_TYPES.map(t => t.key);

/** ประเภทแอร์ของ entry — fallback "wall" (แอร์ติดผนัง) ถ้ายังไม่มี field (ไม่ migrate DB) */
export const acTypeOf = (c) => (c && AC_TYPE_KEYS.includes(c.ac_type)) ? c.ac_type : "wall";
export const acTypeLabel = (key) => (AC_TYPES.find(t => t.key === key) || AC_TYPES[0]).label;
export const acTypeIcon = (key) => (AC_TYPES.find(t => t.key === key) || AC_TYPES[0]).icon;

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function _injectKf() {
  if (document.head.dataset.acStockKf === "1") return;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes acsf-fade-in { from { opacity:0 } to { opacity:1 } }
    @keyframes acsf-slide-up { from { transform: translateY(40px); opacity:0 } to { transform: translateY(0); opacity:1 } }
    .acsf-overlay { animation: acsf-fade-in .2s ease-out }
    .acsf-modal   { animation: acsf-slide-up .25s ease-out }
    .acsf-input { width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box }
    .acsf-input:focus { outline:none;border-color:#0284c7;box-shadow:0 0 0 3px rgba(2,132,199,.15) }
    .acsf-label { font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;display:block }
    .acsf-grid-2 { display:grid;grid-template-columns:1fr 1fr;gap:10px }
    @media (max-width:640px) {
      .acsf-modal { max-width:100% !important;max-height:100vh !important;border-radius:0 !important }
      .acsf-grid-2 { grid-template-columns:1fr !important }
    }
  `;
  document.head.appendChild(s);
  document.head.dataset.acStockKf = "1";
}

/**
 * เปิดฟอร์มเพิ่ม/แก้รุ่นแอร์
 * @param {object|null} product - null = เพิ่มใหม่ ; object = แก้ไข
 * @param {string} defaultType - ประเภทเริ่มต้น (ตาม tab) สำหรับรุ่นใหม่
 * @param {(entry: object) => void} onSave - callback ได้ entry object พร้อมบันทึก
 */
export function openAcStockForm(product, defaultType, onSave) {
  _injectKf();
  document.getElementById("acsf-overlay")?.remove();
  const isEdit = !!product;
  const cur = product || {};
  const curType = isEdit ? acTypeOf(cur) : (AC_TYPE_KEYS.includes(defaultType) ? defaultType : "wall");

  const overlay = document.createElement("div");
  overlay.id = "acsf-overlay";
  overlay.className = "acsf-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px";

  overlay.innerHTML = `
    <div class="acsf-modal" role="dialog" aria-label="${isEdit ? 'แก้ไขรุ่นแอร์' : 'เพิ่มรุ่นแอร์'}" style="background:#fff;border-radius:16px;max-width:560px;max-height:92vh;width:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.3)">
      <div style="padding:14px 18px;background:#0f172a;color:#fff;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:16px;font-weight:800">${isEdit ? '✏️ แก้ไขรุ่นแอร์' : '➕ เพิ่มรุ่นแอร์'}</div>
        <button id="acsfClose" aria-label="ปิด" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.1);color:#fff;font-size:16px;cursor:pointer">✕</button>
      </div>

      <div style="overflow-y:auto;padding:16px 18px;flex:1">
        <label class="acsf-label">❄️ ประเภทแอร์</label>
        <select id="acsfType" class="acsf-input">
          ${AC_TYPES.map(t => `<option value="${t.key}" ${t.key === curType ? 'selected' : ''}>${t.icon} ${escHtml(t.label)}</option>`).join("")}
        </select>

        <div class="acsf-grid-2" style="margin-top:12px">
          <div>
            <label class="acsf-label">แบรนด์ / กลุ่ม *</label>
            <input type="text" id="acsfSection" class="acsf-input" placeholder="เช่น TCL วอลไทป์" value="${escAttr(cur.section || '')}" />
          </div>
          <div>
            <label class="acsf-label">รุ่น *</label>
            <input type="text" id="acsfModel" class="acsf-input" placeholder="เช่น MFS10" value="${escAttr(cur.model || '')}" />
          </div>
        </div>

        <div class="acsf-grid-2" style="margin-top:12px">
          <div>
            <label class="acsf-label">BTU</label>
            <input type="number" id="acsfBtu" class="acsf-input" inputmode="numeric" placeholder="9000" value="${escAttr(cur.btu ?? '')}" />
          </div>
          <div>
            <label class="acsf-label">SKU / บาร์โค้ด</label>
            <input type="text" id="acsfSku" class="acsf-input" placeholder="เว้นว่างได้" value="${escAttr(cur.sku || cur.barcode || '')}" />
          </div>
        </div>

        <div class="acsf-grid-2" style="margin-top:12px">
          <div>
            <label class="acsf-label">ราคาขาย (฿)</label>
            <input type="number" id="acsfPrice" class="acsf-input" inputmode="numeric" placeholder="12900" value="${escAttr(cur.price ?? '')}" />
          </div>
          <div>
            <label class="acsf-label">ต้นทุน (฿)</label>
            <input type="number" id="acsfCost" class="acsf-input" inputmode="numeric" placeholder="เว้นว่างได้" value="${escAttr(cur.cost ?? '')}" />
          </div>
        </div>

        <div style="margin-top:12px">
          <label class="acsf-label">จำนวนสต็อก (เครื่อง)</label>
          <input type="number" id="acsfStock" class="acsf-input" inputmode="numeric" placeholder="0" value="${escAttr(cur.stock ?? '')}" />
        </div>

        <div style="margin-top:12px">
          <label class="acsf-label">หมายเหตุ</label>
          <textarea id="acsfNote" class="acsf-input" rows="2" placeholder="บันทึกภายใน (เว้นว่างได้)">${escHtml(cur.note || '')}</textarea>
        </div>

        <div id="acsfErr" style="display:none;margin-top:10px;font-size:13px;color:#dc2626;font-weight:600"></div>
      </div>

      <div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:8px">
        <button id="acsfCancel" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer">ยกเลิก</button>
        <button id="acsfSave" style="flex:1;padding:10px;border:none;border-radius:10px;background:#0284c7;color:#fff;font-size:15px;font-weight:800;cursor:pointer">💾 ${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มรุ่น'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const v = (id) => document.getElementById(id)?.value?.trim() ?? "";
  const vNum = (id) => {
    const s = v(id);
    if (s === "") return undefined;
    const n = Number(s.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  document.getElementById("acsfClose")?.addEventListener("click", close);
  document.getElementById("acsfCancel")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });

  document.getElementById("acsfSave")?.addEventListener("click", () => {
    const section = v("acsfSection");
    const model = v("acsfModel");
    const errEl = document.getElementById("acsfErr");
    if (!section || !model) {
      if (errEl) { errEl.textContent = "กรุณากรอก แบรนด์ และ รุ่น"; errEl.style.display = "block"; }
      return;
    }
    // spread ของเดิมก่อน (คงสเปกเทคนิค/ประกัน/รูป ที่ฟอร์มนี้ไม่ได้แตะ)
    const entry = { ...cur };
    entry.ac_type = v("acsfType") || "wall";
    entry.section = section;
    entry.model = model;
    entry.btu = vNum("acsfBtu") ?? (cur.btu ?? 0);
    entry.price = vNum("acsfPrice") ?? (cur.price ?? 0);
    const cost = vNum("acsfCost");
    if (cost !== undefined) entry.cost = cost;
    entry.stock = vNum("acsfStock") ?? (cur.stock ?? 0);
    const sku = v("acsfSku");
    if (sku) entry.sku = sku; else delete entry.sku;
    const note = v("acsfNote");
    if (note) entry.note = note; else delete entry.note;

    if (typeof onSave === "function") onSave(entry);
    close();
  });

  // โฟกัสช่องแรกที่ว่าง
  setTimeout(() => document.getElementById(isEdit ? "acsfModel" : "acsfSection")?.focus(), 50);
}
