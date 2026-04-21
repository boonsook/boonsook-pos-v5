// ═══════════════════════════════════════════════════════════
//  settings/pages.js — Minor Settings Pages
//  (About, Document Settings, LINE Notify, Logo, Product Settings)
// ═══════════════════════════════════════════════════════════

import { escHtml } from './utils.js';

/**
 * Render About page
 */
export function renderSettingsAbout(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">เกี่ยวกับระบบ</h3>
      </div>
      <div class="set-form-card">
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:32px;margin-bottom:4px">🏪</div>
          <div style="font-size:18px;font-weight:900;color:#0f172a">Boonsook POS V5 PRO</div>
          <div style="font-size:12px;color:#64748b">ระบบจัดการร้านค้าอิเล็กทรอนิกส์แบบครบวงจร</div>
        </div>
        <div style="display:grid;gap:6px;font-size:13px;color:#334155">
          <div><strong>Version:</strong> 5.0.0</div>
          <div><strong>Release:</strong> April 2026</div>
          <div><strong>Developer:</strong> Boonsook Electronics</div>
          <div><strong>Contact:</strong> gangboo@gmail.com</div>
        </div>
      </div>
    </div>
  `;
  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
}

/**
 * Render Document Settings page (header / footer / note for receipts & quotations)
 */
export function renderSettingsDocument(el, ctx, goBack) {
  const { state, showToast, saveStoreInfo } = ctx || {};
  const info = state?.storeInfo || {};
  const docHeader = info.docHeader || '';
  const docFooter = info.docFooter || 'ขอบพระคุณที่ใช้บริการครับ 🙏';
  const docNote   = info.docNote   || '';

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">เทมเพลตเอกสาร</h3>
      </div>
      <div class="set-form-card">
        <div class="sku" style="margin-bottom:12px">ข้อความเหล่านี้จะแสดงในใบเสร็จ / ใบเสนอราคา / ใบส่งของ</div>
        <div class="stack">
          <label class="set-field-label">ส่วนหัวเอกสาร (เช่น สโลแกนร้าน)</label>
          <textarea id="docHeaderInput" class="bank-input" rows="2" placeholder="ตัวอย่าง: ยินดีให้บริการทุกท่าน">${escHtml(docHeader)}</textarea>

          <label class="set-field-label" style="margin-top:10px">ส่วนท้ายเอกสาร</label>
          <textarea id="docFooterInput" class="bank-input" rows="2" placeholder="ตัวอย่าง: ขอบพระคุณที่ใช้บริการครับ">${escHtml(docFooter)}</textarea>

          <label class="set-field-label" style="margin-top:10px">หมายเหตุเอกสาร</label>
          <textarea id="docNoteInput" class="bank-input" rows="2" placeholder="ตัวอย่าง: สินค้ารับประกัน 1 ปี">${escHtml(docNote)}</textarea>
        </div>
      </div>
      <button id="saveDocSettingsBtn" class="set-save-btn">บันทึกเทมเพลตเอกสาร</button>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
  document.getElementById("saveDocSettingsBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("saveDocSettingsBtn");
    if (!btn) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ กำลังบันทึก...';

    try {
      const merged = {
        ...(state?.storeInfo || {}),
        docHeader: document.getElementById("docHeaderInput")?.value?.trim() || '',
        docFooter: document.getElementById("docFooterInput")?.value?.trim() || '',
        docNote:   document.getElementById("docNoteInput")?.value?.trim()   || ''
      };
      if (state) state.storeInfo = merged;

      if (typeof saveStoreInfo === 'function') {
        await saveStoreInfo(merged);
      } else {
        localStorage.setItem('bsk_store_info', JSON.stringify(merged));
      }
      showToast?.('บันทึกเทมเพลตเอกสารแล้ว ✅');
    } catch (err) {
      showToast?.(`บันทึกผิดพลาด: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
}

/**
 * Render LINE Notify page — delegate to the real implementation in modules/line_notify.js
 */
