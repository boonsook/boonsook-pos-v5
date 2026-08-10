// ═══════════════════════════════════════════════════════════
//  Share / PDF overlay (extracted from main.js in Phase 92.7)
//
//  สร้าง share modal → lazy-load html2canvas → render A4 PDF (multi-page) →
//  thumbnail → 7 share handlers (LINE/Messenger/Email/native/PDF/image/copy/print).
//
//  Behavior byte-identical กับ window._appShareDoc เดิม (main.js L426-644). DOM/window/
//  loaders ถูก inject ทั้งหมด → testable + main.js เก็บ thin wrapper.
// ═══════════════════════════════════════════════════════════

// ── หั่นหน้า PDF แบบรู้ขอบเขตเนื้อหา ────────────────────────────────────────
//   เดิม: เรนเดอร์เอกสารเป็นรูปยาวรูปเดียวแล้วเลื่อนทีละ "ความสูงหน้ากระดาษ" เป๊ะ ๆ
//   → รอยตัดตกกลางแถวตาราง/บล็อกลายเซ็น (ผ่ากลางบรรทัด) เพราะไม่รู้ว่าตรงนั้นมีอะไร
//   ตอนนี้: วัดขอบล่างของบล็อกที่ห้ามตัด (แถวตาราง/ยอดรวม/หมายเหตุ/ลายเซ็น) ก่อน
//   แล้วเลือกจุดตัดที่ "รอยต่อสุดท้ายที่ยังอยู่ในหน้า" — ไม่มี boundary = ตัดตรงขอบหน้าเหมือนเดิม

// บล็อกที่ห้ามถูกผ่ากลาง — ใช้ขอบล่างของแต่ละตัวเป็นจุดตัดที่ปลอดภัย
const BREAK_SELECTOR = [
  ".doc-page-inner > *",
  ".doc-table thead tr",
  ".doc-table tbody tr",
  ".doc-totals",
  ".doc-note-section",
  ".doc-signatures",
].join(", ");

export function collectBreakBoundaries(rootEl, scale = 1) {
  if (!rootEl || typeof rootEl.querySelectorAll !== "function") return [];
  if (typeof rootEl.getBoundingClientRect !== "function") return [];
  const rootTop = rootEl.getBoundingClientRect()?.top;
  if (typeof rootTop !== "number") return [];
  const out = [];
  for (const el of Array.from(rootEl.querySelectorAll(BREAK_SELECTOR) || [])) {
    if (!el || typeof el.getBoundingClientRect !== "function") continue;
    const r = el.getBoundingClientRect();
    if (!r || !(r.height > 0)) continue;
    out.push(Math.round((r.bottom - rootTop) * scale));
  }
  return Array.from(new Set(out)).filter(v => v > 0).sort((a, b) => a - b);
}

// ความสูง "เนื้อหาจริง" — canvas สูงเท่ากรอบ A4 เสมอ (min-height) ส่วนที่เนื้อหาไม่ถึงคือ padding
export function contentExtentPx(totalPx, boundariesPx = [], pxPerMm = 0) {
  if (!(totalPx > 0)) return 0;
  const contentBottom = boundariesPx.length ? Math.max(...boundariesPx) : 0;
  if (!(contentBottom > 0)) return totalPx;
  const pad = pxPerMm > 0 ? Math.round(2 * pxPerMm) : 0;
  return Math.min(totalPx, contentBottom + pad);
}

// ★ shrink-to-fit — เอกสารที่ยาวเกินหน้ากระดาษ "นิดเดียว" ควรได้หน้าเดียว ไม่ใช่แตกเป็นสองหน้า
//   ที่มา: สไตล์ force-A4 ตอนสร้าง PDF ให้เมตริกต่างจาก CSS ตอนพิมพ์เล็กน้อย เอกสารที่เครื่องพิมพ์
//   ออกมา 1 หน้า จึงกลายเป็น 2 หน้าในไฟล์แชร์ (หน้า 2 มีแค่บล็อกลายเซ็น) — เครื่องพิมพ์แก้ด้วยการ
//   ย่อให้พอดีหน้า เราทำแบบเดียวกัน; ถ้าต้องย่อมากกว่า minScale = ยาวจริง ให้แบ่งหน้าตามปกติ
export function computeFitToPage({ contentPx, pxPerMm, pageHeightMm, minScale = 0.85 } = {}) {
  if (!(contentPx > 0) || !(pxPerMm > 0) || !(pageHeightMm > 0)) return null;
  const pagePx = pageHeightMm * pxPerMm;
  if (contentPx <= pagePx) return { scale: 1 };
  const scale = pagePx / contentPx;
  return scale >= minScale ? { scale } : null;
}

