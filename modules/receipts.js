// ═══════════════════════════════════════════════════════════
//  RECEIPTS MODULE — ใบเสร็จรับเงิน
//  ★ รายการ, preview, พิมพ์, PDF, แชร์
// ═══════════════════════════════════════════════════════════
import { renderEmpty, renderSkeleton } from "./ui_states.js";
// Phase 57: audit log + Phase 70 (D3): Excel export
import { logActivity, exportToExcel, todaySuffix } from "./utils.js";
import { renderDocumentTemplateHeader, renderDocumentTemplateNote, renderDocumentTemplateFooter } from "./doc-utils.js";
// Phase 88.1b: auto-post JV หลังรับชำระลูกหนี้
import { postJournalForReceipt, voidJvForSource } from "./accounting/auto_post.js";
// Phase 89.42: single-flight guard for multi-payment save (prevent double-click race)
import { createInflightGuard } from "./_inflight_guard.js";

// Phase 89.42 — Site 1 fix: rapid double-click on "บันทึก" in multi-pay drawer
// could fire 2 PATCH /receipts with overlapping payloads (lost-update race).
// Guard collapses concurrent invocations to a single PATCH.
const _multiPayGuard = createInflightGuard();

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

// Phase 88.17: รออนุมัติ (pending) คือ default — JV ยังไม่เกิด
const STATUS_LABELS = {
  paid:      "✅ ชำระแล้ว",
  partial:   "⏳ ชำระบางส่วน",
  pending:   "🟡 รออนุมัติ",
  cancelled: "⚫ ยกเลิก",
  refunded:  "↩️ คืนเงิน"
};
const STATUS_COLOR = {
  paid:      "#10b981",
  partial:   "#f59e0b",
  pending:   "#a855f7",  // ม่วง — เน้นว่ารออนุมัติ (เหมือน workflow ของช่าง)
  cancelled: "#64748b",
  refunded:  "#9ca3af"
};

let _ctx = null;
let _lineItems = [];
let _viewMode = "list";  // list | preview
let _viewingId = null;
// Phase 88.17: default filter = pending (เน้นใบที่รออนุมัติให้เห็นชัด)
let _tabFilter = "pending";  // all | pending | paid | cancelled
let _selectedIds = new Set(); // bulk selection
// Phase 59 (B2): advanced filters
let _rcDateRange = "all"; // all | today | 7d | 30d | month
let _rcSearch = "";

export function _receiptMatchesSearchDate(r, { cutoff = "", q = "" } = {}) {
  if (cutoff && String(r?.created_at || "").slice(0, 10) < cutoff) return false;
  const query = String(q || "").trim().toLowerCase();
  if (query && !(
    String(r?.receipt_no || "").toLowerCase().includes(query) ||
    String(r?.customer_name || "").toLowerCase().includes(query) ||
    String(r?.delivery_invoice_id || "").toLowerCase().includes(query)
  )) return false;
  return true;
}

export function _receiptStatusCounts(receipts = []) {
  return {
    all: receipts.length,
    pending: receipts.filter(r => r.status === "pending" || r.status === "partial").length,
    paid: receipts.filter(r => r.status === "paid").length,
    cancelled: receipts.filter(r => r.status === "cancelled").length
  };
}

export function _receiptFinancialTotal(receipts = []) {
  return receipts
    .filter(r => String(r?.status || "").toLowerCase() !== "cancelled")
    .reduce((s, r) => s + Number(r?.grand_total || 0), 0);
}

// ═══════════════════════════════════════════════════════════
//  LIST PAGE
// ═══════════════════════════════════════════════════════════
// Phase 442 (B2b): warn (not block) before collecting a TRANSFER receipt with no bank set.
// Returns true to proceed. The message is explicit that proceeding leaves the document
// bank blank and the Phase C auto-post JV will use the default account until a bank is set.
// Single-bank only — payments[] per-row banks are not supported yet (reviewer #5).
async function _confirmTransferBankSet(r) {
  if (!_payIs(r.payment_method, "transfer") || r.bank_coa_code) return true;
  return await window.App?.confirm?.(
    "⚠️ ใบเสร็จนี้รับชำระแบบโอน แต่ยังไม่ได้ระบุบัญชีรับเงิน\n\n" +
    "ดำเนินการเก็บเงินต่อ? — บัญชีในเอกสารจะว่าง และการลงบัญชีอัตโนมัติ (เฟสถัดไป) " +
    "จะใช้บัญชีเริ่มต้นจนกว่าจะระบุบัญชี\n(แนะนำ: ยกเลิก → แก้ไข → เลือกบัญชีรับโอน)"
  );
}

