// ═══════════════════════════════════════════════════════════
//  BIRTHDAY GREETING (Phase 15)
//  ดูวันเกิดลูกค้า + Line Notify ตอนเปิดแอปเช้า
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const THAI_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

let _bdMonthFilter = (new Date().getMonth() + 1); // default = current month

export function renderBirthdaysPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-birthdays");
  if (!container) return;

  const today = new Date();
  const todayMD = String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');

  const customers = (state.customers || []).filter(c => c.birthday);

  // วันเกิดวันนี้
  const todayBdays = customers.filter(c => String(c.birthday || "").slice(5,10) === todayMD);

  // วันเกิดเดือนที่เลือก (เรียงตามวัน)
  const monthBdays = customers.filter(c => {
    const m = parseInt(String(c.birthday || "").slice(5,7), 10);
    return m === _bdMonthFilter;
  }).sort((a, b) => String(a.birthday).slice(8,10).localeCompare(String(b.birthday).slice(8,10)));

  // Stats
  const total = customers.length;
  const thisMonth = customers.filter(c => parseInt(String(c.birthday || "").slice(5,7),10) === today.getMonth()+1).length;

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fce7f3,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🎂</div>
        <h2 style="margin:0 0 4px;color:#9d174d">วันเกิดลูกค้า (Birthday)</h2>
        <p style="margin:0;color:#92400e;font-size:13px">ดูวันเกิดลูกค้า • อวยพร LINE • สร้างความสัมพันธ์</p>
      </div>

      ${todayBdays.length > 0 ? `
        <div class="panel" style="padding:16px;margin-bottom:14px;background:linear-gradient(135deg,#fef3c7,#fce7f3);border:2px solid #f59e0b">
          <h3 style="margin:0 0 10px;color:#92400e">🎉 วันนี้ ${todayBdays.length} ท่านเกิด!</h3>
          <div style="display:grid;gap:8px">
            ${todayBdays.map(c => `
              <div style="background:#fff;padding:10px 14px;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-size:22px">🎂</div>
                <div style="flex:1;min-width:160px">
                  <div style="font-weight:700">${escHtml(c.name)}</div>
                  <div style="font-size:12px;color:#64748b">${escHtml(c.phone || '')}</div>
                </div>
                <button class="bd-greet-btn" data-cid="${c.id}" style="border:none;background:#dc2626;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px">📲 ส่ง LINE อวยพร</button>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ''}

      <!-- Stats -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #ec4899">
          <div class="stat-label">🎂 วันเกิดวันนี้</div>
          <div class="stat-value" style="color:#be185d">${todayBdays.length}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">📅 เกิดเดือนนี้</div>
          <div class="stat-value" style="color:#92400e">${thisMonth}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">👥 ลูกค้าที่บันทึกวันเกิด</div>
          <div class="stat-value" style="color:#0284c7">${total}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">จาก ${(state.customers || []).length} คน</div>
        </div>
      </div>

      <!-- Month filter -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">📅 เลือกเดือน:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${THAI_MONTHS_SHORT.map((m, idx) => {
            const month = idx + 1;
            const count = customers.filter(c => parseInt(String(c.birthday || "").slice(5,7),10) === month).length;
            return `<button class="bd-month-btn" data-m="${month}" style="padding:6px 12px;border-radius:14px;border:1px solid ${_bdMonthFilter===month?'#ec4899':'#cbd5e1'};background:${_bdMonthFilter===month?'#ec4899':'#fff'};color:${_bdMonthFilter===month?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${m}${count>0?` (${count})`:''}</button>`;
          }).join("")}
        </div>
      </div>

      <!-- Month list -->
      <div class="panel" style="padding:14px">
        <h3 style="margin:0 0 10px;font-size:15px">🎈 ${THAI_MONTHS[_bdMonthFilter-1]} (${monthBdays.length} ท่าน)</h3>
        ${monthBdays.length === 0 ? `<div style="text-align:center;padding:30px;color:#94a3b8">ไม่มีลูกค้าวันเกิดในเดือนนี้</div>` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">
          ${monthBdays.map(c => {
            const day = parseInt(String(c.birthday).slice(8,10), 10);
            const bdayThisYear = String(today.getFullYear()) + "-" + String(_bdMonthFilter).padStart(2,'0') + "-" + String(day).padStart(2,'0');
            const bdayDate = new Date(bdayThisYear);
            const daysUntil = Math.ceil((bdayDate - today) / (1000*60*60*24));
            const isToday = daysUntil === 0;
            const isSoon = daysUntil > 0 && daysUntil <= 7;
            return `
              <div style="border:1px solid ${isToday?'#f59e0b':isSoon?'#0284c7':'#e5e7eb'};border-radius:10px;padding:10px;background:${isToday?'#fef3c7':isSoon?'#dbeafe':'#fff'}">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="font-size:24px;width:36px;text-align:center">${isToday?'🎂':isSoon?'🎈':'📅'}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:700">${escHtml(c.name)}</div>
                    <div style="font-size:11px;color:#64748b">${escHtml(c.phone || '')}</div>
                  </div>
                  <div style="text-align:right;font-weight:700;color:${isToday?'#dc2626':isSoon?'#0284c7':'#64748b'}">
                    <div style="font-size:18px">${day}</div>
                    <div style="font-size:10px">${THAI_MONTHS_SHORT[_bdMonthFilter-1]}</div>
                  </div>
                </div>
                ${isToday ? '<div style="text-align:center;margin-top:6px;padding:4px;background:#dc2626;color:#fff;border-radius:6px;font-size:11px;font-weight:700">🎉 วันนี้!</div>' :
                  isSoon ? `<div style="text-align:center;margin-top:6px;padding:4px;background:#0284c7;color:#fff;border-radius:6px;font-size:11px;font-weight:700">อีก ${daysUntil} วัน</div>` : ''}
                ${(isToday || isSoon) ? `<button class="bd-greet-btn" data-cid="${c.id}" style="width:100%;margin-top:6px;border:none;background:#ec4899;color:#fff;padding:6px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px">📲 ส่ง LINE อวยพร</button>` : ''}
              </div>
            `;
          }).join("")}
        </div>
        `}
      </div>

      <!-- Help -->
      <div style="margin-top:14px;padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;font-size:12px;color:#075985;line-height:1.6">
        💡 <b>วิธีบันทึกวันเกิดลูกค้า:</b> เปิดข้อมูลลูกค้า → กรอกช่อง "วันเกิด" → บันทึก<br>
        🔔 ระบบจะแจ้งเตือนทุกเช้าเมื่อมีลูกค้าวันเกิดวันนั้น (ผ่าน Line Notify ถ้าเปิดไว้)
      </div>
    </div>
  `;

  container.querySelectorAll(".bd-month-btn").forEach(btn => btn.addEventListener("click", () => {
    _bdMonthFilter = Number(btn.dataset.m);
    renderBirthdaysPage(ctx);
  }));

  container.querySelectorAll(".bd-greet-btn").forEach(btn => btn.addEventListener("click", () => {
    const cid = btn.dataset.cid;
    const cust = (state.customers || []).find(c => String(c.id) === String(cid));
    if (cust) sendBirthdayGreeting(cust, ctx);
  }));
}

