// Cloudflare Pages Function — POST /api/verify-otp
// ตรวจสอบ OTP แบบ stateless ด้วย HMAC และคืน deterministic authPassword สำหรับ Supabase

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    const { phone, code, hash, expiresAt } = await context.request.json();

    if (!phone || !code || !hash || !expiresAt) {
      return new Response(JSON.stringify({ ok: false, error: "ข้อมูลไม่ครบ" }), { status: 400, headers: corsHeaders });
    }

    // เช็คหมดอายุ
    if (Date.now() > expiresAt) {
      return new Response(JSON.stringify({ ok: false, error: "OTP หมดอายุ กรุณาขอใหม่" }), { status: 400, headers: corsHeaders });
    }

    // ตรวจสอบ HMAC
    // ★ SECURITY: ไม่มี default fallback — ต้องตั้ง OTP_SECRET ใน Cloudflare Pages env vars
    if (!context.env.OTP_SECRET) {
      console.error("[verify-otp] OTP_SECRET not configured in Cloudflare Pages env vars");
      return new Response(JSON.stringify({ ok: false, error: "ระบบ OTP ยังไม่พร้อมใช้งาน (missing server config)" }), { status: 500, headers: corsHeaders });
    }
    const secret = context.env.OTP_SECRET;
    const cleanPhone = phone.replace(/\D/g, "");
    const payload = `${cleanPhone}:${code}:${expiresAt}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expectedHash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (hash !== expectedHash) {
      return new Response(JSON.stringify({ ok: false, error: "รหัส OTP ไม่ถูกต้อง" }), { status: 400, headers: corsHeaders });
    }

    // * OTP ถูกต้อง — สร้าง deterministic authPassword สำหรับ Supabase Auth
    //   เบอร์เดียวกันได้ password เหมือนเดิมทุกครั้ง (ลูกค้าเก่า login ซ้ำได้)
    //   Attacker คำนวณเองไม่ได้ (ต้องรู้ OTP_SECRET ฝั่ง server)
    const authPayload = `${cleanPhone}:auth-v1`;
    const authSig = await crypto.subtle.sign("HMAC", key, encoder.encode(authPayload));
    const authPassword = "bsk_" + Array.from(new Uint8Array(authSig)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);

    return new Response(JSON.stringify({
      ok: true,
      phone: cleanPhone,
      authPassword
    }), { status: 200, headers: corsHeaders });

  } catch (e) {
    console.error("[verify-otp] server error:", e);
    return new Response(JSON.stringify({ ok: false, error: "ระบบตรวจ OTP ขัดข้อง กรุณาลองใหม่" }), { status: 500, headers: corsHeaders });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
