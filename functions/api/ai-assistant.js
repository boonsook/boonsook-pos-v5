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
// Return: { reply, job_type, sub_service, description,
//           customer_name, customer_phone, customer_address,
//           estimated_price_range, urgency, summary }

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วย AI ของ "บุญสุขแอร์" (Boonsook Air) ร้านซ่อม-ติดตั้งแอร์และเครื่องใช้ไฟฟ้า
จังหวัด: ขอนแก่น (บริการทั่วภาคอีสาน)

หน้าที่: ช่วยลูกค้ากรอกใบแจ้งซ่อมโดยถามคำถามสั้นๆ ทีละข้อ เพื่อหา:
1. ประเภทบริการ (job_type)
2. อาการ/ปัญหา (description)
3. รุ่น/ยี่ห้อ ถ้ามี (ใส่ใน description)
4. ความเร่งด่วน
5. ชื่อลูกค้า (customer_name)
6. เบอร์ติดต่อ (customer_phone) — ต้องเป็นตัวเลข 9–10 หลัก
7. ที่อยู่/สถานที่หน้างาน (customer_address)

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
- ลำดับการถาม: (ก) ประเภทบริการ + อาการ → (ข) รุ่น/ยี่ห้อ/ขนาด BTU → (ค) ความเร่งด่วน → (ง) ชื่อลูกค้า → (จ) เบอร์ติดต่อ → (ฉ) ที่อยู่/สถานที่หน้างาน
- ถ้าลูกค้ายังไม่ได้บอก ชื่อ / เบอร์ / ที่อยู่ — ให้ขอเพิ่มก่อน done:true เสมอ
- เบอร์โทรต้องเป็นตัวเลขล้วน 9–10 หลัก (ถ้าลูกค้าพิมพ์มีขีด/เว้นวรรค ให้แปลงเป็นตัวเลขล้วนก่อนเก็บ) ถ้าไม่ครบหรือไม่ใช่ตัวเลขให้ถามใหม่
- ถ้าลูกค้าพิมพ์คลุมเครือ เช่น "แอร์ไม่เย็น" ให้ถามต่อว่า เริ่มเป็นเมื่อไหร่? มีน้ำหยดมั้ย? เสียงดังมั้ย?
- ประเมินราคาให้ช่วง (ไม่ฟันธง) เช่น "ประมาณ 500-1500 บาท ขึ้นกับอาการจริง"
- ห้ามรับปากเวลา — บอกแค่ "ช่างจะติดต่อกลับเพื่อยืนยันคิว"
- ตั้ง done:true ก็ต่อเมื่อมีครบ: job_type, description, customer_name, customer_phone, customer_address

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
  "customer_name": null,
  "customer_phone": null,
  "customer_address": null,
  "estimated_price_min": null,
  "estimated_price_max": null,
  "urgency": "normal",
  "needs_photo": false
}

ตัวอย่างเมื่อลูกค้าเพิ่งเริ่มเล่า "แอร์ไม่เย็น" (ยังไม่พอ → ถามต่อ):
{"reply":"เข้าใจแล้วครับ ขอถามเพิ่ม: แอร์ขนาดกี่ BTU และเริ่มไม่เย็นมานานแค่ไหนแล้วครับ?","done":false,"job_type":"ซ่อมแอร์","sub_service":null,"description":null,"customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":null,"estimated_price_max":null,"urgency":"normal","needs_photo":false}

ตัวอย่างเมื่อได้อาการครบแต่ยังไม่มีข้อมูลติดต่อ (→ ถามชื่อ):
{"reply":"ขอรบกวนชื่อคุณลูกค้าด้วยครับ เพื่อให้ช่างติดต่อกลับได้สะดวกครับ","done":false,"job_type":"ซ่อมแอร์","sub_service":"แอร์ไม่เย็น น้ำหยด","description":"แอร์ Daikin 12000 BTU ไม่เย็น มีน้ำหยดที่คอยล์เย็น เป็นมา 3 วัน","customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":true}

ตัวอย่างเมื่อมีชื่อแล้ว (→ ถามเบอร์):
{"reply":"ขอบคุณครับคุณสมชาย ขอเบอร์โทรติดต่อด้วยครับ (9–10 หลัก)","done":false,"job_type":"ซ่อมแอร์","sub_service":"แอร์ไม่เย็น น้ำหยด","description":"แอร์ Daikin 12000 BTU ไม่เย็น มีน้ำหยดที่คอยล์เย็น เป็นมา 3 วัน","customer_name":"สมชาย ใจดี","customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":true}

