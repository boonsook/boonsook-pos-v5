
// Phase 89.27: role-aware sales filter (extends Phase 89.24 to dashboard)
// Phase 89.28: BKK timezone for "today" comparisons — fix UTC slice giving wrong date 17:00-23:59 BKK
import { visibleSalesForRole, isAdminProfile, todayBkk, dateBkk } from "./utils.js";

// ═══ Phase 387: dashboard income helpers (pure — ทำให้กำไรสุทธิตรงกับงบ P&L) ═══
// web-order service jobs (คำสั่งซื้อสินค้าผ่านเว็บ) — predicate เดียวกับที่ใช้คิด revenue เดิม
export function isWebOrderServiceJob(j) {
  if (!j) return false;
  return (((j.sub_service || "").includes("สั่งซื้อ")) || /^SH-(transfer|cod_cash|cod_transfer)\|/.test(j.note || ""))
    && j.status !== "cancelled" && !j.deleted_at && !(j.note || "").includes("[ลบแล้ว]");
}
// งานบริการ/งานช่างที่เป็นรายได้ = ชุดเดียวกับที่ auto_post โพสต์เป็นรายได้ SV (delivered/done/closed + total_cost>0)
export function isServiceIncomeJob(j) {
  if (!j) return false;
  const st = String(j.status || "").trim().toLowerCase();
  return ["delivered", "done", "closed"].includes(st)
    && Number(j.total_cost || 0) > 0
    && !j.deleted_at && !(j.note || "").includes("[ลบแล้ว]");
}
// รวมรายได้งานบริการ (ไม่นับ web order ที่นับไปแล้ว) ของงานที่ผ่าน dateMatch
export function sumServiceJobIncome(serviceJobs, dateMatch) {
  if (!Array.isArray(serviceJobs)) return 0;
  return serviceJobs.reduce((s, j) =>
    (isServiceIncomeJob(j) && !isWebOrderServiceJob(j) && dateMatch(j)) ? s + Number(j.total_cost || 0) : s, 0);
}

// ★ Phase 396: เดือน (YYYY-MM) ที่ "มีข้อมูลจริง" จาก sales/expenses ที่โหลดมา (cap 50/200 — ไม่ใช่ 12 เดือนเต็ม)
//   ใช้ร่วมกัน: markup empty-check + renderChart (single source) · ไม่ mutate input (sort สำเนา)
function _trendMonths(sales, expenses) {
  const set = new Set();
  (Array.isArray(sales) ? sales : []).forEach(s => { const k = s?.created_at ? dateBkk(s.created_at).slice(0, 7) : ""; if (k) set.add(k); });
  (Array.isArray(expenses) ? expenses : []).forEach(e => { const k = String(e?.expense_date || "").slice(0, 7); if (k) set.add(k); });
  return [...set].sort().slice(-12);   // เดือนที่มีข้อมูลจริง สูงสุด 12 เดือนล่าสุด
}

