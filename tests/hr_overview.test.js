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
  countStatusBuckets,
  filterRowsByStatus,
  rowActionLabel,
  roleChipMeta,
  alertActionFor,
  // Phase 92.30
  formatDistanceLabel,
  groupAttendanceLast7Days,
  employeePayrollSummary,
  buildEmployeeModalSummary,
  modalTabFor,
  // Phase 92.31
  filterHrRows,
  countDepartmentBuckets,
  countRoleBuckets,
  isDefaultHrFilters,
  filterSummaryLabel,
  buildHrExportFilename,
  buildHrDashboardMetrics,
  // Phase 92.53
  buildMonthlyHrReport,
  // Phase 92.41
  kpiClickRouteFor,
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

// ── Phase 92.29: countStatusBuckets ────────────────────────

test("countStatusBuckets — input ว่าง → ทุกค่าเป็น 0", () => {
  const b = countStatusBuckets([]);
  assert.deepEqual(b, { all: 0, not_in: 0, working: 0, out: 0, abnormal: 0 });
});

test("countStatusBuckets — input ที่ไม่ใช่ array → ทุกค่าเป็น 0", () => {
  assert.deepEqual(countStatusBuckets(null), { all: 0, not_in: 0, working: 0, out: 0, abnormal: 0 });
  assert.deepEqual(countStatusBuckets(undefined), { all: 0, not_in: 0, working: 0, out: 0, abnormal: 0 });
});

test("countStatusBuckets — mixed statuses นับถูกต้อง", () => {
  const b = countStatusBuckets([
    { status: "working" }, { status: "working" }, { status: "working" },
    { status: "out" }, { status: "out" },
    { status: "not_in" },
    { status: "abnormal" },
  ]);
  assert.equal(b.all, 7);
  assert.equal(b.working, 3);
  assert.equal(b.out, 2);
  assert.equal(b.not_in, 1);
  assert.equal(b.abnormal, 1);
});

test("countStatusBuckets — status แปลก ๆ ไม่นับเข้า bucket แต่นับ all", () => {
  const b = countStatusBuckets([
    { status: "weird" }, { status: null }, { status: "working" },
  ]);
  assert.equal(b.all, 3);
  assert.equal(b.working, 1);
  assert.equal(b.not_in, 0);
});

// ── Phase 92.29: filterRowsByStatus ─────────────────────────

test("filterRowsByStatus — 'all' หรือว่าง → คืน rows ทั้งหมด (copy)", () => {
  const rows = [{ status: "working" }, { status: "out" }];
  const a = filterRowsByStatus(rows, "all");
  assert.equal(a.length, 2);
  assert.notStrictEqual(a, rows); // คนละ array (slice)
  assert.equal(filterRowsByStatus(rows, "").length, 2);
  assert.equal(filterRowsByStatus(rows, undefined).length, 2);
});

test("filterRowsByStatus — filter status ถูกต้อง", () => {
  const rows = [
    { id: 1, status: "working" },
    { id: 2, status: "out" },
    { id: 3, status: "working" },
    { id: 4, status: "abnormal" },
  ];
  const w = filterRowsByStatus(rows, "working");
  assert.equal(w.length, 2);
  assert.deepEqual(w.map(r => r.id), [1, 3]);
});

test("filterRowsByStatus — status ไม่รู้จัก → คืนทั้งหมด (graceful)", () => {
  const rows = [{ status: "working" }, { status: "out" }];
  const r = filterRowsByStatus(rows, "unknown_status");
  assert.equal(r.length, 2);
});

test("filterRowsByStatus — input ที่ไม่ใช่ array → []", () => {
  assert.deepEqual(filterRowsByStatus(null, "all"), []);
  assert.deepEqual(filterRowsByStatus(undefined, "working"), []);
});

// ── Phase 92.29: rowActionLabel ─────────────────────────────

test("rowActionLabel — not_in → 'ลงเวลา'", () => {
  const a = rowActionLabel("not_in");
  assert.equal(a.label, "ลงเวลา");
  assert.equal(typeof a.icon, "string");
  assert.equal(typeof a.color, "string");
});

test("rowActionLabel — working/abnormal → 'จัดการเวลา'", () => {
  assert.equal(rowActionLabel("working").label, "จัดการเวลา");
  assert.equal(rowActionLabel("abnormal").label, "จัดการเวลา");
});

test("rowActionLabel — out → 'ดูเวลา'", () => {
  assert.equal(rowActionLabel("out").label, "ดูเวลา");
});

test("rowActionLabel — unknown / null → 'ดูเวลา' (fallback safe)", () => {
  assert.equal(rowActionLabel("unknown").label, "ดูเวลา");
  assert.equal(rowActionLabel(null).label, "ดูเวลา");
  assert.equal(rowActionLabel(undefined).label, "ดูเวลา");
});

// ── Phase 92.29: roleChipMeta ───────────────────────────────

test("roleChipMeta — admin/sales/technician/customer มี label TH", () => {
  assert.equal(roleChipMeta("admin").label, "ผู้ดูแลระบบ");
  assert.equal(roleChipMeta("sales").label, "พนักงานขาย");
  assert.equal(roleChipMeta("technician").label, "ช่าง");
  assert.equal(roleChipMeta("customer").label, "ลูกค้า");
});

test("roleChipMeta — admin/sales/technician มีสีต่างกัน (visual distinction)", () => {
  const a = roleChipMeta("admin").bg;
  const s = roleChipMeta("sales").bg;
  const t = roleChipMeta("technician").bg;
  assert.notEqual(a, s);
  assert.notEqual(s, t);
  assert.notEqual(a, t);
});

test("roleChipMeta — role แปลก → fallback มี bg/fg/border (ไม่ crash) + label = role string", () => {
  const m = roleChipMeta("manager");
  assert.equal(m.label, "manager");
  assert.ok(m.bg && m.fg && m.border);
});

