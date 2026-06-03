// ศูนย์ทีม AI (Team Command Center) — build team-center-readonly
//
// READ-ONLY BY DESIGN — locked invariants (see tests/team_center_readonly_guard.test.js):
//   - อ่านอย่างเดียว: ไม่ mutate ctx.state, ไม่ POST/PATCH/DELETE, ไม่ fetch ออก network
//   - ไม่แตะ POS / stock / accounting / service workflow
//   - ตัวเลขทุกตัวดึงจาก ctx.state ที่โหลดมาแล้วเท่านั้น
//   - ถ้า state ไม่มี field นั้นจริง → แสดง "—" / "ยังไม่มีข้อมูล" (ห้าม hardcode 0 ให้เข้าใจผิด)
//   - integration ที่ยังไม่ต่อจริง → ป้าย "ยังไม่เชื่อมต่อ" เสมอ
//   - team chat = draft ในหน้าจอเท่านั้น ไม่บันทึกลง DB
//   - ปุ่ม action = copy prompt / navigate เท่านั้น ไม่สั่งงานจริง

import { escHtml } from "./utils.js";

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

function countToday(rows, field) {
  const today = todayKey();
  return (rows || []).filter(row => dateKeyBkk(row?.[field]) === today).length;
}

function openJobs(serviceJobs) {
  return (serviceJobs || []).filter(j => !["done", "delivered", "closed", "cancelled"].includes(String(j?.status || "").toLowerCase()));
}

function pendingQuotes(quotations) {
  return (quotations || []).filter(q => ["draft", "sent", "pending"].includes(String(q?.status || "").toLowerCase()));
}

