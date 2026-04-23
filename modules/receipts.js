// ═══════════════════════════════════════════════════════════
//  RECEIPTS MODULE — ใบเสร็จรับเงิน
//  ★ รายการ, preview, พิมพ์, PDF, แชร์
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

// ★ เช็คว่า payment_method ตรงกับ target หรือไม่ (รองรับ Thai/English)
function _payIs(method, target) {
  const m = String(method || "").toLowerCase();
  const pats = {
    cash:     ['cash', 'เงินสด', 'สด', 'cod_cash'],
    cheque:   ['cheque', 'check', 'เช็ค'],
    transfer: ['transfer', 'โอน', 'bank', 'qr', 'cod_transfer'],
    credit:   ['credit', 'บัตร', 'card']
  };
  return (pats[target] || []).some(p => m.includes(p));
}

const STATUS_LABELS = {
  paid:      "ชำระแล้ว",
  partial:   "ชำระบางส่วน",
  pending:   "รอชำระ",
  cancelled: "ยกเลิก",
  refunded:  "คืนเงิน"
};
const STATUS_COLOR = {
  paid:      "#10b981",
  partial:   "#f59e0b",
  pending:   "#0284c7",
  cancelled: "#ef4444",
  refunded:  "#9ca3af"
};

let _ctx = null;
let _lineItems = [];
let _viewMode = "list";  // list | preview
let _viewingId = null;
let _tabFilter = "all";  // all | pending | paid | cancelled
let _selectedIds = new Set(); // bulk selection