test("roleChipMeta — null/undefined role → label '—'", () => {
  assert.equal(roleChipMeta(null).label, "—");
  assert.equal(roleChipMeta(undefined).label, "—");
});

// ── Phase 92.29: alertActionFor ─────────────────────────────

test("alertActionFor — stale_session → time_clock", () => {
  const a = alertActionFor("stale_session");
  assert.equal(a.route, "time_clock");
  assert.match(a.label, /Time Clock/);
});

test("alertActionFor — geofence_out → time_clock", () => {
  assert.equal(alertActionFor("geofence_out").route, "time_clock");
});

test("alertActionFor — unpaid_payroll → payroll", () => {
  assert.equal(alertActionFor("unpaid_payroll").route, "payroll");
});

test("alertActionFor — offline_pending → time_clock (sync)", () => {
  assert.equal(alertActionFor("offline_pending").route, "time_clock");
});

test("alertActionFor — kind ที่ไม่รู้จัก → null (safe — render ไม่ใส่ปุ่ม)", () => {
  assert.equal(alertActionFor("unknown_kind"), null);
  assert.equal(alertActionFor(null), null);
});

// Phase 92.32: pending_leaves integration
test("alertActionFor — pending_leaves → leave_management route", () => {
  const a = alertActionFor("pending_leaves");
  assert.equal(a.route, "leave_management");
  assert.match(a.label, /อนุมัติ/);
});

test("detectExceptions — pendingLeaves > 0 → pending_leaves alert (medium)", () => {
  const exs = detectExceptions({ pendingLeaves: 3 });
  const pl = exs.filter(e => e.kind === "pending_leaves");
  assert.equal(pl.length, 1);
  assert.equal(pl[0].severity, "medium");
  assert.match(pl[0].message, /3 รายการ/);
});

test("detectExceptions — pendingLeaves 0/undefined → ไม่มี alert (graceful)", () => {
  assert.equal(detectExceptions({}).filter(e => e.kind === "pending_leaves").length, 0);
  assert.equal(detectExceptions({ pendingLeaves: 0 }).filter(e => e.kind === "pending_leaves").length, 0);
});

// ── Phase 92.30: formatDistanceLabel ────────────────────────

test("formatDistanceLabel — null/undefined/empty → '—'", () => {
  assert.equal(formatDistanceLabel(null), "—");
  assert.equal(formatDistanceLabel(undefined), "—");
  assert.equal(formatDistanceLabel(""), "—");
  assert.equal(formatDistanceLabel("abc"), "—");
});

test("formatDistanceLabel — ไม่มี radius → แค่ระยะ ม.", () => {
  assert.equal(formatDistanceLabel(123), "123 ม.");
  assert.equal(formatDistanceLabel(123.7), "124 ม."); // round
});

test("formatDistanceLabel — มี radius และ ใน/นอกพื้นที่", () => {
  assert.equal(formatDistanceLabel(150, 200), "150 ม. (ในพื้นที่)");
  assert.equal(formatDistanceLabel(350, 200), "350 ม. (นอกพื้นที่)");
  assert.equal(formatDistanceLabel(200, 200), "200 ม. (ในพื้นที่)"); // = radius = ใน
});

test("formatDistanceLabel — radius invalid → ละเลย radius", () => {
  assert.equal(formatDistanceLabel(150, 0), "150 ม.");
  assert.equal(formatDistanceLabel(150, -5), "150 ม.");
  assert.equal(formatDistanceLabel(150, NaN), "150 ม.");
});

// ── Phase 92.30: groupAttendanceLast7Days ───────────────────

test("groupAttendanceLast7Days — todayDate ว่าง/ผิด → []", () => {
  assert.deepEqual(groupAttendanceLast7Days([], ""), []);
  assert.deepEqual(groupAttendanceLast7Days([], null), []);
  assert.deepEqual(groupAttendanceLast7Days([], "not-a-date"), []);
});

test("groupAttendanceLast7Days — คืน 7 entries เสมอ เรียงใหม่→เก่า", () => {
  const out = groupAttendanceLast7Days([], "2026-05-26");
  assert.equal(out.length, 7);
  assert.equal(out[0].date, "2026-05-26");
  assert.equal(out[6].date, "2026-05-20");
  for (const day of out) assert.deepEqual(day.attendance, []);
});

test("groupAttendanceLast7Days — group rows ตาม work_date ถูกต้อง", () => {
  const rows = [
    { id: 1, work_date: "2026-05-26", clock_in_at: "x" },
    { id: 2, work_date: "2026-05-26", clock_in_at: "y" },
    { id: 3, work_date: "2026-05-24", clock_in_at: "z" },
    { id: 4, work_date: "2026-05-19", clock_in_at: "old" }, // outside 7-day window
  ];
  const out = groupAttendanceLast7Days(rows, "2026-05-26");
  assert.equal(out[0].attendance.length, 2);
  assert.equal(out[2].date, "2026-05-24");
  assert.equal(out[2].attendance.length, 1);
  assert.equal(out[1].attendance.length, 0);
  // row id 4 (2026-05-19) อยู่นอก 7-day window (out[6] = 2026-05-20) → ไม่ปรากฏใน output
  const allDates = out.map(o => o.date);
  assert.ok(!allDates.includes("2026-05-19"));
});

test("groupAttendanceLast7Days — รับ input ที่ไม่ใช่ array สำหรับ rows → 7 entries ว่าง", () => {
  const out = groupAttendanceLast7Days(null, "2026-05-26");
  assert.equal(out.length, 7);
  for (const day of out) assert.deepEqual(day.attendance, []);
});

// ── Phase 92.30: employeePayrollSummary ─────────────────────

