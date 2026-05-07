// ═══════════════════════════════════════════════════════════
//  auth_otp.js — Customer phone+OTP signup/login (Phase 86.4)
//
//  ย้ายมาจาก main.js: requestOtp, verifyOtp, _pendingOtp state
//
//  Flow:
//   1. user กรอกเบอร์ → requestOtp() → POST /api/send-otp →
//      KV store + ส่ง SMS (Twilio) หรือ web fallback
//   2. user กรอก OTP → verifyOtp() → POST /api/verify-otp →
//      verify HMAC + return deterministic authPassword
//   3. ลอง signInWithPassword (fakeEmail = phone@phone.boonsook.local)
//   4. ถ้ายังไม่มี account → signUp + create profile + customer record
//      → signInWithPassword อีกครั้ง
//
//  Imports โดยตรงจาก sibling modules:
//   - api_utils    (formatPhone, getApiBase, readApiJson)
//   - otp_cooldown (cooldown helpers จาก Phase 85.3 + 86.2)
//
//  Deps ผ่าน factory:
//   - state (state.supabase, runtime-resolved)
//   - $, setText, showToast (UI helpers)
//
//  Usage จาก main.js:
//    import { createOtpAuth } from "./modules/auth_otp.js";
//    const { requestOtp, verifyOtp } = createOtpAuth({ state, $, setText, showToast });
// ═══════════════════════════════════════════════════════════

import { formatPhone, getApiBase, readApiJson } from "./api_utils.js";
import {
  isOtpCooldownActive, getOtpRemaining,
  disableOtpButtons, setOtpCooldown, clearOtpCooldown
} from "./otp_cooldown.js";

/**
 * @param {object} deps
 * @param {object} deps.state - main.js state object (.supabase)
 * @param {function} deps.$ - DOM accessor (id => element)
 * @param {function} deps.setText - (id, text) => void
 * @param {function} deps.showToast - (msg) => void
 * @returns {{ requestOtp, verifyOtp }}
 */
