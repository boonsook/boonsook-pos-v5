// Phase 410 — Revert stock on POS bill delete: CAS + idempotent marker guard
// invariant: ลบบิล 1 ครั้ง = สต็อกคืนครั้งเดียวเป๊ะต่อ item
//   (1) ทุก stock write ใน _revertStockForSale ผ่าน _atomicAddStock (CAS) — ห้าม absolute xhrPatch จาก cache
//   (2) idempotency marker [คืนสต็อกแล้ว] (_STOCK_RETURNED_MARKER): เช็คก่อนคืน (no-op ถ้าเคยคืน) + แปะหลังคืน
//   (3) Phase 499: gate = atomic claim (conditional PATCH stock_reverted_at=is.null) — claim ล้ม → fail-closed (return ok:false ไม่เดินหน้า revert)
//   (4) sales.js delete handler: pre-check [ลบแล้ว] ก่อน confirm + newNote เป็น append (ไม่ทับ note เดิม)
//
// Source-regex (iron rule #5: extract เฉพาะ body ของ function/handler เป้าหมายก่อน assert — ห้าม grep ทั้งไฟล์)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

// ดึง source ของ 1 ฟังก์ชัน (จาก decl ถึง decl ของฟังก์ชันถัดไป)
function fnSource(src, decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const after = src.indexOf("\nasync function ", start + decl.length);
  const end = after === -1 ? src.indexOf("\nfunction ", start + decl.length) : after;
  return src.slice(start, end === -1 ? undefined : end);
}

// ดึง delete-handler ของ sales.js (arrow callback — จาก selector จนถึง section ถัดไป)
function deleteHandler(src) {
  const start = src.indexOf('document.querySelectorAll("[data-del-sale]")');
  assert.notEqual(start, -1, "ไม่พบ [data-del-sale] handler");
  const end = src.indexOf("btn.textContent = \"🗑️ ลบ\";", start);
  assert.notEqual(end, -1, "ไม่พบจุดจบ delete handler (reset button)");
  return src.slice(start, end);
}

const revertFn = fnSource(read("main.js"), "async function _revertStockForSale({ saleId, orderNo }) {");
const handler = deleteHandler(read("modules/sales.js"));

