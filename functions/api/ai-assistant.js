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
//           estimated_price_range, urgency, needs_photo,
//           quick_replies, done }

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

หมวดบริการ 15 อย่างที่เราให้บริการ (ต้องเลือก 1 อย่างเท่านั้น):
— งานเครื่องใช้ไฟฟ้า/แอร์ (9 อย่าง):
- "ซ่อมแอร์"        → แอร์ไม่เย็น, เสียงดัง, น้ำหยด, รีโมทใช้ไม่ได้  (ราคา 500-3500 บ.)
- "ล้างแอร์"        → ล้างทำความสะอาด (ราคาตาม ตารางล่าง — ต้องถามก่อน)
- "ย้ายแอร์"        → ถอด-ย้าย-ติดใหม่  (2500-4500 บ.)
- "ติดตั้งแอร์"     → ติดแอร์ใหม่  (2500-4000 บ. + ค่าท่อถ้าเกิน 4 ม.)
- "จานดาวเทียม"     → ติดตั้ง/ซ่อมจาน PSI/GMM/Thaicom  (800-3500 บ.)
- "ซ่อมตู้เย็น"     → ไม่เย็น, รั่ว, เสียงดัง  (500-4500 บ.)
- "ซ่อมเครื่องซักผ้า" → ไม่ปั่น, ไม่ระบายน้ำ, รั่ว  (500-3500 บ.)
- "CCTV"           → ติดตั้ง/ซ่อม/ย้ายกล้องวงจรปิด  (1500-8000 บ. ต่อจุด)
- "ซ่อมทีวี"        → ทีวี LED/LCD เปิดไม่ติด, ภาพเพี้ยน  (500-3500 บ.)

— งานโซล่าเซลล์ (6 อย่าง) — ใช้ชื่อให้ตรงเป๊ะ:
- "ติดตั้งปั๊มน้ำโซล่าเซลล์"       → ปั๊มบาดาล/ผิวดิน + แผงโซล่า  (15,000-45,000 บ.)
- "ติดตั้งชุดออนกริดโซล่าเซลล์"    → On-Grid ขายไฟคืนการไฟฟ้า  (60,000-250,000 บ. / 3-10 kW)
- "ติดตั้งชุดออฟกริดโซล่าเซลล์"    → Off-Grid ใช้กับแบตเตอรี่  (40,000-180,000 บ.)
- "ติดตั้งชุดไฮบริดโซล่าเซลล์"     → Hybrid ใช้ได้ทั้ง on/off grid  (80,000-300,000 บ.)
- "ซ่อม & เซอร์วิสระบบโซล่าเซลล์"  → ตรวจเช็ค/ซ่อมแผง/อินเวอร์เตอร์  (500-5,000 บ.)
- "งานโซล่าเซลล์อื่นๆ"            → ปรึกษา/ประเมินหน้างาน (ใส่รายละเอียดใน description)

⚠️ สำหรับงานโซล่าเซลล์ — ก่อนประเมินราคา ถามเพิ่ม:
- ขนาดระบบ (กี่ kW หรือกี่แผง) → quick_replies: ["3 kW","5 kW","10 kW","ไม่ทราบ"]
- ยี่ห้อที่สนใจ (ถ้ามี) → ใส่ใน description
- ถ้าเป็นปั๊มน้ำ: ความลึกบ่อ/ระยะท่อ → ถามสั้นๆ 1 ครั้ง

📊 ตารางราคาล้างแอร์ (เริ่มต้น 500 บาททุกขนาด):
* แอร์ติดผนัง (Wall-mounted / Split):
  - 9,000–12,000 BTU     : 500–800 บาท
  - 15,000–18,000 BTU    : 600–1,000 บาท
  - 20,000–24,000 BTU    : 700–1,200 บาท
* แอร์แขวน / ตั้งพื้น / ฝังเพดาน:
  - 12,000–15,000 BTU    : 800–1,000 บาท
  - 18,000–22,000 BTU    : 1,000–1,500 บาท
  - 24,000–28,000 BTU    : 1,200–1,800 บาท
  - 30,000–33,000 BTU    : 1,300–2,000 บาท
  - 36,000–40,000 BTU    : 1,500–2,000 บาท
  - 40,000–60,000 BTU    : 2,000–3,000 บาท

