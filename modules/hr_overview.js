// ═══════════════════════════════════════════════════════════
//  modules/hr_overview.js — ภาพรวม HR / HR Center (Phase 92.28)
//
//  Read-only dashboard รวม Time Clock + Payroll + Departments + Profiles
//  เห็นภาพในหน้าเดียว: KPI / สิ่งที่ต้องจัดการวันนี้ / สถานะวันนี้ / quick actions
//
//  เฉพาะ admin (RLS เป็นด่านความปลอดภัยจริง — guard ฝั่ง client เป็นแค่ UX)
//
//  ไม่แตะ behavior เดิม:
//    - Time Clock pure helpers (workDateBangkok / timeBangkok / computeRegularOT
//      / shiftHoursFromState / sumRegularOT / profileDisplayName)
//    - ดึง staff_payroll / staff_attendance / profiles / departments ตาม pattern เดิม
//    - ไม่มี mutation, ไม่มี DB schema change
// ═══════════════════════════════════════════════════════════

import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";
import {
  workDateBangkok,
  timeBangkok,
  computeRegularOT,
  shiftHoursFromState,
  sumRegularOT,
  profileDisplayName,
  offlinePendingCount,
} from "./time_clock.js";

const TZ = "Asia/Bangkok";

// ═══════════════════════════════════════════════════════════
//  Pure helpers (testable, no DOM/network)
// ═══════════════════════════════════════════════════════════

/**
 * แปลงรายการ attendance ของพนักงาน 1 คนวันนี้ → สถานะการทำงาน
 * @param {object|null} row - attendance row ล่าสุดของพนักงานวันนี้ (หรือ null ถ้าไม่มี)
 * @param {object} [opts]
 * @param {string} [opts.now] - ISO timestamp ใช้ทดสอบ (default: ตอนนี้)
 * @param {number} [opts.staleHours=14] - กี่ชม. นับว่า session ค้าง (ลืม clock-out)
 * @returns {"not_in"|"working"|"out"|"abnormal"}
 *   - not_in     = ยังไม่ลงเวลาเข้า (row = null)
 *   - working    = clock_in ✓, clock_out ✗ (กำลังทำงาน)
 *   - out        = clock_in ✓, clock_out ✓ (ออกแล้ว)
 *   - abnormal   = session เปิดค้างเกิน staleHours (ลืม clock-out) หรือข้อมูลไม่ครบ
 */
export function classifyAttendanceStatus(row, opts = {}) {
  if (!row) return "not_in";
  const inAt  = row.clock_in_at;
  const outAt = row.clock_out_at;
  if (!inAt) return "abnormal"; // มี row แต่ไม่มี clock_in = ผิดปกติ
  if (outAt) return "out";

  // session ยังเปิดอยู่ — เช็คว่าค้างเกิน staleHours หรือยัง
  const nowMs = opts.now ? new Date(opts.now).getTime() : Date.now();
  const inMs  = new Date(inAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(inMs)) return "working";
  const staleHours = Number.isFinite(opts.staleHours) ? opts.staleHours : 14;
  const elapsedH = (nowMs - inMs) / 3600000;
  if (elapsedH >= staleHours) return "abnormal";
  return "working";
}

/**
 * รวมสรุป KPI จาก dataset ดิบ — สำหรับการ์ดบนสุดของหน้า
 * @param {object} input
 * @param {Array<{id:string, role?:string}>} input.profiles - profiles ที่ filter customer ออกแล้ว
 * @param {Array<object>} input.attendanceToday - staff_attendance ของวันนี้
 * @param {Array<object>} input.attendanceMonth - staff_attendance ของเดือนปัจจุบัน (ปิดงานแล้ว + เปิดอยู่)
 * @param {Array<object>} input.payrollsThisMonth - staff_payroll ของรอบเดือนปัจจุบัน
 * @param {object} [input.shiftOpts] - {startHour, endHour} สำหรับ computeRegularOT
 * @param {number} [input.offlinePending] - count ของ offline queue
 * @returns {object} KPI สรุป
 */
