// ศูนย์ทีม AI (Team Command Center) — build team-center-date-range-and-export-readonly (361)
//
// READ-ONLY OWNER REVIEW SURFACE — locked invariants (see tests/team_center_readonly_guard.test.js):
//   - อ่านอย่างเดียว: ไม่ mutate ctx.state, ไม่ POST/PATCH/DELETE/PUT, ไม่ fetch ออก network
//   - ไม่แตะ POS / stock / accounting / payroll / service workflow
//   - filter / search / sort / date-range / drill-down / export ทำใน memory จาก ctx.state ที่โหลดมาแล้วเท่านั้น
//   - sort ต้อง clone array ก่อน (ห้าม mutate array เดิมใน state)
//   - export = copy markdown/text เข้า clipboard เท่านั้น (ไม่สร้างไฟล์/ไม่ upload/ไม่ POST)
//   - drill-down = read-only: ไม่มีปุ่ม save / approve / submit / delete จริง
//   - prompt generator = สร้าง text draft ให้ copy เท่านั้น
//   - field ที่ไม่มีจริง → "—" / "ยังไม่มีข้อมูล" (ห้าม hardcode 0 ให้เข้าใจผิด)
//   - integration = placeholder "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" (ไม่มี OAuth/token/connector จริง)

import { escHtml, money, formatDate } from "./utils.js";
import { parseAirJobMeta } from "./air_job_meta.js";

const NA = "ยังไม่มีข้อมูล";
let _filter = "all";       // หมวดที่เลือก (in-memory)
let _query = "";            // คำค้น (in-memory, ไม่ save DB)
let _sort = "recent";      // การเรียง (in-memory)
let _datePreset = "all";   // ช่วงวันที่ (in-memory)
let _dateFrom = "";         // custom from (YYYY-MM-DD)
let _dateTo = "";           // custom to (YYYY-MM-DD)

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function dateKeyBkk(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// เลื่อนวันจาก "วันนี้ (Asia/Bangkok)" ถอยหลัง N วัน → คืน YYYY-MM-DD (ไม่ reconvert TZ ซ้ำ)
function shiftDayKey(days) {
  const d = new Date(todayKey() + "T00:00:00");
  d.setDate(d.getDate() - days);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function tsOf(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function field(state, key) {
  return Array.isArray(state?.[key]) ? state[key] : null;
}

function countOrDash(arr) {
  return Array.isArray(arr) ? String(arr.length) : "—";
}

function countToday(rows, dateField) {
  const today = todayKey();
  return (rows || []).filter(row => dateKeyBkk(row?.[dateField]) === today).length;
}

function openJobs(serviceJobs) {
  return (serviceJobs || []).filter(j => !["done", "delivered", "closed", "cancelled"].includes(String(j?.status || "").toLowerCase()));
}

function pendingQuotes(quotations) {
  return (quotations || []).filter(q => ["draft", "sent", "pending"].includes(String(q?.status || "").toLowerCase()));
}

function airJobs(serviceJobs) {
  return (serviceJobs || []).filter(j => {
    try { return parseAirJobMeta(j)?.isAir; } catch { return false; }
  });
}

function quoteTotal(q) {
  return Number(q?.grand_total ?? q?.amount ?? q?.total_amount ?? 0);
}

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "watch", label: "งานต้องดู" },
  { key: "approve", label: "รออนุมัติ" },
  { key: "air", label: "งานแอร์" },
  { key: "customers", label: "ลูกค้า" },
  { key: "products", label: "สินค้า" },
];

const SORTS = [
  { key: "recent", label: "ล่าสุดก่อน" },
  { key: "oldest", label: "เก่าสุดก่อน" },
  { key: "amount", label: "ยอดเงินมากก่อน" },
  { key: "status", label: "สถานะ/ความสำคัญ" },
];

const DATE_PRESETS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "today", label: "วันนี้" },
  { key: "7d", label: "7 วัน" },
  { key: "30d", label: "30 วัน" },
  { key: "month", label: "เดือนนี้" },
];

const ROW_CAP = 50;

const STATUS_RANK = {
  pending: 0, new: 0, รอ: 0,
  draft: 1, sent: 1, in_progress: 1, processing: 1, quoted: 1,
  invoiced: 3, receipted: 4,
  done: 8, delivered: 8, completed: 8,
  closed: 9, cancelled: 9, rejected: 9, expired: 9,
};
function statusRank(s) {
  const k = String(s || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, k) ? STATUS_RANK[k] : 5;
}

function amountOf(item, type) {
  if (type === "quote") return quoteTotal(item);
  if (type === "product") return Number(item?.price || 0);
  return 0;
}

// ป้ายบังคับสำหรับทุกตัวเลข aggregate — ข้อมูลใน state เก็บแค่ ≤50 ล่าสุด ไม่ใช่ยอดทั้งระบบ
const LOADED_LIMIT_NOTE = "ข้อมูลที่โหลดล่าสุด ≤50 ไม่ใช่ยอดทั้งระบบ";

