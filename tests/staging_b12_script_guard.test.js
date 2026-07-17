// ═════════════════════════════════════════════════
//  Phase 606-B12 — guard: staging verify script ต้องปลอดภัย/ครบตาม spec
// ═════════════════════════════════════════════════
//  ล็อก invariant ของ staging-verify-b12-flow-immutable.sql:
//  - ทุก DO block มี PRODUCTION INTERLOCK (นับ block = นับ interlock)
//  - DISABLE TRIGGER มีจุดเดียว = trg_service_jobs_metadata_update_guard และ
//    ENABLE + VERIFY tgenabled ตามหลังในบล็อกเดียวกัน (order check)
//  - ห้าม DISABLE trigger ฝั่ง journal (นั่นคือของที่พิสูจน์)
//  - ห้าม WHEN OTHERS ทั้งไฟล์ (expected-exception = insufficient_privilege เท่านั้น)
//  - message assert ครบ: a/b/c = freeze downgrade · d = total_cost + status matrix · e = 606-a gate
//  - ไม่แตะตาราง production-critical นอกรายการ
//  - header ประกาศ STAGING ONLY + ชื่อไฟล์ไม่ขึ้นต้น supabase-
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = "staging-verify-b12-flow-immutable.sql";
const SQL = fs.readFileSync(path.join(ROOT, FILE), "utf8");
// โค้ดจริงไม่รวม comment — ใช้กับ check ที่ comment อาจ mention คำต้องห้ามโดยชอบธรรม
const SQL_CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// DO blocks — dollar-quote tag ขึ้นต้น b12 ทุกบล็อก (b12s1..s3, b12a..e, b12t)
const BLOCKS = [...SQL.matchAll(/DO \$(b12[a-z0-9]+)\$([\s\S]*?)\$\1\$;/g)]
  .map((m) => ({ tag: m[1], body: m[2] }));

test("G1. โครงไฟล์: header STAGING ONLY + ชื่อไฟล์ไม่ขึ้นต้น supabase- + มี DO block ครบ 9", () => {
  assert.match(SQL.split("\n")[0], /^-- STAGING ONLY/, "บรรทัดแรกต้องประกาศ STAGING ONLY");
  assert.ok(!FILE.startsWith("supabase-"), "ชื่อไฟล์ห้ามขึ้นต้น supabase- (กันสับสนกับ prod migration)");
  assert.ok(!fs.existsSync(path.join(ROOT, "supabase-staging-verify-b12-flow-immutable.sql")),
    "ห้ามมีสำเนาชื่อ supabase-*");
  const tags = BLOCKS.map((b) => b.tag);
  assert.deepEqual(tags, ["b12s1", "b12s2", "b12s3", "b12a", "b12b", "b12c", "b12d", "b12e", "b12t"],
    "DO blocks ต้องครบ: seed 3 + case 5 + teardown 1 (เรียงตามลำดับรัน)");
});

test("G2. ทุก DO block มี PRODUCTION INTERLOCK (sentinel + confirm_text วันนี้ + default ปฏิเสธ)", () => {
  for (const b of BLOCKS) {
    assert.match(b.body, /_staging_b12_sentinel/, `${b.tag}: ต้องเช็ค sentinel`);
    assert.match(b.body, /confirm_text = 'B12-STAGING-' \|\| to_char\(current_date, 'YYYY-MM-DD'\)/,
      `${b.tag}: ต้องเทียบ confirm_text กับวันนี้เป๊ะ`);
    assert.match(b.body, /WHEN undefined_table THEN\s*\n\s*RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง/,
      `${b.tag}: ไม่มีตาราง sentinel = ปฏิเสธ (ห้ามผ่านเงียบ)`);
    assert.match(b.body, /IF NOT v_staging_ok THEN\s*\n\s*RAISE EXCEPTION 'B12 INTERLOCK/,
      `${b.tag}: confirm_text ไม่ตรง = ปฏิเสธ`);
    // interlock ต้องมาก่อนการกระทำใด ๆ กับตารางงาน/บัญชี
    const ilPos = b.body.indexOf("_staging_b12_sentinel");
    for (const t of ["service_jobs", "journal_entries", "journal_lines"]) {
      const p = b.body.indexOf("public." + t);
      if (p >= 0) assert.ok(ilPos < p, `${b.tag}: interlock ต้องมาก่อนการแตะ ${t}`);
    }
  }
});

