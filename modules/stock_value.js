// ═══════════════════════════════════════════════════════════
//  STOCK VALUE REPORT — มูลค่าสต็อกรวม (สต็อก × ต้นทุน)
//  ใช้ตอนทำบัญชี / ปลายปี / สรุปทรัพย์สิน
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

export function renderStockValuePage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-stock_value");
  if (!container) return;

  // ★ คำนวณมูลค่าสต็อก: stock × cost (เฉพาะสินค้านับสต็อก)
  const stockProducts = (state.products || []).filter(p => {
    const t = p.product_type;
    return t !== "service" && t !== "non_stock";
  });

  // Group by category
  const byCategory = new Map();
  let totalStock = 0, totalValue = 0, totalSellValue = 0;
  let zeroStockCount = 0, noCostCount = 0;

  stockProducts.forEach(p => {
    const cat = String(p.category || "").trim() || "ไม่ระบุหมวด";
    const stock = Number(p.stock || 0);
    const cost = Number(p.cost || 0);
    const price = Number(p.price || 0);
    const value = stock * cost;
    const sellValue = stock * price;

    if (!byCategory.has(cat)) byCategory.set(cat, { items: 0, stock: 0, value: 0, sellValue: 0 });
    const g = byCategory.get(cat);
    g.items++;
    g.stock += stock;
    g.value += value;
    g.sellValue += sellValue;

    totalStock += stock;
    totalValue += value;
    totalSellValue += sellValue;

    if (stock === 0) zeroStockCount++;
    if (cost === 0 && stock > 0) noCostCount++;
  });

  // Group by warehouse
  const byWarehouse = new Map();
  (state.warehouses || []).forEach(wh => {
    byWarehouse.set(wh.id, { name: wh.name, items: 0, stock: 0, value: 0, sellValue: 0 });
  });
  byWarehouse.set("__legacy__", { name: "(ไม่มีคลัง — ใช้สต็อก legacy)", items: 0, stock: 0, value: 0, sellValue: 0 });
  (state.warehouseStock || []).forEach(ws => {
    const g = byWarehouse.get(ws.warehouse_id);
    if (!g) return;
    const prod = stockProducts.find(p => String(p.id) === String(ws.product_id));
    if (!prod) return;
    const s = Number(ws.stock || 0);
    if (s <= 0) return;
    g.items++;
    g.stock += s;
    g.value += s * Number(prod.cost || 0);
    g.sellValue += s * Number(prod.price || 0);
  });
  // legacy = products with stock > 0 but no warehouse_stock entry
  stockProducts.forEach(p => {
    const hasWh = (state.warehouseStock || []).some(ws => String(ws.product_id) === String(p.id) && Number(ws.stock || 0) > 0);
    if (!hasWh && Number(p.stock || 0) > 0) {
      const g = byWarehouse.get("__legacy__");
      g.items++;
      g.stock += Number(p.stock || 0);
      g.value += Number(p.stock || 0) * Number(p.cost || 0);
      g.sellValue += Number(p.stock || 0) * Number(p.price || 0);
    }
  });

  const sortedCats = [...byCategory.entries()]
    .map(([name, g]) => ({ name, ...g }))
    .sort((a, b) => b.value - a.value);

  const sortedWhs = [...byWarehouse.entries()]
    .map(([id, g]) => ({ id, ...g }))
    .filter(g => g.items > 0)
    .sort((a, b) => b.value - a.value);

  const potentialProfit = totalSellValue - totalValue;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:24px 16px;margin-bottom:20px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">💰</div>
        <h2 style="margin:0 0 4px;color:#1e40af">รายงานมูลค่าสต็อก</h2>
        <p style="margin:0;color:#92400e;font-size:14px">มูลค่าทรัพย์สิน (สต็อก × ต้นทุน) — สำหรับบัญชี / ภาษี / ปลายปี</p>
      </div>

      <!-- ═══ Summary Cards ═══ -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px">
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">💰 มูลค่ารวม (ต้นทุน)</div>
          <div class="stat-value" style="color:#059669;font-size:22px">฿${moneyShort(totalValue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${money(totalValue)} บาท</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">🏷️ มูลค่าขาย (ราคาขาย)</div>
          <div class="stat-value" style="color:#0284c7;font-size:22px">฿${moneyShort(totalSellValue)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${money(totalSellValue)} บาท</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed">
          <div class="stat-label">📈 กำไรเต็ม (ถ้าขายหมด)</div>
          <div class="stat-value" style="color:#7c3aed;font-size:22px">฿${moneyShort(potentialProfit)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">margin ${totalValue > 0 ? ((potentialProfit/totalValue)*100).toFixed(1) : 0}%</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">📦 จำนวน SKU / ชิ้น</div>
          <div class="stat-value" style="color:#92400e;font-size:18px">${stockProducts.length} / ${totalStock.toLocaleString("th-TH")}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">เหลือ 0: ${zeroStockCount} • ไม่มี cost: ${noCostCount}</div>
        </div>
      </div>

      <!-- ═══ ปุ่ม Export ═══ -->
      <div style="display:flex;gap:8px;margin-bottom:16px;justify-content:flex-end">
        <button id="svExportBtn" class="btn light" style="font-size:13px">📥 ส่งออก Excel</button>
      </div>

      <!-- ═══ ตารางมูลค่าตามหมวดหมู่ ═══ -->
      <div class="panel" style="padding:16px;margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a">📂 มูลค่าตามหมวดหมู่ (${sortedCats.length} หมวด)</h3>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:left">หมวดหมู่</th>
                <th style="padding:8px;text-align:right">SKU</th>
                <th style="padding:8px;text-align:right">ชิ้น</th>
                <th style="padding:8px;text-align:right;color:#059669">มูลค่าต้นทุน</th>
                <th style="padding:8px;text-align:right;color:#0284c7">มูลค่าขาย</th>
                <th style="padding:8px;text-align:right;color:#7c3aed">กำไรเต็ม</th>
              </tr>
            </thead>
            <tbody>
              ${sortedCats.map(c => `
                <tr style="border-bottom:1px solid #e5e7eb">
                  <td style="padding:8px;font-weight:600">${escHtml(c.name)}</td>
                  <td style="padding:8px;text-align:right">${c.items}</td>
                  <td style="padding:8px;text-align:right">${c.stock.toLocaleString("th-TH")}</td>
                  <td style="padding:8px;text-align:right;color:#059669;font-weight:700">฿${money(c.value)}</td>
                  <td style="padding:8px;text-align:right;color:#0284c7">฿${money(c.sellValue)}</td>
                  <td style="padding:8px;text-align:right;color:#7c3aed">฿${money(c.sellValue - c.value)}</td>
                </tr>
              `).join("")}
              <tr style="background:#f8fafc;font-weight:800">
                <td style="padding:10px">รวม</td>
                <td style="padding:10px;text-align:right">${stockProducts.length}</td>
                <td style="padding:10px;text-align:right">${totalStock.toLocaleString("th-TH")}</td>
                <td style="padding:10px;text-align:right;color:#059669">฿${money(totalValue)}</td>
                <td style="padding:10px;text-align:right;color:#0284c7">฿${money(totalSellValue)}</td>
                <td style="padding:10px;text-align:right;color:#7c3aed">฿${money(potentialProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ═══ ตารางมูลค่าตามคลัง ═══ -->
      <div class="panel" style="padding:16px">
        <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a">🏪 มูลค่าตามคลัง (${sortedWhs.length} คลัง)</h3>
        ${sortedWhs.length === 0 ? `
          <div style="text-align:center;padding:30px;color:#94a3b8">ยังไม่มีข้อมูลสต็อกตามคลัง</div>
        ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:8px;text-align:left">คลัง</th>
                <th style="padding:8px;text-align:right">SKU</th>
                <th style="padding:8px;text-align:right">ชิ้น</th>
                <th style="padding:8px;text-align:right;color:#059669">มูลค่าต้นทุน</th>
                <th style="padding:8px;text-align:right;color:#0284c7">มูลค่าขาย</th>
              </tr>
            </thead>
            <tbody>
              ${sortedWhs.map(w => `
                <tr style="border-bottom:1px solid #e5e7eb">
                  <td style="padding:8px;font-weight:600">${escHtml(w.name)}</td>
                  <td style="padding:8px;text-align:right">${w.items}</td>
                  <td style="padding:8px;text-align:right">${w.stock.toLocaleString("th-TH")}</td>
                  <td style="padding:8px;text-align:right;color:#059669;font-weight:700">฿${money(w.value)}</td>
                  <td style="padding:8px;text-align:right;color:#0284c7">฿${money(w.sellValue)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        `}
      </div>
    </div>
  `;

  // Export Excel
  container.querySelector("#svExportBtn")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") {
      showToast?.("ระบบ Excel ยังไม่พร้อม");
      return;
    }
    const catSheet = XLSX.utils.json_to_sheet([
      ...sortedCats.map(c => ({
        "หมวดหมู่": c.name,
        "จำนวน SKU": c.items,
        "จำนวนชิ้น": c.stock,
        "มูลค่าต้นทุน": Number(c.value.toFixed(2)),
        "มูลค่าขาย": Number(c.sellValue.toFixed(2)),
        "กำไรเต็ม": Number((c.sellValue - c.value).toFixed(2))
      })),
      {
        "หมวดหมู่": "รวม",
        "จำนวน SKU": stockProducts.length,
        "จำนวนชิ้น": totalStock,
        "มูลค่าต้นทุน": Number(totalValue.toFixed(2)),
        "มูลค่าขาย": Number(totalSellValue.toFixed(2)),
        "กำไรเต็ม": Number(potentialProfit.toFixed(2))
      }
    ]);
    const whSheet = XLSX.utils.json_to_sheet(sortedWhs.map(w => ({
      "คลัง": w.name,
      "จำนวน SKU": w.items,
      "จำนวนชิ้น": w.stock,
      "มูลค่าต้นทุน": Number(w.value.toFixed(2)),
      "มูลค่าขาย": Number(w.sellValue.toFixed(2))
    })));
    const itemSheet = XLSX.utils.json_to_sheet(stockProducts.map(p => ({
      "ชื่อสินค้า": p.name || "",
      "SKU": p.sku || "",
      "หมวดหมู่": p.category || "",
      "สต็อก": Number(p.stock || 0),
      "ต้นทุน/ชิ้น": Number(p.cost || 0),
      "ราคาขาย/ชิ้น": Number(p.price || 0),
      "มูลค่าต้นทุน": Number(((p.stock || 0) * (p.cost || 0)).toFixed(2)),
      "มูลค่าขาย": Number(((p.stock || 0) * (p.price || 0)).toFixed(2))
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, catSheet, "ตามหมวดหมู่");
    XLSX.utils.book_append_sheet(wb, whSheet, "ตามคลัง");
    XLSX.utils.book_append_sheet(wb, itemSheet, "รายการสินค้า");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `รายงานมูลค่าสต็อก_${date}.xlsx`);
    showToast?.("ส่งออก Excel สำเร็จ");
  });
}
