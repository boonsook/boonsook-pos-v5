// Phase 92.63 — Finance audit quick wins: #5 profit_report XSS, #6b profit TZ, #8 payroll JV/expense fail logging
// Source-level guards (modules render DOM / call REST — verify wiring)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
const fs = await import("node:fs");
const path = await import("node:path");
const read = (p) => fs.readFileSync(path.resolve(p), "utf8");

// ── #5 profit_report XSS ─────────────────────────────────────
test("profit_report: escape productName + category (กัน stored-XSS)", () => {
  const src = read("modules/profit_report.js");
  assert.match(src, /import \{[^}]*escHtml[^}]*\} from "\.\/utils\.js"/, "ต้อง import escHtml");
  assert.match(src, /\$\{escHtml\(p\.productName\)\}/, "productName ต้องผ่าน escHtml");
  assert.match(src, /\$\{escHtml\(c\.category\)\}/, "category ต้องผ่าน escHtml");
  assert.doesNotMatch(src, /\$\{p\.productName\}/, "ต้องไม่มี productName ดิบ");
  assert.doesNotMatch(src, /\$\{c\.category\}/, "ต้องไม่มี category ดิบ");
});

// ── #6b profit_report TZ default range ──────────────────────
test("profit_report: default range ใช้ Bangkok TZ (addDaysBkk/todayBkk)", () => {
  const src = read("modules/profit_report.js");
  assert.match(src, /profit_from_date"\)\.value = addDaysBkk\(-30\)/, "from = addDaysBkk(-30)");
  assert.match(src, /profit_to_date"\)\.value = todayBkk\(\)/, "to = todayBkk()");
  assert.doesNotMatch(src, /function formatDateForInput/, "formatDateForInput (local TZ) ต้องถูกถอด");
});

// ── #6b profit_by_product cutoff TZ ─────────────────────────
test("profit_by_product: cutoff ใช้ Bangkok TZ ไม่ใช่ UTC toISOString", () => {
  const src = read("modules/profit_by_product.js");
  assert.match(src, /const today = todayBkk\(\)/, "today = todayBkk()");
  assert.match(src, /cutoffKey = addDaysBkk\(-30\)/, "30d = addDaysBkk(-30)");
  // ใน cutoff block ต้องไม่มี toISOString แล้ว
  const cutoffBlock = src.match(/let cutoffKey[\s\S]*?year"\) \{[^}]*\}/)?.[0] || "";
  assert.doesNotMatch(cutoffBlock, /toISOString\(/, "cutoff ต้องไม่เรียก toISOString() (UTC)");
});

// ── #8 payroll failed JV/expense → audit log ────────────────
test("payroll: log failed auto-expense + auto-journal ใน audit (ไม่ใช่แค่ console)", () => {
  const src = read("modules/payroll.js");
  assert.match(src, /logActivity\("payroll_expense_failed"/, "ต้อง log expense failed");
  assert.match(src, /logActivity\("payroll_journal_failed"/, "ต้อง log journal failed");
});
