// Phase 379 — hr-overview-gps-exception-display (HR GPS hardening C / #5)
//
// HR Overview ต้องโชว์ "GPS น่าสงสัยวันนี้" แบบ read-only ต่อพนักงานในรายการวันนี้:
//   - ลงเวลาโดยไม่มี GPS (clock_in_lat null/ว่าง) → chip "ไม่มี GPS"
//   - ลงเวลานอกรัศมีร้าน (clock_in_distance_m > geofence.radiusM) → chip "นอกรัศมี ..."
// โชว์เฉพาะ exception (inside/na → ไม่มี chip) และ "ไม่เปลี่ยน logic ลงเวลา"
//
// Layers:
//   1. Behavioral — classifyGpsStatus / gpsChipMeta (pure, imported)
//   2. Source guard — wiring ใน renderHrOverviewPage + read-only proof
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { classifyGpsStatus, gpsChipMeta } = await import("../modules/hr_overview.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "..", "modules", "hr_overview.js"), "utf8");

const GEO = { lat: 15.09, lng: 103.8, radiusM: 200 };

// ── classifyGpsStatus ───────────────────────────────────────────────────────
test("classifyGpsStatus — no geofence → 'na'", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09, clock_in_distance_m: 10 }, null), "na");
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09 }, undefined), "na");
});

test("classifyGpsStatus — row null/undefined → 'na'", () => {
  assert.equal(classifyGpsStatus(null, GEO), "na");
  assert.equal(classifyGpsStatus(undefined, GEO), "na");
});

test("classifyGpsStatus — geofence set + clock_in_lat null → 'missing'", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: null, clock_in_distance_m: null }, GEO), "missing");
});

test("classifyGpsStatus — geofence set + clock_in_lat '' (ว่าง) → 'missing'", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: "", clock_in_distance_m: "" }, GEO), "missing");
});

test("classifyGpsStatus — geofence set + clock_in_lat undefined → 'missing'", () => {
  assert.equal(classifyGpsStatus({ clock_in_distance_m: 50 }, GEO), "missing");
});

test("classifyGpsStatus — distance > radius → 'outside'", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.10, clock_in_distance_m: 350 }, GEO), "outside");
});

test("classifyGpsStatus — distance === radius → 'inside' (ขอบรัศมี = ในพื้นที่)", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09, clock_in_distance_m: 200 }, GEO), "inside");
});

test("classifyGpsStatus — distance < radius → 'inside'", () => {
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09, clock_in_distance_m: 12 }, GEO), "inside");
});

test("classifyGpsStatus — มี GPS แต่ distance non-finite → 'inside' (มีพิกัดแล้ว ไม่ flag)", () => {
  // มีพิกัด GPS (lat) แต่ distance คำนวณไม่ได้ → ถือว่า inside เพื่อลด noise (ดู comment ใน helper)
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09, clock_in_distance_m: null }, GEO), "inside");
  assert.equal(classifyGpsStatus({ clock_in_lat: 15.09, clock_in_distance_m: "abc" }, GEO), "inside");
});

test("classifyGpsStatus — bad numeric input ไม่ throw + ไม่ mutate row/geofence", () => {
  const row = Object.freeze({ clock_in_lat: 15.09, clock_in_distance_m: "x" });
  const geo = Object.freeze({ ...GEO });
  assert.doesNotThrow(() => classifyGpsStatus(row, geo));
  // frozen objects → ถ้าพยายาม mutate จะ throw ใน strict mode (test module = ESM strict)
  assert.equal(classifyGpsStatus(row, geo), "inside");
});

// ── gpsChipMeta ─────────────────────────────────────────────────────────────
test("gpsChipMeta — 'missing' คืน meta + label มี 'ไม่มี GPS'", () => {
  const m = gpsChipMeta("missing");
  assert.ok(m, "missing ต้องคืน meta");
  assert.match(m.label, /ไม่มี GPS/);
  assert.ok(m.bg && m.fg && m.border, "ต้องมี bg/fg/border แบบ chip meta เดิม");
});

test("gpsChipMeta — 'outside' คืน meta + label มี distance/radius", () => {
  const m = gpsChipMeta("outside", { distanceM: 347, radiusM: 200 });
  assert.ok(m, "outside ต้องคืน meta");
  assert.match(m.label, /นอกรัศมี/);
  assert.match(m.label, /347/);
  assert.match(m.label, /200/);
});

