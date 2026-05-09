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

    const prompt = `คุณเป็น OCR + ตรวจสอบสลิปโอนเงิน/QR Payment ของธนาคารไทย ดูรูปแล้วดึงข้อมูล + ประเมินความน่าเชื่อถือ ส่งกลับเป็น JSON เท่านั้น (ห้ามมี markdown หรือข้อความอื่น)

JSON schema:
{
  "is_slip": true/false,
  "type": "transfer" | "qr" | "promptpay" | "internet_banking" | "atm" | "none",
  "bank_from": "ธนาคารต้นทาง (เช่น KBank, SCB) หรือ null",
  "bank_to": "ธนาคารปลายทาง หรือ null",
  "sender_name": "ชื่อผู้โอน (string หรือ null)",
  "sender_account": "เลขบัญชี/เบอร์พร้อมเพย์ผู้โอน (มาส์กบ้างก็ใส่ตามนั้น) หรือ null",
  "recipient_name": "ชื่อผู้รับ (string หรือ null)",
  "recipient_account": "เลขบัญชี/พร้อมเพย์ผู้รับ หรือ null",
  "amount": 0,
  "fee": 0,
  "transaction_id": "เลข ref/transaction หรือ null",
  "datetime": "YYYY-MM-DDTHH:MM (เวลาไทย) หรือ null",
  "tampering_signs": ["รายการสัญญาณการตัดต่อ — ตัวอย่าง: 'ฟ้อนต์ amount ไม่ตรงกับ field อื่น', 'ขอบ rectangular crop ไม่ธรรมชาติ', 'pixel artifact รอบตัวเลข', 'สี background ไม่สม่ำเสมอ'"],
  "tampering_score": 0,
  "confidence": 0
}

กฎ:
- is_slip: true ถ้ารูปดูเหมือนสลิปโอนเงินจริงๆ, false ถ้าเป็นรูปอื่น (เช่น ใบเสร็จ, รูปสินค้า)
- amount: ตัวเลขเท่านั้น ไม่มีคอมม่า ไม่มี "บาท"
- tampering_score: 0-100 (0=ไม่มีสัญญาณ, 100=ตัดต่อแน่นอน) — ประเมินจากภาพรวม
- tampering_signs: array ว่าง [] ถ้าไม่เจออะไรน่าสงสัย
- confidence: 0-100 — ความมั่นใจในการอ่านข้อมูล (พื้นหลังชัด/ไม่ชัด)
- ถ้าไม่ใช่สลิป (is_slip=false) → field อื่นใส่ null/0 ได้
- ห้ามครอบด้วย \`\`\`json`;

    // Call Gemini Vision (gemini-2.5-flash — ฟรี 60 req/min, รองรับภาพ)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const geminiBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1500,
        responseMimeType: "application/json"
      }
    };

    const r = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody)
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return new Response(JSON.stringify({
        ok: false,
        error: `Gemini API error ${r.status}`,
        detail: errText.slice(0, 500)
      }), { status: 200, headers: corsHeaders });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Gemini ส่ง JSON ไม่ valid",
        raw: text.slice(0, 500)
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
      const recipientLower = parsed.recipient_name.toLowerCase();
      const expectedLower = expectedRecipient.toLowerCase();
      verification.recipient_match = recipientLower.includes(expectedLower) || expectedLower.includes(recipientLower);
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
