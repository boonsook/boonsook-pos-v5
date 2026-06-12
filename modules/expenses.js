// ═══════════════════════════════════════════════════════════
//  EXPENSES MODULE — รายรับ-รายจ่าย
//  ★ Expense tracking with categories, summary cards, and monthly chart
// ═══════════════════════════════════════════════════════════
import { renderEmpty } from "./ui_states.js";
// Phase 70 (D3): Excel export
import { exportToExcel, todaySuffix, todayBkk } from "./utils.js";
// Phase 88.1a: auto-post JV ตอนบันทึก expense
import { postJournalForExpense, voidJvForSource } from "./accounting/auto_post.js";

function money(n){ return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0)); }
function dateTH(d){ if(!d) return "-"; try{ return new Date(d).toLocaleDateString("th-TH",{year:"numeric",month:"short",day:"numeric"}); }catch(e){ return d; } }
function escHtml(s){ const div = document.createElement("div"); div.textContent = s; return div.innerHTML; }

const EXPENSE_CATEGORIES = [
  { value: "materials", label: "ค่าวัสดุ" },
  { value: "fuel", label: "ค่าน้ำมัน" },
  { value: "labor_hire", label: "ค่าจ้าง" },
  { value: "salary", label: "เงินเดือน" },
  { value: "rent", label: "ค่าเช่า" },
  { value: "utilities", label: "ค่าสาธารณูปโภค" },
  { value: "other", label: "อื่นๆ" }
];

const PAYMENT_METHODS = [
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" }
];

// ═══ Module-level state ═══
let _ctx = null;
let _filterFromDate = null;
let _filterToDate = null;
let _filterCategory = "";
let _showAddForm = false;
let _editingExpenseId = null;
let _pendingExpProofUrl = "";

