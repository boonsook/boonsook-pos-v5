// ═══════════════════════════════════════════════════════════
//  receipt_bt.js — Bluetooth thermal slip printer (Phase 585)
//  Web Bluetooth (BLE) → เครื่องสลิป 58/80mm → ESC/POS raster
//
//  ทำไมพิมพ์เป็น "ภาพ" (raster) ไม่ใช่ text:
//    เครื่องสลิปถูก ๆ รับ ESC/POS text ต้องเลือก codepage ไทย (TIS-620/CP874)
//    ที่ต่างกันทุกรุ่น = ไทยเพี้ยนง่าย. วาดใบเสร็จลง <canvas> ด้วย ctx.fillText
//    (เรนเดอร์ฟอนต์ไทยเนทีฟจาก browser) → threshold เป็น 1-bit → ส่ง GS v 0
//    = เครื่องพิมพ์ pixel ตรง ๆ ไม่พึ่ง font/codepage ในเครื่อง.
//
//  ขอบเขต: Android (Chrome/Edge) เท่านั้น — iOS บล็อก Web Bluetooth ทุกเบราว์เซอร์.
//  ต้อง feature-detect (isSlipSupported) ก่อน ไม่ crash.
//  reference (คนละเครื่อง/ภาษา): bt_printer.js (label TSPL), thermal_printer.js (ESC/POS text, dead)
// ═══════════════════════════════════════════════════════════

import { money, formatNumber, formatDateTime } from "./utils.js";

// Common BLE thermal-printer service UUIDs (generic slip printers + 000018f0 generic printer)
// ★ Phase 586: fee7 = PeriPage (A9/A9MAX ฯลฯ) — วางต้น list เพื่อให้ match ก่อน
const SLIP_PRINTER_SERVICES = [
  "0000fee7-0000-1000-8000-00805f9b34fb",   // PeriPage (A9/A9MAX) — write=fec7, indicate=fec8, read=fec9
  "000018f0-0000-1000-8000-00805f9b34fb",   // Generic printer service (ESC/POS slip)
  "0000ff00-0000-1000-8000-00805f9b34fb",   // Xprinter / common thermal
  "0000ffe0-0000-1000-8000-00805f9b34fb",   // HM-10 / common BLE serial
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",   // Microchip / ISSC transparent UART
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2"    // Some Goojprt/PT-210 style printers
];

