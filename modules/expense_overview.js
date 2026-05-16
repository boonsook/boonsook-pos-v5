// ═══════════════════════════════════════════════════════════
//  EXPENSE OVERVIEW — ภาพรวมรายจ่าย (Phase 78)
//  Dashboard charts (Chart.js) — donut by category + bar by month
//  + stats cards + top expenses
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

let _data = [];
let _periodMonths = 3;

const money = (n) => "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const moneyShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
};

// ระบบใช้ enum value แต่บาง record อาจเป็น Thai (legacy) — map ทั้งคู่
const CATEGORY_META = {
  materials:  { label: "ค่าวัสดุ",         color: "#3b82f6", icon: "📦" },
  fuel:       { label: "ค่าน้ำมัน",        color: "#f59e0b", icon: "⛽" },
  labor_hire: { label: "ค่าจ้าง",          color: "#ec4899", icon: "🔧" },
  salary:     { label: "เงินเดือน",        color: "#a78bfa", icon: "💼" },
  rent:       { label: "ค่าเช่า",          color: "#ef4444", icon: "🏠" },
  utilities:  { label: "ค่าสาธารณูปโภค", color: "#06b6d4", icon: "💡" },
  other:      { label: "อื่นๆ",            color: "#94a3b8", icon: "📌" }
};

let _donutChart = null;
let _barChart = null;

