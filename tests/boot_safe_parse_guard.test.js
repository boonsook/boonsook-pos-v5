// Phase 573 / build 573 — boot-safe localStorage parse (กันแอปขาวถาวร + self-heal)
// Run: node --test tests/boot_safe_parse_guard.test.js
//
// Why: JSON.parse(localStorage.getItem(key)) ตอน module evaluation ไม่มี try/catch → key เดียวเสีย
//   = throw ตอน import = แอปขาวถาวร (selfheal ล้างแค่ SW/Cache ไม่แตะ localStorage → refresh ไม่หาย).
//   safeParse: parse ผ่าน→ค่า / ไม่มี|ว่าง→fallback / เสีย→removeItem(self-heal)+fallback / getItem block→fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeParse } from "../modules/_safe_parse.js";

// ── mock storage ─────────────────────────────────────────────────────────────
function makeStorage(initial = {}) {
  const store = { ...initial };
  const removed = [];
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    removeItem: (k) => { removed.push(k); delete store[k]; },
    setItem: (k, v) => { store[k] = String(v); },
    _removed: removed,
    _store: store,
  };
}

// ── #1 behavioral ────────────────────────────────────────────────────────────
test("safeParse — valid JSON → parsed value (ไม่ removeItem)", () => {
  const st = makeStorage({ k: '{"a":1,"b":[2,3]}' });
  assert.deepEqual(safeParse("k", null, st), { a: 1, b: [2, 3] });
  assert.deepEqual(st._removed, [], "valid ต้องไม่ removeItem");
});

test("safeParse — key ไม่มี → fallback (ไม่ removeItem)", () => {
  const st = makeStorage({});
  const fb = [];
  assert.equal(safeParse("missing", fb, st), fb, "คืน fallback อ้างอิงเดิม");
  assert.deepEqual(st._removed, []);
});

test("safeParse — corrupt ('{oops') → fallback + removeItem ถูกเรียก (self-heal)", () => {
  const st = makeStorage({ bad: "{oops" });
  const fb = { safe: true };
  assert.equal(safeParse("bad", fb, st), fb, "corrupt → fallback");
  assert.deepEqual(st._removed, ["bad"], "corrupt → ต้อง removeItem (boot ถัดไปสะอาด)");
  assert.ok(!("bad" in st._store), "key เสียถูกลบจริง");
});

test("safeParse — getItem throw (SecurityError/private mode) → fallback ไม่ throw", () => {
  const throwing = {
    getItem: () => { throw new Error("SecurityError: storage blocked"); },
    removeItem: () => { throw new Error("blocked too"); },
  };
  const fb = { fallback: 1 };
  let res;
  assert.doesNotThrow(() => { res = safeParse("x", fb, throwing); }, "storage block ต้องไม่ throw");
  assert.equal(res, fb, "block → คืน fallback");
});

test("safeParse — raw ว่าง '' → fallback (empty string ไม่ใช่ JSON valid)", () => {
  const st = makeStorage({ e: "" });
  const fb = [];
  assert.equal(safeParse("e", fb, st), fb);
  assert.deepEqual(st._removed, [], "empty string ไม่ถือว่า corrupt → ไม่ต้อง removeItem");
});

test("safeParse — default storage = globalThis.localStorage (ไม่ throw ตอน call ปกติในเบราว์เซอร์)", () => {
  // node ไม่มี localStorage → getItem throw → path catch → fallback (พิสูจน์ degrade-safe)
  assert.equal(safeParse("whatever", "fb"), "fb");
});

