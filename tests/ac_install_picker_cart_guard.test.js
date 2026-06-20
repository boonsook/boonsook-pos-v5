// Phase 502a — ac_install equipment picker: cashier cart (multi-add + touch-guard
// + interactive cart + per-product badge) via the shared helper modules/picker_cart.js.
// Run: node --test tests/ac_install_picker_cart_guard.test.js
//
// Separate from ac_install_picker_guard.test.js (Phase 453a warehouse-first) —
// this locks ONLY the 502a cart layer. Source-regex (modal binds DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/ac_install.js"), "utf8");
const helperSrc = fs.readFileSync(path.resolve("modules/picker_cart.js"), "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `must define ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const picker = fnBody("_openItemPicker");
const itemClick = picker.slice(
  picker.indexOf('listEl.addEventListener("click"'),
  picker.indexOf("setTimeout(")
);

test("ac_install imports + uses the shared picker-cart helper", () => {
  assert.match(src, /from "\.\/picker_cart\.js"/, "ต้อง import ./picker_cart.js");
  assert.match(picker, /makePickerTouchGuard\(\)/, "สร้าง touch guard");
  assert.match(picker, /renderPickerCart\(/, "render ตะกร้าผ่าน helper");
  assert.match(picker, /updateCartBadges\(/, "อัปเดต badge ผ่าน helper");
});

test("502a multi-add: item-click ไม่ปิด picker (ไม่มี modal.remove ในเส้น add)", () => {
  assert.ok(itemClick.length > 0, "หา item-click block ได้");
  assert.ok(!itemClick.includes("modal.remove()"),
    "item-click ต้องไม่ปิด picker (multi-add) — modal.remove ย้ายไปปุ่ม close/done/backdrop");
  assert.match(itemClick, /_afterCartChange\(\)/, "refresh list/total/draft/cart ในที่เดียว");
  // close ยังมี (ที่ปุ่ม ✕/เสร็จ/backdrop นอก item-click)
  assert.match(picker, /#acpkClose"\)\.addEventListener\("click", \(\) => modal\.remove\(\)\)/, "ปุ่ม ✕ ยังปิดได้");
  assert.match(picker, /doneBtn\?\.addEventListener\("click", \(\) => modal\.remove\(\)\)/, "ปุ่มเสร็จปิดได้");
});

test("502a touch double-add guard: shouldSkip ก่อน add", () => {
  assert.match(itemClick, /_tg\.shouldSkip\(p\.id\)/, "เช็ค _tg.shouldSkip(p.id)");
  const guardIdx = itemClick.indexOf("_tg.shouldSkip(p.id)");
  const pushIdx = itemClick.indexOf("_items.push(");
  assert.ok(guardIdx >= 0 && pushIdx >= 0 && guardIdx < pushIdx, "touch-guard ต้องมาก่อน add (push)");
  assert.match(picker, /class="acpk-item"[\s\S]*?touch-action:manipulation/, "ปุ่มสินค้ามี touch-action");
});

test("502a interactive cart + badge present", () => {
  assert.match(picker, /id="acpkCart"/, "มี container ตะกร้า");
  assert.match(picker, /id="acpkDone"/, "มีปุ่มเสร็จ");
  assert.match(picker, /data-badge-pid=/, "สินค้ามี slot badge ×N");
  assert.match(picker, /onChangeQty/, "ตะกร้าต่อ qty change");
  assert.match(picker, /onRemove/, "ตะกร้าต่อ remove");
});

test("502a ไม่ทำ 453a/stock พัง: dedup qty+1/push คงเดิม + ไม่ตัดสต็อก", () => {
  assert.match(itemClick, /_items\.push\(\{/, "push เข้า _items คงเดิม");
  assert.match(itemClick, /existing\.qty = Number\(existing\.qty\) \+ 1/, "dedup qty+1 คงเดิม");
  for (const bad of ["_applyStockMovement", "deductServiceJobStock", "xhrPost", "xhrPatch", "xhrDelete"]) {
    assert.ok(!picker.includes(bad), `picker ต้องไม่เรียก ${bad} (ตัดสต็อกที่ save)`);
  }
});

test("502a helper read-only (UI/local-state — ไม่เขียน DB/สต็อก)", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "xhrPost", "xhrPatch", "xhrDelete", ".insert(", ".update(", ".delete("]) {
    assert.ok(!helperSrc.includes(bad), `helper ต้องไม่ทำ ${bad}`);
  }
  assert.match(helperSrc, /export function makePickerTouchGuard/, "helper export touch guard");
  assert.match(helperSrc, /export function renderPickerCart/, "helper export cart render");
});
