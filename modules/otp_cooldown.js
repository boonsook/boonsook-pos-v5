// ═══════════════════════════════════════════════════════════
//  otp_cooldown.js — OTP resend cooldown manager (Phase 86.2)
//
//  เก็บ state + helpers ของ OTP cooldown ที่เริ่มสร้างใน Phase 85.3
//  ใช้กัน user spam ปุ่ม "ขอ OTP" / "ส่ง OTP ใหม่" จนติด rate limiter
//  ของ Phase 17 (KV) ที่ขึ้น HTTP 429
//
//  Usage จาก main.js:
//    import {
//      isOtpCooldownActive, getOtpRemaining,
//      disableOtpButtons, setOtpCooldown, clearOtpCooldown
//    } from "./modules/otp_cooldown.js";
//
//    if (isOtpCooldownActive()) {
//      showToast("โปรดรอ " + getOtpRemaining() + " วินาที");
//      return;
//    }
//    disableOtpButtons("⏳ กำลังส่ง...");
//    try {
//      await fetch(...);
//      setOtpCooldown(60);                  // success → 60s lock
//    } catch (e) {
//      if (httpStatus === 429) setOtpCooldown(300); // rate-limited → 5-min lock
//      else clearOtpCooldown();             // other error → restore
//    }
// ═══════════════════════════════════════════════════════════

// Module-private state (no globals leaked)
let _cooldownEnd = 0;     // timestamp ms when cooldown ends; 0 = no cooldown
let _tickInterval = null; // setInterval id

// Button id → original text (restored after cooldown clears)
const _BUTTON_IDS = ["requestOtpBtn", "resendOtpBtn"];
const _ORIG_TEXT = {
  requestOtpBtn: "📱 ขอรหัส OTP",
  resendOtpBtn:  "ส่ง OTP ใหม่"
};

function _buttons() {
  return _BUTTON_IDS
    .map(id => document.getElementById(id))
    .filter(Boolean);
}

function _origText(btn) {
  return _ORIG_TEXT[btn.id] || btn.textContent;
}

function _tickOnce() {
  const remain = Math.max(0, Math.ceil((_cooldownEnd - Date.now()) / 1000));
  if (remain <= 0) { clearOtpCooldown(); return; }
  const mm = Math.floor(remain / 60);
  const ss = remain % 60;
  const label = mm > 0
    ? "รอ " + mm + ":" + String(ss).padStart(2, "0")
    : "รอ " + ss + " วิ";
  for (const btn of _buttons()) {
    btn.disabled = true;
    btn.textContent = label;
  }
}


// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

/** @returns {boolean} true ถ้ายังอยู่ใน cooldown */
export function isOtpCooldownActive() {
  return _cooldownEnd > Date.now();
}

/** @returns {number} วินาทีที่เหลือใน cooldown (0 ถ้าไม่ active) */
export function getOtpRemaining() {
  return Math.max(0, Math.ceil((_cooldownEnd - Date.now()) / 1000));
}

/**
 * Disable ทั้ง 2 ปุ่ม OTP + ตั้ง label เดียวกัน (ใช้ตอนกำลัง fetch)
 * @param {string} [label="⏳ กำลังส่ง..."]
 */
export function disableOtpButtons(label = "⏳ กำลังส่ง...") {
  for (const btn of _buttons()) {
    btn.disabled = true;
    btn.textContent = label;
  }
}

/**
 * เริ่ม cooldown — ปุ่ม disabled + แสดง countdown ทุกวินาที
 * @param {number} seconds จำนวนวินาที
 */
export function setOtpCooldown(seconds) {
  _cooldownEnd = Date.now() + seconds * 1000;
  if (_tickInterval) clearInterval(_tickInterval);
  _tickOnce();
  _tickInterval = setInterval(_tickOnce, 1000);
}

/**
 * เคลียร์ cooldown ทันที + restore ปุ่มเป็น original text
 */
export function clearOtpCooldown() {
  _cooldownEnd = 0;
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
  for (const btn of _buttons()) {
    btn.disabled = false;
    btn.textContent = _origText(btn);
  }
}
