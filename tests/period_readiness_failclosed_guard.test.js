// Phase 579 — period-close-readiness fail-closed (accounting blocker)
//
// Why: close-readiness ของ "ปิดงวดบัญชี" (periods.js · fetchCloseReadiness) เดิม 2 จุด "fail-safe-green":
//   (a) completeness — fetch source ids ไม่มี limit (cap 1000) + id=in.(1000) URL ยาว → !ok/catch เงียบ
//       → orphanSrc คง 0 = การ์ดเขียว "ปิดงวดได้ ✅" ทั้งที่ตรวจไม่ครบ.
//   (b) orphan JV — journal_entries ไม่มี limit (cap 1000) + existence check `er.ok ? Set : new Set(uniq)`
//       (fail → ถือว่ามีครบ) + catch เงียบ → orphanJV คง 0 = เขียว.
//   เทียบ (c) service ที่ทำถูก: fetch fail → serviceUnknown=true → ไม่เขียว.
// แก้: (a)/(b) fail-CLOSED เหมือน (c) — ตรวจไม่ได้/เกิน cap = unknown = ไม่เขียว + ⚠️; paginate + batch id-in.
// Run: node --test tests/period_readiness_failclosed_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _monthNeedsAttention, _readinessLinesHtml } from "../modules/accounting/periods.js";

const src = fs.readFileSync(path.resolve("modules/accounting/periods.js"), "utf8");
// ตัด body ของ fetchCloseReadiness (จาก decl ถึง function ถัดไป) — assert internals แบบ scoped
function readinessBody() {
  const start = src.indexOf("async function fetchCloseReadiness");
  assert.notEqual(start, -1, "ต้องมี fetchCloseReadiness");
  const end = src.indexOf("\nasync function lockPeriod", start);
  return src.slice(start, end === -1 ? undefined : end);
}
const rb = readinessBody();

// ═══ behavioral: pure consumers ต้อง fail-CLOSED เมื่อ unknown ═══
const GREEN = { orphanSrc: 0, orphanJV: 0, serviceMissing: 0, serviceUnknown: false, srcUnknown: false, jvUnknown: false };

test("green (ตรวจครบ 0 orphan) → ไม่ต้อง attention + โชว์ 'ครบ ✅'", () => {
  assert.equal(_monthNeedsAttention(GREEN), false);
  assert.match(_readinessLinesHtml(GREEN), /ครบ ✅/);
});

test("srcUnknown → needs attention + ไม่โชว์ 'ครบ ✅' + มีบรรทัด ⚠️ unknown", () => {
  const rd = { ...GREEN, srcUnknown: true };
  assert.equal(_monthNeedsAttention(rd), true, "srcUnknown ต้องนับเป็น needs-attention (ไม่เขียว)");
  assert.ok(!_readinessLinesHtml(rd).includes("ครบ ✅"), "unknown ห้ามโชว์ 'ครบ ✅'");
  assert.match(_readinessLinesHtml(rd), /ตรวจบิลไม่ได้ \(unknown\)/, "ต้องมีบรรทัดเตือน unknown ของบิล");
});

test("jvUnknown → needs attention + ไม่โชว์ 'ครบ ✅' + มีบรรทัด ⚠️ unknown", () => {
  const rd = { ...GREEN, jvUnknown: true };
  assert.equal(_monthNeedsAttention(rd), true, "jvUnknown ต้องนับเป็น needs-attention (ไม่เขียว)");
  assert.ok(!_readinessLinesHtml(rd).includes("ครบ ✅"), "unknown ห้ามโชว์ 'ครบ ✅'");
  assert.match(_readinessLinesHtml(rd), /ตรวจ orphan JV ไม่ได้ \(unknown\)/, "ต้องมีบรรทัดเตือน unknown ของ orphan JV");
});