// ★ Phase 397: rows "ธุรกรรมล่าสุด" (display read-only) — รายการขายล่าสุด ≤30 จาก state ที่โหลด
//   role-filtered (visibleSalesForRole = soft-delete + non-admin เห็นเฉพาะของตัวเอง, กัน data leak)
//   clone ก่อน sort (ห้าม mutate state.sales) · escapeHtml ทุกค่าที่มาจาก DB (XSS)
function _recentTxnRows(state) {
  const sales = visibleSalesForRole(state?.sales, state?.profile, state?.currentUser);
  const recent = [...(Array.isArray(sales) ? sales : [])]
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
    .slice(0, 30);
  if (recent.length === 0) {
    return `<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13px">ยังไม่มีธุรกรรม</div>`;
  }
  return recent.map(s => {
    const dt = s?.created_at ? new Date(s.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const orderNo = escapeHtml(s?.order_no || "—");
    const cust = escapeHtml(s?.customer_name || "—");
    const channel = escapeHtml(String(s?.payment_method || "—"));
    const amt = money(Number(s?.total_amount || 0));
    const outstanding = Number(s?.total_amount || 0) - Number(s?.credit_paid_amount || 0);
    const creditBadge = (s?.is_credit && outstanding > 0.01)
      ? ` <span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px">เครดิต</span>` : "";
    return `
      <div style="display:grid;grid-template-columns:96px minmax(0,1fr) minmax(0,1fr) 80px 100px;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">
        <div style="color:#64748b;white-space:nowrap">${dt}</div>
        <div style="font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${orderNo}</div>
        <div style="color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cust}</div>
        <div style="color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${channel}</div>
        <div style="text-align:right;font-weight:800;color:var(--primary2);white-space:nowrap">${amt}${creditBadge}</div>
      </div>`;
  }).join("");
}


let salesChart = null;
// ★ Pro panel chart instances
let salesByProductChart = null;
let revenueBarChart = null;
let expenseDonutChart = null;
let paymentBarChart = null;
let jobStatusChart = null;

let _dashPeriod = "today"; // today | week | month | year (hero-level)

// ★ Per-panel date range (months) — FlowAccount-style dropdown per panel
const _panelRange = {
  salesByProduct: 3,
  revenueBar: 3,
  expenseDonut: 3,
  paymentBar: 3,
  jobStatus: 3,
};

// Phase 58 (A3+B1): "วันนี้และที่ต้องดู" — combined daily agenda + alerts
// Phase 89.28: BKK-time "today" — กัน slice(0,10) UTC → ช่วง 17:00-23:59 BKK ตี = วันถัดไป UTC
function _renderTodayAndAlerts(state) {
  const today = todayBkk();
  const now = Date.now();
  const _in7d = today; // for due-date checks

  // 1) Today's service jobs
  const todayJobs = (state.serviceJobs || [])
    .filter(j => !(j.status === "cancelled" && (j.note || "").includes("[ลบแล้ว]")))
    .filter(j => dateBkk(j.scheduled_at || j.due_date) === today
              || dateBkk(j.created_at) === today);

  // 2) Overdue service jobs
  const overdueJobs = (state.serviceJobs || [])
    .filter(j => !["done", "delivered", "closed", "cancelled"].includes(j.status))
    .filter(j => j.scheduled_at && dateBkk(j.scheduled_at) < today);

  // 3) Quotations expiring within 3 days
  const expSoon = (state.quotations || []).filter(q => {
    if (!q.expires_at || ["cancelled", "expired", "rejected", "invoiced", "receipted"].includes(q.status)) return false;
    const exp = new Date(q.expires_at).getTime();
    return exp > now && exp - now < 3 * 86400000;
  });

  // 4) Overdue credit (sales is_credit + due_date < today + not paid)
  // Phase 89.27: visibleSalesForRole = soft-delete + role filter (non-admin sees own sales only)
  const overdueCredit = visibleSalesForRole(state.sales, state.profile, state.currentUser)
    .filter(s => s.is_credit)
    .filter(s => {
      const total = Number(s.total_amount || 0);
      const paid = Number(s.credit_paid_amount || 0);
      return (total - paid) > 0.01 && s.credit_due_date && s.credit_due_date < today;
    });

  // 5) Recurring expenses overdue
  const overdueRecurring = (state.recurringExpenses || []).filter(r => r.is_active && r.next_due && r.next_due <= today);

  // 6) Low-stock count (ใช้ logic เดิม — สินค้าที่ stock <= reorder_point หรือ <= 5 ถ้าไม่ตั้ง)
  const lowStock = (state.products || []).filter(p => {
    const t = p.product_type;
    if (t === "service" || t === "non_stock") return false;
    const s = Number(p.stock || 0);
    const r = Number(p.reorder_point != null ? p.reorder_point : 5);
    return s <= r;
  });

  // ── Phase 423 (mock-F): รวม "วันนี้" + "ที่ต้องดู" + ของใกล้หมด เป็นการ์ด "ต้องทำวันนี้" ใบเดียว ──
  // แถวละเรื่อง กดแล้วไปหน้านั้น (dash-clickable[data-go] binding เดิม) — เงื่อนไข/ตัวนับเดิมทุกตัว
  const todoRows = [];
  if (todayJobs.length > 0) todoRows.push({ go: "service_jobs", bg: "#e0f2fe", fg: "#0369a1", ic: "🔧", t: `งานช่างวันนี้ ${todayJobs.length} งาน`, s: escapeHtml(todayJobs[0]?.customer_name || todayJobs[0]?.description || "") });
  if (overdueJobs.length > 0) todoRows.push({ go: "service_jobs", bg: "#fee2e2", fg: "#b91c1c", ic: "⏰", t: `งานเลทกำหนด ${overdueJobs.length} งาน`, s: "เลยนัด/กำหนดส่ง" });
  if (lowStock.length > 0) todoRows.push({ go: "products", bg: "#fee2e2", fg: "#b91c1c", ic: "⚠️", t: `ของใกล้หมด ${lowStock.length} รายการ`, s: escapeHtml(lowStock[0]?.name || "") });
  if (expSoon.length > 0) todoRows.push({ go: "quotations", bg: "#ede9fe", fg: "#6d28d9", ic: "📄", t: `ใบเสนอราคาใกล้หมดอายุ ${expSoon.length} ใบ`, s: "ภายใน 3 วัน" });
  if (overdueCredit.length > 0) todoRows.push({ go: "credit_tracker", bg: "#fef3c7", fg: "#b45309", ic: "💳", t: `ลูกค้าค้างชำระเกินกำหนด ${overdueCredit.length} ราย`, s: "ติดตามหนี้" });
  if (overdueRecurring.length > 0) todoRows.push({ go: "recurring_expenses", bg: "#fef3c7", fg: "#b45309", ic: "🔁", t: `รายจ่ายประจำครบกำหนด ${overdueRecurring.length} รายการ`, s: "ถึงกำหนดจ่าย" });
  const todoCount = todoRows.length;

  // ── Phase 423: ยอดขายแยกตามช่องทาง (เดือนนี้) — display-only จาก state ที่โหลด (cap ~50) ──
  // กลุ่มตาม payment_method ของบิลเดือนนี้ (role-filtered + ข้าม [ลบแล้ว]) — ไม่มีสูตรเงินใหม่ แค่รวมยอดเพื่อแสดง
  const thisMonthKey = todayKey().slice(0, 7);
  const CHANNEL_LABELS = { cash: "เงินสด", transfer: "โอนเงิน", promptpay: "พร้อมเพย์", card: "บัตร", credit: "เครดิต", multi: "หลายช่องทาง", cod: "เก็บปลายทาง" };
  const chanMap = {};
  visibleSalesForRole(state?.sales, state?.profile, state?.currentUser)
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => s.created_at && dateBkk(s.created_at).slice(0, 7) === thisMonthKey)
    .forEach(s => {
      const raw = String(s.payment_method || (s.is_credit ? "credit" : "")).trim().toLowerCase();
      const label = CHANNEL_LABELS[raw] || (s.payment_method ? escapeHtml(String(s.payment_method)) : "อื่น ๆ");
      chanMap[label] = (chanMap[label] || 0) + Number(s.total_amount || 0);
    });
  const chanSorted = Object.entries(chanMap).sort((a, b) => b[1] - a[1]);
  const chanTop = chanSorted.slice(0, 4);
  const chanRest = chanSorted.slice(4).reduce((s, e) => s + e[1], 0);
  if (chanRest > 0) chanTop.push(["อื่น ๆ", chanRest]);
  const chanTotal = chanTop.reduce((s, e) => s + e[1], 0);
  const DONUT_COLORS = ["#0284c7", "#38bdf8", "#f59e0b", "#fb7185", "#94a3b8"];
  const CIRC = 238.76;
  let donutOff = 0;
  const donutSegs = chanTop.map(([, amt], i) => {
    const len = chanTotal > 0 ? (amt / chanTotal) * CIRC : 0;
    const seg = `<circle cx="48" cy="48" r="38" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="13" stroke-dasharray="${len.toFixed(1)} ${(CIRC - len).toFixed(1)}" stroke-dashoffset="${(-donutOff).toFixed(1)}" transform="rotate(-90 48 48)"/>`;
    donutOff += len;
    return seg;
  }).join("");

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin:14px 0">
      <!-- 📌 ต้องทำวันนี้ (Phase 423: รวม วันนี้/ที่ต้องดู/ของใกล้หมด) -->
      <div class="stat-card dash-todo" style="padding:14px">
        <div class="dash-todo-head">
          <div style="font-weight:800;color:var(--primary2)">📌 ต้องทำวันนี้</div>
          <span class="dash-todo-chip ${todoCount ? "warn" : "ok"}">${todoCount ? `${todoCount} เรื่อง` : "ไม่มีค้าง"}</span>
        </div>
        ${todoCount === 0
          ? '<div style="text-align:center;padding:18px 8px;color:#94a3b8;font-size:13px">ทุกอย่างปกติ — ไม่มีอะไรค้าง</div>'
          : todoRows.map(r => `
            <div class="dash-todo-row dash-clickable" data-go="${r.go}">
              <span class="dash-todo-ic" style="background:${r.bg};color:${r.fg}">${r.ic}</span>
              <div class="dash-todo-main">
                <div class="dash-todo-title">${r.t}</div>
                ${r.s ? `<div class="dash-todo-sub">${r.s}</div>` : ""}
              </div>
              <span class="dash-todo-arrow">›</span>
            </div>`).join("")}
      </div>

      <!-- 🍩 ยอดขายแยกตามช่องทาง (เดือนนี้) — display-only -->
      <div class="stat-card dash-chan" style="padding:14px">
        <div style="font-weight:800;color:var(--primary2);margin-bottom:8px">ยอดขายแยกตามช่องทาง <span style="font-weight:600;color:#94a3b8;font-size:11px">เดือนนี้</span></div>
        ${chanTotal <= 0
          ? '<div style="text-align:center;padding:24px 8px;color:#94a3b8;font-size:13px">เดือนนี้ยังไม่มีบิลขายในรายการที่โหลด</div>'
          : `
          <div class="dash-chan-wrap">
            <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
              <circle cx="48" cy="48" r="38" fill="none" stroke="#eef4f9" stroke-width="13"/>
              ${donutSegs}
              <text x="48" y="45" text-anchor="middle" font-size="13" font-weight="700" style="fill:var(--text)">฿${moneyShort(chanTotal)}</text>
              <text x="48" y="60" text-anchor="middle" font-size="10" fill="#94a3b8">เดือนนี้</text>
            </svg>
            <div class="dash-chan-legend">
              ${chanTop.map(([label, amt], i) => `
                <div class="dash-chan-row">
                  <span class="dash-chan-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>
                  <span class="dash-chan-name">${label}</span>
                  <span class="dash-chan-val">${chanTotal > 0 ? Math.round((amt / chanTotal) * 100) : 0}% · ฿${moneyShort(amt)}</span>
                </div>`).join("")}
            </div>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:8px">จากบิลที่โหลดล่าสุด (~50) — ไม่ใช่ทั้งระบบ</div>`}
      </div>
    </div>
  `;
}

// Phase 56: pure-SVG sparkline (no Chart.js dependency, no payload)
function _sparkline7d(values, color) {
  if (!values || values.length < 2) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const w = 120, h = 28, pad = 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) =>
    `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / range) * (h - pad * 2)).toFixed(1)}`
  ).join(" ");
  // gradient fill below line
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;margin-top:6px;overflow:visible">
    <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
    <polygon fill="${color}" fill-opacity="0.12" points="${pts} ${w - pad},${h} ${pad},${h}"/>
  </svg>`;
}

