// Cloudflare Pages Function — POST /api/verify-slipok
//
// Phase 543 (audit S14): server-side proxy for SlipOK slip verification (api.slipok.com).
//   The customer dashboard used to read the SlipOK API key from browser localStorage
//   (bsk_slipok_key) and call api.slipok.com directly with `x-authorization: <key>` — exposing the
//   shop's key in every customer's browser + Network tab. Now the browser calls THIS proxy; the
//   key lives only in Cloudflare env.
//
// Env:
//   SLIPOK_API_KEY    required — x-authorization for api.slipok.com
//   SLIPOK_BRANCH_ID  optional — branch path segment (default "0")
//
// The key, branch, and the raw upstream SlipOK body are NEVER returned to the client. On any
// failure we log detail server-side (Cloudflare logs) and return a generic, normalized result.

import { logServerError } from "./_error_sanitizer.js";

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });

  try {
    const apiKey = context.env?.SLIPOK_API_KEY;
    if (!apiKey) {
      // not configured → graceful: the dashboard lets the slip through to manual review (no crash)
      return json({ valid: false, ok: false, configured: false, error: "no_api", message: "SlipOK ยังไม่พร้อมใช้งาน" });
    }
    const branchId = String(context.env?.SLIPOK_BRANCH_ID || "0").trim() || "0";

    const body = await context.request.json().catch(() => ({}));
    const image = typeof body.image === "string" ? body.image : "";
    const expectedAmount = Number(body.expected_amount) || 0;

    // validate the data URL / base64 safely (cap ~6MB raw)
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(image);
    const b64 = m ? m[2].replace(/\s+/g, "") : "";
    if (!b64 || b64.length > 8_000_000) {
      return json({ valid: false, error: "bad_image", message: "ไฟล์สลิปไม่ถูกต้อง" }, 400);
    }
    let bytes;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_e) {
      return json({ valid: false, error: "bad_image", message: "ไฟล์สลิปไม่ถูกต้อง" }, 400);
    }
    const mime = m[1] || "image/jpeg";

    const form = new FormData();
    form.append("files", new Blob([bytes], { type: mime }), "slip.jpg");
    if (expectedAmount > 0) form.append("amount", String(expectedAmount));

    let resp;
    try {
      resp = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branchId)}`, {
        method: "POST",
        headers: { "x-authorization": apiKey },
        body: form
      });
    } catch (e) {
      logServerError("[verify-slipok] upstream fetch failed", e?.message || String(e));
      return json({ valid: false, error: "network", message: "ตรวจสอบสลิปไม่ได้ — ลองใหม่อีกครั้ง" });
    }

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      logServerError("[verify-slipok] upstream error", resp.status, text.slice(0, 500));
      return json({ valid: false, error: "api_error", message: "ตรวจสอบสลิปไม่สำเร็จ" });
    }

    let data = null;
    try { data = JSON.parse(text); } catch (_e) { /* fall through to invalid */ }

    if (data && data.success) {
      const d = data.data || {};
      const amount = Number(d.amount || 0);
      const amountMatch = !expectedAmount || Math.abs(amount - expectedAmount) < 1;
      // normalized shape consumed by customer_dashboard _verifySlip — NO `raw` (never leak upstream body)
      return json({
        valid: true,
        amountMatch,
        amount: d.amount ?? null,
        sender: d.sender?.name || d.sendingBank || "",
        receiver: d.receiver?.name || "",
        transRef: d.transRef || "",
        date: d.transDate || ""
      });
    }

    // invalid / fake / duplicate slip → generic client message; detail stays server-side
    logServerError("[verify-slipok] slip invalid", text.slice(0, 300));
    return json({ valid: false, error: "invalid", message: "สลิปไม่ถูกต้องหรือเป็นสลิปปลอม" });
  } catch (e) {
    logServerError("[verify-slipok] unhandled", e?.message || String(e), e?.stack);
    return json({ valid: false, error: "internal", message: "ตรวจสอบสลิปไม่สำเร็จ" }, 500);
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
