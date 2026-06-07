// Phase 387 — dashboard-monthly-net-profit-include-service-income
// Run: node --test tests/dashboard_income_guard.test.js
//
// Why this exists:
//   "ภาพรวมบริษัท" กำไรสุทธิเดือนนี้ เดิมคิดจาก POS sales + web orders เท่านั้น
//   (monthRevenue) → ไม่รวมรายได้งานบริการ (delivered/done/closed) ที่งบ P&L นับ
//   → กำไรสุทธิ dashboard เพี้ยนจาก P&L (เคสจริง: −1,478 vs −978, ขาดรายได้บริการ 500).
//   helpers เหล่านี้รวมรายได้งานบริการ (ชุดเดียวกับที่ auto_post โพสต์เป็น SV) โดยไม่นับซ้ำ web order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isWebOrderServiceJob, isServiceIncomeJob, sumServiceJobIncome } from "../modules/dashboard.js";

const job = (x={}) => ({ id:1, job_no:"JOB-1", status:"delivered", total_cost:500, sub_service:"", note:"", created_at:"2026-06-05T03:00:00Z", ...x });

// ── isServiceIncomeJob ──
test("income job = delivered/done/closed + total_cost>0", () => {
  assert.equal(isServiceIncomeJob(job({status:"delivered"})), true);
  assert.equal(isServiceIncomeJob(job({status:"DONE"})), true);
  assert.equal(isServiceIncomeJob(job({status:" Closed "})), true);
});
test("income job false for open/pending/cancelled/zero/deleted", () => {
  assert.equal(isServiceIncomeJob(job({status:"pending"})), false);
  assert.equal(isServiceIncomeJob(job({status:"in_progress"})), false);
  assert.equal(isServiceIncomeJob(job({status:"cancelled"})), false);
  assert.equal(isServiceIncomeJob(job({total_cost:0})), false);
  assert.equal(isServiceIncomeJob(job({total_cost:null})), false);
  assert.equal(isServiceIncomeJob(job({deleted_at:"2026-06-01"})), false);
  assert.equal(isServiceIncomeJob(job({note:"[ลบแล้ว]"})), false);
  assert.equal(isServiceIncomeJob(null), false);
});

// ── isWebOrderServiceJob ──
test("web order = สั่งซื้อ sub_service or SH- note, not cancelled", () => {
  assert.equal(isWebOrderServiceJob(job({sub_service:"สั่งซื้อสินค้า"})), true);
  assert.equal(isWebOrderServiceJob(job({note:"SH-cod_cash|abc"})), true);
  assert.equal(isWebOrderServiceJob(job({sub_service:"สั่งซื้อสินค้า", status:"cancelled"})), false);
  assert.equal(isWebOrderServiceJob(job()), false); // plain service job
  assert.equal(isWebOrderServiceJob(null), false);
});

// ── sumServiceJobIncome ──
const inMonth = j => String(j.created_at).slice(0,7) === "2026-06";
test("sums service income; excludes web orders (no double count)", () => {
  const jobs = [
    job({id:1, total_cost:500}),                                  // service income ✓ 500
    job({id:2, total_cost:300, sub_service:"สั่งซื้อสินค้า"}),     // web order → excluded
    job({id:3, total_cost:200, status:"pending"}),               // not income → excluded
    job({id:4, total_cost:100, created_at:"2026-05-10T03:00:00Z"})// other month → excluded
  ];
  assert.equal(sumServiceJobIncome(jobs, inMonth), 500);
});
test("reconciles dashboard month income to P&L example (POS 10 + service 500 = 510)", () => {
  const jobs = [ job({id:1, total_cost:500, created_at:"2026-06-06T02:00:00Z"}) ];
  const monthService = sumServiceJobIncome(jobs, inMonth);
  const monthRevenuePOS = 10; // POS sale only
  assert.equal(monthRevenuePOS + monthService, 510); // matches P&L June revenue
});
test("null-safe", () => {
  assert.equal(sumServiceJobIncome(null, inMonth), 0);
  assert.equal(sumServiceJobIncome(undefined, ()=>true), 0);
  assert.equal(sumServiceJobIncome([null, undefined], ()=>true), 0);
});
