// tests/receipt_acct_trace_refresh_guard.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 405 — รีเฟรชป้าย "เอกสารบัญชี" บนใบเสร็จหลัง auto_post (cosmetic · display-only)
//
// ROOT CAUSE (deterministic ordering): pos.js doCheckout เปิดใบเสร็จ (openReceiptDrawer)
//   + ยิง lookup JV ก่อน postJournalForSale สร้าง JV → badge ค้าง "ยังไม่ลงบัญชี" ทุกบิล
//   + badge เติมครั้งเดียวไม่ re-poll.
// FIX: main.js _refreshReceiptAcctTrace(saleId) re-run lookup; pos.js post .then() เรียกหลัง
//   JV ลงสำเร็จ (ห่อ try). post fail → ไม่ refresh (ยังเหลือง = honest); เปลี่ยนบิล/drawer ปิด → no-op.
//
// กัน regress: ถ้าใครลบ refresh / ลบ id-guard / ลบ try / ลบ .catch / refresh ก่อน .then = test แดง.
// ทั้งหมดเป็น source-wiring guard (ตัวจริงพึ่ง DOM+state — smoke จริงโดย owner ผ่าน preview).
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainJs = readFileSync(join(ROOT, "main.js"), "utf8");
const posJs = readFileSync(join(ROOT, "modules", "pos.js"), "utf8");

// ดึง body ของ function ตามชื่อ (brace-balanced) — อย่า assert ทั้งไฟล์
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} ต้องมีอยู่`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

test("main.js _refreshReceiptAcctTrace: id-match guarded + re-run fill + ไม่ write", () => {
  const fn = extractFn(mainJs, "_refreshReceiptAcctTrace");
  // เทียบ id แบบ String ทั้งสองข้าง (กันรีเฟรชผิดบิล + type mismatch bigint/string)
  assert.match(fn, /String\(\s*lr\.id\s*\)\s*!==\s*String\(\s*saleId\s*\)/,
    "ต้อง guard ด้วย String(lr.id) !== String(saleId) — กันรีเฟรชผิดบิล");
  // re-run read-only lookup fill
  assert.match(fn, /_fillReceiptAcctTrace\s*\(/, "ต้องเรียก _fillReceiptAcctTrace (re-run lookup)");
  // เช็ค slot/drawer ก่อน (no-op ถ้าใบเสร็จปิด)
  assert.match(fn, /getElementById\(\s*["']receiptAcctTrace["']\s*\)/,
    "ต้องเช็ค #receiptAcctTrace (drawer เปิดอยู่) ก่อน refresh");
  // display-only — ห้าม write/post/ตัดสต็อก
  assert.ok(!/xhrPost|xhrPatch|postJournal|_applyStockMovement|deductStock/.test(fn),
    "refresh ต้องเป็น display-only — ห้าม write/post/ตัดสต็อก");
});

test("main.js expose window._appRefreshReceiptAcctTrace ให้ pos.js เรียกได้", () => {
  assert.match(mainJs, /window\._appRefreshReceiptAcctTrace\s*=\s*_refreshReceiptAcctTrace\s*;/,
    "ต้อง expose window._appRefreshReceiptAcctTrace = _refreshReceiptAcctTrace");
});

test("pos.js post-JV chain: refresh ใน .then() (หลัง JV สำเร็จ) + try + .catch เดิมคงอยู่", () => {
  const idx = posJs.indexOf("postJournalForSale({");
  assert.ok(idx >= 0, "doCheckout ต้องเรียก postJournalForSale");
  const region = posJs.slice(idx, idx + 900);

  // .then() handler หลัง post สำเร็จ
  assert.match(region, /\}\s*\)\s*\n?\s*(?:\/\/[^\n]*\n\s*)*\.then\(\s*\(\)\s*=>/,
    "post(...) ต้องตามด้วย .then(() => ...) (refresh หลัง JV สำเร็จ)");
  // refresh ห่อ try (error ห้ามหลุดเข้า flow การขาย)
  assert.match(region, /try\s*\{\s*window\._appRefreshReceiptAcctTrace\?\.\(\s*saleId\s*\)/,
    "refresh ต้องห่อ try { window._appRefreshReceiptAcctTrace?.(saleId) }");
  // .catch เดิม (post fail → log) ต้องยังอยู่ → post fail = ไม่ refresh = ยังเหลือง (honest)
  assert.match(region, /\.catch\(\s*e\s*=>\s*console\.warn\(\s*["']\[pos\] auto-post JV failed:/,
    ".catch ของ auto-post (post fail → log, ไม่ refresh) ต้องคงอยู่");

  // ลำดับ: post → .then(refresh) → .catch  (refresh ต้องอยู่หลัง .then ไม่ใช่เรียกตรงเสมอ)
  const thenIdx = region.indexOf(".then(");
  const refreshIdx = region.indexOf("_appRefreshReceiptAcctTrace");
  const catchIdx = region.indexOf(".catch(");
  assert.ok(thenIdx > 0 && refreshIdx > thenIdx,
    "refresh ต้องอยู่ภายใน .then() (รันเฉพาะตอน JV โพสต์สำเร็จ)");
  assert.ok(catchIdx > refreshIdx, ".catch ต้องตามหลัง .then(refresh)");
});
