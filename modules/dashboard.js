
let salesChart = null;
let _dashPeriod = "today"; // today | week | month | year

function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
function moneyShort(n){
  const v = Number(n||0);
  if(v >= 1e6) return (v/1e6).toFixed(1)+"M";
  if(v >= 1e3) return (v/1e3).toFixed(1)+"K";
  return v.toLocaleString("th-TH");
}
function todayKey(){return new Date().toLocaleDateString("en-CA");}
function weekAgoKey(){const d=new Date();d.setDate(d.getDate()-7);return d.toLocaleDateString("en-CA");}
function monthStartKey(){return todayKey().slice(0,7)+"-01";}
function yearStartKey(){return todayKey().slice(0,4)+"-01-01";}

function filterByPeriod(arr, dateField, period) {
  const today = todayKey();
  switch(period) {
    case "today": return arr.filter(x => String(x[dateField]||"").slice(0,10) === today);
    case "week":  return arr.filter(x => String(x[dateField]||"").slice(0,10) >= weekAgoKey());
    case "month": return arr.filter(x => String(x[dateField]||"").slice(0,7) === today.slice(0,7));
    case "year":  return arr.filter(x => String(x[dateField]||"").slice(0,4) === today.slice(0,4));
    default: return arr;
  }
}

const PERIOD_LABELS = { today:"วันนี้", week:"สัปดาห์นี้", month:"เดือนนี้", year:"ปีนี้" };

