
import { renderDashboard } from "./modules/dashboard.js";
import { fetchAllPaginated } from "./modules/fetch_paginated.js";
import { renderProductsPage, refreshProductsPage } from "./modules/products.js";
import { applyDraftFields, bindServiceDraft, clearServiceDraft, loadServiceDraft } from "./modules/service_drafts.js";
import { renderPosPage, clearPosState } from "./modules/pos.js";
import { renderSalesPage } from "./modules/sales.js";
import { renderCustomersPage } from "./modules/customers.js";
import { renderQuotationsPage } from "./modules/quotations.js";
import { renderServiceJobsPage } from "./modules/service_jobs.js";
import { normalizeServiceJobStatus, serviceJobNoteWithReviewMarker, isServiceJobPendingReview } from "./modules/service_status.js";
import { renderSettingsPage } from "./modules/settings/index.js";
// Phase 89.20/89.21: delivery_invoices, receipts, expenses lazy
import { renderStockMovementsPage } from "./modules/stock_movements.js";
// Phase 89.21: profit_report, calendar, loyalty lazy
import { renderLineNotifySettings, sendLineNotify, describeLineResult } from "./modules/line_notify.js";
import { renderPermissionMatrix, hasPermission } from "./modules/permission_matrix.js";
// Phase 92.1/92.2/92.3: extracted DOM-paint + logo-source resolver + Supabase
// Storage pull from main.js. main.js keeps thin wrappers that bind live globals
// (state / SUPABASE_CONFIG / token) so all call sites are unchanged.
import { updateAppLogos as _updateAppLogosImpl, getAppLogo as _getAppLogoImpl, syncAppLogo as _syncAppLogoImpl } from "./modules/branding.js";
// Phase 92.4: html2canvas lazy loader extracted to modules/lazy_libs.js.
import { loadHtml2Canvas as _loadHtml2CanvasImpl } from "./modules/lazy_libs.js";
// Phase 92.7: Share/PDF overlay extracted to modules/share_doc.js.
import { shareDoc as _shareDocImpl } from "./modules/share_doc.js";
// Phase 89.20: customer_dashboard lazy — clearCustomerDashboardState called only if loaded (see logout)
// Phase 89.21: btu_calculator, service_request lazy
// Phase 89.20: solar, ac_install lazy
import { renderServiceFormPage, SERVICE_TYPES } from "./modules/service_form.js";
// Phase 402 (MONEY/STOCK §4.1+§4.2): อุปกรณ์จากสต็อกใน drawer งานช่าง (deduct on save, งานใหม่)
import { equipmentTotal as _equipTotal, precheckEquipmentStock as _equipPrecheck, toItemsJson as _equipToItemsJson, deductEquipmentStock as _equipDeduct, optimisticDeduct as _equipOptimistic, renderEquipmentList as _equipRenderList, openEquipmentPicker as _equipOpenPicker, restoreServiceJobStock as _equipRestoreStock, STOCK_RETURNED_MARKER as _STOCK_RETURNED_MARKER } from "./modules/service_equipment.js";
// Phase 89.20: error_codes (124KB), error_codes_fridge (35KB), error_codes_washer (34KB) lazy
// Phase 89.21: stock_value, dead_stock, stock_count, stock_in_wizard, cash_recon lazy
// Phase 89.21: top_customers, sales_heatmap, recurring_expenses, credit_tracker, refunds lazy
import { renderTasksPage, checkOverdueTasksAndNotify } from "./modules/tasks.js";
// Phase 57: audit log viewer
// Phase 89.21: audit_log, departments lazy
// Phase 89.20: payroll, ai_sales, ac_shop lazy
// Phase 89.21: payroll_overview, expense_overview lazy
// Phase 89.20: accounting/* (9 modules) — all lazy (admin only, ~167KB combined)
// Phase 88.1: auto-posting JV จาก sales/expenses — eager (used in checkout flow)
import { postJournalForSale, postJournalForServiceJob, voidJvForSource } from "./modules/accounting/auto_post.js";
import { findJournalForSale, renderSaleTraceBadge, navigateToJv } from "./modules/accounting/sale_trace.js";
import { ACCOUNTING_EFFECTIVE_DATE } from "./modules/accounting/effective_date.js";
// Phase 89.21: profit_by_product, quote_templates, serials lazy
import { renderBirthdaysPage, checkTodayBirthdaysAndNotify } from "./modules/birthdays.js";
import { renderWarrantyReportPage, checkWarrantyExpiringAndNotify } from "./modules/warranty_report.js";
// Phase 427: help tutor FAB ("คำแนะนำ" ปุ่มหลอดไฟ) ถอดออกตาม owner — modules/help_tutor.js คงไว้แบบ dormant (ไม่ import)
import "./modules/doc-override.js";
import { isValidPhone, isValidEmail, getUserFriendlyError, validateFile } from "./modules/validators.js";
import { atomicDecrementStock, atomicAddToField } from "./modules/stock_cas.js";
import { installErrorReporter } from "./modules/error_reporter.js";
import { createInflightGuard } from "./modules/_inflight_guard.js";
import { createApi } from "./modules/api.js";
import { runBoot } from "./modules/boot.js";
import { visibleSalesForRole } from "./modules/utils.js";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════
//  Phase 89.20 — Lazy module loader (code-split for admin/service-only routes)
//    เลื่อน 550KB+ (9 service+admin + 9 accounting) ออกจาก first-load
//    cache promise per path → load ครั้งเดียวต่อ module ตลอด session
//
//  Phase 90.7 — Append ?v=APP_BUILD to the import() URL so the browser's
//  ES module registry treats each build as a separate URL (otherwise a
//  soft refresh from build N → N+1 keeps the old parsed module in memory
//  because the URL string '/modules/X.js' is identical across builds —
//  see tests/lazy_import_cache_bust.test.js for the full scenario).
//  The session Map is still keyed on the bare path so per-session dedup
//  works; only across deploys do we re-fetch.
// ═══════════════════════════════════════════════════════════
const _lazyMod = new Map();
function _bustedUrl(path) {
  const build = (typeof window !== "undefined" && window.APP_BUILD) || "dev";
  return path + (path.includes("?") ? "&" : "?") + "v=" + build;
}
function _lazyImport(path) {
  if (!_lazyMod.has(path)) _lazyMod.set(path, import(_bustedUrl(path)));
  return _lazyMod.get(path);
}
const LAZY_ROUTES = {
  team_center:                ["./modules/team_command_center.js",        "renderTeamCommandCenter"],
  // Phase 89.20 — Service/admin heavy (9)
  customer_dashboard:         ["./modules/customer_dashboard.js",         "renderCustomerDashboard"],
  solar:                      ["./modules/solar.js",                       "renderSolarPage"],
  ac_install:                 ["./modules/ac_install.js",                  "renderAcInstallPage"],
  error_codes:                ["./modules/error_codes.js",                 "renderErrorCodesPage"],
  error_codes_fridge:         ["./modules/error_codes_fridge.js",          "renderErrorCodesFridgePage"],
  error_codes_washer:         ["./modules/error_codes_washer.js",          "renderErrorCodesWasherPage"],
  payroll:                    ["./modules/payroll.js",                     "renderPayrollPage"],
  ai_sales:                   ["./modules/ai_sales.js",                    "renderAiSalesPage"],
  ac_shop:                    ["./modules/ac_shop.js",                     "renderAcShopPage"],
  // Phase 89.20 — Accounting (9)
  accounting_journals:        ["./modules/accounting/journals.js",         "renderJournalsPage"],
  accounting_journal_new:     ["./modules/accounting/journal_form.js",     "renderJournalFormPage"],
  accounting_coa:             ["./modules/accounting/coa.js",              "renderCoaPage"],
  accounting_backfill:        ["./modules/accounting/backfill.js",         "renderBackfillPage"],
  accounting_trial_balance:   ["./modules/accounting/trial_balance.js",    "renderTrialBalancePage"],
  accounting_profit_loss:     ["./modules/accounting/profit_loss.js",      "renderProfitLossPage"],
  accounting_balance_sheet:   ["./modules/accounting/balance_sheet.js",    "renderBalanceSheetPage"],
  accounting_opening_balance: ["./modules/accounting/opening_balance.js",  "renderOpeningBalancePage"],
  accounting_export_bundle:   ["./modules/accounting/export_bundle.js",    "renderExportBundlePage"],
  accounting_periods:         ["./modules/accounting/periods.js",          "renderPeriodsPage"],
  // Phase 89.21 — Iteration #2 (admin reports + stock ops + finance)
  delivery_invoices:          ["./modules/delivery_invoices.js",           "renderDeliveryInvoicesPage"],
  receipts:                   ["./modules/receipts.js",                    "renderReceiptsPage"],
  expenses:                   ["./modules/expenses.js",                    "renderExpensesPage"],
  profit_report:              ["./modules/profit_report.js",               "renderProfitReportPage"],
  calendar:                   ["./modules/calendar.js",                    "renderCalendarPage"],
  loyalty:                    ["./modules/loyalty.js",                     "renderLoyaltyPage"],
  btu_calculator:             ["./modules/btu_calculator.js",              "renderBtuCalculatorPage"],
  service_request:            ["./modules/service_request.js",             "renderServiceRequestPage"],
  stock_value:                ["./modules/stock_value.js",                 "renderStockValuePage"],
  dead_stock:                 ["./modules/dead_stock.js",                  "renderDeadStockPage"],
  stock_count:                ["./modules/stock_count.js",                 "renderStockCountPage"],
  stock_in_wizard:            ["./modules/stock_in_wizard.js",             "renderStockInWizardPage"],
  cash_recon:                 ["./modules/cash_recon.js",                  "renderCashReconPage"],
  top_customers:              ["./modules/top_customers.js",               "renderTopCustomersPage"],
  sales_heatmap:              ["./modules/sales_heatmap.js",               "renderSalesHeatmapPage"],
  recurring_expenses:         ["./modules/recurring_expenses.js",          "renderRecurringExpensesPage"],
  credit_tracker:             ["./modules/credit_tracker.js",              "renderCreditTrackerPage"],
  refunds:                    ["./modules/refunds.js",                     "renderRefundsPage"],
  audit_log:                  ["./modules/audit_log.js",                   "renderAuditLogPage"],
  departments:                ["./modules/departments.js",                 "renderDepartmentsPage"],
  payroll_overview:           ["./modules/payroll_overview.js",            "renderPayrollOverviewPage"],
  // Phase 92.22 — ลงเวลาทำงาน (admin manager flow + self-service)
  time_clock:                 ["./modules/time_clock.js",                  "renderTimeClockPage"],
  // Phase 92.28 — ภาพรวม HR (read-only dashboard, admin only)
  hr_overview:                ["./modules/hr_overview.js",                 "renderHrOverviewPage"],
  // Phase 92.32 — Leave Management (admin + self)
  leave_management:           ["./modules/leave_management.js",            "renderLeaveManagementPage"],
  // Phase 420 — รับสมัครงาน + ใบลาออก (admin only)
  hr_applications:            ["./modules/hr_forms.js",                    "renderHrApplicationsPage"],
  hr_resignations:            ["./modules/hr_forms.js",                    "renderHrResignationsPage"],
  expense_overview:           ["./modules/expense_overview.js",            "renderExpenseOverviewPage"],
  income_overview:            ["./modules/income_overview.js",             "renderIncomeOverviewPage"],
  profit_by_product:          ["./modules/profit_by_product.js",           "renderProfitByProductPage"],
  quote_templates:            ["./modules/quote_templates.js",             "renderQuoteTemplatesPage"],
  serials:                    ["./modules/serials.js",                     "renderSerialsPage"],
  // Phase 375 — ตรวจสต็อกงานบริการ (ตามเก็บ) read-only report, admin-only
  stock_reconcile_report:     ["./modules/stock_reconcile_report.js",      "renderStockReconcileReportPage"],
  // Phase 384 — ตรวจรายได้งานบริการเข้าบัญชี (reconcile + re-post orphan JE), admin-only
  service_reconcile:          ["./modules/service_reconcile.js",           "renderServiceReconcilePage"],
};
async function _renderLazy(route, ctx) {
  const def = LAZY_ROUTES[route];
  if (!def) return false;
  try {
    const mod = await _lazyImport(def[0]);
    const fn = mod[def[1]];
    if (typeof fn === "function") fn(ctx);
    else console.error(`[lazy] ${def[0]} missing export ${def[1]}`);
  } catch(e) {
    console.error(`[lazy] failed loading ${def[0]}:`, e);
    try { showToast?.(`โหลดหน้านี้ไม่สำเร็จ — ลองรีเฟรช`); } catch(_){}
  }
  return true;
}

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
//  Phase 89.2d data layer — extracted to modules/api.js (Phase 92.9)
//  Factory binds the live window so the _refreshInflight single-flight closure,
//  internal 401-retry recursion, and token state ทำงานเหมือนเดิม. 13 module callers
//  ใช้ window._app* wrappers (ด้านล่าง) ไม่ต้องแตะ; main.js local callers ใช้
//  destructured bindings ที่อยู่ใน module scope แล้ว.
// ═══════════════════════════════════════════════════════════
const _api = createApi({ windowRef: window });
const { refreshAccessToken, appAuthFetch, xhrPost, xhrPatch, xhrDelete } = _api;

window._appRefreshAccessToken = refreshAccessToken;
window._appAuthFetch = appAuthFetch;
window._appXhrPost   = xhrPost;
window._appXhrPatch  = xhrPatch;
window._appXhrDelete = xhrDelete;
// ★ Expose validators for modules
window._appValidators = { isValidPhone, isValidEmail, getUserFriendlyError, validateFile };

// ★ Get store logo — ใช้ได้จากทุก module ผ่าน window._appGetLogo()
// Phase 36: priority storeInfo.logoUrl (DB sync) → localStorage (cache) → default
// Phase 92.2: resolver moved to modules/branding.js (getAppLogo). This thin
// wrapper binds the live `state` so all call sites keep working unchanged.
window._appGetLogo = function() {
  return _getAppLogoImpl({ stateRef: state });
};

// ★ Sync logo จาก Supabase Storage → localStorage (เรียกตอน boot)
// Phase 92.3: pull logic moved to modules/branding.js (syncAppLogo, now with an
// AbortController timeout + logged failures). This wrapper binds the live config
// + token so callers keep working unchanged.
window._appSyncLogo = async function() {
  return _syncAppLogoImpl({
    config: window.SUPABASE_CONFIG,
    accessToken: window._sbAccessToken,
    onUpdated: () => { if (typeof updateAppLogos === "function") updateAppLogos(); },
  });
};

// ★ Lazy loader สำหรับ html2canvas (~350KB) — โหลดเฉพาะตอนใช้งาน Share/PDF
// Phase 92.4: loader moved to modules/lazy_libs.js. This thin wrapper preserves
// the local _loadHtml2Canvas() call site (window._appShareDoc) + behavior.
function _loadHtml2Canvas() {
  return _loadHtml2CanvasImpl({ windowRef: window, documentRef: document });
}

