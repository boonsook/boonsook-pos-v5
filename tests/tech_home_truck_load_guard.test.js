// Phase 550 (+review) — tech_home morning-load + backlog buckets behavioral guard
// Run: node --test tests/tech_home_truck_load_guard.test.js
//
// serviceJobBuckets: today (scheduled=today) / tomorrow / backlog (scheduled<today หรือไม่มีวันนัด, ยัง open)
// truckLoadPlan(jobsForLoad=วันนี้+ค้าง): รวม items_json ต่อรถ is_mobile → เทียบ warehouse_stock →
//   need (ต้องเบิก) · remain (คงเหลือในรถ) · status สี. คืน **ทุกคัน is_mobile เสมอ** (คันขาว+คันแดง).
//   pure functions อ่านอย่างเดียว — ไม่แตะ DOM/DB/write/state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { truckLoadPlan, serviceJobBuckets } from "../modules/tech_home.js";

const WAREHOUSES = [
  { id: 1, name: "คลังในร้าน", is_mobile: false },
  { id: 3, name: "คลังสินค้า (รถคันขาว)", is_mobile: true },
  { id: 4, name: "คลังสินค้า (รถคันแดง)", is_mobile: true },
];
const PRODUCTS = [{ id: 10, name: "น้ำยา R32" }, { id: 11, name: "ท่อทองแดง" }, { id: 12, name: "เบรกเกอร์" }];
const TODAY = "2026-07-02", TOMORROW = "2026-07-03", YDAY = "2026-07-01";
const item = (pid, wid, wname, qty) => ({ product_id: pid, name: PRODUCTS.find(p => p.id === pid)?.name, warehouse_id: wid, warehouse_name: wname, qty });

// ── AC#1/#2: งานเก่า pending (นัดเมื่อวาน) + งานไม่มีวันนัด = "งานค้าง" (ไม่หายแม้วันนี้ไม่มีคิว) ──
test("serviceJobBuckets แยก today/tomorrow/backlog — งานค้างต้องจับ (นัดก่อนวันนี้ + ไม่มีวันนัด)", () => {
  const jobs = [
    { id: 1, status: "pending", scheduled_date: YDAY },        // นัดเมื่อวาน ยัง pending → backlog
    { id: 2, status: "progress", scheduled_date: null },        // ไม่มีวันนัด ยัง progress → backlog
    { id: 3, status: "pending", scheduled_date: TODAY },        // วันนี้
    { id: 4, status: "pending", scheduled_date: TOMORROW },     // พรุ่งนี้
    { id: 5, status: "delivered", scheduled_date: YDAY },       // ปิดแล้ว → ไม่นับ (ไม่ open)
    { id: 6, status: "cancelled", scheduled_date: null },       // ยกเลิก → ไม่นับ
    { id: 7, status: "pending", scheduled_date: YDAY, note: "[ลบแล้ว]" }, // soft-deleted → ไม่นับ
  ];
  const b = serviceJobBuckets(jobs, TODAY, TOMORROW);
  assert.deepEqual(b.backlog.map(j => j.id).sort(), [1, 2], "backlog = นัดก่อนวันนี้ + ไม่มีวันนัด (ยัง open)");
  assert.deepEqual(b.today.map(j => j.id), [3]);
  assert.deepEqual(b.tomorrow.map(j => j.id), [4]);
});

test("วันนี้ไม่มีคิว แต่มีงานค้าง → today ว่าง แต่ backlog ไม่ว่าง (ไม่โชว์เหมือน 0 ทั้งหมด)", () => {
  const jobs = [{ id: 1, status: "pending", scheduled_date: YDAY }, { id: 2, status: "progress", scheduled_date: null }];
  const b = serviceJobBuckets(jobs, TODAY, TOMORROW);
  assert.equal(b.today.length, 0);
  assert.equal(b.backlog.length, 2, "งานค้างยังแสดง");
});

// ── AC#3/#4: อุปกรณ์ต้องเบิกจาก active (วันนี้+ค้าง) ต่อรถ + เทียบ stock + ทั้ง 2 คัน ──
test("truckLoadPlan รวม items ของ jobsForLoad ต่อรถ + เทียบ stock → need/remain/status; คืนทั้ง 2 คันเสมอ", () => {
  const jobsForLoad = [
    { id: 3, status: "pending", scheduled_date: TODAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 2), item(11, 3, "คลังสินค้า (รถคันขาว)", 5)] },
    { id: 1, status: "pending", scheduled_date: YDAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 1)] }, // งานค้าง — น้ำยารวม=3
    { id: 2, status: "progress", scheduled_date: null, items_json: [item(12, 4, "คลังสินค้า (รถคันแดง)", 1)] },
    { id: 9, status: "pending", scheduled_date: TODAY, items_json: [item(10, 1, "คลังในร้าน", 9)] }, // ไม่ใช่รถ → ข้าม
  ];
  const stock = [
    { warehouse_id: 3, product_id: 10, stock: 0 },   // น้ำยา คันขาว: ต้องเบิก 3 · เหลือ 0 → ของหมด
    { warehouse_id: 3, product_id: 11, stock: 4 },   // ท่อ คันขาว: ต้องเบิก 5 · เหลือ 4 → ไม่พอ
    { warehouse_id: 4, product_id: 12, stock: 10 },  // เบรกเกอร์ คันแดง: ต้องเบิก 1 · เหลือ 10 → เบิกได้
  ];
  const plan = truckLoadPlan(jobsForLoad, WAREHOUSES, stock, PRODUCTS);
  assert.equal(plan.length, 2, "คืนทั้ง 2 คัน is_mobile เสมอ (คันขาว+คันแดง)");
  const kao = plan.find(t => t.name.includes("ขาว"));
  const namyaa = kao.items.find(i => i.name === "น้ำยา R32");
  assert.equal(namyaa.need, 3, "น้ำยารวมวันนี้+ค้าง = 3");
  assert.equal(namyaa.remain, 0); assert.equal(namyaa.status, "out"); assert.equal(namyaa.label, "ของหมด");
  const tor = kao.items.find(i => i.name === "ท่อทองแดง");
  assert.equal(tor.status, "out"); assert.equal(tor.label, "ไม่พอ");   // 4 < 5
  const daeng = plan.find(t => t.name.includes("แดง"));
  assert.equal(daeng.items[0].status, "ok");   // 10 > 1+2
});

test("ไม่มีของต้องเบิก → ยังคืนทั้ง 2 คัน (items ว่าง) ให้ UI โชว์ทั้งคันขาว/คันแดง", () => {
  const plan = truckLoadPlan([], WAREHOUSES, [], PRODUCTS);
  assert.equal(plan.length, 2);
  assert.ok(plan.every(t => t.items.length === 0));
  assert.ok(plan.some(t => t.name.includes("ขาว")) && plan.some(t => t.name.includes("แดง")));
});

test("truckLoadPlan ไม่ mutate input (jobsForLoad/items_json คงเดิม)", () => {
  const jobs = [{ id: 3, status: "pending", scheduled_date: TODAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 2)] }];
  const snap = JSON.stringify(jobs);
  truckLoadPlan(jobs, WAREHOUSES, [], PRODUCTS);
  assert.equal(JSON.stringify(jobs), snap, "input ไม่ถูกแก้");
});