export function aggregateHrKpi(input = {}) {
  const profiles        = Array.isArray(input.profiles) ? input.profiles : [];
  const attendanceToday = Array.isArray(input.attendanceToday) ? input.attendanceToday : [];
  const attendanceMonth = Array.isArray(input.attendanceMonth) ? input.attendanceMonth : [];
  const payrolls        = Array.isArray(input.payrollsThisMonth) ? input.payrollsThisMonth : [];
  const shiftOpts       = input.shiftOpts || undefined;
  const offlinePending  = Number.isFinite(input.offlinePending) ? input.offlinePending : 0;

  const totalStaff   = profiles.length;
  // ใช้ user_id หลายตัวมาเช็คว่าใครเข้าวันนี้แล้ว (distinct)
  const presentSet   = new Set(attendanceToday.filter(r => r?.clock_in_at).map(r => r.user_id));
  const presentToday = presentSet.size;
  const openSessions = attendanceToday.filter(r => r?.clock_in_at && !r?.clock_out_at).length;

  // OT เดือนนี้ — จาก closed sessions เท่านั้น (open ยังคำนวณไม่ครบ)
  const closedMonth = attendanceMonth.filter(r => r?.clock_in_at && r?.clock_out_at);
  const otSum = sumRegularOT(closedMonth, shiftOpts);
  const otHoursMonth = otSum.ot;

  const payrollUnpaid = payrolls.filter(p => !p?.paid_at).length;
  const payrollPaid   = payrolls.filter(p => p?.paid_at).length;
  const payrollTotal  = payrolls.length;
  const payrollUnpaidAmount = payrolls
    .filter(p => !p?.paid_at)
    .reduce((s, p) => s + Number(p?.total_amount || 0), 0);
  const payrollPaidAmount   = payrolls
    .filter(p => p?.paid_at)
    .reduce((s, p) => s + Number(p?.total_amount || 0), 0);

  return {
    totalStaff,
    presentToday,
    openSessions,
    otHoursMonth,
    payrollTotal,
    payrollUnpaid,
    payrollPaid,
    payrollUnpaidAmount,
    payrollPaidAmount,
    offlinePending,
  };
}

/**
 * ตรวจหา exceptions ที่ admin ต้องจัดการ — สำหรับ section "สิ่งที่ต้องจัดการวันนี้"
 *
 * Rules:
 *   - stale_session: session เปิดค้างเกิน staleHours (ลืม clock-out)
 *   - geofence_out:  attendance row ที่ distance_m เกิน radiusM (เข้าหรือออกนอกพื้นที่)
 *   - unpaid_payroll: staff_payroll รอบเดือนปัจจุบันที่ยังไม่จ่าย
 *   - offline_pending: queue ยังค้าง sync (level info)
 *
 * @param {object} input
 * @param {Array<object>} input.attendanceToday
 * @param {Array<object>} input.payrollsThisMonth
 * @param {number}        [input.offlinePending=0]
 * @param {{radiusM:number}|null} [input.geofence] - ใช้เพื่อรู้ radius (null = feature ปิด → ข้าม geofence check)
 * @param {object}        [input.opts]
 * @param {string}        [input.opts.now]
 * @param {number}        [input.opts.staleHours=14]
 * @returns {Array<{kind:string, severity:"high"|"medium"|"low", message:string, userId?:string, refId?:any}>}
 */