// ★ Phase 610 — "หน้าสุดท้ายกำพร้า": เอกสารล้นหน้าจนหน้าที่ 2 มีแค่บล็อกลายเซ็น
//   เพดาน 0.85 แคบไปสำหรับเคสนี้ (ใบส่งสินค้า/ใบเสร็จที่รายการเยอะกว่าใบเสนอราคา) จึงยอมย่อลึกขึ้น
//   เฉพาะตอนที่ทางเลือกอีกทางคือ "หน้ากระดาษที่แทบไม่มีอะไร"
//   🔴 ต้องไม่ไปย่อเอกสารที่ยาวจริง:
//     - 3 หน้าขึ้นไป = ยาวจริง ย่อลงหน้าเดียวไม่สมเหตุผล → ใช้เพดานปกติ
//     - หน้าสุดท้ายเต็ม = ไม่ใช่หน้ากำพร้า (เช่น ใบเสร็จที่เรนเดอร์ต้นฉบับ+สำเนาในไฟล์เดียว
//       หน้า 2 คือสำเนาเต็มใบ ห้ามยุบรวมกับต้นฉบับเด็ดขาด) → ใช้เพดานปกติ
//   🔴 ค่าสองตัวต้องสอดคล้องกัน: orphanFloor ต้อง ≤ 1 / (1 + orphanMaxFill)
//     ไม่งั้นจะมีเคสที่ "ตัดสินว่ากำพร้า" แล้ว computeFitToPage ยังคืน null อยู่ดี = กฎนี้ไม่ทำอะไรเลย
//     (มี guard test ล็อกความสัมพันธ์นี้ไว้ — ผมพลาดข้อนี้เองตอนตั้งค่าครั้งแรก)
export function fitFloorForSlices({
  slices = [], pxPerMm = 0, pageHeightMm = 0,
  defaultFloor = 0.85, orphanFloor = 0.70, orphanMaxFill = 0.40,
} = {}) {
  if (!Array.isArray(slices) || slices.length !== 2) return defaultFloor;
  if (!(pxPerMm > 0) || !(pageHeightMm > 0)) return defaultFloor;
  const pagePx = pageHeightMm * pxPerMm;
  if (!(pagePx > 0)) return defaultFloor;
  const last = slices[slices.length - 1] || {};
  const lastPx = Number(last.endPx) - Number(last.startPx);
  if (!(lastPx > 0)) return defaultFloor;
  return (lastPx / pagePx) <= orphanMaxFill ? orphanFloor : defaultFloor;
}

// ★ Phase 610 — เอกสารบางชนิดเรนเดอร์ "หลายฉบับในไฟล์เดียว": ใบส่งสินค้า/ใบเสร็จ ทำ [1,2].map
//   = ต้นฉบับ + สำเนา → มี .doc-page สองอัน (ใบเสนอราคามีอันเดียว จึงไม่เคยเจอปัญหานี้)
//   force-a4 ตั้ง .doc-page เป็น min-height:1123px (ไม่ใช่ height) ⇒ ฉบับที่รายการเยอะจะสูงเกิน A4
//   ⇒ canvas = ต้นฉบับ(เกิน A4) + สำเนา(เกิน A4) แล้วถ้าหั่นตามความสูงรวม จุดตัดจะตกกลางฉบับ
//     (อาการที่ owner เจอ: หน้า 2 มีแค่ลายเซ็นของต้นฉบับ แล้วต่อด้วยหัวของสำเนา)
//   กติกาที่ถูก: **หนึ่ง .doc-page = หนึ่งหน้า PDF เสมอ** ย่อเฉพาะฉบับที่สูงเกิน ไม่ใช่ย่อทั้งม้วน
export function collectDocPageBounds(rootEl, scale = 1) {
  if (!rootEl || typeof rootEl.querySelectorAll !== "function") return [];
  if (typeof rootEl.getBoundingClientRect !== "function") return [];
  const rootTop = rootEl.getBoundingClientRect()?.top;
  if (typeof rootTop !== "number") return [];
  const out = [];
  for (const el of Array.from(rootEl.querySelectorAll(".doc-page") || [])) {
    if (!el || typeof el.getBoundingClientRect !== "function") continue;
    const r = el.getBoundingClientRect();
    if (!r || !(r.height > 0)) continue;
    out.push({
      startPx: Math.max(0, Math.round((r.top - rootTop) * scale)),
      endPx: Math.round((r.bottom - rootTop) * scale),
    });
  }
  return out.filter(b => b.endPx > b.startPx).sort((a, b) => a.startPx - b.startPx);
}