test("G3. DISABLE TRIGGER มีจุดเดียว (metadata_update_guard ใน b12s2) + ENABLE + VERIFY ตามหลัง", () => {
  const disables = [...SQL.matchAll(/DISABLE TRIGGER (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(disables, ["trg_service_jobs_metadata_update_guard"],
    "DISABLE TRIGGER ต้องมีตัวเดียวทั้งไฟล์ และเป็น metadata_update_guard เท่านั้น");
  const s2 = BLOCKS.find((b) => b.tag === "b12s2").body;
  const posDisable = s2.indexOf("DISABLE TRIGGER trg_service_jobs_metadata_update_guard");
  const posUpdate = s2.indexOf("SET finance_flow_version = 2");
  const posEnable = s2.indexOf("ENABLE TRIGGER trg_service_jobs_metadata_update_guard");
  const posVerify = s2.indexOf("tgenabled");
  assert.ok(posDisable > 0 && posUpdate > posDisable && posEnable > posUpdate && posVerify > posEnable,
    "b12s2 ต้องเรียง DISABLE → UPDATE → ENABLE → VERIFY tgenabled ในบล็อกเดียว (transaction เดียว)");
  assert.match(s2, /IF v_enabled IS DISTINCT FROM 'O' THEN/, "VERIFY ต้อง assert tgenabled='O' จริง");
});

test("G4. ห้ามแตะ trigger ฝั่ง journal + ห้าม DROP/TRUNCATE ใด ๆ", () => {
  assert.doesNotMatch(SQL, /ALTER TABLE[^;]*journal_(entries|lines)[^;]*(DISABLE|ENABLE) TRIGGER/i,
    "ห้าม disable/enable trigger บน journal_* — นั่นคือของที่กำลังพิสูจน์");
  assert.doesNotMatch(SQL, /\bTRUNCATE\b/i, "ห้าม TRUNCATE");
  assert.doesNotMatch(SQL, /\bDROP\s+(TABLE|TRIGGER|FUNCTION|INDEX)\b/i, "ห้าม DROP ใด ๆ ใน script (cleanup อยู่ใน runbook)");
});

test("G5. ห้าม WHEN OTHERS ทั้งไฟล์ — expected-exception = insufficient_privilege เท่านั้น", () => {
  assert.doesNotMatch(SQL_CODE, /WHEN\s+OTHERS/i, "ห้าม WHEN OTHERS (กลืน error ต่างชนิด = false-pass)");
  for (const tag of ["b12a", "b12b", "b12c", "b12e"]) {
    const b = BLOCKS.find((x) => x.tag === tag).body;
    assert.match(b, /EXCEPTION WHEN insufficient_privilege THEN/,
      `${tag}: expected-exception ต้องจับเฉพาะ insufficient_privilege (42501)`);
  }
  const d = BLOCKS.find((x) => x.tag === "b12d").body;
  assert.equal((d.match(/EXCEPTION WHEN insufficient_privilege THEN/g) || []).length, 2,
    "b12d: ต้องมี expected-exception 2 จุด (d3 total_cost + d4 delivered->done)");
});

test("G6. message assert ครบทุกเคส — พิสูจน์ 42501 มาจาก guard ตัวที่คาด", () => {
  for (const tag of ["b12a", "b12b", "b12c"]) {
    const b = BLOCKS.find((x) => x.tag === tag).body;
    assert.match(b, /position\('เปลี่ยน finance_flow_version ไม่ได้' IN v_msg\)/,
      `${tag}: ต้อง assert message ของ v2_freeze downgrade clause (b1.1) — metadata guard ปล่อย system ผ่าน`);
  }
  const d = BLOCKS.find((x) => x.tag === "b12d").body;
  assert.match(d, /position\('แก้ยอดเงินไม่ได้' IN v_msg\)/, "b12d(d3): assert message freeze total_cost");
  assert.match(d, /position\('เปลี่ยนสถานะงานที่ลงบัญชี' IN v_msg\)/, "b12d(d4): assert message transition matrix");
  const e = BLOCKS.find((x) => x.tag === "b12e").body;
  assert.match(e, /position\('ยังเปิด finance flow v2 ไม่ได้' IN v_msg\)/,
    "b12e: assert message activation gate 606-a");
});

test("G7. zero-writes + fail-loud: ทุก case มี snapshot je/jl + assert no-exception = FAIL", () => {
  for (const tag of ["b12a", "b12b", "b12c", "b12e"]) {
    const b = BLOCKS.find((x) => x.tag === tag).body;
    assert.match(b, /SELECT count\(\*\) INTO v_je FROM public\.journal_entries/, `${tag}: ต้อง snapshot je count`);
    assert.match(b, /IF v_je2 <> v_je OR v_jl2 <> v_jl THEN/, `${tag}: ต้อง assert je/jl ไม่ขยับ`);
    assert.match(b, /IF NOT v_caught THEN\s*\n\s*RAISE EXCEPTION '[^']*FAIL/,
      `${tag}: ไม่เกิด exception = ต้อง FAIL ดัง (guard ไม่ทำงาน)`);
  }
});

test("G8. seed ถูกต้อง: status 'progress' (ไม่ใช่ in_progress) · J2 delivered · JV header+lines บล็อกเดียว · B12TEST- prefix", () => {
  const s1 = BLOCKS.find((x) => x.tag === "b12s1").body;
  assert.match(s1, /'B12TEST-J1'[^;]*'progress'/s, "J1 ต้อง status='progress' (DB constraint ไม่รับ in_progress)");
  assert.doesNotMatch(SQL_CODE, /'in_progress'/, "ห้ามใช้ in_progress — 400 จาก DB constraint (Phase 383)");
  assert.match(s1, /'B12TEST-J2'[^;]*'delivered'/s, "J2 ต้อง delivered (B12d matrix เริ่มจาก delivered)");
  const s3 = BLOCKS.find((x) => x.tag === "b12s3").body;
  assert.match(s3, /INSERT INTO public\.journal_entries[\s\S]*INSERT INTO public\.journal_lines/,
    "JV header + lines ต้องอยู่ DO block เดียว (deferred balance trigger เช็คตอน COMMIT)");
  assert.match(s3, /'approved'/, "recognition JV ต้อง status=approved");
  assert.match(s3, /'1200'[\s\S]*'4220'/, "lines ต้อง Dr 1200 / Cr 4220");
  assert.match(s3, /total_debit, total_credit[\s\S]*v_total, v_total/, "header totals ต้อง = Σ lines เป๊ะ");
  // ทุกแถวทดสอบใช้ B12TEST- (derive จับแค่ ^(AI|SH)- → ได้ service ไม่ชน web_order)
  const jobNos = [...SQL.matchAll(/'(B12TEST-[A-Z0-9]+)'/g)].map((m) => m[1]);
  assert.ok(jobNos.length >= 4, "ต้องมี B12TEST-J1/J2/J3/JV1");
  assert.doesNotMatch(SQL, /job_no[^;]*'(AI|SH)-/, "ห้ามใช้ prefix AI-/SH- (จะ derive เป็น web_order)");
});

test("G9. ไม่แตะตาราง production-critical นอกรายการ + teardown ลบเฉพาะ B12TEST-*", () => {
  for (const t of ["sales", "customers", "products", "warehouse_stock", "receipts", "expenses",
                   "staff", "profiles", "loyalty_transactions", "stock_movements", "sale_items",
                   "service_payments", "service_payment_reversals", "account_mapping", "accounting_periods"]) {
    const re = new RegExp("(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?" + t + "\\b", "i");
    assert.doesNotMatch(SQL, re, `ห้ามเขียนตาราง ${t}`);
  }
  const td = BLOCKS.find((x) => x.tag === "b12t").body;
  assert.match(td, /DELETE FROM public\.journal_lines\s*\n\s*WHERE entry_id IN \(SELECT id FROM public\.journal_entries WHERE doc_no LIKE 'B12TEST-%'\)/,
    "teardown: journal_lines เฉพาะของ B12TEST JV");
  assert.match(td, /DELETE FROM public\.journal_entries WHERE doc_no LIKE 'B12TEST-%'/);
  assert.match(td, /DELETE FROM public\.service_jobs WHERE job_no LIKE 'B12TEST-%'/);
  const deletes = [...SQL.matchAll(/DELETE FROM/g)];
  assert.equal(deletes.length, 3, "DELETE ต้องมี 3 จุด (teardown เท่านั้น)");
  assert.match(td, /tgenabled IS DISTINCT FROM 'O'/, "teardown ต้อง verify trigger ทุกตัว enabled=O");
});

test("G11. B12d: ลำดับ sub-test ล็อกตายตัว + exact-transition assert + status ยัง delivered หลัง d4", () => {
  const d = BLOCKS.find((x) => x.tag === "b12d").body;
  // closed = terminal (matrix block closed→*) — d5 ต้องเป็นการกระทำสุดท้าย ไม่งั้น sub-test ถัดไปกลายเป็นคนละ case เงียบ ๆ
  const p1 = d.indexOf("d1: J1 note");
  const p2 = d.indexOf("d2: J2 note");
  const p3 = d.indexOf("d3: J2 total_cost");
  const p4 = d.indexOf("d4: J2 delivered→done");
  const p5 = d.indexOf("d5: J2 delivered→closed");
  assert.ok(p1 > 0 && p2 > p1 && p3 > p2 && p4 > p3 && p5 > p4,
    "ลำดับต้องเป็น note(J1)→note(J2)→total_cost→delivered→done→delivered→closed (closed สุดท้ายเท่านั้น)");
  const lastUpdate = d.lastIndexOf("UPDATE public.service_jobs");
  assert.ok(lastUpdate > p5, "UPDATE สุดท้ายของบล็อกต้องเป็น d5 (set closed)");
  assert.match(d, /position\('จาก delivered เป็น done' IN v_msg\)/,
    "d4 ต้อง assert exact transition จาก message (มี from/to ในตัว — ไม่พึ่งลำดับ)");
  const p4status = d.indexOf("status ต้องยัง delivered หลังโดน block");
  assert.ok(p4status > p4 && p4status < p5, "d4 ต้อง re-read status = delivered ก่อนเข้า d5");
});

test("G12. B12c: handler ของตัวเองเจาะจง insufficient_privilege (แยกจาก handler อื่น — 42501 ≠ 23502)", () => {
  const c = BLOCKS.find((x) => x.tag === "b12c").body;
  const posBegin = c.indexOf("BEGIN\n    UPDATE public.service_jobs SET finance_flow_version = NULL");
  const posHandler = c.indexOf("EXCEPTION WHEN insufficient_privilege THEN", posBegin);
  const posEnd = c.indexOf("END;", posHandler);
  assert.ok(posBegin > 0, "b12c ต้องมี sub-block ครอบ UPDATE 2->NULL ของตัวเอง");
  assert.ok(posHandler > posBegin && posEnd > posHandler,
    "handler insufficient_privilege ต้องเป็นของ sub-block นี้เอง (ห้ามเขียนรวบกับเคสอื่น)");
  assert.match(c, /23502/, "b12c ต้องระบุใน comment/assert ว่า 23502 = ปล่อยล้มดัง ไม่ถูกจับ");
  assert.doesNotMatch(c.slice(posBegin, posEnd), /WHEN\s+not_null_violation/i,
    "ห้ามจับ not_null_violation — 23502 ต้องล้มทั้งบล็อกให้เห็น");
});

test("G13. zero-writes ใช้เฉพาะคอลัมน์ที่ยืนยันว่ามี — ห้ามอ้าง updated_at ทั้งไฟล์", () => {
  assert.doesNotMatch(SQL_CODE, /updated_at/i,
    "ห้ามอ้าง updated_at ในโค้ดจริง — service_jobs ไม่มี DDL ในรีโป และไม่มีโค้ด/SQL ใดอ้าง " +
    "service_jobs.updated_at (grep = 0 hit เฉพาะ service_jobs; ตารางอื่นมีใช้ปกติ) " +
    "= ไม่มีหลักฐานว่าคอลัมน์นี้มีบนตารางนี้ (comment ใน SQL อธิบายเหตุผลได้)");
  for (const tag of ["b12a", "b12b", "b12c"]) {
    const b = BLOCKS.find((x) => x.tag === tag).body;
    assert.match(b, /finance_flow_version = 2\s*\n?\s*AND status = v_status AND total_cost = v_cost AND note IS NOT DISTINCT FROM v_note/,
      `${tag}: re-read ต้องเทียบ flow/status/total_cost/note ครบ`);
  }
});

test("G14. runbook มี STEP 0 introspection (read-only บน production) + คำเตือน auth.uid() default", () => {
  const rb = fs.readFileSync(path.join(ROOT, "STAGING_B12_RUNBOOK.md"), "utf8");
  assert.match(rb, /information_schema\.columns/, "ต้องมี introspection query");
  assert.match(rb, /table_name IN \('service_jobs', 'journal_entries', 'journal_lines'\)/,
    "introspection ต้องครอบ 3 ตารางที่ seed แตะ");
  assert.match(rb, /is_nullable, column_default/, "ต้องดึง nullable + default มาตรวจ");
  assert.match(rb, /auth\.uid\(\)[\s\S]{0,120}NULL[\s\S]{0,200}explicit/,
    "ต้องเตือน: NOT NULL default อิง auth.uid() → SQL Editor ใช้ default ไม่ได้ ต้อง supply explicit");
});

test("G10. runbook มีจริง + sentinel setup อยู่ใน runbook เท่านั้น (ไม่อยู่ใน script)", () => {
  const rb = fs.readFileSync(path.join(ROOT, "STAGING_B12_RUNBOOK.md"), "utf8");
  assert.match(rb, /CREATE TABLE IF NOT EXISTS public\._staging_b12_sentinel/, "runbook ต้องมีขั้นสร้าง sentinel");
  assert.match(rb, /ทาง A[\s\S]*ทาง B/, "runbook ต้องมีทั้งทาง A (preview branch) และทาง B (scratch + pg_dump)");
  assert.match(rb, /chart_of_accounts/, "runbook ต้องระบุตารางที่ dump แบบมี data");
  assert.doesNotMatch(SQL, /CREATE TABLE[^;]*_staging_b12_sentinel/i,
    "script ห้ามสร้าง sentinel เอง (ต้องเป็นการยืนยันด้วยมือของ owner เท่านั้น)");
});
