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
  connectSlipPrinter, disconnectSlip, sendChunked, isUartTransport, getSlipTarget,
  buildPrintBytes, usePeriPageProtocol
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

// ═══ Phase 588: เลือก char ตามช่อง (fec7→ff02) + framing ตามช่อง ═══
const FF00_SVC = "0000ff00-0000-1000-8000-00805f9b34fb";
const FF02_CHAR = "0000ff02-0000-1000-8000-00805f9b34fb";
function mockCanvas(rows) {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = rows[y][x] ? 0 : 255;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}
function hasSeq(arr, seq) {
  for (let i = 0; i + seq.length <= arr.length; i++) {
    let ok = true; for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
const solidRow = () => [1, 1, 1, 1, 1, 1, 1, 1];

// ── (f) A9 regression: fec7 → PeriPage-classic framing (คงเดิม) ──
test("(f) A9 (fec7): usePeriPageProtocol true → buildPrintBytes = reset(10FFFE01) + ESC J ท้าย (คงเดิม 587)", async () => {
  await disconnectSlip();
  const nav = mkNav({ name: "PeriPage_A9", services: [mkService(A9_SVC, [mkChar(A9_CHAR, { write: true, writeWithoutResponse: true })])] });
  await withNavigator(nav, async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /fec7/i, "เลือก fec7");
    assert.equal(usePeriPageProtocol(), true, "fec7 → PeriPage protocol");
    assert.equal(isUartTransport(), false, "A9 direct write (ไม่ใช่ UART)");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 4)], [0x10, 0xFF, 0xFE, 0x01], "ขึ้นต้น reset 10 FF FE 01");
    assert.ok(hasSeq(bytes, [0x10, 0xFF, 0x10, 0x00, 0x02]), "มี concentration");
    const n = bytes.length;
    assert.equal(bytes[n - 3], 0x1B, "ท้าย ESC J"); assert.equal(bytes[n - 2], 0x4A, "J");
    assert.ok(!hasSeq(bytes, [0x1B, 0x40]), "ไม่มี ESC @ (PeriPage path)");
  });
  await disconnectSlip();
});

// ── (g) A9 Max: มีทั้ง ISSC(8841) + ff02 → ต้องเลือก ff02 + generic ESC/POS ──
test("(g) A9 Max (49535343-8841 + ff02): เลือก ff02 (ไม่ใช่ 8841) → generic ESC/POS, ไม่มี cut/PeriPage reset", async () => {
  await disconnectSlip();
  const issc = mkService(ISSC_SVC, [mkChar(ISSC_WRITE, { write: true, writeWithoutResponse: true })]);
  const ff00 = mkService(FF00_SVC, [
    mkChar("0000ff01-0000-1000-8000-00805f9b34fb", { notify: true }),
    mkChar(FF02_CHAR, { write: true, writeWithoutResponse: true }),
    mkChar("0000ff03-0000-1000-8000-00805f9b34fb", { notify: true })
  ]);
  await withNavigator(mkNav({ name: "PeriPage_A9MAX", services: [issc, ff00] }), async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /ff02/i, "★ ต้องเลือก ff02 (ไม่ใช่ 49535343-8841)");
    assert.ok(!/8841/i.test(getSlipTarget().char), "ต้องไม่ใช่ ISSC 8841");
    assert.equal(isUartTransport(), false, "ff00 ไม่ใช่ ISSC UART");
    assert.equal(usePeriPageProtocol(), false, "ff02 → generic ESC/POS (ไม่ใช่ PeriPage)");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 2)], [0x1B, 0x40], "ขึ้นต้น ESC @");
    assert.ok(hasSeq(bytes, [0x1D, 0x76, 0x30, 0x00]), "มี GS v 0");
    const n = bytes.length;
    assert.equal(bytes[n - 3], 0x1B, "ท้าย feed ESC d"); assert.equal(bytes[n - 2], 0x64, "d");
    assert.ok(!hasSeq(bytes, [0x1D, 0x56]), "ไม่มี GS V cut");
    assert.ok(!hasSeq(bytes, [0x10, 0xFF, 0xFE]), "ไม่มี PeriPage reset");
  });
  await disconnectSlip();
});

// ── (h) fallback: ไม่มี fec7/ff02 → เลือก writable ตัวแรก ──
test("(h) ไม่มี fec7/ff02 → fallback writable ตัวแรก (เครื่องยี่ห้ออื่น)", async () => {
  await disconnectSlip();
  const svc = mkService("000018f0-0000-1000-8000-00805f9b34fb", [
    mkChar("00002a00-0000-1000-8000-00805f9b34fb", { read: true }),
    mkChar("00002af1-0000-1000-8000-00805f9b34fb", { write: true, writeWithoutResponse: true })
  ]);
  await withNavigator(mkNav({ name: "Xprinter", services: [svc] }), async () => {
    const ch = await connectSlipPrinter();
    assert.equal(ch.uuid, "00002af1-0000-1000-8000-00805f9b34fb", "fallback = writable ตัวแรก");
    assert.equal(usePeriPageProtocol(), false, "generic");
  });
  await disconnectSlip();
});
