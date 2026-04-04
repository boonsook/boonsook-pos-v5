// ═══════════════════════════════════════════════════════════
//  EXPENSES MODULE — รายรับ-รายจ่าย
//  ★ Expense tracking with categories, summary cards, and monthly chart
// ═══════════════════════════════════════════════════════════

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
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!_filterFromDate) _filterFromDate = firstDay.toISOString().split('T')[0];
  if (!_filterToDate) _filterToDate = now.toISOString().split('T')[0];

  const expenses = ctx.state.expenses || [];
  // ★ กรอง soft-deleted sales ออกก่อนคำนวณรายรับ
  const sales = (ctx.state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]"));

  // Calculate summary values
  const thisMonth = now.toISOString().split('T')[0].slice(0, 7);
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
      <div class="row" style="flex-wrap:wrap;gap:12px">
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
        <!-- ★ แนบรูปบิล -->
        <div>
          <label style="font-size:13px;color:var(--muted);font-weight:600">แนบรูปบิล / ใบเสร็จ</label>
          <div id="expProofSection" style="margin-top:8px">
            ${_getFormValueProof() ? `
              <div style="display:flex;align-items:center;gap:12px">
                <img src="${_getFormValueProof()}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:2px solid #10b981" />
                <div>
                  <div style="color:#10b981;font-weight:600;font-size:13px">มีรูปบิลแล้ว</div>
                  <button type="button" id="expChangeProofBtn" class="btn light" style="margin-top:4px;font-size:11px;padding:4px 10px">เปลี่ยนรูป</button>
                </div>
              </div>
            ` : `
              <button type="button" id="expCaptureProofBtn" style="display:flex;align-items:center;gap:10px;padding:14px;background:#f0fdf4;border:2px dashed #86efac;border-radius:10px;cursor:pointer;width:100%;text-align:left;font-size:14px">
                <span style="font-size:24px">📷</span>
                <div>
                  <div style="font-weight:700;color:#166534">ถ่ายรูป / เลือกรูปบิล</div>
                  <div style="font-size:11px;color:#6b7280;margin-top:2px">ถ่ายรูปบิล หรือเลือกจากแกลเลอรี่</div>
                </div>
              </button>
            `}
          </div>
          <input type="file" id="expProofFileInput" accept="image/*" capture="environment" style="display:none" />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="expFormCancelBtn" class="btn light">ยกเลิก</button>
          <button id="expFormSaveBtn" class="btn primary">บันทึก</button>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Expense List Table -->
    <div class="panel mt16">
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
  return new Date().toISOString().split('T')[0];
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
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    _filterFromDate = firstDay.toISOString().split('T')[0];
    _filterToDate = now.toISOString().split('T')[0];
    _filterCategory = "";
    renderExpensesPage(_ctx);
  });

  document.getElementById("expAddBtn")?.addEventListener("click", () => {
    _showAddForm = true;
    _editingExpenseId = null;
    renderExpensesPage(_ctx);
  });
}

function bindAddFormEvents() {
  document.getElementById("expFormCancelBtn")?.addEventListener("click", () => {
    _showAddForm = false;
    _editingExpenseId = null;
    _pendingExpProofUrl = "";
    renderExpensesPage(_ctx);
  });

  // ★ ถ่ายรูป / เลือกรูปบิล
  const proofInput = document.getElementById("expProofFileInput");
  const captureBtn = document.getElementById("expCaptureProofBtn") || document.getElementById("expChangeProofBtn");
  captureBtn?.addEventListener("click", () => proofInput?.click());

  proofInput?.addEventListener("change", async (e) => {
    let file = e.target.files?.[0];
    if (!file) return;

    // ★ บีบอัดรูปก่อนอัปโหลด
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
        document.getElementById("expChangeProofBtn2")?.addEventListener("click", () => proofInput?.click());
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
  });

  document.getElementById("expFormSaveBtn")?.addEventListener("click", () => {
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

    if (_editingExpenseId) {
      window._appXhrPatch?.("expenses", payload, "id", _editingExpenseId);
      _ctx.showToast("อัปเดตรายจ่ายเรียบร้อย", "success");
    } else {
      window._appXhrPost?.("expenses", payload, {});
      _ctx.showToast("เพิ่มรายจ่ายเรียบร้อย", "success");
    }

    _showAddForm = false;
    _editingExpenseId = null;
    _pendingExpProofUrl = "";
    _ctx.loadAllData?.();
    setTimeout(() => renderExpensesPage(_ctx), 300);
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
    btn.addEventListener("click", () => {
      const expId = Number(btn.dataset.expDelete);
      const exp = _ctx.state.expenses.find(e => e.id === expId);
      if (!exp) return;
      if (confirm(`ยืนยันการลบรายจ่าย "${exp.description}" หรือไม่?`)) {
        window._appXhrDelete?.("expenses", "id", expId);
        _ctx.showToast("ลบรายจ่ายเรียบร้อย", "success");
        _ctx.loadAllData?.();
        setTimeout(() => renderExpensesPage(_ctx), 300);
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
