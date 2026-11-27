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
//
//  คิว (r3): กรอง "ค้างตอบ" = status open หรือ unread > 0 ที่ฝั่ง DB ก่อนแบ่งหน้า (PostgREST or=)
//   + จำนวนจาก Content-Range (Prefer: count=exact) = ทุกห้องที่บัญชีนี้มีสิทธิ์เห็นตาม RLS
//   + ปุ่ม "โหลดเพิ่ม" ทีละ THREAD_PAGE ห้อง
//  ห้อง (r3): anchor = read_seq ตอนเปิดห้อง
//   - ประวัติ = ข้อความที่ seq <= anchor หรือไม่มี seq (ล่าสุด HISTORY_LIMIT ข้อความ)
//   - ข้อความหลังจุดอ่าน = seq > anchor เรียงตาม seq (ไม่ใช่ sent_at → ข้อความที่ LINE ส่งช้าไม่หลุด)
//     ทีละ MESSAGE_PAGE + ปุ่ม "โหลดข้อความที่เหลือ"
//   - "อ่านถึง" = seq ต่อเนื่องจาก anchor ที่โหลดและแสดงแล้วจริงเท่านั้น
//   - กด "เสร็จ" ขณะยังมีข้อความที่ไม่ได้โหลด → ไม่ยิง RPC แจ้งให้โหลดก่อน; seq เก่า → server ไม่ปิด (new_messages)
//   - poll/รีเฟรช โหลดห้องที่เปิดใหม่ทุกครั้ง (จับ unsend ที่ seq ไม่เปลี่ยน); ข้อความที่เคยเห็นว่าถูกยกเลิก
//     จะไม่กลับมาแสดงเนื้อหาอีก (unsent set) และผลจาก request เก่าถูกทิ้ง (reqId)
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

const PAGE_ID = "page-customer_chat";
const POLL_MS = 30000;
const THREAD_PAGE = 100;
const MESSAGE_PAGE = 200;
const HISTORY_LIMIT = 50;
const THREAD_COLS = "id,display_name,status,unread_count,inbound_seq,read_seq,last_message_at,last_message_preview";
const MESSAGE_COLS = "id,direction,message_type,body,inbound_seq,unsent_at,sent_at,created_at";
const THREADS_PATH = "/rest/v1/customer_chat_threads";
const MESSAGES_PATH = "/rest/v1/customer_chat_messages";
const STATE_RPC = "/rest/v1/rpc/customer_chat_set_thread_state";
export const PENDING_FILTER_QS = "or=(status.eq.open,unread_count.gt.0)";

let _gen = 0;
let _sess = null;        // { gen, uid, controller }
let _ctx = null;
let _threads = [];
let _threadTotal = null;
let _pendingTotal = null;
let _filter = "pending"; // pending | all
let _room = null;        // ดู _newRoom()
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
  _threadTotal = null;
  _pendingTotal = null;
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

export function parseContentRangeTotal(value) {
  const m = /\/(\d+)\s*$/.exec(String(value || ""));
  return m ? Number(m[1]) : null;
}

