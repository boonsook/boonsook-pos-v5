// ═══════════════════════════════════════════════════════════
//  Phase 642 — admin add-user / change-role with a verified role
//
//  ทุกผลลัพธ์บอกเฉพาะสิ่งที่ "รอบนี้" พิสูจน์ได้: สิทธิ์ที่อ่านกลับจาก DB หลังเขียน,
//  ความล้มเหลวที่ชัดเจน, หรือสถานะ "ไม่ทราบ" — ห้ามใช้ค่าเก่า/ค่าในฟอร์มแทนหลักฐาน
//  และห้าม signup อีเมลเดิมซ้ำ (retry/บัญชีเดิมไปทาง assignRole อย่างเดียว)
//  dependency ทุกตัวถูกฉีดเข้า (ทดสอบด้วย fake ได้) และต้องไม่ throw; ถ้า throw หรือคืนรูปแบบผิด
//  = ถือเป็นฝั่ง unknown/error เสมอ ไม่ใช่ success และไม่ใช่ "ไม่มีข้อมูล"
// ═══════════════════════════════════════════════════════════

export const STAFF_ROLES = Object.freeze(["sales", "technician", "accountant", "admin"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROFILE_POLLS = 6;
const POLL_DELAY_MS = 500;
const UNKNOWN_ROLE_TEXT = "ไม่ทราบ (ตรวจสอบไม่ได้)";

// ── pure helpers (adapter side) ─────────────────────────────
export function buildSignupBody({ email, password, fullName }) {
  return { email, password, data: { full_name: fullName } };
}

function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (_) { return { ok: false, value: null }; }
}

// signUp contract: created | exists | rejected | unknown (อาจสร้างแล้ว)
export function classifySignupResponse({ status, bodyText, networkError } = {}) {
  if (networkError || typeof status !== "number" || status <= 0) {
    return { kind: "unknown", status: null, error: String(networkError || "no response") };
  }
  const parsed = parseJson(bodyText);
  const body = parsed.ok && parsed.value && typeof parsed.value === "object" ? parsed.value : null;
  if (status >= 200 && status < 300) {
    if (!body) return { kind: "unknown", status, error: "unreadable signup response" };
    const user = body.user && typeof body.user === "object" ? body.user : body;
    // GoTrue ตอบ user หลอก (identities ว่าง) เมื่ออีเมลมีอยู่แล้วและเปิดยืนยันอีเมล — ห้ามใช้ id นั้น
    if (Array.isArray(user.identities) && user.identities.length === 0) return { kind: "exists" };
    const id = typeof user.id === "string" && user.id ? user.id : null;
    return id ? { kind: "created", userId: id } : { kind: "unknown", status, error: "signup response has no user id" };
  }
  const msg = body ? String(body.msg || body.error_description || body.message || body.error || "") : "";
  const code = body ? String(body.code || body.error_code || "") : "";
  if (status >= 400 && status < 500) {
    if (code === "user_already_exists" || code === "email_exists" || /already|registered/i.test(msg)) return { kind: "exists" };
    return { kind: "rejected", status, error: msg || "HTTP " + status };
  }
  return { kind: "unknown", status, error: msg || "HTTP " + status };
}

// getProfile contract: {ok:true,found:true,row} | {ok:true,found:false} | {ok:false,error}
export function classifyProfileRows({ status, bodyText, networkError } = {}, userId) {
  if (networkError || typeof status !== "number" || status < 200 || status >= 300) {
    return { ok: false, error: String(networkError || "HTTP " + status) };
  }
  const parsed = parseJson(bodyText);
  if (!parsed.ok || !Array.isArray(parsed.value)) return { ok: false, error: "unreadable profile response" };
  const rows = parsed.value;
  if (rows.length === 0) return { ok: true, found: false };
  if (rows.length > 1) return { ok: false, error: "more than one profile row" };
  const row = rows[0];
  if (!row || typeof row !== "object" || row.id !== userId || typeof row.role !== "string") return { ok: false, error: "profile row does not match" };
  return { ok: true, found: true, row: { id: row.id, role: row.role, full_name: row.full_name ?? null } };
}

// findProfileByEmail contract: {ok:true,found:true,row} | {ok:true,found:false} | {ok:false,error}
export function classifyEmailRows({ status, bodyText, networkError } = {}, email) {
  if (networkError || typeof status !== "number" || status < 200 || status >= 300) {
    return { ok: false, error: String(networkError || "HTTP " + status) };
  }
  const parsed = parseJson(bodyText);
  if (!parsed.ok || !Array.isArray(parsed.value)) return { ok: false, error: "unreadable account response" };
  const want = String(email || "").trim().toLowerCase();
  const rows = parsed.value.filter(r => r && typeof r === "object" && String(r.email || "").toLowerCase() === want);
  if (rows.length !== parsed.value.length) return { ok: false, error: "account rows do not match" };
  if (rows.length === 0) return { ok: true, found: false };
  if (rows.length > 1) return { ok: false, error: "more than one account" };
  const row = rows[0];
  if (typeof row.id !== "string" || !row.id || typeof row.role !== "string") return { ok: false, error: "account row incomplete" };
  return { ok: true, found: true, row: { id: row.id, email: row.email, role: row.role, full_name: row.full_name ?? null } };
}

// ── real adapters (browser) ─────────────────────────────────
export function createUserProvisioningAdapters({ windowRef, xhrPatch, isAdmin }) {
  const cfg = () => windowRef.SUPABASE_CONFIG;
  const token = () => windowRef._sbAccessToken || cfg().anonKey;
  const restHeaders = (extra = {}) => ({ "apikey": cfg().anonKey, "Authorization": "Bearer " + token(), ...extra });
  const makePassword = () => Array.from(windowRef.crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 20) + "A1!";
  const xhrJson = (method, url, body, timeout) => new Promise((resolve) => {
    const xhr = new windowRef.XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", cfg().anonKey);
    xhr.timeout = timeout;
    xhr.onload = () => resolve({ status: xhr.status, bodyText: xhr.responseText });
    xhr.onerror = () => resolve({ networkError: "Network error" });
    xhr.ontimeout = () => resolve({ networkError: "Timeout" });
    xhr.onabort = () => resolve({ networkError: "Aborted" });
    xhr.send(JSON.stringify(body));
  });
  const fetchText = async (url, init) => {
    try {
      const res = await windowRef.fetch(url, init);
      const text = await res.text();
      return { status: res.status, bodyText: text };
    } catch (e) { return { networkError: (e && e.message) || "Network error" }; }
  };
  return {
    async signUp({ email, fullName }) {
      const r = await xhrJson("POST", cfg().url + "/auth/v1/signup", buildSignupBody({ email, password: makePassword(), fullName }), 15000);
      return classifySignupResponse(r);
    },
    async getProfile(userId) {
      const r = await fetchText(cfg().url + "/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=id,role,full_name", { headers: restHeaders() });
      return classifyProfileRows(r, userId);
    },
    async patchProfile(userId, payload) {
      const r = await xhrPatch("profiles", payload, "id", userId);
      return r && r.ok ? { ok: true, row: r.data || null } : { ok: false, error: (r && r.error && r.error.message) || "update failed" };
    },
    async upsertProfile(row) {
      const r = await fetchText(cfg().url + "/rest/v1/profiles", {
        method: "POST",
        headers: restHeaders({ "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(row),
      });
      if (r.networkError || r.status < 200 || r.status >= 300) return { ok: false, error: r.networkError || "HTTP " + r.status };
      const parsed = parseJson(r.bodyText);
      return parsed.ok && Array.isArray(parsed.value) && parsed.value.length === 1 ? { ok: true, row: parsed.value[0] } : { ok: false, error: "unreadable upsert response" };
    },
    async findProfileByEmail(email) {
      const em = String(email || "").trim().toLowerCase();
      const r = await fetchText(cfg().url + "/rest/v1/profiles_with_email?email=eq." + encodeURIComponent(em) + "&select=id,email,role,full_name", { headers: restHeaders() });
      return classifyEmailRows(r, em);
    },
    async sendRecover(email) {
      const r = await xhrJson("POST", cfg().url + "/auth/v1/recover", { email }, 10000);
      if (r.networkError) return { ok: false, status: null, error: r.networkError, unknown: true };
      if (r.status >= 200 && r.status < 300) return { ok: true };
      const parsed = parseJson(r.bodyText);
      const msg = parsed.ok && parsed.value ? String(parsed.value.msg || parsed.value.message || parsed.value.error_description || "") : "";
      return { ok: false, status: r.status, error: msg || "HTTP " + r.status };
    },
    isAdmin,
    sleep: (ms) => new Promise(r => { windowRef.setTimeout(r, ms); }),
  };
}

// ── core flow ──────────────────────────────────────────────
function baseResult(extra) {
  return { ok: false, stage: "done", account: "unknown", role: { status: "not_attempted" }, invite: "not_sent", userId: null, email: null, error: null, ...extra };
}

export function createUserProvisioning(deps) {
  const inflight = new Set();
  const call = async (fn, args) => {
    try { const r = await fn(...args); return r && typeof r === "object" ? r : null; } catch (_) { return null; }
  };
  const admin = () => { try { return deps.isAdmin() === true; } catch (_) { return false; } };
  const profileState = (r, userId) => {
    if (r && r.ok === true && r.found === false) return { kind: "absent" };
    if (r && r.ok === true && r.found === true && r.row && r.row.id === userId && typeof r.row.role === "string") return { kind: "found", row: r.row };
    return { kind: "error" };
  };
  const inviteState = (r) => {
    if (!r || typeof r.ok !== "boolean") return "unknown";
    if (r.ok) return "sent";
    return r.unknown === true ? "unknown" : "failed";
  };

  async function assignCore({ userId, role, fullName }) {
    if (typeof userId !== "string" || !userId || !STAFF_ROLES.includes(role)) return { stage: "validate", role: { status: "not_attempted" }, error: "invalid input" };
    if (!admin()) return { stage: "admin", role: { status: "not_attempted" }, error: "not admin" };
    let last = { kind: "error" };
    for (let i = 0; i < PROFILE_POLLS; i++) {
      if (i > 0) await deps.sleep(POLL_DELAY_MS);
      last = profileState(await call(deps.getProfile, [userId]), userId);
      if (last.kind === "found") break;
    }
    if (last.kind === "error") return { stage: "lookup", role: { status: "unknown" }, error: "profile lookup failed" };
    if (!admin()) return { stage: "admin", role: { status: "not_attempted" }, error: "not admin" };
    const payload = fullName === undefined ? { role } : { full_name: fullName, role };
    if (last.kind === "found") await call(deps.patchProfile, [userId, payload]);
    else await call(deps.upsertProfile, [{ id: userId, ...payload }]);
    // ผลของการเขียนไม่ใช่หลักฐาน (response หายได้) — read-back เท่านั้นที่ตัดสิน
    const rb = profileState(await call(deps.getProfile, [userId]), userId);
    if (rb.kind !== "found") return { stage: "role", role: { status: "unknown" }, error: "read-back failed" };
    const nameOk = fullName === undefined || rb.row.full_name === fullName;
    if (rb.row.role === role && nameOk) return { stage: "done", role: { status: "verified", value: role } };
    return { stage: "role", role: { status: "mismatch", observed: rb.row.role, observedName: rb.row.full_name }, error: "read-back differs" };
  }

  async function inviteCore(email) {
    if (!admin()) return "not_sent";
    return inviteState(await call(deps.sendRecover, [email]));
  }

  async function finishWithInvite({ userId, email, role, fullName, account }) {
    const a = await assignCore({ userId, role, fullName });
    if (a.stage !== "done") return baseResult({ stage: a.stage, account, userId, email, role: a.role, error: a.error || null });
    const invite = await inviteCore(email);
    return baseResult({ ok: invite === "sent", stage: invite === "sent" ? "done" : "invite", account, userId, email, role: a.role, invite });
  }

  async function lookupExisting({ email, role }) {
    const em = String(email || "").trim();
    const r = await call(deps.findProfileByEmail, [em]);
    const found = r && r.ok === true && r.found === true && r.row && typeof r.row.id === "string" && typeof r.row.role === "string";
    if (!found) {
      const absent = r && r.ok === true && r.found === false;
      return baseResult({ stage: absent ? "exists" : "lookup", account: "exists", email: em, role: { status: "unknown" }, error: absent ? "not listed" : "account lookup failed" });
    }
    const roleState = r.row.role === role ? { status: "verified", value: role } : { status: "mismatch", observed: r.row.role, observedName: r.row.full_name ?? null };
    return baseResult({ stage: "exists", account: "exists", userId: r.row.id, email: em, role: roleState });
  }

  async function provisionStaffUser({ email, fullName, role } = {}) {
    const em = String(email || "").trim();
    const nm = String(fullName || "").trim();
    if (!EMAIL_RE.test(em) || !nm || !STAFF_ROLES.includes(role)) return baseResult({ stage: "validate", account: "not_created", email: em, error: "invalid input" });
    const key = "email:" + em.toLowerCase();
    if (inflight.has(key)) return baseResult({ stage: "busy", email: em });
    if (!admin()) return baseResult({ stage: "admin", account: "not_created", email: em, error: "not admin" });
    inflight.add(key);
    try {
      const s = await call(deps.signUp, [{ email: em, fullName: nm }]);
      const kind = s && ["created", "exists", "rejected", "unknown"].includes(s.kind) ? s.kind : "unknown";
      if (kind === "rejected") return baseResult({ stage: "signup", account: "not_created", email: em, error: s.error || "rejected" });
      if (kind === "exists") return await lookupExisting({ email: em, role });
      if (kind === "created" && typeof s.userId === "string" && s.userId) {
        return await finishWithInvite({ userId: s.userId, email: em, role, fullName: nm, account: "created" });
      }
      return baseResult({ stage: "signup", account: "unknown", email: em, role: { status: "unknown" }, error: (s && s.error) || "no usable signup response" });
    } finally { inflight.delete(key); }
  }

  async function guarded(key, fn, busy) {
    if (inflight.has(key)) return busy;
    inflight.add(key);
    try { return await fn(); } finally { inflight.delete(key); }
  }

  return {
    provisionStaffUser,
    // retry หลังสร้างบัญชีแล้ว: ตั้งสิทธิ์ + ส่งคำเชิญ — ไม่เรียก signUp เด็ดขาด
    // userId/email ต้องเป็นของบัญชีเดิม (ส่งต่อจากงานแรก) — ไม่ถูกต้อง = ไม่เรียกอะไรเลย
    resumeProvisioning: ({ userId, email, role, fullName }) => {
      const em = String(email || "").trim();
      if (typeof userId !== "string" || !userId || !EMAIL_RE.test(em)) return Promise.resolve(baseResult({ stage: "validate", account: "exists", userId: userId || null, email: em || null, error: "invalid input" }));
      return guarded("user:" + userId, () => finishWithInvite({ userId, email: em, role, fullName, account: "created" }), baseResult({ stage: "busy", userId }));
    },
    assignRole: ({ userId, role, fullName }) => guarded("user:" + userId, async () => {
      const a = await assignCore({ userId, role, fullName });
      return baseResult({ ok: a.stage === "done", stage: a.stage, account: "exists", userId, role: a.role, error: a.error || null });
    }, baseResult({ stage: "busy", userId })),
    lookupExisting: ({ email, role }) => guarded("email:" + String(email || "").trim().toLowerCase(), () => lookupExisting({ email, role }), baseResult({ stage: "busy", email })),
    sendPasswordLink: (email) => guarded("link:" + String(email || "").trim().toLowerCase(), async () => {
      const em = String(email || "").trim();
      // อีเมลว่าง/ผิดรูปแบบ = ไม่ส่ง request ใด ๆ
      if (!EMAIL_RE.test(em)) return baseResult({ stage: "validate", account: "exists", email: em || null, error: "invalid email" });
      if (!admin()) return baseResult({ stage: "admin", account: "exists", email: em, error: "not admin" });
      const invite = await inviteCore(em);
      return baseResult({ ok: invite === "sent", stage: invite === "sent" ? "done" : "invite", account: "exists", email: em, invite });
    }, baseResult({ stage: "busy", email })),
  };
}

// ── text for the UI (only values proven in this run) ────────
export function roleStateText(roleState, roleLabels = {}) {
  const label = (r) => roleLabels[r] || r;
  if (!roleState || typeof roleState !== "object") return UNKNOWN_ROLE_TEXT;
  if (roleState.status === "verified") return label(roleState.value);
  if (roleState.status === "mismatch") return typeof roleState.observed === "string" ? label(roleState.observed) : UNKNOWN_ROLE_TEXT;
  if (roleState.status === "not_attempted") return "ยังไม่ได้ตั้งสิทธิ์";
  return UNKNOWN_ROLE_TEXT;
}

export function describeProvisioningResult(res, { roleLabels = {}, chosenRole } = {}) {
  const label = (r) => roleLabels[r] || r;
  const email = res.email || "";
  const roleNow = "สิทธิ์ที่อ่านได้ตอนนี้: " + roleStateText(res.role, roleLabels);
  const close = { id: "close", label: "ปิด" };
  if (res.ok) return { tone: "success", title: "เรียบร้อย", lines: [], actions: [close] };
  if (res.account === "not_created") {
    const why = res.stage === "admin" ? "เฉพาะ Admin" : (res.error || "");
    return { tone: "error", title: "สร้างบัญชีไม่สำเร็จ", lines: [why, "ยังไม่มีการสร้างบัญชี"].filter(Boolean), actions: [close] };
  }
  if (res.account === "unknown") {
    return { tone: "warn", title: "ไม่ทราบว่าสร้างบัญชีแล้วหรือไม่", lines: [
      "ระบบไม่ได้รับคำตอบที่ยืนยันได้จากการสมัคร" + (res.error ? " (" + res.error + ")" : ""),
      "กรุณาตรวจรายการผู้ใช้ก่อนลองใหม่ — ยังไม่ได้ส่งคำเชิญ",
    ], actions: [close] };
  }
  if (res.stage === "invite") {
    const set = "ตั้งสิทธิ์เป็น " + roleStateText(res.role, roleLabels) + " แล้ว";
    const line = res.invite === "failed" ? set + " แต่ส่งอีเมลเชิญไม่สำเร็จ — กด 'ส่งลิงก์ตั้งรหัสผ่าน' อีกครั้ง"
      : res.invite === "unknown" ? set + " แต่ไม่ทราบว่าส่งอีเมลเชิญสำเร็จหรือไม่ — ตรวจกับผู้ใช้ก่อนส่งซ้ำ"
      : set + " แต่ยังไม่ได้ส่งลิงก์ เพราะสิทธิ์ Admin ของคุณเปลี่ยนไป";
    return { tone: "warn", title: "ส่งคำเชิญไม่ครบ", lines: [email, line], actions: [{ id: "link", label: "ส่งลิงก์ตั้งรหัสผ่าน" }, close] };
  }
  if (res.account === "exists" && res.stage === "lookup") {
    return { tone: "warn", title: "อีเมลนี้มีบัญชีอยู่แล้ว (ไม่ได้สมัครซ้ำ)", lines: [email, "ค้นข้อมูลบัญชีไม่สำเร็จ", roleNow], actions: [{ id: "research", label: "ลองค้นอีกครั้ง" }, close] };
  }
  if (res.account === "exists" && res.stage === "exists") {
    if (!res.userId) {
      return { tone: "warn", title: "อีเมลนี้มีบัญชีอยู่แล้ว (ไม่ได้สมัครซ้ำ)", lines: [email, "แต่ไม่พบในรายการผู้ใช้ — กรุณาแจ้งเจ้าของระบบ", roleNow], actions: [close] };
    }
    const lines = [email, roleNow];
    if (res.role && res.role.status === "mismatch" && res.role.observed === "customer") lines.push("บัญชีนี้เป็นลูกค้า — การตั้งสิทธิ์จะเปลี่ยนเป็นพนักงาน");
    const actions = [];
    if (!(res.role && res.role.status === "verified")) actions.push({ id: "assign", label: "ตั้งสิทธิ์เป็น " + label(chosenRole) });
    actions.push({ id: "link", label: "ส่งลิงก์ตั้งรหัสผ่าน" }, close);
    return { tone: "warn", title: "อีเมลนี้มีบัญชีอยู่แล้ว (ไม่ได้สมัครซ้ำ)", lines, actions };
  }
  const created = res.account === "created";
  const head = created ? "สร้างบัญชี " + email + " แล้ว แต่ยืนยันสิทธิ์ไม่ได้" : "ยืนยันสิทธิ์ไม่ได้" + (email ? " — " + email : "");
  const extra = res.stage === "admin" ? "หยุดก่อนตั้งสิทธิ์ เพราะสิทธิ์ Admin ของคุณเปลี่ยนไป" : "";
  return { tone: "warn", title: head, lines: [roleNow, extra, "ยังไม่ได้ส่งคำเชิญ"].filter(Boolean), actions: [{ id: "retry", label: "ลองตั้งสิทธิ์อีกครั้ง" }, close] };
}

// ── users list <select> (never shows "Admin" for a non-admin) ─
const STAFF_OPTION_LABELS = [["admin", "Admin"], ["technician", "ช่าง"], ["accountant", "สำนักงานบัญชี"], ["sales", "พนักงานขาย"]];
export function roleSelectValue(role) {
  return STAFF_ROLES.includes(role) ? role : "";
}
export function renderRoleSelectOptions(role, escHtml, placeholderText) {
  const known = STAFF_ROLES.includes(role);
  let html = "";
  if (!known) {
    const text = placeholderText !== undefined ? escHtml(placeholderText)
      : role === "customer" ? "ลูกค้า" : (typeof role === "string" && role ? "ไม่ทราบ (" + escHtml(role) + ")" : "ไม่ทราบ");
    html += `<option value="" disabled selected>${text}</option>`;
  }
  for (const [value, text] of STAFF_OPTION_LABELS) html += `<option value="${value}" ${known && role === value ? "selected" : ""}>${text}</option>`;
  return html;
}

// หลังเปลี่ยนสิทธิ์จากรายการ: select + ป้ายสิทธิ์ของแถวต้องแสดงเฉพาะสิ่งที่รู้จริง
//   verified → ค่าใหม่ · mismatch → ค่าที่อ่านได้รอบนี้ · unknown → "ไม่ทราบ (ตรวจสอบไม่ได้)"
//   ยกเลิก/ยังไม่ได้เขียน (not_attempted/busy/ไม่มีผล) → ค่าเดิม (prev ยังเป็นความจริงเพราะไม่มีการเขียน)
export function applyRoleResultToSelect(sel, res, { prev = "", escHtml, roleLabels = {} } = {}) {
  const st = res && res.role && typeof res.role === "object" ? res.role : null;
  const roleEl = typeof sel.closest === "function" ? sel.closest(".usr-card")?.querySelector(".usr-role") : null;
  const setLabel = (text, color) => { if (roleEl) { roleEl.textContent = text; if (color) roleEl.style.color = color; } };
  if (st && st.status === "verified") {
    sel.value = st.value; sel.dataset.rolePrev = st.value;
    setLabel(roleStateText(st, roleLabels));
    return "verified";
  }
  if (st && st.status === "mismatch") {
    sel.innerHTML = renderRoleSelectOptions(st.observed, escHtml);
    sel.value = roleSelectValue(st.observed);
    sel.dataset.rolePrev = roleSelectValue(st.observed);
    setLabel(roleStateText(st, roleLabels), "#64748b");
    return "observed";
  }
  if (st && st.status === "unknown") {
    sel.innerHTML = renderRoleSelectOptions(null, escHtml, UNKNOWN_ROLE_TEXT);
    sel.value = "";
    sel.dataset.rolePrev = "";
    setLabel(UNKNOWN_ROLE_TEXT, "#64748b");
    return "unknown";
  }
  sel.value = prev;
  return "unchanged";
}

// ── persistent result modal (DOM API + textContent only) ─────
export function showProvisioningModal(doc, view, handlers = {}) {
  doc.getElementById("bskProvisionModal")?.remove();
  const overlay = doc.createElement("div");
  overlay.id = "bskProvisionModal";
  overlay.className = "confirm-overlay";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.zIndex = "10000";
  const card = doc.createElement("div");
  card.className = "confirm-card";
  const title = doc.createElement("p");
  title.className = "confirm-msg provision-title";
  title.style.fontWeight = "700";
  title.textContent = view.title;
  card.appendChild(title);
  for (const line of view.lines || []) {
    const p = doc.createElement("p");
    p.className = "provision-line";
    p.textContent = line;
    card.appendChild(p);
  }
  const row = doc.createElement("div");
  row.className = "confirm-actions";
  for (const a of view.actions || []) {
    const b = doc.createElement("button");
    b.className = a.id === "close" ? "btn light" : "btn btn-primary";
    b.dataset.provisionAction = a.id;
    b.textContent = a.label;
    b.addEventListener("click", () => {
      overlay.remove();
      const h = handlers[a.id];
      if (typeof h === "function") Promise.resolve().then(h).catch(() => {});
    });
    row.appendChild(b);
  }
  card.appendChild(row);
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
  return overlay;
}

// ── controller used by main.js (UI glue, all side effects injected) ──
export function createUserAdminController({ provisioning, ui, roleLabels }) {
  const label = (r) => roleLabels[r] || r;
  async function refreshList() {
    let r = null;
    try { r = await ui.loadUsers(); } catch (_) { r = null; }
    if (!r || r.ok !== true) ui.toast("โหลดรายการผู้ใช้ใหม่ไม่สำเร็จ — รายการที่เห็นอาจไม่เป็นปัจจุบัน");
    else ui.rerender();
  }
  // task = งานที่ผู้ใช้สั่งพร้อมตัวตนของบัญชี { kind: "add" | "assign", userId, email, role, fullName }
  // ส่งต่อไปทุก action ถัดไป — ผลบางชนิด (เช่น assignRole) ไม่มี email ห้ามใช้ค่าว่างแทนของเดิม
  async function present(res, task) {
    if (res.stage === "busy") return res;
    const next = { ...task, userId: res.userId || task.userId || null, email: res.email || task.email || null };
    const shown = { ...res, userId: next.userId, email: next.email };
    if (["created", "exists", "unknown"].includes(res.account)) await refreshList();
    if (res.ok) {
      ui.toast(task.kind === "assign" ? `ตั้งสิทธิ์เป็น ${label(task.role)} แล้ว` : `✉️ ส่งคำเชิญไปที่ ${shown.email} แล้ว — ผู้ใช้จะได้รับลิงก์ตั้งรหัสผ่าน`);
      return res;
    }
    const view = describeProvisioningResult(shown, { roleLabels, chosenRole: task.role });
    // ไม่มีอีเมลที่ถูกต้อง = ไม่เสนอปุ่มส่งลิงก์ · ไม่มี userId = ไม่เสนอปุ่มที่ต้องเขียนสิทธิ์
    view.actions = view.actions.filter(a => (a.id !== "link" || EMAIL_RE.test(String(next.email || "")))
      && ((a.id !== "retry" && a.id !== "assign") || (typeof next.userId === "string" && next.userId)));
    ui.modal(view, {
      // retry รักษาประเภทงานเดิม: เพิ่มผู้ใช้ = ตั้งสิทธิ์ + ส่งคำเชิญ · ตั้งสิทธิ์บัญชีเดิม = ตั้งสิทธิ์อย่างเดียว (ไม่ส่ง recover)
      retry: () => (next.kind === "assign"
        ? run(() => provisioning.assignRole({ userId: next.userId, role: next.role }), next)
        : run(() => provisioning.resumeProvisioning({ userId: next.userId, email: next.email, role: next.role, fullName: next.fullName }), next)),
      assign: async () => {
        if (!(await ui.confirm(`ตั้งสิทธิ์เป็น "${label(next.role)}" ให้ ${next.email}?`))) return;
        await run(() => provisioning.assignRole({ userId: next.userId, role: next.role }), { ...next, kind: "assign" });
      },
      link: () => sendLink(next.email),
      research: () => run(() => provisioning.lookupExisting({ email: next.email, role: next.role }), next),
    });
    return res;
  }
  async function run(fn, task) {
    let res;
    // provisioning ไม่ throw ตามสัญญา — ถ้าเกิดขึ้นจริงให้รายงานเป็น "ไม่ทราบ" เสมอ
    try { res = await fn(); } catch (_) { res = baseResult({ stage: "role", account: task.kind === "add" && !task.userId ? "unknown" : "exists", email: task.email, role: { status: "unknown" } }); }
    return present(res, task);
  }
  async function addUser({ email, fullName, role }) {
    const res = await run(() => provisioning.provisionStaffUser({ email, fullName, role }), { kind: "add", email, fullName, role });
    if (res.account !== "not_created" && res.stage !== "busy") ui.resetAddForm();
    return res;
  }
  async function changeRole(userId, newRole) {
    if (!(await ui.confirm(`เปลี่ยนสิทธิ์เป็น "${label(newRole)}"?`))) return { ok: false, cancelled: true };
    const res = await provisioning.assignRole({ userId, role: newRole });
    if (res.stage === "busy") return res;
    await refreshList();
    if (res.ok) ui.toast(`เปลี่ยนเป็น ${label(newRole)} แล้ว`);
    else ui.toast("เปลี่ยนสิทธิ์ไม่สำเร็จ — สิทธิ์ที่อ่านได้: " + roleStateText(res.role, roleLabels));
    return res;
  }
  async function sendLink(email) {
    const em = String(email || "").trim();
    if (!EMAIL_RE.test(em)) { ui.toast("อีเมลไม่ถูกต้อง — ไม่ได้ส่งลิงก์"); return baseResult({ stage: "validate", account: "exists", email: em || null }); }
    if (!(await ui.confirm(`ส่งลิงก์ตั้งรหัสผ่านไปที่ ${em}?`))) return { ok: false, cancelled: true };
    const res = await provisioning.sendPasswordLink(em);
    if (res.stage === "busy") return res;
    if (res.ok) ui.toast(`✉️ ส่งลิงก์ไปที่ ${email} แล้ว`);
    else if (res.stage === "admin") ui.toast("เฉพาะ Admin");
    else if (res.invite === "unknown") ui.toast("ไม่ทราบว่าส่งลิงก์สำเร็จหรือไม่ — ตรวจกับผู้ใช้ก่อนส่งซ้ำ");
    else ui.toast("ส่งลิงก์ไม่สำเร็จ" + (res.error ? " — " + res.error : ""));
    return res;
  }
  return { addUser, changeRole, sendLink };
}
