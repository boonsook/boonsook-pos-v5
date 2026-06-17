
function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
function moneyNum(n){return new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));}

import { escHtml, visibleSalesForRole, isAdminProfile, todayBkk } from "./utils.js";
// Phase 88.1a: auto-post JV หลังบันทึกการขาย (background, non-blocking)
import { postJournalForSale } from "./accounting/auto_post.js";
// Phase 89.42: single-flight guard for POS checkout (replaces brittle window._checkoutRunning manual flag)
import { createInflightGuard } from "./_inflight_guard.js";

// Phase 89.42 — Site 2 fix: rapid double-tap on "เสร็จสิ้น" was relying on
// window._checkoutRunning with 3 manual reset points (lines 1121, 1128, 1240).
// Replaced with encapsulated guard whose finally{} guarantees release even on throw.
const _posCheckoutGuard = createInflightGuard();

// ★ XHR helper — delegate to window._appXhrPost when available
function xhrPostPOS(table, payload, returnData = false) {
  // ★ FIX: delegate to global helper ที่ใช้ร่วมกัน (main.js) ถ้ามี
  if (typeof window._appXhrPost === "function") {
    return window._appXhrPost(table, payload, { returnData });
  }
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", cfg.url + "/rest/v1/" + table);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Prefer", returnData ? "return=representation" : "return=minimal");
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        const txt = xhr.responseText;
        if (txt && txt.trim()) {
          try { data = JSON.parse(txt); } catch (e) {
            console.warn("[xhrPostPOS] JSON.parse failed:", e, txt.slice(0, 200));
          }
        }
        resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
      } else {
        const errBody = xhr.responseText;
        let msg = "HTTP " + xhr.status;
        try {
          const parsed = JSON.parse(errBody);
          msg = parsed.message || parsed.details || parsed.hint || msg;
          console.error("[xhrPostPOS] " + table + " ERROR:", parsed);
        } catch (e) {
          console.error("[xhrPostPOS] " + table + " ERROR raw:", errBody);
        }
        resolve({ ok: false, data: null, error: msg });
      }
    };
    xhr.onerror = function () { resolve({ ok: false, data: null, error: "Network error" }); };
    xhr.ontimeout = function () { resolve({ ok: false, data: null, error: "Timeout" }); };
    // ★ ส่งเป็น object เดียว (ไม่ wrap array) — PostgREST รับได้ทั้ง object และ array
    xhr.send(JSON.stringify(payload));
  });
}

// ═══════════════════════════════════════════════════════════
//  POS FLOW (ตาม FlowAccount):
//  home → quick-numpad → payment-select → (cash | transfer | card) → done
//  home → products → payment-select → ...
//  home → scanner
//  home → qr-show (ดู QR รับเงินอย่างเดียว)
// ═══════════════════════════════════════════════════════════
let posView = "home";
let selectedPaymentMethod = "";
// Phase 88.20: เลือกบัญชีธนาคารปลายทางสำหรับการโอน (index ใน paymentInfo.banks[])
let selectedBankIdx = 0;
// Phase 464: คลังที่เลือกขาย (คลังเดียวต่อบิล) — "" = อัตโนมัติ (บ้านก่อน เหมือนเดิม); ตัดทั้งบิลจากคลังนี้
let _posWarehouseId = (() => { try { return localStorage.getItem("bsk_pos_warehouse") || ""; } catch(_e) { return ""; } })();
// Phase 464: กัน double-add จาก double-fire จอสัมผัส (1 แตะ = 2 click) — จำ id+เวลา add ล่าสุด
let _posLastAdd = { id: null, t: 0 };

// ═══════════════════════════════════════════════════════════
// Phase 89.2: helper round-to-2-decimals
// กัน float drift: 0.1 + 0.2 = 0.30000000000000004 → round2(...) = 0.3
// ═══════════════════════════════════════════════════════════
// Phase 89.18: export for unit test
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ★ Phase 398: gross profit = subtotal (ex-VAT) − COGS (Σ ต้นทุน×จำนวน จาก products.cost = source เดียวกับ sale_items.unit_cost)
//   คืน null ถ้าตะกร้าว่าง (quick-pay) — ไม่ inflate กำไร. ไม่แตะสูตรยอด/VAT — เพิ่ม field อย่างเดียว.
export function _computeGrossProfit(cart, products, subtotal) {
  if (!Array.isArray(cart) || cart.length === 0) return null;
  const cogs = cart.reduce((s, it) => {
    const p = (products || []).find(x => x.id === it.id);
    return s + Number(p?.cost || 0) * (Number(it.qty) || 1);
  }, 0);
  return round2(Number(subtotal || 0) - cogs);
}

// Phase 92.14: cart subtotal helper — round2 ที่ source กัน float drift propagate
//   (เดิม inline `cart.reduce((s,i)=>s+i.qty*i.price,0)` หลายจุด → ยอด/เงินทอนที่โชว์เพี้ยน
//    เช่น 3 × 33.30 = 99.90000000001). checkout write path round2 อยู่แล้ว — นี่คุม in-memory/display
export function cartSum(cart) {
  return round2((cart || []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0));
}

// ═══════════════════════════════════════════════════════════
// Phase 88.21: VAT helper — คำนวณ VAT จาก paymentInfo settings
// ═══════════════════════════════════════════════════════════
/**
 * @param {number} amount - ยอดเงิน (ขึ้นกับ mode)
 * @param {object} paymentInfo - state.paymentInfo
 * @param {string} [currentDate] - YYYY-MM-DD date used to gate vatEffectiveDate
 * @returns {{subtotal:number, vat:number, total:number, rate:number, enabled:boolean, mode:string}}
 */
// Phase 89.18: export for unit test
export function calcVAT(amount, paymentInfo, currentDate = todayBkk()) {
  const rate = Number(paymentInfo?.vatRate || 0);
  const effectiveDate = String(paymentInfo?.vatEffectiveDate || "").slice(0, 10);
  const effectiveReached = !!effectiveDate && String(currentDate || "").slice(0, 10) >= effectiveDate;
  const enabled = !!paymentInfo?.vatEnabled && rate > 0 && effectiveReached;
  if (!enabled) {
    return { subtotal: amount, vat: 0, total: amount, rate: 0, enabled: false, mode: "none" };
  }
  const mode = paymentInfo?.vatPriceMode || "inclusive";
  if (mode === "inclusive") {
    // amount รวม VAT แล้ว → แยกออก
    const subtotal = Math.round((amount * 100 / (100 + rate)) * 100) / 100;
    const vat = Math.round((amount - subtotal) * 100) / 100;
    return { subtotal, vat, total: amount, rate, enabled, mode };
  } else {
    // exclusive: amount ยังไม่รวม VAT → บวก VAT
    const vat = Math.round((amount * rate / 100) * 100) / 100;
    return { subtotal: amount, vat, total: Math.round((amount + vat) * 100) / 100, rate, enabled, mode };
  }
}
let numpadValue = "";
let quickPayAmount = 0;   // ยอดจาก numpad (เก็บเงินทันที) หรือ cart total
let pendingPaidAmount = 0; // จำนวนเงินที่รับมา (สำหรับเงินสด)
let scannerInstance = null;
let _posScanSessionId = 0;
let _posScannerActive = false;
let _posScanInProgress = false;
let _posAbort = null;     // ★ AbortController สำหรับลบ event listeners เก่า
let _posCustomer = null;  // ★ Customer ที่เลือก {id, name, phone}

// Phase 45.10 (B5-5): expose clear ให้ logout เรียก (กัน cross-login leak)
export function clearPosState() {
  _posCustomer = null;
  posView = "home";
  selectedPaymentMethod = "";
  numpadValue = "";
  quickPayAmount = 0;
  pendingPaidAmount = 0;
}

export function renderPosPage({ state, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer }) {
  const ctx = { state, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer };
  posView = "home";
  numpadValue = "";
  quickPayAmount = 0;
  renderPosView(ctx);
}