test("employeePayrollSummary — input ว่าง / profile ไม่มี id → null", () => {
  assert.equal(employeePayrollSummary([], null), null);
  assert.equal(employeePayrollSummary(null, { id: "u1" }), null);
  assert.equal(employeePayrollSummary([], {}), null);
});

test("employeePayrollSummary — ไม่พบ employee_id ตรง → null", () => {
  const payrolls = [{ employee_id: "u2", base_salary: 10000 }];
  assert.equal(employeePayrollSummary(payrolls, { id: "u1" }), null);
});

test("employeePayrollSummary — รวม base+ot+welfare+bonus+commission-deductions ถ้า total_amount หาย", () => {
  const payrolls = [{
    id: 5, employee_id: "u1", period_month: "2026-05-01",
    base_salary: 20000, overtime: 1500, welfare: 500, bonus: 1000, commission: 800, deductions: 300,
  }];
  const s = employeePayrollSummary(payrolls, { id: "u1" });
  assert.equal(s.total_amount, 23500); // 20000+1500+500+1000+800-300
  assert.equal(s.paid_at, null);
});

test("employeePayrollSummary — ใช้ total_amount จาก DB ถ้ามี (ไม่คำนวณซ้ำ)", () => {
  const payrolls = [{
    id: 6, employee_id: "u1", base_salary: 20000, total_amount: 99999, paid_at: "2026-05-25T03:00:00Z",
  }];
  const s = employeePayrollSummary(payrolls, { id: "u1" });
  assert.equal(s.total_amount, 99999);
  assert.equal(s.paid_at, "2026-05-25T03:00:00Z");
});

test("employeePayrollSummary — string vs uuid compare (defensive cast)", () => {
  const payrolls = [{ employee_id: 7, base_salary: 1 }];
  const s = employeePayrollSummary(payrolls, { id: "7" });
  assert.ok(s);
  assert.equal(s.base_salary, 1);
});

// ── Phase 92.30: buildEmployeeModalSummary ──────────────────

test("buildEmployeeModalSummary — รวม profile + att + ot ถูกต้อง", () => {
  const s = buildEmployeeModalSummary({
    profile: { id: "u1", full_name: "นภดล", email: "n@x.com", role: "sales" },
    todayAtt: { clock_in_at: "2026-05-26T01:00:00Z", clock_out_at: null, clock_in_distance_m: 120, notes: "มาสาย" },
    todayOt: { regular: 4.5, ot: 1.2, total: 5.7 },
    status: "working",
    dept: { name: "ขาย" },
    radiusM: 200,
  });
  assert.equal(s.userId, "u1");
  assert.equal(s.name, "นภดล");
  assert.equal(s.email, "n@x.com");
  assert.equal(s.role, "sales");
  assert.equal(s.department, "ขาย");
  assert.equal(s.status, "working");
  assert.equal(s.regularHours, 4.5);
  assert.equal(s.otHours, 1.2);
  assert.equal(s.clockInDistance, 120);
  assert.equal(s.radiusM, 200);
  assert.equal(s.notes, "มาสาย");
});

test("buildEmployeeModalSummary — input ว่างทั้งหมด → fallback ค่า default", () => {
  const s = buildEmployeeModalSummary({});
  assert.equal(s.userId, null);
  assert.equal(s.department, "—");
  assert.equal(s.status, "not_in");
  assert.equal(s.regularHours, 0);
  assert.equal(s.otHours, 0);
  assert.equal(s.clockInAt, null);
  assert.equal(s.radiusM, null);
});

test("buildEmployeeModalSummary — fallback display name ถ้าไม่มี full_name", () => {
  const s = buildEmployeeModalSummary({ profile: { id: "u2", email: "abc@x.com" } });
  assert.equal(s.name, "abc"); // profileDisplayName fallback to email prefix
});

// ── Phase 92.30: modalTabFor ────────────────────────────────

test("modalTabFor — valid key → คืน key เดิม", () => {
  assert.equal(modalTabFor("today"), "today");
  assert.equal(modalTabFor("week"), "week");
  assert.equal(modalTabFor("payroll"), "payroll");
});

test("modalTabFor — invalid key → fallback (default 'today')", () => {
  assert.equal(modalTabFor("invalid"), "today");
  assert.equal(modalTabFor(null), "today");
  assert.equal(modalTabFor(""), "today");
  assert.equal(modalTabFor(123), "today");
});

test("modalTabFor — custom validKeys + fallback", () => {
  assert.equal(modalTabFor("payroll", ["today", "week"]), "today"); // payroll ไม่อยู่ในรายการ
  assert.equal(modalTabFor("week", ["today", "week"]), "week");
  assert.equal(modalTabFor("bad", ["today", "week"], "week"), "week");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.31 — Department/Role filter helpers
// ═══════════════════════════════════════════════════════════

const SAMPLE_ROWS = [
  { status: "working",  profile: { id: "u1", role: "admin",      department_id: 1    } },
  { status: "out",      profile: { id: "u2", role: "sales",      department_id: 2    } },
  { status: "working",  profile: { id: "u3", role: "technician", department_id: 2    } },
  { status: "not_in",   profile: { id: "u4", role: "technician", department_id: null } }, // unassigned
  { status: "abnormal", profile: { id: "u5", role: "manager",    department_id: 1    } }, // other role
];

// ── filterHrRows ──────────────────────────────────────────

test("filterHrRows — default filters → คืน rows ทั้งหมด", () => {
  assert.equal(filterHrRows(SAMPLE_ROWS, {}).length, 5);
  assert.equal(filterHrRows(SAMPLE_ROWS, { status: "all", departmentId: "__all__", role: "all" }).length, 5);
});

test("filterHrRows — status + dept + role combined", () => {
  // dept=2, role=technician, status=working → u3 only
  const out = filterHrRows(SAMPLE_ROWS, { status: "working", departmentId: "2", role: "technician" });
  assert.equal(out.length, 1);
  assert.equal(out[0].profile.id, "u3");
});

test("filterHrRows — department '__none__' = unassigned only", () => {
  const out = filterHrRows(SAMPLE_ROWS, { departmentId: "__none__" });
  assert.equal(out.length, 1);
  assert.equal(out[0].profile.id, "u4");
});

test("filterHrRows — role 'other' = ไม่ใช่ admin/sales/technician", () => {
  const out = filterHrRows(SAMPLE_ROWS, { role: "other" });
  assert.equal(out.length, 1);
  assert.equal(out[0].profile.id, "u5"); // role="manager"
});

test("filterHrRows — dept id string vs number safe compare", () => {
  // department_id เป็น number 1 — filter ด้วย string "1" ต้องเจอ
  const out = filterHrRows(SAMPLE_ROWS, { departmentId: "1" });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.profile.id).sort(), ["u1", "u5"]);
});

