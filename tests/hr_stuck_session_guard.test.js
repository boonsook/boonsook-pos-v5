// Phase 380 — hr-overview-stuck-session-crossday (clock-out trap C2 · scope A: read-only display)
//
// ช่องโหว่: session ที่ clock_in มี + clock_out null + work_date = วันก่อนหน้า (ค้างข้ามวัน)
// อยู่ใน attendanceMonth แต่ไม่อยู่ใน attendanceToday → detectExceptions ไม่เห็น → ไม่ขึ้นที่ไหน;
// OT calc ตัด open session ทิ้ง → วันนั้น under-count เงียบ.
//
// Fix (read-only display): pure helper detectStuckCrossDaySessions(attendanceMonth, {today})
// คืน exception-shaped objects → merge เข้า exceptions list → แสดงผ่าน _alertRow เดิม.
// ไม่แก้สูตร OT/payroll · ไม่แตะ clock enforcement · ไม่แตะ detectExceptions เดิม · ไม่ DB write.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { detectStuckCrossDaySessions } = await import("../modules/hr_overview.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "..", "modules", "hr_overview.js"), "utf8");

const TODAY = "2026-06-06";

// ── detectStuckCrossDaySessions ─────────────────────────────────────────────
test("cross-day open (work_date เมื่อวาน, ยังไม่ปิด) → flag 1 + message มี 'ข้ามวัน' + N วัน", () => {
  const rows = [
    { id: 11, user_id: "u1", work_date: "2026-06-05", clock_in_at: "2026-06-05T01:00:00Z", clock_out_at: null },
  ];
  const out = detectStuckCrossDaySessions(rows, { today: TODAY });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "stuck_session_crossday");
  assert.equal(out[0].severity, "high");
  assert.equal(out[0].userId, "u1");
  assert.equal(out[0].refId, 11);
  assert.match(out[0].message, /ข้ามวัน/);
  assert.match(out[0].message, /2026-06-05/);
  assert.match(out[0].message, /ค้าง 1 วัน/);
});

test("ค้างหลายวัน → N นับถูก (today − work_date)", () => {
  const rows = [{ id: 1, user_id: "u", work_date: "2026-06-01", clock_in_at: "2026-06-01T01:00:00Z", clock_out_at: null }];
  const out = detectStuckCrossDaySessions(rows, { today: TODAY });
  assert.match(out[0].message, /ค้าง 5 วัน/);
});

test("same-day open → ไม่ flag (เป็นงานของ detectExceptions เดิม)", () => {
  const rows = [{ id: 2, user_id: "u", work_date: TODAY, clock_in_at: TODAY + "T01:00:00Z", clock_out_at: null }];
  assert.deepEqual(detectStuckCrossDaySessions(rows, { today: TODAY }), []);
});

test("closed session (มี clock_out) → ไม่ flag แม้ work_date เก่า", () => {
  const rows = [{ id: 3, user_id: "u", work_date: "2026-06-04", clock_in_at: "2026-06-04T01:00:00Z", clock_out_at: "2026-06-04T10:00:00Z" }];
  assert.deepEqual(detectStuckCrossDaySessions(rows, { today: TODAY }), []);
});

test("clock_in null → ไม่ flag", () => {
  const rows = [{ id: 4, user_id: "u", work_date: "2026-06-03", clock_in_at: null, clock_out_at: null }];
  assert.deepEqual(detectStuckCrossDaySessions(rows, { today: TODAY }), []);
});

test("clock_out undefined (ไม่ใช่ null literal) → ยัง flag (== null ครอบ undefined)", () => {
  const rows = [{ id: 5, user_id: "u", work_date: "2026-06-05", clock_in_at: "2026-06-05T01:00:00Z" }];
  const out = detectStuckCrossDaySessions(rows, { today: TODAY });
  assert.equal(out.length, 1);
});

test("input ไม่ใช่ array → [] (ไม่ throw)", () => {
  assert.deepEqual(detectStuckCrossDaySessions(null, { today: TODAY }), []);
  assert.deepEqual(detectStuckCrossDaySessions(undefined, { today: TODAY }), []);
  assert.deepEqual(detectStuckCrossDaySessions("nope", { today: TODAY }), []);
});

