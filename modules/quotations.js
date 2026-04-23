// ═══════════════════════════════════════════════════════════
//  QUOTATIONS MODULE — ใบเสนอราคา (FlowAccount-style)
//  ★ รายการสินค้า, ส่วนลด, หัก ณ ที่จ่าย, preview เอกสาร
// ═══════════════════════════════════════════════════════════

// share ใช้ window._appShareDoc จาก main.js

function money(n){ return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0)); }
function num(n){ return new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0)); }
function dateTH(d){ if(!d) return "-"; try{ return new Date(d).toLocaleDateString("th-TH",{year:"numeric",month:"short",day:"numeric"}); }catch(e){ return d; } }

const STATUS_LABELS = {
  pending:   "รออนุมัติ",
  approved:  "อนุมัติแล้ว",
  invoiced:  "ออกใบส่งสินค้าแล้ว",
  receipted: "ออกใบเสร็จแล้ว",
  expired:   "หมดอายุ",
  cancelled: "ยกเลิก",
  draft:     "ร่าง",
  sent:      "ส่งแล้ว",
  rejected:  "ปฏิเสธ"
};
const STATUS_COLOR = {
  pending:   "#f59e0b",
  approved:  "#10b981",
  invoiced:  "#0284c7",
  receipted: "#6366f1",
  expired:   "#9ca3af",
  cancelled: "#ef4444",
  draft:     "#9ca3af",
  sent:      "#0284c7",
  rejected:  "#ef4444"
};

// ═══ Module-level state ═══
let _ctx = null;
let _lineItems = [];
let _editingId = null;
let _viewMode = "list";    // list | form | preview

// ═══════════════════════════════════════════════════════════
//  RENDER — List Page
// ═══════════════════════════════════════════════════════════
export function renderQuotationsPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-quotations");
  if (!container) return;

  if (_viewMode === "form") { renderQuotationForm(container); return; }
  if (_viewMode === "preview") { renderQuotationPreview(container); return; }

  _viewMode = "list";
  const quotations = ctx.state.quotations || [];

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบเสนอราคา</h3>
        <button id="qtAddBtn" class="btn primary">+ สร้างใบเสนอราคา</button>
      </div>

      <div class="stats-grid mt16" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="stat-label">ทั้งหมด</div>
          <div class="stat-value">${quotations.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">รออนุมัติ</div>
          <div class="stat-value" style="color:#f59e0b">${quotations.filter(q=>q.status==="pending").length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">อนุมัติแล้ว</div>
          <div class="stat-value" style="color:#10b981">${quotations.filter(q=>q.status==="approved").length}</div>
        </div>
      </div>

      <div class="card-list mt16">
        ${quotations.length ? quotations.map(q => {
          const customerName = q.customer_name || q.customer || "-";
          const amount       = q.grand_total || q.total_amount || q.amount || 0;
          const docNo        = q.qt_no || q.title || "-";
          const status       = q.status || "pending";
          const statusLabel  = STATUS_LABELS[status] || status;
          const statusColor  = STATUS_COLOR[status]  || "#9ca3af";
          const dateStr      = dateTH(q.created_at);
          return `
            <div class="card qt-card" data-qt-id="${q.id}">
              <div class="row" style="align-items:flex-start">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:900;font-size:15px">${docNo}</div>
                  <div class="sku" style="margin-top:2px">${customerName}</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                    <span class="badge" style="background:${statusColor}18;color:${statusColor}">${statusLabel}</span>
                    <span style="font-size:13px;font-weight:700">${money(amount)}</span>
                    <span class="sku">${dateStr}</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button class="btn light qt-view-btn" data-qt-view="${q.id}" style="font-size:12px;padding:8px 12px">ดูเอกสาร</button>
                  <button class="btn light qt-edit-btn" data-qt-edit="${q.id}" style="font-size:12px;padding:8px 12px">แก้ไข</button>
                  ${!['invoiced','cancelled','receipted'].includes(status) ? '<button class="btn primary qt-convert-btn" data-qt-convert="' + q.id + '" style="font-size:12px;padding:8px 12px">สร้างใบส่ง</button>' : ''}
                  ${!['invoiced','receipted'].includes(status) ? '<button class="btn qt-delete-btn" data-qt-delete="' + q.id + '" style="font-size:12px;padding:8px 12px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5">ลบ</button>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join("") : '<div class="card" style="text-align:center;color:var(--muted);padding:24px">ยังไม่มีใบเสนอราคา</div>'}
      </div>
    </div>
  `;

  // Bind events
  document.getElementById("qtAddBtn")?.addEventListener("click", () => {
    _editingId = null;
    _lineItems = [];
    _viewMode = "form";
    renderQuotationsPage(_ctx);
  });

  container.querySelectorAll(".qt-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === Number(btn.dataset.qtEdit));
    if (q) openEditForm(q);
  }));

  container.querySelectorAll(".qt-view-btn").forEach(btn => btn.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === Number(btn.dataset.qtView));
    if (q) openPreview(q);
  }));

  container.querySelectorAll(".qt-convert-btn").forEach(btn => btn.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === Number(btn.dataset.qtConvert));
    if (q) convertToDeliveryInvoice(q);
  }));

  container.querySelectorAll(".qt-delete-btn").forEach(btn => btn.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === Number(btn.dataset.qtDelete));
    if (q) deleteQuotation(q);
  }));
}