test("filterHrRows — empty result เมื่อ filter ไม่มี match", () => {
  const out = filterHrRows(SAMPLE_ROWS, { departmentId: "999" });
  assert.equal(out.length, 0);
});

test("filterHrRows — non-array → []", () => {
  assert.deepEqual(filterHrRows(null, { status: "all" }), []);
  assert.deepEqual(filterHrRows(undefined, {}), []);
});

// ── countDepartmentBuckets ────────────────────────────────

test("countDepartmentBuckets — รวม __none__ และ dept keys", () => {
  const m = countDepartmentBuckets(SAMPLE_ROWS);
  assert.equal(m.get("__none__"), 1); // u4
  assert.equal(m.get("1"), 2);        // u1, u5
  assert.equal(m.get("2"), 2);        // u2, u3
});

test("countDepartmentBuckets — empty / non-array → มี __none__:0 เท่านั้น", () => {
  const m = countDepartmentBuckets([]);
  assert.equal(m.get("__none__"), 0);
  assert.equal(m.size, 1);
  assert.equal(countDepartmentBuckets(null).get("__none__"), 0);
});

test("countDepartmentBuckets — department_id เป็นค่า falsey (null/empty string) → __none__", () => {
  const rows = [
    { profile: { department_id: null } },
    { profile: { department_id: "" } },
    { profile: { department_id: undefined } },
  ];
  assert.equal(countDepartmentBuckets(rows).get("__none__"), 3);
});

// ── countRoleBuckets ──────────────────────────────────────

test("countRoleBuckets — แยก known + other", () => {
  const r = countRoleBuckets(SAMPLE_ROWS);
  assert.equal(r.all, 5);
  assert.equal(r.admin, 1);
  assert.equal(r.sales, 1);
  assert.equal(r.technician, 2);
  assert.equal(r.other, 1); // u5
});

test("countRoleBuckets — empty / non-array", () => {
  assert.deepEqual(countRoleBuckets([]),    { all: 0, admin: 0, sales: 0, technician: 0, other: 0 });
  assert.deepEqual(countRoleBuckets(null),  { all: 0, admin: 0, sales: 0, technician: 0, other: 0 });
});

test("countRoleBuckets — role เป็น null/empty → other", () => {
  const r = countRoleBuckets([{ profile: { role: null } }, { profile: { role: "" } }, { profile: {} }]);
  assert.equal(r.other, 3);
});

// ── isDefaultHrFilters ────────────────────────────────────

test("isDefaultHrFilters — null/undefined → true", () => {
  assert.equal(isDefaultHrFilters(null), true);
  assert.equal(isDefaultHrFilters(undefined), true);
  assert.equal(isDefaultHrFilters({}), true);
});

test("isDefaultHrFilters — all defaults → true", () => {
  assert.equal(isDefaultHrFilters({ status: "all", departmentId: "__all__", role: "all" }), true);
});

test("isDefaultHrFilters — bất any non-default → false", () => {
  assert.equal(isDefaultHrFilters({ status: "working" }), false);
  assert.equal(isDefaultHrFilters({ departmentId: "5" }), false);
  assert.equal(isDefaultHrFilters({ role: "admin" }), false);
  assert.equal(isDefaultHrFilters({ departmentId: "__none__" }), false);
});

// ── filterSummaryLabel ────────────────────────────────────

test("filterSummaryLabel — default filters → แสดงเฉพาะ count", () => {
  const s = filterSummaryLabel({}, 10, 10, []);
  assert.equal(s, "แสดง 10 จาก 10 คน");
});

test("filterSummaryLabel — dept + role + status รวมเข้าด้วยกัน", () => {
  const depts = [{ id: 2, name: "ช่าง" }];
  const s = filterSummaryLabel(
    { status: "working", departmentId: "2", role: "technician" },
    5, 1, depts
  );
  assert.match(s, /แสดง 1 จาก 5 คน/);
  assert.match(s, /แผนก: ช่าง/);
  assert.match(s, /Role: Technician/);
  assert.match(s, /สถานะ: กำลังทำงาน/);
});

test("filterSummaryLabel — dept '__none__' → 'ไม่ระบุแผนก'", () => {
  const s = filterSummaryLabel({ departmentId: "__none__" }, 4, 1, []);
  assert.match(s, /แผนก: ไม่ระบุแผนก/);
});

test("filterSummaryLabel — dept id ไม่พบใน departments → fallback ใช้ id string", () => {
  const s = filterSummaryLabel({ departmentId: "99" }, 4, 0, [{ id: 2, name: "ช่าง" }]);
  assert.match(s, /แผนก: 99/);
});

// ── buildHrExportFilename ─────────────────────────────────

test("buildHrExportFilename — default filters → suffix 'all'", () => {
  assert.equal(buildHrExportFilename("2026-05-26", {}), "hr_overview_2026-05-26_all.xlsx");
});

