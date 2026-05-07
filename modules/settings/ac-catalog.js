import { escHtml } from "./utils.js";
// Phase 87.2 — spec editor modal
import { openSpecEditor } from "./ac-spec-editor.js";

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
function _toExportRow(c) {
  return {
    section: c.section || "",
    model: c.model || "",
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

const _EXPORT_HEADERS = [
  "section","model","btu","price","w_install","w_parts","w_comp","stock",
  "description","features","badge_tags","image_url",
  "seer","refrigerant","voltage","current_a","power_w",
  "indoor_dim","outdoor_dim","indoor_weight_kg","outdoor_weight_kg",
  "noise_indoor_db","noise_outdoor_db","color"
];

/** parse Excel/CSV row → catalog entry (extended fields optional) */
function _fromImportRow(r, idx, pick) {
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

  return entry;
}

export function renderSettingsAcCatalog(el, ctx, goBack, navigate) {
  let catalog = [];
  try { catalog = JSON.parse(localStorage.getItem("bsk_ac_catalog") || "[]"); } catch(e){ console.warn("[settings/ac-catalog] parse failed:", e); }
  const sections = [...new Set(catalog.map(c => c.section))];

  // ★ self-rerender helper — เรียกหลังแก้ data ให้ UI refresh ทันที
  const rerender = () => renderSettingsAcCatalog(el, ctx, goBack, navigate);

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">🌬️ จัดการแคตตาล็อกแอร์</h3>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:16px">
        <div style="background:#eff6ff;border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:22px;font-weight:900;color:#0284c7">${catalog.length}</div>
          <div style="font-size:11px;color:#64748b">รุ่นทั้งหมด</div>
        </div>
        <div style="background:#ecfdf5;border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:22px;font-weight:900;color:#059669">${sections.length}</div>
          <div style="font-size:11px;color:#64748b">แบรนด์/ประเภท</div>
        </div>
        <div style="background:#fef3c7;border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:22px;font-weight:900;color:#d97706">${catalog.filter(c => (c.stock||0) > 0).length}</div>
          <div style="font-size:11px;color:#64748b">มีสต็อก</div>
        </div>
      </div>

      <!-- ★ Quick actions (stock + excel export) -->
      ${catalog.length > 0 ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:12px">
        <button id="acSetStock5Btn" class="btn" style="background:#f0fdf4;color:#059669;border:1px solid #86efac;padding:10px;font-weight:700">
          📦 ตั้งสต็อก 5 เครื่องทุกรุ่น
        </button>
        <button id="acExportXlsxBtn" class="btn" style="background:#eff6ff;color:#0284c7;border:1px solid #93c5fd;padding:10px;font-weight:700">
          📥 ดาวน์โหลด Excel (.xlsx)
        </button>
        <button id="acExportCsvBtn" class="btn" style="background:#f8fafc;color:#475569;border:1px solid #cbd5e1;padding:10px;font-weight:700">
          📄 ดาวน์โหลด CSV
        </button>
      </div>
      ` : ''}

      <!-- CSV/Excel Import -->
      <div class="set-form-card" style="border:2px dashed #0284c7;background:#f0f9ff">
        <div style="text-align:center;padding:16px">
          <div style="font-size:36px;margin-bottom:8px">📤</div>
          <div style="font-size:15px;font-weight:700;color:#0284c7;margin-bottom:4px">อัปโหลดไฟล์ — Excel (.xlsx) หรือ CSV</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:12px">รองรับ <b>24 คอลัมน์</b> — พื้นฐาน 8 + สเปกขยาย 16 ฟิลด์</div>
          <input type="file" id="acCatalogFileInput" accept=".csv,.xlsx,.xls" style="display:none" />
          <button id="acCatalogImportBtn" class="btn primary" style="padding:10px 24px;font-size:14px">📂 เลือกไฟล์</button>
          <div id="acCatalogImportStatus" style="margin-top:8px;font-size:13px;color:#64748b"></div>
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;line-height:1.7;text-align:left;max-width:520px;margin-left:auto;margin-right:auto">
            💡 <b>Workflow:</b> ดาวน์โหลด .xlsx → กรอกสเปกใน Excel → อัปโหลดกลับ — ข้อมูลจะทับของเดิม<br>
            🆕 <b>Phase 87.3</b> — ตอนนี้รองรับ extended fields:
            <div style="margin:4px 0 0 8px;font-size:10px;color:#64748b">
              <b>พื้นฐาน:</b> section, model, btu, price, w_install, w_parts, w_comp, stock<br>
              <b>การตลาด:</b> description, features, badge_tags, image_url<br>
              <b>เทคนิค:</b> seer, refrigerant, voltage, current_a, power_w<br>
              <b>ขนาด:</b> indoor_dim, outdoor_dim, indoor_weight_kg, outdoor_weight_kg<br>
              <b>เสียง+สี:</b> noise_indoor_db, noise_outdoor_db, color
            </div>
            <div style="margin-top:4px;color:#10b981">
              ℹ️ <b>features / badge_tags</b> ใส่หลายค่าได้ คั่นด้วย <code style="background:#fff;padding:1px 4px;border-radius:3px">|</code> หรือ <code style="background:#fff;padding:1px 4px;border-radius:3px">,</code>
              <br>เช่น <code style="background:#fff;padding:1px 4px;border-radius:3px">Inverter | WiFi | Self-Cleaning</code>
            </div>
          </div>
        </div>
      </div>

      <!-- Current catalog list (collapsed by section) -->
      <div style="margin-top:16px">
        <div style="font-size:15px;font-weight:900;color:#1f2937;margin-bottom:8px">📋 รายการปัจจุบัน (${catalog.length} รุ่น)</div>
        ${sections.length > 0 ? sections.map(sec => {
          const items = catalog.filter(c => c.section === sec);
          return `
          <details style="margin-bottom:6px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
            <summary style="padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#f8fafc;color:#1f2937">
              ${escHtml(sec)} <span style="color:#94a3b8;font-weight:400">(${items.length} รุ่น)</span>
            </summary>
            <div style="padding:8px 14px">
              ${items.map(c => {
                const hasSpec = !!(c.features || c.seer || c.description);
                return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
                  <div style="flex:1;min-width:0">
                    <span style="font-weight:700">${escHtml(c.model)}</span>
                    <span style="color:#64748b;margin-left:6px">❄️ ${Number(c.btu||0).toLocaleString()} BTU</span>
                    ${hasSpec ? '<span title="มีสเปกครบ" style="color:#10b981;margin-left:4px">📋</span>' : ''}
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;text-align:right">
                    <span style="font-weight:700;color:#0284c7">฿${Number(c.price||0).toLocaleString()}</span>
                    <span style="color:${(c.stock||0) > 0 ? '#10b981' : '#ef4444'}">${(c.stock||0) > 0 ? '✅' + c.stock : '—'}</span>
                    <button data-edit-spec="${c.id}" title="${hasSpec ? 'แก้สเปก' : 'เพิ่มสเปก'}" style="padding:3px 8px;border:1px solid ${hasSpec ? '#10b981' : '#cbd5e1'};border-radius:6px;background:${hasSpec ? '#ecfdf5' : '#fff'};color:${hasSpec ? '#065f46' : '#64748b'};cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap">✏️ ${hasSpec ? 'แก้' : '+ สเปก'}</button>
                  </div>
                </div>`;
              }).join("")}
            </div>
          </details>`;
        }).join("") : '<div style="text-align:center;padding:24px;color:#94a3b8">ยังไม่มีข้อมูลแคตตาล็อก — กรุณาอัปโหลดไฟล์</div>'}
      </div>

      <!-- Actions -->
      <div style="display:grid;gap:8px;margin-top:16px">
        <button id="acCatalogRefreshBtn" class="btn" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;padding:10px">🔄 โหลดแคตตาล็อกจาก JSON ไฟล์ (reset)</button>
        ${catalog.length > 0 ? `<button id="acCatalogClearBtn" class="btn" style="background:#fef2f2;color:#ef4444;border:1px solid #fca5a5;padding:10px">🗑️ ล้างแคตตาล็อกทั้งหมด</button>` : ''}
      </div>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ═══ ตั้งสต็อก 5 เครื่องทุกรุ่น ═══
  document.getElementById("acSetStock5Btn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ตั้งสต็อก 5 เครื่องทุกรุ่น (${catalog.length} รุ่น)?\nทุกรุ่นจะแสดงว่า "พร้อมส่ง" ในหน้าลูกค้า`))) return;
    const updated = catalog.map(c => ({ ...c, stock: 5 }));
    localStorage.setItem("bsk_ac_catalog", JSON.stringify(updated));
    if (ctx?.showToast) ctx.showToast(`ตั้งสต็อก 5 เครื่องให้ ${updated.length} รุ่นแล้ว ✅`);
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

      localStorage.setItem("bsk_ac_catalog", JSON.stringify(newCatalog));
      if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:700">✅ นำเข้าสำเร็จ! ${newCatalog.length} รุ่น จาก ${[...new Set(newCatalog.map(c=>c.section))].length} แบรนด์</span>`;
      if (ctx?.showToast) ctx.showToast(`นำเข้าแคตตาล็อก ${newCatalog.length} รุ่น สำเร็จ! ✅`);
      setTimeout(rerender, 800);
    } catch (err) {
      console.error("[ac-catalog import]", err);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ ${escHtml(err.message)}</span>`;
    } finally {
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
      localStorage.setItem("bsk_ac_catalog", JSON.stringify(catalog));
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