// ═══════════════════════════════════════════════════════════
//  RENDER — Full Quotation Form (FlowAccount style)
// ═══════════════════════════════════════════════════════════
function renderQuotationForm(container) {
  const customers = _ctx.state.customers || [];
  const products  = _ctx.state.products || [];
  const isEdit    = !!_editingId;
  const editDoc   = isEdit ? _ctx.state.quotations.find(x => x.id === _editingId) : null;

  // Calculate totals
  const subtotal       = _lineItems.reduce((s, i) => s + Number(i.line_total || 0), 0);
  const discPctVal     = Number(document.getElementById("qt_discPct")?.value ?? (editDoc?.discount_pct || 0));
  const discAmount     = subtotal * (discPctVal / 100);
  const afterDisc      = subtotal - discAmount;
  const whtChecked     = document.getElementById("qt_wht")?.checked ?? (editDoc?.withholding_tax || false);
  const whtPctVal      = Number(document.getElementById("qt_whtPct")?.value ?? (editDoc?.wht_pct || 3));
  const whtAmount      = whtChecked ? afterDisc * (whtPctVal / 100) : 0;
  const grandTotal     = afterDisc - whtAmount;

  // Preserve form values during re-render
  const prevCust = document.getElementById("qt_customerSearch")?.value ?? (editDoc?.customer_name || editDoc?.customer || '');
  const prevPhone = document.getElementById("qt_customerPhone")?.value ?? (editDoc?.customer_phone || '');
  const prevTaxId = document.getElementById("qt_customerTaxId")?.value ?? (editDoc?.customer_tax_id || '');
  const prevAddr = document.getElementById("qt_customerAddress")?.value ?? (editDoc?.customer_address || '');
  const prevDocNo = document.getElementById("qt_docNo")?.value ?? (editDoc?.qt_no || editDoc?.title || '');
  const prevDate = document.getElementById("qt_date")?.value ?? (editDoc?.created_at ? new Date(editDoc.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  const prevPayTerms = document.getElementById("qt_payTerms")?.value ?? (editDoc?.payment_terms || 'เงินสด');
  const prevCreditDays = document.getElementById("qt_creditDays")?.value ?? (editDoc?.credit_days || 0);
  const prevProject = document.getElementById("qt_project")?.value ?? (editDoc?.project_name || '');
  const prevRefNo = document.getElementById("qt_refNo")?.value ?? (editDoc?.ref_no || '');
  const prevSales = document.getElementById("qt_salesperson")?.value ?? (editDoc?.salesperson || (_ctx.state.profile?.full_name || ''));
  const prevStatus = document.getElementById("qt_status")?.value ?? (editDoc?.status || 'pending');
  const prevNote = document.getElementById("qt_note")?.value ?? (editDoc?.note || '');

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <div style="display:flex;align-items:center;gap:8px">
          <button id="qtBackBtn" class="btn light">&larr; กลับ</button>
          <strong style="font-size:18px">${isEdit ? 'แก้ไขใบเสนอราคา' : 'สร้างใบเสนอราคาใหม่'}</strong>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${isEdit ? '<button id="qtViewDocBtn" class="btn light">📄 ดูเอกสาร</button>' : ''}
          <button id="qtPreviewBtn" class="btn light">ดูตัวอย่าง</button>
          <button id="qtSaveBtn" class="btn primary">บันทึก</button>
          ${isEdit && editDoc && !['invoiced','cancelled'].includes(editDoc.status) ? '<button id="qtConvertFromForm" class="btn" style="background:#10b981;color:#fff">📦 ออกใบส่งสินค้า</button>' : ''}
        </div>
      </div>
    </div>

    <!-- Customer -->
    <div class="panel mt16">
      <h4 style="margin:0 0 12px">ข้อมูลลูกค้า</h4>
      <div class="stack">
        <div style="position:relative">
          <input id="qt_customerSearch" placeholder="ค้นหาลูกค้า หรือพิมพ์ชื่อใหม่..." value="${escHtml(prevCust)}" autocomplete="off" />
          <div id="qt_customerDropdown" class="qt-dropdown hidden"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <input id="qt_customerPhone" placeholder="เบอร์โทร" value="${escHtml(prevPhone)}" />
          <input id="qt_customerTaxId" placeholder="เลขผู้เสียภาษี" value="${escHtml(prevTaxId)}" />
        </div>
        <textarea id="qt_customerAddress" rows="2" placeholder="ที่อยู่ลูกค้า">${escHtml(prevAddr)}</textarea>
      </div>
    </div>

    <!-- Line Items -->
    <div class="panel mt16">
      <div class="row" style="margin-bottom:12px">
        <h4 style="margin:0">รายการสินค้า / บริการ</h4>
        <button id="qtAddItemBtn" class="btn primary" style="font-size:13px;padding:8px 14px">+ เพิ่มรายการ</button>
      </div>

      <div id="qtProductSearchBox" class="hidden" style="margin-bottom:12px;position:relative">
        <input id="qt_productSearch" placeholder="ค้นหาสินค้า / SKU..." autocomplete="off" />
        <div id="qt_productDropdown" class="qt-dropdown hidden"></div>
        <div style="margin-top:6px;display:flex;gap:8px">
          <button id="qtAddCustomItem" class="btn light" style="font-size:12px">+ รายการกำหนดเอง</button>
          <button id="qtCancelAddItem" class="btn light" style="font-size:12px">ยกเลิก</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:36px">#</th>
              <th>รายการ</th>
              <th style="width:70px;text-align:center">จำนวน</th>
              <th style="width:55px;text-align:center">หน่วย</th>
              <th style="width:100px;text-align:right">ราคา/หน่วย</th>
              <th style="width:65px;text-align:center">ลด%</th>
              <th style="width:100px;text-align:right">รวม</th>
              <th style="width:36px"></th>
            </tr>
          </thead>
          <tbody id="qtLineItemsBody">
            ${_lineItems.length ? _lineItems.map((item, idx) => `
              <tr>
                <td style="text-align:center;color:var(--muted)">${idx + 1}</td>
                <td>
                  <input class="qt-li-name" data-idx="${idx}" value="${escHtml(item.item_name)}" style="width:100%;border:none;padding:4px 0;font-size:13px;background:transparent" />
                </td>
                <td><input class="qt-li-qty" data-idx="${idx}" type="number" inputmode="decimal" value="${item.qty}" style="width:60px;text-align:center;padding:4px;font-size:13px" /></td>
                <td><input class="qt-li-unit" data-idx="${idx}" value="${item.unit||'ชิ้น'}" style="width:48px;text-align:center;padding:4px;font-size:12px" /></td>
                <td><input class="qt-li-price" data-idx="${idx}" type="number" inputmode="decimal" value="${item.unit_price}" style="width:90px;text-align:right;padding:4px;font-size:13px" /></td>
                <td><input class="qt-li-disc" data-idx="${idx}" type="number" inputmode="decimal" value="${item.discount_pct||0}" style="width:55px;text-align:center;padding:4px;font-size:13px" /></td>
                <td style="text-align:right;font-weight:700;font-size:13px">${num(item.line_total)}</td>
                <td><button class="qt-li-del" data-idx="${idx}" style="border:none;background:none;cursor:pointer;color:#ef4444;font-size:16px;padding:2px 6px">✕</button></td>
              </tr>
            `).join("") : `
              <tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">ยังไม่มีรายการ — กดปุ่ม "+ เพิ่มรายการ"</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Summary -->
    <div class="panel mt16">
      <h4 style="margin:0 0 12px">สรุปยอด</h4>
      <div style="max-width:420px;margin-left:auto">
        <div class="row" style="padding:6px 0"><span>รวมเป็นเงิน</span><strong>${num(subtotal)}</strong></div>
        <div class="row" style="padding:6px 0;align-items:center">
          <span>ส่วนลด</span>
          <div style="display:flex;align-items:center;gap:6px">
            <input id="qt_discPct" type="number" inputmode="decimal" value="${discPctVal}" style="width:55px;text-align:center;padding:5px;font-size:13px" /> <span>%</span>
            <span style="font-weight:700;color:#ef4444">-${num(discAmount)}</span>
          </div>
        </div>
        <div class="row" style="padding:6px 0"><span>หลังหักส่วนลด</span><strong>${num(afterDisc)}</strong></div>
        <div class="row" style="padding:6px 0;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input id="qt_wht" type="checkbox" ${whtChecked ? 'checked' : ''} style="width:auto" />
            <span>หัก ณ ที่จ่าย</span>
          </label>
          <div style="display:flex;align-items:center;gap:6px">
            <input id="qt_whtPct" type="number" inputmode="decimal" value="${whtPctVal}" style="width:48px;text-align:center;padding:5px;font-size:13px" ${!whtChecked?'disabled':''} /> <span>%</span>
            <span style="font-weight:700;color:#ef4444">-${num(whtAmount)}</span>
          </div>
        </div>
        <hr style="margin:8px 0" />
        <div class="row" style="padding:8px 0">
          <strong style="font-size:16px">รวมทั้งสิ้น</strong>
          <strong style="font-size:20px;color:var(--primary2)">${money(grandTotal)}</strong>
        </div>
      </div>
    </div>

    <!-- Document Details -->
    <div class="panel mt16">
      <h4 style="margin:0 0 12px">รายละเอียดเอกสาร</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="stack"><label class="field-label">เลขที่เอกสาร</label><input id="qt_docNo" placeholder="QT-YYYYMMDD001" value="${escHtml(prevDocNo)}" /></div>
        <div class="stack"><label class="field-label">วันที่</label><input id="qt_date" type="date" value="${prevDate}" /></div>
        <div class="stack"><label class="field-label">ชำระเงิน</label>
          <select id="qt_payTerms">
            <option value="เงินสด" ${prevPayTerms==='เงินสด'?'selected':''}>เงินสด</option>
            <option value="โอนเงิน" ${prevPayTerms==='โอนเงิน'?'selected':''}>โอนเงิน</option>
            <option value="เครดิต" ${prevPayTerms==='เครดิต'?'selected':''}>เครดิต</option>
            <option value="เช็ค" ${prevPayTerms==='เช็ค'?'selected':''}>เช็ค</option>
          </select>
        </div>
        <div class="stack"><label class="field-label">เครดิต (วัน)</label><input id="qt_creditDays" type="number" inputmode="numeric" value="${prevCreditDays}" /></div>
        <div class="stack"><label class="field-label">โปรเจค</label><input id="qt_project" placeholder="ชื่อโปรเจค" value="${escHtml(prevProject)}" /></div>
        <div class="stack"><label class="field-label">เลขเอกสารอ้างอิง</label><input id="qt_refNo" placeholder="Ref." value="${escHtml(prevRefNo)}" /></div>
        <div class="stack"><label class="field-label">พนักงานขาย</label><input id="qt_salesperson" placeholder="ชื่อ" value="${escHtml(prevSales)}" /></div>
        <div class="stack"><label class="field-label">สถานะ</label>
          <select id="qt_status">
            <option value="pending" ${prevStatus==='pending'?'selected':''}>รออนุมัติ</option>
            <option value="approved" ${prevStatus==='approved'?'selected':''}>อนุมัติแล้ว</option>
            <option value="invoiced" ${prevStatus==='invoiced'?'selected':''}>ออกใบส่งสินค้าแล้ว</option>
            <option value="receipted" ${prevStatus==='receipted'?'selected':''}>ออกใบเสร็จแล้ว</option>
            <option value="expired" ${prevStatus==='expired'?'selected':''}>หมดอายุ</option>
            <option value="cancelled" ${prevStatus==='cancelled'?'selected':''}>ยกเลิก</option>
          </select>
        </div>
      </div>
      <div class="stack mt16">
        <label class="field-label">หมายเหตุ</label>
        <textarea id="qt_note" rows="2" placeholder="หมายเหตุ">${escHtml(prevNote)}</textarea>
      </div>
    </div>
  `;

  bindFormEvents(container, customers, products);
}

// ═══════════════════════════════════════════════════════════
//  BIND FORM EVENTS
// ═══════════════════════════════════════════════════════════
function bindFormEvents(container, customers, products) {
  document.getElementById("qtBackBtn")?.addEventListener("click", () => {
    _viewMode = "list"; renderQuotationsPage(_ctx);
  });
  document.getElementById("qtSaveBtn")?.addEventListener("click", saveQuotationFull);
  document.getElementById("qtPreviewBtn")?.addEventListener("click", () => {
    _viewMode = "preview"; renderQuotationsPage(_ctx);
  });

  // ดูเอกสาร (preview saved version)
  document.getElementById("qtViewDocBtn")?.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === _editingId);
    if (q) openPreview(q);
  });

  // ออกใบส่งสินค้าจากฟอร์ม
  document.getElementById("qtConvertFromForm")?.addEventListener("click", () => {
    const q = _ctx.state.quotations.find(x => x.id === _editingId);
    if (q) convertToDeliveryInvoice(q);
  });

  // Add item toggle
  document.getElementById("qtAddItemBtn")?.addEventListener("click", () => {
    document.getElementById("qtProductSearchBox")?.classList.remove("hidden");
    document.getElementById("qt_productSearch")?.focus();
  });
  document.getElementById("qtCancelAddItem")?.addEventListener("click", () => {
    document.getElementById("qtProductSearchBox")?.classList.add("hidden");
  });

  // Custom item
  document.getElementById("qtAddCustomItem")?.addEventListener("click", () => {
    _lineItems.push({ product_id: null, item_name: "รายการใหม่", qty: 1, unit: "ชิ้น", unit_price: 0, discount_pct: 0, line_total: 0 });
    document.getElementById("qtProductSearchBox")?.classList.add("hidden");
    renderQuotationForm(container);
  });

  // Product search dropdown
  const searchInput = document.getElementById("qt_productSearch");
  const dropdown    = document.getElementById("qt_productDropdown");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      if (q.length < 1) { dropdown?.classList.add("hidden"); return; }
      const matches = products.filter(p =>
        String(p.name||"").toLowerCase().includes(q) || String(p.sku||"").toLowerCase().includes(q)
      ).slice(0, 8);
      if (!matches.length) {
        dropdown.innerHTML = '<div class="qt-dd-item" style="color:var(--muted)">ไม่พบสินค้า</div>';
      } else {
        dropdown.innerHTML = matches.map(p => `
          <div class="qt-dd-item" data-pid="${p.id}">
            <span style="font-weight:700">${escHtml(p.name)}</span>
            <span class="sku">${p.sku||''} &bull; ${money(p.price)}</span>
          </div>
        `).join("");
      }
      dropdown?.classList.remove("hidden");
      dropdown.querySelectorAll(".qt-dd-item[data-pid]").forEach(el => {
        el.addEventListener("click", () => {
          const p = products.find(x => x.id === Number(el.dataset.pid));
          if (p) {
            _lineItems.push({ product_id: p.id, item_name: p.name, qty: 1, unit: "ชิ้น", unit_price: Number(p.price||0), discount_pct: 0, line_total: Number(p.price||0) });
            document.getElementById("qtProductSearchBox")?.classList.add("hidden");
            searchInput.value = ""; dropdown?.classList.add("hidden");
            renderQuotationForm(container);
          }
        });
      });
    });
  }

  // Customer search dropdown
  const custSearch = document.getElementById("qt_customerSearch");
  const custDD     = document.getElementById("qt_customerDropdown");
  if (custSearch) {
    custSearch.addEventListener("input", () => {
      const q = custSearch.value.trim().toLowerCase();
      if (q.length < 1) { custDD?.classList.add("hidden"); return; }
      const matches = customers.filter(c =>
        String(c.name||"").toLowerCase().includes(q) || String(c.phone||"").toLowerCase().includes(q)
      ).slice(0, 6);
      if (!matches.length) { custDD?.classList.add("hidden"); return; }
      custDD.innerHTML = matches.map(c => `
        <div class="qt-dd-item" data-cid="${c.id}">
          <span style="font-weight:700">${escHtml(c.name)}</span>
          <span class="sku">${c.phone||''} ${c.company ? '&bull; '+c.company : ''}</span>
        </div>
      `).join("");
      custDD?.classList.remove("hidden");
      custDD.querySelectorAll(".qt-dd-item[data-cid]").forEach(el => {
        el.addEventListener("click", () => {
          const c = customers.find(x => x.id === Number(el.dataset.cid));
          if (c) {
            custSearch.value = c.name;
            document.getElementById("qt_customerPhone").value = c.phone || "";
            document.getElementById("qt_customerTaxId").value = c.tax_id || "";
            document.getElementById("qt_customerAddress").value = c.address || "";
            custDD?.classList.add("hidden");
          }
        });
      });
    });
  }

  // Line item inline editing
  container.querySelectorAll(".qt-li-name,.qt-li-qty,.qt-li-price,.qt-li-disc,.qt-li-unit").forEach(inp => {
    inp.addEventListener("change", () => {
      const idx = Number(inp.dataset.idx);
      const item = _lineItems[idx]; if (!item) return;
      const row = inp.closest("tr");
      item.item_name    = row.querySelector(".qt-li-name")?.value || item.item_name;
      item.qty          = Number(row.querySelector(".qt-li-qty")?.value || 1);
      item.unit_price   = Number(row.querySelector(".qt-li-price")?.value || 0);
      item.discount_pct = Number(row.querySelector(".qt-li-disc")?.value || 0);
      item.unit         = row.querySelector(".qt-li-unit")?.value || "ชิ้น";
      item.line_total   = item.qty * item.unit_price * (1 - item.discount_pct / 100);
      renderQuotationForm(container);
    });
  });

  // Delete line item
  container.querySelectorAll(".qt-li-del").forEach(btn => btn.addEventListener("click", () => {
    _lineItems.splice(Number(btn.dataset.idx), 1);
    renderQuotationForm(container);
  }));

  // Discount / WHT recalc
  document.getElementById("qt_discPct")?.addEventListener("input", () => renderQuotationForm(container));
  document.getElementById("qt_wht")?.addEventListener("change", () => renderQuotationForm(container));
  document.getElementById("qt_whtPct")?.addEventListener("input", () => renderQuotationForm(container));
}

