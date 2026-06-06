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
  // Phase 92.49: attendance punctuality (มาสาย / ออกก่อนเวลา)
  classifyPunctuality,
  attendanceRulesFromState,
  punctualityChipMeta,
  // Phase 92.53: monthly HR report aggregation
  summarizePunctuality,
  // Phase 379: geofence config (read-only) — reuse, ไม่ parse ซ้ำใน hr_overview
  geofenceFromState,
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
 * Phase 379: ประเมินสถานะ GPS ของ attendance row (read-only — ไม่กระทบ logic ลงเวลา)
 * ใช้กับ admin/record เก่าที่ enforcement (377) ไม่ครอบ — ช่วยให้ admin เห็น exception
 * @param {object|null} row - attendance row (มี clock_in_lat, clock_in_distance_m)
 * @param {{lat:number,lng:number,radiusM:number}|null} geofence - จาก geofenceFromState(state)
 * @returns {"na"|"missing"|"outside"|"inside"}
 */
export function classifyGpsStatus(row, geofence) {
  // ไม่ตั้ง geofence หรือไม่มี row → ไม่ประเมิน (ไม่โชว์ chip)
  if (!geofence || !row) return "na";
  const lat = row.clock_in_lat;
  if (lat == null || lat === "") return "missing";
  const dist = Number(row.clock_in_distance_m);
  const radius = Number(geofence.radiusM);
  // มีพิกัด GPS แต่คำนวณระยะ/รัศมีไม่ได้ (non-finite) → ถือว่า "inside" (ไม่ flag เป็น exception เพื่อลด noise; มี GPS แล้ว)
  if (!Number.isFinite(dist) || !Number.isFinite(radius)) return "inside";
  return dist > radius ? "outside" : "inside";
}

/**
 * Phase 379: chip meta สำหรับ GPS exception — โชว์เฉพาะ missing/outside (inside/na → null)
 * shape ใกล้เคียง punctualityChipMeta: { label, bg, fg, border }
 * @param {string} status - ผลจาก classifyGpsStatus
 * @param {object} [opts] - { distanceM, radiusM } สำหรับ label "outside"
 * @returns {{label:string,bg:string,fg:string,border:string}|null}
 */
