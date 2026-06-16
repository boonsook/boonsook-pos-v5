// ═══════════════════════════════════════════════════════════
//  Phase 451 — ใบเช็คสต็อก A4 (printable stock-check sheet)
//  Pure HTML builder — ไม่มี DOM/fetch/DB. testable ตรง ๆ.
//  ใช้สำหรับเอาขึ้นรถ/เช็คคลังมือ: แยกหมวด · QR ต่อตัว · ช่อง "นับจริง" เขียนมือ.
//  ❌ ไม่มีคอลัมน์ราคา/ต้นทุน — เป็น stock-check ไม่ใช่ valuation (ช่างก็พิมพ์ได้).
// ═══════════════════════════════════════════════════════════
import { escHtml } from "./utils.js";

/**
 * @param {object} opts
 * @param {string} opts.warehouseName  ชื่อคลังที่กำลังดู (เช่น "รถคันแดง" / "คลังทั้งหมด")
 * @param {string} opts.dateStr        วันที่ (string พร้อมใช้)
 * @param {string} [opts.shopName]     ชื่อร้าน (หัวกระดาษ)
 * @param {Array<{category:string, items:Array<{idx:number,name:string,barcode:string,sku:string,stock:(number|string),barcodeDataUrl:string}>}>} opts.groups
 * @returns {string} HTML string เต็มหน้า A4 พร้อมพิมพ์
 */
export function buildStockCheckSheetHtml({ warehouseName, dateStr, groups, shopName } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const totalItems = list.reduce((s, g) => s + (Array.isArray(g.items) ? g.items.length : 0), 0);

  const groupsHtml = list.map(g => {
    const items = Array.isArray(g.items) ? g.items : [];
    const rows = items.map(it => {
      const sub = [it.barcode ? escHtml(it.barcode) : "", it.sku ? "SKU: " + escHtml(it.sku) : ""]
        .filter(Boolean).join(" · ");
      const bc = it.barcodeDataUrl
        ? `<img class="bc" src="${escHtml(it.barcodeDataUrl)}" alt="" />`
        : `<span class="qr-none">—</span>`;
      return `
        <tr>
          <td class="c-idx">${escHtml(String(it.idx == null ? "" : it.idx))}</td>
          <td class="c-name">
            <div class="p-name">${escHtml(it.name || "-")}</div>
            ${sub ? `<div class="p-sub">${sub}</div>` : ""}
          </td>
          <td class="c-bc">${bc}</td>
          <td class="c-stock">${escHtml(String(it.stock == null ? "" : it.stock))}</td>
          <td class="c-count"></td>
        </tr>`;
    }).join("");

    return `
      <section class="grp">
        <h2 class="grp-title">${escHtml(g.category || "ไม่ระบุหมวด")} <span class="grp-count">(${items.length})</span></h2>
        <table class="sheet">
          <thead>
            <tr>
              <th class="c-idx">#</th>
              <th class="c-name">ชื่อสินค้า</th>
              <th class="c-bc">บาร์โค้ด</th>
              <th class="c-stock">คงเหลือ<br/>(ระบบ)</th>
              <th class="c-count">นับจริง</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join("");

  const emptyHtml = `<div class="empty">ไม่มีสินค้านับสต็อกในขอบเขตที่เลือก</div>`;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<title>ใบเช็คสต็อก — ${escHtml(warehouseName || "")} — ${escHtml(dateStr || "")}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 12mm 10mm; }
  body { font-family: 'Prompt', system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f1f5f9; color: #0f172a; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  .toolbar button { padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: #0284c7; color: #fff; border-color: #0284c7; }
  .btn-gray { background: #fff; color: #334155; border-color: #cbd5e1; }
  .sheet-wrap { background: #fff; max-width: 190mm; margin: 0 auto; padding: 10mm; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  .head { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
  .head .shop { font-size: 18px; font-weight: 800; }
  .head .meta { font-size: 13px; color: #334155; margin-top: 2px; }
  .head .meta b { color: #0f172a; }
  .grp { margin-bottom: 14px; }
  .grp-title { font-size: 14px; font-weight: 800; background: #e2e8f0; padding: 6px 10px; border-radius: 6px; margin: 14px 0 6px; }
  .grp-count { font-weight: 600; color: #64748b; font-size: 12px; }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.sheet th, table.sheet td { border: 1px solid #94a3b8; padding: 4px 6px; vertical-align: middle; }
  table.sheet thead th { background: #f8fafc; font-weight: 700; text-align: center; }
  tr { page-break-inside: avoid; }
  .c-idx { width: 32px; text-align: center; color: #475569; }
  .c-name { text-align: left; }
  .p-name { font-weight: 700; }
  .p-sub { font-size: 10px; color: #64748b; font-family: monospace; margin-top: 1px; }
  .c-bc { width: 130px; text-align: center; }
  img.bc { width: 120px; height: auto; display: block; margin: 0 auto; }
  .qr-none { color: #cbd5e1; }
  .c-stock { width: 60px; text-align: center; font-weight: 700; }
  .c-count { width: 90px; height: 38px; background: #fffef0; }
  .empty { padding: 30px; text-align: center; color: #94a3b8; font-size: 14px; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .sheet-wrap { box-shadow: none; max-width: none; padding: 0; margin: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-primary" onclick="window.print()">🖨️ พิมพ์</button>
    <button class="btn-gray" onclick="window.close()">ปิด</button>
  </div>
  <div class="sheet-wrap">
    <div class="head">
      <div class="shop">${escHtml(shopName || "บุญสุข อิเล็กทรอนิกส์")}</div>
      <div class="meta">ใบเช็คสต็อก — คลัง: <b>${escHtml(warehouseName || "-")}</b> — วันที่ ${escHtml(dateStr || "-")} — รวม <b>${totalItems}</b> รายการ</div>
    </div>
    ${list.length ? groupsHtml : emptyHtml}
  </div>
</body>
</html>`;
}
