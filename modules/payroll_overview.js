// ═══════════════════════════════════════════════════════════
//  PAYROLL OVERVIEW — ภาพรวมเงินเดือน (Phase 73)
//  Dashboard charts (Chart.js) — donut by category + bar by week
//  + stats cards + top earners
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

let _data = [];        // staff_payroll rows in selected range
let _depts = [];
let _profiles = [];
let _periodMonths = 3; // 3 / 6 / 12

const money = (n) => "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const moneyShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
};

// Chart instances — destroy before re-render to prevent leaks
let _donutChart = null;
let _barChart = null;
const _trendChart = null;

export async function renderPayrollOverviewPage(ctx) {
  const { state, showToast, requireAdmin } = ctx;
  const container = document.getElementById("page-payroll_overview");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "",
      retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "dashboard-cards", count: 3 });

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // Period: last N months (rolling) — start of (now - N+1) months
  const endDate = new Date();
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - (_periodMonths - 1), 1);
  const startStr = startDate.toISOString().slice(0, 10);

  try {
    const [pRes, dRes, profRes] = await Promise.all([
      fetch(cfg.url + `/rest/v1/staff_payroll?select=*&period_month=gte.${startStr}&order=period_month.desc`, { headers }),
      fetch(cfg.url + "/rest/v1/departments?select=*&order=sort_order.asc", { headers }),
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role,department_id&order=full_name.asc", { headers })
    ]);
    if (!pRes.ok) {
      const isAuth = pRes.status === 401 || pRes.status === 403;
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + pRes.status + ")" : "ตาราง staff_payroll ยังไม่มีในฐานข้อมูล",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่" : "รัน supabase-phase72-payroll.sql ก่อน (HTTP " + pRes.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "poRetryBtn"
      });
      document.getElementById("poRetryBtn")?.addEventListener("click", () => renderPayrollOverviewPage(ctx));
      return;
    }
    _data = await pRes.json();
    _depts = dRes.ok ? await dRes.json() : [];
    _profiles = profRes.ok ? await profRes.json() : [];
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "poRetryBtn"
    });
    document.getElementById("poRetryBtn")?.addEventListener("click", () => renderPayrollOverviewPage(ctx));
    return;
  }

  // ═══ Aggregate ═══
  const sumByCat = {
    base_salary: 0,
    overtime: 0,
    welfare: 0,
    bonus: 0,
    commission: 0
  };
  let totalAll = 0;
  let totalPaid = 0;
  let countAll = 0;
  let countPaid = 0;

  _data.forEach(p => {
    sumByCat.base_salary += Number(p.base_salary || 0);
    sumByCat.overtime    += Number(p.overtime || 0);
    sumByCat.welfare     += Number(p.welfare || 0);
    sumByCat.bonus       += Number(p.bonus || 0);
    sumByCat.commission  += Number(p.commission || 0);
    const total = Number(p.total_amount || 0);
    totalAll += total;
    countAll++;
    if (p.paid_at) {
      totalPaid += total;
      countPaid++;
    }
  });

  // Active employees: count distinct employee_id with payroll in period
  const activeEmpIds = new Set(_data.map(p => p.employee_id));
  const activeEmpCount = activeEmpIds.size;
  const totalEmpCount = _profiles.filter(p => p.role !== "customer").length;

  // Top earners (sum total per employee, top 5)
  const byEmp = {};
  _data.forEach(p => {
    if (!byEmp[p.employee_id]) byEmp[p.employee_id] = { total: 0, count: 0 };
    byEmp[p.employee_id].total += Number(p.total_amount || 0);
    byEmp[p.employee_id].count += 1;
  });
  const topEarners = Object.entries(byEmp)
    .map(([empId, v]) => {
      const emp = _profiles.find(x => x.id === empId);
      const dept = emp ? _depts.find(d => d.id === emp.department_id) : null;
      return { id: empId, name: emp?.full_name || "(ไม่พบ)", dept: dept?.name || "", total: v.total, count: v.count };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ═══ Render ═══
  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fef3c7,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📊</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ภาพรวมเงินเดือน</h2>
        <p style="margin:0;color:#475569;font-size:13px">ค่าใช้จ่ายพนักงาน + การจ่าย + แนวโน้ม</p>
      </div>

      <!-- Period selector -->
      <div class="panel" style="padding:12px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700;font-size:13px">📅 ช่วง:</span>
        ${[3,6,12].map(n => `
          <button class="po-period-btn" data-n="${n}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_periodMonths===n?'#0284c7':'#cbd5e1'};background:${_periodMonths===n?'#0284c7':'#fff'};color:${_periodMonths===n?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${n} เดือน</button>
        `).join("")}
      </div>

      <!-- Stat cards -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 ค่าใช้จ่ายพนักงานรวม</div>
          <div class="stat-value" style="color:#dc2626;font-size:22px">${moneyShort(totalAll)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countAll} รายการ</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">✓ ชำระแล้ว</div>
          <div class="stat-value" style="color:#059669;font-size:22px">${moneyShort(totalPaid)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countPaid}/${countAll} รายการ ${countAll > 0 ? `(${Math.round(countPaid/countAll*100)}%)` : ''}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">⏳ รอจ่าย</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">${moneyShort(totalAll - totalPaid)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countAll - countPaid} รายการ</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">👥 พนักงานในรอบ</div>
          <div class="stat-value" style="color:#0284c7">${activeEmpCount}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">จากทั้งหมด ${totalEmpCount} คน</div>
        </div>
      </div>

      <!-- Charts row: donut + bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:14px">
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">💰 ค่าใช้จ่ายพนักงานตามหมวด</h3>
          ${totalAll === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีข้อมูลในช่วงนี้</div>'
            : `<div style="position:relative;height:280px"><canvas id="poDonutChart"></canvas></div>
               <div style="margin-top:10px;font-size:12px;color:#475569">
                 รวม: <b style="color:#dc2626;font-size:14px">${money(totalAll)}</b>
               </div>`}
        </div>
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">📊 ยอดชำระค่าใช้จ่ายพนักงาน (รายเดือน)</h3>
          ${totalAll === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีข้อมูลในช่วงนี้</div>'
            : `<div style="position:relative;height:280px"><canvas id="poBarChart"></canvas></div>
               <div style="margin-top:10px;font-size:12px;color:#475569">
                 ชำระแล้ว <b style="color:#059669">${moneyShort(totalPaid)}</b> · รวม <b style="color:#dc2626">${moneyShort(totalAll)}</b>
               </div>`}
        </div>
      </div>

      <!-- Top earners -->
      ${topEarners.length > 0 ? `
        <div class="panel" style="padding:16px;margin-bottom:14px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">🏆 พนักงานที่ได้รับมากที่สุด (Top 5)</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${topEarners.map((t, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f8fafc;border-radius:8px">
                <div style="width:28px;height:28px;border-radius:50%;background:${i===0?'#fbbf24':i===1?'#94a3b8':i===2?'#cd7f32':'#e2e8f0'};color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900">${i+1}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:700;color:#0f172a">${escHtml(t.name)}</div>
                  ${t.dept ? `<div style="font-size:11px;color:#64748b">${escHtml(t.dept)}</div>` : ''}
                </div>
                <div style="text-align:right">
                  <div style="font-weight:900;color:#0284c7;font-size:14px">${money(t.total)}</div>
                  <div style="font-size:10px;color:#94a3b8">${t.count} รายการ</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // ── Bindings ──
  container.querySelectorAll(".po-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _periodMonths = Number(btn.dataset.n);
    renderPayrollOverviewPage(ctx);
  }));

  // ── Charts (Chart.js loaded globally) ──
  if (totalAll > 0 && typeof Chart !== "undefined") {
    setTimeout(() => _drawCharts(sumByCat, _data), 50);
  }
}

function _drawCharts(sumByCat, data) {
  // Destroy existing
  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
  if (_barChart)   { _barChart.destroy();   _barChart = null; }

  // Donut
  const donutCanvas = document.getElementById("poDonutChart");
  if (donutCanvas) {
    const labels = ["เงินเดือน", "ค่าล่วงเวลา", "สวัสดิการอื่น", "เงินพิเศษ", "คอมมิชชัน"];
    const values = [sumByCat.base_salary, sumByCat.overtime, sumByCat.welfare, sumByCat.bonus, sumByCat.commission];
    const colors = ["#3b82f6", "#0ea5e9", "#06b6d4", "#10b981", "#a78bfa"];
    _donutChart = new Chart(donutCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((s, v) => s + v, 0);
                const pct = total > 0 ? ((c.parsed / total) * 100).toFixed(1) : 0;
                return `${c.label}: ฿${c.parsed.toLocaleString("th-TH")} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Bar — group by month, paid vs total
  const barCanvas = document.getElementById("poBarChart");
  if (barCanvas) {
    const monthMap = {};
    data.forEach(p => {
      const m = (p.period_month || "").slice(0, 7); // YYYY-MM
      if (!m) return;
      if (!monthMap[m]) monthMap[m] = { total: 0, paid: 0 };
      const amt = Number(p.total_amount || 0);
      monthMap[m].total += amt;
      if (p.paid_at) monthMap[m].paid += amt;
    });
    const months = Object.keys(monthMap).sort();
    const labels = months.map(m => {
      const d = new Date(m + "-01");
      return d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
    });
    _barChart = new Chart(barCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "ชำระแล้ว",  data: months.map(m => monthMap[m].paid),  backgroundColor: "#10b981" },
          { label: "ค่าใช้จ่ายรวม", data: months.map(m => monthMap[m].total), backgroundColor: "#cbd5e1" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ฿${c.parsed.y.toLocaleString("th-TH")}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => "฿" + (v >= 1000 ? (v/1000).toFixed(0) + "K" : v) }
          }
        }
      }
    });
  }
}
