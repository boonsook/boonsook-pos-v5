// ═══════════════════════════════════════════════════════════
//  กล่องแชทลูกค้า (Phase 648 เฟส A) — อ่านแชท LINE ที่ลูกค้าทักเข้ามา
//  admin + sales เท่านั้น (RLS customer_chat_is_inbox_staff คือด่านจริง; ตรงนี้เป็น UX)
//  เฟสนี้ "อ่านอย่างเดียว": ไม่ส่งข้อความหาลูกค้า ไม่เรียก LINE API ไม่แตะเงิน/สต็อก/บัญชี.
//  การเขียนที่ทำได้มีแค่ RPC customer_chat_set_thread_state (อ่านแล้ว / เสร็จ / เปิดใหม่).
//  ทุกค่าจาก DB ผ่าน escHtml ก่อนเข้า innerHTML (ชื่อ/ข้อความลูกค้า = untrusted).
//
//  Lifecycle (กันข้อมูลลูกค้าข้ามบัญชี):
//   - ทุกการ render สร้าง "session" ใหม่ (gen + user id + AbortController); งานเก่าถูก abort
//   - หลังทุก await ต้องผ่าน _alive(sess): gen เดิม + user id เดิม + ยังเป็น admin/sales + มี token
//     ไม่ผ่าน = ทิ้งผลลัพธ์เงียบ ๆ (ไม่ render ไม่ยิง RPC ต่อ)
//   - clearCustomerChatState() (main.js เรียกตอน logout/sign-out/afterLogin) = abort + หยุด poll + ล้าง DOM
//  อ่านแล้ว/เสร็จ อิง seq: ส่งเฉพาะ inbound_seq สูงสุดที่ "แสดงบนจอจริง" → ข้อความที่เข้ามาทีหลังยังไม่ถูกนับว่าอ่าน
//  และกด "เสร็จ" ด้วย seq เก่า เซิร์ฟเวอร์ไม่ปิดห้อง (reason new_messages) → โหลดห้องใหม่ให้เห็นก่อน
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

const PAGE_ID = "page-customer_chat";
const POLL_MS = 30000;
const THREAD_COLS = "id,display_name,status,unread_count,inbound_seq,read_seq,last_message_at,last_message_preview";
const MESSAGE_COLS = "id,direction,message_type,body,inbound_seq,unsent_at,sent_at,created_at";
const STATE_RPC = "/rest/v1/rpc/customer_chat_set_thread_state";

let _gen = 0;
let _sess = null;        // { gen, uid, controller }
let _ctx = null;
let _threads = [];
let _filter = "pending"; // pending | all
let _room = null;        // { threadId, maxSeq } — ห้องที่เปิดอยู่ + seq สูงสุดที่แสดงบนจอ
let _pollTimer = null;
let _listReq = 0;
let _roomReq = 0;
let _statusBusy = false;

class StaleSessionError extends Error {}

function _container() { return document.getElementById(PAGE_ID); }
function _uid() { return _ctx?.state?.currentUser?.id || null; }

