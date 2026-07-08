import { escHtml } from "./utils.js";
// Phase 87.2 — spec editor modal
import { openSpecEditor } from "./ac-spec-editor.js";
// Phase air-stock-manager-safe-step — core add/edit form + air-type helpers
import { openAcStockForm, AC_TYPES, acTypeOf, acTypeLabel } from "./ac-stock-form.js";
// Phase 346 — ส่งรุ่นแอร์เป็นรายการร่างไปหน้าใบเสนอราคา (sessionStorage bridge — ไม่แตะคลัง/Supabase)
import { pushAirQuoteDraft } from "../ac_quotation_draft.js";

// ★ active air-type tab (module-level — คงค่าข้าม rerender) default = แอร์ติดผนัง
let _acTab = "wall";

/** อ่าน catalog ปัจจุบันจาก localStorage (fresh — กัน stale หลัง mutate) */
function _readCatalog() {
  try { return JSON.parse(localStorage.getItem("bsk_ac_catalog") || "[]"); }
  catch (e) { console.warn("[settings/ac-catalog] parse failed:", e); return []; }
}

/** เขียน catalog + mark ว่า user แก้แล้ว (Phase 570) — loadAllData auto-refresh จะข้าม
 *  ไม่ทับ "ทั้งก้อน" จาก ac_catalog.json (กันลบรุ่น/การแก้ไขของ user). ใช้ทุกจุดที่ mutate ผ่านฟอร์ม. */
function _writeCatalog(list) {
  // ★ local เขียน "ก่อน" เสมอ (แหล่งความจริงหลักของเครื่องนี้ + offline ยังใช้ได้)
  try {
    localStorage.setItem("bsk_ac_catalog", JSON.stringify(list));
    localStorage.setItem("bsk_ac_catalog_user_edited", "1");
  } catch (e) { console.warn("[settings/ac-catalog] write failed:", e); }
  // ★ Phase 574: sync ขึ้น cloud (ac_catalog_doc) ให้ทุกเครื่อง + หน้าลูกค้าเห็นตาม.
  //   fire-and-forget — local เขียนไปแล้ว, cloud fail = เตือน ไม่ rollback (last-write-wins ทั้งก้อน).
  try {
    const p = window._appSaveAcCatalog?.(list);
    if (p && typeof p.then === "function") {
      p.then(res => {
        if (res && res.ok === false && !res.denied) {
          window.App?.showToast?.("บันทึกในเครื่องแล้ว แต่ sync ข้ามเครื่องไม่สำเร็จ", "warn");
        }
      }).catch(() => {
        window.App?.showToast?.("บันทึกในเครื่องแล้ว แต่ sync ข้ามเครื่องไม่สำเร็จ", "warn");
      });
    }
  } catch (e) { console.warn("[settings/ac-catalog] cloud sync failed:", e); }
}

/** map ค่า "ประเภท" จาก import (อังกฤษ key หรือ label ไทย) → ac_type key; ไม่รู้จัก → undefined
 *  (acTypeOf fallback "wall" เอง — ไม่ migrate). Phase 570. */
export function _acTypeFromImport(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return undefined;
  if (["wall", "ceiling", "cassette"].includes(s)) return s;   // อังกฤษ key ตรง
  if (s.includes("ผนัง")) return "wall";                        // ติดผนัง / แอร์ติดผนัง
  if (s.includes("แขวน")) return "ceiling";                     // แขวน / แอร์แขวน
  if (s.includes("สี่ทิศ") || s.includes("cassette") || s.includes("4")) return "cassette";  // สี่ทิศทาง
  return undefined;
}

// ═══════════════════════════════════════════════════════════
//  Phase 87.3 — Extended fields helpers (CSV/Excel ↔ catalog object)
// ═══════════════════════════════════════════════════════════
// Array fields serialize as "item1 | item2 | item3" (pipe-separated)
const _arrToPipe = (a) => Array.isArray(a) ? a.join(" | ") : (a || "");
const _pipeToArr = (s) => String(s || "").split(/\s*\|\s*|\s*,\s*/).map(x => x.trim()).filter(Boolean);
// Number fields ที่อาจเป็น range string ("0.4-4.5") — try Number(), keep string ถ้า parse ไม่ได้
const _tryNum = (val) => {
  if (val === "" || val == null) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
};