⚠️ สำหรับ "ล้างแอร์" — ก่อนประเมินราคา ต้องถาม 2 อย่างให้ครบ:
1) ชนิดแอร์: ติดผนัง / แขวน / ตั้งพื้น / ฝังเพดาน  (quick_replies: ["ติดผนัง","แขวน","ตั้งพื้น","ฝังเพดาน"])
2) ขนาด BTU (quick_replies: ["9000","12000","18000","24000","30000","36000+"])
— ถ้ายังไม่ได้ข้อมูล 2 อย่างนี้ ห้ามใส่ estimated_price_min/max (ให้เป็น null หรือใช้ช่วง 500–3000)
— ลูกค้าถามราคา: ตอบตามตารางด้านบนเป๊ะ ห้ามเดา


📋 Error Code (เมื่อลูกค้าหรือช่างถามรหัส error / E1 / F3 / CH02 / IE / 21E ฯลฯ):
— มีหน้าในระบบ 3 หน้าที่ค้นรหัสได้ครบ: "Error Code แอร์", "Error Code ตู้เย็น", "Error Code เครื่องซักผ้า"
— ถ้าลูกค้ารู้ยี่ห้อ+รหัส ช่วยตีความให้เบื้องต้นจากความรู้ทั่วไป เช่น:
  แอร์ Daikin: E1=PCB, E3=HP, E4=LP, E5=คอมฯร้อน, U4=สัญญาณตัวใน-นอก, F3=ท่อทางออก
  แอร์ Mitsubishi Electric: E6=สื่อสาร, P1-P9=เซ็นเซอร์, U1-U9=ป้องกันตัวนอก
  แอร์ Samsung: E1xx=ตัวใน, E2xx=ตัวนอก, E4xx=คอมฯ/inverter
  แอร์ LG: CH01-09=เซ็นเซอร์, CH10+=คอมฯ/IPM, CH21-27=inverter
  แอร์ Panasonic: F11=4-way, F17=ฟิลเตอร์ตัน, H11=PCB, H97=พัดลมตัวนอก
  ตู้เย็น Samsung: 21E/22E=พัดลม, 25E=ฮีตเตอร์ละลาย, 39E=ice maker, PC=inverter
  ตู้เย็น LG: Er rS/FS/dS=เซ็นเซอร์, Er FF/CF=พัดลม, Er IS=ice maker
  ซักผ้า Samsung: 4E=น้ำเข้า, 5E=ระบายน้ำ, UE=unbalance, dE=ประตู, Sud=ฟองมาก
  ซักผ้า LG: IE=น้ำเข้า, OE=ระบายน้ำ, UE=unbalance, dE=ประตู, LE=มอเตอร์
— หลังตีความแล้ว แนะนำ: "ดูรายละเอียดเพิ่มในหน้า Error Code [เครื่อง] ได้ครับ — มีครบ 40+ ยี่ห้อ"
— อย่ารับปากว่าเสีย 100% — ให้เป็น "น่าจะเกิดจาก..." และแนะนำให้ลองเบื้องต้นก่อนเรียกช่าง
— ถ้าไม่รู้ยี่ห้อ ถามยี่ห้อก่อนตีความ
— ถ้าเป็นปัญหาที่ต้องใช้ช่าง → แนะนำ "แจ้งซ่อม" ต่อ และถามข้อมูลติดต่อตามปกติ


