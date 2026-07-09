// Phase 587 — PeriPage A9 Max via ISSC transparent UART (notify subscribe + write-with-response + chunk 128)
//
// Why: build 586 พิมพ์ A9 (fee7/fec7) ได้ แต่ A9 Max ใช้ ISSC/Microchip transparent UART
// (service 49535343-…, write 8841, notify 1e4d) — UART มักต้อง startNotifications เปิด pipe +
// write-with-response + chunk เล็ก. ★ ห้ามแตะ path A9 (regression = A9 พัง ยอมรับไม่ได้).
// LIMITATION: A9 Max พิมพ์ออกจริง ต้อง owner ทดสอบเครื่องจริง (best-effort attempt #1).
// Run: node --test tests/receipt_bt_a9max_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSlipPrinter, disconnectSlip, sendChunked, isUartTransport, getSlipTarget
} from "../modules/receipt_bt.js";

// ── mocks ────────────────────────────────────────────────────
function mkChar(uuid, props, extra = {}) {
  return {
    uuid, properties: props,
    writes: [], wowrites: [], notified: 0,
    async writeValue(s) { this.writes.push(s.length); },
    async writeValueWithoutResponse(s) { this.wowrites.push(s.length); },
    ...extra
  };
}
function mkService(uuid, chars) { return { uuid, async getCharacteristics() { return chars; } }; }
function mkNav({ name, services }) {
  const server = {
    async getPrimaryServices() { return services; },
    async getPrimaryService(uuid) { const s = services.find((x) => x.uuid === uuid); if (s) return s; throw new Error("no service"); }
  };
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

const ISSC_SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const ISSC_WRITE = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const ISSC_NOTIFY = "49535343-1e4d-4bd9-ba61-23c647249616";
const A9_SVC = "0000fee7-0000-1000-8000-00805f9b34fb";
const A9_CHAR = "0000fec7-0000-1000-8000-00805f9b34fb";

function isscNav(name = "PeriPage_A9MAX", onNotify) {
  const notify = mkChar(ISSC_NOTIFY, { notify: true }, {
    async startNotifications() { this._started = (this._started || 0) + 1; if (onNotify) onNotify(this); return this; }
  });
  const write = mkChar(ISSC_WRITE, { write: true, writeWithoutResponse: true });
  return { nav: mkNav({ name, services: [mkService(ISSC_SVC, [notify, write])] }), notify, write };
}

// ── (a) isUartTransport ──────────────────────────────────────
test("(a) isUartTransport: true เมื่อ service = ISSC 49535343 ; false เมื่อ A9 fee7", async () => {
  await disconnectSlip();
  const { nav } = isscNav();
  await withNavigator(nav, async () => {
    await connectSlipPrinter();
    assert.equal(isUartTransport(), true, "ISSC service → UART true");
    assert.equal(getSlipTarget().char, ISSC_WRITE, "เลือก write char 8841");
  });
  await disconnectSlip();
  // A9 (fee7/fec7) → ไม่ใช่ UART
  const a9 = mkNav({ name: "PeriPage_A9", services: [mkService(A9_SVC, [mkChar(A9_CHAR, { write: true, writeWithoutResponse: true })])] });
  await withNavigator(a9, async () => {
    await connectSlipPrinter();
    assert.equal(isUartTransport(), false, "A9 fee7 → UART false");
  });
  await disconnectSlip();
});

// ── (b) sendChunked UART mode ────────────────────────────────
test("(b) sendChunked uart → write-with-response (writeValue) + chunk ≤128; ไม่ใช้ writeWithoutResponse", async () => {
  const ch = mkChar("x", { write: true, writeWithoutResponse: true });
  await sendChunked(ch, new Uint8Array(300), { uart: true });
  assert.equal(ch.wowrites.length, 0, "UART ต้องไม่ใช้ writeValueWithoutResponse");
  assert.ok(ch.writes.length >= 2, "300 byte → หลาย chunk");
  assert.ok(Math.max(...ch.writes) <= 128, "ทุก chunk ≤128 (UART)");
  assert.equal(ch.writes.reduce((a, b) => a + b, 0), 300, "รวมครบ 300 byte");
});

// ── (c) sendChunked A9 path (non-uart) คงเดิม — regression guard ──
test("(c) sendChunked non-uart (A9) → writeValueWithoutResponse + chunk ≤200 (คงเดิม 586, กัน regression)", async () => {
  const ch = mkChar("x", { write: true, writeWithoutResponse: true });
  await sendChunked(ch, new Uint8Array(450)); // default = non-uart
  assert.equal(ch.writes.length, 0, "A9 ต้องใช้ writeValueWithoutResponse (ไม่ใช่ writeValue)");
  assert.ok(ch.wowrites.length >= 2, "หลาย chunk");
  assert.ok(Math.max(...ch.wowrites) <= 200, "ทุก chunk ≤200 (A9 คงเดิม)");
  assert.equal(ch.wowrites.reduce((a, b) => a + b, 0), 450, "รวมครบ 450 byte");
  // opts.uart:false ก็ต้องได้ผลเดียวกัน
  const ch2 = mkChar("y", { write: true, writeWithoutResponse: true });
  await sendChunked(ch2, new Uint8Array(50), { uart: false });
  assert.equal(ch2.wowrites.length, 1, "uart:false = A9 path");
});

// ── (d) connect ISSC → เก็บ _notifyChar + startNotifications ───
test("(d) connect ISSC → subscribe notify char (startNotifications ถูกเรียก)", async () => {
  await disconnectSlip();
  let notifiedChar = null;
  const { nav, notify } = isscNav("PeriPage_A9MAX", (c) => { notifiedChar = c; });
  await withNavigator(nav, async () => {
    await connectSlipPrinter();
    assert.equal(isUartTransport(), true);
    assert.ok(notifiedChar === notify, "startNotifications ถูกเรียกบน notify char (1e4d)");
    assert.equal(notify._started, 1, "subscribe ครั้งเดียว");
  });
  await disconnectSlip();
});

// ── (e) A9 connect: ไม่มี notify subscribe (ไม่เข้า UART branch) ──
test("(e) A9 (fee7) connect ไม่เรียก startNotifications (path เดิมไม่แตะ)", async () => {
  await disconnectSlip();
  let touched = false;
  const notify = mkChar("0000fec8-0000-1000-8000-00805f9b34fb", { notify: true }, {
    async startNotifications() { touched = true; }
  });
  const write = mkChar(A9_CHAR, { write: true, writeWithoutResponse: true });
  const nav = mkNav({ name: "PeriPage_A9", services: [mkService(A9_SVC, [write, notify])] });
  await withNavigator(nav, async () => {
    await connectSlipPrinter();
    assert.equal(isUartTransport(), false, "A9 ไม่ใช่ UART");
    assert.equal(touched, false, "ต้องไม่ subscribe notify (A9 path เดิม)");
  });
  await disconnectSlip();
});
