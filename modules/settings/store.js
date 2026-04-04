// ═══════════════════════════════════════════════════════════
//  settings/store.js — Store Information Settings
// ═══════════════════════════════════════════════════════════

import { escHtml } from './utils.js';

/**
 * Render Store Info page
 * Extract from: renderStoreInfo() function lines 166-211
 */
export function renderSettingsStore(el, ctx, goBack, navigate) {
  const { state, showToast, saveStoreInfo } = ctx;
  const storeInfo = state.storeInfo || {};

  el.innerHTML = `
    <div class="set-header">
      <button class="set-back" onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))">← ย้อนกลับ</button>
      <h2>ข้อมูลร้านค้า</h2>
    </div>
    <div class="set-content">
      <div class="form-group">
        <label class="form-label">ชื่อร้าน</label>
        <input type="text" id="storeName" class="form-input" value="${escHtml(storeInfo.name || '')}" placeholder="บุญสุข อิเล็กทรอนิกส์" />
      </div>
      
      <div class="form-group">
        <label class="form-label">เบอร์โทรศัพท์</label>
        <input type="tel" id="storePhone" class="form-input" value="${escHtml(storeInfo.phone || '')}" placeholder="044-513-XX" />
      </div>
      
      <div class="form-group">
        <label class="form-label">อีเมล</label>
        <input type="email" id="storeEmail" class="form-input" value="${escHtml(storeInfo.email || '')}" placeholder="info@boonsuk.com" />
      </div>
      
      <div class="form-group">
        <label class="form-label">ที่อยู่</label>
        <textarea id="storeAddress" class="form-input" rows="4" placeholder="เลขที่ 123 ตำบล ศีขรภูมิ อำเภอ ศีขรภูมิ จังหวัด สุรินทร์">${escHtml(storeInfo.address || '')}</textarea>
      </div>

      <div style="display:flex;gap:10px">
        <button id="saveStoreBtn" class="btn btn-primary" style="flex:1">บันทึก</button>
        <button class="btn btn-secondary" style="flex:1" onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))">ยกเลิก</button>
      </div>
    </div>
  `;

  // Event listeners
  document.getElementById('saveStoreBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ กำลังบันทึก...';

    const data = {
      name: document.getElementById('storeName')?.value?.trim() || '',
      phone: document.getElementById('storePhone')?.value?.trim() || '',
      email: document.getElementById('storeEmail')?.value?.trim() || '',
      address: document.getElementById('storeAddress')?.value?.trim() || ''
    };
    
    // ✅ Quick localStorage save
    if (typeof saveStoreInfo === 'function') {
      try {
        await saveStoreInfo(data);
      } catch (err) {
        // save error (localStorage still OK)
      }
      
      // ✅ Show success immediately (no re-render)
      showToast?.('บันทึกข้อมูลร้านค้าสำเร็จ ✅', 'success');
      btn.disabled = false;
      btn.textContent = originalText;
    } else {
      showToast?.('ระบบยังพร้อม โปรดลองใหม่', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}
