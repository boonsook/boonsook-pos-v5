import { escHtml, THAI_BANKS } from "./utils.js";
import { ACCOUNTING_EFFECTIVE_DATE } from "../accounting/effective_date.js";
// Phase 439 (B1): customer-group → bank mapping (this select tags each bank for a customer group)
import { CUSTOMER_GROUPS } from "../customer_groups.js";

function _syncBanksFromDom(el, ctx) {
  const { state } = ctx;
  if (!state?.paymentInfo?.banks) return;
  const bankCards = el.querySelectorAll(".pay-bank-card");
  bankCards.forEach(card => {
    const idx = Number(card.dataset.bankIdx);
    if (!state.paymentInfo.banks[idx]) return;
    const bankCode = card.querySelector(`[data-bank-field="bankCode"][data-bank-idx="${idx}"]`)?.value || "";
    let bankName = "";
    if (bankCode === "OTHER") {
      bankName = card.querySelector(`[data-bank-field="bankNameCustom"][data-bank-idx="${idx}"]`)?.value?.trim() || "";
    } else {
      const found = THAI_BANKS.find(b => b.code === bankCode);
      bankName = found ? found.name : "";
    }
    state.paymentInfo.banks[idx].bankCode = bankCode;
    state.paymentInfo.banks[idx].bankName = bankName;
    state.paymentInfo.banks[idx].bankAccount = card.querySelector(`[data-bank-field="bankAccount"][data-bank-idx="${idx}"]`)?.value?.trim() || "";
    state.paymentInfo.banks[idx].bankHolder = card.querySelector(`[data-bank-field="bankHolder"][data-bank-idx="${idx}"]`)?.value?.trim() || "";
    state.paymentInfo.banks[idx].bankBranch = card.querySelector(`[data-bank-field="bankBranch"][data-bank-idx="${idx}"]`)?.value?.trim() || "";
    state.paymentInfo.banks[idx].coaCode    = card.querySelector(`[data-bank-field="coaCode"][data-bank-idx="${idx}"]`)?.value?.trim() || "";
    state.paymentInfo.banks[idx].customerGroup = card.querySelector(`[data-bank-field="customerGroup"][data-bank-idx="${idx}"]`)?.value || ""; // Phase 439
  });
  // ★ PromptPay
  const ppEl = document.getElementById("setPromptPay");
  if (ppEl) state.paymentInfo.promptPay = ppEl.value.trim();
}

