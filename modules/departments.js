// ═══════════════════════════════════════════════════════════
//  DEPARTMENTS — ตั้งค่าแผนก (Phase 71)
//  CRUD แผนก + นับจำนวนพนักงานในแต่ละแผนก (admin only)
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

let _depts = [];
let _profiles = [];
let _editingId = null;

export async function renderDepartmentsPage(ctx) {
  const { state, showToast, requireAdmin } = ctx;
  const container = document.getElementById("page-departments");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "",
      retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  try {
    // Phase 75 fix: fetch profiles เองเพื่อให้ staffCount ถูกต้อง
    // (เดิมพึ่ง state.allProfiles ซึ่ง populate ตอน admin เข้า settings/users — ถ้ายังไม่เข้าจะเป็น [])
    const [dRes, pRes] = await Promise.all([
      fetch(cfg.url + "/rest/v1/departments?select=*&order=sort_order.asc,name.asc", { headers }),
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role,department_id", { headers })
    ]);
    if (!dRes.ok) {
      container.innerHTML = renderError({
        message: "ตาราง departments ยังไม่มีในฐานข้อมูล",
        detail: "รัน supabase-phase71-departments.sql ก่อน (HTTP " + dRes.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "depRetryBtn"
      });
      document.getElementById("depRetryBtn")?.addEventListener("click", () => renderDepartmentsPage(ctx));
      return;
    }
    _depts = await dRes.json();
    _profiles = pRes.ok ? await pRes.json() : (state.allProfiles || []);
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "depRetryBtn"
    });
    document.getElementById("depRetryBtn")?.addEventListener("click", () => renderDepartmentsPage(ctx));
    return;
  }

  const staffCount = (deptId) => _profiles.filter(p => String(p.department_id) === String(deptId)).length;

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#dcfce7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🏢</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ตั้งค่าแผนก</h2>
        <p style="margin:0;color:#475569;font-size:13px">จัดกลุ่มพนักงาน — ใช้คำนวณเงินเดือน + รายงาน</p>
      </div>

      <div class="panel" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f1f5f9">
          <div style="font-weight:700;color:#0f172a">แผนกในธุรกิจของคุณ (${_depts.length})</div>
          <button id="depAddBtn" class="btn primary" style="font-size:13px">+ เพิ่มแผนก</button>
        </div>

        ${_depts.length === 0 ? renderEmpty({
          icon: "🏢",
          title: "ยังไม่มีแผนก",
          message: "เพิ่มแผนกแรกเพื่อจัดกลุ่มพนักงาน",
          actionLabel: "+ เพิ่มแผนก",
          actionId: "depEmptyAddBtn"
        }) : `
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f8fafc">
              <tr>
                <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569;width:120px">รหัสแผนก</th>
                <th style="padding:10px 14px;text-align:left;font-weight:700;color:#475569">ชื่อแผนก</th>
                <th style="padding:10px 14px;text-align:right;font-weight:700;color:#475569;width:140px">จำนวนพนักงาน</th>
                <th style="padding:10px 14px;width:120px"></th>
              </tr>
            </thead>
            <tbody>
              ${_depts.map(d => {
                const cnt = staffCount(d.id);
                return `
                  <tr style="border-bottom:1px solid #f1f5f9;${d.is_active === false ? 'opacity:.5' : ''}">
                    <td style="padding:10px 14px;font-family:ui-monospace,monospace;font-weight:700;color:#0c4a6e">${escHtml(d.code)}</td>
                    <td style="padding:10px 14px">
                      <div style="font-weight:600">${escHtml(d.name)}</div>
                      ${d.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${escHtml(d.description)}</div>` : ''}
                    </td>
                    <td style="padding:10px 14px;text-align:right;font-weight:700;color:${cnt>0?'#0284c7':'#94a3b8'}">${cnt}</td>
                    <td style="padding:10px 14px;text-align:right;white-space:nowrap">
                      <button class="btn light dep-edit-btn" data-id="${d.id}" style="padding:5px 10px;font-size:12px">แก้ไข</button>
                      <button class="btn dep-del-btn" data-id="${d.id}" data-name="${escHtml(d.name)}" data-cnt="${cnt}" style="padding:5px 10px;font-size:12px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;cursor:pointer">ลบ</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `;

  // ── Bindings ──
  document.getElementById("depAddBtn")?.addEventListener("click", () => _openDeptModal(ctx, null));
  document.getElementById("depEmptyAddBtn")?.addEventListener("click", () => _openDeptModal(ctx, null));
  container.querySelectorAll(".dep-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const d = _depts.find(x => String(x.id) === String(btn.dataset.id));
    if (d) _openDeptModal(ctx, d);
  }));
  container.querySelectorAll(".dep-del-btn").forEach(btn => btn.addEventListener("click", () => _deleteDept(ctx, btn.dataset.id, btn.dataset.name, Number(btn.dataset.cnt))));
}

