// build 593 — A9 Max notify handshake (long-shot #2 ผ่าน BLE)
//
// Why: build 592 ยิง framing ตัวจริงผ่าน ff02 แล้ว A9 Max ยังนิ่ง (กระดาษไม่เลื่อน).
//   เครื่องช่อง ff00/ff02 บางรุ่นต้อง enable CCCD ของ notify char (ff01/ff03) ก่อน
//   firmware ถึงจะประมวลผล write ที่ ff02 (pattern เดียวกับ ISSC transparent UART).
//   connectSlipPrinter สำหรับ A9 Max (ชื่อ MAX) → หลังเลือก ff02 → startNotifications
//   บน notify char ทุกตัวใน service เดียวกัน (ครั้งเดียว).
// ★ A9 (ชื่อไม่มี MAX) ต้อง "ไม่" subscribe อะไรเลย — connect byte-identical 592/586.
// Run: node --test tests/receipt_bt_notify_handshake_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectSlipPrinter, disconnectSlip, getSlipTarget } from "../modules/receipt_bt.js";

const ISSC_SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const ISSC_8841 = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const FF00_SVC = "0000ff00-0000-1000-8000-00805f9b34fb";
const FF02 = "0000ff02-0000-1000-8000-00805f9b34fb";

// char factory — บันทึกว่า startNotifications ถูกเรียกหรือไม่ (ผ่าน closure counter)
function mkChar(uuid, props, calls) {
  return {
    uuid, properties: props,
    async writeValue() {}, async writeValueWithoutResponse() {},
    async startNotifications() { calls.push(uuid); return this; },
    addEventListener() {}
  };
}
function mkService(uuid, chars) { return { uuid, async getCharacteristics() { return chars; } }; }
function realGatt(name, calls) {
  const services = [
    mkService(ISSC_SVC, [
      mkChar("49535343-1e4d-4bd9-ba61-23c647249616", { notify: true }, calls),
      mkChar(ISSC_8841, { write: true, writeWithoutResponse: true }, calls)
    ]),
    mkService(FF00_SVC, [
      mkChar("0000ff01-0000-1000-8000-00805f9b34fb", { notify: true }, calls),
      mkChar(FF02, { write: true, writeWithoutResponse: true }, calls),
      mkChar("0000ff03-0000-1000-8000-00805f9b34fb", { notify: true }, calls)
    ])
  ];
  const server = { async getPrimaryServices() { return services; }, async getPrimaryService(u) { const s = services.find(x => x.uuid === u); if (s) return s; throw new Error("no"); } };
  const device = { name, gatt: { connected: true, connect: async () => server, disconnect() { this.connected = false; } }, addEventListener() {} };
  return { bluetooth: { requestDevice: async () => device } };
}
const _origNavDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function withNavigator(nav, fn) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  return Promise.resolve().then(fn).finally(() => {
    if (_origNavDesc) Object.defineProperty(globalThis, "navigator", _origNavDesc);
    else delete globalThis.navigator;
  });
}

// ── (1) A9 Max → subscribe notify char (ff01/ff03) ใน service ff00 (เดียวกับ ff02) ──
test("(1) A9 Max: connect เลือก ff02 + startNotifications บน notify char ของ service ff00 (ff01/ff03)", async () => {
  await disconnectSlip();
  const calls = [];
  await withNavigator(realGatt("PeriPage_A9MAX_BLE", calls), async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /ff02/i, "A9 Max → char ff02");
    assert.ok(calls.some(u => /ff01/i.test(u)), "ต้อง startNotifications บน ff01");
    assert.ok(calls.some(u => /ff03/i.test(u)), "ต้อง startNotifications บน ff03");
    // ต้องไม่ไปเปิด notify ของ service ISSC (คนละ service กับ ff02)
    assert.ok(!calls.some(u => /1e4d/i.test(u)), "ต้องไม่แตะ notify ของ service ISSC (คนละ service)");
  });
  await disconnectSlip();
});

// ── (2) ★ A9 (ชื่อไม่มี MAX) → ไม่ subscribe อะไรเลย (regression: connect เหมือน 592/586) ──
test("(2) ★ A9 (non-MAX): connect ไม่เรียก startNotifications เลย (byte-identical 592/586)", async () => {
  await disconnectSlip();
  const calls = [];
  await withNavigator(realGatt("PeriPage_A9_BLE", calls), async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /8841/i, "A9 → fallback 8841 (เหมือน 586)");
    assert.equal(calls.length, 0, "★ A9 ต้องไม่ startNotifications เลย (regression-safe)");
  });
  await disconnectSlip();
});
