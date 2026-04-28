// ═══════════════════════════════════════════════════════════
//  DELIVERY INVOICES — ใบส่งสินค้า / ใบแจ้งหนี้
//  ★ รายการ, preview, พิมพ์, PDF, แชร์, สร้างใบเสร็จ
// ═══════════════════════════════════════════════════════════

// share ใช้ window._appShareDoc จาก main.js

function money(n){ return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0)); }
function num(n){ return new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0)); }
function dateTH(d){ if(!d) return "-"; try{ return new Date(d).toLocaleDateString("th-TH",{year:"numeric",month:"short",day:"numeric"}); }catch(e){ return d; } }

// ─── Thai baht amount to words ("หนึ่งพันสองร้อยบาทถ้วน") ───
function bahtText(amount) {
  const nums = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const places = ['','สิบ','ร้อย','พัน','หมื่น','แสน'];
  function u1M(n){ if(n<=0)return ''; const s=String(n); let o=''; for(let i=0;i<s.length;i++){const d=+s[i],p=s.length-1-i; if(d===0)continue; if(p===1&&d===1)o+='สิบ'; else if(p===1&&d===2)o+='ยี่สิบ'; else if(p===0&&d===1&&s.length>1)o+='เอ็ด'; else o+=nums[d]+places[p];} return o; }
  function rd(n){ if(n===0)return 'ศูนย์'; let o=''; if(n>=1000000){const m=Math.floor(n/1000000); o+=rd(m)+'ล้าน'; n=n%1000000;} o+=u1M(n); return o; }
  const r=Math.round(Number(amount||0)*100)/100, i=Math.floor(r), sat=Math.round((r-i)*100);
  if(i===0&&sat===0) return 'ศูนย์บาทถ้วน';
  let t=''; if(i>0) t+=rd(i)+'บาท';
  if(sat===0) t+=i>0?'ถ้วน':''; else t+=u1M(sat)+'สตางค์';
  return t;
}

const STATUS_LABELS = {
  pending:    "รอดำเนินการ",
  delivered:  "ส่งสินค้าแล้ว",
  receipted:  "เปิดใบเสร็จแล้ว",
  cancelled:  "ยกเลิก",
  partial:    "ส่งบางส่วน"
};
const STATUS_COLOR = {
  pending:    "#f59e0b",
  delivered:  "#10b981",
  receipted:  "#6366f1",
  cancelled:  "#ef4444",
  partial:    "#0284c7"
};

let _ctx = null;
let _lineItems = [];
let _viewMode = "list";  // list | preview
let _viewingId = null;
let _tabFilter = "all";  // all | pending | receipted | cancelled
let _selectedIds = new Set();

// Due date helper — created_at + credit_days หรือ inv.due_date ถ้ามี
function getDueDate(inv) {
  if (inv.due_date) return new Date(inv.due_date);
  const days = Number(inv.credit_days || 0);
  if (!inv.created_at) return null;
  const d = new Date(inv.created_at);
  d.setDate(d.getDate() + days);
  return d;
}

export function renderDeliveryInvoicesPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-delivery_invoices");
  if (!container) return;

  // Phase 45.10 (B5-2): clear stale line items + selection ตอนเข้าหน้า
  // (ป้องกัน items จาก preview ใบเก่า leak มาใบใหม่)
  if (!window._pendingInvoicePreviewId && _viewMode === "list") {
    _lineItems = [];
    _selectedIds.clear();
  }

  // ★ ถ้าถูก trigger จากหน้าอื่น (เช่น receipts กด "อ้างอิง") → เปิด preview
  if (window._pendingInvoicePreviewId) {
    const pendingId = window._pendingInvoicePreviewId;
    window._pendingInvoicePreviewId = null;
    (async () => {
      _viewingId = pendingId;
      _viewMode = "preview";
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      try {
        const resp = await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + pendingId + "&order=sort_order.asc",
          { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
        _lineItems = ((await resp.json()) || []).map(i => ({
          item_name: i.item_name || "", qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
          unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
          line_total: Number(i.line_total||0)
        }));
      } catch(e) { _lineItems = []; }
      renderDeliveryInvoicesPage(ctx);
    })();
    return;
  }

  if (_viewMode === "preview" && _viewingId) { renderInvoicePreview(container); return; }

  _viewMode = "list";
  const invoices = ctx.state.deliveryInvoices || [];

  const countAll = invoices.length;
  const countPending = invoices.filter(i => i.status === "pending").length;
  const countReceipted = invoices.filter(i => i.status === "receipted").length;
  const countCancelled = invoices.filter(i => i.status === "cancelled").length;
  const filtered = invoices.filter(i => {
    if (_tabFilter === "all") return true;
    return i.status === _tabFilter;
  });
  _selectedIds = new Set([..._selectedIds].filter(id => filtered.some(i => i.id === id)));

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบส่งสินค้า / ใบแจ้งหนี้</h3>
        <span class="sku">สร้างจากใบเสนอราคาที่อนุมัติแล้ว</span>
      </div>

      <div class="stats-grid mt16" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="stat-label">ทั้งหมด</div>
          <div class="stat-value">${countAll}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">รอดำเนินการ</div>
          <div class="stat-value" style="color:#f59e0b">${countPending}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">เปิดใบเสร็จแล้ว</div>
          <div class="stat-value" style="color:#6366f1">${countReceipted}</div>
        </div>
      </div>

      <div class="di-tabs" style="display:flex;gap:6px;margin-top:16px;border-bottom:2px solid #e2e8f0;overflow-x:auto">
        ${[
          ['all', 'แสดงทั้งหมด', countAll, '#64748b'],
          ['pending', 'รอดำเนินการ', countPending, '#f59e0b'],
          ['receipted', 'เปิดใบเสร็จแล้ว', countReceipted, '#6366f1'],
          ['cancelled', 'ยกเลิก', countCancelled, '#ef4444']
        ].map(([k,label,n,color]) => {
          const active = _tabFilter === k;
          return `<button class="di-tab-btn" data-di-tab="${k}" style="padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;color:${active?color:'#64748b'};border-bottom:${active?`2px solid ${color}`:'2px solid transparent'};margin-bottom:-2px">${label} <span style="color:#94a3b8;font-weight:400">(${n})</span></button>`;
        }).join('')}
      </div>

      ${_selectedIds.size > 0 ? `
      <div class="bulk-bar" style="display:flex;align-items:center;gap:12px;padding:10px 14px;margin-top:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;flex-wrap:wrap">
        <span style="font-weight:700;color:#1e40af">เลือก ${_selectedIds.size} รายการ</span>
        <button id="diBulkCancel" style="padding:6px 14px;background:#f59e0b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600" title="เปลี่ยนสถานะเป็น 'ยกเลิก' — เก็บในระบบ">ยกเลิก (เก็บประวัติ)</button>
        <button id="diBulkDelete" style="padding:6px 14px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600" title="ลบออกจากระบบถาวร พร้อม restore ใบเสนอราคา">🗑️ ลบถาวร</button>
        <button id="diBulkClear" style="padding:6px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:6px;cursor:pointer;font-size:12px">ล้างการเลือก</button>
      </div>
      ` : ''}

      <style>
        .doc-list-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;margin-top:12px}
        .doc-list-table th{background:#f8fafc;color:#475569;font-weight:700;text-align:left;padding:10px 12px;border-bottom:2px solid #e2e8f0;font-size:12px;white-space:nowrap}
        .doc-list-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
        .doc-list-table tbody tr:hover{background:#fafbfc}
        .doc-list-table .status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle}
        .doc-list-table .doc-no{font-weight:700;color:#1e293b}
        .doc-list-table .pdf-icon-btn{background:none;border:none;cursor:pointer;padding:2px 4px;margin-left:4px;opacity:.6;font-size:14px}
        .doc-list-table .pdf-icon-btn:hover{opacity:1}
        .doc-list-table .right{text-align:right}
        .doc-list-table .status-badge{display:inline-block;padding:4px 10px;border-radius:14px;font-size:12px;font-weight:600}
        .doc-list-table .row-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
        .doc-list-table .row-actions button{font-size:11px;padding:5px 10px;border-radius:6px;border:none;cursor:pointer;font-weight:600;white-space:nowrap}
      </style>

      <div style="overflow-x:auto;margin-top:12px">
      <table class="doc-list-table">
        <thead>
          <tr>
            <th style="width:36px"><input type="checkbox" id="diSelectAll" ${filtered.length > 0 && filtered.every(i => _selectedIds.has(i.id)) ? 'checked' : ''} style="cursor:pointer"></th>
            <th style="width:100px">วันที่</th>
            <th>เลขที่เอกสาร</th>
            <th>ชื่อลูกค้า/ชื่อโปรเจ็ค</th>
            <th style="width:110px">วันครบกำหนด</th>
            <th class="right" style="width:120px">ยอดรวมสุทธิ</th>
            <th style="width:170px">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map(inv => {
            const status      = inv.status || "pending";
            const statusLabel = STATUS_LABELS[status] || status;
            const statusColor = STATUS_COLOR[status] || "#9ca3af";
            const canReceipt  = !['receipted','cancelled'].includes(status);
            const due = getDueDate(inv);
            const dueStr = due ? dateTH(due) : "-";
            const overdue = due && status !== 'receipted' && status !== 'cancelled' && due < new Date();
            return `
              <tr>
                <td><input type="checkbox" class="di-row-check" data-di-sel="${inv.id}" ${_selectedIds.has(inv.id) ? 'checked' : ''} style="cursor:pointer"></td>
                <td class="sku">${dateTH(inv.created_at)}</td>
                <td>
                  <span class="status-dot" style="background:${statusColor}"></span>
                  <a href="#" class="di-view-btn doc-no" data-di-id="${inv.id}" style="color:#1e293b;text-decoration:none;font-weight:700;cursor:pointer" title="คลิกดูเอกสาร">${escHtml(inv.inv_no || "-")}</a>
                  <button class="pdf-icon-btn di-view-btn" data-di-id="${inv.id}" title="ดูเอกสาร">📄</button>
                  ${inv.ref_no || inv.quotation_id ? `<div class="sku" style="margin-left:16px;margin-top:2px">อ้างอิง: <a href="#" class="di-ref-link" data-di-ref-qt="${inv.quotation_id || ''}" data-di-ref-no="${escHtml(inv.ref_no || '')}" style="color:#f59e0b;text-decoration:none;font-weight:600">${escHtml(inv.ref_no || 'QT')} ↗</a></div>` : ''}
                </td>
                <td>${escHtml(inv.customer_name || "-")}</td>
                <td class="sku" style="${overdue ? 'color:#dc2626;font-weight:700' : ''}">${dueStr}${overdue ? ' ⚠️' : ''}</td>
                <td class="right" style="font-weight:700">${money(inv.grand_total||0)}</td>
                <td>
                  <select class="di-status-select" data-di-id="${inv.id}" style="width:100%;padding:5px 8px;border:1px solid ${statusColor}40;border-radius:6px;font-size:12px;font-weight:600;color:${statusColor};background:${statusColor}10;cursor:pointer">
                    <option value="" selected>${statusLabel}</option>
                    ${canReceipt ? `
                      <option value="receipt" style="color:#6366f1">🧾 ออกใบเสร็จ</option>
                      <option value="cancelled" style="color:#ef4444">✕ ยกเลิก</option>
                    ` : ''}
                  </select>
                </td>
              </tr>
            `;
          }).join("") : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px 20px">ไม่มีใบส่งสินค้าในหมวดนี้</td></tr>'}
        </tbody>
      </table>
      </div>
    </div>
  `;

  // ── Tab click ──
  container.querySelectorAll(".di-tab-btn").forEach(btn => btn.addEventListener("click", () => {
    _tabFilter = btn.dataset.diTab;
    renderDeliveryInvoicesPage(_ctx);
  }));

  // ── Reference link: เปิดใบเสนอราคาที่อ้างอิง ──
  container.querySelectorAll(".di-ref-link").forEach(link => link.addEventListener("click", (e) => {
    e.preventDefault();
    const qtId = Number(link.dataset.diRefQt);
    const refNo = link.dataset.diRefNo;
    let target = null;
    if (qtId) target = (ctx.state.quotations || []).find(x => x.id === qtId);
    if (!target && refNo) target = (ctx.state.quotations || []).find(x => x.qt_no === refNo);
    if (!target) {
      window.App?.showToast?.("ไม่พบใบเสนอราคานี้ในรายการ");
      return;
    }
    window._pendingQuotationPreviewId = target.id;
    window.App?.showRoute?.("quotations");
  }));

  // ── Select all ──
  document.getElementById("diSelectAll")?.addEventListener("change", (e) => {
    const check = e.target.checked;
    container.querySelectorAll(".di-row-check").forEach(cb => {
      const id = Number(cb.dataset.diSel);
      if (check) _selectedIds.add(id);
      else _selectedIds.delete(id);
      cb.checked = check;
    });
    renderDeliveryInvoicesPage(_ctx);
  });

  // ── Row checkbox ──
  container.querySelectorAll(".di-row-check").forEach(cb => cb.addEventListener("change", (e) => {
    const id = Number(cb.dataset.diSel);
    if (e.target.checked) _selectedIds.add(id);
    else _selectedIds.delete(id);
    renderDeliveryInvoicesPage(_ctx);
  }));

  // ── Bulk cancel (soft) ──
  document.getElementById("diBulkCancel")?.addEventListener("click", async () => {
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`ยกเลิกใบส่งสินค้า ${ids.length} รายการ?\n(เปลี่ยนสถานะเป็น "ยกเลิก" — ยังอยู่ใน tab "ยกเลิก")`))) return;
    window.App?.showToast?.(`กำลังยกเลิก ${ids.length} รายการ...`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await window._appXhrPatch?.("delivery_invoices", { status: "cancelled" }, "id", id);
        if (res?.ok) ok++; else fail++;
      } catch(e) { fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ยกเลิกสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail}` : ''}`);
    // Phase 45.11: non-blocking reload
    if (ctx.loadAllData) ctx.loadAllData().catch(e => console.warn("[di] reload", e));
    renderDeliveryInvoicesPage(_ctx);
  });

  // ── Bulk delete (hard) — ลบถาวร + restore quotation status ──
  document.getElementById("diBulkDelete")?.addEventListener("click", async () => {
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`⚠️ ลบใบส่งสินค้า ${ids.length} รายการออกจากระบบถาวร?\nใบเสนอราคาที่อ้างอิงจะกลับสถานะเป็น "อนุมัติแล้ว"\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`))) return;
    window.App?.showToast?.(`กำลังลบ ${ids.length} รายการ...`);

    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=representation" };

    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const inv = (ctx.state.deliveryInvoices || []).find(x => x.id === id);
        // 1. ลบ items
        await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + id, { method: "DELETE", headers });
        // 2. ลบ invoice
        const delResp = await fetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + id, { method: "DELETE", headers });
        const deleted = await delResp.json().catch(() => []);
        if (!delResp.ok || !Array.isArray(deleted) || deleted.length === 0) { fail++; continue; }
        // 3. restore quotation status
        const qtId = inv?.quotation_id;
        if (qtId) {
          await fetch(cfg.url + "/rest/v1/quotations?id=eq." + qtId,
            { method: "PATCH", headers, body: JSON.stringify({ status: "approved" }) });
        }
        ok++;
      } catch(e) { console.error("[delivery_invoices bulk delete]", e); fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ลบสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail} (RLS บล็อค?)` : ''}`);
    // Phase 45.11: non-blocking reload
    if (ctx.loadAllData) ctx.loadAllData().catch(e => console.warn("[di] reload", e));
    renderDeliveryInvoicesPage(_ctx);
  });

  document.getElementById("diBulkClear")?.addEventListener("click", () => {
    _selectedIds.clear();
    renderDeliveryInvoicesPage(_ctx);
  });

  // ── View (📄) ──
  container.querySelectorAll(".di-view-btn").forEach(btn => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const inv = (ctx.state.deliveryInvoices || []).find(x => x.id === Number(btn.dataset.diId));
    if (inv) {
      _viewingId = inv.id;
      _viewMode = "preview";
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      try {
        const resp = await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + inv.id + "&order=sort_order.asc",
          { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
        _lineItems = ((await resp.json()) || []).map(i => ({
          item_name: i.item_name || "", qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
          unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
          line_total: Number(i.line_total||0)
        }));
      } catch(e) { _lineItems = []; }
      renderDeliveryInvoicesPage(ctx);
    }
  }));

  // ── Status dropdown: ออกใบเสร็จ / ยกเลิก ──
  container.querySelectorAll(".di-status-select").forEach(sel => sel.addEventListener("change", async (e) => {
    const invId = Number(sel.dataset.diId);
    const action = e.target.value;
    const inv = (ctx.state.deliveryInvoices || []).find(x => x.id === invId);
    if (!inv || !action) return;
    e.target.value = "";

    if (action === "receipt") {
      // เปิด convertToReceipt (มี pre-check + form)
      convertToReceipt(inv);
    } else if (action === "cancelled") {
      if (!(await window.App?.confirm?.(`ยกเลิกใบส่งสินค้า "${inv.inv_no}" ?`))) return;
      try {
        const res = await window._appXhrPatch?.("delivery_invoices", { status: "cancelled" }, "id", invId);
        if (res?.ok) {
          window.App?.showToast?.("ยกเลิกเรียบร้อย");
          // Phase 45.11: non-blocking reload
    if (ctx.loadAllData) ctx.loadAllData().catch(e => console.warn("[di] reload", e));
          renderDeliveryInvoicesPage(_ctx);
        } else throw new Error(res?.error?.message || "fail");
      } catch (err) {
        console.error("[delivery_invoices cancel] error:", err);
        window.App?.showToast?.("❌ ยกเลิกไม่สำเร็จ: " + (err.message || err));
      }
    }
  }));
}

function renderInvoicePreview(container) {
  const inv = (_ctx.state.deliveryInvoices || []).find(x => x.id === _viewingId);
  if (!inv) { _viewMode = "list"; renderDeliveryInvoicesPage(_ctx); return; }

  const si = _ctx.state.storeInfo || {};
  const subtotal   = Number(inv.total_amount || 0);
  const discPct    = Number(inv.discount_pct || 0);
  const discAmount = Number(inv.discount_amount || 0);
  const afterDisc  = Number(inv.after_discount || subtotal);
  const whtChecked = inv.withholding_tax || false;
  const whtPct     = Number(inv.wht_pct || 3);
  const whtAmount  = Number(inv.wht_amount || 0);
  const grandTotal = Number(inv.grand_total || 0);

  // ★ เช็คว่ามีใบเสร็จอ้างอิงใบส่งสินค้านี้อยู่หรือไม่ — ถ้ามี = lock ห้ามแก้วันที่
  const hasReceipt = (_ctx.state.receipts || []).some(rc =>
    rc.delivery_invoice_id === inv.id && rc.status !== 'cancelled'
  );

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <button id="diPreviewBack" class="btn light">&larr; กลับ</button>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#f8fafc">
            <input type="checkbox" id="diShowDate" checked style="width:15px;height:15px;cursor:pointer" />
            ลงวันที่
          </label>
          ${hasReceipt ? `
          <span style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #fecaca;border-radius:8px;padding:6px 10px;background:#fef2f2;color:#991b1b" title="มีใบเสร็จอ้างอิงอยู่ — ต้องลบใบเสร็จก่อนถึงจะแก้วันที่ได้">
            🔒 วันที่: ${dateTH(inv.created_at)} (ล็อก — มีใบเสร็จแล้ว)
          </span>
          ` : `
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#fffbeb" title="ยังไม่มีใบเสร็จ — แก้วันที่ได้">
            <span>📅 วันที่เอกสาร:</span>
            <input type="date" id="diEditDate" value="${(inv.created_at || new Date().toISOString()).slice(0,10)}" style="border:1px solid #d1d5db;border-radius:6px;padding:3px 6px;font-size:13px;cursor:pointer" />
          </label>
          `}
          ${inv.status !== 'receipted' ? '<button id="diEditBtn" class="btn light" style="border:1px solid #cbd5e1">✏️ แก้ไข</button>' : ''}
          <button id="diShareBtn" class="btn" style="background:#06C755;color:#fff">📤 แชร์</button>
          <button id="diPrintBtn" class="btn light">🖨️ พิมพ์</button>
          <button id="diPdfBtn" class="btn primary">📄 PDF</button>
          ${!['receipted','cancelled'].includes(inv.status) ? '<button id="diConvertReceiptBtn" class="btn" style="background:#6366f1;color:#fff">🧾 ออกใบเสร็จ</button>' : ''}
          ${inv.status !== 'receipted' ? '<button id="diDeleteBtn" class="btn" style="background:#ef4444;color:#fff">🗑️ ลบ</button>' : ''}
        </div>
      </div>
    </div>

    <div id="diDocPreview" class="doc-preview mt16">
      ${[1,2].map(pageNum => `
      <div class="doc-page">
        <div class="doc-accent inv"></div>
        <div class="doc-page-inner">
          <div class="doc-header">
            <div class="doc-header-left">
              <img src="${window._appGetLogo ? window._appGetLogo() : './logo.svg'}" class="doc-logo" onerror="this.style.display='none'" />
              <div>
                <div class="doc-company-name">${escHtml(si.name || "บุญสุข อิเล็กทรอนิกส์")}</div>
                <div class="doc-company-detail">
                  ${si.address ? escHtml(si.address)+'<br>' : ''}
                  ${si.taxId ? 'เลขประจำตัวผู้เสียภาษี '+escHtml(si.taxId)+'<br>' : ''}
                  ${si.phone ? 'โทร. '+escHtml(si.phone) : ''}
                </div>
              </div>
            </div>
            <div class="doc-header-right">
              <div class="doc-title inv">ใบส่งสินค้า/ใบแจ้งหนี้</div>
              <div class="doc-copy-label" style="display:inline-block;border:1.5px solid ${pageNum === 1 ? '#0369a1' : '#94a3b8'};color:${pageNum === 1 ? '#0369a1' : '#64748b'};background:${pageNum === 1 ? '#eff6ff' : '#f8fafc'};padding:3px 10px;border-radius:14px;font-weight:700;margin-top:4px">${pageNum === 1 ? 'ต้นฉบับ · สำหรับลูกค้า' : 'สำเนา · สำหรับร้าน'}</div>
              <table class="doc-detail-table">
                <tr><td>เลขที่</td><td>${escHtml(inv.inv_no || '-')}</td></tr>
                <tr><td>วันที่</td><td id="diDateCell">..................................</td></tr>
                <tr><td>ผู้ขาย</td><td>${escHtml(inv.salesperson || '-')}</td></tr>
                <tr><td>อ้างอิง</td><td>${escHtml(inv.ref_no || inv.quotation_id || '-')}</td></tr>
              </table>
            </div>
          </div>

          <div class="doc-customer-section">
            <div class="doc-customer-label inv">ลูกค้า</div>
            <div class="doc-customer-name">${escHtml(inv.customer_name || '-')}</div>
            <div class="doc-customer-detail">
              ${inv.customer_address ? escHtml(inv.customer_address) : ''}
              ${inv.customer_phone ? '<br>โทร. '+escHtml(inv.customer_phone) : ''}
              ${inv.customer_tax_id ? '<br>เลขผู้เสียภาษี '+escHtml(inv.customer_tax_id) : ''}
            </div>
          </div>

          <table class="doc-table">
            <thead><tr>
              <th style="text-align:left">รายละเอียด</th>
              <th style="width:65px">จำนวน</th><th style="width:55px">หน่วย</th>
              <th style="width:95px">ราคาต่อหน่วย</th>
              <th style="width:95px">ยอดรวม</th>
            </tr></thead>
            <tbody>
              ${_lineItems.length ? _lineItems.map((item) => '<tr>'
                +'<td style="text-align:left">'+escHtml(item.item_name)+'</td>'
                +'<td style="text-align:center">'+num(item.qty)+'</td>'
                +'<td style="text-align:center">'+(item.unit||'ชิ้น')+'</td>'
                +'<td style="text-align:right">'+num(item.unit_price)+'</td>'
                +'<td style="text-align:right">'+num(item.line_total)+'</td>'
                +'</tr>').join('') : '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px">ไม่มีรายการ</td></tr>'}
            </tbody>
          </table>

          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:4px">
            <div class="doc-baht-text">(${bahtText(grandTotal)})</div>
            <div class="doc-totals">
              <div class="doc-total-row"><span>รวมเป็นเงิน</span><span>${num(subtotal)} บาท</span></div>
              ${discPct > 0 ? '<div class="doc-total-row"><span>ส่วนลด '+discPct+'%</span><span>-'+num(discAmount)+' บาท</span></div>' : ''}
              ${whtChecked ? '<div class="doc-total-row"><span>หัก ณ ที่จ่าย '+whtPct+'%</span><span>-'+num(whtAmount)+' บาท</span></div>' : ''}
              <div class="doc-total-row grand inv" style="color:#1a1a1a"><span>จำนวนเงินรวมทั้งสิ้น</span><span>${num(grandTotal)} บาท</span></div>
            </div>
          </div>

          <div class="doc-note-section">
            <div class="doc-note-title inv">หมายเหตุ</div>
            <div>${inv.note ? escHtml(inv.note) : 'วิธีการชำระเงิน-ชำระเงินสด/เช็คเงินสด โอนผ่านธนาคาร'}</div>
          </div>

          <div class="doc-signatures">
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">${escHtml(inv.customer_name || '-')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้รับสินค้า / บริการ</span><span>วันที่</span></div>
            </div>
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">${escHtml(si.name || 'บุญสุข อิเล็กทรอนิกส์')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้อนุมัติ</span><span>วันที่</span></div>
            </div>
          </div>
        </div>
      </div>
      `).join('')}
    </div>
  `;

  document.getElementById("diPreviewBack")?.addEventListener("click", () => {
    _viewMode = "list"; _viewingId = null;
    renderDeliveryInvoicesPage(_ctx);
  });

  // Phase 45.12: edit basic fields (customer info, salesperson, ref, project, due_date, note)
  document.getElementById("diEditBtn")?.addEventListener("click", () => _openEditDrawer(inv));

  // ── delete delivery invoice → restore quotation status ──
  document.getElementById("diDeleteBtn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ลบใบส่งสินค้า ${inv.inv_no} ?\n\nใบเสนอราคาที่อ้างอิงจะกลับสถานะเป็น "อนุมัติแล้ว" เพื่อให้แก้ไขหรือลบได้`))) return;
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    // ★ return=representation — ได้ rows ที่ลบกลับมาเช็คว่า RLS ไม่บล็อค
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=representation" };
    try {
      // 1. ลบ delivery_invoice_items
      await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + inv.id, { method: "DELETE", headers });
      // 2. ลบ delivery_invoice — verify ว่าลบจริง
      const delResp = await fetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + inv.id, { method: "DELETE", headers });
      if (!delResp.ok) throw new Error("HTTP " + delResp.status);
      const deleted = await delResp.json().catch(() => []);
      if (!Array.isArray(deleted) || deleted.length === 0) {
        throw new Error("ไม่มี row ถูกลบ — RLS อาจบล็อค DELETE policy กรุณารัน supabase-rls-policies.sql");
      }
      // 3. คืนสถานะ quotation กลับเป็น approved
      const qtId = inv.quotation_id || null;
      if (qtId) {
        await fetch(cfg.url + "/rest/v1/quotations?id=eq." + qtId,
          { method: "PATCH", headers, body: JSON.stringify({ status: "approved" }) });
      }
      _ctx.showToast("ลบใบส่งสินค้าแล้ว ✓");
      _viewMode = "list"; _viewingId = null;
      await _ctx.loadAllData();
      renderDeliveryInvoicesPage(_ctx);
    } catch(e) {
      console.error("[delivery_invoices delete] error:", e);
      _ctx.showToast("❌ ลบไม่สำเร็จ: " + (e.message || e));
    }
  });

  // ── date toggle ──
  const diDateCell = document.getElementById("diDateCell");
  const diShowDate = document.getElementById("diShowDate");
  if (diShowDate && diDateCell) {
    diShowDate.addEventListener("change", () => {
      diDateCell.textContent = diShowDate.checked ? dateTH(inv.created_at) : "..................................";
    });
  }

  // ★ แก้วันที่เอกสาร — อนุญาตเมื่อไม่มีใบเสร็จอ้างอิง
  document.getElementById("diEditDate")?.addEventListener("change", async (ev) => {
    const newDate = ev.target.value;
    if (!newDate) return;
    const isoDate = newDate + "T00:00:00.000Z";
    try {
      const res = await window._appXhrPatch?.("delivery_invoices", { created_at: isoDate }, "id", inv.id);
      if (res && res.ok === false) throw new Error(res.error?.message || "patch failed");
      inv.created_at = isoDate;
      if (diShowDate?.checked && diDateCell) diDateCell.textContent = dateTH(isoDate);
      _ctx.showToast("อัปเดตวันที่เรียบร้อย ✓");
    } catch (e) {
      console.error("[delivery_invoices edit date] error:", e);
      _ctx.showToast("❌ แก้วันที่ไม่สำเร็จ: " + (e.message || e));
      ev.target.value = (inv.created_at || "").slice(0,10);
    }
  });

  document.getElementById("diShareBtn")?.addEventListener("click", () => {
    window._appShareDoc("diDocPreview", inv.inv_no || "invoice");
  });

  document.getElementById("diPrintBtn")?.addEventListener("click", () => {
    const content = document.getElementById("diDocPreview")?.innerHTML; if (!content) return;
    const w = window.open("","_blank");
    w.document.write('<html><head><title>ใบส่งสินค้า</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}body{font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;margin:0;padding:0;color:#1a1a1a;font-size:14px}.doc-preview{padding:0}.doc-page{width:210mm;min-height:297mm;padding:20mm 18mm 15mm;box-sizing:border-box;page-break-after:always;position:relative;display:flex;flex-direction:column}.doc-page:last-child{page-break-after:avoid}.doc-page-inner{flex:1;display:flex;flex-direction:column}.doc-accent{height:5px;width:100%;position:absolute;top:0;left:0}.doc-accent.inv{background:linear-gradient(90deg,#0369a1,#0284c7,#38bdf8)}.doc-page-badge{position:absolute;top:0;right:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;background:#0284c7}.doc-copy-label{font-size:13px;font-weight:600;color:#64748b;text-align:center}.doc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.doc-header-left{display:flex;gap:12px;max-width:55%}.doc-logo{width:64px;height:64px;border-radius:8px;object-fit:contain}.doc-company-name{font-size:16px;font-weight:900;margin-bottom:4px}.doc-company-detail{font-size:12px;color:#555;line-height:1.7}.doc-title{font-size:26px;font-weight:900}.doc-title.inv{color:#0369a1}.doc-detail-table{margin-left:auto;border-collapse:collapse;font-size:13px;margin-top:8px}.doc-detail-table td{padding:3px 10px;border:1px solid #d1d5db}.doc-detail-table td:first-child{font-weight:700;color:#555;background:#f9fafb;white-space:nowrap}.doc-customer-section{margin:12px 0 16px}.doc-customer-label{font-weight:800;font-size:12px;text-decoration:underline;margin-bottom:4px;color:#0369a1}.doc-customer-name{font-weight:700;font-size:14px}.doc-customer-detail{font-size:13px;color:#333;line-height:1.6}.doc-table{width:100%;border-collapse:collapse;margin:12px 0 8px}.doc-table th{padding:8px 10px;font-size:12px;font-weight:700;text-align:center;border:1px solid #d1d5db;background:#f3f4f6;color:#333}.doc-table td{padding:8px 10px;font-size:13px;border:1px solid #d1d5db;vertical-align:top}.doc-totals{margin-left:auto;width:280px;margin-top:4px}.doc-total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#333}.doc-total-row.grand{font-size:14px;font-weight:900;padding-top:8px;margin-top:4px}.doc-total-row.grand.inv{color:#1a1a1a;border-top:2px solid #0369a1}.doc-note-section{margin-top:16px;font-size:12.5px;line-height:1.7}.doc-note-title{font-weight:800;text-decoration:underline;margin-bottom:2px;color:#0369a1}.doc-signatures{display:flex;justify-content:space-between;margin-top:auto;padding-top:24px;font-size:13px}.doc-sig-col{text-align:center;width:42%}.doc-sig-behalf{font-weight:600;margin-bottom:28px;font-size:12.5px}.doc-sig-line{width:200px;border-bottom:1px solid #333;margin:0 auto 6px}.doc-sig-label-row{display:flex;justify-content:center;gap:40px;font-size:12px}</style></head><body>'+content+'</body></html>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  });

  document.getElementById("diPdfBtn")?.addEventListener("click", async () => {
    const pages = document.querySelectorAll("#diDocPreview .doc-page");
    if (!pages.length || !window.html2canvas) return _ctx.showToast("ไม่สามารถสร้าง PDF");
    _ctx.showToast("กำลังสร้าง PDF...");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p","mm","a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: "#fff" });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(imgData, "JPEG", 0, 0, w, h);
    }
    pdf.save((inv.inv_no||'invoice')+'.pdf');
    _ctx.showToast("ดาวน์โหลด PDF แล้ว");
  });

  // ออกใบเสร็จรับเงิน from preview
  document.getElementById("diConvertReceiptBtn")?.addEventListener("click", () => convertToReceipt(inv));
}