function _alive(sess) {
  return !!sess
    && sess.gen === _gen
    && !!sess.uid
    && _uid() === sess.uid
    && !!window._sbAccessToken
    && !!_ctx?.requireAdminOrSales?.()
    && !!_container();
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _resetState() {
  _threads = [];
  _room = null;
  _filter = "pending";
  _statusBusy = false;
}

// ล้างทุกอย่างของหน้า (เรียกจาก main.js ตอน logout / sign-out / login บัญชีใหม่)
export function clearCustomerChatState() {
  _gen++;
  try { _sess?.controller?.abort(); } catch (_) { /* ignore */ }
  _sess = null;
  _stopPolling();
  _resetState();
  const c = _container();
  if (c) c.innerHTML = "";
}

async function _rest(sess, path, opts = {}) {
  if (!_alive(sess)) throw new StaleSessionError("stale");
  const cfg = window.SUPABASE_CONFIG || {};
  const res = await fetch(cfg.url + path, {
    ...opts,
    signal: sess.controller.signal,
    headers: {
      apikey: cfg.anonKey,
      Authorization: "Bearer " + window._sbAccessToken,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!_alive(sess)) throw new StaleSessionError("stale");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (!_alive(sess)) throw new StaleSessionError("stale");
  return text ? JSON.parse(text) : null;
}

function _isStale(e) {
  return e instanceof StaleSessionError || e?.name === "AbortError";
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

export function isPendingThread(t) {
  return !!t && (Number(t.unread_count) > 0 || t.status === "open");
}

export function filterThreads(threads, filter) {
  const list = Array.isArray(threads) ? threads : [];
  if (filter !== "pending") return list;
  return list.filter(isPendingThread);
}

// เรียงข้อความเก่า → ใหม่ (sent_at แล้ว seq แล้ว created_at) — ไม่พึ่งลำดับที่ server ส่งมา
export function sortMessagesAsc(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const t = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };
  return list.sort((a, b) =>
    (t(a.sent_at) - t(b.sent_at))
    || ((Number(a.inbound_seq) || 0) - (Number(b.inbound_seq) || 0))
    || (t(a.created_at) - t(b.created_at)));
}

// seq สูงสุดของข้อความขาเข้าที่อยู่ในรายการ (= ที่แสดงบนจอ) — ใช้เป็น "อ่านถึง"
export function maxInboundSeq(messages) {
  let max = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const s = Number(m?.inbound_seq);
    if (m?.direction === "in" && Number.isFinite(s) && s > max) max = s;
  }
  return max;
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
  const unsent = !!m.unsent_at;
  const body = unsent
    ? `<span class="cc-unsent-text">ลูกค้ายกเลิกข้อความนี้</span>`
    : escHtml(m.body || "");
  return `
    <div class="cc-msg ${mine ? "cc-msg-out" : "cc-msg-in"}${unsent ? " cc-unsent" : ""}">
      <div class="cc-bubble">${body}</div>
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
  .cc-unsent .cc-bubble{background:transparent;border:1px dashed var(--line);color:var(--muted);font-style:italic}
  .cc-msg-time{color:var(--muted);font-size:11px;margin-top:2px}
  .cc-placeholder{padding:28px 16px;color:var(--muted);text-align:center}
  @media (min-width:900px){
    .cc-layout{flex-direction:row;align-items:flex-start}
    .cc-list{flex:0 0 340px;max-height:72vh;overflow-y:auto}
    .cc-detail{flex:1}
  }
</style>`;

function _startPolling(sess) {
  _stopPolling();
  _pollTimer = setInterval(() => {
    if (!_alive(sess)) {
      // บัญชีเปลี่ยน/หมดสิทธิ์ระหว่างเปิดหน้า → ล้างทั้งหมด (รวม DOM ที่ซ่อนอยู่)
      if (sess.gen === _gen) clearCustomerChatState();
      else _stopPolling();
      return;
    }
    const c = _container();
    if (c.classList.contains("hidden")) { _stopPolling(); return; }
    if (document.hidden) return;
    _loadThreads(sess, { quiet: true });
  }, POLL_MS);
}

function _renderShell(sess) {
  const c = _container();
  if (!c) return;
  c.innerHTML = `${STYLE}
    <div class="cc-wrap">
      <div class="cc-note">💬 แชทจากลูกค้าที่ทักเข้า LINE OA ของร้าน · เฟสนี้ดูได้อย่างเดียว ตอบลูกค้าในแอป LINE OA ตามเดิม (AI ร่างคำตอบจะมาในเฟสถัดไป)</div>
      <div class="cc-toolbar">
        <button type="button" class="cc-tab" data-cc-filter="pending">ค้างตอบ <span id="ccPendingCount"></span></button>
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
      if (!_alive(sess)) return;
      _filter = btn.dataset.ccFilter === "all" ? "all" : "pending";
      _renderList();
    });
  });
  c.querySelector("#ccRefreshBtn")?.addEventListener("click", () => _loadThreads(sess));
  c.querySelector("#ccThreadList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-thread-id]");
    if (btn) _openThread(sess, btn.dataset.threadId);
  });
}

function _renderList() {
  const c = _container();
  if (!c) return;
  c.querySelectorAll("[data-cc-filter]").forEach((b) => b.classList.toggle("cc-on", b.dataset.ccFilter === _filter));
  const countEl = c.querySelector("#ccPendingCount");
  if (countEl) {
    const n = _threads.filter(isPendingThread).length;
    countEl.textContent = n > 0 ? `(${n})` : "";
  }
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
  box.innerHTML = list.map((t) => renderThreadItem(t, _room?.threadId)).join("");
}

function _applyThreadPatch(patch) {
  if (!patch || patch.id == null) return;
  const t = _threads.find((x) => String(x.id) === String(patch.id));
  if (!t) return;
  for (const k of ["status", "unread_count", "inbound_seq", "read_seq"]) {
    if (patch[k] !== undefined && patch[k] !== null) t[k] = patch[k];
  }
}

async function _loadThreads(sess, { quiet = false } = {}) {
  if (!_alive(sess)) return;
  const reqId = ++_listReq;
  try {
    const rows = await _rest(sess, `/rest/v1/customer_chat_threads?select=${THREAD_COLS}&order=last_message_at.desc.nullslast&limit=200`);
    if (reqId !== _listReq) return; // มีคำขอใหม่กว่าแล้ว — ทิ้งผลเก่า
    _threads = Array.isArray(rows) ? rows : [];
    _renderList();
    // ห้องที่เปิดอยู่มีข้อความใหม่กว่าที่แสดง → โหลดห้องใหม่ (และ mark read เท่าที่แสดงจริง)
    if (_room) {
      const t = _threads.find((x) => String(x.id) === String(_room.threadId));
      if (t && Number(t.inbound_seq) > _room.maxSeq) _openThread(sess, _room.threadId, { keepScroll: true });
    }
  } catch (e) {
    if (_isStale(e)) return;
    console.warn("[customer_chat] load threads", e);
    if (quiet || reqId !== _listReq) return;
    const box = _container()?.querySelector("#ccThreadList");
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

function _setThreadState(sess, threadId, readThroughSeq, status = null) {
  return _rest(sess, STATE_RPC, {
    method: "POST",
    body: JSON.stringify({ p_thread_id: threadId, p_read_through_seq: readThroughSeq, p_status: status }),
  });
}

function _renderRoom(thread, msgs) {
  const box = _container()?.querySelector("#ccDetail");
  if (!box) return;
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
}

async function _openThread(sess, threadId, { keepScroll: _keepScroll = false } = {}) {
  if (!_alive(sess)) return;
  const switching = !_room || String(_room.threadId) !== String(threadId);
  if (switching) {
    _room = { threadId, maxSeq: 0 };
    _renderList();
    const box = _container()?.querySelector("#ccDetail");
    if (box) box.innerHTML = renderSkeleton({ type: "list", count: 4 });
  }
  const reqId = ++_roomReq;
  try {
    const rows = await _rest(sess, `/rest/v1/customer_chat_messages?select=${MESSAGE_COLS}&thread_id=eq.${encodeURIComponent(threadId)}&order=sent_at.desc,created_at.desc&limit=200`);
    if (reqId !== _roomReq || !_room || String(_room.threadId) !== String(threadId)) return; // กดห้องอื่น/โหลดใหม่ไปแล้ว
    const msgs = sortMessagesAsc(rows);
    const seen = maxInboundSeq(msgs);
    _room.maxSeq = Math.max(_room.maxSeq, seen);
    const thread = _threads.find((t) => String(t.id) === String(threadId));
    _renderRoom(thread, msgs);
    _container()?.querySelector("#ccStatusBtn")?.addEventListener("click", (e) => _changeStatus(sess, threadId, e.currentTarget.dataset.next));

    // อ่านแล้ว = เฉพาะถึง seq ที่แสดงบนจอ (ไม่ใช่ศูนย์ทั้งห้อง) และเฉพาะตอนหน้าจอเปิดอยู่จริง
    if (thread && Number(thread.read_seq ?? 0) < seen && !document.hidden) {
      const res = await _setThreadState(sess, threadId, seen, null);
      _applyThreadPatch(res);
      _renderList();
      if (res && Number(res.inbound_seq) > seen && _room && String(_room.threadId) === String(threadId)) {
        _openThread(sess, threadId, { keepScroll: true }); // มีข้อความใหม่เข้าระหว่างโหลด → แสดงก่อน
      }
    }
  } catch (e) {
    if (_isStale(e)) return;
    console.warn("[customer_chat] load messages", e);
    if (reqId !== _roomReq) return;
    const box = _container()?.querySelector("#ccDetail");
    if (box) box.innerHTML = renderError({ message: "โหลดข้อความไม่สำเร็จ", detail: "ลองกดรีเฟรชอีกครั้ง", retryLabel: "", retryId: "" });
  }
}

async function _changeStatus(sess, threadId, next) {
  if (!_alive(sess) || _statusBusy) return;
  if (!_room || String(_room.threadId) !== String(threadId)) return;
  const status = next === "open" ? "open" : "done";
  const seenSeq = _room.maxSeq;
  const btn = _container()?.querySelector("#ccStatusBtn");
  _statusBusy = true;
  if (btn) btn.disabled = true;
  try {
    const res = await _setThreadState(sess, threadId, seenSeq, status);
    _applyThreadPatch(res);
    if (res && res.ok === false && res.reason === "new_messages") {
      _ctx?.showToast?.("💬 มีข้อความใหม่เข้ามา — ยังไม่ได้ปิดห้อง กรุณาอ่านก่อน", "warn");
      _renderList();
      _openThread(sess, threadId, { keepScroll: true });
      return;
    }
    _ctx?.showToast?.(status === "done" ? "✅ ย้ายไปเสร็จแล้ว" : "↩️ เปิดห้องแชทใหม่แล้ว");
    if (status === "done" && _filter === "pending") {
      _room = null;
      _renderList();
      const box = _container()?.querySelector("#ccDetail");
      if (box) box.innerHTML = `<div class="cc-placeholder">เลือกห้องแชททางซ้ายเพื่อดูข้อความ</div>`;
    } else {
      _renderList();
      _openThread(sess, threadId, { keepScroll: true });
    }
  } catch (e) {
    if (_isStale(e)) return;
    console.warn("[customer_chat] set status", e);
    _ctx?.showToast?.("⚠️ เปลี่ยนสถานะไม่สำเร็จ", "warn");
  } finally {
    if (sess.gen === _gen) {
      _statusBusy = false;
      const b = _container()?.querySelector("#ccStatusBtn");
      if (b) b.disabled = false;
    }
  }
}

export async function renderCustomerChatPage(ctx) {
  clearCustomerChatState(); // ตัดงาน/poll/DOM ของรอบก่อนทุกครั้ง (รวมบัญชีก่อนหน้า)
  _ctx = ctx;
  const c = _container();
  if (!c) return;
  if (!ctx?.requireAdminOrSales?.()) {
    c.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบและพนักงานขาย",
      detail: "หน้านี้เห็นได้เฉพาะ role admin และ sales",
      retryLabel: "",
      retryId: "",
    });
    return;
  }
  const sess = { gen: _gen, uid: _uid(), controller: new AbortController() };
  _sess = sess;
  if (!_alive(sess)) {
    c.innerHTML = renderError({ message: "กรุณาเข้าสู่ระบบใหม่", detail: "", retryLabel: "", retryId: "" });
    return;
  }
  _renderShell(sess);
  _renderList();
  await _loadThreads(sess);
  if (_alive(sess)) _startPolling(sess);
}
