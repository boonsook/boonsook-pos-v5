// Phase 92.32 — Unit tests for modules/leave_management.js pure helpers
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  calcLeaveDays,
  leaveTypeLabel,
  leaveStatusMeta,
  filterLeaves,
  summarizeLeaves,
  canEditLeave,
  canReviewLeave,
  // Phase 92.33
  summarizeApprovedLeavesForPayroll,
  calcUnpaidLeaveDeduction,
  fetchApprovedLeavesForUser,
  // Phase 92.35
  defaultLeavePolicies,
  effectiveQuotaForUser,
  calcLeaveBalance,
  calcBalancesForUser,
  isOverQuotaWarning,
  formatBalanceLabel,
  fetchLeavePolicies,
  fetchLeaveOverridesForUser,
  // Phase 92.36
  decidePayrollLeaveImpact,
  leaveDeductionNoteMarker,
  hasLeaveDeductionNoteMarker,
  // Phase 92.38
  expandLeaveRangeToMonthDays,
  groupLeavesByDate,
  getCalendarMonthGrid,
  // Phase 92.39
  groupCalendarAgendaDays,
  limitCalendarDayEvents,
  formatAgendaDateLabel,
  // Phase 92.40
  calendarDetailActionsFor,
  formatReviewedAt,
  // Phase 92.41c
  countPendingLeaves,
  pendingLeaveAlertMeta,
  // Phase 92.42
  kpiFilterActionFor,
  balanceFilterActionFor,
} = await import("../modules/leave_management.js");

// ── calcLeaveDays ───────────────────────────────────────────

test("calcLeaveDays — วันเดียว → 1 (inclusive)", () => {
  assert.equal(calcLeaveDays("2026-05-26", "2026-05-26"), 1);
});

test("calcLeaveDays — multi day → จำนวนวัน inclusive", () => {
  assert.equal(calcLeaveDays("2026-05-26", "2026-05-30"), 5);
  assert.equal(calcLeaveDays("2026-05-01", "2026-05-31"), 31);
});

test("calcLeaveDays — end < start → 0 (invalid)", () => {
  assert.equal(calcLeaveDays("2026-05-30", "2026-05-26"), 0);
});

test("calcLeaveDays — null/empty/invalid → 0", () => {
  assert.equal(calcLeaveDays(null, "2026-05-26"), 0);
  assert.equal(calcLeaveDays("2026-05-26", null), 0);
  assert.equal(calcLeaveDays("", ""), 0);
  assert.equal(calcLeaveDays("not-a-date", "2026-05-26"), 0);
});

// ── leaveTypeLabel ──────────────────────────────────────────

test("leaveTypeLabel — รู้จัก 5 types", () => {
  for (const t of ["sick", "personal", "vacation", "unpaid", "other"]) {
    const m = leaveTypeLabel(t);
    assert.ok(m.label && m.icon && m.bg && m.fg && m.border, `type ${t} missing fields`);
  }
});

test("leaveTypeLabel — fallback ใช้ type string เมื่อ unknown", () => {
  const m = leaveTypeLabel("weird");
  assert.equal(m.label, "weird");
  assert.equal(m.icon, "❔");
});

test("leaveTypeLabel — null → label '—'", () => {
  assert.equal(leaveTypeLabel(null).label, "—");
});

// ── leaveStatusMeta ─────────────────────────────────────────

test("leaveStatusMeta — รู้จัก 4 statuses", () => {
  for (const s of ["pending", "approved", "rejected", "cancelled"]) {
    const m = leaveStatusMeta(s);
    assert.ok(m.label && m.bg && m.fg && m.border);
  }
});

test("leaveStatusMeta — แต่ละ status สีต่างกัน", () => {
  const colors = ["pending", "approved", "rejected", "cancelled"].map(s => leaveStatusMeta(s).bg);
  assert.equal(new Set(colors).size, 4);
});

test("leaveStatusMeta — fallback ใช้ status string เมื่อ unknown", () => {
  assert.equal(leaveStatusMeta("weird").label, "weird");
  assert.equal(leaveStatusMeta(null).label, "—");
});

// ── filterLeaves ────────────────────────────────────────────

const SAMPLE_LEAVES = [
  { id: 1, user_id: "u1", status: "pending",   leave_type: "sick",     start_date: "2026-05-10", end_date: "2026-05-12", days_count: 3 },
  { id: 2, user_id: "u2", status: "approved",  leave_type: "vacation", start_date: "2026-05-20", end_date: "2026-05-22", days_count: 3 },
  { id: 3, user_id: "u1", status: "approved",  leave_type: "personal", start_date: "2026-05-05", end_date: "2026-05-05", days_count: 1 },
  { id: 4, user_id: "u3", status: "rejected",  leave_type: "unpaid",   start_date: "2026-04-25", end_date: "2026-04-27", days_count: 3 },
  { id: 5, user_id: "u1", status: "cancelled", leave_type: "sick",     start_date: "2026-06-01", end_date: "2026-06-01", days_count: 1 },
  { id: 6, user_id: "u2", status: "approved",  leave_type: "vacation", start_date: "2026-04-28", end_date: "2026-05-02", days_count: 5 }, // overlap เดือน
];

test("filterLeaves — default → คืน rows ทั้งหมด", () => {
  assert.equal(filterLeaves(SAMPLE_LEAVES, {}).length, 6);
  assert.equal(filterLeaves(SAMPLE_LEAVES).length, 6);
});

test("filterLeaves — by status only", () => {
  assert.equal(filterLeaves(SAMPLE_LEAVES, { status: "approved" }).length, 3);
  assert.equal(filterLeaves(SAMPLE_LEAVES, { status: "pending" }).length, 1);
});

test("filterLeaves — by leaveType only", () => {
  assert.equal(filterLeaves(SAMPLE_LEAVES, { leaveType: "sick" }).length, 2);
  assert.equal(filterLeaves(SAMPLE_LEAVES, { leaveType: "vacation" }).length, 2);
});

test("filterLeaves — by userId only", () => {
  assert.equal(filterLeaves(SAMPLE_LEAVES, { userId: "u1" }).length, 3);
  assert.equal(filterLeaves(SAMPLE_LEAVES, { userId: "u2" }).length, 2);
});

test("filterLeaves — by month — overlap (start IN, end IN, both span)", () => {
  // เดือน 2026-05 → ids: 1, 2, 3, 6 (overlap)
  const out = filterLeaves(SAMPLE_LEAVES, { month: "2026-05" });
  const ids = out.map(r => r.id).sort();
  assert.deepEqual(ids, [1, 2, 3, 6]);
});

test("filterLeaves — combined: month + status + type", () => {
  const out = filterLeaves(SAMPLE_LEAVES, { month: "2026-05", status: "approved", leaveType: "vacation" });
  assert.equal(out.length, 2); // ids 2, 6
});

test("filterLeaves — non-array → []", () => {
  assert.deepEqual(filterLeaves(null, {}), []);
});

// ── summarizeLeaves ─────────────────────────────────────────

test("summarizeLeaves — รวม counts + approvedDays (no month filter)", () => {
  const s = summarizeLeaves(SAMPLE_LEAVES);
  assert.equal(s.total, 6);
  assert.equal(s.pending, 1);
  assert.equal(s.approved, 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.approvedDays, 9); // 3 + 1 + 5
});

test("summarizeLeaves — month filter → counts รวมเฉพาะของเดือนนั้น", () => {
  // เดือน 2026-05 → approved ids 2,3,6 → days 3+1+5 = 9
  const s = summarizeLeaves(SAMPLE_LEAVES, "2026-05");
  assert.equal(s.approved, 3);
  assert.equal(s.approvedDays, 9);
  assert.equal(s.pending, 1);
});

test("summarizeLeaves — empty/non-array → 0 ทุก field", () => {
  const s = summarizeLeaves([], "2026-05");
  assert.equal(s.total, 0);
  assert.equal(s.approvedDays, 0);
  assert.deepEqual(summarizeLeaves(null), { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0, approvedDays: 0 });
});

// ── canEditLeave ────────────────────────────────────────────

test("canEditLeave — admin → true ทุก row", () => {
  assert.equal(canEditLeave({ user_id: "u1", status: "approved" }, "any", "admin"), true);
  assert.equal(canEditLeave({ user_id: "u2", status: "rejected" }, "any", "admin"), true);
});

test("canEditLeave — own pending → true (non-admin)", () => {
  assert.equal(canEditLeave({ user_id: "u1", status: "pending" }, "u1", "sales"), true);
});

test("canEditLeave — own approved → false (locked)", () => {
  assert.equal(canEditLeave({ user_id: "u1", status: "approved" }, "u1", "sales"), false);
});

test("canEditLeave — ของคนอื่น → false (non-admin)", () => {
  assert.equal(canEditLeave({ user_id: "u1", status: "pending" }, "u2", "sales"), false);
});

test("canEditLeave — null row/userId → false", () => {
  assert.equal(canEditLeave(null, "u1", "sales"), false);
  assert.equal(canEditLeave({ user_id: "u1", status: "pending" }, "", "sales"), false);
});

// ── canReviewLeave ──────────────────────────────────────────

test("canReviewLeave — admin + pending → true", () => {
  assert.equal(canReviewLeave({ status: "pending" }, "admin"), true);
});

test("canReviewLeave — non-admin → false (ทุกสถานะ)", () => {
  assert.equal(canReviewLeave({ status: "pending" }, "sales"), false);
  assert.equal(canReviewLeave({ status: "pending" }, "technician"), false);
});

test("canReviewLeave — admin + status อื่น → false (กัน double-review)", () => {
  assert.equal(canReviewLeave({ status: "approved" }, "admin"), false);
  assert.equal(canReviewLeave({ status: "rejected" }, "admin"), false);
  assert.equal(canReviewLeave({ status: "cancelled" }, "admin"), false);
});

test("canReviewLeave — null row → false", () => {
  assert.equal(canReviewLeave(null, "admin"), false);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.33 — Leave → Payroll integration helpers
// ═══════════════════════════════════════════════════════════

// ── summarizeApprovedLeavesForPayroll ───────────────────────

test("summarizeApprovedLeavesForPayroll — input ว่าง/non-array → ทุกค่า 0", () => {
  const zero = { totalApprovedDays:0, unpaidDays:0, sickDays:0, personalDays:0, vacationDays:0, otherDays:0, records:0 };
  assert.deepEqual(summarizeApprovedLeavesForPayroll([]), zero);
  assert.deepEqual(summarizeApprovedLeavesForPayroll(null), zero);
});

test("summarizeApprovedLeavesForPayroll — แยก by leave_type ถูก", () => {
  const rows = [
    { status: "approved", leave_type: "sick",     days_count: 2 },
    { status: "approved", leave_type: "personal", days_count: 1 },
    { status: "approved", leave_type: "vacation", days_count: 5 },
    { status: "approved", leave_type: "unpaid",   days_count: 3 },
    { status: "approved", leave_type: "other",    days_count: 0.5 },
  ];
  const s = summarizeApprovedLeavesForPayroll(rows);
  assert.equal(s.records, 5);
  assert.equal(s.totalApprovedDays, 11.5);
  assert.equal(s.sickDays, 2);
  assert.equal(s.personalDays, 1);
  assert.equal(s.vacationDays, 5);
  assert.equal(s.unpaidDays, 3);
  assert.equal(s.otherDays, 0.5);
});

test("summarizeApprovedLeavesForPayroll — skip non-approved + invalid days", () => {
  const rows = [
    { status: "approved",  leave_type: "unpaid", days_count: 2 },
    { status: "pending",   leave_type: "unpaid", days_count: 5 }, // skip
    { status: "rejected",  leave_type: "unpaid", days_count: 3 }, // skip
    { status: "cancelled", leave_type: "unpaid", days_count: 4 }, // skip
    { status: "approved",  leave_type: "unpaid", days_count: 0 }, // skip (days<=0)
    { status: "approved",  leave_type: "unpaid", days_count: -1 }, // skip
    { status: "approved",  leave_type: "unpaid", days_count: "abc" }, // skip (NaN)
  ];
  const s = summarizeApprovedLeavesForPayroll(rows);
  assert.equal(s.records, 1);
  assert.equal(s.unpaidDays, 2);
});

test("summarizeApprovedLeavesForPayroll — leave_type unknown → otherDays bucket", () => {
  const rows = [{ status: "approved", leave_type: "weird_type", days_count: 1.5 }];
  const s = summarizeApprovedLeavesForPayroll(rows);
  assert.equal(s.otherDays, 1.5);
  assert.equal(s.totalApprovedDays, 1.5);
});

test("summarizeApprovedLeavesForPayroll — ปัด 2 ตำแหน่ง (กัน float drift)", () => {
  const rows = [
    { status: "approved", leave_type: "sick", days_count: 0.1 },
    { status: "approved", leave_type: "sick", days_count: 0.2 },
  ];
  const s = summarizeApprovedLeavesForPayroll(rows);
  // 0.1 + 0.2 = 0.30000000000000004 → ต้องปัดเป็น 0.3
  assert.equal(s.sickDays, 0.3);
  assert.equal(s.totalApprovedDays, 0.3);
});

// ── calcUnpaidLeaveDeduction ───────────────────────────────

test("calcUnpaidLeaveDeduction — dailyRate priority 1: days × rate", () => {
  const amt = calcUnpaidLeaveDeduction({ unpaidDays: 3, dailyRate: 500, baseSalary: 30000 });
  assert.equal(amt, 1500); // 3 × 500
});

test("calcUnpaidLeaveDeduction — fallback baseSalary/30 ถ้าไม่มี dailyRate", () => {
  const amt = calcUnpaidLeaveDeduction({ unpaidDays: 3, baseSalary: 30000 });
  assert.equal(amt, 3000); // 30000/30 × 3
});

test("calcUnpaidLeaveDeduction — invalid → 0", () => {
  assert.equal(calcUnpaidLeaveDeduction({}), 0);
  assert.equal(calcUnpaidLeaveDeduction({ unpaidDays: 0, dailyRate: 500 }), 0);
  assert.equal(calcUnpaidLeaveDeduction({ unpaidDays: -1, dailyRate: 500 }), 0);
  assert.equal(calcUnpaidLeaveDeduction({ unpaidDays: 3 }), 0); // no rate, no base
  assert.equal(calcUnpaidLeaveDeduction({ unpaidDays: 3, dailyRate: 0, baseSalary: 0 }), 0);
  assert.equal(calcUnpaidLeaveDeduction({ unpaidDays: "abc", dailyRate: 500 }), 0);
});

test("calcUnpaidLeaveDeduction — ปัด 2 ตำแหน่ง (money safe)", () => {
  // 30000 / 30 = 1000.0 — ดี
  // แต่ baseSalary=31000 / 30 = 1033.3333... × 1.5 (ครึ่งวัน) → ต้องปัด
  const amt = calcUnpaidLeaveDeduction({ unpaidDays: 1.5, baseSalary: 31000 });
  assert.equal(amt, 1550); // (31000/30) * 1.5 = 1550 exactly
  const amt2 = calcUnpaidLeaveDeduction({ unpaidDays: 1, baseSalary: 31000 });
  assert.equal(amt2, 1033.33); // 31000/30 = 1033.3333... → ปัดเป็น 1033.33
});

test("calcUnpaidLeaveDeduction — dailyRate < 0 → fallback baseSalary", () => {
  // negative dailyRate ไม่ใช่ "valid > 0" → ข้ามไปใช้ baseSalary
  const amt = calcUnpaidLeaveDeduction({ unpaidDays: 2, dailyRate: -100, baseSalary: 30000 });
  assert.equal(amt, 2000); // 30000/30 × 2
});

// ── fetchApprovedLeavesForUser ─────────────────────────────

test("fetchApprovedLeavesForUser — missing args → BAD_INPUT (no fetch)", async () => {
  const r1 = await fetchApprovedLeavesForUser("", "2026-05-01", "2026-05-31");
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "BAD_INPUT");
  const r2 = await fetchApprovedLeavesForUser("u1", "", "2026-05-31");
  assert.equal(r2.code, "BAD_INPUT");
  const r3 = await fetchApprovedLeavesForUser("u1", "2026-05-01", null);
  assert.equal(r3.code, "BAD_INPUT");
});

test("fetchApprovedLeavesForUser — ไม่มี SUPABASE_CONFIG → NO_CONFIG", async () => {
  // node test env: ไม่มี window.SUPABASE_CONFIG
  const r = await fetchApprovedLeavesForUser("u1", "2026-05-01", "2026-05-31");
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_CONFIG");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.35 — Leave Policy + Balance/Quota helpers
// ═══════════════════════════════════════════════════════════

// ── defaultLeavePolicies ────────────────────────────────────

test("defaultLeavePolicies — มี 5 types ครบ + quota ตามที่ออกแบบ", () => {
  const p = defaultLeavePolicies();
  assert.equal(p.length, 5);
  const v = p.find(x => x.leave_type === "vacation");
  const s = p.find(x => x.leave_type === "sick");
  const ps = p.find(x => x.leave_type === "personal");
  const u = p.find(x => x.leave_type === "unpaid");
  const o = p.find(x => x.leave_type === "other");
  assert.equal(v.annual_quota, 10);
  assert.equal(s.annual_quota, 30);
  assert.equal(ps.annual_quota, 3);
  assert.equal(u.annual_quota, null);
  assert.equal(o.annual_quota, null);
  assert.equal(v.tracks_balance, true);
  assert.equal(u.tracks_balance, false);
  assert.equal(o.tracks_balance, false);
});

// ── effectiveQuotaForUser ───────────────────────────────────

test("effectiveQuotaForUser — override priority over policy", () => {
  const policies = defaultLeavePolicies();
  const overrides = [{ user_id: "u1", leave_type: "vacation", effective_year: 2026, annual_quota: 15 }];
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "vacation", year: 2026, policies, overrides });
  assert.equal(r.quota, 15);
  assert.equal(r.source, "override");
  assert.equal(r.tracksBalance, true); // ใช้ policy flag
});

test("effectiveQuotaForUser — fallback policy ถ้าไม่มี override match", () => {
  const policies = defaultLeavePolicies();
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "sick", year: 2026, policies, overrides: [] });
  assert.equal(r.quota, 30);
  assert.equal(r.source, "policy");
});

