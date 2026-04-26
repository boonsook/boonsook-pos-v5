// ═══════════════════════════════════════════════════════════
//  CUSTOMER CREDIT / DEBT TRACKER — ลูกค้าค้างชำระ
//  ดู list บิลที่ขายเงินเชื่อ + ติดตามการเก็บเงิน + บันทึกชำระบางส่วน
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function moneyShort(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
  return v.toLocaleString("th-TH");
}

let _ctFilter = "open"; // open | paid | overdue | all

export function renderCreditTrackerPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-credit_tracker");
  if (!container) return;

  // หา sales ที่เป็น credit (is_credit = true)
  const allCredit = (state.sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => s.is_credit);

  const today = new Date().toISOString().slice(0, 10);

  // คำนวณยอดค้างของแต่ละบิล
  const enriched = allCredit.map(s => {
    const total = Number(s.total_amount || 0);
    const paid = Number(s.credit_paid_amount || 0);
    const due = total - paid;
    const isPaid = due <= 0.01; // 1 satang tolerance
    const isOverdue = !isPaid && s.credit_due_date && s.credit_due_date < today;
    const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(s.credit_due_date).getTime()) / (1000*60*60*24)) : 0;
    return { ...s, _total: total, _paid: paid, _due: due, _isPaid: isPaid, _isOverdue: isOverdue, _daysOverdue: daysOverdue };
  });

  // Filter
  let filtered = enriched;
  if (_ctFilter === "open") filtered = enriched.filter(x => !x._isPaid);
  else if (_ctFilter === "paid") filtered = enriched.filter(x => x._isPaid);
  else if (_ctFilter === "overdue") filtered = enriched.filter(x => x._isOverdue);

  // Sort: overdue ก่อน, then due date asc
  filtered.sort((a, b) => {
    if (a._isOverdue !== b._isOverdue) return b._isOverdue ? 1 : -1;
    return String(a.credit_due_date || "9999").localeCompare(String(b.credit_due_date || "9999"));
  });

  // Stats
  const totalOpen = enriched.filter(x => !x._isPaid).reduce((s, x) => s + x._due, 0);
  const totalOverdue = enriched.filter(x => x._isOverdue).reduce((s, x) => s + x._due, 0);
  const countOpen = enriched.filter(x => !x._isPaid).length;
  const countOverdue = enriched.filter(x => x._isOverdue).length;
  const countPaid = enriched.filter(x => x._isPaid).length;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fee2e2,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">💳</div>
        <h2 style="margin:0 0 4px;color:#b91c1c">ลูกค้าค้างชำระ (Credit Tracker)</h2>
        <p style="margin:0;color:#92400e;font-size:13px">ติดตามบิลขายเงินเชื่อ — ดูยอดค้าง • บันทึกการเก็บเงิน • แจ้งเตือนเกินกำหนด</p>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">💸 ยอดค้างทั้งหมด</div>
          <div class="stat-value" style="color:#dc2626;font-size:22px">฿${moneyShort(totalOpen)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countOpen} บิล</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">⚠️ เกินกำหนด</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">฿${moneyShort(totalOverdue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${countOverdue} บิล</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">✓ ชำระแล้ว</div>
          <div class="stat-value" style="color:#059669">${countPaid}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">บิล</div>
        </div>
      </div>

      <!-- Filter -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;font-size:13px">แสดง:</span>
        ${[["open","💳 ยังค้าง","#0284c7"],["overdue","⚠️ เกินกำหนด","#dc2626"],["paid","✓ ชำระแล้ว","#10b981"],["all","ทั้งหมด","#64748b"]].map(([k,l,c]) => `
          <button class="ct-filter-btn" data-f="${k}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_ctFilter===k?c:'#cbd5e1'};background:${_ctFilter===k?c:'#fff'};color:${_ctFilter===k?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">
            ${l}
          </button>
        `).join("")}
        <span style="margin-left:auto;font-size:11px;color:#94a3b8">พบ ${filtered.length} บิล</span>
      </div>

      <!-- List -->
      <div class="panel" style="padding:0">
        ${filtered.length === 0 ? `
          <div style="text-align:center;padding:40px;color:#94a3b8">
            <div style="font-size:40px;margin-bottom:8px">${_ctFilter === 'open' || _ctFilter === 'overdue' ? '🎉' : '📭'}</div>
            <div style="font-weight:600;font-size:14px">${_ctFilter === 'open' || _ctFilter === 'overdue' ? 'ไม่มีลูกค้าค้างชำระ — ดีมาก!' : 'ไม่มีรายการในช่วงนี้'}</div>
            <div style="font-size:12px;margin-top:6px">ใช้ระบบนี้: ในหน้า POS ตอน checkout เลือก payment_method = "เงินเชื่อ"<br>หรือ "บันทึกขายเงินเชื่อ" จากเมนูเพิ่มเติม</div>
          </div>
        ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:10px;text-align:left">บิล</th>
                <th style="padding:10px;text-align:left">ลูกค้า</th>
                <th style="padding:10px;text-align:right">ยอดเต็ม</th>
                <th style="padding:10px;text-align:right">ชำระแล้ว</th>
                <th style="padding:10px;text-align:right">ค้าง</th>
                <th style="padding:10px;text-align:left">ครบกำหนด</th>
                <th style="padding:10px;text-align:center"></th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(s => `
                <tr style="border-bottom:1px solid #e5e7eb;background:${s._isOverdue ? '#fef9c3' : '#fff'}">
                  <td style="padding:10px">
                    <div style="font-weight:700;color:#0284c7;cursor:pointer" data-view-sale="${s.id}" title="ดูใบเสร็จ">${escHtml(s.order_no || '-')}</div>
                    <div style="font-size:11px;color:#64748b">${new Date(s.created_at).toLocaleDateString("th-TH", {year:"2-digit",month:"short",day:"numeric"})}</div>
                  </td>
                  <td style="padding:10px">
                    <div style="font-weight:600">${escHtml(s.customer_name || 'ลูกค้าทั่วไป')}</div>
                  </td>
                  <td style="padding:10px;text-align:right">฿${money(s._total)}</td>
                  <td style="padding:10px;text-align:right;color:#059669">฿${money(s._paid)}</td>
                  <td style="padding:10px;text-align:right;font-weight:700;color:${s._isPaid ? '#10b981' : (s._isOverdue ? '#dc2626' : '#0284c7')};font-size:14px">
                    ${s._isPaid ? '✓ครบ' : '฿' + money(s._due)}
                  </td>
                  <td style="padding:10px;font-size:12px;color:${s._isOverdue ? '#dc2626;font-weight:700' : '#475569'}">
                    ${s.credit_due_date || '-'}
                    ${s._isOverdue ? `<br><span style="font-size:11px">⚠️ เกิน ${s._daysOverdue} วัน</span>` : ''}
                    ${s._isPaid && s.credit_paid_at ? `<br><span style="color:#059669;font-size:11px">ชำระ ${new Date(s.credit_paid_at).toLocaleDateString("th-TH")}</span>` : ''}
                  </td>
                  <td style="padding:10px;text-align:center;white-space:nowrap">
                    ${!s._isPaid ? `<button class="ct-pay-btn" data-id="${s.id}" data-due="${s._due}" style="border:none;background:#10b981;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">💰 รับชำระ</button>` : ''}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        `}
      </div>

      <!-- Help -->
      <div style="margin-top:14px;padding:14px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd;font-size:12px;color:#075985;line-height:1.7">
        <b>💡 วิธีบันทึกขายเงินเชื่อ:</b><br>
        1. ไปหน้า POS → เลือกสินค้า → ตรงช่อง payment เลือก <b>"เงินเชื่อ"</b><br>
        2. ระบบจะบันทึกบิลพร้อม flag <code>is_credit = true</code><br>
        3. กลับมาหน้านี้ → ตามเก็บเงินตามเวลา<br>
        4. กด "💰 รับชำระ" → กรอกยอดที่รับ → บันทึก
      </div>
    </div>
  `;

  container.querySelectorAll(".ct-filter-btn").forEach(btn => btn.addEventListener("click", () => {
    _ctFilter = btn.dataset.f;
    renderCreditTrackerPage(ctx);
  }));

  container.querySelectorAll("[data-view-sale]").forEach(el => el.addEventListener("click", async () => {
    const saleId = el.dataset.viewSale;
    if (window.App?.loadReceipt && window.App?.openReceiptDrawer) {
      await window.App.loadReceipt(saleId);
      window.App.openReceiptDrawer();
    }
  }));

  container.querySelectorAll(".ct-pay-btn").forEach(btn => btn.addEventListener("click", () => {
    const sale = enriched.find(x => String(x.id) === String(btn.dataset.id));
    if (sale) openReceivePaymentModal(ctx, sale);
  }));
}

function openReceivePaymentModal(ctx, sale) {
  document.getElementById("ctPayModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "ctPayModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px">
      <h3 style="margin:0 0 12px;color:#059669">💰 รับชำระเงิน</h3>
      <div style="background:#f0f9ff;padding:10px 12px;border-radius:8px;margin-bottom:12px">
        <div style="font-weight:700">${escHtml(sale.order_no)}</div>
        <div style="font-size:12px;color:#64748b">${escHtml(sale.customer_name || 'ลูกค้าทั่วไป')}</div>
        <div style="margin-top:6px;font-size:13px">
          <span>ยอดเต็ม: <b>฿${money(sale._total)}</b></span><br>
          <span>ชำระแล้ว: <b style="color:#059669">฿${money(sale._paid)}</b></span><br>
          <span>คงค้าง: <b style="color:#dc2626;font-size:16px">฿${money(sale._due)}</b></span>
        </div>
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:600">รับชำระครั้งนี้:</label>
          <input id="ctPayAmount" type="number" min="0" max="${sale._due}" step="0.01" value="${sale._due.toFixed(2)}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:18px;font-weight:700;text-align:center" />
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="ct-quick" data-v="${sale._due}" style="flex:1;padding:6px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:12px">ทั้งหมด</button>
            <button class="ct-quick" data-v="${(sale._due/2).toFixed(2)}" style="flex:1;padding:6px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:12px">ครึ่งหนึ่ง</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">วิธีชำระ:</label>
          <select id="ctPayMethod" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="cash">เงินสด</option>
            <option value="transfer">โอน</option>
            <option value="card">บัตร</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600">หมายเหตุ:</label>
          <input id="ctPayNote" type="text" placeholder="เช่น โอนเข้าบัญชี SCB" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="ctPayCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="ctPaySave" style="flex:1;padding:10px;border:none;background:#059669;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">💾 บันทึกการรับชำระ</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  modal.querySelectorAll(".ct-quick").forEach(b => b.addEventListener("click", () => {
    modal.querySelector("#ctPayAmount").value = b.dataset.v;
  }));
  modal.querySelector("#ctPayCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#ctPaySave").addEventListener("click", async () => {
    const amount = Number(modal.querySelector("#ctPayAmount").value || 0);
    const method = modal.querySelector("#ctPayMethod").value;
    const note = modal.querySelector("#ctPayNote").value.trim();
    if (amount <= 0) { window.App?.showToast?.("กรอกจำนวนเงิน", "warn"); return; }
    if (amount > sale._due + 0.01) { window.App?.showToast?.("เกินยอดที่ค้าง", "warn"); return; }

    const btn = modal.querySelector("#ctPaySave");
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;

    try {
      // 1. INSERT credit_payments record
      await fetch(cfg.url + "/rest/v1/credit_payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.anonKey,
          "Authorization": "Bearer " + accessToken,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          sale_id: sale.id,
          customer_id: sale.customer_id || null,
          amount,
          payment_method: method,
          note: note || null
        })
      });

      // 2. UPDATE sales: เพิ่ม credit_paid_amount + check ถ้าครบ → set credit_paid_at
      const newPaid = sale._paid + amount;
      const isFullyPaid = (sale._total - newPaid) <= 0.01;
      const patch = { credit_paid_amount: newPaid };
      if (isFullyPaid) patch.credit_paid_at = new Date().toISOString();
      await fetch(cfg.url + "/rest/v1/sales?id=eq." + sale.id, {
        method: "PATCH",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(patch)
      });

      modal.remove();
      ctx.showToast?.(`✓ รับชำระ ฿${money(amount)} ${isFullyPaid ? '— ครบแล้ว 🎉' : ''}`);
      if (window.App?.loadAllData) await window.App.loadAllData();
      renderCreditTrackerPage(ctx);
    } catch (e) {
      window.App?.showToast?.("ผิดพลาด: " + (e?.message || e), "error");
      btn.disabled = false; btn.textContent = "💾 บันทึกการรับชำระ";
    }
  });
}
