// ═══════════════════════════════════════════════════════════
//  api_utils.js — pure helpers (extracted from main.js Phase 86.1)
//
//  ห้าม depend กับ window state, DOM, supabase หรือ side-effect ใดๆ
//  เป็น pure functions ใช้ได้ทุก module
// ═══════════════════════════════════════════════════════════

/**
 * Format phone — ตัด non-digit + จำกัด 10 หลัก
 * @param {string|number} p input phone (อาจมีขีด/space)
 * @returns {string} digits only, max 10 chars
 */
export function formatPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(0, 10);
}

/**
 * API base URL ตาม environment
 *  - localhost dev (port ที่ไม่ใช่ 8787/8788) → boonsukair.com
 *  - localhost dev (port 8787/8788 = wrangler) → "" (relative)
 *  - production → window.location.origin
 *  - override: window.BSK_API_BASE หรือ localStorage "bsk_api_base"
 *
 * @returns {string} base URL ไม่มี trailing slash
 */
export function getApiBase() {
  const explicitBase = window.BSK_API_BASE || localStorage.getItem("bsk_api_base");
  if (explicitBase) return String(explicitBase).replace(/\/+$/, "");

  const host = window.location.hostname;
  const port = window.location.port;
  if ((host === "localhost" || host === "127.0.0.1") && port !== "8787" && port !== "8788") {
    return "https://boonsukair.com";
  }
  if (host === "localhost" || host === "127.0.0.1") return ""; // Cloudflare Pages dev
  return window.location.origin;
}

/**
 * อ่าน response เป็น JSON อย่างปลอดภัย — รองรับกรณี server ส่ง HTML/empty/non-JSON
 *
 * @param {Response} response fetch response
 * @param {string} label ใช้เป็น prefix ใน error message (เช่น "ส่ง OTP")
 * @returns {Promise<Object>} parsed JSON
 * @throws Error ถ้า response ไม่ใช่ JSON หรือ HTTP error
 */
export async function readApiJson(response, label) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!text) {
    if (!response.ok) {
      throw new Error(`${label}: server ขัดข้อง (HTTP ${response.status}) กรุณาลองใหม่อีกครั้ง`);
    }
    return {};
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`${label}: เซิร์ฟเวอร์ส่ง JSON ไม่ถูกต้อง`);
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    if (!response.ok) {
      throw new Error(`${label}: server ขัดข้อง (HTTP ${response.status}) กรุณาลองใหม่อีกครั้ง`);
    }
    throw new Error(`${label}: ไม่พบ API หรือ server คืนหน้าเว็บแทนข้อมูล กรุณาลองรีเฟรชหรือรอ deploy ให้เสร็จ`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    if (!response.ok) {
      throw new Error(`${label}: server ขัดข้อง (HTTP ${response.status}) กรุณาลองใหม่อีกครั้ง`);
    }
    throw new Error(`${label}: คำตอบจากเซิร์ฟเวอร์ไม่ถูกต้อง`);
  }
}
