import { test } from "node:test";
import assert from "node:assert/strict";
import { attendancePeriod, summarizeAttendance, fetchAttendanceSummary } from "../modules/attendance_summary.js";

const range = { from: "2026-09-28", to: "2026-10-04" };
const record = (id, date = "2026-10-01", extra = {}) => ({ id, user_id: "a", work_date: date, clock_in_at: date + "T01:00:00Z", clock_out_at: date + "T10:00:00Z", ...extra });
test("Monday week crosses months/year; month includes leap day", () => {
  assert.deepEqual(attendancePeriod("week", "2026-10-04"), range);
  assert.deepEqual(attendancePeriod("week", "2026-01-01"), { from: "2025-12-29", to: "2026-01-04" });
  assert.deepEqual(attendancePeriod("month", "2024-02-10"), { from: "2024-02-01", to: "2024-02-29" });
  assert.throws(() => attendancePeriod("week", "2026-02-30"));
});
test("distinct per-person work dates include open sessions, keep zero and unknown profiles", () => {
  const rows = [record(1), record(2), record(3, "2026-10-02", { clock_out_at: null }), record(4, "2026-10-03", { user_id: "gone" })];
  const before = JSON.stringify(rows);
  const result = summarizeAttendance(rows, [{ id: "a", name: "A" }, { id: "b", name: "B" }], range);
  assert.equal(result.find(x => x.id === "a").days, 2);
  assert.equal(result.find(x => x.id === "a").open, 1);
  assert.equal(result.find(x => x.id === "b").days, 0);
  assert.equal(result.find(x => x.id === "gone").days, 1);
  assert.equal(JSON.stringify(rows), before);
});
test("cross-midnight session counts once under recorded work_date and flags review", () => {
  const result = summarizeAttendance([record(1, "2026-09-30", { clock_out_at: "2026-10-01T10:00:00Z" }), record(2, "2026-10-01", { clock_out_at: "2026-10-01T00:00:00Z" })], [], range);
  assert.equal(result[0].days, 2);
  assert.equal(result[0].review, 2);
});
test("invalid/reversed range and malformed rows fail instead of returning zero", () => {
  assert.throws(() => summarizeAttendance([], [], { from: range.to, to: range.from }));
  assert.throws(() => summarizeAttendance([record(1, "2026-10-20")], [], range));
  assert.throws(() => summarizeAttendance([record(1, undefined, { clock_in_at: null })], [], range));
  assert.deepEqual(summarizeAttendance([], [], range), []);
});
function response(rows, contentRange, status = 200) {
  return new Response(JSON.stringify(rows), { status, headers: contentRange ? { "Content-Range": contentRange } : {} });
}
test("pages beyond 500 and server cap with exact counts; only GET", async () => {
  const data = Array.from({ length: 601 }, (_, i) => record(i));
  let calls = 0;
  const rows = await fetchAttendanceSummary({ baseUrl: "https://fixture.invalid", headers: {}, ...range, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Prefer, "count=exact");
    const query = new URL(url).searchParams;
    assert.deepEqual(query.getAll("work_date"), ["gte.2026-09-28", "lte.2026-10-04"]);
    const offset = Number(query.get("offset"));
    const page = data.slice(offset, offset + 100);
    return response(page, `${offset}-${offset + page.length - 1}/601`);
  }});
  assert.equal(rows.length, 601);
  assert.equal(calls, 7);
});
test("missing count, denial, broken JSON, changing count and duplicate page are rejected", async () => {
  for (const bad of [() => response([], null), () => response([], null, 403), () => new Response("bad")]) {
    await assert.rejects(fetchAttendanceSummary({ baseUrl: "https://fixture.invalid", headers: {}, ...range, fetchImpl: bad }));
  }
  for (const changed of [true, false]) {
    let n = 0;
    await assert.rejects(fetchAttendanceSummary({ baseUrl: "https://fixture.invalid", headers: {}, ...range, fetchImpl: async () => {
      return n++ === 0 ? response([record(1)], "0-0/2") : response([record(1)], changed ? "1-1/3" : "1-1/2");
    }}));
  }
});
test("empty counted result is legitimate; abort propagated", async () => {
  assert.deepEqual(await fetchAttendanceSummary({ baseUrl: "https://fixture.invalid", headers: {}, ...range, fetchImpl: async () => response([], "*/0") }), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchAttendanceSummary({ baseUrl: "https://fixture.invalid", headers: {}, ...range, signal: controller.signal, fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } }));
});
