// Phase 581 — admin-loyalty-full-fetch (companion ของ 580 — staff เห็นแต้มรวมครบ)
//
// Why: renderLoyaltyPage (หน้าแอดมิน) summary (customersWithPoints/totalEarned/totalRedeemed/
// totalRemaining/totalValue) + per-customer อ่านจาก state.loyaltyPoints cap 500 (loadAllData) →
// เมื่อ loyalty rows รวม >500 ตัวเลขต่ำกว่าจริง + "คงเหลือ" ติดลบได้ (earn เก่าหลุดหน้าต่างก่อน redeem).
// staff อ่าน loyalty_points ได้ (ไม่โดน customer-deny Phase 505) → fetch เต็ม paginated แล้ว aggregate
// จากชุดเต็ม (fallback state ระหว่างโหลด/error + ป้าย — mirror dashboard Phase 562). READ-ONLY.
// (แต้มฝั่งลูกค้าแก้แล้ว proxy Phase 580 — เฟสนี้เฉพาะหน้าแอดมิน)
// Run: node --test tests/admin_loyalty_fetch_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/loyalty.js"), "utf8");
// ดึง body ของ 1 ฟังก์ชัน (decl → decl ถัดไป)
function fnBody(decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const cands = [
    src.indexOf("\nfunction ", start + decl.length),
    src.indexOf("\nexport function ", start + decl.length),
    src.indexOf("\nasync function ", start + decl.length),
  ].filter(i => i !== -1);
  return src.slice(start, cands.length ? Math.min(...cands) : undefined);
}
const renderBody = fnBody("export function renderLoyaltyPage");
const loadBody = fnBody("async function _loadAllLoyalty");

// ═══ (1) import + module state ═══
test("import fetchAllRowsRaw + module state (rows/state/seq)", () => {
  assert.match(src, /import \{ fetchAllRowsRaw \} from "\.\/fetch_paginated\.js"/, "ต้อง import fetchAllRowsRaw (paginated)");
  for (const v of ["_loyAllRows", "_loyState", "_loySeq"]) {
    assert.match(src, new RegExp(`let ${v}\\b`), `ต้องประกาศ module-state ${v}`);
  }
});

// ═══ (2) aggregate อ่าน fetched-or-fallback ไม่ใช่ state.loyaltyPoints cap ตรง ๆ ═══
test("renderLoyaltyPage: loyaltyPoints = loaded rows else state fallback (ไม่ aggregate จาก state.loyaltyPoints cap ตรง ๆ)", () => {
  assert.match(renderBody,
    /const loyaltyPoints = \(_loyState === "loaded" && _loyAllRows\) \? _loyAllRows : \(state\.loyaltyPoints \|\| \[\]\)/,
    "source ต้อง fallback state ระหว่างโหลด/error");
  // summary + tab ต้องอ่านจากตัวแปร loyaltyPoints (fetched-or-fallback) — ไม่ใช่ state.loyaltyPoints โดยตรง
  assert.match(renderBody, /const totalEarned = loyaltyPoints\b/, "totalEarned จาก loyaltyPoints (ชุดเต็ม)");
  assert.match(renderBody, /const totalRedeemed = loyaltyPoints\b/, "totalRedeemed จาก loyaltyPoints");
  assert.match(renderBody, /new Set\(\s*loyaltyPoints/, "customersWithPoints จาก loyaltyPoints");
  assert.match(renderBody, /renderSummaryTab\(loyaltyPoints,/, "summary tab รับชุดเต็ม");
  // ไม่เหลือ aggregate ตรงจาก state.loyaltyPoints ใน renderLoyaltyPage (เหลือได้เฉพาะ fallback expr)
  assert.ok(!/state\.loyaltyPoints\s*\.\s*(filter|reduce|forEach|map)/.test(renderBody),
    "ห้าม aggregate ตรงจาก state.loyaltyPoints cap ใน renderLoyaltyPage");
});

// ═══ (3) idle-guard + seq-guard (กัน refetch loop / stale) ═══
test("_loadAllLoyalty: idle-guard (กัน loop) + seq-guard (กัน stale) + paginate", () => {
  assert.match(loadBody, /if \(_loyState !== "idle"\) return;/, "idle-guard กัน refetch loop");
  assert.match(loadBody, /const seq = \+\+_loySeq/, "seq bump");
  assert.match(loadBody, /if \(seq !== _loySeq\) return;/, "stale-guard");
  assert.match(loadBody, /await fetchAllRowsRaw\(/, "ต้อง paginate ผ่าน fetchAllRowsRaw");
  assert.match(loadBody, /loyalty_points\?select=\*&order=created_at\.desc&limit=\$\{lim\}&offset=\$\{off\}/, "urlFor paginated (limit/offset)");
  // kick เฉพาะตอน idle (จาก renderLoyaltyPage)
  assert.match(renderBody, /if \(_loyState === "idle"\) _loadAllLoyalty\(ctx\)/, "render kick load เฉพาะตอน idle");
});

// ═══ (4) error → retry state (ไม่โชว์ตัวเลข cap หลอกแบบไม่มีป้าย) ═══
test("error → ป้าย + ปุ่ม retry (reset idle); loaded → เงียบ", () => {
  assert.match(loadBody, /_loyState = "error";/, "error state");
  assert.match(loadBody, /_loyAllRows = null;/, "error nulls cache (fallback จัดการที่ render)");
  assert.match(renderBody, /_loyState === "loaded" \? "" :/, "loaded → ไม่มีป้าย");
  assert.match(renderBody, /~500 รายการล่าสุด/, "ไม่ loaded → ป้ายบอกว่าเป็น ~500 ล่าสุด (ไม่หลอกว่าครบ)");
  assert.match(renderBody, /loyRetryBtn/, "error → ปุ่ม retry");
  assert.match(renderBody, /_loyState = "idle";[\s\S]{0,60}renderLoyaltyPage\(ctx\)/, "retry reset idle → refetch");
});

// ═══ (5) ไม่แตะของที่สั่งห้าม ═══
test("ไม่แตะ getCustomerPoints / redeem precheck / reverseEarnedPointsForSale (out of scope)", () => {
  // getCustomerPoints ยังอ่าน state (redeem UX precheck — server-enforced Phase 540, ห้ามแตะ)
  assert.match(src, /export function getCustomerPoints\(customerId, ctx\) \{[\s\S]{0,120}state\.loyaltyPoints/, "getCustomerPoints คงเดิม (อ่าน state — precheck)");
  // reverseEarnedPointsForSale อ่าน DB ตรงผ่าน fetchAllRowsRaw อยู่แล้ว (ไม่แตะ)
  assert.match(src, /loyalty_points\?ref_id=eq\./, "reverse flow อ่าน DB ตรงคงเดิม");
});
