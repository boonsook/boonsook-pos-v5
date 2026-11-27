// line-webhook: รับข้อความแชทลูกค้าจาก LINE OA เข้า "กล่องแชทลูกค้า" (Phase 648 เฟส A)
// Endpoint: POST /api/line-webhook   (ตั้งเป็น Webhook URL ใน LINE Developers console)
//
// LINE เรียก endpoint นี้แบบ server-to-server — ไม่มี Supabase JWT จึงไม่อยู่ใน
// REQUIRE_AUTH_ENDPOINTS ของ _middleware.js. ด่านความปลอดภัยแทนคือ X-Line-Signature:
// HMAC-SHA256(LINE_CHANNEL_SECRET, raw body) → base64. ลายเซ็นไม่ตรง = ไม่แตะ DB เลย.
//
// Security invariants (ล็อกด้วย tests/line_webhook_guard.test.js):
//  - ตรวจลายเซ็นกับ raw body "ก่อน" JSON.parse และก่อนเรียก Supabase ทุกครั้ง; เทียบแบบ timing-safe.
//  - ไม่มี LINE_CHANNEL_SECRET → ปฏิเสธ (fail closed) ไม่ใช่ปล่อยผ่าน.
//  - รับเฉพาะ event type "message" และ "unsend" จากแชทส่วนตัว (source.type === "user") และ mode ไม่ใช่ standby.
//    OA ตัวนี้เป็นบอทแจ้งเตือนในกลุ่มร้านด้วย → ข้อความกลุ่ม/ห้อง (group/room) ห้ามเก็บ.
//  - เขียน DB ทางเดียวผ่าน RPC customer_chat_ingest_line / customer_chat_unsend_line (service_role)
//    — ไม่มี table/filter จาก request. ประมวลผลตามลำดับ event ใน payload.
//  - unsend: ลบเนื้อหาข้อความที่ลูกค้าถอน (body = NULL) — ไม่เก็บเนื้อหาที่ลูกค้ายกเลิกแล้ว.
//  - phase นี้ "ไม่ส่งข้อความหาลูกค้า" (ไม่เรียก reply/push API) → ไม่กินโควตา LINE.
//  - ไม่ส่ง error ดิบของ Supabase/LINE กลับ client และไม่ log เนื้อหาข้อความลูกค้า.

import { logServerError, clientError } from "./_error_sanitizer.js";

const PUBLIC_SUPABASE_URL = "https://rwmmjljelpcpwohwiplu.supabase.co";
const INGEST_RPC = "customer_chat_ingest_line";
const UNSEND_RPC = "customer_chat_unsend_line";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT = 5000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function base64ToBytes(b64) {
  try {
    const bin = atob(String(b64 || "").trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ตรวจ X-Line-Signature กับ raw body. คืน true เฉพาะเมื่อมี secret + signature และตรงกันจริง
export async function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!channelSecret || typeof channelSecret !== "string") return false;
  if (!signature || typeof signature !== "string") return false;
  const provided = base64ToBytes(signature);
  if (!provided || provided.length === 0) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(channelSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(rawBody ?? ""))));
  return timingSafeEqualBytes(provided, expected);
}

// แปลงข้อความ LINE แต่ละชนิดเป็นข้อความสั้นสำหรับแสดงในกล่องแชท (ไม่ดาวน์โหลดไฟล์/รูปในเฟสนี้)
export function describeLineMessage(message) {
  const type = typeof message?.type === "string" ? message.type : "unknown";
  switch (type) {
    case "text":
      return { type, body: String(message.text ?? "").slice(0, MAX_TEXT) };
    case "image":    return { type, body: "[รูปภาพ]" };
    case "video":    return { type, body: "[วิดีโอ]" };
    case "audio":    return { type, body: "[ข้อความเสียง]" };
    case "sticker":  return { type, body: "[สติกเกอร์]" };
    case "file":     return { type, body: `[ไฟล์] ${String(message.fileName ?? "").slice(0, 200)}`.trim() };
    case "location": {
      const parts = [message.title, message.address].filter((v) => typeof v === "string" && v.trim());
      return { type, body: `[ตำแหน่ง] ${parts.join(" ").slice(0, 300)}`.trim() };
    }
    default:
      return { type: type.slice(0, 32), body: "[ข้อความประเภทที่ยังไม่รองรับ]" };
  }
}

function eventTime(ev) {
  const ts = Number(ev?.timestamp);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date().toISOString();
}

function privateUserId(ev) {
  if (ev?.source?.type !== "user") return "";
  if (ev?.mode === "standby") return "";
  const userId = typeof ev.source.userId === "string" ? ev.source.userId.trim() : "";
  return userId && userId.length <= 128 ? userId : "";
}

