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
          <div><strong>Version:</strong> 5.5.0</div>
          <div><strong>Release:</strong> April 2026 (build 34)</div>
          <div><strong>Developer:</strong> Boonsook Electronics</div>
          <div><strong>Contact:</strong> gangboo@gmail.com</div>
        </div>

        <!-- ★ App Update Section -->
        <div style="margin-top:20px;padding:14px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
          <div style="font-weight:700;color:#0c4a6e;margin-bottom:6px">🔄 ตรวจหาอัปเดต</div>
          <div style="font-size:12px;color:#075985;margin-bottom:10px">กดเพื่อตรวจหาเวอร์ชันใหม่จาก server (ใช้ตอนเพิ่งแก้ไขแอป)</div>
          <div id="appUpdateStatus" style="font-size:12px;color:#475569;margin-bottom:8px">พร้อมตรวจ — กดปุ่มด้านล่าง</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="appCheckUpdateBtn" class="btn primary" style="font-size:13px;padding:8px 14px">🔄 ตรวจหาอัปเดต</button>
            <button id="appForceReloadBtn" class="btn light" style="font-size:13px;padding:8px 14px" title="บังคับโหลดใหม่ — ล้าง cache + reload">⚡ โหลดใหม่ทันที (Hard Refresh)</button>
            <button id="appClearCacheBtn" class="btn" style="font-size:13px;padding:8px 14px;background:#dc2626;color:#fff;border:none" title="ลบ cache ทั้งหมด + reload — ใช้ตอนอัปเดตไม่ได้">🚀 บังคับอัปเดต (ล้าง Cache + รีโหลด)</button>
          </div>
          <div style="margin-top:10px;padding:10px;background:#fef3c7;border-radius:8px;font-size:11px;color:#92400e;line-height:1.6">
            <b>📱 บนมือถือ ถ้าอัปเดตไม่ได้:</b><br>
            1. กดปุ่ม <b>"🚀 บังคับอัปเดต"</b> สีแดง (วิธีที่ดีที่สุด)<br>
            2. ถ้ายังไม่ได้ — ปิดแอป (swipe ทิ้ง) → เปิดใหม่<br>
            3. ถ้าติดตั้งเป็น PWA (icon บน home) → ลบ icon → เข้าผ่าน browser → กดติดตั้งใหม่<br>
            4. iPhone Safari: Settings → Safari → Clear History
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById("setBackBtn")?.addEventListener("click", goBack);

  // ★ Update buttons
  const statusEl = document.getElementById("appUpdateStatus");
  const setStatus = (msg, color) => { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || "#475569"; } };

  document.getElementById("appCheckUpdateBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("appCheckUpdateBtn");
    btn.disabled = true; btn.textContent = "⏳ กำลังตรวจ...";
    setStatus("กำลังถาม server หาเวอร์ชันใหม่...", "#0284c7");
    try {
      if (!('serviceWorker' in navigator)) {
        setStatus("⚠️ Browser ไม่รองรับ Service Worker", "#dc2626");
        return;
      }
      // ★ Step 1: บังคับโหลด sw.js ใหม่จาก network (bypass HTTP cache)
      try {
        await fetch('./sw.js?bust=' + Date.now(), { cache: 'no-store' });
      } catch(e) { /* ignore — main update() ก็จะลองอีก */ }

      // ★ Step 2: บังคับโหลด index.html (เพื่อให้ ?v= ใหม่ของ main.js โผล่)
      try {
        await fetch('./index.html?bust=' + Date.now(), { cache: 'no-store' });
      } catch(e) {}

      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { setStatus("⚠️ ไม่พบ Service Worker — ลอง 'ล้าง Cache'", "#dc2626"); return; }

      // ★ Step 3: ให้ SW ตรวจอัปเดต
      await reg.update();
      // รอสักครู่ให้ updatefound trigger
      await new Promise(r => setTimeout(r, 2000));

      if (reg.waiting) {
        setStatus("✅ มีเวอร์ชันใหม่! กำลัง apply + reload...", "#059669");
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => window.location.reload(), 800);
      } else if (reg.installing) {
        setStatus("⏳ กำลังดาวน์โหลด... รอ 5 วินาทีแล้วกดปุ่มอีกครั้ง", "#f59e0b");
      } else {
        setStatus("✓ คุณใช้เวอร์ชันล่าสุดแล้ว — ไม่มีอัปเดตใหม่", "#059669");
      }
    } catch (e) {
      setStatus("❌ ผิดพลาด: " + (e?.message || e) + " — ลอง 'ล้าง Cache' แทน", "#dc2626");
    } finally {
      btn.disabled = false; btn.textContent = "🔄 ตรวจหาอัปเดต";
    }
  });

  document.getElementById("appForceReloadBtn")?.addEventListener("click", () => {
    setStatus("⚡ กำลังโหลดใหม่...", "#0284c7");
    // bypass cache
    if (window.location.reload.length > 0) {
      try { window.location.reload(true); } catch(e) { window.location.reload(); }
    } else {
      window.location.reload();
    }
  });

  document.getElementById("appClearCacheBtn")?.addEventListener("click", async () => {
    if (!confirm("ล้าง cache ทั้งหมด + reload? (จะใช้เวลาโหลดใหม่ครั้งแรกนานขึ้น)")) return;
    const btn = document.getElementById("appClearCacheBtn");
    btn.disabled = true; btn.textContent = "⏳ กำลังล้าง...";
    setStatus("🗑️ กำลังล้าง cache...", "#0284c7");
    try {
      // 1. unregister all SW
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
      // 2. delete all caches
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
      setStatus("✅ ล้างเสร็จ — กำลัง reload...", "#059669");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setStatus("❌ ผิดพลาด: " + (e?.message || e), "#dc2626");
      btn.disabled = false; btn.textContent = "🗑️ ล้าง Cache";
    }
  });
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

  resetBtn?.addEventListener('click', async () => {
    if (!(await window.App?.confirm?.('ใช้โลโก้เริ่มต้น (logo.svg) ใช่หรือไม่?'))) return;
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
