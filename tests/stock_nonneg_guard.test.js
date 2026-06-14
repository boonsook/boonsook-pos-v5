// Phase 437 — stock non-negative hard rule guard
// Run: node --test tests/stock_nonneg_guard.test.js
//
// Why this exists:
//   Owner: "สต็อกห้ามติดลบเด็ดขาด". Two layers must hold together:
//     1. DB CHECK (stock >= 0) on warehouse_stock + products — the hard guarantee
//        (supabase-phase437-stock-nonneg-check.sql, owner runs).
//     2. The only client path that deliberately wrote negative — the manual
//        stock_movements override (allowNegative:true) — must stop doing so, and
//        out/transfer that would go negative must hard-block (no "proceed to
//        negative" confirm anymore).
//   These guards lock both so a later edit cannot reopen the negative door.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve("supabase-phase437-stock-nonneg-check.sql"), "utf8");
const sm = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");

// ── 1. SQL: CHECK constraints on both stock tables, re-run safe, pre-check first ──
test("SQL adds stock>=0 CHECK on warehouse_stock + products (re-run safe)", () => {
  assert.match(sql, /ADD\s+CONSTRAINT chk_ws_stock_nonneg CHECK \(stock >= 0\)/,
    "warehouse_stock CHECK must exist");
  assert.match(sql, /ADD\s+CONSTRAINT chk_products_stock_nonneg CHECK \(stock >= 0\)/,
    "products CHECK must exist");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS chk_ws_stock_nonneg/, "re-run safe (warehouse_stock)");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS chk_products_stock_nonneg/, "re-run safe (products)");
  // pre-check for existing negatives must come before ADD (constraint validates immediately)
  assert.ok(sql.indexOf("WHERE stock < 0") < sql.indexOf("ADD  CONSTRAINT chk_ws_stock_nonneg"),
    "pre-check for negatives must precede the ADD CONSTRAINT");
  assert.match(sql, /NOTIFY pgrst/, "schema reload notify");
});

// ── 2. client: manual override no longer writes negative ─────────────────────
test("stock_movements manual override no longer sends allowNegative:true", () => {
  assert.ok(!/allowNegative:\s*true/.test(sm),
    "no path may pass allowNegative:true (negative is forbidden)");
  assert.match(sm, /allowNegative:\s*false/,
    "manual movement must pass allowNegative:false (floor enforced)");
});

test("stock_movements hard-blocks out/transfer that would go negative (no proceed-to-negative confirm)", () => {
  // the old confirms said "จะติดลบ ... ดำเนินการต่อ/บันทึกต่อ?" — must be gone
  assert.ok(!/จะติดลบ[\s\S]*?(ดำเนินการต่อ|บันทึกต่อ)/.test(sm),
    "must not offer a 'proceed to negative' confirm");
  // and must show the hard-block message instead
  assert.match(sm, /ไม่อนุญาตให้สต็อกติดลบ/,
    "must surface a 'negative not allowed' block message");
});