// ★ Share document function — แชร์เป็น PDF เหมือน FlowAccount
// ใช้ได้จากทุก module ผ่าน window._appShareDoc(elementId, docName)
// Phase 92.7: body moved to modules/share_doc.js. Thin wrapper binds live globals so
// the 4 callers (delivery_invoices/doc-utils/quotations/receipts) keep working unchanged.
window._appShareDoc = function(docElementId, docName) {
  return _shareDocImpl({
    docElementId,
    docName,
    documentRef: document,
    windowRef: window,
    loadHtml2Canvas: _loadHtml2Canvas,   // the lazy_libs wrapper from Phase 92.4
    showToast,
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
    raw.vatEnabled = raw.vatEnabled === true;
    raw.vatRate = Number(raw.vatRate || 7);
    raw.vatPriceMode = raw.vatPriceMode || "exclusive";
    raw.vatEffectiveDate = raw.vatEffectiveDate || ACCOUNTING_EFFECTIVE_DATE;
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

// ═══ Phase 5: Utility Functions (2/4/2569) ═══

// ★ XSS Protection — escapeHtml (Phase 51: dedup → use shared utils.js)
import { escHtml as escapeHtml } from "./modules/utils.js";
// ★ Phase 92.8 — Thai-locale formatters extracted to utils.js (caller compat via import binding)
import { money, formatNumber, formatCurrency, formatDate, formatDateTime } from "./modules/utils.js";

// ★ Phase 86.3 — email/password staff auth flow (extracted from main.js)
import { createEmailAuth } from "./modules/auth_email.js";
// ★ Phase 86.4 — customer OTP signup/login flow (extracted from main.js)
//   (auth_otp.js เป็นคน import api_utils + otp_cooldown — main.js ไม่ต้องใช้ตรงๆ แล้ว)
import { createOtpAuth } from "./modules/auth_otp.js";

// ★ Format helpers (Thai locale) — Phase 92.8: moved to modules/utils.js (imported above)

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

  // ★ Phase 83.4: Mobile fix — blur active input ก่อน show dialog (กัน keyboard บัง)
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  const modal = document.createElement("div");
  modal.id = "bskConfirmModal";
  modal.className = "confirm-overlay";
  modal.setAttribute("role", "alertdialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "ยืนยัน");
  // ★ Phase 83.4: Inline z-index สูงกว่า keyboard layer + ensure visibility บน mobile
  modal.style.zIndex = "10000";
  modal.innerHTML = `
    <div class="confirm-card">
      <p class="confirm-msg">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn light confirm-cancel" aria-label="ยกเลิก">ยกเลิก</button>
        <button class="btn btn-primary confirm-ok" aria-label="ยืนยัน">ยืนยัน</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // ★ Scroll dialog into view + lock body scroll (mobile reliability)
  const _prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  setTimeout(() => modal.scrollIntoView({ block: "center", behavior: "instant" }), 10);

  const okBtn = modal.querySelector(".confirm-ok");
  const cancelBtn = modal.querySelector(".confirm-cancel");
  const previousFocus = document.activeElement;

  function close(result) {
    modal.remove();
    document.body.style.overflow = _prevBodyOverflow || "";
    // อย่า refocus previous element ถ้าเป็น text input — กัน keyboard เด้งกลับ
    if (previousFocus && !(previousFocus instanceof HTMLInputElement) && !(previousFocus instanceof HTMLTextAreaElement)) {
      try { previousFocus.focus(); } catch (e) {}
    }
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
// Phase 378: คืนสถานะ cloud-sync ให้ caller แจ้ง user ได้ชัดเมื่อ sync ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ
//   return shape: { ok:true, cloudSynced:boolean, error:string|null }
//   - ยังเซฟ localStorage เสมอ (ok:true) + ❌ ไม่ throw → ไม่ block offline / caller เดิมที่ ignore return ไม่กระทบ
async function saveStoreInfo(data = null) {
  if (data) {
    state.storeInfo = { ...state.storeInfo, ...data };
  }
  // ✅ Save to localStorage (primary storage — synchronous, always succeeds) — ก่อน Supabase เสมอ
  localStorage.setItem("bsk_store_info", JSON.stringify(state.storeInfo));

  // 🔄 Try Supabase (optional, 3s timeout so UI never hangs on stalled network/RLS)
  if (!state.supabase) {
    return { ok: true, cloudSynced: false, error: "ไม่ได้เชื่อมต่อเซิร์ฟเวอร์" };
  }
  try {
    const timeout = new Promise((_, rej) => { setTimeout(() => rej(new Error("supabase timeout")), 3000); });
    const save = state.supabase
      .from('app_settings')
      .upsert({ key: 'store_info', value: state.storeInfo }, { onConflict: 'key' });
    const { error } = await Promise.race([save, timeout]);
    if (error) {
      console.warn('Supabase save warning:', error);
      return { ok: true, cloudSynced: false, error: error.message || String(error) };
    }
    return { ok: true, cloudSynced: true, error: null };
  } catch (err) {
    // Don't throw - localStorage already saved ✓
    console.warn('Supabase save failed (using localStorage):', err?.message || err);
    return { ok: true, cloudSynced: false, error: err?.message || String(err) };
  }
}
// ★ savePaymentInfo — sync ทั้ง localStorage + Supabase (เหมือน saveStoreInfo)
//    ช่วยให้ข้อมูลบัญชีธนาคาร + QR มีใน device อื่นที่ login เดียวกัน
async function savePaymentInfo() {
  localStorage.setItem("bsk_payment_info", JSON.stringify(state.paymentInfo));
  if (!state.supabase) return;
  try {
    const timeout = new Promise((_, rej) => { setTimeout(() => rej(new Error("supabase timeout")), 3000); });
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
    const timeout = new Promise((_, rej) => { setTimeout(() => rej(new Error("supabase timeout")), 4000); });
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
function _setSafeHtml(id, html){ const el=$(id); if(el) el.innerHTML = html; } // alias ชัดเจนว่าผ่าน escapeHtml แล้ว
function _isLowStock(product){ return Number(product.stock||0) <= Number(product.min_stock||0); }

// ═══════════════════════════════════════════════════════════
//  ROLE-BASED ACCESS CONTROL (4 กลุ่ม)
// ═══════════════════════════════════════════════════════════
// Phase 45 — Service form routes (9 ประเภทงานช่าง — generic pattern)
const SERVICE_FORM_TYPES = ["repair_ac","clean_ac","move_ac","satellite","repair_fridge","repair_washer","cctv","repair_tv","other"];
const SERVICE_FORM_ROUTES = SERVICE_FORM_TYPES.map(t => "service_" + t);

const ALL_ROUTES = ["dashboard","team_center","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","quote_templates","service_jobs","settings","expenses","profit_report","stock_movements","stock_value","dead_stock","stock_count","stock_in_wizard","cash_recon","top_customers","sales_heatmap","recurring_expenses","credit_tracker","refunds","tasks","profit_by_product","birthdays","serials","warranty_report","calendar","loyalty","customer_dashboard","btu_calculator","service_request","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop","audit_log","hr_overview","leave_management","hr_applications","hr_resignations","departments","payroll","payroll_overview","expense_overview","income_overview","accounting_journals","accounting_journal_new","accounting_coa","accounting_backfill","accounting_trial_balance","accounting_profit_loss","accounting_balance_sheet","accounting_opening_balance","accounting_export_bundle","accounting_periods","time_clock","stock_reconcile_report","service_reconcile", ...SERVICE_FORM_ROUTES];
const ROLE_PAGES = {
  admin:      ALL_ROUTES,
  // Phase 434: ช่าง (+ผู้ช่วยช่างที่ตั้ง role=technician) เข้าสินค้า/คลังเพื่อเบิกขึ้นรถ + ตัดสต็อกเองได้
  //   เพิ่ม products/wh_*/stock_movements/stock_count (ดูสต็อก + เบิก/โอน/ตัด — ทุกหน้า cost-free สำหรับ technician;
  //   หน้า products gate ปุ่มจัดการ/ต้นทุนเป็น read-only ใน products.js). ❌ ไม่ให้ stock_in_wizard (รับเข้า=โชว์ต้นทุน),
  //   stock_value (มูลค่า/ต้นทุนรวม), dead_stock — ตาม owner "ไม่เห็นต้นทุน"
  technician: ["customer_dashboard","pos","sales","service_jobs","calendar","btu_calculator","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop","time_clock","leave_management","products","wh_kunkhao","wh_kundaeng","wh_sikhon","stock_movements","stock_count", ...SERVICE_FORM_ROUTES],
  sales:      ["dashboard","pos","products","wh_kunkhao","wh_kundaeng","wh_sikhon","sales","delivery_invoices","receipts","customers","quotations","quote_templates","settings","expenses","profit_report","stock_movements","stock_value","dead_stock","stock_count","stock_in_wizard","cash_recon","top_customers","sales_heatmap","recurring_expenses","credit_tracker","refunds","tasks","profit_by_product","birthdays","serials","warranty_report","calendar","loyalty","btu_calculator","solar","ac_install","error_codes","error_codes_fridge","error_codes_washer","ai_sales","ac_shop","time_clock","leave_management", ...SERVICE_FORM_ROUTES],
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
  // Phase 88.0 — accounting routes อยู่ในกลุ่ม "accounting"
  accounting_journals: "accounting", accounting_journal_new: "accounting", accounting_coa: "accounting", accounting_backfill: "accounting", accounting_trial_balance: "accounting", accounting_profit_loss: "accounting", accounting_balance_sheet: "accounting", accounting_opening_balance: "accounting", accounting_export_bundle: "accounting", accounting_periods: "accounting",
  // Phase 45 — service forms ทั้งหมดอยู่ในกลุ่ม "service"
  ...Object.fromEntries(SERVICE_FORM_ROUTES.map(r => [r, "service"]))
};

async function showRoute(route){
  // Role-based access control
  if (!canAccessPage(route)) {
    const fallback = allowedPages()[0] || "dashboard";
    if (route !== fallback) {
      showToast("คุณไม่มีสิทธิ์เข้าหน้านี้");
      showRoute(fallback);
      return;
    }
  }

  // ★ Phase 82.2: Force-stop scanners ก่อน page change (กัน scan ลูปข้ามหน้า)
  // กล้องและ scanner callback อาจยัง active แม้ page section ถูก hide ไปแล้ว
  if (state.currentRoute !== route) {
    try { window._stopStockInScanner?.(); } catch(e){}
    try { window._stopStockCountScanner?.(); } catch(e){}
    try { window._stopDrawerScanner?.(); } catch(e){}
    try { window._stopPosScanner?.(); } catch(e){}
    try { window._stopProductScanner?.(); } catch(e){}
    try { window._stopSerialScanner?.(); } catch(e){}
  }

  state.currentRoute = route;

  // ★ Phase mobile-layout: เปิดเผย route ปัจจุบันบน <body> ให้ CSS อ้างได้
  //   (ใช้คุมว่าจะโชว์ AI FAB บนมือถือเฉพาะหน้า "กรอกงานจริง" — กันบัง content หน้าอื่น เช่น Settings)
  document.body.dataset.route = route;

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
    dashboard:"ภาพรวมบริษัท", team_center:"ศูนย์ทีม AI", pos:"แคชเชียร์",
    products:"สินค้า / คลัง", wh_kunkhao:"คันขาว", wh_kundaeng:"คันแดง", wh_sikhon:"ศีขร",
    sales:"รายการขาย POS", delivery_invoices:"ใบส่งสินค้า / ใบแจ้งหนี้",
    receipts:"ใบเสร็จรับเงิน",
    customers:"ลูกค้า", quotations:"ใบเสนอราคา",
    service_jobs:"ใบรับงาน", settings:"ตั้งค่า",
    expenses:"รายรับ-รายจ่าย", profit_report:"รายงานกำไรขั้นต้น",
    expense_overview:"ภาพรวมรายจ่าย", income_overview:"ภาพรวมรายได้",
    stock_movements:"ประวัติเคลื่อนไหวสต็อก", stock_reconcile_report:"ตรวจสต็อกงานบริการ (ตามเก็บ)", service_reconcile:"ตรวจรายได้งานบริการเข้าบัญชี", calendar:"ปฏิทินงานช่าง",
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
    accounting_journals:"สมุดรายวัน",
    accounting_journal_new:"บันทึกรายการบัญชี",
    accounting_coa:"ผังบัญชี",
    accounting_backfill:"Backfill JV ย้อนหลัง",
    accounting_trial_balance:"รายงานยอดทดลอง (Trial Balance)",
    accounting_profit_loss:"งบกำไรขาดทุน (P&L)",
    accounting_balance_sheet:"งบดุล (Balance Sheet)",
    accounting_opening_balance:"ลงยอดยกมา (Opening Balance)",
    accounting_export_bundle:"Export ชุดรายงานบัญชี",
    accounting_periods:"🔒 ปิดงวดบัญชี (Period Close)",
    ac_shop:"แอร์ใหม่พร้อมติดตั้ง",
    hr_overview:"ภาพรวม HR",
    leave_management:"วันลา",
    hr_applications:"รับสมัครงาน",
    hr_resignations:"ใบลาออก",
    // Phase 45 — service form titles (9 ประเภท)
    ...Object.fromEntries(SERVICE_FORM_TYPES.map(t => ["service_" + t, `${SERVICE_TYPES[t].icon} ใบงาน${SERVICE_TYPES[t].label}`]))
  };
  setText("pageTitle", titles[route] || "Boonsook POS");
  closeSidebar();

  // Phase 25 help tutor → ถอดออก Phase 427 (FAB คำแนะนำ)

  // Lazy render on navigate
  const ctx = { state, money, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer, showRoute, openCustomerDrawer, openQuotationDrawer, openServiceJobDrawer, loadAllData, loadReceipt, ROLE_LABELS, currentRole, requireAdmin, requireAdminOrSales, showToast, saveStoreInfo, savePaymentInfo, loadUsers, changeRole, openAddUserDrawer, hasPermission: (key) => hasPermission(key, { state, currentRole }), renderLineNotifySettings, renderPermissionMatrix, sendLineNotify };

  // Phase 89.20: dynamic-import dispatch for admin/service-only routes (550KB+ shifted off first-load)
  if (await _renderLazy(route, ctx)) return;

  // Eager routes (landing-critical + boot deps)
  if (route === "dashboard") renderDashboard(ctx);
  if (route === "pos") renderPosPage(ctx);
  if (route === "products") renderProductsPage(ctx);
  if (route === "sales") renderSalesPage(ctx);
  if (route === "customers") renderCustomersPage(ctx);
  if (route === "quotations") renderQuotationsPage(ctx);
  if (route === "service_jobs") renderServiceJobsPage(ctx);
  if (route === "settings") renderSettingsPage(ctx);
  if (route === "stock_movements") renderStockMovementsPage(ctx);
  if (route === "tasks") renderTasksPage(ctx);
  if (route === "birthdays") renderBirthdaysPage(ctx);
  if (route === "warranty_report") renderWarrantyReportPage(ctx);
  // Phase 45 — service form (9 ประเภท) — eager (SERVICE_TYPES used at module-eval time)
  if (SERVICE_FORM_ROUTES.includes(route)) {
    const serviceType = route.replace(/^service_/, "");
    renderServiceFormPage(ctx, serviceType);
  }
  // All other routes handled by LAZY_ROUTES → _renderLazy() at top of dispatcher

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

// ── Mobile sidebar drawer (Phase mobile-layout) ──
// เปิด sidebar บนมือถือต้อง: เลื่อนเข้า (.open) + ใส่ body.sidebar-open (lock scroll + ซ่อน AI FAB)
// + โชว์ backdrop (dim ฉากหลัง, แตะปิดได้). z-index ของ sidebar (mobile) > bottom nav → ไม่ถูกบัง
const _DRAWER_IDS = ["productDrawer","customerDrawer","serviceJobDrawer","receiptDrawer","addUserDrawer","expenseDrawer"];
function _anyDrawerOpen(){
  return _DRAWER_IDS.some(id => { const el = $(id); return el && !el.classList.contains("hidden"); });
}
function closeSidebar(){
  $("sidebar")?.classList.remove("open");
  document.body.classList.remove("sidebar-open");
  // ซ่อน backdrop เฉพาะตอนไม่มี drawer อื่นเปิดค้าง (กันปิด backdrop ทับ drawer)
  if (!_anyDrawerOpen()) $("backdrop")?.classList.add("hidden");
}
function toggleSidebar(){
  const sb = $("sidebar"); if (!sb) return;
  if (sb.classList.contains("open")) { closeSidebar(); return; }
  sb.classList.add("open");
  document.body.classList.add("sidebar-open");
  $("backdrop")?.classList.remove("hidden");
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

  // Phase 89.12: install error reporter once Supabase config is verified
  if (!window._errorReporter) {
    window._errorReporter = installErrorReporter({
      fetcher: fetch,
      supabaseUrl: window.SUPABASE_CONFIG.url,
      anonKey: window.SUPABASE_CONFIG.anonKey,
      getAccessToken: () => window._sbAccessToken || window.SUPABASE_CONFIG.anonKey,
      getUserId: () => state?.currentUser?.id || null,
      build: typeof window.APP_BUILD === "number" ? window.APP_BUILD : null,
      beforeSend: (event) => {
        if (/ResizeObserver loop/i.test(event.message)) return null;
        if (/^Script error\.?$/i.test(event.message)) return null;
        if (/Non-Error promise rejection captured/i.test(event.message)) return null;
        return event;
      },
    });
  }

  // ★ Detect recovery link (จาก invite email) — ต้องเช็คก่อน getSession
  const isRecovery = /[#&]type=recovery/.test(window.location.hash || "");
  if (isRecovery) state._recoveryMode = true;

  const { data:{session} } = await state.supabase.auth.getSession();
  if (session?.user) {
    /* eslint-disable require-atomic-updates -- LOW_RISK: L6 init-time only (boot getSession, runs once at app start) */
    state.currentUser = session.user;
    window._sbAccessToken = session.access_token; // ★ CRITICAL: เก็บ token
    /* eslint-enable require-atomic-updates */
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

// ═══ Phase 86.3 — Email auth flow ย้ายไป modules/auth_email.js ═══
// (login, requestStaffPasswordReset, showSetPasswordScreen, submitNewPassword)
// afterLogin ใช้ wrapper () => afterLogin() เพื่อ lazy-resolve (afterLogin
// declared ทีหลังในไฟล์นี้ — function declarations hoisted ✅)
const {
  login,
  requestStaffPasswordReset,
  showSetPasswordScreen,
  submitNewPassword,
  requestNewRecoveryLink
} = createEmailAuth({
  state, $, setText, showToast,
  afterLogin: () => afterLogin()
});
// ═══════════════════════════════════════════════════════════
//  CUSTOMER OTP AUTH — Phase 86.4: ย้ายไป modules/auth_otp.js
//  (requestOtp + verifyOtp + _pendingOtp encapsulate ใน module)
// ═══════════════════════════════════════════════════════════
const { requestOtp, verifyOtp } = createOtpAuth({ state, $, setText, showToast });

// ═══════════════════════════════════════════════════════════
//  Phase 85.3 → 86.2 — OTP cooldown ย้ายไป modules/otp_cooldown.js
//  Phase 86.1 — api utils ย้ายไป modules/api_utils.js
//  (auth_otp.js เป็น consumer ตรง — main.js ไม่ต้อง import แล้ว)
// ═══════════════════════════════════════════════════════════

async function logout(){
  try { await state.supabase.auth.signOut(); } catch(e) { console.warn("signOut error:", e); }
  // ★ Force clear ทุกอย่างแม้ signOut ล้มเหลว
  /* eslint-disable require-atomic-updates -- LOW_RISK: L1 user-event (logout button — sequential after signOut, single click per session) */
  state.currentUser = null;
  state.profile = null;
  state.cart = []; saveCart();
  /* eslint-enable require-atomic-updates */
  window._sbAccessToken = null;
  // Phase 45.10 (B5-1): clear module state ด้วย (กัน cross-login leak)
  // Phase 89.20: customer_dashboard lazy — clear state only if module actually loaded (no-op if user never opened it)
  const _custDashPath = "./modules/customer_dashboard.js";
  if (_lazyMod.has(_custDashPath)) {
    try { (await _lazyMod.get(_custDashPath)).clearCustomerDashboardState(); }
    catch(e){ console.warn("[logout] clearCustomerDashboardState", e); }
  }
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
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (loadProfile awaited from afterLogin, single login flow)
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
      await new Promise(r => { setTimeout(r, 100); });
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

  // ★ Phase 25 Help Tutor FAB → ถอดออก Phase 427 ตาม owner (ปุ่มคำแนะนำรกหน้าจอ)

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
    // Phase 89.27 (C1 fix): server-side sales filter for non-admin — เดิม client filter หลัง .limit(50)
    // → busy day admin/คนอื่นเต็ม 50 rows → ช่าง/sales เห็น 0 บิล. ตอนนี้ filter ที่ DB.
    // .or() เพื่อรองรับ legacy NULL created_by (Phase 89.24 semantics).
    const _isAdmin = (state.profile?.role === "admin");
    const _myId = state.currentUser?.id || null;
    let salesQuery = sb.from("sales").select("*").order("created_at",{ascending:false}).limit(50);
    if (!_isAdmin && _myId) {
      salesQuery = salesQuery.or(`created_by.eq.${_myId},created_by.is.null`);
    }
    // Phase 366: products/customers/warehouse_stock โหลดครบทุกแถวด้วย .range() pagination
    // (PostgREST default max-rows=1000 → select(*) เปล่าตัดที่ 1000). warehouse_stock เพิ่ม
    // stable .order("id") ก่อน .range() — เดิมไม่มี order → ลำดับข้ามหน้าซ้ำ/หาย.
    // helper คืน array ตรง ๆ (ไม่ใช่ {data}) → ใช้ valArr; ตาราง limit-50 (เจตนา) คงเดิม.
    const [rProducts, rSales, rCustomers, rQuotations, rServiceJobs, rDeliveryInvoices, rReceipts, rWarehouses, rWhStock] = await Promise.allSettled([
      fetchAllPaginated((f,t) => sb.from("products").select("*").order("id",{ascending:false}).range(f,t)),
      salesQuery,
      fetchAllPaginated((f,t) => sb.from("customers").select("*").order("id",{ascending:false}).range(f,t)),
      sb.from("quotations").select("*").order("id",{ascending:false}).limit(50),
      sb.from("service_jobs").select("*").order("id",{ascending:false}).limit(50),
      sb.from("delivery_invoices").select("*").order("id",{ascending:false}).limit(50),
      sb.from("receipts").select("*").order("id",{ascending:false}).limit(50),
      sb.from("warehouses").select("*").order("sort_order",{ascending:true}),
      fetchAllPaginated((f,t) => sb.from("warehouse_stock").select("*").order("id",{ascending:true}).range(f,t))
    ]);

    const val = (r, fallback = []) => r.status === "fulfilled" ? (r.value.data || fallback) : fallback;
    const valArr = (r, fallback = []) => r.status === "fulfilled" ? (r.value || fallback) : fallback; // paginated helper คืน array ตรง ๆ
    /* eslint-disable require-atomic-updates -- G: all 9 state assigns protected by _isLoading entry-guard at loadAllData() (main.js:1443) */
    state.products          = valArr(rProducts);
    state.sales             = val(rSales);
    state.customers         = valArr(rCustomers);
    state.quotations        = val(rQuotations);
    state.serviceJobs       = val(rServiceJobs);
    state.deliveryInvoices  = val(rDeliveryInvoices);
    state.receipts          = val(rReceipts);
    state.warehouses        = val(rWarehouses);
    state.warehouseStock    = valArr(rWhStock);
    /* eslint-enable require-atomic-updates */

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
          // eslint-disable-next-line require-atomic-updates -- G: protected by _isLoading entry-guard at loadAllData() (main.js:1443)
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

    /* eslint-disable require-atomic-updates -- G: all 6 state assigns protected by _isLoading entry-guard at loadAllData() (main.js:1443) */
    state.expenses           = val(rExpenses);
    state.stockMovements     = val(rStockMov);
    state.loyaltyPoints      = val(rLoyalty);
    state.loyaltySettings    = (val(rLoySetting))[0] || null;
    state.permissions        = val(rPerms);
    state.lineNotifySettings = (val(rLineNotify))[0] || null;
    /* eslint-enable require-atomic-updates */

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
    // Phase 87.5 — ตรวจ schema coverage: ถ้า cache มี specs <90% ของ entries → refresh
    try {
      const cached = localStorage.getItem("bsk_ac_catalog");
      let needRefresh = !cached;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            needRefresh = true;
          } else {
            const specced = parsed.filter(p => p && (p.features || p.seer || p.description)).length;
            if (specced < parsed.length * 0.9) needRefresh = true;
          }
        } catch(e){ needRefresh = true; }
      }
      if (needRefresh) {
        fetch("data/ac_catalog.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(data => {
          if (data && Array.isArray(data) && data.length > 0) {
            localStorage.setItem("bsk_ac_catalog", JSON.stringify(data));
            const specced = data.filter(p => p && (p.features || p.seer || p.description)).length;
            console.info(`[ac_catalog] refreshed: ${data.length} entries, ${specced} with specs`);
          }
        }).catch(err => console.warn("[ac_catalog] fetch failed", err));
      }
    } catch(e){ console.warn("[ac_catalog] init failed", e); }

    renderAll();

  } catch(e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (e.message || e));
  } finally {
    // eslint-disable-next-line require-atomic-updates -- G: _isLoading lock release in finally (correct lock pattern, entry guard at loadAllData() line 1443)
    _isLoading = false; // ★ ปลดล็อคเสมอ
  }
}

function renderAll(){
  _updateLowStockBadge();
  _updateNotifBell();    // ★ Phase 399: topbar 🔔
  _updateProfileChip();  // ★ Phase 399: topbar 👤
  if (state.currentRoute === "products" && refreshProductsPage()) return;
  showRoute(state.currentRoute);
}

// ★ Low Stock Badge ใน sidebar — นับสินค้าที่สต็อก ≤ min_stock (และ > 0 = near / = 0 = out)
// ★ Phase 399: single source นับสินค้าใกล้หมด/หมด — sidebar badge + topbar bell ใช้ร่วม (กันเลขเพี้ยน)
function _countLowStockItems(products) {
  return (products || []).filter(p => {
    const t = p.product_type || _detectType(p);
    if (t !== "stock") return false; // นับเฉพาะสินค้านับสต็อกจริง (ไม่รวมบริการ / non-stock)
    const s = Number(p.stock || 0), m = Number(p.min_stock || 0);
    return s <= 0 || (m > 0 && s <= m);
  }).length;
}

function _updateLowStockBadge() {
  const badge = $("navLowStockBadge");
  if (!badge) return;
  const count = _countLowStockItems(state.products);
  if (count === 0) {
    badge.classList.add("hidden");
    badge.textContent = "";
  } else {
    badge.classList.remove("hidden");
    badge.textContent = count;
    badge.title = `สต็อกใกล้หมด/หมด ${count} รายการ`;
  }
}

// ★ Phase 399: topbar 🔔 bell — badge นับ low-stock (helper เดียวกับ sidebar)
function _updateNotifBell() {
  const badge = $("notifBadge");
  if (!badge) return;
  const count = _countLowStockItems(state.products);
  if (count === 0) {
    badge.classList.add("hidden");
    badge.textContent = "";
  } else {
    badge.classList.remove("hidden");
    badge.textContent = count > 99 ? "99+" : count;
  }
  const bell = $("notifBell");
  if (bell) bell.title = count === 0 ? "แจ้งเตือน" : `สต็อกใกล้หมด/หมด ${count} รายการ`;
}

// ★ Phase 399: topbar 👤 profile chip — ชื่อ/role (read-only; escapeHtml กัน XSS)
function _updateProfileChip() {
  const nameEl = $("profileName");
  const avatarEl = $("profileAvatar");
  const role = state.profile?.role || "";
  const name = (state.profile?.full_name || "").trim()
    || (state.currentUser?.email || "").split("@")[0]
    || "ผู้ใช้";
  if (nameEl) nameEl.innerHTML = escapeHtml(name);
  const AVATAR = { admin: "🛡️", sales: "💼", technician: "🔧" };
  if (avatarEl) avatarEl.textContent = AVATAR[role] || "👤";
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

  // Phase 68 (B3): Tag widget for products
  _mountProductTagWidget(product);

  openDrawer("productDrawer");
}

// Phase 68: Service job tag widget instance
let _serviceJobTagWidget = null;
async function _mountServiceJobTagWidget(job) {
  const activeEl   = $("serviceTagsActive");
  const presetsEl  = $("serviceTagsPresets");
  const inputEl    = $("serviceTagInput");
  const addBtn     = $("serviceTagAddBtn");
  if (!activeEl || !presetsEl) return;
  if (inputEl) { const ni = inputEl.cloneNode(true); inputEl.parentNode.replaceChild(ni, inputEl); }
  if (addBtn)  { const nb = addBtn.cloneNode(true); addBtn.parentNode.replaceChild(nb, addBtn); }
  // Phase 90.7: ?v=APP_BUILD so a soft refresh into a new build doesn't reuse the previously parsed utils module
  const { mountTagWidget, SERVICE_TAG_PRESETS } = await import(_bustedUrl("./modules/utils.js"));
  _serviceJobTagWidget = mountTagWidget({
    activeEl, presetsEl,
    inputEl: $("serviceTagInput"),
    addBtn: $("serviceTagAddBtn"),
    presets: SERVICE_TAG_PRESETS,
    initial: Array.isArray(job?.tags) ? job.tags : []
  });
}

// Phase 68: Product tag widget instance (returns getValue for save)
let _productTagWidget = null;
async function _mountProductTagWidget(product) {
  const activeEl   = $("productTagsActive");
  const presetsEl  = $("productTagsPresets");
  const inputEl    = $("productTagInput");
  const addBtn     = $("productTagAddBtn");
  if (!activeEl || !presetsEl) return;
  // Reset input + button (re-cloning to drop old listeners)
  if (inputEl) { const ni = inputEl.cloneNode(true); inputEl.parentNode.replaceChild(ni, inputEl); }
  if (addBtn)  { const nb = addBtn.cloneNode(true); addBtn.parentNode.replaceChild(nb, addBtn); }
  // Phase 90.7: ?v=APP_BUILD cache-bust (see _bustedUrl)
  const { mountTagWidget, PRODUCT_TAG_PRESETS } = await import(_bustedUrl("./modules/utils.js"));
  _productTagWidget = mountTagWidget({
    activeEl,
    presetsEl,
    inputEl: $("productTagInput"),
    addBtn: $("productTagAddBtn"),
    presets: PRODUCT_TAG_PRESETS,
    initial: Array.isArray(product?.tags) ? product.tags : []
  });
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
let _drawerScanSessionId = 0;
let _drawerScannerActive = false;

async function stopDrawerScannerHard() {
  _drawerScannerActive = false;
  _drawerScanSessionId++;
  const scanner = _drawerScanner;
  _drawerScanner = null;

  if (scanner) {
    try {
      const state = typeof scanner.getState === "function" ? scanner.getState() : null;
      if (state === 2 || state === 3) await scanner.stop();
    } catch(e) {}
    try { await scanner.clear?.(); } catch(e) {}
  }
  $("drawerScannerArea")?.classList.add("hidden");
}

async function openDrawerScanner() {
  const area = $("drawerScannerArea");
  const videoEl = $("drawerScannerVideo");
  const resultEl = $("drawerScannerResult");
  if (!area || !videoEl) return;

  await stopDrawerScannerHard();
  area.classList.remove("hidden");
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (drawer scanner — 1 camera per session)
  videoEl.innerHTML = "";
  if (resultEl) resultEl.innerHTML = "";

  if (typeof Html5Qrcode === "undefined") {
    // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 single-device singleton (drawer scanner — 1 camera per session)
    videoEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8">ไม่พบไลบรารี Scanner</div>';
    return;
  }

  // Phase 64: shared scanner config (1D barcodes + QR)
  // Phase 90.7: ?v=APP_BUILD cache-bust
  import(_bustedUrl("./modules/utils.js")).then(({ getScannerConfig }) => {
    const { ctorOpts, startConfig } = getScannerConfig();
    try {
      const sessionId = ++_drawerScanSessionId;
      _drawerScannerActive = true;
      _drawerScanner = new Html5Qrcode("drawerScannerVideo", ctorOpts);
      _drawerScanner.start(
        { facingMode: "environment" },
        startConfig,
        async (code) => {
          if (!_drawerScannerActive || sessionId !== _drawerScanSessionId) return;
          _drawerScannerActive = false;
          await stopDrawerScannerHard();
          const barcodeInput = $("newProductBarcode");
          if (barcodeInput) {
            barcodeInput.value = code;
            barcodeInput.blur();
          }
          if (resultEl) resultEl.innerHTML = `<span style="color:#10b981;font-weight:600">✓ สแกนได้: ${escapeHtml(code)}</span>`;
          showToast("สแกนบาร์โค้ดสำเร็จ: " + code);
        },
        () => {} // ignore per-frame scan errors (very noisy)
      ).catch(err => {
        _drawerScannerActive = false;
        videoEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8">ไม่สามารถเปิดกล้อง: ${escapeHtml(err.message || err)}</div>`;
      });
    } catch(err) {
      _drawerScannerActive = false;
      videoEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8">เกิดข้อผิดพลาด: ${escapeHtml(err.message || err)}</div>`;
    }
  });
}

