// Phase 502a — unit guard for the shared picker-cart helper (modules/picker_cart.js)
// Run: node --test tests/picker_cart_helper.test.js
//
// Why: the cashier cart used by every equipment picker (ac_install/service_form/
// solar/service_equipment) lives in one helper. Lock its behaviour: touch
// double-add guard, interactive +/-/x callbacks, per-product badge counting,
// and HTML-escaping (the cart renders DB product names via innerHTML).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makePickerTouchGuard,
  renderPickerCart,
  countInCart,
  updateCartBadges,
} from "../modules/picker_cart.js";

// ── touch double-add guard ────────────────────────────────────────────────
test("makePickerTouchGuard: same id within window = skip, different id = pass", () => {
  const tg = makePickerTouchGuard(350);
  assert.equal(tg.shouldSkip("5"), false, "first pick of id 5 must pass");
  assert.equal(tg.shouldSkip("5"), true, "immediate repeat of id 5 must be skipped");
  assert.equal(tg.shouldSkip("7"), false, "different id 7 must pass");
  assert.equal(tg.shouldSkip("7"), true, "immediate repeat of id 7 must be skipped");
  // id type coercion (number vs string) must still match
  assert.equal(tg.shouldSkip(7), true, "numeric 7 equals string '7' for the guard");
});

// ── countInCart ───────────────────────────────────────────────────────────
test("countInCart: rolls up qty per product_id (string/number safe)", () => {
  const items = [
    { product_id: 1, qty: 2 },
    { product_id: 1, qty: 3 },
    { product_id: 2, qty: 1 },
  ];
  assert.equal(countInCart(items, 1), 5);
  assert.equal(countInCart(items, "1"), 5);
  assert.equal(countInCart(items, 2), 1);
  assert.equal(countInCart(items, 9), 0);
  assert.equal(countInCart(null, 1), 0);
});

// ── renderPickerCart: markup + escaping + empty state ─────────────────────
function fakeEl() {
  return { style: {}, innerHTML: "", onclick: null };
}

test("renderPickerCart: empty items hides the cart", () => {
  const el = fakeEl();
  renderPickerCart(el, { items: [], money: (v) => "B" + v });
  assert.equal(el.style.display, "none");
  assert.equal(el.innerHTML, "");
});

test("renderPickerCart: renders rows with +/-/x controls, line total, and footer", () => {
  const el = fakeEl();
  renderPickerCart(el, {
    items: [{ name: "สายไฟ", qty: 2, unit_price: 50, warehouse_name: "รถคันแดง" }],
    money: (v) => "฿" + v,
  });
  assert.equal(el.style.display, "");
  assert.match(el.innerHTML, /data-cart-act="inc"/, "must render + button");
  assert.match(el.innerHTML, /data-cart-act="dec"/, "must render - button");
  assert.match(el.innerHTML, /data-cart-act="del"/, "must render remove button");
  assert.ok(el.innerHTML.includes("฿100"), "line total = qty*price = ฿100");
  assert.ok(el.innerHTML.includes("รายการ"), "footer total line present");
  assert.ok(el.innerHTML.includes("สายไฟ"), "product name rendered");
});

test("renderPickerCart: escapes product name (no raw HTML injection)", () => {
  const el = fakeEl();
  renderPickerCart(el, {
    items: [{ name: '<img src=x onerror=alert(1)>', qty: 1, unit_price: 0 }],
    money: (v) => String(v),
  });
  assert.ok(!el.innerHTML.includes("<img src=x"), "raw <img> must be escaped");
  assert.ok(el.innerHTML.includes("&lt;img"), "name must appear HTML-escaped");
});

// ── renderPickerCart: click delegation → callbacks ────────────────────────
function clickCart(el, act, idx) {
  const fakeBtn = {
    getAttribute: (k) => (k === "data-cart-act" ? act : k === "data-idx" ? String(idx) : null),
  };
  el.onclick({ target: { closest: () => fakeBtn } });
}

test("renderPickerCart: inc/dec/del fire the right callbacks", () => {
  const el = fakeEl();
  let changed = null;
  let removed = null;
  const items = [{ name: "A", qty: 2, unit_price: 10 }];
  renderPickerCart(el, {
    items,
    money: (v) => v,
    onChangeQty: (i, q) => { changed = { i, q }; },
    onRemove: (i) => { removed = i; },
  });
  clickCart(el, "inc", 0);
  assert.deepEqual(changed, { i: 0, q: 3 }, "inc → qty+1");
  clickCart(el, "dec", 0);
  assert.deepEqual(changed, { i: 0, q: 1 }, "dec → qty-1");
  clickCart(el, "del", 0);
  assert.equal(removed, 0, "del → onRemove(idx)");
});

test("renderPickerCart: dec never goes below 1", () => {
  const el = fakeEl();
  let changed = null;
  renderPickerCart(el, {
    items: [{ name: "A", qty: 1, unit_price: 10 }],
    money: (v) => v,
    onChangeQty: (i, q) => { changed = { i, q }; },
    onRemove: () => {},
  });
  clickCart(el, "dec", 0);
  assert.deepEqual(changed, { i: 0, q: 1 }, "dec at qty 1 stays 1 (use ✕ to remove)");
});

// ── updateCartBadges: surgical per-product badge ──────────────────────────
function fakeBadge(pid) {
  return {
    _pid: pid,
    textContent: "",
    style: {},
    getAttribute(k) { return k === "data-badge-pid" ? this._pid : null; },
  };
}

test("updateCartBadges: sets ×N on matched products, hides zero", () => {
  const b1 = fakeBadge("1");
  const b2 = fakeBadge("2");
  const listEl = { querySelectorAll: () => [b1, b2] };
  updateCartBadges(listEl, [{ product_id: 1, qty: 3 }]);
  assert.equal(b1.textContent, "×3");
  assert.equal(b1.style.display, "inline-block");
  assert.equal(b2.textContent, "");
  assert.equal(b2.style.display, "none");
});