// ── #2 source: main.js state init ใช้ safeParse ครบ 4 keys + ไม่เหลือ naked parse ─
const main = fs.readFileSync(path.resolve("main.js"), "utf8");
test("main.js — import safeParse + state init 4 keys ใช้ safeParse (ไม่เหลือ JSON.parse(localStorage) เปลือย)", () => {
  assert.match(main, /import \{ safeParse \} from "\.\/modules\/_safe_parse\.js"/, "ต้อง import safeParse");
  const s0 = main.indexOf('cart: safeParse("bsk_cart_v2"');
  assert.ok(s0 >= 0, "cart ต้องใช้ safeParse");
  const s1 = main.indexOf("currentRoute:", s0);
  assert.ok(s1 > s0, "state init block end (currentRoute) ต้องพบ");
  const block = main.slice(s0, s1);
  assert.match(block, /cart: safeParse\("bsk_cart_v2", \[\]\)/, "cart → safeParse fallback []");
  assert.match(block, /lastReceipt: safeParse\("bsk_last_receipt", null\)/, "lastReceipt → safeParse fallback null");
  assert.match(block, /storeInfo: safeParse\("bsk_store_info",/, "storeInfo → safeParse");
  assert.match(block, /safeParse\("bsk_payment_info",/, "paymentInfo raw → safeParse (migrate IIFE ต่อเหมือนเดิม)");
  assert.doesNotMatch(block, /JSON\.parse\(localStorage\.getItem\("bsk_(cart_v2|last_receipt|store_info|payment_info)"/,
    "state init 4 keys ต้องไม่เหลือ JSON.parse(localStorage) เปลือย");
  // migrate logic ยังอยู่ (ไม่แตะ)
  assert.match(block, /if \(!raw\.banks\)/, "paymentInfo migrate logic ต้องคงอยู่");
});

// ── #3 source: customer_dashboard.js top-level ใช้ safeParse ──────────────────
const custDash = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");
test("customer_dashboard.js — _custCart top-level ใช้ safeParse (lazy import ไม่ reject)", () => {
  assert.match(custDash, /import \{ safeParse \} from "\.\/_safe_parse\.js"/, "ต้อง import safeParse");
  assert.match(custDash, /let _custCart = safeParse\("bsk_cust_cart", \[\]\)/, "_custCart → safeParse");
  assert.doesNotMatch(custDash, /let _custCart = JSON\.parse\(localStorage/, "ต้องไม่เหลือ naked JSON.parse ที่ top-level");
});

// ── #4 source: pages.js restore loop validate JSON_KEYS + ไม่บังคับ key อื่น ───
const pages = fs.readFileSync(path.resolve("modules/settings/pages.js"), "utf8");
test("pages.js restore — JSON_KEYS allowlist ต้อง parse ผ่านก่อน setItem; key plain-string restore ตามเดิม", () => {
  // slice restore handler (จาก appRestore ... ถึง appClearCacheBtn)
  const r0 = pages.indexOf("data.local_storage");
  assert.ok(r0 >= 0, "restore loop ต้องมี");
  const r1 = pages.indexOf("appClearCacheBtn", r0);
  const loop = pages.slice(r0, r1 > r0 ? r1 : r0 + 1500);
  assert.match(loop, /_JSON_KEYS = new Set\(\[[^\]]*"bsk_store_info"[^\]]*"bsk_payment_info"[^\]]*"bsk_product_settings"/,
    "ต้องมี allowlist JSON_KEYS (อย่างน้อย store_info/payment_info/product_settings)");
  assert.match(loop, /if \(_JSON_KEYS\.has\(k\)\)[\s\S]{0,80}JSON\.parse\(v\)[\s\S]{0,80}(_skipped|continue|return)/,
    "key ใน JSON_KEYS ต้อง JSON.parse ผ่านก่อน setItem (ไม่ผ่าน = skip/count)");
  // key อื่น (plain string) ยัง restore: มี guard typeof string + startsWith bsk_ แล้ว setItem โดยไม่บังคับ JSON
  assert.match(loop, /typeof v !== "string" \|\| !k\.startsWith\("bsk_"\)/, "ยังคง guard typeof string + prefix bsk_");
  assert.match(loop, /localStorage\.setItem\(k, v\)/, "ยัง setItem ค่า string ตามเดิม (plain key ไม่บังคับ JSON)");
  // deny slipok key ยังอยู่ (ไม่ regress Phase 543)
  assert.match(loop, /_RESTORE_DENY[\s\S]{0,40}bsk_slipok_key/, "ยังคง deny bsk_slipok_key (Phase 543)");
});