async function closeDrawerScanner() {
  await stopDrawerScannerHard();
}

window._stopDrawerScanner = () => { stopDrawerScannerHard().catch?.(() => {}); };

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

  // Phase 68 (B3): tags
  if (_productTagWidget) {
    try { payload.tags = _productTagWidget.getValue(); } catch(_){}
  }

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

  const editingProductId = state.editingProductId;
  let productId = editingProductId;
  let savedProduct = null;
  if (productId) {
    const res = await xhrPatch("products", payload, "id", productId);
    if (!res.ok) return showToast(res.error?.message || "บันทึกสินค้าไม่สำเร็จ");
  } else {
    const res = await xhrPost("products", payload, { returnData: true });
    if (!res.ok) return showToast(res.error?.message || "บันทึกสินค้าไม่สำเร็จ");
    // eslint-disable-next-line require-atomic-updates -- C: local productId reassign in sequential product save
    productId = res.data?.id;
    savedProduct = res.data || null;
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
    if (editingProductId && Array.isArray(state.products)) {
      const idx = state.products.findIndex(p => String(p.id) === String(editingProductId));
      if (idx >= 0) state.products[idx] = { ...state.products[idx], ...payload };
    } else if (productId && Array.isArray(state.products)) {
      const nextProduct = { ...payload, ...(savedProduct || {}), id: productId };
      if (!state.products.some(p => String(p.id) === String(productId))) state.products.unshift(nextProduct);
    }
  } catch(e) { console.warn("[saveProduct] optimistic", e); }
  resetProductForm();
  closeAllDrawers();
  showToast("บันทึกสินค้าแล้ว");
  if (state.currentRoute === "products") {
    try { if (!refreshProductsPage()) showRoute("products"); } catch(e){}
  }
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
  // Phase 61 (C3): Notes timeline
  _renderCustomerNotesTimeline(customer);

  openDrawer("customerDrawer");
}

