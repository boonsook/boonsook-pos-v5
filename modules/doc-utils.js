// ═══════════════════════════════════════════════════════════
//  doc-utils.js — Boonsook POS V5
//  Shared print / PDF utility สำหรับทุก document module
//  ใช้ window.print() แทน html2canvas → คมชัดระดับ vector
// ═══════════════════════════════════════════════════════════

// CSS ที่ใช้ในหน้า print window (inline เพื่อ self-contained)
const PRINT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&display=swap");

@page { size: A4 portrait; margin: 0; }

*, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

body { margin: 0; padding: 0; background: #fff; font-family: "Sarabun","Noto Sans Thai",system-ui,sans-serif; font-size: 13px; color: #1e293b; line-height: 1.6; }

.doc-preview { background: #fff; padding: 0; }

.doc-page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 14mm 12mm; box-sizing: border-box; background: #fff; position: relative; display: flex; flex-direction: column; page-break-after: always; }

.doc-page:last-child { page-break-after: avoid; }

.doc-page-inner { flex: 1; display: flex; flex-direction: column; }

/* Accent bar */
.doc-accent { position: absolute; top: 0; left: 0; right: 0; height: 5px; }
.doc-accent.qt  { background: #f97316; }
.doc-accent.inv { background: #0284c7; }
.doc-accent.re  { background: #10b981; }

/* ═══ HEADER — FlowAccount Style ═══ */
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; margin-bottom: 12px; gap: 12px; }
.doc-header-left { display: flex; gap: 10px; align-items: flex-start; flex: 1; min-width: 0; }
.doc-logo { width: 54px; height: 54px; border-radius: 6px; object-fit: contain; flex-shrink: 0; }
.doc-company-name { font-size: 15px; font-weight: 900; margin-bottom: 2px; color: #1e293b; }
.doc-company-detail { font-size: 10.5px; color: #64748b; line-height: 1.55; }

.doc-header-right { text-align: right; flex-shrink: 0; }
.doc-title { font-size: 22px; font-weight: 900; line-height: 1.1; white-space: nowrap; }
.doc-title.qt  { color: #f97316; }
.doc-title.inv { color: #0284c7; }
.doc-title.re  { color: #10b981; }
.doc-title-sub { font-size: 10px; font-weight: 600; margin-top: 1px; color: #94a3b8; letter-spacing: 0.5px; }

/* Detail table (เลขที่/วันที่) */
.doc-detail-table { border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
.doc-detail-table td { padding: 3px 8px; border: 1px solid #d1d5db; }
.doc-detail-table td:first-child { font-weight: 700; color: #64748b; background: #f8fafc; white-space: nowrap; width: 70px; }

/* ═══ CUSTOMER — FlowAccount Box Style ═══ */
.doc-customer-section { margin: 8px 0 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fafbfc; }
.doc-customer-label { font-weight: 800; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.doc-customer-label.qt  { color: #f97316; }
.doc-customer-label.inv { color: #0284c7; }
.doc-customer-label.re  { color: #10b981; }
.doc-customer-name { font-weight: 800; font-size: 13.5px; color: #1e293b; }
.doc-customer-detail { font-size: 11.5px; color: #475569; line-height: 1.6; margin-top: 2px; }

/* ═══ ITEMS TABLE ═══ */
.doc-table { width: 100%; border-collapse: collapse; margin: 8px 0 6px; font-size: 12px; }
.doc-table th { padding: 6px 7px; font-weight: 700; border: 1px solid #cbd5e1; color: #fff; text-align: center; font-size: 11px; }
.doc-table th.qt  { background: #f97316; }
.doc-table th.inv { background: #0284c7; }
.doc-table th.re  { background: #10b981; }
.doc-table th:not(.qt):not(.inv):not(.re) { background: #64748b; }
.doc-table td { padding: 6px 7px; border: 1px solid #e2e8f0; vertical-align: top; }
.doc-table tbody tr:nth-child(even) td { background: #f8fafc; }

/* Baht text */
.doc-baht-text { font-size: 11.5px; font-weight: 600; color: #64748b; margin: 6px 0 2px; }

/* ═══ TOTALS ═══ */
.doc-totals { margin-left: auto; width: 260px; margin-top: 4px; }
.doc-total-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; color: #475569; }
.doc-total-row.grand { font-size: 13.5px; font-weight: 900; padding-top: 6px; margin-top: 3px; }
/* ★ ตัวเลขจำนวนเงิน ใช้สีดำ — เก็บสีของ border บนเป็น theme accent */
.doc-total-row.grand.qt  { color: #1a1a1a; border-top: 2px solid #f97316; }
.doc-total-row.grand.inv { color: #1a1a1a; border-top: 2px solid #0284c7; }
.doc-total-row.grand.re  { color: #1a1a1a; border-top: 2px solid #10b981; }

/* ═══ NOTE ═══ */
.doc-note-section { margin-top: 12px; font-size: 11.5px; line-height: 1.6; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fafbfc; }
.doc-note-title { font-weight: 800; margin-bottom: 2px; font-size: 11px; }
.doc-note-title.qt  { color: #f97316; }
.doc-note-title.inv { color: #0284c7; }
.doc-note-title.re  { color: #10b981; }

/* ═══ PAYMENT (ใบเสร็จ) ═══ */
.doc-payment-info { margin-top: 12px; font-size: 11px; color: #475569; border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 10px; }
.doc-payment-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 4px 12px; margin-top: 6px; font-size: 11px; border: 1px solid #d1d5db; padding: 6px 8px; border-radius: 4px; }
.doc-payment-grid span:nth-child(odd) { font-weight: 700; white-space: nowrap; }

/* ═══ SIGNATURES ═══ */
.doc-signatures { display: flex; justify-content: space-between; margin-top: auto; padding-top: 20px; font-size: 12px; }
.doc-sig-col { text-align: center; width: 44%; }
.doc-sig-behalf { font-weight: 600; margin-bottom: 24px; font-size: 11.5px; }
.doc-sig-line { width: 180px; border-bottom: 1px dotted #475569; margin: 0 auto 4px; height: 32px; }
.doc-sig-label-row { display: flex; justify-content: center; gap: 36px; font-size: 11px; color: #64748b; }
.doc-sig-date { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }

/* ═══ FOOTER ═══ */
.doc-footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; }
`;

// ─── printDoc ──────────────────────────────────────────────
// เปิดหน้าต่าง print พร้อม CSS ที่ถูกต้อง
// elementId: id ของ div ที่มี .doc-preview
// title: ชื่อเอกสาร (แสดงใน print dialog)
export function printDoc(elementId, title = "เอกสาร") {
  const el = document.getElementById(elementId);
  if (!el) return;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    (window.App?.showToast || alert)("กรุณาอนุญาต popup สำหรับหน้านี้ แล้วลองใหม่");
    return;
  }

  w.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${el.outerHTML}
</body>
</html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
    // ปิดหน้าต่างหลังพิมพ์ (optional — comment out ถ้าไม่ต้องการ)
    // setTimeout(() => w.close(), 1000);
  }, 600);
}

// ─── pdfDoc ────────────────────────────────────────────────
// บันทึก PDF โดยใช้ print dialog ของ browser (vector, คมชัด)
// ผู้ใช้เลือก "บันทึกเป็น PDF" ใน dialog
export function pdfDoc(elementId, filename = "document") {
  const el = document.getElementById(elementId);
  if (!el) return;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    (window.App?.showToast || alert)("กรุณาอนุญาต popup สำหรับหน้านี้ แล้วลองใหม่");
    return;
  }

  w.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8"/>
  <title>${filename}</title>
  <style>
    ${PRINT_CSS}
    /* Auto-trigger print สำหรับ PDF */
    @media screen {
      body { background: #e5e7eb; }
      .doc-page {
        box-shadow: 0 4px 24px rgba(0,0,0,.12);
        margin: 16px auto;
      }
      .print-hint {
        text-align: center;
        padding: 12px;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        color: #555;
        background: #fff;
        border-bottom: 1px solid #e2e8f0;
      }
      .print-btn {
        background: #0284c7;
        color: #fff;
        border: none;
        padding: 10px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        margin: 0 8px;
      }
      .print-btn:hover { background: #0369a1; }
    }
    @media print {
      .print-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-hint">
    <button class="print-btn" onclick="window.print()">🖨️ พิมพ์ / บันทึก PDF</button>
    <button class="print-btn" style="background:#64748b" onclick="window.close()">ปิด</button>
    <span style="margin-left:12px;font-size:12px">เลือก "บันทึกเป็น PDF" ใน print dialog เพื่อได้ไฟล์ PDF</span>
  </div>
${el.outerHTML}
</body>
</html>`);
  w.document.close();
  w.focus();
}

// ─── shareDoc ──────────────────────────────────────────────
// แชร์เอกสารผ่าน Web Share API (mobile) หรือ copy link
export async function shareDoc(elementId, docName = "เอกสาร") {
  // ลองใช้ window._appShareDoc ที่ main.js กำหนดไว้ก่อน
  if (typeof window._appShareDoc === "function") {
    window._appShareDoc(elementId, docName);
    return;
  }
  // fallback: print
  printDoc(elementId, docName);
}
