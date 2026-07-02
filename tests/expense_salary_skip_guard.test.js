// Audit fix — guard: postJournalForExpense ข้ามหมวดเงินเดือน (กัน JV Dr 5200 ซ้ำ)
// บั๊กเดิม: payroll auto-สร้าง expense category=salary รายคน (ไม่ลง JV) + period JV
//   ลง Dr 5200 ก้อนเดียว. แต่ expenses.js insert/edit เรียก postJournalForExpense
//   ตรงโดยไม่ skip salary → repost Dr 5200 รายคน = double-count. ย้าย skip มาที่
//   writer เดียว (auto_post) → ทุก caller กันซ้ำ.
// Run: node --test tests/expense_salary_skip_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

globalThis.window = globalThis.window || {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  App: { showToast: () => {} },
};
const _info = console.info; console.info = () => {};

const { postJournalForExpense } = await import("../modules/accounting/auto_post.js");

// หมวดเงินเดือนต้อง skip "ก่อน" จะแตะ mappings/fetch ใด ๆ (ไม่ต้อง mock network)
for (const cat of ["salary", "labor_hire", "payroll", "SALARY", " Salary "]) {
  test(`expense category="${cat}" → skipped (salary-via-payroll-period) ไม่ post JV`, async () => {
    const res = await postJournalForExpense(
      { id: 123, amount: 5000, expense_date: "2026-07-15", category: cat },
      { detailed: true }
    );
    assert.equal(res.status, "skipped");
    assert.equal(res.reason, "salary-via-payroll-period");
  });
}

console.info = _info;

test("source: skip อยู่ใน postJournalForExpense (single source) — backfill ก็ยังมี defensive skip", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ap = readFileSync(join(__dirname, "../modules/accounting/auto_post.js"), "utf8");
  const fn = ap.slice(ap.indexOf("export async function postJournalForExpense"));
  assert.match(fn, /\["salary", "labor_hire", "payroll"\]\.includes\(cat\)/, "writer ต้อง skip salary");
  assert.match(fn, /salary-via-payroll-period/);
});
