// ═══════════════════════════════════════════════════════════
//  tech_home.js — หน้าหลักช่าง (เวอร์ชัน "งานทั้งร้าน")
//  Phase 549 (build 549) — read-only landing สำหรับช่าง
//
//  ⚠️ READ-ONLY โดยเจตนา — หน้านี้ "อ่าน state อย่างเดียว" + นำทางไปหน้าเดิม
//     • ไม่มี POST / PATCH / DELETE / xhr ใด ๆ
//     • ไม่เรียกฟังก์ชันขยับสต็อก (_appApplyStockMovement / transfer_warehouse_stock / _atomic*)
//     • ไม่แตะบัญชี/การเงิน (journal / sales / receipts / credit)
//     ⇒ เพิ่มเข้าแอปได้โดยไม่กระทบคลัง/สินค้า/การเงิน (ดู tech_home_readonly_guard.test.js)
//
//  ข้อมูลทั้งหมดมาจาก state ที่ loadAllData โหลดไว้แล้ว:
//     state.serviceJobs · state.products · state.profile
//
//  🔜 สเตปถัดไป (คนละเฟส แยกชัด — ยังไม่ทำในไฟล์นี้; live system = risk ต่ำสุด):
//     1) กรอง "งานของฉัน" ด้วยคอลัมน์ service_jobs.assigned_to ที่มีอยู่แล้ว
//     2) BOM ต่อ job_type หรือ planned_parts → "อุปกรณ์ที่ต้องเบิก" แบบรวมต่องาน
//     3) ปุ่ม "รับงาน / เบิกจริง" → ต่อเข้าเส้นทางเขียนเดิมที่ปลอดภัย (service_jobs / stock_movements)
// ═══════════════════════════════════════════════════════════

import { escHtml, todayBkk, dateBkk } from "./utils.js";

// ── ป้ายชนิดงาน (ตรงกับ serviceType options ใน index.html) ──
const JOB_TYPE = {
  ac:            { e: "🏗️", t: "ติดตั้งแอร์" },
  repair_ac:     { e: "🔧", t: "ซ่อมแอร์" },
  clean_ac:      { e: "🧼", t: "ล้างแอร์" },
  move_ac:       { e: "📦", t: "ย้ายแอร์" },
  repair_fridge: { e: "❄️", t: "ซ่อมตู้เย็น" },
  repair_washer: { e: "🧺", t: "ซ่อมเครื่องซักผ้า" },
  repair_tv:     { e: "📺", t: "ซ่อมทีวี" },
  cctv:          { e: "📷", t: "CCTV" },
  satellite:     { e: "📡", t: "จานดาวเทียม" },
  solar:         { e: "☀️", t: "โซลาร์เซลล์" },
  other:         { e: "🔨", t: "งานอื่นๆ" },
};
function jobType(j) { return JOB_TYPE[j.job_type] || { e: "🔧", t: escHtml(j.job_type || "งานช่าง") }; }

// ── ป้ายสถานะ (DB statuses; pending_review = pseudo) ──
const STATUS = {
  pending:        { t: "รอเริ่ม",     bg: "#fef3c7", fg: "#b45309", dot: "#f59e0b" },
  progress:       { t: "กำลังทำ",     bg: "#e0f2fe", fg: "#0369a1", dot: "#0284c7" },
  done:           { t: "เสร็จแล้ว",   bg: "#dcfce7", fg: "#166534", dot: "#10b981" },
  delivered:      { t: "ส่งมอบแล้ว",  bg: "#ede9fe", fg: "#6d28d9", dot: "#6366f1" },
  closed:         { t: "ปิดงาน",      bg: "#dcfce7", fg: "#166534", dot: "#7c3aed" },
  pending_review: { t: "รออนุมัติ",   bg: "#faf5ff", fg: "#7e22ce", dot: "#a855f7" },
  cancelled:      { t: "ยกเลิก",      bg: "#fee2e2", fg: "#b91c1c", dot: "#ef4444" },
};
function jobStatus(j) { return STATUS[j.status] || STATUS.pending; }

