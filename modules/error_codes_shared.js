// ═══════════════════════════════════════════════════════════
//  ERROR CODE EXPLORER — shared renderer used by
//  error_codes.js (แอร์), error_codes_fridge.js (ตู้เย็น),
//  error_codes_washer.js (เครื่องซักผ้า)
// ═══════════════════════════════════════════════════════════

import { escHtml } from "./utils.js";

/**
 * Render a browsable Error Code page.
 * @param {object} cfg
 * @param {string} cfg.containerId   id of the <section> to render into
 * @param {object} cfg.db            { BrandName: { CODE: {desc, cause, fix} } }
 * @param {object} cfg.hero          { icon, title, subtitle, gradient, titleColor, subtitleColor }
 * @param {string} cfg.placeholder   search input placeholder
 * @param {object} cfg.tips          { title, html }  (html string for tips body)
 */
export function renderErrorExplorer(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  const db = cfg.db || {};
  const brands = Object.keys(db);
  const hero = cfg.hero || {};
  const tips = cfg.tips || {};

  container.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:24px 16px;margin-bottom:20px;background:${hero.gradient || "linear-gradient(135deg,#fee2e2,#fef3c7)"};border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">${hero.icon || "⚠️"}</div>
        <h2 style="margin:0 0 4px;color:${hero.titleColor || "#b91c1c"}">${escHtml(hero.title || "Error Code")}</h2>
        <p style="margin:0;color:${hero.subtitleColor || "#92400e"};font-size:14px">${escHtml(hero.subtitle || "ค้นหารหัสข้อผิดพลาดตามยี่ห้อ")}</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <select id="ecBrandSelect" style="flex:1;min-width:140px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;background:#fff">
          <option value="">— เลือกยี่ห้อ —</option>
          ${brands.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join("")}
        </select>
        <input id="ecSearchInput" type="text" placeholder="${escHtml(cfg.placeholder || "พิมพ์รหัส Error...")}" style="flex:2;min-width:160px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px" />
      </div>

      <div id="ecBrandBtns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        ${brands.map(b => `<button class="ec-brand-btn" data-brand="${escHtml(b)}" style="padding:6px 14px;border:2px solid #e5e7eb;border-radius:20px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s">${escHtml(b)}</button>`).join("")}
      </div>

      <div id="ecResults"></div>

      ${tips.html ? `
      <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0">
        <h3 style="margin:0 0 8px;color:#166534;font-size:15px">${escHtml(tips.title || "💡 เคล็ดลับ")}</h3>
        <div style="font-size:13px;color:#15803d;line-height:1.7">${tips.html}</div>
      </div>` : ""}
    </div>
  `;

  const brandSelect = container.querySelector("#ecBrandSelect");
  const searchInput = container.querySelector("#ecSearchInput");
  const brandBtns = container.querySelectorAll(".ec-brand-btn");
  const resultsDiv = container.querySelector("#ecResults");

  function renderResults() {
    const brand = brandSelect.value;
    const query = searchInput.value.trim().toUpperCase();

    if (!brand && !query) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#9ca3af"><div style="font-size:40px;margin-bottom:8px">🔍</div>เลือกยี่ห้อ หรือ พิมพ์รหัส Error เพื่อค้นหา</div>`;
      return;
    }

    let results = [];

    if (brand) {
      const codes = db[brand] || {};
      for (const [code, info] of Object.entries(codes)) {
        if (!query || code.toUpperCase().includes(query)) {
          results.push({ brand, code, ...info });
        }
      }
    } else {
      for (const [b, codes] of Object.entries(db)) {
        for (const [code, info] of Object.entries(codes)) {
          if (code.toUpperCase().includes(query)) {
            results.push({ brand: b, code, ...info });
          }
        }
      }
    }

    if (results.length === 0) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#9ca3af"><div style="font-size:40px;margin-bottom:8px">😕</div>ไม่พบรหัส "${escHtml(query)}" ${brand ? "ในยี่ห้อ " + escHtml(brand) : ""}<br><small>ลองค้นหาด้วยรหัสอื่น หรือ ติดต่อช่างโดยตรง</small></div>`;
      return;
    }

    resultsDiv.innerHTML = `
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px">พบ ${results.length} รายการ</div>
      ${results.map(r => `
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-bottom:10px;background:#fff;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <span style="background:#ef4444;color:#fff;padding:4px 12px;border-radius:8px;font-weight:700;font-size:15px;font-family:monospace">${escHtml(r.code)}</span>
            <span style="background:#f3f4f6;padding:3px 10px;border-radius:6px;font-size:12px;color:#4b5563;font-weight:600">${escHtml(r.brand)}</span>
          </div>
          <div style="font-weight:600;color:#1f2937;margin-bottom:6px;font-size:14px">${escHtml(r.desc)}</div>
          <div style="display:grid;gap:4px;font-size:13px;color:#4b5563">
            <div><span style="color:#dc2626;font-weight:600">สาเหตุ:</span> ${escHtml(r.cause)}</div>
            <div><span style="color:#059669;font-weight:600">วิธีแก้:</span> ${escHtml(r.fix)}</div>
          </div>
        </div>
      `).join("")}
    `;
  }

  brandSelect.addEventListener("change", () => {
    brandBtns.forEach(b => {
      b.style.borderColor = b.dataset.brand === brandSelect.value ? "#3b82f6" : "#e5e7eb";
      b.style.background = b.dataset.brand === brandSelect.value ? "#eff6ff" : "#fff";
    });
    renderResults();
  });

  searchInput.addEventListener("input", renderResults);

  brandBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      brandSelect.value = btn.dataset.brand;
      brandBtns.forEach(b => {
        b.style.borderColor = b === btn ? "#3b82f6" : "#e5e7eb";
        b.style.background = b === btn ? "#eff6ff" : "#fff";
      });
      renderResults();
    });
  });

  renderResults();
}
