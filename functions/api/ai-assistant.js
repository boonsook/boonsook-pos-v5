// functions/api/ai-assistant.js
// Cloudflare Pages Function - AI ช่วยลูกค้ากรอกใบแจ้งซ่อม
// Binding ที่ต้องมี: AI (Workers AI)
//
// ติดตั้ง:
//   1. วางไฟล์นี้ไว้ที่  /functions/api/ai-assistant.js  ใน repo boonsook-pos-v5-github
//   2. Cloudflare Pages → Settings → Functions → Bindings → Add binding
//      Type: Workers AI   |   Variable name: AI
//   3. commit + push → Cloudflare auto-deploy
//
// Endpoint: POST /api/ai-assistant
// Body: { message: string, history?: [{role, content}], customerPhone?: string }
// Return: { reply, suggested_category, sub_service, estimated_price_range, urgency, summary }

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วย AI ของ "บุญสุขแอร์" (Boonsook Air) ร้านซ่อม-ติดตั้งแอร์และเครื่องใช้ไฟฟ้า
จังหวัด: ขอนแก่น (บริการทั่วภาคอีสาน)

หน้าที่: ช่วยลูกค้ากรอกใบแจ้งซ่อมโดยถามคำถามสั้นๆ ทีละข้อ เพื่อหา:
1. ประเภทบริการ (job_type)
2. อาการ/ปัญหา (description)
3. รุ่น/ยี่ห้อ ถ้ามี (ใส่ใน description)
4. ความเร่งด่วน

หมวดบริการ 9 อย่างที่เราให้บริการ (ต้องเลือก 1 ใน 9 นี้เท่านั้น):
- "ซ่อมแอร์"        → แอร์ไม่เย็น, เสียงดัง, น้ำหยด, รีโมทใช้ไม่ได้  (ราคา 500-3500 บ.)
- "ล้างแอร์"        → ล้างทำความสะอาด  (9000 BTU: 500 / 12000-18000: 700 / 24000+: 900 บ.)
- "ย้ายแอร์"        → ถอด-ย้าย-ติดใหม่  (2500-4500 บ.)
- "ติดตั้งแอร์"     → ติดแอร์ใหม่  (2500-4000 บ. + ค่าท่อถ้าเกิน 4 ม.)
- "จานดาวเทียม"     → ติดตั้ง/ซ่อมจาน PSI/GMM/Thaicom  (800-3500 บ.)
- "ซ่อมตู้เย็น"     → ไม่เย็น, รั่ว, เสียงดัง  (500-4500 บ.)
- "ซ่อมเครื่องซักผ้า" → ไม่ปั่น, ไม่ระบายน้ำ, รั่ว  (500-3500 บ.)
- "CCTV"           → ติดตั้ง/ซ่อม/ย้ายกล้องวงจรปิด  (1500-8000 บ. ต่อจุด)
- "ซ่อมทีวี"        → ทีวี LED/LCD เปิดไม่ติด, ภาพเพี้ยน  (500-3500 บ.)

กฎการตอบ:
- ใช้ภาษาไทยสุภาพ เป็นกันเอง เรียกลูกค้าว่า "คุณลูกค้า" หรือ "ครับ/ค่ะ"
- ถามทีละข้อ สั้นๆ ไม่เกิน 2 ประโยค/ครั้ง
- พอได้ข้อมูลครบ (รู้ประเภท + อาการ) ให้สรุปและ return JSON ตาม format
- ถ้าลูกค้าพิมพ์คลุมเครือ เช่น "แอร์ไม่เย็น" ให้ถามต่อว่า เริ่มเป็นเมื่อไหร่? มีน้ำหยดมั้ย? เสียงดังมั้ย?
- ประเมินราคาให้ช่วง (ไม่ฟันธง) เช่น "ประมาณ 500-1500 บาท ขึ้นกับอาการจริง"
- ห้ามรับปากเวลา — บอกแค่ "ช่างจะติดต่อกลับเพื่อยืนยันคิว"

Format ตอบกลับ (STRICT JSON, ไม่มี markdown):
{
  "reply": "ข้อความตอบลูกค้า (ภาษาไทย)",
  "done": false,          // true เมื่อได้ข้อมูลครบพอจะสร้างใบแจ้งซ่อม
  "job_type": "ซ่อมแอร์" หรือ null,
  "sub_service": "อาการหลักสั้นๆ 3-6 คำ" หรือ null,
  "description": "รายละเอียดเต็มจากที่คุยกัน" หรือ null,
  "estimated_price_min": 500 หรือ null,
  "estimated_price_max": 1500 หรือ null,
  "urgency": "normal" / "urgent" / "emergency",
  "needs_photo": true/false  // ถ้าควรให้ลูกค้าส่งรูปมาด้วย
}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };

  try {
    if (!env.AI) {
      return new Response(
        JSON.stringify({
          error: "AI binding not configured",
          hint: "Go to Cloudflare Pages → Settings → Functions → Bindings → Add AI binding named 'AI'",
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { message, history = [], customerPhone } = body || {};

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "message is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // สร้าง messages array สำหรับ Llama
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-8).map((h) => ({
        role: h.role === "user" ? "user" : "assistant",
        content: String(h.content || "").slice(0, 1000),
      })),
      { role: "user", content: message.slice(0, 1000) },
    ];

    // เรียก Workers AI (Llama 3.3 70B fp8-fast, ฟรี 10,000 req/วัน)
    const aiResp = await env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages,
        max_tokens: 512,
        temperature: 0.7,
      }
    );

    const raw = (aiResp?.response || "").trim();

    // พยายาม parse JSON จาก response
    let parsed = null;
    try {
      // ตัด markdown code fence ถ้ามี
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // ถ้า parse ไม่ได้ → ใช้ raw text เป็น reply อย่างเดียว
      parsed = {
        reply: raw || "ขอโทษครับ ลองพิมพ์ใหม่อีกครั้งได้ไหมครับ",
        done: false,
        job_type: null,
        sub_service: null,
        description: null,
        estimated_price_min: null,
        estimated_price_max: null,
        urgency: "normal",
        needs_photo: false,
      };
    }

    // sanity-check fields
    const out = {
      reply: String(parsed.reply || "").slice(0, 2000),
      done: !!parsed.done,
      job_type: parsed.job_type || null,
      sub_service: parsed.sub_service ? String(parsed.sub_service).slice(0, 100) : null,
      description: parsed.description ? String(parsed.description).slice(0, 1000) : null,
      estimated_price_min: Number.isFinite(parsed.estimated_price_min) ? parsed.estimated_price_min : null,
      estimated_price_max: Number.isFinite(parsed.estimated_price_max) ? parsed.estimated_price_max : null,
      urgency: ["normal", "urgent", "emergency"].includes(parsed.urgency) ? parsed.urgency : "normal",
      needs_photo: !!parsed.needs_photo,
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "AI assistant failed",
        detail: String(err?.message || err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