export function renderReceiptsPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-receipts");
  if (!container) return;

  if (_viewMode === "preview" && _viewingId) { renderReceiptPreview(container); return; }

  _viewMode = "list";

  // Phase 45.10 (B5-4): clear stale line items + selection ตอนเข้า list view
  _lineItems = [];
  _selectedIds.clear();
  const receipts = ctx.state.receipts || [];

  // Phase 59 (B2): apply advanced filters
  const today = new Date().toISOString().slice(0, 10);
  let cutoff = "";
  if (_rcDateRange === "today") cutoff = today;
  else if (_rcDateRange === "7d") { const d = new Date(); d.setDate(d.getDate() - 7); cutoff = d.toISOString().slice(0, 10); }
  else if (_rcDateRange === "30d") { const d = new Date(); d.setDate(d.getDate() - 30); cutoff = d.toISOString().slice(0, 10); }
  else if (_rcDateRange === "month") { cutoff = today.slice(0, 7) + "-01"; }
  const q = (_rcSearch || "").trim().toLowerCase();
  const scopedReceipts = receipts.filter(r => _receiptMatchesSearchDate(r, { cutoff, q }));
  const counts = _receiptStatusCounts(scopedReceipts);
  const countAll = counts.all;
  const countPending = counts.pending;
  const countPaid = counts.paid;
  const countCancelled = counts.cancelled;

  // ★ Filter ตาม tab
  const filtered = scopedReceipts.filter(r => {
    if (_tabFilter !== "all") {
      if (_tabFilter === "pending" && !(r.status === "pending" || r.status === "partial")) return false;
      if (_tabFilter !== "pending" && r.status !== _tabFilter) return false;
    }
    return true;
  });

  // ล้าง selected ids ที่ถูก filter ออก
  _selectedIds = new Set([..._selectedIds].filter(id => filtered.some(r => r.id === id)));

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบเสร็จรับเงิน</h3>
        <span class="sku">สร้างจากใบส่งสินค้า</span>
        <button id="rcExportBtn" class="btn light" style="font-size:13px;margin-left:auto" title="ส่งออก Excel ตาม filter ที่กำลังเลือก">📥 Excel</button>
      </div>

      ${countAll === 0 ? renderEmpty({
        icon: "🧾",
        title: "ยังไม่มีใบเสร็จ",
        message: "ใบเสร็จสร้างจากใบส่งสินค้าที่บันทึกการชำระแล้ว — หรือออกตรงจาก POS เมื่อขายเงินสด",
        actionLabel: "ไปที่ POS",
        actionId: "rcEmptyGoToPosBtn",
        actionStyle: "ghost"
      }) : `
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
          <div class="stat-value" style="color:#0284c7">${money(_receiptFinancialTotal(scopedReceipts))}</div>
        </div>
      </div>

      <!-- Phase 59 B2: Advanced filter row -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;padding:10px 12px;background:#f8fafc;border-radius:10px">
        <input type="search" id="rcSearchInput" placeholder="🔍 ค้นหา เลขที่ / ลูกค้า..." value="${escHtml(_rcSearch)}" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
        <span style="font-size:12px;color:#64748b;font-weight:600">📅</span>
        ${[["all","ทั้งหมด"],["today","วันนี้"],["7d","7 วัน"],["30d","30 วัน"],["month","เดือนนี้"]].map(([k,l]) =>
          `<button class="rc-date-btn" data-d="${k}" style="padding:5px 10px;border-radius:14px;border:1px solid ${_rcDateRange===k?'#0284c7':'#cbd5e1'};background:${_rcDateRange===k?'#0284c7':'#fff'};color:${_rcDateRange===k?'#fff':'#475569'};cursor:pointer;font-size:11px;font-weight:600">${l}</button>`).join("")}
        <span style="font-size:11px;color:#64748b">→ พบ ${filtered.length} รายการ</span>
      </div>

      <!-- ★ Tab row -->
      <div style="font-size:11px;color:#94a3b8;margin-top:12px;font-weight:600">กรองตามสถานะ:</div>
      <div class="rc-tabs" style="display:flex;gap:6px;margin-top:4px;border-bottom:2px solid #e2e8f0;overflow-x:auto">
        ${[
          ['pending', '🟡 รออนุมัติ', countPending, '#a855f7'],
          ['paid', '✅ ชำระแล้ว', countPaid, '#10b981'],
          ['cancelled', '❌ ที่ยกเลิก', countCancelled, '#64748b'],
          ['all', '📋 แสดงทั้งหมด', countAll, '#475569']
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

      <div class="table-wrap" style="margin-top:12px">
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
            // Phase 88.17: default = pending (ไม่ใช่ paid อัตโนมัติ)
            const status = r.status || "pending";
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
                  <a href="#" class="rc-view-btn doc-no" data-rc-id="${r.id}" style="color:#1e293b;text-decoration:none;font-weight:700;cursor:pointer" title="คลิกดูเอกสาร">${escHtml(r.receipt_no || "-")}</a>
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
      `}
    </div>
  `;

  // ── Empty-state CTA: ไปหน้า POS ──
  document.getElementById("rcEmptyGoToPosBtn")?.addEventListener("click", () => {
    location.hash = "pos";
  });

  // ── Tab click ──
  container.querySelectorAll(".rc-tab-btn").forEach(btn => btn.addEventListener("click", () => {
    _tabFilter = btn.dataset.rcTab;
    renderReceiptsPage(_ctx);
  }));
  // Phase 70 (D3): Export filtered receipts to Excel
  container.querySelector("#rcExportBtn")?.addEventListener("click", () => {
    const rows = filtered.map(r => ({
      "เลขที่": r.receipt_no || ("#" + r.id),
      "วันที่": (r.created_at || "").slice(0, 10),
      "ลูกค้า": r.customer_name || "",
      "ใบส่งสินค้าอ้างอิง": r.delivery_invoice_id || "",
      "วิธีชำระหลัก": r.payment_method || "",
      "ช่องทางชำระ (ละเอียด)": Array.isArray(r.payments) && r.payments.length
        ? r.payments.map(p => `${p.method}:${p.amount}${p.ref?`(${p.ref})`:""}`).join(" + ")
        : "",
      "สถานะ": r.status || "",
      "ยอดก่อนหัก": Number(r.total_amount || 0),
      "หัก ณ ที่จ่าย %": Number(r.wht_pct || 0),
      "รวมทั้งสิ้น": Number(r.grand_total || 0),
      "หมายเหตุ": r.note || ""
    }));
    const ok = exportToExcel(`ใบเสร็จรับเงิน_${todaySuffix()}.xlsx`, rows, "Receipts");
    if (ok) window.App?.showToast?.(`ดาวน์โหลด ${rows.length} รายการแล้ว`);
  });
  // Phase 59 B2: date range pills
  container.querySelectorAll(".rc-date-btn").forEach(btn => btn.addEventListener("click", () => {
    _rcDateRange = btn.dataset.d;
    renderReceiptsPage(_ctx);
  }));
  // Phase 59 B2: search box (debounce by re-render after blur or Enter)
  const searchInp = container.querySelector("#rcSearchInput");
  if (searchInp) {
    let t; searchInp.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        _rcSearch = searchInp.value;
        const cur = document.activeElement === searchInp;
        renderReceiptsPage(_ctx);
        if (cur) {
          const ni = document.querySelector("#rcSearchInput");
          if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
        }
      }, 250);
    });
  }

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
  document.getElementById("rcBulkCancel")?.addEventListener("click", async (e) => {
    // Phase 89.4: double-click guard
    const btn = e.currentTarget;
    if (btn.disabled) return;
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`ยกเลิกใบเสร็จ ${ids.length} รายการ?\n(เปลี่ยนสถานะเป็น "ยกเลิก" — ใบเสร็จยังอยู่ใน tab "ยกเลิก")`))) return;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    window.App?.showToast?.(`กำลังยกเลิก ${ids.length} รายการ...`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await window._appXhrPatch?.("receipts", { status: "cancelled" }, "id", id);
        if (res?.ok) {
          // Phase 89.1: void JV ของใบเสร็จที่ยกเลิก (กัน double-revenue + ลูกหนี้ติดลบ)
          // Phase 89.13: voidJvForSource ไม่ throw — return count; .catch ตัวเดิมเป็น dead code
          await voidJvForSource("receipts", id);
          // Phase 89.6: restore delivery_invoice status → "pending" (รอดำเนินการ) เพื่อให้ user ออกใบเสร็จใหม่ได้
          // Phase 89.13: xhrPatch returns resolved {ok,error} เสมอ — เดิม .catch ไม่ fire → silent fail
          const rec = (ctx.state.receipts || []).find(x => x.id === id);
          if (rec?.delivery_invoice_id) {
            const invRes = await window._appXhrPatch?.("delivery_invoices", { status: "pending" }, "id", rec.delivery_invoice_id);
            if (invRes && !invRes.ok) {
              console.warn("[rc bulk cancel] restore invoice failed:", invRes.error?.message);
              fail++; continue;
            }
          }
          ok++;
        } else fail++;
      } catch(e) { fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ยกเลิกสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail}` : ''}`);
    // Phase 89.15b: await reload BEFORE render — เดิม fire-and-forget = UI stale หลัง bulk cancel
    try { if (ctx.loadAllData) await ctx.loadAllData(); } catch(e) { console.warn("[rc] reload", e); }
    renderReceiptsPage(_ctx);
  });

  // ── Bulk delete (hard — remove from DB + restore delivery_invoice status) ──
  document.getElementById("rcBulkDelete")?.addEventListener("click", async (e) => {
    // Phase 89.4: double-click guard
    const btn = e.currentTarget;
    if (btn.disabled) return;
    const ids = [..._selectedIds];
    if (!ids.length) return;
    if (!(await window.App?.confirm?.(`⚠️ ลบใบเสร็จ ${ids.length} รายการออกจากระบบถาวร?\nใบส่งสินค้าที่อ้างอิงจะกลับสถานะเป็น "รอดำเนินการ"\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`))) return;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    window.App?.showToast?.(`กำลังลบ ${ids.length} รายการ...`);

    const cfg = window.SUPABASE_CONFIG;
    // Phase 89.4: _appAuthFetch → auto 401 retry
    const authFetch = window._appAuthFetch || fetch;
    const headers = { "Content-Type": "application/json", "Prefer": "return=representation" };

    let ok = 0, fail = 0, restoreWarn = 0;
    for (const id of ids) {
      try {
        const r = (ctx.state.receipts || []).find(x => x.id === id);
        await voidJvForSource("receipts", id);
        // 1. ลบ receipt_items
        await authFetch(cfg.url + "/rest/v1/receipt_items?receipt_id=eq." + id, { method: "DELETE", headers });
        // 2. ลบ receipt
        const delResp = await authFetch(cfg.url + "/rest/v1/receipts?id=eq." + id, { method: "DELETE", headers });
        const deleted = await delResp.json().catch(() => []);
        if (!delResp.ok || !Array.isArray(deleted) || deleted.length === 0) { fail++; continue; }
        // 3. restore delivery_invoice status
        const invId = r?.delivery_invoice_id;
        if (invId) {
          const restoreResp = await authFetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + invId,
            { method: "PATCH", headers, body: JSON.stringify({ status: "pending" }) });
          if (!restoreResp.ok) {
            restoreWarn++;
            console.warn("[receipts bulk delete] restore invoice failed:", invId, restoreResp.status);
          }
        }
        ok++;
      } catch(e) { console.error("[receipts bulk delete]", e); fail++; }
    }
    _selectedIds.clear();
    window.App?.showToast?.(`ลบสำเร็จ ${ok}${fail ? `, ล้มเหลว ${fail} (RLS บล็อค?)` : ''}`);
    if (restoreWarn) window.App?.showToast?.(`ลบแล้ว แต่คืนสถานะใบส่งสินค้าไม่สำเร็จ ${restoreWarn} รายการ — กรุณาตรวจหน้าใบส่งสินค้า`, "warn");
    // Phase 89.15b: await reload BEFORE render — กัน UI stale หลัง bulk delete
    try { if (ctx.loadAllData) await ctx.loadAllData(); } catch(e) { console.warn("[rc] reload", e); }
    renderReceiptsPage(_ctx);
  });

  // ── Bulk clear selection ──
  document.getElementById("rcBulkClear")?.addEventListener("click", () => {
    _selectedIds.clear();
    renderReceiptsPage(_ctx);
  });

  // ── View document (📄 icon) ──
  container.querySelectorAll(".rc-view-btn").forEach(btn => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const r = (ctx.state.receipts || []).find(x => x.id === Number(btn.dataset.rcId));
    if (r) {
      _viewingId = r.id;
      _viewMode = "preview";
      const pageEl = document.getElementById("page-receipts");
      if (pageEl) pageEl.innerHTML = renderSkeleton({ type: "list", count: 4 });
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
    // Phase 442: warn before posting if transfer w/o bank — fires BEFORE postJournalForReceipt (reviewer #4/#5)
    if (action === "paid" && !(await _confirmTransferBankSet(r))) return;

    try {
      const res = await window._appXhrPatch?.("receipts", { status: cfg.status }, "id", rcId);
      if (res?.ok) {
        window.App?.showToast?.(cfg.toast);
        // ★ Phase 88.1b — auto-post JV ตอนเก็บเงิน
        if (action === "paid") {
          try {
            const postRes = await postJournalForReceipt({ ...r, status: "paid", paid_at: new Date().toISOString() }, { detailed: true });
            if (postRes?.status === "failed") {
              window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
            }
          } catch (e) {
            console.warn("[rc] auto-post JV failed:", e?.message);
            window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
          }
        }
        // Phase 89.1: void JV ของใบเสร็จที่ยกเลิก (กัน double-revenue ใน P&L + ลูกหนี้ติดลบ)
        // Phase 89.6: restore delivery_invoice status → "pending" (เปิดใบเสร็จใหม่ได้)
        // Phase 89.13: voidJv ไม่ throw, xhrPatch return resolved — เดิม .catch ทั้งคู่เป็น dead code
        if (action === "cancelled") {
          await voidJvForSource("receipts", rcId);
          if (r.delivery_invoice_id) {
            const invRes = await window._appXhrPatch?.("delivery_invoices", { status: "pending" }, "id", r.delivery_invoice_id);
            if (invRes && !invRes.ok) {
              window.App?.showToast?.("⚠️ ยกเลิกใบเสร็จแล้ว แต่คืนสถานะใบส่งของไม่สำเร็จ: " + (invRes.error?.message || ""));
              console.warn("[rc] restore invoice failed:", invRes.error?.message);
            }
          }
        }
        // Phase 45.11: non-blocking reload
    // Phase 89.15b: await reload BEFORE render — เดิม fire-and-forget → render ใช้ state เก่า → status ค้างใน UI
    try { if (ctx.loadAllData) await ctx.loadAllData(); } catch(e) { console.warn("[rc] reload", e); }
        renderReceiptsPage(_ctx);
      } else {
        // Supabase client fallback
        const { error } = await ctx.state.supabase.from("receipts").update({ status: cfg.status }).eq("id", rcId);
        if (!error) {
          window.App?.showToast?.(cfg.toast);
          // ★ Phase 88.1b — auto-post JV (fallback path)
          if (action === "paid") {
            try {
              const postRes = await postJournalForReceipt({ ...r, status: "paid", paid_at: new Date().toISOString() }, { detailed: true });
              if (postRes?.status === "failed") {
                window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
              }
            } catch (e) {
              console.warn("[rc] auto-post JV failed:", e?.message);
              window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
            }
          }
          // Phase 89.1: void JV (fallback path)
          // Phase 89.6: restore invoice status (fallback path)
          // Phase 89.13: same dead-.catch fix as primary path above
          if (action === "cancelled") {
            await voidJvForSource("receipts", rcId);
            if (r.delivery_invoice_id) {
              const invRes = await window._appXhrPatch?.("delivery_invoices", { status: "pending" }, "id", r.delivery_invoice_id);
              if (invRes && !invRes.ok) {
                window.App?.showToast?.("⚠️ ยกเลิกใบเสร็จแล้ว แต่คืนสถานะใบส่งของไม่สำเร็จ: " + (invRes.error?.message || ""));
                console.warn("[rc fallback] restore invoice failed:", invRes.error?.message);
              }
            }
          }
          // Phase 89.15b: await reload BEFORE render — fallback path เดียวกับ primary
          try { if (ctx.loadAllData) await ctx.loadAllData(); } catch(e) { console.warn("[rc] reload", e); }
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
  const _afterDisc = Number(r.after_discount || subtotal);
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
          ${r.status !== 'cancelled' ? '<button id="rcEditBtn" class="btn light" style="border:1px solid #cbd5e1">✏️ แก้ไข</button>' : ''}
          <button id="rcMultiPayBtn" class="btn light" style="border:1px solid #cbd5e1" title="แตกย่อยหลายวิธีชำระ (เงินสด+โอน+เครดิต ฯลฯ)">📊 Multi-pay</button>
          <button id="rcShareBtn" class="btn" style="background:#06C755;color:#fff">📤 แชร์</button>
          <button id="rcPrintBtn" class="btn light">🖨️ พิมพ์</button>
          <button id="rcPdfBtn" class="btn primary">📄 PDF</button>
          <button id="rcDeleteBtn" class="btn" style="background:#ef4444;color:#fff">🗑️ ลบ</button>
        </div>
      </div>

      <!-- Phase 69 (C2): Multi-payment breakdown panel — toggle via button -->
      <div id="rcMultiPayPanel" class="hidden" style="margin-top:10px;padding:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:13px;font-weight:700;color:#0c4a6e">📊 ช่องทางชำระเงิน (รับหลายวิธีในบิลเดียว)</div>
          <div style="font-size:12px;color:#475569">ยอดรวม: <b style="color:#0284c7">${money(r.grand_total||0)}</b></div>
        </div>
        <div id="rcMultiPayRows" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <button id="rcMultiPayAddRow" type="button" class="btn light" style="font-size:12px;padding:6px 12px">+ เพิ่มช่องทาง</button>
          <div style="font-size:12px;color:#475569">รวมที่กรอก: <b id="rcMultiPaySum" style="color:#0284c7">฿0.00</b> · เหลือ: <b id="rcMultiPayRemain" style="color:#dc2626">${money(r.grand_total||0)}</b></div>
          <button id="rcMultiPaySave" type="button" class="btn primary" style="font-size:12px;padding:6px 16px;background:#10b981;border:none">💾 บันทึก</button>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:6px">💡 ผลรวมต้องเท่ากับยอดบิล (${money(r.grand_total||0)}) — ถ้าเหลือ 0 ค่อยกดบันทึกได้</div>
      </div>
    </div>

    <div id="rcDocPreview" class="doc-preview mt16">
      ${[1,2].map(pageNum => `
      <div class="doc-page doc-watermark-wrap">
        ${r.status === "cancelled" ? '<div class="doc-watermark cancelled">ยกเลิก</div>' : '<div class="doc-watermark paid">ชำระแล้ว</div>'}
        <div class="doc-accent re"></div>
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

          ${renderDocumentTemplateHeader(si)}

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

          ${renderDocumentTemplateNote(si, { accent: "re", documentNote: r.note })}

          <div class="doc-payment-check">
            <div class="doc-payment-check-row">
              <span>การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</span>
            </div>
            ${(Array.isArray(r.payments) && r.payments.length > 0) ? `
              <!-- Phase 69 (C2): multi-payment breakdown -->
              <div style="margin-top:6px;padding:8px 10px;background:#f9fafb;border-radius:6px;font-size:12.5px">
                <div style="font-weight:700;color:#374151;margin-bottom:4px">รับชำระ ${r.payments.length} ช่องทาง:</div>
                ${r.payments.map(p => {
                  const meta = PAY_METHOD_OPTIONS.find(o => o.value === p.method) || { label: p.method };
                  return `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #e5e7eb">
                    <span>${escHtml(meta.label)}${p.ref ? ` <span style="color:#6b7280">(${escHtml(p.ref)})</span>` : ""}</span>
                    <span style="font-weight:700">${money(p.amount||0)}</span>
                  </div>`;
                }).join("")}
                <div style="display:flex;justify-content:space-between;padding:4px 0 0;font-weight:900;color:#0284c7;border-top:1px solid #cbd5e1;margin-top:4px">
                  <span>รวม</span><span>${money(r.payments.reduce((s,p)=>s+Number(p.amount||0),0))}</span>
                </div>
              </div>
            ` : `
              <div class="doc-payment-check-row" style="margin-top:6px">
                <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'cash')?'✓':''}</span> เงินสด</span>
                <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'cheque')?'✓':''}</span> เช็ค</span>
                <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'transfer')?'✓':''}</span> โอนเงิน</span>
                <span class="doc-checkbox"><span class="doc-checkbox-box" style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${_payIs(r.payment_method,'credit')?'✓':''}</span> บัตรเครดิต</span>
              </div>
              <div class="doc-bank-line">
                <div class="doc-bank-field">ธนาคาร<span class="underline">${(_payIs(r.payment_method,'transfer') && r.bank_label) ? escHtml(r.bank_label) : ''}</span></div>
                <div class="doc-bank-field">เลขที่<span class="underline"></span></div>
                <div class="doc-bank-field">วันที่<span class="underline"></span></div>
                <div class="doc-bank-field">จำนวนเงิน<span class="underline"></span></div>
              </div>
            `}
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
          ${renderDocumentTemplateFooter(si)}
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

  // Phase 45.12: edit basic fields (customer info, salesperson, ref, project, note)
  document.getElementById("rcEditBtn")?.addEventListener("click", () => _openReceiptEditDrawer(r));

  // Phase 69 (C2): Multi-payment panel toggle + render
  _wireMultiPayPanel(r);

  // ★ เก็บเงิน (ในหน้า preview)
  // Phase 89.2: double-click guard — กัน user double-tap = post JV ซ้ำ (DB unique index จับได้ แต่ patch อาจซ้ำ)
  document.getElementById("rcPreviewCollect")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    if (!(await window.App?.confirm?.(`ยืนยันเก็บเงิน "${r.receipt_no}" ยอด ${money(r.grand_total||0)} ?`))) return;
    // Phase 442: warn before posting if transfer w/o bank — fires BEFORE postJournalForReceipt (reviewer #4/#5)
    if (!(await _confirmTransferBankSet(r))) return;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.textContent = "⏳ กำลังเก็บเงิน...";
    try {
      const payRes = await window._appXhrPatch?.("receipts", { status: "paid" }, "id", r.id);
      if (!payRes?.ok) throw new Error(payRes?.error?.message || "PATCH receipts failed");
      window.App?.showToast?.("เก็บเงินเรียบร้อย ✅");
      // ★ Phase 88.1b — auto-post JV ตอนเก็บเงิน
      try {
        const postRes = await postJournalForReceipt({ ...r, status: "paid", paid_at: new Date().toISOString() }, { detailed: true });
        if (postRes?.status === "failed") {
          window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
        }
      } catch (err) {
        console.warn("[rc-preview] auto-post JV failed:", err?.message);
        window.App?.showToast?.("เก็บเงินแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจสมุดรายวัน/Backfill", "warn");
      }
      if (_ctx.loadAllData) await _ctx.loadAllData();
    } catch(err) {
      window.App?.showToast?.("❌ เก็บเงินไม่สำเร็จ", "error");
      // restore button only on error — สำเร็จแล้วจะ re-render อยู่ดี
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.textContent = "✅ เก็บเงิน";
    }
  });

  // ★ ยกเลิก (ในหน้า preview)
  // Phase 89.2: double-click guard
  document.getElementById("rcPreviewCancel")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    if (!(await window.App?.confirm?.(`ยกเลิกใบเสร็จ "${r.receipt_no}" ?`))) return;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.textContent = "⏳ กำลังยกเลิก...";
    try {
      const cancelRes = await window._appXhrPatch?.("receipts", { status: "cancelled" }, "id", r.id);
      if (!cancelRes?.ok) throw new Error(cancelRes?.error?.message || "PATCH receipts failed");
      // Phase 89.1: void JV ของใบเสร็จที่ยกเลิก (กัน double-revenue ใน P&L)
      // Phase 89.16: voidJv handles silent-fail + toast เอง — ไม่ต้องใส่ .catch
      await voidJvForSource("receipts", r.id);
      let restoreFailed = false;
      // Phase 89.6: restore delivery_invoice status → "pending" (เปิดใบเสร็จใหม่ได้)
      if (r.delivery_invoice_id) {
        const invRes = await window._appXhrPatch?.("delivery_invoices", { status: "pending" }, "id", r.delivery_invoice_id);
        if (!invRes?.ok) {
          restoreFailed = true;
          console.warn("[rc preview cancel] restore invoice", invRes?.error?.message || "unknown");
        }
      }
      window.App?.showToast?.("ยกเลิกใบเสร็จเรียบร้อย — ใบส่งสินค้ากลับเป็น 'รอดำเนินการ'");
      if (restoreFailed) window.App?.showToast?.("ยกเลิกใบเสร็จแล้ว แต่คืนสถานะใบส่งสินค้าไม่สำเร็จ — กรุณาตรวจหน้าใบส่งสินค้า", "warn");
      if (_ctx.loadAllData) await _ctx.loadAllData();
    } catch(err) {
      window.App?.showToast?.("❌ ยกเลิกไม่สำเร็จ", "error");
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.textContent = "❌ ยกเลิก";
    }
  });

  // ── delete receipt → restore delivery invoice status ──
  document.getElementById("rcDeleteBtn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ลบใบเสร็จ ${r.receipt_no} ?\n\nใบส่งสินค้าที่อ้างอิงจะกลับสถานะเป็น "รอดำเนินการ" เพื่อให้แก้ไขหรือลบได้`))) return;
    const cfg = window.SUPABASE_CONFIG;
    // Phase 89.2d: ใช้ _appAuthFetch — 401 → refresh + retry อัตโนมัติ
    const authFetch = window._appAuthFetch || fetch;
    // ★ return=representation เพื่อให้ได้ rows ที่ลบจริงกลับมา — ตรวจได้ว่า RLS บล็อคไหม
    const headers = { "Content-Type": "application/json", "Prefer": "return=representation" };
    try {
      await voidJvForSource("receipts", r.id);
      // 1. ลบ receipt_items (OK ถ้า 0 rows เพราะอาจไม่มี items)
      await authFetch(cfg.url + "/rest/v1/receipt_items?receipt_id=eq." + r.id, { method: "DELETE", headers });
      // 2. ลบ receipt — verify ว่ามี row ถูกลบจริง
      const delResp = await authFetch(cfg.url + "/rest/v1/receipts?id=eq." + r.id, { method: "DELETE", headers });
      if (!delResp.ok) throw new Error("HTTP " + delResp.status);
      const deleted = await delResp.json().catch(() => []);
      if (!Array.isArray(deleted) || deleted.length === 0) {
        throw new Error("ไม่มี row ถูกลบ — RLS อาจบล็อค DELETE policy กรุณารัน supabase-rls-policies.sql");
      }
      // 3. คืนสถานะ delivery_invoice กลับเป็น invoiced (รอดำเนินการ)
      const invId = r.delivery_invoice_id || null;
      let restoreFailed = false;
      if (invId) {
        const restoreResp = await authFetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + invId,
          { method: "PATCH", headers, body: JSON.stringify({ status: "pending" }) });
        if (!restoreResp.ok) {
          restoreFailed = true;
          console.warn("[receipts delete] restore invoice failed:", invId, restoreResp.status);
        }
      }
      // Phase 57: audit log (silent)
      logActivity("delete_receipt", {
        entityType: "receipt",
        entityId: r.id,
        summary: `ลบใบเสร็จ ${r.receipt_no || "#"+r.id}` + (r.customer_name ? ` (${r.customer_name})` : "") + (r.grand_total ? ` ${Number(r.grand_total).toLocaleString("th-TH")} บาท` : "")
      });
      _ctx.showToast("ลบใบเสร็จแล้ว ✓");
      if (restoreFailed) _ctx.showToast("ลบใบเสร็จแล้ว แต่คืนสถานะใบส่งสินค้าไม่สำเร็จ — กรุณาตรวจหน้าใบส่งสินค้า", "warn");
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
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L4 doc-edit handler (date input change, single admin)
      r.created_at = isoDate;
      document.querySelectorAll("#rcDocPreview [id^='rcDateCell']").forEach(el => {
        if (rcShowDate?.checked) el.textContent = dateTH(isoDate);
      });
      _ctx.showToast("อัปเดตวันที่เรียบร้อย ✓");
    } catch (e) {
      console.error("[receipts edit date] error:", e);
      _ctx.showToast("❌ แก้วันที่ไม่สำเร็จ: " + (e.message || e));
      // eslint-disable-next-line require-atomic-updates -- A: UI rollback in catch (sequential error path, single admin user)
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
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L4 doc-edit handler (paymethod dropdown change, single admin)
      r.payment_method = newMethod;
      _ctx.showToast("อัปเดตวิธีชำระเรียบร้อย ✓");
      // Re-render preview เพื่อให้ checkboxes แสดง ✓ ตรงตำแหน่งที่เลือก
      renderReceiptsPage(_ctx);
    } catch (e) {
      console.error("[receipts edit pay method] error:", e);
      _ctx.showToast("❌ อัปเดตไม่สำเร็จ: " + (e.message || e));
      // rollback dropdown
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L4 doc-edit handler (paymethod rollback, single admin)
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

// ═══════════════════════════════════════════════════════════
//  Phase 45.12 — Edit drawer (basic fields only — line items lock)
// ═══════════════════════════════════════════════════════════
function _openReceiptEditDrawer(r) {
  document.getElementById("rcEditModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "rcEditModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f0fdf4">
        <h3 style="margin:0;font-size:16px;color:#15803d">✏️ แก้ไขใบเสร็จ ${escHtml(r.receipt_no || '')}</h3>
        <button id="rcEditClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:11px;color:#64748b;background:#fef3c7;padding:6px 10px;border-radius:6px">
          ⚠️ แก้ได้เฉพาะข้อมูลทั่วไป — รายการสินค้า/ยอดรวม ล็อค (มาจากใบส่งสินค้า ถ้าต้องแก้ → ยกเลิกแล้วออกใหม่)
        </div>

        <label style="display:block">
          <span style="font-size:12px;color:#64748b">ชื่อลูกค้า *</span>
          <input id="rcEdName" type="text" value="${escHtml(r.customer_name || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">เบอร์โทร</span>
            <input id="rcEdPhone" type="tel" value="${escHtml(r.customer_phone || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">เลขผู้เสียภาษี</span>
            <input id="rcEdTaxId" type="text" value="${escHtml(r.customer_tax_id || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
        </div>
        <label style="display:block">
          <span style="font-size:12px;color:#64748b">ที่อยู่</span>
          <textarea id="rcEdAddress" rows="2" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;resize:vertical;font-family:inherit">${escHtml(r.customer_address || '')}</textarea>
        </label>
        <label style="display:block">
          <span style="font-size:12px;color:#64748b">ผู้ขาย</span>
          <input id="rcEdSalesperson" type="text" value="${escHtml(r.salesperson || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">โครงการ</span>
            <input id="rcEdProject" type="text" value="${escHtml(r.project_name || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
          <label style="display:block">
            <span style="font-size:12px;color:#64748b">ใบอ้างอิง</span>
            <input id="rcEdRef" type="text" value="${escHtml(r.ref_no || '')}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px" />
          </label>
        </div>
        <label style="display:block">
          <span style="font-size:12px;color:#64748b">หมายเหตุ</span>
          <textarea id="rcEdNote" rows="2" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;resize:vertical;font-family:inherit">${escHtml(r.note || '')}</textarea>
        </label>

        <label style="display:block">
          <span style="font-size:12px;color:#64748b">🏦 บัญชีรับโอน (สำหรับใบเสร็จ)</span>
          <select id="rcEdBankCoa" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px">
            <option value="">— ไม่ระบุ —</option>
            ${(_ctx.state.paymentInfo?.banks || []).filter(b => b.coaCode).map(b => `<option value="${escHtml(b.coaCode)}" ${r.bank_coa_code === b.coaCode ? 'selected' : ''}>${escHtml([b.bankName, b.bankAccount].filter(Boolean).join(' '))}</option>`).join("")}
          </select>
        </label>

        <div id="rcEdStatus" style="font-size:12px;min-height:16px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="rcEdCancel" class="btn light">ยกเลิก</button>
          <button id="rcEdSave" class="btn primary">💾 บันทึก</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("#rcEditClose").addEventListener("click", close);
  modal.querySelector("#rcEdCancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#rcEdSave").addEventListener("click", async () => {
    const name = modal.querySelector("#rcEdName").value.trim();
    if (!name) {
      modal.querySelector("#rcEdStatus").innerHTML = '<span style="color:#dc2626">กรอกชื่อลูกค้า</span>';
      return;
    }
    // Phase 442: bank override — snapshot bank_label from the SELECTED bank (same as B2a quotation, reviewer #3)
    const _edBankCoa = modal.querySelector("#rcEdBankCoa")?.value || "";
    const _edBankObj = (_ctx.state.paymentInfo?.banks || []).find(b => b.coaCode === _edBankCoa);
    const _edBankLabel = _edBankObj ? [_edBankObj.bankName, _edBankObj.bankAccount].filter(Boolean).join(" ") : "";
    const payload = {
      customer_name: name,
      bank_coa_code: _edBankCoa || null, // Phase 442: receipt receiving-bank override
      bank_label: _edBankLabel || null,
      customer_phone: modal.querySelector("#rcEdPhone").value.trim(),
      customer_tax_id: modal.querySelector("#rcEdTaxId").value.trim(),
      customer_address: modal.querySelector("#rcEdAddress").value.trim(),
      salesperson: modal.querySelector("#rcEdSalesperson").value.trim(),
      project_name: modal.querySelector("#rcEdProject").value.trim(),
      ref_no: modal.querySelector("#rcEdRef").value.trim(),
      note: modal.querySelector("#rcEdNote").value.trim()
    };

    const saveBtn = modal.querySelector("#rcEdSave");
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    try {
      const result = await window._appXhrPatch?.("receipts", payload, "id", r.id);
      if (!result?.ok) throw new Error(result?.error?.message || "บันทึกไม่สำเร็จ");

      // Optimistic update local state
      try {
        const idx = (_ctx.state.receipts || []).findIndex(x => x.id === r.id);
        if (idx >= 0) _ctx.state.receipts[idx] = { ..._ctx.state.receipts[idx], ...payload };
      } catch(e){}

      window.App?.showToast?.("บันทึกสำเร็จ");
      close();
      renderReceiptsPage(_ctx);
      // Background reload
      if (_ctx.loadAllData) _ctx.loadAllData().catch(e => console.warn("[rcEdit] reload", e));
    } catch (e) {
      console.error("[rcEdit save]", e);
      modal.querySelector("#rcEdStatus").innerHTML = `<span style="color:#dc2626">${escHtml(e.message || String(e))}</span>`;
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 บันทึก";
    }
  });

  setTimeout(() => modal.querySelector("#rcEdName")?.focus(), 100);
}

// ═══════════════════════════════════════════════════════════
//  Phase 69 (C2): Multi-payment per receipt
// ═══════════════════════════════════════════════════════════
const PAY_METHOD_OPTIONS = [
  { value: "cash",     label: "💵 เงินสด" },
  { value: "transfer", label: "💸 โอนเงิน" },
  { value: "credit",   label: "💳 บัตรเครดิต" },
  { value: "cheque",   label: "📝 เช็ค" },
  { value: "other",    label: "🏷️ อื่นๆ" }
];

function _renderMultiPayRows(rows, _grandTotal) {
  return rows.map((row, idx) => `
    <div class="rc-mp-row" data-idx="${idx}" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select class="rc-mp-method" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;min-width:120px">
        ${PAY_METHOD_OPTIONS.map(o => `<option value="${o.value}" ${o.value===row.method?'selected':''}>${o.label}</option>`).join("")}
      </select>
      <input class="rc-mp-amount" type="number" step="0.01" min="0" value="${Number(row.amount||0)}" placeholder="ยอด" style="width:110px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;text-align:right" />
      <input class="rc-mp-ref" type="text" value="${escHtml(row.ref||'')}" placeholder="ref / เลขที่ (เลือกใส่)" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px" />
      <button type="button" class="rc-mp-remove" style="padding:5px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">×</button>
    </div>
  `).join("");
}

function _wireMultiPayPanel(r) {
  const btn   = document.getElementById("rcMultiPayBtn");
  const panel = document.getElementById("rcMultiPayPanel");
  const rowsEl = document.getElementById("rcMultiPayRows");
  const sumEl  = document.getElementById("rcMultiPaySum");
  const remEl  = document.getElementById("rcMultiPayRemain");
  const addBtn = document.getElementById("rcMultiPayAddRow");
  const saveBtn= document.getElementById("rcMultiPaySave");
  if (!btn || !panel || !rowsEl) return;

  // local state — load from r.payments or seed with single row from payment_method
  const rows = Array.isArray(r.payments) && r.payments.length
    ? r.payments.map(p => ({ method: p.method || "cash", amount: Number(p.amount || 0), ref: p.ref || "" }))
    : (r.payment_method
        ? [{ method: r.payment_method, amount: Number(r.grand_total || 0), ref: "" }]
        : []);

  const grandTotal = Number(r.grand_total || 0);

  const reflect = () => {
    rowsEl.innerHTML = _renderMultiPayRows(rows, grandTotal);
    const sum = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const remain = grandTotal - sum;
    if (sumEl) sumEl.textContent = money(sum);
    if (remEl) {
      remEl.textContent = money(Math.abs(remain));
      remEl.style.color = Math.abs(remain) < 0.01 ? "#10b981" : (remain < 0 ? "#dc2626" : "#dc2626");
    }
    if (saveBtn) {
      const ok = Math.abs(remain) < 0.01 && rows.length > 0;
      saveBtn.disabled = !ok;
      saveBtn.style.opacity = ok ? "1" : "0.55";
      saveBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }
    // re-bind row handlers (after re-render)
    rowsEl.querySelectorAll(".rc-mp-row").forEach(rowEl => {
      const idx = Number(rowEl.dataset.idx);
      rowEl.querySelector(".rc-mp-method")?.addEventListener("change", e => { rows[idx].method = e.target.value; updateLive(); });
      rowEl.querySelector(".rc-mp-amount")?.addEventListener("input",  e => { rows[idx].amount = Number(e.target.value || 0); updateLive(); });
      rowEl.querySelector(".rc-mp-ref")?.addEventListener("input",     e => { rows[idx].ref = e.target.value; });
      rowEl.querySelector(".rc-mp-remove")?.addEventListener("click",  () => { rows.splice(idx, 1); reflect(); });
    });
  };
  // updateLive: ไม่ต้อง re-render rows (รักษา focus)
  const updateLive = () => {
    const sum = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const remain = grandTotal - sum;
    if (sumEl) sumEl.textContent = money(sum);
    if (remEl) {
      remEl.textContent = money(Math.abs(remain));
      remEl.style.color = Math.abs(remain) < 0.01 ? "#10b981" : "#dc2626";
    }
    const ok = Math.abs(remain) < 0.01 && rows.length > 0;
    if (saveBtn) {
      saveBtn.disabled = !ok;
      saveBtn.style.opacity = ok ? "1" : "0.55";
      saveBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }
  };

  btn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) reflect();
  });
  addBtn?.addEventListener("click", () => {
    const sum = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const suggested = Math.max(0, grandTotal - sum);
    rows.push({ method: "cash", amount: suggested, ref: "" });
    reflect();
  });
  saveBtn?.addEventListener("click", () => _multiPayGuard.run(async () => {
    const sum = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    if (Math.abs(grandTotal - sum) > 0.01) {
      window.App?.showToast?.("ผลรวมไม่ตรงกับยอดบิล", "error");
      return;
    }
    saveBtn.disabled = true;
    const orig = saveBtn.textContent;
    saveBtn.textContent = "⏳ บันทึก...";
    try {
      // Build clean payload (drop empty refs to keep DB tidy)
      const payments = rows.map(x => {
        const p = { method: x.method, amount: Number(x.amount) };
        if (x.ref && x.ref.trim()) p.ref = x.ref.trim();
        return p;
      });
      // Update primary payment_method to the largest entry (for backward compat)
      const main = [...payments].sort((a,b)=>b.amount-a.amount)[0];
      const patchBody = { payments };
      if (main) patchBody.payment_method = main.method;
      await window._appXhrPatch?.("receipts", patchBody, "id", r.id);
      // Phase 89.42: race is prevented by _multiPayGuard single-flight (no concurrent invocation can reach this line)
      /* eslint-disable require-atomic-updates -- protected by _multiPayGuard single-flight (Phase 89.42) */
      r.payments = payments;
      if (main) r.payment_method = main.method;
      /* eslint-enable require-atomic-updates */
      window.App?.showToast?.("บันทึกการชำระเงินแล้ว ✅");
      // re-render preview to reflect new payment list in document body
      if (_ctx) renderReceiptsPage(_ctx);
    } catch (e) {
      console.error("[multi-pay save]", e);
      window.App?.showToast?.("❌ บันทึกไม่สำเร็จ — รัน supabase-phase69-multi-payment.sql ก่อน", "error");
      /* eslint-disable require-atomic-updates -- A: UI rollback in catch (sequential error path) */
      saveBtn.disabled = false;
      saveBtn.textContent = orig;
      /* eslint-enable require-atomic-updates */
    }
  }));

  // initial render so rows show even before user clicks (so they see existing data via toggle)
  reflect();
}
