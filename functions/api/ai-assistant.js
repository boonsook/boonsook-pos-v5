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

⚠️ CRITICAL OUTPUT RULES — อ่านให้ชัดก่อนตอบทุกครั้ง:
- ตอบกลับเป็น JSON object เท่านั้น ขึ้นต้นด้วย { ลงท้ายด้วย }
- ห้ามเขียนข้อความ/คำอธิบาย/markdown ก่อนหรือหลัง JSON เด็ดขาด
- ห้ามใช้ triple backtick code fence
- ข้อความที่จะให้ลูกค้าเห็น ใส่ในฟิลด์ "reply" เท่านั้น
- ทุกฟิลด์ต้องมีครบตาม schema แม้ค่าจะเป็น null

Schema:
{
  "reply": "ข้อความตอบลูกค้าภาษาไทย (1-3 ประโยค เท่านั้น)",
  "done": false,
  "job_type": null,
  "sub_service": null,
  "description": null,
  "estimated_price_min": null,
  "estimated_price_max": null,
  "urgency": "normal",
  "needs_photo": false
}

ตัวอย่างเมื่อลูกค้าเพิ่งเริ่มเล่า "แอร์ไม่เย็น" (ยังไม่พอ → ถามต่อ):
{"reply":"เข้าใจแล้วครับ ขอถามเพิ่ม: แอร์ขนาดกี่ BTU และเริ่มไม่เย็นมานานแค่ไหนแล้วครับ?","done":false,"job_type":"ซ่อมแอร์","sub_service":null,"description":null,"estimated_price_min":null,"estimated_price_max":null,"urgency":"normal","needs_photo":false}

ตัวอย่างเมื่อได้ข้อมูลครบแล้ว (→ done:true):
{"reply":"รับเรื่องแล้วครับ ช่างจะโทรกลับเพื่อยืนยันคิวครับ","done":true,"job_type":"ซ่อมแอร์","sub_service":"แอร์ไม่เย็น น้ำหยด","description":"แอร์ Daikin 12000 BTU ไม่เย็น มีน้ำหยดที่คอยล์เย็น เป็นมา 3 วัน","estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":true}`;

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
        temperature: 0.3,
        // response_format: { type: "json_object" }, // disabled
      }
    );

    const raw = (aiResp?.response || "").trim();

    // พยายาม parse JSON จาก response — robust (regex สกัด block แรก)
    let parsed = null;
    try {
      // 1) ลอง parse raw ก่อน
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 2) ลอง strip markdown
        const stripped = raw
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
        try {
          parsed = JSON.parse(stripped);
        } catch {
          // 3) regex สกัด JSON object แรก { ... } (greedy หา } ตัวสุดท้าย)
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              parsed = JSON.parse(m[0]);
            } catch {}
          }
        }
      }
    } catch {}

    if (\!parsed) {
      // fallback: ถ้า parse ไม่ได้จริงๆ ใช้ raw เป็น reply
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
