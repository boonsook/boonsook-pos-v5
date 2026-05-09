// Cloudflare Pages Function — POST /api/verify-slip
// ตรวจสอบสลิปโอนเงิน/QR — ดึงข้อมูล + ตรวจสัญญาณการตัดต่อ
//
// Env vars:
//   GEMINI_API_KEY — API key จาก https://aistudio.google.com/apikey
//
// Request: { image: "data:image/jpeg;base64,...", expected_amount?: number, expected_recipient?: string }
// Response: { ok, data: { type, sender_name, recipient_name, amount, datetime, transaction_id, ... }, verification: { amount_match, tampering_score, warnings } }

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  const apiKey = context.env?.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false, configured: false,
      error: "ยังไม่ตั้ง GEMINI_API_KEY ใน Cloudflare env vars"
    }), { status: 200, headers: corsHeaders });
  }

  try {
    const body = await context.request.json().catch(() => ({}));
    const image = String(body.image || "").trim();
    const expectedAmount = Number(body.expected_amount || 0);
    const expectedRecipient = String(body.expected_recipient || "").trim();

    if (!image) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีรูปสลิป" }), { status: 400, headers: corsHeaders });
    }

    const m = image.match(/^data:([^;]+);base64,(.+)$/);
    let mime, base64;
    if (m) { mime = m[1]; base64 = m[2]; }
    else { mime = body.mime || "image/jpeg"; base64 = image; }

    if (!base64 || base64.length < 100) {
      return new Response(JSON.stringify({ ok: false, error: "รูปสลิปไม่ถูกต้องหรือเล็กเกินไป" }), { status: 400, headers: corsHeaders });
    }

    // ★ Compact prompt — ลด token ของ schema + tampering_signs (ป้องกัน MAX_TOKENS truncate)
    const prompt = `OCR + ตรวจสลิปโอนเงิน/QR Payment ไทย — ส่ง JSON ตาม schema นี้เท่านั้น (no markdown):

{
"is_slip": bool,
"type": "transfer|qr|promptpay|internet_banking|atm|none",
"bank_from": string|null,
"bank_to": string|null,
"sender_name": string|null,
"sender_account": string|null,
"recipient_name": string|null,
"recipient_account": string|null,
"amount": number,
"fee": number,
"transaction_id": string|null,
"datetime": "YYYY-MM-DDTHH:MM"|null,
"tampering_score": 0-100,
"confidence": 0-100,
"tampering_note": string|null
}

กฎ:
- is_slip=false ถ้าไม่ใช่สลิป (รูปอื่น) → field อื่น null/0 ได้
- amount/fee: number เท่านั้น (no comma, no "บาท")
- tampering_score: 0=ปกติ, 100=ตัดต่อแน่
- tampering_note: ถ้า score>=30 ใส่เหตุสั้นๆ (≤80 ตัวอักษร) ไม่งั้น null
- confidence: 0-100 (ภาพชัด/ไม่ชัด)`;

    const geminiBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4000,  // ★ เพิ่มจาก 1500 — ภาษาไทยใช้ token เยอะ
        responseMimeType: "application/json"
      }
    };

    // ★ Fallback chain — เหมือน parse-receipt.js (1.5 family ถูกลบหมดแล้ว)
    const MODELS = [
      "gemini-2.5-flash",
      "gemini-2.0-flash-lite",
      "gemini-flash-latest",
      "gemini-2.0-flash"
    ];

    let r = null, usedModel = "";
    const attempts = [];
    for (const model of MODELS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (resp.ok) { r = resp; usedModel = model; break; }
        const errTxt = await resp.text();
        attempts.push(`${model}: ${resp.status} ${errTxt.slice(0, 120)}`);
        if (resp.status !== 404 && resp.status !== 429) {
          return new Response(JSON.stringify({
            ok: false,
            error: "Gemini API error " + resp.status,
            detail: errTxt.slice(0, 500),
            model
          }), { status: 200, headers: corsHeaders });
        }
      } catch (fetchErr) {
        clearTimeout(timer);
        if (fetchErr?.name === "AbortError") {
          return new Response(JSON.stringify({
            ok: false,
            error: "Gemini ตอบช้าเกิน 25 วินาที — ลองรูปเล็กกว่า"
          }), { status: 200, headers: corsHeaders });
        }
        attempts.push(`${model}: fetch ${fetchErr?.message || "fail"}`);
      }
    }

    if (!r) {
      return new Response(JSON.stringify({
        ok: false,
        error: "ไม่มี Gemini model ใดใช้งานได้",
        attempts
      }), { status: 200, headers: corsHeaders });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // ★ Robust JSON extraction — รองรับหลายรูปแบบ:
    //   1. JSON ล้วน → parse ได้เลย
    //   2. ```json ... ``` → strip code fence
    //   3. ข้อความก่อน + JSON + ข้อความหลัง → regex หา {...} block ใหญ่สุด
    let parsed = null;
    let parseError = null;
    const tryParse = (str) => {
      try { return JSON.parse(str); } catch(e) { parseError = e.message; return null; }
    };
    // 1. ลอง parse ตรงๆ
    parsed = tryParse(text.trim());
    // 2. Strip code fence
    if (!parsed) {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = tryParse(cleaned);
    }
    // 3. Extract first {...} block (greedy — รองรับ nested object)
    if (!parsed) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = tryParse(m[0]);
    }
    if (!parsed) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Gemini ส่ง JSON ไม่ valid",
        raw: text.slice(0, 800),
        parseError,
        model: usedModel,
        finishReason: data?.candidates?.[0]?.finishReason || null,
        promptFeedback: data?.promptFeedback || null
      }), { status: 200, headers: corsHeaders });
    }

    // ─── Verification: เปรียบเทียบกับค่าที่คาดหวัง ───
    const verification = { warnings: [] };
    if (parsed.is_slip === false) {
      verification.warnings.push("⚠️ รูปนี้อาจไม่ใช่สลิปโอนเงิน");
    }
    if (expectedAmount > 0 && parsed.amount > 0) {
      const diff = Math.abs(expectedAmount - parsed.amount);
      verification.amount_match = diff < 0.01;
      if (!verification.amount_match) {
        verification.warnings.push(`⚠️ ยอดเงินไม่ตรง — สลิป ${parsed.amount.toLocaleString()} ≠ คาด ${expectedAmount.toLocaleString()} (ผลต่าง ${diff.toLocaleString()})`);
      }
    }
    if (expectedRecipient && parsed.recipient_name) {
      // ★ Smart name match — ลบคำนำหน้า/ปีกกา/ธนาคาร ก่อนเทียบ substring
      const normalizeName = (s) => String(s || "")
        .toLowerCase()
        .replace(/^(ร้าน|บริษัท|หจก\.?|บจ\.?|บมจ\.?|จำกัด|มณี\s*shop|mn\s*shop)\s*/gi, "")
        .replace(/[\(\)\[\]]/g, " ")  // unwrap brackets — keep content
        .replace(/\b(scb|kbank|krungthai|bbl|ttb|kkp|gsb|baac|tisco|uob|mha|bay|cimb)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      const recipientNorm = normalizeName(parsed.recipient_name);
      const expectedNorm  = normalizeName(expectedRecipient);
      // เทียบ substring ทั้ง 2 ทิศทาง — รองรับชื่อยาว/สั้นต่างกัน
      verification.recipient_match = recipientNorm.length > 2 && expectedNorm.length > 2 && (
        recipientNorm.includes(expectedNorm) ||
        expectedNorm.includes(recipientNorm)
      );
      if (!verification.recipient_match) {
        verification.warnings.push(`⚠️ ชื่อผู้รับไม่ตรง — สลิป "${parsed.recipient_name}" ≠ คาด "${expectedRecipient}"`);
      }
    }
    if (parsed.tampering_score >= 30) {
      verification.warnings.push(`⚠️ ตรวจสัญญาณตัดต่อ — score ${parsed.tampering_score}/100`);
    }
    if (parsed.confidence < 50) {
      verification.warnings.push(`⚠️ อ่านสลิปไม่ชัด — confidence ${parsed.confidence}/100 (รูปอาจมัว/แสงน้อย)`);
    }
    verification.is_safe = verification.warnings.length === 0 && parsed.is_slip === true;

    return new Response(JSON.stringify({
      ok: true,
      data: parsed,
      verification
    }), { status: 200, headers: corsHeaders });

  } catch(e) {
    return new Response(JSON.stringify({
      ok: false,
      error: e?.message || String(e)
    }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    }
  });
}
