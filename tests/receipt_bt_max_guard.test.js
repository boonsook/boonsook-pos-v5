// Phase 589 — A9 Max ล็อกเลือกช่อง ff02 เฉพาะเครื่องชื่อมี "MAX"; A9 คงเดิม 586
//
// Why: 588 พัง A9 (regression) เพราะเลือก ff02/generic ให้ "ทุกเครื่อง". revert กลับ 586 แล้ว
// เพิ่ม override แคบ ๆ: connectSlipPrinter ถ้าชื่อ device มี "MAX" → เล็ง ff02 แทน fec7 (คง PeriPage
// framing จาก isPeriPage(ชื่อ)). A9 (ไม่มี MAX) → เล็ง fec7 → ไม่เจอ → fallback writable ตัวแรก (8841) = 586 เป๊ะ.
// LIMITATION: "A9 Max พิมพ์ออกจริง" ต้อง owner ทดสอบเครื่องจริง; A9 ต้อง regression-safe.
// Run: node --test tests/receipt_bt_max_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectSlipPrinter, disconnectSlip, getSlipTarget, buildPrintBytes } from "../modules/receipt_bt.js";

const ISSC_SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const ISSC_8841 = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const FF00_SVC = "0000ff00-0000-1000-8000-00805f9b34fb";
const FF02 = "0000ff02-0000-1000-8000-00805f9b34fb";

function mkChar(uuid, props) { return { uuid, properties: props, async writeValue() {}, async writeValueWithoutResponse() {} }; }
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
// A9 / A9 Max GATT จริง: ISSC (8841) ก่อน + ff00 (ff02) — เหมือนกันทั้งสองเครื่อง ต่างแค่ "ชื่อ"
function realGatt(name) {
  return mkNav({
    name,
    services: [
      mkService(ISSC_SVC, [mkChar(ISSC_8841, { write: true, writeWithoutResponse: true })]),
      mkService(FF00_SVC, [
        mkChar("0000ff01-0000-1000-8000-00805f9b34fb", { notify: true }),
        mkChar(FF02, { write: true, writeWithoutResponse: true }),
        mkChar("0000ff03-0000-1000-8000-00805f9b34fb", { notify: true })
      ])
    ]
  });
}

// ── (1) regression A9: ชื่อไม่มี MAX → char 8841 (เหมือน 586) + PeriPage framing ──
test("(1) A9 (ชื่อไม่มี MAX): เลือก 8841 (fallback, ไม่ใช่ ff02) + buildPrintBytes = PeriPage 10FFFE01 — เหมือน 586", async () => {
  await disconnectSlip();
  await withNavigator(realGatt("PeriPage_A9_BLE"), async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /8841/i, "A9 ต้องได้ 8841 (fallback writable ตัวแรก) — ไม่ใช่ ff02");
    assert.ok(!/ff02/i.test(getSlipTarget().char), "A9 ต้องไม่โดนเลือก ff02 (regression 588)");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 4)], [0x10, 0xFF, 0xFE, 0x01], "PeriPage framing (reset) — เหมือน 586");
    assert.ok(!hasSeq(bytes, [0x1B, 0x40]), "ต้องไม่มี ESC @ (ไม่ใช่ generic)");
  });
  await disconnectSlip();
});

// ── (2) A9 Max: ชื่อมี MAX → char ff02 + คง PeriPage framing ──
test("(2) A9 Max (ชื่อมี MAX): เลือก ff02 (override) + buildPrintBytes = PeriPage (10FFFE01 + GS v0 + ESC J)", async () => {
  await disconnectSlip();
  await withNavigator(realGatt("PeriPage_A9MAX_BLE"), async () => {
    await connectSlipPrinter();
    assert.match(getSlipTarget().char, /ff02/i, "A9 Max ต้องได้ ff02 (override MAX)");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 4)], [0x10, 0xFF, 0xFE, 0x01], "คง PeriPage framing (reset)");
    assert.ok(hasSeq(bytes, [0x1D, 0x76, 0x30, 0x00]), "มี GS v 0 raster");
    const n = bytes.length;
    assert.equal(bytes[n - 3], 0x1B, "ท้าย ESC J"); assert.equal(bytes[n - 2], 0x4A, "J");
    assert.ok(!hasSeq(bytes, [0x1B, 0x40]), "ไม่มี ESC @ (ยัง PeriPage ไม่ใช่ generic)");
    assert.ok(!hasSeq(bytes, [0x1D, 0x56]), "ไม่มี GS V cut");
  });
  await disconnectSlip();
});
