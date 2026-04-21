// Cloudflare Pages Function — POST /api/line-notify
// Proxy ไป LINE Messaging API (push) — แทน LINE Notify เดิมที่ถูกปิดไปตั้งแต่ 2025-03-31
//
// Env vars ที่ต้องตั้งใน Cloudflare Pages > Settings > Environment variables:
//   LINE_CHANNEL_ACCESS_TOKEN  — channel access token จาก LINE Developer Console (Messaging API channel)
//   LINE_USER_ID               — userId ปลายทางที่จะรับข้อความ (ขึ้นต้นด้วย U...)
//
// ถ้ายังไม่ตั้งค่า endpoint จะตอบ 200 พร้อม { ok:false, configured:false } — UI จะแสดง "ยังไม่ตั้งค่า"

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    const body = await context.request.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    // target: "queue" | "done" | "default" (default = LINE_USER_ID)
    const target = String(body.target || "default").trim().toLowerCase();

    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: "ข้อความว่าง" }), {
        status: 400, headers: corsHeaders
      });
    }

    // ตัดความยาว LINE limit = 5000 chars ต่อ text message
    const safeMessage = message.length > 4900 ? message.slice(0, 4900) + "\n…(ตัดทอน)" : message;

    const token = context.env.LINE_CHANNEL_ACCESS_TOKEN;
    // ★ เลือกปลายทางตาม target (มี fallback เป็น LINE_USER_ID เสมอ)
    const userId = context.env.LINE_USER_ID;
    let recipient = userId;
    if (target === "queue") {
      recipient = context.env.LINE_GROUP_QUEUE || userId;
    } else if (target === "done") {
      recipient = context.env.LINE_GROUP_DONE || userId;
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

      let detail = null;
      if (!resp.ok) {
        try { detail = await resp.text(); } catch { /* ignore */ }
      }
      results.push({ to, status: resp.status, ok: resp.ok, detail });
    }

    const allOk = results.every(r => r.ok);
    return new Response(JSON.stringify({
      ok: allOk,
      configured: true,
      results
    }), { status: allOk ? 200 : 502, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), {
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
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