// ── pure helpers (ทดสอบได้ · ไม่แตะ DOM/DB) ──
const _isActiveJob = (j) => !((j.note || "").includes("[ลบแล้ว]")) && j.status !== "cancelled";
// ★ Phase 549 fix: คอลัมน์จริง = service_jobs.scheduled_date (DATE-only "YYYY-MM-DD" เขตเวลาไทย) —
//   ไม่ใช่ scheduled_at/due_date (ไม่มีจริง). ถ้าไม่มีวันนัด → fallback วันที่สร้าง (dateBkk).
const _jobDay = (j) => (j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : dateBkk(j.created_at));

export function shopJobsForDay(serviceJobs, day) {
  return (Array.isArray(serviceJobs) ? serviceJobs : [])
    .filter(_isActiveJob)
    .filter((j) => _jobDay(j) === day)
    .sort((a, b) => String(a.scheduled_date || a.created_at || "").localeCompare(String(b.scheduled_date || b.created_at || "")));
}

// ★ Phase 549 (owner): โฟกัส "สต็อกในรถ 2 คัน" (คันขาว/คันแดง = warehouse is_mobile) — โชว์ของที่
//   "เหลือน้อยสุด" ในแต่ละคัน ให้ช่างเติมกันขาดหน้างาน. ไม่ดูสต็อกรวมในร้าน (ไม่ใช่หน้าที่ช่าง).
//   READ-ONLY จาก state.warehouseStock (loadAllData โหลดครบ) + state.warehouses + state.products.
//   ⚠️ data reality: truck warehouse_stock มี phantom 0-row (สร้างพร้อมสินค้า) + ยังไม่ตั้ง min_stock(par) →
//      กรอง stock>0 (เอาเฉพาะของที่รถ "มีจริง") + เรียงน้อยสุด. ของที่ stock<=LOW_THRESHOLD = ควรเติม.
export const TRUCK_LOW_THRESHOLD = 3;
function _prodName(products, id) { const p = (products || []).find((x) => String(x.id) === String(id)); return p ? p.name : ("#" + id); }
export function truckLowStock(warehouseStock, warehouses, products, limit = 12) {
  const trucks = (Array.isArray(warehouses) ? warehouses : []).filter((w) => w.is_mobile);
  return trucks.map((t) => {
    const items = (Array.isArray(warehouseStock) ? warehouseStock : [])
      .filter((s) => String(s.warehouse_id) === String(t.id) && Number(s.stock || 0) > 0)  // ตัด phantom 0-row
      .map((s) => ({ product_id: s.product_id, name: _prodName(products, s.product_id), stock: Number(s.stock || 0) }))
      .sort((a, b) => a.stock - b.stock)  // เหลือน้อยก่อน
      .slice(0, limit);
    return { id: t.id, name: t.name, items, lowCount: items.filter((it) => it.stock <= TRUCK_LOW_THRESHOLD).length };
  });
}

