// Phase 375 stock-deduct-reconcile-report (read-only)
// Run: node --test tests/stock_reconcile_report_guard.test.js
//
// Why this exists:
//   Read-only admin report that surfaces service jobs whose stock deduct looks INCOMPLETE
//   (post-save race: cache passed pre-check 370/372 but DB CAS found insufficient → toast only).
//   This is a HEURISTIC (match job_no in stock_movements.note) — not a ledger. Tests lock:
//   (1) the pure detection (flag only expected-missing; skip service/non_stock; complete → no flag),
//   (2) read-only invariant (no write verbs in the source),
//   (3) admin-only gate + honesty labels present.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseItems, buildProductsById, expectedStockableItems,
  detectJobDeductGaps, detectAllJobs, jobTimestamp,
} from "../modules/stock_reconcile_report.js";

const SRC = fs.readFileSync(path.resolve("modules/stock_reconcile_report.js"), "utf8");

// products: 100 = stockable, 200 = service, 300 = non_stock
const PRODUCTS = [
  { id: 100, product_type: "stock", name: "คอมเพรสเซอร์" },
  { id: 200, product_type: "service", name: "ค่าบริการติดตั้ง" },
  { id: 300, product_type: "non_stock", name: "ค่าเดินทาง" },
];
const byId = buildProductsById(PRODUCTS);

function job(jobNo, items, extra = {}) {
  return { job_no: jobNo, status: "done", job_type: "service_install", items_json: items, ...extra };
}

// ── PURE: filtering stockable vs service/non_stock ──

test("expectedStockableItems keeps stockable items with product_id+warehouse_id+qty>0", () => {
  const items = [{ product_id: 100, warehouse_id: 1, qty: 2, name: "คอมเพรสเซอร์" }];
  const exp = expectedStockableItems(job("JOB-1", items), byId);
  assert.equal(exp.length, 1);
});

test("expectedStockableItems drops service/non_stock products (no stock deduct → never flag)", () => {
  const items = [
    { product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" },
    { product_id: 200, warehouse_id: 1, qty: 1, name: "ค่าบริการ" },   // service
    { product_id: 300, warehouse_id: 1, qty: 1, name: "ค่าเดินทาง" },  // non_stock
  ];
  const exp = expectedStockableItems(job("JOB-1", items), byId);
  assert.equal(exp.length, 1, "only the stockable item counts");
  assert.equal(String(exp[0].product_id), "100");
});

test("expectedStockableItems drops items missing warehouse_id / qty<=0", () => {
  const items = [
    { product_id: 100, warehouse_id: null, qty: 2, name: "no-wh" },
    { product_id: 100, warehouse_id: 1, qty: 0, name: "zero-qty" },
  ];
  assert.equal(expectedStockableItems(job("JOB-1", items), byId).length, 0);
});

// ── PURE: detection (flag only when an expected out-movement is missing) ──

test("complete deduct → NOT flagged", () => {
  const j = job("JOB-1001", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" }]);
  const movements = [{ product_id: 100, note: "service_install: JOB-1001 — คอมเพรสเซอร์ | 5→4" }];
  const r = detectJobDeductGaps({ job: j, outMovements: movements, productsById: byId });
  assert.equal(r.flagged, false);
  assert.equal(r.missing.length, 0);
});

test("expected 2 lines, only 1 out-movement → flagged with the missing product", () => {
  const j = job("JOB-1002", [
    { product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" },
    { product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" },
  ]);
  const movements = [{ product_id: 100, note: "service_install: JOB-1002 — คอมเพรสเซอร์ | 5→4" }];
  const r = detectJobDeductGaps({ job: j, outMovements: movements, productsById: byId });
  assert.equal(r.flagged, true);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].expected, 2);
  assert.equal(r.missing[0].found, 1);
});

test("no out-movement at all for the job → flagged", () => {
  const j = job("JOB-1003", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" }]);
  const r = detectJobDeductGaps({ job: j, outMovements: [], productsById: byId });
  assert.equal(r.flagged, true);
});

test("movement for a DIFFERENT job_no does not satisfy this job (note scoping)", () => {
  const j = job("JOB-1004", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" }]);
  const movements = [{ product_id: 100, note: "service_install: JOB-9999 — คอมเพรสเซอร์ | 5→4" }];
  const r = detectJobDeductGaps({ job: j, outMovements: movements, productsById: byId });
  assert.equal(r.flagged, true, "other job's movement must not count");
});

test("job with only service/non_stock items → expectedCount 0, never flagged", () => {
  const j = job("JOB-1005", [{ product_id: 200, warehouse_id: 1, qty: 1, name: "ค่าบริการ" }]);
  const r = detectJobDeductGaps({ job: j, outMovements: [], productsById: byId });
  assert.equal(r.expectedCount, 0);
  assert.equal(r.flagged, false);
});

test("job with stockable items but NO job_no → unverifiable, not flagged (no false-positive)", () => {
  const j = job("", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "คอมเพรสเซอร์" }]);
  const r = detectJobDeductGaps({ job: j, outMovements: [], productsById: byId });
  assert.equal(r.unverifiable, true);
  assert.equal(r.flagged, false);
});

test("detectAllJobs buckets flagged / unverifiable / ok correctly", () => {
  const jobs = [
    job("JOB-A", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "x" }]),   // will be ok
    job("JOB-B", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "x" }]),   // will be flagged
    job("", [{ product_id: 100, warehouse_id: 1, qty: 1, name: "x" }]),         // unverifiable
    job("JOB-C", [{ product_id: 200, warehouse_id: 1, qty: 1, name: "svc" }]),  // skipped (service)
  ];
  const movements = [{ product_id: 100, note: "JOB-A done | 5→4" }];
  const d = detectAllJobs({ jobs, outMovements: movements, productsById: byId });
  assert.equal(d.okCount, 1);
  assert.equal(d.flagged.length, 1);
  assert.equal(d.flagged[0].result.jobNo, "JOB-B");
  assert.equal(d.unverifiable.length, 1);
});

