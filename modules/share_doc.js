// ═══════════════════════════════════════════════════════════
//  Share / PDF overlay (extracted from main.js in Phase 92.7)
//
//  สร้าง share modal → lazy-load html2canvas → render A4 PDF (multi-page) →
//  thumbnail → 7 share handlers (LINE/Messenger/Email/native/PDF/image/copy/print).
//
//  Behavior byte-identical กับ window._appShareDoc เดิม (main.js L426-644). DOM/window/
//  loaders ถูก inject ทั้งหมด → testable + main.js เก็บ thin wrapper.
// ═══════════════════════════════════════════════════════════

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
        const imgData = c.toDataURL("image/jpeg", 0.92);
        const imgW = pageW;
        const imgH = (c.height * pageW) / c.width;
        // ถ้ายาวกว่า 1 หน้า ให้ตัดเป็นหลายหน้า
        let y = 0;
        let pageNum = 0;
        while (y < imgH) {
          if (pageNum > 0) pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, -y, imgW, imgH);
          y += pageH;
          pageNum++;
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
          try { await windowRef.navigator.share({title:docName+" — บุญสุข อิเล็กทรอนิกส์",text:"เอกสาร "+docName,files:[pdfFile]}); setStatus("📤 แชร์ PDF สำเร็จ!"); shared=true; } catch(e){ if(e.name==="AbortError") shared=true; }
        }
        // Desktop: เปิด PDF ในแท็บใหม่ + เปิดแอป
        if (!shared) {
          // เปิด PDF ในแท็บใหม่ (ไม่ขึ้น Save As)
          if (_pdfUrl) windowRef.open(_pdfUrl, "_blank");
          // เปิดแอปที่เลือก
          if (t==="line") {
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
        if (_pdfUrl) windowRef.open(_pdfUrl, "_blank");
        const s=encodeURIComponent("เอกสาร "+docName+" — บุญสุข อิเล็กทรอนิกส์");
        const b=encodeURIComponent("สวัสดีครับ/ค่ะ\n\nส่งเอกสาร "+docName+" มาให้ (ไฟล์ PDF แนบ)\n\nขอบคุณครับ/ค่ะ\nบุญสุข อิเล็กทรอนิกส์");
        windowRef.open("mailto:?subject="+s+"&body="+b);
        setStatus("📄 เปิด PDF + Email แล้ว — ดาวน์โหลดแล้วแนบไฟล์ได้เลย");
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
        const w = windowRef.open(_pdfUrl, "_blank");
        if (w) { setTimeout(() => { try { w.print(); } catch(e){} }, 800); }
        setStatus("🖨️ เปิดหน้าพิมพ์แล้ว");
      }
    });
  });
}
