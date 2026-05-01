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
          <div><strong>Version:</strong> 5.18.0</div>
          <div><strong>Release:</strong> May 2026 (build 90)</div>
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

  // ─────────────────────────────────────────────────────────────
  // Phase 20 — Fix Update Button (CRITICAL)
  // ปัญหาเดิม: ปุ่มกดแล้วเงียบ / location.reload() โดน cache เสมอ
  // ─────────────────────────────────────────────────────────────

  // helper: hard reload — bypass HTTP cache + cache-bust query
  function hardReload() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("_t", String(Date.now()));
      window.location.replace(u.toString());
    } catch(e) {
      window.location.href = window.location.pathname + "?_t=" + Date.now();
    }
  }

  // helper: full nuke — unregister SW + delete caches + clear sw state
  async function nukeEverything(progress) {
    progress?.("🗑️ กำลังลบ Service Worker...");
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); } catch(e) { console.warn("unregister fail", e); }
        }
      } catch(e) { console.warn("getRegistrations fail", e); }
    }

    progress?.("🗑️ กำลังลบ cache ทั้งหมด...");
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          try { await caches.delete(k); } catch(e) { console.warn("cache delete fail", e); }
        }
      } catch(e) { console.warn("caches.keys fail", e); }
    }

    // Clear ONLY app-update related localStorage flags (เก็บ token/settings ไว้)
    progress?.("🗑️ กำลัง reset update flags...");
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("sw-") || k.startsWith("update-") || k.startsWith("cache-"))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch(e) { console.warn("localStorage clear fail", e); }
  }

  document.getElementById("appCheckUpdateBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("appCheckUpdateBtn");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "⏳ กำลังตรวจ...";
    setStatus("📡 กำลังถาม server หาเวอร์ชันใหม่...", "#0284c7");
    try {
      if (!('serviceWorker' in navigator)) {
        setStatus("⚠️ Browser ไม่รองรับ Service Worker — กดปุ่มสีแดง 'บังคับอัปเดต' แทน", "#dc2626");
        return;
      }

      // Step 1: ดึง index.html ใหม่จาก network (no-store) — เช็คว่า build ใหม่กว่ามั้ย
      let newBuild = null, currentBuild = null;
      try {
        currentBuild = document.querySelector('script[src*="main.js"]')?.src.match(/v=(\d+)/)?.[1] || null;
        const r = await fetch('./index.html?_=' + Date.now(), { cache: 'no-store' });
        const html = await r.text();
        newBuild = html.match(/main\.js\?v=(\d+)/)?.[1] || null;
      } catch(e) { console.warn("fetch index fail", e); }

      // Step 2: สั่ง SW ตรวจอัปเดต
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        try { await reg.update(); } catch(e) { console.warn("reg.update fail", e); }
        await new Promise(r => setTimeout(r, 1500));
      }

      // Step 3: ตัดสินใจ
      // Phase 43.3 fix: ใช้ Number(...) > เปรียบเทียบจริง (เดิม !== false alarm เมื่อ build เท่ากัน + SW waiting)
      const hasNewBuild = !!(newBuild && currentBuild && Number(newBuild) > Number(currentBuild));
      const hasWaiting = !!reg?.waiting;
      const hasInstalling = !!reg?.installing;

      if (hasNewBuild) {
        // Build ใหม่กว่าจริง → upgrade flow
        setStatus(`✅ พบเวอร์ชันใหม่ (build ${newBuild} ← ปัจจุบัน build ${currentBuild}) — กำลัง apply + reload...`, "#059669");
        if (hasWaiting) {
          try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch(e){}
        }
        await new Promise(r => setTimeout(r, 800));
        hardReload();
      } else if (hasWaiting) {
        // SW waiting แต่ build เท่าเดิม — apply เงียบๆ ไม่ต้องบอกว่ามี version ใหม่
        setStatus("🔄 กำลัง apply Service Worker ใหม่...", "#0284c7");
        try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch(e){}
        await new Promise(r => setTimeout(r, 800));
        hardReload();
      } else if (hasInstalling) {
        setStatus("⏳ กำลังดาวน์โหลดเวอร์ชันใหม่... รอ 5 วินาทีแล้วกดอีกครั้ง", "#f59e0b");
      } else {
        setStatus(`✓ คุณใช้เวอร์ชันล่าสุดแล้ว (build ${currentBuild || '?'}) — ไม่มีอัปเดตใหม่`, "#059669");
      }
    } catch (e) {
      setStatus("❌ ผิดพลาด: " + (e?.message || e) + " — กดปุ่มสีแดง 'บังคับอัปเดต' แทน", "#dc2626");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  document.getElementById("appForceReloadBtn")?.addEventListener("click", () => {
    setStatus("⚡ กำลังโหลดใหม่ (bypass cache)...", "#0284c7");
    setTimeout(hardReload, 300);
  });

  document.getElementById("appClearCacheBtn")?.addEventListener("click", async () => {
    if (!confirm("ล้าง cache + Service Worker ทั้งหมด + reload?\n\n(โหลดใหม่ครั้งแรกจะนานขึ้น แต่จะได้เวอร์ชันล่าสุดแน่นอน)")) return;
    const btn = document.getElementById("appClearCacheBtn");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "⏳ กำลังล้าง...";
    try {
      await nukeEverything(setStatus);
      setStatus("✅ ล้างหมดแล้ว — กำลัง reload เวอร์ชันใหม่...", "#059669");
      await new Promise(r => setTimeout(r, 800));
      hardReload();
    } catch (e) {
      setStatus("❌ ผิดพลาด: " + (e?.message || e), "#dc2626");
      btn.disabled = false; btn.textContent = orig;
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
 * Phase 36: sync logo URL เข้า storeInfo.logoUrl (Supabase) — ไม่ใช่แค่ localStorage
 *           → ทุก device login แล้วเห็น logo เดียวกันอัตโนมัติ
 */
export function renderSettingsLogoPage(el, ctx, goBack) {
  // อ่าน logo URL จาก storeInfo (ถ้า login แล้ว) > localStorage > default
  const currentLogo = ctx?.state?.storeInfo?.logoUrl
    || localStorage.getItem('bsk_store_logo')
    || './icons/logo.svg';

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">โลโก้ร้าน</h3>
      </div>
      <div class="set-form-card">
        <div class="logo-preview" style="margin-bottom:20px;text-align:center">
          <img src="${escHtml(currentLogo)}" alt="Logo" style="max-width:150px;height:auto;border-radius:12px;background:#fff;padding:8px" onerror="this.src='./icons/logo.svg'" />
        </div>
        <input type="file" id="logoFileInput" class="bank-input" accept="image/*" />
        <button id="logoUploadBtn" class="btn primary" style="width:100%;margin-top:10px">อัพโหลด</button>
        <button id="logoResetBtn" class="btn" style="width:100%;margin-top:6px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0">🔄 ใช้โลโก้เริ่มต้น</button>
        <div style="margin-top:10px;padding:10px;background:#ecfeff;border-radius:8px;border:1px solid #bae6fd;font-size:11px;color:#0c4a6e;line-height:1.5">
          💾 <b>Phase 36:</b> โลโก้ sync เข้าฐานข้อมูล — ทุก device + browser ที่ login เข้ามาจะเห็น logo เดียวกันโดยอัตโนมัติ ไม่ต้องอัพโหลดซ้ำ
        </div>
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
      // ใช้ชื่อคงที่ "logo.<ext>" + upsert → ทับของเก่าเสมอ → URL คงที่ (ไม่กิน storage เปล่าๆ)
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `logo.${ext}`;

      const { error: uploadErr } = await ctx?.state?.supabase?.storage
        .from('store-assets')
        .upload(fileName, file, { upsert: true, cacheControl: '60' });

      if (uploadErr) throw uploadErr;

      const { data } = ctx?.state?.supabase?.storage
        .from('store-assets')
        .getPublicUrl(fileName);

      if (data?.publicUrl) {
        // เพิ่ม cache-bust query เผื่อ Cloudflare/Browser cache
        const urlWithBust = data.publicUrl + '?t=' + Date.now();

        // ★ Sync 3 ที่: storeInfo (DB) + localStorage + state
        if (ctx?.state) {
          ctx.state.storeInfo = ctx.state.storeInfo || {};
          ctx.state.storeInfo.logoUrl = urlWithBust;
        }
        localStorage.setItem('bsk_store_logo', urlWithBust);
        // เรียก saveStoreInfo() → upsert เข้า Supabase app_settings.store_info
        try { await ctx?.saveStoreInfo?.(); } catch(e) { console.warn('saveStoreInfo fail:', e); }

        ctx?.showToast?.('อัพโหลดโลโก้สำเร็จ ✅ (sync เข้า DB แล้ว)', 'success');
        const preview = document.querySelector('.logo-preview img');
        if (preview) preview.src = urlWithBust;
        fileInput.value = '';

        // อัปเดต logo ใน sidebar/auth/favicon ทุกจุด
        try { window.updateAppLogos?.(); } catch(e){}
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
    // ★ Reset 3 ที่
    if (ctx?.state?.storeInfo) {
      delete ctx.state.storeInfo.logoUrl;
    }
    localStorage.removeItem('bsk_store_logo');
    localStorage.removeItem('bsk_store_logo_url');
    try { await ctx?.saveStoreInfo?.(); } catch(e) {}

    const preview = document.querySelector('.logo-preview img');
    if (preview) preview.src = './icons/logo.svg';
    try { window.updateAppLogos?.(); } catch(e){}
    ctx?.showToast?.('รีเซ็ตโลโก้แล้ว (sync เข้า DB)');
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
