// ═══════════════════════════════════════════════════════════
//  ac-spec-editor.js — Admin form แก้สเปก AC catalog (Phase 87.2)
//
//  เปิด modal ที่มี form ครบสำหรับ extended fields ของ catalog v2:
//    description (textarea)
//    features    (tag list — comma-separated input หรือ list)
//    badge_tags  (tag list)
//    seer / refrigerant / voltage / current_a / power_w
//    indoor_dim / outdoor_dim / indoor_weight_kg / outdoor_weight_kg
//    noise_indoor_db / noise_outdoor_db / color
//    image_url
//
//  Usage:
//    import { openSpecEditor } from "./ac-spec-editor.js";
//    openSpecEditor(product, (updatedFields) => {
//      Object.assign(catalog[idx], updatedFields);
//      localStorage.setItem("bsk_ac_catalog", JSON.stringify(catalog));
//      rerender();
//    });
// ═══════════════════════════════════════════════════════════

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function _injectKf() {
  if (document.head.dataset.specEdKf === "1") return;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes spec-fade-in { from { opacity:0 } to { opacity:1 } }
    @keyframes spec-slide-up { from { transform: translateY(40px); opacity:0 } to { transform: translateY(0); opacity:1 } }
    .spec-overlay { animation: spec-fade-in .2s ease-out }
    .spec-modal   { animation: spec-slide-up .25s ease-out }
    .spec-input { width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-family:inherit }
    .spec-input:focus { outline:none;border-color:#0284c7;box-shadow:0 0 0 3px rgba(2,132,199,.15) }
    .spec-label { font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;display:block }
    .spec-section { margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0 }
    .spec-section h4 { font-size:13px;font-weight:700;color:#0f172a;margin:0 0 10px }
    @media (max-width:640px) {
      .spec-modal { max-width:100% !important;max-height:100vh !important;border-radius:0 !important }
      .spec-grid-2 { grid-template-columns:1fr !important }
    }
  `;
  document.head.appendChild(s);
  document.head.dataset.specEdKf = "1";
}

/**
 * เปิด modal กรอก/แก้สเปกเครื่อง
 * @param {object} product
 * @param {(updates: object) => void} onSave - callback เมื่อกดบันทึก
 * @param {Array<object>} [sourceList] - รายการ SKU ที่มี specs ครบ (สำหรับ Phase 87.4 copy from)
 */
export function openSpecEditor(product, onSave, sourceList = []) {
  if (!product) return;
  _injectKf();
  document.getElementById("spec-overlay")?.remove();

  // Helper convert array ↔ comma string
  const arrToStr = (a) => Array.isArray(a) ? a.join(", ") : (a || "");

  // ★ Phase 87.4 — Group sourceList by section + filter out current product
  const sourcesGrouped = (() => {
    const map = {};
    sourceList.forEach(s => {
      if (s.id === product.id) return; // skip self
      const sec = s.section || "อื่นๆ";
      (map[sec] = map[sec] || []).push(s);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "th"));
  })();
  const hasSources = sourcesGrouped.length > 0;

  const overlay = document.createElement("div");
  overlay.id = "spec-overlay";
  overlay.className = "spec-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px";

  overlay.innerHTML = `
    <div class="spec-modal" role="dialog" aria-label="แก้สเปกเครื่อง" style="background:#fff;border-radius:16px;max-width:640px;max-height:92vh;width:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.3)">

      <!-- Header -->
      <div style="padding:14px 18px;background:#0f172a;color:#fff;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600">${escHtml(product.section || '')}</div>
          <div style="font-size:16px;font-weight:800">✏️ แก้สเปก: ${escHtml(product.model || product.name || '')}</div>
        </div>
        <button id="specCloseBtn" aria-label="ปิด" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.1);color:#fff;font-size:16px;cursor:pointer">✕</button>
      </div>

      <!-- Body (scrollable) -->
      <div style="overflow-y:auto;padding:16px 18px;flex:1">

        ${hasSources ? `
        <!-- ★ Phase 87.4 — Copy spec from another SKU (Hybrid workflow) -->
        <div style="margin-bottom:14px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px">
          <div style="font-size:12px;font-weight:700;color:#065f46;margin-bottom:6px">📋 คัดลอกสเปกจากรุ่นอื่น (เร็ว)</div>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="specCopyFrom" class="spec-input" style="flex:1">
              <option value="">— เลือกรุ่นที่จะคัดลอกมา —</option>
              ${sourcesGrouped.map(([sec, items]) => `
                <optgroup label="${escAttr(sec)}">
                  ${items.map(s => `<option value="${s.id}">${escHtml(s.model)}${s.btu ? ' (' + Number(s.btu).toLocaleString() + ' BTU)' : ''}</option>`).join("")}
                </optgroup>
              `).join("")}
            </select>
            <button type="button" id="specCopyBtn" disabled style="padding:8px 14px;border:none;border-radius:8px;background:#94a3b8;color:#fff;font-size:13px;font-weight:700;cursor:not-allowed;opacity:.5;transition:.15s">📥 ดูด</button>
          </div>
          <div style="font-size:10px;color:#64748b;margin-top:4px">⚠️ ดูดสเปก (description / features / SEER / dim / weight / ฯลฯ) — ราคา/BTU/รุ่น คงเดิม</div>
        </div>
        ` : ''}

        <!-- Description -->
        <label class="spec-label">📝 คำอธิบาย</label>
        <textarea id="specDesc" class="spec-input" rows="3" placeholder="เช่น: แอร์ติดผนัง TCL Inverter 9,000 BTU เหมาะกับห้องนอน 12-15 ตร.ม. ...">${escHtml(product.description || '')}</textarea>

        <!-- Features -->
        <div style="margin-top:12px">
          <label class="spec-label">✨ จุดเด่น (คั่นด้วย comma)</label>
          <textarea id="specFeatures" class="spec-input" rows="2" placeholder="เช่น: Inverter ประหยัดไฟ 30%, WiFi ควบคุมผ่านมือถือ, Self-Cleaning, Anti-Bacterial">${escHtml(arrToStr(product.features))}</textarea>
          <div style="font-size:11px;color:#94a3b8;margin-top:3px">แต่ละจุดเด่นจะแสดงเป็น tag pill สวยๆ</div>
        </div>

        <!-- Badges -->
        <div style="margin-top:12px">
          <label class="spec-label">🏷️ Badges (คั่นด้วย comma)</label>
          <input type="text" id="specBadges" class="spec-input" placeholder="เช่น: ขายดี, Inverter, WiFi" value="${escAttr(arrToStr(product.badge_tags))}" />
          <div style="font-size:11px;color:#94a3b8;margin-top:3px">แสดงเป็น label สีแดงด้านบนรูปสินค้า</div>
        </div>

        <!-- Image URL -->
        <div style="margin-top:12px">
          <label class="spec-label">🖼️ URL รูปสินค้า</label>
          <input type="url" id="specImage" class="spec-input" placeholder="https://..." value="${escAttr(product.image_url || '')}" />
          <div style="font-size:11px;color:#94a3b8;margin-top:3px">เว้นว่าง = ใช้ ❄️ placeholder</div>
        </div>

        <!-- ─── Tech specs ─── -->
        <div class="spec-section">
          <h4>⚙️ สเปกหลัก</h4>
          <div class="spec-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="spec-label">SEER</label>
              <input type="text" id="specSeer" class="spec-input" placeholder="เช่น 17.0" value="${escAttr(product.seer ?? '')}" />
            </div>
            <div>
              <label class="spec-label">น้ำยาแอร์</label>
              <input type="text" id="specRefrig" class="spec-input" placeholder="R32" value="${escAttr(product.refrigerant || '')}" />
            </div>
            <div>
              <label class="spec-label">แรงดันไฟ</label>
              <input type="text" id="specVoltage" class="spec-input" placeholder="220V/1Ph/50Hz" value="${escAttr(product.voltage || '')}" />
            </div>
            <div>
              <label class="spec-label">สี</label>
              <input type="text" id="specColor" class="spec-input" placeholder="ขาว" value="${escAttr(product.color || '')}" />
            </div>
            <div>
              <label class="spec-label">กระแสไฟ (A)</label>
              <input type="text" id="specCurrent" class="spec-input" placeholder="3.8 หรือ 0.4-4.5" value="${escAttr(product.current_a ?? '')}" />
            </div>
            <div>
              <label class="spec-label">กำลังไฟ (W)</label>
              <input type="text" id="specPower" class="spec-input" placeholder="830 หรือ 100-1000" value="${escAttr(product.power_w ?? '')}" />
            </div>
          </div>
        </div>

        <!-- ─── Dimensions ─── -->
        <div class="spec-section">
          <h4>📐 ขนาด & น้ำหนัก</h4>
          <div class="spec-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="spec-label">ตัวใน W×H×D (mm)</label>
              <input type="text" id="specInDim" class="spec-input" placeholder="770 × 285 × 192" value="${escAttr(product.indoor_dim || '')}" />
            </div>
            <div>
              <label class="spec-label">ตัวนอก W×H×D (mm)</label>
              <input type="text" id="specOutDim" class="spec-input" placeholder="720 × 540 × 270" value="${escAttr(product.outdoor_dim || '')}" />
            </div>
            <div>
              <label class="spec-label">น้ำหนักตัวใน (kg)</label>
              <input type="number" id="specInWeight" class="spec-input" step="0.1" placeholder="8" value="${escAttr(product.indoor_weight_kg ?? '')}" />
            </div>
            <div>
              <label class="spec-label">น้ำหนักตัวนอก (kg)</label>
              <input type="number" id="specOutWeight" class="spec-input" step="0.1" placeholder="25" value="${escAttr(product.outdoor_weight_kg ?? '')}" />
            </div>
          </div>
        </div>

        <!-- ─── Noise ─── -->
        <div class="spec-section">
          <h4>🔇 เสียง</h4>
          <div class="spec-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="spec-label">เสียงตัวใน (dB)</label>
              <input type="text" id="specNoiseIn" class="spec-input" placeholder="38 หรือ 22-40" value="${escAttr(product.noise_indoor_db ?? '')}" />
            </div>
            <div>
              <label class="spec-label">เสียงตัวนอก (dB)</label>
              <input type="text" id="specNoiseOut" class="spec-input" placeholder="53" value="${escAttr(product.noise_outdoor_db ?? '')}" />
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:8px">
        <button id="specCancelBtn" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer">ยกเลิก</button>
        <button id="specSaveBtn" style="flex:1;padding:10px;border:none;border-radius:10px;background:#0284c7;color:#fff;font-size:15px;font-weight:800;cursor:pointer">💾 บันทึกสเปก</button>
      </div>

    </div>
  `;
  document.body.appendChild(overlay);

  // Helpers
  const close = () => overlay.remove();
  const v = (id) => document.getElementById(id)?.value?.trim() ?? "";
  const vNum = (id) => {
    const s = v(id);
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : s; // คงเป็น string ถ้าไม่ใช่ตัวเลขแท้ (e.g. "0.4-4.5")
  };
  const vArr = (id) => v(id).split(",").map(s => s.trim()).filter(Boolean);

  // ★ Phase 87.4 — Copy spec from another SKU
  const _setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val ?? "";
  };
  const copySelect = document.getElementById("specCopyFrom");
  const copyBtn = document.getElementById("specCopyBtn");
  copySelect?.addEventListener("change", () => {
    const enabled = !!copySelect.value;
    copyBtn.disabled = !enabled;
    copyBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    copyBtn.style.opacity = enabled ? "1" : ".5";
    copyBtn.style.background = enabled ? "#10b981" : "#94a3b8";
  });
  copyBtn?.addEventListener("click", () => {
    const id = Number(copySelect.value);
    const src = sourceList.find(s => s.id === id);
    if (!src) return;
    // Fill form fields (keep id/section/model/btu/price/stock — only copy spec fields)
    _setVal("specDesc", src.description || "");
    _setVal("specFeatures", arrToStr(src.features));
    _setVal("specBadges", arrToStr(src.badge_tags));
    _setVal("specImage", src.image_url || "");
    _setVal("specSeer", src.seer ?? "");
    _setVal("specRefrig", src.refrigerant || "");
    _setVal("specVoltage", src.voltage || "");
    _setVal("specColor", src.color || "");
    _setVal("specCurrent", src.current_a ?? "");
    _setVal("specPower", src.power_w ?? "");
    _setVal("specInDim", src.indoor_dim || "");
    _setVal("specOutDim", src.outdoor_dim || "");
    _setVal("specInWeight", src.indoor_weight_kg ?? "");
    _setVal("specOutWeight", src.outdoor_weight_kg ?? "");
    _setVal("specNoiseIn", src.noise_indoor_db ?? "");
    _setVal("specNoiseOut", src.noise_outdoor_db ?? "");
    // Visual feedback
    copyBtn.textContent = "✅ คัดลอกแล้ว";
    copyBtn.style.background = "#0284c7";
    setTimeout(() => { copyBtn.textContent = "📥 ดูด"; copyBtn.style.background = "#10b981"; }, 1500);
  });

  // Bind
  document.getElementById("specCloseBtn")?.addEventListener("click", close);
  document.getElementById("specCancelBtn")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });

  document.getElementById("specSaveBtn")?.addEventListener("click", () => {
    const updates = {
      description: v("specDesc") || undefined,
      features: vArr("specFeatures"),
      badge_tags: vArr("specBadges"),
      image_url: v("specImage") || undefined,
      seer: vNum("specSeer"),
      refrigerant: v("specRefrig") || undefined,
      voltage: v("specVoltage") || undefined,
      color: v("specColor") || undefined,
      current_a: vNum("specCurrent"),
      power_w: vNum("specPower"),
      indoor_dim: v("specInDim") || undefined,
      outdoor_dim: v("specOutDim") || undefined,
      indoor_weight_kg: vNum("specInWeight"),
      outdoor_weight_kg: vNum("specOutWeight"),
      noise_indoor_db: vNum("specNoiseIn"),
      noise_outdoor_db: vNum("specNoiseOut")
    };
    // ลบ key ที่เป็น null/undefined/empty array
    for (const k of Object.keys(updates)) {
      const val = updates[k];
      if (val === null || val === undefined) delete updates[k];
      if (Array.isArray(val) && val.length === 0) delete updates[k];
    }
    if (typeof onSave === "function") onSave(updates);
    close();
  });
}
