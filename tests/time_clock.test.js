// Phase 92.22 + 92.22e — Unit tests for modules/time_clock.js pure helpers
// Covers: workDateBangkok (TZ correctness), timeBangkok, workHours,
//         clockState, sumWorkHours, profileDisplayName (fallback chain)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  workDateBangkok,
  timeBangkok,
  workHours,
  clockState,
  sumWorkHours,
  profileDisplayName,
  computeRegularOT,
  sumRegularOT,
  shiftHoursFromState,
  haversineMeters,
  geofenceFromState,
  // Phase 92.49: attendance punctuality
  classifyPunctuality,
  attendanceRulesFromState,
  punctualityChipMeta,
} = await import("../modules/time_clock.js");

// Helper: สร้าง row จาก Bangkok local hours (เลข int)
// e.g. row("2026-05-24", 8, 17) → clock_in 08:00 BKK, clock_out 17:00 BKK
function row(workDate, inH, outH) {
  const pad = (h) => String(h).padStart(2, "0");
  return {
    work_date: workDate,
    clock_in_at:  `${workDate}T${pad(inH)}:00:00+07:00`,
    clock_out_at: `${workDate}T${pad(outH)}:00:00+07:00`,
  };
}

// ── workDateBangkok ─────────────────────────────────────────

test("workDateBangkok — returns YYYY-MM-DD format for a given date", () => {
  // 2026-05-24 10:00 UTC = 2026-05-24 17:00 Bangkok (still same date)
  const d = new Date("2026-05-24T10:00:00Z");
  assert.equal(workDateBangkok(d), "2026-05-24");
});

test("workDateBangkok — handles UTC date crossing midnight Bangkok", () => {
  // 2026-05-24 18:00 UTC = 2026-05-25 01:00 Bangkok (next day in Bangkok TZ)
  const d = new Date("2026-05-24T18:00:00Z");
  assert.equal(workDateBangkok(d), "2026-05-25");
});

