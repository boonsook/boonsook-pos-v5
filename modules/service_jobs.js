
const STATUS_LABELS = {
  pending:    "รอดำเนินการ",
  progress:   "กำลังดำเนินการ",
  in_progress:"กำลังดำเนินการ",
  done:       "เสร็จแล้ว",
  delivered:  "ส่งมอบแล้ว",
  open:       "เปิดงาน",
  cancelled:  "ยกเลิก"
};

const STATUS_COLOR = {
  pending:    "#f59e0b",
  progress:   "#0284c7",
  in_progress:"#0284c7",
  done:       "#10b981",
  delivered:  "#6366f1",
  open:       "#f59e0b",
  cancelled:  "#ef4444"
};

const JOB_TYPE_LABELS = {
  ac:    "🌬️ งานแอร์",
  solar: "☀️ โซลาร์เซลล์",
  cctv:  "📷 กล้องวงจรปิด",
  other: "🔧 อื่นๆ"
};

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const sanitizeUrl = (url) => {
  try { const u = new URL(url); return ["http:","https:"].includes(u.protocol) ? url : ""; }
  catch { return ""; }
};

export function renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute }) {
  // ★ ซ่อนงานที่ถูกลบ (status = cancelled + note มีคำว่า [ลบแล้ว])
  const jobs = (state.serviceJobs || []).filter(j => !(j.status === "cancelled" && (j.note || "").includes("[ลบแล้ว]")));
  document.getElementById("page-service_jobs").innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบรับงาน / งานบริการ</h3>
        <button id="serviceJobAddBtn" class="btn primary">+ เพิ่มงานช่าง</button>
      </div>
      <div class="card-list mt16">
        ${jobs.length ? jobs.map(j => {
          // ★ รองรับทั้ง schema เดิม (job_title) และใหม่ (description)
          const desc        = j.description || j.job_title || "-";
          const customer    = j.customer_name || "-";
          const phone       = j.customer_phone || "";
          const address     = j.customer_address || j.job_address || "";
          const status      = j.status || "pending";
          const jobType     = j.job_type || "";
          const jobNo       = j.job_no || "";
          const statusLabel = STATUS_LABELS[status] || status;
          const statusColor = STATUS_COLOR[status] || "#9ca3af";
          const typeLabel   = JOB_TYPE_LABELS[jobType] || "";
          const isWebOrder  = (j.sub_service || "").includes("สั่งซื้อ") || /^SH-(transfer|cod_cash|cod_transfer)\|/.test(j.note || "");

          // ★ ถ้าเป็นออเดอร์จากเว็บ → parse รายการสินค้าจาก description + วิธีชำระ
          let orderItemsHtml = "";
          let orderTotalHtml = "";
          let payBadgeHtml   = "";
          if (isWebOrder) {
            const itemLines = (desc.match(/• .+/g) || []);
            if (itemLines.length > 0) {
              orderItemsHtml = '<div style="margin-top:8px;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">'
                + '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">🛒 รายการสินค้า</div>'
                + itemLines.map(line => {
                    const clean = line.replace(/^• /, "");
                    return '<div style="font-size:13px;color:#1f2937;padding:2px 0;border-bottom:1px solid #f1f5f9">' + escHtml(clean) + '</div>';
                  }).join("")
                + '</div>';
            }
            if (j.total_cost) {
              orderTotalHtml = '<div style="margin-top:6px;font-size:16px;font-weight:900;color:#0284c7">💰 รวม: ฿' + Number(j.total_cost).toLocaleString("th-TH", {minimumFractionDigits:2}) + '</div>';
            }
            // ★ วิธีชำระเงิน
            const notePayMatch = (j.note || "").match(/^SH-(transfer|cod_cash|cod_transfer)/);
            if (notePayMatch) {
              const payIcons = { transfer: "🏦 โอนเงิน", cod_cash: "💵 เงินสดปลายทาง", cod_transfer: "📲 โอนหน้างาน" };
              const payColors = { transfer: "#1e40af;background:#dbeafe", cod_cash: "#92400e;background:#fef3c7", cod_transfer: "#7c3aed;background:#ede9fe" };
              const pmethod = notePayMatch[1];
              payBadgeHtml = '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;color:' + (payColors[pmethod] || "#64748b;background:#f1f5f9") + '">' + (payIcons[pmethod] || pmethod) + '</span>';
            }
          }

          // ★ Title: ออเดอร์เว็บ แสดงสั้นๆ / งานช่างแสดง description เต็ม
          const titleDisplay = isWebOrder
            ? '📱 สั่งซื้อผ่านเว็บ'
            : escHtml(desc.length > 100 ? desc.substring(0, 100) + '…' : desc);

          // ★ แสดงรูปสลิปฝั่ง admin (ดึง URL จาก note ที่มี SLIP_URL:)
          let slipImgHtml = "";
          if (isWebOrder) {
            const slipUrlMatch = (j.note || "").match(/SLIP_URL:(https?:\/\/[^\|]+)/);
            const slipUrl = sanitizeUrl(slipUrlMatch?.[1] || "");
            const slipStatus = (j.note || "").includes("SLIP_OK") ? "✅ ตรวจแล้ว" : (j.note || "").includes("SLIP_PENDING") ? "⏳ รอตรวจ" : "";
            if (slipUrl) {
              slipImgHtml = `<div style="margin-top:8px"><a href="${slipUrl}" target="_blank" title="ดูสลิป"><img src="${slipUrl}" style="max-width:80px;max-height:80px;border-radius:8px;border:2px solid #0284c7;object-fit:cover;cursor:pointer" onerror="this.style.display='none'" /></a>${slipStatus ? `<div style="font-size:11px;font-weight:700;color:#0284c7;margin-top:2px">${slipStatus}</div>` : ""}</div>`;
            } else if (slipStatus) {
              slipImgHtml = `<div style="font-size:12px;color:#92400e;font-weight:700;margin-top:6px">📎 ${slipStatus} (ไม่มี URL สลิป)</div>`;
            }
          }

          return `
            <div class="card" style="${isWebOrder ? 'border-left:4px solid #10b981' : ''}">
              <div class="row" style="align-items:flex-start">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:900;font-size:15px">${titleDisplay}</div>
                  ${jobNo ? `<div class="sku">${escHtml(jobNo)}</div>` : ''}
                  <div class="sku" style="margin-top:2px">👤 ${escHtml(customer)}${phone ? ' &nbsp;📞 ' + escHtml(phone) : ''}</div>
                  ${address ? `<div class="sku">📍 ${escHtml(address)}</div>` : ''}
                  <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                    <span style="font-size:12px;color:${statusColor};font-weight:700;padding:2px 8px;border-radius:99px;background:${statusColor}15">${statusLabel}</span>
                    ${typeLabel ? `<span style="font-size:12px;color:#64748b">${typeLabel}</span>` : ''}
                    ${isWebOrder ? '<span style="font-size:11px;color:#10b981;font-weight:700;padding:2px 8px;border-radius:99px;background:#ecfdf5">🛒 ออเดอร์เว็บ</span>' : ''}
                    ${payBadgeHtml}
                  </div>
                  ${orderItemsHtml}
                  ${orderTotalHtml}
                  ${slipImgHtml}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-left:8px;flex-shrink:0">
                  <button class="btn light" data-job-id="${j.id}">แก้ไข</button>
                  <button class="btn" data-del-job="${j.id}" data-del-name="${escHtml((j.job_no || '') + ' ' + (j.customer_name || ''))}" style="background:#ef4444;color:#fff;font-size:12px;padding:4px 10px;border-radius:8px;border:none;cursor:pointer">🗑️ ลบ</button>
                </div>
              </div>
            </div>
          `;
        }).join("") : '<div class="card" style="text-align:center;color:var(--muted);padding:24px">ยังไม่มีงานช่าง</div>'}
      </div>
    </div>

  `;

  /* ── Add job ── */
  document.getElementById("serviceJobAddBtn")?.addEventListener("click", () => openServiceJobDrawer());

  /* ── Edit job ── */
  document.querySelectorAll("[data-job-id]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.serviceJobs.find(x => x.id === Number(btn.dataset.jobId));
    openServiceJobDrawer(item);
  }));

  /* ── Delete job (soft-delete: cancelled + [ลบแล้ว]) ── */
  document.querySelectorAll("[data-del-job]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const jobId = Number(btn.dataset.delJob);
    const jobName = btn.dataset.delName || "";
    if (!confirm(`ลบใบรับงาน "${escHtml(jobName.trim())}" ?`)) return;

    btn.disabled = true;
    btn.textContent = "กำลังลบ...";

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");
    const updatePayload = { status: "cancelled", note: newNote };

    try {
      let success = false;

      // ★ วิธีที่ 1: Supabase JS client
      if (state.supabase) {
        const { data, error } = await state.supabase
          .from("service_jobs")
          .update(updatePayload)
          .eq("id", jobId)
          .select();

        if (!error && data && data.length > 0) {
          success = true;
        } else {
          console.warn("Supabase client update failed:", error?.message || "0 rows — RLS blocked");
        }
      }

      // ★ วิธีที่ 2: XHR PATCH
      if (!success) {
        const res = await window._appXhrPatch("service_jobs", updatePayload, "id", jobId);
        if (res?.ok) success = true;
        else console.warn("XHR PATCH failed:", res?.error?.message);
      }

      // ★ วิธีที่ 3: RPC fallback
      if (!success && state.supabase) {
        try {
          const { error: rpcErr } = await state.supabase.rpc("soft_delete_service_job", { job_id: jobId, del_note: newNote });
          if (!rpcErr) success = true;
        } catch(rpcE) { console.warn("RPC not available:", rpcE.message); }
      }

      if (success) {
        if (showToast) showToast("ลบงานช่างเรียบร้อย ✅");
        const job = state.serviceJobs.find(x => x.id === jobId);
        if (job) { job.status = "cancelled"; job.note = newNote; }
        renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute });
      } else {
        throw new Error("RLS บล็อค — กรุณาเพิ่ม UPDATE policy ที่ Supabase Dashboard สำหรับตาราง service_jobs");
      }
    } catch (err) {
      if (showToast) showToast("❌ " + (err.message || "ลบไม่สำเร็จ"), "error");
      btn.disabled = false;
      btn.textContent = "🗑️ ลบ";
    }
  }));
}
