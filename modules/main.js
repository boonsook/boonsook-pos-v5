
import { renderDashboard } from "./modules/dashboard.js";
import { renderProductsPage } from "./modules/products.js";
import { renderPosPage } from "./modules/pos.js";
import { renderSalesPage } from "./modules/sales.js";
import { renderCustomersPage } from "./modules/customers.js";
import { renderQuotationsPage } from "./modules/quotations.js";
import { renderServiceJobsPage } from "./modules/service_jobs.js";
import { renderSettingsPage } from "./modules/settings/index.js";
import { renderDeliveryInvoicesPage } from "./modules/delivery_invoices.js";
import { renderReceiptsPage } from "./modules/receipts.js";
import { renderExpensesPage } from "./modules/expenses.js";
import { renderProfitReportPage } from "./modules/profit_report.js";
import { renderStockMovementsPage } from "./modules/stock_movements.js";
import { renderCalendarPage } from "./modules/calendar.js";
import { renderLoyaltyPage } from "./modules/loyalty.js";
import { renderLineNotifySettings, sendLineNotify, notifyLowStock, notifyNewOrder, notifyJobDone } from "./modules/line_notify.js";
import { renderPermissionMatrix, hasPermission } from "./modules/permission_matrix.js";
import { renderCustomerDashboard } from "./modules/customer_dashboard.js";
import { renderBtuCalculatorPage } from "./modules/btu_calculator.js";
import { renderServiceRequestPage } from "./modules/service_request.js";
import { renderSolarPage } from "./modules/solar.js";
import { renderAcInstallPage } from "./modules/ac_install.js";
import { renderErrorCodesPage } from "./modules/error_codes.js";
import { renderAiSalesPage } from "./modules/ai_sales.js";
import { renderAcShopPage } from "./modules/ac_shop.js";
import "./modules/doc-override.js";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════
//  IMAGE COMPRESSOR — บีบอัดรูปก่อนอัปโหลด (ลดจาก 3-5MB → 200-500KB)
// ═══════════════════════════════════════════════════════════
window._compressImage = function(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve) => {
    // ถ้าไฟล์เล็กกว่า 500KB ไม่ต้องบีบ
    if (file.size < 500 * 1024) { resolve(file); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) {
            const compressed = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
            // image compressed
            resolve(compressed);
          } else {
            resolve(file);
          }
        }, "image/jpeg", quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

// ═══════════════════════════════════════════════════════════
//  XHR HELPER — supabase .insert() ค้างในบางสภาพแวดล้อม
//  ใช้ XHR ตรงๆ แทนทุก INSERT/POST operation
// ═══════════════════════════════════════════════════════════
function xhrPost(table, payload, opts = {}) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const prefer = opts.returnData ? "return=representation" : "return=minimal";
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", cfg.url + "/rest/v1/" + table);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.setRequestHeader("Prefer", prefer);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        const txt = xhr.responseText;
        if (txt && txt.trim()) {
          try { data = JSON.parse(txt); } catch (e) {
            console.warn("[xhrPost] " + table + " JSON.parse failed:", e.message, txt.substring(0, 200));
          }
        }
        resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
      } else {
        let errBody = xhr.responseText;
        let msg = "HTTP " + xhr.status;
        try {
          const parsed = JSON.parse(errBody);
          msg = parsed.message || parsed.details || parsed.hint || msg;
          console.error("[xhrPost] " + table + " ERROR:", parsed);
        } catch (e) {
          console.error("[xhrPost] " + table + " ERROR raw:", errBody);
        }
        resolve({ ok: false, data: null, error: { message: msg } });
      }
    };
    xhr.onerror = function () { resolve({ ok: false, data: null, error: { message: "Network error" } }); };
    xhr.ontimeout = function () { resolve({ ok: false, data: null, error: { message: "Timeout" } }); };
    // ★ ส่งเป็น object เดียว (ไม่ wrap array)
    xhr.send(JSON.stringify(payload));
  });
}

function xhrPatch(table, payload, eqCol, eqVal) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", cfg.url + "/rest/v1/" + table + "?" + eqCol + "=eq." + eqVal);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    // ★ ใช้ return=representation เพื่อตรวจสอบว่า RLS อนุญาตจริงหรือไม่
    xhr.setRequestHeader("Prefer", "return=representation");
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        const txt = xhr.responseText;
        if (txt && txt.trim()) {
          try { data = JSON.parse(txt); } catch (e) {
            console.warn("[xhrPatch] " + table + " JSON.parse failed:", e.message, txt.substring(0, 200));
          }
        }
        // ★ ถ้า Supabase คืน array ว่าง = RLS บล็อค (0 rows affected)
        if (Array.isArray(data) && data.length === 0) {
          resolve({ ok: false, error: { message: "ไม่สามารถอัปเดตได้ (RLS blocked — 0 rows affected)" } });
        } else {
          resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
        }
      } else {
        let msg = "HTTP " + xhr.status;
        const errTxt = xhr.responseText;
        if (errTxt && errTxt.trim()) {
          try { msg = JSON.parse(errTxt)?.message || msg; } catch (e) {
            console.warn("[xhrPatch] " + table + " error body parse failed:", errTxt.substring(0, 200));
          }
          console.error("[xhrPatch] " + table + " " + xhr.status + ":", errTxt.substring(0, 300));
        } else {
          console.error("[xhrPatch] " + table + " " + xhr.status + " (empty body)");
        }
        resolve({ ok: false, error: { message: msg } });
      }
    };
    xhr.onerror = function () { resolve({ ok: false, error: { message: "Network error" } }); };
    xhr.ontimeout = function () { resolve({ ok: false, error: { message: "Timeout" } }); };
    xhr.send(JSON.stringify(payload));
  });
}

// ═══ XHR DELETE — ลบข้อมูลผ่าน REST API ═══
function xhrDelete(table, eqCol, eqVal) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", cfg.url + "/rest/v1/" + table + "?" + eqCol + "=eq." + eqVal);
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.setRequestHeader("Prefer", "return=minimal");
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, error: null });
      else {
        let msg = "HTTP " + xhr.status;
        const errTxt = xhr.responseText;
        if (errTxt && errTxt.trim()) {
          try { msg = JSON.parse(errTxt)?.message || msg; } catch (e) {
            console.warn("[xhrDelete] " + table + " error body parse failed:", errTxt.substring(0, 200));
          }
          console.error("[xhrDelete] " + table + " " + xhr.status + ":", errTxt.substring(0, 300));
        } else {
          console.error("[xhrDelete] " + table + " " + xhr.status + " (empty body)");
        }
        resolve({ ok: false, error: { message: msg } });
      }
    };
    xhr.onerror = function () { resolve({ ok: false, error: { message: "Network error" } }); };
    xhr.ontimeout = function () { resolve({ ok: false, error: { message: "Timeout" } }); };
    xhr.send();
  });
}

// ★ Expose XHR helpers globally for modules (quotations.js, delivery_invoices.js)
window._appXhrPost   = xhrPost;
window._appXhrPatch  = xhrPatch;
window._appXhrDelete = xhrDelete;

// ★ Get store logo — ใช้ได้จากทุก module ผ่าน window._appGetLogo()
window._appGetLogo = function() {
  return localStorage.getItem("bsk_store_logo") || "./logo.svg";
};

// ★ Sync logo จาก Supabase Storage → localStorage (เรียกตอน boot)
window._appSyncLogo = async function() {
  try {
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg) return;
    // ลองหาไฟล์โลโก้ใน storage
    const token = window._sbAccessToken || cfg.anonKey;
    const listResp = await fetch(cfg.url + "/storage/v1/object/list/store-assets", {
      method: "POST",
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "logo", limit: 5 })
    });
    if (!listResp.ok) return;
    const files = await listResp.json();
    const logoFile = files.find(f => f.name && f.name.startsWith("logo."));
    if (logoFile) {
      const publicUrl = cfg.url + "/storage/v1/object/public/store-assets/" + logoFile.name + "?t=" + new Date(logoFile.updated_at || logoFile.created_at).getTime();
      const currentLogo = localStorage.getItem("bsk_store_logo") || "";
      // อัปเดตเฉพาะเมื่อยังไม่มี หรือ URL เปลี่ยน
      if (!currentLogo || !currentLogo.startsWith("data:") || localStorage.getItem("bsk_store_logo_url") !== publicUrl) {
        localStorage.setItem("bsk_store_logo", publicUrl);
        localStorage.setItem("bsk_store_logo_url", publicUrl);
        if (typeof updateAppLogos === "function") updateAppLogos();
      }
    }
  } catch(e) { /* offline — ใช้ localStorage cache */ }
};