test("_revertStockForSale: stock writes ทุกจุดผ่าน CAS (_atomicAddStock) ไม่มี absolute xhrPatch", () => {
  assert.match(revertFn, /_atomicAddStock\("warehouse_stock"/, "warehouse branch ต้องคืนผ่าน _atomicAddStock");
  assert.match(revertFn, /_atomicAddStock\("products"/, "legacy branch ต้องคืนผ่าน _atomicAddStock");
  assert.ok(!revertFn.includes('xhrPatch("warehouse_stock"'), "ห้าม absolute xhrPatch(warehouse_stock) จาก cache");
  assert.ok(!revertFn.includes('xhrPatch("products"'), "ห้าม absolute xhrPatch(products) จาก cache");
});

test("_revertStockForSale: idempotency marker — เช็คก่อนคืน (no-op) + แปะหลังคืน", () => {
  // gate: note มี marker → return skipped (ไม่คืนซ้ำ)
  const gate = revertFn.match(/if\s*\(saleNote\.includes\(_STOCK_RETURNED_MARKER\)\)\s*\{([\s\S]*?)\}/);
  assert.ok(gate, "ต้องมี gate เช็ค saleNote.includes(_STOCK_RETURNED_MARKER)");
  assert.match(gate[1], /skipped:\s*true/, "gate ต้อง return skipped:true (no-op)");
  assert.match(gate[1], /reverted:\s*0/, "gate ต้อง return reverted:0");
  // append: หลังคืนสำเร็จ (revertedCount > 0) → PATCH sales.note ต่อท้ายด้วย marker
  const append = revertFn.match(/if\s*\(revertedCount\s*>\s*0\)\s*\{[\s\S]*?xhrPatch\("sales",\s*\{\s*note:[\s\S]*?_STOCK_RETURNED_MARKER/);
  assert.ok(append, "ต้องแปะ marker ผ่าน xhrPatch(sales, {note: ...marker}) เมื่อ revertedCount > 0");
});

test("_revertStockForSale: claim gate ล้ม → fail-closed (return ok:false)", () => {
  // Phase 499: gate เปลี่ยนจาก marker-check GET → atomic claim (conditional PATCH).
  //   invariant เดิมคงไว้: claim HTTP fail / bad response / exception → return ok:false ไม่เดินหน้า revert.
  const failPaths = revertFn.match(/return\s*\{\s*ok:\s*false,\s*error:\s*"เคลมสถานะคืนสต็อกไม่ได้/g) || [];
  assert.ok(failPaths.length >= 3, `claim gate ต้อง fail-closed ครบ (HTTP/bad response/exception) — พบ ${failPaths.length}/3`);
});

test("_revertStockForSale: CAS fail = ข้าม item (return {ok:false} ก่อน log movement, ไม่นับ reverted)", () => {
  // Phase 477: per-item restock ย้ายเข้า nested restockProduct() (ใช้ทั้ง non-bundle + bundle children).
  //   invariant เดิมคงไว้: CAS fail → return {ok:false,error} "ก่อน" ถึง xhrPost("stock_movements") →
  //   ไม่ log movement หลอก; caller นับ revertedCount เฉพาะ rr.ok → ไม่นับ item ที่ CAS fail.
  assert.match(revertFn, /warehouse_stock CAS fail/, "warehouse branch มี CAS fail handling");
  assert.match(revertFn, /products\.stock CAS fail/, "legacy branch มี CAS fail handling");
  const casReturns = revertFn.match(/if \(!add2?\.ok\) return \{ ok: false/g) || [];
  assert.ok(casReturns.length >= 2, `CAS fail ทั้ง warehouse + legacy branch ต้อง return ok:false — พบ ${casReturns.length}/2`);
  assert.match(revertFn, /if \(rr\.ok\) revertedCount\+\+/, "caller นับ revertedCount เฉพาะตอน restock สำเร็จ (rr.ok)");
});

test("sales.js delete handler: pre-check [ลบแล้ว] ก่อน confirm + ก่อน PATCH", () => {
  const precheckIdx = handler.indexOf('includes("[ลบแล้ว]")');
  const confirmIdx = handler.indexOf("window.App?.confirm?.");
  const patchIdx = handler.indexOf("note: newNote");
  assert.notEqual(precheckIdx, -1, "ต้องมี pre-check note [ลบแล้ว]");
  assert.ok(precheckIdx < confirmIdx, "pre-check ต้องมาก่อน confirm");
  assert.ok(precheckIdx < patchIdx, "pre-check ต้องมาก่อน PATCH sales");
  // pre-check block ต้อง return (ไม่เดินหน้า)
  const block = handler.slice(precheckIdx, confirmIdx);
  assert.match(block, /return\s*;/, "pre-check เจอ [ลบแล้ว] ต้อง return");
});

test("sales.js delete handler: newNote เป็น append ต่อ note เดิม (ไม่เขียนทับ)", () => {
  assert.match(
    handler,
    /const newNote = \(targetSale\?\.note \? targetSale\.note \+ " " : ""\) \+ "\[ลบแล้ว\]/,
    "newNote ต้อง prefix ด้วย note เดิม (เก็บ marker [คืนสต็อกแล้ว] ไม่ให้ถูกล้าง)"
  );
});

test("negative: ส่วนที่แก้ไม่มี alert(", () => {
  assert.ok(!/\balert\(/.test(revertFn), "_revertStockForSale ห้ามมี alert()");
  assert.ok(!/\balert\(/.test(handler), "delete handler ห้ามมี alert()");
});