export function renderSettingsPayment(el, ctx, goBack, navigate) {
  const { state, showToast, savePaymentInfo } = ctx;
  const banks = state.paymentInfo.banks || [];

  function bankOptionsHtml(selectedCode) {
    return THAI_BANKS.map(b => {
      const sel = (selectedCode === b.code) ? "selected" : "";
      return `<option value="${b.code}" ${sel}>${b.name}</option>`;
    }).join("");
  }

  const qrPreview = state.paymentInfo.qrImage
    ? `<div class="qr-preview-box"><img src="${escHtml(state.paymentInfo.qrImage)}" alt="QR Code" class="qr-preview-img" /><button id="removeQrBtn" class="btn danger-fill" style="margin-top:8px;font-size:12px;padding:6px 12px">ลบ QR</button></div>`
    : '';

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ตั้งค่าช่องทางการเงิน</h3>
      </div>

      <!-- Bank Accounts Section -->
      <div class="set-form-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="set-section-title" style="margin:0">บัญชีธนาคาร</div>
          <button id="addBankBtn" class="btn primary" style="padding:6px 14px;font-size:13px;border-radius:12px">+ เพิ่มบัญชี</button>
        </div>
        <div class="sku" style="margin-bottom:12px">ข้อมูลนี้จะแสดงในใบเสร็จและ QR จ่ายเงินหน้าแคชเชียร์</div>
        <div id="bankList">
          ${banks.length ? banks.map((bank, idx) => {
            const isCustom = bank.bankCode === "OTHER";
            return `
            <div class="pay-bank-card" data-bank-idx="${idx}">
              <div class="pay-bank-header">
                <span class="pay-bank-num">บัญชีที่ ${idx+1}</span>
                <button class="pay-bank-remove" data-remove-bank="${idx}" title="ลบบัญชี">✕</button>
              </div>
              <div class="stack">
                <label class="set-field-label">ธนาคาร</label>
                <select class="bank-select" data-bank-field="bankCode" data-bank-idx="${idx}">${bankOptionsHtml(bank.bankCode)}</select>
                <div class="custom-bank-row ${isCustom ? '' : 'hidden'}" data-custom-row="${idx}">
                  <input class="bank-input" data-bank-field="bankNameCustom" data-bank-idx="${idx}" value="${escHtml(isCustom ? bank.bankName : '')}" placeholder="พิมพ์ชื่อธนาคาร" />
                </div>

                <label class="set-field-label">เลขที่บัญชี</label>
                <input class="bank-input" data-bank-field="bankAccount" data-bank-idx="${idx}" value="${escHtml(bank.bankAccount || '')}" placeholder="เลขที่บัญชี" inputmode="numeric" />

                <label class="set-field-label">ชื่อบัญชี</label>
                <input class="bank-input" data-bank-field="bankHolder" data-bank-idx="${idx}" value="${escHtml(bank.bankHolder || '')}" placeholder="ชื่อบัญชี" />

                <label class="set-field-label">สาขา</label>
                <input class="bank-input" data-bank-field="bankBranch" data-bank-idx="${idx}" value="${escHtml(bank.bankBranch || '')}" placeholder="สาขา" />

                <label class="set-field-label" style="margin-top:8px;color:#0284c7;font-weight:700">📊 รหัสบัญชีระบบบัญชี (COA)</label>
                <input class="bank-input" data-bank-field="coaCode" data-bank-idx="${idx}" value="${escHtml(bank.coaCode || (idx === 0 ? '1130' : ''))}" placeholder="เช่น 1130, 1131, 1132 (ดูจากผังบัญชี)" inputmode="numeric" />
                <div class="sku" style="font-size:11px;color:#64748b;margin-top:-4px">ใช้ตอนลง JV รับเงินโอน → Dr [COA] / Cr 4xxx · ปล่อยว่าง = ใช้ค่าเริ่มต้น (1130)</div>

                <label class="set-field-label" style="margin-top:8px;color:#0284c7;font-weight:700">🏦 กลุ่มลูกค้า (auto-เติมบัญชีรับเงินในใบเสร็จ)</label>
                <select class="bank-input" data-bank-field="customerGroup" data-bank-idx="${idx}">
                  <option value="">— ไม่ผูกกลุ่ม —</option>
                  ${CUSTOMER_GROUPS.map(g => `<option value="${escHtml(g)}" ${bank.customerGroup === g ? 'selected' : ''}>${escHtml(g)}</option>`).join("")}
                </select>
                <div class="sku" style="font-size:11px;color:#64748b;margin-top:-4px">ลูกค้ากลุ่มนี้ → ใบเสร็จเด้งบัญชีนี้ให้อัตโนมัติ (Phase B)</div>

                <label class="set-field-label" style="margin-top:8px">QR Code บัญชีนี้</label>
                ${bank.qrImage
                  ? `<div style="text-align:center;padding:12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
                      <img src="${escHtml(bank.qrImage)}" alt="QR Code บัญชีที่ ${idx+1}" style="max-width:180px;max-height:180px;border-radius:8px" />
                      <div style="margin-top:8px"><button class="btn danger-fill bank-qr-remove" data-qr-bank-idx="${idx}" style="font-size:12px;padding:5px 12px">ลบ QR</button></div>
                    </div>`
                  : `<div style="text-align:center;padding:16px;background:#f8fafc;border-radius:10px;border:2px dashed #cbd5e1">
                      <div style="font-size:28px;margin-bottom:4px">📷</div>
                      <div style="font-size:12px;color:#64748b">ยังไม่มี QR Code</div>
                    </div>`
                }
                <input type="file" class="bank-qr-file" data-qr-bank-idx="${idx}" accept="image/*" style="display:none" />
                <button class="btn light bank-qr-upload" data-qr-bank-idx="${idx}" style="width:100%;margin-top:6px;font-size:13px">${bank.qrImage ? '🔄 เปลี่ยน QR' : '📷 แนบ QR Code'}</button>
              </div>
            </div>
          `}).join("") : '<div class="sku" style="text-align:center;padding:20px">ยังไม่มีบัญชีธนาคาร กด "+ เพิ่มบัญชี" เพื่อเพิ่ม</div>'}
        </div>
      </div>

      <!-- Phase 88.21: VAT Settings -->
      <div class="set-form-card" style="border:2px solid #0284c7;background:#f0f9ff">
        <div class="set-section-title" style="color:#0284c7">📜 ภาษีมูลค่าเพิ่ม (VAT)</div>
        <div class="sku" style="margin-bottom:8px">ตอนนี้ร้านยังไม่เปิด VAT — ให้ปิดไว้ก่อน ระบบจะเริ่มคิด VAT เฉพาะเมื่อเปิดและถึงวันเริ่มใช้งานเท่านั้น</div>
        <div class="stack">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;font-size:14px">
            <input type="checkbox" id="setVatEnabled" ${state.paymentInfo.vatEnabled ? 'checked' : ''} style="width:20px;height:20px;cursor:pointer" />
            <span>✅ เปิดใช้งาน VAT 7%</span>
          </label>

          <div id="vatFieldsBox" style="${state.paymentInfo.vatEnabled ? '' : 'display:none'};padding-top:8px;border-top:1px dashed #93c5fd;margin-top:8px">
            <label class="set-field-label">เลขประจำตัวผู้เสียภาษี (13 หลัก)</label>
            <input id="setVatId" value="${escHtml(state.paymentInfo.vatId || '')}" placeholder="0123456789012" inputmode="numeric" maxlength="13" />

            <label class="set-field-label" style="margin-top:8px">อัตราภาษี (%)</label>
            <input id="setVatRate" type="number" value="${state.paymentInfo.vatRate ?? 7}" min="0" max="20" step="0.5" />

            <label class="set-field-label" style="margin-top:8px">วันเริ่มใช้ VAT</label>
            <input id="setVatEffectiveDate" type="date" value="${escHtml(state.paymentInfo.vatEffectiveDate || ACCOUNTING_EFFECTIVE_DATE)}" />

            <label class="set-field-label" style="margin-top:8px">รูปแบบราคา</label>
            <select id="setVatPriceMode">
              <option value="exclusive" ${state.paymentInfo.vatPriceMode === "exclusive" ? "selected" : ""}>ราคายังไม่รวม VAT (บวก VAT ตอน checkout)</option>
              <option value="inclusive" ${state.paymentInfo.vatPriceMode === "inclusive" ? "selected" : ""}>ราคารวม VAT แล้ว (แยกออกตอน checkout)</option>
            </select>

            <div class="sku" style="font-size:11px;color:#0284c7;margin-top:8px;padding:8px;background:#dbeafe;border-radius:6px">
              💡 <b>ตัวอย่าง:</b> ขายสินค้า ฿100 ที่ VAT 7%<br>
              • <b>Exclusive:</b> ลูกค้าจ่าย ฿107 (สินค้า ฿100 + VAT ฿7)<br>
              • <b>Inclusive:</b> ลูกค้าจ่าย ฿100 (สินค้า ฿93.46 + VAT ฿6.54)
            </div>
          </div>
        </div>
      </div>

      <!-- PromptPay Section -->
      <div class="set-form-card">
        <div class="set-section-title">พร้อมเพย์ / PromptPay</div>
        <div class="stack">
          <label class="set-field-label">เบอร์โทร / เลขบัตรประชาชน</label>
          <input id="setPromptPay" value="${escHtml(state.paymentInfo.promptPay || '')}" placeholder="0812345678 หรือ 1234567890123" />
        </div>
      </div>

      <!-- QR Code Section -->
      <div class="set-form-card">
        <div class="set-section-title">QR Code รับเงิน</div>
        <div class="sku" style="margin-bottom:8px">แนบภาพ QR Code PromptPay / บัญชีธนาคาร เพื่อแสดงให้ลูกค้าสแกนจ่าย</div>
        ${qrPreview}
        <input type="file" id="qrFileInput" accept="image/*" style="display:none" />
        <button id="qrUploadBtn" class="btn light" style="width:100%;margin-top:8px">${state.paymentInfo.qrImage ? '🔄 เปลี่ยน QR Code' : '📷 แนบรูป QR Code'}</button>
      </div>

      <!-- SlipOK API Section — Phase 543 (S14): key ย้ายไป server-side (Cloudflare env) ไม่เก็บใน browser -->
      <div class="set-form-card" style="border:2px solid #f59e0b;background:#fffbeb">
        <div class="set-section-title" style="color:#d97706">🧾 ตรวจสอบสลิปอัตโนมัติ (SlipOK)</div>
        <div class="sku" style="margin-bottom:8px;line-height:1.6">
          ตั้งค่า SlipOK API Key ที่ <b>Cloudflare Pages → Settings → Environment variables</b> (ปลอดภัยกว่าเก็บในเบราว์เซอร์):
          <div style="margin-top:6px;font-family:monospace;font-size:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px">
            SLIPOK_API_KEY = <span style="color:#9a3412">&lt;คีย์จาก slipok.com&gt;</span><br>
            SLIPOK_BRANCH_ID = 0 <span style="color:#92400e">(ค่าเริ่มต้น / ถ้ามีหลายสาขา)</span>
          </div>
          <div style="margin-top:6px;font-size:11px">* ถ้ายังไม่ตั้งค่า ลูกค้ายังแนบสลิปได้ แต่ร้านต้องตรวจสอบเอง · เปลี่ยนค่าแล้วระบบใช้ทันที (ไม่ต้องแก้ในหน้านี้)</div>
        </div>
      </div>

      <button id="savePaymentInfoBtn" class="set-save-btn">บันทึกข้อมูลการเงิน</button>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ★ Phase 88.21: VAT toggle — show/hide fields
  document.getElementById("setVatEnabled")?.addEventListener("change", (e) => {
    const box = document.getElementById("vatFieldsBox");
    if (box) box.style.display = e.target.checked ? "" : "none";
  });

  // ★ Add Bank button
  document.getElementById("addBankBtn")?.addEventListener("click", () => {
    _syncBanksFromDom(el, ctx); // ★ เก็บค่าที่กรอกก่อน re-render
    state.paymentInfo.banks = state.paymentInfo.banks || [];
    state.paymentInfo.banks.push({ bankCode: "", bankName: "", bankAccount: "", bankHolder: "", bankBranch: "" });
    savePaymentInfo();
    renderSettingsPayment(el, ctx, goBack, navigate); // ✅ Re-render with ctx
  });

  // ★ Remove Bank buttons
  el.querySelectorAll("[data-remove-bank]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.removeBank);
      if (await window.App?.confirm?.("ลบบัญชีที่ " + (idx+1) + " ?")) {
        _syncBanksFromDom(el, ctx);
        state.paymentInfo.banks.splice(idx, 1);
        savePaymentInfo();
        showToast("ลบบัญชีแล้ว");
        renderSettingsPayment(el, ctx, goBack, navigate);
      }
    });
  });

  // ★ Bank dropdown → show/hide custom name
  el.querySelectorAll(".bank-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const idx = sel.dataset.bankIdx;
      const customRow = el.querySelector(`[data-custom-row="${idx}"]`);
      if (sel.value === "OTHER") {
        customRow?.classList.remove("hidden");
      } else {
        customRow?.classList.add("hidden");
      }
    });
  });

  // ★ Per-bank QR Code Upload
  el.querySelectorAll(".bank-qr-upload").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.qrBankIdx;
      el.querySelector(`.bank-qr-file[data-qr-bank-idx="${idx}"]`)?.click();
    });
  });
  el.querySelectorAll(".bank-qr-file").forEach(inp => {
    inp.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast("ไฟล์ใหญ่เกิน 2MB"); return; }
      const idx = Number(inp.dataset.qrBankIdx);
      const reader = new FileReader();
      reader.onload = () => {
        _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
        state.paymentInfo.banks[idx].qrImage = reader.result;
        savePaymentInfo();
        showToast("แนบ QR Code บัญชีที่ " + (idx+1) + " แล้ว");
        renderSettingsPayment(el, ctx, goBack, navigate);
      };
      reader.readAsDataURL(file);
    });
  });
  el.querySelectorAll(".bank-qr-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
      const idx = Number(btn.dataset.qrBankIdx);
      state.paymentInfo.banks[idx].qrImage = null;
      savePaymentInfo();
      showToast("ลบ QR Code บัญชีที่ " + (idx+1) + " แล้ว");
      renderSettingsPayment(el, ctx, goBack, navigate);
    });
  });

  // Global QR Upload (PromptPay section)
  const qrFileInput = document.getElementById("qrFileInput");
  document.getElementById("qrUploadBtn")?.addEventListener("click", () => qrFileInput?.click());
  qrFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast("ไฟล์ใหญ่เกิน 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
      state.paymentInfo.qrImage = reader.result;
      savePaymentInfo();
      showToast("แนบ QR Code แล้ว");
      renderSettingsPayment(el, ctx, goBack, navigate);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("removeQrBtn")?.addEventListener("click", () => {
    _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
    state.paymentInfo.qrImage = null;
    savePaymentInfo();
    showToast("ลบ QR Code แล้ว");
    renderSettingsPayment(el, ctx, goBack, navigate);
  });

  // ★ Save Payment — collect all banks from DOM
  document.getElementById("savePaymentInfoBtn")?.addEventListener("click", () => {
    const bankCards = el.querySelectorAll(".pay-bank-card");
    const updatedBanks = [];
    bankCards.forEach(card => {
      const idx = card.dataset.bankIdx;
      const bankCode = card.querySelector(`[data-bank-field="bankCode"][data-bank-idx="${idx}"]`)?.value || "";
      let bankName = "";
      if (bankCode === "OTHER") {
        bankName = card.querySelector(`[data-bank-field="bankNameCustom"][data-bank-idx="${idx}"]`)?.value.trim() || "";
      } else {
        const found = THAI_BANKS.find(b => b.code === bankCode);
        bankName = found ? found.name : "";
      }
      updatedBanks.push({
        bankCode,
        bankName,
        bankAccount: card.querySelector(`[data-bank-field="bankAccount"][data-bank-idx="${idx}"]`)?.value.trim() || "",
        bankHolder: card.querySelector(`[data-bank-field="bankHolder"][data-bank-idx="${idx}"]`)?.value.trim() || "",
        bankBranch: card.querySelector(`[data-bank-field="bankBranch"][data-bank-idx="${idx}"]`)?.value.trim() || "",
        coaCode:    card.querySelector(`[data-bank-field="coaCode"][data-bank-idx="${idx}"]`)?.value.trim() || "",
        customerGroup: card.querySelector(`[data-bank-field="customerGroup"][data-bank-idx="${idx}"]`)?.value || "", // Phase 439
        qrImage: state.paymentInfo.banks[idx]?.qrImage || null
      });
    });

    // ★ Phase 88.21: VAT settings
    const vatEnabled   = !!document.getElementById("setVatEnabled")?.checked;
    const vatId        = (document.getElementById("setVatId")?.value || "").trim();
    const vatRate      = Number(document.getElementById("setVatRate")?.value || 7);
    const vatPriceMode = document.getElementById("setVatPriceMode")?.value || "exclusive";
    const vatEffectiveDate = document.getElementById("setVatEffectiveDate")?.value || ACCOUNTING_EFFECTIVE_DATE;

    state.paymentInfo = {
      ...state.paymentInfo,
      banks: updatedBanks,
      promptPay: document.getElementById("setPromptPay")?.value.trim() || "",
      vatEnabled,
      vatId,
      vatRate,
      vatPriceMode,
      vatEffectiveDate
    };
    savePaymentInfo();

    // ★ Phase 543 (S14): SlipOK key/branch ย้ายไป Cloudflare env แล้ว — ลบ legacy ออกจาก localStorage
    //   (best-effort cleanup; ไม่เก็บ key ในเบราว์เซอร์อีก). ห้ามลบ localStorage key อื่น.
    try {
      localStorage.removeItem("bsk_slipok_key");
      localStorage.removeItem("bsk_slipok_branch");
    } catch (_) { /* ignore */ }

    showToast("บันทึกข้อมูลการเงินแล้ว");
  });
}


// ═══════════════════════════════════════════════════════════
//  USERS SUB-PAGE
// ═══════════════════════════════════════════════════════════