test("effectiveQuotaForUser — override ปี/user ไม่ตรง → ไม่ใช้", () => {
  const policies = defaultLeavePolicies();
  const overrides = [
    { user_id: "u2", leave_type: "vacation", effective_year: 2026, annual_quota: 99 }, // ผิด user
    { user_id: "u1", leave_type: "vacation", effective_year: 2025, annual_quota: 99 }, // ผิดปี
  ];
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "vacation", year: 2026, policies, overrides });
  assert.equal(r.source, "policy");
  assert.equal(r.quota, 10);
});

test("effectiveQuotaForUser — override quota=null → unlimited", () => {
  const policies = defaultLeavePolicies();
  const overrides = [{ user_id: "u1", leave_type: "vacation", effective_year: 2026, annual_quota: null }];
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "vacation", year: 2026, policies, overrides });
  assert.equal(r.quota, null);
  assert.equal(r.source, "override");
});

test("effectiveQuotaForUser — ไม่มี policy ใน input → fallback in-code default", () => {
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "vacation", year: 2026, policies: [], overrides: [] });
  assert.equal(r.source, "default");
  assert.equal(r.quota, 10);
  assert.equal(r.policyExists, false);
});

test("effectiveQuotaForUser — leave_type unknown → quota null + tracksBalance false", () => {
  const r = effectiveQuotaForUser({ userId: "u1", leaveType: "weird", year: 2026, policies: [], overrides: [] });
  assert.equal(r.quota, null);
  assert.equal(r.tracksBalance, false);
});

// ── calcLeaveBalance ────────────────────────────────────────

test("calcLeaveBalance — quota null → unlimited (remaining=null)", () => {
  const b = calcLeaveBalance({ quota: null, approvedDays: 5, pendingDays: 2 });
  assert.equal(b.quota, null);
  assert.equal(b.remaining, null);
  assert.equal(b.used, 5);
  assert.equal(b.pending, 2);
  assert.equal(b.overQuota, false);
  assert.equal(b.willExceed, false);
});

test("calcLeaveBalance — quota>used → remaining + ไม่ over", () => {
  const b = calcLeaveBalance({ quota: 10, approvedDays: 3, pendingDays: 2 });
  assert.equal(b.remaining, 7);
  assert.equal(b.overQuota, false);
  assert.equal(b.willExceed, false);
});

test("calcLeaveBalance — used + pending จะเกิน → willExceed=true แต่ยังไม่ overQuota", () => {
  const b = calcLeaveBalance({ quota: 10, approvedDays: 8, pendingDays: 5 });
  assert.equal(b.used, 8);
  assert.equal(b.pending, 5);
  assert.equal(b.remaining, 2);
  assert.equal(b.overQuota, false); // used (8) <= quota (10)
  assert.equal(b.willExceed, true); // 8+5 > 10
});

test("calcLeaveBalance — used > quota → overQuota=true", () => {
  const b = calcLeaveBalance({ quota: 10, approvedDays: 12, pendingDays: 0 });
  assert.equal(b.overQuota, true);
  assert.equal(b.remaining, -2);
});

test("calcLeaveBalance — negative/NaN input → clamp ไป 0", () => {
  const b = calcLeaveBalance({ quota: 10, approvedDays: -5, pendingDays: NaN });
  assert.equal(b.used, 0);
  assert.equal(b.pending, 0);
  assert.equal(b.remaining, 10);
});

// ── calcBalancesForUser ─────────────────────────────────────

const POLICIES_FIX = defaultLeavePolicies();

test("calcBalancesForUser — แยก approved/pending + filter ปี", () => {
  const leaves = [
    { user_id: "u1", leave_type: "vacation", status: "approved",  start_date: "2026-03-01", end_date: "2026-03-03", days_count: 3 },
    { user_id: "u1", leave_type: "vacation", status: "pending",   start_date: "2026-08-10", end_date: "2026-08-12", days_count: 3 },
    { user_id: "u1", leave_type: "sick",     status: "approved",  start_date: "2026-05-05", end_date: "2026-05-05", days_count: 1 },
    { user_id: "u1", leave_type: "vacation", status: "rejected",  start_date: "2026-06-01", end_date: "2026-06-01", days_count: 1 }, // skip
    { user_id: "u1", leave_type: "vacation", status: "approved",  start_date: "2025-12-31", end_date: "2025-12-31", days_count: 1 }, // skip ปีอื่น
  ];
  const map = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: POLICIES_FIX, overrides: [] });
  const vac = map.get("vacation");
  assert.equal(vac.used, 3);
  assert.equal(vac.pending, 3);
  assert.equal(vac.remaining, 7); // 10 - 3
  assert.equal(vac.willExceed, false); // 3+3=6 ≤ 10
  const sick = map.get("sick");
  assert.equal(sick.used, 1);
  assert.equal(sick.pending, 0);
});

test("calcBalancesForUser — overlap ข้ามปี (start Dec 2025 end Jan 2026) → นับใน 2026", () => {
  const leaves = [
    { user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2025-12-30", end_date: "2026-01-02", days_count: 4 },
  ];
  const map = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: POLICIES_FIX, overrides: [] });
  assert.equal(map.get("vacation").used, 4);
});

test("calcBalancesForUser — override quota ใช้ทับ policy", () => {
  const leaves = [{ user_id: "u1", leave_type: "personal", status: "approved", start_date: "2026-01-01", end_date: "2026-01-03", days_count: 3 }];
  const overrides = [{ user_id: "u1", leave_type: "personal", effective_year: 2026, annual_quota: 5 }];
  const map = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: POLICIES_FIX, overrides });
  const p = map.get("personal");
  assert.equal(p.quota, 5);
  assert.equal(p.remaining, 2);
});

test("calcBalancesForUser — unpaid ไม่นับ quota (tracksBalance=false)", () => {
  const leaves = [{ user_id: "u1", leave_type: "unpaid", status: "approved", start_date: "2026-05-01", end_date: "2026-05-05", days_count: 5 }];
  const map = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: POLICIES_FIX, overrides: [] });
  const u = map.get("unpaid");
  assert.equal(u.tracksBalance, false);
  assert.equal(u.quota, null);
  assert.equal(u.remaining, null);
  assert.equal(u.used, 5);
});

// ── isOverQuotaWarning ──────────────────────────────────────

test("isOverQuotaWarning — over/willExceed → true (ถ้า tracksBalance + quota set)", () => {
  assert.equal(isOverQuotaWarning({ tracksBalance: true, quota: 10, overQuota: true, willExceed: false }), true);
  assert.equal(isOverQuotaWarning({ tracksBalance: true, quota: 10, overQuota: false, willExceed: true }), true);
});

test("isOverQuotaWarning — tracksBalance=false → false (เช่น unpaid)", () => {
  assert.equal(isOverQuotaWarning({ tracksBalance: false, quota: null, overQuota: false, willExceed: false }), false);
});

test("isOverQuotaWarning — quota=null → false (unlimited)", () => {
  assert.equal(isOverQuotaWarning({ tracksBalance: true, quota: null, overQuota: false, willExceed: false }), false);
});

test("isOverQuotaWarning — null/undefined → false", () => {
  assert.equal(isOverQuotaWarning(null), false);
  assert.equal(isOverQuotaWarning(undefined), false);
});

// ── formatBalanceLabel ──────────────────────────────────────

test("formatBalanceLabel — มี quota + ใช้ปกติ → 'X/Y = เหลือ Z วัน'", () => {
  const s = formatBalanceLabel({ quota: 10, used: 3, pending: 0, overQuota: false });
  assert.match(s, /3\/10/);
  assert.match(s, /เหลือ 7/);
});

test("formatBalanceLabel — มี pending → '+ รอ N'", () => {
  const s = formatBalanceLabel({ quota: 10, used: 3, pending: 2, overQuota: false });
  assert.match(s, /\+ รอ 2/);
});

test("formatBalanceLabel — overQuota → 'เกิน N วัน'", () => {
  const s = formatBalanceLabel({ quota: 10, used: 13, pending: 0, overQuota: true });
  assert.match(s, /เกิน 3 วัน/);
});

test("formatBalanceLabel — quota null (unlimited) → 'ไม่นับ quota'", () => {
  const s = formatBalanceLabel({ quota: null, used: 5, pending: 2 });
  assert.match(s, /ไม่นับ quota/);
});

test("formatBalanceLabel — null → '—'", () => {
  assert.equal(formatBalanceLabel(null), "—");
});

// ── fetch helpers (graceful) ────────────────────────────────

test("fetchLeavePolicies — node env ไม่มี SUPABASE_CONFIG → NO_CONFIG", async () => {
  const r = await fetchLeavePolicies();
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_CONFIG");
});

test("fetchLeaveOverridesForUser — missing userId → BAD_INPUT", async () => {
  const r = await fetchLeaveOverridesForUser("");
  assert.equal(r.ok, false);
  assert.equal(r.code, "BAD_INPUT");
});

