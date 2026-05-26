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
