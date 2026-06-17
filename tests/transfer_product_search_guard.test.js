// Phase 460 — warehouse-transfer product picker shows a CLICKABLE search results list (build 460)
// Run: node --test tests/transfer_product_search_guard.test.js
//
// Why this exists:
//   modules/stock_movements.js renders the "ย้ายสต็อกระหว่างคลัง" modal whose
//   product picker lists ~1000 stock products. Phase 460 replaces the old
//   filter-the-<select> behavior with a search input (#smt-product-search) that
//   renders matching products as a clickable results list (#smt-product-results);
//   clicking a row sets the value on a HIDDEN <select id="smt-product-select">
//   that stays the value-holder (full options) for the submit + from-stock reads.
//   This is a UI-only change: it MUST NOT call _transferWarehouseStock, fetch,
//   XHR, or any stock write, and MUST preserve the #smt-product-select id and its
//   .value submit contract. These guards lock those invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");

// Extract the body of a named function so write/fetch checks are scoped to the
// new search function, not the whole file (the file legitimately contains the
// transfer save flow that calls _appTransferWarehouseStock elsewhere).
function extractFn(name) {
  // matches both `function name(` and `const name = (...) => {` declarations
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) start = src.indexOf(`${name} = (`);
  assert.ok(start !== -1, `function ${name} must exist`);
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

const fnBody = extractFn("renderTransferSearchResults");

// ── the search input + results container exist in the modal markup ────────────
test("modal has #smt-product-search, #smt-product-selected and #smt-product-results", () => {
  assert.match(src, /id="smt-product-search"/, "search input #smt-product-search must exist");
  assert.match(src, /id="smt-product-selected"/, "selected-product display #smt-product-selected must exist");
  assert.match(src, /id="smt-product-results"/, "results list #smt-product-results must exist");
  // the results container starts hidden
  assert.match(src, /id="smt-product-results"[^>]*display:none/, "results list must start hidden (display:none)");
});

