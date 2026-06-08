// tests/receipt_acct_trace_refresh_guard.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 405 — ป้าย "เอกสารบัญชี" บนใบเสร็จ auto-retry จน JV โผล่ (cosmetic · display-only)
//
// ROOT CAUSE: ใบเสร็จที่เด้งตอนจบบิลยิง lookup JV (sale_trace 92.17) ก่อน postJournalForSale สร้าง JV
//   (post อยู่หลัง `await loadAllData()` ใน pos.js doCheckout = JV เกิดช้าหลายวินาที) → lookup แรก "missing"
//   → badge ค้าง "ยังไม่ลงบัญชี" ทั้งที่อีกแป๊บก็ลงบัญชี.
// FIX (self-contained ใน main.js _fillReceiptAcctTrace — ไม่แตะ checkout flow): ถ้า "missing" → โชว์
//   "กำลังลงบัญชี…" + retry lookup จนเจอ/ครบ MAX_RETRY; หยุดถ้าเปลี่ยนบิล/ปิด drawer; unposted จริง → คงเหลือง.
//
// กัน regress: ถ้าใครลบ retry / ทำ unbounded (setInterval / ไม่เช็ค attempt) / ลบ stop-guard / แตะ
//   checkout flow / ทำให้ badge เขียน DB = test แดง. source-wiring guard (ตัวจริงพึ่ง DOM+timer → owner smoke).
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

test("main.js _fillReceiptAcctTrace: retry เฉพาะ missing + bounded + recursive attempt+1", () => {
  const fn = extractFn(mainJs, "_fillReceiptAcctTrace");
  // retry เฉพาะตอน missing และ bounded ด้วย attempt < MAX_RETRY (กัน poll ไม่จบ)
  assert.match(fn, /status\s*===\s*["']missing["']\s*&&\s*attempt\s*<\s*RECEIPT_TRACE_MAX_RETRY/,
    "ต้อง retry เฉพาะ status==='missing' && attempt < RECEIPT_TRACE_MAX_RETRY");
  // re-call ตัวเองด้วย attempt+1 (นับขึ้นจริง → จะถึง bound)
  assert.match(fn, /_fillReceiptAcctTrace\(\s*sale\s*,\s*attempt\s*\+\s*1\s*\)/,
    "retry ต้องเรียก _fillReceiptAcctTrace(sale, attempt+1)");
  // ใช้ setTimeout (chain ที่หยุดเอง) — ห้าม setInterval (ไม่มีตัวหยุด → poll ค้าง)
  assert.match(fn, /setTimeout\(/, "retry ต้องใช้ setTimeout");
  assert.ok(!/setInterval/.test(fn), "ห้ามใช้ setInterval (ต้องหยุดเองเมื่อครบ/เจอ)");
});

test("main.js _fillReceiptAcctTrace: stop-guard กัน poll ผิดบิล/บิลที่ปิดแล้ว", () => {
  const fn = extractFn(mainJs, "_fillReceiptAcctTrace");
  // retry เฉพาะถ้ายังเป็นใบเสร็จเดิม (id ตรง, cast String กัน type mismatch)
  assert.match(fn, /String\(\s*lr\.id\s*\)\s*===\s*String\(\s*sale\??\.id\s*\)/,
    "retry ต้องเช็ค String(lr.id)===String(sale.id) — กัน poll ผิดบิล");
  // และ drawer ยังเปิด (slot ยังอยู่)
  assert.match(fn, /getElementById\(\s*["']receiptAcctTrace["']\s*\)/,
    "retry ต้องเช็ค #receiptAcctTrace ยังอยู่ (drawer เปิด)");
});

test("main.js: retry bound เป็นค่าคงที่ (ไม่ poll ไม่จบ)", () => {
  assert.match(mainJs, /const RECEIPT_TRACE_MAX_RETRY\s*=\s*\d+\s*;/, "ต้องมี const RECEIPT_TRACE_MAX_RETRY");
  assert.match(mainJs, /const RECEIPT_TRACE_RETRY_MS\s*=\s*\d+\s*;/, "ต้องมี const RECEIPT_TRACE_RETRY_MS");
});

test("main.js _fillReceiptAcctTrace: display-only (ไม่ write/post/ตัดสต็อก)", () => {
  const fn = extractFn(mainJs, "_fillReceiptAcctTrace");
  assert.ok(!/xhrPost|xhrPatch|postJournal|_applyStockMovement|deductStock/.test(fn),
    "badge trace ต้องเป็น display-only — ห้าม write/post/ตัดสต็อก");
});

test("pos.js: checkout flow ไม่ถูกแตะ (auto-post .catch เดิมคงอยู่ · ไม่มี refresh hook ใน money path)", () => {
  const idx = posJs.indexOf("postJournalForSale({");
  assert.ok(idx >= 0, "doCheckout ต้องเรียก postJournalForSale");
  const region = posJs.slice(idx, idx + 500);
  // post ยัง fire-and-forget + .catch เดิม — fix อยู่ใน display ล้วน ไม่ผูก checkout
  assert.match(region, /\}\)\.catch\(\s*e\s*=>\s*console\.warn\(\s*["']\[pos\] auto-post JV failed:/,
    ".catch ของ auto-post เดิมต้องคงอยู่ (checkout flow ไม่เปลี่ยน)");
  assert.ok(!region.includes("_appRefreshReceiptAcctTrace") && !region.includes("ReceiptAcctTrace"),
    "checkout flow (money path) ต้องไม่มี hook ของ badge — fix เป็น display-only ใน main.js");
});