// ═══════════════════════════════════════════════════════════
//  LIST PAGE
// ═══════════════════════════════════════════════════════════
export function renderReceiptsPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-receipts");
  if (!container) return;

  if (_viewMode === "preview" && _viewingId) { renderReceiptPreview(container); return; }

  _viewMode = "list";
  const receipts = ctx.state.receipts || [];

  // ★ Filter ตาม tab
  const countAll = receipts.length;
  const countPending = receipts.filter(r => r.status === "pending" || r.status === "partial").length;
  const countPaid = receipts.filter(r => r.status === "paid").length;
  const countCancelled = receipts.filter(r => r.status === "cancelled").length;
  const filtered = receipts.filter(r => {
    if (_tabFilter === "all") return true;
    if (_tabFilter === "pending") return r.status === "pending" || r.status === "partial";
    return r.status === _tabFilter;
  });

  // ล้าง selected ids ที่ถูก filter ออก
  _selectedIds = new Set([..._selectedIds].filter(id => filtered.some(r => r.id === id)));

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบเสร็จรับเงิน</h3>
        <span class="sku">สร้างจากใบส่งสินค้า</span>
      </div>

      <div class="stats-grid mt16" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="stat-label">ทั้งหมด</div>
          <div class="stat-value">${countAll}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ชำระแล้ว</div>
          <div class="stat-value" style="color:#10b981">${countPaid}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ยอดรวม</div>
          <div class="stat-value" style="color:#0284c7">${money(receipts.reduce((s,r) => s + Number(r.grand_total||0), 0))}</div>
        </div>
      </div>

      <!-- ★ Tab row -->
      <div class="rc-tabs" style="display:flex;gap:6px;margin-top:16px;border-bottom:2px solid #e2e8f0;overflow-x:auto">
        ${[
          ['all', 'แสดงทั้งหมด', countAll, '#64748b'],
          ['pending', 'รอชำระ', countPending, '#0284c7'],
          ['paid', 'ชำระแล้ว', countPaid, '#10b981'],
          ['cancelled', 'ยกเลิก', countCancelled, '#ef4444']
        ].map(([k,label,n,color]) => {
          const active = _tabFilter === k;
          return `<button class="rc-tab-btn" data-rc-tab="${k}" style="padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;color:${active?color:'#64748b'};border-bottom:${active?`2px solid ${color}`:'2px solid transparent'};margin-bottom:-2px">${label} <span style="color:#94a3b8;font-weight:400">(${n})</span></button>`;
        }).join('')}
      </div>

      <!-- ★ Bulk action bar -->
      ${_selectedIds.size > 0 ? `
      <div class="bulk-bar" style="display:flex;align-items:center;gap:12px;padding:10px 14px;margin-top:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;flex-wrap:wrap">
        <span style="font-weight:700;color:#1e40af">เลือก ${_selectedIds.size} รายการ</span>
        <button id="rcBulkCancel" style="padding:6px 14px;background:#f59e0b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600" title="เปลี่ยนสถานะเป็น 'ยกเลิก' — เก็บในระบบ">ยกเลิก (เก็บประวัติ)</button>
        <button id="rcBulkDelete" style="padding:6px 14px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600" title="ลบออกจากระบบถาวร พร้อม restore ใบส่งสินค้า">🗑️ ลบถาวร</button>
        <button id="rcBulkClear" style="padding:6px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:6px;cursor:pointer;font-size:12px">ล้างการเลือก</button>
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
        @media(max-width:700px){.doc-list-table .hide-sm{display:none}.doc-list-table th,.doc-list-table td{padding:8px 6px;font-size:12px}}
      </style>

      <div style="overflow-x:auto;margin-top:12px">
      <table class="doc-list-table">
        <thead>
          <tr>
            <th style="width:36px"><input type="checkbox" id="rcSelectAll" ${filtered.length > 0 && filtered.every(r => _selectedIds.has(r.id)) ? 'checked' : ''} style="cursor:pointer"></th>
            <th style="width:110px">วันที่</th>
            <th>เลขที่เอกสาร</th>
            <th>ชื่อลูกค้า/ชื่อโปรเจ็ค</th>
            <th class="right" style="width:130px">ยอดรวมสุทธิ</th>
            <th style="width:190px">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map(r => {
            const status = r.status || "paid";
            const statusLabel = STATUS_LABELS[status] || status;
            const statusColor = STATUS_COLOR[status] || "#9ca3af";
            const isPending = status === "pending" || status === "partial";
            const isPaid = status === "paid";
            return `
              <tr>
                <td><input type="checkbox" class="rc-row-check" data-rc-sel="${r.id}" ${_selectedIds.has(r.id) ? 'checked' : ''} style="cursor:pointer"></td>
                <td class="sku">${dateTH(r.created_at)}</td>
                <td>
                  <span class="status-dot" style="background:${statusColor}"></span>
                  <span class="doc-no">${escHtml(r.receipt_no || "-")}</span>
                  <button class="pdf-icon-btn rc-view-btn" data-rc-id="${r.id}" title="ดูเอกสาร">📄</button>
                  ${r.ref_no || r.delivery_invoice_id ? `<div class="sku" style="margin-left:16px;margin-top:2px">อ้างอิง: <a href="#" class="rc-ref-link" data-rc-ref-inv="${r.delivery_invoice_id || ''}" data-rc-ref-no="${escHtml(r.ref_no || '')}" style="color:#0284c7;text-decoration:none;font-weight:600">${escHtml(r.ref_no || 'INV')} ↗</a></div>` : ''}
                </td>
                <td>${escHtml(r.customer_name || "-")}</td>
                <td class="right" style="font-weight:700">${money(r.grand_total||0)}</td>
                <td>
                  <select class="rc-status-select" data-rc-id="${r.id}" style="width:100%;padding:5px 8px;border:1px solid ${statusColor}40;border-radius:6px;font-size:12px;font-weight:600;color:${statusColor};background:${statusColor}10;cursor:pointer">
                    <option value="" selected>${statusLabel}</option>
                    ${isPending ? `
                      <option value="paid" style="color:#10b981">✓ เก็บเงิน</option>
                      <option value="cancelled" style="color:#ef4444">✕ ยกเลิก</option>
                    ` : ''}
                    ${isPaid ? `
                      <option value="cancelled" style="color:#ef4444">✕ ยกเลิก</option>
                    ` : ''}
                  </select>
                </td>
              </tr>
            `;
          }).join("") : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px 20px">ไม่มีใบเสร็จในหมวดนี้</td></tr>'}
        </tbody>
      </table>
      </div>
    </div>
  `;

  // ── Tab click ──
  container.querySelectorAll(".rc-tab-btn").forEach(btn => btn.addEventListener("click", () => {
    _tabFilter = btn.dataset.rcTab;
    renderReceiptsPage(_ctx);
  }));

  // ── Reference link: เปิดใบส่งสินค้าที่อ้างอิง ──
  container.querySelectorAll(".rc-ref-link").forEach(link => link.addEventListener("click", (e) => {
    e.preventDefault();
    const invId = Number(link.dataset.rcRefInv);
    const refNo = link.dataset.rcRefNo;
    let target = null;
    if (invId) target = (ctx.state.deliveryInvoices || []).find(x => x.id === invId);
    if (!target && refNo) target = (ctx.state.deliveryInvoices || []).find(x => x.inv_no === refNo);
    if (!target) {
      window.App?.showToast?.("ไม่พบใบส่งสินค้านี้ในรายการ");
      return;
    }
    window._pendingInvoicePreviewId = target.id;
    window.App?.showRoute?.("delivery_invoices");
  }));

  // ── Select all checkbox ──
  document.getElementById("rcSelectAll")?.addEventListener("change", (e) => {
    const check = e.target.checked;
    container.querySelectorAll(".rc-row-check").forEach(cb => {
      const id = Number(cb.dataset.rcSel);
      if (check) _selectedIds.add(id);
      else _selectedIds.delete(id);
      cb.checked = check;
    });
    renderReceiptsPage(_ctx); // re-render เพื่อ update bulk bar
  });

  // ── Row checkbox ──
  container.querySelectorAll(".rc-row-check").forEach(cb => cb.addEventListener("change", (e) => {
    const id = Number(cb.dataset.rcSel);
    if (e.target.checked) _selectedIds.add(id);
    else _selectedIds.delete(id);
    renderReceiptsPage(_ctx);
  }));

  // ── Bulk cancel (soft — status change) ──
  document.getElementById("rcBulkCancel")?.addEventListener("click", async () => {
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`ยกเลิกใบเสร็จ ${ids.length} รายการ?\n(เปลี่ยนสถานะเป็น "ยกเลิก" — ใบเสร็จยังอยู่ใน tab "ยกเลิก")`))) return;
    window.App?.showToast?.(`กำลังยกเลิก ${ids.length} รายการ...`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await window._appXhrPatch?.("receipts", { status: "cancelled" }, "id", id);
        if (res?.ok) ok++; else fail++;
      } catch(e) { fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ยกเลิกสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail}` : ''}`);
    if (ctx.loadAllData) await ctx.loadAllData();
    renderReceiptsPage(_ctx);
  });

  // ── Bulk delete (hard — remove from DB + restore delivery_invoice status) ──
  document.getElementById("rcBulkDelete")?.addEventListener("click", async () => {
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`⚠️ ลบใบเสร็จ ${ids.length} รายการออกจากระบบถาวร?\nใบส่งสินค้าที่อ้างอิงจะกลับสถานะเป็น "รอดำเนินการ"\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`))) return;
    window.App?.showToast?.(`กำลังลบ ${ids.length} รายการ...`);

    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=representation" };

    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const r = (ctx.state.receipts || []).find(x => x.id === id);
        // 1. ลบ receipt_items
        await fetch(cfg.url + "/rest/v1/receipt_items?receipt_id=eq." + id, { method: "DELETE", headers });
        // 2. ลบ receipt
        const delResp = await fetch(cfg.url + "/rest/v1/receipts?id=eq." + id, { method: "DELETE", headers });
        const deleted = await delResp.json().catch(() => []);
        if (!delResp.ok || !Array.isArray(deleted) || deleted.length === 0) { fail++; continue; }
        // 3. restore delivery_invoice status
        const invId = r?.delivery_invoice_id;
        if (invId) {
          await fetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + invId,
            { method: "PATCH", headers, body: JSON.stringify({ status: "invoiced" }) });
        }
        ok++;
      } catch(e) { console.error("[receipts bulk delete]", e); fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ลบสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail} (RLS บล็อค?)` : ''}`);
    if (ctx.loadAllData) await ctx.loadAllData();
    renderReceiptsPage(_ctx);
  });

  // ── Bulk clear selection ──
  document.getElementById("rcBulkClear")?.addEventListener("click", () => {
    _selectedIds.clear();
    renderReceiptsPage(_ctx);
  });

  // ── View document (📄 icon) ──
  container.querySelectorAll(".rc-view-btn").forEach(btn => btn.addEventListener("click", async () => {
    const r = (ctx.state.receipts || []).find(x => x.id === Number(btn.dataset.rcId));
    if (r) {
      _viewingId = r.id;
      _viewMode = "preview";
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      try {
        const resp = await fetch(cfg.url + "/rest/v1/receipt_items?receipt_id=eq." + r.id + "&order=sort_order.asc",
          { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } });
        _lineItems = ((await resp.json()) || []).map(i => ({
          item_name: i.item_name || "", qty: Number(i.qty||1), unit: i.unit || "ชิ้น",
          unit_price: Number(i.unit_price||0), discount_pct: Number(i.discount_pct||0),
          line_total: Number(i.line_total||0)
        }));
      } catch(e) { _lineItems = []; }
      renderReceiptsPage(ctx);
    }
  }));

  // ── Status dropdown: เก็บเงิน / ยกเลิก ──
  container.querySelectorAll(".rc-status-select").forEach(sel => sel.addEventListener("change", async (e) => {
    const rcId = Number(sel.dataset.rcId);
    const action = e.target.value;
    const r = (ctx.state.receipts || []).find(x => x.id === rcId);
    if (!r || !action) return;

    // reset dropdown value กลับไปเหมือนเดิม
    e.target.value = "";

    const actionConfig = {
      paid:      { label: "เก็บเงิน",       status: "paid",      confirm: `ยืนยันเก็บเงิน "${r.receipt_no}" ยอด ${money(r.grand_total||0)} ?`, toast: "เก็บเงินเรียบร้อย ✅" },
      cancelled: { label: "ยกเลิกใบเสร็จ", status: "cancelled", confirm: `ยกเลิกใบเสร็จ "${r.receipt_no}" ?\nยกเลิกแล้วจะกลับคืนสถานะใบส่งสินค้า`, toast: "ยกเลิกใบเสร็จเรียบร้อย" }
    };
    const cfg = actionConfig[action];
    if (!cfg) return;
    if (!(await window.App?.confirm?.(cfg.confirm))) return;

    try {
      const res = await window._appXhrPatch?.("receipts", { status: cfg.status }, "id", rcId);
      if (res?.ok) {
        window.App?.showToast?.(cfg.toast);
        if (ctx.loadAllData) await ctx.loadAllData();
        renderReceiptsPage(_ctx);
      } else {
        // Supabase client fallback
        const { error } = await ctx.state.supabase.from("receipts").update({ status: cfg.status }).eq("id", rcId);
        if (!error) {
          window.App?.showToast?.(cfg.toast);
          if (ctx.loadAllData) await ctx.loadAllData();
          renderReceiptsPage(_ctx);
        } else {
          throw new Error(error.message);
        }
      }
    } catch (err) {
      console.error("[receipts " + action + "] error:", err);
      window.App?.showToast?.("❌ " + cfg.label + "ไม่สำเร็จ: " + (err.message || err));
    }
  }));
}

