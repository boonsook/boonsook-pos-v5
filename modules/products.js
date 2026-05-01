
// ═══════════════════════════════════════════════════════════
//  Boonsook POS V5 — Products Page (FlowAccount Style)
// ═══════════════════════════════════════════════════════════
import { renderEmpty } from "./ui_states.js";

// ═══ ประเภทสินค้า (เหมือน FlowAccount) ═══
const PRODUCT_TYPES = {
  all:       { label: "แสดงทั้งหมด", icon: "" },
  service:   { label: "บริการ",         icon: "🔧" },
  non_stock: { label: "สินค้าไม่นับสต็อก", icon: "📦" },
  stock:     { label: "สินค้านับสต็อก",   icon: "🏪" }
};

// คำที่ใช้จำแนก "บริการ" อัตโนมัติจากชื่อ/หมวดหมู่
const SERVICE_KEYWORDS = ["ค่าบริการ", "บริการ", "ค่าเดินทาง", "ค่าแรง", "ค่าติดตั้ง", "ค่ารื้อ", "ค่าซ่อม", "ค่าล้าง"];

const _typeCache = new Map();
function detectProductType(p) {
  if (!p || !p.id) return "stock";
  // cache เพื่อไม่ต้องคำนวณซ้ำทุก render
  if (_typeCache.has(p.id)) return _typeCache.get(p.id);
  let result = "stock";
  if (p.product_type && ["service","non_stock","stock"].includes(p.product_type)) {
    result = p.product_type;
  } else {
    const clean = s => (s||"").replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, "").toLowerCase();
    const text = clean(p.name) + " " + clean(p.category);
    if (SERVICE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) result = "service";
  }
  _typeCache.set(p.id, result);
  return result;
}
// เคลียร์ cache เมื่อ import/delete ใหม่
function clearTypeCache() { _typeCache.clear(); }

const PRODUCT_CATEGORIES = {
  all:     { label: "ทั้งหมด", icon: "" },
  instock: { label: "พร้อมขาย", icon: "🟢" },
  low:     { label: "ใกล้หมด", icon: "🟡" },
  out:     { label: "หมดสต็อก", icon: "🔴" }
};

const SORT_OPTIONS = [
  { value: "name_asc",   label: "ชื่อสินค้า ↑" },
  { value: "name_desc",  label: "ชื่อสินค้า ↓" },
  { value: "price_asc",  label: "ราคาขาย ↑" },
  { value: "price_desc", label: "ราคาขาย ↓" },
  { value: "stock_asc",  label: "สต็อกน้อย → มาก" },
  { value: "stock_desc", label: "สต็อกมาก → น้อย" },
  { value: "newest",     label: "เพิ่มล่าสุด" }
];

let currentTypeFilter = "all"; // all | service | non_stock | stock
let currentFilter = "all";
let currentCategory = "all"; // ★ "all" or category name
let searchQuery = "";
let currentPage = 1;
let currentSort = "name_asc";
let viewMode = "list"; // list | grid
let selectedWarehouse = "all"; // "all" or warehouse id
let bulkMode = false; // ★ Bulk edit mode
let bulkSelected = new Set(); // ★ product ids
let quickFilter = ""; // ★ "no_cost" | "no_barcode" | ""
const PAGE_SIZE = 20;

// ─── Letter Avatar Colors ───
const AVATAR_COLORS = [
  "#0284c7", "#059669", "#d97706", "#dc2626", "#7c3aed",
  "#db2777", "#0891b2", "#65a30d", "#ea580c", "#4f46e5"
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name||"").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getLetterAvatar(name) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase();
  const color = getAvatarColor(name);
  return `<div class="prod-avatar" style="background:${color}">${escHtml(initial)}</div>`;
}

// ★ ใช้รูปสินค้า (image_url) ถ้ามี ไม่งั้น fallback letter avatar
function getProductAvatar(p) {
  const img = String(p?.image_url || "").trim();
  if (img) return `<div class="prod-avatar" style="background:#fff;padding:0;overflow:hidden"><img src="${escHtml(img)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';this.parentElement.style.background='${getAvatarColor(p.name)}';this.parentElement.innerHTML='${escHtml(String(p.name || '?').trim().charAt(0).toUpperCase())}'" /></div>`;
  return getLetterAvatar(p.name);
}

function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

// ★ คำนวณราคาที่ active (ถ้ามี promo + อยู่ในช่วงวัน → ใช้ promo)
function getActivePrice(p) {
  const today = new Date().toISOString().slice(0, 10);
  const promo = Number(p?.promo_price || 0);
  const ps = String(p?.promo_start || "");
  const pe = String(p?.promo_end || "");
  if (promo > 0 && (!ps || today >= ps) && (!pe || today <= pe)) {
    return { price: promo, isPromo: true, original: Number(p.price || 0) };
  }
  return { price: Number(p?.price || 0), isPromo: false };
}
window._appGetActivePrice = getActivePrice; // expose for POS

// Phase 51: dedup + fix XSS gap (added apostrophe escape via shared utils)
import { escHtml } from "./utils.js";

// ═══════════════════════════════════════════════════════════
//  MAIN RENDER
// ═══════════════════════════════════════════════════════════
export function renderProductsPage({ state, addToCart, openProductDrawer, warehouseFilter, pageId }) {
  // ★ warehouseFilter: ชื่อคลัง เช่น "คันขาว", "คันแดง", "ศีขร" — ถ้ามีจะล็อคคลังนั้น
  // ★ pageId: ถ้าเป็น sub-page จะใช้ container อื่น เช่น "page-wh_kunkhao"
  const ctx = { state, addToCart, openProductDrawer, warehouseFilter: warehouseFilter || null, pageId: pageId || "page-products" };

  currentPage = 1;
  searchQuery = "";
  currentFilter = "all";
  currentCategory = "all";
  currentSort = "name_asc";

  // Phase 45.10 (B5-6): clear bulk selection ตอนเข้าหน้า — กัน ID เก่าค้าง bulk-delete ผิด product
  bulkMode = false;
  bulkSelected.clear();

  // ★ Deep link: #products?cat=CATEGORY&addNew=1 (สแกน QR จะมาที่นี่)
  const hash = window.location.hash || "";
  const q = hash.split("?")[1];
  let deepLinkAddNew = false, deepLinkCat = "";
  if (q) {
    const params = new URLSearchParams(q);
    const cat = params.get("cat");
    if (cat) { currentCategory = cat; deepLinkCat = cat; }
    if (params.get("addNew") === "1") deepLinkAddNew = true;
    // เคลียร์ query string ออกจาก URL (เหลือแค่ #products)
    if (cat || params.get("addNew")) {
      try { history.replaceState(null, "", "#products"); } catch(e){}
    }
  }

  // ถ้ามี warehouseFilter → หาตัว warehouse id จากชื่อ
  // ★ ถ้าหาไม่เจอ ให้ใช้ "none" แทน "all" เพื่อไม่แสดงสินค้าทั้งหมด
  if (warehouseFilter) {
    const wh = (state.warehouses || []).find(w => (w.name || "").includes(warehouseFilter));
    selectedWarehouse = wh ? String(wh.id) : "none";
  } else {
    selectedWarehouse = "all";
  }

  renderView(ctx);

  // เปิด drawer พร้อม prefill หลัง render เสร็จ
  if (deepLinkAddNew) {
    setTimeout(() => openProductDrawer(null, { prefillCategory: deepLinkCat }), 100);
  }
}

// ─── Helper: get stock for a product in specific warehouse ───
function getWarehouseStock(state, productId, warehouseId) {
  if (warehouseId === "all" || !warehouseId) return null; // use product.stock
  const ws = (state.warehouseStock || []).find(s => s.product_id === productId && s.warehouse_id === Number(warehouseId));
  return ws || { stock: 0, min_stock: 0 };
}

function getDisplayStock(state, product) {
  if (selectedWarehouse === "none") return { stock: 0, min_stock: 0 };
  if (selectedWarehouse === "all") return { stock: Number(product.stock || 0), min_stock: Number(product.min_stock || 0) };
  const ws = getWarehouseStock(state, product.id, selectedWarehouse);
  return ws ? { stock: Number(ws.stock || 0), min_stock: Number(ws.min_stock || 0) } : { stock: 0, min_stock: 0 };
}