// ★ Phase 422 (mock-F layout): quick-action row — navigation only.
// ปุ่ม = เมนูที่ใช้บ่อยสุดของหน้าร้าน ทุกปุ่มวิ่งผ่าน dash-clickable[data-go]
// (binding เดิมของหน้า dashboard) — ไม่มี fetch / ไม่แตะ state / ไม่มี handler ใหม่
const QUICK_ACTIONS = [
  { go: "pos",             icon: "🛒", label: "ขายสินค้า",  bg: "#e0f2fe", fg: "#0369a1" },
  { go: "service_jobs",    icon: "🔧", label: "เปิดใบงาน",  bg: "#d1fae5", fg: "#047857" },
  { go: "quotations",      icon: "📄", label: "ใบเสนอราคา", bg: "#ede9fe", fg: "#6d28d9" },
  { go: "customers",       icon: "👥", label: "ลูกค้า",      bg: "#fce7f3", fg: "#be185d" },
  { go: "products",        icon: "📦", label: "เช็คสต็อก",  bg: "#fef3c7", fg: "#b45309" },
  { go: "income_overview", icon: "📊", label: "รายงาน",     bg: "#f1f5f9", fg: "#334155" },
];
function _quickActions() {
  return `<div class="dash-quick">
    ${QUICK_ACTIONS.map(a => `
      <button type="button" class="dash-quick-btn dash-clickable" data-go="${a.go}" title="${a.label}">
        <span class="dash-quick-ic" style="background:${a.bg};color:${a.fg}">${a.icon}</span>
        <span class="dash-quick-label">${a.label}</span>
      </button>`).join("")}
  </div>`;
}
function _last7DaysSeries(items, dateKey, valKey) {
  // Phase 89.28: ใช้ BKK timezone — เดิม toISOString().slice(0,10) ใช้ UTC → เพี้ยน ช่วง 17:00-23:59 BKK
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    days.push(dateBkk(d));
  }
  return days.map(day =>
    (items || [])
      .filter(it => !(it.note || "").includes("[ลบแล้ว]"))
      .filter(it => dateBkk(it[dateKey]) === day)
      .reduce((sum, it) => sum + Number(it[valKey] || 0), 0)
  );
}

function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
function moneyShort(n){
  const v = Number(n||0);
  if(v >= 1e6) return (v/1e6).toFixed(1)+"M";
  if(v >= 1e3) return (v/1e3).toFixed(1)+"K";
  return v.toLocaleString("th-TH");
}
// Phase 89.28: ใช้ todayBkk() (Asia/Bangkok) แทน toLocaleDateString — กัน browser TZ drift บนเครื่องที่ไม่ใช่ BKK
function todayKey(){return todayBkk();}
function weekAgoKey(){const d=new Date();d.setDate(d.getDate()-7);return dateBkk(d);}
function _monthStartKey(){return todayKey().slice(0,7)+"-01";}
function _yearStartKey(){return todayKey().slice(0,4)+"-01-01";}

// ★ คืนคีย์วันที่ (YYYY-MM-DD) ของ N เดือนที่แล้ว (วันเดียวกัน)
function monthsAgoKey(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return dateBkk(d);
}

function filterByPeriod(arr, dateField, period) {
  const today = todayKey();
  // Phase 89.28: dateBkk(...) convert UTC timestamptz → BKK YYYY-MM-DD ก่อนเทียบ
  // ป้องกัน sales/jobs ของวันนี้ที่ created 00:00-06:59 BKK (= UTC 17:00-23:59 วันก่อน) ตกหาย
  switch(period) {
    case "today": return arr.filter(x => dateBkk(x[dateField]) === today);
    case "week":  return arr.filter(x => dateBkk(x[dateField]) >= weekAgoKey());
    case "month": return arr.filter(x => dateBkk(x[dateField]).slice(0,7) === today.slice(0,7));
    case "year":  return arr.filter(x => dateBkk(x[dateField]).slice(0,4) === today.slice(0,4));
    default: return arr;
  }
}

// ★ กรองตามหน้าต่างเดือน (N months ago → today)
// Phase 89.28: dateBkk เพื่อเทียบกับ cutoff (BKK)
function filterByMonths(arr, dateField, months) {
  const cutoff = monthsAgoKey(months);
  return arr.filter(x => dateBkk(x[dateField]) >= cutoff);
}

// ★ สีหลัก 8 โทนฟ้า-ม่วง สำหรับ donut ยอดขาย (FlowAccount blue palette)
const BLUE_PALETTE = ["#0284c7","#0369a1","#075985","#0c4a6e","#38bdf8","#7dd3fc","#bae6fd","#e0f2fe"];
// ★ สีโทนแดง-ชมพู สำหรับ donut ค่าใช้จ่าย
const PINK_PALETTE = ["#be185d","#9f1239","#db2777","#e11d48","#f43f5e","#fb7185","#fda4af","#fecdd3"];
// ★ สีสถานะงานช่าง
const JOB_STATUS_COLORS = {
  pending:"#f59e0b", progress:"#0284c7", in_progress:"#0284c7",
  done:"#10b981", delivered:"#6366f1", closed:"#7c3aed", cancelled:"#ef4444"
};
const JOB_STATUS_LABELS = {
  pending:"รอดำเนินการ", progress:"กำลังทำ", in_progress:"กำลังทำ",
  done:"เสร็จแล้ว", delivered:"ส่งมอบแล้ว", closed:"ปิดงาน", cancelled:"ยกเลิก"
};

const PERIOD_LABELS = { today:"วันนี้", week:"สัปดาห์นี้", month:"เดือนนี้", year:"ปีนี้" };
const MONTH_RANGE_LABELS = { 3:"3 เดือน", 6:"6 เดือน", 12:"1 ปี" };

// ═══ Phase 389 (UI draft) — presentational render helpers ═══
// Pure string builders for the redesigned dashboard top section (business header +
// KPI grid). Read-only: take already-computed values, return markup. No fetch/state.
function _dashHeader({ shopName, logoSrc, isAdmin }) {
  return `
    <div class="dash-header">
      <div class="dash-header-id">
        <img class="dash-header-logo" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(shopName)}" />
        <div class="dash-header-meta">
          <div class="dash-header-name">${escapeHtml(shopName)}</div>
          <div class="dash-header-sub">ภาพรวมธุรกิจ${isAdmin ? "" : " · เฉพาะของคุณ"}</div>
        </div>
      </div>
      <div class="dash-header-actions">
        <button id="dashboardReceiptBtn" class="btn light">🧾 ดูบิลล่าสุด</button>
        <button id="sendDailySummaryBtn" class="btn light" title="ส่งสรุปยอดขายวันนี้ทางไลน์">📩 สรุปยอดไลน์</button>
      </div>
    </div>`;
}
// One KPI card. `go` makes it a clickable nav card (dash-clickable[data-go]); `accent`
// sets the left border colour; `spark` is optional sparkline markup; `small` shrinks
// the value font (for text values like user name). Values must be pre-escaped by caller.
function _kpiCard({ label, value, valueColor = "", sub = "", spark = "", accent = "", go = "", title = "", small = false, icon = "", iconBg = "", iconFg = "" }) {
  const cls = "kpi-card" + (go ? " dash-clickable" : "") + (icon ? " kpi-tile" : "");
  const accentStyle = accent ? ` style="border-left-color:${accent}"` : "";
  const goAttr = go ? ` data-go="${go}"` : "";
  const titleAttr = title ? ` title="${title}"` : "";
  const valStyle = valueColor ? ` style="color:${valueColor}"` : "";
  const valCls = "kpi-value" + (small ? " kpi-value--sm" : "");
  const iconHtml = icon ? `<span class="kpi-tile-ic" style="background:${iconBg};color:${iconFg}">${icon}</span>` : "";
  return `
      <div class="${cls}"${goAttr}${titleAttr}${accentStyle}>
        ${iconHtml}
        <div class="kpi-label">${label}</div>
        <div class="${valCls}"${valStyle}>${value}</div>
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
        ${spark || ""}
      </div>`;
}

