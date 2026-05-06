// ============================================================
// js/modules/auth.js
// Boonsook POS V5 — Permission Helper & Staff Login
// ============================================================

const STORAGE_KEY = 'bns_current_staff';

// ── Permission Matrix ─────────────────────────────────────
// 'full' = CRUD ทั้งหมด
// 'own'  = แก้ได้เฉพาะที่ตัวเองสร้าง / รับผิดชอบ
// 'read' = ดูได้อย่างเดียว
// 'none' = ไม่มีสิทธิ์เข้าถึง
const PERMS = {
  admin: {
    dashboard: 'full', pos: 'full', products: 'full', sales: 'full',
    customers: 'full', quotations: 'full', delivery_invoices: 'full',
    receipts: 'full', service_jobs: 'full', loyalty: 'full',
    expenses: 'full', stock_movements: 'full', staff: 'full', settings: 'full'
  },
  staff: {
    dashboard: 'read', pos: 'full', products: 'read', sales: 'own',
    customers: 'full', quotations: 'full', delivery_invoices: 'full',
    receipts: 'full', service_jobs: 'full', loyalty: 'full',
    expenses: 'own', stock_movements: 'read', staff: 'none', settings: 'none'
  },
  technician: {
    dashboard: 'read', pos: 'none', products: 'read', sales: 'none',
    customers: 'none', quotations: 'none', delivery_invoices: 'none',
    receipts: 'none', service_jobs: 'own', loyalty: 'none',
    expenses: 'none', stock_movements: 'none', staff: 'none', settings: 'none'
  }
};

const ROLE_EMOJI = { admin: '🛡️', staff: '👤', technician: '🔧' };
const ROLE_LABEL = { admin: 'Admin', staff: 'พนักงานขาย', technician: 'ช่างซ่อม' };

// ── Core getters ──────────────────────────────────────────
export function getCurrentStaff() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentStaff(staff) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
  _renderIndicator();
}

export function clearCurrentStaff() {
  const staff = getCurrentStaff();
  // ปิด session ใน DB (fire-and-forget แต่ log error)
  if (staff?.sessionId && window._supabase) {
    window._supabase
      .from('staff_sessions')
      .update({ logged_out_at: new Date().toISOString() })
      .eq('id', staff.sessionId)
      .then(({ error }) => {
        if (error) console.warn('[auth] session logout failed:', error.message);
      })
      .catch(err => console.warn('[auth] session logout error:', err.message));
  }
  localStorage.removeItem(STORAGE_KEY);
  _renderIndicator();
}

// ── Permission helpers ────────────────────────────────────
export function isAdmin() {
  return getCurrentStaff()?.role === 'admin';
}

/** คืน level: 'full' | 'own' | 'read' | 'none' */
export function getPermLevel(module) {
  const staff = getCurrentStaff();
  if (!staff) return 'none';
  return PERMS[staff.role]?.[module] ?? 'none';
}

/** มีสิทธิ์เข้าถึง module นี้หรือไม่ */
export function hasAccess(module) {
  return getPermLevel(module) !== 'none';
}

/** เขียน/แก้ไข/ลบได้หรือไม่ */
export function canWrite(module) {
  const lvl = getPermLevel(module);
  return lvl === 'full' || lvl === 'own';
}

/**
 * ตรวจว่า record เป็นของ current staff หรือไม่
 * @param {object} record  - row จาก Supabase
 * @param {string} field   - ชื่อ FK column เช่น 'created_by' หรือ 'assigned_to'
 */
export function isOwnRecord(record, field = 'created_by') {
  if (isAdmin()) return true;
  const staff = getCurrentStaff();
  return staff ? record?.[field] === staff.id : false;
}