function renderPosView(ctx) {
  const { state } = ctx;
  const cartTotal = cartSum(state.cart);
  const cartQty = state.cart.reduce((sum,i)=>sum+i.qty,0);
  const el = document.getElementById("page-pos");

  // ★ Cleanup: abort all old event listeners before re-rendering
  if (_posAbort) _posAbort.abort();
  _posAbort = new AbortController();
  const signal = _posAbort.signal;

  // ═══════════════════════════════════════════════════════
  //  HOME — แบนเนอร์ยอดขายวันนี้ + ปุ่มเมนู
  // ═══════════════════════════════════════════════════════
  if (posView === "home") {
    // Phase 89.24 / 89.27: non-admin เห็นเฉพาะ sales ของตัวเอง — admin เห็นรวมทุกคน
    // Server-side filter + visibleSalesForRole = defense-in-depth (helper เป็น no-op สำหรับ non-admin data)
    const isAdmin = isAdminProfile(state.profile);
    const todaySales = visibleSalesForRole(state.sales, state.profile, state.currentUser)
      .filter(s => {
        const d = new Date(s.created_at);
        const today = new Date();
        return d.toDateString() === today.toDateString();
      });
    const todayTotal = todaySales.reduce((s,i)=>s+Number(i.total_amount||0),0);

    // ★ Phase 36 — Recent sales for "อัพเดทล่าสุด" feed (5 ล่าสุด)
    const recentSales = todaySales
      .slice()
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
    const logoUrl = (typeof window !== "undefined" && window._appGetLogo) ? window._appGetLogo() : "./icons/logo.svg";

    el.innerHTML = `
      <!-- Sales Banner — Phase 36: + logo circle, ขยายยอด -->
      <div class="pos-banner">
        <div class="pos-banner-top">
          <div class="pos-banner-logo" style="width:56px;height:56px;border-radius:50%;background:#fff;overflow:hidden;flex-shrink:0;display:grid;place-items:center;box-shadow:0 4px 12px rgba(0,0,0,.12)">
            <img src="${escHtml(logoUrl)}" alt="" style="width:56px;height:56px;object-fit:cover;display:block" onerror="this.src='./icons/logo.svg'" />
          </div>
          <button id="posSalesHistory" class="pos-history-btn">🕒 ประวัติการขาย ›</button>
        </div>
        <div class="pos-banner-label">วันนี้ขายได้${isAdmin ? "" : " <span style=\"font-size:11px;font-weight:500;opacity:.85;background:rgba(255,255,255,.22);padding:2px 8px;border-radius:10px;margin-left:6px\">เฉพาะของคุณ</span>"}</div>
        <div class="pos-banner-amount">฿${moneyNum(todayTotal)}</div>
        <div class="pos-banner-count">จาก ${todaySales.length} ออเดอร์</div>
      </div>

      <!-- Quick Action Grid — Phase 36: 6 ปุ่ม (3 cols × 2 rows) + circle icons -->
      <div class="pos-action-grid">
        <button class="pos-action-btn" id="posQuickPay">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">🧮</div></div>
          <div class="pos-action-label">เก็บเงินทันที</div>
        </button>
        <button class="pos-action-btn" id="posSelectProduct">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">🛒</div></div>
          <div class="pos-action-label">เลือกสินค้า</div>
        </button>
        <button class="pos-action-btn" id="posScanBtn">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">📷</div></div>
          <div class="pos-action-label">สแกนเนอร์</div>
        </button>
        <button class="pos-action-btn" id="posShowQR">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">📱</div></div>
          <div class="pos-action-label">QR รับเงิน</div>
        </button>
        <button class="pos-action-btn" id="posServiceJobs">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">🔧</div></div>
          <div class="pos-action-label">งานช่าง</div>
        </button>
        <button class="pos-action-btn" id="posReports">
          <div class="pos-action-icon-wrap"><div class="pos-action-icon">📊</div></div>
          <div class="pos-action-label">รายงาน</div>
        </button>
      </div>

      <!-- ★ Customer Picker (always visible, even without cart) -->
      <div class="panel" style="padding:10px 14px;display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:13px;color:#64748b;font-weight:600">👤 ลูกค้า:</span>
            ${_posCustomer ? `
              <span style="background:#dbeafe;color:#1e40af;padding:4px 10px;border-radius:8px;font-weight:700;font-size:13px">${escHtml(_posCustomer.name)}${_posCustomer.phone ? ' • ' + escHtml(_posCustomer.phone) : ''}</span>
              <button id="posCustClear" class="btn light" style="font-size:11px;padding:3px 8px;color:#dc2626" title="ล้างลูกค้า">×</button>
            ` : `
              <span style="color:#94a3b8;font-size:13px">(ลูกค้าทั่วไป — ไม่ผูกบัญชีลูกค้า)</span>
            `}
          </div>
          ${_posCustomer && Array.isArray(_posCustomer.tags) && _posCustomer.tags.length > 0 ? `
            <div style="margin-top:4px">
              ${_posCustomer.tags.map(tag => {
                const m = window._appGetCustomerTagMeta ? window._appGetCustomerTagMeta(tag) : { icon: "🏷️", color: "#64748b" };
                return `<span style="background:${m.color};color:#fff;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700;margin-right:3px;display:inline-block">${m.icon} ${escHtml(tag)}</span>`;
              }).join("")}
            </div>
          ` : ''}
          ${_posCustomer && _posCustomer.notes ? `
            <div style="margin-top:4px;font-size:11px;color:#0c4a6e;background:#f0f9ff;padding:4px 8px;border-radius:6px;border-left:2px solid #0284c7">📝 ${escHtml(_posCustomer.notes)}</div>
          ` : ''}
        </div>
        <button id="posCustPick" class="btn light" style="font-size:12px;padding:5px 12px;flex-shrink:0">${_posCustomer ? 'เปลี่ยน' : '+ เลือก/เพิ่มลูกค้า'}</button>
      </div>

      <!-- Cart (ถ้ามีสินค้า) -->
      ${cartQty > 0 ? `
      <div class="panel pos-cart-summary">
        <div class="row">
          <h3 style="margin:0">ตะกร้าสินค้า</h3>
          <button id="posCartClear" class="btn light" style="font-size:12px;padding:6px 12px">ล้าง</button>
        </div>
        <div class="pos-cart-items mt16">${renderCartCompact(state.cart)}</div>
        <div class="pos-cart-footer mt16">
          <div class="row">
            <div>${cartQty} รายการ</div>
            <div style="font-size:22px;font-weight:900;color:var(--primary2)">฿${moneyNum(cartTotal)}</div>
          </div>
          <button id="posGoPayBtn" class="btn primary mt16" style="width:100%;padding:14px;font-size:16px">เก็บเงิน</button>
        </div>
      </div>
      ` : ''}

      <!-- ★ Phase 36 — อัพเดทล่าสุด (5 บิลล่าสุดวันนี้) -->
      ${recentSales.length > 0 ? `
      <div class="pos-recent-section">
        <div class="pos-recent-header">
          <h3 class="pos-recent-title">📋 อัพเดทล่าสุด</h3>
          <span class="pos-recent-sub">${recentSales.length} บิลล่าสุดวันนี้</span>
        </div>
        <div class="pos-recent-list">
          ${recentSales.map(s => {
            const time = new Date(s.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
            const cust = (s.customer_name && s.customer_name.trim()) ? s.customer_name : "ลูกค้าทั่วไป";
            const isCancelled = (s.note || "").includes("[ลบแล้ว]");
            return `
              <button class="pos-recent-item" data-recent-sale="${s.id}" ${isCancelled ? 'disabled' : ''}>
                <div class="pos-recent-item-left">
                  <div class="pos-recent-item-no">${escHtml(s.order_no || ('#' + s.id))}</div>
                  <div class="pos-recent-item-meta">${time} • ${escHtml(cust)}</div>
                </div>
                <div class="pos-recent-item-right">
                  <div class="pos-recent-item-amount">฿${moneyNum(s.total_amount || 0)}</div>
                  ${isCancelled ? '<div class="pos-recent-item-tag cancelled">ยกเลิก</div>' : '<div class="pos-recent-item-tag paid">✓ เก็บเงินแล้ว</div>'}
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </div>
      ` : ''}
    `;

    // ★ Customer Picker bindings
    document.getElementById("posCustPick")?.addEventListener("click", () => openCustomerPicker(ctx), { signal });
    document.getElementById("posCustClear")?.addEventListener("click", () => { _posCustomer = null; renderPosView(ctx); }, { signal });

    // Bindings
    document.getElementById("posQuickPay")?.addEventListener("click", () => {
      posView = "quick-numpad"; numpadValue = ""; renderPosView(ctx);
    }, { signal });
    document.getElementById("posSelectProduct")?.addEventListener("click", () => {
      posView = "products"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posScanBtn")?.addEventListener("click", () => {
      posView = "scanner"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posShowQR")?.addEventListener("click", () => {
      posView = "qr-show"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posGoPayBtn")?.addEventListener("click", () => {
      quickPayAmount = cartTotal;
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posCartClear")?.addEventListener("click", () => {
      state.cart = []; localStorage.setItem("bsk_cart_v2", JSON.stringify(state.cart));
      renderPosView(ctx);
    }, { signal });
    document.getElementById("posSalesHistory")?.addEventListener("click", () => {
      window.App?.showRoute?.("sales");
    }, { signal });

    // ★ Phase 36 — ปุ่มใหม่: งานช่าง + รายงาน
    document.getElementById("posServiceJobs")?.addEventListener("click", () => {
      window.App?.showRoute?.("service_jobs");
    }, { signal });
    document.getElementById("posReports")?.addEventListener("click", () => {
      window.App?.showRoute?.("dashboard");
    }, { signal });

    // ★ Phase 36 — Recent sales feed: คลิก → loadReceipt(id) → openReceiptDrawer()
    el.querySelectorAll("[data-recent-sale]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-recent-sale");
        if (!id) return;
        try {
          if (window.App?.loadReceipt) await window.App.loadReceipt(id);
          window.App?.openReceiptDrawer?.();
        } catch (e) {
          window.App?.showToast?.("เปิดใบเสร็จไม่สำเร็จ: " + (e?.message || e), "error");
        }
      }, { signal });
    });


  // ═══════════════════════════════════════════════════════
  //  QUICK NUMPAD — พิมพ์ยอดเงิน → กด "เก็บเงิน"
  // ═══════════════════════════════════════════════════════
  } else if (posView === "quick-numpad") {
    const displayVal = numpadValue || "0";
    const hasValue = Number(numpadValue || 0) > 0;

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">แคชเชียร์</h3>
        <div></div>
      </div>

      <div class="pos-numpad-display">
        <div class="pos-pay-label">ยอดชำระ</div>
        <div class="pos-numpad-value" id="numpadDisplay">${displayVal}</div>
        <div class="pos-pay-label">บาท</div>
      </div>

      ${renderNumpad()}

      <div style="padding:0 16px 16px">
        <button id="posCollectBtn" class="pos-collect-btn ${hasValue ? '' : 'disabled'}" ${hasValue ? '' : 'disabled'}>เก็บเงิน</button>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      posView = "home"; renderPosView(ctx);
    }, { signal });
    bindNumpad(ctx, signal);
    document.getElementById("posCollectBtn")?.addEventListener("click", () => {
      quickPayAmount = Number(numpadValue || 0);
      if (quickPayAmount <= 0) return;
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });


  // ═══════════════════════════════════════════════════════
  //  PAYMENT SELECT — "เก็บเงินด้วย" เลือกวิธีจ่าย
  // ═══════════════════════════════════════════════════════
  } else if (posView === "payment-select") {
    const amount = quickPayAmount || cartTotal;

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">เก็บเงินด้วย</h3>
        <div></div>
      </div>

      <div class="pos-pay-amount-box">
        <div class="pos-pay-label">ยอดชำระ</div>
        <div class="pos-pay-total">${moneyNum(amount)}</div>
        <div class="pos-pay-label">บาท</div>
      </div>

      <div class="pos-pay-methods">
        <button class="pos-pay-method-btn" data-pay-method="เงินสด">
          <span class="pos-pay-method-icon">💵</span>
          <span>เงินสด</span>
          <span class="pos-pay-arrow">›</span>
        </button>
        <button class="pos-pay-method-btn" data-pay-method="โอนเงิน">
          <span class="pos-pay-method-icon">🏦</span>
          <span>โอนเงินบัญชีธนาคาร</span>
          <span class="pos-pay-arrow">›</span>
        </button>
        <button class="pos-pay-method-btn" data-pay-method="บัตรเครดิต">
          <span class="pos-pay-method-icon">💳</span>
          <span>บัตรเครดิต/EDC</span>
          <span class="pos-pay-arrow">›</span>
        </button>
        <button class="pos-pay-method-btn" data-pay-method="QR พร้อมเพย์">
          <span class="pos-pay-method-icon">🔗</span>
          <span>QR พร้อมเพย์</span>
          <span class="pos-pay-arrow">›</span>
        </button>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      // กลับไป numpad ถ้ามาจาก quick-pay, กลับ products ถ้ามาจากตะกร้า
      if (state.cart.length > 0 && quickPayAmount === cartTotal) {
        posView = "home";
      } else {
        posView = "quick-numpad";
      }
      renderPosView(ctx);
    }, { signal });

    document.querySelectorAll("[data-pay-method]").forEach(btn => btn.addEventListener("click", () => {
      selectedPaymentMethod = btn.dataset.payMethod;
      if (selectedPaymentMethod === "เงินสด") {
        posView = "cash-input"; numpadValue = ""; renderPosView(ctx);
      } else if (selectedPaymentMethod === "โอนเงิน") {
        posView = "transfer-qr"; renderPosView(ctx);
      } else if (selectedPaymentMethod === "QR พร้อมเพย์") {
        posView = "transfer-qr"; renderPosView(ctx);
      } else {
        // บัตรเครดิต → ไปหน้ายืนยัน+แนบสลิป
        pendingPaidAmount = amount;
        posView = "confirm-proof"; renderPosView(ctx);
      }
    }, { signal }));


  // ═══════════════════════════════════════════════════════
  //  CASH INPUT — "เงินสด" Numpad รับเงินมา + คำนวณทอน
  // ═══════════════════════════════════════════════════════
  } else if (posView === "cash-input") {
    const baseAmount = quickPayAmount || cartTotal;
    // ★ Phase 88.21 fix: ในโหมด VAT exclusive ลูกค้าต้องจ่าย = baseAmount + VAT
    const cashVatCalc = calcVAT(baseAmount, state.paymentInfo);
    const amount = (cashVatCalc.enabled && cashVatCalc.mode === "exclusive") ? cashVatCalc.total : baseAmount;
    const displayVal = numpadValue || "0";
    const paid = Number(numpadValue || 0);
    const change = Math.max(paid - amount, 0);

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">เงินสด</h3>
        <div></div>
      </div>

      <div class="pos-numpad-display">
        <div class="pos-pay-label">รับเงินมา</div>
        <div class="pos-numpad-value" id="numpadDisplay">${displayVal}</div>
        <div class="pos-pay-label">จากยอดทั้งหมด ${moneyNum(amount)} บาท${cashVatCalc.enabled && cashVatCalc.mode === "exclusive" ? ` <span style="color:var(--primary2);font-size:11px">(${moneyNum(baseAmount)} + VAT ${moneyNum(cashVatCalc.vat)})</span>` : ''}</div>
        ${paid >= amount && paid > 0 ? `<div class="pos-change-display">เงินทอน ฿${moneyNum(change)}</div>` : ''}
      </div>

      ${renderNumpad()}

      <div class="pos-quick-amounts">
        <button class="btn light" data-quick-amt="exact">พอดี</button>
        <button class="btn light" data-quick-amt="100">+100</button>
        <button class="btn light" data-quick-amt="500">+500</button>
        <button class="btn light" data-quick-amt="1000">+1000</button>
      </div>

      <div style="padding:0 16px 16px">
        <button id="posCashConfirmBtn" class="pos-collect-btn ${paid >= amount ? '' : 'disabled'}" ${paid >= amount ? '' : 'disabled'}>เสร็จสิ้น</button>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });
    bindNumpad(ctx, signal);

    // Quick amounts
    document.querySelectorAll("[data-quick-amt]").forEach(btn => btn.addEventListener("click", () => {
      const v = btn.dataset.quickAmt;
      if (v === "exact") numpadValue = String(amount);
      // Phase 89.2: round2 กัน float drift (0.1+0.2 = 0.300000...004)
      else numpadValue = String(round2(Number(numpadValue||0) + Number(v)));
      renderPosView(ctx); // re-render to update change
    }, { signal }));

    document.getElementById("posCashConfirmBtn")?.addEventListener("click", () => {
      if (paid < amount) return;
      pendingPaidAmount = paid;
      posView = "confirm-proof"; renderPosView(ctx);
    }, { signal });


  // ═══════════════════════════════════════════════════════
  //  TRANSFER QR — "โอนเงินบัญชีธนาคาร" แสดง QR + ข้อมูลบัญชี
  // ═══════════════════════════════════════════════════════
  } else if (posView === "transfer-qr") {
    const amount = quickPayAmount || cartTotal;
    // Phase 88.20: ดึง banks list — ถ้ามีหลายบัญชี → dropdown ให้เลือก
    const allBanks = state.paymentInfo?.banks || [];
    const validBanks = allBanks.filter(b => b.bankName || b.bankAccount);
    if (selectedBankIdx >= validBanks.length) selectedBankIdx = 0;
    const activeBank = validBanks[selectedBankIdx] || null;
    const pi = state.paymentInfo || {};
    // ★ Phase 88.20: ถ้าใช้บัญชีจาก banks[] → ใช้ QR ของบัญชีนั้น (ไม่งั้น fallback to global qrImage)
    const bankQR = activeBank?.qrImage || pi.qrImage || "";
    const hasQR = !!bankQR;

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">${selectedPaymentMethod === "QR พร้อมเพย์" ? 'QR พร้อมเพย์' : 'โอนเงินบัญชีธนาคาร'}</h3>
        <div></div>
      </div>

      ${validBanks.length > 1 ? `
        <!-- Phase 88.20: Dropdown เลือกบัญชี (ถ้ามีหลายบัญชี) -->
        <div style="padding:12px 16px 4px">
          <label style="font-size:12px;color:#475569;font-weight:700;margin-bottom:6px;display:block">🏦 เลือกบัญชีรับเงิน:</label>
          <select id="posBankPicker" style="width:100%;padding:12px;border:2px solid var(--primary2);border-radius:10px;background:#e0f2fe;font-size:14px;font-weight:600;cursor:pointer">
            ${validBanks.map((b, i) => {
              const label = `${b.bankName || 'ธนาคาร'}${b.bankAccount ? ' — ' + b.bankAccount : ''}${b.coaCode ? ' (COA ' + b.coaCode + ')' : ''}`;
              return `<option value="${i}" ${i === selectedBankIdx ? 'selected' : ''}>${label}</option>`;
            }).join("")}
          </select>
        </div>
      ` : ''}

      <div class="pos-transfer-card">
        ${hasQR ? `
          <div class="pos-transfer-qr-wrap">
            <img src="${bankQR}" alt="QR Code" class="pos-transfer-qr-img" />
          </div>
        ` : `
          <div class="pos-qr-placeholder">
            <div style="font-size:40px;margin-bottom:8px">📱</div>
            <div>ยังไม่ได้ตั้งค่า QR Code</div>
            <div class="sku">ไปที่ ตั้งค่า → ข้อมูลการเงิน</div>
          </div>
        `}

        <div class="pos-transfer-amount">${moneyNum(amount)}</div>

        ${activeBank ? `
        <div class="pos-transfer-bank-info">
          <div class="pos-transfer-bank-icon">🏦</div>
          <div>
            ${activeBank.bankHolder ? `<div style="font-weight:900">${activeBank.bankHolder}</div>` : ''}
            ${activeBank.bankAccount ? `<div class="sku">เลขที่บัญชี ${activeBank.bankAccount}</div>` : ''}
            ${activeBank.bankName ? `<div class="sku">${activeBank.bankName}${activeBank.bankBranch ? ' สาขา ' + activeBank.bankBranch : ''}</div>` : ''}
            ${activeBank.coaCode ? `<div class="sku" style="color:var(--primary2);font-weight:600">📊 COA: ${activeBank.coaCode}</div>` : ''}
          </div>
        </div>
        ` : (pi.bankName || pi.bankHolder ? `
        <div class="pos-transfer-bank-info">
          <div class="pos-transfer-bank-icon">🏦</div>
          <div>
            ${pi.bankHolder ? `<div style="font-weight:900">${pi.bankHolder}</div>` : ''}
            ${pi.bankAccount ? `<div class="sku">เลขที่บัญชี ${pi.bankAccount}</div>` : ''}
            ${pi.bankName ? `<div class="sku">${pi.bankName}${pi.bankBranch ? ' สาขา ' + pi.bankBranch : ''}</div>` : ''}
          </div>
        </div>
        ` : '')}

        ${pi.promptPay ? `<div class="sku" style="text-align:center;margin-top:8px">พร้อมเพย์: ${pi.promptPay}</div>` : ''}
      </div>

      <!-- ปุ่มยืนยัน -->
      <div style="padding:16px">
        <button id="posTransferConfirmBtn" class="pos-collect-btn" style="width:100%">ลูกค้าชำระแล้ว → ถัดไป</button>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });

    document.getElementById("posTransferConfirmBtn")?.addEventListener("click", () => {
      pendingPaidAmount = amount;
      posView = "confirm-proof"; renderPosView(ctx);
    }, { signal });

    // Phase 88.20: bank picker dropdown — เปลี่ยนบัญชี → re-render เพื่อแสดง QR/info ใหม่
    document.getElementById("posBankPicker")?.addEventListener("change", (e) => {
      selectedBankIdx = parseInt(e.target.value, 10) || 0;
      renderPosView(ctx);
    }, { signal });


  // ═══════════════════════════════════════════════════════
  //  CONFIRM + PROOF — ยืนยัน + แนบสลิป (ทุกวิธีชำระเงิน)
  // ═══════════════════════════════════════════════════════
  } else if (posView === "confirm-proof") {
    const baseAmount = quickPayAmount || cartTotal;
    // ★ Phase 88.21 fix: ใน exclusive mode → display total หลัง VAT (ที่ลูกค้าจ่ายจริง)
    const cpVat = calcVAT(baseAmount, state.paymentInfo);
    const amount = (cpVat.enabled && cpVat.mode === "exclusive") ? cpVat.total : baseAmount;
    const methodIcons = { "เงินสด": "💵", "โอนเงิน": "🏦", "บัตรเครดิต": "💳", "QR พร้อมเพย์": "🔗" };

    el.innerHTML = `
      <div style="overflow-y:auto;max-height:100vh;padding-bottom:80px">
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">ยืนยันการชำระ</h3>
        <div></div>
      </div>

      <!-- สรุปยอด -->
      <div class="pos-pay-amount-box" style="margin:16px;border-radius:16px;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:#fff;padding:20px 24px;text-align:center">
        <div style="font-size:14px;opacity:.8">${selectedPaymentMethod} ${methodIcons[selectedPaymentMethod] || ""}</div>
        <div style="font-size:36px;font-weight:900;margin:8px 0">฿${moneyNum(amount)}</div>
        ${(() => {
          // ★ Phase 88.21 fix: ใช้ baseAmount (ก่อน VAT) เป็น input — ไม่ทับซ้อน
          if (!cpVat.enabled) return '';
          return `
            <div style="margin-top:8px;padding:8px 12px;background:rgba(255,255,255,.15);border-radius:10px;font-size:12px;text-align:left">
              <div style="display:flex;justify-content:space-between"><span>ยอดสินค้า (ก่อน VAT)</span><b>฿${moneyNum(cpVat.subtotal)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>VAT ${cpVat.rate}%</span><b>฿${moneyNum(cpVat.vat)}</b></div>
              <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.3);padding-top:4px;margin-top:4px"><span>${cpVat.mode === 'inclusive' ? 'รวม VAT แล้ว' : 'รวมสุทธิ'}</span><b>฿${moneyNum(cpVat.total)}</b></div>
            </div>
          `;
        })()}
        ${selectedPaymentMethod === "เงินสด" ? `
          <!-- Phase 88.20: Breakdown รับเงิน-เงินทอน เด่นชัด -->
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.25);display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
            <div>
              <div style="opacity:.7;font-size:11px">💵 รับเงินจากลูกค้า</div>
              <div style="font-size:18px;font-weight:800">฿${moneyNum(pendingPaidAmount || amount)}</div>
            </div>
            <div>
              <div style="opacity:.7;font-size:11px">💸 เงินทอน</div>
              <div style="font-size:18px;font-weight:800">฿${moneyNum(Math.max((pendingPaidAmount || amount) - amount, 0))}</div>
            </div>
          </div>
        ` : ''}
        ${(selectedPaymentMethod === "โอนเงิน" || selectedPaymentMethod === "QR พร้อมเพย์") ? (() => {
          const allBanks = state.paymentInfo?.banks || [];
          const validBanks = allBanks.filter(b => b.bankName || b.bankAccount);
          const activeBank = validBanks[selectedBankIdx];
          return activeBank ? `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.25);font-size:13px;opacity:.95">
              🏦 ${activeBank.bankName || ''}${activeBank.bankAccount ? ' — ' + activeBank.bankAccount : ''}
              ${activeBank.coaCode ? `<span style="opacity:.7;margin-left:6px">[COA ${activeBank.coaCode}]</span>` : ''}
            </div>
          ` : '';
        })() : ''}
      </div>

      <!-- แนบสลิป -->
      <div class="panel" style="margin:0 16px;border-radius:16px">
        <h4 style="margin:0 0 12px;color:#374151">แนบหลักฐานการชำระเงิน (สลิป)</h4>
        <div class="pos-proof-section" id="proofSection">
          <div style="display:flex;gap:8px">
            <button id="posCaptureCamera" style="flex:1;display:flex;align-items:center;gap:10px;padding:14px;background:#f0fdf4;border:2px dashed #86efac;border-radius:12px;cursor:pointer;text-align:left;font-size:14px">
              <span style="font-size:24px">📷</span>
              <div>
                <div style="font-weight:700;color:#166534">ถ่ายรูป</div>
                <div style="font-size:11px;color:#6b7280">เปิดกล้อง</div>
              </div>
            </button>
            <button id="posCaptureGallery" style="flex:1;display:flex;align-items:center;gap:10px;padding:14px;background:#eff6ff;border:2px dashed #93c5fd;border-radius:12px;cursor:pointer;text-align:left;font-size:14px">
              <span style="font-size:24px">🖼️</span>
              <div>
                <div style="font-weight:700;color:#1e40af">เลือกรูป</div>
                <div style="font-size:11px;color:#6b7280">จากแกลเลอรี่</div>
              </div>
            </button>
          </div>
        </div>
        <input type="file" id="posProofCameraInput" accept="image/*" capture="environment" style="display:none" />
        <input type="file" id="posProofGalleryInput" accept="image/*" style="display:none" />
      </div>

      <!-- ปุ่ม -->
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <button id="posConfirmWithProof" class="pos-collect-btn" style="width:100%;background:#10b981;padding:16px;font-size:16px;font-weight:700;border-radius:12px;color:#fff;border:none;cursor:pointer">เสร็จสิ้น</button>
        <button id="posConfirmNoProof" style="width:100%;padding:16px;font-size:15px;color:#6b7280;background:#f3f4f6;border:2px solid #e5e7eb;border-radius:12px;cursor:pointer;font-weight:600">ข้าม ไม่แนบสลิป → เสร็จสิ้น</button>
      </div>
      </div>
    `;

    // ─── Back ───
    document.getElementById("posBack")?.addEventListener("click", () => {
      window._pendingProofUrl = "";
      if (selectedPaymentMethod === "เงินสด") { posView = "cash-input"; }
      else if (selectedPaymentMethod === "โอนเงิน" || selectedPaymentMethod === "QR พร้อมเพย์") { posView = "transfer-qr"; }
      else { posView = "payment-select"; }
      renderPosView(ctx);
    }, { signal });

    // ─── ถ่ายรูป (เปิดกล้อง) / เลือกรูป (เปิดแกลเลอรี่) ───
    const cameraInput = document.getElementById("posProofCameraInput");
    const galleryInput = document.getElementById("posProofGalleryInput");
    document.getElementById("posCaptureCamera")?.addEventListener("click", () => {
      cameraInput?.click();
    }, { signal });
    document.getElementById("posCaptureGallery")?.addEventListener("click", () => {
      galleryInput?.click();
    }, { signal });

    const handleProofFile = async (e) => {
      let file = e.target.files?.[0];
      if (!file) return;
      // Note: Change event doesn't use signal because it's on input element

      // ★ FIX: Validate file type + size ก่อนอัปโหลด
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
      const maxSizeMB = 10;
      if (file.type && !allowedTypes.includes(file.type)) {
        window.App?.showToast?.("รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WebP)");
        e.target.value = '';
        return;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        window.App?.showToast?.(`ไฟล์ใหญ่เกิน ${maxSizeMB}MB กรุณาเลือกใหม่`);
        e.target.value = '';
        return;
      }

      // ★ บีบอัดรูปก่อนอัปโหลด
      // eslint-disable-next-line require-atomic-updates -- C: local file param reassign in upload flow (sequential)
      if (window._compressImage) file = await window._compressImage(file);

      const proofSection = document.getElementById("proofSection");
      if (proofSection) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          proofSection.innerHTML = `
            <div style="text-align:center;padding:12px">
              <img src="${ev.target.result}" style="max-width:220px;max-height:220px;border-radius:12px;border:3px solid #10b981;margin-bottom:8px" />
              <div style="color:#10b981;font-weight:700;font-size:14px" id="proofUploadStatus">📤 กำลังอัปโหลด...</div>
            </div>
          `;
        };
        reader.readAsDataURL(file);
      }

      try {
        const cfg = window.SUPABASE_CONFIG;
        const token = window._sbAccessToken || cfg.anonKey;
        const ts = Date.now();
        const ext = file.name.split(".").pop() || "jpg";
        const filePath = `slips/${ts}_${Math.random().toString(36).slice(2)}.${ext}`;

        // ★ ลองอัปโหลดไป Supabase Storage
        let proofUrl = "";
        try {
          const uploadRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
            method: "POST",
            headers: {
              "apikey": cfg.anonKey,
              "Authorization": `Bearer ${token}`,
              "Content-Type": file.type || "image/jpeg",
              "x-upsert": "true"
            },
            body: file
          });

          if (uploadRes.ok) {
            proofUrl = `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
            const statusEl = document.getElementById("proofUploadStatus");
            if (statusEl) statusEl.textContent = "✅ อัปโหลดสำเร็จ!";
            window.App?.showToast?.("อัปโหลดสลิปสำเร็จ ✅");
          } else {
            throw new Error("Storage upload failed: " + uploadRes.status);
          }
        } catch (uploadErr) {
          // ★ Fallback: เก็บเป็น base64 ใน note
          console.warn("Storage upload failed, using base64:", uploadErr.message);
          proofUrl = await new Promise(resolve => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(file);
          });
          const statusEl = document.getElementById("proofUploadStatus");
          if (statusEl) statusEl.textContent = "✅ บันทึกสลิปแล้ว (เก็บในเครื่อง)";
          window.App?.showToast?.("บันทึกสลิปแล้ว (offline mode)");
        }

        window._pendingProofUrl = proofUrl;

        // เปลี่ยนปุ่ม "เสร็จสิ้น" ให้เด่นขึ้น
        const confirmBtn = document.getElementById("posConfirmWithProof");
        if (confirmBtn) {
          confirmBtn.textContent = "✅ บันทึกการขาย + สลิป";
          confirmBtn.style.background = "#059669";
          confirmBtn.style.transform = "scale(1.02)";
        }
      } catch (err) {
        console.error("Proof error:", err);
        window.App?.showToast?.("เกิดข้อผิดพลาด กรุณาลองใหม่");
      }
    };
    cameraInput?.addEventListener("change", handleProofFile);
    galleryInput?.addEventListener("change", handleProofFile);

    // ─── เสร็จสิ้น (พร้อมสลิป) ───
    // ★ FIX: handler ห้าม set window._checkoutRunning — doCheckout() เป็นคน manage flag เอง
    //   (เดิม handler set → doCheckout เห็นเป็น true → return ทันที → ปุ่มค้าง)
    document.getElementById("posConfirmWithProof")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.disabled || _posCheckoutGuard.isInflight) return;
      btn.disabled = true;
      btn.textContent = "⏳ กำลังบันทึก...";
      try {
        await doCheckout(ctx, selectedPaymentMethod, pendingPaidAmount || amount);
      } catch (err) {
        console.error("[pos] posConfirmWithProof error:", err);
        btn.disabled = false;
        btn.textContent = "เสร็จสิ้น";
        window.App?.showToast?.("เกิดข้อผิดพลาด กรุณาลองใหม่");
      }
    }, { signal });

    // ─── ข้าม ไม่แนบสลิป ───
    document.getElementById("posConfirmNoProof")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.disabled || _posCheckoutGuard.isInflight) return;
      btn.disabled = true;
      btn.textContent = "⏳ กำลังบันทึก...";
      window._pendingProofUrl = "";
      try {
        await doCheckout(ctx, selectedPaymentMethod, pendingPaidAmount || amount);
      } catch (err) {
        console.error("[pos] posConfirmNoProof error:", err);
        btn.disabled = false;
        btn.textContent = "ข้าม ไม่แนบสลิป → เสร็จสิ้น";
        window.App?.showToast?.("เกิดข้อผิดพลาด กรุณาลองใหม่");
      }
    }, { signal });


  // ═══════════════════════════════════════════════════════
  //  QR SHOW — ดู QR รับเงินอย่างเดียว (ไม่บันทึกขาย)
  // ═══════════════════════════════════════════════════════
  } else if (posView === "qr-show") {
    const pi = state.paymentInfo || {};
    const hasQR = !!pi.qrImage;

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">QR รับเงิน</h3>
        <div></div>
      </div>
      <div class="pos-transfer-card" style="margin-top:16px">
        ${hasQR ? `
          <div class="pos-transfer-qr-wrap">
            <img src="${pi.qrImage}" alt="QR Code" class="pos-transfer-qr-img" />
          </div>
        ` : `
          <div class="pos-qr-placeholder">
            <div style="font-size:48px;margin-bottom:12px">📱</div>
            <div>ยังไม่ได้ตั้งค่า QR Code</div>
            <div class="sku">ไปที่ ตั้งค่า → ข้อมูลการเงิน เพื่อแนบรูป QR</div>
          </div>
        `}
        ${pi.bankHolder ? `<div style="font-weight:900;text-align:center;margin-top:12px">${pi.bankHolder}</div>` : ''}
        ${pi.bankAccount ? `<div class="sku" style="text-align:center">เลขที่บัญชี ${pi.bankAccount}</div>` : ''}
        ${pi.bankName ? `<div class="sku" style="text-align:center">${pi.bankName}</div>` : ''}
        ${pi.promptPay ? `<div class="sku" style="text-align:center">พร้อมเพย์: ${pi.promptPay}</div>` : ''}
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      posView = "home"; renderPosView(ctx);
    }, { signal });


  // ═══════════════════════════════════════════════════════
  //  PRODUCTS — เลือกสินค้า
  // ═══════════════════════════════════════════════════════
  } else if (posView === "products") {
    const t = cartSum(state.cart);
    const q = state.cart.reduce((s,i)=>s+i.qty,0);

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">เลือกสินค้า</h3>
        <button class="btn light" id="posScanFromProducts" style="font-size:16px;padding:8px 12px">📷</button>
      </div>
      <div class="toolbar">
        <input id="posSearchInput" placeholder="ค้นหาชื่อสินค้า / รหัส / บาร์โค้ด" style="flex:1" />
      </div>
      ${_posWarehouseChips(state)}
      <div id="posProductList" class="pos-product-grid mt16">
        ${renderProductCards(_posProductsForWh(state), canEditPosPrice(state), state)}
      </div>

      <!-- Sticky Cart Bar -->
      <div class="pos-sticky-cart" id="posStickyCart">
        <button id="posTrashCart" class="btn light" style="padding:10px 12px">🗑️</button>
        <button id="posStickyPayBtn" class="pos-sticky-pay-btn">${q} รายการ &nbsp;&nbsp; ฿${moneyNum(t)}</button>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      posView = "home"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posScanFromProducts")?.addEventListener("click", () => {
      posView = "scanner"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posTrashCart")?.addEventListener("click", () => {
      state.cart = []; localStorage.setItem("bsk_cart_v2", JSON.stringify(state.cart));
      renderPosView(ctx);
    }, { signal });
    document.getElementById("posStickyPayBtn")?.addEventListener("click", () => {
      if (state.cart.length === 0) { window.App?.showToast?.("ยังไม่มีสินค้าในบิล"); return; }
      quickPayAmount = cartSum(state.cart);
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });

    bindProductList(state, ctx, signal);
    bindProductSearch(state, ctx, signal);
    bindPriceEdit(state, ctx, signal);
    bindWarehouseChips(ctx, signal);


  // ═══════════════════════════════════════════════════════
  //  SCANNER — สแกนบาร์โค้ด / QR
  // ═══════════════════════════════════════════════════════
  } else if (posView === "scanner") {
    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">สแกนบาร์โค้ด</h3>
        <div></div>
      </div>
      <div class="pos-scanner-info">สแกนบาร์โค้ดเพื่อเพิ่มสินค้า</div>
      <div id="posScannerArea" class="pos-scanner-area"></div>
      <div class="pos-scanner-result" id="posScanResult"></div>
      <div style="padding:16px;text-align:center">
        <div class="sku">หรือพิมพ์บาร์โค้ดเอง</div>
        <div class="row mt16" style="gap:8px">
          <input id="posManualBarcode" placeholder="พิมพ์บาร์โค้ด" style="flex:1" />
          <button id="posManualBarcodeBtn" class="btn primary">ค้นหา</button>
        </div>
      </div>
    `;

    document.getElementById("posBack")?.addEventListener("click", () => {
      stopScanner();
      posView = "home"; renderPosView(ctx);
    }, { signal });
    document.getElementById("posManualBarcodeBtn")?.addEventListener("click", () => {
      const code = document.getElementById("posManualBarcode")?.value?.trim();
      if (code) handleScanResult(code, ctx);
    }, { signal });
    document.getElementById("posManualBarcode")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const code = e.target.value.trim();
        if (code) handleScanResult(code, ctx);
      }
    }, { signal });
    startScanner(ctx);
  }
}


// ═══════════════════════════════════════════════════════════
//  NUMPAD — HTML + Binding
// ═══════════════════════════════════════════════════════════
function renderNumpad() {
  return `
    <div class="pos-numpad">
      <button class="pos-numpad-btn" data-num="7">7</button>
      <button class="pos-numpad-btn" data-num="8">8</button>
      <button class="pos-numpad-btn" data-num="9">9</button>
      <button class="pos-numpad-btn" data-num="4">4</button>
      <button class="pos-numpad-btn" data-num="5">5</button>
      <button class="pos-numpad-btn" data-num="6">6</button>
      <button class="pos-numpad-btn" data-num="1">1</button>
      <button class="pos-numpad-btn" data-num="2">2</button>
      <button class="pos-numpad-btn" data-num="3">3</button>
      <button class="pos-numpad-btn" data-num=".">.</button>
      <button class="pos-numpad-btn" data-num="0">0</button>
      <button class="pos-numpad-btn" data-num="del">⌫</button>
    </div>
  `;
}

function bindNumpad(ctx, signal) {
  document.querySelectorAll("[data-num]").forEach(btn => btn.addEventListener("click", () => {
    const v = btn.dataset.num;
    if (v === "del") {
      numpadValue = numpadValue.slice(0,-1);
    } else if (v === ".") {
      if (!numpadValue.includes(".")) numpadValue += numpadValue ? "." : "0.";
    } else {
      // จำกัดไม่เกิน 2 ตำแหน่งหลังจุด
      if (numpadValue.includes(".") && numpadValue.split(".")[1]?.length >= 2) return;
      numpadValue += v;
    }
    // Update display
    const display = document.getElementById("numpadDisplay");
    if (display) display.textContent = numpadValue || "0";
    // Update collect button state
    updateCollectBtn();
  }, { signal }));
}

function updateCollectBtn() {
  const btn = document.getElementById("posCollectBtn");
  if (!btn) return;
  const val = Number(numpadValue || 0);
  if (val > 0) { btn.disabled = false; btn.classList.remove("disabled"); }
  else { btn.disabled = true; btn.classList.add("disabled"); }

  // Also update cash confirm
  const cashBtn = document.getElementById("posCashConfirmBtn");
  if (cashBtn) {
    // ★ Phase 88.21 fix: ใช้ total หลัง VAT (exclusive mode) เป็น threshold
    const pi = (window.App?.state || {}).paymentInfo;
    const baseAmount = quickPayAmount;
    const vc = calcVAT(baseAmount, pi);
    const amount = (vc.enabled && vc.mode === "exclusive") ? vc.total : baseAmount;
    const paid = Number(numpadValue || 0);
    if (paid >= amount) { cashBtn.disabled = false; cashBtn.classList.remove("disabled"); }
    else { cashBtn.disabled = true; cashBtn.classList.add("disabled"); }
    // Update change display
    const changeEl = document.querySelector(".pos-change-display");
    if (paid >= amount && paid > 0) {
      if (changeEl) changeEl.textContent = `เงินทอน ฿${moneyNum(paid - amount)}`;
      else {
        const d = document.createElement("div");
        d.className = "pos-change-display";
        d.textContent = `เงินทอน ฿${moneyNum(paid - amount)}`;
        document.querySelector(".pos-numpad-display")?.appendChild(d);
      }
    } else if (changeEl) {
      changeEl.remove();
    }
  }
}


// ═══════════════════════════════════════════════════════════
//  CHECKOUT — บันทึกการขาย
// ═══════════════════════════════════════════════════════════
async function doCheckout(ctx, paymentMethod, paidAmount) {
  // Phase 89.42: single-flight guard replaces manual window._checkoutRunning (auto-release in finally even on throw)
  return _posCheckoutGuard.run(async () => {
  const { state, openReceiptDrawer } = ctx;
  const amount = quickPayAmount || cartSum(state.cart);

  // ★ Phase 473: precheck — ห้ามขายเกินสต็อกคลังที่เลือก ("ขายเท่าที่มี" — กันสต็อกผี/ติดลบ; เก็บ Phase 437)
  //   เกิน → บล็อก + บอกว่ามีเท่าไหร่ (ให้ลดจำนวน/รับเข้าก่อน) ไม่สร้างบิล.
  //   cache = UX gate ชั้นแรก; CAS floor (deduct) = ด่านจริง; 469 flag = backstop เผื่อ race.
  if ((state.cart || []).length > 0) {
    const _short = [];
    for (const _it of state.cart) {
      const _p = (state.products || []).find(x => String(x.id) === String(_it.id));
      if (!_p || _p.product_type === "service" || _p.product_type === "non_stock") continue;
      const _picked = _posWarehouseId && String(_posWarehouseId) !== "" && String(_posWarehouseId) !== "auto";
      const _avail = _picked ? _posWhStock(state, _it.id, _posWarehouseId) : Number(_p.stock || 0);
      if (Number(_it.qty || 0) > _avail) _short.push(`${_it.name || _it.id}: มี ${_avail} (ในบิล ${_it.qty})`);
    }
    if (_short.length > 0) {
      window.App?.showToast?.(`⚠️ สต็อกไม่พอ ขายเกินไม่ได้ — ${_short.slice(0, 3).join(" · ")}${_short.length > 3 ? " …" : ""} — โปรดลดจำนวน หรือ รับเข้าสต็อกก่อน`);
      return;
    }
  }

  try {
    const orderNo = "BSK-" + Date.now();
    const proofUrl = window._pendingProofUrl || "";
    window._pendingProofUrl = "";
    // ★ ใช้ลูกค้าที่เลือก (ถ้ามี)
    const custName = _posCustomer?.name || "ลูกค้าทั่วไป";
    const custPhone = _posCustomer?.phone || "";
    const noteParts = [];
    if (custPhone) noteParts.push(`📞 ${custPhone}`);
    if (proofUrl && proofUrl.startsWith("http")) noteParts.push(`สลิป: ${proofUrl}`);

    // ★ Phase 88.20: ถ้าโอนเงิน + เลือกบัญชี → ใส่ COA + ชื่อบัญชี ใน note (ใช้ตอน post JV)
    let _bankCoaCode = "";
    if (paymentMethod === "โอนเงิน" || paymentMethod === "QR พร้อมเพย์") {
      const allBanks = state.paymentInfo?.banks || [];
      const validBanks = allBanks.filter(b => b.bankName || b.bankAccount);
      const activeBank = validBanks[selectedBankIdx];
      if (activeBank?.coaCode) {
        _bankCoaCode = activeBank.coaCode;
        noteParts.push(`BANK_COA:${activeBank.coaCode}`);
        noteParts.push(`🏦 ${activeBank.bankName}${activeBank.bankAccount ? ' (' + activeBank.bankAccount + ')' : ''}`);
      }
    }
    // ★ Phase 88.20: เพิ่มรายละเอียดเงินสด (รับเงิน + เงินทอน) ใน note ถ้า payment=cash
    if (paymentMethod === "เงินสด" && (paidAmount || 0) > 0) {
      const change = Math.max((paidAmount || 0) - amount, 0);
      if (change > 0) {
        noteParts.push(`💵 รับ ฿${(paidAmount || 0).toLocaleString("th-TH")} ทอน ฿${change.toLocaleString("th-TH")}`);
      } else {
        noteParts.push(`💵 รับ ฿${(paidAmount || amount).toLocaleString("th-TH")} (พอดี)`);
      }
    }

    // ★ Phase 88.21: คำนวณ VAT (ถ้าเปิดใช้งาน)
    const vatCalc = calcVAT(amount, state.paymentInfo);
    let actualTotal = amount;
    if (vatCalc.enabled && vatCalc.mode === "exclusive") {
      // exclusive: amount = ราคาก่อน VAT → ลูกค้าจ่ายจริง = total
      actualTotal = vatCalc.total;
    }
    // inclusive: amount = total อยู่แล้ว → ไม่ต้องแก้

    // ★ Phase 398: gross profit = subtotal (ex-VAT) − COGS · null ถ้าตะกร้าว่าง (quick-pay)
    const _saleSubtotal = round2(vatCalc.enabled ? vatCalc.subtotal : amount);  // = subtotal เดิม (ไม่เปลี่ยนค่า)
    const _grossProfit = _computeGrossProfit(state.cart, state.products, _saleSubtotal);

    // Phase 89.2: round2 ทุก money field — กัน 0.30000000000000004 เข้า DB
    const salePayload = {
      order_no: orderNo,
      customer_name: custName,
      payment_method: paymentMethod,
      subtotal: _saleSubtotal,
      gross_profit: _grossProfit,
      total_amount: round2(actualTotal),
      paid_amount: round2(paidAmount || actualTotal),
      change_amount: round2(Math.max((paidAmount || actualTotal) - actualTotal, 0)),
      discount_type: null,
      discount_value: 0,
      discount_amount: 0,
      // Phase 88.21: VAT breakdown (เป็น 0 ถ้าไม่เปิด VAT)
      vat_amount: round2(vatCalc.vat),
      vat_rate: vatCalc.rate,
      subtotal_before_vat: vatCalc.enabled ? round2(vatCalc.subtotal) : null,
      note: noteParts.join(" • "),
      created_by: state.currentUser?.id || null
    };
    // ★ ถ้ามี customer_id field ในตาราง — ใส่ด้วย (รองรับ schema ที่ extend แล้ว)
    if (_posCustomer?.id) salePayload.customer_id = _posCustomer.id;

    let saleRes = await xhrPostPOS("sales", salePayload, true);
    // ★ Phase 398: defensive fallback — กัน checkout พังถ้า column gross_profit ยังไม่มีใน DB (ตัด field แล้ว retry)
    if (!saleRes.ok && /column|gross_profit/i.test(saleRes.error || "")) {
      const { gross_profit: _gp, ...legacy } = salePayload;
      console.warn("[POS] sales gross_profit fallback (column missing)");
      saleRes = await xhrPostPOS("sales", legacy, true);
    }
    if (!saleRes.ok) {
      window.App?.showToast?.("บันทึกการขายไม่สำเร็จ: " + (saleRes.error || "unknown"));
      window.App?.showToast?.(saleRes.error || "บันทึกไม่สำเร็จ");
      return;
    }

    const saleId = saleRes.data?.id;
    if (!saleId) {
      window.App?.showToast?.("ไม่สามารถดึง ID การขายได้");
      return;
    }

    // Phase 91.1: capture loyalty earn context BEFORE state reset clears _posCustomer at L1202.
    // amount = actualTotal (post-discount + VAT — what the customer actually paid),
    // refId = saleId so the earn record traces back to this sale.
    const _earnCustomerId = _posCustomer?.id || null;
    const _earnAmount = actualTotal;

    // ถ้ามีสินค้าในตะกร้า → บันทึก sale_items
    if (state.cart.length > 0) {
      const failedItems = [];  // ★ audit S2: เก็บรายการที่บันทึกไม่สำเร็จ → เตือน admin (เดิมกลืน console.error เงียบ)
      const stockFailedItems = [];  // ★ Phase 469: รายการที่ตัดสต็อกไม่ได้ (คลังไม่พอ) → ติดธงบิล + เตือน (ไม่บล็อกการขาย)
      for (const item of state.cart) {
        const prodRef = state.products.find(x => x.id === item.id);
        const itemPayload = {
          sale_id: saleId,
          warehouse_id: _posWarehouseId || null,  // Phase 468: คลังที่ขายจริง (ใช้ตอน revert ยกเลิกบิล)
          product_id: item.id || null,
          product_name: item.name || "สินค้า",
          qty: Number(item.qty) || 1,
          unit_price: round2(item.price),
          unit_cost: round2(prodRef?.cost || 0),
          // Phase 89.2: round2 กัน 0.30000000000000004
          line_total: round2(Number(item.qty || 1) * Number(item.price || 0))
        };
        let itemRes = await xhrPostPOS("sale_items", itemPayload);
        // Legacy fallback: ถ้า product_id/unit_cost ยังไม่มีใน DB → retry โดยไม่ส่ง
        if (!itemRes.ok && /column|product_id|unit_cost|warehouse_id/i.test(itemRes.error || "")) {
          // Phase 468: strip warehouse_id ด้วย เผื่อ DB ยังไม่ได้รันคอลัมน์ (กัน insert ทั้ง row fail)
          const { product_id: _pid, unit_cost: _uc, warehouse_id: _wh, ...legacy } = itemPayload;
          console.warn("[POS] sale_items legacy fallback");
          itemRes = await xhrPostPOS("sale_items", legacy);
        }
        if (!itemRes.ok) {
          console.error("[POS] sale_items failed:", itemRes.error);
          failedItems.push(item.name || item.product_name || `#${item.id}`);
        }

        // ★ ตัดสต็อก — ใช้ smart deduct (รองรับ bundle Phase 18)
        try {
          const fn = window._appDeductStockSmart || window._appDeductStockForSaleItem;
          if (fn && prodRef) {
            // Phase 464: ตัดจากคลังที่เลือก (คลังเดียวต่อบิล); "" = auto บ้าน-first เดิม
            // Phase 469: เช็คผล — ตัดไม่ได้ (คลังที่เลือกไม่พอ) → เก็บไว้ติดธงบิล (owner เลือก warn+flag ไม่บล็อก)
            const _dr = await fn({ product: prodRef, qty: Number(item.qty) || 0, orderNo, warehouseId: _posWarehouseId || undefined });
            if (_dr && _dr.ok === false) stockFailedItems.push((item.name || `#${item.id}`) + (_dr.reason ? ` (${_dr.reason})` : ""));
          }
        } catch(e) {
          console.warn("[POS] deduct stock failed:", e?.message || e);
          stockFailedItems.push((item.name || `#${item.id}`) + " (error)");
        }
      }
      // ★ audit S2: บิลบันทึกแล้วแต่บางรายการขาด → เตือนชัด (เดิมแค่ console.error → COGS/สต็อก/รายงานเพี้ยนเงียบ)
      if (failedItems.length > 0) {
        console.error("[POS] sale_items incomplete:", { orderNo, saleId, failedItems });
        window.App?.showToast?.(`⚠️ บิล ${orderNo}: บันทึกรายการสินค้าไม่สำเร็จ ${failedItems.length} รายการ (${failedItems.slice(0, 3).join(", ")}${failedItems.length > 3 ? "…" : ""}) — โปรดตรวจ/เพิ่มในบิลนี้เอง`);
      }
      // ★ Phase 469: ตัดสต็อกไม่ครบ → ติดธง "[สต็อกไม่ครบ]" บนบิล + เตือนชัด (บิลออกแล้ว ไม่บล็อก — owner เลือก warn+flag)
      if (stockFailedItems.length > 0) {
        console.error("[POS] stock deduct incomplete:", { orderNo, saleId, stockFailedItems });
        window.App?.showToast?.(`⚠️ บิล ${orderNo}: ตัดสต็อกไม่ครบ ${stockFailedItems.length} รายการ (${stockFailedItems.slice(0, 2).join(", ")}${stockFailedItems.length > 2 ? "…" : ""}) — บิลออกแล้ว ติดธงไว้ โปรดตรวจสต็อก/คลัง`);
        try {
          const cfgF = window.SUPABASE_CONFIG;
          const tkF = window._sbAccessToken || cfgF.anonKey;
          const _flagNote = (salePayload.note ? salePayload.note + " " : "") + "[สต็อกไม่ครบ]";
          const rF = await fetch(cfgF.url + "/rest/v1/sales?id=eq." + saleId, {
            method: "PATCH",
            headers: { "apikey": cfgF.anonKey, "Authorization": "Bearer " + tkF, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ note: _flagNote })
          });
          if (!rF.ok) console.warn("[POS] flag note PATCH failed:", rF.status);
        } catch(e) { console.warn("[POS] flag note PATCH threw:", e?.message || e); }
      }
    }

    // โหลดใบเสร็จ (ใช้ fetch + timeout ไม่ใช้ Supabase JS ที่ค้างบนมือถือ)
    try {
      const cfg2 = window.SUPABASE_CONFIG;
      const tk = window._sbAccessToken || cfg2.anonKey;
      const hdrs = { "apikey": cfg2.anonKey, "Authorization": "Bearer " + tk };
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 5000); // 5 วินาที timeout

      const [saleRes2, itemsRes2] = await Promise.all([
        fetch(cfg2.url + "/rest/v1/sales?id=eq." + saleId + "&select=*", { headers: hdrs, signal: ctrl.signal }).then(r => r.json()).catch(() => []),
        fetch(cfg2.url + "/rest/v1/sale_items?sale_id=eq." + saleId + "&select=*&order=id.asc", { headers: hdrs, signal: ctrl.signal }).then(r => r.json()).catch(() => [])
      ]);
      clearTimeout(tmr);

      const saleData = Array.isArray(saleRes2) ? saleRes2[0] : saleRes2;
      const itemsData = Array.isArray(itemsRes2) ? itemsRes2 : [];
      if (saleData) {
        /* eslint-disable require-atomic-updates -- protected by _posCheckoutGuard single-flight (Phase 89.42): no concurrent checkout can interleave this assignment */
        state.lastReceipt = { ...saleData, items: itemsData };
        /* eslint-enable require-atomic-updates */
        localStorage.setItem("bsk_last_receipt", JSON.stringify(state.lastReceipt));
      }
    } catch (receiptErr) {
      console.warn("[POS] receipt fetch failed:", receiptErr.message);
    }

    // ★ เคลียร์ + กลับหน้า home เสมอ
    // Phase 89.42: race prevented by _posCheckoutGuard single-flight (no concurrent invocation can reach this line)
    /* eslint-disable require-atomic-updates -- protected by _posCheckoutGuard single-flight (Phase 89.42) */
    state.cart = [];
    localStorage.setItem("bsk_cart_v2", JSON.stringify(state.cart));
    numpadValue = "";
    quickPayAmount = 0;
    posView = "home";
    _posCustomer = null; // เคลียร์ลูกค้าหลังจบบิล
    /* eslint-enable require-atomic-updates */

    window.App?.showToast?.("บันทึกการขายเรียบร้อย ✅");
    try { openReceiptDrawer(); } catch (e) { console.warn("openReceiptDrawer error:", e); }
    try { if (window.App?.loadAllData) await window.App.loadAllData(); } catch (e) { console.warn("[pos] loadAllData after checkout failed:", e); }

    // ★ Phase 88.1a — auto-post JV (background, ไม่ block UX)
    // ★ Phase 89.1 FIX: spread salePayload เข้าไป → ส่ง note (BANK_COA) + vat_amount/rate/subtotal_before_vat
    //   เดิม pass แค่ 6 fields → Phase 88.20 (bank picker) + 88.21 (VAT split) พังเงียบ
    //   เพราะ postJournalForSale อ่าน sale.note (regex BANK_COA) + sale.vat_amount ไม่เจอ
    void (async () => {
      const postRes = await postJournalForSale({
        ...salePayload,
        id: saleId,
        created_at: new Date().toISOString()
      }, { detailed: true });
      if (postRes?.status === "failed") {
        console.warn("[pos] auto-post JV failed:", postRes.reason, postRes.error || "");
        window.App?.showToast?.("บันทึกขายแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
      }
    })().catch(e => {
      console.warn("[pos] auto-post JV failed:", e?.message);
      window.App?.showToast?.("บันทึกขายแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
    });

    // ★ Phase 91.1 — auto-earn loyalty points for the customer (fire-and-forget).
    // Silent skip when: no customer selected / loyalty system off / rate not configured.
    // We use dynamic import with ?v=APP_BUILD cache-bust (matches main.js _bustedUrl pattern, Phase 90.7)
    // so a new build doesn't serve a stale parsed module from the browser's ESM registry.
    if (_earnCustomerId
        && state.loyaltySettings?.is_active
        && Number(state.loyaltySettings?.points_per_baht || 0) > 0) {
      import('./loyalty.js?v=' + (window.APP_BUILD || 'dev'))
        .then(m => m.earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, {
          state,
          showToast: window.App?.showToast,
          loadAllData: window.App?.loadAllData,
        }))
        .catch(e => console.warn("[pos] loyalty earn failed:", e?.message));
    }

    // ★ ส่ง Line Notify ให้เจ้าของ (async — ไม่รอ)
    try {
      if (window._appNotifySaleToLine) {
        const items = state.lastReceipt?.items || [];
        window._appNotifySaleToLine({ orderNo, cartSnapshot: salePayload, items }).catch(e => console.warn("[POS] line notify:", e?.message));
      }
    } catch(e) { console.warn("[POS] notify error:", e?.message); }

    // ★ Phase 21: ถามบันทึก Serial Number ถ้าเป็นเครื่องใช้ไฟฟ้า (non-blocking)
    try {
      if (window._appPromptSerialAfterSale && saleId) {
        const items = state.lastReceipt?.items || [];
        const cName = _posCustomer?.name || custName || "ลูกค้าทั่วไป";
        const cId = _posCustomer?.id || null;
        // เปิดถามหลัง receipt drawer แสดงแล้ว 1 วินาที (ไม่กวน)
        setTimeout(() => {
          try { window._appPromptSerialAfterSale({ saleId, items, customerId: cId, customerName: cName }); }
          catch(e) { console.warn("[POS] serial prompt failed:", e?.message); }
        }, 1200);
      }
    } catch(e) { console.warn("[POS] serial prompt setup failed:", e?.message); }

  } catch (err) {
    window.App?.showToast?.("เกิดข้อผิดพลาด: " + (err.message || err));
    console.error("[pos doCheckout] error:", err);
  } finally {
    // ★ reset UI buttons เสมอ (lock release handled by _posCheckoutGuard.finally)
    const confirmBtn = document.getElementById("posConfirmWithProof");
    const noProofBtn = document.getElementById("posConfirmNoProof");
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "เสร็จสิ้น"; }
    if (noProofBtn) { noProofBtn.disabled = false; noProofBtn.textContent = "ข้าม ไม่แนบสลิป → เสร็จสิ้น"; }
  }
  });
}