export function renderSettingsLineNotify(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">💬 LINE Notify</h3>
      </div>
      <div id="lineNotifyContainer"></div>
    </div>
  `;
  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  const container = document.getElementById("lineNotifyContainer");
  if (ctx?.renderLineNotifySettings && container) {
    try {
      ctx.renderLineNotifySettings(ctx, container);
    } catch (err) {
      container.innerHTML = `<div class="set-form-card" style="border:2px solid #ef4444;background:#fef2f2">
        <div style="color:#b91c1c;font-weight:700">โหลด LINE Notify UI ไม่สำเร็จ</div>
        <div class="sku">${escHtml(err.message || String(err))}</div>
      </div>`;
    }
  } else if (container) {
    container.innerHTML = `<div class="set-form-card">
      <div class="sku">ยังไม่ได้เชื่อมต่อ LINE Notify (ตรวจสอบ ENV บน Cloudflare: LINE_CHANNEL_ACCESS_TOKEN + LINE_USER_ID)</div>
    </div>`;
  }
}

/**
 * Render Logo page
 */
export function renderSettingsLogoPage(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">โลโก้ร้าน</h3>
      </div>
      <div class="set-form-card">
        <div class="logo-preview" style="margin-bottom:20px;text-align:center">
          <img src="${localStorage.getItem('bsk_store_logo') || './logo.svg'}" alt="Logo" style="max-width:150px;height:auto;border-radius:12px;background:#fff;padding:8px" />
        </div>
        <input type="file" id="logoFileInput" class="bank-input" accept="image/*" />
        <button id="logoUploadBtn" class="btn primary" style="width:100%;margin-top:10px">อัพโหลด</button>
        <button id="logoResetBtn" class="btn" style="width:100%;margin-top:6px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0">🔄 ใช้โลโก้เริ่มต้น</button>
      </div>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  const fileInput = document.getElementById('logoFileInput');
  const uploadBtn = document.getElementById('logoUploadBtn');
  const resetBtn  = document.getElementById('logoResetBtn');

  uploadBtn?.addEventListener('click', async () => {
    if (!fileInput?.files?.length) {
      ctx?.showToast?.('เลือกไฟล์ภาพก่อนครับ', 'warning');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳ กำลังอัพโหลด...';

    try {
      const file = fileInput.files[0];
      const fileName = `store-logo-${Date.now()}.${file.name.split('.').pop()}`;

      const { error: uploadErr } = await ctx?.state?.supabase?.storage
        .from('store-assets')
        .upload(fileName, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data } = ctx?.state?.supabase?.storage
        .from('store-assets')
        .getPublicUrl(fileName);

      if (data?.publicUrl) {
        localStorage.setItem('bsk_store_logo', data.publicUrl);
        ctx?.showToast?.('อัพโหลดโลโก้สำเร็จ ✅', 'success');
        const preview = document.querySelector('.logo-preview img');
        if (preview) preview.src = data.publicUrl;
        fileInput.value = '';
      }
    } catch (err) {
      ctx?.showToast?.(`อัพโหลดผิดพลาด: ${err.message}`, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'อัพโหลด';
    }
  });

  resetBtn?.addEventListener('click', () => {
    if (!confirm('ใช้โลโก้เริ่มต้น (logo.svg) ใช่หรือไม่?')) return;
    localStorage.removeItem('bsk_store_logo');
    const preview = document.querySelector('.logo-preview img');
    if (preview) preview.src = './logo.svg';
    ctx?.showToast?.('รีเซ็ตโลโก้แล้ว');
  });
}

/**
 * Render Product Settings page
 */
export function renderProductSettings(el, ctx, goBack) {
  const { state, showToast, saveStoreInfo } = ctx || {};
  const info = state?.storeInfo || {};
  const productDecimals = Number.isFinite(info.productDecimals) ? info.productDecimals : 2;
  const showCost        = !!info.showCost;
  const lowStockThreshold = Number.isFinite(info.lowStockThreshold) ? info.lowStockThreshold : 5;

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ตั้งค่าสินค้า</h3>
      </div>
      <div class="set-form-card">
        <div class="stack">
          <label class="set-field-label">จำนวนทศนิยม (Decimal) สำหรับราคา</label>
          <input id="productDecimalsInput" type="number" min="0" max="4" class="bank-input" value="${productDecimals}" />

          <label class="set-field-label" style="margin-top:10px">แจ้งเตือนสต็อกต่ำเมื่อน้อยกว่า</label>
          <input id="lowStockInput" type="number" min="0" class="bank-input" value="${lowStockThreshold}" />

          <label class="form-checkbox" style="margin-top:12px;display:flex;align-items:center;gap:8px">
            <input id="showCostInput" type="checkbox" ${showCost ? 'checked' : ''} />
            <span>แสดงราคาต้นทุนในหน้าสินค้า</span>
          </label>
        </div>
      </div>
      <button id="saveProductSettingsBtn" class="set-save-btn">บันทึกการตั้งค่าสินค้า</button>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
  document.getElementById("saveProductSettingsBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("saveProductSettingsBtn");
    if (!btn) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ กำลังบันทึก...';

    try {
      const decVal = Number(document.getElementById("productDecimalsInput")?.value);
      const lowVal = Number(document.getElementById("lowStockInput")?.value);
      const merged = {
        ...(state?.storeInfo || {}),
        productDecimals: Number.isFinite(decVal) ? Math.max(0, Math.min(4, Math.floor(decVal))) : 2,
        lowStockThreshold: Number.isFinite(lowVal) ? Math.max(0, Math.floor(lowVal)) : 5,
        showCost: !!document.getElementById("showCostInput")?.checked
      };
      if (state) state.storeInfo = merged;

      if (typeof saveStoreInfo === 'function') {
        await saveStoreInfo(merged);
      } else {
        localStorage.setItem('bsk_store_info', JSON.stringify(merged));
      }
      showToast?.('บันทึกการตั้งค่าสินค้าแล้ว ✅');
    } catch (err) {
      showToast?.(`บันทึกผิดพลาด: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
}
