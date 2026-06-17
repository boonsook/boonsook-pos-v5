// Phase 459 — searchable product picker in the warehouse-transfer modal (build 459)
// Run: node --test tests/transfer_product_search_guard.test.js
//
// Why this exists:
//   modules/stock_movements.js renders the "ย้ายสต็อกระหว่างคลัง" modal whose
//   product picker (#smt-product-select) lists ~1000 stock products in a plain
//   <select> — impossible to scroll/find. Phase 459 adds a search input
//   (#smt-product-search) that filters the select's <option>s CLIENT-SIDE only.
//   This is a UI-only change: it MUST NOT call _transferWarehouseStock, fetch,
//   XHR, or any stock write, and MUST preserve the #smt-product-select id and
//   its .value submit contract. These guards lock those invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");

// Extract the body of filterTransferProducts(...) so write/fetch checks are scoped
// to the new function, not the whole file (the file legitimately contains the
// transfer save flow that calls _appTransferWarehouseStock elsewhere).
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist`);
  // walk braces from the first { after the signature
  const open = src.indexOf("{", start);
  assert.ok(open !== -1, `function ${name} must have a body`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const fnBody = extractFn("filterTransferProducts");

// ── the search input exists in the modal markup ───────────────────────────────
test("modal has a #smt-product-search input above the product select", () => {
  assert.match(src, /id="smt-product-search"/, "search input #smt-product-search must exist");
  // it sits above the product select in source order
  const searchIdx = src.indexOf('id="smt-product-search"');
  const selectIdx = src.indexOf('id="smt-product-select"');
  assert.ok(searchIdx !== -1 && selectIdx !== -1, "both ids must be present");
  assert.ok(searchIdx < selectIdx, "search input must appear before the product select");
});

// ── the filter function searches by name / category / sku / barcode ───────────
test("filterTransferProducts filters by name, category, sku and barcode", () => {
  assert.match(fnBody, /p\.name/, "must match on p.name");
  assert.match(fnBody, /p\.category/, "must match on p.category");
  assert.match(fnBody, /p\.sku/, "must match on p.sku");
  assert.match(fnBody, /p\.barcode/, "must match on p.barcode");
  // excludes service / non_stock items like the original inline list
  assert.match(fnBody, /product_type\s*!==\s*'service'/, "must exclude service products");
  assert.match(fnBody, /product_type\s*!==\s*'non_stock'/, "must exclude non_stock products");
});

// ── it rebuilds the SAME select, preserves selection, refreshes from-stock ────
test("filterTransferProducts rebuilds #smt-product-select, preserves selection, refreshes from-stock", () => {
  assert.match(fnBody, /getElementById\(["']smt-product-select["']\)/, "must target #smt-product-select");
  assert.match(fnBody, /\.innerHTML\s*=/, "must rebuild the select options via innerHTML");
  assert.match(fnBody, /-- เลือกสินค้า --/, "must keep the placeholder option");
  assert.match(fnBody, /const prev = sel\.value/, "must capture previous selection (prev)");
  assert.match(fnBody, /sel\.value = prev/, "must restore prev when it still matches");
  assert.match(fnBody, /updateTransferFromStock\(\)/, "must refresh the from-stock display after rebuild");
});

// ── every DB-derived value rendered into HTML is escaped ──────────────────────
test("filterTransferProducts escapes product id and name via escHtml", () => {
  assert.match(fnBody, /escHtml\(String\(p\.id\)\)/, "product id must be escHtml'd");
  assert.match(fnBody, /escHtml\(p\.name/, "product name must be escHtml'd");
});

// ── the search input is wired via oninput ─────────────────────────────────────
test("search input is wired to filterTransferProducts via oninput", () => {
  assert.match(
    src,
    /getElementById\(["']smt-product-search["']\)/,
    "wiring must look up #smt-product-search"
  );
  assert.match(
    src,
    /\$smtSearch\.oninput\s*=\s*\(e\)\s*=>\s*filterTransferProducts\(e\.target\.value\)/,
    "oninput must call filterTransferProducts(e.target.value)"
  );
});

// ── closeTransferModal clears the search input (resets to full list) ──────────
test("closeTransferModal resets the search input id", () => {
  assert.match(src, /["']smt-product-search["']\s*,\s*["']smt-product-select["']/,
    "smt-product-search must be in the close-modal reset list, before the select");
});

// ── UI-ONLY: the filter performs no stock write / network call ────────────────
test("filterTransferProducts performs NO stock write, fetch, XHR, or HTTP mutation", () => {
  assert.ok(!/_transferWarehouseStock/.test(fnBody), "must not call _transferWarehouseStock");
  assert.ok(!/_appTransferWarehouseStock/.test(fnBody), "must not call _appTransferWarehouseStock");
  assert.ok(!/_appApplyStockMovement/.test(fnBody), "must not call _appApplyStockMovement");
  assert.ok(!/\bfetch\s*\(/.test(fnBody), "must not call fetch()");
  assert.ok(!/XMLHttpRequest/.test(fnBody), "must not use XMLHttpRequest");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete/.test(fnBody), "must not call xhr mutation helpers");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(fnBody), "must not call supabase insert/update/delete/upsert");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"DELETE"', "'DELETE'", '"PUT"', "'PUT'"]) {
    assert.ok(!fnBody.includes(verb), `must not reference HTTP write method ${verb}`);
  }
});

// ── contract preserved: submit still reads #smt-product-select .value ─────────
test("submit handler still reads #smt-product-select value (contract intact)", () => {
  assert.match(
    src,
    /getElementById\(["']smt-product-select["']\)\?\.value/,
    "save handler must still read the selected product id from #smt-product-select"
  );
});