// ═══════════════════════════════════════════════════════════
//  PRODUCT LIST BINDINGS
// ═══════════════════════════════════════════════════════════
function bindProductList(state, ctx, signal) {
  document.querySelectorAll("[data-add-pos-product-id]").forEach(btn => btn.addEventListener("click", () => {
    const id = Number(btn.dataset.addPosProductId);
    // Phase 464: กัน double-add — จอสัมผัส POS ยิง click 2 ครั้งต่อ 1 แตะ → บล็อกสินค้า "ตัวเดิม" ภายใน 350ms
    //   (เพิ่มสินค้า "คนละตัว" รัว ๆ ยังได้ครบ เพราะ id ต่างกัน; เพิ่มตัวเดิมจริง ๆ เว้น >350ms)
    const now = Date.now();
    if (id === _posLastAdd.id && (now - _posLastAdd.t) < 350) return;
    _posLastAdd = { id, t: now };
    // silent = ไม่ re-render ทั้งหน้า → อยู่หน้าเลือกสินค้าเดิม เพิ่มได้หลายรายการรวด (ไม่เด้งกลับ home)
    ctx.addToCart(id, { silent: true });
    updateStickyBar(state);
  }, { signal }));
}

function bindProductSearch(state, ctx, signal) {
  document.getElementById("posSearchInput")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = _posProductsForWh(state).filter(p =>
      String(p.name||"").toLowerCase().includes(q) ||
      String(p.sku||"").toLowerCase().includes(q) ||
      String(p.barcode||"").toLowerCase().includes(q)
    );
    document.getElementById("posProductList").innerHTML = renderProductCards(filtered, canEditPosPrice(state), state);
    bindProductList(state, ctx, signal);
  }, { signal });
}

