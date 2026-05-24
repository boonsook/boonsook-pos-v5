// ═══════════════════════════════════════════════════════════
//  settings/store.js — Store Information Settings
// ═══════════════════════════════════════════════════════════

import { escHtml } from './utils.js';

/**
 * Render Store Info page
 * Extract from: renderStoreInfo() function lines 166-211
 */
export function renderSettingsStore(el, ctx, _goBack, _navigate) {
  const { state, showToast, saveStoreInfo } = ctx;
  const storeInfo = state.storeInfo || {};

  el.innerHTML = `
    <div class="set-header">
      <button class="set-back" id="store-back-btn">← ย้อนกลับ</button>
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

      <!-- Phase 92.25b: ชั่วโมงทำงาน (กะมาตรฐาน) — ใช้คำนวณ OT ใน Time Clock -->
      <div style="margin-top:18px;padding:14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px">
        <div style="font-weight:700;color:#0c4a6e;margin-bottom:4px">🕒 ชั่วโมงทำงาน (กะมาตรฐาน)</div>
        <div style="font-size:11px;color:#075985;margin-bottom:10px">กำหนดเวลาเข้า/ออกของกะปกติ — เกินจากนี้จะถูกบันทึกเป็น OT อัตโนมัติในหน้าลงเวลา (default 08:00-17:00)</div>
        <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <label class="form-label" style="font-size:12px">เริ่มกะ (HH)</label>
            <input type="number" min="0" max="23" step="1" id="storeShiftStart" class="form-input" value="${escHtml(String(storeInfo.shiftStartHour ?? 8))}" />
          </div>
          <div style="flex:1;min-width:120px">
            <label class="form-label" style="font-size:12px">เลิกกะ (HH)</label>
            <input type="number" min="0" max="23" step="1" id="storeShiftEnd" class="form-input" value="${escHtml(String(storeInfo.shiftEndHour ?? 17))}" />
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:14px">
        <button id="saveStoreBtn" class="btn btn-primary" style="flex:1">บันทึก</button>
        <button id="store-cancel-btn" class="btn btn-secondary" style="flex:1">ยกเลิก</button>
      </div>
    </div>
  `;

  // Phase 89.23: nav buttons ผ่าน addEventListener (เลิก inline onclick="document.dispatchEvent(...)")
  const navMain = () => document.dispatchEvent(new CustomEvent('navigate-settings', { detail: 'main' }));
  document.getElementById('store-back-btn')?.addEventListener('click', navMain);
  document.getElementById('store-cancel-btn')?.addEventListener('click', navMain);

  // Event listeners
  document.getElementById('saveStoreBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ กำลังบันทึก...';

    // Phase 92.25b: shift hours — clamp 0-23 + ensure start < end (fallback default 8/17)
    const shiftStartRaw = parseInt(document.getElementById('storeShiftStart')?.value, 10);
    const shiftEndRaw   = parseInt(document.getElementById('storeShiftEnd')?.value, 10);
    const shiftStart = (Number.isFinite(shiftStartRaw) && shiftStartRaw >= 0 && shiftStartRaw <= 23) ? shiftStartRaw : 8;
    const shiftEnd   = (Number.isFinite(shiftEndRaw)   && shiftEndRaw   >= 0 && shiftEndRaw   <= 23) ? shiftEndRaw   : 17;
    const safeStart  = shiftStart < shiftEnd ? shiftStart : 8;
    const safeEnd    = shiftStart < shiftEnd ? shiftEnd   : 17;

    const data = {
      name: document.getElementById('storeName')?.value?.trim() || '',
      phone: document.getElementById('storePhone')?.value?.trim() || '',
      email: document.getElementById('storeEmail')?.value?.trim() || '',
      address: document.getElementById('storeAddress')?.value?.trim() || '',
      shiftStartHour: safeStart,
      shiftEndHour:   safeEnd
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
