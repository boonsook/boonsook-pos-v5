// Cloudflare Pages Function — POST /api/line-notify
// Proxy ไป LINE Messaging API (push) — แทน LINE Notify เดิมที่ถูกปิดไปตั้งแต่ 2025-03-31
//
// Env vars ที่ต้องตั้งใน Cloudflare Pages > Settings > Environment variables:
//   LINE_CHANNEL_ACCESS_TOKEN  — channel access token จาก LINE Developer Console (Messaging API channel)
//   LINE_USER_ID               — userId ปลายทางที่จะรับข้อความ (ขึ้นต้นด้วย U...)
//
// ถ้ายังไม่ตั้งค่า endpoint จะตอบ 200 พร้อม { ok:false, configured:false } — UI จะแสดง "ยังไม่ตั้งค่า"
// Phase 516 (audit S4): sanitize error responses — log full detail server-side, never to client.
// Phase 535 (audit S4): same for per-recipient push results — drop raw upstream body (`detail`)
//   and recipient id (`to`) from the client response; the full body is logged server-side only.

import { logServerError, clientError } from "./_error_sanitizer.js";

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  try {
    const body = await context.request.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    // target: "queue" | "done" | "default" (default = LINE_USER_ID)
    const target = String(body.target || "default").trim().toLowerCase();

    const token = context.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = context.env.LINE_USER_ID;

    // Phase 531: probe mode — เช็ค env จริงโดย "ไม่ส่ง LINE" (badge สถานะหน้าตั้งค่า).
    //   ก่อนหน้านี้หน้าเว็บ probe ด้วย body ว่าง → endpoint คืน 400 (เช็คก่อน env) → เดาผิดว่า env ตั้งแล้ว.
    //   early-return แยกจาก flow ส่งจริง — ไม่แตะ empty-message check / recipient / fetch ด้านล่าง.
    if (body.probe === true) {
      return new Response(JSON.stringify({ ok: false, configured: !!(token && userId), probe: true }), {
        status: 200, headers: corsHeaders
      });
    }

    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: "ข้อความว่าง" }), {
        status: 400, headers: corsHeaders
      });
    }

    // ตัดความยาว LINE limit = 5000 chars ต่อ text message
    const safeMessage = message.length > 4900 ? message.slice(0, 4900) + "\n…(ตัดทอน)" : message;

    // ★ เลือกปลายทางตาม target (มี fallback เป็น LINE_USER_ID เสมอ)
    let recipient = userId;
    // Phase 391: usedFallback = boolean เท่านั้น (ไม่เปิดเผย id/secret) — แจ้ง client ว่า queue/done
    //   ตกไปที่ LINE_USER_ID เพราะยังไม่ได้ตั้งกลุ่ม (LINE_GROUP_QUEUE / LINE_GROUP_DONE)
    let usedFallback = false;
    if (target === "queue") {
      const grp = context.env.LINE_GROUP_QUEUE;
      recipient = grp || userId;
      usedFallback = !grp && !!userId;
    } else if (target === "done") {
      const grp = context.env.LINE_GROUP_DONE;
      recipient = grp || userId;
      usedFallback = !grp && !!userId;
    }

    if (!token || !recipient) {
      // ไม่โยน error — แค่บอกว่ายังไม่ config เพื่อให้ UI แสดงคำแนะนำ
      return new Response(JSON.stringify({
        ok: false,
        configured: false,
        target,
        error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID (หรือ LINE_GROUP_QUEUE / LINE_GROUP_DONE) บน Cloudflare Pages"
      }), { status: 200, headers: corsHeaders });
    }

    // รองรับกรณีส่งหลายคน/หลายกลุ่ม (comma-separated)
    const targets = recipient.split(",").map(s => s.trim()).filter(Boolean);

    const results = [];
    for (const to of targets) {
      const resp = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          to,
          messages: [{ type: "text", text: safeMessage }]
        })
      });

      // Phase 535 (S4): the upstream LINE body may carry recipient id / quota / token state /
      //   diagnostic detail — log it server-side (Cloudflare logs) but NEVER return it to the
      //   client. The per-recipient client result is HTTP status + ok only (no `to`, no `detail`).
      if (!resp.ok) {
        let detail = null;
        try { detail = await resp.text(); } catch { /* ignore */ }
        logServerError("[line-notify] LINE push failed", { status: resp.status, detail });
      }
      results.push({ status: resp.status, ok: resp.ok });
    }

    const allOk = results.every(r => r.ok);
    return new Response(JSON.stringify({
      ok: allOk,
      configured: true,
      target,
      usedFallback,
      results
    }), { status: allOk ? 200 : 502, headers: corsHeaders });

  } catch (e) {
    // Phase 516: never leak raw exception message to client — log server-side
    logServerError("[line-notify] unhandled", e?.message || String(e), e?.stack);
    return new Response(JSON.stringify(clientError("internal_error", "ส่งแจ้งเตือนไม่สำเร็จ")), {
      status: 500, headers: corsHeaders
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