กฎการตอบ:
- ใช้ภาษาไทยสุภาพ เป็นกันเอง เรียกลูกค้าว่า "คุณลูกค้า" หรือ "ครับ/ค่ะ"
- ถามทีละข้อ สั้นๆ ไม่เกิน 2 ประโยค/ครั้ง ห้ามถามซ้ำข้อมูลที่ลูกค้าบอกแล้ว
- ลำดับการถาม: (ก) ประเภทบริการ + อาการ → (ข) ขนาด/BTU (ถ้าจำเป็น) → (ค) ความเร่งด่วน → (ง) ชื่อ+เบอร์+ที่อยู่ (ขอพร้อมกันในครั้งเดียว)
- ขอข้อมูลติดต่อแบบรวบ: "ขอชื่อ เบอร์ และที่อยู่ด้วยครับ (พิมพ์รวมในบรรทัดเดียวก็ได้)" — ไม่ถามแยกทีละอย่าง
- เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก (มีขีด/เว้นวรรคได้ แปลงเป็นเลขล้วน) ถ้าไม่ครบให้ถามเฉพาะเบอร์ใหม่
- ⚠️ ที่อยู่: รับแบบสั้นๆ ได้เลย เช่น "บ้านโพธิ์", "หมู่ 3 โนนศิลา", "ตลาดบ้านแฮด" — ห้ามถามรายละเอียดเพิ่มเช่น "หมู่บ้านหรือถนนอะไรครับ" (ช่างจะโทรไปสอบถามเองตอนจัดคิว)
- ⚠️ ลูกค้าส่งข้อมูลหลายอย่างในข้อความเดียว (เช่น "นนท์ บ้านโพธิ์ 0857632657") → แยกเป็น customer_name + customer_address + customer_phone แล้วตั้ง done:true ทันที — ห้ามถามเพิ่ม
- ถ้าลูกค้าพิมพ์คลุมเครือ เช่น "แอร์ไม่เย็น" ใช้ chip ช่วย ไม่ต้องถามปลายเปิดเยอะ
- ประเมินราคาให้ช่วง (ไม่ฟันธง) เช่น "ประมาณ 500-1500 บาท ขึ้นกับอาการจริง"
- ห้ามรับปากเวลา — บอกแค่ "ช่างจะติดต่อกลับเพื่อยืนยันคิว"
- ตั้ง done:true ทันทีที่มีครบ: job_type, customer_name, customer_phone, customer_address (รายละเอียดอื่นไม่บังคับ)

⭐ QUICK_REPLIES — สำคัญมาก (ช่วยลูกค้าไม่ต้องพิมพ์เยอะ):
- ใส่ปุ่มตัวเลือกให้ลูกค้าแตะเลือกใน field "quick_replies" (array of strings, 2–6 ปุ่ม)
- แต่ละปุ่มต้องสั้น ไม่เกิน 18 ตัวอักษร
- ใช้ quick_replies เมื่อ:
    • ถามประเภทบริการ (หน้าทั่วไป) → ["ซ่อมแอร์","ล้างแอร์","ย้ายแอร์","ติดตั้งแอร์","จานดาวเทียม","ซ่อมตู้เย็น","ซ่อมเครื่องซักผ้า","CCTV","ซ่อมทีวี"]
    • ถามประเภทงานโซล่า (เมื่อ page=solar) → ["ติดตั้งปั๊มน้ำโซล่าเซลล์","ติดตั้งชุดออนกริดโซล่าเซลล์","ติดตั้งชุดออฟกริดโซล่าเซลล์","ติดตั้งชุดไฮบริดโซล่าเซลล์","ซ่อม & เซอร์วิสระบบโซล่าเซลล์","งานโซล่าเซลล์อื่นๆ"]
    • ถามอาการแอร์ → ["ไม่เย็น","น้ำหยด","เสียงดัง","รีโมทใช้ไม่ได้","เย็นน้อย"]
    • ถามอาการตู้เย็น → ["ไม่เย็น","น้ำรั่ว","เสียงดัง","ช่องแช่แข็งไม่ทำงาน"]
    • ถามอาการซักผ้า → ["ไม่ปั่น","ไม่ระบายน้ำ","น้ำรั่ว","ไม่หมุน"]
    • ถามขนาด BTU → ["9000","12000","18000","24000","30000+"]
    • ถามขนาดระบบโซล่า (kW) → ["3 kW","5 kW","10 kW","ไม่ทราบ"]
    • ถามประเภทปั๊มน้ำโซล่า → ["ปั๊มบาดาล","ปั๊มผิวดิน","ไม่ทราบ"]
    • ถามยี่ห้อ → ["Daikin","Mitsubishi","Samsung","LG","Haier","อื่นๆ"]
    • ถามยี่ห้ออินเวอร์เตอร์โซล่า → ["Huawei","Growatt","Deye","SMA","อื่นๆ"]
    • ถามเป็นมานานเท่าไหร่ → ["วันนี้","1–3 วัน","1 สัปดาห์","นานแล้ว"]
    • ถามความเร่งด่วน → ["ปกติ","เร่งด่วน","ด่วนมาก"]
    • ถามจำนวนกล้อง CCTV → ["1 ตัว","2 ตัว","4 ตัว","8 ตัว","อื่นๆ"]