/** flatten catalog entry → row object สำหรับ Excel/CSV export (24 columns) */
export function _toExportRow(c) {
  return {
    section: c.section || "",
    model: c.model || "",
    // ★ Phase 570 — ประเภทแอร์ + ต้นทุน/รหัส/หมายเหตุ (owner เติมประเภทใน Excel แล้ว import กลับ = จัดกลุ่ม bulk)
    ac_type: acTypeOf(c),
    cost: (c.cost !== undefined && c.cost !== null && c.cost !== "") ? Number(c.cost) : "",
    sku: c.sku || c.barcode || "",
    note: c.note || "",
    btu: Number(c.btu || 0),
    price: Number(c.price || 0),
    w_install: c.w_install || "",
    w_parts: c.w_parts || "",
    w_comp: c.w_comp || "",
    stock: Number(c.stock || 0),
    // ★ Phase 87.3 — extended schema v2
    description: c.description || "",
    features: _arrToPipe(c.features),
    badge_tags: _arrToPipe(c.badge_tags),
    image_url: c.image_url || "",
    seer: c.seer ?? "",
    refrigerant: c.refrigerant || "",
    voltage: c.voltage || "",
    current_a: c.current_a ?? "",
    power_w: c.power_w ?? "",
    indoor_dim: c.indoor_dim || "",
    outdoor_dim: c.outdoor_dim || "",
    indoor_weight_kg: c.indoor_weight_kg ?? "",
    outdoor_weight_kg: c.outdoor_weight_kg ?? "",
    noise_indoor_db: c.noise_indoor_db ?? "",
    noise_outdoor_db: c.noise_outdoor_db ?? "",
    color: c.color || ""
  };
}

export const _EXPORT_HEADERS = [
  "section","model","ac_type","btu","price","w_install","w_parts","w_comp","stock",
  "cost","sku","note",
  "description","features","badge_tags","image_url",
  "seer","refrigerant","voltage","current_a","power_w",
  "indoor_dim","outdoor_dim","indoor_weight_kg","outdoor_weight_kg",
  "noise_indoor_db","noise_outdoor_db","color"
];

/** parse Excel/CSV row → catalog entry (extended fields optional) */
export function _fromImportRow(r, idx, pick) {
  const section = String(pick(r, ["section", "ยี่ห้อ", "แบรนด์"]) || "").trim();
  const model   = String(pick(r, ["model", "รุ่น"]) || "").trim();
  if (!section || !model) return null;

  const priceRaw = String(pick(r, ["price", "price_install", "ราคา"]) || "0").replace(/[^0-9.]/g, "");
  const entry = {
    id: idx + 1,
    section,
    model,
    btu: Number(pick(r, ["btu"]) || 0) || 0,
    price: Number(priceRaw) || 0,
    w_install: String(pick(r, ["w_install", "ประกันติดตั้ง"]) || ""),
    w_parts:   String(pick(r, ["w_parts", "ประกันอะไหล่"]) || ""),
    w_comp:    String(pick(r, ["w_comp", "ประกันคอม", "ประกันคอมเพรสเซอร์"]) || ""),
    stock: Number(pick(r, ["stock", "stock_qty", "จำนวน"]) || 0) || 0
  };

  // ★ Extended fields — only set if non-empty (avoid burying schema with empty keys)
  const setIfTruthy = (key, val) => {
    if (val !== undefined && val !== null && val !== "" &&
        !(Array.isArray(val) && val.length === 0)) {
      entry[key] = val;
    }
  };

  setIfTruthy("description", String(pick(r, ["description", "คำอธิบาย"]) || "").trim() || undefined);
  const feats = _pipeToArr(pick(r, ["features", "จุดเด่น"]));
  setIfTruthy("features", feats.length ? feats : undefined);
  const badges = _pipeToArr(pick(r, ["badge_tags", "badges"]));
  setIfTruthy("badge_tags", badges.length ? badges : undefined);
  setIfTruthy("image_url",   String(pick(r, ["image_url", "รูป"]) || "").trim() || undefined);
  setIfTruthy("seer",        _tryNum(pick(r, ["seer"])));
  setIfTruthy("refrigerant", String(pick(r, ["refrigerant", "น้ำยา"]) || "").trim() || undefined);
  setIfTruthy("voltage",     String(pick(r, ["voltage", "แรงดัน"]) || "").trim() || undefined);
  setIfTruthy("current_a",   _tryNum(pick(r, ["current_a"])));
  setIfTruthy("power_w",     _tryNum(pick(r, ["power_w"])));
  setIfTruthy("indoor_dim",  String(pick(r, ["indoor_dim"]) || "").trim() || undefined);
  setIfTruthy("outdoor_dim", String(pick(r, ["outdoor_dim"]) || "").trim() || undefined);
  setIfTruthy("indoor_weight_kg",  _tryNum(pick(r, ["indoor_weight_kg"])));
  setIfTruthy("outdoor_weight_kg", _tryNum(pick(r, ["outdoor_weight_kg"])));
  setIfTruthy("noise_indoor_db",   _tryNum(pick(r, ["noise_indoor_db"])));
  setIfTruthy("noise_outdoor_db",  _tryNum(pick(r, ["noise_outdoor_db"])));
  setIfTruthy("color", String(pick(r, ["color", "สี"]) || "").trim() || undefined);

  // ★ Phase 570 — ประเภทแอร์ (map อังกฤษ/ไทย → key) + ต้นทุน/รหัส/หมายเหตุ
  setIfTruthy("ac_type", _acTypeFromImport(pick(r, ["ac_type", "ประเภท", "type", "ชนิด"])));
  setIfTruthy("cost", _tryNum(pick(r, ["cost", "ต้นทุน", "ทุน"])));
  setIfTruthy("sku", String(pick(r, ["sku", "barcode", "รหัส", "บาร์โค้ด"]) || "").trim() || undefined);
  setIfTruthy("note", String(pick(r, ["note", "หมายเหตุ"]) || "").trim() || undefined);

  return entry;
}