// pure: นับตามสถานะ + ยอดรวม (อ่านอย่างเดียว — reduce เท่านั้น, ห้าม sort/mutate)
function summarizeStats(items, type) {
  const list = items || [];
  const byStatus = list.reduce((acc, it) => {
    const k = String(it?.status || "-").toLowerCase();
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const amountSum = type === "quote" ? list.reduce((s, it) => s + quoteTotal(it), 0) : null;
  return { byStatus, count: list.length, amountSum };
}

// clone ก่อน sort เสมอ — ห้าม mutate array เดิมใน state
function sortItems(items, sort, type) {
  const arr = [...items];
  switch (sort) {
    case "oldest": return arr.sort((a, b) => tsOf(a?.created_at) - tsOf(b?.created_at));
    case "amount": return arr.sort((a, b) => amountOf(b, type) - amountOf(a, type));
    case "status": return arr.sort((a, b) => statusRank(a?.status) - statusRank(b?.status) || tsOf(b?.created_at) - tsOf(a?.created_at));
    default:       return arr.sort((a, b) => tsOf(b?.created_at) - tsOf(a?.created_at)); // recent
  }
}

// date-range filter จาก field วันที่เดิม (created_at) ใน memory — ไม่มีวันที่ = ถูกกรองออกเมื่อมีช่วง
function dateInRange(item) {
  const useCustom = _dateFrom || _dateTo;
  if (!useCustom && _datePreset === "all") return true;
  const key = dateKeyBkk(item?.created_at);
  if (!key) return false;
  if (useCustom) {
    if (_dateFrom && key < _dateFrom) return false;
    if (_dateTo && key > _dateTo) return false;
    return true;
  }
  const today = todayKey();
  switch (_datePreset) {
    case "today": return key === today;
    case "7d":    return key >= shiftDayKey(6) && key <= today;
    case "30d":   return key >= shiftDayKey(29) && key <= today;
    case "month": return key.slice(0, 7) === today.slice(0, 7);
    default:      return true;
  }
}

function applyDateRange(items) {
  if (_datePreset === "all" && !_dateFrom && !_dateTo) return items;
  return items.filter(dateInRange);
}

// ค้นหาใน memory เท่านั้น
function itemSearchText(item, type) {
  const parts = [item?.id, item?.status];
  if (type === "quote") parts.push(item?.customer_name, item?.customer);
  else if (type === "job") {
    parts.push(item?.customer_name, item?.customer_phone, item?.description);
    const air = parseAirJobMeta(item);
    if (air?.isAir) parts.push("แอร์", "air", "air_catalog", air.btu, air.intentLabel, air.summary);
  } else if (type === "customer") parts.push(item?.name, item?.phone, item?.email);
  else if (type === "product") parts.push(item?.name, item?.sku, item?.barcode);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function searchItems(items, type, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter(it => itemSearchText(it, type).includes(q));
}

function categoryOf(state, key) {
  const quotations = field(state, "quotations");
  const serviceJobs = field(state, "serviceJobs");
  switch (key) {
    case "approve":   return { type: "quote",    title: "รออนุมัติใบเสนอราคา",            items: quotations ? pendingQuotes(quotations) : null };
    case "watch":     return { type: "job",      title: "งานที่ต้องดู (งานบริการที่ยังเปิด)", items: serviceJobs ? openJobs(serviceJobs) : null };
    case "air":       return { type: "job",      title: "งานแอร์จากแคตตาล็อก",             items: serviceJobs ? airJobs(serviceJobs) : null };
    case "customers": return { type: "customer", title: "ลูกค้า",                          items: field(state, "customers") };
    case "products":  return { type: "product",  title: "สินค้า / คลัง",                   items: field(state, "products") };
    default:          return { type: "all", title: "ทั้งหมด", items: null };
  }
}

// date-range มีความหมายเฉพาะหมวดที่ผูกกับวันที่ (ใบเสนอราคา/งานบริการ)
function typeHasDate(type) { return type === "quote" || type === "job"; }

function findItem(state, type, id) {
  const key = { quote: "quotations", job: "serviceJobs", customer: "customers", product: "products", receipt: "receipts", delivery: "deliveryInvoices" }[type];
  const arr = field(state, key) || [];
  return arr.find(x => String(x?.id) === String(id)) || null;
}

// รวมเอกสารล่าสุด 3 ชนิด (read-only): tag doc-type ต่อ item, clone/spread, sort created_at desc
// คืน null ถ้าทั้ง 3 field ไม่มีจริงใน state (ยังไม่โหลด) — ไม่ mutate state เลย
function mergeRecentDocs(state) {
  const tag = (arr, type) => (Array.isArray(arr) ? arr.map(it => ({ it, type })) : []);
  const quotes = field(state, "quotations");
  const receipts = field(state, "receipts");
  const dinv = field(state, "deliveryInvoices");
  if (quotes === null && receipts === null && dinv === null) return null;
  const merged = [...tag(quotes, "quote"), ...tag(receipts, "receipt"), ...tag(dinv, "delivery")];
  return merged.sort((a, b) => tsOf(b.it?.created_at) - tsOf(a.it?.created_at));
}

function injectTeamCenterStyles() {
  if (document.getElementById("teamCenterStyles")) return;
  const style = document.createElement("style");
  style.id = "teamCenterStyles";
  style.textContent = `
    .team-center{--tc-ink:#e8f4ff;--tc-muted:#9db9cb;--tc-line:rgba(125,211,252,.22);--tc-accent:#38bdf8;color:var(--tc-ink);background:#04141f;border-radius:14px;overflow:hidden;border:1px solid rgba(56,189,248,.24);box-shadow:0 12px 30px rgba(2,8,23,.2);max-width:100%}
    .team-center *{box-sizing:border-box;min-width:0}
    .team-readonly-banner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:linear-gradient(135deg,rgba(2,132,199,.3),rgba(6,78,59,.28));border-bottom:1px solid var(--tc-line);padding:10px 16px;font-size:12.5px;font-weight:800;color:#bae6fd}
    .team-body{padding:16px;display:flex;flex-direction:column;gap:18px}
    .team-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
    .team-hero h2{margin:2px 0 4px;font-size:24px;line-height:1.2;color:#f8fafc}
    .team-hero p{margin:0;color:#cbd5e1;font-size:13px;max-width:60ch}
    .team-kicker{color:#7dd3fc;font-size:11px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
    .team-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(52,211,153,.4);background:rgba(6,78,59,.5);border-radius:999px;padding:7px 13px;font-weight:800;font-size:12.5px;white-space:nowrap;color:#a7f3d0}
    .team-filter{display:flex;flex-wrap:wrap;gap:7px}
    .team-filter button{border:1px solid var(--tc-line);background:#072133;color:#cbd5e1;border-radius:999px;padding:8px 14px;font-weight:800;font-size:12.5px;cursor:pointer;min-height:40px}
    .team-filter button.active{background:#0b65a7;color:#fff;border-color:rgba(56,189,248,.6)}
    .team-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
    .team-search{flex:1 1 220px;min-width:0;background:#082236;border:1px solid var(--tc-line);border-radius:8px;color:#e0f2fe;padding:9px 11px;font-size:13px}
    .team-sort{flex:0 0 auto;background:#082236;border:1px solid var(--tc-line);border-radius:8px;color:#e0f2fe;padding:9px 11px;font-size:13px;min-height:40px}
    .team-daterow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
    .team-daterow-label{font-size:12px;font-weight:800;color:var(--tc-muted)}
    .team-date-btn{border:1px solid var(--tc-line);background:#072133;color:#cbd5e1;border-radius:999px;padding:6px 11px;font-weight:800;font-size:12px;cursor:pointer;min-height:36px}
    .team-date-btn.active{background:#0b65a7;color:#fff;border-color:rgba(56,189,248,.6)}
    .team-date-in{background:#082236;border:1px solid var(--tc-line);border-radius:8px;color:#e0f2fe;padding:6px 9px;font-size:12px;min-height:36px;max-width:150px}
    .team-section-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:14px;font-weight:900;color:#e2e8f0}
    .team-section-title small{font-weight:700;font-size:11px;color:var(--tc-muted)}
    .team-section-title .grow{flex:1 1 auto}
    .team-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
    .team-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tc-line);background:linear-gradient(180deg,#0a2c44,#072133);border-radius:12px;padding:14px;text-align:left;cursor:pointer;font:inherit;color:inherit}
    .team-card:hover{border-color:rgba(56,189,248,.55)}
    .team-card-label{font-size:12.5px;font-weight:800;color:#cbd5e1}
    .team-card-num{font-size:30px;font-weight:900;line-height:1.05;color:#fff;word-break:break-word}
    .team-card-num.na{font-size:15px;font-weight:800;color:#94a3b8}
    .team-card-sub{font-size:11.5px;color:var(--tc-muted);line-height:1.35}
    .team-card-go{margin-top:auto;align-self:flex-start;font-size:12px;font-weight:800;color:#7dd3fc}
    .team-recent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
    .team-recent{border:1px solid var(--tc-line);background:#062235;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
    .team-recent-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:900;color:#e2e8f0}
    .team-recent-h button{border:0;background:none;color:#7dd3fc;font-weight:800;font-size:11.5px;cursor:pointer;padding:0}
    .team-listbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    .team-stats-bar{border:1px solid var(--tc-line);background:#06243a;border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;flex-direction:column;gap:7px}
    .team-stats-chips{display:flex;flex-wrap:wrap;gap:6px}
    .team-stats-note{font-size:10.5px;font-weight:800;color:#fbbf24;line-height:1.35}
    .team-list{display:flex;flex-direction:column;gap:8px}
    .team-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--tc-line);background:#072133;border-radius:10px;padding:11px 13px;cursor:pointer;font:inherit;color:inherit;min-height:48px}
    .team-row:hover{border-color:rgba(56,189,248,.55);background:#082a40}
    .team-row.mini{padding:8px 10px;min-height:auto}
    .team-row .rmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
    .team-row .rt{font-weight:800;font-size:13px;color:#f1f5f9;word-break:break-word}
    .team-row .rs{font-size:11.5px;color:var(--tc-muted);word-break:break-word}
    .team-row .rchips{display:flex;flex-wrap:wrap;gap:5px;margin-top:1px}
    .team-chip{font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 8px;white-space:nowrap;border:1px solid var(--tc-line);background:#08344f;color:#bae6fd}
    .team-chip.status{background:#0b3a58;color:#dbeafe}
    .team-chip.amount{background:#064e3b;color:#a7f3d0}
    .team-chip.source{background:#1e3a5f;color:#93c5fd}
    .team-chip.date{background:#1e293b;color:#cbd5e1}
    .team-row .chev{color:#7dd3fc;font-weight:900;flex:none;align-self:center}
    .team-empty{border:1px dashed var(--tc-line);border-radius:10px;padding:18px;text-align:center;color:#94a3b8;font-size:13px}
    .team-int-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
    .team-int{display:flex;flex-direction:column;gap:5px;border:1px dashed rgba(148,163,184,.35);background:rgba(8,28,42,.6);border-radius:10px;padding:12px;opacity:.92}
    .team-int-name{font-weight:800;font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:7px}
    .team-int-status{font-size:11px;font-weight:800;color:#fca5a5}
    .team-int-note{margin-top:2px;font-size:11px;color:#93c5fd;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .team-link-btn{border:1px solid rgba(125,211,252,.4);background:#0b3a58;color:#f0f9ff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:11.5px;cursor:pointer}
    .team-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
    .team-role{display:flex;align-items:center;gap:10px;border:1px solid var(--tc-line);background:#062235;border-radius:10px;padding:10px 12px}
    .team-role .ic{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:rgba(56,189,248,.16);font-size:18px;flex:none}
    .team-role b{display:block;font-size:13px;color:#f1f5f9}
    .team-role span{font-size:11px;color:var(--tc-muted)}
    .team-role .tag{margin-left:auto;font-size:10px;font-weight:900;color:#fbbf24;border:1px solid rgba(251,191,36,.4);border-radius:999px;padding:3px 7px;white-space:nowrap}
    .team-notes{border:1px solid var(--tc-line);background:#051d2d;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
    .team-notes-log{display:flex;flex-direction:column;gap:8px;max-height:240px;overflow:auto}
    .team-note-item{border:1px solid rgba(125,211,252,.18);background:#08344f;border-radius:8px;padding:9px 11px;font-size:13px;line-height:1.45;color:#e0f2fe;word-break:break-word}
    .team-note-item small{display:block;margin-bottom:3px;font-weight:900;font-size:10.5px;color:#7dd3fc}
    .team-command{display:flex;gap:8px;flex-wrap:wrap}
    .team-command input{flex:1 1 200px;min-width:0;background:#082236;border:1px solid var(--tc-line);border-radius:8px;color:#e0f2fe;padding:10px 11px;font-size:13px}
    .team-command button{border:1px solid rgba(125,211,252,.42);background:#075985;color:#f0f9ff;border-radius:8px;padding:9px 14px;font-weight:900;font-size:12.5px;cursor:pointer;min-height:42px}
    .team-quick{display:flex;flex-wrap:wrap;gap:7px}
    .team-quick button{border:1px solid rgba(125,211,252,.4);background:#0b3a58;color:#f0f9ff;border-radius:8px;padding:7px 10px;font-weight:800;font-size:11.5px;cursor:pointer;min-height:36px}
    .team-quick button.nav{background:#065f46}
    .team-hint{font-size:11.5px;color:#93c5fd;line-height:1.4}
    .team-modal{position:fixed;inset:0;z-index:9995;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,8,23,.68)}
    .team-modal-panel{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#06212f;border:1px solid rgba(56,189,248,.4);border-radius:14px;padding:18px;box-shadow:0 24px 60px rgba(2,8,23,.5)}
    .team-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}
    .team-modal-head h3{margin:0;font-size:17px;color:#f8fafc;word-break:break-word}
    .team-modal-close{border:1px solid var(--tc-line);background:#0b3a58;color:#f0f9ff;border-radius:8px;padding:6px 11px;font-weight:900;cursor:pointer;flex:none;min-height:38px}
    .team-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:10px 0;font-size:13px}
    .team-kv dt{color:var(--tc-muted);font-weight:700}
    .team-kv dd{margin:0;color:#e2e8f0;word-break:break-word}
    .team-modal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
    .team-modal-actions button{border-radius:8px;padding:9px 13px;font-weight:800;font-size:12.5px;cursor:pointer;min-height:42px;border:1px solid rgba(125,211,252,.42)}
    .team-modal-actions .go{background:#065f46;color:#ecfdf5}
    .team-modal-actions .copy{background:#075985;color:#f0f9ff}
    .team-modal-actions .close{background:#1e293b;color:#e2e8f0}
    .team-copy-status{font-size:11.5px;color:#34d399;font-weight:800;margin-top:8px;min-height:14px}
    @media (max-width:640px){
      .team-body{padding:12px;gap:14px}
      .team-hero h2{font-size:20px}
      .team-cards{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
      .team-card-num{font-size:26px}
      .team-sort{flex:1 1 100%}
      .team-date-in{max-width:46%}
      .team-modal{padding:10px;align-items:flex-end}
      .team-modal-panel{max-height:calc(100vh - 20px)}
    }
  `;
  document.head.appendChild(style);
}

const TEAM_ROLES = [
  { ic: "👩‍💼", name: "Mina", role: "เลขาฯ / สรุปงาน" },
  { ic: "📈", name: "Leo", role: "Meta / โฆษณา" },
  { ic: "🗂️", name: "Sam", role: "Google Workspace / เอกสาร" },
  { ic: "🧾", name: "Ava", role: "แอดมิน / HR" },
];

const INTEGRATIONS = [
  { icon: "📄", name: "Notion" },
  { icon: "✉️", name: "Gmail" },
  { icon: "📁", name: "Google Drive" },
  { icon: "📊", name: "Google Ads" },
  { icon: "🔵", name: "Meta Ads" },
  { icon: "💻", name: "Codex / Local" },
];

const CONNECT_PROMPT = "ขอแนวทางเชื่อมต่อ integration (Notion/Gmail/Drive/Meta/Google Ads) แบบ read-only ผ่าน Cloudflare Functions + จัดการ OAuth/secret ใน env ให้ปลอดภัย โดยไม่ให้ service key หลุดฝั่ง client";

function cardNumHtml(num) {
  if (num === null || num === undefined) return `<div class="team-card-num na">${NA}</div>`;
  return `<div class="team-card-num">${escHtml(String(num))}</div>`;
}

function chip(cls, text) {
  return `<span class="team-chip ${cls}">${escHtml(text)}</span>`;
}

// stats bar (อ่านอย่างเดียว) — chips นับตามสถานะ (เรียง statusRank) + ยอดรวมเฉพาะ quote + ป้าย ≤50
// ไม่มีรายการ → คืน "" (ไม่โชว์ chip, ห้าม hardcode 0)
function statsBarHtml(items, type, noteCtx) {
  if (!items || items.length === 0) return "";
  const { byStatus, amountSum } = summarizeStats(items, type);
  const statusChips = Object.keys(byStatus)
    .sort((a, b) => statusRank(a) - statusRank(b))
    .map(k => chip("status", `${k}: ${byStatus[k]}`))
    .join("");
  const amountChip = (type === "quote" && amountSum !== null) ? chip("amount", `ยอดรวม(ที่กรอง) ${money(amountSum)}`) : "";
  const ctxNote = noteCtx || "จากรายการที่กรอง";
  return `<div class="team-stats-bar">
      <div class="team-stats-chips">${statusChips}${amountChip}</div>
      <div class="team-stats-note">📊 ${escHtml(ctxNote)} · ${escHtml(LOADED_LIMIT_NOTE)}</div>
    </div>`;
}

// row รายการจริง
function rowHtml(item, type, mini) {
  const id = String(item?.id ?? "-");
  let title = "", sub = "", chips = "";
  if (type === "quote") {
    title = `#${id}`;
    sub = item.customer_name || item.customer || "ไม่ระบุชื่อลูกค้า";
    chips = chip("source", "ใบเสนอราคา") + chip("status", `สถานะ ${item.status || "-"}`) + chip("amount", money(quoteTotal(item))) + (item.created_at ? chip("date", formatDate(item.created_at)) : "");
  } else if (type === "receipt") {
    title = item.receipt_no || `#${id}`;
    sub = item.customer_name || "ไม่ระบุชื่อลูกค้า";
    chips = chip("source", "ใบเสร็จ") + chip("status", `สถานะ ${item.status || "-"}`) + chip("amount", money(Number(item.grand_total || 0))) + (item.created_at ? chip("date", formatDate(item.created_at)) : "");
  } else if (type === "delivery") {
    title = item.inv_no || `#${id}`;
    sub = item.customer_name || "ไม่ระบุชื่อลูกค้า";
    chips = chip("source", "ใบส่งของ") + chip("status", `สถานะ ${item.status || "-"}`) + chip("amount", money(Number(item.grand_total || 0))) + (item.created_at ? chip("date", formatDate(item.created_at)) : "");
  } else if (type === "job") {
    const air = parseAirJobMeta(item);
    title = `#${id} · ${item.customer_name || "ไม่ระบุชื่อ"}`;
    sub = item.description ? String(item.description).slice(0, 80) : (item.customer_phone || "ไม่มีรายละเอียด");
    chips = chip("status", `สถานะ ${item.status || "-"}`) + (item.created_at ? chip("date", formatDate(item.created_at)) : "") + (air?.isAir ? chip("source", "🌬️ แอร์จากแคตตาล็อก") : "");
  } else if (type === "customer") {
    title = item.name || "ไม่ระบุชื่อ";
    sub = item.phone || "ไม่มีเบอร์";
    chips = item.email ? chip("source", item.email) : "";
  } else {
    title = item.name || "ไม่ระบุชื่อ";
    sub = `SKU ${item.sku || "-"}`;
    chips = chip("amount", money(Number(item.price || 0))) + chip("status", `คงเหลือ ${item.stock ?? "—"}`);
  }
  return `<button type="button" class="team-row${mini ? " mini" : ""}" data-detail="${escHtml(type)}:${escHtml(id)}">
    <span class="rmain">
      <span class="rt">${escHtml(title)}</span>
      <span class="rs">${escHtml(sub)}</span>
      ${mini ? "" : `<span class="rchips">${chips}</span>`}
    </span>
    <span class="chev">${mini ? "›" : "ดูรายละเอียด ›"}</span>
  </button>`;
}

// ── markdown export (read-only, copy → clipboard เท่านั้น) ────────────────────
function mdItemLine(item, type) {
  if (type === "quote") return `- #${item.id ?? "-"} · ${item.customer_name || item.customer || "-"} · ${item.status || "-"} · ${money(quoteTotal(item))} · ${formatDate(item.created_at)}`;
  if (type === "job") {
    const air = parseAirJobMeta(item);
    return `- #${item.id ?? "-"} · ${item.customer_name || "-"} · ${item.status || "-"} · ${formatDate(item.created_at)}${air?.isAir ? " · 🌬️แอร์" : ""}`;
  }
  if (type === "customer") return `- ${item.name || "-"} · ${item.phone || "-"}`;
  return `- ${item.name || "-"} · ${money(Number(item.price || 0))} · คงเหลือ ${item.stock ?? "-"}`;
}

function contextLabel() {
  const bits = [];
  if (_query.trim()) bits.push(`ค้นหา: ${_query.trim()}`);
  if (_dateFrom || _dateTo) bits.push(`ช่วง: ${_dateFrom || "…"} ถึง ${_dateTo || "…"}`);
  else if (_datePreset !== "all") bits.push(`ช่วง: ${(DATE_PRESETS.find(p => p.key === _datePreset) || {}).label || _datePreset}`);
  bits.push(`เรียง: ${(SORTS.find(s => s.key === _sort) || {}).label || _sort}`);
  return bits.join(" · ");
}

// stats เป็น markdown (หัวของ summary) — บรรทัดสรุปสถานะ + ยอดรวม(ที่กรอง) เฉพาะ quote + ป้าย ≤50
function mdStats(items, type) {
  if (!items || items.length === 0) return "";
  const { byStatus, amountSum } = summarizeStats(items, type);
  const statusLine = Object.keys(byStatus)
    .sort((a, b) => statusRank(a) - statusRank(b))
    .map(k => `${k}: ${byStatus[k]}`)
    .join(" · ");
  const amountLine = (type === "quote" && amountSum !== null) ? `\n**ยอดรวม(ที่กรอง):** ${money(amountSum)}` : "";
  return `**สรุปสถานะ:** ${statusLine}${amountLine}\n_📊 จากรายการที่กรอง · ${LOADED_LIMIT_NOTE}_\n\n`;
}

function buildListSummary(cat, items) {
  const head = `## ${cat.title} (${items.length} รายการ) — ${contextLabel()}`;
  const stats = mdStats(items, cat.type);
  const body = items.slice(0, ROW_CAP).map(it => mdItemLine(it, cat.type)).join("\n");
  const more = items.length > ROW_CAP ? `\n_…แสดง ${ROW_CAP} จาก ${items.length}_` : "";
  return `${head}\n${stats}${body || "- (ไม่มีรายการ)"}${more}\n\n_อ่านอย่างเดียวจากศูนย์ทีม AI — ไม่ใช่เอกสารทางการ_`;
}

function buildOverviewSummary(state) {
  const quotes = field(state, "quotations");
  const jobsField = field(state, "serviceJobs");
  const lines = [
    `- งานที่ต้องดู: ${jobsField ? openJobs(jobsField).length : NA}`,
    `- รออนุมัติใบเสนอราคา: ${quotes ? pendingQuotes(quotes).length : NA}`,
    `- งานแอร์จากแคตตาล็อก: ${jobsField ? airJobs(jobsField).length : NA}`,
    `- ลูกค้า: ${countOrDash(field(state, "customers"))}`,
    `- สินค้า: ${countOrDash(field(state, "products"))}`,
  ];
  return `## ศูนย์ทีม AI — สรุปภาพรวม (read-only)\n${lines.join("\n")}\n\n_คัดลอกจากศูนย์ทีม AI — ไม่ใช่เอกสารทางการ_`;
}

// overview: priority cards → recent groups
function renderOverview(state) {
  const quotes = field(state, "quotations");
  const jobsField = field(state, "serviceJobs");
  const customers = field(state, "customers");
  const products = field(state, "products");
  const receipts = field(state, "receipts");
  const deliveryInvoices = field(state, "deliveryInvoices");

  const pendingQ = quotes ? pendingQuotes(quotes) : null;
  const openJobsArr = jobsField ? openJobs(jobsField) : null;
  const airArr = jobsField ? airJobs(jobsField) : null;
  const docFields = [receipts, quotes, deliveryInvoices].filter(Array.isArray);
  const docsNum = docFields.length ? docFields.reduce((a, b) => a + b.length, 0) : null;
  const receiptsToday = receipts ? countToday(receipts, "created_at") : null;

  const cards = [
    { label: "งานที่ต้องดู", num: openJobsArr ? openJobsArr.length : null, sub: "งานบริการที่ยังเปิดอยู่", go: "watch" },
    { label: "รออนุมัติใบเสนอราคา", num: pendingQ ? pendingQ.length : null, sub: "draft / ส่งแล้ว / รอดำเนินการ", go: "approve" },
    { label: "งานแอร์จากแคตตาล็อก", num: airArr ? airArr.length : null, sub: "งานบริการ source=air_catalog", go: "air" },
    { label: "เอกสารล่าสุด", num: docsNum, sub: receiptsToday !== null ? `ใบเสร็จ/ใบเสนอราคา/ใบส่งของ · วันนี้ ${receiptsToday} ใบเสร็จ` : "ใบเสร็จ/ใบเสนอราคา/ใบส่งของ", nav: "receipts" },
    { label: "ลูกค้า", num: customers ? customers.length : null, sub: "ลูกค้าในระบบที่โหลดแล้ว", go: "customers" },
    { label: "สินค้า / คลัง", num: products ? products.length : null, sub: "รายการสินค้าที่โหลดแล้ว", go: "products" },
  ];

  // recent groups (อ่านอย่างเดียว, top 3 ล่าสุดต่อหมวด)
  const groups = [
    { title: "งานล่าสุด", type: "job", key: "watch", arr: jobsField },
    { title: "ลูกค้าล่าสุด", type: "customer", key: "customers", arr: customers },
    { title: "สินค้าล่าสุด", type: "product", key: "products", arr: products },
  ];
  // เอกสารล่าสุด = รวม 3 ชนิด (ใบเสนอราคา/ใบเสร็จ/ใบส่งของ) เรียงตามวันที่ (read-only merge)
  const mergedDocs = mergeRecentDocs(state);
  const docsInner = mergedDocs === null
    ? `<div class="team-empty">${NA}</div>`
    : (mergedDocs.length === 0
      ? `<div class="team-empty">ยังไม่มีรายการ</div>`
      : mergedDocs.slice(0, 3).map(d => rowHtml(d.it, d.type)).join(""));

  return `
    <div class="team-section-title">📋 งานที่ต้องจัดการ <small>กดการ์ดเพื่อดู/ค้นหา/เรียงรายการในหมวด</small>
      <span class="grow"></span>
      <button type="button" class="team-link-btn" data-team-copy="${escHtml(buildOverviewSummary(state))}">📋 คัดลอกสรุปภาพรวม</button>
    </div>
    <div class="team-cards">
      ${cards.map(c => {
        const attr = c.go ? `data-filter="${escHtml(c.go)}"` : `data-team-nav="${escHtml(c.nav)}"`;
        const act = c.go ? "ดูรายการ →" : "เปิดหน้า →";
        return `<button type="button" class="team-card" ${attr}>
          <span class="team-card-label">${escHtml(c.label)}</span>
          ${cardNumHtml(c.num)}
          <span class="team-card-sub">${escHtml(c.sub)}</span>
          <span class="team-card-go">${act}</span>
        </button>`;
      }).join("")}
    </div>

    ${quotes && quotes.length ? `<div class="team-section-title" style="margin-top:6px">🧾 ใบเสนอราคา — สรุปตามสถานะ</div>${statsBarHtml(quotes, "quote", "ใบเสนอราคาที่โหลด (ทุกสถานะ)")}` : ""}

    <div class="team-section-title" style="margin-top:6px">🕒 ล่าสุด <small>3 รายการล่าสุดต่อหมวด (อ่านอย่างเดียว)</small></div>
    <div class="team-recent-grid">
      <div class="team-recent">
        <div class="team-recent-h"><span>เอกสารล่าสุด</span><small style="color:var(--tc-muted);font-weight:700">ใบเสนอราคา/ใบเสร็จ/ใบส่งของ</small></div>
        ${docsInner}
      </div>
      ${groups.map(g => {
        const inner = g.arr === null
          ? `<div class="team-empty">${NA}</div>`
          : (g.arr.length === 0
            ? `<div class="team-empty">ยังไม่มีรายการ</div>`
            : sortItems(g.arr, "recent", g.type).slice(0, 3).map(it => rowHtml(it, g.type, true)).join(""));
        return `<div class="team-recent">
          <div class="team-recent-h"><span>${escHtml(g.title)}</span><button type="button" data-filter="${escHtml(g.key)}">ดูทั้งหมด →</button></div>
          ${inner}
        </div>`;
      }).join("")}
    </div>
  `;
}

// list body = search + date-range + sort applied (re-render เฉพาะส่วนนี้ตอน search/sort/date)
function renderListBody(state, key) {
  const cat = categoryOf(state, key);
  if (cat.items === null) return `<div class="team-empty">ยังไม่มีข้อมูลในระบบ (ยังไม่ได้โหลด)</div>`;
  if (cat.items.length === 0) return `<div class="team-empty">ยังไม่มีรายการในหมวดนี้</div>`;

  let working = searchItems(cat.items, cat.type, _query);
  if (typeHasDate(cat.type)) working = applyDateRange(working);
  if (working.length === 0) return `<div class="team-empty">ไม่พบรายการตามคำค้น/ช่วงวันที่นี้</div>`;

  const sorted = sortItems(working, _sort, cat.type);
  const shown = sorted.slice(0, ROW_CAP);
  const truncated = sorted.length > ROW_CAP;
  const summary = buildListSummary(cat, sorted);
  // stats bar เฉพาะหมวดที่ผูกวันที่ (ใบเสนอราคา/งานบริการ) — คิดจาก sorted (ผ่าน search+date+sort แล้ว)
  const statsBar = typeHasDate(cat.type) ? statsBarHtml(sorted, cat.type) : "";
  return `
    ${statsBar}
    <div class="team-listbar">
      <span class="team-hint">แสดง ${shown.length} จาก ${sorted.length} รายการที่ตรงเงื่อนไข</span>
      <button type="button" class="team-link-btn" data-team-copy="${escHtml(summary)}">📋 คัดลอกสรุป (Markdown)</button>
    </div>
    <div class="team-list">${shown.map(it => rowHtml(it, cat.type)).join("")}</div>
    ${truncated ? `<div class="team-hint">แสดง ${ROW_CAP} จาก ${sorted.length} รายการ — แคบคำค้น/ช่วงวันที่ หรือเปิดหน้าต้นทางเพื่อดูทั้งหมด</div>` : ""}
  `;
}

function renderListView(state, key) {
  const cat = categoryOf(state, key);
  const total = Array.isArray(cat.items) ? cat.items.length : 0;
  const showDate = typeHasDate(cat.type);
  const dateRow = showDate ? `
    <div class="team-daterow" id="teamDateRow">
      <span class="team-daterow-label">ช่วงวันที่:</span>
      ${DATE_PRESETS.map(p => `<button type="button" class="team-date-btn" data-date-preset="${escHtml(p.key)}">${escHtml(p.label)}</button>`).join("")}
      <input class="team-date-in" type="date" id="teamDateFrom" value="${escHtml(_dateFrom)}" aria-label="จากวันที่" />
      <input class="team-date-in" type="date" id="teamDateTo" value="${escHtml(_dateTo)}" aria-label="ถึงวันที่" />
    </div>` : "";
  return `
    <div class="team-section-title">${escHtml(cat.title)} <small>${total} รายการ · กดแถวเพื่อดูรายละเอียด (read-only)</small></div>
    <div class="team-controls">
      <input class="team-search" id="teamSearch" type="search" placeholder="ค้นหา (เลขเอกสาร / ลูกค้า / สถานะ / รุ่น-BTU)..." aria-label="ค้นหารายการในหมวดนี้" value="${escHtml(_query)}" />
      <select class="team-sort" id="teamSort" aria-label="เรียงรายการ">
        ${SORTS.map(s => `<option value="${escHtml(s.key)}"${s.key === _sort ? " selected" : ""}>${escHtml(s.label)}</option>`).join("")}
      </select>
    </div>
    ${dateRow}
    <div id="teamListBody">${renderListBody(state, key)}</div>
  `;
}

function kvRow(label, value) {
  const v = (value === null || value === undefined || value === "") ? "—" : value;
  return `<dt>${escHtml(label)}</dt><dd>${escHtml(String(v))}</dd>`;
}

// drill-down detail (read-only) — ไม่มีปุ่ม save/approve/submit/delete
function detailHtml(item, type) {
  let title = "รายละเอียด", rows = "", route = "";
  if (type === "quote") {
    title = `ใบเสนอราคา #${item.id ?? "-"}`;
    route = "quotations";
    rows = [
      kvRow("ลูกค้า", item.customer_name || item.customer),
      kvRow("สถานะ", item.status),
      kvRow("วันที่", formatDate(item.created_at)),
      kvRow("ยอดเงิน", money(quoteTotal(item))),
    ].join("");
  } else if (type === "job") {
    const air = parseAirJobMeta(item);
    title = `งานบริการ #${item.id ?? "-"}`;
    route = "service_jobs";
    rows = [
      kvRow("ลูกค้า", item.customer_name),
      kvRow("เบอร์", item.customer_phone),
      kvRow("สถานะ", item.status),
      kvRow("วันที่", formatDate(item.created_at)),
      kvRow("รายละเอียด", item.description),
      kvRow("ที่มา", air?.isAir ? "แคตตาล็อกแอร์ (air_catalog)" : "งานทั่วไป"),
      air?.isAir ? kvRow("รุ่น/BTU", air.btu) : "",
      air?.isAir ? kvRow("ราคาเสนอ", air.price) : "",
      air?.isAir ? kvRow("นัดหมาย", air.appointment) : "",
    ].join("");
  } else if (type === "customer") {
    title = escHtml(item.name || "ลูกค้า");
    route = "customers";
    rows = [
      kvRow("ชื่อ", item.name),
      kvRow("เบอร์", item.phone),
      kvRow("อีเมล", item.email),
      kvRow("รหัสลูกค้า", item.id),
    ].join("");
  } else if (type === "receipt") {
    title = `ใบเสร็จ ${item.receipt_no || "#" + (item.id ?? "-")}`;
    route = "receipts";
    rows = [
      kvRow("เลขที่", item.receipt_no),
      kvRow("ลูกค้า", item.customer_name),
      kvRow("สถานะ", item.status),
      kvRow("วันที่", formatDate(item.created_at)),
      kvRow("ยอดเงิน", money(Number(item.grand_total || 0))),
    ].join("");
  } else if (type === "delivery") {
    title = `ใบส่งของ ${item.inv_no || "#" + (item.id ?? "-")}`;
    route = "delivery_invoices";
    rows = [
      kvRow("เลขที่", item.inv_no),
      kvRow("ลูกค้า", item.customer_name),
      kvRow("สถานะ", item.status),
      kvRow("วันที่", formatDate(item.created_at)),
      kvRow("ยอดเงิน", money(Number(item.grand_total || 0))),
    ].join("");
  } else {
    title = escHtml(item.name || "สินค้า");
    route = "products";
    rows = [
      kvRow("ชื่อสินค้า", item.name),
      kvRow("ราคา", money(Number(item.price || 0))),
      kvRow("คงเหลือ", item.stock),
      kvRow("SKU", item.sku),
      kvRow("บาร์โค้ด", item.barcode),
    ].join("");
  }

  const prompt = buildPrompt(item, type);
  return `
    <div class="team-modal" id="teamModalOverlay">
      <div class="team-modal-panel" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <div class="team-modal-head">
          <h3>${title}</h3>
          <button type="button" class="team-modal-close" data-modal-close>ปิด</button>
        </div>
        <div class="team-hint">มุมมองอ่านอย่างเดียว — ไม่มีปุ่มบันทึก/อนุมัติ/ส่งจริง</div>
        <dl class="team-kv">${rows}</dl>
        <div class="team-modal-actions">
          <button type="button" class="go" data-team-nav="${escHtml(route)}">→ ไปหน้าต้นทาง</button>
          <button type="button" class="copy" data-team-copy="${escHtml(prompt)}">📋 คัดลอก prompt ให้ทีม</button>
          <button type="button" class="close" data-modal-close>ปิด</button>
        </div>
        <div class="team-copy-status" data-copy-status></div>
      </div>
    </div>
  `;
}

// owner prompt generator — text draft (clipboard เท่านั้น) พร้อมบริบท + สิ่งที่ควรตรวจ
function buildPrompt(item, type) {
  if (type === "quote") {
    return `[ใบเสนอราคา] #${item.id ?? "-"} · ลูกค้า ${item.customer_name || item.customer || "-"} · สถานะ ${item.status || "-"} · ยอด ${money(quoteTotal(item))}. ช่วยตรวจก่อนอนุมัติ: ความถูกต้องของราคา/ส่วนลด/VAT, ข้อมูลลูกค้า, เงื่อนไขการชำระ แล้วสรุปประเด็นเสี่ยงให้หน่อย`;
  }
  if (type === "job") {
    const air = parseAirJobMeta(item);
    const base = `[งานบริการ] #${item.id ?? "-"} · ลูกค้า ${item.customer_name || "-"} · สถานะ ${item.status || "-"}. ช่วยเช็คว่าข้อมูลครบหรือยัง: อาการ/อุปกรณ์, การนัดหมาย, ค่าบริการ/อะไหล่`;
    return air?.isAir ? `${base}. เป็นงานแอร์จากแคตตาล็อก รุ่น/BTU ${air.btu || "-"} ราคาเสนอ ${air.price || "-"} — ช่วยยืนยันราคาและนัดหมายให้ลูกค้าด้วย` : base;
  }
  if (type === "customer") {
    return `[ลูกค้า] ${item.name || "-"} · ${item.phone || "-"}. ช่วยสรุป: ประวัติการซื้อ, ยอดค้างชำระ (ถ้ามี), โอกาสติดตาม/ขายเพิ่ม`;
  }
  return `[สินค้า] ${item.name || "-"} · คงเหลือ ${item.stock ?? "-"} · ราคา ${money(Number(item.price || 0))}. ช่วยตรวจ: จุดสั่งซื้อใหม่, ต้นทุน/ราคาขาย, ความเคลื่อนไหวสต็อกล่าสุด`;
}

export function renderTeamCommandCenter(ctx) {
  const container = document.getElementById("page-team_center");
  if (!container) return;
  injectTeamCenterStyles();

  const state = ctx?.state || {};
  _filter = "all"; _query = ""; _sort = "recent"; _datePreset = "all"; _dateFrom = ""; _dateTo = "";

  container.innerHTML = `
    <div class="team-center">
      <div class="team-readonly-banner">🔒 โหมดอ่านอย่างเดียว (read-only) — แดชบอร์ดนี้แสดงภาพรวมจากข้อมูลที่ระบบโหลดมาแล้ว ไม่บันทึก/ไม่แก้ไขข้อมูลจริง</div>
      <div class="team-body">

        <div class="team-hero">
          <div>
            <div class="team-kicker">Owner Review</div>
            <h2>ศูนย์ทีม AI</h2>
            <p>มุมมองอ่านอย่างเดียวสำหรับเจ้าของร้าน — กรอง ค้นหา เลือกช่วงวันที่ ดูรายละเอียด และคัดลอกสรุป/prompt ส่งให้ทีม (ไม่เปลี่ยนข้อมูลจริง)</p>
          </div>
          <div class="team-badge">🔒 Read-only</div>
        </div>

        <div class="team-filter" id="teamFilter" role="tablist" aria-label="กรองหมวดงาน">
          ${FILTERS.map(f => `<button type="button" role="tab" data-filter="${escHtml(f.key)}">${escHtml(f.label)}</button>`).join("")}
        </div>

        <section id="teamView"></section>

        <section>
          <div class="team-section-title">🔌 การเชื่อมต่อภายนอก <small>ยังไม่เชื่อมต่อจริง — placeholder รอ owner อนุมัติ</small></div>
          <div class="team-int-grid">
            ${INTEGRATIONS.map(i => `
              <div class="team-int">
                <div class="team-int-name">${i.icon} ${escHtml(i.name)}</div>
                <div class="team-int-status">ยังไม่เชื่อมต่อ · รอ owner อนุมัติ</div>
              </div>
            `).join("")}
          </div>
          <div class="team-int-note">
            ⚠️ ยังไม่มี integration จริง (ไม่มี token/OAuth/connector) — เป็นตัวอย่างหน้าจอเท่านั้น
            <button type="button" class="team-link-btn" data-team-copy="${escHtml(CONNECT_PROMPT)}">📋 คัดลอก prompt แนวทางเชื่อมต่อ</button>
          </div>
        </section>

        <section>
          <div class="team-section-title">🤝 ผู้ช่วย AI <small>ตัวอย่างบทบาททีม (ตัวอย่าง — ยังไม่ใช่ agent ที่ทำงานจริง)</small></div>
          <div class="team-roles">
            ${TEAM_ROLES.map(r => `
              <div class="team-role">
                <div class="ic" aria-hidden="true">${r.ic}</div>
                <div><b>${escHtml(r.name)}</b><span>${escHtml(r.role)}</span></div>
                <span class="tag">ตัวอย่าง</span>
              </div>
            `).join("")}
          </div>
        </section>

        <section>
          <div class="team-section-title">📝 บันทึก Draft / Prompt <small>บันทึก draft ในหน้านี้เท่านั้น — ไม่ส่งหา AI/ระบบใด และไม่บันทึกลงฐานข้อมูล</small></div>
          <div class="team-notes">
            <div class="team-notes-log" id="teamChatLog">
              <div class="team-note-item"><small>ตัวอย่าง</small>พิมพ์ prompt หรือบันทึกย่อ เช่น "ตามใบเสนอราคาลูกค้า A" แล้วกดเพิ่ม — ข้อความจะอยู่เฉพาะหน้านี้</div>
            </div>
            <div class="team-command">
              <input id="teamCommandInput" type="text" placeholder="พิมพ์ draft / prompt (ในหน้านี้เท่านั้น)..." aria-label="พิมพ์ draft หรือ prompt" />
              <button id="teamSendBtn" type="button">เพิ่ม draft</button>
            </div>
            <div class="team-hint">💬 ข้อความเป็น draft ในหน้านี้เท่านั้น — ไม่ถูกบันทึก ไม่ถูกส่งไปที่ใด รีเฟรชแล้วหาย</div>
            <div class="team-quick">
              <button type="button" data-team-copy="@Mina ช่วยสรุปงานที่ต้องอนุมัติวันนี้">คัดลอก prompt: ถาม Mina</button>
              <button type="button" data-team-copy="@Sam ช่วยตรวจใบเสนอราคาที่ค้าง">คัดลอก prompt: ถาม Sam</button>
              <button type="button" class="nav" data-team-nav="quotations">→ ไปที่ใบเสนอราคา</button>
              <button type="button" class="nav" data-team-nav="service_jobs">→ ไปที่งานบริการ</button>
            </div>
          </div>
        </section>

      </div>
      <div id="teamModalHost"></div>
    </div>
  `;

  const view = container.querySelector("#teamView");
  const filterBar = container.querySelector("#teamFilter");
  const modalHost = container.querySelector("#teamModalHost");
  const input = container.querySelector("#teamCommandInput");
  const log = container.querySelector("#teamChatLog");

  const refreshListBody = () => {
    const body = view.querySelector("#teamListBody");
    if (body) body.innerHTML = renderListBody(state, _filter);
  };
  const syncDatePresets = () => {
    view.querySelectorAll("[data-date-preset]").forEach(b => b.classList.toggle("active", b.dataset.datePreset === _datePreset && !_dateFrom && !_dateTo));
  };
  const wireListControls = () => {
    const search = view.querySelector("#teamSearch");
    const sortSel = view.querySelector("#teamSort");
    const dFrom = view.querySelector("#teamDateFrom");
    const dTo = view.querySelector("#teamDateTo");
    if (search) search.oninput = () => { _query = search.value; refreshListBody(); };
    if (sortSel) sortSel.onchange = () => { _sort = sortSel.value; refreshListBody(); };
    if (dFrom) dFrom.onchange = () => { _dateFrom = dFrom.value; _datePreset = "custom"; refreshListBody(); syncDatePresets(); };
    if (dTo) dTo.onchange = () => { _dateTo = dTo.value; _datePreset = "custom"; refreshListBody(); syncDatePresets(); };
    syncDatePresets();
  };

  const renderView = () => {
    view.innerHTML = _filter === "all" ? renderOverview(state) : renderListView(state, _filter);
    if (_filter !== "all") wireListControls();
  };
  const syncChips = () => {
    filterBar.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("active", b.dataset.filter === _filter));
  };
  const openModal = (token) => {
    const idx = String(token || "").indexOf(":");
    const type = String(token || "").slice(0, idx);
    const id = String(token || "").slice(idx + 1);
    const item = findItem(state, type, id);
    if (!item) return;
    modalHost.innerHTML = detailHtml(item, type);
  };
  const closeModal = () => { modalHost.innerHTML = ""; };

  const copyText = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      ctx?.showToast?.("คัดลอกข้อความแล้ว");
      const status = btn?.closest(".team-modal-panel")?.querySelector("[data-copy-status]");
      if (status) status.textContent = "✓ คัดลอกแล้ว — เอาไปวางใน chat ทีมได้เลย";
    } catch {
      ctx?.showToast?.("คัดลอกไม่สำเร็จ — คัดลอกด้วยมือได้");
    }
  };

  // draft local เท่านั้น — append DOM, ไม่บันทึก, ไม่ส่ง network, ไม่ mutate state
  const addDraft = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    log.insertAdjacentHTML("beforeend", `<div class="team-note-item"><small>Draft · ในหน้านี้เท่านั้น</small>${escHtml(clean)}</div>`);
    log.scrollTop = log.scrollHeight;
    ctx?.showToast?.("เพิ่ม draft ในหน้านี้แล้ว (ไม่บันทึก)");
    if (input) input.value = "";
  };

  renderView();
  syncChips();

  // event delegation (idempotent: ใช้ onclick assignment กันผูก listener ซ้ำตอน re-render route)
  container.onclick = (e) => {
    const filterEl = e.target.closest("[data-filter]");
    if (filterEl) { _filter = filterEl.dataset.filter; _query = ""; _sort = "recent"; _datePreset = "all"; _dateFrom = ""; _dateTo = ""; renderView(); syncChips(); return; }
    const dateEl = e.target.closest("[data-date-preset]");
    if (dateEl) {
      _datePreset = dateEl.dataset.datePreset; _dateFrom = ""; _dateTo = "";
      const dFrom = view.querySelector("#teamDateFrom"); if (dFrom) dFrom.value = "";
      const dTo = view.querySelector("#teamDateTo"); if (dTo) dTo.value = "";
      refreshListBody(); syncDatePresets(); return;
    }
    const detailEl = e.target.closest("[data-detail]");
    if (detailEl) { openModal(detailEl.dataset.detail); return; }
    if (e.target.id === "teamModalOverlay" || e.target.closest("[data-modal-close]")) { closeModal(); return; }
    const navEl = e.target.closest("[data-team-nav]");
    if (navEl) { const r = navEl.dataset.teamNav; if (r) ctx?.showRoute?.(r); return; }
    const copyEl = e.target.closest("[data-team-copy]");
    if (copyEl) { copyText(copyEl.dataset.teamCopy, copyEl); return; }
    if (e.target.closest("#teamSendBtn")) { addDraft(input?.value); return; }
  };

  if (input) {
    input.onkeydown = (e) => { if (e.key === "Enter") addDraft(input.value); };
  }
}
