// Phase 502b — service_form equipment picker: cashier cart via shared helper
// (modules/picker_cart.js). service_form = generic form for 9 service types
// (ซ่อม/ล้าง/ย้ายแอร์ · ตู้เย็น · ซักผ้า · ทีวี · CCTV · จานดาวเทียม · งานอื่นๆ).
// Run: node --test tests/service_form_picker_cart_guard.test.js
//
// Separate from service_form_picker_guard.test.js (453b warehouse-first) —
// this locks ONLY the 502b cart layer. Source-regex (modal binds DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/service_form.js"), "utf8");
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
  picker.indexOf("setTimeout(") >= 0 ? picker.indexOf("setTimeout(") : undefined
);

test("service_form imports + uses the shared picker-cart helper", () => {
  assert.match(src, /from "\.\/picker_cart\.js"/, "ต้อง import ./picker_cart.js");
  assert.match(picker, /makePickerTouchGuard\(\)/, "สร้าง touch guard");
  assert.match(picker, /renderPickerCart\(/, "render ตะกร้าผ่าน helper");
  assert.match(picker, /updateCartBadges\(/, "อัปเดต badge ผ่าน helper");
});

test("502b multi-add: item-click ไม่ปิด picker (ไม่มี modal.remove ในเส้น add)", () => {
  assert.ok(itemClick.length > 0, "หา item-click block ได้");
  assert.ok(!itemClick.includes("modal.remove()"),
    "item-click ต้องไม่ปิด picker (multi-add)");
  assert.match(itemClick, /_afterCartChange\(\)/, "refresh ในที่เดียว");
  assert.match(picker, /doneBtn\?\.addEventListener\("click", \(\) => modal\.remove\(\)\)/, "ปุ่มเสร็จปิดได้");
});

test("502b touch double-add guard: shouldSkip ก่อน add", () => {
  assert.match(itemClick, /_tg\.shouldSkip\(p\.id\)/, "เช็ค _tg.shouldSkip(p.id)");
  const guardIdx = itemClick.indexOf("_tg.shouldSkip(p.id)");
  const pushIdx = itemClick.indexOf("st.items.push(");
  assert.ok(guardIdx >= 0 && pushIdx >= 0 && guardIdx < pushIdx, "touch-guard ต้องมาก่อน add");
  assert.match(picker, /class="svpk-item"[\s\S]*?touch-action:manipulation/, "ปุ่มสินค้ามี touch-action");
});

test("502b interactive cart (st.items) + badge", () => {
  assert.match(picker, /id="svpkCart"/, "มี container ตะกร้า");
  assert.match(picker, /id="svpkDone"/, "มีปุ่มเสร็จ");
  assert.match(picker, /data-badge-pid=/, "สินค้ามี slot badge ×N");
  assert.match(picker, /items:\s*st\.items/, "ตะกร้าอ่านจาก st.items");
  assert.match(picker, /onChangeQty/, "ต่อ qty change");
  assert.match(picker, /onRemove/, "ต่อ remove");
});

test("502b ไม่ทำ 453b/stock พัง: dedup คงเดิม + ไม่ตัดสต็อก", () => {
  assert.match(itemClick, /st\.items\.push\(\{/, "push เข้า st.items คงเดิม");
  assert.match(itemClick, /existing\.qty = Number\(existing\.qty\) \+ 1/, "dedup qty+1 คงเดิม");
  for (const bad of ["_applyStockMovement", "deductServiceJobStock", "xhrPost", "xhrPatch", "xhrDelete"]) {
    assert.ok(!picker.includes(bad), `picker ต้องไม่เรียก ${bad}`);
  }
});

test("502b helper read-only", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "xhrPost", "xhrPatch", "xhrDelete", ".insert(", ".update(", ".delete("]) {
    assert.ok(!helperSrc.includes(bad), `helper ต้องไม่ทำ ${bad}`);
  }
});