export function renderDashboard({ state, openReceiptDrawer, showRoute, sendLineNotify, showToast }) {
  const today = todayKey();
  const thisMonth = today.slice(0,7);

  // ★ กรองรายการขายที่ soft-delete แล้วออกก่อนคำนวณทุกอย่าง
  const allSales = (state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]"));

  // ★ ออเดอร์จากเว็บ (service_jobs ที่เป็นคำสั่งซื้อสินค้า) — รวมทุกสถานะยกเว้นยกเลิก
  const webOrders = (state.serviceJobs || []).filter(j =>
    ((j.sub_service || "").includes("สั่งซื้อ") || /^SH-(transfer|cod_cash|cod_transfer)\|/.test(j.note || "")) &&
    j.status !== "cancelled" &&
    !j.deleted_at && !(j.note || "").includes("[ลบแล้ว]")
  );

  // ─── ข้อมูลยอดขายตามช่วงเวลา ───
  const periodSales = filterByPeriod(allSales, "created_at", _dashPeriod);
  const periodWebOrders = filterByPeriod(webOrders, "created_at", _dashPeriod);
  const periodRevenue = periodSales.reduce((s,x)=>s+Number(x.total_amount||0),0) + periodWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const periodOrders = periodSales.length + periodWebOrders.length;
  const periodProfit = periodSales.reduce((s,x)=>s+Number(x.gross_profit||0),0);
  const periodCost = periodSales.reduce((s,x)=>s+Number(x.total_cost||0),0);

  // ─── ข้อมูลค่าใช้จ่ายตามช่วงเวลา ───
  const expenses = state.expenses || [];
  const periodExpenses = filterByPeriod(expenses, "expense_date", _dashPeriod);
  const periodExpenseTotal = periodExpenses.reduce((s,x)=>s+Number(x.amount||0),0);

  // ─── วันนี้ (สำหรับ hero) ───
  const todaySales = allSales.filter(s => String(s.created_at||"").slice(0,10) === today);
  const todayWebOrders = webOrders.filter(j => String(j.created_at||"").slice(0,10) === today);
  const todayRevenue = todaySales.reduce((s,x)=>s+Number(x.total_amount||0),0) + todayWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const todayOrderCount = todaySales.length + todayWebOrders.length;

  // ─── สรุปรวม ───
  const monthSales = allSales.filter(s => String(s.created_at||"").slice(0,7) === thisMonth);
  const monthWebOrders = webOrders.filter(j => String(j.created_at||"").slice(0,7) === thisMonth);
  const monthRevenue = monthSales.reduce((s,x)=>s+Number(x.total_amount||0),0) + monthWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const monthExpenseTotal = expenses.filter(e => String(e.expense_date||"").slice(0,7) === thisMonth).reduce((s,x)=>s+Number(x.amount||0),0);
  const monthNetProfit = monthRevenue - monthExpenseTotal;

  const lowStock = state.products.filter(p => Number(p.stock||0) <= Number(p.min_stock||0));
  const activeJobs = state.serviceJobs.filter(j => ["open","in_progress","pending","progress"].includes(j.status) && !j.deleted_at && !((j.note||"").includes("[ลบแล้ว]"))).length;

  // ═══ ออเดอร์ใหม่จาก AI Sales / AC Shop ═══
  const pendingOrders = (state.serviceJobs || []).filter(j => j.status === "pending" && /^(AI-|SH-)/.test(j.job_no || "") && !j.deleted_at && !((j.note||"").includes("[ลบแล้ว]")));

  // ─── Top products วันนี้ ───
  const productSalesMap = {};
  todaySales.forEach(s => {
    try {
      const items = typeof s.items === "string" ? JSON.parse(s.items) : (s.items || []);
      items.forEach(item => {
        const key = item.name || item.product_name || "สินค้า";
        if (!productSalesMap[key]) productSalesMap[key] = { name: key, qty: 0, revenue: 0 };
        productSalesMap[key].qty += Number(item.qty || 1);
        productSalesMap[key].revenue += Number(item.line_total || item.total || 0);
      });
    } catch(e){}
  });
  const topProducts = Object.values(productSalesMap).sort((a,b) => b.revenue - a.revenue).slice(0, 5);

  // ─── ค่าใช้จ่ายแยกหมวด (เดือนนี้) ───
  const expByCat = {};
  expenses.filter(e => String(e.expense_date||"").slice(0,7) === thisMonth).forEach(e => {
    const cat = e.category || "อื่นๆ";
    expByCat[cat] = (expByCat[cat] || 0) + Number(e.amount || 0);
  });

  document.getElementById("page-dashboard").innerHTML = `
    <!-- ═══ HERO ═══ -->
    <div class="hero">
      <div class="hero-grid">
        <div>
          <div class="hero-title-row">
            <div class="shop-bubble"><img src="${window._appGetLogo ? window._appGetLogo() : './logo.svg'}" alt="บุญสุข" style="width:48px;height:48px;border-radius:12px;vertical-align:middle;margin-right:8px" />บุญสุข</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button id="dashboardReceiptBtn" class="btn light">ดูบิลล่าสุด</button>
              <button id="sendDailySummaryBtn" class="btn light" style="font-size:12px" title="ส่งสรุปยอดขายวันนี้ทางไลน์">📩 สรุปยอดไลน์</button>
            </div>
          </div>
          <div style="margin-top:18px;font-size:20px;">วันนี้ขายได้</div>
          <div class="hero-amount">${money(todayRevenue)}</div>
          <div class="hero-sub">จาก ${todayOrderCount} ออเดอร์ ${todayWebOrders.length > 0 ? `(🛒 เว็บ ${todayWebOrders.length})` : ''}</div>
          <div class="hero-status">${lowStock.length ? `⚠ สินค้าใกล้หมด ${lowStock.length} รายการ` : "เชื่อมต่อฐานข้อมูลแล้ว"}</div>
        </div>
        <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat-card"><div class="stat-label">ผู้ใช้งาน</div><div class="stat-value" style="font-size:14px">${state.profile?.full_name || "-"}</div></div>
          <div class="stat-card"><div class="stat-label">สิทธิ์</div><div class="stat-value" style="font-size:14px">${state.profile?.role || "-"}</div></div>
          <div class="stat-card"><div class="stat-label">สินค้าทั้งหมด</div><div class="stat-value">${state.products.length}</div></div>
          <div class="stat-card"><div class="stat-label">งานช่างค้าง</div><div class="stat-value">${activeJobs}</div></div>
        </div>
      </div>
    </div>

    <!-- ═══ PERIOD TABS ═══ -->
    <div style="display:flex;gap:4px;background:#f1f5f9;border-radius:12px;padding:4px;flex-wrap:wrap">
      ${["today","week","month","year"].map(p => `
        <button class="dash-period-btn" data-period="${p}" style="flex:1;padding:10px 8px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;
          background:${_dashPeriod===p ? '#0284c7' : 'transparent'};
          color:${_dashPeriod===p ? '#fff' : '#64748b'}">
          ${PERIOD_LABELS[p]}
        </button>
      `).join("")}
    </div>

    <!-- ═══ PERIOD STATS ═══ -->
    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat-card" style="border-left:4px solid #0284c7">
        <div class="stat-label">💰 ยอดขาย ${PERIOD_LABELS[_dashPeriod]}</div>
        <div class="stat-value" style="color:#0284c7">${money(periodRevenue)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${periodOrders} ออเดอร์${periodWebOrders.length > 0 ? ` (🛒 ${periodWebOrders.length} จากเว็บ)` : ''}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #ef4444">
        <div class="stat-label">📤 ค่าใช้จ่าย ${PERIOD_LABELS[_dashPeriod]}</div>
        <div class="stat-value" style="color:#ef4444">${money(periodExpenseTotal)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${periodExpenses.length} รายการ</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #10b981">
        <div class="stat-label">📊 กำไรขั้นต้น ${PERIOD_LABELS[_dashPeriod]}</div>
        <div class="stat-value" style="color:#10b981">${money(periodProfit)}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid ${monthNetProfit >= 0 ? '#10b981' : '#ef4444'}">
        <div class="stat-label">📈 กำไรสุทธิเดือนนี้</div>
        <div class="stat-value" style="color:${monthNetProfit >= 0 ? '#10b981' : '#ef4444'}">${money(monthNetProfit)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">ขาย ${moneyShort(monthRevenue)} - จ่าย ${moneyShort(monthExpenseTotal)}</div>
      </div>
    </div>

    <!-- ═══ QUICK STATS ROW ═══ -->
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="stat-label">ยอดขายเดือนนี้</div><div class="stat-value" style="font-size:16px">${money(monthRevenue)}</div></div>
      <div class="stat-card"><div class="stat-label">ลูกค้าทั้งหมด</div><div class="stat-value" style="font-size:16px">${state.customers.length}</div></div>
      <div class="stat-card"><div class="stat-label">ใบเสนอราคา</div><div class="stat-value" style="font-size:16px">${state.quotations.length}</div></div>
      <div class="stat-card"><div class="stat-label">ออเดอร์แอร์ค้าง</div><div class="stat-value" style="font-size:16px;color:#f59e0b">${pendingOrders.length}</div></div>
    </div>

    <!-- ═══ PENDING ORDERS ═══ -->
    ${pendingOrders.length > 0 ? `
    <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;border-radius:14px;padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h3 style="margin:0;color:#92400e">🛒 ออเดอร์แอร์รอดำเนินการ (${pendingOrders.length})</h3>
        <button id="goServiceJobsBtn" class="btn warn" style="font-size:12px">ดูงานช่างทั้งหมด</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto">
        ${pendingOrders.slice(0,10).map(j => {
          const desc = j.description || "";
          const phoneMatch = desc.match(/📞 เบอร์: (.+)/);
          const phone = phoneMatch ? phoneMatch[1].split("\\n")[0] : "";
          return `
          <div style="background:#fff;border-radius:10px;padding:10px 12px;border:1px solid #fde68a;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="flex:1;min-width:180px">
              <div style="font-weight:700;color:#1f2937;font-size:13px">${j.job_no} — ${j.customer_name || "ไม่ระบุ"}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px">${(j.note || "").replace(/AI Sales:|AC Shop:/,"").slice(0,60)}</div>
              ${phone ? `<div style="font-size:12px;color:#3b82f6;margin-top:2px">📞 ${phone}</div>` : ""}
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span style="display:inline-block;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">⏳ รอดำเนินการ</span>
              <button data-line-order="${j.id}" style="background:#06C755;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px">💬 ส่งไลน์ลูกค้า</button>
              <div style="font-size:11px;color:#9ca3af">${new Date(j.created_at).toLocaleString("th-TH",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>` : ""}

    <!-- ═══ CHARTS + TOP PRODUCTS + EXPENSES ═══ -->
    <div class="two-col">
      <!-- กราฟยอดขาย -->
      <div class="panel">
        <div class="row"><h3 style="margin:0">กราฟยอดขาย 12 เดือน</h3><div class="muted">รายเดือน</div></div>
        <div class="chart-wrap"><canvas id="salesChart"></canvas></div>
      </div>

      <!-- สินค้าขายดีวันนี้ + ค่าใช้จ่ายเดือนนี้ -->
      <div style="display:grid;gap:16px">
        ${topProducts.length > 0 ? `
        <div class="panel">
          <h3 style="margin:0 0 10px 0">🏆 สินค้าขายดีวันนี้</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${topProducts.map((p,i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${i===0?'#eff6ff':'#f8fafc'};border-radius:10px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:16px;width:24px;text-align:center">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'▪️'}</span>
                  <div>
                    <div style="font-size:13px;font-weight:700;color:#1f2937">${p.name}</div>
                    <div style="font-size:11px;color:#94a3b8">${p.qty} ชิ้น</div>
                  </div>
                </div>
                <div style="font-size:14px;font-weight:800;color:#0284c7">${money(p.revenue)}</div>
              </div>
            `).join("")}
          </div>
        </div>` : ''}

        <div class="panel">
          <div class="row">
            <h3 style="margin:0">📤 ค่าใช้จ่ายเดือนนี้</h3>
            <div style="font-size:18px;font-weight:900;color:#ef4444">${money(monthExpenseTotal)}</div>
          </div>
          ${Object.keys(expByCat).length > 0 ? `
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
            ${Object.entries(expByCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([cat,amt]) => {
              const pct = monthExpenseTotal > 0 ? (amt/monthExpenseTotal*100).toFixed(0) : 0;
              return `
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;font-size:12px;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat}</div>
                <div style="width:100px;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:#ef4444;border-radius:4px"></div>
                </div>
                <div style="font-size:12px;font-weight:700;color:#1f2937;min-width:70px;text-align:right">${money(amt)}</div>
              </div>`;
            }).join("")}
          </div>` : '<div class="sku" style="margin-top:8px">ยังไม่มีค่าใช้จ่าย</div>'}
          <button id="goExpensesBtn" style="margin-top:10px;width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;font-size:12px;font-weight:600;color:#64748b;cursor:pointer">ดูรายละเอียดทั้งหมด →</button>
        </div>
      </div>
    </div>

    <!-- ═══ ALERTS ═══ -->
    <div class="panel">
      <div class="row"><h3 style="margin:0">แจ้งเตือนด่วน</h3><button id="goProductsBtn" class="btn warn">ดูสินค้า</button></div>
      <div class="card-list mt16" style="max-height:300px;overflow-y:auto">
        ${lowStock.length ? lowStock.slice(0,20).map(p => `
          <div class="card">
            <div style="font-weight:900">${p.name}</div>
            <div class="sku">${p.sku || "-"}</div>
            <div class="badge low">คงเหลือ ${p.stock} / ขั้นต่ำ ${p.min_stock}</div>
          </div>
        `).join("") : '<div class="card">ยังไม่มีสินค้าใกล้หมด</div>'}
      </div>
    </div>
  `;

  // ═══ BINDINGS ═══
  document.getElementById("dashboardReceiptBtn")?.addEventListener("click", openReceiptDrawer);
  document.getElementById("goProductsBtn")?.addEventListener("click", () => showRoute("products"));
  document.getElementById("goServiceJobsBtn")?.addEventListener("click", () => showRoute("service_jobs"));
  document.getElementById("goExpensesBtn")?.addEventListener("click", () => showRoute("expenses"));

  // ── Period tabs ──
  document.querySelectorAll(".dash-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _dashPeriod = btn.dataset.period;
    renderDashboard({ state, openReceiptDrawer, showRoute, sendLineNotify, showToast });
  }));

  // ── ส่งสรุปยอดขายวันนี้ทางไลน์ ──
  document.getElementById("sendDailySummaryBtn")?.addEventListener("click", () => {
    const storeName = state.storeInfo?.name || "บุญสุข";
    const todayExpense = expenses.filter(e => String(e.expense_date||"").slice(0,10) === today).reduce((s,x)=>s+Number(x.amount||0),0);
    const net = todayRevenue - todayExpense;

    let msg = `📊 สรุปยอดขายประจำวัน\n`;
    msg += `📅 ${new Date().toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `💰 ยอดขาย: ${money(todayRevenue)}\n`;
    msg += `🧾 จำนวนบิล: ${todayOrderCount} รายการ\n`;
    msg += `📤 ค่าใช้จ่าย: ${money(todayExpense)}\n`;
    msg += `${net >= 0 ? '📈' : '📉'} กำไรสุทธิ: ${money(net)}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    if (topProducts.length > 0) {
      msg += `🏆 สินค้าขายดี:\n`;
      topProducts.slice(0,3).forEach((p,i) => {
        msg += `${i===0?'🥇':i===1?'🥈':'🥉'} ${p.name} (${p.qty} ชิ้น) ${money(p.revenue)}\n`;
      });
      msg += `━━━━━━━━━━━━━━\n`;
    }
    if (pendingOrders.length > 0) {
      msg += `🛒 ออเดอร์แอร์ค้าง: ${pendingOrders.length} รายการ\n`;
    }
    msg += `\n${storeName}`;

    // ส่งผ่าน LINE
    if (typeof window.shareViaLINE === "function") {
      window.shareViaLINE(msg);
    } else {
      const enc = encodeURIComponent(msg);
      const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
      if (mobile) window.location.href = `line://msg/text/${enc}`;
      else window.open(`https://line.me/R/share?text=${enc}`, "_blank");
    }

    // ส่ง LINE Notify ด้วย (ถ้ามี)
    if (sendLineNotify) {
      Promise.resolve(sendLineNotify(msg, { state })).catch(() => {});
    }
  });

  /* ── ส่งใบเสนอราคา/ออเดอร์เข้าไลน์ลูกค้า ── */
  document.querySelectorAll("[data-line-order]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const jobId = Number(btn.dataset.lineOrder);
    const job = (state.serviceJobs || []).find(x => x.id === jobId);
    if (!job) return;

    const note = job.note || "";
    const desc = job.description || "";
    const cName = job.customer_name || "ลูกค้า";
    const phoneMatch = desc.match(/📞 เบอร์: (.+?)(\n|$)/);
    const phone = phoneMatch ? phoneMatch[1].trim() : "";
    const addrMatch = desc.match(/📍 ที่อยู่: (.+?)(\n|$)/);
    const addr = addrMatch ? addrMatch[1].trim() : "";
    const priceMatch = note.match(/ราคา[: ]*([0-9,.]+)/i);
    const price = priceMatch ? priceMatch[1] : "";
    const modelMatch = note.match(/(AI Sales|AC Shop)[:\s]*(.+?)(?:\n|$)/);
    const modelInfo = modelMatch ? modelMatch[2].trim() : note.slice(0, 80);

    const storeInfoEl = state.storeInfo || {};
    const storeName = storeInfoEl.name || "บุญสุข";
    const storePhone = storeInfoEl.phone || "";

    let msg = `📋 ใบยืนยันคำสั่งซื้อ\nเลขที่: ${job.job_no}\n━━━━━━━━━━━━━━\n👤 ลูกค้า: ${cName}\n`;
    if (phone) msg += `📞 โทร: ${phone}\n`;
    if (addr) msg += `📍 ที่อยู่: ${addr}\n`;
    msg += `━━━━━━━━━━━━━━\n🛒 รายการ: ${modelInfo}\n`;
    if (price) msg += `💰 ราคา: ${price} บาท\n`;
    msg += `📦 สถานะ: รอดำเนินการ\n━━━━━━━━━━━━━━\nขอบคุณที่ใช้บริการ ${storeName}`;
    if (storePhone) msg += `\n📞 ${storePhone}`;

    if (typeof window.shareViaLINE === "function") {
      window.shareViaLINE(msg);
    } else {
      const enc = encodeURIComponent(msg);
      const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
      if (mobile) window.location.href = `line://msg/text/${enc}`;
      else window.open(`https://line.me/R/share?text=${enc}`, "_blank");
    }
  }));

  renderChart((state.sales||[]).filter(s => !(s.note||"").includes("[ลบแล้ว]")));

  // ═══ AUTO DAILY SUMMARY ผ่าน LINE Notify ตอน 22:00 ═══
  setupDailySummaryTimer(state, sendLineNotify);
}

