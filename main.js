
import { renderDashboard } from "./modules/dashboard.js";
import { renderProductsPage } from "./modules/products.js";
import { renderPosPage, clearPosState } from "./modules/pos.js";
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
import { renderCustomerDashboard, clearCustomerDashboardState } from "./modules/customer_dashboard.js";
import { renderBtuCalculatorPage } from "./modules/btu_calculator.js";
import { renderServiceRequestPage } from "./modules/service_request.js";
import { renderSolarPage } from "./modules/solar.js";
import { renderAcInstallPage } from "./modules/ac_install.js";
import { renderServiceFormPage, SERVICE_TYPES } from "./modules/service_form.js";
import { renderErrorCodesPage } from "./modules/error_codes.js";
import { renderErrorCodesFridgePage } from "./modules/error_codes_fridge.js";
import { renderErrorCodesWasherPage } from "./modules/error_codes_washer.js";
import { renderStockValuePage } from "./modules/stock_value.js";
import { renderDeadStockPage } from "./modules/dead_stock.js";
import { renderStockCountPage } from "./modules/stock_count.js";
import { renderStockInWizardPage } from "./modules/stock_in_wizard.js";
import { renderCashReconPage } from "./modules/cash_recon.js";
import { renderTopCustomersPage } from "./modules/top_customers.js";
import { renderSalesHeatmapPage } from "./modules/sales_heatmap.js";
import { renderRecurringExpensesPage } from "./modules/recurring_expenses.js";
import { renderCreditTrackerPage } from "./modules/credit_tracker.js";
import { renderRefundsPage } from "./modules/refunds.js";
import { renderTasksPage, checkOverdueTasksAndNotify } from "./modules/tasks.js";
import { renderProfitByProductPage } from "./modules/profit_by_product.js";
import { renderBirthdaysPage, checkTodayBirthdaysAndNotify } from "./modules/birthdays.js";
import { renderQuoteTemplatesPage } from "./modules/quote_templates.js";
import { renderSerialsPage } from "./modules/serials.js";
import { renderWarrantyReportPage, checkWarrantyExpiringAndNotify } from "./modules/warranty_report.js";
import { mountHelpButton, setHelpContext } from "./modules/help_tutor.js";
import { renderAiSalesPage } from "./modules/ai_sales.js";
import { renderAcShopPage } from "./modules/ac_shop.js";
import "./modules/doc-override.js";
import { isValidPhone, isValidEmail, getUserFriendlyError, validateFile } from "./modules/validators.js";

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
        // ว่างเปล่า = return=minimal success (ไม่ต้อง parse/warn)
        if (txt && txt.trim()) {
          try { data = JSON.parse(txt); } catch (e) {
            console.warn("[xhrPost] " + table + " JSON.parse failed:", e, txt.slice(0, 200));
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
            console.warn("[xhrPatch] " + table + " JSON.parse failed:", e, txt.slice(0, 200));
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
            console.warn("[xhrPatch] " + table + " error body parse failed:", e, errTxt.slice(0, 200));
          }
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
            console.warn("[xhrDelete] " + table + " error body parse failed:", e, errTxt.slice(0, 200));
          }
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
// ★ Expose validators for modules
window._appValidators = { isValidPhone, isValidEmail, getUserFriendlyError, validateFile };

