
function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

let _salesPage = 1;
const SALES_PAGE_SIZE = 20;
let _salesAbort = null;

export function renderSalesPage({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  _salesPage = 1;
  _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
}

function _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  if (_salesAbort) _salesAbort.abort();
  _salesAbort = new AbortController();
  const signal = _salesAbort.signal;

  const isAdmin = (state.profile?.role === "admin");
  // ★ ซ่อนรายการที่ soft-delete แล้ว (เช็ค note มี [ลบแล้ว])
  // ★ FIX: ป้องกัน crash ถ้า state.sales เป็น null/undefined
  const visibleSales = (state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]"));

  // ★ Pagination
  const totalPages = Math.max(1, Math.ceil(visibleSales.length / SALES_PAGE_SIZE));
  if (_salesPage > totalPages) _salesPage = totalPages;
  const start = (_salesPage - 1) * SALES_PAGE_SIZE;
  const pageSales = visibleSales.slice(start, start + SALES_PAGE_SIZE);

  const paginationHtml = totalPages > 1 ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn light" data-sales-page="prev" ${_salesPage <= 1 ? 'disabled' : ''} style="padding:6px 14px;font-size:13px">← ก่อนหน้า</button>
      <span style="font-size:13px;color:#64748b">หน้า ${_salesPage}/${totalPages} (${visibleSales.length} รายการ)</span>
      <button class="btn light" data-sales-page="next" ${_salesPage >= totalPages ? 'disabled' : ''} style="padding:6px 14px;font-size:13px">ถัดไป →</button>
    </div>
  ` : (visibleSales.length > 0 ? `<div style="text-align:center;font-size:12px;color:#94a3b8;margin-top:8px">${visibleSales.length} รายการ</div>` : '');

  document.getElementById("page-sales").innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">รายการขายล่าสุด</h3>
        <div style="display:flex;gap:6px">
          <button id="exportSalesXlsxBtn" class="btn light" title="ส่งออก Excel สำหรับทำบัญชี">📊 Excel</button>
          <button id="refreshSalesBtn" class="btn light">รีโหลด</button>
        </div>
      </div>
      <div class="card-list mt16">
        ${pageSales.length ? pageSales.map(s => `
          <div class="card">
            <div class="row">
              <div style="flex:1;min-width:0">
                <div style="font-weight:900">${escHtml(s.order_no)}</div>
                <div class="sku">${escHtml(s.customer_name || "ลูกค้าทั่วไป")} • ${escHtml(s.payment_method || "-")}</div>
                <div class="sku">${new Date(s.created_at).toLocaleString("th-TH")}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <div style="font-weight:900;color:#0284c7">${money(s.total_amount)}</div>
                <div style="display:flex;gap:6px">
                  <button class="btn light" data-sale-id="${s.id}">เปิดบิล</button>
                  ${isAdmin ? `<button class="btn" data-del-sale="${s.id}" data-del-sale-no="${escHtml(s.order_no || '')}" style="background:#ef4444;color:#fff;font-size:12px;padding:4px 10px;border-radius:8px;border:none;cursor:pointer">🗑️ ลบ</button>` : ''}
                </div>
              </div>
            </div>
          </div>
        `).join("") : '<div class="card" style="text-align:center;color:var(--muted);padding:24px">ยังไม่มีรายการขาย</div>'}
      </div>
      ${paginationHtml}
    </div>
  `;

  document.getElementById("refreshSalesBtn")?.addEventListener("click", loadAllData, { signal });

  // ★ FEATURE: ส่งออก Excel สำหรับทำบัญชี (ใช้ XLSX library ที่ index.html โหลดไว้แล้ว)
  document.getElementById("exportSalesXlsxBtn")?.addEventListener("click", () => {
    try {
      if (typeof XLSX === "undefined") {
        return showToast?.("❌ ไลบรารี Excel ยังไม่พร้อม — รีเฟรชหน้าใหม่");
      }
      if (!visibleSales.length) {
        return showToast?.("ยังไม่มีรายการขายที่จะส่งออก");
      }
      const rows = visibleSales.map(s => ({
        "เลขที่บิล":      s.order_no || "",
        "วันที่":         new Date(s.created_at).toLocaleString("th-TH"),
        "ลูกค้า":         s.customer_name || "ลูกค้าทั่วไป",
        "วิธีชำระ":       s.payment_method || "-",
        "ยอดก่อนส่วนลด":  Number(s.subtotal || s.total_amount || 0),
        "ส่วนลด":         Number(s.discount_amount || 0),
        "รวมสุทธิ":       Number(s.total_amount || 0),
        "รับเงิน":        Number(s.paid_amount || 0),
        "เงินทอน":        Number(s.change_amount || 0),
        "หมายเหตุ":       s.note || ""
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 12 },
        { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 28 }
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายการขาย");
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `boonsook-sales-${today}.xlsx`);
      showToast?.("📊 ส่งออก Excel เรียบร้อย");
    } catch (err) {
      console.error("[sales] export error:", err);
      showToast?.("❌ ส่งออกไม่สำเร็จ: " + (err.message || "unknown"));
    }
  }, { signal });

  // ★ Pagination buttons
  document.querySelectorAll("[data-sales-page]").forEach(btn => btn.addEventListener("click", () => {
    const action = btn.dataset.salesPage;
    if (action === "prev" && _salesPage > 1) _salesPage--;
    else if (action === "next" && _salesPage < totalPages) _salesPage++;
    _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
  }, { signal }));

  document.querySelectorAll("[data-sale-id]").forEach(btn => btn.addEventListener("click", async () => {
    await loadReceipt(Number(btn.dataset.saleId));
    openReceiptDrawer();
  }, { signal }));

  /* ── ลบรายการขาย (admin only) ── */
  document.querySelectorAll("[data-del-sale]").forEach(btn => btn.addEventListener("click", async (e) => {  // eslint-disable-line
    e.stopPropagation();
    const saleId = Number(btn.dataset.delSale);
    // ★ FIX: ป้องกัน NaN
    if (!saleId || isNaN(saleId)) { showToast?.("ไม่พบ ID รายการขาย"); return; }
    const saleNo = btn.dataset.delSaleNo || "";
    if (!(await window.App?.confirm?.(`ลบรายการขาย "${saleNo}" ?\nลบแล้วไม่สามารถกู้คืนได้`))) return;

    btn.disabled = true;
    btn.textContent = "กำลังลบ...";

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");

    try {
      let success = false;

      // ★ วิธีที่ 1: XHR PATCH (เร็วกว่า + ควบคุม token ได้)
      try {
        const cfg = window.SUPABASE_CONFIG;
        const token = window._sbAccessToken || cfg.anonKey;
        const patchRes = await fetch(cfg.url + "/rest/v1/sales?id=eq." + saleId, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": cfg.anonKey,
            "Authorization": "Bearer " + token,
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ note: newNote })
        });
        const patchData = await patchRes.json().catch(() => null);
        if (patchRes.ok && Array.isArray(patchData) && patchData.length > 0) {
          success = true;
        } else {
          // ★ FIX: null-safe access to patchData
          const errMsg = (patchData && (patchData.message || patchData.hint))
            || ("status " + patchRes.status + " — 0 rows (RLS?)");
          console.warn("PATCH failed:", errMsg);
          showToast?.("ลบไม่สำเร็จ: " + errMsg);
        }
      } catch (fetchErr) {
        console.warn("PATCH fetch error:", fetchErr.message);
        showToast?.("ลบไม่สำเร็จ (เครือข่าย): " + fetchErr.message);
      }

      // ★ วิธีที่ 2: Supabase JS client (fallback)
      if (!success && state.supabase) {
        const { data, error } = await state.supabase
          .from("sales")
          .update({ note: newNote })
          .eq("id", saleId)
          .select();
        if (!error && data && data.length > 0) {
          success = true;
        } else {
          console.warn("Supabase update failed:", error?.message);
        }
      }

      if (success) {
        if (showToast) showToast("ลบรายการขายเรียบร้อย ✅");
        await loadAllData();
      } else {
        throw new Error("ลบไม่ได้ — ต้องเพิ่ม UPDATE policy ที่ Supabase Dashboard สำหรับตาราง sales");
      }
    } catch (err) {
      showToast?.("ลบไม่สำเร็จ: " + (err.message || err));
      if (showToast) showToast("❌ " + (err.message || "ลบไม่สำเร็จ"), "error");
      btn.disabled = false;
      btn.textContent = "🗑️ ลบ";
    }
  }));
}
