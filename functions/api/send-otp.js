// Cloudflare Pages Function — POST /api/send-otp
// ส่ง SMS OTP จริงผ่าน Twilio API พร้อม fallback แสดง OTP บนจอถ้า Twilio fail

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    const { phone } = await context.request.json();
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      return new Response(JSON.stringify({ error: "เบอร์โทรไม่ถูกต้อง" }), { status: 400, headers: corsHeaders });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    // แปลงเบอร์ไทย 0xxx → +66xxx
    const e164 = cleanPhone.startsWith("0")
      ? "+66" + cleanPhone.slice(1)
      : cleanPhone.startsWith("66") ? "+" + cleanPhone : "+66" + cleanPhone;

    // สร้าง OTP 6 หลัก
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 นาที

    // สร้าง HMAC signature สำหรับ verify ฝั่ง server (stateless)
    const secret = context.env.OTP_SECRET || "bsk-otp-default-secret";
    const payload = `${cleanPhone}:${code}:${expiresAt}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const hash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

    // ส่ง SMS ผ่าน Twilio
    const accountSid = context.env.TWILIO_ACCOUNT_SID;
    const authToken = context.env.TWILIO_AUTH_TOKEN;
    const fromNumber = context.env.TWILIO_FROM_NUMBER;

    // * DEV/DEMO fallback - if Twilio env vars are not set, return OTP via JSON for on-screen display
    if (!accountSid || !authToken || !fromNumber) {
      return new Response(JSON.stringify({
        ok: true,
        hash,
        expiresAt,
        phone: cleanPhone,
        dev: true,
        devCode: code,
        devNotice: "โหมดทดสอบ — ยังไม่ได้ตั้ง Twilio credentials บน Cloudflare Pages"
      }), { status: 200, headers: corsHeaders });
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      To: e164,
      From: fromNumber,
      Body: `Boonsook POS: รหัส OTP ของคุณคือ ${code} (หมดอายุใน 5 นาที)`
    });

    // * FALLBACK: wrap Twilio call so trial limit / unverified number / rate limit / network error
    //   จะไม่ทำให้ร้านขายของไม่ได้ — จะโชว์ OTP บนจอแทน
    let twilioFailed = false;
    let twilioErrorMsg = "";
    try {
      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: twilioBody.toString()
      });

      if (!twilioRes.ok) {
        const twilioData = await twilioRes.json().catch(() => ({}));
        console.error("Twilio error:", twilioData);
        twilioFailed = true;
        twilioErrorMsg = twilioData.message || `HTTP ${twilioRes.status}`;
      }
    } catch (fetchErr) {
      console.error("Twilio fetch error:", fetchErr);
      twilioFailed = true;
      twilioErrorMsg = fetchErr.message || "network error";
    }

    if (twilioFailed) {
      // * โชว์ OTP บนจอแทน — ร้านทำงานต่อได้ แม้ Twilio trial/down/rate-limit
      return new Response(JSON.stringify({
        ok: true,
        hash,
        expiresAt,
        phone: cleanPhone,
        dev: true,
        devCode: code,
        devNotice: "Twilio: " + twilioErrorMsg + " — แสดง OTP บนจอแทน"
      }), { status: 200, headers: corsHeaders });
    }

    // ส่ง hash + expiresAt กลับ (ไม่ส่ง code กลับ!)
    return new Response(JSON.stringify({
      ok: true,
      hash,
      expiresAt,
      phone: cleanPhone
    }), { status: 200, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
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
