
// ═══════════════════════════════════════════════════════════
//  Boonsook POS V5 — Products Page (FlowAccount Style)
// ═══════════════════════════════════════════════════════════

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
let searchQuery = "";
let currentPage = 1;
let currentSort = "name_asc";
let viewMode = "list"; // list | grid
let selectedWarehouse = "all"; // "all" or warehouse id
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

function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
  currentSort = "name_asc";

  // ถ้ามี warehouseFilter → หาตัว warehouse id จากชื่อ
  // ★ ถ้าหาไม่เจอ ให้ใช้ "none" แทน "all" เพื่อไม่แสดงสินค้าทั้งหมด
  if (warehouseFilter) {
    const wh = (state.warehouses || []).find(w => (w.name || "").includes(warehouseFilter));
    selectedWarehouse = wh ? String(wh.id) : "none";
  } else {
    selectedWarehouse = "all";
  }

  renderView(ctx);
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

  // ★ Filter ใช้ stock ตามคลังที่เลือก
  if (currentFilter === "instock") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > ds.min_stock; });
  } else if (currentFilter === "low") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock > 0 && ds.stock <= ds.min_stock; });
  } else if (currentFilter === "out") {
    filtered = filtered.filter(p => { const ds = getDisplayStock(state, p); return ds.stock <= 0; });
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
          <button id="prodDeleteAllBtn" class="btn light" style="font-size:12px;padding:6px 10px;color:#dc2626;border-color:#fca5a5" title="ลบสินค้าทั้งหมดเพื่อนำเข้าใหม่">ลบทั้งหมด</button>
          <button id="prodAddBtn" class="btn primary" style="font-size:12px;padding:6px 12px">+ เพิ่มสินค้า</button>
        </div>
      </div>

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
  el.querySelector("#prodAddBtn, .prod-add-btn")?.addEventListener("click", () => openProductDrawer());

  // ★ Product Type Tabs
  el.querySelectorAll("[data-ptype]").forEach(btn => btn.addEventListener("click", () => {
    currentTypeFilter = btn.dataset.ptype;
    currentFilter = "all"; // reset stock filter
    currentPage = 1;
    renderView(ctx);
  }));

  // Import / Export
  el.querySelector("#prodImportBtn")?.addEventListener("click", () => {
    el.querySelector("#prodFileInput")?.click();
  });
  el.querySelector("#prodExportBtn")?.addEventListener("click", () => exportProducts(state));
  el.querySelector("#prodGenAllBarcodesBtn")?.addEventListener("click", () => generateAllBarcodes(ctx));
  el.querySelector("#prodDeleteAllBtn")?.addEventListener("click", () => deleteAllProducts(ctx));
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

  // ★ Delete product (admin only)
  el.querySelectorAll("[data-prod-del]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const pid = Number(btn.dataset.prodDel);
    const prod = state.products.find(x => x.id === pid);
    if (!prod) return;
    const confirmDel = window.App?.showConfirmModal || ((msg, cb) => { if(confirm(msg)) cb(); });
    confirmDel(`ลบสินค้า "${prod.name}" ?\nลบแล้วไม่สามารถกู้คืนได้`, async () => {
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
          btn.disabled = false;
          btn.textContent = "🗑️";
        }
      } catch (err) {
        window.App?.showToast?.("เกิดข้อผิดพลาด: " + err.message);
        btn.disabled = false;
        btn.textContent = "🗑️";
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

  const priceStr = money(p.price);
  const skuStr = p.sku ? escHtml(p.sku) : "";

  const isAdmin = (state.profile?.role === "admin");

  if (mode === "grid") {
    return `
      <div class="prod-grid-card">
        <div class="prod-grid-avatar-wrap">
          ${getLetterAvatar(p.name)}
          <span class="prod-stock-indicator" style="background:${statusDot}" title="${statusText}"></span>
        </div>
        <div class="prod-grid-name">${escHtml(p.name || "-")}</div>
        ${skuStr ? `<div class="sku">${skuStr}</div>` : ''}
        <div class="prod-grid-price">฿${priceStr}</div>
        <div class="prod-grid-stock">คงเหลือ ${stock}</div>
        <div class="prod-grid-actions">
          <button class="btn light" style="padding:6px 10px;font-size:12px" data-prod-edit="${p.id}">แก้ไข</button>
          <button class="btn primary" style="padding:6px 10px;font-size:12px" data-prod-add="${p.id}">+ บิล</button>
          ${isAdmin ? `<button class="btn" style="padding:6px 8px;font-size:12px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer" data-prod-del="${p.id}" title="ลบสินค้า">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }

  // List mode
  return `
    <div class="prod-list-item">
      <div class="prod-list-left">
        <div class="prod-avatar-wrap">
          ${getLetterAvatar(p.name)}
          <span class="prod-stock-indicator" style="background:${statusDot}" title="${statusText}"></span>
        </div>
        <div class="prod-list-info">
          <div class="prod-list-name">${escHtml(p.name || "-")} ${typeBadge}</div>
          ${skuStr ? `<div class="prod-list-sku">${skuStr}</div>` : ''}
          ${p.category ? `<div class="prod-list-sku" style="color:#6b7280">${escHtml(p.category)}</div>` : ''}
          ${pType === "stock" && p.barcode ? `<div class="prod-list-sku">บาร์โค้ด: ${escHtml(p.barcode)}</div>` : ''}
        </div>
      </div>
      <div class="prod-list-right">
        <div class="prod-list-price">฿${priceStr}</div>
        ${pType !== "service" ? `<div class="prod-list-stock">คงเหลือ <strong>${stock}</strong></div>` : ''}
        <div class="prod-list-actions">
          <button class="btn light" style="padding:6px 10px;font-size:12px" data-prod-edit="${p.id}">•••</button>
          <button class="btn primary" style="padding:6px 10px;font-size:12px" data-prod-add="${p.id}">+ บิล</button>
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
      scanArea.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">ไม่สามารถเปิดกล้อง: ${err.message || err}</div>`;
    });
  } catch (err) {
    scanArea.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">เกิดข้อผิดพลาด: ${err.message || err}</div>`;
  }
}

