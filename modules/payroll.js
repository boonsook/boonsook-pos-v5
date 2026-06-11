// ═══════════════════════════════════════════════════════════
//  STAFF PAYROLL — รายการเงินเดือน (Phase 72)
//  CRUD per employee per month + total = base + ot + welfare + bonus + commission - deductions
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix, dateBkk, logActivity } from "./utils.js";
// Phase 92.26: ดึงสรุป OT จาก Time Clock มาเติมในช่องค่าล่วงเวลา (auto-fill)
import { fetchUserAttendanceSummary, shiftHoursFromState } from "./time_clock.js";
// Phase 92.33: ดึงวันลา approved + suggest deduction (advisory)
import {
  fetchApprovedLeavesForUser,
  summarizeApprovedLeavesForPayroll,
  // Phase 92.35: quota helpers (graceful)
  fetchLeavePolicies,
  fetchLeaveOverridesForUser,
  calcBalancesForUser,
  defaultLeavePolicies,
  formatBalanceLabel,
  // Phase 92.36: paid leave policy decision (advisory)
  decidePayrollLeaveImpact,
  leaveDeductionNoteMarker,
  hasLeaveDeductionNoteMarker,
} from "./leave_management.js";

// ═══════════════════════════════════════════════════════════
//  Phase 92.43 — Pure helpers (testable, no DOM/network)
// ═══════════════════════════════════════════════════════════

/**
 * คำนวณ total_amount ของ payroll row (B1)
 *   formula: base_salary + overtime + welfare + bonus + commission - deductions
 *   ปัด 2 ตำแหน่งทศนิยม (money math safe)
 * @param {object} input
 * @returns {number}
 */
export function computePayrollTotal(input) {
  const i = input || {};
  const round2 = n => Math.round(n * 100) / 100;
  const base = Number(i.base_salary) || 0;
  const ot   = Number(i.overtime)    || 0;
  const wel  = Number(i.welfare)     || 0;
  const bon  = Number(i.bonus)       || 0;
  const com  = Number(i.commission)  || 0;
  const ded  = Number(i.deductions)  || 0;
  return round2(base + ot + wel + bon + com - ded);
}

/**
 * เลือก expense_date สำหรับ payroll ที่ mark paid (B2)
 *   ★ ใช้ Bangkok TZ — กัน off-by-1 ตอนเที่ยงคืน-06:59 ไทย (UTC 17:00-23:59 วันก่อน)
 * @param {Date|string} [when] - default = now
 * @returns {string} "YYYY-MM-DD" Bangkok local
 */
export function expenseDateForPaidPayroll(when) {
  return dateBkk(when || new Date());
}

/**
 * Guard: ตรวจว่า payroll สามารถลบได้หรือไม่ + ต้อง reverse expense ไหม (B3)
 * @param {object} payroll
 * @returns {{allowed:boolean, requiresReverse:boolean, expenseTag:string|null, reason:string}}
 */
export function canDeletePayroll(payroll) {
  if (!payroll || !payroll.id) {
    return { allowed: false, requiresReverse: false, expenseTag: null, reason: "ไม่พบรายการ" };
  }
  const tag = "#payroll-" + String(payroll.id);
  if (payroll.paid_at) {
    return {
      allowed: true,
      requiresReverse: true,
      expenseTag: tag,
      reason: `รายการนี้จ่ายแล้ว — รายจ่ายที่เชื่อมอยู่ (${tag}) จะถูกลบด้วย`,
    };
  }
  return { allowed: true, requiresReverse: false, expenseTag: tag, reason: "" };
}

// ═══════════════════════════════════════════════════════════
//  Phase 416 — Custom pay period (รอบตัดเงินเดือนที่ร้านกำหนด)
//  วันตัด cutoff1/cutoff2 (default 10/25):
//    รอบ A = วันที่ (cutoff1+1) ถึง cutoff2 ของเดือนเดียวกัน  (เช่น 11–25)
//    รอบ B = วันที่ (cutoff2+1) ถึง cutoff1 ของเดือนถัดไป     (เช่น 26–10)
//  ★ string math เท่านั้น — ห้าม toISOString บน local Date (ตี 0-6:59 ไทยจะเพี้ยนวัน)
// ═══════════════════════════════════════════════════════════

const TH_MONTHS_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// จำนวนวันในเดือน (m = 1-12) — Date.UTC deterministic ไม่ขึ้นกับ local timezone
function _daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const _pad2 = (n) => String(n).padStart(2, "0");
const _ymd = (y, m, d) => `${y}-${_pad2(m)}-${_pad2(d)}`;

// วันถัดจากวันตัด c ของเดือน (y,m) — c ชนวันสุดท้ายของเดือน (เช่น 28 ก.พ.) → วันที่ 1 เดือนถัดไป
function _dayAfterCut(y, m, c) {
  if (c >= _daysInMonth(y, m)) {
    return m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 };
  }
  return { y, m, d: c + 1 };
}

/**
 * Label ภาษาไทยของรอบจ่าย เช่น "11–25 มิ.ย. 69" / "26 พ.ค. – 10 มิ.ย. 69" / "26 ธ.ค. 68 – 10 ม.ค. 69"
 * @param {string} start "YYYY-MM-DD"
 * @param {string} end   "YYYY-MM-DD"
 * @returns {string}
 */
export function formatPayPeriodLabel(start, end) {
  const [sy, sm, sd] = String(start || "").split("-").map(Number);
  const [ey, em, ed] = String(end || "").split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return `${start || "?"} – ${end || "?"}`;
  const syTh = _pad2((sy + 543) % 100);
  const eyTh = _pad2((ey + 543) % 100);
  if (sy === ey && sm === em) return `${sd}–${ed} ${TH_MONTHS_ABBR[em - 1]} ${eyTh}`;
  if (sy === ey) return `${sd} ${TH_MONTHS_ABBR[sm - 1]} – ${ed} ${TH_MONTHS_ABBR[em - 1]} ${eyTh}`;
  return `${sd} ${TH_MONTHS_ABBR[sm - 1]} ${syTh} – ${ed} ${TH_MONTHS_ABBR[em - 1]} ${eyTh}`;
}

/**
 * คืนรอบจ่ายล่าสุด `count` รอบ (ใหม่ → เก่า) โดยรอบแรกคือรอบที่ refDate อยู่ข้างใน
 *   - cutoff ต้องเป็นจำนวนเต็ม 1–28 และ cutoff1 < cutoff2 — ผิดเงื่อนไข → fallback 10/25
 *   - refDate เป็น "YYYY-MM-DD" string (เทียบช่วงแบบ lexicographic = chronological)
 *   - คร่อมเดือน/คร่อมปีได้ และวันตัดชนปลายเดือนสั้น (ก.พ.) จะ clamp ไม่มี invalid date
 * @param {{cutoff1?:number, cutoff2?:number, refDate?:string, count?:number}} opts
 * @returns {Array<{start:string, end:string, label:string}>}
 */
export function computePayPeriods({ cutoff1, cutoff2, refDate, count } = {}) {
  let c1 = Number.isInteger(cutoff1) && cutoff1 >= 1 && cutoff1 <= 28 ? cutoff1 : 10;
  let c2 = Number.isInteger(cutoff2) && cutoff2 >= 1 && cutoff2 <= 28 ? cutoff2 : 25;
  if (c1 >= c2) { c1 = 10; c2 = 25; }
  const n = Number.isInteger(count) && count > 0 ? count : 3;
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(refDate || "")) ? String(refDate) : dateBkk(new Date());

  // สร้างรอบจาก (type, y, m):
  //   A(y,m): start = วันถัดจาก c1 ของ (y,m), end = min(c2, วันสุดท้ายเดือน) ของ (y,m)
  //   B(y,m): start = วันถัดจาก c2 ของ (y,m), end = min(c1, วันสุดท้ายเดือนถัดไป) ของเดือนถัดไป
  const buildPeriod = (type, y, m) => {
    if (type === "A") {
      const s = _dayAfterCut(y, m, c1);
      return { type, y, m, start: _ymd(s.y, s.m, s.d), end: _ymd(y, m, Math.min(c2, _daysInMonth(y, m))) };
    }
    const s = _dayAfterCut(y, m, c2);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return { type, y, m, start: _ymd(s.y, s.m, s.d), end: _ymd(ny, nm, Math.min(c1, _daysInMonth(ny, nm))) };
  };

  // หารอบที่ refDate อยู่ข้างใน — candidates ที่เป็นไปได้: A(y,m), B(y,m), B(เดือนก่อน)
  const [ry, rm] = ref.split("-").map(Number);
  const py = rm === 1 ? ry - 1 : ry;
  const pm = rm === 1 ? 12 : rm - 1;
  const candidates = [buildPeriod("A", ry, rm), buildPeriod("B", ry, rm), buildPeriod("B", py, pm)];
  const cur = candidates.find(p => p.start <= ref && ref <= p.end) || candidates[0];

  // เดินถอยหลัง: รอบก่อน A(y,m) = B(เดือนก่อน); รอบก่อน B(y,m) = A(y,m)
  const out = [];
  let p = cur;
  for (let i = 0; i < n; i++) {
    out.push({ start: p.start, end: p.end, label: formatPayPeriodLabel(p.start, p.end) });
    p = p.type === "A"
      ? buildPeriod("B", p.m === 1 ? p.y - 1 : p.y, p.m === 1 ? 12 : p.m - 1)
      : buildPeriod("A", p.y, p.m);
  }
  return out;
}

let _payrolls = [];
let _depts = [];
let _profiles = [];
// Phase 416: รอบจ่ายที่เลือก — init จาก computePayPeriods ใน renderPayrollPage ครั้งแรก
let _periodStart = null; // "YYYY-MM-DD"
let _periodEnd = null;   // "YYYY-MM-DD"
let _customPeriodOpen = false;
// _periodMonth = derived (เดือนของ _periodEnd) — สลิป/JV/expense/leave-summary เดิมยังอ่านค่านี้
let _periodMonth = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 7); // YYYY-MM (fallback ก่อน render แรกเท่านั้น)
})();
// Phase 416: ชั่วโมง OT ที่ auto-fill ล่าสุด (จากปุ่ม "→ เติม") — เก็บลง details.attendance
let _otAutofillHours = null;

const money = (n) => "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const moneyShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
};

