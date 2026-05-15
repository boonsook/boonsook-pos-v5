// Phase 89.27 — Unit tests for visibleSalesForRole (extends Phase 89.24)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleSalesForRole, isAdminProfile } from "../modules/utils.js";

const ADMIN  = { role: "admin" };
const SALES  = { role: "sales" };
const TECH   = { role: "technician" };
const NOROLE = { role: null };
const NO_PROFILE = null;

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const NO_USER = null;

function s(id, created_by, note) {
  return { id, created_by, note: note || "", total_amount: 100 };
}

test("isAdminProfile: admin role only", () => {
  assert.equal(isAdminProfile(ADMIN), true);
  assert.equal(isAdminProfile(SALES), false);
  assert.equal(isAdminProfile(TECH), false);
  assert.equal(isAdminProfile(NOROLE), false);
  assert.equal(isAdminProfile(NO_PROFILE), false);
});

test("admin sees ALL rows including other users + legacy NULL — deleted only filtered", () => {
  const sales = [
    s(1, USER_A.id),
    s(2, USER_B.id),
    s(3, null),
    s(4, USER_A.id, "[ลบแล้ว] cancelled"),
  ];
  const out = visibleSalesForRole(sales, ADMIN, USER_A);
  assert.deepEqual(out.map(x => x.id), [1, 2, 3]);
});

test("non-admin (sales role) sees own + legacy NULL — drops other-user rows", () => {
  const sales = [
    s(1, USER_A.id),
    s(2, USER_B.id),
    s(3, null),
    s(4, USER_A.id, "[ลบแล้ว]"),
  ];
  const out = visibleSalesForRole(sales, SALES, USER_A);
  // expected: id 1 (own) + id 3 (legacy NULL, kept per Phase 89.24 semantics)
  assert.deepEqual(out.map(x => x.id), [1, 3]);
});

test("non-admin (technician) — same filter applies", () => {
  const sales = [s(1, USER_A.id), s(2, USER_B.id)];
  const out = visibleSalesForRole(sales, TECH, USER_A);
  assert.deepEqual(out.map(x => x.id), [1]);
});

test("non-admin without myId — sees only NULL/no-created_by rows + deleted skip", () => {
  // When no user (shouldn't happen in real flow, but defensive)
  const sales = [s(1, USER_A.id), s(2, null), s(3, USER_A.id, "[ลบแล้ว]")];
  const out = visibleSalesForRole(sales, SALES, NO_USER);
  // Without myId we can't compare created_by, so all non-deleted pass through
  // (this matches the Phase 89.24 client-side semantics: `if (!isAdmin && myId && ...)`)
  assert.deepEqual(out.map(x => x.id), [1, 2]);
});

test("empty / null sales array — returns []", () => {
  assert.deepEqual(visibleSalesForRole(null, ADMIN, USER_A), []);
  assert.deepEqual(visibleSalesForRole(undefined, SALES, USER_A), []);
  assert.deepEqual(visibleSalesForRole([], ADMIN, USER_A), []);
});

test("uuid string mismatch (number vs string) — uses String() coercion", () => {
  // Defensive: created_by might be coerced differently per source
  const sales = [
    { id: 1, created_by: USER_A.id, note: "" },
    { id: 2, created_by: USER_A.id.toUpperCase(), note: "" }, // shouldn't match
  ];
  const out = visibleSalesForRole(sales, SALES, USER_A);
  assert.deepEqual(out.map(x => x.id), [1]);
});

test("C1 regression — non-admin sees own row even when server-filtered set has only one row", () => {
  // Simulates Phase 89.27 server-side filter result: state.sales already contains only
  // the user's own rows (server .or(created_by.eq.X,is.null) does the work).
  // visibleSalesForRole should be idempotent: same input → same output.
  const sales = [s(1, USER_A.id), s(2, null)];
  const first = visibleSalesForRole(sales, SALES, USER_A);
  const second = visibleSalesForRole(first, SALES, USER_A);
  assert.deepEqual(first.map(x => x.id), [1, 2]);
  assert.deepEqual(second.map(x => x.id), [1, 2]);
});
