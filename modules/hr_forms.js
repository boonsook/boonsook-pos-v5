// ═══════════════════════════════════════════════════════════
//  HR FORMS — รับสมัครงาน + ใบลาออก (Phase 420, admin-only)
//
//  2 หน้าใหม่กลุ่ม บุคลากร/HR:
//    - hr_applications  "📝 รับสมัครงาน"  — บันทึกผู้สมัคร + แนบรูปเอกสาร + พิมพ์ฟอร์ม
//    - hr_resignations  "📤 ใบลาออก"      — บันทึก + อนุมัติ + พิมพ์เอกสารทางการ
//
//  Invariants (ดู tests/hr_forms_guard.test.js):
//    - admin-only (requireAdmin) — role อื่นเห็น error state เท่านั้น
//    - อนุมัติใบลาออก "ไม่" ตัดพนักงานออกอัตโนมัติ — ❌ ห้าม PATCH/UPDATE profiles
//      (fetch profiles = GET read-only เท่านั้น) ระบบแค่เตือนให้แอดมินไปปิดสถานะเอง
//    - รับเข้าทำงาน (hired) ไม่ auto-สร้างบัญชีผู้ใช้ — แค่เตือนให้ไปสร้างที่ ตั้งค่า
//    - แนบรูป upload เข้า Supabase storage bucket `proofs` path applications/
//      (pattern เดียวกับรูปบิลใน expenses.js) เก็บใน attachments jsonb [{url,label}]
//    - ทุก print builder escape ค่าผู้ใช้ด้วย escHtml (XSS §4.5)
//    - ไม่มี native alert/confirm — ใช้ window.App?.confirm? + ctx.showToast
//    - action สำคัญ (เพิ่ม/แก้/เปลี่ยนสถานะ/อนุมัติ/ลบ) → logActivity
//    - ไม่แตะ เงิน/สต็อก/บัญชี/POS/payroll/time_clock/leave_management
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, todayBkk, logActivity, formatNumber } from "./utils.js";

// ── module state ──
let _apps = [];
let _appFilter = "all";       // all | new | interview | hired | rejected
let _appSearch = "";
let _resigs = [];
let _staffProfiles = [];      // profiles role != customer (read-only lookup)
let _appSaveInflight = false;
let _resigSaveInflight = false;
let _appUploadInflight = false;
let _pendingAttachments = []; // [{url,label}] ของฟอร์มที่เปิดอยู่

export const APP_STATUS = {
  new:       { label: "ใหม่",        color: "#0369a1", bg: "#e0f2fe" },
  interview: { label: "นัดสัมภาษณ์", color: "#9a3412", bg: "#ffedd5" },
  hired:     { label: "รับแล้ว",     color: "#15803d", bg: "#dcfce7" },
  rejected:  { label: "ไม่รับ",      color: "#475569", bg: "#f1f5f9" },
};
const ATTACH_LABELS = ["บัตรประชาชน", "เรซูเม่", "วุฒิการศึกษา", "อื่น ๆ"];

// ═══════════════════════════════════════════════════════════
//  PURE HELPERS (testable — no DOM / no network)
// ═══════════════════════════════════════════════════════════

// กรองผู้สมัครตามสถานะ + คำค้น (ชื่อ/เบอร์/ตำแหน่ง) — in-memory เท่านั้น
export function filterApplications(rows, { status = "all", search = "" } = {}) {
  const q = String(search || "").trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter(a => {
    if (!a) return false;
    if (status !== "all" && String(a.status) !== status) return false;
    if (!q) return true;
    const hay = [a.full_name, a.phone, a.position]
      .map(v => String(v == null ? "" : v).toLowerCase());
    return hay.some(h => h.includes(q));
  });
}

// "YYYY-MM-DD" → "DD/MM" (ใช้ใน banner เตือนปิดสถานะ)
export function formatDateDmTh(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return "-";
  return `${m[3]}/${m[2]}`;
}

// "YYYY-MM-DD" → วันที่ไทยเต็ม เช่น "11 มิถุนายน 2569" (เอกสารพิมพ์)
export function formatDateThaiLong(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return "-";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}

