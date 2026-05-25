// ═══════════════════════════════════════════════════════════
//  modules/hr_overview.js — ภาพรวม HR / HR Center
//
//  Phase 92.28: read-only dashboard รวม Time Clock + Payroll + Departments + Profiles
//  Phase 92.29: polish + filters + actionable alerts
//    - status filter bar เหนือตาราง (in-memory, ไม่ refetch)
//    - role chip สี + status wording "ต้องตรวจสอบ" (จาก "ผิดปกติ")
//    - alert มีปุ่ม action ต่อ route ที่เกี่ยว (event delegation)
//    - row action label dynamic ตาม status (ลงเวลา/จัดการเวลา/ดูเวลา)
//    - KPI Payroll คลิกได้เมื่อมีค้าง
//    - quick actions เรียง + label กระชับ
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
 */
export function classifyAttendanceStatus(row, opts = {}) {
  if (!row) return "not_in";
  const inAt  = row.clock_in_at;
  const outAt = row.clock_out_at;
  if (!inAt) return "abnormal";
  if (outAt) return "out";

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
 */
export function aggregateHrKpi(input = {}) {
  const profiles        = Array.isArray(input.profiles) ? input.profiles : [];
  const attendanceToday = Array.isArray(input.attendanceToday) ? input.attendanceToday : [];
  const attendanceMonth = Array.isArray(input.attendanceMonth) ? input.attendanceMonth : [];
  const payrolls        = Array.isArray(input.payrollsThisMonth) ? input.payrollsThisMonth : [];
  const shiftOpts       = input.shiftOpts || undefined;
  const offlinePending  = Number.isFinite(input.offlinePending) ? input.offlinePending : 0;

  const totalStaff   = profiles.length;
  const presentSet   = new Set(attendanceToday.filter(r => r?.clock_in_at).map(r => r.user_id));
  const presentToday = presentSet.size;
  const openSessions = attendanceToday.filter(r => r?.clock_in_at && !r?.clock_out_at).length;

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

  const unpaid = payrollsThisMonth.filter(p => !p?.paid_at);
  if (unpaid.length > 0) {
    out.push({
      kind: "unpaid_payroll",
      severity: "medium",
      message: `เงินเดือนเดือนนี้ยังไม่จ่าย ${unpaid.length} รายการ`,
      refId: null,
    });
  }

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
 */
export function indexAttendanceByUser(attendanceToday) {
  const map = new Map();
  if (!Array.isArray(attendanceToday)) return map;
  for (const r of attendanceToday) {
    if (!r?.user_id) continue;
    const prev = map.get(r.user_id);
    if (!prev) { map.set(r.user_id, r); continue; }
    const prevOpen = prev.clock_in_at && !prev.clock_out_at;
    const curOpen  = r.clock_in_at && !r.clock_out_at;
    if (curOpen && !prevOpen) { map.set(r.user_id, r); continue; }
    if (!curOpen && prevOpen) continue;
    const prevMs = new Date(prev.clock_in_at || 0).getTime();
    const curMs  = new Date(r.clock_in_at || 0).getTime();
    if (curMs > prevMs) map.set(r.user_id, r);
  }
  return map;
}

/**
 * Phase 92.29: นับจำนวน rows แต่ละ status (สำหรับ filter bar)
 * @param {Array<{status:string}>} rows - rows ที่มี field `status`
 * @returns {{all:number, not_in:number, working:number, out:number, abnormal:number}}
 */
export function countStatusBuckets(rows) {
  const acc = { all: 0, not_in: 0, working: 0, out: 0, abnormal: 0 };
  if (!Array.isArray(rows)) return acc;
  for (const r of rows) {
    acc.all += 1;
    const s = r?.status;
    if (s in acc) acc[s] += 1;
  }
  return acc;
}

/**
 * Phase 92.29: filter rows ตาม status — สำหรับ filter bar (in-memory, no refetch)
 * @param {Array<{status:string}>} rows
 * @param {"all"|"not_in"|"working"|"out"|"abnormal"|string} status
 * @returns {Array} - rows ทั้งหมด ถ้า status="all" หรือไม่รู้จัก, ไม่เช่นนั้น filter
 */
export function filterRowsByStatus(rows, status) {
  if (!Array.isArray(rows)) return [];
  if (!status || status === "all") return rows.slice();
  const allowed = new Set(["not_in", "working", "out", "abnormal"]);
  if (!allowed.has(status)) return rows.slice();
  return rows.filter(r => r?.status === status);
}

/**
 * Phase 92.29: label ของปุ่ม action ในแต่ละ row ตาม status
 *   not_in   → "ลงเวลา"     (admin ช่วยลงให้)
 *   working  → "จัดการเวลา"  (เช่นแก้ clock-in หรือสั่ง clock-out)
 *   abnormal → "จัดการเวลา"  (ต้องตรวจ + แก้)
 *   out      → "ดูเวลา"     (อ่านอย่างเดียว)
 * @param {string} status
 * @returns {{label:string, icon:string, color:string}}
 */
export function rowActionLabel(status) {
  switch (status) {
    case "not_in":   return { label: "ลงเวลา",     icon: "▶️", color: "#0284c7" };
    case "working":  return { label: "จัดการเวลา", icon: "⏱️", color: "#ea580c" };
    case "abnormal": return { label: "จัดการเวลา", icon: "⚠️", color: "#dc2626" };
    case "out":      return { label: "ดูเวลา",     icon: "👁️", color: "#475569" };
    default:         return { label: "ดูเวลา",     icon: "👁️", color: "#475569" };
  }
}

/**
 * Phase 92.29: meta ของ role chip — สีและ label TH
 * @param {string} role
 * @returns {{label:string, bg:string, fg:string, border:string}}
 */
export function roleChipMeta(role) {
  switch (role) {
    case "admin":      return { label: "ผู้ดูแลระบบ",  bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" };
    case "sales":      return { label: "พนักงานขาย",  bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" };
    case "technician": return { label: "ช่าง",        bg: "#dcfce7", fg: "#166534", border: "#86efac" };
    case "customer":   return { label: "ลูกค้า",      bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
    default:           return { label: role || "—",   bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
  }
}

/**
 * Phase 92.29: alert kind → CTA mapping (route + label).
 * ใช้ delegation ที่ container — ไม่มี inline onclick
 * @param {string} kind
 * @returns {{label:string, route:string}|null}
 */
export function alertActionFor(kind) {
  switch (kind) {
    case "stale_session":   return { label: "เปิด Time Clock",   route: "time_clock" };
    case "geofence_out":    return { label: "ตรวจรายการลงเวลา", route: "time_clock" };
    case "unpaid_payroll":  return { label: "ไปจ่ายเงินเดือน",   route: "payroll" };
    case "offline_pending": return { label: "ไป Sync",           route: "time_clock" };
    default:                return null;
  }
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
    pRes = await fetch(profilesFallbackUrl, { headers });
  }

  const profilesAll  = pRes.ok ? await pRes.json() : [];
  const departments  = dRes.ok ? await dRes.json() : [];
  const attendanceToday = attTodayRes.ok ? await attTodayRes.json() : [];
  const attendanceMonth = attMonthRes.ok ? await attMonthRes.json() : [];
  const payrolls        = payRes.ok ? await payRes.json() : [];

  const profiles = profilesAll.filter(p => p && p.role && p.role !== "customer");

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

// Phase 92.29: wording "ผิดปกติ" → "ต้องตรวจสอบ"
const STATUS_META = {
  not_in:   { label: "ยังไม่เข้า",   bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  working:  { label: "กำลังทำงาน",  bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  out:      { label: "ออกแล้ว",     bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  abnormal: { label: "ต้องตรวจสอบ",  bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
};

// Phase 92.29: filter button order
const FILTER_ORDER = [
  { key: "all",      label: "ทั้งหมด"       },
  { key: "not_in",   label: "ยังไม่เข้า"    },
  { key: "working",  label: "กำลังทำงาน"   },
  { key: "out",      label: "ออกแล้ว"      },
  { key: "abnormal", label: "ต้องตรวจสอบ"  },
];

function _statusChip(status) {
  const meta = STATUS_META[status] || STATUS_META.not_in;
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${meta.bg};color:${meta.fg};border:1px solid ${meta.border};font-size:11px;font-weight:700">${escHtml(meta.label)}</span>`;
}

function _roleChip(role) {
  const meta = roleChipMeta(role);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${meta.bg};color:${meta.fg};border:1px solid ${meta.border};font-size:11px;font-weight:700">${escHtml(meta.label)}</span>`;
}

function _kpiCard({ label, value, sub, color, icon, clickRoute }) {
  const c = color || "#0284c7";
  const clickAttrs = clickRoute ? ` class="hr-kpi-card" data-hr-action="${escHtml(clickRoute)}" role="button" tabindex="0" style="cursor:pointer"` : "";
  const baseStyle = "background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;min-width:0";
  return `<div${clickAttrs} style="${baseStyle}${clickRoute ? ';transition:transform .1s ease' : ''}">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${escHtml(label)}</div>
      ${icon ? `<div style="font-size:18px;opacity:.7">${escHtml(icon)}</div>` : ""}
    </div>
    <div style="font-size:24px;font-weight:900;color:${c};line-height:1.1">${escHtml(value)}</div>
    ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${escHtml(sub)}</div>` : ""}
    ${clickRoute ? `<div style="font-size:10px;color:#0284c7;margin-top:6px;font-weight:700">คลิกเพื่อจัดการ →</div>` : ""}
  </div>`;
}

function _alertRow({ kind, severity, message }) {
  const sev = severity === "high" ? { bg: "#fef2f2", fg: "#991b1b", border: "#fca5a5", icon: "🚨" }
            : severity === "medium" ? { bg: "#fff7ed", fg: "#9a3412", border: "#fdba74", icon: "⚠️" }
            : { bg: "#eff6ff", fg: "#1e40af", border: "#93c5fd", icon: "ℹ️" };
  const action = alertActionFor(kind);
  const btnHtml = action
    ? `<button class="hr-alert-action" data-hr-action="${escHtml(action.route)}" style="margin-left:auto;padding:6px 12px;border:1px solid ${sev.border};border-radius:8px;background:#fff;color:${sev.fg};font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">${escHtml(action.label)} →</button>`
    : "";
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${sev.bg};border:1px solid ${sev.border};border-radius:10px;font-size:13px;color:${sev.fg}">
    <div style="font-size:16px;flex-shrink:0">${sev.icon}</div>
    <div style="flex:1;min-width:0">${escHtml(message)}</div>
    ${btnHtml}
  </div>`;
}

function _filterBar(buckets, activeKey) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid #f1f5f9;background:#fafbfc">
    ${FILTER_ORDER.map(f => {
      const isActive = f.key === activeKey;
      const count = buckets[f.key] || 0;
      const bg = isActive ? "#0f172a" : "#fff";
      const fg = isActive ? "#fff"    : "#475569";
      const bd = isActive ? "#0f172a" : "#e2e8f0";
      return `<button class="hr-filter-btn" data-hr-filter="${escHtml(f.key)}" style="padding:6px 12px;border:1px solid ${bd};border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;cursor:pointer">
        ${escHtml(f.label)}
        <span style="margin-left:6px;padding:1px 6px;border-radius:999px;background:${isActive ? 'rgba(255,255,255,.2)' : '#f1f5f9'};color:${isActive ? '#fff' : '#0f172a'};font-size:10px;font-weight:800">${NUM_TH(count)}</span>
      </button>`;
    }).join("")}
  </div>`;
}

function _quickActionBtn(routeId, label, color, opts = {}) {
  const isPrimary = opts.primary;
  const bg = isPrimary ? color : "#fff";
  const fg = isPrimary ? "#fff" : (color || "#0284c7");
  const border = isPrimary ? color : "#e2e8f0";
  return `<button class="hr-quick-action" data-hr-action="${escHtml(routeId)}" style="padding:10px 14px;border:1px solid ${border};border-radius:10px;background:${bg};color:${fg};font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px">${escHtml(label)}</button>`;
}

function _renderTbody(rows, deptMap) {
  if (rows.length === 0) {
    return `<tr><td colspan="8" style="padding:24px 14px;text-align:center;color:#64748b;font-size:13px">
      <div style="font-size:32px;margin-bottom:6px;opacity:.6">🔍</div>
      ไม่มีพนักงานในสถานะที่เลือก
    </td></tr>`;
  }
  return rows.map(({ profile: p, att, status, ot }) => {
    const dept = p.department_id ? deptMap.get(String(p.department_id)) : null;
    const deptName = dept?.name || "—";
    const inT  = att?.clock_in_at  ? timeBangkok(att.clock_in_at)  : "—";
    const outT = att?.clock_out_at ? timeBangkok(att.clock_out_at) : "—";
    const worked = ot.total > 0 ? HOURS(ot.total) : "—";
    const otCell = ot.ot > 0 ? `<span style="color:#ea580c;font-weight:700">${HOURS(ot.ot)}</span>` : "—";
    const action = rowActionLabel(status);
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 14px">
          <div style="font-weight:700;color:#0f172a">${escHtml(profileDisplayName(p))}</div>
          ${p.email ? `<div style="font-size:11px;color:#64748b">${escHtml(p.email)}</div>` : ""}
        </td>
        <td style="padding:8px 14px">
          <div style="font-size:12px;color:#0f172a;margin-bottom:3px">${escHtml(deptName)}</div>
          ${_roleChip(p.role)}
        </td>
        <td style="padding:8px 14px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(inT)}</td>
        <td style="padding:8px 14px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(outT)}</td>
        <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">${escHtml(worked)}</td>
        <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">${otCell}</td>
        <td style="padding:8px 14px;text-align:center">${_statusChip(status)}</td>
        <td style="padding:8px 14px;text-align:center">
          <button class="hr-row-action" data-hr-action="time_clock" style="padding:4px 10px;border:1px solid ${action.color};border-radius:8px;background:#fff;font-size:11px;cursor:pointer;color:${action.color};font-weight:700;white-space:nowrap">${escHtml(action.icon + " " + action.label)}</button>
        </td>
      </tr>
    `;
  }).join("");
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
  const monthKey = today.slice(0, 7);
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

  const attIdx = indexAttendanceByUser(data.attendanceToday);
  const deptMap = new Map();
  for (const d of data.departments) deptMap.set(String(d.id), d);

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

  const buckets = countStatusBuckets(rows);

  // Filter state (in-memory) — default "all"
  let activeFilter = "all";

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

  // KPI Payroll clickable เฉพาะเมื่อมีค้าง
  const payrollClickable = kpi.payrollUnpaid > 0 ? "payroll" : null;

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
        ${_kpiCard({ label: "Payroll เดือนนี้", value: NUM_TH(kpi.payrollPaid) + "/" + NUM_TH(kpi.payrollTotal), sub: "จ่าย " + MONEY(kpi.payrollPaidAmount) + " · ค้าง " + MONEY(kpi.payrollUnpaidAmount), color: kpi.payrollUnpaid > 0 ? "#ea580c" : "#16a34a", icon: "💰", clickRoute: payrollClickable })}
        ${kpi.offlinePending > 0 ? _kpiCard({ label: "Offline Queue", value: NUM_TH(kpi.offlinePending), sub: "รอ sync", color: "#7c3aed", icon: "📥", clickRoute: "time_clock" }) : ""}
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
        <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:14px;font-weight:800;color:#0f172a">🧑‍💼 สถานะพนักงานวันนี้ (${NUM_TH(rows.length)})</div>
          <div style="font-size:11px;color:#64748b">เรียงตามสถานะ</div>
        </div>
        ${rows.length === 0
          ? renderEmpty({ icon: "👥", title: "ยังไม่มีพนักงานในระบบ", message: "เพิ่มพนักงานที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน" })
          : `
          <div id="hrFilterBar">${_filterBar(buckets, activeFilter)}</div>
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
            <tbody id="hrTbody">
              ${_renderTbody(filterRowsByStatus(rows, activeFilter), deptMap)}
            </tbody>
          </table>
          </div>`
        }
      </div>

      <!-- Quick actions (Phase 92.29: reordered + concise labels) -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px">
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px">⚡ Quick actions</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${_quickActionBtn("time_clock",        "🕒 ลงเวลา",        "#0284c7")}
          ${_quickActionBtn("payroll",           "💰 เงินเดือน",     "#16a34a")}
          ${_quickActionBtn("payroll_overview",  "📊 ภาพรวมเงินเดือน", "#0284c7")}
          ${_quickActionBtn("departments",       "🏢 แผนก",          "#7c3aed")}
          ${_quickActionBtn("audit_log",         "📜 ประวัติ",       "#475569")}
          <button id="hrExportBtn" style="padding:10px 14px;border:1px solid #16a34a;border-radius:10px;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer">📥 Export</button>
        </div>
      </div>

    </div>
  `;

  // ── Bind events ───────────────────────────────────────────
  document.getElementById("hrRefreshBtn")?.addEventListener("click", () => renderHrOverviewPage(ctx));

  // Event delegation: any element with data-hr-action navigates via showRoute
  container.addEventListener("click", (ev) => {
    const target = ev.target.closest("[data-hr-action]");
    if (!target || !container.contains(target)) return;
    // skip if the click also matches filter / export — handled separately
    if (target.matches(".hr-filter-btn")) return;
    if (target.id === "hrExportBtn") return;
    const route = target.getAttribute("data-hr-action");
    if (route && typeof showRoute === "function") showRoute(route);
  });

  // Keyboard support for KPI cards (Enter/Space)
  container.querySelectorAll(".hr-kpi-card").forEach(card => {
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        const route = card.getAttribute("data-hr-action");
        if (route && typeof showRoute === "function") showRoute(route);
      }
    });
  });

  // Filter buttons (in-memory, no refetch)
  const filterBarEl = document.getElementById("hrFilterBar");
  const tbodyEl = document.getElementById("hrTbody");
  if (filterBarEl && tbodyEl) {
    filterBarEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".hr-filter-btn");
      if (!btn) return;
      const next = btn.getAttribute("data-hr-filter") || "all";
      if (next === activeFilter) return;
      activeFilter = next;
      // re-render filter bar (to update active styles + counts unchanged)
      filterBarEl.innerHTML = _filterBar(buckets, activeFilter);
      // re-render tbody only
      const filtered = filterRowsByStatus(rows, activeFilter);
      tbodyEl.innerHTML = _renderTbody(filtered, deptMap);
    });
  }

  document.getElementById("hrExportBtn")?.addEventListener("click", async () => {
    try {
      const utilsMod = await import("./utils.js");
      // Export ใช้ rows ตาม activeFilter ปัจจุบัน (เพื่อให้ตรงกับสิ่งที่เห็น)
      const exportSource = filterRowsByStatus(rows, activeFilter);
      const exportRows = exportSource.map(({ profile: p, att, status, ot }) => {
        const dept = p.department_id ? deptMap.get(String(p.department_id)) : null;
        return {
          "พนักงาน": profileDisplayName(p),
          "อีเมล": p.email || "",
          "แผนก": dept?.name || "",
          "Role": roleChipMeta(p.role).label,
          "เข้า": att?.clock_in_at  ? timeBangkok(att.clock_in_at)  : "",
          "ออก": att?.clock_out_at ? timeBangkok(att.clock_out_at) : "",
          "ชม. ทำงาน": ot.total,
          "OT": ot.ot,
          "สถานะ": STATUS_META[status]?.label || status,
        };
      });
      const suffix = activeFilter === "all" ? "" : "_" + activeFilter;
      const ok = utilsMod.exportToExcel(`hr_overview_${today}${suffix}.xlsx`, exportRows, "HR Overview");
      if (ok) showToast?.("📥 Export สำเร็จ"); else showToast?.("ไม่สามารถ Export ได้ (XLSX ยังไม่โหลด)");
    } catch (e) {
      showToast?.("Export ผิดพลาด: " + (e?.message || e));
    }
  });
}