function renderView(ctx) {
  const { state, addToCart, openProductDrawer, warehouseFilter, pageId } = ctx;
  const el = document.getElementById(pageId || "page-products");
  if (!el) return;
  const products = state.products || [];
  const warehouses = state.warehouses || [];

  // ★ ถ้าเลือกคลังเฉพาะ → กรองเฉพาะสินค้าที่มี stock > 0 ใน warehouse_stock ของคลังนั้น
  // ★ "none" = warehouse หาไม่เจอ → แสดง 0 รายการ
  let filtered;
  if (selectedWarehouse === "none") {
    filtered = [];
  } else if (selectedWarehouse && selectedWarehouse !== "all") {
    const whId = Number(selectedWarehouse);
    const whStockMap = new Map();
    (state.warehouseStock || [])
      .filter(s => s.warehouse_id === whId && Number(s.stock || 0) > 0)
      .forEach(s => whStockMap.set(s.product_id, s));
    filtered = products.filter(p => whStockMap.has(p.id));
  } else {
    filtered = [...products];
  }

  // ─── Filter by product type (บริการ / ไม่นับสต็อก / นับสต็อก) ───
  if (currentTypeFilter !== "all") {
    filtered = filtered.filter(p => detectProductType(p) === currentTypeFilter);
  }

  // ─── Filter by category ───
  if (currentCategory !== "all") {
    filtered = filtered.filter(p => String(p.category || "") === currentCategory);
  }

  // ★ Filter ใช้ stock ตามคลังที่เลือก
  if (currentFilter === "instock") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > ds.min_stock; });
  } else if (currentFilter === "low") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > 0 && ds.stock <= ds.min_stock; });
  } else if (currentFilter === "out") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock <= 0; });
  }

  // ★ Quick Filter (no_cost / no_barcode)
  if (quickFilter === "no_cost") {
    filtered = filtered.filter(p => detectProductType(p) === "stock" && Number(p.cost || 0) === 0);
  } else if (quickFilter === "no_barcode") {
    filtered = filtered.filter(p => detectProductType(p) === "stock" && !String(p.barcode || "").trim());
  }

  // ─── Search ───
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      String(p.name || "").toLowerCase().includes(q) ||
      String(p.sku || "").toLowerCase().includes(q) ||
      String(p.barcode || "").toLowerCase().includes(q)
    );
  }

  // ─── Sort ───
  filtered.sort((a, b) => {
    switch (currentSort) {
      case "name_asc":   return String(a.name || "").localeCompare(String(b.name || ""), "th");
      case "name_desc":  return String(b.name || "").localeCompare(String(a.name || ""), "th");
      case "price_asc":  return Number(a.price || 0) - Number(b.price || 0);
      case "price_desc": return Number(b.price || 0) - Number(a.price || 0);
      case "stock_asc":  return getDisplayStock(state, a).stock - getDisplayStock(state, b).stock;
      case "stock_desc": return getDisplayStock(state, b).stock - getDisplayStock(state, a).stock;
      case "newest":     return (b.id || 0) - (a.id || 0);
      default: return 0;
    }
  });

  // ─── Count by product type (ใช้ base list ที่กรองตามคลังแล้ว) ───
  // base = สินค้าที่มี stock > 0 ในคลังที่เลือก (ก่อน filter type/status/search)
  let baseProducts;
  if (selectedWarehouse === "none") {
    baseProducts = [];
  } else if (selectedWarehouse && selectedWarehouse !== "all") {
    const whId = Number(selectedWarehouse);
    const whStockIds = new Set(
      (state.warehouseStock || [])
        .filter(s => s.warehouse_id === whId && Number(s.stock || 0) > 0)
        .map(s => s.product_id)
    );
    baseProducts = products.filter(p => whStockIds.has(p.id));
  } else {
    baseProducts = products;
  }
  const countTypeAll = baseProducts.length;
  const countService = baseProducts.filter(p => detectProductType(p) === "service").length;
  const countNonStock = baseProducts.filter(p => detectProductType(p) === "non_stock").length;
  const countStock = baseProducts.filter(p => detectProductType(p) === "stock").length;

  // ─── Count by status (ใช้ stock ตามคลังที่เลือก + type filter) ───
  const typeFiltered = currentTypeFilter === "all" ? baseProducts : baseProducts.filter(p => detectProductType(p) === currentTypeFilter);
  const countAll = typeFiltered.length;
  const countInstock = typeFiltered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > ds.min_stock; }).length;
  const countLow = typeFiltered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > 0 && ds.stock <= ds.min_stock; }).length;
  const countOut = typeFiltered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock <= 0; }).length;

  // ─── Warehouse dropdown ───
  const whName = selectedWarehouse === "all" ? "คลังทั้งหมด" : (warehouses.find(w => w.id === Number(selectedWarehouse))?.name || "คลังทั้งหมด");

  // ─── Pagination ───
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  el.innerHTML = `
    <div class="panel">
      <!-- Header -->
      <div class="prod-header">
        <div>
          <h3 class="prod-title">สินค้า / คลัง</h3>
          <div class="sku">${escHtml(whName)} ${countTypeAll} รายการ</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button id="prodImportBtn" class="btn light" style="font-size:12px;padding:6px 10px">นำเข้า</button>
          <button id="prodExportBtn" class="btn light" style="font-size:12px;padding:6px 10px">ส่งออก</button>
          <button id="prodGenAllBarcodesBtn" class="btn light" style="font-size:12px;padding:6px 10px" title="สร้างบาร์โค้ดให้สินค้านับสต็อกที่ยังไม่มี">สร้างบาร์โค้ด</button>
          <button id="prodPrintBarcodesBtn" class="btn light" style="font-size:12px;padding:6px 10px" title="พิมพ์สติ๊กเกอร์บาร์โค้ดหลายตัว">🖨️ พิมพ์บาร์โค้ด</button>
          <button id="prodManageCatBtn" class="btn light" style="font-size:12px;padding:6px 10px" title="จัดการหมวดหมู่ (เพิ่ม/ลบ/เปลี่ยนชื่อ/ย้ายตำแหน่ง)">🗂️ จัดการหมวด</button>
          <button id="prodMergeCatBtn" class="btn light" style="font-size:12px;padding:6px 10px" title="ค้นหาและรวมหมวดหมู่ซ้ำ/ใกล้เคียง">🔗 รวมหมวดซ้ำ</button>
          <button id="prodBulkModeBtn" class="btn light" style="font-size:12px;padding:6px 10px;${bulkMode ? 'background:#0284c7;color:#fff;border-color:#0284c7' : ''}" title="โหมดเลือกหลายรายการ">${bulkMode ? '✓ Bulk (เลือก ' + bulkSelected.size + ')' : '☑ Bulk'}</button>
          <button id="prodDeleteAllBtn" class="btn light" style="font-size:12px;padding:6px 10px;color:#dc2626;border-color:#fca5a5" title="ลบสินค้าทั้งหมดเพื่อนำเข้าใหม่">ลบทั้งหมด</button>
          <button id="prodAddBtn" class="btn primary" style="font-size:12px;padding:6px 12px">${
            currentTypeFilter === 'service' ? '+ เพิ่มบริการ' :
            currentTypeFilter === 'non_stock' ? '+ เพิ่มสินค้าไม่นับสต็อก' :
            currentTypeFilter === 'stock' ? '+ เพิ่มสินค้านับสต็อก' :
            '+ เพิ่มสินค้า'
          }</button>
        </div>
      </div>

      ${products.length === 0 ? renderEmpty({
        icon: "📦",
        title: "ยังไม่มีสินค้า",
        message: 'เริ่มต้นโดยกด "+ เพิ่มสินค้า" หรือนำเข้าจาก Excel — ระบบจะใช้ข้อมูลนี้ใน POS, ใบเสนอราคา, และตัดสต็อกอัตโนมัติ',
        actionLabel: "+ เพิ่มสินค้า",
        actionId: "prodEmptyAddBtn"
      }) : ''}

      ${bulkMode && bulkSelected.size > 0 ? `
      <div style="position:sticky;top:0;z-index:5;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;padding:10px 14px;border-radius:10px;margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;box-shadow:0 4px 12px rgba(2,132,199,.3)">
        <strong style="font-size:14px">เลือก ${bulkSelected.size} รายการ:</strong>
        <button id="bulkSelectAllPageBtn" class="btn light" style="font-size:12px;padding:5px 10px">☑ เลือกในหน้านี้</button>
        <button id="bulkClearBtn" class="btn light" style="font-size:12px;padding:5px 10px">ล้าง</button>
        <span style="opacity:.5">|</span>
        <button id="bulkPriceUpBtn" class="btn light" style="font-size:12px;padding:5px 10px" title="ขึ้นราคา %">📈 ราคา ±%</button>
        <button id="bulkSetCategoryBtn" class="btn light" style="font-size:12px;padding:5px 10px">🗂️ เปลี่ยนหมวด</button>
        <button id="bulkSetTypeBtn" class="btn light" style="font-size:12px;padding:5px 10px">🏷️ เปลี่ยนประเภท</button>
        <button id="bulkDeleteBtn" class="btn" style="font-size:12px;padding:5px 10px;background:#ef4444;color:#fff;border:none">🗑️ ลบที่เลือก</button>
      </div>
      ` : ''}

      <!-- ★ Product Type Tabs (เหมือน FlowAccount) -->
      <div class="prod-type-tabs mt16" style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none">
        <button class="prod-type-tab ${currentTypeFilter === 'all' ? 'active' : ''}" data-ptype="all" style="padding:8px 12px;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;white-space:nowrap;color:${currentTypeFilter === 'all' ? '#0284c7' : '#64748b'};border-bottom:${currentTypeFilter === 'all' ? '2px solid #0284c7' : '2px solid transparent'};margin-bottom:-2px">
          แสดงทั้งหมด</button>
        <button class="prod-type-tab ${currentTypeFilter === 'service' ? 'active' : ''}" data-ptype="service" style="padding:8px 12px;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;white-space:nowrap;color:${currentTypeFilter === 'service' ? '#0284c7' : '#64748b'};border-bottom:${currentTypeFilter === 'service' ? '2px solid #0284c7' : '2px solid transparent'};margin-bottom:-2px">
          🔧 บริการ <span style="font-size:11px;color:#94a3b8">${countService}</span></button>
        <button class="prod-type-tab ${currentTypeFilter === 'non_stock' ? 'active' : ''}" data-ptype="non_stock" style="padding:8px 12px;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;white-space:nowrap;color:${currentTypeFilter === 'non_stock' ? '#0284c7' : '#64748b'};border-bottom:${currentTypeFilter === 'non_stock' ? '2px solid #0284c7' : '2px solid transparent'};margin-bottom:-2px">
          📦 ไม่นับสต็อก <span style="font-size:11px;color:#94a3b8">${countNonStock}</span></button>
        <button class="prod-type-tab ${currentTypeFilter === 'stock' ? 'active' : ''}" data-ptype="stock" style="padding:8px 12px;font-size:12px;font-weight:600;border:none;background:none;cursor:pointer;white-space:nowrap;color:${currentTypeFilter === 'stock' ? '#0284c7' : '#64748b'};border-bottom:${currentTypeFilter === 'stock' ? '2px solid #0284c7' : '2px solid transparent'};margin-bottom:-2px">
          🏪 นับสต็อก <span style="font-size:11px;color:#94a3b8">${countStock}</span></button>
      </div>

      <!-- ★ Warehouse Selector (FlowAccount style) — ซ่อนถ้าเป็น sub-page คลัง -->
      ${warehouseFilter ? `
      <div class="wh-selector mt16" style="pointer-events:none;opacity:.6;">
        <select class="wh-select" disabled><option>🏪 ${escHtml(warehouseFilter)}</option></select>
      </div>
      ` : warehouses.length > 0 ? `
      <div class="wh-selector mt16">
        <select id="warehouseSelect" class="wh-select">
          <option value="all" ${selectedWarehouse === 'all' ? 'selected' : ''}>🏪 คลังทั้งหมด</option>
          ${warehouses.map(wh => `<option value="${wh.id}" ${selectedWarehouse == wh.id ? 'selected' : ''}>${escHtml(wh.name)}</option>`).join("")}
        </select>
      </div>
      ` : ''}

      <!-- Filter Tabs (สต็อก) -->
      <div class="prod-filter-tabs mt16">
        <button class="prod-tab ${currentFilter === 'all' ? 'active' : ''}" data-pfilter="all">
          ทั้งหมด <span class="prod-tab-count">${countAll}</span>
        </button>
        <button class="prod-tab ${currentFilter === 'instock' ? 'active' : ''}" data-pfilter="instock">
          <span class="prod-status-dot" style="background:#22c55e"></span> พร้อมขาย <span class="prod-tab-count">${countInstock}</span>
        </button>
        <button class="prod-tab ${currentFilter === 'low' ? 'active' : ''}" data-pfilter="low">
          <span class="prod-status-dot" style="background:#f59e0b"></span> ใกล้หมด <span class="prod-tab-count">${countLow}</span>
        </button>
        <button class="prod-tab ${currentFilter === 'out' ? 'active' : ''}" data-pfilter="out">
          <span class="prod-status-dot" style="background:#ef4444"></span> หมดสต็อก <span class="prod-tab-count">${countOut}</span>
        </button>
      </div>

      <!-- Search + Sort Row -->
      <div class="prod-toolbar mt16">
        <div class="prod-search-wrap">
          <span class="prod-search-icon">🔍</span>
          <input id="prodSearchInput" class="prod-search-input" placeholder="ค้นหาสินค้า / SKU / บาร์โค้ด" value="${escHtml(searchQuery)}" />
          <button id="prodScanBtn" class="prod-scan-btn" title="สแกนบาร์โค้ด">📷</button>
        </div>
        <div class="prod-sort-wrap">
          <select id="prodSortSelect" class="prod-sort-select">
            ${SORT_OPTIONS.map(o => `<option value="${o.value}" ${currentSort === o.value ? 'selected' : ''}>${o.label}</option>`).join("")}
          </select>
          <button id="prodViewToggle" class="prod-view-toggle" title="เปลี่ยนมุมมอง">${viewMode === 'list' ? '☰' : '⊞'}</button>
        </div>
      </div>

      <!-- ★ Quick Filters (no_cost / no_barcode) -->
      ${(() => {
        const noCostCount = baseProducts.filter(p => {
          const t = detectProductType(p);
          return t === "stock" && Number(p.cost || 0) === 0;
        }).length;
        const noBarcodeCount = baseProducts.filter(p => {
          const t = detectProductType(p);
          return t === "stock" && !String(p.barcode || "").trim();
        }).length;
        if (noCostCount === 0 && noBarcodeCount === 0 && !quickFilter) return '';
        return `
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center">
          <span style="font-size:11px;color:#94a3b8;font-weight:600;padding-right:4px">⚡ ลัด:</span>
          ${noCostCount > 0 || quickFilter === 'no_cost' ? `
            <button class="prod-quick-chip" data-qf="no_cost" style="padding:4px 10px;border-radius:14px;border:1px solid ${quickFilter==='no_cost'?'#dc2626':'#fde68a'};background:${quickFilter==='no_cost'?'#dc2626':'#fef3c7'};color:${quickFilter==='no_cost'?'#fff':'#92400e'};font-size:11px;font-weight:600;cursor:pointer">
              ⚠️ ไม่มี cost (${noCostCount})
            </button>
          ` : ''}
          ${noBarcodeCount > 0 || quickFilter === 'no_barcode' ? `
            <button class="prod-quick-chip" data-qf="no_barcode" style="padding:4px 10px;border-radius:14px;border:1px solid ${quickFilter==='no_barcode'?'#dc2626':'#bfdbfe'};background:${quickFilter==='no_barcode'?'#dc2626':'#dbeafe'};color:${quickFilter==='no_barcode'?'#fff':'#1e40af'};font-size:11px;font-weight:600;cursor:pointer">
              📵 ไม่มี barcode (${noBarcodeCount})
            </button>
          ` : ''}
          ${quickFilter ? `<button id="prodClearQuickFilter" style="padding:4px 8px;border:none;background:transparent;color:#64748b;cursor:pointer;font-size:11px;font-weight:600">× ล้าง</button>` : ''}
        </div>
        `;
      })()}

      <!-- ★ Category filter — chip bar (scrollable) -->
      ${(() => {
        // นับจำนวนสินค้าต่อหมวด (จาก baseProducts — หลัง type filter แต่ก่อน category filter)
        const catMap = new Map();
        const base = currentTypeFilter === "all" ? baseProducts : baseProducts.filter(p => detectProductType(p) === currentTypeFilter);
        base.forEach(p => {
          const c = String(p.category || "").trim();
          if (!c) return;
          catMap.set(c, (catMap.get(c) || 0) + 1);
        });
        // ★ ใช้ลำดับ custom (ถ้ามี) จาก localStorage — ที่ไม่อยู่ใน custom order ค่อยเรียง alphabet ต่อท้าย
        let customOrder = [];
        try { customOrder = JSON.parse(localStorage.getItem("bsk_category_order") || "[]"); } catch(e) {}
        const orderRank = new Map(customOrder.map((c, i) => [c, i]));
        const catList = [...catMap.entries()].sort((a, b) => {
          const ra = orderRank.has(a[0]) ? orderRank.get(a[0]) : 9999;
          const rb = orderRank.has(b[0]) ? orderRank.get(b[0]) : 9999;
          if (ra !== rb) return ra - rb;
          return a[0].localeCompare(b[0], "th");
        });
        if (catList.length === 0) return '';
        return `
        <div class="prod-category-bar" style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;padding-bottom:6px">
          <button class="prod-cat-chip" data-pcat="all" style="padding:6px 14px;border-radius:20px;border:1px solid ${currentCategory==='all'?'#0284c7':'#e2e8f0'};background:${currentCategory==='all'?'#0284c7':'#fff'};color:${currentCategory==='all'?'#fff':'#475569'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
            ทั้งหมด <span style="opacity:.7">(${base.length})</span>
          </button>
          ${catList.map(([cat, n]) => `
            <button class="prod-cat-chip" data-pcat="${escHtml(cat)}" style="padding:6px 14px;border-radius:20px;border:1px solid ${currentCategory===cat?'#0284c7':'#e2e8f0'};background:${currentCategory===cat?'#0284c7':'#fff'};color:${currentCategory===cat?'#fff':'#475569'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
              ${escHtml(cat)} <span style="opacity:.7">(${n})</span>
            </button>
          `).join('')}
          <button id="prodAddCatBtn" title="เพิ่มหมวดใหม่" style="padding:6px 14px;border-radius:20px;border:1px dashed #0284c7;background:#f0f9ff;color:#0284c7;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
            + หมวดใหม่
          </button>
        </div>
        ${currentCategory !== 'all' ? `
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
            <button id="prodAddInCatBtn" data-cat="${escHtml(currentCategory)}" style="padding:8px 16px;border-radius:10px;border:none;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 4px rgba(2,132,199,.3)">
              + เพิ่มสินค้าในหมวด "${escHtml(currentCategory)}"
            </button>
            <button id="prodCatQrBtn" data-cat="${escHtml(currentCategory)}" title="QR Code ลิงก์เพิ่มในหมวดนี้" style="padding:8px 14px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer">
              📱 QR หมวดนี้
            </button>
          </div>
        ` : ''}
        `;
      })()}

      <!-- Product List / Grid -->
      <div class="${viewMode === 'grid' ? 'prod-grid' : 'prod-list'} mt16">
        ${pageItems.length ? pageItems.map(p => renderProductItem(p, viewMode, state)).join("") : `
          <div class="prod-empty">
            <div style="font-size:48px;margin-bottom:12px">📦</div>
            <div style="font-weight:700;font-size:16px;margin-bottom:4px">ไม่พบสินค้า</div>
            <div class="sku">${searchQuery ? 'ลองค้นหาด้วยคำอื่น' : 'กดปุ่ม "+ เพิ่มสินค้า" เพื่อเริ่มต้น'}</div>
          </div>
        `}
      </div>

      <!-- Pagination -->
      ${totalPages > 1 ? `
      <div class="prod-pagination mt16">
        <button class="contact-page-btn" data-ppage="1" ${currentPage === 1 ? 'disabled' : ''}>&laquo;</button>
        <button class="contact-page-btn" data-ppage="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>
        ${renderPageNumbers(currentPage, totalPages)}
        <button class="contact-page-btn" data-ppage="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>
        <button class="contact-page-btn" data-ppage="${totalPages}" ${currentPage === totalPages ? 'disabled' : ''}>&raquo;</button>
      </div>
      ` : ''}
    </div>

    <!-- Scanner Modal -->
    <div id="prodScannerModal" class="prod-scanner-modal hidden">
      <div class="prod-scanner-card">
        <div class="prod-scanner-head">
          <h3>สแกนบาร์โค้ดสินค้า</h3>
          <button id="prodScannerClose" class="btn light">ปิด</button>
        </div>
        <div id="prodScannerArea" class="pos-scanner-area mt16"></div>
        <div id="prodScannerResult" class="pos-scanner-result mt16"></div>
      </div>
    </div>

    <!-- Hidden import input -->
    <input type="file" id="prodFileInput" accept=".xlsx,.xls,.csv" style="display:none" />
  `;

  // ═══ BINDINGS (ใช้ el.querySelector เพื่อรองรับ multi-page) ═══
  el.querySelector("#prodEmptyAddBtn")?.addEventListener("click", () => {
    el.querySelector("#prodAddBtn")?.click();
  });
  el.querySelector("#prodAddBtn, .prod-add-btn")?.addEventListener("click", () => {
    // ★ pre-fill product_type ตาม tab ที่เลือกอยู่
    const opts = currentTypeFilter !== 'all' ? { prefillType: currentTypeFilter } : {};
    openProductDrawer(null, opts);
  });

  // ★ Product Type Tabs
  el.querySelectorAll("[data-ptype]").forEach(btn => btn.addEventListener("click", () => {
    currentTypeFilter = btn.dataset.ptype;
    currentFilter = "all"; // reset stock filter
    currentCategory = "all"; // reset category filter
    currentPage = 1;
    renderView(ctx);
  }));

  // ★ Category chips
  el.querySelectorAll("[data-pcat]").forEach(btn => btn.addEventListener("click", () => {
    currentCategory = btn.dataset.pcat;
    currentPage = 1;
    renderView(ctx);
  }));

  // ★ เพิ่มหมวดใหม่ — prompt หมวด แล้วเปิด drawer พร้อม prefill
  el.querySelector("#prodAddCatBtn")?.addEventListener("click", () => {
    const name = (prompt("ชื่อหมวดใหม่ (เช่น เครื่องดูดฝุ่น, พัดลม):") || "").trim();
    if (!name) return;
    currentCategory = name;
    const opts = { prefillCategory: name };
    if (currentTypeFilter !== 'all') opts.prefillType = currentTypeFilter;
    ctx.openProductDrawer(null, opts);
  });

  // ★ เพิ่มสินค้าในหมวดที่เลือกอยู่ — prefill category + type
  el.querySelector("#prodAddInCatBtn")?.addEventListener("click", (e) => {
    const cat = e.currentTarget.dataset.cat || "";
    const opts = { prefillCategory: cat };
    if (currentTypeFilter !== 'all') opts.prefillType = currentTypeFilter;
    ctx.openProductDrawer(null, opts);
  });

  // ★ ปุ่มจัดการหมวดหมู่
  el.querySelector("#prodManageCatBtn")?.addEventListener("click", () => openCategoryManagerDialog(ctx));

  // ★ QR Code ของหมวดนี้ — ลิงก์กลับมาหน้านี้ + เปิด drawer ทันที
  el.querySelector("#prodCatQrBtn")?.addEventListener("click", (e) => {
    const cat = e.currentTarget.dataset.cat || "";
    const url = `${window.location.origin}/#products?cat=${encodeURIComponent(cat)}&addNew=1`;
    showQrModal({
      title: `QR — เพิ่มสินค้าในหมวด "${cat}"`,
      subtitle: "สแกนด้วยมือถือ → เปิดหน้าเพิ่มสินค้าในหมวดนี้ทันที",
      text: url
    });
  });

  // ★ QR ของสินค้าแต่ละตัว — สำหรับพิมพ์ label
  el.querySelectorAll("[data-qr-prod]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = btn.dataset.qrProd;
    const p = (state.products || []).find(x => String(x.id) === String(id));
    if (!p) return;
    const code = p.barcode || p.sku || "";
    if (!code) return showToastFn("สินค้ายังไม่มี barcode / SKU");
    showQrModal({
      title: `QR — ${p.name || ""}`,
      subtitle: `${code}`,
      text: code,
      showPrint: true,
      productName: p.name
    });
  }));

  // Import / Export
  el.querySelector("#prodImportBtn")?.addEventListener("click", () => {
    el.querySelector("#prodFileInput")?.click();
  });
  el.querySelector("#prodExportBtn")?.addEventListener("click", () => {
    // ★ ถ้ามี filter active → ถามว่าจะ export filtered หรือ all
    const hasFilter = (currentTypeFilter !== 'all') || (currentFilter !== 'all') || (currentCategory !== 'all') || searchQuery || quickFilter;
    let exportList = state.products || [];
    if (hasFilter) {
      // คำนวณ filtered list อีกรอบ (เหมือน renderView)
      let f = [...exportList];
      if (currentTypeFilter !== 'all') f = f.filter(p => detectProductType(p) === currentTypeFilter);
      if (currentCategory !== 'all') f = f.filter(p => String(p.category || '') === currentCategory);
      if (currentFilter === 'instock') f = f.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > ds.min_stock; });
      else if (currentFilter === 'low') f = f.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > 0 && ds.stock <= ds.min_stock; });
      else if (currentFilter === 'out') f = f.filter(p => { const ds = getDisplayStock(state, p); return ds.stock <= 0; });
      if (quickFilter === 'no_cost') f = f.filter(p => detectProductType(p) === 'stock' && Number(p.cost || 0) === 0);
      else if (quickFilter === 'no_barcode') f = f.filter(p => detectProductType(p) === 'stock' && !String(p.barcode || '').trim());
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        f = f.filter(p =>
          String(p.name || "").toLowerCase().includes(q) ||
          String(p.sku || "").toLowerCase().includes(q) ||
          String(p.barcode || "").toLowerCase().includes(q)
        );
      }
      const choice = confirm(`พบ filter ที่ใช้อยู่ (${f.length} รายการ)\n\nกด OK = export เฉพาะ ${f.length} รายการที่กรอง\nกด Cancel = export ทั้งหมด ${exportList.length} รายการ`);
      if (choice) exportList = f;
    }
    exportProducts(state, exportList);
  });
  el.querySelector("#prodGenAllBarcodesBtn")?.addEventListener("click", () => generateAllBarcodes(ctx));
  el.querySelector("#prodPrintBarcodesBtn")?.addEventListener("click", () => openBulkBarcodePrintModal(ctx));
  el.querySelector("#prodDeleteAllBtn")?.addEventListener("click", () => deleteAllProducts(ctx));
  el.querySelector("#prodMergeCatBtn")?.addEventListener("click", () => openMergeCategoriesDialog(ctx));

  // ★ Bulk Mode Toggle
  el.querySelector("#prodBulkModeBtn")?.addEventListener("click", () => {
    bulkMode = !bulkMode;
    if (!bulkMode) bulkSelected.clear();
    renderView(ctx);
  });

  // ★ Bulk select per item
  el.querySelectorAll(".prod-bulk-cb").forEach(cb => cb.addEventListener("change", (e) => {
    const pid = String(cb.dataset.pid);
    if (cb.checked) bulkSelected.add(pid); else bulkSelected.delete(pid);
    renderView(ctx);
  }));

  // ★ Bulk action bar
  el.querySelector("#bulkSelectAllPageBtn")?.addEventListener("click", () => {
    el.querySelectorAll(".prod-bulk-cb").forEach(cb => bulkSelected.add(String(cb.dataset.pid)));
    renderView(ctx);
  });
  el.querySelector("#bulkClearBtn")?.addEventListener("click", () => {
    bulkSelected.clear();
    renderView(ctx);
  });
  el.querySelector("#bulkPriceUpBtn")?.addEventListener("click", () => bulkPriceChange(ctx));
  el.querySelector("#bulkSetCategoryBtn")?.addEventListener("click", () => bulkSetCategory(ctx));
  el.querySelector("#bulkSetTypeBtn")?.addEventListener("click", () => bulkSetType(ctx));
  el.querySelector("#bulkDeleteBtn")?.addEventListener("click", () => bulkDelete(ctx));

  // ★ Quick Filter chips
  el.querySelectorAll(".prod-quick-chip").forEach(btn => btn.addEventListener("click", () => {
    quickFilter = (quickFilter === btn.dataset.qf) ? "" : btn.dataset.qf;
    currentPage = 1;
    renderView(ctx);
  }));
  el.querySelector("#prodClearQuickFilter")?.addEventListener("click", () => {
    quickFilter = "";
    currentPage = 1;
    renderView(ctx);
  });
  el.querySelector("#prodFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importProducts(file, ctx);
    e.target.value = ""; // ★ reset เพื่อให้เลือกไฟล์เดิมซ้ำได้
  });

  // Filter tabs
  el.querySelectorAll("[data-pfilter]").forEach(btn => btn.addEventListener("click", () => {
    currentFilter = btn.dataset.pfilter;
    currentPage = 1;
    renderView(ctx);
  }));

  // Search (debounce 300ms — ไม่ค้างตอนพิมพ์)
  let _searchTimer = null;
  el.querySelector("#prodSearchInput")?.addEventListener("input", (e) => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      currentPage = 1;
      renderView(ctx);
    }, 300);
  });

  // Sort
  el.querySelector("#prodSortSelect")?.addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderView(ctx);
  });

  // ★ Warehouse selector
  el.querySelector("#warehouseSelect")?.addEventListener("change", (e) => {
    selectedWarehouse = e.target.value;
    currentPage = 1;
    renderView(ctx);
  });

  // View toggle
  el.querySelector("#prodViewToggle")?.addEventListener("click", () => {
    viewMode = viewMode === "list" ? "grid" : "list";
    renderView(ctx);
  });

  // Pagination
  el.querySelectorAll("[data-ppage]").forEach(btn => btn.addEventListener("click", () => {
    const p = Number(btn.dataset.ppage);
    if (p >= 1 && p <= totalPages) {
      currentPage = p;
      renderView(ctx);
    }
  }));

  // Edit buttons
  el.querySelectorAll("[data-prod-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.products.find(x => x.id === Number(btn.dataset.prodEdit));
    openProductDrawer(item);
  }));

  // Add to cart buttons
  el.querySelectorAll("[data-prod-add]").forEach(btn => btn.addEventListener("click", () => {
    addToCart(Number(btn.dataset.prodAdd));
    window.App?.showToast?.("เพิ่มลงบิลแล้ว");
  }));

  // ★ Quick Stock In — รับเข้าสต็อกตรงจากแถว
  el.querySelectorAll("[data-prod-stockin]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pid = btn.dataset.prodStockin;
    const prod = state.products.find(x => String(x.id) === String(pid));
    if (prod) openQuickStockInModal(prod, ctx);
  }));

  // ★ Print single barcode (per-item)
  el.querySelectorAll("[data-prod-print]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pid = Number(btn.dataset.prodPrint);
    const prod = state.products.find(x => x.id === pid);
    if (!prod || !prod.barcode) {
      window.App?.showToast?.("สินค้าไม่มีบาร์โค้ด");
      return;
    }
    openBarcodePrintWindow([{ name: prod.name, barcode: prod.barcode, price: prod.price, qty: 1 }]);
  }));

  // ★ Delete product (admin only)
  el.querySelectorAll("[data-prod-del]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const pid = Number(btn.dataset.prodDel);
    const prod = state.products.find(x => x.id === pid);
    if (!prod) return;
    window.App?.showConfirmModal?.(`ลบสินค้า "${prod.name}" ?\nลบแล้วไม่สามารถกู้คืนได้`, async () => {
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const res = await window._appXhrDelete("products", "id", pid);
        if (res?.ok || !res?.error) {
          state.products = state.products.filter(x => x.id !== pid);
          window.App?.showToast?.("ลบสินค้าเรียบร้อย");
          renderView(ctx);
        } else {
          window.App?.showToast?.("ลบไม่สำเร็จ: " + (res.error?.message || ""));
        }
      } catch (err) {
        console.error("[products delete] error:", err);
        window.App?.showToast?.("เกิดข้อผิดพลาด: " + (err.message || err));
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = "🗑️";
        }
      }
    });
  }));

  // Scanner
  el.querySelector("#prodScanBtn")?.addEventListener("click", () => openScanner(ctx));
  el.querySelector("#prodScannerClose")?.addEventListener("click", () => closeScanner());
}


