import { escHtml } from "./utils.js";

export function renderSettingsAcCatalog(el, ctx, goBack, navigate) {
  let catalog = [];
  try { catalog = JSON.parse(localStorage.getItem("bsk_ac_catalog") || "[]"); } catch(e){}
  const sections = [...new Set(catalog.map(c => c.section))];

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">🌬️ จัดการแคตตาล็อกแอร์</h3>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
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

      <!-- CSV Import -->
      <div class="set-form-card" style="border:2px dashed #0284c7;background:#f0f9ff">
        <div style="text-align:center;padding:16px">
          <div style="font-size:36px;margin-bottom:8px">📄</div>
          <div style="font-size:15px;font-weight:700;color:#0284c7;margin-bottom:4px">นำเข้า CSV แคตตาล็อกแอร์</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:12px">รูปแบบ: section, model, btu, price_install, w_install, w_parts, w_comp, stock_qty</div>
          <input type="file" id="acCatalogFileInput" accept=".csv" style="display:none" />
          <button id="acCatalogImportBtn" class="btn primary" style="padding:10px 24px;font-size:14px">📂 เลือกไฟล์ CSV</button>
          <div id="acCatalogImportStatus" style="margin-top:8px;font-size:13px;color:#64748b"></div>
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
              ${items.map(c => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
                  <div>
                    <span style="font-weight:700">${escHtml(c.model)}</span>
                    <span style="color:#64748b;margin-left:6px">❄️ ${Number(c.btu||0).toLocaleString()} BTU</span>
                  </div>
                  <div style="text-align:right">
                    <span style="font-weight:700;color:#0284c7">฿${Number(c.price||0).toLocaleString()}</span>
                    <span style="color:${(c.stock||0) > 0 ? '#10b981' : '#ef4444'};margin-left:6px">${(c.stock||0) > 0 ? '✅' + c.stock : '—'}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </details>`;
        }).join("") : '<div style="text-align:center;padding:24px;color:#94a3b8">ยังไม่มีข้อมูลแคตตาล็อก — กรุณานำเข้า CSV</div>'}
      </div>

      <!-- Actions -->
      <div style="display:grid;gap:8px;margin-top:16px">
        <button id="acCatalogRefreshBtn" class="btn" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;padding:10px">🔄 โหลดแคตตาล็อกจาก JSON ไฟล์</button>
        ${catalog.length > 0 ? `<button id="acCatalogClearBtn" class="btn" style="background:#fef2f2;color:#ef4444;border:1px solid #fca5a5;padding:10px">🗑️ ล้างแคตตาล็อกทั้งหมด</button>` : ''}
      </div>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ★ CSV Import
  document.getElementById("acCatalogImportBtn")?.addEventListener("click", () => {
    document.getElementById("acCatalogFileInput")?.click();
  });

  document.getElementById("acCatalogFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById("acCatalogImportStatus");
    if (statusEl) statusEl.textContent = "กำลังอ่านไฟล์...";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error("ไฟล์ว่างหรือไม่มีข้อมูล");

        // ★ ตรวจ header
        const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ""));
        const sectionIdx = header.findIndex(h => h === "section" || h === "ยี่ห้อ");
        const modelIdx   = header.findIndex(h => h === "model" || h === "รุ่น");
        const btuIdx     = header.findIndex(h => h === "btu");
        const priceIdx   = header.findIndex(h => h.includes("price") || h === "ราคา" || h === "price_install");
        const wInstIdx   = header.findIndex(h => h === "w_install" || h.includes("ประกันติดตั้ง"));
        const wPartsIdx  = header.findIndex(h => h === "w_parts" || h.includes("ประกันอะไหล่"));
        const wCompIdx   = header.findIndex(h => h === "w_comp" || h.includes("ประกันคอม"));
        const stockIdx   = header.findIndex(h => h.includes("stock") || h === "จำนวน" || h === "stock_qty");

        if (sectionIdx < 0 || modelIdx < 0) throw new Error("ไม่พบคอลัมน์ section และ model ใน header");

        const newCatalog = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map(c => c.trim());
          if (!cols[sectionIdx] || !cols[modelIdx]) continue;
          newCatalog.push({
            id: i,
            section: cols[sectionIdx] || "",
            model: cols[modelIdx] || "",
            btu: Number(cols[btuIdx] || 0),
            price: Number((cols[priceIdx] || "0").replace(/[^0-9.]/g, "")),
            w_install: cols[wInstIdx] || "",
            w_parts: cols[wPartsIdx] || "",
            w_comp: cols[wCompIdx] || "",
            stock: Number(cols[stockIdx] || 0)
          });
        }

        if (newCatalog.length === 0) throw new Error("ไม่พบข้อมูลสินค้าในไฟล์");

        localStorage.setItem("bsk_ac_catalog", JSON.stringify(newCatalog));
        if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;font-weight:700">✅ นำเข้าสำเร็จ! ' + newCatalog.length + ' รุ่น จาก ' + [...new Set(newCatalog.map(c=>c.section))].length + ' แบรนด์</span>';
        if (ctx?.showToast) ctx.showToast("นำเข้าแคตตาล็อกแอร์ " + newCatalog.length + " รุ่น สำเร็จ! ✅");

        // Re-render page to show new data
        setTimeout(() => renderAcCatalogPage(el), 800);
      } catch (err) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444">❌ ' + escHtml(err.message) + '</span>';
      }
    };
    reader.readAsText(file, "utf-8");
  });

  // ★ Refresh from JSON file
  document.getElementById("acCatalogRefreshBtn")?.addEventListener("click", async () => {
    try {
      const resp = await fetch("data/ac_catalog.json");
      if (!resp.ok) throw new Error("ไม่พบไฟล์ ac_catalog.json");
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error("ไฟล์ว่าง");
      localStorage.setItem("bsk_ac_catalog", JSON.stringify(data));
      if (ctx?.showToast) ctx.showToast("โหลดแคตตาล็อก " + data.length + " รุ่น สำเร็จ! ✅");
      renderAcCatalogPage(el);
    } catch(err) {
      if (ctx?.showToast) ctx.showToast("❌ " + err.message, "error");
    }
  });

  // ★ Clear catalog
  document.getElementById("acCatalogClearBtn")?.addEventListener("click", () => {
    if (!confirm("ล้างแคตตาล็อกแอร์ทั้งหมด? ข้อมูลจะถูกลบออกจากหน้าลูกค้า")) return;
    localStorage.removeItem("bsk_ac_catalog");
    if (ctx?.showToast) ctx.showToast("ล้างแคตตาล็อกแล้ว");
    renderAcCatalogPage(el);
  });
}


