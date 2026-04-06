
function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
function moneyNum(n){return new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));}

// ★ XHR helper (ป้องกัน supabase .insert() ค้าง)
function xhrPostPOS(table, payload, returnData = false) {
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
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
      } else {
        let errBody = xhr.responseText;
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
let numpadValue = "";
let quickPayAmount = 0;   // ยอดจาก numpad (เก็บเงินทันที) หรือ cart total
let pendingPaidAmount = 0; // จำนวนเงินที่รับมา (สำหรับเงินสด)
let scannerInstance = null;
let _posAbort = null;     // ★ AbortController สำหรับลบ event listeners เก่า

export function renderPosPage({ state, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer }) {
  const ctx = { state, addToCart, changeQty, removeFromCart, openProductDrawer, checkout, openReceiptDrawer };
  posView = "home";
  numpadValue = "";
  quickPayAmount = 0;
  renderPosView(ctx);
}

function renderPosView(ctx) {
  const { state } = ctx;
  const cartTotal = state.cart.reduce((sum,i)=>sum+i.qty*i.price,0);
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
    const todaySales = (state.sales || []).filter(s => {
      if ((s.note || "").includes("[ลบแล้ว]")) return false;
      const d = new Date(s.created_at);
      const today = new Date();
      return d.toDateString() === today.toDateString();
    });
    const todayTotal = todaySales.reduce((s,i)=>s+Number(i.total_amount||0),0);

    el.innerHTML = `
      <!-- Sales Banner -->
      <div class="pos-banner">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
          <button id="posSalesHistory" class="pos-history-btn">ประวัติการขาย ›</button>
        </div>
        <div class="pos-banner-label">วันนี้ขายได้</div>
        <div class="pos-banner-amount">฿${moneyNum(todayTotal)}</div>
        <div class="pos-banner-count">จาก ${todaySales.length} ออเดอร์</div>
      </div>

      <!-- Quick Action Grid -->
      <div class="pos-action-grid">
        <button class="pos-action-btn" id="posQuickPay">
          <div class="pos-action-icon">🧮</div>
          <div class="pos-action-label">เก็บเงินทันที</div>
        </button>
        <button class="pos-action-btn" id="posSelectProduct">
          <div class="pos-action-icon">🛒</div>
          <div class="pos-action-label">เลือกสินค้า</div>
        </button>
        <button class="pos-action-btn" id="posScanBtn">
          <div class="pos-action-icon">📷</div>
          <div class="pos-action-label">สแกนเนอร์</div>
        </button>
        <button class="pos-action-btn" id="posShowQR">
          <div class="pos-action-icon">📱</div>
          <div class="pos-action-label">QR รับเงิน</div>
        </button>
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
    `;

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
    const amount = quickPayAmount || cartTotal;
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
        <div class="pos-pay-label">จากยอดทั้งหมด ${moneyNum(amount)} บาท</div>
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
      else numpadValue = String(Number(numpadValue||0) + Number(v));
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
    const pi = state.paymentInfo || {};
    const hasQR = !!pi.qrImage;

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">${selectedPaymentMethod === "QR พร้อมเพย์" ? 'QR พร้อมเพย์' : 'โอนเงินบัญชีธนาคาร'}</h3>
        <div></div>
      </div>

      <div class="pos-transfer-card">
        ${hasQR ? `
          <div class="pos-transfer-qr-wrap">
            <img src="${pi.qrImage}" alt="QR Code" class="pos-transfer-qr-img" />
          </div>
        ` : `
          <div class="pos-qr-placeholder">
            <div style="font-size:40px;margin-bottom:8px">📱</div>
            <div>ยังไม่ได้ตั้งค่า QR Code</div>
            <div class="sku">ไปที่ ตั้งค่า → ข้อมูลการเงิน</div>
          </div>
        `}

        <div class="pos-transfer-amount">${moneyNum(amount)}</div>

        ${pi.bankName || pi.bankHolder ? `
        <div class="pos-transfer-bank-info">
          ${pi.bankName ? `<div class="pos-transfer-bank-icon">🏦</div>` : ''}
          <div>
            ${pi.bankHolder ? `<div style="font-weight:900">${pi.bankHolder}</div>` : ''}
            ${pi.bankAccount ? `<div class="sku">เลขที่บัญชี ${pi.bankAccount}</div>` : ''}
            ${pi.bankName ? `<div class="sku">${pi.bankName}${pi.bankBranch ? ' สาขา ' + pi.bankBranch : ''}</div>` : ''}
          </div>
        </div>
        ` : ''}

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


  // ═══════════════════════════════════════════════════════
  //  CONFIRM + PROOF — ยืนยัน + แนบสลิป (ทุกวิธีชำระเงิน)
  // ═══════════════════════════════════════════════════════
  } else if (posView === "confirm-proof") {
    const amount = quickPayAmount || cartTotal;
    const methodIcons = { "เงินสด": "💵", "โอนเงิน": "🏦", "บัตรเครดิต": "💳", "QR พร้อมเพย์": "🔗" };

    el.innerHTML = `
      <div class="pos-subpage-header">
        <button class="btn light pos-back-btn" id="posBack">←</button>
        <h3 style="margin:0">ยืนยันการชำระ</h3>
        <div></div>
      </div>

      <!-- สรุปยอด -->
      <div class="pos-pay-amount-box" style="margin:16px;border-radius:16px;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:#fff;padding:24px;text-align:center">
        <div style="font-size:14px;opacity:.8">${selectedPaymentMethod} ${methodIcons[selectedPaymentMethod] || ""}</div>
        <div style="font-size:36px;font-weight:900;margin:8px 0">฿${moneyNum(amount)}</div>
        ${selectedPaymentMethod === "เงินสด" && pendingPaidAmount > amount ? `<div style="font-size:14px;opacity:.8">รับมา ฿${moneyNum(pendingPaidAmount)} — เงินทอน ฿${moneyNum(pendingPaidAmount - amount)}</div>` : ''}
      </div>

      <!-- แนบสลิป -->
      <div class="panel" style="margin:0 16px;border-radius:16px">
        <h4 style="margin:0 0 12px;color:#374151">แนบหลักฐานการชำระเงิน (สลิป)</h4>
        <div class="pos-proof-section" id="proofSection">
          <button class="pos-proof-btn" id="posCaptureProof" style="display:flex;align-items:center;gap:12px;padding:16px;background:#f0fdf4;border:2px dashed #86efac;border-radius:12px;cursor:pointer;width:100%;text-align:left;font-size:15px">
            <span style="font-size:28px">📷</span>
            <div>
              <div style="font-weight:700;color:#166534">ถ่ายรูป / เลือกรูปสลิป</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px">เปิดกล้องถ่ายสลิป หรือเลือกจากแกลเลอรี่</div>
            </div>
          </button>
        </div>
        <input type="file" id="posProofFileInput" accept="image/*" capture="environment" style="display:none" />
      </div>

      <!-- ปุ่ม -->
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <button id="posConfirmWithProof" class="pos-collect-btn" style="width:100%;background:#10b981">เสร็จสิ้น</button>
        <button id="posConfirmNoProof" class="btn light" style="width:100%;padding:14px;font-size:15px;color:#6b7280">ข้าม ไม่แนบสลิป → เสร็จสิ้น</button>
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

    // ─── ถ่ายรูป/เลือกไฟล์ ───
    const proofInput = document.getElementById("posProofFileInput");
    document.getElementById("posCaptureProof")?.addEventListener("click", () => {
      proofInput?.click();
    }, { signal });

    proofInput?.addEventListener("change", async (e) => {
      let file = e.target.files?.[0];
      if (!file) return;
      // Note: Change event doesn't use signal because it's on input element

      // ★ บีบอัดรูปก่อนอัปโหลด
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
    });

    // ─── เสร็จสิ้น (พร้อมสลิป) ───
    document.getElementById("posConfirmWithProof")?.addEventListener("click", () => {
      doCheckout(ctx, selectedPaymentMethod, pendingPaidAmount || amount);
    }, { signal });

    // ─── ข้าม ไม่แนบสลิป ───
    document.getElementById("posConfirmNoProof")?.addEventListener("click", () => {
      window._pendingProofUrl = "";
      doCheckout(ctx, selectedPaymentMethod, pendingPaidAmount || amount);
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
    const t = state.cart.reduce((s,i)=>s+i.qty*i.price,0);
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
      <div id="posProductList" class="pos-product-grid mt16">
        ${renderProductCards(state.products)}
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
      quickPayAmount = state.cart.reduce((s,i)=>s+i.qty*i.price,0);
      posView = "payment-select"; renderPosView(ctx);
    }, { signal });

    bindProductList(state, ctx, signal);
    bindProductSearch(state, ctx, signal);


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
    const amount = quickPayAmount;
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
  const { state, openReceiptDrawer } = ctx;
  const amount = quickPayAmount || state.cart.reduce((s,i)=>s+i.qty*i.price,0);

  try {
    const orderNo = "BSK-" + Date.now();
    const proofUrl = window._pendingProofUrl || "";
    window._pendingProofUrl = "";
    const salePayload = {
      order_no: orderNo,
      customer_name: "ลูกค้าทั่วไป",
      payment_method: paymentMethod,
      subtotal: amount,
      total_amount: amount,
      paid_amount: paidAmount || amount,
      change_amount: Math.max((paidAmount || amount) - amount, 0),
      note: proofUrl && proofUrl.startsWith("http") ? "สลิป: " + proofUrl : "",
      proof_url: proofUrl && proofUrl.startsWith("http") ? proofUrl : null,
      created_by: state.currentUser.id
    };

    // ★ ใช้ XHR แทน supabase .insert() ที่ค้าง
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const saleRes = await xhrPostPOS("sales", salePayload, true);
    if (!saleRes.ok) { window.App?.showToast?.(saleRes.error || "บันทึกไม่สำเร็จ"); return; }

    const saleId = saleRes.data?.id;
    if (!saleId) { window.App?.showToast?.("ไม่สามารถดึง ID การขายได้"); return; }

    // ถ้ามีสินค้าในตะกร้า → บันทึก sale_items + ลดสต๊อก
    if (state.cart.length > 0) {
      for (const item of state.cart) {
        const itemPayload = {
          sale_id: saleId,
          product_id: item.id || null,
          product_name: item.name || "สินค้า",
          sku: item.sku || null,
          qty: Number(item.qty) || 1,
          unit_price: Number(item.price) || 0,
          line_total: Number(item.qty || 1) * Number(item.price || 0)
        };
        console.log("[POS] sale_items payload:", itemPayload);
        const itemRes = await xhrPostPOS("sale_items", itemPayload);
        if (!itemRes.ok) {
          console.error("[POS] sale_items insert failed:", itemRes.error, "payload:", itemPayload);
          window.App?.showToast?.("บันทึกรายการสินค้าไม่สำเร็จ: " + (itemRes.error || "unknown"));
        }
        await state.supabase.rpc("deduct_stock", { p_product_id: item.id, p_qty: item.qty }).catch(() => {});
      }
    }

    // โหลดใบเสร็จ
    const saleResult = await state.supabase.from("sales").select("*").eq("id", saleId).single();
    const itemsResult = await state.supabase.from("sale_items").select("*").eq("sale_id", saleId).order("id",{ascending:true});
    if (!saleResult.error && !itemsResult.error) {
      state.lastReceipt = { ...saleResult.data, items: itemsResult.data || [] };
      localStorage.setItem("bsk_last_receipt", JSON.stringify(state.lastReceipt));
    }

    state.cart = [];
    localStorage.setItem("bsk_cart_v2", JSON.stringify(state.cart));
    numpadValue = "";
    quickPayAmount = 0;
    posView = "home";

    window.App?.showToast?.("บันทึกการขายเรียบร้อย");
    openReceiptDrawer();
    if (window.App?.loadAllData) await window.App.loadAllData();

  } catch (err) {
    window.App?.showToast?.("เกิดข้อผิดพลาด: " + (err.message || err));
  }
}


// ═══════════════════════════════════════════════════════════
//  PRODUCT LIST BINDINGS
// ═══════════════════════════════════════════════════════════
function bindProductList(state, ctx, signal) {
  document.querySelectorAll("[data-add-pos-product-id]").forEach(btn => btn.addEventListener("click", () => {
    ctx.addToCart(Number(btn.dataset.addPosProductId));
    updateStickyBar(state);
  }, { signal }));
}

function bindProductSearch(state, ctx, signal) {
  document.getElementById("posSearchInput")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = state.products.filter(p =>
      String(p.name||"").toLowerCase().includes(q) ||
      String(p.sku||"").toLowerCase().includes(q) ||
      String(p.barcode||"").toLowerCase().includes(q)
    );
    document.getElementById("posProductList").innerHTML = renderProductCards(filtered);
    bindProductList(state, ctx, signal);
  }, { signal });
}

function updateStickyBar(state) {
  const t = state.cart.reduce((s,i)=>s+i.qty*i.price,0);
  const q = state.cart.reduce((s,i)=>s+i.qty,0);
  const btn = document.getElementById("posStickyPayBtn");
  if (btn) btn.innerHTML = `${q} รายการ &nbsp;&nbsp; ฿${moneyNum(t)}`;
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

function initScanner(ctx) {
  const scanArea = document.getElementById("posScannerArea");
  if (!scanArea) return;
  try {
    scannerInstance = new Html5Qrcode("posScannerArea");
    scannerInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
      (decodedText) => { handleScanResult(decodedText, ctx); stopScanner(); },
      () => {}
    ).catch(err => {
      scanArea.innerHTML = `<div class="sku" style="text-align:center;padding:40px">ไม่สามารถเปิดกล้องได้<br><span style="font-size:11px">${err}</span></div>`;
    });
  } catch(e) {
    scanArea.innerHTML = '<div class="sku" style="text-align:center;padding:40px">ไม่สามารถเปิดกล้องได้</div>';
  }
}

function stopScanner() {
  if (scannerInstance) {
    try {
      if (scannerInstance && scannerInstance.isScanning) {
        scannerInstance.stop().catch(() => {});
      }
    } catch (e) {
      console.warn("QR Scanner stop (safe to ignore):", e.message);
    }
    try {
      scannerInstance.clear().catch(() => {});
    } catch (e) {
      console.warn("QR Scanner clear (safe to ignore):", e.message);
    }
    scannerInstance = null;
  }
}

function handleScanResult(code, ctx) {
  const product = ctx.state.products.find(p =>
    String(p.barcode||"").toLowerCase() === code.toLowerCase() ||
    String(p.sku||"").toLowerCase() === code.toLowerCase()
  );
  const resultEl = document.getElementById("posScanResult");
  if (product) {
    ctx.addToCart(product.id);
    if (resultEl) resultEl.innerHTML = `<div class="badge ok" style="font-size:14px;padding:8px 16px">เพิ่ม "${product.name}" แล้ว</div>`;
    window.App?.showToast?.(`เพิ่ม ${product.name} ลงบิล`);
  } else {
    if (resultEl) resultEl.innerHTML = `<div class="badge low" style="font-size:14px;padding:8px 16px">ไม่พบสินค้า: ${code}</div>`;
    window.App?.showToast?.("ไม่พบสินค้าที่ตรงกับบาร์โค้ดนี้");
  }
}


// ═══════════════════════════════════════════════════════════
//  RENDERERS
// ═══════════════════════════════════════════════════════════
function renderProductCards(products) {
  if (!products.length) return '<div class="card">ไม่พบสินค้า</div>';
  return products.map(p => `
    <div class="pos-product-card">
      <div class="pos-product-info">
        <div style="font-weight:900;font-size:15px">${p.name}</div>
        <div class="sku">${p.sku || "-"} ${p.barcode ? "• " + p.barcode : ""}</div>
        <div style="font-weight:900;color:var(--primary2);margin-top:4px">${money(p.price)}</div>
      </div>
      <button class="btn primary pos-add-btn" data-add-pos-product-id="${p.id}">+</button>
    </div>
  `).join("");
}

function renderCartCompact(cart) {
  if (!cart.length) return '';
  return cart.map(item => `
    <div class="pos-cart-item">
      <div class="pos-cart-item-info">
        <span style="font-weight:700">${item.name}</span>
        <span class="sku">${money(item.price)} x ${item.qty}</span>
      </div>
      <div style="font-weight:900;color:var(--primary2);white-space:nowrap">${money(item.qty * item.price)}</div>
    </div>
  `).join("");
}

export function addToCartLocal(){}