- ไม่ใช้ quick_replies (ปล่อยว่าง []) เมื่อถาม: ชื่อ, เบอร์โทร, ที่อยู่ (ลูกค้าต้องพิมพ์เอง)
- quick_replies ต้องสอดคล้องกับคำถามในฟิลด์ reply

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
  "needs_photo": false,
  "quick_replies": []
}

ตัวอย่างเมื่อลูกค้าเพิ่งทักเข้ามา (ยังไม่รู้ประเภท):
{"reply":"สวัสดีครับ ให้ช่วยเรื่องไหนดีครับ?","done":false,"job_type":null,"sub_service":null,"description":null,"customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":null,"estimated_price_max":null,"urgency":"normal","needs_photo":false,"quick_replies":["ซ่อมแอร์","ล้างแอร์","ย้ายแอร์","ติดตั้งแอร์","จานดาวเทียม","ซ่อมตู้เย็น","ซ่อมเครื่องซักผ้า","CCTV","ซ่อมทีวี"]}

ตัวอย่างเมื่อลูกค้าเลือก "ซ่อมแอร์" (→ ถามอาการ พร้อม chip):
{"reply":"รับเรื่องซ่อมแอร์ครับ อาการที่เจอเป็นแบบไหนครับ?","done":false,"job_type":"ซ่อมแอร์","sub_service":null,"description":null,"customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":3500,"urgency":"normal","needs_photo":false,"quick_replies":["ไม่เย็น","น้ำหยด","เสียงดัง","รีโมทใช้ไม่ได้","เย็นน้อย"]}

ตัวอย่างเมื่อลูกค้าเลือก "ไม่เย็น" (→ ถาม BTU พร้อม chip):
{"reply":"แอร์ขนาดกี่ BTU ครับ?","done":false,"job_type":"ซ่อมแอร์","sub_service":"ไม่เย็น","description":"แอร์ไม่เย็น","customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":2500,"urgency":"normal","needs_photo":false,"quick_replies":["9000","12000","18000","24000","30000+"]}


ตัวอย่างเมื่อลูกค้าเลือก "ล้างแอร์" (→ ถามชนิดแอร์ก่อน):
{"reply":"รับเรื่องล้างแอร์ครับ แอร์ของคุณลูกค้าเป็นแบบไหนครับ?","done":false,"job_type":"ล้างแอร์","sub_service":null,"description":null,"customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":3000,"urgency":"normal","needs_photo":false,"quick_replies":["ติดผนัง","แขวน","ตั้งพื้น","ฝังเพดาน"]}

ตัวอย่างต่อเมื่อเลือก "ติดผนัง" แล้ว (→ ถาม BTU):
{"reply":"แอร์ติดผนังขนาดกี่ BTU ครับ?","done":false,"job_type":"ล้างแอร์","sub_service":"ติดผนัง","description":"ล้างแอร์ติดผนัง","customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":500,"estimated_price_max":1200,"urgency":"normal","needs_photo":false,"quick_replies":["9000","12000","18000","24000"]}

ตัวอย่างเมื่อเลือก "18000 ติดผนัง" (→ ตีราคาได้แล้ว 600-1000 บาท แล้วขอข้อมูลติดต่อรวบ):
{"reply":"ล้างแอร์ติดผนัง 18,000 BTU ราคาประมาณ 600–1,000 บาทครับ ขอชื่อ เบอร์ และที่อยู่ด้วยครับ (พิมพ์รวมในบรรทัดเดียวก็ได้)","done":false,"job_type":"ล้างแอร์","sub_service":"ติดผนัง 18000 BTU","description":"ล้างแอร์ติดผนัง 18,000 BTU","customer_name":null,"customer_phone":null,"customer_address":null,"estimated_price_min":600,"estimated_price_max":1000,"urgency":"normal","needs_photo":false,"quick_replies":[]}