// การ์ดสินค้า POS (admin/sales เท่านั้น): กด ✏️ = แก้ราคา inline เร็ว · กดการ์ด = เปิดหน้าสินค้าเต็ม (FlowAccount-style)
// delegation บน container กัน search re-render ทำ listener หลุด
function bindPriceEdit(state, ctx, signal) {
  const list = document.getElementById("posProductList");
  if (!list) return;
  const restore = (row, prod, price) => {
    row.innerHTML = priceRowHtml({ ...prod, price }, canEditPosPrice(state));
  };
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".pos-edit-price-btn");
    if (!btn) {
      // กดที่การ์ด (ไม่ใช่ปุ่ม + / ช่องกรอกราคาที่กำลังแก้) → เปิดฟอร์มสินค้าเต็ม (ราคา/ต้นทุน/สต็อก/ชื่อ)
      if (e.target.closest(".pos-add-btn, .pos-price-input, .pos-price-save, .pos-price-cancel")) return;
      if (!canEditPosPrice(state)) return; // cashier: กดการ์ดไม่ทำอะไร (ไม่มี ✏️ + ไม่เปิด drawer)
      const card = e.target.closest(".pos-product-card[data-product-id]");
      if (!card) return;
      const prod = (state.products || []).find(p => String(p.id) === String(card.dataset.productId));
      if (prod && ctx?.openProductDrawer) ctx.openProductDrawer(prod);
      return;
    }
    if (!canEditPosPrice(state)) return; // defense-in-depth (UI ก็ซ่อนปุ่มอยู่แล้ว)
    const id = btn.dataset.editPriceId;
    const prod = (state.products || []).find(p => String(p.id) === String(id));
    const row = btn.closest(".pos-price-row");
    if (!prod || !row || row.querySelector(".pos-price-input")) return; // กำลังแก้อยู่
    const oldPrice = Number(prod.price || 0);
    row.innerHTML =
      `<input class="pos-price-input" type="number" inputmode="decimal" min="0" step="0.01" value="${oldPrice}" style="width:96px;padding:4px 6px;border:1px solid #0284c7;border-radius:6px;font-weight:700" />` +
      `<button class="pos-price-save" style="border:none;background:#10b981;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer">✓</button>` +
      `<button class="pos-price-cancel" style="border:none;background:#e2e8f0;color:#334155;border-radius:6px;padding:4px 9px;cursor:pointer">✗</button>`;
    const input = row.querySelector(".pos-price-input");
    input?.focus(); input?.select();
    row.querySelector(".pos-price-cancel")?.addEventListener("click", () => restore(row, prod, oldPrice), { signal });
    const doSave = async () => {
      const newPrice = Math.round(Number(input.value || 0) * 100) / 100;
      if (isNaN(newPrice) || newPrice < 0) { window.App?.showToast?.("ราคาไม่ถูกต้อง"); return; }
      if (newPrice === oldPrice) { restore(row, prod, oldPrice); return; }
      const ok = await window.App?.confirm?.(`เปลี่ยนราคาขาย "${prod.name}"\n฿${oldPrice.toLocaleString()} → ฿${newPrice.toLocaleString()} ?`);
      if (!ok) { restore(row, prod, oldPrice); return; }
      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;
      const saved = await new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(prod.id));
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("apikey", cfg.anonKey);
        xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
        xhr.setRequestHeader("Prefer", "return=minimal");
        xhr.timeout = 8000;
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => resolve(false);
        xhr.ontimeout = () => resolve(false);
        xhr.send(JSON.stringify({ price: newPrice }));
      });
      if (!saved) { window.App?.showToast?.("บันทึกราคาไม่สำเร็จ ลองใหม่", "error"); restore(row, prod, oldPrice); return; }
      prod.price = newPrice; // optimistic — การ์ด/เพิ่มลงตะกร้าครั้งถัดไปใช้ราคาใหม่; ของในตะกร้าเดิม snapshot ราคาเก่า (ไม่กระทบ)
      restore(row, prod, newPrice);
      window.App?.showToast?.(`✓ ราคาใหม่ ${prod.name}: ฿${newPrice.toLocaleString()}`);
    };
    row.querySelector(".pos-price-save")?.addEventListener("click", doSave, { signal });
    input?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); doSave(); }
      else if (ev.key === "Escape") restore(row, prod, oldPrice);
    }, { signal });
  }, { signal });
}