// ★ Get store logo — ใช้ได้จากทุก module ผ่าน window._appGetLogo()
// Phase 36: priority storeInfo.logoUrl (DB sync) → localStorage (cache) → default
window._appGetLogo = function() {
  return state.storeInfo?.logoUrl
    || localStorage.getItem("bsk_store_logo")
    || "./icons/logo.svg";
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

// ★ Lazy loader สำหรับ html2canvas (~350KB) — โหลดเฉพาะตอนใช้งาน Share/PDF
function _loadHtml2Canvas() {
  return new Promise((resolve) => {
    if (window.html2canvas) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

// ★ Share document function — แชร์เป็น PDF เหมือน FlowAccount
// ใช้ได้จากทุก module ผ่าน window._appShareDoc(elementId, docName)
window._appShareDoc = async function(docElementId, docName) {
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

  // ★ Lazy load html2canvas ก่อนใช้
  await _loadHtml2Canvas();

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

// ★ XSS Protection — escapeHtml (Phase 51: dedup → use shared utils.js)
import { escHtml as escapeHtml } from "./modules/utils.js";

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
//    ช่วยให้ข้อมูลบัญชีธนาคาร + QR มีใน device อื่นที่ login เดียวกัน
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

// ★ loadAppSettings — ดึง store_info + payment_info จาก Supabase (หลัง login)
//    override localStorage ด้วยค่าล่าสุดจาก cloud → สลับ device ได้ข้อมูลตรงกัน
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
        // Phase 36: ถ้ามี logoUrl ใน DB → sync ลง localStorage + อัปเดต UI
        if (state.storeInfo.logoUrl) {
          localStorage.setItem("bsk_store_logo", state.storeInfo.logoUrl);
          try { if (typeof updateAppLogos === "function") updateAppLogos(); } catch(e){}
        }
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
// Phase 45 — Service form routes (9 ประเภทงานช่าง — generic pattern)
const SERVICE_FORM_TYPES = ["repair_ac","clean_ac","move_ac","satellite","repair_fridge","repair_washer","cctv","repair_tv","other"];
const SERVICE_FORM_ROUTES = SERVICE_FORM_TYPES.map(t => "service_" + t);

const ALL_ROUTES = ["dashboard","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","quote_templates","service_jobs","settings","expenses","profit_report","stock_movements","stock_value","dead_stock","stock_count","stock_in_wizard","cash_recon","top_customers","sales_heatmap","recurring_expenses","credit_tracker","refunds","tasks","profit_by_product","birthdays","serials","warranty_report","calendar","loyalty","customer_dashboard","btu_calculator","service_request","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop", ...SERVICE_FORM_ROUTES];
const ROLE_PAGES = {
  admin:      ALL_ROUTES,
  technician: ["customer_dashboard","pos","sales","service_jobs","calendar","btu_calculator","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop", ...SERVICE_FORM_ROUTES],
  sales:      ["dashboard","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","quote_templates","settings","expenses","profit_report","stock_movements","stock_value","dead_stock","stock_count","stock_in_wizard","cash_recon","top_customers","sales_heatmap","recurring_expenses","credit_tracker","refunds","tasks","profit_by_product","birthdays","serials","warranty_report","calendar","loyalty","btu_calculator","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop", ...SERVICE_FORM_ROUTES],
  customer:   ["customer_dashboard","btu_calculator","service_request","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop"]
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
  expenses: "finance", profit_report: "finance",
  // Phase 45 — service forms ทั้งหมดอยู่ในกลุ่ม "service"
  ...Object.fromEntries(SERVICE_FORM_ROUTES.map(r => [r, "service"]))
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
  // ★ รักษา query string ไว้ใน hash (เช่น #products?cat=X&addNew=1)
  //    ถ้า route ตรงกับ hash ปัจจุบัน deep link params จะคงอยู่ให้ page parser อ่านได้
  const curHash = location.hash || "";
  const curMainRoute = (curHash.replace("#","").split('/')[0] || "").split('?')[0];
  const curQuery = curHash.includes("?") ? "?" + curHash.split("?")[1] : "";
  const keepQuery = (curMainRoute === route) ? curQuery : "";
  if (history.replaceState) {
    history.replaceState(null, "", "#" + route + keepQuery);
  } else {
    location.hash = route + keepQuery;
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
    error_codes_fridge:"Error Code ตู้เย็น",
    error_codes_washer:"Error Code เครื่องซักผ้า",
    stock_value:"รายงานมูลค่าสต็อก",
    dead_stock:"รายงานสต็อกค้างนาน",
    stock_count:"นับสต็อกจริง",
    stock_in_wizard:"รับเข้าสินค้า (Wizard)",
    cash_recon:"กระทบยอดเงินสด",
    top_customers:"ลูกค้าซื้อเยอะสุด",
    sales_heatmap:"ยอดขายตามช่วงเวลา",
    recurring_expenses:"รายจ่ายประจำ",
    credit_tracker:"ลูกค้าค้างชำระ",
    refunds:"รับคืนสินค้า",
    tasks:"Task / สิ่งที่ต้องทำ",
    profit_by_product:"กำไรต่อสินค้า",
    birthdays:"วันเกิดลูกค้า",
    serials:"Serial Number Tracking",
    warranty_report:"รายงาน Warranty",
    quote_templates:"Template ใบเสนอราคา",
    ai_sales:"AI ผู้ช่วยขายแอร์",
    ac_shop:"แอร์ใหม่พร้อมติดตั้ง",
    // Phase 45 — service form titles (9 ประเภท)
    ...Object.fromEntries(SERVICE_FORM_TYPES.map(t => ["service_" + t, `${SERVICE_TYPES[t].icon} ใบงาน${SERVICE_TYPES[t].label}`]))
  };
  setText("pageTitle", titles[route] || "Boonsook POS");
  $("sidebar")?.classList.remove("open");

  // Phase 25 — update help tutor context on route change
  try { setHelpContext(route, titles[route] || route); } catch(e){}

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
  // Phase 45 — service form (9 ประเภท: repair_ac, clean_ac, move_ac, satellite, repair_fridge, repair_washer, cctv, repair_tv, other)
  if (SERVICE_FORM_ROUTES.includes(route)) {
    const serviceType = route.replace(/^service_/, "");
    renderServiceFormPage(ctx, serviceType);
  }
  if (route === "error_codes") renderErrorCodesPage(ctx);
  if (route === "error_codes_fridge") renderErrorCodesFridgePage(ctx);
  if (route === "error_codes_washer") renderErrorCodesWasherPage(ctx);
  if (route === "stock_value") renderStockValuePage(ctx);
  if (route === "dead_stock") renderDeadStockPage(ctx);
  if (route === "stock_count") renderStockCountPage(ctx);
  if (route === "stock_in_wizard") renderStockInWizardPage(ctx);
  if (route === "cash_recon") renderCashReconPage(ctx);
  if (route === "top_customers") renderTopCustomersPage(ctx);
  if (route === "sales_heatmap") renderSalesHeatmapPage(ctx);
  if (route === "recurring_expenses") renderRecurringExpensesPage(ctx);
  if (route === "credit_tracker") renderCreditTrackerPage(ctx);
  if (route === "refunds") renderRefundsPage(ctx);
  if (route === "tasks") renderTasksPage(ctx);
  if (route === "profit_by_product") renderProfitByProductPage(ctx);
  if (route === "birthdays") renderBirthdaysPage(ctx);
  if (route === "quote_templates") renderQuoteTemplatesPage(ctx);
  if (route === "serials") renderSerialsPage(ctx);
  if (route === "warranty_report") renderWarrantyReportPage(ctx);
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

  // ★ Detect recovery link (จาก invite email) — ต้องเช็คก่อน getSession
  const isRecovery = /[#&]type=recovery/.test(window.location.hash || "");
  if (isRecovery) state._recoveryMode = true;

  const { data:{session} } = await state.supabase.auth.getSession();
  if (session?.user) {
    state.currentUser = session.user;
    window._sbAccessToken = session.access_token; // ★ CRITICAL: เก็บ token
    if (state._recoveryMode) {
      showSetPasswordScreen();
      window.dispatchEvent(new Event("bsk-app-ready"));
    } else {
      await afterLogin();
    }
  }

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      state.currentUser = session.user;
      window._sbAccessToken = session.access_token; // ★ CRITICAL
      if (_event === "PASSWORD_RECOVERY" || state._recoveryMode) {
        state._recoveryMode = true;
        showSetPasswordScreen();
        window.dispatchEvent(new Event("bsk-app-ready"));
        return;
      }
      await afterLogin();
    } else {
      state.currentUser = null;
      state.profile = null;
      window._sbAccessToken = null;
      $("authScreen")?.classList.remove("hidden");
      $("appShell")?.classList.add("hidden");
      $("setPasswordScreen")?.classList.add("hidden");
      window.dispatchEvent(new Event("bsk-app-ready"));
    }
  });
  return true;
}

// ═══ SET PASSWORD SCREEN (recovery / invite) ═══
function showSetPasswordScreen() {
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.add("hidden");
  $("setPasswordScreen")?.classList.remove("hidden");
  setTimeout(() => $("setPwNew")?.focus(), 50);
}

async function submitNewPassword() {
  const pw = $("setPwNew")?.value || "";
  const pw2 = $("setPwConfirm")?.value || "";
  const statusEl = $("setPasswordStatus");
  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.remove("hidden");
  };
  if (pw.length < 6) { setStatus("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
  if (pw !== pw2) { setStatus("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }

  const btn = $("setPasswordBtn");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    const { error } = await state.supabase.auth.updateUser({ password: pw });
    if (error) throw error;
    // เคลียร์ hash ที่มี access_token ออก
    try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch(e){}
    state._recoveryMode = false;
    $("setPwNew").value = ""; $("setPwConfirm").value = "";
    $("setPasswordScreen")?.classList.add("hidden");
    showToast("ตั้งรหัสผ่านสำเร็จ — เข้าสู่ระบบอัตโนมัติ");
    await afterLogin();
  } catch (err) {
    console.error("[submitNewPassword] error:", err);
    setStatus("บันทึกไม่สำเร็จ: " + (err.message || "ไม่ทราบสาเหตุ"));
    if (btn) { btn.disabled = false; btn.textContent = "บันทึกรหัสผ่าน"; }
  }
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
//  CUSTOMER OTP AUTH — สมัคร/ล็อกอินด้วยเบอร์โทร + SMS OTP จริง (Twilio)
// ═══════════════════════════════════════════════════════════
let _pendingOtp = null; // { phone, name, hash, expiresAt, nonce, attempts }

// ★ สร้าง nonce สุ่ม 32 ตัวอักษร สำหรับผสมใน password (ป้องกันคาดเดา)
function generateNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function formatPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(0, 10);
}

// ★ กำหนด API base URL ตาม environment
function getApiBase() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return ""; // local dev
  // Cloudflare Pages — functions อยู่ที่ path เดียวกัน
  return window.location.origin;
}

async function requestOtp() {
  const name = $("custName")?.value.trim() || "";
  const phone = formatPhone($("custPhone")?.value);
  if (!phone || phone.length < 9) return showToast("กรุณากรอกเบอร์โทรให้ถูกต้อง");

  const statusEl = $("otpStatus");
  statusEl?.classList.remove("hidden");
  setText("otpStatus", "กำลังส่งรหัส OTP ทาง SMS...");

  try {
    const res = await fetch(`${getApiBase()}/api/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "ส่ง SMS ไม่สำเร็จ");
    }

    _pendingOtp = {
      phone,
      name,
      hash: data.hash,
      expiresAt: data.expiresAt,
      authPassword: null,
      attempts: 0
    };

    // แสดง step 2
    $("otpStep1")?.classList.add("hidden");
    $("otpStep2")?.classList.remove("hidden");
    setText("otpPhoneDisplay", phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"));
    // * แสดง OTP บนจอใน dev mode (เมื่อยังไม่ได้ตั้ง Twilio)
    if (data.dev && data.devCode) {
      setText("otpStatus", "[โหมดทดสอบ] รหัส OTP ของคุณคือ " + data.devCode + " (ตั้ง Twilio env vars บน Cloudflare เพื่อส่ง SMS จริง)");
    } else {
      setText("otpStatus", "ส่งรหัส OTP ไปเบอร์ " + phone + " แล้ว (ตรวจสอบ SMS)");
    }
    $("otpCode")?.focus();

  } catch (e) {
    console.error("[OTP] Send error:", e);
    setText("otpStatus", "ส่ง SMS ไม่สำเร็จ: " + e.message);
    showToast("ส่ง SMS ไม่สำเร็จ: " + e.message);
  }
}

async function verifyOtp() {
  const code = $("otpCode")?.value.trim();
  if (!code || code.length < 6) return showToast("กรุณากรอกรหัส OTP 6 หลัก");

  if (!_pendingOtp) return showToast("กรุณาขอ OTP ใหม่");
  if (Date.now() > _pendingOtp.expiresAt) {
    _pendingOtp = null;
    return showToast("OTP หมดอายุ กรุณาขอใหม่");
  }

  // ★ Brute-force protection: จำกัด 5 ครั้งต่อ session
  _pendingOtp.attempts = (_pendingOtp.attempts || 0) + 1;
  if (_pendingOtp.attempts > 5) {
    _pendingOtp = null;
    return showToast("ลองผิดเกินกำหนด กรุณาขอ OTP ใหม่");
  }

  // ★ ตรวจสอบ OTP ผ่าน server (stateless HMAC)
  try {
    const verifyRes = await fetch(`${getApiBase()}/api/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: _pendingOtp.phone,
        code,
        hash: _pendingOtp.hash,
        expiresAt: _pendingOtp.expiresAt
      })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.ok) {
      return showToast(verifyData.error || "รหัส OTP ไม่ถูกต้อง");
    }
    _pendingOtp.authPassword = verifyData.authPassword;
  } catch (e) {
    return showToast("ตรวจสอบ OTP ไม่สำเร็จ: " + e.message);
  }

  setText("otpStatus", "กำลังเข้าสู่ระบบ...");

  const phone = _pendingOtp.phone;
  const name = _pendingOtp.name;
  const cfg = window.SUPABASE_CONFIG;

  try {
    // ★ ใช้ deterministic authPassword จาก server (HMAC+OTP_SECRET) — เบอร์เดียวกัน = password เดิม ลูกค้าเก่า login ซ้ำได้
    const fakeEmail = phone + "@phone.boonsook.local";
    const fakePassword = _pendingOtp.authPassword;
    if (!fakePassword) throw new Error("ไม่ได้รับ authPassword จาก server");

    // ลอง sign in ก่อน
    let { error: loginErr } = await state.supabase.auth.signInWithPassword({ email: fakeEmail, password: fakePassword });

    if (loginErr) {
      // อาจมีบัญชีอยู่แล้วแต่ password (nonce) เปลี่ยน → ลอง update password ก่อน login
      // โดยสมัครใหม่ก่อน ถ้า email ซ้ำ Supabase จะ return error ซึ่งเราจะ updateUser แทน
      const displayName = name || ("ลูกค้า " + phone);
      const { data: authData, error: signUpErr } = await state.supabase.auth.signUp({
        email: fakeEmail,
        password: fakePassword,
        options: { data: { full_name: displayName, role: "customer", phone: phone } }
      });

      if (signUpErr && signUpErr.message?.toLowerCase().includes("already registered")) {
        // ★ มีบัญชีแล้ว → ใช้ admin API reset password (ต้องมี Service Role key ฝั่ง server)
        // Fallback: แจ้งผู้ใช้ให้ติดต่อร้าน (safe ที่สุดในตอนนี้)
        throw new Error("บัญชีนี้สร้างด้วยระบบเก่า — กรุณาติดต่อร้านเพื่อ reset");
      }

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
  // Phase 45.10 (B5-1): clear module state ด้วย (กัน cross-login leak)
  try { clearCustomerDashboardState(); } catch(e){ console.warn("[logout] clearCustomerDashboardState", e); }
  try { clearPosState(); } catch(e){ console.warn("[logout] clearPosState", e); }
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
  } catch(e){ console.warn("[afterLogin] restore hash failed", e); }

  // ★★★ อ่าน route ที่เก็บไว้ก่อน loadAllData จะ overwrite hash/localStorage ★★★
  const allowed = allowedPages();
  const fullHash = (location.hash || "").replace("#", "");
  // ✅ Extract main route: "settings/store" → "settings", "products?cat=X" → "products"
  const mainRouteFromHash = (fullHash.split('/')[0] || "").split('?')[0];
  const hashRoute = mainRouteFromHash || fullHash;
  const savedRoute = hashRoute || (function(){ try { return localStorage.getItem("bsk_last_route"); } catch(e){ return null; } })();
  const restorePage = (savedRoute && allowed.includes(savedRoute)) ? savedRoute : (allowed[0] || "dashboard");

  // ★ ตั้ง currentRoute ก่อน loadAllData เพื่อไม่ให้ renderAll() เปลี่ยนกลับไป dashboard
  state.currentRoute = restorePage;

  // ★ Sync settings (store info + payment info) จาก Supabase ก่อน render
  //    — ช่วยให้ข้อมูลบัญชีธนาคาร + QR + logo มีใน device อื่นที่ login เดียวกัน
  await loadAppSettings();

  await loadAllData();
  // loadAllData → renderAll() → showRoute(state.currentRoute) ซึ่งตอนนี้ = restorePage แล้ว ✅
  window.dispatchEvent(new Event("bsk-app-ready"));

  // ★ Phase 25: mount Help Tutor floating button
  try { mountHelpButton(); } catch(e) { console.warn("[help tutor]", e); }

  // ★ Phase 13 + 15: Background checks (ไม่รอ — ทำใน background)
  setTimeout(() => {
    try { checkOverdueTasksAndNotify(state); } catch(e){ console.warn("[overdue tasks check]", e); }
    try { checkTodayBirthdaysAndNotify(state); } catch(e){ console.warn("[bday check]", e); }
    try { checkWarrantyExpiringAndNotify(state); } catch(e){ console.warn("[warranty check]", e); }
  }, 3000); // หลัง app load 3 วินาทีค่อยเช็ค
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
        }).catch(err => console.warn("[ac_catalog] fetch failed", err));
      }
    } catch(e){ console.warn("[ac_catalog] init failed", e); }

    renderAll();

  } catch(e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (e.message || e));
  } finally {
    _isLoading = false; // ★ ปลดล็อคเสมอ
  }
}

function renderAll(){
  _updateLowStockBadge();
  showRoute(state.currentRoute);
}

// ★ Low Stock Badge ใน sidebar — นับสินค้าที่สต็อก ≤ min_stock (และ > 0 = near / = 0 = out)
function _updateLowStockBadge() {
  const badge = $("navLowStockBadge");
  if (!badge) return;
  const products = (state.products || []).filter(p => {
    const t = p.product_type || _detectType(p);
    return t === "stock"; // นับเฉพาะสินค้านับสต็อกจริง (ไม่รวมบริการ / non-stock)
  });
  const lowOrOut = products.filter(p => {
    const s = Number(p.stock || 0);
    const m = Number(p.min_stock || 0);
    return s <= 0 || (m > 0 && s <= m);
  });
  if (lowOrOut.length === 0) {
    badge.classList.add("hidden");
    badge.textContent = "";
  } else {
    badge.classList.remove("hidden");
    badge.textContent = lowOrOut.length;
    badge.title = `สต็อกใกล้หมด/หมด ${lowOrOut.length} รายการ`;
  }
}