test("row พัง / work_date หาย → ข้าม ไม่ throw", () => {
  const rows = [null, {}, { user_id: "u", clock_in_at: "x", clock_out_at: null }];
  assert.doesNotThrow(() => detectStuckCrossDaySessions(rows, { today: TODAY }));
  assert.deepEqual(detectStuckCrossDaySessions(rows, { today: TODAY }), []);
});

test("ไม่ mutate input array/rows", () => {
  const row = Object.freeze({ id: 9, user_id: "u", work_date: "2026-06-05", clock_in_at: "2026-06-05T01:00:00Z", clock_out_at: null });
  const rows = Object.freeze([row]);
  assert.doesNotThrow(() => detectStuckCrossDaySessions(rows, { today: TODAY }));
  assert.equal(detectStuckCrossDaySessions(rows, { today: TODAY }).length, 1);
});

test("work_date มี time suffix → ใช้แค่ 10 ตัวแรก (slice)", () => {
  const rows = [{ id: 7, user_id: "u", work_date: "2026-06-05T00:00:00+07:00", clock_in_at: "2026-06-05T01:00:00Z", clock_out_at: null }];
  const out = detectStuckCrossDaySessions(rows, { today: TODAY });
  assert.equal(out.length, 1);
  assert.match(out[0].message, /2026-06-05/);
});

// ── wiring + scope guards (source-regex) ────────────────────────────────────
test("renderHrOverviewPage merge ผล helper เข้า exceptions", () => {
  assert.ok(
    /exceptions\.push\(\s*\.\.\.detectStuckCrossDaySessions\(\s*data\.attendanceMonth\s*,\s*\{\s*today\s*\}\s*\)\s*\)/.test(src),
    "ต้อง exceptions.push(...detectStuckCrossDaySessions(data.attendanceMonth, { today }))"
  );
});

test("alertActionFor รู้จัก kind ใหม่ (ปุ่ม action ไป time_clock)", () => {
  assert.ok(
    /case\s+["']stuck_session_crossday["']\s*:\s*return\s*\{[^}]*route:\s*["']time_clock["']/.test(src),
    "alertActionFor ต้องมี case stuck_session_crossday → time_clock"
  );
});

test("ไม่แก้ detectExceptions เดิม (ยังวน attendanceToday เท่านั้น)", () => {
  const m = src.match(/export function detectExceptions[\s\S]*?\n}/);
  assert.ok(m, "ต้อง extract detectExceptions ได้");
  assert.ok(!/attendanceMonth/.test(m[0]), "detectExceptions ต้องไม่อ้าง attendanceMonth (ไม่ถูกแก้)");
  assert.ok(!/stuck_session_crossday/.test(m[0]), "detectExceptions ต้องไม่มี kind ใหม่ (helper แยก)");
});

test("read-only proof — helper ใหม่ไม่มี write call / ไม่ mutate", () => {
  const m = src.match(/export function detectStuckCrossDaySessions[\s\S]*?\n}/);
  assert.ok(m, "ต้อง extract detectStuckCrossDaySessions ได้");
  const body = m[0];
  assert.ok(
    !/\b(POST|PATCH|PUT|DELETE|upsert|insert|\.rpc\(|fetch\()\b/i.test(body),
    "helper ใหม่ต้องไม่มี write/fetch call"
  );
  // อ่านอย่างเดียว: ไม่มี .push/.splice/.sort บน attendanceMonth (push เข้า out เท่านั้น)
  assert.ok(!/attendanceMonth\.(push|splice|sort|reverse|pop|shift)/.test(body),
    "ต้องไม่ mutate attendanceMonth");
});

test("loader query เดิมไม่ถูกแตะ (attendanceMonth select=*)", () => {
  assert.ok(/staff_attendance\?select=\*[\s\S]{0,160}work_date=gte/.test(src),
    "attendanceMonth loader ต้องคง select=* + window เดิม");
});
