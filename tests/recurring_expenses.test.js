// Phase 92.62 — Recurring expense: auto-post JV (#2) + idempotency tag (#3) + TZ-safe next_due
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { recurringExpenseTag, _calcNextDue } = await import("../modules/recurring_expenses.js");

// ── recurringExpenseTag ─────────────────────────────────────

test("recurringExpenseTag — format #recur-{id}-{period}", () => {
  assert.equal(recurringExpenseTag(5, "2026-06-01"), "#recur-5-2026-06-01");
  assert.equal(recurringExpenseTag("12", "2026-07"), "#recur-12-2026-07");
});

// ── _calcNextDue (TZ-safe, deterministic) ───────────────────

test("_calcNextDue — monthly +1 เดือน (ไม่มี day_of_month → ใช้วันเดิม clamp 28)", () => {
  assert.equal(_calcNextDue({ frequency: "monthly" }, "2026-06-15"), "2026-07-15");
  assert.equal(_calcNextDue({ frequency: "monthly" }, "2026-06-05"), "2026-07-05");
});

test("_calcNextDue — monthly ข้ามปี (ธ.ค. → ม.ค.)", () => {
  assert.equal(_calcNextDue({ frequency: "monthly" }, "2026-12-10"), "2027-01-10");
});

test("_calcNextDue — monthly day_of_month clamp ≤ 28", () => {
  assert.equal(_calcNextDue({ frequency: "monthly", day_of_month: 5 }, "2026-06-15"), "2026-07-05");
  assert.equal(_calcNextDue({ frequency: "monthly", day_of_month: 31 }, "2026-06-15"), "2026-07-28");
});

test("_calcNextDue — monthly วันเดิม > 28 → clamp 28 (กัน overflow)", () => {
  assert.equal(_calcNextDue({ frequency: "monthly" }, "2026-01-31"), "2026-02-28");
});

test("_calcNextDue — weekly +7 วัน (ข้ามเดือนได้)", () => {
  assert.equal(_calcNextDue({ frequency: "weekly" }, "2026-06-28"), "2026-07-05");
  assert.equal(_calcNextDue({ frequency: "weekly" }, "2026-06-01"), "2026-06-08");
});

test("_calcNextDue — yearly +1 ปี", () => {
  assert.equal(_calcNextDue({ frequency: "yearly" }, "2026-06-15"), "2027-06-15");
});

test("_calcNextDue — deterministic (ไม่ขึ้นกับ runtime TZ): ผลเป็น YYYY-MM-DD เสมอ", () => {
  assert.match(_calcNextDue({ frequency: "monthly" }, "2026-06-15"), /^\d{4}-\d{2}-\d{2}$/);
});

// ── source-level wiring (#2 JV + #3 idempotency + TZ) ───────

test("source: generate ลง JV (#2) + idempotency tag (#3) + Bangkok TZ", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve("modules/recurring_expenses.js"), "utf8");
  // #2: import + เรียก postJournalForExpense + return=representation
  assert.match(src, /import \{ postJournalForExpense \} from "\.\/accounting\/auto_post\.js"/, "ต้อง import postJournalForExpense");
  assert.match(src, /postJournalForExpense\(inserted\)/, "ต้องเรียก JV หลัง insert");
  assert.match(src, /Prefer": "return=representation"/, "ต้องขอ representation เพื่อเอา id");
  // #3: tag ใน note + pre-check exists
  assert.match(src, /recurringExpenseTag\(r\.id, periodKey\)/, "ต้องใช้ tag ต่อ recurring+งวด");
  assert.match(src, /_recurringExpenseExists/, "ต้อง pre-check ว่าสร้างไปแล้วหรือยัง");
  assert.match(src, /\$\{tag\}/, "tag ต้องอยู่ใน note");
  // #3: in-flight guard
  assert.match(src, /_reGenBusy/, "ต้องมี in-flight guard กันกดซ้ำ");
  // TZ: ใช้ todayBkk ไม่ใช่ UTC toISOString
  assert.match(src, /const today = todayBkk\(\)/, "ต้องใช้ todayBkk (Bangkok TZ)");
  assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, "ต้องไม่ใช้ UTC toISOString สำหรับ expense_date");
});