ตัวอย่างเมื่อมีเบอร์แล้ว (→ ถามที่อยู่):
{"reply":"ได้ครับ ขอที่อยู่หรือสถานที่หน้างานที่จะให้ช่างไปบริการด้วยครับ","done":false,"job_type":"ซ่อมแอร์","sub_service":"แอร์ไม่เย็น น้ำหยด","description":"แอร์ Daikin 12000 BTU ไม่เย็น มีน้ำหยดที่คอยล์เย็น เป็นมา 3 วัน","customer_name":"สมชาย ใจดี","customer_phone":"0812345678","customer_address":null,"estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":true}

ตัวอย่างเมื่อได้ข้อมูลครบแล้ว (→ done:true):
{"reply":"รับเรื่องแล้วครับคุณสมชาย ช่างจะโทรกลับที่เบอร์ 0812345678 เพื่อยืนยันคิวครับ","done":true,"job_type":"ซ่อมแอร์","sub_service":"แอร์ไม่เย็น น้ำหยด","description":"แอร์ Daikin 12000 BTU ไม่เย็น มีน้ำหยดที่คอยล์เย็น เป็นมา 3 วัน","customer_name":"สมชาย ใจดี","customer_phone":"0812345678","customer_address":"123 หมู่ 5 ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000","estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":true}`;

// normalize เบอร์โทร → ตัวเลขล้วน
function normalizePhone(s) {
  if (!s) return null;
  const digits = String(s).replace(/\D+/g, "");
  if (digits.length >= 9 && digits.length <= 10) return digits;
  return null;
}

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

    // Workers AI อาจคืนค่าได้หลายแบบ: string, object, หรือ array
    const rawResp = aiResp?.response;
    let raw = "";
    let parsed = null;

    if (rawResp && typeof rawResp === "object" && !Array.isArray(rawResp)) {
      // AI คืน object มาตรงๆ (เช่น json_object mode) → ใช้เลย ไม่ต้อง parse
      parsed = rawResp;
      raw = JSON.stringify(rawResp);
    } else {
      raw = String(rawResp == null ? "" : rawResp).trim();

      // พยายาม parse JSON จาก response — robust (regex สกัด block แรก)
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
    }

    if (!parsed) {
      // fallback: ถ้า parse ไม่ได้จริงๆ ใช้ raw เป็น reply
      parsed = {
        reply: raw || "ขอโทษครับ ลองพิมพ์ใหม่อีกครั้งได้ไหมครับ",
        done: false,
        job_type: null,
        sub_service: null,
        description: null,
        customer_name: null,
        customer_phone: null,
        customer_address: null,
        estimated_price_min: null,
        estimated_price_max: null,
        urgency: "normal",
        needs_photo: false,
      };
    }

    // ถ้า client ส่ง customerPhone มา (เช่น ลูกค้าที่ล็อกอินแล้ว) และ AI ยังไม่ได้เก็บ → prefill
    if (!parsed.customer_phone && customerPhone) {
      parsed.customer_phone = customerPhone;
    }

    // sanity-check fields
    const phoneClean = normalizePhone(parsed.customer_phone);

    const out = {
      reply: String(parsed.reply || "").slice(0, 2000),
      done: !!parsed.done,
      job_type: parsed.job_type || null,
      sub_service: parsed.sub_service ? String(parsed.sub_service).slice(0, 100) : null,
      description: parsed.description ? String(parsed.description).slice(0, 1000) : null,
      customer_name: parsed.customer_name ? String(parsed.customer_name).slice(0, 100) : null,
      customer_phone: phoneClean,
      customer_address: parsed.customer_address ? String(parsed.customer_address).slice(0, 300) : null,
      estimated_price_min: Number.isFinite(parsed.estimated_price_min) ? parsed.estimated_price_min : null,
      estimated_price_max: Number.isFinite(parsed.estimated_price_max) ? parsed.estimated_price_max : null,
      urgency: ["normal", "urgent", "emergency"].includes(parsed.urgency) ? parsed.urgency : "normal",
      needs_photo: !!parsed.needs_photo,
    };

    // ป้องกัน done:true ถ้าข้อมูลติดต่อไม่ครบจริงๆ
    if (out.done) {
      if (!out.customer_name || !out.customer_phone || !out.customer_address || !out.job_type) {
        out.done = false;
      }
    }

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