export function renderDashboard({ state, openReceiptDrawer, showRoute, sendLineNotify, showToast }) {
  const today = todayKey();
  const thisMonth = today.slice(0,7);

  // ★ กรองรายการขายที่ soft-delete + non-admin เห็นเฉพาะของตัวเอง (Phase 89.27)
  const allSales = visibleSalesForRole(state.sales, state.profile, state.currentUser);

  // ★ ออเดอร์จากเว็บ (service_jobs ที่เป็นคำสั่งซื้อสินค้า) — รวมทุกสถานะยกเว้นยกเลิก
  const webOrders = (state.serviceJobs || []).filter(isWebOrderServiceJob);

  // ─── ข้อมูลยอดขายตามช่วงเวลา ───
  const periodSales = filterByPeriod(allSales, "created_at", _dashPeriod);
  const periodWebOrders = filterByPeriod(webOrders, "created_at", _dashPeriod);
  const periodRevenue = periodSales.reduce((s,x)=>s+Number(x.total_amount||0),0) + periodWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const periodOrders = periodSales.length + periodWebOrders.length;
  const periodProfit = periodSales.reduce((s,x)=>s+Number(x.gross_profit||0),0);
  const _periodCost = periodSales.reduce((s,x)=>s+Number(x.total_cost||0),0);

  // ─── ข้อมูลค่าใช้จ่ายตามช่วงเวลา ───
  const expenses = state.expenses || [];
  const periodExpenses = filterByPeriod(expenses, "expense_date", _dashPeriod);
  const periodExpenseTotal = periodExpenses.reduce((s,x)=>s+Number(x.amount||0),0);

  // ─── วันนี้ (สำหรับ hero) ───
  // Phase 89.28: dateBkk(...) แทน slice(0,10) เพื่อ TZ-correct (UTC timestamptz → BKK วันนี้)
  const todaySales = allSales.filter(s => dateBkk(s.created_at) === today);
  const todayWebOrders = webOrders.filter(j => dateBkk(j.created_at) === today);
  const todayRevenue = todaySales.reduce((s,x)=>s+Number(x.total_amount||0),0) + todayWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const todayOrderCount = todaySales.length + todayWebOrders.length;
  // ★ Phase 395: รายได้รวมวันนี้ = POS + web + งานบริการ (delivered/done/closed) — นิยามเดียวกับ income_overview/P&L
  //   *ไม่แก้* "ยอดขายวันนี้" (todayRevenue = POS+web) — แค่ "เพิ่ม" การ์ดรายได้รวม
  const todayServiceIncome = sumServiceJobIncome(state.serviceJobs, j => dateBkk(j.created_at) === today);
  const todayTotalIncome = todayRevenue + todayServiceIncome;

  // ─── สรุปรวม ───
  const monthSales = allSales.filter(s => dateBkk(s.created_at).slice(0,7) === thisMonth);
  const monthWebOrders = webOrders.filter(j => dateBkk(j.created_at).slice(0,7) === thisMonth);
  const monthRevenue = monthSales.reduce((s,x)=>s+Number(x.total_amount||0),0) + monthWebOrders.reduce((s,x)=>s+Number(x.total_cost||0),0);
  const monthExpenseTotal = expenses.filter(e => String(e.expense_date||"").slice(0,7) === thisMonth).reduce((s,x)=>s+Number(x.amount||0),0);
  // Phase 387: กำไรสุทธิต้องรวมรายได้งานบริการ (delivered/done/closed) ให้ตรงกับงบ P&L
  const monthServiceIncome = sumServiceJobIncome(state.serviceJobs, j => dateBkk(j.created_at).slice(0,7) === thisMonth);
  const monthTotalIncome = monthRevenue + monthServiceIncome;
  const monthNetProfit = monthTotalIncome - monthExpenseTotal;

  // ★ นับเฉพาะสินค้านับสต็อกจริง (ไม่รวมบริการ / non-stock)
  const _isStockItem = (p) => {
    const t = p.product_type;
    if (t === "service" || t === "non_stock") return false;
    return true;
  };
  const lowStock = state.products.filter(p => {
    if (!_isStockItem(p)) return false;
    const s = Number(p.stock || 0);
    const m = Number(p.min_stock || 0);
    return s <= 0 || (m > 0 && s <= m);
  }).sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));

  // ★ Top 5 สินค้าขายดี (30 วันล่าสุด)
  // Phase 89.28: dateBkk เทียบกับ cutoff BKK
  const last30Key = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return dateBkk(d); })();
  const recentSales = allSales.filter(s => dateBkk(s.created_at) >= last30Key);
  const salesMap = new Map();
  (state.saleItems || []).forEach(it => {
    const saleExists = recentSales.some(s => String(s.id) === String(it.sale_id));
    if (!saleExists) return;
    const pid = it.product_id;
    if (!pid) return;
    const prev = salesMap.get(pid) || { qty: 0, revenue: 0, name: it.product_name };
    prev.qty += Number(it.qty || 0);
    prev.revenue += Number(it.line_total || (Number(it.qty||0) * Number(it.unit_price||0)));
    salesMap.set(pid, prev);
  });
  const topSellers = [...salesMap.entries()]
    .map(([pid, v]) => ({ pid, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
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
    } catch(e){ console.warn("[dashboard] sale.items parse failed:", e, "sale id:", s?.id); }
  });
  const topProducts = Object.values(productSalesMap).sort((a,b) => b.revenue - a.revenue).slice(0, 5);

  // ─── ค่าใช้จ่ายแยกหมวด (เดือนนี้) ───
  const expByCat = {};
  expenses.filter(e => String(e.expense_date||"").slice(0,7) === thisMonth).forEach(e => {
    const cat = e.category || "อื่นๆ";
    expByCat[cat] = (expByCat[cat] || 0) + Number(e.amount || 0);
  });

  document.getElementById("page-dashboard").innerHTML = `
    <!-- ═══ PHASE 389 (draft): BUSINESS HEADER ═══ -->
    ${_dashHeader({
      shopName: state.storeInfo?.name || "บุญสุข",
      logoSrc: window._appGetLogo ? window._appGetLogo() : "./logo.svg",
      isAdmin: isAdminProfile(state.profile),
    })}

    <!-- ═══ PHASE 422: QUICK ACTIONS (mock-F) — nav-only circle buttons ═══ -->
    ${_quickActions()}

    <!-- ═══ TODAY HIGHLIGHT (flat, no gradient hero) ═══ -->
    <div class="dash-today dash-today--brand">
      <div class="dash-today-main">
        <div class="dash-today-label">ยอดขายวันนี้${isAdminProfile(state.profile) ? "" : ` <span class="dash-badge">เฉพาะของคุณ</span>`}</div>
        <div class="dash-today-amount">${money(todayRevenue)}</div>
        <div class="dash-today-sub">จาก ${todayOrderCount} ออเดอร์${todayWebOrders.length > 0 ? ` · 🛒 เว็บ ${todayWebOrders.length}` : ''}</div>
      </div>
      <!-- Phase 423: คำเตือนของใกล้หมดย้ายไปการ์ด "ต้องทำวันนี้" (hero สะอาดตาม mock-F) -->
      <div class="dash-today-status ok">✓ เชื่อมต่อฐานข้อมูลแล้ว</div>
    </div>

    <!-- ═══ PERIOD TABS ═══ -->
    <div class="dash-period-tabs">
      ${["today","week","month","year"].map(p => `
        <button class="dash-period-btn ${_dashPeriod===p ? 'active' : ''}" data-period="${p}">${PERIOD_LABELS[p]}</button>
      `).join("")}
    </div>

    <!-- ═══ KPI GRID — period money (Phase 56: + 7d sparkline) ═══ -->
    <div class="kpi-grid">
      ${_kpiCard({
        accent: "#0284c7", label: `💰 ยอดขาย ${PERIOD_LABELS[_dashPeriod]}`, value: money(periodRevenue), valueColor: "#0284c7",
        sub: `${periodOrders} ออเดอร์${periodWebOrders.length > 0 ? ` · 🛒 ${periodWebOrders.length} เว็บ` : ''}`,
        spark: `${_sparkline7d(_last7DaysSeries(allSales, "created_at", "total_amount"), "#0284c7")}<div class="kpi-spark-cap">7 วันล่าสุด</div>`,
      })}
      ${_kpiCard({
        accent: "#ef4444", label: `📤 ค่าใช้จ่าย ${PERIOD_LABELS[_dashPeriod]}`, value: money(periodExpenseTotal), valueColor: "#ef4444",
        sub: `${periodExpenses.length} รายการ`,
        spark: `${_sparkline7d(_last7DaysSeries(state.expenses, "expense_date", "amount"), "#ef4444")}<div class="kpi-spark-cap">7 วันล่าสุด</div>`,
      })}
      ${_kpiCard({ accent: "#10b981", label: `📊 กำไรขั้นต้น ${PERIOD_LABELS[_dashPeriod]}`, value: money(periodProfit), valueColor: "#10b981" })}
      ${_kpiCard({
        accent: monthNetProfit >= 0 ? "#10b981" : "#ef4444", label: "📈 กำไรสุทธิเดือนนี้",
        value: money(monthNetProfit), valueColor: monthNetProfit >= 0 ? "#10b981" : "#ef4444",
        sub: `รายได้ ${moneyShort(monthTotalIncome)} − จ่าย ${moneyShort(monthExpenseTotal)}`,
      })}
    </div>

    <!-- ═══ KPI GRID — counts (clickable nav cards) ═══ -->
    <div class="kpi-grid">
      ${(() => {
        // ★ Phase 85.4 — defensive KPI fallbacks (กัน profile/products/jobs render ว่าง)
        const ROLE_LABEL_TH = { admin: "ผู้ดูแลระบบ", sales: "พนักงานขาย", technician: "ช่าง", customer: "ลูกค้า" };
        const userName = (state.profile?.full_name || "").trim()
          || (state.currentUser?.email || "").split("@")[0]
          || "ยังไม่ระบุ";
        const userRoleKey = state.profile?.role || "";
        const userRoleLabel = ROLE_LABEL_TH[userRoleKey] || userRoleKey || "ผู้ใช้";
        const productCount = (state.products || []).length;
        const jobsCount = activeJobs ?? 0;
        // Phase 423 (mock-F): stat tiles — emoji ย้ายเข้าไอคอนวงกลมสี pastel
        return [
          _kpiCard({ go: "income_overview", title: "ดูภาพรวมรายได้", icon: "📈", iconBg: "#d1fae5", iconFg: "#047857", label: "รายได้วันนี้ (รวมบริการ)", value: money(todayTotalIncome), valueColor: "#059669" }),
          _kpiCard({ go: "receipts", title: "ดูใบเสร็จ", icon: "🧾", iconBg: "#e0f2fe", iconFg: "#0369a1", label: "ยอดขายเดือนนี้", value: money(monthRevenue) }),
          _kpiCard({ go: "customers", title: "ไปหน้าลูกค้า", icon: "👥", iconBg: "#ccfbf1", iconFg: "#0f766e", label: "ลูกค้าทั้งหมด", value: (state.customers || []).length.toLocaleString("th-TH") }),
          _kpiCard({ go: "products", title: "ไปหน้าสินค้า", icon: "📦", iconBg: "#fef3c7", iconFg: "#b45309", label: "สินค้าทั้งหมด", value: productCount.toLocaleString("th-TH") }),
          _kpiCard({ go: "service_jobs", title: "ไปหน้างานช่าง", icon: "🔧", iconBg: "#e0f2fe", iconFg: "#0369a1", label: "งานช่างค้าง", value: jobsCount.toLocaleString("th-TH") }),
          _kpiCard({ go: "quotations", title: "ไปหน้าใบเสนอราคา", icon: "📄", iconBg: "#ede9fe", iconFg: "#6d28d9", label: "ใบเสนอราคา", value: (state.quotations || []).length.toLocaleString("th-TH") }),
          _kpiCard({ go: "service_jobs", title: "ไปหน้างานช่าง", icon: "🛒", iconBg: "#ffedd5", iconFg: "#c2410c", label: "ออเดอร์แอร์ค้าง", value: pendingOrders.length.toLocaleString("th-TH"), valueColor: "#f59e0b" }),
          _kpiCard({ go: "settings", title: "ไปหน้าตั้งค่า", icon: "👤", iconBg: "#f1f5f9", iconFg: "#334155", label: "ผู้ใช้งาน", value: escapeHtml(userName), small: true }),
          _kpiCard({ go: "settings/permissions", title: "ดูสิทธิ์ทั้งหมด", icon: "🛡️", iconBg: "#fce7f3", iconFg: "#be185d", label: "สิทธิ์", value: escapeHtml(userRoleLabel), small: true }),
        ].join("");
      })()}
    </div>

    ${_renderTodayAndAlerts(state)}

    <!-- ═══ LOW STOCK + TOP SELLERS (2 columns) ═══ -->
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <!-- Low Stock Widget -->
      <div class="stat-card" style="padding:14px;border-left:4px solid ${lowStock.length ? '#ef4444' : '#10b981'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:800;color:${lowStock.length ? '#b91c1c' : '#065f46'}">${lowStock.length ? '⚠️' : '✅'} สต็อกใกล้หมด ${lowStock.length ? `(${lowStock.length})` : ''}</div>
          ${lowStock.length ? `<button class="btn light dash-go-products" style="font-size:11px;padding:4px 8px">ไปจัดการ →</button>` : ''}
        </div>
        ${lowStock.length === 0 ? `
          <div style="color:#64748b;font-size:12px;text-align:center;padding:16px 0">ทุกอย่างมีสต็อกพร้อม 🎉</div>
        ` : `
          <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
            ${lowStock.slice(0, 10).map(p => {
              const s = Number(p.stock || 0);
              const m = Number(p.min_stock || 0);
              const color = s <= 0 ? '#dc2626' : '#f59e0b';
              const label = s <= 0 ? 'หมด' : `${s} / ${m}`;
              return `
              <div class="dash-low-stock-row" data-pid="${p.id}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#f8fafc;border-radius:6px;cursor:pointer;font-size:12px">
                <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</div>
                <div style="color:${color};font-weight:700;margin-left:8px">${label}</div>
              </div>
            `;}).join("")}
            ${lowStock.length > 10 ? `<div style="text-align:center;color:#64748b;font-size:11px;padding:4px">+ อีก ${lowStock.length - 10} รายการ</div>` : ''}
          </div>
        `}
      </div>

      <!-- Top Sellers Widget -->
      <div class="stat-card" style="padding:14px;border-left:4px solid #7c3aed">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:800;color:#6d28d9">🏆 สินค้าขายดี 30 วันล่าสุด</div>
        </div>
        ${topSellers.length === 0 ? `
          <div style="color:#64748b;font-size:12px;text-align:center;padding:16px 0">ยังไม่มีข้อมูลการขาย</div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:4px">
            ${topSellers.map((t, i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#faf5ff;border-radius:6px;font-size:12px">
                <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  <span style="color:#7c3aed;font-weight:700">#${i+1}</span> ${escapeHtml(t.name || "-")}
                </div>
                <div style="color:#7c3aed;font-weight:700;margin-left:8px;white-space:nowrap">${t.qty} ชิ้น · ฿${moneyShort(t.revenue)}</div>
              </div>
            `).join("")}
          </div>
        `}
      </div>
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

    <!-- ═══ PRO 2x2 GRID (FlowAccount style) ═══ -->
    <style>
      .pro-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      @media (max-width: 900px) { .pro-grid { grid-template-columns:1fr; } }
      .pro-panel { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:12px; }
      .pro-header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .pro-title { margin:0; font-size:15px; font-weight:800; color:var(--primary2); display:flex; align-items:center; gap:6px; }
      .pro-title.pink { color:#be185d; }
      .pro-range-select { padding:6px 28px 6px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:12px; font-weight:700; color:#475569; background:#fff; cursor:pointer; }
      .pro-total-row { display:flex; align-items:center; gap:8px; font-size:13px; color:#475569; flex-wrap:wrap; }
      .pro-dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
      .pro-chart-wrap { position:relative; height:220px; }
      .pro-donut-wrap { display:grid; grid-template-columns:180px 1fr; gap:14px; align-items:center; }
      @media (max-width:500px) { .pro-donut-wrap { grid-template-columns:1fr; } }
      .pro-legend { display:flex; flex-direction:column; gap:4px; font-size:12px; }
      .pro-legend-row { display:flex; align-items:center; gap:6px; }
      .pro-legend-row .name { flex:1; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pro-legend-row .val { font-weight:700; color:#0f172a; white-space:nowrap; }
    </style>

    <div class="pro-grid">
      <!-- 1. ยอดขายตามสินค้า (donut) -->
      <div class="pro-panel">
        <div class="pro-header">
          <h3 class="pro-title">ยอดขายตามสินค้า <span style="opacity:.5;font-size:12px">ⓘ</span></h3>
          <select class="pro-range-select" data-panel="salesByProduct">
            ${[3,6,12].map(n => `<option value="${n}" ${_panelRange.salesByProduct===n?'selected':''}>${MONTH_RANGE_LABELS[n]}</option>`).join('')}
          </select>
        </div>
        <div class="pro-total-row"><span class="pro-dot" style="background:#0284c7"></span><span>รายได้รวม:</span><strong id="pro-sbp-total" style="color:var(--primary2)">-</strong></div>
        <div class="pro-donut-wrap">
          <div class="pro-chart-wrap"><canvas id="salesByProductChart"></canvas></div>
          <div class="pro-legend" id="pro-sbp-legend"></div>
        </div>
      </div>

      <!-- 2. สรุปยอดเก็บเงิน (bar) -->
      <div class="pro-panel">
        <div class="pro-header">
          <h3 class="pro-title">สรุปยอดเก็บเงิน <span style="opacity:.5;font-size:12px">ⓘ</span></h3>
          <select class="pro-range-select" data-panel="revenueBar">
            ${[3,6,12].map(n => `<option value="${n}" ${_panelRange.revenueBar===n?'selected':''}>${MONTH_RANGE_LABELS[n]}</option>`).join('')}
          </select>
        </div>
        <div class="pro-total-row">
          <span class="pro-dot" style="background:#0284c7"></span><span>เก็บเงินแล้ว:</span><strong id="pro-rev-collected" style="color:var(--primary2)">-</strong>
          <span class="pro-dot" style="background:#94a3b8;margin-left:10px"></span><span>รายได้รวม:</span><strong id="pro-rev-total" style="color:#475569">-</strong>
        </div>
        <div class="pro-chart-wrap"><canvas id="revenueBarChart"></canvas></div>
      </div>

      <!-- 3. ค่าใช้จ่ายตามหมวดหมู่ (donut pink) -->
      <div class="pro-panel">
        <div class="pro-header">
          <h3 class="pro-title pink">ค่าใช้จ่ายตามหมวดหมู่ <span style="opacity:.5;font-size:12px">ⓘ</span></h3>
          <select class="pro-range-select" data-panel="expenseDonut">
            ${[3,6,12].map(n => `<option value="${n}" ${_panelRange.expenseDonut===n?'selected':''}>${MONTH_RANGE_LABELS[n]}</option>`).join('')}
          </select>
        </div>
        <div class="pro-total-row"><span class="pro-dot" style="background:#be185d"></span><span>ค่าใช้จ่ายรวม:</span><strong id="pro-exp-total" style="color:#be185d">-</strong></div>
        <div class="pro-donut-wrap">
          <div class="pro-chart-wrap"><canvas id="expenseDonutChart"></canvas></div>
          <div class="pro-legend" id="pro-exp-legend"></div>
        </div>
      </div>

      <!-- 4. สรุปยอดชำระเงิน (bar pink) -->
      <div class="pro-panel">
        <div class="pro-header">
          <h3 class="pro-title pink">สรุปยอดชำระเงิน <span style="opacity:.5;font-size:12px">ⓘ</span></h3>
          <select class="pro-range-select" data-panel="paymentBar">
            ${[3,6,12].map(n => `<option value="${n}" ${_panelRange.paymentBar===n?'selected':''}>${MONTH_RANGE_LABELS[n]}</option>`).join('')}
          </select>
        </div>
        <div class="pro-total-row">
          <span class="pro-dot" style="background:#be185d"></span><span>ชำระแล้ว:</span><strong id="pro-pay-collected" style="color:#be185d">-</strong>
          <span class="pro-dot" style="background:#94a3b8;margin-left:10px"></span><span>ค่าใช้จ่ายรวม:</span><strong id="pro-pay-total" style="color:#475569">-</strong>
        </div>
        <div class="pro-chart-wrap"><canvas id="paymentBarChart"></canvas></div>
      </div>
    </div>

    <!-- ═══ BONUS: งานช่างตามสถานะ (horizontal bar) ═══ -->
    <div class="pro-panel">
      <div class="pro-header">
        <h3 class="pro-title" style="color:#7c3aed">🔧 งานบริการตามสถานะ <span style="opacity:.5;font-size:12px">ⓘ</span></h3>
        <select class="pro-range-select" data-panel="jobStatus">
          ${[3,6,12].map(n => `<option value="${n}" ${_panelRange.jobStatus===n?'selected':''}>${MONTH_RANGE_LABELS[n]}</option>`).join('')}
        </select>
      </div>
      <div class="pro-total-row"><span>งานทั้งหมด:</span><strong id="pro-job-total" style="color:#7c3aed">-</strong></div>
      <div class="pro-chart-wrap" style="height:180px"><canvas id="jobStatusChart"></canvas></div>
    </div>

    <!-- ═══ TREND (Phase 396): income vs expense line — full width ═══ -->
    <div class="panel">
      <div class="row"><h3 style="margin:0">📈 แนวโน้มรายได้ & ค่าใช้จ่าย</h3></div>
      <div style="font-size:11px;color:#94a3b8;margin:-2px 0 8px">จากรายการล่าสุดที่โหลด (บิล ~50 / ค่าใช้จ่าย ~200) — ไม่ใช่ทั้งระบบ</div>
      ${_trendMonths(allSales, expenses).length === 0
        ? `<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">ยังไม่มีข้อมูลพอแสดงแนวโน้ม</div>`
        : `<div class="chart-wrap" style="height:260px"><canvas id="salesChart"></canvas></div>`}
    </div>

    <!-- ═══ TOP PRODUCTS + EXPENSES (Phase 396: re-parented from two-col; เนื้อหาเดิมไม่เปลี่ยน) ═══ -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
        ${topProducts.length > 0 ? `
        <div class="panel">
          <h3 style="margin:0 0 10px 0">🏆 สินค้าขายดีวันนี้</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${topProducts.map((p,i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${i===0?'#e0f2fe':'#f8fafc'};border-radius:10px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:16px;width:24px;text-align:center">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'▪️'}</span>
                  <div>
                    <div style="font-size:13px;font-weight:700;color:#1f2937">${escapeHtml(p.name)}</div>
                    <div style="font-size:11px;color:#94a3b8">${p.qty} ชิ้น</div>
                  </div>
                </div>
                <div style="font-size:14px;font-weight:800;color:var(--primary2)">${money(p.revenue)}</div>
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

    <!-- ═══ RECENT TRANSACTIONS (Phase 397): read-only, scrollable ═══ -->
    <div class="panel">
      <div class="row"><h3 style="margin:0">🧾 ธุรกรรมล่าสุด</h3></div>
      <div style="font-size:11px;color:#94a3b8;margin:-2px 0 8px">รายการขายล่าสุด (สูงสุด ~50 ที่โหลด) — ไม่ใช่ทั้งระบบ</div>
      <div style="max-height:360px;overflow-y:auto;overflow-x:auto">
        <div style="display:grid;grid-template-columns:96px minmax(0,1fr) minmax(0,1fr) 80px 100px;gap:8px;padding:6px 10px;position:sticky;top:0;background:#f8fafc;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0">
          <div>วันที่/เวลา</div><div>เลขที่บิล</div><div>ลูกค้า</div><div>ช่องทาง</div><div style="text-align:right">ยอด</div>
        </div>
        ${_recentTxnRows(state)}
      </div>
    </div>

    <!-- ═══ ALERTS ═══ -->
    <div class="panel">
      <div class="row"><h3 style="margin:0">แจ้งเตือนด่วน</h3><button id="goProductsBtn" class="btn warn">ดูสินค้า</button></div>
      <div class="card-list mt16" style="max-height:300px;overflow-y:auto">
        ${lowStock.length ? lowStock.slice(0,20).map(p => `
          <div class="card">
            <div style="font-weight:900">${escapeHtml(p.name)}</div>
            <div class="sku">${escapeHtml(p.sku) || "-"}</div>
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

  // Clickable stat cards (data-go="<route>")
  document.querySelectorAll(".dash-clickable[data-go]").forEach(card => {
    card.addEventListener("click", () => {
      const target = card.dataset.go || "";
      if (!target) return;
      if (target.startsWith("settings")) {
        window.location.hash = "#" + target;
        showRoute("settings");
      } else {
        showRoute(target);
      }
    });
  });

  // ★ Low-stock widget: คลิก row → เปิด drawer แก้สินค้า, ปุ่ม "ไปจัดการ" → ไปหน้าสินค้า
  document.querySelectorAll(".dash-go-products").forEach(b => b.addEventListener("click", (e) => {
    e.stopPropagation();
    showRoute("products");
  }));
  document.querySelectorAll(".dash-low-stock-row").forEach(row => row.addEventListener("click", () => {
    const pid = row.dataset.pid;
    const prod = (state.products || []).find(x => String(x.id) === String(pid));
    if (!prod) return;
    if (window.App?.openProductDrawer) window.App.openProductDrawer(prod);
    else showRoute("products");
  }));

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

  renderChart(allSales, expenses);

  // ★ Pro panels render
  renderProPanels({ allSales, webOrders, expenses, serviceJobs: (state.serviceJobs||[]) });

  // Event listeners for per-panel date range dropdowns
  document.querySelectorAll(".pro-range-select").forEach(sel => sel.addEventListener("change", (_e) => {
    const key = sel.dataset.panel;
    _panelRange[key] = Number(sel.value);
    // Re-render only the affected panel (เร็วกว่า re-render ทั้งหน้า)
    renderProPanels({ allSales, webOrders, expenses, serviceJobs: (state.serviceJobs||[]) }, key);
  }));

  // ═══ AUTO DAILY SUMMARY ผ่าน LINE Notify ตอน 22:00 ═══
  setupDailySummaryTimer(state, sendLineNotify);
}

// ═══════════════════════════════════════════════════════════
//  PRO PANELS (FlowAccount-style charts)
// ═══════════════════════════════════════════════════════════
function renderProPanels({ allSales, webOrders, expenses, serviceJobs }, onlyKey) {
  // ★ Guard: ถ้า Chart.js ยังไม่โหลด skip ไปก่อน (กันหน้าพัง)
  if (typeof Chart === "undefined") {
    console.warn("[dashboard] Chart.js ยังไม่โหลด — skip pro panels");
    return;
  }
  if (!onlyKey || onlyKey === "salesByProduct") renderSalesByProductPanel(allSales, webOrders);
  if (!onlyKey || onlyKey === "revenueBar")     renderRevenueBarPanel(allSales, webOrders);
  if (!onlyKey || onlyKey === "expenseDonut")   renderExpenseDonutPanel(expenses);
  if (!onlyKey || onlyKey === "paymentBar")     renderPaymentBarPanel(expenses);
  if (!onlyKey || onlyKey === "jobStatus")      renderJobStatusPanel(serviceJobs);
}

// ─── Helper: สร้าง time buckets (weekly หรือ monthly ตามช่วง) ───
// ★ คืน array ของ {label, startKey, endKey} โดย endKey เป็น exclusive (k < endKey)
// ★ Bucket ล่าสุดรวม "วันนี้" ด้วย (แก้ bug เดิมที่ k < now ทำให้ข้อมูลวันนี้หาย)
function buildTimeBuckets(months) {
  const buckets = [];
  const now = new Date();
  const useMonthly = months >= 12;

  if (useMonthly) {
    // รายเดือน — 12 แท่ง
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({
        label: start.toLocaleDateString("th-TH", { month: "short", year: "2-digit" }),
        startKey: dateBkk(start),
        endKey:   dateBkk(end),
      });
    }
  } else {
    // รายสัปดาห์ — 3 เดือน ≈ 13 แท่ง, 6 เดือน ≈ 26 แท่ง
    const weeks = Math.ceil(months * 4.35);
    for (let i = weeks - 1; i >= 0; i--) {
      // ★ +1 เพื่อให้ bucket ล่าสุดรวมวันนี้ (เดิม end = now ทำให้วันนี้หลุด)
      const start = new Date(now); start.setDate(start.getDate() - (i + 1) * 7 + 1);
      const end   = new Date(now); end.setDate(end.getDate()   - i * 7 + 1);
      buckets.push({
        label: `${start.getDate()}/${start.getMonth() + 1}`,
        startKey: dateBkk(start),
        endKey:   dateBkk(end),
      });
    }
  }
  return buckets;
}

// ─── Panel 1: ยอดขายตามสินค้า (donut) ───
function renderSalesByProductPanel(allSales, webOrders) {
  const months = _panelRange.salesByProduct;
  const salesIn = filterByMonths(allSales, "created_at", months);
  const productMap = {};
  salesIn.forEach(s => {
    try {
      const items = typeof s.items === "string" ? JSON.parse(s.items) : (s.items || []);
      items.forEach(item => {
        const key = item.name || item.product_name || "สินค้า";
        const rev = Number(item.line_total || item.total || 0);
        productMap[key] = (productMap[key] || 0) + rev;
      });
    } catch(e) { console.warn("[dashboard] productMap sale.items parse failed:", e, "sale id:", s?.id); }
  });
  // รวมออเดอร์จากเว็บด้วย (ถ้าเดือนอยู่ในช่วง)
  const webIn = filterByMonths(webOrders, "created_at", months);
  webIn.forEach(j => {
    const key = (j.sub_service || j.description || "ออเดอร์เว็บ").slice(0, 40);
    productMap[key] = (productMap[key] || 0) + Number(j.total_cost || 0);
  });

  const sorted = Object.entries(productMap).sort((a,b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const othersSum = sorted.slice(8).reduce((s,x) => s + x[1], 0);
  const labels = top.map(x => x[0]).concat(othersSum > 0 ? ["อื่นๆ"] : []);
  const values = top.map(x => x[1]).concat(othersSum > 0 ? [othersSum] : []);
  const colors = labels.map((_, i) => i < 8 ? BLUE_PALETTE[i] : "#cbd5e1");
  const total = values.reduce((s,v) => s + v, 0);

  const totalEl = document.getElementById("pro-sbp-total");
  if (totalEl) totalEl.textContent = money(total);

  const legendEl = document.getElementById("pro-sbp-legend");
  if (legendEl) {
    legendEl.innerHTML = labels.map((lb, i) => `
      <div class="pro-legend-row">
        <span class="pro-dot" style="background:${colors[i]}"></span>
        <span class="name">${escapeHtml(lb)}</span>
        <span class="val">${moneyShort(values[i])}</span>
      </div>`).join("") || '<div style="color:#94a3b8;font-size:12px">ยังไม่มีข้อมูล</div>';
  }

  const canvas = document.getElementById("salesByProductChart");
  if (!canvas) return;
  if (salesByProductChart) { salesByProductChart.destroy(); salesByProductChart = null; }
  salesByProductChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.raw)}` } } }
    }
  });
}

// ─── Panel 2: สรุปยอดเก็บเงิน (bar — weekly ≤ 6 เดือน, monthly = 12 เดือน) ───
function renderRevenueBarPanel(allSales, webOrders) {
  const months = _panelRange.revenueBar;
  const buckets = buildTimeBuckets(months);
  const labels = buckets.map(b => b.label);
  const collected = [];
  const total = [];

  buckets.forEach(({ startKey, endKey }) => {
    const inBucket = (k) => k >= startKey && k < endKey;
    // Phase 89.28: dateBkk(...) convert UTC → BKK ก่อนเทียบ bucket
    const bkSales = allSales.filter(s => inBucket(dateBkk(s.created_at)));
    const bkWeb   = webOrders.filter(j => inBucket(dateBkk(j.created_at)));
    const salesRev = bkSales.reduce((s,x) => s + Number(x.total_amount||0), 0);
    // web orders ที่ status = delivered/closed/done ถือว่าเก็บเงินแล้ว, pending/progress ยังไม่ได้เก็บ
    const webCollected = bkWeb.filter(j => ["delivered","closed","done"].includes(j.status)).reduce((s,x) => s + Number(x.total_cost||0), 0);
    const webTotal = bkWeb.reduce((s,x) => s + Number(x.total_cost||0), 0);
    collected.push(salesRev + webCollected);
    total.push(salesRev + webTotal);
  });

  const sumCollected = collected.reduce((s,v) => s + v, 0);
  const sumTotal = total.reduce((s,v) => s + v, 0);
  const cEl = document.getElementById("pro-rev-collected"); if (cEl) cEl.textContent = money(sumCollected);
  const tEl = document.getElementById("pro-rev-total"); if (tEl) tEl.textContent = money(sumTotal);

  const canvas = document.getElementById("revenueBarChart");
  if (!canvas) return;
  if (revenueBarChart) { revenueBarChart.destroy(); revenueBarChart = null; }
  revenueBarChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label:"รายได้รวม", data: total, backgroundColor:"#cbd5e1", borderRadius: 4 },
        { label:"เก็บเงินแล้ว", data: collected, backgroundColor:"#0284c7", borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}` } } },
      scales: { x: { stacked: false, ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => moneyShort(v) } } }
    }
  });
}

