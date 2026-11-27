// ═══════════════════════════════════════════════════════════
//  กล่องแชทลูกค้า (Phase 648 เฟส A) — อ่านแชท LINE ที่ลูกค้าทักเข้ามา
//  admin + sales เท่านั้น (RLS customer_chat_is_inbox_staff คือด่านจริง; ตรงนี้เป็น UX)
//  เฟสนี้ "อ่านอย่างเดียว": ไม่ส่งข้อความหาลูกค้า ไม่เรียก LINE API ไม่แตะเงิน/สต็อก/บัญชี.
//  การเขียนที่ทำได้มีแค่ RPC customer_chat_set_thread_state (อ่านแล้ว / เสร็จ / เปิดใหม่).
//  ทุกค่าจาก DB ผ่าน escHtml ก่อนเข้า innerHTML (ชื่อ/ข้อความลูกค้า = untrusted).
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

const PAGE_ID = "page-customer_chat";
const POLL_MS = 30000;
const THREAD_COLS = "id,display_name,status,unread_count,last_message_at,last_message_preview";
const MESSAGE_COLS = "id,direction,message_type,body,sent_at";

let _threads = [];
let _filter = "pending"; // pending | all
let _activeId = null;
let _pollTimer = null;
let _ctx = null;

function _cfg() {
  const cfg = window.SUPABASE_CONFIG || {};
  return { url: cfg.url, anonKey: cfg.anonKey, token: window._sbAccessToken || cfg.anonKey };
}

