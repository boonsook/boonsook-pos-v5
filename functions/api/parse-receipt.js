// Cloudflare Pages Function — POST /api/parse-receipt
// AutoKey สลิป — รับรูปใบเสร็จซัพพลายเออร์ → Gemini Vision → return JSON
//
// Env vars ที่ต้องตั้งใน Cloudflare Pages > Settings > Environment variables:
//   GEMINI_API_KEY  — API key จาก https://aistudio.google.com/apikey
//                     (ฟรี 60 requests/minute สำหรับ gemini-1.5-flash)
//
// Request:
//   POST /api/parse-receipt
//   Content-Type: application/json
//   Body: { image: "data:image/jpeg;base64,...", mime?: "image/jpeg" }
//
// Response (success):
//   { ok: true, data: { vendor, address, tax_id, date, total, items, raw_text } }
//
// Response (error):
//   { ok: false, error: "...", configured?: false }

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
      ok: false,
      configured: false,
      error: "ยังไม่ตั้ง GEMINI_API_KEY ใน Cloudflare env vars"
    }), { status: 200, headers: corsHeaders });
  }

  try {
    const body = await context.request.json().catch(() => ({}));
    const image = String(body.image || "").trim();
    if (!image) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีรูปภาพ" }), { status: 400, headers: corsHeaders });
    }

    // image is data URL: "data:image/jpeg;base64,XXXX"
    const m = image.match(/^data:([^;]+);base64,(.+)$/);
    let mime, base64;
    if (m) {
      mime = m[1];
      base64 = m[2];
    } else {
      mime = body.mime || "image/jpeg";
      base64 = image;
    }

    if (!base64 || base64.length < 100) {
      return new Response(JSON.stringify({ ok: false, error: "รูปภาพไม่ถูกต้องหรือเล็กเกินไป" }), { status: 400, headers: corsHeaders });
    }

    const prompt = `คุณเป็น OCR ใบเสร็จร้านค้า/ซัพพลายเออร์ภาษาไทย ดูรูปนี้แล้วดึงข้อมูลออกมาเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น)

JSON schema:
{
  "vendor": "ชื่อร้าน/บริษัทผู้ออกใบเสร็จ (string หรือ null)",
  "address": "ที่อยู่ผู้ออก (string หรือ null)",
  "tax_id": "เลขประจำตัวผู้เสียภาษี 13 หลัก (string ตัวเลขเท่านั้น หรือ null)",
  "date": "วันที่ออกใบเสร็จ ในรูป YYYY-MM-DD (หรือ null ถ้าอ่านไม่ได้)",
  "doc_no": "เลขที่ใบเสร็จ/ใบกำกับ (string หรือ null)",
  "total": "ยอดรวมสุดท้ายเป็นตัวเลข (number ไม่มีคอมม่า) — ใส่ตัวเลขเท่านั้น ห้ามใส่หน่วย",
  "items": [
    { "name": "ชื่อสินค้า", "qty": 1, "price": 0, "amount": 0 }
  ],
  "category_guess": "หมวดที่น่าจะเป็น เลือกจาก: น้ำมันรถ / ค่าน้ำ / ค่าไฟ / ค่าโทรศัพท์ / ค่าอินเทอร์เน็ต / ซื้อสินค้า / ค่าซ่อม / ค่าเช่า / ค่าอาหาร / อื่นๆ"
}

กฎสำคัญ:
- ตัวเลขเงินทั้งหมดไม่ใส่คอมม่า ไม่ใส่ "บาท"
- ถ้าไม่เจอ field ไหน ให้ใส่ null อย่าเดา
- items เอาเฉพาะรายการสินค้า — ไม่รวม subtotal/tax/total
- ถ้าใบเสร็จเก่ามีแต่ยอดรวม ไม่ต้องแยก items — ใส่ "items": []
- response ต้องเป็น JSON ที่ valid parse ได้เท่านั้น ห้ามครอบด้วย markdown \`\`\`json`;

    // gemini-1.5-flash ถูก deprecated → ใช้ gemini-2.0-flash (free tier) แทน
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    };

    // Timeout safety — Cloudflare Pages Functions มี wall time limit ~30s
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);

    let r;
    try {
      r = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      const isAbort = fetchErr?.name === "AbortError";
      return new Response(JSON.stringify({
        ok: false,
        error: isAbort ? "Gemini ตอบช้าเกิน 25 วินาที — ลองรูปเล็กกว่า" : ("Gemini fetch failed: " + (fetchErr?.message || "unknown"))
      }), { status: 200, headers: corsHeaders });
    }
    clearTimeout(timer);

    if (!r.ok) {
      const errTxt = await r.text();
      // ★ status 200 เสมอ — ป้องกัน Cloudflare intercept/replace 5xx ของ origin
      return new Response(JSON.stringify({
        ok: false,
        error: "Gemini API error " + r.status,
        detail: errTxt.slice(0, 500)
      }), { status: 200, headers: corsHeaders });
    }

    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed = null;
    try {
      // Clean potential code fences just in case
      const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        error: "AI ตอบกลับไม่ใช่ JSON ที่ valid",
        raw: text.slice(0, 500)
      }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, data: parsed }), { status: 200, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack ? String(e.stack).slice(0, 300) : undefined
    }), { status: 200, headers: corsHeaders });
  }
}

// Handle preflight
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