// ═══════════════════════════════════════════════════════════
//  RENDER PRODUCT ITEM
// ═══════════════════════════════════════════════════════════
function renderProductItem(p, mode, state) {
  const _bulkChecked = bulkMode && bulkSelected.has(String(p.id));
  const _bulkCheckbox = bulkMode ? `<input type="checkbox" class="prod-bulk-cb" data-pid="${p.id}" ${_bulkChecked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;flex-shrink:0;margin-right:8px" onclick="event.stopPropagation()" />` : '';
  const pType = detectProductType(p);
  const ds = getDisplayStock(state, p);
  const stock = ds.stock;
  const minStock = ds.min_stock;
  let statusDot = "#22c55e"; // green = in stock
  let statusText = "พร้อมขาย";

  if (pType === "service") {
    statusDot = "#0284c7";
    statusText = "บริการ";
  } else if (stock <= 0) {
    statusDot = "#ef4444";
    statusText = "หมดสต็อก";
  } else if (stock <= minStock) {
    statusDot = "#f59e0b";
    statusText = "ใกล้หมด";
  }

  const typeBadge = pType === "service" ? '<span style="font-size:10px;background:#dbeafe;color:#0284c7;padding:1px 6px;border-radius:4px;font-weight:600">บริการ</span>'
    : pType === "non_stock" ? '<span style="font-size:10px;background:#fef3c7;color:#d97706;padding:1px 6px;border-radius:4px;font-weight:600">ไม่นับสต็อก</span>'
    : '';

  // ★ Active price (โปรหรือปลีก)
  const ap = getActivePrice(p);
  const priceStr = money(ap.price);
  const promoBadge = ap.isPromo ? `<span style="background:#dc2626;color:#fff;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;margin-left:4px">PROMO</span><span style="text-decoration:line-through;color:#94a3b8;font-size:11px;margin-left:4px">฿${money(ap.original)}</span>` : '';
  const featuredStar = p.is_featured ? `<span title="สินค้าแนะนำ" style="color:#f59e0b;margin-right:3px">⭐</span>` : '';
  const skuStr = p.sku ? escHtml(p.sku) : "";

  const isAdmin = (state.profile?.role === "admin");

  // ★ Multi-warehouse breakdown — สำหรับสินค้านับสต็อก (pType === stock)
  let whBreakdown = "";
  if (pType === "stock" && (state.warehouses || []).length > 1) {
    const parts = (state.warehouses || []).map(w => {
      const ws = (state.warehouseStock || []).find(s =>
        String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(w.id)
      );
      const n = Number(ws?.stock || 0);
      if (n === 0) return null;
      const shortName = String(w.name || "").replace(/^คลัง.+?[(\s]/, "").replace(/[)]/, "").trim() || w.name;
      return `<span style="display:inline-block;background:#f1f5f9;color:#475569;padding:1px 7px;border-radius:6px;margin-right:3px;font-size:10px;font-weight:600">${escHtml(shortName)}:${n}</span>`;
    }).filter(Boolean);
    if (parts.length > 0) whBreakdown = `<div style="margin-top:3px">${parts.join("")}</div>`;
  }

  // ★ Stock turnover — กี่วันจะหมด (avg ขาย 30 วันล่าสุด)
  let turnoverHint = "";
  if (pType === "stock" && stock > 0) {
    const last30Key = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
    const recentSaleIds = new Set(
      (state.sales || []).filter(s => !(s.note || "").includes("[ลบแล้ว]") && String(s.created_at || "").slice(0, 10) >= last30Key)
        .map(s => String(s.id))
    );
    let qty30 = 0;
    (state.saleItems || []).forEach(it => {
      if (recentSaleIds.has(String(it.sale_id)) && String(it.product_id) === String(p.id)) {
        qty30 += Number(it.qty || 0);
      }
    });
    if (qty30 > 0) {
      const avgPerDay = qty30 / 30;
      const daysLeft = Math.floor(stock / avgPerDay);
      const color = daysLeft <= 7 ? "#dc2626" : daysLeft <= 14 ? "#f59e0b" : "#94a3b8";
      turnoverHint = `<span style="color:${color};font-size:11px;margin-left:4px" title="ขายเฉลี่ย ${avgPerDay.toFixed(1)}/วัน">≈${daysLeft}วัน</span>`;
    }
  }

  if (mode === "grid") {
    return `
      <div class="prod-grid-card" style="${_bulkChecked ? 'background:#dbeafe;border:2px solid #0284c7' : ''}">
        ${bulkMode ? `<div style="position:absolute;top:8px;left:8px;z-index:2">${_bulkCheckbox}</div>` : ''}
        <div class="prod-grid-avatar-wrap">
          ${getProductAvatar(p)}
          <span class="prod-stock-indicator" style="background:${statusDot}" title="${statusText}"></span>
        </div>
        <div class="prod-grid-name" data-prod-edit="${p.id}" style="cursor:pointer" title="คลิกเพื่อแก้ไข">${featuredStar}${escHtml(p.name || "-")}</div>
        ${skuStr ? `<div class="sku">${skuStr}</div>` : ''}
        <div class="prod-grid-price">฿${priceStr}${promoBadge}</div>
        <div class="prod-grid-stock">คงเหลือ ${stock}${turnoverHint}</div>
        ${whBreakdown}
        <div class="prod-grid-actions">
          <button class="btn light" style="padding:6px 10px;font-size:12px" data-prod-edit="${p.id}">แก้ไข</button>
          <button class="btn primary" style="padding:6px 10px;font-size:12px" data-prod-add="${p.id}">+ บิล</button>
          ${pType === "stock" ? `<button class="btn light" style="padding:6px 8px;font-size:12px;color:#059669;border-color:#a7f3d0" data-prod-stockin="${p.id}" title="รับสต็อกเข้า">+📦</button>` : ''}
          ${pType === "stock" && (p.barcode || p.sku) ? `<button class="btn light" style="padding:6px 8px;font-size:12px" data-qr-prod="${p.id}" title="QR Code สินค้า">📱</button>` : ''}
          ${pType === "stock" && p.barcode ? `<button class="btn light" style="padding:6px 8px;font-size:12px" data-prod-print="${p.id}" title="พิมพ์บาร์โค้ด">🖨️</button>` : ''}
          ${isAdmin ? `<button class="btn" style="padding:6px 8px;font-size:12px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer" data-prod-del="${p.id}" title="ลบสินค้า">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }

  // List mode
  return `
    <div class="prod-list-item" style="${_bulkChecked ? 'background:#dbeafe;border:2px solid #0284c7' : ''}">
      <div class="prod-list-left">
        ${_bulkCheckbox}
        <div class="prod-avatar-wrap">
          ${getProductAvatar(p)}
          <span class="prod-stock-indicator" style="background:${statusDot}" title="${statusText}"></span>
        </div>
        <div class="prod-list-info">
          <div class="prod-list-name" data-prod-edit="${p.id}" style="cursor:pointer" title="คลิกเพื่อแก้ไข">${featuredStar}<span style="border-bottom:1px dashed transparent;transition:color .15s,border-color .15s" onmouseover="this.style.color='#0284c7';this.style.borderColor='#0284c7'" onmouseout="this.style.color='';this.style.borderColor='transparent'">${escHtml(p.name || "-")}</span> ${typeBadge}</div>
          ${skuStr ? `<div class="prod-list-sku">${skuStr}</div>` : ''}
          ${p.category ? `<div class="prod-list-sku" style="color:#6b7280">${escHtml(p.category)}</div>` : ''}
          ${pType === "stock" && p.barcode ? `<div class="prod-list-sku">บาร์โค้ด: ${escHtml(p.barcode)}</div>` : ''}
        </div>
      </div>
      <div class="prod-list-right">
        <div class="prod-list-price">฿${priceStr}${promoBadge}</div>
        ${pType !== "service" ? `<div class="prod-list-stock">คงเหลือ <strong>${stock}</strong>${turnoverHint}</div>` : ''}
        ${whBreakdown}
        <div class="prod-list-actions">
          <button class="btn light" style="padding:6px 10px;font-size:12px" data-prod-edit="${p.id}">•••</button>
          <button class="btn primary" style="padding:6px 10px;font-size:12px" data-prod-add="${p.id}">+ บิล</button>
          ${pType === "stock" ? `<button class="btn light" style="padding:6px 8px;font-size:12px;color:#059669;border-color:#a7f3d0" data-prod-stockin="${p.id}" title="รับสต็อกเข้า">+📦</button>` : ''}
          ${pType === "stock" && (p.barcode || p.sku) ? `<button class="btn light" style="padding:6px 8px;font-size:12px" data-qr-prod="${p.id}" title="QR Code สินค้า">📱</button>` : ''}
          ${pType === "stock" && p.barcode ? `<button class="btn light" style="padding:6px 8px;font-size:12px" data-prod-print="${p.id}" title="พิมพ์บาร์โค้ด">🖨️</button>` : ''}
          ${isAdmin ? `<button class="btn" style="padding:6px 8px;font-size:12px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer" data-prod-del="${p.id}" title="ลบสินค้า">🗑️</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderPageNumbers(current, total) {
  let pages = [];
  const range = 2;
  for (let i = Math.max(1, current - range); i <= Math.min(total, current + range); i++) {
    pages.push(i);
  }
  return pages.map(p =>
    `<button class="contact-page-btn ${p === current ? 'active' : ''}" data-ppage="${p}">${p}</button>`
  ).join("");
}


// ═══════════════════════════════════════════════════════════
//  BARCODE SCANNER
// ═══════════════════════════════════════════════════════════
let scannerInstance = null;

function openScanner(ctx) {
  document.getElementById("prodScannerModal")?.classList.remove("hidden");
  document.getElementById("prodScannerResult").innerHTML = "";

  const scanArea = document.getElementById("prodScannerArea");
  if (!scanArea) return;
  scanArea.innerHTML = "";

  try {
    if (typeof Html5Qrcode === "undefined") {
      scanArea.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">ไม่พบไลบรารี Scanner</div>';
      return;
    }

    scannerInstance = new Html5Qrcode("prodScannerArea");
    scannerInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 160 } },
      (code) => handleScanResult(code, ctx),
      () => {}
    ).catch(err => {
      scanArea.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">ไม่สามารถเปิดกล้อง: ${escHtml(err && err.message || err)}</div>`;
    });
  } catch (err) {
    scanArea.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">เกิดข้อผิดพลาด: ${escHtml(err && err.message || err)}</div>`;
  }
}