// ═══════════════════════════════════════════════════════════
//  Phase 61 (C3): Customer Notes Timeline — uses activity_log
// ═══════════════════════════════════════════════════════════
async function _renderCustomerNotesTimeline(customer) {
  const el = $("customerNotesTimeline");
  if (!el) return;
  if (!customer || !customer.id) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  el.innerHTML = `
    <div style="background:#f8fafc;border-radius:12px;padding:14px;border:1px solid #e2e8f0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:18px">💬</span>
        <h4 style="margin:0;font-size:14px;color:#0f172a;flex:1">บันทึกติดตามลูกค้า</h4>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input id="cnNoteInput" placeholder="เพิ่มโน้ต... เช่น โทรนัดติดตั้ง, แจ้งราคาแล้ว, ลูกค้าขอคิดดู" style="flex:1;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
        <button id="cnAddBtn" style="padding:8px 14px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap">+ บันทึก</button>
      </div>
      <div id="cnList" style="max-height:240px;overflow-y:auto"></div>
    </div>
  `;

  const listEl = el.querySelector("#cnList");
  const input = el.querySelector("#cnNoteInput");
  const btn = el.querySelector("#cnAddBtn");

  const loadAndRender = async () => {
    listEl.innerHTML = '<div style="text-align:center;padding:14px;color:#94a3b8;font-size:12px">⏳ กำลังโหลด...</div>';
    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken;
      if (!token) { listEl.innerHTML = '<div style="text-align:center;padding:14px;color:#94a3b8;font-size:12px">ต้องเข้าสู่ระบบก่อน</div>'; return; }
      const url = cfg.url + "/rest/v1/activity_log?entity_type=eq.customer&entity_id=eq." + encodeURIComponent(customer.id) + "&action=eq.customer_note&order=created_at.desc&limit=50";
      const r = await fetch(url, { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
      if (!r.ok) {
        if (r.status === 404 || r.status === 400) { listEl.innerHTML = '<div style="text-align:center;padding:14px;color:#94a3b8;font-size:12px">ตาราง activity_log ยังไม่มี — รัน supabase-phase57-activity-log.sql</div>'; return; }
        throw new Error("HTTP " + r.status);
      }
      const notes = await r.json();
      if (!notes.length) {
        listEl.innerHTML = '<div style="text-align:center;padding:18px;color:#94a3b8;font-size:12px">ยังไม่มีโน้ต — เพิ่มอันแรกได้เลย</div>';
        return;
      }
      listEl.innerHTML = notes.map(n => `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:6px">
          <div style="font-size:13px;color:#0f172a;white-space:pre-wrap;line-height:1.5">${escapeHtml(n.summary || "")}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">
            👤 ${escapeHtml(n.user_name || "ไม่ระบุ")} • ${new Date(n.created_at).toLocaleString("th-TH", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })}
          </div>
        </div>
      `).join("");
    } catch(e) {
      listEl.innerHTML = `<div style="text-align:center;padding:14px;color:#dc2626;font-size:12px">โหลดไม่สำเร็จ: ${escapeHtml(e.message || String(e))}</div>`;
    }
  };

  const addNote = async () => {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true; btn.textContent = "⏳";
    try {
      // Phase 90.7: ?v=APP_BUILD cache-bust
      const { logActivity } = await import(_bustedUrl("./modules/utils.js"));
      await logActivity("customer_note", {
        entityType: "customer",
        entityId: customer.id,
        summary: text
      });
      // eslint-disable-next-line require-atomic-updates -- A: UI input reset, single note-save button per click
      input.value = "";
      await loadAndRender();
      showToast("บันทึกโน้ตแล้ว");
    } catch(e) {
      showToast("บันทึกไม่สำเร็จ: " + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = "+ บันทึก";
    }
  };

  btn.addEventListener("click", addNote);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); }
  });

  loadAndRender();
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

  const visibleSales = visibleSalesForRole(state.sales, state.profile, state.currentUser);
  myItems.forEach(it => {
    const sale = visibleSales.find(s => String(s.id) === String(it.sale_id));
    if (!sale) return;
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
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:12px">
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
  const sales = visibleSalesForRole(state.sales, state.profile, state.currentUser)
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
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:12px">
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
      // Phase 92.11: same fix as sales.js — เปิด drawer เฉพาะตอนโหลดใบเสร็จสำเร็จ
      const r = await loadReceipt(id);
      if (r && r.ok === false) {
        showToast?.("❌ เปิดบิลไม่สำเร็จ: " + (r.error?.message || "unknown"));
        return;
      }
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
function openQuotationDrawer(_doc=null){
  // Navigate to quotations page — the module handles the form internally
  showRoute("quotations");
}

// ═══════════════════════════════════════════════════════════
//  SERVICE JOB DRAWER
// ═══════════════════════════════════════════════════════════
// Phase 402: อุปกรณ์ใน drawer งานช่าง — งานใหม่แก้ได้+ตัดสต็อกตอน save; งานเดิม (มี items_json) read-only กันตัดซ้ำ
let _serviceDrawerItems = [];
let _serviceDrawerEquipReadonly = false;
let _serviceJobDrawerDraftBound = false;
const SERVICE_JOB_DRAWER_DRAFT_KEY = "service_job_drawer";
const SERVICE_JOB_DRAWER_DRAFT_FIELDS = [
  ["#serviceCustomer", "customer"],
  ["#servicePhone", "phone"],
  ["#serviceAddress", "address"],
  ["#serviceTitle", "title"],
  ["#serviceType", "type"],
  ["#serviceStatus", "status"],
  ["#serviceNote", "note"],
  ["#serviceLabor", "labor"],
  ["#serviceDiscount", "discount"],
  ["#serviceTotalCost", "totalCost"],
  ["#servicePaymentMethod", "paymentMethod"]
];

function openServiceJobDrawer(job=null){
  const drawerDraft = job ? null : loadServiceDraft(SERVICE_JOB_DRAWER_DRAFT_KEY);
  state.editingServiceJobId = job?.id || null;
  // ★ เก็บสถานะเดิม ไว้ตรวจการเปลี่ยนเป็น "done" ตอน save
  state.editingServiceJobOrigStatus = job?.status || "pending";
  // ★ Phase 88.10b: เก็บ total_cost + payment_method เดิม → ตรวจว่าเปลี่ยนตอน save
  state.editingServiceJobOrigTotalCost = job?.total_cost ?? null;
  state.editingServiceJobOrigPaymentMethod = job?.payment_method ?? null;
  setText("serviceJobDrawerTitle", job ? "แก้ไขงานช่าง" : "เพิ่มงานช่าง");
  $("serviceCustomer").value = job?.customer_name || "";
  $("servicePhone").value = job?.customer_phone || "";
  $("serviceAddress").value = job?.customer_address || job?.job_address || "";
  $("serviceTitle").value = job?.description || job?.job_title || "";
  $("serviceType").value = job?.job_type || "ac";
  $("serviceStatus").value = job?.status || "pending";
  $("serviceNote").value = job?.note || "";

  // ★ Phase 88.8 / Phase 402: ค่าแรง / ส่วนลด / ยอดสุทธิ / อุปกรณ์ — สำหรับลง JV
  // อุปกรณ์: งานเดิม (มี items_json) → read-only (ตัดสต็อกแล้ว กันตัดซ้ำ); งานใหม่ → เพิ่ม/ลบ + ตัดตอน save
  const _hasExistingItems = !!(job?.items_json && Array.isArray(job.items_json) && job.items_json.length);
  _serviceDrawerEquipReadonly = _hasExistingItems;
  _serviceDrawerItems = _hasExistingItems ? job.items_json.map(it => ({ ...it })) : [];  // clone งานเดิม (display เฉย ๆ)
  if (!job && Array.isArray(drawerDraft?.items)) {
    _serviceDrawerItems = drawerDraft.items.map(it => ({ ...it }));
  }
  const _equipItemsTotal = () => _equipTotal(_serviceDrawerItems);

  // labor / discount เก็บใน field — derived จาก total_cost - items_total เป็นอย่างน้อย (row เก่าไม่มี labor แยก)
  const existingTotal = Number(job?.total_cost || 0);
  const existingLabor = Math.max(0, existingTotal - _equipItemsTotal());  // approximation
  $("serviceLabor").value = existingLabor || 0;
  $("serviceDiscount").value = 0;
  $("serviceTotalCost").value = existingTotal || 0;
  $("servicePaymentMethod").value = job?.payment_method || "";
  if (!job) applyDraftFields(document, drawerDraft, SERVICE_JOB_DRAWER_DRAFT_FIELDS);
  // Auto-recalc ยอดสุทธิ (อุปกรณ์ + ค่าแรง − ส่วนลด)
  const _recalc = () => {
    const labor = Number($("serviceLabor")?.value || 0);
    const discount = Number($("serviceDiscount")?.value || 0);
    const net = Math.max(0, _equipItemsTotal() + labor - discount);
    $("serviceTotalCost").value = net;
  };
  // render รายการอุปกรณ์ + รวมอุปกรณ์ + recalc ยอดสุทธิ
  const _renderEquip = () => {
    _equipRenderList($("serviceEquipmentList"), _serviceDrawerItems, { money, readOnly: _serviceDrawerEquipReadonly });
    const totEl = $("serviceEquipmentTotal");
    const t = _equipItemsTotal();
    if (totEl) totEl.textContent = t > 0 ? `รวมอุปกรณ์ ${money(t)}` : "";
    $("serviceEquipmentReadonlyNote")?.classList.toggle("hidden", !_serviceDrawerEquipReadonly);
    const addBtn0 = $("serviceAddEquipmentBtn");
    if (addBtn0) addBtn0.style.display = _serviceDrawerEquipReadonly ? "none" : "";
    _recalc();
  };
  // wire qty/ลบ (งานใหม่เท่านั้น) — clone list node ทับ handler เดิม (idempotent ต่อการเปิด drawer ซ้ำ)
  {
    const listEl = $("serviceEquipmentList");
    if (listEl) {
      const fresh = listEl.cloneNode(false); listEl.parentNode.replaceChild(fresh, listEl);
      if (!_serviceDrawerEquipReadonly) {
        fresh.addEventListener("input", (e) => {
          const idx = e.target?.dataset?.equipQty;
          if (idx === undefined) return;
          const i = Number(idx);
          const qty = Math.max(1, parseInt(e.target.value) || 1);
          _serviceDrawerItems[i].qty = qty;
          _serviceDrawerItems[i].line_total = qty * Number(_serviceDrawerItems[i].unit_price || 0);
          _renderEquip();
          try { document.getElementById("serviceJobDrawer")?.dispatchEvent(new Event("input")); } catch (_) {}
        });
        fresh.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-equip-del]");
          if (!btn) return;
          _serviceDrawerItems.splice(Number(btn.dataset.equipDel), 1);
          _renderEquip();
          try { document.getElementById("serviceJobDrawer")?.dispatchEvent(new Event("input")); } catch (_) {}
        });
      }
    }
  }
  // wire ปุ่ม "+ เพิ่มอุปกรณ์" (idempotent) — เปิด picker จากสต็อก
  {
    const addBtn = $("serviceAddEquipmentBtn");
    if (addBtn) {
      const fresh = addBtn.cloneNode(true); addBtn.parentNode.replaceChild(fresh, addBtn);
      if (!_serviceDrawerEquipReadonly) {
        fresh.addEventListener("click", () => {
          _equipOpenPicker({ state, money, showToast }, (item) => {
            const ex = _serviceDrawerItems.find(it =>
              String(it.product_id) === String(item.product_id) && String(it.warehouse_id) === String(item.warehouse_id));
            if (ex) { ex.qty = Number(ex.qty) + 1; ex.line_total = ex.qty * Number(ex.unit_price || 0); }
            else _serviceDrawerItems.push(item);
            _renderEquip();
            try { document.getElementById("serviceJobDrawer")?.dispatchEvent(new Event("input")); } catch (_) {}
          });
        });
      }
    }
  }
  _renderEquip();
  ["serviceLabor","serviceDiscount"].forEach(id => {
    $(id)?.addEventListener("input", _recalc, { once: false });
  });

  // ★ Phase 88.11: Slip section — แสดงเมื่อ payment_method = transfer/qr
  $("serviceSlipUrl").value = job?.payment_slip_url || "";
  _updateServiceSlipSection();
  $("servicePaymentMethod")?.addEventListener("change", _updateServiceSlipSection);
  _wireServiceSlipUpload();

  // ★ Phase 88.12: Admin approve banner — แสดงเมื่อ "รออนุมัติ"
  // Phase 383: ใช้ isServiceJobPendingReview (status pending_review เก่า หรือ pending+note marker ใหม่)
  const approveBanner = document.getElementById("serviceApproveBanner");
  if (approveBanner) {
    approveBanner.style.display = isServiceJobPendingReview(job) ? "block" : "none";
  }
  // Wire approve button (idempotent — replace handler)
  const approveBtn = document.getElementById("serviceApproveBtn");
  const rejectBtn = document.getElementById("serviceRejectBtn");
  if (approveBtn) {
    const newApprove = approveBtn.cloneNode(true); approveBtn.parentNode.replaceChild(newApprove, approveBtn);
    newApprove.addEventListener("click", async () => {
      $("serviceStatus").value = "delivered";  // → save handler จะ trigger JV
      showToast?.("เปลี่ยน status เป็น 'ส่งมอบแล้ว' — กดบันทึกเพื่อลง JV");
      // Auto-click save
      document.getElementById("saveServiceJobBtn")?.click();
    });
  }
  if (rejectBtn) {
    const newReject = rejectBtn.cloneNode(true); rejectBtn.parentNode.replaceChild(newReject, rejectBtn);
    newReject.addEventListener("click", () => {
      $("serviceStatus").value = "progress";  // Phase 383: DB-safe (เดิม in_progress → 400); ส่งกลับให้ช่างทำต่อ
      showToast?.("เปลี่ยน status เป็น 'กำลังดำเนินการ' — กดบันทึกเพื่อส่งกลับ");
    });
  }

  // ★ Load before/after photos
  _setServicePhotoPreview("Before", job?.photo_before || "");
  _setServicePhotoPreview("After", job?.photo_after || "");

  // Phase 63 (C1): Share link button (only for existing jobs)
  _renderServiceJobShareSection(job);

  // Phase 68 (B3): Tag widget for service jobs
  _mountServiceJobTagWidget(job);

  openDrawer("serviceJobDrawer");
  if (!_serviceJobDrawerDraftBound) {
    const drawer = document.getElementById("serviceJobDrawer");
    if (drawer) {
      bindServiceDraft(drawer, SERVICE_JOB_DRAWER_DRAFT_KEY, SERVICE_JOB_DRAWER_DRAFT_FIELDS, () =>
        state.editingServiceJobId ? false : { items: _serviceDrawerItems }
      );
      _serviceJobDrawerDraftBound = true;
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  Phase 63 (C1): Service Job Share Link
// ═══════════════════════════════════════════════════════════
function _renderServiceJobShareSection(job) {
  const el = $("serviceJobShareSection");
  if (!el) return;
  if (!job || !job.id) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");

  const hasToken = !!job.share_token;
  const shareUrl = hasToken
    ? `${location.origin}${location.pathname.replace(/\/index\.html$/, "/")}share.html?type=service&token=${encodeURIComponent(job.share_token)}`
    : "";

  el.innerHTML = `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:18px">🔗</span>
        <h4 style="margin:0;font-size:14px;color:#1e40af;flex:1">Share link สำหรับลูกค้า</h4>
      </div>
      ${hasToken ? `
        <div style="font-size:12px;color:#475569;margin-bottom:8px">ลูกค้าเปิดดูสถานะงาน + รูปได้ผ่าน link นี้ (ไม่ต้อง login):</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <input id="sjShareUrl" readonly value="${escapeHtml(shareUrl)}" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-family:ui-monospace,monospace;background:#fff" />
          <button id="sjShareCopyBtn" type="button" style="padding:8px 14px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">📋 คัดลอก</button>
          <button id="sjShareLineBtn" type="button" style="padding:8px 14px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">📲 LINE</button>
          <button id="sjShareRevokeBtn" type="button" style="padding:8px 14px;background:#fff;color:#dc2626;border:1px solid #fecaca;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">ยกเลิก link</button>
        </div>
      ` : `
        <div style="font-size:12px;color:#475569;margin-bottom:8px">สร้าง link ให้ลูกค้าตรวจสอบสถานะงาน + รูปก่อน-หลัง</div>
        <button id="sjShareCreateBtn" type="button" style="padding:8px 14px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">🔗 สร้าง share link</button>
      `}
    </div>
  `;

  document.getElementById("sjShareCreateBtn")?.addEventListener("click", () => _generateShareToken(job));
  document.getElementById("sjShareCopyBtn")?.addEventListener("click", () => _copyShareUrl(shareUrl));
  document.getElementById("sjShareLineBtn")?.addEventListener("click", () => _shareToLine(job, shareUrl));
  document.getElementById("sjShareRevokeBtn")?.addEventListener("click", () => _revokeShareToken(job));
}
async function _generateShareToken(job) {
  try {
    const token = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2)) + Date.now().toString(36);
    const cfg = window.SUPABASE_CONFIG;
    const t = window._sbAccessToken;
    const r = await fetch(cfg.url + "/rest/v1/service_jobs?id=eq." + job.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + t, "Prefer": "return=representation" },
      body: JSON.stringify({ share_token: token })
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes("share_token") || r.status === 400) throw new Error("ตาราง service_jobs ยังไม่มี column share_token — รัน supabase-phase63-service-share.sql ก่อน");
      throw new Error("HTTP " + r.status);
    }
    const updated = await r.json();
    // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (create share button — single click per job row)
    job.share_token = (Array.isArray(updated) ? updated[0]?.share_token : updated?.share_token) || token;
    // update local state
    const idx = (state.serviceJobs || []).findIndex(j => j.id === job.id);
    if (idx >= 0) state.serviceJobs[idx].share_token = job.share_token;
    showToast("สร้าง share link สำเร็จ");
    _renderServiceJobShareSection(job);
  } catch(e) {
    showToast("สร้างไม่สำเร็จ: " + (e.message || e));
  }
}
async function _revokeShareToken(job) {
  if (!(await confirmAsync("ยกเลิก link นี้? — ลูกค้าจะเปิดดูสถานะไม่ได้แล้ว"))) return;
  try {
    const cfg = window.SUPABASE_CONFIG;
    const t = window._sbAccessToken;
    const r = await fetch(cfg.url + "/rest/v1/service_jobs?id=eq." + job.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + t, "Prefer": "return=minimal" },
      body: JSON.stringify({ share_token: null })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (revoke share button — single click per job row)
    job.share_token = null;
    const idx = (state.serviceJobs || []).findIndex(j => j.id === job.id);
    if (idx >= 0) state.serviceJobs[idx].share_token = null;
    showToast("ยกเลิก link แล้ว");
    _renderServiceJobShareSection(job);
  } catch(e) {
    showToast("ยกเลิกไม่สำเร็จ: " + (e.message || e));
  }
}
function _copyShareUrl(url) {
  if (!url) return;
  navigator.clipboard?.writeText(url).then(
    () => showToast("คัดลอก link แล้ว"),
    () => {
      const inp = $("sjShareUrl"); if (inp) { inp.select(); document.execCommand("copy"); showToast("คัดลอก link แล้ว"); }
    }
  );
}
function _shareToLine(job, url) {
  const text = `📋 ติดตามงาน ${job.customer_name || "ลูกค้า"}\n${job.description || job.device_name || ""}\n\nดูสถานะ: ${url}`;
  const lineUrl = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
  window.open(lineUrl, "_blank");
}

// ═══════════════════════════════════════════════════════════
//  Phase 88.11 — Slip upload + AI verification ใน drawer
// ═══════════════════════════════════════════════════════════
function _updateServiceSlipSection() {
  const sec = document.getElementById("serviceSlipSection");
  if (!sec) return;
  const pm = $("servicePaymentMethod")?.value || "";
  const showSection = /transfer|qr/.test(pm);
  sec.style.display = showSection ? "block" : "none";
  if (showSection) _renderSlipPreviewState();
}

function _renderSlipPreviewState() {
  const url = $("serviceSlipUrl")?.value || "";
  const preview = document.getElementById("serviceSlipPreview");
  const verifyBtn = document.getElementById("serviceSlipVerifyBtn");
  const removeBtn = document.getElementById("serviceSlipRemoveBtn");
  if (!preview) return;
  if (url) {
    preview.innerHTML = `<img src="${escapeHtml(url)}" alt="slip" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e2e8f0" />`;
    if (verifyBtn) verifyBtn.style.display = "inline-block";
    if (removeBtn) removeBtn.style.display = "inline-block";
  } else {
    preview.innerHTML = `<div style="color:#94a3b8;font-size:11px;font-style:italic">ยังไม่มีสลิป — เลือกรูปด้านล่าง</div>`;
    if (verifyBtn) verifyBtn.style.display = "none";
    if (removeBtn) removeBtn.style.display = "none";
  }
}