function closeScanner() {
  if (scannerInstance) {
    try { scannerInstance.stop(); } catch (e) {}
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

  if (!confirm(`สร้างบาร์โค้ดให้สินค้านับสต็อก ${noBarcode.length} รายการที่ยังไม่มี?\n(ข้ามบริการ + สินค้าไม่นับสต็อก)`)) return;

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

  if (!confirm(`⚠️ ลบสินค้าทั้งหมด ${products.length} รายการ?\n\nหลังลบแล้วสามารถนำเข้าใหม่จาก Excel ได้เลย\n(โค้ดใหม่จะแยกบริการ/สินค้าให้อัตโนมัติ)`)) return;
  if (!confirm("ยืนยันอีกครั้ง: ลบสินค้าทั้งหมด?")) return;

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
function exportProducts(state) {
  try {
    const TYPE_LABELS = { service: "บริการ", non_stock: "ไม่นับสต็อก", stock: "นับสต็อก" };
    const items = (state.products || []).map(p => ({
      "ประเภท": TYPE_LABELS[detectProductType(p)] || "นับสต็อก",
      "ชื่อสินค้า": p.name || "",
      "รหัสสินค้า (SKU)": p.sku || "",
      "หมวดหมู่": p.category || "",
      "บาร์โค้ด": p.barcode || "",
      "ราคาขาย": p.price || 0,
      "ต้นทุน": p.cost || 0,
      "คงเหลือ": p.stock || 0,
      "สต็อกขั้นต่ำ": p.min_stock || 0
    }));

    const ws = XLSX.utils.json_to_sheet(items);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สินค้า");

    ws["!cols"] = [
      { wch: 14 }, { wch: 35 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }
    ];

    XLSX.writeFile(wb, "สินค้า_บุญสุข.xlsx");
    window.App?.showToast?.("ส่งออก Excel สำเร็จ");
  } catch (err) {
    window.App?.showToast?.("ส่งออกไม่สำเร็จ: " + (err.message || err));
  }
}