function closeScanner() {
  if (scannerInstance) {
    try {
      const st = typeof scannerInstance.getState === "function" ? scannerInstance.getState() : null;
      // html5-qrcode: NotStarted=1, Scanning=2, Paused=3 — stop() เฉพาะเมื่อสแกนอยู่เท่านั้น
      if (st === 2 || st === 3) {
        scannerInstance.stop().catch(e =>
          console.warn("[products] scanner stop (safe to ignore):", e?.message || e));
      }
    } catch (e) {
      console.warn("[products] scanner stop error (safe to ignore):", e?.message || e);
    }
    scannerInstance = null;
  }
  document.getElementById("prodScannerModal")?.classList.add("hidden");
}

function handleScanResult(code, ctx) {
  const { state } = ctx;
  const resultEl = document.getElementById("prodScannerResult");
  if (!resultEl) return;

  const product = state.products.find(p =>
    String(p.barcode || "").toLowerCase() === code.toLowerCase() ||
    String(p.sku || "").toLowerCase() === code.toLowerCase()
  );

  if (product) {
    resultEl.innerHTML = `
      <div class="panel" style="border-color:var(--success)">
        <div style="font-weight:900;color:var(--success)">✓ พบสินค้า</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${escHtml(product.name)}</div>
        <div class="sku">${escHtml(product.sku || "")} | คงเหลือ ${product.stock}</div>
      </div>
    `;
    // Auto-fill search
    searchQuery = code;
    closeScanner();
    renderView(ctx);
  } else {
    resultEl.innerHTML = `
      <div class="panel" style="border-color:var(--danger)">
        <div style="font-weight:900;color:var(--danger)">✗ ไม่พบสินค้า</div>
        <div class="sku">รหัส: ${escHtml(code)}</div>
      </div>
    `;
  }
}


