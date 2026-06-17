// Phase 456 — per-warehouse stock summary cards (build 456)
// Run: node --test tests/warehouse_summary_guard.test.js
//
// Why this exists:
//   หน้า "สินค้า / คลัง" (modules/products.js renderView) มีแถวการ์ดสรุปสต็อก
//   ต่อคลัง (Phase 456). มันเป็น READ-ONLY DISPLAY ล้วน: คำนวณจาก state ที่โหลด
//   ไว้แล้ว (state.warehouseStock) แล้ว render การ์ด + คลิกเพื่อสลับคลัง (เหมือน
//   dropdown เดิม). guard พวกนี้ล็อก invariant ว่า:
//     (1) คำนวณ _whSummary จาก state.warehouseStock โดยกรอง stock>0
//     (2) render การ์ด data-wh-card รวมการ์ด "all" (ทุกคลัง)
//     (3) wire click handler ที่ set selectedWarehouse + renderView
//     (4) ส่วนนี้ห้ามมี network write/read (fetch/XHR/POST/PATCH) — read-only

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

// ── compute: _whSummary derived from state.warehouseStock, filtered stock>0 ───
test("renderView computes _whSummary from state.warehouseStock filtering stock>0", () => {
  assert.match(src, /const\s+_whSummary\s*=/, "must declare _whSummary");
  // mapped over warehouses, reading state.warehouseStock
  assert.match(
    src,
    /_whSummary\s*=\s*\(warehouses\s*\|\|\s*\[\]\)\.map/,
    "_whSummary must be built by mapping over warehouses"
  );
  assert.match(
    src,
    /state\.warehouseStock\s*\|\|\s*\[\]\)\.forEach/,
    "_whSummary must iterate state.warehouseStock"
  );
  // only count entries with stock > 0
  assert.match(
    src,
    /Number\(s\.stock\s*\|\|\s*0\)\s*>\s*0/,
    "must filter to stock>0 when counting items/qty"
  );
  // grand totals for the "ทุกคลัง" card
  assert.match(src, /const\s+_whGrandItems\s*=/, "must declare _whGrandItems");
  assert.match(src, /const\s+_whGrandQty\s*=/, "must declare _whGrandQty");
});

// ── render: data-wh-card cards, including an 'all' card ───────────────────────
test("renderView renders data-wh-card cards including an 'all' card", () => {
  assert.match(src, /data-wh-card=/, "must render cards with data-wh-card attribute");
  // the grand-total card uses the literal id 'all'
  assert.match(src, /_whCard\('all'/, "must render an 'all' (ทุกคลัง) card first");
  // per-warehouse cards are mapped from _whSummary
  assert.match(
    src,
    /_whSummary\.map\(w\s*=>\s*_whCard\(/,
    "must render one card per warehouse from _whSummary"
  );
  // active highlight compares selectedWarehouse to the card id (string-safe)
  assert.match(
    src,
    /String\(selectedWarehouse\)\s*===\s*String\(w\.id\)/,
    "per-warehouse card must highlight active warehouse via String() compare"
  );
});

// ── wire: card click sets selectedWarehouse + re-renders (mirror dropdown) ────
test("renderView wires data-wh-card click → selectedWarehouse + renderView", () => {
  // delegation over the page element, one listener per card
  assert.match(
    src,
    /querySelectorAll\("\[data-wh-card\]"\)\.forEach\(/,
    "must attach click handlers to [data-wh-card] elements"
  );
  // the handler body must set selectedWarehouse from the card dataset and re-render
  const handler = src.match(
    /querySelectorAll\("\[data-wh-card\]"\)\.forEach\(c\s*=>\s*c\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\)\);/
  );
  assert.ok(handler, "click handler block must be present");
  const body = handler[1];
  assert.match(body, /selectedWarehouse\s*=\s*c\.dataset\.whCard/, "handler must set selectedWarehouse from c.dataset.whCard");
  assert.match(body, /currentPage\s*=\s*1/, "handler must reset currentPage to 1 (mirror dropdown)");
  assert.match(body, /renderView\(ctx\)/, "handler must call renderView(ctx)");
});

// ── read-only: the summary block performs no network call/mutation ───────────
test("warehouse summary block is read-only (no fetch / XHR / POST / PATCH)", () => {
  // Extract the summary card block (from the marker comment to the wh-selector marker).
  const start = src.indexOf("Per-warehouse summary cards");
  const end = src.indexOf("Warehouse Selector (FlowAccount style)");
  assert.ok(start !== -1 && end !== -1 && end > start, "summary card block markers must exist in order");
  const block = src.slice(start, end);

  assert.ok(!/XMLHttpRequest/.test(block), "summary block must not use XMLHttpRequest");
  assert.ok(!/\bfetch\s*\(/.test(block), "summary block must not call fetch()");
  assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(block), "summary block must not call supabase insert/update/delete/upsert");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"PUT"', "'PUT'", '"DELETE"', "'DELETE'"]) {
    assert.ok(!block.includes(verb), `summary block must not reference HTTP write method ${verb}`);
  }

  // Also lock the compute block (where _whSummary lives) to read-only.
  const cStart = src.indexOf("const _whSummary");
  const cEnd = src.indexOf("const _whGrandQty");
  assert.ok(cStart !== -1 && cEnd !== -1 && cEnd > cStart, "compute block markers must exist");
  const computeBlock = src.slice(cStart, cEnd);
  assert.ok(!/\bfetch\s*\(/.test(computeBlock), "compute block must not call fetch()");
  assert.ok(!/XMLHttpRequest/.test(computeBlock), "compute block must not use XMLHttpRequest");
});