async function _rest(sess, path, opts = {}, { withCount = false } = {}) {
  if (!_alive(sess)) throw new StaleSessionError("stale");
  const cfg = window.SUPABASE_CONFIG || {};
  const res = await fetch(cfg.url + path, {
    ...opts,
    signal: sess.controller.signal,
    headers: {
      apikey: cfg.anonKey,
      Authorization: "Bearer " + window._sbAccessToken,
      "Content-Type": "application/json",
      ...(withCount ? { Prefer: "count=exact" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!_alive(sess)) throw new StaleSessionError("stale");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (!_alive(sess)) throw new StaleSessionError("stale");
  const data = text ? JSON.parse(text) : null;
  if (!withCount) return data;
  return { data, total: parseContentRangeTotal(res.headers?.get?.("content-range")) };
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

// เรียงข้อความเก่า → ใหม่ (sent_at แล้ว seq แล้ว created_at) — ไม่พึ่งลำดับที่ server ส่งมา
export function sortMessagesAsc(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const t = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };
  return list.sort((a, b) =>
    (t(a.sent_at) - t(b.sent_at))
    || ((Number(a.inbound_seq) || 0) - (Number(b.inbound_seq) || 0))
    || (t(a.created_at) - t(b.created_at)));
}

// "อ่านถึง" = seq ต่อเนื่องจาก anchor ในข้อความขาเข้าที่โหลดแล้ว (มีช่องว่าง = หยุดตรงนั้น)
export function contiguousSeenSeq(anchor, messages) {
  const have = new Set();
  for (const m of Array.isArray(messages) ? messages : []) {
    const s = Number(m?.inbound_seq);
    if (m?.direction === "in" && Number.isInteger(s) && s > 0) have.add(s);
  }
  let seen = Math.max(0, Number(anchor) || 0);
  while (have.has(seen + 1)) seen++;
  return seen;
}

// รวมข้อความ (id ซ้ำใช้ตัวล่าสุด) + ข้อความที่เคยรู้ว่าถูกยกเลิกห้ามกลับมาแสดงเนื้อหา
export function mergeRoomMessages(lists, unsentIds) {
  const byId = new Map();
  for (const list of lists) {
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || m.id == null) continue;
      byId.set(String(m.id), { ...m });
    }
  }
  const out = [];
  for (const [id, m] of byId) {
    if (m.unsent_at) unsentIds?.add(id);
    if (unsentIds?.has(id)) {
      m.body = null;
      m.unsent_at = m.unsent_at || true;
    }
    out.push(m);
  }
  return sortMessagesAsc(out);
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
    <div class="cc-msg ${mine ? "cc-msg-out" : "cc-msg-in"}${unsent ? " cc-unsent" : ""}" data-msg-id="${escHtml(m.id)}">
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
  .cc-more{display:block;width:100%;padding:10px;border:0;background:none;color:var(--primary);font-weight:600;cursor:pointer}
  .cc-detail-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;border-bottom:1px solid var(--line)}
  .cc-detail-head .cc-detail-name{font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cc-gap{margin:0 12px;padding:8px 12px;border-radius:12px;background:rgba(245,158,11,.12);color:var(--text);font-size:13px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
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
    _refreshAll(sess, { quiet: true });
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
      const next = btn.dataset.ccFilter === "all" ? "all" : "pending";
      if (next === _filter) return;
      _filter = next;
      _threads = [];
      _threadTotal = null;
      _renderList();
      _loadThreads(sess);
    });
  });
  c.querySelector("#ccRefreshBtn")?.addEventListener("click", () => _refreshAll(sess));
  c.querySelector("#ccThreadList")?.addEventListener("click", (e) => {
    if (e.target.closest("#ccMoreThreads")) { _loadThreads(sess, { append: true }); return; }
    const btn = e.target.closest("[data-thread-id]");
    if (btn) _openThread(sess, btn.dataset.threadId);
  });
  c.querySelector("#ccDetail")?.addEventListener("click", (e) => {
    if (e.target.closest("#ccLoadRest")) { if (_room) { _room.pages++; _loadRoom(sess); } return; }
    const st = e.target.closest("#ccStatusBtn");
    if (st && _room) _changeStatus(sess, _room.threadId, st.dataset.next);
  });
}

function _renderList() {
  const c = _container();
  if (!c) return;
  c.querySelectorAll("[data-cc-filter]").forEach((b) => b.classList.toggle("cc-on", b.dataset.ccFilter === _filter));
  const countEl = c.querySelector("#ccPendingCount");
  if (countEl) countEl.textContent = Number(_pendingTotal) > 0 ? `(${_pendingTotal})` : "";
  const box = c.querySelector("#ccThreadList");
  if (!box) return;
  // คิว "ค้างตอบ" มาจาก server แล้ว; กรองซ้ำเฉพาะห้องที่สถานะเพิ่งเปลี่ยนในเครื่อง
  const list = _filter === "pending" ? _threads.filter(isPendingThread) : _threads;
  if (list.length === 0) {
    box.innerHTML = renderEmpty({
      icon: "💬",
      title: _filter === "pending" ? "ไม่มีแชทค้างตอบ" : "ยังไม่มีแชทจากลูกค้า",
      message: "ข้อความที่ลูกค้าทักเข้า LINE OA จะขึ้นที่นี่",
    });
    return;
  }
  const hasMore = _threadTotal != null ? _threads.length < _threadTotal : false;
  box.innerHTML = list.map((t) => renderThreadItem(t, _room?.threadId)).join("")
    + (hasMore ? `<button type="button" class="cc-more" id="ccMoreThreads">โหลดเพิ่ม (${_threadTotal - _threads.length} ห้อง)</button>` : "");
}

function _applyThreadPatch(patch) {
  if (!patch || patch.id == null) return;
  const targets = _threads.filter((x) => String(x.id) === String(patch.id));
  if (_room?.thread && String(_room.thread.id) === String(patch.id)) targets.push(_room.thread);
  for (const t of targets) {
    for (const k of ["status", "unread_count", "inbound_seq", "read_seq"]) {
      if (patch[k] !== undefined && patch[k] !== null) t[k] = patch[k];
    }
  }
}