test("fetchLeaveOverridesForUser — ไม่มี config → NO_CONFIG", async () => {
  const r = await fetchLeaveOverridesForUser("u1", 2026);
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_CONFIG");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.36 — Paid Leave Policy → Payroll Decision
// ═══════════════════════════════════════════════════════════

// helper: สร้าง balance map ที่จำลอง calcBalancesForUser output
function _mkBalances({ vacationQuota = 10, vacationUsed = 0, sickQuota = 30, sickUsed = 0, personalQuota = 3, personalUsed = 0 } = {}) {
  const map = new Map();
  map.set("vacation", { leaveType: "vacation", quota: vacationQuota, used: vacationUsed, pending: 0, remaining: vacationQuota - vacationUsed, tracksBalance: true, overQuota: vacationUsed > vacationQuota, willExceed: false });
  map.set("sick",     { leaveType: "sick",     quota: sickQuota,     used: sickUsed,     pending: 0, remaining: sickQuota - sickUsed,         tracksBalance: true, overQuota: sickUsed > sickQuota,         willExceed: false });
  map.set("personal", { leaveType: "personal", quota: personalQuota, used: personalUsed, pending: 0, remaining: personalQuota - personalUsed, tracksBalance: true, overQuota: personalUsed > personalQuota, willExceed: false });
  map.set("unpaid",   { leaveType: "unpaid",   quota: null,          used: 0,            pending: 0, remaining: null,                          tracksBalance: false, overQuota: false, willExceed: false });
  map.set("other",    { leaveType: "other",    quota: null,          used: 0,            pending: 0, remaining: null,                          tracksBalance: false, overQuota: false, willExceed: false });
  return map;
}

// ── ภายใน quota → paid (ไม่หัก) ─────────────────────────────

test("decidePayrollLeaveImpact — vacation/sick/personal ภายใน quota → ไม่หัก (paid)", () => {
  // ก่อนเดือนนี้ใช้ vacation 0, ในเดือนนี้ใช้ 3 → annualUsed=3, headroom=10 → paid 3, over 0
  const balances = _mkBalances({ vacationUsed: 3, sickUsed: 1, personalUsed: 0 });
  const monthSummary = {
    vacationDays: 3,
    sickDays:     1,
    personalDays: 0,
    unpaidDays:   0,
    otherDays:    0,
    totalApprovedDays: 4,
    records: 2,
  };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 500, baseSalary: 0 });
  assert.equal(d.paidWithinQuotaDays, 4);
  assert.equal(d.overQuotaDays, 0);
  assert.equal(d.unpaidDays, 0);
  assert.equal(d.deductibleDays, 0);
  assert.equal(d.suggestedDeduction, 0);
});

// ── เกิน quota → แนะนำหักเฉพาะวันที่เกิน ────────────────────

test("decidePayrollLeaveImpact — เกิน quota → แนะนำหักเฉพาะวันเกิน (split paid/over)", () => {
  // vacation quota=10, used (annual incl. เดือนนี้) = 12, monthDays = 5
  //   → usedBefore = 12 - 5 = 7, headroom = 10 - 7 = 3
  //   → paid = min(5, 3) = 3, over = 5 - 3 = 2
  const balances = _mkBalances({ vacationUsed: 12 });
  const monthSummary = { vacationDays: 5, sickDays: 0, personalDays: 0, unpaidDays: 0, otherDays: 0, totalApprovedDays: 5, records: 1 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 500, baseSalary: 0 });
  assert.equal(d.paidWithinQuotaDays, 3);
  assert.equal(d.overQuotaDays, 2);
  assert.equal(d.deductibleDays, 2);
  assert.equal(d.suggestedDeduction, 1000); // 2 × 500
  assert.equal(d.perType.vacation.paid, 3);
  assert.equal(d.perType.vacation.over, 2);
});

test("decidePayrollLeaveImpact — ใช้เต็ม quota แล้วก่อนเดือนนี้ → ทุกวันในเดือนนี้ over", () => {
  // personal quota=3, used=5 (ปีนี้รวมเดือนนี้), monthDays=2
  //   → usedBefore=3, headroom=0 → over=2
  const balances = _mkBalances({ personalUsed: 5 });
  const monthSummary = { vacationDays: 0, sickDays: 0, personalDays: 2, unpaidDays: 0, otherDays: 0, totalApprovedDays: 2, records: 1 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 1000, baseSalary: 0 });
  assert.equal(d.paidWithinQuotaDays, 0);
  assert.equal(d.overQuotaDays, 2);
  assert.equal(d.suggestedDeduction, 2000);
});

// ── unpaid → หักทั้งหมด ────────────────────────────────────

test("decidePayrollLeaveImpact — unpaid → หักทั้งหมด (ไม่กระทบ quota)", () => {
  const balances = _mkBalances();
  const monthSummary = { vacationDays: 0, sickDays: 0, personalDays: 0, unpaidDays: 4, otherDays: 0, totalApprovedDays: 4, records: 1 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 500, baseSalary: 0 });
  assert.equal(d.paidWithinQuotaDays, 0);
  assert.equal(d.overQuotaDays, 0);
  assert.equal(d.unpaidDays, 4);
  assert.equal(d.deductibleDays, 4);
  assert.equal(d.suggestedDeduction, 2000); // 4 × 500
});

test("decidePayrollLeaveImpact — unpaid fallback baseSalary÷30 ถ้าไม่มี dailyRate", () => {
  const balances = _mkBalances();
  const monthSummary = { vacationDays: 0, sickDays: 0, personalDays: 0, unpaidDays: 3, otherDays: 0, totalApprovedDays: 3, records: 1 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 0, baseSalary: 30000 });
  assert.equal(d.suggestedDeduction, 3000); // 30000/30 × 3
});

// ── mixed types ────────────────────────────────────────────

test("decidePayrollLeaveImpact — mixed: vacation in-quota + personal over + unpaid + other", () => {
  // vacation: used annual=2, monthDays=2 → usedBefore=0, headroom=10, paid=2, over=0
  // personal: used annual=4, monthDays=2 → usedBefore=2, headroom=1, paid=1, over=1
  // unpaid: 2 → หักทั้งหมด
  // other: 1.5 → info only ไม่หัก
  const balances = _mkBalances({ vacationUsed: 2, personalUsed: 4 });
  const monthSummary = {
    vacationDays: 2,
    sickDays:     0,
    personalDays: 2,
    unpaidDays:   2,
    otherDays:    1.5,
    totalApprovedDays: 7.5,
    records: 4,
  };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 500, baseSalary: 0 });
  assert.equal(d.paidWithinQuotaDays, 3); // 2 vacation + 1 personal
  assert.equal(d.overQuotaDays, 1);       // 1 personal over
  assert.equal(d.unpaidDays, 2);
  assert.equal(d.otherDays, 1.5);
  assert.equal(d.deductibleDays, 3);      // unpaid 2 + over 1
  assert.equal(d.suggestedDeduction, 1500); // 3 × 500
  assert.equal(d.perType.vacation.paid, 2);
  assert.equal(d.perType.vacation.over, 0);
  assert.equal(d.perType.personal.paid, 1);
  assert.equal(d.perType.personal.over, 1);
});

// ── graceful (no balance) ──────────────────────────────────

test("decidePayrollLeaveImpact — ไม่มี balance map → tracked types treat เป็น paid ทั้งหมด (graceful)", () => {
  // ถ้ายังไม่ได้รัน SQL หรือ fetch fail → balances=null → vacation/sick/personal ถือว่า paid (ไม่หัก)
  // unpaid ยังหักปกติ
  const monthSummary = { vacationDays: 5, sickDays: 0, personalDays: 0, unpaidDays: 1, otherDays: 0, totalApprovedDays: 6, records: 2 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances: null, dailyRate: 500, baseSalary: 0 });
  assert.equal(d.hasBalanceData, false);
  assert.equal(d.paidWithinQuotaDays, 5); // vacation paid (no quota data)
  assert.equal(d.overQuotaDays, 0);
  assert.equal(d.unpaidDays, 1);
  assert.equal(d.suggestedDeduction, 500); // 1 × 500
});

test("decidePayrollLeaveImpact — balance.tracksBalance=false (เช่น unpaid bucket) → paid", () => {
  // ถ้า policy ตั้ง vacation tracksBalance=false (เหมือน unpaid) → ไม่ใช้ quota → paid ทั้งหมด
  const map = new Map();
  map.set("vacation", { leaveType: "vacation", quota: null, used: 0, pending: 0, remaining: null, tracksBalance: false, overQuota: false, willExceed: false });
  const d = decidePayrollLeaveImpact({
    monthSummary: { vacationDays: 5, sickDays: 0, personalDays: 0, unpaidDays: 0, otherDays: 0, totalApprovedDays: 5, records: 1 },
    balances: map,
    dailyRate: 500,
    baseSalary: 0,
  });
  assert.equal(d.paidWithinQuotaDays, 5);
  assert.equal(d.overQuotaDays, 0);
  assert.equal(d.suggestedDeduction, 0);
});

// ── leaveDeductionNoteMarker (idempotent helper) ────────────

test("leaveDeductionNoteMarker — ไม่มี deduction → empty string", () => {
  assert.equal(leaveDeductionNoteMarker(null), "");
  assert.equal(leaveDeductionNoteMarker({ deductibleDays: 0, unpaidDays: 0, overQuotaDays: 0 }), "");
});

test("leaveDeductionNoteMarker — เฉพาะ unpaid → 'หักลา N วัน (ไม่รับค่าจ้าง N)'", () => {
  const m = leaveDeductionNoteMarker({ deductibleDays: 3, unpaidDays: 3, overQuotaDays: 0 });
  assert.match(m, /หักลา 3 วัน/);
  assert.match(m, /ไม่รับค่าจ้าง 3/);
});

test("leaveDeductionNoteMarker — เฉพาะ over → 'หักลา N วัน (เกิน quota N)'", () => {
  const m = leaveDeductionNoteMarker({ deductibleDays: 2, unpaidDays: 0, overQuotaDays: 2 });
  assert.match(m, /หักลา 2 วัน/);
  assert.match(m, /เกิน quota 2/);
});

test("leaveDeductionNoteMarker — mixed → มีทั้ง 2 segments", () => {
  const m = leaveDeductionNoteMarker({ deductibleDays: 5, unpaidDays: 3, overQuotaDays: 2 });
  assert.match(m, /หักลา 5 วัน/);
  assert.match(m, /ไม่รับค่าจ้าง 3/);
  assert.match(m, /เกิน quota 2/);
});

test("leaveDeductionNoteMarker — apply ซ้ำตรวจ idempotent ผ่าน note.includes(marker)", () => {
  // จำลอง flow: apply ครั้งแรก → note ได้ marker A
  //              ถ้ารัน decision เดิม + apply อีกครั้ง → marker เดียวกัน → caller skip
  const decision = { deductibleDays: 4, unpaidDays: 1, overQuotaDays: 3 };
  const marker = leaveDeductionNoteMarker(decision);
  const noteAfterFirst = `OT เพิ่ม · ${marker}`;
  // idempotent guard: note ที่มี marker แล้ว → ไม่บวกซ้ำ
  assert.ok(noteAfterFirst.includes(marker), "marker should be in note");
  // ถ้าสร้าง marker จาก decision เดียวกัน → string เดิม → caller skip ได้
  const marker2 = leaveDeductionNoteMarker(decision);
  assert.equal(marker, marker2);
});

test("hasLeaveDeductionNoteMarker — จับ marker เดิมแม้ format เลขต่างกัน กันกดเติมซ้ำ", () => {
  const exact = "หักลา 2 วัน (เกิน quota 2)";
  assert.equal(hasLeaveDeductionNoteMarker(exact, exact), true);
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 2.00 วัน (เกิน quota 2.00)", exact), true);
  assert.equal(hasLeaveDeductionNoteMarker("note อื่น · หักลา 2 วัน (เกิน quota 2)", "หักลา 2.00 วัน (เกิน quota 2.00)"), true);
  assert.equal(hasLeaveDeductionNoteMarker("manual note ไม่มี marker", exact), false);
  assert.equal(hasLeaveDeductionNoteMarker("", exact), false);
});

// ── Phase 92.37: idempotency edge cases (reopen + manual notes) ──

test("hasLeaveDeductionNoteMarker — เคส smoke จริง: หัก 2 วันเกิน quota, reopen รายการเดิม", () => {
  // simulate save round-trip: ครั้งแรก apply → note ได้ marker → save → reopen → guard ต้องจับ
  const decision = { deductibleDays: 2, unpaidDays: 0, overQuotaDays: 2 };
  const marker = leaveDeductionNoteMarker(decision); // "หักลา 2 วัน (เกิน quota 2)"
  // round-trip ปกติ: note บันทึกตรงๆ ใน DB
  assert.equal(hasLeaveDeductionNoteMarker(marker, marker), true);
  // ผู้ใช้แก้ note ต่อ: เติมข้อความหลัง marker
  assert.equal(hasLeaveDeductionNoteMarker(`${marker} · ตรวจสอบโดย admin`, marker), true);
  // ผู้ใช้แก้ note ต่อ: เติมข้อความก่อน marker
  assert.equal(hasLeaveDeductionNoteMarker(`OT ส่วนเพิ่ม · ${marker}`, marker), true);
});

test("hasLeaveDeductionNoteMarker — เคส decimal และตัวเลขมีเศษ", () => {
  // marker เลขทศนิยม (เช่น ลาครึ่งวัน)
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 0.5 วัน (ไม่รับค่าจ้าง 0.5)", ""), true);
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 1.50 วัน", ""), true);
  // เลขจำนวนเต็มหลายหลัก
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 10 วัน", ""), true);
});

test("hasLeaveDeductionNoteMarker — manual note ที่ไม่มี marker pattern → allow apply", () => {
  // admin พิมพ์ note เอง: ต้อง apply ได้ปกติ (regex ไม่ match)
  assert.equal(hasLeaveDeductionNoteMarker("ลาป่วย 5 วัน", ""), false);     // คำว่า "ลาป่วย" ไม่ใช่ "หักลา"
  assert.equal(hasLeaveDeductionNoteMarker("วันลาเดือนนี้ 3 วัน", ""), false);
  assert.equal(hasLeaveDeductionNoteMarker("note เปล่า ๆ ไม่มีคำว่าหัก", ""), false);
  // marker pattern ขาด "วัน" → ไม่ match
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 2 ครั้ง", ""), false);
});

test("hasLeaveDeductionNoteMarker — null/undefined/whitespace-only safety", () => {
  assert.equal(hasLeaveDeductionNoteMarker(null), false);
  assert.equal(hasLeaveDeductionNoteMarker(undefined), false);
  assert.equal(hasLeaveDeductionNoteMarker("   "), false);
  assert.equal(hasLeaveDeductionNoteMarker("\n\t"), false);
});