// ─── Panel 3: ค่าใช้จ่ายตามหมวดหมู่ (donut pink) ───
function renderExpenseDonutPanel(expenses) {
  const months = _panelRange.expenseDonut;
  const expIn = filterByMonths(expenses, "expense_date", months);
  const catMap = {};
  expIn.forEach(e => {
    const cat = e.category || "อื่นๆ";
    catMap[cat] = (catMap[cat] || 0) + Number(e.amount || 0);
  });
  const sorted = Object.entries(catMap).sort((a,b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const othersSum = sorted.slice(8).reduce((s,x) => s + x[1], 0);
  const labels = top.map(x => x[0]).concat(othersSum > 0 ? ["อื่นๆ"] : []);
  const values = top.map(x => x[1]).concat(othersSum > 0 ? [othersSum] : []);
  const colors = labels.map((_, i) => i < 8 ? PINK_PALETTE[i] : "#cbd5e1");
  const total = values.reduce((s,v) => s + v, 0);

  const totalEl = document.getElementById("pro-exp-total");
  if (totalEl) totalEl.textContent = money(total);
  const legendEl = document.getElementById("pro-exp-legend");
  if (legendEl) {
    legendEl.innerHTML = labels.map((lb, i) => `
      <div class="pro-legend-row">
        <span class="pro-dot" style="background:${colors[i]}"></span>
        <span class="name">${escapeHtml(lb)}</span>
        <span class="val">${moneyShort(values[i])}</span>
      </div>`).join("") || '<div style="color:#94a3b8;font-size:12px">ยังไม่มีข้อมูล</div>';
  }

  const canvas = document.getElementById("expenseDonutChart");
  if (!canvas) return;
  if (expenseDonutChart) { expenseDonutChart.destroy(); expenseDonutChart = null; }
  expenseDonutChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.raw)}` } } }
    }
  });
}

// ─── Panel 4: สรุปยอดชำระเงิน (bar pink — weekly ≤ 6 เดือน, monthly = 12 เดือน) ───
function renderPaymentBarPanel(expenses) {
  const months = _panelRange.paymentBar;
  const buckets = buildTimeBuckets(months);
  const labels = buckets.map(b => b.label);
  const paid = [];
  const total = [];

  buckets.forEach(({ startKey, endKey }) => {
    const inBucket = (k) => k >= startKey && k < endKey;
    const bkExp = expenses.filter(e => inBucket(String(e.expense_date||"").slice(0,10)));
    // ถือว่า expense ที่ payment_method มีค่า = ชำระแล้ว (ถ้าไม่มีข้อมูล ถือว่าจ่ายแล้วทั้งหมดเพราะบันทึกแล้ว)
    const bkPaid = bkExp.filter(e => !e.unpaid && e.payment_method !== "pending").reduce((s,x) => s + Number(x.amount||0), 0);
    const bkTotal = bkExp.reduce((s,x) => s + Number(x.amount||0), 0);
    paid.push(bkPaid);
    total.push(bkTotal);
  });

  const sumPaid = paid.reduce((s,v) => s + v, 0);
  const sumTotal = total.reduce((s,v) => s + v, 0);
  const pEl = document.getElementById("pro-pay-collected"); if (pEl) pEl.textContent = money(sumPaid);
  const tEl = document.getElementById("pro-pay-total"); if (tEl) tEl.textContent = money(sumTotal);

  const canvas = document.getElementById("paymentBarChart");
  if (!canvas) return;
  if (paymentBarChart) { paymentBarChart.destroy(); paymentBarChart = null; }
  paymentBarChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label:"ค่าใช้จ่ายรวม", data: total, backgroundColor:"#cbd5e1", borderRadius: 4 },
        { label:"ชำระแล้ว", data: paid, backgroundColor:"#be185d", borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}` } } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => moneyShort(v) } } }
    }
  });
}

