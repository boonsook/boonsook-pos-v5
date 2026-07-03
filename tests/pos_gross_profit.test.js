// Phase 398 — write sales.gross_profit at checkout (money write-path, §4.1)
// Run: node --test tests/pos_gross_profit.test.js
//
// Why this exists:
//   The dashboard "กำไรขั้นต้น" KPI reads sales.gross_profit, a column the app never wrote
//   (always ฿0). Phase 398 computes it at checkout = subtotal(ex-VAT) − Σ(cost×qty) from the
//   cost POS already keeps (products.cost = sale_items.unit_cost). It must NOT inflate profit
//   (empty cart / quick-pay → null) and MUST NOT break checkout (column-missing fallback).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _computeGrossProfit } from "../modules/pos.js";

const src = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

// ── pure formula ──────────────────────────────────────────────────────────────
test("gross profit = subtotal − Σ(cost × qty)", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 2, price: 100 }], [{ id: 1, cost: 60 }], 200), 80);
});

test("empty cart / quick-pay → null (never inflate profit)", () => {
  assert.equal(_computeGrossProfit([], [{ id: 1, cost: 60 }], 200), null);
  assert.equal(_computeGrossProfit(null, [], 100), null);
  assert.equal(_computeGrossProfit(undefined, undefined, 100), null);
});

test("product with no cost (or not found) → cost 0 → gross = subtotal", () => {
  assert.equal(_computeGrossProfit([{ id: 9, qty: 1 }], [{ id: 9 }], 100), 100);
  assert.equal(_computeGrossProfit([{ id: 9, qty: 1 }], [], 100), 100);
});

test("VAT exclusive: ex-VAT subtotal 100, cost 60 → 40", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 1, price: 100 }], [{ id: 1, cost: 60 }], 100), 40);
});

test("rounds to 2 decimals (no float drift into DB)", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 3, price: 0.1 }], [{ id: 1, cost: 0 }], 0.3), 0.3);
});

// ── checkout wiring (source guard) ────────────────────────────────────────────
test("doCheckout writes gross_profit and has a column-missing fallback", () => {
  assert.match(src, /gross_profit:\s*_grossProfit/, "salePayload includes gross_profit");
  // Phase 555: ส่ง state.bundleRecipes เพื่อคิด COGS bundle จาก children (ไม่ใช่ parent cost)
  assert.match(src, /_computeGrossProfit\(state\.cart, state\.products, _saleSubtotal, state\.bundleRecipes\)/, "computed from cart/products/subtotal + bundleRecipes");
  // Phase 520: fallback broadened to also strip checkout_key/credit_used_amount on column-missing
  assert.match(src, /gross_profit:\s*_gp,[\s\S]*?\.\.\.legacy/, "fallback strips gross_profit before retry");
  assert.match(src, /\/column\|gross_profit[^/]*\/i\.test\(saleRes\.error/, "fallback triggers on a column error");
});

// ── Phase 555 (audit S12): bundle COGS = Σ children cost, ไม่ใช่ parent cost ──────
const bundleProducts = [
  { id: 10, is_bundle: true, cost: 0 },   // bundle แม่ cost=0 (เคสจริงที่ทำ KPI เพี้ยน)
  { id: 1, cost: 60 },                     // child A
  { id: 2, cost: 25 },                     // child B
];
const recipe = { "10": [{ child_product_id: 1, qty: 2 }, { child_product_id: 2, qty: 1 }] };

test("Phase 555: bundle COGS = Σ(child.cost × recipeQty × lineQty), ไม่ใช่ parent cost 0", () => {
  // ขาย bundle 1 ชุด: COGS = 60×2 + 25×1 = 145 ; subtotal 300 → gross = 155
  assert.equal(_computeGrossProfit([{ id: 10, qty: 1 }], bundleProducts, 300, recipe), 155);
});

test("Phase 555: bundle line qty ทวีคูณ children (2 ชุด → COGS ×2)", () => {
  // 2 ชุด: COGS = (60×2 + 25×1) × 2 = 290 ; subtotal 600 → gross = 310
  assert.equal(_computeGrossProfit([{ id: 10, qty: 2 }], bundleProducts, 600, recipe), 310);
});

test("Phase 555: bundle ไม่มี recipe → fallback parent cost (ไม่ regress พฤติกรรมเดิม)", () => {
  // ไม่ส่ง recipe → ใช้ parent cost 0 → gross = subtotal เต็ม (เท่าโค้ดเดิม)
  assert.equal(_computeGrossProfit([{ id: 10, qty: 1 }], bundleProducts, 300), 300);
  // ส่ง recipes ว่าง (bundle นี้ไม่มี key) → fallback เช่นกัน
  assert.equal(_computeGrossProfit([{ id: 10, qty: 1 }], bundleProducts, 300, {}), 300);
});

test("Phase 555: mixed cart — bundle + สินค้าเดี่ยว รวม COGS ถูกทั้งคู่", () => {
  // bundle(id10) 1 ชุด COGS 145 + เดี่ยว(id1) 1 ชิ้น cost 60 ; subtotal 400 → gross = 400−205 = 195
  assert.equal(_computeGrossProfit([{ id: 10, qty: 1 }, { id: 1, qty: 1 }], bundleProducts, 400, recipe), 195);
});

test("Phase 555: non-bundle product ไม่แตะ recipe (คิด parent cost ปกติ)", () => {
  // id1 ไม่ใช่ bundle แม้จะบังเอิญมี key "1" ใน recipes → ต้องใช้ cost เดี่ยว
  assert.equal(_computeGrossProfit([{ id: 1, qty: 2 }], bundleProducts, 200, { "1": [{ child_product_id: 2, qty: 5 }] }), 80);
});

test("Phase 555: source — loadAllData preloads state.bundleRecipes; compute expands via recipe", () => {
  const mainSrc = fs.readFileSync(path.resolve("main.js"), "utf8");
  assert.match(mainSrc, /product_bundles"\)\.select\("bundle_id,child_product_id,qty"\)/, "loads product_bundles at loadAllData");
  assert.match(mainSrc, /state\.bundleRecipes\s*=/, "builds state.bundleRecipes map");
  assert.match(src, /import \{ expandBundleForRevert \} from "\.\/bundle_revert\.js"/, "reuses pure expand helper");
  assert.match(src, /p\?\.is_bundle && bundleRecipes/, "bundle path guarded by is_bundle + recipe presence");
});

// ── must not alter the existing money formulas ────────────────────────────────
test("the existing subtotal/total/vat/change formulas are unchanged", () => {
  assert.match(src, /const _saleSubtotal = round2\(vatCalc\.enabled \? vatCalc\.subtotal : amount\)/, "subtotal value unchanged");
  assert.match(src, /total_amount:\s*round2\(actualTotal\)/, "total_amount unchanged");
  assert.match(src, /vat_amount:\s*round2\(vatCalc\.vat\)/, "vat unchanged");
  assert.match(src, /change_amount:\s*round2\(Math\.max/, "change unchanged");
});
