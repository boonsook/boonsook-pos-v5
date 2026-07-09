// Phase 584 — POS view sticky ตอน background reload
//
// Why: renderPosPage รีเซ็ต posView="home"/numpad/quickPay ทุกครั้งที่เรียก; renderAll() หลัง
// background loadAllData (deferred 10s–2min) เรียก renderPosPage → ผู้ใช้ที่อยู่ numpad/payment/
// search โดนเด้งกลับ home + ดีดสกอลล์. แก้: refreshPosPage() (mirror refreshProductsPage) —
// mid-flow (posView != home) → ไม่ re-render; home → refresh แบนเนอร์เท่านั้น.
// Run: node --test tests/pos_view_sticky_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { refreshPosPage } from "../modules/pos.js";

const pos = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");
const main = fs.readFileSync(path.resolve("main.js"), "utf8");
function fnBody(src, decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const ends = ["\nexport function ", "\nfunction ", "\nasync function "].map(s => src.indexOf(s, start + decl.length)).filter(i => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const refreshBody = fnBody(pos, "export function refreshPosPage");

test("(1) refreshPosPage export อยู่ (callable) + คืน false เมื่อยังไม่มี _lastPosCtx", () => {
  assert.equal(typeof refreshPosPage, "function");
  assert.equal(refreshPosPage(), false, "ยังไม่เคย renderPosPage → _lastPosCtx null → false");
});

test("(2) refreshPosPage ไม่แตะ posView/numpadValue/quickPayAmount/_checkoutKey/_resetCreditState", () => {
  for (const bad of ["posView =", "numpadValue =", "quickPayAmount =", "_checkoutKey =", "_resetCreditState("]) {
    assert.ok(!refreshBody.includes(bad), `refreshPosPage ต้องไม่ทำ "${bad}" (เป็นหน้าที่ renderPosPage ตอน navigate จริง)`);
  }
});

test("(3) มี guard posView !== \"home\" return early (mid-flow ไม่ re-render)", () => {
  assert.match(refreshBody, /if \(posView !== "home"\) return true;/, "mid-flow → short-circuit ไม่แตะ DOM");
  assert.match(refreshBody, /renderPosView\(_lastPosCtx\)/, "home → refresh ผ่าน renderPosView (ไม่ใช่ renderPosPage เต็ม)");
  // ต้องไม่เรียก renderPosPage (เต็ม) ใน refresh — จะรีเซ็ต state
  assert.ok(!/renderPosPage\(/.test(refreshBody), "refreshPosPage ต้องไม่เรียก renderPosPage (เต็ม)");
});

test("(4) main.js renderAll: currentRoute === \"pos\" + refreshPosPage() short-circuit (ต่อจาก products)", () => {
  assert.match(main, /import \{[^}]*refreshPosPage[^}]*\} from "\.\/modules\/pos\.js"/, "import refreshPosPage");
  assert.match(main, /if \(state\.currentRoute === "pos" && refreshPosPage\(\)\) return;/, "renderAll ต้อง short-circuit route pos");
  // ต้องอยู่ในบล็อกเดียวกับ products refresh (renderAll)
  const idxProd = main.indexOf('currentRoute === "products" && refreshProductsPage()');
  const idxPos = main.indexOf('currentRoute === "pos" && refreshPosPage()');
  assert.ok(idxProd !== -1 && idxPos !== -1 && idxPos > idxProd, "pos refresh ต้องอยู่ถัดจาก products ใน renderAll");
});
