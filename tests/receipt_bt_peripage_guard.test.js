// Phase 586 — PeriPage (A9MAX) protocol framing + service fee7 / char fec7 + GATT diagnostic
//
// Why: build 585 เชื่อม PeriPage ได้แต่กดพิมพ์ไม่ออก — PeriPage ใช้ raster GS v 0 เหมือน ESC/POS
// แต่ต้องมี "คำสั่งหุ้ม" เฉพาะ (reset 10FFFE01, concentration 10FF1000 02, feed ESC J) ไม่ใช่ ESC @/GS V cut;
// + ต้องเขียนที่ char fec7 ใต้ service fee7. (ref: bitrate16/peripage-python)
// LIMITATION: "พิมพ์ออกจริง" ต้อง owner ทดสอบบน PeriPage A9MAX จริง (ไม่มีฮาร์ดแวร์ใน CI).
// Run: node --test tests/receipt_bt_peripage_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  connectSlipPrinter, disconnectSlip, buildPrintBytes, canvasToRasterBody,
  isPeriPage, getSlipTarget, diagnoseSlipPrinter
} from "../modules/receipt_bt.js";

// ── mock helpers ─────────────────────────────────────────────
function mockCanvas(rows) {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = rows[y][x] ? 0 : 255;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { width, height, getContext() { return { getImageData() { return { data }; } }; } };
}
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
function hasSeq(arr, seq) {
  for (let i = 0; i + seq.length <= arr.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
const FEE7 = "0000fee7-0000-1000-8000-00805f9b34fb";
const FEC7 = "0000fec7-0000-1000-8000-00805f9b34fb";
const solidRow = () => [1, 1, 1, 1, 1, 1, 1, 1];

// ── (a) source: fee7 + PERIPAGE_WRITE_CHAR fec7 ───────────────
test("(a) SLIP_PRINTER_SERVICES มี PeriPage service fee7 + write char fec7", () => {
  const src = fs.readFileSync(path.resolve("modules/receipt_bt.js"), "utf8");
  assert.match(src, /"0000fee7-0000-1000-8000-00805f9b34fb"/, "ต้องมี fee7 (PeriPage) ใน service list");
  assert.match(src, /PERIPAGE_WRITE_CHAR\s*=\s*"fec7"/, "ต้อง target write char fec7");
});

// ── (b) PeriPage framing ─────────────────────────────────────
test("(b) buildPrintBytes (PeriPage) = reset + concentration + GS v 0 + ESC J feed; ไม่มี cut/ESC @", async () => {
  await disconnectSlip();
  const svc = mkService(FEE7, [mkChar(FEC7, { write: true, writeWithoutResponse: true })]);
  await withNavigator(mkNav({ name: "PeriPage_A9MAX", services: [svc] }), async () => {
    await connectSlipPrinter();
    assert.ok(isPeriPage(), "device PeriPage → isPeriPage true");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 4)], [0x10, 0xFF, 0xFE, 0x01], "ขึ้นต้น reset 10 FF FE 01");
    assert.ok(hasSeq(bytes, [0x10, 0xFF, 0x10, 0x00, 0x02]), "มี setConcentration 10 FF 10 00 02");
    assert.ok(hasSeq(bytes, [0x1D, 0x76, 0x30, 0x00]), "มี GS v 0 raster body");
    const n = bytes.length;
    assert.equal(bytes[n - 3], 0x1B, "ลงท้าย ESC J (1B)");
    assert.equal(bytes[n - 2], 0x4A, "J (4A) feed");
    assert.ok(!hasSeq(bytes, [0x1D, 0x56]), "ต้องไม่มี GS V cut (PeriPage ไม่มีคัตเตอร์)");
    assert.ok(!hasSeq(bytes, [0x1B, 0x40]), "ต้องไม่มี ESC @ (PeriPage ไม่รู้จัก)");
  });
  await disconnectSlip();
});

// ── (c) generic path คงเดิม ──────────────────────────────────
test("(c) buildPrintBytes (generic) = ESC @ + body + feed (Phase 588: ไม่มี GS V cut)", async () => {
  await disconnectSlip();
  const svc = mkService("000018f0-0000-1000-8000-00805f9b34fb", [mkChar("00002af1-0000-1000-8000-00805f9b34fb", { write: true, writeWithoutResponse: true })]);
  await withNavigator(mkNav({ name: "Xprinter-58", services: [svc] }), async () => {
    await connectSlipPrinter();
    assert.ok(!isPeriPage(), "ชื่อ/service ไม่ใช่ PeriPage → generic");
    const bytes = buildPrintBytes(mockCanvas([solidRow()]));
    assert.deepEqual([...bytes.slice(0, 2)], [0x1B, 0x40], "ขึ้นต้น ESC @");
    assert.ok(hasSeq(bytes, [0x1D, 0x76, 0x30, 0x00]), "มี GS v 0 body");
    // Phase 588: generic = ESC @ + body + feed (★ ไม่มี GS V cut แล้ว)
    const n = bytes.length;
    assert.equal(bytes[n - 3], 0x1B, "ลงท้าย ESC d (feed)");
    assert.equal(bytes[n - 2], 0x64, "d");
    assert.ok(!hasSeq(bytes, [0x1D, 0x56]), "ต้องไม่มี GS V cut");
  });
  await disconnectSlip();
});

