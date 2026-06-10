// Phase 413 — Accounting effective date = 2026-07-01 (เริ่มบัญชีจริง 1 ก.ค. 2569)
// invariant:
//   (1) single source of truth: effective_date.js นิยามค่าเดียว — 6 ไฟล์บัญชี import ตัวนี้
//       (ห้ามมี const ACCOUNTING_EFFECTIVE_DATE / cutoff hardcode ท้องถิ่นอีก)
//   (2) boundary: 2026-06-30 = pre-effective (false) · 2026-07-01 = effective (true)
//   (3) ไม่มี "2026-05-01" (cutoff เดิม 88.18b) หลงเหลือใน source บัญชีทั้ง 6 ไฟล์
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

const { ACCOUNTING_EFFECTIVE_DATE } = await import("../modules/accounting/effective_date.js");
const { _isAfterEffective } = await import("../modules/accounting/auto_post.js");

test("effective_date.js: ค่า = 2026-07-01 (เริ่มบัญชีจริง 1 ก.ค. 2569)", () => {
  assert.equal(ACCOUNTING_EFFECTIVE_DATE, "2026-07-01");
});

test("_isAfterEffective boundary: 2026-06-30 → false · 2026-07-01 → true", () => {
  assert.equal(_isAfterEffective("2026-06-30"), false);
  assert.equal(_isAfterEffective("2026-07-01"), true);
});

const SOURCES = [
  "modules/accounting/auto_post.js",
  "modules/accounting/balance_sheet.js",
  "modules/accounting/export_bundle.js",
  "modules/accounting/opening_balance.js",
  "modules/accounting/backfill.js",
  "modules/service_reconcile.js",
];

for (const f of SOURCES) {
  test(`${f}: ไม่มี cutoff เดิม 2026-05-01 หลงเหลือ + import จาก effective_date.js`, () => {
    const src = read(f);
    assert.ok(!src.includes("2026-05-01"), "ห้ามมี 2026-05-01 (cutoff เดิม) ใน source");
    assert.ok(!/const ACCOUNTING_EFFECTIVE_DATE\s*=\s*"/.test(src),
      "ห้ามนิยาม const ACCOUNTING_EFFECTIVE_DATE ท้องถิ่น (ต้อง import)");
    assert.match(src, /import \{ ACCOUNTING_EFFECTIVE_DATE \} from ".*effective_date\.js"/,
      "ต้อง import จาก effective_date.js (single source of truth)");
  });
}

test("effective_date.js: นิยามวันที่รูปแบบ YYYY-MM-DD ที่เดียว", () => {
  const src = read("modules/accounting/effective_date.js");
  const dates = src.match(/"\d{4}-\d{2}-\d{2}"/g) || [];
  assert.deepEqual(dates, ['"2026-07-01"'], "ต้องมีวันที่นิยามเดียวคือ 2026-07-01");
});