// ดึง event ที่ต้องเก็บ ตามลำดับใน payload: ข้อความ + การยกเลิกข้อความ จากแชทส่วนตัวของลูกค้าเท่านั้น.
// group/room/standby/follow/อื่น ๆ ถูกทิ้งทั้งหมด
export function extractChatEvents(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const out = [];
  for (const ev of events) {
    const userId = privateUserId(ev);
    if (!userId) continue;
    if (ev?.type === "message") {
      const messageId = typeof ev?.message?.id === "string" ? ev.message.id.trim() : "";
      if (!messageId || messageId.length > 128) continue;
      const { type, body } = describeLineMessage(ev.message);
      out.push({ kind: "message", userId, messageId, type, body, sentAt: eventTime(ev) });
    } else if (ev?.type === "unsend") {
      const messageId = typeof ev?.unsend?.messageId === "string" ? ev.unsend.messageId.trim() : "";
      if (!messageId || messageId.length > 128) continue;
      out.push({ kind: "unsend", userId, messageId, unsentAt: eventTime(ev) });
    }
  }
  return out;
}

export function extractInboundMessages(payload) {
  return extractChatEvents(payload).filter((e) => e.kind === "message").map(({ kind: _k, ...m }) => m);
}

// ชื่อโปรไฟล์ LINE (GET — ไม่กินโควตาข้อความ). ล้มเหลว = null (RPC คงชื่อเดิมไว้)
async function fetchLineDisplayName(userId, accessToken) {
  if (!accessToken) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const name = typeof data?.displayName === "string" ? data.displayName.trim() : "";
    return name ? name.slice(0, 120) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callRpc(env, rpc, args) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = (env.SUPABASE_URL || PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`${base}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      logServerError("[line-webhook] rpc-failed", rpc, resp.status, detail.slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    logServerError("[line-webhook] rpc-error", rpc, e?.name || "error");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function ingestMessage(env, msg, displayName) {
  return callRpc(env, INGEST_RPC, {
    p_external_user_id: msg.userId,
    p_external_message_id: msg.messageId,
    p_message_type: msg.type,
    p_body: msg.body,
    p_sent_at: msg.sentAt,
    p_display_name: displayName,
  });
}

function unsendMessage(env, ev) {
  return callRpc(env, UNSEND_RPC, {
    p_external_user_id: ev.userId,
    p_external_message_id: ev.messageId,
    p_unsent_at: ev.unsentAt,
  });
}

export async function onRequestPost({ request, env }) {
  const channelSecret = env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    logServerError("[line-webhook] LINE_CHANNEL_SECRET not configured");
    return jsonResponse(clientError("not_configured", "webhook not configured"), 503);
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return jsonResponse(clientError("too_large", "payload too large"), 413);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(clientError("too_large", "payload too large"), 413);
  }

  const signature = request.headers.get("X-Line-Signature") || request.headers.get("x-line-signature");
  const valid = await verifyLineSignature(rawBody, signature, channelSecret);
  if (!valid) {
    return jsonResponse(clientError("bad_signature", "invalid signature"), 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(clientError("bad_json", "invalid JSON"), 400);
  }

  const chatEvents = extractChatEvents(payload);
  // ปุ่ม "Verify" ใน LINE console ส่ง events ว่าง → ตอบ 200 ได้เลย
  if (chatEvents.length === 0) return jsonResponse({ ok: true, stored: 0 });

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    logServerError("[line-webhook] SUPABASE_SERVICE_ROLE_KEY not configured");
    return jsonResponse(clientError("not_configured", "storage not configured"), 503);
  }

  const names = new Map();
  let failed = 0;
  for (const ev of chatEvents) {
    let ok;
    if (ev.kind === "unsend") {
      ok = await unsendMessage(env, ev);
    } else {
      if (!names.has(ev.userId)) {
        names.set(ev.userId, await fetchLineDisplayName(ev.userId, env.LINE_CHANNEL_ACCESS_TOKEN));
      }
      ok = await ingestMessage(env, ev, names.get(ev.userId));
    }
    if (!ok) failed++;
  }

  // ล้มเหลวบางข้อความ → 500 ให้ LINE ส่งซ้ำ (ถ้าเปิด redelivery); ข้อความที่เก็บแล้วไม่ซ้ำเพราะ unique id
  if (failed > 0) {
    return jsonResponse(clientError("store_failed", "store failed"), 500);
  }
  return jsonResponse({ ok: true, stored: chatEvents.length });
}
