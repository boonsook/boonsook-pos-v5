
import { renderEmpty } from "./ui_states.js";
// Phase 68 (B3): tag rendering + presets · Phase 70 (D3): Excel export
import { renderTagBadge, SERVICE_TAG_PRESETS, exportToExcel, todaySuffix } from "./utils.js";

const STATUS_LABELS = {
  pending:        "รอดำเนินการ",
  progress:       "กำลังดำเนินการ",
  in_progress:    "กำลังดำเนินการ",
  done:           "เสร็จแล้ว",
  pending_review: "📨 รออนุมัติ",
  delivered:      "ส่งมอบแล้ว",
  closed:         "🎉 ลูกค้ายืนยันปิดงาน",
  open:           "เปิดงาน",
  cancelled:      "ยกเลิก"
};

const STATUS_COLOR = {
  pending:        "#f59e0b",
  progress:       "#0284c7",
  in_progress:    "#0284c7",
  done:           "#10b981",
  pending_review: "#a855f7",  // ม่วง — รออนุมัติ
  delivered:      "#6366f1",
  closed:         "#7c3aed",
  open:           "#f59e0b",
  cancelled:      "#ef4444"
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

// ★ Phase 39 — filter chips: ทั้งหมด / ค้าง / ปิดแล้ว / ยกเลิก
// state อยู่ใน module-level — คงค่าระหว่าง re-render แต่ reset เมื่อ refresh page
let _sjFilter = "open"; // default: ค้าง (เพราะคือ default workflow ของช่าง)
let _sjTagFilter = null; // Phase 68: filter by tag

const OPEN_STATUSES = ["pending", "progress", "in_progress", "open"];
const CLOSED_STATUSES = ["done", "delivered", "closed"];
const REVIEW_STATUSES = ["pending_review"];

export function renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute }) {
  // ★ ซ่อนงานที่ถูกลบ (status = cancelled + note มีคำว่า [ลบแล้ว])
  const allJobs = (state.serviceJobs || []).filter(j => !(j.status === "cancelled" && (j.note || "").includes("[ลบแล้ว]")));

  // Counts (เพื่อแสดงในแต่ละ chip)
  const cAll = allJobs.length;
  const cOpen = allJobs.filter(j => OPEN_STATUSES.includes(j.status || "pending")).length;
  const cReview = allJobs.filter(j => REVIEW_STATUSES.includes(j.status)).length;
  const cClosed = allJobs.filter(j => CLOSED_STATUSES.includes(j.status)).length;
  const cCancelled = allJobs.filter(j => j.status === "cancelled").length;

  // Filter ตาม chip ที่เลือก
  let jobs;
  if (_sjFilter === "open")           jobs = allJobs.filter(j => OPEN_STATUSES.includes(j.status || "pending"));
  else if (_sjFilter === "review")    jobs = allJobs.filter(j => REVIEW_STATUSES.includes(j.status));
  else if (_sjFilter === "closed")    jobs = allJobs.filter(j => CLOSED_STATUSES.includes(j.status));
  else if (_sjFilter === "cancelled") jobs = allJobs.filter(j => j.status === "cancelled");
  else                                jobs = allJobs; // "all"

  // Phase 68 (B3): tag filter
  if (_sjTagFilter) {
    jobs = jobs.filter(j => Array.isArray(j.tags) && j.tags.includes(_sjTagFilter));
  }

  const chip = (key, label, count, activeColor) => {
    const isActive = _sjFilter === key;
    return `<button class="sj-filter-chip" data-sj-filter="${key}" style="padding:6px 14px;border-radius:18px;border:1px solid ${isActive ? activeColor : '#cbd5e1'};background:${isActive ? activeColor : '#fff'};color:${isActive ? '#fff' : '#475569'};cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">${label}${count > 0 ? ` (${count})` : ''}</button>`;
  };
  document.getElementById("page-service_jobs").innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">ใบรับงาน / งานบริการ</h3>
        <div style="display:flex;gap:8px">
          <button id="sjExportBtn" class="btn light" style="font-size:13px" title="ส่งออก Excel ตาม filter ที่กำลังเลือก">📥 Excel</button>
          <button id="serviceJobAddBtn" class="btn primary">+ เพิ่มงานช่าง</button>
        </div>
      </div>
      <!-- Phase 39: filter chips -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <span style="font-size:12px;color:#64748b;font-weight:600;margin-right:4px">แสดง:</span>
        ${chip("open",      "🟡 ค้าง",       cOpen,      "#0284c7")}
        ${chip("review",    "📨 รออนุมัติ",  cReview,    "#a855f7")}
        ${chip("closed",    "✅ ปิดแล้ว",    cClosed,    "#10b981")}
        ${chip("cancelled", "⚫ ยกเลิก",     cCancelled, "#64748b")}
        ${chip("all",       "ทั้งหมด",      cAll,       "#475569")}
      </div>
      <!-- Phase 68 (B3): Tag filter chips -->
      ${(() => {
        const tagCounts = {};
        allJobs.forEach(j => Array.isArray(j.tags) && j.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
        const used = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]);
        if (!used.length) return '';
        return `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">
          <span style="font-size:11px;color:#64748b;font-weight:600">🏷️ Tag:</span>
          <button data-sj-tag-filter="" style="padding:3px 10px;border-radius:12px;border:1px solid ${_sjTagFilter===null?'#0284c7':'#cbd5e1'};background:${_sjTagFilter===null?'#0284c7':'#fff'};color:${_sjTagFilter===null?'#fff':'#475569'};cursor:pointer;font-size:11px;font-weight:600">ทั้งหมด</button>
          ${used.map(([t,n]) => {
            const m = SERVICE_TAG_PRESETS.find(p => p.name === t) || { icon:"🏷️", color:"#64748b" };
            const active = _sjTagFilter === t;
            return `<button data-sj-tag-filter="${escHtml(t)}" style="padding:3px 10px;border-radius:12px;border:1px solid ${active?m.color:'#cbd5e1'};background:${active?m.color:'#fff'};color:${active?'#fff':m.color};cursor:pointer;font-size:11px;font-weight:600">${m.icon} ${escHtml(t)} <span style="opacity:.7">(${n})</span></button>`;
          }).join("")}
        </div>`;
      })()}
      ${jobs.length === 0 ? (
        _sjFilter === "all"
          ? renderEmpty({
              icon: "🛠️",
              title: "ยังไม่มีใบงาน",
              message: "เริ่มสร้างใบรับงานแรกเพื่อบันทึกงานช่าง — ระบบจะตัดสต็อกและสร้างใบเสร็จอัตโนมัติ",
              actionLabel: "+ เพิ่มงานช่าง",
              actionId: "emptyAddServiceJobBtn"
            })
          : renderEmpty({
              icon: _sjFilter === "open" ? "🎉" : _sjFilter === "closed" ? "📂" : "🗑️",
              title: _sjFilter === "open"      ? "ไม่มีงานค้าง — เคลียร์หมดแล้ว!"
                   : _sjFilter === "closed"   ? "ยังไม่มีงานที่ปิดแล้ว"
                   : "ไม่มีงานที่ยกเลิก",
              message: _sjFilter === "open" ? "งานทั้งหมดเสร็จเรียบร้อย ไม่มีงานคงค้างในระบบ" : "",
              actionLabel: _sjFilter !== "open" ? "ดูใบงานทั้งหมด" : "",
              actionId: "emptyShowAllJobsBtn",
              actionStyle: "ghost"
            })
      ) : ''}
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
              slipImgHtml = `<div style="margin-top:8px"><a href="${escHtml(slipUrl)}" target="_blank" title="ดูสลิป"><img src="${escHtml(slipUrl)}" style="max-width:80px;max-height:80px;border-radius:8px;border:2px solid #0284c7;object-fit:cover;cursor:pointer" onerror="this.style.display='none'" /></a>${slipStatus ? `<div style="font-size:11px;font-weight:700;color:#0284c7;margin-top:2px">${slipStatus}</div>` : ""}</div>`;
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
                    ${Array.isArray(j.tags) ? j.tags.map(t => renderTagBadge(t, SERVICE_TAG_PRESETS)).join("") : ""}
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
        }).join("") : (_sjFilter === "all" ? '<div class="card" style="text-align:center;color:var(--muted);padding:24px">ยังไม่มีงานช่าง</div>' : '')}
      </div>
    </div>

  `;

  /* ── Phase 39 — Filter chips ── */
  document.querySelectorAll("[data-sj-filter]").forEach(btn => btn.addEventListener("click", () => {
    _sjFilter = btn.dataset.sjFilter;
    renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute });
  }));

  /* ── Phase 68 (B3) — Tag filter chips ── */
  document.querySelectorAll("[data-sj-tag-filter]").forEach(btn => btn.addEventListener("click", () => {
    const t = btn.dataset.sjTagFilter;
    _sjTagFilter = t === "" ? null : t;
    renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute });
  }));

  /* ── Add job ── */
  document.getElementById("serviceJobAddBtn")?.addEventListener("click", () => openServiceJobDrawer());

  /* Phase 70 (D3): Export filtered jobs to Excel */
  document.getElementById("sjExportBtn")?.addEventListener("click", () => {
    const rows = jobs.map(j => ({
      "เลขที่งาน": j.job_no || ("#" + j.id),
      "วันที่รับ": (j.created_at || "").slice(0, 10),
      "ลูกค้า": j.customer_name || "",
      "เบอร์โทร": j.customer_phone || "",
      "ที่อยู่": j.customer_address || j.job_address || "",
      "ประเภทงาน": JOB_TYPE_LABELS[j.job_type] || j.job_type || "",
      "รายละเอียด": j.description || j.job_title || "",
      "สถานะ": STATUS_LABELS[j.status] || j.status || "",
      "Tags": Array.isArray(j.tags) ? j.tags.join(", ") : "",
      "นัดติดตั้ง": (j.scheduled_at || "").slice(0, 16).replace("T", " "),
      "หมายเหตุ": j.note || ""
    }));
    const ok = exportToExcel(`งานช่าง_${todaySuffix()}.xlsx`, rows, "ServiceJobs");
    if (ok) showToast(`ดาวน์โหลด ${rows.length} รายการแล้ว`);
  });

  /* ── Empty-state CTAs (Phase 46.1) ── */
  document.getElementById("emptyAddServiceJobBtn")?.addEventListener("click", () => openServiceJobDrawer());
  document.getElementById("emptyShowAllJobsBtn")?.addEventListener("click", () => {
    _sjFilter = "all";
    renderServiceJobsPage({ state, openServiceJobDrawer, showToast, showRoute });
  });

  /* ── Edit job ── */
  document.querySelectorAll("[data-job-id]").forEach(btn => btn.addEventListener("click", () => {
    const item = (state.serviceJobs || []).find(x => x.id === Number(btn.dataset.jobId));
    openServiceJobDrawer(item);
  }));

  /* ── Delete job (soft-delete: cancelled + [ลบแล้ว]) ── */
  document.querySelectorAll("[data-del-job]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const jobId = Number(btn.dataset.delJob);
    // ★ FIX: ป้องกัน NaN
    if (!jobId || isNaN(jobId)) { showToast?.("ไม่พบ ID งาน"); return; }
    const jobName = btn.dataset.delName || "";
    if (!(await window.App?.confirm?.(`ลบใบรับงาน "${jobName.trim()}" ?`))) return;

    btn.disabled = true;
    btn.textContent = "กำลังลบ...";

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");
    const updatePayload = { status: "cancelled", note: newNote };

    // ★ Safety timeout กัน hang
    const withTimeout = (p, ms, label) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timeout " + ms + "ms")), ms))
    ]);

    try {
      let success = false;

      // ★ วิธีที่ 1: Supabase JS client
      if (state.supabase) {
        try {
          const { data, error } = await withTimeout(
            state.supabase.from("service_jobs").update(updatePayload).eq("id", jobId).select(),
            15000, "Supabase update"
          );
          if (!error && data && data.length > 0) {
            success = true;
          } else {
            console.warn("[service_jobs delete] Supabase update failed:", error?.message || "0 rows — RLS blocked");
          }
        } catch (sbErr) {
          console.warn("[service_jobs delete] Supabase timeout/error:", sbErr.message);
        }
      }

      // ★ วิธีที่ 2: XHR PATCH (FIX: เช็คว่า function มีอยู่ก่อนเรียก)
      if (!success && typeof window._appXhrPatch === 'function') {
        try {
          const res = await withTimeout(window._appXhrPatch("service_jobs", updatePayload, "id", jobId), 15000, "XHR PATCH");
          if (res?.ok) success = true;
          else console.warn("[service_jobs delete] XHR PATCH failed:", res?.error?.message);
        } catch (patchErr) {
          console.warn("[service_jobs delete] XHR PATCH error:", patchErr.message);
        }
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
      console.error("[service_jobs delete] error:", err);
      if (showToast) showToast("❌ " + (err.message || "ลบไม่สำเร็จ"), "error");
    } finally {
      // ★ Safety: reset button เสมอ (กัน stuck "กำลังลบ...")
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "🗑️ ลบ";
      }
    }
  }));
}
