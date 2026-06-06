// Phase 382 — hr-overview GPS exception filter (toggle, orthogonal, read-only)
//
// เพิ่ม toggle "📍 GPS น่าสงสัย (N)" ใน HR Overview (แยกจาก status bar) — กดแล้วกรองเฉพาะ
// row gpsStatus ∈ {missing, outside}; compose กับ status/dept/role; โชว์เฉพาะเมื่อตั้ง geofence.
// Read-only (filter view เท่านั้น): ไม่แตะ detection/loader/OT/payroll/enforcement/schema/write.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { isGpsExceptionStatus, countGpsExceptions, filterHrRows } = await import("../modules/hr_overview.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "..", "modules", "hr_overview.js"), "utf8");

// ── isGpsExceptionStatus ────────────────────────────────────────────────────
test("isGpsExceptionStatus: missing/outside → true; inside/na/อื่น → false", () => {
  assert.equal(isGpsExceptionStatus("missing"), true);
  assert.equal(isGpsExceptionStatus("outside"), true);
  assert.equal(isGpsExceptionStatus("inside"), false);
  assert.equal(isGpsExceptionStatus("na"), false);
  assert.equal(isGpsExceptionStatus(undefined), false);
  assert.equal(isGpsExceptionStatus(null), false);
});

// ── countGpsExceptions ──────────────────────────────────────────────────────
test("countGpsExceptions: นับเฉพาะ missing+outside", () => {
  const rows = [
    { gpsStatus: "missing" }, { gpsStatus: "outside" }, { gpsStatus: "inside" },
    { gpsStatus: "na" }, {}, { gpsStatus: "missing" },
  ];
  assert.equal(countGpsExceptions(rows), 3);
});

test("countGpsExceptions: non-array → 0 (ไม่ throw)", () => {
  assert.equal(countGpsExceptions(null), 0);
  assert.equal(countGpsExceptions(undefined), 0);
  assert.equal(countGpsExceptions("x"), 0);
});

// ── filterHrRows: gpsException dimension ─────────────────────────────────────
const ROWS = [
  { profile: { id: 1, role: "staff", department_id: 10 }, status: "working", gpsStatus: "missing" },
  { profile: { id: 2, role: "staff", department_id: 10 }, status: "working", gpsStatus: "inside" },
  { profile: { id: 3, role: "admin", department_id: 20 }, status: "out",     gpsStatus: "outside" },
  { profile: { id: 4, role: "staff", department_id: 20 }, status: "not_in",  gpsStatus: "na" },
];

test("filterHrRows: gpsException:true → เฉพาะ missing/outside", () => {
  const out = filterHrRows(ROWS, { gpsException: true });
  assert.deepEqual(out.map(r => r.profile.id), [1, 3]);
});

test("filterHrRows: gpsException compose กับ status (working + exception)", () => {
  const out = filterHrRows(ROWS, { status: "working", gpsException: true });
  assert.deepEqual(out.map(r => r.profile.id), [1]); // id2 working แต่ inside → ตัดออก
});

test("filterHrRows: gpsException compose กับ dept", () => {
  const out = filterHrRows(ROWS, { departmentId: "20", gpsException: true });
  assert.deepEqual(out.map(r => r.profile.id), [3]);
});

test("filterHrRows: gpsException:false/undefined → ไม่กรอง (backward-compat)", () => {
  assert.equal(filterHrRows(ROWS, { gpsException: false }).length, 4);
  assert.equal(filterHrRows(ROWS, {}).length, 4); // test เดิมทั้งหมดยังเขียว
  assert.equal(filterHrRows(ROWS, { gpsException: "yes" }).length, 4); // ต้องเป็น === true เท่านั้น
});

test("filterHrRows: non-array → [] (ไม่ throw)", () => {
  assert.deepEqual(filterHrRows(null, { gpsException: true }), []);
});

// ── source guards: wiring + gating + read-only ──────────────────────────────
test("render: มี toggle helper _gpsFilterToggle + bar #hrGpsFilterBar", () => {
  assert.ok(/function _gpsFilterToggle\(/.test(src), "ต้องมี _gpsFilterToggle");
  assert.ok(/id="hrGpsFilterBar"/.test(src), "ต้องมี container #hrGpsFilterBar");
  assert.ok(/id="hrGpsToggleBtn"/.test(src), "ต้องมีปุ่ม #hrGpsToggleBtn");
  assert.ok(/GPS น่าสงสัย/.test(src), "ปุ่มต้องมี label 'GPS น่าสงสัย'");
});

test("render: toggle แสดงเฉพาะเมื่อตั้ง geofence (showGpsFilter = !!geofence)", () => {
  assert.ok(/const\s+showGpsFilter\s*=\s*!!\s*geofence/.test(src), "ต้อง gate ด้วย !!geofence");
  assert.ok(/showGpsFilter\s*\?\s*_gpsFilterToggle\(/.test(src), "render toggle เฉพาะเมื่อ showGpsFilter");
});

test("render: tbody + export ส่ง gpsException เข้า filterHrRows", () => {
  assert.ok(/filterHrRows\(rows,\s*\{[^}]*gpsException:\s*activeGpsOnly[^}]*\}\)/.test(src),
    "filterHrRows ต้องรับ gpsException: activeGpsOnly (tbody + export)");
});

test("handler: toggle flip activeGpsOnly + clear-filters reset gps", () => {
  assert.ok(/#hrGpsToggleBtn[\s\S]{0,120}activeGpsOnly\s*=\s*!activeGpsOnly/.test(src),
    "ปุ่ม toggle ต้อง flip activeGpsOnly");
  assert.ok(/activeGpsOnly\s*=\s*false;\s*\/\/[^\n]*clear|clear[\s\S]{0,80}activeGpsOnly\s*=\s*false/.test(src) ||
    /activeFilter\s*=\s*"all";[\s\S]{0,160}activeGpsOnly\s*=\s*false/.test(src),
    "clear-filters ต้อง reset activeGpsOnly=false");
});

test("read-only proof: helper ใหม่ไม่มี write call / ไม่ mutate", () => {
  const fns = [
    src.match(/export function isGpsExceptionStatus[\s\S]*?\n}/),
    src.match(/export function countGpsExceptions[\s\S]*?\n}/),
    src.match(/function _gpsFilterToggle[\s\S]*?\n}/),
  ];
  for (const m of fns) {
    assert.ok(m, "ต้อง extract helper ได้");
    assert.ok(!/\b(POST|PATCH|PUT|DELETE|upsert|insert|\.rpc\(|fetch\()\b/i.test(m[0]),
      "helper ใหม่ต้องไม่มี write/fetch call");
  }
});

test("scope: ไม่แตะ detection/loader (detectExceptions ยังวน attendanceToday; loader select=*)", () => {
  const de = src.match(/export function detectExceptions[\s\S]*?\n}/);
  assert.ok(de && !/gpsException/.test(de[0]), "detectExceptions ต้องไม่มี gpsException");
  assert.ok(/staff_attendance\?select=\*/.test(src), "loader select=* คงเดิม");
});
