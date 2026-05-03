import { escHtml } from "./utils.js";

export function renderSettingsUsers(el, ctx, goBack, navigateToView) {
  const { state, ROLE_LABELS, changeRole, openAddUserDrawer, showToast } = ctx;
  const roleColors = { admin: "#dc2626", technician: "#d97706", sales: "#0284c7", customer: "#059669" };

  const users = (state.allProfiles || []).filter(p => p.role !== "customer");

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ตั้งค่าผู้ใช้งาน</h3>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <div style="font-size:11px;color:#94a3b8">${users.length} ผู้ใช้ในระบบ</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="syncUsersBtn" class="btn light" style="font-size:12px" title="ดึง user ที่อาจตกหล่นจาก Supabase auth → profiles">🔄 Sync ผู้ใช้</button>
          <button id="openAddUserBtn" class="btn primary">+ เพิ่มผู้ใช้</button>
        </div>
      </div>

      <!-- ★ Inline styles เพื่อกัน layout overflow -->
      <style>
        .usr-card{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden}
        .usr-avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:18px;font-weight:900;flex-shrink:0}
        .usr-info{flex:1;min-width:0;overflow:hidden}
        .usr-name{font-size:15px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .usr-email{font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .usr-role{font-size:12px;font-weight:700;margin-top:2px}
        .usr-date{font-size:11px;color:#94a3b8;margin-top:2px}
        .usr-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:nowrap}
        .usr-actions select, .usr-actions button{font-size:12px;padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;white-space:nowrap}
        .usr-actions .btn-edit{background:#f1f5f9;color:#475569}
        .usr-actions .btn-del{background:#fef2f2;color:#dc2626;border-color:#fca5a5}
        @media(max-width:640px){
          .usr-card{flex-wrap:wrap}
          .usr-actions{width:100%;margin-top:8px;justify-content:flex-end}
        }
      </style>

      <div class="set-user-list" style="display:grid;gap:8px">
        ${users.length ? users.map(p => {
          const rLabel = ROLE_LABELS[p.role] || p.role;
          const rColor = roleColors[p.role] || "#64748b";
          const isMe = p.id === state.currentUser?.id;
          // ★ Fallback: full_name → email prefix → "ผู้ใช้ใหม่"
          const emailPrefix = p.email ? String(p.email).split("@")[0] : "";
          const displayName = p.full_name || emailPrefix || "ผู้ใช้ใหม่";
          const nameMissing = !p.full_name;
          return `
            <div class="usr-card">
              <div class="usr-avatar" style="background:${rColor}">${escHtml(displayName.charAt(0).toUpperCase())}</div>
              <div class="usr-info">
                <div class="usr-name">${escHtml(displayName)}${nameMissing ? ' <span style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:700" title="ยังไม่ได้กรอกชื่อ — กด ✏️ แก้ไขเพื่อใส่ชื่อจริง">⚠️ ไม่มีชื่อ</span>' : ''}${isMe ? ' <span style="background:#dcfce7;color:#166534;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:700">คุณ</span>' : ''}</div>
                ${p.email ? `<div class="usr-email">✉️ ${escHtml(p.email)}</div>` : ''}
                <div class="usr-role" style="color:${rColor}">${rLabel}</div>
                ${p.created_at ? `<div class="usr-date">เข้าร่วม: ${new Date(p.created_at).toLocaleDateString("th-TH")}</div>` : ''}
              </div>
              <div class="usr-actions">
                ${isMe ? '' : `
                  <select data-role-user-id="${p.id}" title="เปลี่ยนบทบาท">
                    <option value="admin" ${p.role==='admin'?'selected':''}>Admin</option>
                    <option value="technician" ${p.role==='technician'?'selected':''}>ช่าง</option>
                    <option value="sales" ${p.role==='sales'?'selected':''}>พนักงานขาย</option>
                  </select>
                  <button class="btn-edit" data-edit-user-id="${p.id}" title="แก้ไขชื่อ/เบอร์">✏️ แก้ไข</button>
                  <button class="btn-del" data-del-user-id="${p.id}" data-del-user-name="${escHtml(p.full_name || '')}" title="ลบผู้ใช้">🗑️</button>
                `}
              </div>
            </div>
          `;
        }).join("") : '<div style="text-align:center;padding:24px;color:#94a3b8">ยังไม่มีผู้ใช้ — กด "+ เพิ่มผู้ใช้" เพื่อเริ่มต้น</div>'}
      </div>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
  document.getElementById("openAddUserBtn")?.addEventListener("click", openAddUserDrawer);

  // ★ Sync ผู้ใช้จาก auth.users (ใช้ profiles_with_email VIEW) → กรอก profiles ที่ขาด
  document.getElementById("syncUsersBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("syncUsersBtn");
    btn.disabled = true; btn.textContent = "⏳ กำลัง sync...";
    try {
      // Step 1: query profiles_with_email VIEW (มี email + full_name จาก auth.users)
      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;
      const viewRes = await fetch(cfg.url + "/rest/v1/profiles_with_email?select=id,email,full_name,role", {
        headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
      });
      let viewData = [];
      if (viewRes.ok) {
        try { viewData = await viewRes.json(); } catch(e){}
      }

      // Step 2: หา id ที่อยู่ใน VIEW แต่ไม่อยู่ใน state.allProfiles
      const existingIds = new Set((state.allProfiles || []).map(p => String(p.id)));
      const missing = (viewData || []).filter(v => !existingIds.has(String(v.id)));

      if (missing.length === 0) {
        showToast?.("✓ ผู้ใช้ครบแล้ว — ไม่มีตกหล่น");
        btn.disabled = false; btn.textContent = "🔄 Sync ผู้ใช้";
        return;
      }

      // Step 3: UPSERT แต่ละคนเข้า profiles
      let ok = 0;
      for (const u of missing) {
        const payload = {
          id: u.id,
          full_name: u.full_name || (u.email ? u.email.split("@")[0] : ""),
          role: u.role || "sales"
        };
        try {
          const r = await fetch(cfg.url + "/rest/v1/profiles", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": cfg.anonKey,
              "Authorization": "Bearer " + accessToken,
              "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify(payload)
          });
          if (r.ok) ok++;
        } catch(e) {}
      }

      showToast?.(`✓ Sync สำเร็จ ${ok}/${missing.length} user`);
      if (window.App?.loadAllData) await window.App.loadAllData();
      // re-render
      if (window.App?.showRoute) window.App.showRoute("settings");
    } catch (e) {
      showToast?.("❌ ผิดพลาด: " + (e?.message || e) + " — ลองรัน SQL backfill แทน");
    } finally {
      btn.disabled = false; btn.textContent = "🔄 Sync ผู้ใช้";
    }
  });

  // เปลี่ยน role
  el.querySelectorAll("[data-role-user-id]").forEach(sel => {
    sel.addEventListener("change", () => changeRole(sel.dataset.roleUserId, sel.value));
  });

  // แก้ไข (full_name + phone + department) — Phase 75 + 75.1
  el.querySelectorAll("[data-edit-user-id]").forEach(btn => btn.addEventListener("click", async () => {
    const userId = btn.dataset.editUserId;
    const p = (state.allProfiles || []).find(x => x.id === userId);
    if (!p) return;
    const result = await _editUserModal(p);
    if (!result) return;
    const patch = {};
    if (result.full_name !== (p.full_name || "")) patch.full_name = result.full_name;
    if (result.phone !== (p.phone || "")) patch.phone = result.phone;
    if (String(result.department_id || "") !== String(p.department_id || "")) {
      patch.department_id = result.department_id || null;
    }
    // Phase 77
    const curPayType = p.pay_type || 'monthly';
    if ((result.pay_type || 'monthly') !== curPayType) patch.pay_type = result.pay_type || 'monthly';
    if (Number(result.daily_rate || 0) !== Number(p.daily_rate || 0)) patch.daily_rate = Number(result.daily_rate || 0);
    if (Object.keys(patch).length === 0) return showToast("ไม่มีการเปลี่ยนแปลง");
    const fn = window._appUpdateUserProfile;
    if (typeof fn === 'function') {
      if (await fn(userId, patch)) navigateToView && navigateToView('users');
    }
  }));

  // ลบผู้ใช้
  el.querySelectorAll("[data-del-user-id]").forEach(btn => btn.addEventListener("click", async () => {
    const userId = btn.dataset.delUserId;
    const name = btn.dataset.delUserName;
    const fn = window._appDeleteUserProfile;
    if (typeof fn === 'function') {
      if (await fn(userId, name)) navigateToView && navigateToView('users');
    }
  }));
}

// Phase 75 + 75.1: replace prompt() — modal แก้ไขชื่อ + เบอร์ + แผนก
async function _editUserModal(profile) {
  // Phase 75.1: fetch departments เพื่อสร้าง dropdown (ถ้ายังไม่ได้รัน SQL phase 71 → จะได้ [] = ซ่อน field)
  let depts = [];
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const res = await fetch(cfg.url + "/rest/v1/departments?select=id,name,code&order=sort_order.asc,name.asc", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (res.ok) depts = await res.json();
  } catch (_) { /* table อาจยังไม่มี — ซ่อน field */ }

  return new Promise(resolve => {
    document.getElementById("editUserModal")?.remove();
    const m = document.createElement("div");
    m.id = "editUserModal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px";
    const deptField = depts.length > 0 ? `
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">🏢 แผนก</div>
            <select id="editUserDept" style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff">
              <option value="">— ไม่ระบุแผนก —</option>
              ${depts.map(d => `<option value="${d.id}" ${String(profile.department_id || "") === String(d.id) ? "selected" : ""}>${escHtml(d.name)}${d.code ? ` (${escHtml(d.code)})` : ""}</option>`).join("")}
            </select>
          </label>` : "";
    m.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px">
        <h3 style="margin:0 0 14px;font-size:16px;color:#0f172a">✏️ แก้ไขผู้ใช้</h3>
        <div style="display:grid;gap:10px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ชื่อ-นามสกุล</div>
            <input id="editUserName" type="text" maxlength="100" value="${escHtml(profile.full_name || "")}" style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เบอร์โทร</div>
            <input id="editUserPhone" type="tel" maxlength="20" value="${escHtml(profile.phone || "")}" placeholder="08X-XXXXXXX" style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
          </label>
          ${deptField}

          <!-- Phase 77: Pay type + daily rate -->
          <div style="border-top:1px dashed #e5e7eb;padding-top:10px;margin-top:4px">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">💰 รูปแบบการจ่ายเงิน</div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;cursor:pointer">
              <input type="radio" name="editUserPayType" value="monthly" ${profile.pay_type !== 'daily' ? 'checked' : ''} />
              <span>📅 รายเดือน — กรอกเงินเดือนคงที่ตอนสร้างรายการ</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="radio" name="editUserPayType" value="daily" ${profile.pay_type === 'daily' ? 'checked' : ''} />
              <span>🕐 รายวัน — คิดค่าจ้างต่อวัน × จำนวนวัน</span>
            </label>
            <label id="editUserDailyRow" style="display:${profile.pay_type === 'daily' ? 'block' : 'none'};margin-top:8px">
              <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">ค่าจ้าง/วัน (บาท)</div>
              <input id="editUserDailyRate" type="number" step="0.01" min="0" value="${Number(profile.daily_rate || 0)}" placeholder="เช่น 500" style="width:100%;padding:9px 11px;border:1px solid #fbbf24;background:#fffbeb;border-radius:8px;font-size:13px;text-align:right;font-weight:700" />
            </label>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button id="editUserCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
          <button id="editUserOK" type="button" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">บันทึก</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = (val) => { m.remove(); resolve(val); };
    document.getElementById("editUserCancel")?.addEventListener("click", () => close(null));
    document.getElementById("editUserOK")?.addEventListener("click", () => {
      const full_name = (document.getElementById("editUserName")?.value || "").trim();
      const phone = (document.getElementById("editUserPhone")?.value || "").trim();
      const deptElem = document.getElementById("editUserDept");
      // dropdown ไม่ได้ render → คงค่าเดิม | "" = ถอดแผนกออก | "5" = แผนก id 5
      const department_id = deptElem
        ? (deptElem.value ? Number(deptElem.value) : null)
        : (profile.department_id ?? null);
      // Phase 77: pay_type + daily_rate
      const payTypeEl = document.querySelector('input[name="editUserPayType"]:checked');
      const pay_type = payTypeEl?.value || 'monthly';
      const daily_rate = pay_type === 'daily' ? Number(document.getElementById("editUserDailyRate")?.value || 0) : 0;
      close({ full_name, phone, department_id, pay_type, daily_rate });
    });
    // Phase 77: toggle daily rate field
    document.querySelectorAll('input[name="editUserPayType"]').forEach(r => {
      r.addEventListener('change', () => {
        const row = document.getElementById("editUserDailyRow");
        if (row) row.style.display = r.value === 'daily' && r.checked ? 'block' : (document.querySelector('input[name="editUserPayType"]:checked')?.value === 'daily' ? 'block' : 'none');
      });
    });
    m.addEventListener("click", e => { if (e.target === m) close(null); });
    setTimeout(() => document.getElementById("editUserName")?.focus(), 50);
  });
}


// ═══════════════════════════════════════════════════════════
//  DOCUMENT SETTINGS SUB-PAGE
// ═══════════════════════════════════════════════════════════
