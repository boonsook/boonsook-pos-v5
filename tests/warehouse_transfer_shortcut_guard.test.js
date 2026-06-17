// Phase 458 — "โอนระหว่างคลัง" shortcut on inventory page (build 458)
// Run: node --test tests/warehouse_transfer_shortcut_guard.test.js
//
// Why this exists:
//   หน้า "สินค้า / คลัง" (modules/products.js) มีปุ่มทางลัด "🔄 โอนระหว่างคลัง"
//   ในเมนู "⋯ จัดการเพิ่มเติม". มันเป็น PURE navigation/UI ล้วน:
//     - ตั้ง flag window._smOpenTransfer = true
//     - นำทางด้วย location.hash = "stock_movements"
//   แล้วหน้า stock_movements (modules/stock_movements.js) จะเห็น flag → เปิด
//   modal โอน (openTransferModal) เอง แบบ one-shot (ล้าง flag ทันที).
//   ตัวโอนจริงใช้ flow เดิม (_transferWarehouseStock) — phase นี้ "ไม่" เพิ่ม
//   stock-write/transfer logic ใหม่. guard ล็อก invariant ว่า:
//     (1) products.js มีปุ่ม id="prodTransferBtn" ในเมนูจัดการเพิ่มเติม
//     (2) handler ตั้ง _smOpenTransfer + ชี้ location.hash ไป "stock_movements"
//     (3) handler นี้ "ไม่" call _transferWarehouseStock / fetch / XHR (0 write)
//     (4) stock_movements.js auto-open: เช็ค _smOpenTransfer → openTransferModal()
//         + ล้าง flag (one-shot)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const prod = fs.readFileSync(path.resolve("modules/products.js"), "utf8");
const sm = fs.readFileSync(path.resolve("modules/stock_movements.js"), "utf8");

// ── products.js: the menu button exists ──────────────────────────────────────
test("products.js renders a '🔄 โอนระหว่างคลัง' menu button (id=prodTransferBtn)", () => {
  assert.match(prod, /id="prodTransferBtn"/, "must render a button with id=prodTransferBtn");
  assert.match(prod, /โอนระหว่างคลัง/, "button label must mention โอนระหว่างคลัง");
  // lives in the existing 'จัดการเพิ่มเติม' menu (shares prod-more-item style)
  assert.match(
    prod,
    /id="prodTransferBtn"[^>]*class="prod-more-item"/,
    "button must use the prod-more-item style (inside จัดการเพิ่มเติม menu)"
  );
});

// ── products.js: handler sets the flag + navigates to stock_movements ─────────
test("prodTransferBtn handler sets _smOpenTransfer flag and navigates hash to stock_movements", () => {
  const handler = prod.match(
    /#prodTransferBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/
  );
  assert.ok(handler, "prodTransferBtn click handler block must be present");
  const body = handler[1];
  assert.match(
    body,
    /window\._smOpenTransfer\s*=\s*true/,
    "handler must set window._smOpenTransfer = true"
  );
  assert.match(
    body,
    /location\.hash\s*=\s*["']stock_movements["']/,
    "handler must navigate location.hash to 'stock_movements'"
  );
});

// ── products.js: the new handler is navigation-only (no stock write) ──────────
test("prodTransferBtn handler does NOT call transfer/fetch/XHR (navigation only, 0 writes)", () => {
  const handler = prod.match(
    /#prodTransferBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/
  );
  assert.ok(handler, "prodTransferBtn click handler block must be present");
  const body = handler[1];
  assert.ok(!/_transferWarehouseStock/.test(body), "handler must not call _transferWarehouseStock");
  assert.ok(!/_atomic/.test(body), "handler must not call any _atomic* stock helper");
  assert.ok(!/\bfetch\s*\(/.test(body), "handler must not call fetch()");
  assert.ok(!/XMLHttpRequest/.test(body), "handler must not use XMLHttpRequest");
  assert.ok(!/xhrP(ost|atch|ut)/.test(body), "handler must not call xhrPost/xhrPatch/xhrPut");
  for (const verb of ['"POST"', "'POST'", '"PATCH"', "'PATCH'", '"PUT"', "'PUT'", '"DELETE"', "'DELETE'"]) {
    assert.ok(!body.includes(verb), `handler must not reference HTTP write method ${verb}`);
  }
});

// ── stock_movements.js: auto-opens transfer modal on flag, one-shot ───────────
test("stock_movements.js auto-opens transfer modal when _smOpenTransfer is set, then clears it (one-shot)", () => {
  // the auto-open check must reference the flag and call openTransferModal()
  const autoOpen = sm.match(
    /if\s*\(\s*window\._smOpenTransfer\s*\)\s*\{([\s\S]*?)\}/
  );
  assert.ok(autoOpen, "must have an `if (window._smOpenTransfer) { ... }` block");
  const body = autoOpen[1];
  assert.match(
    body,
    /window\._smOpenTransfer\s*=\s*false/,
    "auto-open must clear the flag immediately (one-shot)"
  );
  assert.match(body, /openTransferModal\(\)/, "auto-open must call openTransferModal()");

  // sanity: the check sits after openTransferModal is wired to the transfer button,
  // so openTransferModal is defined in scope when the auto-open fires.
  const wireIdx = sm.indexOf("$transferBtn.onclick = openTransferModal");
  const autoIdx = sm.indexOf("window._smOpenTransfer = false");
  assert.ok(wireIdx !== -1, "transfer button must be wired to openTransferModal");
  assert.ok(autoIdx !== -1 && autoIdx > wireIdx, "auto-open must come after openTransferModal is in scope");
});