// ═══════════════════════════════════════════════════════════
//  SAVE — Full Quotation + Line Items
// ═══════════════════════════════════════════════════════════
async function saveQuotationFull() {
  const customerName = document.getElementById("qt_customerSearch")?.value?.trim() || "";
  if (!customerName) return _ctx.showToast("กรอกชื่อลูกค้า");
  if (!_lineItems.length) return _ctx.showToast("เพิ่มรายการสินค้าอย่างน้อย 1 รายการ");

  const subtotal   = _lineItems.reduce((s, i) => s + Number(i.line_total || 0), 0);
  const discPct    = Number(document.getElementById("qt_discPct")?.value || 0);
  const discAmount = subtotal * (discPct / 100);
  const afterDisc  = subtotal - discAmount;
  const whtChecked = document.getElementById("qt_wht")?.checked || false;
  const whtPct     = Number(document.getElementById("qt_whtPct")?.value || 3);
  const whtAmount  = whtChecked ? afterDisc * (whtPct / 100) : 0;
  const grandTotal = afterDisc - whtAmount;

  const payload = {
    customer_name: customerName, customer: customerName,
    customer_phone: document.getElementById("qt_customerPhone")?.value?.trim() || "",
    customer_address: document.getElementById("qt_customerAddress")?.value?.trim() || "",
    customer_tax_id: document.getElementById("qt_customerTaxId")?.value?.trim() || "",
    qt_no: document.getElementById("qt_docNo")?.value?.trim() || "",
    total_amount: subtotal, grand_total: grandTotal, amount: grandTotal,
    discount_pct: discPct, discount_amount: discAmount, after_discount: afterDisc,
    withholding_tax: whtChecked, wht_pct: whtPct, wht_amount: whtAmount,
    payment_terms: document.getElementById("qt_payTerms")?.value || "เงินสด",
    credit_days: Number(document.getElementById("qt_creditDays")?.value || 0),
    project_name: document.getElementById("qt_project")?.value?.trim() || "",
    ref_no: document.getElementById("qt_refNo")?.value?.trim() || "",
    salesperson: document.getElementById("qt_salesperson")?.value?.trim() || "",
    status: document.getElementById("qt_status")?.value || "pending",
    note: document.getElementById("qt_note")?.value?.trim() || ""
  };

  // Auto QT number
  if (!payload.qt_no) {
    const now = new Date();
    const ds = now.getFullYear() + String(now.getMonth()+1).padStart(2,"0") + String(now.getDate()).padStart(2,"0");
    payload.qt_no = "QT" + ds + String((_ctx.state.quotations?.length||0)+1).padStart(3,"0");
  }

  _ctx.showToast("กำลังบันทึก...");
  const xhrPost = window._appXhrPost;
  const xhrPatch = window._appXhrPatch;
  const xhrDelete = window._appXhrDelete;

  let res, quotationId = _editingId;

  if (quotationId) {
    res = await xhrPatch("quotations", payload, "id", quotationId);
    if (!res.ok) return _ctx.showToast(res.error?.message || "บันทึกไม่สำเร็จ");
    await xhrDelete("quotation_items", "quotation_id", quotationId);
  } else {
    res = await xhrPost("quotations", payload, { returnData: true });
    if (!res.ok) return _ctx.showToast(res.error?.message || "บันทึกไม่สำเร็จ");
    quotationId = res.data?.id;
  }

  // Insert line items
  if (quotationId && _lineItems.length) {
    for (let i = 0; i < _lineItems.length; i++) {
      const li = _lineItems[i];
      await xhrPost("quotation_items", {
        quotation_id: quotationId, product_id: li.product_id || null,
        item_name: li.item_name, qty: li.qty, unit: li.unit || "ชิ้น",
        unit_price: li.unit_price, discount_pct: li.discount_pct || 0,
        line_total: li.line_total, sort_order: i + 1
      });
    }
  }

  _viewMode = "list"; _editingId = null; _lineItems = [];
  await _ctx.loadAllData();
  _ctx.showToast("บันทึกใบเสนอราคาแล้ว");
  renderQuotationsPage(_ctx);
}