// ═══════════════════════════════════════════════════════════
//  IMPORT FROM EXCEL
// ═══════════════════════════════════════════════════════════
async function importProducts(file, ctx) {
  const { state } = ctx;
  window.App?.showToast?.("กำลังนำเข้าสินค้า...");

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // ★ อ่านเป็น array of arrays (เหมือน customers — robust header detection)
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // rawRows parsed

    // ★ ค้นหา header row อัตโนมัติ
    let headerIdx = -1;
    const HEADER_HINTS = ["ชื่อสินค้า", "สินค้า", "รหัสสินค้า", "SKU", "ราคา", "price", "name", "product", "barcode", "productcode", "unitprice", "buyprice"];
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const rowStr = rawRows[i].map(c => String(c).trim()).join("|").toLowerCase();
      const matchCount = HEADER_HINTS.filter(h => rowStr.includes(h.toLowerCase())).length;
      if (matchCount >= 2) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      headerIdx = rawRows.length > 1 && rawRows[0].filter(c => String(c).trim()).length <= 2 ? 1 : 0;
    }
    // header found

    const headers = rawRows[headerIdx].map(h => String(h).trim());
    const dataRows = rawRows.slice(headerIdx + 1).filter(r => r.some(c => String(c).trim() !== ""));

    if (!dataRows.length) {
      window.App?.showToast?.("ไม่พบข้อมูลในไฟล์");
      return;
    }

    // ★ Column index mapper
    function findColIdx(...keywords) {
      for (const kw of keywords) {
        const idx = headers.findIndex(h => h === kw);
        if (idx !== -1) return idx;
      }
      for (const kw of keywords) {
        const idx = headers.findIndex(h => h.includes(kw));
        if (idx !== -1) return idx;
      }
      return -1;
    }

    const COL = {
      name:     findColIdx("ชื่อสินค้า", "สินค้า", "Name", "name", "Product"),
      sku:      findColIdx("รหัสสินค้า", "SKU", "sku", "Sku", "ProductCode"),
      price:    findColIdx("ราคาขาย", "ราคา", "UnitPrice", "price", "Price"),
      cost:     findColIdx("ต้นทุน", "BuyPrice", "cost", "Cost"),
      stock:    findColIdx("คงเหลือ", "สต็อก", "stock", "Stock"),
      minStock: findColIdx("สต็อกขั้นต่ำ", "ขั้นต่ำ", "min_stock", "Min Stock"),
      barcode:  findColIdx("บาร์โค้ด", "BarCode", "barcode", "Barcode"),
      unit:     findColIdx("หน่วย", "Unit", "unit"),
      category: findColIdx("หมวดหมู่", "Category", "category")
    };
    // columns mapped

    function getVal(row, colIdx) {
      if (colIdx === -1 || row[colIdx] === undefined) return "";
      return String(row[colIdx]).trim();
    }

    let imported = 0, failed = 0;

    for (const row of dataRows) {
      const name = getVal(row, COL.name);
      if (!name) { failed++; continue; }

      const category = getVal(row, COL.category);
      const unit = getVal(row, COL.unit);

      // ★ จำแนกประเภทอัตโนมัติจาก category/name
      const cleanText = (name + " " + category).replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, "").toLowerCase();
      let product_type = "stock"; // default = นับสต็อก
      if (SERVICE_KEYWORDS.some(kw => cleanText.includes(kw.toLowerCase()))) {
        product_type = "service";
      }

      const payload = {
        name: name,
        sku: getVal(row, COL.sku),
        price: Number(getVal(row, COL.price) || 0),
        cost: Number(getVal(row, COL.cost) || 0),
        stock: Number(getVal(row, COL.stock) || 0),
        min_stock: Number(getVal(row, COL.minStock) || 0),
        barcode: getVal(row, COL.barcode),
        category: category,
        product_type: product_type
      };

      // ★ ถ้าไม่มี SKU → auto-generate
      if (!payload.sku) {
        payload.sku = "AUTO-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4);
      }

      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;

      // ★ UPSERT → ถ้า 409 → PATCH fallback
      const ok = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", cfg.url + "/rest/v1/products?on_conflict=sku");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("apikey", cfg.anonKey);
        xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
        xhr.setRequestHeader("Prefer", "resolution=merge-duplicates");
        xhr.timeout = 10000;
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(true);
          } else if (xhr.status === 409) {
            // UPSERT conflict → PATCH fallback
            const patchData = { ...payload }; delete patchData.sku;
            const xhr2 = new XMLHttpRequest();
            xhr2.open("PATCH", cfg.url + "/rest/v1/products?sku=eq." + encodeURIComponent(payload.sku));
            xhr2.setRequestHeader("Content-Type", "application/json");
            xhr2.setRequestHeader("apikey", cfg.anonKey);
            xhr2.setRequestHeader("Authorization", "Bearer " + accessToken);
            xhr2.setRequestHeader("Prefer", "return=minimal");
            xhr2.timeout = 10000;
            xhr2.onload = () => resolve(xhr2.status >= 200 && xhr2.status < 300);
            xhr2.onerror = () => resolve(false);
            xhr2.ontimeout = () => resolve(false);
            xhr2.send(JSON.stringify(patchData));
          } else {
            console.warn("Import product failed:", xhr.status, xhr.responseText);
            resolve(false);
          }
        };
        xhr.onerror = () => resolve(false);
        xhr.ontimeout = () => resolve(false);
        xhr.send(JSON.stringify([payload]));
      });

      if (ok) imported++; else failed++;
    }

    window.App?.showToast?.(`นำเข้าสำเร็จ ${imported} รายการ${failed ? `, ล้มเหลว ${failed}` : ''}`);
    clearTypeCache();
    if (window.App?.loadAllData) await window.App.loadAllData();
    renderView(ctx);

  } catch (err) {
    console.error("Import error:", err);
    window.App?.showToast?.("นำเข้าไม่สำเร็จ: " + (err.message || err));
  }
}


