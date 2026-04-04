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
    <div class="set-header">
      <button onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))" class="set-back">← ย้อนกลับ</button>
      <h2>เกี่ยวกับระบบ</h2>
    </div>
    <div class="set-content">
      <div class="panel">
        <h3>Boonsook POS V5 PRO</h3>
        <p>ระบบจัดการร้านค้าอิเล็กทรอนิกส์แบบครบวงจร</p>
        <p><strong>Version:</strong> 5.0.0</p>
        <p><strong>Release:</strong> March 2025</p>
        <p><strong>Developer:</strong> Boonsook Electronics</p>
      </div>
    </div>
  `;
}

/**
 * Render Document Settings page
 */
export function renderSettingsDocument(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-header">
      <button onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))" class="set-back">← ย้อนกลับ</button>
      <h2>เทมเพลตเอกสาร</h2>
    </div>
    <div class="set-content">
      <div class="form-group">
        <label class="form-label">ส่วนหัวเอกสาร</label>
        <textarea class="form-input" rows="3" placeholder="ข้อความส่วนหัว"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">ส่วนท้ายเอกสาร</label>
        <textarea class="form-input" rows="3" placeholder="ข้อความส่วนท้าย"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">หมายเหตุเอกสาร</label>
        <textarea class="form-input" rows="2" placeholder="หมายเหตุ"></textarea>
      </div>
      <button class="btn btn-primary" style="width:100%">บันทึก</button>
    </div>
  `;
}

/**
 * Render LINE Notify page
 */
export function renderSettingsLineNotify(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-header">
      <button onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))" class="set-back">← ย้อนกลับ</button>
      <h2>LINE Notify</h2>
    </div>
    <div class="set-content">
      <div class="form-group">
        <label class="form-label">LINE Notify Access Token</label>
        <input type="password" class="form-input" placeholder="กรอก Access Token" />
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" />
          <span>แจ้งเตือนเมื่อมีออเดอร์ใหม่</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" />
          <span>แจ้งเตือนเมื่องานเสร็จ</span>
        </label>
      </div>
      <button class="btn btn-primary" style="width:100%">บันทึก</button>
    </div>
  `;
}

/**
 * Render Logo page
 */
export function renderSettingsLogoPage(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-header">
      <button onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))" class="set-back">← ย้อนกลับ</button>
      <h2>โลโก้ร้าน</h2>
    </div>
    <div class="set-content">
      <div class="logo-preview" style="margin-bottom:20px;text-align:center">
        <img src="${localStorage.getItem('bsk_store_logo') || './logo.svg'}" alt="Logo" style="max-width:150px;height:auto" />
      </div>
      <input type="file" id="logoFileInput" class="form-input" accept="image/*" />
      <button id="logoUploadBtn" class="btn btn-primary" style="width:100%;margin-top:10px">อัพโหลด</button>
    </div>
  `;
  
  // ✅ Setup event listeners for upload
  const fileInput = document.getElementById('logoFileInput');
  const uploadBtn = document.getElementById('logoUploadBtn');
  
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
      
      // Upload to Supabase Storage
      const { error: uploadErr } = await ctx?.state?.supabase?.storage
        .from('store-assets')
        .upload(fileName, file, { upsert: true });
      
      if (uploadErr) throw uploadErr;
      
      // Get public URL
      const { data } = ctx?.state?.supabase?.storage
        .from('store-assets')
        .getPublicUrl(fileName);
      
      if (data?.publicUrl) {
        localStorage.setItem('bsk_store_logo', data.publicUrl);
        ctx?.showToast?.('อัพโหลดโลโก้สำเร็จ ✅', 'success');
        
        // Refresh preview
        document.querySelector('.logo-preview img').src = data.publicUrl;
        fileInput.value = '';
      }
    } catch (err) {
      ctx?.showToast?.(`อัพโหลดผิดพลาด: ${err.message}`, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'อัพโหลด';
    }
  });
}

/**
 * Render Product Settings page
 */
export function renderProductSettings(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-header">
      <button onclick="document.dispatchEvent(new CustomEvent('navigate-settings', {detail: 'main'}))" class="set-back">← ย้อนกลับ</button>
      <h2>ตั้งค่าสินค้า</h2>
    </div>
    <div class="set-content">
      <div class="form-group">
        <label class="form-label">จำนวนหลัก (Decimal)</label>
        <input type="number" class="form-input" placeholder="เช่น 2" value="2" />
      </div>
      <div class="form-group">
        <label class="form-label">แสดงต้นทุน</label>
        <label class="form-checkbox">
          <input type="checkbox" />
          <span>แสดงราคาต้นทุน</span>
        </label>
      </div>
      <button class="btn btn-primary" style="width:100%">บันทึก</button>
    </div>
  `;
}
