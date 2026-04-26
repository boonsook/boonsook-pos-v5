// ═══════════════════════════════════════════════════════════
//  REFUND / RETURN TRACKER (Phase 12)
//  บันทึกการคืนสินค้า + คืนเงิน + คืนสต็อก (option)
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function moneyShort(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
}

let _rfList = [];
let _rfFilter = "all"; // all | 30d | 90d

const REFUND_METHODS = {
  cash: { label: "เงินสด", icon: "💵", color: "#059669" },
  transfer: { label: "โอนคืน", icon: "💸", color: "#0284c7" },
  credit: { label: "เครดิตในบัญชี", icon: "💳", color: "#7c3aed" },
  exchange: { label: "เปลี่ยนสินค้า", icon: "🔄", color: "#f59e0b" }
};

const REASON_PRESETS = ["สินค้าชำรุด/เสีย", "เคลมประกัน", "ลูกค้าไม่พอใจ", "สั่งผิดรุ่น", "ส่งผิด", "อื่นๆ"];

export async function renderRefundsPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-refunds");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8">กำลังโหลด...</div>`;

  // Load refunds from DB
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  let cutoff = "";
  if (_rfFilter === "30d") { const d = new Date(); d.setDate(d.getDate()-30); cutoff = `&created_at=gte.${d.toISOString()}`; }
  else if (_rfFilter === "90d") { const d = new Date(); d.setDate(d.getDate()-90); cutoff = `&created_at=gte.${d.toISOString()}`; }

  try {
    const res = await fetch(cfg.url + "/rest/v1/refunds?select=*" + cutoff + "&order=created_at.desc&limit=200", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) {
      container.innerHTML = `
        <div style="max-width:800px;margin:40px auto;padding:24px;background:#fee2e2;border-radius:12px;text-align:center">
          <h3 style="color:#b91c1c">⚠️ ตาราง refunds ยังไม่มีในฐานข้อมูล</h3>
          <p style="color:#991b1b">รัน <code>supabase-rls-policies.sql</code> ใน Supabase SQL Editor เพื่อสร้างตารางก่อน</p>
        </div>`;
      return;
    }
    _rfList = await res.json();
  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626;text-align:center;padding:30px">โหลดไม่สำเร็จ: ${e.message}</div>`;
    return;
  }

  const total = _rfList.length;
  const totalAmount = _rfList.reduce((s, r) => s + Number(r.refund_amount || 0), 0);
  const restockedCount = _rfList.filter(r => r.restocked).length;

  // Top refund reasons
  const reasonCount = {};
  _rfList.forEach(r => {
    const reason = r.reason || "ไม่ระบุ";
    reasonCount[reason] = (reasonCount[reason] || 0) + 1;
  });
  const topReasons = Object.entries(reasonCount).sort((a,b) => b[1]-a[1]).slice(0, 5);

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fef3c7,#fee2e2);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🔄</div>
        <h2 style="margin:0 0 4px;color:#b91c1c">รับคืนสินค้า (Refund Tracker)</h2>
        <p style="margin:0;color:#92400e;font-size:13px">บันทึกการคืน • คืนเงิน • เปลี่ยนสินค้า • คืนสต็อก</p>
      </div>

      <!-- Filters -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px">📅 ช่วง:</span>
        ${[["30d","30 วัน"],["90d","90 วัน"],["all","ทั้งหมด"]].map(([k,l]) => `
          <button class="rf-filter-btn" data-f="${k}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_rfFilter===k?'#dc2626':'#cbd5e1'};background:${_rfFilter===k?'#dc2626':'#fff'};color:${_rfFilter===k?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${l}</button>
        `).join("")}
        <button id="rfNewBtn" class="btn primary" style="margin-left:auto;font-size:13px">+ บันทึกการคืนสินค้า</button>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #dc2626">
          <div class="stat-label">📋 จำนวนการคืน</div>
          <div class="stat-value" style="color:#dc2626">${total}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">💸 มูลค่าคืน</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">฿${moneyShort(totalAmount)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">📦 คืนสต็อกสำเร็จ</div>
          <div class="stat-value" style="color:#059669">${restockedCount}/${total}</div>
        </div>
      </div>

      ${topReasons.length > 0 ? `
        <div class="panel" style="padding:14px;margin-bottom:14px">
          <h3 style="margin:0 0 10px;font-size:14px">🔝 เหตุผลที่ลูกค้าคืนสินค้ามากที่สุด</h3>
          <div style="display:grid;gap:6px">
            ${topReasons.map(([r, n]) => {
              const pct = total > 0 ? (n/total*100).toFixed(0) : 0;
              return `
                <div style="display:flex;align-items:center;gap:10px;font-size:13px">
                  <div style="flex:1">${escHtml(r)}</div>
                  <div style="width:200px;background:#e2e8f0;height:18px;border-radius:9px;overflow:hidden;position:relative">
                    <div style="background:linear-gradient(90deg,#dc2626,#f59e0b);width:${pct}%;height:100%"></div>
                    <span style="position:absolute;left:8px;top:0;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-shadow:0 1px 2px rgba(0,0,0,.3)">${n} (${pct}%)</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ''}

      <!-- List -->
      <div class="panel" style="padding:0">
        ${_rfList.length === 0 ? `
          <div style="text-align:center;padding:40px;color:#94a3b8">
            <div style="font-size:40px;margin-bottom:8px">🎉</div>
            <div style="font-weight:600;font-size:14px">ยังไม่มีการคืนสินค้า — ดีมาก!</div>
            <div style="font-size:12px;margin-top:6px">กดปุ่ม "+ บันทึกการคืนสินค้า" เมื่อมีลูกค้าคืน</div>
          </div>
        ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:10px;text-align:left">เลขที่ / วันที่</th>
                <th style="padding:10px;text-align:left">ลูกค้า</th>
                <th style="padding:10px;text-align:left">เหตุผล</th>
                <th style="padding:10px;text-align:left">วิธีคืน</th>
                <th style="padding:10px;text-align:right">มูลค่า</th>
                <th style="padding:10px;text-align:center">สต็อก</th>
              </tr>
            </thead>
            <tbody>
              ${_rfList.map(r => {
                const m = REFUND_METHODS[r.refund_method] || REFUND_METHODS.cash;
                return `
                  <tr style="border-bottom:1px solid #e5e7eb">
                    <td style="padding:10px">
                      <div style="font-weight:700;color:#0284c7">${escHtml(r.refund_no || '#'+r.id)}</div>
                      <div style="font-size:11px;color:#64748b">${new Date(r.created_at).toLocaleDateString("th-TH")}</div>
                    </td>
                    <td style="padding:10px">${escHtml(r.customer_name || 'ลูกค้าทั่วไป')}</td>
                    <td style="padding:10px;font-size:12px;color:#475569">${escHtml(r.reason || '-')}</td>
                    <td style="padding:10px">
                      <span style="background:${m.color};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">${m.icon} ${m.label}</span>
                    </td>
                    <td style="padding:10px;text-align:right;font-weight:700;color:#dc2626">฿${money(r.refund_amount)}</td>
                    <td style="padding:10px;text-align:center">
                      ${r.restocked ? '<span style="color:#10b981;font-weight:700" title="คืนสต็อกแล้ว">✓ คืน</span>' : '<span style="color:#94a3b8" title="ไม่ได้คืนสต็อก">—</span>'}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        `}
      </div>
    </div>
  `;

  container.querySelectorAll(".rf-filter-btn").forEach(btn => btn.addEventListener("click", () => {
    _rfFilter = btn.dataset.f;
    renderRefundsPage(ctx);
  }));
  container.querySelector("#rfNewBtn")?.addEventListener("click", () => openRefundModal(ctx));
}

function openRefundModal(ctx) {
  const { state } = ctx;
  document.getElementById("rfModal")?.remove();

  const recentSales = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .slice(0, 50);

  let _selectedSale = null;
  let _refundItems = []; // [{product_id, name, qty, unit_price, restock}]

  const modal = document.createElement("div");
  modal.id = "rfModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;padding:20px">
      <h3 style="margin:0 0 12px;color:#dc2626">🔄 บันทึกการคืนสินค้า</h3>

      <!-- Step 1: Select sale -->
      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">1) เลือกบิลขายที่ลูกค้าจะคืน:</label>
        <input id="rfSaleSearch" type="text" placeholder="🔍 พิมพ์เลขบิล / ชื่อลูกค้า..." style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:6px" />
        <div id="rfSaleList" style="max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px"></div>
      </div>

      <!-- Step 2: Select items + amount -->
      <div id="rfItemsSection" style="margin-bottom:14px;display:none">
        <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">2) สินค้าที่คืน + จำนวน:</label>
        <div id="rfItemsList" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#f8fafc"></div>
      </div>

      <!-- Step 3: Reason + Method + Restock -->
      <div id="rfDetailsSection" style="margin-bottom:14px;display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:700">เหตุผล:</label>
            <select id="rfReasonSelect" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${REASON_PRESETS.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700">วิธีคืน:</label>
            <select id="rfMethodSelect" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${Object.entries(REFUND_METHODS).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px">
          <input id="rfRestockCb" type="checkbox" checked style="width:18px;height:18px;cursor:pointer" />
          <span>📦 คืนสต็อกเข้าคลัง (เพิ่มสต็อกคืน) — แนะนำเปิดถ้าสินค้ายังขายต่อได้</span>
        </label>
        <div id="rfRestockWh" style="margin-top:8px">
          <label style="font-size:12px;font-weight:700">คลังที่จะคืนสต็อก:</label>
          <select id="rfWhSelect" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
            ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}">${escHtml(w.name)}</option>`).join("")}
          </select>
        </div>
        <label style="font-size:12px;font-weight:700;display:block;margin-top:10px">หมายเหตุ:</label>
        <input id="rfNote" type="text" placeholder="หมายเหตุเพิ่มเติม" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
        <div style="margin-top:14px;padding:10px;background:#fee2e2;border-radius:8px;text-align:center">
          <div style="font-size:12px;color:#7f1d1d">มูลค่าคืนรวม:</div>
          <div id="rfTotalAmount" style="font-size:24px;font-weight:900;color:#b91c1c">฿0.00</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="rfCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="rfSave" disabled style="flex:1;padding:10px;border:none;background:#dc2626;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;opacity:.5">💾 บันทึกการคืน</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  const searchInp = modal.querySelector("#rfSaleSearch");
  const listEl = modal.querySelector("#rfSaleList");
  const itemsSection = modal.querySelector("#rfItemsSection");
  const itemsListEl = modal.querySelector("#rfItemsList");
  const detailsSection = modal.querySelector("#rfDetailsSection");
  const totalEl = modal.querySelector("#rfTotalAmount");
  const saveBtn = modal.querySelector("#rfSave");
  const restockCb = modal.querySelector("#rfRestockCb");
  const restockWh = modal.querySelector("#rfRestockWh");

  function renderSales(query = "") {
    const q = query.toLowerCase().trim();
    const filtered = q ? recentSales.filter(s =>
      String(s.order_no || "").toLowerCase().includes(q) ||
      String(s.customer_name || "").toLowerCase().includes(q)
    ) : recentSales;
    listEl.innerHTML = filtered.slice(0, 30).map(s => `
      <div class="rf-sale-pick" data-id="${s.id}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #e5e7eb" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background=''">
        <div style="font-weight:700">${escHtml(s.order_no || '#'+s.id)} — ฿${money(s.total_amount)}</div>
        <div style="font-size:11px;color:#64748b">${escHtml(s.customer_name || 'ลูกค้าทั่วไป')} • ${new Date(s.created_at).toLocaleDateString("th-TH")}</div>
      </div>
    `).join("") || `<div style="padding:14px;text-align:center;color:#94a3b8">ไม่พบบิล</div>`;

    listEl.querySelectorAll(".rf-sale-pick").forEach(item => item.addEventListener("click", () => {
      _selectedSale = recentSales.find(s => String(s.id) === String(item.dataset.id));
      const items = (state.saleItems || []).filter(it => String(it.sale_id) === String(_selectedSale.id));
      _refundItems = items.map(it => ({
        product_id: it.product_id || null,
        name: it.product_name || "",
        qty: 0, // user เลือกเอง — เริ่มที่ 0
        max_qty: Number(it.qty || 0),
        unit_price: Number(it.unit_price || 0),
        restock: true
      }));
      renderItems();
      itemsSection.style.display = "block";
      detailsSection.style.display = "block";
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    }));
  }
  renderSales();

  searchInp.addEventListener("input", (e) => renderSales(e.target.value));

  function renderItems() {
    itemsListEl.innerHTML = _refundItems.map((it, idx) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #e5e7eb">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">${escHtml(it.name)}</div>
          <div style="font-size:11px;color:#64748b">฿${money(it.unit_price)} × max ${it.max_qty}</div>
        </div>
        <input type="number" class="rf-item-qty" data-idx="${idx}" min="0" max="${it.max_qty}" step="1" value="${it.qty}" style="width:70px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-weight:700" />
        <div style="width:90px;text-align:right;font-weight:700;color:#dc2626">฿${money(it.qty * it.unit_price)}</div>
      </div>
    `).join("");
    const total = _refundItems.reduce((s, it) => s + it.qty * it.unit_price, 0);
    totalEl.textContent = "฿" + money(total);

    itemsListEl.querySelectorAll(".rf-item-qty").forEach(inp => inp.addEventListener("change", () => {
      const idx = Number(inp.dataset.idx);
      const v = Math.max(0, Math.min(_refundItems[idx].max_qty, parseInt(inp.value, 10) || 0));
      _refundItems[idx].qty = v;
      inp.value = v;
      renderItems();
    }));
  }

  restockCb.addEventListener("change", () => {
    restockWh.style.display = restockCb.checked ? "block" : "none";
  });

  modal.querySelector("#rfCancel").addEventListener("click", () => modal.remove());

  modal.querySelector("#rfSave").addEventListener("click", async () => {
    if (!_selectedSale) return;
    const itemsToRefund = _refundItems.filter(it => it.qty > 0);
    if (itemsToRefund.length === 0) { window.App?.showToast?.("เลือกสินค้าที่คืนอย่างน้อย 1 รายการ + จำนวน > 0", "warn"); return; }
    const totalAmount = itemsToRefund.reduce((s, it) => s + it.qty * it.unit_price, 0);
    const reason = modal.querySelector("#rfReasonSelect").value;
    const method = modal.querySelector("#rfMethodSelect").value;
    const restock = restockCb.checked;
    const whIdRaw = modal.querySelector("#rfWhSelect").value;
    const note = modal.querySelector("#rfNote").value.trim();

    const confirmMsg = `ยืนยันการคืน? บิล ${_selectedSale.order_no} • ${itemsToRefund.length} รายการ • ฿${money(totalAmount)} • ${REFUND_METHODS[method].label}${restock ? ' • คืนสต็อก' : ''}`;
    if (!(await window.App?.confirm?.(confirmMsg))) return;

    saveBtn.disabled = true; saveBtn.textContent = "กำลังบันทึก...";
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;

    try {
      const refundNo = "RF-" + Date.now();
      const payload = {
        refund_no: refundNo,
        sale_id: _selectedSale.id,
        customer_id: _selectedSale.customer_id || null,
        customer_name: _selectedSale.customer_name || null,
        reason,
        refund_method: method,
        refund_amount: totalAmount,
        items_json: itemsToRefund.map(it => ({ product_id: it.product_id, name: it.name, qty: it.qty, unit_price: it.unit_price })),
        restocked: restock,
        warehouse_id: restock ? Number(whIdRaw) : null,
        note: note || null
      };

      // 1) INSERT refund
      const r = await fetch(cfg.url + "/rest/v1/refunds", {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("บันทึก refund ไม่สำเร็จ");

      // 2) คืนสต็อกถ้าเลือก
      if (restock) {
        const whId = Number(whIdRaw);
        for (const it of itemsToRefund) {
          if (!it.product_id) continue;
          try {
            await window._appApplyStockMovement({
              productId: it.product_id,
              warehouseId: whId,
              movementType: "return",
              qty: it.qty,
              note: `คืน ${refundNo} — ${reason}`
            });
          } catch(e) { console.warn("[refund restock]", e); }
        }
      }

      modal.remove();
      ctx.showToast?.(`✓ บันทึกการคืน ${refundNo} • ฿${money(totalAmount)}`);
      if (window.App?.loadAllData) await window.App.loadAllData();
      renderRefundsPage(ctx);
    } catch (e) {
      window.App?.showToast?.("ผิดพลาด: " + (e?.message || e), "error");
      saveBtn.disabled = false; saveBtn.textContent = "💾 บันทึกการคืน";
    }
  });
}
