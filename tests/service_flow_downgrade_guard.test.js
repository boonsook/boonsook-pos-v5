// ═══════════════════════════════════════════════════════════
//  Phase 606-b1.1 — guard: finance_flow_version = 2 ต้อง immutable (SQL hotfix)
// ═══════════════════════════════════════════════════════════
//  mutation proof: ลบ/ย้าย clause กัน downgrade ออกจากไฟล์ hotfix → test นี้ต้องแดง
//  (ตรวจทั้ง "มี" และ "ตำแหน่งก่อน early return" และ "ไม่ weaken freeze เดิม")
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOTFIX = fs.readFileSync(path.join(ROOT, "supabase-phase606b1-1-service-finance-hotfix.sql"), "utf8");
const B1SQL  = fs.readFileSync(path.join(ROOT, "supabase-phase606b1-service-payment-guards.sql"), "utf8");

// ตัดเฉพาะ body ของ function ใน hotfix (ไม่รวม comment header/VERIFY ท้ายไฟล์)
function fnBody(src) {
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.guard_service_job_v2_freeze()");
  assert.ok(start >= 0, "hotfix ต้อง CREATE OR REPLACE guard_service_job_v2_freeze");
  const end = src.indexOf("END $$;", start);
  assert.ok(end > start);
  return src.slice(start, end);
}

test("G1. clause กัน downgrade มีจริง: OLD=2 + NEW IS DISTINCT FROM OLD → 42501", () => {
  const body = fnBody(HOTFIX);
  assert.match(body,
    /IF OLD\.finance_flow_version = 2\s*\n\s*AND NEW\.finance_flow_version IS DISTINCT FROM OLD\.finance_flow_version THEN\s*\n\s*RAISE EXCEPTION[\s\S]{0,200}ERRCODE = '42501'/,
    "ต้องมี clause immutable flow v2 พร้อม ERRCODE 42501");
});

test("G2. clause ต้องอยู่ก่อน early return และก่อน query JV/ledger ทุกจุด", () => {
  const body = fnBody(HOTFIX);
  const posClause = body.indexOf("NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version");
  const posEarly  = body.indexOf("coalesce(OLD.finance_flow_version, 1) <> 2");
  const posJv     = body.indexOf("journal_entries");
  const posLedger = body.indexOf("service_payments");
  assert.ok(posClause > 0, "ไม่พบ clause");
  assert.ok(posEarly > 0, "ไม่พบ early return เดิม (ห้ามลบ — v1 ต้อง return เร็วเหมือนเดิม)");
  assert.ok(posClause < posEarly, "clause ต้องมาก่อน early return (ไม่งั้น 2→1 หลุดเมื่อ...ลำดับผิด)");
  assert.ok(posJv > 0 && posClause < posJv, "clause ต้องมาก่อน query journal_entries");
  assert.ok(posLedger > 0 && posClause < posLedger, "clause ต้องมาก่อน query service_payments");
});

test("G3. clause ไม่ผูกกับ accounting truth — ห้ามมี v_recognized/v_has_money ก่อน clause", () => {
  const body = fnBody(HOTFIX);
  const posClause = body.indexOf("NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version");
  const beforeClause = body.slice(0, posClause);
  // ก่อน clause ต้องยังไม่มีการ "ใช้" ตัวแปร accounting truth (DECLARE block ไม่นับ — ตัดถึง BEGIN)
  const afterBegin = beforeClause.slice(beforeClause.indexOf("BEGIN"));
  assert.ok(!/SELECT EXISTS/.test(afterBegin),
    "การมี/ไม่มี JV/ledger ต้องไม่เปลี่ยนผลของ 2→1 (clause ต้องตัดสินก่อน query ใด ๆ)");
});

test("G4. freeze เดิมของ 606-b1 ต้องอยู่ครบใน function ใหม่ (replace ห้าม weaken)", () => {
  const body = fnBody(HOTFIX);
  assert.match(body, /NEW\.total_cost IS DISTINCT FROM OLD\.total_cost/);
  assert.match(body, /NEW\.job_type IS DISTINCT FROM OLD\.job_type/);
  assert.match(body, /v_old = 'delivered' AND v_new = 'closed'/);
  assert.match(body, /service_payment_reversals/);
  // ต้องเทียบเท่าเนื้อเดิมใน 606-b1: ทุก RAISE ของเดิมยังอยู่ (นับ ERRCODE 42501 ≥ 4 จุด)
  const raises = (body.match(/ERRCODE = '42501'/g) || []).length;
  assert.ok(raises >= 4, `ต้องมี RAISE 42501 อย่างน้อย 4 จุด (เดิม 3 + downgrade 1) — พบ ${raises}`);
});