// ─── Chart ───
function renderChart(sales) {
  const labels = [];
  const values = [];
  const now = new Date();
  for (let i=11;i>=0;i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = d.toLocaleDateString("en-CA").slice(0,7);
    labels.push(d.toLocaleDateString("th-TH", {month:"short", year:"numeric"}));
    values.push(sales.filter(s => String(s.created_at||"").slice(0,7) === key).reduce((sum,s)=>sum+Number(s.total_amount||0),0));
  }
  const canvas = document.getElementById("salesChart");
  if (!canvas) return;
  // ★ Cleanup: destroy existing chart and set to null before creating new one
  if (salesChart) { salesChart.destroy(); salesChart = null; }
  salesChart = new Chart(canvas, {
    type:"bar",
    data:{labels,datasets:[{label:"ยอดขาย",data:values,backgroundColor:"rgba(2,132,199,.6)",borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>moneyShort(v)}}}}
  });
}

// ─── Auto send daily summary at 22:00 via LINE Notify ───
let _dailySummaryTimer = null;
function setupDailySummaryTimer(state, sendLineNotify) {
  if (_dailySummaryTimer) clearTimeout(_dailySummaryTimer);
  if (!sendLineNotify) return;

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1); // ถ้าเลย 22:00 แล้วรอวันพรุ่งนี้

  const ms = target - now;
  const sentKey = "bsk_daily_sent_" + todayKey();

  // ถ้าวันนี้ส่งไปแล้วไม่ต้องส่งซ้ำ
  if (localStorage.getItem(sentKey)) return;

  _dailySummaryTimer = setTimeout(() => {
    // ส่งสรุปยอด
    const today = todayKey();
    const todaySalesArr = (state.sales||[]).filter(s => !(s.note||"").includes("[ลบแล้ว]") && String(s.created_at||"").slice(0,10) === today);
    const revenue = todaySalesArr.reduce((s,x)=>s+Number(x.total_amount||0),0);
    const orders = todaySalesArr.length;
    const expenses = (state.expenses||[]).filter(e => String(e.expense_date||"").slice(0,10) === today);
    const expTotal = expenses.reduce((s,x)=>s+Number(x.amount||0),0);
    const net = revenue - expTotal;
    const storeName = state.storeInfo?.name || "บุญสุข";

    let msg = `🔔 ปิดยอดประจำวัน (22:00)\n`;
    msg += `📅 ${new Date().toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `💰 ยอดขาย: ${money(revenue)}\n`;
    msg += `🧾 จำนวนบิล: ${orders} รายการ\n`;
    msg += `📤 ค่าใช้จ่าย: ${money(expTotal)}\n`;
    msg += `${net >= 0 ? '📈' : '📉'} กำไรสุทธิ: ${money(net)}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `${storeName}`;

    Promise.resolve(sendLineNotify(msg, { state })).catch(() => {});
    localStorage.setItem(sentKey, "1");
  }, ms);
}