export function detectExceptions(input = {}) {
  const attendanceToday   = Array.isArray(input.attendanceToday) ? input.attendanceToday : [];
  const payrollsThisMonth = Array.isArray(input.payrollsThisMonth) ? input.payrollsThisMonth : [];
  const offlinePending    = Number.isFinite(input.offlinePending) ? input.offlinePending : 0;
  const geofence          = input.geofence || null;
  const opts              = input.opts || {};
  const staleHours        = Number.isFinite(opts.staleHours) ? opts.staleHours : 14;
  const nowMs             = opts.now ? new Date(opts.now).getTime() : Date.now();

  const out = [];

  // 1) stale sessions (forgot to clock out)
  for (const r of attendanceToday) {
    if (!r?.clock_in_at || r?.clock_out_at) continue;
    const inMs = new Date(r.clock_in_at).getTime();
    if (!Number.isFinite(inMs) || !Number.isFinite(nowMs)) continue;
    const elapsedH = (nowMs - inMs) / 3600000;
    if (elapsedH >= staleHours) {
      out.push({
        kind: "stale_session",
        severity: "high",
        message: `session เปิดค้าง ${elapsedH.toFixed(1)} ชม. — น่าจะลืมกดออก`,
        userId: r.user_id,
        refId: r.id,
      });
    }
  }

  // 2) geofence violations — เฉพาะถ้าตั้ง geofence ไว้แล้ว
  if (geofence && Number.isFinite(geofence.radiusM)) {
    for (const r of attendanceToday) {
      if (!r) continue;
      const din  = Number(r.clock_in_distance_m);
      const dout = Number(r.clock_out_distance_m);
      if (Number.isFinite(din) && din > geofence.radiusM) {
        out.push({
          kind: "geofence_out",
          severity: "medium",
          message: `ลงเวลาเข้านอกพื้นที่ ${Math.round(din)}m (เกิน ${geofence.radiusM}m)`,
          userId: r.user_id,
          refId: r.id,
        });
      }
      if (Number.isFinite(dout) && dout > geofence.radiusM) {
        out.push({
          kind: "geofence_out",
          severity: "medium",
          message: `ลงเวลาออกนอกพื้นที่ ${Math.round(dout)}m (เกิน ${geofence.radiusM}m)`,
          userId: r.user_id,
          refId: r.id,
        });
      }
    }
  }

  // 3) unpaid payroll
  const unpaid = payrollsThisMonth.filter(p => !p?.paid_at);
  if (unpaid.length > 0) {
    out.push({
      kind: "unpaid_payroll",
      severity: "medium",
      message: `เงินเดือนเดือนนี้ยังไม่จ่าย ${unpaid.length} รายการ`,
      refId: null,
    });
  }

  // 4) offline queue pending
  if (offlinePending > 0) {
    out.push({
      kind: "offline_pending",
      severity: "low",
      message: `Offline queue ค้าง ${offlinePending} record — จะ sync เมื่อกลับมา online`,
      refId: null,
    });
  }

  return out;
}

/**
 * จัดกลุ่ม attendance ของวันนี้แยกตาม user_id — เลือก row ล่าสุด/active ของแต่ละคน
 * @param {Array<object>} attendanceToday
 * @returns {Map<string, object>} user_id → row (เลือก open ก่อน, ถ้าทุกอันปิดเลือก clock_in ใหม่สุด)
 */
