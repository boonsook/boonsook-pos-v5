// ═══════════════════════════════════════════════════════════
//  doc-utils.js — Boonsook POS V5
//  Shared print / PDF utility สำหรับทุก document module
//  ใช้ window.print() แทน html2canvas → คมชัดระดับ vector
// ═══════════════════════════════════════════════════════════

// CSS ที่ใช้ในหน้า print window (inline เพื่อ self-contained)
// ★ export ไว้ให้ tests/e2e/fixtures/doc-print.html เอาไปวัดจำนวนแผ่นจริงได้ —
//   ก่อนหน้านี้ไม่มีทางทดสอบเส้นทางพิมพ์เลย จึงแก้ CSS ผิดไฟล์อยู่หลายรอบ
export const PRINT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&display=swap");

@page { size: A4 portrait; margin: 0; }

*, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

body { margin: 0; padding: 0; background: #fff; font-family: "Sarabun","Noto Sans Thai",system-ui,sans-serif; font-size: 13px; color: #1e293b; line-height: 1.6; }

.doc-preview { background: #fff; padding: 0; }

/* width เป็น 100%+max-width ไม่ใช่ 210mm ตายตัว — ถ้าผู้ใช้ตั้งระยะขอบในไดอะล็อกพิมพ์
   พื้นที่พิมพ์จะแคบกว่า 210mm แล้วกล่องจะล้นแนวนอนจนงอกแผ่นเพิ่ม */
.doc-page { width: 100%; max-width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 14mm 12mm; box-sizing: border-box; background: #fff; position: relative; display: flex; flex-direction: column; page-break-after: always; }

.doc-page:last-child { page-break-after: avoid; }

/* ★ กันบล็อกโดนผ่ากลางตอนขึ้นแผ่นใหม่ — PRINT_CSS เดิมไม่มีข้อนี้เลย
   แถวตาราง/บล็อกรับชำระ/ลายเซ็น จึงขาดครึ่งคาบเกี่ยวสองแผ่น */
.doc-table thead { display: table-header-group; }
.doc-table tr, .doc-totals, .doc-note-section, .doc-signatures, .doc-sig-col,
.doc-payment-info, .doc-payment-grid, .doc-payment-check, .doc-bank-line, .doc-baht-text { page-break-inside: avoid; break-inside: avoid; }

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

/* ═══ SIGNATURES (compact) ═══ */
.doc-signatures { display: flex; justify-content: space-between; margin-top: auto; padding-top: 14px; font-size: 11.5px; gap: 20px; }
.doc-sig-col { text-align: center; width: 44%; }
.doc-sig-behalf { font-weight: 600; margin-bottom: 18px; font-size: 11px; color: #475569; }
.doc-sig-line { width: 160px; border-bottom: 1px dotted #94a3b8; margin: 0 auto 3px; height: 24px; }
.doc-sig-label-row { display: flex; justify-content: center; gap: 30px; font-size: 10.5px; color: #64748b; }
.doc-sig-date { font-size: 10px; color: #94a3b8; margin-top: 2px; }

/* ═══ FOOTER ═══ */
.doc-footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; }
`;

function _docTemplateText(value) {
  return String(value || "").trim();
}

function _docTemplateEsc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function _docTemplateMultiline(value) {
  return _docTemplateEsc(value).replace(/\r?\n/g, "<br>");
}

export function getDocumentTemplate(storeInfo = {}) {
  return {
    header: _docTemplateText(storeInfo.docHeader),
    footer: _docTemplateText(storeInfo.docFooter),
    note: _docTemplateText(storeInfo.docNote),
  };
}

export function renderDocumentTemplateHeader(storeInfo = {}) {
  const { header } = getDocumentTemplate(storeInfo);
  if (!header) return "";
  return `<div class="doc-note-section doc-template-header"><div>${_docTemplateMultiline(header)}</div></div>`;
}

const DOCUMENT_NOTE_VISIBILITY_KEYS = Object.freeze({
  quotation: "docShowNoteQuotation",
  delivery: "docShowNoteDelivery",
  receipt: "docShowNoteReceipt",
});

export function isDocumentNoteVisible(storeInfo = {}, documentType = "") {
  const key = DOCUMENT_NOTE_VISIBILITY_KEYS[documentType];
  return !key || storeInfo?.[key] !== false;
}

export function renderDocumentTemplateNote(storeInfo = {}, opts = {}) {
  if (!isDocumentNoteVisible(storeInfo, opts.documentType)) return "";
  const { note } = getDocumentTemplate(storeInfo);
  const accent = _docTemplateEsc(opts.accent || "");
  const noteTitle = opts.noteTitle || "หมายเหตุ";
  const baseNote = _docTemplateText(opts.documentNote) || _docTemplateText(opts.fallbackNote);
  const parts = [baseNote, note].filter(Boolean);
  if (!parts.length) return "";
  return `<div class="doc-note-section"><div class="doc-note-title ${accent}">${_docTemplateEsc(noteTitle)}</div><div>${parts.map(_docTemplateMultiline).join("<br>")}</div></div>`;
}

export function renderDocumentTemplateFooter(storeInfo = {}) {
  const { footer } = getDocumentTemplate(storeInfo);
  return `<div class="doc-footer">${footer ? _docTemplateMultiline(footer) : ""}</div>`;
}

// ─── bahtText ──────────────────────────────────────────────
// แปลงจำนวนเงิน (number) เป็นคำไทย: 5500 → "ห้าพันห้าร้อยบาทถ้วน"
// รองรับ 0-999,999,999,999 + สตางค์ (ทศนิยม 2 ตำแหน่ง)
export function bahtText(amount) {
  const nums = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  function readUnder1M(n) {
    if (n <= 0) return '';
    const s = String(n);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = +s[i];
      const pos = s.length - 1 - i;
      if (d === 0) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
      else out += nums[d] + places[pos];
    }
    return out;
  }

  function readNumber(n) {
    if (n === 0) return 'ศูนย์';
    let out = '';
    if (n >= 1000000) {
      const m = Math.floor(n / 1000000);
      out += readNumber(m) + 'ล้าน'; // recursive for > million
      n = n % 1000000;
    }
    out += readUnder1M(n);
    return out;
  }

  const rounded = Math.round(Number(amount || 0) * 100) / 100;
  const int = Math.floor(rounded);
  const sat = Math.round((rounded - int) * 100);

  if (int === 0 && sat === 0) return 'ศูนย์บาทถ้วน';

  let txt = '';
  if (int > 0) txt += readNumber(int) + 'บาท';
  if (sat === 0) {
    txt += int > 0 ? 'ถ้วน' : '';
  } else {
    txt += readUnder1M(sat) + 'สตางค์';
  }
  return txt;
}

// ─── Phase 617: พิมพ์ให้พอดีหน้า ──────────────────────────
// อาการ: ใบเสร็จ/ใบส่งสินค้าที่มีรายการเยอะ พิมพ์ออกมา 4 แผ่น (ต้นฉบับ+สำเนา ใบละ 2)
// วัดของจริงด้วย Chromium: .doc-page สูง 349mm (ใบเสร็จ) / 314mm (ใบส่งสินค้า) ที่ 15 รายการ
// — เกิน A4 (297mm) → ล้นไปแผ่นถัดไปทุกฉบับ ไม่ใช่ "หน้าเปล่า" แต่เป็นเนื้อหาที่ล้น
// วิธีแก้: ย่อให้พอดีหน้า = กติกาเดียวกับหน้าแชร์ (share_doc.js planCopyPages) → เอกสารสองทางตรงกัน
//
// ★ ต้องใช้ zoom ไม่ใช่ transform:scale — transform ไม่ย่อ layout box จำนวนแผ่นจึงไม่ลด
// ★ zoom ย่อ "ทั้งกว้างและสูง" → ต้องขยาย width/min-height ชดเชย (pageWidthMm / z) ไม่งั้นเอกสาร
//   หดไปกองมุมซ้ายบนเหลือครึ่งแผ่น (เจ้าของเจอกับ build 617 รอบแรก)
// ★ ต้องบังคับความกว้างตอนวัดเป็น mm ห้ามใช้ 100% ของหน้าต่าง — หน้าต่างพิมพ์กว้างไม่เท่ากระดาษ
//   (จอ scale 125-150% ยิ่งแคบ) วัดผิดความกว้าง = ข้อความตัดบรรทัดต่างกัน = สูงผิด = ย่อเกินจำเป็น
// ★ ห้ามทำกล่องเท่ากระดาษเป๊ะ — วัดหน้าผาไว้แล้ว: กล่อง 297.0mm = 2 แผ่น แต่ 297.2mm = 4 แผ่น
//   ห่างกันแค่ 0.2mm (297mm = 1122.52px ไม่ลงตัว) Chrome คนละรุ่น/ไดรเวอร์ปัดเศษต่างนิดเดียวก็ตก
//   อาการที่เจ้าของเจอตอนตั้ง "ระยะขอบ: ไม่มี" — ตอนตั้ง "ค่าเริ่มต้น" Chrome ย่อ fit ให้เองเลยไม่เห็น
export const PRINT_PAGE_HEIGHT_MM = 297;
export const PRINT_PAGE_WIDTH_MM = 210;
export const PRINT_SAFE_MM = 1;
export const PRINT_MIN_SCALE = 0.55;
const PX_PER_MM = 96 / 25.4;

// ย่อทุก .doc-page ให้พอดีหน้ากระดาษ — คืน array ของ zoom ที่ใช้จริง (1 = ไม่ได้ย่อ)
// ค้นแบบ binary search เพื่อได้ "ตัวย่อที่ใหญ่ที่สุดที่ยังพอดี" — ตัวอักษรเล็กเท่าที่จำเป็นเท่านั้น
export function fitPrintedPages(doc, opts = {}) {
  const pageHeightMm = opts.pageHeightMm ?? PRINT_PAGE_HEIGHT_MM;
  const pageWidthMm = opts.pageWidthMm ?? PRINT_PAGE_WIDTH_MM;
  const safeMm = opts.safeMm ?? PRINT_SAFE_MM;
  const minScale = opts.minScale ?? PRINT_MIN_SCALE;
  const boxHeightMm = pageHeightMm - safeMm; // กล่องต้องเล็กกว่ากระดาษเสมอ ห้ามเท่ากันเป๊ะ
  const boxWidthMm = pageWidthMm - safeMm;
  const limitPx = boxHeightMm * PX_PER_MM;
  const scales = [];
  for (const el of doc.querySelectorAll(".doc-page")) {
    // ตอนวัด: ปลด min-height ออกก่อน ไม่งั้นทุกหน้าสูงเท่ากระดาษหมด แยกไม่ออกว่าอันไหนล้นจริง
    const apply = (z) => {
      el.style.zoom = z === 1 ? "" : String(z);
      el.style.maxWidth = "none";
      el.style.width = (boxWidthMm / z) + "mm";
      el.style.minHeight = "0";
    };
    const heightPx = () => el.getBoundingClientRect().height; // zoom แล้ว rect คืนขนาดที่ตาเห็น
    apply(1);
    let z = 1;
    if (heightPx() > limitPx) {
      let lo = minScale, hi = 1;
      z = minScale; // ถ้าหาไม่เจอเลย = ล้นเกินเพดาน ใช้เพดานล่างไว้ก่อน (ยอมให้ล้นดีกว่าอ่านไม่ออก)
      for (let i = 0; i < 10; i++) {
        const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
        if (mid <= lo || mid >= hi) break;
        apply(mid);
        if (heightPx() <= limitPx) { z = mid; lo = mid; } else hi = mid;
      }
      apply(z);
    }
    // คืน min-height แบบชดเชย → กล่องสูงเกือบเต็มแผ่น ลายเซ็นยังปักท้ายหน้า (แต่ไม่แตะขอบ)
    el.style.minHeight = (boxHeightMm / z) + "mm";
    scales.push(z);
  }
  return scales;
}

// รอฟอนต์+โลโก้โหลดเสร็จก่อนค่อยวัด แล้วค่อยสั่งพิมพ์
// (วัดก่อนฟอนต์มา = ได้ความสูงผิด แล้วย่อไม่พอ) — opts.print=false ใช้กับหน้า "บันทึก PDF" ที่ผู้ใช้กดเอง
//
// ★ วัดครั้งเดียวไม่พอ — ต้องวัดใหม่ทุกครั้งที่เลย์เอาต์อาจเปลี่ยน:
//   (1) ฟอนต์มาหลัง fallback 3 วิ (เน็ตช้า/ฟอนต์ CDN ช้า) → เอกสารสูงขึ้นหลังย่อไปแล้ว
//   (2) beforeprint = จังหวะที่ Chrome สลับไปเลย์เอาต์กระดาษจริงก่อนแบ่งหน้า
//       ★★ นี่คือจุดชี้ขาด: วัดบนหน้าจอ (popup กว้าง 900px, จอ scale 125-150%) ไม่ใช่เลย์เอาต์เดียวกับตอนพิมพ์
export function printWhenReady(win, opts = {}) {
  const shouldPrint = opts.print !== false;
  const baseTitle = (() => { try { return win.document.title || ""; } catch { return ""; } })();
  let done = false;

  const fit = () => {
    try {
      const scales = fitPrintedPages(win.document, opts);
      const mm = [...win.document.querySelectorAll(".doc-page")]
        .map((p) => (p.getBoundingClientRect().height / (96 / 25.4)).toFixed(1));
      win.__printFit = { scales, mm };
      // ตัวเลขวินิจฉัยชั่วคราว (build 620) — โชว์บนแถบชื่อหน้าต่างพิมพ์เพื่ออ่านค่าจริงจากเครื่องเจ้าของ
      // ถ้าไม่มีวงเล็บนี้ = ตัวย่อไม่ได้ทำงานเลย
      win.document.title = baseTitle + " [fit " + scales.join("/") + " · " + mm.join("/") + "mm]";
    } catch { /* ย่อไม่ได้ก็ยังต้องพิมพ์ได้ */ }
  };

  // วัดใหม่ตอนฟอนต์มาถึงทีหลัง และตอนก่อนพิมพ์จริง (เลย์เอาต์กระดาษ ไม่ใช่เลย์เอาต์หน้าจอ)
  try { win.document.fonts?.addEventListener?.("loadingdone", fit); } catch { /* ไม่มี Font Loading API */ }
  try { win.addEventListener("beforeprint", fit); } catch { /* เบราว์เซอร์ไม่รองรับ */ }

  const go = () => {
    if (done) return;
    done = true;
    fit();
    if (!shouldPrint) return;
    try { win.focus(); } catch { /* บาง browser ปฏิเสธ focus */ }
    win.print();
  };
  const waits = [];
  try { if (win.document.fonts?.ready) waits.push(win.document.fonts.ready); } catch { /* ไม่มี Font Loading API */ }
  try {
    for (const img of win.document.images) {
      if (img.complete) continue;
      waits.push(new Promise((res) => {
        img.addEventListener("load", res, { once: true });
        img.addEventListener("error", res, { once: true });
      }));
    }
  } catch { /* ไม่มีรูปก็ข้าม */ }
  const soon = () => { try { win.setTimeout(go, 60); } catch { go(); } };
  Promise.all(waits).then(soon, soon);
  try { win.setTimeout(go, 3000); } catch { /* หน้าต่างถูกปิดไปแล้ว */ } // กันค้างถ้าฟอนต์/โลโก้โหลดไม่จบ
  return go;
}

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
  // Phase 617: รอฟอนต์/โลโก้ → ย่อให้พอดีหน้า → ค่อยพิมพ์ (เดิม setTimeout 600ms แล้วพิมพ์เลย)
  printWhenReady(w);
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
  // Phase 617: ย่อให้พอดีหน้าเหมือนกัน แต่ไม่สั่งพิมพ์ — ผู้ใช้กดปุ่มในหน้าต่างเอง
  printWhenReady(w, { print: false });
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
