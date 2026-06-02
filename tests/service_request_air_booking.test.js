// Phase 349 — service-request air-booking polish guard
// Run: node --test tests/service_request_air_booking.test.js
//
// Contract: service_request consumes the air booking draft (build 347), shows a clear summary
// card + intent-aware UI, prefills the lead form, and stays a MANUAL submit. It must never
// addToCart / cut stock / hit POS / auto-create a quotation, and must not add a DB column
// (appointment maps into the existing `note`).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// in-memory sessionStorage shim for the behavioural draft round-trip
function makeShim() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; }
globalThis.sessionStorage = makeShim();
const { pushAirBookingDraft, consumeAirBookingDrafts } = await import("../modules/ac_booking_draft.js");

const sreq = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");
const dash = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");

// ── draft now carries note/spec/warranty (additive — old drafts still fine) ──
test("booking draft carries note/spec/warranty (consume round-trip)", () => {
  sessionStorage.clear();
  pushAirBookingDraft({ source: "air_catalog", brand: "TCL", model: "MFS10", btu: 9000, offerPrice: 12900, intent: "booking", note: "โปร", spec: "Inverter", warranty: "ติดตั้ง 1 ปี" });
  const d = consumeAirBookingDrafts()[0];
  assert.equal(d.note, "โปร");
  assert.equal(d.spec, "Inverter");
  assert.equal(d.warranty, "ติดตั้ง 1 ปี");
  // old-style draft (no extra fields) → empty strings, no crash
  pushAirBookingDraft({ model: "X", intent: "booking" });
  const d2 = consumeAirBookingDrafts()[0];
  assert.equal(d2.note, "");
  assert.equal(d2.warranty, "");
});

test("customer dashboard _book passes note/spec/warranty into the draft", () => {
  const fn = dash.slice(dash.indexOf("const _book ="), dash.indexOf("const _bindBook ="));
  assert.match(fn, /note:\s*product\.note/);
  assert.match(fn, /spec:/);
  assert.match(fn, /warranty:/);
});

// ── service_request consumes (once) and shows the summary card ───────────────
test("service_request consumes the draft (read-then-clear, no re-fill on reload)", () => {
  assert.match(sreq, /import \{ consumeAirBookingDrafts \} from "\.\/ac_booking_draft\.js"/);
  assert.match(sreq, /consumeAirBookingDrafts\(\)/);
  assert.ok(!/peekAirBookingDraftCount/.test(sreq), "must consume (clear), not peek");
});

test("a clear summary card shows type/brand-model/BTU/price + not-a-purchase disclaimer", () => {
  assert.match(sreq, /รายการจากแคตตาล็อกแอร์/);
  assert.match(sreq, /ประเภท/);
  assert.match(sreq, /แบรนด์\/รุ่น/);
  assert.match(sreq, /ยังไม่ใช่การซื้อจริง/);
  assert.match(sreq, /เจ้าหน้าที่จะยืนยันราคาและเวลานัดหมาย/);
  // price shows offer price OR "ต้องเช็คราคา"
  assert.match(sreq, /ต้องเช็คราคา/);
});

// ── intent-aware UI ──────────────────────────────────────────────────────────
test("submit label + heading are intent-aware (จอง vs สอบถามราคา)", () => {
  assert.match(sreq, /_isAsk = _booking && _booking\.intent !== "booking"/);
  assert.match(sreq, /ส่งคำขอจอง \/ แจ้งงาน/);
  assert.match(sreq, /ส่งคำขอสอบถามราคา/);
  assert.match(sreq, /สอบถามราคาแอร์/);
  assert.match(sreq, /สั่งจอง \/ แจ้งติดตั้งแอร์/);
});

// ── prefill maps into existing fields; appointment → note (no schema change) ──
test("prefill fills type=ติดตั้งแอร์, symptom (source marker), note (warranty)", () => {
  assert.match(sreq, /find\(o => o\.value\.includes\("ติดตั้งแอร์"\)\)/);
  assert.match(sreq, /source=air_catalog/);
  assert.match(sreq, /ประกัน ' \+ _booking\.warranty/);
});

test("appointment date/timeslot map into the existing note (no new DB column)", () => {
  assert.match(sreq, /id="srPrefDate"/);
  assert.match(sreq, /id="srPrefTime"/);
  // finalNote merges note + appointment, and the record uses note: finalNote
  assert.match(sreq, /const finalNote = apptBits\.length/);
  assert.match(sreq, /note:\s*finalNote/);
});

// ── safety: manual submit, no cart/stock/POS/quotation ───────────────────────
test("service_request never touches cart/stock/POS or auto-creates a quotation", () => {
  for (const banned of [/addToCart/, /saveCustCart/, /_custCart/, /\.stock\s*=/, /quotation/i, /from\(["']products["']\)/]) {
    assert.ok(!banned.test(sreq), `service_request must not reference ${banned}`);
  }
});

test("submit flow is unchanged — manual click → POST service_jobs (pending), no auto-submit", () => {
  assert.match(sreq, /#srSubmitBtn"\)\.addEventListener\("click"/);
  assert.match(sreq, /\/rest\/v1\/service_jobs/);
  assert.match(sreq, /status:\s*"pending"/);
  // the consume/prefill region must not POST on load
  const head = sreq.slice(0, sreq.indexOf('#srSubmitBtn").addEventListener'));
  assert.ok(!/fetch\(`?\$\{?cfg/.test(head), "must not POST during render/prefill");
});
