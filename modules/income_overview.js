// ═══════════════════════════════════════════════════════════
//  INCOME OVERVIEW — ภาพรวมรายได้ (Phase 395)
//  คู่กับ expense_overview · READ-ONLY (อ่าน ctx.state เท่านั้น ไม่ fetch/ไม่ mutate)
//
//  ⚠️ "รายได้" ต้องนิยามเดียวกับ dashboard/P&L = POS sales + web orders + งานบริการ
//     (delivered/done/closed) — reuse helper จาก dashboard.js (single source of truth)
//     เพื่อกัน divergence (บทเรียน Phase 387).
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderError } from "./ui_states.js";
import { escHtml, visibleSalesForRole, dateBkk, todayBkk } from "./utils.js";
import { isWebOrderServiceJob, isServiceIncomeJob, sumServiceJobIncome } from "./dashboard.js";

let _period = "month";   // today | month | year
let _donutChart = null;
let _barChart = null;

const PERIOD_LABELS = { today: "วันนี้", month: "เดือนนี้", year: "ปีนี้" };
const money = (n) => "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const moneyShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
};

// job_type → ป้ายหมวดงานบริการ (fallback = ค่าดิบ)
const JOB_TYPE_LABELS = { ac: "🔧 งานแอร์", solar: "☀️ โซลาร์", cctv: "📷 CCTV", fridge: "❄️ ตู้เย็น", washer: "🧺 เครื่องซักผ้า", tv: "📺 ทีวี", other: "🛠️ งานอื่นๆ" };
const SOURCE_COLORS = ["#0284c7", "#10b981", "#7c3aed", "#f59e0b", "#ec4899", "#06b6d4", "#94a3b8"];

// อยู่ในช่วงที่เลือก (Asia/Bangkok)
function inPeriod(dateStr, period) {
  const d = dateStr ? dateBkk(dateStr) : "";
  if (!d) return false;
  const today = todayBkk();
  if (period === "today") return d === today;
  if (period === "month") return d.slice(0, 7) === today.slice(0, 7);
  if (period === "year") return d.slice(0, 4) === today.slice(0, 4);
  return true;
}

