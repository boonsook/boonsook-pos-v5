// ═══════════════════════════════════════════════════════════
//  DEAD STOCK REPORT — สินค้าที่ไม่ขยับนาน
//  ช่วยตัดสินใจ: ลดราคาล้างสต็อก / คืนซัพพลายเออร์
//  Phase 47 — adopt ui_states empty
// ═══════════════════════════════════════════════════════════
import { renderEmpty } from "./ui_states.js";

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

// State สำหรับเลือกช่วงวัน
let _deadStockDays = 90;

export function renderDeadStockPage(ctx) {
  const { state, showToast, openProductDrawer } = ctx;
  const container = document.getElementById("page-dead_stock");
  if (!container) return;

  const days = _deadStockDays;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffKey = cutoffDate.toISOString().slice(0, 10);

  // เฉพาะสินค้านับสต็อกที่มีของอยู่
  const stockProducts = (state.products || []).filter(p => {
    const t = p.product_type;
    return t !== "service" && t !== "non_stock" && Number(p.stock || 0) > 0;
  });

  // หา product_id ที่ขายภายในช่วง
  const recentSales = (state.sales || []).filter(s =>
    !(s.note || "").includes("[ลบแล้ว]") &&
    String(s.created_at || "").slice(0, 10) >= cutoffKey
  );
  const recentSaleIds = new Set(recentSales.map(s => String(s.id)));
  const soldProductIds = new Set(
    (state.saleItems || [])
      .filter(it => recentSaleIds.has(String(it.sale_id)))
      .map(it => String(it.product_id))
  );

  // ★ หา last sale date ของแต่ละสินค้า
  const lastSaleMap = new Map();
  (state.saleItems || []).forEach(it => {
    if (!it.product_id) return;
    const sale = (state.sales || []).find(s => String(s.id) === String(it.sale_id));
    if (!sale || (sale.note || "").includes("[ลบแล้ว]")) return;
    const d = String(sale.created_at || "").slice(0, 10);
    const prev = lastSaleMap.get(String(it.product_id));
    if (!prev || d > prev) lastSaleMap.set(String(it.product_id), d);
  });

  // Dead = มีสต็อก > 0 + ไม่มีการขายในช่วง
  const dead = stockProducts.filter(p => !soldProductIds.has(String(p.id)));
  // คำนวณ days since last sale (หรือ "ไม่เคยขาย")
  const enriched = dead.map(p => {
    const lastSale = lastSaleMap.get(String(p.id));
    let daysSince = null;
    if (lastSale) {
      const diffMs = Date.now() - new Date(lastSale).getTime();
      daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }
    const stock = Number(p.stock || 0);
    const cost = Number(p.cost || 0);
    const value = stock * cost;
    return { ...p, lastSale, daysSince, value };
  }).sort((a, b) => b.value - a.value);

  const totalValue = enriched.reduce((s, p) => s + p.value, 0);
  const neverSoldCount = enriched.filter(p => !p.lastSale).length;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:24px 16px;margin-bottom:20px;background:linear-gradient(135deg,#fee2e2,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🐌</div>
        <h2 style="margin:0 0 4px;color:#b91c1c">รายงานสต็อกค้างนาน (Dead Stock)</h2>
        <p style="margin:0;color:#92400e;font-size:14px">สินค้าที่ไม่ขยับนาน — ตัดสินใจล้างสต็อก / คืนซัพพลายเออร์</p>
      </div>

      <!-- Period Selector -->
      <div class="panel" style="padding:14px;margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600">ไม่ขายมาตั้งแต่:</span>
        ${[30, 60, 90, 180, 365].map(d => `
          <button class="ds-period-btn" data-days="${d}" style="padding:6px 14px;border-radius:20px;border:1px solid ${days===d?'#b91c1c':'#cbd5e1'};background:${days===d?'#b91c1c':'#fff'};color:${days===d?'#fff':'#475569'};cursor:pointer;font-size:13px;font-weight:600">
            ${d} วัน
          </button>
        `).join("")}
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">🐌 สินค้า Dead Stock</div>
          <div class="stat-value" style="color:#b91c1c">${enriched.length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">ไม่เคยขายเลย: ${neverSoldCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">💸 มูลค่าทุนค้าง</div>
          <div class="stat-value" style="color:#92400e;font-size:22px">฿${moneyShort(totalValue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${money(totalValue)} บาท</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📊 % ของสต็อกทั้งหมด</div>
          <div class="stat-value" style="color:#0284c7">${stockProducts.length > 0 ? ((enriched.length/stockProducts.length)*100).toFixed(1) : 0}%</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${enriched.length} จาก ${stockProducts.length} สินค้านับสต็อก</div>
        </div>
      </div>

      <!-- Export -->
      <div style="display:flex;gap:8px;margin-bottom:12px;justify-content:flex-end">
        <button id="dsExportBtn" class="btn light" style="font-size:13px">📥 ส่งออก Excel</button>
      </div>

      <!-- Dead Stock List -->
      <div class="panel" style="padding:16px">
        ${enriched.length === 0 ? renderEmpty({
          icon: "🎉",
          title: "ไม่มีสต็อกค้างนาน!",
          message: "ทุกสินค้าขยับขายในช่วง " + days + " วันที่ผ่านมา"
        }) : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:left">สินค้า</th>
                <th style="padding:8px;text-align:left">หมวด</th>
                <th style="padding:8px;text-align:right">สต็อก</th>
                <th style="padding:8px;text-align:right">ต้นทุน/ชิ้น</th>
                <th style="padding:8px;text-align:right;color:#b91c1c">มูลค่าค้าง</th>
                <th style="padding:8px;text-align:left">ขายล่าสุด</th>
                <th style="padding:8px"></th>
              </tr>
            </thead>
            <tbody>
              ${enriched.slice(0, 200).map(p => `
                <tr style="border-bottom:1px solid #e5e7eb">
                  <td style="padding:8px">
                    <div style="font-weight:600">${escHtml(p.name || "-")}</div>
                    <div style="font-size:11px;color:#64748b">${escHtml(p.sku || "")}</div>
                  </td>
                  <td style="padding:8px;color:#64748b">${escHtml(p.category || "-")}</td>
                  <td style="padding:8px;text-align:right">${Number(p.stock).toLocaleString("th-TH")}</td>
                  <td style="padding:8px;text-align:right">฿${money(p.cost || 0)}</td>
                  <td style="padding:8px;text-align:right;color:#b91c1c;font-weight:700">฿${money(p.value)}</td>
                  <td style="padding:8px;font-size:12px;color:${p.lastSale ? '#475569' : '#dc2626'};font-weight:${p.lastSale ? '500' : '700'}">
                    ${p.lastSale ? `${p.lastSale} (${p.daysSince} วัน)` : '⚠️ ไม่เคยขาย'}
                  </td>
                  <td style="padding:8px;text-align:right">
                    <button class="ds-edit-btn" data-pid="${escHtml(p.id)}" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:12px">แก้ไข</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          ${enriched.length > 200 ? `<div style="text-align:center;color:#64748b;font-size:12px;padding:10px">+ อีก ${enriched.length - 200} รายการ — ดาวน์โหลด Excel เพื่อดูทั้งหมด</div>` : ''}
        </div>
        `}
      </div>
    </div>
  `;

  // Period buttons
  container.querySelectorAll(".ds-period-btn").forEach(btn => btn.addEventListener("click", () => {
    _deadStockDays = Number(btn.dataset.days);
    renderDeadStockPage(ctx);
  }));

  // Edit product
  container.querySelectorAll(".ds-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const pid = btn.dataset.pid;
    const prod = (state.products || []).find(x => String(x.id) === String(pid));
    if (prod && openProductDrawer) openProductDrawer(prod);
  }));

  // Export
  container.querySelector("#dsExportBtn")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") { showToast?.("ระบบ Excel ยังไม่พร้อม"); return; }
    const sheet = XLSX.utils.json_to_sheet(enriched.map(p => ({
      "ชื่อสินค้า": p.name || "",
      "SKU": p.sku || "",
      "หมวดหมู่": p.category || "",
      "สต็อก": Number(p.stock || 0),
      "ต้นทุน/ชิ้น": Number(p.cost || 0),
      "ราคาขาย/ชิ้น": Number(p.price || 0),
      "มูลค่าค้าง": Number(p.value.toFixed(2)),
      "ขายล่าสุด": p.lastSale || "ไม่เคยขาย",
      "วันที่ไม่ขาย": p.daysSince ?? "ไม่เคยขาย"
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, `Dead Stock ${days}d`);
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `รายงานสต็อกค้าง_${days}วัน_${date}.xlsx`);
    showToast?.("ส่งออก Excel สำเร็จ");
  });
}
