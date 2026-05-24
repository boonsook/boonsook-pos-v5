// ═══════════════════════════════════════════════════════════
//  modules/time_clock.js — ลงเวลาเข้า-ออกงาน (Phase 92.22 + 92.22e)
//
//  Phase 92.22e: pivot จาก staff → profiles (auth.users)
//    - dropdown = state.allProfiles (filter role≠customer)
//    - clock-in stores user_id (auth.uid), ไม่ใช่ staff_id
//    - self-service ทำงานทันทีสำหรับ user ที่ login (ไม่ต้อง auto-claim email)
//
//  Role-based render (จาก state.profile.role):
//    - admin       → Manager view: dropdown ทุก user (admin/sales/technician)
//                    + active sessions card + history report + Export
//    - sales/tech  → Self-service view: ปุ่มเข้า/ออกของตัวเอง + week history
//
//  DB: ต้องรัน supabase-phase92-22e-use-profiles.sql ก่อนใช้
//      (ALTER staff_attendance: staff_id → user_id; RECREATE indexes/policies)
// ═══════════════════════════════════════════════════════════

import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix } from "./utils.js";

const TZ = "Asia/Bangkok";

// role labels (mirror main.js ROLE_LABELS)
const ROLE_LABEL_TH = {
  admin:      "ผู้ดูแลระบบ",
  technician: "ช่าง",
  sales:      "พนักงานขาย",
  customer:   "ลูกค้า",
};

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
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * แปลง timestamp เป็น HH:mm (Asia/Bangkok) สำหรับแสดงผล
 * @param {string|Date|null} ts
 * @returns {string} "08:15" หรือ "-" ถ้า null/invalid
 */
export function timeBangkok(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return "-";
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
 * @returns {"open"|"closed"|"none"}
 */
export function clockState(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "none";
  const latest = rows[0];
  if (latest && latest.clock_out_at == null) return "open";
  return "closed";
}

/**
 * Sum ชั่วโมงทั้งหมดจาก rows (ใช้กับ week summary)
 */
export function sumWorkHours(rows) {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const r of rows) total += workHours(r);
  return Math.round(total * 100) / 100;
}

/**
 * แสดงชื่อ user เป็น display name — full_name > email prefix > "ผู้ใช้ใหม่"
 * (mirror logic จาก modules/settings/users.js สำหรับ consistency)
 * @param {{full_name?:string|null, email?:string|null}} profile
 * @returns {string}
 */
