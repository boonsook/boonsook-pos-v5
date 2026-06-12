// Phase 411 — Backfill/Integrity ต้องข้ามเอกสาร soft-delete (note มี "[ลบแล้ว]")
// invariant: เอกสารที่ลบแล้วต้องไม่ถูก post JV จากทุก path (auto/backfill) และ
//            ไม่ถูกนับเป็น actionable ("ต้องแก้") ใน integrity panel
//   - _classifyOrphan: note มี [ลบแล้ว] → bucket "skipped" reason "deleted" (unit จริง)
//   - postJournalForSale / postJournalForServiceJob: early-return null (source-regex)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

// Setup global window ก่อน import (module อ่าน window ตอน call-time)
globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  App: { showToast: () => {} },
};
console.info = () => {};

const { _classifyOrphan, INTEGRITY_CATS } = await import("../modules/accounting/backfill.js");
const salesCat = INTEGRITY_CATS.find(c => c.key === "sales");
assert.ok(salesCat, "INTEGRITY_CATS ต้องมี cat sales");

// ── unit จริง: _classifyOrphan ─────────────────────────────────────────────
test("_classifyOrphan: บิลลบแล้ว (note มี [ลบแล้ว]) → skipped/deleted ไม่ใช่ actionable", () => {
  const c = _classifyOrphan(salesCat, {
    id: 177, note: "[ลบแล้ว] ลบโดยแอดมิน 10/6/2569", created_at: "2026-07-08", total_amount: 60
  });
  assert.equal(c.bucket, "skipped");
  assert.equal(c.reason, "deleted");
});

test("_classifyOrphan: row ปกติ (หลัง effective, amount>0, note ว่าง/null) → actionable เหมือนเดิม", () => {
  const c1 = _classifyOrphan(salesCat, { id: 1, note: "", created_at: "2026-07-08", total_amount: 100 });
  assert.equal(c1.bucket, "actionable");
  assert.equal(c1.amount, 100);
  // note = null/undefined → String(...) กัน crash → ไม่ skip
  const c2 = _classifyOrphan(salesCat, { id: 2, created_at: "2026-07-08", total_amount: 50 });
  assert.equal(c2.bucket, "actionable");
});

test("_classifyOrphan: row pre-effective → skipped/pre-effective เหมือนเดิม", () => {
  const c = _classifyOrphan(salesCat, { id: 3, note: "", created_at: "2026-04-01", total_amount: 100 });
  assert.equal(c.bucket, "skipped");
  assert.equal(c.reason, "pre-effective");
});

test("_classifyOrphan: บิลลบ + amount 0 ก็ยังไม่ actionable (deleted ครอบทุกเงื่อนไข)", () => {
  const c = _classifyOrphan(salesCat, { id: 4, note: "x [ลบแล้ว] y", created_at: "2026-07-08", total_amount: 0 });
  assert.equal(c.bucket, "skipped");
});

// ── source-regex: auto_post guards (extract เฉพาะ body ของฟังก์ชันก่อน) ──────
function fnSource(src, fnName) {
  const sig = new RegExp(`export\\s+async\\s+function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = sig.exec(src);
  assert.ok(m, `ไม่พบ ${fnName}`);
  const start = m.index;
  const after = src.indexOf("\nexport async function ", start + m[0].length);
  const end = after === -1 ? src.indexOf("\nasync function ", start + m[0].length) : after;
  return src.slice(start, end === -1 ? undefined : end);
}

const autoPostSrc = read("modules/accounting/auto_post.js");

for (const fnName of ["postJournalForSale", "postJournalForServiceJob"]) {
  test(`${fnName}: guard [ลบแล้ว] → legacy return null / detailed skipped`, () => {
    const fn = fnSource(autoPostSrc, fnName);
    const g = fn.match(/if\s*\(String\((sale|job)\.note \|\| ""\)\.includes\("\[ลบแล้ว\]"\)\)\s*\{([\s\S]*?)\}/);
    assert.ok(g, "ต้องมี guard เช็ค note [ลบแล้ว]");
    assert.match(g[2], /_journalResult\(opts\.detailed,\s*\{\s*status:\s*"skipped",\s*reason:\s*"deleted"/, "guard ต้อง return skipped/deleted แบบ detailed และ legacy ยังได้ null");
  });
}
