// Phase 585 — canvasToEscposRaster encoding (Bluetooth slip printer)
//
// Why: พิมพ์ใบเสร็จเป็น "ภาพ" (raster GS v 0) กันไทยเพี้ยนจาก codepage เครื่องสลิป.
// ตัวแปลง canvas→bytes เป็นหัวใจ — bit-packing/ขนาด/header ผิด = พิมพ์เลอะ/เครื่องค้าง.
// ทดสอบด้วย mock canvas (getImageData คืน Uint8ClampedArray ที่รู้ผล) — ไม่ต้องมี DOM/ฮาร์ดแวร์.
// LIMITATION: unit ครอบ encoding เท่านั้น; "พิมพ์ออกจริง + ไทยสวย + UUID เครื่องรุ่นนี้"
//             ต้อง owner ทดสอบบน Android + เครื่องสลิปจริง (ไม่มีฮาร์ดแวร์ใน CI).
// Run: node --test tests/receipt_bt_raster_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasToEscposRaster } from "../modules/receipt_bt.js";

// mock canvas จาก 2D array (1 = ดำ, 0 = ขาว)
function mockCanvas(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = rows[y][x] ? 0 : 255;   // ดำ = 0, ขาว = 255
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}

function findRasterHeader(bytes) {
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x1D && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) return i;
  }
  return -1;
}

test("(1) ขึ้นต้นด้วย ESC @ (init) + มี GS v 0 raster header (m=0)", () => {
  const out = canvasToEscposRaster(mockCanvas([[1, 1, 1, 1, 1, 1, 1, 1]]));
  assert.ok(out instanceof Uint8Array, "ต้องคืน Uint8Array");
  assert.equal(out[0], 0x1B, "byte0 = ESC");
  assert.equal(out[1], 0x40, "byte1 = @ (ESC @ init)");
  const h = findRasterHeader(out);
  assert.notEqual(h, -1, "ต้องมี GS v 0 (0x1D,0x76,0x30,0x00)");
  assert.equal(out[h + 3], 0x00, "m = 0 (normal)");
});

test("(2) xL/xH = bytesPerRow, yL/yH = จำนวนแถว (little-endian)", () => {
  // 8x2 → bytesPerRow=1, rows=2
  const out = canvasToEscposRaster(mockCanvas([[1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1]]));
  const h = findRasterHeader(out);
  assert.equal(out[h + 4], 1, "xL = bytesPerRow(1)");
  assert.equal(out[h + 5], 0, "xH = 0");
  assert.equal(out[h + 6], 2, "yL = rows(2)");
  assert.equal(out[h + 7], 0, "yH = 0");
});

test("(3) 384px กว้าง (chunk เดียว ≤255): xL=48 xH=0 + yL=แถว + data length = bytesPerRow*rows", () => {
  // Phase 586: body แบ่ง chunk ≤255 แถว — ใช้ 200 แถว = chunk เดียว (yL=200,yH=0)
  const rows = Array.from({ length: 200 }, () => new Array(384).fill(0));
  const out = canvasToEscposRaster(mockCanvas(rows));
  const h = findRasterHeader(out);
  assert.equal(out[h + 4], 48, "xL = 48 (384/8)");
  assert.equal(out[h + 5], 0, "xH = 0");
  assert.equal(out[h + 6], 200, "yL = 200");
  assert.equal(out[h + 7], 0, "yH = 0 (chunk ≤255)");
  const dataStart = h + 8;
  const dataLen = 48 * 200;
  // generic wrapper: ESC @(2) + [GS v0 header(8)+data] + feed(3) + cut(3) → ท้าย 6 bytes
  assert.equal(out.length - dataStart - 6, dataLen, "data bytes = bytesPerRow*rows (chunk เดียว)");
});

test("(4) bit-packing: ทึบ → 0xFF ทุก byte; สลับ(ดำ,ขาว) → 0xAA (MSB = pixel ซ้ายสุด)", () => {
  const solid = canvasToEscposRaster(mockCanvas([[1, 1, 1, 1, 1, 1, 1, 1]]));
  let h = findRasterHeader(solid);
  assert.equal(solid[h + 8], 0xFF, "8 pixel ดำ = 0xFF");

  const checker = canvasToEscposRaster(mockCanvas([[1, 0, 1, 0, 1, 0, 1, 0]]));
  h = findRasterHeader(checker);
  assert.equal(checker[h + 8], 0xAA, "ดำ,ขาว,ดำ,... = 0b10101010 = 0xAA");

  const blank = canvasToEscposRaster(mockCanvas([[0, 0, 0, 0, 0, 0, 0, 0]]));
  h = findRasterHeader(blank);
  assert.equal(blank[h + 8], 0x00, "8 pixel ขาว = 0x00");
});

test("(5) width ไม่หาร 8 ลงตัว → padding byte สุดท้าย (ceil)", () => {
  // width 10 → bytesPerRow = ceil(10/8) = 2
  const row = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const out = canvasToEscposRaster(mockCanvas([row]));
  const h = findRasterHeader(out);
  assert.equal(out[h + 4], 2, "xL = ceil(10/8) = 2");
  assert.equal(out[h + 8], 0xFF, "byte0 = 8 pixel แรกดำ");
  // pixel 8,9 ดำ → bit7,bit6 = 0xC0 ; bit ที่เหลือ (padding) = 0
  assert.equal(out[h + 9], 0xC0, "byte1 = 2 pixel (bit7,6) + padding 0");
});

test("(6) ปิดท้ายด้วย partial cut GS V 1 (0x1D,0x56,0x01)", () => {
  const out = canvasToEscposRaster(mockCanvas([[1, 1, 1, 1, 1, 1, 1, 1]]));
  const n = out.length;
  assert.equal(out[n - 3], 0x1D, "GS");
  assert.equal(out[n - 2], 0x56, "V");
  assert.equal(out[n - 1], 0x01, "1 (partial cut)");
});
