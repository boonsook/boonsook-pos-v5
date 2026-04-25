// ═══════════════════════════════════════════════════════════
//  PROFIT BY PRODUCT REPORT (Phase 14)
//  รายงานกำไรเชิงลึก — สินค้าไหนกำไรเยอะ/น้อย/ขาดทุน
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

let _ppPeriod = "month"; // 30d | month | year | all
let _ppSortBy = "profit"; // profit | margin | qty | revenue

export function renderProfitByProductPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-profit_by_product");
  if (!container) return;

  // Cutoff
  let cutoffKey = "";
  const today = new Date();
  if (_ppPeriod === "30d") { const d = new Date(); d.setDate(d.getDate()-30); cutoffKey = d.toISOString().slice(0,10); }
  else if (_ppPeriod === "month") { cutoffKey = today.toISOString().slice(0,7) + "-01"; }
  else if (_ppPeriod === "year") { cutoffKey = today.toISOString().slice(0,4) + "-01-01"; }

  const validSales = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => !cutoffKey || String(s.created_at || "").slice(0,10) >= cutoffKey);
  const validSaleIds = new Set(validSales.map(s => String(s.id)));

  // Aggregate per product
  const map = new Map();
  (state.saleItems || []).forEach(it => {
    if (!validSaleIds.has(String(it.sale_id))) return;
    if (!it.product_id) return;
    const pid = String(it.product_id);
    const qty = Number(it.qty || 0);
    const price = Number(it.unit_price || 0);
    const cost = Number(it.unit_cost || 0); // อาจเป็น 0 ถ้า legacy
    const revenue = qty * price;
    const totalCost = qty * cost;
    const profit = revenue - totalCost;

    if (!map.has(pid)) {
      const prod = (state.products || []).find(p => String(p.id) === pid);
      map.set(pid, {
        id: pid,
        name: prod?.name || it.product_name || "(ไม่พบสินค้า)",
        sku: prod?.sku || "",
        category: prod?.category || "ไม่ระบุ",
        currentCost: Number(prod?.cost || 0),
        qty: 0, revenue: 0, cost: 0, profit: 0
      });
    }
    const g = map.get(pid);
    g.qty += qty;
    g.revenue += revenue;
    g.cost += totalCost;
    g.profit += profit;
  });

  let list = [...map.values()].map(g => ({
    ...g,
    margin: g.revenue > 0 ? (g.profit / g.revenue * 100) : 0,
    avgPrice: g.qty > 0 ? g.revenue / g.qty : 0,
    avgCost: g.qty > 0 ? g.cost / g.qty : 0
  }));

  // Sort
  if (_ppSortBy === "profit") list.sort((a, b) => b.profit - a.profit);
  else if (_ppSortBy === "margin") list.sort((a, b) => b.margin - a.margin);
  else if (_ppSortBy === "qty") list.sort((a, b) => b.qty - a.qty);
  else if (_ppSortBy === "revenue") list.sort((a, b) => b.revenue - a.revenue);

  // Stats
  const totalRevenue = list.reduce((s, g) => s + g.revenue, 0);
  const totalCost = list.reduce((s, g) => s + g.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

  // Top 10 + Bottom 10
  const top10 = list.slice(0, 10);
  const bottom10 = [...list].sort((a, b) => a.margin - b.margin).slice(0, 10);
  const negProfitCount = list.filter(g => g.profit < 0).length;

  const periodLabel = { "30d":"30 วันล่าสุด","month":"เดือนนี้","year":"ปีนี้","all":"ทั้งหมด" }[_ppPeriod];

  container.innerHTML = `
    <div style="max-width:1400px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dcfce7,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📊</div>
        <h2 style="margin:0 0 4px;color:#065f46">กำไรต่อสินค้า (Profit by Product)</h2>
        <p style="margin:0;color:#1e40af;font-size:13px">รู้ว่าสินค้าไหนกำไรดี / กำไรน้อย / ขาดทุน — ตัดสินใจปรับราคา</p>
      </div>

      <!-- Filters -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px">📅 ช่วง:</span>
        ${["30d","month","year","all"].map(p => `
          <button class="pp-period-btn" data-p="${p}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_ppPeriod===p?'#0284c7':'#cbd5e1'};background:${_ppPeriod===p?'#0284c7':'#fff'};color:${_ppPeriod===p?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">
            ${({"30d":"30 วัน","month":"เดือนนี้","year":"ปีนี้","all":"ทั้งหมด"})[p]}
          </button>
        `).join("")}
        <span style="margin-left:10px;font-weight:600;font-size:13px">🔢 เรียงตาม:</span>
        ${[["profit","กำไร"],["margin","Margin %"],["qty","จำนวน"],["revenue","ยอดขาย"]].map(([k,l]) => `
          <button class="pp-sort-btn" data-s="${k}" style="padding:6px 12px;border-radius:18px;border:1px solid ${_ppSortBy===k?'#7c3aed':'#cbd5e1'};background:${_ppSortBy===k?'#7c3aed':'#fff'};color:${_ppSortBy===k?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${l}</button>
        `).join("")}
        <button id="ppExportBtn" class="btn light" style="margin-left:auto;font-size:13px">📥 Excel</button>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">💰 ยอดขายรวม</div>
          <div class="stat-value" style="color:#0284c7;font-size:22px">฿${moneyShort(totalRevenue)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">📤 ต้นทุนรวม</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">฿${moneyShort(totalCost)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid ${totalProfit >= 0 ? '#10b981' : '#dc2626'}">
          <div class="stat-label">📈 กำไรสุทธิ</div>
          <div class="stat-value" style="color:${totalProfit >= 0 ? '#059669' : '#dc2626'};font-size:22px">฿${moneyShort(totalProfit)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Margin ${overallMargin.toFixed(1)}%</div>
        </div>
        ${negProfitCount > 0 ? `
        <div class="stat-card" style="border-left:4px solid #dc2626">
          <div class="stat-label">⚠️ สินค้าขาดทุน</div>
          <div class="stat-value" style="color:#dc2626">${negProfitCount}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">ราคาขาย < ต้นทุน</div>
        </div>
        ` : ''}
      </div>

      <!-- Top + Bottom split -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:14px">
        <!-- Top 10 winners -->
        <div class="panel" style="padding:14px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#059669">🏆 Top 10 สินค้ากำไรเยอะที่สุด</h3>
          ${top10.length === 0 ? `<div style="color:#94a3b8;text-align:center;padding:20px">ยังไม่มีข้อมูล</div>` :
          top10.map((g, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed #e5e7eb">
              <span style="width:24px;height:24px;border-radius:50%;background:${i<3?'#fbbf24':'#f1f5f9'};color:${i<3?'#fff':'#64748b'};display:grid;place-items:center;font-size:11px;font-weight:700;flex-shrink:0">${i+1}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.name)}</div>
                <div style="font-size:11px;color:#64748b">${g.qty} ชิ้น • Margin ${g.margin.toFixed(1)}%</div>
              </div>
              <div style="font-weight:700;color:#059669;font-size:13px;text-align:right">฿${moneyShort(g.profit)}</div>
            </div>
          `).join("")}
        </div>
        <!-- Bottom 10 dogs -->
        <div class="panel" style="padding:14px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#dc2626">🐕 Bottom 10 สินค้ากำไรน้อย/ขาดทุน</h3>
          ${bottom10.length === 0 ? `<div style="color:#94a3b8;text-align:center;padding:20px">ยังไม่มีข้อมูล</div>` :
          bottom10.map((g, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed #e5e7eb">
              <span style="width:24px;height:24px;border-radius:50%;background:#fee2e2;color:#dc2626;display:grid;place-items:center;font-size:11px;font-weight:700;flex-shrink:0">${i+1}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.name)}</div>
                <div style="font-size:11px;color:#64748b">${g.qty} ชิ้น • Margin ${g.margin.toFixed(1)}%</div>
              </div>
              <div style="font-weight:700;color:${g.profit < 0 ? '#dc2626' : '#f59e0b'};font-size:13px;text-align:right">${g.profit < 0 ? '-' : ''}฿${moneyShort(Math.abs(g.profit))}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Full table -->
      <div class="panel" style="padding:14px">
        <h3 style="margin:0 0 10px;font-size:15px">📋 ทุกสินค้า (${list.length} รายการ — ${periodLabel})</h3>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:left">สินค้า</th>
                <th style="padding:8px;text-align:right">ขาย (ชิ้น)</th>
                <th style="padding:8px;text-align:right">ราคา/ชิ้น</th>
                <th style="padding:8px;text-align:right">ต้นทุน/ชิ้น</th>
                <th style="padding:8px;text-align:right">ยอดขาย</th>
                <th style="padding:8px;text-align:right">กำไร</th>
                <th style="padding:8px;text-align:right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              ${list.slice(0, 200).map(g => `
                <tr style="border-bottom:1px solid #e5e7eb;background:${g.profit < 0 ? '#fef2f2' : '#fff'}">
                  <td style="padding:8px">
                    <div style="font-weight:600">${escHtml(g.name)}</div>
                    <div style="font-size:10px;color:#94a3b8">${escHtml(g.sku || '')} • ${escHtml(g.category)}</div>
                  </td>
                  <td style="padding:8px;text-align:right">${g.qty}</td>
                  <td style="padding:8px;text-align:right">฿${money(g.avgPrice)}</td>
                  <td style="padding:8px;text-align:right">฿${money(g.avgCost)}${g.avgCost === 0 ? ' <span style="color:#dc2626" title="ไม่มี cost ใน sale_items">⚠️</span>' : ''}</td>
                  <td style="padding:8px;text-align:right;color:#0284c7;font-weight:600">฿${money(g.revenue)}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:${g.profit >= 0 ? '#059669' : '#dc2626'}">${g.profit < 0 ? '-' : ''}฿${money(Math.abs(g.profit))}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:${g.margin >= 30 ? '#059669' : g.margin >= 10 ? '#f59e0b' : '#dc2626'}">${g.margin.toFixed(1)}%</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          ${list.length > 200 ? `<div style="text-align:center;color:#64748b;font-size:11px;padding:10px">+ อีก ${list.length - 200} รายการ — ใช้ Excel ดูทั้งหมด</div>` : ''}
        </div>
        <div style="margin-top:10px;font-size:11px;color:#94a3b8">
          ⚠️ ต้นทุน 0 = บิลเก่าก่อนระบบเก็บ unit_cost (จาก v2 เป็นต้นมา) — บิลใหม่จะมีต้นทุนถูกต้อง
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll(".pp-period-btn").forEach(btn => btn.addEventListener("click", () => { _ppPeriod = btn.dataset.p; renderProfitByProductPage(ctx); }));
  container.querySelectorAll(".pp-sort-btn").forEach(btn => btn.addEventListener("click", () => { _ppSortBy = btn.dataset.s; renderProfitByProductPage(ctx); }));

  container.querySelector("#ppExportBtn")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") { showToast?.("XLSX ไม่พร้อม"); return; }
    const data = list.map(g => ({
      "ชื่อสินค้า": g.name,
      "SKU": g.sku,
      "หมวดหมู่": g.category,
      "ขาย (ชิ้น)": g.qty,
      "ราคาขายเฉลี่ย": Number(g.avgPrice.toFixed(2)),
      "ต้นทุนเฉลี่ย": Number(g.avgCost.toFixed(2)),
      "ยอดขายรวม": Number(g.revenue.toFixed(2)),
      "ต้นทุนรวม": Number(g.cost.toFixed(2)),
      "กำไร": Number(g.profit.toFixed(2)),
      "Margin (%)": Number(g.margin.toFixed(2))
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Profit ${periodLabel}`);
    XLSX.writeFile(wb, `Profit_by_Product_${_ppPeriod}_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast?.("ส่งออก Excel สำเร็จ");
  });
}
