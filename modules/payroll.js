// ═══════════════════════════════════════════════════════════
//  STAFF PAYROLL — รายการเงินเดือน (Phase 72)
//  CRUD per employee per month + total = base + ot + welfare + bonus + commission - deductions
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix } from "./utils.js";

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
  const { state, showToast, requireAdmin } = ctx;
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
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role,department_id&order=full_name.asc", { headers })
    ]);
    if (!pRes.ok) {
      container.innerHTML = renderError({
        message: "ตาราง staff_payroll ยังไม่มีในฐานข้อมูล",
        detail: "รัน supabase-phase72-payroll.sql ก่อน (HTTP " + pRes.status + ")",
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
    <div style="max-width:1200px;margin:0 auto;padding:8px">
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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
  // Auto-fill department from selected employee
  document.getElementById("prEmp")?.addEventListener("change", (e) => {
    const emp = _profiles.find(p => p.id === e.target.value);
    if (emp?.department_id) {
      const sel = document.getElementById("prDept");
      if (sel) sel.value = emp.department_id;
    }
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
  if (!confirm("ลบรายการเงินเดือนนี้?")) return;
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
  const method = prompt("วิธีจ่าย? (cash / transfer / cheque)", "transfer");
  if (!method) return;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_payroll?id=eq." + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token },
      body: JSON.stringify({ paid_at: new Date().toISOString(), payment_method: method.trim().toLowerCase() })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    ctx.showToast?.("บันทึกการจ่ายแล้ว");
    renderPayrollPage(ctx);
  } catch(e) {
    ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e.message || e));
  }
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