// ═══ source (a): completeness fail-CLOSED + paginate + batch ═══
test("(a) completeness: fetch fail → srcUnknown (ไม่เหลือ catch เงียบที่ปล่อย orphanSrc=0)", () => {
  assert.match(rb, /catch \(_e\) \{ srcUnknown = true; \}/, "catch ของ (a) ต้อง set srcUnknown (fail-closed)");
  assert.ok(!/catch \(_e\) \{ \/\* fail-safe: ข้าม/.test(rb), "ต้องไม่เหลือ catch{ข้ามเงียบ} เดิม");
  // ต้อง paginate (ใช้ helper) + ไม่ยิง fetch ดิบเปล่า ๆ ที่ !ok→continue เงียบ
  assert.ok(!/if \(!vr\.ok\) continue;/.test(rb), "ต้องไม่เหลือ !vr.ok continue (ข้ามเงียบ)");
  assert.ok(!/if \(!rr\.ok\) continue;/.test(rb), "ต้องไม่เหลือ !rr.ok continue (ข้ามเงียบ)");
});

// ═══ source (b): orphan JV fail-CLOSED (เลิก fail-safe-green) ═══
test("(b) orphan JV: existence fail → jvUnknown (ไม่เหลือ ': new Set(uniq)' fail-safe-green)", () => {
  assert.match(rb, /catch \(_e\) \{ jvUnknown = true; \}/, "catch ของ (b) ต้อง set jvUnknown (fail-closed)");
  assert.ok(!/er\.ok \? new Set\([\s\S]*?\) : new Set\(uniq\)/.test(rb), "ต้องไม่เหลือ er.ok? Set : new Set(uniq) (ถือว่ามีครบ = เขียวหลอก)");
});

// ═══ source: paginate + chunk id-in (เกิน 1000/URL ยาว) ═══
test("paginate + batch: ใช้ fetchAllRowsRaw + chunk id=in.(...)", () => {
  assert.match(src, /import \{ fetchAllRowsRaw \} from "\.\.\/fetch_paginated\.js"/, "ต้อง import fetchAllRowsRaw (paginated + throw-on-error)");
  assert.match(rb, /await fetchAllRowsRaw\(/, "source/JE fetch ต้อง paginate ผ่าน fetchAllRowsRaw");
  assert.match(rb, /const ID_CHUNK = \d+;/, "ต้องมี ID_CHUNK สำหรับ batch id-in");
  assert.match(rb, /i \+= ID_CHUNK/, "ต้อง loop chunk id-in (กัน URL ยาว)");
  assert.match(rb, /&limit=\$\{lim\}&offset=\$\{off\}/, "urlFor ต้องมี limit/offset (offset paging)");
  assert.match(rb, /order=id\.asc/, "ต้อง order by PK ให้ offset paging เสถียร");
});

// ═══ source: return + ready + isReadinessBlocking + issues รวม srcUnknown/jvUnknown ═══
test("return + ready รวม srcUnknown/jvUnknown (unknown ใด ๆ = ไม่เขียว)", () => {
  assert.match(rb, /orphanSrc, orphanJV, serviceMissing, serviceUnknown, srcUnknown, jvUnknown,/, "return ต้องมี srcUnknown+jvUnknown");
  assert.match(rb, /ready: orphanSrc === 0 && orphanJV === 0 && serviceMissing === 0 && !serviceUnknown && !srcUnknown && !jvUnknown/,
    "ready ต้อง && !srcUnknown && !jvUnknown");
});

test("_monthNeedsAttention (isReadinessBlocking) + lock-confirm issues รวม srcUnknown/jvUnknown", () => {
  assert.match(src, /rd\.orphanJV > 0 \|\| rd\.srcUnknown \|\| rd\.jvUnknown/, "_monthNeedsAttention ต้องรวม srcUnknown/jvUnknown");
  // lock-confirm dialog (consumer ที่ 3) ต้องไม่บอก 'พร้อมปิด' หลอกตอน unknown
  assert.match(src, /if \(rd && rd\.srcUnknown\) issues\.push/, "confirm issues ต้องมี srcUnknown");
  assert.match(src, /if \(rd && rd\.jvUnknown\) issues\.push/, "confirm issues ต้องมี jvUnknown");
});

// ═══ ไม่แตะของที่สั่งห้าม ═══
test("ไม่แตะ Dr=Cr balance check / (c) service fail-closed เดิม", () => {
  assert.match(src, /serviceUnknown = true;/, "(c) service fail-closed เดิมต้องคงอยู่");
  assert.match(src, /const svc = await fetchServiceJVStatus\(/, "(c) fetchServiceJVStatus เดิมต้องคงอยู่");
});
