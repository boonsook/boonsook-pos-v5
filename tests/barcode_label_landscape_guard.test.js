// Phase 462 — barcode label prints LANDSCAPE on 30×50mm paper (build 462)
// Run: node --test tests/barcode_label_landscape_guard.test.js
//
// Why this exists:
//   The shop's label printer feeds 30mm-wide × 50mm-long stock, but the owner wants
//   the printed content LANDSCAPE (shop / name / a WIDE barcode / number / price) like
//   the reference label — a horizontal barcode is far easier to scan than a barcode
//   squeezed into a 30mm width. So the barcode print window (openBarcodePrintWindow in
//   modules/products.js) sets @page to the real 30×50 paper and lays the content out in
//   a 50×30 ".sticker-inner" that is rotated 90° and centered → the barcode runs along
//   the 50mm length (full width). These guards lock that default + the rotation wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/products.js"), "utf8");

// ── @page matches the physical 30×50 paper ────────────────────────────────────
test("print @page is 30mm 50mm (the real paper), set in both base and @media print", () => {
  const m = src.match(/@page\s*\{\s*size:\s*30mm 50mm;/g) || [];
  assert.ok(m.length >= 2, "both @page rules must be 30mm 50mm");
  assert.ok(!/@page\s*\{\s*size:\s*50mm 30mm;/.test(src), "no leftover 50mm 30mm @page");
});

// ── content lives in a rotated, centered inner box ────────────────────────────
test(".sticker-inner is a 50×30 box rotated 90° and centered", () => {
  assert.match(src, /\.sticker-inner\s*\{[\s\S]*?width:\s*50mm;\s*height:\s*30mm;/, ".sticker-inner must be 50mm × 30mm (landscape content)");
  assert.match(src, /\.sticker-inner\s*\{[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\)/, ".sticker-inner must be centered + rotated 90deg");
  assert.match(src, /\.sticker\s*\{[\s\S]*?width:\s*30mm;\s*height:\s*50mm;[\s\S]*?position:\s*relative/, ".sticker (paper) must be 30×50 + position relative");
});

test("the sticker markup wraps content in .sticker-inner", () => {
  assert.match(src, /<div class="sticker"><div class="sticker-inner">/, "each sticker must contain a .sticker-inner wrapper");
});

// ── default size is the rotated 30×50 landscape option ────────────────────────
test("size dropdown defaults to 30x50r (rotated landscape) and keeps the other sizes", () => {
  assert.match(src, /<option value="30x50r" selected>/, "30x50r must be the selected default");
  assert.ok(!/<option value="50x30" selected>/.test(src), "50x30 must not be selected");
  for (const k of ["50x30", "40x25", "70x40"]) {
    assert.ok(src.includes(`"${k}":`), `size ${k} must remain selectable`);
  }
  assert.match(src, /Custom 30×50mm/, "hint must reference the 30×50mm paper");
});

// ── SIZES carries paper/inner/rotation, and changeSize applies it ─────────────
test("SIZES 30x50r entry is rotated with 30×50 paper and 50×30 content", () => {
  assert.match(src, /"30x50r":\s*\{[^}]*paperW:\s*"30mm"[^}]*paperH:\s*"50mm"[^}]*innerW:\s*"50mm"[^}]*innerH:\s*"30mm"[^}]*rot:\s*true/, "30x50r must map 30×50 paper to a rotated 50×30 inner");
  // non-rotated sizes keep rot:false
  assert.match(src, /"50x30":\s*\{[^}]*rot:\s*false/, "50x30 must stay non-rotated");
});

test("changeSize drives @page/sticker/inner from the size entry and toggles rotation", () => {
  assert.match(src, /SIZES\[key\]\s*\|\|\s*SIZES\["30x50r"\]/, "fallback must be 30x50r");
  assert.match(src, /size:\s*" \+ sz\.paperW \+ " " \+ sz\.paperH/, "@page must use paperW/paperH");
  assert.match(src, /\.sticker-inner \{ width: " \+ sz\.innerW[\s\S]*?rotate\(" \+ \(sz\.rot \? "90deg" : "0deg"\)/, "inner box must size from innerW/innerH and rotate when sz.rot");
});

// ── barcode bar width is configurable + the on-load default render ─────────────
test("renderBarcodes accepts a bar width and the load handler renders the 30×50 default", () => {
  assert.match(src, /function renderBarcodes\(heightMM,\s*barW\)/, "renderBarcodes must accept barW");
  assert.match(src, /width:\s*barW\s*\|\|\s*1\.2/, "JsBarcode width must come from barW");
  assert.match(src, /renderBarcodes\(sz\.bcH,\s*sz\.bcW\)/, "changeSize must pass sz.bcW");
  assert.match(src, /renderBarcodes\(12,\s*1\.2\)/, "load handler must render the 30×50 landscape default");
});