let _slipWired = false;
function _wireServiceSlipUpload() {
  if (_slipWired) return;
  _slipWired = true;

  const cameraFileEl  = document.getElementById("serviceSlipFile");
  const galleryFileEl = document.getElementById("serviceSlipGalleryFile");
  const cameraBtn     = document.getElementById("serviceSlipCameraBtn");
  const galleryBtn    = document.getElementById("serviceSlipGalleryBtn");
  const verifyBtn     = document.getElementById("serviceSlipVerifyBtn");
  const removeBtn     = document.getElementById("serviceSlipRemoveBtn");

  cameraBtn?.addEventListener("click", () => cameraFileEl?.click());
  galleryBtn?.addEventListener("click", () => galleryFileEl?.click());

  // Shared handler — ใช้กับทั้ง 2 inputs
  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // Local preview ก่อน upload
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById("serviceSlipPreview");
      if (preview) preview.innerHTML = `
        <img src="${ev.target.result}" alt="slip" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e2e8f0" />
        <div id="serviceSlipUploadStatus" style="font-size:11px;color:#0284c7;margin-top:4px">⏳ กำลังอัปโหลด...</div>
      `;
    };
    reader.readAsDataURL(f);

    // Upload to Supabase Storage
    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      const ts = Date.now();
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const filePath = `service-slips/drawer_${ts}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const upRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
        method: "POST",
        headers: {
          "apikey": cfg.anonKey,
          "Authorization": "Bearer " + token,
          "Content-Type": f.type || "image/jpeg",
          "x-upsert": "true"
        },
        body: f
      });
      if (!upRes.ok) throw new Error("HTTP " + upRes.status);
      const url = `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
      $("serviceSlipUrl").value = url;
      _renderSlipPreviewState();

      // Auto-verify ถ้าตั้ง payment_method = transfer/qr
      const pm = $("servicePaymentMethod")?.value || "";
      if (/transfer|qr/.test(pm)) {
        const dataUrl = await new Promise(resolve => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(f);
        });
        await _verifySlip(dataUrl);
      }
    } catch(err) {
      console.error("[slip upload]", err);
      const status = document.getElementById("serviceSlipUploadStatus");
      if (status) { status.textContent = "❌ อัปโหลดล้มเหลว: " + (err.message || err); status.style.color = "#dc2626"; }
    }
  };

  // Wire shared handler ให้ทั้ง camera + gallery
  cameraFileEl?.addEventListener("change", onPick);
  galleryFileEl?.addEventListener("change", onPick);

  verifyBtn?.addEventListener("click", async () => {
    const url = $("serviceSlipUrl")?.value;
    if (!url) return;
    // Fetch image → convert to data URL → verify
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const dataUrl = await new Promise(resolve => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(blob);
      });
      await _verifySlip(dataUrl);
    } catch(e) {
      const result = document.getElementById("serviceSlipVerifyResult");
      if (result) result.innerHTML = `<div style="color:#dc2626;font-size:12px">❌ ดึงรูปไม่สำเร็จ: ${escapeHtml(e.message)}</div>`;
    }
  });

  removeBtn?.addEventListener("click", async () => {
    if (typeof window.App?.confirm !== "function") return showToast("ระบบยืนยันยังไม่พร้อม กรุณาลองใหม่");
    if (!(await window.App.confirm("ลบสลิป?"))) return;
    $("serviceSlipUrl").value = "";
    document.getElementById("serviceSlipVerifyResult").innerHTML = "";
    _renderSlipPreviewState();
  });
}

async function _verifySlip(dataUrl) {
  const result = document.getElementById("serviceSlipVerifyResult");
  if (!result) return;
  // ★ Phase 92.66: /api/verify-slip อยู่ใน REQUIRE_AUTH_ENDPOINTS — ต้องแนบ Supabase JWT ของ staff ที่ login
  //   (anonKey เป็น sb_publishable_... ไม่ใช่ JWT → verifyAuthToken reject = 401). ไม่มี token/หมดอายุ → ขอ login ใหม่
  const _slipToken = window._sbAccessToken;
  const _slipAuthErrHtml = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">🔒 ต้องเข้าสู่ระบบก่อนตรวจสลิป — เซสชันหมดอายุหรือยังไม่ได้ล็อกอิน กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง</div>`;
  if (!_slipToken) { result.innerHTML = _slipAuthErrHtml; return; }
  result.innerHTML = `<div style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:12px">🤖 AI กำลังตรวจสลิป...</div>`;

  const expectedAmount = Number($("serviceTotalCost")?.value || 0);
  const expectedRecipient = (state.profile?.shop_name || state.storeInfo?.name || "บุญสุข").trim();

  try {
    const r = await fetch("/api/verify-slip", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _slipToken },
      body: JSON.stringify({ image: dataUrl, expected_amount: expectedAmount, expected_recipient: expectedRecipient }),
      cache: "no-store"
    });
    // 401 = token หมดอายุ/ถูกเพิกถอนระหว่างทาง → ขอ login ใหม่ แทน error กว้าง ๆ
    if (r.status === 401) { result.innerHTML = _slipAuthErrHtml; return; }
    const j = await r.json();
    if (!j.ok) {
      const debugInfo = [];
      if (j.model) debugInfo.push(`<div>model: <code>${escapeHtml(j.model)}</code></div>`);
      if (j.attempts) debugInfo.push(`<details><summary style="cursor:pointer">▼ attempts (${j.attempts.length})</summary><pre style="font-size:10px;overflow:auto;max-height:200px;background:#fff;padding:6px;border-radius:4px;margin-top:4px">${escapeHtml(JSON.stringify(j.attempts, null, 2))}</pre></details>`);
      if (j.raw) debugInfo.push(`<details><summary style="cursor:pointer">▼ Gemini raw response</summary><pre style="font-size:10px;overflow:auto;max-height:200px;background:#fff;padding:6px;border-radius:4px;margin-top:4px;white-space:pre-wrap">${escapeHtml(j.raw)}</pre></details>`);
      if (j.detail) debugInfo.push(`<details><summary style="cursor:pointer">▼ detail</summary><pre style="font-size:10px;overflow:auto;max-height:200px;background:#fff;padding:6px;border-radius:4px;margin-top:4px;white-space:pre-wrap">${escapeHtml(j.detail)}</pre></details>`);
      if (j.hint) debugInfo.push(`<div style="margin-top:6px;color:#92400e">💡 ${escapeHtml(j.hint)}</div>`);
      result.innerHTML = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">
        <div style="font-weight:700;margin-bottom:4px">❌ ${escapeHtml(j.error || "verification fail")}</div>
        ${debugInfo.join("")}
      </div>`;
      console.warn("[verify-slip] full response:", j);
      return;
    }
    const d = j.data || {};
    const v = j.verification || {};
    const isSafe = v.is_safe === true;
    const warningsHtml = (v.warnings || []).map(w => `<div style="color:#b91c1c;font-size:11px">${escapeHtml(w)}</div>`).join("");
    // tampering_signs (legacy array) หรือ tampering_note (single string ใหม่)
    const tampNotes = d.tampering_signs && Array.isArray(d.tampering_signs) ? d.tampering_signs : (d.tampering_note ? [d.tampering_note] : []);
    const tampHtml = tampNotes.map(s => `<div style="font-size:10px;color:#92400e">• ${escapeHtml(s)}</div>`).join("");
    result.innerHTML = `
      <div style="padding:10px;background:${isSafe ? '#f0fdf4' : '#fffbeb'};border:1px solid ${isSafe ? '#86efac' : '#fde68a'};border-radius:8px;font-size:12px">
        <div style="font-weight:700;color:${isSafe ? '#15803d' : '#92400e'};margin-bottom:6px">${isSafe ? '✅ ผ่านการตรวจสอบ' : '⚠️ ต้องตรวจเพิ่มเติม'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:#0f172a">
          <div><b>ผู้โอน:</b> ${escapeHtml(d.sender_name || '-')}</div>
          <div><b>ผู้รับ:</b> ${escapeHtml(d.recipient_name || '-')}</div>
          <div><b>ยอด:</b> ${d.amount ? Number(d.amount).toLocaleString() : '-'}</div>
          <div><b>วันที่:</b> ${escapeHtml(d.datetime || '-')}</div>
          <div style="grid-column:1/-1"><b>Ref:</b> <code style="font-size:11px">${escapeHtml(d.transaction_id || '-')}</code></div>
        </div>
        <div style="margin-top:6px;font-size:11px;color:#64748b">Confidence: ${d.confidence || '?'}/100 · Tampering score: ${d.tampering_score || 0}/100</div>
        ${warningsHtml ? `<div style="margin-top:6px">${warningsHtml}</div>` : ''}
        ${tampHtml ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:#92400e">▼ สัญญาณตัดต่อที่พบ</summary>${tampHtml}</details>` : ''}
      </div>
    `;
  } catch(e) {
    result.innerHTML = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">❌ ตรวจสลิปล้มเหลว: ${escapeHtml(e.message)}</div>`;
  }
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
  // Phase 402 (addendum): ห่อด้วย single-flight guard — กดบันทึกซ้ำขณะ inflight = no-op
  // (กัน double-submit → สร้างงานซ้ำ + ตัดสต็อกซ้ำ; release ใน finally ของ guard เสมอ)
  return _serviceJobSaveGuard.run(async () => {
  // ★ Phase 391: signal ผลการบันทึกจริง ให้ AI chat widget (กัน "success ปลอม" ตอน save fail)
  const _signalSave = (ok, detail) => {
    try { window.dispatchEvent(new CustomEvent(ok ? "service-job:saved" : "service-job:save-failed", { detail: detail || {} })); } catch (_) {}
  };
  const descVal = $("serviceTitle").value.trim();
  // ★ Phase 88.8: ค่าแรง/ส่วนลด/total_cost/payment_method สำหรับลง JV
  const totalCostVal = Number($("serviceTotalCost")?.value || 0);
  const paymentMethodVal = $("servicePaymentMethod")?.value || "";
  const payload = {
    customer_name:    $("serviceCustomer").value.trim(),
    customer_phone:   $("servicePhone").value.trim(),
    customer_address: $("serviceAddress").value.trim(),
    description:      descVal,
    job_type:         $("serviceType").value,
    status:           normalizeServiceJobStatus($("serviceStatus").value), // Phase 383: DB-safe (กัน 400 23514)
    note:             serviceJobNoteWithReviewMarker($("serviceNote").value.trim(), $("serviceStatus").value),
    photo_before:     $("serviceBeforeUrl")?.value?.trim() || null,
    photo_after:      $("serviceAfterUrl")?.value?.trim() || null,
    // Phase 88.8: บัญชี
    total_cost:       totalCostVal > 0 ? totalCostVal : 0,  // ★ Phase 393: 0 ไม่ null (service_jobs.total_cost = NOT NULL; auto_post gate >0 → 0 ไม่ mis-post)
    payment_method:   paymentMethodVal || null,
    // Phase 88.11: slip URL
    payment_slip_url: $("serviceSlipUrl")?.value?.trim() || null
  };
  // Phase 68 (B3): tags
  if (_serviceJobTagWidget) {
    try { payload.tags = _serviceJobTagWidget.getValue(); } catch(_){}
  }
  // ★ VALIDATE: ตรวจสอบข้อมูลก่อนส่ง
  if (!payload.customer_name || !payload.description) { _signalSave(false, { reason: "กรอกข้อมูลงานช่างให้ครบ" }); return showToast("กรอกข้อมูลงานช่างให้ครบ"); }
  if (payload.customer_phone && !isValidPhone(payload.customer_phone)) {
    _signalSave(false, { reason: "เบอร์โทรลูกค้าไม่ถูกต้อง" });
    return showToast("เบอร์โทรลูกค้าไม่ถูกต้อง (ต้องมี 10 หลักขึ้นไป)");
  }
  let res;
  const isNewJob = !state.editingServiceJobId;
  // ★ Phase 402 (MONEY/STOCK §4.1+§4.2): อุปกรณ์จากสต็อก — เฉพาะงานใหม่ (งานเดิม items read-only กันตัดซ้ำ)
  const _equipItemsForSave = (isNewJob && !_serviceDrawerEquipReadonly) ? _equipToItemsJson(_serviceDrawerItems) : [];
  if (_equipItemsForSave.length) {
    // precheck: รวม qty ต่อ (product|warehouse) เทียบสต็อกจริง → ไม่พอ = บล็อก ไม่บันทึก/ไม่ตัด (floor กันติดลบ)
    const pc = _equipPrecheck(_equipItemsForSave, state);
    if (!pc.ok) {
      const msg = "❌ สต็อกอุปกรณ์ไม่พอ: " + pc.shortages.map(s => `${s.name} (${s.warehouse_name}) ต้องใช้ ${s.need} เหลือ ${s.avail}`).join(" • ");
      _signalSave(false, { reason: msg });
      return showToast(msg);
    }
    payload.items_json = _equipItemsForSave;  // total_cost (serviceTotalCost) รวมอุปกรณ์อยู่แล้วผ่าน _recalc
  }
  // ★ Phase 404 (MONEY/STOCK §4.2): edit → cancelled (transition) → คืนสต็อกอุปกรณ์ (idempotent).
  //   คืนผ่าน _appApplyStockMovement("return") → trigger 403 sync products.stock; marker กันคืนซ้ำ.
  const shouldRestoreCancelledServiceStock =
    state.editingServiceJobId && payload.status === "cancelled" && state.editingServiceJobOrigStatus !== "cancelled";
  if (state.editingServiceJobId) {
    res = await xhrPatch("service_jobs", payload, "id", state.editingServiceJobId);
  } else {
    payload.job_no = "JOB-" + Date.now();
    // ★ Phase 88.1b: ขอ returnData=true เพื่อเอา id กลับมา auto-post JV
    res = await xhrPost("service_jobs", payload, { returnData: true });
  }
  if (!res.ok) { _signalSave(false, { reason: res.error?.message || "บันทึกงานช่างไม่สำเร็จ" }); return showToast(res.error?.message || "บันทึกงานช่างไม่สำเร็จ"); }

  // Restore cancelled-job stock only after service_jobs PATCH succeeds.
  if (shouldRestoreCancelledServiceStock) {
    const _job = (state.serviceJobs || []).find(j => String(j.id) === String(state.editingServiceJobId));
    if (_job) {
      try {
        const _r = await _equipRestoreStock({ ..._job, note: String(_job.note || "") });
        if (_r.restored && !String(payload.note || "").includes(_STOCK_RETURNED_MARKER)) {
          payload.note = payload.note ? `${payload.note} ${_STOCK_RETURNED_MARKER}` : _STOCK_RETURNED_MARKER;
          const markerRes = await xhrPatch("service_jobs", { note: payload.note }, "id", state.editingServiceJobId);
          if (!markerRes?.ok) {
            console.warn("[saveServiceJob] stock marker PATCH failed:", markerRes?.error?.message);
            showToast("⚠️ ยกเลิกสำเร็จแล้ว แต่แปะ marker คืนสต็อกไม่สำเร็จ — ห้ามกดยกเลิกซ้ำ", "warning");
          }
        }
        if (_r.errors?.length) showToast(`⚠️ คืนสต็อกอุปกรณ์บางรายการไม่สำเร็จ (${_r.errors.length}) — ตรวจ Console/สต็อก`, "warning");
      } catch (re) { console.error("[saveServiceJob] restore stock threw:", re); }
    }
  }

  // ★ Phase 402: ตัดสต็อกอุปกรณ์ — job insert สำเร็จก่อน → ค่อยตัด (invariant เหมือน service_form.js).
  //   ตัดผ่าน window._appApplyStockMovement (out/CAS/floor); ตัดบางตัว fail → ไม่ rollback job (เตือน reconcile §4.8)
  if (_equipItemsForSave.length) {
    const { stockOpsFailed } = await _equipDeduct(_equipItemsForSave, payload.job_no || "", payload.customer_name);
    _equipOptimistic(_equipItemsForSave, state);  // optimistic local (Phase 45.4) — ไม่ await loadAllData
    if (stockOpsFailed) {
      showToast("⚠️ บันทึกงานแล้ว แต่ตัดสต็อกอุปกรณ์บางรายการล้มเหลว — ตรวจ Console/สต็อก", "warning");
    }
  }

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

  // ★ Phase 391: บอก AI chat widget ว่า "บันทึกสำเร็จจริง" (พร้อม job_no) ก่อน reset state
  _signalSave(true, {
    job_no: payload.job_no || (isNewJob ? "" : String(state.editingServiceJobId || "")),
    id: state.editingServiceJobId || (Array.isArray(res.data) && res.data[0] && res.data[0].id) || null,
    isNew: isNewJob
  });

  closeAllDrawers();
  showToast("บันทึกงานช่างแล้ว");
  clearServiceDraft(SERVICE_JOB_DRAWER_DRAFT_KEY);

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
      // ★ Phase 391: await + handle result — job save สำเร็จแล้ว (LINE fail ต้องไม่ทำให้ fail) แต่ต้องเตือนชัด ไม่หลอกว่าส่งแล้ว
      const lr = await sendLineNotify(msg, { state, showToast }, "queue");
      const d = describeLineResult(lr, { context: "LINE คิวงาน" });
      if (d) showToast(d.msg, d.type);
    } catch (e) {
      console.warn("LINE notify (new service job) failed:", e);
      showToast("บันทึกงานแล้ว แต่ส่ง LINE คิวงานไม่สำเร็จ (network)", "warning");
    }
  }

  // ★ LINE notify เมื่อปิดงาน → กลุ่ม "ส่งงาน"
  // Phase 31 fix: ปิดงานนับ done / delivered / closed (ก่อนหน้าเช็คเฉพาะ "done" → "ส่งมอบแล้ว"/"ลูกค้ายืนยันปิดงาน" ไม่ส่ง LINE)
  const origStatus = state.editingServiceJobOrigStatus;
  const COMPLETION_STATUSES = ["done", "delivered", "closed"];
  const wasComplete = COMPLETION_STATUSES.includes(origStatus);
  const isNowComplete = COMPLETION_STATUSES.includes(payload.status);
  const transitionedToDone = !isNewJob && !wasComplete && isNowComplete;
  const newJobAlreadyComplete = isNewJob && isNowComplete;

  // ★ Phase 88.10b: ตรวจว่า amount/method เปลี่ยนหรือไม่ — trigger re-post แม้ status ไม่ transition
  const origTotalCost = Number(state.editingServiceJobOrigTotalCost ?? 0);
  const newTotalCost  = Number(payload.total_cost ?? 0);
  const totalChanged  = Math.abs(origTotalCost - newTotalCost) > 0.005;
  const methodChanged = (state.editingServiceJobOrigPaymentMethod || "") !== (payload.payment_method || "");
  // Edit งานเก่าที่ status complete อยู่แล้ว + แก้ค่าเงิน/method → ก็ต้อง re-post
  const editCompleteWithChange = !isNewJob && wasComplete && isNowComplete && (totalChanged || methodChanged);

  // ★ Phase 88.1b/88.8/88.10 — auto-post JV เมื่องานปิด
  //   trigger 3 case:
  //   1. transitionedToDone   — เพิ่ง transition pending → delivered
  //   2. newJobAlreadyComplete — สร้างใหม่ + status=delivered ทันที
  //   3. editCompleteWithChange — งานปิดอยู่แล้ว + user แก้ total/method (Phase 88.10b)
  if (transitionedToDone || newJobAlreadyComplete || editCompleteWithChange) {
    try {
      const jobId = isNewJob ? res.data?.id : state.editingServiceJobId;
      if (jobId) {
        const fullJob = { ...(state.serviceJobs || []).find(j => String(j.id) === String(jobId)), ...payload, id: jobId };
        // ถ้า edit + มี JV เก่า (transition หรือ change) → void ก่อน เพื่อให้ POST ใหม่ผ่าน
        const needsVoid = !isNewJob && (wasComplete || transitionedToDone);
        const prepareAndPost = async () => {
          if (needsVoid) {
            await voidJvForSource("service_jobs", jobId);
          }
          await postJournalForServiceJob(fullJob);
        };
        prepareAndPost().catch(e => console.warn("[saveServiceJob] auto-post JV failed:", e?.message));
      }
    } catch(e) { console.warn("[saveServiceJob] auto-post wire fail:", e?.message); }
  }

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
  }); // _serviceJobSaveGuard.run
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

