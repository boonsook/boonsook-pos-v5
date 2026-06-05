// ═══════════════════════════════════════════════════════════
//  modules/time_clock.js — ลงเวลาเข้า-ออกงาน (Phase 92.22 + 92.22e)
//
//  Phase 92.22e: pivot จาก staff → profiles (auth.users)
//    - dropdown = state.allProfiles (filter role≠customer)
//    - clock-in stores user_id (auth.uid), ไม่ใช่ staff_id
//    - self-service ทำงานทันทีสำหรับ user ที่ login (ไม่ต้อง auto-claim email)
//
//  Role-based render (จาก state.profile.role):
//    - admin       → Manager view: dropdown ทุก user (admin/sales/technician)
//                    + active sessions card + history report + Export
//    - sales/tech  → Self-service view: ปุ่มเข้า/ออกของตัวเอง + week history
//
//  DB: ต้องรัน supabase-phase92-22e-use-profiles.sql ก่อนใช้
//      (ALTER staff_attendance: staff_id → user_id; RECREATE indexes/policies)
// ═══════════════════════════════════════════════════════════

import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml, exportToExcel, todaySuffix, logActivity } from "./utils.js";
// Phase 92.27: offline queue (IndexedDB-backed)
import * as OfflineQueue from "./_offline_queue.js";

const TZ = "Asia/Bangkok";

// role labels (mirror main.js ROLE_LABELS)
const ROLE_LABEL_TH = {
  admin:      "ผู้ดูแลระบบ",
  technician: "ช่าง",
  sales:      "พนักงานขาย",
  customer:   "ลูกค้า",
};

// ═══════════════════════════════════════════════════════════
//  Pure helpers (testable, no DOM/network)
// ═══════════════════════════════════════════════════════════

/**
 * คืน "วันที่ทำงาน" สำหรับ work_date ของ clock-in ใน Asia/Bangkok
 * @param {Date|string} [d] - default = now
 * @returns {string} YYYY-MM-DD
 */
export function workDateBangkok(d) {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * แปลง timestamp เป็น HH:mm (Asia/Bangkok) สำหรับแสดงผล
 * @param {string|Date|null} ts
 * @returns {string} "08:15" หรือ "-" ถ้า null/invalid
 */
export function timeBangkok(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return "-";
  try {
    return d.toLocaleTimeString("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit"
    });
  } catch { return "-"; }
}

/**
 * คำนวณชั่วโมงทำงานของ 1 record (ปัดเศษ 2 ตำแหน่ง)
 * @param {{clock_in_at:string|null, clock_out_at:string|null}} row
 * @returns {number} ชม. (0 ถ้ายังไม่ออก หรือ invalid)
 */
export function workHours(row) {
  if (!row?.clock_in_at || !row?.clock_out_at) return 0;
  const inMs  = new Date(row.clock_in_at).getTime();
  const outMs = new Date(row.clock_out_at).getTime();
  if (!isFinite(inMs) || !isFinite(outMs) || outMs <= inMs) return 0;
  return Math.round(((outMs - inMs) / 3600000) * 100) / 100;
}

/**
 * คำนวณแยก ชม. ปกติ + ชม. OT จาก 1 record (Phase 92.25)
 *
 * Rules (Boonsook กะมาตรฐาน 08:00-17:00):
 *   - ก่อน startHour (08:00) → OT
 *   - startHour - endHour (08:00-17:00) → ปกติ
 *   - หลัง endHour (17:00) → OT
 *
 * ★ ไม่หัก break เที่ยง — ระบบเก็บแค่ clock in/out, payroll จัดการแยก
 *
 * @param {{clock_in_at:string|null, clock_out_at:string|null, work_date?:string}} row
 * @param {object} [opts]
 * @param {number} [opts.startHour=8]
 * @param {number} [opts.endHour=17]
 * @returns {{regular:number, ot:number, total:number}} ชม. ปัด 2 ตำแหน่ง
 */
export function computeRegularOT(row, opts = {}) {
  const ZERO = { regular: 0, ot: 0, total: 0 };
  if (!row?.clock_in_at || !row?.clock_out_at) return ZERO;
  const inMs  = new Date(row.clock_in_at).getTime();
  const outMs = new Date(row.clock_out_at).getTime();
  if (!isFinite(inMs) || !isFinite(outMs) || outMs <= inMs) return ZERO;

  const startHour = Number.isFinite(opts.startHour) ? opts.startHour : 8;
  const endHour   = Number.isFinite(opts.endHour)   ? opts.endHour   : 17;

  // หา boundary 08:00 / 17:00 ของวันใน Asia/Bangkok (UTC+7 ตลอด ไม่มี DST)
  const workDate = row.work_date || workDateBangkok(row.clock_in_at);
  const startMs = _bangkokDateAtHour(workDate, startHour);
  const endMs   = _bangkokDateAtHour(workDate, endHour);

  // regular = overlap ของ [in,out] กับ [start,end]
  const regMs = Math.max(0, Math.min(outMs, endMs) - Math.max(inMs, startMs));
  // ot = ส่วนนอก [start,end] แต่ใน [in,out]
  const otBefore = Math.max(0, Math.min(outMs, startMs) - inMs);
  const otAfter  = Math.max(0, outMs - Math.max(inMs, endMs));
  const otMs = otBefore + otAfter;

  return {
    regular: Math.round((regMs / 3600000) * 100) / 100,
    ot:      Math.round((otMs  / 3600000) * 100) / 100,
    total:   Math.round(((regMs + otMs) / 3600000) * 100) / 100,
  };
}

