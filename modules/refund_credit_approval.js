// Phase 646: client transport only. Authorization, amount and source validation live in SQL.
const RPC_NAMES = new Set([
  "phase646_submit_credit_refund",
  "phase646_admin_decide_credit_refund",
  "phase646_finalize_credit_refund"
]);

export function isCreditRefundMethod(method) {
  return method === "credit" || method === "exchange";
}

export async function callCreditRefundRpc(name, params, deps = {}) {
  if (!RPC_NAMES.has(name)) return { ok: false, error: "คำสั่งคืนเครดิตไม่ถูกต้อง" };
  const cfg = deps.config || globalThis.window?.SUPABASE_CONFIG;
  const token = deps.token || globalThis.window?._sbAccessToken;
  const request = deps.fetchImpl || globalThis.fetch;
  if (!cfg?.url || !cfg?.anonKey || !token || typeof request !== "function") {
    return { ok: false, error: "ยังไม่เชื่อมต่อบัญชีผู้ใช้" };
  }
  try {
    const response = await request(`${cfg.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.anonKey,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(params || {})
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: "ฐานข้อมูลไม่ยืนยันคำสั่งคืนเครดิต" };
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { ok: false, uncertain: true, error: "ไม่ทราบผลคำสั่งคืนเครดิต — ตรวจรายการเดิมก่อนลองใหม่" };
    }
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch {
    return { ok: false, uncertain: true, error: "ไม่ทราบผลคำสั่งคืนเครดิต — ตรวจรายการเดิมก่อนลองใหม่" };
  }
}

export async function readCreditRefundRequests(deps = {}) {
  const cfg = deps.config || globalThis.window?.SUPABASE_CONFIG;
  const token = deps.token || globalThis.window?._sbAccessToken;
  const request = deps.fetchImpl || globalThis.fetch;
  if (!cfg?.url || !cfg?.anonKey || !token || typeof request !== "function") {
    return { ok: false, error: "ยังไม่เชื่อมต่อบัญชีผู้ใช้" };
  }
  try {
    const response = await request(`${cfg.url}/rest/v1/credit_refund_requests?select=*&order=created_at.desc&limit=100`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return { ok: false, error: "โหลดคำขอคืนเครดิตไม่สำเร็จ" };
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) ? { ok: true, data: rows } : { ok: false, error: "ข้อมูลคำขอคืนเครดิตไม่ถูกต้อง" };
  } catch {
    return { ok: false, error: "โหลดคำขอคืนเครดิตไม่สำเร็จ" };
  }
}