test("workDateBangkok — default = now (smoke: returns YYYY-MM-DD shape)", () => {
  const today = workDateBangkok();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

// ── timeBangkok ─────────────────────────────────────────────

test("timeBangkok — null/undefined → '-' (never crashes)", () => {
  assert.equal(timeBangkok(null), "-");
  assert.equal(timeBangkok(undefined), "-");
  assert.equal(timeBangkok(""), "-");
});

test("timeBangkok — HH:mm Bangkok format from ISO", () => {
  // 2026-05-24 01:30 UTC = 08:30 Bangkok
  assert.equal(timeBangkok("2026-05-24T01:30:00Z"), "08:30");
});

test("timeBangkok — invalid date doesn't throw → '-'", () => {
  assert.equal(timeBangkok("not-a-date"), "-");
});

// ── workHours ───────────────────────────────────────────────

test("workHours — both clock_in_at + clock_out_at → calculates hours rounded to 2 decimals", () => {
  const row = {
    clock_in_at:  "2026-05-24T01:00:00Z",
    clock_out_at: "2026-05-24T09:30:00Z",
  };
  assert.equal(workHours(row), 8.5);
});

test("workHours — clock_out_at null → 0 (active session, not counted)", () => {
  assert.equal(workHours({ clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: null }), 0);
});

test("workHours — clock_out_at before clock_in_at → 0 (data corruption guard)", () => {
  const row = {
    clock_in_at:  "2026-05-24T09:00:00Z",
    clock_out_at: "2026-05-24T08:00:00Z",
  };
  assert.equal(workHours(row), 0);
});

test("workHours — missing/null row → 0 (never NaN)", () => {
  assert.equal(workHours(null), 0);
  assert.equal(workHours(undefined), 0);
  assert.equal(workHours({}), 0);
});

test("workHours — non-integer hours rounded correctly (4 dec → 2 dec)", () => {
  // 1 hour 23 minutes = 1.3833... → 1.38
  const row = {
    clock_in_at:  "2026-05-24T00:00:00Z",
    clock_out_at: "2026-05-24T01:23:00Z",
  };
  assert.equal(workHours(row), 1.38);
});

// ── clockState ──────────────────────────────────────────────

test("clockState — empty/null rows → 'none'", () => {
  assert.equal(clockState([]), "none");
  assert.equal(clockState(null), "none");
  assert.equal(clockState(undefined), "none");
});

test("clockState — latest row has clock_out_at NULL → 'open'", () => {
  const rows = [
    { id: 2, clock_out_at: null, clock_in_at: "2026-05-24T01:00:00Z" },
    { id: 1, clock_out_at: "2026-05-23T09:00:00Z", clock_in_at: "2026-05-23T01:00:00Z" },
  ];
  assert.equal(clockState(rows), "open");
});

test("clockState — latest row has clock_out_at set → 'closed'", () => {
  const rows = [
    { id: 1, clock_out_at: "2026-05-24T09:00:00Z", clock_in_at: "2026-05-24T01:00:00Z" },
  ];
  assert.equal(clockState(rows), "closed");
});

// ── sumWorkHours ────────────────────────────────────────────

test("sumWorkHours — sums valid records, ignores open sessions", () => {
  const rows = [
    { clock_in_at: "2026-05-24T01:00:00Z", clock_out_at: "2026-05-24T09:00:00Z" }, // 8h
    { clock_in_at: "2026-05-23T01:00:00Z", clock_out_at: "2026-05-23T05:30:00Z" }, // 4.5h
    { clock_in_at: "2026-05-22T01:00:00Z", clock_out_at: null },                   // 0 (active)
  ];
  assert.equal(sumWorkHours(rows), 12.5);
});

test("sumWorkHours — empty array → 0", () => {
  assert.equal(sumWorkHours([]), 0);
});

test("sumWorkHours — non-array → 0 (defensive)", () => {
  assert.equal(sumWorkHours(null), 0);
  assert.equal(sumWorkHours({}), 0);
});

// ── profileDisplayName (Phase 92.22e) ───────────────────────

test("profileDisplayName — full_name present → use it (trimmed)", () => {
  assert.equal(profileDisplayName({ full_name: "  สมชาย ใจดี  ", email: "s@x.com" }), "สมชาย ใจดี");
});

test("profileDisplayName — empty full_name → fall back to email prefix", () => {
  assert.equal(profileDisplayName({ full_name: "", email: "john.doe@example.com" }), "john.doe");
  assert.equal(profileDisplayName({ full_name: "   ", email: "alice@example.com" }), "alice");
});

test("profileDisplayName — only email → email prefix", () => {
  assert.equal(profileDisplayName({ email: "bob@example.com" }), "bob");
});

test("profileDisplayName — no full_name + no email → 'ผู้ใช้ใหม่'", () => {
  assert.equal(profileDisplayName({}), "ผู้ใช้ใหม่");
  assert.equal(profileDisplayName({ full_name: null, email: null }), "ผู้ใช้ใหม่");
});

test("profileDisplayName — null/undefined profile → '—' (never crash)", () => {
  assert.equal(profileDisplayName(null), "—");
  assert.equal(profileDisplayName(undefined), "—");
});

// ── computeRegularOT (Phase 92.25) ──────────────────────────

test("computeRegularOT — เข้า 08:00 ออก 17:00 (กะเต็มพอดี) → regular 9, ot 0", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 8, 17)), { regular: 9, ot: 0, total: 9 });
});

test("computeRegularOT — เข้า 09:00 ออก 16:00 (มาสาย เลิกก่อน) → regular 7, ot 0", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 9, 16)), { regular: 7, ot: 0, total: 7 });
});

test("computeRegularOT — เข้า 08:00 ออก 19:00 → regular 9 + OT 2 ชม. (หลังเลิกงาน)", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 8, 19)), { regular: 9, ot: 2, total: 11 });
});

test("computeRegularOT — เข้า 07:00 ออก 17:00 → regular 9 + OT 1 (ก่อนเข้างาน)", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 7, 17)), { regular: 9, ot: 1, total: 10 });
});

test("computeRegularOT — เข้า 07:00 ออก 19:00 → regular 9 + OT 3 (1 ก่อน + 2 หลัง)", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 7, 19)), { regular: 9, ot: 3, total: 12 });
});