/** epoch ms ของ "workDate เวลา H:00:00 ใน Asia/Bangkok" (UTC+7 ตลอด) */
function _bangkokDateAtHour(workDate, hour) {
  const hh = String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0");
  return new Date(`${workDate}T${hh}:00:00+07:00`).getTime();
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.49: Attendance punctuality (มาสาย / ออกก่อนเวลา)
//  Pure + informational เท่านั้น — ไม่แตะ payroll / OT / leave
// ═══════════════════════════════════════════════════════════

/**
 * อ่านกฎเวลาเข้างานจาก state.storeInfo (Phase 92.49)
 * เก็บใน storeInfo pattern เดิม (เหมือน shiftStartHour/geofenceRadiusM) — ไม่มี schema change
 * @param {object} state
 * @returns {{lateGraceMinutes:number, earlyLeaveGraceMinutes:number}}
 *   default 15 / 15 นาที ถ้ายังไม่ตั้งใน Settings
 */
export function attendanceRulesFromState(state) {
  const info = state?.storeInfo || {};
  const lateRaw  = Number(info.lateGraceMinutes);
  const earlyRaw = Number(info.earlyLeaveGraceMinutes);
  const lateGraceMinutes      = (Number.isFinite(lateRaw)  && lateRaw  >= 0) ? Math.floor(lateRaw)  : 15;
  const earlyLeaveGraceMinutes = (Number.isFinite(earlyRaw) && earlyRaw >= 0) ? Math.floor(earlyRaw) : 15;
  return { lateGraceMinutes, earlyLeaveGraceMinutes };
}

/**
 * จัดประเภทความตรงต่อเวลาของ attendance row 1 รายการ (Phase 92.49)
 *
 * เทียบ clock_in_at กับเวลาเริ่มกะ + clock_out_at กับเวลาเลิกกะ ของ work_date
 * ใน Asia/Bangkok (UTC+7 ตลอด ไม่มี DST) — ไม่ใช้ UTC toISOString ทำ business date
 *
 * lateMinutes / earlyLeaveMinutes คืนค่า "ดิบ" (นาทีหลังเริ่มกะ / ก่อนเลิกกะ)
 * เสมอเมื่อคำนวณได้ ส่วน status ตัดสินด้วย grace (เกิน grace ถึงนับเป็นสาย/ออกก่อน)
 *
 * @param {{clock_in_at:string|null, clock_out_at:string|null, work_date?:string}|null} row
 * @param {{startHour:number, endHour:number}} shift - เช่นผลจาก shiftHoursFromState()
 * @param {object} [opts]
 * @param {number} [opts.lateGraceMinutes=15]
 * @param {number} [opts.earlyLeaveGraceMinutes=15]
 * @returns {{status:"on_time"|"late"|"early_leave"|"late_and_early_leave"|"missing_clock_out"|"none", lateMinutes:number, earlyLeaveMinutes:number}}
 */
export function classifyPunctuality(row, shift, opts = {}) {
  const NONE = { status: "none", lateMinutes: 0, earlyLeaveMinutes: 0 };
  if (!row || !row.clock_in_at) return NONE;

  const startHour = Number(shift?.startHour);
  const endHour   = Number(shift?.endHour);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return NONE;

  const inMs = new Date(row.clock_in_at).getTime();
  if (!Number.isFinite(inMs)) return NONE;

  const workDate = row.work_date || workDateBangkok(row.clock_in_at);
  const startMs = _bangkokDateAtHour(workDate, startHour);
  const endMs   = _bangkokDateAtHour(workDate, endHour);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return NONE;

  const lateGrace  = (Number.isFinite(opts.lateGraceMinutes)      && opts.lateGraceMinutes      >= 0) ? opts.lateGraceMinutes      : 15;
  const earlyGrace = (Number.isFinite(opts.earlyLeaveGraceMinutes) && opts.earlyLeaveGraceMinutes >= 0) ? opts.earlyLeaveGraceMinutes : 15;

  const lateMinutes = Math.max(0, Math.round((inMs - startMs) / 60000));

  // ยังไม่ลงเวลาออก → รายงาน lateMinutes ได้ แต่ตัดสิน early ไม่ได้
  if (!row.clock_out_at) {
    return { status: "missing_clock_out", lateMinutes, earlyLeaveMinutes: 0 };
  }

  const outMs = new Date(row.clock_out_at).getTime();
  if (!Number.isFinite(outMs)) {
    return { status: "missing_clock_out", lateMinutes, earlyLeaveMinutes: 0 };
  }

  const earlyLeaveMinutes = Math.max(0, Math.round((endMs - outMs) / 60000));

  const isLate  = lateMinutes  > lateGrace;
  const isEarly = earlyLeaveMinutes > earlyGrace;

  let status;
  if (isLate && isEarly)      status = "late_and_early_leave";
  else if (isLate)            status = "late";
  else if (isEarly)           status = "early_leave";
  else                        status = "on_time";

  return { status, lateMinutes, earlyLeaveMinutes };
}

/**
 * meta สำหรับ chip แสดงสถานะ punctuality (Phase 92.49) — pure, label ภาษาไทย
 * @param {{status:string, lateMinutes?:number, earlyLeaveMinutes?:number}|null} punc
 * @returns {{label:string, bg:string, fg:string, border:string}|null}
 *   null ถ้า status = none/unknown (ไม่ต้องแสดง chip)
 */
export function punctualityChipMeta(punc) {
  const p = punc || {};
  const lm = Number(p.lateMinutes) || 0;
  const em = Number(p.earlyLeaveMinutes) || 0;
  switch (p.status) {
    case "on_time":
      return { label: "ตรงเวลา", bg: "#dcfce7", fg: "#166534", border: "#86efac" };
    case "late":
      return { label: `มาสาย ${lm} นาที`, bg: "#fef3c7", fg: "#92400e", border: "#fde68a" };
    case "early_leave":
      return { label: `ออกก่อน ${em} นาที`, bg: "#fef3c7", fg: "#92400e", border: "#fde68a" };
    case "late_and_early_leave":
      return { label: `สาย ${lm} น. + ออกก่อน ${em} น.`, bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
    case "missing_clock_out":
      return { label: "ยังไม่ลงเวลาออก", bg: "#e0e7ff", fg: "#3730a3", border: "#c7d2fe" };
    default:
      return null;
  }
}

/**
 * สรุปความตรงต่อเวลาจาก attendance rows หลายรายการในช่วงเวลา (Phase 92.51)
 * นับเป็นจำนวน "ครั้ง" (1 row = 1 วันทำงานปกติ) + รวมนาที — informational
 * @param {Array<object>} rows
 * @param {{startHour:number, endHour:number}} shift
 * @param {object} [opts] - {lateGraceMinutes, earlyLeaveGraceMinutes}
 * @returns {{total:number, onTime:number, late:number, earlyLeave:number, lateAndEarly:number, missingClockOut:number, none:number, totalLateMinutes:number, totalEarlyLeaveMinutes:number}}
 */
export function summarizePunctuality(rows, shift, opts = {}) {
  const acc = {
    total: 0, onTime: 0, late: 0, earlyLeave: 0, lateAndEarly: 0,
    missingClockOut: 0, none: 0, totalLateMinutes: 0, totalEarlyLeaveMinutes: 0,
  };
  if (!Array.isArray(rows)) return acc;
  for (const r of rows) {
    const p = classifyPunctuality(r, shift, opts);
    acc.total += 1;
    switch (p.status) {
      case "on_time":              acc.onTime += 1; break;
      case "late":                 acc.late += 1; break;
      case "early_leave":          acc.earlyLeave += 1; break;
      case "late_and_early_leave": acc.lateAndEarly += 1; break;
      case "missing_clock_out":    acc.missingClockOut += 1; break;
      default:                     acc.none += 1;
    }
    acc.totalLateMinutes      += Number(p.lateMinutes) || 0;
    acc.totalEarlyLeaveMinutes += Number(p.earlyLeaveMinutes) || 0;
  }
  return acc;
}

/**
 * Haversine distance ระหว่าง 2 จุด lat/lng (ผลลัพธ์เป็นเมตร) — Phase 92.24
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} ระยะทาง (เมตร) ปัด 0 ตำแหน่ง — 0 ถ้า input ผิด
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const n1 = Number(lat1), n2 = Number(lng1), n3 = Number(lat2), n4 = Number(lng2);
  if (![n1, n2, n3, n4].every(Number.isFinite)) return 0;
  const R = 6371000; // Earth radius (m)
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(n3 - n1);
  const dLng = toRad(n4 - n2);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(n1)) * Math.cos(toRad(n3)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/**
 * อ่าน geofence config จาก storeInfo — Phase 92.24
 * @returns {{lat:number|null, lng:number|null, radiusM:number}|null}
 *   - null ถ้าไม่มี shopLat/shopLng ตั้งไว้ (geo-fence ปิด)
 *   - radiusM default 200m ถ้าไม่ตั้ง
 */
export function geofenceFromState(state) {
  const info = state?.storeInfo || {};
  // ★ Number(null) = 0 (falsey not infinite-check), ต้องตรวจ explicit ก่อน
  if (info.shopLat == null || info.shopLng == null || info.shopLat === "" || info.shopLng === "") return null;
  const lat = Number(info.shopLat);
  const lng = Number(info.shopLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radiusRaw = Number(info.geofenceRadiusM);
  const radiusM = (Number.isFinite(radiusRaw) && radiusRaw > 0) ? radiusRaw : 200;
  return { lat, lng, radiusM };
}

/**
 * ขอ geolocation ปัจจุบัน (browser Geolocation API) — Phase 92.24
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=8000]
 * @returns {Promise<{lat:number, lng:number, accuracy:number}|null>} null ถ้า user ปฏิเสธ/ไม่รองรับ/timeout
 */
export async function getCurrentPosition(opts = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000;
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0),
        });
      },
      () => { clearTimeout(timer); finish(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/**
 * State ของ session ปัจจุบันจาก list rows (เรียงใหม่ → เก่า)
 * @returns {"open"|"closed"|"none"}
 */
export function clockState(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "none";
  const latest = rows[0];
  if (latest && latest.clock_out_at == null) return "open";
  return "closed";
}

/**
 * Sum ชั่วโมงทั้งหมดจาก rows (ใช้กับ week summary)
 */
export function sumWorkHours(rows) {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const r of rows) total += workHours(r);
  return Math.round(total * 100) / 100;
}

/**
 * Aggregate regular + OT จาก rows (Phase 92.25)
 * @returns {{regular:number, ot:number, total:number}}
 */
export function sumRegularOT(rows, opts) {
  const acc = { regular: 0, ot: 0, total: 0 };
  if (!Array.isArray(rows)) return acc;
  for (const r of rows) {
    const x = computeRegularOT(r, opts);
    acc.regular += x.regular;
    acc.ot      += x.ot;
    acc.total   += x.total;
  }
  return {
    regular: Math.round(acc.regular * 100) / 100,
    ot:      Math.round(acc.ot      * 100) / 100,
    total:   Math.round(acc.total   * 100) / 100,
  };
}

/**
 * แสดงชื่อ user เป็น display name — full_name > email prefix > "ผู้ใช้ใหม่"
 * (mirror logic จาก modules/settings/users.js สำหรับ consistency)
 * @param {{full_name?:string|null, email?:string|null}} profile
 * @returns {string}
 */
export function profileDisplayName(profile) {
  if (!profile) return "—";
  if (profile.full_name && String(profile.full_name).trim()) return String(profile.full_name).trim();
  if (profile.email) return String(profile.email).split("@")[0];
  return "ผู้ใช้ใหม่";
}

// ═══════════════════════════════════════════════════════════
//  REST helpers (Supabase PostgREST)
// ═══════════════════════════════════════════════════════════

function _sbHeaders() {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg?.anonKey;
  return {
    apikey: cfg?.anonKey,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

/**
 * คืน list of profiles ที่ทำงานในร้าน (filter ลูกค้าออก)
 * Phase 92.27b: ลบ assumption ว่า state.allProfiles loaded — โหลดเองถ้าว่าง
 */
function _staffProfiles(state) {
  return (state?.allProfiles || []).filter(p => p && p.role && p.role !== "customer");
}

/**
 * Phase 92.27b: ensure state.allProfiles loaded — เพราะ loadUsers() ใน main.js
 * trigger เฉพาะตอนเปิด Settings → ตั้งค่าผู้ใช้งาน. Time Clock ต้องโหลดเอง
 * ถ้าไม่ได้ผ่านหน้านั้นมาก่อน. RLS จะ filter เองถ้า role ไม่มีสิทธิ์
 */
async function _ensureProfilesLoaded(state) {
  if (Array.isArray(state?.allProfiles) && state.allProfiles.length > 0) return;
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) return;
  // ลอง view ที่มี email ก่อน (ถ้ายังไม่ได้รัน SQL ใหม่ fallback profiles)
  try {
    let r = await fetch(`${cfg.url}/rest/v1/profiles_with_email?select=*&order=created_at`, {
      headers: _sbHeaders(),
    });
    if (!r.ok) {
      r = await fetch(`${cfg.url}/rest/v1/profiles?select=*&order=created_at`, {
        headers: _sbHeaders(),
      });
    }
    if (r.ok) {
      const data = await r.json();
      if (state) state.allProfiles = Array.isArray(data) ? data : [];
    }
  } catch (_e) {
    // silent — ถ้า fetch fail ใช้ array ว่างต่อ (UI จะแสดง "ยังไม่มีผู้ใช้")
  }
}

/**
 * อ่าน shift hours config จาก state.storeInfo (Phase 92.25b)
 * Default 08:00-17:00 ถ้ายังไม่ตั้งใน Settings
 * @param {object} state
 * @returns {{startHour:number, endHour:number}}
 */
export function shiftHoursFromState(state) {
  const info = state?.storeInfo || {};
  const startRaw = Number(info.shiftStartHour);
  const endRaw   = Number(info.shiftEndHour);
  const start = (Number.isFinite(startRaw) && startRaw >= 0 && startRaw <= 23) ? startRaw : 8;
  const end   = (Number.isFinite(endRaw)   && endRaw   >= 0 && endRaw   <= 23) ? endRaw   : 17;
  // ถ้า start >= end (ตั้งผิด/ยังไม่ตั้ง) → fallback 8/17 กัน computeRegularOT คำนวณพลาด
  return (start < end) ? { startHour: start, endHour: end } : { startHour: 8, endHour: 17 };
}

async function _fetchAttendance({ userId, fromDate, toDate, openOnly } = {}) {
  const cfg = window.SUPABASE_CONFIG;
  const parts = ["select=*", "order=clock_in_at.desc"];
  if (userId)   parts.push(`user_id=eq.${encodeURIComponent(userId)}`);
  if (fromDate) parts.push(`work_date=gte.${encodeURIComponent(fromDate)}`);
  if (toDate)   parts.push(`work_date=lte.${encodeURIComponent(toDate)}`);
  if (openOnly) parts.push(`clock_out_at=is.null`);
  parts.push("limit=500");
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?${parts.join("&")}`, {
    headers: _sbHeaders(),
  });
  if (!r.ok) {
    if (r.status === 404 || r.status === 400) {
      const err = new Error("NO_TABLE");
      err.code = "NO_TABLE";
      throw err;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

async function _insertClockIn({ userId, source = "admin", note, clientUuid, gps = null, geofence = null }) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const body = {
    user_id: userId,
    work_date: workDateBangkok(),
    source,
    notes: note || null,
  };
  // Phase 92.27: client_uuid เป็น idempotency key (สร้างเสมอ ใช้ทั้ง online + offline)
  body.client_uuid = clientUuid || OfflineQueue.generateClientUuid();
  // Phase 92.24: บันทึก GPS ถ้ามี + Haversine distance ถ้ามี geofence
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    body.clock_in_lat = gps.lat;
    body.clock_in_lng = gps.lng;
    if (geofence) {
      body.clock_in_distance_m = haversineMeters(geofence.lat, geofence.lng, gps.lat, gps.lng);
    }
  }
  try {
    const r = await fetch(`${cfg.url}/rest/v1/staff_attendance`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!r.ok) {
      if (r.status === 409) {
        const err = new Error("ALREADY_OPEN");
        err.code = "ALREADY_OPEN";
        throw err;
      }
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    return r.json();
  } catch (err) {
    // Phase 92.27: offline → enqueue + return queued mock
    if (OfflineQueue.isOfflineLike(err)) {
      try {
        await OfflineQueue.enqueue({ kind: "clockIn", payload: { body } });
        const queued = new Error("QUEUED");
        queued.code = "QUEUED";
        throw queued;
      } catch (e2) {
        if (e2?.code === "QUEUED") throw e2;
        // IDB ไม่พร้อม → throw original
      }
    }
    throw err;
  }
}

/**
 * Phase 92.26: ดึงสรุป attendance ของ user หนึ่งคนใน period (สำหรับ payroll integration)
 * @param {string} userId - auth.users.id
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate   - YYYY-MM-DD
 * @param {object} [shiftOpts] - {startHour, endHour}
 * @returns {Promise<{regular:number, ot:number, total:number, records:number, openCount:number}>}
 */
export async function fetchUserAttendanceSummary(userId, fromDate, toDate, shiftOpts) {
  if (!userId || !fromDate || !toDate) {
    return { regular: 0, ot: 0, total: 0, records: 0, openCount: 0 };
  }
  let rows;
  try {
    rows = await _fetchAttendance({ userId, fromDate, toDate });
  } catch (e) {
    if (e?.code === "NO_TABLE") {
      return { regular: 0, ot: 0, total: 0, records: 0, openCount: 0, error: "NO_TABLE" };
    }
    throw e;
  }
  const closed = rows.filter(r => r.clock_out_at != null);
  const openCount = rows.length - closed.length;
  const sum = sumRegularOT(closed, shiftOpts);
  return { ...sum, records: closed.length, openCount };
}

async function _patchClockOut({ id, gps = null, geofence = null }) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const patchBody = { clock_out_at: new Date().toISOString() };
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    patchBody.clock_out_lat = gps.lat;
    patchBody.clock_out_lng = gps.lng;
    if (geofence) {
      patchBody.clock_out_distance_m = haversineMeters(geofence.lat, geofence.lng, gps.lat, gps.lng);
    }
  }
  try {
    const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers, body: JSON.stringify(patchBody),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    return r.json();
  } catch (err) {
    if (OfflineQueue.isOfflineLike(err)) {
      try {
        await OfflineQueue.enqueue({ kind: "clockOut", payload: { id, body: patchBody } });
        const queued = new Error("QUEUED");
        queued.code = "QUEUED";
        throw queued;
      } catch (e2) {
        if (e2?.code === "QUEUED") throw e2;
      }
    }
    throw err;
  }
}

/**
 * Phase 92.27: drain queue → POST/PATCH ทุก item — เรียกตอน online กลับมา
 * @returns {Promise<{ok:number, fail:number}>}
 */
export async function syncOfflineQueue() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg) return { ok: 0, fail: 0 };
  let items;
  try { items = await OfflineQueue.listAll(); } catch { return { ok: 0, fail: 0 }; }
  let ok = 0, fail = 0;
  const headers = { ..._sbHeaders(), Prefer: "return=minimal" };
  for (const it of items) {
    try {
      let resp;
      if (it.kind === "clockIn") {
        resp = await fetch(`${cfg.url}/rest/v1/staff_attendance`, {
          method: "POST", headers, body: JSON.stringify(it.payload.body),
        });
      } else if (it.kind === "clockOut") {
        resp = await fetch(`${cfg.url}/rest/v1/staff_attendance?id=eq.${encodeURIComponent(it.payload.id)}`, {
          method: "PATCH", headers, body: JSON.stringify(it.payload.body),
        });
      } else {
        await OfflineQueue.remove(it.id); // unknown kind → drop
        continue;
      }
      // 409 = duplicate (idempotency) — treat as success, drop
      if (resp.ok || resp.status === 409) {
        await OfflineQueue.remove(it.id);
        ok++;
      } else {
        await OfflineQueue.bumpAttempt(it.id);
        fail++;
      }
    } catch (_e) {
      await OfflineQueue.bumpAttempt(it.id);
      fail++;
    }
  }
  return { ok, fail };
}

/** count items ใน queue (สำหรับ UI) */
export async function offlinePendingCount() {
  try { return await OfflineQueue.count(); } catch { return 0; }
}

/**
 * Phase 92.25: admin edit a single attendance row
 * @param {number} id - staff_attendance.id
 * @param {object} body - subset { clock_in_at?, clock_out_at?, notes? }
 */
async function _patchAttendance(id, body) {
  const cfg = window.SUPABASE_CONFIG;
  const headers = { ..._sbHeaders(), Prefer: "return=representation" };
  const r = await fetch(`${cfg.url}/rest/v1/staff_attendance?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

function _authUserId() {
  return window.App?.state?.currentUser?.id
    || window.currentUser?.id
    || null;
}

/**
 * Phase 92.24 / Phase 377: capture GPS for a clock action.
 * @param {object} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.enforce=false]
 *   - enforce=false (admin/manager path): warn-only — ดึง GPS ได้ก็ใส่, ไม่ได้/นอกรัศมีก็ยังบันทึก (พฤติกรรมเดิม 92.24)
 *   - enforce=true (self path): **block** — ถ้ามี geofence แล้ว GPS หาย → throw "GPS_REQUIRED";
 *     ถ้าอยู่นอกรัศมี → throw "GEOFENCE_OUTSIDE" (พร้อม distance/radius). throw เกิด "ก่อน" insert/patch
 *     → ไม่มี attendance row และไม่ enqueue offline.
 * @returns {Promise<{gps:object|null, geofence:object|null}>}
 * @throws {Error} (enforce=true) code "GPS_REQUIRED" | "GEOFENCE_OUTSIDE"
 */
export async function _captureGpsForClock(ctx, { enforce = false } = {}) {
  const geofence = geofenceFromState(ctx?.state);
  if (!geofence) return { gps: null, geofence: null }; // ไม่ได้ตั้ง geofence → ทำงานได้โดยไม่ต้อง GPS (ทั้ง 2 โหมด)
  const gps = await getCurrentPosition();

  if (!enforce) {
    // ── warn-only (admin path / พฤติกรรมเดิม 92.24) ──
    if (!gps) {
      ctx?.showToast?.("⚠️ ไม่สามารถดึงตำแหน่งได้ — บันทึกโดยไม่มี GPS");
      return { gps: null, geofence };
    }
    const dist = haversineMeters(geofence.lat, geofence.lng, gps.lat, gps.lng);
    if (dist > geofence.radiusM) {
      ctx?.showToast?.(`⚠️ คุณอยู่ห่างร้าน ${dist}m (เกิน ${geofence.radiusM}m) — บันทึกแล้วแต่ระบบจะ flag`);
    }
    return { gps, geofence };
  }

  // ── enforce=true (self path) — block ก่อนเขียน ──
  if (!gps) {
    const err = new Error("ต้องเปิด GPS เพื่อบันทึกเวลาเข้า/ออก");
    err.code = "GPS_REQUIRED";
    throw err;
  }
  const dist = haversineMeters(geofence.lat, geofence.lng, gps.lat, gps.lng);
  if (dist > geofence.radiusM) {
    const err = new Error(`อยู่นอกพื้นที่ร้าน ${dist} ม. (กำหนด ${geofence.radiusM} ม.) — ไม่สามารถลงเวลาได้`);
    err.code = "GEOFENCE_OUTSIDE";
    err.distance = dist;
    err.radius = geofence.radiusM;
    throw err;
  }
  return { gps, geofence };
}

/**
 * Phase 92.24: warn-only wrapper (admin/manager path) — คงพฤติกรรมเดิมเป๊ะ
 * @returns {Promise<{gps:object|null, geofence:object|null}>}
 */
async function _captureGpsAndWarn(ctx) {
  return _captureGpsForClock(ctx, { enforce: false });
}

// ─── Phase 92.25 helpers: datetime conversion (Bangkok ↔ ISO) ───────

/**
 * DB ISO (UTC) → input datetime-local string ใน Asia/Bangkok
 * @param {string|null} iso - "2026-05-24T04:20:00.000Z"
 * @returns {string} "2026-05-24T11:20" (Bangkok local) หรือ "" ถ้า null
 */
export function isoToBangkokInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "";
  // sv-SE format = "YYYY-MM-DD HH:mm:ss" — clean ไม่มี comma
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" })
    .replace(" ", "T").slice(0, 16);
}

/**
 * input datetime-local (assume Bangkok) → UTC ISO string สำหรับ DB
 * @param {string} localStr - "2026-05-24T11:20"
 * @returns {string|null}   - "2026-05-24T04:20:00.000Z"
 */
export function bangkokInputToIso(localStr) {
  if (!localStr || typeof localStr !== "string") return null;
  // Bangkok = UTC+7 ตลอด (ไม่มี DST)
  const iso = new Date(localStr.length === 16 ? localStr + ":00+07:00" : localStr + "+07:00").toISOString();
  return iso;
}

// ═══════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════

export async function renderTimeClockPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-time_clock");
  if (!container) return;

  // Phase 92.27: auto-sync queue ครั้งแรกที่ render — ถ้า online + มี pending
  // ใช้ flag กัน re-trigger ซ้อนตอน renderTimeClockPage เรียกซ้ำ (after toast)
  if (typeof navigator !== "undefined" && navigator.onLine !== false && !window._tcSyncing) {
    window._tcSyncing = true;
    try {
      const pending = await offlinePendingCount().catch(() => 0);
      if (pending > 0) {
        const { ok } = await syncOfflineQueue();
        if (ok > 0) showToast?.(`📥 Sync auto: ✅ ${ok} record`);
      }
    } finally {
      window._tcSyncing = false;
    }
  }

  container.innerHTML = renderSkeleton({ type: "table", count: 4 });

  const role = state?.profile?.role || "sales";
  const isAdmin = role === "admin";

  try {
    if (isAdmin) {
      await _renderManagerView(container, ctx);
    } else {
      await _renderSelfView(container, ctx);
    }
  } catch (err) {
    if (err?.code === "NO_TABLE") {
      container.innerHTML = `
        <div class="panel" style="padding:24px">
          <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
          ${renderError({
            message: "ยังไม่ได้ติดตั้ง schema",
            detail: "ผู้ดูแลระบบต้องรันไฟล์ <code>supabase-phase92-22-time-clock.sql</code> และ <code>supabase-phase92-22e-use-profiles.sql</code> ใน Supabase SQL Editor ก่อนใช้งาน",
            retryLabel: "ลองอีกครั้ง",
            retryId: "tcRetryBtn",
          })}
        </div>`;
      document.getElementById("tcRetryBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));
      return;
    }
    console.error("[time_clock] render error:", err);
    container.innerHTML = `
      <div class="panel" style="padding:24px">
        <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
        ${renderError({
          message: "เกิดข้อผิดพลาด",
          detail: escHtml(err?.message || String(err)),
          retryLabel: "ลองอีกครั้ง",
          retryId: "tcRetryBtn",
        })}
      </div>`;
    document.getElementById("tcRetryBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));
    showToast?.("โหลดหน้าลงเวลาไม่สำเร็จ");
  }
}

// ═══════════════════════════════════════════════════════════
//  Manager view (admin)
// ═══════════════════════════════════════════════════════════

let _mgrFilterFrom = workDateBangkok();
let _mgrFilterTo   = workDateBangkok();
let _mgrFilterUser = "all";

async function _renderManagerView(container, ctx) {
  // Phase 92.27b: ensure profiles loaded ก่อน — fix bug ที่ dropdown ว่าง
  // ถ้า admin ไม่เคยเปิด Settings → ตั้งค่าผู้ใช้งาน
  await _ensureProfilesLoaded(ctx.state);
  const profiles = _staffProfiles(ctx.state);
  // Phase 92.25b: shift hours config (default 08-17, override จาก storeInfo)
  const shiftOpts = shiftHoursFromState(ctx.state);
  // Phase 92.49: late / early-leave grace rules (informational chip only)
  const punctRules = attendanceRulesFromState(ctx.state);
  // Phase 92.27: pending offline queue count
  const pendingCount = await offlinePendingCount().catch(() => 0);

  const [openSessions, rangeRows] = await Promise.all([
    _fetchAttendance({ openOnly: true }),
    _fetchAttendance({
      fromDate: _mgrFilterFrom,
      toDate: _mgrFilterTo,
      userId: _mgrFilterUser !== "all" ? _mgrFilterUser : null,
    }),
  ]);

  // map id → profile (เพื่อแสดงชื่อใน rows)
  const profMap = {};
  profiles.forEach(p => { profMap[p.id] = p; });

  const openCard = openSessions.length
    ? openSessions.map(s => {
        const p = profMap[s.user_id];
        const name = profileDisplayName(p);
        const roleTh = ROLE_LABEL_TH[p?.role] || p?.role || "";
        return `
          <div class="tc-open-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;margin-bottom:8px">
            <div>
              <div style="font-weight:700;color:#065f46">👤 ${escHtml(name)} ${roleTh ? `<span style="font-size:11px;color:#047857;font-weight:500">· ${escHtml(roleTh)}</span>` : ''}</div>
              <div style="font-size:12px;color:#047857">เข้างาน ${timeBangkok(s.clock_in_at)} • ${escHtml(s.source)}</div>
            </div>
            <button class="btn" data-clock-out-id="${s.id}" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600">🏃 ลงเวลาออก</button>
          </div>`;
      }).join("")
    : `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">— ยังไม่มีผู้ใช้เข้างาน —</div>`;

  const userOptions = profiles.map(p => {
    const name = profileDisplayName(p);
    const roleTh = ROLE_LABEL_TH[p.role] || p.role;
    return `<option value="${escHtml(p.id)}">${escHtml(name)} (${escHtml(roleTh)})</option>`;
  }).join("");

  const filterUserOptions = `<option value="all">ทุกคน</option>` + profiles.map(p => {
    const name = profileDisplayName(p);
    return `<option value="${escHtml(p.id)}" ${String(_mgrFilterUser) === String(p.id) ? 'selected' : ''}>${escHtml(name)}</option>`;
  }).join("");

  const reportRows = rangeRows.map(r => {
    const p = profMap[r.user_id];
    const name = profileDisplayName(p);
    const { regular, ot, total } = computeRegularOT(r, shiftOpts);
    const stillOpen = r.clock_out_at == null;
    const otCell = stillOpen
      ? '<span style="color:#94a3b8">—</span>'
      : (ot > 0
        ? `<span style="color:#ea580c;font-weight:700">${ot.toFixed(2)}</span>`
        : `<span style="color:#cbd5e1">0.00</span>`);
    // Phase 92.49: punctuality chip (informational — ไม่ block / ไม่กระทบ payroll)
    const puncMeta = punctualityChipMeta(classifyPunctuality(r, shiftOpts, punctRules));
    const puncChip = puncMeta
      ? `<div style="margin-top:3px"><span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${puncMeta.bg};color:${puncMeta.fg};border:1px solid ${puncMeta.border};font-size:10px;font-weight:700">${escHtml(puncMeta.label)}</span></div>`
      : "";
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 10px">${escHtml(r.work_date)}</td>
        <td style="padding:8px 10px">${escHtml(name)}${puncChip}</td>
        <td style="padding:8px 10px">${timeBangkok(r.clock_in_at)}</td>
        <td style="padding:8px 10px">${timeBangkok(r.clock_out_at)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600">${stillOpen ? '<span style="color:#94a3b8">—</span>' : regular.toFixed(2)}</td>
        <td style="padding:8px 10px;text-align:right">${otCell}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#0f172a">${stillOpen ? '<span style="color:#10b981;font-weight:500">กำลังทำ</span>' : total.toFixed(2)}</td>
        <td style="padding:8px 10px;font-size:11px;color:#64748b">${escHtml(r.source)}</td>
        <td style="padding:8px 10px;text-align:center"><button class="btn light" data-edit-att-id="${escHtml(String(r.id))}" title="แก้ไขเวลา" style="font-size:11px;padding:4px 10px">✏️</button></td>
      </tr>`;
  }).join("");

  const sumOT = sumRegularOT(rangeRows, shiftOpts);
  // Phase 92.51: punctuality summary สำหรับช่วงที่กรอง (informational)
  const punctSummary = summarizePunctuality(rangeRows, shiftOpts, punctRules);

  container.innerHTML = `
    <div class="panel" style="padding:20px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h3 style="margin:0;flex:1">🕒 ลงเวลาทำงาน <span style="font-size:12px;color:#94a3b8;font-weight:400">(ผู้ดูแลระบบ)</span></h3>
        ${pendingCount > 0 ? `<button id="tcSyncOfflineBtn" class="btn" style="background:#f59e0b;color:#fff;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">📥 Sync ออฟไลน์ (${pendingCount})</button>` : ''}
        <button id="tcRefreshBtn" class="btn light" style="font-size:12px">🔄 รีเฟรช</button>
      </div>

      <!-- Section 1: กำลังทำงานอยู่ตอนนี้ -->
      <div style="margin-bottom:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:8px">⏱️ กำลังทำงาน (${openSessions.length})</div>
        ${openCard}
      </div>

      <!-- Section 2: ลงเวลาเข้างาน -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">➕ ลงเวลาเข้างาน (กดให้ผู้ใช้)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="tcUserSelect" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1">
            ${userOptions || '<option value="">— ยังไม่มีผู้ใช้ในระบบ —</option>'}
          </select>
          <input id="tcNoteInput" placeholder="หมายเหตุ (ถ้ามี)" style="flex:1;min-width:160px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1" />
          <button id="tcClockInBtn" class="btn primary" style="padding:8px 18px">✅ บันทึกเข้างาน</button>
        </div>
      </div>

      <!-- Section 3: รายงาน -->
      <div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <div style="font-weight:700;font-size:14px;flex:1">📊 รายงาน <span style="font-size:11px;color:#94a3b8;font-weight:400">(กะ ${String(shiftOpts.startHour).padStart(2,'0')}:00-${String(shiftOpts.endHour).padStart(2,'0')}:00 — เกินเป็น OT)</span></div>
          <span style="font-size:11px;color:#64748b">
            ปกติ <strong style="color:#0f172a">${sumOT.regular.toFixed(2)}</strong> +
            OT <strong style="color:#ea580c">${sumOT.ot.toFixed(2)}</strong> =
            <strong style="color:#0f172a">${sumOT.total.toFixed(2)}</strong> ชม. (${rangeRows.length} record)
          </span>
          <button id="tcExportBtn" class="btn light" style="font-size:12px">📥 Export</button>
        </div>
        <!-- Phase 92.51: สรุปความตรงต่อเวลาในช่วงนี้ (informational) -->
        <div style="font-size:11px;color:#64748b;margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span>⏱️ ความตรงต่อเวลา:</span>
          <span style="color:#166534;font-weight:700">ตรงเวลา ${punctSummary.onTime}</span>
          <span style="color:#92400e;font-weight:700">มาสาย ${punctSummary.late + punctSummary.lateAndEarly}${punctSummary.totalLateMinutes > 0 ? ` (รวม ${punctSummary.totalLateMinutes} นาที)` : ''}</span>
          <span style="color:#92400e;font-weight:700">ออกก่อน ${punctSummary.earlyLeave + punctSummary.lateAndEarly}${punctSummary.totalEarlyLeaveMinutes > 0 ? ` (รวม ${punctSummary.totalEarlyLeaveMinutes} นาที)` : ''}</span>
          ${punctSummary.missingClockOut > 0 ? `<span style="color:#3730a3;font-weight:700">ยังไม่ลงออก ${punctSummary.missingClockOut}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <label style="font-size:12px;color:#64748b">จาก</label>
          <input type="date" id="tcFilterFrom" value="${escHtml(_mgrFilterFrom)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <label style="font-size:12px;color:#64748b">ถึง</label>
          <input type="date" id="tcFilterTo" value="${escHtml(_mgrFilterTo)}" style="padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1" />
          <select id="tcFilterUser" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1">
            ${filterUserOptions}
          </select>
          <button id="tcApplyFilter" class="btn light" style="font-size:12px">🔍 ค้นหา</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
                <th style="padding:9px 10px;text-align:left;width:100px">วันที่</th>
                <th style="padding:9px 10px;text-align:left">ผู้ใช้</th>
                <th style="padding:9px 10px;text-align:left;width:80px">เข้า</th>
                <th style="padding:9px 10px;text-align:left;width:80px">ออก</th>
                <th style="padding:9px 10px;text-align:right;width:80px">ปกติ</th>
                <th style="padding:9px 10px;text-align:right;width:80px;color:#ea580c">OT</th>
                <th style="padding:9px 10px;text-align:right;width:80px">รวม</th>
                <th style="padding:9px 10px;text-align:left;width:70px">source</th>
                <th style="padding:9px 10px;text-align:center;width:50px"></th>
              </tr>
            </thead>
            <tbody>
              ${reportRows || `<tr><td colspan="9" style="padding:0">${renderEmpty({
                icon: "📅",
                title: "ไม่มีรายการในช่วงนี้",
                message: "ลองขยายช่วงวันที่หรือเปลี่ยนตัวกรอง",
                actionLabel: "",
                actionId: "",
              })}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // ─── Bind events ───────────────────────────────────────────
  document.getElementById("tcRefreshBtn")?.addEventListener("click", () => renderTimeClockPage(ctx));

  // Phase 92.27: manual sync button (visible when pending count > 0)
  document.getElementById("tcSyncOfflineBtn")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ กำลัง sync...";
    try {
      const { ok, fail } = await syncOfflineQueue();
      ctx.showToast?.(`📥 Sync: ✅ ${ok} • ❌ ${fail}`);
      renderTimeClockPage(ctx);
    } catch (e) {
      ctx.showToast?.("Sync ไม่สำเร็จ: " + (e?.message || "unknown"));
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });

  document.getElementById("tcClockInBtn")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    const userId = document.getElementById("tcUserSelect")?.value?.trim() || "";
    const note = document.getElementById("tcNoteInput")?.value?.trim() || null;
    if (!userId) { ctx.showToast?.("เลือกผู้ใช้ก่อน"); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      const { gps, geofence } = await _captureGpsAndWarn(ctx);
      await _insertClockIn({ userId, source: "admin", note, gps, geofence });
      ctx.showToast?.("ลงเวลาเข้างานเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "ALREADY_OPEN") {
        ctx.showToast?.("⚠️ ผู้ใช้คนนี้ยังมี session เปิดอยู่ — ต้องลงเวลาออกก่อน");
      } else if (e?.code === "QUEUED") {
        ctx.showToast?.("📥 ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online");
        renderTimeClockPage(ctx);
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });

  document.querySelectorAll("[data-clock-out-id]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const id = Number(btn.dataset.clockOutId);
    if (!id) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳";
    try {
      const { gps, geofence } = await _captureGpsAndWarn(ctx);
      await _patchClockOut({ id, gps, geofence });
      ctx.showToast?.("ลงเวลาออกเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "QUEUED") {
        ctx.showToast?.("📥 ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online");
        renderTimeClockPage(ctx);
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  }));

  document.getElementById("tcApplyFilter")?.addEventListener("click", () => {
    _mgrFilterFrom = document.getElementById("tcFilterFrom")?.value || _mgrFilterFrom;
    _mgrFilterTo   = document.getElementById("tcFilterTo")?.value   || _mgrFilterTo;
    _mgrFilterUser = document.getElementById("tcFilterUser")?.value || "all";
    renderTimeClockPage(ctx);
  });

  // Phase 92.25: admin edit row → open modal
  document.querySelectorAll("[data-edit-att-id]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.editAttId;
    const row = rangeRows.find(r => String(r.id) === String(id));
    if (!row) { ctx.showToast?.("ไม่พบรายการ"); return; }
    _openEditAttendanceModal(row, profMap, ctx);
  }));

  document.getElementById("tcExportBtn")?.addEventListener("click", () => {
    const data = rangeRows.map(r => {
      const { regular, ot, total } = computeRegularOT(r, shiftOpts);
      // Phase 92.51: punctuality columns (informational)
      const punc = classifyPunctuality(r, shiftOpts, punctRules);
      return {
        "วันที่": r.work_date,
        "ผู้ใช้": profileDisplayName(profMap[r.user_id]),
        "เข้างาน": timeBangkok(r.clock_in_at),
        "ออกงาน": timeBangkok(r.clock_out_at),
        "ปกติ (ชม.)": regular,
        "OT (ชม.)": ot,
        "รวม (ชม.)": total,
        "สถานะตรงเวลา": punctualityChipMeta(punc)?.label || "—",
        "นาทีสาย": punc.lateMinutes,
        "นาทีออกก่อน": punc.earlyLeaveMinutes,
        "source": r.source,
        "หมายเหตุ": r.notes || "",
      };
    });
    const filename = `attendance_${_mgrFilterFrom}_${_mgrFilterTo}_${todaySuffix?.() || ''}.xlsx`;
    exportToExcel?.(filename, data, "Attendance");
  });
}

// ═══════════════════════════════════════════════════════════
//  Self-service view (sales/technician — ของตัวเอง)
// ═══════════════════════════════════════════════════════════

async function _renderSelfView(container, ctx) {
  // Phase 92.27b: ensure profiles loaded (best-effort — self view fallback ใช้ state.profile)
  await _ensureProfilesLoaded(ctx.state);
  // Phase 92.25b: shift hours config (default 08-17, override จาก storeInfo)
  const shiftOpts = shiftHoursFromState(ctx.state);
  // Phase 92.51: punctuality rules (informational chip ในประวัติของตัวเอง)
  const punctRules = attendanceRulesFromState(ctx.state);
  const userId = _authUserId();
  if (!userId) {
    container.innerHTML = `
      <div class="panel" style="padding:24px;max-width:520px;margin:0 auto">
        <h3 style="margin:0 0 12px">🕒 ลงเวลาทำงาน</h3>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px;color:#92400e;font-size:14px">
          <div style="font-weight:700;margin-bottom:6px">⚠️ ยังไม่ได้ login</div>
          <div>กรุณา login ก่อนใช้งานหน้านี้</div>
        </div>
      </div>`;
    return;
  }

  // หา profile ของตัวเอง (จาก state — ไม่ fetch)
  const me = (ctx.state?.allProfiles || []).find(p => p.id === userId)
    || ctx.state?.profile
    || { id: userId, email: ctx.state?.currentUser?.email || "" };

  // Fetch attendance ของตัวเอง 7 วันล่าสุด
  const today = workDateBangkok();
  const weekAgo = workDateBangkok(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const rows = await _fetchAttendance({ userId, fromDate: weekAgo, toDate: today });

  const state = clockState(rows);
  const open = state === "open" ? rows[0] : null;
  const closedRows = rows.filter(r => r.clock_out_at != null);
  const weekSummary = sumRegularOT(closedRows, shiftOpts);
  const myName = profileDisplayName(me);
  const myRoleTh = ROLE_LABEL_TH[me.role] || me.role || "-";

  const historyRows = rows.length
    ? rows.map(r => {
        const stillOpen = r.clock_out_at == null;
        const { regular, ot, total } = computeRegularOT(r, shiftOpts);
        const otCell = stillOpen ? '—' : (ot > 0 ? `<span style="color:#ea580c;font-weight:700">${ot.toFixed(2)}</span>` : `<span style="color:#cbd5e1">0.00</span>`);
        // Phase 92.51: punctuality chip ของตัวเอง (informational)
        const puncMeta = punctualityChipMeta(classifyPunctuality(r, shiftOpts, punctRules));
        const puncChip = puncMeta
          ? `<div style="margin-top:3px"><span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${puncMeta.bg};color:${puncMeta.fg};border:1px solid ${puncMeta.border};font-size:10px;font-weight:700">${escHtml(puncMeta.label)}</span></div>`
          : "";
        return `
        <tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 10px">${escHtml(r.work_date)}${puncChip}</td>
          <td style="padding:8px 10px">${timeBangkok(r.clock_in_at)}</td>
          <td style="padding:8px 10px">${timeBangkok(r.clock_out_at)}</td>
          <td style="padding:8px 10px;text-align:right">${stillOpen ? '<span style="color:#10b981">กำลังทำ</span>' : regular.toFixed(2)}</td>
          <td style="padding:8px 10px;text-align:right">${otCell}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700">${stillOpen ? '—' : total.toFixed(2)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#94a3b8">ยังไม่มีประวัติในสัปดาห์นี้</td></tr>`;

  container.innerHTML = `
    <div class="tc-self-shell">
      <div class="tc-self-profile">
        <div class="tc-self-profile-main">
          <div class="tc-self-profile-label">ผู้ใช้งาน</div>
          <div class="tc-self-profile-name">👤 ${escHtml(myName)}</div>
          <div class="tc-self-profile-sub">${escHtml(myRoleTh)}${me.email ? ' • ' + escHtml(me.email) : ''}</div>
        </div>
      </div>

      ${state === "open" ? `
        <div class="tc-self-action-card tc-self-action-card--open">
          <div class="tc-self-action-title">⏱️ กำลังทำงานอยู่</div>
          <div class="tc-self-action-state">เข้างาน ${timeBangkok(open.clock_in_at)}</div>
          <button id="tcSelfClockOut" class="btn tc-self-action-btn tc-self-action-btn--out">🏃 ลงเวลาออก</button>
        </div>
      ` : `
        <div class="tc-self-action-card tc-self-action-card--closed">
          <div class="tc-self-action-title">วันนี้</div>
          <div class="tc-self-action-state">${state === "closed" ? "ลงเวลาออกแล้ว — ต้องการเข้าใหม่?" : "ยังไม่ลงเวลาเข้าวันนี้"}</div>
          <button id="tcSelfClockIn" class="btn primary tc-self-action-btn">✅ ลงเวลาเข้างาน</button>
        </div>
      `}

      <div class="tc-self-summary">
        <div class="tc-self-summary-title">สรุปสัปดาห์นี้ (7 วันล่าสุด) — กะ ${String(shiftOpts.startHour).padStart(2,'0')}:00-${String(shiftOpts.endHour).padStart(2,'0')}:00</div>
        <div class="tc-self-summary-metrics">
          <div class="tc-self-metric">
            <div class="tc-self-metric-label">ปกติ</div>
            <div class="tc-self-metric-value">${weekSummary.regular.toFixed(2)}</div>
          </div>
          <div class="tc-self-metric">
            <div class="tc-self-metric-label tc-self-metric-label--ot">OT</div>
            <div class="tc-self-metric-value tc-self-metric-value--ot">${weekSummary.ot.toFixed(2)}</div>
          </div>
          <div class="tc-self-metric">
            <div class="tc-self-metric-label">รวม</div>
            <div class="tc-self-metric-value tc-self-metric-value--total">${weekSummary.total.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div class="tc-self-history">
        <div class="tc-self-history-title">📅 ประวัติ 7 วันล่าสุด</div>
        <div class="tc-self-history-wrap">
          <table class="tc-self-history-table">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
                <th style="padding:9px 10px;text-align:left">วันที่</th>
                <th style="padding:9px 10px;text-align:left">เข้า</th>
                <th style="padding:9px 10px;text-align:left">ออก</th>
                <th style="padding:9px 10px;text-align:right">ปกติ</th>
                <th style="padding:9px 10px;text-align:right;color:#ea580c">OT</th>
                <th style="padding:9px 10px;text-align:right">รวม</th>
              </tr>
            </thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // ─── Bind events ───────────────────────────────────────────
  document.getElementById("tcSelfClockIn")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      // Phase 377: self path บังคับ GPS geofence (block ก่อนเขียน → ไม่มี row, ไม่ enqueue)
      const { gps, geofence } = await _captureGpsForClock(ctx, { enforce: true });
      await _insertClockIn({ userId, source: "self", gps, geofence });
      ctx.showToast?.("ลงเวลาเข้างานเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "GPS_REQUIRED" || e?.code === "GEOFENCE_OUTSIDE") {
        ctx.showToast?.(e.message);
      } else if (e?.code === "ALREADY_OPEN") {
        ctx.showToast?.("⚠️ คุณยังมี session เปิดอยู่ — ลงเวลาออกก่อน");
      } else if (e?.code === "QUEUED") {
        ctx.showToast?.("📥 ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online");
        renderTimeClockPage(ctx);
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });

  document.getElementById("tcSelfClockOut")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled || !open) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ บันทึก...";
    try {
      // Phase 377: self path บังคับ GPS geofence (block ก่อนเขียน → ไม่มี patch, ไม่ enqueue)
      const { gps: gpsOut, geofence: gfOut } = await _captureGpsForClock(ctx, { enforce: true });
      await _patchClockOut({ id: open.id, gps: gpsOut, geofence: gfOut });
      ctx.showToast?.("ลงเวลาออกเรียบร้อย ✅");
      renderTimeClockPage(ctx);
    } catch (e) {
      if (e?.code === "GPS_REQUIRED" || e?.code === "GEOFENCE_OUTSIDE") {
        ctx.showToast?.(e.message);
      } else if (e?.code === "QUEUED") {
        ctx.showToast?.("📥 ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online");
        renderTimeClockPage(ctx);
      } else {
        ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.25: Admin edit attendance modal
// ═══════════════════════════════════════════════════════════

function _openEditAttendanceModal(row, profMap, ctx) {
  // กัน modal ซ้อน
  document.getElementById("tcEditModal")?.remove();

  const p = profMap[row.user_id];
  const userName = profileDisplayName(p);
  const inputIn  = isoToBangkokInput(row.clock_in_at);
  const inputOut = isoToBangkokInput(row.clock_out_at);

  const modal = document.createElement("div");
  modal.id = "tcEditModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:480px;box-shadow:0 10px 40px rgba(0,0,0,.2);overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:11px;color:#64748b">แก้ไขเวลา</div>
          <div style="font-weight:800;font-size:16px;color:#0284c7">👤 ${escHtml(userName)}</div>
          <div style="font-size:12px;color:#64748b">${escHtml(row.work_date)}</div>
        </div>
        <button id="tcEditCloseBtn" style="background:#f1f5f9;border:none;width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:18px">×</button>
      </div>
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">⏰ เวลาเข้า (Asia/Bangkok)</label>
          <input type="datetime-local" id="tcEditIn" value="${escHtml(inputIn)}" required style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">🏃 เวลาออก (เว้นว่าง = ยังไม่ออก)</label>
          <input type="datetime-local" id="tcEditOut" value="${escHtml(inputOut)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">📝 หมายเหตุ (ถ้ามี)</label>
          <textarea id="tcEditNotes" rows="2" placeholder="เช่น แก้ไขเพราะลืมลงเวลาออก" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical">${escHtml(row.notes || "")}</textarea>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:11px;color:#92400e">
          ⚠️ การแก้ไขจะถูกบันทึกใน Audit Log (action=<code>edit_attendance</code>)
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
          <button id="tcEditCancelBtn" class="btn light" style="padding:9px 18px;font-size:13px">ยกเลิก</button>
          <button id="tcEditSaveBtn" class="btn primary" style="padding:9px 20px;font-size:13px;font-weight:600">💾 บันทึก</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // close handlers
  const close = () => modal.remove();
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.getElementById("tcEditCloseBtn")?.addEventListener("click", close);
  document.getElementById("tcEditCancelBtn")?.addEventListener("click", close);

  document.getElementById("tcEditSaveBtn")?.addEventListener("click", async (ev) => {
    const saveBtn = ev.currentTarget;
    if (saveBtn.disabled) return;
    const inputInVal  = document.getElementById("tcEditIn")?.value || "";
    const inputOutVal = document.getElementById("tcEditOut")?.value || "";
    const notesVal    = document.getElementById("tcEditNotes")?.value?.trim() || "";

    if (!inputInVal) { ctx.showToast?.("ต้องระบุเวลาเข้างาน"); return; }
    const newIn  = bangkokInputToIso(inputInVal);
    const newOut = inputOutVal ? bangkokInputToIso(inputOutVal) : null;
    if (newOut && new Date(newOut).getTime() <= new Date(newIn).getTime()) {
      ctx.showToast?.("⚠️ เวลาออกต้องหลังเวลาเข้า");
      return;
    }

    saveBtn.disabled = true;
    const orig = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    // เก็บค่าเก่า + ใหม่สำหรับ audit log
    const oldVals = {
      clock_in_at:  row.clock_in_at,
      clock_out_at: row.clock_out_at,
      notes:        row.notes || null,
    };
    const newVals = {
      clock_in_at:  newIn,
      clock_out_at: newOut,
      notes:        notesVal || null,
    };

    try {
      await _patchAttendance(row.id, newVals);

      // Audit log — best-effort, ห้ามทำให้ save fail
      try {
        await logActivity("edit_attendance", {
          entityType: "staff_attendance",
          entityId: row.id,
          summary: `แก้ไขเวลาของ ${userName} วันที่ ${row.work_date}`,
          metadata: { user_id: row.user_id, work_date: row.work_date, old: oldVals, new: newVals },
        });
      } catch (_e) { /* swallow */ }

      ctx.showToast?.("บันทึกการแก้ไขเรียบร้อย ✅");
      close();
      renderTimeClockPage(ctx);
    } catch (e) {
      ctx.showToast?.("บันทึกไม่สำเร็จ: " + (e?.message || "unknown"));
      if (saveBtn.isConnected) { saveBtn.disabled = false; saveBtn.textContent = orig; }
    }
  });
}
