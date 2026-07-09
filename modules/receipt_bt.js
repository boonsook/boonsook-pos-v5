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
const SLIP_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",   // Generic printer service (ESC/POS slip)
  "0000ff00-0000-1000-8000-00805f9b34fb",   // Xprinter / common thermal
  "0000ffe0-0000-1000-8000-00805f9b34fb",   // HM-10 / common BLE serial
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",   // Microchip / ISSC transparent UART
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2"    // Some Goojprt/PT-210 style printers
];

const CANVAS_WIDTH = 384;   // 58mm @ 203dpi (พิมพ์บน 80mm ได้ — ใช้ครึ่งซ้าย)
const PAD = 10;
const CHUNK = 200;          // BLE MTU-safe (writeWithoutResponse ~200 ปลอดภัยกับเครื่องส่วนใหญ่)
const CHUNK_DELAY_MS = 20;  // กัน buffer overrun

let _device = null;
let _char = null;

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
  _device.addEventListener("gattserverdisconnected", () => { _char = null; });

  const server = await _device.gatt.connect();
  let service = null;
  for (const uuid of SLIP_PRINTER_SERVICES) {
    try { service = await server.getPrimaryService(uuid); if (service) break; } catch (_) { /* ลองตัวถัดไป */ }
  }
  if (!service) {
    throw new Error("ไม่พบ printer service — รุ่นนี้อาจเป็น Bluetooth Classic (Web Bluetooth ใช้ได้แค่ BLE)");
  }
  const chars = await service.getCharacteristics();
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (slip printer connect flow)
  _char = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
  if (!_char) throw new Error("ไม่พบ writable characteristic ในเครื่องพิมพ์");
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
//  Canvas → ESC/POS raster (GS v 0)
//  รับ canvas (หรือ mock ที่มี width/height/getContext('2d').getImageData)
// ═══════════════════════════════════════════════════════════
export function canvasToEscposRaster(canvas) {
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
  const yL = height & 0xFF, yH = (height >> 8) & 0xFF;             // dot rows (little-endian)

  const ESC_INIT = [0x1B, 0x40];                                   // ESC @  (init)
  const RASTER_HDR = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];     // GS v 0 m xL xH yL yH  (m=0 normal)
  const FEED = [0x1B, 0x64, 0x03];                                 // ESC d 3  (feed 3 lines)
  const CUT = [0x1D, 0x56, 0x01];                                  // GS V 1   (partial cut)

  const out = new Uint8Array(ESC_INIT.length + RASTER_HDR.length + raster.length + FEED.length + CUT.length);
  let p = 0;
  out.set(ESC_INIT, p); p += ESC_INIT.length;
  out.set(RASTER_HDR, p); p += RASTER_HDR.length;
  out.set(raster, p); p += raster.length;
  out.set(FEED, p); p += FEED.length;
  out.set(CUT, p); p += CUT.length;
  return out;
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
  const bytes = canvasToEscposRaster(canvas);
  await sendChunked(char, bytes);
}

export async function testPrint(store) {
  const char = await connectSlipPrinter();
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* ignore */ }
  }
  const canvas = renderTestCanvas(store);
  const bytes = canvasToEscposRaster(canvas);
  await sendChunked(char, bytes);
}