// ═══════════════════════════════════════════════════════════
//  EDIT — Load existing quotation + items
// ═══════════════════════════════════════════════════════════
async function openEditForm(q) {
  _editingId = q.id;
  _viewMode = "form";
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/quotation_items?quotation_id=eq." + q.id + "&order=sort_order.asc",
      { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
    const items = await resp.json();
    _lineItems = (items || []).map(i => ({
      product_id: i.product_id, item_name: i.item_name || "",
      qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
      unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
      line_total: Number(i.line_total||0)
    }));
  } catch (e) { _lineItems = []; }
  renderQuotationsPage(_ctx);
}

// ═══════════════════════════════════════════════════════════
//  PREVIEW — Document view
// ═══════════════════════════════════════════════════════════
async function openPreview(q) {
  _editingId = q.id; _viewMode = "preview";
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/quotation_items?quotation_id=eq." + q.id + "&order=sort_order.asc",
      { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
    const items = await resp.json();
    _lineItems = (items || []).map(i => ({
      product_id: i.product_id, item_name: i.item_name || "",
      qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
      unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
      line_total: Number(i.line_total||0)
    }));
  } catch (e) { _lineItems = []; }
  renderQuotationsPage(_ctx);
}

function renderQuotationPreview(container) {
  const q = _ctx.state.quotations.find(x => x.id === _editingId);
  if (!q) { _viewMode = "list"; renderQuotationsPage(_ctx); return; }

  const si = _ctx.state.storeInfo || {};
  const customerName = q.customer_name || q.customer || "-";
  const subtotal     = Number(q.total_amount || 0);
  const discPct      = Number(q.discount_pct || 0);
  const discAmount   = Number(q.discount_amount || 0);
  const afterDisc    = Number(q.after_discount || subtotal);
  const whtChecked   = q.withholding_tax || false;
  const whtPct       = Number(q.wht_pct || 3);
  const whtAmount    = Number(q.wht_amount || 0);
  const grandTotal   = Number(q.grand_total || q.amount || subtotal);

  // ★ เช็คว่ามีใบส่งสินค้าอ้างอิงใบเสนอราคานี้อยู่หรือไม่ — ถ้ามี = lock
  const hasInvoice = (_ctx.state.deliveryInvoices || []).some(di =>
    di.quotation_id === q.id && di.status !== 'cancelled'
  );

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <button id="qtPreviewBack" class="btn light">&larr; กลับ</button>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#f8fafc">
            <input type="checkbox" id="qtShowDate" checked style="width:15px;height:15px;cursor:pointer" />
            ลงวันที่
          </label>
          ${hasInvoice ? `
          <span style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #fecaca;border-radius:8px;padding:6px 10px;background:#fef2f2;color:#991b1b" title="มีใบส่งสินค้าอ้างอิงอยู่ — ต้องลบใบส่งสินค้าก่อนถึงจะแก้วันที่ได้">
            🔒 วันที่: ${dateTH(q.created_at)} (ล็อก — มีใบส่งสินค้าแล้ว)
          </span>
          ` : `
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#fffbeb" title="ยังไม่มีใบส่งสินค้า — แก้วันที่ได้">
            <span>📅 วันที่เอกสาร:</span>
            <input type="date" id="qtEditDate" value="${(q.created_at || new Date().toISOString()).slice(0,10)}" style="border:1px solid #d1d5db;border-radius:6px;padding:3px 6px;font-size:13px;cursor:pointer" />
          </label>
          `}
          <button id="qtEditFromPreview" class="btn light">แก้ไข</button>
          <button id="qtShareLinkBtn" class="btn" style="background:#6366f1;color:#fff">🔗 คัดลอกลิงก์</button>
          <button id="qtShareBtn" class="btn" style="background:#06C755;color:#fff">📤 แชร์</button>
          <button id="qtPrintBtn" class="btn light">🖨️ พิมพ์</button>
          <button id="qtPdfBtn" class="btn primary">📄 PDF</button>
          ${!['invoiced','cancelled','receipted'].includes(q.status) ? '<button id="qtConvertBtn" class="btn" style="background:#10b981;color:#fff">📦 สร้างใบส่ง</button>' : ''}
        </div>
      </div>
    </div>

    <div id="qtDocPreview" class="doc-preview mt16">
      <div class="doc-page">
        <div class="doc-accent qt"></div>
        <div class="doc-page-inner">
          <div class="doc-header">
            <div class="doc-header-left">
              <img src="${window._appGetLogo ? window._appGetLogo() : './logo.svg'}" class="doc-logo" onerror="this.style.display='none'" />
              <div>
                <div class="doc-company-name">${escHtml(si.name || "บุญสุข อิเล็กทรอนิกส์")}</div>
                <div class="doc-company-detail">
                  ${si.address ? escHtml(si.address)+'<br>' : ''}
                  ${si.taxId ? 'เลขประจำตัวผู้เสียภาษี '+escHtml(si.taxId)+'<br>' : ''}
                  ${si.phone ? 'โทร. '+escHtml(si.phone) : ''}${si.mobile ? ' / '+escHtml(si.mobile) : ''}
                </div>
              </div>
            </div>
            <div class="doc-header-right">
              <div class="doc-title qt">ใบเสนอราคา</div>
              <div class="doc-title-sub">Quotation</div>
              <table class="doc-detail-table">
                <tr><td>เลขที่</td><td>${escHtml(q.qt_no || '-')}</td></tr>
                <tr><td>วันที่</td><td id="qtDateCell">..........................</td></tr>
                <tr><td>ผู้ขาย</td><td>${escHtml(q.salesperson || '-')}</td></tr>
                ${q.payment_terms ? '<tr><td>ชำระเงิน</td><td>'+escHtml(q.payment_terms)+'</td></tr>' : ''}
              </table>
            </div>
          </div>

          <div class="doc-customer-section">
            <div class="doc-customer-label qt">ลูกค้า</div>
            <div class="doc-customer-name">${escHtml(customerName)}</div>
            <div class="doc-customer-detail">
              ${q.customer_address ? escHtml(q.customer_address) : ''}
              ${q.customer_phone ? '<br>โทร. '+escHtml(q.customer_phone) : ''}
              ${q.customer_tax_id ? '<br>เลขผู้เสียภาษี '+escHtml(q.customer_tax_id) : ''}
            </div>
          </div>

          <table class="doc-table">
            <thead><tr>
              <th class="qt" style="width:30px">#</th><th class="qt" style="text-align:left">รายละเอียด</th>
              <th class="qt" style="width:65px">จำนวน</th><th class="qt" style="width:55px">หน่วย</th>
              <th class="qt" style="width:95px">ราคาต่อหน่วย</th>
              <th class="qt" style="width:95px">ยอดรวม</th>
            </tr></thead>
            <tbody>
              ${_lineItems.length ? _lineItems.map((item, idx) => '<tr>'
                +'<td style="text-align:center">'+(idx+1)+'</td>'
                +'<td style="text-align:left">'+escHtml(item.item_name)+'</td>'
                +'<td style="text-align:center">'+num(item.qty)+'</td>'
                +'<td style="text-align:center">'+(item.unit||'ชิ้น')+'</td>'
                +'<td style="text-align:right">'+num(item.unit_price)+'</td>'
                +'<td style="text-align:right">'+num(item.line_total)+'</td>'
                +'</tr>').join('') : '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px">ไม่มีรายการ</td></tr>'}
            </tbody>
          </table>

          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:4px">
            <div class="doc-baht-text"></div>
            <div class="doc-totals">
              <div class="doc-total-row"><span>รวมเป็นเงิน</span><span>${num(subtotal)} บาท</span></div>
              ${discPct > 0 ? '<div class="doc-total-row"><span>ส่วนลด '+discPct+'%</span><span>-'+num(discAmount)+' บาท</span></div>' : ''}
              ${whtChecked ? '<div class="doc-total-row"><span>หัก ณ ที่จ่าย '+whtPct+'%</span><span>-'+num(whtAmount)+' บาท</span></div>' : ''}
              <div class="doc-total-row grand qt"><span>จำนวนเงินรวมทั้งสิ้น</span><span>${num(grandTotal)} บาท</span></div>
            </div>
          </div>

          ${q.note ? '<div class="doc-note-section"><div class="doc-note-title qt">หมายเหตุ</div><div>'+escHtml(q.note)+'</div></div>' : ''}

          <div class="doc-signatures">
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">ในนาม ${escHtml(customerName)}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้สั่งซื้อ</span><span>วันที่ ___/___/______</span></div>
            </div>
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">ในนาม ${escHtml(si.name || 'บุญสุข อิเล็กทรอนิกส์')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้อนุมัติ</span><span>วันที่ ___/___/______</span></div>
            </div>
          </div>

          <div class="doc-footer"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("qtPreviewBack")?.addEventListener("click", () => { _viewMode = "list"; renderQuotationsPage(_ctx); });

  // ── date toggle ──
  const qtDateCell = document.getElementById("qtDateCell");
  const qtShowDate = document.getElementById("qtShowDate");
  if (qtShowDate && qtDateCell) {
    qtShowDate.addEventListener("change", () => {
      qtDateCell.textContent = qtShowDate.checked ? dateTH(q.created_at) : "..................................";
    });
  }

  // ★ แก้วันที่เอกสาร — อนุญาตเมื่อไม่มีใบส่งสินค้าอ้างอิง
  document.getElementById("qtEditDate")?.addEventListener("change", async (ev) => {
    const newDate = ev.target.value;
    if (!newDate) return;
    const isoDate = newDate + "T00:00:00.000Z";
    try {
      const res = await window._appXhrPatch?.("quotations", { created_at: isoDate }, "id", q.id);
      if (res && res.ok === false) throw new Error(res.error?.message || "patch failed");
      q.created_at = isoDate;
      if (qtShowDate?.checked && qtDateCell) qtDateCell.textContent = dateTH(isoDate);
      _ctx.showToast("อัปเดตวันที่เรียบร้อย ✓");
    } catch (e) {
      console.error("[quotations edit date] error:", e);
      _ctx.showToast("❌ แก้วันที่ไม่สำเร็จ: " + (e.message || e));
      ev.target.value = (q.created_at || "").slice(0,10);
    }
  });

  document.getElementById("qtShareLinkBtn")?.addEventListener("click", () => generateShareLink(q));
  document.getElementById("qtShareBtn")?.addEventListener("click", () => {
    window._appShareDoc("qtDocPreview", q.qt_no || "quotation");
  });
  document.getElementById("qtEditFromPreview")?.addEventListener("click", () => {
    const q2 = _ctx.state.quotations.find(x => x.id === _editingId);
    if (q2) { _viewMode = "form"; renderQuotationsPage(_ctx); }
  });

  document.getElementById("qtPrintBtn")?.addEventListener("click", () => {
    const content = document.getElementById("qtDocPreview")?.innerHTML; if (!content) return;
    const w = window.open("","_blank");
    w.document.write('<html><head><title>ใบเสนอราคา</title><style>body{font-family:system-ui,"Noto Sans Thai",sans-serif;padding:20px;color:#0f172a}.doc-page{max-width:800px;margin:0 auto}.doc-header{display:flex;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid #0284c7}.doc-company{font-size:22px;font-weight:900;color:#0284c7}.doc-address{font-size:12px;color:#64748b}.doc-title{font-size:24px;font-weight:900;color:#0284c7}.doc-title-en{font-size:13px;color:#64748b}.doc-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0;font-size:13px}.doc-info-label{font-weight:700;color:#0284c7;margin-bottom:4px}.doc-table{width:100%;border-collapse:collapse;margin:16px 0}.doc-table th{background:#f1f5f9;padding:8px;font-size:12px;border:1px solid #e2e8f0}.doc-table td{padding:8px;font-size:13px;border:1px solid #e2e8f0}.doc-totals{margin-left:auto;max-width:350px}.doc-total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}.doc-grand-total{font-size:16px;font-weight:900;color:#0284c7;border-top:2px solid #0284c7;padding-top:8px;margin-top:4px}.doc-note{margin-top:16px;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px}.doc-signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px;text-align:center;font-size:13px}.doc-sig-line{width:180px;border-bottom:1px solid #333;margin:0 auto 8px;height:40px}.sku{color:#64748b;font-size:12px}</style></head><body>'+content+'</body></html>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  });

  document.getElementById("qtPdfBtn")?.addEventListener("click", () => {
    const el = document.getElementById("qtDocPreview");
    if (!el || !window.html2canvas) return _ctx.showToast("ไม่สามารถสร้าง PDF");
    _ctx.showToast("กำลังสร้าง PDF...");
    html2canvas(el, { scale: 2, useCORS: true }).then(canvas => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p","mm","a4");
      const imgData = canvas.toDataURL("image/png");
      const pdfW = pdf.internal.pageSize.getWidth() - 20;
      const pdfH = (canvas.height * pdfW) / canvas.width;
      pdf.addImage(imgData, "PNG", 10, 10, pdfW, pdfH);
      pdf.save((q.qt_no||'quotation')+'.pdf');
      _ctx.showToast("ดาวน์โหลด PDF แล้ว");
    });
  });

  document.getElementById("qtConvertBtn")?.addEventListener("click", () => convertToDeliveryInvoice(q));
}

// ═══════════════════════════════════════════════════════════
//  DELETE — ลบใบเสนอราคา (เฉพาะที่ยังไม่สร้างใบส่ง)
// ═══════════════════════════════════════════════════════════
async function deleteQuotation(q) {
  // Double-check: ถ้าสถานะ invoiced/receipted ห้ามลบ
  if (['invoiced','receipted'].includes(q.status)) {
    return _ctx.showToast("ไม่สามารถลบได้ — มีเอกสารต่อเนื่องแล้ว");
  }

  // ตรวจสอบว่ามี delivery_invoice ผูกอยู่หรือไม่
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const chkResp = await fetch(cfg.url + "/rest/v1/delivery_invoices?quotation_id=eq." + q.id + "&select=id", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    const linked = await chkResp.json();
    if (linked && linked.length > 0) {
      return _ctx.showToast("ไม่สามารถลบได้ — มีใบส่งสินค้าผูกอยู่แล้ว");
    }
  } catch(e) { /* ถ้าเช็คไม่ได้ ให้ลบได้ตามสถานะ */ }

  const docNo = q.qt_no || q.title || "ใบเสนอราคานี้";
  if (!(await window.App?.confirm?.("ยืนยันลบ " + docNo + " ?\n\nข้อมูลจะถูกลบถาวรและไม่สามารถกู้คืนได้"))) return;

  const xhrDelete = window._appXhrDelete;
  _ctx.showToast("กำลังลบ...");

  // 1) ลบ quotation_items ก่อน
  const itemRes = await xhrDelete("quotation_items", "quotation_id", q.id);
  if (!itemRes.ok) {
    console.warn("ลบ quotation_items ไม่สำเร็จ:", itemRes.error?.message);
    // ไม่ block — อาจไม่มี items
  }

  // 2) ลบ quotation
  const qtRes = await xhrDelete("quotations", "id", q.id);
  if (!qtRes.ok) {
    return _ctx.showToast("ลบไม่สำเร็จ: " + (qtRes.error?.message || "Unknown error"));
  }

  await _ctx.loadAllData();
  _ctx.showToast("ลบ " + docNo + " แล้ว");
  _viewMode = "list";
  renderQuotationsPage(_ctx);
}

// ═══════════════════════════════════════════════════════════
//  CONVERT — Quotation → Delivery Invoice
// ═══════════════════════════════════════════════════════════
async function convertToDeliveryInvoice(q) {
  // ★ ป้องกันสร้างซ้ำ — เช็คว่ามีใบส่งสินค้าจาก quotation นี้อยู่แล้วไหม
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const chkResp = await fetch(
      cfg.url + "/rest/v1/delivery_invoices?quotation_id=eq." + q.id + "&select=inv_no,status",
      { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } }
    );
    const existing = await chkResp.json().catch(() => []);
    const active = Array.isArray(existing) ? existing.filter(d => d.status !== "cancelled") : [];
    if (active.length > 0) {
      const list = active.map(d => d.inv_no).join(", ");
      const msg = `⚠️ มีใบส่งสินค้าจากใบเสนอราคานี้อยู่แล้ว: ${list}\n\nต้องการสร้างใบใหม่อีกใบหรือไม่?\n(ปกติควรลบใบเดิมก่อน)`;
      if (!(await window.App?.confirm?.(msg))) return;
    } else {
      if (!(await window.App?.confirm?.("สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากใบเสนอราคานี้?"))) return;
    }
  } catch(e) {
    console.warn("[quotations convert] duplicate check failed, fallback to confirm:", e);
    if (!(await window.App?.confirm?.("สร้างใบส่งสินค้า/ใบแจ้งหนี้ จากใบเสนอราคานี้?"))) return;
  }

  // Load items if not loaded
  if (!_lineItems.length) {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    try {
      const resp = await fetch(cfg.url + "/rest/v1/quotation_items?quotation_id=eq." + q.id + "&order=sort_order.asc",
        { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
      _lineItems = ((await resp.json()) || []).map(i => ({
        product_id: i.product_id, item_name: i.item_name || "",
        qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
        unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
        line_total: Number(i.line_total||0)
      }));
    } catch(e) { _lineItems = []; }
  }

  const xhrPost = window._appXhrPost;
  const xhrPatch = window._appXhrPatch;

  const now = new Date();
  const ds = now.getFullYear() + String(now.getMonth()+1).padStart(2,"0") + String(now.getDate()).padStart(2,"0");
  const invNo = "INV" + ds + String(Date.now()).slice(-3);

  const invoicePayload = {
    inv_no: invNo, quotation_id: q.id,
    customer_name: q.customer_name || q.customer || "",
    customer_phone: q.customer_phone || "", customer_address: q.customer_address || "",
    customer_tax_id: q.customer_tax_id || "",
    total_amount: q.total_amount || 0, discount_pct: q.discount_pct || 0,
    discount_amount: q.discount_amount || 0, after_discount: q.after_discount || q.total_amount || 0,
    grand_total: q.grand_total || q.amount || 0, withholding_tax: q.withholding_tax || false,
    wht_pct: q.wht_pct || 3, wht_amount: q.wht_amount || 0,
    payment_terms: q.payment_terms || "เงินสด", credit_days: q.credit_days || 0,
    project_name: q.project_name || "", ref_no: q.qt_no || "",
    salesperson: q.salesperson || "", status: "pending",
    note: "จากใบเสนอราคา " + (q.qt_no || "")
  };

  _ctx.showToast("กำลังสร้างใบส่งสินค้า...");
  const invRes = await xhrPost("delivery_invoices", invoicePayload, { returnData: true });
  if (!invRes.ok) return _ctx.showToast(invRes.error?.message || "สร้างไม่สำเร็จ");

  const invoiceId = invRes.data?.id;
  if (invoiceId && _lineItems.length) {
    for (let i = 0; i < _lineItems.length; i++) {
      const li = _lineItems[i];
      await xhrPost("delivery_invoice_items", {
        delivery_invoice_id: invoiceId, product_id: li.product_id || null,
        item_name: li.item_name, qty: li.qty, unit: li.unit || "ชิ้น",
        unit_price: li.unit_price, discount_pct: li.discount_pct || 0,
        line_total: li.line_total, sort_order: i + 1
      });
    }
  }

  await xhrPatch("quotations", { status: "invoiced" }, "id", q.id);
  await _ctx.loadAllData();
  _ctx.showToast("สร้างใบส่งสินค้าแล้ว: " + invNo);
  _viewMode = "list";
  _ctx.showRoute("delivery_invoices");
}

// ═══════════════════════════════════════════════════════════
//  SHARE LINK — FlowAccount-style public document link
// ═══════════════════════════════════════════════════════════
async function generateShareLink(q) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // Check if already has share_token
  let shareToken = q.share_token;

  if (!shareToken) {
    // Generate random token
    shareToken = generateToken();

    // Save to DB
    try {
      const resp = await fetch(cfg.url + "/rest/v1/quotations?id=eq." + q.id, {
        method: "PATCH",
        headers: {
          "apikey": cfg.anonKey,
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({ share_token: shareToken })
      });
      if (!resp.ok) throw new Error("บันทึก share token ไม่สำเร็จ");
      // Update local state
      q.share_token = shareToken;
    } catch (e) {
      _ctx.showToast("ไม่สามารถสร้างลิงก์: " + e.message);
      return;
    }
  }

  // Build share URL
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "/");
  const shareUrl = baseUrl + "share.html?type=quotation&token=" + encodeURIComponent(shareToken);

  // Show share link popup
  showShareLinkPopup(shareUrl, q.qt_no || "ใบเสนอราคา");
}

function generateToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 24; i++) result += chars[arr[i] % chars.length];
  return result;
}