// ═══════════════════════════════════════════════════════════
//  พิมพ์บาร์โค้ดสติ๊กเกอร์ (เปิดหน้าต่างใหม่ + auto print)
//  items = [{name, barcode, price, qty}]  — qty = จำนวนสติ๊กเกอร์
// ═══════════════════════════════════════════════════════════
export function openBarcodePrintWindow(items) {
  const valid = (items || []).filter(it => it && it.barcode && String(it.barcode).trim());
  if (valid.length === 0) {
    window.App?.showToast?.("ไม่มีบาร์โค้ดให้พิมพ์");
    return;
  }

  // ★ ขยายตาม qty
  const stickers = [];
  valid.forEach(it => {
    const qty = Math.max(1, Math.min(200, Number(it.qty || 1))); // cap 200 ป้าย/ตัว กันพิมพ์เกิน
    for (let i = 0; i < qty; i++) stickers.push(it);
  });

  const w = window.open("", "barcode-print", "width=900,height=700");
  if (!w) {
    window.App?.showToast?.("กรุณาอนุญาต pop-up เพื่อพิมพ์บาร์โค้ด");
    return;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const fmtPrice = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<title>พิมพ์บาร์โค้ด — ${stickers.length} ป้าย (50×30mm)</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Prompt', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: #eef2f7; color: #0f172a; }

  /* ═══ TOOLBAR (ซ่อนตอนพิมพ์) ═══ */
  .toolbar { position: sticky; top: 0; background: #fff; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 10px; align-items: center; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,.04); flex-wrap: wrap; }
  .toolbar button { padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: #0284c7; color: #fff; border-color: #0284c7; }
  .btn-gray { background: #fff; color: #334155; border-color: #cbd5e1; }
  .toolbar select { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 600; background: #fff; cursor: pointer; }
  .toolbar label { font-size: 13px; color: #475569; font-weight: 600; }
  .toolbar .count { margin-left: auto; color: #64748b; font-size: 13px; font-weight: 600; }
  .toolbar .hint { display: block; width: 100%; font-size: 11px; color: #64748b; margin-top: 4px; }

  /* ═══ STICKER 50×30mm (สำหรับ label printer) ═══ */
  .sheet { padding: 20px; display: flex; flex-wrap: wrap; gap: 8px; background: #eef2f7; }
  .sticker {
    width: 50mm; height: 30mm;
    padding: 1.5mm 2mm 1mm;
    background: #fff;
    border: 1px dashed #cbd5e1; /* แสดงขอบตอนดูใน browser — ไม่พิมพ์ */
    display: flex; flex-direction: column;
    page-break-after: always; break-after: page;
    overflow: hidden;
  }
  .sticker:last-child { page-break-after: auto; }
  .sticker .shop { font-size: 7pt; color: #666; text-align: center; line-height: 1; letter-spacing: .2px; }
  .sticker .name {
    font-size: 8pt; font-weight: 700; color: #0f172a;
    text-align: center;
    line-height: 1.1;
    margin: .5mm 0;
    overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    max-height: 2.4em; min-height: 1.1em;
  }
  .sticker .bc-wrap { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
  .sticker svg { display: block; max-width: 46mm; max-height: 11mm; }
  .sticker .price { font-size: 10pt; font-weight: 800; color: #0284c7; text-align: center; line-height: 1; margin-top: .5mm; }

  /* ═══ PRINT ═══ */
  @page { size: 50mm 30mm; margin: 0; }
  @media print {
    .toolbar { display: none !important; }
    body { background: #fff; }
    .sheet { padding: 0; gap: 0; background: #fff; }
    .sticker { border: none; margin: 0; }
    .sticker .price { color: #000 !important; } /* บางเครื่องพิมพ์ไม่เอาสี — เปลี่ยนเป็นดำ */
  }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn-primary" onclick="window.print()">🖨️ พิมพ์</button>
  <label for="sz">ขนาด:</label>
  <select id="sz" onchange="changeSize(this.value)">
    <option value="50x30" selected>50×30 mm (Label printer)</option>
    <option value="40x25">40×25 mm (เล็ก)</option>
    <option value="70x40">70×40 mm (ใหญ่)</option>
  </select>
  <button class="btn-gray" onclick="window.close()">ปิด</button>
  <span class="count">${stickers.length} ป้าย</span>
  <span class="hint">💡 ตั้งค่าเครื่องพิมพ์: Paper size = 50×30mm, Margin = 0, Scale = 100%</span>
</div>
<div id="sheet" class="sheet">
${stickers.map(s => `
  <div class="sticker">
    <div class="shop">บุญสุขแอร์</div>
    <div class="name">${esc(s.name || '-')}</div>
    <div class="bc-wrap"><svg class="bc" data-code="${esc(s.barcode)}"></svg></div>
    ${s.price != null && Number(s.price) > 0 ? `<div class="price">฿${esc(fmtPrice(s.price))}</div>` : ''}
  </div>`).join('')}
</div>
<script>
  var SIZES = {
    "50x30": { w: "50mm", h: "30mm", bcH: 11, bcMax: 46, fontN: "8pt", fontP: "10pt" },
    "40x25": { w: "40mm", h: "25mm", bcH: 9,  bcMax: 36, fontN: "7pt", fontP: "9pt" },
    "70x40": { w: "70mm", h: "40mm", bcH: 14, bcMax: 66, fontN: "10pt", fontP: "12pt" }
  };
  function changeSize(key) {
    var sz = SIZES[key] || SIZES["50x30"];
    // update stylesheet
    var style = document.getElementById("dynSize") || (function(){ var s = document.createElement("style"); s.id = "dynSize"; document.head.appendChild(s); return s; })();
    style.textContent =
      "@page { size: " + sz.w + " " + sz.h + "; margin: 0; }" +
      ".sticker { width: " + sz.w + "; height: " + sz.h + "; }" +
      ".sticker svg { max-width: " + sz.bcMax + "mm; max-height: " + sz.bcH + "mm; }" +
      ".sticker .name { font-size: " + sz.fontN + "; }" +
      ".sticker .price { font-size: " + sz.fontP + "; }";
    // re-render barcodes ให้พอดีขนาดใหม่
    renderBarcodes(sz.bcH);
  }
  function renderBarcodes(heightMM) {
    var heightPx = Math.round((heightMM || 11) * 3.78); // ~3.78 px/mm @ 96dpi
    document.querySelectorAll('svg.bc').forEach(function(svg) {
      var code = svg.dataset.code;
      if (!code) return;
      try {
        JsBarcode(svg, code, {
          format: "CODE128",
          width: 1.2,
          height: heightPx,
          displayValue: true,
          fontSize: 9,
          margin: 0,
          textMargin: 1,
          textAlign: "center"
        });
      } catch(e) {
        var div = document.createElement('div');
        div.style.cssText = 'color:#999;font-size:9px;font-family:monospace;padding:4px';
        div.textContent = code;
        svg.parentNode.replaceChild(div, svg);
      }
    });
  }
  window.addEventListener('load', function() {
    renderBarcodes(11);
    setTimeout(function() { window.print(); }, 500);
  });
<\/script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ★ expose ให้ module อื่น / drawer เรียกได้
if (typeof window !== "undefined") {
  window.openBarcodePrintWindow = openBarcodePrintWindow;
}

// ═══════════════════════════════════════════════════════════
//  Modal เลือกสินค้า + จำนวน เพื่อพิมพ์บาร์โค้ดหลายใบ
// ═══════════════════════════════════════════════════════════
function openBulkBarcodePrintModal(ctx) {
  const { state } = ctx;
  const products = (state.products || []).filter(p => {
    const t = detectProductType(p);
    return t === "stock" && p.barcode && String(p.barcode).trim();
  });

  if (products.length === 0) {
    window.App?.showToast?.("ยังไม่มีสินค้านับสต็อกที่มีบาร์โค้ด — กด 'สร้างบาร์โค้ด' ก่อน");
    return;
  }

  // ลบ modal เดิมถ้ามี
  document.getElementById("bulkBarcodePrintModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "bulkBarcodePrintModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:640px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:16px;font-weight:800;color:#0284c7">🖨️ พิมพ์บาร์โค้ดสติ๊กเกอร์</h3>
        <button id="bbpClose" class="btn light" style="font-size:12px">ปิด</button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="bbpSearch" placeholder="🔍 ค้นหาสินค้า/บาร์โค้ด" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px" />
        <button id="bbpSelectAll" class="btn light" style="font-size:12px">เลือกทั้งหมด</button>
        <button id="bbpClearAll" class="btn light" style="font-size:12px">ล้างการเลือก</button>
      </div>
      <div id="bbpList" style="flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:4px"></div>
      <div style="padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:#f8fafc">
        <div id="bbpSummary" style="font-size:13px;color:#475569;font-weight:600">เลือกแล้ว 0 รายการ / 0 ป้าย</div>
        <button id="bbpPrint" class="btn primary" style="font-size:13px;padding:8px 16px">🖨️ พิมพ์บาร์โค้ด</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // State
  const selected = new Map(); // id → qty

  const renderList = (q) => {
    const query = (q || "").toLowerCase();
    const filtered = query ? products.filter(p =>
      String(p.name || "").toLowerCase().includes(query) ||
      String(p.barcode || "").toLowerCase().includes(query) ||
      String(p.sku || "").toLowerCase().includes(query)
    ) : products;

    const list = document.getElementById("bbpList");
    if (!list) return;
    list.innerHTML = filtered.length ? filtered.map(p => {
      const qty = selected.get(p.id) || 0;
      const checked = qty > 0;
      return `
        <div class="bbp-row" data-id="${p.id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ${checked ? '#bae6fd' : '#f1f5f9'};border-radius:8px;background:${checked ? '#f0f9ff' : '#fff'}">
          <input type="checkbox" class="bbp-check" data-id="${p.id}" ${checked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer" />
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name || '-')}</div>
            <div style="font-size:11px;color:#64748b">${escHtml(p.barcode)} · ฿${money(p.price)}</div>
          </div>
          <input type="number" class="bbp-qty" data-id="${p.id}" min="1" max="200" value="${qty || 1}" style="width:64px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:center" ${checked ? '' : 'disabled'} />
        </div>
      `;
    }).join("") : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">ไม่พบสินค้า</div>';

    bindListEvents();
  };

  const updateSummary = () => {
    const items = Array.from(selected.entries()).filter(([_, q]) => q > 0);
    const totalStickers = items.reduce((s, [_, q]) => s + q, 0);
    const el = document.getElementById("bbpSummary");
    if (el) el.textContent = `เลือกแล้ว ${items.length} รายการ / ${totalStickers} ป้าย`;
  };

  const bindListEvents = () => {
    document.querySelectorAll(".bbp-check").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const id = Number(e.target.dataset.id);
        const qtyInput = document.querySelector(`.bbp-qty[data-id="${id}"]`);
        if (e.target.checked) {
          const q = Math.max(1, Number(qtyInput?.value || 1));
          selected.set(id, q);
          if (qtyInput) qtyInput.disabled = false;
          const row = document.querySelector(`.bbp-row[data-id="${id}"]`);
          if (row) { row.style.background = "#f0f9ff"; row.style.borderColor = "#bae6fd"; }
        } else {
          selected.delete(id);
          if (qtyInput) qtyInput.disabled = true;
          const row = document.querySelector(`.bbp-row[data-id="${id}"]`);
          if (row) { row.style.background = "#fff"; row.style.borderColor = "#f1f5f9"; }
        }
        updateSummary();
      });
    });
    document.querySelectorAll(".bbp-qty").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const id = Number(e.target.dataset.id);
        const q = Math.max(1, Math.min(200, Number(e.target.value || 1)));
        if (selected.has(id)) { selected.set(id, q); updateSummary(); }
      });
    });
  };

  // Wire modal buttons
  document.getElementById("bbpClose")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById("bbpSearch")?.addEventListener("input", (e) => renderList(e.target.value));

  document.getElementById("bbpSelectAll")?.addEventListener("click", () => {
    products.forEach(p => { if (!selected.has(p.id)) selected.set(p.id, 1); });
    renderList(document.getElementById("bbpSearch")?.value || "");
    updateSummary();
  });

  document.getElementById("bbpClearAll")?.addEventListener("click", () => {
    selected.clear();
    renderList(document.getElementById("bbpSearch")?.value || "");
    updateSummary();
  });

  document.getElementById("bbpPrint")?.addEventListener("click", () => {
    const items = Array.from(selected.entries())
      .filter(([_, q]) => q > 0)
      .map(([id, qty]) => {
        const p = products.find(x => x.id === id);
        return p ? { name: p.name, barcode: p.barcode, price: p.price, qty } : null;
      })
      .filter(Boolean);

    if (items.length === 0) {
      window.App?.showToast?.("กรุณาเลือกอย่างน้อย 1 รายการ");
      return;
    }
    openBarcodePrintWindow(items);
    modal.remove();
  });

  renderList("");
  updateSummary();
}


// ═══════════════════════════════════════════════════════════
//  สร้างบาร์โค้ดอัตโนมัติให้สินค้าที่ยังไม่มี
// ═══════════════════════════════════════════════════════════
function generateBarcodeEAN13() {
  const prefix = "200";
  const rand = String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 100)).padStart(2, "0");
  const base = prefix + rand;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + ((10 - (sum % 10)) % 10);
}

async function generateAllBarcodes(ctx) {
  const { state } = ctx;
  const products = state.products || [];
  // เฉพาะ "สินค้านับสต็อก" ที่ยังไม่มีบาร์โค้ด (ข้ามบริการ/ไม่นับสต็อก)
  const noBarcode = products.filter(p => {
    const type = detectProductType(p);
    return type === "stock" && (!p.barcode || !p.barcode.trim());
  });

  if (noBarcode.length === 0) {
    window.App?.showToast?.("สินค้านับสต็อกทุกตัวมีบาร์โค้ดแล้ว");
    return;
  }

  if (!(await window.App?.confirm?.(`สร้างบาร์โค้ดให้สินค้านับสต็อก ${noBarcode.length} รายการที่ยังไม่มี?\n(ข้ามบริการ + สินค้าไม่นับสต็อก)`))) return;

  window.App?.showToast?.(`กำลังสร้างบาร์โค้ด ${noBarcode.length} รายการ...`);

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  let success = 0, failed = 0;

  for (const p of noBarcode) {
    const barcode = generateBarcodeEAN13();
    const ok = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + p.id);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 10000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          p.barcode = barcode; // อัปเดต local state
          resolve(true);
        } else { resolve(false); }
      };
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.send(JSON.stringify({ barcode }));
    });
    if (ok) success++; else failed++;
  }

  window.App?.showToast?.(`สร้างบาร์โค้ดสำเร็จ ${success} รายการ${failed ? `, ล้มเหลว ${failed}` : ''}`);
  if (window.App?.loadAllData) await window.App.loadAllData();
  renderView(ctx);
}


// ═══════════════════════════════════════════════════════════
//  ลบสินค้าทั้งหมด (เพื่อนำเข้าใหม่)
// ═══════════════════════════════════════════════════════════
async function deleteAllProducts(ctx) {
  const { state } = ctx;
  const products = state.products || [];
  if (products.length === 0) {
    window.App?.showToast?.("ไม่มีสินค้าให้ลบ");
    return;
  }

  if (!(await window.App?.confirm?.(`⚠️ ลบสินค้าทั้งหมด ${products.length} รายการ?\n\nหลังลบแล้วสามารถนำเข้าใหม่จาก Excel ได้เลย\n(โค้ดใหม่จะแยกบริการ/สินค้าให้อัตโนมัติ)`))) return;
  if (!(await window.App?.confirm?.("ยืนยันอีกครั้ง: ลบสินค้าทั้งหมด?"))) return;

  window.App?.showToast?.(`กำลังลบ ${products.length} รายการ...`);

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;

  // ลบทีละ batch (ใช้ DELETE with filter)
  const ok = await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    // ลบทุก record ที่ is_active is not null (= ทั้งหมด)
    xhr.open("DELETE", cfg.url + "/rest/v1/products?id=gt.0");
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.setRequestHeader("Prefer", "return=minimal");
    xhr.timeout = 30000;
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send();
  });

  if (ok) {
    // ลบ warehouse_stock ด้วย
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("DELETE", cfg.url + "/rest/v1/warehouse_stock?id=gt.0");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 15000;
      xhr.onload = () => resolve(true);
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.send();
    });

    clearTypeCache();
    state.products = [];
    state.warehouseStock = [];
    window.App?.showToast?.("ลบสินค้าทั้งหมดแล้ว — กด 'นำเข้า' เพื่อนำเข้าใหม่");
    renderView(ctx);
  } else {
    window.App?.showToast?.("ลบไม่สำเร็จ กรุณาลองใหม่");
  }
}


// ═══════════════════════════════════════════════════════════
//  EXPORT TO EXCEL
// ═══════════════════════════════════════════════════════════
function exportProducts(state, customList) {
  try {
    const TYPE_LABELS = { service: "บริการ", non_stock: "ไม่นับสต็อก", stock: "นับสต็อก" };
    const sourceList = Array.isArray(customList) ? customList : (state.products || []);
    const items = sourceList.map(p => ({
      "ประเภท": TYPE_LABELS[detectProductType(p)] || "นับสต็อก",
      "ชื่อสินค้า": p.name || "",
      "รหัสสินค้า (SKU)": p.sku || "",
      "หมวดหมู่": p.category || "",
      "บาร์โค้ด": p.barcode || "",
      "ราคาขาย": p.price || 0,
      "ราคาส่ง": p.price_wholesale || "",
      "ต้นทุน": p.cost || 0,
      "คงเหลือ": p.stock || 0,
      "สต็อกขั้นต่ำ": p.min_stock || 0
    }));

    const ws = XLSX.utils.json_to_sheet(items);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สินค้า");

    ws["!cols"] = [
      { wch: 14 }, { wch: 35 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }
    ];

    const date = new Date().toISOString().slice(0, 10);
    const suffix = customList ? `_filtered_${items.length}` : "";
    XLSX.writeFile(wb, `สินค้า_บุญสุข${suffix}_${date}.xlsx`);
    window.App?.showToast?.(`ส่งออก ${items.length} รายการสำเร็จ`);
  } catch (err) {
    window.App?.showToast?.("ส่งออกไม่สำเร็จ: " + (err.message || err));
  }
}

function showToastFn(msg) { window.App?.showToast?.(msg); }

