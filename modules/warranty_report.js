// ═══════════════════════════════════════════════════════════
//  WARRANTY REPORT (Phase 22)
//  รายงาน warranty ใกล้หมด + ส่ง LINE notify เตือนเจ้าของ
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

let _wrFilter = "soon"; // soon | expired | all | active
let _wrThreshold = 30;  // days
let _wrData = null;

export async function renderWarrantyReportPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-warranty_report");
  if (!container) return;

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + _wrThreshold * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8">กำลังโหลด...</div>`;

  try {
    const url = cfg.url + "/rest/v1/product_serials?select=*&order=warranty_until.asc.nullslast&limit=500";
    const res = await fetch(url, { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken } });
    if (!res.ok) {
      container.innerHTML = `
        <div style="max-width:800px;margin:40px auto;padding:24px;background:#fee2e2;border-radius:12px;text-align:center">
          <h3 style="color:#b91c1c">⚠️ ตาราง product_serials ยังไม่มี</h3>
          <p style="color:#991b1b">รัน <code>supabase-rls-policies.sql</code> ก่อน</p>
        </div>`;
      return;
    }
    _wrData = await res.json();
  } catch(e) {
    container.innerHTML = `<div style="color:#dc2626;text-align:center;padding:30px">โหลดไม่สำเร็จ: ${e.message}</div>`;
    return;
  }

  // Filter
  const all = _wrData || [];
  const expiringSoon = all.filter(s => s.status === "active" && s.warranty_until && s.warranty_until >= today && s.warranty_until <= future);
  const expired = all.filter(s => s.warranty_until && s.warranty_until < today);
  const active = all.filter(s => s.status === "active" && s.warranty_until && s.warranty_until > future);

  let view;
  if (_wrFilter === "soon") view = expiringSoon;
  else if (_wrFilter === "expired") view = expired;
  else if (_wrFilter === "active") view = active;
  else view = all;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fef3c7,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📊</div>
        <h2 style="margin:0 0 4px;color:#92400e">รายงาน Warranty</h2>
        <p style="margin:0;color:#075985;font-size:13px">เครื่องที่ประกันใกล้หมด • หมดแล้ว • ใช้งาน — ส่ง LINE เตือนเจ้าของ</p>
      </div>

      <!-- Stats -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #dc2626;cursor:pointer" data-filter="soon">
          <div class="stat-label">⚠️ ใกล้หมด (${_wrThreshold} วัน)</div>
          <div class="stat-value" style="color:#dc2626">${expiringSoon.length}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #94a3b8;cursor:pointer" data-filter="expired">
          <div class="stat-label">⏱️ หมดแล้ว</div>
          <div class="stat-value" style="color:#64748b">${expired.length}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981;cursor:pointer" data-filter="active">
          <div class="stat-label">✓ ใช้งาน (ปลอดภัย)</div>
          <div class="stat-value" style="color:#059669">${active.length}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7;cursor:pointer" data-filter="all">
          <div class="stat-label">📊 ทั้งหมด</div>
          <div class="stat-value" style="color:#0284c7">${all.length}</div>
        </div>
      </div>

      <!-- Settings + Action -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:700;font-size:13px">เตือนล่วงหน้า:</span>
        ${[15, 30, 60, 90].map(d => `
          <button class="wr-th-btn" data-d="${d}" style="padding:6px 12px;border-radius:14px;border:1px solid ${_wrThreshold===d?'#0284c7':'#cbd5e1'};background:${_wrThreshold===d?'#0284c7':'#fff'};color:${_wrThreshold===d?'#fff':'#475569'};cursor:pointer;font-size:12px">${d} วัน</button>
        `).join("")}
        <button id="wrSendLineBtn" style="margin-left:auto;padding:8px 14px;border:none;background:#10b981;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px">📲 ส่ง LINE เตือนเจ้าของ</button>
      </div>

      <!-- Filter title -->
      <div style="margin:0 0 8px;padding:10px 14px;background:#fff;border-radius:8px;font-size:13px;color:#475569">
        แสดง: <b>${_wrFilter === 'soon' ? `⚠️ ใกล้หมด ${_wrThreshold} วัน` : _wrFilter === 'expired' ? '⏱️ หมดแล้ว' : _wrFilter === 'active' ? '✓ ใช้งาน (ปลอดภัย)' : '📊 ทั้งหมด'}</b> — ${view.length} รายการ
      </div>

      <!-- List -->
      <div class="panel" style="padding:0">
        ${view.length === 0 ? `
          <div style="text-align:center;padding:40px;color:#94a3b8">
            <div style="font-size:40px;margin-bottom:8px">${_wrFilter === 'soon' ? '🎉' : '🔍'}</div>
            <div style="font-weight:600;font-size:14px">${_wrFilter === 'soon' ? 'ไม่มีเครื่องประกันใกล้หมด — ทุกอย่างปลอดภัย' : 'ไม่มีรายการ'}</div>
          </div>
        ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:10px;text-align:left">Serial No.</th>
                <th style="padding:10px;text-align:left">สินค้า</th>
                <th style="padding:10px;text-align:left">ลูกค้า</th>
                <th style="padding:10px;text-align:left">วันหมดประกัน</th>
                <th style="padding:10px;text-align:center">เหลือ</th>
              </tr>
            </thead>
            <tbody>
              ${view.map(s => {
                const daysLeft = s.warranty_until ? Math.floor((new Date(s.warranty_until).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)) : null;
                const wColor = daysLeft == null ? '#94a3b8' : daysLeft < 0 ? '#dc2626' : daysLeft <= 7 ? '#dc2626' : daysLeft <= 30 ? '#f59e0b' : '#10b981';
                const dayLabel = daysLeft == null ? '-' : daysLeft < 0 ? `หมดมา ${Math.abs(daysLeft)} วัน` : `อีก ${daysLeft} วัน`;
                return `
                  <tr style="border-bottom:1px solid #e5e7eb">
                    <td style="padding:10px;font-family:monospace;font-weight:700;color:#0c4a6e">${escHtml(s.serial_no)}</td>
                    <td style="padding:10px">${escHtml(s.product_name || '-')}</td>
                    <td style="padding:10px">${escHtml(s.customer_name || '-')}</td>
                    <td style="padding:10px;color:${wColor};font-weight:700">${s.warranty_until || '-'}</td>
                    <td style="padding:10px;text-align:center">
                      <span style="background:${wColor};color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700">${dayLabel}</span>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        `}
      </div>

      <div style="margin-top:14px;padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;font-size:12px;color:#075985;line-height:1.6">
        💡 <b>วิธีใช้:</b> กดที่กล่อง stats เพื่อ filter • เปลี่ยนระยะเตือนได้ • กด "📲 ส่ง LINE เตือนเจ้าของ" เพื่อสรุปส่งเข้ากลุ่ม LINE<br>
        🔔 <b>Tip:</b> ใช้รายชื่อนี้เป็น lead — ลูกค้าประกันใกล้หมด คือคนที่ใกล้ต้องซื้อใหม่ / ทำ service / ขายประกันต่อ
      </div>
    </div>
  `;

  // Events
  container.querySelectorAll(".stat-card[data-filter]").forEach(c => c.addEventListener("click", () => {
    _wrFilter = c.dataset.filter;
    renderWarrantyReportPage(ctx);
  }));
  container.querySelectorAll(".wr-th-btn").forEach(b => b.addEventListener("click", () => {
    _wrThreshold = Number(b.dataset.d);
    renderWarrantyReportPage(ctx);
  }));
  container.querySelector("#wrSendLineBtn")?.addEventListener("click", async () => {
    if (expiringSoon.length === 0 && expired.length === 0) {
      showToast?.("ไม่มีเครื่องที่ต้องเตือน 🎉");
      return;
    }
    try {
      const { sendLineNotify } = await import("./line_notify.js");
      let msg = `📊 รายงาน Warranty (${new Date().toLocaleDateString("th-TH")})\n\n`;
      if (expiringSoon.length > 0) {
        msg += `⚠️ ใกล้หมด ${_wrThreshold} วัน (${expiringSoon.length}):\n`;
        expiringSoon.slice(0, 10).forEach(s => {
          const daysLeft = Math.floor((new Date(s.warranty_until).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
          msg += `• ${s.product_name || '-'} | ${s.customer_name || '-'} | อีก ${daysLeft} วัน (${s.serial_no})\n`;
        });
        if (expiringSoon.length > 10) msg += `... และอีก ${expiringSoon.length - 10} เครื่อง\n`;
        msg += "\n";
      }
      if (expired.length > 0) {
        msg += `⏱️ หมดประกันแล้ว (${expired.length} — แสดง 5):\n`;
        expired.slice(0, 5).forEach(s => {
          msg += `• ${s.product_name || '-'} | ${s.customer_name || '-'} (${s.serial_no})\n`;
        });
      }
      msg += `\n💡 ลูกค้าเหล่านี้คือ lead — ติดต่อเสนอ service / ประกันต่อได้`;
      const r = await sendLineNotify(msg, ctx, "default");
      if (r?.ok) showToast?.("✓ ส่ง LINE เรียบร้อย");
      else showToast?.("ส่งไม่สำเร็จ: " + (r?.error || "ไม่ทราบสาเหตุ"));
    } catch(e) {
      showToast?.("ส่งไม่สำเร็จ: " + (e?.message || e));
    }
  });
}

// ═══════════════════════════════════════════════════════════
// Background check — เรียกตอน app load
// ═══════════════════════════════════════════════════════════
const LAST_CHECK_KEY = "bsk_warranty_last_check";

export async function checkWarrantyExpiringAndNotify(state) {
  // Check max 1 ครั้งต่อวัน
  const last = localStorage.getItem(LAST_CHECK_KEY);
  const today = new Date().toISOString().slice(0, 10);
  if (last === today) return;

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const url = cfg.url + `/rest/v1/product_serials?select=serial_no,product_name,customer_name,warranty_until&status=eq.active&warranty_until=gte.${today}&warranty_until=lte.${future}&order=warranty_until.asc&limit=20`;
    const r = await fetch(url, { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken } });
    if (!r.ok) return;
    const rows = await r.json();
    if (!rows || rows.length === 0) {
      localStorage.setItem(LAST_CHECK_KEY, today);
      return;
    }
    // เตือนเฉพาะถ้ามี ≥ 1 เครื่อง — ส่ง LINE
    let msg = `🔔 ประกันใกล้หมดใน 30 วัน (${rows.length} เครื่อง):\n\n`;
    rows.slice(0, 10).forEach(s => {
      const daysLeft = Math.floor((new Date(s.warranty_until).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
      msg += `• ${s.product_name || '-'} | ${s.customer_name || '-'} | อีก ${daysLeft} วัน\n`;
    });
    if (rows.length > 10) msg += `... และอีก ${rows.length - 10} เครื่อง\n`;
    msg += `\n👉 ดูทั้งหมดที่ "📊 รายงาน Warranty"`;

    const { sendLineNotify } = await import("./line_notify.js");
    await sendLineNotify(msg, { state, showToast: () => {} }, "default");
    localStorage.setItem(LAST_CHECK_KEY, today);
    console.log(`[warranty] เตือน ${rows.length} เครื่อง`);
  } catch(e) {
    console.warn("[warranty check] failed:", e?.message);
  }
}
