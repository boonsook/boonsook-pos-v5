// Phase 582 — sales-ranking-full-fetch (top_customers + profit_by_product)
//
// Why: 2 หน้ารายงานจัดอันดับอ่านจาก state.sales cap 50 (loadAllData) → ranking/ยอดเพี้ยน
// เมื่อร้านมี >50 บิลในช่วง. top_customers (อันดับลูกค้า + totalRevenue/top5) + profit_by_product
// (กำไรรายสินค้า). แก้: ดึงยอดขายช่วงจริงผ่าน fetchSalesSince (mirror profit_report:74) — fallback
// state + ป้าย เมื่อ fetch ล้ม; client-side date filter เดิมคง exact bound. READ-ONLY.
// Run: node --test tests/sales_ranking_fetch_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const tc = fs.readFileSync(path.resolve("modules/top_customers.js"), "utf8");
const pp = fs.readFileSync(path.resolve("modules/profit_by_product.js"), "utf8");

// ═══ (1) import fetchSalesSince ═══
test("ทั้งสองหน้า import fetchSalesSince จาก sales_fetch.js", () => {
  assert.match(tc, /import \{ fetchSalesSince \} from "\.\/sales_fetch\.js"/, "top_customers import");
  assert.match(pp, /import \{ fetchSalesSince \} from "\.\/sales_fetch\.js"/, "profit_by_product import");
});

// ═══ (2) ranking อ่าน fetched rows (ไม่ใช่ state.sales cap ตรง ๆ) + fallback state เมื่อ fail (ไม่เงียบ) ═══
test("top_customers: sales จาก fetchSalesSince(cutoffKey), fallback state.sales เมื่อ fail + ป้าย (ไม่เงียบ)", () => {
  assert.match(tc, /const _salesRes = await fetchSalesSince\(cutoffKey\)/, "fetch ตาม cutoff ของหน้า");
  assert.match(tc, /_salesFetchOk \? _salesRes\.rows : \(state\.sales \|\| \[\]\)/, "fail → fallback state.sales");
  assert.match(tc, /if \(!_salesFetchOk\) showToast/, "fail → toast เตือน (ไม่เงียบ)");
  assert.match(tc, /_salesFetchOk \? "" : `<div[\s\S]{0,200}~50 บิลล่าสุด/, "fail → ป้าย ⚠️ ในผลลัพธ์");
  // aggregate ต้องอ่านจากตัวแปร sales (fetched-or-fallback) — ไม่ reduce ตรงจาก state.sales
  assert.ok(!/state\.sales\s*\.\s*(reduce|filter\([^)]*=>\s*[^)]*total_amount)/.test(tc), "ranking ต้องไม่ reduce ตรงจาก state.sales cap");
});

test("profit_by_product: sales จาก fetchSalesSince(cutoffKey), fallback state.sales เมื่อ fail + ป้าย", () => {
  assert.match(pp, /const _salesRes = await fetchSalesSince\(cutoffKey\)/, "fetch ตาม cutoff");
  assert.match(pp, /_salesOk \? _salesRes\.rows : \(state\.sales \|\| \[\]\)/, "fail → fallback state.sales");
  assert.match(pp, /_ppRenderBody\(ctx, container, res\.rows, validSaleIds, _salesOk\)/, "ส่ง _salesOk เข้า render");
  assert.match(pp, /salesFetchOk \? "" : `<div[\s\S]{0,200}~50 บิลล่าสุด/, "fail → ป้าย ⚠️ ในผลลัพธ์");
});

// ═══ (3) role filter (visibleSalesForRole) ยังครอบ fetched rows ═══
test("role filter (visibleSalesForRole) ยังครอบ fetched rows ทั้งสองหน้า (ไม่หลุด non-admin isolation)", () => {
  assert.match(tc, /visibleSalesForRole\(_salesFetchOk \? _salesRes\.rows : \(state\.sales \|\| \[\]\), state\.profile, state\.currentUser\)/,
    "top_customers: role-filter ครอบ fetched-or-fallback");
  assert.match(pp, /visibleSalesForRole\(_salesOk \? _salesRes\.rows : \(state\.sales \|\| \[\]\), state\.profile, state\.currentUser\)/,
    "profit_by_product: role-filter ครอบ fetched-or-fallback");
});

// ═══ (4) client-side date filter (exact bound) ยังคงไว้ — helper buffer -2 วันเป็น superset เท่านั้น ═══
test("client-side date filter (cutoffKey) ยังคงไว้ทั้งสองหน้า (exact bound)", () => {
  assert.match(tc, /\.filter\(s => !cutoffKey \|\| String\(s\.created_at \|\| ""\)\.slice\(0, 10\) >= cutoffKey\)/, "top_customers exact bound");
  assert.match(pp, /\.filter\(s => !cutoffKey \|\| String\(s\.created_at \|\| ""\)\.slice\(0,10\) >= cutoffKey\)/, "profit_by_product exact bound");
});

// ═══ (5) ไม่แตะ fetchSaleItemsForSaleIds (คงเดิม) ═══
test("fetchSaleItemsForSaleIds logic คงเดิม (ไม่แตะ)", () => {
  assert.match(tc, /await fetchSaleItemsForSaleIds\(sales\.map\(s => s\.id\)\)/, "top_customers sale_items คงเดิม");
  assert.match(pp, /await fetchSaleItemsForSaleIds\(\[\.\.\.validSaleIds\]\)/, "profit_by_product sale_items คงเดิม");
});
