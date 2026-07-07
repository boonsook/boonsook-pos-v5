// Phase 570 — Guard: showRoute คง subpath ใน hash (settings หน้าย่อยไม่เด้งกลับเมนู)
//   root cause เดิม: showRoute เก็บแค่ ?query ทิ้ง subpath → #settings/ac-catalog → #settings
//   → settings/index.js restore เป็น 'main' ตอน background reload. fix = คง hash ทั้งก้อนเมื่อ main route เดิม.
// Run: node --test tests/settings_subpage_hash_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../main.js", import.meta.url), "utf8");

// ── behavioral: จำลองสูตร newHash ตาม source ──────────────────────────────────
function computeNewHash(curHash, route) {
  const curMainRoute = (curHash.replace("#", "").split('/')[0] || "").split('?')[0];
  return (curMainRoute === route && curHash) ? curHash : ("#" + route);
}

test("main route เดิม → คง subpath (settings/ac-catalog ไม่เด้ง)", () => {
  assert.equal(computeNewHash("#settings/ac-catalog", "settings"), "#settings/ac-catalog");
});
test("main route เดิม → คง subpath + query", () => {
  assert.equal(computeNewHash("#settings/ac-catalog?x=1", "settings"), "#settings/ac-catalog?x=1");
});
test("query-only route ยังคง query (ไม่ regress deep-link params)", () => {
  assert.equal(computeNewHash("#products?cat=X", "products"), "#products?cat=X");
});
test("route เปลี่ยนจริง → เขียน #route ใหม่ (ทิ้ง subpath หน้าเดิม)", () => {
  assert.equal(computeNewHash("#settings/ac-catalog", "products"), "#products");
});
test("hash ว่าง → #route", () => {
  assert.equal(computeNewHash("", "settings"), "#settings");
});
test("settings ไม่มี subpath → คงเดิม", () => {
  assert.equal(computeNewHash("#settings", "settings"), "#settings");
});

// ── source-regex: ผูกสูตรกับ showRoute จริง + ไม่เหลือ keepQuery เดิม ──────────
function slice(from, to) {
  const i = MAIN.indexOf(from);
  assert.ok(i >= 0, `anchor เริ่มไม่พบ: ${from}`);
  const j = MAIN.indexOf(to, i + from.length);
  assert.ok(j > i, `anchor จบไม่พบ: ${to}`);
  return MAIN.slice(i, j);
}
const block = slice("const curHash = location.hash", "// Toggle page sections");

test("showRoute ใช้สูตร newHash คง hash ทั้งก้อนเมื่อ main route เดิม", () => {
  assert.match(block, /const newHash = \(curMainRoute === route && curHash\) \? curHash : \("#" \+ route\)/);
  assert.match(block, /history\.replaceState\(null, "", newHash\)/);
});
test("showRoute ไม่เหลือ keepQuery เดิม (เก็บแค่ ?query ทิ้ง subpath)", () => {
  assert.doesNotMatch(block, /keepQuery/);
});