/** แสดง access-denied UI ใน container */
export function showAccessDenied(containerId = 'main-content') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;height:300px;gap:10px;color:#aaa">
      <div style="font-size:36px">🔒</div>
      <div style="font-size:15px;font-weight:500;color:#555">ไม่มีสิทธิ์เข้าถึง</div>
      <div style="font-size:12px">กรุณาติดต่อ admin</div>
    </div>`;
}

// ── Header indicator ──────────────────────────────────────
function _renderIndicator() {
  const el = document.getElementById('staff-indicator');
  if (!el) return;
  const staff = getCurrentStaff();
  if (staff) {
    el.innerHTML = `
      <span class="staff-chip" title="คลิกเพื่อออกจากระบบ"
            onclick="window.__authLogout && window.__authLogout()"
            style="display:inline-flex;align-items:center;gap:5px;
                   font-size:12px;cursor:pointer;padding:3px 8px;
                   border-radius:12px;border:1px solid #ddd;background:#fafafa">
        ${ROLE_EMOJI[staff.role] || '👤'} ${staff.name}
        <span style="color:#aaa;font-size:11px">ออก</span>
      </span>`;
  } else {
    el.innerHTML = `
      <span onclick="window.__authLogin && window.__authLogin()"
            style="font-size:12px;cursor:pointer;color:#e74c3c;padding:3px 8px;
                   border-radius:12px;border:1px solid #fcc;background:#fff9f9">
        🔑 เข้าสู่ระบบ
      </span>`;
  }
}

// ── PIN Login Modal ───────────────────────────────────────
export function showStaffLogin() {
  return new Promise(async (resolve) => {
    const sb = window._supabase;

    // ดึงรายชื่อพนักงานที่ active
    let staffList = [];
    if (sb) {
      try {
        const { data, error } = await sb
          .from('staff')
          .select('id, name, role')
          .eq('is_active', true)
          .order('name');
        if (error) console.error('[auth] load staff error:', error.message);
        staffList = data || [];
      } catch (err) {
        console.error('[auth] load staff failed:', err.message);
      }
    }

    // ลบ modal เก่า
    document.getElementById('__auth-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '__auth-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
      'z-index:99999', 'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');

    const staffBtns = staffList.map(s => `
      <button class="__sb" data-id="${s.id}" data-name="${escHtml(s.name)}" data-role="${s.role}"
        style="background:#f8f8f8;border:1px solid #eee;border-radius:10px;
               padding:12px 14px;cursor:pointer;text-align:left;width:100%;
               transition:background 0.15s">
        <div style="font-weight:500;font-size:14px">${ROLE_EMOJI[s.role]||'👤'} ${escHtml(s.name)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px">${ROLE_LABEL[s.role]||s.role}</div>
      </button>`).join('');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px 24px;
                  width:300px;max-width:92vw;
                  box-shadow:0 12px 40px rgba(0,0,0,0.2)">
        <!-- Header -->
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:28px">🏪</div>
          <div style="font-weight:600;font-size:15px;margin-top:6px">บุญสุขอิเล็กทรอนิกส์</div>
          <div style="font-size:12px;color:#aaa;margin-top:2px">เลือกพนักงาน</div>
        </div>

        <!-- Staff list -->
        <div id="__slist" style="display:flex;flex-direction:column;gap:8px;
                                  max-height:260px;overflow-y:auto">
          ${staffBtns || '<div style="color:#aaa;text-align:center;font-size:13px;padding:20px">ไม่พบข้อมูลพนักงาน<br><span style="font-size:11px">กรุณาเพิ่มพนักงานใน Settings → พนักงาน</span></div>'}
        </div>

        <!-- PIN section (hidden by default) -->
        <div id="__pinsec" style="display:none">
          <div id="__pname" style="font-weight:500;font-size:14px;text-align:center;margin-bottom:12px"></div>

          <!-- Dots -->
          <div style="display:flex;gap:10px;justify-content:center;margin-bottom:16px">
            ${[0,1,2,3].map(i =>
              `<div class="__dot" style="width:14px;height:14px;border-radius:50%;
                                        border:2px solid #ddd;background:transparent;
                                        transition:all 0.1s"></div>`
            ).join('')}
          </div>

          <!-- Numpad -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:210px;margin:0 auto">
            ${[1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].map(k => `
              <button class="__pk" data-k="${k}"
                style="padding:14px 0;border:1px solid #eee;border-radius:8px;
                       background:#fafafa;cursor:pointer;font-size:18px;
                       font-weight:500;color:#333;transition:background 0.1s">
                ${k}
              </button>`).join('')}
          </div>

          <div id="__perr" style="color:#e74c3c;font-size:12px;text-align:center;
                                   margin-top:10px;display:none">
            PIN ไม่ถูกต้อง กรุณาลองใหม่
          </div>

          <button onclick="__showStaffList()"
            style="width:100%;margin-top:12px;background:none;border:none;
                   color:#aaa;font-size:12px;cursor:pointer;padding:6px 0">
            ← เลือกคนอื่น
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // ── State ────
    let selected = null;
    let pin = '';
    let _verifying = false; // ★ ป้องกันกด PIN ซ้ำ

    // ── Helpers ──
    function showStaffList() {
      pin = '';
      selected = null;
      document.getElementById('__slist').style.display = 'flex';
      document.getElementById('__pinsec').style.display = 'none';
      updateDots();
    }
    window.__showStaffList = showStaffList;

    function showPinPad(staff) {
      selected = staff;
      pin = '';
      document.getElementById('__pname').textContent =
        `${ROLE_EMOJI[staff.role]||'👤'} ${staff.name} — ใส่ PIN`;
      document.getElementById('__perr').style.display = 'none';
      document.getElementById('__slist').style.display = 'none';
      document.getElementById('__pinsec').style.display = 'block';
      updateDots();
    }

    function updateDots() {
      overlay.querySelectorAll('.__dot').forEach((dot, i) => {
        const filled = i < pin.length;
        dot.style.background = filled ? '#333' : 'transparent';
        dot.style.borderColor = filled ? '#333' : '#ddd';
      });
    }

    async function verifyPin() {
      if (!sb || !selected || _verifying) return;
      _verifying = true; // ★ lock ป้องกันกดซ้ำ

      try {
        const { data, error } = await sb
          .from('staff')
          .select('id, name, role, phone')
          .eq('id', selected.id)
          .eq('pin', pin)
          .eq('is_active', true)
          .single();

        if (error) {
          console.warn('[auth] PIN verify query error:', error.message);
        }

        if (data) {
          // สร้าง session record
          let sessId = null;
          try {
            const deviceInfo = (typeof navigator !== 'undefined' && navigator.userAgent)
              ? navigator.userAgent.slice(0, 120) : 'unknown';
            const { data: sess, error: sessErr } = await sb
              .from('staff_sessions')
              .insert({ staff_id: data.id, device_info: deviceInfo })
              .select('id')
              .single();
            if (sessErr) console.warn('[auth] session insert error:', sessErr.message);
            sessId = sess?.id || null;
          } catch (sessError) {
            console.warn('[auth] session create failed:', sessError.message);
          }

          const staffObj = { ...data, sessionId: sessId, logged_in_at: new Date().toISOString() };
          setCurrentStaff(staffObj);
          overlay.remove();
          resolve(staffObj);
        } else {
          document.getElementById('__perr').style.display = 'block';
          pin = '';
          updateDots();
        }
      } catch (err) {
        console.error('[auth] verifyPin error:', err.message);
        pin = '';
        updateDots();
      } finally {
        _verifying = false; // ★ unlock
      }
    }

    // ── Event listeners ──
    overlay.querySelectorAll('.__sb').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = '#eff6ff');
      btn.addEventListener('mouseleave', () => btn.style.background = '#f8f8f8');
      btn.addEventListener('click', () =>
        showPinPad({ id: btn.dataset.id, name: btn.dataset.name, role: btn.dataset.role })
      );
    });

    overlay.querySelectorAll('.__pk').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = '#e8f0fe');
      btn.addEventListener('mouseleave', () => btn.style.background = '#fafafa');
      btn.addEventListener('click', async () => {
        if (_verifying) return; // ★ ป้องกันกดขณะกำลัง verify
        const k = btn.dataset.k;
        if (k === '⌫') {
          pin = pin.slice(0, -1);
          updateDots();
          document.getElementById('__perr').style.display = 'none';
        } else if (k === '✓') {
          if (pin.length === 4) await verifyPin();
        } else {
          if (pin.length < 4) {
            pin += k;
            updateDots();
            if (pin.length === 4) await verifyPin();
          }
        }
      });
    });
  });
}

// ── Init (เรียกจาก index.html หรือ main router) ───────────
export async function initAuth() {
  _renderIndicator();

  // Expose logout/login ให้ header ใช้
  window.__authLogout = async () => {
    const staff = getCurrentStaff();
    if (!staff) return;
    if (await window.App?.confirm?.(`ออกจากระบบ: ${staff.name}?`)) {
      clearCurrentStaff();
      // Reload current page
      window.dispatchEvent(new Event('hashchange'));
    }
  };

  window.__authLogin = async () => {
    await showStaffLogin();
    window.dispatchEvent(new Event('hashchange'));
  };

  // ถ้ายังไม่มีใครล็อกอิน → แสดง modal
  if (!getCurrentStaff()) {
    await showStaffLogin();
  }

  return getCurrentStaff();
}

// ── Utils ─────────────────────────────────────────────────
// Phase 51: dedup + fix XSS gap (added apostrophe escape via shared utils)
import { escHtml } from "./utils.js";
