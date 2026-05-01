// ═══════════════════════════════════════════════════════════
// Boonsook POS V5 — Payment Gateway Module
// PromptPay QR, Bank Transfer, Credit Card
// ═══════════════════════════════════════════════════════════

import { escHtml } from "./utils.js";

/**
 * Generate PromptPay QR Code payload (EMVCo standard)
 * @param {string} target - Phone number (0812345678) or National ID (13 digits) or Tax ID
 * @param {number} amount - Amount in THB (0 = any amount)
 * @returns {string} EMVCo QR payload string
 */
export function generatePromptPayPayload(target, amount = 0) {
  // Clean target
  target = target.replace(/[^0-9]/g, "");

  // Determine target type
  let aid, targetFormatted;
  if (target.length === 10 && target.startsWith("0")) {
    // Phone number: convert to +66 format
    aid = "A000000677010111"; // PromptPay Phone
    targetFormatted = "0066" + target.substring(1);
  } else if (target.length === 13) {
    // National ID or Tax ID
    aid = "A000000677010112"; // PromptPay NID
    targetFormatted = target;
  } else {
    throw new Error("หมายเลข PromptPay ไม่ถูกต้อง (ใช้เบอร์โทร 10 หลัก หรือ เลข 13 หลัก)");
  }

  // Build EMVCo payload
  const data = [];

  // Payload Format Indicator
  data.push(tlv("00", "01"));

  // Point of Initiation (12 = dynamic QR with amount)
  data.push(tlv("01", amount > 0 ? "12" : "11"));

  // Merchant Account Information (ID 29 for PromptPay)
  const merchantInfo =
    tlv("00", aid) +
    tlv("01", targetFormatted);
  data.push(tlv("29", merchantInfo));

  // Transaction Currency (764 = THB)
  data.push(tlv("53", "764"));

  // Transaction Amount
  if (amount > 0) {
    data.push(tlv("54", amount.toFixed(2)));
  }

  // Country Code
  data.push(tlv("58", "TH"));

  // CRC placeholder
  const payload = data.join("") + "6304";

  // Calculate CRC16-CCITT
  const crc = crc16(payload);
  return payload + crc;
}

/**
 * Generate PromptPay QR as Data URL (SVG)
 * Uses a lightweight QR generator
 */
export async function generatePromptPayQR(target, amount = 0, size = 300) {
  const payload = generatePromptPayPayload(target, amount);

  // Use QR Code generation
  const matrix = generateQRMatrix(payload);
  const svg = matrixToSVG(matrix, size);

  return {
    payload,
    svg,
    dataUrl: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))),
  };
}

/**
 * Show PromptPay payment modal
 */
export function showPromptPayModal(target, amount, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000";

  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border-radius:16px;padding:24px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)";

  const amtText = Number(amount).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  card.innerHTML = `
    <h3 style="margin:0 0 8px;color:#0369a1;font-size:18px">PromptPay</h3>
    <p style="margin:0 0 16px;color:#666;font-size:14px">สแกน QR เพื่อชำระเงิน</p>
    <div id="ppQrContainer" style="display:flex;justify-content:center;margin:0 0 16px">
      <div style="width:200px;height:200px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999">กำลังสร้าง QR...</div>
    </div>
    <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#0369a1">${amtText} บาท</p>
    <p style="margin:0 0 16px;font-size:13px;color:#999">PromptPay: ${maskTarget(target)}</p>
    <div style="display:flex;gap:8px;justify-content:center">
      <button id="ppCancel" style="padding:10px 24px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px">ยกเลิก</button>
      <button id="ppConfirm" style="padding:10px 24px;border:none;border-radius:8px;background:#0369a1;color:#fff;cursor:pointer;font-size:14px;font-weight:600">ยืนยันรับชำระแล้ว</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Generate QR
  generatePromptPayQR(target, amount, 200).then(({ svg }) => {
    const container = card.querySelector("#ppQrContainer");
    container.innerHTML = svg;
  }).catch(err => {
    const container = card.querySelector("#ppQrContainer");
    container.innerHTML = `<div style="color:red;padding:20px">สร้าง QR ไม่ได้: ${escHtml(err.message || err)}</div>`;
  });

  // Events
  card.querySelector("#ppCancel").onclick = () => {
    overlay.remove();
  };
  card.querySelector("#ppConfirm").onclick = () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}

/**
 * Payment method registry
 */
export const PAYMENT_METHODS = [
  { id: "cash", name: "เงินสด", icon: "💵", enabled: true },
  { id: "promptpay", name: "PromptPay", icon: "📱", enabled: true },
  { id: "transfer", name: "โอนเงิน", icon: "🏦", enabled: true },
  { id: "credit", name: "บัตรเครดิต", icon: "💳", enabled: true },
  { id: "installment", name: "ผ่อนชำระ", icon: "📋", enabled: false },
];

// ───── QR Code Generator (Lightweight) ─────
// Simplified QR generator for alphanumeric data

function generateQRMatrix(data) {
  // Use a canvas-based approach for QR generation
  // For production, recommend importing a library like 'qrcode-generator'
  const size = Math.max(21, Math.ceil(data.length / 2) + 17);
  const modules = Array.from({ length: size }, () => Array(size).fill(0));

  // Encode data into matrix using simple encoding
  // This is a placeholder - in production, use qrcode-generator library
  let pos = 0;
  for (let i = 0; i < data.length && pos < size * size; i++) {
    const code = data.charCodeAt(i);
    for (let bit = 7; bit >= 0; bit--) {
      const row = Math.floor(pos / size);
      const col = pos % size;
      if (row < size && col < size) {
        modules[row][col] = (code >> bit) & 1;
      }
      pos++;
    }
  }
  return modules;
}

function matrixToSVG(matrix, size) {
  const cellSize = size / matrix.length;
  let paths = "";
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        paths += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${paths}</g></svg>`;
}

// ───── Helpers ─────

function tlv(tag, value) {
  const len = value.length.toString().padStart(2, "0");
  return tag + len + value;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function maskTarget(target) {
  target = target.replace(/[^0-9]/g, "");
  if (target.length === 10) {
    return target.substring(0, 3) + "-XXX-" + target.substring(7);
  }
  return target.substring(0, 4) + "XXXXX" + target.substring(9);
}
