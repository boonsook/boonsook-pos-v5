// ═══════════════════════════════════════════════════════════
//  SALES HEATMAP — ยอดขายตาม ชั่วโมง × วันในสัปดาห์
//  ช่วยรู้ว่าเวลาไหนขายดี → จัดพนักงาน + เปิดร้านได้ตรงจังหวะ
// ═══════════════════════════════════════════════════════════

import { escHtml } from "./utils.js";
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n || 0));
}
function moneyShort(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
}

const DAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const DAY_NAMES_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
let _shPeriod = "90d"; // 30d | 90d | year | all
let _shMetric = "revenue"; // revenue | bills

export function renderSalesHeatmapPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-sales_heatmap");
  if (!container) return;

  // ── Filter sales ──
  let cutoffKey = "";
  if (_shPeriod === "30d") {
    const d = new Date(); d.setDate(d.getDate() - 30); cutoffKey = d.toISOString().slice(0, 10);
  } else if (_shPeriod === "90d") {
    const d = new Date(); d.setDate(d.getDate() - 90); cutoffKey = d.toISOString().slice(0, 10);
  } else if (_shPeriod === "year") {
    cutoffKey = new Date().toISOString().slice(0, 4) + "-01-01";
  }

  const sales = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => !cutoffKey || String(s.created_at || "").slice(0, 10) >= cutoffKey);

  // ── Build matrix [day][hour] ──
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(null).map(() => ({ revenue: 0, bills: 0 })));
  sales.forEach(s => {
    const d = new Date(s.created_at);
    if (isNaN(d.getTime())) return;
    const day = d.getDay(); // 0 = Sunday
    const hour = d.getHours();
    matrix[day][hour].revenue += Number(s.total_amount || 0);
    matrix[day][hour].bills += 1;
  });

  // ── Find max for color scaling ──
  let maxVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = _shMetric === "revenue" ? matrix[d][h].revenue : matrix[d][h].bills;
      if (v > maxVal) maxVal = v;
    }
  }

  // ── Calc by day & by hour totals ──
  const byDay = matrix.map((hours, d) => ({
    day: DAY_NAMES[d],
    revenue: hours.reduce((s, h) => s + h.revenue, 0),
    bills: hours.reduce((s, h) => s + h.bills, 0)
  }));

  const byHour = Array(24).fill(null).map((_, h) => ({
    hour: h,
    revenue: matrix.reduce((s, day) => s + day[h].revenue, 0),
    bills: matrix.reduce((s, day) => s + day[h].bills, 0)
  }));

  const totalRevenue = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0);
  const totalBills = sales.length;

  // ── Best day & hour ──
  const bestDay = [...byDay].sort((a, b) => b.revenue - a.revenue)[0];
  const bestHour = [...byHour].sort((a, b) => b.revenue - a.revenue)[0];

  // Color helper
  function getCellColor(val) {
    if (maxVal === 0 || val === 0) return "#f8fafc";
    const pct = val / maxVal;
    if (pct < 0.1) return "#dbeafe";
    if (pct < 0.25) return "#93c5fd";
    if (pct < 0.5) return "#3b82f6";
    if (pct < 0.75) return "#1d4ed8";
    return "#1e3a8a";
  }
  function getTextColor(val) {
    if (maxVal === 0 || val === 0) return "#cbd5e1";
    return val / maxVal > 0.4 ? "#fff" : "#0f172a";
  }

  const periodLabel = { "30d":"30 วันล่าสุด","90d":"90 วันล่าสุด","year":"ปีนี้","all":"ทั้งหมด" }[_shPeriod];

  container.innerHTML = `
    <div style="max-width:1400px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">⏰</div>
        <h2 style="margin:0 0 4px;color:#1e40af">ยอดขายตามช่วงเวลา (Sales Heatmap)</h2>
        <p style="margin:0;color:#92400e;font-size:13px">รู้ว่าเวลาไหนขายดี → จัดพนักงาน + เปิดร้านได้ตรงจังหวะ</p>
      </div>

      <!-- Filters -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px">📅 ช่วง:</span>
        ${["30d","90d","year","all"].map(p => `
          <button class="sh-period-btn" data-p="${p}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_shPeriod===p?'#0284c7':'#cbd5e1'};background:${_shPeriod===p?'#0284c7':'#fff'};color:${_shPeriod===p?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">
            ${({"30d":"30 วัน","90d":"90 วัน","year":"ปีนี้","all":"ทั้งหมด"})[p]}
          </button>
        `).join("")}
        <span style="margin-left:10px;font-weight:600;font-size:13px">🔢 แสดง:</span>
        <button class="sh-metric-btn" data-m="revenue" style="padding:6px 14px;border-radius:18px;border:1px solid ${_shMetric==='revenue'?'#7c3aed':'#cbd5e1'};background:${_shMetric==='revenue'?'#7c3aed':'#fff'};color:${_shMetric==='revenue'?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">💰 ยอดเงิน</button>
        <button class="sh-metric-btn" data-m="bills" style="padding:6px 14px;border-radius:18px;border:1px solid ${_shMetric==='bills'?'#7c3aed':'#cbd5e1'};background:${_shMetric==='bills'?'#7c3aed':'#fff'};color:${_shMetric==='bills'?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">📋 จำนวนบิล</button>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📊 ยอดรวม (${periodLabel})</div>
          <div class="stat-value" style="color:#0284c7;font-size:22px">฿${moneyShort(totalRevenue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${totalBills} บิล</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">🏆 วันขายดีสุด</div>
          <div class="stat-value" style="color:#92400e;font-size:18px">${bestDay?.day || '-'}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">฿${moneyShort(bestDay?.revenue || 0)} (${bestDay?.bills || 0} บิล)</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #059669">
          <div class="stat-label">⏰ ชั่วโมงขายดีสุด</div>
          <div class="stat-value" style="color:#059669;font-size:22px">${String(bestHour?.hour ?? 0).padStart(2,'0')}:00</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">฿${moneyShort(bestHour?.revenue || 0)} (${bestHour?.bills || 0} บิล)</div>
        </div>
      </div>

      <!-- Heatmap Grid -->
      <div class="panel" style="padding:16px;margin-bottom:14px;overflow-x:auto">
        <h3 style="margin:0 0 10px;font-size:15px">🔥 Heatmap: วัน × ชั่วโมง</h3>
        <table style="border-collapse:collapse;font-size:11px;min-width:800px;width:100%">
          <thead>
            <tr>
              <th style="padding:4px 8px;text-align:left;width:70px">วัน \\ ชม.</th>
              ${Array(24).fill(0).map((_, h) => `<th style="padding:4px 2px;text-align:center;color:#64748b;font-weight:600;width:36px">${h}</th>`).join("")}
              <th style="padding:4px 8px;text-align:right;width:70px">รวม</th>
            </tr>
          </thead>
          <tbody>
            ${matrix.map((hours, d) => `
              <tr>
                <td style="padding:4px 8px;font-weight:700;color:#475569;background:#f8fafc">${DAY_NAMES_SHORT[d]}</td>
                ${hours.map((cell, h) => {
                  const val = _shMetric === "revenue" ? cell.revenue : cell.bills;
                  const bg = getCellColor(val);
                  const fg = getTextColor(val);
                  const display = val === 0 ? "" : (_shMetric === "revenue" ? moneyShort(val) : val);
                  const tooltip = `${DAY_NAMES[d]} ${String(h).padStart(2,'0')}:00 — ${cell.bills} บิล • ฿${money(cell.revenue)}`;
                  return `<td title="${escHtml(tooltip)}" style="padding:6px 0;text-align:center;background:${bg};color:${fg};font-weight:${val>0?'700':'400'};font-size:10px;border:1px solid #fff;cursor:help">${display}</td>`;
                }).join("")}
                <td style="padding:4px 8px;text-align:right;font-weight:700;color:#0284c7;background:#f0f9ff">${_shMetric === "revenue" ? "฿" + moneyShort(byDay[d].revenue) : byDay[d].bills}</td>
              </tr>
            `).join("")}
            <tr style="background:#f8fafc;font-weight:700">
              <td style="padding:6px 8px;color:#0284c7">รวม/ชม.</td>
              ${byHour.map(h => `<td style="padding:6px 0;text-align:center;font-size:10px;color:#0284c7">${h.bills > 0 ? (_shMetric === "revenue" ? moneyShort(h.revenue) : h.bills) : ""}</td>`).join("")}
              <td style="padding:6px 8px;text-align:right;color:#1e40af;font-size:13px">${_shMetric === "revenue" ? "฿" + moneyShort(totalRevenue) : totalBills}</td>
            </tr>
          </tbody>
        </table>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center;font-size:11px;color:#64748b">
          <span>เข้ม = ขายดี:</span>
          <span style="background:#f8fafc;padding:2px 8px;border-radius:4px">0</span>
          <span style="background:#dbeafe;padding:2px 8px;border-radius:4px">น้อย</span>
          <span style="background:#93c5fd;padding:2px 8px;border-radius:4px;color:#fff">ปานกลาง</span>
          <span style="background:#3b82f6;padding:2px 8px;border-radius:4px;color:#fff">มาก</span>
          <span style="background:#1e3a8a;padding:2px 8px;border-radius:4px;color:#fff">สูงสุด</span>
        </div>
      </div>

      <!-- By Day Summary -->
      <div class="panel" style="padding:16px">
        <h3 style="margin:0 0 10px;font-size:15px">📅 สรุปตามวันในสัปดาห์</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
          ${byDay.map((d, idx) => {
            const max = Math.max(...byDay.map(x => x.revenue));
            const pct = max > 0 ? (d.revenue / max * 100) : 0;
            return `
              <div style="background:#f8fafc;padding:10px;border-radius:8px;text-align:center;border:2px solid ${pct === 100 ? '#f59e0b' : 'transparent'}">
                <div style="font-size:11px;color:#64748b">${DAY_NAMES[idx]}</div>
                <div style="font-size:18px;font-weight:900;color:#0284c7;margin:4px 0">฿${moneyShort(d.revenue)}</div>
                <div style="font-size:11px;color:#94a3b8">${d.bills} บิล</div>
                <div style="background:#e2e8f0;height:4px;border-radius:2px;margin-top:6px;overflow:hidden">
                  <div style="background:linear-gradient(90deg,#0284c7,#1e3a8a);width:${pct}%;height:100%"></div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll(".sh-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _shPeriod = btn.dataset.p;
    renderSalesHeatmapPage(ctx);
  }));
  container.querySelectorAll(".sh-metric-btn").forEach(btn => btn.addEventListener("click", () => {
    _shMetric = btn.dataset.m;
    renderSalesHeatmapPage(ctx);
  }));
}
