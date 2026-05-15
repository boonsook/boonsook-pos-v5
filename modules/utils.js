// Shared utilities — Phase 51 (1 พ.ค. 2026)
// Canonical escHtml: null-safe, escapes 5 HTML special chars (&, <, >, ", ')
// Dedupes ~30 local copies across modules.
export function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

// ═══════════════════════════════════════════════════════════
//  Phase 55: Customer Loyalty Tier
//  Auto-classify customers into tiers based on lifetime revenue.
//  Tiers (THB cumulative spend):
//    Platinum  ≥ 100,000   diamond gradient
//    Gold      ≥  50,000   yellow
//    Silver    ≥  20,000   slate
//    Bronze    ≥   5,000   amber
//    (none)    <    5,000
// ═══════════════════════════════════════════════════════════
export const TIER_RULES = [
  { key: "platinum", min: 100000, label: "Platinum", icon: "💎", color: "#7c3aed", bg: "linear-gradient(135deg,#a78bfa,#7c3aed)" },
  { key: "gold",     min:  50000, label: "Gold",     icon: "🥇", color: "#92400e", bg: "linear-gradient(135deg,#fde68a,#f59e0b)" },
  { key: "silver",   min:  20000, label: "Silver",   icon: "🥈", color: "#475569", bg: "linear-gradient(135deg,#e2e8f0,#94a3b8)" },
  { key: "bronze",   min:   5000, label: "Bronze",   icon: "🥉", color: "#9a3412", bg: "linear-gradient(135deg,#fed7aa,#ea580c)" }
];

/**
 * Compute lifetime revenue + tier for a customer.
 * @param {string|number} customerId
 * @param {Array} sales — state.sales (excludes deleted)
 * @returns {Object} { revenue, tier, nextTier, progress }
 */
export function getCustomerTier(customerId, sales) {
  if (customerId == null) return { revenue: 0, tier: null, nextTier: TIER_RULES[TIER_RULES.length - 1], progress: 0 };
  const cid = String(customerId);
  const revenue = (sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => String(s.customer_id || "") === cid)
    .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

  const tier = TIER_RULES.find(t => revenue >= t.min) || null;
  // next tier (closest higher) — for progress bar
  const tierIdx = tier ? TIER_RULES.indexOf(tier) : TIER_RULES.length;
  const nextTier = tierIdx > 0 ? TIER_RULES[tierIdx - 1] : null;
  const progress = nextTier ? Math.min(100, (revenue / nextTier.min) * 100) : 100;
  return { revenue, tier, nextTier, progress };
}

// ═══════════════════════════════════════════════════════════
//  Phase 70 (D3): Generic Excel export — shared across modules
//  Uses XLSX (SheetJS) loaded globally from CDN in index.html.
//  All modules call this with the same shape so files behave consistently.
// ═══════════════════════════════════════════════════════════
/**
 * Export an array of plain objects to an .xlsx file.
 * @param {string} filename - e.g. "ใบเสนอราคา_2026-05-03.xlsx"
 * @param {Array<Object>} rows - each row is one record. Keys become headers.
 * @param {string} [sheetName="Sheet1"]
 * @returns {boolean} true on success, false if XLSX library missing
 */
export function exportToExcel(filename, rows, sheetName) {
  if (typeof window.XLSX === "undefined") {
    console.warn("[exportToExcel] XLSX library not loaded");
    return false;
  }
  const safe = (rows && rows.length) ? rows : [{ "ไม่มีข้อมูล": "" }];
  const ws = window.XLSX.utils.json_to_sheet(safe);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
  window.XLSX.writeFile(wb, filename);
  return true;
}

/**
 * Format a numeric/string for Excel — wraps barcode-like strings to keep
 * leading zeros intact (Excel auto-strips them otherwise).
 */
export function asExcelText(s) {
  if (s == null) return "";
  return String(s);
}

// ═══════════════════════════════════════════════════════════
//  Phase 89.4: Round to 2 decimals — กัน float drift (0.1+0.2 = 0.30000000000000004)
//  ใช้ทุกที่ที่มี money math: line_total, grand_total, subtotal, vat
// ═══════════════════════════════════════════════════════════
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════
//  Phase 89.27: Role-based sales filter (extends Phase 89.24)
//  Admin → see all sales (company-wide).
//  Non-admin → see only sales where created_by === currentUser.id.
//  Always excludes soft-deleted ([ลบแล้ว]).
//
//  NOTE: Phase 89.24 originally filtered only in pos.js + sales.js.
//  C1 audit: client filter ran AFTER server .limit(50) → busy days
//  crowded out non-admin's own rows → "วันนี้ขายได้ ฿0" misleading.
//  Fix combo: (a) server-side .eq("created_by", myId) in loadAllData
//  for non-admin, (b) this helper as defense-in-depth + uniform filter
//  for dashboard/profit_report/top_customers/sales_heatmap.
// ═══════════════════════════════════════════════════════════
export function isAdminProfile(profile) {
  return profile?.role === "admin";
}