test("computeRegularOT — เข้า 18:00 ออก 22:00 (ทำเฉพาะนอกกะ) → regular 0 + OT 4", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 18, 22)), { regular: 0, ot: 4, total: 4 });
});

test("computeRegularOT — เข้า 04:00 ออก 07:00 (ทำเช้ามืดก่อนกะ) → regular 0 + OT 3", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 4, 7)), { regular: 0, ot: 3, total: 3 });
});

test("computeRegularOT — เข้า 10:00 ออก 12:00 (มาช่วงสั้น) → regular 2 + OT 0", () => {
  assert.deepEqual(computeRegularOT(row("2026-05-24", 10, 12)), { regular: 2, ot: 0, total: 2 });
});

test("computeRegularOT — clock_out null (กำลังทำงาน) → ทุกค่า 0", () => {
  assert.deepEqual(computeRegularOT({ work_date: "2026-05-24", clock_in_at: "2026-05-24T08:00:00+07:00", clock_out_at: null }),
    { regular: 0, ot: 0, total: 0 });
});

test("computeRegularOT — null/missing row → ทุกค่า 0 (ไม่ NaN)", () => {
  assert.deepEqual(computeRegularOT(null), { regular: 0, ot: 0, total: 0 });
  assert.deepEqual(computeRegularOT(undefined), { regular: 0, ot: 0, total: 0 });
  assert.deepEqual(computeRegularOT({}), { regular: 0, ot: 0, total: 0 });
});

test("computeRegularOT — clock_out ก่อน clock_in (data corruption) → ทุกค่า 0", () => {
  const r = {
    work_date: "2026-05-24",
    clock_in_at:  "2026-05-24T17:00:00+07:00",
    clock_out_at: "2026-05-24T08:00:00+07:00",
  };
  assert.deepEqual(computeRegularOT(r), { regular: 0, ot: 0, total: 0 });
});

test("computeRegularOT — custom shift hours (เช่น 06-15) → ปรับ regular ตาม opts", () => {
  // เข้า 06:00 ออก 15:00 + shift 06-15 → regular 9 ot 0
  assert.deepEqual(computeRegularOT(row("2026-05-24", 6, 15), { startHour: 6, endHour: 15 }),
    { regular: 9, ot: 0, total: 9 });
  // เข้า 06:00 ออก 17:00 + shift 06-15 → regular 9 + OT 2 (หลัง 15:00)
  assert.deepEqual(computeRegularOT(row("2026-05-24", 6, 17), { startHour: 6, endHour: 15 }),
    { regular: 9, ot: 2, total: 11 });
});

test("computeRegularOT — นาที (8:30-17:15) → ปัด 2 ตำแหน่ง", () => {
  const r = {
    work_date: "2026-05-24",
    clock_in_at:  "2026-05-24T08:30:00+07:00",
    clock_out_at: "2026-05-24T17:15:00+07:00",
  };
  // regular = 17:00 - 8:30 = 8.5 hr
  // ot = 17:15 - 17:00 = 0.25 hr
  // total = 8.75
  assert.deepEqual(computeRegularOT(r), { regular: 8.5, ot: 0.25, total: 8.75 });
});

// ── sumRegularOT ────────────────────────────────────────────

test("sumRegularOT — รวม 2 records (regular + OT)", () => {
  const rows = [
    row("2026-05-24", 8, 19),  // reg 9 + ot 2
    row("2026-05-23", 9, 17),  // reg 8 + ot 0
  ];
  assert.deepEqual(sumRegularOT(rows), { regular: 17, ot: 2, total: 19 });
});

test("sumRegularOT — มี open session (ไม่นับ) + non-array → 0", () => {
  const rows = [
    row("2026-05-24", 8, 17),  // reg 9
    { work_date: "2026-05-23", clock_in_at: "2026-05-23T08:00:00+07:00", clock_out_at: null }, // 0
  ];
  assert.deepEqual(sumRegularOT(rows), { regular: 9, ot: 0, total: 9 });
  assert.deepEqual(sumRegularOT(null), { regular: 0, ot: 0, total: 0 });
  assert.deepEqual(sumRegularOT([]), { regular: 0, ot: 0, total: 0 });
});