// PeriPage BLE profile (ref: bitrate16/peripage-python) — write char ภายใต้ service fee7
const PERIPAGE_WRITE_CHAR = "fec7";   // 0000fec7-... — เลือก characteristic นี้ก่อน
// PeriPage framing bytes (ไม่ใช่ ESC/POS มาตรฐาน — เครื่องยี่ห้ออื่นไม่ต้องใช้)
const PERIPAGE_RESET = [0x10, 0xFF, 0xFE, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // reset (16 bytes)
const PERIPAGE_CONCENTRATION = [0x10, 0xFF, 0x10, 0x00, 0x02];                        // setConcentration=2 (เข้มสุด กันจาง)
const PERIPAGE_FEED = [0x1B, 0x4A, 0x60];                                             // ESC J 0x60 (feed ~96 dot; ไม่มี cut)
// generic ESC/POS framing (เครื่องมีคัตเตอร์)
const ESC_INIT = [0x1B, 0x40];         // ESC @  (init)
const ESC_FEED = [0x1B, 0x64, 0x03];   // ESC d 3  (feed 3 lines)
const ESC_CUT = [0x1D, 0x56, 0x01];    // GS V 1   (partial cut)

// ═══════════════════════════════════════════════════════════
//  build 592: PeriPage A9 Max — long-shot ผ่าน BLE ff02
//  ─────────────────────────────────────────────────────────
//  ที่มา: แกะ Android HCI snoop log (btsnoop_hci.log) ของแอป PeriPage ทางการ
//  ขณะพิมพ์ A9 Max พบว่า **แอปทางการพิมพ์ผ่าน Bluetooth Classic (RFCOMM/SPP)**
//  ไม่ใช่ BLE — ซึ่ง Web Bluetooth เปิด socket Classic/SPP ไม่ได้ (ข้อจำกัด browser).
//  โปรโตคอลที่แอปส่ง: init/density/reset/feed/finalize (ไบต์ด้านล่าง = ถอดจริง) +
//  ภาพผ่านคำสั่ง 10 FF 80 ที่ **บีบอัดแบบ proprietary (คล้าย CCITT G4)** —
//  ยัง reproduce ใน vanilla JS (ห้ามใช้ dep) ไม่ได้.
//  long-shot: ยิง framing จริงนี้ผ่าน BLE ff02 + หุ้ม GS v 0 raster (best-effort).
//  ตัวชี้วัด = A9MAX_FEED (1B 4A 50): ถ้า A9 Max "เลื่อนกระดาษ" = ช่อง BLE ถึง
//  print engine จริง → คุ้มลงทุนถอด G4 ต่อ; ถ้าไม่ขยับเลย = ช่อง BLE ไม่ใช่ช่องพิมพ์.
//  ★ ล็อกเฉพาะเครื่องชื่อมี "MAX" — A9 (และเครื่องอื่น) ไม่แตะ (byte-identical 586).
// ═══════════════════════════════════════════════════════════
const A9MAX_PREAMBLE = [
  0x10, 0xFF, 0x20, 0xF0,
  0x10, 0xFF, 0x70,
  0x10, 0xFF, 0x12, 0x00, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // 10 FF 12 00 14 + 12×00
  0x10, 0xFF, 0x10, 0x00, 0x04,                                       // setConcentration = 4 (เข้ม)
  0x10, 0xFF, 0xFE, 0x01, 0x1F, 0xB2, 0x10                            // reset (จาก capture — ไม่ใช่ 12×00)
];
const A9MAX_FEED = [0x1B, 0x4A, 0x50];                                          // ESC J 0x50 (feed ~80 dot)
const A9MAX_FINALIZE = [0x10, 0xFF, 0xFE, 0x45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // finalize (16B)

// รายชื่อ property flag ของ BluetoothCharacteristicProperties (getter บน prototype —
// Object.entries ไม่คืน → ต้องเช็คชื่อเอง; ใช้ใน diagnostic)
const CHAR_PROP_FLAGS = [
  "broadcast", "read", "writeWithoutResponse", "write",
  "notify", "indicate", "authenticatedSignedWrites", "reliableWrite", "writableAuxiliaries"
];
function propsString(props) {
  if (!props) return "";
  return CHAR_PROP_FLAGS.filter((k) => props[k]).join(",");
}
// รวมหลาย byte-array/Uint8Array เป็น Uint8Array เดียว
function concatBytes(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const CANVAS_WIDTH = 384;   // 58mm @ 203dpi (default — A9)
// ★ Phase 591: ความกว้างกระดาษ (dot @203dpi): 58mm=384, 80mm=576, 107mm/4"=832
const PAPER_WIDTHS = { "58": CANVAS_WIDTH, "80": 576, "107": 832 };
const PAPER_KEYS = ["auto", "58", "80", "107"];
const PAPER_LS_KEY = "bsk_slip_paper";
const PAD = 10;
const CHUNK = 200;          // BLE MTU-safe (writeWithoutResponse ~200 ปลอดภัยกับเครื่องส่วนใหญ่)
const CHUNK_DELAY_MS = 20;  // กัน buffer overrun
const RASTER_MAX_ROWS = 255; // Phase 586: แบ่ง GS v 0 ทีละ ≤255 แถว (yL 1 byte — PeriPage/บาง firmware ต้องการ)

let _device = null;
let _char = null;
let _serviceUuid = null;   // Phase 586: จำ service/char ที่เลือก โชว์ใน diagnostic/status + ใช้ตรวจ PeriPage
let _charUuid = null;
// build 593: notify handshake (เฉพาะ A9 Max) — เครื่อง ff00/ff02 บางรุ่นต้อง "เปิด" notify (ff01/ff03)
// ก่อน channel เขียนถึงจะ active. เก็บ notify char ที่ subscribe ไว้เพื่อไม่ทำซ้ำ.
let _notifyChars = [];
let _notifyStarted = false;

// ★ Phase 591: ขนาดกระดาษ — "auto" (ตามรุ่น) | "58" | "80" | "107"; persist localStorage
let _paperKey = "auto";
try {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(PAPER_LS_KEY);
    if (v && PAPER_KEYS.includes(v)) _paperKey = v;
  }
} catch (_) { /* ignore */ }

// ความกว้าง canvas ที่จะใช้ (px): auto → ตามรุ่น (ชื่อมี MAX = 4"/832; ไม่งั้น 58mm/384)
export function getPaperPx() {
  if (_paperKey === "auto") {
    return /max/i.test(_device?.name || "") ? PAPER_WIDTHS["107"] : CANVAS_WIDTH;
  }
  return PAPER_WIDTHS[_paperKey] || CANVAS_WIDTH;
}
export function getPaperWidthKey() { return _paperKey; }
export function setPaperWidth(key) {
  if (!PAPER_KEYS.includes(key)) return false;
  _paperKey = key;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(PAPER_LS_KEY, key); } catch (_) { /* ignore */ }
  return true;
}

// ─── Feature detection ───────────────────────────────────────
export function isSlipSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

// ─── Connect (mirror bt_printer.js connectPrinter — proven) ──
export async function connectSlipPrinter() {
  if (!isSlipSupported()) {
    throw new Error("อุปกรณ์นี้ไม่รองรับ Bluetooth printing — ใช้ Android + Chrome/Edge (iPhone/iPad ใช้ไม่ได้)");
  }
  // reuse ถ้ายัง connected + มี characteristic
  if (_device && _device.gatt?.connected && _char) return _char;

  // acceptAllDevices: เห็นทุกอุปกรณ์ BLE (namePrefix อาจ miss ชื่อเครื่องแปลก ๆ)
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (slip printer pair, 1 device/session)
  _device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SLIP_PRINTER_SERVICES
  });
  _device.addEventListener("gattserverdisconnected", () => { _char = null; _serviceUuid = null; _charUuid = null; _notifyChars = []; _notifyStarted = false; });

  const server = await _device.gatt.connect();

  // รวบรวม service ทั้งหมดที่ประกาศไว้ (getPrimaryServices ก่อน — เห็นครบ; fallback วนทีละ uuid)
  let services = [];
  try { services = await server.getPrimaryServices(); } catch (_) { services = []; }
  if (!services.length) {
    for (const uuid of SLIP_PRINTER_SERVICES) {
      try { const s = await server.getPrimaryService(uuid); if (s) services.push(s); } catch (_) { /* ลองตัวถัดไป */ }
    }
  }
  if (!services.length) {
    throw new Error("ไม่พบ printer service — รุ่นนี้อาจเป็น Bluetooth Classic (Web Bluetooth ใช้ได้แค่ BLE)");
  }

  const writable = (c) => c.properties.write || c.properties.writeWithoutResponse;
  // ★ Phase 586: หา characteristic fec7 (PeriPage write) จาก "ทุก service" ก่อน;
  //   ไม่เจอ → fallback ตัว writable ตัวแรกที่พบ (เครื่องยี่ห้ออื่น)
  // ★ Phase 589 override เฉพาะเครื่องชื่อมี "MAX" (A9 Max) → เล็ง ff02 (thermal มาตรฐาน)
  //   แทน fec7; เครื่องอื่น (A9 ฯลฯ) คงเดิม 586 เป๊ะ (เล็ง fec7 → fallback ตัว writable ตัวแรก = 8841)
  const isMax = /max/i.test(_device?.name || "");
  const preferUuid = isMax ? "ff02" : PERIPAGE_WRITE_CHAR;
  let picked = null, pickedSvc = null, firstWritable = null, firstWritableSvc = null;
  for (const svc of services) {
    let chs = [];
    try { chs = await svc.getCharacteristics(); } catch (_) { chs = []; }
    for (const c of chs) {
      if (!writable(c)) continue;
      if (!firstWritable) { firstWritable = c; firstWritableSvc = svc; }
      if (String(c.uuid).toLowerCase().includes(preferUuid)) { picked = c; pickedSvc = svc; break; }
    }
    if (picked) break;
  }
  if (!picked) { picked = firstWritable; pickedSvc = firstWritableSvc; }
  if (!picked) throw new Error("ไม่พบ writable characteristic ในเครื่องพิมพ์");
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (slip printer connect flow)
  _char = picked;
  _serviceUuid = pickedSvc?.uuid || null;
  _charUuid = picked.uuid;

  // ★ build 593: notify handshake — เฉพาะ A9 Max (ชื่อมี MAX) เท่านั้น.
  //   ช่อง ff00/ff02 บางรุ่นต้อง enable CCCD ของ notify char (ff01/ff03) ก่อน firmware ถึงจะ
  //   ประมวลผล write ที่ ff02. subscribe notify char ทุกตัวใน service เดียวกับ ff02 (ครั้งเดียว).
  //   ★ A9 (และเครื่องอื่น) ไม่เข้า block นี้ → connect byte-identical 592/586 (ไม่ subscribe อะไร).
  if (isMax && pickedSvc && !_notifyStarted) {
    let notifyChs = [];
    try { notifyChs = await pickedSvc.getCharacteristics(); } catch (_) { notifyChs = []; }
    for (const c of notifyChs) {
      if (!c.properties?.notify || typeof c.startNotifications !== "function") continue;
      try {
        await c.startNotifications();
        // บาง BLE stack ต้องมี listener characteristicvaluechanged ค้างไว้ CCCD ถึงคงอยู่ (no-op)
        if (typeof c.addEventListener === "function") c.addEventListener("characteristicvaluechanged", () => {});
        _notifyChars.push(c);
      } catch (_) { /* char นี้ subscribe ไม่ได้ → ข้าม */ }
    }
    _notifyStarted = _notifyChars.length > 0;
    // settle สั้น ๆ หลัง enable CCCD — บาง firmware ต้องรอ pipe พร้อมก่อนรับ write แรก
    if (_notifyStarted) await new Promise(r => { setTimeout(r, 120); });
  }
  return _char;
}