async function sendBirthdayGreeting(customer, ctx) {
  const storeName = ctx.state.storeInfo?.name || "บุญสุขอิเล็กทรอนิกส์";
  const message = `🎂 สุขสันต์วันเกิด คุณ${customer.name} 🎉\n\nขอให้สุขภาพแข็งแรง\nร่ำรวยตลอดปี ✨\n\nรับส่วนลดพิเศษ 5% ทุกบิลตลอดเดือนเกิด\n— ${storeName}`;

  try {
    const { sendLineNotify } = await import("./line_notify.js");
    const r = await sendLineNotify(message, { state: ctx.state, showToast: ctx.showToast }, "default");
    if (r?.ok) {
      ctx.showToast?.(`✓ ส่ง LINE อวยพร ${customer.name} แล้ว`);
    } else if (r?.skipped) {
      ctx.showToast?.("⚠️ Line Notify ปิดอยู่ — เปิดในตั้งค่าก่อน");
    } else {
      ctx.showToast?.("ส่งไม่สำเร็จ — ลองใหม่อีกครั้ง");
    }
  } catch (e) {
    ctx.showToast?.("ผิดพลาด: " + (e?.message || e));
  }
}

// ★ Background check — เรียกตอน app load
export async function checkTodayBirthdaysAndNotify(state) {
  if (!state?.lineNotifySettings?.is_active) return;
  const today = new Date();
  const todayMD = String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
  const todayBdays = (state.customers || []).filter(c => String(c.birthday || "").slice(5,10) === todayMD);
  if (todayBdays.length === 0) return;

  // เช็ค localStorage ว่าวันนี้ส่งแล้วยัง (กันส่งซ้ำเปิดแอปหลายครั้ง)
  const todayKey = today.toISOString().slice(0, 10);
  const lastNotifyKey = `bsk_bday_notified_${todayKey}`;
  if (localStorage.getItem(lastNotifyKey)) return;

  const lines = [`🎂 วันนี้มีลูกค้าวันเกิด ${todayBdays.length} ท่าน:`];
  todayBdays.forEach(c => {
    lines.push(`• ${c.name}${c.phone ? ` (${c.phone})` : ''}`);
  });
  lines.push("\n💡 เข้าหน้า ลูกค้า → 🎂 วันเกิดลูกค้า เพื่อส่งอวยพรได้เลย");
  const msg = lines.join("\n");

  try {
    const { sendLineNotify } = await import("./line_notify.js");
    await sendLineNotify(msg, { state, showToast: () => {} }, "default");
    localStorage.setItem(lastNotifyKey, "1");
  } catch(e) { console.warn("[bday notify]", e); }
}
