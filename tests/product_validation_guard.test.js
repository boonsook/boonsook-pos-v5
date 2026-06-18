// Phase 481 — product-save input validation (audit §S4 dup barcode/SKU warn, §S5 bundle qty NaN)
// Run: node --test tests/product_validation_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findDuplicateProduct, normalizeBundleQty } from "../modules/product_validation.js";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function saveProductBody(src) {
  const a = src.indexOf("async function saveProduct(");
  assert.ok(a >= 0, "saveProduct exists");
  const b = src.indexOf("const CUSTOMER_TAG_PRESETS", a);
  return src.slice(a, b);
}

const PRODUCTS = [
  { id: 1, name: "ตู้เย็น A", sku: "RF-001", barcode: "885000001" },
  { id: 2, name: "ตู้เย็น B", sku: "RF-002", barcode: "885000002" },
  { id: 3, name: "บริการล้างแอร์", sku: "SVC-XYZ", barcode: "" },
];

// ── S5: findDuplicateProduct ───────────────────────────────────────────────────
test("dup barcode against another product is reported", () => {
  const d = findDuplicateProduct(PRODUCTS, { sku: "NEW", barcode: "885000002" }, null);
  assert.equal(d.field, "barcode");
  assert.equal(d.product.id, 2);
});

test("dup SKU against another product is reported", () => {
  const d = findDuplicateProduct(PRODUCTS, { sku: "RF-001", barcode: "" }, null);
  assert.equal(d.field, "sku");
  assert.equal(d.product.id, 1);
});

test("barcode collision wins over SKU collision (POS scans barcode)", () => {
  const d = findDuplicateProduct(PRODUCTS, { sku: "RF-001", barcode: "885000002" }, null);
  assert.equal(d.field, "barcode", "barcode is checked first");
});

test("editing a product never warns about itself (excludeId)", () => {
  const d = findDuplicateProduct(PRODUCTS, { sku: "RF-001", barcode: "885000001" }, 1);
  assert.equal(d, null);
});

test("empty / whitespace barcode and SKU are ignored (no false dup)", () => {
  assert.equal(findDuplicateProduct(PRODUCTS, { sku: "  ", barcode: "" }, null), null);
  assert.equal(findDuplicateProduct(PRODUCTS, { sku: "RF-999", barcode: "   " }, null), null);
});

test("whitespace-trimmed match still collides", () => {
  const d = findDuplicateProduct(PRODUCTS, { barcode: " 885000001 " }, null);
  assert.equal(d.product.id, 1);
});

test("non-array products → null (defensive)", () => {
  assert.equal(findDuplicateProduct(null, { barcode: "x" }, null), null);
});

// ── S4: normalizeBundleQty ─────────────────────────────────────────────────────
test("normalizeBundleQty: valid positive number kept", () => {
  assert.equal(normalizeBundleQty(3), 3);
  assert.equal(normalizeBundleQty("5"), 5);
});

test("normalizeBundleQty: NaN / non-numeric / 0 / negative → 1", () => {
  assert.equal(normalizeBundleQty("2ก"), 1);  // the audit's exact case
  assert.equal(normalizeBundleQty(NaN), 1);
  assert.equal(normalizeBundleQty(0), 1);
  assert.equal(normalizeBundleQty(-4), 1);
  assert.equal(normalizeBundleQty(""), 1);
  assert.equal(normalizeBundleQty(undefined), 1);
});

// ── source wiring in saveProduct + bundle form ─────────────────────────────────
test("saveProduct warns on dup barcode/SKU via App.confirm (allow-proceed), before the save", () => {
  const body = saveProductBody(main);
  assert.match(body, /findDuplicateProduct\(state\.products, \{ sku: payload\.sku, barcode: payload\.barcode \}, state\.editingProductId\)/, "looks up a duplicate excluding self");
  assert.match(body, /typeof window\.App\?\.confirm === "function"/, "uses App.confirm when available (no native confirm)");
  assert.match(body, /await window\.App\.confirm\([\s\S]*?\)\)\) return;/, "cancel → return (does not save)");
  // the dup check must come BEFORE the products write
  const dupIdx = body.indexOf("findDuplicateProduct");
  const postIdx = body.indexOf('xhrPost("products"');
  const patchIdx = body.indexOf('xhrPatch("products"');
  assert.ok(dupIdx > -1 && dupIdx < postIdx && dupIdx < patchIdx, "dup warn precedes the products insert/update");
  assert.ok(!/\balert\(/.test(body), "no native alert() in saveProduct");
});

test("bundle insert filters/normalizes qty (no NaN/0 into product_bundles)", () => {
  const body = saveProductBody(main);
  assert.match(body, /normalizeBundleQty\(it\.qty\)/, "each inserted bundle row normalizes qty");
  assert.match(body, /\.filter\(it => it && it\.product_id != null && it\.product_id !== ""\)/, "drops rows without a child product id");
});

test("bundle qty input handler and add-button reject/normalize non-numeric qty", () => {
  // input edit coerces (no NaN stored)
  assert.match(main, /items\[Number\(inp\.dataset\.idx\)\]\.qty = normalizeBundleQty\(inp\.value\)/, "qty input edit normalizes");
  // add button rejects non-finite (old `qty <= 0` let NaN through)
  assert.match(main, /if \(!Number\.isFinite\(_rawQty\) \|\| _rawQty <= 0\) return showToast/, "add button rejects NaN/≤0");
});
