// Audit fix — guard: period-lock trigger ต้องกัน DELETE + service INSERT close guard
// ล็อกว่า SQL migration ยังกันช่องที่ audit เจอ (source-regex บนไฟล์ .sql).
// Run: node --test tests/period_lock_delete_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");

// ── #3: period lock ต้องครอบ DELETE ──────────────────────────
const periodSql = read("supabase-phase551-period-lock-delete-guard.sql");

test("trigger trg_check_period_locked ครอบ INSERT OR UPDATE OR DELETE", () => {
  assert.match(periodSql, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.journal_entries/i);
});

test("มี branch TG_OP='DELETE' ที่ RAISE เมื่อ period locked", () => {
  const del = periodSql.slice(periodSql.indexOf("TG_OP = 'DELETE'"));
  assert.ok(del.length > 0, "ต้องมี branch DELETE");
  assert.match(del, /is_period_locked\(\s*OLD\.doc_date\s*\)/, "DELETE เช็ค OLD.doc_date");
  assert.match(del, /RAISE EXCEPTION 'PERIOD_LOCKED/, "งวดปิด → RAISE");
  assert.match(del, /RETURN OLD/, "งวด open → RETURN OLD (อนุญาตลบ)");
});

test("ยังคงอนุญาต void/unvoid soft-update ในงวดปิด (ไม่ทำ regression 88-19b)", () => {
  assert.match(periodSql, /OLD\.status = 'approved' AND NEW\.status = 'void'/);
  assert.match(periodSql, /OLD\.status = 'void' AND NEW\.status = 'approved'/);
});

// ── #4: service_jobs INSERT close guard ──────────────────────
const svcSql = read("supabase-phase551-service-insert-admin-guard.sql");

test("service_jobs มี BEFORE INSERT guard บล็อก non-admin สร้างงาน completion", () => {
  assert.match(svcSql, /BEFORE\s+INSERT\s+ON\s+public\.service_jobs/i);
  assert.match(svcSql, /NEW\.status IN \('done', 'delivered', 'closed'\)/);
  assert.match(svcSql, /NOT public\.is_admin\(\)/);
  assert.match(svcSql, /ERRCODE = '42501'/);
});

test("service INSERT guard ยกเว้น service_role (auth.uid() IS NULL = backend เชื่อถือได้)", () => {
  assert.match(svcSql, /auth\.uid\(\) IS NOT NULL/);
});