// ═══════════════════════════════════════════════════════════
//  QUICK STOCK IN MODAL — รับเข้าสต็อกตรงจากหน้าสินค้า
// ═══════════════════════════════════════════════════════════
function openQuickStockInModal(product, ctx) {
  const { state } = ctx;
  document.getElementById("bskQuickStockInModal")?.remove();

  // หาคลังบ้าน default
  const homeWh = (state.warehouses || []).find(w => (w.name || "").includes("บ้าน"));
  const defaultWhId = homeWh?.id || (state.warehouses || [])[0]?.id || "";

  const modal = document.createElement("div");
  modal.id = "bskQuickStockInModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0;color:#059669">📦 รับสต็อกเข้า</h3>
        <button id="qsiClose" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748b">×</button>
      </div>
      <div style="background:#f0fdf4;padding:10px 12px;border-radius:8px;margin-bottom:12px;border:1px solid #bbf7d0">
        <div style="font-weight:700;font-size:14px">${escHtml(product.name || "-")}</div>
        <div style="font-size:11px;color:#64748b">${escHtml(product.sku || "")} ${product.barcode ? "• " + escHtml(product.barcode) : ""}</div>
      </div>
      <div style="display:grid;gap:12px">
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">คลังที่จะรับเข้า:</label>
          <select id="qsiWh" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}" ${String(w.id) === String(defaultWhId) ? 'selected' : ''}>${escHtml(w.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">จำนวนรับเข้า:</label>
          <input id="qsiQty" type="number" min="1" step="1" value="1" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;font-weight:700;text-align:center" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">ต้นทุนใหม่ต่อชิ้น (ถ้าเปลี่ยน):</label>
          <input id="qsiCost" type="number" min="0" step="0.01" placeholder="ปัจจุบัน ฿${money(product.cost || 0)} — เว้นว่างถ้าไม่เปลี่ยน" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">หมายเหตุ:</label>
          <input id="qsiNote" type="text" placeholder="เช่น ซื้อจาก ABC supplier (Inv #12345)" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="qsiCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="qsiSave" style="flex:1;padding:10px;border:none;background:#059669;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">+ รับเข้า</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector("#qsiQty")?.focus(), 50);

  modal.querySelector("#qsiClose").addEventListener("click", () => modal.remove());
  modal.querySelector("#qsiCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#qsiQty").addEventListener("keydown", (e) => { if (e.key === "Enter") modal.querySelector("#qsiSave").click(); });

  modal.querySelector("#qsiSave").addEventListener("click", async () => {
    const whIdRaw = modal.querySelector("#qsiWh").value;
    const qty = parseInt(modal.querySelector("#qsiQty").value, 10);
    const newCostRaw = modal.querySelector("#qsiCost").value;
    const note = modal.querySelector("#qsiNote").value || "";
    if (!whIdRaw) return showToastFn("เลือกคลัง");
    if (isNaN(qty) || qty <= 0) return showToastFn("จำนวนต้องมากกว่า 0");

    const btn = modal.querySelector("#qsiSave");
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";

    const whIdNum = Number(whIdRaw);
    const warehouseId = Number.isFinite(whIdNum) && String(whIdNum) === whIdRaw ? whIdNum : whIdRaw;

    try {
      const res = await window._appApplyStockMovement({
        productId: product.id,
        warehouseId,
        movementType: "in",
        qty,
        note: note || `รับเข้าจากแถวสินค้า`
      });
      if (!res?.ok) throw new Error(res?.error || "ไม่สำเร็จ");

      // อัพเดทต้นทุนถ้ามีค่าใหม่
      if (newCostRaw && Number(newCostRaw) >= 0 && Number(newCostRaw) !== Number(product.cost || 0)) {
        const cfg = window.SUPABASE_CONFIG;
        const accessToken = window._sbAccessToken || cfg.anonKey;
        await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(product.id));
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("apikey", cfg.anonKey);
          xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
          xhr.setRequestHeader("Prefer", "return=minimal");
          xhr.timeout = 8000;
          xhr.onload = () => resolve();
          xhr.onerror = () => resolve();
          xhr.ontimeout = () => resolve();
          xhr.send(JSON.stringify({ cost: Number(newCostRaw) }));
        });
      }

      showToastFn(`✓ รับเข้า ${qty} ชิ้น`);
      modal.remove();
      if (window.App?.loadAllData) await window.App.loadAllData();
    } catch (e) {
      showToastFn("ผิดพลาด: " + (e?.message || e));
      btn.disabled = false; btn.textContent = "+ รับเข้า";
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  BULK EDIT — รายการที่เลือก batch update
// ═══════════════════════════════════════════════════════════
async function _bulkPatchProducts(ids, patch, label) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  let ok = 0, fail = 0;
  for (const id of ids) {
    const r = await new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(id));
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 8000;
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.send(JSON.stringify(patch));
    });
    if (r) ok++; else fail++;
  }
  showToastFn(`${label}: สำเร็จ ${ok}/${ids.length}${fail > 0 ? ` (ล้มเหลว ${fail})` : ''}`);
  return ok;
}

async function bulkPriceChange(ctx) {
  const { state } = ctx;
  if (bulkSelected.size === 0) return;
  const input = prompt(
    `ปรับราคาสำหรับ ${bulkSelected.size} สินค้าที่เลือก\n\nกรอกตัวเลข + เครื่องหมาย:\n• "+10%" = ขึ้นราคา 10%\n• "-5%" = ลดราคา 5%\n• "=1500" = ตั้งราคาตายตัว 1500\n• "+50" = ขึ้นราคา 50 บาทตรงๆ`,
    "+10%"
  );
  if (!input) return;
  const trimmed = input.trim();
  let updateFn = null;
  if (trimmed.startsWith("=")) {
    const v = Number(trimmed.slice(1));
    if (isNaN(v)) return showToastFn("รูปแบบไม่ถูกต้อง");
    updateFn = () => v;
  } else if (trimmed.endsWith("%")) {
    const sign = trimmed.startsWith("-") ? -1 : 1;
    const pct = Number(trimmed.replace(/[^\d.]/g, ""));
    if (isNaN(pct)) return showToastFn("รูปแบบไม่ถูกต้อง");
    updateFn = (cur) => Math.round(Number(cur || 0) * (1 + sign * pct / 100) * 100) / 100;
  } else {
    const v = Number(trimmed);
    if (isNaN(v)) return showToastFn("รูปแบบไม่ถูกต้อง");
    updateFn = (cur) => Math.max(0, Math.round((Number(cur || 0) + v) * 100) / 100);
  }

  const ids = [...bulkSelected];
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  let ok = 0, fail = 0;
  for (const id of ids) {
    const prod = (state.products || []).find(p => String(p.id) === String(id));
    if (!prod) continue;
    const newPrice = updateFn(prod.price);
    const r = await new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(id));
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 8000;
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.send(JSON.stringify({ price: newPrice }));
    });
    if (r) ok++; else fail++;
  }
  showToastFn(`ปรับราคา: สำเร็จ ${ok}/${ids.length}${fail > 0 ? ` (ล้มเหลว ${fail})` : ''}`);
  bulkSelected.clear();
  if (window.App?.loadAllData) await window.App.loadAllData();
}

async function bulkSetCategory(ctx) {
  if (bulkSelected.size === 0) return;
  const cats = [...new Set((ctx.state.products || []).map(p => String(p.category || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th"));
  const newCat = (prompt(`เปลี่ยนหมวดสำหรับ ${bulkSelected.size} สินค้า\n\nหมวดที่มี: ${cats.slice(0, 10).join(", ")}${cats.length > 10 ? "..." : ""}\n\nพิมพ์ชื่อหมวดใหม่ (หรือชื่อเดิม):`, "") || "").trim();
  if (newCat === "") {
    if (!confirm("เคลียร์หมวด (ลบหมวดออกจากสินค้า)?")) return;
  }
  await _bulkPatchProducts([...bulkSelected], { category: newCat }, "เปลี่ยนหมวด");
  bulkSelected.clear();
  if (window.App?.loadAllData) await window.App.loadAllData();
}

async function bulkSetType(ctx) {
  if (bulkSelected.size === 0) return;
  const choice = prompt(
    `เปลี่ยนประเภทสำหรับ ${bulkSelected.size} สินค้า:\n\n1 = สินค้านับสต็อก\n2 = ไม่นับสต็อก\n3 = บริการ`,
    "1"
  );
  const map = { "1": "stock", "2": "non_stock", "3": "service" };
  const t = map[String(choice || "").trim()];
  if (!t) return;
  await _bulkPatchProducts([...bulkSelected], { product_type: t }, "เปลี่ยนประเภท");
  bulkSelected.clear();
  if (window.App?.loadAllData) await window.App.loadAllData();
}

async function bulkDelete(ctx) {
  if (bulkSelected.size === 0) return;
  if (!confirm(`⚠️ ลบสินค้าที่เลือก ${bulkSelected.size} รายการ?\n\nกู้คืนไม่ได้!`)) return;
  if (!confirm(`ยืนยันอีกครั้ง: ลบ ${bulkSelected.size} รายการ?`)) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  let ok = 0, fail = 0;
  for (const id of [...bulkSelected]) {
    const r = await new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("DELETE", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(id));
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 8000;
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.ontimeout = () => resolve(false);
      xhr.send();
    });
    if (r) ok++; else fail++;
  }
  showToastFn(`ลบสินค้า: สำเร็จ ${ok}/${bulkSelected.size}${fail > 0 ? ` (ล้มเหลว ${fail})` : ''}`);
  bulkSelected.clear();
  bulkMode = false;
  if (window.App?.loadAllData) await window.App.loadAllData();
}

// ═══════════════════════════════════════════════════════════
//  MERGE DUPLICATE CATEGORIES — auto-detect + manual merge
// ═══════════════════════════════════════════════════════════
// Normalize ชื่อหมวดเพื่อหาตัวใกล้เคียงกัน (ตัดวรรณยุกต์, ไม้หันอากาศ variations, ช่องว่าง)
function _normalizeCat(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, "") // zero-width chars
    .replace(/์/g, "") // การันต์
    .replace(/[่้๊๋]/g, "") // วรรณยุกต์
    .replace(/[อ๊อ๋]/g, "อ")
    .replace(/โซล่า/g, "โซลาร์")
    .replace(/โซล่าร์/g, "โซลาร์");
}

function _findDuplicateCategories(products) {
  const groups = new Map();
  for (const p of (products || [])) {
    const c = String(p.category || "").trim();
    if (!c) continue;
    const key = _normalizeCat(c);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { variants: new Map(), total: 0 });
    const g = groups.get(key);
    g.variants.set(c, (g.variants.get(c) || 0) + 1);
    g.total += 1;
  }
  // เฉพาะกลุ่มที่มีมากกว่า 1 ชื่อ (= มี variants)
  const dups = [];
  for (const [key, g] of groups.entries()) {
    if (g.variants.size > 1) {
      const variants = [...g.variants.entries()].sort((a, b) => b[1] - a[1]);
      dups.push({ key, variants, total: g.total });
    }
  }
  return dups;
}

// ═══════════════════════════════════════════════════════════
//  CATEGORY MANAGER — เพิ่ม / ลบ / เปลี่ยนชื่อ / ย้ายตำแหน่ง
// ═══════════════════════════════════════════════════════════
function _loadCategoryOrder() {
  try { return JSON.parse(localStorage.getItem("bsk_category_order") || "[]"); }
  catch(e) { return []; }
}
function _saveCategoryOrder(order) {
  try { localStorage.setItem("bsk_category_order", JSON.stringify(order || [])); } catch(e){}
}