export async function renderPayrollPage(ctx) {
  const { state: _state, showToast: _showToast, requireAdmin } = ctx;
  const container = document.getElementById("page-payroll");
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

  container.innerHTML = renderSkeleton({ type: "table", count: 5 });

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // Phase 416: รอบตัดจาก storeInfo (default 10/25) → ปุ่ม 3 รอบล่าสุด + กำหนดเอง
  const storeInfo = ctx.state?.storeInfo || {};
  const _cutoffOf = (v, dflt) => {
    const num = Number(v);
    return Number.isInteger(num) && num >= 1 && num <= 28 ? num : dflt;
  };
  const cutoff1 = _cutoffOf(storeInfo.payrollCutoff1, 10);
  const cutoff2 = _cutoffOf(storeInfo.payrollCutoff2, 25);
  const periods = computePayPeriods({ cutoff1, cutoff2, refDate: dateBkk(new Date()), count: 3 });
  if (!_periodStart || !_periodEnd) {
    _periodStart = periods[0].start;
    _periodEnd = periods[0].end;
  }
  _periodMonth = _periodEnd.slice(0, 7); // derived: เดือนของวันสิ้นรอบ — สลิป/JV/expense เดิมใช้ต่อ

  try {
    const [pRes, dRes, profRes] = await Promise.all([
      // Phase 416: โหลดรอบตรงตัว (eq ทั้ง start และ end — ไม่ใช่ overlap)
      fetch(cfg.url + `/rest/v1/staff_payroll?select=*&period_start=eq.${_periodStart}&period_end=eq.${_periodEnd}&order=id.desc`, { headers }),
      fetch(cfg.url + "/rest/v1/departments?select=*&is_active=eq.true&order=sort_order.asc", { headers }),
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role,department_id,pay_type,daily_rate&order=full_name.asc", { headers })
    ]);
    if (!pRes.ok) {
      const isAuth = pRes.status === 401 || pRes.status === 403;
      // Phase 416: owner ยังไม่รัน SQL เพิ่มคอลัมน์ → PostgREST ตอบ 400 (42703 unknown column / PGRST204)
      const errTxt = await pRes.text().catch(() => "");
      const missingPeriodCols = !isAuth && pRes.status === 400 &&
        (errTxt.includes("period_start") || errTxt.includes("period_end") || errTxt.includes("42703") || errTxt.includes("PGRST204"));
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + pRes.status + ")"
          : missingPeriodCols ? "ตาราง staff_payroll ยังไม่มีคอลัมน์รอบจ่าย (period_start/period_end)"
          : "ตาราง staff_payroll ยังไม่มีในฐานข้อมูล",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่"
          : missingPeriodCols ? "รัน supabase-phase416-payroll-period.sql ใน Supabase SQL Editor ก่อน (HTTP " + pRes.status + ")"
          : "รัน supabase-phase72-payroll.sql ก่อน (HTTP " + pRes.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "prRetryBtn"
      });
      document.getElementById("prRetryBtn")?.addEventListener("click", () => renderPayrollPage(ctx));
      return;
    }
    _payrolls = await pRes.json();
    _depts = dRes.ok ? await dRes.json() : [];
    _profiles = profRes.ok ? await profRes.json() : [];
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "prRetryBtn"
    });
    document.getElementById("prRetryBtn")?.addEventListener("click", () => renderPayrollPage(ctx));
    return;
  }

  // Stats
  const totalAmount = _payrolls.reduce((s, p) => s + Number(p.total_amount || 0), 0);
  const paidCount = _payrolls.filter(p => p.paid_at).length;
  const paidAmount = _payrolls.filter(p => p.paid_at).reduce((s, p) => s + Number(p.total_amount || 0), 0);

  // Group by department for summary
  const byDept = {};
  _payrolls.forEach(p => {
    const d = _depts.find(x => x.id === p.department_id);
    const key = d ? d.name : "ไม่ระบุ";
    byDept[key] = (byDept[key] || 0) + Number(p.total_amount || 0);
  });

  // Phase 416: แถบปุ่มรอบจ่ายล่าสุด 3 รอบ (จาก computePayPeriods) + กำหนดเอง
  const isCustomPeriod = !periods.some(p => p.start === _periodStart && p.end === _periodEnd);

  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">💰</div>
        <h2 style="margin:0 0 4px;color:#0f172a">รายการเงินเดือน</h2>
        <p style="margin:0;color:#475569;font-size:13px">บันทึก/แก้ไขเงินเดือน + จ่ายตามรอบที่ร้านกำหนด (ตัดวันที่ ${cutoff1} และ ${cutoff2})</p>
      </div>

      <!-- Period selector + actions (Phase 416: ปุ่มรอบจ่ายแทน month select) -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span style="font-weight:700;font-size:13px">📅 รอบจ่าย:</span>
          <div id="prPeriodBar" style="display:flex;gap:6px;flex-wrap:wrap">
            ${periods.map(p => {
              const active = !isCustomPeriod && p.start === _periodStart && p.end === _periodEnd;
              return `<button type="button" class="pr-period-btn" data-start="${p.start}" data-end="${p.end}"
                style="font-size:12px;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer;border:1px solid ${active ? '#0284c7' : '#cbd5e1'};background:${active ? '#e0f2fe' : '#fff'};color:${active ? '#0c4a6e' : '#475569'}">${escHtml(p.label)}</button>`;
            }).join("")}
            <button id="prCustomPeriodBtn" type="button"
              style="font-size:12px;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer;border:1px dashed ${isCustomPeriod ? '#7c3aed' : '#cbd5e1'};background:${isCustomPeriod ? '#f5f3ff' : '#fff'};color:${isCustomPeriod ? '#5b21b6' : '#475569'}">⚙️ กำหนดเอง${isCustomPeriod ? ': ' + escHtml(formatPayPeriodLabel(_periodStart, _periodEnd)) : ''}</button>
          </div>
          <button id="prExportBtn" class="btn light" style="font-size:13px">📥 Excel</button>
          <button id="prAddBtn" class="btn primary" style="margin-left:auto;font-size:13px">+ เพิ่มรายการเงินเดือน</button>
        </div>
        <div id="prCustomPeriodBox" style="display:${_customPeriodOpen ? 'flex' : 'none'};gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0">
          <label style="display:block">
            <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">จากวันที่</div>
            <input id="prCustomFrom" type="date" value="${_periodStart}" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
          </label>
          <label style="display:block">
            <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">ถึงวันที่</div>
            <input id="prCustomTo" type="date" value="${_periodEnd}" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
          </label>
          <button id="prCustomApplyBtn" type="button" class="btn primary" style="font-size:12px;padding:7px 14px">ใช้รอบนี้</button>
          <span id="prCustomErr" style="font-size:11px;color:#dc2626"></span>
        </div>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📋 จำนวนรายการ</div>
          <div class="stat-value" style="color:#0284c7">${_payrolls.length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">จ่ายแล้ว: ${paidCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 ยอดรวมรอบนี้ (${escHtml(formatPayPeriodLabel(_periodStart, _periodEnd))})</div>
          <div class="stat-value" style="color:#dc2626;font-size:22px">${money(totalAmount)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">✓ จ่ายไปแล้ว</div>
          <div class="stat-value" style="color:#059669;font-size:22px">${money(paidAmount)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">เหลือ ${money(totalAmount - paidAmount)}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed">
          <div class="stat-label">🏢 จำนวนแผนก</div>
          <div class="stat-value" style="color:#6d28d9">${Object.keys(byDept).length}</div>
        </div>
      </div>

      <!-- List -->
      <div class="panel" style="padding:0">
        ${_payrolls.length === 0 ? renderEmpty({
          icon: "💰",
          title: "ยังไม่มีรายการเงินเดือนรอบนี้",
          message: "กดปุ่ม + เพิ่มรายการเงินเดือนเพื่อเริ่มจ่ายพนักงาน",
          actionLabel: "+ เพิ่มรายการเงินเดือน",
          actionId: "prEmptyAddBtn"
        }) : `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead style="background:#f8fafc">
                <tr>
                  <th style="padding:10px;text-align:left;font-weight:700;color:#475569">พนักงาน</th>
                  <th style="padding:10px;text-align:left;font-weight:700;color:#475569">แผนก</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">เงินเดือน</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">OT</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">สวัสดิการ</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">โบนัส</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">คอม</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">หัก</th>
                  <th style="padding:10px;text-align:right;font-weight:700;color:#475569">รวมสุทธิ</th>
                  <th style="padding:10px;text-align:center;font-weight:700;color:#475569">สถานะ</th>
                  <th style="padding:10px;width:140px"></th>
                </tr>
              </thead>
              <tbody>
                ${_payrolls.map(p => {
                  const emp = _profiles.find(x => x.id === p.employee_id);
                  const dept = _depts.find(d => d.id === p.department_id);
                  return `
                    <tr style="border-bottom:1px solid #f1f5f9">
                      <td style="padding:8px 10px;font-weight:700">${escHtml(emp?.full_name || "(ไม่พบ)")}</td>
                      <td style="padding:8px 10px;color:#64748b">${escHtml(dept?.name || "-")}</td>
                      <td style="padding:8px 10px;text-align:right">${moneyShort(p.base_salary)}</td>
                      <td style="padding:8px 10px;text-align:right">${moneyShort(p.overtime)}</td>
                      <td style="padding:8px 10px;text-align:right">${moneyShort(p.welfare)}</td>
                      <td style="padding:8px 10px;text-align:right">${moneyShort(p.bonus)}</td>
                      <td style="padding:8px 10px;text-align:right">${moneyShort(p.commission)}</td>
                      <td style="padding:8px 10px;text-align:right;color:#dc2626">${moneyShort(p.deductions)}</td>
                      <td style="padding:8px 10px;text-align:right;font-weight:900;color:#0284c7">${money(p.total_amount)}</td>
                      <td style="padding:8px 10px;text-align:center">
                        ${p.paid_at
                          ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">✓ จ่ายแล้ว</span>`
                          : `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">รอจ่าย</span>`}
                      </td>
                      <td style="padding:8px 10px;text-align:right;white-space:nowrap">
                        <button class="btn pr-slip-btn" data-id="${p.id}" style="padding:4px 8px;font-size:11px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700" title="พิมพ์สลิปเงินเดือน">🖨️ สลิป</button>
                        ${!p.paid_at ? `<button class="btn pr-pay-btn" data-id="${p.id}" style="padding:4px 8px;font-size:11px;background:#10b981;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700">💸 จ่าย</button>` : ''}
                        <button class="btn light pr-edit-btn" data-id="${p.id}" style="padding:4px 8px;font-size:11px">แก้</button>
                        <button class="btn pr-del-btn" data-id="${p.id}" style="padding:4px 8px;font-size:11px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;cursor:pointer">ลบ</button>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;

  // Bindings
  // Phase 416: เลือกรอบจ่ายจากปุ่ม → set state แล้ว re-render (โหลดข้อมูลรอบนั้น)
  container.querySelectorAll(".pr-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _periodStart = btn.dataset.start;
    _periodEnd = btn.dataset.end;
    _customPeriodOpen = false;
    renderPayrollPage(ctx);
  }));
  document.getElementById("prCustomPeriodBtn")?.addEventListener("click", () => {
    _customPeriodOpen = !_customPeriodOpen;
    const box = document.getElementById("prCustomPeriodBox");
    if (box) box.style.display = _customPeriodOpen ? "flex" : "none";
  });
  document.getElementById("prCustomApplyBtn")?.addEventListener("click", () => {
    const from = document.getElementById("prCustomFrom")?.value || "";
    const to = document.getElementById("prCustomTo")?.value || "";
    const errEl = document.getElementById("prCustomErr");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      if (errEl) errEl.textContent = "เลือกวันที่ให้ครบทั้งสองช่อง";
      return;
    }
    if (from > to) {
      if (errEl) errEl.textContent = "วันเริ่มรอบต้องไม่เกินวันสิ้นรอบ";
      return;
    }
    _periodStart = from;
    _periodEnd = to;
    renderPayrollPage(ctx);
  });
  document.getElementById("prAddBtn")?.addEventListener("click", () => _openPayrollModal(ctx, null));
  document.getElementById("prEmptyAddBtn")?.addEventListener("click", () => _openPayrollModal(ctx, null));
  container.querySelectorAll(".pr-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const p = _payrolls.find(x => String(x.id) === String(btn.dataset.id));
    if (p) _openPayrollModal(ctx, p);
  }));
  container.querySelectorAll(".pr-del-btn").forEach(btn => btn.addEventListener("click", () => _deletePayroll(ctx, btn.dataset.id)));
  container.querySelectorAll(".pr-pay-btn").forEach(btn => btn.addEventListener("click", () => _markPaid(ctx, btn.dataset.id)));
  container.querySelectorAll(".pr-slip-btn").forEach(btn => btn.addEventListener("click", () => _printPayslip(ctx, btn.dataset.id)));
  document.getElementById("prExportBtn")?.addEventListener("click", () => _exportPayroll());
}