test("hasLeaveDeductionNoteMarker — exact marker priority over regex fallback", () => {
  // ถ้า marker ตรงเป๊ะ → return true (priority 1)
  const exactMarker = "หักลา 2 วัน (เกิน quota 2)";
  assert.equal(hasLeaveDeductionNoteMarker(exactMarker, exactMarker), true);
  // ถ้า marker เป็น empty string → fall back ไป regex
  assert.equal(hasLeaveDeductionNoteMarker(exactMarker, ""), true);
  // regex match ต้องครอบรูปแบบ "หักลา <digits> วัน" — เกิน quota X อยู่หรือไม่ก็ได้
  assert.equal(hasLeaveDeductionNoteMarker("หักลา 5 วัน (ไม่รับค่าจ้าง 5)", ""), true);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.38 — Calendar Leave View pure helpers
// ═══════════════════════════════════════════════════════════

// ── expandLeaveRangeToMonthDays ──────────────────────────

test("expandLeaveRangeToMonthDays — leave 1 วัน ใน month นั้น → array 1 item", () => {
  const days = expandLeaveRangeToMonthDays(
    { start_date: "2026-05-14", end_date: "2026-05-14" },
    "2026-05"
  );
  assert.deepEqual(days, ["2026-05-14"]);
});

test("expandLeaveRangeToMonthDays — leave หลายวันใน month เดียว → array contiguous", () => {
  const days = expandLeaveRangeToMonthDays(
    { start_date: "2026-05-14", end_date: "2026-05-16" },
    "2026-05"
  );
  assert.deepEqual(days, ["2026-05-14", "2026-05-15", "2026-05-16"]);
});

test("expandLeaveRangeToMonthDays — leave 12 วัน (sompong พักร้อน) → array 12 items", () => {
  const days = expandLeaveRangeToMonthDays(
    { start_date: "2026-05-14", end_date: "2026-05-25" },
    "2026-05"
  );
  assert.equal(days.length, 12);
  assert.equal(days[0], "2026-05-14");
  assert.equal(days[11], "2026-05-25");
});

test("expandLeaveRangeToMonthDays — leave ข้ามเดือน → clip เฉพาะวันใน month ที่ดู", () => {
  // 28 เม.ย. – 5 พ.ค. — ดูเดือน พ.ค. → ได้แค่ 1–5
  const may = expandLeaveRangeToMonthDays(
    { start_date: "2026-04-28", end_date: "2026-05-05" },
    "2026-05"
  );
  assert.deepEqual(may, ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"]);
  // ดูเดือน เม.ย. → ได้แค่ 28–30
  const apr = expandLeaveRangeToMonthDays(
    { start_date: "2026-04-28", end_date: "2026-05-05" },
    "2026-04"
  );
  assert.deepEqual(apr, ["2026-04-28", "2026-04-29", "2026-04-30"]);
});

test("expandLeaveRangeToMonthDays — leave อยู่นอก month → empty", () => {
  const days = expandLeaveRangeToMonthDays(
    { start_date: "2026-03-01", end_date: "2026-03-10" },
    "2026-05"
  );
  assert.deepEqual(days, []);
});

test("expandLeaveRangeToMonthDays — ไม่ระบุ month → ใช้ทั้งช่วงของ leave", () => {
  const days = expandLeaveRangeToMonthDays(
    { start_date: "2026-04-28", end_date: "2026-05-05" }
  );
  assert.equal(days.length, 8);
  assert.equal(days[0], "2026-04-28");
  assert.equal(days[7], "2026-05-05");
});

test("expandLeaveRangeToMonthDays — null/invalid/missing dates → []", () => {
  assert.deepEqual(expandLeaveRangeToMonthDays(null), []);
  assert.deepEqual(expandLeaveRangeToMonthDays({}), []);
  assert.deepEqual(expandLeaveRangeToMonthDays({ start_date: "2026-05-14" }), []);
  assert.deepEqual(expandLeaveRangeToMonthDays({ start_date: "2026-05-20", end_date: "2026-05-10" }), []);
});

// ── groupLeavesByDate ────────────────────────────────────

test("groupLeavesByDate — multi-leave คนละวัน → key คนละวัน", () => {
  const m = groupLeavesByDate([
    { id: 1, start_date: "2026-05-14", end_date: "2026-05-14", status: "approved" },
    { id: 2, start_date: "2026-05-15", end_date: "2026-05-15", status: "pending"  },
  ], "2026-05");
  assert.equal(m.size, 2);
  assert.equal(m.get("2026-05-14").length, 1);
  assert.equal(m.get("2026-05-15").length, 1);
});

test("groupLeavesByDate — หลายคนลาวันเดียวกัน → stack ใน key เดียว", () => {
  const m = groupLeavesByDate([
    { id: 1, start_date: "2026-05-14", end_date: "2026-05-14", user_id: "u1" },
    { id: 2, start_date: "2026-05-14", end_date: "2026-05-14", user_id: "u2" },
    { id: 3, start_date: "2026-05-14", end_date: "2026-05-14", user_id: "u3" },
  ], "2026-05");
  assert.equal(m.size, 1);
  assert.equal(m.get("2026-05-14").length, 3);
});

test("groupLeavesByDate — leave หลายวัน → row เดียวกระจายอยู่หลาย key", () => {
  const m = groupLeavesByDate([
    { id: 99, start_date: "2026-05-14", end_date: "2026-05-16" },
  ], "2026-05");
  assert.equal(m.size, 3);
  for (const d of ["2026-05-14", "2026-05-15", "2026-05-16"]) {
    assert.equal(m.get(d).length, 1);
    assert.equal(m.get(d)[0].id, 99);
  }
});

test("groupLeavesByDate — empty/non-array → empty Map", () => {
  assert.equal(groupLeavesByDate(null).size, 0);
  assert.equal(groupLeavesByDate([]).size, 0);
  assert.equal(groupLeavesByDate(undefined).size, 0);
});

test("groupLeavesByDate — leave นอก month → ไม่อยู่ใน map", () => {
  const m = groupLeavesByDate([
    { id: 1, start_date: "2026-03-01", end_date: "2026-03-05" },
    { id: 2, start_date: "2026-05-14", end_date: "2026-05-14" },
  ], "2026-05");
  assert.equal(m.size, 1);
  assert.ok(m.has("2026-05-14"));
  assert.ok(!m.has("2026-03-01"));
});

test("groupLeavesByDate — key เรียงตามวันที่ ascending", () => {
  const m = groupLeavesByDate([
    { id: 3, start_date: "2026-05-30", end_date: "2026-05-30" },
    { id: 1, start_date: "2026-05-01", end_date: "2026-05-01" },
    { id: 2, start_date: "2026-05-15", end_date: "2026-05-15" },
  ], "2026-05");
  assert.deepEqual(Array.from(m.keys()), ["2026-05-01", "2026-05-15", "2026-05-30"]);
});

// ── getCalendarMonthGrid ─────────────────────────────────

test("getCalendarMonthGrid — 2026-05 → 6 weeks × 7 cells", () => {
  const g = getCalendarMonthGrid("2026-05", "2026-05-26");
  assert.equal(g.weeks.length, 6);
  for (const w of g.weeks) assert.equal(w.length, 7);
  assert.equal(g.year, 2026);
  assert.equal(g.monthNum, 5);
});

test("getCalendarMonthGrid — first cell คือ Sunday ของสัปดาห์ที่มี 1 ของเดือน", () => {
  // 1 พ.ค. 2026 = Friday → grid เริ่ม Sun 26 เม.ย.
  const g = getCalendarMonthGrid("2026-05");
  const first = g.weeks[0][0];
  assert.equal(first.dateStr, "2026-04-26");
  assert.equal(first.inMonth, false);
  assert.equal(first.dayNum, 26);
});

test("getCalendarMonthGrid — แยก inMonth ถูก (วันก่อน/หลังเดือนนั้น)", () => {
  const g = getCalendarMonthGrid("2026-05");
  // หา cell ของวันที่ 1 พ.ค. + 31 พ.ค. + cell อื่น ๆ
  let inMonthCount = 0;
  for (const w of g.weeks) for (const c of w) if (c.inMonth) inMonthCount += 1;
  assert.equal(inMonthCount, 31); // พ.ค. มี 31 วัน
});

test("getCalendarMonthGrid — isToday ตรงเฉพาะ cell ของ todayStr ที่ส่งมา", () => {
  const g = getCalendarMonthGrid("2026-05", "2026-05-26");
  let todays = 0;
  for (const w of g.weeks) for (const c of w) if (c.isToday) todays += 1;
  assert.equal(todays, 1);
});

test("getCalendarMonthGrid — isWeekend ถูกต้อง (Sun=col0, Sat=col6)", () => {
  const g = getCalendarMonthGrid("2026-05");
  for (const w of g.weeks) {
    assert.equal(w[0].isWeekend, true,  "Sunday");
    assert.equal(w[6].isWeekend, true,  "Saturday");
    assert.equal(w[1].isWeekend, false, "Monday");
    assert.equal(w[5].isWeekend, false, "Friday");
  }
});

test("getCalendarMonthGrid — leap year (กุมภา 2024 = 29 วัน) inMonth=29", () => {
  const g = getCalendarMonthGrid("2024-02");
  let inMonthCount = 0;
  for (const w of g.weeks) for (const c of w) if (c.inMonth) inMonthCount += 1;
  assert.equal(inMonthCount, 29);
});

test("getCalendarMonthGrid — invalid month → weeks เปล่า ไม่ throw", () => {
  assert.deepEqual(getCalendarMonthGrid("").weeks, []);
  assert.deepEqual(getCalendarMonthGrid("invalid").weeks, []);
  assert.deepEqual(getCalendarMonthGrid("2026-13").weeks, []); // bad month
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.38c — calcBalancesForUser with excludeLeaveId
//  (edit modal: ห้ามนับ record ปัจจุบันซ้ำใน used/pending)
// ═══════════════════════════════════════════════════════════

const _policies92c = [
  { leave_type: "vacation", annual_quota: 10, tracks_balance: true },
  { leave_type: "sick",     annual_quota: 30, tracks_balance: true },
  { leave_type: "personal", annual_quota: 3,  tracks_balance: true },
  { leave_type: "unpaid",   annual_quota: null, tracks_balance: false },
];

test("calcBalancesForUser — edit approved 2 วัน: exclude id แล้ว used ลดลง 2", () => {
  const leaves = [
    { id: "a", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
    { id: "b", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-06-01", end_date: "2026-06-10", days_count: 10 },
  ];
  // ไม่ exclude — used = 12 (เกิน quota 10 = 2)
  const before = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c });
  assert.equal(before.get("vacation").used, 12);
  assert.equal(before.get("vacation").overQuota, true);
  // exclude id="a" (2 วัน) — used ควรเหลือ 10 (พอดี quota)
  const after = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "a" });
  assert.equal(after.get("vacation").used, 10);
  assert.equal(after.get("vacation").overQuota, false);
});

test("calcBalancesForUser — edit approved 10 วัน: exclude id แล้ว used ลดลง 10", () => {
  const leaves = [
    { id: "a", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
    { id: "b", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-06-01", end_date: "2026-06-10", days_count: 10 },
  ];
  const after = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "b" });
  assert.equal(after.get("vacation").used, 2);
  assert.equal(after.get("vacation").overQuota, false);
});

test("calcBalancesForUser — edit pending: exclude id ลด pending ไม่ใช่ used", () => {
  const leaves = [
    { id: "p1", user_id: "u1", leave_type: "vacation", status: "pending",  start_date: "2026-07-01", end_date: "2026-07-03", days_count: 3 },
    { id: "a1", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
  ];
  const after = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "p1" });
  assert.equal(after.get("vacation").used, 2);     // approved ยังนับอยู่
  assert.equal(after.get("vacation").pending, 0); // pending ที่ exclude หายไป
});

test("calcBalancesForUser — เปลี่ยน leave_type bucket: exclude vacation → ไม่กระทบ sick bucket", () => {
  const leaves = [
    { id: "v1", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
    { id: "s1", user_id: "u1", leave_type: "sick",     status: "approved", start_date: "2026-04-01", end_date: "2026-04-01", days_count: 1 },
  ];
  // exclude v1 → vacation used = 0, sick used ยังเป็น 1
  const after = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "v1" });
  assert.equal(after.get("vacation").used, 0);
  assert.equal(after.get("sick").used, 1);
});

test("calcBalancesForUser — excludeLeaveId ที่ไม่มีจริง → behavior เหมือนเดิม (no-op)", () => {
  const leaves = [
    { id: "a", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
  ];
  const without = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c });
  const withBad = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "non-existent-id" });
  assert.equal(without.get("vacation").used, withBad.get("vacation").used);
});

test("calcBalancesForUser — create mode (excludeLeaveId undefined/null/empty) → ไม่เปลี่ยน behavior", () => {
  const leaves = [
    { id: "a", user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
  ];
  const base = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c });
  assert.equal(calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: undefined }).get("vacation").used, base.get("vacation").used);
  assert.equal(calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: null }).get("vacation").used, base.get("vacation").used);
  assert.equal(calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "" }).get("vacation").used, base.get("vacation").used);
});

