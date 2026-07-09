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

// ★ Phase 588: เลือก write characteristic ตาม "ช่อง" ที่รู้จัก เรียงความสำคัญ:
//   fec7 = PeriPage-classic (A9) · ff02 = thermal มาตรฐาน (Xprinter/generic ESC/POS — A9 Max เปิดช่องนี้)
//   ไม่เจอทั้งคู่ → fallback ตัว writable ตัวแรก
const PERIPAGE_WRITE_CHAR = "fec7";   // 0000fec7-... (A9 PeriPage write)
const PRINT_WRITE_CHARS = [PERIPAGE_WRITE_CHAR, "ff02"];   // เรียงความสำคัญ
// PeriPage-classic framing bytes (A9 fee7/fec7 — ไม่ใช่ ESC/POS มาตรฐาน)
const PERIPAGE_RESET = [0x10, 0xFF, 0xFE, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // reset (16 bytes)
const PERIPAGE_CONCENTRATION = [0x10, 0xFF, 0x10, 0x00, 0x02];                        // setConcentration=2 (เข้มสุด กันจาง)
const PERIPAGE_FEED = [0x1B, 0x4A, 0x60];                                             // ESC J 0x60 (feed ~96 dot; ไม่มี cut)
// generic ESC/POS framing (ff02/thermal มาตรฐาน) — feed-only, ★ ไม่มี GS V cut (เครื่องพกพาไม่มีคัตเตอร์ → cut เสี่ยง jam)
const ESC_INIT = [0x1B, 0x40];         // ESC @  (init)
const ESC_FEED = [0x1B, 0x64, 0x03];   // ESC d 3  (feed 3 lines)

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

const CANVAS_WIDTH = 384;   // 58mm @ 203dpi (พิมพ์บน 80mm ได้ — ใช้ครึ่งซ้าย)
const PAD = 10;
const CHUNK = 200;          // A9 direct (fee7/fec7) — BLE MTU-safe · writeWithoutResponse ~200 (คงเดิม 586 — A9 ใช้ได้แล้ว)
const CHUNK_DELAY_MS = 20;  // กัน buffer overrun
// ★ Phase 587: ISSC transparent UART (A9 Max) มัก drop writeWithoutResponse ถ้าเร็ว/ก้อนใหญ่ →
//   ก้อนเล็กลง + delay มากขึ้น + write-with-response เสมอ (เฉพาะ path นี้)
const CHUNK_UART = 128;
const CHUNK_DELAY_UART_MS = 40;
const ISSC_SERVICE_PREFIX = "49535343"; // ISSC/Microchip transparent UART service prefix
const RASTER_MAX_ROWS = 255; // Phase 586: แบ่ง GS v 0 ทีละ ≤255 แถว (yL 1 byte — PeriPage/บาง firmware ต้องการ)

let _device = null;
let _char = null;
let _serviceUuid = null;   // Phase 586: จำ service/char ที่เลือก โชว์ใน diagnostic/status + ใช้ตรวจ PeriPage
let _charUuid = null;
let _notifyChar = null;    // Phase 587: notify characteristic (ISSC UART bridge — A9 Max)
let _notifyStarted = false;

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
  _device.addEventListener("gattserverdisconnected", () => { _char = null; _serviceUuid = null; _charUuid = null; _notifyChar = null; _notifyStarted = false; });

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
  // ★ Phase 588: รวบรวม writable char ทุก service ก่อน แล้วเลือกตามลำดับช่องที่รู้จัก
  //   fec7 (A9 PeriPage) → ff02 (thermal มาตรฐาน = A9 Max) → fallback ตัว writable ตัวแรก
  //   (A9 → fec7 เหมือนเดิม; A9 Max มีทั้ง 49535343-8841 [ISSC] + ff02 [thermal] → เลือก ff02 = ช่องที่พิมพ์ได้)
  const allWritable = [];   // { char, svc }
  for (const svc of services) {
    let chs = [];
    try { chs = await svc.getCharacteristics(); } catch (_) { chs = []; }
    for (const c of chs) if (writable(c)) allWritable.push({ char: c, svc });
  }
  let pick = null;
  for (const prefix of PRINT_WRITE_CHARS) {
    pick = allWritable.find((w) => String(w.char.uuid).toLowerCase().includes(prefix));
    if (pick) break;
  }
  if (!pick) pick = allWritable[0];   // fallback ตัว writable ตัวแรก (เครื่องยี่ห้ออื่น)
  if (!pick) throw new Error("ไม่พบ writable characteristic ในเครื่องพิมพ์");
  const picked = pick.char, pickedSvc = pick.svc;
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (slip printer connect flow)
  _char = picked;
  _serviceUuid = pickedSvc?.uuid || null;
  _charUuid = picked.uuid;
  _notifyChar = null;
  _notifyStarted = false;

  // ★ Phase 587: เฉพาะ ISSC transparent UART (A9 Max) — เปิด pipe ก่อนเขียน
  //   (A9 fee7/fec7 = direct write ไม่เข้าเงื่อนไขนี้ → ไม่มีอะไรเปลี่ยน)
  if (isUartTransport() && pickedSvc) {
    try {
      const chs2 = await pickedSvc.getCharacteristics();
      _notifyChar = chs2.find((c) => c.properties.notify) || null;
    } catch (_) { _notifyChar = null; }
    if (_notifyChar && _notifyChar.startNotifications) {
      try { await _notifyChar.startNotifications(); _notifyStarted = true; } catch (_) { /* บาง stack ไม่ต้อง subscribe */ }
    }
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
  _notifyChar = null;
  _notifyStarted = false;
}

// Phase 587: transport เป็น ISSC transparent UART ไหม (A9 Max) — write ต้อง with-response + chunk เล็ก
export function isUartTransport() {
  return String(_serviceUuid || "").toLowerCase().includes(ISSC_SERVICE_PREFIX);
}

// Phase 586: service/characteristic ที่เลือกตอน connect (โชว์ในสถานะ/diagnostic)
export function getSlipTarget() {
  return { service: _serviceUuid, char: _charUuid };
}

// เครื่องเป็น PeriPage ไหม (ตามชื่อ/แบรนด์) — คงไว้เพื่อ backward-compat/diagnostic
export function isPeriPage() {
  return /peripage/i.test(_device?.name || "") || /fee7/i.test(_serviceUuid || "");
}

// ★ Phase 588: ตัดสิน framing ตาม "ช่องที่เชื่อมจริง" ไม่ใช่ชื่อแบรนด์ —
//   ช่อง PeriPage-proprietary (fee7/fec7 = A9) → PeriPage-classic framing;
//   ช่องอื่น (ff02/thermal มาตรฐาน = A9 Max ผ่าน ff00) → generic ESC/POS
export function usePeriPageProtocol() {
  return /fee7/i.test(_serviceUuid || "") || /fec7/i.test(_charUuid || "");
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
//  opts.uart = true (ISSC transparent UART / A9 Max) → chunk 128, delay 40, write-with-response เสมอ
//  default (A9 fee7/fec7 direct) → chunk 200, delay 20, prefer writeWithoutResponse — คงเดิม 586
export async function sendChunked(characteristic, bytes, opts = {}) {
  const uart = !!opts.uart;
  const size = uart ? CHUNK_UART : CHUNK;
  const delay = uart ? CHUNK_DELAY_UART_MS : CHUNK_DELAY_MS;
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < buf.length; i += size) {
    const slice = buf.slice(i, Math.min(i + size, buf.length));
    if (!uart && characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);   // A9 path — คงเดิม
    } else {
      await characteristic.writeValue(slice);                   // UART = with-response; A9 fallback ถ้าไม่มี WoR
    }
    await new Promise(r => { setTimeout(r, delay); });
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
  // generic ESC/POS: ESC @ + body + feed (★ Phase 588: ไม่มี GS V cut — เครื่องพกพาไม่มีคัตเตอร์)
  return concatBytes(ESC_INIT, canvasToRasterBody(canvas), ESC_FEED);
}

// ═══════════════════════════════════════════════════════════
//  Phase 586: หุ้มคำสั่งตามชนิดเครื่อง (PeriPage vs generic ESC/POS)
//  PeriPage ไม่รู้จัก ESC @ / GS V cut → ต้อง reset + concentration + ESC J feed เฉพาะตัว
// ═══════════════════════════════════════════════════════════
export function buildPrintBytes(canvas) {
  const body = canvasToRasterBody(canvas);
  if (usePeriPageProtocol()) {
    // A9 (fee7/fec7) — PeriPage-classic framing (คงเดิม 587)
    return concatBytes(PERIPAGE_RESET, PERIPAGE_CONCENTRATION, body, PERIPAGE_FEED);
  }
  // ff02/thermal มาตรฐาน (A9 Max) หรือ generic — ESC/POS มาตรฐาน, feed-only (ไม่มี cut)
  return concatBytes(ESC_INIT, body, ESC_FEED);
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
  const W = CANVAS_WIDTH;

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
  const W = CANVAS_WIDTH;
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
  await sendChunked(char, bytes, { uart: isUartTransport() });   // Phase 587: A9 Max = UART transport

}

export async function testPrint(store) {
  const char = await connectSlipPrinter();
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* ignore */ }
  }
  const canvas = renderTestCanvas(store);
  const bytes = buildPrintBytes(canvas);   // Phase 586: หุ้มคำสั่งตามชนิดเครื่อง (PeriPage vs generic)
  await sendChunked(char, bytes, { uart: isUartTransport() });   // Phase 587: A9 Max = UART transport

}
