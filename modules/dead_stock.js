// ═══════════════════════════════════════════════════════════
//  DEAD STOCK REPORT — สินค้าที่ไม่ขยับนาน
//  ช่วยตัดสินใจ: ลดราคาล้างสต็อก / คืนซัพพลายเออร์
//  Phase 47 — adopt ui_states empty
//  Phase 478 — คิด "ขายในช่วง" จากการขายจริง (stock_movements type=sale) ทั้งช่วง
//    เดิมอ่าน field saleItems บน state ที่ไม่เคยถูกโหลด (+ sales cap 50) → ตีว่าทุกสินค้าที่มีสต็อก = ค้าง
//    (รายงานเพี้ยนทั้งหน้า). ตอนนี้ fetch สด ตาม cutoff, paginate ครบ, error ชัด (ไม่ fallback "ทุกตัว dead")
// ═══════════════════════════════════════════════════════════
import { renderEmpty } from "./ui_states.js";

import { escHtml } from "./utils.js";
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

// ── pure helpers (unit-testable) ─────────────────────────────────────────────
// สร้างดัชนีการขายจากแถว stock_movements (type=sale) — soldSet = product ที่ขายในช่วง,
// lastSaleMap = วันที่ขายล่าสุด (YYYY-MM-DD) ต่อ product ในช่วงที่ fetch มา
export function indexSaleMovements(rows) {
  const soldSet = new Set();
  const lastSaleMap = new Map();
  for (const m of (Array.isArray(rows) ? rows : [])) {
    if (m == null || m.product_id == null) continue;
    const pid = String(m.product_id);
    soldSet.add(pid);
    const d = String(m.created_at || "").slice(0, 10);
    if (!d) continue;
    const prev = lastSaleMap.get(pid);
    if (!prev || d > prev) lastSaleMap.set(pid, d);
  }
  return { soldSet, lastSaleMap };
}

// คิดรายการ dead จากสินค้า + ดัชนีการขาย (pure — รับ nowMs เพื่อ deterministic test)
//   dead = สินค้านับสต็อก (ไม่ใช่ service/non_stock) + stock>0 + ไม่อยู่ใน soldSet (ไม่ขายในช่วง)
export function computeDeadStock({ products, soldSet, lastSaleMap, nowMs }) {
  const sold = soldSet instanceof Set ? soldSet : new Set(soldSet || []);
  const lastMap = lastSaleMap instanceof Map ? lastSaleMap : new Map(Object.entries(lastSaleMap || {}));
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const stockProducts = (products || []).filter(p => {
    const t = p.product_type;
    return t !== "service" && t !== "non_stock" && Number(p.stock || 0) > 0;
  });
  const dead = stockProducts.filter(p => !sold.has(String(p.id)));
  const enriched = dead.map(p => {
    const lastSale = lastMap.get(String(p.id)) || null;
    let daysSince = null;
    if (lastSale) {
      const diffMs = now - new Date(lastSale).getTime();
      daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }
    const stock = Number(p.stock || 0);
    const cost = Number(p.cost || 0);
    return { ...p, lastSale, daysSince, value: stock * cost };
  }).sort((a, b) => b.value - a.value);
  const totalValue = enriched.reduce((s, p) => s + p.value, 0);
  return { stockProducts, enriched, totalValue };
}

// ── fetch (READ-ONLY GET, paginate ครบ — ห้าม cap) ────────────────────────────
// ดึง stock_movements type=sale ที่ created_at >= cutoffKey ทั้งหมด → ใช้คิด "ขายในช่วง"
//   ใช้ stock_movements (ไม่ใช่ sale_items) เพราะ: (1) bundle ขาย → movement ลงใต้ child id
//   (sale_items เก็บ parent → children จะ miss → ขึ้น dead ผิด); (2) เลี่ยง cap ของ state.sales/saleItems
async function fetchSaleMovementsSince(cutoffKey) {
  const cfg = typeof window !== "undefined" ? window.SUPABASE_CONFIG : null;
  if (!cfg?.url) return { ok: false, reason: "ไม่พบการตั้งค่าเซิร์ฟเวอร์" };
  const token = (typeof window !== "undefined" ? window._sbAccessToken : null) || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const PAGE = 1000;
  const rows = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const url = cfg.url + "/rest/v1/stock_movements?type=eq.sale"
        + "&created_at=gte." + encodeURIComponent(cutoffKey)
        + "&select=product_id,created_at&order=id.asc"
        + "&limit=" + PAGE + "&offset=" + offset;
      const r = await fetch(url, { headers });
      if (!r.ok) return { ok: false, reason: "ดึงข้อมูลการขายไม่สำเร็จ (HTTP " + r.status + ")" };
      const page = await r.json().catch(() => null);
      if (!Array.isArray(page)) return { ok: false, reason: "ข้อมูลการขายรูปแบบไม่ถูกต้อง" };
      rows.push(...page);
      if (page.length < PAGE) break;   // หน้าสุดท้าย
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: "เครือข่ายมีปัญหา: " + (e?.message || e) };
  }
}

