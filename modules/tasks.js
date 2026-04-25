// ═══════════════════════════════════════════════════════════
//  TASK / REMINDER SYSTEM (Phase 13)
//  GTD สำหรับเจ้าของร้าน — โทรกลับลูกค้า, ติดตามค้างชำระ, ฯลฯ
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

let _tkList = [];
let _tkFilter = "today"; // today | week | overdue | done | all

const PRIORITY_META = {
  urgent: { label: "ด่วนมาก", color: "#dc2626", icon: "🔥" },
  high:   { label: "สูง",     color: "#f59e0b", icon: "⚡" },
  normal: { label: "ปกติ",   color: "#0284c7", icon: "📋" },
  low:    { label: "ต่ำ",    color: "#94a3b8", icon: "📝" }
};

const RELATED_LABELS = {
  customer: "ลูกค้า",
  product: "สินค้า",
  sale: "บิลขาย",
  service_job: "ใบงานช่าง",
  other: "อื่นๆ"
};

export async function renderTasksPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-tasks");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8">กำลังโหลด...</div>`;

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;

  try {
    const res = await fetch(cfg.url + "/rest/v1/tasks?select=*&order=done.asc,due_at.asc.nullslast,created_at.desc&limit=300", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) {
      container.innerHTML = `
        <div style="max-width:800px;margin:40px auto;padding:24px;background:#fee2e2;border-radius:12px;text-align:center">
          <h3 style="color:#b91c1c">⚠️ ตาราง tasks ยังไม่มี</h3>
          <p style="color:#991b1b">รัน <code>supabase-rls-policies.sql</code> ก่อน</p>
        </div>`;
      return;
    }
    _tkList = await res.json();
  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626;text-align:center;padding:30px">โหลดไม่สำเร็จ: ${e.message}</div>`;
    return;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekFromNow = new Date(); weekFromNow.setDate(weekFromNow.getDate()+7);

  // Filter
  let filtered = _tkList;
  if (_tkFilter === "today") filtered = _tkList.filter(t => !t.done && t.due_at && String(t.due_at).slice(0,10) === today);
  else if (_tkFilter === "week") filtered = _tkList.filter(t => !t.done && t.due_at && String(t.due_at).slice(0,10) <= weekFromNow.toISOString().slice(0,10));
  else if (_tkFilter === "overdue") filtered = _tkList.filter(t => !t.done && t.due_at && new Date(t.due_at) < now);
  else if (_tkFilter === "done") filtered = _tkList.filter(t => t.done);
  // all = ทั้งหมด

  // Stats
  const totalOpen = _tkList.filter(t => !t.done).length;
  const overdueCount = _tkList.filter(t => !t.done && t.due_at && new Date(t.due_at) < now).length;
  const todayCount = _tkList.filter(t => !t.done && t.due_at && String(t.due_at).slice(0,10) === today).length;
  const doneToday = _tkList.filter(t => t.done && t.done_at && String(t.done_at).slice(0,10) === today).length;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#dcfce7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">⏰</div>
        <h2 style="margin:0 0 4px;color:#1e40af">Task / สิ่งที่ต้องทำ</h2>
        <p style="margin:0;color:#065f46;font-size:13px">จดงานที่ต้องทำ • เตือนตามเวลา • เชื่อมโยงกับลูกค้า/สินค้า/งานช่าง</p>
      </div>

      <!-- Stats -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #dc2626">
          <div class="stat-label">⚠️ เกินกำหนด</div>
          <div class="stat-value" style="color:#dc2626">${overdueCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">📅 วันนี้</div>
          <div class="stat-value" style="color:#92400e">${todayCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📋 ค้างทั้งหมด</div>
          <div class="stat-value" style="color:#0284c7">${totalOpen}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">✓ ทำเสร็จวันนี้</div>
          <div class="stat-value" style="color:#059669">${doneToday}</div>
        </div>
      </div>

      <!-- Filter + Add -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${[["today","📅 วันนี้",todayCount],["overdue","⚠️ เกินกำหนด",overdueCount],["week","🗓️ 7 วันถัดไป",0],["done","✓ ทำเสร็จ",0],["all","ทั้งหมด",_tkList.length]].map(([k,l,n]) => `
          <button class="tk-filter-btn" data-f="${k}" style="padding:6px 14px;border-radius:18px;border:1px solid ${_tkFilter===k?'#0284c7':'#cbd5e1'};background:${_tkFilter===k?'#0284c7':'#fff'};color:${_tkFilter===k?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${l}${n>0&&k!=="done"&&k!=="all"&&k!=="week" ? ` (${n})` : ""}</button>
        `).join("")}
        <button id="tkAddBtn" class="btn primary" style="margin-left:auto;font-size:13px">+ Task ใหม่</button>
      </div>

      <!-- List -->
      <div class="panel" style="padding:0">
        ${filtered.length === 0 ? `
          <div style="text-align:center;padding:40px;color:#94a3b8">
            <div style="font-size:40px;margin-bottom:8px">${_tkFilter==='done'?'✅':'🎉'}</div>
            <div style="font-weight:600;font-size:14px">${_tkFilter==='done' ? 'ยังไม่มีงานที่ทำเสร็จ' : 'ไม่มีงานในกลุ่มนี้ — สบายใจ!'}</div>
          </div>
        ` : `
        <div style="display:flex;flex-direction:column">
          ${filtered.map(t => {
            const p = PRIORITY_META[t.priority || "normal"];
            const isOverdue = !t.done && t.due_at && new Date(t.due_at) < now;
            const dueDate = t.due_at ? new Date(t.due_at) : null;
            const dueStr = dueDate ? dueDate.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "ไม่กำหนด";
            return `
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e5e7eb;background:${t.done?'#f8fafc':isOverdue?'#fef9c3':'#fff'};opacity:${t.done?0.6:1}">
                <input type="checkbox" class="tk-toggle" data-id="${t.id}" ${t.done?'checked':''} style="width:22px;height:22px;cursor:pointer;flex-shrink:0" />
                <div style="width:6px;height:32px;background:${p.color};border-radius:3px;flex-shrink:0"></div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:700;color:${t.done?'#94a3b8':'#0f172a'};text-decoration:${t.done?'line-through':'none'}">
                    ${p.icon} ${escHtml(t.title)}
                    ${t.related_to_type ? `<span style="background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:600;margin-left:4px">${RELATED_LABELS[t.related_to_type] || t.related_to_type}</span>` : ''}
                  </div>
                  ${t.description ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${escHtml(t.description)}</div>` : ''}
                  <div style="font-size:11px;color:${isOverdue?'#dc2626;font-weight:700':'#94a3b8'};margin-top:2px">
                    📅 ${dueStr}${isOverdue?' ⚠️ เกินกำหนด':''}
                  </div>
                </div>
                <div style="display:flex;gap:4px">
                  <button class="tk-edit-btn" data-id="${t.id}" style="border:1px solid #cbd5e1;background:#fff;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:12px">✏️</button>
                  <button class="tk-del-btn" data-id="${t.id}" style="border:1px solid #fca5a5;background:#fff;color:#dc2626;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:12px">🗑️</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
        `}
      </div>
    </div>
  `;

  container.querySelectorAll(".tk-filter-btn").forEach(btn => btn.addEventListener("click", () => {
    _tkFilter = btn.dataset.f;
    renderTasksPage(ctx);
  }));
  container.querySelector("#tkAddBtn")?.addEventListener("click", () => openTaskModal(ctx, null));
  container.querySelectorAll(".tk-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const t = _tkList.find(x => String(x.id) === String(btn.dataset.id));
    if (t) openTaskModal(ctx, t);
  }));
  container.querySelectorAll(".tk-del-btn").forEach(btn => btn.addEventListener("click", () => deleteTask(ctx, btn.dataset.id)));
  container.querySelectorAll(".tk-toggle").forEach(cb => cb.addEventListener("change", () => toggleTask(ctx, cb.dataset.id, cb.checked)));
}

function openTaskModal(ctx, t) {
  document.getElementById("tkModal")?.remove();
  const isEdit = !!t;

  // default due = 1 hour from now
  const def = new Date(); def.setHours(def.getHours() + 1, 0, 0, 0);
  const defStr = new Date(def.getTime() - def.getTimezoneOffset()*60000).toISOString().slice(0,16);

  const modal = document.createElement("div");
  modal.id = "tkModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:20px;max-height:90vh;overflow-y:auto">
      <h3 style="margin:0 0 14px">${isEdit?'✏️ แก้ไข':'+ Task ใหม่'}</h3>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:700">หัวข้อ:</label>
          <input id="tkTitle" type="text" value="${escHtml(t?.title || '')}" placeholder="เช่น โทรกลับลูกค้านาย ก, ตามเก็บเงิน บิล X" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">รายละเอียด (option):</label>
          <textarea id="tkDesc" rows="3" placeholder="ข้อมูลเพิ่มเติม" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-family:inherit;resize:vertical">${escHtml(t?.description || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:700">ครบกำหนด:</label>
            <input id="tkDue" type="datetime-local" value="${t?.due_at ? new Date(new Date(t.due_at).getTime() - new Date(t.due_at).getTimezoneOffset()*60000).toISOString().slice(0,16) : defStr}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:700">ความสำคัญ:</label>
            <select id="tkPriority" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${Object.entries(PRIORITY_META).map(([k,v]) => `<option value="${k}" ${(t?.priority||'normal')===k?'selected':''}>${v.icon} ${v.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">เชื่อมโยงกับ (option):</label>
          <select id="tkRelType" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="">— ไม่เชื่อมโยง —</option>
            ${Object.entries(RELATED_LABELS).map(([k,v]) => `<option value="${k}" ${t?.related_to_type===k?'selected':''}>${v}</option>`).join("")}
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input id="tkLineNotify" type="checkbox" ${t?.line_notify_sent ? '' : 'checked'} style="width:18px;height:18px;cursor:pointer" />
          <span>📲 ส่ง LINE Notify เมื่อใกล้ครบกำหนด</span>
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="tkCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="tkSave" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">${isEdit?'บันทึก':'+ เพิ่ม'}</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector("#tkTitle")?.focus(), 50);

  modal.querySelector("#tkCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#tkSave").addEventListener("click", async () => {
    const payload = {
      title: modal.querySelector("#tkTitle").value.trim(),
      description: modal.querySelector("#tkDesc").value.trim() || null,
      due_at: modal.querySelector("#tkDue").value ? new Date(modal.querySelector("#tkDue").value).toISOString() : null,
      priority: modal.querySelector("#tkPriority").value,
      related_to_type: modal.querySelector("#tkRelType").value || null,
      line_notify_sent: !modal.querySelector("#tkLineNotify").checked
    };
    if (!payload.title) { alert("กรอกหัวข้อ"); return; }

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const url = cfg.url + "/rest/v1/tasks" + (t ? "?id=eq."+t.id : "");
    try {
      const r = await fetch(url, {
        method: t ? "PATCH" : "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      modal.remove();
      ctx.showToast?.(t ? "✓ บันทึกแก้ไข" : "✓ เพิ่ม task แล้ว");
      renderTasksPage(ctx);
    } catch (e) {
      alert("ผิดพลาด: " + (e?.message || e));
    }
  });
}

async function toggleTask(ctx, id, done) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const patch = { done, done_at: done ? new Date().toISOString() : null };
  await fetch(cfg.url + "/rest/v1/tasks?id=eq." + id, {
    method: "PATCH",
    headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
    body: JSON.stringify(patch)
  });
  ctx.showToast?.(done ? "✓ ทำเสร็จแล้ว!" : "↩️ Mark as undone");
  renderTasksPage(ctx);
}

async function deleteTask(ctx, id) {
  const t = _tkList.find(x => String(x.id) === String(id));
  if (!t) return;
  if (!confirm(`ลบ task "${t.title}"?`)) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/tasks?id=eq." + id, {
    method: "DELETE",
    headers: { "apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" }
  });
  ctx.showToast?.("ลบแล้ว");
  renderTasksPage(ctx);
}

// ★ Background notify checker — เรียกตอน app load
export async function checkOverdueTasksAndNotify(state) {
  if (!state?.lineNotifySettings?.is_active) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const now = new Date();
  try {
    const res = await fetch(cfg.url + "/rest/v1/tasks?select=*&done=eq.false&line_notify_sent=eq.false&due_at=lte." + now.toISOString(), {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken }
    });
    if (!res.ok) return;
    const due = await res.json();
    if (due.length === 0) return;

    // ส่ง Line รวมเป็นข้อความเดียว
    const lines = [`⏰ มี Task ครบกำหนด ${due.length} รายการ:`];
    due.forEach(t => {
      const p = PRIORITY_META[t.priority || "normal"];
      lines.push(`${p.icon} ${t.title}`);
    });
    const msg = lines.join("\n");
    const { sendLineNotify } = await import("./line_notify.js");
    await sendLineNotify(msg, { state, showToast: () => {} }, "default");

    // mark notified
    for (const t of due) {
      await fetch(cfg.url + "/rest/v1/tasks?id=eq." + t.id, {
        method: "PATCH",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify({ line_notify_sent: true })
      });
    }
  } catch(e) { console.warn("[checkOverdueTasks]", e); }
}