test("parseItems handles array, JSON string, and garbage", () => {
  assert.equal(parseItems([{ a: 1 }]).length, 1);
  assert.equal(parseItems('[{"a":1}]').length, 1);
  assert.equal(parseItems("not json").length, 0);
  assert.equal(parseItems(null).length, 0);
});

test("jobTimestamp prefers created_at, falls back to JOB-<ts>", () => {
  assert.ok(jobTimestamp({ created_at: "2026-06-05T00:00:00Z" }) > 0);
  assert.ok(jobTimestamp({ job_no: "JOB-1700000000000" }) > 0);
  assert.equal(jobTimestamp({ job_no: "no-ts" }), 0);
});

// ── READ-ONLY invariant (source must contain no write verbs / mutations) ──

test("source has NO write verbs (POST/PATCH/PUT/DELETE/rpc/insert/upsert)", () => {
  assert.doesNotMatch(SRC, /method:\s*["'`]?(POST|PUT|PATCH|DELETE)/i, "no write HTTP method");
  assert.doesNotMatch(SRC, /\/rest\/v1\/rpc\//, "no rpc call");
  assert.doesNotMatch(SRC, /xhrPost|xhrPatch|xhrDelete|xhrPut/, "no xhr write helpers");
  assert.doesNotMatch(SRC, /\.(insert|update|upsert|delete)\s*\(/, "no supabase write builders");
});

test("the only fetch is a read (GET) to stock_movements", () => {
  assert.match(SRC, /\/rest\/v1\/stock_movements\?type=eq\.out/, "reads out-movements");
  // every fetch( in the file must be a plain GET (no method option anywhere)
  assert.doesNotMatch(SRC, /method\s*:/, "no method option on any fetch (GET only)");
});

test("admin-only gate is present", () => {
  assert.match(SRC, /requireAdmin/, "checks requireAdmin");
  assert.match(SRC, /ผู้ดูแลระบบเท่านั้น/, "blocks non-admin with a clear message");
});

test("honesty labels are present (heuristic + scope + incomplete state)", () => {
  assert.match(SRC, /heuristic best-effort/, "heuristic honesty label");
  assert.match(SRC, /ไม่ใช่บัญชีเป๊ะ/, "not-a-ledger disclaimer");
  assert.match(SRC, /งานบริการล่าสุด ≤50/, "scope label");
  assert.match(SRC, /ตรวจไม่ได้/, "data-incomplete state exists (no false-positive)");
});

test("drill action is navigation only (showRoute service_jobs), no stock-mutation hooks", () => {
  assert.match(SRC, /showRoute\?\.\("service_jobs"\)/, "navigates to service_jobs");
  // report must never call any stock-mutating app hook
  assert.doesNotMatch(
    SRC,
    /_appApplyStockMovement|_appTransferWarehouseStock|_appDeductStock|_atomicDecrementStock|_atomicAddStock/,
    "no stock-mutation hooks in a read-only report"
  );
});
