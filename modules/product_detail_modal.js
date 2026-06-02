// ═══════════════════════════════════════════════════════════
//  product_detail_modal.js — รายละเอียดสินค้าแอร์ (Phase 87.1)
//
//  Modal popup ที่ลูกค้าคลิกที่ product card → ดูสเปกครบ
//  ออกแบบให้ดูเหมือนหน้าสินค้าของห้างใหญ่ — รูป + สเปก + จุดเด่น + CTA
//
//  Schema fields ที่รองรับ (placeholder ถ้าไม่มี):
//    Required: id, model, section, btu, price
//    Warranty: w_install, w_parts, w_comp
//    Visual:   image_url, image_gallery (array of urls)
//    Marketing: description, features (array of strings), badge_tags
//    Tech:     seer, eer, refrigerant, voltage, current_a, power_w,
//              indoor_dim, outdoor_dim, indoor_weight_kg,
//              outdoor_weight_kg, noise_indoor_db, noise_outdoor_db,
//              color
//
//  Usage:
//    import { openProductDetail } from "./product_detail_modal.js";
//    openProductDetail(product, { onAddToCart: (p) => ..., onReserve: (p) => ... });
// ═══════════════════════════════════════════════════════════

const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function money(n) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 }).format(Number(n || 0));
}

// Inject keyframes ครั้งเดียว (slide-up animation)
function _injectKeyframes() {
  if (document.head.dataset.pdmKf === "1") return;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes pdm-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pdm-slide-up { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .pdm-overlay { animation: pdm-fade-in .2s ease-out; }
    .pdm-modal { animation: pdm-slide-up .25s ease-out; }
    .pdm-spec-row:nth-child(odd) { background: #f8fafc; }
    .pdm-feature-pill { background: #ecfdf5; color: #065f46; padding: 6px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; display: inline-block; margin: 3px; }
    .pdm-close-btn:hover { background: #f1f5f9; }
    @media (max-width: 640px) {
      .pdm-modal { max-width: 100% !important; max-height: 100vh !important; border-radius: 0 !important; }
      .pdm-grid-cols { grid-template-columns: 1fr !important; }
    }
  `;
  document.head.appendChild(style);
  document.head.dataset.pdmKf = "1";
}

// Render single spec row (label + value, ถ้ามี value)
function _specRow(label, value, unit = "") {
  if (value === undefined || value === null || value === "" || value === 0) return "";
  return `<div class="pdm-spec-row" style="display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px">
    <span style="color:#64748b;font-weight:500">${escHtml(label)}</span>
    <span style="color:#0f172a;font-weight:700;text-align:right">${escHtml(String(value))}${unit ? " " + escHtml(unit) : ""}</span>
  </div>`;
}

/**
 * เปิด modal รายละเอียดสินค้า
 * @param {object} p product object (จาก ac_catalog.json)
 * @param {object} opts
 * @param {function} [opts.onAddToCart] - callback เมื่อกด "เพิ่มลงตะกร้า"
 * @param {function} [opts.onReserve] - callback เมื่อกด "สั่งจอง"
 * @param {boolean} [opts.inCart=false] - แสดง state "ในตะกร้าแล้ว"
 * @param {number} [opts.inCartQty=0]
 */
export function openProductDetail(p, opts = {}) {
  if (!p) return;
  _injectKeyframes();

  // ลบ modal เก่าถ้ามี
  document.getElementById("pdm-overlay")?.remove();

  const { onAddToCart, onReserve, inCart = false, inCartQty = 0, reserveOnly = false, ctaLabel: ctaLabelOpt } = opts;

  // ─── Image (placeholder ถ้าไม่มี) ─────────────────────────
  const imgUrl = p.image_url || p.img || "";
  const heroImg = imgUrl
    ? `<img src="${escHtml(imgUrl)}" alt="${escHtml(p.model)}" style="width:100%;height:280px;object-fit:contain;background:linear-gradient(135deg,#e0f2fe,#bae6fd)" />`
    : `<div style="width:100%;height:280px;background:linear-gradient(135deg,#e0f2fe,#bae6fd);display:flex;align-items:center;justify-content:center;font-size:96px">❄️</div>`;

  // ─── Badge tags (เช่น "ขายดี", "ใหม่", "Inverter") ─────────
  const badges = (p.badge_tags || []).map(t =>
    `<span style="background:#dc2626;color:#fff;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;margin-right:6px">${escHtml(t)}</span>`
  ).join("");

  // ─── Features list (จุดเด่น) ───────────────────────────────
  const features = Array.isArray(p.features) ? p.features : [];
  const featuresHtml = features.length > 0
    ? `<div style="margin-top:14px">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px">✨ จุดเด่น</div>
        <div>${features.map(f => `<span class="pdm-feature-pill">${escHtml(f)}</span>`).join("")}</div>
       </div>`
    : "";

  // ─── Spec table — show only fields that exist ─────────────
  const specRows = [
    _specRow("BTU/ชั่วโมง", p.btu ? Number(p.btu).toLocaleString() : "", "BTU"),
    _specRow("SEER (ประสิทธิภาพ)", p.seer),
    _specRow("EER", p.eer),
    _specRow("น้ำยาแอร์", p.refrigerant),
    _specRow("แรงดันไฟ", p.voltage),
    _specRow("กระแสไฟฟ้า", p.current_a, "A"),
    _specRow("กำลังไฟฟ้า", p.power_w, "W"),
    _specRow("ขนาดตัวใน (กว้าง×สูง×ลึก)", p.indoor_dim, "mm"),
    _specRow("ขนาดตัวนอก (กว้าง×สูง×ลึก)", p.outdoor_dim, "mm"),
    _specRow("น้ำหนักตัวใน", p.indoor_weight_kg, "kg"),
    _specRow("น้ำหนักตัวนอก", p.outdoor_weight_kg, "kg"),
    _specRow("เสียงตัวใน", p.noise_indoor_db, "dB"),
    _specRow("เสียงตัวนอก", p.noise_outdoor_db, "dB"),
    _specRow("สี", p.color)
  ].filter(Boolean).join("");

  const noSpecYet = !specRows;

  // ─── Description ─────────────────────────────────────────
  const descHtml = p.description
    ? `<div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-radius:10px;font-size:13px;color:#334155;line-height:1.7">${escHtml(p.description)}</div>`
    : "";

  // ─── Warranty box ────────────────────────────────────────
  const warrantyHtml = (p.w_install || p.w_parts || p.w_comp)
    ? `<div style="margin-top:14px;padding:12px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px">
        <div style="font-size:13px;font-weight:700;color:#78350f;margin-bottom:4px">🛡️ การรับประกัน</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#92400e">
          ${p.w_install ? `<span>👷 ติดตั้ง <b>${escHtml(p.w_install)}</b></span>` : ''}
          ${p.w_parts ? `<span>🔧 อะไหล่ <b>${escHtml(p.w_parts)}</b></span>` : ''}
          ${p.w_comp ? `<span>⚙️ คอมเพรสเซอร์ <b>${escHtml(p.w_comp)}</b></span>` : ''}
        </div>
       </div>`
    : "";

  // ─── CTA buttons ─────────────────────────────────────────
  const stockNum = Number(p.stock || 0);
  // Phase 347: reserveOnly = โหมดจอง/สอบถาม (สำหรับแคตตาล็อกแอร์หน้าร้าน — ไม่เกี่ยวตะกร้า/สต็อกจริง)
  const ctaLabel = inCart ? `✓ ในตะกร้า (${inCartQty})`
    : reserveOnly ? (ctaLabelOpt || "📅 สั่งจอง")
    : (stockNum > 0 ? "🛒 เพิ่มลงตะกร้า" : "📞 สั่งจอง");
  const ctaBg = inCart ? "#10b981" : (reserveOnly ? "#0284c7" : (stockNum > 0 ? "#0284c7" : "#f59e0b"));

  // ═══ Build modal HTML ═══════════════════════════════════
  const overlay = document.createElement("div");
  overlay.id = "pdm-overlay";
  overlay.className = "pdm-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px";
  overlay.innerHTML = `
    <div class="pdm-modal" role="dialog" aria-label="รายละเอียดสินค้า" style="background:#fff;border-radius:20px;max-width:680px;max-height:92vh;width:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.3)">

      <!-- Image header -->
      <div style="position:relative">
        ${heroImg}
        <button class="pdm-close-btn" id="pdmCloseBtn" aria-label="ปิด" style="position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;border:none;background:#fff;font-size:18px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center;color:#64748b">✕</button>
        ${badges ? `<div style="position:absolute;top:12px;left:12px">${badges}</div>` : ''}
        ${p.btu ? `<div style="position:absolute;bottom:12px;right:12px;background:rgba(2,132,199,.95);color:#fff;font-size:13px;font-weight:800;padding:6px 14px;border-radius:99px">${Number(p.btu).toLocaleString()} BTU</div>` : ''}
      </div>

      <!-- Scrollable body -->
      <div style="overflow-y:auto;padding:18px 20px;flex:1">

        <!-- Title -->
        <div style="font-size:12px;color:#0284c7;font-weight:700;letter-spacing:.5px">${escHtml(p.section || '').toUpperCase()}</div>
        <h2 style="font-size:24px;font-weight:900;color:#0f172a;margin:4px 0 6px">${escHtml(p.model || p.name || 'สินค้า')}</h2>

        <!-- Price -->
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px">
          <div style="font-size:28px;font-weight:900;color:#0284c7">${money(p.price || 0)}</div>
          <div style="font-size:12px;color:#10b981;font-weight:700">รวมติดตั้ง</div>
        </div>

        ${descHtml}
        ${warrantyHtml}
        ${featuresHtml}

        <!-- Spec table -->
        <div style="margin-top:18px">
          <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px">📋 สเปกเครื่อง</div>
          ${noSpecYet
            ? `<div style="padding:14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:#94a3b8;font-size:13px">
                ⚠️ ยังไม่มีข้อมูลสเปกของรุ่นนี้<br>
                <span style="font-size:11px">ติดต่อร้านเพื่อสอบถามรายละเอียดเพิ่มเติม</span>
               </div>`
            : `<div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">${specRows}</div>`
          }
        </div>

      </div>

      <!-- Sticky footer with CTA -->
      <div style="padding:14px 20px;border-top:1px solid #e2e8f0;background:#fff;display:flex;gap:8px">
        <button id="pdmCloseBtn2" style="padding:12px 18px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer">ปิด</button>
        <button id="pdmCtaBtn" style="flex:1;padding:12px;border:none;border-radius:10px;background:${ctaBg};color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(2,132,199,.3)">${ctaLabel}</button>
      </div>

    </div>
  `;
  document.body.appendChild(overlay);

  // ═══ Event handlers ═══
  const close = () => overlay.remove();
  document.getElementById("pdmCloseBtn")?.addEventListener("click", close);
  document.getElementById("pdmCloseBtn2")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function escClose(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escClose); }
  });

  document.getElementById("pdmCtaBtn")?.addEventListener("click", () => {
    if (!reserveOnly && stockNum > 0 && onAddToCart) {
      onAddToCart(p);
    } else if (onReserve) {
      onReserve(p);
    }
    close();
  });
}