test("buildHrExportFilename — รวม dept + role + status", () => {
  const fn = buildHrExportFilename("2026-05-26", { departmentId: "12", role: "technician", status: "working" });
  assert.equal(fn, "hr_overview_2026-05-26_dept-12_role-technician_working.xlsx");
});

test("buildHrExportFilename — dept '__none__' → 'dept-none'", () => {
  const fn = buildHrExportFilename("2026-05-26", { departmentId: "__none__" });
  assert.equal(fn, "hr_overview_2026-05-26_dept-none.xlsx");
});

test("buildHrExportFilename — sanitize ตัวอักษรอันตรายใน dept id", () => {
  // dept id ที่มี / \ : * ? " < > | → ถูกแทนด้วย _
  const fn = buildHrExportFilename("2026-05-26", { departmentId: "a/b\\c:d*e?f" });
  assert.ok(!/[\\/:*?"<>|]/.test(fn), "filename ต้องไม่มี path separators / illegal chars");
  assert.match(fn, /^hr_overview_2026-05-26_dept-/);
  assert.match(fn, /\.xlsx$/);
});

test("buildHrExportFilename — today ว่าง → fallback 'today'", () => {
  const fn = buildHrExportFilename("", { status: "working" });
  assert.match(fn, /^hr_overview_today_working\.xlsx$/);
});

test("buildHrExportFilename — sanitize control chars + collapse underscores", () => {
  const fn = buildHrExportFilename("2026-05-26", { departmentId: "x  \t y" });
  assert.ok(!/\s/.test(fn), "filename ต้องไม่มี whitespace");
  assert.ok(!/__/.test(fn), "filename ต้องไม่มี __ ซ้อน");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.41 — KPI click-through navigation
// ═══════════════════════════════════════════════════════════

test("kpiClickRouteFor — total_staff → departments", () => {
  assert.equal(kpiClickRouteFor("total_staff"), "departments");
});

test("kpiClickRouteFor — present_today + open_sessions + offline_pending → time_clock", () => {
  assert.equal(kpiClickRouteFor("present_today"), "time_clock");
  assert.equal(kpiClickRouteFor("open_sessions"), "time_clock");
  assert.equal(kpiClickRouteFor("offline_pending"), "time_clock");
});

test("kpiClickRouteFor — ot_month → payroll_overview", () => {
  assert.equal(kpiClickRouteFor("ot_month"), "payroll_overview");
});

test("kpiClickRouteFor — payroll → payroll (clickable แม้ paid=0/0)", () => {
  // Phase 92.41 decision: payroll card คลิกได้เสมอ — drill-down ไปจัดการที่หน้า payroll
  // ดีกว่า disable เงียบ ๆ ตอน 0/0
  assert.equal(kpiClickRouteFor("payroll"), "payroll");
});

test("kpiClickRouteFor — unknown kind → null", () => {
  assert.equal(kpiClickRouteFor("nonexistent"), null);
  assert.equal(kpiClickRouteFor(""), null);
  assert.equal(kpiClickRouteFor(undefined), null);
  assert.equal(kpiClickRouteFor(null), null);
});

test("kpiClickRouteFor + alertActionFor — ทุก kind คืน route ที่มีอยู่จริงในระบบ (sanity)", () => {
  const validRoutes = new Set([
    "time_clock", "payroll", "payroll_overview", "leave_management",
    "departments", "audit_log", "hr_overview", "settings",
  ]);
  for (const k of ["total_staff", "present_today", "open_sessions", "ot_month", "payroll", "offline_pending"]) {
    const r = kpiClickRouteFor(k);
    assert.ok(validRoutes.has(r), `kpi kind=${k} → route=${r} ต้องเป็น valid route`);
  }
  for (const k of ["stale_session", "geofence_out", "unpaid_payroll", "offline_pending", "pending_leaves"]) {
    const a = alertActionFor(k);
    assert.ok(a && validRoutes.has(a.route), `alert kind=${k} → route=${a?.route} ต้องเป็น valid route`);
  }
});

// ── Source-level wiring (Phase 92.41) ──────────────────────

test("source: KPI 5 ใบหลัก ทุกใบส่ง clickRoute ผ่าน kpiClickRouteFor", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  // ใน container.innerHTML ต้องเรียก kpiClickRouteFor สำหรับทั้ง 5 kinds
  for (const kind of ["total_staff", "present_today", "open_sessions", "ot_month", "payroll"]) {
    const re = new RegExp(`kpiClickRouteFor\\(["']${kind}["']\\)`);
    assert.match(src, re, `ต้องมี kpiClickRouteFor("${kind}") ใน KPI card`);
  }
  // offline_pending (conditional) — ก็ใช้ helper เหมือนกัน
  assert.match(src, /kpiClickRouteFor\(["']offline_pending["']\)/, "offline_pending KPI ต้องใช้ helper");
});

test("source: _kpiCard มี aria-label dynamic เมื่อ clickable + ไม่มี text ลอย 'คลิกเพื่อจัดการ →' แล้ว", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  const body = src.match(/function _kpiCard[\s\S]*?^}/m)?.[0] || "";
  assert.ok(body.length > 0, "ต้องเจอ _kpiCard");
  assert.match(body, /aria-label="\$\{escHtml\(/, "ต้องมี dynamic aria-label เมื่อ clickRoute มีค่า");
  assert.match(body, /role="button"/, "ต้องมี role=button");
  assert.match(body, /tabindex="0"/, "ต้องมี tabindex=0 (focusable)");
  // ห้ามมี text ลอย "คลิกเพื่อจัดการ →" แล้ว — ใช้ affordance + aria-label พอ
  assert.ok(!/คลิกเพื่อจัดการ\s*→/.test(body), "ห้ามมี text ลอย 'คลิกเพื่อจัดการ →' (UX: ใช้ affordance + aria แทน)");
});

test("source: container scope <style> มี .hr-kpi-card:hover + :focus-visible + .hr-row-employee:hover (affordance)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  // ใน container.innerHTML ต้องมี <style> รวม rules
  const m = src.match(/container\.innerHTML\s*=\s*`[\s\S]*?<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "ต้องมี <style> block ใน container.innerHTML");
  const css = m[1];
  assert.match(css, /\.hr-kpi-card:hover/, "ต้องมี .hr-kpi-card:hover rule");
  assert.match(css, /\.hr-kpi-card:focus-visible[\s\S]{0,200}?outline:/, "ต้องมี focus-visible outline");
  assert.match(css, /\.hr-row-employee:hover/, "row hover rule");
});

test("source: employee modal มีปุ่ม 'ไป Payroll' (data-hr-action=payroll) คู่กับ 'ไป Time Clock'", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  // modal footer — เป็นภาพรวมไม่ใช่ตำแหน่งเดียว ใช้ string match
  assert.match(src, /data-hr-action="time_clock"[\s\S]{0,400}?🕒/, "ปุ่ม time_clock ต้องยังอยู่ (regression guard)");
  assert.match(src, /class="hr-modal-route-btn"\s+data-hr-action="payroll"/, "ต้องเพิ่มปุ่ม payroll ใน modal");
});

test("source: row click delegation ยังกัน button targets (skip data-hr-action + skip button)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  // row click handler ใช้ closest("[data-hr-action]") + closest("button") เป็น early-return
  assert.match(src, /ev\.target\.closest\(["']\[data-hr-action\]["']\)/, "row click ต้อง skip data-hr-action target");
  assert.match(src, /ev\.target\.closest\(["']button["']\)/, "row click ต้อง skip button target");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.49 — detectExceptions late / early-leave counting
// ═══════════════════════════════════════════════════════════

const _SHIFT = { startHour: 8, endHour: 17 };
const _RULES = { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 };

function _att(userId, inHM, outHM) {
  const d = "2026-06-01";
  const mk = (hm) => hm == null ? null : `${d}T${hm}:00+07:00`;
  return { id: userId, user_id: userId, work_date: d, clock_in_at: mk(inHM), clock_out_at: mk(outHM) };
}

test("detectExceptions — ไม่ส่ง shiftOpts/rules → ไม่มี late/early (preserve behavior เดิม)", () => {
  const ex = detectExceptions({
    attendanceToday: [_att("u1", "08:40", "16:00")],
  });
  assert.equal(ex.some(e => e.kind === "late_arrivals"), false);
  assert.equal(ex.some(e => e.kind === "early_leaves"), false);
});

test("detectExceptions — นับ late ถูก (08:40 = สาย, 08:10 = ภายใน grace)", () => {
  const ex = detectExceptions({
    attendanceToday: [
      _att("u1", "08:40", "17:00"), // late
      _att("u2", "08:10", "17:00"), // on time (within grace)
      _att("u3", "08:00", "17:00"), // on time
    ],
    shiftOpts: _SHIFT,
    attendanceRules: _RULES,
  });
  const late = ex.find(e => e.kind === "late_arrivals");
  assert.ok(late, "ต้องมี late_arrivals");
  assert.match(late.message, /1 คน/);
});

test("detectExceptions — นับ early_leave ถูก (ออก 16:00 = ก่อนเวลา)", () => {
  const ex = detectExceptions({
    attendanceToday: [
      _att("u1", "08:00", "16:00"), // early leave
      _att("u2", "08:00", "16:50"), // within grace → ok
    ],
    shiftOpts: _SHIFT,
    attendanceRules: _RULES,
  });
  const early = ex.find(e => e.kind === "early_leaves");
  assert.ok(early, "ต้องมี early_leaves");
  assert.match(early.message, /1 คน/);
});

test("detectExceptions — late_and_early_leave นับทั้ง late และ early (คนเดียวกัน)", () => {
  const ex = detectExceptions({
    attendanceToday: [_att("u1", "08:40", "16:00")],
    shiftOpts: _SHIFT,
    attendanceRules: _RULES,
  });
  const late  = ex.find(e => e.kind === "late_arrivals");
  const early = ex.find(e => e.kind === "early_leaves");
  assert.match(late.message,  /1 คน/);
  assert.match(early.message, /1 คน/);
});

test("detectExceptions — missing clock_out ไม่นับ early_leave", () => {
  const ex = detectExceptions({
    attendanceToday: [_att("u1", "08:40", null)], // late, ยังไม่ออก
    shiftOpts: _SHIFT,
    attendanceRules: _RULES,
  });
  assert.ok(ex.find(e => e.kind === "late_arrivals"), "late ยังนับได้");
  assert.equal(ex.some(e => e.kind === "early_leaves"), false);
});

test("detectExceptions — ทุกคนตรงเวลา → ไม่มี late/early exception", () => {
  const ex = detectExceptions({
    attendanceToday: [_att("u1", "08:00", "17:00"), _att("u2", "08:05", "17:00")],
    shiftOpts: _SHIFT,
    attendanceRules: _RULES,
  });
  assert.equal(ex.some(e => e.kind === "late_arrivals"), false);
  assert.equal(ex.some(e => e.kind === "early_leaves"), false);
});

test("alertActionFor — late_arrivals / early_leaves → route time_clock", () => {
  assert.equal(alertActionFor("late_arrivals").route, "time_clock");
  assert.equal(alertActionFor("early_leaves").route, "time_clock");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.50 — executive HR dashboard metrics
// ═══════════════════════════════════════════════════════════

test("buildHrDashboardMetrics — รวม KPI / แผนก / role / punctuality จากข้อมูลจริง", () => {
  const metrics = buildHrDashboardMetrics({
    today: "2026-06-15",
    monthKey: "2026-06",
    departments: [{ id: 1, name: "ขาย" }, { id: 2, name: "ช่าง" }],
    profiles: [
      { id: "u1", full_name: "A", role: "sales", department_id: 1, hire_date: "2026-06-03", employment_type: "permanent" },
      { id: "u2", full_name: "B", role: "technician", department_id: 2, employment_type: "temporary" },
      { id: "u3", full_name: "C", role: "sales", department_id: 1, status: "resigned" },
    ],
    rows: [
      { profile: { id: "u1" }, status: "working", punc: { status: "late", lateMinutes: 25 } },
      { profile: { id: "u2" }, status: "out", punc: { status: "early_leave", earlyLeaveMinutes: 30 } },
    ],
    attendanceMonth: [
      { user_id: "u1", work_date: "2026-06-14", clock_in_at: "2026-06-14T08:00:00+07:00" },
      { user_id: "u2", work_date: "2026-06-14", clock_in_at: "2026-06-14T08:00:00+07:00" },
      { user_id: "u1", work_date: "2026-06-15", clock_in_at: "2026-06-15T08:00:00+07:00" },
    ],
    payrolls: [{ paid_at: "2026-06-15" }, { paid_at: null }],
    leaves: [{ leave_type: "sick", days_count: 2 }, { leave_type: "personal", days_count: 1 }],
    pendingLeaves: 4,
  });

  assert.equal(metrics.total, 3);
  assert.equal(metrics.active, 2);
  assert.equal(metrics.permanent, 1);
  assert.equal(metrics.temporary, 1);
  assert.equal(metrics.newThisMonth, 1);
  assert.equal(metrics.resigned, 1);
  assert.equal(metrics.punctuality.late, 1);
  assert.equal(metrics.punctuality.early, 1);
  assert.equal(metrics.departmentBreakdown[0].label, "ขาย");
  assert.equal(metrics.recentAttendance.at(-1).count, 1);
  assert.equal(metrics.leaveBreakdown[0].label, "sick");
  assert.equal(metrics.pendingLeaves, 4);
  assert.equal(metrics.payrollCoverage, 50);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.51 — monthly punctuality (top late) + dashboard wiring
// ═══════════════════════════════════════════════════════════

test("buildHrDashboardMetrics — monthlyPunctuality top late นับ + เรียงถูก (ส่ง shiftOpts+rules)", () => {
  const att = (uid, d, hm) => ({ user_id: uid, work_date: d, clock_in_at: `${d}T${hm}:00+07:00`, clock_out_at: `${d}T17:00:00+07:00` });
  const metrics = buildHrDashboardMetrics({
    today: "2026-06-15",
    monthKey: "2026-06",
    profiles: [{ id: "u1", full_name: "สาย ก." }, { id: "u2", full_name: "ตรง ข." }],
    rows: [],
    shiftOpts: { startHour: 8, endHour: 17 },
    attendanceRules: { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 },
    attendanceMonth: [
      att("u1", "2026-06-01", "08:40"), // late
      att("u1", "2026-06-02", "08:30"), // late
      att("u1", "2026-06-03", "09:00"), // late
      att("u2", "2026-06-01", "08:05"), // on time (within grace) → ไม่นับ
      att("u2", "2026-06-02", "08:50"), // late
    ],
  });
  const mp = metrics.monthlyPunctuality;
  assert.equal(mp.lateOccurrences, 4);
  assert.equal(mp.topLate[0].userId, "u1");      // สายมากสุด → อันดับ 1
  assert.equal(mp.topLate[0].lateCount, 3);
  assert.equal(mp.topLate[0].name, "สาย ก.");
  assert.equal(mp.frequentLateCount, 1);          // u1 สาย ≥3 ครั้ง
});

test("buildHrDashboardMetrics — ไม่ส่ง shiftOpts/rules → monthlyPunctuality ว่าง (preserve)", () => {
  const metrics = buildHrDashboardMetrics({
    today: "2026-06-15", monthKey: "2026-06",
    profiles: [{ id: "u1" }],
    attendanceMonth: [{ user_id: "u1", work_date: "2026-06-01", clock_in_at: "2026-06-01T09:00:00+07:00" }],
  });
  assert.equal(metrics.monthlyPunctuality.lateOccurrences, 0);
  assert.deepEqual(metrics.monthlyPunctuality.topLate, []);
});

// ── Source-level wiring (Phase 92.51) ──────────────────────

test("source: dashboard เรนเดอร์ panel 'พนักงานมาสายบ่อย' + _hrDashTopLate wired", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  assert.match(src, /function _hrDashTopLate/, "ต้องมี _hrDashTopLate helper");
  assert.match(src, /_hrDashTopLate\(metrics\.monthlyPunctuality\)/, "dashboard ต้องเรียก _hrDashTopLate");
  assert.match(src, /พนักงานมาสายบ่อย/, "ต้องมี panel title มาสายบ่อย");
});

test("source: buildHrDashboardMetrics ถูกส่ง shiftOpts + attendanceRules", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  const call = src.match(/buildHrDashboardMetrics\(\{[\s\S]*?\}\);/)?.[0] || "";
  assert.match(call, /shiftOpts/, "ต้องส่ง shiftOpts");
  assert.match(call, /attendanceRules:\s*punctRules/, "ต้องส่ง attendanceRules");
});

test("source: HR export มีคอลัมน์ punctuality (สถานะตรงเวลา/นาทีสาย/นาทีออกก่อน)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  assert.match(src, /"สถานะตรงเวลา":/, "export ต้องมีคอลัมน์ สถานะตรงเวลา");
  assert.match(src, /"นาทีสาย":/, "export ต้องมีคอลัมน์ นาทีสาย");
  assert.match(src, /"นาทีออกก่อน":/, "export ต้องมีคอลัมน์ นาทีออกก่อน");
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.53 — buildMonthlyHrReport (รายงาน HR รายเดือน รวมต่อพนักงาน)
// ═══════════════════════════════════════════════════════════

test("buildMonthlyHrReport — รวม วันทำงาน/ชม./OT/สาย/ออกก่อน/ลา ต่อคน + totals", () => {
  const SH = { startHour: 8, endHour: 17 };
  const RU = { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 };
  const att = (uid, d, inHM, outHM) => ({
    user_id: uid, work_date: d,
    clock_in_at: `${d}T${inHM}:00+07:00`,
    clock_out_at: outHM ? `${d}T${outHM}:00+07:00` : null,
  });
  const report = buildMonthlyHrReport({
    profiles: [
      { id: "u1", full_name: "สมชาย", role: "sales", department_id: 1 },
      { id: "u2", full_name: "สมหญิง", role: "technician", department_id: 2 },
    ],
    deptNameById: new Map([["1", "ขาย"], ["2", "ช่าง"]]),
    shiftOpts: SH,
    attendanceRules: RU,
    attendanceMonth: [
      att("u1", "2026-06-01", "08:00", "17:00"), // ตรงเวลา 9 ชม.
      att("u1", "2026-06-02", "09:00", "17:00"), // สาย 60 น. (regular 8 ชม.)
      att("u2", "2026-06-01", "08:00", "16:00"), // ออกก่อน 60 น.
    ],
    leaves: [
      { user_id: "u1", days_count: 1, status: "approved" },
      { user_id: "u2", days_count: 2, status: "pending" }, // ไม่นับ (ยังไม่อนุมัติ)
    ],
  });

  const u1 = report.rows.find(r => r.userId === "u1");
  const u2 = report.rows.find(r => r.userId === "u2");
  assert.equal(u1.daysWorked, 2);
  assert.equal(u1.regularHours, 17);     // 9 + 8
  assert.equal(u1.lateCount, 1);
  assert.equal(u1.lateMinutes, 60);
  assert.equal(u1.leaveDays, 1);
  assert.equal(u1.department, "ขาย");
  assert.equal(u2.earlyLeaveCount, 1);
  assert.equal(u2.earlyLeaveMinutes, 60);
  assert.equal(u2.leaveDays, 0);          // pending ไม่นับ
  // totals
  assert.equal(report.totals.employees, 2);
  assert.equal(report.totals.daysWorked, 3);
  assert.equal(report.totals.lateCount, 1);
  assert.equal(report.totals.earlyLeaveCount, 1);
  assert.equal(report.totals.leaveDays, 1);
});

test("buildMonthlyHrReport — ไม่มีพนักงาน → rows ว่าง + totals ศูนย์", () => {
  const r = buildMonthlyHrReport({ profiles: [], attendanceMonth: [], leaves: [] });
  assert.deepEqual(r.rows, []);
  assert.equal(r.totals.employees, 0);
  assert.equal(r.totals.daysWorked, 0);
});

test("buildMonthlyHrReport — พนักงานไม่มี attendance → ค่าเป็น 0 (ไม่ crash)", () => {
  const r = buildMonthlyHrReport({
    profiles: [{ id: "u9", full_name: "ว่าง", role: "sales" }],
    attendanceMonth: [],
    leaves: [],
    shiftOpts: { startHour: 8, endHour: 17 },
    attendanceRules: { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 },
  });
  assert.equal(r.rows[0].daysWorked, 0);
  assert.equal(r.rows[0].regularHours, 0);
  assert.equal(r.rows[0].lateCount, 0);
  assert.equal(r.rows[0].department, "—");
});

test("source: HR Overview render report section + date-range controls + rebind (Phase 92.54)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  // section container + render call ด้วย {from,to}
  assert.match(src, /id="hrReportSection"/, "ต้องมี section container");
  assert.match(src, /_renderMonthlyHrReport\(monthlyReport, \{ from: reportFrom, to: reportTo \}\)/, "ต้อง render ด้วย from/to");
  // date-range inputs + ปุ่ม
  assert.match(src, /id="hrReportFrom"/, "ต้องมี input จาก");
  assert.match(src, /id="hrReportTo"/, "ต้องมี input ถึง");
  assert.match(src, /id="hrReportSearchBtn"/, "ต้องมีปุ่มค้นหา");
  assert.match(src, /id="hrReportExportBtn"/, "ต้องมีปุ่ม export");
  // re-fetch + re-build + re-render + re-bind
  assert.match(src, /_fetchReportRange\(reportFrom, reportTo\)/, "ต้อง re-fetch ตามช่วง");
  assert.match(src, /function _renderReportSection/, "ต้องมี re-render section");
  assert.match(src, /function _bindReport/, "ต้อง rebind events หลัง re-render");
  // export filename = ช่วงวันที่
  assert.match(src, /hr_report_\$\{reportFrom\}_\$\{reportTo\}\.xlsx/, "filename = ช่วงวันที่");
});

test("source: _fetchReportRange ดึง attendance+leaves ตามช่วง (graceful leaves)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/hr_overview.js"), "utf8");
  const fn = src.match(/async function _fetchReportRange[\s\S]*?\n}/)?.[0] || "";
  assert.match(fn, /staff_attendance\?select=\*&work_date=gte\./, "fetch attendance ตามช่วง");
  assert.match(fn, /staff_leaves\?select=\*&start_date=gte\./, "fetch leaves ตามช่วง");
  assert.match(fn, /leaveRes\.ok \? await leaveRes\.json\(\) : \[\]/, "leaves graceful (ตารางไม่มีก็ไม่ crash)");
});
