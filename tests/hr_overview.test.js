// Phase 92.28 — Unit tests for modules/hr_overview.js pure helpers
// Covers: classifyAttendanceStatus, aggregateHrKpi, detectExceptions, indexAttendanceByUser
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  classifyAttendanceStatus,
  aggregateHrKpi,
  detectExceptions,
  indexAttendanceByUser,
} = await import("../modules/hr_overview.js");

// ── classifyAttendanceStatus ────────────────────────────────

test("classifyAttendanceStatus — null/undefined row → 'not_in'", () => {
  assert.equal(classifyAttendanceStatus(null), "not_in");
  assert.equal(classifyAttendanceStatus(undefined), "not_in");
});

test("classifyAttendanceStatus — row ที่มี clock_in + clock_out → 'out'", () => {
  const row = {
    clock_in_at:  "2026-05-24T01:00:00Z", // 08:00 BKK
    clock_out_at: "2026-05-24T10:00:00Z", // 17:00 BKK
  };
  assert.equal(classifyAttendanceStatus(row), "out");
});

test("classifyAttendanceStatus — เพิ่งเข้า ยังไม่ออก ไม่เกิน 14 ชม → 'working'", () => {
  const now = "2026-05-24T05:00:00Z"; // 12:00 BKK
  const row = {
    clock_in_at: "2026-05-24T01:00:00Z", // 08:00 BKK (4 ชม. ที่แล้ว)
    clock_out_at: null,
  };
  assert.equal(classifyAttendanceStatus(row, { now }), "working");
});

test("classifyAttendanceStatus — open session เกิน 14 ชม → 'abnormal' (ลืม clock-out)", () => {
  const now = "2026-05-25T00:00:00Z"; // 07:00 BKK วันถัดไป
  const row = {
    clock_in_at: "2026-05-24T01:00:00Z", // 23 ชม. ที่แล้ว
    clock_out_at: null,
  };
  assert.equal(classifyAttendanceStatus(row, { now }), "abnormal");
});

test("classifyAttendanceStatus — staleHours custom: 8 ชม.", () => {
  const now = "2026-05-24T12:00:00Z";
  const row = { clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: null }; // 11 ชม.
  assert.equal(classifyAttendanceStatus(row, { now, staleHours: 8 }), "abnormal");
  assert.equal(classifyAttendanceStatus(row, { now, staleHours: 14 }), "working");
});

test("classifyAttendanceStatus — row ที่มี clock_out แต่ไม่มี clock_in → 'abnormal'", () => {
  const row = { clock_in_at: null, clock_out_at: "2026-05-24T10:00:00Z" };
  assert.equal(classifyAttendanceStatus(row), "abnormal");
});

// ── aggregateHrKpi ──────────────────────────────────────────

test("aggregateHrKpi — input ว่าง → ทุก field เป็น 0", () => {
  const k = aggregateHrKpi({});
  assert.equal(k.totalStaff, 0);
  assert.equal(k.presentToday, 0);
  assert.equal(k.openSessions, 0);
  assert.equal(k.otHoursMonth, 0);
  assert.equal(k.payrollTotal, 0);
  assert.equal(k.payrollUnpaid, 0);
  assert.equal(k.payrollPaid, 0);
  assert.equal(k.payrollUnpaidAmount, 0);
  assert.equal(k.payrollPaidAmount, 0);
  assert.equal(k.offlinePending, 0);
});

test("aggregateHrKpi — presentToday นับ distinct user_id", () => {
  const k = aggregateHrKpi({
    profiles: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
    attendanceToday: [
      { user_id: "u1", clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: "2026-05-24T10:00:00Z" },
      { user_id: "u1", clock_in_at: "2026-05-24T03:00:00Z", clock_out_at: null }, // u1 มี 2 row → distinct = 1
      { user_id: "u2", clock_in_at: "2026-05-24T02:00:00Z", clock_out_at: null },
    ],
  });
  assert.equal(k.totalStaff, 3);
  assert.equal(k.presentToday, 2);          // u1 + u2
  assert.equal(k.openSessions, 2);          // u1 row 2 + u2 row
});

test("aggregateHrKpi — OT เดือนคำนวณจาก closed sessions เท่านั้น (ใช้ default shift 08-17)", () => {
  // 1 row: 08:00–19:00 BKK = regular 9 + ot 2
  const k = aggregateHrKpi({
    profiles: [{ id: "u1" }],
    attendanceToday: [],
    attendanceMonth: [
      {
        user_id: "u1",
        work_date: "2026-05-24",
        clock_in_at:  "2026-05-24T01:00:00+07:00",   // 01:00 BKK (OT)
        clock_out_at: "2026-05-24T19:00:00+07:00",   // 19:00 BKK
      },
      // open session ต้องถูก skip
      { user_id: "u1", work_date: "2026-05-25", clock_in_at: "2026-05-25T01:00:00+07:00", clock_out_at: null },
    ],
  });
  // 01-08 = 7 OT + 17-19 = 2 OT = 9 OT
  assert.equal(k.otHoursMonth, 9);
});

test("aggregateHrKpi — payroll counts + amounts split paid/unpaid", () => {
  const k = aggregateHrKpi({
    payrollsThisMonth: [
      { paid_at: "2026-05-25", total_amount: 15000 },
      { paid_at: null,         total_amount: 12000 },
      { paid_at: null,         total_amount:  8000 },
    ],
  });
  assert.equal(k.payrollTotal, 3);
  assert.equal(k.payrollPaid, 1);
  assert.equal(k.payrollUnpaid, 2);
  assert.equal(k.payrollPaidAmount, 15000);
  assert.equal(k.payrollUnpaidAmount, 20000);
});

