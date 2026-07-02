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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isWebOrderServiceJob, isServiceIncomeJob, sumServiceJobIncome, serviceIncomeDate } from "../modules/dashboard.js";

const _dir = path.dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(path.join(_dir, "../modules/dashboard.js"), "utf8");

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

// ── Phase 553: serviceIncomeDate = closed_at (วันปิดงาน) ให้ตรง JV (auto_post.js:839) ──
const inMonthBySvcDate = m => j => serviceIncomeDate(j).slice(0,7) === m;
test("serviceIncomeDate = closed_at when present, else created_at, else ''", () => {
  assert.equal(serviceIncomeDate({ closed_at:"2026-07-02T03:00:00Z", created_at:"2026-06-05T03:00:00Z" }), "2026-07-02T03:00:00Z");
  assert.equal(serviceIncomeDate({ closed_at:null, created_at:"2026-06-05T03:00:00Z" }), "2026-06-05T03:00:00Z");
  assert.equal(serviceIncomeDate({}), "");
  assert.equal(serviceIncomeDate(null), "");
});
test("(a) closed this month + created last month → counts into closed month, not created month", () => {
  const j = job({ id:1, total_cost:500, created_at:"2026-06-05T03:00:00Z", closed_at:"2026-07-02T03:00:00Z" });
  assert.equal(sumServiceJobIncome([j], inMonthBySvcDate("2026-07")), 500); // นับเข้าเดือนปิด (ก.ค.)
  assert.equal(sumServiceJobIncome([j], inMonthBySvcDate("2026-06")), 0);   // ไม่นับเดือนสร้าง (มิ.ย.)
});
test("(b) created this month + closed next month → NOT counted this month", () => {
  const j = job({ id:1, total_cost:500, created_at:"2026-07-02T03:00:00Z", closed_at:"2026-08-01T03:00:00Z" });
  assert.equal(sumServiceJobIncome([j], inMonthBySvcDate("2026-07")), 0);   // ยังไม่รับรู้ (ปิด ส.ค.)
  assert.equal(sumServiceJobIncome([j], inMonthBySvcDate("2026-08")), 500);
});
test("(c) closed_at null → fallback created_at (งานเก่าก่อนมี closed_at ไม่หาย)", () => {
  const j = job({ id:1, total_cost:500, created_at:"2026-06-05T03:00:00Z", closed_at:null });
  assert.equal(sumServiceJobIncome([j], inMonthBySvcDate("2026-06")), 500);
});
test("(d) source: dashboard today/month service income use serviceIncomeDate, not j.created_at", () => {
  // today income
  assert.match(dashSrc, /todayServiceIncome\s*=\s*sumServiceJobIncome\(state\.serviceJobs,\s*j\s*=>\s*dateBkk\(serviceIncomeDate\(j\)\)\s*===\s*today\)/);
  // month income
  assert.match(dashSrc, /monthServiceIncome\s*=\s*sumServiceJobIncome\(state\.serviceJobs,\s*j\s*=>\s*dateBkk\(serviceIncomeDate\(j\)\)\.slice\(0,7\)\s*===\s*thisMonth\)/);
  // must NOT still date service income directly by created_at
  assert.ok(!/todayServiceIncome\s*=\s*sumServiceJobIncome\(state\.serviceJobs,\s*j\s*=>\s*dateBkk\(j\.created_at\)/.test(dashSrc), "todayServiceIncome must not use j.created_at directly");
  assert.ok(!/monthServiceIncome\s*=\s*sumServiceJobIncome\(state\.serviceJobs,\s*j\s*=>\s*dateBkk\(j\.created_at\)/.test(dashSrc), "monthServiceIncome must not use j.created_at directly");
});