function injectTeamCenterStyles() {
  if (document.getElementById("teamCenterStyles")) return;
  const style = document.createElement("style");
  style.id = "teamCenterStyles";
  style.textContent = `
    .team-center{--tc-ink:#e8f4ff;--tc-muted:#9db9cb;--tc-line:rgba(125,211,252,.24);--tc-panel:#062236;--tc-green:#34d399;color:var(--tc-ink);background:#041422;border-radius:14px;overflow:hidden;border:1px solid rgba(56,189,248,.28);box-shadow:0 18px 42px rgba(2,8,23,.22)}
    .team-readonly-banner{display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,rgba(2,132,199,.32),rgba(6,78,59,.3));border-bottom:1px solid var(--tc-line);padding:9px 14px;font-size:12px;font-weight:800;color:#bae6fd}
    .team-shell{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:calc(100vh - 150px)}
    .team-main{padding:14px;background:linear-gradient(135deg,#06192a 0%,#082f49 54%,#051826 100%)}
    .team-side{border-left:1px solid var(--tc-line);background:#03111d;padding:12px;display:flex;flex-direction:column;gap:12px}
    .team-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-bottom:10px}
    .team-tab{display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--tc-line);background:linear-gradient(180deg,#0b3a58,#06304d);border-radius:8px;color:var(--tc-ink);font-weight:800;font-size:12px;min-height:44px}
    .team-tab small{display:block;color:#fca5a5;font-weight:800;font-size:10px;line-height:1.1}
    .team-hero{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:18px;border:1px solid var(--tc-line);border-radius:10px;background:linear-gradient(135deg,rgba(14,116,144,.45),rgba(2,6,23,.55))}
    .team-kicker{color:#7dd3fc;font-size:12px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}
    .team-hero h2{margin:4px 0 2px;font-size:28px;line-height:1.15;color:#f8fafc}
    .team-hero p{margin:0;color:#cbd5e1;font-size:13px}
    .team-owner{display:flex;align-items:center;gap:10px;border:1px solid rgba(52,211,153,.35);background:rgba(6,78,59,.55);border-radius:8px;padding:10px 12px;font-weight:900;white-space:nowrap}
    .team-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0}
    .team-stat{border:1px solid var(--tc-line);background:linear-gradient(180deg,#0b3a58,#06304d);border-radius:8px;padding:10px;min-height:66px}
    .team-stat strong{font-size:22px;display:block;color:#fff;line-height:1.1}
    .team-stat span{font-size:11px;color:#cbd5e1}
    .team-stat.muted strong{font-size:13px;color:#94a3b8}
    .team-map-wrap{border:1px solid var(--tc-line);border-radius:10px;padding:10px;background:#062236}
    .team-map-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 10px;font-weight:900}
    .team-map{position:relative;display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));grid-auto-rows:minmax(150px,1fr);gap:8px;min-height:470px;padding:10px;background:#06101f;border-radius:8px;border:1px solid rgba(148,163,184,.18);overflow:hidden}
    .team-room{position:relative;border:2px solid rgba(148,163,184,.35);border-radius:8px;background:linear-gradient(135deg,#203044,#5a4a39);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);padding:12px;overflow:hidden}
    .team-room:nth-child(2){background:linear-gradient(135deg,#314050,#7a6347)}
    .team-room:nth-child(3){background:linear-gradient(135deg,#1f3144,#334155)}
    .team-room:nth-child(4){background:linear-gradient(135deg,#26384b,#60513c)}
    .team-room:nth-child(5){background:linear-gradient(135deg,#4b3a2b,#7a5c3e)}
    .team-room:nth-child(6){background:linear-gradient(135deg,#364152,#655a42)}
    .team-room-title{position:absolute;top:8px;left:10px;background:rgba(2,6,23,.82);border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:4px 8px;font-weight:900;font-size:12px;color:#fff;z-index:2}
    .team-avatar{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);width:54px;height:62px;border-radius:18px 18px 12px 12px;background:linear-gradient(#f8fafc,#38bdf8);border:2px solid rgba(255,255,255,.75);box-shadow:0 14px 20px rgba(2,6,23,.3)}
    .team-avatar:before{content:"";position:absolute;left:12px;top:-18px;width:30px;height:30px;border-radius:50%;background:#f8c79a;border:2px solid rgba(2,6,23,.28)}
    .team-avatar.leo{background:linear-gradient(#111827,#ec4899)}.team-avatar.sam{background:linear-gradient(#f8fafc,#334155)}.team-avatar.ava{background:linear-gradient(#fff7ed,#d6d3d1)}.team-avatar.upload{background:linear-gradient(#fde68a,#0284c7)}
    .team-desk{position:absolute;left:12%;right:12%;bottom:18px;height:34px;border-radius:6px;background:#5b3c24;border:2px solid rgba(0,0,0,.28);box-shadow:0 8px 0 rgba(0,0,0,.16)}
    .team-bubble{position:absolute;right:10px;top:48px;background:rgba(3,105,161,.94);border:1px solid rgba(125,211,252,.65);border-radius:8px;padding:7px 9px;font-size:12px;font-weight:800;color:#ecfeff;max-width:150px;z-index:3}
    .team-side h3{margin:0;color:#f8fafc;font-size:18px}
    .team-agent-card{border:1px solid var(--tc-line);background:#062236;border-radius:8px;padding:12px}
    .team-agent-top{display:flex;gap:10px;align-items:center;margin-bottom:10px}
    .team-face{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#f97316,#0ea5e9);font-size:22px;border:2px solid rgba(255,255,255,.25)}
    .team-agent-name{font-weight:900}.team-agent-role{font-size:12px;color:var(--tc-muted)}
    .team-mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}.team-mini{border:1px solid rgba(125,211,252,.18);border-radius:6px;padding:7px;background:#031827}.team-mini b{display:block;font-size:12px}.team-mini span{font-size:10px;color:var(--tc-muted)}
    .team-pill-row{display:flex;flex-wrap:wrap;gap:6px}.team-pill{border-radius:999px;padding:4px 8px;background:#0b3a58;color:#dff7ff;font-weight:800;font-size:11px}
    .team-chat{flex:1;min-height:300px;display:flex;flex-direction:column;gap:8px;overflow:auto;padding-right:2px}
    .team-msg{max-width:92%;border-radius:8px;padding:10px 11px;font-size:13px;line-height:1.45;border:1px solid rgba(125,211,252,.2);background:#08344f;color:#e0f2fe}
    .team-msg.user{align-self:flex-end;background:#0b65a7}.team-msg.sam{background:#6d4c16;color:#fff7ed}.team-msg.leo{background:#075f5e}.team-msg small{display:block;margin-bottom:4px;font-weight:900;color:#bae6fd}
    .team-command{display:grid;grid-template-columns:1fr auto;gap:8px}.team-command input{min-width:0;background:#082236;border:1px solid var(--tc-line);border-radius:8px;color:#e0f2fe;padding:10px 11px}.team-command button,.team-quick button{border:1px solid rgba(125,211,252,.42);background:#075985;color:#f0f9ff;border-radius:8px;padding:9px 10px;font-weight:900;cursor:pointer}
    .team-quick{display:flex;flex-wrap:wrap;gap:6px}.team-quick button{font-size:12px;padding:7px 9px;background:#0b3a58}
    .team-quick button.nav{background:#065f46}
    .team-note{font-size:11px;color:#93c5fd}
    .team-link-btn{display:inline-block;margin-left:6px;border:1px solid rgba(125,211,252,.42);background:#0b3a58;color:#f0f9ff;border-radius:8px;padding:5px 9px;font-weight:800;font-size:11px;cursor:pointer}
    .team-map-head small{font-weight:700;font-size:11px;color:#fca5a5}
    @media (max-width:1100px){.team-shell{grid-template-columns:1fr}.team-side{border-left:0;border-top:1px solid var(--tc-line)}.team-map{grid-template-columns:repeat(2,minmax(160px,1fr))}}
    @media (max-width:640px){.team-main{padding:10px}.team-hero{display:block}.team-owner{margin-top:12px;display:inline-flex}.team-map{grid-template-columns:1fr;min-height:auto}.team-room{min-height:150px}.team-hero h2{font-size:24px}.team-shell{min-height:auto}}
  `;
  document.head.appendChild(style);
}

