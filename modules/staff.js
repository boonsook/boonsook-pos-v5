// ============================================================
// js/modules/staff.js
// Boonsook POS V5 — Staff Management Module
// เข้าถึงผ่าน #staff (admin only)
// ============================================================

import { isAdmin, getPermLevel, showAccessDenied } from './auth.js';

const ROLE_LABEL = { admin: 'Admin', staff: 'พนักงานขาย', technician: 'ช่างซ่อม' };
const ROLE_COLOR = { admin: '#e74c3c', staff: '#3498db', technician: '#27ae60' };
const ROLE_EMOJI = { admin: '🛡️', staff: '👤', technician: '🔧' };

// ── Entry point ───────────────────────────────────────────
export async function initStaff() {
  const container = document.getElementById('main-content');
  if (!container) return;

  if (!isAdmin()) {
    showAccessDenied('main-content');
    return;
  }

  container.innerHTML = `
    <div style="padding:20px 24px;max-width:900px">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:600">👥 จัดการพนักงาน</h2>
          <div style="font-size:13px;color:#888;margin-top:2px">
            เพิ่ม แก้ไข และกำหนดสิทธิ์พนักงาน
          </div>
        </div>
        <button id="btn-add-staff"
          style="background:#3498db;color:#fff;border:none;border-radius:8px;
                 padding:9px 18px;font-size:14px;font-weight:500;cursor:pointer;
                 display:flex;align-items:center;gap:6px">
          + เพิ่มพนักงาน
        </button>
      </div>

      <!-- Summary cards -->
      <div id="staff-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
                                      gap:12px;margin-bottom:20px"></div>

      <!-- Staff table -->
      <div id="staff-table-wrap"></div>
    </div>

    <!-- Modal overlay -->
    <div id="staff-modal-overlay"
      style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);
             z-index:1000;align-items:center;justify-content:center">
      <div id="staff-modal"
        style="background:#fff;border-radius:14px;width:380px;max-width:94vw;
               max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      </div>
    </div>`;

  // Events
  document.getElementById('btn-add-staff').addEventListener('click', () => openModal());

  const overlay = document.getElementById('staff-modal-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  await loadData();
}

// ── Load & Render ─────────────────────────────────────────
async function loadData() {
  const sb = window._supabase;
  const wrap = document.getElementById('staff-table-wrap');
  const summaryEl = document.getElementById('staff-summary');
  if (!wrap || !sb) return;

  wrap.innerHTML = `<div style="text-align:center;color:#aaa;padding:40px;font-size:14px">
    กำลังโหลด...</div>`;

  const { data, error } = await sb
    .from('staff')
    .select('id, name, phone, role, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    wrap.innerHTML = `<div style="color:#e74c3c;padding:20px;font-size:13px">
      เกิดข้อผิดพลาด: ${error.message}</div>`;
    return;
  }

  const list = data || [];

  // Summary cards
  const counts = { admin: 0, staff: 0, technician: 0 };
  list.filter(s => s.is_active).forEach(s => counts[s.role] = (counts[s.role] || 0) + 1);
  summaryEl.innerHTML = Object.entries(counts).map(([role, n]) => `
    <div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;
                border-left:3px solid ${ROLE_COLOR[role]}">
      <div style="font-size:11px;color:#888;margin-bottom:4px">${ROLE_EMOJI[role]} ${ROLE_LABEL[role]}</div>
      <div style="font-size:22px;font-weight:600;color:${ROLE_COLOR[role]}">${n}</div>
    </div>`).join('');

  // Table
  if (!list.length) {
    wrap.innerHTML = `<div style="text-align:center;color:#aaa;padding:60px;font-size:14px">
      ยังไม่มีพนักงาน<br>
      <span style="font-size:12px">กดปุ่ม "เพิ่มพนักงาน" เพื่อเริ่มต้น</span>
    </div>`;
    return;
  }

  const rows = list.map(s => {
    const roleStyle = `background:${ROLE_COLOR[s.role]}18;color:${ROLE_COLOR[s.role]};
                       border:1px solid ${ROLE_COLOR[s.role]}44;padding:2px 8px;
                       border-radius:4px;font-size:11px;font-weight:500`;
    const activeStyle = s.is_active
      ? 'color:#27ae60;font-size:13px'
      : 'color:#bbb;font-size:13px';
    const date = s.created_at
      ? new Date(s.created_at).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' })
      : '—';

    return `
      <tr style="border-bottom:1px solid #f0f0f0;transition:background 0.1s"
          onmouseenter="this.style.background='#f8fbff'"
          onmouseleave="this.style.background=''">
        <td style="padding:12px 14px">
          <div style="font-weight:500;font-size:14px">${escHtml(s.name)}</div>
          <div style="font-size:11px;color:#aaa;margin-top:1px">${s.phone || ''}</div>
        </td>
        <td style="padding:12px 14px">
          <span style="${roleStyle}">${ROLE_EMOJI[s.role]} ${ROLE_LABEL[s.role]||s.role}</span>
        </td>
        <td style="padding:12px 14px">
          <span style="${activeStyle}">${s.is_active ? '● ใช้งาน' : '● ปิดใช้งาน'}</span>
        </td>
        <td style="padding:12px 14px;font-size:12px;color:#aaa">${date}</td>
        <td style="padding:12px 14px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button data-action="edit" data-staff-id="${escHtml(s.id)}"
              style="padding:5px 12px;border:1px solid #ddd;border-radius:6px;
                     background:#fff;font-size:12px;cursor:pointer;color:#555">
              แก้ไข
            </button>
            <button data-action="change-pin" data-staff-id="${escHtml(s.id)}" data-staff-name="${escHtml(s.name)}"
              style="padding:5px 12px;border:1px solid #ddd;border-radius:6px;
                     background:#fff;font-size:12px;cursor:pointer;color:#555">
              เปลี่ยน PIN
            </button>
            <button data-action="toggle" data-staff-id="${escHtml(s.id)}" data-active="${s.is_active}" data-staff-name="${escHtml(s.name)}"
              style="padding:5px 12px;border:1px solid ${s.is_active?'#fcc':'#cfc'};
                     border-radius:6px;background:${s.is_active?'#fff9f9':'#f9fff9'};
                     font-size:12px;cursor:pointer;color:${s.is_active?'#e74c3c':'#27ae60'}">
              ${s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="overflow-x:auto;border:1px solid #eee;border-radius:10px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:1px solid #eee">
            <th style="padding:10px 14px;text-align:left;font-size:12px;color:#888;font-weight:500">ชื่อ / เบอร์</th>
            <th style="padding:10px 14px;text-align:left;font-size:12px;color:#888;font-weight:500">บทบาท</th>
            <th style="padding:10px 14px;text-align:left;font-size:12px;color:#888;font-weight:500">สถานะ</th>
            <th style="padding:10px 14px;text-align:left;font-size:12px;color:#888;font-weight:500">เพิ่มเมื่อ</th>
            <th style="padding:10px 14px;text-align:left;font-size:12px;color:#888;font-weight:500">การดำเนินการ</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // ★ FIX: ใช้ event delegation แทน inline onclick เพื่อป้องกัน XSS + memory leak
  wrap.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.staffId));
  });
  wrap.querySelectorAll('[data-action="change-pin"]').forEach(btn => {
    btn.addEventListener('click', () => openChangePINModal(btn.dataset.staffId, btn.dataset.staffName));
  });
  wrap.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.staffId;
      const current = btn.dataset.active === 'true';
      const name = btn.dataset.staffName;
      if (!(await window.App?.confirm?.(`${current ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}: ${name}?`))) return;
      try {
        const { error } = await sb.from('staff').update({ is_active: !current }).eq('id', id);
        if (!error) await loadData();
        else window.App?.showToast?.(`ผิดพลาด: ${error.message}`);
      } catch (err) {
        window.App?.showToast?.(`ผิดพลาด: ${err.message}`);
      }
    });
  });
}

