export function renderProfitReportPage(ctx) {
  const { state, money, showToast, loadAllData, currentRole, requireAdmin } = ctx;

  const container = document.getElementById("page-profit_report");
  if (!container) return;

  container.innerHTML = `
    <div class="stack">
      <div class="panel">
        <h1>รายงานกำไรขั้นต้น</h1>

        <div class="row mt16">
          <div>
            <label>วันที่ตั้งแต่</label>
            <input type="date" id="profit_from_date">
          </div>
          <div>
            <label>วันที่ถึง</label>
            <input type="date" id="profit_to_date">
          </div>
          <button class="btn primary" id="profit_view_btn">ดูรายงาน</button>
        </div>
      </div>

      <div id="profit_summary_cards" class="stats-grid"></div>

      <div class="panel mt16">
        <h2>กำไรจากแต่ละสินค้า</h2>
        <div id="profit_by_product_container"></div>
      </div>

      <div class="panel mt16">
        <h2>รายละเอียดค่าใช้จ่าย</h2>
        <div id="expense_breakdown_container"></div>
      </div>

      <div class="panel mt16">
        <h2>แนวโน้มรายได้-ต้นทุน 6 เดือนล่าสุด</h2>
        <div id="monthly_trend_container"></div>
      </div>
    </div>
  `;

  // Set default dates (last 30 days)
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  document.getElementById("profit_from_date").value = formatDateForInput(thirtyDaysAgo);
  document.getElementById("profit_to_date").value = formatDateForInput(today);

  // Load initial report
  loadProfitReport();

  document.getElementById("profit_view_btn").addEventListener("click", loadProfitReport);

  async function loadProfitReport() {
    const fromDate = document.getElementById("profit_from_date").value;
    const toDate = document.getElementById("profit_to_date").value;

    if (!fromDate || !toDate) {
      showToast("กรุณาเลือกช่วงวันที่", "error");
      return;
    }

    try {
      // Calculate summary metrics
      const fromTs = new Date(fromDate + "T00:00:00").getTime();
      const toTs = new Date(toDate + "T23:59:59").getTime();

      let totalRevenue = 0;
      let totalCost = 0;

      // Filter sales by date range (★ กรอง soft-deleted ออก)
      const salesInRange = (state.sales || []).filter(sale => {
        if ((sale.note || "").includes("[ลบแล้ว]")) return false;
        const saleTime = new Date(sale.created_at).getTime();
        return saleTime >= fromTs && saleTime <= toTs;
      });

      // Get sale IDs to fetch items
      const saleIds = salesInRange.map(s => s.id).filter(Boolean);
      let saleItems = [];

      if (saleIds.length > 0 && state.supabase) {
        const { data, error } = await state.supabase
          .from("sale_items")
          .select("*")
          .in("sale_id", saleIds);

        if (!error && data) {
          saleItems = data;
        }
      }

      // Calculate revenue and cost
      totalRevenue = salesInRange.reduce((sum, s) => sum + (parseFloat(s.total_amount) || 0), 0);
      // ★ ใช้ unit_cost (คอลัมน์ใหม่หลัง migration 2026-04-18) + fallback จาก products.cost
      const productCostMap = {};
      (state.products || []).forEach(p => { productCostMap[p.id] = Number(p.cost || 0); productCostMap[p.name] = Number(p.cost || 0); });
      totalCost = saleItems.reduce((sum, it) => {
        const qty = Number(it.qty) || 0;
        let uc = Number(it.unit_cost || 0);
        if (!uc) uc = productCostMap[it.product_id] || productCostMap[it.product_name] || 0;
        return sum + qty * uc;
      }, 0);

      const grossProfit = totalRevenue - totalCost;
      const grossProfitPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      // Filter expenses by date range
      const expensesInRange = (state.expenses || []).filter(exp => {
        const expTime = new Date(exp.expense_date).getTime();
        return expTime >= fromTs && expTime <= toTs;
      });

      const totalExpenses = expensesInRange.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      const netProfit = grossProfit - totalExpenses;

      // Render summary cards
      renderSummaryCards(totalRevenue, totalCost, grossProfit, grossProfitPct, totalExpenses, netProfit);

      // Render profit by product
      renderProfitByProduct(saleItems, state.products || []);

      // Render expense breakdown
      renderExpenseBreakdown(expensesInRange);

      // Render monthly trend
      renderMonthlyTrend(fromDate, toDate, saleItems, productCostMap);

    } catch (error) {
      console.error("Error loading profit report:", error);
      showToast("เกิดข้อผิดพลาดในการโหลดรายงาน", "error");
    }
  }

  function renderSummaryCards(revenue, cost, profit, profitPct, expenses, netProfit) {
    const cards = document.getElementById("profit_summary_cards");
    cards.innerHTML = `
      <div class="stat-card">
        <div class="label">รายได้</div>
        <div class="value">${money(revenue)}</div>
      </div>
      <div class="stat-card">
        <div class="label">ต้นทุนสินค้า</div>
        <div class="value">${money(cost)}</div>
      </div>
      <div class="stat-card">
        <div class="label">กำไรขั้นต้น</div>
        <div class="value">${money(profit)}</div>
        <div class="muted">${pct(profitPct)}</div>
      </div>
      <div class="stat-card">
        <div class="label">ค่าใช้จ่าย</div>
        <div class="value">${money(expenses)}</div>
      </div>
      <div class="stat-card">
        <div class="label">กำไรสุทธิ</div>
        <div class="value" style="color: ${netProfit >= 0 ? '#22c55e' : '#ef4444'}">${money(netProfit)}</div>
      </div>
    `;
  }

  function renderProfitByProduct(saleItems, products) {
    const container = document.getElementById("profit_by_product_container");

    // Group by product
    const productMap = {};

    saleItems.forEach(item => {
      const pName = item.product_name || "ไม่ระบุ";
      if (!productMap[pName]) {
        productMap[pName] = {
          productId: pName,
          productName: pName,
          totalQty: 0,
          totalSale: 0,
          totalCost: 0
        };
      }

      const qty = parseFloat(item.qty) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      // ★ unit_cost จากตาราง (หลัง migration) + fallback จาก products.cost
      const prodRef = products.find(p => p.id === item.product_id || p.name === item.product_name);
      const unitCost = parseFloat(item.unit_cost) || Number(prodRef?.cost || 0);

      productMap[pName].totalQty += qty;
      productMap[pName].totalSale += qty * unitPrice;
      productMap[pName].totalCost += qty * unitCost;
    });

    // Convert to array and sort by profit
    let products_with_profit = Object.values(productMap).map(p => ({
      ...p,
      profit: p.totalSale - p.totalCost,
      profitPct: p.totalSale > 0 ? ((p.totalSale - p.totalCost) / p.totalSale) * 100 : 0
    }));

    products_with_profit.sort((a, b) => b.profit - a.profit);
    products_with_profit = products_with_profit.slice(0, 20);

    if (products_with_profit.length === 0) {
      container.innerHTML = "<p class='muted'>ไม่มีข้อมูล</p>";
      return;
    }

    const html = `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px;">สินค้า</th>
            <th style="text-align: right; padding: 8px;">ขายได้</th>
            <th style="text-align: right; padding: 8px;">ต้นทุน</th>
            <th style="text-align: right; padding: 8px;">กำไร</th>
            <th style="text-align: right; padding: 8px;">อัตรากำไร%</th>
          </tr>
        </thead>
        <tbody>
          ${products_with_profit.map(p => `
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 8px;">${p.productName}</td>
              <td style="text-align: right; padding: 8px;">${money(p.totalSale)}</td>
              <td style="text-align: right; padding: 8px;">${money(p.totalCost)}</td>
              <td style="text-align: right; padding: 8px; color: #22c55e;">${money(p.profit)}</td>
              <td style="text-align: right; padding: 8px;">${pct(p.profitPct)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    container.innerHTML = html;
  }

  function renderExpenseBreakdown(expenses) {
    const container = document.getElementById("expense_breakdown_container");

    // Group by category
    const categoryMap = {};
    let total = 0;

    expenses.forEach(exp => {
      const category = exp.category || "อื่นๆ";
      const amount = parseFloat(exp.amount) || 0;

      if (!categoryMap[category]) {
        categoryMap[category] = 0;
      }
      categoryMap[category] += amount;
      total += amount;
    });

    const categories = Object.entries(categoryMap).map(([cat, amount]) => ({
      category: cat,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0
    }));

    if (categories.length === 0) {
      container.innerHTML = "<p class='muted'>ไม่มีค่าใช้จ่าย</p>";
      return;
    }

    const colors = ["#3b82f6", "#ef4444", "#f59e0b", "#8b5cf6", "#ec4899", "#10b981"];

    const html = `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px;">หมวดหมู่</th>
            <th style="text-align: right; padding: 8px;">จำนวน</th>
            <th style="text-align: right; padding: 8px;">ร้อยละ</th>
            <th style="text-align: left; padding: 8px;">กราฟ</th>
          </tr>
        </thead>
        <tbody>
          ${categories.map((c, i) => {
            const barWidth = c.pct;
            const color = colors[i % colors.length];
            return `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px;">${c.category}</td>
                <td style="text-align: right; padding: 8px;">${money(c.amount)}</td>
                <td style="text-align: right; padding: 8px;">${pct(c.pct)}</td>
                <td style="padding: 8px;">
                  <div style="width: 100%; background: #e5e7eb; height: 20px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${barWidth}%; background: ${color}; height: 100%; transition: width 0.3s;"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;

    container.innerHTML = html;
  }

  function renderMonthlyTrend(fromDate, toDate, saleItems = [], productCostMap = {}) {
    const container = document.getElementById("monthly_trend_container");

    // Get last 6 months
    const months = [];
    const endDate = new Date(toDate);
    for (let i = 5; i >= 0; i--) {
      const date = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
      months.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: formatMonthLabel(date),
        revenue: 0,
        cost: 0
      });
    }

    // Calculate monthly data from all sales (★ กรอง soft-deleted ออก)
    const fromTs = new Date(fromDate + "T00:00:00").getTime();
    const toTs = new Date(toDate + "T23:59:59").getTime();
    const activeSales = (state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]"));

    activeSales.forEach(sale => {
      const saleDate = new Date(sale.created_at);
      const saleTime = saleDate.getTime();

      if (saleTime >= fromTs && saleTime <= toTs) {
        const year = saleDate.getFullYear();
        const month = saleDate.getMonth();

        const monthObj = months.find(m => m.year === year && m.month === month);
        if (monthObj) {
          monthObj.revenue += parseFloat(sale.total_amount) || 0;
        }
      }
    });

    // ★ Calculate monthly cost from sale_items.unit_cost (fallback: productCostMap)
    const saleById = new Map(activeSales.map(s => [s.id, s]));
    saleItems.forEach(it => {
      const s = saleById.get(it.sale_id);
      if (!s) return;
      const saleTime = new Date(s.created_at).getTime();
      if (saleTime < fromTs || saleTime > toTs) return;
      const saleDate = new Date(s.created_at);
      const year = saleDate.getFullYear();
      const month = saleDate.getMonth();
      const monthObj = months.find(m => m.year === year && m.month === month);
      if (!monthObj) return;
      const qty = Number(it.qty) || 0;
      let uc = Number(it.unit_cost || 0);
      if (!uc) uc = productCostMap[it.product_id] || productCostMap[it.product_name] || 0;
      monthObj.cost += qty * uc;
    });

    const maxValue = Math.max(...months.flatMap(m => [m.revenue, m.cost])) || 1;
    const scale = 300 / maxValue;

    const html = `
      <div style="overflow-x: auto;">
        <div style="display: flex; gap: 16px; padding: 16px 0; min-width: 100%;">
          ${months.map(m => {
            const revenue = m.revenue;
            const cost = m.cost;
            const profit = revenue - cost;
            const revHeight = revenue * scale;
            const costHeight = cost * scale;

            return `
              <div style="flex: 1; min-width: 80px;">
                <div style="display: flex; align-items: flex-end; justify-content: center; gap: 4px; height: 300px;">
                  <div style="background: #3b82f6; width: 20px; height: ${revHeight}px; border-radius: 2px;" title="รายได้: ${money(revenue)}"></div>
                  <div style="background: #ef4444; width: 20px; height: ${costHeight}px; border-radius: 2px;" title="ต้นทุน: ${money(cost)}"></div>
                  <div style="background: #22c55e; width: 20px; height: ${profit * scale}px; border-radius: 2px;" title="กำไร: ${money(profit)}"></div>
                </div>
                <div style="text-align: center; margin-top: 8px; font-size: 12px; color: #6b7280;">${m.label}</div>
              </div>
            `;
          }).join("")}
        </div>
        <div style="display: flex; gap: 16px; margin-top: 16px; font-size: 12px;">
          <div><span style="display: inline-block; width: 12px; height: 12px; background: #3b82f6; border-radius: 2px; margin-right: 4px;"></span>รายได้</div>
          <div><span style="display: inline-block; width: 12px; height: 12px; background: #ef4444; border-radius: 2px; margin-right: 4px;"></span>ต้นทุน</div>
          <div><span style="display: inline-block; width: 12px; height: 12px; background: #22c55e; border-radius: 2px; margin-right: 4px;"></span>กำไร</div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }
}

// Helper functions
function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(date) {
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${months[date.getMonth()]} ${date.getFullYear() + 543}`;
}

function money(n) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 }).format(Number(n || 0));
}

function num(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

function pct(n) {
  return Number(n || 0).toFixed(1) + "%";
}