// ★ Share document function — แชร์เป็น PDF เหมือน FlowAccount
// ใช้ได้จากทุก module ผ่าน window._appShareDoc(elementId, docName)
window._appShareDoc = function(docElementId, docName) {
  document.getElementById("shareOverlay")?.remove();
  const overlay = document.createElement("div");
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
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
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
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
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
  document.body.appendChild(overlay);

  let _canvas = null, _pdfBlob = null, _pdfUrl = null;
  const docEl = document.getElementById(docElementId);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);

  // ── สร้าง PDF ขนาด A4 จริง (ไม่ใช้ responsive) ──
  if (docEl && window.html2canvas && window.jspdf) {
    // สร้าง style tag ชั่วคราวเพื่อ force A4 (ชนะ responsive !important)
    const forceA4Style = document.createElement("style");
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
    document.head.appendChild(forceA4Style);

    const clone = docEl.cloneNode(true);
    clone.classList.add("force-a4-pdf");
    document.body.appendChild(clone);

    html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: "#ffffff", width: 794 }).then(c => {
      document.body.removeChild(clone);
      document.head.removeChild(forceA4Style);
      _canvas = c;
      // Thumbnail
      const thumb = document.getElementById("shareThumbnail");
      if (thumb) { const tc = document.createElement("canvas"); const r = 340/c.width; tc.width=340; tc.height=Math.min(c.height*r,200); tc.getContext("2d").drawImage(c,0,0,tc.width,c.height*r); thumb.innerHTML=""; tc.style.cssText="max-width:100%;border-radius:6px;border:1px solid #e2e8f0"; thumb.appendChild(tc); }
      // PDF A4
      try {
        const { jsPDF } = window.jspdf;
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
        _pdfUrl = URL.createObjectURL(_pdfBlob);
        const statusEl = document.getElementById("shareStatus");
        if (statusEl) { statusEl.textContent = "✓ PDF A4 พร้อมแชร์"; statusEl.style.display = "block"; statusEl.style.color = "#10b981"; setTimeout(() => { statusEl.style.display = "none"; statusEl.style.color = "#64748b"; }, 2000); }
      } catch(e) { console.warn("PDF creation failed:", e); }
    }).catch(() => { try { document.body.removeChild(clone); document.getElementById("forceA4Style")?.remove(); } catch(e){} });
  }

  const close = () => { if (_pdfUrl) URL.revokeObjectURL(_pdfUrl); overlay.remove(); };
  document.getElementById("shareCloseBtn")?.addEventListener("click", close);
  overlay.addEventListener("click", e => { if(e.target===overlay) close(); });

  const setStatus = m => { const el=document.getElementById("shareStatus"); if(el){el.textContent=m;el.style.display="block";el.style.color="#64748b";setTimeout(()=>el.style.display="none",4000);} };

  // ── Helper: ดาวน์โหลด PDF ──
  const dlPdf = () => { if(!_pdfUrl){setStatus("กำลังสร้าง PDF รอสักครู่..."); return false;} const a=document.createElement("a");a.download=docName+".pdf";a.href=_pdfUrl;a.click(); return true; };
  // ── Helper: ดาวน์โหลดรูป ──
  const dlImg = () => { if(!_canvas) return; const a=document.createElement("a");a.download=docName+".png";a.href=_canvas.toDataURL("image/png");a.click(); };
  // ── Helper: สร้าง PDF File สำหรับ native share ──
  const getPdfFile = () => { if(!_pdfBlob) return null; return new File([_pdfBlob], docName+".pdf", {type:"application/pdf"}); };

  overlay.querySelectorAll(".share-opt").forEach(btn => {
    btn.addEventListener("mouseenter", ()=>btn.style.background="#f1f5f9");
    btn.addEventListener("mouseleave", ()=>btn.style.background="#fff");
    btn.addEventListener("click", async () => {
      const t = btn.dataset.sh;

      // ── LINE / Facebook / แชร์อื่นๆ → ส่ง PDF ผ่าน native share ──
      if (t==="line"||t==="fb"||t==="native") {
        const appName = {line:"LINE",fb:"Messenger",native:"แอปอื่น"}[t];
        if (!_pdfBlob) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        const pdfFile = getPdfFile();
        let shared = false;
        // มือถือ: ใช้ native share ส่ง PDF ตรง
        if (isMobile && pdfFile && navigator.canShare && navigator.canShare({title:docName,files:[pdfFile]})) {
          try { await navigator.share({title:docName+" — บุญสุข อิเล็กทรอนิกส์",text:"เอกสาร "+docName,files:[pdfFile]}); setStatus("📤 แชร์ PDF สำเร็จ!"); shared=true; } catch(e){ if(e.name==="AbortError") shared=true; }
        }
        // Desktop: เปิด PDF ในแท็บใหม่ + เปิดแอป
        if (!shared) {
          // เปิด PDF ในแท็บใหม่ (ไม่ขึ้น Save As)
          if (_pdfUrl) window.open(_pdfUrl, "_blank");
          // เปิดแอปที่เลือก
          if (t==="line") {
            setStatus("📄 เปิด PDF แล้ว — ลากไฟล์ไปวางใน LINE หรือกดดาวน์โหลดแล้วแนบ");
          } else if (t==="fb") {
            window.open("https://www.messenger.com/", "_blank");
            setStatus("📄 เปิด PDF + Messenger แล้ว — แนบไฟล์ส่งได้เลย");
          } else {
            setStatus("📄 เปิด PDF แล้ว — กดดาวน์โหลดแล้วส่งต่อได้เลย");
          }
        }
      }
      // ── Email → เปิด PDF + เปิด mailto ──
      else if (t==="email") {
        if (_pdfUrl) window.open(_pdfUrl, "_blank");
        const s=encodeURIComponent("เอกสาร "+docName+" — บุญสุข อิเล็กทรอนิกส์");
        const b=encodeURIComponent("สวัสดีครับ/ค่ะ\n\nส่งเอกสาร "+docName+" มาให้ (ไฟล์ PDF แนบ)\n\nขอบคุณครับ/ค่ะ\nบุญสุข อิเล็กทรอนิกส์");
        window.open("mailto:?subject="+s+"&body="+b);
        setStatus("📄 เปิด PDF + Email แล้ว — ดาวน์โหลดแล้วแนบไฟล์ได้เลย");
      }
      // ── บันทึก PDF ──
      else if (t==="pdf") {
        if (!_pdfUrl) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        if (isMobile) { dlPdf(); } else { window.open(_pdfUrl, "_blank"); }
        setStatus("📄 เปิด PDF แล้ว ✓");
      }
      // ── บันทึกรูป ──
      else if (t==="save") { dlImg(); setStatus("📥 บันทึกรูปแล้ว ✓"); }
      // ── คัดลอกรูป ──
      else if (t==="copy") { if(!_canvas) return; try{_canvas.toBlob(async b=>{await navigator.clipboard.write([new ClipboardItem({"image/png":b})]);setStatus("📋 คัดลอกรูปแล้ว — วางใน LINE/Chat ได้เลย ✓");},"image/png");}catch(e){dlImg();setStatus("บันทึกรูปแทนแล้ว");} }
      // ── พิมพ์ ──
      else if (t==="print") {
        if (!_pdfUrl) { setStatus("กำลังสร้าง PDF รอสักครู่..."); return; }
        const w = window.open(_pdfUrl, "_blank");
        if (w) { setTimeout(() => { try { w.print(); } catch(e){} }, 800); }
        setStatus("🖨️ เปิดหน้าพิมพ์แล้ว");
      }
    });
  });
};

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
const state = {
  supabase: null,
  currentUser: null,
  profile: null,
  products: [],
  sales: [],
  customers: [],
  quotations: [],
  serviceJobs: [],
  deliveryInvoices: [],
  receipts: [],
  cart: JSON.parse(localStorage.getItem("bsk_cart_v2") || "[]"),
  lastReceipt: JSON.parse(localStorage.getItem("bsk_last_receipt") || "null"),
  storeInfo: JSON.parse(localStorage.getItem("bsk_store_info") || '{"name":"ร้านบุญสุขอิเล็กทรอนิกส์","phone":"0862613829","email":"gangboo@gmail.com","address":"87 ม.12 ต.คาลาแมะ อ.ศีขรภูมิ จ.สุรินทร์ 32110","taxId":""}'),
  paymentInfo: (() => {
    const raw = JSON.parse(localStorage.getItem("bsk_payment_info") || '{"banks":[],"promptPay":""}');
    // ★ Migrate: ถ้ายังเป็น format เดิม (มี bankName) ให้ย้ายเข้า banks[]
    if (!raw.banks) {
      const bank = { bankCode: raw.bankCode||"", bankName: raw.bankName||"", bankAccount: raw.bankAccount||"", bankHolder: raw.bankHolder||"", bankBranch: raw.bankBranch||"" };
      raw.banks = (bank.bankName || bank.bankAccount) ? [bank] : [];
      raw.promptPay = raw.promptPay || "";
      raw.qrImage = raw.qrImage || null;
    }
    return raw;
  })(),
  currentRoute: "dashboard",
  editingProductId: null,
  editingCustomerId: null,
  editingQuotationId: null,
  editingServiceJobId: null,
  allProfiles: [],
  warehouses: [],
  warehouseStock: [],
  expenses: [],
  stockMovements: [],
  loyaltyPoints: [],
  loyaltySettings: null,
  permissions: [],
  lineNotifySettings: null
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));

// ═══ Phase 5: Utility Functions (2/4/2569) ═══

