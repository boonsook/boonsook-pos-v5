// Phase 575 / build 575 — receipts multi-payment PATCH result check (money/GL)
// Run: node --test tests/receipts_multipay_patch_guard.test.js
//
// Why (money/GL blocker): handler บันทึก multi-payment (ใต้ _multiPayGuard) เดิมเรียก
//   await window._appXhrPatch?.("receipts", patchBody, "id", r.id) โดย "ไม่เช็คผล".
//   xhrPatch ไม่เคย throw — คืน {ok:false} ทั้ง RLS/network/timeout/undefined (await undefined) →
//   โค้ดไหลต่อ: mutate r.payments + void/repost JV ตาม method ใหม่ที่ DB ไม่ได้รับ + toast สำเร็จ
//   = GL ไม่ตรงกับ receipts จริง (สำเร็จปลอม). แก้: เช็ค res.ok → throw ก่อนทุก optimistic;
//   catch เดิม rollback ปุ่ม + error toast (บอกสาเหตุจริง).
//   source-structure guard — slice handler ด้วย anchor.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");

// slice multipay save handler (จาก _multiPayGuard.run ถึง initial render)
const s = src.indexOf("_multiPayGuard.run(async");
assert.ok(s >= 0, "multipay save handler (_multiPayGuard.run) must exist");
const e = src.indexOf("// initial render so rows show", s);
const H = src.slice(s, e > s ? e : s + 2500);

test("Phase 575 — PATCH เก็บผล + throw เมื่อ !res.ok (ก่อนทุก optimistic)", () => {
  assert.match(H, /const res = await window\._appXhrPatch\?\.\("receipts", patchBody, "id", r\.id\)/,
    "ต้องเก็บผล PATCH ใส่ const res");
  assert.match(H, /if \(!res\?\.ok\) throw new Error\(/,
    "ต้อง throw เมื่อ PATCH ไม่สำเร็จ (xhrPatch ไม่ throw เอง)");
});

test("Phase 575 — เช็ค res 'ก่อน' mutate r.payments + repost JV + toast (source order)", () => {
  const checkIdx = H.indexOf("if (!res?.ok) throw");
  const mutateIdx = H.indexOf("r.payments = payments");
  const repostIdx = H.indexOf("_repostReceiptJvIfChanged");
  const toastIdx = H.indexOf('showToast?.("บันทึกการชำระเงินแล้ว');
  assert.ok(checkIdx >= 0 && mutateIdx > checkIdx, "res-check ต้องมาก่อน mutate r.payments");
  assert.ok(repostIdx > checkIdx, "res-check ต้องมาก่อน repost JV (ไม่ void/repost ถ้า DB ไม่รับ)");
  assert.ok(toastIdx > checkIdx, "res-check ต้องมาก่อน toast สำเร็จ (ไม่ประกาศสำเร็จปลอม)");
});

test("Phase 575 — ไม่เหลือ await window._appXhrPatch แบบไม่เก็บผลใน handler นี้", () => {
  assert.doesNotMatch(H, /^\s*await window\._appXhrPatch/m,
    "ทุก _appXhrPatch ใน handler ต้องเก็บผล (const res = await ...) — ห้าม await เปลือย");
});

test("Phase 575 — catch ยัง rollback ปุ่ม (saveBtn.disabled = false) + error toast บอกสาเหตุจริง", () => {
  assert.match(H, /catch \(e\)[\s\S]*saveBtn\.disabled = false/, "catch ต้อง restore ปุ่ม");
  assert.match(H, /showToast\?\.\("❌ บันทึกไม่สำเร็จ: " \+ \(e\?\.message/,
    "error toast ต้องบอกสาเหตุจริง (ไม่ hardcode สาเหตุ SQL อย่างเดียว)");
});

test("Phase 575 — ไม่แตะโครง _multiPayGuard / _repostReceiptJvIfChanged (ยังเรียกเหมือนเดิม)", () => {
  assert.match(H, /_multiPayGuard\.run\(async/, "_multiPayGuard.run คงเดิม");
  assert.match(H, /await _repostReceiptJvIfChanged\(r, \{ prevMethod: _prevMethod, newMethod: main\.method/,
    "การเรียก _repostReceiptJvIfChanged คงรูปเดิม (แค่ย้ายมาอยู่หลัง res-check)");
});
