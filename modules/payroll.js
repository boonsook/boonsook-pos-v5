// ═══════════════════════════════════════════════════════════
//  STAFF PAYROLL — รายการเงินเดือน (Phase 72)
//  CRUD per employee per month + total = base + ot + welfare + bonus + commission - deductions
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix } from "./utils.js";
// Phase 92.26: ดึงสรุป OT จาก Time Clock มาเติมในช่องค่าล่วงเวลา (auto-fill)
import { fetchUserAttendanceSummary, shiftHoursFromState } from "./time_clock.js";
// Phase 92.33: ดึงวันลา approved + suggest deduction (advisory)
import {
  fetchApprovedLeavesForUser,
  summarizeApprovedLeavesForPayroll,
  calcUnpaidLeaveDeduction,
} from "./leave_management.js";

let _payrolls = [];
let _depts = [];
let _profiles = [];
let _periodMonth = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 7); // YYYY-MM
})();

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

  // Period range: month -> 1st to last day
  const periodStart = _periodMonth + "-01";
  const periodEndDate = new Date(_periodMonth + "-01");
  periodEndDate.setMonth(periodEndDate.getMonth() + 1);
  const periodEnd = periodEndDate.toISOString().slice(0, 10);

  try {
    const [pRes, dRes, profRes] = await Promise.all([
      fetch(cfg.url + `/rest/v1/staff_payroll?select=*&period_month=gte.${periodStart}&period_month=lt.${periodEnd}&order=period_month.desc`, { headers }),
      fetch(cfg.url + "/rest/v1/departments?select=*&is_active=eq.true&order=sort_order.asc", { headers }),
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role,department_id,pay_type,daily_rate&order=full_name.asc", { headers })
    ]);
    if (!pRes.ok) {
      const isAuth = pRes.status === 401 || pRes.status === 403;
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + pRes.status + ")" : "ตาราง staff_payroll ยังไม่มีในฐานข้อมูล",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่" : "รัน supabase-phase72-payroll.sql ก่อน (HTTP " + pRes.status + ")",
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

  // Build month options (last 12 months + future 3)
  const monthOpts = [];
  const now = new Date();
  for (let i = -3; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOpts.push(d.toISOString().slice(0, 7));
  }

  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">💰</div>
        <h2 style="margin:0 0 4px;color:#0f172a">รายการเงินเดือน</h2>
        <p style="margin:0;color:#475569;font-size:13px">บันทึก/แก้ไขเงินเดือน + จ่ายตามรอบเดือน</p>
      </div>

      <!-- Period selector + actions -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:700;font-size:13px">📅 รอบเดือน:</span>
        <select id="prMonthSelect" style="padding:7px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-weight:600">
          ${monthOpts.map(m => `<option value="${m}" ${m===_periodMonth?'selected':''}>${_formatMonth(m)}</option>`).join("")}
        </select>
        <button id="prExportBtn" class="btn light" style="font-size:13px">📥 Excel</button>
        <button id="prAddBtn" class="btn primary" style="margin-left:auto;font-size:13px">+ เพิ่มรายการเงินเดือน</button>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📋 จำนวนรายการ</div>
          <div class="stat-value" style="color:#0284c7">${_payrolls.length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">จ่ายแล้ว: ${paidCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 ยอดรวมเดือนนี้</div>
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
          title: "ยังไม่มีรายการเงินเดือนเดือนนี้",
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
  document.getElementById("prMonthSelect")?.addEventListener("change", (e) => {
    _periodMonth = e.target.value;
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

function _formatMonth(ym) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
}

function _openPayrollModal(ctx, payroll) {
  document.getElementById("prModal")?.remove();
  const isEdit = !!payroll;

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
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">รอบเดือน *</div>
          <input id="prMonth" type="month" value="${(payroll?.period_month || (_periodMonth + '-01')).slice(0,7)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
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

        <!-- Phase 92.33: ดึงสรุปวันลาในรอบเดือน — advisory + manual apply -->
        <div id="prLeaveBox" style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;color:#9a3412;font-size:13px">🌴 วันลาในรอบเดือน <span style="font-size:11px;font-weight:400;color:#c2410c">(ของเดือนนี้)</span></div>
            <button id="prFetchLeaveBtn" type="button" style="background:#ea580c;color:#fff;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">📥 ดึงสรุปวันลา</button>
          </div>
          <div id="prLeaveSummary" style="margin-top:8px;font-size:12px;color:#9a3412;min-height:18px">— กดปุ่ม "ดึงสรุปวันลา" หลังเลือกพนักงาน + เดือน —</div>
          <div id="prLeaveApplyRow" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #fdba74">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:12px;color:#7c2d12">
                แนะนำหัก: <strong id="prLeaveSuggestDed" style="color:#dc2626">฿0.00</strong>
                <span id="prLeaveSuggestSource" style="font-size:11px;color:#9a3412">—</span>
              </div>
              <button id="prFillLeaveBtn" type="button" style="background:#dc2626;color:#fff;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">→ เติมลงช่องหัก</button>
            </div>
          </div>
        </div>

        <!-- Phase 92.26: ดึงสรุป OT จาก Time Clock — auto-fill ค่าล่วงเวลา -->
        <div id="prOtFromClockBox" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;color:#166534;font-size:13px">🕒 ดึงจาก Time Clock <span style="font-size:11px;font-weight:400;color:#15803d">(ของเดือนนี้)</span></div>
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
    const periodInput = document.getElementById("prMonth")?.value || ""; // YYYY-MM
    if (!empId) { _setOtSummaryError("เลือกพนักงานก่อน"); return; }
    if (!periodInput) { _setOtSummaryError("เลือกรอบเดือนก่อน"); return; }
    fetchOtBtn.disabled = true;
    const orig = fetchOtBtn.textContent;
    fetchOtBtn.textContent = "⏳ กำลังดึง...";
    // คำนวณ from/to เดือนนั้น (Asia/Bangkok)
    const fromDate = periodInput + "-01";
    const [y, mo] = periodInput.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const toDate = `${periodInput}-${String(lastDay).padStart(2, "0")}`;
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
    }
  });

  // ─── Phase 92.33: ดึงสรุปวันลา approved + advisory deduction ─────
  const fetchLeaveBtn = document.getElementById("prFetchLeaveBtn");
  let _leaveSuggestedAmount = 0;
  let _leaveSuggestedSource = "";
  let _leaveSuggestedUnpaidDays = 0;

  function _setLeaveSummary(html, isError) {
    const el = document.getElementById("prLeaveSummary");
    if (el) el.innerHTML = isError
      ? `<span style="color:#dc2626">${html}</span>`
      : html;
  }

  function _hideLeaveApplyRow() {
    const row = document.getElementById("prLeaveApplyRow");
    if (row) row.style.display = "none";
    _leaveSuggestedAmount = 0;
    _leaveSuggestedUnpaidDays = 0;
  }

  function _refreshLeaveSuggestion() {
    // recompute suggestion ตาม base_salary / daily_rate ปัจจุบัน (ที่อาจถูก auto-fill จาก daily mode)
    if (_leaveSuggestedUnpaidDays <= 0) { _hideLeaveApplyRow(); return; }
    const empId = document.getElementById("prEmp")?.value || "";
    const emp = _profiles.find(p => p.id === empId);
    const dailyOn   = document.getElementById("prDailyToggle")?.checked;
    const dailyInp  = Number(document.getElementById("prDailyRate")?.value || 0);
    const dailyRate = dailyOn && dailyInp > 0 ? dailyInp : Number(emp?.daily_rate || 0);
    const baseSal   = Number(document.getElementById("prBase")?.value || 0);
    const amount = calcUnpaidLeaveDeduction({
      unpaidDays: _leaveSuggestedUnpaidDays,
      dailyRate,
      baseSalary: baseSal,
    });
    _leaveSuggestedAmount = amount;
    _leaveSuggestedSource = dailyRate > 0
      ? `(${_leaveSuggestedUnpaidDays} วัน × ฿${dailyRate.toLocaleString("th-TH")}/วัน)`
      : baseSal > 0
        ? `(${_leaveSuggestedUnpaidDays} วัน × เงินเดือน÷30)`
        : "(ไม่มี daily rate/เงินเดือน — ฿0)";
    const amtEl = document.getElementById("prLeaveSuggestDed");
    const srcEl = document.getElementById("prLeaveSuggestSource");
    if (amtEl) amtEl.textContent = money(amount);
    if (srcEl) srcEl.textContent = _leaveSuggestedSource;
    const row = document.getElementById("prLeaveApplyRow");
    if (row) row.style.display = "block";
  }

  fetchLeaveBtn?.addEventListener("click", async () => {
    if (fetchLeaveBtn.disabled) return;
    const empId = document.getElementById("prEmp")?.value || "";
    const periodInput = document.getElementById("prMonth")?.value || "";
    if (!empId)       { _setLeaveSummary("เลือกพนักงานก่อน", true); return; }
    if (!periodInput) { _setLeaveSummary("เลือกรอบเดือนก่อน", true); return; }
    fetchLeaveBtn.disabled = true;
    const orig = fetchLeaveBtn.textContent;
    fetchLeaveBtn.textContent = "⏳ กำลังดึง...";
    // คำนวณ from/to เดือนนั้น
    const fromDate = periodInput + "-01";
    const [y, mo] = periodInput.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const toDate = `${periodInput}-${String(lastDay).padStart(2, "0")}`;
    try {
      const res = await fetchApprovedLeavesForUser(empId, fromDate, toDate);
      if (!res.ok) {
        if (res.code === "NO_TABLE") {
          _setLeaveSummary("⚠️ ยังไม่ได้ติดตั้งตารางวันลา (รัน supabase-phase92-32-leave-management.sql)", true);
        } else {
          _setLeaveSummary("ดึงไม่สำเร็จ: " + (res.message || res.code || "unknown"), true);
        }
        _hideLeaveApplyRow();
        return;
      }
      const summary = summarizeApprovedLeavesForPayroll(res.rows);
      if (summary.records === 0) {
        _setLeaveSummary("ไม่มีวันลาอนุมัติในรอบนี้");
        _hideLeaveApplyRow();
        return;
      }
      // แสดง breakdown
      const parts = [];
      parts.push(`✅ ${summary.records} record · รวม <strong>${summary.totalApprovedDays}</strong> วัน`);
      const breakdown = [];
      if (summary.sickDays     > 0) breakdown.push(`🤒 ป่วย ${summary.sickDays}`);
      if (summary.personalDays > 0) breakdown.push(`📝 กิจ ${summary.personalDays}`);
      if (summary.vacationDays > 0) breakdown.push(`🌴 พักร้อน ${summary.vacationDays}`);
      if (summary.unpaidDays   > 0) breakdown.push(`<strong style="color:#dc2626">💸 ไม่รับค่าจ้าง ${summary.unpaidDays}</strong>`);
      if (summary.otherDays    > 0) breakdown.push(`📌 อื่น ๆ ${summary.otherDays}`);
      if (breakdown.length > 0) parts.push(breakdown.join(" · "));
      _setLeaveSummary(parts.join("<br>"));

      // suggest deduction เฉพาะถ้ามี unpaid
      if (summary.unpaidDays > 0) {
        _leaveSuggestedUnpaidDays = summary.unpaidDays;
        _refreshLeaveSuggestion();
      } else {
        _hideLeaveApplyRow();
      }
    } catch (e) {
      _setLeaveSummary("ดึงไม่สำเร็จ: " + (e?.message || "unknown"), true);
      _hideLeaveApplyRow();
    } finally {
      if (fetchLeaveBtn.isConnected) { fetchLeaveBtn.disabled = false; fetchLeaveBtn.textContent = orig; }
    }
  });

  // เติม unpaid leave deduction ลงช่อง prDed (additive, ไม่ทับค่าเดิม) + ต่อ note
  document.getElementById("prFillLeaveBtn")?.addEventListener("click", () => {
    if (_leaveSuggestedAmount <= 0 || _leaveSuggestedUnpaidDays <= 0) return;
    const dedInp  = document.getElementById("prDed");
    const noteInp = document.getElementById("prNote");
    if (!dedInp) return;
    const current = Number(dedInp.value || 0);
    const next = Math.round((current + _leaveSuggestedAmount) * 100) / 100;
    dedInp.value = next.toFixed(2);
    dedInp.dispatchEvent(new Event("input")); // trigger recalc total

    // ต่อ note (idempotent — ถ้ามี marker เดิม ไม่ append ซ้ำ)
    if (noteInp) {
      const marker = `หักลาไม่รับค่าจ้าง ${_leaveSuggestedUnpaidDays} วัน`;
      const cur = (noteInp.value || "").trim();
      if (!cur.includes(marker)) {
        noteInp.value = cur ? `${cur} · ${marker}` : marker;
      }
    }

    // ปิด apply row หลังเติม (กันกดซ้ำเผลอเติม double)
    _hideLeaveApplyRow();
    _setLeaveSummary("✓ เติมหัก ฿" + _leaveSuggestedAmount.toFixed(2) + " แล้ว — ตรวจช่องหัก/หมายเหตุก่อนบันทึก");
  });

  // ถ้า admin แก้ base_salary หรือ daily_rate ภายหลัง → recompute suggestion ทันที
  ["prBase","prDailyRate","prDailyToggle"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", _refreshLeaveSuggestion);
    document.getElementById(id)?.addEventListener("change", _refreshLeaveSuggestion);
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
  const periodInput = document.getElementById("prMonth")?.value || "";
  if (!employee_id) { setErr("เลือกพนักงาน"); return; }
  if (!periodInput) { setErr("เลือกรอบเดือน"); return; }

  const dailyOn = document.getElementById("prDailyToggle")?.checked;
  const daysWorked = dailyOn ? Number(document.getElementById("prDaysWorked")?.value || 0) : null;
  const dailyRate  = dailyOn ? Number(document.getElementById("prDailyRate")?.value || 0) : null;

  const payload = {
    employee_id,
    department_id: department_id || null,
    period_month: periodInput + "-01",
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
      if (txt.includes("uq_staff_payroll") || txt.includes("23505")) throw new Error("พนักงานนี้มีรายการเงินเดือนเดือนนี้แล้ว — แก้ไขรายการเดิมแทน");
      throw new Error("HTTP " + resp.status + " " + txt.slice(0, 200));
    }
    document.getElementById("prModal")?.remove();
    ctx.showToast?.(existing ? "แก้ไขรายการเงินเดือนแล้ว" : "เพิ่มรายการเงินเดือนแล้ว");
    renderPayrollPage(ctx);
  } catch(e) {
    setErr(e.message || String(e));
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function _deletePayroll(ctx, id) {
  if (!(await window.App?.confirm?.("ลบรายการเงินเดือนนี้?"))) return;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_payroll?id=eq." + id, {
      method: "DELETE",
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    ctx.showToast?.("ลบแล้ว");
    renderPayrollPage(ctx);
  } catch(e) {
    ctx.showToast?.("ลบไม่สำเร็จ: " + (e.message || e));
  }
}

async function _markPaid(ctx, id) {
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
    const payroll = _payrolls.find(p => String(p.id) === String(id));
    if (payroll) {
      try {
        await _createSalaryExpense(cfg, headers, payroll, paidAt, method);
      } catch (e) {
        console.warn("auto-expense fail", e);
        ctx.showToast?.("จ่ายแล้ว แต่บันทึกรายจ่ายอัตโนมัติไม่สำเร็จ");
      }
    }
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
    expense_date: paidAt.slice(0, 10),
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

  const periodLabel = (() => {
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
        <tr><td>รอบเดือน</td><td>${escHtml(periodLabel)}</td></tr>
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
      "รอบเดือน": (p.period_month || "").slice(0, 7),
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
  exportToExcel(`เงินเดือน_${_periodMonth}_${todaySuffix()}.xlsx`, rows, "Payroll");
  window.App?.showToast?.(`ดาวน์โหลด ${rows.length} รายการ`);
}