// Phase 89.9 H10: Atomic decrement via Compare-And-Swap (PostgREST conditional UPDATE)
// Phase 89.11: extracted core logic to modules/stock_cas.js for unit testability;
// main.js now provides a thin wrapper that injects browser globals.
async function _atomicDecrementStock(table, rowId, qty, field = "stock", maxRetries = 3) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg) return { ok: false, error: "missing SUPABASE_CONFIG" };
  return atomicDecrementStock({
    fetcher: fetch,
    supabaseUrl: cfg.url,
    anonKey: cfg.anonKey,
    accessToken: window._sbAccessToken || cfg.anonKey,
    table, rowId, qty, field, maxRetries,
  });
}

// Phase 92.5x (audit S3): atomic +/- delta wrapper (reuse stock_cas atomicAddToField) — กัน lost update ใน manual stock moves
async function _atomicAddStock(table, rowId, delta, field = "stock", maxRetries = 3) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg) return { ok: false, error: "missing SUPABASE_CONFIG" };
  return atomicAddToField({
    fetcher: fetch,
    supabaseUrl: cfg.url,
    anonKey: cfg.anonKey,
    accessToken: window._sbAccessToken || cfg.anonKey,
    table, rowId, field, delta, maxRetries,
  });
}

async function _deductStockForSaleItem({ product, qty, orderNo }) {
  if (!product || !qty || qty <= 0) return;
  // ข้าม service / non_stock
  if (product.product_type === "service" || product.product_type === "non_stock") return;

  // Phase 45.3: stock_movements.created_by เป็น uuid → ส่ง auth user id
  const creatorUuid = state.currentUser?.id || null;

  // หาคลังที่มีสต็อกเหลือ > 0 — prefer "บ้าน" ก่อน ไม่งั้นเอาคลังที่มีสต็อกมากสุด
  // (ใช้ cache แค่เพื่อเลือก warehouse — ค่า stock จริงจะ refetch ภายใน CAS)
  const stocks = (state.warehouseStock || []).filter(ws =>
    String(ws.product_id) === String(product.id) && Number(ws.stock || 0) > 0
  );

  // Phase 89.35: hoist dec outside if-block so skipProductsCas (below) can read it
  let dec = null;
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
    const whName = state.warehouses.find(w => w.id === ws.warehouse_id)?.name || "?";

    // Phase 89.9 H10: atomic CAS decrement (กัน 2 checkout พร้อมกันตัดสต็อกซ้ำ)
    dec = await _atomicDecrementStock("warehouse_stock", ws.id, qty);
    const before = dec.ok ? dec.before : Number(ws.stock || 0);
    const after = dec.ok ? dec.after : (before - qty);

    if (!dec.ok) {
      console.error("[deductStock] warehouse_stock CAS failed:", dec.error);
      // Phase 367: insufficient = floor ที่ CAS กันขายเกินสต็อก (ติดลบ) → toast ชัด
      if (dec.insufficient) {
        showToast(`⚠️ สต็อกไม่พอ: ${product.name} (เหลือ ${dec.before})`);
      } else {
        showToast("⚠️ ตัดสต็อกคลังไม่สำเร็จ: " + dec.error);
      }
    } else {
      // eslint-disable-next-line require-atomic-updates -- A: local cache sync after CAS-protected mutation (Phase 89.9 H10)
      ws.stock = after; // sync local cache เพื่อ render ถัดไป
      console.debug(`[deductStock] ${product.name}: ${whName} ${before} → ${after} (qty ${qty}, atomic)`);
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

  // Phase 403: products.stock = sum(warehouse_stock) ผ่าน DB trigger (canonical derived).
  //   - stocks.length>0 (warehouse ถูกตัดด้านบน) → trigger sync products.stock เอง →
  //     ที่นี่ทำแค่ optimistic local (sum จาก cache) ไม่เขียน products.stock ตรง (กันตัดซ้ำ sum−qty).
  //     warehouse CAS fail → ไม่แตะ products.stock local (ให้ retry/sync).
  //   - stocks.length===0 (ไม่มี warehouse row ที่มีของ) → warehouse ไม่เปลี่ยน → trigger ไม่ fire →
  //     คง legacy products.stock write ตรง (สินค้า track เฉพาะ products.stock ไม่มี warehouse).
  if (stocks.length > 0) {
    if (dec?.ok) {
      // eslint-disable-next-line require-atomic-updates -- A: local cache sync only (products.stock DB owned by trigger)
      product.stock = (state.warehouseStock || [])
        .filter(w => String(w.product_id) === String(product.id))
        .reduce((s, w) => s + Number(w.stock || 0), 0);
    }
  } else {
    const dec2 = await _atomicDecrementStock("products", product.id, qty);
    const curStock = dec2.ok ? dec2.before : Number(product.stock || 0);
    const newStock = dec2.ok ? dec2.after : (curStock - qty);
    if (!dec2.ok) {
      console.warn("[deductStock] products.stock CAS failed (legacy no-warehouse):", dec2.error);
      showToast("⚠️ อัพเดทสต็อกสินค้าไม่สำเร็จ: " + dec2.error);
    } else {
      // eslint-disable-next-line require-atomic-updates -- A: local cache sync after CAS (legacy path)
      product.stock = newStock;
    }
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

// ═══════════════════════════════════════════════════════════
//  Phase 89.3: Revert stock จาก POS sale ที่ถูก soft-deleted
//  best-effort: ถ้าทำ partial ก็จะ toast เตือน + ไม่ throw
//  Strategy:
//    1. query sale_items where sale_id = saleId
//    2. สำหรับแต่ละ item — เพิ่ม stock_movement type="return_sale" qty=+
//    3. คืน warehouse_stock + products.stock (เลือก warehouse ที่ขายเดิม จาก movement เก่า)
// ═══════════════════════════════════════════════════════════
async function _revertStockForSale({ saleId, orderNo }) {
  if (!saleId) return { ok: false, error: "no saleId" };
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const creatorUuid = state.currentUser?.id || null;

  // ★ Phase 410 (§4.2): idempotency gate — note มี marker = เคยคืนสต็อกแล้ว → no-op
  //   (กันคืนเบิ้ลจากกดซ้ำ/ยิงซ้ำ/ลบพร้อมกันจากเครื่องอื่น — อ่าน note สดจาก DB ไม่ใช่ cache)
  //   GET ล้ม → fail-closed: ห้ามเดินหน้า revert ทั้งที่เช็ค marker ไม่ได้ (กันคืนซ้ำสำคัญกว่า
  //   ความสะดวก — caller โชว์ toast partial อยู่แล้ว, ลองใหม่ได้)
  let saleNote = "";
  try {
    const nr = await fetch(cfg.url + "/rest/v1/sales?id=eq." + saleId + "&select=note", { headers });
    if (!nr.ok) return { ok: false, error: "เช็คสถานะคืนสต็อกไม่ได้: HTTP " + nr.status };
    const noteRows = await nr.json().catch(() => null);
    if (!Array.isArray(noteRows)) return { ok: false, error: "เช็คสถานะคืนสต็อกไม่ได้: bad response" };
    saleNote = String(noteRows[0]?.note || "");
  } catch (e) {
    return { ok: false, error: "เช็คสถานะคืนสต็อกไม่ได้: " + (e?.message || e) };
  }
  if (saleNote.includes(_STOCK_RETURNED_MARKER)) {
    return { ok: true, reverted: 0, skipped: true, errors: [] };
  }

  const errors = [];
  try {
    // 1. fetch sale_items
    const r = await fetch(cfg.url + "/rest/v1/sale_items?sale_id=eq." + saleId + "&select=*", { headers });
    if (!r.ok) return { ok: false, error: "fetch sale_items HTTP " + r.status };
    const items = await r.json().catch(() => []);
    if (!Array.isArray(items) || items.length === 0) {
      // ไม่มี items (ขายผ่าน numpad ไม่ใส่ cart) → ไม่ต้องคืนสต็อก
      return { ok: true, reverted: 0, message: "ไม่มี sale_items" };
    }

    let revertedCount = 0;
    for (const item of items) {
      if (!item.product_id || !item.qty) continue;
      const product = (state.products || []).find(p => String(p.id) === String(item.product_id));
      if (!product) {
        errors.push(`สินค้า id=${item.product_id} ไม่พบ — ข้าม`);
        continue;
      }
      if (product.product_type === "service" || product.product_type === "non_stock") continue;
      const qty = Number(item.qty || 0);
      if (qty <= 0) continue;

      // 2a. หา warehouse_stock ที่จะคืนสต็อก — เลือก "บ้าน" ก่อน, ไม่งั้น row แรกที่เจอ
      const stocks = (state.warehouseStock || []).filter(ws => String(ws.product_id) === String(product.id));
      let targetWs = null;
      if (stocks.length > 0) {
        const sorted = [...stocks].sort((a, b) => {
          const nameA = (state.warehouses.find(w => w.id === a.warehouse_id)?.name || "");
          const nameB = (state.warehouses.find(w => w.id === b.warehouse_id)?.name || "");
          const aHome = nameA.includes("บ้าน") ? 1 : 0;
          const bHome = nameB.includes("บ้าน") ? 1 : 0;
          return bHome - aHome;
        });
        targetWs = sorted[0];
      }
      const whName = targetWs ? (state.warehouses.find(w => w.id === targetWs.warehouse_id)?.name || "?") : "(no warehouse)";

      // 2b. คืน warehouse_stock += qty (ถ้ามี) — Phase 403: trigger จะ sync products.stock เอง
      // ★ Phase 410 (§4.2): เขียนผ่าน CAS (_atomicAddStock refetch ค่าจริงก่อนเขียน) —
      //   ห้าม absolute write จากค่า cache (lost update ทับการขาย/โอนจากเครื่องอื่น)
      //   CAS fail → ข้าม item นี้ (ไม่ log movement / ไม่นับ reverted — สต็อกไม่ได้คืนจริง)
      if (targetWs) {
        const add = await _atomicAddStock("warehouse_stock", targetWs.id, qty);
        if (!add.ok) {
          errors.push(`${product.name}: warehouse_stock CAS fail — ${add.error || "RLS?"}`);
          continue;
        }
        targetWs.stock = add.after; // sync local cache จากค่าจริงที่ CAS คืน

        // 2c. Phase 403: products.stock = sum(warehouse_stock) ผ่าน DB trigger (canonical derived).
        //   warehouse +qty ด้านบน → trigger sync products.stock เอง → ที่นี่ optimistic local (sum)
        //   ไม่เขียน products.stock ตรง (กันบวกซ้ำ sum+qty).
        product.stock = (state.warehouseStock || [])
          .filter(w => String(w.product_id) === String(product.id))
          .reduce((s, w) => s + Number(w.stock || 0), 0);
      } else {
        // legacy: ไม่มี warehouse row → trigger 403 ไม่ fire → เขียน products.stock ตรง (ผ่าน CAS)
        const add2 = await _atomicAddStock("products", product.id, qty);
        if (!add2.ok) {
          errors.push(`${product.name}: products.stock CAS fail — ${add2.error || "RLS?"}`);
          continue;
        }
        product.stock = add2.after;
      }

      // 2d. log return movement
      // Phase 92.13: type "return_sale" ละเมิด stock_movements_type_check (23514) → ใช้ "return"
      //   (semantic เดียวกัน: สต็อกคืนกลับคลัง; เป็นค่าที่ flow คืนสินค้า/หน้า movement ใช้อยู่แล้ว)
      // ★ Phase 410: log fail = warn เท่านั้น — ห้าม rollback สต็อกที่คืนสำเร็จแล้ว (ขนาน Phase 368)
      const mv = await xhrPost("stock_movements", {
        product_id: product.id,
        type: "return",
        qty: qty,
        note: `คืนสต็อกจากลบ POS ${orderNo || '#' + saleId} — คลัง: ${whName} +${qty}`,
        created_by: creatorUuid
      });
      if (!mv?.ok) console.warn("[revertStock] movement log fail:", mv?.error?.message || "unknown");
      revertedCount++;
    }

    // ★ Phase 410: แปะ marker เมื่อคืนได้อย่างน้อย 1 รายการ (รวม partial — ถ้าไม่แปะ
    //   แล้วมี retry รอบใหม่ item ที่คืนสำเร็จแล้วจะถูกคืนซ้ำ = สต็อกพองเกินจริง = เสี่ยง
    //   oversell; รายการที่ fail surface ผ่าน errors ให้แอดมินแก้ทาง stock_movements)
    //   ทุก item fail (revertedCount=0) → ไม่แปะ marker (retry รอบหน้าได้เต็ม ๆ)
    if (revertedCount > 0) {
      let latestNote = saleNote;
      try {
        const gr = await fetch(cfg.url + "/rest/v1/sales?id=eq." + saleId + "&select=note", { headers });
        if (gr.ok) {
          const grRows = await gr.json().catch(() => null);
          if (Array.isArray(grRows)) latestNote = String(grRows[0]?.note || "");
        }
      } catch (e) { console.warn("[revertStock] re-fetch note fail (ใช้ค่าจาก gate แทน):", e?.message); }
      if (!latestNote.includes(_STOCK_RETURNED_MARKER)) {
        const mk = await xhrPatch("sales", { note: latestNote ? `${latestNote} ${_STOCK_RETURNED_MARKER}` : _STOCK_RETURNED_MARKER }, "id", saleId);
        if (!mk.ok) {
          // ห้าม rollback สต็อก (สต็อกถูกแล้ว) — แค่ surface ความเสี่ยงให้แอดมินเห็น
          console.warn("[revertStock] marker PATCH fail:", mk.error?.message);
          errors.push("แปะ marker กันคืนซ้ำไม่สำเร็จ — เสี่ยงคืนซ้ำถ้าลบใหม่");
        }
      }
    }

    return { ok: errors.length === 0, reverted: revertedCount, errors };
  } catch (e) {
    return { ok: false, error: e?.message || "revert exception" };
  }
}
window._appRevertStockForSale = _revertStockForSale;

// Phase 374: หลัง RPC atomic transfer สำเร็จ — RPC คืนแค่ {ok:true} ไม่คืน id/ค่าใหม่ →
//   refetch 2 แถว warehouse_stock ที่กระทบ (source+target) แล้ว upsert เข้า state.warehouseStock
//   (อัปเดต stock แถวเดิมตาม id / push แถว target ใหม่พร้อม id จริง).
//   best-effort: refetch ล้ม → warn เฉย ๆ (โอนสำเร็จใน DB แล้ว ไม่ทำให้ผลโอน fail).
async function _syncWarehouseRowsAfterTransfer(productId, fromWarehouseId, toWarehouseId) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const url = cfg.url + "/rest/v1/warehouse_stock?product_id=eq." + encodeURIComponent(productId)
      + "&warehouse_id=in.(" + encodeURIComponent(fromWarehouseId) + "," + encodeURIComponent(toWarehouseId) + ")"
      + "&select=id,product_id,warehouse_id,stock,min_stock";
    const r = await fetch(url, { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
    if (!r.ok) { console.warn("[transferWarehouseStock] cache refetch HTTP " + r.status + " (transfer ok)"); return; }
    const rows = await r.json().catch(() => null);
    if (!Array.isArray(rows)) return;
    state.warehouseStock = state.warehouseStock || [];
    for (const row of rows) {
      if (!row?.id) continue;
      const existing = state.warehouseStock.find(w => String(w.id) === String(row.id));
      if (existing) {
        existing.stock = row.stock;
        existing.min_stock = row.min_stock;
      } else {
        state.warehouseStock.push({
          id: row.id, product_id: row.product_id, warehouse_id: row.warehouse_id,
          stock: row.stock, min_stock: row.min_stock
        });
      }
    }
  } catch (e) {
    console.warn("[transferWarehouseStock] cache refetch threw (transfer ok):", e?.message || e);
  }
}

// ★ ย้ายสต็อกระหว่างคลัง — ใช้โดย stock_movements module
// Phase 374: ลอง RPC atomic (DB func transfer_warehouse_stock) ก่อน → atomicity จริงใน 1 tx;
//   RPC ใช้ไม่ได้ (deploy เก่า/function หาย) → fallback ไป logic multi-xhr เดิม (best-effort) ด้านล่าง.
// Phase 368: harden warehouse transfer — CAS + floor (source) + rollback (target-fail only).
//   เดิม: raw xhrPatch ทั้ง 2 ฝั่ง, ไม่เช็ค .ok (xhrPost/xhrPatch resolve {ok:false} ไม่ throw →
//         try/catch จับไม่ติด), ไม่มี floor → โอนเกินต้นทาง = เขียนติดลบ; target ล้ม = ของหาย.
//   ใหม่: source ใช้ _atomicDecrementStock (floor จาก 367 กันติดลบ + CAS กัน race);
//         target ใช้ _atomicAddStock / xhrPost(returnData); target ล้มหลัง source ตัดสำเร็จ → คืน source.
//   ❌ ไม่แตะ products.stock (โอนระหว่างคลัง = ผลรวมไม่เปลี่ยน → ถูกแล้ว).
async function _transferWarehouseStock({ productId, fromWarehouseId, toWarehouseId, qty, note }) {
  if (!productId || !fromWarehouseId || !toWarehouseId || qty <= 0) {
    return { ok: false, error: "ข้อมูลไม่ครบ" };
  }
  if (String(fromWarehouseId) === String(toWarehouseId)) {
    return { ok: false, error: "คลังต้นทาง/ปลายทาง ต้องไม่ซ้ำกัน" };
  }

  // Phase 368: normalize qty ครั้งเดียว — ใช้ transferQty ตลอด (กัน string เช่น "5")
  const transferQty = Number(qty);
  if (!(transferQty > 0)) {
    return { ok: false, error: "จำนวนไม่ถูกต้อง" };
  }

  // Phase 45.3: stock_movements.created_by เป็น uuid
  const creatorUuid = state.currentUser?.id || null;

  // ── Phase 374: ลอง RPC atomic ก่อน ──
  //   DB func public.transfer_warehouse_stock(): source−/target+/log movement ใน 1 transaction
  //   + FOR UPDATE lock + rollback อัตโนมัติ → atomicity จริง (ดีกว่า multi-xhr client-side, known-risk 368).
  //   func คืน jsonb เสมอ (HTTP 200): success {ok:true} · ไม่พอ {ok:false,insufficient:true,error} · อื่น {ok:false,error}.
  //   RPC ใช้ไม่ได้จริง (HTTP 404 / PostgREST PGRST202 "function not found" / network throw) → fallback ทางเดิมด้านล่าง.
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const r = await fetch(cfg.url + "/rest/v1/rpc/transfer_warehouse_stock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify({
        p_product_id: productId,
        p_from_wh: fromWarehouseId,
        p_to_wh: toWarehouseId,
        p_qty: transferQty,
        p_note: note || null,
        p_created_by: creatorUuid,
      }),
    });
    if (r.status === 404) throw new Error("rpc unavailable: HTTP 404");
    const payload = await r.json().catch(() => null);
    // PostgREST แจ้ง function ไม่พบด้วย code PGRST202 → RPC ใช้ไม่ได้ → fallback
    if (payload && payload.code === "PGRST202") throw new Error("rpc unavailable: PGRST202");
    // func คืน jsonb พร้อม HTTP 200 เสมอ; ถ้า !ok และไม่ใช่ 404/PGRST202 = RPC ใช้ไม่ได้ → fallback
    if (!r.ok) throw new Error("rpc http " + r.status);
    if (payload && payload.ok === true) {
      // โอนสำเร็จใน DB แล้ว — sync cache (RPC ไม่คืน id/ค่าใหม่ → refetch 2 แถวที่กระทบ)
      await _syncWarehouseRowsAfterTransfer(productId, fromWarehouseId, toWarehouseId);
      return { ok: true };
    }
    if (payload && payload.ok === false) {
      // business result ที่ถูกต้อง (เช่น สต็อกต้นทางไม่พอ) — ❌ อย่า fallback
      return { ok: false, insufficient: !!payload.insufficient, error: payload.error || "โอนไม่สำเร็จ" };
    }
    // payload รูปไม่ตรง spec → ถือว่า RPC ใช้ไม่ได้ → fallback
    throw new Error("rpc unexpected payload");
  } catch (rpcErr) {
    console.warn("[transferWarehouseStock] RPC unavailable → fallback to legacy multi-xhr:", rpcErr?.message || rpcErr);
    // ตกลงมา = ใช้ logic multi-xhr เดิมด้านล่าง (best-effort, known-risk 368)
  }

  // ── 1. source — CAS + floor (Phase 368) ──
  const srcWs = (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(fromWarehouseId)
  );
  // ไม่มี source row (ไม่มีสินค้านี้ในคลังต้นทาง) → ห้ามสร้าง row ต้นทาง (กันติดลบ)
  if (!srcWs?.id) {
    return { ok: false, error: "คลังต้นทางไม่มีสินค้านี้" };
  }
  const dec = await _atomicDecrementStock("warehouse_stock", srcWs.id, transferQty);
  if (!dec.ok) {
    return {
      ok: false,
      insufficient: dec.insufficient,
      error: dec.insufficient ? `สต็อกต้นทางไม่พอ (เหลือ ${dec.before})` : dec.error,
    };
  }
  // source ตัดสำเร็จแล้ว — ตั้งแต่นี้ถ้า target ล้ม ต้อง rollback คืน source

  // ── 2. target — เพิ่ม (มี row → CAS add; ไม่มี → insert ขอ id กลับ) ──
  const tgtWs = (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(toWarehouseId)
  );
  let tgtAfter = null;
  let newTgtRow = null;
  if (tgtWs?.id) {
    const add = await _atomicAddStock("warehouse_stock", tgtWs.id, transferQty);
    if (!add.ok) {
      // ── 3. rollback: target ล้มหลัง source ตัดสำเร็จ → คืน source ──
      await _atomicAddStock("warehouse_stock", srcWs.id, transferQty);
      return { ok: false, error: "โอนไม่สำเร็จ (คืนสต็อกต้นทางแล้ว)" };
    }
    tgtAfter = add.after;
  } else {
    const res = await xhrPost(
      "warehouse_stock",
      { product_id: productId, warehouse_id: toWarehouseId, stock: transferQty, min_stock: 0 },
      { returnData: true }
    );
    if (!res.ok || !res.data?.id) {
      // ── 3. rollback: insert ปลายทางล้มหลัง source ตัดสำเร็จ → คืน source ──
      await _atomicAddStock("warehouse_stock", srcWs.id, transferQty);
      return { ok: false, error: "โอนไม่สำเร็จ (คืนสต็อกต้นทางแล้ว)" };
    }
    // cache row ใหม่ต้องมี id จริงจาก DB (ไม่ใช่ row ไม่มี id)
    newTgtRow = { id: res.data.id, product_id: productId, warehouse_id: toWarehouseId, stock: transferQty, min_stock: 0 };
  }

  // ── 4. sync cache หลัง source+target สำเร็จ ──
  // eslint-disable-next-line require-atomic-updates -- local cache sync after CAS-protected mutation (Phase 368)
  srcWs.stock = dec.after;
  if (tgtWs?.id) {
    // eslint-disable-next-line require-atomic-updates -- local cache sync after CAS-protected mutation (Phase 368)
    tgtWs.stock = tgtAfter;
  } else if (newTgtRow) {
    state.warehouseStock.push(newTgtRow);
  }

  // ── 5. log movement = best-effort — ❌ ห้าม rollback ถ้า log ล้ม! ──
  //   transfer สำเร็จไปแล้ว (source ตัด + target เพิ่มเรียบร้อย); rollback ตอนนี้ =
  //   source คืนแต่ target ยังเพิ่ม = เพี้ยนหนักกว่าเดิม → log fail แค่ warn แล้วยัง ok:true
  try {
    const fromName = state.warehouses.find(w => String(w.id) === String(fromWarehouseId))?.name || "?";
    const toName   = state.warehouses.find(w => String(w.id) === String(toWarehouseId))?.name || "?";
    const logRes = await xhrPost("stock_movements", {
      product_id: productId,
      type: "transfer",
      qty: transferQty,
      note: `โอนย้าย: ${fromName} → ${toName} | ${dec.before}→${dec.after}${note ? " — " + note : ""}`.slice(0, 200),
      created_by: creatorUuid
    });
    if (logRes && !logRes.ok) {
      console.warn("[transferWarehouseStock] log movement failed (transfer ok):", logRes.error?.message);
    }
  } catch (e) {
    console.warn("[transferWarehouseStock] log movement threw (transfer ok):", e?.message || e);
  }

  // ── 6. source + target สำเร็จ → ok (ไม่ว่า log จะสำเร็จหรือไม่) ──
  return { ok: true };
}

