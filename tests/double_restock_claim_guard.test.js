// Phase 499 — double-restock TOCTOU: atomic claim via sales.stock_reverted_at (audit #C)
// Run: node --test tests/double_restock_claim_guard.test.js
//
// Why this exists:
//   ลบบิล POS → _revertStockForSale คืนสต็อก. gate กันคืนซ้ำเดิม (Phase 410) = read note → check
//   marker → write ทีหลัง = TOCTOU. ลบบิลเดียวกันพร้อมกัน 2 เครื่อง/2 tab → ผ่าน gate ทั้งคู่ →
//   restock ซ้ำ = สต็อกพอง. build 499 เปลี่ยนเป็น atomic claim: conditional PATCH
//   `sales?id=eq.X&stock_reverted_at=is.null` → DB การันตี single-writer (ชนะ 1 row / แพ้ 0 row).
//   Source-level checks (extract body ของ _revertStockForSale ก่อน — อย่า regex ทั้งไฟล์).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("main.js"), "utf8");
const sqlPath = path.resolve("supabase-phase499-sales-stock-reverted-at.sql");

function revertBody() {
  const start = src.indexOf("async function _revertStockForSale");
  const end = src.indexOf("window._appRevertStockForSale", start + 1);
  assert.ok(start > -1, "must find _revertStockForSale");
  assert.ok(end > start, "window._appRevertStockForSale must follow the function");
  return src.slice(start, end);
}

test("1. atomic claim — conditional PATCH WHERE stock_reverted_at IS NULL", () => {
  const body = revertBody();
  assert.match(body, /stock_reverted_at=is\.null/, "claim ต้องกรอง stock_reverted_at=is.null");
  assert.match(body, /method:\s*["']PATCH["']/, "claim เป็น PATCH");
  assert.match(body, /return=representation/, "ต้อง return=representation เพื่อรู้ว่าชนะ claim (1 row) หรือแพ้ (0 row)");
  // เซ็ตค่า stock_reverted_at ตอน claim
  assert.match(body, /stock_reverted_at:\s*new Date\(\)\.toISOString\(\)/, "claim เซ็ต stock_reverted_at = เวลาปัจจุบัน");
});

test("2. 0 row → skip (ไม่เดินหน้า restock)", () => {
  const body = revertBody();
  // claimedRows.length === 0 → return skipped/reverted:0
  assert.match(body, /claimedRows\.length\s*===\s*0[\s\S]{0,200}skipped:\s*true/,
    "claim คืน 0 row → return skipped:true (no-op)");
  assert.match(body, /reverted:\s*0/, "skip path คืน reverted:0");
});

test("3. fail-closed — claim HTTP error → ok:false (ไม่ restock)", () => {
  const body = revertBody();
  assert.match(body, /!cr\.ok[\s\S]{0,120}ok:\s*false/, "claim HTTP !ok → return ok:false (fail-closed)");
  // bad response ก็ fail-closed
  assert.match(body, /!Array\.isArray\(claimedRows\)[\s\S]{0,200}ok:\s*false/, "claim bad-response → ok:false");
});

test("4. release claim เมื่อคืนไม่ได้เลย (revertedCount === 0) → PATCH กลับเป็น null", () => {
  const body = revertBody();
  // helper ปลดเคลม set stock_reverted_at: null
  assert.match(body, /stock_reverted_at:\s*null/, "release = PATCH stock_reverted_at กลับเป็น null");
  // ผูกกับ else ของ revertedCount > 0 (คือ revertedCount === 0)
  assert.match(body, /revertedCount\s*>\s*0[\s\S]*?\}\s*else\s*\{[\s\S]{0,260}_releaseClaim/,
    "revertedCount===0 (else) → เรียก _releaseClaim");
  // exception ก่อนคืนอะไร → release ด้วย
  assert.match(body, /revertedCount\s*===\s*0[\s\S]{0,80}_releaseClaim/, "exception+revertedCount===0 → release");
});

test("5. ไม่ใช้ xhrPatch ทำ claim (กันบั๊กเดิม: xhrPatch รับ filter เดียว = UPDATE ไม่มีเงื่อนไข)", () => {
  const body = revertBody();
  // claim block (ก่อน const errors) ต้องไม่มี xhrPatch
  const claimBlock = body.slice(0, body.indexOf("const errors = []"));
  assert.ok(!claimBlock.includes("xhrPatch("), "claim/release ต้องไม่ใช้ xhrPatch( (ใช้ fetch ตรง คุม 0/1/error เอง)");
});

test("6. scope guard — restock/CAS/qty-aware/bundle ไม่ถูกถอด", () => {
  const body = revertBody();
  assert.match(body, /_atomicAddStock/, "CAS _atomicAddStock ต้องคงอยู่");
  assert.match(body, /takeRestockQty/, "qty-aware takeRestockQty ต้องคงอยู่ (Phase 483)");
  assert.match(body, /expandBundleForRevert/, "bundle expand ต้องคงอยู่ (Phase 477)");
  assert.match(body, /_STOCK_RETURNED_MARKER/, "note-marker เดิมยังถูกแปะ (module อื่นอ่าน note)");
  // return shape เดิม (caller sales.js อ่าน reverted/errors/skipped)
  assert.match(body, /reverted:\s*revertedCount,\s*errors/, "return shape { ok, reverted, errors } คงเดิม");
});

test("7. SQL: ADD COLUMN IF NOT EXISTS stock_reverted_at + NOTIFY pgrst + backfill", () => {
  assert.ok(fs.existsSync(sqlPath), "supabase-phase499-sales-stock-reverted-at.sql must exist");
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /ALTER TABLE public\.sales ADD COLUMN IF NOT EXISTS stock_reverted_at timestamptz/, "ADD COLUMN");
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/, "NOTIFY pgrst");
  assert.match(sql, /UPDATE public\.sales[\s\S]*?stock_reverted_at = now\(\)[\s\S]*?\[คืนสต็อกแล้ว\]/, "backfill marker เก่า");
});
