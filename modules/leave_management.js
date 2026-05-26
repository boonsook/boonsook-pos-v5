// ═══════════════════════════════════════════════════════════
//  modules/leave_management.js — Phase 92.32 (Leave foundation)
//
//  ระบบจัดการ "วันลา / Leave" — read+write
//
//  Roles:
//    - admin: เห็นทุก row · approve/reject pending · สร้างแทนพนักงาน · ลบได้
//    - sales/technician: เห็นเฉพาะของตัวเอง · ขอลา · cancel ได้เฉพาะ pending
//
//  Pure helpers (testable, no DOM/network) — exported:
//    calcLeaveDays, leaveTypeLabel, leaveStatusMeta, filterLeaves, summarizeLeaves,
//    canEditLeave, canReviewLeave
//
//  DB: ต้องรัน supabase-phase92-32-leave-management.sql ก่อนใช้
//      (ตาราง staff_leaves + 5 indexes + 4 RLS policies + updated_at trigger)
//
//  Safety:
//    - escape HTML ทุก output จาก DB
//    - event delegation (ไม่มี inline onclick)
//    - confirm ก่อน approve/reject/cancel
//    - graceful HTTP error (ไม่ fake success)
//    - ไม่แตะ payroll/time_clock/RLS เก่า/money math
// ═══════════════════════════════════════════════════════════

import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix } from "./utils.js";
import { profileDisplayName } from "./time_clock.js";

const TZ = "Asia/Bangkok";

// ═══════════════════════════════════════════════════════════
//  Pure helpers
// ═══════════════════════════════════════════════════════════

const LEAVE_TYPES = ["sick", "personal", "vacation", "unpaid", "other"];
const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"];

/**
 * คำนวณจำนวนวันลา (inclusive ทั้ง start และ end)
 * 1 วันเดียว = 1.0, สองวันต่อกัน = 2.0
 * @param {string} startDate "YYYY-MM-DD"
 * @param {string} endDate   "YYYY-MM-DD"
 * @returns {number} จำนวนวัน (0 ถ้า input ผิด)
 */