// ★ XSS Protection — escapeHtml
function escapeHtml(str) {
  if (str == null) return "";
  const s = String(str);
  const map = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" };
  return s.replace(/[&<>"']/g, c => map[c]);
}

// ★ Format helpers (Thai locale)
function formatNumber(n) { return new Intl.NumberFormat("th-TH").format(Number(n || 0)); }
function formatCurrency(n) { return money(n); }
function formatDate(d, opts) {
  if (!d) return "-";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "-";
  return date.toLocaleDateString("th-TH", opts || { year:"numeric", month:"short", day:"numeric" });
}
function formatDateTime(d) {
  if (!d) return "-";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "-";
  return date.toLocaleString("th-TH", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ★ Form utilities
function getFormData(formOrIds) {
  const data = {};
  if (Array.isArray(formOrIds)) {
    formOrIds.forEach(id => { const el = $(id); if (el) data[id] = el.type === "checkbox" ? el.checked : el.value.trim(); });
  } else if (formOrIds instanceof HTMLFormElement) {
    new FormData(formOrIds).forEach((v, k) => { data[k] = typeof v === "string" ? v.trim() : v; });
  }
  return data;
}

function validateForm(fields) {
  // fields = [{ id, required, pattern, minLength, message }]
  for (const f of fields) {
    const el = $(f.id);
    if (!el) continue;
    const val = el.value.trim();
    el.classList.remove("input-error");
    if (f.required && !val) {
      el.classList.add("input-error");
      el.focus();
      showToast(f.message || `กรุณากรอก ${el.placeholder || f.id}`);
      return false;
    }
    if (f.pattern && val && !new RegExp(f.pattern).test(val)) {
      el.classList.add("input-error");
      el.focus();
      showToast(f.message || `รูปแบบไม่ถูกต้อง: ${el.placeholder || f.id}`);
      return false;
    }
    if (f.minLength && val.length < f.minLength) {
      el.classList.add("input-error");
      el.focus();
      showToast(f.message || `ต้องมีอย่างน้อย ${f.minLength} ตัวอักษร`);
      return false;
    }
  }
  return true;
}

function clearForm(ids) {
  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.classList.remove("input-error");
    if (el.type === "checkbox") el.checked = false;
    else if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  });
}

// ★ Animation utilities
function fadeIn(el, ms = 250) {
  if (typeof el === "string") el = $(el);
  if (!el) return;
  el.style.opacity = "0";
  el.classList.remove("hidden");
  el.style.transition = `opacity ${ms}ms ease`;
  requestAnimationFrame(() => { el.style.opacity = "1"; });
}
function fadeOut(el, ms = 250) {
  if (typeof el === "string") el = $(el);
  if (!el) return;
  el.style.transition = `opacity ${ms}ms ease`;
  el.style.opacity = "0";
  setTimeout(() => { el.classList.add("hidden"); el.style.opacity = ""; el.style.transition = ""; }, ms);
}

// ★ throttle utility — จำกัดความถี่ของ function calls
function throttle(fn, ms = 300) {
  let last = 0;
  return function(...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}

// ★ showLoading — Reference counting สำหรับ nested loading
let _loadingRef = 0;
function showLoading(text) {
  _loadingRef++;
  const overlay = $("loadingOverlay");
  if (overlay) {
    overlay.classList.remove("fade-out");
    overlay.style.display = "";
    const txt = overlay.querySelector(".loading-text");
    if (txt && text) txt.textContent = text;
  }
}
function hideLoading() {
  _loadingRef = Math.max(0, _loadingRef - 1);
  if (_loadingRef === 0) {
    const overlay = $("loadingOverlay");
    if (overlay) { overlay.classList.add("fade-out"); setTimeout(() => { if (_loadingRef === 0 && overlay.parentNode) overlay.style.display = "none"; }, 500); }
  }
}

// ★ confirmAsync — Promise wrapper for showConfirmModal (use with await)
function confirmAsync(message) {
  return new Promise(resolve => {
    showConfirmModal(message, () => resolve(true), () => resolve(false));
  });
}

// ★ showConfirmModal — ARIA accessible confirm dialog (replaces native confirm())
function showConfirmModal(message, onConfirm, onCancel) {
  // Remove existing modal
  document.getElementById("bskConfirmModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "bskConfirmModal";
  modal.className = "confirm-overlay";
  modal.setAttribute("role", "alertdialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "ยืนยัน");
  modal.innerHTML = `
    <div class="confirm-card">
      <p class="confirm-msg">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn light confirm-cancel" aria-label="ยกเลิก">ยกเลิก</button>
        <button class="btn btn-primary confirm-ok" aria-label="ยืนยัน">ยืนยัน</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const okBtn = modal.querySelector(".confirm-ok");
  const cancelBtn = modal.querySelector(".confirm-cancel");
  const previousFocus = document.activeElement;

  function close(result) {
    modal.remove();
    previousFocus?.focus();
    if (result && onConfirm) onConfirm();
    else if (!result && onCancel) onCancel();
  }

  okBtn.addEventListener("click", () => close(true));
  cancelBtn.addEventListener("click", () => close(false));
  modal.addEventListener("click", e => { if (e.target === modal) close(false); });
  document.addEventListener("keydown", function handler(e) {
    if (e.key === "Escape") { document.removeEventListener("keydown", handler); close(false); }
  });

  // Focus trap
  okBtn.focus();
  modal.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      const focusable = [cancelBtn, okBtn];
      const idx = focusable.indexOf(document.activeElement);
      if (e.shiftKey) { if (idx <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus(); } }
      else { if (idx >= focusable.length - 1) { e.preventDefault(); focusable[0].focus(); } }
    }
  });
}

// ═══ DARK MODE ═══
function initDarkMode() {
  const saved = localStorage.getItem("bsk_dark_mode");
  if (saved === "true") applyDarkMode(true);
  const toggle = $("darkModeToggle");
  if (toggle) {
    toggle.checked = saved === "true";
    toggle.addEventListener("change", () => {
      applyDarkMode(toggle.checked);
      localStorage.setItem("bsk_dark_mode", toggle.checked);
    });
  }
}
function applyDarkMode(on) {
  document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  const knob = $("darkModeKnob");
  const track = $("darkModeTrack");
  if (knob) knob.style.transform = on ? "translateX(20px)" : "translateX(0)";
  if (track) track.style.background = on ? "#0ea5e9" : "#475569";
}

function saveCart(){ localStorage.setItem("bsk_cart_v2", JSON.stringify(state.cart)); }
function saveReceipt(){ localStorage.setItem("bsk_last_receipt", JSON.stringify(state.lastReceipt)); }
async function saveStoreInfo(data = null) {
  if (data) {
    state.storeInfo = { ...state.storeInfo, ...data };
  }
  // ✅ Save to localStorage (primary storage — synchronous, always succeeds)
  localStorage.setItem("bsk_store_info", JSON.stringify(state.storeInfo));

  // 🔄 Try Supabase (optional, 3s timeout so UI never hangs on stalled network/RLS)
  if (!state.supabase) return;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("supabase timeout")), 3000));
    const save = state.supabase
      .from('app_settings')
      .upsert({ key: 'store_info', value: state.storeInfo }, { onConflict: 'key' });
    const { error } = await Promise.race([save, timeout]);
    if (error) console.warn('Supabase save warning:', error);
  } catch (err) {
    // Don't throw - localStorage already saved ✓
    console.warn('Supabase save failed (using localStorage):', err?.message || err);
  }
}
// ★ savePaymentInfo — sync ทั้ง localStorage + Supabase (เหมือน saveStoreInfo)
async function savePaymentInfo() {
  localStorage.setItem("bsk_payment_info", JSON.stringify(state.paymentInfo));
  if (!state.supabase) return;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("supabase timeout")), 3000));
    const save = state.supabase
      .from('app_settings')
      .upsert({ key: 'payment_info', value: state.paymentInfo }, { onConflict: 'key' });
    const { error } = await Promise.race([save, timeout]);
    if (error) console.warn('[savePaymentInfo] Supabase warning:', error.message);
  } catch (err) {
    console.warn('[savePaymentInfo] Supabase failed (localStorage OK):', err?.message || err);
  }
}

// ★ loadAppSettings — ดึง store_info + payment_info จาก Supabase หลัง login
async function loadAppSettings() {
  if (!state.supabase) return;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("supabase timeout")), 4000));
    const fetch = state.supabase.from('app_settings').select('key,value').in('key', ['store_info','payment_info']);
    const { data, error } = await Promise.race([fetch, timeout]);
    if (error) { console.warn('[loadAppSettings] warn:', error.message); return; }
    (data || []).forEach(row => {
      if (row.key === 'store_info' && row.value) {
        state.storeInfo = { ...state.storeInfo, ...row.value };
        localStorage.setItem("bsk_store_info", JSON.stringify(state.storeInfo));
      } else if (row.key === 'payment_info' && row.value) {
        state.paymentInfo = row.value;
        localStorage.setItem("bsk_payment_info", JSON.stringify(state.paymentInfo));
      }
    });
  } catch (err) {
    console.warn('[loadAppSettings] failed (using localStorage):', err?.message || err);
  }
}

// ★ Toast Queue — แสดงเรียงลำดับ ไม่ทับกัน
const _toastQueue = [];
let _toastBusy = false;

function showToast(msg){
  _toastQueue.push(msg);
  if (!_toastBusy) _processToast();
}

function _processToast(){
  const t = $("toast"); if(!t) return;
  if (_toastQueue.length === 0) { _toastBusy = false; return; }
  _toastBusy = true;
  const msg = _toastQueue.shift();
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(_processToast, 200); // รอ animation ปิดก่อนแสดงตัวถัดไป
  }, 1800);
}
function setText(id, text){ const el=$(id); if(el) el.textContent = text; } // ✅ textContent = auto-escape
function setHtml(id, html){ const el=$(id); if(el) el.innerHTML = html; } // ⚠️ ต้อง escapeHtml() dynamic data ก่อนส่ง
function setSafeHtml(id, html){ const el=$(id); if(el) el.innerHTML = html; } // alias ชัดเจนว่าผ่าน escapeHtml แล้ว
function isLowStock(product){ return Number(product.stock||0) <= Number(product.min_stock||0); }

// ═══════════════════════════════════════════════════════════
//  ROLE-BASED ACCESS CONTROL (4 กลุ่ม)
// ═══════════════════════════════════════════════════════════
const ALL_ROUTES = ["dashboard","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","service_jobs","settings","expenses","profit_report","stock_movements","calendar","loyalty","customer_dashboard","btu_calculator","service_request","solar","ac_install","error_codes","ai_sales","ac_shop"];
const ROLE_PAGES = {
  admin:      ALL_ROUTES,
  technician: ["dashboard","pos","service_jobs","customers","receipts","calendar","btu_calculator","solar","ac_install","error_codes","ai_sales","ac_shop"],
  sales:      ["dashboard","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","settings","expenses","profit_report","stock_movements","calendar","loyalty","btu_calculator","solar","ac_install","error_codes","ai_sales","ac_shop"],
  customer:   ["customer_dashboard","btu_calculator","service_request","error_codes","ai_sales","ac_shop"]
};
const ROLE_LABELS = {
  admin: "ผู้ดูแลระบบ",
  technician: "ช่าง",
  sales: "พนักงานขาย",
  customer: "ลูกค้า"
};
function currentRole(){ return state.profile?.role || "sales"; }
function allowedPages(){ return ROLE_PAGES[currentRole()] || []; }
function canAccessPage(page){ return allowedPages().includes(page); }
function requireAdmin(){ return currentRole() === "admin"; }
function requireAdminOrSales(){ return ["admin","sales"].includes(currentRole()); }

// ═══════════════════════════════════════════════════════════
//  NAVIGATION / ROUTER
// ═══════════════════════════════════════════════════════════
// ═══ Warehouse route → filter name mapping ═══
const WH_ROUTE_MAP = {
  wh_kunkhao: "คันขาว",
  wh_kundaeng: "คันแดง",
  wh_sikhon: "ศีขร"
};

// ═══ Route → parent group mapping (for auto-open sidebar groups) ═══
const ROUTE_GROUP = {
  quotations: "sales", delivery_invoices: "sales", receipts: "sales", sales: "sales",
  service_jobs: "service", solar: "service", ac_install: "service",
  products: "products", wh_kunkhao: "products", wh_kundaeng: "products", wh_sikhon: "products",
  expenses: "finance", profit_report: "finance"
};

function showRoute(route){
  // Role-based access control
  if (!canAccessPage(route)) {
    const fallback = allowedPages()[0] || "dashboard";
    if (route !== fallback) {
      showToast("คุณไม่มีสิทธิ์เข้าหน้านี้");
      showRoute(fallback);
      return;
    }
  }

  state.currentRoute = route;

  // ★ บันทึก route ล่าสุดไว้ใน localStorage + URL hash เพื่อกดรีเฟรชแล้วอยู่หน้าเดิม
  try { localStorage.setItem("bsk_last_route", route); } catch(e){}
  if (history.replaceState) {
    history.replaceState(null, "", "#" + route);
  } else {
    location.hash = route;
  }

  // Toggle page sections
  ALL_ROUTES.forEach(name => {
    const page = $("page-" + name);
    if (page) page.classList.toggle("hidden", name !== route);
  });

  // Update nav button active states
  document.querySelectorAll(".nav-btn[data-route]").forEach(btn => btn.classList.toggle("active", btn.dataset.route === route));
  document.querySelectorAll(".mobile-nav-btn[data-route]").forEach(btn => btn.classList.toggle("active", btn.dataset.route === route));

  // Auto-open the parent group in sidebar
  const parentGroup = ROUTE_GROUP[route];
  document.querySelectorAll(".nav-group").forEach(g => {
    if (g.dataset.group === parentGroup) g.classList.add("open");
  });

  // Page titles
  const titles = {
    dashboard:"ภาพรวมบริษัท", pos:"แคชเชียร์",
    products:"สินค้า / คลัง", wh_kunkhao:"คันขาว", wh_kundaeng:"คันแดง", wh_sikhon:"ศีขร",
    sales:"รายการขาย POS", delivery_invoices:"ใบส่งสินค้า / ใบแจ้งหนี้",
    receipts:"ใบเสร็จรับเงิน",
    customers:"ลูกค้า", quotations:"ใบเสนอราคา",
    service_jobs:"ใบรับงาน", settings:"ตั้งค่า",
    expenses:"รายรับ-รายจ่าย", profit_report:"รายงานกำไรขั้นต้น",
    stock_movements:"ประวัติเคลื่อนไหวสต็อก", calendar:"ปฏิทินงานช่าง",
    loyalty:"สะสมแต้ม",
    customer_dashboard:"หน้าหลัก",
    btu_calculator:"คำนวณ BTU",
    service_request:"แจ้งซ่อม/บริการ",
    solar:"งานโซล่าเซลล์",
    ac_install:"ใบงานติดตั้งแอร์",
    error_codes:"Error Code แอร์",
    ai_sales:"AI ผู้ช่วยขายแอร์",
    ac_shop:"แอร์ใหม่พร้อมติดตั้ง"
  };
  setText("pageTitle", titles[route] || "Boonsook POS");
  $("sidebar")?.classList.remove("open");

  // Lazy render on navigate
  const ctx = { state, money, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer, showRoute, openCustomerDrawer, openQuotationDrawer, openServiceJobDrawer, loadAllData, loadReceipt, ROLE_LABELS, currentRole, requireAdmin, requireAdminOrSales, showToast, saveStoreInfo, savePaymentInfo, loadUsers, changeRole, openAddUserDrawer, hasPermission: (key) => hasPermission(key, { state, currentRole }), renderLineNotifySettings, renderPermissionMatrix, sendLineNotify };

  if (route === "dashboard") renderDashboard(ctx);
  if (route === "pos") renderPosPage(ctx);
  if (route === "products") renderProductsPage(ctx);
  if (route === "sales") renderSalesPage(ctx);
  if (route === "customers") renderCustomersPage(ctx);
  if (route === "quotations") renderQuotationsPage(ctx);
  if (route === "service_jobs") renderServiceJobsPage(ctx);
  if (route === "settings") renderSettingsPage(ctx);
  if (route === "delivery_invoices") renderDeliveryInvoicesPage(ctx);
  if (route === "receipts") renderReceiptsPage(ctx);
  if (route === "expenses") renderExpensesPage(ctx);
  if (route === "profit_report") renderProfitReportPage(ctx);
  if (route === "stock_movements") renderStockMovementsPage(ctx);
  if (route === "calendar") renderCalendarPage(ctx);
  if (route === "loyalty") renderLoyaltyPage(ctx);
  if (route === "customer_dashboard") renderCustomerDashboard(ctx);
  if (route === "btu_calculator") renderBtuCalculatorPage(ctx);
  if (route === "service_request") renderServiceRequestPage(ctx);
  if (route === "solar") renderSolarPage(ctx);
  if (route === "ac_install") renderAcInstallPage(ctx);
  if (route === "error_codes") renderErrorCodesPage(ctx);
  if (route === "ai_sales") renderAiSalesPage(ctx);
  if (route === "ac_shop") renderAcShopPage(ctx);

  // Warehouse sub-pages — reuse products page with warehouse filter
  if (WH_ROUTE_MAP[route]) {
    renderProductsPage({ ...ctx, warehouseFilter: WH_ROUTE_MAP[route], pageId: "page-" + route });
  }
}

function applyRoleUI(){
  const role = currentRole();
  const roleTh = ROLE_LABELS[role] || role;
  const name = state.profile?.full_name || state.currentUser?.email || "-";

  setText("sideUserName", name);
  setText("sideUserRole", roleTh);

  const allowed = allowedPages();

  // Show/hide sidebar nav buttons (including sub items)
  document.querySelectorAll(".nav-btn[data-route]").forEach(btn => {
    btn.style.display = allowed.includes(btn.dataset.route) ? "" : "none";
  });

  // Show/hide nav groups — hide group if none of its sub items are visible
  document.querySelectorAll(".nav-group").forEach(group => {
    const visibleSubs = group.querySelectorAll(".nav-btn[data-route]");
    const anyVisible = Array.from(visibleSubs).some(btn => allowed.includes(btn.dataset.route));
    group.style.display = anyVisible ? "" : "none";
  });

  // Show/hide mobile nav buttons
  document.querySelectorAll(".mobile-nav-btn[data-route]").forEach(btn => {
    btn.style.display = allowed.includes(btn.dataset.route) ? "" : "none";
  });

  // Quick add buttons — hide if no access
  if ($("quickAddProduct")) $("quickAddProduct").style.display = requireAdminOrSales() ? "" : "none";
  if ($("quickAddCustomer")) $("quickAddCustomer").style.display = requireAdminOrSales() ? "" : "none";
  if ($("quickAddQuotation")) $("quickAddQuotation").style.display = requireAdminOrSales() ? "" : "none";
  if ($("quickAddServiceJob")) $("quickAddServiceJob").style.display = (["admin","technician","sales"].includes(role)) ? "" : "none";
  if ($("quickOpenReceipt")) $("quickOpenReceipt").style.display = requireAdminOrSales() ? "" : "none";
}

// ═══════════════════════════════════════════════════════════
//  DRAWERS
// ═══════════════════════════════════════════════════════════
// ★ Drawer with focus management + aria-hidden
let _drawerPreviousFocus = null;
function openDrawer(id){
  _drawerPreviousFocus = document.activeElement;
  $("backdrop")?.classList.remove("hidden");
  const drawer = $(id);
  if (drawer) {
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    // Focus first input or close button
    const firstFocusable = drawer.querySelector("input:not([type=hidden]), select, textarea, button");
    if (firstFocusable) setTimeout(() => firstFocusable.focus(), 100);
  }
  // Hide main content from screen readers
  $("appShell")?.setAttribute("aria-hidden", "true");
}
function closeAllDrawers(){
  $("backdrop")?.classList.add("hidden");
  ["productDrawer","customerDrawer","serviceJobDrawer","receiptDrawer","addUserDrawer","expenseDrawer"].forEach(id => {
    const el = $(id);
    if (el) { el.classList.add("hidden"); el.setAttribute("aria-hidden", "true"); }
  });
  closeDrawerScanner();
  // Restore main content for screen readers
  $("appShell")?.removeAttribute("aria-hidden");
  // Restore focus
  if (_drawerPreviousFocus) { _drawerPreviousFocus.focus(); _drawerPreviousFocus = null; }
}

// ═══════════════════════════════════════════════════════════
//  AUTH + SUPABASE (เก็บ access token ตอน login)
// ═══════════════════════════════════════════════════════════
async function initSupabase(){
  if (!window.SUPABASE_CONFIG?.url || !window.SUPABASE_CONFIG?.anonKey) {
    setText("authStatus", "ยังไม่ได้ตั้งค่า supabase-config.js");
    return false;
  }
  state.supabase = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

  const { data:{session} } = await state.supabase.auth.getSession();
  if (session?.user) {
    state.currentUser = session.user;
    window._sbAccessToken = session.access_token; // ★ CRITICAL: เก็บ token
    await afterLogin();
  }

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      state.currentUser = session.user;
      window._sbAccessToken = session.access_token; // ★ CRITICAL
      await afterLogin();
    } else {
      state.currentUser = null;
      state.profile = null;
      window._sbAccessToken = null;
      $("authScreen")?.classList.remove("hidden");
      $("appShell")?.classList.add("hidden");
      window.dispatchEvent(new Event("bsk-app-ready"));
    }
  });
  return true;
}

async function login(){
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) return showToast("กรอกอีเมลและรหัสผ่าน");
  // ✅ Save hash before login (in case session is reset)
  const originalHash = window.location.hash;
  try { localStorage.setItem("bsk_login_destination", originalHash); } catch(e){}
  
  setText("authStatus", "กำลังเข้าสู่ระบบ...");
  const { error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) { showToast(error.message || "เข้าสู่ระบบไม่สำเร็จ"); setText("authStatus", "เข้าสู่ระบบไม่สำเร็จ"); }
}
// ═══════════════════════════════════════════════════════════
//  CUSTOMER OTP AUTH — สมัคร/ล็อกอินด้วยเบอร์โทร + OTP จำลอง
// ═══════════════════════════════════════════════════════════
let _pendingOtp = null; // { phone, code, name, expiresAt }

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 หลัก
}

function formatPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(0, 10);
}

async function requestOtp() {
  const name = $("custName")?.value.trim() || "";
  const phone = formatPhone($("custPhone")?.value);
  if (!phone || phone.length < 9) return showToast("กรุณากรอกเบอร์โทรให้ถูกต้อง");

  const statusEl = $("otpStatus");
  statusEl?.classList.remove("hidden");
  setText("otpStatus", "กำลังส่งรหัส OTP...");

  // สร้าง OTP จำลอง
  const code = generateOtp();
  _pendingOtp = { phone, code, name, expiresAt: Date.now() + 5 * 60 * 1000 };

  // ★ Production guard: ห้ามแสดง OTP ผ่าน alert ในโหมด production
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    setTimeout(() => {
      console.info("[DEV OTP]", code, "phone:", phone); showToast("📱 [DEV] OTP: " + code);
    }, 300);
  } else {
    console.info("[OTP] รหัสถูกส่งไปยังเบอร์ " + phone + " แล้ว");
  }

  // บันทึก OTP ลง DB (ถ้ามีตาราง customer_otp)
  try {
    await state.supabase.rpc("create_customer_otp", { p_phone: phone, p_code: code });
  } catch(e) { console.warn("RPC create_customer_otp not available, using local OTP"); }

  // แสดง step 2
  $("otpStep1")?.classList.add("hidden");
  $("otpStep2")?.classList.remove("hidden");
  setText("otpPhoneDisplay", phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"));
  setText("otpStatus", "ส่ง OTP ไปเบอร์ " + phone + " แล้ว (จำลอง)");
  $("otpCode")?.focus();
}

async function verifyOtp() {
  const code = $("otpCode")?.value.trim();
  if (!code || code.length < 4) return showToast("กรุณากรอกรหัส OTP 4 หลัก");

  if (!_pendingOtp) return showToast("กรุณาขอ OTP ใหม่");
  if (Date.now() > _pendingOtp.expiresAt) {
    _pendingOtp = null;
    return showToast("OTP หมดอายุ กรุณาขอใหม่");
  }
  if (code !== _pendingOtp.code) return showToast("รหัส OTP ไม่ถูกต้อง");

  setText("otpStatus", "กำลังเข้าสู่ระบบ...");

  const phone = _pendingOtp.phone;
  const name = _pendingOtp.name;
  const cfg = window.SUPABASE_CONFIG;

  try {
    // ★ ใช้ email จำลองจากเบอร์โทร เช่น 0812345678@phone.boonsook.local
    const fakeEmail = phone + "@phone.boonsook.local";
    const fakePassword = "bsk_" + phone + "_otp";

    // ลอง sign in ก่อน (ถ้าเคยสมัครแล้ว)
    let { error: loginErr } = await state.supabase.auth.signInWithPassword({ email: fakeEmail, password: fakePassword });

    if (loginErr) {
      // ยังไม่มีบัญชี → สมัครใหม่
      const displayName = name || ("ลูกค้า " + phone);
      const { data: authData, error: signUpErr } = await state.supabase.auth.signUp({
        email: fakeEmail,
        password: fakePassword,
        options: { data: { full_name: displayName, role: "customer", phone: phone } }
      });
      if (signUpErr) throw new Error(signUpErr.message);

      const userId = authData?.user?.id;
      if (userId) {
        const token = authData?.session?.access_token || cfg.anonKey;

        // สร้าง profile
        await fetch(`${cfg.url}/rest/v1/profiles`, {
          method: "POST",
          headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer":"return=minimal" },
          body: JSON.stringify({ id: userId, full_name: displayName, role: "customer" })
        });

        // สร้าง customer record
        await fetch(`${cfg.url}/rest/v1/customers`, {
          method: "POST",
          headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer":"return=minimal" },
          body: JSON.stringify({ name: displayName, phone, email: null, note: "สมัครผ่าน OTP เบอร์โทร" })
        });
      }

      // ล็อกอินอีกครั้ง (หลังสมัครเสร็จ)
      await state.supabase.auth.signInWithPassword({ email: fakeEmail, password: fakePassword });
    }

    _pendingOtp = null;
    showToast("เข้าสู่ระบบสำเร็จ! 🎉");
    setText("otpStatus", "เข้าสู่ระบบสำเร็จ!");
    // onAuthStateChange จะ trigger afterLogin() อัตโนมัติ

  } catch(e) {
    setText("otpStatus", "เข้าสู่ระบบไม่สำเร็จ: " + e.message);
    showToast("❌ " + e.message);
  }
}

async function logout(){
  try { await state.supabase.auth.signOut(); } catch(e) { console.warn("signOut error:", e); }
  // ★ Force clear ทุกอย่างแม้ signOut ล้มเหลว
  state.currentUser = null;
  state.profile = null;
  state.cart = []; saveCart();
  window._sbAccessToken = null;
  // ★ ลบ customer cart ด้วย
  try { localStorage.removeItem("bsk_cust_cart"); } catch(e){}
  // ★ Force UI กลับหน้า login
  $("authScreen")?.classList.remove("hidden");
  $("appShell")?.classList.add("hidden");
  // ★ Reset OTP UI กลับสถานะเริ่มต้น
  $("otpStep1")?.classList.remove("hidden");
  $("otpStep2")?.classList.add("hidden");
  if ($("otpCode")) $("otpCode").value = "";
  if ($("custPhone")) $("custPhone").value = "";
  if ($("otpStatus")) { $("otpStatus").textContent = ""; $("otpStatus").classList.add("hidden"); }
  // ★ Reset login form
  if ($("loginEmail")) $("loginEmail").value = "";
  if ($("loginPassword")) $("loginPassword").value = "";
  if ($("loginStatus")) $("loginStatus").textContent = "";
  showToast("ออกจากระบบแล้ว");
}

async function loadProfile(){
  const { data, error } = await state.supabase.from("profiles").select("id, full_name, role").eq("id", state.currentUser.id).single();
  state.profile = error ? { full_name: state.currentUser.email, role: "sales" } : data;
  setText("dbStatus", error ? "เชื่อมต่อแล้ว แต่ไม่พบ profile" : "เชื่อมต่อฐานข้อมูลแล้ว");
}

async function afterLogin(){
  await loadProfile();
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
  applyRoleUI();

  // ✅ Restore hash after login if it was saved
  try {
    const savedHash = localStorage.getItem("bsk_login_destination");
    if (savedHash && savedHash !== "#") {
      localStorage.removeItem("bsk_login_destination");
      window.location.hash = savedHash;
      // Wait for hash to update, then continue
      await new Promise(r => setTimeout(r, 100));
    }
  } catch(e){}

  // ★★★ อ่าน route ที่เก็บไว้ก่อน loadAllData จะ overwrite hash/localStorage ★★★
  const allowed = allowedPages();
  const fullHash = (location.hash || "").replace("#", "");
  // ✅ Extract main route: "settings/store" → "settings"
  const mainRouteFromHash = fullHash.split('/')[0] || "";
  const hashRoute = mainRouteFromHash || fullHash;
  const savedRoute = hashRoute || (function(){ try { return localStorage.getItem("bsk_last_route"); } catch(e){ return null; } })();
  const restorePage = (savedRoute && allowed.includes(savedRoute)) ? savedRoute : (allowed[0] || "dashboard");

  // ★ ตั้ง currentRoute ก่อน loadAllData เพื่อไม่ให้ renderAll() เปลี่ยนกลับไป dashboard
  state.currentRoute = restorePage;

  // ★ Sync settings (store info + payment info) จาก Supabase ก่อน render
  await loadAppSettings();

  await loadAllData();
  // loadAllData → renderAll() → showRoute(state.currentRoute) ซึ่งตอนนี้ = restorePage แล้ว ✅
  window.dispatchEvent(new Event("bsk-app-ready"));
}

// ═══════════════════════════════════════════════════════════
//  DATA LOADING
// ═══════════════════════════════════════════════════════════
let _isLoading = false; // ★ isLoading lock — กัน race condition

async function loadAllData(){
  if (!state.currentUser) return;
  if (_isLoading) return; // ★ ป้องกันกดซ้ำ
  _isLoading = true;

  try {
    // ★ Phase 1: โหลดข้อมูลหลักพร้อมกันด้วย Promise.allSettled (เร็วกว่าเดิม 3-5x)
    const sb = state.supabase;
    const [rProducts, rSales, rCustomers, rQuotations, rServiceJobs, rDeliveryInvoices, rReceipts, rWarehouses, rWhStock] = await Promise.allSettled([
      sb.from("products").select("*").order("id",{ascending:false}),
      sb.from("sales").select("*").order("created_at",{ascending:false}).limit(50),
      sb.from("customers").select("*").order("id",{ascending:false}),
      sb.from("quotations").select("*").order("id",{ascending:false}).limit(50),
      sb.from("service_jobs").select("*").order("id",{ascending:false}).limit(50),
      sb.from("delivery_invoices").select("*").order("id",{ascending:false}).limit(50),
      sb.from("receipts").select("*").order("id",{ascending:false}).limit(50),
      sb.from("warehouses").select("*").order("sort_order",{ascending:true}),
      sb.from("warehouse_stock").select("*")
    ]);

    const val = (r, fallback = []) => r.status === "fulfilled" ? (r.value.data || fallback) : fallback;
    state.products          = val(rProducts);
    state.sales             = val(rSales);
    state.customers         = val(rCustomers);
    state.quotations        = val(rQuotations);
    state.serviceJobs       = val(rServiceJobs);
    state.deliveryInvoices  = val(rDeliveryInvoices);
    state.receipts          = val(rReceipts);
    state.warehouses        = val(rWarehouses);
    state.warehouseStock    = val(rWhStock);

    // ★ Auto-seed warehouses ถ้ายังไม่มี
    if (state.warehouses.length === 0) {
      try {
        const defaultWarehouses = [
          { name: "คันขาว", sort_order: 1 },
          { name: "คันแดง", sort_order: 2 },
          { name: "ศีขร", sort_order: 3 }
        ];
        const { data: inserted, error: whErr } = await sb.from("warehouses").insert(defaultWarehouses).select();
        if (!whErr && inserted) {
          state.warehouses = inserted;
          console.info("[main] Auto-created warehouses:", inserted.map(w => w.name).join(", "));
        } else {
          console.warn("⚠️ Could not auto-create warehouses:", whErr?.message);
        }
      } catch(e) { console.warn("⚠️ Warehouse seed failed:", e.message); }
    }

    // ★ Phase 2: โมดูลเสริม — โหลดพร้อมกัน (ถ้าตารางยังไม่มีก็ไม่พัง)
    const [rExpenses, rStockMov, rLoyalty, rLoySetting, rPerms, rLineNotify] = await Promise.allSettled([
      sb.from("expenses").select("*").order("expense_date",{ascending:false}).limit(200),
      sb.from("stock_movements").select("*").order("created_at",{ascending:false}).limit(200),
      sb.from("loyalty_points").select("*").order("created_at",{ascending:false}).limit(500),
      sb.from("loyalty_settings").select("*").limit(1),
      sb.from("permissions").select("*"),
      sb.from("line_notify_settings").select("*").limit(1)
    ]);

    state.expenses           = val(rExpenses);
    state.stockMovements     = val(rStockMov);
    state.loyaltyPoints      = val(rLoyalty);
    state.loyaltySettings    = (val(rLoySetting))[0] || null;
    state.permissions        = val(rPerms);
    state.lineNotifySettings = (val(rLineNotify))[0] || null;

    // ★ Sync cart with actual stock
    const _negOk = (function(){ try { return JSON.parse(localStorage.getItem("bsk_product_settings") || '{}').allowNegativeStock !== false; } catch(e){ return true; } })();
    state.cart = state.cart.map(item => {
      const p = state.products.find(x => x.id === item.id);
      if (!p) return null;
      const maxStock = Number(p.stock||0);
      return { ...item, maxStock, qty: _negOk ? item.qty : Math.min(item.qty, maxStock) };
    }).filter(Boolean).filter(x => x.qty > 0);
    saveCart();

    // ★ โหลดแคตตาล็อกแอร์ (background)
    try {
      if (!localStorage.getItem("bsk_ac_catalog")) {
        fetch("data/ac_catalog.json").then(r => r.ok ? r.json() : null).then(data => {
          if (data && Array.isArray(data) && data.length > 0) {
            localStorage.setItem("bsk_ac_catalog", JSON.stringify(data));
          }
        }).catch(() => {});
      }
    } catch(e){}

    renderAll();

  } catch(e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (e.message || e));
  } finally {
    _isLoading = false; // ★ ปลดล็อคเสมอ
  }
}

function renderAll(){
  showRoute(state.currentRoute);
}

// ═══════════════════════════════════════════════════════════
//  PRODUCT DRAWER
// ═══════════════════════════════════════════════════════════
function openProductDrawer(product=null){
  if (!requireAdminOrSales()) return showToast("สิทธิ์ไม่พอ");
  state.editingProductId = product?.id || null;
  setText("productDrawerTitle", product ? "แก้ไขสินค้า" : "เพิ่มสินค้า");

  // ★ ตั้งค่าประเภทสินค้า
  const pType = product?.product_type || _detectType(product) || "stock";
  if ($("newProductType")) $("newProductType").value = pType;
  $("newProductName").value = product?.name || "";
  $("newProductSku").value = product?.sku || "";
  $("newProductCategory").value = product?.category || "";
  $("newProductPrice").value = product?.price || "";
  $("newProductCost").value = product?.cost || "";
  $("newProductBarcode").value = product?.barcode || "";

  // ★ Populate datalist หมวดหมู่ — unique categories จาก state.products
  const catList = $("productCategoryList");
  if (catList) {
    const cats = [...new Set(
      (state.products || []).map(p => String(p.category || "").trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "th"));
    catList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  // ★ ซ่อน/แสดง barcode + stock ตามประเภท
  _toggleDrawerSections(pType);

  // ★ สร้าง input สต็อกแยกตามคลัง
  const whContainer = $("warehouseStockInputs");
  if (whContainer) {
    if (state.warehouses.length > 0) {
      whContainer.innerHTML = state.warehouses.map(wh => {
        const ws = state.warehouseStock.find(s => s.product_id === product?.id && s.warehouse_id === wh.id);
        return `
          <div class="wh-stock-row">
            <label class="wh-stock-label">${escapeHtml(wh.name)}</label>
            <div class="wh-stock-inputs">
              <input class="wh-stock-input" data-wh-id="${escapeHtml(wh.id)}" type="number" inputmode="numeric" placeholder="สต็อก" value="${Number(ws?.stock || 0)}" aria-label="สต็อก ${escapeHtml(wh.name)}" />
              <input class="wh-min-stock-input" data-wh-min-id="${escapeHtml(wh.id)}" type="number" inputmode="numeric" placeholder="ขั้นต่ำ" value="${Number(ws?.min_stock || 0)}" aria-label="ขั้นต่ำ ${escapeHtml(wh.name)}" />
            </div>
          </div>
        `;
      }).join("");
    } else {
      whContainer.innerHTML = `
        <div class="wh-stock-row">
          <label class="wh-stock-label">สต็อกรวม</label>
          <div style="display:flex;gap:8px">
            <input id="newProductStock" type="number" inputmode="numeric" placeholder="คงเหลือ" value="${product?.stock || 0}" style="flex:1" />
            <input id="newProductMinStock" type="number" inputmode="numeric" placeholder="ขั้นต่ำ" value="${product?.min_stock || 0}" style="flex:1" />
          </div>
        </div>
      `;
    }
  }

  // แสดง barcode preview ถ้ามีค่า
  if (product?.barcode) { setTimeout(updateBarcodePreview, 100); }
  else { $("drawerBarcodePreview")?.classList.add("hidden"); }

  openDrawer("productDrawer");
}

// ★ จำแนกประเภทจากชื่อ (fallback ถ้า DB ไม่มี product_type)
function _detectType(p) {
  if (!p) return "stock";
  const SERVICE_KW = ["ค่าบริการ", "บริการ", "ค่าเดินทาง", "ค่าแรง", "ค่าติดตั้ง", "ค่ารื้อ", "ค่าซ่อม", "ค่าล้าง"];
  const text = ((p.name||"") + " " + (p.category||"")).toLowerCase();
  if (SERVICE_KW.some(kw => text.includes(kw))) return "service";
  return "stock";
}

// ★ ซ่อน/แสดง sections ตามประเภท
function _toggleDrawerSections(type) {
  // barcode section: ซ่อนสำหรับ บริการ + ไม่นับสต็อก
  const barcodeRow = $("newProductBarcode")?.closest("div[style]");
  const barcodePreview = $("drawerBarcodePreview");
  const scannerArea = $("drawerScannerArea");
  const stockSection = document.querySelector(".wh-stock-section");

  if (type === "service" || type === "non_stock") {
    if (barcodeRow) barcodeRow.style.display = "none";
    if (barcodePreview) barcodePreview.style.display = "none";
    if (scannerArea) scannerArea.style.display = "none";
  } else {
    if (barcodeRow) barcodeRow.style.display = "";
    if (barcodePreview) barcodePreview.style.display = "";
    if (scannerArea) scannerArea.style.display = "";
  }

  // stock section: ซ่อนสำหรับ บริการ
  if (type === "service") {
    if (stockSection) stockSection.style.display = "none";
  } else {
    if (stockSection) stockSection.style.display = "";
  }
}

// ═══════════════════════════════════════════════════════════
//  BARCODE SCANNER ใน Drawer เพิ่มสินค้า
// ═══════════════════════════════════════════════════════════
let _drawerScanner = null;

function openDrawerScanner() {
  const area = $("drawerScannerArea");
  const videoEl = $("drawerScannerVideo");
  const resultEl = $("drawerScannerResult");
  if (!area || !videoEl) return;

  area.classList.remove("hidden");
  videoEl.innerHTML = "";
  if (resultEl) resultEl.innerHTML = "";

  if (typeof Html5Qrcode === "undefined") {
    videoEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8">ไม่พบไลบรารี Scanner</div>';
    return;
  }

  try {
    _drawerScanner = new Html5Qrcode("drawerScannerVideo");
    _drawerScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (code) => {
        // สแกนสำเร็จ → ใส่ค่าบาร์โค้ดในช่อง
        const barcodeInput = $("newProductBarcode");
        if (barcodeInput) barcodeInput.value = code;
        if (resultEl) resultEl.innerHTML = `<span style="color:#10b981;font-weight:600">✓ สแกนได้: ${escapeHtml(code)}</span>`;
        // หยุด scanner หลังสแกนสำเร็จ
        closeDrawerScanner();
        showToast("สแกนบาร์โค้ดสำเร็จ: " + code);
      },
      () => {} // ignore scan errors
    ).catch(err => {
      videoEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8">ไม่สามารถเปิดกล้อง: ${escapeHtml(err.message || err)}</div>`;
    });
  } catch(err) {
    videoEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8">เกิดข้อผิดพลาด: ${escapeHtml(err.message || err)}</div>`;
  }
}

function closeDrawerScanner() {
  if (_drawerScanner) {
    try { _drawerScanner.stop(); } catch(e) {}
    _drawerScanner = null;
  }
  $("drawerScannerArea")?.classList.add("hidden");
}

// ═══════════════════════════════════════════════════════════
//  สร้างบาร์โค้ดอัตโนมัติ
// ═══════════════════════════════════════════════════════════
function generateBarcodeNumber() {
  // สร้าง EAN-13 compatible barcode: 200 (in-store prefix) + 9 digits + check digit
  const prefix = "200";
  const rand = String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 100)).padStart(2, "0");
  const base = prefix + rand; // 12 digits
  // คำนวณ check digit (EAN-13)
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

function genDrawerBarcode() {
  const input = $("newProductBarcode");
  const preview = $("drawerBarcodePreview");
  const svg = $("drawerBarcodeSvg");
  if (!input) return;

  // ถ้ายังไม่มีค่า → สร้างใหม่
  if (!input.value.trim()) {
    input.value = generateBarcodeNumber();
  }

  // แสดง preview
  if (preview && svg && typeof JsBarcode !== "undefined") {
    try {
      JsBarcode(svg, input.value.trim(), {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 8
      });
      preview.classList.remove("hidden");
    } catch(e) {
      preview.classList.add("hidden");
    }
  }
  showToast("สร้างบาร์โค้ด: " + input.value);
}

// อัปเดต preview เมื่อพิมพ์บาร์โค้ดเอง
function updateBarcodePreview() {
  const input = $("newProductBarcode");
  const preview = $("drawerBarcodePreview");
  const svg = $("drawerBarcodeSvg");
  if (!input || !preview || !svg) return;
  const val = input.value.trim();
  if (!val) { preview.classList.add("hidden"); return; }
  if (typeof JsBarcode !== "undefined") {
    try {
      JsBarcode(svg, val, { format: "CODE128", width: 2, height: 60, displayValue: true, fontSize: 14, margin: 8 });
      preview.classList.remove("hidden");
    } catch(e) { preview.classList.add("hidden"); }
  }
}

function resetProductForm(){
  state.editingProductId = null;
  ["newProductName","newProductSku","newProductPrice","newProductCost","newProductBarcode","newProductCategory"].forEach(id => { if($(id)) $(id).value = ""; });
  if ($("newProductType")) $("newProductType").value = "stock";
  _toggleDrawerSections("stock");
  $("drawerBarcodePreview")?.classList.add("hidden");
  const whContainer = $("warehouseStockInputs");
  if (whContainer) whContainer.querySelectorAll("input").forEach(i => i.value = "0");
}
async function saveProduct(){
  if (!requireAdminOrSales()) return showToast("สิทธิ์ไม่พอ");

  // ★ คำนวณสต็อกรวมจากทุกคลัง
  let totalStock = 0;
  let totalMinStock = 0;
  const whStockData = [];
  if (state.warehouses.length > 0) {
    document.querySelectorAll(".wh-stock-input").forEach(inp => {
      const whId = Number(inp.dataset.whId);
      const stock = Number(inp.value || 0);
      const minInp = document.querySelector(`.wh-min-stock-input[data-wh-min-id="${whId}"]`);
      const minStock = Number(minInp?.value || 0);
      totalStock += stock;
      totalMinStock += minStock;
      whStockData.push({ warehouse_id: whId, stock, min_stock: minStock });
    });
  } else {
    totalStock = Number($("newProductStock")?.value || 0);
    totalMinStock = Number($("newProductMinStock")?.value || 0);
  }

  const productType = $("newProductType")?.value || "stock";

  const payload = {
    name:$("newProductName").value.trim(),
    sku:$("newProductSku").value.trim(),
    category:$("newProductCategory")?.value?.trim() || "",
    product_type: productType,
    price:Number($("newProductPrice").value||0),
    cost:Number($("newProductCost").value||0),
    stock: productType === "service" ? 0 : totalStock,
    min_stock: productType === "service" ? 0 : totalMinStock,
    barcode: (productType === "service" || productType === "non_stock") ? "" : $("newProductBarcode").value.trim(),
    is_active:true
  };
  // ★ Validation ชี้จุดชัดเจน
  if (!payload.name) return showToast("กรุณากรอกชื่อสินค้า");
  if (payload.price <= 0) return showToast("กรุณากรอกราคาขาย (ต้องมากกว่า 0)");
  // ★ Auto-gen SKU ถ้าว่าง
  if (!payload.sku) {
    const prefix = productType === "service" ? "SVC" : productType === "non_stock" ? "NS" : "SKU";
    payload.sku = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  }
  showToast("กำลังบันทึก...");

  let productId = state.editingProductId;
  if (productId) {
    const res = await xhrPatch("products", payload, "id", productId);
    if (!res.ok) return showToast(res.error?.message || "บันทึกสินค้าไม่สำเร็จ");
  } else {
    const res = await xhrPost("products", payload, { returnData: true });
    if (!res.ok) return showToast(res.error?.message || "บันทึกสินค้าไม่สำเร็จ");
    productId = res.data?.id;
  }

  // ★ บันทึกสต็อกแยกคลัง
  if (productId && whStockData.length > 0) {
    for (const ws of whStockData) {
      const existing = state.warehouseStock.find(s => s.product_id === productId && s.warehouse_id === ws.warehouse_id);
      if (existing) {
        await xhrPatch("warehouse_stock", { stock: ws.stock, min_stock: ws.min_stock }, "id", existing.id);
      } else {
        await xhrPost("warehouse_stock", { product_id: productId, warehouse_id: ws.warehouse_id, stock: ws.stock, min_stock: ws.min_stock });
      }
    }
  }

  resetProductForm(); closeAllDrawers(); await loadAllData(); showToast("บันทึกสินค้าแล้ว");
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER DRAWER (ใช้ XMLHttpRequest แทน supabase client)
// ═══════════════════════════════════════════════════════════
function openCustomerDrawer(customer=null){
  state.editingCustomerId = customer?.id || null;
  setText("customerDrawerTitle", customer ? "แก้ไขรายชื่อ" : "เพิ่มรายชื่อ");
  $("customerContactType").value = customer?.contact_type || "customer";
  $("customerName").value = customer?.name || "";
  $("customerContactPerson").value = customer?.contact_person || "";
  $("customerPhone").value = customer?.phone || "";
  $("customerEmail").value = customer?.email || "";
  $("customerCompany").value = customer?.company || "";
  $("customerAddress").value = customer?.address || "";
  $("customerTaxId").value = customer?.tax_id || "";
  openDrawer("customerDrawer");
}
async function saveCustomer(){
  const payload = {
    name:$("customerName").value.trim(),
    contact_person:$("customerContactPerson")?.value?.trim() || "",
    phone:$("customerPhone").value.trim(),
    email:$("customerEmail")?.value?.trim() || "",
    company:$("customerCompany").value.trim(),
    address:$("customerAddress").value.trim(),
    tax_id:$("customerTaxId").value.trim(),
    contact_type:$("customerContactType")?.value || "customer"
  };
  if (!payload.name) return showToast("กรอกชื่อลูกค้า");
  showToast("กำลังบันทึก...");

  let res;
  if (state.editingCustomerId) {
    res = await xhrPatch("customers", payload, "id", state.editingCustomerId);
  } else {
    res = await xhrPost("customers", payload);
  }
  if (!res.ok) return showToast(res.error?.message || "บันทึกลูกค้าไม่สำเร็จ");

  closeAllDrawers(); await loadAllData(); showToast("บันทึกลูกค้าแล้ว");
}

// ═══════════════════════════════════════════════════════════
//  QUOTATION — Now handled by quotations.js module
//  openQuotationDrawer just navigates to quotations page form
// ═══════════════════════════════════════════════════════════
function openQuotationDrawer(doc=null){
  // Navigate to quotations page — the module handles the form internally
  showRoute("quotations");
}

// ═══════════════════════════════════════════════════════════
//  SERVICE JOB DRAWER
// ═══════════════════════════════════════════════════════════
function openServiceJobDrawer(job=null){
  state.editingServiceJobId = job?.id || null;
  setText("serviceJobDrawerTitle", job ? "แก้ไขงานช่าง" : "เพิ่มงานช่าง");
  $("serviceCustomer").value = job?.customer_name || "";
  $("servicePhone").value = job?.customer_phone || "";
  $("serviceAddress").value = job?.customer_address || job?.job_address || "";
  $("serviceTitle").value = job?.description || job?.job_title || "";
  $("serviceType").value = job?.job_type || "ac";
  $("serviceStatus").value = job?.status || "pending";
  $("serviceNote").value = job?.note || "";
  openDrawer("serviceJobDrawer");
}
async function saveServiceJob(){
  const descVal = $("serviceTitle").value.trim();
  const payload = {
    customer_name:    $("serviceCustomer").value.trim(),
    customer_phone:   $("servicePhone").value.trim(),
    customer_address: $("serviceAddress").value.trim(),
    description:      descVal,
    job_type:         $("serviceType").value,
    status:           $("serviceStatus").value,
    note:             $("serviceNote").value.trim()
  };
  if (!payload.customer_name || !payload.description) return showToast("กรอกข้อมูลงานช่างให้ครบ");
  let res;
  if (state.editingServiceJobId) {
    res = await xhrPatch("service_jobs", payload, "id", state.editingServiceJobId);
  } else {
    payload.job_no = "JOB-" + Date.now();
    res = await xhrPost("service_jobs", payload);
  }
  if (!res.ok) return showToast(res.error?.message || "บันทึกงานช่างไม่สำเร็จ");
  closeAllDrawers(); await loadAllData(); showToast("บันทึกงานช่างแล้ว");
}

// ═══════════════════════════════════════════════════════════
//  CART + CHECKOUT
// ═══════════════════════════════════════════════════════════
function _allowNegStock(){
  try { return JSON.parse(localStorage.getItem("bsk_product_settings") || '{}').allowNegativeStock !== false; } catch(e){ return true; }
}
function addToCart(productId){
  const p = state.products.find(x=>x.id===productId);
  if (!p) return;
  const allowNeg = _allowNegStock();
  if (!allowNeg && Number(p.stock||0) <= 0) return showToast("สินค้าหมด");
  const found = state.cart.find(x=>x.id===productId);
  if (found) {
    if (!allowNeg && found.qty >= Number(p.stock||0)) return showToast("จำนวนเกินสต๊อก");
    found.qty += 1;
    found.maxStock = Number(p.stock||0);
  } else {
    state.cart.push({ id:p.id, name:p.name, sku:p.sku, price:Number(p.price||0), qty:1, maxStock:Number(p.stock||0) });
  }
  saveCart();
  showRoute(state.currentRoute);
  showToast(`เพิ่ม ${p.name} ลงบิล`);
}
function changeQty(productId, delta){
  const item = state.cart.find(x=>x.id===productId);
  if (!item) return;
  const p = state.products.find(x=>x.id===productId);
  const allowNeg = _allowNegStock();
  const max = Number(p?.stock || item.maxStock || 0);
  item.qty += delta;
  if (!allowNeg && item.qty > max) { item.qty = max; showToast("จำนวนเกินสต๊อก"); }
  if (item.qty <= 0) state.cart = state.cart.filter(x=>x.id!==productId);
  saveCart();
  showRoute(state.currentRoute);
}
function removeFromCart(productId){
  state.cart = state.cart.filter(x=>x.id!==productId);
  saveCart();
  showRoute(state.currentRoute);
}

async function checkout(){
  if (!state.cart.length) return showToast("ยังไม่มีสินค้าในบิล");
  const subtotal = state.cart.reduce((s,i)=>s+i.qty*i.price, 0);
  const paid = Number($("paidAmount")?.value || 0);
  const orderNo = "BSK-" + Date.now();

  // Create sale — ใช้ XHR + returnData เพื่อเอา id กลับ
  const salePayload = {
    order_no: orderNo,
    customer_name: $("saleCustomerName")?.value?.trim() || "ลูกค้าทั่วไป",
    payment_method: $("paymentMethod")?.value || "เงินสด",
    subtotal: subtotal,
    total_amount: subtotal,
    paid_amount: paid,
    change_amount: Math.max(paid - subtotal, 0),
    note: $("saleNote")?.value?.trim() || "",
    created_by: state.currentUser.id
  };
  const saleRes = await xhrPost("sales", salePayload, { returnData: true });
  if (!saleRes.ok) return showToast(saleRes.error?.message || "บันทึกการขายไม่สำเร็จ");

  const saleId = saleRes.data?.id;
  if (!saleId) return showToast("ไม่สามารถดึง ID การขายได้");

  // Create sale items + deduct stock
  // ★ คอลัมน์จริงในตาราง: id(auto), sale_id, product_name, qty, unit_price, line_total
  for (const item of state.cart) {
    const itemPayload = {
      sale_id: saleId,
      product_name: item.name || "สินค้า",
      qty: Number(item.qty) || 1,
      unit_price: Number(item.price) || 0,
      line_total: Number(item.qty || 1) * Number(item.price || 0)
    };
    const itemRes = await xhrPost("sale_items", itemPayload);
    if (!itemRes.ok) {
      console.error("[SALE] sale_items insert failed:", itemRes.error);
      showToast("บันทึกรายการสินค้าไม่สำเร็จ: " + (itemRes.error?.message || "unknown"));
    }
    // หมายเหตุ: deduct_stock RPC ยังไม่มีใน DB — ข้ามไปก่อน
  }

  await loadReceipt(saleId);
  state.cart = [];
  saveCart();
  await loadAllData();
  openReceiptDrawer();
  showToast("บันทึกการขายเรียบร้อย");
}

// ═══════════════════════════════════════════════════════════
//  RECEIPT
// ═══════════════════════════════════════════════════════════
async function loadReceipt(saleId){
  const saleData = await state.supabase.from("sales").select("*").eq("id", saleId).single();
  const itemsData = await state.supabase.from("sale_items").select("*").eq("sale_id", saleId).order("id",{ascending:true});
  if (saleData.error || itemsData.error) return;
  state.lastReceipt = { ...saleData.data, items: itemsData.data || [] };
  saveReceipt();
  renderReceiptDrawer();
}
function openReceiptDrawer(){ renderReceiptDrawer(); openDrawer("receiptDrawer"); }
function renderReceiptDrawer(){
  const si = state.storeInfo;

  // ★ หาธุรกรรมล่าสุดจากทั้ง sales + web orders
  const lastSale = state.lastReceipt;
  const webOrders = (state.serviceJobs || []).filter(j =>
    ((j.sub_service || "").includes("สั่งซื้อ") || (j.note || "").startsWith("SH-")) &&
    !(j.note || "").includes("[ลบแล้ว]")
  );
  const lastWebOrder = webOrders.length > 0 ? webOrders[0] : null; // serviceJobs เรียงจากใหม่->เก่า

  // เปรียบเทียบว่าอันไหนใหม่กว่า
  const saleTime = lastSale ? new Date(lastSale.created_at).getTime() : 0;
  const webTime  = lastWebOrder ? new Date(lastWebOrder.created_at).getTime() : 0;

  if (!lastSale && !lastWebOrder) return setHtml("receiptContent", "ยังไม่มีบิลล่าสุด");

  // ★ ถ้าออเดอร์เว็บใหม่กว่า → แสดงเป็นบิลออเดอร์เว็บ
  if (lastWebOrder && webTime >= saleTime) {
    const j = lastWebOrder;
    const itemLines = ((j.description || "").match(/• .+/g) || []).map(l => l.replace(/^• /, ""));
    const notePayMatch = (j.note || "").match(/^SH-(transfer|cod_cash|cod_transfer)/);
    const payLabels = { transfer: "โอนเงิน", cod_cash: "เงินสดปลายทาง", cod_transfer: "โอนหน้างาน" };
    const payMethod = notePayMatch ? payLabels[notePayMatch[1]] || notePayMatch[1] : "-";
    const statusLabels = { pending: "🟡 รอดำเนินการ", progress: "🔵 กำลังดำเนินการ", done: "🟢 เสร็จแล้ว", delivered: "🟣 ส่งมอบแล้ว", cancelled: "🔴 ยกเลิก" };

    setHtml("receiptContent", `
      <div style="text-align:center;font-size:22px;font-weight:900">${si.name || "บุญสุข อิเล็กทรอนิกส์"}</div>
      <div style="text-align:center;color:#64748b;font-size:13px">${si.address || ""}</div>
      <div style="text-align:center;color:#64748b;font-size:13px">${si.phone ? "โทร: "+si.phone : ""} ${si.taxId ? "• เลขผู้เสียภาษี: "+si.taxId : ""}</div>
      <div style="text-align:center;margin-top:6px"><span style="background:#ecfdf5;color:#059669;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700">🛒 ออเดอร์จากเว็บ</span></div>
      <hr>
      <div class="row"><div>เลขที่</div><div>${j.job_no || "-"}</div></div>
      <div class="row mt16"><div>ลูกค้า</div><div>${j.customer_name || "-"}</div></div>
      <div class="row mt16"><div>เบอร์โทร</div><div>${j.customer_phone || "-"}</div></div>
      <div class="row mt16"><div>ที่อยู่</div><div style="max-width:200px;text-align:right">${j.customer_address || "-"}</div></div>
      <div class="row mt16"><div>ชำระเงิน</div><div>${payMethod}</div></div>
      <div class="row mt16"><div>สถานะ</div><div>${statusLabels[j.status] || j.status || "-"}</div></div>
      <div class="row mt16"><div>เวลา</div><div>${new Date(j.created_at).toLocaleString("th-TH")}</div></div>
      <hr>
      ${itemLines.map(line => `<div class="row mt16"><div style="flex:1">${line}</div></div>`).join("")}
      <hr>
      <div class="row"><div>รวม</div><div style="font-weight:900;font-size:20px">${money(j.total_cost)}</div></div>
    `);
    return;
  }

  // ★ ปกติ: แสดงบิลจาก POS
  setHtml("receiptContent", `
    <div style="text-align:center;font-size:22px;font-weight:900">${si.name || "บุญสุข อิเล็กทรอนิกส์"}</div>
    <div style="text-align:center;color:#64748b;font-size:13px">${si.address || ""}</div>
    <div style="text-align:center;color:#64748b;font-size:13px">${si.phone ? "โทร: "+si.phone : ""} ${si.taxId ? "• เลขผู้เสียภาษี: "+si.taxId : ""}</div>
    <div style="text-align:center;color:#64748b;margin-top:4px">ใบเสร็จอย่างย่อ</div>
    <hr>
    <div class="row"><div>เลขที่บิล</div><div>${lastSale.order_no}</div></div>
    <div class="row mt16"><div>ลูกค้า</div><div>${lastSale.customer_name || "ลูกค้าทั่วไป"}</div></div>
    <div class="row mt16"><div>ชำระเงิน</div><div>${lastSale.payment_method || "-"}</div></div>
    <div class="row mt16"><div>เวลา</div><div>${new Date(lastSale.created_at).toLocaleString("th-TH")}</div></div>
    <hr>
    ${(lastSale.items || []).map(i => `<div class="row mt16"><div>${i.product_name} x ${i.qty}</div><div>${money(i.line_total)}</div></div>`).join("")}
    <hr>
    <div class="row"><div>รวม</div><div style="font-weight:900;font-size:20px">${money(lastSale.total_amount)}</div></div>
    <div class="row mt16"><div>รับเงิน</div><div>${money(lastSale.paid_amount)}</div></div>
    <div class="row mt16"><div>เงินทอน</div><div>${money(lastSale.change_amount)}</div></div>
  `);
}
function printLastReceipt(){
  if (!state.lastReceipt) return showToast("ยังไม่มีบิลล่าสุด");
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>Receipt</title><style>body{font-family:sans-serif;padding:20px}.row{display:flex;justify-content:space-between;margin:4px 0}hr{margin:10px 0}</style></head><body>${$("receiptContent").innerHTML}</body></html>`);
  w.document.close(); w.focus(); w.print();
}
function exportReceiptPdf(){
  if (!state.lastReceipt) return showToast("ยังไม่มีบิลล่าสุด");
  // ใช้ html2canvas จับภาพเพื่อรองรับภาษาไทย
  const el = $("receiptContent");
  if (window.html2canvas) {
    html2canvas(el, { scale: 2, useCORS: true }).then(canvas => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");
      const imgData = canvas.toDataURL("image/png");
      const pdfW = pdf.internal.pageSize.getWidth() - 20;
      const pdfH = (canvas.height * pdfW) / canvas.width;
      pdf.addImage(imgData, "PNG", 10, 10, pdfW, pdfH);
      pdf.save(`${state.lastReceipt.order_no}.pdf`);
    });
  } else {
    // Fallback: jsPDF text only (ภาษาไทยอาจแสดงไม่ได้)
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 15;
    doc.setFontSize(16); doc.text("Boonsook Electronics", 105, y, { align: "center" }); y += 8;
    doc.setFontSize(11); doc.text("Receipt", 105, y, { align: "center" }); y += 10;
    doc.text(`Order: ${state.lastReceipt.order_no}`, 14, y); y += 7;
    (state.lastReceipt.items || []).forEach(item => {
      doc.text(`${item.product_name} x ${item.qty}`, 14, y);
      doc.text(String(item.line_total), 180, y, { align: "right" });
      y += 7;
    });
    y += 5;
    doc.text(`Total: ${money(state.lastReceipt.total_amount)}`, 14, y);
    doc.save(`${state.lastReceipt.order_no}.pdf`);
  }
}

// ═══════════════════════════════════════════════════════════
//  USER MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════
async function loadUsers(){
  if (!requireAdmin()) return;
  // ★ ลอง view ที่มี email ก่อน (ถ้ายังไม่ได้รัน SQL ใหม่ fallback เป็น profiles)
  let result = await state.supabase.from("profiles_with_email").select("*").order("created_at");
  if (result.error) {
    result = await state.supabase.from("profiles").select("*").order("created_at");
  }
  state.allProfiles = result.data || [];
}
async function changeRole(userId, newRole){
  if (!requireAdmin()) return showToast("เฉพาะ Admin เปลี่ยนสิทธิ์ได้");
  const roleName = ROLE_LABELS[newRole] || newRole;
  showConfirmModal(`เปลี่ยนสิทธิ์เป็น "${roleName}"?`, async () => {
    const res = await xhrPatch("profiles", { role: newRole }, "id", userId);
    if (!res.ok) return showToast("เปลี่ยนไม่สำเร็จ");
    await loadUsers();
    showRoute("settings");
    showToast(`เปลี่ยนเป็น ${roleName} แล้ว`);
  });
}
function openAddUserDrawer(){ openDrawer("addUserDrawer"); }
async function addNewUser(){
  if (!requireAdmin()) return showToast("เฉพาะ Admin");
  const email = $("newUserEmail").value.trim();
  const fullName = $("newUserName").value.trim();
  const role = $("newUserRole").value;
  if (!email || !fullName) return showToast("กรุณากรอกอีเมลและชื่อ-นามสกุล");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showToast("อีเมลไม่ถูกต้อง");

  // ★ Auto-generate random password — user จะตั้งใหม่เองผ่านลิงก์ใน email
  const randomPw = Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20) + "A1!";

  const btn = $("addNewUserBtn");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่งคำเชิญ..."; }

  try {
    const cfg = window.SUPABASE_CONFIG;

    const signUpResult = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", cfg.url + "/auth/v1/signup");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.timeout = 15000;
      xhr.onload = function () {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true, userId: body?.id || body?.user?.id, error: null });
          } else {
            resolve({ ok: false, userId: null, error: body?.msg || body?.error_description || body?.message || "HTTP " + xhr.status });
          }
        } catch (e) { resolve({ ok: false, userId: null, error: "Parse error" }); }
      };
      xhr.onerror = function () { resolve({ ok: false, userId: null, error: "Network error" }); };
      xhr.ontimeout = function () { resolve({ ok: false, userId: null, error: "Timeout" }); };
      xhr.send(JSON.stringify({
        email, password: randomPw,
        data: { full_name: fullName }
      }));
    });

    if (!signUpResult.ok) {
      if (/already|registered|duplicate/i.test(signUpResult.error || "")) {
        throw new Error("อีเมลนี้ถูกใช้แล้ว");
      }
      throw new Error(signUpResult.error || "ลงทะเบียนไม่สำเร็จ");
    }

    if (signUpResult.userId && role !== "sales") {
      try { await xhrPatch("profiles", { role, full_name: fullName }, "id", signUpResult.userId); }
      catch(e) { console.warn("[addNewUser] set role failed:", e); }
    }

    // ส่งอีเมลเชิญตั้งรหัสผ่าน
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", cfg.url + "/auth/v1/recover");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.timeout = 10000;
      xhr.onload = () => resolve();
      xhr.onerror = () => resolve();
      xhr.ontimeout = () => resolve();
      xhr.send(JSON.stringify({ email }));
    });

    $("newUserEmail").value = ""; $("newUserName").value = "";
    closeAllDrawers();
    await loadUsers();
    showRoute("settings");
    showToast(`✉️ ส่งคำเชิญไปที่ ${email} แล้ว — ผู้ใช้จะได้รับลิงก์ตั้งรหัสผ่าน`);
  } catch (err) {
    console.error("[addNewUser] error:", err);
    showToast("❌ " + (err.message || "สร้างผู้ใช้ไม่สำเร็จ"));
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "✉️ ส่งคำเชิญทางอีเมล"; }
  }
}

// ═══════════════════════════════════════════════════════════
//  UPDATE / DELETE USER (admin only)
// ═══════════════════════════════════════════════════════════
async function updateUserProfile(userId, patch) {
  if (!requireAdmin()) { showToast("เฉพาะ Admin"); return false; }
  const res = await xhrPatch("profiles", patch, "id", userId);
  if (!res.ok) { showToast("❌ อัปเดตไม่สำเร็จ: " + (res.error?.message || "")); return false; }
  await loadUsers();
  showToast("อัปเดตข้อมูลผู้ใช้เรียบร้อย");
  return true;
}
async function deleteUserProfile(userId, displayName) {
  if (!requireAdmin()) { showToast("เฉพาะ Admin"); return false; }
  if (userId === state.currentUser?.id) { showToast("ลบบัญชีตัวเองไม่ได้"); return false; }
  if (!(await window.App?.confirm?.(`ลบผู้ใช้ "${displayName || userId}"?\n\nหมายเหตุ: บัญชี auth ใน Supabase ยังอยู่ — ต้องลบเพิ่มที่ Supabase Dashboard หากต้องการ`))) return false;
  const res = await xhrDelete("profiles", "id", userId);
  if (!res.ok) { showToast("❌ ลบไม่สำเร็จ: " + (res.error?.message || "")); return false; }
  await loadUsers();
  showToast("ลบผู้ใช้เรียบร้อย");
  return true;
}
window._appUpdateUserProfile = updateUserProfile;
window._appDeleteUserProfile = deleteUserProfile;

// ═══════════════════════════════════════════════════════════
//  GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
// ★ debounce utility — ลด server/render load
function debounce(fn, ms = 300) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

const globalSearchProducts = debounce(function(){
  const q = $("globalSearch")?.value?.trim().toLowerCase() || "";
  if (!q) return showRoute("products");
  const filtered = state.products.filter(p =>
    String(p.name||"").toLowerCase().includes(q) ||
    String(p.sku||"").toLowerCase().includes(q) ||
    String(p.barcode||"").toLowerCase().includes(q)
  );
  const keep = state.products;
  state.products = filtered;
  renderProductsPage({ state, money, addToCart, openProductDrawer });
  state.products = keep;
  showRoute("products");
}, 300); // ★ debounce 300ms

// ═══════════════════════════════════════════════════════════
//  BIND EVENTS
// ═══════════════════════════════════════════════════════════
function bindStaticEvents(){
  $("loginBtn")?.addEventListener("click", login);
  // ═══ Toggle Password Visibility ═══
  const togglePwBtn = $("togglePassword");
  const pwInput = $("loginPassword");
  if(togglePwBtn && pwInput){
    togglePwBtn.addEventListener("click", ()=>{
      const isHidden = pwInput.type === "password";
      pwInput.type = isHidden ? "text" : "password";
      togglePwBtn.textContent = isHidden ? "🙈" : "👁️";
    });
  }
  // ═══ Toggle New User Password Visibility ═══
  const toggleNewPwBtn = $("toggleNewUserPassword");
  const newPwInput = $("newUserPassword");
  if(toggleNewPwBtn && newPwInput){
    toggleNewPwBtn.addEventListener("click", ()=>{
      const isHidden = newPwInput.type === "password";
      newPwInput.type = isHidden ? "text" : "password";
      toggleNewPwBtn.textContent = isHidden ? "🙈" : "👁️";
    });
  }
  // ═══ Customer OTP Auth ═══
  $("requestOtpBtn")?.addEventListener("click", requestOtp);
  $("verifyOtpBtn")?.addEventListener("click", verifyOtp);
  $("resendOtpBtn")?.addEventListener("click", requestOtp);
  $("backToPhoneBtn")?.addEventListener("click", () => {
    $("otpStep1")?.classList.remove("hidden");
    $("otpStep2")?.classList.add("hidden");
    $("otpStatus")?.classList.add("hidden");
    $("otpCode").value = "";
    $("custPhone")?.focus();
  });
  // OTP input: auto-submit เมื่อกรอกครบ 4 หลัก
  $("otpCode")?.addEventListener("input", (e) => {
    if (e.target.value.length >= 4) verifyOtp();
  });
  // เบอร์โทร: กรองเฉพาะตัวเลข
  $("custPhone")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
  });
  $("logoutBtn")?.addEventListener("click", logout);
  $("refreshBtn")?.addEventListener("click", loadAllData);
  $("menuToggle")?.addEventListener("click", () => $("sidebar")?.classList.toggle("open"));
  $("backdrop")?.addEventListener("click", closeAllDrawers);
  document.querySelectorAll("[data-close-drawer]").forEach(btn => btn.addEventListener("click", closeAllDrawers));
  document.querySelectorAll(".nav-btn[data-route], .mobile-nav-btn[data-route]").forEach(btn => btn.addEventListener("click", ()=>showRoute(btn.dataset.route)));

  // ★ รองรับปุ่ม Back/Forward ของ browser
  window.addEventListener("hashchange", () => {
    const hashRoute = (location.hash || "").replace("#", "");
    if (hashRoute && hashRoute !== state.currentRoute && ALL_ROUTES.includes(hashRoute)) {
      showRoute(hashRoute);
    }
  });

  // ═══ Nav Group Toggle (พับ/ขยาย) ═══
  document.querySelectorAll(".nav-group-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const group = toggle.closest(".nav-group");
      if (group) group.classList.toggle("open");
    });
  });
  $("quickAddProduct")?.addEventListener("click", ()=>openProductDrawer());
  $("quickAddCustomer")?.addEventListener("click", ()=>openCustomerDrawer());
  $("quickAddQuotation")?.addEventListener("click", ()=>openQuotationDrawer());
  $("quickAddServiceJob")?.addEventListener("click", ()=>openServiceJobDrawer());
  $("quickOpenReceipt")?.addEventListener("click", ()=>openReceiptDrawer());

  $("saveProductBtn")?.addEventListener("click", saveProduct);
  $("resetProductFormBtn")?.addEventListener("click", resetProductForm);
  $("drawerScanBtn")?.addEventListener("click", openDrawerScanner);
  $("drawerScannerClose")?.addEventListener("click", closeDrawerScanner);
  $("drawerGenBarcodeBtn")?.addEventListener("click", genDrawerBarcode);
  $("newProductBarcode")?.addEventListener("input", updateBarcodePreview);
  $("newProductType")?.addEventListener("change", (e) => _toggleDrawerSections(e.target.value));
  $("saveCustomerBtn")?.addEventListener("click", saveCustomer);
  // ★ saveQuotation now handled inside quotations.js module
  $("saveServiceJobBtn")?.addEventListener("click", saveServiceJob);
  $("printReceiptBtn")?.addEventListener("click", printLastReceipt);
  $("pdfReceiptBtn")?.addEventListener("click", exportReceiptPdf);
  $("addNewUserBtn")?.addEventListener("click", addNewUser);

  $("globalSearch")?.addEventListener("input", globalSearchProducts);
}

// ═══════════════════════════════════════════════════════════
//  WINDOW EXPORTS (สำหรับ onclick ใน HTML ที่สร้างโดย module)
// ═══════════════════════════════════════════════════════════
window.App = {
  showRoute, openProductDrawer, openCustomerDrawer, openQuotationDrawer,
  openServiceJobDrawer, openReceiptDrawer, addToCart, changeQty,
  removeFromCart, loadAllData, renderAll, closeAllDrawers, changeRole,
  openAddUserDrawer, showToast, updateAppLogos,
  // ★ Phase 5: New utilities
  escapeHtml, formatNumber, formatCurrency, formatDate, formatDateTime,
  getFormData, validateForm, clearForm,
  fadeIn, fadeOut, debounce, throttle,
  showLoading, hideLoading, showConfirmModal, confirmAsync,
  confirm: confirmAsync
};

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════

// ★ อัปเดตโลโก้ใน HTML ทุกจุด (sidebar, auth, favicon) จาก localStorage
function updateAppLogos() {
  const logo = window._appGetLogo();
  // Sidebar logo
  const sidebarLogo = document.querySelector(".sidebar-logo-img");
  if (sidebarLogo) sidebarLogo.src = logo;
  // Auth/Login logo
  const authLogo = document.querySelector(".auth-logo-img");
  if (authLogo) authLogo.src = logo;
  // Favicon
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon && logo.startsWith("data:")) favicon.href = logo;
}

(async function boot(){
  initDarkMode();
  bindStaticEvents();
  updateAppLogos();
  const ok = a