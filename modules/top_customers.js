// ═══════════════════════════════════════════════════════════
//  TOP CUSTOMERS REPORT — ลูกค้าซื้อเยอะสุด (จัดอันดับ + Export)
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

let _tcPeriod = "year"; // all | year | month | 90d | 30d
let _tcSortBy = "revenue"; // revenue | qty | avg | recent

export function renderTopCustomersPage(ctx) {
  const { state, showToast, openCustomerDrawer } = ctx;
  const container = document.getElementById("page-top_customers");
  if (!container) return;

  // ── คำนวณช่วงวันตาม period ──
  const today = new Date();
  let cutoffKey = "";
  if (_tcPeriod === "30d") {
    const d = new Date(); d.setDate(d.getDate() - 30); cutoffKey = d.toISOString().slice(0, 10);
  } else if (_tcPeriod === "90d") {
    const d = new Date(); d.setDate(d.getDate() - 90); cutoffKey = d.toISOString().slice(0, 10);
  } else if (_tcPeriod === "month") {
    cutoffKey = today.toISOString().slice(0, 7) + "-01";
  } else if (_tcPeriod === "year") {
    cutoffKey = today.toISOString().slice(0, 4) + "-01-01";
  }

  // ── กรอง sales ในช่วง ──
  const sales = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => !cutoffKey || String(s.created_at || "").slice(0, 10) >= cutoffKey);

  // ── Group by customer (ใช้ customer_id ก่อน, fallback customer_name) ──
  const map = new Map();
  sales.forEach(s => {
    const key = s.customer_id ? `id:${s.customer_id}` : `name:${(s.customer_name || "ลูกค้าทั่วไป").trim()}`;
    if (!map.has(key)) {
      // หา customer record (ถ้ามี id)
      let cust = null;
      if (s.customer_id) cust = (state.customers || []).find(c => String(c.id) === String(s.customer_id));
      map.set(key, {
        id: s.customer_id || null,
        name: cust?.name || s.customer_name || "ลูกค้าทั่วไป",
        phone: cust?.phone || "",
        bills: 0,
        revenue: 0,
        qty: 0,
        firstBuy: "",
        lastBuy: ""
      });
    }
    const g = map.get(key);
    g.bills += 1;
    g.revenue += Number(s.total_amount || 0);
    const date = String(s.created_at || "").slice(0, 10);
    if (!g.firstBuy || date < g.firstBuy) g.firstBuy = date;
    if (!g.lastBuy || date > g.lastBuy) g.lastBuy = date;
  });

  // นับจำนวนชิ้นสินค้า (จาก saleItems)
  const saleIdSet = new Set(sales.map(s => String(s.id)));
  (state.saleItems || []).forEach(it => {
    if (!saleIdSet.has(String(it.sale_id))) return;
    const sale = sales.find(s => String(s.id) === String(it.sale_id));
    if (!sale) return;
    const key = sale.customer_id ? `id:${sale.customer_id}` : `name:${(sale.customer_name || "ลูกค้าทั่วไป").trim()}`;
    const g = map.get(key);
    if (g) g.qty += Number(it.qty || 0);
  });

  // ── Sort ──
  let list = [...map.values()].map(g => ({
    ...g,
    avg: g.bills > 0 ? g.revenue / g.bills : 0
  }));

  if (_tcSortBy === "revenue") list.sort((a, b) => b.revenue - a.revenue);
  else if (_tcSortBy === "qty") list.sort((a, b) => b.qty - a.qty);
  else if (_tcSortBy === "avg") list.sort((a, b) => b.avg - a.avg);
  else if (_tcSortBy === "recent") list.sort((a, b) => String(b.lastBuy).localeCompare(String(a.lastBuy)));

  // Stats
  const totalRevenue = list.reduce((s, g) => s + g.revenue, 0);
  const totalBills = list.reduce((s, g) => s + g.bills, 0);
  const totalCustomers = list.length;
  const knownCustomers = list.filter(g => g.id).length;
  const top5Revenue = list.slice(0, 5).reduce((s, g) => s + g.revenue, 0);
  const top5Pct = totalRevenue > 0 ? (top5Revenue / totalRevenue * 100).toFixed(1) : 0;

  const periodLabel = { "30d": "30 วันล่าสุด", "90d": "90 วันล่าสุด", "month": "เดือนนี้", "year": "ปีนี้", "all": "ทั้งหมด" }[_tcPeriod];

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fef3c7,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🏆</div>
        <h2 style="margin:0 0 4px;color:#854d0e">ลูกค้าซื้อเยอะสุด (Top Customers)</h2>
        <p style="margin:0;color:#1e40af;font-size:13px">จัดอันดับลูกค้าตามยอดซื้อ — ใช้ดูแล/ทำโปรโมชั่นพิเศษ</p>
      </div>

      <!-- Period Selector -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px">📅 ช่วง:</span>
        ${["30d","90d","month","year","all"].map(p => `
          <button class="tc-period-btn" data-p="${p}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_tcPeriod===p?'#0284c7':'#cbd5e1'};background:${_tcPeriod===p?'#0284c7':'#fff'};color:${_tcPeriod===p?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">
            ${({"30d":"30 วัน","90d":"90 วัน","month":"เดือนนี้","year":"ปีนี้","all":"ทั้งหมด"})[p]}
          </button>
        `).join("")}
        <span style="margin-left:10px;font-weight:600;font-size:13px">🔢 เรียงตาม:</span>
        ${[["revenue","ยอดซื้อ"],["qty","จำนวนชิ้น"],["avg","เฉลี่ย/บิล"],["recent","ซื้อล่าสุด"]].map(([k,l]) => `
          <button class="tc-sort-btn" data-s="${k}" style="padding:6px 12px;border-radius:18px;border:1px solid ${_tcSortBy===k?'#7c3aed':'#cbd5e1'};background:${_tcSortBy===k?'#7c3aed':'#fff'};color:${_tcSortBy===k?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">
            ${l}
          </button>
        `).join("")}
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">👥 ลูกค้าทั้งหมด (${periodLabel})</div>
          <div class="stat-value" style="color:#0284c7">${totalCustomers}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">มีบัญชี: ${knownCustomers} • walk-in: ${totalCustomers - knownCustomers}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #059669">
          <div class="stat-label">💰 ยอดรวม</div>
          <div class="stat-value" style="color:#059669;font-size:22px">฿${moneyShort(totalRevenue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${totalBills} บิล</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">🏆 Top 5 contribute</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">${top5Pct}%</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">฿${moneyShort(top5Revenue)} / ฿${moneyShort(totalRevenue)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed">
          <div class="stat-label">📊 เฉลี่ย/ลูกค้า</div>
          <div class="stat-value" style="color:#6d28d9;font-size:20px">฿${moneyShort(totalCustomers > 0 ? totalRevenue/totalCustomers : 0)}</div>
        </div>
      </div>

      <!-- Export -->
      <div style="display:flex;gap:8px;margin-bottom:10px;justify-content:flex-end">
        <button id="tcExportBtn" class="btn light" style="font-size:13px">📥 ส่งออก Excel</button>
      </div>

      <!-- Top Customers Table -->
      <div class="panel" style="padding:16px">
        ${list.length === 0 ? `<div style="text-align:center;padding:30px;color:#94a3b8">ยังไม่มีข้อมูลการขายในช่วงนี้</div>` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:center;width:50px">#</th>
                <th style="padding:8px;text-align:left">ลูกค้า</th>
                <th style="padding:8px;text-align:right">บิล</th>
                <th style="padding:8px;text-align:right">ชิ้น</th>
                <th style="padding:8px;text-align:right">ยอดรวม</th>
                <th style="padding:8px;text-align:right">เฉลี่ย/บิล</th>
                <th style="padding:8px;text-align:left">ซื้อล่าสุด</th>
                <th style="padding:8px"></th>
              </tr>
            </thead>
            <tbody>
              ${list.slice(0, 100).map((c, i) => {
                const rank = i + 1;
                const rankBg = rank === 1 ? "#fbbf24" : rank === 2 ? "#cbd5e1" : rank === 3 ? "#fdba74" : "#f1f5f9";
                const rankColor = rank <= 3 ? "#fff" : "#64748b";
                const isKnown = !!c.id;
                return `
                  <tr style="border-bottom:1px solid #e5e7eb">
                    <td style="padding:8px;text-align:center">
                      <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:${rankBg};color:${rankColor};font-weight:900;font-size:12px">${rank}</span>
                    </td>
                    <td style="padding:8px">
                      <div style="font-weight:700">${escHtml(c.name)}${rank <= 3 ? ' <span style="font-size:14px">' + (rank===1?'🥇':rank===2?'🥈':'🥉') + '</span>' : ''}</div>
                      <div style="font-size:11px;color:#64748b">${escHtml(c.phone || '')}${isKnown ? '' : ' <span style="color:#94a3b8">(walk-in)</span>'}</div>
                    </td>
                    <td style="padding:8px;text-align:right;font-weight:600">${c.bills}</td>
                    <td style="padding:8px;text-align:right">${c.qty.toLocaleString("th-TH")}</td>
                    <td style="padding:8px;text-align:right;color:#059669;font-weight:700">฿${money(c.revenue)}</td>
                    <td style="padding:8px;text-align:right;color:#0284c7">฿${money(c.avg)}</td>
                    <td style="padding:8px;font-size:12px;color:#475569">${c.lastBuy || '-'}</td>
                    <td style="padding:8px;text-align:right">
                      ${isKnown ? `<button class="tc-view-btn" data-cid="${escHtml(c.id)}" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:12px">👁️ ดู</button>` : ''}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
          ${list.length > 100 ? `<div style="text-align:center;color:#64748b;font-size:12px;padding:10px">+ อีก ${list.length - 100} รายการ — ใช้ Excel เพื่อดูทั้งหมด</div>` : ''}
        </div>
        `}
      </div>
    </div>
  `;

  // Bindings
  container.querySelectorAll(".tc-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _tcPeriod = btn.dataset.p;
    renderTopCustomersPage(ctx);
  }));
  container.querySelectorAll(".tc-sort-btn").forEach(btn => btn.addEventListener("click", () => {
    _tcSortBy = btn.dataset.s;
    renderTopCustomersPage(ctx);
  }));
  container.querySelectorAll(".tc-view-btn").forEach(btn => btn.addEventListener("click", () => {
    const cid = btn.dataset.cid;
    const cust = (state.customers || []).find(x => String(x.id) === String(cid));
    if (cust && openCustomerDrawer) openCustomerDrawer(cust);
  }));

  container.querySelector("#tcExportBtn")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") { showToast?.("ระบบ Excel ยังไม่พร้อม"); return; }
    const data = list.map((c, i) => ({
      "อันดับ": i + 1,
      "ชื่อลูกค้า": c.name,
      "เบอร์โทร": c.phone || "",
      "ประเภท": c.id ? "มีบัญชี" : "walk-in",
      "จำนวนบิล": c.bills,
      "จำนวนชิ้น": c.qty,
      "ยอดรวม": Number(c.revenue.toFixed(2)),
      "เฉลี่ย/บิล": Number(c.avg.toFixed(2)),
      "ซื้อครั้งแรก": c.firstBuy || "",
      "ซื้อล่าสุด": c.lastBuy || ""
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Top Customers ${periodLabel}`);
    XLSX.writeFile(wb, `Top_Customers_${_tcPeriod}_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast?.("ส่งออก Excel สำเร็จ");
  });
}
