// ═══════════════════════════════════════════════════════════
//  modules/time_clock.js — ลงเวลาเข้า-ออกงาน (Phase 92.22 + 92.23)
//
//  Role-based render:
//    - admin/accountant → Manager view: dropdown เลือก staff + ปุ่มเข้า/ออก
//      + active sessions card + history table + export CSV
//    - sales/technician (linked to staff via user_id) → Self-service view:
//      ปุ่มเข้า/ออกของตัวเอง + week history
//    - role อื่น / staff ไม่ link → กล่องแจ้งว่ายังไม่มีสิทธิ์/รอ admin link
//
//  DB: ต้องรัน supabase-phase92-22-time-clock.sql ก่อนใช้
//      (staff_attendance table + staff.user_id/email + RLS policies)
//
//  Auto-claim flow (Phase 92.23):
//    - user login (เช่น sales role) ครั้งแรก → page นี้ตรวจ
//      staff WHERE email=auth.email() AND user_id IS NULL → PATCH user_id=auth.uid()
//    - ครั้งถัดไป staff WHERE user_id=auth.uid() = link แล้ว → self-service view
// ═══════════════════════════════════════════════════════════

import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix } from "./utils.js";

const TZ = "Asia/Bangkok";

// ═══════════════════════════════════════════════════════════
//  Pure helpers (testable, no DOM/network)
// ═══════════════════════════════════════════════════════════

/**
 * คืน "วันที่ทำงาน" สำหรับ work_date ของ clock-in ใน Asia/Bangkok
 * @param {Date|string} [d] - default = now
 * @returns {string} YYYY-MM-DD
 */
export function workDateBangkok(d) {
  const date = d ? new Date(d) : new Date();
  // toLocaleDateString ใน th-TH-u-ca-gregory + Asia/Bangkok ให้ปฏิทินสากล + tz ถูก
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
  // en-CA → "2026-05-24" format โดย default
}

/**
 * แปลง timestamp เป็น HH:mm (Asia/Bangkok) สำหรับแสดงผล
 * @param {string|Date|null} ts
 * @returns {string} "08:15" หรือ "-" ถ้า null
 */
export function timeBangkok(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return "-"; // Invalid Date guard (Date ctor doesn't throw)
  try {
    return d.toLocaleTimeString("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit"
    });
  } catch { return "-"; }
}

/**
 * คำนวณชั่วโมงทำงานของ 1 record (ปัดเศษ 2 ตำแหน่ง)
 * @param {{clock_in_at:string|null, clock_out_at:string|null}} row
 * @returns {number} ชม. (0 ถ้ายังไม่ออก หรือ invalid)
 */
export function workHours(row) {
  if (!row?.clock_in_at || !row?.clock_out_at) return 0;
  const inMs  = new Date(row.clock_in_at).getTime();
  const outMs = new Date(row.clock_out_at).getTime();
  if (!isFinite(inMs) || !isFinite(outMs) || outMs <= inMs) return 0;
  return Math.round(((outMs - inMs) / 3600000) * 100) / 100;
}

/**
 * State ของ session ปัจจุบันจาก list rows (เรียงใหม่ → เก่า)
 * @param {Array} rows
 * @returns {"open"|"closed"|"none"} open=กำลังเข้าอยู่, closed=ออกแล้ว, none=ยังไม่เคยลง
 */
export function clockState(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "none";
  const latest = rows[0];
  if (latest && latest.clock_out_at == null) return "open";
  return "closed";
}

/**
 * Sum ชั่วโมงทั้งหมดจาก rows (ใช้กับ week summary)
 * @param {Array} rows
 * @returns {number}
 */
export function sumWorkHours(rows) {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const r of rows) total += workHours(r);
  return Math.round(total * 100) / 100;
}

/**
 * Eligibility ของการ auto-claim staff row ผ่าน email
 * Phase 92.23: ถ้า user login แล้ว แต่ staff row ยังไม่มี user_id → claim ได้
 * @param {{email:string|null, user_id:string|null}} staffRow
 * @param {{email:string|null, id:string|null}} authUser
 * @returns {boolean}
 */
export function canAutoClaim(staffRow, authUser) {
  if (!staffRow || !authUser) return false;
  if (staffRow.user_id) return false; // claim แล้ว
  if (!authUser.id) return false;
  if (!staffRow.email || !authUser.email) return false;
  return String(staffRow.email).trim().toLowerCase()
    === String(authUser.email).trim().toLowerCase();
}