export function createOtpAuth(deps) {
  const { state, $, setText, showToast } = deps;

  // Module-private OTP state (was main.js _pendingOtp)
  // { phone, name, hash, expiresAt, authPassword, attempts }
  let _pendingOtp = null;

  // ─── Step 1: send OTP via SMS / web fallback ──────────────
  async function requestOtp() {
    // ★ Phase 85.3 — guard cooldown (Phase 17 rate limiter spam protection)
    if (isOtpCooldownActive()) {
      showToast("โปรดรออีก " + getOtpRemaining() + " วินาทีก่อนขอ OTP ใหม่");
      return;
    }

    const name = $("custName")?.value.trim() || "";
    const phone = formatPhone($("custPhone")?.value);
    if (!phone || phone.length < 9) return showToast("กรุณากรอกเบอร์โทรให้ถูกต้อง");

    // ★ Phase 85.3 — disable buttons during request
    disableOtpButtons("⏳ กำลังส่ง...");

    const statusEl = $("otpStatus");
    statusEl?.classList.remove("hidden");
    setText("otpStatus", "กำลังส่งรหัส OTP ทาง SMS...");

    let httpStatus = 0;
    try {
      const res = await fetch(`${getApiBase()}/api/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      httpStatus = res.status;
      const data = await readApiJson(res, "ส่ง OTP");

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "ส่ง SMS ไม่สำเร็จ");
      }

      _pendingOtp = {
        phone,
        name,
        hash: data.hash,
        expiresAt: data.expiresAt,
        authPassword: null,
        attempts: 0
      };

      // แสดง step 2
      $("otpStep1")?.classList.add("hidden");
      $("otpStep2")?.classList.remove("hidden");
      setText("otpPhoneDisplay", phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"));
      // * แสดง OTP บนจอเมื่อเปิดโหมด fallback ชั่วคราวจากฝั่ง server
      if (data.dev && data.devCode) {
        const prefix = data.otpDelivery === "web_fallback" ? "[OTP หน้าเว็บชั่วคราว]" : "[โหมดทดสอบ]";
        setText("otpStatus", prefix + " รหัส OTP ของคุณคือ " + data.devCode);
      } else {
        setText("otpStatus", "ส่งรหัส OTP ไปเบอร์ " + phone + " แล้ว (ตรวจสอบ SMS)");
      }
      $("otpCode")?.focus();

      // ★ Phase 85.3 — start 60s cooldown หลัง send สำเร็จ
      setOtpCooldown(60);

    } catch (e) {
      console.error("[OTP] Send error:", e);
      setText("otpStatus", "ส่ง SMS ไม่สำเร็จ: " + e.message);
      showToast("ส่ง SMS ไม่สำเร็จ: " + e.message);

      // ★ Phase 85.3 — ถ้า rate-limited (429 จาก Phase 17 KV) → cooldown 5 นาที
      if (httpStatus === 429 || /too many|rate.?limit/i.test(e.message)) {
        setOtpCooldown(300);
        showToast("⚠️ ขอ OTP บ่อยเกินไป — รอ 5 นาทีแล้วลองใหม่");
      } else {
        // error อื่น → restore buttons ทันที (ให้ user retry ได้)
        clearOtpCooldown();
      }
    }
  }


  // ─── Step 2: verify OTP + signIn / signUp ─────────────────
  async function verifyOtp() {
    const code = $("otpCode")?.value.trim();
    if (!code || code.length < 6) return showToast("กรุณากรอกรหัส OTP 6 หลัก");

    if (!_pendingOtp) return showToast("กรุณาขอ OTP ใหม่");
    if (Date.now() > _pendingOtp.expiresAt) {
      _pendingOtp = null;
      return showToast("OTP หมดอายุ กรุณาขอใหม่");
    }

    // ★ Brute-force protection: จำกัด 5 ครั้งต่อ session
    _pendingOtp.attempts = (_pendingOtp.attempts || 0) + 1;
    if (_pendingOtp.attempts > 5) {
      _pendingOtp = null;
      return showToast("ลองผิดเกินกำหนด กรุณาขอ OTP ใหม่");
    }

    // ★ ตรวจสอบ OTP ผ่าน server (stateless HMAC)
    try {
      const verifyRes = await fetch(`${getApiBase()}/api/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: _pendingOtp.phone,
          code,
          hash: _pendingOtp.hash,
          expiresAt: _pendingOtp.expiresAt
        })
      });
      const verifyData = await readApiJson(verifyRes, "ตรวจ OTP");
      if (!verifyRes.ok || !verifyData.ok) {
        return showToast(verifyData.error || "รหัส OTP ไม่ถูกต้อง");
      }
      _pendingOtp.authPassword = verifyData.authPassword;
    } catch (e) {
      return showToast("ตรวจสอบ OTP ไม่สำเร็จ: " + e.message);
    }

    setText("otpStatus", "กำลังเข้าสู่ระบบ...");

    const phone = _pendingOtp.phone;
    const name = _pendingOtp.name;
    const cfg = window.SUPABASE_CONFIG;

    try {
      // ★ ใช้ deterministic authPassword จาก server (HMAC+OTP_SECRET) — เบอร์เดียวกัน = password เดิม ลูกค้าเก่า login ซ้ำได้
      const fakeEmail = phone + "@phone.boonsook.local";
      const fakePassword = _pendingOtp.authPassword;
      if (!fakePassword) throw new Error("ไม่ได้รับ authPassword จาก server");

      // ลอง sign in ก่อน
      let { error: loginErr } = await state.supabase.auth.signInWithPassword({ email: fakeEmail, password: fakePassword });

      if (loginErr) {
        // อาจมีบัญชีอยู่แล้วแต่ password (nonce) เปลี่ยน → ลอง update password ก่อน login
        // โดยสมัครใหม่ก่อน ถ้า email ซ้ำ Supabase จะ return error ซึ่งเราจะ updateUser แทน
        const displayName = name || ("ลูกค้า " + phone);
        const { data: authData, error: signUpErr } = await state.supabase.auth.signUp({
          email: fakeEmail,
          password: fakePassword,
          options: { data: { full_name: displayName, role: "customer", phone: phone } }
        });

        if (signUpErr && signUpErr.message?.toLowerCase().includes("already registered")) {
          // ★ มีบัญชีแล้ว → ใช้ admin API reset password (ต้องมี Service Role key ฝั่ง server)
          // Fallback: แจ้งผู้ใช้ให้ติดต่อร้าน (safe ที่สุดในตอนนี้)
          throw new Error("บัญชีนี้สร้างด้วยระบบเก่า — กรุณาติดต่อร้านเพื่อ reset");
        }

        if (signUpErr) throw new Error(signUpErr.message);

        const userId = authData?.user?.id;
        if (userId) {
          const token = authData?.session?.access_token || cfg.anonKey;

          // สร้าง profile
          await fetch(`${cfg.url}/rest/v1/profiles`, {
            method: "POST",
            headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer":"return=minimal" },
            body: JSON.stringify({ id: userId, full_name: displayName, role: "customer" })
          });

          // สร้าง customer record
          await fetch(`${cfg.url}/rest/v1/customers`, {
            method: "POST",
            headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer":"return=minimal" },
            body: JSON.stringify({ name: displayName, phone, email: null, note: "สมัครผ่าน OTP เบอร์โทร" })
          });
        }

        // ล็อกอินอีกครั้ง (หลังสมัครเสร็จ)
        await state.supabase.auth.signInWithPassword({ email: fakeEmail, password: fakePassword });
      }

      _pendingOtp = null;
      showToast("เข้าสู่ระบบสำเร็จ! 🎉");
      setText("otpStatus", "เข้าสู่ระบบสำเร็จ!");
      // onAuthStateChange จะ trigger afterLogin() อัตโนมัติ

    } catch(e) {
      setText("otpStatus", "เข้าสู่ระบบไม่สำเร็จ: " + e.message);
      showToast("❌ " + e.message);
    }
  }


  return { requestOtp, verifyOtp };
}