// ── (d) canvasToRasterBody chunk ≤255 แถว ────────────────────
test("(d) canvasToRasterBody: สูง 300 แถว → chunked (GS v 0 header ≥2 ชุด, chunk แรก yL=255)", () => {
  const rows = Array.from({ length: 300 }, () => solidRow());
  const body = canvasToRasterBody(mockCanvas(rows));
  let count = 0, firstHdr = -1;
  for (let i = 0; i + 3 < body.length; i++) {
    if (body[i] === 0x1D && body[i + 1] === 0x76 && body[i + 2] === 0x30 && body[i + 3] === 0x00) {
      if (firstHdr === -1) firstHdr = i;
      count++;
    }
  }
  assert.ok(count >= 2, "300 แถว (>255) → ต้อง ≥2 GS v 0 chunk");
  assert.equal(body[firstHdr + 6], 255, "chunk แรก yL=255 (เต็ม chunk)");
  assert.equal(body[firstHdr + 7], 0, "yH=0 (chunk ≤255)");
  // ไม่มี init/feed/cut ใน body (เฉพาะ raster)
  assert.ok(!hasSeq(body, [0x1B, 0x40]), "body ไม่มี ESC @");
  assert.ok(!hasSeq(body, [0x1D, 0x56]), "body ไม่มี GS V cut");
});

// ── (e) connect เลือก fec7 ก่อน (ข้าม writable ตัวอื่น + ข้าม service) ──
test("(e) connectSlipPrinter เลือก char fec7 แม้มี writable ตัวอื่นใน service ก่อนหน้า", async () => {
  await disconnectSlip();
  const svcA = mkService("000018f0-0000-1000-8000-00805f9b34fb", [mkChar("0000abcd-0000-1000-8000-00805f9b34fb", { write: true })]);
  const svcB = mkService(FEE7, [
    mkChar("0000fec8-0000-1000-8000-00805f9b34fb", { indicate: true }),
    mkChar(FEC7, { write: true, writeWithoutResponse: true })
  ]);
  await withNavigator(mkNav({ name: "PeriPage_A9MAX", services: [svcA, svcB] }), async () => {
    const ch = await connectSlipPrinter();
    assert.match(ch.uuid, /fec7/i, "ต้องเลือก fec7 (ไม่ใช่ abcd ที่ writable มาก่อน)");
    assert.equal(getSlipTarget().char, FEC7, "getSlipTarget char = fec7");
    assert.equal(getSlipTarget().service, FEE7, "getSlipTarget service = fee7");
  });
  await disconnectSlip();
});

// ── (f) diagnoseSlipPrinter คืน array {service,char,props} ─────
test("(f) diagnoseSlipPrinter คืน array {service,char,props} จาก getPrimaryServices", async () => {
  const svc = mkService(FEE7, [
    mkChar(FEC7, { write: true, writeWithoutResponse: true }),
    mkChar("0000fec8-0000-1000-8000-00805f9b34fb", { indicate: true })
  ]);
  await withNavigator(mkNav({ name: "PeriPage_A9MAX", services: [svc] }), async () => {
    const rows = await diagnoseSlipPrinter();
    assert.ok(Array.isArray(rows) && rows.length === 2, "คืน array 2 char");
    const w = rows.find((r) => /fec7/i.test(r.char));
    assert.equal(w.service, FEE7, "service uuid ถูก");
    assert.match(w.props, /write/, "props ระบุ write (เช็คชื่อ flag เอง เพราะเป็น getter)");
    assert.match(rows.find((r) => /fec8/i.test(r.char)).props, /indicate/, "props indicate ถูก");
  });
});

// ── (g) diagnose feature-detect: ไม่รองรับ → reject Android/Chrome ─
test("(g) diagnoseSlipPrinter reject Android/Chrome เมื่อไม่รองรับ (Node ไม่มี bluetooth)", async () => {
  await assert.rejects(() => diagnoseSlipPrinter(), /Android|Chrome/);
});
