// Cloudflare Pages Function — POST /api/send-otp
// Sends SMS OTP via Twilio. Dev-code fallback is disabled unless explicitly
// enabled for a non-production runtime.

const DEV_OTP_RUNTIMES = new Set(["dev", "development", "local", "staging", "test"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function runtimeName(env = {}) {
  return String(env.APP_ENV || env.ENVIRONMENT || env.NODE_ENV || "").trim().toLowerCase();
}

function isDevOtpAllowed(context) {
  const env = context.env || {};
  const hostname = new URL(context.request.url).hostname;
  return isTrue(env.OTP_DEV_MODE) && (LOCAL_HOSTS.has(hostname) || DEV_OTP_RUNTIMES.has(runtimeName(env)));
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function devOtpResponse({ hash, expiresAt, phone, code, notice, headers }) {
  return jsonResponse({
    ok: true,
    hash,
    expiresAt,
    phone,
    dev: true,
    devCode: code,
    devNotice: notice
  }, 200, headers);
}

function otpUnavailable(headers, status = 503) {
  return jsonResponse({
    ok: false,
    error: "ระบบส่ง OTP ยังไม่พร้อมใช้งาน กรุณาลองใหม่หรือติดต่อร้าน"
  }, status, headers);
}

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  const allowDevOtp = isDevOtpAllowed(context);

  try {
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ ok: false, error: "รูปแบบคำขอ OTP ไม่ถูกต้อง" }, 400, corsHeaders);
    }
    const { phone } = body;
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      return new Response(JSON.stringify({ ok: false, error: "เบอร์โทรไม่ถูกต้อง" }), { status: 400, headers: corsHeaders });
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
    // ★ SECURITY: ไม่มี default fallback — ต้องตั้ง OTP_SECRET ใน Cloudflare Pages env vars
    if (!context.env.OTP_SECRET) {
      console.error("[send-otp] OTP_SECRET not configured in Cloudflare Pages env vars");
      return new Response(JSON.stringify({ ok: false, error: "ระบบ OTP ยังไม่พร้อมใช้งาน (missing server config)" }), { status: 500, headers: corsHeaders });
    }
    const secret = context.env.OTP_SECRET;
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

    // Dev fallback is opt-in only; production must fail closed instead of leaking the OTP.
    if (!accountSid || !authToken || !fromNumber) {
      console.error("[send-otp] Twilio credentials not configured");
      if (allowDevOtp) {
        return devOtpResponse({
          hash,
          expiresAt,
          phone: cleanPhone,
          code,
          notice: "OTP_DEV_MODE: Twilio credentials are not configured",
          headers: corsHeaders
        });
      }
      return otpUnavailable(corsHeaders, 503);
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      To: e164,
      From: fromNumber,
      Body: `Boonsook POS: รหัส OTP ของคุณคือ ${code} (หมดอายุใน 5 นาที)`
    });

    // Wrap Twilio call so provider errors can be logged and returned safely.
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
      if (allowDevOtp) {
        return devOtpResponse({
          hash,
          expiresAt,
          phone: cleanPhone,
          code,
          notice: "Twilio: " + twilioErrorMsg,
          headers: corsHeaders
        });
      }
      // Avoid returning HTTP 502 from Pages Functions. Cloudflare may replace
      // worker-generated 502 bodies with a plain edge error, which breaks JSON
      // parsing on the client and hides the real OTP provider problem.
      return otpUnavailable(corsHeaders, 503);
    }

    // ส่ง hash + expiresAt กลับ (ไม่ส่ง code กลับ!)
    return new Response(JSON.stringify({
      ok: true,
      hash,
      expiresAt,
      phone: cleanPhone
    }), { status: 200, headers: corsHeaders });

  } catch (e) {
    console.error("[send-otp] server error:", e);
    return new Response(JSON.stringify({ ok: false, error: "ระบบส่ง OTP ขัดข้อง กรุณาลองใหม่" }), { status: 500, headers: corsHeaders });
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