export function calcLeaveDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const s = new Date(String(startDate).slice(0, 10) + "T00:00:00+07:00").getTime();
  const e = new Date(String(endDate).slice(0, 10)   + "T00:00:00+07:00").getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  if (e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

/**
 * label ภาษาคนของ leave_type
 * @param {string} type
 * @returns {{label:string, icon:string, bg:string, fg:string, border:string}}
 */
export function leaveTypeLabel(type) {
  switch (type) {
    case "sick":     return { label: "ลาป่วย",       icon: "🤒", bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
    case "personal": return { label: "ลากิจ",        icon: "📝", bg: "#fef3c7", fg: "#92400e", border: "#fde68a" };
    case "vacation": return { label: "พักร้อน",      icon: "🌴", bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" };
    case "unpaid":   return { label: "ลาไม่รับเงิน", icon: "💸", bg: "#f3e8ff", fg: "#6b21a8", border: "#d8b4fe" };
    case "other":    return { label: "อื่น ๆ",       icon: "📌", bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
    default:         return { label: type || "—",    icon: "❔", bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
  }
}

/**
 * meta ของ status chip
 * @param {string} status
 * @returns {{label:string, bg:string, fg:string, border:string}}
 */
export function leaveStatusMeta(status) {
  switch (status) {
    case "pending":   return { label: "รออนุมัติ",  bg: "#fff7ed", fg: "#9a3412", border: "#fdba74" };
    case "approved":  return { label: "อนุมัติแล้ว", bg: "#dcfce7", fg: "#166534", border: "#86efac" };
    case "rejected":  return { label: "ปฏิเสธ",     bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
    case "cancelled": return { label: "ยกเลิก",     bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
    default:          return { label: status || "—", bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
  }
}

/**
 * filter leaves ตามหลายเงื่อนไขพร้อมกัน
 * @param {Array<object>} rows - staff_leaves rows
 * @param {object} [filters]
 * @param {string} [filters.month]      - "YYYY-MM" (กรอง start_date OR end_date overlap เดือนนี้)
 * @param {string} [filters.status]     - pending/approved/rejected/cancelled/"all"
 * @param {string} [filters.leaveType]  - sick/.../"all"
 * @param {string} [filters.userId]
 * @returns {Array}
 */
export function filterLeaves(rows, filters = {}) {
  if (!Array.isArray(rows)) return [];
  const status = filters.status || "all";
  const lt     = filters.leaveType || "all";
  const uid    = filters.userId || "";
  const month  = filters.month || "";
  return rows.filter(r => {
    if (status !== "all" && r?.status !== status) return false;
    if (lt !== "all" && r?.leave_type !== lt) return false;
    if (uid && String(r?.user_id) !== String(uid)) return false;
    if (month) {
      // overlap: start_date <= monthEnd AND end_date >= monthStart
      const m = String(month).slice(0, 7);
      const monthStart = m + "-01";
      const d = new Date(monthStart + "T00:00:00+07:00");
      if (!Number.isFinite(d.getTime())) return true;
      d.setMonth(d.getMonth() + 1);
      const monthEndExclusive = d.toISOString().slice(0, 10);
      const s = String(r?.start_date || "").slice(0, 10);
      const e = String(r?.end_date   || "").slice(0, 10);
      if (!s || !e) return false;
      if (s >= monthEndExclusive) return false; // เริ่มเดือนถัดไปแล้ว
      if (e <  monthStart) return false;        // จบก่อนเดือนนี้
    }
    return true;
  });
}

/**
 * summarize counts + days
 * @param {Array<object>} rows
 * @param {string} [month] - "YYYY-MM" filter
 * @returns {{pending:number, approved:number, rejected:number, cancelled:number, total:number, approvedDays:number}}
 */
export function summarizeLeaves(rows, month) {
  const acc = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0, approvedDays: 0 };
  const source = month ? filterLeaves(rows, { month }) : (Array.isArray(rows) ? rows : []);
  for (const r of source) {
    acc.total += 1;
    const s = r?.status;
    if (s in acc && s !== "total" && s !== "approvedDays") acc[s] += 1;
    if (s === "approved") acc.approvedDays += Number(r?.days_count || 0);
  }
  acc.approvedDays = Math.round(acc.approvedDays * 100) / 100;
  return acc;
}

/**
 * เช็คสิทธิ์แก้/cancel leave row
 *   admin → แก้ได้ทุก row
 *   non-admin → เฉพาะ row ของตัวเองที่ยัง pending (matches RLS policy)
 * @param {object} row
 * @param {string} currentUserId
 * @param {string} role
 * @returns {boolean}
 */
export function canEditLeave(row, currentUserId, role) {
  if (!row) return false;
  if (role === "admin") return true;
  if (!currentUserId) return false;
  if (String(row.user_id) !== String(currentUserId)) return false;
  return row.status === "pending";
}

/**
 * เช็คสิทธิ์ review (approve/reject) — admin only + ต้องเป็น pending
 * @param {object} row
 * @param {string} role
 * @returns {boolean}
 */
export function canReviewLeave(row, role) {
  if (!row) return false;
  if (role !== "admin") return false;
  return row.status === "pending";
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.33 — Leave → Payroll integration helpers (pure)
// ═══════════════════════════════════════════════════════════

/**
 * Phase 92.33: สรุปวันลา approved สำหรับใช้ใน Payroll modal
 * @param {Array<object>} leaves - approved leaves ของพนักงาน 1 คนในเดือน (caller filter มาแล้ว)
 * @returns {{totalApprovedDays:number, unpaidDays:number, sickDays:number, personalDays:number, vacationDays:number, otherDays:number, records:number}}
 */
export function summarizeApprovedLeavesForPayroll(leaves) {
  const acc = {
    totalApprovedDays: 0,
    unpaidDays: 0,
    sickDays: 0,
    personalDays: 0,
    vacationDays: 0,
    otherDays: 0,
    records: 0,
  };
  if (!Array.isArray(leaves)) return acc;
  for (const r of leaves) {
    if (!r || r.status !== "approved") continue;
    const days = Number(r.days_count || 0);
    if (!Number.isFinite(days) || days <= 0) continue;
    acc.records += 1;
    acc.totalApprovedDays += days;
    switch (r.leave_type) {
      case "unpaid":   acc.unpaidDays   += days; break;
      case "sick":     acc.sickDays     += days; break;
      case "personal": acc.personalDays += days; break;
      case "vacation": acc.vacationDays += days; break;
      default:         acc.otherDays    += days; break;
    }
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  acc.totalApprovedDays = round2(acc.totalApprovedDays);
  acc.unpaidDays        = round2(acc.unpaidDays);
  acc.sickDays          = round2(acc.sickDays);
  acc.personalDays      = round2(acc.personalDays);
  acc.vacationDays      = round2(acc.vacationDays);
  acc.otherDays         = round2(acc.otherDays);
  return acc;
}

/**
 * Phase 92.33: คำนวณเงินที่ควรหัก (suggested) จากวันลา "unpaid" (ลาไม่รับค่าจ้าง)
 *
 * Rule:
 *   - ถ้ามี dailyRate > 0 → unpaidDays * dailyRate
 *   - ถ้าไม่มี dailyRate แต่มี baseSalary > 0 → baseSalary / 30 * unpaidDays
 *   - invalid/zero → 0
 *   - ปัด 2 ตำแหน่งทศนิยม (money math safe)
 *
 * ★ Advisory only — admin ต้องกดปุ่ม apply เอง (ไม่ auto-mutate)
 *
 * @param {object} input
 * @param {number} input.unpaidDays
 * @param {number} [input.dailyRate]   - priority 1
 * @param {number} [input.baseSalary]  - priority 2 (÷ 30)
 * @returns {number} ปัด 2 ตำแหน่ง (0 ถ้า input ผิด/ไม่มีข้อมูล)
 */
export function calcUnpaidLeaveDeduction(input = {}) {
  const days = Number(input.unpaidDays);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const dailyRate  = Number(input.dailyRate);
  const baseSalary = Number(input.baseSalary);
  let amount = 0;
  if (Number.isFinite(dailyRate) && dailyRate > 0) {
    amount = days * dailyRate;
  } else if (Number.isFinite(baseSalary) && baseSalary > 0) {
    amount = (baseSalary / 30) * days;
  } else {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.35 — Leave Policy + Balance/Quota helpers (pure)
// ═══════════════════════════════════════════════════════════

/**
 * Phase 92.35: fallback default ถ้า leave_policies ยังไม่มีในระบบ (graceful)
 * @returns {Array<{leave_type:string, annual_quota:number|null, tracks_balance:boolean, description:string}>}
 */
export function defaultLeavePolicies() {
  return [
    { leave_type: "vacation", annual_quota: 10,   tracks_balance: true,  description: "พักร้อน — เริ่มต้น 10 วัน/ปี" },
    { leave_type: "sick",     annual_quota: 30,   tracks_balance: true,  description: "ลาป่วย — เริ่มต้น 30 วัน/ปี" },
    { leave_type: "personal", annual_quota: 3,    tracks_balance: true,  description: "ลากิจ — เริ่มต้น 3 วัน/ปี" },
    { leave_type: "unpaid",   annual_quota: null, tracks_balance: false, description: "ลาไม่รับค่าจ้าง — ไม่นับ quota" },
    { leave_type: "other",    annual_quota: null, tracks_balance: false, description: "อื่น ๆ — ไม่นับ quota" },
  ];
}

/**
 * Phase 92.35: หา quota ที่ effective สำหรับ user 1 คนใน type+year นั้น ๆ
 * Priority: override > policy default > undefined (treat as unlimited)
 *
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.leaveType
 * @param {number} input.year
 * @param {Array<object>} input.policies          - rows จาก leave_policies
 * @param {Array<object>} [input.overrides=[]]    - rows จาก staff_leave_overrides
 * @returns {{quota:number|null, tracksBalance:boolean, source:"override"|"policy"|"default", policyExists:boolean}}
 *   quota: null = ไม่จำกัด / ไม่นับ
 *   tracksBalance: false → แสดงเฉย ๆ ไม่เตือนเกิน
 */
export function effectiveQuotaForUser(input = {}) {
  const userId    = input.userId;
  const leaveType = input.leaveType;
  const year      = Number(input.year);
  const policies  = Array.isArray(input.policies)  ? input.policies  : [];
  const overrides = Array.isArray(input.overrides) ? input.overrides : [];

  // 1) Override priority (user+type+year exact match)
  if (userId && Number.isFinite(year)) {
    const ov = overrides.find(o => o
      && String(o.user_id) === String(userId)
      && o.leave_type === leaveType
      && Number(o.effective_year) === year
    );
    if (ov) {
      // tracks_balance ใช้ของ policy ที่เกี่ยวข้อง (override ไม่เก็บ flag)
      const pol = policies.find(p => p?.leave_type === leaveType);
      const tracksBalance = pol ? !!pol.tracks_balance : (ov.annual_quota != null);
      const quotaRaw = ov.annual_quota;
      const quota = (quotaRaw == null) ? null : Number(quotaRaw);
      return {
        quota: Number.isFinite(quota) ? quota : null,
        tracksBalance,
        source: "override",
        policyExists: !!pol,
      };
    }
  }

  // 2) Policy default
  const pol = policies.find(p => p?.leave_type === leaveType);
  if (pol) {
    const quotaRaw = pol.annual_quota;
    const quota = (quotaRaw == null) ? null : Number(quotaRaw);
    return {
      quota: Number.isFinite(quota) ? quota : null,
      tracksBalance: !!pol.tracks_balance,
      source: "policy",
      policyExists: true,
    };
  }

  // 3) Fallback to in-code defaults
  const fallback = defaultLeavePolicies().find(p => p.leave_type === leaveType);
  if (fallback) {
    return {
      quota: fallback.annual_quota,
      tracksBalance: fallback.tracks_balance,
      source: "default",
      policyExists: false,
    };
  }

  return { quota: null, tracksBalance: false, source: "default", policyExists: false };
}

/**
 * Phase 92.35: คำนวณ balance สำหรับ leave_type 1 ตัว
 * @param {object} input
 * @param {number|null} input.quota       - ถ้า null = ไม่จำกัด
 * @param {number} input.approvedDays
 * @param {number} input.pendingDays
 * @returns {{quota:number|null, used:number, pending:number, remaining:number|null, overQuota:boolean, willExceed:boolean}}
 *   remaining = quota - used (null ถ้า unlimited)
 *   overQuota: used > quota
 *   willExceed: used + pending > quota (warning level — pending จะทำให้เกิน)
 */
export function calcLeaveBalance(input = {}) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const quotaRaw = input.quota;
  const used     = Math.max(0, Number(input.approvedDays) || 0);
  const pending  = Math.max(0, Number(input.pendingDays)  || 0);

  if (quotaRaw == null || !Number.isFinite(Number(quotaRaw))) {
    // unlimited / ไม่นับ quota
    return {
      quota: null,
      used: round2(used),
      pending: round2(pending),
      remaining: null,
      overQuota: false,
      willExceed: false,
    };
  }
  const quota = Number(quotaRaw);
  return {
    quota: round2(quota),
    used: round2(used),
    pending: round2(pending),
    remaining: round2(quota - used),
    overQuota: used > quota,
    willExceed: (used + pending) > quota,
  };
}

/**
 * Phase 92.35: รวม balance ของ user 1 คน ครอบทุก leave_type
 * @param {object} input
 * @param {string} input.userId
 * @param {number} input.year                 - เช่น 2026
 * @param {Array<object>} input.leaves        - staff_leaves ของ user คนนี้ (caller filter มาแล้ว)
 * @param {Array<object>} input.policies
 * @param {Array<object>} [input.overrides=[]]
 * @returns {Map<string, object>} leave_type → balance + quotaMeta
 */
export function calcBalancesForUser(input = {}) {
  const userId    = input.userId;
  const year      = Number(input.year);
  const leaves    = Array.isArray(input.leaves)    ? input.leaves    : [];
  const policies  = Array.isArray(input.policies)  ? input.policies  : [];
  const overrides = Array.isArray(input.overrides) ? input.overrides : [];

  // นับวัน per type per status — filter เฉพาะ leave ที่อยู่ในปีนี้ (อิง start_date หรือ overlap)
  const yearStart = `${year}-01-01`;
  const yearEndExc = `${year + 1}-01-01`;
  const isInYear = (r) => {
    const s = String(r?.start_date || "").slice(0, 10);
    const e = String(r?.end_date   || "").slice(0, 10);
    if (!s || !e) return false;
    // overlap ปีนี้: start < yearEndExc AND end >= yearStart
    return s < yearEndExc && e >= yearStart;
  };

  const acc = {}; // type → {approvedDays, pendingDays}
  for (const r of leaves) {
    if (!r || !r.leave_type) continue;
    if (!isInYear(r)) continue;
    const days = Number(r.days_count || 0);
    if (!Number.isFinite(days) || days <= 0) continue;
    if (!acc[r.leave_type]) acc[r.leave_type] = { approvedDays: 0, pendingDays: 0 };
    if (r.status === "approved") acc[r.leave_type].approvedDays += days;
    else if (r.status === "pending") acc[r.leave_type].pendingDays += days;
    // rejected/cancelled ไม่นับ
  }

  // สร้าง result ครอบทุก leave_type ที่อยู่ใน policies (รวม unpaid/other ที่อาจ tracks_balance=false)
  const allTypes = Array.from(new Set([
    ...policies.map(p => p?.leave_type).filter(Boolean),
    ...defaultLeavePolicies().map(p => p.leave_type),
    ...Object.keys(acc),
  ]));

  const out = new Map();
  for (const t of allTypes) {
    const q = effectiveQuotaForUser({ userId, leaveType: t, year, policies, overrides });
    const usage = acc[t] || { approvedDays: 0, pendingDays: 0 };
    const balance = calcLeaveBalance({
      quota: q.quota,
      approvedDays: usage.approvedDays,
      pendingDays:  usage.pendingDays,
    });
    out.set(t, {
      leaveType: t,
      quota: balance.quota,
      tracksBalance: q.tracksBalance,
      source: q.source,
      used: balance.used,
      pending: balance.pending,
      remaining: balance.remaining,
      overQuota: balance.overQuota,
      willExceed: balance.willExceed,
    });
  }
  return out;
}

/**
 * Phase 92.35: เช็คว่าจะแสดง warning เกิน quota หรือไม่
 *   - tracks_balance = false → ไม่เตือน
 *   - quota = null/unlimited → ไม่เตือน
 *   - overQuota หรือ willExceed → warning
 * @param {object} balance - row ที่ calcBalancesForUser คืน
 * @returns {boolean}
 */
export function isOverQuotaWarning(balance) {
  if (!balance) return false;
  if (!balance.tracksBalance) return false;
  if (balance.quota == null) return false;
  return !!(balance.overQuota || balance.willExceed);
}

/**
 * Phase 92.35: format label สำหรับ balance row
 *   มี quota:    "5/10 + รอ 2 = เหลือ 3 วัน"   (หรือ "เกิน X วัน" ถ้า overQuota)
 *   unlimited:   "ใช้ 5 + รอ 2 (ไม่นับ quota)"
 * @param {object} balance
 * @returns {string}
 */
export function formatBalanceLabel(balance) {
  if (!balance) return "—";
  const used    = Number(balance.used    || 0);
  const pending = Number(balance.pending || 0);
  if (balance.quota == null) {
    const pendingPart = pending > 0 ? ` + รอ ${pending}` : "";
    return `ใช้ ${used}${pendingPart} (ไม่นับ quota)`;
  }
  const quota = Number(balance.quota);
  const remaining = quota - used;
  const pendingPart = pending > 0 ? ` + รอ ${pending}` : "";
  if (balance.overQuota) {
    return `${used}/${quota}${pendingPart} (เกิน ${used - quota} วัน)`;
  }
  return `${used}/${quota}${pendingPart} = เหลือ ${remaining} วัน`;
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.33 — Network helper สำหรับ Payroll integration
// ═══════════════════════════════════════════════════════════

/**
 * Phase 92.35: fetch leave_policies (graceful — fallback ไป default ถ้าตารางยังไม่มี)
 * @returns {Promise<{ok:true, rows:Array} | {ok:false, code:"NO_TABLE"|"HTTP"|"NO_CONFIG", message:string}>}
 */
export async function fetchLeavePolicies() {
  const cfg = (typeof window !== "undefined") ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, code: "NO_CONFIG", message: "ไม่มี SUPABASE_CONFIG" };
  try {
    const r = await fetch(`${cfg.url}/rest/v1/leave_policies?select=*&order=leave_type.asc`, {
      headers: _sbHeaders(),
    });
    if (!r.ok) {
      if (r.status === 404 || r.status === 400) {
        return { ok: false, code: "NO_TABLE", message: `HTTP ${r.status}` };
      }
      return { ok: false, code: "HTTP", message: `HTTP ${r.status}` };
    }
    const rows = await r.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { ok: false, code: "HTTP", message: e?.message || String(e) };
  }
}

/**
 * Phase 92.35: fetch staff_leave_overrides ของ user 1 คน (RLS ก็ filter เพิ่มเองฝั่ง server)
 * @param {string} userId
 * @param {number} [year] - filter เฉพาะปีนี้ (ถ้าใส่)
 * @returns {Promise<{ok:true, rows:Array} | {ok:false, code:string, message:string}>}
 */
export async function fetchLeaveOverridesForUser(userId, year) {
  if (!userId) return { ok: false, code: "BAD_INPUT", message: "missing userId" };
  const cfg = (typeof window !== "undefined") ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, code: "NO_CONFIG", message: "ไม่มี SUPABASE_CONFIG" };
  try {
    let url = `${cfg.url}/rest/v1/staff_leave_overrides?select=*&user_id=eq.${encodeURIComponent(userId)}`;
    if (Number.isFinite(Number(year))) url += `&effective_year=eq.${encodeURIComponent(Number(year))}`;
    url += `&order=leave_type.asc&limit=50`;
    const r = await fetch(url, { headers: _sbHeaders() });
    if (!r.ok) {
      if (r.status === 404 || r.status === 400) return { ok: false, code: "NO_TABLE", message: `HTTP ${r.status}` };
      return { ok: false, code: "HTTP", message: `HTTP ${r.status}` };
    }
    const rows = await r.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { ok: false, code: "HTTP", message: e?.message || String(e) };
  }
}

/**
 * Phase 92.33: fetch approved leaves ของ user 1 คนใน period (overlap query)
 * Overlap rule: start_date <= toDate AND end_date >= fromDate
 *
 * @param {string} userId
 * @param {string} fromDate - "YYYY-MM-DD"
 * @param {string} toDate   - "YYYY-MM-DD"
 * @returns {Promise<{ok:true, rows:Array} | {ok:false, code:"NO_TABLE"|"BAD_INPUT"|"HTTP", message:string}>}
 *   graceful — ไม่ throw, return shape ที่ caller branch ได้
 */
export async function fetchApprovedLeavesForUser(userId, fromDate, toDate) {
  if (!userId || !fromDate || !toDate) {
    return { ok: false, code: "BAD_INPUT", message: "missing args" };
  }
  const cfg = (typeof window !== "undefined") ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, code: "NO_CONFIG", message: "ไม่มี SUPABASE_CONFIG" };
  try {
    const url = `${cfg.url}/rest/v1/staff_leaves?select=*`
      + `&user_id=eq.${encodeURIComponent(userId)}`
      + `&status=eq.approved`
      + `&start_date=lte.${encodeURIComponent(toDate)}`
      + `&end_date=gte.${encodeURIComponent(fromDate)}`
      + `&order=start_date.asc&limit=200`;
    const r = await fetch(url, { headers: _sbHeaders() });
    if (!r.ok) {
      if (r.status === 404 || r.status === 400) {
        return { ok: false, code: "NO_TABLE", message: `HTTP ${r.status}` };
      }
      return { ok: false, code: "HTTP", message: `HTTP ${r.status}` };
    }
    const rows = await r.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { ok: false, code: "HTTP", message: e?.message || String(e) };
  }
}

// ═══════════════════════════════════════════════════════════
//  REST helpers (Supabase PostgREST)
// ═══════════════════════════════════════════════════════════

function _sbHeaders(extra) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg?.anonKey;
  return Object.assign({
    apikey: cfg?.anonKey,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  }, extra || {});
}

async function _fetchLeaves() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) throw new Error("ไม่มี SUPABASE_CONFIG");
  const r = await fetch(`${cfg.url}/rest/v1/staff_leaves?select=*&order=created_at.desc&limit=500`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) {
    if (r.status === 404 || r.status === 400) {
      const err = new Error("NO_TABLE"); err.code = "NO_TABLE"; throw err;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

async function _ensureProfilesLoaded(state) {
  if (Array.isArray(state?.allProfiles) && state.allProfiles.length > 0) return;
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) return;
  try {
    let r = await fetch(`${cfg.url}/rest/v1/profiles_with_email?select=*&order=full_name.asc`, { headers: _sbHeaders() });
    if (!r.ok) r = await fetch(`${cfg.url}/rest/v1/profiles?select=id,full_name,role,email,department_id&order=full_name.asc`, { headers: _sbHeaders() });
    if (r.ok) {
      const data = await r.json();
      if (state) state.allProfiles = Array.isArray(data) ? data : [];
    }
  } catch (_e) { /* silent */ }
}

async function _insertLeave(body) {
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff_leaves`, {
    method: "POST",
    headers: _sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function _patchLeave(id, patch) {
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff_leaves?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: _sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

// ═══════════════════════════════════════════════════════════
//  UI helpers
// ═══════════════════════════════════════════════════════════

const NUM_TH = (n) => Number(n || 0).toLocaleString("th-TH");

function _statusChip(status) {
  const m = leaveStatusMeta(status);
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${m.bg};color:${m.fg};border:1px solid ${m.border};font-size:11px;font-weight:700">${escHtml(m.label)}</span>`;
}

function _typeChip(type) {
  const m = leaveTypeLabel(type);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${m.bg};color:${m.fg};border:1px solid ${m.border};font-size:11px;font-weight:700">${escHtml(m.icon + " " + m.label)}</span>`;
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

function _formatDateRange(s, e) {
  if (!s) return "—";
  const sStr = String(s).slice(0, 10);
  const eStr = String(e || "").slice(0, 10);
  if (!eStr || eStr === sStr) return sStr;
  return `${sStr} → ${eStr}`;
}

function _renderTbody(rows, profileMap, currentUserId, role) {
  if (rows.length === 0) {
    return `<tr><td colspan="8" style="padding:24px 14px;text-align:center;color:#64748b;font-size:13px">
      <div style="font-size:32px;margin-bottom:6px;opacity:.6">📭</div>
      ไม่พบคำขอลาตามตัวกรองนี้
    </td></tr>`;
  }
  return rows.map(r => {
    const p = profileMap.get(String(r.user_id));
    const reviewer = r.reviewed_by ? profileMap.get(String(r.reviewed_by)) : null;
    const editable = canEditLeave(r, currentUserId, role);
    const reviewable = canReviewLeave(r, role);
    const actions = [];
    if (reviewable) {
      actions.push(`<button class="lm-row-approve" data-lm-id="${escHtml(String(r.id))}" style="padding:4px 8px;border:1px solid #16a34a;border-radius:6px;background:#16a34a;color:#fff;font-size:11px;font-weight:700;cursor:pointer">✓ อนุมัติ</button>`);
      actions.push(`<button class="lm-row-reject" data-lm-id="${escHtml(String(r.id))}" style="padding:4px 8px;border:1px solid #dc2626;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer">✕ ปฏิเสธ</button>`);
    }
    if (editable && role !== "admin" && r.status === "pending") {
      actions.push(`<button class="lm-row-cancel" data-lm-id="${escHtml(String(r.id))}" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#475569;font-size:11px;font-weight:700;cursor:pointer">ยกเลิก</button>`);
    }
    if (role === "admin") {
      actions.push(`<button class="lm-row-delete" data-lm-id="${escHtml(String(r.id))}" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer">🗑️</button>`);
    }
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 14px">
          <div style="font-weight:700;color:#0f172a">${escHtml(p ? profileDisplayName(p) : "—")}</div>
          ${p?.email ? `<div style="font-size:11px;color:#64748b">${escHtml(p.email)}</div>` : ""}
        </td>
        <td style="padding:8px 14px">${_typeChip(r.leave_type)}</td>
        <td style="padding:8px 14px;font-variant-numeric:tabular-nums">${escHtml(_formatDateRange(r.start_date, r.end_date))}</td>
        <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">${NUM_TH(r.days_count)}</td>
        <td style="padding:8px 14px;font-size:12px;color:#475569;max-width:240px;word-break:break-word">${escHtml(r.reason || "—")}</td>
        <td style="padding:8px 14px">${_statusChip(r.status)}</td>
        <td style="padding:8px 14px;font-size:11px;color:#64748b">
          ${reviewer ? escHtml(profileDisplayName(reviewer)) : "—"}
          ${r.review_note ? `<div style="margin-top:2px;font-style:italic">"${escHtml(r.review_note)}"</div>` : ""}
        </td>
        <td style="padding:8px 14px;text-align:right;white-space:nowrap">
          <div style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${actions.join("")}</div>
        </td>
      </tr>
    `;
  }).join("");
}

function _currentMonthKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

function _profileOptions(profiles, selectedId) {
  return profiles.map(p => {
    const sel = selectedId && String(p.id) === String(selectedId) ? " selected" : "";
    const label = profileDisplayName(p) + (p.email ? ` (${p.email})` : "");
    return `<option value="${escHtml(String(p.id))}"${sel}>${escHtml(label)}</option>`;
  }).join("");
}

// ─── Phase 92.35: Balance / Quota UI helpers ─────────────────

const BALANCE_TYPE_ORDER = ["vacation", "sick", "personal", "unpaid", "other"];

function _balanceChip(balance) {
  // unlimited / ไม่นับ quota
  if (!balance || !balance.tracksBalance || balance.quota == null) {
    return { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1", icon: "—" };
  }
  if (balance.overQuota)  return { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5", icon: "⛔" };
  if (balance.willExceed) return { bg: "#fff7ed", fg: "#9a3412", border: "#fdba74", icon: "⚠️" };
  if (balance.used > 0)   return { bg: "#dcfce7", fg: "#166534", border: "#86efac", icon: "✓"  };
  return { bg: "#eff6ff", fg: "#1e40af", border: "#93c5fd", icon: "○" };
}

function _renderBalanceCard(balance) {
  const meta = leaveTypeLabel(balance.leaveType);
  const chip = _balanceChip(balance);
  const quotaLabel = (balance.quota == null) ? "—" : NUM_TH(balance.quota);
  const remainingLabel = (balance.remaining == null) ? "—" : NUM_TH(balance.remaining);
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
        <div style="font-size:12px;font-weight:700;color:${meta.fg};display:inline-flex;align-items:center;gap:4px">
          <span>${escHtml(meta.icon)}</span>
          <span>${escHtml(meta.label)}</span>
        </div>
        <span style="display:inline-block;padding:1px 6px;border-radius:999px;background:${chip.bg};color:${chip.fg};border:1px solid ${chip.border};font-size:10px;font-weight:800">${escHtml(chip.icon)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">
        <div style="font-size:11px;color:#64748b">ใช้/quota</div>
        <div style="font-size:14px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">${NUM_TH(balance.used)} / ${quotaLabel}</div>
      </div>
      ${balance.pending > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:#9a3412"><span>รออนุมัติ</span><span style="font-variant-numeric:tabular-nums">+ ${NUM_TH(balance.pending)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;padding-top:4px;border-top:1px dashed #f1f5f9">
        <div style="font-size:11px;color:#64748b">เหลือ</div>
        <div style="font-size:13px;font-weight:800;color:${balance.overQuota ? '#dc2626' : balance.willExceed ? '#ea580c' : '#16a34a'};font-variant-numeric:tabular-nums">${remainingLabel}</div>
      </div>
    </div>
  `;
}

function _renderBalanceSection({ role, balanceUserId, balanceMap, profiles, policiesSource, year }) {
  const showSelector = role === "admin" && Array.isArray(profiles) && profiles.length > 0;
  const staffProfiles = (profiles || []).filter(p => p && p.role !== "customer");
  const selectedProfile = balanceUserId ? staffProfiles.find(p => String(p.id) === String(balanceUserId)) : null;
  const selectedName = selectedProfile ? profileDisplayName(selectedProfile) : "—";
  const policiesNote = policiesSource === "default"
    ? `<span style="font-size:11px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:1px 8px">ใช้ค่า default (รัน supabase-phase92-35-leave-policies-balances.sql เพื่อตั้งค่าใน DB)</span>`
    : `<span style="font-size:11px;color:#475569">policies จาก DB</span>`;

  const cards = BALANCE_TYPE_ORDER
    .map(t => balanceMap?.get?.(t))
    .filter(Boolean);

  // ถ้าไม่มีพนักงาน → แสดง empty state
  if (!balanceUserId) {
    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px">
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:6px">💼 Balance / Quota (${escHtml(String(year))})</div>
        <div style="font-size:12px;color:#64748b">ยังไม่มีพนักงานให้เลือก</div>
      </div>
    `;
  }

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
        <div>
          <div style="font-size:14px;font-weight:800;color:#0f172a">💼 Balance / Quota (${escHtml(String(year))})</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${escHtml(selectedName)} · ${policiesNote}</div>
        </div>
        ${showSelector ? `
          <select id="lmBalanceUser" style="padding:5px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;max-width:100%">
            ${staffProfiles.map(p => {
              const sel = String(p.id) === String(balanceUserId) ? " selected" : "";
              const label = profileDisplayName(p) + (p.email ? ` (${p.email})` : "");
              return `<option value="${escHtml(String(p.id))}"${sel}>${escHtml(label)}</option>`;
            }).join("")}
          </select>
        ` : ""}
      </div>
      ${cards.length === 0
        ? `<div style="font-size:12px;color:#64748b">ยังไม่มี policy / ข้อมูล leave</div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
            ${cards.map(b => _renderBalanceCard(b)).join("")}
          </div>`
      }
    </div>
  `;
}

function _confirmDialog(message) {
  // ★ ใช้ window.confirm() เป็น fallback ที่เร็ว+เชื่อถือได้ (มีในทุกเบราว์เซอร์)
  // ตามคำขอ user: "approve/reject/cancel ต้อง confirm ก่อน"
  // (อย่าเปลี่ยนเป็น modal ที่ซับซ้อนเฟสนี้ — keep it minimal)
  return typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm(message)
    : true;
}

// ═══════════════════════════════════════════════════════════
//  Render entry point
// ═══════════════════════════════════════════════════════════

export async function renderLeaveManagementPage(ctx) {
  const { state, showToast, currentRole } = ctx;
  const container = document.getElementById("page-leave_management");
  if (!container) return;

  const role = currentRole?.() || "sales";
  const currentUserId = window.App?.state?.currentUser?.id
    || window._sbCurrentUser?.id
    || state?.currentUser?.id
    || null;

  container.innerHTML = renderSkeleton({ type: "table", count: 5 });

  // โหลด profiles + leaves ขนาน
  await _ensureProfilesLoaded(state);

  let leaves = [];
  let loadError = null;
  try {
    leaves = await _fetchLeaves();
  } catch (e) {
    loadError = e;
    if (e?.code === "NO_TABLE") {
      container.innerHTML = renderError({
        message: "ยังไม่ได้รัน SQL staff_leaves",
        detail: "เปิด Supabase SQL Editor → รัน supabase-phase92-32-leave-management.sql ก่อนใช้งาน",
        retryLabel: "ลองโหลดใหม่",
        retryId: "lmRetryBtn",
      });
      document.getElementById("lmRetryBtn")?.addEventListener("click", () => renderLeaveManagementPage(ctx));
      return;
    }
    container.innerHTML = renderError({
      message: "โหลดคำขอลาไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "lmRetryBtn",
    });
    document.getElementById("lmRetryBtn")?.addEventListener("click", () => renderLeaveManagementPage(ctx));
    return;
  }

  // ถ้า non-admin → กรองเฉพาะของตัวเอง (defensive — RLS ก็กรองให้แล้วฝั่ง server)
  if (role !== "admin" && currentUserId) {
    leaves = leaves.filter(r => String(r.user_id) === String(currentUserId));
  }

  const profiles = Array.isArray(state?.allProfiles) ? state.allProfiles : [];
  const profileMap = new Map();
  for (const p of profiles) if (p?.id) profileMap.set(String(p.id), p);

  // Phase 92.35: โหลด policies (graceful — fallback ไป defaults) + overrides ของผู้ที่ดู balance อยู่
  const currentYear = new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 4);
  let policies = defaultLeavePolicies();
  let policiesSource = "default";
  try {
    const pRes = await fetchLeavePolicies();
    if (pRes.ok && pRes.rows.length > 0) {
      policies = pRes.rows;
      policiesSource = "db";
    } else if (!pRes.ok && pRes.code !== "NO_TABLE") {
      // log แต่ไม่ block
      // eslint-disable-next-line no-console
      console.warn("[leave_management] fetchLeavePolicies fail:", pRes);
    }
  } catch (_e) { /* silent */ }

  let activeMonth  = _currentMonthKey();
  let activeStatus = "all";
  let activeType   = "all";
  let balanceUserId = role === "admin"
    ? (profiles.find(p => p && p.role !== "customer")?.id || currentUserId || null)
    : currentUserId;
  let balanceOverrides = []; // เปลี่ยนตาม balanceUserId

  async function _loadOverridesForBalance() {
    if (!balanceUserId) { balanceOverrides = []; return; }
    try {
      const oRes = await fetchLeaveOverridesForUser(balanceUserId, Number(currentYear));
      balanceOverrides = (oRes.ok && Array.isArray(oRes.rows)) ? oRes.rows : [];
    } catch (_e) {
      balanceOverrides = [];
    }
  }
  await _loadOverridesForBalance();

  function _rerender() {
    const summary = summarizeLeaves(leaves, activeMonth);
    const filtered = filterLeaves(leaves, {
      month: activeMonth,
      status: activeStatus,
      leaveType: activeType,
      // ไม่ใส่ userId ที่ filter ฝั่ง client เพราะกรองตอนโหลดแล้ว
    });

    const monthTh = activeMonth ? new Date(activeMonth + "-01T00:00:00+07:00").toLocaleDateString("th-TH", {
      timeZone: TZ, year: "numeric", month: "long"
    }) : "ทุกเดือน";

    // Phase 92.35: คำนวณ balance ของ user ที่เลือก (admin) / ของตัวเอง (non-admin)
    const balanceLeaves = balanceUserId
      ? leaves.filter(r => String(r.user_id) === String(balanceUserId))
      : [];
    const balanceMap = balanceUserId
      ? calcBalancesForUser({ userId: balanceUserId, year: Number(currentYear), leaves: balanceLeaves, policies, overrides: balanceOverrides })
      : new Map();

    container.innerHTML = `
      <div style="padding:8px;display:flex;flex-direction:column;gap:14px">

        <!-- Header -->
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;padding:6px 2px">
          <div>
            <h2 style="margin:0 0 2px;font-size:20px;color:#0f172a">🌴 วันลา</h2>
            <div style="font-size:12px;color:#64748b">${escHtml(monthTh)} · ${role === "admin" ? "Admin view" : "ของฉัน"}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button id="lmRefreshBtn" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#0f172a;font-size:12px;font-weight:700;cursor:pointer">⟳ รีเฟรช</button>
            <button id="lmCreateBtn" style="padding:8px 14px;border:1px solid #0284c7;border-radius:10px;background:#0284c7;color:#fff;font-size:12px;font-weight:700;cursor:pointer">+ ขอลา</button>
          </div>
        </div>

        <!-- KPI cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
          ${_kpiCard({ label: "รออนุมัติ",       value: NUM_TH(summary.pending),      sub: "ทุกเดือน",        color: summary.pending > 0 ? "#ea580c" : "#0f172a", icon: "⏳" })}
          ${_kpiCard({ label: "อนุมัติแล้ว",     value: NUM_TH(summary.approved),     sub: escHtml(monthTh),  color: "#16a34a", icon: "✅" })}
          ${_kpiCard({ label: "ปฏิเสธ",         value: NUM_TH(summary.rejected),     sub: escHtml(monthTh),  color: "#dc2626", icon: "✕"  })}
          ${_kpiCard({ label: "รวมวันที่อนุมัติ", value: NUM_TH(summary.approvedDays), sub: escHtml(monthTh),  color: "#0284c7", icon: "📅" })}
        </div>

        <!-- Phase 92.35: Balance / Quota section -->
        ${_renderBalanceSection({
          role,
          balanceUserId,
          balanceMap,
          profiles,
          policiesSource,
          year: Number(currentYear),
        })}

        <!-- Filters + table -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
          <div style="padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:#fafbfc">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;color:#64748b;font-weight:700">เดือน:</span>
              <input id="lmMonth" type="month" value="${escHtml(activeMonth)}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px" />
              <button id="lmMonthClear" type="button" style="padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#475569;font-size:11px;cursor:pointer">ทุกเดือน</button>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;color:#64748b;font-weight:700">สถานะ:</span>
              <select id="lmStatus" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">
                <option value="all"${activeStatus === "all" ? " selected" : ""}>ทั้งหมด</option>
                ${LEAVE_STATUSES.map(s => `<option value="${escHtml(s)}"${activeStatus === s ? " selected" : ""}>${escHtml(leaveStatusMeta(s).label)}</option>`).join("")}
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;color:#64748b;font-weight:700">ประเภท:</span>
              <select id="lmType" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">
                <option value="all"${activeType === "all" ? " selected" : ""}>ทั้งหมด</option>
                ${LEAVE_TYPES.map(t => `<option value="${escHtml(t)}"${activeType === t ? " selected" : ""}>${escHtml(leaveTypeLabel(t).label)}</option>`).join("")}
              </select>
            </div>
            <button id="lmExportBtn" style="margin-left:auto;padding:6px 12px;border:1px solid #16a34a;border-radius:8px;background:#fff;color:#16a34a;font-size:11px;font-weight:700;cursor:pointer">📥 Export</button>
          </div>

          <div style="padding:8px 14px;border-bottom:1px solid #f1f5f9;background:#fff;font-size:12px;color:#475569">
            แสดง ${NUM_TH(filtered.length)} จาก ${NUM_TH(leaves.length)} รายการ
          </div>

          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:840px">
              <thead style="background:#f8fafc">
                <tr>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">พนักงาน</th>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">ประเภท</th>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">ช่วงวันที่</th>
                  <th style="padding:10px 14px;text-align:right;font-weight:700;color:#475569">วัน</th>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">เหตุผล</th>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">สถานะ</th>
                  <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">ผู้พิจารณา</th>
                  <th style="padding:10px 14px;text-align:right;font-weight:700;color:#475569">Action</th>
                </tr>
              </thead>
              <tbody id="lmTbody">
                ${_renderTbody(filtered, profileMap, currentUserId, role)}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Form / review modals (hidden initially) -->
      <div id="lmModal" style="display:none;position:fixed;inset:0;z-index:9999"></div>
    `;

    // ── Bind events ─────────────────────────────────────────
    document.getElementById("lmRefreshBtn")?.addEventListener("click", () => renderLeaveManagementPage(ctx));

    document.getElementById("lmMonth")?.addEventListener("change", (ev) => {
      activeMonth = ev.target.value || "";
      _rerender();
    });
    document.getElementById("lmMonthClear")?.addEventListener("click", () => {
      activeMonth = "";
      _rerender();
    });
    document.getElementById("lmStatus")?.addEventListener("change", (ev) => {
      activeStatus = ev.target.value || "all";
      _rerender();
    });
    document.getElementById("lmType")?.addEventListener("change", (ev) => {
      activeType = ev.target.value || "all";
      _rerender();
    });

    document.getElementById("lmCreateBtn")?.addEventListener("click", () => _openFormModal(null));
    document.getElementById("lmExportBtn")?.addEventListener("click", () => _doExport(filtered));

    // Phase 92.35: เปลี่ยน user สำหรับ balance section (admin only)
    document.getElementById("lmBalanceUser")?.addEventListener("change", async (ev) => {
      const next = ev.target.value || null;
      if (!next || next === balanceUserId) return;
      balanceUserId = next;
      await _loadOverridesForBalance();
      _rerender();
    });

    // Row action delegation
    const tbody = document.getElementById("lmTbody");
    tbody?.addEventListener("click", async (ev) => {
      const approveBtn = ev.target.closest(".lm-row-approve");
      const rejectBtn  = ev.target.closest(".lm-row-reject");
      const cancelBtn  = ev.target.closest(".lm-row-cancel");
      const deleteBtn  = ev.target.closest(".lm-row-delete");
      if (approveBtn) return _doReview(approveBtn.getAttribute("data-lm-id"), "approved");
      if (rejectBtn)  return _doReview(rejectBtn.getAttribute("data-lm-id"),  "rejected");
      if (cancelBtn)  return _doCancel(cancelBtn.getAttribute("data-lm-id"));
      if (deleteBtn)  return _doDelete(deleteBtn.getAttribute("data-lm-id"));
    });
  }

  // ── Mutation handlers ───────────────────────────────────────

  function _findLeave(id) {
    return leaves.find(r => String(r.id) === String(id)) || null;
  }

  async function _doReview(id, decision) {
    const row = _findLeave(id);
    if (!row) return;
    if (!canReviewLeave(row, role)) { showToast?.("ไม่มีสิทธิ์"); return; }
    const decisionLabel = decision === "approved" ? "อนุมัติ" : "ปฏิเสธ";
    const note = window.prompt(`หมายเหตุ (optional) สำหรับการ${decisionLabel}คำขอนี้:`);
    if (note === null) return; // user pressed cancel
    if (!_confirmDialog(`ยืนยัน${decisionLabel}คำขอลานี้?`)) return;
    try {
      const patch = {
        status: decision,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        review_note: note.trim() || null,
      };
      const updated = await _patchLeave(row.id, patch);
      // อัปเดต local cache
      const i = leaves.findIndex(r => String(r.id) === String(row.id));
      if (i >= 0 && Array.isArray(updated) && updated[0]) leaves[i] = updated[0];
      showToast?.(`✓ ${decisionLabel}เรียบร้อย`);
      _rerender();
    } catch (e) {
      showToast?.("ผิดพลาด: " + (e?.message || e));
    }
  }

  async function _doCancel(id) {
    const row = _findLeave(id);
    if (!row) return;
    if (!canEditLeave(row, currentUserId, role)) { showToast?.("ไม่มีสิทธิ์"); return; }
    if (!_confirmDialog("ยกเลิกคำขอลานี้?")) return;
    try {
      const updated = await _patchLeave(row.id, { status: "cancelled" });
      const i = leaves.findIndex(r => String(r.id) === String(row.id));
      if (i >= 0 && Array.isArray(updated) && updated[0]) leaves[i] = updated[0];
      showToast?.("ยกเลิกเรียบร้อย");
      _rerender();
    } catch (e) {
      showToast?.("ผิดพลาด: " + (e?.message || e));
    }
  }

  async function _doDelete(id) {
    if (role !== "admin") { showToast?.("เฉพาะ admin"); return; }
    if (!_confirmDialog("ลบรายการนี้ถาวร? (ไม่สามารถ undo ได้)")) return;
    try {
      const cfg = window.SUPABASE_CONFIG;
      const r = await fetch(`${cfg.url}/rest/v1/staff_leaves?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE", headers: _sbHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      leaves = leaves.filter(x => String(x.id) !== String(id));
      showToast?.("ลบเรียบร้อย");
      _rerender();
    } catch (e) {
      showToast?.("ผิดพลาด: " + (e?.message || e));
    }
  }

  async function _doExport(rowsToExport) {
    try {
      const data = rowsToExport.map(r => {
        const p = profileMap.get(String(r.user_id));
        return {
          "พนักงาน": p ? profileDisplayName(p) : "",
          "อีเมล": p?.email || "",
          "ประเภท": leaveTypeLabel(r.leave_type).label,
          "ตั้งแต่": String(r.start_date || "").slice(0, 10),
          "ถึง": String(r.end_date || "").slice(0, 10),
          "วัน": Number(r.days_count || 0),
          "เหตุผล": r.reason || "",
          "สถานะ": leaveStatusMeta(r.status).label,
          "หมายเหตุพิจารณา": r.review_note || "",
        };
      });
      const ok = exportToExcel(`leave_management_${todaySuffix()}.xlsx`, data, "Leave");
      if (ok) showToast?.("📥 Export สำเร็จ"); else showToast?.("ไม่สามารถ Export ได้");
    } catch (e) {
      showToast?.("Export ผิดพลาด: " + (e?.message || e));
    }
  }

  function _openFormModal(existing) {
    const modal = document.getElementById("lmModal");
    if (!modal) return;

    const isAdmin = role === "admin";
    const staffProfiles = profiles.filter(p => p && p.role !== "customer");
    const defaultUserId = existing?.user_id || (isAdmin ? "" : currentUserId);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

    modal.style.display = "block";
    document.body.style.overflow = "hidden";
    modal.innerHTML = `
      <div id="lmModalBackdrop" style="position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px)"></div>
      <div role="dialog" aria-modal="true" aria-label="แบบฟอร์มคำขอลา" style="position:relative;max-width:560px;width:calc(100% - 24px);margin:24px auto;background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.25);max-height:calc(100vh - 48px);overflow-y:auto">
        <div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:16px;font-weight:800;color:#0f172a">${existing ? "แก้ไขคำขอลา" : "ขอลาใหม่"}</div>
          <button id="lmFormClose" aria-label="ปิด" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#475569;font-size:14px;cursor:pointer">✕</button>
        </div>
        <form id="lmForm" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
          ${isAdmin ? `
            <label style="font-size:12px;color:#475569;font-weight:700">พนักงาน
              <select id="lmFormUser" required style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px">
                <option value="">-- เลือกพนักงาน --</option>
                ${_profileOptions(staffProfiles, defaultUserId)}
              </select>
            </label>
          ` : `<input type="hidden" id="lmFormUser" value="${escHtml(String(currentUserId || ""))}" />`}

          <label style="font-size:12px;color:#475569;font-weight:700">ประเภท
            <select id="lmFormType" required style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px">
              ${LEAVE_TYPES.map(t => `<option value="${escHtml(t)}"${existing?.leave_type === t ? " selected" : ""}>${escHtml(leaveTypeLabel(t).icon + " " + leaveTypeLabel(t).label)}</option>`).join("")}
            </select>
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label style="font-size:12px;color:#475569;font-weight:700">ตั้งแต่
              <input id="lmFormStart" type="date" required value="${escHtml(existing?.start_date || today)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px" />
            </label>
            <label style="font-size:12px;color:#475569;font-weight:700">ถึง
              <input id="lmFormEnd" type="date" required value="${escHtml(existing?.end_date || today)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px" />
            </label>
          </div>

          <label style="font-size:12px;color:#475569;font-weight:700">จำนวนวัน (auto-calc — แก้ได้ถ้าครึ่งวัน)
            <input id="lmFormDays" type="number" step="0.5" min="0.5" required value="${escHtml(String(existing?.days_count || calcLeaveDays(today, today)))}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px" />
          </label>

          <label style="font-size:12px;color:#475569;font-weight:700">เหตุผล (optional)
            <textarea id="lmFormReason" rows="2" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;font-size:13px;resize:vertical">${escHtml(existing?.reason || "")}</textarea>
          </label>

          <!-- Phase 92.35: quota warning (advisory) -->
          <div id="lmFormQuotaWarn" style="display:none;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 12px;border-radius:8px;font-size:12px"></div>

          <div id="lmFormError" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:8px 12px;border-radius:8px;font-size:12px"></div>

          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid #f1f5f9">
            <button type="button" id="lmFormCancel" style="padding:8px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#475569;font-size:12px;font-weight:700;cursor:pointer">ยกเลิก</button>
            <button type="submit" id="lmFormSubmit" style="padding:8px 14px;border:1px solid #0284c7;border-radius:8px;background:#0284c7;color:#fff;font-size:12px;font-weight:700;cursor:pointer">${existing ? "บันทึก" : "ส่งคำขอ"}</button>
          </div>
        </form>
      </div>
    `;

    const closeModal = () => {
      modal.style.display = "none";
      modal.innerHTML = "";
      document.body.style.overflow = "";
    };

    modal.querySelector("#lmFormClose")?.addEventListener("click", closeModal);
    modal.querySelector("#lmFormCancel")?.addEventListener("click", closeModal);
    modal.querySelector("#lmModalBackdrop")?.addEventListener("click", closeModal);

    // Auto-recalc days when dates change
    const startInput = modal.querySelector("#lmFormStart");
    const endInput   = modal.querySelector("#lmFormEnd");
    const daysInput  = modal.querySelector("#lmFormDays");
    const recalc = () => {
      const d = calcLeaveDays(startInput.value, endInput.value);
      if (d > 0) daysInput.value = String(d);
      _refreshQuotaWarn();
    };
    startInput?.addEventListener("change", recalc);
    endInput?.addEventListener("change", recalc);

    // Phase 92.35: quota warning (advisory — ไม่ block submit)
    const quotaWarnBox = modal.querySelector("#lmFormQuotaWarn");
    function _refreshQuotaWarn() {
      if (!quotaWarnBox) return;
      const uid = modal.querySelector("#lmFormUser")?.value || currentUserId || "";
      const lt  = modal.querySelector("#lmFormType")?.value || "";
      const newDays = Number(daysInput?.value || 0);
      if (!uid || !lt || !(newDays > 0)) { quotaWarnBox.style.display = "none"; return; }
      // ใช้ leaves ที่ load แล้วใน scope renderLeaveManagementPage (admin = all leaves, non-admin = own)
      const userLeaves = leaves.filter(r => String(r.user_id) === String(uid));
      const bMap = calcBalancesForUser({
        userId: uid, year: Number(currentYear), leaves: userLeaves, policies, overrides: balanceOverrides
      });
      const b = bMap.get(lt);
      if (!b || !b.tracksBalance || b.quota == null) { quotaWarnBox.style.display = "none"; return; }
      // projected: used + pending + newDays (ถ้า existing → ลบ existing.days_count ที่นับเข้าไปแล้วใน leaves)
      const existingDays = existing && existing.status === "pending" && String(existing.user_id) === String(uid) && existing.leave_type === lt
        ? Number(existing.days_count || 0) : 0;
      const projectedPending = (b.pending - existingDays) + newDays;
      const projectedTotal = b.used + projectedPending;
      const overBy = projectedTotal - b.quota;
      if (overBy > 0) {
        quotaWarnBox.innerHTML = `⚠️ จะเกิน quota <strong>${overBy.toFixed(2)}</strong> วัน (${leaveTypeLabel(lt).label}: ใช้แล้ว ${b.used}/${b.quota}, รออนุมัติรวมคำขอนี้ ${projectedPending.toFixed(2)} วัน) — ส่งได้ แต่ admin ต้องอนุมัติด้วยดุลพินิจ`;
        quotaWarnBox.style.display = "block";
      } else {
        quotaWarnBox.style.display = "none";
      }
    }
    modal.querySelector("#lmFormUser")?.addEventListener("change", _refreshQuotaWarn);
    modal.querySelector("#lmFormType")?.addEventListener("change", _refreshQuotaWarn);
    daysInput?.addEventListener("input", _refreshQuotaWarn);
    _refreshQuotaWarn(); // initial check

    modal.querySelector("#lmForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const errBox = modal.querySelector("#lmFormError");
      errBox.style.display = "none";
      errBox.textContent = "";

      const userIdVal = modal.querySelector("#lmFormUser")?.value || currentUserId || "";
      const leaveType = modal.querySelector("#lmFormType")?.value || "";
      const startDate = modal.querySelector("#lmFormStart")?.value || "";
      const endDate   = modal.querySelector("#lmFormEnd")?.value   || "";
      const daysVal   = Number(modal.querySelector("#lmFormDays")?.value || 0);
      const reason    = (modal.querySelector("#lmFormReason")?.value || "").trim();

      if (!userIdVal) { errBox.textContent = "เลือกพนักงาน"; errBox.style.display = "block"; return; }
      if (!LEAVE_TYPES.includes(leaveType)) { errBox.textContent = "เลือกประเภทลา"; errBox.style.display = "block"; return; }
      if (!startDate || !endDate) { errBox.textContent = "กรอกวันที่ครบ"; errBox.style.display = "block"; return; }
      if (endDate < startDate) { errBox.textContent = "วันที่สิ้นสุดต้อง >= วันที่เริ่ม"; errBox.style.display = "block"; return; }
      if (!(daysVal > 0)) { errBox.textContent = "จำนวนวันต้องมากกว่า 0"; errBox.style.display = "block"; return; }

      const body = {
        user_id: userIdVal,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysVal,
        reason: reason || null,
        status: "pending",
        created_by: currentUserId,
      };

      const submitBtn = modal.querySelector("#lmFormSubmit");
      submitBtn.disabled = true;
      const orig = submitBtn.textContent;
      submitBtn.textContent = "⏳ กำลังบันทึก...";
      try {
        const inserted = await _insertLeave(body);
        if (Array.isArray(inserted) && inserted[0]) {
          leaves.unshift(inserted[0]);
        }
        showToast?.("✓ บันทึกคำขอลาเรียบร้อย");
        closeModal();
        _rerender();
      } catch (e) {
        errBox.textContent = e?.message || String(e);
        errBox.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = orig;
      }
    });
  }

  _rerender();
}

/**
 * Phase 92.32: Lightweight helper สำหรับ HR Overview integration
 * ดึงแค่ count ของ pending — graceful ถ้าตาราง staff_leaves ยังไม่มี
 * @returns {Promise<number>} pending count (0 ถ้า fetch fail/no-table)
 */
export async function fetchPendingLeaveCount() {
  try {
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg?.url) return 0;
    const r = await fetch(`${cfg.url}/rest/v1/staff_leaves?select=id&status=eq.pending&limit=200`, {
      headers: _sbHeaders(),
    });
    if (!r.ok) return 0;
    const arr = await r.json();
    return Array.isArray(arr) ? arr.length : 0;
  } catch (_e) {
    return 0;
  }
}