// ── shiftHoursFromState (Phase 92.25b) ──────────────────────

test("shiftHoursFromState — storeInfo มี shiftStartHour/EndHour → ใช้ค่านั้น", () => {
  const state = { storeInfo: { shiftStartHour: 9, shiftEndHour: 18 } };
  assert.deepEqual(shiftHoursFromState(state), { startHour: 9, endHour: 18 });
});

test("shiftHoursFromState — ไม่มี storeInfo → default 8/17", () => {
  assert.deepEqual(shiftHoursFromState(null), { startHour: 8, endHour: 17 });
  assert.deepEqual(shiftHoursFromState(undefined), { startHour: 8, endHour: 17 });
  assert.deepEqual(shiftHoursFromState({}), { startHour: 8, endHour: 17 });
  assert.deepEqual(shiftHoursFromState({ storeInfo: {} }), { startHour: 8, endHour: 17 });
});

test("shiftHoursFromState — invalid values (NaN, นอก 0-23) → fallback 8/17", () => {
  assert.deepEqual(shiftHoursFromState({ storeInfo: { shiftStartHour: -1, shiftEndHour: 99 } }), { startHour: 8, endHour: 17 });
  assert.deepEqual(shiftHoursFromState({ storeInfo: { shiftStartHour: "abc", shiftEndHour: 17 } }), { startHour: 8, endHour: 17 });
});

test("shiftHoursFromState — start >= end (config ผิด) → fallback 8/17", () => {
  assert.deepEqual(shiftHoursFromState({ storeInfo: { shiftStartHour: 17, shiftEndHour: 8 } }), { startHour: 8, endHour: 17 });
  assert.deepEqual(shiftHoursFromState({ storeInfo: { shiftStartHour: 10, shiftEndHour: 10 } }), { startHour: 8, endHour: 17 });
});

test("shiftHoursFromState — string number ก็รับได้ (จาก HTML input)", () => {
  const state = { storeInfo: { shiftStartHour: "7", shiftEndHour: "16" } };
  assert.deepEqual(shiftHoursFromState(state), { startHour: 7, endHour: 16 });
});

// ── haversineMeters (Phase 92.24) ───────────────────────────

test("haversineMeters — 2 จุดเดียวกัน → 0 เมตร", () => {
  assert.equal(haversineMeters(14.948, 103.481, 14.948, 103.481), 0);
});

test("haversineMeters — 1° latitude at equator = ~111.32 km (Earth circumference standard)", () => {
  // 1° latitude = ~111.32 km ใช้ทุก longitude
  const d = haversineMeters(0, 0, 1, 0);
  assert.ok(d > 110000 && d < 112000, `Expected ~111.32km, got ${d}m`);
});

test("haversineMeters — 1° longitude at equator = ~111.32 km", () => {
  const d = haversineMeters(0, 0, 0, 1);
  assert.ok(d > 110000 && d < 112000, `Expected ~111.32km, got ${d}m`);
});

test("haversineMeters — 1° longitude at lat=60° = ~55.8 km (cos rule)", () => {
  // ที่ latitude 60° → 1° lng = 111.32 × cos(60°) = ~55.66 km
  const d = haversineMeters(60, 0, 60, 1);
  assert.ok(d > 54000 && d < 57000, `Expected ~55.8km, got ${d}m`);
});

test("haversineMeters — 1 เมตร (lat diff 0.000009°) → ~1m", () => {
  const d = haversineMeters(14.948, 103.481, 14.948009, 103.481);
  assert.ok(d === 1 || d === 0, `Expected ~1m got ${d}m`);
});

test("haversineMeters — invalid args (NaN, null, string) → 0", () => {
  assert.equal(haversineMeters(NaN, 0, 0, 0), 0);
  assert.equal(haversineMeters(0, 0, null, 0), 0);
  assert.equal(haversineMeters("abc", 0, 0, 0), 0);
});

// ── geofenceFromState (Phase 92.24) ─────────────────────────