export function visibleSalesForRole(sales, profile, currentUser) {
  const isAdmin = isAdminProfile(profile);
  const myId = currentUser?.id || null;
  return (sales || []).filter(s => {
    if ((s.note || "").includes("[ลบแล้ว]")) return false;
    if (isAdmin) return true;
    if (myId && s.created_by && String(s.created_by) !== String(myId)) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 89.1: Bangkok-timezone date helpers (Asia/Bangkok = UTC+7)
//  ป้องกัน off-by-1: เดิม `new Date().toISOString().slice(0,10)` คืน UTC
//  → ตี 1 ไทย (UTC 18:00 วันก่อนหน้า) ได้วันที่ "เมื่อวาน" → JV ลง period ผิด
//  Output: "YYYY-MM-DD" (en-CA locale)
// ═══════════════════════════════════════════════════════════
const _BKK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric", month: "2-digit", day: "2-digit"
});

export function todayBkk() {
  return _BKK_FORMATTER.format(new Date());
}

export function dateBkk(d) {
  if (!d) return "";
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return _BKK_FORMATTER.format(date);
}

export function addDaysBkk(n) {
  const d = new Date();
  d.setDate(d.getDate() + Number(n || 0));
  return _BKK_FORMATTER.format(d);
}

/**
 * Helper: build a YYYY-MM-DD date suffix for filenames.
 * Phase 89.1: ใช้ Bangkok time แทน UTC
 */
export function todaySuffix() {
  return todayBkk();
}

// ═══════════════════════════════════════════════════════════
//  Phase 68: Tag presets for products + service_jobs
//  (customers have their own preset list in main.js Phase 11)
// ═══════════════════════════════════════════════════════════
export const PRODUCT_TAG_PRESETS = [
  { name: "ขายดี",        icon: "🔥", color: "#dc2626", desc: "สินค้าขายดี" },
  { name: "โปรโมชั่น",     icon: "🎉", color: "#f59e0b", desc: "อยู่ในโปรโมชั่น" },
  { name: "ใหม่",          icon: "✨", color: "#10b981", desc: "สินค้ามาใหม่" },
  { name: "นำเข้า",        icon: "🌍", color: "#0284c7", desc: "นำเข้า/Import" },
  { name: "เลิกผลิต",      icon: "⚠️", color: "#9a3412", desc: "Discontinued" },
  { name: "ราคาส่ง",       icon: "📦", color: "#7c3aed", desc: "มีราคาส่ง" }
];

export const SERVICE_TAG_PRESETS = [
  { name: "ด่วน",          icon: "🚨", color: "#dc2626", desc: "งานด่วน" },
  { name: "VIP",           icon: "🌟", color: "#f59e0b", desc: "ลูกค้า VIP" },
  { name: "ประกัน",         icon: "🛡️", color: "#10b981", desc: "งานในประกัน" },
  { name: "ติดตั้งใหม่",    icon: "🏗️", color: "#0284c7", desc: "ติดตั้งครั้งแรก" },
  { name: "ซ่อมซ้ำ",        icon: "🔁", color: "#7c3aed", desc: "เคยมาซ่อมแล้ว" },
  { name: "ค้างจ่าย",       icon: "💳", color: "#ef4444", desc: "ลูกค้ายังไม่จ่าย" }
];

export function getTagMeta(tagName, presets) {
  const found = (presets || []).find(t => t.name === tagName);
  return found || { name: tagName, icon: "🏷️", color: "#64748b", desc: "" };
}

/**
 * Render small badge for a tag (read-only, used in lists).
 * @param {string} tagName
 * @param {Array} presets - PRODUCT_TAG_PRESETS / SERVICE_TAG_PRESETS / etc.
 * @returns {string} HTML
 */
export function renderTagBadge(tagName, presets) {
  const m = getTagMeta(tagName, presets);
  return `<span style="background:${m.color};color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;margin-right:3px;display:inline-block">${m.icon} ${escHtml(tagName)}</span>`;
}

/**
 * Mount editable tag widget on a container element.
 * Two children expected: presets row + active row, both <div>.
 * Returns helpers for outside callers.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.activeEl - container that shows current chips
 * @param {HTMLElement} opts.presetsEl - container that shows quick-add preset chips
 * @param {HTMLInputElement} opts.inputEl - free-text input
 * @param {HTMLButtonElement} opts.addBtn - "+ add" button
 * @param {Array} opts.presets - preset list
 * @param {Array<string>} opts.initial - initial tags
 * @returns {{ getValue: () => Array<string> }}
 */
export function mountTagWidget({ activeEl, presetsEl, inputEl, addBtn, presets, initial }) {
  let cur = Array.isArray(initial) ? [...initial] : [];

  const renderActive = () => {
    if (!activeEl) return;
    if (cur.length === 0) {
      activeEl.innerHTML = `<span style="font-size:11px;color:#94a3b8">— ยังไม่มี tag —</span>`;
    } else {
      activeEl.innerHTML = cur.map(t => {
        const m = getTagMeta(t, presets);
        return `<span style="background:${m.color};color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
          ${m.icon} ${escHtml(t)}
          <button type="button" data-tw-remove="${escHtml(t)}" style="background:rgba(255,255,255,0.3);border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center">×</button>
        </span>`;
      }).join("");
      activeEl.querySelectorAll("[data-tw-remove]").forEach(btn => btn.addEventListener("click", () => {
        cur = cur.filter(x => x !== btn.dataset.twRemove);
        renderActive(); renderPresets();
      }));
    }
  };
  const renderPresets = () => {
    if (!presetsEl) return;
    presetsEl.innerHTML = presets.map(p => {
      const active = cur.includes(p.name);
      return `<button type="button" data-tw-toggle="${escHtml(p.name)}" style="background:${active?p.color:'#fff'};color:${active?'#fff':p.color};border:1px solid ${p.color};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;cursor:pointer;opacity:${active?'1':'.85'}">${p.icon} ${escHtml(p.name)}</button>`;
    }).join("");
    presetsEl.querySelectorAll("[data-tw-toggle]").forEach(btn => btn.addEventListener("click", () => {
      const t = btn.dataset.twToggle;
      cur = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
      renderActive(); renderPresets();
    }));
  };
  const handleAdd = () => {
    const v = (inputEl?.value || "").trim();
    if (!v) return;
    if (cur.includes(v)) return;
    cur = [...cur, v];
    if (inputEl) inputEl.value = "";
    renderActive(); renderPresets();
  };
  if (addBtn) addBtn.addEventListener("click", handleAdd);
  if (inputEl) inputEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } });

  renderActive(); renderPresets();
  return { getValue: () => [...cur] };
}

