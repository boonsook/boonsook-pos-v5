// ศูนย์ทีม AI (Team Command Center) — build team-center-ui-polish-readonly (358)
//
// READ-ONLY OWNER DASHBOARD — locked invariants (see tests/team_center_readonly_guard.test.js):
//   - อ่านอย่างเดียว: ไม่ mutate ctx.state, ไม่ POST/PATCH/DELETE, ไม่ fetch ออก network
//   - ไม่แตะ POS / stock / accounting / service workflow
//   - ตัวเลขทุกตัวดึงจาก ctx.state ที่โหลดมาแล้วเท่านั้น
//   - ถ้า state ไม่มี field นั้นจริง → แสดง "—" / "ยังไม่มีข้อมูล" (ห้าม hardcode 0 ให้เข้าใจผิด)
//   - integration ที่ยังไม่ต่อจริง → ป้าย "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" เสมอ (placeholder, ไม่มี OAuth/token/connector จริง)
//   - draft/note = บันทึกในหน้านี้เท่านั้น ไม่บันทึกลง DB / ไม่ส่งหา AI agent จริง
//   - ปุ่ม action = copy prompt / navigate เท่านั้น ไม่สั่งงานจริง

import { escHtml } from "./utils.js";
import { parseAirJobMeta } from "./air_job_meta.js";

const NA = "ยังไม่มีข้อมูล";

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

// แสดงจำนวน: array จริง (รวมว่าง=0) → ตัวเลข; ไม่มี field → "—"
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

function injectTeamCenterStyles() {
  if (document.getElementById("teamCenterStyles")) return;
  const style = document.createElement("style");
  style.id = "teamCenterStyles";
  style.textContent = `
    .team-center{--tc-ink:#e8f4ff;--tc-muted:#9db9cb;--tc-line:rgba(125,211,252,.22);--tc-panel:#072a40;--tc-accent:#38bdf8;color:var(--tc-ink);background:#04141f;border-radius:14px;overflow:hidden;border:1px solid rgba(56,189,248,.24);box-shadow:0 12px 30px rgba(2,8,23,.2);max-width:100%}
    .team-center *{box-sizing:border-box;min-width:0}
    .team-readonly-banner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:linear-gradient(135deg,rgba(2,132,199,.3),rgba(6,78,59,.28));border-bottom:1px solid var(--tc-line);padding:10px 16px;font-size:12.5px;font-weight:800;color:#bae6fd}
    .team-body{padding:16px;display:flex;flex-direction:column;gap:18px}
    .team-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
    .team-hero h2{margin:2px 0 4px;font-size:24px;line-height:1.2;color:#f8fafc}
    .team-hero p{margin:0;color:#cbd5e1;font-size:13px;max-width:60ch}
    .team-kicker{color:#7dd3fc;font-size:11px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
    .team-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(52,211,153,.4);background:rgba(6,78,59,.5);border-radius:999px;padding:7px 13px;font-weight:800;font-size:12.5px;white-space:nowrap;color:#a7f3d0}
    .team-section-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:14px;font-weight:900;color:#e2e8f0}
    .team-section-title small{font-weight:700;font-size:11px;color:var(--tc-muted)}
    .team-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
    .team-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tc-line);background:linear-gradient(180deg,#0a2c44,#072133);border-radius:12px;padding:14px}
    .team-card-label{font-size:12.5px;font-weight:800;color:#cbd5e1}
    .team-card-num{font-size:30px;font-weight:900;line-height:1.05;color:#fff;word-break:break-word}
    .team-card-num.na{font-size:15px;font-weight:800;color:#94a3b8}
    .team-card-sub{font-size:11.5px;color:var(--tc-muted);line-height:1.35}
    .team-card-act{margin-top:auto;align-self:flex-start;border:1px solid rgba(125,211,252,.4);background:#0b4a6e;color:#f0f9ff;border-radius:8px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer;min-height:36px}
    .team-card-act:hover{background:#0d5683}
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
    @media (max-width:640px){
      .team-body{padding:12px;gap:14px}
      .team-hero h2{font-size:20px}
      .team-cards{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
      .team-card-num{font-size:26px}
    }
  `;
  document.head.appendChild(style);
}