function showShareLinkPopup(url, docName) {
  document.getElementById("shareLinkOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "shareLinkOverlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:10px;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:18px">🔗</div>
          <div>
            <div style="font-weight:800;font-size:16px">แชร์ลิงก์เอกสาร</div>
            <div style="font-size:12px;color:#64748b">${escHtml(docName)}</div>
          </div>
        </div>
        <button id="shareLinkCloseBtn" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b">&times;</button>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600">ลิงก์สำหรับแชร์</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="shareLinkInput" value="${escHtml(url)}" readonly style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font-size:13px;font-family:monospace;background:#fff;color:#1e293b" />
          <button id="copyLinkBtn" style="background:#6366f1;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit">คัดลอก</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <button class="sl-share-btn" data-action="line" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:36px;height:36px;border-radius:50%;background:#06C755;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
          </div>
          <span style="font-size:12px;font-weight:700;color:#333">LINE</span>
        </button>
        <button class="sl-share-btn" data-action="facebook" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:36px;height:36px;border-radius:50%;background:#1877F2;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </div>
          <span style="font-size:12px;font-weight:700;color:#333">Messenger</span>
        </button>
        <button class="sl-share-btn" data-action="email" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer">
          <div style="width:36px;height:36px;border-radius:50%;background:#EA4335;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <span style="font-size:12px;font-weight:700;color:#333">Email</span>
        </button>
      </div>

      <div id="shareLinkStatus" style="text-align:center;font-size:13px;color:#10b981;font-weight:700;display:none"></div>

      <div style="margin-top:12px;padding:10px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;font-size:12px;color:#92400e;line-height:1.6">
        💡 ลูกค้าจะเปิดดูเอกสารได้ผ่านลิงก์นี้ โดยไม่ต้อง login — สามารถพิมพ์หรือดาวน์โหลด PDF ได้เลย
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const close = () => overlay.remove();
  document.getElementById("shareLinkCloseBtn")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // Copy link
  document.getElementById("copyLinkBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("shareLinkInput");
    try {
      await navigator.clipboard.writeText(input.value);
      const statusEl = document.getElementById("shareLinkStatus");
      statusEl.textContent = "✅ คัดลอกลิงก์แล้ว — วางใน LINE/Chat ส่งให้ลูกค้าได้เลย!";
      statusEl.style.display = "block";
      document.getElementById("copyLinkBtn").textContent = "คัดลอกแล้ว ✓";
      setTimeout(() => statusEl.style.display = "none", 4000);
    } catch(e) {
      input.select();
      document.execCommand("copy");
      const statusEl = document.getElementById("shareLinkStatus");
      statusEl.textContent = "✅ คัดลอกแล้ว!";
      statusEl.style.display = "block";
    }
  });

  // Share buttons
  overlay.querySelectorAll(".sl-share-btn").forEach(btn => {
    btn.addEventListener("mouseenter", () => btn.style.background = "#f1f5f9");
    btn.addEventListener("mouseleave", () => btn.style.background = "#fff");
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const encodedUrl = encodeURIComponent(url);
      const text = encodeURIComponent("📄 " + docName + "\nบุญสุข อิเล็กทรอนิกส์\n\nกดเปิดดูเอกสาร:\n" + url);

      switch (action) {
        case "line":
          window.open("https://line.me/R/msg/text/?" + text, "_blank");
          break;
        case "facebook":
          window.open("https://www.facebook.com/dialog/send?link=" + encodedUrl + "&app_id=&redirect_uri=" + encodedUrl, "_blank");
          break;
        case "email": {
          const subject = encodeURIComponent("เอกสาร " + docName + " จาก บุญสุข อิเล็กทรอนิกส์");
          const body = encodeURIComponent("สวัสดีครับ/ค่ะ\n\nส่งเอกสาร " + docName + " มาให้ตามที่ตกลงไว้\nเปิดดูได้ที่: " + url + "\n\nขอบคุณครับ/ค่ะ\nบุญสุข อิเล็กทรอนิกส์");
          window.open("mailto:?subject=" + subject + "&body=" + body);
          break;
        }
      }
    });
  });

  // Auto-select input text for easy copy
  document.getElementById("shareLinkInput")?.addEventListener("click", function() { this.select(); });
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