test("calcBalancesForUser — number id vs string id compare loosely (cross-type safety)", () => {
  // staff_leaves.id ใน prod อาจเป็น bigint (number) → exclude ต้อง compare แบบ string
  const leaves = [
    { id: 42, user_id: "u1", leave_type: "vacation", status: "approved", start_date: "2026-05-01", end_date: "2026-05-02", days_count: 2 },
  ];
  // ส่ง excludeLeaveId เป็น string "42" → ต้อง match number 42
  const after = calcBalancesForUser({ userId: "u1", year: 2026, leaves, policies: _policies92c, excludeLeaveId: "42" });
  assert.equal(after.get("vacation").used, 0);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.39 — Mobile Agenda + Dense Day helpers
// ═══════════════════════════════════════════════════════════

// ── groupCalendarAgendaDays ──────────────────────────────

test("groupCalendarAgendaDays — array sorted ascending + เฉพาะวันที่มี events", () => {
  const arr = groupCalendarAgendaDays([
    { id: 3, start_date: "2026-05-30", end_date: "2026-05-30" },
    { id: 1, start_date: "2026-05-01", end_date: "2026-05-01" },
    { id: 2, start_date: "2026-05-15", end_date: "2026-05-15" },
  ], "2026-05");
  assert.equal(arr.length, 3);
  assert.deepEqual(arr.map(x => x.dateStr), ["2026-05-01", "2026-05-15", "2026-05-30"]);
  // dow info ครบ
  for (const item of arr) {
    assert.ok(typeof item.dowLabel === "string" && item.dowLabel.length > 0);
    assert.ok(item.dowIndex >= 0 && item.dowIndex <= 6);
    assert.ok(item.dayNum > 0);
    assert.equal(typeof item.monthShort, "string");
  }
});

test("groupCalendarAgendaDays — leave หลายคนวันเดียวกัน → events stacked", () => {
  const arr = groupCalendarAgendaDays([
    { id: 1, user_id: "u1", start_date: "2026-05-14", end_date: "2026-05-14" },
    { id: 2, user_id: "u2", start_date: "2026-05-14", end_date: "2026-05-14" },
    { id: 3, user_id: "u3", start_date: "2026-05-14", end_date: "2026-05-14" },
  ], "2026-05");
  assert.equal(arr.length, 1);
  assert.equal(arr[0].events.length, 3);
});

test("groupCalendarAgendaDays — leave หลายวัน → expanded เป็น dailyitems", () => {
  const arr = groupCalendarAgendaDays([
    { id: 99, start_date: "2026-05-14", end_date: "2026-05-16" },
  ], "2026-05");
  assert.equal(arr.length, 3);
  for (const item of arr) {
    assert.equal(item.events.length, 1);
    assert.equal(item.events[0].id, 99);
  }
});

test("groupCalendarAgendaDays — empty/null safe", () => {
  assert.deepEqual(groupCalendarAgendaDays(null), []);
  assert.deepEqual(groupCalendarAgendaDays([]), []);
  assert.deepEqual(groupCalendarAgendaDays(undefined), []);
});

// ── limitCalendarDayEvents ───────────────────────────────

test("limitCalendarDayEvents — events <= maxVisible → visible เต็ม overflow=0", () => {
  const r1 = limitCalendarDayEvents([{}, {}, {}], 3);
  assert.equal(r1.visible.length, 3);
  assert.equal(r1.overflowCount, 0);
  const r2 = limitCalendarDayEvents([{}, {}], 3);
  assert.equal(r2.visible.length, 2);
  assert.equal(r2.overflowCount, 0);
});

test("limitCalendarDayEvents — events > maxVisible → ตัด + count ส่วนเกิน", () => {
  const events = [{a:1}, {a:2}, {a:3}, {a:4}, {a:5}];
  const r = limitCalendarDayEvents(events, 3);
  assert.equal(r.visible.length, 3);
  assert.equal(r.visible[0].a, 1);
  assert.equal(r.visible[2].a, 3);
  assert.equal(r.overflowCount, 2);
});

test("limitCalendarDayEvents — maxVisible invalid → default 3", () => {
  const events = [{}, {}, {}, {}, {}];
  assert.equal(limitCalendarDayEvents(events).overflowCount, 2);
  assert.equal(limitCalendarDayEvents(events, 0).overflowCount, 2);
  assert.equal(limitCalendarDayEvents(events, -5).overflowCount, 2);
  assert.equal(limitCalendarDayEvents(events, "x").overflowCount, 2);
});

test("limitCalendarDayEvents — non-array → visible เปล่า", () => {
  assert.deepEqual(limitCalendarDayEvents(null), { visible: [], overflowCount: 0 });
  assert.deepEqual(limitCalendarDayEvents(undefined), { visible: [], overflowCount: 0 });
});

// ── Phase 92.39b: dense day edge cases (verification) ──

test("limitCalendarDayEvents — 0 events → ทั้ง visible ทั้ง overflow เป็น 0/empty (ไม่ render chip)", () => {
  const r = limitCalendarDayEvents([], 3);
  assert.equal(r.visible.length, 0);
  assert.equal(r.overflowCount, 0);
  assert.ok(Array.isArray(r.visible));
});

test("limitCalendarDayEvents — events.length === cap (boundary) → visible เต็ม overflow=0", () => {
  // boundary case: ถ้า === cap ต้องไม่ trigger overflow
  const events = [{id:1}, {id:2}, {id:3}];
  const r = limitCalendarDayEvents(events, 3);
  assert.equal(r.visible.length, 3);
  assert.equal(r.overflowCount, 0);
});

test("limitCalendarDayEvents — events.length === cap + 1 → visible cap + overflow 1", () => {
  // off-by-one check: just over the boundary
  const events = [{id:1}, {id:2}, {id:3}, {id:4}];
  const r = limitCalendarDayEvents(events, 3);
  assert.equal(r.visible.length, 3);
  assert.equal(r.overflowCount, 1);
  assert.equal(r.visible[2].id, 3); // last visible = 3rd item
});

test("limitCalendarDayEvents — dense day production-like (5 events 1 วัน, cap 3) → ตรง spec", () => {
  // sompong scenario: 5 leave events ในวันเดียวกัน → cap=3 → "+2 รายการ"
  const events = Array.from({length: 5}, (_, i) => ({ id: i + 1, user_id: `u${i+1}` }));
  const r = limitCalendarDayEvents(events, 3);
  assert.equal(r.visible.length, 3);
  assert.equal(r.overflowCount, 2);
  // ลำดับ preserve — first 3 IDs = 1, 2, 3
  assert.deepEqual(r.visible.map(e => e.id), [1, 2, 3]);
});

test("limitCalendarDayEvents — cap = 2 (tighter) → 5 events → 2 visible + 3 overflow", () => {
  const events = [1,2,3,4,5].map(id => ({ id }));
  const r = limitCalendarDayEvents(events, 2);
  assert.equal(r.visible.length, 2);
  assert.equal(r.overflowCount, 3);
});

test("limitCalendarDayEvents — visible ไม่กลายเป็น reference ของ events เดิม (immutability)", () => {
  // กัน bug: caller mutate visible แล้ว events เดิมเปลี่ยน
  const events = [{id:1}, {id:2}];
  const r = limitCalendarDayEvents(events, 3);
  r.visible.push({id:99});
  assert.equal(events.length, 2, "original events array should not change");
});

// ── Phase 92.39b: source-level wiring tests for "+N รายการ" flow ──

test("source: leave_management.js มี overflow chip template '+ N รายการ' + class lm-cal-more + data-lm-date", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // (1) overflow chip text "รายการ" ใน button template
  assert.match(src, /\$\{overflowCount\} รายการ/, "overflow chip ต้องใช้ template literal ${overflowCount} รายการ");
  // (2) class lm-cal-more — wire กับ event handler
  assert.match(src, /class="lm-cal-more"/, "overflow chip ต้องมี class lm-cal-more");
  // (3) data-lm-date attribute สำหรับเก็บ dateStr
  assert.match(src, /data-lm-date="\$\{escHtml\(cell\.dateStr\)\}"/, "overflow chip ต้องมี data-lm-date=escHtml(cell.dateStr)");
});

test("source: limitCalendarDayEvents ถูกเรียกใน _renderCalendarMonthGrid ด้วย _CAL_DESKTOP_MAX_VISIBLE", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /const \{ visible, overflowCount \} = limitCalendarDayEvents\(events, _CAL_DESKTOP_MAX_VISIBLE\)/);
  assert.match(src, /_CAL_DESKTOP_MAX_VISIBLE\s*=\s*3/);
});

test("source: calendar click delegation มี lm-cal-more handler ที่เรียก _openDayListPopover", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // closest('.lm-cal-more') ตรวจ + เรียก _openDayListPopover พร้อม dateStr + filtered
  assert.match(src, /ev\.target\.closest\(["']\.lm-cal-more["']\)/);
  assert.match(src, /_openDayListPopover\(dateStr,\s*filtered\)/);
});

test("source: _openDayListPopover อ่าน byDate.get(dateStr) → ส่งให้ _renderDayListPopover ครบ events", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _openDayListPopover ใช้ groupLeavesByDate(filtered, activeMonth) แล้ว byDate.get(dateStr)
  assert.match(src, /function _openDayListPopover[\s\S]*?groupLeavesByDate\(filtered,\s*activeMonth\)/);
  assert.match(src, /function _openDayListPopover[\s\S]*?byDate\.get\(dateStr\)/);
  // ใช้ _renderDayListPopover() เพื่อ render content
  assert.match(src, /function _openDayListPopover[\s\S]*?_renderDayListPopover\(dateStr,\s*evs,\s*profileMap\)/);
});

test("source: _renderDayListPopover renders all events ผ่าน _calendarEventChip", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // map events array → _calendarEventChip (เหมือน cell desktop)
  assert.match(src, /function _renderDayListPopover[\s\S]*?events\.map\(ev =>\s*_calendarEventChip\(ev, profileMap, dateStr\)\)/);
});

