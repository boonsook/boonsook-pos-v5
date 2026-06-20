// Cloudflare Pages Function — POST /api/verify-otp
// ตรวจสอบ OTP แบบ stateless ด้วย HMAC และคืน deterministic authPassword สำหรับ Supabase
//
// Phase 510 (security): server-side attempt cap ต่อ "issued OTP" — เดาผิดได้สูงสุด 5 ครั้ง
//   แล้ว lock (429) จน OTP หมดอายุ/ขอใหม่. กันเคส attacker เรียก /api/send-otp เอา hash+expiresAt
//   ของเหยื่อ แล้ว brute-force code 000000-999999 (client-side cap ฝั่ง _pendingOtp.attempts
//   bypass ได้). middleware rate-limit (/api/verify-otp 10/min/IP) = coarse per-IP เท่านั้น
//   ไม่ผูกกับ issued OTP — ไม่ใช่ attempt cap จริง.

const MAX_OTP_ATTEMPTS = 5;

// HMAC-SHA256 → hex (ใช้ร่วมกัน: expectedHash / authPassword / attempt-key derivation)
async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });

  try {
    const { phone, code, hash, expiresAt } = await context.request.json();

    if (!phone || !code || !hash || !expiresAt) {
      return json({ ok: false, error: "ข้อมูลไม่ครบ" }, 400);
    }

    // เช็คหมดอายุ — ก่อนแตะ attempt store → OTP หมดอายุไม่สร้าง attempt key ค้าง
    if (Date.now() > expiresAt) {
      return json({ ok: false, error: "OTP หมดอายุ กรุณาขอใหม่" }, 400);
    }

    // ★ SECURITY: ไม่มี default fallback — ต้องตั้ง OTP_SECRET ใน Cloudflare Pages env vars
    if (!context.env.OTP_SECRET) {
      console.error("[verify-otp] OTP_SECRET not configured in Cloudflare Pages env vars");
      return json({ ok: false, error: "ระบบ OTP ยังไม่พร้อมใช้งาน (missing server config)" }, 500);
    }
    const secret = context.env.OTP_SECRET;
    const cleanPhone = phone.replace(/\D/g, "");

    // ── Phase 510: server-side attempt cap (per issued OTP) ──
    // KV binding "RATE_LIMIT_KV" (เดียวกับ middleware). ★ ไม่มี KV → fail-closed (ห้าม silently
    // อนุญาตให้ brute-force ไม่จำกัด); attempt store เป็น "ด่านความปลอดภัยจริง" ไม่ใช่ coarse limit.
    const kv = context.env.RATE_LIMIT_KV;
    if (!kv) {
      console.error("[verify-otp] RATE_LIMIT_KV not bound — cannot enforce OTP attempt cap (fail-closed)");
      return json({ ok: false, error: "ระบบ OTP ยังไม่พร้อมใช้งาน (missing server config)" }, 503);
    }

    // key = HMAC(secret, phone:expiresAt:hash) → ผูกกับ "issued OTP" ตัวนั้น (เปลี่ยน code
    //   ไม่ reset counter); ไม่เก็บ raw phone/code/otp ใน KV key. attacker เปลี่ยน hash เอง
    //   ไม่ช่วย(ต้องใช้ hash จริงของ issued OTP ถึงจะมีสิทธิ์ผ่าน code-check).
    const attemptKey = "otpatt:" + await hmacHex(secret, `otp-attempt:${cleanPhone}:${expiresAt}:${hash}`);

    let attempts = 0;
    try {
      const cur = await kv.get(attemptKey);
      attempts = cur ? (parseInt(cur, 10) || 0) : 0;
    } catch (e) {
      console.error("[verify-otp] KV read error (fail-closed):", e.message);
      return json({ ok: false, error: "ระบบตรวจ OTP ขัดข้อง กรุณาลองใหม่" }, 503);
    }

    if (attempts >= MAX_OTP_ATTEMPTS) {
      return json({ ok: false, error: "ลองผิดเกินกำหนด กรุณาขอ OTP ใหม่", locked: true }, 429);
    }

    // ── ตรวจสอบ HMAC ──
    const expectedHash = await hmacHex(secret, `${cleanPhone}:${code}:${expiresAt}`);

    if (hash !== expectedHash) {
      // เดาผิด → increment counter (TTL = อายุ OTP ที่เหลือ + buffer สั้น)
      const ttl = Math.max(30, Math.min(900, Math.ceil((expiresAt - Date.now()) / 1000) + 30));
      try {
        await kv.put(attemptKey, String(attempts + 1), { expirationTtl: ttl });
      } catch (e) {
        console.error("[verify-otp] KV write error (fail-closed):", e.message);
        return json({ ok: false, error: "ระบบตรวจ OTP ขัดข้อง กรุณาลองใหม่" }, 503);
      }
      const newAttempts = attempts + 1;
      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        return json({ ok: false, error: "ลองผิดเกินกำหนด กรุณาขอ OTP ใหม่", locked: true }, 429);
      }
      return json({ ok: false, error: "รหัส OTP ไม่ถูกต้อง", remaining: MAX_OTP_ATTEMPTS - newAttempts }, 400);
    }

    // ── OTP ถูกต้อง — reset attempt key (best-effort; ถ้าลบไม่ได้ก็ TTL หมดเอง ไม่กระทบความปลอดภัย) ──
    try { await kv.delete(attemptKey); } catch (e) { console.warn("[verify-otp] attempt key cleanup failed (non-fatal):", e.message); }

    // สร้าง deterministic authPassword สำหรับ Supabase Auth
    //   เบอร์เดียวกันได้ password เหมือนเดิมทุกครั้ง (ลูกค้าเก่า login ซ้ำได้)
    //   Attacker คำนวณเองไม่ได้ (ต้องรู้ OTP_SECRET ฝั่ง server)
    const authPassword = "bsk_" + (await hmacHex(secret, `${cleanPhone}:auth-v1`)).slice(0, 32);

    return json({ ok: true, phone: cleanPhone, authPassword }, 200);

  } catch (e) {
    console.error("[verify-otp] server error:", e);
    return json({ ok: false, error: "ระบบตรวจ OTP ขัดข้อง กรุณาลองใหม่" }, 500);
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
