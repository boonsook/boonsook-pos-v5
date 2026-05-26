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