test("aggregateHrKpi — offlinePending pass-through", () => {
  const k = aggregateHrKpi({ offlinePending: 5 });
  assert.equal(k.offlinePending, 5);
  // negative/NaN/string → fallback 0
  assert.equal(aggregateHrKpi({ offlinePending: "abc" }).offlinePending, 0);
});

// ── detectExceptions ────────────────────────────────────────

test("detectExceptions — input ว่าง → []", () => {
  assert.deepEqual(detectExceptions({}), []);
});

test("detectExceptions — open session เกิน staleHours → stale_session (severity high)", () => {
  const now = "2026-05-25T00:00:00Z";
  const exs = detectExceptions({
    attendanceToday: [
      { id: 1, user_id: "u1", clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: null }, // 23 ชม.
      { id: 2, user_id: "u2", clock_in_at: "2026-05-24T22:00:00Z", clock_out_at: null }, // 2 ชม.
    ],
    opts: { now, staleHours: 14 },
  });
  const stale = exs.filter(e => e.kind === "stale_session");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].userId, "u1");
  assert.equal(stale[0].refId, 1);
  assert.equal(stale[0].severity, "high");
});

test("detectExceptions — geofence violations (in + out)", () => {
  const exs = detectExceptions({
    attendanceToday: [
      { id: 10, user_id: "u1", clock_in_at: "x", clock_out_at: "y", clock_in_distance_m: 500 },
      { id: 11, user_id: "u2", clock_in_at: "x", clock_out_at: "y", clock_out_distance_m: 320 },
      { id: 12, user_id: "u3", clock_in_at: "x", clock_out_at: "y", clock_in_distance_m: 100 }, // ใน radius
    ],
    geofence: { radiusM: 200 },
  });
  const geo = exs.filter(e => e.kind === "geofence_out");
  assert.equal(geo.length, 2);
  assert.equal(geo[0].userId, "u1");
  assert.equal(geo[1].userId, "u2");
});

test("detectExceptions — ไม่ตั้ง geofence (null) → ข้าม geofence_out", () => {
  const exs = detectExceptions({
    attendanceToday: [
      { id: 10, user_id: "u1", clock_in_at: "x", clock_in_distance_m: 5000 },
    ],
    geofence: null,
  });
  assert.equal(exs.filter(e => e.kind === "geofence_out").length, 0);
});

test("detectExceptions — unpaid payroll → 1 alert ที่มี count", () => {
  const exs = detectExceptions({
    payrollsThisMonth: [
      { paid_at: null },
      { paid_at: null },
      { paid_at: "2026-05-25" },
    ],
  });
  const up = exs.filter(e => e.kind === "unpaid_payroll");
  assert.equal(up.length, 1);
  assert.match(up[0].message, /2 รายการ/);
});

test("detectExceptions — offline_pending → low severity", () => {
  const exs = detectExceptions({ offlinePending: 3 });
  const op = exs.filter(e => e.kind === "offline_pending");
  assert.equal(op.length, 1);
  assert.equal(op[0].severity, "low");
});

test("detectExceptions — รวมหลาย issue เรียงตามที่ตรวจ (stale → geofence → payroll → offline)", () => {
  const now = "2026-05-25T00:00:00Z";
  const exs = detectExceptions({
    attendanceToday: [
      { id: 1, user_id: "u1", clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: null, clock_in_distance_m: 800 },
    ],
    payrollsThisMonth: [{ paid_at: null }],
    offlinePending: 2,
    geofence: { radiusM: 200 },
    opts: { now, staleHours: 14 },
  });
  const kinds = exs.map(e => e.kind);
  assert.deepEqual(kinds, ["stale_session", "geofence_out", "unpaid_payroll", "offline_pending"]);
});

// ── indexAttendanceByUser ──────────────────────────────────

test("indexAttendanceByUser — เลือก open session ก่อน closed", () => {
  const idx = indexAttendanceByUser([
    { user_id: "u1", clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: "2026-05-24T10:00:00Z" }, // closed
    { user_id: "u1", clock_in_at: "2026-05-24T11:00:00Z", clock_out_at: null },                    // open
  ]);
  const r = idx.get("u1");
  assert.equal(r.clock_out_at, null);
});

test("indexAttendanceByUser — ทั้งสอง closed → เลือก clock_in_at ใหม่สุด", () => {
  const idx = indexAttendanceByUser([
    { user_id: "u1", clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: "2026-05-24T05:00:00Z" },
    { user_id: "u1", clock_in_at: "2026-05-24T08:00:00Z", clock_out_at: "2026-05-24T12:00:00Z" },
  ]);
  assert.equal(idx.get("u1").clock_in_at, "2026-05-24T08:00:00Z");
});

test("indexAttendanceByUser — skip row ที่ไม่มี user_id", () => {
  const idx = indexAttendanceByUser([
    { user_id: null, clock_in_at: "x" },
    { user_id: "u1", clock_in_at: "y" },
  ]);
  assert.equal(idx.size, 1);
  assert.ok(idx.has("u1"));
});

test("indexAttendanceByUser — input ที่ไม่ใช่ array → Map ว่าง", () => {
  assert.equal(indexAttendanceByUser(null).size, 0);
  assert.equal(indexAttendanceByUser(undefined).size, 0);
  assert.equal(indexAttendanceByUser({}).size, 0);
});