// agent rooms: task เป็นข้อมูลจริงถ้ามี field, ไม่งั้น "ยังไม่มีข้อมูล"
function buildAgentData(state) {
  const jobs = openJobs(field(state, "serviceJobs"));
  const quotes = field(state, "quotations");
  const sales = field(state, "sales");
  const jobsLabel = field(state, "serviceJobs") ? `สรุป ${jobs.length} งานช่างที่ยังเปิด` : NA;
  const quotesLabel = quotes ? `${pendingQuotes(quotes).length} ใบเสนอราคารออนุมัติ` : NA;
  const billLabel = sales ? `${countToday(sales, "created_at")} บิลวันนี้` : NA;
  return [
    { id: "benz", no: 1, name: "Benz", room: "ตัดสินใจขั้นสุดท้าย", task: "เจ้าของอนุมัติ (read-only)", className: "benz" },
    { id: "mina", no: 2, name: "Mina", room: "Mina Ops", task: jobsLabel, className: "mina" },
    { id: "leo", no: 3, name: "Leo", room: "Leo Meta Ads", task: "ยังไม่เชื่อมต่อ", className: "leo" },
    { id: "sam", no: 4, name: "Sam", room: "Sam Google", task: quotesLabel, className: "sam" },
    { id: "ava", no: 5, name: "Ava", room: "Ava Admin", task: "ยังไม่เชื่อมต่อ", className: "ava" },
    { id: "upload", no: 6, name: "Uploader", room: "Support", task: billLabel, className: "upload" },
  ];
}

function renderRoom(agent) {
  return `
    <div class="team-room" data-agent="${escHtml(agent.id)}">
      <div class="team-room-title">${agent.no}. ${escHtml(agent.room)}</div>
      <div class="team-bubble">${escHtml(agent.task)}</div>
      <div class="team-avatar ${escHtml(agent.className)}" aria-hidden="true"></div>
      <div class="team-desk"></div>
    </div>
  `;
}

