
function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}

let _salesSearch = "";
let _salesPage = 1;
const _SALES_PAGE_SIZE = 30;

export function renderSalesPage({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  _salesSearch = "";
  _salesPage = 1;
  renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
}

function renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  const isAdmin = (state.profile?.role === "admin");
  let visibleSales = state.sales.filter(s => !(s.note || "").includes("[ลบแล้ว]"));

  // ★ Search
  if (_salesSearch) {
    const q = _salesSearch.toLowerCase();
    visibleSales = visibleSales.filter(s =>
      (s.order_no || "").toLowerCase().includes(q) ||
      (s.customer_name || "").toLowerCase().includes(q) ||
      (s.payment_method || "").toLowerCase().includes(q)
    );
  }

  // ★ Pagination
  const totalPages = Math.max(1, Math.ceil(visibleSales.length / _SALES_PAGE_SIZE));
  if (_salesPage > totalPages) _salesPage = totalPages;
  const pageItems = visibleSales.slice((_salesPage-1)*_SALES_PAGE_SIZE, _salesPage*_SALES_PAGE_SIZE);

  document.getElementById("page-sales").innerHTML = `
    <div class="panel">
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">รายการขาย (${visibleSales.length} รายการ)</h3>
        <button id="refreshSalesBtn" class="btn light">🔄 รีโหลด</button>
      </div>
      <div style="margin-top:12px">
        <input id="salesSearchInput" placeholder="🔍 ค้นหาเลขบิล / ชื่อลูกค้า / วิธีชำระ..."
          value="${(_salesSearch||"").replace(/"/g,"&quot;")}"
          style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box" />
      </div>
      <div class="card-list mt16">
        ${pageItems.length ? pageItems.map(s => `
          <div class="card">
            <div class="row">
              <div style="flex:1;min-width:0">
                <div style="font-weight:900">${s.order_no}</div>
                <div class="sku">${s.customer_name || "ลูกค้าทั่วไป"} • ${s.payment_method || "-"}</div>
                <div class="sku">${new Date(s.created_at).toLocaleString("th-TH")}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <div style="font-weight:900;color:#0284c7">${money(s.total_amount)}</div>
                <div style="display:flex;gap:6px">
                  <button class="btn light" data-sale-id="${s.id}">เปิดบิล</button>
                  ${isAdmin ? `<button class="btn" data-del-sale="${s.id}" data-del-sale-no="${s.order_no || ''}" style="background:#ef4444;color:#fff;font-size:12px;padding:4px 10px;border-radius:8px;border:none;cursor:pointer">🗑️ ลบ</button>` : ''}
                </div>
              </div>
            </div>
          </div>
        `).join("") : '<div class="card">ยังไม่มีรายการขาย</div>'}
      </div>
      ${totalPages > 1 ? `
      <div style="display:flex;gap:6px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        ${Array.from({length:totalPages},(_,i)=>i+1).map(p=>
          `<button class="contact-page-btn ${p===_salesPage?'active':''}" data-sales-page="${p}" style="min-width:36px;padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:${p===_salesPage?'#0284c7':'#fff'};color:${p===_salesPage?'#fff':'#374151'};font-weight:${p===_salesPage?'700':'400'}">${p}</button>`
        ).join("")}
      </div>` : ""}
    </div>
  `;

  document.getElementById("refreshSalesBtn")?.addEventListener("click", loadAllData);

  // ★ Search
  let _sTimer = null;
  document.getElementById("salesSearchInput")?.addEventListener("input", e => {
    clearTimeout(_sTimer);
    _sTimer = setTimeout(() => {
      _salesSearch = e.target.value.trim();
      _salesPage = 1;
      renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
    }, 300);
  });

  document.querySelectorAll("[data-sale-id]").forEach(btn => btn.addEventListener("click", async () => {
    await loadReceipt(Number(btn.dataset.saleId));
    openReceiptDrawer();
  }));

  /* ── ลบรายการขาย (admin only) ── */
  document.querySelectorAll("[data-del-sale]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const saleId = Number(btn.dataset.delSale);
    const saleNo = btn.dataset.delSaleNo || "";
    if (!confirm(`ลบรายการขาย "${saleNo}" ?\nลบแล้วไม่สามารถกู้คืนได้`)) return;

    btn.disabled = true;
    btn.textContent = "กำลังลบ...";

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");

    try {
      let success = false;

      // ★ วิธีที่ 1: ใช้ Supabase JS client โดยตรง (มี auth token ครบ)
      if (state.supabase) {
        const { data, error } = await state.supabase
          .from("sales")
          .update({ note: newNote })
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
          { note: newNote },
          "id",
          saleId
        );
        if (res?.ok) success = true;
        else console.warn("XHR PATCH failed:", res?.error?.message);
      }

      // ★ วิธีที่ 3: ใช้ RPC function (ถ้ามี)
      if (!success && state.supabase) {
        try {
          const { error: rpcErr } = await state.supabase.rpc("soft_delete_sale", { sale_id: saleId, del_note: newNote });
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

  // ★ Pagination
  document.querySelectorAll("[data-sales-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      _salesPage = Number(btn.dataset.salesPage);
      renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
    });
  });
}