function updateStickyBar(state) {
  const t = cartSum(state.cart);
  const q = state.cart.reduce((s,i)=>s+i.qty,0);
  const btn = document.getElementById("posStickyPayBtn");
  if (btn) btn.innerHTML = `${q} รายการ &nbsp;&nbsp; ฿${moneyNum(t)}`;
}

// Phase 464: เลือกคลังขาย (คลังเดียวต่อบิล) → จำใน localStorage + re-render (bar/list/คงเหลือ)
function bindWarehouseChips(ctx, signal) {
  document.querySelectorAll(".pos-wh-chip").forEach(btn => btn.addEventListener("click", () => {
    _posWarehouseId = btn.dataset.posWh || "";
    try {
      if (_posWarehouseId) localStorage.setItem("bsk_pos_warehouse", _posWarehouseId);
      else localStorage.removeItem("bsk_pos_warehouse");
    } catch(_e) { /* localStorage ปิด — ใช้ค่าใน memory ต่อ */ }
    renderPosView(ctx);
  }, { signal }));
}


// ═══════════════════════════════════════════════════════════
//  SCANNER
// ═══════════════════════════════════════════════════════════
function startScanner(ctx) {
  const scanArea = document.getElementById("posScannerArea");
  if (!scanArea) return;
  if (typeof Html5Qrcode === "undefined") {
    scanArea.innerHTML = '<div class="sku" style="text-align:center;padding:40px">กำลังโหลดตัวสแกน...</div>';
    const script = document.createElement("script");
    script.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    script.onload = () => initScanner(ctx);
    script.onerror = () => { scanArea.innerHTML = '<div class="sku" style="text-align:center;padding:40px;color:var(--danger)">ไม่สามารถโหลดตัวสแกนได้</div>'; };
    document.head.appendChild(script);
    return;
  }
  initScanner(ctx);
}

