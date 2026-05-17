// ═══════════════════════════════════════════════════════════
//  BLUETOOTH LABEL PRINTER (Phase 81)
//  Web Bluetooth API → Xprinter XP-420B (BLE) → TSPL command
//
//  ขั้นตอนใช้:
//    1. user คลิก "📡 พิมพ์ Bluetooth" → ถ้ายังไม่ pair → browser ขอ pair
//    2. รับ writable characteristic
//    3. ส่ง TSPL command (set size + label text + barcode + print)
//
//  หมายเหตุ:
//    - ต้องใช้ HTTPS (boonsukair.com OK)
//    - Chrome / Edge / Opera บน Desktop + Android เท่านั้น
//    - iOS / Safari / Firefox ไม่รองรับ Web Bluetooth
//    - XP-420B ต้องเปิด Bluetooth + อยู่ใกล้ (~10m)
// ═══════════════════════════════════════════════════════════

// Common BLE printer service UUIDs (Xprinter / generic thermal printers)
const BT_PRINTER_SERVICES = [
  "0000ff00-0000-1000-8000-00805f9b34fb",   // Xprinter / common thermal
  "0000ffe0-0000-1000-8000-00805f9b34fb",   // HM-10 / common BLE serial
  "000018f0-0000-1000-8000-00805f9b34fb",   // Generic printer service
  "49535343-fe7d-4ae5-8fa9-9fafd205e455"    // Microchip / Zikodroid
];

let _device = null;
let _server = null;
let _writeChar = null;

// ═══════════════════════════════════════════════════════════
//  Connect (ครั้งแรก = ขอ pair, ครั้งต่อไป = reconnect)
// ═══════════════════════════════════════════════════════════
export async function connectPrinter() {
  if (!navigator.bluetooth) {
    throw new Error("Browser นี้ไม่รองรับ Web Bluetooth — ใช้ Chrome หรือ Edge");
  }

  // ถ้าเคย connect แล้ว + GATT ยัง active → reuse
  if (_device && _device.gatt?.connected && _writeChar) {
    return _writeChar;
  }

  // ขอ pair — acceptAllDevices: true เพื่อให้เห็นทุกอุปกรณ์ BLE ในรัศมี
  // (filter โดย namePrefix อาจ miss ถ้าเครื่องชื่อต่างจากที่คาด)
  _device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BT_PRINTER_SERVICES
  });

  _device.addEventListener("gattserverdisconnected", () => {
    _server = null;
    _writeChar = null;
  });

  _server = await _device.gatt.connect();

  // ลองหา service จาก list ที่รู้จัก
  let service = null;
  for (const uuid of BT_PRINTER_SERVICES) {
    try {
      service = await _server.getPrimaryService(uuid);
      if (service) break;
    } catch (e) { /* ลองตัวต่อไป */ }
  }
  if (!service) {
    throw new Error("ไม่พบ printer service — รุ่นนี้อาจเป็น Bluetooth Classic (Web Bluetooth ใช้ได้แค่ BLE)");
  }

  // หา writable characteristic
  const chars = await service.getCharacteristics();
  _writeChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
  if (!_writeChar) {
    throw new Error("ไม่พบ writable characteristic");
  }

  return _writeChar;
}

export function isConnected() {
  return !!(_device?.gatt?.connected && _writeChar);
}

export function getDeviceName() {
  return _device?.name || "(ยังไม่ได้ pair)";
}

export async function disconnect() {
  try {
    if (_device?.gatt?.connected) _device.gatt.disconnect();
  } catch (e) { /* ignore */ }
  _device = null;
  _server = null;
  _writeChar = null;
}

// ═══════════════════════════════════════════════════════════
//  TSPL command builder (50×30mm sticker)
// ═══════════════════════════════════════════════════════════
function sanitizeTsplText(value, maxLength) {
  return String(value || "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/["\\]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeBarcode(value) {
  return String(value || "")
    .replace(/[\x00-\x20\x7F"\\]/g, "")
    .replace(/[^0-9A-Za-z._-]/g, "")
    .slice(0, 48);
}

function sanitizeCopies(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) ? Math.min(Math.max(count, 1), 99) : 1;
}

function buildTSPL(label) {
  const { name = "", barcode = "", price = "", shop = "บุญสุขแอร์", copies = 1 } = label;
  // Truncate name ให้ไม่เกิน 1 บรรทัด — TSPL ไม่ wrap auto
  const safeName = sanitizeTsplText(name, 28);
  const safeShop = sanitizeTsplText(shop, 20);
  const safeBarcode = sanitizeBarcode(barcode);
  const safeCopies = sanitizeCopies(copies);
  const priceValue = Number(price);
  const priceStr = Number.isFinite(priceValue) && priceValue > 0
    ? `Bt${priceValue.toLocaleString("en-US")}`
    : "";

  // TSPL coordinate system: dot @ 203 DPI → 8 dots/mm → 50mm = 400 dots, 30mm = 240 dots
  // Y top-down. ข้อความ font 1-5 (built-in)
  const lines = [
    "SIZE 50 mm,30 mm",
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
    `TEXT 200,10,"1",0,1,1,2,"${safeShop}"`,                // ชื่อร้าน บนสุด center
    `TEXT 200,40,"2",0,1,1,2,"${safeName}"`,                // ชื่อสินค้า
  ];
  if (safeBarcode) {
    // BARCODE x,y,"type",height,human-readable,rotation,narrow,wide,"data"
    lines.push(`BARCODE 50,90,"128",70,1,0,2,2,"${safeBarcode}"`);
  }
  if (priceStr) {
    lines.push(`TEXT 200,200,"3",0,1,1,2,"${priceStr}"`);
  }
  lines.push(`PRINT ${safeCopies},1`);
  lines.push("");  // trailing newline

  return lines.join("\r\n");
}

// ═══════════════════════════════════════════════════════════
//  Send command (chunk write — BLE max 512 bytes/write ปกติ)
// ═══════════════════════════════════════════════════════════
async function sendChunked(charac, data) {
  const enc = new TextEncoder();
  const buf = enc.encode(data);
  const CHUNK = 100; // ปลอดภัยสำหรับ BLE MTU
  for (let i = 0; i < buf.length; i += CHUNK) {
    const slice = buf.slice(i, Math.min(i + CHUNK, buf.length));
    if (charac.properties.writeWithoutResponse) {
      await charac.writeValueWithoutResponse(slice);
    } else {
      await charac.writeValue(slice);
    }
    // delay เล็กๆ เพื่อ buffer ไม่ overrun
    await new Promise(r => { setTimeout(r, 30); });
  }
}

// ═══════════════════════════════════════════════════════════
//  Public — print 1 หรือหลาย labels
//  labels: [{ name, barcode, price, shop?, copies? }, ...]
// ═══════════════════════════════════════════════════════════
export async function printLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) throw new Error("ไม่มี label ให้พิมพ์");
  const charac = await connectPrinter();
  for (const lb of labels) {
    const cmd = buildTSPL(lb);
    await sendChunked(charac, cmd);
    // delay ระหว่าง label เพื่อให้ printer print เสร็จก่อน
    await new Promise(r => { setTimeout(r, 200); });
  }
}

// ═══════════════════════════════════════════════════════════
//  Test print — ส่งข้อความทดสอบเพื่อ verify connection
// ═══════════════════════════════════════════════════════════
export async function testPrint() {
  return printLabels([{
    shop: "บุญสุขแอร์",
    name: "Test Print",
    barcode: "1234567890",
    price: 0,
    copies: 1
  }]);
}