// ═══════════════════════════════════════════════════════════
//  CONVERT — Delivery Invoice → Receipt (ใบเสร็จรับเงิน)
// ═══════════════════════════════════════════════════════════
async function convertToReceipt(inv) {
  // ★ ป้องกันสร้างซ้ำ — เช็คว่ามีใบเสร็จจากใบส่งสินค้านี้อยู่แล้วไหม
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const chkResp = await fetch(
      cfg.url + "/rest/v1/receipts?delivery_invoice_id=eq." + inv.id + "&select=receipt_no,status",
      { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } }
    );
    const existing = await chkResp.json().catch(() => []);
    const active = Array.isArray(existing) ? existing.filter(d => d.status !== "cancelled") : [];
    if (active.length > 0) {
      const list = active.map(d => d.receipt_no).join(", ");
      const msg = `⚠️ มีใบเสร็จจากใบส่งสินค้านี้อยู่แล้ว: ${list}\n\nต้องการออกใบใหม่อีกใบหรือไม่?\n(ปกติควรลบใบเดิมก่อน)`;
      if (!(await window.App?.confirm?.(msg))) return;
    } else {
      if (!(await window.App?.confirm?.("ออกใบเสร็จรับเงินจากใบส่งสินค้านี้?"))) return;
    }
  } catch(e) {
    console.warn("[delivery_invoices convert] duplicate check failed, fallback to confirm:", e);
    if (!(await window.App?.confirm?.("ออกใบเสร็จรับเงินจากใบส่งสินค้านี้?"))) return;
  }

  // Load items if not loaded
  if (!_lineItems.length) {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    try {
      const resp = await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + inv.id + "&order=sort_order.asc",
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
  const receiptNo = "RC" + ds + String(Date.now()).slice(-3);

  const receiptPayload = {
    receipt_no: receiptNo,
    delivery_invoice_id: inv.id,
    quotation_id: inv.quotation_id || null,
    customer_name: inv.customer_name || "",
    customer_phone: inv.customer_phone || "",
    customer_address: inv.customer_address || "",
    customer_tax_id: inv.customer_tax_id || "",
    total_amount: inv.total_amount || 0,
    discount_pct: inv.discount_pct || 0,
    discount_amount: inv.discount_amount || 0,
    after_discount: inv.after_discount || inv.total_amount || 0,
    grand_total: inv.grand_total || 0,
    withholding_tax: inv.withholding_tax || false,
    wht_pct: inv.wht_pct || 3,
    wht_amount: inv.wht_amount || 0,
    net_total: inv.grand_total || 0,
    payment_method: inv.payment_terms || "เงินสด",
    payment_terms: inv.payment_terms || "เงินสด",
    credit_days: inv.credit_days || 0,
    project_name: inv.project_name || "",
    ref_no: inv.inv_no || "",
    salesperson: inv.salesperson || "",
    status: "paid",
    note: "จากใบส่งสินค้า " + (inv.inv_no || "")
  };

  _ctx.showToast("กำลังออกใบเสร็จรับเงิน...");
  const rcRes = await xhrPost("receipts", receiptPayload, { returnData: true });
  if (!rcRes.ok) return _ctx.showToast(rcRes.error?.message || "สร้างใบเสร็จไม่สำเร็จ");

  const receiptId = rcRes.data?.id;
  if (receiptId && _lineItems.length) {
    for (let i = 0; i < _lineItems.length; i++) {
      const li = _lineItems[i];
      await xhrPost("receipt_items", {
        receipt_id: receiptId, product_id: li.product_id || null,
        item_name: li.item_name, qty: li.qty, unit: li.unit || "ชิ้น",
        unit_price: li.unit_price, discount_pct: li.discount_pct || 0,
        line_total: li.line_total, sort_order: i + 1
      });
    }
  }

  // Update delivery invoice status
  await xhrPatch("delivery_invoices", { status: "receipted" }, "id", inv.id);

  // Update quotation status if linked
  if (inv.quotation_id) {
    await xhrPatch("quotations", { status: "receipted" }, "id", inv.quotation_id);
  }

  await _ctx.loadAllData();
  _ctx.showToast("ออกใบเสร็จรับเงินแล้ว: " + receiptNo);
  _viewMode = "list";
  _ctx.showRoute("receipts");
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════
//  Phase 45.12 — Edit drawer (basic fields only — line items lock)
// ═══════════════════════════════════════════════════════════
function _openEditDrawer(inv) {
  document.getElementById("diEditModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "diEditModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#eff6ff">
        <h3 style="margin:0;font-size:16px;color:#0369a1">✏️ แก้ไขใบส่งสินค้า ${escHtml(inv.inv_no || '')}</h3>
        <button id="diEditClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:11px;color:#64748b;background:#fef3c7;padding:6px 10px;border-radius:6px">
          ⚠️ แก้ได้เฉพาะข้อมูลทั่วไป — รายการสินค้า/ยอดรวม ล็อค (มาจากใบเสนอราคา ถ้าต้องแก้ → ยกเลิกใบนี้แล้วออกใหม่)
        </div>

        <label style="display:block">
          <span style="font-size:12px;color:#64748b">ชื่อลูกค้า *</span>
          <input id="diEdName" type="text" value="${escHtml(inv.customer_name || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">เบอร์โทร</span>
            <input id="diEdPhone" type="tel" value="${escHtml(inv.customer_phone || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">เลขผู้เสียภาษี</span>
            <input id="diEdTaxId" type="text" value="${escHtml(inv.customer_tax_id || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
        </div>
        <label style="display:block">
          <span style="font-size:12px;color:#64748b">ที่อยู่</span>
          <textarea id="diEdAddress" rows="2" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;resize:vertical;font-family:inherit">${escHtml(inv.customer_address || '')}</textarea>
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">ผู้ขาย</span>
            <input id="diEdSalesperson" type="text" value="${escHtml(inv.salesperson || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">วันครบกำหนด</span>
            <input id="diEdDueDate" type="date" value="${(inv.due_date || '').slice(0,10)}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">โครงการ</span>
            <input id="diEdProject" type="text" value="${escHtml(inv.project_name || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">ใบอ้างอิง</span>
            <input id="diEdRef" type="text" value="${escHtml(inv.ref_no || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
        </div>
        <label style="display:block">
          <span style="font-size:12px;color:#64748b">หมายเหตุ</span>
          <textarea id="diEdNote" rows="2" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;resize:vertical;font-family:inherit">${escHtml(inv.note || '')}</textarea>
        </label>

        <div id="diEdStatus" style="font-size:12px;min-height:16px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="diEdCancel" class="btn light">ยกเลิก</button>
          <button id="diEdSave" class="btn primary">💾 บันทึก</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("#diEditClose").addEventListener("click", close);
  modal.querySelector("#diEdCancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#diEdSave").addEventListener("click", async () => {
    const name = modal.querySelector("#diEdName").value.trim();
    if (!name) {
      modal.querySelector("#diEdStatus").innerHTML = '<span style="color:#dc2626">กรอกชื่อลูกค้า</span>';
      return;
    }
    const payload = {
      customer_name: name,
      customer_phone: modal.querySelector("#diEdPhone").value.trim(),
      customer_tax_id: modal.querySelector("#diEdTaxId").value.trim(),
      customer_address: modal.querySelector("#diEdAddress").value.trim(),
      salesperson: modal.querySelector("#diEdSalesperson").value.trim(),
      due_date: modal.querySelector("#diEdDueDate").value || null,
      project_name: modal.querySelector("#diEdProject").value.trim(),
      ref_no: modal.querySelector("#diEdRef").value.trim(),
      note: modal.querySelector("#diEdNote").value.trim()
    };

    const saveBtn = modal.querySelector("#diEdSave");
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    try {
      const r = await window._appXhrPatch?.("delivery_invoices", payload, "id", inv.id);
      if (!r?.ok) throw new Error(r?.error?.message || "บันทึกไม่สำเร็จ");

      // Optimistic update local state
      try {
        const idx = (_ctx.state.deliveryInvoices || []).findIndex(x => x.id === inv.id);
        if (idx >= 0) _ctx.state.deliveryInvoices[idx] = { ..._ctx.state.deliveryInvoices[idx], ...payload };
      } catch(e){}

      window.App?.showToast?.("บันทึกสำเร็จ");
      close();
      renderDeliveryInvoicesPage(_ctx);
      // Background reload
      if (_ctx.loadAllData) _ctx.loadAllData().catch(e => console.warn("[diEdit] reload", e));
    } catch (e) {
      console.error("[diEdit save]", e);
      modal.querySelector("#diEdStatus").innerHTML = `<span style="color:#dc2626">${escHtml(e.message || String(e))}</span>`;
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 บันทึก";
    }
  });

  setTimeout(() => modal.querySelector("#diEdName")?.focus(), 100);
}
