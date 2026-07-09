// Phase 591 — เลือกขนาดกระดาษสลิป (58/80/107mm) + auto-default ตามรุ่น
//
// Why: A9 Max = 4 นิ้ว (832 dot); เครื่อง 80mm = 576. เดิม canvas กว้างคงที่ 384 (58mm) เท่านั้น.
// getPaperPx(): auto → ชื่อมี MAX ? 832 : 384 (A9 regression = 384); เลือกเอง → ตาม PAPER_WIDTHS.
// ★ A9 (auto, ชื่อไม่มี MAX) ต้องได้ 384 เป๊ะ (regression-safe).
// Run: node --test tests/receipt_bt_paper_width_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSlipPrinter, disconnectSlip, setPaperWidth, getPaperWidthKey, getPaperPx, canvasToRasterBody
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
function mockCanvasW(width) {
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}

// ── (a) auto ตามรุ่น: MAX → 832 ; A9 → 384 (regression) ──
test("(a) auto: ชื่อมี MAX → 832 ; ชื่อ A9 → 384 (regression A9)", async () => {
  setPaperWidth("auto");
  await disconnectSlip();
  await withNavigator(mkNav("PeriPage_A9MAX_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(getPaperPx(), 832, "A9 Max (auto) → 832 (4 นิ้ว)");
  });
  await disconnectSlip();
  await withNavigator(mkNav("PeriPage_A9_BLE"), async () => {
    await connectSlipPrinter();
    assert.equal(getPaperPx(), 384, "★ A9 (auto) → 384 เป๊ะ (regression-safe)");
  });
  await disconnectSlip();
});

// ── (b) เลือกเอง: 58/80/107 ──
test("(b) setPaperWidth: 58→384, 80→576, 107→832 (ไม่พึ่งชื่อรุ่น)", async () => {
  await disconnectSlip();
  await withNavigator(mkNav("PeriPage_A9_BLE"), async () => {
    await connectSlipPrinter();
    setPaperWidth("58"); assert.equal(getPaperPx(), 384, "58mm=384");
    setPaperWidth("80"); assert.equal(getPaperPx(), 576, "80mm=576");
    setPaperWidth("107"); assert.equal(getPaperPx(), 832, "107mm=832");
    assert.equal(getPaperWidthKey(), "107", "getPaperWidthKey สะท้อนค่าที่ตั้ง");
    assert.equal(setPaperWidth("999"), false, "key ไม่ถูก → ไม่เปลี่ยน (return false)");
    assert.equal(getPaperWidthKey(), "107", "key ผิดไม่ทับค่าเดิม");
  });
  await disconnectSlip();
  setPaperWidth("auto"); // reset
});

// ── (c) canvasToRasterBody: กว้าง 832 → bytesPerRow=104 ใน header GS v 0 ──
test("(c) canvasToRasterBody(832) → header GS v 0 xL=104 (832/8); 384 → xL=48", () => {
  function xL(width) {
    const out = canvasToRasterBody(mockCanvasW(width));
    // header GS v 0: 1D 76 30 00 xL xH yL yH
    for (let i = 0; i + 7 < out.length; i++) {
      if (out[i] === 0x1D && out[i + 1] === 0x76 && out[i + 2] === 0x30 && out[i + 3] === 0x00) return out[i + 4];
    }
    return -1;
  }
  assert.equal(xL(832), 104, "832/8 = 104 bytes/row");
  assert.equal(xL(576), 72, "576/8 = 72");
  assert.equal(xL(384), 48, "384/8 = 48");
});