export function gpsChipMeta(status, opts = {}) {
  if (status === "missing") {
    return { label: "📍 ไม่มี GPS", bg: "#fff7ed", fg: "#9a3412", border: "#fed7aa" };
  }
  if (status === "outside") {
    const d = Math.round(Number(opts.distanceM));
    const r = Math.round(Number(opts.radiusM));
    const dTxt = Number.isFinite(d) ? d : "—";
    const rTxt = Number.isFinite(r) ? r : "—";
    return { label: `📍 นอกรัศมี ${dTxt}ม. (กำหนด ${rTxt}ม.)`, bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
  }
  return null; // inside / na → ไม่โชว์ chip
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

function _profileDate(p, keys) {
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function _profileText(p, keys) {
  for (const k of keys) {
    const v = p?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function _rangePct(value, total) {
  const v = Number(value || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((v / t) * 1000) / 10));
}

/**
 * Phase 92.50: presentation metrics for the executive HR dashboard.
 * Read-only: built from profiles / departments / attendance / payroll / leave rows already fetched.
 */
export function buildHrDashboardMetrics(input = {}) {
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const departments = Array.isArray(input.departments) ? input.departments : [];
  const attendanceMonth = Array.isArray(input.attendanceMonth) ? input.attendanceMonth : [];
  const payrolls = Array.isArray(input.payrolls) ? input.payrolls : [];
  const leaves = Array.isArray(input.leaves) ? input.leaves : [];
  const today = input.today || workDateBangkok();
  const monthKey = input.monthKey || today.slice(0, 7);

  const total = profiles.length;
  const activeProfiles = profiles.filter(p => {
    const s = _profileText(p, ["employment_status", "status", "staff_status"]).toLowerCase();
    return !["resigned", "terminated", "inactive", "ออกแล้ว", "ลาออก"].includes(s);
  });
  const active = activeProfiles.length;
  const resigned = Math.max(0, total - active);

  const employmentText = (p) => _profileText(p, ["employee_type", "employment_type", "staff_type", "contract_type"]).toLowerCase();
  const temporary = activeProfiles.filter(p => /temp|temporary|contract|part|ชั่วคราว|สัญญา/.test(employmentText(p))).length;
  const permanent = Math.max(0, active - temporary);

  const monthStart = `${monthKey}-01`;
  const monthEndDate = new Date(monthStart + "T00:00:00+07:00");
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  const monthEnd = monthEndDate.toLocaleDateString("en-CA", { timeZone: TZ });
  const newThisMonth = profiles.filter(p => {
    const d = _profileDate(p, ["hire_date", "start_date", "joined_at", "created_at"]);
    return d && d >= monthStart && d < monthEnd;
  }).length;

  const deptNameById = new Map(departments.map(d => [String(d.id), d.name || "ไม่ระบุแผนก"]));
  const deptCounts = new Map();
  for (const p of activeProfiles) {
    const key = p.department_id != null && p.department_id !== "" ? String(p.department_id) : "__none__";
    const label = key === "__none__" ? "ไม่ระบุแผนก" : (deptNameById.get(key) || "ไม่ระบุแผนก");
    deptCounts.set(label, (deptCounts.get(label) || 0) + 1);
  }
  const departmentBreakdown = Array.from(deptCounts, ([label, count]) => ({ label, count, pct: _rangePct(count, active || total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"))
    .slice(0, 7);

  const roleCounts = new Map();
  for (const p of activeProfiles) {
    const meta = roleChipMeta(p.role);
    roleCounts.set(meta.label, (roleCounts.get(meta.label) || 0) + 1);
  }
  const roleBreakdown = Array.from(roleCounts, ([label, count]) => ({ label, count, pct: _rangePct(count, active || total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));

  const statusCounts = countStatusBuckets(rows);
  const punctuality = { late: 0, early: 0, missingOut: 0, onTime: 0 };
  for (const r of rows) {
    const s = r?.punc?.status;
    if (s === "late" || s === "late_and_early_leave") punctuality.late += 1;
    if (s === "early_leave" || s === "late_and_early_leave") punctuality.early += 1;
    if (s === "missing_clock_out") punctuality.missingOut += 1;
    if (s === "on_time") punctuality.onTime += 1;
  }

  // Phase 92.51: monthly punctuality per user (top late / มาสายบ่อย) — ต้องส่ง shiftOpts + attendanceRules
  const shiftOpts = input.shiftOpts || null;
  const attendanceRules = input.attendanceRules || null;
  const monthlyPunctuality = { lateOccurrences: 0, frequentLateCount: 0, topLate: [] };
  if (shiftOpts && attendanceRules) {
    const graceLate = (Number.isFinite(attendanceRules.lateGraceMinutes) && attendanceRules.lateGraceMinutes >= 0) ? attendanceRules.lateGraceMinutes : 15;
    const nameById = new Map(profiles.map(p => [String(p.id), profileDisplayName(p)]));
    const perUser = new Map(); // uid -> { lateCount, totalLateMinutes }
    for (const r of attendanceMonth) {
      if (!r?.clock_in_at || !r?.user_id) continue;
      const pc = classifyPunctuality(r, shiftOpts, {
        lateGraceMinutes: attendanceRules.lateGraceMinutes,
        earlyLeaveGraceMinutes: attendanceRules.earlyLeaveGraceMinutes,
      });
      if (pc.lateMinutes <= graceLate) continue; // นับเฉพาะที่สายเกิน grace (รวม missing_clock_out ที่เข้าสาย)
      const uid = String(r.user_id);
      const cur = perUser.get(uid) || { lateCount: 0, totalLateMinutes: 0 };
      cur.lateCount += 1;
      cur.totalLateMinutes += pc.lateMinutes || 0;
      perUser.set(uid, cur);
      monthlyPunctuality.lateOccurrences += 1;
    }
    monthlyPunctuality.topLate = Array.from(perUser, ([uid, v]) => ({
      userId: uid, name: nameById.get(uid) || "—", lateCount: v.lateCount, totalLateMinutes: v.totalLateMinutes,
    })).sort((a, b) => b.lateCount - a.lateCount || b.totalLateMinutes - a.totalLateMinutes).slice(0, 5);
    monthlyPunctuality.frequentLateCount = Array.from(perUser.values()).filter(v => v.lateCount >= 3).length;
  }

  const attendanceByDate = new Map();
  for (const r of attendanceMonth) {
    if (!r?.work_date || !r?.user_id || !r?.clock_in_at) continue;
    const key = String(r.work_date).slice(0, 10);
    if (!attendanceByDate.has(key)) attendanceByDate.set(key, new Set());
    attendanceByDate.get(key).add(r.user_id);
  }
  const recentAttendance = Array.from(attendanceByDate, ([date, set]) => ({ date, count: set.size }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8)
    .map(d => ({ ...d, pct: _rangePct(d.count, active || total) }));

  const leaveCounts = new Map();
  for (const l of leaves) {
    const label = String(l?.leave_type || "other");
    const days = Number(l?.days_count || 0);
    leaveCounts.set(label, (leaveCounts.get(label) || 0) + (Number.isFinite(days) ? days : 0));
  }
  const leaveBreakdown = Array.from(leaveCounts, ([label, count]) => ({ label, count, pct: _rangePct(count, Math.max(1, Array.from(leaveCounts.values()).reduce((s, n) => s + Number(n || 0), 0))) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const contractSoon = activeProfiles
    .map(p => ({ profile: p, endDate: _profileDate(p, ["contract_end_date", "contract_until", "probation_end_date", "end_date"]) }))
    .filter(x => x.endDate && x.endDate >= today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .slice(0, 5);

  const unpaidPayroll = payrolls.filter(p => !p?.paid_at).length;
  const paidPayroll = payrolls.filter(p => p?.paid_at).length;
  const payrollCoverage = _rangePct(paidPayroll, payrolls.length);
  const turnoverRate = _rangePct(resigned, Math.max(total, 1));

  return {
    total,
    active,
    permanent,
    temporary,
    newThisMonth,
    resigned,
    turnoverRate,
    statusCounts,
    punctuality,
    departmentBreakdown,
    roleBreakdown,
    recentAttendance,
    leaveBreakdown,
    contractSoon,
    pendingLeaves: Number(input.pendingLeaves || 0),
    payrollCoverage,
    unpaidPayroll,
    monthlyPunctuality,
  };
}

/**
 * Phase 92.53: รายงาน HR รายเดือน รวมต่อพนักงาน (read-only, pure)
 * รวม attendance (วันทำงาน/ชม.ปกติ/OT) + punctuality (มาสาย/ออกก่อน) + วันลา(อนุมัติ) ต่อคน
 * ใช้ข้อมูลที่ HR Overview โหลดอยู่แล้ว — ไม่ fetch เพิ่ม ไม่แตะ payroll calc
 * @param {object} input
 * @param {Array} input.profiles
 * @param {Array} input.attendanceMonth - staff_attendance ของเดือน
 * @param {Array} input.leaves          - staff_leaves ของเดือน
 * @param {{startHour:number,endHour:number}} input.shiftOpts
 * @param {{lateGraceMinutes:number,earlyLeaveGraceMinutes:number}} input.attendanceRules
 * @param {Map<string,string>} [input.deptNameById] - id → ชื่อแผนก
 * @returns {{rows:Array, totals:object}}
 */
export function buildMonthlyHrReport(input = {}) {
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const attendanceMonth = Array.isArray(input.attendanceMonth) ? input.attendanceMonth : [];
  const leaves = Array.isArray(input.leaves) ? input.leaves : [];
  const shiftOpts = input.shiftOpts || { startHour: 8, endHour: 17 };
  const rules = input.attendanceRules || { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 };
  const deptNameById = input.deptNameById instanceof Map ? input.deptNameById : new Map();
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const attByUser = new Map();
  for (const r of attendanceMonth) {
    if (!r?.user_id) continue;
    const uid = String(r.user_id);
    if (!attByUser.has(uid)) attByUser.set(uid, []);
    attByUser.get(uid).push(r);
  }
  // วันลา — นับเฉพาะที่อนุมัติแล้ว (มี status) ต่อ user
  const leaveDaysByUser = new Map();
  for (const l of leaves) {
    if (l?.user_id == null) continue;
    const status = String(l?.status || "").toLowerCase();
    if (status && status !== "approved") continue;
    const uid = String(l.user_id);
    const d = Number(l?.days_count || 0);
    leaveDaysByUser.set(uid, (leaveDaysByUser.get(uid) || 0) + (Number.isFinite(d) ? d : 0));
  }

  const rows = profiles.map(p => {
    const uid = String(p.id);
    const userRows = attByUser.get(uid) || [];
    const distinctDays = new Set(userRows.filter(r => r.clock_in_at).map(r => String(r.work_date).slice(0, 10)));
    const ot = sumRegularOT(userRows.filter(r => r.clock_out_at), shiftOpts);
    const punc = summarizePunctuality(userRows, shiftOpts, rules);
    return {
      userId: uid,
      name: profileDisplayName(p),
      role: p.role || "",
      department: (p.department_id != null && p.department_id !== "") ? (deptNameById.get(String(p.department_id)) || "—") : "—",
      daysWorked: distinctDays.size,
      regularHours: ot.regular,
      otHours: ot.ot,
      lateCount: punc.late + punc.lateAndEarly,
      lateMinutes: punc.totalLateMinutes,
      earlyLeaveCount: punc.earlyLeave + punc.lateAndEarly,
      earlyLeaveMinutes: punc.totalEarlyLeaveMinutes,
      leaveDays: leaveDaysByUser.get(uid) || 0,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "th"));

  const totals = rows.reduce((t, r) => ({
    employees: t.employees + 1,
    daysWorked: t.daysWorked + r.daysWorked,
    regularHours: round2(t.regularHours + r.regularHours),
    otHours: round2(t.otHours + r.otHours),
    lateCount: t.lateCount + r.lateCount,
    earlyLeaveCount: t.earlyLeaveCount + r.earlyLeaveCount,
    leaveDays: round2(t.leaveDays + r.leaveDays),
  }), { employees: 0, daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0, leaveDays: 0 });

  return { rows, totals };
}

/**
 * Phase 92.55: Timesheet รายคน — daily grid ของพนักงาน 1 คน ในช่วงวันที่ (read-only, pure)
 * 1 แถว/วัน: เข้า(เร็วสุด) · ออก(ช้าสุด) · ชม.ปกติ/OT(รวมทุก session) · สถานะตรงเวลา · notes
 * @param {object} input
 * @param {Array} input.rows - staff_attendance ของ user คนเดียว
 * @param {string} input.fromDate - YYYY-MM-DD
 * @param {string} input.toDate   - YYYY-MM-DD
 * @param {{startHour,endHour}} input.shiftOpts
 * @param {{lateGraceMinutes,earlyLeaveGraceMinutes}} input.attendanceRules
 * @returns {{days:Array, totals:object}}
 */
export function buildEmployeeTimesheet(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const fromDate = input.fromDate, toDate = input.toDate;
  const shiftOpts = input.shiftOpts || { startHour: 8, endHour: 17 };
  const rules = input.attendanceRules || { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const zeroTotals = { daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0 };
  if (!fromDate || !toDate) return { days: [], totals: { ...zeroTotals } };

  const byDate = new Map();
  for (const r of rows) {
    if (!r?.work_date) continue;
    const k = String(r.work_date).slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(r);
  }

  const startT = new Date(fromDate + "T00:00:00+07:00").getTime();
  const endT = new Date(toDate + "T00:00:00+07:00").getTime();
  if (!Number.isFinite(startT) || !Number.isFinite(endT) || endT < startT) return { days: [], totals: { ...zeroTotals } };

  const days = [];
  const totals = { ...zeroTotals };
  for (let t = startT; t <= endT; t += 86400000) {
    const date = new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
    const sessions = (byDate.get(date) || []).filter(s => s.clock_in_at);
    if (sessions.length === 0) {
      days.push({ date, hasData: false, clockIn: null, clockOut: null, regularHours: 0, otHours: 0, open: false, punc: { status: "none", lateMinutes: 0, earlyLeaveMinutes: 0 }, notes: "" });
      continue;
    }
    let earliestIn = null, latestOut = null, anyOpen = false, regSum = 0, otSum = 0;
    const notes = [];
    for (const s of sessions) {
      if (!earliestIn || new Date(s.clock_in_at) < new Date(earliestIn)) earliestIn = s.clock_in_at;
      if (s.clock_out_at) {
        if (!latestOut || new Date(s.clock_out_at) > new Date(latestOut)) latestOut = s.clock_out_at;
      } else { anyOpen = true; }
      const o = computeRegularOT(s, shiftOpts);
      regSum += o.regular; otSum += o.ot;
      if (s.notes) notes.push(s.notes);
    }
    const clockOut = anyOpen ? null : latestOut;
    const punc = classifyPunctuality({ work_date: date, clock_in_at: earliestIn, clock_out_at: clockOut }, shiftOpts, rules);
    const regularHours = round2(regSum), otHours = round2(otSum);
    days.push({ date, hasData: true, clockIn: earliestIn, clockOut, regularHours, otHours, open: anyOpen, punc, notes: notes.join(" · ") });
    totals.daysWorked += 1;
    totals.regularHours += regularHours;
    totals.otHours += otHours;
    if (punc.status === "late" || punc.status === "late_and_early_leave") totals.lateCount += 1;
    if (punc.status === "early_leave" || punc.status === "late_and_early_leave") totals.earlyLeaveCount += 1;
  }
  totals.regularHours = round2(totals.regularHours);
  totals.otHours = round2(totals.otHours);
  return { days, totals };
}

/**
 * Phase 92.56: รายงานระดับแผนก — aggregate per-employee report rows ตามแผนก (read-only, pure)
 * รับ rows จาก buildMonthlyHrReport (มี field department/daysWorked/regularHours/otHours/lateCount/earlyLeaveCount/leaveDays)
 * @param {Array} rows
 * @returns {{rows:Array, totals:object}}
 */
export function buildDepartmentReport(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const byDept = new Map();
  for (const r of list) {
    const key = r?.department || "—";
    if (!byDept.has(key)) byDept.set(key, { department: key, headcount: 0, daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0, leaveDays: 0 });
    const d = byDept.get(key);
    d.headcount += 1;
    d.daysWorked += Number(r?.daysWorked || 0);
    d.regularHours += Number(r?.regularHours || 0);
    d.otHours += Number(r?.otHours || 0);
    d.lateCount += Number(r?.lateCount || 0);
    d.earlyLeaveCount += Number(r?.earlyLeaveCount || 0);
    d.leaveDays += Number(r?.leaveDays || 0);
  }
  const deptRows = Array.from(byDept.values())
    .map(d => ({ ...d, regularHours: round2(d.regularHours), otHours: round2(d.otHours), leaveDays: round2(d.leaveDays) }))
    .sort((a, b) => b.headcount - a.headcount || a.department.localeCompare(b.department, "th"));
  const totals = deptRows.reduce((acc, d) => ({
    departments: acc.departments + 1,
    headcount: acc.headcount + d.headcount,
    daysWorked: acc.daysWorked + d.daysWorked,
    regularHours: round2(acc.regularHours + d.regularHours),
    otHours: round2(acc.otHours + d.otHours),
    lateCount: acc.lateCount + d.lateCount,
    earlyLeaveCount: acc.earlyLeaveCount + d.earlyLeaveCount,
    leaveDays: round2(acc.leaveDays + d.leaveDays),
  }), { departments: 0, headcount: 0, daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0, leaveDays: 0 });
  return { rows: deptRows, totals };
}

/**
 * Phase 92.57: สร้าง HTML สำหรับพิมพ์/บันทึก PDF (browser-native print) — pure, ไม่มี dependency
 * @param {object} input
 * @param {string} input.from - YYYY-MM-DD
 * @param {string} input.to   - YYYY-MM-DD
 * @param {Array} input.employeeRows - report.rows
 * @param {object} input.empTotals   - report.totals
 * @param {Array} input.deptRows      - dept.rows
 * @param {object} input.deptTotals   - dept.totals
 * @param {string} [input.storeName]
 * @param {string} [input.generatedAt] - ข้อความเวลาที่สร้าง (ส่งเข้ามาเพื่อ testable)
 * @returns {string} HTML document เต็ม (auto window.print() onload)
 */
export function buildHrReportPrintHtml(input = {}) {
  const from = input.from || "";
  const to = input.to || "";
  const empRows = Array.isArray(input.employeeRows) ? input.employeeRows : [];
  const empT = input.empTotals || { employees: 0, daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0, leaveDays: 0 };
  const deptRows = Array.isArray(input.deptRows) ? input.deptRows : [];
  const storeName = input.storeName || "Boonsook POS";
  const generatedAt = input.generatedAt || "";
  const num = (n) => Number(n || 0).toLocaleString("th-TH");
  const hrs = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

  const empBody = empRows.length === 0
    ? `<tr><td colspan="8" style="text-align:center;color:#888">ไม่มีข้อมูลในช่วงนี้</td></tr>`
    : empRows.map(r => `<tr>
        <td>${escHtml(r.name)}<div class="sub">${escHtml(r.department || "")}</div></td>
        <td class="r">${num(r.daysWorked)}</td>
        <td class="r">${hrs(r.regularHours)}</td>
        <td class="r">${hrs(r.otHours)}</td>
        <td class="r">${num(r.lateCount)}${r.lateMinutes ? ` (${num(r.lateMinutes)}น)` : ""}</td>
        <td class="r">${num(r.earlyLeaveCount)}</td>
        <td class="r">${r.leaveDays ? num(r.leaveDays) : "–"}</td>
      </tr>`).join("");

  const deptBody = deptRows.map(d => `<tr>
        <td>${escHtml(d.department)}</td>
        <td class="r">${num(d.headcount)}</td>
        <td class="r">${num(d.daysWorked)}</td>
        <td class="r">${hrs(d.regularHours)}</td>
        <td class="r">${hrs(d.otHours)}</td>
        <td class="r">${num(d.lateCount)}</td>
        <td class="r">${d.leaveDays ? num(d.leaveDays) : "–"}</td>
      </tr>`).join("");

  return `<!doctype html><html lang="th"><head><meta charset="utf-8" />
<title>รายงาน HR ${escHtml(from)} - ${escHtml(to)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Sarabun", "TH Sarabun New", system-ui, sans-serif; color: #1a1a1a; margin: 24px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 18px 0 6px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 800; background: #f8fafc; }
  .sub { color: #777; font-size: 10px; }
  .foot { margin-top: 16px; color: #888; font-size: 11px; text-align: right; }
  @media print { body { margin: 0; } @page { margin: 14mm; } button { display: none; } }
</style></head><body onload="window.print()">
  <h1>รายงาน HR — ${escHtml(storeName)}</h1>
  <div class="meta">ช่วงวันที่ ${escHtml(from)} ถึง ${escHtml(to)}${generatedAt ? ` · พิมพ์เมื่อ ${escHtml(generatedAt)}` : ""}</div>

  <h2>สรุปต่อพนักงาน</h2>
  <table>
    <thead><tr><th>พนักงาน</th><th class="r">วันทำงาน</th><th class="r">ปกติ(ชม.)</th><th class="r">OT</th><th class="r">มาสาย</th><th class="r">ออกก่อน</th><th class="r">ลา(วัน)</th></tr></thead>
    <tbody>${empBody}</tbody>
    ${empRows.length > 0 ? `<tfoot><tr><td>รวม ${num(empT.employees)} คน</td><td class="r">${num(empT.daysWorked)}</td><td class="r">${hrs(empT.regularHours)}</td><td class="r">${hrs(empT.otHours)}</td><td class="r">${num(empT.lateCount)}</td><td class="r">${num(empT.earlyLeaveCount)}</td><td class="r">${num(empT.leaveDays)}</td></tr></tfoot>` : ""}
  </table>

  ${deptRows.length > 0 ? `<h2>สรุปตามแผนก</h2>
  <table>
    <thead><tr><th>แผนก</th><th class="r">คน</th><th class="r">วันทำงาน</th><th class="r">ปกติ(ชม.)</th><th class="r">OT</th><th class="r">มาสาย</th><th class="r">ลา(วัน)</th></tr></thead>
    <tbody>${deptBody}</tbody>
  </table>` : ""}

  <div class="foot">Boonsook POS V5 · รายงานสร้างอัตโนมัติ</div>
</body></html>`;
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

  // Phase 92.49: late / early-leave exceptions — เฉพาะเมื่อส่ง shiftOpts + attendanceRules
  // (ไม่ส่ง → ข้าม เพื่อ preserve behavior เดิม). นับเป็นจำนวนคน (dedupe ตาม user)
  const shiftOpts = input.shiftOpts || null;
  const rules     = input.attendanceRules || null;
  if (shiftOpts && rules) {
    const graceLate = (Number.isFinite(rules.lateGraceMinutes) && rules.lateGraceMinutes >= 0) ? rules.lateGraceMinutes : 15;
    const lateUsers  = new Set();
    const earlyUsers = new Set();
    for (const r of attendanceToday) {
      if (!r?.clock_in_at) continue;
      const punc = classifyPunctuality(r, shiftOpts, {
        lateGraceMinutes: rules.lateGraceMinutes,
        earlyLeaveGraceMinutes: rules.earlyLeaveGraceMinutes,
      });
      const uid = r.user_id ?? r.id;
      // late นับจาก lateMinutes เกิน grace — รวม missing_clock_out (เข้าสายแต่ยังไม่ออก ก็ยังสาย)
      if (punc.lateMinutes > graceLate) lateUsers.add(uid);
      // early_leave นับเฉพาะที่ลงเวลาออกแล้ว (status early_leave / late_and_early_leave)
      if (punc.status === "early_leave" || punc.status === "late_and_early_leave") earlyUsers.add(uid);
    }
    if (lateUsers.size > 0) {
      out.push({
        kind: "late_arrivals",
        severity: "low",
        message: `มาสายวันนี้ ${lateUsers.size} คน`,
        refId: null,
      });
    }
    if (earlyUsers.size > 0) {
      out.push({
        kind: "early_leaves",
        severity: "low",
        message: `ออกก่อนเวลาวันนี้ ${earlyUsers.size} คน`,
        refId: null,
      });
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

  // Phase 92.32: pending leave requests (graceful — 0 ถ้าตาราง staff_leaves ยังไม่มี)
  const pendingLeaves = Number.isFinite(input.pendingLeaves) ? input.pendingLeaves : 0;
  if (pendingLeaves > 0) {
    out.push({
      kind: "pending_leaves",
      severity: "medium",
      message: `คำขอลารออนุมัติ ${pendingLeaves} รายการ`,
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
    case "pending_leaves":  return { label: "ไปอนุมัติ",         route: "leave_management" };
    case "late_arrivals":   return { label: "ดูเวลาเข้า-ออก",    route: "time_clock" };
    case "early_leaves":    return { label: "ดูเวลาเข้า-ออก",    route: "time_clock" };
    default:                return null;
  }
}

/**
 * Phase 92.41: KPI kind → route สำหรับ click-through navigation
 *   ทำให้ KPI card ทุกใบใน HR Overview drill-down ไปหน้าที่เกี่ยวข้องได้
 *   (route default จะรับ filter "วันนี้/เดือนปัจจุบัน" ของหน้านั้นเอง — ไม่ต้องส่ง filter ข้ามหน้า)
 *
 * @param {string} kind - "total_staff"|"present_today"|"open_sessions"|"ot_month"|"payroll"|"offline_pending"
 * @returns {string|null} route id หรือ null ถ้า kind ไม่รู้จัก
 */
export function kpiClickRouteFor(kind) {
  switch (kind) {
    case "total_staff":     return "departments";        // ดูพนักงานรวมตามแผนก
    case "present_today":   return "time_clock";         // หน้า Time Clock default = วันนี้
    case "open_sessions":   return "time_clock";         // session ค้างจัดการที่ Time Clock
    case "ot_month":        return "payroll_overview";   // OT รายเดือน รวมใน Payroll Overview
    case "payroll":         return "payroll";            // จัดการ payroll แต่ละ row
    case "offline_pending": return "time_clock";         // sync queue ที่ Time Clock
    default:                return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.30 — Employee drill-down modal helpers (pure)
// ═══════════════════════════════════════════════════════════

/**
 * Phase 92.30: format ระยะ GPS เป็นภาษาคน + ระบุใน/นอกพื้นที่ ถ้ามี radius
 * @param {number|string|null|undefined} distance_m
 * @param {number|null} [radiusM] - ถ้าตั้ง > 0 → เพิ่ม label "ในพื้นที่" / "นอกพื้นที่"
 * @returns {string} "—" ถ้าไม่มีข้อมูล / "120 ม." / "350 ม. (นอกพื้นที่)"
 */
export function formatDistanceLabel(distance_m, radiusM) {
  if (distance_m == null || distance_m === "") return "—";
  const d = Number(distance_m);
  if (!Number.isFinite(d)) return "—";
  const dStr = Math.round(d) + " ม.";
  const r = Number(radiusM);
  if (Number.isFinite(r) && r > 0) {
    return d > r ? `${dStr} (นอกพื้นที่)` : `${dStr} (ในพื้นที่)`;
  }
  return dStr;
}

/**
 * Phase 92.30: group attendance rows เป็น 7 entries (วันนี้ + 6 ก่อนหน้า)
 * เรียงใหม่ → เก่า. วันที่ไม่มี attendance จะมี attendance: []
 * @param {Array<object>} rows - staff_attendance rows ของ user 1 คน
 * @param {string} todayDate - "YYYY-MM-DD" (Bangkok)
 * @returns {Array<{date:string, attendance:Array<object>}>}
 */
export function groupAttendanceLast7Days(rows, todayDate) {
  if (!todayDate || typeof todayDate !== "string") return [];
  const byDate = new Map();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r?.work_date) continue;
      const key = String(r.work_date).slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(r);
    }
  }
  const out = [];
  const baseT = new Date(todayDate + "T00:00:00+07:00").getTime();
  if (!Number.isFinite(baseT)) return [];
  for (let i = 0; i < 7; i++) {
    const dKey = new Date(baseT - i * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
    out.push({ date: dKey, attendance: byDate.get(dKey) || [] });
  }
  return out;
}

/**
 * Phase 92.30: หา payroll ของ profile คนนี้ในรายการ payrolls เดือนปัจจุบัน
 * Match: payroll.employee_id === profile.id (string compare safe)
 * @param {Array<object>} payrolls
 * @param {object|null} profile
 * @returns {object|null} {id, base_salary, overtime, welfare, bonus, commission, deductions, total_amount, paid_at, ...}
 */
export function employeePayrollSummary(payrolls, profile) {
  if (!Array.isArray(payrolls) || !profile?.id) return null;
  const pid = String(profile.id);
  const found = payrolls.find(p => p && String(p.employee_id) === pid);
  if (!found) return null;
  const base = Number(found.base_salary || 0);
  const ot   = Number(found.overtime    || 0);
  const wel  = Number(found.welfare     || 0);
  const bon  = Number(found.bonus       || 0);
  const com  = Number(found.commission  || 0);
  const ded  = Number(found.deductions  || 0);
  const computedTotal = base + ot + wel + bon + com - ded;
  const totalRaw = Number(found.total_amount);
  const total = Number.isFinite(totalRaw) ? totalRaw : computedTotal;
  return {
    id: found.id,
    period_month: found.period_month || null,
    base_salary: base,
    overtime: ot,
    welfare: wel,
    bonus: bon,
    commission: com,
    deductions: ded,
    total_amount: total,
    paid_at: found.paid_at || null,
    payment_method: found.payment_method || null,
    note: found.note || null,
  };
}

/**
 * Phase 92.30: รวมข้อมูล summary สำหรับ modal header — presentation-ready
 * @param {object} input
 * @returns {object}
 */
export function buildEmployeeModalSummary(input = {}) {
  const profile = input.profile || {};
  const att = input.todayAtt || null;
  const ot  = input.todayOt || { regular: 0, ot: 0, total: 0 };
  return {
    userId: profile.id || null,
    name: profileDisplayName(profile),
    email: profile.email || "",
    role: profile.role || "",
    department: input.dept?.name || "—",
    status: input.status || "not_in",
    clockInAt:  att?.clock_in_at  || null,
    clockOutAt: att?.clock_out_at || null,
    regularHours: Number(ot.regular || 0),
    otHours: Number(ot.ot || 0),
    totalHours: Number(ot.total || 0),
    notes: att?.notes || "",
    clockInDistance:  att?.clock_in_distance_m  ?? null,
    clockOutDistance: att?.clock_out_distance_m ?? null,
    radiusM: Number.isFinite(Number(input.radiusM)) ? Number(input.radiusM) : null,
    // Phase 92.49: punctuality (มาสาย / ออกก่อนเวลา) — informational
    punctuality: input.punc || { status: "none", lateMinutes: 0, earlyLeaveMinutes: 0 },
  };
}

/**
 * Phase 92.30: validate tab key — กัน key แปลก ๆ จาก URL/state นอก
 * @param {string} key
 * @param {Array<string>} [validKeys] - default ["today","week","payroll"]
 * @param {string} [fallback="today"]
 * @returns {string}
 */
export function modalTabFor(key, validKeys, fallback = "today") {
  const allowed = (Array.isArray(validKeys) && validKeys.length > 0)
    ? validKeys
    : ["today", "week", "timesheet", "payroll"];
  if (typeof key === "string" && allowed.includes(key)) return key;
  return allowed.includes(fallback) ? fallback : allowed[0];
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.31 — Department/Role filter helpers (pure)
// ═══════════════════════════════════════════════════════════

const KNOWN_ROLES = ["admin", "sales", "technician"];

/**
 * Phase 92.31: filter rows ตาม status + departmentId + role พร้อมกัน
 *
 * @param {Array<{profile:object, status:string}>} rows
 * @param {object} [filters]
 * @param {"all"|"not_in"|"working"|"out"|"abnormal"|string} [filters.status="all"]
 * @param {"__all__"|"__none__"|string} [filters.departmentId="__all__"]
 * @param {"all"|"admin"|"sales"|"technician"|"other"|string} [filters.role="all"]
 * @returns {Array}
 */
export function filterHrRows(rows, filters = {}) {
  if (!Array.isArray(rows)) return [];
  const status = filters.status || "all";
  const dept   = filters.departmentId || "__all__";
  const role   = filters.role || "all";
  return rows.filter(r => {
    // status
    if (status !== "all") {
      const s = r?.status;
      if (s !== status) return false;
    }
    // department
    const did = r?.profile?.department_id;
    if (dept === "__none__") {
      if (did != null && did !== "") return false;
    } else if (dept !== "__all__") {
      if (String(did ?? "") !== String(dept)) return false;
    }
    // role
    if (role !== "all") {
      const rl = r?.profile?.role || "";
      if (role === "other") {
        if (KNOWN_ROLES.includes(rl)) return false;
      } else if (rl !== role) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Phase 92.31: count rows per department_id (key = String(dept.id) หรือ "__none__")
 * @param {Array<{profile:object}>} rows
 * @returns {Map<string, number>}
 */
export function countDepartmentBuckets(rows) {
  const m = new Map();
  m.set("__none__", 0);
  if (!Array.isArray(rows)) return m;
  for (const r of rows) {
    const did = r?.profile?.department_id;
    if (did == null || did === "") {
      m.set("__none__", (m.get("__none__") || 0) + 1);
    } else {
      const key = String(did);
      m.set(key, (m.get(key) || 0) + 1);
    }
  }
  return m;
}

/**
 * Phase 92.31: count rows per role bucket
 * @param {Array<{profile:object}>} rows
 * @returns {{all:number, admin:number, sales:number, technician:number, other:number}}
 */
export function countRoleBuckets(rows) {
  const acc = { all: 0, admin: 0, sales: 0, technician: 0, other: 0 };
  if (!Array.isArray(rows)) return acc;
  for (const r of rows) {
    acc.all += 1;
    const rl = r?.profile?.role || "";
    if (KNOWN_ROLES.includes(rl)) acc[rl] += 1;
    else acc.other += 1;
  }
  return acc;
}

/**
 * Phase 92.31: เช็คว่า filter set เป็น default ทั้งหมดหรือไม่ (สำหรับซ่อนปุ่ม "ล้างตัวกรอง")
 * @param {{status?:string, departmentId?:string, role?:string}|null|undefined} filters
 * @returns {boolean}
 */
export function isDefaultHrFilters(filters) {
  if (!filters) return true;
  const statusOk = !filters.status || filters.status === "all";
  const deptOk   = !filters.departmentId || filters.departmentId === "__all__";
  const roleOk   = !filters.role || filters.role === "all";
  return statusOk && deptOk && roleOk;
}

/**
 * Phase 92.31: format summary label เหนือตาราง
 * "แสดง X จาก Y คน · แผนก: ช่าง · Role: Technician · สถานะ: กำลังทำงาน"
 * @param {object} filters
 * @param {number} totalCount
 * @param {number} filteredCount
 * @param {Array<{id:any,name?:string}>} [departments]
 * @returns {string}
 */
export function filterSummaryLabel(filters, totalCount, filteredCount, departments) {
  const total = Number.isFinite(totalCount) ? totalCount : 0;
  const shown = Number.isFinite(filteredCount) ? filteredCount : 0;
  const parts = [`แสดง ${shown} จาก ${total} คน`];

  const dept = filters?.departmentId || "__all__";
  if (dept === "__none__") {
    parts.push("แผนก: ไม่ระบุแผนก");
  } else if (dept !== "__all__") {
    const found = Array.isArray(departments)
      ? departments.find(d => String(d?.id) === String(dept))
      : null;
    parts.push("แผนก: " + (found?.name || dept));
  }

  const role = filters?.role || "all";
  if (role !== "all") {
    const ROLE_TH = { admin: "Admin", sales: "Sales", technician: "Technician", other: "อื่น ๆ" };
    parts.push("Role: " + (ROLE_TH[role] || role));
  }

  const status = filters?.status || "all";
  if (status !== "all") {
    const STATUS_TH = { not_in: "ยังไม่เข้า", working: "กำลังทำงาน", out: "ออกแล้ว", abnormal: "ต้องตรวจสอบ" };
    parts.push("สถานะ: " + (STATUS_TH[status] || status));
  }

  return parts.join(" · ");
}

/**
 * Phase 92.31: build export filename — sanitize unsafe chars + length cap
 * Returns e.g. "hr_overview_2026-05-26_dept-12_role-technician_working.xlsx"
 * @param {string} today - "YYYY-MM-DD"
 * @param {object} filters
 * @returns {string}
 */
export function buildHrExportFilename(today, filters) {
  // sanitize: remove path separators + Windows-illegal chars + control + collapse
  const safe = (s) => String(s == null ? "" : s)
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const todaySafe = safe(today) || "today";
  const parts = [];
  const dept = filters?.departmentId || "__all__";
  if (dept === "__none__") parts.push("dept-none");
  else if (dept !== "__all__") parts.push("dept-" + safe(dept));

  const role = filters?.role || "all";
  if (role !== "all") parts.push("role-" + safe(role));

  const status = filters?.status || "all";
  if (status !== "all") parts.push(safe(status));

  const suffix = parts.length === 0 ? "all" : parts.join("_");
  let base = `hr_overview_${todaySafe}_${suffix}`;
  if (base.length > 200) base = base.slice(0, 200);
  return base + ".xlsx";
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
    fetch(`${cfg.url}/rest/v1/staff_leaves?select=*&start_date=gte.${encodeURIComponent(monthStart)}&start_date=lt.${encodeURIComponent(monthEnd)}&order=start_date.desc&limit=1000`, { headers }),
  ];

  const [pRes0, dRes, attTodayRes, attMonthRes, payRes, leaveRes] = await Promise.all(requests);

  let pRes = pRes0;
  if (!pRes.ok) {
    pRes = await fetch(profilesFallbackUrl, { headers });
  }

  const profilesAll  = pRes.ok ? await pRes.json() : [];
  const departments  = dRes.ok ? await dRes.json() : [];
  const attendanceToday = attTodayRes.ok ? await attTodayRes.json() : [];
  const attendanceMonth = attMonthRes.ok ? await attMonthRes.json() : [];
  const payrolls        = payRes.ok ? await payRes.json() : [];
  const leaves          = leaveRes.ok ? await leaveRes.json() : [];

  const profiles = profilesAll.filter(p => p && p.role && p.role !== "customer");

  const errors = {
    profiles: !pRes.ok,
    departments: !dRes.ok,
    attendanceToday: !attTodayRes.ok,
    attendanceMonth: !attMonthRes.ok,
    payrolls: !payRes.ok,
    leaves: !leaveRes.ok,
  };

  return { profiles, departments, attendanceToday, attendanceMonth, payrolls, leaves, errors };
}

/**
 * Phase 92.30: ดึง attendance ของ user 1 คนใน range (lazy, สำหรับ modal week tab)
 * @param {string} userId
 * @param {string} fromDate - "YYYY-MM-DD"
 * @param {string} toDate   - "YYYY-MM-DD"
 * @returns {Promise<Array<object>>} - throw ถ้า HTTP error
 */
async function _fetchUserAttendanceRange(userId, fromDate, toDate) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !userId) return [];
  const headers = _sbHeaders();
  const url = `${cfg.url}/rest/v1/staff_attendance?select=*`
    + `&user_id=eq.${encodeURIComponent(userId)}`
    + `&work_date=gte.${encodeURIComponent(fromDate)}`
    + `&work_date=lte.${encodeURIComponent(toDate)}`
    + `&order=clock_in_at.desc&limit=200`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Phase 92.54: ดึง attendance + leaves ตามช่วงวันที่ (สำหรับ Monthly HR report date-range)
 * read-only — profiles/departments ใช้ที่โหลดแล้วใน memory
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate   - YYYY-MM-DD
 * @returns {Promise<{attendance:Array, leaves:Array}>}
 */
async function _fetchReportRange(fromDate, toDate) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) throw new Error("ไม่มี SUPABASE_CONFIG");
  const headers = _sbHeaders();
  const [attRes, leaveRes] = await Promise.all([
    fetch(`${cfg.url}/rest/v1/staff_attendance?select=*&work_date=gte.${encodeURIComponent(fromDate)}&work_date=lte.${encodeURIComponent(toDate)}&order=clock_in_at.desc&limit=5000`, { headers }),
    fetch(`${cfg.url}/rest/v1/staff_leaves?select=*&start_date=gte.${encodeURIComponent(fromDate)}&start_date=lte.${encodeURIComponent(toDate)}&order=start_date.desc&limit=2000`, { headers }),
  ]);
  if (!attRes.ok) throw new Error(`HTTP ${attRes.status}`);
  const attendance = await attRes.json();
  const leaves = leaveRes.ok ? await leaveRes.json() : []; // staff_leaves graceful (ตารางอาจไม่มี)
  return { attendance, leaves };
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

// Phase 92.49: punctuality chip (มาสาย / ออกก่อนเวลา) — "" ถ้าไม่มีข้อมูล
function _puncChip(punc) {
  const meta = punctualityChipMeta(punc);
  if (!meta) return "";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.fg};border:1px solid ${meta.border};font-size:10px;font-weight:700">${escHtml(meta.label)}</span>`;
}

// Phase 379: GPS exception chip (รับ meta จาก gpsChipMeta แล้ว) — "" ถ้าไม่มี exception
function _gpsChip(meta) {
  if (!meta) return "";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.fg};border:1px solid ${meta.border};font-size:10px;font-weight:700">${escHtml(meta.label)}</span>`;
}

function _kpiCard({ label, value, sub, color, icon, clickRoute }) {
  const c = color || "#0284c7";
  // Phase 92.41: aria-label สื่อความหมายแทน inline text ที่เคยมี (UX: 5 ใบ noisy)
  const ariaSummary = clickRoute ? ` aria-label="${escHtml(label + " — " + value + (sub ? " — " + sub : "") + " (เปิดเพื่อจัดการ)")}"` : "";
  const baseStyle = "background:#fff;border:1px solid #eceff6;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,64,.04),0 12px 30px -20px rgba(16,24,64,.16);padding:14px 16px;min-width:0";
  const interactive = clickRoute
    ? ` class="hr-kpi-card" data-hr-action="${escHtml(clickRoute)}" role="button" tabindex="0"${ariaSummary} style="${baseStyle};cursor:pointer"`
    : ` style="${baseStyle}"`;
  return `<div${interactive}>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${escHtml(label)}</div>
      <div style="display:flex;align-items:center;gap:4px">
        ${icon ? `<div style="font-size:18px;opacity:.7">${escHtml(icon)}</div>` : ""}
        ${clickRoute ? `<div aria-hidden="true" style="font-size:14px;color:#0284c7;font-weight:800;line-height:1">›</div>` : ""}
      </div>
    </div>
    <div style="font-size:24px;font-weight:900;color:${c};line-height:1.1">${escHtml(value)}</div>
    ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${escHtml(sub)}</div>` : ""}
  </div>`;
}

function _hrDashMiniCard({ label, value, sub, color = "#0f172a", icon = "" }) {
  return `<div class="hrx-mini-card">
    <div class="hrx-mini-icon" style="color:${color};background:${color}12">${escHtml(icon)}</div>
    <div class="hrx-mini-copy">
      <div class="hrx-mini-label">${escHtml(label)}</div>
      <div class="hrx-mini-value" style="color:${color}">${escHtml(value)}</div>
      ${sub ? `<div class="hrx-mini-sub">${escHtml(sub)}</div>` : ""}
    </div>
  </div>`;
}

function _hrDashPanel(title, body, extra = "") {
  return `<section class="hrx-panel">
    <div class="hrx-panel-head">
      <h3>${escHtml(title)}</h3>
      ${extra ? `<span>${escHtml(extra)}</span>` : ""}
    </div>
    ${body}
  </section>`;
}

function _hrDashBars(items, opts = {}) {
  if (!items.length) return `<div class="hrx-empty">ยังไม่มีข้อมูลสำหรับกราฟนี้</div>`;
  const max = Math.max(1, ...items.map(x => Number(x.count || 0)));
  return `<div class="hrx-bars">
    ${items.map(x => {
      const pct = opts.usePct ? Number(x.pct || 0) : _rangePct(x.count, max);
      return `<div class="hrx-bar-row">
        <div class="hrx-bar-label">${escHtml(x.label)}</div>
        <div class="hrx-bar-track"><span style="width:${Math.max(3, pct)}%"></span></div>
        <div class="hrx-bar-value">${escHtml(NUM_TH(x.count))}</div>
      </div>`;
    }).join("")}
  </div>`;
}

function _hrDashDonut(items) {
  if (!items.length) return `<div class="hrx-empty">ยังไม่มีข้อมูลสำหรับสัดส่วนนี้</div>`;
  const colors = ["#2563eb", "#ec4899", "#f59e0b", "#10b981", "#7c3aed"];
  let cursor = 0;
  const parts = items.map((x, i) => {
    const start = cursor;
    cursor += Number(x.pct || 0);
    return `${colors[i % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return `<div class="hrx-donut-wrap">
    <div class="hrx-donut" style="background:conic-gradient(${parts})"><span>${NUM_TH(items.reduce((s, x) => s + Number(x.count || 0), 0))}</span></div>
    <div class="hrx-legend">
      ${items.map((x, i) => `<div><i style="background:${colors[i % colors.length]}"></i><span>${escHtml(x.label)}</span><b>${NUM_TH(x.count)} (${x.pct}%)</b></div>`).join("")}
    </div>
  </div>`;
}

function _hrDashRecentAttendance(items) {
  if (!items.length) return `<div class="hrx-empty">ยังไม่มีข้อมูลลงเวลารายวันในเดือนนี้</div>`;
  const max = Math.max(1, ...items.map(x => Number(x.count || 0)));
  return `<div class="hrx-vertical-bars">
    ${items.map(x => {
      const pct = _rangePct(x.count, max);
      const label = new Date(x.date + "T00:00:00+07:00").toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "short" });
      return `<div class="hrx-vbar-item">
        <div class="hrx-vbar-value">${NUM_TH(x.count)}</div>
        <div class="hrx-vbar"><span style="height:${Math.max(8, pct)}%"></span></div>
        <div class="hrx-vbar-label">${escHtml(label)}</div>
      </div>`;
    }).join("")}
  </div>`;
}

function _hrDashContractTable(items) {
  if (!items.length) return `<div class="hrx-empty">ยังไม่มีสัญญา/ทดลองงานที่ใกล้ครบกำหนด</div>`;
  return `<div class="hrx-table-wrap"><table class="hrx-table">
    <thead><tr><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>ครบกำหนด</th></tr></thead>
    <tbody>
      ${items.map(x => `<tr>
        <td>${escHtml(profileDisplayName(x.profile))}</td>
        <td>${escHtml(roleChipMeta(x.profile?.role).label)}</td>
        <td>${escHtml(new Date(x.endDate + "T00:00:00+07:00").toLocaleDateString("th-TH", { timeZone: TZ, day:"2-digit", month:"2-digit", year:"numeric" }))}</td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

// Phase 92.51: top late employees this month (มาสายบ่อย)
function _hrDashTopLate(mp) {
  const items = (mp && Array.isArray(mp.topLate)) ? mp.topLate : [];
  if (!items.length) return `<div class="hrx-empty">ไม่มีพนักงานมาสายในเดือนนี้ 🎉</div>`;
  return `<div class="hrx-table-wrap"><table class="hrx-table">
    <thead><tr><th>ชื่อ-สกุล</th><th style="text-align:center">จำนวนครั้ง</th><th style="text-align:right">รวม (นาที)</th></tr></thead>
    <tbody>
      ${items.map(x => `<tr>
        <td>${escHtml(x.name)}${x.lateCount >= 3 ? ' <span style="color:#dc2626;font-size:10px;font-weight:800">●</span>' : ''}</td>
        <td style="text-align:center;font-weight:800;color:${x.lateCount >= 3 ? '#dc2626' : '#92400e'}">${NUM_TH(x.lateCount)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${NUM_TH(x.totalLateMinutes)}</td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

// Phase 92.53: render รายงาน HR รายเดือน รวมต่อพนักงาน
function _renderMonthlyHrReport(report, opts = {}) {
  const rows = report?.rows || [];
  const t = report?.totals || { employees: 0, daysWorked: 0, regularHours: 0, otHours: 0, lateCount: 0, earlyLeaveCount: 0, leaveDays: 0 };
  const from = opts.from || "";
  const to = opts.to || "";
  const loading = !!opts.loading;
  // Phase 92.56: department-level aggregate (จาก rows เดียวกัน)
  const dept = buildDepartmentReport(rows);
  const deptTable = (loading || rows.length === 0) ? "" : `
      <div style="padding:12px 14px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:800;color:#0f172a">🏢 สรุปตามแผนก</div>
        <button id="hrDeptReportExportBtn" style="padding:6px 12px;border:1px solid #7c3aed;border-radius:6px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;cursor:pointer">📥 Export แผนก</button>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:600px">
          <thead style="background:#faf5ff">
            <tr>
              <th style="padding:9px 12px;text-align:left;font-weight:700;color:#475569">แผนก</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">คน</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">วันทำงาน</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">ปกติ (ชม.)</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">OT (ชม.)</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">มาสาย</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;color:#475569">ลา (วัน)</th>
            </tr>
          </thead>
          <tbody>
            ${dept.rows.map(d => `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px 12px;font-weight:700;color:#0f172a">${escHtml(d.department)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${NUM_TH(d.headcount)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${NUM_TH(d.daysWorked)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${HOURS(d.regularHours)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${d.otHours > 0 ? 'color:#ea580c;font-weight:700' : 'color:#cbd5e1'}">${HOURS(d.otHours)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${d.lateCount > 0 ? 'color:#92400e;font-weight:700' : 'color:#cbd5e1'}">${NUM_TH(d.lateCount)}</td>
              <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${d.leaveDays > 0 ? NUM_TH(d.leaveDays) : "—"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  const body = loading
    ? `<tr><td colspan="8" style="padding:24px;text-align:center;color:#64748b">⏳ กำลังโหลดรายงาน...</td></tr>`
    : rows.length === 0
    ? `<tr><td colspan="8" style="padding:20px;text-align:center;color:#94a3b8">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`
    : rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 12px">
          <div style="font-weight:700;color:#0f172a">${escHtml(r.name)}</div>
          <div style="font-size:11px;color:#64748b">${escHtml(r.department)} · ${escHtml(roleChipMeta(r.role).label)}</div>
        </td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${NUM_TH(r.daysWorked)}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${HOURS(r.regularHours)}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${r.otHours > 0 ? 'color:#ea580c;font-weight:700' : 'color:#cbd5e1'}">${HOURS(r.otHours)}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${r.lateCount > 0 ? 'color:#92400e;font-weight:700' : 'color:#cbd5e1'}">${r.lateCount > 0 ? `${NUM_TH(r.lateCount)} (${NUM_TH(r.lateMinutes)}น)` : "0"}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${r.earlyLeaveCount > 0 ? 'color:#92400e;font-weight:700' : 'color:#cbd5e1'}">${r.earlyLeaveCount > 0 ? `${NUM_TH(r.earlyLeaveCount)} (${NUM_TH(r.earlyLeaveMinutes)}น)` : "0"}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${r.leaveDays > 0 ? NUM_TH(r.leaveDays) : "—"}</td>
      </tr>`).join("");
  return `
    <div style="background:#fff;border:1px solid #eceff6;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,64,.04),0 12px 30px -20px rgba(16,24,64,.16);padding:0;overflow:hidden">
      <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:14px;font-weight:800;color:#0f172a">📋 รายงาน HR ตามช่วงวันที่</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <label style="font-size:11px;color:#64748b">จาก</label>
          <input type="date" id="hrReportFrom" value="${escHtml(from)}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px" />
          <label style="font-size:11px;color:#64748b">ถึง</label>
          <input type="date" id="hrReportTo" value="${escHtml(to)}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px" />
          <button id="hrReportSearchBtn" ${loading ? "disabled" : ""} style="padding:6px 12px;border:1px solid #0284c7;border-radius:6px;background:#0284c7;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🔍 ค้นหา</button>
          <button id="hrReportExportBtn" ${loading || rows.length === 0 ? "disabled" : ""} style="padding:6px 12px;border:1px solid #16a34a;border-radius:6px;background:${loading || rows.length === 0 ? '#94a3b8' : '#16a34a'};color:#fff;font-size:12px;font-weight:700;cursor:pointer">📥 Export</button>
          <button id="hrReportPrintBtn" ${loading || rows.length === 0 ? "disabled" : ""} style="padding:6px 12px;border:1px solid #475569;border-radius:6px;background:${loading || rows.length === 0 ? '#94a3b8' : '#475569'};color:#fff;font-size:12px;font-weight:700;cursor:pointer">🖨️ พิมพ์ / PDF</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
          <thead style="background:#f8fafc">
            <tr>
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#475569">พนักงาน</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">วันทำงาน</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">ปกติ (ชม.)</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">OT (ชม.)</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">มาสาย</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">ออกก่อน</th>
              <th style="padding:10px 12px;text-align:right;font-weight:700;color:#475569">ลา (วัน)</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          ${rows.length > 0 ? `<tfoot><tr style="background:#f8fafc;border-top:2px solid #e2e8f0;font-weight:800">
            <td style="padding:10px 12px;color:#0f172a">รวม ${NUM_TH(t.employees)} คน</td>
            <td style="padding:10px 12px;text-align:right">${NUM_TH(t.daysWorked)}</td>
            <td style="padding:10px 12px;text-align:right">${HOURS(t.regularHours)}</td>
            <td style="padding:10px 12px;text-align:right;color:#ea580c">${HOURS(t.otHours)}</td>
            <td style="padding:10px 12px;text-align:right;color:#92400e">${NUM_TH(t.lateCount)}</td>
            <td style="padding:10px 12px;text-align:right;color:#92400e">${NUM_TH(t.earlyLeaveCount)}</td>
            <td style="padding:10px 12px;text-align:right">${NUM_TH(t.leaveDays)}</td>
          </tr></tfoot>` : ""}
        </table>
      </div>
      ${deptTable}
    </div>`;
}

function _renderHrExecutiveDashboard(metrics, { monthTh, todayTh, departments, activeDept, activeRole }) {
  const statusItems = [
    { label: "เข้างานแล้ว", count: metrics.statusCounts.working + metrics.statusCounts.out, pct: _rangePct(metrics.statusCounts.working + metrics.statusCounts.out, metrics.total) },
    { label: "กำลังทำงาน", count: metrics.statusCounts.working, pct: _rangePct(metrics.statusCounts.working, metrics.total) },
    { label: "ออกแล้ว", count: metrics.statusCounts.out, pct: _rangePct(metrics.statusCounts.out, metrics.total) },
    { label: "ยังไม่เข้า", count: metrics.statusCounts.not_in, pct: _rangePct(metrics.statusCounts.not_in, metrics.total) },
    { label: "ต้องตรวจสอบ", count: metrics.statusCounts.abnormal, pct: _rangePct(metrics.statusCounts.abnormal, metrics.total) },
  ];
  const leaveItems = metrics.leaveBreakdown.map(x => ({ ...x, label: {
    sick: "ลาป่วย",
    personal: "ลากิจ",
    vacation: "ลาพักร้อน",
    unpaid: "ไม่รับค่าจ้าง",
    other: "อื่น ๆ",
  }[x.label] || x.label }));

  return `<div class="hrx-dashboard">
    <div class="hrx-hero">
      <div>
        <div class="hrx-eyebrow">HR DASHBOARD</div>
        <h2>ภาพรวมข้อมูลบุคลากร</h2>
        <p>รวมจำนวนพนักงาน การลงเวลา วันลา เงินเดือน และสัญญาที่ต้องติดตามจากข้อมูลจริงในระบบ</p>
        <div class="hrx-benefits">
          <span>ดูข้อมูลแบบ Real-time</span>
          <span>ช่วยวิเคราะห์และตัดสินใจ</span>
          <span>ติดตาม KPI ด้านบุคลากร</span>
          <span>รองรับตัวกรองข้อมูล</span>
        </div>
      </div>
      <div class="hrx-note">
        <strong>ประโยชน์</strong>
        <ul>
          <li>ผู้บริหารเห็นภาพรวมบุคลากรได้ทันที</li>
          <li>ติดตามการลา การลงเวลา และ payroll ค้างจ่าย</li>
          <li>ช่วยวางแผนกำลังคนและงบประมาณ</li>
        </ul>
      </div>
    </div>

    <div class="hrx-toolbar">
      <div><strong>ช่วงข้อมูล</strong><span>${escHtml(monthTh)}</span></div>
      <div><strong>อัปเดต</strong><span>${escHtml(todayTh)}</span></div>
      <div><strong>แผนก</strong><span>${escHtml(activeDept === "__all__" ? "ทุกแผนก" : (departments.find(d => String(d.id) === String(activeDept))?.name || "ไม่ระบุ"))}</span></div>
      <div><strong>ตำแหน่ง</strong><span>${escHtml(activeRole === "all" ? "ทุกตำแหน่ง" : activeRole)}</span></div>
    </div>

    <div class="hrx-mini-grid">
      ${_hrDashMiniCard({ label: "พนักงานทั้งหมด", value: `${NUM_TH(metrics.total)} คน`, sub: `${NUM_TH(metrics.active)} active`, color: "#2563eb", icon: "👥" })}
      ${_hrDashMiniCard({ label: "พนักงานประจำ", value: `${NUM_TH(metrics.permanent)} คน`, sub: `${_rangePct(metrics.permanent, metrics.active)}% ของ active`, color: "#16a34a", icon: "✅" })}
      ${_hrDashMiniCard({ label: "พนักงานชั่วคราว", value: `${NUM_TH(metrics.temporary)} คน`, sub: `${_rangePct(metrics.temporary, metrics.active)}% ของ active`, color: "#f97316", icon: "⏱" })}
      ${_hrDashMiniCard({ label: "พนักงานเข้าใหม่", value: `${NUM_TH(metrics.newThisMonth)} คน`, sub: "เดือนนี้", color: "#7c3aed", icon: "➕" })}
      ${_hrDashMiniCard({ label: "Turnover", value: `${metrics.turnoverRate}%`, sub: `${NUM_TH(metrics.resigned)} คนออก/ไม่ active`, color: metrics.turnoverRate > 8 ? "#dc2626" : "#0f766e", icon: "↪" })}
    </div>

    <div class="hrx-grid-3">
      ${_hrDashPanel("จำนวนพนักงาน แยกตามแผนก", _hrDashBars(metrics.departmentBreakdown))}
      ${_hrDashPanel("สัดส่วนพนักงาน แยกตามตำแหน่ง", _hrDashDonut(metrics.roleBreakdown))}
      ${_hrDashPanel("สถานะการลงเวลาวันนี้", _hrDashBars(statusItems, { usePct: true }))}
    </div>

    <div class="hrx-grid-3">
      ${_hrDashPanel("แนวโน้มคนลงเวลาในเดือนนี้", _hrDashRecentAttendance(metrics.recentAttendance), "8 วันล่าสุด")}
      ${_hrDashPanel("การลาแยกตามประเภท", _hrDashBars(leaveItems, { usePct: true }), `รออนุมัติ ${NUM_TH(metrics.pendingLeaves)}`)}
      ${_hrDashPanel("พนักงานที่ใกล้ครบสัญญา/ทดลองงาน", _hrDashContractTable(metrics.contractSoon))}
    </div>

    <div class="hrx-grid-3">
      ${_hrDashPanel("พนักงานมาสายบ่อย (เดือนนี้)", _hrDashTopLate(metrics.monthlyPunctuality), (metrics.monthlyPunctuality && metrics.monthlyPunctuality.frequentLateCount > 0) ? `${NUM_TH(metrics.monthlyPunctuality.frequentLateCount)} คนสาย ≥3 ครั้ง` : "")}
    </div>

    <div class="hrx-info-grid">
      <div class="hrx-info-card"><h3>KPIs สำคัญใน Dashboard</h3><p>จำนวนพนักงาน, สถานะลงเวลา, การลา, payroll coverage, turnover และสัญญาที่ต้องติดตาม</p></div>
      <div class="hrx-info-card"><h3>ตัวกรองข้อมูล</h3><p>ช่วงเดือนปัจจุบัน, แผนก, ตำแหน่ง และสถานะพนักงานจาก filter เดิมของ HR Overview</p></div>
      <div class="hrx-info-card"><h3>แหล่งข้อมูล</h3><p>Profiles, Departments, Staff Attendance, Staff Payroll และ Staff Leaves ผ่าน Supabase REST</p></div>
    </div>
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
      ไม่พบพนักงานตามตัวกรองนี้
    </td></tr>`;
  }
  return rows.map(({ profile: p, att, status, ot, punc, gpsMeta }) => {
    const dept = p.department_id ? deptMap.get(String(p.department_id)) : null;
    const deptName = dept?.name || "—";
    const inT  = att?.clock_in_at  ? timeBangkok(att.clock_in_at)  : "—";
    const outT = att?.clock_out_at ? timeBangkok(att.clock_out_at) : "—";
    const worked = ot.total > 0 ? HOURS(ot.total) : "—";
    const otCell = ot.ot > 0 ? `<span style="color:#ea580c;font-weight:700">${HOURS(ot.ot)}</span>` : "—";
    const action = rowActionLabel(status);
    // Phase 92.30: row คลิกได้เพื่อเปิด drill-down modal — ปุ่ม action ไม่ถูก row click กิน
    const userId = p.id || "";
    return `
      <tr class="hr-row-employee" data-hr-employee="${escHtml(userId)}" style="border-bottom:1px solid #f1f5f9;cursor:pointer" title="คลิกเพื่อดูรายละเอียดพนักงาน">
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
        <td style="padding:8px 14px;text-align:center">
          ${_statusChip(status)}
          ${punc && punc.status && punc.status !== "none" ? `<div style="margin-top:4px">${_puncChip(punc)}</div>` : ""}
          ${gpsMeta ? `<div style="margin-top:4px">${_gpsChip(gpsMeta)}</div>` : ""}
        </td>
        <td style="padding:8px 14px;text-align:center">
          <button class="hr-row-action" data-hr-action="time_clock" style="padding:4px 10px;border:1px solid ${action.color};border-radius:8px;background:#fff;font-size:11px;cursor:pointer;color:${action.color};font-weight:700;white-space:nowrap">${escHtml(action.icon + " " + action.label)}</button>
        </td>
      </tr>
    `;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.30: Employee modal — UI render helpers
// ═══════════════════════════════════════════════════════════

const MODAL_TABS = [
  { key: "today",     label: "📍 วันนี้"        },
  { key: "week",      label: "📅 7 วันล่าสุด"    },
  { key: "timesheet", label: "🗓️ Timesheet"     },
  { key: "payroll",   label: "💰 เงินเดือน"     },
];

function _formatMonthTh(yyyymmdd) {
  if (!yyyymmdd) return "—";
  try {
    return new Date(String(yyyymmdd).slice(0, 10) + "T00:00:00+07:00")
      .toLocaleDateString("th-TH", { timeZone: TZ, year: "numeric", month: "long" });
  } catch { return "—"; }
}

function _formatDateTh(yyyymmdd) {
  if (!yyyymmdd) return "—";
  try {
    return new Date(yyyymmdd + "T00:00:00+07:00")
      .toLocaleDateString("th-TH", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  } catch { return yyyymmdd; }
}

function _renderModalSummaryHeader(summary) {
  const sc = _statusChip(summary.status);
  const roleChip = _roleChip(summary.role);
  const inT  = summary.clockInAt  ? timeBangkok(summary.clockInAt)  : "—";
  const outT = summary.clockOutAt ? timeBangkok(summary.clockOutAt) : "—";
  return `
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid #f1f5f9;background:linear-gradient(135deg,#f8fafc,#fff)">
      <div style="flex:1;min-width:200px">
        <div style="font-size:20px;font-weight:900;color:#0f172a;line-height:1.2;margin-bottom:6px">${escHtml(summary.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
          ${roleChip}
          <span style="font-size:12px;color:#475569">·</span>
          <span style="font-size:12px;color:#475569">${escHtml(summary.department)}</span>
        </div>
        ${summary.email ? `<div style="font-size:11px;color:#64748b;word-break:break-all">${escHtml(summary.email)}</div>` : ""}
      </div>
      <button id="hrModalClose" aria-label="ปิด" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#475569;font-size:14px;cursor:pointer;flex-shrink:0">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;padding:14px 20px;border-bottom:1px solid #f1f5f9;background:#fafbfc">
      <div>
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">สถานะวันนี้</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">${sc}${_puncChip(summary.punctuality)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">เข้า</div>
        <div style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums">${escHtml(inT)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">ออก</div>
        <div style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums">${escHtml(outT)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">ปกติ / OT (ชม.)</div>
        <div style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums">
          ${HOURS(summary.regularHours)} / <span style="color:${summary.otHours > 0 ? '#ea580c' : '#0f172a'}">${HOURS(summary.otHours)}</span>
        </div>
      </div>
    </div>
  `;
}

function _renderModalTabBar(activeTab) {
  return `<div style="display:flex;border-bottom:1px solid #f1f5f9;background:#fff;overflow-x:auto">
    ${MODAL_TABS.map(t => {
      const isActive = t.key === activeTab;
      return `<button class="hr-modal-tab" data-hr-tab="${escHtml(t.key)}" style="padding:12px 18px;background:transparent;border:none;border-bottom:3px solid ${isActive ? '#0284c7' : 'transparent'};color:${isActive ? '#0284c7' : '#475569'};font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">${escHtml(t.label)}</button>`;
    }).join("")}
  </div>`;
}

function _renderTabToday(summary) {
  const inT  = summary.clockInAt  ? timeBangkok(summary.clockInAt)  : "—";
  const outT = summary.clockOutAt ? timeBangkok(summary.clockOutAt) : "—";
  const inDist  = formatDistanceLabel(summary.clockInDistance,  summary.radiusM);
  const outDist = formatDistanceLabel(summary.clockOutDistance, summary.radiusM);
  const hasGps  = summary.clockInDistance != null || summary.clockOutDistance != null;
  if (summary.status === "not_in") {
    return `<div style="padding:30px 20px;text-align:center;color:#475569;font-size:13px">
      <div style="font-size:36px;margin-bottom:8px;opacity:.7">🛌</div>
      ยังไม่ได้ลงเวลาเข้างานวันนี้
      <div style="margin-top:14px"><button class="hr-modal-route-btn" data-hr-action="time_clock" style="padding:8px 16px;border:1px solid #0284c7;border-radius:8px;background:#0284c7;color:#fff;font-size:12px;font-weight:700;cursor:pointer">▶️ ลงเวลาให้พนักงาน</button></div>
    </div>`;
  }
  return `
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:4px">เวลาเข้า</div>
          <div style="font-size:18px;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums">${escHtml(inT)}</div>
          ${hasGps ? `<div style="font-size:11px;color:#475569;margin-top:3px">${escHtml(inDist)}</div>` : ""}
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:4px">เวลาออก</div>
          <div style="font-size:18px;font-weight:900;color:${summary.status === 'working' || summary.status === 'abnormal' ? '#ea580c' : '#0f172a'};font-variant-numeric:tabular-nums">${escHtml(outT)}</div>
          ${hasGps ? `<div style="font-size:11px;color:#475569;margin-top:3px">${escHtml(outDist)}</div>` : ""}
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:4px">ปกติ / OT / รวม (ชม.)</div>
          <div style="font-size:18px;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums">
            ${HOURS(summary.regularHours)} / <span style="color:${summary.otHours > 0 ? '#ea580c' : '#0f172a'}">${HOURS(summary.otHours)}</span> / ${HOURS(summary.totalHours)}
          </div>
        </div>
      </div>
      ${summary.notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:12px;color:#78350f">📝 ${escHtml(summary.notes)}</div>` : ""}
    </div>
  `;
}

function _renderTabWeek(weekState, shiftOpts) {
  // weekState: { status: "idle"|"loading"|"loaded"|"error", rows: [], error: string|null, today: "YYYY-MM-DD" }
  if (weekState.status === "loading") {
    return `<div style="padding:24px 20px;text-align:center;color:#64748b;font-size:13px">⏳ กำลังโหลด...</div>`;
  }
  if (weekState.status === "error") {
    return `<div style="padding:18px 20px">
      <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px 12px;font-size:12px">
        ⚠️ โหลดประวัติไม่สำเร็จ: ${escHtml(weekState.error || "")}
      </div>
    </div>`;
  }
  const grouped = groupAttendanceLast7Days(weekState.rows, weekState.today);
  // Aggregate week total
  const allClosed = (weekState.rows || []).filter(r => r?.clock_in_at && r?.clock_out_at);
  const weekSum = sumRegularOT(allClosed, shiftOpts);
  return `
    <div style="padding:16px 20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <div style="font-size:13px;color:#475569">รวม 7 วัน: <strong style="color:#0f172a">${HOURS(weekSum.regular)}</strong> ชม. ปกติ · <strong style="color:${weekSum.ot > 0 ? '#ea580c' : '#0f172a'}">${HOURS(weekSum.ot)}</strong> OT · รวม <strong>${HOURS(weekSum.total)}</strong></div>
      </div>
      <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px">
          <thead style="background:#f8fafc">
            <tr>
              <th style="padding:8px 12px;text-align:left;font-weight:700;color:#475569">วัน</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:#475569">เข้า</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:#475569">ออก</th>
              <th style="padding:8px 12px;text-align:right;font-weight:700;color:#475569">ปกติ</th>
              <th style="padding:8px 12px;text-align:right;font-weight:700;color:#475569">OT</th>
              <th style="padding:8px 12px;text-align:left;font-weight:700;color:#475569">notes</th>
            </tr>
          </thead>
          <tbody>
            ${grouped.map(({ date, attendance }) => {
              if (attendance.length === 0) {
                return `<tr style="border-top:1px solid #f1f5f9">
                  <td style="padding:6px 12px;color:#0f172a">${escHtml(_formatDateTh(date))}</td>
                  <td colspan="5" style="padding:6px 12px;color:#94a3b8;font-style:italic">ไม่มีบันทึก</td>
                </tr>`;
              }
              return attendance.map(r => {
                const inT  = r.clock_in_at  ? timeBangkok(r.clock_in_at)  : "—";
                const outT = r.clock_out_at ? timeBangkok(r.clock_out_at) : "—";
                const ot   = computeRegularOT(r, shiftOpts);
                const isOpen = r.clock_in_at && !r.clock_out_at;
                const bg = isOpen ? "#fff7ed" : "transparent"; // open session highlight
                return `<tr style="border-top:1px solid #f1f5f9;background:${bg}">
                  <td style="padding:6px 12px;color:#0f172a">${escHtml(_formatDateTh(date))}${isOpen ? ' <span style="color:#ea580c;font-size:10px;font-weight:700">(open)</span>' : ''}</td>
                  <td style="padding:6px 12px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(inT)}</td>
                  <td style="padding:6px 12px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(outT)}</td>
                  <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums">${ot.regular > 0 ? HOURS(ot.regular) : "—"}</td>
                  <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;${ot.ot > 0 ? 'color:#ea580c;font-weight:700' : ''}">${ot.ot > 0 ? HOURS(ot.ot) : "—"}</td>
                  <td style="padding:6px 12px;color:#475569;font-size:11px">${escHtml(r.notes || "")}</td>
                </tr>`;
              }).join("");
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Phase 92.55: Timesheet tab — daily grid ของพนักงาน (เดือนปัจจุบัน month-to-date)
function _renderTabTimesheet(tsState, shiftOpts, rules) {
  if (!tsState || tsState.status === "idle" || tsState.status === "loading") {
    return `<div style="padding:24px 20px;text-align:center;color:#64748b;font-size:13px">⏳ กำลังโหลด Timesheet...</div>`;
  }
  if (tsState.status === "error") {
    return `<div style="padding:18px 20px"><div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px 12px;font-size:12px">⚠️ โหลด Timesheet ไม่สำเร็จ: ${escHtml(tsState.error || "")}</div></div>`;
  }
  const ts = buildEmployeeTimesheet({ rows: tsState.rows, fromDate: tsState.fromDate, toDate: tsState.toDate, shiftOpts, attendanceRules: rules });
  const t = ts.totals;
  const body = ts.days.map(d => {
    if (!d.hasData) {
      return `<tr style="border-top:1px solid #f1f5f9">
        <td style="padding:6px 12px;color:#0f172a">${escHtml(_formatDateTh(d.date))}</td>
        <td colspan="5" style="padding:6px 12px;color:#94a3b8;font-style:italic">ไม่มีบันทึก</td>
      </tr>`;
    }
    const bg = d.open ? "#fff7ed" : "transparent";
    return `<tr style="border-top:1px solid #f1f5f9;background:${bg}">
      <td style="padding:6px 12px;color:#0f172a">${escHtml(_formatDateTh(d.date))}${d.open ? ' <span style="color:#ea580c;font-size:10px;font-weight:700">(open)</span>' : ''}</td>
      <td style="padding:6px 12px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(d.clockIn ? timeBangkok(d.clockIn) : "—")}</td>
      <td style="padding:6px 12px;text-align:center;font-variant-numeric:tabular-nums">${escHtml(d.clockOut ? timeBangkok(d.clockOut) : "—")}</td>
      <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums">${d.regularHours > 0 ? HOURS(d.regularHours) : "—"}</td>
      <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;${d.otHours > 0 ? 'color:#ea580c;font-weight:700' : ''}">${d.otHours > 0 ? HOURS(d.otHours) : "—"}</td>
      <td style="padding:6px 12px">${_puncChip(d.punc) || '<span style="color:#cbd5e1">—</span>'}</td>
    </tr>`;
  }).join("");
  return `
    <div style="padding:16px 20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <div style="font-size:13px;color:#475569">${escHtml(_formatDateTh(tsState.fromDate))} – ${escHtml(_formatDateTh(tsState.toDate))}</div>
        <div style="font-size:12px;color:#475569">ทำงาน <strong style="color:#0f172a">${NUM_TH(t.daysWorked)}</strong> วัน · ปกติ <strong>${HOURS(t.regularHours)}</strong> · OT <strong style="color:${t.otHours > 0 ? '#ea580c' : '#0f172a'}">${HOURS(t.otHours)}</strong> · สาย <strong style="color:#92400e">${NUM_TH(t.lateCount)}</strong> · ออกก่อน <strong style="color:#92400e">${NUM_TH(t.earlyLeaveCount)}</strong></div>
      </div>
      <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px">
          <thead style="background:#f8fafc">
            <tr>
              <th style="padding:8px 12px;text-align:left;font-weight:700;color:#475569">วัน</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:#475569">เข้า</th>
              <th style="padding:8px 12px;text-align:center;font-weight:700;color:#475569">ออก</th>
              <th style="padding:8px 12px;text-align:right;font-weight:700;color:#475569">ปกติ</th>
              <th style="padding:8px 12px;text-align:right;font-weight:700;color:#475569">OT</th>
              <th style="padding:8px 12px;text-align:left;font-weight:700;color:#475569">สถานะ</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

function _renderTabPayroll(payrollSummary) {
  if (!payrollSummary) {
    return `<div style="padding:30px 20px;text-align:center;color:#475569;font-size:13px">
      <div style="font-size:36px;margin-bottom:8px;opacity:.7">💸</div>
      ยังไม่มีรายการเงินเดือนของพนักงานคนนี้ในเดือนนี้
      <div style="margin-top:14px"><button class="hr-modal-route-btn" data-hr-action="payroll" style="padding:8px 16px;border:1px solid #16a34a;border-radius:8px;background:#16a34a;color:#fff;font-size:12px;font-weight:700;cursor:pointer">+ เพิ่มรายการเงินเดือน</button></div>
    </div>`;
  }
  const periodTh = _formatMonthTh(payrollSummary.period_month);
  const paid = !!payrollSummary.paid_at;
  const paidChipBg     = paid ? "#dcfce7" : "#fff7ed";
  const paidChipFg     = paid ? "#166534" : "#9a3412";
  const paidChipBorder = paid ? "#86efac" : "#fdba74";
  const paidLabel      = paid ? "✓ ชำระแล้ว" : "⏳ ยังไม่ชำระ";
  return `
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:13px;color:#475569">รอบ <strong style="color:#0f172a">${escHtml(periodTh)}</strong></div>
        <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${paidChipBg};color:${paidChipFg};border:1px solid ${paidChipBorder};font-size:11px;font-weight:700">${escHtml(paidLabel)}</span>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tbody>
            ${[
              ["เงินเดือนพื้นฐาน", payrollSummary.base_salary, false],
              ["ค่าล่วงเวลา (OT)",   payrollSummary.overtime,    false],
              ["สวัสดิการ",          payrollSummary.welfare,     false],
              ["โบนัส",              payrollSummary.bonus,       false],
              ["คอมมิชชั่น",         payrollSummary.commission,  false],
              ["หัก",                payrollSummary.deductions,  true],
            ].map(([label, amount, isDeduction]) => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:8px 12px;color:#475569">${escHtml(label)}</td>
                <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;${isDeduction ? 'color:#dc2626' : 'color:#0f172a'}">${isDeduction && Number(amount) > 0 ? '-' : ''}${MONEY(amount)}</td>
              </tr>
            `).join("")}
            <tr style="background:#f8fafc">
              <td style="padding:10px 12px;font-weight:800;color:#0f172a">รวมสุทธิ</td>
              <td style="padding:10px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:900;color:#0284c7;font-size:16px">${MONEY(payrollSummary.total_amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${payrollSummary.paid_at ? `<div style="font-size:11px;color:#475569">วันที่จ่าย: ${escHtml(new Date(payrollSummary.paid_at).toLocaleString("th-TH", { timeZone: TZ, year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }))}${payrollSummary.payment_method ? ` · ${escHtml(payrollSummary.payment_method)}` : ""}</div>` : ""}
      ${payrollSummary.note ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:12px;color:#78350f">📝 ${escHtml(payrollSummary.note)}</div>` : ""}
      <div><button class="hr-modal-route-btn" data-hr-action="payroll" style="padding:8px 16px;border:1px solid #16a34a;border-radius:8px;background:#fff;color:#16a34a;font-size:12px;font-weight:700;cursor:pointer">💰 ไปจัดการในหน้า Payroll →</button></div>
    </div>
  `;
}

function _renderModalBody(activeTab, payload) {
  switch (activeTab) {
    case "week":      return _renderTabWeek(payload.weekState, payload.shiftOpts);
    case "timesheet": return _renderTabTimesheet(payload.timesheetState, payload.shiftOpts, payload.attendanceRules);
    case "payroll":   return _renderTabPayroll(payload.payrollSummary);
    case "today":
    default:          return _renderTabToday(payload.summary);
  }
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.31: Secondary filter bar (department + role + clear)
// ═══════════════════════════════════════════════════════════

const ROLE_FILTER_ORDER = [
  { key: "all",        label: "ทั้งหมด"   },
  { key: "admin",      label: "Admin"       },
  { key: "sales",      label: "Sales"       },
  { key: "technician", label: "Technician"  },
  { key: "other",      label: "อื่น ๆ"      },
];

function _renderDeptDropdown(activeDept, departments, deptCounts) {
  const opts = [];
  opts.push(`<option value="__all__"${activeDept === "__all__" ? " selected" : ""}>ทุกแผนก</option>`);
  if (Array.isArray(departments)) {
    for (const d of departments) {
      if (!d?.id) continue;
      const cnt = deptCounts?.get(String(d.id)) || 0;
      const selected = String(activeDept) === String(d.id) ? " selected" : "";
      opts.push(`<option value="${escHtml(String(d.id))}"${selected}>${escHtml(d.name || "(ไม่มีชื่อ)")} (${NUM_TH(cnt)})</option>`);
    }
  }
  const noneCnt = deptCounts?.get("__none__") || 0;
  opts.push(`<option value="__none__"${activeDept === "__none__" ? " selected" : ""}>ไม่ระบุแผนก (${NUM_TH(noneCnt)})</option>`);
  return `<select id="hrDeptSelect" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:12px;font-weight:700;cursor:pointer;max-width:100%">${opts.join("")}</select>`;
}

function _renderRoleChips(activeRole, roleCounts) {
  return ROLE_FILTER_ORDER.map(r => {
    const isActive = r.key === activeRole;
    const cnt = roleCounts?.[r.key] || 0;
    if (cnt === 0 && r.key !== "all" && !isActive) return ""; // ซ่อนถ้าไม่มีคนใน bucket นี้ (ยกเว้น "all" และ active)
    const bg = isActive ? "#0f172a" : "#fff";
    const fg = isActive ? "#fff"    : "#475569";
    const bd = isActive ? "#0f172a" : "#e2e8f0";
    return `<button class="hr-role-btn" data-hr-role="${escHtml(r.key)}" style="padding:5px 10px;border:1px solid ${bd};border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:700;cursor:pointer">
      ${escHtml(r.label)}
      <span style="margin-left:5px;padding:0 6px;border-radius:999px;background:${isActive ? 'rgba(255,255,255,.2)' : '#f1f5f9'};color:${isActive ? '#fff' : '#0f172a'};font-size:10px;font-weight:800">${NUM_TH(cnt)}</span>
    </button>`;
  }).join("");
}

function _renderSecondaryFilterBar(activeDept, activeRole, departments, deptCounts, roleCounts, isDefault) {
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #f1f5f9;background:#fff">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:11px;color:#64748b;font-weight:700">แผนก:</span>
      ${_renderDeptDropdown(activeDept, departments, deptCounts)}
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:11px;color:#64748b;font-weight:700">Role:</span>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${_renderRoleChips(activeRole, roleCounts)}</div>
    </div>
    ${!isDefault ? `<button id="hrClearFiltersBtn" style="margin-left:auto;padding:5px 10px;border:1px solid #fca5a5;border-radius:8px;background:#fff;color:#991b1b;font-size:11px;font-weight:700;cursor:pointer">✕ ล้างตัวกรอง</button>` : ""}
  </div>`;
}

function _renderFilterSummary(label) {
  return `<div style="padding:8px 14px;border-bottom:1px solid #f1f5f9;background:#fafbfc;font-size:12px;color:#475569">${escHtml(label)}</div>`;
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
  // Phase 92.49: late / early-leave grace rules (storeInfo pattern เดิม)
  const punctRules = attendanceRulesFromState(state);

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

  // Phase 92.32: lightweight pending leave count — graceful (ตาราง staff_leaves อาจยังไม่มี)
  let pendingLeaves = 0;
  try {
    const lmMod = await import("./leave_management.js");
    pendingLeaves = await lmMod.fetchPendingLeaveCount();
  } catch (_e) { /* silent — module หรือ table ยังไม่พร้อม */ }

  // Phase 379: geofence config (read-only) — ใช้ helper กลาง geofenceFromState (เลิก inline parse ซ้ำ)
  //   null ถ้ายังไม่ตั้ง shopLat/Lng → detectExceptions ข้าม geofence_out + GPS chip ไม่ขึ้น
  //   shape { lat, lng, radiusM } — detectExceptions อ่านแค่ radiusM (เท่าเดิม)
  const geofence = geofenceFromState(state);

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
    pendingLeaves,
    // Phase 92.49: เปิด late / early-leave counting
    shiftOpts,
    attendanceRules: punctRules,
  });

  const attIdx = indexAttendanceByUser(data.attendanceToday);
  const deptMap = new Map();
  for (const d of data.departments) deptMap.set(String(d.id), d);

  // Phase 92.53: รายงาน HR รายเดือน รวมต่อพนักงาน (เดือนปัจจุบัน)
  const deptNameById = new Map();
  for (const d of data.departments) deptNameById.set(String(d.id), d.name || "—");
  let monthlyReport = buildMonthlyHrReport({
    profiles: data.profiles,
    attendanceMonth: data.attendanceMonth,
    leaves: data.leaves,
    shiftOpts,
    attendanceRules: punctRules,
    deptNameById,
  });
  // Phase 92.54: date-range state — default = เดือนปัจจุบัน (1st .. สิ้นเดือน) ตรงกับ data ที่โหลดมาแล้ว
  let reportFrom = `${monthKey}-01`;
  let reportTo = new Date(new Date(_monthBounds(monthKey).endExclusive + "T00:00:00+07:00").getTime() - 86400000)
    .toLocaleDateString("en-CA", { timeZone: TZ });

  const rows = data.profiles.map(p => {
    const att = attIdx.get(p.id) || null;
    const status = classifyAttendanceStatus(att);
    const ot = att ? computeRegularOT(att, shiftOpts) : { regular: 0, ot: 0, total: 0 };
    // Phase 92.49: punctuality (informational chip) — ไม่กระทบ status/ot/payroll
    const punc = att
      ? classifyPunctuality(att, shiftOpts, punctRules)
      : { status: "none", lateMinutes: 0, earlyLeaveMinutes: 0 };
    // Phase 379: GPS exception (read-only display) — ไม่กระทบ status/ot/payroll
    const gpsStatus = classifyGpsStatus(att, geofence);
    const gpsMeta = gpsChipMeta(gpsStatus, { distanceM: att?.clock_in_distance_m, radiusM: geofence?.radiusM });
    return { profile: p, att, status, ot, punc, gpsStatus, gpsMeta };
  });
  const ORDER = { working: 0, abnormal: 1, out: 2, not_in: 3 };
  rows.sort((a, b) => {
    const da = ORDER[a.status] ?? 9;
    const db = ORDER[b.status] ?? 9;
    if (da !== db) return da - db;
    return (a.profile.full_name || "").localeCompare(b.profile.full_name || "", "th");
  });

  // Phase 92.31: filter state (status + departmentId + role) — default = all
  let activeFilter = "all";
  let activeDept = "__all__";
  let activeRole = "all";

  // Initial cascade counts: dept = all rows · role = filter by dept · status = filter by dept+role
  const initialFilteredByDept = filterHrRows(rows, { departmentId: activeDept });
  const initialFilteredByDeptRole = filterHrRows(rows, { departmentId: activeDept, role: activeRole });
  const initialDeptCounts = countDepartmentBuckets(rows);
  const initialRoleCounts = countRoleBuckets(initialFilteredByDept);
  const buckets = countStatusBuckets(initialFilteredByDeptRole);
  const initialSummary = filterSummaryLabel(
    { status: activeFilter, departmentId: activeDept, role: activeRole },
    rows.length, rows.length, data.departments
  );
  const dashboardMetrics = buildHrDashboardMetrics({
    profiles: data.profiles,
    rows,
    departments: data.departments,
    attendanceMonth: data.attendanceMonth,
    payrolls: data.payrolls,
    leaves: data.leaves,
    pendingLeaves,
    today,
    monthKey,
    // Phase 92.51: enable monthly punctuality (top late)
    shiftOpts,
    attendanceRules: punctRules,
  });

  // ── Render HTML ───────────────────────────────────────────
  const todayTh = new Date(today + "T00:00:00+07:00").toLocaleDateString("th-TH", {
    timeZone: TZ, year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
  const monthTh = new Date(monthKey + "-01T00:00:00+07:00").toLocaleDateString("th-TH", {
    timeZone: TZ, year: "numeric", month: "long"
  });

  const errBanner = (data.errors.attendanceToday || data.errors.attendanceMonth || data.errors.payrolls || data.errors.leaves)
    ? `<div style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 12px;border-radius:10px;font-size:12px;margin-bottom:12px">
        ⚠️ บางตารางโหลดไม่สำเร็จ (RLS / network) — ตัวเลขด้านล่างอาจไม่ครบ
      </div>`
    : "";

  // Phase 92.41: KPI cards ทุกใบคลิกได้ — drill-down ไปหน้าเดิม ใช้ pure helper kpiClickRouteFor
  // (Payroll ตอน 0/0 ก็คลิกได้ — ไปดูรายละเอียดหน้า payroll หรือสร้างใหม่ดีกว่า disable แล้วเงียบ)

  container.innerHTML = `
    <style>
      /* Phase 92.58: premium HR look */
      .hr-page { background:linear-gradient(180deg,#f6f8fd 0%,#eef1f8 100%); border-radius:20px; -webkit-font-smoothing:antialiased; }
      .hr-page h2, .hr-page h3 { letter-spacing:-.01em; }
      /* KPI card click-through affordance + a11y (premium hover lift) */
      .hr-kpi-card { transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
      .hr-kpi-card:hover { transform: translateY(-3px); box-shadow: 0 1px 2px rgba(16,24,64,.05), 0 22px 44px -22px rgba(79,70,229,.35); border-color: #dcd9f8; }
      .hr-kpi-card:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
      .hr-row-employee { transition: background-color .12s ease; }
      .hr-row-employee:hover { background-color: #f5f7ff; }
      .hr-row-employee:focus-within { outline: 2px solid #6366f1; outline-offset: -2px; }
      .hrx-dashboard { display:flex; flex-direction:column; gap:12px; }
      .hrx-hero { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:18px; align-items:stretch; background:linear-gradient(135deg,#ffffff 0%,#f5f6ff 55%,#eef0ff 100%); border:1px solid #e6e8f6; border-radius:22px; padding:26px; box-shadow:0 1px 2px rgba(16,24,64,.04), 0 24px 50px -28px rgba(79,70,229,.32); }
      .hrx-eyebrow { display:inline-block; font-size:11px; font-weight:900; color:#4338ca; letter-spacing:.14em; background:linear-gradient(135deg,#eef2ff,#f3f0ff); border:1px solid #e0e7ff; padding:4px 11px; border-radius:999px; }
      .hrx-hero h2 { margin:10px 0 5px; font-size:30px; font-weight:900; letter-spacing:-.02em; line-height:1.12; background:linear-gradient(120deg,#0f172a 0%,#4338ca 70%,#7c3aed 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .hrx-hero p { margin:0; color:#475569; font-size:13px; line-height:1.6; }
      .hrx-benefits { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
      .hrx-benefits span { border:1px solid #e6e8f6; background:#fff; color:#334155; border-radius:999px; padding:7px 13px; font-size:12px; font-weight:700; box-shadow:0 1px 2px rgba(16,24,64,.05); }
      .hrx-note { border:1px solid #e0e7ff; background:linear-gradient(160deg,#fbfcff,#f3f4ff); border-radius:16px; padding:14px 16px; color:#1e1b4b; font-size:12px; box-shadow:inset 0 1px 0 rgba(255,255,255,.6); }
      .hrx-note strong { display:block; margin-bottom:6px; font-size:13px; }
      .hrx-note ul { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:5px; }
      .hrx-toolbar { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; background:linear-gradient(135deg,#0b1437 0%,#1e1b4b 55%,#312e81 100%); color:#fff; border-radius:18px; padding:14px; box-shadow:0 20px 44px -22px rgba(49,46,129,.75); }
      .hrx-toolbar div { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); border-radius:12px; padding:9px 12px; min-width:0; backdrop-filter:blur(4px); }
      .hrx-toolbar strong { display:block; font-size:11px; opacity:.7; margin-bottom:2px; letter-spacing:.04em; }
      .hrx-toolbar span { display:block; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .hrx-mini-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
      .hrx-mini-card { background:linear-gradient(180deg,#ffffff,#fbfcff); border:1px solid #eceff6; border-radius:16px; padding:14px; display:flex; gap:11px; align-items:center; min-width:0; box-shadow:0 1px 2px rgba(16,24,64,.04); transition:transform .16s ease, box-shadow .16s ease; }
      .hrx-mini-card:hover { transform:translateY(-2px); box-shadow:0 18px 36px -20px rgba(16,24,64,.28); }
      .hrx-mini-icon { width:46px; height:46px; border-radius:13px; display:grid; place-items:center; font-size:21px; flex-shrink:0; box-shadow:inset 0 0 0 1px rgba(255,255,255,.5); }
      .hrx-mini-copy { min-width:0; }
      .hrx-mini-label { color:#475569; font-size:12px; font-weight:800; letter-spacing:.01em; }
      .hrx-mini-value { font-size:25px; line-height:1.1; font-weight:950; margin-top:2px; letter-spacing:-.02em; }
      .hrx-mini-sub { color:#64748b; font-size:11px; margin-top:3px; }
      .hrx-grid-3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
      .hrx-panel { background:linear-gradient(180deg,#ffffff,#fcfdff); border:1px solid #eceff6; border-radius:16px; padding:16px; min-width:0; box-shadow:0 1px 2px rgba(16,24,64,.04), 0 14px 32px -22px rgba(16,24,64,.2); transition:transform .16s ease, box-shadow .16s ease; }
      .hrx-panel:hover { transform:translateY(-2px); box-shadow:0 1px 2px rgba(16,24,64,.05), 0 20px 40px -22px rgba(16,24,64,.26); }
      .hrx-panel-head { display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:12px; }
      .hrx-panel-head h3 { margin:0; color:#0f172a; font-size:14px; }
      .hrx-panel-head span { color:#64748b; font-size:11px; font-weight:800; }
      .hrx-bars { display:flex; flex-direction:column; gap:10px; }
      .hrx-bar-row { display:grid; grid-template-columns:88px minmax(60px,1fr) 44px; gap:8px; align-items:center; font-size:12px; }
      .hrx-bar-label { color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .hrx-bar-track { height:12px; border-radius:999px; background:#eef2f7; overflow:hidden; }
      .hrx-bar-track span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#4f46e5,#7c3aed); }
      .hrx-bar-value { text-align:right; color:#0f172a; font-weight:900; font-variant-numeric:tabular-nums; }
      .hrx-donut-wrap { display:grid; grid-template-columns:112px minmax(0,1fr); gap:14px; align-items:center; }
      .hrx-donut { width:112px; height:112px; border-radius:50%; display:grid; place-items:center; position:relative; }
      .hrx-donut:after { content:""; position:absolute; inset:28px; background:#fff; border-radius:50%; }
      .hrx-donut span { position:relative; z-index:1; font-size:22px; font-weight:950; color:#0f172a; }
      .hrx-legend { display:flex; flex-direction:column; gap:8px; min-width:0; }
      .hrx-legend div { display:grid; grid-template-columns:10px minmax(0,1fr) auto; gap:7px; align-items:center; font-size:12px; color:#475569; }
      .hrx-legend i { width:10px; height:10px; border-radius:3px; }
      .hrx-legend span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .hrx-legend b { color:#0f172a; font-size:11px; }
      .hrx-vertical-bars { height:185px; display:flex; gap:10px; align-items:end; justify-content:space-between; padding-top:8px; }
      .hrx-vbar-item { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:5px; height:100%; }
      .hrx-vbar-value { font-size:11px; font-weight:900; color:#0f172a; }
      .hrx-vbar { flex:1; width:100%; max-width:32px; border-radius:9px; background:#eef2f7; display:flex; align-items:end; overflow:hidden; }
      .hrx-vbar span { width:100%; background:linear-gradient(180deg,#7c3aed,#4f46e5); border-radius:9px 9px 0 0; }
      .hrx-vbar-label { font-size:10px; color:#64748b; white-space:nowrap; }
      .hrx-table-wrap { overflow-x:auto; }
      .hrx-table { width:100%; border-collapse:collapse; font-size:12px; min-width:320px; }
      .hrx-table th, .hrx-table td { padding:8px 7px; border-bottom:1px solid #eef2f7; text-align:left; color:#334155; }
      .hrx-table th { color:#475569; background:#f8fafc; font-weight:900; }
      .hrx-empty { min-height:96px; display:grid; place-items:center; text-align:center; color:#64748b; font-size:12px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; padding:12px; }
      .hrx-info-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
      .hrx-info-card { border:1px solid #eceff6; border-radius:16px; padding:16px; background:linear-gradient(160deg,#fbfcff,#f4f6ff); box-shadow:0 1px 2px rgba(16,24,64,.04); }
      .hrx-info-card h3 { margin:0 0 8px; color:#0f172a; font-size:14px; }
      .hrx-info-card p { margin:0; color:#475569; font-size:12px; line-height:1.55; }
      @media (max-width: 920px) {
        .hrx-hero, .hrx-grid-3, .hrx-info-grid { grid-template-columns:1fr; }
        .hrx-toolbar { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @media (max-width: 560px) {
        .hrx-hero { padding:14px; }
        .hrx-hero h2 { font-size:22px; }
        .hrx-toolbar { grid-template-columns:1fr; }
        .hrx-donut-wrap { grid-template-columns:1fr; justify-items:center; }
      }
    </style>
    <div class="hr-page" style="padding:14px;display:flex;flex-direction:column;gap:16px">

      <!-- Header -->
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;padding:6px 2px">
        <div>
          <h2 style="margin:0 0 2px;font-size:20px;color:#0f172a">📊 ภาพรวม HR</h2>
          <div style="font-size:12px;color:#64748b">${escHtml(todayTh)} · กะ ${shiftOpts.startHour.toString().padStart(2,"0")}:00–${shiftOpts.endHour.toString().padStart(2,"0")}:00</div>
        </div>
        <button id="hrRefreshBtn" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#0f172a;font-size:12px;font-weight:700;cursor:pointer">⟳ รีเฟรช</button>
      </div>

      ${errBanner}

      ${_renderHrExecutiveDashboard(dashboardMetrics, { monthTh, todayTh, departments: data.departments, activeDept, activeRole })}

      <!-- KPI cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        ${_kpiCard({ label: "พนักงานทั้งหมด", value: NUM_TH(kpi.totalStaff), sub: `${data.departments.length} แผนก`, color: "#0f172a", icon: "👥", clickRoute: kpiClickRouteFor("total_staff") })}
        ${_kpiCard({ label: "เข้างานวันนี้", value: NUM_TH(kpi.presentToday) + "/" + NUM_TH(kpi.totalStaff), sub: kpi.totalStaff > 0 ? Math.round((kpi.presentToday / kpi.totalStaff) * 100) + "%" : "—", color: "#0284c7", icon: "🟢", clickRoute: kpiClickRouteFor("present_today") })}
        ${_kpiCard({ label: "ยังไม่ลงเวลาออก", value: NUM_TH(kpi.openSessions), sub: kpi.openSessions > 0 ? "session เปิดอยู่" : "ไม่มีค้าง", color: kpi.openSessions > 0 ? "#ea580c" : "#16a34a", icon: "🕒", clickRoute: kpiClickRouteFor("open_sessions") })}
        ${_kpiCard({ label: "OT เดือนนี้", value: HOURS(kpi.otHoursMonth) + " ชม.", sub: escHtml(monthTh), color: kpi.otHoursMonth > 0 ? "#ea580c" : "#0f172a", icon: "⏱️", clickRoute: kpiClickRouteFor("ot_month") })}
        ${_kpiCard({ label: "Payroll เดือนนี้", value: NUM_TH(kpi.payrollPaid) + "/" + NUM_TH(kpi.payrollTotal), sub: "จ่าย " + MONEY(kpi.payrollPaidAmount) + " · ค้าง " + MONEY(kpi.payrollUnpaidAmount), color: kpi.payrollUnpaid > 0 ? "#ea580c" : "#16a34a", icon: "💰", clickRoute: kpiClickRouteFor("payroll") })}
        ${kpi.offlinePending > 0 ? _kpiCard({ label: "Offline Queue", value: NUM_TH(kpi.offlinePending), sub: "รอ sync", color: "#7c3aed", icon: "📥", clickRoute: kpiClickRouteFor("offline_pending") }) : ""}
      </div>

      <!-- Alerts -->
      <div style="background:#fff;border:1px solid #eceff6;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,64,.04),0 12px 30px -20px rgba(16,24,64,.16);padding:14px 16px">
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px">🛎️ สิ่งที่ต้องจัดการวันนี้</div>
        ${exceptions.length === 0
          ? `<div style="font-size:13px;color:#16a34a;padding:8px 0">✅ ไม่มีรายการต้องจัดการ — ระบบเรียบร้อยดี</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${exceptions.map(e => _alertRow(e)).join("")}</div>`
        }
      </div>

      <!-- Today's Attendance Table -->
      <div style="background:#fff;border:1px solid #eceff6;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,64,.04),0 12px 30px -20px rgba(16,24,64,.16);padding:0;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:14px;font-weight:800;color:#0f172a">🧑‍💼 สถานะพนักงานวันนี้ (${NUM_TH(rows.length)})</div>
          <div style="font-size:11px;color:#64748b">เรียงตามสถานะ</div>
        </div>
        ${rows.length === 0
          ? renderEmpty({ icon: "👥", title: "ยังไม่มีพนักงานในระบบ", message: "เพิ่มพนักงานที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน" })
          : `
          <div id="hrFilterBar">${_filterBar(buckets, activeFilter)}</div>
          <div id="hrSecondaryBar">${_renderSecondaryFilterBar(activeDept, activeRole, data.departments, initialDeptCounts, initialRoleCounts, isDefaultHrFilters({status:activeFilter, departmentId:activeDept, role:activeRole}))}</div>
          <div id="hrSummaryBar">${_renderFilterSummary(initialSummary)}</div>
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
              ${_renderTbody(filterHrRows(rows, { status: activeFilter, departmentId: activeDept, role: activeRole }), deptMap)}
            </tbody>
          </table>
          </div>`
        }
      </div>

      <!-- Phase 92.53: รายงาน HR รายเดือน รวมต่อพนักงาน -->
      <div id="hrReportSection">${_renderMonthlyHrReport(monthlyReport, { from: reportFrom, to: reportTo })}</div>

      <!-- Quick actions (Phase 92.29: reordered + concise labels) -->
      <div style="background:#fff;border:1px solid #eceff6;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,64,.04),0 12px 30px -20px rgba(16,24,64,.16);padding:14px 16px">
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

    <!-- Phase 92.30: Employee drill-down modal (hidden initially) -->
    <div id="hrEmployeeModal" style="display:none;position:fixed;inset:0;z-index:9999"></div>
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

  // Phase 92.31: cascade re-render — dept counts = ทุก rows, role counts = หลัง dept, status counts = หลัง dept+role
  const filterBarEl    = document.getElementById("hrFilterBar");
  const secondaryBarEl = document.getElementById("hrSecondaryBar");
  const summaryBarEl   = document.getElementById("hrSummaryBar");
  const tbodyEl        = document.getElementById("hrTbody");

  function _rerenderFilters() {
    if (!filterBarEl || !tbodyEl) return;
    const filters = { status: activeFilter, departmentId: activeDept, role: activeRole };
    const filteredByDept     = filterHrRows(rows, { departmentId: activeDept });
    const filteredByDeptRole = filterHrRows(rows, { departmentId: activeDept, role: activeRole });
    const visible            = filterHrRows(rows, filters);
    const deptCounts   = countDepartmentBuckets(rows);
    const roleCounts   = countRoleBuckets(filteredByDept);
    const statusCounts = countStatusBuckets(filteredByDeptRole);
    filterBarEl.innerHTML    = _filterBar(statusCounts, activeFilter);
    if (secondaryBarEl) secondaryBarEl.innerHTML = _renderSecondaryFilterBar(
      activeDept, activeRole, data.departments, deptCounts, roleCounts, isDefaultHrFilters(filters)
    );
    if (summaryBarEl) summaryBarEl.innerHTML = _renderFilterSummary(
      filterSummaryLabel(filters, rows.length, visible.length, data.departments)
    );
    tbodyEl.innerHTML = _renderTbody(visible, deptMap);
  }

  // Status filter chips
  if (filterBarEl && tbodyEl) {
    filterBarEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".hr-filter-btn");
      if (!btn) return;
      const next = btn.getAttribute("data-hr-filter") || "all";
      if (next === activeFilter) return;
      activeFilter = next;
      _rerenderFilters();
    });
  }

  // Secondary bar: dept dropdown + role chips + clear
  if (secondaryBarEl) {
    secondaryBarEl.addEventListener("change", (ev) => {
      const sel = ev.target.closest("#hrDeptSelect");
      if (!sel) return;
      const next = sel.value || "__all__";
      if (next === activeDept) return;
      activeDept = next;
      _rerenderFilters();
    });
    secondaryBarEl.addEventListener("click", (ev) => {
      const roleBtn = ev.target.closest(".hr-role-btn");
      if (roleBtn) {
        const next = roleBtn.getAttribute("data-hr-role") || "all";
        if (next === activeRole) return;
        activeRole = next;
        _rerenderFilters();
        return;
      }
      if (ev.target.closest("#hrClearFiltersBtn")) {
        activeFilter = "all";
        activeDept   = "__all__";
        activeRole   = "all";
        _rerenderFilters();
      }
    });
  }

  document.getElementById("hrExportBtn")?.addEventListener("click", async () => {
    try {
      const utilsMod = await import("./utils.js");
      const filters = { status: activeFilter, departmentId: activeDept, role: activeRole };
      const exportSource = filterHrRows(rows, filters);
      const exportRows = exportSource.map(({ profile: p, att, status, ot, punc }) => {
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
          // Phase 92.51: punctuality columns
          "สถานะตรงเวลา": punctualityChipMeta(punc)?.label || "—",
          "นาทีสาย": punc?.lateMinutes || 0,
          "นาทีออกก่อน": punc?.earlyLeaveMinutes || 0,
        };
      });
      const filename = buildHrExportFilename(today, filters);
      const ok = utilsMod.exportToExcel(filename, exportRows, "HR Overview");
      if (ok) showToast?.("📥 Export สำเร็จ"); else showToast?.("ไม่สามารถ Export ได้ (XLSX ยังไม่โหลด)");
    } catch (e) {
      showToast?.("Export ผิดพลาด: " + (e?.message || e));
    }
  });

  // Phase 92.53/92.54: รายงาน HR ตามช่วงวันที่ — re-render section + re-bind ทุกครั้ง
  const reportSectionEl = document.getElementById("hrReportSection");
  function _renderReportSection(loading) {
    if (!reportSectionEl) return;
    reportSectionEl.innerHTML = _renderMonthlyHrReport(monthlyReport, { from: reportFrom, to: reportTo, loading });
    _bindReport();
  }
  function _bindReport() {
    document.getElementById("hrReportSearchBtn")?.addEventListener("click", async () => {
      const f = document.getElementById("hrReportFrom")?.value || reportFrom;
      const to = document.getElementById("hrReportTo")?.value || reportTo;
      if (!f || !to) { showToast?.("กรุณาเลือกช่วงวันที่"); return; }
      if (f > to) { showToast?.("⚠️ วันเริ่มต้องไม่เกินวันสิ้นสุด"); return; }
      reportFrom = f; reportTo = to;
      _renderReportSection(true); // loading state
      try {
        const { attendance, leaves } = await _fetchReportRange(reportFrom, reportTo);
        monthlyReport = buildMonthlyHrReport({
          profiles: data.profiles, attendanceMonth: attendance, leaves,
          shiftOpts, attendanceRules: punctRules, deptNameById,
        });
      } catch (e) {
        showToast?.("โหลดรายงานไม่สำเร็จ: " + (e?.message || e));
      }
      _renderReportSection(false);
    });

    document.getElementById("hrReportExportBtn")?.addEventListener("click", async () => {
      if ((monthlyReport?.rows || []).length === 0) return;
      try {
        const utilsMod = await import("./utils.js");
        const exportRows = monthlyReport.rows.map(r => ({
          "พนักงาน": r.name,
          "แผนก": r.department,
          "Role": roleChipMeta(r.role).label,
          "วันทำงาน": r.daysWorked,
          "ชม. ปกติ": r.regularHours,
          "OT (ชม.)": r.otHours,
          "มาสาย (ครั้ง)": r.lateCount,
          "นาทีสายรวม": r.lateMinutes,
          "ออกก่อน (ครั้ง)": r.earlyLeaveCount,
          "นาทีออกก่อนรวม": r.earlyLeaveMinutes,
          "ลา (วัน)": r.leaveDays,
        }));
        const filename = `hr_report_${reportFrom}_${reportTo}.xlsx`;
        const ok = utilsMod.exportToExcel(filename, exportRows, "HR Report");
        if (ok) showToast?.("📥 Export รายงานสำเร็จ"); else showToast?.("ไม่สามารถ Export ได้ (XLSX ยังไม่โหลด)");
      } catch (e) {
        showToast?.("Export ผิดพลาด: " + (e?.message || e));
      }
    });

    // Phase 92.56: export รายงานระดับแผนก (จากข้อมูลช่วงเดียวกัน)
    document.getElementById("hrDeptReportExportBtn")?.addEventListener("click", async () => {
      if ((monthlyReport?.rows || []).length === 0) return;
      try {
        const utilsMod = await import("./utils.js");
        const dept = buildDepartmentReport(monthlyReport.rows);
        const exportRows = dept.rows.map(d => ({
          "แผนก": d.department,
          "จำนวนคน": d.headcount,
          "รวมวันทำงาน": d.daysWorked,
          "ชม. ปกติ": d.regularHours,
          "OT (ชม.)": d.otHours,
          "มาสาย (ครั้ง)": d.lateCount,
          "ออกก่อน (ครั้ง)": d.earlyLeaveCount,
          "ลา (วัน)": d.leaveDays,
        }));
        const filename = `hr_dept_report_${reportFrom}_${reportTo}.xlsx`;
        const ok = utilsMod.exportToExcel(filename, exportRows, "HR Dept Report");
        if (ok) showToast?.("📥 Export รายงานแผนกสำเร็จ"); else showToast?.("ไม่สามารถ Export ได้ (XLSX ยังไม่โหลด)");
      } catch (e) {
        showToast?.("Export ผิดพลาด: " + (e?.message || e));
      }
    });

    // Phase 92.57: พิมพ์ / บันทึก PDF (browser-native print)
    document.getElementById("hrReportPrintBtn")?.addEventListener("click", () => {
      if ((monthlyReport?.rows || []).length === 0) return;
      try {
        const dept = buildDepartmentReport(monthlyReport.rows);
        const generatedAt = new Date().toLocaleString("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
        const html = buildHrReportPrintHtml({
          from: reportFrom, to: reportTo,
          employeeRows: monthlyReport.rows, empTotals: monthlyReport.totals,
          deptRows: dept.rows, deptTotals: dept.totals,
          storeName: state?.storeInfo?.name || "Boonsook POS",
          generatedAt,
        });
        const win = window.open("", "_blank");
        if (!win) { showToast?.("⚠️ เบราว์เซอร์บล็อก popup — อนุญาตแล้วลองใหม่"); return; }
        win.document.write(html);
        win.document.close();
        win.focus();
      } catch (e) {
        showToast?.("พิมพ์ไม่สำเร็จ: " + (e?.message || e));
      }
    });
  }
  _bindReport(); // initial bind

  // ═══════════════════════════════════════════════════════════
  //  Phase 92.30: Employee drill-down modal — open/close/tabs/lazy fetch
  // ═══════════════════════════════════════════════════════════

  const modalRoot = document.getElementById("hrEmployeeModal");
  let activeUserId = null;
  let activeTab = "today";
  const weekCache = new Map(); // userId → { status, rows, error, today }
  const timesheetCache = new Map(); // Phase 92.55: userId → { status, rows, error, fromDate, toDate }
  let escHandler = null;

  function _closeModal() {
    if (!modalRoot) return;
    activeUserId = null;
    modalRoot.style.display = "none";
    modalRoot.innerHTML = "";
    document.body.style.overflow = "";
    if (escHandler) {
      window.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
  }

  function _renderModal() {
    if (!modalRoot || !activeUserId) return;
    const found = rows.find(r => String(r.profile.id) === String(activeUserId));
    if (!found) { _closeModal(); return; }
    const dept = found.profile.department_id ? deptMap.get(String(found.profile.department_id)) : null;
    const summary = buildEmployeeModalSummary({
      profile: found.profile,
      todayAtt: found.att,
      todayOt: found.ot,
      status: found.status,
      dept,
      radiusM: geofence?.radiusM ?? null,
      punc: found.punc,
    });
    const payrollSummary = employeePayrollSummary(data.payrolls, found.profile);
    const weekState = weekCache.get(activeUserId) || { status: "idle", rows: [], error: null, today };
    const timesheetState = timesheetCache.get(activeUserId) || { status: "idle", rows: [], error: null, fromDate: `${monthKey}-01`, toDate: today };

    modalRoot.innerHTML = `
      <div id="hrModalBackdrop" style="position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px)"></div>
      <div role="dialog" aria-modal="true" aria-label="รายละเอียดพนักงาน" style="position:relative;max-width:860px;width:calc(100% - 24px);max-height:calc(100vh - 24px);margin:12px auto;background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.25);display:flex;flex-direction:column;overflow:hidden">
        ${_renderModalSummaryHeader(summary)}
        ${_renderModalTabBar(activeTab)}
        <div id="hrModalBody" style="flex:1;overflow-y:auto;min-height:200px">
          ${_renderModalBody(activeTab, { summary, weekState, timesheetState, attendanceRules: punctRules, shiftOpts, payrollSummary })}
        </div>
        <div style="padding:10px 20px;border-top:1px solid #f1f5f9;background:#fafbfc;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:11px;color:#94a3b8">${escHtml(rowActionLabel(found.status).label === "ลงเวลา" ? "ยังไม่ลงเวลาเข้างาน" : "")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="hr-modal-route-btn" data-hr-action="time_clock" style="padding:8px 14px;border:1px solid #0284c7;border-radius:8px;background:#fff;color:#0284c7;font-size:12px;font-weight:700;cursor:pointer">🕒 ไป Time Clock</button>
            <button class="hr-modal-route-btn" data-hr-action="payroll" style="padding:8px 14px;border:1px solid #16a34a;border-radius:8px;background:#fff;color:#16a34a;font-size:12px;font-weight:700;cursor:pointer">💰 ไป Payroll</button>
            <button id="hrModalCloseBottom" style="padding:8px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#475569;font-size:12px;font-weight:700;cursor:pointer">ปิด</button>
          </div>
        </div>
      </div>
    `;

    // ── Bind modal events ────────────────────────────────────
    modalRoot.querySelector("#hrModalClose")?.addEventListener("click", _closeModal);
    modalRoot.querySelector("#hrModalCloseBottom")?.addEventListener("click", _closeModal);
    modalRoot.querySelector("#hrModalBackdrop")?.addEventListener("click", _closeModal);

    // Tabs
    modalRoot.querySelectorAll(".hr-modal-tab").forEach(btn => {
      btn.addEventListener("click", async () => {
        const next = modalTabFor(btn.getAttribute("data-hr-tab"));
        if (next === activeTab) return;
        activeTab = next;
        // ถ้าเข้า "week" และยังไม่โหลด → fetch
        if (activeTab === "week" && (!weekCache.has(activeUserId) || weekCache.get(activeUserId).status === "idle")) {
          weekCache.set(activeUserId, { status: "loading", rows: [], error: null, today });
          _renderModal();
          // คำนวณช่วง 7 วัน (รวมวันนี้)
          const baseT = new Date(today + "T00:00:00+07:00").getTime();
          const fromDate = new Date(baseT - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
          try {
            const r = await _fetchUserAttendanceRange(activeUserId, fromDate, today);
            weekCache.set(activeUserId, { status: "loaded", rows: r, error: null, today });
          } catch (e) {
            weekCache.set(activeUserId, { status: "error", rows: [], error: e?.message || String(e), today });
          }
          // ตรวจว่า user ยังไม่ปิด modal / ไม่เปลี่ยน tab ก่อน rerender
          if (activeUserId && activeTab === "week") _renderModal();
          return;
        }
        // Phase 92.55: เข้า "timesheet" และยังไม่โหลด → fetch เดือนปัจจุบัน (month-to-date)
        if (activeTab === "timesheet" && (!timesheetCache.has(activeUserId) || timesheetCache.get(activeUserId).status === "idle")) {
          const fromDate = `${monthKey}-01`;
          timesheetCache.set(activeUserId, { status: "loading", rows: [], error: null, fromDate, toDate: today });
          _renderModal();
          try {
            const r = await _fetchUserAttendanceRange(activeUserId, fromDate, today);
            timesheetCache.set(activeUserId, { status: "loaded", rows: r, error: null, fromDate, toDate: today });
          } catch (e) {
            timesheetCache.set(activeUserId, { status: "error", rows: [], error: e?.message || String(e), fromDate, toDate: today });
          }
          if (activeUserId && activeTab === "timesheet") _renderModal();
          return;
        }
        _renderModal();
      });
    });

    // Route buttons inside modal — close modal then navigate
    modalRoot.querySelectorAll(".hr-modal-route-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const route = btn.getAttribute("data-hr-action");
        _closeModal();
        if (route && typeof showRoute === "function") showRoute(route);
      });
    });
  }

  function _openModal(userId) {
    if (!modalRoot || !userId) return;
    const exists = rows.find(r => String(r.profile.id) === String(userId));
    if (!exists) return;
    activeUserId = String(userId);
    activeTab = "today";
    modalRoot.style.display = "block";
    document.body.style.overflow = "hidden";
    _renderModal();
    // Esc handler — bind only while open
    escHandler = (ev) => { if (ev.key === "Escape") _closeModal(); };
    window.addEventListener("keydown", escHandler);
  }

  // Row click → open modal (delegation); skip if user clicked the row action button or any element with data-hr-action
  container.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-hr-action]")) return;
    if (ev.target.closest("button")) return;
    const row = ev.target.closest("[data-hr-employee]");
    if (!row || !container.contains(row)) return;
    const userId = row.getAttribute("data-hr-employee");
    if (userId) _openModal(userId);
  });
}
