// modules/picker_cart.js
// Phase 502a — shared "cashier cart" สำหรับ picker เลือกอุปกรณ์งานช่าง
//   (ac_install / service_form / solar / service_equipment — reuse ตัวเดียวกัน)
//
// ⚠️ UI/local-state ล้วน — ไม่มี fetch/POST/PATCH/DELETE/supabase-write ไม่แตะ stock/JV.
//    การตัดสต็อกยังเกิดตอน "ปิดงาน" (save) เหมือนเดิม; helper นี้แค่ช่วยจัดการ "ตะกร้า" ฝั่งจอ.
//
// export:
//   makePickerTouchGuard(windowMs=350) → { shouldSkip(productId) }
//       กัน double-add จอสัมผัส (จอแตะยิง 2 click/แตะ) — แตะตัวเดิมซ้ำใน window = ข้าม.
//       mirror POS build 464 (_posLastAdd) / service_equipment 504 (_svepLastPick).
//   renderPickerCart(cartEl, { items, money, escHtml?, onChangeQty, onRemove })
//       ตะกร้าแก้ได้: [- qty +] / [x] ลบ / ยอดรวมสด. callback ให้ caller จัดการ items + re-render.
//   countInCart(items, productId) → number (รวม qty ต่อ product สำหรับ badge)
//   updateCartBadges(listEl, items) → เติม "×N" บนทุก [data-badge-pid] แบบ surgical (ไม่ re-render list)

const _escFallback = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function makePickerTouchGuard(windowMs = 350) {
  let last = { id: null, t: 0 };
  return {
    shouldSkip(productId) {
      const now = Date.now();
      if (String(productId) === String(last.id) && (now - last.t) < windowMs) return true;
      last = { id: productId, t: now };
      return false;
    }
  };
}

export function countInCart(items, productId) {
  if (!Array.isArray(items)) return 0;
  return items.reduce(
    (s, it) => (String(it.product_id) === String(productId) ? s + Number(it.qty || 0) : s),
    0
  );
}

export function updateCartBadges(listEl, items) {
  if (!listEl || typeof listEl.querySelectorAll !== "function") return;
  listEl.querySelectorAll("[data-badge-pid]").forEach((el) => {
    const n = countInCart(items, el.getAttribute("data-badge-pid"));
    el.textContent = n > 0 ? "×" + n : "";
    el.style.display = n > 0 ? "inline-block" : "none";
  });
}

export function renderPickerCart(cartEl, { items, money, escHtml, onChangeQty, onRemove } = {}) {
  if (!cartEl) return;
  const esc = typeof escHtml === "function" ? escHtml : _escFallback;
  const fmt = (v) => (typeof money === "function" ? money(v) : String(v));
  const list = Array.isArray(items) ? items : [];

  if (list.length === 0) {
    cartEl.style.display = "none";
    cartEl.innerHTML = "";
    cartEl.onclick = null;
    return;
  }

  const totalQty = list.reduce((s, i) => s + Number(i.qty || 0), 0);
  const totalAmt = list.reduce((s, i) => s + Number(i.qty || 0) * Number(i.unit_price || 0), 0);

  const rows = list
    .map((it, idx) => {
      const qty = Number(it.qty || 0);
      const line = qty * Number(it.unit_price || 0);
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed #e2e8f0">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:#0f172a;font-size:13px">${esc(it.name || "-")}</div>
          <div style="font-size:11px;color:#64748b">${fmt(it.unit_price || 0)}${it.warehouse_name ? " • " + esc(it.warehouse_name) : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <button type="button" data-cart-act="dec" data-idx="${idx}" aria-label="ลด" style="width:28px;height:28px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;line-height:1;padding:0">−</button>
          <span style="min-width:24px;text-align:center;font-weight:700">${qty}</span>
          <button type="button" data-cart-act="inc" data-idx="${idx}" aria-label="เพิ่ม" style="width:28px;height:28px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;line-height:1;padding:0">+</button>
        </div>
        <div style="font-weight:800;color:#0284c7;white-space:nowrap;min-width:64px;text-align:right">${fmt(line)}</div>
        <button type="button" data-cart-act="del" data-idx="${idx}" aria-label="ลบ" title="ลบ" style="border:none;background:none;color:#ef4444;font-size:16px;cursor:pointer;touch-action:manipulation;flex-shrink:0;padding:0 2px">✕</button>
      </div>`;
    })
    .join("");

  cartEl.innerHTML = `
    <div style="padding:10px 16px">
      <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">🧺 อุปกรณ์ในงานนี้</div>
      ${rows}
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-weight:800;color:#0f172a">
        <span>${totalQty} รายการ</span>
        <span>${fmt(totalAmt)}</span>
      </div>
    </div>`;
  cartEl.style.display = "";

  // delegated handler — ใช้ property (ไม่ใช่ addEventListener) → re-render ทับ ไม่สะสม listener
  cartEl.onclick = (e) => {
    const b = e.target.closest && e.target.closest("[data-cart-act]");
    if (!b) return;
    const idx = Number(b.getAttribute("data-idx"));
    const cur = list[idx];
    if (!cur) return;
    const act = b.getAttribute("data-cart-act");
    if (act === "inc") onChangeQty && onChangeQty(idx, Number(cur.qty || 0) + 1);
    else if (act === "dec") onChangeQty && onChangeQty(idx, Math.max(1, Number(cur.qty || 0) - 1));
    else if (act === "del") onRemove && onRemove(idx);
  };
}
