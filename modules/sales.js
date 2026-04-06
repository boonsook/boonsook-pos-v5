
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
  // ★ ซ่อนรายการที่ soft-delete แล้ว (เช็ค deleted_at และ note)
  const visibleSales = state.sales.filter(s => !s.deleted_at && !(s.note || "").includes("[ลบแล้ว]"));

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
        <button id="refreshSalesBtn" class="btn light">รีโหลด</button>
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
    const saleNo = btn.dataset.delSaleNo || "";
    if (!confirm(`ลบรายการขาย "${saleNo}" ?\nลบแล้วไม่สามารถกู้คืนได้`)) return;

    btn.disabled = true;
    btn.textContent = "กำลังลบ...";

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");
    const deletedAt = new Date().toISOString();

    try {
      let success = false;

      // ★ วิธีที่ 1: ใช้ Supabase JS client โดยตรง (มี auth token ครบ)
      if (state.supabase) {
        const { data, error } = await state.supabase
          .from("sales")
          .update({ note: newNote, deleted_at: deletedAt })
          .eq("id", saleId)
          .select();

        if (!error && data && data.length > 0) {
          success = true;
        } else {
          console.warn("Supabase client update failed:", error?.message || "0 rows affected — RLS อาจบล็อค");
        }
      }

      // ★ วิธีที่ 2: ใช้ XHR PATCH + return=representation
      if (!success) {
        const res = await window._appXhrPatch(
          "sales",
          { note: newNote, deleted_at: deletedAt },
          "id",
          saleId
        );
        if (res?.ok) success = true;
        else console.warn("XHR PATCH failed:", res?.error?.message);
      }

      // ★ วิธีที่ 3: ใช้ RPC function (ถ้ามี)
      if (!success && state.supabase) {
        try {
          const { error: rpcErr } = await state.supabase.rpc("soft_delete_sale", { sale_id: saleId, del_note: newNote, deleted_at: deletedAt });
          if (!rpcErr) success = true;
          else console.warn("RPC soft_delete_sale failed:", rpcErr.message);
        } catch(rpcE) { console.warn("RPC not available:", rpcE.message); }
      }

      if (success) {
        if (showToast) showToast("ลบรายการขายเรียบร้อย ✅");
        await loadAllData();
      } else {
        // ★ ลบไม่ได้จากทุกวิธี → ต้องแก้ RLS policy ที่ Supabase Dashboard
        throw new Error("RLS บล็อคการอัปเดต — กรุณาเพิ่ม UPDATE policy ที่ Supabase Dashboard สำหรับตาราง sales");
      }
    } catch (err) {
      if (showToast) showToast("❌ " + (err.message || "ลบไม่สำเร็จ"), "error");
      btn.disabled = false;
      btn.textContent = "🗑️ ลบ";
    }
  }));
}