function _threadsUrl({ filter, limit, offset }) {
  const where = filter === "pending" ? `&${PENDING_FILTER_QS}` : "";
  return `${THREADS_PATH}?select=${THREAD_COLS}${where}&order=last_message_at.desc.nullslast,id.desc&limit=${limit}&offset=${offset}`;
}

async function _refreshAll(sess, { quiet = false } = {}) {
  await _loadThreads(sess, { quiet });
  if (_alive(sess) && _room) _loadRoom(sess, { quiet: true });
}

async function _loadThreads(sess, { quiet = false, append = false } = {}) {
  if (!_alive(sess)) return;
  const reqId = ++_listReq;
  const filter = _filter;
  const limit = append ? THREAD_PAGE : Math.max(THREAD_PAGE, _threads.length);
  const offset = append ? _threads.length : 0;
  try {
    const listP = _rest(sess, _threadsUrl({ filter, limit, offset }), {}, { withCount: true });
    const countP = filter === "pending" ? null
      : _rest(sess, `${THREADS_PATH}?select=id&${PENDING_FILTER_QS}&limit=1`, {}, { withCount: true });
    const [list, count] = await Promise.all([listP, countP]);
    if (reqId !== _listReq || filter !== _filter) return; // มีคำขอใหม่กว่า/เปลี่ยนแท็บแล้ว — ทิ้งผลเก่า
    const rows = Array.isArray(list.data) ? list.data : [];
    if (append) {
      const seen = new Set(_threads.map((t) => String(t.id)));
      _threads = _threads.concat(rows.filter((t) => !seen.has(String(t.id))));
    } else {
      _threads = rows;
    }
    _threadTotal = list.total;
    _pendingTotal = filter === "pending" ? list.total : count?.total ?? _pendingTotal;
    _renderList();
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

function _newRoom(threadId) {
  return { threadId, thread: null, anchor: null, pages: 1, msgs: [], seen: 0, inbound: 0, unsent: new Set(), loaded: false };
}

function _renderRoom() {
  const box = _container()?.querySelector("#ccDetail");
  if (!box || !_room) return;
  const prev = box.querySelector("#ccMessages");
  const atBottom = !prev || (prev.scrollHeight - prev.scrollTop - prev.clientHeight < 40);
  const prevTop = prev ? prev.scrollTop : 0;
  const thread = _room.thread;
  const isDone = thread?.status === "done";
  const missing = Math.max(0, _room.inbound - _room.seen);
  box.innerHTML = `
    <div class="cc-detail-head">
      <span class="cc-detail-name">${escHtml(_displayName(thread))}</span>
      <button type="button" class="btn light" id="ccStatusBtn" data-next="${isDone ? "open" : "done"}"${_statusBusy ? " disabled" : ""}>${isDone ? "↩️ เปิดใหม่" : "✅ ทำเครื่องหมายว่าเสร็จ"}</button>
    </div>
    <div class="cc-messages" id="ccMessages">
      ${_room.msgs.length ? _room.msgs.map(renderMessageBubble).join("") : `<div class="cc-placeholder">ยังไม่มีข้อความ</div>`}
    </div>
    ${missing > 0 ? `<div class="cc-gap" id="ccGap">ยังมีข้อความที่ยังไม่ได้โหลด ${missing} ข้อความ <button type="button" class="btn light" id="ccLoadRest">โหลดข้อความที่เหลือ</button></div>` : ""}`;
  const list = box.querySelector("#ccMessages");
  if (list) list.scrollTop = atBottom ? list.scrollHeight : prevTop;
}

function _openThread(sess, threadId) {
  if (!_alive(sess)) return;
  if (_room && String(_room.threadId) === String(threadId)) { _loadRoom(sess); return; }
  _room = _newRoom(threadId);
  _renderList();
  const box = _container()?.querySelector("#ccDetail");
  if (box) box.innerHTML = renderSkeleton({ type: "list", count: 4 });
  _loadRoom(sess);
}

async function _loadRoom(sess, { quiet = false } = {}) {
  if (!_alive(sess) || !_room) return;
  const room = _room;
  const threadId = room.threadId;
  const reqId = ++_roomReq;
  const tid = encodeURIComponent(threadId);
  try {
    const rows = await _rest(sess, `${THREADS_PATH}?select=${THREAD_COLS}&id=eq.${tid}&limit=1`);
    if (reqId !== _roomReq || _room !== room) return;
    const thread = Array.isArray(rows) ? rows[0] : null;
    if (!thread) throw new Error("thread not found");
    const anchor = room.anchor ?? Math.max(0, Number(thread.read_seq) || 0);
    const [hist, fwd] = await Promise.all([
      _rest(sess, `${MESSAGES_PATH}?select=${MESSAGE_COLS}&thread_id=eq.${tid}&or=(inbound_seq.lte.${anchor},inbound_seq.is.null)&order=sent_at.desc,created_at.desc&limit=${HISTORY_LIMIT}`),
      _rest(sess, `${MESSAGES_PATH}?select=${MESSAGE_COLS}&thread_id=eq.${tid}&inbound_seq=gt.${anchor}&order=inbound_seq.asc&limit=${room.pages * MESSAGE_PAGE}`),
    ]);
    if (reqId !== _roomReq || _room !== room) return; // กดห้องอื่น/มีคำขอใหม่กว่า — ทิ้งผลเก่า
    const knownInbound = room.inbound;
    room.anchor = anchor;
    room.thread = { ...thread };
    room.msgs = mergeRoomMessages([hist, fwd], room.unsent);
    room.seen = contiguousSeenSeq(anchor, room.msgs);
    let maxSeq = 0;
    for (const m of room.msgs) { const s = Number(m.inbound_seq); if (Number.isInteger(s) && s > maxSeq) maxSeq = s; }
    room.inbound = Math.max(Number(thread.inbound_seq) || 0, maxSeq);
    room.loaded = true;
    _renderRoom();

    // อ่านแล้ว = ถึง seq ต่อเนื่องที่แสดงบนจอเท่านั้น และเฉพาะตอนหน้าจอเปิดอยู่จริง
    if (room.seen > (Number(thread.read_seq) || 0) && !document.hidden) {
      const res = await _setThreadState(sess, threadId, room.seen, null);
      if (_room !== room) return;
      _applyThreadPatch(res);
      _renderList();
      // มีข้อความใหม่เข้ามาหลังโหลด (ไม่ใช่แค่ยังไม่ได้กดโหลดหน้าถัดไป) → โหลดห้องอีกรอบ
      if (res && Number(res.inbound_seq) > Math.max(room.inbound, knownInbound)) _loadRoom(sess, { quiet: true });
    }
  } catch (e) {
    if (_isStale(e)) return;
    console.warn("[customer_chat] load room", e);
    if (quiet || reqId !== _roomReq || _room !== room) return;
    const box = _container()?.querySelector("#ccDetail");
    if (box) box.innerHTML = renderError({ message: "โหลดข้อความไม่สำเร็จ", detail: "ลองกดรีเฟรชอีกครั้ง", retryLabel: "", retryId: "" });
  }
}

async function _changeStatus(sess, threadId, next) {
  if (!_alive(sess) || _statusBusy) return;
  const room = _room;
  if (!room || !room.loaded || String(room.threadId) !== String(threadId)) return;
  const status = next === "open" ? "open" : "done";
  if (status === "done" && room.seen < room.inbound) {
    _ctx?.showToast?.("📥 ยังมีข้อความที่ยังไม่ได้โหลด — กด «โหลดข้อความที่เหลือ» ให้ครบก่อนปิดห้อง", "warn");
    return;
  }
  _statusBusy = true;
  const btn = _container()?.querySelector("#ccStatusBtn");
  if (btn) btn.disabled = true;
  try {
    const res = await _setThreadState(sess, threadId, room.seen, status);
    _applyThreadPatch(res);
    if (res && res.ok === false && res.reason === "new_messages") {
      _ctx?.showToast?.("💬 มีข้อความใหม่เข้ามา — ยังไม่ได้ปิดห้อง กรุณาอ่านก่อน", "warn");
      _renderList();
      _loadRoom(sess);
      return;
    }
    _ctx?.showToast?.(status === "done" ? "✅ ย้ายไปเสร็จแล้ว" : "↩️ เปิดห้องแชทใหม่แล้ว");
    if (status === "done" && _filter === "pending") {
      _room = null;
      const box = _container()?.querySelector("#ccDetail");
      if (box) box.innerHTML = `<div class="cc-placeholder">เลือกห้องแชททางซ้ายเพื่อดูข้อความ</div>`;
    } else {
      _loadRoom(sess);
    }
    _loadThreads(sess, { quiet: true }); // จำนวนค้างตอบ/คิว ตามข้อมูลจริงจาก server
    _renderList();
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
