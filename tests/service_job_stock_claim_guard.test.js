// Phase 500 — service-job stock TOCTOU: atomic claim in deduct/restore (audit #C-2)
// Run: node --test tests/service_job_stock_claim_guard.test.js
//
// Why this exists:
//   deductServiceJobStock / restoreServiceJobStock (service_equipment.js) gate กันซ้ำเดิมอ่าน
//   job.note จาก memory แล้วเขียน marker แยกใน caller ทีหลัง = TOCTOU (sibling ของ #C/POS revert).
//   ปิด/ลบ/ยกเลิกงานเดียวกันพร้อมกัน 2 เครื่อง → ตัด/คืนสต็อกซ้ำ. build 500 ย้าย atomic claim
//   (conditional PATCH service_jobs) เข้าไปใน 2 helper (mirror Phase 499). Source-regex only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const eq = fs.readFileSync(path.resolve("modules/service_equipment.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const sqlPath = path.resolve("supabase-phase500-service-job-stock-markers.sql");

function bodyBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(s > -1, `must find ${startMarker}`);
  assert.ok(e > s, `${endMarker} must follow ${startMarker}`);
  return src.slice(s, e);
}
const deductBody = () => bodyBetween(eq, "export async function deductServiceJobStock(job)", "export async function restoreServiceJobStock(job)");
const restoreBody = () => bodyBetween(eq, "export async function restoreServiceJobStock(job)", "export function optimisticDeduct");

test("1. deduct claim — conditional PATCH stock_deducted_at=is.null + return=representation + set now", () => {
  const b = deductBody();
  assert.match(b, /stock_deducted_at=is\.null/, "deduct claim filter");
  assert.match(b, /stock_deducted_at:\s*new Date\(\)\.toISOString\(\)/, "เซ็ต stock_deducted_at = now");
  assert.match(b, /_claimServiceJob/, "ใช้ claim helper");
});

test("2. restore claim รวมเงื่อนไข — เคยตัด (not.is.null) + ยังไม่คืน (is.null)", () => {
  const b = restoreBody();
  assert.match(b, /stock_deducted_at=not\.is\.null/, "restore: ต้องเคยตัด (stock_deducted_at IS NOT NULL)");
  assert.match(b, /stock_reverted_at=is\.null/, "restore: ต้องยังไม่คืน (stock_reverted_at IS NULL)");
  assert.match(b, /stock_reverted_at:\s*new Date\(\)\.toISOString\(\)/, "เซ็ต stock_reverted_at = now");
});

test("3. 0 row → skip (ทั้ง 2 helper ไม่เดินหน้า)", () => {
  assert.match(deductBody(), /!claim\.won[\s\S]{0,160}deducted:\s*false[\s\S]{0,80}skipped:\s*true/, "deduct 0-row → skip");
  assert.match(restoreBody(), /!claim\.won[\s\S]{0,160}restored:\s*false[\s\S]{0,80}skipped:\s*true/, "restore 0-row → skip");
});

test("4. fail-closed — claim error → ไม่ตัด/ไม่คืน + claimError", () => {
  assert.match(deductBody(), /claim\.error[\s\S]{0,160}deducted:\s*false[\s\S]{0,120}claimError:\s*true/, "deduct claim error → claimError");
  assert.match(restoreBody(), /claim\.error[\s\S]{0,160}restored:\s*false[\s\S]{0,120}claimError:\s*true/, "restore claim error → claimError");
});

test("5. release on zero — ไม่ได้ตัด/คืนอะไร → PATCH คอลัมน์กลับ null", () => {
  assert.match(deductBody(), /_releaseServiceJob[\s\S]{0,80}stock_deducted_at:\s*null/, "deduct all-fail → release (stock_deducted_at:null)");
  assert.match(restoreBody(), /_releaseServiceJob[\s\S]{0,80}stock_reverted_at:\s*null/, "restore all-fail → release (stock_reverted_at:null)");
});

test("6. claim/release ใช้ raw fetch — ไม่ใช้ xhrPatch/_appXhrPatch", () => {
  // claim helper + 2 body ต้องไม่เรียก xhrPatch ทำ claim
  const claimHelper = bodyBetween(eq, "async function _claimServiceJob", "async function _releaseServiceJob");
  assert.match(claimHelper, /method:\s*["']PATCH["']/, "claim ใช้ fetch PATCH");
  assert.ok(!claimHelper.includes("xhrPatch") && !claimHelper.includes("_appXhrPatch"), "claim helper ห้ามใช้ xhrPatch");
  assert.ok(!deductBody().includes("xhrPatch") && !restoreBody().includes("xhrPatch"), "helper body ห้ามใช้ xhrPatch ทำ claim");
});

test("7. scope guard — deductEquipmentStock / _appApplyStockMovement / 2 markers ยังอยู่", () => {
  assert.match(deductBody(), /deductEquipmentStock\(/, "ยังเรียก deductEquipmentStock (เส้นทางตัดจริง)");
  assert.match(restoreBody(), /_appApplyStockMovement/, "ยังเรียก _appApplyStockMovement (คืนจริง)");
  assert.match(eq, /STOCK_DEDUCTED_MARKER = "\[ตัดสต็อกแล้ว\]"/, "DEDUCTED marker คงอยู่");
  assert.match(eq, /STOCK_RETURNED_MARKER = "\[คืนสต็อกแล้ว\]"/, "RETURNED marker คงอยู่");
  assert.match(deductBody(), /STOCK_DEDUCTED_MARKER/, "deduct ยังแปะ note-marker (safety-net/display)");
  assert.match(restoreBody(), /STOCK_RETURNED_MARKER/, "restore ยังแปะ note-marker");
});

test("8. caller deduct surface claimError (กันปิดงานไม่ตัดสต็อกเงียบ)", () => {
  const i = mainJs.indexOf("const ded = await _equipDeductOnClose");
  assert.ok(i > -1, "ต้องเจอ deduct caller");
  const block = mainJs.slice(i, i + 1400);
  assert.match(block, /ded\.claimError[\s\S]{0,200}showToast/, "claimError → showToast เตือน");
});

test("9. SQL — 2 ADD COLUMN + NOTIFY pgrst + 2 backfill (DEDUCTED + RETURNED)", () => {
  assert.ok(fs.existsSync(sqlPath), "supabase-phase500-service-job-stock-markers.sql must exist");
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS stock_deducted_at timestamptz/, "ADD stock_deducted_at");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS stock_reverted_at timestamptz/, "ADD stock_reverted_at");
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/, "NOTIFY pgrst");
  assert.match(sql, /stock_deducted_at = now\(\)[\s\S]*?\[ตัดสต็อกแล้ว\]/, "backfill DEDUCTED marker");
  assert.match(sql, /stock_reverted_at = now\(\)[\s\S]*?\[คืนสต็อกแล้ว\]/, "backfill RETURNED marker");
});