function heroHtml() {
  return `
      <div class="hero" style="text-align:center;padding:24px 16px;margin-bottom:20px;background:linear-gradient(135deg,#fee2e2,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🐌</div>
        <h2 style="margin:0 0 4px;color:#b91c1c">รายงานสต็อกค้างนาน (Dead Stock)</h2>
        <p style="margin:0;color:#92400e;font-size:14px">สินค้าที่ไม่ขยับนาน — ตัดสินใจล้างสต็อก / คืนซัพพลายเออร์</p>
      </div>`;
}

function periodBarHtml(days) {
  return `
      <div class="panel" style="padding:14px;margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600">ไม่ขายมาตั้งแต่:</span>
        ${[30, 60, 90, 180, 365].map(d => `
          <button class="ds-period-btn" data-days="${d}" style="padding:6px 14px;border-radius:20px;border:1px solid ${days===d?'#b91c1c':'#cbd5e1'};background:${days===d?'#b91c1c':'#fff'};color:${days===d?'#fff':'#475569'};cursor:pointer;font-size:13px;font-weight:600">
            ${d} วัน
          </button>
        `).join("")}
      </div>`;
}

function loadingHtml(days) {
  return `
    <div style="padding:8px">
      ${heroHtml()}
      ${periodBarHtml(days)}
      <div class="panel" style="padding:40px 16px;text-align:center;color:#64748b">
        <div style="font-size:32px;margin-bottom:8px">⏳</div>
        กำลังโหลดข้อมูลการขายจริง (${days} วัน)…
      </div>
    </div>`;
}

function errorHtml(days, reason) {
  return `
    <div style="padding:8px">
      ${heroHtml()}
      ${periodBarHtml(days)}
      <div class="panel" style="padding:32px 16px;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">⚠️</div>
        <div style="color:#b91c1c;font-weight:700;margin-bottom:4px">โหลดข้อมูลการขายไม่สำเร็จ</div>
        <div style="color:#64748b;font-size:13px;margin-bottom:14px">${escHtml(reason || "ไม่ทราบสาเหตุ")}</div>
        <button id="dsRetryBtn" class="btn" style="font-size:13px">↻ ลองใหม่</button>
        <div style="color:#94a3b8;font-size:11px;margin-top:10px">ไม่แสดงรายการเพื่อเลี่ยงการสรุปผิด (รายงานต้องอ้างข้อมูลจริง)</div>
      </div>
    </div>`;
}

export function renderDeadStockPage(ctx) {
  const { state, showToast, openProductDrawer } = ctx;
  const container = document.getElementById("page-dead_stock");
  if (!container) return;

  const days = _deadStockDays;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffKey = cutoffDate.toISOString().slice(0, 10);

  // loading ก่อน — period buttons ใช้ได้ระหว่างโหลด
  container.innerHTML = loadingHtml(days);
  const wirePeriodButtons = () => {
    container.querySelectorAll(".ds-period-btn").forEach(btn => btn.addEventListener("click", () => {
      _deadStockDays = Number(btn.dataset.days);
      renderDeadStockPage(ctx);
    }));
  };
  wirePeriodButtons();

  fetchSaleMovementsSince(cutoffKey).then(res => {
    // อาจเปลี่ยนหน้า/เปลี่ยนช่วงไปแล้วก่อน fetch เสร็จ → กัน render ทับ
    if (!document.body.contains(container)) return;
    if (_deadStockDays !== days) return;   // ผู้ใช้กดเปลี่ยนช่วงระหว่างโหลด → ปล่อย fetch รอบใหม่ render แทน

    if (!res.ok) {
      // ★ ห้าม fallback แสดง "ทุกตัว dead" เงียบ ๆ — แสดง error + toast
      container.innerHTML = errorHtml(days, res.reason);
      wirePeriodButtons();
      container.querySelector("#dsRetryBtn")?.addEventListener("click", () => renderDeadStockPage(ctx));
      showToast?.("โหลดข้อมูล Dead Stock ไม่สำเร็จ: " + (res.reason || ""));
      return;
    }

    const { soldSet, lastSaleMap } = indexSaleMovements(res.rows);
    const { stockProducts, enriched, totalValue } = computeDeadStock({
      products: state.products, soldSet, lastSaleMap, nowMs: Date.now()
    });

    container.innerHTML = `
    <div style="padding:8px">
      ${heroHtml()}
      ${periodBarHtml(days)}

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <div class="stat-label">🐌 สินค้า Dead Stock</div>
          <div class="stat-value" style="color:#b91c1c">${enriched.length}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">ไม่มีการขายในช่วง ${days} วัน</div>
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

      <div style="font-size:11px;color:#94a3b8;margin:-8px 2px 12px">อ้างอิงการขายจริงจากระบบ (stock movements) ตั้งแต่ ${cutoffKey} ถึงปัจจุบัน — รวมสินค้าชุด (bundle) ที่ตัดสต็อกตามลูก</div>

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
                  <td style="padding:8px;font-size:12px;color:#dc2626;font-weight:700">
                    ⚠️ ไม่ขายมา ≥ ${days} วัน
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

    // Period buttons (re-render)
    wirePeriodButtons();

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
        "สถานะการขาย": `ไม่ขายในช่วง ${days} วัน`
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, `Dead Stock ${days}d`);
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `รายงานสต็อกค้าง_${days}วัน_${date}.xlsx`);
      showToast?.("ส่งออก Excel สำเร็จ");
    });
  });
}