export function profileDisplayName(profile) {
  if (!profile) return "—";
  if (profile.full_name && String(profile.full_name).trim()) return String(profile.full_name).trim();
  if (profile.email) return String(profile.email).split("@")[0];
  return "ผู้ใช้ใหม่";
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

/**
 * คืน list of profiles ที่ทำงานในร้าน (filter ลูกค้าออก)
 * ★ ใช้ state.allProfiles ตรง ๆ (already loaded ใน boot) — ไม่ต้อง fetch ใหม่
 */
function _staffProfiles(state) {
  return (state?.allProfiles || []).filter(p => p && p.role && p.role !== "customer");
}

async function _fetchAttendance({ userId, fromDate, toDate, openOnly } = {}) {
  const cfg = window.SUPABASE_CONFIG;
  const parts = ["select=*", "order=clock_in_at.desc"];
  if (userId)   parts.push(`user_id=eq.${encodeURIComponent(userId)}`);
  if (fromDate) parts.push(`work_date=gte.${encodeURIComponent(fromDate)}`);
  if (toDate)   parts.push(`work_date=lte.${encodeURIComponent(toDate)}`);
  if (openOnly) parts.push(`clock_out_at=is.null`);
  parts.push("limit=500");
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?${parts.join("&")}`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) {
    if (r.status === 404 || r.status === 400) {
      const err = new Error("NO_TABLE");
      err.code = "NO_TABLE";
      throw err;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

async function _insertClockIn({ userId, source = "admin", note, clientUuid }) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const body = {
    user_id: userId,
    work_date: workDateBangkok(),
    source,
    notes: note || null,
  };
  if (clientUuid) body.client_uuid = clientUuid;
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  if (!r.ok) {
    // 23505 unique_violation = ผู้ใช้คนนี้ยังมี open session
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

function _authUserId() {
  return window.App?.state?.currentUser?.id
    || window.currentUser?.id
    || null;
}

// ═══════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════

export async function renderTimeClockPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-time_clock");
  if (!container) return;

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });

  const role = state?.profile?.role || "sales";
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
            detail: "ผู้ดูแลระบบต้องรันไฟล์ <code>supabase-phase92-22-time-clock.sql</code> และ <code>supabase-phase92-22e-use-profiles.sql</code> ใน Supabase SQL Editor ก่อนใช้งาน",
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
let _mgrFilterUser = "all";

async function _renderManagerView(container, ctx) {
  const profiles = _staffProfiles(ctx.state);

  const [openSessions, rangeRows] = await Promise.all([
    _fetchAttendance({ openOnly: true }),
    _fetchAttendance({
      fromDate: _mgrFilterFrom,
      toDate: _mgrFilterTo,
      userId: _mgrFilterUser !== "all" ? _mgrFilterUser : null,
    }),
  ]);

  // map id → profile (เพื่อแสดงชื่อใน rows)
  const profMap = {};
  profiles.forEach(p => { profMap[p.id] = p; });

  const openCard = openSessions.length
    ? openSessions.map(s => {
        const p = profMap[s.user_id];
        const name = profileDisplayName(p);
        const roleTh = ROLE_LABEL_TH[p?.role] || p?.role || "";
        return `
          <div class="tc-open-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;margin-bottom:8px">
            <div>
              <div style="font-weight:700;color:#065f46">👤 ${escHtml(name)} ${roleTh ? `<span style="font-size:11px;color:#047857;font-weight:500">· ${escHtml(roleTh)}</span>` : ''}</div>
              <div style="font-size:12px;color:#047857">เข้างาน ${timeBangkok(s.clock_in_at)} • ${escHtml(s.source)}</div>
            </div>
            <button class="btn" data-clock-out-id="${s.id}" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600">🏃 ลงเวลาออก</button>
          </div>`;
      }).join("")
    : `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">— ยังไม่มีผู้ใช้เข้างาน —</div>`;

  const userOptions = profiles.map(p => {
    const name = profileDisplayName(p);
    const roleTh = ROLE_LABEL_TH[p.role] || p.role;
    return `<option value="${escHtml(p.id)}">${escHtml(name)} (${escHtml(roleTh)})</option>`;
  }).join("");

  const filterUserOptions = `<option value="all">ทุกคน</option>` + profiles.map(p => {
    const name = profileDisplayName(p);
    return `<option value="${escHtml(p.id)}" ${String(_mgrFilterUser) === String(p.id) ? 'selected' : ''}>${escHtml(name)}</option>`;
  }).join("");

  const reportRows = rangeRows.map(r => {
    const p = profMap[r.user_id];
    const name = profileDisplayName(p);
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
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">➕ ลงเวลาเข้างาน (กดให้ผู้ใช้)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="tcUserSelect" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1">
            ${userOptions || '<option value="">— ยังไม่มีผู้ใช้ในระบบ —</option>'}
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
          <button id="tcExportBtn" class="btn light" style="font-size:12px">📥 Export</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label style="font-size:12px;color:#64748b">จาก</label>
          <input type="date" id="tcFilterFrom" value="${escHtml(_mgrFilterFrom)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <label style="font-size:12px;color:#64748b">ถึง</label>
          <input type="date" id="tcFilterTo" value="${escHtml(_mgrFilterTo)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <select id="tcFilterUser" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1">
            ${filterUserOptions}
          </select>
          <button id="tcApplyFilter" class="btn light" style="font-size:12px">🔍 ค้นหา</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
                <th style="padding:9px 10px;text-align:left;width:100px">วันที่</th>
                <th style="padding:9px 10px;text-align:left">ผู้ใช้</th>
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
    const userId = document.getElementById("tcUserSelect")?.value?.trim() || "";
    const note = document.getElementById("tcNoteInput")?.value?.trim() || null;
    if (!userId) { ctx.showToast?.("เลือกผู้ใช้ก่อน"); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      await _insertClockIn({ userId, source: "admin", note });
      ctx.showToast?.("ลงเวลาเข้างานเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "ALREADY_OPEN") {
        ctx.showToast?.("⚠️ ผู้ใช้คนนี้ยังมี session เปิดอยู่ — ต้องลงเวลาออกก่อน");
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
    _mgrFilterUser = document.getElementById("tcFilterUser")?.value || "all";
    renderTimeClockPage(ctx);
  });

  document.getElementById("tcExportBtn")?.addEventListener("click", () => {
    const data = rangeRows.map(r => ({
      "วันที่": r.work_date,
      "ผู้ใช้": profileDisplayName(profMap[r.user_id]),
      "เข้างาน": timeBangkok(r.clock_in_at),
      "ออกงาน": timeBangkok(r.clock_out_at),
      "ชม.": workHours(r),
      "source": r.source,
      "หมายเหตุ": r.notes || "",
    }));
    const filename = `attendance_${_mgrFilterFrom}_${_mgrFilterTo}_${todaySuffix?.() || ''}.xlsx`;
    exportToExcel?.(filename, data, "Attendance");
  });
}

// ═══════════════════════════════════════════════════════════
//  Self-service view (sales/technician — ของตัวเอง)
// ═══════════════════════════════════════════════════════════

async function _renderSelfView(container, ctx) {
  const userId = _authUserId();
  if (!userId) {
    container.innerHTML = `
      <div class="panel" style="padding:24px;max-width:520px;margin:0 auto">
        <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px;color:#92400e;font-size:14px">
          <div style="font-weight:700;margin-bottom:6px">⚠️ ยังไม่ได้ login</div>
          <div>กรุณา login ก่อนใช้งานหน้านี้</div>
        </div>
      </div>`;
    return;
  }

  // หา profile ของตัวเอง (จาก state — ไม่ fetch)
  const me = (ctx.state?.allProfiles || []).find(p => p.id === userId)
    || ctx.state?.profile
    || { id: userId, email: ctx.state?.currentUser?.email || "" };

  // Fetch attendance ของตัวเอง 7 วันล่าสุด
  const today = workDateBangkok();
  const weekAgo = workDateBangkok(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const rows = await _fetchAttendance({ userId, fromDate: weekAgo, toDate: today });

  const state = clockState(rows);
  const open = state === "open" ? rows[0] : null;
  const weekHrs = sumWorkHours(rows.filter(r => r.clock_out_at != null));
  const myName = profileDisplayName(me);
  const myRoleTh = ROLE_LABEL_TH[me.role] || me.role || "-";

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
        <div style="font-size:11px;color:#94a3b8">ผู้ใช้งาน</div>
        <div style="font-size:20px;font-weight:800;color:#0284c7">👤 ${escHtml(myName)}</div>
        <div style="font-size:12px;color:#64748b">${escHtml(myRoleTh)}${me.email ? ' • ' + escHtml(me.email) : ''}</div>
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
      await _insertClockIn({ userId, source: "self" });
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