// ── the hidden <select> stays the value-holder WITH ALL its options ───────────
test("#smt-product-select is hidden but keeps its full (unfiltered) option list", () => {
  assert.match(src, /id="smt-product-select"\s+style="display:none"/, "#smt-product-select must be hidden (display:none)");
  // it still renders ALL stock options inline (the value-holder is not narrowed by search)
  assert.match(
    src,
    /id="smt-product-select"[\s\S]*?\$\{\(state\.products \|\| \[\]\)\.filter\(p => p\.product_type !== 'service' && p\.product_type !== 'non_stock'\)\.map\(p => `<option value="\$\{escHtml\(p\.id\)\}">/,
    "#smt-product-select must keep ALL stock options inline (value-holder, not rebuilt by search)"
  );
  // the new search function must NOT rebuild the select's options anymore
  assert.ok(
    !/getElementById\(["']smt-product-select["']\)/.test(fnBody),
    "renderTransferSearchResults must NOT touch #smt-product-select (it only renders the results list)"
  );
});

// ── the search function filters by name / category / sku / barcode + caps ─────
test("renderTransferSearchResults filters by name, category, sku, barcode and caps results", () => {
  assert.match(fnBody, /p\.name/, "must match on p.name");
  assert.match(fnBody, /p\.category/, "must match on p.category");
  assert.match(fnBody, /p\.sku/, "must match on p.sku");
  assert.match(fnBody, /p\.barcode/, "must match on p.barcode");
  // excludes service / non_stock items like the original inline list
  assert.match(fnBody, /product_type\s*!==\s*'service'/, "must exclude service products");
  assert.match(fnBody, /product_type\s*!==\s*'non_stock'/, "must exclude non_stock products");
  // caps the rendered rows
  assert.match(fnBody, /\.slice\(0,\s*30\)/, "must cap matches to first 30");
  // empty query hides the list; zero matches shows a 'not found' row
  assert.match(fnBody, /if\s*\(!q\)/, "empty query must early-return (hide list)");
  assert.match(fnBody, /ไม่พบสินค้า/, "zero matches must render a 'ไม่พบสินค้า' row");
});

// ── results render as clickable rows carrying data-pid ────────────────────────
test("renderTransferSearchResults renders clickable .smt-result-row rows with data-pid", () => {
  assert.match(fnBody, /class="smt-result-row"/, "rows must carry the smt-result-row class");
  assert.match(fnBody, /data-pid="\$\{escHtml\(String\(p\.id\)\)\}"/, "rows must carry escaped data-pid");
  assert.match(fnBody, /<button type="button"/, "rows must be <button type=button> (no submit)");
  assert.match(fnBody, /results\.style\.display\s*=\s*'block'/, "non-empty results must be shown (display:block)");
});

// ── every DB-derived value rendered into HTML is escaped ──────────────────────
test("renderTransferSearchResults escapes id, name, category, barcode, sku via escHtml", () => {
  assert.match(fnBody, /escHtml\(String\(p\.id\)\)/, "product id must be escHtml'd");
  assert.match(fnBody, /escHtml\(p\.name/, "product name must be escHtml'd");
  assert.match(fnBody, /escHtml\(p\.category/, "category must be escHtml'd");
  assert.match(fnBody, /escHtml\(p\.barcode\)/, "barcode must be escHtml'd");
  assert.match(fnBody, /escHtml\(p\.sku\)/, "sku must be escHtml'd");
});

// ── the search input is wired via oninput → renderTransferSearchResults ───────
test("search input is wired to renderTransferSearchResults via oninput", () => {
  assert.match(
    src,
    /getElementById\(["']smt-product-search["']\)/,
    "wiring must look up #smt-product-search"
  );
  assert.match(
    src,
    /\$smtSearch\.oninput\s*=\s*\(e\)\s*=>\s*renderTransferSearchResults\(e\.target\.value\)/,
    "oninput must call renderTransferSearchResults(e.target.value)"
  );
});

// ── clicking a result row selects the product (value-holder + change + label) ─
test("result-row click sets #smt-product-select.value, dispatches change, sets selected label", () => {
  // delegation lives on the results container
  assert.match(src, /\$smtResults\.onclick\s*=/, "must delegate click on #smt-product-results");
  assert.match(src, /closest\(["']\.smt-result-row["']\)/, "must resolve the clicked .smt-result-row");
  assert.match(src, /getAttribute\(["']data-pid["']\)/, "must read data-pid from the row");
  assert.match(src, /sel\.value\s*=\s*pid/, "must set the hidden select's value to the row pid");
  assert.match(
    src,
    /sel\.dispatchEvent\(new Event\(["']change["'],\s*\{\s*bubbles:\s*true\s*\}\)\)/,
    "must dispatch a bubbling change event (fires updateTransferFromStock)"
  );
  assert.match(src, /getElementById\(["']smt-product-selected["']\)/, "must set the selected-product label");
  assert.match(src, /["']✓ ["']\s*\+/, "selected label must be prefixed with a checkmark");
});

// ── selecting a product still triggers the from-stock refresh (onchange) ──────
test("#smt-product-select onchange still calls updateTransferFromStock", () => {
  assert.match(
    src,
    /\$smtProd\.onchange\s*=\s*updateTransferFromStock/,
    "the hidden select's change must refresh the from-warehouse stock display"
  );
});

// ── closeTransferModal resets search + select + selected label + results ──────
test("closeTransferModal resets the search input, hidden select, selected label and results", () => {
  assert.match(src, /["']smt-product-search["']\s*,\s*["']smt-product-select["']/,
    "smt-product-search + smt-product-select must be in the close-modal reset list");
  // closeTransferModal clears the selected-product label + hides the results list
  const closeBody = extractFn("closeTransferModal");
  assert.match(closeBody, /smt-product-selected/, "close must reference #smt-product-selected");
  assert.match(closeBody, /selLbl\.textContent\s*=\s*''/, "close must clear the selected label's textContent");
  assert.match(closeBody, /smt-product-results/, "close must reference #smt-product-results");
  assert.match(closeBody, /results\.style\.display\s*=\s*'none'/, "close must hide #smt-product-results");
});

// ── UI-ONLY: the search render performs no stock write / network call ─────────
test("renderTransferSearchResults performs NO stock write, fetch, XHR, or HTTP mutation", () => {
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
