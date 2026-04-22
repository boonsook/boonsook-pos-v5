// ═══════════════════════════════════════════════════════════
//  DELIVERY INVOICES — ใบส่งสินค้า / ใบแจ้งหนี้
//  ★ รายการ, preview, พิมพ์, PDF, แชร์, สร้างใบเสร็จ
// ═══════════════════════════════════════════════════════════

// share ใช้ window._appShareDoc จาก main.js

function money(n){ return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0)); }
function num(n){ return new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0)); }
function dateTH(d){ if(!d) return "-"; try{ return new Date(d).toLocaleDateString("th-TH",{year:"numeric",month:"short",day:"numeric"}); }catch(e){ return d; } }

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

export function renderDeliveryInvoicesPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-delivery_invoices");
  if (!container) return;

  if (_viewMode === "preview" && _viewingId) { renderInvoicePreview(container); return; }

  _viewMode = "list";
  const invoices = ctx.state.deliveryInvoices || [];

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบส่งสินค้า / ใบแจ้งหนี้</h3>
        <span class="sku">สร้างจากใบเสนอราคาที่อนุมัติแล้ว</span>
      </div>

      <div class="stats-grid mt16" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="stat-label">ทั้งหมด</div>
          <div class="stat-value">${invoices.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">รอดำเนินการ</div>
          <div class="stat-value" style="color:#f59e0b">${invoices.filter(i=>i.status==="pending").length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">เปิดใบเสร็จแล้ว</div>
          <div class="stat-value" style="color:#6366f1">${invoices.filter(i=>i.status==="receipted").length}</div>
        </div>
      </div>

      <div class="card-list mt16">
        ${invoices.length ? invoices.map(inv => {
          const status      = inv.status || "pending";
          const statusLabel = STATUS_LABELS[status] || status;
          const statusColor = STATUS_COLOR[status] || "#9ca3af";
          return `
            <div class="card">
              <div class="row" style="align-items:flex-start">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:900;font-size:15px">${inv.inv_no || "-"}</div>
                  <div class="sku">${inv.customer_name || "-"}</div>
                  ${inv.ref_no ? '<div class="sku">อ้างอิง: '+inv.ref_no+'</div>' : ''}
                  <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                    <span class="badge" style="background:${statusColor}18;color:${statusColor}">${statusLabel}</span>
                    <span style="font-size:13px;font-weight:700">${money(inv.grand_total||0)}</span>
                    <span class="sku">${dateTH(inv.created_at)}</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button class="btn light di-view-btn" data-di-id="${inv.id}" style="font-size:12px;padding:8px 12px">ดูเอกสาร</button>
                  ${!['receipted','cancelled'].includes(status) ? '<button class="btn primary di-receipt-btn" data-di-receipt="' + inv.id + '" style="font-size:12px;padding:8px 12px">🧾 ออกใบเสร็จ</button>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join("") : '<div class="card" style="text-align:center;color:var(--muted);padding:24px">ยังไม่มีใบส่งสินค้า — สร้างจากใบเสนอราคาที่อนุมัติแล้ว</div>'}
      </div>
    </div>
  `;

  container.querySelectorAll(".di-view-btn").forEach(btn => btn.addEventListener("click", async () => {
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

  // ออกใบเสร็จรับเงิน
  container.querySelectorAll(".di-receipt-btn").forEach(btn => btn.addEventListener("click", async () => {
    const inv = (ctx.state.deliveryInvoices || []).find(x => x.id === Number(btn.dataset.diReceipt));
    if (inv) convertToReceipt(inv);
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

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <button id="diPreviewBack" class="btn light">&larr; กลับ</button>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;background:#f8fafc">
            <input type="checkbox" id="diShowDate" checked style="width:15px;height:15px;cursor:pointer" />
            ลงวันที่
          </label>
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
        <div class="doc-page-badge inv">${pageNum}</div>
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
              <div class="doc-copy-label">${pageNum === 1 ? 'ต้นฉบับ' : 'สำเนา'}</div>
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
              <th style="width:30px">#</th><th style="text-align:left">รายละเอียด</th>
              <th style="width:65px">จำนวน</th><th style="width:55px">หน่วย</th>
              <th style="width:95px">ราคาต่อหน่วย</th>
              <th style="width:95px">ยอดรวม</th>
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
              <div class="doc-total-row grand inv"><span>จำนวนเงินรวมทั้งสิ้น</span><span>${num(grandTotal)} บาท</span></div>
            </div>
          </div>

          <div class="doc-note-section">
            <div class="doc-note-title inv">หมายเหตุ</div>
            <div>${inv.note ? escHtml(inv.note) : 'วิธีการชำระเงิน-ชำระเงินสด/เช็คเงินสด โอนผ่านธนาคาร'}</div>
          </div>

          <div class="doc-signatures">
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">ในนาม ${escHtml(inv.customer_name || '-')}</div>
              <div class="doc-sig-line"></div>
              <div class="doc-sig-label-row"><span>ผู้รับสินค้า / บริการ</span><span>วันที่</span></div>
            </div>
            <div class="doc-sig-col">
              <div class="doc-sig-behalf">ในนาม ${escHtml(si.name || 'บุญสุข อิเล็กทรอนิกส์')}</div>
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

  // ── delete delivery invoice → restore quotation status ──
  document.getElementById("diDeleteBtn")?.addEventListener("click", async () => {
    if (!(await window.App?.confirm?.(`ลบใบส่งสินค้า ${inv.inv_no} ?\n\nใบเสนอราคาที่อ้างอิงจะกลับสถานะเป็น "อนุมัติแล้ว" เพื่อให้แก้ไขหรือลบได้`))) return;
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=minimal" };
    try {
      // 1. ลบ delivery_invoice_items
      await fetch(cfg.url + "/rest/v1/delivery_invoice_items?delivery_invoice_id=eq." + inv.id, { method: "DELETE", headers });
      // 2. ลบ delivery_invoice — ต้องสำเร็จก่อนถึงจะ restore status
      const delResp = await fetch(cfg.url + "/rest/v1/delivery_invoices?id=eq." + inv.id, { method: "DELETE", headers });
      if (!delResp.ok) throw new Error("ลบใบส่งสินค้าไม่สำเร็จ (HTTP " + delResp.status + ")");
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
      _ctx.showToast("เกิดข้อผิดพลาด: " + e.message);
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

  document.getElementById("diShareBtn")?.addEventListener("click", () => {
    window._appShareDoc("diDocPreview", inv.inv_no || "invoice");
  });

  document.getElementById("diPrintBtn")?.addEventListener("click", () => {
    const content = document.getElementById("diDocPreview")?.innerHTML; if (!content) return;
    const w = window.open("","_blank");
    w.document.write('<html><head><title>ใบส่งสินค้า</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}body{font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;margin:0;padding:0;color:#1a1a1a;font-size:14px}.doc-preview{padding:0}.doc-page{width:210mm;min-height:297mm;padding:20mm 18mm 15mm;box-sizing:border-box;page-break-after:always;position:relative;display:flex;flex-direction:column}.doc-page:last-child{page-break-after:avoid}.doc-page-inner{flex:1;display:flex;flex-direction:column}.doc-accent{height:5px;width:100%;position:absolute;top:0;left:0}.doc-accent.inv{background:linear-gradient(90deg,#0369a1,#0284c7,#38bdf8)}.doc-page-badge{position:absolute;top:0;right:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;background:#0284c7}.doc-copy-label{font-size:13px;font-weight:600;color:#64748b;text-align:center}.doc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.doc-header-left{display:flex;gap:12px;max-width:55%}.doc-logo{width:64px;height:64px;border-radius:8px;object-fit:contain}.doc-company-name{font-size:16px;font-weight:900;margin-bottom:4px}.doc-company-detail{font-size:12px;color:#555;line-height:1.7}.doc-title{font-size:26px;font-weight:900}.doc-title.inv{color:#0369a1}.doc-detail-table{margin-left:auto;border-collapse:collapse;font-size:13px;margin-top:8px}.doc-detail-table td{padding:3px 10px;border:1px solid #d1d5db}.doc-detail-table td:first-child{font-weight:700;color:#555;background:#f9fafb;white-space:nowrap}.doc-customer-section{margin:12px 0 16px}.doc-customer-label{font-weight:800;font-size:12px;text-decoration:underline;margin-bottom:4px;color:#0369a1}.doc-customer-name{font-weight:700;font-size:14px}.doc-customer-detail{font-size:13px;color:#333;line-height:1.6}.doc-table{width:100%;border-collapse:collapse;margin:12px 0 8px}.doc-table th{padding:8px 10px;font-size:12px;font-weight:700;text-align:center;border:1px solid #d1d5db;background:#f3f4f6;color:#333}.doc-table td{padding:8px 10px;font-size:13px;border:1px solid #d1d5db;vertical-align:top}.doc-totals{margin-left:auto;width:280px;margin-top:4px}.doc-total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#333}.doc-total-row.grand{font-size:14px;font-weight:900;padding-top:8px;margin-top:4px}.doc-total-row.grand.inv{color:#0369a1;border-top:2px solid #0369a1}.doc-note-section{margin-top:16px;font-size:12.5px;line-height:1.7}.doc-note-title{font-weight:800;text-decoration:underline;margin-bottom:2px;color:#0369a1}.doc-signatures{display:flex;justify-content:space-between;margin-top:auto;padding-top:24px;font-size:13px}.doc-sig-col{text-align:center;width:42%}.doc-sig-behalf{font-weight:600;margin-bottom:28px;font-size:12.5px}.doc-sig-line{width:200px;border-bottom:1px solid #333;margin:0 auto 6px}.doc-sig-label-row{display:flex;justify-content:center;gap:40px;font-size:12px}</style></head><body>'+content+'</body></html>');
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
  if (!(await window.App?.confirm?.("ออกใบเสร็จรับเงินจากใบส่งสินค้านี้?"))) return;

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