// ═══════════════════════════════════════════════════════════
//  PRODUCT DRAWER
// ═══════════════════════════════════════════════════════════
function openProductDrawer(product=null, opts={}){
  if (!requireAdminOrSales()) return showToast("สิทธิ์ไม่พอ");
  state.editingProductId = product?.id || null;
  setText("productDrawerTitle", product ? "แก้ไขสินค้า" : "เพิ่มสินค้า");

  // ★ ตั้งค่าประเภทสินค้า — รับ prefillType ตอนเปิดสำหรับสินค้าใหม่
  const pType = product?.product_type || _detectType(product) || opts?.prefillType || "stock";
  if ($("newProductType")) $("newProductType").value = pType;
  $("newProductName").value = product?.name || "";
  $("newProductSku").value = product?.sku || "";
  $("newProductCategory").value = product?.category || opts?.prefillCategory || "";
  $("newProductPrice").value = product?.price || "";
  if ($("newProductPriceWholesale")) $("newProductPriceWholesale").value = product?.price_wholesale || "";
  $("newProductCost").value = product?.cost || "";
  $("newProductBarcode").value = product?.barcode || "";

  // ★ Featured + Promo
  if ($("newProductFeatured")) $("newProductFeatured").checked = !!product?.is_featured;
  if ($("newProductPromoPrice")) $("newProductPromoPrice").value = product?.promo_price || "";
  if ($("newProductPromoStart")) $("newProductPromoStart").value = product?.promo_start || "";
  if ($("newProductPromoEnd")) $("newProductPromoEnd").value = product?.promo_end || "";

  // ★ Phase 18: Bundle
  const isBundle = !!product?.is_bundle;
  if ($("newProductIsBundle")) $("newProductIsBundle").checked = isBundle;
  if ($("newProductBundleSection")) $("newProductBundleSection").style.display = isBundle ? "block" : "none";
  // Load bundle children (ถ้าแก้ไข)
  if (product?.id) {
    _loadBundleChildren(product.id);
  } else {
    if ($("bundleItemsValue")) $("bundleItemsValue").value = "[]";
    _renderBundleItems([]);
  }

  // ★ Image preview — ถ้ามี image_url
  const imgUrl = product?.image_url || "";
  if ($("newProductImageUrl")) $("newProductImageUrl").value = imgUrl;
  if ($("newProductImageImg")) {
    if (imgUrl) {
      $("newProductImageImg").src = imgUrl;
      $("newProductImagePreview").style.display = "block";
    } else {
      $("newProductImageImg").src = "";
      $("newProductImagePreview").style.display = "none";
    }
  }

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

  // ★ Recent Activity — เฉพาะตอนแก้ไข (มี product)
  _renderProductRecentActivity(product);

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
  // (เลือกด้วย .barcode-row ตรงๆ — closest("div[style]") เดิมหาไม่เจอเพราะ wrapper ไม่มี inline style)
  const barcodeRow = document.querySelector(".barcode-row");
  const barcodePreview = $("drawerBarcodePreview");
  const scannerArea = $("drawerScannerArea");
  const stockSection = document.querySelector(".wh-stock-section");

  const isNonBarcoded = (type === "service" || type === "non_stock");
  if (barcodeRow) barcodeRow.style.display = isNonBarcoded ? "none" : "";
  if (barcodePreview) {
    if (isNonBarcoded) barcodePreview.style.display = "none";
    else barcodePreview.style.removeProperty("display");
  }
  if (scannerArea) {
    if (isNonBarcoded) scannerArea.style.display = "none";
    else scannerArea.style.removeProperty("display");
  }

  // stock section: ซ่อนสำหรับ บริการ
  if (stockSection) stockSection.style.display = (type === "service") ? "none" : "";
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

// ═══ พิมพ์สติ๊กเกอร์บาร์โค้ดจาก drawer ═══
function printDrawerBarcode() {
  const barcodeInput = $("newProductBarcode");
  const nameInput    = $("newProductName");
  const priceInput   = $("newProductPrice");
  const barcode = (barcodeInput?.value || "").trim();
  const name    = (nameInput?.value || "").trim() || "สินค้า";
  const price   = Number(priceInput?.value || 0);

  if (!barcode) {
    showToast("กรุณาสร้างหรือกรอกบาร์โค้ดก่อน");
    return;
  }

  if (typeof window.openBarcodePrintWindow !== "function") {
    showToast("ฟังก์ชันพิมพ์ยังไม่พร้อม — โหลดหน้าใหม่");
    return;
  }

  window.openBarcodePrintWindow([{ name, barcode, price, qty: 1 }]);
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
  // ★ ราคาส่ง + รูปภาพ (เพิ่มเฉพาะถ้ามี — รองรับ DB ที่ยังไม่มี column)
  const wholesale = Number($("newProductPriceWholesale")?.value || 0);
  if (wholesale > 0) payload.price_wholesale = wholesale;
  const imgUrl = ($("newProductImageUrl")?.value || "").trim();
  if (imgUrl) payload.image_url = imgUrl;
  else if (state.editingProductId) payload.image_url = null; // เคลียร์รูปเมื่อแก้ไขแล้วลบ

  // ★ Featured + Promo
  payload.is_featured = !!$("newProductFeatured")?.checked;
  const promoPrice = Number($("newProductPromoPrice")?.value || 0);
  payload.promo_price = promoPrice > 0 ? promoPrice : null;
  payload.promo_start = $("newProductPromoStart")?.value || null;
  payload.promo_end = $("newProductPromoEnd")?.value || null;

  // ★ Phase 18: Bundle flag
  payload.is_bundle = !!$("newProductIsBundle")?.checked;
  // ★ Validation ชี้จุดชัดเจน
  if (!payload.name) return showToast("กรุณากรอกชื่อสินค้า");
  if (payload.price <= 0) return showToast("กรุณากรอกราคาขาย (ต้องมากกว่า 0)");
  // ★ Auto-gen SKU ถ้าว่าง (เช่น service ที่ไม่ต้องมี SKU)
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

  // ★ Phase 18: Sync bundle children
  if (productId && payload.is_bundle) {
    const bundleItems = _getBundleItems();
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    // 1) DELETE existing children
    await fetch(cfg.url + "/rest/v1/product_bundles?bundle_id=eq." + productId, {
      method: "DELETE",
      headers: { "apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" }
    });
    // 2) INSERT new children
    if (bundleItems.length > 0) {
      const rows = bundleItems.map(it => ({ bundle_id: productId, child_product_id: it.product_id, qty: it.qty }));
      await fetch(cfg.url + "/rest/v1/product_bundles", {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(rows)
      });
    }
  } else if (productId && !payload.is_bundle) {
    // ถ้า uncheck is_bundle → ลบ children ทิ้ง
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    await fetch(cfg.url + "/rest/v1/product_bundles?bundle_id=eq." + productId, {
      method: "DELETE",
      headers: { "apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" }
    });
  }

  // Phase 45.11: optimistic + non-blocking reload (กันค้าง 10-30s)
  try {
    if (state.editingProductId && Array.isArray(state.products)) {
      const idx = state.products.findIndex(p => String(p.id) === String(state.editingProductId));
      if (idx >= 0) state.products[idx] = { ...state.products[idx], ...payload };
    }
  } catch(e) { console.warn("[saveProduct] optimistic", e); }
  resetProductForm();
  closeAllDrawers();
  showToast("บันทึกสินค้าแล้ว");
  if (state.currentRoute === "products") { try { showRoute("products"); } catch(e){} }
  setTimeout(() => loadAllData().catch(e => console.warn("[saveProduct] reload", e)), 100);
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER DRAWER (ใช้ XMLHttpRequest แทน supabase client)
// ═══════════════════════════════════════════════════════════
// ★ Phase 11: Customer Notes & Tags
const CUSTOMER_TAG_PRESETS = [
  { name: "VIP",          icon: "🌟", color: "#f59e0b", desc: "ลูกค้ายอดสูง" },
  { name: "ขายส่ง",        icon: "📦", color: "#0284c7", desc: "ใช้ราคาส่ง" },
  { name: "ห้ามเครดิต",    icon: "🚫", color: "#dc2626", desc: "ไม่ขายเงินเชื่อ" },
  { name: "ลูกค้าราคา",    icon: "💰", color: "#7c3aed", desc: "ขอลดราคาบ่อย" },
  { name: "ประจำ",         icon: "⭐", color: "#10b981", desc: "ลูกค้าประจำ" },
  { name: "ระวัง",         icon: "⚠️", color: "#ef4444", desc: "มีปัญหา ระวัง" }
];

function getCustomerTagMeta(tagName) {
  const found = CUSTOMER_TAG_PRESETS.find(t => t.name === tagName);
  return found || { name: tagName, icon: "🏷️", color: "#64748b", desc: "" };
}
window._appGetCustomerTagMeta = getCustomerTagMeta;

function _renderCustomerTagsActive(tags) {
  const el = $("customerTagsActive");
  if (!el) return;
  if (!tags || tags.length === 0) {
    el.innerHTML = `<span style="font-size:11px;color:#94a3b8">— ยังไม่มี tag —</span>`;
  } else {
    el.innerHTML = tags.map(t => {
      const m = getCustomerTagMeta(t);
      return `<span class="cust-tag-chip" data-t="${escapeHtml(t)}" style="background:${m.color};color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
        ${m.icon} ${escapeHtml(t)}
        <button type="button" class="cust-tag-remove" data-t="${escapeHtml(t)}" style="background:rgba(255,255,255,0.3);border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center">×</button>
      </span>`;
    }).join("");
  }
  if ($("customerTagsValue")) $("customerTagsValue").value = JSON.stringify(tags || []);

  // remove handlers
  el.querySelectorAll(".cust-tag-remove").forEach(btn => btn.addEventListener("click", () => {
    const t = btn.dataset.t;
    const cur = _getCustomerTagsCurrent();
    const next = cur.filter(x => x !== t);
    _renderCustomerTagsActive(next);
    _renderCustomerTagsPresets(next);
  }));
}

function _renderCustomerTagsPresets(activeTags) {
  const el = $("customerTagsPresets");
  if (!el) return;
  const active = new Set(activeTags || []);
  el.innerHTML = CUSTOMER_TAG_PRESETS.map(t => {
    const isActive = active.has(t.name);
    return `<button type="button" class="cust-tag-preset" data-t="${escapeHtml(t.name)}"
              style="padding:4px 10px;border-radius:14px;border:1px solid ${isActive ? t.color : '#cbd5e1'};
                     background:${isActive ? t.color : '#fff'};color:${isActive ? '#fff' : '#475569'};
                     cursor:pointer;font-size:11px;font-weight:600"
              title="${escapeHtml(t.desc)}">
              ${t.icon} ${escapeHtml(t.name)}${isActive ? ' ✓' : ''}
            </button>`;
  }).join("");
  el.querySelectorAll(".cust-tag-preset").forEach(btn => btn.addEventListener("click", () => {
    const t = btn.dataset.t;
    const cur = _getCustomerTagsCurrent();
    const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    _renderCustomerTagsActive(next);
    _renderCustomerTagsPresets(next);
  }));
}

function _getCustomerTagsCurrent() {
  const v = $("customerTagsValue")?.value || "[]";
  try { return JSON.parse(v); } catch(e) { return []; }
}

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
  if ($("customerBirthday")) $("customerBirthday").value = customer?.birthday || "";

  // ★ Phase 11: Notes + Tags
  if ($("customerNotes")) $("customerNotes").value = customer?.notes || "";
  const initialTags = Array.isArray(customer?.tags) ? customer.tags : [];
  _renderCustomerTagsActive(initialTags);
  _renderCustomerTagsPresets(initialTags);

  // Custom tag add handler (bind once per drawer open)
  const tagInp = $("customerTagInput");
  const tagAddBtn = $("customerTagAddBtn");
  const handleAdd = () => {
    const v = (tagInp?.value || "").trim();
    if (!v) return;
    const cur = _getCustomerTagsCurrent();
    if (cur.includes(v)) { showToast(`มี "${v}" อยู่แล้ว`); return; }
    const next = [...cur, v];
    _renderCustomerTagsActive(next);
    _renderCustomerTagsPresets(next);
    if (tagInp) tagInp.value = "";
  };
  if (tagAddBtn) {
    const newBtn = tagAddBtn.cloneNode(true); // clean old listeners
    tagAddBtn.parentNode.replaceChild(newBtn, tagAddBtn);
    newBtn.addEventListener("click", handleAdd);
  }
  if (tagInp) {
    const newInp = tagInp.cloneNode(true);
    tagInp.parentNode.replaceChild(newInp, tagInp);
    newInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
    });
  }

  // ★ แสดงประวัติการซื้อ — เฉพาะเวลาเปิดแก้ไข (มี customer)
  _renderCustomerPurchaseHistory(customer);

  openDrawer("customerDrawer");
}