// ═══════════════════════════════════════════════════════════
//  MAIN RENDER — Expenses Page
// ═══════════════════════════════════════════════════════════
export function renderExpensesPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-expenses");
  if (!container) return;

  // Initialize date filters if not set
  // Phase 92.47: ใช้ Bangkok date (todayBkk) แทน toISOString() (UTC)
  // เดิม: เช้าวันที่ 1 เวลาไทย → UTC ถอยเป็นวันสุดท้ายของเดือนก่อน → filter window ยุบ
  const todayStr = todayBkk();                 // "YYYY-MM-DD" (Asia/Bangkok)
  const firstDayStr = todayStr.slice(0, 7) + "-01";
  if (!_filterFromDate) _filterFromDate = firstDayStr;
  if (!_filterToDate) _filterToDate = todayStr;

  const expenses = ctx.state.expenses || [];
  // ★ กรอง soft-deleted sales ออกก่อนคำนวณรายรับ
  const sales = (ctx.state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]"));

  // Calculate summary values
  const thisMonth = todayStr.slice(0, 7);
  const monthExpenses = expenses
    .filter(e => String(e.expense_date || "").slice(0, 7) === thisMonth)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const monthIncome = sales
    .filter(s => String(s.created_at || "").slice(0, 7) === thisMonth)
    .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

  const profit = monthIncome - monthExpenses;

  // Apply filters
  let filtered = [...expenses];
  if (_filterFromDate) {
    filtered = filtered.filter(e => String(e.expense_date || "") >= _filterFromDate);
  }
  if (_filterToDate) {
    filtered = filtered.filter(e => String(e.expense_date || "") <= _filterToDate);
  }
  if (_filterCategory) {
    filtered = filtered.filter(e => e.category === _filterCategory);
  }
  filtered.sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

  // Build category summary for chart
  const categoryTotals = {};
  EXPENSE_CATEGORIES.forEach(cat => {
    categoryTotals[cat.value] = expenses
      .filter(e => e.category === cat.value && String(e.expense_date || "").slice(0, 7) === thisMonth)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  });

  container.innerHTML = `
    <!-- Summary Cards -->
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">
      <div class="stat-card" style="border-left:4px solid #ef4444">
        <div class="stat-label">เดือนนี้ใช้ไป</div>
        <div class="stat-value" style="color:#ef4444">${money(monthExpenses)}</div>
        <div class="sku" style="margin-top:8px">เฉพาะเดือน ${new Date().toLocaleDateString('th-TH', {month:'long',year:'numeric'})}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #10b981">
        <div class="stat-label">รายรับเดือนนี้</div>
        <div class="stat-value" style="color:#10b981">${money(monthIncome)}</div>
        <div class="sku" style="margin-top:8px">จากการขาย</div>
      </div>
      <div class="stat-card" style="border-left:4px solid ${profit >= 0 ? '#0284c7' : '#ef4444'}">
        <div class="stat-label">${profit >= 0 ? 'กำไร' : 'ขาดทุน'}</div>
        <div class="stat-value" style="color:${profit >= 0 ? '#0284c7' : '#ef4444'}">${money(Math.abs(profit))}</div>
        <div class="sku" style="margin-top:8px">ยอด ${new Date().toLocaleDateString('th-TH', {month:'long'})}</div>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="panel mt16">
      <div class="row exp-filter-row" style="flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px">
          <label style="font-size:13px;color:var(--muted);font-weight:600">จากวันที่</label>
          <input id="expFilterFromDate" type="date" value="${_filterFromDate}" style="flex:1;min-width:100px" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px">
          <label style="font-size:13px;color:var(--muted);font-weight:600">ถึงวันที่</label>
          <input id="expFilterToDate" type="date" value="${_filterToDate}" style="flex:1;min-width:100px" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px">
          <label style="font-size:13px;color:var(--muted);font-weight:600">หมวดหมู่</label>
          <select id="expFilterCategory" style="flex:1;min-width:100px">
            <option value="">ทั้งหมด</option>
            ${EXPENSE_CATEGORIES.map(cat => `<option value="${cat.value}" ${_filterCategory === cat.value ? 'selected' : ''}>${cat.label}</option>`).join('')}
          </select>
        </div>
        <button id="expFilterClearBtn" class="btn light">ล้าง</button>
        <button id="expExportBtn" class="btn light" title="ส่งออก Excel ตาม filter ที่กำลังเลือก">📥 Excel</button>
        <button id="expAutoKeyBtn" class="btn" style="background:#7c3aed;color:#fff;border:none" title="ถ่ายรูปสลิป → AI กรอกให้อัตโนมัติ">📷 AutoKey</button>
        <button id="expAddBtn" class="btn primary">+ เพิ่มรายจ่าย</button>
      </div>
    </div>

    ${_showAddForm ? `
    <!-- Add/Edit Expense Form -->
    <div class="panel mt16" style="background:#f9fafb;border:2px dashed #d1d5db">
      <h4 style="margin:0 0 16px">${_editingExpenseId ? 'แก้ไขรายจ่าย' : 'เพิ่มรายจ่ายใหม่'}</h4>
      <div class="stack">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
          <div>
            <label style="font-size:13px;color:var(--muted);font-weight:600">วันที่</label>
            <input id="expFormDate" type="date" value="${_getFormValueDate()}" />
          </div>
          <div>
            <label style="font-size:13px;color:var(--muted);font-weight:600">หมวดหมู่</label>
            <select id="expFormCategory">
              <option value="">-- เลือก --</option>
              ${EXPENSE_CATEGORIES.map(cat => `<option value="${cat.value}" ${_getFormValueCategory() === cat.value ? 'selected' : ''}>${cat.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:13px;color:var(--muted);font-weight:600">วิธีชำระ</label>
            <select id="expFormMethod">
              <option value="">-- เลือก --</option>
              ${PAYMENT_METHODS.map(m => `<option value="${m.value}" ${_getFormValueMethod() === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:13px;color:var(--muted);font-weight:600">รายละเอียด</label>
          <input id="expFormDescription" placeholder="เช่น ค่าซื้อสินค้า ค่าน้ำมันรถ เป็นต้น" value="${_getFormValueDescription()}" />
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          <div>
            <label style="font-size:13px;color:var(--muted);font-weight:600">จำนวนเงิน (บาท)</label>
            <input id="expFormAmount" type="number" placeholder="0.00" step="0.01" value="${_getFormValueAmount()}" />
          </div>
        </div>
        <div>
          <label style="font-size:13px;color:var(--muted);font-weight:600">หมายเหตุ</label>
          <input id="expFormNote" placeholder="เพิ่มเติม (ถ้ามี)" value="${_getFormValueNote()}" />
        </div>
        <!-- ★ แนบรูปบิล (Phase 88.18c: แยก 2 ปุ่ม กล้อง vs แกลเลอรี่) -->
        <div>
          <label style="font-size:13px;color:var(--muted);font-weight:600">แนบรูปบิล / ใบเสร็จ</label>
          <div id="expProofSection" style="margin-top:8px">
            ${_getFormValueProof() ? `
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <img src="${_getFormValueProof()}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:2px solid #10b981" />
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <div style="color:#10b981;font-weight:600;font-size:13px;width:100%">มีรูปบิลแล้ว</div>
                  <button type="button" id="expChangeProofCameraBtn" class="btn light" style="font-size:11px;padding:4px 10px">📷 ถ่ายใหม่</button>
                  <button type="button" id="expChangeProofGalleryBtn" class="btn light" style="font-size:11px;padding:4px 10px">🖼️ เลือกใหม่</button>
                </div>
              </div>
            ` : `
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" id="expCaptureProofCameraBtn" style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:14px;background:#f0fdf4;border:2px dashed #86efac;border-radius:10px;cursor:pointer;text-align:left;font-size:14px">
                  <span style="font-size:22px">📷</span>
                  <div>
                    <div style="font-weight:700;color:#166534">ถ่ายรูป</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:2px">เปิดกล้อง</div>
                  </div>
                </button>
                <button type="button" id="expCaptureProofGalleryBtn" style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:14px;background:#eff6ff;border:2px dashed #93c5fd;border-radius:10px;cursor:pointer;text-align:left;font-size:14px">
                  <span style="font-size:22px">🖼️</span>
                  <div>
                    <div style="font-weight:700;color:#1e40af">แกลเลอรี่</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:2px">เลือกจากเครื่อง</div>
                  </div>
                </button>
              </div>
            `}
          </div>
          <!-- 2 file inputs — แยก capture vs no-capture (จำเป็นบน mobile) -->
          <input type="file" id="expProofFileCamera" accept="image/*" capture="environment" style="display:none" />
          <input type="file" id="expProofFileGallery" accept="image/*" style="display:none" />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="expFormCancelBtn" class="btn light">ยกเลิก</button>
          <button id="expFormSaveBtn" class="btn primary">บันทึก</button>
        </div>
      </div>
    </div>
    ` : ''}

    ${expenses.length === 0 ? renderEmpty({
      icon: "💸",
      title: "ยังไม่มีรายจ่าย",
      message: 'บันทึกค่าใช้จ่ายร้านเช่น ค่าน้ำมัน, ค่าเช่า, เงินเดือนพนักงาน — ใช้คำนวณกำไรสุทธิและรายงานทางการเงิน',
      actionLabel: "+ เพิ่มรายจ่าย",
      actionId: "expEmptyAddBtn"
    }) : ''}

    <!-- Expense List Table -->
    <div class="panel mt16"${expenses.length === 0 ? ' style="display:none"' : ''}>
      <h4 style="margin:0 0 12px">รายการรายจ่าย</h4>
      <div class="table-wrap">
        <table class="exp-table" style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb">
              <th style="padding:12px;text-align:left;font-weight:600;color:#374151">วันที่</th>
              <th style="padding:12px;text-align:left;font-weight:600;color:#374151">หมวดหมู่</th>
              <th style="padding:12px;text-align:left;font-weight:600;color:#374151">รายละเอียด</th>
              <th style="padding:12px;text-align:right;font-weight:600;color:#374151">จำนวนเงิน</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#374151">วิธีชำระ</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#374151">บิล</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#374151">แอคชัน</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map(exp => {
              const catLabel = EXPENSE_CATEGORIES.find(c => c.value === exp.category)?.label || exp.category || "-";
              const methodLabel = PAYMENT_METHODS.find(m => m.value === exp.payment_method)?.label || exp.payment_method || "-";
              return `
                <tr style="border-bottom:1px solid #e5e7eb;background:#fff" data-exp-id="${exp.id}">
                  <td style="padding:12px;color:#1f2937">${dateTH(exp.expense_date)}</td>
                  <td style="padding:12px;color:#1f2937">
                    <span style="background:#f0fdf4;color:#166534;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600">${escHtml(catLabel)}</span>
                  </td>
                  <td style="padding:12px;color:#1f2937">${escHtml(exp.description || "-")}</td>
                  <td style="padding:12px;text-align:right;color:#1f2937;font-weight:700">${money(exp.amount || 0)}</td>
                  <td style="padding:12px;text-align:center;color:#6b7280;font-size:13px">${escHtml(methodLabel)}</td>
                  <td style="padding:12px;text-align:center">${exp.receipt_url ? `<a href="${exp.receipt_url}" target="_blank" style="text-decoration:none" title="ดูรูปบิล"><img src="${exp.receipt_url}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;cursor:pointer" /></a>` : '<span style="color:#d1d5db">-</span>'}</td>
                  <td style="padding:12px;text-align:center;white-space:nowrap">
                    <button class="btn light exp-edit-btn" data-exp-edit="${exp.id}" style="padding:6px 10px;font-size:11px">แก้ไข</button>
                    <button class="btn light exp-delete-btn" data-exp-delete="${exp.id}" style="padding:6px 10px;font-size:11px;color:#dc2626">ลบ</button>
                  </td>
                </tr>
              `;
            }).join("") : `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--muted)">ไม่มีรายการรายจ่าย</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Monthly Summary Chart -->
    <div class="panel mt16">
      <h4 style="margin:0 0 16px">สรุปรายจ่ายตามหมวดหมู่เดือนนี้</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">
        ${renderCategoryChart(categoryTotals)}
      </div>
    </div>
  `;

  // ─── Bindings ───
  bindFilterEvents();
  bindAddFormEvents();
  bindTableActions();
}

// ═══════════════════════════════════════════════════════════
//  FORM HELPERS
// ═══════════════════════════════════════════════════════════
function _getFormValueDate() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return String(exp.expense_date || "").split("T")[0];
  }
  return todayBkk();   // Phase 92.47: Bangkok date (เดิม UTC → form default เป็นเมื่อวานตอนเช้า)
}

function _getFormValueCategory() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return exp.category || "";
  }
  return "";
}

function _getFormValueMethod() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return exp.payment_method || "";
  }
  return "";
}

function _getFormValueDescription() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return exp.description || "";
  }
  return "";
}

function _getFormValueAmount() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return Number(exp.amount || 0).toFixed(2);
  }
  return "";
}

function _getFormValueNote() {
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return exp.note || "";
  }
  return "";
}

function _getFormValueProof() {
  if (_pendingExpProofUrl) return _pendingExpProofUrl;
  if (_editingExpenseId) {
    const exp = _ctx.state.expenses.find(e => e.id === _editingExpenseId);
    if (exp) return exp.receipt_url || "";
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════════════════════
function bindFilterEvents() {
  document.getElementById("expFilterFromDate")?.addEventListener("change", (e) => {
    _filterFromDate = e.target.value;
    renderExpensesPage(_ctx);
  });

  document.getElementById("expFilterToDate")?.addEventListener("change", (e) => {
    _filterToDate = e.target.value;
    renderExpensesPage(_ctx);
  });

  document.getElementById("expFilterCategory")?.addEventListener("change", (e) => {
    _filterCategory = e.target.value;
    renderExpensesPage(_ctx);
  });

  document.getElementById("expFilterClearBtn")?.addEventListener("click", () => {
    // Phase 92.47: Bangkok date (เดิม toISOString = UTC → off-by-1 เช้าวันที่ 1)
    const todayStr = todayBkk();
    _filterFromDate = todayStr.slice(0, 7) + "-01";
    _filterToDate = todayStr;
    _filterCategory = "";
    renderExpensesPage(_ctx);
  });

  document.getElementById("expEmptyAddBtn")?.addEventListener("click", () => {
    document.getElementById("expAddBtn")?.click();
  });
  document.getElementById("expAddBtn")?.addEventListener("click", () => {
    _showAddForm = true;
    _editingExpenseId = null;
    renderExpensesPage(_ctx);
  });

  // Phase 74: AutoKey OCR — upload สลิปแล้วให้ Gemini parse
  document.getElementById("expAutoKeyBtn")?.addEventListener("click", () => _openAutoKeyModal(_ctx));

  // Phase 70 (D3): Export filtered expenses to Excel
  // Phase 89.35 (Bug 2): recompute the filter inside the handler — `filtered`
  // from renderExpensesPage() is out of scope here, which silently broke
  // export since Phase 70.
  document.getElementById("expExportBtn")?.addEventListener("click", () => {
    const expenses = _ctx?.state?.expenses || [];
    let filtered = [...expenses];
    if (_filterFromDate) filtered = filtered.filter(e => String(e.expense_date || "") >= _filterFromDate);
    if (_filterToDate)   filtered = filtered.filter(e => String(e.expense_date || "") <= _filterToDate);
    if (_filterCategory) filtered = filtered.filter(e => e.category === _filterCategory);
    filtered.sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

    const rows = filtered.map(e => ({
      "วันที่": (e.expense_date || e.created_at || "").slice(0, 10),
      "หมวด": e.category || "",
      "รายละเอียด": e.description || "",
      "จำนวนเงิน": Number(e.amount || 0),
      "วิธีชำระ": e.payment_method || "",
      "หมายเหตุ": e.note || ""
    }));
    const ok = exportToExcel(`รายจ่าย_${todaySuffix()}.xlsx`, rows, "Expenses");
    if (ok) _ctx?.showToast?.(`ดาวน์โหลด ${rows.length} รายการแล้ว`);
  });
}

function bindAddFormEvents() {
  document.getElementById("expFormCancelBtn")?.addEventListener("click", () => {
    _showAddForm = false;
    _editingExpenseId = null;
    _pendingExpProofUrl = "";
    renderExpensesPage(_ctx);
  });

  // ★ Phase 88.18c: 2 ปุ่ม + 2 file inputs — แยก กล้อง vs แกลเลอรี่
  const cameraInput  = document.getElementById("expProofFileCamera");
  const galleryInput = document.getElementById("expProofFileGallery");
  const cameraBtn    = document.getElementById("expCaptureProofCameraBtn")  || document.getElementById("expChangeProofCameraBtn");
  const galleryBtn   = document.getElementById("expCaptureProofGalleryBtn") || document.getElementById("expChangeProofGalleryBtn");
  cameraBtn?.addEventListener("click",  () => cameraInput?.click());
  galleryBtn?.addEventListener("click", () => galleryInput?.click());

  // shared change handler — ใช้กับทั้ง 2 inputs
  const proofChangeHandler = async (e) => {
    let file = e.target.files?.[0];
    if (!file) return;

    // ★ บีบอัดรูปก่อนอัปโหลด
    // eslint-disable-next-line require-atomic-updates -- C: local file param reassign in upload flow (sequential)
    if (window._compressImage) file = await window._compressImage(file);

    const proofSection = document.getElementById("expProofSection");
    // แสดง preview ทันที
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (proofSection) {
        proofSection.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px">
            <img src="${ev.target.result}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:2px solid #10b981" />
            <div>
              <div style="color:#10b981;font-weight:600;font-size:13px" id="expProofStatus">📤 กำลังอัปโหลด...</div>
              <button type="button" id="expChangeProofBtn2" class="btn light" style="margin-top:4px;font-size:11px;padding:4px 10px">เปลี่ยนรูป</button>
            </div>
          </div>
        `;
        document.getElementById("expChangeProofBtn2")?.addEventListener("click", () => galleryInput?.click());
      }
    };
    reader.readAsDataURL(file);

    // อัปโหลดไป Supabase Storage
    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      const ts = Date.now();
      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `expenses/${ts}_${Math.random().toString(36).slice(2)}.${ext}`;

      let proofUrl = "";
      try {
        const uploadRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
          method: "POST",
          headers: {
            "apikey": cfg.anonKey,
            "Authorization": `Bearer ${token}`,
            "Content-Type": file.type || "image/jpeg",
            "x-upsert": "true"
          },
          body: file
        });
        if (uploadRes.ok) {
          proofUrl = `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
          const s = document.getElementById("expProofStatus");
          if (s) s.textContent = "✅ อัปโหลดสำเร็จ!";
          _ctx.showToast?.("อัปโหลดรูปบิลสำเร็จ ✅");
        } else { throw new Error("Storage failed"); }
      } catch (uploadErr) {
        // Fallback: base64
        proofUrl = await new Promise(resolve => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(file);
        });
        const s = document.getElementById("expProofStatus");
        if (s) s.textContent = "✅ บันทึกรูปแล้ว (เก็บในเครื่อง)";
        _ctx.showToast?.("บันทึกรูปบิลแล้ว (offline)");
      }
      _pendingExpProofUrl = proofUrl;
    } catch (err) {
      console.error("Expense proof upload error:", err);
    }
  };
  // register handler ให้ทั้ง 2 inputs
  cameraInput?.addEventListener("change",  proofChangeHandler);
  galleryInput?.addEventListener("change", proofChangeHandler);

  document.getElementById("expFormSaveBtn")?.addEventListener("click", async (ev) => {
    const saveBtn = ev.currentTarget;
    if (saveBtn.disabled) return; // ★ กัน double-click

    const date = document.getElementById("expFormDate")?.value || "";
    const category = document.getElementById("expFormCategory")?.value || "";
    const method = document.getElementById("expFormMethod")?.value || "";
    const description = document.getElementById("expFormDescription")?.value || "";
    const amount = Number(document.getElementById("expFormAmount")?.value || 0);
    const note = document.getElementById("expFormNote")?.value || "";

    if (!date || !category || !method || !description || amount <= 0) {
      _ctx.showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "error");
      return;
    }

    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    // ★ รวม receipt_url ใน payload
    const receiptUrl = _pendingExpProofUrl || _getFormValueProof() || "";
    const payload = {
      expense_date: date,
      category: category,
      payment_method: method,
      description: description,
      amount: amount,
      note: note
    };
    if (receiptUrl && receiptUrl.startsWith("http")) {
      payload.receipt_url = receiptUrl;
    }

    try {
      let jvPostWarning = null;
      if (_editingExpenseId) {
        // Phase 89.29 (audit C4): edit expense → void old JV + repost ด้วยข้อมูลใหม่
        // เดิม PATCH expense แต่ JV เดิมค้าง → P&L ไม่ตรง DB
        const editId = _editingExpenseId;
        await voidJvForSource("expenses", editId).catch(e =>
          console.warn("[expenses] voidJV before edit failed:", e?.message));
        const res = await window._appXhrPatch?.("expenses", payload, "id", editId);
        if (res && res.ok === false) throw new Error(res.error?.message || "update failed");
        // repost JV ด้วย amount/category/method ใหม่.
        try {
          await postJournalForExpense({ id: editId, ...payload });
        } catch (e) {
          console.warn("[expenses] repost JV after edit failed:", e?.message);
          jvPostWarning = "อัปเดตรายจ่ายแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill";
        }
        _ctx.showToast("อัปเดตรายจ่ายเรียบร้อย", "success");
      } else {
        // ★ Phase 88.1a: ขอ returnData เพื่อเอา id ไป auto-post JV
        const res = await window._appXhrPost?.("expenses", payload, { returnData: true });
        if (res && res.ok === false) throw new Error(res.error?.message || "insert failed");
        _ctx.showToast("เพิ่มรายจ่ายเรียบร้อย", "success");

        // ★ Phase 88.1a: auto-post JV
        const inserted = res?.data;
        if (inserted?.id) {
          try {
            await postJournalForExpense(inserted);
          } catch (e) {
            console.warn("[expenses] auto-post JV failed:", e?.message);
            jvPostWarning = "เพิ่มรายจ่ายแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill";
          }
        }
      }
      if (jvPostWarning) _ctx.showToast(jvPostWarning, "warn");

      _showAddForm = false;
      /* eslint-disable require-atomic-updates -- LOW_RISK: L3 module state reset after save (single edit session) */
      _editingExpenseId = null;
      _pendingExpProofUrl = "";
      /* eslint-enable require-atomic-updates */
      await _ctx.loadAllData?.();
      renderExpensesPage(_ctx);
    } catch (err) {
      console.error("[expenses save] error:", err);
      _ctx.showToast("❌ บันทึกไม่สำเร็จ: " + (err.message || err), "error");
    } finally {
      if (saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }
  });
}

function bindTableActions() {
  document.querySelectorAll(".exp-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const expId = Number(btn.dataset.expEdit);
      _editingExpenseId = expId;
      _showAddForm = true;
      renderExpensesPage(_ctx);
    });
  });

  document.querySelectorAll(".exp-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const expId = Number(btn.dataset.expDelete);
      const exp = _ctx.state.expenses.find(e => e.id === expId);
      if (!exp) return;
      if (await window.App?.confirm?.(`ยืนยันการลบรายจ่าย "${exp.description}" หรือไม่?`)) {
        try {
          // Phase 388: void JV ที่ auto-post ไว้ก่อนลบ ไม่งั้น JV ค้างเป็น orphan (ให้ตรงกับ sales/receipts/payroll)
          await voidJvForSource("expenses", expId).catch(e =>
            console.warn("[expenses] voidJV before delete failed:", e?.message));
          const delRes = await window._appXhrDelete?.("expenses", "id", expId);
          if (delRes && !delRes.ok) throw new Error(delRes.error?.message || "delete failed");
          _ctx.showToast("ลบรายจ่ายเรียบร้อย", "success");
          await _ctx.loadAllData?.();
          renderExpensesPage(_ctx);
        } catch (e) {
          console.error("[expenses delete] error:", e);
          _ctx.showToast("❌ ลบรายจ่ายไม่สำเร็จ: " + (e.message || e), "error");
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  CATEGORY CHART
// ═══════════════════════════════════════════════════════════
function renderCategoryChart(categoryTotals) {
  const maxValue = Math.max(...Object.values(categoryTotals), 1);

  return EXPENSE_CATEGORIES.map(cat => {
    const value = categoryTotals[cat.value] || 0;
    const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
    const colors = {
      materials: "#3b82f6",
      fuel: "#f59e0b",
      labor_hire: "#ec4899",
      salary: "#8b5cf6",
      rent: "#06b6d4",
      utilities: "#6366f1",
      other: "#6b7280"
    };
    const barColor = colors[cat.value] || "#9ca3af";

    return `
      <div>
        <div style="margin-bottom:8px">
          <div style="font-weight:600;color:#1f2937;margin-bottom:4px">${cat.label}</div>
          <div style="font-size:18px;font-weight:700;color:${barColor}">${money(value)}</div>
        </div>
        <div style="background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden">
          <div style="background:${barColor};height:100%;width:${percentage}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
//  Phase 74: AutoKey OCR — ถ่ายรูปสลิป → Gemini Vision → กรอกฟอร์ม
// ═══════════════════════════════════════════════════════════
function _openAutoKeyModal(ctx) {
  document.getElementById("akModal")?.remove();
  const m = document.createElement("div");
  m.id = "akModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto";
  m.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:520px;width:100%;padding:22px;max-height:92vh;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="font-size:24px">📷</span>
        <h3 style="margin:0;font-size:17px;color:#0f172a;flex:1">AutoKey สลิปค่าใช้จ่าย</h3>
        <button id="akClose" style="background:#f1f5f9;border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px">×</button>
      </div>
      <div id="akStep1" style="display:block">
        <div style="background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px;margin-bottom:12px;font-size:12px;color:#6b21a8;line-height:1.6">
          📸 ถ่ายรูปสลิป/ใบเสร็จซัพพลายเออร์ → AI จะอ่านเลข ที่อยู่ ยอดรวม ให้อัตโนมัติ<br>
          <b>เคล็ดลับ:</b> ถ่ายให้สว่าง • ตัวเลขชัดเจน • ทั้งใบ
        </div>
        <input id="akFile" type="file" accept="image/*" style="display:none" />
        <input id="akFileCam" type="file" accept="image/*" capture="environment" style="display:none" />
        <button id="akPickCamBtn" type="button" style="width:100%;padding:16px;background:#7c3aed;color:#fff;border:none;border-radius:12px;cursor:pointer;font-size:15px;font-weight:700;margin-bottom:8px">📷 ถ่ายรูปสลิป (เปิดกล้อง)</button>
        <button id="akPickBtn" type="button" style="width:100%;padding:14px;background:#fff;color:#7c3aed;border:2px solid #7c3aed;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600">🖼️ เลือกจากคลังภาพ / ไฟล์</button>
      </div>

      <div id="akStep2" style="display:none">
        <div style="text-align:center;margin-bottom:12px">
          <img id="akPreview" alt="preview" style="max-width:100%;max-height:280px;border-radius:10px;border:1px solid #e2e8f0" />
        </div>
        <button id="akAnalyzeBtn" type="button" style="width:100%;padding:14px;background:#7c3aed;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700">🔍 ให้ AI วิเคราะห์ใบเสร็จ</button>
        <button id="akRetakeBtn" type="button" style="width:100%;margin-top:6px;padding:10px;background:#f1f5f9;color:#475569;border:none;border-radius:10px;cursor:pointer;font-size:13px">เลือกรูปใหม่</button>
      </div>

      <div id="akStep3" style="display:none">
        <div id="akProgress" style="text-align:center;padding:24px;color:#7c3aed;font-size:14px">
          <div style="font-size:36px;margin-bottom:8px">🔍</div>
          <div>กำลังให้ AI อ่านสลิป... (~5-10 วิ)</div>
        </div>
      </div>

      <div id="akStep4" style="display:none">
        <div id="akResult"></div>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("akClose")?.addEventListener("click", () => m.remove());

  const fileInp = document.getElementById("akFile");
  const fileCamInp = document.getElementById("akFileCam");
  const previewImg = document.getElementById("akPreview");
  let _imageDataUrl = null;

  document.getElementById("akPickBtn")?.addEventListener("click", () => fileInp.click());
  document.getElementById("akPickCamBtn")?.addEventListener("click", () => fileCamInp.click());
  document.getElementById("akRetakeBtn")?.addEventListener("click", () => fileInp.click());

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    _imageDataUrl = await _resizeImage(f, 1280);
    previewImg.src = _imageDataUrl;
    document.getElementById("akStep1").style.display = "none";
    document.getElementById("akStep2").style.display = "block";
    document.getElementById("akStep4").style.display = "none";
  };
  fileInp.addEventListener("change", onPick);
  fileCamInp.addEventListener("change", onPick);

  // ★ Phase 17 middleware: /api/parse-receipt อยู่ใน REQUIRE_AUTH_ENDPOINTS — ต้องแนบ Supabase JWT
  //   ของ staff ที่ login (anonKey เป็น publishable key ไม่ใช่ JWT → จะโดน 401). ถ้าไม่มี token/หมดอายุ
  //   แสดงข้อความให้เข้าสู่ระบบใหม่ แทน error กว้าง ๆ ที่อ่านไม่รู้เรื่อง
  const _akShowAuthError = () => {
    document.getElementById("akStep2").style.display = "none";
    document.getElementById("akStep3").style.display = "none";
    document.getElementById("akStep4").style.display = "block";
    document.getElementById("akResult").innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:13px;line-height:1.6"><b>🔒 ต้องเข้าสู่ระบบก่อนใช้ AutoKey</b><br>เซสชันหมดอายุหรือยังไม่ได้ล็อกอิน — กรุณาเข้าสู่ระบบใหม่แล้วลองวิเคราะห์อีกครั้ง</div>
      <button id="ak-back-btn-auth" style="margin-top:10px;padding:10px;width:100%;background:#f1f5f9;border:none;border-radius:8px;cursor:pointer;font-size:13px">← กลับ</button>`;
    document.getElementById("ak-back-btn-auth")?.addEventListener("click", () => {
      document.getElementById("akStep2").style.display = "block";
      document.getElementById("akStep4").style.display = "none";
    });
  };

  document.getElementById("akAnalyzeBtn")?.addEventListener("click", async () => {
    if (!_imageDataUrl) return;
    // อ่าน token ตอนกด (เผื่อ refresh ระหว่างเปิด modal) — ไม่มี token = ไม่ต้องยิงให้เสีย quota
    const _akToken = window._sbAccessToken;
    if (!_akToken) { _akShowAuthError(); return; }
    document.getElementById("akStep2").style.display = "none";
    document.getElementById("akStep3").style.display = "block";
    try {
      const r = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + _akToken },
        body: JSON.stringify({ image: _imageDataUrl }),
        cache: "no-store"
      });
      // 401 = token หมดอายุ/ถูกเพิกถอนระหว่างทาง → ให้ login ใหม่ แทน "Server ตอบไม่ใช่ JSON"
      if (r.status === 401) { _akShowAuthError(); return; }
      const ct = r.headers.get("content-type") || "";
      const raw = await r.text();
      let j;
      try {
        j = JSON.parse(raw);
      } catch (parseErr) {
        document.getElementById("akStep3").style.display = "none";
        document.getElementById("akStep4").style.display = "block";
        // Cloudflare 520/524/502/504 = origin/timeout error → friendlier message
        const isCfError = [520, 521, 522, 523, 524, 502, 504].includes(r.status);
        const friendly = isCfError
          ? `<b>⚠️ Cloudflare timeout (HTTP ${r.status})</b><br>
             AI ใช้เวลานานเกินไป — ลองรูปเล็กลง / ภาพชัดขึ้น / เครือข่ายเร็วขึ้น`
          : `<b>❌ Server ตอบไม่ใช่ JSON</b><br>HTTP ${r.status} · ${escHtml(ct)}<br><small>raw: ${escHtml(raw.slice(0, 150))}</small>`;
        document.getElementById("akResult").innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:13px;line-height:1.6">${friendly}</div>
        <button id="ak-back-btn-1" style="margin-top:10px;padding:10px;width:100%;background:#f1f5f9;border:none;border-radius:8px;cursor:pointer;font-size:13px">← กลับ</button>`;
        document.getElementById("ak-back-btn-1")?.addEventListener("click", () => {
          document.getElementById("akStep2").style.display = "block";
          document.getElementById("akStep4").style.display = "none";
        });
        return;
      }
      document.getElementById("akStep3").style.display = "none";
      if (!j.ok) {
        const errMsg = j.configured === false
          ? "❌ ยังไม่ตั้ง GEMINI_API_KEY ใน Cloudflare → Settings → Environment variables"
          : "❌ " + (j.error || "วิเคราะห์ไม่สำเร็จ");
        document.getElementById("akStep4").style.display = "block";
        document.getElementById("akResult").innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:13px">${errMsg}${j.detail ? '<br><small>'+escHtml(String(j.detail).slice(0,200))+'</small>' : ''}</div>
          <button id="ak-back-btn-2" style="margin-top:10px;padding:10px;width:100%;background:#f1f5f9;border:none;border-radius:8px;cursor:pointer;font-size:13px">← กลับไปลองใหม่</button>`;
        document.getElementById("ak-back-btn-2")?.addEventListener("click", () => {
          document.getElementById("akStep2").style.display = "block";
          document.getElementById("akStep4").style.display = "none";
        });
        return;
      }
      _showParsedResult(ctx, m, _imageDataUrl, j.data);
    } catch (e) {
      document.getElementById("akStep3").style.display = "none";
      document.getElementById("akStep4").style.display = "block";
      document.getElementById("akResult").innerHTML = `<div style="padding:14px;background:#fef2f2;color:#991b1b;border-radius:10px">เชื่อมต่อล้มเหลว: ${escHtml(e.message || String(e))}</div>`;
    }
  });
}

async function _resizeImage(file, maxDim) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _showParsedResult(ctx, modal, imageDataUrl, data) {
  const d = data || {};
  document.getElementById("akStep4").style.display = "block";
  const resultEl = document.getElementById("akResult");
  const today = todayBkk();   // Phase 92.47: Bangkok date (เดิม UTC slice)
  resultEl.innerHTML = `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#15803d">
      ✓ AI อ่านได้แล้ว — ตรวจสอบและแก้ไขก่อนบันทึก
    </div>
    <div style="display:grid;gap:8px">
      <label style="display:block">
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">ชื่อร้าน/ผู้จำหน่าย</div>
        <input id="akEdVendor" type="text" value="${escHtml(d.vendor || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
      </label>
      <label style="display:block">
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">เลขที่ใบเสร็จ</div>
        <input id="akEdDocNo" type="text" value="${escHtml(d.doc_no || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
      </label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
        <label style="display:block">
          <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">วันที่</div>
          <input id="akEdDate" type="date" value="${escHtml(d.date || today)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
        </label>
        <label style="display:block">
          <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">ยอดรวม (บาท) *</div>
          <input id="akEdAmount" type="number" step="0.01" value="${Number(d.total || 0)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;text-align:right;font-weight:700" />
        </label>
      </div>
      <label style="display:block">
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">หมวด (ใช้คำนวณสรุปรายเดือน)</div>
        <select id="akEdCategory" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff">
          ${EXPENSE_CATEGORIES.map(c => `<option value="${c.value}"${c.value === _guessEnumCategory(d.category_guess) ? ' selected' : ''}>${c.label}</option>`).join('')}
        </select>
        ${d.category_guess ? `<div style="font-size:10px;color:#64748b;margin-top:3px">AI เดา: <b>${escHtml(d.category_guess)}</b></div>` : ''}
      </label>
      <label style="display:block">
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">รายละเอียด</div>
        <textarea id="akEdDesc" rows="2" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical">${escHtml((d.vendor || '') + (d.doc_no ? ' #' + d.doc_no : '') + (d.tax_id ? ' (ภาษี: ' + d.tax_id + ')' : ''))}</textarea>
      </label>
      ${d.tax_id ? `<div style="font-size:11px;color:#64748b">เลขประจำตัวผู้เสียภาษี: <b>${escHtml(d.tax_id)}</b></div>` : ''}
      ${Array.isArray(d.items) && d.items.length > 0 ? `
        <div style="font-size:11px;color:#64748b;margin-top:4px">รายการที่ AI อ่านได้:</div>
        <div style="background:#f8fafc;border-radius:6px;padding:6px 8px;font-size:11px;color:#475569;max-height:80px;overflow-y:auto">
          ${d.items.map(it => `• ${escHtml(it.name || '-')} ${it.qty ? '×' + it.qty : ''} ${it.amount ? '= ' + Number(it.amount).toLocaleString('th-TH') : ''}`).join('<br>')}
        </div>` : ''}
    </div>
    <div id="akDupWarn"></div>
    <div id="akResultStatus" style="margin-top:10px;font-size:12px;color:#dc2626;min-height:14px"></div>
    <button id="akSaveBtn" type="button" style="margin-top:12px;width:100%;padding:14px;background:#10b981;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700">💾 บันทึกเป็นรายจ่าย</button>
  `;

  // ★ Duplicate check — ตรวจว่าเคยสแกนบิลนี้แล้วยัง (จาก doc_no หรือ vendor+amount+date)
  _findDuplicateExpense(d).then(dup => {
    if (!dup) return;
    const warnEl = document.getElementById("akDupWarn");
    if (!warnEl) return;
    warnEl.innerHTML = `
      <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:12px;color:#92400e;line-height:1.5">
        ⚠️ <b>เคยบันทึกบิลนี้แล้ว!</b><br>
        📅 ${escHtml(dup.expense_date || '')} · 💰 ${Number(dup.amount || 0).toLocaleString('th-TH')} บาท · ${escHtml(dup.category || '')}<br>
        <span style="color:#78350f">"${escHtml(dup.description || dup.note || '')}"</span>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer;padding:6px 8px;background:#fff;border-radius:6px">
          <input type="checkbox" id="akDupConfirm" style="width:16px;height:16px;cursor:pointer" />
          <span style="font-weight:700">ยืนยันบันทึกซ้ำ (เป็นบิลคนละใบ)</span>
        </label>
      </div>
    `;
    const saveBtn = document.getElementById("akSaveBtn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.5";
      saveBtn.style.cursor = "not-allowed";
    }
    document.getElementById("akDupConfirm")?.addEventListener("change", (e) => {
      if (!saveBtn) return;
      const ok = e.target.checked;
      saveBtn.disabled = !ok;
      saveBtn.style.opacity = ok ? "1" : "0.5";
      saveBtn.style.cursor = ok ? "pointer" : "not-allowed";
    });
  });

  document.getElementById("akSaveBtn")?.addEventListener("click", async () => {
    const setErr = (msg) => { const el = document.getElementById("akResultStatus"); if (el) el.textContent = msg || ""; };
    setErr("");
    const amount = Number(document.getElementById("akEdAmount")?.value || 0);
    if (!(amount > 0)) { setErr("กรอกยอดเงินให้ถูกต้อง"); return; }
    const date = document.getElementById("akEdDate")?.value || today;
    const category = document.getElementById("akEdCategory")?.value?.trim() || "other";
    const description = document.getElementById("akEdDesc")?.value?.trim() || "";

    const btn = document.getElementById("akSaveBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ อัปโหลดรูป...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken;

      // Phase 74.9: Upload รูปสลิปไป Supabase Storage ก่อน insert
      let receiptUrl = "";
      if (imageDataUrl && imageDataUrl.startsWith("data:")) {
        try {
          // Convert base64 data URL → Blob
          const blob = await (await fetch(imageDataUrl)).blob();
          const ts = Date.now();
          const filePath = `expenses/autokey_${ts}_${Math.random().toString(36).slice(2)}.jpg`;
          const upRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
            method: "POST",
            headers: {
              "apikey": cfg.anonKey,
              "Authorization": "Bearer " + token,
              "Content-Type": blob.type || "image/jpeg",
              "x-upsert": "true"
            },
            body: blob
          });
          if (upRes.ok) {
            receiptUrl = `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
          } else {
            console.warn("AutoKey image upload failed:", upRes.status);
          }
        } catch (upErr) {
          console.warn("AutoKey upload error:", upErr);
        }
      }

      btn.textContent = "⏳ บันทึก...";
      // ★ Phase 88.1a: ขอ representation เพื่อเอา id กลับมา auto-post JV
      const headers = { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer": "return=representation" };
      const payload = {
        expense_date: date,
        category,
        description,
        amount,
        note: "บันทึกผ่าน AutoKey · " + (d.vendor || "")
      };
      if (receiptUrl) payload.receipt_url = receiptUrl;

      const r = await fetch(cfg.url + "/rest/v1/expenses", { method: "POST", headers, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("HTTP " + r.status);

      // ★ Phase 88.1a: parse inserted row → auto-post JV
      let jvPostWarning = null;
      try {
        const arr = await r.json();
        const inserted = Array.isArray(arr) ? arr[0] : arr;
        if (inserted?.id) {
          try {
            await postJournalForExpense(inserted);
          } catch (postErr) {
            console.warn("[expenses-autokey] auto-post JV failed:", postErr?.message);
            jvPostWarning = "บันทึกรายจ่ายแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill";
          }
        }
      } catch (parseErr) {
        console.warn("[expenses-autokey] parse insert response failed:", parseErr?.message);
      }

      modal.remove();
      ctx.showToast?.(receiptUrl ? "บันทึกรายจ่าย + แนบรูปบิลแล้ว ✅" : "บันทึกรายจ่ายแล้ว (รูปบิลอัปโหลดไม่ได้)");
      if (jvPostWarning) ctx.showToast?.(jvPostWarning, "warn");
      if (ctx.loadAllData) await ctx.loadAllData();
      renderExpensesPage(ctx);
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + (e.message || e));
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

// Phase 74.8: Map AI Thai category guess → enum value ที่ระบบใช้จริง
function _guessEnumCategory(thai) {
  if (!thai) return "other";
  const t = String(thai).toLowerCase().trim();
  if (/น้ำมัน|เชื้อเพลิง|ดีเซล|แก๊ส|gas|fuel|ปั๊ม/i.test(t)) return "fuel";
  if (/น้ำ|ไฟฟ้า|ไฟ|โทรศัพท์|อินเทอร์เน็ต|internet|มือถือ|เน็ต|wifi/i.test(t)) return "utilities";
  if (/เช่า|rent/i.test(t)) return "rent";
  if (/เงินเดือน|salary|ค่าจ้างพนักงาน/i.test(t)) return "salary";
  if (/ค่าจ้าง|ช่าง|labor|จ้างเหมา/i.test(t)) return "labor_hire";
  if (/ซื้อสินค้า|วัสดุ|อะไหล่|materials|ของ/i.test(t)) return "materials";
  if (/ซ่อม|repair|ค่าอาหาร|กิน|ของกิน|อาหาร|food|อื่น/i.test(t)) return "other";
  return "other";
}

// Phase 74.7: ตรวจ duplicate expense จาก doc_no (เลขที่ใบเสร็จ) หรือ vendor+amount+date
async function _findDuplicateExpense(d) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken;
    if (!cfg || !token) return null;
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
    const select = "id,expense_date,amount,category,description,note";

    // 1) ตรวจจาก doc_no — แม่นที่สุด (description มี "#docNo")
    if (d.doc_no && String(d.doc_no).length >= 4) {
      const pat = encodeURIComponent('%#' + String(d.doc_no).trim() + '%');
      const url = `${cfg.url}/rest/v1/expenses?description=ilike.${pat}&select=${select}&limit=1&order=expense_date.desc`;
      const r = await fetch(url, { headers });
      if (r.ok) {
        const arr = await r.json();
        if (arr && arr.length > 0) return arr[0];
      }
    }

    // 2) Fallback — vendor + amount + date (เผื่อบิลไม่มีเลขที่)
    if (d.vendor && d.total > 0 && d.date) {
      const vendorPat = encodeURIComponent('%' + String(d.vendor).trim().slice(0, 30) + '%');
      const url = `${cfg.url}/rest/v1/expenses?note=ilike.${vendorPat}&amount=eq.${Number(d.total)}&expense_date=eq.${encodeURIComponent(d.date)}&select=${select}&limit=1`;
      const r = await fetch(url, { headers });
      if (r.ok) {
        const arr = await r.json();
        if (arr && arr.length > 0) return arr[0];
      }
    }
  } catch (e) {
    console.warn("dup check fail", e);
  }
  return null;
}