async function initScanner(ctx) {
  const scanArea = document.getElementById("posScannerArea");
  if (!scanArea) return;
  await stopScannerHard();
  // Phase 64: shared scanner config (1D barcodes + QR)
  const { getScannerConfig } = await import("./utils.js");
  const { ctorOpts, startConfig } = getScannerConfig();
  try {
    const sessionId = ++_posScanSessionId;
    _posScannerActive = true;
    scannerInstance = new Html5Qrcode("posScannerArea", ctorOpts);
    scannerInstance.start(
      { facingMode: "environment" },
      startConfig,
      async (decodedText) => {
        if (!_posScannerActive || sessionId !== _posScanSessionId || _posScanInProgress || posView !== "scanner") return;
        _posScanInProgress = true;
        _posScannerActive = false;
        await stopScannerHard();
        handleScanResult(decodedText, ctx);
        setTimeout(() => { _posScanInProgress = false; }, 800);
      },
      () => {}
    ).catch(err => {
      _posScannerActive = false;
      scanArea.innerHTML = `<div class="sku" style="text-align:center;padding:40px">ไม่สามารถเปิดกล้องได้<br><span style="font-size:11px">${escHtml(err && err.message || err)}</span></div>`;
    });
  } catch(e) {
    _posScannerActive = false;
    // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L2 scanner UI singleton (catch path, 1 camera per session)
    scanArea.innerHTML = '<div class="sku" style="text-align:center;padding:40px">ไม่สามารถเปิดกล้องได้</div>';
  }
}

