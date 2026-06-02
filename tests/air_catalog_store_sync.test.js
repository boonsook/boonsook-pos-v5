// Phase 347 — air-catalog-public-store-sync guard
// Run: node --test tests/air_catalog_store_sync.test.js
//
// Contract: the customer storefront shows the SAME air catalog (bsk_ac_catalog) as the admin
// "จัดการแคตตาล็อกแอร์" page, but stays 100% separate from real products/POS stock. The card
// button "สั่งจอง"/"สอบถามราคา" must NEVER addToCart / cut stock / hit POS — it stages a booking
// draft (sessionStorage) and routes to the existing service_request lead flow (manual submit).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── in-memory sessionStorage shim ───────────────────────────────────────────
function makeShim() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
globalThis.sessionStorage = makeShim();

const { pushAirBookingDraft, consumeAirBookingDrafts, peekAirBookingDraftCount } =
  await import("../modules/ac_booking_draft.js");

const dash = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");
const sreq = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");
const helper = fs.readFileSync(path.resolve("modules/ac_booking_draft.js"), "utf8");
const quotations = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");

// ── booking draft helper behaviour ───────────────────────────────────────────
test("pushAirBookingDraft → sessionStorage; consume returns then clears (no re-consume)", () => {
  sessionStorage.clear();
  pushAirBookingDraft({ source: "air_catalog", catalogId: 3, airType: "แอร์แขวน", brand: "Daikin", model: "FH24", btu: 24000, offerPrice: 32000, intent: "booking" });
  assert.equal(peekAirBookingDraftCount(), 1);
  const d = consumeAirBookingDrafts();
  assert.equal(d.length, 1);
  assert.equal(d[0].source, "air_catalog");
  assert.equal(d[0].model, "FH24");
  assert.equal(d[0].intent, "booking");
  assert.deepEqual(consumeAirBookingDrafts(), []); // reload → no duplicate
});

test("intent normalises to 'booking' unless price_inquiry", () => {
  sessionStorage.clear();
  pushAirBookingDraft({ model: "X", intent: "weird" });
  assert.equal(consumeAirBookingDrafts()[0].intent, "booking");
  pushAirBookingDraft({ model: "Y", intent: "price_inquiry" });
  assert.equal(consumeAirBookingDrafts()[0].intent, "price_inquiry");
});

test("booking helper is sessionStorage-only — no Supabase/localStorage/network", () => {
  assert.match(helper, /sessionStorage/);
  for (const banned of [/localStorage\./, /SUPABASE_CONFIG/, /rest\/v1\//, /\/api\//, /fetch\(/, /_appXhr/]) {
    assert.ok(!banned.test(helper), `booking helper must not reference ${banned}`);
  }
});

// ── storefront reads the SAME catalog, by air type, ready-only ───────────────
test("storefront reads bsk_ac_catalog (same source as admin) + air-type helpers", () => {
  assert.match(dash, /localStorage\.getItem\("bsk_ac_catalog"\)/);
  assert.match(dash, /import \{ acTypeOf, acTypeLabel, AC_TYPES \} from "\.\/settings\/ac-stock-form\.js"/);
  // category filter is by air TYPE now, not by brand/section
  assert.match(dash, /p\._acType === _custCategory/);
  assert.match(dash, /AC_TYPES\.map\(t =>/);
});

test("storefront hides 'เลิกขาย' items (shows พร้อมเสนอขาย + ต้องเช็คราคา only)", () => {
  assert.match(dash, /const visibleProducts = products\.filter\(p => p\._acStatus !== "inactive"\)/);
  assert.match(dash, /price <= 0\) return "check"/);
  assert.match(dash, /return "inactive"/);
});

// ── card: booking button, no stock/cart wording ─────────────────────────────
test("air card uses a booking button (data-book), not add-to-cart", () => {
  // the storefront air card helper emits data-book, never data-add-cart
  const card = dash.slice(dash.indexOf("const _acCardHtml"), dash.indexOf("const _book ="));
  assert.match(card, /data-book="\$\{p\.id\}"/);
  assert.ok(!/data-add-cart/.test(card), "air card must not render an add-to-cart button");
  assert.match(card, /สั่งจอง/);
  assert.match(card, /สอบถามราคา/);
  // no real-stock wording on the storefront card
  assert.ok(!/คงเหลือ/.test(card), "card must not say คงเหลือ");
  assert.ok(!/เพิ่มลงตะกร้า/.test(card), "card must not say เพิ่มลงตะกร้า");
});

test("storefront shows the offer-price disclaimer", () => {
  assert.match(dash, /ราคาสำหรับเสนอขาย กรุณารอเจ้าหน้าที่ยืนยันก่อนสั่งซื้อจริง/);
});

// ── booking action never touches cart/stock/POS ──────────────────────────────
test("the _book handler stages a draft + navigates — no addToCart / stock / POS", () => {
  const fn = dash.slice(dash.indexOf("const _book ="), dash.indexOf("const _bindBook ="));
  assert.match(fn, /pushAirBookingDraft\(/);
  assert.match(fn, /showRoute\("service_request"\)|location\.hash\s*=\s*"service_request"/);
  assert.ok(!/_custCart|addToCart|saveCustCart/.test(fn), "booking must not touch the cart");
  assert.ok(!/\.stock\s*=/.test(fn), "booking must not mutate stock");
});

test("customer dashboard does not import any products/POS stock module", () => {
  for (const banned of [/from "\.\/pos\.js"/, /from "\.\/stock_cas\.js"/, /from "\.\/products\.js"/, /from "\.\/stock_/]) {
    assert.ok(!banned.test(dash), `customer_dashboard must not import ${banned}`);
  }
});

// ── service_request consumes the booking draft (prefill, manual submit) ──────
test("service_request consumes the booking draft and prefills (no auto-submit)", () => {
  assert.match(sreq, /import \{ consumeAirBookingDrafts \} from "\.\/ac_booking_draft\.js"/);
  assert.match(sreq, /consumeAirBookingDrafts\(\)/);
  // a notice tells the user it is NOT submitted yet
  assert.match(sreq, /ยังไม่ได้ส่ง/);
  // prefill fills the symptom field, does not POST on consume
  const consumeRegion = sreq.slice(sreq.indexOf("consumeAirBookingDrafts()"), sreq.indexOf("consumeAirBookingDrafts()") + 400);
  assert.ok(!/fetch\(/.test(consumeRegion), "consuming a draft must not POST anything");
});

// ── build 346 quotation-draft flow is untouched ──────────────────────────────
test("build 346 quotation draft flow still wired (not broken by 347)", () => {
  assert.ok(fs.existsSync(path.resolve("modules/ac_quotation_draft.js")), "ac_quotation_draft.js must still exist");
  assert.match(quotations, /import \{ consumeAirQuoteDrafts \} from "\.\/ac_quotation_draft\.js"/);
});