// ─── Bonus Panel: งานช่างตามสถานะ (horizontal bar) ───
function renderJobStatusPanel(serviceJobs) {
  const months = _panelRange.jobStatus;
  const jobsAll = serviceJobs.filter(j =>
    !(j.sub_service || "").includes("สั่งซื้อ") &&
    !/^SH-/.test(j.note || "") &&
    !(j.note || "").includes("[ลบแล้ว]")
  );
  const jobsIn = filterByMonths(jobsAll, "created_at", months);
  const counts = {};
  jobsIn.forEach(j => {
    const s = j.status || "pending";
    const key = ["in_progress"].includes(s) ? "progress" : s;
    counts[key] = (counts[key] || 0) + 1;
  });
  const order = ["pending","progress","done","delivered","closed","cancelled"];
  const labels = order.filter(s => counts[s] > 0).map(s => JOB_STATUS_LABELS[s] || s);
  const values = order.filter(s => counts[s] > 0).map(s => counts[s]);
  const colors = order.filter(s => counts[s] > 0).map(s => JOB_STATUS_COLORS[s] || "#9ca3af");
  const total = values.reduce((s,v) => s + v, 0);

  const tEl = document.getElementById("pro-job-total"); if (tEl) tEl.textContent = total.toLocaleString("th-TH") + " งาน";

  const canvas = document.getElementById("jobStatusChart");
  if (!canvas) return;
  if (jobStatusChart) { jobStatusChart.destroy(); jobStatusChart = null; }
  jobStatusChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw} งาน` } } },
      scales: { x: { ticks: { precision: 0 } } }
    }
  });
}

import { escHtml as escapeHtml } from "./utils.js";

// ─── Chart ───
// ★ Phase 396: line chart แนวโน้ม "รายได้" vs "ค่าใช้จ่าย" ตามเดือนที่มีข้อมูลจริง (full-width)
function renderChart(sales, expenses) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("salesChart");
  if (!canvas) return;
  const months = _trendMonths(sales, expenses);   // เดือนจริงเท่านั้น (ไม่ใช่ rolling 12 มีเดือนว่าง)
  // ★ Cleanup: destroy existing chart and set to null before creating new one
  if (salesChart) { salesChart.destroy(); salesChart = null; }
  if (months.length === 0) return;   // empty-state แสดงใน markup แทน canvas
  const labels = months.map(m => { const d = new Date(m + "-01"); return d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" }); });
  // Phase 89.28: dateBkk(created_at) → ปี-เดือน ใน BKK · NaN-safe (Number(...||0))
  const incomeData = months.map(m => (Array.isArray(sales) ? sales : []).filter(s => s?.created_at && dateBkk(s.created_at).slice(0,7) === m).reduce((sum,s)=>sum+Number(s.total_amount||0),0));
  const expenseData = months.map(m => (Array.isArray(expenses) ? expenses : []).filter(e => String(e?.expense_date||"").slice(0,7) === m).reduce((sum,e)=>sum+Number(e.amount||0),0));
  salesChart = new Chart(canvas, {
    type:"line",
    data:{ labels, datasets:[
      { label:"รายได้",     data:incomeData,  borderColor:"#0284c7", backgroundColor:"rgba(2,132,199,.08)", fill:true, tension:0.3, pointRadius:3, borderWidth:2 },
      { label:"ค่าใช้จ่าย", data:expenseData, borderColor:"#ef4444", backgroundColor:"rgba(239,68,68,.08)",  fill:true, tension:0.3, pointRadius:3, borderWidth:2 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true } }, scales:{ y:{ ticks:{ callback:v=>moneyShort(v) } } } }
  });
}

// ─── Auto send daily summary at 22:00 via LINE Notify ───
let _dailySummaryTimer = null;
function setupDailySummaryTimer(state, sendLineNotify) {
  if (_dailySummaryTimer) clearTimeout(_dailySummaryTimer);
  if (!sendLineNotify) return;
  // Phase 89.27: daily summary คือ company-wide LINE message → admin-only.
  // กัน non-admin session ส่ง summary ที่มี data เฉพาะของตัวเอง (ลวง)
  if (!isAdminProfile(state.profile)) return;

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1); // ถ้าเลย 22:00 แล้วรอวันพรุ่งนี้

  const ms = target - now;
  const sentKey = "bsk_daily_sent_" + todayKey();

  // ★ ถ้าวันนี้ส่งไปแล้วไม่ต้องส่งซ้ำ — wrap ใน try/catch กัน private mode / storage disabled
  try {
    if (localStorage.getItem(sentKey)) return;
  } catch(_e) { /* localStorage ไม่พร้อมใช้ — ข้ามไปรันต่อ */ }

  _dailySummaryTimer = setTimeout(() => {
    // ส่งสรุปยอด
    const today = todayKey();
    // Phase 89.28: dateBkk(created_at) เทียบ today BKK
    const todaySalesArr = (state.sales||[]).filter(s => !(s.note||"").includes("[ลบแล้ว]") && dateBkk(s.created_at) === today);
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
    try { localStorage.setItem(sentKey, "1"); } catch(_e) {}
  }, ms);
}