// ═══════════════════════════════════════════════════════════
//  REST helpers (Supabase PostgREST)
// ═══════════════════════════════════════════════════════════

function _sbHeaders() {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg?.anonKey;
  return {
    apikey: cfg?.anonKey,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

async function _fetchStaffList() {
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff?select=id,name,phone,role,is_active,user_id,email&is_active=eq.true&order=name.asc`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function _fetchAttendance({ staffId, fromDate, toDate, openOnly } = {}) {
  const cfg = window.SUPABASE_CONFIG;
  const parts = ["select=*", "order=clock_in_at.desc"];
  if (staffId)  parts.push(`staff_id=eq.${encodeURIComponent(staffId)}`);
  if (fromDate) parts.push(`work_date=gte.${encodeURIComponent(fromDate)}`);
  if (toDate)   parts.push(`work_date=lte.${encodeURIComponent(toDate)}`);
  if (openOnly) parts.push(`clock_out_at=is.null`);
  parts.push("limit=500");
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?${parts.join("&")}`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) {
    if (r.status === 404 || r.status === 400) {
      // table ยังไม่มี → migration ไม่ได้ run
      const err = new Error("NO_TABLE");
      err.code = "NO_TABLE";
      throw err;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

async function _insertClockIn({ staffId, source = "admin", note, clientUuid }) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const body = {
    staff_id: staffId,
    work_date: workDateBangkok(),
    source,
    notes: note || null,
  };
  if (clientUuid) body.client_uuid = clientUuid;
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  if (!r.ok) {
    // 23505 = unique violation (มี open session อยู่แล้ว)
    if (r.status === 409) {
      const err = new Error("ALREADY_OPEN");
      err.code = "ALREADY_OPEN";
      throw err;
    }
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

async function _patchClockOut({ id }) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ clock_out_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

async function _findMyStaff() {
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff?select=*&user_id=eq.${encodeURIComponent(_authUserId() || "00000000-0000-0000-0000-000000000000")}&limit=1`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

async function _findStaffByEmail(email) {
  if (!email) return null;
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff?select=*&email=eq.${encodeURIComponent(email)}&user_id=is.null&limit=1`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

async function _claimStaff(staffId) {
  const cfg = window.SUPABASE_CONFIG;
  const r = await fetch(`${cfg.url}/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}&user_id=is.null`, {
    method: "PATCH",
    headers: { ..._sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ user_id: _authUserId() }),
  });
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

function _authUserId() {
  return window.App?.state?.currentUser?.id
    || window.currentUser?.id
    || null;
}

function _authEmail() {
  return window.App?.state?.currentUser?.email
    || window.currentUser?.email
    || null;
}

// ═══════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════

export async function renderTimeClockPage(ctx) {
  const { state: _state, showToast } = ctx;
  const container = document.getElementById("page-time_clock");
  if (!container) return;

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });

  const role = _state?.profile?.role || "sales";
  const isAdmin = role === "admin";

  try {
    if (isAdmin) {
      await _renderManagerView(container, ctx);
    } else {
      await _renderSelfView(container, ctx);
    }
  } catch (err) {
    if (err?.code === "NO_TABLE") {
      container.innerHTML = `
        <div class="panel" style="padding:24px">
          <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
          ${renderError({
            message: "ยังไม่ได้ติดตั้ง schema",
            detail: "ผู้ดูแลระบบต้องรันไฟล์ <code>supabase-phase92-22-time-clock.sql</code> ใน Supabase SQL Editor ก่อนใช้งานหน้านี้",
            retryLabel: "ลองอีกครั้ง",
            retryId: "tcRetryBtn",
          })}
        </div>`;
      document.getElementById("tcRetryBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));
      return;
    }
    console.error("[time_clock] render error:", err);
    container.innerHTML = `
      <div class="panel" style="padding:24px">
        <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
        ${renderError({
          message: "เกิดข้อผิดพลาด",
          detail: escHtml(err?.message || String(err)),
          retryLabel: "ลองอีกครั้ง",
          retryId: "tcRetryBtn",
        })}
      </div>`;
    document.getElementById("tcRetryBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));
    showToast?.("โหลดหน้าลงเวลาไม่สำเร็จ");
  }
}

// ═══════════════════════════════════════════════════════════
//  Manager view (admin)
// ═══════════════════════════════════════════════════════════

let _mgrFilterFrom = workDateBangkok();
let _mgrFilterTo   = workDateBangkok();
let _mgrFilterStaff = "all";

async function _renderManagerView(container, ctx) {
  const [staffList, openSessions, rangeRows] = await Promise.all([
    _fetchStaffList(),
    _fetchAttendance({ openOnly: true }),
    _fetchAttendance({ fromDate: _mgrFilterFrom, toDate: _mgrFilterTo,
      staffId: _mgrFilterStaff !== "all" ? _mgrFilterStaff : null }),
  ]);

  const staffMap = {};
  staffList.forEach(s => { staffMap[s.id] = s; });

  const openCard = openSessions.length
    ? openSessions.map(s => {
        const name = staffMap[s.staff_id]?.name || `#${s.staff_id}`;
        return `
          <div class="tc-open-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;margin-bottom:8px">
            <div>
              <div style="font-weight:700;color:#065f46">👤 ${escHtml(name)}</div>
              <div style="font-size:12px;color:#047857">เข้างาน ${timeBangkok(s.clock_in_at)} • ${escHtml(s.source)}</div>
            </div>
            <button class="btn" data-clock-out-id="${s.id}" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600">🏃 ลงเวลาออก</button>
          </div>`;
      }).join("")
    : `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">— ยังไม่มีพนักงานเข้างาน —</div>`;

  const staffOptions = staffList.map(s =>
    `<option value="${s.id}">${escHtml(s.name)} ${s.role ? `(${escHtml(s.role)})` : ''}</option>`
  ).join("");

  const filterStaffOptions = `<option value="all">ทุกคน</option>` + staffList.map(s =>
    `<option value="${s.id}" ${String(_mgrFilterStaff) === String(s.id) ? 'selected' : ''}>${escHtml(s.name)}</option>`
  ).join("");

  const reportRows = rangeRows.map(r => {
    const name = staffMap[r.staff_id]?.name || `#${r.staff_id}`;
    const hrs = workHours(r);
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 10px">${escHtml(r.work_date)}</td>
        <td style="padding:8px 10px">${escHtml(name)}</td>
        <td style="padding:8px 10px">${timeBangkok(r.clock_in_at)}</td>
        <td style="padding:8px 10px">${timeBangkok(r.clock_out_at)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600">${hrs ? hrs.toFixed(2) : '<span style="color:#94a3b8">— ยังไม่ออก —</span>'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#64748b">${escHtml(r.source)}</td>
      </tr>`;
  }).join("");

  const totalHrs = sumWorkHours(rangeRows);

  container.innerHTML = `
    <div class="panel" style="padding:20px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h3 style="margin:0;flex:1">🕒 ลงเวลาทำงาน <span style="font-size:12px;color:#94a3b8;font-weight:400">(ผู้ดูแลระบบ)</span></h3>
        <button id="tcRefreshBtn" class="btn light" style="font-size:12px">🔄 รีเฟรช</button>
      </div>

      <!-- Section 1: กำลังทำงานอยู่ตอนนี้ -->
      <div style="margin-bottom:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:8px">⏱️ กำลังทำงาน (${openSessions.length})</div>
        ${openCard}
      </div>

      <!-- Section 2: ลงเวลาเข้างาน -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">➕ ลงเวลาเข้างาน (กดให้พนักงาน)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="tcStaffSelect" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1">
            ${staffOptions}
          </select>
          <input id="tcNoteInput" placeholder="หมายเหตุ (ถ้ามี)" style="flex:1;min-width:160px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1" />
          <button id="tcClockInBtn" class="btn primary" style="padding:8px 18px">✅ บันทึกเข้างาน</button>
        </div>
      </div>

      <!-- Section 3: รายงาน -->
      <div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <div style="font-weight:700;font-size:14px;flex:1">📊 รายงาน</div>
          <span style="font-size:11px;color:#64748b">รวม ${totalHrs.toFixed(2)} ชม. (${rangeRows.length} record)</span>
          <button id="tcExportBtn" class="btn light" style="font-size:12px">📥 Export CSV</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label style="font-size:12px;color:#64748b">จาก</label>
          <input type="date" id="tcFilterFrom" value="${escHtml(_mgrFilterFrom)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <label style="font-size:12px;color:#64748b">ถึง</label>
          <input type="date" id="tcFilterTo" value="${escHtml(_mgrFilterTo)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <select id="tcFilterStaff" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1">
            ${filterStaffOptions}
          </select>
          <button id="tcApplyFilter" class="btn light" style="font-size:12px">🔍 ค้นหา</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
                <th style="padding:9px 10px;text-align:left;width:100px">วันที่</th>
                <th style="padding:9px 10px;text-align:left">พนักงาน</th>
                <th style="padding:9px 10px;text-align:left;width:80px">เข้า</th>
                <th style="padding:9px 10px;text-align:left;width:80px">ออก</th>
                <th style="padding:9px 10px;text-align:right;width:100px">ชม.</th>
                <th style="padding:9px 10px;text-align:left;width:80px">source</th>
              </tr>
            </thead>
            <tbody>
              ${reportRows || `<tr><td colspan="6" style="padding:0">${renderEmpty({
                icon: "📅",
                title: "ไม่มีรายการในช่วงนี้",
                message: "ลองขยายช่วงวันที่หรือเปลี่ยนตัวกรอง",
                actionLabel: "",
                actionId: "",
              })}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // ─── Bind events ───────────────────────────────────────────
  document.getElementById("tcRefreshBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));

  document.getElementById("tcClockInBtn")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    // ★ HOTFIX: staff.id เป็น uuid string — ห้าม Number() (จะเป็น NaN)
    const staffId = document.getElementById("tcStaffSelect")?.value?.trim() || "";
    const note = document.getElementById("tcNoteInput")?.value?.trim() || null;
    if (!staffId) { ctx.showToast?.("เลือกพนักงานก่อน"); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      await _insertClockIn({ staffId, source: "admin", note });
      ctx.showToast?.("ลงเวลาเข้างานเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "ALREADY_OPEN") {
        ctx.showToast?.("⚠️ พนักงานคนนี้ยังมี session เปิดอยู่ — ต้องลงเวลาออกก่อน");
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });

  document.querySelectorAll("[data-clock-out-id]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const id = Number(btn.dataset.clockOutId);
    if (!id) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳";
    try {
      await _patchClockOut({ id });
      ctx.showToast?.("ลงเวลาออกเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  }));

  document.getElementById("tcApplyFilter")?.addEventListener("click", () => {
    _mgrFilterFrom = document.getElementById("tcFilterFrom")?.value || _mgrFilterFrom;
    _mgrFilterTo   = document.getElementById("tcFilterTo")?.value   || _mgrFilterTo;
    _mgrFilterStaff = document.getElementById("tcFilterStaff")?.value || "all";
    renderTimeClockPage(ctx);
  });

  document.getElementById("tcExportBtn")?.addEventListener("click", () => {
    const data = rangeRows.map(r => ({
      "วันที่": r.work_date,
      "พนักงาน": staffMap[r.staff_id]?.name || `#${r.staff_id}`,
      "เข้างาน": timeBangkok(r.clock_in_at),
      "ออกงาน": timeBangkok(r.clock_out_at),
      "ชม.": workHours(r),
      "source": r.source,
      "หมายเหตุ": r.notes || "",
    }));
    exportToExcel?.(data, `attendance_${_mgrFilterFrom}_${_mgrFilterTo}_${todaySuffix?.() || ''}.csv`);
  });
}

// ═══════════════════════════════════════════════════════════
//  Self-service view (sales/technician + linked staff)
// ═══════════════════════════════════════════════════════════

/**
 * หา staff row ของ user ปัจจุบัน — ถ้ายังไม่ link พยายาม auto-claim ผ่าน email
 * @returns {Promise<object|null>} staff row หรือ null ถ้าไม่ผูกได้
 */
async function _resolveStaffForCurrentUser(ctx) {
  const direct = await _findMyStaff();
  if (direct) return direct;

  // Auto-claim (Phase 92.23) — ค้น staff ที่ email ตรงกับ auth user + ยังไม่มี user_id
  const email = _authEmail();
  if (!email) return null;
  const candidate = await _findStaffByEmail(email);
  if (!candidate || !canAutoClaim(candidate, { email, id: _authUserId() })) return null;
  const claimed = await _claimStaff(candidate.id);
  if (claimed) {
    ctx?.showToast?.("✅ ผูกบัญชีกับพนักงาน " + claimed.name + " แล้ว");
  }
  return claimed || null;
}

async function _renderSelfView(container, ctx) {
  // 1) หา staff row (ลอง direct lookup + auto-claim ใน 1 helper)
  const me = await _resolveStaffForCurrentUser(ctx);

  if (!me) {
    container.innerHTML = `
      <div class="panel" style="padding:24px;max-width:520px;margin:0 auto">
        <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px;color:#92400e;font-size:14px">
          <div style="font-weight:700;margin-bottom:6px">⚠️ ยังไม่มีสิทธิ์ใช้งาน</div>
          <div>บัญชีของคุณ (${escHtml(_authEmail() || '-')}) ยังไม่ผูกกับพนักงานคนใด — ติดต่อผู้ดูแลระบบให้ตั้งค่า email ของคุณในข้อมูลพนักงานก่อน</div>
        </div>
      </div>`;
    return;
  }

  // 3) Fetch attendance ของตัวเอง 7 วันล่าสุด
  const today = workDateBangkok();
  const weekAgo = workDateBangkok(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const rows = await _fetchAttendance({ staffId: me.id, fromDate: weekAgo, toDate: today });

  const state = clockState(rows);
  const open = state === "open" ? rows[0] : null;
  const weekHrs = sumWorkHours(rows.filter(r => r.clock_out_at != null));

  const historyRows = rows.length
    ? rows.map(r => `
        <tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 10px">${escHtml(r.work_date)}</td>
          <td style="padding:8px 10px">${timeBangkok(r.clock_in_at)}</td>
          <td style="padding:8px 10px">${timeBangkok(r.clock_out_at)}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:600">${r.clock_out_at ? workHours(r).toFixed(2) : '<span style="color:#10b981">กำลังทำ</span>'}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8">ยังไม่มีประวัติในสัปดาห์นี้</td></tr>`;

  container.innerHTML = `
    <div class="panel" style="padding:20px;max-width:680px;margin:0 auto">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:11px;color:#94a3b8">พนักงาน</div>
        <div style="font-size:20px;font-weight:800;color:#0284c7">👤 ${escHtml(me.name)}</div>
        <div style="font-size:12px;color:#64748b">${escHtml(me.role || '-')}${me.phone ? ' • ' + escHtml(me.phone) : ''}</div>
      </div>

      ${state === "open" ? `
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:18px;text-align:center;margin-bottom:14px">
          <div style="font-size:11px;color:#047857;font-weight:600">⏱️ กำลังทำงานอยู่</div>
          <div style="font-size:28px;font-weight:800;color:#065f46;font-family:monospace;margin:6px 0">เข้างาน ${timeBangkok(open.clock_in_at)}</div>
          <button id="tcSelfClockOut" class="btn" style="background:#ef4444;color:#fff;border:none;padding:12px 32px;font-size:16px;border-radius:10px;cursor:pointer;font-weight:700">🏃 ลงเวลาออก</button>
        </div>
      ` : `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px;text-align:center;margin-bottom:14px">
          <div style="font-size:11px;color:#1e40af;font-weight:600">วันนี้</div>
          <div style="font-size:14px;color:#3b82f6;margin:6px 0">${state === "closed" ? "ลงเวลาออกแล้ว — ต้องการเข้าใหม่?" : "ยังไม่ลงเวลาเข้าวันนี้"}</div>
          <button id="tcSelfClockIn" class="btn primary" style="padding:12px 32px;font-size:16px;border-radius:10px;font-weight:700">✅ ลงเวลาเข้างาน</button>
        </div>
      `}

      <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:11px;color:#64748b">ชั่วโมงทำงานสัปดาห์นี้ (7 วันล่าสุด)</div>
        <div style="font-size:22px;font-weight:800;color:#0f172a">${weekHrs.toFixed(2)} <span style="font-size:14px;color:#64748b;font-weight:400">ชม.</span></div>
      </div>

      <div>
        <div style="font-weight:700;font-size:14px;margin-bottom:8px">📅 ประวัติ 7 วันล่าสุด</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
                <th style="padding:9px 10px;text-align:left">วันที่</th>
                <th style="padding:9px 10px;text-align:left">เข้า</th>
                <th style="padding:9px 10px;text-align:left">ออก</th>
                <th style="padding:9px 10px;text-align:right">ชม.</th>
              </tr>
            </thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // ─── Bind events ───────────────────────────────────────────
  document.getElementById("tcSelfClockIn")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      await _insertClockIn({ staffId: me.id, source: "self" });
      ctx.showToast?.("ลงเวลาเข้างานเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "ALREADY_OPEN") {
        ctx.showToast?.("⚠️ คุณยังมี session เปิดอยู่ — ลงเวลาออกก่อน");
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });

  document.getElementById("tcSelfClockOut")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled || !open) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      await _patchClockOut({ id: open.id });
      ctx.showToast?.("ลงเวลาออกเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });
}
