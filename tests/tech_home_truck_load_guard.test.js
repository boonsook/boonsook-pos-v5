// Phase 550 — tech_home morning-load (อุปกรณ์ต้องเบิกขึ้นรถวันนี้) behavioral guard
// Run: node --test tests/tech_home_truck_load_guard.test.js
//
// truckLoadPlan รวม items_json ของ "งานวันนี้" ต่อรถ (is_mobile) → เทียบ warehouse_stock →
//   need (งานยังไม่ปิด = ต้องเบิก) · used (ปิดวันนี้ = ใช้แล้ว) · remain (คงเหลือในรถ) · status สี.
//   pure function อ่านอย่างเดียว — ไม่แตะ DOM/DB/write.

import { test } from "node:test";
import assert from "node:assert/strict";
import { truckLoadPlan } from "../modules/tech_home.js";

const WAREHOUSES = [
  { id: 1, name: "คลังในร้าน", is_mobile: false },
  { id: 3, name: "คลังสินค้า (รถคันขาว)", is_mobile: true },
  { id: 4, name: "คลังสินค้า (รถคันแดง)", is_mobile: true },
];
const PRODUCTS = [{ id: 10, name: "น้ำยา R32" }, { id: 11, name: "ท่อทองแดง" }, { id: 12, name: "เบรกเกอร์" }];
const TODAY = "2026-07-01";
const item = (pid, wid, wname, qty) => ({ product_id: pid, name: PRODUCTS.find(p => p.id === pid)?.name, warehouse_id: wid, warehouse_name: wname, qty });

test("รวม items ของงานวันนี้ต่อรถ + เทียบ stock → need/remain/status", () => {
  const jobs = [
    // งานเปิดวันนี้ (คันขาว) — ต้องเบิก
    { id: 2, status: "pending", scheduled_date: TODAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 2), item(11, 3, "คลังสินค้า (รถคันขาว)", 5)] },
    { id: 1, status: "progress", scheduled_date: TODAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 1)] }, // น้ำยารวม = 3
    // งานเปิดวันนี้ (คันแดง)
    { id: 3, status: "pending", scheduled_date: TODAY, items_json: [item(12, 4, "คลังสินค้า (รถคันแดง)", 1)] },
  ];
  const stock = [
    { warehouse_id: 3, product_id: 10, stock: 0 },   // น้ำยา คันขาว: ต้องเบิก 3 · เหลือ 0 → ของหมด
    { warehouse_id: 3, product_id: 11, stock: 4 },   // ท่อ คันขาว: ต้องเบิก 5 · เหลือ 4 → ไม่พอ (out)
    { warehouse_id: 4, product_id: 12, stock: 10 },  // เบรกเกอร์ คันแดง: ต้องเบิก 1 · เหลือ 10 → เบิกได้
  ];
  const plan = truckLoadPlan(jobs, WAREHOUSES, stock, PRODUCTS, TODAY);
  assert.equal(plan.length, 2, "2 รถ (คันขาว+คันแดง)");
  const kao = plan.find(t => t.name.includes("ขาว"));
  const namyaa = kao.items.find(i => i.name === "น้ำยา R32");
  assert.equal(namyaa.need, 3, "น้ำยารวม 2 งาน = 3");
  assert.equal(namyaa.remain, 0);
  assert.equal(namyaa.status, "out");
  assert.equal(namyaa.label, "ของหมด");
  const tor = kao.items.find(i => i.name === "ท่อทองแดง");
  assert.equal(tor.status, "out"); assert.equal(tor.label, "ไม่พอ");   // 4 < 5
  const daeng = plan.find(t => t.name.includes("แดง"));
  assert.equal(daeng.items[0].status, "ok");   // 10 > 1+2
});

test("งานที่ปิดวันนี้ = used (ใช้แล้ว) ไม่นับ need; งานคนละวัน/ยกเลิก/ไม่ใช่รถ = ข้าม", () => {
  const jobs = [
    { id: 5, status: "delivered", scheduled_date: TODAY, items_json: [item(10, 3, "คลังสินค้า (รถคันขาว)", 2)] },   // ปิดวันนี้ = used
    { id: 6, status: "pending", scheduled_date: "2026-06-30", items_json: [item(11, 3, "คลังสินค้า (รถคันขาว)", 9)] }, // คนละวัน = ข้าม
    { id: 7, status: "cancelled", scheduled_date: TODAY, items_json: [item(12, 3, "คลังสินค้า (รถคันขาว)", 9)] },     // ยกเลิก = ข้าม
    { id: 8, status: "pending", scheduled_date: TODAY, items_json: [item(10, 1, "คลังในร้าน", 9)] },                 // ไม่ใช่รถ (is_mobile=false) = ข้าม
  ];
  const plan = truckLoadPlan(jobs, WAREHOUSES, [{ warehouse_id: 3, product_id: 10, stock: 5 }], PRODUCTS, TODAY);
  assert.equal(plan.length, 1, "เหลือคันขาวคันเดียว (จากงานปิดวันนี้)");
  const it = plan[0].items[0];
  assert.equal(it.used, 2, "งานปิดวันนี้ = used");
  assert.equal(it.need, 0, "ปิดแล้ว ไม่นับ need");
  assert.equal(it.status, "used");   // need=0 → เทา
});
