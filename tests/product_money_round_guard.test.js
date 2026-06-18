// Phase 484 (audit NIT) — saveProduct rounds money fields to 2 decimals.
// Run: node --test tests/product_money_round_guard.test.js
//
// The POS inline price edit already round2()s the saved price; saveProduct stored price/cost
// raw (Number) → float drift + inconsistency between the two write paths. This locks that
// saveProduct rounds every money field (price/cost/wholesale/promo) via the shared round2 helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function saveProductBody(src) {
  const a = src.indexOf("async function saveProduct(");
  assert.ok(a >= 0, "saveProduct exists");
  const b = src.indexOf("const CUSTOMER_TAG_PRESETS", a);
  return src.slice(a, b);
}

test("main.js imports round2 from utils", () => {
  assert.match(main, /import \{[^}]*\bround2\b[^}]*\} from "\.\/modules\/utils\.js"/, "round2 imported");
});

test("saveProduct rounds price / cost / wholesale / promo to 2dp (matches inline POS edit)", () => {
  const body = saveProductBody(main);
  assert.match(body, /price:round2\(_n0\(\$\("newProductPrice"\)\.value\)\)/, "price is round2'd");
  assert.match(body, /cost:round2\(_n0\(\$\("newProductCost"\)\.value\)\)/, "cost is round2'd");
  assert.match(body, /const wholesale = round2\(/, "wholesale is round2'd");
  assert.match(body, /const promoPrice = round2\(/, "promo price is round2'd");
});
