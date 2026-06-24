import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const productsSource = fs.readFileSync("modules/products.js", "utf8");
const mainSource = fs.readFileSync("main.js", "utf8");

test("inventory search refresh keeps the search input focused", () => {
  assert.match(productsSource, /function renderView\(ctx,\s*opts\s*=\s*\{\}\)/);
  // Phase 524: search ค้นเมื่อ Enter/blur — focus-restore ส่งผ่าน ternary renderView(ctx, refocus ? { focusSearch: true } : {})
  assert.match(productsSource, /renderView\(ctx,[^)]*focusSearch:\s*true/);
  assert.match(productsSource, /if\s*\(\s*opts\.focusSearch\s*\)[\s\S]*?#prodSearchInput[\s\S]*?\.focus\(\)/);
});

test("inventory refresh can rerender the current view without resetting filters", () => {
  assert.match(productsSource, /let _lastProductsCtx\s*=\s*null/);
  assert.match(productsSource, /export function refreshProductsPage\(\)[\s\S]*?renderView\(_lastProductsCtx\)/);
  assert.match(mainSource, /import\s*\{\s*renderProductsPage,\s*refreshProductsPage\s*\}\s*from "\.\/modules\/products\.js"/);
  assert.match(mainSource, /state\.currentRoute\s*===\s*"products"\s*&&\s*refreshProductsPage\(\)/);
});

test("saving and adding products preserves the active inventory category", () => {
  assert.match(mainSource, /if\s*\(!refreshProductsPage\(\)\)\s*showRoute\("products"\)/);
  assert.match(productsSource, /if\s*\(\s*currentCategory\s*!==\s*"all"\s*\)\s*opts\.prefillCategory\s*=\s*currentCategory/);
});
