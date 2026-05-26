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