// ═══════════════════════════════════════════════════════════
//  Phase 18: Bundle / Set helpers
// ═══════════════════════════════════════════════════════════
async function _loadBundleChildren(bundleId) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const res = await fetch(cfg.url + "/rest/v1/product_bundles?bundle_id=eq." + bundleId + "&select=child_product_id,qty", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) { _renderBundleItems([]); return; }
    const rows = await res.json();
    const items = rows.map(r => {
      const p = (state.products || []).find(x => String(x.id) === String(r.child_product_id));
      return { product_id: r.child_product_id, name: p?.name || "(ไม่พบ)", qty: Number(r.qty || 1) };
    });
    if ($("bundleItemsValue")) $("bundleItemsValue").value = JSON.stringify(items);
    _renderBundleItems(items);
  } catch(e) { console.warn("[load bundle]", e); _renderBundleItems([]); }
}

function _getBundleItems() {
  try { return JSON.parse($("bundleItemsValue")?.value || "[]"); } catch(e) { return []; }
}

function _renderBundleItems(items) {
  const el = $("bundleItemsList");
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = `<div style="color:#94a3b8;font-size:12px;text-align:center;padding:8px">— ยังไม่มีรายการในชุด —</div>`;
    return;
  }
  el.innerHTML = items.map((it, idx) => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#f3e8ff;border-radius:6px;font-size:12px">
      <span style="flex:1">${escapeHtml(it.name)}</span>
      <input type="number" class="bd-item-qty" data-idx="${idx}" min="1" value="${it.qty}" style="width:50px;padding:3px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:11px" />
      <button type="button" class="bd-item-del" data-idx="${idx}" style="border:none;background:transparent;cursor:pointer;color:#dc2626;font-size:14px;padding:0 4px">×</button>
    </div>
  `).join("");

  el.querySelectorAll(".bd-item-qty").forEach(inp => inp.addEventListener("input", () => {
    const items = _getBundleItems();
    items[Number(inp.dataset.idx)].qty = Number(inp.value || 1);
    if ($("bundleItemsValue")) $("bundleItemsValue").value = JSON.stringify(items);
  }));
  el.querySelectorAll(".bd-item-del").forEach(btn => btn.addEventListener("click", () => {
    const items = _getBundleItems();
    items.splice(Number(btn.dataset.idx), 1);
    if ($("bundleItemsValue")) $("bundleItemsValue").value = JSON.stringify(items);
    _renderBundleItems(items);
  }));
}

function _renderProductRecentActivity(product) {
  const el = $("productRecentActivity");
  if (!el) return;
  if (!product?.id) { el.classList.add("hidden"); el.innerHTML = ""; return; }

  // Sale items ที่มี product_id ตรงกัน
  const myItems = (state.saleItems || []).filter(it => String(it.product_id) === String(product.id));
  if (myItems.length === 0 && (!state.stockMovements || state.stockMovements.length === 0)) {
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="set-section-title">📊 ประวัติการเคลื่อนไหว</div>
      <div class="card" style="text-align:center;color:#94a3b8;padding:16px;font-size:13px">ยังไม่มีกิจกรรมของสินค้านี้</div>
    `;
    return;
  }

  // Stats: จำนวนขาย + รายได้รวม + กี่ครั้ง (จากเดือนนี้, 30 วันล่าสุด, ปีนี้)
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const last30 = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
  const thisYear = today.slice(0, 4);

  let qtyMonth = 0, revenueMonth = 0;
  let qty30 = 0, revenue30 = 0;
  let qtyYear = 0, revenueYear = 0;
  let totalQty = 0, totalRevenue = 0;
  let lastSaleDate = null;

  myItems.forEach(it => {
    const sale = (state.sales || []).find(s => String(s.id) === String(it.sale_id));
    if (!sale || (sale.note || "").includes("[ลบแล้ว]")) return;
    const saleDate = String(sale.created_at || "").slice(0, 10);
    const qty = Number(it.qty || 0);
    const rev = Number(it.line_total || (qty * Number(it.unit_price || 0)));

    totalQty += qty;
    totalRevenue += rev;
    if (!lastSaleDate || saleDate > lastSaleDate) lastSaleDate = saleDate;

    if (saleDate.slice(0, 7) === thisMonth) { qtyMonth += qty; revenueMonth += rev; }
    if (saleDate >= last30) { qty30 += qty; revenue30 += rev; }
    if (saleDate.slice(0, 4) === thisYear) { qtyYear += qty; revenueYear += rev; }
  });

  // Stock movements ของสินค้านี้ (10 รายการล่าสุด)
  const myMovements = (state.stockMovements || [])
    .filter(m => String(m.product_id) === String(product.id))
    .slice(0, 10);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("th-TH", { year: "2-digit", month: "short", day: "numeric" }) : "-";
  const moneyFmt = (n) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0));
  const typeLabel = { in: "📥 รับเข้า", out: "📤 จ่ายออก", sale: "💰 ขาย", return: "↩️ คืน", adjust: "⚙️ ปรับสต็อก", transfer: "🔄 โอนย้าย" };

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="set-section-title">📊 ประวัติการเคลื่อนไหว</div>
    <div class="card" style="padding:12px;background:#f0f9ff;border-color:#bae6fd">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
        <div>📦 ขาย 30 วัน: <b>${qty30}</b> ชิ้น (฿${moneyFmt(revenue30)})</div>
        <div>📅 เดือนนี้: <b>${qtyMonth}</b> ชิ้น (฿${moneyFmt(revenueMonth)})</div>
        <div>🗓️ ปีนี้: <b>${qtyYear}</b> ชิ้น (฿${moneyFmt(revenueYear)})</div>
        <div>🏆 รวมทั้งหมด: <b>${totalQty}</b> ชิ้น (฿${moneyFmt(totalRevenue)})</div>
        ${lastSaleDate ? `<div style="grid-column:span 2">🕐 ขายล่าสุด: ${fmtDate(lastSaleDate)}</div>` : `<div style="grid-column:span 2;color:#dc2626">⚠️ ยังไม่เคยขาย</div>`}
      </div>
    </div>
    ${myMovements.length > 0 ? `
      <div style="font-size:12px;color:#64748b;margin-top:10px;margin-bottom:6px">การเคลื่อนไหวสต็อก ${myMovements.length} รายการล่าสุด:</div>
      <div style="max-height:240px;overflow-y:auto">
        ${myMovements.map(m => {
          // Phase 45.8: schema fields = type/qty (not movement_type/quantity)
          // before/after embed ใน note field — extract ออกมา (format: "... | 5→4")
          const beforeAfter = String(m.note || "").match(/\|\s*(\d+)→(\d+)\s*$/);
          const ba = beforeAfter ? `${beforeAfter[1]}→${beforeAfter[2]}` : "";
          const cleanNote = String(m.note || "").replace(/\s*\|\s*\d+→\d+\s*$/, "");
          return `
          <div style="padding:8px 10px;background:#fafbfc;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;font-size:12px;display:flex;justify-content:space-between;gap:8px">
            <div>
              <div style="font-weight:600">${typeLabel[m.type] || m.type || "-"}</div>
              <div style="color:#64748b;font-size:11px">${fmtDate(m.created_at)} • ${escapeHtml(cleanNote).slice(0, 60)}</div>
            </div>
            <div style="text-align:right;white-space:nowrap">
              <div style="color:#0f172a;font-weight:700">${m.qty || 0}</div>
              <div style="color:#64748b;font-size:11px">${ba}</div>
            </div>
          </div>
        `;}).join("")}
      </div>
    ` : ''}
  `;
}

function _renderCustomerPurchaseHistory(customer) {
  const el = $("customerPurchaseHistory");
  if (!el) return;
  if (!customer) { el.classList.add("hidden"); el.innerHTML = ""; return; }

  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").replace(/\D/g, "");

  // หา sales ที่ match ลูกค้านี้ — ใช้ customer_id ก่อน, fallback ที่ชื่อ/เบอร์
  const sales = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => {
      // 1) ตรง customer_id (ดีที่สุด — ถ้าตั้ง POS Customer Picker)
      if (s.customer_id && customer.id && String(s.customer_id) === String(customer.id)) return true;
      const sName = String(s.customer_name || "").trim();
      const sNote = String(s.note || "");
      // 2) ตรงชื่อ
      if (name && sName && sName === name) return true;
      // 3) ตรงเบอร์ (ใน note หรือชื่อ)
      if (phone && (sNote.replace(/\D/g, "").includes(phone) || sName.includes(phone))) return true;
      return false;
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 50);

  if (sales.length === 0) {
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="set-section-title">📋 ประวัติการซื้อ</div>
      <div class="card" style="text-align:center;color:#94a3b8;padding:16px;font-size:13px">ยังไม่มีประวัติการซื้อ</div>
    `;
    return;
  }

  const totalSpent = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0);
  const avg = totalSpent / sales.length;
  const firstBuy = sales[sales.length - 1]?.created_at;
  const lastBuy = sales[0]?.created_at;

  const fmtDate = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleDateString("th-TH", { year: "2-digit", month: "short", day: "numeric" });
  };

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="set-section-title">📋 ประวัติการซื้อ (${sales.length} บิล)</div>
    <div class="card" style="padding:12px;background:#f0f9ff;border-color:#bae6fd">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
        <div>💰 <b>ยอดรวม:</b> ฿${totalSpent.toLocaleString("th-TH", {minimumFractionDigits:2})}</div>
        <div>📊 <b>เฉลี่ย/บิล:</b> ฿${avg.toLocaleString("th-TH", {maximumFractionDigits:0})}</div>
        <div>📅 <b>ซื้อครั้งแรก:</b> ${fmtDate(firstBuy)}</div>
        <div>🕐 <b>ล่าสุด:</b> ${fmtDate(lastBuy)}</div>
      </div>
    </div>
    <div style="max-height:260px;overflow-y:auto;margin-top:8px">
      ${sales.map(s => `
        <div class="card" style="padding:10px;margin-bottom:6px;cursor:pointer;border-color:#e5e7eb" data-cust-sale-id="${s.id}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <div>
              <div style="font-weight:700;font-size:13px">${escapeHtml(s.order_no || "-")}</div>
              <div style="font-size:11px;color:#64748b">${fmtDate(s.created_at)} • ${escapeHtml(s.payment_method || "-")}</div>
            </div>
            <div style="font-weight:700;color:#0284c7;font-size:14px">฿${Number(s.total_amount || 0).toLocaleString("th-TH", {minimumFractionDigits:2})}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // คลิกบิลไหน → เปิดใบเสร็จนั้น
  el.querySelectorAll("[data-cust-sale-id]").forEach(card => {
    card.addEventListener("click", async () => {
      const id = card.dataset.custSaleId;
      if (!id) return;
      closeAllDrawers();
      await loadReceipt(id);
      openReceiptDrawer();
    });
  });
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
    contact_type:$("customerContactType")?.value || "customer",
    notes: $("customerNotes")?.value?.trim() || null,
    tags: _getCustomerTagsCurrent(),
    birthday: $("customerBirthday")?.value || null
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

  // Phase 45.11: optimistic + non-blocking reload
  try {
    if (state.editingCustomerId && Array.isArray(state.customers)) {
      const idx = state.customers.findIndex(c => String(c.id) === String(state.editingCustomerId));
      if (idx >= 0) state.customers[idx] = { ...state.customers[idx], ...payload };
    } else if (Array.isArray(res.data) && res.data[0]) {
      state.customers = [res.data[0], ...(state.customers || [])];
    }
  } catch(e) { console.warn("[saveCustomer] optimistic", e); }
  closeAllDrawers();
  showToast("บันทึกลูกค้าแล้ว");
  if (state.currentRoute === "customers") { try { showRoute("customers"); } catch(e){} }
  setTimeout(() => loadAllData().catch(e => console.warn("[saveCustomer] reload", e)), 100);
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
  // ★ เก็บสถานะเดิม ไว้ตรวจการเปลี่ยนเป็น "done" ตอน save
  state.editingServiceJobOrigStatus = job?.status || "pending";
  setText("serviceJobDrawerTitle", job ? "แก้ไขงานช่าง" : "เพิ่มงานช่าง");
  $("serviceCustomer").value = job?.customer_name || "";
  $("servicePhone").value = job?.customer_phone || "";
  $("serviceAddress").value = job?.customer_address || job?.job_address || "";
  $("serviceTitle").value = job?.description || job?.job_title || "";
  $("serviceType").value = job?.job_type || "ac";
  $("serviceStatus").value = job?.status || "pending";
  $("serviceNote").value = job?.note || "";

  // ★ Load before/after photos
  _setServicePhotoPreview("Before", job?.photo_before || "");
  _setServicePhotoPreview("After", job?.photo_after || "");

  openDrawer("serviceJobDrawer");
}

function _setServicePhotoPreview(which, url) {
  const previewEl = $(`service${which}Preview`);
  const urlEl = $(`service${which}Url`);
  if (urlEl) urlEl.value = url || "";
  if (!previewEl) return;
  if (url) {
    previewEl.innerHTML = `<img src="${escapeHtml(url)}" alt="${which}" style="width:100%;height:100%;max-height:160px;object-fit:cover" />`;
  } else {
    previewEl.innerHTML = `<span style="color:#94a3b8;font-size:11px">ยังไม่มีรูป</span>`;
  }
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
    note:             $("serviceNote").value.trim(),
    photo_before:     $("serviceBeforeUrl")?.value?.trim() || null,
    photo_after:      $("serviceAfterUrl")?.value?.trim() || null
  };
  // ★ VALIDATE: ตรวจสอบข้อมูลก่อนส่ง
  if (!payload.customer_name || !payload.description) return showToast("กรอกข้อมูลงานช่างให้ครบ");
  if (payload.customer_phone && !isValidPhone(payload.customer_phone)) {
    return showToast("เบอร์โทรลูกค้าไม่ถูกต้อง (ต้องมี 10 หลักขึ้นไป)");
  }
  let res;
  const isNewJob = !state.editingServiceJobId;
  if (state.editingServiceJobId) {
    res = await xhrPatch("service_jobs", payload, "id", state.editingServiceJobId);
  } else {
    payload.job_no = "JOB-" + Date.now();
    res = await xhrPost("service_jobs", payload);
  }
  if (!res.ok) return showToast(res.error?.message || "บันทึกงานช่างไม่สำเร็จ");

  // Phase 45.9: optimistic update + background reload
  // เดิม `await loadAllData()` block 10-30s ทุกครั้งหลัง save (slow connection อาจถึง 2 นาที)
  try {
    if (state.editingServiceJobId) {
      const idx = (state.serviceJobs || []).findIndex(j => String(j.id) === String(state.editingServiceJobId));
      if (idx >= 0) state.serviceJobs[idx] = { ...state.serviceJobs[idx], ...payload };
    } else if (Array.isArray(res.data) && res.data[0]) {
      state.serviceJobs = [res.data[0], ...(state.serviceJobs || [])];
    }
  } catch(e) { console.warn("[saveServiceJob] optimistic update fail", e); }

  closeAllDrawers();
  showToast("บันทึกงานช่างแล้ว");

  // Re-render service jobs list ทันที (ใช้ state ที่ optimistic update แล้ว)
  try {
    if (state.currentRoute === "service_jobs") showRoute("service_jobs");
  } catch(e){ console.warn("[saveServiceJob] re-render failed", e); }

  // Background full reload — ไม่ block UI
  setTimeout(() => { loadAllData().catch(e => console.warn("[saveServiceJob] reload", e)); }, 100);

  // ★ LINE notify เมื่อสร้างงานใหม่ → กลุ่ม "คิวงาน"
  if (isNewJob) {
    try {
      const msg = "✍️ มีงานเข้าคิวใหม่!\n"
        + "🔧 " + (payload.job_type || "-") + "\n"
        + "👤 " + payload.customer_name + " | 📞 " + (payload.customer_phone || "-") + "\n"
        + "📍 " + (payload.customer_address || "-") + "\n"
        + "⚡ " + (payload.description || "").substring(0, 120) + "\n"
        + "📝 เลขที่: " + payload.job_no;
      sendLineNotify(msg, { state, showToast }, "queue");
    } catch (e) {
      console.warn("LINE notify (new service job) failed:", e);
    }
  }

  // ★ LINE notify เมื่อปิดงาน → กลุ่ม "ส่งงาน"
  // Phase 31 fix: ปิดงานนับ done / delivered / closed (ก่อนหน้าเช็คเฉพาะ "done" → "ส่งมอบแล้ว"/"ลูกค้ายืนยันปิดงาน" ไม่ส่ง LINE)
  const origStatus = state.editingServiceJobOrigStatus;
  const COMPLETION_STATUSES = ["done", "delivered", "closed"];
  const wasComplete = COMPLETION_STATUSES.includes(origStatus);
  const isNowComplete = COMPLETION_STATUSES.includes(payload.status);
  const transitionedToDone = !isNewJob && !wasComplete && isNowComplete;
  if (transitionedToDone) {
    try {
      const STATUS_LABEL = {
        done: "เสร็จแล้ว",
        delivered: "ส่งมอบแล้ว ✓",
        closed: "🎉 ลูกค้ายืนยันปิดงาน"
      };
      const msg = "✅ ปิดงาน — " + (STATUS_LABEL[payload.status] || payload.status) + "\n"
        + "🔧 " + (payload.job_type || "-") + "\n"
        + "👤 " + payload.customer_name + " | 📞 " + (payload.customer_phone || "-") + "\n"
        + "📍 " + (payload.customer_address || "-") + "\n"
        + "⚡ " + (payload.description || "").substring(0, 120) + "\n"
        + (payload.note ? "📝 หมายเหตุ: " + payload.note.substring(0, 120) + "\n" : "")
        + "⏰ " + new Date().toLocaleString("th-TH");
      sendLineNotify(msg, { state, showToast }, "done");
    } catch (e) {
      console.warn("LINE notify (job done) failed:", e);
    }
  }
  // ★ รีเซ็ต orig-status หลังบันทึก
  state.editingServiceJobOrigStatus = null;
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
    // ★ ใช้ราคาโปรโมชั่นถ้าอยู่ในช่วงวัน — ไม่งั้นใช้ราคาปกติ
    const ap = window._appGetActivePrice ? window._appGetActivePrice(p) : { price: Number(p.price||0), isPromo: false };
    state.cart.push({ id:p.id, name:p.name, sku:p.sku, price:ap.price, qty:1, maxStock:Number(p.stock||0) });
    if (ap.isPromo) showToast(`💰 ใช้ราคาโปร ฿${ap.price} (ปกติ ฿${ap.original})`);
  }
  saveCart();
  showRoute(state.currentRoute);
  if (!found) showToast(`เพิ่ม ${p.name} ลงบิล`);
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

// ═══════════════════════════════════════════════════════════
//  STOCK HELPERS — ตัดสต็อก + ย้ายคลัง + log stock_movements
//  ใช้ทั้งใน checkout() และ stock_movements module
// ═══════════════════════════════════════════════════════════
async function _deductStockForSaleItem({ product, qty, orderNo }) {
  if (!product || !qty || qty <= 0) return;
  // ข้าม service / non_stock
  if (product.product_type === "service" || product.product_type === "non_stock") return;

  // Phase 45.3: stock_movements.created_by เป็น uuid → ส่ง auth user id
  const creatorUuid = state.currentUser?.id || null;

  // หาคลังที่มีสต็อกเหลือ > 0 — prefer "บ้าน" ก่อน ไม่งั้นเอาคลังที่มีสต็อกมากสุด
  const stocks = (state.warehouseStock || []).filter(ws =>
    String(ws.product_id) === String(product.id) && Number(ws.stock || 0) > 0
  );

  if (stocks.length > 0) {
    stocks.sort((a, b) => {
      const nameA = (state.warehouses.find(w => w.id === a.warehouse_id)?.name || "");
      const nameB = (state.warehouses.find(w => w.id === b.warehouse_id)?.name || "");
      const aHome = nameA.includes("บ้าน") ? 1 : 0;
      const bHome = nameB.includes("บ้าน") ? 1 : 0;
      if (aHome !== bHome) return bHome - aHome;
      return Number(b.stock || 0) - Number(a.stock || 0);
    });
    const ws = stocks[0];
    const before = Number(ws.stock || 0);
    const after = before - qty;
    const whName = state.warehouses.find(w => w.id === ws.warehouse_id)?.name || "?";
    console.debug(`[deductStock] ${product.name}: ${whName} ${before} → ${after} (qty ${qty})`);
    const patchRes = await xhrPatch("warehouse_stock", { stock: after }, "id", ws.id);
    if (!patchRes.ok) {
      console.error("[deductStock] warehouse_stock PATCH failed:", patchRes.error);
      showToast("⚠️ ตัดสต็อกคลังไม่สำเร็จ: " + (patchRes.error?.message || "RLS policy?"));
    }

    await xhrPost("stock_movements", {
      product_id: product.id,
      type: "sale",
      qty: qty,
      note: `ขายบิล ${orderNo} — คลัง: ${whName} | ${before}→${after}`,
      created_by: creatorUuid
    });
  } else {
    console.warn(`[deductStock] ${product.name}: ไม่มีคลังที่มีสต็อก > 0`);
  }

  // อัพเดท products.stock legacy field — สำคัญเพราะ UI ดู field นี้ตอนเลือก "ทั้งหมด"
  const curStock = Number(product.stock || 0);
  const newStock = curStock - qty;
  try {
    const r = await xhrPatch("products", { stock: newStock }, "id", product.id);
    if (!r.ok) {
      console.warn("[deductStock] products.stock PATCH failed:", r.error);
      showToast("⚠️ อัพเดทสต็อกสินค้าไม่สำเร็จ: " + (r.error?.message || ""));
    }
  } catch(e){ console.warn("[deductStock] products update failed:", e); }

  if (stocks.length === 0) {
    // ไม่มีคลังไหนมีสต็อก → log movement จาก legacy field เท่านั้น
    await xhrPost("stock_movements", {
      product_id: product.id,
      type: "sale",
      qty: qty,
      note: `ขายบิล ${orderNo} (ไม่มีคลังมีสต็อก — legacy) | ${curStock}→${newStock}`,
      created_by: creatorUuid
    });
  }
}

// ★ ย้ายสต็อกระหว่างคลัง — ใช้โดย stock_movements module
async function _transferWarehouseStock({ productId, fromWarehouseId, toWarehouseId, qty, note }) {
  if (!productId || !fromWarehouseId || !toWarehouseId || qty <= 0) {
    return { ok: false, error: "ข้อมูลไม่ครบ" };
  }
  if (String(fromWarehouseId) === String(toWarehouseId)) {
    return { ok: false, error: "คลังต้นทาง/ปลายทาง ต้องไม่ซ้ำกัน" };
  }

  // Phase 45.3: stock_movements.created_by เป็น uuid
  const creatorUuid = state.currentUser?.id || null;

  // หา source row
  const srcWs = (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(fromWarehouseId)
  );
  const srcBefore = Number(srcWs?.stock || 0);
  const srcAfter = srcBefore - qty;

  // หา target row (ถ้าไม่มี จะ insert)
  const tgtWs = (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(toWarehouseId)
  );
  const tgtBefore = Number(tgtWs?.stock || 0);
  const tgtAfter = tgtBefore + qty;

  try {
    if (srcWs?.id) {
      await xhrPatch("warehouse_stock", { stock: srcAfter }, "id", srcWs.id);
    } else {
      await xhrPost("warehouse_stock", { product_id: productId, warehouse_id: fromWarehouseId, stock: srcAfter, min_stock: 0 });
    }

    if (tgtWs?.id) {
      await xhrPatch("warehouse_stock", { stock: tgtAfter }, "id", tgtWs.id);
    } else {
      await xhrPost("warehouse_stock", { product_id: productId, warehouse_id: toWarehouseId, stock: tgtAfter, min_stock: 0 });
    }

    const fromName = state.warehouses.find(w => String(w.id) === String(fromWarehouseId))?.name || "?";
    const toName   = state.warehouses.find(w => String(w.id) === String(toWarehouseId))?.name || "?";

    // Log 1 transfer movement
    await xhrPost("stock_movements", {
      product_id: productId,
      type: "transfer",
      qty: qty,
      note: `โอนย้าย: ${fromName} → ${toName} | ${srcBefore}→${srcAfter}${note ? " — " + note : ""}`.slice(0, 200),
      created_by: creatorUuid
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ★ อัพเดทสต็อกใน warehouse — ใช้โดย stock_movements module (in/out/sale/return/adjust)
async function _applyStockMovement({ productId, warehouseId, movementType, qty, note }) {
  if (!productId || qty <= 0 || !movementType) return { ok: false, error: "ข้อมูลไม่ครบ" };
  // Phase 45.3: schema ใช้ created_by uuid → ต้องส่ง user uuid (auth.users.id) ไม่ใช่ email
  const creatorUuid = state.currentUser?.id || null;

  let ws = warehouseId ? (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(warehouseId)
  ) : null;

  const before = Number(ws?.stock || 0);
  let after = before;
  if (movementType === "in" || movementType === "return") after = before + qty;
  else if (movementType === "out" || movementType === "sale") after = before - qty;
  else if (movementType === "adjust") after = qty; // qty is the new target

  try {
    if (warehouseId) {
      if (ws?.id) await xhrPatch("warehouse_stock", { stock: after }, "id", ws.id);
      else await xhrPost("warehouse_stock", { product_id: productId, warehouse_id: warehouseId, stock: after, min_stock: 0 });
    }

    // Legacy products.stock — recompute as sum of warehouse_stock หลัง update
    // ทำแบบง่าย: delta = after - before → products.stock += delta
    try {
      const prod = (state.products || []).find(p => String(p.id) === String(productId));
      if (prod && warehouseId) {
        const delta = after - before;
        const newProdStock = Number(prod.stock || 0) + delta;
        const r = await xhrPatch("products", { stock: newProdStock }, "id", productId);
        if (!r?.ok) {
          console.warn("[applyStockMovement] products.stock recompute failed:", r?.error);
        }
      }
    } catch(e){
      console.warn("[applyStockMovement] products.stock update threw:", e);
    }

    // Phase 45.3: schema fields = id, product_id, type, qty, note, created_by, created_at
    // ฝัง stock_before/after ใน note (DB ไม่มี column แยก)
    const auditNote = `${String(note || "").slice(0, 150)} | ${before}→${after}`;
    await xhrPost("stock_movements", {
      product_id: productId,
      type: movementType,
      qty: qty,
      note: auditNote.slice(0, 200),
      created_by: creatorUuid
    });

    return { ok: true };
  } catch(e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Expose ให้ stock_movements module เรียกได้
window._appTransferWarehouseStock = _transferWarehouseStock;
window._appApplyStockMovement = _applyStockMovement;
// Expose ให้ pos.js doCheckout เรียกได้ (POS ใช้ flow แยกจาก main.js checkout)
window._appDeductStockForSaleItem = _deductStockForSaleItem;
window._appNotifySaleToLine = (payload) => _notifySaleToLine(payload);

// ★ Phase 18: Bundle expander — ถ้าสินค้าเป็น bundle, ตัดสต็อก children แทน
window._appDeductStockSmart = async function({ product, qty, orderNo }) {
  if (!product) return;
  // ถ้าไม่ใช่ bundle → ตัดปกติ
  if (!product.is_bundle) {
    return await _deductStockForSaleItem({ product, qty, orderNo });
  }
  // เป็น bundle → ดึง children แล้วตัดทีละตัว
  try {
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const res = await fetch(cfg.url + "/rest/v1/product_bundles?bundle_id=eq." + product.id + "&select=child_product_id,qty", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) {
      console.warn("[bundle expand] failed");
      return await _deductStockForSaleItem({ product, qty, orderNo });
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      // ไม่มี children — เก็บไว้ แต่ตัดสต็อก bundle ตัวเองด้วย
      return await _deductStockForSaleItem({ product, qty, orderNo });
    }
    // ตัดสต็อกของแต่ละลูก
    for (const r of rows) {
      const childProd = (state.products || []).find(p => String(p.id) === String(r.child_product_id));
      if (!childProd) continue;
      const childQty = Number(r.qty || 1) * qty;
      await _deductStockForSaleItem({ product: childProd, qty: childQty, orderNo: orderNo + " [bundle:" + product.name + "]" });
    }
    console.debug(`[bundle] ${product.name} × ${qty} → ตัด children ${rows.length} รายการ`);
  } catch(e) {
    console.warn("[bundle expand error]", e);
    return await _deductStockForSaleItem({ product, qty, orderNo });
  }
};

// ═══════════════════════════════════════════════════════════
// Phase 21 — Auto-link Serial Number after sale
// หลัง checkout → ถ้ามี item ที่เข้าข่ายเครื่องใช้ไฟฟ้า
//   → popup ถาม "บันทึก serial มั้ย?" → modal กรอก SN ทีละชิ้น
// Detection: ราคา ≥ 1,500 OR ชื่อสินค้ามี keyword: แอร์/ทีวี/ตู้เย็น/เครื่องซักผ้า/พัดลม/ไมโครเวฟ
// ═══════════════════════════════════════════════════════════
const SERIAL_KEYWORDS = [
  // ภาษาไทย
  "แอร์","ทีวี","ตู้เย็น","เครื่องซักผ้า","ไมโครเวฟ","เตาอบ","หม้อหุงข้าว","พัดลม",
  "เครื่องทำน้ำอุ่น","เครื่องทำน้ำร้อน","หม้อทอด","เตารีด","กระติก",
  // ภาษาอังกฤษ (lowercase — match กับ name.toLowerCase() ด้านล่าง)
  "tv","ac","fridge","refrigerator","washer","washing machine","microwave","oven",
  "rice cooker","fan","water heater","air fryer","iron","kettle","aircon",
  "air conditioner","freezer","dishwasher","dryer","heater",
  // Brand names
  "mitsubishi","samsung","lg","daikin","panasonic","hitachi","sharp","toshiba","haier"
];

function _qualifiesForSerial(item) {
  const name = String(item?.product_name || item?.name || "").toLowerCase();
  const price = Number(item?.unit_price || item?.price || 0);
  if (price >= 1500) return true;
  for (const kw of SERIAL_KEYWORDS) {
    if (name.includes(kw.toLowerCase())) return true;
  }
  return false;
}

window._appPromptSerialAfterSale = function({ saleId, items, customerId, customerName }) {
  if (!saleId || !Array.isArray(items) || items.length === 0) return;
  const qualifying = items.filter(_qualifiesForSerial);
  if (qualifying.length === 0) return;

  // ถาม user ก่อน — non-blocking dialog
  document.getElementById("serialPromptModal")?.remove();
  const ask = document.createElement("div");
  ask.id = "serialPromptModal";
  ask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px";
  ask.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🔢</div>
      <h3 style="margin:0 0 8px;color:#0c4a6e">บันทึก Serial Number?</h3>
      <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.5">
        บิลนี้มีเครื่องใช้ไฟฟ้า <b style="color:#0284c7">${qualifying.length} รายการ</b><br>
        บันทึก SN เพื่อ track warranty?
      </p>
      <div style="background:#f1f5f9;padding:10px;border-radius:8px;margin-bottom:14px;text-align:left;font-size:13px">
        ${qualifying.map(it => `<div>• ${(it.product_name || it.name || "").slice(0, 40)} × ${it.qty}</div>`).join("")}
      </div>
      <div style="display:flex;gap:8px">
        <button id="serialPromptSkip" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ข้าม</button>
        <button id="serialPromptYes" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">+ บันทึก SN</button>
      </div>
    </div>
  `;
  document.body.appendChild(ask);
  document.getElementById("serialPromptSkip").addEventListener("click", () => ask.remove());
  document.getElementById("serialPromptYes").addEventListener("click", () => {
    ask.remove();
    _openSerialBatchModal({ saleId, items: qualifying, customerId, customerName });
  });
};

function _openSerialBatchModal({ saleId, items, customerId, customerName }) {
  document.getElementById("serialBatchModal")?.remove();
  const today = new Date();
  const defaultWarranty = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

  // Expand แต่ละ item ตาม qty (1 SN ต่อ 1 ชิ้น)
  const slots = [];
  items.forEach(it => {
    const qty = Number(it.qty || 1);
    for (let i = 0; i < qty; i++) {
      slots.push({
        product_id: it.product_id || null,
        product_name: it.product_name || it.name || "สินค้า",
        sale_item_id: it.id || null,
        idx: i + 1,
        total: qty
      });
    }
  });

  const modal = document.createElement("div");
  modal.id = "serialBatchModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:20px">
      <h3 style="margin:0 0 6px;color:#0c4a6e">🔢 บันทึก Serial Number (${slots.length} ชิ้น)</h3>
      <div style="font-size:12px;color:#64748b;margin-bottom:14px">ลูกค้า: <b>${customerName || "ลูกค้าทั่วไป"}</b> • ปล่อยว่างได้ถ้ายังไม่มี SN</div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:10px;background:#f0f9ff;border-radius:8px">
        <label style="font-size:12px;font-weight:700;flex:1">วันหมดประกัน (default ทุกชิ้น):</label>
        <input id="snBatchWarranty" type="date" value="${defaultWarranty}" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px" />
      </div>

      <div id="snSlotsList" style="display:grid;gap:10px">
        ${slots.map((s, i) => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;background:#fafafa">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">
              ${s.product_name} ${s.total > 1 ? `(${s.idx}/${s.total})` : ''}
            </div>
            <input type="text" data-slot="${i}" placeholder="กรอก Serial Number (ปล่อยว่าง = ข้ามชิ้นนี้)"
              style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-family:monospace;font-weight:700" />
          </div>
        `).join("")}
      </div>

      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="snBatchCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ข้าม</button>
        <button id="snBatchSave" style="flex:2;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">💾 บันทึกทั้งหมด</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector("input[data-slot='0']")?.focus(), 80);

  document.getElementById("snBatchCancel").addEventListener("click", () => modal.remove());
  document.getElementById("snBatchSave").addEventListener("click", async () => {
    const warranty = document.getElementById("snBatchWarranty").value || null;
    const inputs = modal.querySelectorAll("input[data-slot]");
    const payloads = [];
    inputs.forEach((inp, i) => {
      const sn = (inp.value || "").trim();
      if (!sn) return;
      const slot = slots[i];
      payloads.push({
        sale_id: saleId,
        sale_item_id: slot.sale_item_id || null,
        product_id: slot.product_id || null,
        product_name: slot.product_name,
        customer_id: customerId || null,
        customer_name: customerName || null,
        serial_no: sn,
        warranty_until: warranty,
        status: "active"
      });
    });
    if (payloads.length === 0) {
      modal.remove();
      window.App?.showToast?.("ไม่ได้บันทึก SN");
      return;
    }
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    try {
      const r = await fetch(cfg.url + "/rest/v1/product_serials", {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(payloads)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      modal.remove();
      window.App?.showToast?.(`✓ บันทึก ${payloads.length} serial(s)`);
    } catch(e) {
      window.App?.showToast?.("บันทึก SN ไม่สำเร็จ: " + (e?.message || e));
    }
  });
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
  // ★ คอลัมน์รองรับ (หลัง migration 2026-04-18): id, sale_id, product_id, product_name, qty, unit_price, unit_cost, line_total
  // ถ้า DB ยังไม่ทำ migration → fallback ใช้ payload เก่าได้
  for (const item of state.cart) {
    const prodRef = state.products.find(x => x.id === item.id);
    const itemPayload = {
      sale_id: saleId,
      product_id: item.id || null,
      product_name: item.name || "สินค้า",
      qty: Number(item.qty) || 1,
      unit_price: Number(item.price) || 0,
      unit_cost: Number(prodRef?.cost || 0),
      line_total: Number(item.qty || 1) * Number(item.price || 0)
    };
    let itemRes = await xhrPost("sale_items", itemPayload);
    // Legacy fallback: ถ้า product_id / unit_cost ยังไม่มีใน DB ให้ลองใหม่โดยไม่ส่ง 2 ฟิลด์นี้
    if (!itemRes.ok && /column|product_id|unit_cost/i.test(itemRes.error?.message || "")) {
      const { product_id: _pid, unit_cost: _uc, ...legacy } = itemPayload;
      console.warn("[SALE] sale_items legacy fallback (product_id/unit_cost missing in DB)");
      itemRes = await xhrPost("sale_items", legacy);
    }
    if (!itemRes.ok) {
      console.error("[SALE] sale_items insert failed:", itemRes.error);
      showToast("บันทึกรายการสินค้าไม่สำเร็จ: " + (itemRes.error?.message || "unknown"));
    }

    // ═══ ตัดสต็อก — warehouse_stock + products.stock + log movement ═══
    await _deductStockForSaleItem({ product: prodRef, qty: Number(item.qty) || 0, orderNo });
  }

  await loadReceipt(saleId);
  state.cart = [];
  saveCart();
  // Phase 45.11: openReceiptDrawer ใช้ state.lastReceipt (set โดย loadReceipt) — ไม่ต้องรอ loadAllData
  openReceiptDrawer();
  showToast("บันทึกการขายเรียบร้อย");
  setTimeout(() => loadAllData().catch(e => console.warn("[checkout] reload", e)), 100);

  // ═══ Line Notify: แจ้งขาย + เตือนสต็อกใกล้หมด ═══
  _notifySaleToLine({ orderNo, cartSnapshot: salePayload, items: state.lastReceipt?.items || [] }).catch(e => console.warn("[lineNotify sale] skipped:", e?.message));
}

// ★ ส่ง Line Notify ให้เจ้าของร้าน — รายการขาย + เตือนสต็อกใกล้หมด
async function _notifySaleToLine({ orderNo, cartSnapshot, items }) {
  try {
    const cfg = state?.lineNotifySettings;
    if (!cfg || !cfg.is_active) return; // ปิด Line notify ไว้ → ข้าม

    const lines = [];
    lines.push(`💰 ขายสำเร็จ — ${orderNo}`);
    lines.push(`ลูกค้า: ${cartSnapshot.customer_name || "ลูกค้าทั่วไป"}`);
    lines.push(`ชำระ: ${cartSnapshot.payment_method || "เงินสด"}`);
    lines.push(`───`);
    (items || []).forEach(it => {
      const q = Number(it.qty || 1);
      const p = Number(it.unit_price || it.line_total || 0);
      lines.push(`• ${it.product_name || "-"} x${q} = ฿${(q*p).toLocaleString("th-TH")}`);
    });
    lines.push(`───`);
    lines.push(`💵 รวม: ฿${Number(cartSnapshot.total_amount || 0).toLocaleString("th-TH")}`);
    if (Number(cartSnapshot.change_amount || 0) > 0) {
      lines.push(`🪙 เงินทอน: ฿${Number(cartSnapshot.change_amount).toLocaleString("th-TH")}`);
    }
    lines.push(`👤 โดย: ${state.profile?.full_name || state.currentUser?.email || "POS"}`);

    // ★ เตือนสต็อกใกล้หมด — เช็คจาก state ล่าสุดหลัง loadAllData
    const lowStock = [];
    for (const it of (items || [])) {
      if (!it.product_id) continue;
      const p = (state.products || []).find(x => String(x.id) === String(it.product_id));
      if (!p || p.product_type === "service" || p.product_type === "non_stock") continue;
      const cur = Number(p.stock || 0);
      const min = Number(p.min_stock || 0);
      if (cur <= 0) lowStock.push(`🔴 ${p.name}: หมดสต็อก`);
      else if (min > 0 && cur <= min) lowStock.push(`🟡 ${p.name}: เหลือ ${cur} (ขั้นต่ำ ${min})`);
    }
    if (lowStock.length) {
      lines.push(`───`);
      lines.push(`⚠️ แจ้งเตือนสต็อก:`);
      lowStock.forEach(l => lines.push(l));
    }

    const message = lines.join("\n");
    const { sendLineNotify } = await import("./modules/line_notify.js");
    await sendLineNotify(message, { state, showToast }, "default");
  } catch (e) {
    console.warn("[_notifySaleToLine] error:", e?.message || e);
  }
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

// ★ แชร์ใบเสร็จผ่าน Line — เปิด Line Share URL + copy text ไว้ด้วย
function shareReceiptToLine() {
  if (!state.lastReceipt) return showToast("ยังไม่มีบิลล่าสุด");
  const r = state.lastReceipt;
  const store = state.storeInfo?.name || "บุญสุข";
  const lines = [];
  lines.push(`🧾 ใบเสร็จ ${store}`);
  lines.push(`เลขที่: ${r.order_no || "-"}`);
  lines.push(`วันที่: ${new Date(r.created_at).toLocaleString("th-TH")}`);
  lines.push(`ลูกค้า: ${r.customer_name || "ลูกค้าทั่วไป"}`);
  lines.push(`ชำระ: ${r.payment_method || "เงินสด"}`);
  lines.push("───");
  (r.items || []).forEach(it => {
    const q = Number(it.qty || 1), p = Number(it.unit_price || 0);
    lines.push(`• ${it.product_name} x${q} = ฿${(q*p).toLocaleString("th-TH")}`);
  });
  lines.push("───");
  lines.push(`รวม: ฿${Number(r.total_amount || 0).toLocaleString("th-TH")}`);
  lines.push(`ขอบคุณที่ใช้บริการครับ 🙏`);
  const text = lines.join("\n");

  // Web Share API (มือถือ) — ส่งตรง Line ได้
  if (navigator.share) {
    navigator.share({ text, title: `ใบเสร็จ ${r.order_no}` }).catch(() => {/* user cancelled */});
    return;
  }

  // Fallback: เปิด Line Share URL ใน browser
  const shareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(shareUrl, "_blank");

  // Copy ไว้เผื่อ user paste เอง
  try {
    navigator.clipboard?.writeText(text);
    showToast("คัดลอกใบเสร็จแล้ว + เปิด Line ให้");
  } catch(e) {
    showToast("เปิด Line แล้ว");
  }
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

    // ── Step 1: signUp ──
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
      // ถ้า email ซ้ำ — บอกให้ชัด
      if (/already|registered|duplicate/i.test(signUpResult.error || "")) {
        throw new Error("อีเมลนี้ถูกใช้แล้ว");
      }
      throw new Error(signUpResult.error || "ลงทะเบียนไม่สำเร็จ");
    }

    // ── Step 2: ตั้ง full_name + role ใน profiles ──
    // ★ ALWAYS update profiles (เดิมเช็คเฉพาะ role !== sales — ทำให้ sales user ไม่มีชื่อ)
    if (signUpResult.userId) {
      // รอให้ trigger สร้าง profile row ก่อน (Supabase มี trigger handle_new_user)
      await new Promise(r => setTimeout(r, 800));
      try {
        const patchPayload = { full_name: fullName };
        if (role && role !== "sales") patchPayload.role = role;
        const res = await xhrPatch("profiles", patchPayload, "id", signUpResult.userId);
        if (!res.ok) console.warn("[addNewUser] PATCH profiles failed:", res.error);
        // ★ ถ้า PATCH ไม่สำเร็จ (อาจ trigger ยังไม่สร้าง row) → ลอง UPSERT
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 600));
          await fetch(cfg.url + "/rest/v1/profiles", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": cfg.anonKey,
              "Authorization": "Bearer " + (window._sbAccessToken || cfg.anonKey),
              "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify({ id: signUpResult.userId, full_name: fullName, role: role || "sales" })
          }).catch(e => console.warn("[addNewUser] UPSERT profiles failed:", e));
        }
      } catch(e) { console.warn("[addNewUser] set name/role failed:", e); }
    }

    // ── Step 3: ส่งอีเมลเชิญตั้งรหัสผ่าน (recover endpoint) ──
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
//  UPDATE / DELETE USER (admin only — from settings/users.js)
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
// expose via window.App
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
  // Phase 45.10 (B2-1): Role check ก่อน render — กัน technician/customer bypass
  // เห็นหน้า products (เห็น cost/margin) ผ่าน global search box
  if (!canAccessPage("products")) {
    showToast("คุณไม่มีสิทธิ์เข้าหน้าสินค้า");
    return;
  }
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
    const raw = (location.hash || "").replace("#", "");
    const hashRoute = (raw.split('/')[0] || "").split('?')[0];
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

  // ★ Phase 18: Bundle toggle + add items
  $("newProductIsBundle")?.addEventListener("change", (e) => {
    const sec = $("newProductBundleSection");
    if (sec) sec.style.display = e.target.checked ? "block" : "none";
  });
  $("bundleAddBtn")?.addEventListener("click", () => {
    const search = ($("bundleSearchInput")?.value || "").trim().toLowerCase();
    const qty = Number($("bundleQtyInput")?.value || 1);
    if (!search) return showToast("พิมพ์ชื่อ/SKU/บาร์โค้ดสินค้า");
    if (qty <= 0) return showToast("จำนวนต้องมากกว่า 0");
    const prod = (state.products || []).find(p =>
      String(p.barcode || "").toLowerCase() === search ||
      String(p.sku || "").toLowerCase() === search ||
      String(p.name || "").toLowerCase().includes(search)
    );
    if (!prod) return showToast("ไม่พบสินค้า: " + search);
    if (prod.id === state.editingProductId) return showToast("ไม่สามารถใส่ตัวเองในชุดได้");
    const items = _getBundleItems();
    if (items.find(it => String(it.product_id) === String(prod.id))) {
      // ถ้ามีอยู่แล้ว — บวก qty
      items.find(it => String(it.product_id) === String(prod.id)).qty += qty;
    } else {
      items.push({ product_id: prod.id, name: prod.name, qty });
    }
    if ($("bundleItemsValue")) $("bundleItemsValue").value = JSON.stringify(items);
    _renderBundleItems(items);
    if ($("bundleSearchInput")) $("bundleSearchInput").value = "";
    if ($("bundleQtyInput")) $("bundleQtyInput").value = "1";
    showToast(`✓ เพิ่ม ${prod.name} × ${qty}`);
  });
  $("bundleSearchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("bundleAddBtn")?.click(); }
  });

  // ★ Auto Markup — คำนวณราคาขายจาก cost × (1 + markup%)
  $("autoMarkupBtn")?.addEventListener("click", () => {
    const cost = Number($("newProductCost")?.value || 0);
    if (cost <= 0) return showToast("กรอก 'ต้นทุน' ก่อน");
    const lastMarkup = Number(localStorage.getItem("bsk_last_markup") || 30);
    const input = prompt("คำนวณราคาขาย: cost + กี่ %?\n(เช่น 30 = บวก 30%)", String(lastMarkup));
    if (input === null) return;
    const pct = Number(input);
    if (isNaN(pct) || pct < 0) return showToast("กรอกตัวเลข ≥ 0");
    try { localStorage.setItem("bsk_last_markup", String(pct)); } catch(e){}
    const newPrice = Math.round(cost * (1 + pct / 100) * 100) / 100;
    if ($("newProductPrice")) $("newProductPrice").value = newPrice;
    showToast(`ราคา: ฿${cost} + ${pct}% = ฿${newPrice}`);
  });

  // ★ Image upload — Supabase Storage
  $("newProductImageBtn")?.addEventListener("click", () => $("newProductImageFile")?.click());
  $("newProductImageClearBtn")?.addEventListener("click", () => {
    if ($("newProductImageUrl")) $("newProductImageUrl").value = "";
    if ($("newProductImageImg")) $("newProductImageImg").src = "";
    if ($("newProductImagePreview")) $("newProductImagePreview").style.display = "none";
  });
  $("newProductImageFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("ไฟล์ต้องเป็นรูปภาพ");
    if (file.size > 5 * 1024 * 1024) return showToast("ไฟล์ใหญ่เกิน 5MB");
    const btn = $("newProductImageBtn");
    if (btn) { btn.disabled = true; btn.textContent = "กำลังอัพโหลด..."; }
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${ts}-${rand}.${ext}`;
      const { data, error } = await state.supabase.storage
        .from("product-images")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (error) {
        console.error("[image upload]", error);
        showToast("อัพโหลดไม่สำเร็จ: " + (error.message || "อาจยังไม่ได้สร้าง bucket 'product-images' ใน Supabase Storage"));
        return;
      }
      const { data: urlData } = state.supabase.storage.from("product-images").getPublicUrl(data.path);
      const url = urlData?.publicUrl || "";
      if ($("newProductImageUrl")) $("newProductImageUrl").value = url;
      if ($("newProductImageImg")) $("newProductImageImg").src = url;
      if ($("newProductImagePreview")) $("newProductImagePreview").style.display = "block";
      showToast("อัพโหลดรูปสำเร็จ ✓");
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาด: " + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "📤 อัพโหลดรูป"; }
      e.target.value = ""; // reset เพื่อให้เลือกไฟล์เดิมซ้ำได้
    }
  });
  $("drawerScannerClose")?.addEventListener("click", closeDrawerScanner);
  $("drawerGenBarcodeBtn")?.addEventListener("click", genDrawerBarcode);
  $("drawerPrintBarcodeBtn")?.addEventListener("click", printDrawerBarcode);
  $("newProductBarcode")?.addEventListener("input", updateBarcodePreview);
  $("newProductType")?.addEventListener("change", (e) => _toggleDrawerSections(e.target.value));
  $("saveCustomerBtn")?.addEventListener("click", saveCustomer);
  // ★ saveQuotation now handled inside quotations.js module
  $("saveServiceJobBtn")?.addEventListener("click", saveServiceJob);

  // ★ Service photos upload (Before/After) — reuse product-images bucket
  // Phase 32: รองรับ 2 source — 📷 กล้อง + 🖼️ แกลลอรี่ (เพื่อ user ที่อยากเลือกรูปเก่า/รูปจากที่อื่น)
  async function _handleServicePhotoUpload(which, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("ไฟล์ต้องเป็นรูปภาพ");
    if (file.size > 5 * 1024 * 1024) return showToast("ไฟล์ใหญ่เกิน 5MB");
    const cameraBtn = $(`service${which}Btn`);
    const galleryBtn = $(`service${which}GalleryBtn`);
    const origCamera = cameraBtn?.textContent;
    const origGallery = galleryBtn?.textContent;
    if (cameraBtn) { cameraBtn.disabled = true; cameraBtn.textContent = "⏳..."; }
    if (galleryBtn) { galleryBtn.disabled = true; galleryBtn.textContent = "⏳..."; }
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `service-${which.toLowerCase()}-${ts}-${rand}.${ext}`;
      const { data, error } = await state.supabase.storage
        .from("product-images")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (error) {
        console.error(`[service-${which.toLowerCase()} upload]`, error);
        showToast("อัพโหลดไม่สำเร็จ: " + (error.message || "ตรวจ bucket 'product-images'"));
        return;
      }
      const { data: urlData } = state.supabase.storage.from("product-images").getPublicUrl(data.path);
      const url = urlData?.publicUrl || "";
      _setServicePhotoPreview(which, url);
      showToast(`อัพโหลดรูป${which === "Before" ? "ก่อน" : "หลัง"}สำเร็จ ✓`);
    } catch (err) {
      showToast("ผิดพลาด: " + (err?.message || err));
    } finally {
      if (cameraBtn) { cameraBtn.disabled = false; cameraBtn.textContent = origCamera || "📷 ถ่ายรูป"; }
      if (galleryBtn) { galleryBtn.disabled = false; galleryBtn.textContent = origGallery || "🖼️ แกลลอรี่"; }
    }
  }

  ["Before", "After"].forEach(which => {
    // 📷 ปุ่มถ่ายรูป → input ที่มี capture="environment"
    $(`service${which}Btn`)?.addEventListener("click", () => $(`service${which}File`)?.click());
    // 🖼️ ปุ่มแกลลอรี่ → input ที่ไม่มี capture (เปิด file picker → user เลือกจากรูป/ไฟล์)
    $(`service${which}GalleryBtn`)?.addEventListener("click", () => $(`service${which}GalleryFile`)?.click());
    // 🗑️ ปุ่มลบ
    $(`service${which}Clear`)?.addEventListener("click", () => _setServicePhotoPreview(which, ""));

    // ทั้ง 2 inputs ใช้ handler เดียวกัน
    $(`service${which}File`)?.addEventListener("change", async (e) => {
      await _handleServicePhotoUpload(which, e.target.files?.[0]);
      e.target.value = "";
    });
    $(`service${which}GalleryFile`)?.addEventListener("change", async (e) => {
      await _handleServicePhotoUpload(which, e.target.files?.[0]);
      e.target.value = "";
    });
  });
  $("printReceiptBtn")?.addEventListener("click", printLastReceipt);
  $("pdfReceiptBtn")?.addEventListener("click", exportReceiptPdf);
  $("shareReceiptLineBtn")?.addEventListener("click", shareReceiptToLine);
  $("addNewUserBtn")?.addEventListener("click", addNewUser);
  $("setPasswordBtn")?.addEventListener("click", submitNewPassword);
  $("setPwConfirm")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitNewPassword(); });
  // ═══ Toggle Set-Password Visibility ═══
  [["toggleSetPwNew", "setPwNew"], ["toggleSetPwConfirm", "setPwConfirm"]].forEach(([btnId, inputId]) => {
    const btn = $(btnId), inp = $(inputId);
    if (btn && inp) btn.addEventListener("click", () => {
      const hidden = inp.type === "password";
      inp.type = hidden ? "text" : "password";
      btn.textContent = hidden ? "🙈" : "👁️";
    });
  });

  $("globalSearch")?.addEventListener("input", globalSearchProducts);
}