export async function renderExpenseOverviewPage(ctx) {
  const { state: _state, requireAdmin } = ctx;
  const container = document.getElementById("page-expense_overview");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "", retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "dashboard-cards", count: 3 });

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // Period: last N months rolling
  const endDate = new Date();
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - (_periodMonths - 1), 1);
  const startStr = startDate.toISOString().slice(0, 10);

  try {
    const r = await fetch(cfg.url + `/rest/v1/expenses?select=*&expense_date=gte.${startStr}&order=expense_date.desc`, { headers });
    if (!r.ok) {
      const isAuth = r.status === 401 || r.status === 403;
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + r.status + ")" : "โหลดข้อมูลรายจ่ายไม่สำเร็จ",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่" : "HTTP " + r.status,
        retryLabel: "ลองโหลดใหม่",
        retryId: "eoRetryBtn"
      });
      document.getElementById("eoRetryBtn")?.addEventListener("click", () => renderExpenseOverviewPage(ctx));
      return;
    }
    _data = await r.json();
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "eoRetryBtn"
    });
    document.getElementById("eoRetryBtn")?.addEventListener("click", () => renderExpenseOverviewPage(ctx));
    return;
  }

  // ═══ Aggregate ═══
  const sumByCat = {};
  Object.keys(CATEGORY_META).forEach(k => sumByCat[k] = 0);
  let totalAll = 0;
  let countAll = 0;

  _data.forEach(e => {
    const amt = Number(e.amount || 0);
    totalAll += amt;
    countAll++;
    // Normalize category — legacy Thai → enum
    const cat = _normalizeCategory(e.category);
    sumByCat[cat] = (sumByCat[cat] || 0) + amt;
  });

  // หมวดที่ใช้มากที่สุด
  const topCat = Object.entries(sumByCat)
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0];

  // เฉลี่ย/เดือน
  const avgPerMonth = totalAll / _periodMonths;

  // Top 5 individual expenses
  const top5 = [..._data]
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 5);

  // ═══ Render ═══
  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fee2e2,#fed7aa);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📉</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ภาพรวมรายจ่าย</h2>
        <p style="margin:0;color:#475569;font-size:13px">รายจ่ายตามหมวดหมู่ + แนวโน้มรายเดือน + Top รายการ</p>
      </div>

      <!-- Period selector -->
      <div class="panel" style="padding:12px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700;font-size:13px">📅 ช่วง:</span>
        ${[3,6,12].map(n => `
          <button class="eo-period-btn" data-n="${n}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_periodMonths===n?'#dc2626':'#cbd5e1'};background:${_periodMonths===n?'#dc2626':'#fff'};color:${_periodMonths===n?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${n} เดือน</button>
        `).join("")}
      </div>

      <!-- Stat cards -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 รายจ่ายรวม</div>
          <div class="stat-value" style="color:#dc2626;font-size:22px">${moneyShort(totalAll)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countAll} รายการ</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">📊 เฉลี่ย/เดือน</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">${moneyShort(avgPerMonth)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${_periodMonths} เดือนล่าสุด</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">🏆 หมวดสูงสุด</div>
          <div class="stat-value" style="color:#0284c7;font-size:18px">${topCat ? CATEGORY_META[topCat[0]].icon + ' ' + CATEGORY_META[topCat[0]].label : '-'}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${topCat ? money(topCat[1]) : '—'}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">📋 จำนวนหมวด</div>
          <div class="stat-value" style="color:#059669">${Object.values(sumByCat).filter(v => v > 0).length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">จากทั้งหมด ${Object.keys(CATEGORY_META).length} หมวด</div>
        </div>
      </div>

      <!-- Charts row: donut + bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:14px">
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">🍩 รายจ่ายตามหมวดหมู่</h3>
          ${totalAll === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีรายจ่ายในช่วงนี้</div>'
            : `<div style="position:relative;height:280px"><canvas id="eoDonutChart"></canvas></div>
               <div style="margin-top:10px;font-size:12px;color:#475569">
                 รวม: <b style="color:#dc2626;font-size:14px">${money(totalAll)}</b>
               </div>`}
        </div>
        <div class="panel" style="padding:16px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">📊 รายจ่ายรายเดือน</h3>
          ${totalAll === 0
            ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีรายจ่ายในช่วงนี้</div>'
            : `<div style="position:relative;height:280px"><canvas id="eoBarChart"></canvas></div>
               <div style="margin-top:10px;font-size:12px;color:#475569">
                 เฉลี่ย <b style="color:#92400e">${moneyShort(avgPerMonth)}</b>/เดือน
               </div>`}
        </div>
      </div>

      <!-- Top 5 expenses -->
      ${top5.length > 0 ? `
        <div class="panel" style="padding:16px;margin-bottom:14px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a">🔥 รายการที่จ่ายมากที่สุด (Top 5)</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${top5.map((t, i) => {
              const cat = _normalizeCategory(t.category);
              const meta = CATEGORY_META[cat];
              return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f8fafc;border-radius:8px">
                  <div style="width:28px;height:28px;border-radius:50%;background:${i===0?'#dc2626':i===1?'#f59e0b':i===2?'#cbd5e1':'#e2e8f0'};color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900">${i+1}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px">${escHtml(t.description || meta.label)}</div>
                    <div style="font-size:11px;color:#64748b">${_dateTH(t.expense_date)} · <span style="background:${meta.color}22;color:${meta.color};padding:1px 6px;border-radius:4px">${meta.icon} ${meta.label}</span></div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-weight:900;color:#dc2626;font-size:14px">${money(t.amount)}</div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  container.querySelectorAll(".eo-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _periodMonths = Number(btn.dataset.n);
    renderExpenseOverviewPage(ctx);
  }));

  if (totalAll > 0 && typeof Chart !== "undefined") {
    setTimeout(() => _drawCharts(sumByCat, _data), 50);
  }
}

function _normalizeCategory(cat) {
  if (!cat) return "other";
  const c = String(cat).toLowerCase().trim();
  if (CATEGORY_META[c]) return c;
  // Map legacy Thai labels
  if (/น้ำมัน|เชื้อเพลิง|ดีเซล|แก๊ส|ปั๊ม/i.test(cat)) return "fuel";
  if (/น้ำ|ไฟ|โทรศัพท์|อินเทอร์เน็ต|wifi/i.test(cat)) return "utilities";
  if (/เช่า|rent/i.test(cat)) return "rent";
  if (/เงินเดือน|salary/i.test(cat)) return "salary";
  if (/ค่าจ้าง|ช่าง|labor/i.test(cat)) return "labor_hire";
  if (/วัสดุ|อะไหล่|materials|ของ/i.test(cat)) return "materials";
  return "other";
}

function _dateTH(d) {
  if (!d) return "-";
  try { return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }); }
  catch (e) { return d; }
}

function _drawCharts(sumByCat, data) {
  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
  if (_barChart)   { _barChart.destroy();   _barChart = null; }

  // Donut
  const donutCanvas = document.getElementById("eoDonutChart");
  if (donutCanvas) {
    const entries = Object.entries(sumByCat).filter(([_, v]) => v > 0);
    const labels = entries.map(([k]) => CATEGORY_META[k].icon + " " + CATEGORY_META[k].label);
    const values = entries.map(([_, v]) => v);
    const colors = entries.map(([k]) => CATEGORY_META[k].color);
    _donutChart = new Chart(donutCanvas, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
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

  // Bar — by month
  const barCanvas = document.getElementById("eoBarChart");
  if (barCanvas) {
    const monthMap = {};
    data.forEach(e => {
      const m = (e.expense_date || "").slice(0, 7);
      if (!m) return;
      if (!monthMap[m]) monthMap[m] = 0;
      monthMap[m] += Number(e.amount || 0);
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
        datasets: [{ label: "รายจ่าย", data: months.map(m => monthMap[m]), backgroundColor: "#ef4444" }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `฿${c.parsed.y.toLocaleString("th-TH")}` } }
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