// บทบาททีม AI = concept (ตัวอย่าง) — ไม่ใช่ agent ที่ทำงานจริง
const TEAM_ROLES = [
  { ic: "👩‍💼", name: "Mina", role: "เลขาฯ / สรุปงาน" },
  { ic: "📈", name: "Leo", role: "Meta / โฆษณา" },
  { ic: "🗂️", name: "Sam", role: "Google Workspace / เอกสาร" },
  { ic: "🧾", name: "Ava", role: "แอดมิน / HR" },
];

// integration ยังไม่ต่อจริง — placeholder เท่านั้น
const INTEGRATIONS = [
  { icon: "📄", name: "Notion" },
  { icon: "✉️", name: "Gmail" },
  { icon: "📁", name: "Google Drive" },
  { icon: "📊", name: "Google Ads" },
  { icon: "🔵", name: "Meta Ads" },
  { icon: "💻", name: "Codex / Local" },
];

const CONNECT_PROMPT = "ขอแนวทางเชื่อมต่อ integration (Notion/Gmail/Drive/Meta/Google Ads) แบบ read-only ผ่าน Cloudflare Functions + จัดการ OAuth/secret ใน env ให้ปลอดภัย โดยไม่ให้ service key หลุดฝั่ง client";

// num = number | null (null = field ไม่มีจริง → "ยังไม่มีข้อมูล")
function cardNumHtml(num) {
  if (num === null || num === undefined) return `<div class="team-card-num na">${NA}</div>`;
  return `<div class="team-card-num">${escHtml(String(num))}</div>`;
}

function renderCard(card) {
  return `
    <div class="team-card">
      <div class="team-card-label">${escHtml(card.label)}</div>
      ${cardNumHtml(card.num)}
      <div class="team-card-sub">${escHtml(card.sub)}</div>
      <button type="button" class="team-card-act" data-team-nav="${escHtml(card.route)}">${escHtml(card.actLabel)} →</button>
    </div>
  `;
}