// ═══════════════════════════════════════════════════════════
//  WINDOW EXPORTS (สำหรับ onclick ใน HTML ที่สร้างโดย module)
// ═══════════════════════════════════════════════════════════
window.App = {
  showRoute, openProductDrawer, openCustomerDrawer, openQuotationDrawer,
  openServiceJobDrawer, openReceiptDrawer, addToCart, changeQty,
  removeFromCart, loadAllData, loadReceipt, renderAll, closeAllDrawers, changeRole,
  openAddUserDrawer, showToast, updateAppLogos,
  state, // ★ Phase 11: expose state for ai-chat-widget customer context
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

// ★ อัปเดตโลโก้ใน HTML ทุกจุด (sidebar, auth, favicon) จาก state.storeInfo + localStorage
function updateAppLogos() {
  const logo = window._appGetLogo();
  // Sidebar logo
  const sidebarLogo = document.querySelector(".sidebar-logo-img");
  if (sidebarLogo) sidebarLogo.src = logo;
  // Auth/Login logo (มี 2 จุด: login screen + set password screen)
  document.querySelectorAll(".auth-logo-img").forEach(el => { el.src = logo; });
  // Settings profile avatar
  const profileLogo = document.querySelector(".set-profile-logo");
  if (profileLogo) profileLogo.src = logo;
  // Spinner logo (loading overlay)
  const spinnerLogo = document.querySelector(".spinner-logo");
  if (spinnerLogo) spinnerLogo.src = logo;
  // Favicon (เฉพาะ data: URI — http URL จะไม่ override)
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon && logo.startsWith("data:")) favicon.href = logo;
}
// Expose ให้ modules อื่นเรียกได้ (Phase 36 — settings/pages.js logo upload)
window.updateAppLogos = updateAppLogos;

(async function boot(){
  initDarkMode();
  bindStaticEvents();
  updateAppLogos();
  const ok = await initSupabase();
  if (!ok) return;
  if (!state.currentUser) return;
  await afterLogin();
  // Sync โลโก้จาก Supabase Storage (ทำ background ไม่ block)
  window._appSyncLogo().then(() => { if (typeof updateAppLogos === "function") updateAppLogos(); });
})();