// ═══ RENDER (read-only) ═══
export function renderTechHome(ctx) {
  const { state, showRoute } = ctx;
  const today = todayBkk();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dateBkk(d); })();

  const todayJobs = shopJobsForDay(state.serviceJobs, today);
  const tomorrowJobs = shopJobsForDay(state.serviceJobs, tomorrow);
  const trucks = truckLowStock(state.warehouseStock, state.warehouses, state.products);
  const needRefill = trucks.reduce((n, t) => n + t.lowCount, 0);   // ของเหลือน้อย (≤ TRUCK_LOW_THRESHOLD)

  const doneCount = todayJobs.filter((j) => ["done", "delivered", "closed"].includes(j.status)).length;
  const techName = escHtml((state.profile?.full_name || "").trim() || "ช่าง");

  // ── STAT TILES (นับจาก state ตรง ๆ) ──
  const stats = [
    { icon: "📋", bg: "#e0f2fe", fg: "#0369a1", label: "งานวันนี้ (ทั้งร้าน)", value: String(todayJobs.length) },
    { icon: "✅", bg: "#d1fae5", fg: "#047857", label: "เสร็จแล้ว", value: `${doneCount} / ${todayJobs.length}` },
    { icon: "🚚", bg: "#fef3c7", fg: "#b45309", label: "ของต้องเติมในรถ", value: String(needRefill) },
    { icon: "📅", bg: "#ede9fe", fg: "#6d28d9", label: "งานพรุ่งนี้", value: String(tomorrowJobs.length) },
  ];

  const statTilesHtml = stats.map((s) => `
    <div class="kpi-card kpi-tile">
      <span class="kpi-tile-ic" style="background:${s.bg};color:${s.fg}">${s.icon}</span>
      <div class="kpi-label">${s.label}</div>
      <div class="kpi-value">${s.value}</div>
    </div>`).join("");

  const jobRow = (j) => {
    const jt = jobType(j), st = jobStatus(j);
    return `
      <div style="position:relative;padding-bottom:16px">
        <span style="position:absolute;left:-22px;top:4px;width:12px;height:12px;border-radius:50%;background:${st.dot};border:2px solid #fff;box-shadow:0 0 0 2px ${st.dot}"></span>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#e0f2fe;color:#0369a1">${jt.e} ${jt.t}</span>
              </div>
              <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:5px">${escHtml(j.customer_name || "ไม่ระบุลูกค้า")}</div>
              ${j.customer_address ? `<div style="font-size:12px;color:#64748b;margin-top:2px">📍 ${escHtml(j.customer_address)}</div>` : ""}
            </div>
            <span style="font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;background:${st.bg};color:${st.fg};white-space:nowrap;flex-shrink:0">${st.t}</span>
          </div>
          ${j.description ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0;font-size:12px;color:#475569">${escHtml(j.description)}</div>` : ""}
          <!-- 🔜 สเตปถัดไป: ป้ายช่างผู้รับผิดชอบ + ปุ่ม "รับงาน" (แยกเฟส — ใช้ assigned_to ที่มีอยู่) -->
        </div>
      </div>`;
  };

  const jobsHtml = todayJobs.length
    ? `<div style="position:relative;padding-left:22px"><div style="position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:#e2e8f0"></div>${todayJobs.map(jobRow).join("")}</div>`
    : `<div style="text-align:center;padding:28px;color:#94a3b8;font-size:13px">วันนี้ยังไม่มีงานช่าง</div>`;

  // นำทางไปหน้าคลังรถให้ตรงคัน (คันแดง→wh_kundaeng, อื่น=คันขาว→wh_kunkhao) — read-only nav ไปหน้าคลังรถเดิม
  const _truckRoute = (name) => name.includes("แดง") ? "wh_kundaeng" : "wh_kunkhao";
  const trucksHtml = trucks.map((t) => {
    const head = `<div class="row" style="margin-bottom:6px"><h3 style="margin:0;font-size:14px">🚐 ${escHtml(t.name)} <span class="muted" style="font-weight:400;font-size:11px">เหลือน้อย ${t.lowCount}</span></h3>${t.items.length ? `<button class="btn light" style="font-size:11px;padding:3px 8px" data-go="${_truckRoute(t.name)}">ดูคลังรถ →</button>` : `<span style="font-size:12px;color:#94a3b8">ไม่มีของในรถ</span>`}</div>`;
    const body = t.items.map((it) => {
      const color = it.stock <= 1 ? "#dc2626" : (it.stock <= TRUCK_LOW_THRESHOLD ? "#f59e0b" : "#64748b");
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#f8fafc;border-radius:8px;font-size:12px">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(it.name)}</div>
        <div style="font-weight:800;margin-left:8px;color:${color}">เหลือ ${it.stock}</div>
      </div>`;
    }).join("");
    return `<div style="margin-bottom:14px">${head}<div style="display:flex;flex-direction:column;gap:4px">${body}</div></div>`;
  }).join("") || `<div style="text-align:center;padding:20px;color:#64748b;font-size:12px">ไม่พบคลังรถ (is_mobile)</div>`;

  const tomorrowHtml = tomorrowJobs.length
    ? tomorrowJobs.map((j) => {
        const jt = jobType(j);
        return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(148,163,184,.12)">
          <div style="min-width:0"><div style="font-size:13px;font-weight:700;color:#e2e8f0">${jt.e} ${escHtml(j.customer_name || "—")}</div>${j.description ? `<div style="font-size:11px;color:#7a8ba3;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.description)}</div>` : ""}</div>
        </div>`;
      }).join("")
    : `<div style="color:#7a8ba3;font-size:12px">พรุ่งนี้ยังไม่มีนัดงาน</div>`;

  document.getElementById("page-tech_home").innerHTML = `
    <!-- แจ้ง: เวอร์ชันงานทั้งร้าน (interim) -->
    <div style="display:flex;align-items:center;gap:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 14px">
      <span style="font-size:16px">💡</span>
      <div style="font-size:12px;color:#92400e;line-height:1.5">เวอร์ชัน <b>"งานทั้งร้าน"</b> — ช่างทุกคนเห็นงานเดียวกัน · เฟสถัดไปเพิ่ม "มอบหมายช่างรายคน" แล้วจะกรองเป็น <b>งานของฉัน</b> ได้</div>
    </div>

    <!-- ทักทายเช้า -->
    <div class="dash-today dash-today--brand">
      <div class="dash-today-main">
        <div class="dash-today-label">สวัสดี, ${techName}</div>
        <div class="dash-today-amount" style="font-size:26px">วันนี้ร้านมี ${todayJobs.length} งาน</div>
        <div class="dash-today-sub">ของในรถต้องเติม ${needRefill} รายการ · เช็กคันขาว/คันแดงก่อนออกงาน</div>
      </div>
      <button class="btn light" data-go="calendar">🗺️ ดูปฏิทินงาน</button>
    </div>

    <!-- สรุป -->
    <div class="kpi-grid">${statTilesHtml}</div>

    <!-- งานช่างวันนี้ · ทั้งร้าน + ของใกล้หมด -->
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px" class="tech-home-grid">
      <div class="panel">
        <div class="row"><h3 style="margin:0">📋 งานช่างวันนี้ · ทั้งร้าน</h3><span class="muted" style="font-size:12px">${todayJobs.length} งาน · เสร็จ ${doneCount}</span></div>
        <div style="margin-top:12px">${jobsHtml}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="panel" style="border-left:4px solid ${needRefill ? "#ef4444" : "#10b981"}">
          <div class="row"><h3 style="margin:0;font-size:15px">🚚 สต็อกในรถ · เติมก่อนออกงาน</h3></div>
          <div class="muted" style="font-size:11px;margin:2px 0 10px">รถคันขาว/คันแดง — ของที่เหลือน้อยสุด (เรียงน้อย→มาก) เช็กเติมกันขาด</div>
          <div style="max-height:320px;overflow-y:auto">${trucksHtml}</div>
        </div>

        <div style="background:#0f172a;border-radius:20px;padding:18px;color:#e2e8f0">
          <h3 style="margin:0 0 4px 0;font-size:15px;font-weight:800;color:#f1f5f9">📅 งานพรุ่งนี้ · ทั้งร้าน</h3>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:14px">เตรียมของไว้ล่วงหน้าได้เลย</div>
          ${tomorrowHtml}
        </div>
      </div>
    </div>`;

  // ═══ BINDINGS — นำทางอย่างเดียว (ไม่มีการเขียนข้อมูล) ═══
  document.querySelectorAll("#page-tech_home [data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.go;
      if (target) showRoute(target);
    });
  });
}