test("geofenceFromState — มี shopLat/Lng → return config + default radius 200m", () => {
  const state = { storeInfo: { shopLat: 14.948, shopLng: 103.481 } };
  assert.deepEqual(geofenceFromState(state), { lat: 14.948, lng: 103.481, radiusM: 200 });
});

test("geofenceFromState — custom radius", () => {
  const state = { storeInfo: { shopLat: 14.948, shopLng: 103.481, geofenceRadiusM: 500 } };
  assert.deepEqual(geofenceFromState(state), { lat: 14.948, lng: 103.481, radiusM: 500 });
});

test("geofenceFromState — ไม่มี lat/lng (เว้นว่าง) → null (= ปิด feature)", () => {
  assert.equal(geofenceFromState({}), null);
  assert.equal(geofenceFromState({ storeInfo: {} }), null);
  assert.equal(geofenceFromState({ storeInfo: { shopLat: null, shopLng: null } }), null);
  assert.equal(geofenceFromState(null), null);
});

test("geofenceFromState — partial config (lat only / lng only) → null", () => {
  assert.equal(geofenceFromState({ storeInfo: { shopLat: 14.948 } }), null);
  assert.equal(geofenceFromState({ storeInfo: { shopLng: 103.481 } }), null);
});

test("geofenceFromState — invalid radius → fallback 200m", () => {
  assert.equal(geofenceFromState({ storeInfo: { shopLat: 14.948, shopLng: 103.481, geofenceRadiusM: -50 } }).radiusM, 200);
  assert.equal(geofenceFromState({ storeInfo: { shopLat: 14.948, shopLng: 103.481, geofenceRadiusM: "abc" } }).radiusM, 200);
});

// ═══════════════════════════════════════════════════════════
//  Phase 92.49 — classifyPunctuality / attendanceRulesFromState / punctualityChipMeta
// ═══════════════════════════════════════════════════════════

const SHIFT = { startHour: 8, endHour: 17 };

// helper: row with explicit Bangkok HH:mm in/out
function rowHM(workDate, inH, inM, outH, outM) {
  const pad = (n) => String(n).padStart(2, "0");
  const inAt  = `${workDate}T${pad(inH)}:${pad(inM)}:00+07:00`;
  const outAt = (outH == null) ? null : `${workDate}T${pad(outH)}:${pad(outM)}:00+07:00`;
  return { work_date: workDate, clock_in_at: inAt, clock_out_at: outAt };
}

test("classifyPunctuality — เข้าตรงเวลา 08:00 ออก 17:00 → on_time, 0/0", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 0, 17, 0), SHIFT, {});
  assert.equal(p.status, "on_time");
  assert.equal(p.lateMinutes, 0);
  assert.equal(p.earlyLeaveMinutes, 0);
});

test("classifyPunctuality — เข้าภายใน grace (08:10, grace 15) → on_time แต่ lateMinutes=10", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 10, 17, 0), SHIFT, { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.equal(p.status, "on_time");
  assert.equal(p.lateMinutes, 10);
  assert.equal(p.earlyLeaveMinutes, 0);
});

test("classifyPunctuality — มาสายเกิน grace (08:25, grace 15) → late, lateMinutes=25", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 25, 17, 0), SHIFT, { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.equal(p.status, "late");
  assert.equal(p.lateMinutes, 25);
  assert.equal(p.earlyLeaveMinutes, 0);
});

test("classifyPunctuality — ออกก่อนเวลา (ออก 16:30, grace 15) → early_leave, earlyLeaveMinutes=30", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 0, 16, 30), SHIFT, { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.equal(p.status, "early_leave");
  assert.equal(p.lateMinutes, 0);
  assert.equal(p.earlyLeaveMinutes, 30);
});

test("classifyPunctuality — มาสาย + ออกก่อน → late_and_early_leave", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 40, 16, 0), SHIFT, { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.equal(p.status, "late_and_early_leave");
  assert.equal(p.lateMinutes, 40);
  assert.equal(p.earlyLeaveMinutes, 60);
});