// ★ อัพเดทสต็อกใน warehouse — ใช้โดย stock_movements module (in/out/sale/return/adjust)
// Phase 369: out/sale ตัดผ่าน floor (_atomicDecrementStock จาก 367) เป็น default — กัน
//   service-job auto-deduct (ac_install/service_form/solar → "out") เขียนค่าติดลบ.
//   allowNegative:true = manual override (หน้า stock_movements มี confirm เตือนติดลบแล้ว)
//   → คงพฤติกรรมเดิม (admin จงใจให้ติดลบได้).
async function _applyStockMovement({ productId, warehouseId, movementType, qty, note, allowNegative = false }) {
  if (!productId || qty <= 0 || !movementType) return { ok: false, error: "ข้อมูลไม่ครบ" };
  // Phase 45.3: schema ใช้ created_by uuid → ต้องส่ง user uuid (auth.users.id) ไม่ใช่ email
  const creatorUuid = state.currentUser?.id || null;

  const ws = warehouseId ? (state.warehouseStock || []).find(w =>
    String(w.product_id) === String(productId) && String(w.warehouse_id) === String(warehouseId)
  ) : null;

  // ★ audit S3: delta moves (in/out/return/sale) ใช้ atomic CAS กัน lost update เหมือน POS/credit path.
  //   adjust = ตั้งค่าใหม่ absolute (manual override) → ใช้ set ตรง (ไม่ใช่ delta) คงเดิม
  const isAdjust = movementType === "adjust";
  const isOutFlow = (movementType === "out" || movementType === "sale");  // Phase 369: floored when !allowNegative
  const delta = (movementType === "in" || movementType === "return") ? qty
              : isOutFlow ? -qty
              : 0;
  const before = Number(ws?.stock || 0);
  let after = isAdjust ? qty : before + delta;  // best-effort สำหรับ audit note (CAS คืนค่าจริงด้านล่าง)

  try {
    if (warehouseId) {
      if (ws?.id) {
        if (isAdjust) {
          await xhrPatch("warehouse_stock", { stock: after }, "id", ws.id);
        } else if (isOutFlow && !allowNegative) {
          // Phase 369: floor — out/sale ตัดด้วย _atomicDecrementStock (กันติดลบ + CAS)
          const dec = await _atomicDecrementStock("warehouse_stock", ws.id, qty);
          if (dec.insufficient) {
            // ❌ สต็อกไม่พอ → return ทันที "ก่อน" log stock_movements (ห้าม log หลอกว่าตัดสำเร็จ)
            return { ok: false, insufficient: true, error: `สต็อกคลังไม่พอ (เหลือ ${dec.before})` };
          }
          if (dec.ok) {
            after = dec.after;
            ws.stock = after;
          } else {
            // ล้มแบบอื่น (ไม่ใช่ insufficient) → best-effort เดิม
            console.warn("[applyStockMovement] warehouse_stock CAS failed:", dec.error);
          }
        } else {
          // in/return (delta>0) หรือ allowNegative out/sale (admin override) → คงพฤติกรรมเดิม
          const dec = await _atomicAddStock("warehouse_stock", ws.id, delta);
          if (dec.ok) {
            after = dec.after;
            ws.stock = after;
          } else {
            console.warn("[applyStockMovement] warehouse_stock CAS failed:", dec.error);
          }
        }
      } else {
        // ไม่มี row ในคลังนี้ (สต็อก 0)
        if (isOutFlow && !allowNegative) {
          // Phase 369: ❌ ห้าม insert row stock ติดลบ (ขนานกับ transfer 368 "ไม่มี source row")
          return { ok: false, insufficient: true, error: "คลังนี้ไม่มีสินค้านี้ (สต็อก 0)" };
        }
        // in/return (after>0) หรือ allowNegative out/sale (manual override ผ่าน confirm) → insert ตามเดิม
        await xhrPost("warehouse_stock", { product_id: productId, warehouse_id: warehouseId, stock: after, min_stock: 0 });
      }
    }

    // Phase 403: products.stock = sum(warehouse_stock) ผ่าน DB trigger (canonical derived).
    //   เลิกเขียน products.stock ตรง (เดิม CAS/decrement = mirror เปราะ → diverge ได้). warehouse
    //   เพิ่ง update ด้านบน → trigger sync products.stock ฝั่ง DB ให้เอง. ที่นี่ทำแค่ optimistic
    //   local recompute (sum จาก warehouseStock cache ที่เพิ่ง sync) — reload ได้ค่าจริงจาก trigger.
    try {
      const prod = (state.products || []).find(p => String(p.id) === String(productId));
      if (prod && warehouseId) {
        prod.stock = (state.warehouseStock || [])
          .filter(w => String(w.product_id) === String(productId))
          .reduce((s, w) => s + Number(w.stock || 0), 0);
      }
    } catch(e){
      console.warn("[applyStockMovement] local products.stock recompute threw:", e);
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

// Phase 89.41: single-flight guard prevents double-click race
// (2nd checkout() call while 1st await is pending returns immediately, no-op)
const _checkoutGuard = createInflightGuard();

// Phase 402 (addendum): single-flight guard for saveServiceJob — กดบันทึกซ้ำตอน save ยัง inflight
// = สร้างงานซ้ำ + ตัดสต็อกซ้ำ (double-deduct). guard นี้ปิดช่องนั้น (ตัวเดียวกับ POS checkout)
const _serviceJobSaveGuard = createInflightGuard();

async function checkout(){
  return _checkoutGuard.run(async () => {
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
  // Phase 89.41: race is prevented by _checkoutGuard single-flight (no concurrent invocation can reach this line)
  // eslint-disable-next-line require-atomic-updates
  state.cart = [];
  saveCart();
  // Phase 45.11: openReceiptDrawer ใช้ state.lastReceipt (set โดย loadReceipt) — ไม่ต้องรอ loadAllData
  openReceiptDrawer();
  showToast("บันทึกการขายเรียบร้อย");
  setTimeout(() => loadAllData().catch(e => console.warn("[checkout] reload", e)), 100);

  // ★ Phase 88.1 — auto-post JV (fire-and-forget, ไม่ block UX)
  postJournalForSale({
    id: saleId,
    order_no: orderNo,
    customer_name: salePayload.customer_name,
    payment_method: salePayload.payment_method,
    total_amount: salePayload.total_amount,
    created_at: new Date().toISOString()
  }).catch(e => console.warn("[checkout] auto-post JV failed:", e?.message));

  // ═══ Line Notify: แจ้งขาย + เตือนสต็อกใกล้หมด ═══
  _notifySaleToLine({ orderNo, cartSnapshot: salePayload, items: state.lastReceipt?.items || [] }).catch(e => console.warn("[lineNotify sale] skipped:", e?.message));
  });
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
    // Phase 90.7: ?v=APP_BUILD cache-bust
    const { sendLineNotify } = await import(_bustedUrl("./modules/line_notify.js"));
    await sendLineNotify(message, { state, showToast }, "default");
  } catch (e) {
    console.warn("[_notifySaleToLine] error:", e?.message || e);
  }
}

// ═══════════════════════════════════════════════════════════
//  RECEIPT
// ═══════════════════════════════════════════════════════════
async function loadReceipt(saleId){
  // Phase 92.11: ใช้ fetch + AbortController timeout แทน Supabase JS client
  // (client "ค้างบนมือถือ" — ดู pos.js receipt-load) และคืน {ok, error} ให้ caller
  // ตัดสินใจ UX. เดิม: state.supabase null → throw → ปุ่ม "เปิดบิล" เงียบ;
  // client hang → ปุ่มตายถาวร; query error → return เงียบ ๆ ไม่มี feedback.
  try {
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg?.url) return { ok: false, error: { message: "ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase" } };
    const tk = window._sbAccessToken || cfg.anonKey;
    const hdrs = { "apikey": cfg.anonKey, "Authorization": "Bearer " + tk };
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 8000); // 8s timeout กัน hang บนมือถือ
    let saleRes, itemsRes;
    try {
      [saleRes, itemsRes] = await Promise.all([
        fetch(cfg.url + "/rest/v1/sales?id=eq." + encodeURIComponent(saleId) + "&select=*", { headers: hdrs, signal: ctrl.signal }).then(r => r.json()),
        fetch(cfg.url + "/rest/v1/sale_items?sale_id=eq." + encodeURIComponent(saleId) + "&select=*&order=id.asc", { headers: hdrs, signal: ctrl.signal }).then(r => r.json())
      ]);
    } finally {
      clearTimeout(tmr);
    }
    // PostgREST: select คืน array; error คืน object {code,message,...}
    const saleData = Array.isArray(saleRes) ? saleRes[0] : null;
    const itemsData = Array.isArray(itemsRes) ? itemsRes : [];
    if (!saleData) {
      const errObj = (saleRes && (saleRes.message || saleRes.code)) ? saleRes : { message: "ไม่พบใบเสร็จ" };
      console.warn("[loadReceipt] no sale row:", errObj);
      return { ok: false, error: errObj };
    }
    state.lastReceipt = { ...saleData, items: itemsData };
    saveReceipt();
    renderReceiptDrawer();
    return { ok: true, error: null };
  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.warn("[loadReceipt] failed:", e?.message || e);
    return { ok: false, error: { message: aborted ? "โหลดใบเสร็จช้าเกินไป (timeout)" : (e?.message || "โหลดใบเสร็จไม่สำเร็จ") } };
  }
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
    <hr>
    <div class="row mt16" style="align-items:center"><div>เอกสารบัญชี</div>
      <div id="receiptAcctTrace" style="text-align:right">
        <span style="font-size:12px;color:#94a3b8">⏳ กำลังตรวจสอบ...</span>
      </div>
    </div>
  `);
  // Phase 92.17: forward accounting trace — fetch JV ของบิลนี้แล้วเติม section (async, single sale)
  _fillReceiptAcctTrace(lastSale);
}

// ★ Phase 405: ใบเสร็จที่เด้งตอนจบบิลยิง lookup JV ก่อน auto_post สร้าง JV (postJournalForSale อยู่หลัง
//   await loadAllData ใน doCheckout = JV เกิดช้าหลายวินาที) → lookup แรกได้ "missing" + badge ค้างเหลือง.
//   แก้: ถ้า missing → โชว์ "กำลังลงบัญชี…" + retry lookup จน JV โผล่ (สูงสุด MAX_RETRY ครั้ง ทุก RETRY_MS)
//   → badge เด้ง "ลงบัญชีแล้ว" เองไม่ต้องปิด-เปิด. หยุด retry ถ้าเปลี่ยนบิล/ปิด drawer.
//   genuinely-unposted (before-effective/post fail) → ครบ retry → คงเหลือง (honest). display-only (read-only lookup).
const RECEIPT_TRACE_MAX_RETRY = 6;
const RECEIPT_TRACE_RETRY_MS = 1500;

// แสดงสถานะเอกสารบัญชีในใบเสร็จที่เปิดอยู่ — found → กดไปสมุดรายวัน, missing/error → ข้อความชัด
async function _fillReceiptAcctTrace(sale, attempt = 0){
  let res;
  try {
    res = await findJournalForSale(sale);
  } catch (e) {
    console.warn("[receipt acct-trace] lookup error:", e?.message);
    res = { ok:false, found:false, status:"error", entry:null };
  }
  const slot = document.getElementById("receiptAcctTrace");
  if (!slot) return; // drawer ถูกปิด/เปลี่ยนบิลไปแล้ว
  // ★ Phase 405: JV ยังไม่ลง (auto_post กำลังทำงานหลังจบบิล) → โชว์ "กำลังลงบัญชี…" + retry จนเจอ/ครบ
  if (res.status === "missing" && attempt < RECEIPT_TRACE_MAX_RETRY) {
    slot.innerHTML = `<span style="font-size:12px;color:#94a3b8">⏳ กำลังลงบัญชี…</span>`;
    setTimeout(() => {
      const lr = state.lastReceipt;
      // retry เฉพาะถ้ายังเป็นใบเสร็จเดิม + drawer ยังเปิด (กัน poll บิลที่ปิด/เปลี่ยนไปแล้ว)
      if (lr && String(lr.id) === String(sale?.id) && document.getElementById("receiptAcctTrace")) {
        _fillReceiptAcctTrace(sale, attempt + 1);
      }
    }, RECEIPT_TRACE_RETRY_MS);
    return;
  }
  slot.innerHTML = renderSaleTraceBadge(res);
  const badgeEl = slot.querySelector(".sale-acct-trace");
  if (badgeEl) {
    // Phase 92.20: deep-link → ปิด receipt drawer ก่อนแล้วเปิด JV drawer ทันที (ไม่ใช่แค่ไปหน้ารายวัน)
    const goto = () => { closeAllDrawers(); navigateToJv(badgeEl.dataset.jvId); };
    badgeEl.addEventListener("click", goto);
    badgeEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goto(); } });
  }
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
  // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (admin loadUsers — single admin click)
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
      await new Promise(r => { setTimeout(r, 800); });
      try {
        const patchPayload = { full_name: fullName };
        if (role && role !== "sales") patchPayload.role = role;
        const res = await xhrPatch("profiles", patchPayload, "id", signUpResult.userId);
        if (!res.ok) console.warn("[addNewUser] PATCH profiles failed:", res.error);
        // ★ ถ้า PATCH ไม่สำเร็จ (อาจ trigger ยังไม่สร้าง row) → ลอง UPSERT
        if (!res.ok) {
          await new Promise(r => { setTimeout(r, 600); });
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

// ═══════════════════════════════════════════════════════════
//  Phase 53: GLOBAL SEARCH — products / customers / sales / quotations
// ═══════════════════════════════════════════════════════════
function _gsEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function _gsRenderItem(icon, title, sub, amount, action) {
  return `<div class="gs-item" data-action="${_gsEsc(action)}">
    <div class="gs-item-icon">${icon}</div>
    <div class="gs-item-body">
      <div class="gs-item-title">${_gsEsc(title)}</div>
      ${sub ? `<div class="gs-item-sub">${_gsEsc(sub)}</div>` : ""}
    </div>
    ${amount ? `<div class="gs-item-amount">${_gsEsc(amount)}</div>` : ""}
  </div>`;
}
function _gsCurrency(n) {
  return "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n || 0));
}
const _gsClose = () => {
  const dd = $("globalSearchDropdown");
  if (dd) { dd.classList.add("hidden"); dd.innerHTML = ""; }
};
const _gsHandleClick = (action) => {
  // action could be "type:id" or "quick-add-X:query" — split on first colon only
  const idx = action.indexOf(":");
  const type = idx >= 0 ? action.slice(0, idx) : action;
  const id = idx >= 0 ? action.slice(idx + 1) : "";
  _gsClose();
  $("globalSearch").value = "";
  if (type === "product")    { showRoute("products"); setTimeout(() => openProductDrawer && state.products.find(p => String(p.id) === id) && openProductDrawer(state.products.find(p => String(p.id) === id)), 100); }
  else if (type === "customer") { showRoute("customers"); setTimeout(() => { const c = state.customers.find(x => String(x.id) === id); if (c && openCustomerDrawer) openCustomerDrawer(c); }, 100); }
  else if (type === "sale")     showRoute("sales");
  else if (type === "quotation") showRoute("quotations");
  // Phase 58 A1: quick-add — open drawer/page with name pre-filled
  else if (type === "quick-add-customer") { showRoute("customers"); setTimeout(() => openCustomerDrawer && openCustomerDrawer({ name: id, contact_type: "customer" }), 100); }
  else if (type === "quick-add-product")  { showRoute("products"); setTimeout(() => openProductDrawer && openProductDrawer({ name: id }), 100); }
  else if (type === "quick-add-quotation"){ showRoute("quotations"); setTimeout(() => { const btn = document.querySelector("#qtNewBtn,[data-action='create-quotation']"); btn?.click(); }, 200); }
};

const globalSearch = debounce(function(){
  const q = $("globalSearch")?.value?.trim().toLowerCase() || "";
  const dd = $("globalSearchDropdown");
  if (!dd) return;
  if (q.length < 2) { dd.classList.add("hidden"); dd.innerHTML = ""; return; }

  const role = currentRole();
  const allowed = allowedPages();
  let html = "";

  // 1) Products (max 5)
  if (allowed.includes("products") || allowed.includes("pos") || allowed.includes("customer_dashboard")) {
    const products = (state.products || [])
      .filter(p =>
        String(p.name||"").toLowerCase().includes(q) ||
        String(p.sku||"").toLowerCase().includes(q) ||
        String(p.barcode||"").toLowerCase().includes(q)
      )
      .slice(0, 5);
    if (products.length) {
      html += `<div class="gs-section-label">📦 สินค้า (${products.length})</div>`;
      html += products.map(p => _gsRenderItem("🏷️", p.name || "-", p.sku || "", _gsCurrency(p.price || 0), `product:${p.id}`)).join("");
    }
  }

  // 2) Customers (max 5)
  if (allowed.includes("customers") || role === "admin") {
    const customers = (state.customers || [])
      .filter(c =>
        String(c.name||"").toLowerCase().includes(q) ||
        String(c.phone||"").toLowerCase().includes(q) ||
        String(c.email||"").toLowerCase().includes(q)
      )
      .slice(0, 5);
    if (customers.length) {
      html += `<div class="gs-section-label">👤 ลูกค้า (${customers.length})</div>`;
      html += customers.map(c => _gsRenderItem("👤", c.name || "-", c.phone || c.email || "", "", `customer:${c.id}`)).join("");
    }
  }

  // 3) Sales (order_no) (max 5)
  if (allowed.includes("sales")) {
    const sales = visibleSalesForRole(state.sales, state.profile, state.currentUser)
      .filter(s =>
        String(s.order_no||"").toLowerCase().includes(q) ||
        String(s.customer_name||"").toLowerCase().includes(q)
      )
      .slice(0, 5);
    if (sales.length) {
      html += `<div class="gs-section-label">💳 บิลขาย (${sales.length})</div>`;
      html += sales.map(s => _gsRenderItem("🧾", s.order_no || ("#"+s.id), s.customer_name || "ลูกค้าทั่วไป", _gsCurrency(s.total_amount || 0), `sale:${s.id}`)).join("");
    }
  }

  // 4) Quotations (max 5)
  if (allowed.includes("quotations")) {
    const quotations = (state.quotations || [])
      .filter(q2 =>
        String(q2.quotation_no||"").toLowerCase().includes(q) ||
        String(q2.customer_name||"").toLowerCase().includes(q)
      )
      .slice(0, 5);
    if (quotations.length) {
      html += `<div class="gs-section-label">📄 ใบเสนอราคา (${quotations.length})</div>`;
      html += quotations.map(q2 => _gsRenderItem("📄", q2.quotation_no || ("#"+q2.id), q2.customer_name || "-", _gsCurrency(q2.grand_total || q2.total_amount || 0), `quotation:${q2.id}`)).join("");
    }
  }

  // Phase 58 (A1): quick-add suggestions when search has results — speed up walk-in customer entry
  let quickAdd = "";
  if (q.length >= 2) {
    const acts = [];
    if ((allowed.includes("customers") || role === "admin")) acts.push({ icon: "👤", label: `+ สร้างลูกค้า "${q}"`, action: `quick-add-customer:${q}` });
    if (allowed.includes("products")) acts.push({ icon: "📦", label: `+ สร้างสินค้า "${q}"`, action: `quick-add-product:${q}` });
    if (allowed.includes("quotations")) acts.push({ icon: "📄", label: `+ สร้างใบเสนอราคา (ลูกค้า: ${q})`, action: `quick-add-quotation:${q}` });
    if (acts.length) {
      quickAdd = `<div class="gs-section-label">⚡ สร้างใหม่</div>` +
        acts.map(a => _gsRenderItem(a.icon, a.label, "", "", a.action)).join("");
    }
  }
  if (!html) html = `<div class="gs-empty">ไม่พบ "${_gsEsc(q)}" ในระบบ</div>` + quickAdd;
  else html += quickAdd + `<div class="gs-hint">💡 กด Esc เพื่อปิด • คลิกเพื่อเปิด</div>`;

  dd.innerHTML = html;
  dd.classList.remove("hidden");
}, 200);

// ═══════════════════════════════════════════════════════════
//  BIND EVENTS
// ═══════════════════════════════════════════════════════════
function bindStaticEvents(){
  $("loginBtn")?.addEventListener("click", login);
  $("forgotPasswordBtn")?.addEventListener("click", requestStaffPasswordReset);
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
  $("menuToggle")?.addEventListener("click", toggleSidebar);
  // ★ Phase 399: topbar 🔔 bell → ไปจัดการสต็อกใกล้หมด · 👤 profile menu (settings / logout)
  $("notifBell")?.addEventListener("click", () => showRoute("products"));
  {
    const closeProfileMenu = () => {
      $("profileMenu")?.classList.add("hidden");
      $("profileChip")?.setAttribute("aria-expanded", "false");
    };
    $("profileChip")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("profileMenu");
      if (!menu) return;
      const willOpen = menu.classList.contains("hidden");
      menu.classList.toggle("hidden");
      $("profileChip")?.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    $("profileMenu")?.addEventListener("click", (e) => {
      const item = e.target.closest(".profile-menu-item");
      if (!item) return;
      closeProfileMenu();
      if (item.dataset.act === "settings") showRoute("settings");
      else if (item.dataset.act === "logout") window.__authLogout?.();   // ★ reuse auth.js logout (ไม่เขียนเอง)
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".topbar-profile-wrap")) closeProfileMenu(); });
  }
  $("backdrop")?.addEventListener("click", () => { closeSidebar(); closeAllDrawers(); });
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
      // eslint-disable-next-line require-atomic-updates -- A: UI file input reset, single upload handler per click
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
      // eslint-disable-next-line require-atomic-updates -- A: UI file input reset, single upload handler per click
      e.target.value = "";
    });
    $(`service${which}GalleryFile`)?.addEventListener("change", async (e) => {
      await _handleServicePhotoUpload(which, e.target.files?.[0]);
      // eslint-disable-next-line require-atomic-updates -- A: UI file input reset, single upload handler per click
      e.target.value = "";
    });
  });
  $("printReceiptBtn")?.addEventListener("click", printLastReceipt);
  $("pdfReceiptBtn")?.addEventListener("click", exportReceiptPdf);
  $("shareReceiptLineBtn")?.addEventListener("click", shareReceiptToLine);
  $("addNewUserBtn")?.addEventListener("click", addNewUser);
  $("setPasswordBtn")?.addEventListener("click", submitNewPassword);
  $("setPwRequestNewBtn")?.addEventListener("click", requestNewRecoveryLink);  // Phase 406: ลิงก์หมดอายุ → ขอใหม่
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

  // Phase 53: global search — extend to all entities
  $("globalSearch")?.addEventListener("input", globalSearch);
  $("globalSearch")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { _gsClose(); $("globalSearch").value = ""; }
  });
  // click on dropdown item
  $("globalSearchDropdown")?.addEventListener("click", (e) => {
    const item = e.target.closest(".gs-item");
    if (item) _gsHandleClick(item.dataset.action);
  });
  // click outside → close
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search-wrap")) _gsClose();
  });

  // ═══════════════════════════════════════════════════════════
  //  Phase 54: KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════
  document.addEventListener("keydown", (e) => {
    // ignore if typing in input/textarea/contenteditable
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) {
      // exception: Esc + "/" still handled
      if (e.key !== "Escape") return;
    }

    // skip if modifier (let browser handle Ctrl+R, Ctrl+F, etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const allowed = allowedPages();
    let handled = false;

    switch (e.key) {
      case "/":
        // focus global search
        e.preventDefault();
        $("globalSearch")?.focus();
        handled = true;
        break;
      case "?":
        // show help popup
        e.preventDefault();
        _showShortcutHelp();
        handled = true;
        break;
      case "F1":
        if (allowed.includes("customers")) { e.preventDefault(); showRoute("customers"); handled = true; }
        break;
      case "F2":
        if (allowed.includes("products")) { e.preventDefault(); showRoute("products"); handled = true; }
        break;
      case "F3":
        if (allowed.includes("pos")) { e.preventDefault(); showRoute("pos"); handled = true; }
        break;
      case "F4":
        if (allowed.includes("sales")) { e.preventDefault(); showRoute("sales"); handled = true; }
        break;
      case "F8":
        if (allowed.includes("service_jobs")) { e.preventDefault(); showRoute("service_jobs"); handled = true; }
        break;
      case "F9":
        if (allowed.includes("quotations")) { e.preventDefault(); showRoute("quotations"); handled = true; }
        break;
      case "Escape":
        // close drawers / dropdown
        _gsClose();
        document.getElementById("shortcutHelpModal")?.remove();
        break;
    }
    if (handled) {
      try { showToast("⌨️ " + e.key, "info"); } catch(_) {}
    }
  });
}

function _showShortcutHelp() {
  document.getElementById("shortcutHelpModal")?.remove();
  const role = currentRole();
  const allowed = allowedPages();
  const shortcuts = [
    { key: "/",  label: "ค้นหา (focus search bar)", show: true },
    { key: "F1", label: "👤 ลูกค้า", show: allowed.includes("customers") },
    { key: "F2", label: "📦 สินค้า", show: allowed.includes("products") },
    { key: "F3", label: "💰 แคชเชียร์ (POS)", show: allowed.includes("pos") },
    { key: "F4", label: "💳 รายการขาย", show: allowed.includes("sales") },
    { key: "F8", label: "🔧 ใบรับงาน (ช่าง)", show: allowed.includes("service_jobs") },
    { key: "F9", label: "📄 ใบเสนอราคา", show: allowed.includes("quotations") },
    { key: "Esc", label: "ปิด popup / dropdown", show: true },
    { key: "?", label: "แสดงเมนูคีย์ลัด", show: true },
  ].filter(s => s.show);

  const modal = document.createElement("div");
  modal.id = "shortcutHelpModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:440px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <div style="font-size:28px">⌨️</div>
        <div style="flex:1">
          <h3 style="margin:0;font-size:18px;color:#0f172a">คีย์ลัด</h3>
          <div style="font-size:12px;color:#64748b">role: ${ROLE_LABELS[role] || role}</div>
        </div>
        <button id="shortcutHelpCloseBtn" style="border:none;background:#f1f5f9;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px">×</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${shortcuts.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 10px;background:#f8fafc;border-radius:8px">
            <kbd style="background:#0f172a;color:#fff;font-family:ui-monospace,monospace;font-size:12px;padding:4px 10px;border-radius:6px;font-weight:700;min-width:42px;text-align:center">${s.key}</kbd>
            <div style="font-size:13px;color:#334155">${s.label}</div>
          </div>
        `).join("")}
      </div>
      <div style="margin-top:14px;padding:10px;background:#fef3c7;border-radius:10px;font-size:11px;color:#92400e;line-height:1.5">
        💡 <b>เคล็ดลับ:</b> กด <kbd style="background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #fde68a">/</kbd> เพื่อค้นหาทุกอย่างจากแถบบนสุด
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById("shortcutHelpCloseBtn")?.addEventListener("click", () => modal.remove());
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
// Phase 92.1: body extracted to modules/branding.js. Local wrapper preserves the existing
// closure identity used by call sites at L421/L975/L4687 and by window.App.updateAppLogos.
function updateAppLogos() {
  _updateAppLogosImpl({ documentRef: document, getLogo: () => window._appGetLogo?.() });
}
// Expose ให้ modules อื่นเรียกได้ (Phase 36 — settings/pages.js logo upload)
window.updateAppLogos = updateAppLogos;

// Phase 92.10: boot orchestration moved to modules/boot.js. main.js no longer
// self-invokes on load — runBoot binds live deps so ลำดับ + behavior เหมือนเดิม.
runBoot({
  initDarkMode,
  bindStaticEvents,
  updateAppLogos,
  initSupabase,
  afterLogin,
  syncLogo: () => window._appSyncLogo(),
  getCurrentUser: () => state.currentUser,
});