test("gpsChipMeta — 'outside' distance/radius ไม่ใช่ตัวเลข → ไม่ throw (ใช้ '—')", () => {
  const m = gpsChipMeta("outside", { distanceM: undefined, radiusM: undefined });
  assert.ok(m);
  assert.match(m.label, /นอกรัศมี/);
});

test("gpsChipMeta — 'inside' คืน null (ไม่โชว์ chip)", () => {
  assert.equal(gpsChipMeta("inside", { distanceM: 10, radiusM: 200 }), null);
});

test("gpsChipMeta — 'na' คืน null (ไม่โชว์ chip)", () => {
  assert.equal(gpsChipMeta("na"), null);
});

// ── Source guard: wiring + read-only proof ─────────────────────────────────
test("hr_overview.js: import geofenceFromState จาก time_clock (ไม่ parse geofence ซ้ำ)", () => {
  assert.ok(
    /geofenceFromState[\s\S]{0,80}from\s+["']\.\/time_clock\.js["']/.test(src) ||
      /import\s*\{[\s\S]*?geofenceFromState[\s\S]*?\}\s*from\s*["']\.\/time_clock\.js["']/.test(src),
    "ต้อง import geofenceFromState จาก ./time_clock.js"
  );
});

test("hr_overview.js: renderHrOverviewPage เรียก geofenceFromState(state)", () => {
  assert.ok(
    /geofenceFromState\(\s*state\s*\)/.test(src) || /geofenceFromState\(\s*ctx\.state\s*\)/.test(src),
    "renderHrOverviewPage ต้องเรียก geofenceFromState(state)"
  );
});

test("hr_overview.js: per-user row ใช้ classifyGpsStatus + gpsChipMeta", () => {
  assert.ok(/classifyGpsStatus\(\s*att\s*,\s*geofence\s*\)/.test(src), "row ต้องเรียก classifyGpsStatus(att, geofence)");
  assert.ok(/gpsChipMeta\(\s*gpsStatus\s*,/.test(src), "row ต้องเรียก gpsChipMeta(gpsStatus, ...)");
});

test("hr_overview.js: render GPS chip ใน tbody (มี gpsMeta + _gpsChip)", () => {
  assert.ok(/_renderTbody\([\s\S]*?\)/.test(src), "ต้องมี _renderTbody");
  assert.ok(/gpsMeta\s*\?[\s\S]{0,60}_gpsChip\(/.test(src), "tbody ต้อง render _gpsChip เมื่อมี gpsMeta");
  assert.ok(/function _gpsChip\(/.test(src), "ต้องมี helper _gpsChip");
  // chip label สำหรับ exception ทั้งสองชนิด (จาก gpsChipMeta source)
  assert.ok(/ไม่มี GPS/.test(src) && /นอกรัศมี/.test(src), "ต้องมี label ทั้ง missing + outside");
});

test("hr_overview.js: ไม่เปลี่ยน attendance loader query (select=* เดิม)", () => {
  // ห้ามแคบ select ลง / ห้ามเพิ่ม column เฉพาะ — loader ต้องคง select=*
  assert.ok(/staff_attendance[\s\S]{0,120}select=\*/.test(src) || /select=\*[\s\S]{0,120}staff_attendance/.test(src),
    "attendance loader ต้องคง select=* (ห้ามแก้ query)");
});

test("hr_overview.js: read-only proof — helper/chip ที่เพิ่มไม่มี write call", () => {
  // ตรวจเฉพาะ helper ใหม่ + ไม่มีคำสั่ง write โผล่ใกล้ helper ใหม่
  const gpsBlockMatch = src.match(/export function classifyGpsStatus[\s\S]*?export function gpsChipMeta[\s\S]*?\n}/);
  assert.ok(gpsBlockMatch, "ต้อง extract บล็อก classifyGpsStatus..gpsChipMeta ได้");
  const block = gpsBlockMatch[0];
  assert.ok(
    !/\b(POST|PATCH|PUT|DELETE|upsert|insert|\.rpc\()\b/i.test(block),
    "helper ใหม่ต้องไม่มี write call (POST/PATCH/PUT/DELETE/upsert/insert/rpc)"
  );
  // _gpsChip ต้องเป็น pure string builder (ไม่มี write)
  const chipMatch = src.match(/function _gpsChip\([\s\S]*?\n}/);
  assert.ok(chipMatch && !/(POST|PATCH|PUT|DELETE|upsert|insert|\.rpc\()/i.test(chipMatch[0]),
    "_gpsChip ต้องไม่มี write call");
});