// ── Add / Edit Modal ──────────────────────────────────────
async function openModal(staffId = null) {
  const sb = window._supabase;
  if (!sb) return;

  let existing = null;
  if (staffId) {
    const { data, error } = await sb.from('staff').select('*').eq('id', staffId).single();
    if (error) {
      console.error('[staff] load staff error:', error.message);
      window.App?.showToast?.('ไม่สามารถโหลดข้อมูลพนักงานได้: ' + error.message);
      return;
    }
    existing = data;
  }

  const modal = document.getElementById('staff-modal');
  modal.innerHTML = `
    <div style="padding:20px 22px;border-bottom:1px solid #eee;
                display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0;font-size:16px;font-weight:600">
        ${existing ? '✏️ แก้ไขพนักงาน' : '➕ เพิ่มพนักงานใหม่'}
      </h3>
      <button onclick="window.__staffCloseModal()"
        style="background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;
               padding:2px 6px;border-radius:4px">✕</button>
    </div>

    <form id="staff-form" style="padding:20px 22px;display:flex;flex-direction:column;gap:16px">
      <div>
        <label class="field-label">ชื่อพนักงาน *</label>
        <input type="text" id="sf-name" value="${escHtml(existing?.name||'')}" required
          placeholder="เช่น สมชาย ใจดี"
          style="${inputStyle()}">
      </div>
      <div>
        <label class="field-label">เบอร์โทร</label>
        <input type="tel" id="sf-phone" value="${escHtml(existing?.phone||'')}"
          placeholder="เช่น 086-2613829"
          style="${inputStyle()}">
      </div>
      <div>
        <label class="field-label">บทบาท *</label>
        <select id="sf-role" style="${inputStyle()}">
          <option value="staff"      ${existing?.role==='staff'      ?'selected':''}>👤 พนักงานขาย — pos, ลูกค้า, เอกสาร</option>
          <option value="technician" ${existing?.role==='technician' ?'selected':''}>🔧 ช่างซ่อม — เฉพาะงานซ่อม</option>
          <option value="admin"      ${existing?.role==='admin'      ?'selected':''}>🛡️ Admin — ทุก module</option>
        </select>
      </div>
      ${!existing ? `
      <div>
        <label class="field-label">PIN (4 หลัก) *</label>
        <input type="password" id="sf-pin" maxlength="4" pattern="[0-9]{4}"
          placeholder="กรอก PIN 4 หลัก"
          style="${inputStyle()}">
        <div style="font-size:11px;color:#aaa;margin-top:4px">ตัวเลข 0-9 เท่านั้น</div>
      </div>` : ''}

      <div id="sf-err" style="color:#e74c3c;font-size:13px;display:none;
                               background:#fff5f5;padding:8px 12px;border-radius:6px;
                               border:1px solid #fcc"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
        <button type="button" onclick="window.__staffCloseModal()"
          style="padding:9px 18px;border:1px solid #ddd;border-radius:8px;
                 background:#fff;cursor:pointer;font-size:14px">ยกเลิก</button>
        <button type="submit" id="sf-submit"
          style="padding:9px 20px;border:none;border-radius:8px;
                 background:#3498db;color:#fff;cursor:pointer;
                 font-size:14px;font-weight:500">
          ${existing ? '💾 บันทึก' : '➕ เพิ่มพนักงาน'}
        </button>
      </div>
    </form>`;

  showModal();

  window.__staffCloseModal = closeModal;

  document.getElementById('staff-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name  = document.getElementById('sf-name').value.trim();
    const phone = document.getElementById('sf-phone').value.trim();
    const role  = document.getElementById('sf-role').value;
    const pin   = document.getElementById('sf-pin')?.value || null;
    const errEl = document.getElementById('sf-err');

    // Validation
    if (!name) return showErr(errEl, 'กรุณาใส่ชื่อพนักงาน');
    if (!existing && !pin) return showErr(errEl, 'กรุณาใส่ PIN');
    if (pin && !/^\d{4}$/.test(pin)) return showErr(errEl, 'PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น');

    errEl.style.display = 'none';
    const btn = document.getElementById('sf-submit');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';

    const payload = { name, phone: phone || null, role };
    if (pin) payload.pin = pin;

    try {
      const { error } = existing
        ? await sb.from('staff').update(payload).eq('id', existing.id)
        : await sb.from('staff').insert(payload);

      if (error) {
        showErr(errEl, `ผิดพลาด: ${error.message}`);
      } else {
        closeModal();
        await loadData();
      }
    } catch (err) {
      console.error('[staff save] error:', err);
      showErr(errEl, `ผิดพลาด: ${err.message || err}`);
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = existing ? '💾 บันทึก' : '➕ เพิ่มพนักงาน';
      }
    }
  });
}

