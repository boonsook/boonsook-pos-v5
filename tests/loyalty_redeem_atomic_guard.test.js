// Phase 540 (S5) — loyalty redeem must be atomic + staff-only at the DB
// Run: node --test tests/loyalty_redeem_atomic_guard.test.js
//
// BUG_AUDIT S5: redeemPoints() read the balance from the client cache then inserted a redeem row
//   → two devices redeeming at once both pass → balance goes negative. Fix: a SECURITY DEFINER
//   RPC that locks per-customer, reads the balance from the DB, refuses over-redeem (23514) and
//   refuses the customer role (42501), then inserts atomically. The client calls the RPC and no
//   longer inserts loyalty_points directly in the redeem path.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SQL = fs.readFileSync(path.resolve("supabase-phase540-loyalty-redeem-atomic.sql"), "utf8");
const LOYALTY = fs.readFileSync(path.resolve("modules/loyalty.js"), "utf8");

function extractFn(src, sig, endMarker) {
  const start = src.indexOf(sig);
  if (start < 0) return "";
  const end = src.indexOf(endMarker, start);
  return end > start ? src.slice(start, end) : src.slice(start);
}

// ───────────────────────────────────────────────
// 1. SQL — the atomic, guarded RPC
// ───────────────────────────────────────────────

test("SQL: defines a SECURITY DEFINER redeem function", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.redeem_loyalty_points_atomic/, "function must exist");
  assert.match(SQL, /SECURITY DEFINER/, "must be SECURITY DEFINER");
  assert.match(SQL, /SET search_path = public/, "must pin search_path");
});

test("SQL: ★ role guard is staff-only (42501) and matches the table policy (before any read/insert)", () => {
  // positive gate must equal the existing loyalty_points_rw policy (WITH CHECK is_staff()) so the
  // SECURITY DEFINER RPC does not grant redeem to any role the direct INSERT didn't already allow.
  assert.match(SQL, /IF NOT COALESCE\(public\.is_staff\(\), false\) THEN/, "must require staff (match loyalty_points_rw policy)");
  // explicit defence-in-depth deny of the OTP customer role
  assert.match(SQL, /COALESCE\(public\.is_customer_role\(\), false\)/, "must also explicitly deny the customer role");
  assert.match(SQL, /RAISE EXCEPTION[\s\S]{0,80}USING ERRCODE = '42501'/, "non-staff / customer → 42501 forbidden");
  // the guard must come BEFORE the balance read (so a non-staff caller never reaches the SELECT)
  const idxStaff = SQL.indexOf("is_staff");
  const idxCustomer = SQL.indexOf("is_customer_role");
  const idxBalance = SQL.indexOf("v_remaining :=") === -1 ? SQL.indexOf("INTO v_remaining") : SQL.indexOf("v_remaining :=");
  assert.ok(idxStaff !== -1 && idxCustomer !== -1, "both guards must be present");
  assert.ok(idxStaff < idxBalance && idxCustomer < idxBalance, "the role guards must precede the balance computation");
});

test("SQL: serializes per-customer with an advisory xact lock", () => {
  assert.match(SQL, /pg_advisory_xact_lock\(\s*hashtextextended\('loyalty:'/, "must take a per-customer advisory lock");
});

test("SQL: reads the balance from loyalty_points and refuses over-redeem with 23514", () => {
  assert.match(SQL, /FROM public\.loyalty_points/, "balance must come from the DB table");
  assert.match(SQL, /type = 'earn'[\s\S]*type = 'redeem'/, "balance = earn − redeem");
  assert.match(SQL, /v_remaining < p_points[\s\S]{0,120}USING ERRCODE = '23514'/, "over-redeem → 23514");
});

test("SQL: inserts a redeem/redemption row and grants execute to authenticated", () => {
  assert.match(SQL, /INSERT INTO public\.loyalty_points[\s\S]*'redeem'[\s\S]*'redemption'/, "inserts type='redeem', ref_type='redemption'");
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.redeem_loyalty_points_atomic[\s\S]*TO authenticated/, "grant execute to authenticated");
  assert.match(SQL, /NOTIFY pgrst, 'reload schema'/, "must reload PostgREST schema");
});

// ───────────────────────────────────────────────
// 2. JS — redeemPoints calls the RPC, no direct insert; earn untouched
// ───────────────────────────────────────────────

const redeemBody = extractFn(LOYALTY, "export async function redeemPoints", "export function renderLoyaltyPage");
const earnBody = extractFn(LOYALTY, "export async function earnPoints", "export async function redeemPoints");

test("JS: redeemPoints calls the atomic RPC and casts customer_id to Number", () => {
  assert.ok(redeemBody, "redeemPoints body must be found");
  assert.match(redeemBody, /rpc\/redeem_loyalty_points_atomic/, "must call the RPC endpoint");
  assert.match(redeemBody, /p_customer_id:\s*Number\(customerId\)/, "p_customer_id must be cast to Number (select.value is a string)");
  assert.match(redeemBody, /p_points:\s*Number\(/, "p_points must be numeric");
  // 23514 from the DB must map to a friendly insufficient-points message
  assert.match(redeemBody, /23514/, "must detect the 23514 over-redeem error from the DB");
});

test("JS: redeem path no longer inserts loyalty_points directly (the racy read-then-insert)", () => {
  assert.ok(!/_appXhrPost\(\s*['"]loyalty_points['"]/.test(redeemBody),
    "redeemPoints must NOT POST loyalty_points directly anymore — the RPC owns the insert");
});

test("JS: earnPoints is untouched (still a direct loyalty_points insert) — no false positive", () => {
  assert.ok(earnBody, "earnPoints body must be found");
  assert.match(earnBody, /_appXhrPost\(\s*['"]loyalty_points['"]/, "earn still inserts loyalty_points directly");
});

test("JS: the manual form is still cleared only on r.ok (Phase 90.9 contract kept)", () => {
  assert.match(LOYALTY, /const r = await redeemPoints\([\s\S]{0,80}if \(r\?\.ok\)/, "form clear must stay gated behind r.ok");
});
