import { escHtml, THAI_BANKS } from "./utils.js";

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

      <!-- SlipOK API Section -->
      <div class="set-form-card" style="border:2px solid #f59e0b;background:#fffbeb">
        <div class="set-section-title" style="color:#d97706">🧾 ตรวจสอบสลิปอัตโนมัติ (SlipOK)</div>
        <div class="sku" style="margin-bottom:8px">ใส่ API Key จาก <a href="https://slipok.com" target="_blank" style="color:#0284c7">slipok.com</a> เพื่อตรวจสอบสลิปลูกค้าอัตโนมัติ (จริง/ปลอม/ยอดตรง)</div>
        <div class="stack">
          <label class="set-field-label">SlipOK API Key</label>
          <input id="setSlipOkKey" type="password" value="${escHtml(localStorage.getItem('bsk_slipok_key') || '')}" placeholder="SLIPOK-xxxxxxxx" />
          <label class="set-field-label" style="margin-top:8px">Branch ID (ถ้ามี)</label>
          <input id="setSlipOkBranch" value="${escHtml(localStorage.getItem('bsk_slipok_branch') || '')}" placeholder="0 (ค่าเริ่มต้น)" />
          <div class="sku" style="margin-top:4px;font-size:11px">* ถ้าไม่มี API Key ลูกค้ายังแนบสลิปได้ แต่ร้านต้องตรวจสอบเอง</div>
        </div>
      </div>

      <button id="savePaymentInfoBtn" class="set-save-btn">บันทึกข้อมูลการเงิน</button>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ★ Add Bank button
  document.getElementById("addBankBtn")?.addEventListener("click", async () => {
    _syncBanksFromDom(el, ctx); // ★ เก็บค่าที่กรอกก่อน re-render
    state.paymentInfo.banks = state.paymentInfo.banks || [];
    state.paymentInfo.banks.push({ bankCode: "", bankName: "", bankAccount: "", bankHolder: "", bankBranch: "" });
    await savePaymentInfo();
    renderSettingsPayment(el, ctx, goBack, navigate); // ✅ Re-render with ctx
  });

  // ★ Remove Bank buttons
  el.querySelectorAll("[data-remove-bank]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.removeBank);
      if (confirm("ลบบัญชีที่ " + (idx+1) + " ?")) {
        _syncBanksFromDom(el, ctx);
        state.paymentInfo.banks.splice(idx, 1);
        await savePaymentInfo();
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
    inp.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { showToast("ไฟล์ใหญ่เกิน 3MB"); return; }
      const idx = Number(inp.dataset.qrBankIdx);
      showToast("กำลังอัปโหลด QR Code...");
      try {
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `qr-bank-${idx}.${ext}`;
        const { error: upErr } = await state.supabase.storage
          .from("store-assets")
          .upload(fileName, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = state.supabase.storage
          .from("store-assets")
          .getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl + "?t=" + Date.now();
        _syncBanksFromDom(el, ctx);
        state.paymentInfo.banks[idx].qrImage = publicUrl;
        await savePaymentInfo();
        showToast("✅ อัปโหลด QR Code บัญชีที่ " + (idx+1) + " แล้ว");
        renderSettingsPayment(el, ctx, goBack, navigate);
      } catch (err) {
        showToast("อัปโหลดไม่สำเร็จ: " + (err.message || err));
      }
      e.target.value = "";
    });
  });
  el.querySelectorAll(".bank-qr-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
      const idx = Number(btn.dataset.qrBankIdx);
      state.paymentInfo.banks[idx].qrImage = null;
      await savePaymentInfo();
      showToast("ลบ QR Code บัญชีที่ " + (idx+1) + " แล้ว");
      renderSettingsPayment(el, ctx, goBack, navigate);
    });
  });

  // Global QR Upload (PromptPay section)
  const qrFileInput = document.getElementById("qrFileInput");
  document.getElementById("qrUploadBtn")?.addEventListener("click", () => qrFileInput?.click());
  qrFileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast("ไฟล์ใหญ่เกิน 3MB"); return; }
    showToast("กำลังอัปโหลด QR Code...");
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `qr-global.${ext}`;
      const { error: upErr } = await state.supabase.storage
        .from("store-assets")
        .upload(fileName, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = state.supabase.storage
        .from("store-assets")
        .getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl + "?t=" + Date.now();
      _syncBanksFromDom(el, ctx);
      state.paymentInfo.qrImage = publicUrl;
      await savePaymentInfo();
      showToast("✅ อัปโหลด QR Code สำเร็จ");
      renderSettingsPayment(el, ctx, goBack, navigate);
    } catch (err) {
      showToast("อัปโหลดไม่สำเร็จ: " + (err.message || err));
    }
    e.target.value = "";
  });

  document.getElementById("removeQrBtn")?.addEventListener("click", async () => {
    _syncBanksFromDom(el, ctx); // ★ เก็บค่าก่อน re-render
    state.paymentInfo.qrImage = null;
    await savePaymentInfo();
    showToast("ลบ QR Code แล้ว");
    renderSettingsPayment(el, ctx, goBack, navigate);
  });

  // ★ Save Payment — collect all banks from DOM
  document.getElementById("savePaymentInfoBtn")?.addEventListener("click", async () => {
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
        qrImage: state.paymentInfo.banks[idx]?.qrImage || null
      });
    });

    state.paymentInfo = {
      ...state.paymentInfo,
      banks: updatedBanks,
      promptPay: document.getElementById("setPromptPay")?.value.trim() || ""
    };
    await savePaymentInfo();

    // ★ บันทึก SlipOK API Key
    const slipKey = (document.getElementById("setSlipOkKey")?.value || "").trim();
    const slipBranch = (document.getElementById("setSlipOkBranch")?.value || "").trim();
    if (slipKey) localStorage.setItem("bsk_slipok_key", slipKey);
    else localStorage.removeItem("bsk_slipok_key");
    if (slipBranch) localStorage.setItem("bsk_slipok_branch", slipBranch);
    else localStorage.removeItem("bsk_slipok_branch");

    showToast("บันทึกข้อมูลการเงินแล้ว");
  });
}


// ═══════════════════════════════════════════════════════════
//  USERS SUB-PAGE
// ═══════════════════════════════════════════════════════════