export function renderSettingsAcCatalog(el, ctx, goBack, navigate) {
  const catalog = _readCatalog();

  // ★ self-rerender helper — เรียกหลังแก้ data ให้ UI refresh ทันที
  const rerender = () => renderSettingsAcCatalog(el, ctx, goBack, navigate);

  // ★ ensure active tab valid
  if (!AC_TYPES.some(t => t.key === _acTab)) _acTab = "wall";
  // ★ จัดกลุ่มตามประเภทแอร์ (derive — ไม่ migrate; ของเดิมไม่มี ac_type → "wall")
  const countByType = {};
  AC_TYPES.forEach(t => { countByType[t.key] = 0; });
  catalog.forEach(c => { countByType[acTypeOf(c)] = (countByType[acTypeOf(c)] || 0) + 1; });
  const tabItems = catalog.filter(c => acTypeOf(c) === _acTab)
    .sort((a, b) => String(a.section || "").localeCompare(String(b.section || ""), "th") || String(a.model || "").localeCompare(String(b.model || ""), "th"));
  // summary (scope = active tab) — นี่คือ "แคตตาล็อกสำหรับทำราคา" ไม่ใช่สต็อกจริง
  const sumModels = tabItems.length;
  const sumBrands = [...new Set(tabItems.map(c => c.section).filter(Boolean))].length;
  // หมายเหตุ: field `stock` ในแคตตาล็อกนี้ใช้เป็น "สถานะเสนอขาย" (>0 = เปิดเสนอขาย) — ไม่ใช่จำนวนในคลังจริง
  const sumReady = tabItems.filter(c => Number(c.stock || 0) > 0).length;
  const sumOff = tabItems.filter(c => Number(c.stock || 0) <= 0).length;
  const activeLabel = acTypeLabel(_acTab);

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">🌬️ จัดการแคตตาล็อกแอร์</h3>
      </div>
      <div style="margin:-4px 0 14px;padding:9px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:12px;color:#1e40af;line-height:1.5">
        ℹ️ ใช้สำหรับตั้งราคาและเลือกสินค้าไปทำใบเสนอราคา — <b>ไม่ใช่สต็อกจริงในคลัง</b>
      </div>

      <!-- ★ Air-type tabs (3 ประเภท) -->
      <div class="ac-type-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        ${AC_TYPES.map(t => `
          <button type="button" class="ac-type-tab" data-ac-tab="${t.key}" style="flex:1 1 auto;min-width:96px;padding:9px 10px;border-radius:12px;border:1px solid ${_acTab === t.key ? '#0284c7' : '#e2e8f0'};background:${_acTab === t.key ? '#0284c7' : '#fff'};color:${_acTab === t.key ? '#fff' : '#475569'};font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">
            ${t.icon} ${escHtml(t.label)} <span style="opacity:.7;font-weight:600">(${countByType[t.key] || 0})</span>
          </button>
        `).join("")}
      </div>

      <!-- Summary cards (scope = ${escHtml(activeLabel)}) -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#eff6ff;border-radius:12px;padding:10px 6px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#0284c7">${sumModels}</div>
          <div style="font-size:10px;color:#64748b">รุ่นทั้งหมด</div>
        </div>
        <div style="background:#ecfdf5;border-radius:12px;padding:10px 6px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#059669">${sumBrands}</div>
          <div style="font-size:10px;color:#64748b">แบรนด์/กลุ่ม</div>
        </div>
        <div style="background:#f0fdf4;border-radius:12px;padding:10px 6px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#16a34a">${sumReady}</div>
          <div style="font-size:10px;color:#64748b">พร้อมเสนอขาย</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px 6px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#64748b">${sumOff}</div>
          <div style="font-size:10px;color:#64748b">ยังไม่เปิดขาย</div>
        </div>
      </div>

      <!-- ★ Primary actions + "จัดการเพิ่มเติม" menu -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <button id="acAddModelBtn" class="btn primary" style="font-size:13px;padding:8px 14px;font-weight:700">+ เพิ่มรุ่นแอร์</button>
        <button id="acImportQuickBtn" class="btn light" style="font-size:13px;padding:8px 12px">📂 นำเข้า Excel</button>
        <details class="prod-more-menu">
          <summary class="prod-more-trigger btn light" style="font-size:13px;padding:8px 12px">⋯ จัดการเพิ่มเติม</summary>
          <div class="prod-more-panel">
            <button id="acExportXlsxBtn" class="prod-more-item">📥 ดาวน์โหลด Excel (.xlsx)</button>
            <button id="acExportCsvBtn" class="prod-more-item">📄 ดาวน์โหลด CSV</button>
            <button id="acSetStock5Btn" class="prod-more-item" title="ตั้งทุกรุ่นเป็น 'พร้อมเสนอขาย'">⚙️ ตั้งค่าเริ่มต้นแคตตาล็อก</button>
            <button id="acCatalogRefreshBtn" class="prod-more-item">🔄 โหลดจาก JSON (reset)</button>
            <button id="acCatalogClearBtn" class="prod-more-item prod-more-danger">🗑️ ล้างแคตตาล็อกทั้งหมด</button>
          </div>
        </details>
      </div>

      <!-- ★ Product cards ของ tab ที่เลือก -->
      <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:8px">${escHtml(activeLabel)} <span style="color:#94a3b8;font-weight:600">(${tabItems.length} รุ่น)</span></div>
      ${tabItems.length > 0 ? `
      <div class="ac-stock-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${tabItems.map(c => {
          const hasSpec = !!(c.features || c.seer || c.description);
          const code = c.sku || c.barcode || "";
          const price = Number(c.price || 0);
          const hasCost = c.cost !== undefined && c.cost !== null && c.cost !== "" && Number.isFinite(Number(c.cost));
          const cost = hasCost ? Number(c.cost) : null;
          const profit = (price > 0 && hasCost) ? (price - cost) : null;
          const offered = Number(c.stock || 0) > 0;
          // 3-state badge: ราคา? → ต้องเช็คราคา ; เปิดเสนอขาย → พร้อมเสนอขาย ; ปิด → เลิกขาย
          const badge = price <= 0
            ? { t: 'ต้องเช็คราคา', bg: '#fef3c7', fg: '#92400e' }
            : (offered ? { t: 'พร้อมเสนอขาย', bg: '#dcfce7', fg: '#15803d' }
                       : { t: 'เลิกขาย', bg: '#f1f5f9', fg: '#64748b' });
          return `
          <div class="ac-stock-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
              <div style="min-width:0">
                <div style="font-size:14px;font-weight:800;color:#0f172a;line-height:1.25">${escHtml(c.model || "-")}</div>
                <div style="font-size:11px;color:#64748b;margin-top:1px">${escHtml(c.section || "-")}</div>
              </div>
              <span style="flex:0 0 auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${badge.bg};color:${badge.fg}">${badge.t}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;color:#475569">
              <span>❄️ ${Number(c.btu || 0).toLocaleString()} BTU</span>
              <span style="font-weight:800;color:#0284c7">ราคาเสนอ ฿${price.toLocaleString()}</span>
            </div>
            ${(hasCost || profit !== null) ? `
            <div style="display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;color:#64748b">
              ${hasCost ? `<span>ต้นทุนฯ ฿${cost.toLocaleString()}</span>` : ''}
              ${profit !== null ? `<span>กำไรฯ <strong style="color:${profit >= 0 ? '#16a34a' : '#dc2626'}">฿${profit.toLocaleString()}</strong></span>` : ''}
            </div>` : ''}
            ${code ? `<div style="font-size:11px;color:#94a3b8">รหัสอ้างอิง: ${escHtml(code)}</div>` : ''}
            ${c.note ? `<div style="font-size:11px;color:#94a3b8">📝 ${escHtml(c.note)}</div>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;align-items:flex-start">
              <button data-ac-edit="${c.id}" class="btn light" style="padding:6px 10px;font-size:12px;font-weight:700">✏️ แก้ไข</button>
              <button data-ac-quote="${c.id}" class="btn primary" style="padding:6px 10px;font-size:12px;font-weight:700">📝 นำไปเสนอราคา</button>
              <details class="prod-card-menu">
                <summary class="prod-cardmenu-trigger" title="เพิ่มเติม">⋯</summary>
                <div class="prod-cardmenu-panel">
                  <button class="prod-cardmenu-item" data-edit-spec="${c.id}">📋 ${hasSpec ? 'แก้สเปกเทคนิค' : 'เพิ่มสเปกเทคนิค'}</button>
                </div>
              </details>
            </div>
          </div>`;
        }).join("")}
      </div>
      ` : `<div style="text-align:center;padding:28px 16px;color:#94a3b8;background:#fff;border:1px dashed #e2e8f0;border-radius:14px">
            ยังไม่มีรุ่นในประเภท "${escHtml(activeLabel)}"<br>
            <span style="font-size:12px">กด <b>+ เพิ่มรุ่นแอร์</b> เพื่อเริ่ม หรือ นำเข้า Excel</span>
          </div>`}

      <!-- ★ นำเข้า / ส่งออก (ขั้นสูง) — section รอง, format Excel/CSV เดิมไม่เปลี่ยน -->
      <details style="margin-top:18px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <summary style="padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#f8fafc;color:#1f2937">📁 นำเข้า / ส่งออกไฟล์ (ขั้นสูง)</summary>
        <div style="padding:14px">
          <div style="text-align:center;padding:12px;border:2px dashed #0284c7;background:#f0f9ff;border-radius:12px">
            <div style="font-size:30px;margin-bottom:6px">📤</div>
            <div style="font-size:14px;font-weight:700;color:#0284c7;margin-bottom:4px">อัปโหลดไฟล์ — Excel (.xlsx) หรือ CSV</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:10px">รองรับ <b>24 คอลัมน์</b> — พื้นฐาน 8 + สเปกขยาย 16 ฟิลด์ (รูปแบบเดิม)</div>
            <input type="file" id="acCatalogFileInput" accept=".csv,.xlsx,.xls" style="display:none" />
            <button id="acCatalogImportBtn" class="btn primary" style="padding:9px 22px;font-size:14px">📂 เลือกไฟล์</button>
            <div id="acCatalogImportStatus" style="margin-top:8px;font-size:13px;color:#64748b"></div>
            <div style="margin-top:8px;font-size:11px;color:#94a3b8;line-height:1.7;text-align:left;max-width:520px;margin:8px auto 0">
              💡 <b>Workflow:</b> ดาวน์โหลด .xlsx → กรอกสเปกใน Excel → อัปโหลดกลับ — ข้อมูลจะทับของเดิม<br>
              <div style="margin:4px 0 0 8px;font-size:10px;color:#64748b">
                <b>พื้นฐาน:</b> section, model, btu, price, w_install, w_parts, w_comp, stock<br>
                <b>การตลาด:</b> description, features, badge_tags, image_url<br>
                <b>เทคนิค:</b> seer, refrigerant, voltage, current_a, power_w<br>
                <b>ขนาด:</b> indoor_dim, outdoor_dim, indoor_weight_kg, outdoor_weight_kg<br>
                <b>เสียง+สี:</b> noise_indoor_db, noise_outdoor_db, color
              </div>
              <div style="margin-top:4px;color:#10b981">
                ℹ️ <b>features / badge_tags</b> ใส่หลายค่าได้ คั่นด้วย <code style="background:#fff;padding:1px 4px;border-radius:3px">|</code> หรือ <code style="background:#fff;padding:1px 4px;border-radius:3px">,</code>
              </div>
              <div style="margin-top:6px;color:#94a3b8">ℹ️ ประเภทแอร์ / ต้นทุน / SKU / หมายเหตุ เป็นฟิลด์ใหม่ในแอป — ยังไม่อยู่ใน Excel รอบนี้ (จะเพิ่มรอบถัดไป)</div>
            </div>
          </div>
        </div>
      </details>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ═══ ★ Air-type tabs ═══
  el.querySelectorAll("[data-ac-tab]").forEach(btn => btn.addEventListener("click", () => {
    _acTab = btn.dataset.acTab;
    rerender();
  }));

  // ═══ ★ Action menus (header "จัดการเพิ่มเติม" + per-card "⋯") — accordion ═══
  el.querySelectorAll("details.prod-more-menu, details.prod-card-menu").forEach(d => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      el.querySelectorAll("details.prod-more-menu[open], details.prod-card-menu[open]").forEach(o => { if (o !== d) o.open = false; });
    });
  });

  // ═══ ★ เพิ่มรุ่นแอร์ (default ประเภท = tab ปัจจุบัน) ═══
  document.getElementById("acAddModelBtn")?.addEventListener("click", () => {
    openAcStockForm(null, _acTab, (entry) => {
      const list = _readCatalog();
      const nextId = list.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
      entry.id = nextId;
      list.push(entry);
      _writeCatalog(list);
      if (ctx?.showToast) ctx.showToast(`เพิ่มรุ่น ${entry.model} (${acTypeLabel(entry.ac_type)}) แล้ว ✅`);
      _acTab = entry.ac_type;
      rerender();
    });
  });

  // ═══ ★ แก้ไขรุ่น (core form) ═══
  el.querySelectorAll("[data-ac-edit]").forEach(btn => btn.addEventListener("click", () => {
    const id = Number(btn.dataset.acEdit);
    const list = _readCatalog();
    const idx = list.findIndex(c => Number(c.id) === id);
    if (idx < 0) return;
    openAcStockForm(list[idx], acTypeOf(list[idx]), (entry) => {
      list[idx] = { ...list[idx], ...entry };
      _writeCatalog(list);
      if (ctx?.showToast) ctx.showToast(`บันทึก ${entry.model} แล้ว ✅`);
      rerender();
    });
  }));

  // ═══ ★ นำไปเสนอราคา — เก็บ draft (sessionStorage) แล้วไปหน้าใบเสนอราคา ═══
  //   ไม่แตะคลัง/POS/Supabase/cart · ไม่สร้างเอกสารจริง — user ต้องกดบันทึกเองในหน้าใบเสนอราคา
  el.querySelectorAll("[data-ac-quote]").forEach(btn => btn.addEventListener("click", () => {
    const id = Number(btn.dataset.acQuote);
    const item = _readCatalog().find(c => Number(c.id) === id);
    if (item) {
      pushAirQuoteDraft({
        source: "air_catalog",
        catalogId: item.id,
        airType: acTypeLabel(acTypeOf(item)),
        brand: item.section || "",
        model: item.model || "",
        btu: Number(item.btu || 0),
        offerPrice: Number(item.price || 0),
        estimatedCost: (item.cost !== undefined && item.cost !== null && item.cost !== "") ? Number(item.cost) : null,
        sku: item.sku || item.barcode || "",
        note: item.note || ""
      });
    }
    if (ctx?.showToast) ctx.showToast(`เพิ่มเป็นรายการร่างในใบเสนอราคาแล้ว 📝`);
    // ไปหน้าใบเสนอราคา (navigation — แคตตาล็อกนี้ใช้ทำราคาเท่านั้น ไม่ตัดคลัง)
    if (ctx?.showRoute) ctx.showRoute("quotations");
    else window.location.hash = "quotations";
  }));

  // ═══ ★ ปุ่ม "นำเข้า Excel" หลัก → trigger file input เดิม (ไม่ซ้ำ logic) ═══
  document.getElementById("acImportQuickBtn")?.addEventListener("click", () => {
    document.getElementById("acCatalogFileInput")?.click();
  });

  // ═══ ตั้งค่าเริ่มต้นแคตตาล็อก — ทำให้ทุกรุ่นเป็น "พร้อมเสนอขาย" (ไม่ใช่สต็อกจริง) ═══
  document.getElementById("acSetStock5Btn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ตั้งค่าให้ทุกรุ่น (${catalog.length} รุ่น) เป็น "พร้อมเสนอขาย"?\n(แคตตาล็อกสำหรับทำราคา — ไม่ใช่สต็อกจริงในคลัง)`))) return;
    const updated = catalog.map(c => ({ ...c, stock: Number(c.stock || 0) > 0 ? c.stock : 5 }));
    _writeCatalog(updated);
    if (ctx?.showToast) ctx.showToast(`ตั้งค่าทุกรุ่นเป็น "พร้อมเสนอขาย" แล้ว ✅`);
    rerender();
  });

  // ═══ Export Excel (.xlsx) ═══
  document.getElementById("acExportXlsxBtn")?.addEventListener("click", () => {
    if (!window.XLSX) {
      if (ctx?.showToast) ctx.showToast("❌ XLSX library ยังไม่โหลด — ลอง refresh หน้า");
      return;
    }
    try {
      // ★ Phase 87.3 — flatten ผ่าน helper (24 columns: 8 หลัก + 16 extended)
      const rows = catalog.map(_toExportRow);
      const ws = window.XLSX.utils.json_to_sheet(rows, { header: _EXPORT_HEADERS });
      // ตั้งความกว้างคอลัมน์
      ws["!cols"] = [
        { wch: 28 }, { wch: 22 }, { wch: 8 },  { wch: 10 }, // section, model, btu, price
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 6 },  // warranty + stock
        { wch: 50 }, { wch: 40 }, { wch: 18 }, { wch: 30 }, // desc, features, badges, image
        { wch: 8 },  { wch: 12 }, { wch: 18 }, { wch: 12 }, // seer, refrig, voltage, current
        { wch: 12 }, { wch: 22 }, { wch: 22 },              // power, indoor_dim, outdoor_dim
        { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, // weights, noise
        { wch: 8 }                                            // color
      ];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "แคตตาล็อกแอร์");
      const today = new Date().toISOString().slice(0,10);
      window.XLSX.writeFile(wb, `ac-catalog-${today}.xlsx`);
      if (ctx?.showToast) ctx.showToast(`ดาวน์โหลด ac-catalog-${today}.xlsx (${rows.length} รุ่น) ✅`);
    } catch(err) {
      console.error("[ac-catalog export xlsx]", err);
      if (ctx?.showToast) ctx.showToast("❌ Export Excel ไม่สำเร็จ: " + err.message);
    }
  });

  // ═══ Export CSV (Phase 87.3 — 24 columns) ═══
  document.getElementById("acExportCsvBtn")?.addEventListener("click", () => {
    try {
      const csvEsc = (v) => {
        const s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [_EXPORT_HEADERS.join(",")];
      catalog.forEach(c => {
        const row = _toExportRow(c);
        lines.push(_EXPORT_HEADERS.map(h => csvEsc(row[h])).join(","));
      });
      // BOM สำหรับ Excel เปิดภาษาไทยถูกต้อง
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ac-catalog-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (ctx?.showToast) ctx.showToast(`ดาวน์โหลด CSV (${catalog.length} รุ่น) ✅`);
    } catch(err) {
      console.error("[ac-catalog export csv]", err);
      if (ctx?.showToast) ctx.showToast("❌ Export CSV ไม่สำเร็จ: " + err.message);
    }
  });

  // ═══ Import (CSV + XLSX) ═══
  document.getElementById("acCatalogImportBtn")?.addEventListener("click", () => {
    document.getElementById("acCatalogFileInput")?.click();
  });

  document.getElementById("acCatalogFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById("acCatalogImportStatus");
    if (statusEl) statusEl.textContent = "กำลังอ่านไฟล์...";

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    try {
      let rows = []; // array of objects with section/model/btu/price/...
      if (isExcel) {
        if (!window.XLSX) throw new Error("XLSX library ยังไม่โหลด — ลอง refresh หน้าก่อนอัปโหลด");
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        rows = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
      } else {
        // CSV path
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error("ไฟล์ว่างหรือไม่มีข้อมูล");
        const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ""));
        for (let i = 1; i < lines.length; i++) {
          const cols = splitCsvLine(lines[i]);
          const obj = {};
          header.forEach((h, idx) => { obj[h] = cols[idx] != null ? cols[idx].trim() : ""; });
          rows.push(obj);
        }
      }

      if (rows.length === 0) throw new Error("ไม่พบข้อมูลในไฟล์");

      // ─── Map columns — รองรับทั้งภาษาไทย/อังกฤษ + field ของเก่า ───
      const pick = (obj, keys) => {
        for (const k of keys) {
          const found = Object.keys(obj).find(ok => ok.toLowerCase().replace(/\s+/g,"") === k.toLowerCase().replace(/\s+/g,""));
          if (found && obj[found] !== "" && obj[found] != null) return obj[found];
        }
        return "";
      };

      const newCatalog = [];
      rows.forEach((r, idx) => {
        // ★ Phase 87.3 — parse ผ่าน helper (รองรับ extended fields ทั้ง 16 ตัว)
        const entry = _fromImportRow(r, idx, pick);
        if (entry) newCatalog.push(entry);
      });

      if (newCatalog.length === 0) throw new Error("ไม่พบแถวที่มี section + model");

      _writeCatalog(newCatalog);
      if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:700">✅ นำเข้าสำเร็จ! ${newCatalog.length} รุ่น จาก ${[...new Set(newCatalog.map(c=>c.section))].length} แบรนด์</span>`;
      if (ctx?.showToast) ctx.showToast(`นำเข้าแคตตาล็อก ${newCatalog.length} รุ่น สำเร็จ! ✅`);
      setTimeout(rerender, 800);
    } catch (err) {
      console.error("[ac-catalog import]", err);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ ${escHtml(err.message)}</span>`;
    } finally {
      // eslint-disable-next-line require-atomic-updates -- A: UI file input reset after import, single upload handler per click
      e.target.value = ""; // reset input ให้เลือกไฟล์เดิมซ้ำได้
    }
  });

  // ═══ Phase 87.2 — Edit spec per row ═══
  // ★ Phase 87.4 — pass sourceList = SKUs ที่มี extended specs (ให้ copy spec ได้)
  document.querySelectorAll("[data-edit-spec]").forEach(btn => btn.addEventListener("click", () => {
    const id = Number(btn.dataset.editSpec);
    const idx = catalog.findIndex(c => c.id === id);
    if (idx < 0) return;
    const sourceList = catalog.filter(c => c.features || c.seer || c.description);
    openSpecEditor(catalog[idx], (updates) => {
      catalog[idx] = { ...catalog[idx], ...updates };
      _writeCatalog(catalog);
      if (ctx?.showToast) ctx.showToast(`บันทึกสเปก ${catalog[idx].model} แล้ว ✅`);
      rerender();
    }, sourceList);
  }));

  // ═══ Refresh from JSON file ═══
  document.getElementById("acCatalogRefreshBtn")?.addEventListener("click", async () => {
    if (catalog.length > 0 && !(await window.App?.confirm?.("โหลดใหม่จาก JSON จะทับข้อมูลปัจจุบัน — แน่ใจ?"))) return;
    try {
      const resp = await fetch("data/ac_catalog.json");
      if (!resp.ok) throw new Error("ไม่พบไฟล์ ac_catalog.json");
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error("ไฟล์ว่าง");
      localStorage.setItem("bsk_ac_catalog", JSON.stringify(data));
      // Phase 570: manual "โหลดใหม่จาก JSON" = reset baseline โดยตั้งใจ → เคลียร์ flag (auto-refresh กลับมาทำงานได้)
      try { localStorage.removeItem("bsk_ac_catalog_user_edited"); } catch(e){}
      // ★ Phase 574: reset = global (มี confirm แล้ว) → push ชุดใหม่ขึ้น cloud ให้ทุกเครื่อง + mark from_cloud
      try {
        const res = await window._appSaveAcCatalog?.(data);
        if (res?.ok) { try { localStorage.setItem("bsk_ac_catalog_from_cloud", "1"); } catch(e){} }
        else if (res && !res.denied && ctx?.showToast) ctx.showToast("โหลดในเครื่องแล้ว แต่ sync ข้ามเครื่องไม่สำเร็จ", "warn");
      } catch(e){ console.warn("[ac-catalog] reload cloud sync failed:", e); }
      if (ctx?.showToast) ctx.showToast(`โหลดแคตตาล็อก ${data.length} รุ่น สำเร็จ! ✅`);
      rerender();
    } catch(err) {
      if (ctx?.showToast) ctx.showToast("❌ " + err.message, "error");
    }
  });

  // ═══ Clear catalog ═══
  document.getElementById("acCatalogClearBtn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.("ล้างแคตตาล็อกแอร์ทั้งหมด? ข้อมูลจะถูกลบออกจากหน้าลูกค้า"))) return;
    localStorage.removeItem("bsk_ac_catalog");
    try { localStorage.removeItem("bsk_ac_catalog_user_edited"); } catch(e){}
    // ★ Phase 574: ล้าง = global → push value=[] ขึ้น cloud (ทุกเครื่อง + หน้าลูกค้าหายตาม; ไม่มี DELETE policy = UPDATE เป็น [])
    try {
      const res = await window._appSaveAcCatalog?.([]);
      if (res?.ok) { try { localStorage.setItem("bsk_ac_catalog_from_cloud", "1"); } catch(e){} }
      else if (res && !res.denied && ctx?.showToast) ctx.showToast("ล้างในเครื่องแล้ว แต่ sync ข้ามเครื่องไม่สำเร็จ", "warn");
    } catch(e){ console.warn("[ac-catalog] clear cloud sync failed:", e); }
    if (ctx?.showToast) ctx.showToast("ล้างแคตตาล็อกแล้ว");
    rerender();
  });
}

// ─── CSV splitter รองรับ quoted values (มี comma ในค่า) ───
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