export function indexAttendanceByUser(attendanceToday) {
  const map = new Map();
  if (!Array.isArray(attendanceToday)) return map;
  for (const r of attendanceToday) {
    if (!r?.user_id) continue;
    const prev = map.get(r.user_id);
    if (!prev) { map.set(r.user_id, r); continue; }
    // priority: open session ก่อน
    const prevOpen = prev.clock_in_at && !prev.clock_out_at;
    const curOpen  = r.clock_in_at && !r.clock_out_at;
    if (curOpen && !prevOpen) { map.set(r.user_id, r); continue; }
    if (!curOpen && prevOpen) continue;
    // ทั้งคู่เปิดหรือทั้งคู่ปิด → เลือก clock_in_at ใหม่สุด
    const prevMs = new Date(prev.clock_in_at || 0).getTime();
    const curMs  = new Date(r.clock_in_at || 0).getTime();
    if (curMs > prevMs) map.set(r.user_id, r);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════
//  REST helpers (เฉพาะ GET, read-only)
// ═══════════════════════════════════════════════════════════

function _sbHeaders() {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg?.anonKey;
  return {
    apikey: cfg?.anonKey,
    Authorization: "Bearer " + token,
  };
}

function _monthBounds(yyyymm) {
  // yyyymm = "YYYY-MM"; returns { start: "YYYY-MM-01", endExclusive: "YYYY-MM-01" ของเดือนถัดไป }
  const start = yyyymm + "-01";
  const d = new Date(start + "T00:00:00+07:00");
  d.setMonth(d.getMonth() + 1);
  const endExclusive = d.toISOString().slice(0, 10);
  return { start, endExclusive };
}

async function _fetchHrData(today, monthKey) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) throw new Error("ไม่มี SUPABASE_CONFIG");
  const headers = _sbHeaders();
  const { start: monthStart, endExclusive: monthEnd } = _monthBounds(monthKey);

  // profiles_with_email view (fallback profiles)
  const profilesUrl = `${cfg.url}/rest/v1/profiles_with_email?select=*&order=full_name.asc`;
  const profilesFallbackUrl = `${cfg.url}/rest/v1/profiles?select=id,full_name,role,department_id,email&order=full_name.asc`;

  const requests = [
    fetch(profilesUrl, { headers }),
    fetch(`${cfg.url}/rest/v1/departments?select=*&is_active=eq.true&order=sort_order.asc`, { headers }),
    fetch(`${cfg.url}/rest/v1/staff_attendance?select=*&work_date=eq.${encodeURIComponent(today)}&order=clock_in_at.desc`, { headers }),
    fetch(`${cfg.url}/rest/v1/staff_attendance?select=*&work_date=gte.${encodeURIComponent(monthStart)}&work_date=lt.${encodeURIComponent(monthEnd)}&order=clock_in_at.desc&limit=2000`, { headers }),
    fetch(`${cfg.url}/rest/v1/staff_payroll?select=*&period_month=gte.${encodeURIComponent(monthStart)}&period_month=lt.${encodeURIComponent(monthEnd)}&order=period_month.desc`, { headers }),
  ];

  const [pRes0, dRes, attTodayRes, attMonthRes, payRes] = await Promise.all(requests);

  let pRes = pRes0;
  if (!pRes.ok) {
    // fallback: profiles_with_email view ยังไม่มี → ใช้ profiles ตรง
    pRes = await fetch(profilesFallbackUrl, { headers });
  }

  const profilesAll  = pRes.ok ? await pRes.json() : [];
  const departments  = dRes.ok ? await dRes.json() : [];
  const attendanceToday = attTodayRes.ok ? await attTodayRes.json() : [];
  const attendanceMonth = attMonthRes.ok ? await attMonthRes.json() : [];
  const payrolls        = payRes.ok ? await payRes.json() : [];

  // filter customer ออก (เหมือนใน time_clock.js _staffProfiles)
  const profiles = profilesAll.filter(p => p && p.role && p.role !== "customer");

  // ตัวบ่งชี้ NO_TABLE — ถ้า attendance ทั้ง today + month + payroll ล้มทั้งหมด ให้คืน flag
  const errors = {
    profiles: !pRes.ok,
    departments: !dRes.ok,
    attendanceToday: !attTodayRes.ok,
    attendanceMonth: !attMonthRes.ok,
    payrolls: !payRes.ok,
  };

  return { profiles, departments, attendanceToday, attendanceMonth, payrolls, errors };
}

// ═══════════════════════════════════════════════════════════
//  UI helpers
// ═══════════════════════════════════════════════════════════

const NUM_TH = (n) => Number(n || 0).toLocaleString("th-TH");
const MONEY  = (n) => "฿" + Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const HOURS  = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

const ROLE_LABEL_TH = {
  admin:      "ผู้ดูแลระบบ",
  technician: "ช่าง",
  sales:      "พนักงานขาย",
  customer:   "ลูกค้า",
};

