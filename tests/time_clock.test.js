// Phase 92.22 — Unit tests for modules/time_clock.js pure helpers
// Covers: workDateBangkok (TZ correctness), timeBangkok, workHours,
//         clockState, sumWorkHours, canAutoClaim (case-insensitive, null-safe)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  workDateBangkok,
  timeBangkok,
  workHours,
  clockState,
  sumWorkHours,
  canAutoClaim,
} = await import("../modules/time_clock.js");

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

// ── canAutoClaim (Phase 92.23) ──────────────────────────────

test("canAutoClaim — matching email + no existing user_id → true", () => {
  const staff = { email: "somchai@example.com", user_id: null };
  const auth  = { email: "somchai@example.com", id: "abc-123" };
  assert.equal(canAutoClaim(staff, auth), true);
});

test("canAutoClaim — case-insensitive + trim", () => {
  const staff = { email: "  Somchai@Example.com  ", user_id: null };
  const auth  = { email: "SOMCHAI@example.com", id: "abc-123" };
  assert.equal(canAutoClaim(staff, auth), true);
});

test("canAutoClaim — staff already claimed (user_id set) → false (no re-claim)", () => {
  const staff = { email: "somchai@example.com", user_id: "old-user" };
  const auth  = { email: "somchai@example.com", id: "new-user" };
  assert.equal(canAutoClaim(staff, auth), false);
});

test("canAutoClaim — email mismatch → false", () => {
  const staff = { email: "somchai@example.com", user_id: null };
  const auth  = { email: "other@example.com", id: "abc-123" };
  assert.equal(canAutoClaim(staff, auth), false);
});

test("canAutoClaim — missing email on either side → false", () => {
  assert.equal(canAutoClaim({ email: null, user_id: null }, { email: "x@y.com", id: "a" }), false);
  assert.equal(canAutoClaim({ email: "x@y.com", user_id: null }, { email: null, id: "a" }), false);
  assert.equal(canAutoClaim({ email: "", user_id: null }, { email: "x@y.com", id: "a" }), false);
});

test("canAutoClaim — missing auth.id → false (cannot claim without target user)", () => {
  const staff = { email: "x@y.com", user_id: null };
  const auth  = { email: "x@y.com", id: null };
  assert.equal(canAutoClaim(staff, auth), false);
});

test("canAutoClaim — null inputs → false (never throws)", () => {
  assert.equal(canAutoClaim(null, null), false);
  assert.equal(canAutoClaim(null, { email: "x@y.com", id: "a" }), false);
  assert.equal(canAutoClaim({ email: "x@y.com", user_id: null }, null), false);
});