test("source: day list popover event click → close + chained open leave details popover", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // ใน _openDayListPopover binding: pop.querySelectorAll('.lm-cal-event').forEach(... _openLeavePopover ...)
  assert.match(src, /function _openDayListPopover[\s\S]*?querySelectorAll\(["']\.lm-cal-event["']\)/);
  assert.match(src, /function _openDayListPopover[\s\S]*?setTimeout\(\(\) => _openLeavePopover\(leave\), 0\)/);
});

test("source: popover Esc + backdrop close (ทั้ง 2 popover types)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // Esc handler — register on open
  assert.match(src, /_registerPopoverEsc/);
  assert.match(src, /ev\.key === ["']Escape["']/);
  // backdrop close (#lmPopBackdrop)
  assert.match(src, /lmPopBackdrop[\s\S]{0,200}?addEventListener\(["']click["']/);
});

// ── Phase 92.39c: popover visibility/positioning ───────────

test("source: #lmPopover container ใช้ flex layout (รับ display=block จาก JS แล้ว flex centered)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // attribute selector match display:block (with/without space) → flex layout
  assert.match(src, /#lmPopover\[style\*=["']display:block["']\][\s\S]{0,200}?display:\s*flex/);
  assert.match(src, /align-items:\s*flex-start/);
  assert.match(src, /justify-content:\s*center/);
  assert.match(src, /overflow-y:\s*auto/);
  // mobile override: align-items: stretch + padding:0
  assert.match(src, /@media \(max-width: 768px\)[\s\S]{0,400}?align-items:\s*stretch/);
});

test("source: .lm-pop-dialog desktop มี max-height calc(100vh - ...) + flex column + inner scroll", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /\.lm-pop-dialog[\s\S]{0,400}?max-height:\s*calc\(100vh\s*-\s*\d+px\)/);
  assert.match(src, /\.lm-pop-dialog[\s\S]{0,400}?display:\s*flex[\s\S]{0,200}?flex-direction:\s*column/);
  // inner body scrollable via .lm-pop-body
  assert.match(src, /\.lm-pop-dialog\s*>\s*\.lm-pop-body[\s\S]{0,200}?overflow-y:\s*auto/);
});

test("source: backdrop z-index:0 + dialog z-index:1 (explicit hierarchy)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // backdrop inline style มี z-index:0 (กัน dialog ถูก stack ใต้)
  assert.match(src, /id="lmPopBackdrop"[\s\S]{0,200}?z-index:\s*0/);
  // dialog class มี z-index:1
  assert.match(src, /\.lm-pop-dialog[\s\S]{0,400}?z-index:\s*1/);
});

test("source: ทั้ง 2 popover types ใช้ class lm-pop-body ใน content (รับ inner scroll จาก dialog rule)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _renderLeavePopover body
  assert.match(src, /function _renderLeavePopover[\s\S]*?class="lm-pop-body"/);
  // _renderDayListPopover body
  assert.match(src, /function _renderDayListPopover[\s\S]*?class="lm-pop-body"/);
});

test("source: focus close button หลัง open popover (a11y + visibility confirm)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // Phase 92.39d: focus close logic ย้ายไปอยู่ใน _openPopover (shared)
  assert.match(src, /function _openPopover[\s\S]*?querySelector\(["']#lmPopClose["']\)\?\.focus\(\)/);
});

// ── Phase 92.39d: popover content scope + unified open function ──

test("source: .lm-pop-dialog CSS rules อยู่ใน container scope (ไม่อยู่ใน _renderLeavePopover template)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _renderLeavePopover ต้อง NOT มี <style> block — CSS อยู่ container scope แทน
  const renderLeaveBody = src.match(/function _renderLeavePopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(!/<style>/.test(renderLeaveBody), "_renderLeavePopover ต้องไม่มี <style> block (CSS ย้ายไป container scope แล้ว)");
  // _renderDayListPopover ก็ต้องไม่มีเช่นกัน (เคยไม่มีอยู่แล้วใน 92.39c — verify ว่ายังไม่ regression)
  const renderDayBody = src.match(/function _renderDayListPopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(!/<style>/.test(renderDayBody), "_renderDayListPopover ต้องไม่มี <style> block");
});

test("source: container scope <style> ใน _rerender มี .lm-pop-dialog rules ครบ (CSS ทำงานทั้ง 2 popover types)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // หา style block ที่ตามหลัง #lmPopover (container scope)
  const m = src.match(/id="lmPopover"[\s\S]*?<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "ต้องมี <style> block หลัง #lmPopover container");
  const css = m[1];
  // ต้องมี dialog rules
  assert.match(css, /\.lm-pop-dialog\s*\{/, "container scope CSS ต้องมี .lm-pop-dialog rule");
  assert.match(css, /max-height:\s*calc\(100vh\s*-\s*\d+px\)/, "ต้องมี max-height calc");
  assert.match(css, /\.lm-pop-dialog\s*>\s*\.lm-pop-body[\s\S]{0,200}?overflow-y:\s*auto/, "ต้องมี inner body scroll rule");
  // mobile bottom sheet
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.lm-pop-dialog[\s\S]*?bottom:\s*0/, "ต้องมี mobile bottom sheet override");
});

test("source: _openPopover shared function — guard empty content + sanity check .lm-pop-dialog", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _openPopover exists
  assert.match(src, /function _openPopover\(html,\s*kind,\s*bindActions\)/);
  // empty content guard — ไม่เปิด backdrop ถ้า content ว่าง
  assert.match(src, /function _openPopover[\s\S]*?if \(!content\)/);
  assert.match(src, /function _openPopover[\s\S]*?console\.warn[\s\S]{0,200}?empty content/);
  // sanity check ว่ามี dialog markup (กัน scope bug)
  assert.match(src, /function _openPopover[\s\S]*?content\.includes\(["']lm-pop-dialog["']\)/);
  // set innerHTML + display:block หลัง guard
  assert.match(src, /function _openPopover[\s\S]*?pop\.innerHTML = content[\s\S]{0,200}?pop\.style\.display = ["']block["']/);
});

test("source: _openLeavePopover และ _openDayListPopover ใช้ _openPopover (DRY)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /function _openLeavePopover[\s\S]*?_openPopover\(html,\s*["']leave["']/);
  assert.match(src, /function _openDayListPopover[\s\S]*?_openPopover\(html,\s*["']dayList["']/);
});

test("_renderDayListPopover output มี .lm-pop-dialog markup + #lmPopBackdrop (visible structure)", async () => {
  // Source-level: ตรวจ template literal output รวม markup ที่จำเป็น (กัน 92.39c bug ที่ dialog ไม่มี styling)
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderDayListPopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องหา _renderDayListPopover พบ");
  assert.match(body, /id="lmPopBackdrop"/, "ต้องมี backdrop");
  assert.match(body, /class="lm-pop-dialog"/, "ต้องมี dialog ที่ใช้ class .lm-pop-dialog");
  assert.match(body, /class="lm-pop-body"/, "ต้องมี body wrapper class .lm-pop-body");
  assert.match(body, /id="lmPopClose"/, "ต้องมีปุ่มปิด");
  // events.map → render chip
  assert.match(body, /events\.map\([\s\S]{0,200}?_calendarEventChip/);
});

// ── formatAgendaDateLabel ───────────────────────────────

test("formatAgendaDateLabel — เคสปกติ produce 'วันXX D เดือน'", () => {
  // 14 พ.ค. 2026 = Thursday
  const s = formatAgendaDateLabel("2026-05-14");
  assert.match(s, /^วัน(พุธ|พฤหัสบดี|ศุกร์|จันทร์|อังคาร|เสาร์|อาทิตย์) 14 พ\.ค\.$/);
});

test("formatAgendaDateLabel — invalid → empty string", () => {
  assert.equal(formatAgendaDateLabel(""), "");
  assert.equal(formatAgendaDateLabel("not-a-date"), "");
  assert.equal(formatAgendaDateLabel(null), "");
  assert.equal(formatAgendaDateLabel(undefined), "");
  assert.equal(formatAgendaDateLabel("2026-13-99"), "");
});

test("formatAgendaDateLabel — รองรับทุก month short label", () => {
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  for (let i = 0; i < 12; i++) {
    const mm = String(i + 1).padStart(2, "0");
    const out = formatAgendaDateLabel(`2026-${mm}-15`);
    assert.ok(out.endsWith(months[i]), `expected ends with ${months[i]} got "${out}"`);
  }
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.40 — Calendar Event Detail Actions Polish
// ═══════════════════════════════════════════════════════════

const _kindsOf = (descriptors) => descriptors.map(d => d.kind);

test("calendarDetailActionsFor — null leave → []", () => {
  assert.deepEqual(calendarDetailActionsFor(null, "u1", "admin"), []);
});

test("calendarDetailActionsFor — admin + pending → approve/reject/edit/delete/viewInTable", () => {
  const leave = { id: "1", user_id: "u2", status: "pending", leave_type: "sick" };
  const kinds = _kindsOf(calendarDetailActionsFor(leave, "uAdmin", "admin"));
  assert.deepEqual(kinds, ["approve", "reject", "edit", "delete", "viewInTable"]);
});

test("calendarDetailActionsFor — admin + approved → edit/delete/viewInTable (ไม่มี approve/reject)", () => {
  const leave = { id: "1", user_id: "u2", status: "approved", leave_type: "sick" };
  const kinds = _kindsOf(calendarDetailActionsFor(leave, "uAdmin", "admin"));
  assert.deepEqual(kinds, ["edit", "delete", "viewInTable"]);
});

test("calendarDetailActionsFor — admin + rejected/cancelled → edit/delete/viewInTable", () => {
  for (const status of ["rejected", "cancelled"]) {
    const leave = { id: "1", user_id: "u2", status, leave_type: "sick" };
    const kinds = _kindsOf(calendarDetailActionsFor(leave, "uAdmin", "admin"));
    assert.deepEqual(kinds, ["edit", "delete", "viewInTable"], `status=${status}`);
  }
});

test("calendarDetailActionsFor — non-admin own + pending → cancel/viewInTable", () => {
  const leave = { id: "1", user_id: "u1", status: "pending", leave_type: "sick" };
  const kinds = _kindsOf(calendarDetailActionsFor(leave, "u1", "sales"));
  assert.deepEqual(kinds, ["cancel", "viewInTable"]);
});

test("calendarDetailActionsFor — non-admin own + approved → viewInTable only (ไม่มี admin actions)", () => {
  const leave = { id: "1", user_id: "u1", status: "approved", leave_type: "sick" };
  const kinds = _kindsOf(calendarDetailActionsFor(leave, "u1", "sales"));
  assert.deepEqual(kinds, ["viewInTable"]);
});

test("calendarDetailActionsFor — non-admin OTHER pending → viewInTable only (ไม่เห็น cancel ของคนอื่น)", () => {
  const leave = { id: "1", user_id: "u2", status: "pending", leave_type: "sick" };
  const kinds = _kindsOf(calendarDetailActionsFor(leave, "u1", "sales"));
  assert.deepEqual(kinds, ["viewInTable"]);
});

test("calendarDetailActionsFor — non-admin role technician/customer behaves เหมือน sales (เปรียบเทียบ sales/admin)", () => {
  const leave = { id: "1", user_id: "u1", status: "pending", leave_type: "sick" };
  for (const role of ["sales", "technician", "customer"]) {
    const kinds = _kindsOf(calendarDetailActionsFor(leave, "u1", role));
    assert.deepEqual(kinds, ["cancel", "viewInTable"], `role=${role}`);
  }
});

test("calendarDetailActionsFor — descriptors มี label + style + ไม่มี kind ซ้ำ + viewInTable last", () => {
  const leave = { id: "1", user_id: "u2", status: "pending", leave_type: "sick" };
  const ds = calendarDetailActionsFor(leave, "uAdmin", "admin");
  for (const d of ds) {
    assert.ok(typeof d.kind === "string" && d.kind.length > 0);
    assert.ok(typeof d.label === "string" && d.label.length > 0);
    assert.ok(typeof d.style === "string" && d.style.length > 0);
  }
  const kinds = ds.map(d => d.kind);
  assert.equal(new Set(kinds).size, kinds.length, "kinds ต้อง unique");
  assert.equal(kinds[kinds.length - 1], "viewInTable", "viewInTable ต้องอยู่ท้ายเสมอ");
});

// ── formatReviewedAt ───────────────────────────────────────

test("formatReviewedAt — null/empty/undefined → ''", () => {
  assert.equal(formatReviewedAt(null), "");
  assert.equal(formatReviewedAt(undefined), "");
  assert.equal(formatReviewedAt(""), "");
});

test("formatReviewedAt — invalid ISO → ''", () => {
  assert.equal(formatReviewedAt("not-a-date"), "");
  assert.equal(formatReviewedAt("2026-99-99T99:99:99Z"), "");
});

test("formatReviewedAt — valid ISO → th-TH short with day/month/year/hour/minute", () => {
  // 2026-05-27 07:30 UTC = 14:30 Bangkok
  const out = formatReviewedAt("2026-05-27T07:30:00Z");
  assert.ok(out.length > 0, "ต้องไม่ใช่ empty");
  assert.match(out, /พ\.?ค\.?/, "ต้องมีเดือนไทย พ.ค.");
  // hour:minute (อาจมี space/non-breaking — ใช้ \s? และ \D เพื่อรองรับ ICU variations)
  assert.match(out, /14[:.]30/, "ต้องมีเวลา 14:30 หรือ 14.30");
});

// ── Source-level smoke (wiring) ────────────────────────────

test("source: _renderLeavePopover ใช้ calendarDetailActionsFor + formatReviewedAt (driver จาก helper)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderLeavePopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ function _renderLeavePopover");
  assert.match(body, /calendarDetailActionsFor\(/, "ต้องเรียก calendarDetailActionsFor");
  assert.match(body, /formatReviewedAt\(/, "ต้องเรียก formatReviewedAt");
  assert.match(body, /id="lmPopError"/, "ต้องมี error banner div");
  // ทุก action class ต้องสามารถ generate ได้จาก descriptor (มี class mapping)
  assert.match(src, /_actionClassFor\(/, "ต้องมี helper _actionClassFor");
  assert.match(src, /lm-pop-view-in-table/, "ต้องมี class lm-pop-view-in-table");
});

test("source: _openLeavePopover bind lm-pop-view-in-table → _jumpToTableRow + ใช้ _runPopoverAction (await before close)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _openLeavePopover[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _openLeavePopover");
  assert.match(body, /lm-pop-view-in-table[\s\S]{0,200}?_jumpToTableRow/, "ต้อง bind view-in-table → _jumpToTableRow");
  assert.match(body, /_runPopoverAction\(/, "approve/reject/cancel/delete ต้องผ่าน _runPopoverAction (error stays open)");
  // ห้ามมี pattern เดิม "_closePopover(); await _doReview" — ปิดก่อน await = bug ที่ 92.40 แก้
  assert.ok(!/_closePopover\(\);\s*await\s+_doReview/.test(body), "ห้าม close ก่อน await action (regression guard 92.40)");
  assert.ok(!/_closePopover\(\);\s*await\s+_doCancel/.test(body), "ห้าม close ก่อน await _doCancel");
  assert.ok(!/_closePopover\(\);\s*await\s+_doDelete/.test(body), "ห้าม close ก่อน await _doDelete");
});

test("source: _runPopoverAction ปิด popover เฉพาะตอน result.ok + แสดง error banner ตอน fail", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /async function _runPopoverAction/, "ต้องมี _runPopoverAction");
  const body = src.match(/async function _runPopoverAction[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.match(body, /result\?\.ok/, "เช็ค result.ok");
  assert.match(body, /_closePopover\(\)/, "ปิด popover ตอน success");
  assert.match(body, /_setPopoverError\(/, "เรียก _setPopoverError ตอน fail");
});

test("source: _do(Review|Cancel|Delete) คืน {ok, error} — caller-friendly result shape", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // หา signature + return shapes ของแต่ละ function
  for (const fn of ["_doReview", "_doCancel", "_doDelete"]) {
    const m = src.match(new RegExp(`async function ${fn}[\\s\\S]*?^  }`, "m"));
    assert.ok(m, `ต้องเจอ ${fn}`);
    const body = m[0];
    assert.match(body, /return \{ ok: true \}/, `${fn} ต้องคืน {ok:true} ตอนสำเร็จ`);
    assert.match(body, /return \{ ok: false[\s\S]{0,100}?error/, `${fn} ต้องคืน {ok:false,error:...} ตอน fail`);
  }
});

test("source: _renderTbody ใส่ data-lm-id บน <tr> (เพื่อ scroll/highlight ได้)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderTbody[\s\S]*?^ {2}\}\.join\(""\);/m)?.[0]
    || src.match(/function _renderTbody[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _renderTbody");
  assert.match(body, /<tr data-lm-id="\$\{escHtml\(String\(r\.id\)\)\}"/, "ทุก <tr> ต้องมี data-lm-id");
});

test("source: container scope <style> มี @keyframes lmRowHighlight + .lm-row-highlight rule", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const m = src.match(/id="lmPopover"[\s\S]*?<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "ต้องเจอ container scope <style>");
  const css = m[1];
  assert.match(css, /@keyframes\s+lmRowHighlight/, "ต้องมี @keyframes lmRowHighlight");
  assert.match(css, /\.lm-row-highlight\s*\{[\s\S]{0,200}?animation:\s*lmRowHighlight/, "ต้องมี .lm-row-highlight rule ที่ใช้ animation");
});

test("source: _jumpToTableRow + _scrollAndHighlightRow — switch view, confirm filter, scroll, highlight", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _jumpToTableRow
  const jBody = src.match(/function _jumpToTableRow[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(jBody.length > 0, "ต้องเจอ _jumpToTableRow");
  assert.match(jBody, /filterLeaves\(/, "ต้องเช็ค filter ปัจจุบัน");
  assert.match(jBody, /await\s+_confirmDialog\(/, "ต้องถาม confirm กลางตอน row ตก filter");
  assert.match(jBody, /activeView\s*=\s*["']table["']/, "ต้อง switch ไป table view");
  assert.match(jBody, /_closePopover\(\)/, "ต้องปิด popover");
  assert.match(jBody, /_rerender\(\)/, "ต้อง rerender");
  assert.match(jBody, /_scrollAndHighlightRow\(/, "ต้องเรียก _scrollAndHighlightRow");
  // _scrollAndHighlightRow
  const sBody = src.match(/function _scrollAndHighlightRow[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(sBody.length > 0, "ต้องเจอ _scrollAndHighlightRow");
  assert.match(sBody, /tr\[data-lm-id=/, "ต้องเลือก <tr> ตาม data-lm-id");
  assert.match(sBody, /scrollIntoView/, "ต้องเรียก scrollIntoView");
  assert.match(sBody, /classList\.add\(["']lm-row-highlight["']\)/, "ต้อง add highlight class");
  assert.match(sBody, /setTimeout\([\s\S]{0,150}?classList\.remove/, "ต้อง remove class หลัง timeout");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.41b — HOTFIX: payroll leave deduction wrong daily rate
//  Production bug: workDays=13 + dailyRate=400 + overQuotaDays=2 → showed ฿26 (= 2 × 13)
//                  คาดหวัง: ฿800 (= 2 × 400) — bug มาจาก fallback ไป emp.daily_rate (stale=13)
//                  ใน payroll.js _refreshLeaveDecision ตอน input rate ว่าง/0
// ═══════════════════════════════════════════════════════════

test("decidePayrollLeaveImpact — HOTFIX 92.41b: workDays=13 dailyRate=400 overQuota=2 → suggested=800 (NOT 26)", () => {
  // Production reproducer: vacation over quota by 2 days, daily rate 400 from input, base 5200 (=13×400)
  // ห้ามคำนวณเป็น 2 × workDays(13) — ต้อง 2 × dailyRate(400)
  const balances = new Map();
  balances.set("vacation", { tracksBalance: true, quota: 0, used: 2 }); // 2 over quota (used=2, quota=0)
  const monthSummary = {
    vacationDays: 2, sickDays: 0, personalDays: 0,
    unpaidDays: 0, otherDays: 0, totalApprovedDays: 2, records: 1,
  };
  const d = decidePayrollLeaveImpact({
    monthSummary, balances,
    dailyRate: 400,     // ค่าจ้าง/วัน
    baseSalary: 5200,   // 13 × 400 (workDays auto-computed)
  });
  assert.equal(d.overQuotaDays, 2, "over quota ต้องเป็น 2");
  assert.equal(d.deductibleDays, 2, "deductible = over quota (ไม่มี unpaid)");
  assert.equal(d.suggestedDeduction, 800, "ต้องเป็น 2 × 400 = 800 (ไม่ใช่ 2 × 13 = 26)");
  // safety: ห้ามได้ค่า ฿26 (= workDays × overQuotaDays)
  assert.notEqual(d.suggestedDeduction, 26, "regression guard: ห้ามใช้ workDays=13 เป็น rate");
});

test("decidePayrollLeaveImpact — dailyRate=0 + baseSalary=5200 → fallback ÷30 (ไม่ใช่ ÷workDays)", () => {
  // ถ้า user ปิด daily mode (dailyRate=0) ส่งมา helper → ต้อง fallback ไป baseSalary÷30
  // (ไม่ใช่ baseSalary÷workDays หรือ math อื่น)
  const balances = new Map();
  balances.set("vacation", { tracksBalance: true, quota: 0, used: 2 });
  const monthSummary = { vacationDays: 2, sickDays: 0, personalDays: 0, unpaidDays: 0, otherDays: 0, totalApprovedDays: 2, records: 1 };
  const d = decidePayrollLeaveImpact({ monthSummary, balances, dailyRate: 0, baseSalary: 5200 });
  // 5200 / 30 × 2 = 346.666... ปัด 2 ตำแหน่ง = 346.67
  assert.equal(d.suggestedDeduction, 346.67, "fallback ต้องใช้ baseSalary÷30 ไม่ใช่ formula อื่น");
});

test("calcUnpaidLeaveDeduction — dailyRate priority > baseSalary (regression guard)", () => {
  // ทั้งสองมา → dailyRate ชนะ; ไม่ใช่ ÷30 หรือ avg
  const out = calcUnpaidLeaveDeduction({ unpaidDays: 2, dailyRate: 400, baseSalary: 5200 });
  assert.equal(out, 800);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.41c — HOTFIX: Leave page pending KPI/alert sync
// ═══════════════════════════════════════════════════════════

test("countPendingLeaves — count ทุก pending ไม่ filter month", () => {
  const rows = [
    { status: "pending",   start_date: "2026-05-15", end_date: "2026-05-16" },
    { status: "pending",   start_date: "2026-06-10", end_date: "2026-06-10" }, // next month
    { status: "approved",  start_date: "2026-05-01", end_date: "2026-05-01" },
    { status: "rejected",  start_date: "2026-05-02", end_date: "2026-05-02" },
    { status: "cancelled", start_date: "2026-05-03", end_date: "2026-05-03" },
  ];
  assert.equal(countPendingLeaves(rows), 2, "ต้องนับทั้ง pending ของเดือนนี้ + เดือนถัดไป");
});

test("countPendingLeaves — null/undefined/empty → 0", () => {
  assert.equal(countPendingLeaves(null), 0);
  assert.equal(countPendingLeaves(undefined), 0);
  assert.equal(countPendingLeaves([]), 0);
});

test("countPendingLeaves — differ จาก summarizeLeaves(rows, month).pending — regression guard ของ HOTFIX", () => {
  // ถ้า user สร้าง pending leave สำหรับเดือนถัดไป + ดู KPI ของเดือนปัจจุบัน
  //   summarizeLeaves(month=2026-05).pending = 0 (filter month กรองออก)
  //   countPendingLeaves(rows) = 1 (ไม่ filter)
  // → KPI ต้องใช้ countPendingLeaves สำหรับ "รออนุมัติ (ทุกเดือน)"
  const rows = [{ status: "pending", start_date: "2026-06-10", end_date: "2026-06-10" }];
  const s = summarizeLeaves(rows, "2026-05");
  assert.equal(s.pending, 0, "month-filter ตัด pending เดือนถัดไปออก (expected)");
  assert.equal(countPendingLeaves(rows), 1, "countPendingLeaves ไม่ตัด → ยังเห็น");
});

test("pendingLeaveAlertMeta — admin + count > 0 → return meta", () => {
  const m = pendingLeaveAlertMeta(3, "admin");
  assert.ok(m, "ต้องคืน meta");
  assert.equal(m.count, 3);
  assert.match(m.message, /คำขอลารออนุมัติ 3 รายการ/);
  assert.ok(m.actionLabel && m.actionLabel.length > 0);
});

test("pendingLeaveAlertMeta — non-admin → null (เห็นเฉพาะ admin)", () => {
  assert.equal(pendingLeaveAlertMeta(5, "sales"), null);
  assert.equal(pendingLeaveAlertMeta(5, "technician"), null);
  assert.equal(pendingLeaveAlertMeta(5, "customer"), null);
  assert.equal(pendingLeaveAlertMeta(5, "owner"), null);
});

test("pendingLeaveAlertMeta — count=0 → null (ไม่ render alert ถ้าไม่มี pending)", () => {
  assert.equal(pendingLeaveAlertMeta(0, "admin"), null);
  assert.equal(pendingLeaveAlertMeta(null, "admin"), null);
  assert.equal(pendingLeaveAlertMeta(undefined, "admin"), null);
  assert.equal(pendingLeaveAlertMeta(NaN, "admin"), null);
});

test("filterLeaves — status=all รวม pending (regression guard)", () => {
  const rows = [
    { status: "pending",   start_date: "2026-05-15", end_date: "2026-05-15", days_count: 1, user_id: "u1", leave_type: "sick" },
    { status: "approved",  start_date: "2026-05-15", end_date: "2026-05-15", days_count: 1, user_id: "u1", leave_type: "sick" },
    { status: "cancelled", start_date: "2026-05-15", end_date: "2026-05-15", days_count: 1, user_id: "u1", leave_type: "sick" },
  ];
  // status default = "all" → ทุก row
  const out = filterLeaves(rows, { month: "2026-05" });
  assert.equal(out.length, 3, "status=all (default) ต้องรวมทั้ง pending/approved/cancelled");
  assert.ok(out.some(r => r.status === "pending"), "ต้องมี pending ใน result");
});

test("source: _rerender ใช้ countPendingLeaves สำหรับ KPI รออนุมัติ + ส่ง pendingTotal เป็นค่า", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // _rerender body ต้องเรียก countPendingLeaves
  assert.match(src, /function _rerender[\s\S]{0,500}?countPendingLeaves\(leaves\)/,
    "_rerender ต้องคำนวณ pendingTotal จาก countPendingLeaves(leaves)");
  // KPI "รออนุมัติ" ต้องใช้ pendingTotal (ไม่ใช่ summary.pending ที่ filter month)
  assert.match(src, /label:\s*["']รออนุมัติ["'][\s\S]{0,200}?NUM_TH\(pendingTotal\)/,
    "KPI รออนุมัติ value ต้องใช้ pendingTotal");
  // ห้ามใช้ summary.pending ใน KPI label "รออนุมัติ" (regression guard)
  assert.ok(!/label:\s*["']รออนุมัติ["'][\s\S]{0,200}?NUM_TH\(summary\.pending\)/.test(src),
    "KPI รออนุมัติ ห้ามใช้ summary.pending แล้ว (เดิม filter month → bug 92.41c)");
});

test("source: _rerender render admin pending alert + bind lmPendingAlertBtn click", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // alert template uses pendingAlert variable
  assert.match(src, /pendingLeaveAlertMeta\(pendingTotal,\s*role\)/, "ต้องเรียก helper สำหรับ alert meta");
  assert.match(src, /id="lmPendingAlertBtn"/, "ต้องมีปุ่ม alert");
  assert.match(src, /pendingAlert\s*\?\s*`/, "render ผ่าน conditional");
  // bind handler: set activeStatus + clear month + rerender + scroll
  const handler = src.match(/lmPendingAlertBtn["']\)\?\.addEventListener\(["']click["'],\s*\(\)\s*=>\s*\{[\s\S]{0,400}?\}\)/);
  assert.ok(handler, "ต้อง bind click handler");
  const body = handler[0];
  assert.match(body, /activeStatus\s*=\s*["']pending["']/, "set status=pending");
  assert.match(body, /activeMonth\s*=\s*["']{2}/, "clear month filter");
  assert.match(body, /activeView\s*=\s*["']table["']/, "switch to table view");
  assert.match(body, /_rerender\(\)/, "rerender");
  assert.match(body, /scrollIntoView/, "scroll table");
});

test("source: form submit success ยัง trigger _rerender (regression guard)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // Phase 92.45 refactor: insert path wraps row ใน insertedRow var ก่อน unshift + _rerender อยู่หลัง branch
  // ตรวจว่า insert success → push เข้า local cache + rerender ยังทำงาน
  assert.match(src, /leaves\.unshift\(insertedRow\)/, "insert success ต้อง push เข้า local cache");
  const formSubmit = src.match(/modal\.querySelector\("#lmForm"\)\?\.addEventListener\("submit",[\s\S]*?\}\);\s*\}/)?.[0] || "";
  assert.match(formSubmit, /closeModal\(\);\s*_rerender\(\);/, "submit success ต้อง closeModal + _rerender");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.42 — Leave page click-through cards (internal navigation)
// ═══════════════════════════════════════════════════════════

test("kpiFilterActionFor — pending → status=pending + clearMonth + switchTable", () => {
  const a = kpiFilterActionFor("pending");
  assert.equal(a.status, "pending");
  assert.equal(a.clearMonth, true, "pending sub label = ทุกเดือน → clearMonth");
  assert.equal(a.switchTable, true, "pending → switch table for easy approve/reject");
});

test("kpiFilterActionFor — approved/rejected → keep month + keep view (label = monthTh)", () => {
  for (const kind of ["approved", "rejected"]) {
    const a = kpiFilterActionFor(kind);
    assert.equal(a.status, kind, `${kind} → status=${kind}`);
    assert.equal(a.clearMonth, false, `${kind} sub label = monthTh → keep month`);
    assert.equal(a.switchTable, false, `${kind} → keep current view`);
  }
});

test("kpiFilterActionFor — approvedDays alias of approved", () => {
  const a = kpiFilterActionFor("approvedDays");
  assert.equal(a.status, "approved", "approvedDays = days count → still filter approved");
});

test("kpiFilterActionFor — unknown kind → null", () => {
  assert.equal(kpiFilterActionFor("nonexistent"), null);
  assert.equal(kpiFilterActionFor(""), null);
  assert.equal(kpiFilterActionFor(null), null);
  assert.equal(kpiFilterActionFor(undefined), null);
});

test("balanceFilterActionFor — รู้จัก leave_type ทุก type ใน LEAVE_TYPES", () => {
  for (const t of ["vacation", "sick", "personal", "unpaid", "other"]) {
    const a = balanceFilterActionFor(t);
    assert.ok(a, `${t} → ต้องคืน action`);
    assert.equal(a.leaveType, t);
    assert.equal(a.clearMonth, true, "balance scope = ทั้งปี → clear month");
    assert.equal(a.resetStatus, true, "เห็นทั้ง pending/approved/rejected ของ type นี้");
  }
});

test("balanceFilterActionFor — invalid type → null", () => {
  assert.equal(balanceFilterActionFor("weird"), null);
  assert.equal(balanceFilterActionFor(""), null);
  assert.equal(balanceFilterActionFor(null), null);
  assert.equal(balanceFilterActionFor(undefined), null);
});

// ── Source-level wiring (Phase 92.42) ──────────────────────

test("source: KPI 4 ใบหลักทุกใบส่ง clickKind ผ่าน _kpiCard", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  for (const kind of ["pending", "approved", "rejected", "approvedDays"]) {
    const re = new RegExp(`clickKind:\\s*["']${kind}["']`);
    assert.match(src, re, `ต้องมี clickKind: "${kind}" ใน KPI card`);
  }
});

test("source: _kpiCard มี data-lm-kpi-kind + role=button + aria-label + chevron เมื่อ clickKind", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _kpiCard[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _kpiCard");
  assert.match(body, /data-lm-kpi-kind=/, "ต้องมี data-lm-kpi-kind attribute");
  assert.match(body, /role="button"/, "ต้องมี role=button");
  assert.match(body, /tabindex="0"/, "ต้องมี tabindex=0");
  assert.match(body, /aria-label="\$\{escHtml\(/, "ต้องมี dynamic aria-label");
  // chevron icon เมื่อ clickKind
  assert.match(body, /clickKind\s*\?\s*`[\s\S]{0,200}?›/, "ต้องมี chevron icon");
});

test("source: _renderBalanceCard wrapper เป็น .lm-balance-card + data-lm-balance-type + role=button", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderBalanceCard[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _renderBalanceCard");
  assert.match(body, /class="lm-balance-card"/, "ต้องมี class lm-balance-card");
  assert.match(body, /data-lm-balance-type=/, "ต้องมี data-lm-balance-type");
  assert.match(body, /role="button"/, "role=button");
  assert.match(body, /tabindex="0"/, "tabindex=0");
  assert.match(body, /aria-label=/, "aria-label");
  // chevron
  assert.match(body, /›/, "ต้องมี chevron");
});

test("source: container <style> มี .lm-kpi-card:hover + .lm-balance-card:hover + :focus-visible", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /\.lm-kpi-card[\s\S]{0,200}?\.lm-balance-card[\s\S]{0,200}?hover/, "ต้องมี hover rules ทั้ง 2 cards");
  assert.match(src, /\.lm-kpi-card:focus-visible[\s\S]{0,200}?outline:|\.lm-balance-card:focus-visible[\s\S]{0,200}?outline:/, "ต้องมี focus-visible outline");
});

test("source: _rerender bind .lm-kpi-card click → kpiFilterActionFor + activeStatus/Month/View", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /querySelectorAll\(["']\.lm-kpi-card\[data-lm-kpi-kind\]["']\)/, "ต้อง querySelectorAll KPI cards");
  assert.match(src, /kpiFilterActionFor\(/, "ต้องเรียก kpiFilterActionFor");
  assert.match(src, /_applyKpiKind/, "ต้องมี _applyKpiKind handler");
  // keyboard
  assert.match(src, /addEventListener\(["']keydown["'],\s*\(ev\)\s*=>\s*\{[\s\S]{0,200}?Enter["']\s*\|\|\s*ev\.key\s*===\s*["'] ["']/, "ต้องรองรับ keyboard (Enter/Space)");
});

test("source: _rerender bind .lm-balance-card click → balanceFilterActionFor + activeType", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /querySelectorAll\(["']\.lm-balance-card\[data-lm-balance-type\]["']\)/, "ต้อง querySelectorAll Balance cards");
  assert.match(src, /balanceFilterActionFor\(/, "ต้องเรียก balanceFilterActionFor");
  assert.match(src, /activeType\s*=\s*action\.leaveType/, "ต้อง set activeType จาก action");
});

test("source: pending alert ยังทำงาน (regression guard Phase 92.41c)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // alert button binding ยังอยู่
  assert.match(src, /id="lmPendingAlertBtn"/, "alert button ยังต้องมี");
  assert.match(src, /getElementById\(["']lmPendingAlertBtn["']\)\?\.addEventListener/, "ยัง bind click");
});

test("source: payroll.js _refreshLeaveDecision ไม่ fallback ไป emp.daily_rate แล้ว (Phase 92.41b)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
  const body = src.match(/function _refreshLeaveDecision[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _refreshLeaveDecision");
  // ห้ามมี fallback ไป emp?.daily_rate ใน ternary หา dailyRate
  assert.ok(!/dailyRate\s*=\s*[\s\S]{0,200}?emp\?\.daily_rate/.test(body),
    "_refreshLeaveDecision ต้องไม่ fallback ไป emp.daily_rate (stale risk — bug 92.41b)");
  // ต้องอ่านจาก prDailyRate (ค่าจ้าง/วัน) เท่านั้น — ไม่ใช่ prDaysWorked (จำนวนวันทำงาน)
  assert.match(body, /document\.getElementById\(["']prDailyRate["']\)/, "ต้องอ่านจาก prDailyRate");
  assert.ok(!/document\.getElementById\(["']prDaysWorked["']\)[\s\S]{0,200}?dailyRate/.test(body),
    "ห้ามอ่าน prDaysWorked แล้วใช้เป็น dailyRate (mapping swap guard)");
});

test("source: _renderLeavePopover แสดง email + role (ถ้ามี) ใน header", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderLeavePopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _renderLeavePopover");
  // header รวม email + role
  assert.match(body, /p\?\.email[\s\S]{0,200}?p\?\.role/, "ต้องเช็ค p?.email + p?.role");
});

// ── Phase 92.40b: day-list hint copy + chip a11y ──

test("source: day-list popover ไม่มี hint copy เก่า 'คลิกรายการเพื่อดูรายละเอียด' แล้ว", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.ok(!/คลิกรายการเพื่อดูรายละเอียด/.test(src),
    "hint copy เก่าทำให้ user เข้าใจผิดว่ากดได้ — ห้ามมีใน source แล้ว");
});

test("source: day-list popover มี hint copy ใหม่ + class lm-day-hint + aria-hidden + style help", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _renderDayListPopover[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _renderDayListPopover");
  assert.match(body, /เลือกรายการด้านบนเพื่อเปิดรายละเอียด/, "ต้องมี hint copy ใหม่");
  assert.match(body, /class="lm-day-hint"/, "hint ต้องมี class lm-day-hint");
  assert.match(body, /aria-hidden="true"/, "hint ต้อง aria-hidden=true (เป็นแค่ helper text)");
  assert.match(body, /cursor:\s*default/, "hint ต้อง cursor:default (ไม่หลอกว่ากดได้)");
  assert.match(body, /user-select:\s*none/, "hint ต้อง user-select:none (เป็น UI text ไม่ใช่ data)");
});

test("source: _calendarEventChip มี aria-label ระบุชื่อ+ประเภท+สถานะ + cursor:pointer ยังอยู่ (clickable)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/function _calendarEventChip[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _calendarEventChip");
  assert.match(body, /aria-label="\$\{escHtml\(ariaSummary\)\}"/, "ต้องมี aria-label dynamic");
  assert.match(body, /เปิดรายละเอียดคำขอลา/, "aria summary text ต้องสื่อความหมาย");
  assert.match(body, /cursor:\s*pointer/, "chip ยังต้อง clickable (cursor:pointer)");
});

test("source: .lm-cal-event มี :focus-visible affordance (keyboard/SR users เห็นว่ากดได้)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  assert.match(src, /\.lm-cal-event:focus-visible\s*\{[\s\S]{0,200}?outline:/,
    "ต้องมี .lm-cal-event:focus-visible rule");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.45 — Leave SQL/RLS Hardening + Audit Enforcement
// ═══════════════════════════════════════════════════════════

test("source: Phase 92.45 — _callReviewRpc helper hits /rpc/review_staff_leave with admin-only payload", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/async function _callReviewRpc[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องมี helper _callReviewRpc");
  assert.match(body, /\/rest\/v1\/rpc\/review_staff_leave/, "ต้องเรียก PostgREST RPC endpoint");
  assert.match(body, /method:\s*["']POST["']/, "RPC ต้อง POST");
  assert.match(body, /p_leave_id/, "ต้องส่ง p_leave_id");
  assert.match(body, /p_status/, "ต้องส่ง p_status");
  assert.match(body, /p_note/, "ต้องส่ง p_note");
});

test("source: Phase 92.45 — _doReview ใช้ _callReviewRpc แทน _patchLeave + ไม่ส่ง reviewed_by/reviewed_at จาก client", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/async function _doReview[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _doReview");
  assert.match(body, /_callReviewRpc\(/, "_doReview ต้องเรียก _callReviewRpc (RPC path)");
  // กัน regression: client ห้าม set reviewed_by/reviewed_at ใน patch อีกแล้ว — server เป็นคน set
  assert.ok(!/reviewed_by:\s*currentUserId/.test(body),
    "_doReview ต้องไม่ส่ง reviewed_by: currentUserId แล้ว (server-side trigger จัดการ)");
  assert.ok(!/reviewed_at:\s*new Date\(\)\.toISOString\(\)/.test(body),
    "_doReview ต้องไม่ส่ง reviewed_at: client clock แล้ว (server-side trigger ใช้ now())");
  // ห้าม fallback กลับไป _patchLeave สำหรับ review path
  assert.ok(!/_patchLeave\(\s*row\.id\s*,\s*\{[\s\S]{0,200}?reviewed_by/.test(body),
    "_doReview ห้าม _patchLeave({ reviewed_by ... }) (RPC only)");
});

test("source: Phase 92.45 — _doReview audit metadata ใช้ค่า reviewed_by/reviewed_at จาก RPC response (server-trusted)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const body = src.match(/async function _doReview[\s\S]*?^ {2}}/m)?.[0] || "";
  assert.match(body, /updatedRow\?\.reviewed_by/, "audit after.reviewed_by ต้องอ่านจาก RPC response");
  assert.match(body, /updatedRow\?\.reviewed_at/, "audit after.reviewed_at ต้องอ่านจาก RPC response");
  // approve/reject action ยังต้อง audit อยู่ (regression guard 92.43 B4)
  assert.match(body, /logActivity\(decision === "approved" \? "leave_approve" : "leave_reject"/,
    "audit log ของ approve/reject ต้องยังอยู่");
});

test("source: Phase 92.45 — form submit branches on existing → PATCH edit path", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const formSubmit = src.match(/modal\.querySelector\("#lmForm"\)\?\.addEventListener\("submit",[\s\S]*?\}\);\s*\}/)?.[0] || "";
  assert.ok(formSubmit.length > 0, "ต้องเจอ form submit handler");
  assert.match(formSubmit, /if\s*\(\s*existing\s*&&\s*existing\.id\s*!=\s*null\s*\)/,
    "submit ต้อง branch ตาม existing.id");
  assert.match(formSubmit, /_patchLeave\(\s*existing\.id\s*,\s*patch\s*\)/,
    "edit path ต้องเรียก _patchLeave(existing.id, patch)");
  assert.match(formSubmit, /_insertLeave\(body\)/, "create path ยังต้องเรียก _insertLeave");
});

test("source: Phase 92.45 — edit PATCH body ห้ามมี status/reviewed_*/user_id/created_by (safe fields only)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  // จับ block ของ patch object ใน edit path
  const patchBlock = src.match(/\/\/ Phase 92\.45: EDIT path[\s\S]*?const patch = \{([\s\S]*?)\};/)?.[1] || "";
  assert.ok(patchBlock.length > 0, "ต้องเจอ patch object ใน edit path");
  // safe fields ต้องมี
  for (const f of ["leave_type", "start_date", "end_date", "days_count", "reason"]) {
    assert.match(patchBlock, new RegExp(`${f}\\s*:`), `patch ต้องมี ${f}`);
  }
  // dangerous fields ห้ามมี
  for (const bad of ["status", "reviewed_by", "reviewed_at", "review_note", "user_id", "created_by"]) {
    assert.ok(!new RegExp(`${bad}\\s*:`).test(patchBlock),
      `patch ห้ามมี ${bad} (server-side trigger + RPC จัดการ)`);
  }
});

test("source: Phase 92.45 — leave_create audit ใน insert path success", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const formSubmit = src.match(/modal\.querySelector\("#lmForm"\)\?\.addEventListener\("submit",[\s\S]*?\}\);\s*\}/)?.[0] || "";
  assert.match(formSubmit, /logActivity\(\s*"leave_create"/, "create path ต้อง logActivity('leave_create', ...)");
  // metadata ต้องมี key fields
  const auditBlock = formSubmit.match(/logActivity\(\s*"leave_create"[\s\S]*?\}\);/)?.[0] || "";
  for (const k of ["user_id", "leave_type", "start_date", "end_date", "days_count", "status"]) {
    assert.match(auditBlock, new RegExp(`${k}\\s*:`), `leave_create metadata ต้องมี ${k}`);
  }
});

test("source: Phase 92.45 — leave_update audit ใน edit path success + before/after diff", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/leave_management.js"), "utf8");
  const formSubmit = src.match(/modal\.querySelector\("#lmForm"\)\?\.addEventListener\("submit",[\s\S]*?\}\);\s*\}/)?.[0] || "";
  assert.match(formSubmit, /logActivity\(\s*"leave_update"/, "edit path ต้อง logActivity('leave_update', ...)");
  const auditBlock = formSubmit.match(/logActivity\(\s*"leave_update"[\s\S]*?\}\);/)?.[0] || "";
  assert.match(auditBlock, /before:\s*\{/, "metadata ต้องมี before:");
  assert.match(auditBlock, /after:\s*\{/, "metadata ต้องมี after:");
  // before ต้องอ้าง existing.* (snapshot ก่อน mutate)
  assert.match(auditBlock, /existing\.leave_type/, "before ต้อง snapshot existing.leave_type");
});

test("source: Phase 92.45 SQL — trigger + RPC ต้องอยู่ใน supabase-phase92-45 file", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("supabase-phase92-45-leave-hardening.sql"), "utf8");
  // trigger functions
  assert.match(src, /CREATE OR REPLACE FUNCTION public\._guard_staff_leaves_insert/,
    "ต้องมี _guard_staff_leaves_insert trigger function");
  assert.match(src, /CREATE OR REPLACE FUNCTION public\._guard_staff_leaves_update/,
    "ต้องมี _guard_staff_leaves_update trigger function");
  // trigger bindings
  assert.match(src, /CREATE TRIGGER trg_staff_leaves_guard_insert[\s\S]{0,200}?BEFORE INSERT/,
    "ต้องมี BEFORE INSERT trigger binding");
  assert.match(src, /CREATE TRIGGER trg_staff_leaves_guard_update[\s\S]{0,200}?BEFORE UPDATE/,
    "ต้องมี BEFORE UPDATE trigger binding");
  // non-admin guard — ห้ามตั้ง reviewed_by ใน INSERT
  assert.match(src, /IF NOT public\.is_accountant\(\)[\s\S]{0,500}?NEW\.reviewed_by\s*:=\s*NULL/,
    "INSERT trigger ต้อง strip reviewed_by เมื่อ non-admin");
  // non-admin UPDATE — ห้ามแก้ status เป็น approved/rejected
  assert.match(src, /NEW\.status NOT IN \('pending','cancelled'\)/,
    "UPDATE trigger ต้อง restrict non-admin status ให้แค่ pending/cancelled");
  // admin auto-set reviewer
  assert.match(src, /NEW\.reviewed_by\s*:=\s*auth\.uid\(\)/,
    "admin path ต้อง auto-set reviewed_by = auth.uid()");
  assert.match(src, /NEW\.reviewed_at\s*:=\s*now\(\)/,
    "admin path ต้อง auto-set reviewed_at = now()");
  // RPC function
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.review_staff_leave\(\s*p_leave_id bigint,\s*p_status\s+text,\s*p_note\s+text/,
    "ต้องมี RPC review_staff_leave(bigint,text,text)");
  // RPC admin guard
  assert.match(src, /review_staff_leave[\s\S]{0,800}?IF NOT public\.is_accountant\(\)/,
    "RPC ต้อง guard admin-only");
  // RPC status whitelist
  assert.match(src, /p_status NOT IN \('approved','rejected','cancelled'\)/,
    "RPC ต้องเช็ค p_status whitelist");
  // GRANT EXECUTE
  assert.match(src, /GRANT EXECUTE ON FUNCTION public\.review_staff_leave[\s\S]{0,100}?TO authenticated/,
    "ต้อง GRANT EXECUTE ให้ authenticated");
  // schema reload
  assert.match(src, /NOTIFY pgrst, 'reload schema'/, "ต้อง NOTIFY pgrst reload");
});