function _openDeptModal(ctx, dept) {
  document.getElementById("depModal")?.remove();
  const isEdit = !!dept;
  const m = document.createElement("div");
  m.id = "depModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:440px;width:100%;padding:22px">
      <h3 style="margin:0 0 14px;font-size:17px;color:#0f172a">${isEdit ? '✏️ แก้ไขแผนก' : '+ เพิ่มแผนก'}</h3>
      <div style="display:grid;gap:10px">
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">รหัสแผนก *</div>
          <input id="depCode" type="text" maxlength="16" value="${escHtml(dept?.code || '')}" placeholder="เช่น 01, AC, MGT" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-family:ui-monospace,monospace" />
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ชื่อแผนก *</div>
          <input id="depName" type="text" maxlength="80" value="${escHtml(dept?.name || '')}" placeholder="เช่น ช่างแอร์ / กรรมการ" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">รายละเอียด (optional)</div>
          <input id="depDesc" type="text" maxlength="200" value="${escHtml(dept?.description || '')}" placeholder="คำอธิบายเพิ่มเติม" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px">
          <input id="depActive" type="checkbox" ${dept?.is_active === false ? '' : 'checked'} />
          <span>เปิดใช้งาน (ปิด = ซ่อนจาก dropdown แต่ข้อมูลเดิมยังอยู่)</span>
        </label>
      </div>
      <div id="depModalStatus" style="margin-top:10px;font-size:12px;color:#dc2626;min-height:14px"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button id="depModalCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
        <button id="depModalSave" type="button" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">${isEdit ? '💾 บันทึก' : '+ เพิ่มแผนก'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("depModalCancel")?.addEventListener("click", () => m.remove());
  document.getElementById("depModalSave")?.addEventListener("click", () => _saveDept(ctx, dept));
  setTimeout(() => document.getElementById("depCode")?.focus(), 50);
}

async function _saveDept(ctx, existing) {
  const m = document.getElementById("depModal");
  const statusEl = document.getElementById("depModalStatus");
  const setErr = (msg) => { if (statusEl) statusEl.textContent = msg; };
  setErr("");

  const code = (document.getElementById("depCode")?.value || "").trim();
  const name = (document.getElementById("depName")?.value || "").trim();
  const desc = (document.getElementById("depDesc")?.value || "").trim() || null;
  const active = !!document.getElementById("depActive")?.checked;
  if (!code) { setErr("กรอกรหัสแผนก"); return; }
  if (!name) { setErr("กรอกชื่อแผนก"); return; }

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  const headers = { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer": "return=representation" };
  const payload = { code, name, description: desc, is_active: active };

  const btn = document.getElementById("depModalSave");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "⏳ บันทึก...";

  try {
    let resp;
    if (existing?.id) {
      resp = await fetch(cfg.url + "/rest/v1/departments?id=eq." + existing.id, { method: "PATCH", headers, body: JSON.stringify(payload) });
    } else {
      payload.sort_order = (_depts.reduce((m, d) => Math.max(m, d.sort_order || 0), 0)) + 1;
      resp = await fetch(cfg.url + "/rest/v1/departments", { method: "POST", headers, body: JSON.stringify(payload) });
    }
    if (!resp.ok) {
      const txt = await resp.text();
      if (txt.includes("duplicate") || txt.includes("23505")) throw new Error("รหัส \"" + code + "\" มีอยู่แล้ว");
      throw new Error("HTTP " + resp.status + " " + txt.slice(0, 200));
    }
    m?.remove();
    ctx.showToast?.(existing ? "แก้ไขแผนกแล้ว" : "เพิ่มแผนกแล้ว");
    renderDepartmentsPage(ctx);
  } catch(e) {
    setErr(e.message || String(e));
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function _deleteDept(ctx, id, name, cnt) {
  let msg = `ลบแผนก "${name}" ?`;
  if (cnt > 0) msg += ` (มีพนักงาน ${cnt} คนอยู่ในแผนกนี้ — หลังลบจะไม่ถูกระบุแผนก)`;
  if (!(await window.App?.confirm?.(msg))) return;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/departments?id=eq." + id, {
      method: "DELETE",
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer": "return=representation" }
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    ctx.showToast?.("ลบแผนกแล้ว");
    renderDepartmentsPage(ctx);
  } catch(e) {
    ctx.showToast?.("ลบไม่สำเร็จ: " + (e.message || e));
  }
}