export function renderTeamCommandCenter(ctx) {
  const container = document.getElementById("page-team_center");
  if (!container) return;
  injectTeamCenterStyles();

  const state = ctx?.state || {};

  const quotes = field(state, "quotations");
  const jobsField = field(state, "serviceJobs");
  const customers = field(state, "customers");
  const products = field(state, "products");
  const receipts = field(state, "receipts");
  const deliveryInvoices = field(state, "deliveryInvoices");
  const tasks = field(state, "tasks");

  const openJobsArr = jobsField ? openJobs(jobsField) : null;
  const airArr = jobsField ? airJobs(jobsField) : null;
  const pendingQ = quotes ? pendingQuotes(quotes) : null;

  // "งานที่ต้องดู" = ใบเสนอราคารออนุมัติ + งานช่างเปิด (เฉพาะ field ที่มีจริง)
  const attentionParts = [];
  if (pendingQ) attentionParts.push(pendingQ.length);
  if (openJobsArr) attentionParts.push(openJobsArr.length);
  if (tasks) attentionParts.push(tasks.length);
  const attentionNum = attentionParts.length ? attentionParts.reduce((a, b) => a + b, 0) : null;

  // เอกสารล่าสุด: รวมเฉพาะ field ที่มีจริง
  const docFields = [receipts, quotes, deliveryInvoices].filter(Array.isArray);
  const docsNum = docFields.length ? docFields.reduce((a, b) => a + b.length, 0) : null;
  const receiptsToday = receipts ? countToday(receipts, "created_at") : null;

  const cards = [
    { label: "รออนุมัติใบเสนอราคา", num: pendingQ ? pendingQ.length : null, sub: "ใบเสนอราคาสถานะ draft / ส่งแล้ว / รอดำเนินการ", route: "quotations", actLabel: "ดูใบเสนอราคา" },
    { label: "งานที่ต้องดู", num: attentionNum, sub: "ใบเสนอราคารออนุมัติ + งานบริการที่ยังเปิด", route: "service_jobs", actLabel: "ดูงานบริการ" },
    { label: "งานบริการ / แจ้งซ่อม", num: openJobsArr ? openJobsArr.length : null, sub: "งานช่างที่ยังไม่ปิด (ไม่รวมเสร็จ/ยกเลิก)", route: "service_jobs", actLabel: "ดูงานบริการ" },
    { label: "งานแอร์จากแคตตาล็อก", num: airArr ? airArr.length : null, sub: "งานบริการที่มาจากแคตตาล็อกแอร์ (source=air_catalog)", route: "service_jobs", actLabel: "ดูงานแอร์" },
    { label: "ลูกค้า", num: customers ? customers.length : null, sub: "ลูกค้าในระบบที่โหลดมาแล้ว", route: "customers", actLabel: "ดูลูกค้า" },
    { label: "สินค้า / คลัง", num: products ? products.length : null, sub: "รายการสินค้าในระบบที่โหลดมาแล้ว", route: "products", actLabel: "ดูสินค้า" },
    { label: "เอกสารล่าสุด", num: docsNum, sub: receiptsToday !== null ? `ใบเสร็จ/ใบเสนอราคา/ใบส่งของ · วันนี้ ${receiptsToday} ใบเสร็จ` : "ใบเสร็จ/ใบเสนอราคา/ใบส่งของ", route: "receipts", actLabel: "ดูใบเสร็จ" },
  ];

  container.innerHTML = `
    <div class="team-center">
      <div class="team-readonly-banner">🔒 โหมดอ่านอย่างเดียว (read-only) — แดชบอร์ดนี้แสดงภาพรวมจากข้อมูลที่ระบบโหลดมาแล้ว ไม่บันทึก/ไม่แก้ไขข้อมูลจริง</div>
      <div class="team-body">

        <div class="team-hero">
          <div>
            <div class="team-kicker">Owner Overview</div>
            <h2>ศูนย์ทีม AI</h2>
            <p>ภาพรวมงานที่ต้องตัดสินใจสำหรับเจ้าของร้าน — กดการ์ดเพื่อไปยังหน้างานจริงที่เกี่ยวข้อง</p>
          </div>
          <div class="team-badge">🔒 Read-only</div>
        </div>

        <section>
          <div class="team-section-title">📋 งานที่ต้องจัดการ <small>ตัวเลขจากข้อมูลที่โหลดจริง — ไม่มีข้อมูลจะแสดง "${NA}"</small></div>
          <div class="team-cards">
            ${cards.map(renderCard).join("")}
          </div>
        </section>

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
          <div class="team-section-title">📝 บันทึกย่อ / Draft <small>บันทึก draft ในหน้านี้เท่านั้น — ไม่ส่งหา AI/ระบบใด และไม่บันทึกลงฐานข้อมูล</small></div>
          <div class="team-notes">
            <div class="team-notes-log" id="teamChatLog">
              <div class="team-note-item"><small>ตัวอย่าง</small>พิมพ์สิ่งที่อยากเตือนตัวเอง เช่น "ตามใบเสนอราคาลูกค้า A" แล้วกดเพิ่ม draft — ข้อความจะอยู่เฉพาะหน้านี้</div>
            </div>
            <div class="team-command">
              <input id="teamCommandInput" type="text" placeholder="พิมพ์บันทึกย่อ (draft เท่านั้น)..." aria-label="พิมพ์บันทึกย่อ draft" />
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
    </div>
  `;

  const input = container.querySelector("#teamCommandInput");
  const log = container.querySelector("#teamChatLog");

  // draft local เท่านั้น — append DOM, ไม่บันทึก, ไม่ส่ง network, ไม่ mutate state
  const addDraft = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    log.insertAdjacentHTML("beforeend", `<div class="team-note-item"><small>Draft · ในหน้านี้เท่านั้น</small>${escHtml(clean)}</div>`);
    log.scrollTop = log.scrollHeight;
    ctx?.showToast?.("เพิ่ม draft ในหน้านี้แล้ว (ไม่บันทึก)");
    if (input) input.value = "";
  };

  container.querySelector("#teamSendBtn")?.addEventListener("click", () => addDraft(input?.value));
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDraft(input.value);
  });

  // ปุ่ม copy: คัดลอก prompt ลง clipboard เท่านั้น
  container.querySelectorAll("[data-team-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.teamCopy || "";
      try {
        await navigator.clipboard.writeText(text);
        ctx?.showToast?.("คัดลอกข้อความแล้ว");
      } catch {
        ctx?.showToast?.("คัดลอกไม่สำเร็จ — คัดลอกด้วยมือได้");
      }
    });
  });

  // ปุ่ม nav: ไปหน้าจริงเท่านั้น (read-only navigation)
  container.querySelectorAll("[data-team-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const route = btn.dataset.teamNav;
      if (route) ctx?.showRoute?.(route);
    });
  });
}