async function openCategoryManagerDialog(ctx) {
  const { state } = ctx;
  // นับสินค้าต่อหมวด
  const catMap = new Map();
  for (const p of (state.products || [])) {
    const c = String(p.category || "").trim();
    if (!c) continue;
    catMap.set(c, (catMap.get(c) || 0) + 1);
  }
  const customOrder = _loadCategoryOrder();
  const rank = new Map(customOrder.map((c, i) => [c, i]));
  let categories = [...catMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const ra = rank.has(a.name) ? rank.get(a.name) : 9999;
      const rb = rank.has(b.name) ? rank.get(b.name) : 9999;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "th");
    });

  document.getElementById("bskCatMgrModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "bskCatMgrModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:600px;width:100%;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h3 style="margin:0;font-size:17px">🗂️ จัดการหมวดหมู่</h3>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${categories.length} หมวด • ใช้ ▲▼ จัดลำดับ • ✏️ เปลี่ยนชื่อ • 🗑️ ลบ</div>
        </div>
        <button id="bskCatMgrClose" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748b">×</button>
      </div>
      <div style="padding:14px 20px;border-bottom:1px solid #e5e7eb;display:flex;gap:8px">
        <input id="bskNewCatInput" type="text" placeholder="ชื่อหมวดใหม่..." style="flex:1;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" />
        <button id="bskAddCatBtn" style="padding:8px 14px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">+ สร้าง</button>
      </div>
      <div id="bskCatMgrList" style="flex:1;overflow-y:auto;padding:8px"></div>
      <div style="padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end">
        <button id="bskCatMgrCancel" style="padding:8px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ปิด</button>
        <button id="bskCatMgrSaveOrder" style="padding:8px 16px;border:none;background:#10b981;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">💾 บันทึกลำดับ</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#bskCatMgrList");

  function renderList() {
    if (categories.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:40px">ยังไม่มีหมวดหมู่ — เพิ่มจากด้านบนได้เลย</div>`;
      return;
    }
    listEl.innerHTML = categories.map((cat, idx) => `
      <div class="bsk-cat-row" data-idx="${idx}" draggable="true" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;background:#fafbfc;cursor:grab" title="ลากเพื่อจัดลำดับ">
        <div style="font-size:14px;color:#94a3b8;cursor:grab;padding:0 4px;user-select:none" title="ลากเพื่อย้าย">⋮⋮</div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <button class="bsk-cat-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} style="border:none;background:transparent;cursor:${idx===0?'not-allowed':'pointer'};font-size:12px;color:${idx===0?'#cbd5e1':'#475569'};padding:0 4px;line-height:1">▲</button>
          <button class="bsk-cat-dn" data-idx="${idx}" ${idx === categories.length-1 ? 'disabled' : ''} style="border:none;background:transparent;cursor:${idx===categories.length-1?'not-allowed':'pointer'};font-size:12px;color:${idx===categories.length-1?'#cbd5e1':'#475569'};padding:0 4px;line-height:1">▼</button>
        </div>
        <div style="width:28px;text-align:center;font-size:11px;color:#94a3b8;font-weight:700">${idx+1}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(cat.name)}</div>
          <div style="font-size:11px;color:#64748b">${cat.count} สินค้า</div>
        </div>
        <button class="bsk-cat-rename" data-idx="${idx}" title="เปลี่ยนชื่อ" style="padding:6px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:13px">✏️</button>
        <button class="bsk-cat-del" data-idx="${idx}" title="ลบหมวด" style="padding:6px 8px;border:1px solid #fca5a5;background:#fff;color:#dc2626;border-radius:6px;cursor:pointer;font-size:13px">🗑️</button>
      </div>
    `).join("");

    // ▲▼ swap
    listEl.querySelectorAll(".bsk-cat-up").forEach(btn => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      if (i <= 0) return;
      [categories[i-1], categories[i]] = [categories[i], categories[i-1]];
      renderList();
    }));
    listEl.querySelectorAll(".bsk-cat-dn").forEach(btn => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      if (i >= categories.length - 1) return;
      [categories[i], categories[i+1]] = [categories[i+1], categories[i]];
      renderList();
    }));

    // ★ Drag & Drop reorder
    let dragSrcIdx = null;
    listEl.querySelectorAll(".bsk-cat-row").forEach(row => {
      row.addEventListener("dragstart", (e) => {
        dragSrcIdx = Number(row.dataset.idx);
        row.style.opacity = "0.4";
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragSrcIdx)); }
      });
      row.addEventListener("dragend", () => { row.style.opacity = ""; });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        row.style.borderColor = "#0284c7";
        row.style.borderWidth = "2px";
      });
      row.addEventListener("dragleave", () => {
        row.style.borderColor = "#e5e7eb";
        row.style.borderWidth = "1px";
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.style.borderColor = "#e5e7eb";
        row.style.borderWidth = "1px";
        const tgtIdx = Number(row.dataset.idx);
        if (dragSrcIdx === null || tgtIdx === dragSrcIdx) return;
        const [moved] = categories.splice(dragSrcIdx, 1);
        categories.splice(tgtIdx, 0, moved);
        dragSrcIdx = null;
        renderList();
      });
    });

    // ✏️ rename
    listEl.querySelectorAll(".bsk-cat-rename").forEach(btn => btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.idx);
      const oldName = categories[i].name;
      const newName = (prompt(`เปลี่ยนชื่อหมวด "${oldName}" เป็น:`, oldName) || "").trim();
      if (!newName || newName === oldName) return;
      // PATCH ทุกสินค้าที่ category === oldName → newName
      const matches = (state.products || []).filter(p => (p.category || "") === oldName);
      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;
      let ok = 0;
      for (const p of matches) {
        const r = await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(p.id));
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("apikey", cfg.anonKey);
          xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
          xhr.setRequestHeader("Prefer", "return=minimal");
          xhr.timeout = 8000;
          xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
          xhr.onerror = () => resolve(false);
          xhr.ontimeout = () => resolve(false);
          xhr.send(JSON.stringify({ category: newName }));
        });
        if (r) ok++;
      }
      categories[i].name = newName;
      // Update custom order ถ้ามี oldName อยู่
      const order = _loadCategoryOrder();
      const oi = order.indexOf(oldName);
      if (oi !== -1) { order[oi] = newName; _saveCategoryOrder(order); }
      showToastFn(`เปลี่ยนชื่อ "${oldName}" → "${newName}" (${ok}/${matches.length} สินค้า)`);
      renderList();
    }));

    // 🗑️ delete
    listEl.querySelectorAll(".bsk-cat-del").forEach(btn => btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.idx);
      const cat = categories[i];
      const matches = (state.products || []).filter(p => (p.category || "") === cat.name);

      let action;
      if (matches.length === 0) {
        if (!confirm(`ลบหมวด "${cat.name}" หรือไม่? (ไม่มีสินค้าใช้หมวดนี้)`)) return;
        action = "remove_only";
      } else {
        action = prompt(
          `หมวด "${cat.name}" มี ${matches.length} สินค้าใช้งาน\n\nเลือก:\n1 = เคลียร์ category ของสินค้า (สินค้าไม่ถูกลบ)\n2 = ย้ายไปหมวดอื่น\n3 = ยกเลิก`,
          "1"
        );
        if (!action || action === "3") return;
      }

      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;

      let newCat = "";
      if (action === "2") {
        newCat = (prompt(`ย้ายไปหมวดอะไร? (พิมพ์ชื่อหมวด)`, "") || "").trim();
        if (!newCat) return;
      }

      let ok = 0;
      for (const p of matches) {
        const r = await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(p.id));
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("apikey", cfg.anonKey);
          xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
          xhr.setRequestHeader("Prefer", "return=minimal");
          xhr.timeout = 8000;
          xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
          xhr.onerror = () => resolve(false);
          xhr.ontimeout = () => resolve(false);
          xhr.send(JSON.stringify({ category: newCat }));
        });
        if (r) ok++;
      }
      // ลบจาก custom order
      const order = _loadCategoryOrder().filter(c => c !== cat.name);
      _saveCategoryOrder(order);

      categories.splice(i, 1);
      const msg = action === "remove_only" ? `ลบหมวด "${cat.name}"` :
                  action === "2" ? `ย้าย ${ok}/${matches.length} สินค้า → "${newCat}"` :
                  `เคลียร์หมวด ${ok}/${matches.length} สินค้า`;
      showToastFn(msg);
      renderList();
    }));
  }

  renderList();

  // เพิ่มหมวดใหม่ — บันทึกใน custom order ลำดับสุดท้าย
  modal.querySelector("#bskAddCatBtn").addEventListener("click", () => {
    const inp = modal.querySelector("#bskNewCatInput");
    const name = (inp.value || "").trim();
    if (!name) return;
    if (categories.find(c => c.name === name)) {
      showToastFn(`มีหมวด "${name}" อยู่แล้ว`);
      return;
    }
    categories.push({ name, count: 0 });
    inp.value = "";
    renderList();
    showToastFn(`เพิ่มหมวด "${name}" — สร้างสินค้าใหม่ในหมวดนี้แล้วจะเริ่มมองเห็นใน chip`);
  });
  modal.querySelector("#bskNewCatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") modal.querySelector("#bskAddCatBtn").click();
  });

  modal.querySelector("#bskCatMgrClose").addEventListener("click", () => modal.remove());
  modal.querySelector("#bskCatMgrCancel").addEventListener("click", () => modal.remove());

  // 💾 Save order
  modal.querySelector("#bskCatMgrSaveOrder").addEventListener("click", async () => {
    const newOrder = categories.map(c => c.name);
    _saveCategoryOrder(newOrder);
    showToastFn(`บันทึกลำดับ ${newOrder.length} หมวดสำเร็จ`);
    modal.remove();
    if (window.App?.loadAllData) await window.App.loadAllData();
  });
}

async function openMergeCategoriesDialog(ctx) {
  const { state } = ctx;
  const dups = _findDuplicateCategories(state.products || []);

  if (dups.length === 0) {
    showToastFn("ไม่พบหมวดซ้ำ/ใกล้เคียง 🎉");
    return;
  }

  // Remove existing modal
  document.getElementById("bskMergeCatModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "bskMergeCatModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div>
          <h3 style="margin:0">🔗 รวมหมวดหมู่ซ้ำ</h3>
          <div style="font-size:12px;color:#64748b;margin-top:2px">พบ ${dups.length} กลุ่มที่มีชื่อใกล้เคียงกัน — เลือกชื่อที่จะเก็บ</div>
        </div>
        <button id="bskMergeClose" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748b">×</button>
      </div>
      <div id="bskMergeList" style="display:flex;flex-direction:column;gap:12px"></div>
      <div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
        <button id="bskMergeCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="bskMergeApply" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">บันทึกการรวม</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#bskMergeList");
  dups.forEach((g, idx) => {
    const div = document.createElement("div");
    div.style.cssText = "border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f8fafc";
    div.innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:6px">กลุ่มที่ ${idx+1} — รวม ${g.total} สินค้า</div>
      <div style="font-weight:700;margin-bottom:8px;font-size:13px">เลือกชื่อที่จะเก็บ:</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${g.variants.map(([name, count], i) => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
            <input type="radio" name="mergeGrp${idx}" value="${escHtml(name)}" ${i === 0 ? 'checked' : ''} />
            <span style="flex:1">${escHtml(name)} <span style="color:#64748b;font-size:11px">(${count} สินค้า)</span></span>
          </label>
        `).join("")}
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding-top:4px;border-top:1px dashed #cbd5e1;margin-top:4px">
          <input type="radio" name="mergeGrp${idx}" value="__skip__" />
          <span style="color:#94a3b8">⊘ ไม่รวมกลุ่มนี้</span>
        </label>
      </div>
    `;
    listEl.appendChild(div);
  });

  modal.querySelector("#bskMergeClose").addEventListener("click", () => modal.remove());
  modal.querySelector("#bskMergeCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#bskMergeApply").addEventListener("click", async () => {
    const applyBtn = modal.querySelector("#bskMergeApply");
    applyBtn.disabled = true;
    applyBtn.textContent = "กำลังรวม...";

    let merged = 0, updated = 0;
    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;

    for (let i = 0; i < dups.length; i++) {
      const keep = modal.querySelector(`input[name="mergeGrp${i}"]:checked`)?.value;
      if (!keep || keep === "__skip__") continue;
      merged++;

      const g = dups[i];
      const othersToReplace = g.variants.map(([n]) => n).filter(n => n !== keep);

      // PATCH ทุกสินค้าที่ category ตรงกับ otherName → เปลี่ยนเป็น keep
      for (const oldName of othersToReplace) {
        const matchingProducts = (state.products || []).filter(p => (p.category || "") === oldName);
        for (const p of matchingProducts) {
          await new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(p.id));
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("apikey", cfg.anonKey);
            xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
            xhr.setRequestHeader("Prefer", "return=minimal");
            xhr.timeout = 8000;
            xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) updated++; resolve(); };
            xhr.onerror = () => resolve();
            xhr.ontimeout = () => resolve();
            xhr.send(JSON.stringify({ category: keep }));
          });
        }
      }
    }

    modal.remove();
    showToastFn(`รวมหมวดสำเร็จ ${merged} กลุ่ม • อัพเดต ${updated} สินค้า`);
    if (window.App?.loadAllData) await window.App.loadAllData();
  });
}

// ═══════════════════════════════════════════════════════════
//  QR CODE — lazy-load qrcodejs from CDN, render in modal
// ═══════════════════════════════════════════════════════════
let _qrLibPromise = null;
function loadQrLib() {
  if (window.QRCode) return Promise.resolve();
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
    s.onload = () => resolve();
    s.onerror = () => { _qrLibPromise = null; reject(new Error("โหลด QR library ไม่สำเร็จ")); };
    document.head.appendChild(s);
  });
  return _qrLibPromise;
}

async function showQrModal({ title, subtitle, text, showPrint = false, productName = "" }) {
  try {
    await loadQrLib();
  } catch (e) {
    return showToastFn(e.message);
  }

  // Remove existing modal if any
  document.getElementById("bskQrModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "bskQrModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25)" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px">
        <div>
          <h3 style="margin:0;font-size:16px;color:#0f172a">${escHtml(title || "QR Code")}</h3>
          ${subtitle ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${escHtml(subtitle)}</div>` : ""}
        </div>
        <button id="bskQrClose" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748b;line-height:1">×</button>
      </div>
      <div id="bskQrBox" style="display:flex;justify-content:center;padding:16px;background:#fff"></div>
      <div style="text-align:center;font-family:monospace;font-size:12px;color:#334155;word-break:break-all;padding:8px;background:#f8fafc;border-radius:8px;margin-top:8px">${escHtml(text)}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="bskQrCopy" style="flex:1;min-width:100px;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">📋 คัดลอก</button>
        ${showPrint ? `<button id="bskQrPrint" style="flex:1;min-width:100px;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">🖨️ พิมพ์</button>` : ""}
      </div>
    </div>
  `;
  modal.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  const box = modal.querySelector("#bskQrBox");
  // eslint-disable-next-line no-undef
  new QRCode(box, { text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });

  modal.querySelector("#bskQrClose")?.addEventListener("click", () => modal.remove());
  modal.querySelector("#bskQrCopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToastFn("คัดลอกแล้ว");
    } catch (e) {
      showToastFn("คัดลอกไม่สำเร็จ");
    }
  });

  if (showPrint) {
    modal.querySelector("#bskQrPrint")?.addEventListener("click", () => {
      const img = box.querySelector("img") || box.querySelector("canvas");
      const dataUrl = img?.src || (img?.toDataURL ? img.toDataURL() : "");
      if (!dataUrl) return showToastFn("สร้าง QR ไม่สำเร็จ");
      const w = window.open("", "_blank", "width=400,height=500");
      if (!w) return showToastFn("เปิดหน้าต่างพิมพ์ไม่ได้ (popup blocker?)");
      w.document.write(`<!DOCTYPE html><html><head><title>QR ${escHtml(productName)}</title>
<style>body{margin:0;padding:24px;text-align:center;font-family:sans-serif}img{width:220px;height:220px}p{margin:8px 0 0;font-family:monospace;font-size:12px}@media print{body{padding:0}}</style>
</head><body><img src="${dataUrl}" /><p>${escHtml(productName || "")}</p><p>${escHtml(text)}</p>
<script>setTimeout(()=>{window.print();setTimeout(()=>window.close(),300)},200)<\/script>
</body></html>`);
      w.document.close();
    });
  }
}
