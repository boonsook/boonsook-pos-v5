// ═══════════════════════════════════════════════════════════
//  RECURRING EXPENSES — รายจ่ายประจำ (ค่าเช่า / ค่าน้ำ / เงินเดือน)
//  ตั้งครั้งเดียว → ระบบสร้าง expense row ทุกเดือน/สัปดาห์อัตโนมัติ
//  Phase 47 — adopt ui_states (skeleton/empty/error)
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";

import { escHtml } from "./utils.js";
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

const FREQ_LABELS = { monthly: "ทุกเดือน", weekly: "ทุกสัปดาห์", yearly: "ทุกปี" };

let _reList = []; // local cache

export async function renderRecurringExpensesPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-recurring_expenses");
  if (!container) return;

  // Load from DB
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });

  try {
    const res = await fetch(cfg.url + "/rest/v1/recurring_expenses?select=*&order=is_active.desc,name.asc", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) {
      container.innerHTML = renderError({
        message: "ตาราง recurring_expenses ยังไม่มีในฐานข้อมูล",
        detail: "รัน supabase-rls-policies.sql ใน Supabase SQL Editor เพื่อสร้างตารางก่อน (HTTP " + res.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "reRetryBtn"
      });
      document.getElementById("reRetryBtn")?.addEventListener("click", () => renderRecurringExpensesPage(ctx));
      return;
    }
    _reList = await res.json();
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "reRetryBtn"
    });
    document.getElementById("reRetryBtn")?.addEventListener("click", () => renderRecurringExpensesPage(ctx));
    return;
  }

  const active = _reList.filter(r => r.is_active);
  const inactive = _reList.filter(r => !r.is_active);
  const totalMonthly = active.filter(r => r.frequency === "monthly").reduce((s, r) => s + Number(r.amount || 0), 0)
    + active.filter(r => r.frequency === "weekly").reduce((s, r) => s + Number(r.amount || 0) * 4.33, 0)
    + active.filter(r => r.frequency === "yearly").reduce((s, r) => s + Number(r.amount || 0) / 12, 0);

  // หา items ที่ครบกำหนดวันนี้/อดีต
  const today = new Date().toISOString().slice(0, 10);
  const overdue = active.filter(r => r.next_due && r.next_due <= today);

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fee2e2,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🔁</div>
        <h2 style="margin:0 0 4px;color:#991b1b">รายจ่ายประจำ (Recurring Expenses)</h2>
        <p style="margin:0;color:#1e40af;font-size:13px">ตั้งครั้งเดียว — ระบบสร้าง expense ตามกำหนด (ค่าเช่า, เงินเดือน, ค่าน้ำ ฯลฯ)</p>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📋 รายการที่ใช้งาน</div>
          <div class="stat-value" style="color:#0284c7">${active.length}</div>
          ${inactive.length > 0 ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">ปิดไว้: ${inactive.length}</div>` : ''}
        </div>
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 รวมต่อเดือน (เฉลี่ย)</div>
          <div class="stat-value" style="color:#dc2626;font-size:22px">฿${money(totalMonthly)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">น่าจะออกประมาณนี้</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">⏰ ครบกำหนดต้องจ่าย</div>
          <div class="stat-value" style="color:#92400e">${overdue.length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${overdue.length > 0 ? "กดปุ่ม 'สร้าง expense' ด้านล่าง" : "ไม่มีค้าง"}</div>
        </div>
      </div>

      <!-- Action: สร้าง expense ทั้งหมดที่ครบกำหนด -->
      ${overdue.length > 0 ? `
        <div class="panel" style="padding:14px;margin-bottom:14px;background:#fef3c7;border:1px solid #fde68a;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-size:13px;color:#92400e">
            <b>⚠️ มี ${overdue.length} รายการครบกำหนด:</b> ${overdue.map(r => escHtml(r.name)).join(", ").slice(0, 100)}
          </div>
          <button id="reGenerateAllBtn" class="btn primary" style="font-size:13px;padding:8px 16px;background:#dc2626;border:none">💸 สร้าง Expenses ทั้งหมดเลย (${overdue.length})</button>
        </div>
      ` : ''}

      <!-- Add -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button id="reAddBtn" class="btn primary" style="font-size:13px">+ เพิ่มรายการใหม่</button>
      </div>

      <!-- List -->
      <div class="panel" style="padding:14px">
        ${_reList.length === 0 ? renderEmpty({
          icon: "📝",
          title: "ยังไม่มีรายการประจำ",
          message: "ตัวอย่าง: ค่าเช่าร้าน 12000/เดือน, เงินเดือนพนง. 15000/เดือน, ค่าน้ำ-ไฟ 3000/เดือน",
          actionLabel: "+ เพิ่มรายการใหม่",
          actionId: "reEmptyAddBtn"
        }) : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:left">ชื่อ</th>
                <th style="padding:8px;text-align:left">หมวด</th>
                <th style="padding:8px;text-align:right">จำนวน</th>
                <th style="padding:8px;text-align:left">ความถี่</th>
                <th style="padding:8px;text-align:left">ครั้งถัดไป</th>
                <th style="padding:8px;text-align:left">ครั้งล่าสุด</th>
                <th style="padding:8px;text-align:center">สถานะ</th>
                <th style="padding:8px;text-align:center"></th>
              </tr>
            </thead>
            <tbody>
              ${_reList.map(r => {
                const isOverdue = r.is_active && r.next_due && r.next_due <= today;
                return `
                  <tr style="border-bottom:1px solid #e5e7eb;background:${isOverdue?'#fef9c3':r.is_active?'#fff':'#f1f5f9'}">
                    <td style="padding:8px;font-weight:600">${escHtml(r.name)}</td>
                    <td style="padding:8px;color:#64748b">${escHtml(r.category || '-')}</td>
                    <td style="padding:8px;text-align:right;font-weight:700;color:#dc2626">฿${money(r.amount)}</td>
                    <td style="padding:8px">${FREQ_LABELS[r.frequency] || r.frequency}${r.frequency==='monthly' && r.day_of_month ? ` (วันที่ ${r.day_of_month})` : ''}</td>
                    <td style="padding:8px;color:${isOverdue?'#dc2626;font-weight:700':'#475569'}">${r.next_due || '-'}${isOverdue?' ⚠️':''}</td>
                    <td style="padding:8px;color:#64748b;font-size:12px">${r.last_generated || 'ไม่เคย'}</td>
                    <td style="padding:8px;text-align:center">
                      ${r.is_active ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">เปิดใช้</span>' : '<span style="background:#f1f5f9;color:#94a3b8;padding:2px 8px;border-radius:6px;font-size:11px">ปิด</span>'}
                    </td>
                    <td style="padding:8px;text-align:center;white-space:nowrap">
                      ${isOverdue ? `<button class="re-gen-btn" data-id="${r.id}" title="สร้าง expense" style="border:none;background:#dc2626;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-right:4px">💸 สร้าง</button>` : ''}
                      <button class="re-edit-btn" data-id="${r.id}" title="แก้ไข" style="border:1px solid #cbd5e1;background:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px">✏️</button>
                      <button class="re-toggle-btn" data-id="${r.id}" title="${r.is_active?'ปิด':'เปิด'}" style="border:1px solid #cbd5e1;background:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px">${r.is_active?'⏸️':'▶️'}</button>
                      <button class="re-del-btn" data-id="${r.id}" title="ลบ" style="border:1px solid #fca5a5;background:#fff;color:#dc2626;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px">🗑️</button>
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
  container.querySelector("#reAddBtn")?.addEventListener("click", () => openEditModal(ctx, null));
  container.querySelector("#reEmptyAddBtn")?.addEventListener("click", () => openEditModal(ctx, null));
  container.querySelectorAll(".re-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const r = _reList.find(x => String(x.id) === String(btn.dataset.id));
    if (r) openEditModal(ctx, r);
  }));
  container.querySelectorAll(".re-toggle-btn").forEach(btn => btn.addEventListener("click", () => toggleActive(ctx, btn.dataset.id)));
  container.querySelectorAll(".re-del-btn").forEach(btn => btn.addEventListener("click", () => deleteRecurring(ctx, btn.dataset.id)));
  container.querySelectorAll(".re-gen-btn").forEach(btn => btn.addEventListener("click", () => generateOne(ctx, btn.dataset.id)));
  container.querySelector("#reGenerateAllBtn")?.addEventListener("click", () => generateAllOverdue(ctx, overdue));
}

function openEditModal(ctx, r) {
  document.getElementById("reEditModal")?.remove();
  const isEdit = !!r;
  const today = new Date().toISOString().slice(0, 10);
  const defaultDay = (new Date()).getDate();

  const modal = document.createElement("div");
  modal.id = "reEditModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:20px;max-height:90vh;overflow-y:auto">
      <h3 style="margin:0 0 14px">${isEdit ? '✏️ แก้ไข' : '+ เพิ่ม'}รายจ่ายประจำ</h3>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:600">ชื่อรายการ:</label>
          <input id="reName" type="text" value="${escHtml(r?.name || '')}" placeholder="เช่น ค่าเช่าร้าน, เงินเดือนพนักงาน" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">หมวด (option):</label>
          <input id="reCategory" type="text" value="${escHtml(r?.category || '')}" placeholder="เช่น ค่าเช่า, เงินเดือน, สาธารณูปโภค" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">จำนวนเงิน (บาท):</label>
          <input id="reAmount" type="number" min="0" step="0.01" value="${r?.amount || ''}" placeholder="0.00" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;font-weight:700" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">ความถี่:</label>
          <select id="reFrequency" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="monthly" ${r?.frequency==='monthly'?'selected':''}>ทุกเดือน</option>
            <option value="weekly" ${r?.frequency==='weekly'?'selected':''}>ทุกสัปดาห์</option>
            <option value="yearly" ${r?.frequency==='yearly'?'selected':''}>ทุกปี</option>
          </select>
        </div>
        <div id="reDayOfMonthWrap">
          <label style="font-size:12px;font-weight:600">วันที่ของเดือน (1-28):</label>
          <input id="reDayOfMonth" type="number" min="1" max="28" value="${r?.day_of_month || defaultDay}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">ครั้งถัดไป (ระบบจะสร้าง expense ในวันนี้):</label>
          <input id="reNextDue" type="date" value="${r?.next_due || today}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">หมายเหตุ:</label>
          <input id="reNote" type="text" value="${escHtml(r?.note || '')}" placeholder="หมายเหตุเพิ่มเติม" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="reCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="reSave" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">${isEdit?'บันทึก':'+ เพิ่ม'}</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  // toggle dayOfMonth visibility
  const freqSel = modal.querySelector("#reFrequency");
  const dayWrap = modal.querySelector("#reDayOfMonthWrap");
  function updateDayVis() { dayWrap.style.display = freqSel.value === "monthly" ? "block" : "none"; }
  freqSel.addEventListener("change", updateDayVis);
  updateDayVis();

  modal.querySelector("#reCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#reSave").addEventListener("click", async () => {
    const payload = {
      name: modal.querySelector("#reName").value.trim(),
      category: modal.querySelector("#reCategory").value.trim() || null,
      amount: Number(modal.querySelector("#reAmount").value || 0),
      frequency: modal.querySelector("#reFrequency").value,
      day_of_month: Number(modal.querySelector("#reDayOfMonth").value || 1),
      next_due: modal.querySelector("#reNextDue").value || null,
      note: modal.querySelector("#reNote").value.trim() || null,
      is_active: r?.is_active ?? true,
      updated_at: new Date().toISOString()
    };
    if (!payload.name) { window.App?.showToast?.("กรอกชื่อ", "warn"); return; }
    if (payload.amount <= 0) { window.App?.showToast?.("จำนวนต้องมากกว่า 0", "warn"); return; }

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const url = cfg.url + "/rest/v1/recurring_expenses" + (r ? "?id=eq." + r.id : "");
    const method = r ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.anonKey,
          "Authorization": "Bearer " + accessToken,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      modal.remove();
      ctx.showToast?.(r ? "บันทึกแก้ไขแล้ว" : "เพิ่มแล้ว ✓");
      renderRecurringExpensesPage(ctx);
    } catch (e) {
      window.App?.showToast?.("ผิดพลาด: " + (e?.message || e), "error");
    }
  });
}

async function toggleActive(ctx, id) {
  const r = _reList.find(x => String(x.id) === String(id));
  if (!r) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/recurring_expenses?id=eq." + id, {
    method: "PATCH",
    headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
    body: JSON.stringify({ is_active: !r.is_active })
  });
  ctx.showToast?.(r.is_active ? "ปิดรายการ" : "เปิดรายการ");
  renderRecurringExpensesPage(ctx);
}

async function deleteRecurring(ctx, id) {
  const r = _reList.find(x => String(x.id) === String(id));
  if (!r) return;
  if (!(await window.App?.confirm?.(`ลบ "${r.name}"? (ไม่กระทบ expense ที่สร้างไปแล้ว)`))) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/recurring_expenses?id=eq." + id, {
    method: "DELETE",
    headers: { "apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" }
  });
  ctx.showToast?.("ลบแล้ว");
  renderRecurringExpensesPage(ctx);
}

function _calcNextDue(r, fromDate) {
  const d = new Date(fromDate);
  if (r.frequency === "monthly") {
    d.setMonth(d.getMonth() + 1);
    if (r.day_of_month) d.setDate(Math.min(r.day_of_month, 28));
  } else if (r.frequency === "weekly") {
    d.setDate(d.getDate() + 7);
  } else if (r.frequency === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

async function generateOne(ctx, id) {
  const r = _reList.find(x => String(x.id) === String(id));
  if (!r) return;
  await _createExpenseFromRecurring(ctx, r);
  ctx.showToast?.(`✓ สร้าง expense ${r.name} ฿${money(r.amount)}`);
  renderRecurringExpensesPage(ctx);
}

async function generateAllOverdue(ctx, overdue) {
  if (!(await window.App?.confirm?.(`สร้าง expense ${overdue.length} รายการเลย?`))) return;
  let ok = 0;
  for (const r of overdue) {
    const result = await _createExpenseFromRecurring(ctx, r);
    if (result) ok++;
  }
  ctx.showToast?.(`✓ สร้างเสร็จ ${ok}/${overdue.length}`);
  renderRecurringExpensesPage(ctx);
}

async function _createExpenseFromRecurring(ctx, r) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const today = new Date().toISOString().slice(0, 10);
  const expensePayload = {
    description: r.name + (r.note ? ` — ${r.note}` : ""),
    category: r.category || "อื่นๆ",
    amount: Number(r.amount),
    expense_date: today,
    payment_method: "cash",
    note: `[Auto] รายจ่ายประจำ: ${r.name}`
  };
  try {
    const res = await fetch(cfg.url + "/rest/v1/expenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + accessToken,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(expensePayload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);

    // อัพเดท recurring: last_generated + next_due
    const nextDue = _calcNextDue(r, today);
    await fetch(cfg.url + "/rest/v1/recurring_expenses?id=eq." + r.id, {
      method: "PATCH",
      headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
      body: JSON.stringify({ last_generated: today, next_due: nextDue, updated_at: new Date().toISOString() })
    });
    if (window.App?.loadAllData) await window.App.loadAllData();
    return true;
  } catch (e) {
    console.error("[recurring expense]", e);
    return false;
  }
}