ตัวอย่างเมื่อลูกค้าส่ง "นนท์ บ้านโพธิ์ 0857632657" มาในครั้งเดียว (→ done:true ทันที ห้ามถามเพิ่ม):
{"reply":"รับเรื่องแล้วครับคุณนนท์ ช่างจะโทรกลับที่ 0857632657 เพื่อยืนยันคิวและสอบถามที่อยู่เพิ่มเติมครับ","done":true,"job_type":"ล้างแอร์","sub_service":"ติดผนัง 18000 BTU","description":"ล้างแอร์ติดผนัง 18,000 BTU","customer_name":"นนท์","customer_phone":"0857632657","customer_address":"บ้านโพธิ์","estimated_price_min":600,"estimated_price_max":1000,"urgency":"urgent","needs_photo":false,"quick_replies":[]}

ตัวอย่างเมื่อได้เฉพาะชื่อ+เบอร์ ยังไม่ได้ที่อยู่ (→ ขอที่อยู่สั้นๆ):
{"reply":"ขอที่อยู่คร่าวๆ ด้วยครับ (ตำบล/หมู่บ้าน/จุดสังเกต) ช่างจะโทรสอบถามเพิ่มตอนจัดคิว","done":false,"job_type":"ล้างแอร์","sub_service":"ติดผนัง 18000 BTU","description":"ล้างแอร์ติดผนัง 18,000 BTU","customer_name":"สมชาย","customer_phone":"0812345678","customer_address":null,"estimated_price_min":600,"estimated_price_max":1000,"urgency":"normal","needs_photo":false,"quick_replies":[]}`;

// normalize เบอร์โทร → ตัวเลขล้วน
function normalizePhone(s) {
  if (!s) return null;
  const digits = String(s).replace(/\D+/g, "");
  if (digits.length >= 9 && digits.length <= 10) return digits;
  return null;
}

// ดึงเบอร์โทรไทย (9-10 หลัก) จากข้อความใดๆ
function extractPhoneFromText(s) {
  if (!s) return null;
  // จับกลุ่มตัวเลข 9-10 หลักที่อาจมี ขีด/เว้นวรรค/วงเล็บ
  const m = String(s).match(/(?:\d[\s\-.]?){9,10}/);
  if (!m) return null;
  return normalizePhone(m[0]);
}

// แยก ชื่อ + ที่อยู่ จากข้อความที่เหลือหลังตัดเบอร์ออก
// สมมติรูปแบบ: "นนท์ บ้านโพธิ์ 0857632657" → ชื่อ="นนท์", ที่อยู่="บ้านโพธิ์"
function splitNameAddress(text, phoneRaw) {
  if (!text) return { name: null, address: null };
  // ตัดเบอร์โทรออกก่อน
  let rest = String(text);
  if (phoneRaw) {
    rest = rest.replace(phoneRaw, " ");
  }
  // ตัดอักษรที่ไม่ใช่ตัวอักษร/ตัวเลข ที่ติดกับเบอร์ออก
  rest = rest.replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!rest) return { name: null, address: null };
  // แยกด้วย space — token แรก = ชื่อ, ที่เหลือ = ที่อยู่
  const parts = rest.split(/\s+/);
  if (parts.length === 1) return { name: parts[0], address: null };
  // ถ้า token แรกสั้นๆ (≤3 พยางค์/≤20 ตัวอักษร) เหมือนชื่อ → แยกชื่อ-ที่อยู่
  const first = parts[0];
  if (first.length <= 20) {
    return { name: first, address: parts.slice(1).join(" ") };
  }
  return { name: null, address: rest };
}

// sanity: array ของ string (chip)
function sanitizeChips(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    if (x == null) continue;
    const s = String(x).trim();
    if (!s) continue;
    if (s.length > 30) continue;
    out.push(s.slice(0, 30));
    if (out.length >= 9) break;
  }
  return out;
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
          ok: false,
          error: "AI binding not configured",
          hint: "Go to Cloudflare Pages → Settings → Functions → Bindings → Add AI binding named 'AI'",
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { message, history = [], customerPhone, customerContext, page, mode, helpContext } = body || {};

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "message is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ─────────────────────────────────────────────────────────
    // Phase 25 — HELP TUTOR mode (separate from service request)
    // ใช้สำหรับสอนการใช้แอป — ไม่ใช่ service form filling
    // ─────────────────────────────────────────────────────────
    if (mode === "help") {
      const helpSystemPrompt = `คุณคือ AI ผู้ช่วยใน Boonsook POS V5 PRO — ระบบขายหน้าร้าน บุญสุข อิเล็กทรอนิกส์