// หนึ่งฉบับ = หนึ่งหน้า PDF · ย่อเฉพาะฉบับที่สูงเกิน A4
// คืน null = มีฉบับใดต้องย่อลึกกว่าเพดาน (หรือวัดขอบไม่ได้) → ผู้เรียกกลับไปใช้ตัวหั่นหน้าเดิม
export function planCopyPages({ bounds = [], pxPerMm = 0, pageHeightMm = 0, minScale = 0.55 } = {}) {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;
  if (!(pxPerMm > 0) || !(pageHeightMm > 0)) return null;
  const pagePx = pageHeightMm * pxPerMm;
  if (!(pagePx > 0)) return null;
  const pages = [];
  for (const b of bounds) {
    const startPx = Number(b?.startPx);
    const endPx = Number(b?.endPx);
    const h = endPx - startPx;
    if (!(h > 0) || !(startPx >= 0)) return null;
    const scale = h <= pagePx ? 1 : pagePx / h;
    if (scale < minScale) return null;
    pages.push({ startPx, endPx, scale });
  }
  return pages;
}

// pure — คำนวณว่าแต่ละหน้าครอบพิกเซลช่วงไหนของรูป (unit-test ได้โดยไม่ต้องมี DOM)
export function computePageSlices({
  totalPx, pxPerMm, pageHeightMm,
  boundariesPx = [], topMarginMm = 8, bottomMarginMm = 8, maxPages = 200,
} = {}) {
  const pages = [];
  if (!(totalPx > 0) || !(pxPerMm > 0) || !(pageHeightMm > 0)) return pages;
  // ★ ตัดพื้นที่ว่างท้ายเอกสารทิ้งก่อน — canvas สูงเท่ากรอบ A4 เสมอ (min-height 1123px)
  //   ถ้าเนื้อหาจบก่อน ส่วนที่เหลือคือ padding ล้วน ไม่ควรนับเป็นความยาวที่ต้องแบ่งหน้า
  const total = contentExtentPx(totalPx, boundariesPx, pxPerMm);

  let start = 0;
  while (start < total - 1 && pages.length < maxPages) {
    // หน้าแรกไม่ต้องเว้นขอบบน (เทมเพลตมี padding ของตัวเองอยู่แล้ว) — หน้า 2+ ต้องเว้น
    const topMm = pages.length === 0 ? 0 : topMarginMm;
    // ★ หน้าสุดท้ายใช้ความสูงกระดาษเต็ม — ขอบล่างมีไว้กันเนื้อหาชนขอบ "เฉพาะหน้าที่ถูกตัดกลาง"
    //   ถ้าหักขอบล่างกับหน้าสุดท้ายด้วย เอกสารที่เดิมพอดีหนึ่งหน้าจะถูกดันเป็นสองหน้า (regression 607)
    const fullPx = (pageHeightMm - topMm) * pxPerMm;
    if (total - start <= fullPx) {
      pages.push({ startPx: start, endPx: total, topMm });
      break;
    }
    const usablePx = (pageHeightMm - topMm - bottomMarginMm) * pxPerMm;
    if (!(usablePx > 0)) break;
    let end = start + usablePx;
    if (end >= total) {
      end = total;
    } else {
      // เลือกรอยต่อสุดท้ายที่ยังอยู่ในหน้านี้ — ถ้าไม่มีเลย (บล็อกเดียวสูงกว่าหน้า) ตัดตรงขอบ
      let cut = 0;
      for (const b of boundariesPx) {
        if (b > start + 1 && b <= end && b > cut) cut = b;
      }
      if (cut > start) end = cut;
    }
    pages.push({ startPx: start, endPx: end, topMm });
    start = end;
  }
  return pages;
}