// ── Change PIN Modal ──────────────────────────────────────
async function openChangePINModal(staffId, staffName) {
  const sb = window._supabase;
  if (!sb) return;

  const modal = document.getElementById('staff-modal');
  modal.innerHTML = `
    <div style="padding:20px 22px;border-bottom:1px solid #eee;
                display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0;font-size:16px;font-weight:600">🔑 เปลี่ยน PIN</h3>
      <button onclick="window.__staffCloseModal()"
        style="background:none;border:none;font-size:18px;cursor:pointer;color:#aaa">✕</button>
    </div>
    <div style="padding:20px 22px">
      <div style="font-size:14px;margin-bottom:16px;color:#555">
        พนักงาน: <strong>${escHtml(staffName)}</strong>
      </div>
      <div style="margin-bottom:14px">
        <label class="field-label">PIN ใหม่ (4 หลัก) *</label>
        <input type="password" id="pin-new" maxlength="4" pattern="[0-9]{4}"
          placeholder="PIN ใหม่" style="${inputStyle()}">
      </div>
      <div style="margin-bottom:16px">
        <label class="field-label">ยืนยัน PIN ใหม่ *</label>
        <input type="password" id="pin-conf" maxlength="4" pattern="[0-9]{4}"
          placeholder="ยืนยัน PIN" style="${inputStyle()}">
      </div>
      <div id="pin-err" style="color:#e74c3c;font-size:13px;display:none;margin-bottom:10px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="window.__staffCloseModal()"
          style="padding:9px 18px;border:1px solid #ddd;border-radius:8px;
                 background:#fff;cursor:pointer;font-size:14px">ยกเลิก</button>
        <button id="pin-save-btn" onclick="window.__savePIN('${staffId}')"
          style="padding:9px 20px;border:none;border-radius:8px;
                 background:#27ae60;color:#fff;cursor:pointer;
                 font-size:14px;font-weight:500">💾 บันทึก PIN</button>
      </div>
    </div>`;

  showModal();
  window.__staffCloseModal = closeModal;
  window.__savePIN = async (id) => {
    const np = document.getElementById('pin-new').value;
    const cp = document.getElementById('pin-conf').value;
    const errEl = document.getElementById('pin-err');
    if (!/^\d{4}$/.test(np)) return showErr(errEl, 'PIN ต้องเป็นตัวเลข 4 หลัก');
    if (np !== cp) return showErr(errEl, 'PIN ทั้งสองช่องไม่ตรงกัน');
    const { error } = await sb.from('staff').update({ pin: np }).eq('id', id);
    if (error) return showErr(errEl, `ผิดพลาด: ${error.message}`);
    closeModal();
    window.App?.showToast?.(`✅ เปลี่ยน PIN ของ ${staffName} เรียบร้อย`);
  };
}

// ── Modal helpers ─────────────────────────────────────────
function showModal() {
  const overlay = document.getElementById('staff-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeModal() {
  const overlay = document.getElementById('staff-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Style helpers ─────────────────────────────────────────
function inputStyle() {
  return [
    'width:100%', 'padding:9px 12px', 'border:1px solid #ddd',
    'border-radius:8px', 'font-size:14px', 'box-sizing:border-box',
    'outline:none', 'transition:border-color 0.15s'
  ].join(';');
}

// Phase 51: dedup → use shared utils
import { escHtml } from "./utils.js";