// แท็บ integration: ยังไม่ต่อจริง — status ต้องชัดว่ายังไม่เชื่อมต่อ (ห้ามทำให้เข้าใจผิดว่าต่อแล้ว)
const INTEGRATIONS = [
  { icon: "💻", name: "Codex / Local", status: "read-only placeholder" },
  { icon: "📄", name: "Notion",        status: "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" },
  { icon: "📁", name: "Google Drive",  status: "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" },
  { icon: "✉️", name: "Gmail",          status: "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" },
  { icon: "📊", name: "Google Ads",    status: "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" },
  { icon: "🔵", name: "Meta Ads",      status: "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ" },
];

export function renderTeamCommandCenter(ctx) {
  const container = document.getElementById("page-team_center");
  if (!container) return;
  injectTeamCenterStyles();

  const state = ctx?.state || {};
  const agents = buildAgentData(state);

  const quotes = field(state, "quotations");
  const jobsField = field(state, "serviceJobs");
  const jobs = openJobs(jobsField);
  // tasks / auditLog ไม่มีจริงใน state → countOrDash จะคืน "—" ไม่ใช่ 0
  const tasks = field(state, "tasks");
  const auditLog = field(state, "auditLog") || field(state, "activityLog");

  const approvalCount = quotes ? String(pendingQuotes(quotes).length) : "—";
  // need attention = งานช่างเปิด + งานค้าง (เฉพาะ field ที่มีจริง)
  const attentionParts = [];
  if (jobsField) attentionParts.push(jobs.length);
  if (tasks) attentionParts.push(tasks.length);
  const attentionCount = attentionParts.length ? String(attentionParts.reduce((a, b) => a + b, 0)) : "—";

  container.innerHTML = `
    <div class="team-center">
      <div class="team-readonly-banner">🔒 โหมดอ่านอย่างเดียว (read-only) — หน้านี้ไม่บันทึก/แก้ไขข้อมูลจริง ตัวเลขดึงจากข้อมูลที่โหลดในเครื่องเท่านั้น</div>
      <div class="team-shell">
        <div class="team-main">
          <div class="team-tabs">
            ${INTEGRATIONS.map(i => `<div class="team-tab">${i.icon} ${escHtml(i.name)} <small>${escHtml(i.status)}</small></div>`).join("")}
          </div>
          <div class="team-note" style="margin:-4px 0 10px">
            ⚠️ ทุกช่องยังไม่เชื่อมต่อจริง — เป็น read-only placeholder รอ owner อนุมัติการเชื่อมต่อ
            <button type="button" class="team-link-btn" data-team-copy="ขอแนวทางเชื่อมต่อ integration (Notion/Gmail/Drive/Meta/Google Ads) แบบ read-only ผ่าน Cloudflare Functions + จัดการ OAuth/secret ใน env ให้ปลอดภัย">📋 คัดลอก prompt: ดูแนวทางเชื่อมต่อ</button>
          </div>

          <div class="team-hero">
            <div>
              <div class="team-kicker">Office Overview</div>
              <h2>ศูนย์ทีม AI</h2>
              <p>มุมมองอ่านอย่างเดียวสำหรับเจ้าของ — ดูคิวงานที่ต้องตัดสินใจ จากข้อมูลที่ระบบโหลดมาแล้ว</p>
            </div>
            <div class="team-owner">🔒 Read-only</div>
          </div>

          <div class="team-stats">
            <div class="team-stat"><strong>${escHtml(approvalCount)}</strong><span>ใบเสนอราคารออนุมัติ</span></div>
            <div class="team-stat"><strong>${escHtml(attentionCount)}</strong><span>งานที่ต้องดู</span></div>
            <div class="team-stat"><strong>${countOrDash(jobsField)}</strong><span>งานช่างทั้งหมด</span></div>
            <div class="team-stat"><strong>${countOrDash(field(state, "customers"))}</strong><span>ลูกค้า</span></div>
            <div class="team-stat"><strong>${countOrDash(field(state, "products"))}</strong><span>สินค้า</span></div>
            <div class="team-stat muted"><strong>${auditLog ? String(auditLog.length) : NA}</strong><span>Audit Events</span></div>
          </div>

          <div class="team-map-wrap">
            <div class="team-map-head">
              <span>ตัวอย่างบทบาททีม <small>(concept — ยังไม่ใช่ agent ที่ทำงานจริง)</small></span>
              <span>▦</span>
            </div>
            <div class="team-map">
              ${agents.map(renderRoom).join("")}
            </div>
          </div>
        </div>

        <aside class="team-side">
          <div>
            <h3>Team Chat</h3>
            <div style="color:#7dd3fc;font-weight:800;font-size:12px">#int-general</div>
          </div>

          <div class="team-agent-card">
            <div class="team-agent-top">
              <div class="team-face">👩</div>
              <div>
                <div class="team-agent-name">Mina · AI Secretary</div>
                <div class="team-agent-role">มุมมองสรุปงาน (ยังไม่เชื่อมต่อ Notion/Workspace จริง)</div>
              </div>
            </div>
            <div class="team-mini-grid">
              <div class="team-mini"><b>${escHtml(attentionCount)}</b><span>คิวงาน</span></div>
              <div class="team-mini"><b>${escHtml(approvalCount)}</b><span>รออนุมัติ</span></div>
              <div class="team-mini"><b>Read-only</b><span>โหมด</span></div>
            </div>
            <div class="team-pill-row">
              <span class="team-pill">Notion · ยังไม่ต่อ</span><span class="team-pill">Gmail · ยังไม่ต่อ</span><span class="team-pill">Drive · ยังไม่ต่อ</span>
            </div>
          </div>

          <div class="team-chat" id="teamChatLog">
            <div class="team-msg user"><small>You (Benz) · Draft</small>วันนี้มีอะไรที่ต้องอนุมัติบ้าง?</div>
            <div class="team-msg"><small>Mina · มุมมองอ่านอย่างเดียว</small>ตอนนี้มี ${escHtml(approvalCount)} ใบเสนอราคารออนุมัติ และ ${jobsField ? jobs.length + " งานช่างที่ยังเปิด" : NA} ค่ะ — ดูรายละเอียดได้ที่หน้าใบเสนอราคา/งานช่าง</div>
            <div class="team-msg leo"><small>Leo · Read-only</small>ฝั่ง Meta/Ads ยังไม่เชื่อมต่อจริงในเวอร์ชันนี้ครับ</div>
          </div>

          <div class="team-command">
            <input id="teamCommandInput" type="text" placeholder="พิมพ์คำสั่งทีม (draft เท่านั้น)..." aria-label="พิมพ์คำสั่งทีม" />
            <button id="teamSendBtn" type="button">เพิ่ม draft</button>
          </div>
          <div class="team-note">💬 ข้อความเป็น draft ในหน้าจอเท่านั้น ไม่ถูกบันทึก/ส่งไปที่ใด</div>
          <div class="team-quick">
            <button type="button" data-team-copy="@Mina ช่วยสรุปงานที่ต้องอนุมัติวันนี้">คัดลอก: ถาม Mina</button>
            <button type="button" data-team-copy="@Sam ช่วยตรวจใบเสนอราคาที่ค้าง">คัดลอก: ถาม Sam</button>
            <button type="button" class="nav" data-team-nav="quotations">→ ไปที่ใบเสนอราคา</button>
            <button type="button" class="nav" data-team-nav="service_jobs">→ ไปที่งานช่าง</button>
          </div>
        </aside>
      </div>
    </div>
  `;

  const input = container.querySelector("#teamCommandInput");
  const log = container.querySelector("#teamChatLog");

  // team chat: draft local เท่านั้น — append DOM, ไม่บันทึก, ไม่ส่ง network
  const addDraft = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    log.insertAdjacentHTML("beforeend", `<div class="team-msg user"><small>You (Benz) · Draft</small>${escHtml(clean)}</div>`);
    log.insertAdjacentHTML("beforeend", `<div class="team-msg"><small>Mina · มุมมองอ่านอย่างเดียว</small>บันทึกเป็น draft ในหน้าจอแล้วค่ะ — โหมดนี้ยังไม่ส่ง/ไม่เปลี่ยนข้อมูลจริง</div>`);
    log.scrollTop = log.scrollHeight;
    ctx?.showToast?.("เพิ่ม draft ในหน้าจอแล้ว (ไม่บันทึก)");
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
