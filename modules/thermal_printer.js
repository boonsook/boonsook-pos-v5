// ═══════════════════════════════════════════════════════════
// Boonsook POS V5 — Thermal Printer Module
// พิมพ์ใบเสร็จผ่าน thermal printer (ESC/POS protocol)
// รองรับ USB, Bluetooth, Network printer
// ═══════════════════════════════════════════════════════════

const ESC = "\x1B";
const GS = "\x1D";
const LF = "\x0A";

// ESC/POS Commands
const CMD = {
  INIT: ESC + "@",
  ALIGN_LEFT: ESC + "a" + "\x00",
  ALIGN_CENTER: ESC + "a" + "\x01",
  ALIGN_RIGHT: ESC + "a" + "\x02",
  BOLD_ON: ESC + "E" + "\x01",
  BOLD_OFF: ESC + "E" + "\x00",
  DOUBLE_ON: GS + "!" + "\x11",
  DOUBLE_OFF: GS + "!" + "\x00",
  FONT_SMALL: ESC + "M" + "\x01",
  FONT_NORMAL: ESC + "M" + "\x00",
  CUT: GS + "V" + "\x00",
  PARTIAL_CUT: GS + "V" + "\x01",
  FEED_LINES: (n) => ESC + "d" + String.fromCharCode(n),
  LINE: "─".repeat(32) + LF,
  DOUBLE_LINE: "═".repeat(32) + LF,
};

// ───── Printer Connection Manager ─────
let _printerDevice = null;
let _printerType = null; // 'usb' | 'bluetooth' | 'network'

/**
 * Connect to USB thermal printer (Web USB API)
 */