async function stopScannerHard() {
  _posScannerActive = false;
  _posScanSessionId++;
  const scanner = scannerInstance;
  scannerInstance = null;

  if (scanner) {
    try {
      // ★ FIX: Html5Qrcode ใช้ getState() แทน isScanning
      const state = typeof scanner.getState === 'function'
        ? scanner.getState() : null;
      // state: 1 = NOT_STARTED, 2 = SCANNING, 3 = PAUSED
      if (state === 2 || state === 3) {
        await scanner.stop().catch(e =>
          console.warn("QR Scanner stop (safe to ignore):", e.message || e));
      }
    } catch (e) {
      console.warn("QR Scanner stop error:", e.message);
    }
    try {
      const clearResult = scanner.clear?.();
      if (clearResult?.catch) await clearResult.catch(() => {});
    } catch (e) {
      console.warn("QR Scanner clear (safe to ignore):", e.message);
    }
  }
}

function stopScanner() {
  stopScannerHard().catch(() => {});
}

if (typeof window !== "undefined") {
  window._stopPosScanner = () => stopScanner();
}

function handleScanResult(code, ctx) {
  const product = ctx.state.products.find(p =>
    String(p.barcode||"").toLowerCase() === code.toLowerCase() ||
    String(p.sku||"").toLowerCase() === code.toLowerCase()
  );
  const resultEl = document.getElementById("posScanResult");
  if (product) {
    ctx.addToCart(product.id);
    if (resultEl) resultEl.innerHTML = `<div class="badge ok" style="font-size:14px;padding:8px 16px">เพิ่ม "${escHtml(product.name)}" แล้ว</div>`;
    window.App?.showToast?.(`เพิ่ม ${product.name} ลงบิล`);
  } else {
    if (resultEl) resultEl.innerHTML = `<div class="badge low" style="font-size:14px;padding:8px 16px">ไม่พบสินค้า: ${escHtml(code)}</div>`;
    window.App?.showToast?.("ไม่พบสินค้าที่ตรงกับบาร์โค้ดนี้");
  }
}