export function isSlipConnected() {
  return !!(_device?.gatt?.connected && _char);
}

export function getSlipDeviceName() {
  return _device?.name || "";
}

export async function disconnectSlip() {
  try { if (_device?.gatt?.connected) _device.gatt.disconnect(); } catch (_) { /* ignore */ }
  _device = null;
  _char = null;
  _serviceUuid = null;
  _charUuid = null;
  _notifyChars = [];      // build 593: ล้าง notify handshake state
  _notifyStarted = false;
}

// Phase 586: service/characteristic ที่เลือกตอน connect (โชว์ในสถานะ/diagnostic)
export function getSlipTarget() {
  return { service: _serviceUuid, char: _charUuid };
}

// เครื่องเป็น PeriPage ไหม → ตัดสินจากชื่อ device หรือ service fee7 ที่เลือก
export function isPeriPage() {
  return /peripage/i.test(_device?.name || "") || /fee7/i.test(_serviceUuid || "");
}

// build 592: A9 Max ไหม (ชื่อมี "MAX") → ใช้ framing ตัวจริงจากแอปทางการ (long-shot ผ่าน BLE)
export function isPeriPageMax() {
  return /max/i.test(_device?.name || "");
}

// ═══════════════════════════════════════════════════════════
//  Phase 586: GATT diagnostic — dump service/characteristic จริงของเครื่อง
//  ให้ owner (มือถือ) เห็น/screenshot ได้ — กันเดา UUID ถ้า firmware ต่างจากเอกสาร
//  requestDevice ใหม่ (user gesture) → เห็นเฉพาะ service ใน optionalServices (= SLIP_PRINTER_SERVICES)
//  คืน array ของ { service, char, props }
// ═══════════════════════════════════════════════════════════
export async function diagnoseSlipPrinter() {
  if (!isSlipSupported()) {
    throw new Error("อุปกรณ์นี้ไม่รองรับ Bluetooth printing — ใช้ Android + Chrome/Edge (iPhone/iPad ใช้ไม่ได้)");
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SLIP_PRINTER_SERVICES
  });
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  const rows = [];
  for (const svc of services) {
    let chs = [];
    try { chs = await svc.getCharacteristics(); } catch (_) { chs = []; }
    if (!chs.length) { rows.push({ service: svc.uuid, char: "(no characteristics)", props: "" }); continue; }
    for (const c of chs) {
      rows.push({ service: svc.uuid, char: c.uuid, props: propsString(c.properties) });
    }
  }
  return rows;
}

