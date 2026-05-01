// ═══════════════════════════════════════════════════════════
//  QUOTE TEMPLATES (Phase 16)
//  เก็บ template ใบเสนอราคาที่ใช้บ่อย → load ทีเดียว
// ═══════════════════════════════════════════════════════════

import { escHtml } from "./utils.js";
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

let _qtList = [];

export async function renderQuoteTemplatesPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-quote_templates");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8">กำลังโหลด...</div>`;

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;

  try {
    const res = await fetch(cfg.url + "/rest/v1/quote_templates?select=*&order=is_active.desc,name.asc", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) {
      container.innerHTML = `
        <div style="max-width:800px;margin:40px auto;padding:24px;background:#fee2e2;border-radius:12px;text-align:center">
          <h3 style="color:#b91c1c">⚠️ ตาราง quote_templates ยังไม่มี</h3>
          <p style="color:#991b1b">รัน <code>supabase-rls-policies.sql</code> ก่อน</p>
        </div>`;
      return;
    }
    _qtList = await res.json();
  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626;text-align:center;padding:30px">โหลดไม่สำเร็จ: ${e.message}</div>`;
    return;
  }

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📑</div>
        <h2 style="margin:0 0 4px;color:#1e40af">Template ใบเสนอราคา</h2>
        <p style="margin:0;color:#92400e;font-size:13px">เก็บใบเสนอราคาที่ใช้บ่อย → สร้างใบใหม่ได้ใน 1 click</p>
      </div>

      <!-- Help -->
      <div class="panel" style="padding:14px;margin-bottom:14px;background:#f0f9ff;border:1px solid #bae6fd">
        <div style="font-size:13px;color:#075985;line-height:1.6">
          💡 <b>วิธีใช้:</b><br>
          1. ในหน้า "ใบเสนอราคา" → สร้างใบใหม่ที่ใช้บ่อย → กดปุ่ม "💾 บันทึกเป็น Template"<br>
          2. หรือเพิ่มจากหน้านี้ → กรอก items + เงื่อนไข<br>
          3. ครั้งหน้า → กดปุ่ม "📑 โหลดจาก Template" ในใบเสนอราคา → เลือก template → ใส่ลูกค้า → เสร็จ
        </div>
      </div>

      <!-- Add new + List -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:14px;font-weight:600">${_qtList.length} Template</div>
        <button id="qtAddBtn" class="btn primary" style="font-size:13px">+ สร้าง Template ใหม่</button>
      </div>

      <div class="panel" style="padding:14px">
        ${_qtList.length === 0 ? `
          <div style="text-align:center;padding:40px;color:#94a3b8">
            <div style="font-size:40px;margin-bottom:8px">📝</div>
            <div style="font-weight:600;font-size:14px">ยังไม่มี Template</div>
            <div style="font-size:12px;margin-top:6px">ตัวอย่าง: "แอร์ Daikin 18000BTU + ติดตั้ง", "ติดตั้ง Solar 5kW On-grid"</div>
          </div>
        ` : `
        <div style="display:grid;gap:10px">
          ${_qtList.map(t => {
            const items = Array.isArray(t.items_json) ? t.items_json : [];
            const total = items.reduce((s, it) => s + Number(it.line_total || it.qty * it.unit_price || 0), 0);
            return `
              <div style="border:1px solid ${t.is_active?'#0284c7':'#e5e7eb'};border-radius:10px;padding:12px;background:${t.is_active?'#f0f9ff':'#f8fafc'}">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:8px">
                  <div style="flex:1">
                    <div style="font-weight:700;font-size:15px;color:#0c4a6e">${escHtml(t.name)}</div>
                    ${t.description ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${escHtml(t.description)}</div>` : ''}
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:11px;color:#64748b">${items.length} รายการ</div>
                    <div style="font-weight:700;color:#0284c7;font-size:14px">฿${money(total)}</div>
                  </div>
                </div>
                ${items.length > 0 ? `
                  <div style="background:#fff;border-radius:6px;padding:8px;font-size:12px;color:#475569;max-height:120px;overflow-y:auto">
                    ${items.slice(0, 5).map(it => `<div>• ${escHtml(it.name)} × ${it.qty} @ ฿${money(it.unit_price)}</div>`).join("")}
                    ${items.length > 5 ? `<div style="color:#94a3b8">+ อีก ${items.length - 5} รายการ</div>` : ''}
                  </div>
                ` : ''}
                ${t.warranty || t.conditions ? `
                  <div style="font-size:11px;color:#64748b;margin-top:6px">
                    ${t.warranty ? `<div>🛡️ ${escHtml(t.warranty)}</div>` : ''}
                    ${t.conditions ? `<div>📋 ${escHtml(t.conditions)}</div>` : ''}
                  </div>
                ` : ''}
                <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
                  <button class="qt-use-btn" data-id="${t.id}" style="border:none;background:#0284c7;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">📑 ใช้สร้างใบใหม่</button>
                  <button class="qt-edit-btn" data-id="${t.id}" style="border:1px solid #cbd5e1;background:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">✏️ แก้ไข</button>
                  <button class="qt-toggle-btn" data-id="${t.id}" style="border:1px solid #cbd5e1;background:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px" title="${t.is_active?'ปิด':'เปิด'}">${t.is_active?'⏸️':'▶️'}</button>
                  <button class="qt-del-btn" data-id="${t.id}" style="border:1px solid #fca5a5;background:#fff;color:#dc2626;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">🗑️</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
        `}
      </div>
    </div>
  `;

  container.querySelector("#qtAddBtn")?.addEventListener("click", () => openTemplateEditor(ctx, null));
  container.querySelectorAll(".qt-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const t = _qtList.find(x => String(x.id) === String(btn.dataset.id));
    if (t) openTemplateEditor(ctx, t);
  }));
  container.querySelectorAll(".qt-del-btn").forEach(btn => btn.addEventListener("click", () => deleteTemplate(ctx, btn.dataset.id)));
  container.querySelectorAll(".qt-toggle-btn").forEach(btn => btn.addEventListener("click", () => toggleActive(ctx, btn.dataset.id)));
  container.querySelectorAll(".qt-use-btn").forEach(btn => btn.addEventListener("click", () => useTemplate(ctx, btn.dataset.id)));
}

function openTemplateEditor(ctx, t) {
  const { state } = ctx;
  document.getElementById("qtModal")?.remove();
  const isEdit = !!t;
  let _items = Array.isArray(t?.items_json) ? [...t.items_json] : [];

  const modal = document.createElement("div");
  modal.id = "qtModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:92vh;overflow-y:auto;padding:20px">
      <h3 style="margin:0 0 14px">${isEdit?'✏️ แก้ไข':'+ สร้าง'} Template</h3>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:700">ชื่อ Template:</label>
          <input id="qtName" type="text" value="${escHtml(t?.name || '')}" placeholder="เช่น แอร์ Daikin 18000 + ติดตั้ง" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">คำอธิบาย:</label>
          <input id="qtDesc" type="text" value="${escHtml(t?.description || '')}" placeholder="คำอธิบายสั้นๆ" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>

        <!-- Items -->
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;background:#f8fafc">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700">รายการสินค้า/บริการ</div>
            <button type="button" id="qtAddItemBtn" style="border:none;background:#0284c7;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px">+ เพิ่ม</button>
          </div>
          <div id="qtItemsList" style="display:grid;gap:6px"></div>
          <div style="text-align:right;margin-top:8px;font-weight:700;color:#0284c7" id="qtTotalDisplay">รวม: ฿0.00</div>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700">รับประกัน:</label>
          <input id="qtWarranty" type="text" value="${escHtml(t?.warranty || '')}" placeholder="เช่น คอมเพรสเซอร์ 5 ปี อะไหล่ 2 ปี" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">เงื่อนไขเพิ่มเติม:</label>
          <textarea id="qtConditions" rows="2" placeholder="เช่น ราคารวมค่าติดตั้งไม่เกิน 4 เมตร" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-family:inherit;resize:vertical">${escHtml(t?.conditions || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="qtCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="qtSave" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">${isEdit?'💾 บันทึก':'+ สร้าง'}</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  const itemsListEl = modal.querySelector("#qtItemsList");
  const totalEl = modal.querySelector("#qtTotalDisplay");

  function renderItems() {
    if (_items.length === 0) {
      itemsListEl.innerHTML = `<div style="text-align:center;padding:14px;color:#94a3b8;font-size:12px">ยังไม่มีรายการ — กด "+ เพิ่ม"</div>`;
      totalEl.textContent = "รวม: ฿0.00";
      return;
    }
    itemsListEl.innerHTML = _items.map((it, idx) => `
      <div style="display:grid;grid-template-columns:1fr 70px 100px auto;gap:6px;align-items:center;background:#fff;padding:6px;border-radius:6px">
        <input class="qt-item-name" data-idx="${idx}" type="text" value="${escHtml(it.name || '')}" placeholder="ชื่อรายการ" style="padding:6px 8px;border:1px solid #e5e7eb;border-radius:4px;font-size:12px" />
        <input class="qt-item-qty" data-idx="${idx}" type="number" min="1" step="1" value="${it.qty || 1}" placeholder="qty" style="padding:6px;border:1px solid #e5e7eb;border-radius:4px;text-align:center;font-size:12px" />
        <input class="qt-item-price" data-idx="${idx}" type="number" min="0" step="0.01" value="${it.unit_price || 0}" placeholder="ราคา" style="padding:6px;border:1px solid #e5e7eb;border-radius:4px;text-align:right;font-size:12px" />
        <button class="qt-item-del" data-idx="${idx}" style="border:none;background:transparent;cursor:pointer;color:#dc2626;font-size:16px;padding:0 4px">×</button>
      </div>
    `).join("");

    const total = _items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit_price||0)), 0);
    totalEl.textContent = `รวม: ฿${money(total)}`;

    itemsListEl.querySelectorAll(".qt-item-name").forEach(inp => inp.addEventListener("input", () => { _items[Number(inp.dataset.idx)].name = inp.value; }));
    itemsListEl.querySelectorAll(".qt-item-qty").forEach(inp => inp.addEventListener("input", () => { _items[Number(inp.dataset.idx)].qty = Number(inp.value || 0); renderItems(); }));
    itemsListEl.querySelectorAll(".qt-item-price").forEach(inp => inp.addEventListener("input", () => { _items[Number(inp.dataset.idx)].unit_price = Number(inp.value || 0); renderItems(); }));
    itemsListEl.querySelectorAll(".qt-item-del").forEach(btn => btn.addEventListener("click", () => { _items.splice(Number(btn.dataset.idx), 1); renderItems(); }));
  }
  renderItems();

  modal.querySelector("#qtAddItemBtn").addEventListener("click", () => {
    _items.push({ name: "", qty: 1, unit_price: 0 });
    renderItems();
  });

  modal.querySelector("#qtCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#qtSave").addEventListener("click", async () => {
    const name = modal.querySelector("#qtName").value.trim();
    if (!name) { window.App?.showToast?.("กรอกชื่อ", "warn"); return; }

    const cleanItems = _items.filter(it => it.name && it.qty > 0).map(it => ({
      name: it.name,
      qty: Number(it.qty),
      unit_price: Number(it.unit_price || 0),
      line_total: Number(it.qty) * Number(it.unit_price || 0)
    }));

    const payload = {
      name,
      description: modal.querySelector("#qtDesc").value.trim() || null,
      items_json: cleanItems,
      warranty: modal.querySelector("#qtWarranty").value.trim() || null,
      conditions: modal.querySelector("#qtConditions").value.trim() || null,
      is_active: t?.is_active ?? true
    };

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const url = cfg.url + "/rest/v1/quote_templates" + (t ? "?id=eq."+t.id : "");
    try {
      const r = await fetch(url, {
        method: t ? "PATCH" : "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      modal.remove();
      ctx.showToast?.(t ? "✓ บันทึกแก้ไข" : "✓ สร้าง template");
      renderQuoteTemplatesPage(ctx);
    } catch (e) { window.App?.showToast?.("ผิดพลาด: " + (e?.message || e), "error"); }
  });
}

async function toggleActive(ctx, id) {
  const t = _qtList.find(x => String(x.id) === String(id));
  if (!t) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/quote_templates?id=eq." + id, {
    method: "PATCH",
    headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
    body: JSON.stringify({ is_active: !t.is_active })
  });
  renderQuoteTemplatesPage(ctx);
}

async function deleteTemplate(ctx, id) {
  const t = _qtList.find(x => String(x.id) === String(id));
  if (!t) return;
  if (!(await window.App?.confirm?.(`ลบ template "${t.name}"?`))) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/quote_templates?id=eq." + id, {
    method: "DELETE",
    headers: { "apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" }
  });
  ctx.showToast?.("ลบแล้ว");
  renderQuoteTemplatesPage(ctx);
}

function useTemplate(ctx, id) {
  const t = _qtList.find(x => String(x.id) === String(id));
  if (!t) return;
  // เก็บ template ใน localStorage → quotations module อ่าน
  try { localStorage.setItem("bsk_quote_template_pending", JSON.stringify(t)); } catch(e){}
  ctx.showToast?.(`📑 โหลด template "${t.name}" → กำลังพาไปสร้างใบเสนอราคา`);
  if (window.App?.showRoute) window.App.showRoute("quotations");
}