async function _rest(path, opts = {}) {
  const { url, anonKey, token } = _cfg();
  const res = await fetch(url + path, {
    ...opts,
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function formatChatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { timeZone: "Asia/Bangkok" };
  const day = d.toLocaleDateString("en-CA", opts);
  const today = new Date().toLocaleDateString("en-CA", opts);
  const time = d.toLocaleTimeString("th-TH", { ...opts, hour: "2-digit", minute: "2-digit" });
  if (day === today) return time;
  return d.toLocaleDateString("th-TH", { ...opts, day: "numeric", month: "short" }) + " " + time;
}

export function filterThreads(threads, filter) {
  const list = Array.isArray(threads) ? threads : [];
  if (filter !== "pending") return list;
  return list.filter((t) => t && (Number(t.unread_count) > 0 || t.status === "open"));
}

function _displayName(t) {
  return (t && typeof t.display_name === "string" && t.display_name.trim()) ? t.display_name.trim() : "ลูกค้า LINE";
}

export function renderThreadItem(t, activeId) {
  const name = _displayName(t);
  const unread = Number(t.unread_count) || 0;
  const initial = Array.from(name)[0] || "?";
  const active = String(t.id) === String(activeId) ? " cc-active" : "";
  const done = t.status === "done" ? `<span class="cc-done-tag">เสร็จแล้ว</span>` : "";
  return `
    <button type="button" class="cc-thread${active}" data-thread-id="${escHtml(t.id)}">
      <span class="cc-avatar">${escHtml(initial)}</span>
      <span class="cc-thread-main">
        <span class="cc-thread-top">
          <span class="cc-thread-name">${escHtml(name)}</span>
          <span class="cc-thread-time">${escHtml(formatChatTime(t.last_message_at))}</span>
        </span>
        <span class="cc-thread-bottom">
          <span class="cc-thread-preview">${escHtml(t.last_message_preview || "")}</span>
          ${done}
          ${unread > 0 ? `<span class="cc-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
        </span>
      </span>
    </button>`;
}

export function renderMessageBubble(m) {
  const mine = m.direction === "out";
  return `
    <div class="cc-msg ${mine ? "cc-msg-out" : "cc-msg-in"}">
      <div class="cc-bubble">${escHtml(m.body || "")}</div>
      <div class="cc-msg-time">${escHtml(formatChatTime(m.sent_at))}</div>
    </div>`;
}

const STYLE = `
<style>
  .cc-wrap{display:flex;flex-direction:column;gap:12px;min-width:0;width:100%}  /* .page = grid: min-width:0 กัน nowrap ดันคอลัมน์ล้นจอมือถือ */
  .cc-note{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px 14px;color:var(--muted);font-size:13px;line-height:1.5}
  .cc-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .cc-tab{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:6px 14px;font-size:14px;cursor:pointer}
  .cc-tab.cc-on{background:var(--primary);border-color:var(--primary);color:#fff}
  .cc-toolbar .cc-spacer{flex:1}
  .cc-layout{display:flex;flex-direction:column;gap:12px}
  .cc-list,.cc-detail{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;min-width:0}
  .cc-thread{display:flex;gap:10px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);padding:12px;cursor:pointer;color:var(--text)}
  .cc-thread:hover,.cc-thread.cc-active{background:rgba(14,165,233,.08)}
  .cc-avatar{flex:0 0 40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
  .cc-thread-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
  .cc-thread-top,.cc-thread-bottom{display:flex;gap:8px;align-items:center;min-width:0}
  .cc-thread-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cc-thread-time{color:var(--muted);font-size:12px;white-space:nowrap}
  .cc-thread-preview{color:var(--muted);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cc-badge{background:var(--danger);color:#fff;border-radius:999px;font-size:12px;padding:1px 8px;white-space:nowrap}
  .cc-done-tag{color:var(--success);font-size:12px;white-space:nowrap}
  .cc-detail-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;border-bottom:1px solid var(--line)}
  .cc-detail-head .cc-detail-name{font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cc-messages{display:flex;flex-direction:column;gap:8px;padding:12px;max-height:60vh;overflow-y:auto}
  .cc-msg{display:flex;flex-direction:column;max-width:85%}
  .cc-msg-in{align-self:flex-start}
  .cc-msg-out{align-self:flex-end;align-items:flex-end}
  .cc-bubble{padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
  .cc-msg-in .cc-bubble{background:var(--bg);color:var(--text)}
  .cc-msg-out .cc-bubble{background:var(--primary);color:#fff}
  .cc-msg-time{color:var(--muted);font-size:11px;margin-top:2px}
  .cc-placeholder{padding:28px 16px;color:var(--muted);text-align:center}
  @media (min-width:900px){
    .cc-layout{flex-direction:row;align-items:flex-start}
    .cc-list{flex:0 0 340px;max-height:72vh;overflow-y:auto}
    .cc-detail{flex:1}
  }
</style>`;

function _container() { return document.getElementById(PAGE_ID); }

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _startPolling() {
  _stopPolling();
  _pollTimer = setInterval(() => {
    const c = _container();
    // ออกจากหน้านี้แล้ว (section ถูกซ่อน) → หยุด poll เอง
    if (!c || c.classList.contains("hidden") || document.hidden) {
      if (!c || c.classList.contains("hidden")) _stopPolling();
      return;
    }
    _loadThreads({ quiet: true });
  }, POLL_MS);
}

function _renderShell() {
  const c = _container();
  if (!c) return;
  c.innerHTML = `${STYLE}
    <div class="cc-wrap">
      <div class="cc-note">💬 แชทจากลูกค้าที่ทักเข้า LINE OA ของร้าน · เฟสนี้ดูได้อย่างเดียว ตอบลูกค้าในแอป LINE OA ตามเดิม (AI ร่างคำตอบจะมาในเฟสถัดไป)</div>
      <div class="cc-toolbar">
        <button type="button" class="cc-tab" data-cc-filter="pending">ค้างตอบ</button>
        <button type="button" class="cc-tab" data-cc-filter="all">ทั้งหมด</button>
        <span class="cc-spacer"></span>
        <button type="button" class="btn light" id="ccRefreshBtn">🔄 รีเฟรช</button>
      </div>
      <div class="cc-layout">
        <div class="cc-list" id="ccThreadList">${renderSkeleton({ type: "list", count: 5 })}</div>
        <div class="cc-detail" id="ccDetail"><div class="cc-placeholder">เลือกห้องแชททางซ้ายเพื่อดูข้อความ</div></div>
      </div>
    </div>`;

  c.querySelectorAll("[data-cc-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _filter = btn.dataset.ccFilter === "all" ? "all" : "pending";
      _renderList();
    });
  });
  c.querySelector("#ccRefreshBtn")?.addEventListener("click", () => _loadThreads());
  c.querySelector("#ccThreadList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-thread-id]");
    if (btn) _openThread(btn.dataset.threadId);
  });
}

function _renderList() {
  const c = _container();
  if (!c) return;
  c.querySelectorAll("[data-cc-filter]").forEach((b) => b.classList.toggle("cc-on", b.dataset.ccFilter === _filter));
  const box = c.querySelector("#ccThreadList");
  if (!box) return;
  const list = filterThreads(_threads, _filter);
  if (list.length === 0) {
    box.innerHTML = renderEmpty({
      icon: "💬",
      title: _filter === "pending" ? "ไม่มีแชทค้างตอบ" : "ยังไม่มีแชทจากลูกค้า",
      message: "ข้อความที่ลูกค้าทักเข้า LINE OA จะขึ้นที่นี่",
    });
    return;
  }
  box.innerHTML = list.map((t) => renderThreadItem(t, _activeId)).join("");
}

async function _loadThreads({ quiet = false } = {}) {
  const c = _container();
  if (!c) return;
  try {
    const rows = await _rest(`/rest/v1/customer_chat_threads?select=${THREAD_COLS}&order=last_message_at.desc.nullslast&limit=200`);
    _threads = Array.isArray(rows) ? rows : [];
    _renderList();
  } catch (e) {
    console.warn("[customer_chat] load threads", e);
    if (quiet) return;
    const box = c.querySelector("#ccThreadList");
    if (box) {
      box.innerHTML = renderError({
        message: "โหลดแชทไม่สำเร็จ",
        detail: "ถ้าเพิ่งติดตั้งระบบ ให้ตรวจว่ารันไฟล์ SQL Phase 648 แล้ว",
        retryLabel: "",
        retryId: "",
      });
    }
  }
}

async function _setThreadState(threadId, { markRead = false, status = null } = {}) {
  return _rest("/rest/v1/rpc/customer_chat_set_thread_state", {
    method: "POST",
    body: JSON.stringify({ p_thread_id: threadId, p_mark_read: markRead, p_status: status }),
  });
}

async function _openThread(threadId) {
  _activeId = threadId;
  _renderList();
  const c = _container();
  const box = c?.querySelector("#ccDetail");
  if (!box) return;
  const thread = _threads.find((t) => String(t.id) === String(threadId));
  box.innerHTML = renderSkeleton({ type: "list", count: 4 });
  try {
    const rows = await _rest(`/rest/v1/customer_chat_messages?select=${MESSAGE_COLS}&thread_id=eq.${encodeURIComponent(threadId)}&order=sent_at.desc&limit=200`);
    if (String(_activeId) !== String(threadId)) return; // ผู้ใช้กดห้องอื่นไปแล้ว
    const msgs = (Array.isArray(rows) ? rows : []).slice().reverse();
    const isDone = thread?.status === "done";
    box.innerHTML = `
      <div class="cc-detail-head">
        <span class="cc-detail-name">${escHtml(_displayName(thread))}</span>
        <button type="button" class="btn light" id="ccStatusBtn" data-next="${isDone ? "open" : "done"}">${isDone ? "↩️ เปิดใหม่" : "✅ ทำเครื่องหมายว่าเสร็จ"}</button>
      </div>
      <div class="cc-messages" id="ccMessages">
        ${msgs.length ? msgs.map(renderMessageBubble).join("") : `<div class="cc-placeholder">ยังไม่มีข้อความ</div>`}
      </div>`;
    const list = box.querySelector("#ccMessages");
    if (list) list.scrollTop = list.scrollHeight;
    box.querySelector("#ccStatusBtn")?.addEventListener("click", (e) => _changeStatus(threadId, e.currentTarget.dataset.next));

    if (thread && Number(thread.unread_count) > 0) {
      try {
        await _setThreadState(threadId, { markRead: true });
        thread.unread_count = 0;
        _renderList();
      } catch (err) {
        console.warn("[customer_chat] mark read", err);
      }
    }
  } catch (e) {
    console.warn("[customer_chat] load messages", e);
    box.innerHTML = renderError({ message: "โหลดข้อความไม่สำเร็จ", detail: "ลองกดรีเฟรชอีกครั้ง", retryLabel: "", retryId: "" });
  }
}

async function _changeStatus(threadId, next) {
  const status = next === "open" ? "open" : "done";
  try {
    await _setThreadState(threadId, { markRead: true, status });
    const t = _threads.find((x) => String(x.id) === String(threadId));
    if (t) { t.status = status; t.unread_count = 0; }
    _ctx?.showToast?.(status === "done" ? "✅ ย้ายไปเสร็จแล้ว" : "↩️ เปิดห้องแชทใหม่แล้ว");
    if (status === "done" && _filter === "pending") _activeId = null;
    _renderList();
    if (_activeId) _openThread(_activeId);
    else {
      const box = _container()?.querySelector("#ccDetail");
      if (box) box.innerHTML = `<div class="cc-placeholder">เลือกห้องแชททางซ้ายเพื่อดูข้อความ</div>`;
    }
  } catch (e) {
    console.warn("[customer_chat] set status", e);
    _ctx?.showToast?.("⚠️ เปลี่ยนสถานะไม่สำเร็จ", "warn");
  }
}

export async function renderCustomerChatPage(ctx) {
  _ctx = ctx;
  const c = _container();
  if (!c) return;
  if (!ctx?.requireAdminOrSales?.()) {
    _stopPolling();
    c.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบและพนักงานขาย",
      detail: "หน้านี้เห็นได้เฉพาะ role admin และ sales",
      retryLabel: "",
      retryId: "",
    });
    return;
  }
  _activeId = null;
  _renderShell();
  _renderList();
  await _loadThreads();
  _startPolling();
}
