// ศูนย์ทีม AI (Team Command Center) — build team-center-owner-action-surface (359)
//
// READ-ONLY OWNER REVIEW SURFACE — locked invariants (see tests/team_center_readonly_guard.test.js):
//   - อ่านอย่างเดียว: ไม่ mutate ctx.state, ไม่ POST/PATCH/DELETE/PUT, ไม่ fetch ออก network
//   - ไม่แตะ POS / stock / accounting / payroll / service workflow
//   - filter / drill-down ทำใน memory จาก ctx.state ที่โหลดมาแล้วเท่านั้น (ไม่ fetch เพิ่ม)
//   - drill-down = read-only: ไม่มีปุ่ม save / approve / submit จริง — มีแค่ ไปหน้าต้นทาง / คัดลอก prompt / ปิด
//   - prompt generator = สร้าง text draft ให้ copy เท่านั้น (ไม่ส่ง network / ไม่ save DB)
//   - field ที่ไม่มีจริง → "—" / "ยังไม่มีข้อมูล" (ห้าม hardcode 0 ให้เข้าใจผิด)
//   - integration = placeholder "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" (ไม่มี OAuth/token/connector จริง)

import { escHtml, money, formatDate } from "./utils.js";
import { parseAirJobMeta } from "./air_job_meta.js";

const NA = "ยังไม่มีข้อมูล";
let _filter = "all"; // in-memory view state (ไม่ persist ลง DB)

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function dateKeyBkk(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// คืน array ถ้า field มีจริงใน state, คืน null ถ้าไม่มี field นั้นเลย (เพื่อแยก "ว่าง" ออกจาก "ไม่มี")
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

// ── filter categories: items มาจาก ctx.state ในหน่วยความจำเท่านั้น ──────────────
const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "approve", label: "รออนุมัติ" },
  { key: "watch", label: "งานต้องดู" },
  { key: "air", label: "งานแอร์" },
  { key: "customers", label: "ลูกค้า" },
  { key: "products", label: "สินค้า" },
];

const ROW_CAP = 30; // กันรายการยาวเกิน — แสดงคำเตือนเมื่อ truncate (ไม่ silent)

// คืน {type, title, items|null} — items=null แปลว่า field ไม่มีจริงใน state (ยังไม่โหลด)
function categoryOf(state, key) {
  const quotations = field(state, "quotations");
  const serviceJobs = field(state, "serviceJobs");
  switch (key) {
    case "approve":   return { type: "quote",    title: "รออนุมัติใบเสนอราคา",        items: quotations ? pendingQuotes(quotations) : null };
    case "watch":     return { type: "job",      title: "งานที่ต้องดู (งานบริการที่ยังเปิด)", items: serviceJobs ? openJobs(serviceJobs) : null };
    case "air":       return { type: "job",      title: "งานแอร์จากแคตตาล็อก",         items: serviceJobs ? airJobs(serviceJobs) : null };
    case "customers": return { type: "customer", title: "ลูกค้า",                      items: field(state, "customers") };
    case "products":  return { type: "product",  title: "สินค้า / คลัง",               items: field(state, "products") };
    default:          return { type: "all", title: "ทั้งหมด", items: null };
  }
}