// แปลง attachments (jsonb อาจมาเป็น array/string/null) → array [{url,label}] เสมอ
export function normalizeAttachments(raw) {
  let arr = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch (_e) { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(x => x && typeof x.url === "string" && x.url)
    .map(x => ({ url: String(x.url), label: String(x.label || "เอกสารแนบ") }));
}

// ═══════════════════════════════════════════════════════════
//  PRINT BUILDERS (pure — ทุกค่าผู้ใช้ escape ด้วย escHtml)
// ═══════════════════════════════════════════════════════════

function _printBaseCss() {
  return `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', sans-serif; color: #0f172a; margin: 0; font-size: 14px; }
  .doc { max-width: 720px; margin: 0 auto; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
  .co-name { font-size: 18px; font-weight: 800; }
  .co-meta { font-size: 12px; color: #334155; margin-top: 2px; line-height: 1.5; }
  .doc-title { font-size: 20px; font-weight: 800; text-align: center; margin: 10px 0 16px; }
  .field-row { display: flex; gap: 14px; margin-bottom: 10px; }
  .field { flex: 1; }
  .field-label { font-size: 11px; color: #475569; font-weight: 700; margin-bottom: 2px; }
  .field-value { border-bottom: 1px dotted #94a3b8; min-height: 22px; padding: 2px 4px; font-size: 14px; }
  .field-box { border: 1px solid #cbd5e1; border-radius: 6px; min-height: 60px; padding: 6px 8px; font-size: 14px; white-space: pre-wrap; }
  .photo-box { width: 96px; height: 128px; border: 1px dashed #94a3b8; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #94a3b8; text-align: center; }
  .sig-row { display: flex; gap: 30px; margin-top: 40px; }
  .sig { flex: 1; text-align: center; }
  .sig-line { border-bottom: 1px dotted #475569; height: 34px; margin-bottom: 6px; }
  .sig-label { font-size: 12px; color: #334155; }
  .doc-note { font-size: 11px; color: #64748b; margin-top: 18px; }
  .attach-list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; }
  .body-text { font-size: 15px; line-height: 2; text-indent: 48px; margin: 14px 0; }`;
}

function _storeHeadHtml(store) {
  const s = store || {};
  return `
  <div class="doc-head">
    <div>
      <div class="co-name">${escHtml(s.name || "บุญสุข อิเล็กทรอนิกส์")}</div>
      <div class="co-meta">
        ${s.address ? escHtml(s.address) + "<br>" : ""}
        ${s.taxId ? "เลขประจำตัวผู้เสียภาษี " + escHtml(s.taxId) + "<br>" : ""}
        ${s.phone ? "โทร. " + escHtml(s.phone) : ""}${s.mobile ? " / " + escHtml(s.mobile) : ""}
      </div>
    </div>
  </div>`;
}

// ฟอร์มใบสมัครเปล่า (กรอกมือ) — ช่องครบตาม schema + ที่ติดรูป + ลายเซ็น
export function buildBlankApplicationFormHtml(store) {
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>ฟอร์มใบสมัครงาน (เปล่า)</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet">
<style>${_printBaseCss()}</style>
</head><body><div class="doc">
  ${_storeHeadHtml(store)}
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="flex:1">
      <div class="doc-title" style="text-align:left;margin-top:0">ใบสมัครงาน</div>
      <div class="field-row">
        <div class="field"><div class="field-label">วันที่สมัคร</div><div class="field-value"></div></div>
        <div class="field"><div class="field-label">ตำแหน่งที่สมัคร</div><div class="field-value"></div></div>
      </div>
    </div>
    <div class="photo-box" style="margin-left:14px">ติดรูปถ่าย<br>1 นิ้ว</div>
  </div>
  <div class="field-row">
    <div class="field"><div class="field-label">ชื่อ-นามสกุล</div><div class="field-value"></div></div>
    <div class="field" style="max-width:200px"><div class="field-label">เบอร์โทรศัพท์</div><div class="field-value"></div></div>
  </div>
  <div class="field-row"><div class="field"><div class="field-label">ที่อยู่ปัจจุบัน</div><div class="field-value"></div><div class="field-value"></div></div></div>
  <div class="field-row">
    <div class="field"><div class="field-label">เงินเดือนที่คาดหวัง (บาท)</div><div class="field-value"></div></div>
    <div class="field"><div class="field-label">เริ่มงานได้วันที่</div><div class="field-value"></div></div>
  </div>
  <div class="field-row"><div class="field"><div class="field-label">ประวัติการทำงาน / ประสบการณ์</div><div class="field-box" style="min-height:110px"></div></div></div>
  <div class="field-row"><div class="field"><div class="field-label">เอกสารที่แนบ (ทำเครื่องหมาย ✓)</div>
    <div style="display:flex;gap:18px;font-size:13px;margin-top:4px;flex-wrap:wrap">
      <span>☐ สำเนาบัตรประชาชน</span><span>☐ เรซูเม่</span><span>☐ วุฒิการศึกษา</span><span>☐ อื่น ๆ ..................</span>
    </div></div></div>
  <div class="doc-note">ข้าพเจ้าขอรับรองว่าข้อความข้างต้นเป็นความจริงทุกประการ</div>
  <div class="sig-row">
    <div class="sig"><div class="sig-line"></div><div class="sig-label">ลายเซ็นผู้สมัคร · วันที่ ........./........./.........</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-label">ผู้รับสมัคร · วันที่ ........./........./.........</div></div>
  </div>
</div>
<script>setTimeout(() => { window.print(); }, 350);</script>
</body></html>`;
}

// ใบสมัครของผู้สมัครที่เลือก — ข้อมูลจริง + รายการเอกสารแนบ (escape ทุกค่า)
export function buildApplicationPrintHtml(app, { store } = {}) {
  const a = app || {};
  const st = APP_STATUS[a.status] || { label: String(a.status || "-") };
  const attachments = normalizeAttachments(a.attachments);
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>ใบสมัครงาน — ${escHtml(a.full_name || "-")}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet">
<style>${_printBaseCss()}</style>
</head><body><div class="doc">
  ${_storeHeadHtml(store)}
  <div class="doc-title">ใบสมัครงาน</div>
  <div class="field-row">
    <div class="field"><div class="field-label">วันที่สมัคร</div><div class="field-value">${escHtml(formatDateThaiLong(a.applied_date))}</div></div>
    <div class="field"><div class="field-label">ตำแหน่งที่สมัคร</div><div class="field-value">${escHtml(a.position || "-")}</div></div>
    <div class="field" style="max-width:170px"><div class="field-label">สถานะ</div><div class="field-value">${escHtml(st.label)}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="field-label">ชื่อ-นามสกุล</div><div class="field-value">${escHtml(a.full_name || "-")}</div></div>
    <div class="field" style="max-width:200px"><div class="field-label">เบอร์โทรศัพท์</div><div class="field-value">${escHtml(a.phone || "-")}</div></div>
  </div>
  <div class="field-row"><div class="field"><div class="field-label">ที่อยู่ปัจจุบัน</div><div class="field-value">${escHtml(a.address || "-")}</div></div></div>
  <div class="field-row">
    <div class="field"><div class="field-label">เงินเดือนที่คาดหวัง (บาท)</div><div class="field-value">${a.expected_salary != null && a.expected_salary !== "" ? escHtml(formatNumber(a.expected_salary)) : "-"}</div></div>
    <div class="field"><div class="field-label">วันที่รับเข้าทำงาน</div><div class="field-value">${a.hired_date ? escHtml(formatDateThaiLong(a.hired_date)) : "-"}</div></div>
  </div>
  <div class="field-row"><div class="field"><div class="field-label">ประวัติการทำงาน / ประสบการณ์</div><div class="field-box">${escHtml(a.experience || "-")}</div></div></div>
  ${a.note ? `<div class="field-row"><div class="field"><div class="field-label">หมายเหตุ</div><div class="field-box" style="min-height:36px">${escHtml(a.note)}</div></div></div>` : ""}
  <div class="field-row"><div class="field"><div class="field-label">เอกสารแนบ (${attachments.length} รายการ)</div>
    ${attachments.length
      ? `<ul class="attach-list">${attachments.map((at, i) => `<li>${escHtml(at.label)} (ไฟล์แนบ ${i + 1})</li>`).join("")}</ul>`
      : `<div style="font-size:13px;color:#64748b;margin-top:4px">— ไม่มีเอกสารแนบ —</div>`}
  </div></div>
  <div class="sig-row">
    <div class="sig"><div class="sig-line"></div><div class="sig-label">ลายเซ็นผู้สมัคร · วันที่ ........./........./.........</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-label">ผู้รับสมัคร · วันที่ ........./........./.........</div></div>
  </div>
</div>
<script>setTimeout(() => { window.print(); }, 350);</script>
</body></html>`;
}

// หนังสือลาออกทางการ — หัวร้าน + ข้อความมาตรฐาน + ช่องลายเซ็น (escape ทุกค่า)
export function buildResignationPrintHtml(resig, { emp, store } = {}) {
  const r = resig || {};
  const empName = emp?.full_name || "-";
  const storeName = store?.name || "บุญสุข อิเล็กทรอนิกส์";
  const approved = r.status === "approved";
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>หนังสือลาออก — ${escHtml(empName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap" rel="stylesheet">
<style>${_printBaseCss()}</style>
</head><body><div class="doc">
  ${_storeHeadHtml(store)}
  <div class="doc-title">หนังสือขอลาออกจากการเป็นพนักงาน</div>
  <div style="text-align:right;font-size:14px;margin-bottom:6px">วันที่ยื่น ${escHtml(formatDateThaiLong(r.submitted_date))}</div>
  <div class="body-text">
    ข้าพเจ้า <strong>${escHtml(empName)}</strong> พนักงานของ <strong>${escHtml(storeName)}</strong>
    มีความประสงค์ขอลาออกจากการเป็นพนักงาน
    โดยขอให้มีผลตั้งแต่วันที่ <strong>${escHtml(formatDateThaiLong(r.last_working_date))}</strong> เป็นต้นไป
    ${r.reason ? `เนื่องจาก ${escHtml(r.reason)}` : ""}
  </div>
  <div class="body-text" style="text-indent:48px">
    ข้าพเจ้าขอขอบคุณที่ได้ให้โอกาสร่วมงานตลอดระยะเวลาที่ผ่านมา
    และยินดีส่งมอบงานในความรับผิดชอบให้เรียบร้อยก่อนวันทำงานวันสุดท้าย
  </div>
  ${r.note ? `<div class="field-row"><div class="field"><div class="field-label">หมายเหตุ</div><div class="field-box" style="min-height:36px">${escHtml(r.note)}</div></div></div>` : ""}
  <div class="sig-row">
    <div class="sig"><div class="sig-line"></div><div class="sig-label">(${escHtml(empName)})<br>พนักงาน · วันที่ ........./........./.........</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-label">ผู้อนุมัติ · ${escHtml(storeName)}<br>วันที่ ${approved && r.approved_at ? escHtml(formatDateThaiLong(String(r.approved_at).slice(0, 10))) : "........./........./........."}</div></div>
  </div>
  <div class="doc-note">สถานะเอกสาร: ${approved ? "อนุมัติแล้ว" : "รออนุมัติ"} · เอกสารนี้ออกจากระบบ Boonsook POS</div>
</div>
<script>setTimeout(() => { window.print(); }, 350);</script>
</body></html>`;
}

// ═══════════════════════════════════════════════════════════
//  SHARED (DOM) HELPERS
// ═══════════════════════════════════════════════════════════

function _sbHeaders(extra) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  return Object.assign({ "apikey": cfg.anonKey, "Authorization": "Bearer " + token }, extra || {});
}

function _openPrintWindow(ctx, html, toastMsg) {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { ctx.showToast?.("Browser block popup — เปิดใช้ popup สำหรับเว็บนี้"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  if (toastMsg) ctx.showToast?.(toastMsg);
}

// กล่องแจ้งเตือนกลาง (info modal — html ต้อง escape มาก่อนแล้ว)
function _showInfoModal(title, bodyHtml) {
  document.getElementById("hrFormsInfoModal")?.remove();
  const m = document.createElement("div");
  m.id = "hrFormsInfoModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px">
      <h3 style="margin:0 0 10px;font-size:16px;color:#0f172a">${title}</h3>
      <div style="font-size:13.5px;color:#334155;line-height:1.7">${bodyHtml}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button id="hrFormsInfoOk" type="button" style="padding:8px 22px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">รับทราบ</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("hrFormsInfoOk")?.addEventListener("click", () => m.remove());
}

// ดูรูปเอกสารแนบเต็มจอ (read-only)
function _viewAttachment(url, label) {
  document.getElementById("hrAttachViewModal")?.remove();
  const m = document.createElement("div");
  m.id = "hrAttachViewModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:10px";
  const img = document.createElement("img");
  img.src = url; // src attribute ผ่าน DOM API — ไม่ inject HTML
  img.alt = label || "เอกสารแนบ";
  img.style.cssText = "max-width:95%;max-height:82vh;border-radius:10px;background:#fff;object-fit:contain";
  const cap = document.createElement("div");
  cap.textContent = label || "เอกสารแนบ"; // textContent = auto-escape
  cap.style.cssText = "color:#e2e8f0;font-size:13px";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕ ปิด";
  closeBtn.style.cssText = "padding:8px 22px;background:#fff;color:#0f172a;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700";
  closeBtn.addEventListener("click", () => m.remove());
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  m.append(img, cap, closeBtn);
  document.body.appendChild(m);
}

function _statusChip(status) {
  const st = APP_STATUS[status] || { label: String(status || "-"), color: "#475569", bg: "#f1f5f9" };
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;color:${st.color};background:${st.bg}">${escHtml(st.label)}</span>`;
}

function _thumbsHtml(attachments) {
  if (!attachments.length) return "";
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    ${attachments.map((at, i) => `
      <button type="button" class="hr-attach-thumb" data-idx="${i}" title="${escHtml(at.label)}"
        style="padding:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;cursor:zoom-in;background:#f8fafc;width:54px;height:54px">
        <img src="${escHtml(at.url)}" alt="${escHtml(at.label)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" />
      </button>`).join("")}
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  PAGE 1 — รับสมัครงาน (hr_applications)
// ═══════════════════════════════════════════════════════════

export async function renderHrApplicationsPage(ctx) {
  const { requireAdmin } = ctx;
  const container = document.getElementById("page-hr_applications");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "", retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });
  const cfg = window.SUPABASE_CONFIG;

  try {
    const res = await fetch(cfg.url + "/rest/v1/staff_applications?select=*&order=id.desc", { headers: _sbHeaders() });
    if (!res.ok) {
      const isAuth = res.status === 401 || res.status === 403;
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + res.status + ")" : "ตาราง staff_applications ยังไม่มีในฐานข้อมูล",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่" : "รัน supabase-phase420-hr-forms.sql ใน Supabase SQL Editor ก่อน (HTTP " + res.status + ")",
        retryLabel: "ลองโหลดใหม่", retryId: "hrAppRetryBtn"
      });
      document.getElementById("hrAppRetryBtn")?.addEventListener("click", () => renderHrApplicationsPage(ctx));
      return;
    }
    _apps = await res.json();
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ", detail: e?.message || String(e),
      retryLabel: "ลองใหม่", retryId: "hrAppRetryBtn"
    });
    document.getElementById("hrAppRetryBtn")?.addEventListener("click", () => renderHrApplicationsPage(ctx));
    return;
  }

  const chips = [
    ["all", "ทั้งหมด"], ["new", "ใหม่"], ["interview", "นัดสัมภาษณ์"], ["hired", "รับแล้ว"], ["rejected", "ไม่รับ"],
  ];
  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#e0f2fe,#fef9c3);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📝</div>
        <h2 style="margin:0 0 4px;color:#0f172a">รับสมัครงาน</h2>
        <p style="margin:0;color:#475569;font-size:13px">บันทึกผู้สมัคร + แนบรูปเอกสาร + พิมพ์ฟอร์ม — รับแล้วต้องไปสร้างบัญชีผู้ใช้เองที่ ตั้งค่า</p>
      </div>

      <div class="panel" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid #f1f5f9">
          <div style="font-weight:700;color:#0f172a">ผู้สมัครทั้งหมด (${_apps.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="hrAppPrintBlankBtn" class="btn light" style="font-size:13px">🖨️ พิมพ์ฟอร์มเปล่า</button>
            <button id="hrAppAddBtn" class="btn primary" style="font-size:13px">+ เพิ่มผู้สมัคร</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-bottom:1px solid #f1f5f9">
          ${chips.map(([key, label]) => `
            <button type="button" class="hr-app-chip" data-status="${key}"
              style="padding:5px 12px;border-radius:999px;border:1px solid ${_appFilter === key ? "#0284c7" : "#cbd5e1"};background:${_appFilter === key ? "#e0f2fe" : "#fff"};color:${_appFilter === key ? "#0369a1" : "#475569"};font-size:12px;font-weight:700;cursor:pointer">${label}</button>`).join("")}
          <input id="hrAppSearch" type="search" value="${escHtml(_appSearch)}" placeholder="ค้นหา ชื่อ / เบอร์ / ตำแหน่ง"
            style="flex:1;min-width:170px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
        </div>
        <div id="hrAppListBody"></div>
      </div>
    </div>`;

  const refreshList = () => {
    const body = document.getElementById("hrAppListBody");
    if (body) body.innerHTML = _appListBodyHtml(ctx);
    _bindAppRows(ctx);
  };
  refreshList();

  document.getElementById("hrAppAddBtn")?.addEventListener("click", () => _openAppModal(ctx, null));
  document.getElementById("hrAppPrintBlankBtn")?.addEventListener("click", () => {
    const store = ctx.state?.storeInfo || {};
    _openPrintWindow(ctx, buildBlankApplicationFormHtml(store), "เปิดหน้าพิมพ์ฟอร์มใบสมัครเปล่า");
  });
  container.querySelectorAll(".hr-app-chip").forEach(btn => btn.addEventListener("click", () => {
    _appFilter = btn.dataset.status || "all";
    container.querySelectorAll(".hr-app-chip").forEach(b => {
      const act = b.dataset.status === _appFilter;
      b.style.border = `1px solid ${act ? "#0284c7" : "#cbd5e1"}`;
      b.style.background = act ? "#e0f2fe" : "#fff";
      b.style.color = act ? "#0369a1" : "#475569";
    });
    refreshList();
  }));
  document.getElementById("hrAppSearch")?.addEventListener("input", (e) => {
    _appSearch = e.target.value || "";
    refreshList(); // re-render เฉพาะ list body — focus ของ input คงอยู่
  });
}

function _appListBodyHtml(_ctx) {
  const rows = filterApplications(_apps, { status: _appFilter, search: _appSearch });
  if (!_apps.length) {
    return renderEmpty({ icon: "📝", title: "ยังไม่มีผู้สมัคร", message: "กด + เพิ่มผู้สมัคร เพื่อบันทึกคนแรก", actionLabel: "", actionId: "" });
  }
  if (!rows.length) {
    return `<div style="padding:26px;text-align:center;color:#94a3b8;font-size:13px">ไม่พบผู้สมัครตามตัวกรอง/คำค้นนี้</div>`;
  }
  return rows.map(a => {
    const attachments = normalizeAttachments(a.attachments);
    return `
    <div class="hr-app-row" data-id="${a.id}" style="padding:12px 14px;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0">
          <div style="font-weight:700;color:#0f172a">${escHtml(a.full_name || "-")} ${_statusChip(a.status)}</div>
          <div style="font-size:12px;color:#475569;margin-top:3px">
            ${a.position ? "ตำแหน่ง " + escHtml(a.position) + " · " : ""}${a.phone ? "โทร " + escHtml(a.phone) + " · " : ""}สมัคร ${escHtml(formatDateDmTh(a.applied_date))}
            ${a.expected_salary != null && a.expected_salary !== "" ? " · คาดหวัง " + escHtml(formatNumber(a.expected_salary)) + " บ." : ""}
            ${a.hired_date ? ` · <span style="color:#15803d;font-weight:700">เริ่มงาน ${escHtml(formatDateDmTh(a.hired_date))}</span>` : ""}
          </div>
          ${a.note ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px">📝 ${escHtml(a.note)}</div>` : ""}
          ${_thumbsHtml(attachments)}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select class="hr-app-status-sel" data-id="${a.id}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">
            ${Object.entries(APP_STATUS).map(([k, v]) => `<option value="${k}" ${String(a.status) === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
          <button class="btn light hr-app-edit-btn" data-id="${a.id}" style="padding:6px 10px;font-size:12px">แก้ไข</button>
          <button class="btn light hr-app-print-btn" data-id="${a.id}" style="padding:6px 10px;font-size:12px">🖨️ พิมพ์</button>
          <button class="hr-app-del-btn" data-id="${a.id}" data-name="${escHtml(a.full_name || "-")}" style="padding:6px 10px;font-size:12px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;cursor:pointer">ลบ</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function _bindAppRows(ctx) {
  const body = document.getElementById("hrAppListBody");
  if (!body) return;
  body.querySelectorAll(".hr-app-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const a = _apps.find(x => String(x.id) === String(btn.dataset.id));
    if (a) _openAppModal(ctx, a);
  }));
  body.querySelectorAll(".hr-app-print-btn").forEach(btn => btn.addEventListener("click", () => {
    const a = _apps.find(x => String(x.id) === String(btn.dataset.id));
    if (!a) return;
    const store = ctx.state?.storeInfo || {};
    _openPrintWindow(ctx, buildApplicationPrintHtml(a, { store }), "เปิดหน้าพิมพ์ใบสมัครของ " + (a.full_name || "-"));
  }));
  body.querySelectorAll(".hr-app-del-btn").forEach(btn => btn.addEventListener("click", () => _deleteApplication(ctx, btn.dataset.id, btn.dataset.name)));
  body.querySelectorAll(".hr-app-status-sel").forEach(sel => sel.addEventListener("change", () => _changeAppStatus(ctx, sel.dataset.id, sel.value)));
  body.querySelectorAll(".hr-app-row").forEach(row => {
    const a = _apps.find(x => String(x.id) === String(row.dataset.id));
    const attachments = normalizeAttachments(a?.attachments);
    row.querySelectorAll(".hr-attach-thumb").forEach(t => t.addEventListener("click", () => {
      const at = attachments[Number(t.dataset.idx)];
      if (at) _viewAttachment(at.url, at.label);
    }));
  });
}

function _openAppModal(ctx, app) {
  document.getElementById("hrAppModal")?.remove();
  const isEdit = !!app;
  _pendingAttachments = normalizeAttachments(app?.attachments);
  const m = document.createElement("div");
  m.id = "hrAppModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:520px;width:100%;padding:22px;max-height:92vh;overflow:auto">
      <h3 style="margin:0 0 14px;font-size:17px;color:#0f172a">${isEdit ? "✏️ แก้ไขผู้สมัคร" : "+ เพิ่มผู้สมัคร"}</h3>
      <div style="display:grid;gap:10px">
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ชื่อ-นามสกุล *</div>
          <input id="hrAppName" type="text" maxlength="120" value="${escHtml(app?.full_name || "")}" placeholder="เช่น สมชาย ใจดี" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เบอร์โทรศัพท์</div>
            <input id="hrAppPhone" type="tel" maxlength="20" value="${escHtml(app?.phone || "")}" placeholder="08x-xxx-xxxx" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ตำแหน่งที่สมัคร</div>
            <input id="hrAppPosition" type="text" maxlength="80" value="${escHtml(app?.position || "")}" placeholder="เช่น ช่างแอร์" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
        </div>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ที่อยู่</div>
          <input id="hrAppAddress" type="text" maxlength="240" value="${escHtml(app?.address || "")}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เงินเดือนที่คาดหวัง (บาท)</div>
            <input id="hrAppSalary" type="number" min="0" step="1" value="${app?.expected_salary != null ? escHtml(String(app.expected_salary)) : ""}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">วันที่สมัคร</div>
            <input id="hrAppDate" type="date" value="${escHtml(app?.applied_date || todayBkk())}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
        </div>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">ประสบการณ์ / ประวัติการทำงาน</div>
          <textarea id="hrAppExp" rows="3" maxlength="2000" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical">${escHtml(app?.experience || "")}</textarea>
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">หมายเหตุ</div>
          <input id="hrAppNote" type="text" maxlength="300" value="${escHtml(app?.note || "")}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <div>
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">รูปเอกสารแนบ (บัตร ปชช. / เรซูเม่ ฯลฯ — แนบได้หลายรูป)</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="hrAppAttachLabel" style="padding:7px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">
              ${ATTACH_LABELS.map(l => `<option value="${l}">${l}</option>`).join("")}
            </select>
            <button id="hrAppAttachBtn" type="button" class="btn light" style="font-size:12px">📷 แนบรูป</button>
            <input id="hrAppAttachInput" type="file" accept="image/*" multiple style="display:none" />
            <span id="hrAppAttachStatus" style="font-size:11px;color:#0369a1"></span>
          </div>
          <div id="hrAppAttachList" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"></div>
        </div>
      </div>
      <div id="hrAppModalStatus" style="margin-top:10px;font-size:12px;color:#dc2626;min-height:14px"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button id="hrAppModalCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
        <button id="hrAppModalSave" type="button" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">${isEdit ? "💾 บันทึก" : "+ เพิ่มผู้สมัคร"}</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("hrAppModalCancel")?.addEventListener("click", () => m.remove());
  document.getElementById("hrAppModalSave")?.addEventListener("click", () => _saveApplication(ctx, app));
  document.getElementById("hrAppAttachBtn")?.addEventListener("click", () => document.getElementById("hrAppAttachInput")?.click());
  document.getElementById("hrAppAttachInput")?.addEventListener("change", (e) => _uploadAttachments(ctx, e.target));
  _renderPendingAttachList();
  setTimeout(() => document.getElementById("hrAppName")?.focus(), 50);
}

function _renderPendingAttachList() {
  const list = document.getElementById("hrAppAttachList");
  if (!list) return;
  list.innerHTML = _pendingAttachments.map((at, i) => `
    <div style="position:relative;width:62px">
      <button type="button" class="hr-pend-view" data-idx="${i}" title="${escHtml(at.label)}"
        style="padding:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;cursor:zoom-in;background:#f8fafc;width:62px;height:62px">
        <img src="${escHtml(at.url)}" alt="${escHtml(at.label)}" style="width:100%;height:100%;object-fit:cover" />
      </button>
      <button type="button" class="hr-pend-remove" data-idx="${i}" title="เอารูปออก"
        style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#dc2626;color:#fff;font-size:11px;line-height:1;cursor:pointer">✕</button>
      <div style="font-size:10px;color:#475569;text-align:center;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(at.label)}</div>
    </div>`).join("");
  list.querySelectorAll(".hr-pend-view").forEach(b => b.addEventListener("click", () => {
    const at = _pendingAttachments[Number(b.dataset.idx)];
    if (at) _viewAttachment(at.url, at.label);
  }));
  list.querySelectorAll(".hr-pend-remove").forEach(b => b.addEventListener("click", () => {
    _pendingAttachments.splice(Number(b.dataset.idx), 1);
    _renderPendingAttachList();
  }));
}

// upload รูปเข้า Supabase storage bucket `proofs` path applications/
// (pattern เดียวกับรูปบิลรายจ่ายใน expenses.js — ไม่มี base64 fallback:
//  upload ล้ม → แจ้ง error ตรง ๆ ไม่ยัด base64 ลง jsonb ให้ row บวม)
async function _uploadAttachments(ctx, inputEl) {
  const files = Array.from(inputEl?.files || []);
  if (!files.length) return;
  if (_appUploadInflight) { ctx.showToast?.("กำลังอัปโหลดรูปอยู่ — รอสักครู่"); return; }
  _appUploadInflight = true;
  const statusEl = document.getElementById("hrAppAttachStatus");
  const label = document.getElementById("hrAppAttachLabel")?.value || "เอกสารแนบ";
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  let okCount = 0, failCount = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      if (statusEl) statusEl.textContent = `📤 กำลังอัปโหลด ${i + 1}/${files.length}...`;
      let file = files[i];
      try {
        if (window._compressImage) file = await window._compressImage(file);
        const ts = Date.now();
        const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
        const filePath = `applications/${ts}_${Math.random().toString(36).slice(2)}.${ext}`;
        const uploadRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
          method: "POST",
          headers: {
            "apikey": cfg.anonKey,
            "Authorization": `Bearer ${token}`,
            "Content-Type": file.type || "image/jpeg",
            "x-upsert": "true"
          },
          body: file
        });
        if (!uploadRes.ok) throw new Error("HTTP " + uploadRes.status);
        _pendingAttachments.push({ url: `${cfg.url}/storage/v1/object/public/proofs/${filePath}`, label });
        okCount++;
      } catch (err) {
        console.warn("hr_forms attachment upload failed:", err);
        failCount++;
      }
    }
  } finally {
    _appUploadInflight = false;
    if (inputEl) inputEl.value = ""; // เลือกไฟล์เดิมซ้ำได้
  }
  if (statusEl) statusEl.textContent = failCount ? `⚠️ สำเร็จ ${okCount} / ล้มเหลว ${failCount}` : (okCount ? `✅ อัปโหลดแล้ว ${okCount} รูป` : "");
  if (failCount) ctx.showToast?.(`อัปโหลดรูปไม่สำเร็จ ${failCount} รูป — ลองใหม่อีกครั้ง`);
  _renderPendingAttachList();
}

async function _saveApplication(ctx, existing) {
  if (_appSaveInflight) { ctx.showToast?.("กำลังบันทึก..."); return; }
  const statusEl = document.getElementById("hrAppModalStatus");
  const setErr = (msg) => { if (statusEl) statusEl.textContent = msg; };
  setErr("");

  const full_name = (document.getElementById("hrAppName")?.value || "").trim();
  if (!full_name) { setErr("กรอกชื่อ-นามสกุลผู้สมัคร"); return; }
  if (_appUploadInflight) { setErr("รออัปโหลดรูปให้เสร็จก่อนบันทึก"); return; }
  const salaryRaw = (document.getElementById("hrAppSalary")?.value || "").trim();
  const payload = {
    full_name,
    phone: (document.getElementById("hrAppPhone")?.value || "").trim() || null,
    address: (document.getElementById("hrAppAddress")?.value || "").trim() || null,
    position: (document.getElementById("hrAppPosition")?.value || "").trim() || null,
    expected_salary: salaryRaw === "" ? null : Number(salaryRaw),
    experience: (document.getElementById("hrAppExp")?.value || "").trim() || null,
    applied_date: document.getElementById("hrAppDate")?.value || todayBkk(),
    note: (document.getElementById("hrAppNote")?.value || "").trim() || null,
    attachments: _pendingAttachments,
  };
  if (payload.expected_salary != null && !(payload.expected_salary >= 0)) { setErr("เงินเดือนที่คาดหวังไม่ถูกต้อง"); return; }
  if (!existing) payload.created_by = window.App?.state?.currentUser?.id || null;

  _appSaveInflight = true;
  const btn = document.getElementById("hrAppModalSave");
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "⏳ บันทึก..."; }
  const cfg = window.SUPABASE_CONFIG;
  const headers = _sbHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" });
  try {
    let resp;
    if (existing?.id) {
      resp = await fetch(cfg.url + "/rest/v1/staff_applications?id=eq." + existing.id, { method: "PATCH", headers, body: JSON.stringify(payload) });
    } else {
      resp = await fetch(cfg.url + "/rest/v1/staff_applications", { method: "POST", headers, body: JSON.stringify(payload) });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error("HTTP " + resp.status + " " + txt.slice(0, 180));
    }
    logActivity(existing ? "hr_application_update" : "hr_application_create", {
      entityType: "staff_applications",
      entityId: existing?.id || null,
      summary: `${existing ? "แก้ไข" : "เพิ่ม"}ผู้สมัคร ${full_name}${payload.position ? " (" + payload.position + ")" : ""} — เอกสารแนบ ${_pendingAttachments.length} รูป`,
    });
    document.getElementById("hrAppModal")?.remove();
    ctx.showToast?.(existing ? "แก้ไขผู้สมัครแล้ว" : "เพิ่มผู้สมัครแล้ว");
    renderHrApplicationsPage(ctx);
  } catch (e) {
    setErr(e.message || String(e));
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  } finally {
    _appSaveInflight = false;
  }
}

async function _changeAppStatus(ctx, id, newStatus) {
  const a = _apps.find(x => String(x.id) === String(id));
  if (!a || !APP_STATUS[newStatus]) return;
  if (String(a.status) === String(newStatus)) return;
  const payload = { status: newStatus };
  // รับเข้าทำงาน → ติด hired_date วันนี้ (Bangkok); ออกจากสถานะ hired → ล้างวันที่
  if (newStatus === "hired") payload.hired_date = todayBkk();
  else if (a.status === "hired") payload.hired_date = null;

  const cfg = window.SUPABASE_CONFIG;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_applications?id=eq." + a.id, {
      method: "PATCH",
      headers: _sbHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    logActivity("hr_application_status", {
      entityType: "staff_applications", entityId: a.id,
      summary: `เปลี่ยนสถานะผู้สมัคร ${a.full_name || a.id}: ${a.status} → ${newStatus}`,
      metadata: { from: a.status, to: newStatus, hired_date: payload.hired_date ?? null },
    });
    a.status = newStatus;
    if ("hired_date" in payload) a.hired_date = payload.hired_date;
    ctx.showToast?.(`เปลี่ยนสถานะเป็น "${APP_STATUS[newStatus].label}" แล้ว`);
    if (newStatus === "hired") {
      // สเปก owner: ❌ ห้าม auto-สร้างบัญชีผู้ใช้ — เตือนให้แอดมินไปสร้างเอง
      _showInfoModal("✅ รับเข้าทำงานแล้ว", `บันทึกวันที่เริ่มงาน ${escHtml(formatDateDmTh(payload.hired_date))} แล้ว<br><br>
        <strong>⚠️ อย่าลืมสร้างบัญชีผู้ใช้พนักงานใหม่ที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน</strong><br>
        ระบบไม่สร้างบัญชีให้อัตโนมัติ — ผู้สมัครจะยังเข้าระบบไม่ได้จนกว่าจะสร้างบัญชี`);
    }
    const body = document.getElementById("hrAppListBody");
    if (body) { body.innerHTML = _appListBodyHtml(ctx); _bindAppRows(ctx); }
  } catch (e) {
    ctx.showToast?.("เปลี่ยนสถานะไม่สำเร็จ: " + (e.message || e));
    const body = document.getElementById("hrAppListBody");
    if (body) { body.innerHTML = _appListBodyHtml(ctx); _bindAppRows(ctx); } // คืน select เป็นค่าจริง
  }
}

async function _deleteApplication(ctx, id, name) {
  if (!(await window.App?.confirm?.(`ลบผู้สมัคร "${name}" ?\nรูปเอกสารแนบใน storage จะยังอยู่ (ลบเฉพาะรายการ)`))) return;
  const cfg = window.SUPABASE_CONFIG;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_applications?id=eq." + id, {
      method: "DELETE",
      headers: _sbHeaders({ "Prefer": "return=representation" })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    logActivity("hr_application_delete", {
      entityType: "staff_applications", entityId: id,
      summary: `ลบผู้สมัคร ${name}`,
    });
    ctx.showToast?.("ลบผู้สมัครแล้ว");
    renderHrApplicationsPage(ctx);
  } catch (e) {
    ctx.showToast?.("ลบไม่สำเร็จ: " + (e.message || e));
  }
}

// ═══════════════════════════════════════════════════════════
//  PAGE 2 — ใบลาออก (hr_resignations)
// ═══════════════════════════════════════════════════════════

export async function renderHrResignationsPage(ctx) {
  const { requireAdmin } = ctx;
  const container = document.getElementById("page-hr_resignations");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "", retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "table", count: 3 });
  const cfg = window.SUPABASE_CONFIG;

  try {
    // profiles = GET read-only เท่านั้น (lookup ชื่อ + dropdown) — ❌ ห้ามเขียนกลับ
    const [rRes, pRes] = await Promise.all([
      fetch(cfg.url + "/rest/v1/staff_resignations?select=*&order=id.desc", { headers: _sbHeaders() }),
      fetch(cfg.url + "/rest/v1/profiles?select=id,full_name,role&order=full_name.asc", { headers: _sbHeaders() }),
    ]);
    if (!rRes.ok) {
      const isAuth = rRes.status === 401 || rRes.status === 403;
      container.innerHTML = renderError({
        message: isAuth ? "ไม่มีสิทธิ์เข้าถึง (HTTP " + rRes.status + ")" : "ตาราง staff_resignations ยังไม่มีในฐานข้อมูล",
        detail: isAuth ? "Token หมดอายุ — กรุณา Logout แล้ว Login ใหม่" : "รัน supabase-phase420-hr-forms.sql ใน Supabase SQL Editor ก่อน (HTTP " + rRes.status + ")",
        retryLabel: "ลองโหลดใหม่", retryId: "hrResigRetryBtn"
      });
      document.getElementById("hrResigRetryBtn")?.addEventListener("click", () => renderHrResignationsPage(ctx));
      return;
    }
    _resigs = await rRes.json();
    const allProfiles = pRes.ok ? await pRes.json() : [];
    // พนักงานเท่านั้น (role != customer) — pattern เดียวกับหน้าเงินเดือน
    _staffProfiles = allProfiles.filter(p => p.role !== "customer");
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ", detail: e?.message || String(e),
      retryLabel: "ลองใหม่", retryId: "hrResigRetryBtn"
    });
    document.getElementById("hrResigRetryBtn")?.addEventListener("click", () => renderHrResignationsPage(ctx));
    return;
  }

  const empName = (id) => _staffProfiles.find(p => String(p.id) === String(id))?.full_name || "(ไม่พบชื่อพนักงาน)";
  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fee2e2,#e0f2fe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📤</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ใบลาออก</h2>
        <p style="margin:0;color:#475569;font-size:13px">บันทึก + อนุมัติ + พิมพ์เอกสาร — อนุมัติแล้วระบบไม่ตัดพนักงานออกอัตโนมัติ ต้องไปปิดสถานะเองที่ ตั้งค่า → ผู้ใช้งาน</p>
      </div>

      <div class="panel" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid #f1f5f9">
          <div style="font-weight:700;color:#0f172a">ใบลาออกทั้งหมด (${_resigs.length})</div>
          <button id="hrResigAddBtn" class="btn primary" style="font-size:13px">+ บันทึกใบลาออก</button>
        </div>
        <div id="hrResigListBody">
          ${_resigs.length === 0 ? renderEmpty({ icon: "📤", title: "ยังไม่มีใบลาออก", message: "กด + บันทึกใบลาออก เมื่อมีพนักงานยื่นลาออก", actionLabel: "", actionId: "" })
          : _resigs.map(r => {
            const name = empName(r.employee_id);
            const approved = r.status === "approved";
            return `
            <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
                <div style="min-width:0">
                  <div style="font-weight:700;color:#0f172a">${escHtml(name)}
                    <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;color:${approved ? "#15803d" : "#9a3412"};background:${approved ? "#dcfce7" : "#ffedd5"}">${approved ? "อนุมัติแล้ว" : "รออนุมัติ"}</span>
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:3px">
                    ยื่น ${escHtml(formatDateDmTh(r.submitted_date))} · วันทำงานวันสุดท้าย <strong>${escHtml(formatDateDmTh(r.last_working_date))}</strong>
                    ${r.reason ? " · เหตุผล: " + escHtml(r.reason) : ""}
                  </div>
                  ${r.note ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px">📝 ${escHtml(r.note)}</div>` : ""}
                  ${approved ? `
                  <div style="margin-top:8px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:12px;color:#92400e">
                    ⚠️ พนักงานยังอยู่ในรายชื่อ active — ไปปิดสถานะที่ <strong>ตั้งค่า → ผู้ใช้งาน</strong> เมื่อถึงวันทำงานวันสุดท้าย (${escHtml(formatDateDmTh(r.last_working_date))})
                  </div>` : ""}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  ${!approved ? `<button class="hr-resig-approve-btn" data-id="${r.id}" style="padding:6px 12px;font-size:12px;background:#dcfce7;color:#15803d;border:none;border-radius:8px;cursor:pointer;font-weight:700">✓ อนุมัติ</button>` : ""}
                  <button class="btn light hr-resig-print-btn" data-id="${r.id}" style="padding:6px 10px;font-size:12px">🖨️ พิมพ์</button>
                  <button class="hr-resig-del-btn" data-id="${r.id}" data-name="${escHtml(name)}" style="padding:6px 10px;font-size:12px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;cursor:pointer">ลบ</button>
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>`;

  document.getElementById("hrResigAddBtn")?.addEventListener("click", () => _openResigModal(ctx));
  container.querySelectorAll(".hr-resig-approve-btn").forEach(btn => btn.addEventListener("click", () => _approveResignation(ctx, btn.dataset.id)));
  container.querySelectorAll(".hr-resig-print-btn").forEach(btn => btn.addEventListener("click", () => {
    const r = _resigs.find(x => String(x.id) === String(btn.dataset.id));
    if (!r) return;
    const emp = _staffProfiles.find(p => String(p.id) === String(r.employee_id));
    const store = ctx.state?.storeInfo || {};
    _openPrintWindow(ctx, buildResignationPrintHtml(r, { emp, store }), "เปิดหน้าพิมพ์หนังสือลาออก");
  }));
  container.querySelectorAll(".hr-resig-del-btn").forEach(btn => btn.addEventListener("click", () => _deleteResignation(ctx, btn.dataset.id, btn.dataset.name)));
}

function _openResigModal(ctx) {
  document.getElementById("hrResigModal")?.remove();
  const m = document.createElement("div");
  m.id = "hrResigModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:14px";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:460px;width:100%;padding:22px;max-height:92vh;overflow:auto">
      <h3 style="margin:0 0 14px;font-size:17px;color:#0f172a">+ บันทึกใบลาออก</h3>
      <div style="display:grid;gap:10px">
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">พนักงาน *</div>
          <select id="hrResigEmp" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="">— เลือกพนักงาน —</option>
            ${_staffProfiles.map(p => `<option value="${escHtml(String(p.id))}">${escHtml(p.full_name || p.id)}</option>`).join("")}
          </select>
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">วันที่ยื่น *</div>
            <input id="hrResigSubmitted" type="date" value="${escHtml(todayBkk())}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
          <label style="display:block">
            <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">วันทำงานวันสุดท้าย *</div>
            <input id="hrResigLastDay" type="date" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </label>
        </div>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">เหตุผลการลาออก</div>
          <input id="hrResigReason" type="text" maxlength="200" placeholder="เช่น ย้ายภูมิลำเนา / ได้งานใหม่" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
        <label style="display:block">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px">หมายเหตุ</div>
          <input id="hrResigNote" type="text" maxlength="300" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        </label>
      </div>
      <div id="hrResigModalStatus" style="margin-top:10px;font-size:12px;color:#dc2626;min-height:14px"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button id="hrResigModalCancel" type="button" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">ยกเลิก</button>
        <button id="hrResigModalSave" type="button" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">💾 บันทึก</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  document.getElementById("hrResigModalCancel")?.addEventListener("click", () => m.remove());
  document.getElementById("hrResigModalSave")?.addEventListener("click", () => _saveResignation(ctx));
  setTimeout(() => document.getElementById("hrResigEmp")?.focus(), 50);
}

async function _saveResignation(ctx) {
  if (_resigSaveInflight) { ctx.showToast?.("กำลังบันทึก..."); return; }
  const statusEl = document.getElementById("hrResigModalStatus");
  const setErr = (msg) => { if (statusEl) statusEl.textContent = msg; };
  setErr("");

  const employee_id = document.getElementById("hrResigEmp")?.value || "";
  const submitted_date = document.getElementById("hrResigSubmitted")?.value || "";
  const last_working_date = document.getElementById("hrResigLastDay")?.value || "";
  if (!employee_id) { setErr("เลือกพนักงานที่ลาออก"); return; }
  if (!submitted_date) { setErr("กรอกวันที่ยื่นใบลาออก"); return; }
  if (!last_working_date) { setErr("กรอกวันทำงานวันสุดท้าย"); return; }
  if (last_working_date < submitted_date) { setErr("วันทำงานวันสุดท้ายต้องไม่ก่อนวันที่ยื่น"); return; }

  const payload = {
    employee_id,
    submitted_date,
    last_working_date,
    reason: (document.getElementById("hrResigReason")?.value || "").trim() || null,
    note: (document.getElementById("hrResigNote")?.value || "").trim() || null,
    status: "submitted",
    created_by: window.App?.state?.currentUser?.id || null,
  };

  _resigSaveInflight = true;
  const btn = document.getElementById("hrResigModalSave");
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "⏳ บันทึก..."; }
  const cfg = window.SUPABASE_CONFIG;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_resignations", {
      method: "POST",
      headers: _sbHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error("HTTP " + resp.status + " " + txt.slice(0, 180));
    }
    const empName = _staffProfiles.find(p => String(p.id) === String(employee_id))?.full_name || employee_id;
    logActivity("hr_resignation_create", {
      entityType: "staff_resignations", entityId: null,
      summary: `บันทึกใบลาออก ${empName} — วันสุดท้าย ${last_working_date}`,
      metadata: { employee_id, submitted_date, last_working_date },
    });
    document.getElementById("hrResigModal")?.remove();
    ctx.showToast?.("บันทึกใบลาออกแล้ว");
    renderHrResignationsPage(ctx);
  } catch (e) {
    setErr(e.message || String(e));
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  } finally {
    _resigSaveInflight = false;
  }
}

// อนุมัติใบลาออก — สเปก owner: ❌ ไม่ตัดพนักงานออกอัตโนมัติ (ห้าม PATCH profiles)
// → PATCH เฉพาะ staff_resignations + แสดงกล่องเตือนให้แอดมินไปปิดสถานะผู้ใช้เอง
async function _approveResignation(ctx, id) {
  const r = _resigs.find(x => String(x.id) === String(id));
  if (!r || r.status !== "submitted") return;
  const emp = _staffProfiles.find(p => String(p.id) === String(r.employee_id));
  const name = emp?.full_name || "(ไม่พบชื่อ)";
  const ok = await window.App?.confirm?.(
    `อนุมัติใบลาออกของ "${name}" ?\nวันทำงานวันสุดท้าย ${formatDateDmTh(r.last_working_date)}\n\n` +
    `ระบบจะไม่ตัดพนักงานออกอัตโนมัติ — ต้องไปปิดสถานะผู้ใช้เองที่ ตั้งค่า → ผู้ใช้งาน`
  );
  if (!ok) return;

  const cfg = window.SUPABASE_CONFIG;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_resignations?id=eq." + r.id, {
      method: "PATCH",
      headers: _sbHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" }),
      body: JSON.stringify({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: window.App?.state?.currentUser?.id || null,
      })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    logActivity("hr_resignation_approve", {
      entityType: "staff_resignations", entityId: r.id,
      summary: `อนุมัติใบลาออก ${name} — วันสุดท้าย ${r.last_working_date || "-"} (ไม่ตัดพนักงานอัตโนมัติ)`,
      metadata: { employee_id: r.employee_id, last_working_date: r.last_working_date },
    });
    ctx.showToast?.("อนุมัติใบลาออกแล้ว");
    // กล่องเตือนค้าง: แอดมินต้องไปปิดสถานะผู้ใช้เอง (banner ในแถว approved จะเตือนซ้ำทุกครั้งที่เปิดหน้า)
    _showInfoModal("✅ อนุมัติใบลาออกแล้ว", `<strong>${escHtml(name)}</strong> ยังอยู่ในรายชื่อพนักงาน active<br><br>
      ⚠️ ไปปิดสถานะที่ <strong>ตั้งค่า → ผู้ใช้งาน</strong> เมื่อถึงวันทำงานวันสุดท้าย (<strong>${escHtml(formatDateDmTh(r.last_working_date))}</strong>)<br>
      ระบบจะไม่ตัดพนักงานออกให้อัตโนมัติ`);
    renderHrResignationsPage(ctx);
  } catch (e) {
    ctx.showToast?.("อนุมัติไม่สำเร็จ: " + (e.message || e));
  }
}

async function _deleteResignation(ctx, id, name) {
  if (!(await window.App?.confirm?.(`ลบใบลาออกของ "${name}" ?`))) return;
  const cfg = window.SUPABASE_CONFIG;
  try {
    const resp = await fetch(cfg.url + "/rest/v1/staff_resignations?id=eq." + id, {
      method: "DELETE",
      headers: _sbHeaders({ "Prefer": "return=representation" })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    logActivity("hr_resignation_delete", {
      entityType: "staff_resignations", entityId: id,
      summary: `ลบใบลาออกของ ${name}`,
    });
    ctx.showToast?.("ลบใบลาออกแล้ว");
    renderHrResignationsPage(ctx);
  } catch (e) {
    ctx.showToast?.("ลบไม่สำเร็จ: " + (e.message || e));
  }
}