const STATUS_META = {
  not_in:   { label: "ยังไม่เข้า",   bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  working:  { label: "กำลังทำงาน",  bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  out:      { label: "ออกแล้ว",     bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  abnormal: { label: "ผิดปกติ",     bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
};

function _statusChip(status) {
  const meta = STATUS_META[status] || STATUS_META.not_in;
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${meta.bg};color:${meta.fg};border:1px solid ${meta.border};font-size:11px;font-weight:700">${escHtml(meta.label)}</span>`;
}

function _kpiCard({ label, value, sub, color, icon }) {
  const c = color || "#0284c7";
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;min-width:0">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${escHtml(label)}</div>
      ${icon ? `<div style="font-size:18px;opacity:.7">${escHtml(icon)}</div>` : ""}
    </div>
    <div style="font-size:24px;font-weight:900;color:${c};line-height:1.1">${escHtml(value)}</div>
    ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${escHtml(sub)}</div>` : ""}
  </div>`;
}

function _alertRow({ severity, message }) {
  const sev = severity === "high" ? { bg: "#fef2f2", fg: "#991b1b", border: "#fca5a5", icon: "🚨" }
            : severity === "medium" ? { bg: "#fff7ed", fg: "#9a3412", border: "#fdba74", icon: "⚠️" }
            : { bg: "#eff6ff", fg: "#1e40af", border: "#93c5fd", icon: "ℹ️" };
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${sev.bg};border:1px solid ${sev.border};border-radius:10px;font-size:13px;color:${sev.fg}">
    <div style="font-size:16px;flex-shrink:0">${sev.icon}</div>
    <div style="flex:1;min-width:0">${escHtml(message)}</div>
  </div>`;
}

function _quickActionBtn(routeId, label, color) {
  // ใช้ data-hr-action เพื่อ delegate handler ไป showRoute(ctx)
  return `<button class="hr-quick-action" data-hr-action="${escHtml(routeId)}" style="padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:${color || '#0284c7'};font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px">${escHtml(label)}</button>`;
}

// ═══════════════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════════════

export async function renderHrOverviewPage(ctx) {
  const { state, showToast, showRoute, requireAdmin } = ctx;
  const container = document.getElementById("page-hr_overview");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "",
      retryId: "",
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "dashboard-cards", count: 6 });

  const today = workDateBangkok();
  const monthKey = today.slice(0, 7); // YYYY-MM
  const shiftOpts = shiftHoursFromState(state);

  let data;
  try {
    data = await _fetchHrData(today, monthKey);
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูล HR ไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "hrRetryBtn",
    });
    document.getElementById("hrRetryBtn")?.addEventListener("click", () => renderHrOverviewPage(ctx));
    return;
  }

  const offlinePending = await offlinePendingCount().catch(() => 0);

  // geofence config (ถ้ามี) — ใช้ตรวจ exceptions อย่างเดียว, ไม่ขอ GPS ในหน้านี้
  const info = state?.storeInfo || {};
  const geofence = (info.shopLat != null && info.shopLng != null && info.shopLat !== "" && info.shopLng !== "")
    ? { radiusM: (Number.isFinite(Number(info.geofenceRadiusM)) && Number(info.geofenceRadiusM) > 0) ? Number(info.geofenceRadiusM) : 200 }
    : null;

  const kpi = aggregateHrKpi({
    profiles: data.profiles,
    attendanceToday: data.attendanceToday,
    attendanceMonth: data.attendanceMonth,
    payrollsThisMonth: data.payrolls,
    shiftOpts,
    offlinePending,
  });

  const exceptions = detectExceptions({
    attendanceToday: data.attendanceToday,
    payrollsThisMonth: data.payrolls,
    offlinePending,
    geofence,
  });

  // index attendance ตาม user_id (สำหรับตารางสถานะวันนี้)
  const attIdx = indexAttendanceByUser(data.attendanceToday);
  const deptMap = new Map();
  for (const d of data.departments) deptMap.set(String(d.id), d);

  // เรียงพนักงาน: คนที่ทำงานอยู่ขึ้นก่อน, แล้ว ออกแล้ว, แล้ว ยังไม่เข้า — เพื่อง่ายต่อ scan
  const rows = data.profiles.map(p => {
    const att = attIdx.get(p.id) || null;
    const status = classifyAttendanceStatus(att);
    const ot = att ? computeRegularOT(att, shiftOpts) : { regular: 0, ot: 0, total: 0 };
    return { profile: p, att, status, ot };
  });
  const ORDER = { working: 0, abnormal: 1, out: 2, not_in: 3 };
  rows.sort((a, b) => {
    const da = ORDER[a.status] ?? 9;
    const db = ORDER[b.status] ?? 9;
    if (da !== db) return da - db;
    return (a.profile.full_name || "").localeCompare(b.profile.full_name || "", "th");
  });

  // ── Render HTML ───────────────────────────────────────────
  const todayTh = new Date(today + "T00:00:00+07:00").toLocaleDateString("th-TH", {
    timeZone: TZ, year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
  const monthTh = new Date(monthKey + "-01T00:00:00+07:00").toLocaleDateString("th-TH", {
    timeZone: TZ, year: "numeric", month: "long"
  });

  const errBanner = (data.errors.attendanceToday || data.errors.attendanceMonth || data.errors.payrolls)
    ? `<div style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 12px;border-radius:10px;font-size:12px;margin-bottom:12px">
        ⚠️ บางตารางโหลดไม่สำเร็จ (RLS / network) — ตัวเลขด้านล่างอาจไม่ครบ
      </div>`
    : "";

  container.innerHTML = `
    <div style="padding:8px;display:flex;flex-direction:column;gap:14px">

      <!-- Header -->
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;padding:6px 2px">
        <div>
          <h2 style="margin:0 0 2px;font-size:20px;color:#0f172a">📊 ภาพรวม HR</h2>
          <div style="font-size:12px;color:#64748b">${escHtml(todayTh)} · กะ ${shiftOpts.startHour.toString().padStart(2,"0")}:00–${shiftOpts.endHour.toString().padStart(2,"0")}:00</div>
        </div>
        <button id="hrRefreshBtn" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#0f172a;font-size:12px;font-weight:700;cursor:pointer">⟳ รีเฟรช</button>
      </div>

      ${errBanner}

      <!-- KPI cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        ${_kpiCard({ label: "พนักงานทั้งหมด", value: NUM_TH(kpi.totalStaff), sub: `${data.departments.length} แผนก`, color: "#0f172a", icon: "👥" })}
        ${_kpiCard({ label: "เข้างานวันนี้", value: NUM_TH(kpi.presentToday) + "/" + NUM_TH(kpi.totalStaff), sub: kpi.totalStaff > 0 ? Math.round((kpi.presentToday / kpi.totalStaff) * 100) + "%" : "—", color: "#0284c7", icon: "🟢" })}
        ${_kpiCard({ label: "ยังไม่ลงเวลาออก", value: NUM_TH(kpi.openSessions), sub: kpi.openSessions > 0 ? "session เปิดอยู่" : "ไม่มีค้าง", color: kpi.openSessions > 0 ? "#ea580c" : "#16a34a", icon: "🕒" })}
        ${_kpiCard({ label: "OT เดือนนี้", value: HOURS(kpi.otHoursMonth) + " ชม.", sub: escHtml(monthTh), color: kpi.otHoursMonth > 0 ? "#ea580c" : "#0f172a", icon: "⏱️" })}
        ${_kpiCard({ label: "Payroll เดือนนี้", value: NUM_TH(kpi.payrollPaid) + "/" + NUM_TH(kpi.payrollTotal), sub: "จ่าย " + MONEY(kpi.payrollPaidAmount) + " · ค้าง " + MONEY(kpi.payrollUnpaidAmount), color: kpi.payrollUnpaid > 0 ? "#ea580c" : "#16a34a", icon: "💰" })}
        ${kpi.offlinePending > 0 ? _kpiCard({ label: "Offline Queue", value: NUM_TH(kpi.offlinePending), sub: "รอ sync", color: "#7c3aed", icon: "📥" }) : ""}
      </div>

      <!-- Alerts -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px">
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px">🛎️ สิ่งที่ต้องจัดการวันนี้</div>
        ${exceptions.length === 0
          ? `<div style="font-size:13px;color:#16a34a;padding:8px 0">✅ ไม่มีรายการต้องจัดการ — ระบบเรียบร้อยดี</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${exceptions.map(e => _alertRow(e)).join("")}</div>`
        }
      </div>

      <!-- Today's Attendance Table -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:0;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-size:14px;font-weight:800;color:#0f172a">🧑‍💼 สถานะพนักงานวันนี้ (${NUM_TH(rows.length)})</div>
          <div style="font-size:11px;color:#64748b">เรียงตามสถานะ</div>
        </div>
        ${rows.length === 0
          ? renderEmpty({ icon: "👥", title: "ยังไม่มีพนักงานในระบบ", message: "เพิ่มพนักงานที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน" })
          : `
          <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:680px">
            <thead style="background:#f8fafc">
              <tr>
                <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">พนักงาน</th>
                <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">แผนก / role</th>
                <th style="padding:10px 14px;text-align:center;font-weight:700;color:#475569">เข้า</th>
                <th style="padding:10px 14px;text-align:center;font-weight:700;color:#475569">ออก</th>
                <th style="padding:10px 14px;text-align:right;font-weight:700;color:#475569">ชม. ทำงาน</th>
                <th style="padding:10px 14px;text-align:right;font-weight:700;color:#475569">OT</th>
                <th style="padding:10px 14px;text-align:center;font-weight:700;color:#475569">สถานะ</th>
                <th style="padding:10px 14px;text-align:center;font-weight:700;color:#475569">action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(({ profile: p, att, status, ot }) => {
                const dept = p.department_id ? deptMap.get(String(p.department_id)) : null;
                const deptName = dept?.name || "—";
                const roleTh = ROLE_LABEL_TH[p.role] || p.role || "—";
                const inT  = att?.clock_in_at  ? timeBangkok(att.clock_in_at)  : "—";
                const outT = att?.clock_out_at ? timeBangkok(att.clock_out_at) : "—";
                const worked = ot.total > 0 ? HOURS(ot.total) : "—";
                const otCell = ot.ot > 0 ? `<span style="color:#ea580c;font-weight:700">${HOURS(ot.ot)}</span>` : "—";
                return `
                  <tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:8px 14px">
                      <div style="font-weight:700;color:#0f172a">${escHtml(profileDisplayName(p))}</div>
                      ${p.email ? `<div style="font-size:11px;color:#64748b">${escHtml(p.email)}</div>` : ""}
                    </td>
                    <td style="padding:8px 14px">
                      <div>${escHtml(deptName)}</div>
                      <div style="font-size:11px;color:#64748b">${escHtml(roleTh)}</div>
                    </td>
                    <td style="padding:8px 14px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(inT)}</td>
                    <td style="padding:8px 14px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(outT)}</td>
                    <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">${escHtml(worked)}</td>
                    <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">${otCell}</td>
                    <td style="padding:8px 14px;text-align:center">${_statusChip(status)}</td>
                    <td style="padding:8px 14px;text-align:center">
                      <button class="hr-row-action" data-hr-action="time_clock" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;font-size:11px;cursor:pointer;color:#0284c7;font-weight:700">🕒 Time Clock</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
          </div>`
        }
      </div>

      <!-- Quick actions -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px">
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px">⚡ Quick actions</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${_quickActionBtn("time_clock", "🕒 ลงเวลาทำงาน", "#0284c7")}
          ${_quickActionBtn("payroll", "💰 รายการเงินเดือน", "#16a34a")}
          ${_quickActionBtn("departments", "🏢 ตั้งค่าแผนก", "#7c3aed")}
          ${_quickActionBtn("payroll_overview", "📊 ภาพรวมเงินเดือน", "#0284c7")}
          ${_quickActionBtn("audit_log", "📜 ประวัติการใช้งาน", "#475569")}
          <button id="hrExportBtn" style="padding:10px 14px;border:1px solid #16a34a;border-radius:10px;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer">📥 Export สรุปวันนี้</button>
        </div>
      </div>

    </div>
  `;

  // ── Bind events ───────────────────────────────────────────
  document.getElementById("hrRefreshBtn")?.addEventListener("click", () => renderHrOverviewPage(ctx));

  container.querySelectorAll("[data-hr-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const route = btn.getAttribute("data-hr-action");
      if (route && typeof showRoute === "function") showRoute(route);
    });
  });

  document.getElementById("hrExportBtn")?.addEventListener("click", async () => {
    try {
      const utilsMod = await import("./utils.js");
      const exportRows = rows.map(({ profile: p, att, status, ot }) => {
        const dept = p.department_id ? deptMap.get(String(p.department_id)) : null;
        return {
          "พนักงาน": profileDisplayName(p),
          "อีเมล": p.email || "",
          "แผนก": dept?.name || "",
          "Role": ROLE_LABEL_TH[p.role] || p.role || "",
          "เข้า": att?.clock_in_at  ? timeBangkok(att.clock_in_at)  : "",
          "ออก": att?.clock_out_at ? timeBangkok(att.clock_out_at) : "",
          "ชม. ทำงาน": ot.total,
          "OT": ot.ot,
          "สถานะ": STATUS_META[status]?.label || status,
        };
      });
      const ok = utilsMod.exportToExcel(`hr_overview_${today}.xlsx`, exportRows, "HR Overview");
      if (ok) showToast?.("📥 Export สำเร็จ"); else showToast?.("ไม่สามารถ Export ได้ (XLSX ยังไม่โหลด)");
    } catch (e) {
      showToast?.("Export ผิดพลาด: " + (e?.message || e));
    }
  });
}