export async function shareDoc({
  docElementId,
  docName,
  documentRef = typeof document !== "undefined" ? document : null,
  windowRef   = typeof window   !== "undefined" ? window   : null,
  loadHtml2Canvas,                                    // injected — lazy_libs loader (via main.js wrapper)
  showToast   = () => {},                             // injected — global toast
  logger      = typeof console !== "undefined" ? console : null,
} = {}) {
  if (!documentRef || !windowRef) return;

  documentRef.getElementById("shareOverlay")?.remove();
  const overlay = documentRef.createElement("div");
  overlay.id = "shareOverlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:400px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;font-size:18px">แชร์เอกสาร</h3>
        <button id="shareCloseBtn" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b">&times;</button>
      </div>
      <div id="shareThumbnail" style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center;min-height:60px">
        <div style="color:#64748b;font-size:13px">กำลังสร้าง PDF...</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:12px;margin-bottom:16px">
        <button class="share-opt" data-sh="line" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#06C755;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">L</div>
          <span style="font-size:11px;font-weight:600">LINE</span>
        </button>
        <button class="share-opt" data-sh="fb" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#1877F2;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">f</div>
          <span style="font-size:11px;font-weight:600">Messenger</span>
        </button>
        <button class="share-opt" data-sh="email" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#EA4335;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">✉</div>
          <span style="font-size:11px;font-weight:600">Email</span>
        </button>
        <button class="share-opt" data-sh="native" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#334155;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:18px">↗</div>
          <span style="font-size:11px;font-weight:600">แชร์อื่นๆ</span>
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:12px;margin-bottom:12px">
        <button class="share-opt" data-sh="pdf" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#DC2626;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px">PDF</div>
          <span style="font-size:11px;font-weight:600">บันทึก PDF</span>
        </button>
        <button class="share-opt" data-sh="save" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#8B5CF6;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:18px">⬇</div>
          <span style="font-size:11px;font-weight:600">บันทึกรูป</span>
        </button>
        <button class="share-opt" data-sh="copy" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#0EA5E9;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:18px">⧉</div>
          <span style="font-size:11px;font-weight:600">คัดลอกรูป</span>
        </button>
        <button class="share-opt" data-sh="print" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:10px;background:#64748b;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">🖨</div>
          <span style="font-size:11px;font-weight:600">พิมพ์</span>
        </button>
      </div>
      <div id="shareStatus" style="text-align:center;font-size:13px;color:#64748b;display:none"></div>
    </div>`;
  documentRef.body.appendChild(overlay);

  let _canvas = null, _pdfBlob = null, _pdfUrl = null;
  const docEl = documentRef.getElementById(docElementId);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(windowRef.navigator.userAgent) || (windowRef.navigator.maxTouchPoints > 1 && windowRef.innerWidth < 1024);

  // ★ Lazy load html2canvas ก่อนใช้
  const _h2cReady = await loadHtml2Canvas();

  // Phase 92.5 hotfix: ถ้าโหลดตัวสร้าง PDF ไม่ได้ (CSP บล็อก / offline) อย่าปล่อย
  // ให้ modal ค้างที่ "กำลังสร้าง PDF..." — แจ้ง user + ยังปิด modal ได้
  if (!_h2cReady || !windowRef.html2canvas) {
    const thumb = documentRef.getElementById("shareThumbnail");
    if (thumb) thumb.innerHTML = '<div style="color:#dc2626;font-size:13px">โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่</div>';
    showToast("โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่");
    documentRef.getElementById("shareCloseBtn")?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    return;
  }

  // ── สร้าง PDF ขนาด A4 จริง (ไม่ใช้ responsive) ──
  if (docEl && windowRef.html2canvas && windowRef.jspdf) {
    // สร้าง style tag ชั่วคราวเพื่อ force A4 (ชนะ responsive !important)
    const forceA4Style = documentRef.createElement("style");
    forceA4Style.id = "forceA4Style";
    forceA4Style.textContent = `
      .force-a4-pdf { position:fixed!important;left:-9999px!important;top:0!important;z-index:-1!important;width:794px!important;background:#fff!important; }
      .force-a4-pdf .doc-page { width:794px!important;min-height:1123px!important;padding:60px 54px 48px!important;font-size:13px!important;border-radius:0!important;box-shadow:none!important; }
      .force-a4-pdf .doc-preview { padding:0!important;background:#fff!important; }
      .force-a4-pdf .doc-header { flex-direction:row!important;gap:12px!important;padding-bottom:12px!important; }
      .force-a4-pdf .doc-header-left { max-width:55%!important;flex-direction:row!important;gap:12px!important; }
      .force-a4-pdf .doc-header-right { text-align:right!important; }
      .force-a4-pdf .doc-logo { width:60px!important;height:60px!important; }
      .force-a4-pdf .doc-company-name { font-size:16px!important; }
      .force-a4-pdf .doc-company-detail { font-size:11.5px!important; }
      .force-a4-pdf .doc-title { font-size:28px!important; }
      .force-a4-pdf .doc-detail-table { margin-left:auto!important;font-size:12px!important; }
      .force-a4-pdf .doc-detail-table td { padding:3px 10px!important; }
      .force-a4-pdf .doc-detail-table td:last-child { min-width:140px!important; }
      .force-a4-pdf .doc-customer-name { font-size:14px!important; }
      .force-a4-pdf .doc-customer-detail { font-size:12px!important; }
      .force-a4-pdf .doc-table { display:table!important;font-size:12.5px!important;overflow:visible!important; }
      .force-a4-pdf .doc-table th { padding:7px 8px!important;font-size:11.5px!important; }
      .force-a4-pdf .doc-table td { padding:7px 8px!important;font-size:12.5px!important; }
      .force-a4-pdf .doc-totals { width:270px!important;margin-left:auto!important; }
      .force-a4-pdf .doc-total-row { font-size:12.5px!important; }
      .force-a4-pdf .doc-total-row.grand { font-size:14px!important; }
      .force-a4-pdf .doc-signatures { flex-direction:row!important;justify-content:space-between!important;gap:0!important; }
      .force-a4-pdf .doc-sig-col { width:44%!important; }
      .force-a4-pdf .doc-sig-line { width:200px!important; }
      .force-a4-pdf .doc-sig-behalf { font-size:12px!important;margin-bottom:28px!important; }
      .force-a4-pdf .doc-sig-label-row { font-size:11.5px!important; }
      .force-a4-pdf .doc-note-section { font-size:12px!important; }
      .force-a4-pdf .doc-page-badge { width:44px!important;height:44px!important;font-size:20px!important; }
      .force-a4-pdf .doc-payment-grid { grid-template-columns:auto 1fr auto 1fr!important;font-size:11.5px!important; }
    `;
    documentRef.head.appendChild(forceA4Style);

    const clone = docEl.cloneNode(true);
    clone.classList.add("force-a4-pdf");
    documentRef.body.appendChild(clone);

    windowRef.html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: "#ffffff", width: 794 }).then(c => {
      // ★ วัดขอบเขตบล็อก "ก่อน" ถอด clone ออกจาก DOM (หลังถอดแล้ววัดไม่ได้)
      let _breakPx = [];
      let _copyBounds = [];
      try {
        const cloneW = clone.offsetWidth || 794;
        const _s = (c.width || cloneW) / cloneW;
        _breakPx = collectBreakBoundaries(clone, _s);
        _copyBounds = collectDocPageBounds(clone, _s);
      } catch (e) { logger?.warn?.("break boundary measure failed:", e); }
      documentRef.body.removeChild(clone);
      documentRef.head.removeChild(forceA4Style);
      _canvas = c;
      // Thumbnail
      const thumb = documentRef.getElementById("shareThumbnail");
      if (thumb) { const tc = documentRef.createElement("canvas"); const r = 340/c.width; tc.width=340; tc.height=Math.min(c.height*r,200); tc.getContext("2d").drawImage(c,0,0,tc.width,c.height*r); thumb.innerHTML=""; tc.style.cssText="max-width:100%;border-radius:6px;border:1px solid #e2e8f0"; thumb.appendChild(tc); }
      // PDF A4
      try {
        const { jsPDF } = windowRef.jspdf;
        const pdf = new jsPDF("p","mm","a4");
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        // ★ หั่นหน้าโดยไม่ผ่ากลางแถว: ตัดที่ขอบล่างของบล็อกที่วัดไว้ แล้ว copy เฉพาะช่วงนั้นลง canvas ต่อหน้า
        const pxPerMm = c.width / pageW;
        // ★ Phase 610: ถ้าวัด .doc-page ได้ ให้ "หนึ่งฉบับ = หนึ่งหน้า PDF" ก่อนเสมอ
        //   (ต้นฉบับ/สำเนา ของใบส่งสินค้า-ใบเสร็จ ต้องได้ใบละแผ่น ไม่ใช่ถูกหั่นกลางใบ)
        const copyPages = planCopyPages({ bounds: _copyBounds, pxPerMm, pageHeightMm: pageH });
        const slices = computePageSlices({
          totalPx: c.height, pxPerMm, pageHeightMm: pageH, boundariesPx: _breakPx,
        });
        // ★ ห้าม fallback เงียบ: วัดขอบเขตไม่ได้ + เอกสารยาวเกินหนึ่งหน้า = กลับไปตัดตรงขอบ (ผ่ากลางแถวได้)
        //   ต้องส่งสัญญาณออกมา ไม่งั้นบั๊กเดิมกลับมาโดยไม่มีใครรู้
        if (_breakPx.length === 0 && slices.length > 1) {
          logger?.warn?.("[share_doc] วัดขอบเขตแถวไม่ได้ — หั่นหน้าแบบตัดตรงขอบ อาจผ่ากลางแถว");
          const st = documentRef.getElementById("shareStatus");
          if (st) { st.textContent = "⚠️ แบ่งหน้าแบบประมาณ — ตรวจรอยต่อหน้าก่อนส่ง"; st.style.display = "block"; st.style.color = "#b45309"; }
        }
        // ★ ยาวเกินหน้าแค่นิดเดียว = ย่อให้พอดีหน้าเดียว (เหมือน shrink-to-fit ของเครื่องพิมพ์)
        //   เอกสารที่พิมพ์ออกมา 1 หน้า ต้องไม่กลายเป็น 2 หน้าในไฟล์แชร์
        const extentPx = contentExtentPx(c.height, _breakPx, pxPerMm);
        // Phase 610: เพดานการย่อขึ้นกับว่าหน้าสุดท้าย "กำพร้า" หรือไม่ (ดู fitFloorForSlices)
        const minScale = fitFloorForSlices({ slices, pxPerMm, pageHeightMm: pageH });
        const fit = slices.length > 1 ? computeFitToPage({ contentPx: extentPx, pxPerMm, pageHeightMm: pageH, minScale }) : null;

        if (copyPages) {
          // หนึ่ง .doc-page = หนึ่งหน้า PDF · ย่อเฉพาะฉบับที่สูงเกิน A4 (คงสัดส่วน จัดกึ่งกลางแนวนอน)
          copyPages.forEach((p, i) => {
            if (i > 0) pdf.addPage();
            const sh = Math.max(1, Math.round(p.endPx - p.startPx));
            const tmp = documentRef.createElement("canvas");
            tmp.width = c.width;
            tmp.height = sh;
            const tctx = tmp.getContext ? tmp.getContext("2d") : null;
            // ★ ถมขาวก่อนเสมอ — canvas ใหม่โปร่งใส แปลงเป็น JPEG แล้วจะได้พื้นดำ
            if (tctx?.fillRect) { tctx.fillStyle = "#ffffff"; tctx.fillRect(0, 0, tmp.width, sh); }
            if (tctx?.drawImage) tctx.drawImage(c, 0, p.startPx, c.width, sh, 0, 0, c.width, sh);
            const wMm = pageW * p.scale;
            const hMm = (sh / pxPerMm) * p.scale;
            pdf.addImage(tmp.toDataURL("image/jpeg", 0.92), "JPEG", (pageW - wMm) / 2, 0, wMm, hMm);
          });
        } else if (fit) {
          const sh = Math.max(1, Math.round(extentPx));
          const tmp = documentRef.createElement("canvas");
          tmp.width = c.width;
          tmp.height = sh;
          const tctx = tmp.getContext ? tmp.getContext("2d") : null;
          if (tctx?.fillRect) { tctx.fillStyle = "#ffffff"; tctx.fillRect(0, 0, tmp.width, sh); }
          if (tctx?.drawImage) tctx.drawImage(c, 0, 0, c.width, sh, 0, 0, c.width, sh);
          const wMm = pageW * fit.scale;
          const hMm = (sh / pxPerMm) * fit.scale;
          pdf.addImage(tmp.toDataURL("image/jpeg", 0.92), "JPEG", (pageW - wMm) / 2, 0, wMm, hMm);
        } else if (slices.length === 0) {
          // ไม่มีข้อมูลขนาด (เช่น canvas stub) — คงพฤติกรรมเดิมไว้ ไม่ทำให้พัง
          pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, (c.height * pageW) / c.width);
        } else {
          slices.forEach((s, i) => {
            if (i > 0) pdf.addPage();
            const sh = Math.max(1, Math.round(s.endPx - s.startPx));
            const tmp = documentRef.createElement("canvas");
            tmp.width = c.width;
            tmp.height = sh;
            const tctx = tmp.getContext ? tmp.getContext("2d") : null;
            // ★ ต้องถมขาวก่อน — canvas ใหม่โปร่งใส พอแปลงเป็น JPEG จะกลายเป็นพื้นดำ
            if (tctx?.fillRect) { tctx.fillStyle = "#ffffff"; tctx.fillRect(0, 0, tmp.width, sh); }
            if (tctx?.drawImage) tctx.drawImage(c, 0, s.startPx, c.width, sh, 0, 0, c.width, sh);
            pdf.addImage(tmp.toDataURL("image/jpeg", 0.92), "JPEG", 0, s.topMm, pageW, sh / pxPerMm);
          });
        }
        _pdfBlob = pdf.output("blob");
        _pdfUrl = windowRef.URL.createObjectURL(_pdfBlob);
        const statusEl = documentRef.getElementById("shareStatus");
        if (statusEl) { statusEl.textContent = "✓ PDF A4 พร้อมแชร์"; statusEl.style.display = "block"; statusEl.style.color = "#10b981"; setTimeout(() => { statusEl.style.display = "none"; statusEl.style.color = "#64748b"; }, 2000); }
      } catch(e) { logger?.warn?.("PDF creation failed:", e); }
    }).catch(() => { try { documentRef.body.removeChild(clone); documentRef.getElementById("forceA4Style")?.remove(); } catch(e){} });
  }

  const close = () => { if (_pdfUrl) windowRef.URL.revokeObjectURL(_pdfUrl); overlay.remove(); };
  documentRef.getElementById("shareCloseBtn")?.addEventListener("click", close);
  overlay.addEventListener("click", e => { if(e.target===overlay) close(); });

  const setStatus = m => { const el=documentRef.getElementById("shareStatus"); if(el){el.textContent=m;el.style.display="block";el.style.color="#64748b";setTimeout(()=>el.style.display="none",4000);} };

  // ── Helper: ดาวน์โหลด PDF ──
  const dlPdf = () => { if(!_pdfUrl){setStatus("กำลังสร้าง PDF รอสักครู่..."); return false;} const a=documentRef.createElement("a");a.download=docName+".pdf";a.href=_pdfUrl;a.click(); return true; };
  // ── Helper: ดาวน์โหลดรูป ──
  const dlImg = () => { if(!_canvas) return; const a=documentRef.createElement("a");a.download=docName+".png";a.href=_canvas.toDataURL("image/png");a.click(); };
  // ── Helper: สร้าง PDF File สำหรับ native share ──
  const getPdfFile = () => { if(!_pdfBlob) return null; return new windowRef.File([_pdfBlob], docName+".pdf", {type:"application/pdf"}); };
  // ★ Phase 613: มือถือเปิด blob: ในแท็บใหม่ไม่ได้ — iOS Safari ปฏิเสธตรง ๆ · Android มักบล็อกเป็น popup
  //   ทางสำรองของมือถือจึงต้องเป็น "ดาวน์โหลดไฟล์" ไม่ใช่ window.open ไม่งั้นกดแล้วเงียบ = ผู้ใช้เห็นว่าแชร์ไม่ได้
  //   (ปุ่ม PDF ทำถูกอยู่แล้วมาแต่เดิม ส่วน LINE/FB/แชร์อื่น/อีเมล ยังใช้ window.open ทุกแพลตฟอร์ม)
  const openOrDownloadPdf = () => {
    if (!_pdfUrl) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return false; }
    if (isMobile) return dlPdf();
    windowRef.open(_pdfUrl, "_blank");
    return true;
  };

  overlay.querySelectorAll(".share-opt").forEach(btn => {
    btn.addEventListener("mouseenter", ()=>btn.style.background="#f1f5f9");
    btn.addEventListener("mouseleave", ()=>btn.style.background="#fff");
    btn.addEventListener("click", async () => {
      const t = btn.dataset.sh;

      // ── LINE / Facebook / แชร์อื่นๆ → ส่ง PDF ผ่าน native share ──
      if (t==="line"||t==="fb"||t==="native") {
        const _appName = {line:"LINE",fb:"Messenger",native:"แอปอื่น"}[t];
        if (!_pdfBlob) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        const pdfFile = getPdfFile();
        let shared = false;
        // มือถือ: ใช้ native share ส่ง PDF ตรง
        if (isMobile && pdfFile && windowRef.navigator.canShare && windowRef.navigator.canShare({title:docName,files:[pdfFile]})) {
          try { await windowRef.navigator.share({title:docName+" — บุญสุข อิเล็กทรอนิกส์",text:"เอกสาร "+docName,files:[pdfFile]}); setStatus("📤 แชร์ PDF สำเร็จ!"); shared=true; }
          catch(e){ if(e.name==="AbortError") shared=true; else logger?.warn?.("[share_doc] native share ล้ม:", e?.name, e?.message); }
        }
        // ทางสำรอง — มือถือ: ดาวน์โหลดไฟล์ · เดสก์ท็อป: เปิด PDF ในแท็บใหม่
        if (!shared) {
          const ok = openOrDownloadPdf();
          if (!ok) return;                         // PDF ยังไม่พร้อม — setStatus บอกไปแล้ว
          if (isMobile) {
            // ★ ห้ามเปิดแท็บซ้อนบนมือถือ (ถูกบล็อกและทับหน้าเอกสาร) — บอกวิธีต่อให้ชัดแทน
            setStatus("📥 ดาวน์โหลด PDF แล้ว — เปิด "+_appName+" แล้วแนบไฟล์จากเครื่องได้เลย");
          } else if (t==="line") {
            setStatus("📄 เปิด PDF แล้ว — ลากไฟล์ไปวางใน LINE หรือกดดาวน์โหลดแล้วแนบ");
          } else if (t==="fb") {
            windowRef.open("https://www.messenger.com/", "_blank");
            setStatus("📄 เปิด PDF + Messenger แล้ว — แนบไฟล์ส่งได้เลย");
          } else {
            setStatus("📄 เปิด PDF แล้ว — กดดาวน์โหลดแล้วส่งต่อได้เลย");
          }
        }
      }
      // ── Email → เปิด PDF + เปิด mailto ──
      else if (t==="email") {
        if (!openOrDownloadPdf()) return;
        const s=encodeURIComponent("เอกสาร "+docName+" — บุญสุข อิเล็กทรอนิกส์");
        const b=encodeURIComponent("สวัสดีครับ/ค่ะ\n\nส่งเอกสาร "+docName+" มาให้ (ไฟล์ PDF แนบ)\n\nขอบคุณครับ/ค่ะ\nบุญสุข อิเล็กทรอนิกส์");
        windowRef.open("mailto:?subject="+s+"&body="+b);
        setStatus(isMobile
          ? "📥 ดาวน์โหลด PDF แล้ว — แนบไฟล์ในอีเมลที่เปิดขึ้นมาได้เลย"
          : "📄 เปิด PDF + Email แล้ว — ดาวน์โหลดแล้วแนบไฟล์ได้เลย");
      }
      // ── บันทึก PDF ──
      else if (t==="pdf") {
        if (!_pdfUrl) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        if (isMobile) { dlPdf(); } else { windowRef.open(_pdfUrl, "_blank"); }
        setStatus("📄 เปิด PDF แล้ว ✓");
      }
      // ── บันทึกรูป ──
      else if (t==="save") { dlImg(); setStatus("📥 บันทึกรูปแล้ว ✓"); }
      // ── คัดลอกรูป ──
      else if (t==="copy") { if(!_canvas) return; try{_canvas.toBlob(async b=>{await windowRef.navigator.clipboard.write([new windowRef.ClipboardItem({"image/png":b})]);setStatus("📋 คัดลอกรูปแล้ว — วางใน LINE/Chat ได้เลย ✓");},"image/png");}catch(e){dlImg();setStatus("บันทึกรูปแทนแล้ว");} }
      // ── พิมพ์ ──
      else if (t==="print") {
        if (!_pdfUrl) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        // ★ Phase 613: มือถือเปิด blob: แล้วสั่ง print ไม่ได้ — ดาวน์โหลดให้แล้วบอกวิธีต่อ
        if (isMobile) { if (dlPdf()) setStatus("📥 ดาวน์โหลด PDF แล้ว — เปิดไฟล์แล้วสั่งพิมพ์จากเครื่องได้เลย"); return; }
        const w = windowRef.open(_pdfUrl, "_blank");
        if (w) { setTimeout(() => { try { w.print(); } catch(e){} }, 800); }
        else { setStatus("เบราว์เซอร์บล็อกแท็บใหม่ — กดปุ่ม PDF เพื่อดาวน์โหลดแล้วสั่งพิมพ์แทน"); return; }
        setStatus("🖨️ เปิดหน้าพิมพ์แล้ว");
      }
    });
  });
}