test("G5. hotfix แตะเฉพาะ function เดียว: ไม่ DROP trigger/table · ไม่เขียนข้อมูล production", () => {
  // นับเฉพาะส่วน active (ROLLBACK GUIDANCE ใน comment กล่าวถึงชื่อ function ได้)
  const active = HOTFIX.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  assert.equal((active.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1,
    "ต้อง replace แค่ guard_service_job_v2_freeze ตัวเดียว");
  assert.ok(!/DROP TRIGGER|DROP TABLE|DROP FUNCTION/i.test(active),
    "ห้าม DROP ใด ๆ (trigger เดิมชี้ function ชื่อเดิมอยู่แล้ว)");
  // ห้ามเขียนข้อมูลตาราง public (INSERT/UPDATE/DELETE) — ยกเว้น CREATE TEMP TABLE baseline
  assert.ok(!/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\./i.test(active),
    "hotfix ห้ามเขียนข้อมูลตาราง public ใด ๆ");
  assert.match(active, /CREATE TEMP TABLE _hotfix_baseline ON COMMIT DROP/);
});

test("G6. โครง migration: BEGIN/COMMIT เดียว + preflight + POST-CHECK ตำแหน่ง clause + NOTIFY pgrst", () => {
  const active = HOTFIX.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((active.match(/^BEGIN;/gm) || []).length, 1, "ต้องเป็น transaction เดียว");
  assert.equal((active.match(/^COMMIT;/gm) || []).length, 1);
  assert.match(active, /ยังไม่ได้รัน 606-b1/, "preflight ต้องบังคับว่า 606-b1 applied แล้ว");
  assert.match(active, /strpos\(v_def, 'NEW\.finance_flow_version IS DISTINCT FROM OLD\.finance_flow_version'\)/,
    "POST-CHECK ต้องตรวจตำแหน่ง clause จาก definition จริง");
  assert.match(active, /v_pos_clause >= v_pos_early/, "POST-CHECK ต้อง fail เมื่อ clause อยู่หลัง early return");
  assert.match(active, /NOTIFY pgrst, 'reload schema';/);
});

test("G7. รายงานตามจริง: ไฟล์ต้องประกาศ staging behavioral = NOT RUN + ต้องรันก่อน 606-b3", () => {
  assert.match(HOTFIX, /staging behavioral tests = NOT RUN/);
  assert.match(HOTFIX, /ก่อน activation 606-b3/);
});

test("G8. ไฟล์ 606-b1 เดิม (applied แล้ว) ต้องไม่ถูกแก้เนื้อ freeze — hotfix เป็น superset", () => {
  // นิยามเดิมใน b1 ต้องยังไม่มี clause downgrade (พิสูจน์ว่า hotfix ไม่ได้ย้อนแก้ไฟล์ applied)
  const b1Body = B1SQL.slice(B1SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_service_job_v2_freeze()"),
                             B1SQL.indexOf("DROP TRIGGER IF EXISTS trg_service_job_v2_freeze"));
  assert.ok(b1Body.length > 100, "หา function เดิมใน 606-b1 ไม่เจอ");
  assert.ok(!/NEW\.finance_flow_version IS DISTINCT FROM OLD\.finance_flow_version/.test(b1Body),
    "ห้ามย้อนแก้ไฟล์ migration ที่ applied แล้ว — clause ใหม่ต้องอยู่ในไฟล์ hotfix เท่านั้น");
  // และเนื้อเดิมทุก invariant ของ b1 ต้อง carry มาครบใน hotfix (เทียบบรรทัด RAISE เดิม)
  for (const marker of ["NEW.total_cost IS DISTINCT FROM OLD.total_cost",
                        "NEW.job_type IS DISTINCT FROM OLD.job_type",
                        "v_old = 'delivered' AND v_new = 'closed'"]) {
    assert.ok(b1Body.includes(marker) && fnBody(HOTFIX).includes(marker),
      `invariant "${marker}" ต้องอยู่ทั้งใน b1 และ hotfix`);
  }
});