export async function connectUSBPrinter() {
  try {
    if (!navigator.usb) throw new Error("Web USB ไม่รองรับในบราวเซอร์นี้");
    const device = await navigator.usb.requestDevice({
      filters: [
        { vendorId: 0x0416 }, // WinBond (common thermal)
        { vendorId: 0x0483 }, // STMicroelectronics
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x0519 }, // Star Micronics
      ],
    });
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);
    _printerDevice = device;
    _printerType = "usb";
    return { success: true, name: device.productName || "USB Printer" };
  } catch (err) {
    console.error("USB Printer Error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Connect to Bluetooth thermal printer (Web Bluetooth API)
 */
export async function connectBluetoothPrinter() {
  try {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth ไม่รองรับ");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
      optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("000018f0-0000-1000-8000-00805f9b34fb");
    const characteristic = await service.getCharacteristic("00002af1-0000-1000-8000-00805f9b34fb");
    _printerDevice = characteristic;
    _printerType = "bluetooth";
    return { success: true, name: device.name || "Bluetooth Printer" };
  } catch (err) {
    console.error("Bluetooth Printer Error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Send raw data to printer
 */
async function sendToPrinter(data) {
  if (!_printerDevice) throw new Error("ไม่ได้เชื่อมต่อเครื่องพิมพ์");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(data);

  if (_printerType === "usb") {
    await _printerDevice.transferOut(1, bytes);
  } else if (_printerType === "bluetooth") {
    // BLE has MTU limit, send in chunks
    const CHUNK = 100;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.slice(i, i + CHUNK);
      await _printerDevice.writeValue(chunk);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/**
 * Disconnect printer
 */
export async function disconnectPrinter() {
  try {
    if (_printerType === "usb" && _printerDevice) {
      await _printerDevice.close();
    } else if (_printerType === "bluetooth" && _printerDevice) {
      // BLE disconnect
    }
    _printerDevice = null;
    _printerType = null;
    return true;
  } catch (err) {
    console.error("Disconnect Error:", err);
    return false;
  }
}

/**
 * Check if printer is connected
 */
export function isPrinterConnected() {
  return _printerDevice !== null;
}

// ───── Receipt Builder ─────

/**
 * Build receipt text from sale data
 * @param {Object} sale - Sale data { items, total, discount, payment, change, customer, date, receiptNo }
 * @param {Object} store - Store info { name, address, phone, taxId }
 * @returns {string} ESC/POS formatted receipt
 */
export function buildReceipt(sale, store) {
  let r = CMD.INIT;

  // ── Header ──
  r += CMD.ALIGN_CENTER;
  r += CMD.DOUBLE_ON;
  r += (store.name || "บุญสุข อิเล็กทรอนิกส์") + LF;
  r += CMD.DOUBLE_OFF;
  r += CMD.FONT_SMALL;
  if (store.address) r += store.address + LF;
  if (store.phone) r += "โทร: " + store.phone + LF;
  if (store.taxId) r += "เลขผู้เสียภาษี: " + store.taxId + LF;
  r += CMD.FONT_NORMAL;
  r += CMD.DOUBLE_LINE;

  // ── Receipt Info ──
  r += CMD.ALIGN_LEFT;
  r += "เลขที่: " + (sale.receiptNo || "-") + LF;
  r += "วันที่: " + formatThaiDate(sale.date || new Date()) + LF;
  if (sale.customer) r += "ลูกค้า: " + sale.customer + LF;
  r += CMD.LINE;

  // ── Items ──
  r += CMD.BOLD_ON + padRight("รายการ", 18) + padLeft("จำนวน", 6) + padLeft("รวม", 8) + LF;
  r += CMD.BOLD_OFF;
  r += CMD.LINE;

  (sale.items || []).forEach((item) => {
    const name = truncate(item.name, 18);
    const qty = String(item.qty || 1);
    const amt = formatMoney(item.qty * item.price);
    r += padRight(name, 18) + padLeft(qty, 6) + padLeft(amt, 8) + LF;
    if (item.price) {
      r += CMD.FONT_SMALL;
      r += "  @ " + formatMoney(item.price) + " บาท" + LF;
      r += CMD.FONT_NORMAL;
    }
  });

  r += CMD.LINE;

  // ── Totals ──
  r += CMD.ALIGN_RIGHT;
  if (sale.discount && sale.discount > 0) {
    r += "ส่วนลด: -" + formatMoney(sale.discount) + LF;
  }
  r += CMD.BOLD_ON + CMD.DOUBLE_ON;
  r += "รวมทั้งสิ้น: " + formatMoney(sale.total) + " บาท" + LF;
  r += CMD.DOUBLE_OFF + CMD.BOLD_OFF;

  // ── Payment ──
  r += CMD.ALIGN_LEFT;
  r += CMD.LINE;
  const payMethod = sale.paymentMethod === "cash" ? "เงินสด" :
    sale.paymentMethod === "transfer" ? "โอนเงิน" :
    sale.paymentMethod === "promptpay" ? "PromptPay" :
    sale.paymentMethod === "credit" ? "บัตรเครดิต" : sale.paymentMethod || "เงินสด";
  r += "ชำระโดย: " + payMethod + LF;
  if (sale.received) r += "รับเงิน: " + formatMoney(sale.received) + LF;
  if (sale.change && sale.change > 0) r += "เงินทอน: " + formatMoney(sale.change) + LF;

  // ── Footer ──
  r += CMD.LINE;
  r += CMD.ALIGN_CENTER;
  r += CMD.FONT_SMALL;
  r += "ขอบคุณที่ใช้บริการ" + LF;
  r += "Thank you!" + LF;
  r += CMD.FONT_NORMAL;

  // Feed and cut
  r += CMD.FEED_LINES(4);
  r += CMD.PARTIAL_CUT;

  return r;
}

/**
 * Print receipt
 */
export async function printReceipt(sale, store) {
  if (!_printerDevice) {
    // Fallback: open browser print dialog
    return printReceiptBrowser(sale, store);
  }
  try {
    const data = buildReceipt(sale, store);
    await sendToPrinter(data);
    return { success: true };
  } catch (err) {
    console.error("Print Error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Fallback: Print via browser window
 */
function printReceiptBrowser(sale, store) {
  const w = window.open("", "_blank", "width=300,height=600");
  if (!w) return { success: false, error: "Popup blocked" };

  const items = (sale.items || [])
    .map(
      (i) =>
        `<tr><td>${escHtml(i.name)}</td><td class="r">${i.qty}</td><td class="r">${formatMoney(i.qty * i.price)}</td></tr>`
    )
    .join("");

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:'Courier New',monospace;width:280px;margin:0 auto;font-size:12px}
  .c{text-align:center}.r{text-align:right}
  h2{margin:4px 0;font-size:16px}
  hr{border:1px dashed #000}
  table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}
  .total{font-size:16px;font-weight:bold}
  @media print{body{margin:0}}
</style></head><body>
<div class="c"><h2>${escHtml(store.name || "บุญสุข อิเล็กทรอนิกส์")}</h2>
${store.address ? "<p>" + escHtml(store.address) + "</p>" : ""}
${store.phone ? "<p>โทร: " + escHtml(store.phone) + "</p>" : ""}</div>
<hr><p>เลขที่: ${escHtml(sale.receiptNo || "-")}<br>
วันที่: ${formatThaiDate(sale.date || new Date())}</p><hr>
<table><tr><th>รายการ</th><th class="r">จน.</th><th class="r">รวม</th></tr>${items}</table>
<hr><p class="r total">รวม: ${formatMoney(sale.total)} บาท</p>
<hr><div class="c"><p>ขอบคุณที่ใช้บริการ</p></div>
</body></html>`);
  w.document.close();
  w.print();
  return { success: true };
}

// ───── Helpers ─────
function formatMoney(n) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatThaiDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function padRight(s, len) { return (s + " ".repeat(len)).substring(0, len); }
function padLeft(s, len) { return (" ".repeat(len) + s).slice(-len); }
function truncate(s, len) { return s.length > len ? s.substring(0, len - 1) + "…" : s; }
// Phase 51: dedup + fix XSS gap (added apostrophe + null guard via shared utils)
import { escHtml } from "./utils.js";
