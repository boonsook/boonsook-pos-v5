// ═══════════════════════════════════════════════════════════
//  auth_email.js — Email/password staff auth flow (Phase 86.3)
//
//  ย้ายมาจาก main.js: login, requestStaffPasswordReset,
//  showSetPasswordScreen, submitNewPassword
//
//  ใช้ factory pattern เพราะ flow ผูกกับ state, $, setText, showToast,
//  afterLogin ของ main.js → pass เข้ามาเป็น dependency
//
//  Phase 85.1 race-condition guards (state.supabase + try/catch +
//  button lock) ยังคงไว้ครบ
//
//  Usage จาก main.js:
//    import { createEmailAuth } from "./modules/auth_email.js";
//    const { login, requestStaffPasswordReset,
//            showSetPasswordScreen, submitNewPassword } =
//      createEmailAuth({ state, $, setText, showToast,
//                        afterLogin: () => afterLogin() });
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} deps
 * @param {object} deps.state - main.js state object (ต้องมี .supabase, ._recoveryMode)
 * @param {function} deps.$ - DOM accessor (id => element)
 * @param {function} deps.setText - (id, text) => void
 * @param {function} deps.showToast - (msg) => void
 * @param {function} deps.afterLogin - async () => void (เรียกหลัง login สำเร็จ)
 * @returns {{ login, requestStaffPasswordReset, showSetPasswordScreen, submitNewPassword }}
 */
export function createEmailAuth(deps) {
  const { state, $, setText, showToast, afterLogin } = deps;

  // ─── Show recovery/invite "set password" screen ───────────
  function showSetPasswordScreen() {
    $("authScreen")?.classList.add("hidden");
    $("appShell")?.classList.add("hidden");
    $("setPasswordScreen")?.classList.remove("hidden");
    setTimeout(() => $("setPwNew")?.focus(), 50);
  }

  // ─── Submit new password (recovery + invite) ──────────────
  async function submitNewPassword() {
    const pw = $("setPwNew")?.value || "";
    const pw2 = $("setPwConfirm")?.value || "";
    const statusEl = $("setPasswordStatus");
    const setStatus = (msg) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.classList.remove("hidden");
    };
    if (pw.length < 6) { setStatus("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    if (pw !== pw2) { setStatus("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }

    const btn = $("setPasswordBtn");
    if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
    try {
      const { error } = await state.supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      // เคลียร์ hash ที่มี access_token ออก
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch(e){}
      state._recoveryMode = false;
      $("setPwNew").value = ""; $("setPwConfirm").value = "";
      $("setPasswordScreen")?.classList.add("hidden");
      showToast("ตั้งรหัสผ่านสำเร็จ — เข้าสู่ระบบอัตโนมัติ");
      await afterLogin();
    } catch (err) {
      console.error("[submitNewPassword] error:", err);
      setStatus("บันทึกไม่สำเร็จ: " + (err.message || "ไม่ทราบสาเหตุ"));
      if (btn) { btn.disabled = false; btn.textContent = "บันทึกรหัสผ่าน"; }
    }
  }

  // ─── Email/password login (with Phase 85.1 race-condition guards) ─
  async function login() {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if (!email || !password) return showToast("กรอกอีเมลและรหัสผ่าน");

    // ★ Phase 85.1 — guard: state.supabase ต้อง init ก่อน (boot race fix)
    if (!state.supabase || !state.supabase.auth) {
      showToast("ระบบยังเชื่อมต่อไม่เสร็จ — รอ 2-3 วินาทีแล้วลองใหม่");
      setText("authStatus", "ยังเชื่อมต่อ Supabase ไม่สำเร็จ");
      return;
    }

    // ✅ Save hash before login (in case session is reset)
    const originalHash = window.location.hash;
    try { localStorage.setItem("bsk_login_destination", originalHash); } catch(e){}

    // ★ Phase 85.1 — disable button + show progress (กัน double-click + UI freeze)
    const btn = $("loginBtn");
    const origText = btn?.textContent || "เข้าสู่ระบบ (พนักงาน)";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังเข้าสู่ระบบ..."; }
    setText("authStatus", "กำลังเข้าสู่ระบบ...");

    // ★ Phase 85.1 — wrap ใน try/catch กัน UI freeze ถ้า network/SDK throw
    try {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showToast(error.message || "เข้าสู่ระบบไม่สำเร็จ");
        setText("authStatus", "เข้าสู่ระบบไม่สำเร็จ");
      }
      // success: onAuthStateChange handler จะปิดหน้า login อัตโนมัติ
    } catch (err) {
      console.error("[login] signInWithPassword threw:", err);
      showToast("เกิดข้อผิดพลาด: " + (err?.message || "ไม่ทราบสาเหตุ"));
      setText("authStatus", "เข้าสู่ระบบไม่สำเร็จ — " + (err?.message || ""));
    } finally {
      // ★ Phase 85.1 — restore button (success ก็ restore เผื่อ onAuthStateChange ช้า)
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  }

  // ─── "Forgot password?" — send reset link to staff email ───
  async function requestStaffPasswordReset() {
    const email = $("loginEmail")?.value.trim();
    if (!email) {
      showToast("กรอกอีเมลพนักงานก่อน");
      $("loginEmail")?.focus();
      return;
    }
    if (!state.supabase) {
      setText("authStatus", "ยังเชื่อมต่อ Supabase ไม่สำเร็จ");
      return;
    }

    const btn = $("forgotPasswordBtn");
    const originalText = btn?.textContent || "ลืมรหัสผ่าน?";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "กำลังส่งลิงก์...";
    }
    setText("authStatus", "กำลังส่งลิงก์ตั้งรหัสผ่านใหม่...");

    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setText("authStatus", "ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาตรวจอีเมล");
      showToast("ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว");
    } catch (err) {
      console.error("[requestStaffPasswordReset] error:", err);
      setText("authStatus", "ส่งลิงก์ไม่สำเร็จ: " + (err.message || "ไม่ทราบสาเหตุ"));
      showToast("ส่งลิงก์ไม่สำเร็จ");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  }

  return {
    login,
    requestStaffPasswordReset,
    showSetPasswordScreen,
    submitNewPassword
  };
}