// ═══════════════════════════════════════════════════════════
//  Phase 64: Barcode Scanner config — shared across all scan UIs
//  Fixes: html5-qrcode default only reliably reads QR. Without explicit
//  formatsToSupport, 1D barcodes (EAN/UPC/Code128) often fail to decode
//  even when camera opens fine. Square qrbox also doesn't suit horizontal
//  retail barcodes — use wide rectangle.
// ═══════════════════════════════════════════════════════════
// Html5QrcodeSupportedFormats enum values (from library source)
// 0=QR_CODE, 3=CODE_39, 4=CODE_93, 5=CODE_128, 8=ITF, 9=EAN_13,
// 10=EAN_8, 14=UPC_A, 15=UPC_E
export const BARCODE_FORMATS = [0, 3, 4, 5, 8, 9, 10, 14, 15];

/**
 * Build Html5Qrcode constructor options + start() config tuned for
 * retail barcodes (1D + QR). Pass into both `new Html5Qrcode(elId, opts)`
 * and `.start(camera, startConfig, ...)`.
 *
 * @param {Object} [overrides] - partial overrides for startConfig
 * @returns {{ ctorOpts: Object, startConfig: Object }}
 */
export function getScannerConfig(overrides = {}) {
  const ctorOpts = {
    formatsToSupport: BARCODE_FORMATS,
    verbose: false,
    useBarCodeDetectorIfSupported: true,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };
  const startConfig = {
    fps: 15,
    // Wide rectangle box — fits horizontal retail barcodes, also works for QR
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const w = Math.floor(viewfinderWidth * 0.85);
      const h = Math.floor(minEdge * 0.45);
      return { width: w, height: h };
    },
    aspectRatio: 1.7777778, // 16:9 — plays nice with most phone cameras
    formatsToSupport: BARCODE_FORMATS,
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true,
    ...overrides
  };
  return { ctorOpts, startConfig };
}

/**
 * Render a small inline tier badge (HTML string).
 * Caller is responsible for escaping if used in untrusted context.
 */
export function renderTierBadge(tier) {
  if (!tier) return "";
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:${tier.bg};color:#fff;font-size:11px;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.2)">${tier.icon} ${tier.label}</span>`;
}

// ═══════════════════════════════════════════════════════════
//  Phase 57: Activity log helper
//  Append-only audit trail. Silent-fails if table not yet created
//  (so the rest of the app keeps working even before migration).
// ═══════════════════════════════════════════════════════════
export async function logActivity(action, opts = {}) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken;
    if (!cfg || !token) return; // not logged in → skip

    const profile = window.App?.state?.profile || {};
    const user = window.App?.state?.currentUser || {};
    if (!user.id) return; // no user_id → RLS WITH CHECK (user_id = auth.uid()) would deny → skip

    const payload = {
      user_id: user.id,
      user_name: profile.full_name || user.email || null,
      user_role: profile.role || null,
      action: String(action || "unknown").slice(0, 64),
      entity_type: opts.entityType || null,
      entity_id: opts.entityId != null ? String(opts.entityId) : null,
      summary: opts.summary ? String(opts.summary).slice(0, 500) : null,
      metadata: opts.metadata || null
    };
    const resp = await fetch(cfg.url + "/rest/v1/activity_log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) console.warn("[logActivity] HTTP", resp.status, "— check RLS policy / table exists");
  } catch (e) {
    console.warn("[logActivity] silent fail", e);
  }
}
