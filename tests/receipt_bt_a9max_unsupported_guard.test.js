// build 594 — PeriPage A9 Max: ปิดเคส (พิมพ์ผ่านเว็บไม่ได้) + แจ้ง user ให้ชัด
//
// Why: พิสูจน์ครบ 3 ทาง (592 framing / 593 notify handshake / btsnoop log) แล้วว่า
//   A9 Max พิมพ์ได้เฉพาะ Bluetooth Classic (RFCOMM/SPP) ซึ่ง Web Bluetooth เข้าไม่ถึง.
//   build 594 ถอดโค้ด experimental (590 ff02 override / 592 framing / 593 notify) ออกหมด
//   → printReceipt/testPrint บล็อกเครื่องชื่อ MAX แล้ว throw A9MAX_UNSUPPORTED_MSG (แจ้งชัด).
// ★ A9 (ชื่อไม่มี MAX) ต้องไม่โดนบล็อก + connect/buildPrintBytes byte-identical 586.
// Run: node --test tests/receipt_bt_a9max_unsupported_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSlipPrinter, disconnectSlip, getSlipTarget, buildPrintBytes,
  isPeriPageMax, isPeriPage, testPrint, printReceipt, A9MAX_UNSUPPORTED_MSG
} from "../modules/receipt_bt.js";

const ISSC_SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const ISSC_8841 = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const FF00_SVC = "0000ff00-0000-1000-8000-00805f9b34fb";
const FF02 = "0000ff02-0000-1000-8000-00805f9b34fb";

function mkChar(uuid, props) { return { uuid, properties: props, async writeValue() {}, async writeValueWithoutResponse() {} }; }
function mkService(uuid, chars) { return { uuid, async getCharacteristics() { return chars; } }; }
function realGatt(name) {
  const services = [
    mkService(ISSC_SVC, [
      mkChar("49535343-1e4d-4bd9-ba61-23c647249616", { notify: true }),
      mkChar(ISSC_8841, { write: true, writeWithoutResponse: true })
    ]),
    mkService(FF00_SVC, [
      mkChar("0000ff01-0000-1000-8000-00805f9b34fb", { notify: true }),
      mkChar(FF02, { write: true, writeWithoutResponse: true }),
      mkChar("0000ff03-0000-1000-8000-00805f9b34fb", { notify: true })
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
function mockCanvas() {
  const width = 384, height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}
const hasSeq = (arr, seq) => {
  for (let i = 0; i + seq.length <= arr.length; i++) { let ok = true; for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; } if (ok) return true; }
  return false;
};

// ── (1) A9 Max → testPrint/printReceipt บล็อก + throw A9MAX_UNSUPPORTED_MSG (แจ้งชัด) ──
test("(1) A9 Max: testPrint & printReceipt โยน A9MAX_UNSUPPORTED_MSG (บล็อกก่อนวาด canvas — ไม่เงียบ)", async () => {
  await disconnectSlip();
  await withNavigator(realGatt("PeriPage_A9MAX_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(isPeriPageMax(), true, "ชื่อมี MAX → isPeriPageMax");
    assert.match(A9MAX_UNSUPPORTED_MSG, /A9 Max.*ไม่ได้/, "ข้อความต้องบอกว่า A9 Max พิมพ์ไม่ได้");
    await assert.rejects(() => testPrint({}), (e) => e.message === A9MAX_UNSUPPORTED_MSG, "testPrint ต้อง throw ข้อความชัด");
    await assert.rejects(() => printReceipt({}, {}), (e) => e.message === A9MAX_UNSUPPORTED_MSG, "printReceipt ต้อง throw ข้อความชัด");
  });
  await disconnectSlip();
});

// ── (2) ★ A9 (ชื่อไม่มี MAX): connect + buildPrintBytes = 586 เป๊ะ (regression, ไม่โดนบล็อก) ──
test("(2) ★ A9 (non-MAX): fallback 8841 + PeriPage framing 586 + ไม่ใช่ A9 Max (regression-safe)", async () => {
  await disconnectSlip();
  await withNavigator(realGatt("PeriPage_A9_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(isPeriPageMax(), false, "★ A9 ต้องไม่ใช่ A9 Max → ไม่โดนบล็อก");
    assert.equal(isPeriPage(), true, "A9 = PeriPage");
    assert.match(getSlipTarget().char, /8841/i, "A9 → fallback writable ตัวแรก = 8841 (byte-identical 586)");
    const bytes = buildPrintBytes(mockCanvas());
    assert.deepEqual([...bytes.slice(0, 4)], [0x10, 0xFF, 0xFE, 0x01], "PeriPage framing (reset) เหมือน 586");
    assert.ok(hasSeq(bytes, [0x10, 0xFF, 0x10, 0x00, 0x02]), "concentration 10 FF 10 00 02 (=2 เดิม)");
    assert.ok(hasSeq(bytes, [0x1D, 0x76, 0x30, 0x00]), "GS v 0 raster");
    assert.equal(bytes[bytes.length - 3], 0x1B, "ท้าย ESC J");
    assert.equal(bytes[bytes.length - 2], 0x4A, "J 0x4A");
    assert.equal(bytes[bytes.length - 1], 0x60, "ESC J 0x60 (เดิม)");
    assert.ok(!hasSeq(bytes, [0x1B, 0x40]), "ไม่มี ESC @ (ยัง PeriPage)");
  });
  await disconnectSlip();
});