test("classifyPunctuality — ยังไม่ clock out → missing_clock_out (lateMinutes รายงานได้)", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 30, null, null), SHIFT, { lateGraceMinutes: 15 });
  assert.equal(p.status, "missing_clock_out");
  assert.equal(p.lateMinutes, 30);
  assert.equal(p.earlyLeaveMinutes, 0);
});

test("classifyPunctuality — early-leave grace ผ่อนผัน (ออก 16:50, grace 15) → on_time", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 0, 16, 50), SHIFT, { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.equal(p.status, "on_time");
  assert.equal(p.earlyLeaveMinutes, 10);
});

test("classifyPunctuality — invalid/missing shift → none", () => {
  assert.equal(classifyPunctuality(rowHM("2026-06-01", 8, 0, 17, 0), null, {}).status, "none");
  assert.equal(classifyPunctuality(rowHM("2026-06-01", 8, 0, 17, 0), {}, {}).status, "none");
  assert.equal(classifyPunctuality(rowHM("2026-06-01", 8, 0, 17, 0), { startHour: "x", endHour: "y" }, {}).status, "none");
});

test("classifyPunctuality — null row / no clock_in_at → none", () => {
  assert.equal(classifyPunctuality(null, SHIFT, {}).status, "none");
  assert.equal(classifyPunctuality({ clock_out_at: "2026-06-01T10:00:00+07:00" }, SHIFT, {}).status, "none");
});

test("classifyPunctuality — grace 0 → เข้าสาย 1 นาทีก็เป็น late", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 8, 1, 17, 0), SHIFT, { lateGraceMinutes: 0, earlyLeaveGraceMinutes: 0 });
  assert.equal(p.status, "late");
  assert.equal(p.lateMinutes, 1);
});

test("classifyPunctuality — เข้าก่อนกะ (07:30) ไม่นับ late (lateMinutes=0)", () => {
  const p = classifyPunctuality(rowHM("2026-06-01", 7, 30, 17, 0), SHIFT, {});
  assert.equal(p.status, "on_time");
  assert.equal(p.lateMinutes, 0);
});

// ── attendanceRulesFromState ────────────────────────────────

test("attendanceRulesFromState — default 15/15 เมื่อไม่ตั้ง", () => {
  assert.deepEqual(attendanceRulesFromState({}), { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.deepEqual(attendanceRulesFromState({ storeInfo: {} }), { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
  assert.deepEqual(attendanceRulesFromState(null), { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 });
});

test("attendanceRulesFromState — อ่านค่าจาก storeInfo + floor", () => {
  assert.deepEqual(
    attendanceRulesFromState({ storeInfo: { lateGraceMinutes: 10, earlyLeaveGraceMinutes: 0 } }),
    { lateGraceMinutes: 10, earlyLeaveGraceMinutes: 0 }
  );
  assert.deepEqual(
    attendanceRulesFromState({ storeInfo: { lateGraceMinutes: 7.9, earlyLeaveGraceMinutes: 5.5 } }),
    { lateGraceMinutes: 7, earlyLeaveGraceMinutes: 5 }
  );
});

test("attendanceRulesFromState — ค่าติดลบ/ไม่ใช่ตัวเลข → fallback 15", () => {
  assert.deepEqual(
    attendanceRulesFromState({ storeInfo: { lateGraceMinutes: -5, earlyLeaveGraceMinutes: "abc" } }),
    { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 }
  );
});

// ── punctualityChipMeta ─────────────────────────────────────

test("punctualityChipMeta — none → null (ไม่แสดง chip)", () => {
  assert.equal(punctualityChipMeta({ status: "none" }), null);
  assert.equal(punctualityChipMeta(null), null);
});

test("punctualityChipMeta — late chip มีนาทีในข้อความ", () => {
  const m = punctualityChipMeta({ status: "late", lateMinutes: 25, earlyLeaveMinutes: 0 });
  assert.match(m.label, /มาสาย 25 นาที/);
});

test("punctualityChipMeta — on_time → 'ตรงเวลา'", () => {
  assert.equal(punctualityChipMeta({ status: "on_time" }).label, "ตรงเวลา");
});