// ─── Send raster in BLE-sized chunks (mirror bt_printer.js sendChunked) ──
export async function sendChunked(characteristic, bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < buf.length; i += CHUNK) {
    const slice = buf.slice(i, Math.min(i + CHUNK, buf.length));
    if (characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
    await new Promise(r => { setTimeout(r, CHUNK_DELAY_MS); });
  }
}

// ═══════════════════════════════════════════════════════════
//  Canvas → raster body (GS v 0 เท่านั้น — ไม่มี init/feed/cut)
//  รับ canvas (หรือ mock ที่มี width/height/getContext('2d').getImageData)
//  ★ Phase 586: แบ่งเป็น chunk ทีละ ≤255 แถว — แต่ละ chunk มี header GS v 0 ของตัวเอง
//     (yL 1 byte, yH=0). PeriPage/บาง firmware ต้อง header ต่อ chunk; เครื่อง ESC/POS
//     มาตรฐานก็รับ GS v 0 ซ้อนหลายบล็อกแนวตั้งได้ปกติ.
// ═══════════════════════════════════════════════════════════
export function canvasToRasterBody(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, width, height).data;   // RGBA
  const bytesPerRow = Math.ceil(width / 8);

  const raster = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    const rowBase = y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      // โปร่งใส = ขาว; ไม่งั้นคิด luminance แล้ว threshold < 128 = ดำ (bit 1, MSB = pixel ซ้ายสุด)
      const lum = (a < 128) ? 255 : (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      if (lum < 128) {
        raster[rowBase + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  const xL = bytesPerRow & 0xFF, xH = (bytesPerRow >> 8) & 0xFF;   // bytes/row (little-endian)
  const nChunks = Math.max(1, Math.ceil(height / RASTER_MAX_ROWS));
  const out = new Uint8Array(raster.length + nChunks * 8);        // + header 8 byte ต่อ chunk
  let p = 0;
  for (let y0 = 0; y0 < height; y0 += RASTER_MAX_ROWS) {
    const rows = Math.min(RASTER_MAX_ROWS, height - y0);           // ≤255 → yL 1 byte พอ
    out[p++] = 0x1D; out[p++] = 0x76; out[p++] = 0x30; out[p++] = 0x00;  // GS v 0 m(0)
    out[p++] = xL; out[p++] = xH; out[p++] = rows & 0xFF; out[p++] = 0;  // xL xH yL yH(=0)
    const start = y0 * bytesPerRow, len = rows * bytesPerRow;
    out.set(raster.subarray(start, start + len), p);
    p += len;
  }
  return out;
}

// generic ESC/POS wrapper (เครื่องมีคัตเตอร์): ESC @ + body + feed + partial cut
// (คงชื่อเดิมไว้ให้ guard/โค้ดที่อ้างถึงใช้ได้ — Phase 585 signature)
export function canvasToEscposRaster(canvas) {
  return concatBytes(ESC_INIT, canvasToRasterBody(canvas), ESC_FEED, ESC_CUT);
}

// ═══════════════════════════════════════════════════════════
//  Phase 586: หุ้มคำสั่งตามชนิดเครื่อง (PeriPage vs generic ESC/POS)
//  PeriPage ไม่รู้จัก ESC @ / GS V cut → ต้อง reset + concentration + ESC J feed เฉพาะตัว
// ═══════════════════════════════════════════════════════════
export function buildPrintBytes(canvas) {
  const body = canvasToRasterBody(canvas);
  // build 592: A9 Max ก่อน (ชื่อมี MAX) — framing ตัวจริงจากแอปทางการ + GS v 0 (long-shot ผ่าน BLE ff02)
  //   เช็คก่อน isPeriPage() เพราะชื่อ A9 Max ก็ match /peripage/ ด้วย
  if (isPeriPageMax()) {
    return concatBytes(A9MAX_PREAMBLE, body, A9MAX_FEED, A9MAX_FINALIZE);
  }
  if (isPeriPage()) {
    return concatBytes(PERIPAGE_RESET, PERIPAGE_CONCENTRATION, body, PERIPAGE_FEED);
  }
  return concatBytes(ESC_INIT, body, ESC_FEED, ESC_CUT);
}

// ═══════════════════════════════════════════════════════════
//  Receipt normalizer — รับได้ทั้ง POS lastReceipt และ receipts.js record
// ═══════════════════════════════════════════════════════════
function normalizeReceipt(rc) {
  rc = rc || {};
  const items = (rc.items || []).map((it) => {
    const qty = Number(it.qty || 1);
    const price = Number(it.unit_price ?? it.price ?? 0);
    const lineTotal = Number(it.line_total ?? (qty * price));
    return { name: it.product_name || it.item_name || it.name || "", qty, price, lineTotal };
  });
  const total = Number(rc.total_amount ?? rc.grand_total ?? 0);
  const grandTotal = Number(rc.grand_total ?? rc.total_amount ?? 0);
  return {
    receiptNo: rc.order_no || rc.receipt_no || "-",
    customerName: rc.customer_name || "ลูกค้าทั่วไป",
    paymentMethod: rc.payment_method || "",
    createdAt: rc.created_at || null,
    total,
    grandTotal,
    discount: Number(rc.discount_amount ?? rc.discount ?? 0),
    creditUsed: Number(rc.credit_used_amount ?? 0),
    paid: Number(rc.paid_amount ?? 0),
    change: Number(rc.change_amount ?? 0),
    items
  };
}

function payLabel(m) {
  const map = {
    cash: "เงินสด", transfer: "โอนเงิน", promptpay: "PromptPay",
    credit: "บัตรเครดิต", cheque: "เช็ค",
    cod_cash: "เงินสดปลายทาง", cod_transfer: "โอนหน้างาน"
  };
  return map[m] || m || "-";
}

function clip(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ═══════════════════════════════════════════════════════════
//  Render receipt → <canvas> (ภาษาไทยเนทีฟจาก browser font)
//  วาดสองรอบ: รอบแรกคำนวณความสูง, รอบสองวาดจริง
// ═══════════════════════════════════════════════════════════
export function renderReceiptCanvas(receipt, store) {
  const rc = normalizeReceipt(receipt);
  const st = store || {};
  const W = getPaperPx();   // ★ Phase 591: ตามขนาดกระดาษที่ตั้ง (auto=ตามรุ่น)

  // ── build ops (รอบวัด) ──
  const ops = [];
  const center = (text, o = {}) => { if (text) ops.push({ kind: "center", text: String(text), size: o.size || 20, bold: !!o.bold, lh: o.lh || 26 }); };
  const left = (text, o = {}) => ops.push({ kind: "left", text: String(text), size: o.size || 16, bold: !!o.bold, lh: o.lh || 22 });
  const row = (l, r, o = {}) => ops.push({ kind: "row", left: String(l), right: String(r), size: o.size || 20, bold: !!o.bold, lh: o.lh || 28 });
  const rule = () => ops.push({ kind: "rule", lh: 16 });
  const space = (h) => ops.push({ kind: "space", lh: h });

  center(st.name || "บุญสุข อิเล็กทรอนิกส์", { size: 28, bold: true, lh: 38 });
  center(st.address || "", { size: 16, lh: 22 });
  if (st.phone) center("โทร: " + st.phone, { size: 16, lh: 22 });
  if (st.taxId) center("เลขผู้เสียภาษี: " + st.taxId, { size: 16, lh: 22 });
  rule();
  row("เลขที่", rc.receiptNo);
  row("วันที่", formatDateTime(rc.createdAt));
  row("ลูกค้า", clip(rc.customerName, 22));
  if (rc.paymentMethod) row("ชำระโดย", payLabel(rc.paymentMethod));
  rule();
  row("รายการ", "รวม", { bold: true });
  rule();
  for (const it of rc.items) {
    row(clip(it.name, 24), money(it.lineTotal));
    left("   " + formatNumber(it.qty) + " x " + money(it.price));
  }
  rule();
  if (rc.discount > 0) row("ส่วนลด", "-" + money(rc.discount));
  row("รวมทั้งสิ้น", money(rc.grandTotal), { size: 24, bold: true, lh: 34 });
  if (rc.creditUsed > 0) row("ใช้เครดิต", "-" + money(rc.creditUsed));
  if (rc.paid > 0) row("รับเงิน", money(rc.paid));
  if (rc.change > 0) row("เงินทอน", money(rc.change));
  rule();
  center("ขอบคุณที่ใช้บริการ", { size: 20, lh: 28 });
  space(24);

  let H = PAD;
  for (const op of ops) H += op.lh;
  H += PAD;

  // ── draw (รอบวาด) ──
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(H, 40);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const setFont = (size, bold) => { ctx.font = (bold ? "bold " : "") + size + "px 'Sarabun','Noto Sans Thai',sans-serif"; };
  let y = PAD;
  for (const op of ops) {
    if (op.kind === "rule") {
      ctx.fillRect(PAD, y + Math.floor(op.lh / 2), W - PAD * 2, 1);
    } else if (op.kind === "space") {
      /* whitespace only */
    } else if (op.kind === "center") {
      setFont(op.size, op.bold); ctx.textAlign = "center"; ctx.fillText(op.text, W / 2, y);
    } else if (op.kind === "left") {
      setFont(op.size, op.bold); ctx.textAlign = "left"; ctx.fillText(op.text, PAD, y);
    } else if (op.kind === "row") {
      setFont(op.size, op.bold);
      ctx.textAlign = "left"; ctx.fillText(op.left, PAD, y);
      ctx.textAlign = "right"; ctx.fillText(op.right, W - PAD, y);
    }
    y += op.lh;
  }
  ctx.textAlign = "left";
  return canvas;
}

function renderTestCanvas(store) {
  const W = getPaperPx();   // ★ Phase 591: ตามขนาดกระดาษที่ตั้ง
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 170;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = "#000"; ctx.textBaseline = "top"; ctx.textAlign = "center";
  ctx.font = "bold 28px 'Sarabun','Noto Sans Thai',sans-serif";
  ctx.fillText(clip((store && store.name) || "บุญสุข อิเล็กทรอนิกส์", 22), W / 2, PAD);
  ctx.font = "22px 'Sarabun','Noto Sans Thai',sans-serif";
  ctx.fillText("ทดสอบพิมพ์ใบเสร็จ", W / 2, PAD + 44);
  ctx.font = "18px 'Sarabun','Noto Sans Thai',sans-serif";
  ctx.fillText(formatDateTime(new Date()), W / 2, PAD + 84);
  ctx.fillText("เชื่อมต่อสำเร็จ ✓", W / 2, PAD + 116);
  ctx.textAlign = "left";
  return canvas;
}

// ═══════════════════════════════════════════════════════════
//  Public print entry points (connect → canvas → raster → BLE)
// ═══════════════════════════════════════════════════════════
export async function printReceipt(receipt, store) {
  const char = await connectSlipPrinter();
  // รอ font ไทยพร้อมก่อนวาด (กันวาดด้วย fallback font แล้วสระลอย)
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* ignore */ }
  }
  const canvas = renderReceiptCanvas(receipt, store);
  const bytes = buildPrintBytes(canvas);   // Phase 586: หุ้มคำสั่งตามชนิดเครื่อง (PeriPage vs generic)
  await sendChunked(char, bytes);
}

export async function testPrint(store) {
  const char = await connectSlipPrinter();
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* ignore */ }
  }
  const canvas = renderTestCanvas(store);
  const bytes = buildPrintBytes(canvas);   // Phase 586: หุ้มคำสั่งตามชนิดเครื่อง (PeriPage vs generic)
  await sendChunked(char, bytes);
}
