// Phase 92.13 — Guard: every stock_movements insert must use a DB-allowed `type`.
// Production smoke (build 268) hit: code 23514 violates stock_movements_type_check
// because sale-delete reverse used type "return_sale" (not in the constraint set).
// This guard scans main.js for every xhrPost("stock_movements", {...}) and asserts
// the literal `type` is one of the known-valid values used by working flows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(__dirname, "..", "main.js"), "utf8");

// Valid set = types used by checkout (sale), warehouse transfer (transfer),
// the manual stock-movement form (in/out/adjust/return) and refund restock (return).
// These all insert successfully in production → match stock_movements_type_check.
const ALLOWED_TYPES = new Set(["in", "out", "adjust", "transfer", "sale", "return"]);

function extractStockMovementTypes(src) {
  const types = [];
  // match xhrPost("stock_movements", { ... }) — payloads are flat objects (no nested braces)
  const re = /xhrPost\(\s*["']stock_movements["']\s*,\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1];
    const typeMatch = body.match(/\btype\s*:\s*(["'])([^"']+)\1/);
    types.push(typeMatch ? typeMatch[2] : null);
  }
  return types;
}

test("every stock_movements insert uses a constraint-valid type literal", () => {
  const types = extractStockMovementTypes(mainSrc);
  assert.ok(types.length >= 3, `expected to find stock_movements inserts, found ${types.length}`);
  for (const t of types) {
    // null = type was a variable (e.g. movementType from a validated select) — skip literal check
    if (t === null) continue;
    assert.ok(ALLOWED_TYPES.has(t), `stock_movements type "${t}" is not in the allowed set ${[...ALLOWED_TYPES].join("/")}`);
  }
});

test("no stock_movements insert uses the rejected 'return_sale' type (regression)", () => {
  assert.equal(
    /type\s*:\s*["']return_sale["']/.test(mainSrc),
    false,
    'main.js must not insert stock_movements with type "return_sale" (violates stock_movements_type_check 23514)'
  );
});

test("sale-delete reverse logs a return movement with valid type", () => {
  // _revertStockForSale block should log type "return" for the คืนสต็อกจากลบ POS movement
  const revertIdx = mainSrc.indexOf("_revertStockForSale");
  assert.ok(revertIdx >= 0, "_revertStockForSale should exist in main.js");
  // Phase 410: ฟังก์ชันยาวขึ้นเกิน window 4000 ตัวอักษรเดิม (idempotency gate + CAS)
  // → slice ถึงจุดจบฟังก์ชันแทน (window._appRevertStockForSale export) — assertion เดิมเป๊ะ
  const endIdx = mainSrc.indexOf("\nwindow._appRevertStockForSale", revertIdx);
  const block = mainSrc.slice(revertIdx, endIdx === -1 ? revertIdx + 12000 : endIdx);
  assert.match(block, /type\s*:\s*["']return["']/, "reverse-stock movement must use type 'return'");
});
