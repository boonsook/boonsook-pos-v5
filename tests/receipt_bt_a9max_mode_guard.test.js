// build 592 — PeriPage A9 Max: framing ตัวจริงจากแอปทางการ (long-shot ผ่าน BLE ff02)
//
// Why: แกะ HCI snoop log ของแอป PeriPage ทางการ (A9 Max) พบว่าแอปพิมพ์ผ่าน
//   Bluetooth Classic SPP (Web Bluetooth เข้าไม่ถึง) ด้วยโปรโตคอล PeriPage เฉพาะ:
//   preamble 10FF20F0/10FF70/10FF12../density 10FF10 0004/reset 10FFFE01 1FB210,
//   ภาพผ่าน 10FF80 (บีบอัด proprietary), feed 1B4A50, finalize 10FFFE45.
//   long-shot: ยิง framing จริงนี้ผ่าน BLE ff02 + หุ้ม GS v 0 raster (best-effort).
// ★ ต้องล็อกเฉพาะเครื่องชื่อมี "MAX" — A9 (ชื่อไม่มี MAX) ต้อง byte-identical build 586.
// Run: node --test tests/receipt_bt_a9max_mode_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSlipPrinter, disconnectSlip, buildPrintBytes, isPeriPageMax, isPeriPage
} from "../modules/receipt_bt.js";

// mock GATT (A9/A9 Max GATT จริง: ISSC 8841 + ff00/ff02) — ต่างแค่ชื่อ
function mkChar(uuid, props) { return { uuid, properties: props, async writeValue() {}, async writeValueWithoutResponse() {} }; }
function mkService(uuid, chars) { return { uuid, async getCharacteristics() { return chars; } }; }
function mkNav(name) {
  const services = [
    mkService("49535343-fe7d-4ae5-8fa9-9fafd205e455", [mkChar("49535343-8841-43f4-a8d4-ecbe34729bb3", { write: true, writeWithoutResponse: true })]),
    mkService("0000ff00-0000-1000-8000-00805f9b34fb", [mkChar("0000ff02-0000-1000-8000-00805f9b34fb", { write: true, writeWithoutResponse: true })])
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
  const width = 384, height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}
const hasSub = (arr, sub) => {
  outer: for (let i = 0; i + sub.length <= arr.length; i++) {
    for (let j = 0; j < sub.length; j++) if (arr[i + j] !== sub[j]) continue outer;
    return true;
  }
  return false;
};
const startsWith = (arr, pre) => pre.every((b, i) => arr[i] === b);
const endsWith = (arr, suf) => suf.every((b, i) => arr[arr.length - suf.length + i] === b);

// ── (a) A9 Max → framing ตัวจริง: preamble + GS v 0 + feed + finalize ──
test("(a) A9 Max: buildPrintBytes = A9MAX preamble + GS v 0 + feed(1B4A50) + finalize(10FFFE45)", async () => {
  await disconnectSlip();
  await withNavigator(mkNav("PeriPage_A9MAX_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(isPeriPageMax(), true, "ชื่อมี MAX → isPeriPageMax");
    const out = buildPrintBytes(mockCanvas());
    // preamble ตัวจริง (init 10FF20F0 → reset 10FFFE01 1FB210)
    assert.ok(startsWith(out, [0x10, 0xFF, 0x20, 0xF0]), "ต้องเริ่มด้วย A9MAX preamble 10 FF 20 F0");
    assert.ok(hasSub(out, [0x10, 0xFF, 0x10, 0x00, 0x04]), "density 10 FF 10 00 04 (จาก capture)");
    assert.ok(hasSub(out, [0x10, 0xFF, 0xFE, 0x01, 0x1F, 0xB2, 0x10]), "reset 10 FF FE 01 1F B2 10 (ไม่ใช่ 12×00)");
    assert.ok(hasSub(out, [0x1D, 0x76, 0x30, 0x00]), "หุ้ม GS v 0 raster (best-effort image)");
    assert.ok(hasSub(out, [0x1B, 0x4A, 0x50]), "feed 1B 4A 50 (ตัวชี้วัดว่ากระดาษเลื่อน = ช่อง BLE ถึง engine)");
    assert.ok(endsWith(out, [0x10, 0xFF, 0xFE, 0x45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "จบด้วย finalize 10 FF FE 45 + 12×00");
    // ต้องไม่มี GS V cut (เครื่องพกพาไม่มีคัตเตอร์)
    assert.ok(!hasSub(out, [0x1D, 0x56, 0x01]), "A9 Max ต้องไม่มี GS V cut");
  });
  await disconnectSlip();
});

// ── (b) ★ A9 (ชื่อไม่มี MAX) = PeriPage framing 586 เป๊ะ (regression-safe) ──
test("(b) ★ A9 (non-MAX): buildPrintBytes = PeriPage framing 586 เป๊ะ — ไม่โดน A9 Max path", async () => {
  await disconnectSlip();
  await withNavigator(mkNav("PeriPage_A9_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(isPeriPageMax(), false, "ชื่อไม่มี MAX → ไม่ใช่ A9 Max");
    assert.equal(isPeriPage(), true, "ชื่อ peripage → PeriPage");
    const out = buildPrintBytes(mockCanvas());
    // build 586 PeriPage framing: reset 10FFFE01 + 12×00 → concentration 10FF10 0002 → GS v 0 → ESC J 0x60
    assert.ok(startsWith(out, [0x10, 0xFF, 0xFE, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "★ ต้องเริ่มด้วย PERIPAGE_RESET 16B (12×00) เดิม");
    assert.ok(hasSub(out, [0x10, 0xFF, 0x10, 0x00, 0x02]), "★ concentration 10 FF 10 00 02 (=2 เดิม ไม่ใช่ 04)");
    assert.ok(hasSub(out, [0x1D, 0x76, 0x30, 0x00]), "GS v 0 raster");
    assert.ok(endsWith(out, [0x1B, 0x4A, 0x60]), "★ จบด้วย ESC J 0x60 เดิม");
    // A9 ต้องไม่โดน framing ของ A9 Max
    assert.ok(!hasSub(out, [0x10, 0xFF, 0x20, 0xF0]), "★ A9 ต้องไม่มี A9MAX preamble");
    assert.ok(!hasSub(out, [0x10, 0xFF, 0xFE, 0x45]), "★ A9 ต้องไม่มี A9MAX finalize");
  });
  await disconnectSlip();
});