${helpContext ? "📍 หน้าที่ผู้ใช้กำลังอยู่:\n" + String(helpContext).slice(0, 1500) : ""}

หน้าที่: ตอบคำถามเกี่ยวกับการใช้งานแอป — เน้นช่วยให้ user ใช้งานได้จริง
ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ใช้ bullet หรือเลขลำดับถ้าเหมาะ
ห้ามตอบแบบ JSON / form — ตอบเป็นข้อความปกติ
ถ้าไม่รู้ → บอกตรงๆ + แนะนำให้ลองกดปุ่มดู หรือดู "📖 วิธีใช้หน้านี้"`;

      const helpMessages = [
        { role: "system", content: helpSystemPrompt },
        ...history.slice(-6).map((h) => ({
          role: h.role === "user" ? "user" : "assistant",
          content: String(h.content || "").slice(0, 500),
        })),
        { role: "user", content: message.slice(0, 500) },
      ];

      try {
        const helpResp = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          { messages: helpMessages, max_tokens: 400, temperature: 0.5 }
        );
        const reply = String(helpResp?.response || "(ไม่มีคำตอบ)").trim();
        return new Response(
          JSON.stringify({ ok: true, reply, mode: "help" }),
          { status: 200, headers: corsHeaders }
        );
      } catch (helpErr) {
        return new Response(
          JSON.stringify({ ok: false, error: "AI error: " + (helpErr?.message || String(helpErr)) }),
          { status: 500, headers: corsHeaders }
        );
      }
    }
    // ─────────────────────────────────────────────────────────

    // ★ context hint ตามหน้าที่ลูกค้ากำลังดู
    let contextHint = "";
    if (page === "solar") {
      contextHint = `\n\n⚠️ CONTEXT ปัจจุบัน: ลูกค้ากำลังอยู่ที่หน้า "งานโซล่าเซลล์" — ต้องเลือก job_type จาก 6 หมวดโซล่าเซลล์เท่านั้น (ติดตั้งปั๊มน้ำโซล่าเซลล์/ติดตั้งชุดออนกริดโซล่าเซลล์/ติดตั้งชุดออฟกริดโซล่าเซลล์/ติดตั้งชุดไฮบริดโซล่าเซลล์/ซ่อม & เซอร์วิสระบบโซล่าเซลล์/งานโซล่าเซลล์อื่นๆ) ห้ามเสนอหมวดแอร์/CCTV/ตู้เย็น`;
    }

    // ★ Phase 11: Customer context (notes + tags) — ผสมเข้า system prompt
    if (customerContext && (customerContext.notes || (Array.isArray(customerContext.tags) && customerContext.tags.length > 0))) {
      const tags = Array.isArray(customerContext.tags) ? customerContext.tags : [];
      const tagSummary = tags.length > 0 ? `Tags: ${tags.join(", ")}` : "";
      const notes = String(customerContext.notes || "").slice(0, 300);
      contextHint += `\n\n👤 ข้อมูลลูกค้าที่กำลังคุย:\n- ชื่อ: ${String(customerContext.name || "ไม่ทราบ").slice(0, 50)}\n${tagSummary ? "- " + tagSummary + "\n" : ""}${notes ? "- บันทึก: " + notes + "\n" : ""}\nใช้ข้อมูลนี้แนะนำให้ตรงใจ — เช่น ถ้า tag "VIP" → ดูแลพิเศษ, "ขายส่ง" → ใช้ราคาส่ง/ราคาพิเศษ, "ห้ามเครดิต" → ห้ามเสนอเงินเชื่อ, ใน notes บอกอะไรให้สอดคล้อง`;
    }

    // สร้าง messages array สำหรับ Llama
    const messages = [
      { role: "system", content: SYSTEM_PROMPT + contextHint },
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
        max_tokens: 640,
        temperature: 0.3,
      }
    );

    // Workers AI อาจคืนค่าได้หลายแบบ: string, object, หรือ array
    const rawResp = aiResp?.response;
    let raw = "";
    let parsed = null;

    if (rawResp && typeof rawResp === "object" && !Array.isArray(rawResp)) {
      parsed = rawResp;
      raw = JSON.stringify(rawResp);
    } else {
      raw = String(rawResp == null ? "" : rawResp).trim();

      try {
        try {
          parsed = JSON.parse(raw);
        } catch {
          const stripped = raw
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
          try {
            parsed = JSON.parse(stripped);
          } catch {
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
        quick_replies: [],
      };
    }

    // prefill phone ถ้าลูกค้าล็อกอินและ AI ยังไม่ได้เก็บ
    if (!parsed.customer_phone && customerPhone) {
      parsed.customer_phone = customerPhone;
    }

    // ★ FALLBACK: ถ้า AI ไม่ได้แยกเบอร์/ชื่อ/ที่อยู่ จากข้อความลูกค้าในรอบนี้
    //   ให้ server ช่วย parse จาก message ปัจจุบัน — กันกรณี AI ถามเพิ่มทั้งที่ลูกค้าบอกครบแล้ว
    const phoneFromMsg = extractPhoneFromText(message);
    if (phoneFromMsg && !parsed.customer_phone) {
      parsed.customer_phone = phoneFromMsg;
    }
    if (phoneFromMsg && (!parsed.customer_name || !parsed.customer_address)) {
      const split = splitNameAddress(message, phoneFromMsg);
      if (!parsed.customer_name && split.name) parsed.customer_name = split.name;
      if (!parsed.customer_address && split.address) parsed.customer_address = split.address;
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
      quick_replies: sanitizeChips(parsed.quick_replies),
    };

    // ไม่ต้องโชว์ chip ตอนถามข้อมูลที่ต้องพิมพ์เอง (ชื่อ/เบอร์/ที่อยู่)
    const reply = out.reply;
    const asksForName = /ชื่อ(คุณ|ของคุณ|ลูกค้า)/.test(reply) && !out.customer_name;
    const asksForPhone = /(เบอร์|โทร)/.test(reply) && !out.customer_phone;
    const asksForAddress = /(ที่อยู่|สถานที่|หน้างาน)/.test(reply) && !out.customer_address;
    if (asksForName || asksForPhone || asksForAddress) {
      out.quick_replies = [];
    }

    // ป้องกัน done:true ถ้าข้อมูลไม่ครบจริงๆ
    if (out.done) {
      if (!out.customer_name || !out.customer_phone || !out.customer_address || !out.job_type) {
        out.done = false;
      }
    }

    // ★ AUTO-DONE: ถ้าได้ข้อมูลครบ 4 อย่างแล้ว (job_type + name + phone + address)
    //   แต่ AI ยังไม่ตั้ง done:true (เพราะอาจจะพยายามถามเพิ่ม) → บังคับปิดงาน
    //   ช่างจะโทรไปสอบถามรายละเอียดเอง ไม่จำเป็นต้องคุยต่อ
    if (!out.done && out.job_type && out.customer_name && out.customer_phone && out.customer_address) {
      out.done = true;
      out.quick_replies = [];
      // เขียน reply สรุปให้ลูกค้าแทน ถ้า AI ยังถามคำถามอยู่
      if (/\?|ครับ\?|ค่ะ\?|ด้วยครับ|ด้วยค่ะ|ไหมครับ|ไหมค่ะ|หรือ|เพิ่มเติม/.test(out.reply)) {
        out.reply = `รับเรื่องแล้วครับคุณ${out.customer_name} ช่างจะโทรกลับที่ ${out.customer_phone} เพื่อยืนยันคิวและสอบถามรายละเอียดเพิ่มเติมครับ`;
      }
    }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("[ai-assistant] server error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
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