function findItem(state, type, id) {
  const key = { quote: "quotations", job: "serviceJobs", customer: "customers", product: "products" }[type];
  const arr = field(state, key) || [];
  return arr.find(x => String(x?.id) === String(id)) || null;
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
    .team-section-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:14px;font-weight:900;color:#e2e8f0}
    .team-section-title small{font-weight:700;font-size:11px;color:var(--tc-muted)}
    .team-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
    .team-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tc-line);background:linear-gradient(180deg,#0a2c44,#072133);border-radius:12px;padding:14px;text-align:left;cursor:pointer;font:inherit;color:inherit}
    .team-card:hover{border-color:rgba(56,189,248,.55)}
    .team-card-label{font-size:12.5px;font-weight:800;color:#cbd5e1}
    .team-card-num{font-size:30px;font-weight:900;line-height:1.05;color:#fff;word-break:break-word}
    .team-card-num.na{font-size:15px;font-weight:800;color:#94a3b8}
    .team-card-sub{font-size:11.5px;color:var(--tc-muted);line-height:1.35}
    .team-card-go{margin-top:auto;align-self:flex-start;font-size:12px;font-weight:800;color:#7dd3fc}
    .team-list{display:flex;flex-direction:column;gap:8px}
    .team-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--tc-line);background:#072133;border-radius:10px;padding:11px 13px;cursor:pointer;font:inherit;color:inherit;min-height:48px}
    .team-row:hover{border-color:rgba(56,189,248,.55);background:#082a40}
    .team-row .rmain{flex:1;min-width:0}
    .team-row .rt{font-weight:800;font-size:13px;color:#f1f5f9;word-break:break-word}
    .team-row .rs{font-size:11.5px;color:var(--tc-muted);word-break:break-word}
    .team-row .rtag{font-size:10px;font-weight:900;color:#7dd3fc;border:1px solid var(--tc-line);border-radius:999px;padding:3px 8px;white-space:nowrap}
    .team-row .chev{color:#7dd3fc;font-weight:900;flex:none}
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
    /* drill-down modal — z-index เหนือ bottom nav (40) / FAB เพื่อไม่ให้ถูกทับ */
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

// ── overview cards (filter = all): กดเพื่อ drill เข้าหมวด ────────────────────
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
    { label: "รออนุมัติใบเสนอราคา", num: pendingQ ? pendingQ.length : null, sub: "draft / ส่งแล้ว / รอดำเนินการ", go: "approve" },
    { label: "งานที่ต้องดู", num: openJobsArr ? openJobsArr.length : null, sub: "งานบริการที่ยังเปิดอยู่", go: "watch" },
    { label: "งานแอร์จากแคตตาล็อก", num: airArr ? airArr.length : null, sub: "งานบริการ source=air_catalog", go: "air" },
    { label: "ลูกค้า", num: customers ? customers.length : null, sub: "ลูกค้าในระบบที่โหลดแล้ว", go: "customers" },
    { label: "สินค้า / คลัง", num: products ? products.length : null, sub: "รายการสินค้าที่โหลดแล้ว", go: "products" },
    { label: "เอกสารล่าสุด", num: docsNum, sub: receiptsToday !== null ? `ใบเสร็จ/ใบเสนอราคา/ใบส่งของ · วันนี้ ${receiptsToday} ใบเสร็จ` : "ใบเสร็จ/ใบเสนอราคา/ใบส่งของ", nav: "receipts" },
  ];

  return `
    <div class="team-section-title">📋 งานที่ต้องจัดการ <small>กดการ์ดเพื่อดูรายการในหมวด — ไม่มีข้อมูลจะแสดง "${NA}"</small></div>
    <div class="team-cards">
      ${cards.map(c => {
        const act = c.go
          ? `<span class="team-card-go" >ดูรายการ →</span>`
          : `<span class="team-card-go">เปิดหน้า →</span>`;
        const attr = c.go ? `data-filter="${escHtml(c.go)}"` : `data-team-nav="${escHtml(c.nav)}"`;
        return `<button type="button" class="team-card" ${attr}>
          <span class="team-card-label">${escHtml(c.label)}</span>
          ${cardNumHtml(c.num)}
          <span class="team-card-sub">${escHtml(c.sub)}</span>
          ${act}
        </button>`;
      }).join("")}
    </div>
  `;
}

function rowHtml(item, type) {
  const id = escHtml(String(item?.id ?? "-"));
  if (type === "quote") {
    return `<button type="button" class="team-row" data-detail="quote:${id}">
      <span class="rmain"><span class="rt">#${id} · ${escHtml(item.customer_name || item.customer || "ไม่ระบุชื่อ")}</span>
      <span class="rs">สถานะ ${escHtml(item.status || "-")} · ${escHtml(money(quoteTotal(item)))} · ${escHtml(formatDate(item.created_at))}</span></span>
      <span class="chev">›</span></button>`;
  }
  if (type === "job") {
    const air = parseAirJobMeta(item);
    return `<button type="button" class="team-row" data-detail="job:${id}">
      <span class="rmain"><span class="rt">#${id} · ${escHtml(item.customer_name || "ไม่ระบุชื่อ")}</span>
      <span class="rs">สถานะ ${escHtml(item.status || "-")} · ${escHtml(formatDate(item.created_at))}</span></span>
      ${air?.isAir ? `<span class="rtag">🌬️ แอร์</span>` : ""}
      <span class="chev">›</span></button>`;
  }
  if (type === "customer") {
    return `<button type="button" class="team-row" data-detail="customer:${id}">
      <span class="rmain"><span class="rt">${escHtml(item.name || "ไม่ระบุชื่อ")}</span>
      <span class="rs">${escHtml(item.phone || "ไม่มีเบอร์")}${item.email ? " · " + escHtml(item.email) : ""}</span></span>
      <span class="chev">›</span></button>`;
  }
  // product
  return `<button type="button" class="team-row" data-detail="product:${id}">
    <span class="rmain"><span class="rt">${escHtml(item.name || "ไม่ระบุชื่อ")}</span>
    <span class="rs">${escHtml(money(Number(item.price || 0)))} · คงเหลือ ${escHtml(String(item.stock ?? "—"))}</span></span>
    <span class="chev">›</span></button>`;
}

function renderList(state, key) {
  const cat = categoryOf(state, key);
  if (cat.items === null) {
    return `<div class="team-section-title">${escHtml(cat.title)}</div>
      <div class="team-empty">ยังไม่มีข้อมูลในระบบ (ยังไม่ได้โหลด)</div>`;
  }
  if (cat.items.length === 0) {
    return `<div class="team-section-title">${escHtml(cat.title)} <small>0 รายการ</small></div>
      <div class="team-empty">ยังไม่มีรายการในหมวดนี้</div>`;
  }
  const shown = cat.items.slice(0, ROW_CAP);
  const truncated = cat.items.length > ROW_CAP;
  return `
    <div class="team-section-title">${escHtml(cat.title)} <small>${cat.items.length} รายการ · กดเพื่อดูรายละเอียด (read-only)</small></div>
    <div class="team-list">
      ${shown.map(it => rowHtml(it, cat.type)).join("")}
    </div>
    ${truncated ? `<div class="team-hint">แสดง ${ROW_CAP} จาก ${cat.items.length} รายการ — เปิดหน้าต้นทางเพื่อดูทั้งหมด</div>` : ""}
  `;
}

function kvRow(label, value) {
  const v = (value === null || value === undefined || value === "") ? "—" : value;
  return `<dt>${escHtml(label)}</dt><dd>${escHtml(String(v))}</dd>`;
}

// drill-down detail (read-only) — ไม่มีปุ่ม save/approve/submit
function detailHtml(item, type) {
  let title = "รายละเอียด";
  let rows = "";
  let route = "";
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

// owner prompt generator — สร้าง text draft ให้ copy เท่านั้น (ไม่ส่ง network / ไม่ save)
function buildPrompt(item, type) {
  if (type === "quote") {
    return `ตรวจใบเสนอราคา #${item.id ?? "-"} ของ ${item.customer_name || item.customer || "ลูกค้า"} (สถานะ ${item.status || "-"}, ยอด ${money(quoteTotal(item))}) ก่อนอนุมัติ แล้วสรุปประเด็นที่ต้องระวังให้หน่อย`;
  }
  if (type === "job") {
    const air = parseAirJobMeta(item);
    const base = `เช็คงานบริการ #${item.id ?? "-"} ของ ${item.customer_name || "ลูกค้า"} (สถานะ ${item.status || "-"}) ว่าข้อมูลครบหรือยัง`;
    return air?.isAir ? `${base} — เป็นงานแอร์จากแคตตาล็อก รุ่น/BTU ${air.btu || "-"} ราคาเสนอ ${air.price || "-"}` : base;
  }
  if (type === "customer") {
    return `สรุปประวัติ/ยอดซื้อและโอกาสติดตามของลูกค้า ${item.name || "-"} (${item.phone || "-"}) ให้หน่อย`;
  }
  return `ตรวจสต็อกและราคาสินค้า ${item.name || "-"} (คงเหลือ ${item.stock ?? "-"}, ราคา ${money(Number(item.price || 0))}) ว่าต้องสั่งเพิ่มไหม`;
}

export function renderTeamCommandCenter(ctx) {
  const container = document.getElementById("page-team_center");
  if (!container) return;
  injectTeamCenterStyles();

  const state = ctx?.state || {};
  _filter = "all"; // เริ่มที่ภาพรวมทุกครั้งที่เข้าหน้า

  container.innerHTML = `
    <div class="team-center">
      <div class="team-readonly-banner">🔒 โหมดอ่านอย่างเดียว (read-only) — แดชบอร์ดนี้แสดงภาพรวมจากข้อมูลที่ระบบโหลดมาแล้ว ไม่บันทึก/ไม่แก้ไขข้อมูลจริง</div>
      <div class="team-body">

        <div class="team-hero">
          <div>
            <div class="team-kicker">Owner Review</div>
            <h2>ศูนย์ทีม AI</h2>
            <p>มุมมองอ่านอย่างเดียวสำหรับเจ้าของร้าน — กรอง ดูรายละเอียด และคัดลอก prompt ส่งให้ทีมทำต่อ (ไม่เปลี่ยนข้อมูลจริง)</p>
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

  const renderView = () => {
    view.innerHTML = _filter === "all" ? renderOverview(state) : renderList(state, _filter);
  };
  const syncChips = () => {
    filterBar.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("active", b.dataset.filter === _filter));
  };
  const openModal = (token) => {
    const [type, id] = String(token || "").split(":");
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
    if (filterEl) { _filter = filterEl.dataset.filter; renderView(); syncChips(); return; }
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