// ═══════════════════════════════════════════════════════════
//  PREVIEW — Receipt document
// ═══════════════════════════════════════════════════════════
function renderReceiptPreview(container) {
  const r = (_ctx.state.receipts || []).find(x => x.id === _viewingId);
  if (!r) { _viewMode = "list"; renderReceiptsPage(_ctx); return; }

  const si = _ctx.state.storeInfo || {};
  const subtotal   = Number(r.total_amount || 0);
  const discPct    = Number(r.discount_pct || 0);
  const discAmount = Number(r.discount_amount || 0);
  const afterDisc  = Number(r.after_discount || subtotal);
  const whtChecked = r.withholding_tax || false;
  const whtPct     = Number(r.wht_pct || 3);
  const whtAmount  = Number(r.wht_amount || 0);
  const grandTotal = Number(r.grand_total || 0);

  container.innerHTML = `
    <div class="panel">
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button id="rcPreviewBack" class="btn light">&larr; กลับ</button>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${(r.status === "pending" || r.status === "partial") ? `
            <button id="rcPreviewCollect" class="btn" style="background:#10b981;color:#fff;font-weight:700;font-size:13px;padding:8px 16px;border:none;border-radius:8px;cursor:pointer">✅ เก็บเงิน</button>
            <button id="rcPreviewCancel" class="btn" style="background:#ef4444;color:#fff;font-weight:700;font-size:13px;padding:8px 16px;border:none;border-radius:8px;cursor:pointer">❌ ยกเลิก</button>
          ` : `<span class="badge" style="background:${STATUS_COLOR[r.status]||'#9ca3af'}18;color:${STATUS_COLOR[r.status]||'#9ca3af'};font-size:13px;padding:6px 14px">${STATUS_LABELS[r.status]||r.status}</span>`}
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#f8fafc">
            <input type="checkbox" id="rcShowDate" checked style="width:15px;height:15px;cursor:pointer" />
            ลงวันที่
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#fffbeb" title="ใบเสร็จแก้วันที่ได้เสมอ">
            <span>📅 วันที่เอกสาร:</span>
            <input type="date" id="rcEditDate" value="${(r.created_at || new Date().toISOString()).slice(0,10)}" style="border:1px solid #d1d5db;border-radius:6px;padding:3px 6px;font-size:13px;cursor:pointer" />
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#eff6ff" title="เลือกวิธีชำระเงินของลูกค้า — ใบเสร็จจะติ๊ก ✓ ในช่องที่เลือก">
            <span>💳 วิธีชำระ:</span>
            <select id="rcEditPayMethod" style="border:1px solid #d1d5db;border-radius:6px;padding:3px 6px;font-size:13px;cursor:pointer;background:#fff">
              <option value=""        ${!r.payment_method ? 'selected' : ''}>— ไม่ระบุ —</option>
              <option value="cash"     ${_payIs(r.payment_method,'cash')     ? 'selected' : ''}>เงินสด</option>
              <option value="cheque"   ${_payIs(r.payment_method,'cheque')   ? 'selected' : ''}>เช็ค</option>
              <option value="transfer" ${_payIs(r.payment_method,'transfer') ? 'selected' : ''}>โอนเงิน</option>
              <option value="credit"   ${_payIs(r.payment_method,'credit')   ? 'selected' : ''}>บัตรเครดิต</option>
            </select>
          </label>
          <button id="rcShareBtn" class="btn" style="background:#06C755;color:#fff">📤 แชร์</button>
          <button id="rcPrintBtn" class="btn light">🖨️ พิมพ์</button>
          <button id="rcPdfBtn" class="btn primary">📄 PDF</button>
          <button id="rcDeleteBtn" class="btn" style="background:#ef4444;color:#fff">🗑️ ลบ</button>
        </div>
      </div>
    </div>

    <div id="rcDocPreview" class="doc-preview mt16">
      ${[1,2].map(pageNum => `
      <div class="doc-page">
        <div class="doc-accent re"></div>
        <div class="doc-page-badge re">${pageNum}</div>
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
              <div class="doc-title re">ใบเสร็จรับเงิน</div>
              <div class="doc-copy-label" style="display:inline-block;border:1.5px solid ${pageNum === 1 ? '#15803d' : '#94a3b8'};color:${pageNum === 1 ? '#15803d' : '#64748b'};background:${pageNum === 1 ? '#f0fdf4' : '#f8fafc'};padding:3px 10px;border-radius:14px;font-weight:700;margin-top:4px">${pageNum === 1 ? 'ต้นฉบับ · สำหรับลูกค้า' : 'สำเนา · สำหรับร้าน'}</div>
              <table class="doc-detail-table">
                <tr><td>เลขที่</td><td>${escHtml(r.receipt_no || '-')}</td></tr>
                <tr><td>วันที่</td><td id="rcDateCell">..................................</td></tr>
                <tr><td>ผู้ขาย</td><td>${escHtml(r.salesperson || '-')}</td></tr>
                <tr><td>อ้างอิง</td><td>${escHtml(r.ref_no || r.delivery_invoice_id || '-')}</td></tr>
              </table>
            </div>
          </div>

          <div class="doc-customer-section">
            <div class="doc-customer-label re">ลูกค้า</div>
            <div class="doc-customer-name">${escHtml(r.customer_name || '-')}</div>
            <div class="doc-customer-detail">
              ${r.customer_address ? escHtml(r.customer_address) : ''}
              ${r.customer_phone ? '<br>โทร. '+escHtml(r.customer_phone) : ''}
              ${r.customer_tax_id ? '<br>เลขผู้เสียภาษี '+escHtml(r.customer_tax_id) : ''}
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
              <div class="doc-total-row grand re" style="color:#1a1a1a"><span>จำนวนเงินรวมทั้งสิ้น</span><span>${num(grandTotal)} บาท</span></div>
            </div>
          </div>

          ${r.note ? '<div class="doc-note-section"><div class="doc-note-title re">หมายเหตุ</div><div>'+escHtml(r.note)+'</div></div>' : ''}

          <div class="doc-payment-check">
            <div class="doc-payment-check-row">
              <span>การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</span>
            </div>
            <div class="doc-payment-check-row" style="margin-top:6px">
              <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'cash')?'✓':''}</span> เงินสด</span>
              <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'cheque')?'✓':''}</span> เช็ค</span>
              <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'transfer')?'✓':''}</span> โอนเงิน</span>
              <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'credit')?'✓':''}</span> บัตรเครดิต</span>
            </div>
            <div class="doc-bank-line">
              <div class="doc-bank-field">ธนาคาร<span class="underline"></span></div>
              <div class="doc-bank-field">เลขที่<span class="underline"></span></div>
              <div class="doc-bank-field">วันที่<span class="underline"></span></div>
              <div class="doc-bank-field">จำนวนเงิน<span class="underline"></span></div>
            </div>
          </div>

          <div class="doc-signatures">
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">${escHtml(r.customer_name || '-')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้จ่ายเงิน</span><span>วันที่</span></div>
            </div>
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">${escHtml(si.name || 'บุญสุข อิเล็กทรอนิกส์')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้รับเงิน</span><span>วันที่</span></div>
            </div>
          </div>
        </div>
      </div>
      `).join('')}
    </div>
  `;

  // Back
  document.getElementById("rcPreviewBack")?.addEventListener("click", () => {
    _viewMode = "list"; _viewingId = null;
    renderReceiptsPage(_ctx);
  });

  // ★ เก็บเงิน (ในหน้า preview)
  document.getElementById("rcPreviewCollect")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ยืนยันเก็บเงิน "${r.receipt_no}" ยอด ${money(r.grand_total||0)} ?`))) return;
    try {
      await window._appXhrPatch?.("receipts", { status: "paid" }, "id", r.id);
      window.App?.showToast?.("เก็บเงินเรียบร้อย ✅");
      if (_ctx.loadAllData) await _ctx.loadAllData();
    } catch(e) { window.App?.showToast?.("❌ เก็บเงินไม่สำเร็จ", "error"); }
  });

  // ★ ยกเลิก (ในหน้า preview)
  document.getElementById("rcPreviewCancel")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ยกเลิกใบเสร็จ "${r.receipt_no}" ?`))) return;
    try {
      await window._appXhrPatch?.("receipts", { status: "cancelled" }, "id", r.id);
      window.App?.showToast?.("ยกเลิกใบเสร็จเรียบร้อย");
      if (_ctx.loadAllData) await _ctx.loadAllData();
    } catch(e) { window.App?.showToast?.("❌ ยกเลิกไม่สำเร็จ", "error"); }
  });

  // ── delete receipt → restore delivery invoice status ──
  document.getElementById("rcDeleteBtn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ลบใบเสร็จ ${r.receipt_no} ?\n\nใบส่งสินค้าที่อ้างอิงจะกลับสถานะเป็น "รอดำเนินการ" เพื่อให้แก้ไขหรือลบได้`))) return;
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    // ★ return=representation เพื่อให้ได้ rows ที่ลบจริงกลับมา — ตรวจได้ว่า RLS บล็อคไหม
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=representation" };
    try {
      // 1. ลบ receipt_items (OK ถ้า 0 rows เพราะอาจไม่มี items)
      await fetch(cfg.url + "/rest/v1/receipt_items?receipt_id=eq." + r.id, { method: "DELETE", headers });
      // 2. ลบ receipt — verify ว่ามี row ถูกลบจริง
      const delResp = await fetch(cfg.url + "/rest/v1/receipts?id=eq." + r.id, { method: "DELETE", headers });
      if (!delResp.ok) throw new Error("HTTP " + delResp.status);
      const deleted = await delResp.json().catch(() => []);
      if (!Array.isArray(deleted) || deleted.length === 0) {
        throw new Error("ไม่มี row ถูกลบ — RLS อาจบล็อค DELETE policy กรุณารัน supabase-rls-policies.sql");
      }
      // 3. คืนสถานะ delivery_invoice กลับเป็น invoiced (รอดำเนินการ)
      const invId = r.delivery_invoice_id || null;
      if (invId) {
        await fetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + invId,
          { method: "PATCH", headers, body: JSON.stringify({ status: "invoiced" }) });
      }
      _ctx.showToast("ลบใบเสร็จแล้ว ✓");
      _viewMode = "list"; _viewingId = null;
      await _ctx.loadAllData();
      renderReceiptsPage(_ctx);
    } catch(e) {
      console.error("[receipts delete] error:", e);
      _ctx.showToast("❌ ลบไม่สำเร็จ: " + (e.message || e));
    }
  });

  // ── date toggle ──
  const rcDateCell = document.getElementById("rcDateCell");
  const rcShowDate = document.getElementById("rcShowDate");
  if (rcShowDate && rcDateCell) {
    rcShowDate.addEventListener("change", () => {
      rcDateCell.textContent = rcShowDate.checked ? dateTH(r.created_at) : "..................................";
    });
  }

  // ★ แก้วันที่เอกสาร — PATCH created_at
  document.getElementById("rcEditDate")?.addEventListener("change", async (ev) => {
    const newDate = ev.target.value; // YYYY-MM-DD
    if (!newDate) return;
    const isoDate = newDate + "T00:00:00.000Z";
    try {
      const res = await window._appXhrPatch?.("receipts", { created_at: isoDate }, "id", r.id);
      if (res && res.ok === false) throw new Error(res.error?.message || "patch failed");
      r.created_at = isoDate;
      document.querySelectorAll("#rcDocPreview [id^='rcDateCell']").forEach(el => {
        if (rcShowDate?.checked) el.textContent = dateTH(isoDate);
      });
      _ctx.showToast("อัปเดตวันที่เรียบร้อย ✓");
    } catch (e) {
      console.error("[receipts edit date] error:", e);
      _ctx.showToast("❌ แก้วันที่ไม่สำเร็จ: " + (e.message || e));
      ev.target.value = (r.created_at || "").slice(0,10);
    }
  });

  // ★ เลือกวิธีชำระเงิน — PATCH payment_method แล้ว re-render preview ให้ checkboxes อัปเดต
  document.getElementById("rcEditPayMethod")?.addEventListener("change", async (ev) => {
    const labels = { cash: "เงินสด", cheque: "เช็ค", transfer: "โอนเงิน", credit: "บัตรเครดิต" };
    const newMethod = labels[ev.target.value] || ""; // เก็บเป็นภาษาไทยใน DB
    const prevMethod = r.payment_method;
    try {
      const res = await window._appXhrPatch?.("receipts", { payment_method: newMethod }, "id", r.id);
      if (res && res.ok === false) throw new Error(res.error?.message || "patch failed");
      r.payment_method = newMethod;
      _ctx.showToast("อัปเดตวิธีชำระเรียบร้อย ✓");
      // Re-render preview เพื่อให้ checkboxes แสดง ✓ ตรงตำแหน่งที่เลือก
      renderReceiptsPage(_ctx);
    } catch (e) {
      console.error("[receipts edit pay method] error:", e);
      _ctx.showToast("❌ อัปเดตไม่สำเร็จ: " + (e.message || e));
      // rollback dropdown
      r.payment_method = prevMethod;
      for (const opt of ev.target.options) {
        opt.selected = (opt.value === "cash" && _payIs(prevMethod,'cash')) ||
                       (opt.value === "cheque" && _payIs(prevMethod,'cheque')) ||
                       (opt.value === "transfer" && _payIs(prevMethod,'transfer')) ||
                       (opt.value === "credit" && _payIs(prevMethod,'credit')) ||
                       (opt.value === "" && !prevMethod);
      }
    }
  });

  // Share
  document.getElementById("rcShareBtn")?.addEventListener("click", () => {
    window._appShareDoc("rcDocPreview", r.receipt_no || "receipt");
  });

  // Print
  document.getElementById("rcPrintBtn")?.addEventListener("click", () => {
    const content = document.getElementById("rcDocPreview")?.innerHTML; if (!content) return;
    const w = window.open("","_blank");
    w.document.write('<html><head><title>ใบเสร็จรับเงิน</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}body{font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;margin:0;padding:0;color:#1a1a1a;font-size:14px}.doc-preview{padding:0}.doc-page{width:210mm;min-height:297mm;padding:20mm 18mm 15mm;box-sizing:border-box;page-break-after:always;position:relative;display:flex;flex-direction:column}.doc-page:last-child{page-break-after:avoid}.doc-page-inner{flex:1;display:flex;flex-direction:column}.doc-accent{height:5px;width:100%;position:absolute;top:0;left:0}.doc-accent.re{background:linear-gradient(90deg,#15803d,#16a34a,#4ade80)}.doc-page-badge{position:absolute;top:0;right:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;background:#16a34a}.doc-copy-label{font-size:13px;font-weight:600;color:#64748b;text-align:center}.doc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.doc-header-left{display:flex;gap:12px;max-width:55%}.doc-logo{width:64px;height:64px;border-radius:8px;object-fit:contain}.doc-company-name{font-size:16px;font-weight:900;margin-bottom:4px}.doc-company-detail{font-size:12px;color:#555;line-height:1.7}.doc-title{font-size:26px;font-weight:900}.doc-title.re{color:#15803d}.doc-detail-table{margin-left:auto;border-collapse:collapse;font-size:13px;margin-top:8px}.doc-detail-table td{padding:3px 10px;border:1px solid #d1d5db}.doc-detail-table td:first-child{font-weight:700;color:#555;background:#f9fafb;white-space:nowrap}.doc-customer-section{margin:12px 0 16px}.doc-customer-label{font-weight:800;font-size:12px;text-decoration:underline;margin-bottom:4px;color:#15803d}.doc-customer-name{font-weight:700;font-size:14px}.doc-customer-detail{font-size:13px;color:#333;line-height:1.6}.doc-table{width:100%;border-collapse:collapse;margin:12px 0 8px}.doc-table th{padding:8px 10px;font-size:12px;font-weight:700;text-align:center;border:1px solid #d1d5db;background:#f3f4f6;color:#333}.doc-table td{padding:8px 10px;font-size:13px;border:1px solid #d1d5db;vertical-align:top}.doc-totals{margin-left:auto;width:280px;margin-top:4px}.doc-total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#333}.doc-total-row.grand{font-size:14px;font-weight:900;padding-top:8px;margin-top:4px}.doc-total-row.grand.re{color:#1a1a1a;border-top:2px solid #15803d}.doc-note-section{margin-top:16px;font-size:12.5px;line-height:1.7}.doc-note-title{font-weight:800;text-decoration:underline;margin-bottom:2px;color:#15803d}.doc-payment-check{margin-top:auto;padding-top:20px;font-size:12.5px}.doc-payment-check-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.doc-checkbox{display:inline-flex;align-items:center;gap:4px;margin-right:12px}.doc-checkbox-box{width:14px;height:14px;border:1.5px solid #555;display:inline-block;border-radius:2px}.doc-bank-line{display:flex;gap:16px;margin-top:6px;font-size:12px}.doc-bank-field{display:flex;gap:4px;align-items:baseline}.doc-bank-field .underline{border-bottom:1px solid #333;min-width:100px;display:inline-block;height:16px}.doc-signatures{display:flex;justify-content:space-between;margin-top:auto;padding-top:24px;font-size:13px}.doc-sig-col{text-align:center;width:42%}.doc-sig-behalf{font-weight:600;margin-bottom:28px;font-size:12.5px}.doc-sig-line{width:200px;border-bottom:1px solid #333;margin:0 auto 6px}.doc-sig-label-row{display:flex;justify-content:center;gap:40px;font-size:12px}</style></head><body>'+content+'</body></html>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  });

  // PDF
  document.getElementById("rcPdfBtn")?.addEventListener("click", async () => {
    const pages = document.querySelectorAll("#rcDocPreview .doc-page");
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
    pdf.save((r.receipt_no||'receipt')+'.pdf');
    _ctx.showToast("ดาวน์โหลด PDF แล้ว");
  });
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