export function renderIncomeOverviewPage(ctx) {
  const { state, requireAdmin, showRoute } = ctx || {};
  const container = document.getElementById("page-income_overview");
  if (!container) return;

  if (requireAdmin && !requireAdmin()) {
    container.innerHTML = renderError({ message: "เฉพาะผู้ดูแลระบบ", detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น", retryLabel: "", retryId: "" });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "dashboard-cards", count: 3 });

  // ── READ-ONLY: คำนวณจาก state เท่านั้น (นิยามเดียวกับ dashboard) ──
  const allSales = visibleSalesForRole(state?.sales, state?.profile, state?.currentUser);
  const jobs = state?.serviceJobs || [];
  const webOrders = jobs.filter(isWebOrderServiceJob);
  const serviceJobs = jobs.filter(j => isServiceIncomeJob(j) && !isWebOrderServiceJob(j));

  const posTotal = allSales.filter(s => inPeriod(s.created_at, _period)).reduce((a, s) => a + Number(s.total_amount || 0), 0);
  const posCount = allSales.filter(s => inPeriod(s.created_at, _period)).length;
  const webTotal = webOrders.filter(j => inPeriod(j.created_at, _period)).reduce((a, j) => a + Number(j.total_cost || 0), 0);
  const webCount = webOrders.filter(j => inPeriod(j.created_at, _period)).length;
  // ★ รายได้งานบริการ — ใช้ sumServiceJobIncome (single source) ไม่คิดสูตรเอง
  const serviceTotal = sumServiceJobIncome(jobs, j => inPeriod(j.created_at, _period));

  // breakdown หมวดสำหรับ donut: POS + web + งานบริการตาม job_type
  const byCat = {};
  if (posTotal > 0) byCat["💳 ขาย POS"] = posTotal;
  if (webTotal > 0) byCat["🛒 ออเดอร์เว็บ"] = webTotal;
  serviceJobs.filter(j => inPeriod(j.created_at, _period)).forEach(j => {
    const lbl = JOB_TYPE_LABELS[j.job_type] || (j.job_type ? "🛠️ " + escHtml(String(j.job_type)) : "🛠️ งานอื่นๆ");
    byCat[lbl] = (byCat[lbl] || 0) + Number(j.total_cost || 0);
  });

  const grandTotal = posTotal + webTotal + serviceTotal;
  const txCount = posCount + webCount + serviceJobs.filter(j => inPeriod(j.created_at, _period)).length;

  // bar รายเดือน (ปีนี้) — รวมทุกแหล่งต่อเดือน
  const yr = todayBkk().slice(0, 4);
  const monthMap = {};
  const addMonth = (dateStr, amt) => {
    const d = dateStr ? dateBkk(dateStr) : "";
    if (!d || d.slice(0, 4) !== yr) return;
    const m = d.slice(0, 7);
    monthMap[m] = (monthMap[m] || 0) + Number(amt || 0);
  };
  allSales.forEach(s => addMonth(s.created_at, s.total_amount));
  webOrders.forEach(j => addMonth(j.created_at, j.total_cost));
  serviceJobs.forEach(j => addMonth(j.created_at, j.total_cost));

  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dcfce7,#bae6fd);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📈</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ภาพรวมรายได้</h2>
        <p style="margin:0;color:#475569;font-size:13px">ขาย POS + ออเดอร์เว็บ + งานบริการ (นิยามเดียวกับงบ P&L)</p>
      </div>

      <div class="panel" style="padding:12px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700;font-size:13px">📅 ช่วง:</span>
        ${["today", "month", "year"].map(p => `
          <button class="io-period-btn" data-p="${p}" style="padding:6px 16px;border-radius:18px;border:1px solid ${_period === p ? '#059669' : '#cbd5e1'};background:${_period === p ? '#059669' : '#fff'};color:${_period === p ? '#fff' : '#475569'};cursor:pointer;font-size:12px;font-weight:600">${PERIOD_LABELS[p]}</button>
        `).join("")}
      </div>

      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #059669">
          <div class="stat-label">💰 รายได้รวม ${PERIOD_LABELS[_period]}</div>
          <div class="stat-value" style="color:#059669;font-size:22px">${money(grandTotal)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${txCount} รายการ</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">💳 ขาย POS</div>
          <div class="stat-value" style="color:#0284c7;font-size:20px">${moneyShort(posTotal)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${posCount} บิล</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed">
          <div class="stat-label">🔧 งานบริการ</div>
          <div class="stat-value" style="color:#7c3aed;font-size:20px">${moneyShort(serviceTotal)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">delivered/done/closed</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">🛒 ออเดอร์เว็บ</div>
          <div class="stat-value" style="color:#d97706;font-size:20px">${moneyShort(webTotal)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${webCount} ออเดอร์</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:14px">
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">🍩 รายได้ตามแหล่ง</h3>
          ${grandTotal === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีรายได้ในช่วงนี้</div>'
            : `<div style="position:relative;height:280px"><canvas id="ioDonutChart"></canvas></div>
               <div style="margin-top:10px;font-size:12px;color:#475569">รวม: <b style="color:#059669;font-size:14px">${money(grandTotal)}</b></div>`}
        </div>
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">📊 รายได้รายเดือน (ปี ${yr})</h3>
          ${Object.keys(monthMap).length === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีข้อมูลรายเดือน</div>'
            : `<div style="position:relative;height:280px"><canvas id="ioBarChart"></canvas></div>`}
        </div>
      </div>

      <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:4px">นิยาม "รายได้" ตรงกับหน้าภาพรวมบริษัท + งบกำไรขาดทุน (P&L)</div>
    </div>
  `;

  container.querySelectorAll(".io-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _period = btn.dataset.p;
    renderIncomeOverviewPage(ctx);
  }));
  // ลิงก์ stat card "รายได้รวม" ไป P&L (read-only navigate)
  if (typeof showRoute === "function") {
    // (ไม่มีปุ่ม nav บังคับ — ปล่อยให้ user ใช้เมนู; showRoute มีไว้เผื่อ extend)
    void showRoute;
  }

  if (typeof Chart !== "undefined") {
    setTimeout(() => _drawCharts(byCat, monthMap), 50);
  }
}

function _drawCharts(byCat, monthMap) {
  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
  if (_barChart) { _barChart.destroy(); _barChart = null; }

  const donut = document.getElementById("ioDonutChart");
  if (donut) {
    const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      _donutChart = new Chart(donut, {
        type: "doughnut",
        data: { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => SOURCE_COLORS[i % SOURCE_COLORS.length]), borderWidth: 2, borderColor: "#fff" }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { font: { size: 12 } } },
            tooltip: { callbacks: { label: (c) => { const t = c.dataset.data.reduce((s, v) => s + v, 0); const pct = t > 0 ? ((c.parsed / t) * 100).toFixed(1) : 0; return `${c.label}: ฿${c.parsed.toLocaleString("th-TH")} (${pct}%)`; } } }
          }
        }
      });
    }
  }

  const bar = document.getElementById("ioBarChart");
  if (bar) {
    const months = Object.keys(monthMap).sort();
    if (months.length) {
      _barChart = new Chart(bar, {
        type: "bar",
        data: { labels: months.map(m => { const d = new Date(m + "-01"); return d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" }); }), datasets: [{ label: "รายได้", data: months.map(m => monthMap[m]), backgroundColor: "#10b981" }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `฿${c.parsed.y.toLocaleString("th-TH")}` } } },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => "฿" + (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v) } } }
        }
      });
    }
  }
}