// ═══════════════════════════════════════════════════════════
//  RENDERERS
// ═══════════════════════════════════════════════════════════
// สิทธิ์แก้ราคาขายจาก POS = admin/sales เท่านั้น (ตรงกับ canManageProducts หน้าสินค้า)
function canEditPosPrice(state) {
  return ["admin", "sales"].includes(state?.profile?.role);
}

// ─── Phase 464: เลือกคลังขาย (คลังเดียวต่อบิล) ───────────────────────────────
// สต็อกของสินค้าในคลังที่ระบุ (จาก warehouse_stock cache)
function _posWhStock(state, productId, whId) {
  const ws = (state.warehouseStock || []).find(s =>
    String(s.product_id) === String(productId) && String(s.warehouse_id) === String(whId));
  return ws ? Number(ws.stock || 0) : 0;
}
// รายการสินค้าตามคลังที่เลือก — "" (auto) = ทั้งหมด; เลือกคลัง = เฉพาะที่มีสต็อก > 0 ในคลังนั้น
function _posProductsForWh(state) {
  const all = state.products || [];
  if (!_posWarehouseId) return all;
  const ids = new Set((state.warehouseStock || [])
    .filter(s => String(s.warehouse_id) === String(_posWarehouseId) && Number(s.stock || 0) > 0)
    .map(s => String(s.product_id)));
  return all.filter(p => ids.has(String(p.id)));
}
function _posWarehouseChips(state) {
  const whs = state.warehouses || [];
  const chip = (id, label, emoji) => {
    const active = String(_posWarehouseId) === String(id);
    return `<button class="pos-wh-chip" data-pos-wh="${escHtml(String(id))}" style="border:1px solid ${active ? '#0284c7' : '#cbd5e1'};background:${active ? '#0284c7' : '#fff'};color:${active ? '#fff' : '#475569'};border-radius:14px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">${emoji} ${escHtml(label)}</button>`;
  };
  return `<div class="pos-wh-bar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:12px;color:#64748b;font-weight:700">ขายจากคลัง:</span>
    ${chip("", "อัตโนมัติ", "⚙️")}
    ${whs.map(w => chip(w.id, w.name, w.is_mobile ? "🚐" : "📦")).join("")}
  </div>`;
}

function priceRowHtml(p, canEdit) {
  return `<span class="pos-price-val" style="font-weight:900;color:var(--primary2)">${money(p.price)}</span>` +
    (canEdit ? `<button class="pos-edit-price-btn" data-edit-price-id="${p.id}" title="แก้ราคาขาย" style="border:none;background:#eff6ff;color:#0284c7;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:12px">✏️</button>` : "");
}

function renderProductCards(products, canEdit = false, state = null) {
  if (!products.length) return '<div class="card">ไม่พบสินค้า</div>';
  const whName = (_posWarehouseId && state) ? ((state.warehouses || []).find(w => String(w.id) === String(_posWarehouseId))?.name || "") : "";
  return products.map(p => {
    const remain = (_posWarehouseId && state) ? _posWhStock(state, p.id, _posWarehouseId) : null;
    return `
    <div class="pos-product-card" data-product-id="${p.id}"${canEdit ? ` style="cursor:pointer" title="กดที่การ์ดเพื่อเปิดหน้าสินค้า (แก้ราคา/ต้นทุน/สต็อก)"` : ""}>
      <div class="pos-product-info">
        <div style="font-weight:900;font-size:15px">${escHtml(p.name)}</div>
        <div class="sku">${escHtml(p.sku) || "-"} ${p.barcode ? "• " + escHtml(p.barcode) : ""}</div>
        <div class="pos-price-row" data-price-row="${p.id}" style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${priceRowHtml(p, canEdit)}</div>
        ${remain !== null ? `<div style="font-size:11px;color:#0f766e;font-weight:700;margin-top:2px">🔻 ตัดจาก ${escHtml(whName)} • คงเหลือ ${Number(remain).toLocaleString()} ชิ้น</div>` : ""}
      </div>
      <button class="btn primary pos-add-btn" data-add-pos-product-id="${p.id}" style="touch-action:manipulation">+</button>
    </div>`;
  }).join("");
}

function renderCartCompact(cart) {
  if (!cart.length) return '';
  return cart.map(item => `
    <div class="pos-cart-item">
      <div class="pos-cart-item-info">
        <span style="font-weight:700">${escHtml(item.name)}</span>
        <span class="sku">${money(item.price)} x ${item.qty}</span>
      </div>
      <div style="font-weight:900;color:var(--primary2);white-space:nowrap">${money(item.qty * item.price)}</div>
    </div>
  `).join("");
}

export function addToCartLocal(){}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER PICKER MODAL — เลือก/เพิ่ม/สร้างลูกค้าตอน POS
// ═══════════════════════════════════════════════════════════
function openCustomerPicker(ctx) {
  const { state } = ctx;
  document.getElementById("posCustPickerModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "posCustPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">👤 เลือก / เพิ่มลูกค้า</h3>
        <button id="pcpClose" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748b">×</button>
      </div>

      <!-- Search -->
      <div style="padding:12px 18px;border-bottom:1px solid #e5e7eb">
        <input id="pcpSearch" type="text" placeholder="🔍 ค้นหาชื่อ/เบอร์โทร..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" autofocus />
      </div>

      <!-- List -->
      <div id="pcpList" style="flex:1;overflow-y:auto;padding:8px"></div>

      <!-- Quick Add -->
      <div style="padding:12px 18px;border-top:1px solid #e5e7eb;background:#f8fafc">
        <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">+ เพิ่มลูกค้าใหม่ (Quick)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <input id="pcpNewName" type="text" placeholder="ชื่อ" style="flex:2;min-width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px" />
          <input id="pcpNewPhone" type="tel" placeholder="เบอร์โทร" style="flex:1;min-width:100px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px" pattern="[0-9]{9,10}" />
          <button id="pcpAddBtn" class="btn primary" style="padding:8px 14px;font-size:13px">+ เพิ่ม</button>
        </div>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector("#pcpSearch")?.focus(), 50);

  function renderList(query = "") {
    const listEl = modal.querySelector("#pcpList");
    const q = (query || "").trim().toLowerCase();
    let customers = (state.customers || []).filter(c => {
      const ct = String(c.contact_type || "customer");
      return ct === "customer" || ct === "both";
    });
    if (q) {
      customers = customers.filter(c =>
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.phone || "").includes(q) ||
        String(c.contact_person || "").toLowerCase().includes(q)
      );
    }
    customers = customers.slice(0, 50);

    if (customers.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13px">${q ? `ไม่พบ "${escHtml(q)}" — เพิ่มใหม่ด้านล่าง` : 'ยังไม่มีลูกค้า — เพิ่มด้านล่าง'}</div>`;
      return;
    }

    listEl.innerHTML = customers.map(c => {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      const tagsHtml = tags.map(tag => {
        const m = window._appGetCustomerTagMeta ? window._appGetCustomerTagMeta(tag) : { icon: "🏷️", color: "#64748b" };
        return `<span style="background:${m.color};color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;margin-right:3px;display:inline-block">${m.icon} ${escHtml(tag)}</span>`;
      }).join("");
      const noteSnippet = c.notes ? `<div style="font-size:11px;color:var(--primary2);font-style:italic;margin-top:2px">📝 ${escHtml(String(c.notes).slice(0, 60))}${String(c.notes).length > 60 ? '...' : ''}</div>` : "";
      return `
      <div class="pcp-item" data-cid="${escHtml(c.id)}" data-cname="${escHtml(c.name || '')}" data-cphone="${escHtml(c.phone || '')}" style="padding:10px 12px;cursor:pointer;border-radius:8px;margin-bottom:4px;border:1px solid transparent" onmouseover="this.style.background='#e0f2fe';this.style.borderColor='#0284c7'" onmouseout="this.style.background='';this.style.borderColor='transparent'">
        <div style="font-weight:700;font-size:14px">${escHtml(c.name || '-')}</div>
        <div style="font-size:11px;color:#64748b">${escHtml(c.phone || '')} ${c.contact_person ? '• ' + escHtml(c.contact_person) : ''}</div>
        ${tagsHtml ? `<div style="margin-top:4px">${tagsHtml}</div>` : ''}
        ${noteSnippet}
      </div>
    `;
    }).join("");

    listEl.querySelectorAll(".pcp-item").forEach(item => item.addEventListener("click", () => {
      const cid = item.dataset.cid;
      const cust = (state.customers || []).find(x => String(x.id) === String(cid));
      _posCustomer = {
        id: item.dataset.cid,
        name: item.dataset.cname,
        phone: item.dataset.cphone,
        tags: cust?.tags || [],
        notes: cust?.notes || ""
      };
      modal.remove();
      renderPosView(ctx);

      // ★ แจ้งเตือน VIP / ห้ามเครดิต / ระวัง
      const tags = cust?.tags || [];
      const alerts = [];
      if (tags.includes("VIP")) alerts.push("🌟 ลูกค้า VIP");
      if (tags.includes("ห้ามเครดิต")) alerts.push("🚫 ห้ามขายเงินเชื่อ");
      if (tags.includes("ระวัง")) alerts.push("⚠️ ระวัง — ดู notes");
      const alertMsg = alerts.length > 0 ? ` (${alerts.join(", ")})` : "";
      window.App?.showToast?.(`✓ เลือกลูกค้า: ${_posCustomer.name}${alertMsg}`);
    }));
  }
  renderList();

  modal.querySelector("#pcpSearch")?.addEventListener("input", (e) => renderList(e.target.value));
  modal.querySelector("#pcpClose")?.addEventListener("click", () => modal.remove());

  // Quick add new customer
  modal.querySelector("#pcpAddBtn")?.addEventListener("click", async () => {
    const name = (modal.querySelector("#pcpNewName").value || "").trim();
    const phone = (modal.querySelector("#pcpNewPhone").value || "").trim();
    if (!name) { window.App?.showToast?.("กรอกชื่อลูกค้า"); return; }

    const btn = modal.querySelector("#pcpAddBtn");
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const payload = { name, phone, contact_type: "customer" };

    try {
      const result = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", cfg.url + "/rest/v1/customers");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("apikey", cfg.anonKey);
        xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
        xhr.setRequestHeader("Prefer", "return=representation");
        xhr.timeout = 8000;
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)?.[0] || null); }
            catch(e) { resolve(null); }
          } else resolve(null);
        };
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.send(JSON.stringify(payload));
      });

      if (!result) {
        window.App?.showToast?.("เพิ่มลูกค้าไม่สำเร็จ");
        btn.disabled = false; btn.textContent = "+ เพิ่ม";
        return;
      }
      // Reload customers + select the new one
      if (window.App?.loadAllData) await window.App.loadAllData();
      _posCustomer = { id: result.id, name: result.name, phone: result.phone || "" };
      modal.remove();
      renderPosView(ctx);
      window.App?.showToast?.(`✓ เพิ่ม + เลือก: ${result.name}`);
    } catch (e) {
      window.App?.showToast?.("ผิดพลาด: " + (e?.message || e));
      btn.disabled = false; btn.textContent = "+ เพิ่ม";
    }
  });
}