function _openPayrollModal(ctx, payroll) {
  document.getElementById("prModal")?.remove();
  const isEdit = !!payroll;
  // Phase 416: reset OT autofill snapshot ของ modal รอบนี้ (เก็บลง details ตอน save)
  _otAutofillHours = null;

  // Profiles ที่มี role !== customer (พนักงานเท่านั้น)
  const staffOnly = _profiles.filter(p => p.role !== "customer");

  const m = document.createElement("div");
  m.id = "prModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;padding:22px;max-height:90vh;overflow-y:auto">
      <h3 style="margin:0 0 14px;font-size:17px;color:#0f172a">${isEdit ? '✏️ แก้ไขรายการเงินเดือน' : '+ เพิ่มรายการเงินเดือน'}</h3>
      <div style="display:grid;gap:10px">
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">พนักงาน *</div>
          <select id="prEmp" ${isEdit ? 'disabled' : ''} style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="">— เลือกพนักงาน —</option>
            ${staffOnly.map(p => `<option value="${p.id}" ${payroll?.employee_id === p.id ? 'selected' : ''}>${escHtml(p.full_name || "(no name)")} ${p.role ? `(${p.role})` : ""}</option>`).join("")}
          </select>
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">แผนก</div>
          <select id="prDept" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="">— ไม่ระบุ —</option>
            ${_depts.map(d => `<option value="${d.id}" ${payroll?.department_id === d.id ? 'selected' : ''}>${escHtml(d.name)}</option>`).join("")}
          </select>
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">รอบจ่าย *</div>
          <!-- Phase 416: read-only — รอบมาจากปุ่มรอบบนหน้าหลัก (state _periodStart/_periodEnd) -->
          <div id="prPeriodDisplay" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;font-size:13px;font-weight:700;color:#0f172a">
            ${escHtml(formatPayPeriodLabel(_periodStart, _periodEnd))}
            <span style="font-weight:400;color:#64748b;font-size:11px">(${escHtml(_periodStart || "?")} → ${escHtml(_periodEnd || "?")} — เปลี่ยนรอบได้จากหน้าหลัก)</span>
          </div>
        </label>

        <!-- Phase 77: Daily-rate toggle + section -->
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;cursor:pointer">
          <input id="prDailyToggle" type="checkbox" ${payroll?.days_worked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer" />
          <span style="font-size:13px;color:#92400e;font-weight:700">🕐 คำนวณจากค่าจ้างรายวัน × จำนวนวัน</span>
        </label>
        <div id="prDailyBox" style="display:${payroll?.days_worked ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;background:#fffbeb;padding:10px;border-radius:8px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">ค่าจ้าง/วัน (บาท)</div>
            <input id="prDailyRate" type="number" step="0.01" min="0" value="${Number(payroll?.daily_rate || 0)}" style="width:100%;padding:8px 10px;border:1px solid #fbbf24;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">จำนวนวันทำงาน</div>
            <input id="prDaysWorked" type="number" step="1" min="0" max="31" value="${Number(payroll?.days_worked || 0)}" style="width:100%;padding:8px 10px;border:1px solid #fbbf24;border-radius:8px;text-align:right" />
          </label>
          <div style="grid-column:1/-1;font-size:11px;color:#78350f;text-align:center">
            💡 ค่าที่กรอกจะคำนวณลงช่อง "เงินเดือน" ด้านล่างอัตโนมัติ
          </div>
        </div>

        <!-- Phase 92.33 / 92.36: ดึงสรุปวันลาในรอบเดือน — policy-based advisory + manual apply -->
        <div id="prLeaveBox" style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;color:#9a3412;font-size:13px">🌴 วันลาในรอบเดือน <span style="font-size:11px;font-weight:400;color:#c2410c">(เดือนของวันสิ้นรอบ)</span></div>
            <button id="prFetchLeaveBtn" type="button" style="background:#ea580c;color:#fff;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">📥 ดึงสรุปวันลา</button>
          </div>
          <div id="prLeaveSummary" style="margin-top:8px;font-size:12px;color:#9a3412;min-height:18px">— กดปุ่ม "ดึงสรุปวันลา" หลังเลือกพนักงาน + เดือน —</div>

          <!-- Phase 92.36: policy-based breakdown (paid / over quota / unpaid) -->
          <div id="prLeavePolicyRow" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #fdba74">
            <div style="font-size:11px;color:#7c2d12;font-weight:700;margin-bottom:6px">🧮 Policy breakdown (advisory — admin ต้องกดยืนยันเอง):</div>
            <div id="prLeavePolicyBreakdown" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;font-size:11px"></div>
          </div>

          <!-- Phase 92.35: balance/quota usage (advisory — ดูภาพรวมทั้งปี) -->
          <div id="prLeaveBalanceRow" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #fdba74">
            <div style="font-size:11px;color:#7c2d12;font-weight:700;margin-bottom:6px">📊 ทั้งปี (advisory — ใช้ตัดสินใจหักเงิน):</div>
            <div id="prLeaveBalance" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;font-size:11px"></div>
          </div>

          <div id="prLeaveApplyRow" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #fdba74">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:12px;color:#7c2d12">
                แนะนำหัก: <strong id="prLeaveSuggestDed" style="color:#dc2626">฿0.00</strong>
                <span id="prLeaveSuggestSource" style="font-size:11px;color:#9a3412">—</span>
              </div>
              <button id="prFillLeaveBtn" type="button" style="background:#dc2626;color:#fff;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">→ เติมลงช่องหัก</button>
            </div>
            <!-- Phase 92.37: info เมื่อ note มี marker หักลาอยู่แล้ว (idempotent guard) -->
            <div id="prLeaveApplyInfo" style="display:none;margin-top:6px;padding:6px 8px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#78350f;font-weight:600"></div>
            <div style="font-size:10px;color:#9a3412;margin-top:4px;font-style:italic">★ ปุ่มนี้เป็นการ "แนะนำ" ไม่หักเงินอัตโนมัติ — admin ตรวจช่องหัก/หมายเหตุก่อนบันทึก</div>
          </div>
        </div>

        <!-- Phase 92.26: ดึงสรุป OT จาก Time Clock — auto-fill ค่าล่วงเวลา -->
        <div id="prOtFromClockBox" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;color:#166534;font-size:13px">🕒 ดึงจาก Time Clock <span style="font-size:11px;font-weight:400;color:#15803d">(ของรอบจ่ายนี้)</span></div>
            <button id="prFetchOtBtn" type="button" style="background:#16a34a;color:#fff;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">📥 ดึงสรุป</button>
          </div>
          <div id="prOtSummary" style="margin-top:8px;font-size:12px;color:#15803d;min-height:18px">— กดปุ่ม "ดึงสรุป" หลังเลือกพนักงาน + เดือน —</div>
          <div id="prOtCalcRow" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #bbf7d0">
            <div style="display:grid;grid-template-columns:repeat(2,1fr) auto;gap:8px;align-items:end">
              <label>
                <div style="font-size:11px;color:#15803d;font-weight:600;margin-bottom:3px">ค่า OT / ชม. (บาท)</div>
                <input id="prOtRate" type="number" step="1" min="0" value="0" style="width:100%;padding:6px 8px;border:1px solid #bbf7d0;border-radius:6px;text-align:right" />
              </label>
              <label>
                <div style="font-size:11px;color:#15803d;font-weight:600;margin-bottom:3px">ตัวคูณ (เช่น 1.5)</div>
                <input id="prOtMult" type="number" step="0.1" min="0" value="1.5" style="width:100%;padding:6px 8px;border:1px solid #bbf7d0;border-radius:6px;text-align:right" />
              </label>
              <button id="prFillOtBtn" type="button" style="background:#15803d;color:#fff;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">→ เติม</button>
            </div>
            <div style="font-size:11px;color:#166534;margin-top:6px"><span id="prOtCalcText">—</span></div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เงินเดือน</div>
            <input id="prBase" type="number" step="0.01" min="0" value="${Number(payroll?.base_salary || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ค่าล่วงเวลา</div>
            <input id="prOT" type="number" step="0.01" min="0" value="${Number(payroll?.overtime || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">สวัสดิการ</div>
            <input id="prWel" type="number" step="0.01" min="0" value="${Number(payroll?.welfare || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เงินพิเศษ/โบนัส</div>
            <input id="prBonus" type="number" step="0.01" min="0" value="${Number(payroll?.bonus || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">คอมมิชชัน</div>
            <input id="prCom" type="number" step="0.01" min="0" value="${Number(payroll?.commission || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">หัก (-)</div>
            <input id="prDed" type="number" step="0.01" min="0" value="${Number(payroll?.deductions || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;text-align:right" />
          </label>
        </div>
        <div style="background:#f0f9ff;padding:10px 12px;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;color:#0c4a6e;font-weight:700">รวมสุทธิที่ต้องจ่าย</span>
          <span id="prTotalDisplay" style="font-size:18px;font-weight:900;color:#0284c7">${money(payroll?.total_amount || 0)}</span>
        </div>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">หมายเหตุ</div>
          <input id="prNote" type="text" maxlength="200" value="${escHtml(payroll?.note || '')}" placeholder="optional" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
      </div>
      <div id="prModalStatus" style="margin-top:10px;font-size:12px;color:#dc2626;min-height:14px"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button id="prModalCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
        <button id="prModalSave" type="button" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">${isEdit ? '💾 บันทึก' : '+ บันทึก'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  // Live total calc
  const recalc = () => {
    const sum = ["prBase","prOT","prWel","prBonus","prCom"].reduce((s, id) => s + Number(document.getElementById(id)?.value || 0), 0);
    const ded = Number(document.getElementById("prDed")?.value || 0);
    const total = sum - ded;
    const el = document.getElementById("prTotalDisplay");
    if (el) el.textContent = money(total);
  };
  ["prBase","prOT","prWel","prBonus","prCom","prDed"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", recalc);
  });
  // Auto-fill department + daily rate from selected employee
  document.getElementById("prEmp")?.addEventListener("change", (e) => {
    const emp = _profiles.find(p => p.id === e.target.value);
    if (emp?.department_id) {
      const sel = document.getElementById("prDept");
      if (sel) sel.value = emp.department_id;
    }
    // Phase 77: ถ้าพนักงานเป็น daily — auto-toggle + fill rate
    if (emp?.pay_type === "daily") {
      const tog = document.getElementById("prDailyToggle");
      const rate = document.getElementById("prDailyRate");
      if (tog && !tog.checked) {
        tog.checked = true;
        document.getElementById("prDailyBox").style.display = "grid";
      }
      if (rate && !Number(rate.value)) rate.value = Number(emp.daily_rate || 0);
      recalcDaily();
    }
  });

  // Phase 77: Daily toggle + recalc base
  const recalcDaily = () => {
    const rate = Number(document.getElementById("prDailyRate")?.value || 0);
    const days = Number(document.getElementById("prDaysWorked")?.value || 0);
    const baseInp = document.getElementById("prBase");
    if (baseInp) baseInp.value = (rate * days).toFixed(2);
    recalc();
  };
  document.getElementById("prDailyToggle")?.addEventListener("change", (e) => {
    const box = document.getElementById("prDailyBox");
    if (box) box.style.display = e.target.checked ? "grid" : "none";
    if (!e.target.checked) {
      // ปิด daily mode → reset days_worked = 0 ตอนบันทึก (ใช้เงินเดือนตรงๆ)
      const days = document.getElementById("prDaysWorked");
      if (days) days.value = 0;
    } else {
      recalcDaily();
    }
  });
  document.getElementById("prDailyRate")?.addEventListener("input", recalcDaily);
  document.getElementById("prDaysWorked")?.addEventListener("input", recalcDaily);

  // Phase 92.26: ดึงสรุป OT จาก Time Clock + auto-fill ค่าล่วงเวลา
  const fetchOtBtn = document.getElementById("prFetchOtBtn");
  let _otSummary = null; // เก็บผลล่าสุดเพื่อให้ปุ่ม "เติม" คำนวณซ้ำได้
  fetchOtBtn?.addEventListener("click", async () => {
    if (fetchOtBtn.disabled) return;
    const empId = document.getElementById("prEmp")?.value || "";
    if (!empId) { _setOtSummaryError("เลือกพนักงานก่อน"); return; }
    if (!_periodStart || !_periodEnd) { _setOtSummaryError("เลือกรอบจ่ายก่อน"); return; }
    fetchOtBtn.disabled = true;
    const orig = fetchOtBtn.textContent;
    fetchOtBtn.textContent = "⏳ กำลังดึง...";
    // Phase 416: ดึงตามช่วงรอบจ่ายจริง (custom pay period) แทนขอบเดือน
    // fetchUserAttendanceSummary รับ (userId, fromDate, toDate, shiftOpts) ช่วง custom ได้อยู่แล้ว
    const fromDate = _periodStart;
    const toDate = _periodEnd;
    try {
      const shiftOpts = shiftHoursFromState(ctx.state);
      const summary = await fetchUserAttendanceSummary(empId, fromDate, toDate, shiftOpts);
      _otSummary = summary;
      if (summary.error === "NO_TABLE") {
        _setOtSummaryError("⚠️ ยังไม่ได้ติดตั้ง schema Time Clock");
      } else {
        const el = document.getElementById("prOtSummary");
        if (el) {
          const openHint = summary.openCount > 0 ? ` <span style="color:#92400e">(+ ${summary.openCount} ยังไม่ออก)</span>` : "";
          el.innerHTML = `✅ ${summary.records} record • ปกติ <strong>${summary.regular.toFixed(2)}</strong> ชม. • OT <strong style="color:#c2410c">${summary.ot.toFixed(2)}</strong> ชม. ${openHint}`;
        }
        // เปิด section คำนวณ + เดา rate จาก daily_rate ของพนักงาน (÷ 8 hr)
        const calcRow = document.getElementById("prOtCalcRow");
        if (calcRow) calcRow.style.display = "block";
        const emp = _profiles.find(p => p.id === empId);
        const dailyRate = Number(emp?.daily_rate || 0);
        const guessRate = dailyRate > 0 ? Math.round(dailyRate / 8) : 0;
        const rateInp = document.getElementById("prOtRate");
        if (rateInp && Number(rateInp.value) === 0) rateInp.value = guessRate;
        _recalcOtAmount();
      }
    } catch (e) {
      _setOtSummaryError("ดึงไม่สำเร็จ: " + (e?.message || "unknown"));
    } finally {
      if (fetchOtBtn.isConnected) { fetchOtBtn.disabled = false; fetchOtBtn.textContent = orig; }
    }
  });

  function _setOtSummaryError(msg) {
    const el = document.getElementById("prOtSummary");
    if (el) el.innerHTML = `<span style="color:#dc2626">${escHtml(msg)}</span>`;
  }

  function _recalcOtAmount() {
    if (!_otSummary) return;
    const rate = Number(document.getElementById("prOtRate")?.value || 0);
    const mult = Number(document.getElementById("prOtMult")?.value || 1.5);
    const amount = Math.round(_otSummary.ot * rate * mult * 100) / 100;
    const el = document.getElementById("prOtCalcText");
    if (el) el.textContent = `${_otSummary.ot.toFixed(2)} ชม. × ${rate} × ${mult} = ${amount.toFixed(2)} บาท`;
    return amount;
  }
  document.getElementById("prOtRate")?.addEventListener("input", _recalcOtAmount);
  document.getElementById("prOtMult")?.addEventListener("input", _recalcOtAmount);

  document.getElementById("prFillOtBtn")?.addEventListener("click", () => {
    const amount = _recalcOtAmount();
    if (amount == null || !_otSummary) return;
    const otInput = document.getElementById("prOT");
    if (otInput) {
      otInput.value = amount.toFixed(2);
      otInput.dispatchEvent(new Event("input")); // trigger recalc total
      // Phase 416: snapshot ชั่วโมง OT ที่ auto-fill — เก็บลง details.attendance ตอน save
      _otAutofillHours = Number(_otSummary.ot) || 0;
    }
  });

  // ─── Phase 92.33 / 92.36: ดึงสรุปวันลา + policy decision (paid/over/unpaid) ─────
  const fetchLeaveBtn = document.getElementById("prFetchLeaveBtn");
  let _leaveDecision = null;     // ผลล่าสุดจาก decidePayrollLeaveImpact
  let _leaveBalanceMap = null;   // Map ทั้งปี — ใช้ recompute เมื่อ rate/salary เปลี่ยน
  let _leaveMonthSummary = null; // monthSummary จาก summarizeApprovedLeavesForPayroll

  function _setLeaveSummary(html, isError) {
    const el = document.getElementById("prLeaveSummary");
    if (el) el.innerHTML = isError
      ? `<span style="color:#dc2626">${html}</span>`
      : html;
  }

  function _hideLeaveApplyRow() {
    const row = document.getElementById("prLeaveApplyRow");
    if (row) row.style.display = "none";
    _leaveDecision = null;
  }

  function _hideLeaveBalanceRow() {
    const row = document.getElementById("prLeaveBalanceRow");
    if (row) row.style.display = "none";
  }

  function _hideLeavePolicyRow() {
    const row = document.getElementById("prLeavePolicyRow");
    if (row) row.style.display = "none";
  }

  // Phase 92.36: render policy breakdown cards (paid / over / unpaid / other)
  function _renderPolicyBreakdown(decision) {
    const row = document.getElementById("prLeavePolicyRow");
    const box = document.getElementById("prLeavePolicyBreakdown");
    if (!row || !box || !decision) return;
    const cells = [];
    const pushCell = (label, days, color) => {
      cells.push(`<div style="background:#fff;border:1px solid #fdba74;border-radius:8px;padding:6px 8px">
        <div style="font-size:10px;color:#9a3412;font-weight:700">${escHtml(label)}</div>
        <div style="font-size:14px;color:${color};font-weight:800;font-variant-numeric:tabular-nums">${Number(days).toLocaleString("th-TH")} วัน</div>
      </div>`);
    };
    pushCell("✅ Paid (in quota)",   decision.paidWithinQuotaDays, "#16a34a");
    pushCell("⚠️ เกิน quota",        decision.overQuotaDays,       decision.overQuotaDays > 0 ? "#ea580c" : "#94a3b8");
    pushCell("💸 ลาไม่รับค่าจ้าง",   decision.unpaidDays,          decision.unpaidDays    > 0 ? "#dc2626" : "#94a3b8");
    pushCell("📌 อื่น ๆ (ไม่หัก)",   decision.otherDays,           "#475569");
    pushCell("→ แนะนำหักรวม",        decision.deductibleDays,      decision.deductibleDays > 0 ? "#dc2626" : "#94a3b8");
    box.innerHTML = cells.join("");
    row.style.display = "block";
  }

  // Phase 92.36: load balance map ทั้งปี + return ให้ caller เอาไปใช้ตัดสินใจ
  async function _loadYearBalance(empId, periodInput) {
    const yearStr = (periodInput || "").slice(0, 4);
    const year = Number(yearStr);
    if (!Number.isFinite(year)) return { ok: false, map: null, year: null };
    try {
      const cfg = window.SUPABASE_CONFIG;
      if (!cfg?.url) return { ok: false, map: null, year };
      const token = window._sbAccessToken || cfg.anonKey;
      const headers = { apikey: cfg.anonKey, Authorization: "Bearer " + token };
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year}-12-31`;
      const url = `${cfg.url}/rest/v1/staff_leaves?select=*`
        + `&user_id=eq.${encodeURIComponent(empId)}`
        + `&start_date=lte.${encodeURIComponent(yearEnd)}`
        + `&end_date=gte.${encodeURIComponent(yearStart)}`
        + `&order=start_date.asc&limit=300`;
      const [leavesRes, polRes, ovrRes] = await Promise.all([
        fetch(url, { headers }).then(r => r.ok ? r.json() : []).catch(() => []),
        fetchLeavePolicies().catch(() => ({ ok: false })),
        fetchLeaveOverridesForUser(empId, year).catch(() => ({ ok: false })),
      ]);
      const policies = (polRes && polRes.ok && polRes.rows.length > 0) ? polRes.rows : defaultLeavePolicies();
      const overrides = (ovrRes && ovrRes.ok && Array.isArray(ovrRes.rows)) ? ovrRes.rows : [];
      const bMap = calcBalancesForUser({ userId: empId, year, leaves: leavesRes, policies, overrides });
      return { ok: true, map: bMap, year };
    } catch (_e) {
      return { ok: false, map: null, year };
    }
  }

  function _renderBalanceSection(bMap) {
    const balanceBox = document.getElementById("prLeaveBalance");
    const balanceRow = document.getElementById("prLeaveBalanceRow");
    if (!balanceBox || !balanceRow) return;
    if (!bMap) { balanceRow.style.display = "none"; return; }
    const order = ["vacation", "sick", "personal", "unpaid", "other"];
    const cells = order
      .map(t => bMap.get(t))
      .filter(b => b)
      .map(b => {
        const overOrWarn = b.overQuota ? "#dc2626" : b.willExceed ? "#ea580c" : "#7c2d12";
        const label = formatBalanceLabel(b);
        const typeLabel = ({
          vacation: "🌴 พักร้อน",
          sick: "🤒 ป่วย",
          personal: "📝 กิจ",
          unpaid: "💸 ไม่รับค่าจ้าง",
          other: "📌 อื่น ๆ",
        })[b.leaveType] || b.leaveType;
        return `<div style="background:#fff;border:1px solid #fdba74;border-radius:8px;padding:6px 8px">
          <div style="font-weight:700;color:${overOrWarn};font-size:11px">${escHtml(typeLabel)}</div>
          <div style="color:#7c2d12;font-size:11px;margin-top:2px">${escHtml(label)}</div>
        </div>`;
      });
    balanceBox.innerHTML = cells.join("") || `<div style="color:#9a3412">ไม่มีข้อมูล policy</div>`;
    balanceRow.style.display = "block";
  }

  // Phase 92.37: helper ปรับ state ปุ่ม "เติมลงช่องหัก" ตามว่า note มี marker อยู่แล้วหรือยัง
  //   - applied=true  → disable + label "✓ เติมแล้ว" + แสดง info "ตรวจพบรายการหักวันลาแล้ว"
  //   - applied=false → enable + label เดิม + ซ่อน info
  function _setLeaveApplyButtonState(applied, suggestedAmount) {
    const btn = document.getElementById("prFillLeaveBtn");
    const info = document.getElementById("prLeaveApplyInfo");
    if (btn) {
      if (applied) {
        btn.disabled = true;
        btn.textContent = "✓ เติมแล้ว";
        btn.style.background = "#94a3b8";
        btn.style.cursor = "not-allowed";
      } else {
        btn.disabled = false;
        btn.textContent = "→ เติมลงช่องหัก";
        btn.style.background = "#dc2626";
        btn.style.cursor = "pointer";
      }
    }
    if (info) {
      if (applied) {
        const amt = Number(suggestedAmount) > 0 ? ` ฿${Number(suggestedAmount).toFixed(2)}` : "";
        info.innerHTML = `ⓘ ตรวจพบรายการหักวันลาแล้ว (เติม${amt} ไว้แล้ว — แก้ช่องหัก/หมายเหตุก่อนบันทึก)`;
        info.style.display = "block";
      } else {
        info.style.display = "none";
      }
    }
  }

  // Recompute decision ตาม rate/salary ปัจจุบัน (เรียกเมื่อ admin แก้ base/dailyRate หลัง fetch)
  // Phase 92.41b HOTFIX: dailyRate ต้องอ่านจากช่อง "ค่าจ้าง/วัน" (prDailyRate) เท่านั้น
  //   - ห้ามสลับกับช่อง "จำนวนวันทำงาน" (prDaysWorked) — ต่างหน้าที่กัน
  //   - ห้าม fallback ไป emp.daily_rate ใน profile (อาจ stale/ผิด เช่น เคยใส่ hourly rate ผิด)
  //   - ถ้า daily mode OFF หรือ rate ว่าง → ส่ง dailyRate=0 ให้ helper ตก fallback ไป baseSalary÷30
  //
  // เหตุของ HOTFIX: production เจอเคส emp.daily_rate=13 (เก่า/ผิด) ทำให้ดูเหมือน
  //   suggestedDeduction = 2 × 13 = ฿26 ทั้งที่ user กรอก 400 ใน input → ควรเป็น 2 × 400 = ฿800
  function _refreshLeaveDecision() {
    if (!_leaveMonthSummary) { _hideLeaveApplyRow(); return; }
    const dailyOn   = document.getElementById("prDailyToggle")?.checked;
    const dailyInp  = Number(document.getElementById("prDailyRate")?.value || 0);
    // ★ ใช้ dailyInp ก็ต่อเมื่อ daily mode ON และ user กรอกค่า > 0 ใน "ค่าจ้าง/วัน" เท่านั้น
    //   อย่างอื่น = 0 (helper จะ fallback ไป baseSalary÷30 ภายในตัวเอง)
    const dailyRate = dailyOn && dailyInp > 0 ? dailyInp : 0;
    const baseSal   = Number(document.getElementById("prBase")?.value || 0);
    const decision = decidePayrollLeaveImpact({
      monthSummary: _leaveMonthSummary,
      balances:     _leaveBalanceMap,
      dailyRate,
      baseSalary:   baseSal,
    });
    _leaveDecision = decision;
    _renderPolicyBreakdown(decision);

    if (decision.deductibleDays <= 0 || decision.suggestedDeduction <= 0) {
      _hideLeaveApplyRow();
      return;
    }
    const segs = [];
    if (decision.unpaidDays    > 0) segs.push(`${decision.unpaidDays} ไม่รับค่าจ้าง`);
    if (decision.overQuotaDays > 0) segs.push(`${decision.overQuotaDays} เกิน quota`);
    const ratePart = dailyRate > 0
      ? `× ฿${dailyRate.toLocaleString("th-TH")}/วัน`
      : baseSal > 0
        ? `× เงินเดือน÷30`
        : `(ไม่มี rate/เงินเดือน)`;
    const sourceText = `(${decision.deductibleDays} วัน [${segs.join(" + ")}] ${ratePart})`;
    const amtEl = document.getElementById("prLeaveSuggestDed");
    const srcEl = document.getElementById("prLeaveSuggestSource");
    if (amtEl) amtEl.textContent = money(decision.suggestedDeduction);
    if (srcEl) srcEl.textContent = sourceText;
    const row = document.getElementById("prLeaveApplyRow");
    if (row) row.style.display = "block";

    // Phase 92.37: ถ้า note ของ record เดิมมี marker หักลาอยู่แล้ว → guard ปุ่ม apply (disable + แจ้ง)
    const curNote = (document.getElementById("prNote")?.value || "").trim();
    const marker  = leaveDeductionNoteMarker(decision);
    const already = hasLeaveDeductionNoteMarker(curNote, marker);
    _setLeaveApplyButtonState(already, decision.suggestedDeduction);
  }

  fetchLeaveBtn?.addEventListener("click", async () => {
    if (fetchLeaveBtn.disabled) return;
    const empId = document.getElementById("prEmp")?.value || "";
    // Phase 416: prMonth (input) ถูกแทนด้วย read-only display — leave summary ยังคิดเป็น
    // "รายเดือน" (เดือนของวันสิ้นรอบ = _periodMonth derived) เหมือนพฤติกรรมเดิม
    const periodInput = _periodMonth || "";
    if (!empId)       { _setLeaveSummary("เลือกพนักงานก่อน", true); return; }
    if (!periodInput) { _setLeaveSummary("เลือกรอบจ่ายก่อน", true); return; }
    fetchLeaveBtn.disabled = true;
    const orig = fetchLeaveBtn.textContent;
    fetchLeaveBtn.textContent = "⏳ กำลังดึง...";
    // คำนวณ from/to เดือนนั้น
    const fromDate = periodInput + "-01";
    const [y, mo] = periodInput.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const toDate = `${periodInput}-${String(lastDay).padStart(2, "0")}`;
    try {
      // โหลด period leaves + year balance ขนาน (Phase 92.36)
      const [periodRes, balanceRes] = await Promise.all([
        fetchApprovedLeavesForUser(empId, fromDate, toDate),
        _loadYearBalance(empId, periodInput),
      ]);
      if (!periodRes.ok) {
        if (periodRes.code === "NO_TABLE") {
          _setLeaveSummary("⚠️ ยังไม่ได้ติดตั้งตารางวันลา (รัน supabase-phase92-32-leave-management.sql)", true);
        } else {
          _setLeaveSummary("ดึงไม่สำเร็จ: " + (periodRes.message || periodRes.code || "unknown"), true);
        }
        _hideLeaveApplyRow();
        _hideLeaveBalanceRow();
        _hideLeavePolicyRow();
        _leaveBalanceMap = null;
        _leaveMonthSummary = null;
        return;
      }
      _leaveBalanceMap   = balanceRes.ok ? balanceRes.map : null;
      _leaveMonthSummary = summarizeApprovedLeavesForPayroll(periodRes.rows);
      _renderBalanceSection(_leaveBalanceMap);

      if (_leaveMonthSummary.records === 0) {
        _setLeaveSummary("ไม่มีวันลาอนุมัติในรอบนี้");
        _hideLeaveApplyRow();
        _hideLeavePolicyRow();
        return;
      }

      // แสดง summary เดือนนี้
      const parts = [];
      parts.push(`✅ ${_leaveMonthSummary.records} record · รวม <strong>${_leaveMonthSummary.totalApprovedDays}</strong> วัน`);
      const breakdown = [];
      if (_leaveMonthSummary.sickDays     > 0) breakdown.push(`🤒 ป่วย ${_leaveMonthSummary.sickDays}`);
      if (_leaveMonthSummary.personalDays > 0) breakdown.push(`📝 กิจ ${_leaveMonthSummary.personalDays}`);
      if (_leaveMonthSummary.vacationDays > 0) breakdown.push(`🌴 พักร้อน ${_leaveMonthSummary.vacationDays}`);
      if (_leaveMonthSummary.unpaidDays   > 0) breakdown.push(`<strong style="color:#dc2626">💸 ไม่รับค่าจ้าง ${_leaveMonthSummary.unpaidDays}</strong>`);
      if (_leaveMonthSummary.otherDays    > 0) breakdown.push(`📌 อื่น ๆ ${_leaveMonthSummary.otherDays}`);
      if (breakdown.length > 0) parts.push(breakdown.join(" · "));
      _setLeaveSummary(parts.join("<br>"));

      // คำนวณ decision (Phase 92.36)
      _refreshLeaveDecision();
    } catch (e) {
      _setLeaveSummary("ดึงไม่สำเร็จ: " + (e?.message || "unknown"), true);
      _hideLeaveApplyRow();
      _hideLeavePolicyRow();
      _leaveBalanceMap = null;
      _leaveMonthSummary = null;
    } finally {
      if (fetchLeaveBtn.isConnected) { fetchLeaveBtn.disabled = false; fetchLeaveBtn.textContent = orig; }
    }
  });

  // Phase 92.36: เติม unpaid + overQuota deduction ลงช่อง prDed (additive, idempotent ผ่าน marker)
  // Phase 92.37: หลัง apply ไม่ซ่อน row — เปลี่ยน state ปุ่มเป็น "✓ เติมแล้ว" disabled + แสดง info
  document.getElementById("prFillLeaveBtn")?.addEventListener("click", () => {
    const d = _leaveDecision;
    if (!d || d.suggestedDeduction <= 0 || d.deductibleDays <= 0) return;
    const dedInp  = document.getElementById("prDed");
    const noteInp = document.getElementById("prNote");
    if (!dedInp) return;
    const marker = leaveDeductionNoteMarker(d);
    const current = Number(dedInp.value || 0);

    // idempotent guard: ถ้า marker ตัวนี้อยู่ใน note แล้ว → ไม่บวกซ้ำ
    const curNote = (noteInp?.value || "").trim();
    if (hasLeaveDeductionNoteMarker(curNote, marker)) {
      _setLeaveSummary("✓ เติมแล้วก่อนหน้านี้ (idempotent — ไม่บวกซ้ำ)");
      _setLeaveApplyButtonState(true, d.suggestedDeduction);
      return;
    }

    const next = Math.round((current + d.suggestedDeduction) * 100) / 100;
    dedInp.value = next.toFixed(2);
    dedInp.dispatchEvent(new Event("input")); // trigger recalc total

    if (noteInp && marker) {
      noteInp.value = curNote ? `${curNote} · ${marker}` : marker;
    }

    _setLeaveSummary("✓ เติมหัก ฿" + d.suggestedDeduction.toFixed(2) + " แล้ว — ตรวจช่องหัก/หมายเหตุก่อนบันทึก");
    _setLeaveApplyButtonState(true, d.suggestedDeduction);
  });

  // ถ้า admin แก้ base_salary หรือ daily_rate ภายหลัง → recompute decision ทันที
  // Phase 92.37: prNote ก็ trigger ด้วย — admin ลบ marker ออก = ปุ่ม apply กลับมา active
  ["prBase","prDailyRate","prDailyToggle","prNote"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", _refreshLeaveDecision);
    document.getElementById(id)?.addEventListener("change", _refreshLeaveDecision);
  });

  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("prModalCancel")?.addEventListener("click", () => m.remove());
  document.getElementById("prModalSave")?.addEventListener("click", () => _savePayroll(ctx, payroll));
}

async function _savePayroll(ctx, existing) {
  const setErr = (msg) => {
    const el = document.getElementById("prModalStatus");
    if (el) el.textContent = msg || "";
  };
  setErr("");

  const employee_id = document.getElementById("prEmp")?.value || "";
  const department_id = document.getElementById("prDept")?.value || null;
  if (!employee_id) { setErr("เลือกพนักงาน"); return; }
  // Phase 416: รอบจ่ายมาจาก state (modal แสดง read-only) — ไม่มีรอบ = บันทึกไม่ได้
  if (!_periodStart || !_periodEnd) { setErr("เลือกรอบจ่ายจากหน้าหลักก่อน"); return; }

  const dailyOn = document.getElementById("prDailyToggle")?.checked;
  const daysWorked = dailyOn ? Number(document.getElementById("prDaysWorked")?.value || 0) : null;
  const dailyRate  = dailyOn ? Number(document.getElementById("prDailyRate")?.value || 0) : null;

  const payload = {
    employee_id,
    department_id: department_id || null,
    // Phase 416: รอบตรงตัว + period_month derived (= เดือนของวันสิ้นรอบ)
    // — สลิป slipNo / JV periodLabel / expense periodTH เดิมยังอ่าน period_month ต่อได้
    period_start: _periodStart,
    period_end:   _periodEnd,
    period_month: _periodMonth + "-01",
    base_salary: Number(document.getElementById("prBase")?.value || 0),
    overtime:    Number(document.getElementById("prOT")?.value || 0),
    welfare:     Number(document.getElementById("prWel")?.value || 0),
    bonus:       Number(document.getElementById("prBonus")?.value || 0),
    commission:  Number(document.getElementById("prCom")?.value || 0),
    deductions:  Number(document.getElementById("prDed")?.value || 0),
    days_worked: daysWorked,
    daily_rate:  dailyRate,
    note:        (document.getElementById("prNote")?.value || "").trim() || null
  };
  // Phase 92.43 (B1): persist total_amount ทุกครั้ง — ห้ามปล่อย NULL
  // (ฝั่ง app คำนวณเอง; ถ้า DB มี trigger/generated column ก็ยังยอมรับค่าที่ส่งมาเหมือนเดิม)
  payload.total_amount = computePayrollTotal(payload);

  // ── Phase 416: details jsonb — snapshot รายละเอียดต่อรอบ (schema v1) ─────────
  // shape:
  //   { schema: 1,
  //     rates:      { daily_rate },
  //     attendance: { days_worked, ot_hours_autofill },
  //     additions:  [ { type, label, amount }, ... ]   ← เฉพาะ amount > 0
  //     deductions: [ { type, label, amount }, ... ] }
  // อนาคต (ประกันสังคม/ประกันชีวิต ฯลฯ): push { type:"sso", label:"ประกันสังคม", amount }
  // เข้า deductions (หรือ additions ตาม policy) ได้เลย — ไม่ต้องแก้ DB schema
  const detailAdditions = [
    { type: "overtime",   label: "ค่าล่วงเวลา",     amount: payload.overtime },
    { type: "welfare",    label: "สวัสดิการ",        amount: payload.welfare },
    { type: "bonus",      label: "เงินพิเศษ/โบนัส",  amount: payload.bonus },
    { type: "commission", label: "คอมมิชชัน",        amount: payload.commission },
  ].filter(a => Number(a.amount) > 0);
  payload.details = {
    schema: 1,
    rates: { daily_rate: dailyRate },
    attendance: { days_worked: daysWorked, ot_hours_autofill: _otAutofillHours },
    additions: detailAdditions,
    deductions: Number(payload.deductions) > 0
      ? [{ type: "manual", label: "รายการหัก", amount: payload.deductions }]
      : [],
  };

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  const headers = { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer": "return=representation" };

  const btn = document.getElementById("prModalSave");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "⏳ บันทึก...";

  try {
    let resp;
    if (existing?.id) {
      resp = await fetch(cfg.url + "/rest/v1/staff_payroll?id=eq." + existing.id, { method: "PATCH", headers, body: JSON.stringify(payload) });
    } else {
      resp = await fetch(cfg.url + "/rest/v1/staff_payroll", { method: "POST", headers, body: JSON.stringify(payload) });
    }
    if (!resp.ok) {
      const txt = await resp.text();
      // Phase 416: unique ใหม่ uq_staff_payroll_period (รวม uq_staff_payroll เดิม + 23505)
      if (txt.includes("uq_staff_payroll_period") || txt.includes("uq_staff_payroll") || txt.includes("23505")) {
        throw new Error("พนักงานนี้มีรายการรอบนี้แล้ว — แก้ไขรายการเดิมแทน");
      }
      throw new Error("HTTP " + resp.status + " " + txt.slice(0, 200));
    }
    // Phase 92.43 (B4): audit log — silent fail
    const isUpdate = !!existing?.id;
    logActivity(isUpdate ? "payroll_update" : "payroll_create", {
      entityType: "staff_payroll",
      entityId: existing?.id || null,
      summary: `${isUpdate ? "แก้ไข" : "เพิ่ม"} payroll ${employee_id} รอบ ${_periodStart} → ${_periodEnd} — รวม ${payload.total_amount}`,
      metadata: {
        employee_id,
        period_start: payload.period_start,
        period_end: payload.period_end,
        period_month: payload.period_month,
        total_amount: payload.total_amount,
        before: existing ? {
          base_salary: Number(existing.base_salary || 0),
          total_amount: Number(existing.total_amount || 0),
          deductions: Number(existing.deductions || 0),
        } : null,
        after: {
          base_salary: payload.base_salary,
          overtime: payload.overtime,
          welfare: payload.welfare,
          bonus: payload.bonus,
          commission: payload.commission,
          deductions: payload.deductions,
          total_amount: payload.total_amount,
        },
      },
    });
    document.getElementById("prModal")?.remove();
    ctx.showToast?.(existing ? "แก้ไขรายการเงินเดือนแล้ว" : "เพิ่มรายการเงินเดือนแล้ว");
    renderPayrollPage(ctx);
  } catch(e) {
    setErr(e.message || String(e));
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// Phase 92.43 (B3): ลบ payroll + reverse expense ที่เชื่อมอยู่ (ถ้า paid แล้ว)
//   - กัน orphan expense — ลบ expense by #payroll-{id} tag ก่อน แล้วค่อยลบ payroll
//   - idempotent: ลบ expense ที่ไม่มี → no-op (DELETE filter โดย note tag)
async function _deletePayroll(ctx, id) {
  const payroll = _payrolls.find(p => String(p.id) === String(id));
  const guard = canDeletePayroll(payroll);
  if (!guard.allowed) {
    ctx.showToast?.(guard.reason || "ไม่สามารถลบรายการนี้ได้");
    return;
  }
  const confirmMsg = guard.requiresReverse
    ? `⚠️ ${guard.reason}\n\nดำเนินการลบ payroll + ย้อนรายการรายจ่าย?`
    : "ลบรายการเงินเดือนนี้?";
  if (!(await window.App?.confirm?.(confirmMsg))) return;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  let reversedExpense = false;
  let reversedJournal = 0;
  try {
    // Phase 92.44: reverse journal PV ก่อน (idempotent — voidJvForSource silent ถ้าไม่มี)
    if (guard.requiresReverse) {
      try {
        const { voidJvForSource } = await import("./accounting/auto_post.js");
        reversedJournal = await voidJvForSource("staff_payroll", id);
      } catch (e) {
        console.warn("[payroll] reverse journal failed", e?.message);
      }
    }
    // Reverse linked expense ก่อน (idempotent — ถ้าไม่มี ก็ไม่มีอะไรลบ)
    if (guard.requiresReverse && guard.expenseTag) {
      const delExp = await fetch(
        cfg.url + "/rest/v1/expenses?note=ilike." + encodeURIComponent("%" + guard.expenseTag + "%"),
        { method: "DELETE", headers }
      );
      if (!delExp.ok && delExp.status !== 404) {
        console.warn("[payroll] reverse expense failed HTTP", delExp.status);
        // ไม่ throw — ให้ลบ payroll ต่อ แต่แจ้ง user หลัง action
      } else {
        reversedExpense = true;
      }
    }
    const resp = await fetch(cfg.url + "/rest/v1/staff_payroll?id=eq." + id, {
      method: "DELETE", headers,
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    // Phase 92.43 (B4): audit log — บันทึกข้อมูลก่อนลบ + reverse status
    logActivity("payroll_delete", {
      entityType: "staff_payroll",
      entityId: id,
      summary: `ลบ payroll ${payroll?.employee_id || id}${guard.requiresReverse ? " + ย้อนรายจ่าย + JV" : ""}`,
      metadata: {
        was_paid: !!payroll?.paid_at,
        reversed_expense: reversedExpense,
        reversed_journal_count: reversedJournal,
        expense_tag: guard.expenseTag,
        before: payroll ? {
          employee_id: payroll.employee_id,
          period_month: payroll.period_month,
          total_amount: Number(payroll.total_amount || 0),
          paid_at: payroll.paid_at || null,
          payment_method: payroll.payment_method || null,
        } : null,
      },
    });
    ctx.showToast?.(guard.requiresReverse && (reversedExpense || reversedJournal > 0)
      ? `ลบ payroll + ย้อนรายจ่าย${reversedJournal > 0 ? " + JV " + reversedJournal : ""}แล้ว ✅`
      : guard.requiresReverse
        ? "ลบ payroll แล้ว — แต่ย้อนรายจ่าย/JV ไม่สำเร็จ ตรวจหน้าค่าใช้จ่าย/สมุดรายวัน"
        : "ลบแล้ว");
    if (ctx.loadAllData) await ctx.loadAllData();
    renderPayrollPage(ctx);
  } catch(e) {
    ctx.showToast?.("ลบไม่สำเร็จ: " + (e.message || e));
  }
}

async function _markPaid(ctx, id) {
  const payroll = _payrolls.find(p => String(p.id) === String(id));
  if (payroll?.paid_at) {
    ctx.showToast?.("รายการนี้จ่ายแล้ว (idempotent guard) — ไม่ทำซ้ำ");
    return;
  }
  const method = await _askPaymentMethod();
  if (!method) return;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  const headers = { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  try {
    const paidAt = new Date().toISOString();
    const resp = await fetch(cfg.url + "/rest/v1/staff_payroll?id=eq." + id, {
      method: "PATCH", headers,
      body: JSON.stringify({ paid_at: paidAt, payment_method: method })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    // Phase 76: Auto-create expense in salary category — link via "#payroll-{id}" pattern
    // Phase 92.43 (B2): expense_date ใช้ Bangkok date — กัน off-by-1 ตอนเที่ยงคืน-06:59 ไทย
    if (payroll) {
      try {
        await _createSalaryExpense(cfg, headers, payroll, paidAt, method);
      } catch (e) {
        console.warn("auto-expense fail", e);
        ctx.showToast?.("จ่ายแล้ว แต่บันทึกรายจ่ายอัตโนมัติไม่สำเร็จ");
        // Phase 92.63: trace failed money side-effect ใน audit log (เดิมแค่ console → ตามรอยไม่ได้)
        try {
          logActivity("payroll_expense_failed", {
            entityType: "staff_payroll", entityId: id,
            summary: `payroll ${id} จ่ายแล้วแต่สร้างรายจ่ายอัตโนมัติไม่สำเร็จ — ต้องสร้าง expense เองในหน้ารายจ่าย`,
            metadata: { error: String(e?.message || e), paid_at: paidAt, payment_method: method, employee_id: payroll?.employee_id },
          });
        } catch (_e) { /* swallow */ }
      }
      // Phase 92.44: ลง journal PV (สมุดรายวัน) ให้ admin/บัญชีตรวจสอบได้
      // source_table=staff_payroll → idempotent + reversible ตอนลบ payroll
      try {
        const { postJournalForPayroll } = await import("./accounting/auto_post.js");
        const emp = _profiles.find(x => x.id === payroll.employee_id);
        const empName = emp?.full_name || "(พนักงาน)";
        const periodLabel = new Date(payroll.period_month).toLocaleDateString("th-TH", { year: "numeric", month: "long" });
        await postJournalForPayroll(
          { ...payroll, paid_at: paidAt, payment_method: method },
          paidAt,
          method,
          { employeeName: empName, periodLabel }
        );
      } catch (e) {
        console.warn("auto-journal payroll fail", e);
        // ไม่ block — payroll paid + expense ลงแล้ว, JV ตามมาทีหลังได้ (admin re-post manually)
        // Phase 92.63: trace ใน audit log → P&L/cash อาจ understated จนกว่าจะ re-post
        try {
          logActivity("payroll_journal_failed", {
            entityType: "staff_payroll", entityId: id,
            summary: `payroll ${id} จ่ายแล้วแต่ลงสมุดรายวัน (JV) ไม่สำเร็จ — admin ต้อง re-post ที่หน้าบัญชี`,
            metadata: { error: String(e?.message || e), paid_at: paidAt, payment_method: method, employee_id: payroll?.employee_id },
          });
        } catch (_e) { /* swallow */ }
      }
    }
    // Phase 92.43 (B4): audit log
    logActivity("payroll_pay", {
      entityType: "staff_payroll",
      entityId: id,
      summary: `จ่าย payroll ${payroll?.employee_id || id} — ${method} — ${expenseDateForPaidPayroll(paidAt)}`,
      metadata: {
        payment_method: method,
        paid_at: paidAt,
        expense_date_bkk: expenseDateForPaidPayroll(paidAt),
        total_amount: Number(payroll?.total_amount || 0),
        expense_tag: "#payroll-" + id,
      },
    });
    ctx.showToast?.("บันทึกการจ่าย + ลงรายจ่ายเงินเดือนแล้ว ✅");
    if (ctx.loadAllData) await ctx.loadAllData();
    renderPayrollPage(ctx);
  } catch(e) {
    ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e.message || e));
  }
}

// Phase 76: ลงรายจ่าย salary อัตโนมัติเมื่อ mark paid — กัน duplicate ด้วย pattern #payroll-{id}
async function _createSalaryExpense(cfg, headers, payroll, paidAt, method) {
  const tag = "#payroll-" + payroll.id;
  // ตรวจซ้ำก่อน — ถ้ามี expense ที่ note ลงท้าย/มี #payroll-{id} อยู่แล้ว skip
  const checkUrl = `${cfg.url}/rest/v1/expenses?note=ilike.${encodeURIComponent('%' + tag + '%')}&select=id&limit=1`;
  const cr = await fetch(checkUrl, { headers: { apikey: cfg.anonKey, Authorization: headers.Authorization } });
  if (cr.ok) {
    const arr = await cr.json();
    if (arr && arr.length > 0) return; // มีแล้ว skip
  }
  const emp = _profiles.find(x => x.id === payroll.employee_id);
  const empName = emp?.full_name || "(พนักงาน)";
  const periodTH = new Date(payroll.period_month).toLocaleDateString("th-TH", { year: "numeric", month: "long" });
  const payload = {
    // Phase 92.43 (B2): Bangkok date — กัน UTC off-by-1 ตอน 00:00-06:59 ไทย
    expense_date: expenseDateForPaidPayroll(paidAt),
    category: "salary",
    description: `จ่ายเงินเดือน ${empName} — ${periodTH}`,
    amount: Number(payroll.total_amount || 0),
    payment_method: method,
    note: `บันทึกอัตโนมัติจากระบบเงินเดือน · ${empName} ${tag}`
  };
  const ir = await fetch(cfg.url + "/rest/v1/expenses", {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  if (!ir.ok) throw new Error("expense insert HTTP " + ir.status);
}

// Phase 75: replace native prompt() — modal dropdown เลือกวิธีจ่าย
function _askPaymentMethod() {
  return new Promise(resolve => {
    document.getElementById("prPayModal")?.remove();
    const m = document.createElement("div");
    m.id = "prPayModal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px";
    m.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:380px;width:100%;padding:20px">
        <h3 style="margin:0 0 4px;font-size:16px;color:#0f172a">💸 บันทึกการจ่ายเงินเดือน</h3>
        <div style="font-size:12px;color:#64748b;margin-bottom:14px">เลือกวิธีจ่าย</div>
        <select id="prPayMethodSel" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:14px;background:#fff">
          <option value="transfer">🏦 โอนเงิน</option>
          <option value="cash">💵 เงินสด</option>
          <option value="cheque">📝 เช็ค</option>
        </select>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="prPayCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
          <button id="prPayOK" type="button" style="padding:8px 18px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">บันทึกการจ่าย</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = (val) => { m.remove(); resolve(val); };
    document.getElementById("prPayCancel")?.addEventListener("click", () => close(null));
    document.getElementById("prPayOK")?.addEventListener("click", () => close(document.getElementById("prPayMethodSel")?.value || "transfer"));
    m.addEventListener("click", e => { if (e.target === m) close(null); });
    setTimeout(() => document.getElementById("prPayMethodSel")?.focus(), 50);
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 72.1: Payslip print — สลิปเงินเดือน A4 + auto-print
// ═══════════════════════════════════════════════════════════
function _bahtText(amount) {
  const nums = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const places = ['','สิบ','ร้อย','พัน','หมื่น','แสน'];
  function u1M(n){
    if(n<=0) return '';
    const s=String(n); let o='';
    for(let i=0;i<s.length;i++){
      const d=+s[i], p=s.length-1-i;
      if(d===0) continue;
      if(p===1 && d===1) o+='สิบ';
      else if(p===1 && d===2) o+='ยี่สิบ';
      else if(p===0 && d===1 && s.length>1) o+='เอ็ด';
      else o+=nums[d]+places[p];
    }
    return o;
  }
  function rd(n){
    if(n===0) return 'ศูนย์';
    let o='';
    if(n>=1000000){const m=Math.floor(n/1000000); o+=rd(m)+'ล้าน'; n=n%1000000;}
    o+=u1M(n);
    return o;
  }
  const r=Math.round(Number(amount||0)*100)/100;
  const i=Math.floor(r);
  const sat=Math.round((r-i)*100);
  if(i===0 && sat===0) return 'ศูนย์บาทถ้วน';
  let t=''; if(i>0) t+=rd(i)+'บาท';
  if(sat===0) t+=i>0?'ถ้วน':''; else t+=u1M(sat)+'สตางค์';
  return t;
}

function _printPayslip(ctx, payrollId) {
  const p = _payrolls.find(x => String(x.id) === String(payrollId));
  if (!p) { ctx.showToast?.("ไม่พบรายการ"); return; }
  const emp = _profiles.find(x => x.id === p.employee_id);
  const dept = _depts.find(d => d.id === p.department_id);
  const store = ctx.state?.storeInfo || window.App?.state?.storeInfo || {};
  const logo = window._appGetLogo ? window._appGetLogo() : "./icons/logo.svg";

  // Phase 416: แสดงช่วงรอบจ่ายจริงเมื่อมี period_start/period_end (ข้อความ label เท่านั้น —
  // layout สลิปเดิมทุกอย่าง); แถวเก่าไม่มีคอลัมน์รอบ → fallback ชื่อเดือนแบบเดิม
  const periodLabel = (p.period_start && p.period_end)
    ? formatPayPeriodLabel(p.period_start, p.period_end)
    : (() => {
        const d = new Date((p.period_month || "").slice(0, 10));
        return d.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
      })();
  const slipNo = "PS" + (p.period_month || "").slice(0, 7).replace("-", "") + "-" + String(p.id).padStart(4, "0");

  // Phase 77: ถ้าจ่ายรายวัน → label เงินเดือนแสดง "rate × days"
  const baseLabel = (p.days_worked > 0 && p.daily_rate > 0)
    ? `ค่าจ้างรายวัน (฿${Number(p.daily_rate).toLocaleString('th-TH')} × ${p.days_worked} วัน)`
    : "เงินเดือน";

  const incomeRows = [
    [baseLabel,           p.base_salary],
    ["ค่าล่วงเวลา (OT)", p.overtime],
    ["สวัสดิการ",        p.welfare],
    ["เงินพิเศษ/โบนัส",  p.bonus],
    ["คอมมิชชัน",        p.commission],
  ].filter(r => Number(r[1] || 0) !== 0);

  const totalIncome = incomeRows.reduce((s, r) => s + Number(r[1] || 0), 0);
  const ded = Number(p.deductions || 0);
  const net = Number(p.total_amount || (totalIncome - ded));

  const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>สลิปเงินเดือน — ${escHtml(emp?.full_name || "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { font-family: "Sarabun", system-ui, sans-serif; margin: 0; padding: 0; color: #0f172a; font-size: 14px; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm; box-sizing: border-box; position: relative; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  .accent { height: 5px; width: 100%; position: absolute; top: 0; left: 0; background: linear-gradient(90deg,#7c3aed,#a78bfa,#ddd6fe); }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .hdr-left { display: flex; gap: 12px; max-width: 60%; }
  .logo { width: 60px; height: 60px; border-radius: 8px; object-fit: contain; }
  .co-name { font-size: 16px; font-weight: 900; margin-bottom: 4px; }
  .co-detail { font-size: 12px; color: #475569; line-height: 1.6; }
  .doc-title { font-size: 26px; font-weight: 900; color: #6d28d9; }
  .doc-sub { font-size: 12px; color: #64748b; }
  .meta-table { margin-left: auto; margin-top: 8px; border-collapse: collapse; font-size: 12.5px; }
  .meta-table td { padding: 3px 10px; border: 1px solid #d1d5db; }
  .meta-table td:first-child { font-weight: 700; color: #475569; background: #f9fafb; white-space: nowrap; }
  .copy { display: inline-block; border: 1.5px solid #6d28d9; color: #6d28d9; padding: 2px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; margin-top: 4px; }
  .emp-section { margin: 14px 0 16px; padding: 12px 14px; background: #faf5ff; border-radius: 10px; border: 1px solid #ddd6fe; }
  .emp-name { font-size: 16px; font-weight: 900; color: #4c1d95; }
  .emp-meta { font-size: 12.5px; color: #6b21a8; margin-top: 4px; }
  .income-table { width: 100%; border-collapse: collapse; margin: 12px 0 8px; }
  .income-table th { padding: 8px 12px; font-size: 12.5px; font-weight: 700; text-align: left; border: 1px solid #d1d5db; background: #f3f4f6; color: #1f2937; }
  .income-table th.right { text-align: right; }
  .income-table td { padding: 8px 12px; font-size: 13.5px; border: 1px solid #d1d5db; }
  .income-table td.right { text-align: right; }
  .income-table tr.subtotal td { background: #f9fafb; font-weight: 700; }
  .income-table tr.deduct td { color: #dc2626; }
  .income-table tr.net td { background: #ede9fe; font-weight: 900; font-size: 15px; color: #4c1d95; border-top: 2px solid #6d28d9; }
  .baht-text { margin-top: 12px; padding: 10px 14px; background: #fef3c7; border-left: 4px solid #f59e0b; font-size: 13px; color: #78350f; font-weight: 600; }
  .pay-section { margin-top: 18px; padding: 12px 14px; background: ${p.paid_at ? '#f0fdf4' : '#fff7ed'}; border-radius: 10px; border: 1px solid ${p.paid_at ? '#bbf7d0' : '#fed7aa'}; }
  .pay-title { font-size: 12px; font-weight: 700; color: ${p.paid_at ? '#15803d' : '#9a3412'}; margin-bottom: 4px; }
  .pay-detail { font-size: 13px; color: ${p.paid_at ? '#166534' : '#7c2d12'}; }
  .note-section { margin-top: 14px; font-size: 12.5px; color: #475569; line-height: 1.6; }
  .note-title { font-weight: 800; text-decoration: underline; color: #6d28d9; margin-bottom: 4px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 50px; padding: 0 30px; font-size: 12.5px; }
  .sig-col { text-align: center; width: 38%; }
  .sig-line { border-bottom: 1px solid #1f2937; margin: 30px 0 6px; }
  .sig-label { font-size: 12px; color: #475569; }
  .footer-note { position: absolute; bottom: 12mm; left: 16mm; right: 16mm; font-size: 10.5px; color: #94a3b8; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 6px; }
  @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${[1,2].map(copyNum => `
<div class="page">
  <div class="accent"></div>
  <div class="hdr">
    <div class="hdr-left">
      <img src="${escHtml(logo)}" class="logo" onerror="this.style.display='none'" />
      <div>
        <div class="co-name">${escHtml(store.name || "บุญสุข อิเล็กทรอนิกส์")}</div>
        <div class="co-detail">
          ${store.address ? escHtml(store.address) + "<br>" : ""}
          ${store.taxId ? "เลขประจำตัวผู้เสียภาษี " + escHtml(store.taxId) + "<br>" : ""}
          ${store.phone ? "โทร. " + escHtml(store.phone) : ""}${store.mobile ? " / " + escHtml(store.mobile) : ""}
        </div>
      </div>
    </div>
    <div style="text-align:right">
      <div class="doc-title">สลิปเงินเดือน</div>
      <div class="doc-sub">Payslip</div>
      <div class="copy">${copyNum === 1 ? "ต้นฉบับ · สำหรับพนักงาน" : "สำเนา · สำหรับร้าน"}</div>
      <table class="meta-table">
        <tr><td>เลขที่</td><td>${escHtml(slipNo)}</td></tr>
        <tr><td>รอบจ่าย</td><td>${escHtml(periodLabel)}</td></tr>
        <tr><td>วันที่ออก</td><td>${new Date().toLocaleDateString("th-TH", { year:"numeric", month:"short", day:"numeric" })}</td></tr>
      </table>
    </div>
  </div>

  <div class="emp-section">
    <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:4px">รายละเอียดพนักงาน</div>
    <div class="emp-name">${escHtml(emp?.full_name || "(ไม่พบ)")}</div>
    <div class="emp-meta">
      ${dept ? "🏢 แผนก: " + escHtml(dept.name) + (dept.code ? " (" + escHtml(dept.code) + ")" : "") : "🏢 ไม่ระบุแผนก"}
      ${emp?.role ? " · ตำแหน่ง: " + escHtml(emp.role) : ""}
    </div>
  </div>

  <table class="income-table">
    <thead>
      <tr>
        <th>รายการ</th>
        <th class="right" style="width:40%">จำนวนเงิน (บาท)</th>
      </tr>
    </thead>
    <tbody>
      ${incomeRows.map(r => `<tr><td>${escHtml(r[0])}</td><td class="right">${money(r[1]).replace("฿","")}</td></tr>`).join("")}
      <tr class="subtotal"><td>รวมรายรับ</td><td class="right">${money(totalIncome).replace("฿","")}</td></tr>
      ${ded > 0 ? `<tr class="deduct"><td>หัก</td><td class="right">- ${money(ded).replace("฿","")}</td></tr>` : ""}
      <tr class="net"><td>เงินสุทธิที่ได้รับ</td><td class="right">${money(net).replace("฿","")}</td></tr>
    </tbody>
  </table>

  <div class="baht-text">(${_bahtText(net)})</div>

  <div class="pay-section">
    <div class="pay-title">${p.paid_at ? "✓ ชำระแล้ว" : "⏳ ยังไม่ชำระ"}</div>
    <div class="pay-detail">
      ${p.paid_at
        ? "วันที่จ่าย: " + new Date(p.paid_at).toLocaleString("th-TH", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
            + (p.payment_method ? " · วิธีจ่าย: " + escHtml(p.payment_method) : "")
        : "รอกระบวนการจ่าย"}
    </div>
  </div>

  ${p.note ? `<div class="note-section"><div class="note-title">หมายเหตุ</div><div>${escHtml(p.note)}</div></div>` : ""}

  <div class="signatures">
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-label">ผู้รับเงิน · ${escHtml(emp?.full_name || "")}</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-label">ผู้จ่ายเงิน · ${escHtml(store.name || "บุญสุข อิเล็กทรอนิกส์")}</div>
    </div>
  </div>

  <div class="footer-note">เอกสารนี้สร้างจากระบบ Boonsook POS V5 — โปรดเก็บไว้เป็นหลักฐาน</div>
</div>
`).join("")}
<script>
  setTimeout(() => { window.print(); }, 400);
  window.onafterprint = () => window.close();
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { ctx.showToast?.("Browser block popup — เปิดใช้ popup สำหรับเว็บนี้"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function _exportPayroll() {
  const rows = _payrolls.map(p => {
    const emp = _profiles.find(x => x.id === p.employee_id);
    const dept = _depts.find(d => d.id === p.department_id);
    return {
      "พนักงาน": emp?.full_name || "(ไม่พบ)",
      "แผนก": dept?.name || "",
      // Phase 416: รอบจ่ายตรงตัว (fallback period_month สำหรับแถวเก่าที่ไม่มีรอบ)
      "รอบจ่าย": (p.period_start && p.period_end)
        ? `${p.period_start} → ${p.period_end}`
        : (p.period_month || "").slice(0, 7),
      "เงินเดือน": Number(p.base_salary || 0),
      "ค่าล่วงเวลา": Number(p.overtime || 0),
      "สวัสดิการ": Number(p.welfare || 0),
      "โบนัส": Number(p.bonus || 0),
      "คอมมิชชัน": Number(p.commission || 0),
      "หัก": Number(p.deductions || 0),
      "รวมสุทธิ": Number(p.total_amount || 0),
      "วิธีจ่าย": p.payment_method || "",
      "จ่ายเมื่อ": p.paid_at ? new Date(p.paid_at).toLocaleString("th-TH") : "",
      "หมายเหตุ": p.note || ""
    };
  });
  // Phase 416: ชื่อไฟล์บอกช่วงรอบจ่ายที่เลือก (แทนเดือน)
  exportToExcel(`เงินเดือน_${_periodStart}_ถึง_${_periodEnd}_${todaySuffix()}.xlsx`, rows, "Payroll");
  window.App?.showToast?.(`ดาวน์โหลด ${rows.length} รายการ`);
}
