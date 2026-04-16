// ═══════════════════════════════════════════════════════════
//  doc-override.js — Boonsook POS V5
//  Override print/PDF buttons ทุก module ให้ใช้ doc-utils.js
//  ไม่ต้องแก้ไฟล์ module เดิมเลย
//  วิธีใช้: import "./modules/doc-override.js" ใน main.js
// ═══════════════════════════════════════════════════════════

import { printDoc, pdfDoc, shareDoc } from "./doc-utils.js";

// Button ID → element ID ที่มี .doc-preview
const DOC_MAP = {
  // ใบเสนอราคา
  qtPrintBtn:  "qtDocPreview",
  qtPdfBtn:    "qtDocPreview",
  qtShareBtn:  "qtDocPreview",

  // ใบส่งสินค้า / ใบแจ้งหนี้
  diPrintBtn:  "diDocPreview",
  diPdfBtn:    "diDocPreview",
  diShareBtn:  "diDocPreview",

  // ใบเสร็จรับเงิน
  rcPrintBtn:  "rcDocPreview",
  rcPdfBtn:    "rcDocPreview",
  rcShareBtn:  "rcDocPreview",
};

const DOC_TITLE = {
  qtDocPreview: "ใบเสนอราคา",
  diDocPreview: "ใบส่งสินค้า",
  rcDocPreview: "ใบเสร็จรับเงิน",
};

// ── Event capturing — จับก่อน module handlers ──────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[id]");
  if (!btn) return;

  const id      = btn.id;
  const preview = DOC_MAP[id];
  if (!preview) return;

  // หยุด handler เดิมของ module
  e.stopImmediatePropagation();

  const title = DOC_TITLE[preview] || "เอกสาร";

  if (id.endsWith("PrintBtn")) {
    printDoc(preview, title);
  } else if (id.endsWith("PdfBtn")) {
    pdfDoc(preview, getDocFilename(preview));
  } else if (id.endsWith("ShareBtn")) {
    shareDoc(preview, title);
  }
}, true); // true = capturing phase


// ── ดึงชื่อไฟล์จาก heading ในเอกสาร ──────────────────────
function getDocFilename(previewId) {
  const el = document.getElementById(previewId);
  if (!el) return "document";

  // หาเลขเอกสารจาก .doc-detail-table
  const rows = el.querySelectorAll(".doc-detail-table tr, .doc-detail-table td");
  for (const cell of rows) {
    const text = cell.textContent.trim();
    if (/^(QT|INV|RE)\d+/.test(text)) return text;
  }

  // fallback: ดูจาก title
  const titles = { qtDocPreview: "QT", diDocPreview: "INV", rcDocPreview: "RE" };
  return titles[previewId] || "document";
}
